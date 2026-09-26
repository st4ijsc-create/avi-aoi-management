// ★ PDCA trợ lý vận hành vòng 4 (2026-09-24) — ĐOẠN CON cho văn xuôi/danh sách của tài liệu miền.
//
// Sau khi tách bảng, 5 câu có nguồn đúng vẫn ngoài top‑20; hai câu là "cây kim" trong đoạn lớn: "2 lần rework" nằm giữa đoạn
// 1.798 ký tự (T17), dòng "Minor | MI | Ghi nhận…" trong bảng quá nhỏ để tách (T43). Bổ sung (KHÔNG thay) đoạn con cỡ đoạn
// văn: gom các đoạn văn liên tiếp trong CÙNG một mục tới `MAX_CON` ký tự, mỗi đoạn con mang tiêu đề mục gần nhất. Bảng lớn đã
// có nhóm dòng riêng (`_bang-nhom-dong.mjs`) nên bị BỎ QUA ở đây; bảng nhỏ (< 5 dòng) được giữ như một đoạn văn. Hàm THUẦN.
export const MAX_CON = 600;
const MIN_KY_TU = 60;

const laBangLon = (p) => {
  const dong = p.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l));
  return dong.length >= 7; // tiêu đề + phân cách + ≥ 5 dòng dữ liệu = đã có nhóm dòng
};

/**
 * @param {string} text
 * @param {{ maxCon?: number, doanGoc?: string[] }} [o] `doanGoc`: các đoạn đã có — đoạn con TRÙNG nguyên văn bị bỏ.
 * @returns {string[]}
 */
export function tachDoanCon(text, { maxCon = MAX_CON, doanGoc = [] } = {}) {
  const goc = new Set(doanGoc.map((d) => String(d).trim()));
  const ra = [];
  let tieuDe = "";
  let goi = [];
  const xa = () => {
    if (!goi.length) return;
    const than = goi.join("\n\n");
    const doan = (tieuDe ? `${tieuDe}\n` : "") + than;
    if (than.length >= MIN_KY_TU && !goc.has(doan.trim()) && !goc.has(than.trim())) ra.push(doan);
    goi = [];
  };
  for (const khoi of String(text ?? "").replace(/\r\n/g, "\n").split(/\n\s*\n/g)) {
    const p = khoi.trim();
    if (!p) continue;
    const dauMuc = p.match(/^(#{1,6}\s+.+)$/m);
    if (dauMuc && p.split("\n")[0].startsWith("#")) {
      xa();
      tieuDe = p.split("\n")[0].trim();
      const conLai = p.split("\n").slice(1).join("\n").trim();
      if (!conLai) continue;
      goi.push(conLai);
      continue;
    }
    if (laBangLon(p)) { xa(); continue; }
    const thu = [...goi, p].join("\n\n");
    if (thu.length > maxCon && goi.length) { xa(); }
    goi.push(p);
    if (p.length > maxCon) xa(); // đoạn văn đơn quá dài: giữ nguyên, không cắt giữa câu
  }
  xa();
  return ra;
}
