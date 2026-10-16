/**
 * BỘ F — TÍNH NĂNG NHIỀU TỆP cho chế độ agent (thiết kế Đợt 1 §6). Cổng: ≥ 60 % × 3 lượt.
 *
 *   --config mau       áp lời giải mẫu (agent-f/mau/<bai>) rồi chấm      ⇒ KIỂM THƯỚC: phải 6/6 ĐẠT
 *   --config goc       chấm dự án gốc (test hiển thị phải xanh, cả bài TRƯỢT) ⇒ KIỂM THƯỚC: phải 0/6
 *   --config gian-lan  lời giải mẫu + sửa MỘT byte tệp test hiển thị       ⇒ KIỂM THƯỚC: phải 0/6
 *   --config agent     POST ${AI_EVAL_BASE}/api/ai/agent/runs (SSE) {cauHoi, projectId, cheDo:"tu-dong"} rồi chấm
 *
 * Tham số: --luot N (mặc định 1; agent 3) · --only <id,…|lang> · --label <nhãn> (kết thúc bằng số lượt) ·
 *          --noi tai-cho|tam · --cookie <tệp> · --project-id <id> (mặc định "repo") · --tran-phut <n> (agent, 25) ·
 *          --tien-to <đường dự án viết vào câu hỏi> (mặc định sandbox-projects/agent-f/<bai>, khớp projectId "repo").
 *
 * NƠI CHẤM (`--noi`):
 *   tai-cho  chấm NGAY trong `sandbox-projects/agent-f/<bai>` của worktree chứa script; đặt lại TRƯỚC và SAU mỗi
 *            bài bằng `git checkout -- <dir>` + `git clean -fd -- <dir>` (CHỈ thư mục bài; bin/obj bị .gitignore nên
 *            được giữ ⇒ restore NuGet không lặp). Chuẩn băm tệp test = git HEAD. ĐÒI dự án ĐÃ COMMIT.
 *   tam      chép dự án sang `tmp/agent-f-work/<bai>` (ngoài git) rồi chấm bản sao; chuẩn băm = thư mục nguồn.
 *            Dùng để kiểm thước KHI DỰ ÁN CHƯA COMMIT. Chế độ agent KHÔNG chạy được ở `tam` (agent ghi vào
 *            sandbox-projects/ của repo, không phải bản sao) ⇒ exit 2.
 *   mặc định: tai-cho nếu mọi bài được chọn đã có trong git HEAD, ngược lại tam (agent ⇒ exit 2).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chamBai, docDanhSachBai, bamChuanTuGit, bamChuanTuThuMuc, BENCH, ROOT } from "./cham.mjs";
import { chayAgent } from "./khachAgent.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CONFIG = arg("--config", "mau");
if (!["mau", "goc", "gian-lan", "agent"].includes(CONFIG)) { console.error(`--config lạ: ${CONFIG}`); process.exit(2); }
const SO_LUOT = Number(arg("--luot", CONFIG === "agent" ? 3 : 1));
const ONLY = arg("--only", null);
const LABEL = arg("--label", `F-${CONFIG}-1`);
const BASE = (process.env.AI_EVAL_BASE || "http://127.0.0.1:3000").replace(/\/+$/, "");
const PROJECT_ID = arg("--project-id", "repo");
const LLAMA = (process.env.AI_EVAL_LLAMA || "http://127.0.0.1:8091").replace(/\/+$/, "");
const TRAN_MS = Number(arg("--tran-phut", 25)) * 60_000;
const TIEN_TO = arg("--tien-to", null);

const DS_BAI = docDanhSachBai().filter((b) => !ONLY || ONLY.split(",").some((x) => x === b.id || x === b.lang || x === b.kieu));
if (DS_BAI.length === 0) { console.error("Không có bài nào khớp --only"); process.exit(2); }

const git = (...a) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" });
const relBai = (b) => `sandbox-projects/agent-f/${b.id}`;
const daCommit = (b) => git("ls-tree", "-r", "--name-only", "HEAD", "--", relBai(b)).stdout.trim() !== "";

let NOI = arg("--noi", null);
if (!NOI) NOI = DS_BAI.every(daCommit) ? "tai-cho" : "tam";
if (NOI === "tai-cho") {
  const chua = DS_BAI.filter((b) => !daCommit(b)).map((b) => b.id);
  if (chua.length) { console.error(`⛔ --noi tai-cho cần dự án ĐÃ COMMIT; chưa có trong HEAD: ${chua.join(", ")}`); process.exit(2); }
}
if (CONFIG === "agent" && NOI !== "tai-cho") {
  console.error("⛔ --config agent chỉ chạy được tại chỗ trên dự án đã commit (agent ghi vào sandbox-projects/, đặt lại bằng git).");
  process.exit(2);
}
if (NOI === "tam") console.error("ℹ NƠI CHẤM = tam: bản sao trong tmp/agent-f-work/, chuẩn băm = thư mục nguồn (dự án chưa commit).");

const SRC = (b) => `${ROOT}/${relBai(b)}`;
const TAM = (b) => `${ROOT}/tmp/agent-f-work/${b.id}`;
const thuMucCham = (b) => (NOI === "tai-cho" ? SRC(b) : TAM(b));
const bamChuan = (b) => (NOI === "tai-cho" ? bamChuanTuGit(relBai(b)) : bamChuanTuThuMuc(SRC(b)));

const BO_QUA_CHEP = new Set(["bin", "obj", "__pycache__", ".pytest_cache", "node_modules"]);
function chepCay(tu, den) {
  fs.mkdirSync(den, { recursive: true });
  for (const e of fs.readdirSync(tu, { withFileTypes: true })) {
    if (BO_QUA_CHEP.has(e.name)) continue;
    const a = `${tu}/${e.name}`, d = `${den}/${e.name}`;
    if (e.isDirectory()) chepCay(a, d); else fs.copyFileSync(a, d);
  }
}

/** Đặt lại dự án bài về trạng thái gốc. tai-cho: CHỈ thư mục bài, CHỈ trong worktree chứa script. */
function datLai(b) {
  if (NOI === "tam") {
    fs.rmSync(TAM(b), { recursive: true, force: true });
    chepCay(SRC(b), TAM(b));
    return;
  }
  const rel = relBai(b);
  if (!/^sandbox-projects\/agent-f\/[a-z0-9-]+$/.test(rel)) throw new Error(`đường đặt lại bất thường: ${rel}`);
  for (const a of [["checkout", "--", rel], ["clean", "-fd", "--", rel]]) {
    const r = git(...a);
    if (r.status !== 0) { console.error(`⛔ git ${a.join(" ")} thất bại: ${r.stderr}`); process.exit(2); }
  }
  const ban = git("status", "--porcelain", "--", rel).stdout.trim();
  if (ban) { console.error(`⛔ VỨT: ${rel} vẫn bẩn sau khi đặt lại:\n${ban}`); process.exit(2); }
}

