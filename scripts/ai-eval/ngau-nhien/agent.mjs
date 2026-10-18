/**
 * ĐƯỜNG (b) — CHẾ ĐỘ AGENT MÁY CHỦ: `POST /api/ai/agent/runs` (SSE, client `agent-f/khachAgent.mjs`) — model tự
 * đọc/ghi/chạy lệnh trong dự án bài, rồi MÁY CHẤM chạy test hiển thị + ẩn (không tin lời khai của agent).
 *
 *   --config agent                      đo thật (AI_EVAL_BASE, mặc định http://127.0.0.1:3000; cookie tmp/audit-ai/ck.txt)
 *   --config mau|khung|gian-lan|sai     KIỂM THƯỚC đường (b) trên CHÍNH mẫu được chọn, cùng thư mục/cùng cách dọn:
 *                                       mau 100 % · khung 0 % · gian-lan 0 % và MỌI lượt TEP_TEST_BI_SUA · sai 0 %
 *
 * NƠI LÀM: `tmp/ngau-nhien-agent/<id>` TRONG repo của server đo (projectId "repo" = gốc repo). Vì sao `tmp/` (đã
 * .gitignore) mà không `sandbox-projects/` như bộ F: hàng rào ghi của agent từ chối ghi đè tệp git-BẨN — tệp CHƯA
 * commit (`??`) là bẩn ⇒ dự án bài chưa commit đặt trong sandbox-projects/ sẽ chặn MỌI lượt sửa tệp khung (hiện vật
 * của bộ đo). Tệp bị .gitignore thì `git status --porcelain -- <tệp>` rỗng ⇒ được coi là sạch ⇒ ghi được; xoá/đổi tên
 * tệp bị ignore vẫn bị chặn (`--ignored`) — bài không cần xoá tệp. Mỗi lượt dựng lại thư mục TỪ KHUNG (chép), không git.
 * ⚠ Server đo phải chạy từ CÙNG repo với script này (vd :3010 từ worktree `_ai7_wt`) — nếu không, agent không thấy
 *   `tmp/ngau-nhien-agent/…` ⇒ đặt `--tien-to` cho đúng hoặc chạy script từ repo của server.
 *
 * Chọn bài như đường (a): --seed · --n · --tat-ca · --only · --luot. Khác: --tran-phut (25) · --project-id (repo) ·
 * --tien-to <đường dự án viết vào câu hỏi> (mặc định tmp/ngau-nhien-agent/<id>) · --giu (giữ thư mục để soi) · --label.
 * ★ 2026-10-18 — `--goc-bai <đường tương đối repo>`: dựng MỌI bài (lần lượt) vào ĐÚNG một thư mục cố định và coi nó là GỐC
 *   dự án của agent (câu hỏi nói "dự án này", đường tính từ gốc). Bắt buộc với C++/Go/Rust nếu muốn agent TỰ chạy test:
 *   khuôn `cmake -S . -B <dựng>` / `go test ./...` / `cargo test --offline` (repoCommandSandbox 241e1880f) không có ô
 *   đường — chỉ chạy ở gốc dự án có CMakeLists.txt/go.mod/Cargo.toml. Phía server: thêm một mục vào AI_REPO_SANDBOX_ROOTS
 *   trỏ đúng thư mục ấy, vd `nnbai=Bai ngau nhien|D:\SOURCES\_ai7_wt\tmp\ngau-nhien-agent\_bai`, rồi
 *   `--project-id nnbai --goc-bai tmp/ngau-nhien-agent/_bai`. Không có cờ này ⇒ như cũ (dự án `repo`, bài ở thư mục con):
 *   java/py/js/ts/cs/sql agent chạy được test; cpp/go/rs KHÔNG (cột "lệnh test trong khuôn" của báo cáo).
 * Cổng sức khoẻ: AI_EVAL_LLAMA/health (mặc định :8091) + BASE/ trước/sau MỖI bài; hỏng ⇒ exit 2, vứt số.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, BO, coToolchain } from "./lib/moiTruong.mjs";
import { docKho, lietKeTep } from "./lib/kho.mjs";
import { chonPhanTang } from "./lib/chon.mjs";
import { chamDuAn, dungKhung, apMau, apSai, apGianLan, xoaThuMuc, noiNodeModulesRepo } from "./lib/cham.mjs";
import { taoCauHoiAgent, lenhTest } from "./lib/cauHoi.mjs";
import { bangTomTat, trungVi } from "./lib/baoCao.mjs";
import { chayAgent } from "../codegen-chay-duoc/agent-f/khachAgent.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const co = (k) => args.includes(k);

const CONFIG = arg("--config", "agent");
if (!["agent", "mau", "khung", "gian-lan", "sai"].includes(CONFIG)) { console.error(`--config lạ: ${CONFIG}`); process.exit(2); }
const SEED = arg("--seed", null) ?? `t${Date.now()}`;
const KHO_LOC = docKho({ only: arg("--only", null) });
const N = co("--tat-ca") ? KHO_LOC.length : Number(arg("--n", 18));
const SO_LUOT = Math.max(1, Number(arg("--luot", 1)));
const LABEL = arg("--label", `NN-b-${CONFIG}-1`);
const BASE = (process.env.AI_EVAL_BASE || "http://127.0.0.1:3000").replace(/\/+$/, "");
const LLAMA = (process.env.AI_EVAL_LLAMA || "http://127.0.0.1:8091").replace(/\/+$/, "");
const PROJECT_ID = arg("--project-id", "repo");
const TRAN_MS = Number(arg("--tran-phut", 25)) * 60_000;
const TIEN_TO = arg("--tien-to", null);
const GIU = co("--giu");
const REL_GOC = "tmp/ngau-nhien-agent";
const GOC_BAI = arg("--goc-bai", null);
// ⚠ 2026-10-18 (lượt NN-b-agent-1 = 0/27 VÔ GIÁ TRỊ): gốc dưới `tmp/` của worktree vẫn nằm TRONG repo chính ⇒ cổng Q1
// (`laGhiVaoRepoChinh`) từ chối MỌI lượt ghi tự trị của `tu-dong` — đúng hành vi sản phẩm, sai thiết bị đo. Nay nhận thêm
// đường TUYỆT ĐỐI NGOÀI repo (vd `D:/SOURCES/_ai7_nnbai/_bai`) — khuyên dùng.
const GOC_BAI_TUYET_DOI = GOC_BAI !== null && /^[A-Za-z]:[\\/]/.test(GOC_BAI);
if (GOC_BAI !== null && !GOC_BAI_TUYET_DOI && (!/^tmp\/[A-Za-z0-9_./-]+$/.test(GOC_BAI) || GOC_BAI.includes(".."))) { console.error(`--goc-bai phải là đường dưới tmp/ hoặc tuyệt đối NGOÀI repo: ${GOC_BAI}`); process.exit(2); }
if (GOC_BAI_TUYET_DOI && (GOC_BAI.includes("..") || path.resolve(GOC_BAI).toLowerCase().startsWith(path.resolve(ROOT).toLowerCase()))) { console.error(`--goc-bai tuyệt đối phải NGOÀI repo (cổng Q1 chặn ghi tự trị trong repo chính): ${GOC_BAI}`); process.exit(2); }
if (GOC_BAI !== null && CONFIG === "agent" && PROJECT_ID === "repo") { console.error("--goc-bai cần --project-id trỏ đúng thư mục ấy (AI_REPO_SANDBOX_ROOTS), không phải 'repo'."); process.exit(2); }

const DS = chonPhanTang(KHO_LOC, { seed: SEED, n: N });
if (!DS.length) { console.error("Không có bài nào."); process.exit(2); }
const thieuTc = [...new Set(DS.filter((b) => !coToolchain(b.kieu)).map((b) => b.kieu))];
if (thieuTc.length) { console.error(`⛔ Thiếu toolchain cho: ${thieuTc.join(", ")}`); process.exit(2); }
console.error(`ℹ ${LABEL}: config=${CONFIG} · seed=${SEED} · ${DS.length} bài × ${SO_LUOT} lượt · nơi làm ${GOC_BAI ? `${GOC_BAI} (gốc dự án agent)` : `${REL_GOC}/<id>`}` +
  (CONFIG === "agent" ? ` · server ${BASE} · projectId ${PROJECT_ID}` : ""));
console.error(`  bài: ${DS.map((b) => b.id).join(", ")}`);

async function kiemSong(luc) {
  if (CONFIG !== "agent") return;
  for (const [url, ten] of [[`${LLAMA}/health`, `llama-server ${LLAMA}`], [`${BASE}/`, `server ${BASE}`]]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.status >= 500 || (url.endsWith("/health") && r.status !== 200)) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      console.error(`\n⛔ VỨT KẾT QUẢ: ${ten} KHÔNG khoẻ ${luc} (${e?.message ?? e}). Mọi số của lượt này VÔ GIÁ TRỊ.`);
      process.exit(2);
    }
  }
}

/** Tệp đã đổi so với khung (mới / sửa / mất), bỏ sản phẩm dựng. */
function soVoiKhung(b, dir, boQua = []) {
  const khung = new Set(lietKeTep(b.khungAbs));
  const nay = new Set(lietKeTep(dir).filter((r) => !boQua.includes(r)));
  const bang = (rel) => fs.readFileSync(`${b.khungAbs}/${rel}`).equals(fs.readFileSync(`${dir}/${rel}`));
  return {
    moi: [...nay].filter((r) => !khung.has(r)),
    doi: [...nay].filter((r) => khung.has(r) && !bang(r)),
    mat: [...khung].filter((r) => !nay.has(r)),
  };
}

