/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1) — Knowledge & Training Studio ingest pipeline.
 *
 * Orchestrates: parse (kbDocParser.ts) → chunk (bounded + overlap) → embed
 * (aiGgufEngine.generateEmbeddings — mocked in tests, never called live from this file's
 * own test suite) → store (kbVectorStore.upsertChunks, table `kb_studio_chunks`).
 *
 * Gating:
 *  - `KB_STUDIO_ENABLED` (default OFF) — {@link isKbStudioEnabled}. `ingestDocument` throws
 *    {@link KbIngestDisabledError} immediately when off, BEFORE touching parse/embed/DB —
 *    defense-in-depth alongside the admin/engineer RBAC enforced at the router
 *    (server/routers/kbIngestRouter.ts).
 *  - Every failure mode is a DISTINCT typed Error subclass so callers (the router, tests)
 *    can branch on `instanceof` rather than parsing message strings.
 *
 * "No half-written/broken corpus" discipline: chunking + embedding happen for the WHOLE
 * document BEFORE any DB write; the actual write (kbVectorStore.upsertChunks) runs inside
 * ONE transaction covering every chunk of the document. A failure at any stage — parse,
 * embed, or store — throws before/without leaving partial rows for that document. A
 * document that fails never contaminates a corpus that already has other, successfully
 * ingested documents (each document is its own transaction).
 */
import { parseDocument, KbParseError, KbUnsupportedTypeError, type ParsedDocumentMeta } from "./kbDocParser";
import { upsertChunks, type KbChunkInput } from "./kbVectorStore";

export { KbParseError, KbUnsupportedTypeError };

/** Thrown when KB_STUDIO_ENABLED is not "true"/"1" — ingest refuses before doing any work. */
export class KbIngestDisabledError extends Error {
  constructor() {
    super('Knowledge & Training Studio ingest is disabled (set KB_STUDIO_ENABLED=true to enable).');
    this.name = "KbIngestDisabledError";
  }
}

/** Thrown for bad/insufficient input (missing corpus, no content, zero chunks after parsing). */
export class KbIngestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KbIngestValidationError";
  }
}

/** Thrown when embedding generation fails or returns a shape that cannot be trusted. */
export class KbEmbedError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "KbEmbedError";
  }
}

/** Thrown when the store step fails — either a real DB error, or the table isn't migrated yet. */
export class KbStoreError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "KbStoreError";
  }
}

/** KB_STUDIO_ENABLED gate. Default OFF — mirrors aiModelCardGate.ts's flag-read style. */
export function isKbStudioEnabled(): boolean {
  const v = String(process.env.KB_STUDIO_ENABLED ?? "false").toLowerCase();
  return v === "true" || v === "1";
}

/** Target chunk size (chars). Separate env knob from the legacy JSONL pipeline's
 * KB_CHUNK_MAX_CHARS (scripts/ai-kb/build-knowledge-chunks.mjs) — same default "feel"
 * (1800), independently tunable so operators can't accidentally couple the two pipelines. */
const DEFAULT_CHUNK_CHARS = (() => {
  const n = Number(process.env.KB_INGEST_CHUNK_CHARS ?? 1800);
  return Number.isFinite(n) && n >= 200 ? n : 1800;
})();
const DEFAULT_CHUNK_OVERLAP = (() => {
  const n = Number(process.env.KB_INGEST_CHUNK_OVERLAP ?? 200);
  return Number.isFinite(n) && n >= 0 ? n : 200;
})();
/** Hard cap on chunks per document — defense-in-depth beyond kbDocParser's char cap. */
const MAX_CHUNKS_PER_DOC = (() => {
  const n = Number(process.env.KB_INGEST_MAX_CHUNKS ?? 3000);
  return Number.isFinite(n) && n > 0 ? n : 3000;
})();

/**
 * Split `text` into bounded, overlapping chunks. Pure function (no I/O) — exported for unit
 * testing (any positive `maxChars` is honoured exactly, e.g. small values in tests — the
 * "don't let an operator misconfigure this absurdly small in production" floor lives at the
 * env-parsing boundary above, in `DEFAULT_CHUNK_CHARS`, not in this function's contract).
 * `overlap` is clamped to at most half of the effective `maxChars` so the sliding window
 * always makes forward progress (no infinite loop) even for a pathological input.
 */
export function chunkText(
  text: string,
  maxChars: number = DEFAULT_CHUNK_CHARS,
  overlap: number = DEFAULT_CHUNK_OVERLAP,
): string[] {
  const normalized = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const safeMax = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DEFAULT_CHUNK_CHARS;
  if (normalized.length <= safeMax) return [normalized];
  const safeOverlap = Math.max(0, Math.min(Number.isFinite(overlap) ? Math.floor(overlap) : 0, Math.floor(safeMax / 2)));

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + safeMax, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    start = end - safeOverlap;
  }
  return chunks;
}

