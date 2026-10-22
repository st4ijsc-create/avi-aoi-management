/**
 * ★ Đợt 9 (2026-10-22) — ĐO bộ trích mã ST (`server/services/ai/st/trichMaST.ts`, bản CHÍNH) trên câu trả lời THẬT đã lưu:
 *   (1) tỉ lệ BỎ QUA (0 khối) trên câu trả lời ST — vòng kiểm biên dịch không chạy cho những câu đó;
 *   (2) ĐỦ KHỐI: số khối trích ≥ số dòng đánh dấu tệp `// tệp: *.st|*.scl`;
 *   (3) DƯƠNG TÍNH GIẢ: câu trả lời ngôn ngữ KHÁC (mọi báo cáo `reports/*.json` ở đây + thư mục thêm qua --them <dir>) có khối bị trích.
 *
 *   npx tsx scripts/ai-eval/ngau-nhien/do-bo-qua-trich-st.mts [--bao-cao <nhãn,…>] [--them <thư mục reports khác>]
 * Mặc định báo cáo ST: PLC-matiec-vongsua2-q36-27b-1, PLC-a-vongsua2-q36-27b-2 (#11). Thư mục reports .gitignore — có thì đo.
 */
import fs from "node:fs";
import path from "node:path";
import { trichMaST } from "../../../server/services/ai/st/trichMaST";

const arg = (k: string, d: string | null) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const GOC = path.resolve(import.meta.dirname, "reports");
const BAO_CAO = (arg("--bao-cao", "PLC-matiec-vongsua2-q36-27b-1,PLC-a-vongsua2-q36-27b-2") ?? "").split(",").filter(Boolean);
const THU_MUC = [GOC, ...(arg("--them", null) ? [arg("--them", null)!] : [])];
const docRows = (p: string) => {
  try {
    return (JSON.parse(fs.readFileSync(p, "utf8")).rows ?? []) as { id: string; lang: string; vanBanGoc?: string }[];
  } catch {
    return [];
  }
};

for (const nhan of BAO_CAO) {
  const rows = docRows(path.join(GOC, `${nhan}.json`));
  let bo = 0, thieu = 0;
  for (const r of rows) {
    const t = String(r.vanBanGoc ?? "");
    const k = trichMaST(t).length;
    if (!k) bo++;
    if (k < (t.match(/(^|\n)\s*\/\/\s*tệp:\s*\S+\.(st|scl)/gi) ?? []).length) thieu++;
  }
  console.log(`${nhan}: ${rows.length} câu trả lời · BỎ QUA ${bo} · thiếu khối ${thieu}`);
}
let goi = 0, sai = 0;
const vd: string[] = [];
for (const dir of THU_MUC) {
  if (!dir || !fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    for (const r of docRows(path.join(dir, f))) {
      if (r.lang === "st" || typeof r.vanBanGoc !== "string") continue;
      goi++;
      if (trichMaST(r.vanBanGoc).length) {
        sai++;
        if (vd.length < 5) vd.push(`${f}:${r.id}(${r.lang})`);
      }
    }
  }
}
console.log(`dương tính giả (ngôn ngữ khác): ${sai}/${goi}${vd.length ? ` — ${vd.join(" ")}` : ""}`);
