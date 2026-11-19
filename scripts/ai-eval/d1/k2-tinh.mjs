#!/usr/bin/env node
/**
 * Lô D1-script — K2 (TĨNH): danh sách script gọi llama-server không được HỤT, và các chỗ đã sửa còn đúng hình.
 *
 *   node scripts/ai-eval/d1/k2-tinh.mjs [--them-goc D:/DO-AI]
 *
 * 1. `git grep -l` 8091 / LLAMA_SERVER_URL / --raw-url / --openai trong scripts/ (bỏ *.md, *.json, test). Mỗi tệp tìm được PHẢI có trong
 *    DA_PHAN_LOAI (đã sửa / chỉ /health / không gọi :8091 kèm lý do). Tệp lạ ⇒ ĐỎ: danh sách K1 bị hụt.
 * 2. Mỗi tệp nhóm 1 phải import tieuDeLlama.mjs; mỗi tệp nhóm 2 không còn `curl … 8091`.
 * 3. doi-model.ps1 có `--api-key-file`; start-llama-server.ps1 có che '<che>' ở -InThamSo; khoi-llama-tay.ps1 có -ChiKiem trước Start-Process.
 * Chỉ ĐỌC tệp trong repo (và thư mục --them-goc nếu có). Không mạng, không chạy script nào.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const NHOM1 = [
  "scripts/ai-eval/bo-nho/tai-dai.mjs", "scripts/ai-eval/bo-nho/tai-hoi-thoai.mjs", "scripts/ai-eval/thi-giac/tai-chung-tien-to.mjs",
  "scripts/ai-eval/thi-giac/do-doc-anh.mjs", "scripts/ai-eval/codegen-chay-duoc/run.mjs", "scripts/ai-eval/ngau-nhien/lib/goiModel.mjs",
  "scripts/ai-eval/eval-toolcall.mjs", "scripts/ai-eval/flow-tin-cay/do-tin-cay-35b.mjs", "scripts/ai-eval/trich-xuat/do.mts",
  "scripts/ai-eval/trich-xuat/do-chen.mts", "scripts/ai-eval/mo-ta-luong/chay.mts",
];
const NHOM2 = [
  "scripts/ai-eval/thi-giac/do-bat-auto.sh", "scripts/ai-eval/thi-giac/do-cong-a.sh", "scripts/ai-eval/thi-giac/do-e2e-lai.sh",
  "scripts/ai-eval/bo-nho/kiem-doi-gan-35b.sh", "scripts/ai-eval/bo-nho/do-bo-nho-llama.sh", "scripts/ai-eval/thi-giac/do-thi-giac.sh",
];
/** Tệp nhắc tới :8091 / URL nhưng KHÔNG tự gửi yêu cầu sinh thiếu khoá — kèm lý do (đọc từng chỗ, lô D1-script 19/11). */
const KHAC = {
  "scripts/ai-eval/ngau-nhien/mot-luot.mjs": "gọi qua goiModel.mjs (nhóm 1)",
  "scripts/ai-eval/ngau-nhien/multipl-e/run.mjs": "--raw-url chuyển cho goiModel.mjs",
  "scripts/ai-eval/tasks/run-eval.mjs": "nhóm 4 — đã gửi khoá (tieuDeKhoa)",
  "scripts/ai/start-llama-server.ps1": "đường dựng; --api-key-file sẵn có",
  "scripts/ai/khoi-llama-tay.ps1": "đường dựng (mới, lô này)",
  "scripts/ai-eval/codegen-chay-duoc/doi-model.ps1": "đường dựng; --api-key-file (lô này)",
  "scripts/ai-eval/lib/tieuDeLlama.mjs": "thư viện khoá (lô này)",
  "scripts/ai-eval/lib/goi-llama.mjs": "thư viện gọi (lô này)",
  "scripts/ai-eval/d1/k2-tinh.mjs": "chính tệp này",
  "scripts/ai-eval/d1/kho-ps.mjs": "chạy khô, không chạm :8091",
  "scripts/ai-eval/d1/k1-may-gia.mjs": "K1, máy chủ giả",
  "scripts/ai/kiem-he-thong.mjs": "nhóm 3 — chỉ /health (chờ K3 đo tập công khai)",
  "scripts/ai-eval/codegen-chay-duoc/agent-f/run-f.mjs": "nhóm 3 — chỉ /health",
  "scripts/ai-eval/codegen-chay-duoc/agentic.mjs": "nhóm 3 — chỉ /health",
  "scripts/ai-eval/codegen-chay-duoc/tim-ma/run-tim-ma.mjs": "nhóm 3 — chỉ /health",
  "scripts/ai-eval/ngau-nhien/agent.mjs": "nhóm 3 — chỉ /health",
  "scripts/ai-eval/vscode-e2e/run.mjs": "nhóm 3 — chỉ /health",
  "scripts/ai-eval/vscode-e2e/kiem-thuoc.mjs": "không gọi :8091 (kiểm kê 17/11)",
  "scripts/ai-eval/vscode-e2e/lib/mayChuGia.mjs": "máy chủ giả",
  "scripts/ai-eval/fim/chay-fim.mts": "không gọi :8091 (kiểm kê 17/11)",
  "scripts/ai-eval/dem-doi-khe.mjs": "không gọi :8091 (kiểm kê 17/11)",
  "scripts/ai-eval/eval-toolloop-multistep.mts": "chỉ chú thích; lối gọi thật qua app",
  "scripts/ai-eval/bo-nho/do-dau-chan-4b-3000.sh": "chỉ đọc PID/VRAM; yêu cầu qua :3000 /v1",
  "scripts/ai-eval/bo-nho/do-ctx-checkpoints.sh": "gọi doi-model.ps1 + tai-hoi-thoai.mjs (đã sửa)",
  "scripts/tho-ca-pilot/driverHost.ts": "chỉ kiểm biến LLAMA_SERVER_URL có mặt",
  "scripts/tho-ca-pilot/napEnv.ts": "nạp ĐƯỜNG DẪN tệp khoá (nhóm 5, đã đúng)",
  "scripts/tho-ca-pilot/kiemChung.ts": "gỡ *_KEY_FILE khỏi con (nhóm 5, đã đúng)",
  "scripts/verify/llama-server-proof.mts": "máy chủ giả cổng ngẫu nhiên",
  "scripts/scada-1a-bench.ts": "kiểm kê 17/11: không gọi :8091",
  "scripts/scada-r1a-bench.ts": "kiểm kê 17/11: không gọi :8091",
  "scripts/scada-r1b-bench.ts": "kiểm kê 17/11: không gọi :8091",
};
const DA_PHAN_LOAI = new Set([...NHOM1, ...NHOM2, ...Object.keys(KHAC)]);

