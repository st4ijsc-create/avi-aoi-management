/**
 * doc 81 Đợt 8 task N3 — the poller is edge-triggered with dedup, bounded in memory, stops/restarts cleanly, and an
 * UNDECIDABLE read (timeout, parse error, unreadable tag) yields "PLC unknown/offline" — never a false "released" / "ok".
 *
 * Oracles: events captured at the record seam; a FAKE OT driver registered under "modbus"/"opcua" whose samples the test
 * chooses (the adapter's real OtReadSafetyPlcBackend runs on top of it); read counters held by the test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.hoisted(() => {
  // N fix 1 (M7) — sdk.ts complains at IMPORT time when OAUTH_SERVER_URL is unset; a local dummy keeps stderr clean (never called).
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import type { SafetyPlcConfig, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import type { OtSample, OtTagAddress } from "../../ot/otDriver";
import { registerDriver } from "../../ot/driverRegistry";
import { SafetyPlcPoller, SAFETY_PLC_POLL_MAX_CONFIGS, onlineConfirmReads, SAFETY_PLC_FLAP_WINDOW_MS } from "./safetyPlcPoller";
import { OtReadSafetyPlcBackend, SimSafetyPlcBackend, strictBool, type SafetyPlcBackendReader, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import type { RecordSafetyEventInput } from "../safetyAuditService";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The fake OT driver: per endpoint, the next samples (or "hang" / an Error). READ-ONLY surface + a write tripwire. */
const DRV = { byEndpoint: new Map<string, Array<Partial<Record<string, unknown>> | "hang" | Error>>(), writes: 0 };
function fakeDriver() {
  let ep = "";
  return {
    protocol: "modbus",
    connect: async (c: { endpoint: string }) => {
      ep = c.endpoint;
    },
    disconnect: async () => undefined,
    isConnected: () => true,
    readTags: async (tags: OtTagAddress[]): Promise<OtSample[]> => {
      const q = DRV.byEndpoint.get(ep) ?? [];
      const step = q.length > 1 ? q.shift()! : q[0];
      if (step === "hang") return new Promise<never>(() => undefined);
      if (step instanceof Error) throw step;
      return tags
        .filter((t) => step && t.tagKey in step)
        .map((t) => {
          const v = (step as Record<string, unknown>)[t.tagKey];
          return { tagKey: t.tagKey, value: v === "BAD" ? 0 : v, quality: v === "BAD" ? "bad" : "good", ts: new Date() } as unknown as OtSample;
        });
    },
    writeTags: async () => {
      DRV.writes += 1;
      throw new Error("write tripwire");
    },
  };
}
registerDriver("modbus", fakeDriver as never);
registerDriver("opcua", fakeDriver as never);

const MAP4 = { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" }, resetRequired: { address: "coil:3" }, muting: { address: "coil:4" } };
function cfg(id: number, over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id,
    code: `N3-${id}`,
    name: `N3 ${id}`,
    vendor: "sick",
    backend: "modbus",
    endpoint: `tcp://n3-${id}:502`,
    statusMap: MAP4,
    robotId: id,
    stationId: null,
    lineId: null,
    enabled: true,
    notes: null,
    scope: null,
    corporateCode: null,
    factoryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as SafetyPlcConfig;
}
const all = (s: SafetyPlcStatusSnapshot) => ({ estop: !!s.estop, zoneOccupied: !!s.zoneOccupied, resetRequired: !!s.resetRequired, muting: !!s.muting });

type Rec = { door: string; input: RecordSafetyEventInput };
function mk(configs: SafetyPlcConfig[] | (() => SafetyPlcConfig[]), backendFor?: (c: SafetyPlcConfig) => SafetyPlcBackendReader | null) {
  const recs: Rec[] = [];
  const seam = (door: string) => async (input: RecordSafetyEventInput) => (recs.push({ door, input }), { ok: true, enabled: true });
  const p = new SafetyPlcPoller({
    loadConfigs: async () => (typeof configs === "function" ? configs() : configs),
    ...(backendFor ? { backendFor: (c: SafetyPlcConfig) => ({ backend: backendFor(c), reason: "test" }) } : {}),
    recordPlain: seam("plain"),
    recordTrusted: seam("trusted"),
    isTrustApproved: async () => true,
    leader: { acquire: async () => true, held: async () => true, release: async () => undefined }, state: { load: async () => null, save: async () => undefined, list: async () => [], claimStaleAlarm: async () => false }, // N fix 1 (M4)
  });
  pollers.push(p);
  return { p, recs, types: () => recs.map((r) => r.input.eventType) };
}

const pollers: SafetyPlcPoller[] = [];
const ENV = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED", "SAFETY_PLC_POLL_READ_TIMEOUT_MS"] as const;
const saved: Record<string, string | undefined> = {};
let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.SAFETY_PLC_POLLER_ENABLED = "true";
  process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
  process.env.SAFETY_AUDIT_ENABLED = "true";
  delete process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS;
  DRV.byEndpoint.clear();
  DRV.writes = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
  while (pollers.length) await pollers.pop()!.stop();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  warn.mockRestore();
  log.mockRestore();
  expect(DRV.writes).toBe(0); // L-7: never a write, in any test
});

