/**
 * ★ F4 phần 2 (2026-09-23) — logic THUẦN cho khối "Vì sao model đề xuất" cạnh thẻ duyệt diff.
 *
 * Người duyệt diff thấy CÁI GÌ đổi nhưng không thấy VÌ SAO. Model biết nghĩ (Qwen3.6) đã viết lý do trong
 * `reasoning_content` của đúng lượt đề xuất — ta chụp chuỗi đó lúc sự kiện `pending_action` tới và hiện ĐẦU (kế hoạch)
 * + ĐUÔI (kết luận) của nó. Chỉ để ĐỌC: HITL không đổi, thẻ duyệt không đổi, không byte nào quay lại server.
 *
 * ⚠ Chụp gắn với `actionId`: nếu người dùng gửi lượt mới trong lúc thẻ còn chờ, chuỗi nghĩ đang chảy là của lượt MỚI —
 * hiện nó cạnh thẻ CŨ là gán lý do sai cho một diff. `lyDoChoThe` chỉ trả lý do khi khoá trùng thẻ đang hiện.
 */
import { tomTatNghi } from "./bangDangNghiLogic";

export const MAX_KY_TU_LY_DO = 900;

export interface LyDoDuyet {
  readonly actionId: string;
  /** Trích đã cắt gọn để hiện (nguyên văn nếu ngắn; ĐẦU + "…" + ĐUÔI nếu dài). */
  readonly duoi: string;
  /** Tổng ký tự suy luận THẬT của lượt (không phải phần hiện). */
  readonly soKyTu: number;
  readonly biCat: boolean;
}

/** Bỏ thẻ `<think>`/`</think>` sót lại (vài template phát chúng vào reasoning_content). */
function boTheNghi(s: string): string {
  return s.replace(/<\/?think>/gi, "").trim();
}

/** Phần ĐẦU giữ khi phải cắt: đo live 2026-09-23 (`tmp/audit-ai/f4-live.mjs`) — đầu chuỗi nghĩ là chỗ model nêu
 *  HIỂU YÊU CẦU + KẾ HOẠCH ("The user wants to change X… I need to find the line…"), còn đuôi là tự kiểm và câu đệm
 *  ("All good. Done. [Done]"). Chỉ hiện đuôi (cách của bảng F1 lúc ĐANG nghĩ) làm mất đúng phần trả lời "vì sao". */
export const PHAN_DAU = 0.45;

/**
 * Chụp lý do cho một thẻ duyệt. `null` khi không có gì đáng hiện (model không nghĩ, hoặc chỉ khoảng trắng) —
 * khi đó UI KHÔNG vẽ khối rỗng. Dài quá `maxKyTu` ⇒ ĐẦU (kế hoạch) + "…" + ĐUÔI (kết luận), cắt ở ranh giới dòng khi gần.
 */
export function chupLyDoDuyet(actionId: string, reasoning: unknown, maxKyTu: number = MAX_KY_TU_LY_DO): LyDoDuyet | null {
  if (typeof actionId !== "string" || !actionId) return null;
  const sach = boTheNghi(typeof reasoning === "string" ? reasoning : "");
  if (!sach) return null;
  const max = Number.isFinite(maxKyTu) && maxKyTu > 0 ? Math.floor(maxKyTu) : MAX_KY_TU_LY_DO;
  if (sach.length <= max) return { actionId, duoi: sach, soKyTu: sach.length, biCat: false };
  const nDau = Math.floor(max * PHAN_DAU);
  let dau = sach.slice(0, nDau);
  const nlDau = dau.lastIndexOf("\n");
  if (nlDau > nDau * 0.75) dau = dau.slice(0, nlDau);
  let cuoi = tomTatNghi(sach, max - nDau).duoi.slice(1);
  const nlCuoi = cuoi.indexOf("\n");
  if (nlCuoi >= 0 && nlCuoi < cuoi.length / 4) cuoi = cuoi.slice(nlCuoi + 1);
  return { actionId, duoi: `${dau.trimEnd()}\n…\n${cuoi.trimStart()}`, soKyTu: sach.length, biCat: true };
}

/** Lý do chỉ thuộc về đúng thẻ nó được chụp cho. */
export function lyDoChoThe(lyDo: LyDoDuyet | null, actionIdDangHien: string | null | undefined): LyDoDuyet | null {
  if (!lyDo || !actionIdDangHien) return null;
  return lyDo.actionId === actionIdDangHien ? lyDo : null;
}
