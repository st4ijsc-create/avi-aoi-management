/**
 * ★★★ 2026-08-26 · CURSOR-PARITY — TÌM TRONG TỆP (Ctrl+F) cho Trình xem của `/ai-coding-workspace`.
 *
 * `timDongKhop` là phần THUẦN: cho nội dung tệp + từ khoá, trả DANH SÁCH SỐ DÒNG (1-based) có chứa từ
 * khoá (không phân biệt hoa/thường). Thanh tìm dùng nó để đếm "N/M" và để điều hướng: đặt `dongMucTieu`
 * = số dòng khớp thứ i ⇒ TÁI DÙNG đúng cơ chế cuộn+tô-sáng của "nhảy-tới-dòng" (panel Vấn đề) — không
 * đẻ đường cuộn thứ hai.
 *
 * ⚠ VÌ SAO THUẦN + LƯỚI: tách "đếm dòng khớp" khỏi JSX để đo THẲNG ca biên (rỗng · CRLF · hoa-thường ·
 *   nhiều khớp một dòng vẫn tính MỘT dòng) bằng `toEqual`, không qua một lượt render CẢ trang.
 * ⚠ GIỚI HẠN v1 NÓI THẲNG: khớp theo DÒNG (không tô CỤM khớp trong dòng) — nội dung Trình xem là HTML
 *   đã tô cú pháp (Shiki), chèn dấu khớp giữa các span màu là một lớp phức tạp riêng. Dòng-level đủ để
 *   "nhảy tới chỗ có từ khoá" như Ctrl+G; tô-cụm để dành đợt sau.
 */

/**
 * ★ 2026-08-31 · ĐỢT A (UX H4) — thoát mọi ký tự regex để một từ khoá người-gõ thành phép TÌM
 * NGUYÊN VĂN. `grep_repo` server LUÔN biên dịch `new RegExp(mau)`; trước đây client gửi nguyên văn
 * nên `a+b`/`x(y)` âm thầm là regex. THUẦN — lưới hỏi thẳng (aiCodingWorkspaceUx §H4).
 */
export function thoatRegex(chuoi: string): string {
  return chuoi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Số dòng (1-based) của các dòng CÓ CHỨA `tuKhoa` (không phân biệt hoa/thường), theo thứ tự xuất hiện.
 * `tuKhoa` rỗng / không phải chuỗi ⇒ `[]`. Tách CRLF lẫn LF (`\r?\n`). Một dòng khớp nhiều lần vẫn tính
 * ĐÚNG MỘT (đây là điều hướng theo DÒNG, không theo cụm).
 */
export function timDongKhop(noiDung: string, tuKhoa: string): number[] {
  if (typeof noiDung !== "string" || typeof tuKhoa !== "string" || tuKhoa.length === 0) return [];
  const kim = tuKhoa.toLowerCase();
  const ket: number[] = [];
  const dong = noiDung.split(/\r?\n/);
  for (let i = 0; i < dong.length; i++) {
    if (dong[i].toLowerCase().includes(kim)) ket.push(i + 1); // 1-based khớp gutter `[data-so-dong]`
  }
  return ket;
}

/**
 * Chỉ số khớp KẾ TIẾP có VÒNG LẠI (đi tới / lui). `tong <= 0` ⇒ `0` (không có khớp). Dùng cho nút ▲▼ và
 * Enter/Shift+Enter của thanh tìm. Thuần để lưới đo "cuối → đầu" và "đầu → cuối" bằng `toBe`.
 */
export function chiSoKhopKeTiep(hienTai: number, tong: number, tien: boolean): number {
  if (tong <= 0) return 0;
  return tien ? (hienTai + 1) % tong : (hienTai - 1 + tong) % tong;
}

/**
 * ★★★ 2026-08-27 — VỊ TRÍ (offset) mọi lần `term` xuất hiện TRONG một chuỗi (không phân biệt hoa/thường,
 * KHÔNG chồng lấn). Dùng để dựng `Range` tô CỤM KHỚP trong dòng (CSS Custom Highlight API) — phần TÌM
 * trong Trình xem. Tách THUẦN để lưới đo offset chính xác (dựng Range là DOM, đo bằng mắt/Playwright).
 * `term` rỗng / không phải chuỗi ⇒ `[]`.
 */
export function viTriKhopTrongChuoi(text: string, term: string): number[] {
  if (typeof text !== "string" || typeof term !== "string" || term.length === 0) return [];
  const t = text.toLowerCase();
  const k = term.toLowerCase();
  const ket: number[] = [];
  let i = t.indexOf(k);
  while (i !== -1) {
    ket.push(i);
    i = t.indexOf(k, i + k.length); // nhảy QUA cụm vừa khớp ⇒ không chồng lấn (đúng thói quen tìm-kiếm)
  }
  return ket;
}