function tepDaDoi(b) {
  if (NOI !== "tai-cho") return [];
  return git("status", "--porcelain", "--untracked-files=all", "--", relBai(b)).stdout
    .split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).replace(`${relBai(b)}/`, ""));
}

function apMau(b) { chepCay(`${BENCH}/mau/${b.id}`, thuMucCham(b)); }

function gianLan(b) {
  apMau(b);
  const p = `${thuMucCham(b)}/${b.testHienThi[0]}`;
  const chu = b.kieu === "pytest" ? "\n# gian lận: sửa tệp test cho xanh\n" : "\n// gian lận: sửa tệp test cho xanh\n";
  fs.appendFileSync(p, chu);
}

// ── CỔNG SỨC KHOẺ (chỉ chế độ agent: các chế độ kiểm thước không gọi server) ─────────────────────────
async function kiemSong(url, ten) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok && r.status !== 404) throw new Error("HTTP " + r.status);
  } catch (e) {
    console.error(`\n⛔ VỨT KẾT QUẢ: ${ten} KHÔNG khoẻ (${e}). Mọi số của lượt này VÔ GIÁ TRỊ.`);
    process.exit(2);
  }
}
async function congSucKhoe(luc) {
  await kiemSong(`${LLAMA}/health`, `llama-server :8091 (${luc})`);
  await kiemSong(`${BASE}/`, `server ${BASE} (${luc})`);
}

// ── CHẠY ─────────────────────────────────────────────────────────────────────────────────────────────
let cookie = "";
if (CONFIG === "agent") {
  const { ck } = await import("../cookie.mjs");
  cookie = ck(arg("--cookie", `${ROOT}/tmp/audit-ai/ck.txt`));
  await congSucKhoe("trước");
}

