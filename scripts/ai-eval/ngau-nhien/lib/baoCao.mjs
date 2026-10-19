/**
 * Bảng tóm tắt dùng chung cho các đường đo: ĐẠT theo ngôn ngữ × mức, kèm số lượt CỤT (luật số 1 của
 * `codegen-chay-duoc/README.md`: con số không kèm số bài cụt là con số chưa xong — cụt ≠ 0 ⇒ chặn dưới).
 */
import { NGON_NGU, MUC } from "./kho.mjs";

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : "—");

export function bangTomTat(rows, { tieuDe, cot = (r) => r.dat }) {
  const ra = [];
  ra.push(`\n══ ${tieuDe} ══`);
  ra.push(`| ngôn ngữ | ${MUC.join(" | ")} | TỔNG | cụt |`);
  ra.push(`|---|${MUC.map(() => "---").join("|")}|---|---|`);
  for (const l of [...NGON_NGU, null]) {
    const g = l ? rows.filter((r) => r.lang === l) : rows;
    if (!g.length) continue;
    const o = MUC.map((m) => {
      const h = g.filter((r) => r.muc === m);
      return h.length ? `${h.filter(cot).length}/${h.length}` : "—";
    });
    const dat = g.filter(cot).length;
    ra.push(`| ${l ?? "**TỔNG**"} | ${o.join(" | ")} | **${dat}/${g.length} = ${pct(dat, g.length)}** | ${g.filter((r) => r.cut).length} |`);
  }
  const cut = rows.filter((r) => r.cut).length;
  if (cut) ra.push(`\n ⚠ ${cut}/${rows.length} lượt CỤT (chạm trần token) ⇒ số trên là CHẶN DƯỚI — nâng --max-tokens rồi đo lại.`);
  return ra.join("\n");
}

export const trungVi = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
