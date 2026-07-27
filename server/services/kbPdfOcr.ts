/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-5) — scanned/image-only PDF OCR for Knowledge & Training
 * Studio ingest.
 *
 * `kbDocParser.parsePdf` (E3-1) extracts text via pdf-parse, which returns NOTHING (or near
 * nothing) for a scanned/image-only PDF — a PDF with no text layer, just page images. This
 * module renders such a PDF's pages to PNG (`pdftoppm`/poppler, an injection-safe sidecar that
 * MIRRORS E3-4's `kbVideoTranscriber.runSidecar`) and hands each page image to the EXISTING
 * `server/services/ai/ocrService.ts` (`runOcr` — ONNX PaddleOCR/RapidOCR DET+REC). This file
 * does NOT reimplement OCR — it only renders pages and calls the existing engine.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * SHELL-INJECTION SAFETY (mirrors kbVideoTranscriber.ts exactly — see its module doc comment
 * for the full rationale): every pdftoppm invocation goes through `execFile` (promisified, an
 * argument ARRAY) — never `exec` with a concatenated shell string, and `shell: true` is never
 * set anywhere in this file. The PDF buffer handed to `ocrScannedPdf` is untrusted (an
 * operator-uploaded file) but it is ALWAYS written to a `crypto.randomUUID()`-generated temp
 * path under a fixed repo directory — never any caller-influenced string — and the pdftoppm
 * output prefix is generated the same way. There is no filename parameter here at all (unlike
 * kbVideoTranscriber, which has one for the extension hint), so there is even less surface: the
 * ONLY things that ever become argv elements are fixed CLI flags, small bounded numbers (DPI,
 * page index), and the two generated paths above. Nothing derived from the PDF's bytes or any
 * other caller-controlled string ever reaches argv, let alone a shell.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * HONEST FAIL-SAFE: OCR disabled (`OCR_ENGINE_ENABLED` and/or `KB_OCR_ENABLED` off) / ONNX
 * models absent / `PDFTOPPM_BIN` unset or unspawnable (ENOENT) / a page render or OCR call
 * failing → `ocrScannedPdf` NEVER throws and NEVER fabricates text: every failure mode
 * collapses to `{ text: "", ocrUsed: false, ... }`, and the caller (`kbDocParser.parsePdf`)
 * falls back to the original (possibly empty) pdf-parse text with `meta.scannedNoOcr: true`. A
 * single page's render/OCR failure does NOT abort the rest of the document — the loop keeps
 * going (best-effort) — UNLESS pdftoppm itself turns out to be unspawnable (ENOENT), in which
 * case every subsequent page would fail identically, so the loop stops immediately instead of
 * wasting `KB_OCR_MAX_PAGES` failed spawn attempts.
 *
 * Bounded: `KB_OCR_MAX_PAGES` caps how many pages are ever rendered/OCR'd,
 * `KB_OCR_TOTAL_TIMEOUT_MS` caps the whole routine's wall-clock time (checked between pages —
 * best-effort with whatever text was gathered so far), `KB_OCR_RENDER_TIMEOUT_MS` bounds each
 * pdftoppm call (execFile's native `timeout`), and `KB_OCR_PAGE_TIMEOUT_MS` bounds each
 * `ocrService.runOcr` call. Every temp file this module creates (the written-out PDF copy, each
 * page's rendered PNG) is unlinked in a `finally`, on every exit path.
 *
 * Gating: BOTH `OCR_ENGINE_ENABLED` (ocrService's own master flag, default OFF) AND
 * `KB_OCR_ENABLED` (this module's KB-ingest-specific flag, ALSO default OFF) must be on — so
 * turning OCR on for AOI vision label/barcode checks does not silently start OCRing every
 * scanned PDF an operator uploads to the Knowledge & Training Studio.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

// ─── Errors ────────────────────────────────────────────────────────────────────────────────

/** pdftoppm is not configured (`PDFTOPPM_BIN` unset) or the configured binary could not be
 * spawned (ENOENT) — both mean "the renderer isn't usable right now". */
export class KbOcrUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ? `pdftoppm not available (${detail})` : "pdftoppm not available (set PDFTOPPM_BIN)");
    this.name = "KbOcrUnavailableError";
  }
}

/** A configured, spawnable pdftoppm still failed for one page: non-zero exit or a timeout. */
export class KbOcrRenderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "KbOcrRenderError";
  }
}

// ─── Flags ─────────────────────────────────────────────────────────────────────────────────

