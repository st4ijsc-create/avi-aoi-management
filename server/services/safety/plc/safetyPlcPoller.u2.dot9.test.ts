/**
 * doc 81 Đợt 9 task U2 — Modbus configs may map an e-stop LATCH bit (statusMap.estopLatch). The PLC program sets it on every
 * press and holds it until it is cleared PLC-side / by an operator; the poller only READS it. A press + release that both
 * happened BETWEEN two reads is then still recorded: "estop" (transition "latched") then "estop_released".
 * Oracles: the events captured at the two record doors, and the durable rows captured at the state seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { OtReadSafetyPlcBackend, decideLatch, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import type { RecordSafetyEventInput } from "../safetyAuditService";
import type { PollStateRow } from "./safetyPlcPollerHealth";

function cfg(over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id: 91,
    code: "U2-PLC",
    name: "U2",
    vendor: "pilz",
    backend: "modbus",
    endpoint: "tcp://127.0.0.1:1",
    statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" }, estopLatch: { address: "coil:3" } },
    robotId: 4,
    stationId: 9,
    lineId: 2,
    enabled: true,
    notes: null,
    scope: null,
    corporateCode: null,
    factoryId: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as SafetyPlcConfig;
}

type Step = { estop?: boolean; zone?: boolean; latch?: boolean; latchBad?: boolean; zoneBad?: boolean };
/** A REAL OtReadSafetyPlcBackend whose readChecked is scripted (no network); records whether the latch was asked for. */
function scripted(c: SafetyPlcConfig, steps: Step[]) {
  const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
  const asked: boolean[] = [];
  let i = 0;
  (b as unknown as { readChecked: (o?: { withLatch?: boolean }) => Promise<SafetyPlcCheckedRead> }).readChecked = async (o) => {
    const s = steps[Math.min(i++, steps.length - 1)];
    asked.push(o?.withLatch === true);
    const r: SafetyPlcCheckedRead = { status: { estop: s.estop === true, zoneOccupied: s.zone === true }, unreadable: s.zoneBad ? ["zoneOccupied"] : [] };
    if (o?.withLatch) r.latch = s.latchBad ? { unreadable: true } : { estopLatch: s.latch === true, unreadable: false };
    return r;
  };
  return { b, asked };
}

function mk(c: SafetyPlcConfig, steps: Step[], durable: PollStateRow | null = null) {
  const recs: Array<{ door: string; input: RecordSafetyEventInput }> = [];
  const saves: PollStateRow[] = [];
  const { b, asked } = scripted(c, steps);
  const p = new SafetyPlcPoller({
    loadConfigs: async () => [c],
    backendFor: () => ({ backend: b }),
    recordPlain: async (i) => (recs.push({ door: "plain", input: i }), { ok: true, enabled: true }),
    recordTrusted: async (i) => (recs.push({ door: "trusted", input: i }), { ok: true, enabled: true }),
    isTrustApproved: async () => true,
    leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
    state: { load: async () => durable, save: async (r) => void saves.push(JSON.parse(JSON.stringify(r))), list: async () => [], claimStaleAlarm: async () => false },
  });
  return { p, recs, saves, asked };
}
const ev = (recs: Array<{ door: string; input: RecordSafetyEventInput }>) => recs.map((r) => [r.door, r.input.eventType, (r.input.humanPosition as Record<string, unknown>)?.transition]);

let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined)];
});
afterEach(() => quiet.forEach((q) => q.mockRestore()));

async function polls(p: SafetyPlcPoller, n: number) {
  await p.refreshConfigs();
  for (let i = 0; i < n; i++) await p.pollNow(91);
}

