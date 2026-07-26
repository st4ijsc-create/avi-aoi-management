/**
 * D3 (doc69 Giai đoạn 4/Wave 3) — CARD-REQUIRED activation gate.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────────
 * NOT the LLM-decision audit (ai_llm_audit / server/services/ai/aiLlmAudit.ts, G2-5) —
 * that records HIGH-RISK LLM calls (rca/report/vision), unrelated to model-registry
 * governance. NOT a rebuild of the eval quality gate — aiModelService.ts's
 * `evalGatePassed`/`activateModelVersionManual` already enforces `evalReport.gate.pass`
 * and that is untouched; this module adds a SECOND, independent requirement (a
 * complete + approved governance card) to the SAME gated entry point. NOT the OLDER
 * `server/services/aiModelCard.ts` (B5.4) either — that is an auto-generated, ungated
 * documentation card (role/source/quant, stored in `ai_models.metadata.modelCard`) for
 * the LLM/vision brain portfolio; it has no approval concept and never blocks anything.
 * This module's `ai_model_cards` table is a NEW, separate, human-approved record.
 *
 * ── Flag + fail-safe discipline ──────────────────────────────────────────────────
 * `AI_MODEL_CARD_REQUIRED` defaults OFF. When off, `evaluateCardGate()` returns
 * `{enforced:false, satisfied:true}` WITHOUT ever touching the database — activation
 * behaviour is byte-identical to pre-D3. When on, the ai_model_cards table (migration
 * 0303) may still be unmigrated: the ONLY expected failure — pg error 42P01 ("relation
 * does not exist") — is caught and ALSO degrades to `{enforced:false, satisfied:true}`
 * (same guard discipline as aiDatasetBuilder.pinDatasetContentHash's 42703 catch / D2's
 * getProfile()). Any OTHER database error is a real failure and is rethrown.
 */
import { getModelCardByModelId } from "../db/ai";
import type { AiModelCard } from "../../drizzle/schema";

/** Card-required activation gate flag. Default OFF — see module doc comment. */
export function isModelCardRequired(): boolean {
  const v = String(process.env.AI_MODEL_CARD_REQUIRED ?? "false").toLowerCase();
  return v === "true" || v === "1";
}

/**
 * ModelCard §12.2 governance fields that must be populated before a card counts as
 * "complete" (distinct from "approved" — see {@link isCardApproved}). `notes` is
 * deliberately free-form/optional (per the brief) and NOT in this list.
 */
export const REQUIRED_CARD_FIELDS = [
  "intendedUse",
  "trainingDataDesc",
  "evalSummary",
  "limitations",
  "riskClass",
  "owner",
] as const satisfies readonly (keyof AiModelCard)[];

function nonEmpty(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** All REQUIRED_CARD_FIELDS populated with non-empty strings. */
export function isCardComplete(card: AiModelCard | null | undefined): boolean {
  if (!card) return false;
  return REQUIRED_CARD_FIELDS.every((f) => nonEmpty(card[f]));
}

/** approvedBy + approvedAt both set (a human explicitly signed off the card). */
export function isCardApproved(card: AiModelCard | null | undefined): boolean {
  if (!card) return false;
  return card.approvedBy != null && card.approvedAt != null;
}

function isMissingTableError(e: unknown): boolean {
  return (e as { code?: string } | null | undefined)?.code === "42P01";
}

export interface ModelCardStatus {
  /** false when ai_model_cards isn't migrated yet — callers must degrade, not throw. */
  tableAvailable: boolean;
  card: AiModelCard | null;
}

/**
 * Fetch the model's governance card, fail-safe against an unmigrated table. See the
 * module doc comment for the exact 42P01-only catch discipline.
 */
export async function getModelCardStatus(modelId: number): Promise<ModelCardStatus> {
  try {
    const card = await getModelCardByModelId(modelId);
    return { tableAvailable: true, card };
  } catch (e) {
    if (isMissingTableError(e)) {
      return { tableAvailable: false, card: null };
    }
    throw e;
  }
}

export interface CardGateResult {
  /**
   * Whether the card requirement is ACTUALLY enforced for this call (flag ON AND the
   * table is migrated). When false, `satisfied` is forced true and the caller MUST
   * behave exactly as if D3 did not exist (flag off, or degraded due to missing table).
   */
  enforced: boolean;
  satisfied: boolean;
  reason?: string;
  card: AiModelCard | null;
}

/**
 * Evaluate the card-required activation gate for a model — the D3 counterpart to
 * aiModelService.ts's `evalGatePassed`. Mirrors its {pass/fail + reason} shape so
 * `activateModelVersionManual` can AND the two gates together and mirror the SAME
 * `{force, reason}` override for both.
 */
export async function evaluateCardGate(modelId: number): Promise<CardGateResult> {
  if (!isModelCardRequired()) {
    return { enforced: false, satisfied: true, card: null };
  }

  const status = await getModelCardStatus(modelId);
  if (!status.tableAvailable) {
    return {
      enforced: false,
      satisfied: true,
      reason: "ai_model_cards table not migrated (apply migration 0303) — card requirement degraded to OFF",
      card: null,
    };
  }

  if (!status.card) {
    return {
      enforced: true,
      satisfied: false,
      reason: "No model card exists for this model — create and approve one before activating.",
      card: null,
    };
  }

  if (!isCardComplete(status.card)) {
    return {
      enforced: true,
      satisfied: false,
      reason: "Model card is incomplete (missing required governance fields) — complete and approve it before activating.",
      card: status.card,
    };
  }

  if (!isCardApproved(status.card)) {
    return {
      enforced: true,
      satisfied: false,
      reason: "Model card has not been approved — approve it before activating.",
      card: status.card,
    };
  }

  return { enforced: true, satisfied: true, card: status.card };
}
