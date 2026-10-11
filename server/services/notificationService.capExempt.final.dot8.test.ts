/**
 * doc 81 Đợt 8 final wave F1 (ruling R-8-d) — the Đợt 5 B3 "STOP not confirmed" alarm is EXEMPT from the per-recipient
 * opt-out-bypass cap: it is never downgraded by it and never charged to it; the cap counts only safety-event notices.
 * Oracle: the fake `../db` records every createNotification; recipient 5 has opted out of everything (so a downgraded
 * notice is NOT stored — only a bypass reaches the table).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const DB = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));
vi.mock("../db", () => ({
  createNotification: vi.fn(async (row: Record<string, unknown>) => {
    DB.created.push(row);
    return { id: DB.created.length };
  }),
  broadcastNotification: vi.fn(),
  getUserNotificationPreferences: vi.fn(async (userId: number) =>
    userId === 5
      ? { inAppEnabled: false, inAppAlerts: false, inAppReports: false, inAppSystem: false, quietHoursEnabled: false }
      : null,
  ),
  getUnreadNotificationCount: vi.fn(async () => 0),
}));

import { sendNotification, _resetSafetyCriticalDedupForTests, SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN } from "./notificationService";

beforeEach(() => {
  _resetSafetyCriticalDedupForTests();
  DB.created.length = 0;
});

async function trips(userId: number, n: number, tag: string) {
  for (let i = 0; i < n; i++) {
    await sendNotification(userId, { type: "ALERT", title: "Safety event", message: `estop ${tag}${i}`, priority: "HIGH" }, {
      safetyCritical: true,
      dedupKey: `safety:estop:${tag}${i}:${i}`,
      rateKey: `safety:estop:${tag}${i}`,
    });
  }
}
async function stopUnverified(userId: number, stopId: number, capExempt: unknown = "ot_stop_unverified") {
  return sendNotification(userId, { type: "ALERT", title: "STOP not confirmed — adapter 3", message: "m", priority: "URGENT" }, {
    safetyCritical: true,
    capExempt: capExempt as "ot_stop_unverified",
    dedupKey: `ot_stop_unverified:machine:9:stop:${stopId}`,
  });
}
const stored = (u: number, title: string) => DB.created.filter((r) => r.userId === u && String(r.title).startsWith(title));
const bypassed = (u: number) => DB.created.filter((r) => r.userId === u && (r.metadata as { safetyCritical?: boolean } | undefined)?.safetyCritical === true);

describe("doc 81 Đợt 8 final wave F1 — B3 STOP-unverified alarm exempt from the per-recipient cap", () => {
  it("★ cap exhausted by trips ⇒ the STOP-unverified alarm STILL bypasses (opted-out recipient receives it)", async () => {
    await trips(5, 20, "a");
    expect(bypassed(5)).toHaveLength(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN); // budget gone
    await stopUnverified(5, 101);
    const alarm = stored(5, "STOP not confirmed");
    expect(alarm).toHaveLength(1);
    expect((alarm[0].metadata as { safetyCritical?: boolean }).safetyCritical).toBe(true);
  });

  it("the alarm is not CHARGED to the cap: after several alarms the trips still get their full budget", async () => {
    for (let s = 1; s <= SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN + 2; s++) await stopUnverified(5, s);
    expect(stored(5, "STOP not confirmed")).toHaveLength(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN + 2);
    await trips(5, SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN, "b");
    expect(stored(5, "Safety event")).toHaveLength(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN);
  });

  it("still deduped per OCCURRENCE: the same STOP's alarm twice inside 60 s ⇒ second is a normal notice (opted out ⇒ not stored)", async () => {
    await stopUnverified(5, 7);
    await stopUnverified(5, 7);
    expect(stored(5, "STOP not confirmed")).toHaveLength(1);
  });

  it("only the exact literal exempts: any other value ⇒ the cap applies", async () => {
    await trips(5, SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN, "c");
    await stopUnverified(5, 201, "OT_STOP_UNVERIFIED");
    await stopUnverified(5, 202, true);
    await stopUnverified(5, 203, null);
    expect(stored(5, "STOP not confirmed")).toHaveLength(0);
  });

  it("the exemption does not grant a bypass by itself (safetyCritical must still be exactly true)", async () => {
    await sendNotification(5, { type: "ALERT", title: "STOP not confirmed — x", message: "m", priority: "URGENT" }, { capExempt: "ot_stop_unverified" });
    expect(stored(5, "STOP not confirmed")).toHaveLength(0);
  });
});
