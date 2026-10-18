/**
 * Đóng gói MÃ THẬT của extension + `vscode` giả thành một tệp CJS chạy được bằng Node — cùng esbuild, cùng tuỳ chọn
 * nền tảng với `vscode-extension/build.mjs` (cjs · node · node20), chỉ khác: `vscode` trỏ về `lib/vscodeGia.ts` thay vì
 * external. Đầu ra ở `tmp/vscode-e2e-build/khung.cjs` (tmp/ đã .gitignore). Không đụng `vscode-extension/dist`.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const LIB = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(LIB, "../../../..");
const EXT = path.join(ROOT, "vscode-extension");

export async function dongGoi() {
  const req = createRequire(path.join(EXT, "package.json"));
  const { build } = req("esbuild");
  const ra = path.join(ROOT, "tmp", "vscode-e2e-build", "khung.cjs");
  await build({
    absWorkingDir: EXT,
    entryPoints: [path.join(LIB, "khung.ts")],
    bundle: true,
    outfile: ra,
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: "inline",
    logLevel: "warning",
    plugins: [
      {
        name: "vscode-gia",
        setup(b) {
          b.onResolve({ filter: /^vscode$/ }, () => ({ path: path.join(LIB, "vscodeGia.ts") }));
        },
      },
    ],
  });
  return createRequire(import.meta.url)(ra);
}
