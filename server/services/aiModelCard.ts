/**
 * AI Model Card — B5.3/B5.4 Governance
 *
 * A MODEL CARD is the standardized governance record for every model the brain
 * uses. It documents role/tier, provenance, quantization, context window,
 * intended use, limitations, an eval summary and a freshness timestamp — the
 * minimum needed for an EU-AI-Act-style "technical documentation + transparency"
 * trail (see docs/ECOSYSTEM/PHASE4_AI_GOVERNANCE.md).
 *
 * Storage: cards for DB-registered models (ai_models) are persisted into the
 * existing `ai_models.metadata` JSON column under the `modelCard` key (additive,
 * no migration). The current Qwen3 portfolio is configured via GGUF env vars and
 * is NOT necessarily a row in ai_models — so this module ALSO ships a static seed
 * catalog (PORTFOLIO_CARDS) that is always listable, and is upserted into matching
 * ai_models rows when one exists (matched by `code`).
 *
 * Auditability linkage (B0): every inference decision is already auditable —
 * aiModelRouter.recordDecision logs tier, the chosen modelId and reason on each
 * route, and inference_results persists modelId/modelVersion/processingTimeMs/
 * confidence/topLabel per call. The model card closes the loop by giving each of
 * those modelIds a human-readable provenance + intended-use record.
 *
 * Offline-first, additive, fail-safe. No flags — describing models is always safe.
 */

import { getAiModels, getAiModelById, updateAiModel } from "../db/ai";

export type ModelTier = "deep" | "fast" | "vision" | "embedding" | "image-vector" | "reranker";

export interface ModelCard {
  /** Stable identifier — ai_models.code, or a portfolio key for env-configured GGUF models. */
  code: string;
  name: string;
  /** Cognitive-ladder role/tier this model serves (A4). */
  role: ModelTier;
  /** Where the weights came from (HF repo / vendor). */
  source: string;
  /** Quantization / precision (e.g. "UD-Q4_K_XL", "F16", "ONNX-fp32"). */
  quant: string | null;
  /** Max context window in tokens (LLMs) or null for vision-embedding models. */
  contextSize: number | null;
  /** What the model is meant to be used for. */
  intendedUse: string;
  /** Known limitations / out-of-scope uses (governance-critical). */
  limitations: string[];
  /** Short eval summary (free text + optional metrics snapshot). */
  evalSummary: string;
  /** Optional structured metrics (accuracy/latency/etc.) when available. */
  evalMetrics?: Record<string, unknown>;
  /** ISO timestamp this card was last (re)generated. */
  lastUpdated: string;
  /** Provenance of the card itself. */
  generatedBy: "seed" | "auto";
}

/**
 * Seed cards for the CURRENT Qwen3 portfolio (doc 04 §0). These are env-configured
 * GGUF/ONNX models that may not have an ai_models row; they are always listable and
 * are the source of truth for the brain's foundation models.
 */
