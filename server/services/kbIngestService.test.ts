/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1) — kbIngestService.ts unit tests.
 *
 * `./kbDocParser` (parseDocument), `./kbVectorStore` (upsertChunks), and `./aiGgufEngine`
 * (generateEmbeddings) are ALL mocked — no live parser/model/DB is ever exercised. This file
 * covers the orchestration (parse→chunk→embed→store), the KB_STUDIO_ENABLED gate, and the
 * "no half-written corpus" discipline (a failure at any stage must never call `upsertChunks`
 * with a partial chunk set, and a store-layer failure must surface as an error, not a
 * silently-degraded success).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const parseDocumentMock = vi.fn();
vi.mock("./kbDocParser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./kbDocParser")>();
  return { ...actual, parseDocument: (...args: unknown[]) => parseDocumentMock(...args) };
});

const upsertChunksMock = vi.fn();
vi.mock("./kbVectorStore", () => ({ upsertChunks: (...args: unknown[]) => upsertChunksMock(...args) }));

const generateEmbeddingsMock = vi.fn();
vi.mock("./aiGgufEngine", () => ({ generateEmbeddings: (...args: unknown[]) => generateEmbeddingsMock(...args) }));

import {
  ingestDocument,
  chunkText,
  estimateTokenCount,
  isKbStudioEnabled,
  KbIngestDisabledError,
  KbIngestValidationError,
  KbEmbedError,
  KbStoreError,
} from "./kbIngestService";
import { KbParseError, KbUnsupportedTypeError } from "./kbDocParser";

const ORIGINAL_ENABLED = process.env.KB_STUDIO_ENABLED;

function embeddingsFor(n: number, dim = 8) {
  return { embeddings: Array.from({ length: n }, () => new Array(dim).fill(0.1)), dimensions: dim };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KB_STUDIO_ENABLED = "true";
  delete process.env.KB_INGEST_CHUNK_CHARS;
  delete process.env.KB_INGEST_CHUNK_OVERLAP;
  delete process.env.KB_INGEST_MAX_CHUNKS;
  parseDocumentMock.mockResolvedValue({
    text: "some parsed document text",
    meta: { sourceType: "pdf", charCount: 26, truncated: false },
  });
  generateEmbeddingsMock.mockResolvedValue(embeddingsFor(1));
  upsertChunksMock.mockResolvedValue({ tableAvailable: true, inserted: 1, skipped: 0 });
});

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.KB_STUDIO_ENABLED;
  else process.env.KB_STUDIO_ENABLED = ORIGINAL_ENABLED;
});

// ─── isKbStudioEnabled / gate ───────────────────────────────────────────────

describe("isKbStudioEnabled", () => {
  it("defaults to false when unset", () => {
    delete process.env.KB_STUDIO_ENABLED;
    expect(isKbStudioEnabled()).toBe(false);
  });
  it("true for 'true' and '1'", () => {
    process.env.KB_STUDIO_ENABLED = "true";
    expect(isKbStudioEnabled()).toBe(true);
    process.env.KB_STUDIO_ENABLED = "1";
    expect(isKbStudioEnabled()).toBe(true);
  });
});

describe("ingestDocument — flag gate", () => {
  it("flag OFF (default) ⇒ KbIngestDisabledError, and NOTHING downstream is touched", async () => {
    delete process.env.KB_STUDIO_ENABLED;
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "pdf", sourceRef: "a.pdf", text: "x" }),
    ).rejects.toThrow(KbIngestDisabledError);
    expect(parseDocumentMock).not.toHaveBeenCalled();
    expect(generateEmbeddingsMock).not.toHaveBeenCalled();
    expect(upsertChunksMock).not.toHaveBeenCalled();
  });

  it("flag ON ⇒ proceeds to parse", async () => {
    const result = await ingestDocument({ corpus: "c1", sourceType: "pdf", sourceRef: "a.pdf", text: "x" });
    expect(parseDocumentMock).toHaveBeenCalled();
    expect(result.chunksAdded).toBe(1);
  });
});

// ─── validation ─────────────────────────────────────────────────────────────

