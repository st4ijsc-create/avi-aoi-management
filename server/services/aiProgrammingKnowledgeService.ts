/**
 * Doc 34 · P1 — PROGRAMMING Knowledge retrieval service (vendor manuals).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A PARALLEL retrieval service to `aiLocalKnowledgeService` (the ops/quality KB),
 * dedicated to the PROGRAMMING knowledge corpus (vendor PLC/robot/motion manuals).
 * It is deliberately SEPARATE from the ops KB:
 *   • different corpus  (knowledge/programming/<vendorSlug>/…, not knowledge/*)
 *   • different embed model space (Qwen3-Embedding 1024-d, per manifest.embedModel)
 *   • per-vendor / per-language metadata FILTERING (ops KB has none)
 *   • page-CITED results so a copilot can render "Vendor Manual, p.N".
 *
 * It RETRIEVES + assembles cited context only. It does NOT synthesise an answer
 * with an LLM — that is P2 (aiProgrammingCopilot). This keeps the retrieval layer
 * pure, cheap, and independently testable.
 *
 * REUSE (do NOT reimplement):
 *   • embeddings → aiGgufEngine.generateEmbedding / isGgufAvailable
 *   • reranking  → aiReranker.rerank (fail-safe cross-encoder/LLM reorder)
 * The cosine / keyword / hybrid-blend helpers below MIRROR the ops service's
 * private helpers (same blend weights 0.72/0.28, tanh(x/15) keyword squash).
 *
 * ── SHARED ON-DISK CONTRACT (an ingestion pipeline WRITES this — we READ it) ──
 *   knowledge/programming/<vendorSlug>/chunks.jsonl
 *     { id, vendor, docTitle, sourcePath, page, lang, section, text, keywords }
 *   knowledge/programming/<vendorSlug>/embeddings.jsonl
 *     { id, vector }   (1024-d Qwen3-Embedding; produced in a LATER runtime step —
 *                       may be ABSENT at first → degrade to keyword-only)
 *   knowledge/programming/manifest.json
 *     { generatedAt, embedModel, collections:[{vendor,docs,chunks,sourceDir}], totalChunks }
 * ALL of these may NOT EXIST yet (ingestion runs later). A missing dir/file is
 * treated as an EMPTY corpus — never a crash.
 *
 * ── SCALING NOTE (pgvector seam) ──
 * Retrieval here is IN-MEMORY brute-force cosine. The programming corpus is modest
 * (a few vendor manuals) so this is fine. A future option is to push the vectors
 * into pgvector for metadata-filtered ANN search — gated behind PROG_KB_PGVECTOR
 * (default false). That path is NOT implemented now; `usePgvector()` below is the
 * single clear seam where it would branch in.
 *
 * FLAGS (all read at call-time; defaults keep the service inert & safe):
 *   PROG_KB_ENABLED           (default false) — master gate; off → empty result
 *   PROG_KB_DIR               (default knowledge/programming)
 *   PROG_KB_RERANKER_ENABLED  (default true)  — reorder top-N via aiReranker
 *   PROG_KB_PGVECTOR          (default false) — future ANN store (NOT implemented)
 *   PROG_KB_EMBED_MODEL       (optional) — query embed model id; else manifest.embedModel
 *   PROG_KB_EMBED_DIM         (default 1024) — expected query/corpus vector length
 * ════════════════════════════════════════════════════════════════════════════
 */

import fs from "node:fs";
import path from "node:path";
import { rerank, type RerankCandidate } from "./aiReranker";

// ─── On-disk record shapes (the ingestion pipeline's contract) ────────────────

/** A chunk line from `<vendorSlug>/chunks.jsonl`. */
export interface ProgKbChunk {
  id: string;
  vendor: string;
  docTitle: string;
  sourcePath: string;
  /** 1-indexed manual page (may be null/absent for non-paginated sources). */
  page?: number | null;
  /** ISO-ish language tag (en/vi/zh/…); absent → treated as unfiltered. */
  lang?: string | null;
  /** Section / heading path within the doc (optional). */
  section?: string | null;
  text: string;
  keywords?: string[];
}

/** An embedding line from `<vendorSlug>/embeddings.jsonl`. */
interface ProgKbEmbeddingLine {
  id: string;
  vector: number[];
}

/** manifest.json shape (best-effort; every field optional at read time). */
interface ProgKbManifest {
  generatedAt?: string;
  embedModel?: string;
  totalChunks?: number;
  collections?: Array<{
    vendor?: string;
    docs?: number;
    chunks?: number;
    sourceDir?: string;
  }>;
}