const doc = (f) => fs.readFileSync(path.join(GOC, f), "utf8");
const loi = [];
const tim = execFileSync("git", ["grep", "-l", "-E", "8091|LLAMA_SERVER_URL|--raw-url|--openai", "--", "scripts",
  ":!*.md", ":!*.json", ":!*.test.ts", ":!*.test.mjs", ":!scripts/ai-eval/ai-bench/**"], { cwd: GOC, encoding: "utf8" })
  .split(/\r?\n/).filter(Boolean);
for (const f of tim) if (!DA_PHAN_LOAI.has(f)) loi.push(`TỆP CHƯA PHÂN LOẠI: ${f}`);
for (const f of NHOM1) if (!/tieuDeLlama\.mjs"/.test(doc(f))) loi.push(`nhóm 1 thiếu import tieuDeLlama: ${f}`);
for (const f of NHOM2) if (/curl[^\n|]*8091/.test(doc(f))) loi.push(`nhóm 2 còn curl :8091: ${f}`);
if (!/--api-key-file/.test(doc("scripts/ai-eval/codegen-chay-duoc/doi-model.ps1"))) loi.push("doi-model.ps1 thiếu --api-key-file");
const dongMa = (s) => s.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n"); // bỏ dòng chú thích PowerShell
if (/Get-Process llama-server[^\n]*\|\s*Stop-Process/.test(dongMa(doc("scripts/ai-eval/codegen-chay-duoc/doi-model.ps1")))) loi.push("doi-model.ps1 còn giết theo tên");
if (!/'<che>'/.test(doc("scripts/ai/start-llama-server.ps1"))) loi.push("start-llama-server.ps1 thiếu che <che>");
if (/-like 'llama-server\*'/.test(dongMa(doc("scripts/ai/start-llama-server.ps1")))) loi.push("start-llama-server.ps1 -Force còn so tên llama-server*");
if (!/CreationDate -ne \$daKiem/.test(doc("scripts/ai/start-llama-server.ps1"))) loi.push("start-llama-server.ps1 -Force thiếu đọc lại CreationDate");
const tay = doc("scripts/ai/khoi-llama-tay.ps1");
if (!(tay.indexOf("if ($ChiKiem)") > 0 && tay.indexOf("if ($ChiKiem)") < tay.indexOf("Start-Process"))) loi.push("khoi-llama-tay: -ChiKiem không đứng trước Start-Process");

// D1c C2 (HST 03:03): dòng .sh dưới scripts/ GHI LOG CommandLine llama (`log` + `CommandLine`) mà không chỉ `grep -o`/`grep -q` một cờ
// ⇒ phải che `<tep-khoa>` (không lộ đường tệp khoá). Duyệt bằng fs, không thêm lời gọi tiến trình.
const tepSh = []; const quetSh = (d) => { for (const t of fs.readdirSync(path.join(GOC, d), { withFileTypes: true })) { const r = `${d}/${t.name}`; if (t.isDirectory()) quetSh(r); else if (r.endsWith(".sh")) tepSh.push(r); } };
quetSh("scripts");
for (const f of tepSh) for (const d of doc(f).split("\n")) if (/CommandLine/.test(d) && /\blog\b/.test(d) && !/grep -[oq]/.test(d) && !/<tep-khoa>/.test(d) && !d.trim().startsWith("#")) loi.push(`${f}: dòng ghi log CommandLine chưa che <tep-khoa>`);
// D1c C4 (HST 20/11 04:08): KHÔNG .sh nào dưới scripts/ chép `.env` (cp …/.env …); `.env.example` không tính.
for (const f of tepSh) for (const d of doc(f).split("\n")) if (/\bcp\b/.test(d) && /(?<![\w.-])\.env(?![\w.-])/.test(d) && !d.trim().startsWith("#")) loi.push(`${f}: dòng chép .env`);
const goc2 = (() => { const i = process.argv.indexOf("--them-goc"); return i > 0 ? process.argv[i + 1] : ""; })();
if (goc2) {
  // Thư mục ngoài repo (D:/DO-AI): chỉ LIỆT KÊ tệp có 8091 kèm lời gọi (fetch/curl/Invoke-WebRequest) để người rà phân loại; không tính đỏ.
  const ds = [];
  const duyet = (d) => { for (const t of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, t.name); if (t.isDirectory()) { if (!/node_modules|\.git/.test(t.name)) duyet(p); } else if (/\.(mjs|mts|ts|js|sh|ps1)$/.test(t.name)) { const s = fs.readFileSync(p, "utf8"); if (/8091/.test(s) && /fetch\(|curl|Invoke-WebRequest/.test(s)) ds.push(p); } } };
  duyet(goc2);
  console.log(`ngoài repo (${goc2}): ${ds.length} tệp có 8091 + lời gọi — cần phân loại tay:`);
  for (const p of ds) console.log(`  ${p}`);
}
console.log(`K2: ${tim.length} tệp nhắc tới; ${loi.length} lỗi`);
for (const l of loi) console.log(`  ĐỎ ${l}`);
process.exitCode = loi.length ? 1 : 0;
