#!/usr/bin/env node
/**
 * Lưới trước gộp: chạy vitest theo lô, rồi chạy LẠI RIÊNG từng tệp đỏ để tách
 * "đỏ thật" (đỏ cả khi chạy riêng) khỏi "đỏ do tải song song" (xanh khi chạy riêng).
 *
 * Dùng:
 *   node scripts/luoi-truoc-gop.mjs                       # lô mặc định
 *   node scripts/luoi-truoc-gop.mjs server/routers shared # tự chọn thư mục/tệp
 *   node scripts/luoi-truoc-gop.mjs --tu-json run.json    # bỏ bước lô, dùng báo cáo JSON có sẵn
 *   node scripts/luoi-truoc-gop.mjs --nen main-do.txt     # danh sách tệp đỏ có sẵn trên main (mỗi dòng một tệp)
 *   --ra <thư mục>   nơi ghi báo cáo (mặc định .luoi-truoc-gop/)
 *   --co-vitest "a b" tham số thêm cho vitest
 *
 * Mã thoát: 0 = không còn đỏ THẬT; 1 = còn ít nhất một tệp đỏ khi chạy riêng.
 * Tệp đỏ-chỉ-khi-song-song được liệt kê riêng (nhiễu), KHÔNG làm thoát 1 — nhưng vẫn phải đọc.
 * Chỉ dùng DB `_test` (vitest.setup ép DATABASE_URL). Không đụng GPU/llama-server.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";

const DEFAULT_TARGETS = ["server/_core", "server/routers", "server/routes", "client/src/lib", "server/services", "shared"];
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [v] = args.splice(i, 2).slice(1);
  return v ?? null;
};
const tuJson = opt("--tu-json");
const nenFile = opt("--nen");
const outDir = resolve(opt("--ra") ?? ".luoi-truoc-gop");
const extra = (opt("--co-vitest") ?? "").split(/\s+/).filter(Boolean);
const targets = args.length ? args : DEFAULT_TARGETS;
mkdirSync(outDir, { recursive: true });

const root = process.cwd();
const rel = (p) => relative(root, p).replaceAll("\\", "/");
const vitest = (files, jsonOut) =>
  spawnSync("npx", ["vitest", "run", ...files, ...extra, "--reporter=json", `--outputFile=${jsonOut}`], {
    shell: true, stdio: ["ignore", "ignore", "ignore"], cwd: root,
  }).status;

/** Đọc báo cáo JSON → { tệp: {fail, msg} } cho tệp đỏ. */
function doTepDo(jsonPath) {
  const j = JSON.parse(readFileSync(jsonPath, "utf8"));
  const out = new Map();
  for (const r of j.testResults ?? []) {
    if (r.status !== "failed") continue;
    const bad = (r.assertionResults ?? []).filter((a) => a.status === "failed");
    const first = bad[0]?.failureMessages?.[0] ?? r.message ?? "";
    out.set(rel(r.name), { fail: bad.length, msg: first.split("\n")[0].slice(0, 160) });
  }
  return { red: out, total: j.numTotalTests, failed: j.numFailedTests };
}

// 1. LÔ
let batchJson = tuJson;
if (!batchJson) {
  batchJson = resolve(outDir, "lo.json");
  console.log(`[lô] vitest run ${targets.join(" ")}`);
  vitest(targets, batchJson);
}
if (!existsSync(batchJson)) { console.error("Không có báo cáo JSON của lô (vitest chết sớm?)"); process.exit(2); }
const lo = doTepDo(batchJson);
console.log(`[lô] ${lo.total} ca, ${lo.failed} đỏ, ${lo.red.size} tệp đỏ`);

// 2. CHẠY RIÊNG từng tệp đỏ
const nen = nenFile && existsSync(nenFile)
  ? new Set(readFileSync(nenFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) : null;
const rows = [];
for (const [file, info] of lo.red) {
  const j = resolve(outDir, "rieng-" + file.replace(/[\\/]/g, "_") + ".json");
  console.log(`[riêng] ${file}`);
  vitest([file], j);
  let again = "?";
  let msg = info.msg;
  if (existsSync(j)) {
    const r = doTepDo(j);
    again = r.red.size ? "ĐỎ" : "xanh";
    if (r.red.size) msg = [...r.red.values()][0].msg;
  }
  rows.push({ file, loFail: info.fail, rieng: again, msg, coSanTrenMain: nen ? (nen.has(file) ? "có" : "KHÔNG") : "-" });
}

// 3. TÓM TẮT
const that = rows.filter((r) => r.rieng !== "xanh");
const nhieu = rows.filter((r) => r.rieng === "xanh");
const bang = (rs) => rs.map((r) => `| ${r.file} | ${r.loFail} | ${r.rieng} | ${r.coSanTrenMain} | ${r.msg.replaceAll("|", "\\|")} |`).join("\n");
const head = "| tệp | ca đỏ trong lô | chạy riêng | có sẵn trên main | lỗi đầu |\n|---|---|---|---|---|\n";
const md = `# Lưới trước gộp\n\nLô: ${lo.total} ca, ${lo.failed} đỏ, ${lo.red.size} tệp đỏ.\n\n## ĐỎ THẬT (${that.length})\n\n${head}${bang(that)}\n\n## ĐỎ CHỈ KHI SONG SONG (${nhieu.length})\n\n${head}${bang(nhieu)}\n`;
writeFileSync(resolve(outDir, "tom-tat.md"), md);
console.log("\n" + md);
console.log(`Báo cáo: ${rel(resolve(outDir, "tom-tat.md"))}`);
process.exit(that.length ? 1 : 0);