// ─── In-memory model ──────────────────────────────────────────────────────────

interface ProgCollection {
  /** Directory name under PROG_KB_DIR (the vendor slug). */
  vendorSlug: string;
  chunks: ProgKbChunk[];
  /** id → UNIT-normalized embedding vector (empty when embeddings.jsonl absent). */
  vectorsById: Map<string, number[]>;
  hasEmbeddings: boolean;
}

interface ProgKbData {
  collections: ProgCollection[];
  manifest: ProgKbManifest | null;
  /** embedModel the corpus was built with (from manifest); null if unknown. */
  corpusEmbedModel: string | null;
  generatedAt: string | null;
  totalChunks: number;
  loadedAt: number;
}

// ─── Public result / status shapes ────────────────────────────────────────────

export interface ProgKbCitation {
  id: string;
  vendor: string;
  docTitle: string;
  /** 1-indexed page or null — carried so the copilot can show "Manual, p.N". */
  page: number | null;
  section: string | null;
  sourcePath: string;
  score: number;
}

export interface ProgKbSearchChunk extends ProgKbCitation {
  lang: string | null;
  text: string;
}

export interface ProgKbSearchResult {
  query: string;
  enabled: boolean;
  /** true when semantic (vector) scoring contributed; false → keyword-only. */
  semanticUsed: boolean;
  /** Assembled, numbered, cited context for a downstream (P2) LLM prompt. */
  answerContext: string;
  citations: ProgKbCitation[];
  chunks: ProgKbSearchChunk[];
  /**
   * G0 phần C — ms mà tầng rerank chiếm của lượt tìm này, đo tại ĐIỂM GỌI.
   * `null` = rerank không chạy (cờ tắt / ≤1 ứng viên / corpus rỗng) — khác `0`
   * ("đã chạy, dưới 1 ms"). Trước bản này `aiReranker.ts` không có một
   * `Date.now()` nào nên chi phí này vô hình với copilot lập trình.
   */
  rerankMs?: number | null;
}

export interface ProgKbCollectionSummary {
  vendor: string;
  vendorSlug: string;
  docs: number;
  chunks: number;
  hasEmbeddings: boolean;
  langs: string[];
}

export interface ProgKbStatus {
  enabled: boolean;
  dir: string;
  generatedAt: string | null;
  corpusEmbedModel: string | null;
  queryEmbedModel: string;
  embedModelMatches: boolean;
  pgvector: boolean;
  totalChunks: number;
  collections: ProgKbCollectionSummary[];
}

export interface SearchProgrammingKbParams {
  query: string;
  vendor?: string;
  lang?: string;
  topK?: number;
}

// ─── Flags / config (read at call-time so tests can flip env per-case) ─────────

function isEnabled(): boolean {
  return (process.env.PROG_KB_ENABLED ?? "false").toLowerCase() === "true";
}
function isRerankerEnabledForProgKb(): boolean {
  return (process.env.PROG_KB_RERANKER_ENABLED ?? "true").toLowerCase() === "true";
}
/**
 * Future pgvector ANN store for the programming corpus. NOT implemented — this is
 * the single seam where a metadata-filtered ANN query would replace the in-memory
 * brute-force scan. Left here so the branch point is obvious and greppable.
 */
function usePgvector(): boolean {
  return (process.env.PROG_KB_PGVECTOR ?? "false").toLowerCase() === "true";
}

function progKbDir(): string {
  const raw = process.env.PROG_KB_DIR || "knowledge/programming";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

/** Expected query/corpus vector length. A mismatch → skip semantic (keyword-only). */
function embedDim(): number {
  const n = parseInt(process.env.PROG_KB_EMBED_DIM || "1024", 10);
  return Number.isFinite(n) && n > 0 ? n : 1024;
}

/**
 * Resolve the model id the QUERY should be embedded with. It MUST live in the same
 * space as the corpus, so we prefer (1) an explicit PROG_KB_EMBED_MODEL override,
 * then (2) the corpus's own manifest.embedModel, then (3) the generic GGUF_EMBED_MODEL.
 * generateEmbedding resolves a model by basename, so we strip a ".gguf" suffix.
 */
function resolveQueryEmbedModelId(corpusEmbedModel: string | null): string {
  const explicit = process.env.PROG_KB_EMBED_MODEL;
  if (explicit && explicit.trim()) return path.basename(explicit.trim(), ".gguf");
  if (corpusEmbedModel && corpusEmbedModel.trim()) return path.basename(corpusEmbedModel.trim(), ".gguf");
  return path.basename(process.env.GGUF_EMBED_MODEL || "mxbai-embed-large-v1-f16.gguf", ".gguf");
}

/**
 * Normalize an embed-model identifier for IDENTITY comparison (corpus vs query).
 * Mirrors aiLocalKnowledgeService: basename, lowercased, strip ".gguf" and common
 * precision/quant suffixes so cosmetically-different spellings of the same model match.
 */
function normalizeEmbedModelId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = path.basename(String(raw).trim());
  s = s.replace(/\.gguf$/i, "").toLowerCase();
  s = s.replace(/[._-](f16|f32|bf16|q\d(_[\dkms]+)*|int8|int4)$/i, "");
  s = s.replace(/[._-]+$/g, "");
  return s || null;
}

