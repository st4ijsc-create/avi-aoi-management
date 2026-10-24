// Bundle extension bằng esbuild. `vscode` là module do VSCode cấp lúc chạy ⇒ PHẢI external.
// ★ ĐỢT 4B — neo đường theo CHÍNH thư mục của tệp này (`absWorkingDir`), để `node vscode-extension/build.mjs` chạy từ
// gốc repo cũng ra đúng `vscode-extension/dist/extension.js` (bản cũ phụ thuộc thư mục làm việc hiện tại).
import { build } from "esbuild";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const goc = dirname(fileURLToPath(import.meta.url));

// ★ 2026-10-24 — mã build "phiênbản+commit[-dirty]" nhúng vào bundle (hiện ở đầu khung chat; xem src/loi/maBuild.ts).
function maBuild() {
  const phienBan = JSON.parse(readFileSync(goc + "/package.json", "utf8")).version;
  try {
    const git = (...a) => execFileSync("git", a, { cwd: goc, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const commit = git("rev-parse", "--short", "HEAD");
    const dirty = git("status", "--porcelain", "--", ".") !== "";
    return phienBan + "+" + commit + (dirty ? "-dirty" : "");
  } catch {
    return phienBan + "+khong-git";
  }
}

await build({
  absWorkingDir: goc,
  define: { __MA_BUILD__: JSON.stringify(maBuild()) },
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
