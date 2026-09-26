/**
 * Vietnamese- and CJK-capable font assets for server-side PDF rendering.
 *
 * Wave R2 (doc 32 §4, decision #2) — the #1 P0 trust issue was that jsPDF
 * (universalExportService) and PDFKit (pdfTemplateService) render Vietnamese
 * diacritics as mojibake, because their built-in cores (Helvetica/WinAnsi) have
 * no glyphs for the Latin-Extended-Additional block VN uses (e-hat, o-dot, d-bar).
 *
 * We embed **Be Vietnam Pro** — an SIL-OFL font drawn by a Vietnamese foundry
 * with complete VN coverage — so every PDF path renders correct diacritics.
 *
 * doc 48 R4 — Be Vietnam Pro has NO CJK glyphs, so Chinese (zh) exports rendered
 * every ideograph as tofu. We additionally embed **Noto Sans SC** (SIL OFL) and
 * swap it in, per text run, wherever CJK codepoints appear. The CJK font is
 * OPTIONAL (large: ~10 MB/weight): the loaders return null when it is not
 * installed, and callers fail loud for the zh locale rather than emitting tofu.
 *
 * The .ttf binaries live in ./server/assets/fonts. If they are missing (fresh
 * checkout / clean CI), run `node scripts/fetch-fonts.mjs`; the VN loader FAILS
 * LOUDLY rather than silently falling back to a core font that would mojibake —
 * a broken-diacritic report is worse than a clear error.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const VN_FONT_FAMILY = "BeVietnamPro";
const REGULAR_FILE = "BeVietnamPro-Regular.ttf";
const BOLD_FILE = "BeVietnamPro-Bold.ttf";

/**
 * Noto Sans SC (Simplified Chinese, SIL OFL 1.1) — CJK ideograph coverage that
 * Be Vietnam Pro lacks. Static Regular/Bold TTFs (glyf outlines, so jsPDF can
 * embed + subset them; the OTF/CFF Noto builds cannot be embedded by jsPDF).
 * See ./server/assets/fonts/README.md for provenance + the size tradeoff.
 */
export const CJK_FONT_FAMILY = "NotoSansSC";
const CJK_REGULAR_FILE = "NotoSansSC-Regular.ttf";
const CJK_BOLD_FILE = "NotoSansSC-Bold.ttf";

/**
 * True when `text` contains any CJK codepoint that Be Vietnam Pro cannot render
 * (→ tofu) and so needs the CJK font. Covers CJK Radicals (U+2E80–2EFF), CJK
 * Symbols & Punctuation (U+3000–303F), CJK Unified + Ext-A (U+3400–4DBF,
 * U+4E00–9FFF), Compatibility Ideographs (U+F900–FAFF), Fullwidth forms
 * (U+FF00–FFEF) and Ext-B..F + Compat-Supplement (U+20000–2FA1F). ASCII-only
 * source (numeric ranges) — no literal ideographs in the file.
 */
export function containsCjk(text: string | null | undefined): boolean {
  if (text == null) return false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x2e80 && cp <= 0x2eff) ||
      (cp >= 0x3000 && cp <= 0x303f) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff00 && cp <= 0xffef) ||
      (cp >= 0x20000 && cp <= 0x2fa1f)
    ) {
      return true;
    }
  }
  return false;
}

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
  // dist -> dist/assets/fonts, written by `scripts/copy-font-assets.mjs` during
  // `npm run build`. This is the candidate that makes a ship-only-`dist` deploy
  // (Dockerfile runtime stage, dist-secure/) work: HERE is `dist/` under the
  // esbuild ESM bundle, which keeps `import.meta.url`. Before it existed the only
  // hit was the process.cwd() fallback below — i.e. the server was reading fonts
  // out of the SOURCE TREE, which no such deploy ships. (nhóm C, việc 1)
  c.push(resolve(HERE, "assets", "fonts"));
  c.push(resolve(HERE, "..", "..", "server", "assets", "fonts")); // dist -> repo/server/assets/fonts
  // Fail-safe, deliberately kept: rescues a process started from the repo root.
  c.push(join(process.cwd(), "server", "assets", "fonts"));
  c.push(join(process.cwd(), "assets", "fonts"));
  return c;
}

/** First candidate directory that contains `file`, or null if none do. */
function findFontDirWith(file: string): string | null {
  for (const dir of fontDirCandidates()) {
    if (existsSync(join(dir, file))) return dir;
  }
  return null;
}