/**
 * Does the corpus embed-model match the query embed-model? Returns true when the
 * corpus model is UNKNOWN (no manifest → don't false-alarm) or both normalize equal.
 * Returns false ONLY when both are known AND differ (semantic space would be corrupt).
 */
function computeEmbedModelMatches(corpusEmbedModel: string | null): boolean {
  const corpus = normalizeEmbedModelId(corpusEmbedModel);
  if (!corpus) return true;
  const query = normalizeEmbedModelId(resolveQueryEmbedModelId(corpusEmbedModel));
  if (!query) return true;
  return corpus === query;
}

let embedModelMismatchWarned = false;

// ─── Text utilities (mirror the ops service's private helpers) ────────────────

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_\-/.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "la", "co", "cua", "va", "voi", "cho", "hay", "thi", "de", "khong",
  "den", "tu", "nhu", "nay", "do", "can", "se", "da", "dang", "mot",
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is",
  "are", "be", "this", "that", "it", "as", "at", "by", "with", "from",
  "how", "what", "why", "can", "do", "does", "did", "i", "you", "we",
]);

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    .slice(0, 40);
}

/** Dot product over the shared prefix. Callers guarantee equal length before use. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) dot += a[i] * b[i];
  return dot;
}

/** L2-normalize a raw vector → unit vector (so cosine == dot product). */
function l2normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Keyword overlap score — mirrors the ops keywordScore weighting. */
function keywordScore(chunk: ProgKbChunk, tokens: string[]): number {
  const title = normalizeText(chunk.docTitle ?? "");
  const section = normalizeText(chunk.section ?? "");
  const text = normalizeText((chunk.text ?? "").slice(0, 3000));
  const src = normalizeText(chunk.sourcePath ?? "");
  const keywords = (chunk.keywords ?? []).map((k) => normalizeText(k));

  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (title.includes(t)) score += 2.5;
    if (keywords.some((k) => k === t)) score += 2;
    if (section.includes(t)) score += 1.5;
    if (src.includes(t)) score += 1;
    if (text.includes(t)) score += 1;
  }
  return score;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── JSONL / loading (best-effort; never throws on a bad line/file) ───────────

function parseJsonlLines<T>(filePath: string): T[] {
  // Read as a Buffer (not a utf8 string): a per-vendor embeddings.jsonl can exceed Node's
  // ~512 MiB max-string limit (delta ~640 MB, mitsubishi ~570 MB). readFileSync(path,"utf8")
  // would THROW on those and the old catch returned [] → those vendors silently degraded to
  // keyword-only despite having full embeddings. A Buffer holds up to ~2 GiB; we slice it
  // per-line and only ever materialize one (small) line-string at a time. Newlines (0x0A) never
  // occur inside a UTF-8 multi-byte sequence, so slicing on them is encoding-safe.
  let buf: Buffer;
  try {
    if (!fs.existsSync(filePath)) return [];
    buf = fs.readFileSync(filePath);
  } catch {
    return [];
  }
  const out: T[] = [];
  const NL = 0x0a;
  let start = 0;
  const pushLine = (end: number) => {
    if (end <= start) return;
    const s = buf.toString("utf8", start, end).trim();
    if (!s) return;
    try {
      out.push(JSON.parse(s) as T);
    } catch {
      // Skip a malformed line — a partial ingestion must not break the corpus.
    }
  };
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === NL) {
      pushLine(i);
      start = i + 1;
    }
  }
  pushLine(buf.length); // trailing line without a final newline
  return out;
}

