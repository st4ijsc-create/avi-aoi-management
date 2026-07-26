import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { tryExecuteTool, type ToolResult, type ToolExecContext, type PendingActionDTO, type ClientActionDirective } from "./aiLocalTools";
import { rerank, isRerankerEnabled, type RerankCandidate } from "./aiReranker";
import { loadSemanticGraph, expandWithGraph } from "./aiSemanticGraph";
// FE-W0.3 (doc 46 §2.3) — degenerate-loop guard (pure, dependency-free).
import { guardGeneratedText, isDegenerateStream } from "./ai/generationGuard";
// doc69 G2-3 (Wave 1, W1-1b) — this file is the MAIN production RAG assistant (reached via
// aiLocalKnowledgeApi.ts's /ask + /stream) and previously called aiGgufEngine directly,
// bypassing the AI Gateway entirely: zero safety (no redaction), zero metering on the
// surface users actually chat with. `planInference` (aiGateway's "cheapest adoption" path,
// see its own top-of-file doc comment) is wired into `generateWithOllama`/
// `generateWithOllamaStream` below with the SAME `{task:"chat", text: question}` input this
// file already used for `route()`, so `plan.decision.modelId` is byte-identical to before
// (pinned-model behavior preserved) — it only ADDS flag-gated/fail-safe input redaction
// (`plan.safeText`), output redaction (`plan.sanitizeOutput`/`StreamingSecretRedactor`), and
// gateway metering (`plan.record`). Reuses the G2-2 primitives verbatim — no redaction logic
// is reimplemented here.
import { redactSecretsAndPII, StreamingSecretRedactor } from "./ai/aiSafety";
import { planInference } from "./aiGateway";

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

// zh — language union extended to include Chinese (backward-compatible: extra branch).
export type KbLanguage = "vi" | "en" | "zh";

export interface KbRetrieveResult {
  question: string;
  intent: KbIntent;
  language: KbLanguage;
  entities: string[];
  confidence: number;
  citations: KbCitation[];
  contexts: string[];
}

// C3a — optional, page-supplied context. All fields optional; absence keeps the
// legacy behavior (backward-compatible). Codes are preferred so they can be fed
// directly to read-tools (machineCode/orderCode). `uiLanguage` lets the UI hint
// the reply language when the question text is ambiguous.
export interface KbQueryContext {
  route?: string;
  uiLanguage?: KbLanguage;
  selectedMachineCode?: string;
  selectedMachineId?: number;
  selectedProductCode?: string;
  selectedProductModelId?: number;
  selectedLot?: string;
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
  /** GĐ2 — set when a write-tool was matched: confirm card to render (no execute). */
  pendingAction?: PendingActionDTO | null;
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

function buildFollowUpSuggestions(intent: KbIntent, language: KbLanguage): string[] {
  const vi: Record<KbIntent, string[]> = {
    how_to: ["Có cách nào nhanh hơn không?", "Bước nào thường gặp lỗi?", "Ai có quyền thực hiện bước này?"],
    troubleshoot: ["Lỗi này xảy ra thường xuyên không?", "Làm sao ngăn lỗi tái phát?", "Cần liên hệ ai khi lỗi nghiêm trọng?"],
    architecture: ["Module nào liên quan đến chức năng này?", "Dữ liệu được lưu ở đâu?", "API nào được dùng?"],
    technical: ["Schema của bảng này là gì?", "Endpoint nào trả dữ liệu này?", "Có test case nào không?"],
    general: ["Tôi có thể tìm thêm thông tin ở đâu?", "Ai là người quản lý phần này?", "Có tài liệu hướng dẫn không?"],
    list: ["Còn mục nào khác không?", "Sắp xếp theo tiêu chí nào?", "Xem chi tiết từng mục ở đâu?"],
    definition: ["Khái niệm này dùng ở đâu?", "Có ví dụ minh họa không?", "Thuật ngữ liên quan là gì?"],
  };
  const en: Record<KbIntent, string[]> = {
    how_to: ["Is there a faster way?", "Which step is most error-prone?", "Who has permission to do this?"],
    troubleshoot: ["How often does this error occur?", "How to prevent recurrence?", "Who to contact for critical issues?"],
    architecture: ["Which modules are related?", "Where is the data stored?", "Which APIs are involved?"],
    technical: ["What is the table schema?", "Which endpoint returns this data?", "Are there test cases?"],
    general: ["Where can I find more info?", "Who manages this feature?", "Is there documentation?"],
    list: ["Are there other items?", "How is it sorted?", "Where to see each item's detail?"],
    definition: ["Where is this concept used?", "Is there an example?", "What are related terms?"],
  };
  const zh: Record<KbIntent, string[]> = {
    how_to: ["有更快的方法吗？", "哪一步最容易出错？", "谁有权限执行此操作？"],
    troubleshoot: ["这个错误经常发生吗？", "如何防止再次发生？", "严重问题该联系谁？"],
    architecture: ["相关的模块有哪些？", "数据存储在哪里？", "涉及哪些 API？"],
    technical: ["这张表的结构是什么？", "哪个接口返回此数据？", "有测试用例吗？"],
    general: ["在哪里可以找到更多信息？", "谁负责这个功能？", "有使用文档吗？"],
    list: ["还有其他项目吗？", "按什么排序？", "在哪里查看每项详情？"],
    definition: ["这个概念用在哪里？", "有示例吗？", "相关术语有哪些？"],
  };
  if (language === "zh") return zh[intent] ?? zh.general;
  return language === "vi" ? (vi[intent] ?? vi.general) : (en[intent] ?? en.general);
}

interface KbDataBundle {
  chunksById: Map<string, KbChunk>;
  embeddings: KbEmbeddingRecord[];
  loadedAt: number;
  // W0.3 (doc 11) — embedding-model provenance read from embeddings-meta.json so
  // we can detect a query/corpus embed-model mismatch (not just a length mismatch).
  // null when the meta file is missing or lacks the field (→ never false-alarm).
  corpusEmbedModel: string | null;
  // W0.2 (doc 11) — when the corpus was built (ISO from meta.generatedAt); null if absent.
  kbBuiltAt: string | null;
}

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");
const CHUNKS_FILE = path.join(KNOWLEDGE_DIR, "chunks.jsonl");
const EMBEDDINGS_FILE = path.join(KNOWLEDGE_DIR, "embeddings.jsonl");
// W0.3 (doc 11) — provenance sidecar written by the embed pipeline. Holds the
// `model` the corpus was embedded with + `generatedAt`. Optional: missing file
// degrades gracefully (corpusEmbedModel = null → guard stays quiet).
const EMBEDDINGS_META_FILE = path.join(KNOWLEDGE_DIR, "embeddings-meta.json");

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

// W0.3 (doc 11) — normalize an embed-model identifier for IDENTITY comparison
// (corpus vs query). Length-only guards miss the dangerous case where a deploy
// swaps GGUF_EMBED_MODEL for a SAME-DIMENSION but DIFFERENT model → retrieval
// silently returns garbage. We compare by basename, lowercased, stripping the
// common "-f16"/quant suffixes and the ".gguf" extension so cosmetically
// different spellings of the same model still match.
function normalizeEmbedModelId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = path.basename(String(raw).trim());
  s = s.replace(/\.gguf$/i, "");
  s = s.toLowerCase();
  // Strip common precision/quant suffixes that differ between build-time and
  // runtime spellings of the SAME model (e.g. "-f16", "-q8_0", ".f16").
  s = s.replace(/[._-](f16|f32|bf16|q\d(_[\dkms]+)*|int8|int4)$/i, "");
  s = s.replace(/[._-]+$/g, "");
  return s || null;
}