async function polls(p: SafetyPlcPoller, id: number, n: number) {
  for (let k = 0; k < n; k++) await p.pollNow(id);
}

describe("doc 81 Đợt 8 N3 — edge-triggered with dedup", () => {
  it("50 polls of a stable e-stop ⇒ exactly ONE event; 50 polls of a stable clear state ⇒ none", async () => {
    DRV.byEndpoint.set("tcp://n3-1:502", [all({ estop: true })]);
    DRV.byEndpoint.set("tcp://n3-2:502", [all({})]);
    const { p, types } = mk([cfg(1), cfg(2)]);
    await p.refreshConfigs();
    await polls(p, 1, 50);
    await polls(p, 2, 50);
    expect(types()).toEqual(["estop"]);
  });

  it("a PLC that stays offline ⇒ ONE 'plc_offline' over 30 polls", async () => {
    DRV.byEndpoint.set("tcp://n3-1:502", [new Error("EHOSTUNREACH")]);
    const { p, types } = mk([cfg(1)]);
    await p.refreshConfigs();
    await polls(p, 1, 30);
    expect(types()).toEqual(["plc_offline"]);
  });

  it("an e-stop held while the link flaps is reported ONCE (no re-trip per reconnection)", async () => {
    const seq: Array<Partial<Record<string, unknown>> | Error> = [];
    for (let k = 0; k < 20; k++) seq.push(all({ estop: true }), all({ estop: true }), new Error("ECONNRESET"));
    seq.push(all({ estop: true }));
    DRV.byEndpoint.set("tcp://n3-1:502", seq);
    const { p, types } = mk([cfg(1)]);
    await p.refreshConfigs();
    await polls(p, 1, seq.length);
    expect(types().filter((t) => t === "estop")).toHaveLength(1);
    expect(types()).not.toContain("estop_released");
  });
});

describe("doc 81 Đợt 8 N3 — flap damping: a flapping link cannot flood the event table", () => {
  it("good,good,fail × 30 ⇒ at most 3 link events (offline, online, offline) — then 'online' needs a longer clean run", async () => {
    const seq: Array<Partial<Record<string, unknown>> | Error> = [];
    for (let k = 0; k < 30; k++) seq.push(all({}), all({}), new Error("ECONNRESET"));
    DRV.byEndpoint.set("tcp://n3-1:502", seq);
    const { p, types } = mk([cfg(1)]);
    await p.refreshConfigs();
    await polls(p, 1, seq.length);
    expect(types().length).toBeLessThanOrEqual(3);
    expect(types()[0]).toBe("plc_offline");
  });

  it("after the flapping stops, a clean run brings it back online (exactly one 'plc_online')", async () => {
    const seq: Array<Partial<Record<string, unknown>> | Error> = [];
    for (let k = 0; k < 10; k++) seq.push(all({}), all({}), new Error("ECONNRESET"));
    for (let k = 0; k < 40; k++) seq.push(all({}));
    DRV.byEndpoint.set("tcp://n3-1:502", seq);
    const { p, types } = mk([cfg(1)]);
    await p.refreshConfigs();
    await polls(p, 1, seq.length);
    expect(types()[types().length - 1]).toBe("plc_online");
    expect(types().filter((t) => t === "plc_online").length).toBeLessThanOrEqual(2);
  });
});