/** Discover collection sub-directories that contain a chunks.jsonl. */
function discoverVendorSlugs(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => fs.existsSync(path.join(dir, name, "chunks.jsonl")))
      .sort();
  } catch {
    return [];
  }
}

function loadManifest(dir: string): ProgKbManifest | null {
  const p = path.join(dir, "manifest.json");
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as ProgKbManifest;
  } catch {
    return null;
  }
}

function loadCollection(dir: string, vendorSlug: string): ProgCollection {
  const chunks = parseJsonlLines<ProgKbChunk>(path.join(dir, vendorSlug, "chunks.jsonl")).filter(
    (c) => c && typeof c.id === "string" && typeof c.text === "string",
  );
  const embLines = parseJsonlLines<ProgKbEmbeddingLine>(path.join(dir, vendorSlug, "embeddings.jsonl"));
  const vectorsById = new Map<string, number[]>();
  for (const e of embLines) {
    if (e && typeof e.id === "string" && Array.isArray(e.vector) && e.vector.length > 0) {
      vectorsById.set(e.id, l2normalize(e.vector));
    }
  }
  return { vendorSlug, chunks, vectorsById, hasEmbeddings: vectorsById.size > 0 };
}

let dataCache: ProgKbData | null = null;

function loadData(forceReload = false): ProgKbData {
  if (dataCache && !forceReload) return dataCache;

  const dir = progKbDir();
  const manifest = loadManifest(dir);
  const slugs = discoverVendorSlugs(dir);

  const collections = slugs.map((slug) => loadCollection(dir, slug));
  const totalChunks = collections.reduce((sum, c) => sum + c.chunks.length, 0);

  const corpusEmbedModel =
    manifest && typeof manifest.embedModel === "string" && manifest.embedModel.trim()
      ? manifest.embedModel.trim()
      : null;
  const generatedAt =
    manifest && typeof manifest.generatedAt === "string" && manifest.generatedAt.trim()
      ? manifest.generatedAt.trim()
      : null;

  dataCache = {
    collections,
    manifest,
    corpusEmbedModel,
    generatedAt,
    totalChunks,
    loadedAt: Date.now(),
  };

  if (!computeEmbedModelMatches(corpusEmbedModel) && !embedModelMismatchWarned) {
    embedModelMismatchWarned = true;
    console.warn(
      `[aiProgrammingKnowledge] ⚠️ EMBED-MODEL MISMATCH — programming corpus embedded with ` +
        `"${corpusEmbedModel}" but query embed model is "${resolveQueryEmbedModelId(corpusEmbedModel)}". ` +
        `Semantic retrieval would be corrupt → falling back to keyword-only. Set PROG_KB_EMBED_MODEL ` +
        `to the corpus model or re-embed. (doc 34 · P1)`,
    );
  }

  return dataCache;
}

// ─── Query embedding (REUSES aiGgufEngine; never throws → keyword-only) ────────

async function embedQuery(query: string, corpusEmbedModel: string | null): Promise<number[] | null> {
  try {
    const { generateEmbedding, isGgufAvailable } = await import("./aiGgufEngine");
    if (!(await isGgufAvailable())) return null;
    const modelId = resolveQueryEmbedModelId(corpusEmbedModel);
    const { embedding } = await generateEmbedding(query, modelId);
    if (!Array.isArray(embedding) || embedding.length === 0) return null;
    if (embedding.length !== embedDim()) {
      console.warn(
        `[aiProgrammingKnowledge] query embedding dim mismatch (${embedding.length} ≠ ${embedDim()}) — ` +
          `skipping vector retrieval, falling back to keyword-only.`,
      );
      return null;
    }
    return l2normalize(embedding);
  } catch (err) {
    console.warn("[aiProgrammingKnowledge] query embedding failed, keyword-only:", err);
    return null;
  }
}

// ─── Filtering ────────────────────────────────────────────────────────────────

function collectionMatchesVendor(coll: ProgCollection, vendor: string | undefined): boolean {
  if (!vendor) return true;
  const v = vendor.trim().toLowerCase();
  if (!v) return true;
  if (coll.vendorSlug.toLowerCase() === v) return true;
  // Also allow matching the display `vendor` carried on the chunks themselves.
  return coll.chunks.some((c) => (c.vendor ?? "").toLowerCase() === v);
}

