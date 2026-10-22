/**
 * ★ Đợt 9 (2026-10-22) — GỘP báo cáo ablation `compile_st` trong vòng tác nhân (`tmp/do-ablation-agent.sh`: mỗi (bài, lượt,
 * nhánh) một báo cáo `reports/AB-agent-cst-<id>-l<lượt>-<bat|tat>.json`) ⇒ bảng theo nhánh, cặp lệch, theo bài, số lượt
 * `compile_st`, hạ tự trị/chờ duyệt, thời gian.
 *   node scripts/ai-eval/ngau-nhien/so-sanh-ablation-agent.mjs [--tien-to AB-agent-cst-]
 */
import fs from "node:fs";
import path from "node:path";
import { BO } from "./lib/moiTruong.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TIEN_TO = arg("--tien-to", "AB-agent-cst-");
const dir = path.join(BO, "reports");
const re = new RegExp(`^${TIEN_TO}(.+)-l(\\d+)-(bat|tat)\\.json$`);
const rows = [];
for (const f of fs.readdirSync(dir)) {
  const m = re.exec(f);
  if (!m) continue;
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const r = j.rows[0];
  rows.push({ id: m[1], luot: Number(m[2]), nhanh: m[3], muc: r.muc, dat: r.dat, ms: r.agent?.ms ?? null, tool: r.agent?.soGoiTool ?? null,
    ra: r.agent?.usage?.ra ?? null, cs: r.compileSt ?? { goi: 0, ok: 0, ma: [] }, canDuyet: r.agent?.canDuyet ?? 0, lyDo: r.agent?.lyDo ?? null,
    lyDoTruot: r.cham?.lyDo ?? [] });
}
const tv = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
console.log(`báo cáo: ${rows.length}`);
for (const n of ["tat", "bat"]) {
  const r = rows.filter((x) => x.nhanh === n);
  const theoMuc = ["thuat-toan", "thu-vien", "ung-dung"].map((mu) => `${mu} ${r.filter((x) => x.muc === mu && x.dat).length}/${r.filter((x) => x.muc === mu).length}`).join(" · ");
  console.log(`${n}: ĐẠT ${r.filter((x) => x.dat).length}/${r.length} (${theoMuc}) · ms trung vị ${tv(r.map((x) => x.ms))} · tool trung vị ${tv(r.map((x) => x.tool))} · token ra trung vị ${tv(r.map((x) => x.ra))}` +
    ` · compile_st gọi ${r.reduce((a, x) => a + x.cs.goi, 0)} (lượt có gọi ${r.filter((x) => x.cs.goi > 0).length}) · chờ duyệt ${r.reduce((a, x) => a + x.canDuyet, 0)}` +
    ` · dừng ${JSON.stringify(r.reduce((a, x) => ((a[x.lyDo] = (a[x.lyDo] ?? 0) + 1), a), {}))}` +
    ` · không build được ở máy chấm ${r.filter((x) => x.lyDoTruot.includes("KHONG_THAY_TONG_KET_TEST")).length}`);
}
const cap = new Map();
for (const r of rows) cap.set(`${r.id}#${r.luot}`, { ...(cap.get(`${r.id}#${r.luot}`) ?? {}), [r.nhanh]: r.dat });
const du = [...cap].filter(([, v]) => "bat" in v && "tat" in v);
console.log(`cặp đủ: ${du.length} · bật ĐẠT/tắt TRƯỢT ${du.filter(([, v]) => v.bat && !v.tat).map(([k]) => k).join(", ") || "—"} · bật TRƯỢT/tắt ĐẠT ${du.filter(([, v]) => !v.bat && v.tat).map(([k]) => k).join(", ") || "—"}`);
