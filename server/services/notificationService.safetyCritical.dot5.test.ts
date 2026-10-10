/**
 * doc 81 Đợt 5 task F6 (item 33) — a SAFETY-CRITICAL class for sendNotification: delivered whatever the recipient's
 * in-app opt-outs (inAppEnabled / inAppAlerts / inAppSystem / inAppReports) and quiet hours say — quiet hours already let
 * URGENT through; a safety notice must not depend on a personal preference. Only server code can request it: the class is
 * a separate OPTIONS argument, never read from the payload (a payload / metadata claiming it changes nothing).
 * Oracle: the fake `../db` records every createNotification call; preferences are fixed objects.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const DB = vi.hoisted(() => ({
  prefs: null as Record<string, unknown> | null,
  created: [] as Array<Record<string, unknown>>,
  prefReads: 0,
  prefsThrow: false,
}));
vi.mock("../db", () => ({
  createNotification: vi.fn(async (row: Record<string, unknown>) => {
    DB.created.push(row);
    return { id: DB.created.length };
  }),
  broadcastNotification: vi.fn(),
  getUserNotificationPreferences: vi.fn(async () => {
    DB.prefReads++;
    if (DB.prefsThrow) throw new Error("db down");
    return DB.prefs;
  }),
  getUnreadNotificationCount: vi.fn(async () => 0),
}));

import { sendNotification, sendSystemNotification, _resetSafetyCriticalDedupForTests, SAFETY_CRITICAL_DEDUP_MS } from "./notificationService";

const optedOutEverywhere = {
  inAppEnabled: false,
  inAppAlerts: false,
  inAppReports: false,
  inAppSystem: false,
  quietHoursEnabled: true,
  quietHoursStart: "00:00", // overnight range 00:00 → 00:00 ⇒ ALWAYS quiet
  quietHoursEnd: "00:00",
};
const alert = { type: "ALERT" as const, title: "STOP not confirmed", message: "check the machine", priority: "URGENT" as const };

beforeEach(() => {
  _resetSafetyCriticalDedupForTests();
  DB.prefs = null;
  DB.created.length = 0;
  DB.prefReads = 0;
  DB.prefsThrow = false;
});

describe("Đợt 5 F6 — sendNotification safety-critical class", () => {
  it("control: a NORMAL notice respects the opt-outs (in-app off ⇒ null, nothing stored)", async () => {
    DB.prefs = { ...optedOutEverywhere, quietHoursEnabled: false };
    expect(await sendNotification(7, alert)).toBeNull();
    DB.prefs = { inAppEnabled: true, inAppAlerts: false, inAppSystem: true, quietHoursEnabled: false };
    expect(await sendNotification(7, alert)).toBeNull();
    DB.prefs = { inAppEnabled: true, inAppAlerts: true, inAppSystem: true, quietHoursEnabled: true, quietHoursStart: "00:00", quietHoursEnd: "00:00" };
    expect(await sendNotification(7, { ...alert, priority: "HIGH" })).toBeNull(); // quiet hours: only URGENT
    expect(DB.created).toHaveLength(0);
  });

  it("★ safety-critical ⇒ delivered although in-app is OFF, alerts are OFF and quiet hours are on (any priority)", async () => {
    DB.prefs = optedOutEverywhere;
    const r = await sendNotification(7, { ...alert, priority: "HIGH" }, { safetyCritical: true });
    expect(r).toEqual({ id: 1 });
    expect(DB.created).toHaveLength(1);
    expect(DB.created[0]).toMatchObject({ userId: 7, type: "ALERT", title: "STOP not confirmed", priority: "HIGH" });
    expect(DB.created[0].metadata).toMatchObject({ safetyCritical: true });
  });

  it("safety-critical does not even read the preferences (a preference read failure cannot drop it)", async () => {
    DB.prefsThrow = true;
    await expect(sendNotification(7, alert)).rejects.toThrow(/db down/); // control: a normal notice reads them
    DB.prefReads = 0;
    await expect(sendNotification(7, alert, { safetyCritical: true })).resolves.toEqual({ id: 1 });
    expect(DB.prefReads).toBe(0);
  });

  it("★ the class comes ONLY from the options argument: a payload/metadata claiming it is ignored", async () => {
    DB.prefs = { ...optedOutEverywhere, quietHoursEnabled: false };
    const spoof = { ...alert, safetyCritical: true, metadata: { safetyCritical: true } } as unknown as Parameters<typeof sendNotification>[1];
    expect(await sendNotification(7, spoof)).toBeNull();
    expect(await sendNotification(7, alert, { safetyCritical: "yes" } as unknown as { safetyCritical: boolean })).toBeNull();
    expect(DB.created).toHaveLength(0);
    // delivered normally (no opt-out): the stored marker is stripped — only the server option writes it
    DB.prefs = null;
    await sendNotification(7, { ...alert, metadata: { safetyCritical: true, x: 1 } });
    expect(DB.created[0].metadata).toEqual({ x: 1 });
  });

  it("existing metadata is kept next to the safety-critical marker", async () => {
    await sendNotification(7, { ...alert, metadata: { reason: "drift" } }, { safetyCritical: true });
    expect(DB.created[0].metadata).toEqual({ reason: "drift", safetyCritical: true });
  });

  it("sendSystemNotification passes the class through (inAppSystem OFF ⇒ still delivered when safety-critical)", async () => {
    DB.prefs = { inAppEnabled: true, inAppAlerts: true, inAppSystem: false, quietHoursEnabled: false };
    expect(await sendSystemNotification(9, { title: "Safety event", message: "x", priority: "HIGH" })).toBeNull();
    expect(await sendSystemNotification(9, { title: "Safety event", message: "x", priority: "HIGH" }, { safetyCritical: true })).toEqual({ id: 1 });
  });
});

// doc 81 Đợt 5 task F fix 1 (R-5-f) — the opt-out BYPASS is throttled per recipient and (type, machine) key: 60 s.
describe("Đợt 5 F6 fix 1 — safety-critical bypass dedup throttle (60 s per recipient × key)", () => {
  const opted = { ...optedOutEverywhere, quietHoursEnabled: false };
  const sc = (key: string) => ({ safetyCritical: true, dedupKey: key });

  it("window is 60 s", () => {
    expect(SAFETY_CRITICAL_DEDUP_MS).toBe(60_000);
  });

  it("★ a repeat with the same key inside 60 s is a NORMAL notice (the opt-out applies again); after 60 s it bypasses again", async () => {
    DB.prefs = opted;
    let now = 1_800_000_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      expect(await sendNotification(7, alert, sc("safety:estop:robot:3"))).toEqual({ id: 1 });
      now += 30_000;
      expect(await sendNotification(7, alert, sc("safety:estop:robot:3"))).toBeNull(); // throttled ⇒ opted out ⇒ dropped
      now += SAFETY_CRITICAL_DEDUP_MS - 30_000 - 1;
      expect(await sendNotification(7, alert, sc("safety:estop:robot:3"))).toBeNull(); // still inside 60 s
      now += 1;
      expect(await sendNotification(7, alert, sc("safety:estop:robot:3"))).toEqual({ id: 2 }); // 60 s after the bypass
    } finally {
      spy.mockRestore();
    }
    expect(DB.created).toHaveLength(2);
  });

  it("the throttle is per recipient and per (type, machine): another user / machine / type still bypasses", async () => {
    DB.prefs = opted;
    expect(await sendNotification(7, alert, sc("safety:estop:robot:3"))).not.toBeNull();
    expect(await sendNotification(8, alert, sc("safety:estop:robot:3"))).not.toBeNull(); // other recipient
    expect(await sendNotification(7, alert, sc("safety:estop:robot:4"))).not.toBeNull(); // other machine
    expect(await sendNotification(7, alert, sc("safety:zone_intrusion:robot:3"))).not.toBeNull(); // other type
    expect(await sendNotification(7, alert, sc("safety:estop:robot:3"))).toBeNull(); // the repeat
    expect(DB.created).toHaveLength(4);
  });

  it("a throttled repeat still reaches a recipient who did NOT opt out (normal path), without the safety marker", async () => {
    DB.prefs = null;
    await sendNotification(7, alert, sc("k"));
    await sendNotification(7, alert, sc("k"));
    expect(DB.created).toHaveLength(2);
    expect(DB.created[0].metadata).toMatchObject({ safetyCritical: true });
    expect(DB.created[1].metadata).toBeUndefined();
  });
});
