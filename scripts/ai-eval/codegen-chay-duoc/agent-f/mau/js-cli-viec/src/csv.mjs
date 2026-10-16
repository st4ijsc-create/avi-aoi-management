/** Một trường CSV theo RFC 4180: bọc nháy kép khi có dấu phẩy, nháy kép hoặc xuống dòng. */
function truongCsv(gt) {
  const s = gt === null || gt === undefined ? "" : String(gt);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Một dòng CSV (không kèm ký tự xuống dòng). */
export function dongCsv(truong) {
  return truong.map(truongCsv).join(",");
}

/** Cả bảng: mỗi hàng một dòng, ngăn bằng "\n", có "\n" cuối. Bảng rỗng ⇒ "". */
export function bangCsv(hang) {
  return hang.map((h) => dongCsv(h) + "\n").join("");
}
