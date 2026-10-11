/**
 * doc 81 Đợt 8 task N1 — background safety-PLC poller: scheduling, interval bound, per-config backoff, READ-ONLY.
 *
 * Oracles are independent of the product code: read counters held by the TEST's fake backends, wall-clock windows measured
 * here, and the poller's own source text (no write path). Hangs are bounded with explicit timers, not vitest timeouts.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
vi.hoisted(() => {
  // N fix 1 (M7) — sdk.ts complains at IMPORT time when OAUTH_SERVER_URL is unset; a local dummy keeps stderr clean (never called).
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import fs from "node:fs";
import path from "node:path";
import type { SafetyPlcConfig, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import type { SafetyPlcBackendReader } from "./safetyPlcAdapter";
import {
  SafetyPlcPoller,
  safetyPlcPollerEnabled,
  pollIntervalMsFor,
  backoffDelayMs,
  defaultBackendFor,
  SAFETY_PLC_POLL_MIN_INTERVAL_MS,
  SAFETY_PLC_POLL_MAX_INTERVAL_MS,
  SAFETY_PLC_POLL_DEFAULT_INTERVAL_MS,
} from "./safetyPlcPoller";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cfg(id: number, over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id,
    code: `N1-${id}`,
    name: `N1 ${id}`,
    vendor: "generic",
    backend: "modbus",
    endpoint: "tcp://127.0.0.1:1",
    statusMap: { estop: { address: "coil:1" }, pollIntervalMs: 250 },
    robotId: null,
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

/** A fake READ-ONLY backend: counts reads; behaviour chosen by the test. */
function fakeBackend(mode: "ok" | "fail" | "hang", snap: SafetyPlcStatusSnapshot = { estop: false }) {
  const b = {
    kind: "modbus" as const,
    reads: 0,
    read: async () => (await b.readChecked()).status,
    readChecked: () => {
      b.reads += 1;
      if (mode === "fail") return Promise.reject(new Error("ECONNREFUSED"));
      if (mode === "hang") return new Promise<never>(() => undefined);
      return Promise.resolve({ status: { ...snap }, unreadable: [] as never[] });
    },
    label: () => "fake modbus (test)",
  };
  return b;
}

const ENV_KEYS = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED", "SAFETY_PLC_POLL_INTERVAL_MS", "SAFETY_PLC_POLL_READ_TIMEOUT_MS"] as const;
const saved: Record<string, string | undefined> = {};
const pollers: SafetyPlcPoller[] = [];
let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.SAFETY_PLC_POLLER_ENABLED = "true";
  process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
  process.env.SAFETY_AUDIT_ENABLED = "true";
  delete process.env.SAFETY_PLC_POLL_INTERVAL_MS;
  delete process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
  while (pollers.length) await pollers.pop()!.stop();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  warn.mockRestore();
  log.mockRestore();
});

function mk(configs: SafetyPlcConfig[], backends: Map<number, SafetyPlcBackendReader>, extra: Record<string, unknown> = {}) {
  const loads = { n: 0 };
  const p = new SafetyPlcPoller({
    loadConfigs: async () => {
      loads.n += 1;
      return configs;
    },
    backendFor: (c: SafetyPlcConfig) => ({ backend: backends.get(c.id) ?? null, reason: backends.has(c.id) ? undefined : "no test backend" }),
    recordPlain: async () => ({ ok: true, enabled: true }),
    recordTrusted: async () => ({ ok: true, enabled: true }),
    leader: { acquire: async () => true, held: async () => true, release: async () => undefined }, state: { load: async () => null, save: async () => undefined, list: async () => [], claimStaleAlarm: async () => false }, // N fix 1 (M4) — single-instance gate faked here
    ...extra,
  });
  pollers.push(p);
  return { p, loads };
}

describe("doc 81 Đợt 8 N1 — flag OFF by default", () => {
  it("SAFETY_PLC_POLLER_ENABLED unset / false ⇒ disabled; start() loads nothing and polls nothing", async () => {
    delete process.env.SAFETY_PLC_POLLER_ENABLED;
    expect(safetyPlcPollerEnabled()).toBe(false);
    process.env.SAFETY_PLC_POLLER_ENABLED = "false";
    expect(safetyPlcPollerEnabled()).toBe(false);
    const b = fakeBackend("ok");
    const { p, loads } = mk([cfg(1)], new Map([[1, b]]));
    expect(p.start()).toBe(false);
    await sleep(400);
    expect(loads.n).toBe(0);
    expect(b.reads).toBe(0);
  });

  it("poller flag ON but the adapter flag (or the audit flag) OFF ⇒ not started", async () => {
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "false";
    const b = fakeBackend("ok");
    const { p, loads } = mk([cfg(1)], new Map([[1, b]]));
    expect(p.start()).toBe(false);
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "false";
    expect(p.start()).toBe(false);
    await sleep(300);
    expect(loads.n + b.reads).toBe(0);
  });

  it("flag ON ⇒ starts, and reads the enabled config", async () => {
    expect(safetyPlcPollerEnabled()).toBe(true);
    const b = fakeBackend("ok");
    const { p } = mk([cfg(1)], new Map([[1, b]]));
    expect(p.start()).toBe(true);
    await sleep(400);
    expect(b.reads).toBeGreaterThanOrEqual(1);
  });
});

