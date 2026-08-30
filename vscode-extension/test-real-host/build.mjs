// Biên dịch cây `test-real-host/` (NGOÀI `src/`, census không quét tới — xem docblock
// `prodImports.ts`) ra CommonJS để chạy trong Node/extension host thật.
//
// Hai bước, khác nhau về BUNDLE:
//   1. `prodImports.ts` — BUNDLE (esbuild `bundle:true`, `external:["vscode"]`) thành một tệp DUY
//      NHẤT, giống hệt cách `build.mjs` gốc của extension bundle `src/extension.ts`. Đây là cửa
//      DUY NHẤT lưới real-host nhập mã sản xuất thật (`apBanVa`, `KhoDeXuat`, ...).
//   2. Mọi tệp `.ts` CÒN LẠI dưới `test-real-host/` (runTest.ts, suite/*.ts, fixtures.ts) — CHỈ
//      dịch cú pháp (`bundle:false`), giữ nguyên các `require`/`import` peer (`mocha`, `glob`,
//      `@vscode/test-electron`, `vscode`, `../prodImports`) để Node tự resolve lúc chạy.
import { build } from "esbuild";
import { globSync } from "glob";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..", "test-real-host-out");

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints: [join(HERE, "prodImports.ts")],
  bundle: true,
  outfile: join(OUT_DIR, "prodImports.js"),
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  logLevel: "info",
});

const conLai = globSync("**/*.ts", { cwd: HERE, absolute: true }).filter(
  (f) => f !== join(HERE, "prodImports.ts"),
);

await build({
  entryPoints: conLai,
  bundle: false,
  outdir: OUT_DIR,
  outbase: HERE,
  format: "cjs",
  platform: "node",
  target: "node20",
  logLevel: "info",
});

if (!existsSync(join(OUT_DIR, "runTest.js")) || !existsSync(join(OUT_DIR, "suite", "index.js"))) {
  console.error("[test-real-host/build.mjs] Thiếu output mong đợi (runTest.js / suite/index.js).");
  process.exit(1);
}
console.log(`[test-real-host/build.mjs] OK → ${OUT_DIR}`);
