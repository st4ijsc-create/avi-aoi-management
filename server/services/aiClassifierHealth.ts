/**
 * AI Classifier Health — doc 69 Wave 6 (F1)
 *
 * The quality-gate / A-B testing / active-learning superstructure is built, but
 * there is NO trained defect classifier on disk by default — only the DINOv2
 * feature extractor. Every one of those subsystems is silently INERT until an
 * ACTIVE classifier exists (`ai_models.status = 'ACTIVE'` with
 * `modelType = 'classification'`). Operators had no way to see this.
 *
 * This service answers ONE question honestly: "is there an ACTIVE defect
 * classifier right now?" Fail-safe: any lookup error reports
 * `hasActiveClassifier: false` with the error in `reason` — it NEVER fabricates
 * a healthy state.
 */
import fs from "fs";
import path from "path";
import { getAiModels } from "../db/ai";
import { isEmbeddingHeadEnabled, isEmbeddingHeadModel } from "./ai/embeddingHead";
import type { AiModel } from "../../drizzle/schema";

export interface ClassifierHealthResult {
  hasActiveClassifier: boolean;
  /** Human-readable explanation — always present, even when healthy. */
  reason: string;
  activeModelId?: number;
  activeModelCode?: string;
  activeVersion?: string | null;
  checkedAt: string;
}

/** Where the WS-1/AOI-C seeded DINOv2 head artifact lives (doc 24 Wave-3). */
const SEEDED_HEAD_PATH = path.join(
  process.cwd(), "uploads", "models", "heads", "aoi-defect-head-dinov2", "v1.0.0", "head.json",
);

export interface ClassifierHealthDeps {
  /** Injectable for tests (defaults to `getAiModels({ modelType, status: "ACTIVE" })`). */
  listActiveClassifierModels?: (modelType: string) => Promise<AiModel[]>;
  /** Injectable for tests (defaults to a real fs.existsSync check). */
  seededHeadExists?: () => boolean;
}

/**
 * Whether an ACTIVE defect-classifier model exists in the registry today.
 *
 * Scope: `modelType = "classification"` rows (the codebase's convention for
 * defect classifiers — see `ensureHeadModelRow` in embeddingHead.ts and
 * AIModelManagementPage's default modelType), `status = "ACTIVE"`.
 *
 * A registered+ACTIVE embedding-head model additionally requires
 * `AOI_DL_HEAD_ENABLED=true` to actually be served by `aiInferenceEngine.
 * runInference` — when the flag is off, the row is ACTIVE in the registry but
 * inference never reaches it, so this reports `false` with an explicit reason
 * rather than a misleadingly "healthy" `true`.
 */
export async function checkActiveClassifierHealth(
  deps: ClassifierHealthDeps = {},
): Promise<ClassifierHealthResult> {
  const checkedAt = new Date().toISOString();
  const listActiveClassifierModels =
    deps.listActiveClassifierModels
    ?? ((modelType: string) => getAiModels({ modelType, status: "ACTIVE" }) as Promise<AiModel[]>);
  const seededHeadExists = deps.seededHeadExists ?? (() => fs.existsSync(SEEDED_HEAD_PATH));

  try {
    const active = await listActiveClassifierModels("classification");

    if (active.length > 0) {
      const m = active[0]!;
      if (isEmbeddingHeadModel(m) && !isEmbeddingHeadEnabled()) {
        return {
          hasActiveClassifier: false,
          reason:
            `Head classifier "${m.code}" is registered ACTIVE, but AOI_DL_HEAD_ENABLED is off — ` +
            `inference still serves the plain ONNX path, so predictions never reach it. ` +
            `Enable AOI_DL_HEAD_ENABLED to make it live.`,
          activeModelId: m.id,
          activeModelCode: m.code,
          activeVersion: m.currentVersion,
          checkedAt,
        };
      }
      return {
        hasActiveClassifier: true,
        reason: `Active classifier "${m.code}" v${m.currentVersion ?? "?"}.`,
        activeModelId: m.id,
        activeModelCode: m.code,
        activeVersion: m.currentVersion,
        checkedAt,
      };
    }

    const seedExists = seededHeadExists();
    return {
      hasActiveClassifier: false,
      reason: seedExists
        ? "No ACTIVE defect-classifier model. A seeded DINOv2 head artifact exists on disk but is not " +
          "registered/activated yet — bootstrap the first classifier."
        : "No ACTIVE defect-classifier model exists. The quality-gate / A-B testing / active-learning " +
          "pipeline is inert (nothing to validate against) until a classifier is bootstrapped.",
      checkedAt,
    };
  } catch (err) {
    // Fail-safe: never claim health on an error — surface it honestly instead.
    return {
      hasActiveClassifier: false,
      reason: `Classifier health check failed: ${err instanceof Error ? err.message : String(err)}`,
      checkedAt,
    };
  }
}