/** KB-ingest-specific OCR gate, default OFF. `OCR_ENGINE_ENABLED` (ocrService's master flag)
 * must ALSO be on — both are checked by `loadOcrServiceIfAvailable` below. Read fresh on every
 * call (no caching), same discipline as kbVideoTranscriber.isVideoIngestEnabled. */
export function isKbOcrEnabled(): boolean {
  const v = String(process.env.KB_OCR_ENABLED ?? "false").toLowerCase();
  return v === "true" || v === "1";
}

function getPdftoppmBin(): string | undefined {
  return process.env.PDFTOPPM_BIN || undefined;
}

/**
 * Load `ocrService` and confirm every precondition for KB-ingest OCR: the KB-specific gate, a
 * configured renderer binary, ocrService's own master gate, AND the ONNX models actually
 * present on disk. Returns `null` (never throws) the moment any precondition fails, short-
 * circuiting BEFORE importing ocrService or touching the filesystem/child_process wherever
 * possible. Does NOT probe the pdftoppm binary itself — its existence is verified naturally by
 * the spawn attempt in `runPdftoppm` (mirrors `kbVideoTranscriber.isSttConfigured`'s "config
 * presence, not filesystem probe" discipline for the STT binaries).
 */
async function loadOcrServiceIfAvailable(): Promise<typeof import("./ai/ocrService") | null> {
  if (!isKbOcrEnabled() || !getPdftoppmBin()) return null;
  try {
    const mod = await import("./ai/ocrService");
    if (!mod.isOcrEngineEnabled() || !mod.ocrModelsAvailable()) return null;
    return mod;
  } catch {
    return null;
  }
}

/** True only when EVERY precondition for KB-ingest OCR is met right now. Never throws. Exposed
 * mainly for status/introspection callers (e.g. a future Studio UI capability check); the
 * internal `ocrScannedPdf` flow performs the same check itself and does not depend on this. */
export async function isKbPdfOcrAvailable(): Promise<boolean> {
  return (await loadOcrServiceIfAvailable()) !== null;
}

// ─── Bounds (module-load-time constants — mirrors kbVideoTranscriber's numeric-tunable style) ─

const MAX_PAGES = (() => {
  const n = Number(process.env.KB_OCR_MAX_PAGES ?? 30);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
})();

const RENDER_DPI = (() => {
  const n = Number(process.env.KB_OCR_RENDER_DPI ?? 200);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
})();

