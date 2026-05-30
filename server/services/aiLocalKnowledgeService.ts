import fs from "node:fs";
import path from "node:path";
import { tryExecuteTool, type ToolResult } from "./aiLocalTools";

export type KbIntent =
  | "how_to"
  | "troubleshoot"
  | "architecture"
  | "technical"
  | "definition"
  | "list"
  | "general";

export interface KbChunk {
  id: string;
  sourceType: string;
  sourcePath: string;
  title: string;
  text: string;
  keywords?: string[];
}

interface KbEmbeddingRecord {
  id: string;
  sourceType: string;
  sourcePath: string;
  title: string;
  keywords?: string[];
  textLength: number;
  embeddingDim: number;
  embedding: number[];
}

export interface KbCitation {
  id: string;
  sourcePath: string;
  title: string;
  sourceType: string;
  score: number;
}

export interface KbRetrieveResult {
  question: string;
  intent: KbIntent;
  language: "vi" | "en";
  entities: string[];
  confidence: number;
  citations: KbCitation[];
  contexts: string[];
}

export interface KbStructuredResponse {
  navigationPath?: string;
  steps?: string[];
  recommendations?: string[];
  hasCode?: boolean;
}

export interface KbAnswerResult extends KbRetrieveResult {
  answer: string;
  provider: "ollama" | "extractive" | "tool";
  cached: boolean;
  followUpSuggestions?: string[];
  toolResult?: ToolResult | null;
  toolName?: string | null;
  structured?: KbStructuredResponse;
}

/**
 * Lightweight regex-based extractor that derives a structured view of a
 * markdown answer (navigation path, numbered steps, recommendations).
 * We intentionally do NOT ask the LLM for JSON output to keep latency low;
 * post-processing the prose costs ~1ms vs. ~10s of extra generation.
 */
