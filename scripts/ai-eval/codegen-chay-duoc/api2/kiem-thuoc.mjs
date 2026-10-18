/**
 * KIỂM THƯỚC bộ `tasks-api2` — đóng gói lại từ nguồn rồi chấm fake-ok (PHẢI 100 %) và fake-bad (PHẢI 0 %) bằng CHÍNH
 * `chamBai` của `cham.mjs` (cùng bộ chấm với `run.mjs` và Studio "Eval mã"). Thoát 0 chỉ khi thước đạt cả hai chiều.
 *
 *   node scripts/ai-eval/codegen-chay-duoc/api2/kiem-thuoc.mjs [--only <id,…|lang|nhom>] [--song-song 3] [--giu]
 *
 * Không gọi model, không gọi máy chủ ứng dụng, không chạm GPU. OT/SQL chạy trên máy chủ GIẢ in-process / cụm
 * PostgreSQL dùng-xong-vứt / LocalDB riêng `AiEvalApi2` (xem README mục tasks-api2).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chamBai } from "../cham.mjs";

const API2 = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(API2);
const ROOT = path.resolve(BENCH, "../../..");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ONLY = arg("--only", null)?.split(",");
const SONG_SONG = Math.max(1, Number(arg("--song-song", 3)));

execFileSync(process.execPath, [path.join(API2, "dong-goi.mjs")], { stdio: "inherit" });
const tasks = JSON.parse(fs.readFileSync(path.join(BENCH, "tasks-api2.json"), "utf8"))
  .filter((t) => !ONLY || ONLY.includes(t.id) || ONLY.includes(t.lang) || ONLY.includes(t.nhom));
const fake = JSON.parse(fs.readFileSync(path.join(BENCH, "fake-api2.json"), "utf8"));
const WORK = path.join(ROOT, "tmp", "codegen-chay-duoc-work", "kiem-thuoc-api2");

// Mỗi bài một thư mục riêng (dotnet obj/, cụm PG, CSDL LocalDB ev_… đều tách) ⇒ song song an toàn.
const viec = [];
for (const kind of ["fake-ok", "fake-bad"]) for (const t of tasks) viec.push({ kind, t });
const kq = [];
let i = 0;
async function tho() {
  while (i < viec.length) {
    const { kind, t } = viec[i++];
    const dir = path.join(WORK, kind, t.id);
    fs.rmSync(dir, { recursive: true, force: true });
    const t0 = Date.now();
    const c = await chamBai({ t, text: "```\n" + (fake[kind][t.id] ?? "") + "\n```", dir });
    const ms = Date.now() - t0;
    kq.push({ kind, id: t.id, nhom: t.nhom, dat: c.dat, loi: c.loi, ms });
    const dung = (kind === "fake-ok") === c.dat;
    process.stderr.write(`${dung ? "  " : "✖ "}${kind.padEnd(8)} ${t.id.padEnd(8)} ${c.dat ? "ĐẠT  " : "TRƯỢT"} ${String(ms).padStart(6)} ms\n`);
    if (!dung && kind === "fake-ok") process.stderr.write(`    ${String(c.loi).slice(-600).replace(/\n/g, "\n    ")}\n`);
    if (!args.includes("--giu") && dung) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
  }
}
await Promise.all(Array.from({ length: SONG_SONG }, tho));

const ok = kq.filter((r) => r.kind === "fake-ok");
const bad = kq.filter((r) => r.kind === "fake-bad");
console.log(`\n══ kiểm thước tasks-api2 ══ n=${tasks.length}`);
for (const n of [...new Set(tasks.map((t) => t.nhom))]) {
  const a = ok.filter((r) => r.nhom === n), b = bad.filter((r) => r.nhom === n);
  console.log(` [${n}] fake-ok ${a.filter((r) => r.dat).length}/${a.length} · fake-bad ${b.filter((r) => r.dat).length}/${b.length}`);
}
const okDat = ok.filter((r) => r.dat).length, badDat = bad.filter((r) => r.dat).length;
console.log(` TỔNG fake-ok ${okDat}/${ok.length} (phải 100 %) · fake-bad ${badDat}/${bad.length} (phải 0 %)`);
const datThuoc = okDat === ok.length && badDat === 0;
console.log(datThuoc ? " ✔ THƯỚC ĐẠT" : " ✖ THƯỚC HỎNG — vứt mọi số đo bằng bộ này cho tới khi sửa");
process.exit(datThuoc ? 0 : 1);
