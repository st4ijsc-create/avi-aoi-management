/**
 * doc 81 Đợt 1C Task 2 — câu hiển thị cho MỘT mục recipe set bị cổng phát hành chặt từ chối khi
 * phân phối (`lineController.recipeSet.distribute` / REST `POST /v1/lines/:id/recipe`).
 *
 * Server trả mỗi mục `{ status:'failed', error, reason?, hint?, currentVersion? }`
 * (server/services/lineController/recipeSetService.ts `DistributeItemResult`):
 *   • `reason` = khoá `errors.reason.*` của cổng (recipeNotApproved · recipeArchived ·
 *     recipeRetired · recipeMachineTypeMismatch) — dịch bằng CHÍNH từ điển mà toast lỗi
 *     deploy/changeover dùng, không có bản thứ hai;
 *   • `hint = 'updateSetToCurrentVersion'` + `currentVersion` khi phiên bản ghim đã bị THAY ⇒
 *     gợi ý "cập nhật set sang phiên bản hiện hành vN".
 * Tra khoá qua `translateClientKey` (kỷ luật chống-F8: không rơi sang câu tiếng Việt cho en/zh).
 * Chuỗi fallback bằng tiếng Anh máy chủ, đúng nấc cuối của errorCodes.ts.
 */
import { translateClientKey } from "@/lib/errorCodes";

/** Mirror `DistributeItemResult` (server) — chỉ các field câu hiển thị cần. */
export interface RecipeSetItemResultView {
  machineId: number;
  machineCode: string | null;
  recipeCode: string;
  recipeVersion: number;
  status: "already_active" | "deployed" | "failed";
  error?: string;
  reason?: string;
  hint?: "updateSetToCurrentVersion";
  currentVersion?: number;
}

export interface RecipeSetItemRefusalText {
  /** "<máy> · <mã> vN: bị từ chối — <lý do đã dịch>" */
  text: string;
  /** Gợi ý cập nhật set sang phiên bản hiện hành; null khi không áp dụng. */
  hint: string | null;
}

/** null cho mục không bị từ chối (already_active / deployed). */
export function describeRecipeSetItemRefusal(item: RecipeSetItemResultView): RecipeSetItemRefusalText | null {
  if (item.status !== "failed") return null;
  const raw = item.error?.trim() || item.reason || "failed";
  const reason = item.reason ? translateClientKey(`errors.reason.${item.reason}`, raw) : raw;
  const machine = item.machineCode ?? `#${item.machineId}`;
  const text = translateClientKey(
    "lineView.recipeSet.itemRefused",
    `${machine} · ${item.recipeCode} v${item.recipeVersion}: refused — ${reason}`,
    { machine, recipe: item.recipeCode, version: item.recipeVersion, reason },
  );
  const hint =
    item.hint === "updateSetToCurrentVersion" && typeof item.currentVersion === "number"
      ? translateClientKey(
          "lineView.recipeSet.hintUpdateToCurrent",
          `Update the set to the current version v${item.currentVersion}.`,
          { version: item.currentVersion },
        )
      : null;
  return { text, hint };
}