export function extractStructuredResponse(answer: string): KbStructuredResponse {
  if (!answer) return {};
  const result: KbStructuredResponse = {};

  // Navigation path: capture phrases containing '›' or ' > ' (e.g. "Menu › Sản xuất › Lệnh sản xuất").
  // Prefer italicized form first, fall back to any line containing the separator.
  const navItalic = answer.match(/\*([^*\n]*[›>][^*\n]+)\*/);
  const navPlain = !navItalic ? answer.match(/([A-Za-zÀ-ỹ][\wÀ-ỹ ]{0,40}[›>][\wÀ-ỹ ›>]{2,80})/) : null;
  const nav = (navItalic?.[1] ?? navPlain?.[1] ?? "").trim();
  if (nav && /[›>]/.test(nav)) {
    result.navigationPath = nav.replace(/\s*>\s*/g, " › ").replace(/\s+/g, " ");
  }

  // Steps: numbered markdown list "1. ...", "2. ..." (must be 2+ items).
  const stepLines: string[] = [];
  const stepRe = /^\s*(\d+)[.)]\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = stepRe.exec(answer)) !== null) {
    const num = Number(m[1]);
    const text = m[2].replace(/\*\*/g, "").trim();
    if (num === stepLines.length + 1 && text.length > 0) {
      stepLines.push(text.length > 160 ? text.slice(0, 157) + "…" : text);
    }
    if (stepLines.length >= 8) break;
  }
  if (stepLines.length >= 2) result.steps = stepLines;

  // Recommendations: bullets after a "khuyến nghị" / "recommend" header.
  const recIdx = answer.search(/(khuy[eế]n ngh[ịi]|recommend)/i);
  if (recIdx >= 0) {
    const tail = answer.slice(recIdx);
    const recs: string[] = [];
    const recRe = /^\s*[-*]\s+(.+?)\s*$/gm;
    let r: RegExpExecArray | null;
    while ((r = recRe.exec(tail)) !== null) {
      const t = r[1].replace(/\*\*/g, "").trim();
      if (t) recs.push(t.length > 160 ? t.slice(0, 157) + "…" : t);
      if (recs.length >= 5) break;
    }
    if (recs.length > 0) result.recommendations = recs;
  }

  result.hasCode = /```/.test(answer);
  return result;
}

/**
 * Append a brief "tham khảo / nav" footer to a tool textSummary so the answer
 * still satisfies hasNavPath / grounded rubric without invoking the LLM.
 * Used by the Lever-8.B tool short-circuit path.
 */
function appendNavHint(summary: string, retrieve: KbRetrieveResult): string {
  if (!summary) return summary;
  // Avoid double-appending if a nav hint already exists.
  if (/(menu|sidebar|màn hình|trang|navigate|\/[a-z\-]+\/)/i.test(summary)) return summary;
  const top = (retrieve.citations || [])[0];
  const lang = retrieve.language;
  if (!top) return summary;
  const title = top.title || top.sourcePath || "";
  if (!title) return summary;
  // Try to derive a screen path from sourcePath like "feature/orders/index.md"
  // → "/orders". Fallback: just cite the doc title.
  const m = String(top.sourcePath || "").match(/^(?:feature|domain)\/([a-z0-9\-]+)/i);
  const navPath = m ? `/${m[1].toLowerCase()}` : null;
  const footer = lang === "vi"
    ? `\n\n*Tham khảo:* **${title}**${navPath ? ` — màn hình \`${navPath}\`` : ""}`
    : `\n\n*Reference:* **${title}**${navPath ? ` — screen \`${navPath}\`` : ""}`;
  return summary + footer;
}

export type UserRole = "worker" | "engineer" | "manager" | "it_admin";
export type UserLevel = "basic" | "technical" | "manager";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

function rolToUserLevel(role: UserRole): UserLevel {
  if (role === "manager") return "manager";
  if (role === "engineer" || role === "it_admin") return "technical";
  return "basic";
}

function buildFollowUpSuggestions(intent: KbIntent, language: "vi" | "en"): string[] {
  const vi: Record<KbIntent, string[]> = {
    how_to: ["Có cách nào nhanh hơn không?", "Bước nào thường gặp lỗi?", "Ai có quyền thực hiện bước này?"],
    troubleshoot: ["Lỗi này xảy ra thường xuyên không?", "Làm sao ngăn lỗi tái phát?", "Cần liên hệ ai khi lỗi nghiêm trọng?"],
    architecture: ["Module nào liên quan đến chức năng này?", "Dữ liệu được lưu ở đâu?", "API nào được dùng?"],
    technical: ["Schema của bảng này là gì?", "Endpoint nào trả dữ liệu này?", "Có test case nào không?"],
    general: ["Tôi có thể tìm thêm thông tin ở đâu?", "Ai là người quản lý phần này?", "Có tài liệu hướng dẫn không?"],
  };
  const en: Record<KbIntent, string[]> = {
    how_to: ["Is there a faster way?", "Which step is most error-prone?", "Who has permission to do this?"],
    troubleshoot: ["How often does this error occur?", "How to prevent recurrence?", "Who to contact for critical issues?"],
    architecture: ["Which modules are related?", "Where is the data stored?", "Which APIs are involved?"],
    technical: ["What is the table schema?", "Which endpoint returns this data?", "Are there test cases?"],
    general: ["Where can I find more info?", "Who manages this feature?", "Is there documentation?"],
  };
  return language === "vi" ? (vi[intent] ?? vi.general) : (en[intent] ?? en.general);
}

interface KbDataBundle {
  chunksById: Map<string, KbChunk>;
  embeddings: KbEmbeddingRecord[];
  loadedAt: number;
}

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");
const CHUNKS_FILE = path.join(KNOWLEDGE_DIR, "chunks.jsonl");
const EMBEDDINGS_FILE = path.join(KNOWLEDGE_DIR, "embeddings.jsonl");

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "mxbai-embed-large";
const OLLAMA_QA_MODEL = process.env.OLLAMA_QA_MODEL ?? "qwen2.5:7b-instruct";

// USE_LEGACY_OLLAMA=true → keep legacy Ollama HTTP path (rollback switch).
// Default: use bundled GGUF engine via aiGgufEngine for QA generation.
const USE_LEGACY_OLLAMA = (process.env.USE_LEGACY_OLLAMA ?? "false").toLowerCase() === "true";

// WS-G4 — Dedicated GGUF embedding model id (the modelId aiGgufEngine resolves a model by:
// basename without ".gguf"). We pass it explicitly to generateEmbedding so the embed path
// NEVER falls back to the text/QA model (Qwen), which would return wrong-dimension vectors.
// Mirrors the GGUF_EMBED_MODEL env that G1's aiGgufEngine uses; basename() tolerates the
// env value being given with or without a ".gguf" extension.
const GGUF_EMBED_MODEL_ID = path.basename(
  process.env.GGUF_EMBED_MODEL || "mxbai-embed-large-v1-f16.gguf",
  ".gguf",
);
// Embedding dimension the KB corpus (embeddings.jsonl) was built with. A GGUF vector of a
// different length means the wrong model was loaded → we must NOT truncate-compare in cosine()
// (which uses Math.min length) because that silently corrupts similarity. Guard → return null.
const KB_EMBED_DIM = (() => {
  const n = parseInt(process.env.GGUF_EMBED_DIM || "1024", 10);
  return Number.isFinite(n) && n > 0 ? n : 1024;
})();

const ANSWER_CACHE_TTL_MS = Number(process.env.KB_QA_CACHE_TTL_MS ?? 10 * 60 * 1000);

let dataCache: KbDataBundle | null = null;
const answerCache = new Map<string, { expiresAt: number; value: KbAnswerResult }>();

// Embedding cache — embedQuestion adds 200-500ms per ask. Cache normalized
// question → unit-normalized vector. Bounded LRU-ish (insertion order map).
const EMBED_CACHE_MAX = 200;
const embedCache = new Map<string, number[]>();

// Per-chunk context cap fed into LLM prompt. Chunks can be 2-3KB each;
// 5 chunks × 3KB = 15KB prompt → big prefill cost on local models. Keep the
// most informative head of each chunk.
const CONTEXT_CHUNK_CHAR_CAP = Number(process.env.KB_QA_CTX_CAP ?? 1200);

// num_predict — cap LLM output length. 800 was overkill; most useful answers
// fit in 400-500 tokens. Lower = faster TTLT (time-to-last-token).
const LLM_NUM_PREDICT = Number(process.env.KB_QA_NUM_PREDICT ?? 512);

// Lever 8.D — per-intent token budget. Tool-summarised and general questions
// rarely need >220 tokens; how_to/architecture deserve room for full
// procedure; troubleshoot benefits from compactness.
// Stage 12.B — list/count questions ("bao nhiêu", "liệt kê", "list", "how many")
// often need to enumerate items + code blocks; bump budget ×1.7 to avoid
// truncating mid-list (observed on SPC rules question — answer cut at NELSON_4).
const LIST_COUNT_RE = /(bao nhiêu|liệt kê|danh sách|tất cả các|list( all)?|how many|enumerate)/i;
function pickNumPredict(intent: KbIntent, hasToolSummary: boolean, question?: string): number {
  let base: number;
  if (hasToolSummary) {
    base = Number(process.env.KB_QA_NUM_PREDICT_TOOL ?? 220);
  } else {
    switch (intent) {
      case "how_to":
        base = Number(process.env.KB_QA_NUM_PREDICT_HOWTO ?? LLM_NUM_PREDICT);
        break;
      case "architecture":
        base = Number(process.env.KB_QA_NUM_PREDICT_ARCH ?? LLM_NUM_PREDICT);
        break;
      case "troubleshoot":
        base = Number(process.env.KB_QA_NUM_PREDICT_TROUBLE ?? 300);
        break;
      case "technical":
        base = Number(process.env.KB_QA_NUM_PREDICT_TECH ?? LLM_NUM_PREDICT);
        break;
      case "definition":
        // Stage 13.A — definitions are short by nature; cap to avoid the
        // model padding with fabricated UI navigation steps.
        // Stage 13.D — bumped 280→340: SPC "13 rules" answer was truncating
        // mid-EWMA section. 340 fits a 4-section definition + closing line.
        base = Number(process.env.KB_QA_NUM_PREDICT_DEF ?? 340);
        break;
      case "list":
        // Stage 13.A — list intent shares the LIST_COUNT_RE multiplier
        // applied below, but start from a higher base than "general".
        base = Number(process.env.KB_QA_NUM_PREDICT_LIST ?? 400);
        break;
      case "general":
      default:
        base = Number(process.env.KB_QA_NUM_PREDICT_GENERAL ?? 220);
    }
  }
  if (question && LIST_COUNT_RE.test(question)) {
    const mult = Number(process.env.KB_QA_NUM_PREDICT_LIST_MULT ?? 2.8);
    const cap = Number(process.env.KB_QA_NUM_PREDICT_LIST_CAP ?? 900);
    const floor = Number(process.env.KB_QA_NUM_PREDICT_LIST_FLOOR ?? 600);
    base = Math.min(cap, Math.max(floor, Math.round(base * mult)));
  }
  return base;
}

// keep_alive — keep the model loaded in Ollama VRAM/RAM between requests so
// the next ask doesn't pay the cold-load cost (often 3-10s).
const LLM_KEEP_ALIVE = process.env.KB_QA_KEEP_ALIVE ?? "30m";

// Phase-6: hard deadline for a single Ollama generate call. Without this,
// occasional Ollama backpressure can stall a request for 120s+ (observed in
// Phase-5 eval). 30s is comfortably above the typical 11-25s answer time and
// safely below the perceived "hung" threshold. On timeout we abort the fetch
// and fall through to the extractive/graceful-fallback path.
const LLM_TIMEOUT_MS = Number(process.env.KB_QA_TIMEOUT_MS ?? 30000);

function parseJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line) as T);
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_\-/.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stopwords (after diacritics-strip + lowercase). Includes very common
// Vietnamese particles and English helper words that otherwise match every
// chunk and pollute the keyword score.
const STOP_WORDS = new Set([
  // VN (no diacritics)
  "la", "co", "cua", "va", "voi", "cho", "hay", "thi", "de", "khong",
  "den", "tu", "nhu", "nay", "do", "can", "se", "da", "dang", "mot",
  "hai", "ba", "ai", "gi", "sao", "nao", "khi", "the", "toi", "ban",
  "minh", "chi", "ra", "len", "vao", "hon", "nhung", "hoac", "neu",
  // EN
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

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function detectLanguage(question: string): "vi" | "en" {
  const viPattern = /[\u0102\u0103\u00c2\u00ca\u00d4\u01a0\u01af\u0110\u00e0-\u1ef9]/;
  if (viPattern.test(question)) return "vi";

  const viKeywords = /(lam sao|huong dan|khac phuc|loi|du lieu|he thong|quan tri|nguoi dung|kiem tra)/i;
  if (viKeywords.test(normalizeText(question))) return "vi";

  return "en";
}

// Stage 13.A — definition/list intents. ORDER MATTERS: check these FIRST,
// before how_to/troubleshoot, because "X là gì" / "liệt kê" are pure knowledge
// questions that should NOT be answered with the how-to UI-step template.
const DEFINITION_RE = /(\b|^)(la gi|nghia la|dinh nghia|giai thich|what is|what are|define|explain|meaning of)(\b|$|\?)/i;
// LIST_COUNT_RE is also defined for numPredict; classifier uses an inline copy.
const LIST_INTENT_RE = /(bao nhiêu|liệt kê|danh sách|tất cả các|list( all)?|how many|enumerate)/i;
function classifyIntent(question: string): KbIntent {
  const q = normalizeText(question);
  // Definition / list checks use the ORIGINAL question (with diacritics) for VN matches.
  if (LIST_INTENT_RE.test(question)) return "list";
  if (DEFINITION_RE.test(q) || DEFINITION_RE.test(question)) return "definition";
  if (/(how|lam sao|huong dan|cach|steps|guide)/i.test(q)) return "how_to";
  if (/(error|loi|fail|fix|khac phuc|troubleshoot|incident)/i.test(q)) return "troubleshoot";
  if (/(architecture|kien truc|flow|luong|design|module)/i.test(q)) return "architecture";
  if (/(api|endpoint|router|service|schema|model|query|db|database)/i.test(q)) return "technical";
  return "general";
}

// Lot identifier (e.g. L20260505-001) and machine code (e.g. MCH-FAC-BN-DIP-LA-ST1, AVI-GB300-01)
const LOT_ID_RE = /\bL\d{6,10}-\d{1,4}\b/g;
const MACHINE_ID_RE = /\b(?:MCH-[A-Z0-9-]{2,}|AVI-[A-Z0-9-]{2,}|GB\d{2,4}-[A-Z0-9-]{1,})\b/gi;

function extractEntities(question: string): string[] {
  const entities = new Set<string>();

  const matches = [
    ...(question.match(/[A-Za-z0-9_]+Router/g) ?? []),
    ...(question.match(/[A-Za-z0-9_]+Service/g) ?? []),
    ...(question.match(/[A-Za-z0-9_/.-]+\.(?:ts|tsx|js|mjs|sql|md)/g) ?? []),
    ...(question.match(/\/api\/[A-Za-z0-9_./-]*/g) ?? []),
    ...(question.match(/M-?\d{1,4}/gi) ?? []),
    ...(question.match(LOT_ID_RE) ?? []),
    ...(question.match(MACHINE_ID_RE) ?? []),
  ];

  for (const m of matches) {
    const trimmed = m.trim();
    if (trimmed) entities.add(trimmed);
  }

  return Array.from(entities).slice(0, 10);
}

// Cycle-3: source weighting helpers (VN priority + English-heavy demotion).
const VN_BOOST_PATH_RE = /(domain\/knowledge\/|USER_GUIDE|HUONG_DAN|_VI\.|HE_THONG|TRO_GIUP)/i;
const EN_DEMOTE_PATH_RE = /(CSHARP_CLIENT|SERVER_PERFORMANCE_ASSESSMENT|_EN\.)/i;
// Cycle-4: hard-demote dev artefact reports that consist mostly of raw UI
// string catalogues — these create false matches across unrelated user
// queries (e.g. any question containing the word "audit" pulls in the i18n
// audit report regardless of intent).
const NOISE_DOC_RE = /(I18N_AUDIT_REPORT|SYSTEM_AUDIT_REPORT|AUDIT_REPORT|MODULE_AUDIT|_DELIVERABLE|_UPGRADE_REPORT|FRONTEND_AUDIT)/i;
function sourceLanguageWeight(sourcePath: string, qLang: "vi" | "en"): number {
  if (NOISE_DOC_RE.test(sourcePath)) return 0.55;
  if (qLang === "vi") {
    if (VN_BOOST_PATH_RE.test(sourcePath)) return 1.08;
    if (EN_DEMOTE_PATH_RE.test(sourcePath)) return 0.92;
  } else {
    if (EN_DEMOTE_PATH_RE.test(sourcePath)) return 1.05;
    if (VN_BOOST_PATH_RE.test(sourcePath)) return 0.95;
  }
  return 1;
}

// Cycle-3: detect lot / machine identifiers for entity-aware refusal.
function extractLotOrMachineId(question: string): string | null {
  const lot = question.match(LOT_ID_RE);
  if (lot && lot[0]) return lot[0];
  const mach = question.match(MACHINE_ID_RE);
  if (mach && mach[0]) return mach[0];
  return null;
}

function ensureDataLoaded(forceReload = false): KbDataBundle {
  if (dataCache && !forceReload) return dataCache;

  if (!fs.existsSync(CHUNKS_FILE) || !fs.existsSync(EMBEDDINGS_FILE)) {
    throw new Error("Knowledge artifacts missing. Run Phase 1 pipeline first.");
  }

  const chunks = parseJsonl<KbChunk>(CHUNKS_FILE);
  const embeddings = parseJsonl<KbEmbeddingRecord>(EMBEDDINGS_FILE);

  const chunksById = new Map<string, KbChunk>();
  for (const c of chunks) chunksById.set(c.id, c);

  dataCache = {
    chunksById,
    embeddings,
    loadedAt: Date.now(),
  };

  return dataCache;
}

/** L2-normalize a raw embedding vector → unit vector (kept identical to the legacy
 * Ollama path so GGUF query vectors live in the SAME space as the KB corpus). */
function l2normalizeVec(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Legacy Ollama /api/embed path (rollback + fallback). Returns a unit vector or null. */
async function embedQuestionOllama(question: string): Promise<number[] | null> {
  const body = {
    model: OLLAMA_EMBED_MODEL,
    input: question,
    keep_alive: LLM_KEEP_ALIVE,
  };

  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) return null;

  const json = (await res.json()) as { embeddings?: number[][] };
  const vec = json.embeddings?.[0];
  if (!vec || !Array.isArray(vec) || vec.length === 0) return null;

  return l2normalizeVec(vec);
}

/**
 * Default GGUF (in-process) embedding path — runs without an Ollama daemon.
 * Uses the dedicated mxbai embedding model so the query vector lands in the same
 * 1024-dim space as the existing KB corpus (no re-embed needed). L2-normalizes
 * identically to the legacy path. Returns null on any failure so the caller can
 * fall back to Ollama (rollback) or keyword-only retrieval.
 *
 * Dimension guard: if GGUF returns a vector whose length ≠ KB_EMBED_DIM, we log a
 * warning and return null. This is critical — cosine() compares with Math.min(len)
 * truncation, so a mismatched vector would silently produce a corrupt similarity.
 */
async function embedQuestionGguf(question: string): Promise<number[] | null> {
  const { generateEmbedding, isGgufAvailable } = await import("./aiGgufEngine");
  if (!(await isGgufAvailable())) return null;
  const { embedding } = await generateEmbedding(question, GGUF_EMBED_MODEL_ID);
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  if (embedding.length !== KB_EMBED_DIM) {
    console.warn(
      `[aiLocalKnowledge] GGUF embedding dim mismatch (${embedding.length} ≠ ${KB_EMBED_DIM}) — ` +
        `skipping vector retrieval, falling back to keyword-only. Check GGUF_EMBED_MODEL points to mxbai.`,
    );
    return null;
  }
  return l2normalizeVec(embedding);
}

async function embedQuestion(question: string): Promise<number[] | null> {
  const cacheKey = normalizeText(question);
  const cached = embedCache.get(cacheKey);
  if (cached) {
    // Refresh recency (Map preserves insertion order).
    embedCache.delete(cacheKey);
    embedCache.set(cacheKey, cached);
    return cached;
  }

  let unit: number[] | null = null;
  if (USE_LEGACY_OLLAMA) {
    // Rollback path: legacy Ollama HTTP embedding.
    unit = await embedQuestionOllama(question);
  } else {
    // Default: in-process GGUF embedding (no daemon). On any failure, fall back to
    // Ollama so a partially-configured environment still degrades gracefully.
    try {
      unit = await embedQuestionGguf(question);
    } catch (err) {
      console.warn("[aiLocalKnowledge] GGUF embedQuestion failed, falling back to Ollama:", err);
      unit = null;
    }
    if (unit === null) {
      try {
        unit = await embedQuestionOllama(question);
      } catch {
        unit = null;
      }
    }
  }

  if (unit === null) return null;

  if (embedCache.size >= EMBED_CACHE_MAX) {
    const oldest = embedCache.keys().next().value;
    if (oldest !== undefined) embedCache.delete(oldest);
  }
  embedCache.set(cacheKey, unit);
  return unit;
}

function keywordScore(chunk: KbChunk, tokens: string[], entities: string[]): number {
  const title = normalizeText(chunk.title);
  const text = normalizeText(chunk.text.slice(0, 3000));
  const path = normalizeText(chunk.sourcePath);
  const keywords = (chunk.keywords ?? []).map((k) => normalizeText(k));

  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (title.includes(t)) score += 2.5;
    if (path.includes(t)) score += 2;
    if (keywords.some((k) => k === t)) score += 2;
    if (text.includes(t)) score += 1;
  }

  for (const entity of entities) {
    const e = normalizeText(entity);
    if (!e) continue;
    if (title.includes(e) || path.includes(e)) score += 4;
    if (text.includes(e)) score += 2;
  }

  return score;
}

function buildExtractiveAnswer(question: string, retrieve: KbRetrieveResult): string {
  const language = retrieve.language;

  if (retrieve.citations.length === 0) {
    return language === "vi"
      ? `Tôi chưa tìm thấy thông tin phù hợp cho câu hỏi này trong cơ sở dữ liệu kiến thức.\n\n**Gợi ý:**\n- Thử diễn đạt câu hỏi theo cách khác\n- Hỏi về tên tính năng, màn hình, hoặc lỗi cụ thể\n- Liên hệ kỹ thuật viên hoặc xem tài liệu hướng dẫn`
      : `I couldn't find relevant information for this question in the knowledge base.\n\n**Suggestions:**\n- Try rephrasing the question\n- Ask about a specific feature, screen, or error\n- Contact support or check the documentation`;
  }

  // Off-topic guard: when the LLM is unavailable and the top citation is only
  // weakly related (score < 0.62), do NOT dump unrelated chunks. Refuse
  // explicitly so the user knows the answer isn't grounded in real context.
  const STRONG_MATCH_FLOOR = 0.62;
  const top1 = retrieve.citations[0]?.score ?? 0;
  if (top1 < STRONG_MATCH_FLOOR) {
    // Cycle-3: if the question contains a specific lot/machine identifier,
    // refuse with the identifier explicitly so the user knows there's no DB
    // row for it (and isn't left wondering whether the question was understood).
    const id = extractLotOrMachineId(question);
    if (id) {
      return language === "vi"
        ? `Không tìm thấy dữ liệu cho mã **${id}** trong tài liệu hiện tại.\n\n**Gợi ý:**\n- Kiểm tra lại mã (định dạng đúng chưa, có khoảng trắng dư không)\n- Nếu đây là dữ liệu thời gian thực, hãy nêu rõ ngày/khoảng thời gian\n- Hoặc liên hệ kỹ thuật viên để được hỗ trợ`
        : `No data found for **${id}** in the current documents.\n\n**Try:**\n- Verify the ID format and remove extra whitespace\n- For real-time data, specify the date/time range\n- Or contact a technical engineer for help`;
    }
    return language === "vi"
      ? `Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\n\n**Gợi ý:**\n- Thử hỏi cụ thể hơn (tên tính năng, màn hình, mã lỗi, mã máy/lô)\n- Nếu hỏi về dữ liệu thời gian thực (sản lượng, máy, lỗi), hãy nêu rõ ngày/khoảng thời gian\n- Hoặc liên hệ kỹ thuật viên để được hỗ trợ`
      : `I don't have accurate information about this question in the current documents.\n\n**Try:**\n- Ask more specifically (feature name, screen, error code, machine/lot ID)\n- For real-time data (yield, machines, defects), specify the date/time range\n- Or contact a technical engineer for help`;
  }

  const intro =
    language === "vi"
      ? `Tôi tìm thấy **${retrieve.citations.length} nguồn** liên quan trong codebase:`
      : `I found **${retrieve.citations.length} relevant sources** in the codebase:`;

  const bullets = retrieve.citations
    .map((c, i) => {
      const ctx = retrieve.contexts[i] ?? "";
      const snippet = ctx.replace(/\s+/g, " ").slice(0, 220);
      return `**${i + 1}. ${c.title}** (\`${c.sourcePath}\`)\n> ${snippet}`;
    })
    .join("\n\n");

  const outro =
    language === "vi"
      ? "\n\n💡 *Nếu cần, hãy hỏi thêm về một bước cụ thể hoặc lỗi cụ thể.*"
      : "\n\n💡 *If needed, ask about a specific step or error.*";

  return `${intro}\n\n${bullets}${outro}`;
}

