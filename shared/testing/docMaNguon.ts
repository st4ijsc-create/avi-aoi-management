/**
 * `docMaNguon.ts` — ĐỌC MÃ NGUỒN TỪ ĐĨA CHO TEST, XUỐNG DÒNG ĐÃ CHUẨN HOÁ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ TỆP NÀY — ĐỢT 63
 * ════════════════════════════════════════════════════════════════════════════
 * Rất nhiều lưới của repo là lưới VĂN BẢN: chúng `readFileSync` một tệp nguồn
 * ĐANG NẰM TRÊN ĐĨA rồi so khớp nội dung (cắt dòng, `toMatch(/…\n…/)`,
 * `toBe("<một dòng>")`). Những lưới ấy vì thế đo **trạng thái đĩa**, không đo
 * **nội dung trong git**.
 *
 * Repo KHÔNG có `.gitattributes`, còn Git for Windows mặc định
 * `core.autocrlf=true` (mức hệ thống). Hệ quả đo được (Đợt 63):
 *
 *   | cây                                   | `git ls-files --eol` | 2 ca dưới đây |
 *   |---------------------------------------|----------------------|---------------|
 *   | worktree đang làm việc (tool ghi LF)  | `i/lf  w/lf`         | XANH          |
 *   | `git clone` sạch trên Windows         | `i/lf  w/crlf`       | **ĐỎ**        |
 *
 *   · `client/src/components/twin3d/van-hanh/badgeKepRiaDeNhan.unit.test.ts:195`
 *     `toMatch(/\n {2}hopManHinh: HinhChuNhat;\n/)` — CRLF ⇒ không khớp.
 *   · `client/src/components/twin3d/van-hanh/manMayNoiVaoTrang.unit.test.ts:154`
 *     `toBe("const khungNhin = …;")` — nhận thừa đúng một byte `\r` ở đuôi.
 *
 * CÙNG blob trong git, CÙNG commit — chỉ khác trạng thái đĩa, khác kết quả.
 * Tức lưới đang **chứng nhận thứ nó không kiểm**.
 *
 * Repo đã biết lớp lỗi này ở một chỗ: 9 tệp test họ `aiCodingWorkspace*` tự
 * `.replace(/\r\n/g, "\n")` ngay sau `readFileSync`. Bản vá ấy đúng nhưng LẺ —
 * tệp này gom nó về MỘT chỗ để mọi lưới văn bản dùng chung.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DÙNG KHI NÀO — VÀ ĐẶC BIỆT LÀ KHI NÀO KHÔNG
 * ════════════════════════════════════════════════════════════════════════════
 * ✔ DÙNG khi đọc **mã nguồn đã commit** để soi văn bản của nó (census, lưới
 *   "chỗ nối", lưới cấm-tái-sinh…). Ở đó `\r\n` là NHIỄU của checkout, không
 *   phải dữ kiện — chuẩn hoá là đúng.
 *
 * ✘ KHÔNG DÙNG khi đọc tệp **do chính mã đang bị kiểm sinh ra** (tool ghi đĩa,
 *   bộ xuất báo cáo, trình vá diff…). Ở đó `\r\n` CHÍNH LÀ dữ kiện cần bắt:
 *   chuẩn hoá sẽ làm lưới nuốt mất lỗi thật. Những ca ấy giữ nguyên
 *   `readFileSync` và so bằng byte.
 *
 * ⚠ Đây KHÔNG phải bản vá gốc rễ. Gốc rễ là `.gitattributes` `* text=auto eol=lf`
 *   + `git add --renormalize .` — một quyết định repo-wide chạm rất nhiều tệp,
 *   thuộc quyền chủ sở hữu. Xem sổ nợ `.qa-dot63/NO.md`.
 */
import { readFileSync } from "node:fs";

/**
 * Chuẩn hoá xuống dòng về `\n`: `\r\n` (Windows) và `\r` đơn (Mac cổ) đều thành `\n`.
 * Thuần hàm — dùng được cho chuỗi đã có sẵn trong tay.
 */
export function chuanHoaXuongDong(noiDung: string): string {
  return noiDung.replace(/\r\n?/g, "\n");
}

/**
 * Đọc một tệp văn bản UTF-8 từ đĩa với xuống dòng ĐÃ chuẩn hoá về `\n`.
 *
 * Thay cho `readFileSync(duongDan, "utf8")` trong các lưới soi văn bản mã nguồn.
 * Không đổi bất kỳ điều gì khác: cùng tệp, cùng nội dung, chỉ bỏ phụ thuộc EOL.
 */
export function docMaNguon(duongDan: Parameters<typeof readFileSync>[0]): string {
  return chuanHoaXuongDong(readFileSync(duongDan, "utf8"));
}