/** Wall-clock timeout for a single pdftoppm render call (execFile's native `timeout`). */
const RENDER_TIMEOUT_MS = (() => {
  const n = Number(process.env.KB_OCR_RENDER_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
})();

/** Wall-clock timeout for a single page's `ocrService.runOcr` call. */
const PAGE_OCR_TIMEOUT_MS = (() => {
  const n = Number(process.env.KB_OCR_PAGE_TIMEOUT_MS ?? 45_000);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
})();

/** Overall wall-clock budget for the whole `ocrScannedPdf` call, checked between pages —
 * 0 is a valid (if extreme) value: "stop after the page already in flight". */
const TOTAL_TIMEOUT_MS = (() => {
  const n = Number(process.env.KB_OCR_TOTAL_TIMEOUT_MS ?? 180_000);
  return Number.isFinite(n) && n >= 0 ? n : 180_000;
})();

function getTempDir(): string {
  return path.join(process.cwd(), "uploads", "tmp", "kb-ocr");
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ─── pdftoppm sidecar (execFile + arg ARRAY — mirrors kbVideoTranscriber.runSidecar) ──────────

/**
 * Spawn pdftoppm to render ONE page of `pdfPath` to `${outPrefix}.png` (`-singlefile` — no page
 * suffix). Never shell-parsed (see the module doc comment). A missing binary (ENOENT) becomes
 * {@link KbOcrUnavailableError}; a non-zero exit or a timeout becomes {@link KbOcrRenderError}.
 */
async function runPdftoppm(bin: string, pdfPath: string, page: number, outPrefix: string): Promise<void> {
  const args = [
    "-png",
    "-r", String(RENDER_DPI),
    "-f", String(page),
    "-l", String(page),
    "-singlefile",
    pdfPath,
    outPrefix,
  ];
  try {
    await execFileAsync(bin, args, { timeout: RENDER_TIMEOUT_MS, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string | Buffer };
    if (e?.code === "ENOENT") {
      throw new KbOcrUnavailableError(`pdftoppm binary not found at "${bin}"`);
    }
    if (e?.killed) {
      throw new KbOcrRenderError(`pdftoppm timed out after ${RENDER_TIMEOUT_MS}ms and was killed`, e);
    }
    const stderrTail = String(e?.stderr ?? e?.message ?? e ?? "").slice(-2000);
    throw new KbOcrRenderError(`pdftoppm failed (${String(e?.code ?? "unknown exit")}): ${stderrTail}`, e);
  }
}

// ─── ocrScannedPdf ─────────────────────────────────────────────────────────────────────────

export interface OcrScannedPdfResult {
  /** OCR'd text, one page's recognized text per paragraph (blank-line joined). Empty when OCR
   * was unavailable or every attempted page failed. */
  text: string;
  /** True only when `text` is non-empty AND it actually came from the OCR engine — callers
   * should use `text` as the document's content only when this is true; otherwise the caller
   * should fall back to its own original text (never treat an empty `text` here as "the
   * document has no content"). */
  ocrUsed: boolean;
  pagesAttempted: number;
  pagesProcessed: number;
  pagesFailed: number;
}

const EMPTY_RESULT: OcrScannedPdfResult = {
  text: "",
  ocrUsed: false,
  pagesAttempted: 0,
  pagesProcessed: 0,
  pagesFailed: 0,
};

/**
 * Render `pdfBuffer`'s pages to PNG (pdftoppm) and OCR each one via the EXISTING
 * `ocrService.runOcr`. Bounded by `KB_OCR_MAX_PAGES` / `KB_OCR_TOTAL_TIMEOUT_MS`; best-effort
 * per page (one page's render/OCR failure does not abort the rest) UNLESS pdftoppm itself is
 * unspawnable, in which case the whole attempt stops immediately. NEVER throws — every failure
 * mode collapses to `{ text: "", ocrUsed: false, ... }` so the caller can honestly fall back to
 * its own original text. Every temp file created is unlinked in a `finally`.
 */
export async function ocrScannedPdf(
  pdfBuffer: Buffer,
  pageCountHint: number,
  opts: { language?: "en" | "vi" | "auto" } = {},
): Promise<OcrScannedPdfResult> {
  const ocrServiceMod = await loadOcrServiceIfAvailable();
  if (!ocrServiceMod) return EMPTY_RESULT;

  const pdftoppmBin = getPdftoppmBin()!;
  const hint = Math.floor(pageCountHint) || 1;
  const pagesToAttempt = Math.max(1, Math.min(hint, MAX_PAGES));

  const id = randomUUID();
  const tempDir = getTempDir();
  const pdfPath = path.join(tempDir, `${id}-input.pdf`);
  const cleanupPaths: string[] = [pdfPath];

  const texts: string[] = [];
  let pagesAttempted = 0;
  let pagesProcessed = 0;
  let pagesFailed = 0;
  const startedAt = Date.now();

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.writeFile(pdfPath, pdfBuffer);

    for (let page = 1; page <= pagesToAttempt; page++) {
      pagesAttempted++;
      const outPrefix = path.join(tempDir, `${id}-p${page}`);
      const pngPath = `${outPrefix}.png`;
      cleanupPaths.push(pngPath);

      try {
        await runPdftoppm(pdftoppmBin, pdfPath, page, outPrefix);
        const png = await fs.promises.readFile(pngPath);
        const ocr = await withTimeout(ocrServiceMod.runOcr(png, { language: opts.language }), PAGE_OCR_TIMEOUT_MS, "OCR");
        if (ocr.ok && ocr.text.trim()) {
          texts.push(ocr.text.trim());
          pagesProcessed++;
        } else {
          pagesFailed++;
        }
      } catch (err) {
        pagesFailed++;
        // pdftoppm genuinely unspawnable — every subsequent page will fail the exact same way,
        // so stop now instead of burning through the rest of pagesToAttempt.
        if (err instanceof KbOcrUnavailableError) break;
        // Any other failure (bad page render, OCR error/timeout) is page-local — best-effort,
        // keep going.
      }

      // Total-timeout bound, checked AFTER each page so the page already "in flight" always
      // completes (best-effort — return whatever was gathered rather than hang indefinitely on
      // a slow multi-page run). Checked post-page rather than pre-page so this bound can never
      // starve the very first page just because setup (mkdir/writeFile) ate into the budget.
      if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) break;
    }
  } catch {
    // Setup failure (mkdir/writeFile) — never crash the caller, honest empty result.
    return { text: "", ocrUsed: false, pagesAttempted, pagesProcessed, pagesFailed: pagesFailed || 1 };
  } finally {
    await Promise.all(cleanupPaths.map((p) => fs.promises.unlink(p).catch(() => {})));
  }

  const text = texts.join("\n\n");
  return { text, ocrUsed: text.length > 0, pagesAttempted, pagesProcessed, pagesFailed };
}
