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
 * Re-pinned 2026-10-12 (doc 81 Đợt 9 U3 — durable trust, consumed exactly once): ids are now "marked" through the trust STORE
 * seam (an in-memory stand-in for the safety_event_trust table with the same consume-once semantics; the real table is
 * covered by trustedSafetyOrigin.u3.dot9.db.test.ts), bound to the payload content (trustedEventDigest). The verdict is
 * async and consumes: each case asks once. Expiry is the DB's job (covered by the DB test).
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

import { startOrchestration, stopOrchestration, consumeSafetyCriticalTrust } from "./rulesEngine";
import { eventBus, EventTypes } from "../../_core/eventBus";
import { _setTrustedEventStoreForTests, trustedEventDigest } from "../safety/trustedSafetyOrigin";

/** Đợt 9 U3 — in-memory stand-in for the safety_event_trust table (consume once, digest-bound). */
const TRUST = new Map<number, { origin: string; eventType: string; digest: string; consumed: boolean }>();
_setTrustedEventStoreForTests({
  async mark() {
    /* not used here: rows are planted with markTrusted() below */
  },
  async consume(id, digest) {
    const r = TRUST.get(id);
    if (!r || r.consumed || r.digest !== digest) return null;
    r.consumed = true;
    return { origin: r.origin, eventType: r.eventType };
  },
});
/** What recordFromDeviceIngest stores for the event `p` (origin + the type the server stored, bound to p's content). */
function markTrusted(p: Record<string, unknown>, origin: string, storedType = String(p.eventType)) {
  TRUST.set(p.id as number, { origin, eventType: storedType, digest: trustedEventDigest(p)!, consumed: false });
}
const isSafetyCriticalSafetyEvent = (p: Record<string, unknown>) => consumeSafetyCriticalTrust(p);

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
  TRUST.clear();
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
  it("★ trusted robot-telemetry e-stop ⇒ safety-critical (once — Đợt 9 U3)", async () => {
    const p = { id: 201, eventType: "estop", robotId: 3 };
    markTrusted(p, "robot_telemetry");
    expect(await isSafetyCriticalSafetyEvent(p)).toBe(true);
    expect(await isSafetyCriticalSafetyEvent(p)).toBe(false);
  });
  it.each(EXCLUDED)("EXCLUDED: %s", async (_n, p) => {
    expect(await isSafetyCriticalSafetyEvent(p)).toBe(false);
  });
  it("trusted id but a near-miss ⇒ not safety-critical", async () => {
    const p = { id: 202, eventType: "estop", robotId: 3 };
    markTrusted(p, "robot_telemetry");
    expect(await isSafetyCriticalSafetyEvent({ ...p, isNearMiss: true })).toBe(false);
  });
  it("trusted id whose STORED type is not allowed for the origin ⇒ not safety-critical (payload type ignored)", async () => {
    const p = { id: 203, eventType: "estop", robotId: 3 };
    markTrusted(p, "robot_telemetry", "zone_intrusion");
    expect(await isSafetyCriticalSafetyEvent(p)).toBe(false);
  });
  it("Đợt 9 U3 — a payload whose content differs from what was recorded (other robot) ⇒ not safety-critical", async () => {
    const p = { id: 204, eventType: "estop", robotId: 3 };
    markTrusted(p, "robot_telemetry");
    expect(await isSafetyCriticalSafetyEvent({ ...p, robotId: 4 })).toBe(false);
  });
});

describe("Đợt 5 F fix scan — through the real event bus: always sent; only the trusted mark bypasses; occurrence keys", () => {
  it("★ trusted e-stop ⇒ every recipient gets { safetyCritical: true, dedupKey: (type, machine, id) }", async () => {
    const p = { id: 301, eventType: "estop", detectedBy: "telemetry", handledBy: "advisory", outcome: "logged_only", isNearMiss: false, robotId: 3 };
    markTrusted(p, "robot_telemetry");
    eventBus.publish(EventTypes.SAFETY_EVENT, p, "test");
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
      const p = { id, eventType: t, isNearMiss: false, robotId };
      markTrusted(p, "robot_telemetry");
      eventBus.publish(EventTypes.SAFETY_EVENT, p, "test");
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