let resolvedDir: string | null = null;
function resolveFontDir(): string {
  if (resolvedDir) return resolvedDir;
  const dir = findFontDirWith(REGULAR_FILE);
  if (dir) {
    resolvedDir = dir;
    return dir;
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

// ═══════════════════════════════════════════════════════════════════════════
// CJK (Noto Sans SC) — OPTIONAL, loaded only for Chinese content (doc 48 R4)
// ═══════════════════════════════════════════════════════════════════════════
// Unlike the VN font (always required → fail-loud), the CJK font is only needed
// when a report actually contains Chinese. The loaders return null when it is
// not installed; callers fail loud for the zh locale and warn for incidental CJK
// in a vi/en report — never silently emit tofu.

let cjkRegularBuf: Buffer | null = null;
let cjkBoldBuf: Buffer | null = null;

/** True when the CJK font is installed (server/assets/fonts or FONT_ASSETS_DIR). */
export function isCjkFontAvailable(): boolean {
  return findFontDirWith(CJK_REGULAR_FILE) != null;
}

/** Raw CJK TTF buffers (PDFKit path), or null when the font is not installed. */
export function getCjkFontBuffers(): { regular: Buffer; bold: Buffer } | null {
  const dir = findFontDirWith(CJK_REGULAR_FILE);
  if (!dir) return null;
  if (!cjkRegularBuf) cjkRegularBuf = readFileSync(join(dir, CJK_REGULAR_FILE));
  if (!cjkBoldBuf) {
    const boldPath = join(dir, CJK_BOLD_FILE);
    cjkBoldBuf = existsSync(boldPath) ? readFileSync(boldPath) : cjkRegularBuf;
  }
  return { regular: cjkRegularBuf, bold: cjkBoldBuf };
}

let cjkRegularB64: string | null = null;
let cjkBoldB64: string | null = null;

/** base64 CJK TTFs (jsPDF path), or null when the font is not installed. */
export function getCjkFontBase64(): { regular: string; bold: string } | null {
  const bufs = getCjkFontBuffers();
  if (!bufs) return null;
  if (!cjkRegularB64) cjkRegularB64 = bufs.regular.toString("base64");
  if (!cjkBoldB64) cjkBoldB64 = bufs.bold.toString("base64");
  return { regular: cjkRegularB64, bold: cjkBoldB64 };
}

/**
 * Register Noto Sans SC (regular + bold) on a jsPDF document WITHOUT changing
 * the active font (the caller keeps the VN font active and swaps per text run).
 * Returns the family name, or null when the CJK font is not installed.
 */
export function registerCjkFontJsPDF(doc: {
  addFileToVFS: (file: string, data: string) => void;
  addFont: (file: string, family: string, style: string) => void;
}): string | null {
  const b64 = getCjkFontBase64();
  if (!b64) return null;
  doc.addFileToVFS(CJK_REGULAR_FILE, b64.regular);
  doc.addFont(CJK_REGULAR_FILE, CJK_FONT_FAMILY, "normal");
  doc.addFileToVFS(CJK_BOLD_FILE, b64.bold);
  doc.addFont(CJK_BOLD_FILE, CJK_FONT_FAMILY, "bold");
  return CJK_FONT_FAMILY;
}

/**
 * Register Noto Sans SC (regular + bold) on a PDFKit document WITHOUT changing
 * the active font. Returns the {regular,bold} family names, or null when the CJK
 * font is not installed. Bold is registered under `${CJK_FONT_FAMILY}-Bold`.
 */
export function registerCjkFontPdfKit(doc: {
  registerFont: (name: string, src: Buffer) => void;
}): { regular: string; bold: string } | null {
  const bufs = getCjkFontBuffers();
  if (!bufs) return null;
  const boldName = `${CJK_FONT_FAMILY}-Bold`;
  doc.registerFont(CJK_FONT_FAMILY, bufs.regular);
  doc.registerFont(boldName, bufs.bold);
  return { regular: CJK_FONT_FAMILY, bold: boldName };
}

/** Actionable error for the zh path when the CJK font is absent. */
export function cjkFontUnavailableMessage(context = "Chinese (zh) PDF export"): string {
  return (
    `[fontAssets] ${context} requires the CJK font "${CJK_REGULAR_FILE}", not found in any of:\n` +
    fontDirCandidates()
      .map((d) => `  - ${d}`)
      .join("\n") +
    `\nRun \`node scripts/fetch-fonts.mjs\` (fetches Noto Sans SC, OFL 1.1) or set ` +
    `FONT_ASSETS_DIR. Refusing to render CJK text with a non-CJK font (would ` +
    `produce tofu/blank glyphs).`
  );
}
