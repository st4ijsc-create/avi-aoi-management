/**
 * doc 81 Đợt 9 final wave (U re-review #4 — "a distinct heartbeat-stale display reason") — a PLC whose HEARTBEAT tag is frozen /
 * unreadable is offline for a reason the operator fixes differently (program stopped?) than a cable / network fault. The poller
 * persists the DISPLAY reason `blindReason: "heartbeat_stale"` with the confirmed offline row; the link / events / health decisions
 * are UNCHANGED (still "plc_offline", still offline). Any other undecidable read, or a decided one, clears it. Scripted backend.
 */
import { describe, it, expect, vi } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { OtReadSafetyPlcBackend, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import { evaluatePollerHealth, type PollStateRow } from "./safetyPlcPollerHealth";
import { computeSafetySourceHealth } from "../safetySourceHealth";
import type { RecordSafetyEventInput } from "../safetyAuditService";

function cfg(over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id: 291, code: "HB1", name: "hb1", vendor: "pilz", backend: "modbus", endpoint: "tcp://127.0.0.1:1",
    statusMap: { estop: { address: "coil:1" }, heartbeat: { address: "holding:40010", maxSilentMs: 1000 } },
    robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2, createdAt: new Date(), updatedAt: new Date(), ...over,
  } as SafetyPlcConfig;
}
type Step = { hb?: number | "bad"; throws?: boolean };
function mk(steps: Step[], monoNow: () => number) {
  const c = cfg();
  const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
  let i = 0;
  (b as unknown as { readChecked: (o?: Record<string, unknown>) => Promise<SafetyPlcCheckedRead> }).readChecked = async (o) => {
    const s = steps[Math.min(i++, steps.length - 1)];
    if (s.throws) throw new Error("ECONNRESET (the link)");
    const r: SafetyPlcCheckedRead = { status: { estop: false }, unreadable: [] };
    if (o?.withHeartbeat) r.heartbeat = s.hb === "bad" || s.hb === undefined ? { unreadable: true } : { value: s.hb, unreadable: false };
    return r;
  };
  const recs: Array<{ input: RecordSafetyEventInput }> = [];
  const saves: PollStateRow[] = [];
  const p = new SafetyPlcPoller({
    loadConfigs: async () => [c],
    backendFor: () => ({ backend: b }),
    recordPlain: async (x) => (recs.push({ input: x }), { ok: true, enabled: true }),
    recordTrusted: async (x) => (recs.push({ input: x }), { ok: true, enabled: true }),
    isTrustApproved: async () => true,
    leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
    state: { load: async () => null, save: async (r) => void saves.push(JSON.parse(JSON.stringify(r))), list: async () => [], claimStaleAlarm: async () => false },
    monoNow,
  });
  return { p, recs, saves };
}
const last = (saves: PollStateRow[]) => saves[saves.length - 1];

