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
 *   --nang           loại các tệp TẢI NẶNG (xem NANG bên dưới, có lý do từng tệp) khỏi lô thường và chạy chúng TUẦN TỰ sau cùng
 *   --khong-tach-db  chạy MỘT lô duy nhất (mặc định: lô thường loại `*.db.test.ts`, rồi lô DB riêng
 *                    chạy TUẦN TỰ bằng vitest.db.config.ts — loại nhiễu hết kết nối PG / dọn chồng DB dùng chung)
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
/**
 * Tệp TẢI NẶNG (khai MỘT chỗ). Mỗi tệp khẳng định một NGƯỠNG SẢN PHẨM bằng đồng hồ thật nên đỏ khi lô song song chiếm máy mà xanh khi
 * chạy một mình (đo 2026-10-21, lg3/lg4). KHÔNG nới ngưỡng — chạy chúng một mình, tuần tự, sau lô thường (cờ --nang).
 */
const NANG = [
  { tep: "server/services/edge/edgeJournal.dot10.test.ts", ly: "ca R-10-ag: 10 000 append trên journal ĐẦY phải < 15 s (tính chất O(1)); 17–22 s khi lô tải" },
  { tep: "server/services/flow/nut/ma.docker.test.ts", ly: "ca vòng lặp vô hạn phải hết giờ ≤ 12 s gồm khởi/dọn container docker; 12–14 s khi lô tải" },
  { tep: "server/services/edge/edgeExecutionAgent.dot10.test.ts", ly: "đếm lệnh theo thời điểm trên đồng hồ thật (130 vs 131 dưới tải); xanh khi chạy riêng" },
];
const nang = args.includes("--nang");
if (nang) args.splice(args.indexOf("--nang"), 1);
const khongTachDb = args.includes("--khong-tach-db");
if (khongTachDb) args.splice(args.indexOf("--khong-tach-db"), 1);
const nenFile = opt("--nen");
const outDir = resolve(opt("--ra") ?? ".luoi-truoc-gop");
const extra = (opt("--co-vitest") ?? "").split(/\s+/).filter(Boolean);
const targets = args.length ? args : DEFAULT_TARGETS;
mkdirSync(outDir, { recursive: true });

const root = process.cwd();
const rel = (p) => relative(root, p).replaceAll("\\", "/");
const SERIAL_CFG = ["vitest.serial.config.ts"];
// 7 tệp chạy tuần tự riêng (loại khỏi cấu hình mặc định): chạy lại RIÊNG phải dùng cấu hình của chúng.
const SERIAL_FILES = new Set(
  // \x22 thay cho dấu nháy kép: máy quét điểm spawn (vramAllocationSites) bóc chuỗi theo dấu nháy và sẽ coi một `"` trần trong
  // regex literal là mở chuỗi, nuốt mất lời gọi spawnSync( phía dưới ⇒ bản liệt kê khai mà quét "thấy 0".
  [...readFileSync(resolve("vitest.serial.config.ts"), "utf8").matchAll(new RegExp("\\x22(server/[^\\x22]+\\.db\\.test\\.ts)\\x22", "g"))].map((m) => m[1]),
);
const vitest = (files, jsonOut, cfg = [], truocFiles = []) =>
  spawnSync("npx", ["vitest", "run", ...cfg, ...truocFiles, ...files, ...extra, "--reporter=json", `--outputFile=${jsonOut}`], {
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
const lo = { red: new Map(), total: 0, failed: 0 };
function gop(jsonPath, nhan) {
  if (!existsSync(jsonPath)) { console.error(`Không có báo cáo JSON của ${nhan} (vitest chết sớm?)`); process.exit(2); }
  const r = doTepDo(jsonPath);
  for (const [k, v] of r.red) lo.red.set(k, v);
  lo.total += r.total ?? 0;
  lo.failed += r.failed ?? 0;
  console.log(`[${nhan}] ${r.total} ca, ${r.failed} đỏ, ${r.red.size} tệp đỏ`);
}
if (tuJson) {
  gop(tuJson, "lô (JSON có sẵn)");
} else if (khongTachDb) {
  const j = resolve(outDir, "lo.json");
  console.log(`[lô] vitest run ${targets.join(" ")}`);
  vitest(targets, j);
  gop(j, "lô");
} else {
  const j1 = resolve(outDir, "lo-thuong.json");
  console.log(`[lô thường] vitest run --exclude **/*.db.test.ts ${targets.join(" ")}`);
  const loaiNang = nang ? NANG.flatMap((n) => ["--exclude", n.tep]) : [];
  vitest(targets, j1, [], ["--exclude", "**/*.db.test.ts", ...loaiNang]);
  gop(j1, "lô thường");
  const j2 = resolve(outDir, "lo-db.json");
  console.log(`[lô DB, tuần tự] vitest run --config vitest.db.config.ts ${targets.join(" ")}`);
  vitest(targets, j2, ["--config", "vitest.db.config.ts"]);
  gop(j2, "lô DB");
  if (nang) {
    // Lô NẶNG: các tệp đo thời gian/tài nguyên SÁT ngưỡng sản phẩm chạy TUẦN TỰ, một mình, sau cùng (máy rảnh).
    const j3 = resolve(outDir, "lo-nang.json");
    console.log(`[lô nặng, tuần tự] ${NANG.map((n) => n.tep).join(" ")}`);
    vitest(NANG.map((n) => n.tep), j3, ["--no-file-parallelism"]);
    gop(j3, "lô nặng");
  }
}
console.log(`[tổng] ${lo.total} ca, ${lo.failed} đỏ, ${lo.red.size} tệp đỏ`);

// 2. CHẠY RIÊNG từng tệp đỏ
const nen = nenFile && existsSync(nenFile)
  ? new Set(readFileSync(nenFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) : null;
const rows = [];
for (const [file, info] of lo.red) {
  const j = resolve(outDir, "rieng-" + file.replace(/[\\/]/g, "_") + ".json");
  console.log(`[riêng] ${file}`);
  vitest([file], j, SERIAL_FILES.has(file) ? ["--config", ...SERIAL_CFG] : []);
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
