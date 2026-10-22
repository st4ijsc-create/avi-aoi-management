/**
 * ★ Đợt 9 (2026-10-22, dieu-phoi) — LỜI NHẮC SỬA theo lỗi biên dịch Structured Text: MỘT nguồn cho bộ đo trục M
 * (`scripts/ai-eval/ngau-nhien/mot-luot.mjs --vong-sua`) và vòng kiểm biên dịch của sản phẩm (`server/services/ai/st/kiemBienDichSt.ts`)
 * — để hai đường không trôi nhau. Viết bằng JS thuần (.mjs, khai kiểu ở `stNhacSua.d.mts`) vì bộ đo chạy node thuần.
 *
 * Lý do đo được: A/B /v1 2026-10-22 — cùng chẩn đoán trên cùng câu trả lời (tt7), đường M sửa được 2/3, đường sản phẩm 0/3; khác
 * biệt duy nhất còn lại là lời nhắc (M đòi trả lại ĐỦ mọi tệp đúng định dạng `// tệp:`). Văn bản dưới đây GIỮ TỪNG BYTE của bộ đo M
 * (lưới `shared/stNhacSua.test.ts` ghim), để số đo M cũ còn so được.
 */

/** Tên trình biên dịch trong lời nhắc (giữ đúng chữ bộ đo M). */
export const TEN_TRINH_DICH_ST = {
  rusty: "RuSTy, phương ngữ CODESYS",
  matiec: "MATIEC của OpenPLC v3, chuẩn IEC 61131-3",
};

/** Số dòng lỗi tối đa đưa vào lời nhắc. */
export const TRAN_DONG_LOI_ST = 15;

/** Một dòng lỗi: `tệp:dòng:cột MÃ thông điệp` (đúng hình dạng bộ đo M). */
export function dongLoiST(d) {
  return `${d.tep ?? "?"}:${d.dong ?? "?"}:${d.cot ?? "?"} ${d.ma ?? ""} ${d.thongDiep}`.trim();
}

/**
 * Lời nhắc sửa. `dinhDangTep` = câu trả lời trước có dòng đánh dấu `// tệp: …` (bộ đo M luôn có) ⇒ đòi trả lại ĐỦ mọi tệp đúng
 * định dạng ấy; không có ⇒ đòi trả lại ĐỦ mã theo đúng định dạng như trước.
 */
export function cauNhacSuaST({ trinhDich, laScl, loi, dinhDangTep }) {
  const dau =
    `Trình biên dịch IEC 61131-3 (${trinhDich}) báo lỗi` +
    `${laScl ? " (mã SCL của bạn được chuẩn hoá sang ST trước khi biên dịch; số dòng giữ nguyên)" : ""}:\n` +
    `${loi.slice(0, TRAN_DONG_LOI_ST).map((l) => `- ${l}`).join("\n")}\n\n`;
  return (
    dau +
    (dinhDangTep
      ? "Sửa các lỗi trên và trả lại ĐẦY ĐỦ mọi tệp theo đúng định dạng như trước (mỗi tệp một khối mã có dòng `// tệp: …`)."
      : "Sửa các lỗi trên và trả lại ĐẦY ĐỦ mã theo đúng định dạng như trước (mỗi khối mã một khối ```, không lược bớt phần đúng).")
  );
}