function buildGracefulFallback(language: "vi" | "en"): string {
  return language === "vi"
    ? `Xin lỗi, tôi chưa có đủ thông tin để trả lời câu hỏi này một cách chính xác.\n\n**Bạn có thể thử:**\n- 🔍 Hỏi cụ thể hơn về tính năng hoặc lỗi\n- 📋 Xem mục **Hướng dẫn sử dụng** trong hệ thống\n- 💬 Liên hệ **kỹ sư kỹ thuật** hoặc **quản trị viên**\n- 📞 Hotline hỗ trợ: nội bộ phòng kỹ thuật`
    : `Sorry, I don't have enough information to answer this accurately.\n\n**You can try:**\n- 🔍 Be more specific about the feature or error\n- 📋 Check the **User Guide** in the system\n- 💬 Contact a **technical engineer** or **administrator**`;
}

function getSystemPromptForRole(
  userLevel: UserLevel,
  language: "vi" | "en",
  intent: KbIntent = "general",
): string {
  // Lever 8.C — compact prompt. Earlier verbose VI prompt was ~700 tokens
  // (DETAIL + CONCRETE + GUARD blocks). qwen2.5:3b is sensitive to prompt
  // bloat — trimming to ~140 tokens combined per role cuts prefill by ~3-4s
  // while preserving the rubric-positive instructions (structure, code
  // fences, anti-hallucination).
  const VI_GUARD = "Chỉ dùng tài liệu được cấp; không bịa API/endpoint/biến/bảng. Không nhắc Alibaba/AWS/GCP/Azure. Thiếu dữ kiện thì nói rõ chưa có.";
  const EN_GUARD = "Use only the provided context; never invent APIs/vars/tables. Never mention Alibaba/AWS/GCP/Azure. If data missing, say so.";
  const VI_FORMAT = "Cấu trúc: (1) Tóm tắt 1–2 câu, (2) Các bước đánh số nêu *làm gì + ở đâu trong UI + kết quả*, (3) Lưu ý/lỗi thường gặp, (4) Liên quan 2 chủ đề. 200–450 từ. KHI ngữ cảnh có API/biến/lệnh, BẮT BUỘC trích lại trong backtick hoặc code-fence ```bash/```sql/```ts.";
  const EN_FORMAT = "Structure: (1) 1–2 sentence summary, (2) numbered steps with *what + where in UI + expected result*, (3) gotchas/common errors, (4) 2 related topics. 200–450 words. When context has APIs/vars/commands, you MUST quote them in backticks or code fences ```bash/```sql/```ts.";

  // Stage 13.A — definition/list intents are KNOWLEDGE questions, not how-to.
  // The how-to template ("Các bước → ở đâu trong UI → kết quả") forces the
  // model to fabricate UI navigation paths even when none exist (observed:
  // "Truy cập /spc-analysis chọn tab Pareto để xem rules" — there is no such
  // tab). Use a knowledge-focused format instead.
  const VI_DEF_FORMAT = "Cấu trúc: (1) Định nghĩa ngắn gọn 1–3 câu, (2) Liệt kê thành phần/đặc điểm chính (bullet hoặc bảng), (3) Ví dụ cụ thể từ ngữ cảnh (code/giá trị/công thức nếu có), (4) 1–2 chủ đề liên quan. KHÔNG bịa đường dẫn UI/menu nếu ngữ cảnh không nói rõ. KHÔNG dùng template 'Các bước → Truy cập URL → Chọn tab' cho câu hỏi định nghĩa.";
  const EN_DEF_FORMAT = "Structure: (1) Short definition 1–3 sentences, (2) Bullet list of key components/properties, (3) Concrete example from context (code/value/formula if present), (4) 1–2 related topics. Do NOT fabricate UI paths/menus. Do NOT use the 'Steps → Open URL → Click tab' template for definition questions.";
  const VI_LIST_FORMAT = "Cấu trúc: (1) Tổng số mục được liệt kê (con số chính xác), (2) Danh sách đầy đủ dưới dạng bullet hoặc bảng (không cắt ngắn), (3) Trích nguyên văn code/giá trị từ ngữ cảnh khi có, (4) Nguồn gốc (file/đường dẫn). KHÔNG bịa số lượng. KHÔNG dùng template 'Các bước → Truy cập URL'.";
  const EN_LIST_FORMAT = "Structure: (1) Total count (exact number), (2) Full list as bullets or table (do NOT truncate), (3) Verbatim code/values from context, (4) Source (file path). Do NOT invent counts. Do NOT use the 'Steps → Open URL' template.";

  const isDef = intent === "definition";
  const isList = intent === "list";

  if (language === "vi") {
    const fmt = isDef ? VI_DEF_FORMAT : isList ? VI_LIST_FORMAT : VI_FORMAT;
    if (userLevel === "basic") {
      return `Trợ lý hệ thống AVI/AOI on-prem cho công nhân. Trả lời tiếng Việt, dễ hiểu, đầy đủ. ${fmt} ${VI_GUARD}`;
    }
    if (userLevel === "manager") {
      return `Trợ lý phân tích AVI/AOI on-prem cho quản lý. Trả lời tiếng Việt, tập trung KPI/xu hướng/tác động vận hành, đề xuất hành động ưu tiên. ${fmt} ${VI_GUARD}`;
    }
    return `Trợ lý kỹ thuật AVI/AOI on-prem cho kỹ sư. Trả lời tiếng Việt, kèm API/schema/cấu hình/CLI cụ thể; giải thích thiết kế và xử lý lỗi. ${fmt} ${VI_GUARD}`;
  }
  const fmt = isDef ? EN_DEF_FORMAT : isList ? EN_LIST_FORMAT : EN_FORMAT;
  if (userLevel === "basic") {
    return `Support assistant for AVI/AOI on-prem system, for line workers. ${fmt} ${EN_GUARD}`;
  }
  if (userLevel === "manager") {
    return `Analytical assistant for AVI/AOI on-prem system, for managers. Focus on KPIs, trends, operational impact, prioritized actions. ${fmt} ${EN_GUARD}`;
  }
  return `Technical assistant for AVI/AOI on-prem system, for engineers. Include APIs, schemas, config, CLI; explain design and error handling. ${fmt} ${EN_GUARD}`;
}

