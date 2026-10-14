/**
 * doc 81 Đợt 12 task N fix 1 (review M-3 / M-4) — what the robot panel SAYS about a motion lock.
 *   • M-4: the DB's `ownerChanged` relock text said "locked until a confirmed STOP" — wrong for a lock held only in the database
 *     (`persisted`: an inactive robot here, or a driver with no motion lock): a STOP does not clear it, only the audited clear
 *     with a reason does. The panel now explains each case in vi / en / zh (keys), never the raw English DB text.
 *   • M-3: an INACTIVE robot's lock is shown, and the clear button says why it cannot act yet (not loaded by the gateway — it is
 *     retried) instead of an enabled button that ends in robotNotActive.
 */
import { describe, it, expect } from "vitest";
import { motionLockClearBlocked, motionLockReasonText, motionLockTipText } from "./robotMotionLock";

describe("motionLockReasonText — the reason of a lock, translated (M-4)", () => {
  it("ownerChanged held only in the DB ⇒ 'only the audited clear' (a STOP does not clear it)", () => {
    expect(motionLockReasonText({ locked: true, reasonCode: "ownerChanged", persisted: true })).toMatchObject({ key: "robot.motionLock.reason.ownerChangedPersisted" });
    expect(motionLockReasonText({ locked: true, reasonCode: "ownerChanged", persisted: true })!.defaultValue).not.toMatch(/DỪNG được xác nhận/);
  });
  it("ownerChanged on a LIVE lock ⇒ 'a confirmed STOP or the audited clear'", () => {
    expect(motionLockReasonText({ locked: true, reasonCode: "ownerChanged" })).toMatchObject({ key: "robot.motionLock.reason.ownerChanged" });
  });
  it("persistUnknown keeps its key; any other code ⇒ null (shown as is)", () => {
    expect(motionLockReasonText({ locked: true, reasonCode: "persistUnknown" })).toMatchObject({ key: "robot.motionLock.reason.persistUnknown" });
    expect(motionLockReasonText({ locked: true, reasonCode: "line_connection_closed" })).toBeNull();
    expect(motionLockReasonText(null)).toBeNull();
  });
});

describe("motionLockTipText — the badge's explanation (M-4)", () => {
  it("a persisted lock never claims that a STOP clears it", () => {
    expect(motionLockTipText({ locked: true, reasonCode: "ownerChanged", persisted: true }).key).toBe("robot.motionLock.tipPersisted");
    expect(motionLockTipText({ locked: true, reasonCode: "line_connection_closed" }).key).toBe("robot.motionLock.tip");
  });
});

describe("motionLockClearBlocked — why the clear cannot act yet (M-3)", () => {
  it("locked + inactive ⇒ blocked 'notActive' (with its own text); locked + active ⇒ not blocked; unlocked ⇒ not blocked", () => {
    expect(motionLockClearBlocked({ active: false, motionLock: { locked: true, persisted: true } })).toMatchObject({ key: "robot.motionLock.inactiveCannotClear" });
    expect(motionLockClearBlocked({ active: true, motionLock: { locked: true, persisted: true } })).toBeNull();
    expect(motionLockClearBlocked({ active: false, motionLock: null })).toBeNull();
    expect(motionLockClearBlocked(undefined)).toBeNull();
  });
});
