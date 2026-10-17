// Bundle extension bằng esbuild. `vscode` là module do VSCode cấp lúc chạy ⇒ PHẢI external.
// ★ ĐỢT 4B — neo đường theo CHÍNH thư mục của tệp này (`absWorkingDir`), để `node vscode-extension/build.mjs` chạy từ
// gốc repo cũng ra đúng `vscode-extension/dist/extension.js` (bản cũ phụ thuộc thư mục làm việc hiện tại).
import { build } from "esbuild";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

await build({
  absWorkingDir: dirname(fileURLToPath(import.meta.url)),
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
});