describe("doc 81 Đợt 8 N1 — interval per config, bounded to ≥ 250 ms", () => {
  it("statusMap.pollIntervalMs is clamped to [250, 60000]; absent ⇒ env default ⇒ 1000", () => {
    expect(SAFETY_PLC_POLL_MIN_INTERVAL_MS).toBe(250);
    expect(SAFETY_PLC_POLL_MAX_INTERVAL_MS).toBe(60_000);
    expect(SAFETY_PLC_POLL_DEFAULT_INTERVAL_MS).toBe(1000);
    expect(pollIntervalMsFor(cfg(1, { statusMap: { pollIntervalMs: 10 } }))).toBe(250);
    expect(pollIntervalMsFor(cfg(1, { statusMap: { pollIntervalMs: 0 } }))).toBe(250);
    expect(pollIntervalMsFor(cfg(1, { statusMap: { pollIntervalMs: -5 } }))).toBe(250);
    expect(pollIntervalMsFor(cfg(1, { statusMap: { pollIntervalMs: 400 } }))).toBe(400);
    expect(pollIntervalMsFor(cfg(1, { statusMap: { pollIntervalMs: 10_000_000 } }))).toBe(60_000);
    expect(pollIntervalMsFor(cfg(1, { statusMap: { pollIntervalMs: Number.NaN } }))).toBe(1000);
    expect(pollIntervalMsFor(cfg(1, { statusMap: { pollIntervalMs: "5" as never } }))).toBe(1000);
    expect(pollIntervalMsFor(cfg(1, { statusMap: null }))).toBe(1000);
    process.env.SAFETY_PLC_POLL_INTERVAL_MS = "50";
    expect(pollIntervalMsFor(cfg(1, { statusMap: null }))).toBe(250);
    process.env.SAFETY_PLC_POLL_INTERVAL_MS = "2000";
    expect(pollIntervalMsFor(cfg(1, { statusMap: null }))).toBe(2000);
    process.env.SAFETY_PLC_POLL_INTERVAL_MS = "abc";
    expect(pollIntervalMsFor(cfg(1, { statusMap: null }))).toBe(1000);
  });

  it("a config asking for 10 ms is polled no faster than every 250 ms (measured)", async () => {
    const b = fakeBackend("ok");
    const { p } = mk([cfg(1, { statusMap: { estop: { address: "coil:1" }, pollIntervalMs: 10 } })], new Map([[1, b]]));
    p.start();
    await sleep(1100);
    // t≈0 (+ stagger ≤ interval), 250, 500, 750, 1000 ⇒ at most 5 reads; 10 ms would give ~100
    expect(b.reads).toBeGreaterThanOrEqual(3);
    expect(b.reads).toBeLessThanOrEqual(5);
  });
});

describe("doc 81 Đợt 8 N1 — per-config backoff on errors", () => {
  it("backoffDelayMs doubles per consecutive failure, capped at max(interval, 15 s); 0 failures ⇒ the interval", () => {
    expect(backoffDelayMs(250, 0)).toBe(250);
    expect(backoffDelayMs(250, 1)).toBe(500);
    expect(backoffDelayMs(250, 2)).toBe(1000);
    expect(backoffDelayMs(250, 3)).toBe(2000);
    expect(backoffDelayMs(250, 50)).toBe(15_000);
    expect(backoffDelayMs(60_000, 3)).toBe(60_000);
  });

  it("a failing PLC is read less and less often, while a healthy one beside it keeps its interval (per config)", async () => {
    const bad = fakeBackend("fail");
    const good = fakeBackend("ok");
    const { p } = mk([cfg(1), cfg(2)], new Map<number, SafetyPlcBackendReader>([[1, bad], [2, good]]));
    p.start();
    await sleep(1700);
    // bad: t≈0, +500, +1000 (=1500) ⇒ ≤ 3; good: every 250 ms ⇒ ≥ 5
    expect(bad.reads).toBeGreaterThanOrEqual(2);
    expect(bad.reads).toBeLessThanOrEqual(3);
    expect(good.reads).toBeGreaterThanOrEqual(5);
    const s = p.snapshot();
    expect(s.find((x) => x.id === 1)!.failStreak).toBeGreaterThanOrEqual(2);
    expect(s.find((x) => x.id === 2)!.failStreak).toBe(0);
  });
});

