/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1) — Knowledge & Training Studio document parser.
 *
 * Extracts plain text from an operator-uploaded document so it can be chunked + embedded by
 * kbIngestService.ts. Supported today: pdf (pdf-parse, already a dependency), docx (mammoth,
 * added by this task), md/txt (plain read). Deliberately narrow — E3-3 (URL) and E3-4
 * (video/STT) are separate future source types, NOT handled here.
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

export type KbSourceType = "pdf" | "docx" | "md" | "txt";

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
    return {
      text,
      meta: { sourceType: "pdf", charCount: text.length, truncated, pageCount: res.total ?? res.pages?.length },
    };
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

function parsePlain(raw: string, sourceType: "md" | "txt"): ParsedDocument {
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
    }
  } catch (err) {
    if (err instanceof KbParseError) throw err;
    throw new KbParseError(
      `Failed to parse ${sourceType} document: ${(err as Error)?.message ?? String(err)}`,
      err,
    );
  }
}