/** Cheap approximation (~4 chars/token) — NOT a real tokenizer; good enough for a stored hint. */
export function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil((text ?? "").length / 4));
}

export interface IngestDocumentInput {
  corpus: string;
  /** MIME type, bare/dotted extension, or filename — resolved by kbDocParser.normalizeSourceType. */
  sourceType: string;
  sourceRef: string;
  buffer?: Buffer;
  text?: string;
  userId?: number;
}

export interface IngestDocumentResult {
  corpus: string;
  sourceRef: string;
  chunksAdded: number;
  parsedMeta: ParsedDocumentMeta;
}

/**
 * Ingest one document: parse → chunk → embed → store. See the module doc comment for the
 * gating + "no half-written corpus" discipline. Throws a typed error (never a generic
 * string throw) for every failure mode; callers should branch on `instanceof`.
 */
export async function ingestDocument(input: IngestDocumentInput): Promise<IngestDocumentResult> {
  if (!isKbStudioEnabled()) {
    throw new KbIngestDisabledError();
  }

  const corpus = (input.corpus ?? "").trim();
  const sourceRef = (input.sourceRef ?? "").trim();
  if (!corpus) throw new KbIngestValidationError("corpus is required");
  if (!sourceRef) throw new KbIngestValidationError("sourceRef is required");
  if (input.buffer == null && input.text == null) {
    throw new KbIngestValidationError("either buffer or text must be supplied");
  }

  // 1) Parse. KbUnsupportedTypeError / KbParseError are already typed — let them propagate.
  const parsed = await parseDocument(input.buffer ?? input.text!, input.sourceType);
  if (!parsed.text.trim()) {
    throw new KbIngestValidationError(`Document "${sourceRef}" produced no extractable text`);
  }

  // 2) Chunk — bounded size + overlap, hard-capped chunk count.
  let pieces = chunkText(parsed.text);
  if (pieces.length > MAX_CHUNKS_PER_DOC) {
    pieces = pieces.slice(0, MAX_CHUNKS_PER_DOC);
  }
  if (pieces.length === 0) {
    throw new KbIngestValidationError(`Document "${sourceRef}" produced zero chunks after chunking`);
  }

  // 3) Embed — the WHOLE document's chunks first; nothing is written to the store until
  // every chunk has an embedding (see the module doc comment).
  let embeddings: number[][];
  try {
    const { generateEmbeddings } = await import("./aiGgufEngine");
    const result = await generateEmbeddings(pieces);
    embeddings = result.embeddings;
  } catch (err) {
    throw new KbEmbedError(
      `Embedding generation failed for "${sourceRef}": ${(err as Error)?.message ?? String(err)}`,
      err,
    );
  }
  if (!Array.isArray(embeddings) || embeddings.length !== pieces.length) {
    throw new KbEmbedError(
      `Embedding count mismatch for "${sourceRef}": got ${embeddings?.length ?? 0} for ${pieces.length} chunks`,
    );
  }

  // 4) Store — ONE transaction for the whole document (kbVectorStore.upsertChunks).
  const chunkInputs: KbChunkInput[] = pieces.map((text, index) => ({
    index,
    text,
    embedding: embeddings[index],
    sourceType: parsed.meta.sourceType,
    sourceRef,
    tokenCount: estimateTokenCount(text),
    createdBy: input.userId,
  }));

  let storeResult;
  try {
    storeResult = await upsertChunks(corpus, chunkInputs);
  } catch (err) {
    throw new KbStoreError(
      `Failed to store chunks for "${sourceRef}" in corpus "${corpus}": ${(err as Error)?.message ?? String(err)}`,
      err,
    );
  }

  if (!storeResult.tableAvailable) {
    // Deliberately NOT a silent no-op: this is a WRITE path, and reporting "success" with
    // chunksAdded:0 would be an honest-sounding lie (the operator uploaded a document and
    // would believe it is now searchable). searchCorpus()/upsertChunks() themselves still
    // fail-safe to empty/no-op for READ paths and internal degrade signalling — only the
    // outward-facing ingest result surfaces this as an explicit error.
    throw new KbStoreError(
      `kb_studio_chunks table is not migrated yet (apply drizzle/0304_kb_studio_chunks_pgvector.sql as owner ` +
        `"aoi") — ingest for "${sourceRef}" was NOT stored.`,
    );
  }

  return { corpus, sourceRef, chunksAdded: storeResult.inserted, parsedMeta: parsed.meta };
}
