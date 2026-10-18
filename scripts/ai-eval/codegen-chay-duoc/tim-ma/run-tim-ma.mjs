/**
 * BỘ "TÌM MÃ" (Đợt 2 §1) — cổng: trả đúng tệp:dòng ≥ 80 %; số lượt tool trung vị GIẢM so với khi tắt tool mới.
 *
 *   --config kiem    KIỂM THƯỚC, không gọi server: chấm 5 bộ câu trả lời sinh từ đáp án (đúng ⇒ 100 %, sai tệp /
 *                    chỉ tên tệp / tiền-hậu tố giả ⇒ 0 %, sai dòng ⇒ chỉ câu không đòi dòng). Lệch ⇒ exit 1.
 *   --config agent   POST ${AI_EVAL_BASE}/api/ai/agent/runs {cauHoi, projectId, cheDo:"hoi"} (SSE) rồi chấm câu trả lời
 *                    cuối. BẮT BUỘC `--nhanh bat|tat` (máy chủ khởi động KHÔNG / CÓ `AI_AGENT_AN_CONG_CU=…`):
 *                    nhánh `tat` mà có tool mới chạy THÀNH CÔNG ⇒ công tắc không hiệu lực ⇒ exit 2 (vứt số).
 *   --so-sanh <nhãn bật>,<nhãn tắt>   đọc hai báo cáo, in bảng + phán quyết cổng (không gọi server).
 *
 * Tham số: --label <nhãn> · --luot N (agent, mặc định 1) · --only <id,…|R|A> · --cookie <tệp> (mặc định tmp/audit-ai/ck.txt)
 *          · --project-id <id> (mặc định "repo") · --tran-phut <n> (mặc định 10).
 * Trước mỗi lượt agent: đáp án phải khớp mã hiện tại (`chuanBi.mjs --kiem`) VÀ kiểm thước phải ĐẠT; cổng sức khoẻ
 * :8091/health + server trước/sau mỗi câu; hỏng ⇒ exit 2.
 * Báo cáo: scripts/ai-eval/codegen-chay-duoc/reports/<label>.json
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, docCau, kiemDapAn } from "./chuanBi.mjs";
import { chamCau, boTraLoiKiemThuoc, kyVongKiemThuoc } from "./cham.mjs";
import { hoiAgent, vanBanCham } from "./khachHoi.mjs";

const TOOL_MOI = ["find_symbol", "search_code", "search_docs"];
const DIR_BC = path.join(ROOT, "scripts/ai-eval/codegen-chay-duoc/reports");

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SO_SANH = arg("--so-sanh", null);
const CONFIG = arg("--config", "kiem");
const ONLY = arg("--only", null);
const trungVi = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pt = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : "—");

// ── SO SÁNH ─────────────────────────────────────────────────────────────────────────────────────────
if (SO_SANH) {
  const [nBat, nTat] = SO_SANH.split(",");
  const doc = (n) => JSON.parse(fs.readFileSync(path.join(DIR_BC, `${n}.json`), "utf8"));
  const A = doc(nBat), B = doc(nTat);
  if (A.nhanh !== "bat" || B.nhanh !== "tat") console.log(`⚠ nhánh khai trong báo cáo: ${nBat}=${A.nhanh}, ${nTat}=${B.nhanh} (kỳ vọng bat,tat)`);
  const ids = [...new Set([...A.rows, ...B.rows].map((r) => r.id))];
  console.log(`\n══ SO SÁNH  bật=${nBat}  tắt=${nTat} ══`);
  console.log("| câu | đúng bật | đúng tắt | tool TV bật | tool TV tắt | ms TV bật | ms TV tắt |");
  console.log("|---|---|---|---|---|---|---|");
  for (const id of ids) {
    const a = A.rows.filter((r) => r.id === id), b = B.rows.filter((r) => r.id === id);
    console.log(`| ${id} | ${a.filter((r) => r.dung).length}/${a.length} | ${b.filter((r) => r.dung).length}/${b.length} | ` +
      `${trungVi(a.map((r) => r.soGoiTool)) ?? "—"} | ${trungVi(b.map((r) => r.soGoiTool)) ?? "—"} | ` +
      `${trungVi(a.map((r) => r.ms)) ?? "—"} | ${trungVi(b.map((r) => r.ms)) ?? "—"} |`);
  }
  const tong = (R) => ({ dung: R.rows.filter((r) => r.dung).length, n: R.rows.length, tool: trungVi(R.rows.map((r) => r.soGoiTool)),
    ms: trungVi(R.rows.map((r) => r.ms)), ra: trungVi(R.rows.map((r) => r.usage?.ra ?? 0)) });
  const ta = tong(A), tb = tong(B);
  console.log(`\n TỔNG bật: ${ta.dung}/${ta.n} (${pt(ta.dung, ta.n)}) · tool TV ${ta.tool} · ms TV ${ta.ms} · token ra TV ${ta.ra}`);
  console.log(` TỔNG tắt: ${tb.dung}/${tb.n} (${pt(tb.dung, tb.n)}) · tool TV ${tb.tool} · ms TV ${tb.ms} · token ra TV ${tb.ra}`);
  const c1 = ta.n > 0 && ta.dung / ta.n >= 0.8;
  const c2 = ta.tool != null && tb.tool != null && ta.tool < tb.tool;
  console.log(` CỔNG (1) đúng tệp:dòng ≥ 80 % khi bật: ${c1 ? "ĐẠT" : "CHƯA"} · (2) tool trung vị bật < tắt (${ta.tool} vs ${tb.tool}): ${c2 ? "ĐẠT" : "CHƯA"}`);
  process.exit(0);
}

if (!["kiem", "agent"].includes(CONFIG)) { console.error(`--config lạ: ${CONFIG}`); process.exit(2); }

let DS_CAU = docCau();
if (ONLY) {
  const ds = ONLY.split(",");
  DS_CAU = DS_CAU.filter((c) => ds.some((x) => c.id === x || c.id.startsWith(`${x}-`) || (x.length === 1 && c.id.startsWith(x))));
}
if (!DS_CAU.length) { console.error("Không có câu nào khớp --only"); process.exit(2); }

// ── KIỂM THƯỚC (luôn chạy; agent chỉ đi tiếp khi ĐẠT) ─────────────────────────────────────────────────
function cungThuMuc(c) {
  const d = path.dirname(path.join(ROOT, c.tep));
  return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && /\.(ts|mjs|js|py|cs)$/.test(e.name))
    .map((e) => path.posix.join(path.posix.dirname(c.tep), e.name)).filter((f) => f !== c.tep).sort();
}
function kiemThuoc({ im }) {
  const bo = boTraLoiKiemThuoc(DS_CAU, cungThuMuc);
  const ky = kyVongKiemThuoc(DS_CAU);
  let ok = true;
  for (const [ten, traLoi] of Object.entries(bo)) {
    const kq = DS_CAU.map((c, i) => chamCau(c, traLoi[i]));
    const dung = kq.filter((k) => k.dung).length;
    const dat = dung === ky[ten];
    ok &&= dat;
    if (!im || !dat) {
      console.log(`  ${dat ? "✓" : "✗"} ${ten.padEnd(12)} ${dung}/${DS_CAU.length} (${pt(dung, DS_CAU.length)}), kỳ vọng ${ky[ten]}`);
      if (!dat) DS_CAU.forEach((c, i) => {
        const kyCau = ten === "dung" || (ten === "sai-dong" && !c.doiDong);
        if (kq[i].dung !== kyCau) console.log(`      ${c.id}: chấm=${kq[i].dung} dòng nêu=[${kq[i].dongNeu}] ⇐ ${JSON.stringify(traLoi[i])}`);
      });
    }
  }
  return ok;
}

const lechMa = kiemDapAn(DS_CAU);
if (lechMa.length) {
  console.error(`⛔ ĐÁP ÁN LỆCH MÃ (chạy lại chuanBi.mjs rồi kiểm thước):\n  ${lechMa.join("\n  ")}`);
  process.exit(2);
}

if (CONFIG === "kiem") {
  console.log(`\n══ KIỂM THƯỚC bộ tìm mã (${DS_CAU.length} câu; repo chính ${DS_CAU.filter((c) => !c.duAn).length}, agent-f ${DS_CAU.filter((c) => c.duAn).length}) ══`);
  const ok = kiemThuoc({ im: false });
  console.log(` KIỂM THƯỚC: ${ok ? "ĐẠT" : "HỎNG — VỨT MỌI SỐ ĐO CHO TỚI KHI SỬA BỘ ĐO"}`);
  process.exit(ok ? 0 : 1);
}

// Windows: `process.exit` khi còn socket fetch keep-alive ⇒ libuv assert (mã thoát 127 thay vì 2). Đường agent NÉM
// `Thoat` và đặt `process.exitCode` để Node tự thoát sạch.
class Thoat extends Error { constructor(ma) { super(`thoát ${ma}`); this.ma = ma; } }
const thoat = (ma) => { throw new Thoat(ma); };

async function doAgent() {
// ── ĐO AGENT ────────────────────────────────────────────────────────────────────────────────────────
const NHANH = arg("--nhanh", null);
if (!["bat", "tat"].includes(NHANH)) {
  console.error("⛔ --config agent cần --nhanh bat|tat (bat = server KHÔNG đặt AI_AGENT_AN_CONG_CU; tat = server đặt AI_AGENT_AN_CONG_CU=find_symbol,search_code,search_docs)");
  thoat(2);
}
if (!kiemThuoc({ im: true })) { console.error("⛔ KIỂM THƯỚC HỎNG — không đo."); thoat(1); }

const SO_LUOT = Number(arg("--luot", 1));
const LABEL = arg("--label", `TM-${NHANH}-1`);
const BASE = (process.env.AI_EVAL_BASE || "http://127.0.0.1:3000").replace(/\/+$/, "");
const LLAMA = (process.env.AI_EVAL_LLAMA || "http://127.0.0.1:8091").replace(/\/+$/, "");
const PROJECT_ID = arg("--project-id", "repo");
const TRAN_MS = Number(arg("--tran-phut", 10)) * 60_000;

async function kiemSong(url, ten) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok && r.status !== 404) throw new Error("HTTP " + r.status);
  } catch (e) {
    console.error(`\n⛔ VỨT KẾT QUẢ: ${ten} KHÔNG khoẻ (${e}). Mọi số của lượt này VÔ GIÁ TRỊ.`);
    thoat(2);
  }
}
const congSucKhoe = async (luc) => { await kiemSong(`${LLAMA}/health`, `llama-server (${luc})`); await kiemSong(`${BASE}/`, `server ${BASE} (${luc})`); };

const { ck } = await import("../cookie.mjs");
const cookie = ck(arg("--cookie", `${ROOT}/tmp/audit-ai/ck.txt`));
await congSucKhoe("trước");

const rows = [];
for (let luot = 1; luot <= SO_LUOT; luot++) {
  for (const c of DS_CAU) {
    process.stderr.write(`▶ ${c.id} lượt ${luot} … `);
    const g = await hoiAgent({ base: BASE, cookie, cauHoi: c.cauHoi, projectId: PROJECT_ID, tranMs: TRAN_MS });
    if (g.http === 404) { console.error(`\n⛔ VỨT: ${BASE}/api/ai/agent/runs trả 404 — API agent chưa có trên server này.`); thoat(2); }
    await congSucKhoe(`sau ${c.id} lượt ${luot}`);
    const traLoi = vanBanCham(g);
    const kq = chamCau(c, traLoi);
    const toolMoiOk = TOOL_MOI.reduce((s, t) => s + (g.toolOk[t] ?? 0), 0);
    const toolMoiGoi = TOOL_MOI.reduce((s, t) => s + (g.tool[t] ?? 0), 0);
    rows.push({ id: c.id, luot, dung: kq.dung, cham: kq, ms: g.ms, ttftMs: g.ttftMs, soGoiTool: g.soGoiTool, luotMax: g.luotMax,
      tool: g.tool, toolOk: g.toolOk, toolLoi: g.toolLoi, toolMoiGoi, toolMoiOk, usage: g.usage, usageCuoi: g.usageCuoi,
      ctxMax: g.ctxMax, lyDo: g.lyDo, loi: g.loi, runId: g.runId, hetGioClient: g.hetGioClient,
      traLoi: g.chuCuoi.slice(0, 6000), tomTat: g.tomTat });
    console.error(`${kq.dung ? "ĐÚNG" : "SAI"}  tệp=${kq.nhacTep ? "✓" : "✗"}${c.doiDong ? ` dòng=${kq.dongDung ? "✓" : "✗"}[${kq.dongNeu.slice(0, 4)}]` : ""}` +
      `  ${g.ms}ms · ${g.soGoiTool} tool (${Object.entries(g.tool).map(([k, v]) => `${k}×${v}`).join(" ") || "—"}) · ra ${g.usage.ra} tok · ${g.lyDo ?? "?"}` +
      `${g.loi.length ? `  [${g.loi.join("; ").slice(0, 200)}]` : ""}`);
    if (NHANH === "tat" && toolMoiOk > 0) {
      console.error(`\n⛔ VỨT: nhánh TẮT nhưng tool mới chạy THÀNH CÔNG ${toolMoiOk} lần (${c.id}) — server chưa đặt AI_AGENT_AN_CONG_CU (hoặc chưa khởi động lại).`);
      thoat(2);
    }
  }
}
await congSucKhoe("sau");

fs.mkdirSync(DIR_BC, { recursive: true });
fs.writeFileSync(path.join(DIR_BC, `${LABEL}.json`), JSON.stringify({ label: LABEL, bo: "tim-ma", nhanh: NHANH, base: BASE,
  projectId: PROJECT_ID, luc: new Date().toISOString(), soCau: DS_CAU.length, soLuot: SO_LUOT, rows }, null, 1));

const dung = rows.filter((r) => r.dung).length;
console.log(`\n══ ${LABEL} (nhánh ${NHANH}, ${DS_CAU.length} câu × ${SO_LUOT} lượt) ══`);
console.log("| câu | đúng | tệp | dòng | tool TV | ms TV | tool đã dùng | lý do dừng |");
console.log("|---|---|---|---|---|---|---|---|");
for (const c of DS_CAU) {
  const g = rows.filter((r) => r.id === c.id);
  const dem = (f) => `${g.filter(f).length}/${g.length}`;
  const dung1 = g.reduce((m, r) => { for (const [k, v] of Object.entries(r.tool)) m[k] = (m[k] ?? 0) + v; return m; }, {});
  const dungTool = Object.entries(dung1).map(([k, v]) => `${k}×${v}`).join(" ") || "—";
  const dungLy = Object.entries(g.reduce((m, r) => ((m[r.lyDo ?? "?"] = (m[r.lyDo ?? "?"] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(" ");
  console.log(`| ${c.id} | ${dem((r) => r.dung)} | ${dem((r) => r.cham.nhacTep)} | ${c.doiDong ? dem((r) => r.cham.dongDung) : "—"} | ` +
    `${trungVi(g.map((r) => r.soGoiTool))} | ${trungVi(g.map((r) => r.ms))} | ${dungTool} | ${dungLy} |`);
}
console.log(`\n TỔNG: ${dung}/${rows.length} ĐÚNG (${pt(dung, rows.length)}) · tool trung vị ${trungVi(rows.map((r) => r.soGoiTool))} · ` +
  `ms trung vị ${trungVi(rows.map((r) => r.ms))} · token ra trung vị ${trungVi(rows.map((r) => r.usage.ra))}`);
console.log(` phụ: nêu tệp gọi ${pt(rows.filter((r) => r.cham.nhacTepGoi).length, rows.length)} · chỉ tên tệp trần ${rows.filter((r) => r.cham.chiTenTep).length}` +
  ` · tool mới gọi ${rows.reduce((s, r) => s + r.toolMoiGoi, 0)} (thành công ${rows.reduce((s, r) => s + r.toolMoiOk, 0)})`);
if (NHANH === "bat" && rows.every((r) => r.toolMoiGoi === 0)) {
  console.log(" ⚠ nhánh BẬT nhưng model KHÔNG gọi tool mới lần nào — kiểm server có đang chạy với AI_AGENT_AN_CONG_CU hay bản chưa có tool Đợt 2.");
}
console.log(` báo cáo: ${path.join(DIR_BC, `${LABEL}.json`)}`);
console.log(` so sánh: node scripts/ai-eval/codegen-chay-duoc/tim-ma/run-tim-ma.mjs --so-sanh <nhãn bật>,<nhãn tắt>`);
}

try {
  await doAgent();
} catch (e) {
  if (e instanceof Thoat) process.exitCode = e.ma;
  else throw e;
}