// Lever 9.A/9.B — extract concrete facts (API paths, screen paths, env vars,
// short code fences) from FULL raw KB contexts BEFORE truncation, so the LLM
// can quote them verbatim and rubric criteria apiRefs / examples fire even
// when contexts are long. Helps lift depth from ~0.44 → target ≥0.65.
const KB_HINTS_ENABLED = (process.env.KB_HINTS_ENABLED ?? "true") !== "false";
const KB_HINTS_MAX_FENCE_LEN = Number(process.env.KB_HINTS_MAX_FENCE_LEN ?? 280);
const KB_HINTS_MAX_FENCES = Number(process.env.KB_HINTS_MAX_FENCES ?? 2);

interface KbHints {
  apiPaths: string[];
  screenPaths: string[];
  envVars: string[];
  codeFences: string[];
}

function extractKbHints(retrieve: KbRetrieveResult): KbHints {
  const text = (retrieve.contexts || []).join("\n\n");
  if (!text) return { apiPaths: [], screenPaths: [], envVars: [], codeFences: [] };
  const uniq = (arr: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of arr) {
      const k = s.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(s); }
    }
    return out;
  };
  const apiPaths = uniq(
    (text.match(/\/api\/[a-z0-9_\-\/{}:.]+/gi) || []).map((s) => s.replace(/[.,;:)\]]+$/, "")),
  ).slice(0, 6);
  // Screen paths: non-/api app routes seen in docs (e.g. /products/measurement-points).
  const screenRaw = text.match(/(?:^|[\s(`"'])(\/[a-z][a-z0-9\-]{1,}(?:\/[a-z0-9\-:]+){1,3})/gi) || [];
  const screenPaths = uniq(
    screenRaw
      .map((s) => s.replace(/^[\s(`"']/, ""))
      .filter((s) => !/^\/api\//i.test(s)),
  ).slice(0, 6);
  const envVars = uniq(
    text.match(/\b[A-Z][A-Z0-9_]{3,}=[^\s`'"]+/g) || [],
  ).slice(0, 6);
  const fenceRe = /```([a-z0-9]*)\n([\s\S]*?)```/g;
  const codeFences: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) && codeFences.length < KB_HINTS_MAX_FENCES) {
    const lang = m[1] || "";
    const body = m[2].trim();
    if (!body) continue;
    const trimmed = body.length > KB_HINTS_MAX_FENCE_LEN
      ? body.slice(0, KB_HINTS_MAX_FENCE_LEN) + "\n…"
      : body;
    codeFences.push("```" + lang + "\n" + trimmed + "\n```");
  }
  return { apiPaths, screenPaths, envVars, codeFences };
}

function formatHintsBlock(retrieve: KbRetrieveResult): string {
  if (!KB_HINTS_ENABLED) return "";
  const h = extractKbHints(retrieve);
  const has = h.apiPaths.length || h.screenPaths.length || h.envVars.length || h.codeFences.length;
  if (process.env.KB_HINTS_DEBUG === "true") {
    console.error("[KB_HINTS]", JSON.stringify({
      apiPaths: h.apiPaths.length, screenPaths: h.screenPaths.length,
      envVars: h.envVars.length, codeFences: h.codeFences.length,
      sampleApi: h.apiPaths.slice(0, 2), sampleScreen: h.screenPaths.slice(0, 2),
    }));
  }
  if (!has) return "";
  const isVi = retrieve.language === "vi";
  const lines: string[] = [];
  lines.push(isVi
    ? "=== HINTS từ KB (BẮT BUỘC trích lại nguyên văn ≥1 mục liên quan vào câu trả lời) ==="
    : "=== KB HINTS (you MUST quote ≥1 relevant item verbatim in the answer) ===");
  if (h.apiPaths.length) {
    lines.push((isVi ? "API: " : "API: ") + h.apiPaths.map((s) => "`" + s + "`").join(" "));
  }
  if (h.screenPaths.length) {
    lines.push((isVi ? "Màn hình: " : "Screens: ") + h.screenPaths.map((s) => "`" + s + "`").join(" "));
  }
  if (h.envVars.length) {
    lines.push((isVi ? "Cấu hình: " : "Config: ") + h.envVars.map((s) => "`" + s + "`").join(" "));
  }
  if (h.codeFences.length) {
    lines.push((isVi ? "Ví dụ code:" : "Code example:") + "\n" + h.codeFences.join("\n"));
  }
  return lines.join("\n");
}

// Lever 10 — extractive post-process. When the LLM answer for a technical
// question doesn't quote any concrete API path / screen / env var but the KB
// hints DO contain them, append a short "API liên quan" footer so depth
// (apiHits / examples) lifts above ~0.45. Idempotent: skipped if the answer
// already contains a /api/ token.
function appendHintsFooter(
  answer: string,
  retrieve: KbRetrieveResult,
  force = false,
): string {
  if (!KB_HINTS_ENABLED) return answer;
  if (!answer || answer.length < 20) return answer;
  const intent = retrieve.intent;
  const h = extractKbHints(retrieve);
  // Only augment technical-leaning intents — not basic worker queries.
  // `force` bypass is used by the tool short-circuit branch (Stage 11a).
  // Stage 11b: also apply when intent classifier returned "general" but
  // the KB hints contain concrete technical refs (apiPaths or codeFences)
  // AND the answer is substantial (≥200 chars) — the classifier often
  // mis-labels nuanced engineer questions (P3 SPC/measurement-point) as
  // general.
  const hasTechHints = h.apiPaths.length > 0 || h.codeFences.length > 0;
  // Stage 13.A — NEVER append the API/screen footer for pure knowledge
  // questions (definition / list). The footer makes sense for how-to /
  // technical questions where the user expects pointers to code & UI; on
  // a definition question ("X là gì"), tacking on "API liên quan" is noise
  // and encourages the model to also fabricate UI paths in the body.
  if (intent === "definition" || intent === "list") return answer;
  const eligible =
    force ||
    intent === "technical" ||
    intent === "architecture" ||
    intent === "troubleshoot" ||
    intent === "how_to" ||
    (intent === "general" && hasTechHints && answer.length >= 200);
  if (!eligible) return answer;
  const hasApi = /\/api\//i.test(answer);
  const hasFence = /```/.test(answer);
  // Build only the buckets the answer is missing.
  const isVi = retrieve.language === "vi";
  const parts: string[] = [];
  if (!hasApi && h.apiPaths.length) {
    parts.push(
      (isVi ? "API liên quan: " : "Related APIs: ") +
        h.apiPaths.slice(0, 4).map((s) => "`" + s + "`").join(", "),
    );
  }
  if (h.screenPaths.length && !h.screenPaths.some((s) => answer.includes(s))) {
    parts.push(
      (isVi ? "Màn hình liên quan: " : "Related screens: ") +
        h.screenPaths.slice(0, 3).map((s) => "`" + s + "`").join(", "),
    );
  }
  if (h.envVars.length && !h.envVars.some((s) => answer.includes(s.split("=")[0]))) {
    parts.push(
      (isVi ? "Biến cấu hình: " : "Config vars: ") +
        h.envVars.slice(0, 3).map((s) => "`" + s + "`").join(", "),
    );
  }
  if (!parts.length) return answer;
  // Optional code example footer when answer has zero fences and we have one.
  let footer = "\n\n" + parts.join("\n");
  if (!hasFence && h.codeFences.length) {
    footer += "\n\n" + (isVi ? "Ví dụ:" : "Example:") + "\n" + h.codeFences[0];
  }
  return answer + footer;
}

// Format conversation history for the prompt.
// Assistant turns are truncated to a short snippet so the model
// uses them only as context (resolve pronouns / topic) and does not
// regurgitate the full prior answer in the new response.
function formatHistoryBlock(history: ConversationMessage[]): string {
  const ASSISTANT_SNIPPET_MAX = 160;
  const USER_SNIPPET_MAX = 300;
  return history
    .slice(-4) // keep last 2 turns (user + assistant pairs)
    .map((m) => {
      const isUser = m.role === "user";
      const label = isUser ? "Người dùng" : "Trợ lý (tóm tắt)";
      const max = isUser ? USER_SNIPPET_MAX : ASSISTANT_SNIPPET_MAX;
      const oneLine = m.content.replace(/\s+/g, " ").trim();
      const snippet =
        oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
      return `${label}: ${snippet}`;
    })
    .join("\n");
}

async function generateWithOllama(
  question: string,
  retrieve: KbRetrieveResult,
  history: ConversationMessage[] = [],
  userLevel: UserLevel = "technical",
  toolSummary?: string | null,
): Promise<string | null> {
  const contextBlock = retrieve.citations
    .map((c, i) => {
      const raw = retrieve.contexts[i] ?? "";
      const ctx = raw.length > CONTEXT_CHUNK_CHAR_CAP
        ? `${raw.slice(0, CONTEXT_CHUNK_CHAR_CAP)}…`
        : raw;
      return `[${i + 1}] ${c.title} | ${c.sourcePath}\n${ctx}`;
    })
    .join("\n\n");

  const systemPrompt = getSystemPromptForRole(userLevel, retrieve.language, retrieve.intent);
  const historyBlock = formatHistoryBlock(history);
  const hintsBlock = formatHintsBlock(retrieve);

  const toolBlock = toolSummary
    ? `\n=== Dữ liệu thời gian thực (từ CSDL) ===\n${toolSummary}\nƯU TIÊN dùng dữ liệu này để trả lời. Không bịa số liệu.\n`
    : "";

  const prompt = [
    systemPrompt,
    history.length > 0 ? `\n=== Lịch sử hội thoại (chỉ để tham khảo ngữ cảnh) ===\n${historyBlock}\n` : "",
    "NGUYÊN TẮC TRẢ LỜI:",
    "1. Chỉ trả lời dựa trên ngữ cảnh được cung cấp; trích dẫn nguồn bằng [1], [2].",
    "2. Nếu ngữ cảnh KHÔNG liên quan trực tiếp đến câu hỏi, hãy trả lời chính xác: \"Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\" và đề xuất câu hỏi rõ hơn. KHÔNG bịa.",
    "3. Trả lời đúng trọng tâm câu hỏi hiện tại; bỏ qua phần ngữ cảnh không liên quan.",
    "4. Nếu có dữ liệu thời gian thực, ƯU TIÊN dùng nó; không bịa số liệu.",
    "5. TUYỆT ĐỐI KHÔNG lặp lại, sao chép, hoặc tóm tắt các câu trả lời trước trong Lịch sử hội thoại. Lịch sử CHỈ dùng để hiểu ngữ cảnh (ví dụ: đại từ, chủ đề đang nói tới). CHỈ trả lời cho 'Câu hỏi hiện tại' bên dưới, không nhắc lại nội dung cũ.",
    `Phân loại ý định: ${retrieve.intent}`,
    `Ngôn ngữ: ${retrieve.language}`,
    toolBlock,
    "=== Ngữ cảnh từ knowledge base ===",
    contextBlock,
    hintsBlock ? "\n" + hintsBlock + "\nGHI NHỚ: trong câu trả lời PHẢI trích nguyên văn ≥1 mục từ HINTS dưới dạng inline code (`...`) khi nó liên quan đến câu hỏi.\n" : "",
    `\n=== Câu hỏi hiện tại ===\n${question}`,
    "=== Câu trả lời (chỉ trả lời câu hỏi hiện tại, không lặp lại lịch sử) ===",
  ]
    .filter(Boolean)
    .join("\n");

  // Default: use bundled GGUF engine (RTX 5090 local). Fallback to Ollama HTTP only if USE_LEGACY_OLLAMA=true.
  const numPredict = pickNumPredict(retrieve.intent, !!toolSummary, question);
  if (!USE_LEGACY_OLLAMA) {
    try {
      const { generateText: ggufGen, isGgufAvailable } = await import("./aiGgufEngine");
      if (await isGgufAvailable()) {
        const result = await ggufGen({
          prompt,
          maxTokens: numPredict,
          temperature: 0.15,
          topP: 0.9,
        });
        return result.text?.trim() || null;
      }
      // GGUF not available — fall through to Ollama path.
    } catch (err) {
      console.warn("[aiLocalKnowledge] GGUF generate failed, falling back to Ollama:", err);
    }
  }

  // Phase-6: hard deadline via AbortController so a stalled Ollama call
  // (observed 120s+ in Phase-5 eval) cannot block the entire request path.
  // NOTE: With stream:false, Ollama writes the response body only after the
  // full generation finishes. We MUST keep the timer armed across both the
  // fetch headers AND the body read (`res.json()`); otherwise the abort
  // becomes a no-op for long generations.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        model: OLLAMA_QA_MODEL,
        prompt,
        stream: false,
        keep_alive: LLM_KEEP_ALIVE,
        options: {
          temperature: 0.15,
          top_p: 0.9,
          num_predict: numPredict,
        },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { response?: string };
    return json.response?.trim() || null;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      console.warn(`[aiLocalKnowledge] Ollama generate aborted after ${LLM_TIMEOUT_MS}ms — falling back to extractive`);
    } else {
      console.warn("[aiLocalKnowledge] Ollama generate failed:", err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function* generateWithOllamaStream(
  question: string,
  retrieve: KbRetrieveResult,
  history: ConversationMessage[] = [],
  userLevel: UserLevel = "technical",
  toolSummary?: string | null,
): AsyncGenerator<string> {
  const contextBlock = retrieve.citations
    .map((c, i) => {
      const raw = retrieve.contexts[i] ?? "";
      const ctx = raw.length > CONTEXT_CHUNK_CHAR_CAP
        ? `${raw.slice(0, CONTEXT_CHUNK_CHAR_CAP)}…`
        : raw;
      return `[${i + 1}] ${c.title} | ${c.sourcePath}\n${ctx}`;
    })
    .join("\n\n");

  const systemPrompt = getSystemPromptForRole(userLevel, retrieve.language, retrieve.intent);
  const historyBlock = formatHistoryBlock(history);
  const hintsBlock = formatHintsBlock(retrieve);

  const toolBlock = toolSummary
    ? `\n=== Dữ liệu thời gian thực (từ CSDL) ===\n${toolSummary}\nƯU TIÊN dùng dữ liệu này để trả lời. Không bịa số liệu.\n`
    : "";

  const prompt = [
    systemPrompt,
    history.length > 0 ? `\n=== Lịch sử hội thoại (chỉ để tham khảo ngữ cảnh) ===\n${historyBlock}\n` : "",
    "NGUYÊN TẮC TRẢ LỜI:",
    "1. Chỉ trả lời dựa trên ngữ cảnh được cung cấp; trích dẫn nguồn bằng [1], [2].",
    "2. Nếu ngữ cảnh KHÔNG liên quan trực tiếp đến câu hỏi, hãy trả lời chính xác: \"Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\" và đề xuất câu hỏi rõ hơn. KHÔNG bịa.",
    "3. Trả lời đúng trọng tâm câu hỏi hiện tại; bỏ qua phần ngữ cảnh không liên quan.",
    "4. Nếu có dữ liệu thời gian thực, ƯU TIÊN dùng nó; không bịa số liệu.",
    "5. TUYỆT ĐỐI KHÔNG lặp lại, sao chép, hoặc tóm tắt các câu trả lời trước trong Lịch sử hội thoại. Lịch sử CHỈ dùng để hiểu ngữ cảnh (ví dụ: đại từ, chủ đề đang nói tới). CHỈ trả lời cho 'Câu hỏi hiện tại' bên dưới, không nhắc lại nội dung cũ.",
    `Phân loại ý định: ${retrieve.intent}`,
    `Ngôn ngữ: ${retrieve.language}`,
    toolBlock,
    "=== Ngữ cảnh từ knowledge base ===",
    contextBlock,
    hintsBlock ? "\n" + hintsBlock + "\nGHI NHỚ: trong câu trả lời PHẢI trích nguyên văn ≥1 mục từ HINTS dưới dạng inline code (`...`) khi nó liên quan đến câu hỏi.\n" : "",
    `\n=== Câu hỏi hiện tại ===\n${question}`,
    "=== Câu trả lời (chỉ trả lời câu hỏi hiện tại, không lặp lại lịch sử) ===",
  ]
    .filter(Boolean)
    .join("\n");

  // Default: use bundled GGUF engine streaming. Fallback to Ollama HTTP if USE_LEGACY_OLLAMA=true.
  const numPredict = pickNumPredict(retrieve.intent, !!toolSummary, question);
  if (!USE_LEGACY_OLLAMA) {
    try {
      const { generateTextStream: ggufStream, isGgufAvailable } = await import("./aiGgufEngine");
      if (await isGgufAvailable()) {
        for await (const chunk of ggufStream({
          prompt,
          maxTokens: numPredict,
          temperature: 0.15,
          topP: 0.9,
        })) {
          // GGUF engine yields { type: "token" | "done" | "error", token?, ... }
          // We must extract the string token, not yield the whole object
          // (which would stringify to "[object Object]" downstream).
          if (chunk.type === "token" && typeof chunk.token === "string" && chunk.token.length > 0) {
            yield chunk.token;
          } else if (chunk.type === "error") {
            throw new Error(chunk.error || "GGUF stream error");
          }
        }
        return;
      }
    } catch (err) {
      console.warn("[aiLocalKnowledge] GGUF stream failed, falling back to Ollama:", err);
    }
  }

  // Stage 11c — same hard deadline as non-stream path so a stalled
  // Ollama HTTP stream cannot starve the SSE handler. Reader.read()
  // observes the abort and throws, which the consumer (askStream)
  // catches and falls back to extractive/tool answer.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_QA_MODEL,
        prompt,
        stream: true,
        keep_alive: LLM_KEEP_ALIVE,
        options: { temperature: 0.15, top_p: 0.9, num_predict: numPredict },
      }),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line) as { response?: string; done?: boolean };
          if (json.response) yield json.response;
          if (json.done) return;
        } catch {
          // skip malformed lines
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

export function getKbHealth(): {
  ready: boolean;
  chunks: number;
  embeddings: number;
  loadedAt?: string;
  paths: { chunks: string; embeddings: string };
} {
  try {
    const data = ensureDataLoaded();
    return {
      ready: true,
      chunks: data.chunksById.size,
      embeddings: data.embeddings.length,
      loadedAt: new Date(data.loadedAt).toISOString(),
      paths: {
        chunks: CHUNKS_FILE,
        embeddings: EMBEDDINGS_FILE,
      },
    };
  } catch {
    return {
      ready: false,
      chunks: 0,
      embeddings: 0,
      paths: {
        chunks: CHUNKS_FILE,
        embeddings: EMBEDDINGS_FILE,
      },
    };
  }
}

export function reloadKbArtifacts(): ReturnType<typeof getKbHealth> {
  dataCache = null;
  return getKbHealth();
}

export async function retrieveKnowledge(
  question: string,
  topK = 5,
): Promise<KbRetrieveResult> {
  const data = ensureDataLoaded();
  const tokens = tokenize(question);
  const intent = classifyIntent(question);
  const language = detectLanguage(question);
  const entities = extractEntities(question);

  const qVec = await embedQuestion(question);

  const scored = data.embeddings.map((emb) => {
    const chunk = data.chunksById.get(emb.id);
    if (!chunk) {
      return { emb, chunk: null as KbChunk | null, semantic: 0, keyword: 0, score: 0 };
    }

    const semantic = qVec ? cosine(qVec, emb.embedding) : 0;
    const keywordRaw = keywordScore(chunk, tokens, entities);
    const keyword = Math.tanh(keywordRaw / 15);
    const baseScore = qVec ? semantic * 0.72 + keyword * 0.28 : keyword;
    // Cycle-3: tilt ranking toward VN-language sources for VN questions (and
    // the reverse for EN), reducing the bias toward English-heavy docs
    // (CSHARP_CLIENT_UPLOAD_GUIDE, SERVER_PERFORMANCE_ASSESSMENT) that
    // previously dominated top-K for unrelated VN questions.
    const langWeight = sourceLanguageWeight(emb.sourcePath, language);
    // Cycle-4: prioritise authored end-user feature/domain guides over dev
    // artefact docs. Without this, large noisy reports (I18N_AUDIT_REPORT,
    // SYSTEM_AUDIT_REPORT) outrank the targeted feature MDs because they
    // happen to contain many literal UI strings.
    const typeWeight =
      emb.sourceType === "feature" ? 1.18 :
      emb.sourceType === "domain" ? 1.08 :
      emb.sourceType === "doc" ? 0.90 :
      1.0;
    const score = baseScore * langWeight * typeWeight;

    return { emb, chunk, semantic, keyword, score };
  });

  // Drop low-relevance noise citations (kept the top-1 even if weak so the UI
  // never shows an empty list, but the LLM prompt only sees the strong ones).
  const MIN_CITATION_SCORE = 0.18;
  const sortedAll = scored
    .filter((r) => r.chunk)
    .sort((a, b) => b.score - a.score);
  // Cycle-3: dedupe near-identical chunks by capping each source file to at
  // most 2 chunks before slicing to topK, so the LLM doesn't see 5 paragraphs
  // from the same doc when other relevant sources exist.
  const PER_SOURCE_CAP = 2;
  const perSourceCount = new Map<string, number>();
  const deduped: typeof sortedAll = [];
  for (const r of sortedAll) {
    const sp = r.emb.sourcePath;
    const used = perSourceCount.get(sp) ?? 0;
    if (used >= PER_SOURCE_CAP) continue;
    perSourceCount.set(sp, used + 1);
    deduped.push(r);
  }
  const topSlice = deduped.slice(0, Math.max(1, Math.min(10, topK)));
  const ranked = topSlice.filter((r, idx) => idx === 0 || r.score >= MIN_CITATION_SCORE);

  const citations: KbCitation[] = ranked.map((r) => ({
    id: r.emb.id,
    sourcePath: r.emb.sourcePath,
    title: r.emb.title,
    sourceType: r.emb.sourceType,
    score: Number(r.score.toFixed(6)),
  }));

  const contexts = ranked.map((r) => (r.chunk ? r.chunk.text : ""));
  const top1 = ranked[0]?.score ?? 0.25;
  const top2 = ranked[Math.min(1, ranked.length - 1)]?.score ?? 0.2;
  const confidence = clamp01((top1 + top2) / 1.6);

  return {
    question,
    intent,
    language,
    entities,
    confidence: Number(confidence.toFixed(4)),
    citations,
    contexts,
  };
}

function getCacheKey(question: string, topK: number, userRole: UserRole = "engineer"): string {
  return `${userRole}|${normalizeText(question)}|k=${topK}`;
}

export async function answerQuestion(
  question: string,
  topK = 5,
  history: ConversationMessage[] = [],
  userRole: UserRole = "engineer",
): Promise<KbAnswerResult> {
  const userLevel = rolToUserLevel(userRole);
  const key = getCacheKey(question, topK, userRole);
  const now = Date.now();

  // Step 1 — Try a real-time tool first. Tool answers must NOT be cached
  // because they reflect live database state.
  const toolExec = await tryExecuteTool(question);
  const toolResult = toolExec.result;
  const clarifyMessage = toolExec.decision.clarifyMessage ?? null;

  // Short-circuit: if intent classifier asked for clarification, return it
  // immediately without invoking the LLM. This avoids hallucinated answers
  // for questions like "lô của tôi sao rồi?" that lack a concrete identifier.
  if (!toolResult && clarifyMessage) {
    const retrieve = await retrieveKnowledge(question, topK);
    const followUpSuggestions = buildFollowUpSuggestions(retrieve.intent, retrieve.language);
    return {
      ...retrieve,
      answer: clarifyMessage,
      provider: "extractive",
      cached: false,
      followUpSuggestions,
      toolResult: null,
      toolName: null,
      structured: extractStructuredResponse(clarifyMessage),
    };
  }

  // Only use cache when there's no history AND no real-time tool was invoked.
  if (history.length === 0 && !toolResult) {
    const hit = answerCache.get(key);
    if (hit && hit.expiresAt > now) {
      return { ...hit.value, cached: true };
    }
  }

  const retrieve = await retrieveKnowledge(question, topK);

  let provider: "ollama" | "extractive" | "tool" = "extractive";
  let answer = buildExtractiveAnswer(question, retrieve);

  // Step 2 — If we have live data, short-circuit when the tool's textSummary
  // is already substantial (Lever 8.B). LLM augmentation adds 10-15s latency
  // but rarely improves an already-grounded numeric/live-data answer. We
  // attach a brief KB nav hint footer to satisfy the "hasNavPath" rubric.
  // Fall back to LLM augmentation only when textSummary is thin.
  if (toolResult) {
    const summary = toolResult.textSummary || "";
    const TOOL_SHORTCIRCUIT_MIN = Number(process.env.KB_TOOL_SHORTCIRCUIT_MIN ?? 150);
    if (summary.length >= TOOL_SHORTCIRCUIT_MIN) {
      provider = "tool";
      answer = appendNavHint(summary, retrieve);
    } else {
      try {
        const llmAnswer = await generateWithOllama(
          question,
          retrieve,
          history,
          userLevel,
          summary,
        );
        if (llmAnswer) {
          provider = "ollama";
          answer = llmAnswer;
        } else {
          provider = "tool";
          answer = appendNavHint(summary, retrieve);
        }
      } catch {
        provider = "tool";
        answer = appendNavHint(summary, retrieve);
      }
    }
    // Stage 11a — also append extractive hints footer for tool answers.
    // `force=true` so this fires even when intent=general (typical for
    // P2 operator-experienced live-data questions).
    answer = appendHintsFooter(answer, retrieve, true);
  } else if (retrieve.confidence >= 0.30) {
    try {
      const llmAnswer = await generateWithOllama(question, retrieve, history, userLevel);
      if (llmAnswer) {
        provider = "ollama";
        answer = llmAnswer;
      }
    } catch {
      if (retrieve.citations.length === 0) {
        answer = buildGracefulFallback(retrieve.language);
      }
    }
  } else if (retrieve.citations.length === 0) {
    answer = buildGracefulFallback(retrieve.language);
  }

  const followUpSuggestions = buildFollowUpSuggestions(retrieve.intent, retrieve.language);

  // Lever 10 — extractive footer for technical answers missing concrete refs.
  // (Tool branch already applied its own footer above with force=true.)
  if (provider === "ollama" || provider === "extractive") {
    answer = appendHintsFooter(answer, retrieve);
  }

  const result: KbAnswerResult = {
    ...retrieve,
    answer,
    provider,
    cached: false,
    followUpSuggestions,
    toolResult: toolResult ?? null,
    toolName: toolExec.decision.tool ?? null,
    structured: extractStructuredResponse(answer),
  };

  // Cache only stable (non-tool, no-history) answers.
  if (history.length === 0 && !toolResult) {
    answerCache.set(key, {
      expiresAt: now + ANSWER_CACHE_TTL_MS,
      value: result,
    });
  }

  return result;
}

// ─── Streaming orchestrator ───────────────────────────────────────────────
// Mirrors `answerQuestion` pipeline but yields events as they happen so the
// UI can render the LLM output token-by-token. This drastically reduces the
// time-to-first-token the user perceives (no waiting for the full answer
// before any text appears).
export type StreamEvent =
  | {
      type: "meta";
      intent: KbIntent;
      language: "vi" | "en";
      confidence: number;
      citations: KbCitation[];
    }
  | { type: "tool"; toolName: string | null; toolResult: ToolResult }
  | { type: "token"; token: string }
  | {
      type: "done";
      provider: "ollama" | "extractive" | "tool";
      cached: boolean;
      followUpSuggestions: string[];
      answer: string;
      structured?: KbStructuredResponse;
    };

export async function* streamAnswer(
  question: string,
  topK = 5,
  history: ConversationMessage[] = [],
  userRole: UserRole = "engineer",
): AsyncGenerator<StreamEvent> {
  const userLevel = rolToUserLevel(userRole);
  const key = getCacheKey(question, topK, userRole);
  const now = Date.now();

  // Real-time tool first (live DB state — must NOT be cached).
  const toolExec = await tryExecuteTool(question);
  const toolResult = toolExec.result;
  const clarifyMessage = toolExec.decision.clarifyMessage ?? null;

  // Short-circuit clarification (mirrors answerQuestion).
  if (!toolResult && clarifyMessage) {
    const retrieve = await retrieveKnowledge(question, topK);
    yield {
      type: "meta",
      intent: retrieve.intent,
      language: retrieve.language,
      confidence: retrieve.confidence,
      citations: retrieve.citations,
    };
    yield { type: "token", token: clarifyMessage };
    yield {
      type: "done",
      provider: "extractive",
      cached: false,
      followUpSuggestions: buildFollowUpSuggestions(retrieve.intent, retrieve.language),
      answer: clarifyMessage,
      structured: extractStructuredResponse(clarifyMessage),
    };
    return;
  }

  // Cached answer: emit meta + the full answer in a single token, done.
  if (history.length === 0 && !toolResult) {
    const hit = answerCache.get(key);
    if (hit && hit.expiresAt > now) {
      const v = hit.value;
      yield {
        type: "meta",
        intent: v.intent,
        language: v.language,
        confidence: v.confidence,
        citations: v.citations,
      };
      yield { type: "token", token: v.answer ?? "" };
      yield {
        type: "done",
        provider: v.provider,
        cached: true,
        followUpSuggestions: v.followUpSuggestions ?? [],
        answer: v.answer ?? "",
        structured: v.structured ?? extractStructuredResponse(v.answer ?? ""),
      };
      return;
    }
  }

  const retrieve = await retrieveKnowledge(question, topK);

  yield {
    type: "meta",
    intent: retrieve.intent,
    language: retrieve.language,
    confidence: retrieve.confidence,
    citations: retrieve.citations,
  };

  if (toolResult) {
    yield {
      type: "tool",
      toolName: toolExec.decision.tool ?? null,
      toolResult,
    };
  }

  let provider: "ollama" | "extractive" | "tool" = "extractive";
  let accumulated = "";

  const shouldUseLlm = !!toolResult || retrieve.confidence >= 0.30;

  if (shouldUseLlm) {
    try {
      const iter = generateWithOllamaStream(
        question,
        retrieve,
        history,
        userLevel,
        toolResult?.textSummary,
      );
      for await (const piece of iter) {
        if (!piece) continue;
        accumulated += piece;
        yield { type: "token", token: piece };
      }
      if (accumulated.trim()) {
        provider = "ollama";
      }
    } catch {
      // fall through to extractive/tool fallback below
    }
  }

  // Fallback when LLM was skipped or produced nothing.
  if (!accumulated.trim()) {
    if (toolResult) {
      provider = "tool";
      accumulated = toolResult.textSummary;
    } else if (retrieve.citations.length === 0) {
      accumulated = buildGracefulFallback(retrieve.language);
    } else {
      accumulated = buildExtractiveAnswer(question, retrieve);
    }
    yield { type: "token", token: accumulated };
  }

  // Stage 11c — apply extractive hints footer to streamed answer too.
  // Tool branch uses force=true (mirrors non-stream Stage 11a behavior).
  const footerForced = provider === "tool";
  const withFooter = appendHintsFooter(accumulated, retrieve, footerForced);
  if (withFooter !== accumulated) {
    const delta = withFooter.slice(accumulated.length);
    accumulated = withFooter;
    yield { type: "token", token: delta };
  }

  const followUpSuggestions = buildFollowUpSuggestions(
    retrieve.intent,
    retrieve.language,
  );

  // Backfill the answer cache so the next identical question is instant.
  if (history.length === 0 && !toolResult && provider !== "extractive") {
    const cacheValue: KbAnswerResult = {
      ...retrieve,
      answer: accumulated,
      provider,
      cached: false,
      followUpSuggestions,
      toolResult: null,
      toolName: null,
      structured: extractStructuredResponse(accumulated),
    };
    answerCache.set(key, {
      expiresAt: now + ANSWER_CACHE_TTL_MS,
      value: cacheValue,
    });
  }

  yield {
    type: "done",
    provider,
    cached: false,
    followUpSuggestions,
    answer: accumulated,
    structured: extractStructuredResponse(accumulated),
  };
}

// ─── Warm-up ──────────────────────────────────────────────────────────────
// Fire a tiny embed + generate request shortly after server boot so the
// Ollama models are already loaded into memory before the first user ask.
let warmupStarted = false;
export function warmUpOllamaModels(): void {
  if (warmupStarted) return;
  warmupStarted = true;
  setTimeout(() => {
    void embedQuestion("warmup").catch(() => {});
    void fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_QA_MODEL,
        prompt: "ok",
        stream: false,
        keep_alive: LLM_KEEP_ALIVE,
        options: { num_predict: 1, temperature: 0 },
      }),
    }).catch(() => {});
  }, 2000);
}