export const PORTFOLIO_CARDS: ModelCard[] = [
  {
    code: "qwen3-30b-a3b-instruct",
    name: "Qwen3-30B-A3B-Instruct-2507",
    role: "deep",
    source: "Hugging Face: Qwen/Qwen3-30B-A3B-Instruct-2507 (Unsloth UD GGUF)",
    quant: "UD-Q4_K_XL (MoE, ~3B active of 30B)",
    contextSize: 262144,
    intendedUse:
      "Tier 2 reasoning: root-cause analysis, executive report synthesis, hard KB QA, agentic planning (HITL). Default deep model (GGUF_DEFAULT_MODEL).",
    limitations: [
      "Heavy: ~17.7GB VRAM resident — competes with VL-8B for the 32GB budget (LRU eviction governs).",
      "Cold-load ~6s breaks sub-700ms latency budgets — router pins Tier 1 for low-latency tasks.",
      "Local-only; no cloud fallback. Not for free-form SQL — analytics go through whitelisted tools.",
    ],
    evalSummary: "166 tok/s on RTX 5090 (sm_120, CUDA build). Verified E2E via aiModelRouter Tier 2.",
    evalMetrics: { throughputTokPerSec: 166, vramGB: 17.7 },
    lastUpdated: "",
    generatedBy: "seed",
  },
  {
    code: "qwen3-4b-instruct",
    name: "Qwen3-4B-Instruct-2507",
    role: "fast",
    source: "Hugging Face: Qwen/Qwen3-4B-Instruct-2507 (Unsloth UD GGUF)",
    quant: "UD-Q4_K_XL",
    contextSize: 262144,
    intendedUse:
      "Tier 1 fast cognition: intent classification, extraction, summarization, tool selection, short chat, simple NL→SQL. Fast model (GGUF_FAST_MODEL).",
    limitations: [
      "Lower reasoning depth than 30B — escalate hard tasks to Tier 2 via the router.",
      "JSON/tool reliability depends on GBNF grammar constraints.",
    ],
    evalSummary: "178 tok/s on RTX 5090, ~1.2s cold-load. Verified E2E (intentClassifier + chat).",
    evalMetrics: { throughputTokPerSec: 178, vramGB: 2.5 },
    lastUpdated: "",
    generatedBy: "seed",
  },
  {
    code: "qwen3-vl-8b-instruct",
    name: "Qwen3-VL-8B-Instruct",
    role: "vision",
    source: "Hugging Face: Qwen/Qwen3-VL-8B-Instruct + mmproj-F16 (llama.cpp vision sidecar)",
    quant: "GGUF + mmproj-F16",
    contextSize: 32768,
    intendedUse:
      "Tier 3 perception: defect description, visual QA, OCR on AOI images. Runs in a GPU sidecar (GGUF_VISION_MODEL); gated by Tier-0 anomaly so only suspect images escalate.",
    limitations: [
      "1.2s/image — must be anomaly-gated (≤~10% of images) to stay within line throughput (20k/shift).",
      "Separate process (~6GB VRAM); not for bulk OCR of every image.",
    ],
    evalSummary: "1.2s/image on RTX 5090 (vs 8.9s CPU, ~7×). Verified E2E via vision sidecar.",
    evalMetrics: { latencyMsPerImage: 1200, vramGB: 6 },
    lastUpdated: "",
    generatedBy: "seed",
  },
  {
    code: "qwen3-embedding-0.6b",
    name: "Qwen3-Embedding-0.6B",
    role: "embedding",
    source: "Hugging Face: Qwen/Qwen3-Embedding-0.6B (F16 GGUF)",
    quant: "F16 (1024-d)",
    contextSize: 32768,
    intendedUse:
      "RAG / knowledge-base text embedding (GGUF_EMBED_MODEL). Powers KB retrieval and auto-ingest of incidents.",
    limitations: [
      "1024-d text embeddings only; image similarity uses DINOv2 instead.",
      "Quality bound by chunking; reranker recommended for precision (B2.2).",
    ],
    evalSummary: "~1.2GB resident. Used by the bruteforce-file RAG path (1196 chunks).",
    evalMetrics: { dim: 1024, vramGB: 1.2 },
    lastUpdated: "",
    generatedBy: "seed",
  },
  {
    code: "dinov2-small",
    name: "DINOv2-small (384-d)",
    role: "image-vector",
    source: "Meta DINOv2-small exported to ONNX (model registry id=3)",
    quant: "ONNX-fp32",
    contextSize: null,
    intendedUse:
      "Tier-0 image vectorization: embed-at-ingest (384-d) for image search + PatchCore anomaly memory bank. Runs on every AOI image.",
    limitations: [
      "Self-supervised features — not a defect classifier by itself; pairs with PatchCore / a trained head.",
      "Use DINOv2-base (768-d, id=4) when small underperforms on harder products.",
    ],
    evalSummary: "~150ms/image. Handles 20k images/shift at ~10% of one worker. Verified E2E.",
    evalMetrics: { latencyMsPerImage: 150, dim: 384 },
    lastUpdated: "",
    generatedBy: "seed",
  },
];

