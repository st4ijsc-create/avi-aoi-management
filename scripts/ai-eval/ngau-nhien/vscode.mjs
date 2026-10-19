/**
 * ĐƯỜNG (c) — EXTENSION VSCODE HEADLESS trên bài ngẫu nhiên: chọn bài (seed, phân tầng) rồi giao cho
 * `scripts/ai-eval/vscode-e2e/run.mjs` (mã THẬT của extension, `vscode` giả trên đĩa thật, canh ghi-ngoài/rò bí mật/sổ).
 *
 *   node scripts/ai-eval/ngau-nhien/vscode.mjs [--seed s] [--n 8 | --tat-ca] [--only …] [--moi-muc] -- <tham số của vscode-e2e/run.mjs>
 *   vd kiểm thước:  … vscode.mjs --tat-ca -- --config mau --label NN-c-mau-1     (phải 100 %)
 *                   … vscode.mjs --tat-ca -- --config goc --label NN-c-goc-1     (phải 0 %)
 *                   … vscode.mjs --tat-ca -- --config dung --label NN-c-dung-1   (model GIẢ qua extension ⇒ 100 %, 0 ngoài, 0 rò)
 *                   … vscode.mjs --tat-ca -- --config sua-test --label NN-c-suatest-1  (phải 0 %, mọi lượt TEP_TEST_BI_SUA)
 *   đo thật:        AI_EVAL_BASE=… AI_EVAL_TOKEN=avgw_… node … vscode.mjs --seed s --n 8 -- --config that --label NN-c-that-1
 *
 * Mặc định CHỈ bài `ung-dung` (lát NHIỀU TỆP); `--moi-muc` lấy mọi mức. Chỉ kiểu node/pytest/dotnet (bộ chấm vscode-e2e).
 * Trạng thái test hiển thị trên khung (đỏ/xanh) được đo TRƯỚC ở đây và truyền cho harness (nó kiểm lại, lệch ⇒ exit 2).
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, BO, PYTHON } from "./lib/moiTruong.mjs";
import { docKho } from "./lib/kho.mjs";
import { chonPhanTang } from "./lib/chon.mjs";
import { chamDuAn, dungKhung, xoaThuMuc } from "./lib/cham.mjs";
import { hopLeVscode } from "./vscode-ngan-hang.mjs";

const all = process.argv.slice(2);
const cat = all.indexOf("--");
const args = cat >= 0 ? all.slice(0, cat) : all;
const truyen = cat >= 0 ? all.slice(cat + 1) : [];
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const SEED = arg("--seed", null) ?? `t${Date.now()}`;
const KHO = docKho({ only: arg("--only", null) }).filter(hopLeVscode).filter((b) => args.includes("--moi-muc") || b.muc === "ung-dung");
const DS = chonPhanTang(KHO, { seed: SEED, n: args.includes("--tat-ca") ? KHO.length : Number(arg("--n", 8)) });
if (!DS.length) { console.error("Không có bài hợp lệ cho đường (c) (node/pytest/dotnet, không cần node_modules repo)."); process.exit(2); }
console.error(`ℹ đường (c): seed=${SEED} · ${DS.length} bài: ${DS.map((b) => b.id).join(", ")}`);

const WORK = `${ROOT}/tmp/ngau-nhien-work/vscode-chon-${process.pid}`;
const chon = [];
for (const b of DS) {
  dungKhung(b, `${WORK}/${b.id}`);
  const kq = await chamDuAn({ bai: b, thuMuc: `${WORK}/${b.id}`, chiHienThi: true });
  chon.push({ id: b.id, hienThiDoTruoc: !kq.dat });
}
xoaThuMuc(WORK);

// `python` trên PATH máy này có thể là bí danh WindowsApps ⇒ đặt thư mục python thật lên đầu PATH cho tiến trình con.
const env = { ...process.env, AI_EVAL_NGAN_HANG: path.join(BO, "vscode-ngan-hang.mjs"), AI_EVAL_NN_CHON: JSON.stringify(chon), AI_EVAL_NN_SEED: SEED };
const khoaPath = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
env[khoaPath] = [path.dirname(PYTHON).replace(/\//g, path.sep), env[khoaPath]].join(path.delimiter);
const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/ai-eval/vscode-e2e/run.mjs"), ...truyen], { stdio: "inherit", env, cwd: ROOT });
console.error(`ℹ đường (c) seed=${SEED} (ghi seed này cạnh nhãn báo cáo vscode-e2e/reports/<nhãn>.json)`);
process.exit(r.status ?? 2);
