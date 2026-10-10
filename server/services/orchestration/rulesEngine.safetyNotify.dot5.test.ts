/**
 * doc 81 Đợt 5 task F6 + fix 1 (ruling R-5-f) — the orchestration rules engine's "Safety event" notice to the configured
 * recipients (ORCH_NOTIFY_USER_IDS) is SAFETY-CRITICAL (bypasses in-app opt-outs / quiet hours) ONLY for the explicit
 * allow-list `isSafetyCriticalSafetyEvent`: physical types estop / intrusion (guard, light-curtain trip) / zone_intrusion,
 * from an automatic non-sim observer (plc / telemetry / vision / an interlock that really STOPPED), recorded by the system
 * (handledBy advisory / interlock_engine), never a near-miss. Each excluded producer of the taxonomy is pinned below with
 * the exact payload its producer emits (fieldHealthService lost_connection, andonRobotDispatch, interlockEngine logged-only,
 * safety.recordEvent, sim/test sources). Every notice carries the (type, machine) dedup key used by the 60 s bypass throttle.
 * Oracle: the mocked notificationService records each call; events go through the REAL in-process event bus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const N = vi.hoisted(() => ({ calls: [] as Array<{ userId: number; data: Record<string, unknown>; opts: any }> }));
vi.mock("../notificationService", () => ({
  sendSystemNotification: vi.fn(async (userId: number, data: Record<string, unknown>, opts?: unknown) => {
    N.calls.push({ userId, data, opts });
    return { id: 1 };
  }),
}));
vi.mock("../auditTrailService", () => ({ logCrudOperation: vi.fn(async () => ({ id: 1 })) }));

import { startOrchestration, stopOrchestration, isSafetyCriticalSafetyEvent } from "./rulesEngine";
import { eventBus, EventTypes } from "../../_core/eventBus";

async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}

const saved = { en: process.env.ORCHESTRATION_ENABLED, ids: process.env.ORCH_NOTIFY_USER_IDS };
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  N.calls.length = 0;
  process.env.ORCHESTRATION_ENABLED = "true";
  process.env.ORCH_NOTIFY_USER_IDS = "5,6";
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  startOrchestration();
});
afterEach(() => {
  stopOrchestration();
  warn.mockRestore();
  if (saved.en === undefined) delete process.env.ORCHESTRATION_ENABLED;
  else process.env.ORCHESTRATION_ENABLED = saved.en;
  if (saved.ids === undefined) delete process.env.ORCH_NOTIFY_USER_IDS;
  else process.env.ORCH_NOTIFY_USER_IDS = saved.ids;
});

/** Payloads exactly as their producers emit them (safetyAuditService.record → emitSafetyEvent, or a direct emit). */
const INCLUDED: Array<[string, Record<string, unknown>]> = [
  ["safety PLC e-stop", { eventType: "estop", detectedBy: "plc", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["safety PLC guard / light-curtain trip (resetRequired ⇒ intrusion)", { eventType: "intrusion", detectedBy: "plc", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, lineId: 2 }],
  ["safety PLC protective zone occupied", { eventType: "zone_intrusion", detectedBy: "plc", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["robot telemetry e-stop transition (robotIngest)", { eventType: "estop", detectedBy: "telemetry", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 4 }],
  ["vision zone breach (safetyZoneService)", { eventType: "zone_intrusion", detectedBy: "vision", handledBy: "advisory", outcome: "stopped", isNearMiss: false, robotId: 3 }],
  ["interlock that really STOPPED", { eventType: "intrusion", detectedBy: "interlock", handledBy: "interlock_engine", outcome: "stopped", isNearMiss: false, lineId: 2 }],
];
const EXCLUDED: Array<[string, Record<string, unknown>]> = [
  ["lost_connection (fieldHealthService: comms health)", { id: 0, eventType: "lost_connection", robotId: 3, detectedBy: "telemetry", outcome: "logged_only", isNearMiss: false }],
  ["lost_connection even if a producer stamped handledBy advisory (type not allow-listed)", { eventType: "lost_connection", robotId: 3, detectedBy: "telemetry", handledBy: "advisory", outcome: "logged_only", isNearMiss: false }],
  ["Andon→robot dispatch (andonRobotDispatch)", { eventType: "intrusion", detectedBy: "operator", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["logged-only interlock (interlockEngine, not fired)", { eventType: "intrusion", detectedBy: "interlock", handledBy: "interlock_engine", outcome: "logged_only", isNearMiss: false, lineId: 2 }],
  ["user-recorded safety.recordEvent claiming detectedBy plc", { eventType: "estop", detectedBy: "plc", handledBy: "operator", outcome: "stopped", isNearMiss: false, robotId: 3 }],
  ["user-recorded safety.recordEvent detectedBy operator", { eventType: "estop", detectedBy: "operator", handledBy: "operator", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["detectedBy sim (sim PLC backend / sim zone track)", { eventType: "estop", detectedBy: "sim", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["detectedBy test (Safety Monitor sandbox)", { eventType: "zone_intrusion", detectedBy: "test", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["near-miss flag", { eventType: "estop", detectedBy: "plc", handledBy: "advisory", outcome: "logged_only", isNearMiss: true, robotId: 3 }],
  ["near_miss type (nearMissAdvisor)", { eventType: "near_miss", detectedBy: "vision", handledBy: "advisory", outcome: "logged_only", isNearMiss: true, robotId: 3 }],
  ["non-allow-listed type (collision)", { eventType: "collision", detectedBy: "plc", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["missing handledBy (unknown recorder)", { eventType: "estop", detectedBy: "plc", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["missing detectedBy", { eventType: "estop", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
];

describe("Đợt 5 F6 fix 1 (R-5-f) — safety-critical allow-list (pure)", () => {
  it.each(INCLUDED)("INCLUDED: %s", (_n, p) => {
    expect(isSafetyCriticalSafetyEvent(p)).toBe(true);
  });
  it.each(EXCLUDED)("EXCLUDED: %s", (_n, p) => {
    expect(isSafetyCriticalSafetyEvent(p)).toBe(false);
  });
});

describe("Đợt 5 F6 fix 1 (R-5-f) — through the real event bus: the notice is sent either way; only the allow-list bypasses", () => {
  it("★ allow-listed (PLC e-stop) ⇒ every recipient gets { safetyCritical: true, dedupKey: (type, machine) }", async () => {
    eventBus.publish(EventTypes.SAFETY_EVENT, INCLUDED[0][1], "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.map((c) => c.userId)).toEqual([5, 6]);
    for (const c of N.calls) {
      expect(c.data).toMatchObject({ title: "Safety event" });
      expect(c.opts).toEqual({ safetyCritical: true, dedupKey: "safety:estop:robot:3" });
    }
  });

  it.each(EXCLUDED)("★ excluded (%s) ⇒ a NORMAL notice (safetyCritical false), recipients' preferences apply", async (_n, p) => {
    eventBus.publish(EventTypes.SAFETY_EVENT, p, "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.every((c) => c.opts?.safetyCritical === false)).toBe(true);
  });

  it("advisory rules (SPC critical) are not safety-critical", async () => {
    eventBus.publish(EventTypes.SPC_VIOLATION, { severity: "critical", ruleName: "R1", machineCode: "M1" }, "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.every((c) => c.opts?.safetyCritical !== true)).toBe(true);
  });
});