function chunkMatchesFilters(
  chunk: ProgKbChunk,
  vendorSlug: string,
  vendor: string | undefined,
  lang: string | undefined,
): boolean {
  if (vendor) {
    const v = vendor.trim().toLowerCase();
    if (v && vendorSlug.toLowerCase() !== v && (chunk.vendor ?? "").toLowerCase() !== v) return false;
  }
  if (lang) {
    const l = lang.trim().toLowerCase();
    if (l && (chunk.lang ?? "").toLowerCase() !== l) return false;
  }
  return true;
}

// ─── Search ───────────────────────────────────────────────────────────────────

interface ScoredChunk {
  uid: string;
  chunk: ProgKbChunk;
  score: number;
}

function emptyResult(query: string, enabled: boolean): ProgKbSearchResult {
  return { query, enabled, semanticUsed: false, answerContext: "", citations: [], chunks: [], rerankMs: null };
}

/**
 * Retrieve + assemble page-cited programming context. RETRIEVAL ONLY — no LLM
 * synthesis (that is P2). Returns a well-formed EMPTY result when the service is
 * disabled or the corpus is empty; never throws.
 */
export async function searchProgrammingKb(params: SearchProgrammingKbParams): Promise<ProgKbSearchResult> {
  const query = (params.query ?? "").trim();
  const topK = Math.max(1, Math.min(20, params.topK ?? 8));

  // Master gate: off → inert, well-formed empty result (no disk read, no crash).
  if (!isEnabled()) return emptyResult(query, false);
  if (!query) return emptyResult(query, true);

  const data = loadData();
  if (data.collections.length === 0 || data.totalChunks === 0) return emptyResult(query, true);

  // pgvector seam — future metadata-filtered ANN store (NOT implemented). When the
  // flag is on we STILL fall through to the in-memory scan so behavior is correct;
  // the log makes the unimplemented path visible without changing results.
  if (usePgvector()) {
    console.warn("[aiProgrammingKnowledge] PROG_KB_PGVECTOR=true but pgvector path is not implemented — using in-memory brute-force.");
  }

  const tokens = tokenize(query);

  // Embed the query ONCE (shared across collections). Skip entirely when the
  // corpus embed-model can't match the query model (semantic would be corrupt).
  const embedModelMatches = computeEmbedModelMatches(data.corpusEmbedModel);
  const anyEmbeddings = data.collections.some((c) => c.hasEmbeddings);
  const qVec = embedModelMatches && anyEmbeddings ? await embedQuery(query, data.corpusEmbedModel) : null;

  let semanticUsed = false;
  const scored: ScoredChunk[] = [];

  for (let ci = 0; ci < data.collections.length; ci += 1) {
    const coll = data.collections[ci];
    if (!collectionMatchesVendor(coll, params.vendor)) continue;

    for (const chunk of coll.chunks) {
      if (!chunkMatchesFilters(chunk, coll.vendorSlug, params.vendor, params.lang)) continue;

      const vec = qVec ? coll.vectorsById.get(chunk.id) : undefined;
      const hasVec = !!qVec && !!vec && vec.length === qVec.length;
      const semantic = hasVec ? cosine(qVec!, vec!) : 0;
      const keyword = Math.tanh(keywordScore(chunk, tokens) / 15);
      // Hybrid blend mirrors the ops service (0.72 semantic / 0.28 keyword);
      // keyword-only for chunks/collections without a usable vector.
      const score = hasVec ? semantic * 0.72 + keyword * 0.28 : keyword;
      if (hasVec) semanticUsed = true;

      scored.push({ uid: `${ci}:${chunk.id}`, chunk, score });
    }
  }

  if (scored.length === 0) return emptyResult(query, true);

  scored.sort((a, b) => b.score - a.score);

  // Rerank a wider top-N pool via the shared reranker, then reorder. The reranker
  // is FAIL-SAFE (returns original order if disabled or on any error), so calling
  // it is always safe; it only reorders when RAG_RERANKER_ENABLED is also on.
  let ranked = scored.slice(0, topK);
  // G0 phần C — null = tầng rerank không chạy cho lượt này (KHÁC 0 = chạy và nhanh).
  let rerankMs: number | null = null;
  if (isRerankerEnabledForProgKb() && scored.length > 1) {
    const poolSize = Math.max(topK, Number(process.env.PROG_KB_RERANKER_POOL ?? 20));
    const pool = scored.slice(0, poolSize);
    const candidates: RerankCandidate[] = pool.map((s) => ({
      id: s.uid,
      title: s.chunk.docTitle,
      text: s.chunk.text,
      score: clamp01(s.score),
    }));
    // Đo TẠI ĐIỂM GỌI (gồm cả chi phí nạp backend lần đầu) — xem `rerankMs` ở
    // ProgKbSearchResult. Đặt NGOÀI `try` để một lượt rerank HỎNG vẫn để lại số đo
    // (thời gian vẫn bị tiêu, im lặng ở đây là mù đúng ca đáng quan tâm nhất).
    const tRerank = Date.now();
    try {
      const reranked = await rerank(query, candidates, topK);
      const byUid = new Map(pool.map((s) => [s.uid, s]));
      const reordered = reranked
        .map((rr) => byUid.get(rr.candidate.id))
        .filter((s): s is ScoredChunk => Boolean(s));
      if (reordered.length > 0) ranked = reordered;
    } catch {
      // rerank() never throws, but stay defensive → keep cosine order.
      ranked = scored.slice(0, topK);
    } finally {
      rerankMs = Date.now() - tRerank;
      // Log CÓ CẤU TRÚC — chỉ số đếm và ms, KHÔNG truy vấn, KHÔNG nội dung chunk.
      console.log(`[aiProgrammingKnowledge] rerank pool=${candidates.length} topK=${topK} rerankMs=${rerankMs}`);
    }
  }

  const citations: ProgKbCitation[] = ranked.map((s) => ({
    id: s.chunk.id,
    vendor: s.chunk.vendor,
    docTitle: s.chunk.docTitle,
    page: typeof s.chunk.page === "number" ? s.chunk.page : null,
    section: s.chunk.section ?? null,
    sourcePath: s.chunk.sourcePath,
    score: Number(s.score.toFixed(6)),
  }));

  const chunks: ProgKbSearchChunk[] = ranked.map((s) => ({
    id: s.chunk.id,
    vendor: s.chunk.vendor,
    docTitle: s.chunk.docTitle,
    page: typeof s.chunk.page === "number" ? s.chunk.page : null,
    section: s.chunk.section ?? null,
    sourcePath: s.chunk.sourcePath,
    lang: s.chunk.lang ?? null,
    text: s.chunk.text,
    score: Number(s.score.toFixed(6)),
  }));

  const answerContext = ranked
    .map((s, i) => {
      const c = s.chunk;
      const pageStr = typeof c.page === "number" ? `, p.${c.page}` : "";
      const sectionStr = c.section ? ` · ${c.section}` : "";
      return `[${i + 1}] ${c.docTitle} (${c.vendor}${pageStr})${sectionStr}\n${c.text}`;
    })
    .join("\n\n");

  return { query, enabled: true, semanticUsed, answerContext, citations, chunks, rerankMs };
}

