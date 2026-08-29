/**
 * Đọc đề xuất GHI từ một khung SSE.
 *
 * ⚠ Payload LỒNG dưới `pendingAction` (`aiLocalKnowledgeApi.ts:582-585`) — đọc phẳng sẽ luôn ra
 * `undefined` và thẻ duyệt sẽ KHÔNG BAO GIỜ hiện, im lặng. Đợt A đã dính lớp lỗi này bốn lần.
 * Trả `null` thay vì đoán: một đề xuất đọc sai còn tệ hơn không đọc được, vì nó dẫn tới ghi nhầm.
 */
export interface DeXuatGhi {
  actionId: string; token: string; tool: string;
  path: string; original: string; modified: string;
  summary: string; hetHan: string;
}

export function docDeXuatGhi(sk: Record<string, unknown>): DeXuatGhi | null {
  if (sk?.type !== "pending_action") return null;
  const pa = sk.pendingAction as Record<string, unknown> | undefined;
  if (!pa || typeof pa !== "object") return null;
  if (pa.tool !== "apply_diff") return null; // Đợt B chỉ xử lý sửa tệp
  const args = pa.args as Record<string, unknown> | undefined;
  const lay = (o: Record<string, unknown> | undefined, k: string): string | null =>
    o && typeof o[k] === "string" ? (o[k] as string) : null;
  const actionId = lay(pa, "actionId"), token = lay(pa, "token");
  const path = lay(args, "path"), original = lay(args, "original"), modified = lay(args, "modified");
  if (!actionId || !token || !path || original === null || modified === null) return null;
  return {
    actionId, token, tool: "apply_diff", path, original, modified,
    summary: lay(pa, "summary") ?? "", hetHan: lay(pa, "expiresAt") ?? "",
  };
}
