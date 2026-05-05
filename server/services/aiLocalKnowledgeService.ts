import fs from "node:fs";
import path from "node:path";

export type KbIntent =
  | "how_to"
  | "troubleshoot"
  | "architecture"
  | "technical"
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

export interface KbAnswerResult extends KbRetrieveResult {
  answer: string;
  provider: "ollama" | "extractive";
  cached: boolean;
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
const OLLAMA_QA_MODEL = process.env.OLLAMA_QA_MODEL ?? "qwen2.5-instruct";

const ANSWER_CACHE_TTL_MS = Number(process.env.KB_QA_CACHE_TTL_MS ?? 10 * 60 * 1000);

let dataCache: KbDataBundle | null = null;
const answerCache = new Map<string, { expiresAt: number; value: KbAnswerResult }>();

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

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .filter((t) => t.length >= 2)
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

function classifyIntent(question: string): KbIntent {
  const q = normalizeText(question);
  if (/(how|lam sao|huong dan|cach|steps|guide)/i.test(q)) return "how_to";
  if (/(error|loi|fail|fix|khac phuc|troubleshoot|incident)/i.test(q)) return "troubleshoot";
  if (/(architecture|kien truc|flow|luong|design|module)/i.test(q)) return "architecture";
  if (/(api|endpoint|router|service|schema|model|query|db|database)/i.test(q)) return "technical";
  return "general";
}

function extractEntities(question: string): string[] {
  const entities = new Set<string>();

  const matches = [
    ...(question.match(/[A-Za-z0-9_]+Router/g) ?? []),
    ...(question.match(/[A-Za-z0-9_]+Service/g) ?? []),
    ...(question.match(/[A-Za-z0-9_/.-]+\.(?:ts|tsx|js|mjs|sql|md)/g) ?? []),
    ...(question.match(/\/api\/[A-Za-z0-9_./-]*/g) ?? []),
    ...(question.match(/M-?\d{1,4}/gi) ?? []),
  ];

  for (const m of matches) {
    const trimmed = m.trim();
    if (trimmed) entities.add(trimmed);
  }

  return Array.from(entities).slice(0, 10);
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

async function embedQuestion(question: string): Promise<number[] | null> {
  const body = {
    model: OLLAMA_EMBED_MODEL,
    input: question,
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

  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
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
  const intro =
    language === "vi"
      ? `Cau hoi: ${question}\n\nToi tim thay cac nguon lien quan nhat trong codebase:`
      : `Question: ${question}\n\nI found the most relevant sources in the codebase:`;

  const bullets = retrieve.citations
    .map((c, i) => {
      const ctx = retrieve.contexts[i] ?? "";
      const snippet = ctx.replace(/\s+/g, " ").slice(0, 220);
      return `${i + 1}. [${c.sourceType}] ${c.title} (${c.sourcePath})\n   ${snippet}`;
    })
    .join("\n");

  const outro =
    language === "vi"
      ? "\n\nNeu can, toi co the dao sau vao mot endpoint/router hoac workflow cu the."
      : "\n\nIf needed, I can dive deeper into a specific endpoint/router or workflow.";

  return `${intro}\n${bullets}${outro}`;
}

async function generateWithOllama(question: string, retrieve: KbRetrieveResult): Promise<string | null> {
  const contextBlock = retrieve.citations
    .map((c, i) => {
      const ctx = retrieve.contexts[i] ?? "";
      return `[${i + 1}] ${c.title} | ${c.sourcePath}\n${ctx}`;
    })
    .join("\n\n");

  const prompt = [
    "You are a software knowledge assistant for the AVI AOI Management codebase.",
    "Answer using only provided context and cite sources with [1], [2] style.",
    "If context is insufficient, clearly say what is missing.",
    `Intent: ${retrieve.intent}`,
    `Language: ${retrieve.language}`,
    `Question: ${question}`,
    "Context:",
    contextBlock,
  ].join("\n");

  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_QA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        top_p: 0.9,
      },
    }),
  });

  if (!res.ok) return null;

  const json = (await res.json()) as { response?: string };
  return json.response?.trim() || null;
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
    const score = qVec ? semantic * 0.72 + keyword * 0.28 : keyword;

    return { emb, chunk, semantic, keyword, score };
  });

  const ranked = scored
    .filter((r) => r.chunk)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(10, topK)));

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

function getCacheKey(question: string, topK: number): string {
  return `${normalizeText(question)}|k=${topK}`;
}

export async function answerQuestion(question: string, topK = 5): Promise<KbAnswerResult> {
  const key = getCacheKey(question, topK);
  const now = Date.now();
  const hit = answerCache.get(key);
  if (hit && hit.expiresAt > now) {
    return { ...hit.value, cached: true };
  }

  const retrieve = await retrieveKnowledge(question, topK);

  let provider: "ollama" | "extractive" = "extractive";
  let answer = buildExtractiveAnswer(question, retrieve);

  if (retrieve.citations.length > 0 && retrieve.confidence >= 0.22) {
    try {
      const llmAnswer = await generateWithOllama(question, retrieve);
      if (llmAnswer) {
        provider = "ollama";
        answer = llmAnswer;
      }
    } catch {
      // Keep extractive fallback.
    }
  }

  const result: KbAnswerResult = {
    ...retrieve,
    answer,
    provider,
    cached: false,
  };

  answerCache.set(key, {
    expiresAt: now + ANSWER_CACHE_TTL_MS,
    value: result,
  });

  return result;
}