describe("doc 81 Đợt 8 N3 — flap damping bounds", () => {
  it("clean reads needed = 2 ^ (offline transitions in the last 10 min), from 2 up to 32; older ones do not count", () => {
    const now = 1_000_000_000;
    expect(onlineConfirmReads([], now)).toBe(2);
    expect(onlineConfirmReads([now - 1], now)).toBe(2);
    expect(onlineConfirmReads([now - 1, now - 2], now)).toBe(4);
    expect(onlineConfirmReads([now - 1, now - 2, now - 3], now)).toBe(8);
    expect(onlineConfirmReads(Array.from({ length: 8 }, (_, i) => now - i), now)).toBe(32);
    const old = now - SAFETY_PLC_FLAP_WINDOW_MS - 1;
    expect(onlineConfirmReads([old, old, old, old], now)).toBe(2);
  });

  it("20 × (33 clean reads, 1 failure) ⇒ 20 offline + 20 online events (the cap keeps a PLC that recovers recoverable); history ≤ 8", async () => {
    const seq: Array<Partial<Record<string, unknown>> | Error> = [all({})];
    for (let k = 0; k < 20; k++) {
      seq.push(new Error(`E${k}`));
      for (let j = 0; j < 33; j++) seq.push(all({}));
    }
    DRV.byEndpoint.set("tcp://n3-1:502", seq);
    const { p, types } = mk([cfg(1)]);
    await p.refreshConfigs();
    await polls(p, 1, seq.length);
    expect(types().filter((t) => t === "plc_offline")).toHaveLength(20);
    expect(types().filter((t) => t === "plc_online")).toHaveLength(20);
    expect(p._sizesForTests().maxHistory).toBe(8);
  });
});

describe("doc 81 Đợt 8 N3 — undecidable ⇒ unknown/offline, NEVER a false 'released' / 'ok'", () => {
  it("timeout: e-stop pressed, then the PLC hangs ⇒ 'plc_offline' (timed out), no 'estop_released'", async () => {
    process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS = "150";
    DRV.byEndpoint.set("tcp://n3-1:502", [all({ estop: true }), "hang"]);
    const { p, recs, types } = mk([cfg(1)]);
    await p.refreshConfigs();
    await polls(p, 1, 4);
    expect(types()).toEqual(["estop", "plc_offline"]);
    expect(String(recs[1].input.notes)).toMatch(/timed out/);
  });

  it("parse error on a REAL tag (value 'abc' / NaN / object) ⇒ that flag is UNREADABLE: no 'released', link 'plc_offline'", async () => {
    for (const garbage of ["abc", Number.NaN, { x: 1 }, "", null]) {
      DRV.byEndpoint.set("tcp://n3-1:502", [all({ estop: true }), { ...all({}), estop: garbage }]);
      const { p, types } = mk([cfg(1)]);
      await p.refreshConfigs();
      await polls(p, 1, 3);
      expect(types(), `garbage ${String(garbage)}`).toEqual(["estop", "plc_offline"]);
      await p.stop();
    }
  });

  it("the adapter's readChecked itself reports an unparseable value as unreadable (preflight sees UNKNOWN, not 'clean')", async () => {
    DRV.byEndpoint.set("tcp://x:502", [{ estop: "abc", zoneOccupied: "0", resetRequired: 1, muting: "TRUE" }]);
    const b = new OtReadSafetyPlcBackend("modbus", "tcp://x:502", MAP4 as never, 500);
    const r: SafetyPlcCheckedRead = await b.readChecked();
    expect(r.unreadable).toEqual(["estop"]);
    expect(r.status).toEqual({ zoneOccupied: false, resetRequired: true, muting: true });
  });

  it("strictBool: booleans, finite numbers, '0'/'1'/'true'/'false' decide; NaN / ±Infinity / 'abc' / '' / null / objects do NOT", () => {
    const decided: Array<[unknown, boolean]> = [[true, true], [false, false], [1, true], [0, false], [-2, true], [0.5, true], ["1", true], ["0", false], [" TRUE ", true], ["False", false]];
    for (const [v, b] of decided) expect(strictBool(v), String(v)).toBe(b);
    for (const v of [Number.NaN, Infinity, -Infinity, "abc", "", "yes", "2", null, undefined, {}, [], 1n]) expect(strictBool(v), String(v)).toBeUndefined();
  });

  it("defence in depth: a real-class backend whose readChecked hands over a NON-boolean status is still 'unreadable' in the poller", async () => {
    const c = cfg(1);
    const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, MAP4 as never, 500);
    let n = 0;
    (b as unknown as { readChecked: () => Promise<unknown> }).readChecked = async () =>
      n++ === 0 ? { status: all({ estop: true }), unreadable: [] } : { status: { ...all({}), estop: "abc" }, unreadable: [] };
    const { p, types } = mk([c], () => b);
    await p.refreshConfigs();
    await polls(p, 1, 3);
    expect(types()).toEqual(["estop", "plc_offline"]);
  });

  it("bad quality on the e-stop tag while a zone trip is readable ⇒ zone trip reported, 'plc_offline', e-stop NOT released", async () => {
    DRV.byEndpoint.set("tcp://n3-1:502", [all({ estop: true }), { ...all({ zoneOccupied: true }), estop: "BAD" }]);
    const { p, types } = mk([cfg(1)]);
    await p.refreshConfigs();
    await polls(p, 1, 3);
    expect(types()).toEqual(["estop", "plc_offline", "zone_intrusion"]);
  });

  it("sim: a scripted non-boolean flag ⇒ undecidable (parse error), never 'released'", async () => {
    const c = cfg(5, { backend: "sim", endpoint: null, statusMap: null });
    const { p, recs, types } = mk([c], () => new SimSafetyPlcBackend([{ estop: true }, { estop: "yes" as never }]));
    await p.refreshConfigs();
    await polls(p, 5, 2);
    expect(types()).toEqual(["estop", "plc_offline"]);
    expect(String(recs[1].input.notes)).toMatch(/parse/);
    expect(recs.every((r) => r.door === "plain")).toBe(true);
  });

  it("a real config with no endpoint ⇒ 'plc_offline' (endpoint missing), not a silent all-clear", async () => {
    const { p, recs, types } = mk([cfg(1, { endpoint: null })]);
    await p.refreshConfigs();
    await polls(p, 1, 3);
    expect(types()).toEqual(["plc_offline"]);
    expect(String(recs[0].input.notes)).toMatch(/endpoint missing/);
  });
});

