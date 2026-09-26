/**
 * ★★★ 2026-08-23 · UX LÔ 1 (A2/B3) — **DẤU MÁY-ĐỌC-ĐƯỢC trong `preview.warnings` của thẻ duyệt.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HAI SỰ VIỆC ĐO ĐƯỢC Ở BUỔI TRẢI NGHIỆM NGƯỜI-DÙNG-THẬT (Playwright, model 30B thật)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. (A2) Thẻ duyệt `run_command` chìa nút "Xác nhận" cho một lệnh mà CHÍNH `preview` của nó đã
 *      khai là sẽ bị chặn (`CMD_METACHAR`/`CMD_NOT_ALLOWED`…). Người bấm, chờ, rồi nhận một lời
 *      từ chối — cú bấm ấy không bao giờ có thể thành công, và thẻ biết điều đó TRƯỚC khi hỏi.
 *   2. (B3) Câu từ chối `CMD_NOT_ALLOWED` in nguyên bảng 9 lệnh (~2.300 ký tự) vào mặt người dùng
 *      MỖI lần gõ sai — trong khi thứ họ cần là 1–2 lệnh GẦN ĐÚNG nhất.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ MỘT DẤU TRONG CHUỖI CẢNH BÁO, VÀ VÌ SAO Ở `shared/`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `ActionPreview.warnings` là kênh DUY NHẤT đi trọn đường server → `ai_pending_actions.previewJson`
 * → SSE → thẻ duyệt của MỌI mặt tiếp xúc (web · bubble · CLI) mà không đổi một hình dạng DTO nào.
 * Nên phán quyết "chặn chắc chắn" đi NGAY TRONG câu cảnh báo, dưới dạng một tiền tố `[MÃ] ` — và
 * client đọc nó bằng CÙNG một cặp hàm ở đây, không tự chế một quy ước thứ hai (lớp lỗi "hai bản
 * sao một vị từ" repo này đã đếm nhiều lần: bản lỏng hơn bao giờ cũng là bản đang chạy).
 *
 * ⚠ Server GHI dấu (`writeHandlers/repoCommand.ts:chan()`), client ĐỌC dấu (`ConfirmActionCard`).
 *   Hai đầu dây cùng import file này — đổi khuôn dấu ở một chỗ là cả hai đầu đổi theo.
 * ⚠ Dấu CHỈ được đặt ở nhánh TỪ CHỐI của preview. Cảnh báo THÔNG TIN (tệp sạch · ghi đè · hạn giờ
 *   · môi trường lọc) KHÔNG BAO GIỜ mang dấu — disable nhầm nút vì một cảnh báo bình thường là
 *   đổi một lỗi UX lấy một lỗi UX khác (A2 nói đích danh điều này).
 */

/**
 * Khuôn của dấu mã-chặn: `[CMD_XYZ] câu người đọc`. Chỉ nhận mã VIẾT HOA + gạch dưới/chữ số — đúng
 * họ `MaTuChoiLenh` — để một cặp ngoặc vuông tình cờ trong văn xuôi ("[1]", "[xem thêm]") không
 * bao giờ bị đọc nhầm thành một lệnh chặn nút.
 */
const KHUON_MA_CHAN = /^\[([A-Z][A-Z0-9_]{2,63})\]\s/;

/** GHI dấu — server gọi ở nhánh từ chối của preview. */
export function danhDauMaChan(ma: string, cau: string): string {
  return `[${ma}] ${cau}`;
}

/**
 * ĐỌC dấu từ MỘT câu cảnh báo. `null` ⇔ câu này không phải một lời chặn-chắc-chắn.
 * ⚠ Fail-safe về `null`: đầu vào méo (không phải chuỗi) không được làm chết thẻ duyệt.
 */
export function docMaChan(canhBao: unknown): string | null {
  if (typeof canhBao !== "string") return null;
  const m = canhBao.match(KHUON_MA_CHAN);
  return m ? m[1]! : null;
}

/** ĐỌC dấu từ CẢ danh sách cảnh báo — mã đầu tiên thắng (server chỉ phát tối đa một). */
export function timMaChan(warnings: unknown): string | null {
  if (!Array.isArray(warnings)) return null;
  for (const w of warnings) {
    const ma = docMaChan(w);
    if (ma !== null) return ma;
  }
  return null;
}

/**
 * ★ (B3) Dấu của cảnh-báo-mang-danh-sách: dòng đầu là nhãn này, các dòng sau mỗi dòng một mục
 * `• <nhãn lệnh> — <mô tả>`. Client (ConfirmActionCard) gấp nó sau một nút "Xem cả danh sách";
 * mặt tiếp xúc nào KHÔNG biết dấu (bubble cũ, CLI) hiện nguyên văn — tức không mất một thông tin
 * nào, chỉ mất cái nếp gấp.
 */
export const NHAN_DANH_SACH_LENH = "[DANH_SACH_LENH]";

export function danhDauDanhSachLenh(cacDong: readonly string[]): string {
  return `${NHAN_DANH_SACH_LENH}\n${cacDong.join("\n")}`;
}

/** `null` ⇔ cảnh báo này KHÔNG phải danh sách lệnh (câu thường, hiện như cũ). */
export function docDanhSachLenh(canhBao: unknown): string[] | null {
  if (typeof canhBao !== "string" || !canhBao.startsWith(`${NHAN_DANH_SACH_LENH}\n`)) return null;
  return canhBao
    .slice(NHAN_DANH_SACH_LENH.length + 1)
    .split("\n")
    .filter((d) => d.trim() !== "");
}