describe("doc 81 Đợt 8 N1 — bounded reads (no pile-up, no poll storm)", () => {
  it("a hanging read is abandoned after the read timeout; while it is still pending NO second read is started", async () => {
    process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS = "300";
    const b = fakeBackend("hang");
    const { p } = mk([cfg(1)], new Map([[1, b]]));
    await p.refreshConfigs();
    const t0 = Date.now();
    await p.pollNow(1);
    const el = Date.now() - t0;
    expect(el).toBeGreaterThanOrEqual(280);
    expect(el).toBeLessThan(1300);
    expect(p.snapshot()[0].failStreak).toBe(1);
    await p.pollNow(1); // previous read still pending ⇒ counted as undecidable, no new connection
    await p.pollNow(1);
    expect(b.reads).toBe(1);
    expect(p.snapshot()[0].failStreak).toBe(3);
  });

  it("concurrent pollNow calls for one config run ONE read", async () => {
    const b = fakeBackend("ok");
    const { p } = mk([cfg(1)], new Map([[1, b]]));
    await p.refreshConfigs();
    await Promise.all([p.pollNow(1), p.pollNow(1), p.pollNow(1)]);
    expect(b.reads).toBe(1);
    // all three callers share that one DECIDED read (none of them is turned into a spurious "undecidable")
    expect(p.snapshot()[0]).toMatchObject({ undecidable: 0, failStreak: 0, lastRead: { kind: "decided" } });
  });
});

describe("doc 81 Đợt 8 N1 — which configs are polled", () => {
  it("only ENABLED configs (a disabled row slipped into the list is ignored); removed configs stop being read", async () => {
    const b1 = fakeBackend("ok");
    const b2 = fakeBackend("ok");
    const list = [cfg(1), cfg(2, { enabled: false })];
    const { p } = mk(list, new Map<number, SafetyPlcBackendReader>([[1, b1], [2, b2]]));
    await p.refreshConfigs();
    expect(p.snapshot().map((s) => s.id)).toEqual([1]);
    list.splice(0, 2);
    await p.refreshConfigs();
    expect(p.snapshot()).toEqual([]);
  });

  it("default backend: modbus/opcua WITHOUT an endpoint, or with no status tag mapped ⇒ NO backend (never the all-clear sim)", () => {
    expect(defaultBackendFor(cfg(1, { endpoint: null }), 1000).backend).toBeNull();
    expect(defaultBackendFor(cfg(1, { endpoint: "" }), 1000).backend).toBeNull();
    expect(defaultBackendFor(cfg(1, { statusMap: {} }), 1000).backend).toBeNull();
    expect(defaultBackendFor(cfg(1, { backend: "opcua", statusMap: null }), 1000).backend).toBeNull();
    expect(defaultBackendFor(cfg(1), 1000).backend?.kind).toBe("modbus");
    expect(defaultBackendFor(cfg(1, { backend: "sim", endpoint: null, statusMap: { simScript: [{ estop: true }] } }), 1000).backend?.kind).toBe("sim");
    expect(defaultBackendFor(cfg(1, { backend: "s7" as never }), 1000).backend).toBeNull();
  });
});

describe("doc 81 Đợt 8 N1 — L-7: READ-ONLY, never actuates", () => {
  it("the poller source has no write / actuation path (census of its own text)", () => {
    const src = fs.readFileSync(path.join(__dirname, "safetyPlcPoller.ts"), "utf8");
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/writeTags|writeCoil|writeRegister|\.write\(|commandDispatcher|dispatchCommand|robotCommand|createDriver/);
  });

  it("a backend exposing ONLY read methods is enough (the poller calls nothing else)", async () => {
    const reads = { n: 0 };
    const strict = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "kind") return "modbus";
          if (prop === "label") return () => "strict";
          if (prop === "readChecked") return async () => {
            reads.n += 1;
            return { status: { estop: false }, unreadable: [] };
          };
          if (prop === "then") return undefined;
          throw new Error(`poller touched backend.${String(prop)}`);
        },
      },
    ) as SafetyPlcBackendReader;
    const { p } = mk([cfg(1)], new Map([[1, strict]]));
    await p.refreshConfigs();
    await p.pollNow(1);
    expect(reads.n).toBe(1);
    expect(p.snapshot()[0].failStreak).toBe(0);
  });
});

describe("doc 81 Đợt 8 N1 — stop", () => {
  it("after stop() resolves nothing is read any more", async () => {
    const b = fakeBackend("ok");
    const { p } = mk([cfg(1)], new Map([[1, b]]));
    p.start();
    await sleep(600);
    await p.stop();
    const n = b.reads;
    expect(n).toBeGreaterThanOrEqual(1);
    await sleep(700);
    expect(b.reads).toBe(n);
  });
});
