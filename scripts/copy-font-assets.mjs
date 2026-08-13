#!/usr/bin/env node
/**
 * Copy the server-side PDF font assets into the build output so that `dist/` is
 * SELF-SUFFICIENT.
 *
 * Why this script exists (nhóm C, việc 1 — 2026-08-13)
 * ────────────────────────────────────────────────────
 * `server/services/fontAssets.ts` resolves the .ttf binaries through a candidate
 * list. Until this script existed, `npm run build` copied NOTHING from
 * `server/assets/fonts`, so the ONLY candidate that ever hit under the esbuild
 * bundle was the last-resort `join(process.cwd(), "server", "assets", "fonts")`
 * fallback — i.e. the running server was silently reading fonts out of the
 * SOURCE TREE next to `dist/`.
 *
 * That works on a dev box (cwd = repo root) and breaks on every ship-only-`dist`
 * deployment. `Dockerfile:43-46` is exactly such a deployment: the runtime stage
 * copies `dist`, `drizzle`, `scripts`, `knowledge` and NOT `server/`, so
 * `/app/server/assets/fonts` does not exist and `fontAssets` — which fails LOUD
 * by design rather than mojibaking diacritics — takes down every Vietnamese PDF
 * export. `scripts/build-secure.mjs` (dist-secure/) had the same hole.
 *
 * The fix is deliberately additive: fonts now land in `dist/assets/fonts`, and
 * `fontAssets.ts` gained a bundle-relative candidate for that path. The
 * `process.cwd()` fallback is KEPT as a fail-safe — it is just no longer the
 * only thing standing between a fresh deploy and a dead report engine.
 *
 *   node scripts/copy-font-assets.mjs                 (build step)
 *   node scripts/copy-font-assets.mjs --dest <dir>    (tests)
 */
import { mkdirSync, copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Source of truth for the fonts, populated by `node scripts/fetch-fonts.mjs`. */
export const DEFAULT_SRC_DIR = join(REPO_ROOT, "server", "assets", "fonts");

/**
 * Destination INSIDE the build output. Must stay in sync with the
 * `resolve(HERE, "assets", "fonts")` candidate in server/services/fontAssets.ts
 * (there, HERE is `dist/` because the esbuild ESM bundle keeps `import.meta.url`).
 *
 * Note this is `dist/assets`, NOT `dist/public/assets`: `serveStatic()`
 * (server/_core/vite.ts:47-58) serves `dist/public`, so the fonts are readable by
 * the server process but are NOT exposed as static web assets.
 */
export const DEFAULT_DEST_DIR = join(REPO_ROOT, "dist", "assets", "fonts");

/**
 * Vietnamese font — REQUIRED. `fontAssets.resolveFontDir()` throws without it,
 * so a build that silently omits it produces an artifact whose PDF engine is
 * dead. Missing here ⇒ hard failure of the build, not a warning.
 */
export const REQUIRED_FONT_FILES = ["BeVietnamPro-Regular.ttf", "BeVietnamPro-Bold.ttf"];

/**
 * CJK font + the OFL license texts — OPTIONAL. The Noto TTFs are ~10 MB each and
 * `fetch-fonts.mjs` documents them as fetch-on-demand; `fontAssets` returns null
 * for the CJK loaders when they are absent (callers fail loud for the `zh` locale
 * instead of emitting tofu). Copy them when present, never fail without them.
 */
export const OPTIONAL_FONT_FILES = [
  "NotoSansSC-Regular.ttf",
  "NotoSansSC-Bold.ttf",
  "OFL.txt",
  "NotoSansSC-OFL.txt",
];

/**
 * Copy the font assets from `srcDir` into `destDir`.
 *
 * @returns {{ destDir: string, copied: string[], skipped: string[] }}
 * @throws when a REQUIRED font is absent from `srcDir`.
 */
export function copyFontAssets({ srcDir = DEFAULT_SRC_DIR, destDir = DEFAULT_DEST_DIR } = {}) {
  const missing = REQUIRED_FONT_FILES.filter((f) => !existsSync(join(srcDir, f)));
  if (missing.length > 0) {
    throw new Error(
      `[copy-font-assets] required font(s) missing from ${srcDir}: ${missing.join(", ")}.\n` +
        `Run \`node scripts/fetch-fonts.mjs\` before building. Refusing to produce a ` +
        `dist/ whose PDF engine would throw at runtime.`
    );
  }

  mkdirSync(destDir, { recursive: true });
  const copied = [];
  const skipped = [];
  for (const name of [...REQUIRED_FONT_FILES, ...OPTIONAL_FONT_FILES]) {
    const src = join(srcDir, name);
    if (!existsSync(src)) {
      skipped.push(name);
      continue;
    }
    copyFileSync(src, join(destDir, name));
    copied.push(name);
  }
  return { destDir, copied, skipped };
}

const invokedDirectly =
  process.argv[1] != null && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const destArg = process.argv.indexOf("--dest");
  const destDir = destArg >= 0 ? resolve(process.argv[destArg + 1]) : DEFAULT_DEST_DIR;
  const srcArg = process.argv.indexOf("--src");
  const srcDir = srcArg >= 0 ? resolve(process.argv[srcArg + 1]) : DEFAULT_SRC_DIR;
  try {
    const { copied, skipped } = copyFontAssets({ srcDir, destDir });
    const bytes = copied.reduce((n, f) => n + statSync(join(destDir, f)).size, 0);
    console.log(
      `[copy-font-assets] ${copied.length} file(s) → ${destDir} (${bytes} bytes)` +
        (skipped.length ? ` · skipped optional: ${skipped.join(", ")}` : "")
    );
  } catch (err) {
    console.error(`[copy-font-assets] FAILED: ${err.message}`);
    process.exit(1);
  }
}
