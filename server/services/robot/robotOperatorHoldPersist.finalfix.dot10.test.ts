/**
 * doc 81 Đợt 10 final fix wave — security scan on robotDriver.ts ("fail-open-state-drift", M-5 follow-up). The rule: the PERSISTED
 * lock is never less restrictive than the in-memory one, and the in-memory lock only becomes less restrictive through a clear.
 * Found: an operator lock taken on top of an existing lock set `operatorHold` in MEMORY only — the persisted row kept the first
 * cause, so after a restart (restore from the row) a confirmed STOP cleared what the operator was holding.
 * Now the upgrade is a NEW lock generation with the operator reason (the first cause listed in its detail) and it is PERSISTED
 * (the `locked` hook fires); restored from that row it is an operator hold again. A plain repeated lock() still keeps the first
 * cause without a write; a restore never unlocks / overrides a lock already set (the boot persistUnknown seed stands).
 */
import { describe, expect, it } from "vitest";
import { MotionLock, OPERATOR_MOTION_LOCK_REASON_CODE, type MotionLockState } from "./robotDriver";

function recorded() {
  const l = new MotionLock();
  const writes: Array<{ kind: "locked" | "cleared"; s: MotionLockState }> = [];
  l.attachPersistence({ locked: (s) => void writes.push({ kind: "locked", s }), cleared: (s) => void writes.push({ kind: "cleared", s }) });
  return { l, writes };
}

describe("operator hold on top of a lock is PERSISTED (no memory / row drift)", () => {
  it("★ the upgrade is written as a new generation with the operator reason; restored from it, a confirmed STOP does not clear it", () => {
    const { l, writes } = recorded();
    l.lock("line_connection_closed", "socket reset");
    l.lock(OPERATOR_MOTION_LOCK_REASON_CODE, "hold for inspection");
    expect(writes.map((w) => [w.kind, w.s.reasonCode, w.s.generation])).toEqual([
      ["locked", "line_connection_closed", 1],
      ["locked", OPERATOR_MOTION_LOCK_REASON_CODE, 2],
    ]);
    expect(writes[1].s.detail).toMatch(/line_connection_closed/); // the first cause is not lost
    // RESTART from the persisted (last written) row
    const after = new MotionLock();
    after.restore({ reasonCode: writes[1].s.reasonCode!, detail: writes[1].s.detail ?? null, since: writes[1].s.since!, generation: writes[1].s.generation! });
    after.clearByStop();
    expect(after.isLocked()).toBe(true);
  });

  it("unchanged: a repeated non-operator lock() keeps the first cause and writes nothing; a second operator lock is a no-op", () => {
    const { l, writes } = recorded();
    l.lock("a");
    l.lock("b");
    expect(writes).toHaveLength(1);
    l.lock(OPERATOR_MOTION_LOCK_REASON_CODE, "x");
    l.lock(OPERATOR_MOTION_LOCK_REASON_CODE, "y");
    expect(writes).toHaveLength(2);
  });

  it("★ a restore never unlocks or overrides a lock already set (the boot persistUnknown seed stands)", () => {
    const l = new MotionLock();
    l.lock("persistUnknown", "boot");
    l.restore({ reasonCode: "line_connection_closed", detail: null, since: new Date().toISOString(), generation: 9 });
    expect(l.snapshot()).toMatchObject({ locked: true, reasonCode: "persistUnknown" });
  });
});
