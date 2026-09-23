/**
 * ★ F3 phần 2 (2026-09-23) — chế độ **"Nghĩ sâu"**: ngân sách nghĩ THEO YÊU CẦU + trần sinh rộng hơn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TRƯỚC ĐÂY "BỊ CHẶN", VÀ VÌ SAO GIỜ KHÔNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Kết luận cũ: *"b9814 bỏ qua `reasoning_budget` theo yêu cầu"* ⇒ nút "sâu" không thể có nghĩa riêng
 * (ngân sách 12.000 là cờ `--reasoning-budget` của TIẾN TRÌNH). Kết luận ấy đúng với TÊN TRƯỜNG đã thử,
 * sai về khả năng. Đọc nguồn llama.cpp b9814 (`tools/server/server-common.cpp` ~dòng 1119):
 *
 *     int reasoning_budget = json_value(body, "thinking_budget_tokens", -1);
 *     if (reasoning_budget == -1) reasoning_budget = opt.reasoning_budget;
 *
 * rồi `server-schema.cpp` đưa `reasoning_budget_tokens` vào `params.sampling` của TỪNG lượt. Bản b9982
 * chỉ thêm bí danh `reasoning_budget_tokens`. Đo sống trên `:8091` (b9814, cùng prompt, 2026-09-23):
 *
 *     thinking_budget_tokens: 200   ⇒ reasoning   550 ký tự   (bị cắt đúng ngân sách)
 *     reasoning_budget_tokens: 200  ⇒ reasoning 6.984 ký tự   (bị bỏ qua IM LẶNG — tên sai)
 *     (không gửi, mặc định 12.000)  ⇒ reasoning 8.781 ký tự
 *
 * ⇒ Tên đúng là `thinking_budget_tokens`. Gửi tên kia là dựng một cờ vô hiệu — đúng lớp lỗi mà
 *   `lapCoTatSuyLuan` đã ghi lại cho `enable_thinking` top-level.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HAI CON SỐ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • Ngân sách nghĩ 24.000 = gấp đôi mặc định 12.000 (B4: 12k cho G5‑D 0/12 ở chế độ cân bằng).
 *   • Trần sinh 32.000 = ngân sách + ~8k cho mã/diff; vẫn bị `tranTokenSinhMa` kẹp theo ctx/slot − prompt
 *     (ctx 64k ⇒ còn chỗ). Cân bằng giữ 16.000 như cũ — chế độ mặc định KHÔNG đổi một byte.
 *
 * Module THUẦN: không I/O, không env. Mọi nhánh có lưới.
 */
import { luotDuocNghi, type CheDoNghi, type LoaiLuot } from "./loaiLuot";

/** Tên trường llama-server ĐỌC theo yêu cầu (đã xác minh bằng nguồn + đo sống; xem đầu tệp). */
export const TRUONG_NGAN_SACH_NGHI = "thinking_budget_tokens";

export const NGAN_SACH_NGHI_SAU = 24_000;
export const TRAN_SINH_NGHI_SAU = 32_000;

/**
 * Ngân sách nghĩ gửi kèm lượt, hoặc `undefined` ⇒ KHÔNG gửi trường (server dùng `--reasoning-budget`).
 * Chỉ "sau" VÀ lớp được nghĩ mới có số; lớp phụ không nghĩ nên không có gì để cấp.
 */
export function nganSachNghiChoLuot(loai: LoaiLuot, cheDo?: CheDoNghi): number | undefined {
  if (cheDo !== "sau") return undefined;
  if (!luotDuocNghi(loai, cheDo)) return undefined;
  return NGAN_SACH_NGHI_SAU;
}

/** Trần sinh mong muốn cho model biết nghĩ theo chế độ; `undefined` ⇒ trần mặc định của lớp model. */
export function tranMongMuonChoCheDo(cheDo?: CheDoNghi): number | undefined {
  return cheDo === "sau" ? TRAN_SINH_NGHI_SAU : undefined;
}