describe("doc 81 Đợt 8 N3 — bounded memory", () => {
  it(`more than ${SAFETY_PLC_POLL_MAX_CONFIGS} enabled configs ⇒ ${SAFETY_PLC_POLL_MAX_CONFIGS} polled (named warning), internal maps bounded`, async () => {
    const many = Array.from({ length: SAFETY_PLC_POLL_MAX_CONFIGS + 50 }, (_, i) => cfg(i + 1, { backend: "sim", endpoint: null, statusMap: null }));
    const { p } = mk(many, () => new SimSafetyPlcBackend([]));
    await p.refreshConfigs();
    expect(p.snapshot()).toHaveLength(SAFETY_PLC_POLL_MAX_CONFIGS);
    expect(warn.mock.calls.some((c) => /NOT polled/.test(String(c[0])))).toBe(true);
    const sz = p._sizesForTests();
    expect(sz.states).toBe(SAFETY_PLC_POLL_MAX_CONFIGS);
  });

  it("1 000 flapping polls ⇒ per-config history stays bounded; the warning map stays bounded", async () => {
    const seq: Array<Partial<Record<string, unknown>> | Error> = [];
    for (let k = 0; k < 500; k++) seq.push(all({ estop: k % 2 === 0 }), new Error(`E${k}`));
    DRV.byEndpoint.set("tcp://n3-1:502", seq);
    const { p } = mk([cfg(1)]);
    await p.refreshConfigs();
    await polls(p, 1, 1000);
    const sz = p._sizesForTests();
    expect(sz.maxHistory).toBeLessThanOrEqual(8);
    expect(sz.maxFlagKeys).toBeLessThanOrEqual(4);
    expect(sz.warned).toBeLessThanOrEqual(1001);
  });
});

