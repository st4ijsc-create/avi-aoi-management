/**
 * Vietnamese-capable font assets for server-side PDF rendering.
 *
 * Wave R2 (doc 32 §4, decision #2) — the #1 P0 trust issue was that jsPDF
 * (universalExportService) and PDFKit (pdfTemplateService) render Vietnamese
 * diacritics as mojibake, because their built-in cores (Helvetica/WinAnsi) have
 * no glyphs for the Latin-Extended-Additional block VN uses (ế ấ ộ ữ đ …).
 *
 * We embed **Be Vietnam Pro** — an SIL-OFL font drawn by a Vietnamese foundry
 * with complete VN coverage — so every PDF path renders correct diacritics.
 *
 * The .ttf binaries live in ./server/assets/fonts (committed). If they are
 * missing (fresh checkout without LFS / clean CI), run `node scripts/fetch-fonts.mjs`;
 * this loader FAILS LOUDLY rather than silently falling back to a core font that
 * would mojibake — a broken-diacritic report is worse than a clear error.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const VN_FONT_FAMILY = "BeVietnamPro";
const REGULAR_FILE = "BeVietnamPro-Regular.ttf";
const BOLD_FILE = "BeVietnamPro-Bold.ttf";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Candidate directories for the font assets, most-specific first. Works under
 * vitest/tsx (source tree) and under the esbuild bundle (dist/), plus an env
 * override (FONT_ASSETS_DIR) for deployments that ship fonts elsewhere.
 */
function fontDirCandidates(): string[] {
  const c: string[] = [];
  if (process.env.FONT_ASSETS_DIR) c.push(process.env.FONT_ASSETS_DIR);
  c.push(resolve(HERE, "..", "assets", "fonts")); // server/services -> server/assets/fonts
  c.push(resolve(HERE, "..", "..", "server", "assets", "fonts")); // dist -> repo/server/assets/fonts
  c.push(join(process.cwd(), "server", "assets", "fonts"));
  c.push(join(process.cwd(), "assets", "fonts"));
  return c;
}

let resolvedDir: string | null = null;
function resolveFontDir(): string {
  if (resolvedDir) return resolvedDir;
  for (const dir of fontDirCandidates()) {
    if (existsSync(join(dir, REGULAR_FILE))) {
      resolvedDir = dir;
      return dir;
    }
  }
  throw new Error(
    `[fontAssets] Vietnamese font "${REGULAR_FILE}" not found in any of:\n` +
      fontDirCandidates()
        .map((d) => `  - ${d}`)
        .join("\n") +
      `\nRun \`node scripts/fetch-fonts.mjs\` to download Be Vietnam Pro, or set ` +
      `FONT_ASSETS_DIR. Refusing to render PDF with a non-Vietnamese fallback ` +
      `font (would produce broken diacritics).`
  );
}

// ─── Buffer cache (PDFKit path) ──────────────────────────────────────────────
let regularBuf: Buffer | null = null;
let boldBuf: Buffer | null = null;

export interface VietnameseFontBuffers {
  regular: Buffer;
  bold: Buffer;
}

/** Raw TTF buffers — used by PDFKit's `registerFont(name, buffer)`. */
export function getVietnameseFontBuffers(): VietnameseFontBuffers {
  const dir = resolveFontDir();
  if (!regularBuf) regularBuf = readFileSync(join(dir, REGULAR_FILE));
  if (!boldBuf) {
    const boldPath = join(dir, BOLD_FILE);
    boldBuf = existsSync(boldPath) ? readFileSync(boldPath) : regularBuf;
  }
  return { regular: regularBuf, bold: boldBuf };
}

// ─── base64 cache (jsPDF path) ───────────────────────────────────────────────
let regularB64: string | null = null;
let boldB64: string | null = null;

export interface VietnameseFontBase64 {
  regular: string;
  bold: string;
}

/**
 * base64-encoded TTFs — used by jsPDF's Virtual File System
 * (`addFileToVFS(name, base64)` + `addFont(name, family, style)`).
 */
export function getVietnameseFontBase64(): VietnameseFontBase64 {
  const { regular, bold } = getVietnameseFontBuffers();
  if (!regularB64) regularB64 = regular.toString("base64");
  if (!boldB64) boldB64 = bold.toString("base64");
  return { regular: regularB64, bold: boldB64 };
}

/**
 * Register Be Vietnam Pro (regular + bold) on a jsPDF document and make it the
 * active font. Returns the family name to pass to autotable styles / setFont.
 *
 * @param doc a jsPDF instance (typed loosely to avoid a hard jspdf type dep here)
 */
export function registerVietnameseFontJsPDF(doc: {
  addFileToVFS: (file: string, data: string) => void;
  addFont: (file: string, family: string, style: string) => void;
  setFont: (family: string, style?: string) => void;
}): string {
  const { regular, bold } = getVietnameseFontBase64();
  doc.addFileToVFS(REGULAR_FILE, regular);
  doc.addFont(REGULAR_FILE, VN_FONT_FAMILY, "normal");
  doc.addFileToVFS(BOLD_FILE, bold);
  doc.addFont(BOLD_FILE, VN_FONT_FAMILY, "bold");
  doc.setFont(VN_FONT_FAMILY, "normal");
  return VN_FONT_FAMILY;
}

/**
 * Register Be Vietnam Pro (regular + bold) on a PDFKit document and set it as
 * the default font. Bold is registered under `${VN_FONT_FAMILY}-Bold`.
 *
 * @param doc a PDFKit.PDFDocument (typed loosely — pdfkit ships no bundled types)
 */
export function registerVietnameseFontPdfKit(doc: {
  registerFont: (name: string, src: Buffer) => void;
  font: (name: string) => unknown;
}): { regular: string; bold: string } {
  const { regular, bold } = getVietnameseFontBuffers();
  const boldName = `${VN_FONT_FAMILY}-Bold`;
  doc.registerFont(VN_FONT_FAMILY, regular);
  doc.registerFont(boldName, bold);
  doc.font(VN_FONT_FAMILY);
  return { regular: VN_FONT_FAMILY, bold: boldName };
}