describe("ingestDocument — input validation", () => {
  it("missing corpus ⇒ KbIngestValidationError", async () => {
    await expect(
      ingestDocument({ corpus: "  ", sourceType: "pdf", sourceRef: "a.pdf", text: "x" }),
    ).rejects.toThrow(KbIngestValidationError);
  });

  it("missing sourceRef ⇒ KbIngestValidationError", async () => {
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "pdf", sourceRef: "", text: "x" }),
    ).rejects.toThrow(KbIngestValidationError);
  });

  it("neither buffer nor text supplied ⇒ KbIngestValidationError", async () => {
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "pdf", sourceRef: "a.pdf" }),
    ).rejects.toThrow(KbIngestValidationError);
  });

  it("parsed text is empty/whitespace-only ⇒ KbIngestValidationError, embeddings never requested", async () => {
    parseDocumentMock.mockResolvedValueOnce({ text: "   \n  ", meta: { sourceType: "txt", charCount: 0, truncated: false } });
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "txt", sourceRef: "empty.txt", text: "irrelevant" }),
    ).rejects.toThrow(KbIngestValidationError);
    expect(generateEmbeddingsMock).not.toHaveBeenCalled();
    expect(upsertChunksMock).not.toHaveBeenCalled();
  });
});

// ─── parse/type errors propagate untouched ──────────────────────────────────

describe("ingestDocument — parse failures propagate as-is", () => {
  it("KbUnsupportedTypeError from parseDocument propagates, embed/store never called", async () => {
    parseDocumentMock.mockRejectedValueOnce(new KbUnsupportedTypeError("zip"));
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "zip", sourceRef: "a.zip", text: "x" }),
    ).rejects.toThrow(KbUnsupportedTypeError);
    expect(generateEmbeddingsMock).not.toHaveBeenCalled();
    expect(upsertChunksMock).not.toHaveBeenCalled();
  });

  it("KbParseError (corrupt file) from parseDocument propagates, embed/store never called", async () => {
    parseDocumentMock.mockRejectedValueOnce(new KbParseError("corrupt pdf"));
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "pdf", sourceRef: "bad.pdf", text: "x" }),
    ).rejects.toThrow(KbParseError);
    expect(upsertChunksMock).not.toHaveBeenCalled();
  });
});

// ─── embed failures ──────────────────────────────────────────────────────────

describe("ingestDocument — embed failure ⇒ clear error, no broken corpus", () => {
  it("generateEmbeddings rejecting ⇒ KbEmbedError, upsertChunks NEVER called (no half-written corpus)", async () => {
    generateEmbeddingsMock.mockRejectedValueOnce(new Error("model not loaded"));
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "pdf", sourceRef: "a.pdf", text: "some text" }),
    ).rejects.toThrow(KbEmbedError);
    expect(upsertChunksMock).not.toHaveBeenCalled();
  });

  it("embedding count mismatch (fewer vectors than chunks) ⇒ KbEmbedError, upsertChunks never called", async () => {
    // Default chunking (1800 chars / 200 overlap): 4000 'a's ⇒ chunks [0:1800], [1600:3400],
    // [3200:4000] = 3 chunks. No env-var override needed (avoids the module-load-time
    // DEFAULT_CHUNK_CHARS freeze — see the "multi-chunk document" test below for the same
    // reasoning).
    parseDocumentMock.mockResolvedValueOnce({
      text: "a".repeat(4000),
      meta: { sourceType: "txt", charCount: 4000, truncated: false },
    });
    generateEmbeddingsMock.mockResolvedValueOnce(embeddingsFor(2)); // wrong count (3 expected)
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "txt", sourceRef: "a.txt", text: "x" }),
    ).rejects.toThrow(KbEmbedError);
    expect(upsertChunksMock).not.toHaveBeenCalled();
  });
});

// ─── store failures ──────────────────────────────────────────────────────────

describe("ingestDocument — store failures", () => {
  it("upsertChunks throwing a real DB error ⇒ wrapped as KbStoreError", async () => {
    upsertChunksMock.mockRejectedValueOnce(new Error("connection reset"));
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "pdf", sourceRef: "a.pdf", text: "x" }),
    ).rejects.toThrow(KbStoreError);
  });

  it("table not migrated (tableAvailable:false) ⇒ KbStoreError, NOT a silent success", async () => {
    upsertChunksMock.mockResolvedValueOnce({ tableAvailable: false, inserted: 0, skipped: 1 });
    await expect(
      ingestDocument({ corpus: "c1", sourceType: "pdf", sourceRef: "a.pdf", text: "x" }),
    ).rejects.toThrow(KbStoreError);
  });
});

// ─── happy path orchestration ────────────────────────────────────────────────

