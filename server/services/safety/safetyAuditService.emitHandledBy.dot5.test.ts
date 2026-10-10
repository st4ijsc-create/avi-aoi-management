/**
 * doc 81 Đợt 5 task F fix 1 (R-5-f) — the realtime SAFETY_EVENT carries `handledBy` (who recorded it), so the rules
 * engine's safety-critical allow-list can tell a user-recorded event (safety.recordEvent ⇒ handledBy "operator", whatever
 * detectedBy the user picked) from the system's own observers. Oracle: the emitted payload captured at the socket seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const E = vi.hoisted(() => ({ emitted: [] as Array<Record<string, unknown>> }));
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ id: 77, createdAt: new Date(), robotId: null, lineId: null, stationId: null, ...v }],
      }),
    }),
  })),
}));
vi.mock("../../_core/socket", () => ({
  emitSafetyEvent: vi.fn((e: Record<string, unknown>) => void E.emitted.push(e)),
}));

import { record } from "./safetyAuditService";
import { isSafetyCriticalSafetyEvent } from "../orchestration/rulesEngine";

const saved = process.env.SAFETY_AUDIT_ENABLED;
beforeEach(() => {
  E.emitted.length = 0;
  process.env.SAFETY_AUDIT_ENABLED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SAFETY_AUDIT_ENABLED;
  else process.env.SAFETY_AUDIT_ENABLED = saved;
});

describe("Đợt 5 F fix 1 — safety event emit carries handledBy", () => {
  it("a user-recorded event (handledBy operator, detectedBy plc) is emitted with handledBy ⇒ NOT safety-critical", async () => {
    await record({ eventType: "estop", detectedBy: "plc", handledBy: "operator", outcome: "stopped", robotId: 3 });
    expect(E.emitted).toHaveLength(1);
    expect(E.emitted[0]).toMatchObject({ eventType: "estop", detectedBy: "plc", handledBy: "operator" });
    expect(isSafetyCriticalSafetyEvent(E.emitted[0])).toBe(false);
  });

  it("the safety PLC's own e-stop (handledBy advisory) ⇒ safety-critical", async () => {
    await record({ eventType: "estop", detectedBy: "plc", handledBy: "advisory", outcome: "logged_only", robotId: 3 });
    expect(E.emitted[0]).toMatchObject({ handledBy: "advisory" });
    expect(isSafetyCriticalSafetyEvent(E.emitted[0])).toBe(true);
  });
});
