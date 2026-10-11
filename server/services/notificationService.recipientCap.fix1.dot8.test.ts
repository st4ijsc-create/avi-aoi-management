/**
 * doc 81 Đợt 8 task N fix 1 (owner decision I1, item 4) — a GLOBAL per-recipient cap on opt-out-bypassing notices across
 * all sources: ≤ SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN per recipient per minute; beyond it a notice is DOWNGRADED (normal
 * delivery, preferences apply), never dropped. Oracle: the fake `../db` records every createNotification; recipient 5 has
 * opted out of everything, recipient 6 has no preferences.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const DB = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>>, prefReads: [] as number[] }));
vi.mock("../db", () => ({
  createNotification: vi.fn(async (row: Record<string, unknown>) => {
    DB.created.push(row);
    return { id: DB.created.length };
  }),
  broadcastNotification: vi.fn(),
  getUserNotificationPreferences: vi.fn(async (userId: number) => {
    DB.prefReads.push(userId);
    return userId === 5
      ? { inAppEnabled: false, inAppAlerts: false, inAppReports: false, inAppSystem: false, quietHoursEnabled: true, quietHoursStart: "00:00", quietHoursEnd: "00:00" }
      : null;
  }),
  getUnreadNotificationCount: vi.fn(async () => 0),
}));

import {
  sendSystemNotification,
  _resetSafetyCriticalDedupForTests,
  _safetyCriticalRecipientMapSizeForTests,
  SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN,
  SAFETY_CRITICAL_RECIPIENT_WINDOW_MS,
} from "./notificationService";

beforeEach(() => {
  _resetSafetyCriticalDedupForTests();
  DB.created.length = 0;
  DB.prefReads.length = 0;
  vi.useRealTimers();
});

/** n distinct occurrences on n distinct machines (no dedup / P-F4 key repeats). */
async function burst(userId: number, n: number, tag = "m") {
  for (let i = 0; i < n; i++) {
    await sendSystemNotification(userId, { title: "Safety event", message: `estop at ${tag}${i}`, priority: "HIGH" }, {
      safetyCritical: true,
      dedupKey: `safety:estop:${tag}${i}:${i}`,
      rateKey: `safety:estop:${tag}${i}`,
    });
  }
}
const bypassed = (u: number) => DB.created.filter((r) => r.userId === u && (r.metadata as { safetyCritical?: boolean } | undefined)?.safetyCritical === true).length;

describe("doc 81 Đợt 8 N fix 1 — per-recipient cap on opt-out bypasses", () => {
  it("named constant: 6 per 60 s", () => {
    expect(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN).toBe(6);
    expect(SAFETY_CRITICAL_RECIPIENT_WINDOW_MS).toBe(60_000);
  });

  it("★ 20 distinct machines in a burst ⇒ the opted-out recipient gets exactly 6 (bypass); the rest are downgraded, not dropped", async () => {
    await burst(5, 20);
    await burst(6, 20);
    expect(bypassed(5)).toBe(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN);
    expect(DB.created.filter((r) => r.userId === 5)).toHaveLength(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN); // downgraded ⇒ their opt-out applies
    expect(DB.prefReads.filter((u) => u === 5)).toHaveLength(20 - SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN);
    expect(DB.created.filter((r) => r.userId === 6)).toHaveLength(20); // never dropped
    expect(bypassed(6)).toBe(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN);
  });

  it("the cap is PER recipient (one recipient's burst does not spend another's budget)", async () => {
    await burst(5, 10);
    await burst(7, 1);
    expect(bypassed(7)).toBe(1);
  });

  it("the cap covers notices WITHOUT keys too (e.g. any caller that sends safetyCritical alone)", async () => {
    for (let i = 0; i < 10; i++) await sendSystemNotification(5, { title: "STOP not confirmed", message: `m${i}`, priority: "URGENT" }, { safetyCritical: true });
    expect(bypassed(5)).toBe(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN);
  });

  it("a capped notice consumes no dedup / rate slot: after the window the SAME occurrence key may bypass", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T08:00:00Z"));
    await burst(5, SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN, "a");
    await sendSystemNotification(5, { title: "x", message: "late", priority: "HIGH" }, { safetyCritical: true, dedupKey: "late:1", rateKey: "late" });
    expect(bypassed(5)).toBe(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN);
    vi.setSystemTime(new Date(Date.now() + SAFETY_CRITICAL_RECIPIENT_WINDOW_MS + 1));
    await sendSystemNotification(5, { title: "x", message: "late", priority: "HIGH" }, { safetyCritical: true, dedupKey: "late:1", rateKey: "late" });
    expect(bypassed(5)).toBe(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN + 1);
  });

  it("a capped notice does not spend the P-F4 rate slot: budget back 6 s later ⇒ the next occurrence of that (type, machine) bypasses", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-11T10:00:00Z").getTime();
    vi.setSystemTime(new Date(t0 - 55_000));
    await burst(5, SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN, "e"); // budget spent at t0-55 s (returns at t0+5 s)
    vi.setSystemTime(new Date(t0));
    await sendSystemNotification(5, { title: "x", message: "r1", priority: "HIGH" }, { safetyCritical: true, dedupKey: "safety:estop:robot:9:1", rateKey: "safety:estop:robot:9" });
    expect(bypassed(5)).toBe(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN); // capped ⇒ downgraded
    vi.setSystemTime(new Date(t0 + 6_000)); // budget back; still inside the 10 s rate window of robot 9
    await sendSystemNotification(5, { title: "x", message: "r2", priority: "HIGH" }, { safetyCritical: true, dedupKey: "safety:estop:robot:9:2", rateKey: "safety:estop:robot:9" });
    expect(bypassed(5)).toBe(SAFETY_CRITICAL_RECIPIENT_MAX_PER_MIN + 1);
  });

  it("the window slides: budget comes back after 60 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T09:00:00Z"));
    await burst(5, 10, "b");
    expect(bypassed(5)).toBe(6);
    vi.setSystemTime(new Date(Date.now() + SAFETY_CRITICAL_RECIPIENT_WINDOW_MS - 1));
    await burst(5, 2, "c");
    expect(bypassed(5)).toBe(6);
    vi.setSystemTime(new Date(Date.now() + 2));
    await burst(5, 2, "d");
    expect(bypassed(5)).toBe(8);
  });

  it("bounded: 6 000 distinct recipients ⇒ the map is swept / cleared, never above the bound", async () => {
    for (let u = 1000; u < 7000; u++) {
      await sendSystemNotification(u, { title: "x", message: "y", priority: "HIGH" }, { safetyCritical: true });
    }
    expect(_safetyCriticalRecipientMapSizeForTests()).toBeLessThanOrEqual(5001);
  });
});
