/**
 * NGHIỆM-THU CUỐI (Task 15 + Task 16) — bộ điều phối.
 *
 *   node .qa-tapdoan/do-cuoi.mjs moc     # SELECT neo dữ kiện  → tho/CUOI/moc.json  (CHẠY TRƯỚC)
 *   node .qa-tapdoan/do-cuoi.mjs P       # P1 P2 P3 P4 P7 P8
 *   node .qa-tapdoan/do-cuoi.mjs P2b P56 P7b P8b
 *   node .qa-tapdoan/do-cuoi.mjs N N2b5b
 *   node .qa-tapdoan/do-cuoi.mjs H H3b
 *   node .qa-tapdoan/do-cuoi.mjs T12 T3
 *   node .qa-tapdoan/do-cuoi.mjs bang    # sinh bảng thô từ tho/CUOI/*.json
 *   node .qa-tapdoan/do-cuoi.mjs all     # tất cả, ĐÚNG THỨ TỰ, TUẦN TỰ (1 worker — G147)
 *
 * Kỷ luật của đợt (xem `.qa-tapdoan/BANG-CUOI.md`):
 *  · KHÔNG sửa mã sản phẩm, KHÔNG git, KHÔNG sửa `.env`, KHÔNG bật/tắt máy chủ đo.
 *  · CSDL: chỉ SELECT, TRỪ các lượt ghi đi qua ĐƯỜNG SẢN PHẨM và các lượt DỌN hàng tạm
 *    (mỗi ca tự đếm trước/sau và tự khôi phục — xem trường `don` / `donSach` trong tệp thô).
 *  · Thiếu dữ kiện ⇒ HỎNG kèm TÊN dữ kiện; tập rỗng ⇒ HỎNG, không ĐẠT.
 *  · 1 worker, tuần tự; Playwright launch kèm `--use-angle=default --enable-gpu --ignore-gpu-blocklist`.
 */
import { spawnSync } from "node:child_process";

const BUOC = {
  moc: ["moc-cuoi.mjs"],
  P: ["do-cuoi-P.mjs", "--ca=all"],
  P2b: ["do-cuoi-P2b.mjs"],
  P56: ["do-cuoi-P56.mjs", "--ca=all"],
  P7b: ["do-cuoi-P7b.mjs"],
  P8b: ["do-cuoi-P8b.mjs"],
  N: ["do-cuoi-N.mjs", "--ca=all"],
  N2b5b: ["do-cuoi-N2b5b.mjs", "--ca=all"],
  H: ["do-cuoi-H.mjs", "--ca=all"],
  H3b: ["do-cuoi-H3b.mjs"],
  T12: ["do-cuoi-T12.mjs", "--ca=all"],
  T3: ["do-cuoi-T3.mjs"],
  bang: ["bang-cuoi.mjs"],
};
const THU_TU = ["moc", "P", "P2b", "P56", "P7b", "P8b", "N", "N2b5b", "H", "H3b", "T12", "T3", "bang"];

const xin = process.argv.slice(2);
const chay = xin.length === 0 || xin[0] === "all" ? THU_TU : xin;
const la = chay.filter((x) => !BUOC[x]);
if (la.length) {
  console.error(`Không biết bước: ${la.join(", ")}. Bước hợp lệ: ${THU_TU.join(" ")}`);
  process.exit(2);
}
let hong = 0;
for (const b of chay) {
  const [tep, ...them] = BUOC[b];
  console.log(`\n══ ${b} — node .qa-tapdoan/${tep} ${them.join(" ")} ══`);
  const kq = spawnSync(process.execPath, [`.qa-tapdoan/${tep}`, ...them], { stdio: "inherit" });
  if (kq.status !== 0) { console.error(`  ⚠ bước ${b} thoát với mã ${kq.status}`); hong += 1; }
}
console.log(`\n══ XONG ${chay.length} bước · ${hong} bước thoát khác 0 ══`);
process.exit(hong > 0 ? 1 : 0);