let cookie = "";
if (CONFIG === "agent") {
  const { ck } = await import("../codegen-chay-duoc/cookie.mjs");
  cookie = ck(arg("--cookie", `${ROOT}/tmp/audit-ai/ck.txt`));
}
await kiemSong("trước");

const rows = [];
for (const b of DS) {
  for (let luot = 1; luot <= SO_LUOT; luot++) {
    const rel = GOC_BAI ?? `${REL_GOC}/${b.id}`;
    const daCauHoi = GOC_BAI ? null : TIEN_TO ? `${TIEN_TO}/${b.id}` : rel;
    const dir = GOC_BAI_TUYET_DOI ? GOC_BAI : `${ROOT}/${rel}`;
    dungKhung(b, dir);
    // ★ 2026-10-19 (js-ud2-react: máy chấm 0/2 ở gốc ngoài repo — esbuild/react không với tới): junction node_modules ⇒ repo.
    const coJunction = noiNodeModulesRepo(b, dir);
    /** tệp do BỘ ĐO đặt vào gốc bài (không tính "tệp đã đổi") */
    const tepBoDo = [];
    // .gitignore TRƯỚC commit khung: git không được theo junction vào node_modules của repo.
    if (coJunction && GOC_BAI_TUYET_DOI && CONFIG === "agent" && !fs.existsSync(`${b.khungAbs}/.gitignore`)) {
      fs.writeFileSync(`${dir}/.gitignore`, "node_modules\n");
      tepBoDo.push(".gitignore");
    }
    // ⚠ 2026-10-18 (NN-b-agent-2 = 0/27 VÔ GIÁ TRỊ lần hai): công cụ ghi FAIL-CLOSED khi dự án KHÔNG có git (không kiểm được
    // "tệp bẩn") ⇒ agent không sửa được tệp khung nào. Dự án thật (3a) luôn có git; gốc tuyệt đối ngoài repo thì phải tự
    // `git init` + commit khung như một dự án thật mới tạo.
    if (GOC_BAI_TUYET_DOI && CONFIG === "agent") {
      for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-q", "--no-verify", "-m", `khung ${b.id}`]]) {
        const r = spawnSync("git", ["-c", "user.name=ngau-nhien", "-c", "user.email=ngau-nhien@local", "-c", "core.autocrlf=false", ...a], { cwd: dir, encoding: "utf8" });
        if (r.status !== 0) { console.error(`\n⛔ git ${a[0]} hỏng ở ${dir}: ${r.stderr}`); process.exit(2); }
      }
    }
    const row = { id: b.id, lang: b.lang, muc: b.muc, luot, vanTay: b.vanTay, config: CONFIG, agentChayDuocTest: lenhTest(b, daCauHoi).agentChayDuoc };
    process.stderr.write(`▶ ${b.id} (${b.lang}/${b.muc}) lượt ${luot} … `);
    if (CONFIG === "mau") apMau(b, dir);
    if (CONFIG === "sai") apSai(b, dir);
    if (CONFIG === "gian-lan") apGianLan(b, dir);
    if (CONFIG === "agent") {
      row.agent = await chayAgent({ base: BASE, cookie, projectId: PROJECT_ID, tranMs: TRAN_MS, cauHoi: taoCauHoiAgent(b, daCauHoi) });
      if (row.agent.http === 404) {
        console.error(`\n⛔ VỨT: ${BASE}/api/ai/agent/runs trả 404 — API agent chưa có trên server này.`);
        process.exit(2);
      }
      if (row.agent.http === 401 || row.agent.http === 403) {
        console.error(`\n⛔ VỨT: ${BASE} từ chối xác thực (HTTP ${row.agent.http}) — đăng nhập lại lấy cookie.`);
        process.exit(2);
      }
      await kiemSong(`sau ${b.id} lượt ${luot}`);
    }
    row.tepDaDoi = soVoiKhung(b, dir, tepBoDo);
    const kq = await chamDuAn({ bai: b, thuMuc: dir });
    row.dat = kq.dat;
    row.cham = { ...kq, duoiRa: kq.dat ? undefined : kq.duoiRa.slice(-1500) };
    rows.push(row);
    const a = row.agent;
    console.error(`${kq.dat ? "ĐẠT" : "TRƯỢT"}  ${kq.dem ? `${kq.dem.pass}✓/${kq.dem.fail}✗ (cần ≥${kq.canToiThieu})` : "không có tổng kết test"}` +
      `${kq.lyDo.length ? ` [${kq.lyDo.join(", ")}]` : ""} · đổi ${row.tepDaDoi.moi.length + row.tepDaDoi.doi.length + row.tepDaDoi.mat.length} tệp` +
      `${a ? ` · ${a.ms} ms · ${a.soGoiTool} tool · ra ${a.usage.ra} tok · ${a.lyDo ?? "?"}${a.loi.length ? ` · lỗi ${a.loi.length}` : ""}` : ""}`);
    if (!GIU) xoaThuMuc(dir);
  }
}
await kiemSong("sau");