describe("Đợt 9 U2 — the e-stop latch captures a press shorter than one poll interval", () => {
  it("★ press + release between two reads (live estop false both times, latch now set) ⇒ 'estop' (latched) then 'estop_released', both through the approved (trusted) door", async () => {
    const { p, recs, asked } = mk(cfg(), [{}, { latch: true }]);
    await polls(p, 2);
    expect(ev(recs)).toEqual([
      ["trusted", "estop", "latched"],
      ["trusted", "estop_released", "released"],
    ]);
    expect(String(recs[0].input.notes)).toMatch(/LATCH bit/);
    expect(String(recs[0].input.notes)).toMatch(/never by the server/);
    expect(asked.every(Boolean)).toBe(true); // the poller asks for the latch on every read
  });

  it("★ without the latch the same short press is invisible (control: what the latch adds)", async () => {
    const c = cfg({ statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" } } as never });
    const { p, recs, asked } = mk(c, [{}, { latch: true }]);
    await polls(p, 2);
    expect(recs).toEqual([]);
    expect(asked.some(Boolean)).toBe(false); // no latch mapped ⇒ never asked
  });

  it("a press seen LIVE (estop true) while the latch rises ⇒ ONE 'estop'; release ⇒ 'estop_released'; latch cleared later ⇒ nothing", async () => {
    const { p, recs } = mk(cfg(), [{}, { estop: true, latch: true }, { latch: true }, {}]);
    await polls(p, 4);
    expect(ev(recs)).toEqual([
      ["trusted", "estop", "active"],
      ["trusted", "estop_released", "released"],
    ]);
  });

  it("the latch rising one read AFTER a live press (catching up) adds nothing", async () => {
    const { p, recs } = mk(cfg(), [{}, { estop: true }, { latch: true }]);
    await polls(p, 3);
    expect(ev(recs)).toEqual([
      ["trusted", "estop", "active"],
      ["trusted", "estop_released", "released"],
    ]);
  });

  it("★ a latch held set records the press ONCE; cleared then set again (a second short press) ⇒ a second pair", async () => {
    const { p, recs } = mk(cfg(), [{}, { latch: true }, { latch: true }, { latch: true }, {}, { latch: true }]);
    await polls(p, 6);
    expect(ev(recs).map((e) => e[1])).toEqual(["estop", "estop_released", "estop", "estop_released"]);
  });

  it("★ latch tag UNREADABLE ⇒ 'plc_offline' (never a release, never 'not latched')", async () => {
    const { p, recs } = mk(cfg(), [{}, { latchBad: true }]);
    await polls(p, 2);
    expect(ev(recs).map((e) => e[1])).toEqual(["plc_offline"]);
  });

  it("latch rises while the link is OFFLINE (another tag unreadable) ⇒ the press now, the release only once back online", async () => {
    const { p, recs } = mk(cfg(), [{}, { latch: true, zoneBad: true }, { latch: true }, { latch: true }]);
    await polls(p, 2);
    expect(ev(recs).map((e) => e[1])).toEqual(["plc_offline", "estop"]);
    await p.pollNow(91);
    await p.pollNow(91); // 2 clean reads ⇒ online (flap damping)
    expect(ev(recs).map((e) => e[1])).toEqual(["plc_offline", "estop", "plc_online", "estop_released"]);
  });

  it("a latch-only config (no live estop tag) ⇒ the press only", async () => {
    const c = cfg({ statusMap: { estopLatch: { address: "coil:3" } } as never });
    const { p, recs, saves } = mk(c, [{}, { latch: true }]);
    await polls(p, 2);
    expect(ev(recs)).toEqual([["trusted", "estop", "latched"]]);
    expect(saves.at(-1)?.flags.estop).toBeUndefined(); // no live tag: the live state is not invented
  });

  it("★ the latch is part of the DURABLE edge: a restart with the latch still set re-reports nothing", async () => {
    const c = cfg();
    const { plcTrustDigest } = await import("./safetyPlcTrust");
    const durable: PollStateRow = { configId: 91, link: "online", flags: { estop: false, zoneOccupied: false, estopLatch: true }, intervalMs: 1000, lastAttemptAt: null, lastOkAt: null, identityDigest: plcTrustDigest(c) };
    const { p, recs, saves } = mk(c, [{ latch: true }, { latch: true }], durable);
    await polls(p, 2);
    expect(recs).toEqual([]);
    expect(saves.at(-1)?.flags).toMatchObject({ estopLatch: true, estop: false });
  });

  it("the durable edge after a latched pair: estop false, latch true (confirmed only after both were recorded)", async () => {
    const { p, saves } = mk(cfg(), [{}, { latch: true }]);
    await polls(p, 2);
    expect(saves.at(-1)?.flags).toMatchObject({ estop: false, estopLatch: true });
  });
});

describe("Đợt 9 U2 — deciding the latch sample (adapter)", () => {
  const map = { estopLatch: { address: "coil:3" } } as never;
  it("missing / bad quality / unparseable ⇒ UNREADABLE (never 'not latched')", () => {
    expect(decideLatch(map, undefined)).toEqual({ unreadable: true });
    expect(decideLatch(map, { quality: "bad", value: false })).toEqual({ unreadable: true });
    expect(decideLatch(map, { quality: "uncertain", value: true })).toEqual({ unreadable: true });
    for (const v of ["abc", "", null, Number.NaN, {}]) expect(decideLatch(map, { quality: "good", value: v })).toEqual({ unreadable: true });
  });
  it("good samples: truthy by default, inverted with activeWhen 'falsy'", () => {
    expect(decideLatch(map, { quality: "good", value: true })).toEqual({ estopLatch: true, unreadable: false });
    expect(decideLatch(map, { quality: "good", value: 0 })).toEqual({ estopLatch: false, unreadable: false });
    expect(decideLatch({ estopLatch: { address: "x", activeWhen: "falsy" } } as never, { quality: "good", value: false })).toEqual({ estopLatch: true, unreadable: false });
  });
});