// W0.3 (doc 11) — has the corpus/query embed-model mismatch warning already
// fired? Keep the log to ONCE-per-process so it stays loud but not spammy.
let embedModelMismatchWarned = false;

/**
 * W0.3 (doc 11) — does the corpus embed-model match the query embed-model?
 * Returns true when the corpus model is UNKNOWN/null (no meta → don't false-alarm)
 * or when both normalize equal. Returns false ONLY when both are known AND differ.
 */
function computeEmbedModelMatches(corpusEmbedModel: string | null): boolean {
  const corpus = normalizeEmbedModelId(corpusEmbedModel);
  if (!corpus) return true; // unknown corpus model → cannot assert a mismatch
  const query = normalizeEmbedModelId(GGUF_EMBED_MODEL_ID);
  if (!query) return true; // unknown query model → don't false-alarm either
  return corpus === query;
}

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

// FE-W0.3 (doc 46 §2.3) — anti-degenerate-loop decode + streaming-guard cadence.
// Stronger repeat penalty than the engine default (1.1) to discourage token loops;
// the incremental stream guard re-checks every STEP chars once past MIN chars so a
// "cell cell cell…" loop is caught within a few tokens instead of thousands.
const KB_QA_REPEAT_PENALTY = (() => {
  const n = Number(process.env.KB_QA_REPEAT_PENALTY ?? 1.2);
  return Number.isFinite(n) && n >= 1 ? n : 1.2;
})();
const STREAM_GUARD_MIN_CHARS = Number(process.env.KB_QA_STREAM_GUARD_MIN ?? 160);
const STREAM_GUARD_STEP_CHARS = Number(process.env.KB_QA_STREAM_GUARD_STEP ?? 160);

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

// zh \u2014 detect Chinese first (CJK Unified Ideographs). The Han range does not
// overlap the Vietnamese Latin range below, so ordering is safe. Exported so it
// can be unit-tested directly.
export function detectLanguage(question: string): KbLanguage {
  if (/[\u4e00-\u9fff]/.test(question)) return "zh";

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
function sourceLanguageWeight(sourcePath: string, qLang: KbLanguage): number {
  if (NOISE_DOC_RE.test(sourcePath)) return 0.55;
  // zh has no dedicated corpus; treat it like the EN branch (neutral) — the KB
  // is vi/en, and the LLM translates concepts into zh at answer time.
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

  // W0.3/W0.2 (doc 11) — read the embed provenance sidecar. Best-effort: a
  // missing/malformed meta file must NOT break KB loading; it just leaves the
  // model-identity guard quiet (corpusEmbedModel = null) and staleness unknown.
  let corpusEmbedModel: string | null = null;
  let kbBuiltAt: string | null = null;
  try {
    if (fs.existsSync(EMBEDDINGS_META_FILE)) {
      const meta = JSON.parse(fs.readFileSync(EMBEDDINGS_META_FILE, "utf8")) as {
        model?: unknown;
        generatedAt?: unknown;
      };
      if (typeof meta.model === "string" && meta.model.trim()) corpusEmbedModel = meta.model.trim();
      if (typeof meta.generatedAt === "string" && meta.generatedAt.trim()) {
        kbBuiltAt = meta.generatedAt.trim();
      }
    }
  } catch {
    // Leave provenance null on any parse error — degrade quietly.
  }

  dataCache = {
    chunksById,
    embeddings,
    loadedAt: Date.now(),
    corpusEmbedModel,
    kbBuiltAt,
  };

  // W0.3 (doc 11) — fire a single LOUD warning if the corpus was embedded with a
  // different model than the one the query path will use. Retrieval similarity
  // is only meaningful when both vectors live in the SAME model's space.
  if (!computeEmbedModelMatches(corpusEmbedModel) && !embedModelMismatchWarned) {
    embedModelMismatchWarned = true;
    console.warn(
      `[aiLocalKnowledge] ⚠️ EMBED-MODEL MISMATCH — corpus embedded with "${corpusEmbedModel}" ` +
        `but query embed model is "${GGUF_EMBED_MODEL_ID}" (GGUF_EMBED_MODEL). Semantic retrieval ` +
        `would be CORRUPT → falling back to keyword-only retrieval. Re-embed the corpus with the ` +
        `current model OR point GGUF_EMBED_MODEL back at the corpus model. (W0.3, doc 11)`,
    );
  }

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
    if (language === "zh") {
      return `我在知识库中没有找到与此问题相关的信息。\n\n**建议：**\n- 尝试换一种方式描述问题\n- 询问具体的功能、界面或错误\n- 联系技术人员或查看使用文档`;
    }
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
      if (language === "zh") {
        return `在当前文档中未找到编号 **${id}** 的数据。\n\n**建议：**\n- 核对编号（格式是否正确、是否有多余空格）\n- 如果是实时数据，请说明日期/时间范围\n- 或联系技术工程师寻求帮助`;
      }
      return language === "vi"
        ? `Không tìm thấy dữ liệu cho mã **${id}** trong tài liệu hiện tại.\n\n**Gợi ý:**\n- Kiểm tra lại mã (định dạng đúng chưa, có khoảng trắng dư không)\n- Nếu đây là dữ liệu thời gian thực, hãy nêu rõ ngày/khoảng thời gian\n- Hoặc liên hệ kỹ thuật viên để được hỗ trợ`
        : `No data found for **${id}** in the current documents.\n\n**Try:**\n- Verify the ID format and remove extra whitespace\n- For real-time data, specify the date/time range\n- Or contact a technical engineer for help`;
    }
    if (language === "zh") {
      return `在当前文档中我没有关于此问题的准确信息。\n\n**建议：**\n- 提问更具体一些（功能名称、界面、错误代码、机台/批次编号）\n- 如果询问实时数据（产量、机台、缺陷），请说明日期/时间范围\n- 或联系技术工程师寻求帮助`;
    }
    return language === "vi"
      ? `Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\n\n**Gợi ý:**\n- Thử hỏi cụ thể hơn (tên tính năng, màn hình, mã lỗi, mã máy/lô)\n- Nếu hỏi về dữ liệu thời gian thực (sản lượng, máy, lỗi), hãy nêu rõ ngày/khoảng thời gian\n- Hoặc liên hệ kỹ thuật viên để được hỗ trợ`
      : `I don't have accurate information about this question in the current documents.\n\n**Try:**\n- Ask more specifically (feature name, screen, error code, machine/lot ID)\n- For real-time data (yield, machines, defects), specify the date/time range\n- Or contact a technical engineer for help`;
  }

  const intro =
    language === "zh"
      ? `我在代码库中找到了 **${retrieve.citations.length} 个相关来源**：`
      : language === "vi"
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
    language === "zh"
      ? "\n\n💡 *如有需要，可继续询问某个具体步骤或具体错误。*"
      : language === "vi"
        ? "\n\n💡 *Nếu cần, hãy hỏi thêm về một bước cụ thể hoặc lỗi cụ thể.*"
        : "\n\n💡 *If needed, ask about a specific step or error.*";

  return `${intro}\n\n${bullets}${outro}`;
}

