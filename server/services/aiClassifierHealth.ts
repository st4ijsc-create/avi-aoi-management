/**
 * AI Classifier Health — doc 69 Wave 6 (F1), servability fixed in the F1 review.
 *
 * The quality-gate / A-B testing / active-learning superstructure is built, but
 * there is NO trained defect classifier on disk by default — only the DINOv2
 * feature extractor. Every one of those subsystems is silently INERT until an
 * ACTIVE classifier exists (`ai_models.status = 'ACTIVE'` with
 * `modelType = 'classification'`). Operators had no way to see this.
 *
 * This service answers ONE question honestly: "is there an ACTIVE defect
 * classifier that aiInferenceEngine.runInference can ACTUALLY dispatch right
 * now?" — registered-and-ACTIVE alone is NOT enough (see the F1-review fix):
 * an ACTIVE `format:"CUSTOM"` artifact with no `metadata.headKind` (e.g. a
 * plain aiLocalTraining few-shot/transfer/incremental classifier) or an ACTIVE
 * DINOv2 embedding-head with `AOI_DL_HEAD_ENABLED` off both register fine but
 * make `runInference` THROW — this check must report `false` for both, not
 * just the flag-off case. Servability is decided by
 * `embeddingHead.isServableByInferenceEngine` — the SAME predicate documented
 * to mirror `runInference`'s real dispatch order (single source of truth; not
 * re-derived here). Fail-safe: any lookup error reports
 * `hasActiveClassifier: false` with the error in `reason` — it NEVER fabricates
 * a healthy state.
 */
import fs from "fs";
import path from "path";
import { getAiModels } from "../db/ai";
import { isEmbeddingHeadEnabled, isEmbeddingHeadModel, isServableByInferenceEngine } from "./ai/embeddingHead";
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
 * Whether an ACTIVE defect-classifier model exists in the registry today AND is
 * in a shape `aiInferenceEngine.runInference` can actually dispatch.
 *
 * Scope: `modelType = "classification"` rows (the codebase's convention for
 * defect classifiers — see `ensureHeadModelRow` in embeddingHead.ts and
 * AIModelManagementPage's default modelType), `status = "ACTIVE"`.
 *
 * F1-review FIX 3 — a DB can hold MULTIPLE classifier `code`s, each with its own
 * ACTIVE version (e.g. a stale experiment left ACTIVE alongside a genuinely
 * servable one). Inspecting only the first row risked reporting the wrong
 * verdict either way — a false "unhealthy" when a later row IS servable, or a
 * false "healthy" when the first row happens to be servable but others aren't.
 * This evaluates EVERY ACTIVE row and reports `true` if ANY of them is
 * servable (that's the one `runInference` will actually serve predictions
 * from); `false`, with an honest aggregate reason, only when NONE are.
 *
 * F1-review FIX 2 — "servable" is decided by `isServableByInferenceEngine`
 * (embeddingHead.ts), the single predicate that mirrors `runInference`'s real
 * dispatch order: a registered+ACTIVE embedding-head additionally requires
 * `AOI_DL_HEAD_ENABLED=true`; a registered+ACTIVE `format:"CUSTOM"` artifact
 * that ISN'T an embedding-head (e.g. a plain few-shot/transfer/incremental
 * classifier) is never dispatched at all — both report `false` here instead of
 * a misleadingly "healthy" `true`.
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
      const evaluated = active.map((m) => ({ model: m, servable: isServableByInferenceEngine(m) }));
      const servable = evaluated.find((e) => e.servable);

      if (servable) {
        const m = servable.model;
        const othersCount = evaluated.length - 1;
        return {
          hasActiveClassifier: true,
          reason: othersCount > 0
            ? `Active classifier "${m.code}" v${m.currentVersion ?? "?"}. (${othersCount} other ACTIVE ` +
              `classifier row(s) also exist; only this one is actually servable.)`
            : `Active classifier "${m.code}" v${m.currentVersion ?? "?"}.`,
          activeModelId: m.id,
          activeModelCode: m.code,
          activeVersion: m.currentVersion,
          checkedAt,
        };
      }

      // NONE of the ACTIVE rows are servable — never report "healthy" just
      // because something is registered ACTIVE. Give an honest, specific
      // reason for the common cases (all flag-off heads vs. never-dispatched
      // artifacts), and fall back to a generic one for a mix of both.
      const first = evaluated[0]!.model;
      const codes = Array.from(new Set(evaluated.map((e) => e.model.code))).join(", ");
      const allFlagOffHeads = evaluated.every((e) => isEmbeddingHeadModel(e.model)) && !isEmbeddingHeadEnabled();
      const reason = allFlagOffHeads
        ? `${evaluated.length} ACTIVE defect-classifier(s) registered (${codes}) ${evaluated.length > 1 ? "are" : "is"} ` +
          `DINOv2 embedding-head model(s), but AOI_DL_HEAD_ENABLED is off — inference still serves the plain ` +
          `ONNX path, so predictions never reach ${evaluated.length > 1 ? "them" : "it"}. Enable AOI_DL_HEAD_ENABLED ` +
          `to make ${evaluated.length > 1 ? "them" : "it"} live.`
        : `${evaluated.length} ACTIVE defect-classifier(s) registered (${codes}), but none are in a shape ` +
          `aiInferenceEngine.runInference can dispatch — calling it would throw, not predict. Bootstrap or ` +
          `activate a servable classifier instead (a DINOv2 embedding-head with AOI_DL_HEAD_ENABLED on, or an ` +
          `ONNX model).`;
      return {
        hasActiveClassifier: false,
        reason,
        activeModelId: first.id,
        activeModelCode: first.code,
        activeVersion: first.currentVersion,
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
