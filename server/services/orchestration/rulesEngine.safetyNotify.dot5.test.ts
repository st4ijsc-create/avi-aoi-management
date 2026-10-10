/**
 * doc 81 Đợt 5 task F6 + fix 1 (R-5-f) + fix scan (R-5-h) — the orchestration rules engine's "Safety event" notice to the
 * configured recipients (ORCH_NOTIFY_USER_IDS):
 *   • is ALWAYS sent (every producer of the taxonomy below gets a notice);
 *   • is SAFETY-CRITICAL (bypasses in-app opt-outs / quiet hours) ONLY when the event id carries the SERVER-SET trusted
 *     device-ingest mark (trustedSafetyOrigin.ts) and the type the server stored is allowed for that origin. Payload
 *     fields decide nothing: every exclusion below sends the most "physical" fields a user can set.
 *   • carries an OCCURRENCE dedup key (type, machine, event id): a re-trip / another machine / another type never merges.
 * Oracle: the mocked notificationService records each call; events go through the REAL in-process event bus; trusted ids
 * are marked through the module's own mark function (what safetyAuditService.recordFromDeviceIngest calls).
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
import { markTrustedSafetyEvent, _resetTrustedSafetyMarksForTests, TRUSTED_SAFETY_MARK_TTL_MS } from "../safety/trustedSafetyOrigin";

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
  _resetTrustedSafetyMarksForTests();
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

const PHYS = { detectedBy: "plc", handledBy: "advisory", outcome: "stopped", isNearMiss: false };
/** Excluded producers, with the most "physical" fields their author can set — none carries a server mark. */
const EXCLUDED: Array<[string, Record<string, unknown>]> = [
  ["safety.recordEvent: user claims detectedBy plc, type estop", { id: 101, eventType: "estop", ...PHYS, robotId: 3 }],
  ["safety.recordEvent: user claims e_stop", { id: 102, eventType: "e_stop", ...PHYS, robotId: 3 }],
  ["evaluateZones (user-injected detections, source vision)", { id: 103, eventType: "zone_intrusion", detectedBy: "vision", handledBy: "advisory", outcome: "stopped", isNearMiss: false, robotId: 3 }],
  ["readSafetyPlc (user-triggered, may inject a status)", { id: 104, eventType: "estop", ...PHYS, lineId: 2 }],
  ["lost_connection (fieldHealthService)", { id: 0, eventType: "lost_connection", robotId: 3, detectedBy: "telemetry", outcome: "logged_only", isNearMiss: false }],
  ["Andon→robot dispatch", { id: 105, eventType: "intrusion", detectedBy: "operator", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["interlock (logged-only or fired)", { id: 106, eventType: "intrusion", detectedBy: "interlock", handledBy: "interlock_engine", outcome: "stopped", isNearMiss: false, lineId: 2 }],
  ["sim / test sources", { id: 107, eventType: "estop", detectedBy: "sim", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }],
  ["no id at all", { eventType: "estop", ...PHYS, robotId: 3 }],
];

describe("Đợt 5 F fix scan (R-5-h) — safety-critical ⇔ server-set trusted device-ingest mark (pure)", () => {
  it("★ trusted robot-telemetry e-stop ⇒ safety-critical", () => {
    markTrustedSafetyEvent(201, "robot_telemetry", "estop");
    expect(isSafetyCriticalSafetyEvent({ id: 201 })).toBe(true);
  });
  it.each(EXCLUDED)("EXCLUDED: %s", (_n, p) => {
    expect(isSafetyCriticalSafetyEvent(p)).toBe(false);
  });
  it("trusted id but a near-miss ⇒ not safety-critical", () => {
    markTrustedSafetyEvent(202, "robot_telemetry", "estop");
    expect(isSafetyCriticalSafetyEvent({ id: 202, isNearMiss: true })).toBe(false);
  });
  it("trusted id whose STORED type is not allowed for the origin ⇒ not safety-critical (payload type ignored)", () => {
    markTrustedSafetyEvent(203, "robot_telemetry", "zone_intrusion");
    expect(isSafetyCriticalSafetyEvent({ id: 203, eventType: "estop" })).toBe(false);
  });
  it("an expired mark ⇒ not safety-critical", () => {
    markTrustedSafetyEvent(204, "robot_telemetry", "estop", Date.now() - TRUSTED_SAFETY_MARK_TTL_MS - 1);
    expect(isSafetyCriticalSafetyEvent({ id: 204 })).toBe(false);
  });
});

describe("Đợt 5 F fix scan — through the real event bus: always sent; only the trusted mark bypasses; occurrence keys", () => {
  it("★ trusted e-stop ⇒ every recipient gets { safetyCritical: true, dedupKey: (type, machine, id) }", async () => {
    markTrustedSafetyEvent(301, "robot_telemetry", "estop");
    eventBus.publish(EventTypes.SAFETY_EVENT, { id: 301, eventType: "estop", detectedBy: "telemetry", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 }, "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.map((c) => c.userId)).toEqual([5, 6]);
    // final wave P-F4 — plus the per-(type, robot) rate key of the bypass cap (no event id: a flapping e-stop shares it)
    for (const c of N.calls) expect(c.opts).toEqual({ safetyCritical: true, dedupKey: "safety:estop:robot:3:301", rateKey: "safety:estop:robot:3" });
  });

  it.each(EXCLUDED)("★ excluded (%s) ⇒ STILL SENT, as a normal notice (safetyCritical false)", async (_n, p) => {
    eventBus.publish(EventTypes.SAFETY_EVENT, p, "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.every((c) => c.opts?.safetyCritical === false)).toBe(true);
  });

  it("★ a re-trip on the same machine, another machine, another type ⇒ distinct dedup keys (never merged)", async () => {
    // One at a time: concurrent first dynamic imports of a vi.mock'ed module stall inside vitest (harness artefact).
    let n = 0;
    for (const [id, robotId, t] of [[401, 3, "estop"], [402, 3, "estop"], [403, 4, "estop"], [404, 3, "zone_intrusion"]] as const) {
      markTrustedSafetyEvent(id, "robot_telemetry", t);
      eventBus.publish(EventTypes.SAFETY_EVENT, { id, eventType: t, isNearMiss: false, robotId }, "test");
      n += 2;
      expect(await until(() => N.calls.length === n, 1500)).toBe(true);
    }
    const keys = new Set(N.calls.map((c) => c.opts.dedupKey));
    expect(keys.size).toBe(4);
    // P-F4 — the re-trip (402) shares the RATE key of 401 (same type, same robot); another robot / type does not
    const rate = (id: number) => N.calls.find((c) => c.opts.dedupKey.endsWith(`:${id}`))!.opts.rateKey;
    expect(rate(402)).toBe(rate(401));
    expect(new Set([rate(401), rate(403), rate(404)]).size).toBe(3);
  });

  it("advisory rules (SPC critical) are not safety-critical", async () => {
    eventBus.publish(EventTypes.SPC_VIOLATION, { severity: "critical", ruleName: "R1", machineCode: "M1" }, "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.every((c) => c.opts?.safetyCritical !== true)).toBe(true);
  });
});