/** Build a card for a DB-registered model (ai_models row), filling sane defaults. */
export function buildCardForModel(model: {
  id: number;
  code: string;
  name: string;
  modelType: string;
  format: string;
  currentVersion?: string | null;
  labels?: string[] | null;
  accuracy?: unknown;
  metadata?: unknown;
}): ModelCard {
  const meta = (model.metadata as Record<string, unknown> | null) ?? {};
  const existing = (meta.modelCard as Partial<ModelCard> | undefined) ?? undefined;

  const role: ModelTier =
    model.modelType === "embedding" ? "embedding"
    : model.modelType === "segmentation" || model.modelType === "detection" ? "vision"
    : "image-vector";

  const labels = model.labels ?? [];
  return {
    code: model.code,
    name: model.name,
    role: (existing?.role as ModelTier) ?? role,
    source: existing?.source ?? `Registered model (${model.format}, id=${model.id})`,
    quant: existing?.quant ?? (model.format === "ONNX" ? "ONNX" : model.format),
    contextSize: existing?.contextSize ?? null,
    intendedUse:
      existing?.intendedUse ??
      `${model.modelType} for AOI inspection${labels.length ? ` over classes [${labels.slice(0, 8).join(", ")}${labels.length > 8 ? ", …" : ""}]` : ""}.`,
    limitations: existing?.limitations ?? [
      "Performance valid only for the product/line distribution it was trained on — watch drift (aiDriftMonitor).",
      "Activation gated by the eval quality gate; do not deploy a version that fails the gate.",
    ],
    evalSummary:
      existing?.evalSummary ??
      (model.accuracy != null
        ? `Current version ${model.currentVersion ?? "?"} accuracy ${model.accuracy}%.`
        : "No eval recorded yet — run aiEvalHarness.compareBeforeAfter."),
    evalMetrics: existing?.evalMetrics,
    lastUpdated: new Date().toISOString(),
    generatedBy: "auto",
  };
}

/**
 * Generate and PERSIST a model card for a single ai_models row, merging it into
 * the row's `metadata.modelCard`. Returns the generated card (or null if the
 * model is missing / DB unavailable).
 */
export async function generateModelCard(modelId: number): Promise<ModelCard | null> {
  const model = await getAiModelById(modelId);
  if (!model) return null;
  const card = buildCardForModel(model as any);
  try {
    const meta = ((model.metadata as Record<string, unknown> | null) ?? {});
    await updateAiModel(modelId, { metadata: { ...meta, modelCard: card } as any });
  } catch (err) {
    // Persisting is best-effort; still return the card so callers can display it.
    console.warn(`[aiModelCard] persist failed for model ${modelId}:`, (err as Error)?.message ?? err);
  }
  return card;
}

/**
 * Seed/refresh the Qwen3 portfolio cards. For each PORTFOLIO_CARDS entry, if an
 * ai_models row exists with the same `code`, the card is persisted into that
 * row's metadata; otherwise the seed card is returned as-is (it remains listable
 * via listModelCards). Idempotent; safe to call repeatedly. Returns the cards
 * (with lastUpdated stamped now).
 */
export async function seedPortfolioCards(): Promise<ModelCard[]> {
  const now = new Date().toISOString();
  const cards = PORTFOLIO_CARDS.map((c) => ({ ...c, lastUpdated: now }));

  let registered: Awaited<ReturnType<typeof getAiModels>> = [];
  try {
    registered = await getAiModels({ limit: 500 });
  } catch {
    return cards; // DB unavailable → seeds are still meaningful documentation.
  }
  const byCode = new Map(registered.map((m) => [m.code, m]));

  for (const card of cards) {
    const row = byCode.get(card.code);
    if (!row) continue;
    try {
      const meta = ((row.metadata as Record<string, unknown> | null) ?? {});
      await updateAiModel(row.id, { metadata: { ...meta, modelCard: card } as any });
    } catch {
      /* best-effort */
    }
  }
  return cards;
}

/**
 * List all model cards: the Qwen3 portfolio seed cards PLUS a card for every
 * registered ai_models row (read from metadata.modelCard when present, else
 * generated on the fly). De-duplicated by `code` (registered rows win, except
 * where a portfolio seed has the same code — then the persisted/seed merge wins).
 */
export async function listModelCards(): Promise<ModelCard[]> {
  const now = new Date().toISOString();
  const out = new Map<string, ModelCard>();

  for (const c of PORTFOLIO_CARDS) out.set(c.code, { ...c, lastUpdated: c.lastUpdated || now });

  let registered: Awaited<ReturnType<typeof getAiModels>> = [];
  try {
    registered = await getAiModels({ limit: 500 });
  } catch {
    return Array.from(out.values());
  }

  for (const m of registered) {
    const meta = (m.metadata as Record<string, unknown> | null) ?? {};
    const persisted = meta.modelCard as ModelCard | undefined;
    const card = persisted ?? buildCardForModel(m as any);
    out.set(m.code, card);
  }

  return Array.from(out.values());
}