const rows = [];
for (const b of DS_BAI) {
  for (let luot = 1; luot <= SO_LUOT; luot++) {
    datLai(b);
    const row = { id: b.id, lang: b.lang, luot, config: CONFIG, noi: NOI };

    if (CONFIG === "goc" || CONFIG === "agent") {
      // Bất biến của bài: test HIỂN THỊ xanh trên dự án gốc (bài là "thêm tính năng", không phải "sửa lỗi").
      const truoc = chamBai({ bai: b, thuMuc: thuMucCham(b), bamChuan: bamChuan(b), chiHienThi: true });
      row.hienThiXanhTruoc = truoc.dat;
      if (!truoc.dat) {
        console.error(`⛔ VỨT: ${b.id} — test hiển thị KHÔNG xanh trên dự án gốc (${truoc.lyDo.join(", ")}).\n${truoc.duoiRa.slice(-800)}`);
        process.exit(2);
      }
    }

    if (CONFIG === "mau") apMau(b);
    if (CONFIG === "gian-lan") gianLan(b);
    if (CONFIG === "agent") {
      process.stderr.write(`▶ ${b.id} lượt ${luot} … `);
      row.agent = await chayAgent({ base: BASE, cookie, projectId: PROJECT_ID, tranMs: TRAN_MS,
        cauHoi: b.cauHoi.replaceAll("{DA}", TIEN_TO ?? relBai(b)) });
      if (row.agent.http === 404) {
        console.error(`\n⛔ VỨT: ${BASE}/api/ai/agent/runs trả 404 — API agent chưa có trên server này.`);
        datLai(b);
        process.exit(2);
      }
      await congSucKhoe(`sau ${b.id} lượt ${luot}`);
      row.tepDaDoi = tepDaDoi(b);
    }

    const kq = chamBai({ bai: b, thuMuc: thuMucCham(b), bamChuan: bamChuan(b) });
    row.dat = kq.dat;
    row.cham = kq;
    rows.push(row);
    const a = row.agent;
    console.error(`${CONFIG === "agent" ? "" : `▶ ${b.id} lượt ${luot} … `}${kq.dat ? "ĐẠT" : "TRƯỢT"}` +
      `  ${kq.dem ? `${kq.dem.pass}✓/${kq.dem.fail}✗ (cần ≥${kq.canToiThieu})` : "không có tổng kết test"}` +
      `${kq.lyDo.length ? `  [${kq.lyDo.join(", ")}]` : ""}` +
      `${a ? `  ${a.ms}ms · ${a.soGoiTool} tool · ra ${a.usage.ra} tok · ${a.lyDo ?? "?"}` : ""}  chấm ${kq.ms}ms`);
    datLai(b);
  }
}
if (CONFIG === "agent") await congSucKhoe("sau");

// ── BÁO CÁO ──────────────────────────────────────────────────────────────────────────────────────────
const dirBc = `${ROOT}/scripts/ai-eval/codegen-chay-duoc/reports`;
fs.mkdirSync(dirBc, { recursive: true });
fs.writeFileSync(`${dirBc}/${LABEL}.json`, JSON.stringify({ label: LABEL, config: CONFIG, noi: NOI, base: CONFIG === "agent" ? BASE : null,
  projectId: CONFIG === "agent" ? PROJECT_ID : null, luc: new Date().toISOString(), rows }, null, 1));

const dat = rows.filter((r) => r.dat).length;
const trungVi = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
console.log(`\n══ ${LABEL} (config=${CONFIG}, nơi=${NOI}) ══`);
console.log(`| bài | ĐẠT | lý do trượt | ${CONFIG === "agent" ? "ms trung vị | tool TB | token ra TB | lý do dừng |" : ""}`);
console.log(`|---|---|---|${CONFIG === "agent" ? "---|---|---|---|" : ""}`);
for (const b of DS_BAI) {
  const g = rows.filter((r) => r.id === b.id);
  const lyDo = [...new Set(g.flatMap((r) => r.cham.lyDo))].join(", ") || "—";
  let them = "";
  if (CONFIG === "agent") {
    const ag = g.map((r) => r.agent);
    const tb = (f) => Math.round(ag.reduce((s, x) => s + f(x), 0) / ag.length);
    const dung = Object.entries(ag.reduce((m, x) => ((m[x.lyDo ?? "?"] = (m[x.lyDo ?? "?"] ?? 0) + 1), m), {}))
      .map(([k, v]) => `${k}×${v}`).join(" ");
    them = ` ${trungVi(ag.map((x) => x.ms))} | ${tb((x) => x.soGoiTool)} | ${tb((x) => x.usage.ra)} | ${dung} |`;
  }
  console.log(`| ${b.id} | ${g.filter((r) => r.dat).length}/${g.length} | ${lyDo} |${them}`);
}
console.log(`\n TỔNG: ${dat}/${rows.length} ĐẠT (${Math.round((100 * dat) / rows.length)} %)`);
const gaming = rows.filter((r) => r.cham.tepBaoVeBiSua.length).length;
if (gaming) console.log(` ⚠ ${gaming} lượt SỬA TỆP TEST ĐƯỢC BẢO VỆ — tính TRƯỢT`);
console.log(` báo cáo: ${dirBc}/${LABEL}.json`);

// Kiểm thước: kỳ vọng cứng cho ba chế độ không dùng model.
const KY_VONG = { mau: rows.length, goc: 0, "gian-lan": 0 };
if (CONFIG in KY_VONG) {
  const ok = dat === KY_VONG[CONFIG];
  console.log(` KIỂM THƯỚC ${CONFIG}: ${ok ? "ĐẠT" : "HỎNG — VỨT MỌI SỐ ĐO CHO TỚI KHI SỬA BỘ ĐO"} (kỳ vọng ${KY_VONG[CONFIG]}/${rows.length}, được ${dat}/${rows.length})`);
  process.exit(ok ? 0 : 1);
}