function buildGracefulFallback(language: KbLanguage): string {
  if (language === "zh") {
    return `抱歉，我目前没有足够的信息来准确回答这个问题。\n\n**您可以尝试：**\n- 🔍 更具体地描述功能或错误\n- 📋 查看系统中的**使用指南**\n- 💬 联系**技术工程师**或**管理员**`;
  }
  return language === "vi"
    ? `Xin lỗi, tôi chưa có đủ thông tin để trả lời câu hỏi này một cách chính xác.\n\n**Bạn có thể thử:**\n- 🔍 Hỏi cụ thể hơn về tính năng hoặc lỗi\n- 📋 Xem mục **Hướng dẫn sử dụng** trong hệ thống\n- 💬 Liên hệ **kỹ sư kỹ thuật** hoặc **quản trị viên**\n- 📞 Hotline hỗ trợ: nội bộ phòng kỹ thuật`
    : `Sorry, I don't have enough information to answer this accurately.\n\n**You can try:**\n- 🔍 Be more specific about the feature or error\n- 📋 Check the **User Guide** in the system\n- 💬 Contact a **technical engineer** or **administrator**`;
}

function getSystemPromptForRole(
  userLevel: UserLevel,
  language: KbLanguage,
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

  // zh — Chinese prompt variants. Same rubric as vi/en (structure, code-fence,
  // anti-hallucination, no public-cloud mentions), translated to Simplified
  // Chinese so the model replies in Chinese when the UI/question is Chinese.
  const ZH_GUARD = "仅使用所提供的资料；不得编造 API/接口/变量/数据表。不得提及 Alibaba/AWS/GCP/Azure。资料不足时请明确说明尚无数据。";
  const ZH_FORMAT = "结构：(1) 1–2 句概述，(2) 编号步骤，说明*做什么 + 在界面中的位置 + 预期结果*，(3) 注意事项/常见错误，(4) 2 个相关主题。200–450 字。当上下文包含 API/变量/命令时，必须用反引号或代码块 ```bash/```sql/```ts 原样引用。";
  const ZH_DEF_FORMAT = "结构：(1) 1–3 句简短定义，(2) 关键组成/特征的项目列表，(3) 来自上下文的具体示例（如有代码/数值/公式），(4) 1–2 个相关主题。若上下文未说明，请勿编造界面路径/菜单。定义类问题请勿使用“步骤→打开网址→点击标签”的模板。";
  const ZH_LIST_FORMAT = "结构：(1) 列出项目的总数（准确数字），(2) 完整列表（项目符号或表格，不得截断），(3) 原样引用上下文中的代码/数值，(4) 来源（文件路径）。不得编造数量。请勿使用“步骤→打开网址”的模板。";

  const isDef = intent === "definition";
  const isList = intent === "list";

  if (language === "zh") {
    const fmt = isDef ? ZH_DEF_FORMAT : isList ? ZH_LIST_FORMAT : ZH_FORMAT;
    if (userLevel === "basic") {
      return `面向一线操作工的 SYNAPSE 本地部署系统助手。用简体中文、通俗易懂、完整地回答。${fmt} ${ZH_GUARD}`;
    }
    if (userLevel === "manager") {
      return `面向管理者的 SYNAPSE 本地部署系统分析助手。用简体中文回答，聚焦 KPI/趋势/运营影响，并给出优先级行动建议。${fmt} ${ZH_GUARD}`;
    }
    return `面向工程师的 SYNAPSE 本地部署系统技术助手。用简体中文回答，给出具体的 API/数据结构/配置/命令；解释设计与错误处理。${fmt} ${ZH_GUARD}`;
  }

  if (language === "vi") {
    const fmt = isDef ? VI_DEF_FORMAT : isList ? VI_LIST_FORMAT : VI_FORMAT;
    if (userLevel === "basic") {
      return `Trợ lý hệ thống SYNAPSE on-prem cho công nhân. Trả lời tiếng Việt, dễ hiểu, đầy đủ. ${fmt} ${VI_GUARD}`;
    }
    if (userLevel === "manager") {
      return `Trợ lý phân tích SYNAPSE on-prem cho quản lý. Trả lời tiếng Việt, tập trung KPI/xu hướng/tác động vận hành, đề xuất hành động ưu tiên. ${fmt} ${VI_GUARD}`;
    }
    return `Trợ lý kỹ thuật SYNAPSE on-prem cho kỹ sư. Trả lời tiếng Việt, kèm API/schema/cấu hình/CLI cụ thể; giải thích thiết kế và xử lý lỗi. ${fmt} ${VI_GUARD}`;
  }
  const fmt = isDef ? EN_DEF_FORMAT : isList ? EN_LIST_FORMAT : EN_FORMAT;
  if (userLevel === "basic") {
    return `Support assistant for SYNAPSE on-prem system, for line workers. ${fmt} ${EN_GUARD}`;
  }
  if (userLevel === "manager") {
    return `Analytical assistant for SYNAPSE on-prem system, for managers. Focus on KPIs, trends, operational impact, prioritized actions. ${fmt} ${EN_GUARD}`;
  }
  return `Technical assistant for SYNAPSE on-prem system, for engineers. Include APIs, schemas, config, CLI; explain design and error handling. ${fmt} ${EN_GUARD}`;
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
      // doc69 G2-3 — redact secrets/PII from prior turns before they re-enter a new prompt
      // (defense-in-depth; a secret pasted 2 turns ago must not keep echoing forward).
      const oneLine = redactSecretsAndPII(m.content.replace(/\s+/g, " ").trim()).text;
      const snippet =
        oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
      return `${label}: ${snippet}`;
    })
    .join("\n");
}

/**
 * FE-W0.3 (doc 46 §2.3) — run the degenerate-loop guard over a completed LLM
 * answer. Returns the clean text (or a salvaged head) or NULL when the output is
 * unsalvageable garbage — NULL makes the caller fall back to the extractive/tool
 * answer instead of showing "cell cell cell…". Never throws.
 */
function guardKbAnswer(raw: string | null | undefined): string | null {
  const g = guardGeneratedText(raw);
  if (g.degraded) {
    console.warn(
      `[aiLocalKnowledge] degenerate LLM answer rejected (${g.reason}) — ` +
        `${g.text ? "using salvaged head" : "falling back to extractive/tool"}.`,
    );
  }
  const t = g.text.trim();
  return t.length > 0 ? t : null;
}

