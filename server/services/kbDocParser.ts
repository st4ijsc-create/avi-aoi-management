/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1) — Knowledge & Training Studio document parser.
 *
 * Extracts plain text from an operator-uploaded document so it can be chunked + embedded by
 * kbIngestService.ts. Supported today: pdf (pdf-parse, already a dependency), docx (mammoth,
 * added by this task), md/txt (plain read), url (E3-3 — pass-through only: kbWebFetcher.ts
 * fetches + extracts the page text itself via html-to-text/pdf-parse BEFORE calling
 * ingestDocument, so this module's "url" case is just bound+trim, same as md/txt — there is no
 * network I/O or HTML parsing in this file), video (E3-4 — same pass-through shape:
 * kbVideoTranscriber.ts runs ffmpeg+whisper.cpp and hands the ALREADY-transcribed plain text to
 * ingestDocument BEFORE this file ever sees it — this module's "video" case never touches
 * audio/video bytes, a sidecar process, or the filesystem, it just bounds+trims text like url/
 * md/txt).
 *
 * E3-5 — scanned/image-only PDF OCR: `parsePdf` extracts text via pdf-parse as before, then
 * computes a text-density heuristic (chars ÷ pageCount). A NORMAL text PDF is always far above
 * the threshold, so it returns exactly as before (byte-identical behavior, unchanged code path).
 * Only when density is low (a scanned/image-only PDF — no text layer) does it call
 * `kbPdfOcr.ocrScannedPdf`, which renders pages via an injection-safe pdftoppm sidecar (mirrors
 * E3-4's `runSidecar`) and OCRs each page image through the EXISTING `server/services/ai/
 * ocrService.ts` engine (not reimplemented here). Gated behind BOTH `OCR_ENGINE_ENABLED`
 * (ocrService's own master flag) AND `KB_OCR_ENABLED` (this ingest path's own flag, default
 * OFF) — see kbPdfOcr.ts. When OCR is off/unavailable/fails, the ORIGINAL (possibly empty)
 * pdf-parse text is returned with `meta.scannedNoOcr:true` — never fabricated, never a crash.
 *
 * Fail-safe discipline:
 *  - An unrecognised mime/extension throws {@link KbUnsupportedTypeError} BEFORE any parsing
 *    is attempted (never silently mis-parses).
 *  - A corrupt/unparseable file (malformed PDF/DOCX, parser exception) throws
 *    {@link KbParseError} — never crashes the process, never hangs (pdf/docx parses are
 *    wrapped in a timeout, see {@link withTimeout}).
 *  - Extracted text is bounded to `KB_PARSE_MAX_CHARS` (default 2,000,000 chars ≈ 2MB) —
 *    `meta.truncated` tells the caller when a document was cut.
 */

export type KbSourceType = "pdf" | "docx" | "md" | "txt" | "url" | "video";

/** Thrown when `mimeOrExt` does not resolve to a supported {@link KbSourceType}. */
export class KbUnsupportedTypeError extends Error {
  constructor(public readonly input: string) {
    super(`Unsupported document type: "${input}". Supported: pdf, docx, md, txt.`);
    this.name = "KbUnsupportedTypeError";
  }
}

/** Thrown when a recognised document type fails to parse (corrupt file, parser crash, timeout). */
export class KbParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "KbParseError";
  }
}

export interface ParsedDocumentMeta {
  sourceType: KbSourceType;
  charCount: number;
  truncated: boolean;
  pageCount?: number;
  /** E3-5: true only when the returned `text` came from OCR (kbPdfOcr.ocrScannedPdf), i.e. a
   * scanned/image-only PDF was successfully OCR'd. Absent/false for every other document. */
  ocrUsed?: boolean;
  /** E3-5: true when a PDF was detected as scanned/low-text (density below
   * `KB_OCR_SCANNED_DENSITY_THRESHOLD`) but OCR did NOT supply text — either OCR is
   * disabled/unavailable/unconfigured, or every page failed. `text` is the original (possibly
   * empty) pdf-parse result, never fabricated — the caller/UI can honestly surface "scanned PDF
   * — OCR not available". */
  scannedNoOcr?: boolean;
  /** E3-5: number of pages actually OCR'd successfully when `ocrUsed:true`. */
  ocrPagesProcessed?: number;
}

export interface ParsedDocument {
  text: string;
  meta: ParsedDocumentMeta;
}

/** Max extracted text length (chars). Bounds memory/DB row size regardless of input size. */
const MAX_EXTRACTED_CHARS = (() => {
  const n = Number(process.env.KB_PARSE_MAX_CHARS ?? 2_000_000);
  return Number.isFinite(n) && n > 0 ? n : 2_000_000;
})();

/** Wall-clock guard for the pdf/docx parser calls — "never hang" per the task brief. */
const PARSE_TIMEOUT_MS = (() => {
  const n = Number(process.env.KB_PARSE_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
})();

/** E3-5: below this chars-per-page density, a PDF's pdf-parse extraction is presumed to be a
 * scanned/image-only page (no meaningful text layer) — a normal text page is typically 1000+
 * chars, so the default of ~20 is a wide margin that never mis-fires on a real text PDF. */
const SCANNED_DENSITY_THRESHOLD = (() => {
  const n = Number(process.env.KB_OCR_SCANNED_DENSITY_THRESHOLD ?? 20);
  return Number.isFinite(n) && n >= 0 ? n : 20;
})();

function boundText(raw: string): { text: string; truncated: boolean } {
  const normalized = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= MAX_EXTRACTED_CHARS) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, MAX_EXTRACTED_CHARS), truncated: true };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new KbParseError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Resolve a MIME type, bare extension, or filename to a {@link KbSourceType}. Throws
 * {@link KbUnsupportedTypeError} for anything else — the caller must not attempt to parse.
 */
export function normalizeSourceType(mimeOrExt: string): KbSourceType {
  const raw = (mimeOrExt ?? "").toLowerCase().trim();
  const extFromFilename = raw.match(/\.([a-z0-9]+)$/)?.[1];
  const candidate = extFromFilename ?? (raw.startsWith(".") ? raw.slice(1) : raw);

  if (candidate === "pdf" || raw.includes("application/pdf")) return "pdf";
  if (candidate === "docx" || raw.includes("wordprocessingml")) return "docx";
  if (candidate === "md" || candidate === "markdown" || raw.includes("text/markdown") || raw === "text/x-markdown") {
    return "md";
  }
  if (candidate === "txt" || raw.includes("text/plain")) return "txt";
  // E3-3: kbWebFetcher.ts passes sourceType:"url" into ingestDocument for already-fetched,
  // already-extracted page text — this is a pass-through marker, not a MIME type.
  if (candidate === "url" || raw === "url") return "url";
  // E3-4: kbVideoTranscriber.ts passes sourceType:"video" into ingestDocument for an
  // already-transcribed plain-text transcript — same pass-through marker convention as "url".
  if (candidate === "video" || raw === "video") return "video";
  throw new KbUnsupportedTypeError(mimeOrExt);
}

function toBuffer(input: Buffer | string): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
}

function toText(input: Buffer | string): string {
  return Buffer.isBuffer(input) ? input.toString("utf8") : input;
}

async function parsePdf(buf: Buffer): Promise<ParsedDocument> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  try {
    const res = await withTimeout(
      parser.getText({ pageJoiner: "\n\n", parsePageInfo: false, parseHyperlinks: false }),
      PARSE_TIMEOUT_MS,
      "pdf parse",
    );
    const raw = res.text ?? (res.pages ?? []).map((p) => p.text ?? "").join("\n\n");
    const { text, truncated } = boundText(raw);
    const pageCount = res.total ?? res.pages?.length;

    // E3-5: scanned/image-only PDF detection. A normal text PDF's density is always far above
    // SCANNED_DENSITY_THRESHOLD, so this branch — and every OCR-related import/call it leads
    // to — is never reached for it: the pre-E3-5 behavior below is byte-for-byte unchanged.
    const density = text.length / Math.max(1, pageCount ?? 1);
    if (density < SCANNED_DENSITY_THRESHOLD) {
      try {
        const { ocrScannedPdf } = await import("./kbPdfOcr");
        const ocr = await ocrScannedPdf(buf, pageCount ?? 1);
        if (ocr.ocrUsed) {
          const bounded = boundText(ocr.text);
          return {
            text: bounded.text,
            meta: {
              sourceType: "pdf",
              charCount: bounded.text.length,
              truncated: bounded.truncated,
              pageCount,
              ocrUsed: true,
              ocrPagesProcessed: ocr.pagesProcessed,
            },
          };
        }
      } catch {
        // kbPdfOcr.ocrScannedPdf is documented to never throw, but this is defense-in-depth:
        // ANY unexpected failure here must fall back to the honest pdf-parse result below, not
        // crash parsePdf or fabricate text.
      }
      return {
        text,
        meta: { sourceType: "pdf", charCount: text.length, truncated, pageCount, ocrUsed: false, scannedNoOcr: true },
      };
    }

    return { text, meta: { sourceType: "pdf", charCount: text.length, truncated, pageCount } };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function parseDocx(buf: Buffer): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  const result = await withTimeout(mammoth.extractRawText({ buffer: buf }), PARSE_TIMEOUT_MS, "docx parse");
  const { text, truncated } = boundText(result.value ?? "");
  return { text, meta: { sourceType: "docx", charCount: text.length, truncated } };
}

function parsePlain(raw: string, sourceType: "md" | "txt" | "url" | "video"): ParsedDocument {
  const { text, truncated } = boundText(raw);
  return { text, meta: { sourceType, charCount: text.length, truncated } };
}

/**
 * Extract plain text from an uploaded document. `input` is a Buffer for binary formats
 * (pdf/docx) or either a Buffer/string for text formats (md/txt). `mimeOrExt` may be a MIME
 * type, a bare extension ("pdf"), a dotted extension (".pdf"), or a filename ("manual.pdf").
 *
 * Throws {@link KbUnsupportedTypeError} for an unrecognised type (never attempts to parse),
 * or {@link KbParseError} when a recognised type fails to parse (corrupt file / timeout).
 */
export async function parseDocument(input: Buffer | string, mimeOrExt: string): Promise<ParsedDocument> {
  const sourceType = normalizeSourceType(mimeOrExt);
  try {
    switch (sourceType) {
      case "pdf":
        return await parsePdf(toBuffer(input));
      case "docx":
        return await parseDocx(toBuffer(input));
      case "md":
        return parsePlain(toText(input), "md");
      case "txt":
        return parsePlain(toText(input), "txt");
      case "url":
        return parsePlain(toText(input), "url");
      case "video":
        return parsePlain(toText(input), "video");
    }
  } catch (err) {
    if (err instanceof KbParseError) throw err;
    throw new KbParseError(
      `Failed to parse ${sourceType} document: ${(err as Error)?.message ?? String(err)}`,
      err,
    );
  }
}