describe("doc 81 Đợt 8 N3 — stops and restarts cleanly", () => {
  it("start ×2 is idempotent (one timer chain); stop ⇒ silence; restart ⇒ fresh state, same rate", async () => {
    let reads = 0;
    const c = cfg(1, { backend: "sim", endpoint: null, statusMap: { pollIntervalMs: 250 } });
    const b = (): SafetyPlcBackendReader => ({
      kind: "sim",
      read: async () => (reads++, { estop: true }),
      label: () => "sim counting",
    });
    const { p, types } = mk([c], b);
    expect(p.start()).toBe(true);
    expect(p.start()).toBe(true);
    await sleep(1100);
    const first = reads;
    expect(first).toBeGreaterThanOrEqual(3);
    expect(first).toBeLessThanOrEqual(6); // one chain at 250 ms, not two
    await p.stop();
    expect(p.isRunning()).toBe(false);
    const atStop = reads;
    const evAtStop = types().length;
    await sleep(700);
    expect(reads).toBe(atStop);
    expect(types().length).toBe(evAtStop);
    expect(p.start()).toBe(true);
    await sleep(1100);
    const second = reads - atStop;
    expect(second).toBeGreaterThanOrEqual(3);
    expect(second).toBeLessThanOrEqual(6);
    // state was reset by the restart: the held e-stop is reported again (state unknown while stopped)
    expect(types()).toEqual(["estop", "estop"]);
  });

  it("stop() while a read is hanging resolves within the bound, and that read's late answer records nothing", async () => {
    process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS = "2000";
    let release!: (v: SafetyPlcStatusSnapshot) => void;
    const c = cfg(1, { backend: "sim", endpoint: null, statusMap: null });
    const { p, types } = mk([c], () => ({ kind: "sim", read: () => new Promise((r) => (release = r)), label: () => "sim slow" }));
    await p.refreshConfigs();
    const inflight = p.pollNow(1);
    let settled = false;
    void inflight.then(() => (settled = true));
    await sleep(50);
    const t0 = Date.now();
    await p.stop();
    expect(Date.now() - t0).toBeLessThan(2700);
    expect(settled, "stop() resolved while a poll was still in flight").toBe(true);
    release({ estop: true });
    await inflight;
    await sleep(50);
    expect(types()).toEqual([]);
  });
});

describe("doc 81 Đợt 8 N3 (self-review) — event notes never carry the PLC endpoint (host / port)", () => {
  it("offline reason + backend label are redacted; the config code stays", async () => {
    const c = cfg(7, { endpoint: "tcp://10.20.30.40:5020" });
    DRV.byEndpoint.set("tcp://10.20.30.40:5020", [all({ estop: true }), new Error("connect ECONNREFUSED 10.20.30.40:5020 (tcp://10.20.30.40:5020)")]);
    const { p, recs } = mk([c]);
    await p.refreshConfigs();
    await polls(p, 7, 2);
    expect(recs.map((r) => r.input.eventType)).toEqual(["estop", "plc_offline"]);
    for (const r of recs) {
      const n = String(r.input.notes);
      expect(n).toMatch(/N3-7/);
      expect(n).not.toMatch(/10\.20\.30\.40|5020/);
    }
    expect(String(recs[1].input.notes)).toMatch(/ECONNREFUSED/);
  });
});

describe("doc 81 Đợt 8 N3 (self-review) — redactEndpoint", () => {
  it("removes the configured endpoint/host and any URL, IPv4[:port], [IPv6]:port, host:port; keeps the error class", async () => {
    const { redactEndpoint } = await import("./safetyPlcPoller");
    const cases: Array<[string, string | null]> = [
      ["connect ECONNREFUSED 192.168.1.20:502", "tcp://192.168.1.20:502"],
      ["getaddrinfo ENOTFOUND plc-07.lan", "tcp://plc-07.lan:502"],
      ["BadSecureChannelClosed opc.tcp://safety-plc.example:4840/UA", "opc.tcp://safety-plc.example:4840/UA"],
      ["connect ETIMEDOUT [fe80::1]:502", null],
      ["socket hang up at other-host:5020", null],
      ["connect EHOSTUNREACH 10.9.8.7 - route lost", null],
    ];
    for (const [msg, ep] of cases) {
      const r = redactEndpoint(msg, ep);
      expect(r, msg).not.toMatch(/192\.168|10\.9\.8\.7|plc-07|safety-plc\.example|fe80|other-host|:502\b|:4840|:5020/);
      expect(r, msg).toMatch(/E[A-Z]+|Bad|hang up/);
    }
  });
});