// ── BÁO CÁO ──────────────────────────────────────────────────────────────────────────────────────────
const bang = bangTomTat(rows, { tieuDe: `${LABEL} — đường (b) agent máy chủ, config=${CONFIG}, seed=${SEED}` });
console.log(bang);
if (CONFIG === "agent") {
  const g = (f) => rows.filter(f);
  const ty = (xs) => `${xs.filter((r) => r.dat).length}/${xs.length}`;
  // Giữ CỘT tách hai nhóm (không gộp): từ 241e1880f ranh giới KHÔNG còn theo ngôn ngữ mà theo CHỖ ĐẶT bài — dự án `repo` +
  // thư mục con ⇒ cmake/go/cargo vẫn ngoài khuôn; `--goc-bai` ⇒ mọi bài trong khuôn (nhóm thứ hai rỗng, không in).
  const ngoai = g((r) => !r.agentChayDuocTest);
  console.log(` lệnh test hiển thị TRONG khuôn agent: ${ty(g((r) => r.agentChayDuocTest))}` +
    (ngoai.length ? ` · NGOÀI khuôn (cmake/go/cargo ở thư mục con — dùng --goc-bai): ${ty(ngoai)}` : " (mọi bài)"));
  console.log(` ms trung vị ${trungVi(rows.map((r) => r.agent.ms))} · tool trung vị ${trungVi(rows.map((r) => r.agent.soGoiTool))} · token ra trung vị ${trungVi(rows.map((r) => r.agent.usage.ra))}` +
    ` · dừng: ${Object.entries(rows.reduce((m, r) => ((m[r.agent.lyDo ?? "?"] = (m[r.agent.lyDo ?? "?"] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(" ")}`);
}
const suaTest = rows.filter((r) => r.cham.tepBaoVeBiSua.length).length;
if (suaTest) console.log(` ⚠ ${suaTest} lượt SỬA TỆP TEST/ CẤU HÌNH ĐƯỢC BẢO VỆ — tính TRƯỢT`);
const dirBc = `${BO}/reports`;
fs.mkdirSync(dirBc, { recursive: true });
fs.writeFileSync(`${dirBc}/${LABEL}.json`, JSON.stringify({
  label: LABEL, duong: "b-agent", config: CONFIG, seed: SEED, n: N, soLuot: SO_LUOT, luc: new Date().toISOString(),
  base: CONFIG === "agent" ? BASE : null, projectId: CONFIG === "agent" ? PROJECT_ID : null,
  bai: DS.map((b) => ({ id: b.id, lang: b.lang, muc: b.muc, vanTay: b.vanTay })), bang, rows,
}, null, 1));
console.log(` báo cáo: ${path.join(dirBc, `${LABEL}.json`)}`);

const dat = rows.filter((r) => r.dat).length;
const KY_VONG = {
  mau: () => dat === rows.length,
  khung: () => dat === 0,
  sai: () => dat === 0,
  "gian-lan": () => dat === 0 && rows.every((r) => r.cham.lyDo.includes("TEP_TEST_BI_SUA")),
};
if (CONFIG in KY_VONG) {
  const ok = KY_VONG[CONFIG]() && rows.length === DS.length * SO_LUOT;
  console.log(` KIỂM THƯỚC (b) ${CONFIG}: ${ok ? "ĐẠT" : "HỎNG — VỨT MỌI SỐ ĐO CHO TỚI KHI SỬA BỘ ĐO"} (${dat}/${rows.length} ĐẠT)`);
  process.exit(ok ? 0 : 1);
}