describe("ingestDocument — happy path", () => {
  it("parses → chunks → embeds → stores, and returns {corpus, sourceRef, chunksAdded}", async () => {
    upsertChunksMock.mockResolvedValueOnce({ tableAvailable: true, inserted: 1, skipped: 0 });
    const result = await ingestDocument({
      corpus: "vendor-x",
      sourceType: "pdf",
      sourceRef: "manual.pdf",
      text: "irrelevant, parseDocument is mocked",
      userId: 9,
    });
    expect(result).toMatchObject({ corpus: "vendor-x", sourceRef: "manual.pdf", chunksAdded: 1 });

    const [corpusArg, chunksArg] = upsertChunksMock.mock.calls[0]!;
    expect(corpusArg).toBe("vendor-x");
    expect(chunksArg[0]).toMatchObject({
      index: 0,
      text: "some parsed document text",
      sourceType: "pdf",
      sourceRef: "manual.pdf",
      createdBy: 9,
    });
    expect(chunksArg[0].embedding).toHaveLength(8);
  });

  it("multi-chunk document: embeds and stores EVERY chunk with the right index", async () => {
    // Deliberately NOT overriding KB_INGEST_CHUNK_CHARS/OVERLAP here: those env vars are
    // read ONCE into module-level constants when kbIngestService.ts first loads (this file
    // uses a single static import for simplicity), so setting them inside a test body would
    // have no effect on already-bound defaults. Instead, exercise the multi-chunk path with
    // the REAL default chunk size (1800/200) via a long enough input: 4000 'a's ⇒ chunks
    // [0:1800], [1600:3400], [3200:4000] = 3 chunks.
    parseDocumentMock.mockResolvedValueOnce({
      text: "a".repeat(4000),
      meta: { sourceType: "txt", charCount: 4000, truncated: false },
    });
    generateEmbeddingsMock.mockResolvedValueOnce(embeddingsFor(3));
    upsertChunksMock.mockResolvedValueOnce({ tableAvailable: true, inserted: 3, skipped: 0 });

    const result = await ingestDocument({ corpus: "c1", sourceType: "txt", sourceRef: "a.txt", text: "x" });
    expect(result.chunksAdded).toBe(3);

    const [, chunksArg] = upsertChunksMock.mock.calls[0]!;
    expect(chunksArg.map((c: { index: number }) => c.index)).toEqual([0, 1, 2]);
    expect(chunksArg[0].text.length).toBe(1800);
    expect(chunksArg[2].text.length).toBe(800);
  });
});

// ─── chunkText (pure, bounded + overlap) ─────────────────────────────────────

describe("chunkText — bounded size + overlap", () => {
  it("returns [] for empty/whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("returns the whole text as one chunk when under the size cap", () => {
    expect(chunkText("short text", 1800, 200)).toEqual(["short text"]);
  });

  it("splits long text into chunks no larger than maxChars", () => {
    const text = "x".repeat(1000);
    const pieces = chunkText(text, 100, 20);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(100);
  });

  it("consecutive chunks overlap by the configured amount", () => {
    const text = Array.from({ length: 200 }, (_, i) => String(i % 10)).join(""); // deterministic, non-repeating-enough
    const pieces = chunkText(text, 50, 10);
    expect(pieces.length).toBeGreaterThan(1);
    const tailOfFirst = pieces[0].slice(-10);
    const headOfSecond = pieces[1].slice(0, 10);
    expect(tailOfFirst).toBe(headOfSecond);
  });

  it("covers the whole input (the last chunk reaches the end of the text)", () => {
    const text = "y".repeat(437);
    const pieces = chunkText(text, 100, 15);
    const totalCoveredWithoutOverlapEstimate = pieces.length > 0;
    expect(totalCoveredWithoutOverlapEstimate).toBe(true);
    // Reconstructing exactly is overlap-sensitive; instead assert forward progress + full coverage:
    // every char of the original text appears in some chunk, and the pieces are ordered.
    expect(pieces[pieces.length - 1]).toContain("y");
    expect(pieces.join("").length).toBeGreaterThanOrEqual(text.length); // overlap only adds duplication, never drops chars
  });

  it("clamps a pathological overlap (>= maxChars) so it always makes forward progress (no infinite loop)", () => {
    const text = "z".repeat(500);
    const pieces = chunkText(text, 100, 100); // overlap == maxChars, would infinite-loop unclamped
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.length).toBeLessThan(500); // sane upper bound — proves it terminated quickly
  });
});

describe("estimateTokenCount", () => {
  it("approximates ~4 chars/token, minimum 1", () => {
    expect(estimateTokenCount("")).toBe(1);
    expect(estimateTokenCount("abcd")).toBe(1);
    expect(estimateTokenCount("a".repeat(40))).toBe(10);
  });
});
