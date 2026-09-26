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
