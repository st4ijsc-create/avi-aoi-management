/**
 * doc 81 Đợt 1B Task 5 fix round 5 (item 3) — who may see an ENABLED "clear motion lock" button.
 *
 * `robot.clearMotionLock` is `actuationProcedure` (role floor admin/supervisor/engineer) +
 * `machine_control/canEdit`. The page must gate the button on BOTH, so a user who would only get
 * FORBIDDEN never sees it enabled. Pure function so it can be unit-tested without React.
 */
import { isActuationRole } from "./actuationRoles";

export function canClearMotionLock(role: string | null | undefined, canEditMachineControl: boolean): boolean {
  return canEditMachineControl && isActuationRole(role);
}

// ── doc 81 Đợt 12 task N fix 1 (review M-3 / M-4) — what the robot panel says about a motion lock ──────────────────────────
/** The lock as robot.list / robot.get `live.motionLock` carries it (`persisted`: held only in the DB — no live lock here). */
export type PanelMotionLock = { locked: boolean; reasonCode?: string; persisted?: boolean } | null | undefined;
type Text = { key: string; defaultValue: string };

/**
 * M-4 — the translated reason of a lock, or null (the raw code is shown). The DB's `ownerChanged` relock text says "until a
 * confirmed STOP": wrong for a lock held only in the DB (an inactive robot, a driver with no motion lock) — there only the
 * audited clear with a reason removes it.
 */
export function motionLockReasonText(lock: PanelMotionLock): Text | null {
  if (!lock) return null;
  if (lock.reasonCode === "persistUnknown") {
    return { key: "robot.motionLock.reason.persistUnknown", defaultValue: "không đọc được khoá đã lưu lúc khởi động (CSDL không trả lời) — khoá để an toàn" };
  }
  if (lock.reasonCode === "ownerChanged") {
    return lock.persisted
      ? { key: "robot.motionLock.reason.ownerChangedPersisted", defaultValue: "đổi quyền sở hữu (trả về từ nút biên) — lệnh DỪNG không gỡ được; chỉ thao tác gỡ khoá có kiểm soát, có lý do, mới gỡ" }
      : { key: "robot.motionLock.reason.ownerChanged", defaultValue: "đổi quyền sở hữu (trả về từ nút biên) — một lệnh DỪNG được robot xác nhận hoặc thao tác gỡ khoá có kiểm soát sẽ gỡ" };
  }
  return null;
}

/** M-4 — the badge's explanation: a lock held only in the DB never claims that a STOP clears it. */
export function motionLockTipText(lock: PanelMotionLock): Text {
  return lock?.persisted
    ? { key: "robot.motionLock.tipPersisted", defaultValue: "Chuyển động bị khoá ({{reason}}, từ {{since}}). Khoá này được lưu trong CSDL: lệnh DỪNG không gỡ nó; chỉ thao tác gỡ khoá có kiểm soát (có lý do, ghi kiểm toán) mới mở lại." }
    : { key: "robot.motionLock.tip", defaultValue: "Chuyển động bị khoá sau khi mất kết nối / kết cục lệnh không rõ ({{reason}}, từ {{since}}). Chỉ một lệnh DỪNG được robot xác nhận hoặc thao tác gỡ khoá có kiểm soát mới mở lại." };
}

/** M-3 — why the clear cannot act yet (the robot is not loaded by this process's gateway: it is retried), or null. */
export function motionLockClearBlocked(live: { active: boolean; motionLock: PanelMotionLock } | null | undefined): Text | null {
  if (!live?.motionLock?.locked || live.active) return null;
  return { key: "robot.motionLock.inactiveCannotClear", defaultValue: "Robot chưa được cổng robot nạp (không kết nối được — hệ thống tự thử lại), nên chưa gỡ khoá được; gỡ được ngay khi robot được nạp." };
}