describe("final wave — 'heartbeat stale' is a DISPLAY reason of an offline PLC (decisions unchanged)", () => {
  it("★ heartbeat frozen ⇒ offline + blindReason 'heartbeat_stale' (event still plc_offline); moving again ⇒ online, reason cleared", async () => {
    let t = 5_000_000;
    const { p, recs, saves } = mk([{ hb: 1 }, { hb: 1 }, { hb: 1 }, { hb: 2 }, { hb: 3 }, { hb: 4 }], () => t);
    await p.refreshConfigs();
    for (const dt of [0, 1000, 1500]) {
      t += dt;
      await p.pollNow(291);
    }
    expect(recs.map((r) => r.input.eventType)).toEqual(["plc_offline"]);
    expect(last(saves)).toMatchObject({ link: "offline", blindReason: "heartbeat_stale" });
    for (const dt of [500, 500, 500]) {
      t += dt;
      await p.pollNow(291);
    }
    expect(recs.map((r) => r.input.eventType)).toEqual(["plc_offline", "plc_online"]);
    expect(last(saves)).toMatchObject({ link: "online", blindReason: null });
  });

  it("★ heartbeat unreadable ⇒ 'heartbeat_stale' too", async () => {
    let t = 5_000_000;
    const { p, saves } = mk([{ hb: 1 }, { hb: "bad" }], () => t);
    await p.refreshConfigs();
    await p.pollNow(291);
    t += 100;
    await p.pollNow(291);
    expect(last(saves)).toMatchObject({ link: "offline", blindReason: "heartbeat_stale" });
  });

  it("a LINK fault (the read fails) ⇒ offline with NO heartbeat reason; a heartbeat stall after it ⇒ the reason appears", async () => {
    let t = 5_000_000;
    const { p, saves } = mk([{ hb: 1 }, { throws: true }, { hb: "bad" }], () => t);
    await p.refreshConfigs();
    await p.pollNow(291);
    t += 100;
    await p.pollNow(291);
    expect(last(saves)).toMatchObject({ link: "offline", blindReason: null });
    t += 100;
    await p.pollNow(291);
    expect(last(saves)).toMatchObject({ link: "offline", blindReason: "heartbeat_stale" });
  });

  it("health passes the reason only for an OFFLINE row; the Safety panel row carries it (display), the poller state is unchanged", () => {
    const enabled = [{ id: 1, code: "A", factoryId: null }, { id: 2, code: "B", factoryId: null }];
    const now = Date.now();
    const rows: PollStateRow[] = [
      { configId: 1, link: "offline", flags: {}, intervalMs: 1000, lastAttemptAt: now, lastOkAt: now - 5000, blindReason: "heartbeat_stale" },
      { configId: 2, link: "online", flags: {}, intervalMs: 1000, lastAttemptAt: now, lastOkAt: now, blindReason: "heartbeat_stale" }, // stale value on an online row: ignored
    ];
    const h = evaluatePollerHealth(enabled, rows, now, { enabled: true });
    expect(h.state).toBe("ok");
    expect(h.configs.map((c) => [c.code, c.link, c.blindReason])).toEqual([["A", "offline", "heartbeat_stale"], ["B", "online", null]]);
    const panel = computeSafetySourceHealth({
      checkedAt: new Date(now).toISOString(),
      flags: { safetyPlcAdapter: true, otPreflight: true, robotPreflight: true, otControl: false, robotControl: false, safetyVision: false, safetyZoneSw: false, safetyEstopAdapter: false },
      plcConfigsEnabled: [],
      plcRead: "ok",
      targets: null,
      visibleFactoryIds: null,
      zones: [],
      calibrations: [],
      estop: { kind: "none", label: "none", rated: false },
      socketServerUp: true,
      plcPoller: h,
    } as never);
    expect(panel.plcPoller.configs.map((c) => [c.code, c.blindReason])).toEqual([["A", "heartbeat_stale"], ["B", null]]);
  });
});

describe("final wave (R-9-e) — the latch warning of an actuation confirm lists only the PLCs guarding its TARGET", () => {
  const now = Date.now();
  const enabled = [{ id: 11, code: "GUARDS-R4", factoryId: null }, { id: 12, code: "OTHER-R9", factoryId: null }];
  const rows: PollStateRow[] = enabled.map((c) => ({ configId: c.id, link: "online", flags: { estopLatch: true }, intervalMs: 1000, lastAttemptAt: now, lastOkAt: now, latchSetAt: now - 60_000 }));
  const plc = (id: number, code: string, robotId: number) => ({ id, code, backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } }, factoryId: null, scope: null, robotId, stationId: null, lineId: null });
  const snapshot = (targets: unknown) =>
    computeSafetySourceHealth({
      checkedAt: new Date(now).toISOString(),
      flags: { safetyPlcAdapter: true, otPreflight: true, robotPreflight: true, otControl: false, robotControl: false, safetyVision: false, safetyZoneSw: false, safetyEstopAdapter: false },
      plcConfigsEnabled: [plc(11, "GUARDS-R4", 4), plc(12, "OTHER-R9", 9)],
      plcRead: "ok",
      targets,
      visibleFactoryIds: null,
      zones: [],
      calibrations: [],
      estop: { kind: "none", label: "none", rated: false },
      socketServerUp: true,
      plcPoller: evaluatePollerHealth(enabled, rows, now, { enabled: true }),
    } as never);
  const robot4 = { robotId: 4, machineId: null, stationId: null, lineId: null, factoryId: null, stationRobotIds: [], lineLevelRobotIds: [], lineRobotIds: [] };

  it("★ with a robot target: only the latched PLC guarding THAT robot", () => {
    expect(snapshot([robot4]).plcPoller.latched.map((l) => l.code)).toEqual(["GUARDS-R4"]);
  });
  it("without a target (the Safety page, a Studio approval): every latched PLC in scope (unchanged)", () => {
    expect(snapshot(null).plcPoller.latched.map((l) => l.code)).toEqual(["GUARDS-R4", "OTHER-R9"]);
  });
});
