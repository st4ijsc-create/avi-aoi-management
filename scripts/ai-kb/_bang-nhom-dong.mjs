// ★ PDCA trợ lý vận hành (2026-09-24) — ĐOẠN THEO NHÓM DÒNG cho BẢNG markdown trong tài liệu miền.
//
// Đo đầu–cuối 111 câu ST4I: 16/22 câu trượt còn lại là trượt TRUY HỒI, 9 câu nguồn đúng không có cả trong top‑20. Ca điển
// hình: "Áp suất khí nén thấp thì máy hiện mã lỗi nào?" ⇒ đáp án là MỘT dòng `| E082 | Air pressure low | … |` nằm trong
// đoạn 1.708 ký tự chứa cả bảng E041–E090 — véc‑tơ của cả bảng bị pha loãng, không giống một câu hỏi về một dòng.
// Bổ sung (KHÔNG thay) đoạn gốc: mỗi bảng ≥ `MIN_DONG` dòng dữ liệu tách thêm thành nhóm `DONG_MOI_NHOM` dòng, mỗi nhóm mang
// lại tiêu đề mục gần nhất + dòng tiêu đề bảng (để "Mã | Mô tả | Xử lý" vẫn có nghĩa). Hàm THUẦN.
export const MIN_DONG = 5;
export const DONG_MOI_NHOM = 4;

const laDongBang = (l) => /^\s*\|.*\|\s*$/.test(l);
const laDongPhanCach = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

/** Trả mảng văn bản đoạn bổ sung (có thể rỗng). */
export function tachBangThanhNhom(text, { minDong = MIN_DONG, dongMoiNhom = DONG_MOI_NHOM } = {}) {
  const lines = String(text ?? "").split(/\r?\n/);
  const ra = [];
  let tieuDe = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s+/.test(l)) tieuDe = l.trim();
    // Bảng = dòng tiêu đề bảng + dòng phân cách + ≥1 dòng dữ liệu.
    if (laDongBang(l) && i + 1 < lines.length && laDongPhanCach(lines[i + 1])) {
      const dau = l.trim();
      const pc = lines[i + 1].trim();
      let j = i + 2;
      const du = [];
      while (j < lines.length && laDongBang(lines[j]) && !laDongPhanCach(lines[j])) du.push(lines[j].trim()), j++;
      if (du.length >= minDong) {
        for (let k = 0; k < du.length; k += dongMoiNhom) {
          const nhom = du.slice(k, k + dongMoiNhom);
          ra.push([tieuDe, dau, pc, ...nhom].filter(Boolean).join("\n"));
        }
      }
      i = j - 1;
    }
  }
  return ra;
}