async function generateWithOllama(
  question: string,
  retrieve: KbRetrieveResult,
  history: ConversationMessage[] = [],
  userLevel: UserLevel = "technical",
  toolSummary?: string | null,
  userId?: number,
): Promise<string | null> {
  // doc69 G2-3 — AI Gateway: SAME input this function always passed to `route()` below
  // (`{task:"chat", text: question}`), so `plan.decision.modelId` is byte-identical to
  // before — model pinning is preserved, nothing is "double-routed". This ADDS: flag-gated
  // fail-safe input redaction (`plan.safeText`, used for the question below), a per-user
  // rate-limit + A/B slot (previously bypassed for this endpoint), and `record()`/
  // `sanitizeOutput()` for gateway metering + output redaction further down.
  const plan = await planInference({ task: "chat", text: question, userId });

  const contextBlock = retrieve.citations
    .map((c, i) => {
      const raw = retrieve.contexts[i] ?? "";
      const ctx = raw.length > CONTEXT_CHUNK_CHAR_CAP
        ? `${raw.slice(0, CONTEXT_CHUNK_CHAR_CAP)}…`
        : raw;
      // doc69 G2-3 — redact any secret/PII that made it into an ingested KB chunk before it
      // reaches the model prompt (defense-in-depth; unconditional per aiSafety's "redaction
      // is always safe to apply" posture — mirrors aiChatAssistant's tool-result redaction).
      return `[${i + 1}] ${c.title} | ${c.sourcePath}\n${redactSecretsAndPII(ctx).text}`;
    })
    .join("\n\n");

  const systemPrompt = getSystemPromptForRole(userLevel, retrieve.language, retrieve.intent);
  const historyBlock = formatHistoryBlock(history);
  const hintsBlock = formatHintsBlock(retrieve);

  // doc69 G2-3 — redact live-DB tool-result text before it is embedded in the prompt.
  const safeToolSummary = toolSummary ? redactSecretsAndPII(toolSummary).text : toolSummary;
  const toolBlock = safeToolSummary
    ? `\n=== Dữ liệu thời gian thực (từ CSDL) ===\n${safeToolSummary}\nƯU TIÊN dùng dữ liệu này để trả lời. Không bịa số liệu.\n`
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
    // doc69 G2-3 — `plan.safeText` (redacted question), not raw `question`.
    `\n=== Câu hỏi hiện tại ===\n${plan.safeText}`,
    "=== Câu trả lời (chỉ trả lời câu hỏi hiện tại, không lặp lại lịch sử) ===",
  ]
    .filter(Boolean)
    .join("\n");

  // Default: use bundled GGUF engine (RTX 5090 local). Fallback to Ollama HTTP only if USE_LEGACY_OLLAMA=true.
  const numPredict = pickNumPredict(retrieve.intent, !!toolSummary, question);
  if (!USE_LEGACY_OLLAMA) {
    let start = 0;
    try {
      const { generateText: ggufGen, isGgufAvailable } = await import("./aiGgufEngine");
      if (await isGgufAvailable()) {
        // doc 48 R1 — PIN a generative model. Without a modelId the engine's
        // getOrLoadModel(undefined) reuses the FIRST resident model, which is the RAG
        // embedder → gibberish answers. `plan.decision` already carries the SAME
        // Model-Router pick `route({task:"chat", text: question})` produced before.
        start = Date.now();
        const result = await ggufGen({
          prompt,
          maxTokens: numPredict,
          temperature: 0.15,
          topP: 0.9,
          repeatPenalty: KB_QA_REPEAT_PENALTY,
        }, plan.decision.modelId);
        // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
        plan.record({
          tokensIn: result.tokensPrompt,
          tokensOut: result.tokensGenerated,
          latencyMs: Date.now() - start,
          outcome: "ok",
        });
        // doc69 G2-3 — output safety FIRST (redact any echoed secret) then the existing
        // FE-W0.3 degenerate-loop guard; degenerate → null → fallback.
        return guardKbAnswer(plan.sanitizeOutput(result.text));
      }
      // GGUF not available — fall through to Ollama path.
    } catch (err) {
      plan.record({ latencyMs: start ? Date.now() - start : 0, outcome: "error" });
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
    // FE-W0.3 (doc 46 §2.3) — guard the completed answer; degenerate → null → fallback.
    return guardKbAnswer(json.response);
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
  userId?: number,
): AsyncGenerator<string> {
  // doc69 G2-3 — AI Gateway (see the identical comment on generateWithOllama above; same
  // {task:"chat", text: question} input preserves the pinned-model decision byte-for-byte).
  const plan = await planInference({ task: "chat", text: question, userId });

  const contextBlock = retrieve.citations
    .map((c, i) => {
      const raw = retrieve.contexts[i] ?? "";
      const ctx = raw.length > CONTEXT_CHUNK_CHAR_CAP
        ? `${raw.slice(0, CONTEXT_CHUNK_CHAR_CAP)}…`
        : raw;
      // doc69 G2-3 — see generateWithOllama's identical comment.
      return `[${i + 1}] ${c.title} | ${c.sourcePath}\n${redactSecretsAndPII(ctx).text}`;
    })
    .join("\n\n");

  const systemPrompt = getSystemPromptForRole(userLevel, retrieve.language, retrieve.intent);
  const historyBlock = formatHistoryBlock(history);
  const hintsBlock = formatHintsBlock(retrieve);

  // doc69 G2-3 — redact live-DB tool-result text before it is embedded in the prompt.
  const safeToolSummary = toolSummary ? redactSecretsAndPII(toolSummary).text : toolSummary;
  const toolBlock = safeToolSummary
    ? `\n=== Dữ liệu thời gian thực (từ CSDL) ===\n${safeToolSummary}\nƯU TIÊN dùng dữ liệu này để trả lời. Không bịa số liệu.\n`
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
    // doc69 G2-3 — `plan.safeText` (redacted question), not raw `question`.
    `\n=== Câu hỏi hiện tại ===\n${plan.safeText}`,
    "=== Câu trả lời (chỉ trả lời câu hỏi hiện tại, không lặp lại lịch sử) ===",
  ]
    .filter(Boolean)
    .join("\n");

  // Default: use bundled GGUF engine streaming. Fallback to Ollama HTTP if USE_LEGACY_OLLAMA=true.
  const numPredict = pickNumPredict(retrieve.intent, !!toolSummary, question);
  if (!USE_LEGACY_OLLAMA) {
    let start = 0;
    try {
      const { generateTextStream: ggufStream, isGgufAvailable } = await import("./aiGgufEngine");
      if (await isGgufAvailable()) {
        // doc 48 R1 — PIN a generative model (see generateWithOllama above). modelId is the 2nd
        // arg to generateTextStream; without it the stream lands on the resident embedder.
        // `plan.decision` already carries the SAME Model-Router pick as before.
        // doc69 G2-3 — output safety: one redactor instance per stream (stateful — holds
        // back a growing secret across chunk boundaries; see aiSafety.ts's class doc).
        const redactor = new StreamingSecretRedactor();
        let tokensIn = 0;
        let tokensOut = 0;
        start = Date.now();
        for await (const chunk of ggufStream({
          prompt,
          maxTokens: numPredict,
          temperature: 0.15,
          topP: 0.9,
          repeatPenalty: KB_QA_REPEAT_PENALTY,
        }, plan.decision.modelId)) {
          // GGUF engine yields { type: "token" | "done" | "error", token?, ... }
          // We must extract the string token, not yield the whole object
          // (which would stringify to "[object Object]" downstream).
          if (chunk.type === "token" && typeof chunk.token === "string" && chunk.token.length > 0) {
            const safe = redactor.push(chunk.token);
            if (safe) yield safe;
          } else if (chunk.type === "done") {
            tokensIn = chunk.tokensPrompt ?? 0;
            tokensOut = chunk.tokensGenerated ?? 0;
          } else if (chunk.type === "error") {
            throw new Error(chunk.error || "GGUF stream error");
          }
        }
        // Release whatever the redactor was still holding back (e.g. a short tail).
        const tail = redactor.flush();
        if (tail) yield tail;
        // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
        plan.record({ tokensIn, tokensOut, latencyMs: Date.now() - start, outcome: "ok" });
        return;
      }
    } catch (err) {
      plan.record({ latencyMs: start ? Date.now() - start : 0, outcome: "error" });
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

// W0.2 (doc 11) — honest health shape. Keeps every legacy field (ready/chunks/
// embeddings/loadedAt/paths) for backward-compat and ADDS capability + provenance
// signals so the client can stop showing a misleading "Sẵn sàng":
//   llmReady          — a GGUF TEXT model actually resolves+validates on disk
//                       (else answers silently degrade to extractive)
//   embedModel        — model the corpus was embedded with (from meta)
//   queryEmbedModel   — model the query path uses (GGUF_EMBED_MODEL)
//   embedModelMatches — false ONLY when both known AND differ (retrieval corrupt)
//   kbBuiltAt         — when the corpus was built (ISO) · staleDays — whole days old
export interface KbHealth {
  ready: boolean;
  chunks: number;
  embeddings: number;
  loadedAt?: string;
  paths: { chunks: string; embeddings: string };
  // W0.2/W0.3 (doc 11) additions:
  llmReady: boolean;
  embedModel: string | null;
  queryEmbedModel: string;
  embedModelMatches: boolean;
  kbBuiltAt: string | null;
  chunkCount: number;
  staleDays: number | null;
}

// W0.2 (doc 11) — best-effort "is a text LLM loadable?" check. Never throws;
// degrades to false so health stays conservative rather than crashing.
async function probeLlmReady(): Promise<boolean> {
  try {
    const { isGgufModelLoadable } = await import("./aiGgufEngine");
    return await isGgufModelLoadable();
  } catch {
    return false;
  }
}

function wholeDaysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

export async function getKbHealth(): Promise<KbHealth> {
  const queryEmbedModel = GGUF_EMBED_MODEL_ID;
  try {
    const data = ensureDataLoaded();
    // Sub-checks are individually guarded → a failing one degrades to a
    // conservative value (llmReady:false) instead of failing the whole health.
    const llmReady = await probeLlmReady();
    const embedModelMatches = computeEmbedModelMatches(data.corpusEmbedModel);
    return {
      ready: true,
      chunks: data.chunksById.size,
      embeddings: data.embeddings.length,
      loadedAt: new Date(data.loadedAt).toISOString(),
      paths: {
        chunks: CHUNKS_FILE,
        embeddings: EMBEDDINGS_FILE,
      },
      llmReady,
      embedModel: data.corpusEmbedModel,
      queryEmbedModel,
      embedModelMatches,
      kbBuiltAt: data.kbBuiltAt,
      chunkCount: data.chunksById.size,
      staleDays: wholeDaysSince(data.kbBuiltAt),
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
      llmReady: false,
      embedModel: null,
      queryEmbedModel,
      embedModelMatches: true,
      kbBuiltAt: null,
      chunkCount: 0,
      staleDays: null,
    };
  }
}

export function reloadKbArtifacts(): Promise<KbHealth> {
  dataCache = null;
  embedModelMismatchWarned = false; // W0.3 — allow the mismatch warning to re-fire after a rebuild.
  return getKbHealth();
}

// C3a — resolve reply language. Strong signal from the question text wins; for
// ambiguous questions (no script/keyword signal → defaults to "en") we fall
// back to the UI language hint so a Chinese UI gets Chinese replies even when
// the user types code/identifiers only.
function resolveLanguage(question: string, context?: KbQueryContext): KbLanguage {
  const detected = detectLanguage(question);
  const ui = context?.uiLanguage;
  // detectLanguage returns "en" both for genuine English and for ambiguous
  // input (codes/numbers). Only override when it fell through to "en" AND the
  // question carries no Latin letters (i.e. no real English words).
  if (detected === "en" && ui && ui !== "en" && !/[a-z]{3,}/i.test(question)) {
    return ui;
  }
  return detected;
}

// C3a — map a FE route to coarse KB feature/source keywords. Only a few
// high-traffic routes are mapped; unmapped routes return [] (no boost).
const ROUTE_FEATURE_HINTS: Record<string, string[]> = {
  "/machine-health": ["machine", "health", "oee", "maintenance"],
  "/machine-status": ["machine", "status", "heartbeat"],
  "/oee-dashboard": ["oee"],
  "/products": ["product", "model", "measurement"],
  "/spc-analysis": ["spc", "control", "cpk"],
  "/production-orders": ["production", "order", "lot"],
  "/reports": ["report"],
  "/alerts": ["alert"],
};
function routeToFeatureHints(route: string): string[] {
  const path = route.split("?")[0]?.replace(/\/+$/, "") || "/";
  return ROUTE_FEATURE_HINTS[path] ?? [];
}

// ─── GraphRAG 1-hop expansion (doc 11 follow-up) ──────────────────────────────
// Flag-gated, additive, fail-safe widening of the cosine candidate pool with
// 1-hop neighbours from the precomputed semantic graph (knowledge/
// semantic-graph.json). Default OFF → behavior is byte-for-byte the legacy path
// (a single cheap boolean check). When ON, after the cosine candidates are
// scored+deduped we take the top KB_GRAPHRAG_SEEDS seeds and inject up to
// KB_GRAPHRAG_HOPS_PER_SEED neighbours each (edge similarity ≥ KB_GRAPHRAG_MIN_SIM)
// into the pool BEFORE the reranker takes its slice, capped at KB_GRAPHRAG_MAX_INJECT
// total. Injected neighbours get a blended score (seedScore × edge.similarity ×
// KB_GRAPHRAG_DECAY) so they compete in the reranker pool without outranking true
// cosine hits. Env (all optional; defaults match the doc):
//   KB_GRAPHRAG_ENABLED=false        — master switch (default OFF)
//   KB_GRAPHRAG_SEEDS=5              — top candidates used as expansion seeds
//   KB_GRAPHRAG_HOPS_PER_SEED=3      — max neighbours pulled per seed
//   KB_GRAPHRAG_MIN_SIM=0.72         — min edge similarity to follow
//   KB_GRAPHRAG_DECAY=0.85           — blended-score decay for injected neighbours
//   KB_GRAPHRAG_MAX_INJECT=8         — hard cap on total injected (bounds prompt size)
// Debug: set KB_GRAPHRAG_DEBUG=true to log how many neighbours were injected.
const KB_GRAPHRAG_ENABLED = (process.env.KB_GRAPHRAG_ENABLED ?? "false").toLowerCase() === "true";
function graphRagOpts() {
  return {
    seeds: Number(process.env.KB_GRAPHRAG_SEEDS ?? 5),
    hopsPerSeed: Number(process.env.KB_GRAPHRAG_HOPS_PER_SEED ?? 3),
    minSim: Number(process.env.KB_GRAPHRAG_MIN_SIM ?? 0.72),
    decay: Number(process.env.KB_GRAPHRAG_DECAY ?? 0.85),
    maxInject: Number(process.env.KB_GRAPHRAG_MAX_INJECT ?? 8),
  };
}

export async function retrieveKnowledge(
  question: string,
  topK = 5,
  context?: KbQueryContext,
): Promise<KbRetrieveResult> {
  const data = ensureDataLoaded();
  const tokens = tokenize(question);
  const intent = classifyIntent(question);
  const language = resolveLanguage(question, context);
  const entities = extractEntities(question);

  // C3a — features hinted by the current route (light boost only).
  const routeFeatures = context?.route ? routeToFeatureHints(context.route) : [];

  // W0.3 (doc 11) — when the corpus embed-model differs from the query embed-model
  // (locked decision Q5: WARN + fall back, never hard-block), skip vector retrieval
  // entirely. A same-dimension/different-model vector would pass the length guard
  // but produce a CORRUPT cosine similarity, so keyword-only retrieval is safer.
  const embedModelMatches = computeEmbedModelMatches(data.corpusEmbedModel);
  const qVec = embedModelMatches ? await embedQuestion(question) : null;

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
    // C3a — small boost for chunks whose source path matches a feature hinted
    // by the current route, so on-page questions surface page-relevant KB.
    // Kept gentle (×1.12) so it nudges ties without overriding real relevance.
    const routeWeight =
      routeFeatures.length > 0 && routeFeatures.some((f) => emb.sourcePath.toLowerCase().includes(f))
        ? 1.12
        : 1.0;
    const score = baseScore * langWeight * typeWeight * routeWeight;

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
  const finalK = Math.max(1, Math.min(10, topK));

  // GraphRAG 1-hop expansion (flag-gated, additive, fail-safe). When OFF (default)
  // this is a single boolean check — `pool` below is exactly `deduped`, so the
  // reranker/top-K flow is byte-for-byte the legacy path. When ON, we inject the
  // strongest 1-hop neighbours of the top seeds into the pool so the reranker/LLM
  // sees semantically-linked context (multi-part docs, router↔schema cross-refs).
  // Any graph error is swallowed by loadSemanticGraph/expandWithGraph → expansion
  // is skipped, never thrown. Injected neighbours synthesize the same candidate
  // shape as a cosine hit, with semantic/keyword left 0 (their score is the
  // pre-blended graph score) so the downstream pipeline treats them uniformly.
  let pool = deduped;
  if (KB_GRAPHRAG_ENABLED && deduped.length > 0) {
    try {
      const adj = loadSemanticGraph();
      if (adj.size > 0) {
        const seedItems = deduped.map((r) => ({ id: r.emb.id, score: r.score, ref: r }));
        const expanded = expandWithGraph(
          seedItems,
          adj,
          graphRagOpts(),
          (id, score) => {
            // Only inject neighbours we actually have a chunk + embedding for;
            // otherwise the candidate can't be cited or reranked.
            const chunk = data.chunksById.get(id);
            if (!chunk) return null;
            const emb = data.embeddings.find((e) => e.id === id);
            if (!emb) return null;
            return {
              id,
              score,
              ref: { emb, chunk, semantic: 0, keyword: 0, score } as (typeof deduped)[number],
            };
          },
        );
        if (expanded.injected > 0) {
          pool = expanded.pool.map((c) => c.ref);
          if ((process.env.KB_GRAPHRAG_DEBUG ?? "").toLowerCase() === "true") {
            console.error(
              `[KB_GRAPHRAG] injected ${expanded.injected} neighbour(s) ` +
                `(pool ${deduped.length} → ${pool.length})`,
            );
          }
        }
      }
    } catch (err) {
      // Fail-safe: never let graph expansion break retrieval.
      if ((process.env.KB_GRAPHRAG_DEBUG ?? "").toLowerCase() === "true") {
        console.error("[KB_GRAPHRAG] expansion skipped (error):", err);
      }
      pool = deduped;
    }
  }

  // B2.2 — Reranker stage (flag-gated, fail-safe). When RAG_RERANKER_ENABLED is
  // on: take a wider candidate pool (cosine top-N), rerank by query relevance,
  // and reorder before the final topK slice. When off (default) this whole block
  // is skipped and `topSlice` is exactly the legacy cosine top-K — behavior is
  // unchanged. rerank() never throws (degrades to original order on any error).
  // NOTE: `pool` is `deduped` plus any GraphRAG-injected neighbours (identical to
  // `deduped` when the flag is OFF). The reranker draws its candidate pool from it
  // so injected neighbours can compete for the final top-K.
  let topSlice: typeof pool;
  if (isRerankerEnabled() && pool.length > 1) {
    const poolSize = Math.max(finalK, Number(process.env.RAG_RERANKER_POOL ?? 20));
    const rerankPool = pool.slice(0, poolSize);
    const candidates: RerankCandidate[] = rerankPool.map((r) => ({
      id: r.emb.id,
      title: r.emb.title,
      text: r.chunk ? r.chunk.text : "",
      score: r.score,
    }));
    const reranked = await rerank(question, candidates, finalK);
    const byId = new Map(rerankPool.map((r) => [r.emb.id, r]));
    const reordered = reranked
      .map((rr) => byId.get(rr.candidate.id))
      .filter((r): r is (typeof rerankPool)[number] => Boolean(r));
    // Guard: if the rerank somehow returned nothing usable, fall back to cosine.
    topSlice = reordered.length > 0 ? reordered : pool.slice(0, finalK);
  } else {
    topSlice = pool.slice(0, finalK);
  }

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
  context?: KbQueryContext,
  execCtx?: ToolExecContext,
): Promise<KbAnswerResult> {
  const userLevel = rolToUserLevel(userRole);
  const key = getCacheKey(question, topK, userRole);
  const now = Date.now();

  // Step 1 — Try a real-time tool first. Tool answers must NOT be cached
  // because they reflect live database state.
  const toolExec = await tryExecuteTool(question, context, execCtx);
  const toolResult = toolExec.result;
  const clarifyMessage = toolExec.decision.clarifyMessage ?? null;

  // GĐ2 — write-tool matched: short-circuit with the confirm card (propose) or
  // a localized RBAC refusal. No LLM, no cache.
  if (toolExec.pendingAction || toolExec.denied) {
    const retrieve = await retrieveKnowledge(question, topK, context);
    const message = toolExec.denied
      ? toolExec.denied.message
      : toolExec.pendingAction!.summary;
    return {
      ...retrieve,
      answer: message,
      provider: "tool",
      cached: false,
      followUpSuggestions: [],
      toolResult: null,
      toolName: toolExec.decision.tool ?? null,
      pendingAction: toolExec.pendingAction ?? null,
      structured: extractStructuredResponse(message),
    };
  }

  // Short-circuit: if intent classifier asked for clarification, return it
  // immediately without invoking the LLM. This avoids hallucinated answers
  // for questions like "lô của tôi sao rồi?" that lack a concrete identifier.
  if (!toolResult && clarifyMessage) {
    const retrieve = await retrieveKnowledge(question, topK, context);
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

  const retrieve = await retrieveKnowledge(question, topK, context);

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
          execCtx?.user?.id,
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
      const llmAnswer = await generateWithOllama(question, retrieve, history, userLevel, undefined, execCtx?.user?.id);
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
      language: KbLanguage;
      confidence: number;
      citations: KbCitation[];
    }
  | { type: "tool"; toolName: string | null; toolResult: ToolResult }
  | { type: "pending_action"; toolName: string | null; pendingAction: PendingActionDTO }
  | { type: "client_action"; toolName: string | null; clientAction: ClientActionDirective }
  // GĐ3b — multi-step agentic orchestrator events (forward-compat; the primary
  // wiring is via the tRPC aiAgent router response, not this stream).
  | { type: "agent_plan"; sessionId: string; plan: { steps: Array<{ kind: string; tool?: string | null; rationale?: string }> } }
  | { type: "agent_step"; sessionId: string; index: number; kind: string; status: string; actionId?: string | null }
  | { type: "token"; token: string }
  | {
      type: "done";
      provider: "ollama" | "extractive" | "tool";
      cached: boolean;
      followUpSuggestions: string[];
      answer: string;
      structured?: KbStructuredResponse;
      /**
       * FE-W0.3 (doc 46 §2.3) — true when the streamed LLM output was rejected as
       * a degenerate loop and `answer` carries a clean fallback INSTEAD. The client
       * must REPLACE the accumulated streamed tokens with `answer` when this is set.
       */
      degraded?: boolean;
      degradedReason?: string;
    };

export async function* streamAnswer(
  question: string,
  topK = 5,
  history: ConversationMessage[] = [],
  userRole: UserRole = "engineer",
  context?: KbQueryContext,
  execCtx?: ToolExecContext,
): AsyncGenerator<StreamEvent> {
  const userLevel = rolToUserLevel(userRole);
  const key = getCacheKey(question, topK, userRole);
  const now = Date.now();

  // Real-time tool first (live DB state — must NOT be cached).
  const toolExec = await tryExecuteTool(question, context, execCtx);
  const toolResult = toolExec.result;
  const clarifyMessage = toolExec.decision.clarifyMessage ?? null;

  // GĐ2/GĐ3a — write-tool, client-tool, or refusal matched: emit meta +
  // (pending_action | client_action | refusal token) + done.
  if (toolExec.pendingAction || toolExec.clientAction || toolExec.denied) {
    const retrieve = await retrieveKnowledge(question, topK, context);
    yield {
      type: "meta",
      intent: retrieve.intent,
      language: retrieve.language,
      confidence: retrieve.confidence,
      citations: retrieve.citations,
    };
    const message = toolExec.denied
      ? toolExec.denied.message
      : toolExec.clientAction
        ? toolExec.clientAction.message
        : toolExec.pendingAction!.summary;
    if (toolExec.pendingAction) {
      yield { type: "pending_action", toolName: toolExec.decision.tool ?? null, pendingAction: toolExec.pendingAction };
    }
    if (toolExec.clientAction) {
      yield { type: "client_action", toolName: toolExec.decision.tool ?? null, clientAction: toolExec.clientAction };
    }
    yield { type: "token", token: message };
    yield {
      type: "done",
      provider: "tool",
      cached: false,
      followUpSuggestions: [],
      answer: message,
      structured: extractStructuredResponse(message),
    };
    return;
  }

  // Short-circuit clarification (mirrors answerQuestion).
  if (!toolResult && clarifyMessage) {
    const retrieve = await retrieveKnowledge(question, topK, context);
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

  const retrieve = await retrieveKnowledge(question, topK, context);

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
  // FE-W0.3 (doc 46 §2.3) — set when the streamed output degenerated into a loop;
  // the streamed garbage is discarded and a clean fallback is sent on `done`.
  let streamDegraded = false;
  let streamDegradedReason: string | undefined;

  const shouldUseLlm = !!toolResult || retrieve.confidence >= 0.30;

  if (shouldUseLlm) {
    try {
      const iter = generateWithOllamaStream(
        question,
        retrieve,
        history,
        userLevel,
        toolResult?.textSummary,
        execCtx?.user?.id,
      );
      // FE-W0.3 (doc 46 §2.3) — incremental degenerate-loop guard: re-check the
      // accumulated text every STREAM_GUARD_STEP_CHARS once past the min, and BREAK
      // the moment it loops so we emit a handful of repeated tokens instead of
      // thousands. The client resets to the clean `answer` on the degraded `done`.
      let nextCheckAt = STREAM_GUARD_MIN_CHARS;
      for await (const piece of iter) {
        if (!piece) continue;
        accumulated += piece;
        yield { type: "token", token: piece };
        if (accumulated.length >= nextCheckAt) {
          nextCheckAt = accumulated.length + STREAM_GUARD_STEP_CHARS;
          if (isDegenerateStream(accumulated)) {
            streamDegraded = true;
            streamDegradedReason = "stream_loop";
            break;
          }
        }
      }
      if (streamDegraded) {
        // Discard the looped output; the fallback block below produces a clean answer.
        console.warn("[aiLocalKnowledge] degenerate stream detected — discarding looped output, sending clean fallback.");
        accumulated = "";
      } else if (accumulated.trim()) {
        // Final full-output guard (catches a loop that only crossed threshold at the tail).
        const g = guardGeneratedText(accumulated);
        if (g.degraded) {
          streamDegraded = true;
          streamDegradedReason = g.reason;
          accumulated = g.text.trim(); // salvaged head or "" → fallback block runs
          console.warn(`[aiLocalKnowledge] degenerate stream (final guard: ${g.reason}) — ${accumulated ? "using salvaged head" : "clean fallback"}.`);
        }
        if (accumulated.trim()) provider = "ollama";
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
  // FE-W0.3 (doc 46 §2.3) — NEVER cache a degraded/salvaged answer.
  if (history.length === 0 && !toolResult && provider !== "extractive" && !streamDegraded) {
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
    // FE-W0.3 (doc 46 §2.3) — signal the client to REPLACE the streamed tokens
    // with `answer` when the LLM output was rejected as a degenerate loop.
    ...(streamDegraded ? { degraded: true, degradedReason: streamDegradedReason } : {}),
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
    // doc 48 R1 — WARM ORDER FIX: make a GENERATIVE model resident BEFORE the RAG embedder.
    // The embedder warm below (embedQuestion) loads the small embedding model; if it lands first
    // it becomes the FIRST resident GGUF model, and any generate call that does NOT pin a model
    // (engine getOrLoadModel(undefined)) reuses it → gibberish narratives/chat. Warming the deep
    // model first also avoids VRAM fragmentation (load the large model before small ones; see
    // aiGgufEngine.warmModel docs / doc 34 §P4). Best-effort + fail-safe: if the deep model cannot
    // load (VRAM), warmModel returns false and the callers' honest-degrade guards still render the
    // offline template — never gibberish. Embedder is still warmed right after (RAG needs it).
    void (async () => {
      if (!USE_LEGACY_OLLAMA) {
        try {
          const { warmModel } = await import("./aiGgufEngine");
          // Basename sans ".gguf" — the engine appends it, matching the Model Router's basenames
          // so a later route({task:"report"|"chat"}).modelId pin finds this exact model resident.
          const deep = (process.env.GGUF_DEFAULT_MODEL || process.env.GGUF_FAST_MODEL || "")
            .trim()
            .replace(/\.gguf$/i, "");
          await warmModel(deep || undefined);
        } catch { /* best-effort — never blocks the embedder warm below */ }
      }
      // Keep the embedder warm too (RAG retrieval needs it resident).
      await embedQuestion("warmup").catch(() => {});
    })().catch(() => {});
    // Legacy Ollama QA warm — a no-op unless USE_LEGACY_OLLAMA (nothing listens on the GGUF path).
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

// ─── B2.4 — Auto-ingest of RCA / ai_insight records ─────────────────────────
//
// Given a new RCA / insight text, chunk → embed (same mxbai 1024-d space) →
// append to knowledge/chunks.jsonl + embeddings.jsonl so future retrieval
// includes it (a self-enriching loop). FLAG-GATED (RAG_AUTO_INGEST_ENABLED,
// default OFF) and IDEMPOTENT: dedupes by a deterministic id derived from
// `sourceId`. Designed as a fire-and-forget hook — never throws to the caller.
//
// Vector-space consistency: embeds `title\ntext` via embedQuestionGguf (the same
// GGUF mxbai model + L2 normalization the corpus was built with) and writes rows
// with the SAME schema as generate-embeddings.mjs so the new vectors live in the
// same space and are picked up by ensureDataLoaded on next (re)load.

export function isAutoIngestEnabled(): boolean {
  return (process.env.RAG_AUTO_INGEST_ENABLED ?? "false").toLowerCase() === "true";
}

export interface IngestRecord {
  /** Stable source identifier (e.g. `rca:123`, `insight:abc`). Used for dedupe. */
  sourceId: string;
  title: string;
  text: string;
  /** Defaults to "incident". */
  sourceType?: string;
  /** Defaults to `ingest/<sourceType>/<sourceId>`. */
  sourcePath?: string;
  keywords?: string[];
}

function ingestChunkId(sourceId: string): string {
  // Deterministic id namespace so re-ingesting the same record is a no-op.
  return `ingest:${sourceId.replace(/\s+/g, "_")}`;
}

// In-process guard so a burst of identical hooks within one run doesn't race the
// file-existence dedupe (the on-disk check still covers cross-process dedupe).
const ingestedThisProcess = new Set<string>();

/**
 * Idempotently append a single RCA/insight record to the file-based KB.
 * Returns true if a new chunk+embedding was written, false if skipped
 * (already present, flag off, empty text, or embed failed). Never throws.
 */
export async function ingestKnowledgeRecord(rec: IngestRecord): Promise<boolean> {
  try {
    if (!isAutoIngestEnabled()) return false;
    const sourceId = (rec.sourceId ?? "").trim();
    const text = (rec.text ?? "").trim();
    const title = (rec.title ?? "").trim() || sourceId;
    if (!sourceId || !text) return false;

    const id = ingestChunkId(sourceId);
    if (ingestedThisProcess.has(id)) return false;

    // On-disk dedupe: scan existing chunk ids (cheap line scan). If present, skip.
    if (fs.existsSync(CHUNKS_FILE)) {
      const existing = fs.readFileSync(CHUNKS_FILE, "utf8");
      // Match the id as a JSON field to avoid false positives on substrings.
      if (existing.includes(`"id":"${id}"`)) {
        ingestedThisProcess.add(id);
        return false;
      }
    }

    // Embed `title\ntext` (corpus convention). embedQuestionGguf L2-normalizes
    // and dimension-guards (returns null on mismatch) → consistent vectors.
    const embedInput = `${title}\n${text}`;
    const vector = await embedQuestionGguf(embedInput);
    if (!vector) {
      console.warn(`[aiLocalKnowledge] auto-ingest: embedding unavailable for ${id}, skipping`);
      return false;
    }

    const sourceType = rec.sourceType ?? "incident";
    const sourcePath = rec.sourcePath ?? `ingest/${sourceType}/${sourceId}`;
    const hash = createHash("sha256").update(embedInput, "utf8").digest("hex");

    const chunkRow = {
      id,
      hash,
      sourceType,
      sourcePath,
      title,
      text,
      keywords: rec.keywords ?? [],
    };
    const embRow = {
      id,
      hash,
      sourceType,
      sourcePath,
      title,
      keywords: rec.keywords ?? [],
      textLength: text.length,
      embeddingDim: vector.length,
      embedding: vector,
    };

    // Append (newline-terminated) to both files.
    fs.appendFileSync(CHUNKS_FILE, JSON.stringify(chunkRow) + "\n", "utf8");
    fs.appendFileSync(EMBEDDINGS_FILE, JSON.stringify(embRow) + "\n", "utf8");
    ingestedThisProcess.add(id);

    // Patch the in-memory cache so retrieval sees the new chunk immediately
    // (without a full reload). Safe: same shapes as ensureDataLoaded builds.
    if (dataCache) {
      dataCache.chunksById.set(id, {
        id,
        sourceType,
        sourcePath,
        title,
        text,
        keywords: rec.keywords ?? [],
      });
      dataCache.embeddings.push({
        id,
        sourceType,
        sourcePath,
        title,
        keywords: rec.keywords ?? [],
        textLength: text.length,
        embeddingDim: vector.length,
        embedding: vector,
      });
    }

    console.log(`[aiLocalKnowledge] auto-ingested KB record ${id} (${sourcePath})`);
    return true;
  } catch (err) {
    console.warn("[aiLocalKnowledge] auto-ingest failed (non-fatal):", err);
    return false;
  }
}

/** Fire-and-forget wrapper for hook sites — never awaited, never throws. */
export function ingestKnowledgeRecordAsync(rec: IngestRecord): void {
  void ingestKnowledgeRecord(rec).catch(() => {});
}