// ─── Status / collections summary ─────────────────────────────────────────────

function summarizeCollections(data: ProgKbData): ProgKbCollectionSummary[] {
  return data.collections.map((coll) => {
    const langs = new Set<string>();
    const docs = new Set<string>();
    let vendorName = coll.vendorSlug;
    for (const c of coll.chunks) {
      if (c.lang) langs.add(c.lang);
      if (c.docTitle) docs.add(c.docTitle);
      if (c.vendor) vendorName = c.vendor; // prefer the display vendor from chunks
    }
    return {
      vendor: vendorName,
      vendorSlug: coll.vendorSlug,
      docs: docs.size,
      chunks: coll.chunks.length,
      hasEmbeddings: coll.hasEmbeddings,
      langs: Array.from(langs).sort(),
    };
  });
}

/** Manifest + live summary of the programming corpus. Safe when disabled/empty. */
export function getProgrammingKbStatus(): ProgKbStatus {
  const data = loadData();
  return {
    enabled: isEnabled(),
    dir: progKbDir(),
    generatedAt: data.generatedAt,
    corpusEmbedModel: data.corpusEmbedModel,
    queryEmbedModel: resolveQueryEmbedModelId(data.corpusEmbedModel),
    embedModelMatches: computeEmbedModelMatches(data.corpusEmbedModel),
    pgvector: usePgvector(),
    totalChunks: data.totalChunks,
    collections: summarizeCollections(data),
  };
}

/** Clear the in-memory cache and reload from disk. Returns the fresh status. */
export function reloadProgrammingKb(): ProgKbStatus {
  dataCache = null;
  embedModelMismatchWarned = false;
  loadData(true);
  return getProgrammingKbStatus();
}

/** Exposed for callers/tests that only need the enabled flag without a disk read. */
export function isProgrammingKbEnabled(): boolean {
  return isEnabled();
}
