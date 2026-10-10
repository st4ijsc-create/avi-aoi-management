/**
 * doc 81 Đợt 4 Task D1 fix 1 (#7) — khoá kho cục bộ của sở thích "Hiện Labs", MỘT định nghĩa cho cả hook (`useShowLabs`) lẫn
 * bộ đồng bộ (`uiPrefsSync` ánh xạ `showLabs` ⇄ khoá này). Trước: bộ đồng bộ tự dựng lại định dạng bằng tay.
 * File thuần (không hook) để `uiPrefsSync` import mà không vòng import với `useShowLabs`.
 */
import { userLayoutKey } from "@/components/patterns/layoutKitHooks";
import { SHOW_LABS_LAYOUT_ID, SHOW_LABS_PART } from "@shared/uiPrefs";

/** Khoá kho của sở thích Labs (null khi chưa biết người dùng). */
export function showLabsKey(userId: number | string | null | undefined): string | null {
  return userLayoutKey(SHOW_LABS_LAYOUT_ID, userId, SHOW_LABS_PART);
}
