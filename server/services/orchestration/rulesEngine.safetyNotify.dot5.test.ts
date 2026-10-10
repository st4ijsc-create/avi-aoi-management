/**
 * doc 81 Đợt 5 task F6 (item 33) — the orchestration rules engine's "Safety event" notice to the configured recipients
 * (ORCH_NOTIFY_USER_IDS) is SAFETY-CRITICAL for a real safety event (not a near-miss; an unknown flag counts as real —
 * fail toward delivery): sendSystemNotification gets `{ safetyCritical: true }`, so an in-app opt-out cannot drop it.
 * Near-misses and the other advisory rules (NG burst, SPC, anomaly) keep the recipient's preferences.
 * Oracle: the mocked notificationService records each call; events go through the REAL in-process event bus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const N = vi.hoisted(() => ({ calls: [] as Array<{ userId: number; data: Record<string, unknown>; opts: unknown }> }));
vi.mock("../notificationService", () => ({
  sendSystemNotification: vi.fn(async (userId: number, data: Record<string, unknown>, opts?: unknown) => {
    N.calls.push({ userId, data, opts });
    return { id: 1 };
  }),
}));
vi.mock("../auditTrailService", () => ({ logCrudOperation: vi.fn(async () => ({ id: 1 })) }));

import { startOrchestration, stopOrchestration } from "./rulesEngine";
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

describe("Đợt 5 F6 — rules engine Safety event notice is safety-critical (real events only)", () => {
  it("★ a real safety event ⇒ every configured recipient gets it with { safetyCritical: true }", async () => {
    eventBus.publish(EventTypes.SAFETY_EVENT, { eventType: "collision", isNearMiss: false, robotId: 3 }, "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.map((c) => c.userId)).toEqual([5, 6]);
    for (const c of N.calls) {
      expect(c.data).toMatchObject({ title: "Safety event" });
      expect(c.opts).toEqual({ safetyCritical: true });
    }
  });

  it("an event without the near-miss flag counts as real (fail toward delivery)", async () => {
    eventBus.publish(EventTypes.SAFETY_EVENT, { eventType: "estop", lineId: 2 }, "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.every((c) => (c.opts as { safetyCritical?: boolean })?.safetyCritical === true)).toBe(true);
  });

  it("a NEAR-MISS keeps the recipients' preferences (not safety-critical)", async () => {
    eventBus.publish(EventTypes.SAFETY_EVENT, { eventType: "zone_intrusion", isNearMiss: true, robotId: 3 }, "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.every((c) => (c.opts as { safetyCritical?: boolean } | undefined)?.safetyCritical !== true)).toBe(true);
  });

  it("advisory rules (SPC critical) are not safety-critical", async () => {
    eventBus.publish(EventTypes.SPC_VIOLATION, { severity: "critical", ruleName: "R1", machineCode: "M1" }, "test");
    expect(await until(() => N.calls.length === 2, 1500)).toBe(true);
    expect(N.calls.every((c) => (c.opts as { safetyCritical?: boolean } | undefined)?.safetyCritical !== true)).toBe(true);
  });
});
