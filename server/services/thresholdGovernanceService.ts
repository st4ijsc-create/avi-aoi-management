/**
 * Doc 31 Đợt A (OP1 / OP2, decision #4) — Threshold governance guards.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TWO holes in threshold governance are closed here, shared by every write path
 * so the rules cannot drift between call sites:
 *
 *   (1) SoD (Segregation of Duties) on the approval endpoint — the person who
 *       REQUESTED a threshold change may not be the person who APPROVES it.
 *       `assertApprovalSoD` mirrors the DB-enforced golden/recipe pattern
 *       (inspectionProgramService.approveRelease, goldenSample.ts:255).
 *
 *   (2) Lifecycle gate on the DIRECT limit-edit paths (measurementPoint.update,
 *       spcAnalysisRouter.saveSpecLimits). Decision #4 (§8): the approval queue
 *       is NOT optional for a product that is live. The gate resolves the owning
 *       product's lifecycle + whether it already has a released inspection
 *       program and decides:
 *
 *         ┌────────────────────────────────────────────┬──────────────────────┐
 *         │ Product state                              │ Direct limit edit    │
 *         ├────────────────────────────────────────────┼──────────────────────┤
 *         │ development  AND  no released program       │ ALLOW  (+ audit row) │
 *         │ development  AND  has ≥1 released program    │ BLOCK → approval     │
 *         │ active / eol / archived (any release state) │ BLOCK → approval     │
 *         │ unknown / missing product                   │ BLOCK  (fail-safe)   │
 *         └────────────────────────────────────────────┴──────────────────────┘
 *
 *       Non-limit edits (name / shape / position / …) are NEVER gated — callers
 *       only invoke the gate when a limit-affecting field is actually touched.
 *
 * EMERGENCY OVERRIDE: set THRESHOLD_GATE_ENFORCED=false to let direct edits
 * through on any lifecycle (still audited). Default = enforced (true). This is a
 * break-glass switch only; the SoD check on approve is NOT affected by it.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  measurementPointDefs,
  productModels,
  inspectionProgramReleases,
} from "../../drizzle/schema/product";

// ── enforcement flag (read per-call so tests / ops can toggle at runtime) ─────
export function isThresholdGateEnforced(): boolean {
  return process.env.THRESHOLD_GATE_ENFORCED !== "false";
}

export type ThresholdEditDecision = "direct" | "requires_approval";

export interface ThresholdGateResult {
  decision: ThresholdEditDecision;
  productModelId: number;
  lifecycleStatus: string;
  hasReleasedProgram: boolean;
  /** false when THRESHOLD_GATE_ENFORCED=false (break-glass) — decision is advisory. */
  enforced: boolean;
}

/**
 * SoD guard for the approve / batch-approve path. Throws FORBIDDEN when the
 * approver is the same human that raised the request.
 *
 * NULL/sentinel requester handling: `requestedBy` is a NOT NULL column, but the
 * AI auto-tune scheduler inserts requests with `requestedBy: 0` (a no-human
 * sentinel — see aiThresholdTuneScheduler). Any requester id ≤ 0 (or null) is
 * treated as SYSTEM/non-self and is therefore approvable by a real user.
 */
export function assertApprovalSoD(requestedBy: number | null | undefined, approverId: number): void {
  if (requestedBy != null && requestedBy > 0 && requestedBy === approverId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Segregation of duties: cannot approve your own threshold request",
    });
  }
}

/**
 * Resolve the lifecycle gate for a measurement point (no throw beyond NOT_FOUND
 * when the point itself does not exist). Pure resolution — the router/service
 * decides what to do with the decision.
 */
export async function resolveThresholdEditGate(pointDefId: number): Promise<ThresholdGateResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

  const [point] = await db
    .select()
    .from(measurementPointDefs)
    .where(eq(measurementPointDefs.id, pointDefId))
    .limit(1);
  if (!point) {
    throw new TRPCError({ code: "NOT_FOUND", message: `measurement_point_def ${pointDefId} not found` });
  }

  const productModelId = (point as { productModelId: number }).productModelId;

  const [product] = await db
    .select()
    .from(productModels)
    .where(eq(productModels.id, productModelId))
    .limit(1);

  // Fail-safe: a point whose product cannot be resolved is treated as strict.
  const lifecycleStatus = (product as { lifecycleStatus?: string } | undefined)?.lifecycleStatus ?? "active";

  const releasedRows = await db
    .select()
    .from(inspectionProgramReleases)
    .where(
      and(
        eq(inspectionProgramReleases.productModelId, productModelId),
        eq(inspectionProgramReleases.status, "released"),
      ),
    );
  const hasReleasedProgram = releasedRows.length > 0;

  const decision: ThresholdEditDecision =
    lifecycleStatus === "development" && !hasReleasedProgram ? "direct" : "requires_approval";

  return {
    decision,
    productModelId,
    lifecycleStatus,
    hasReleasedProgram,
    enforced: isThresholdGateEnforced(),
  };
}

/**
 * Doc 31 Đợt C (MP7 / C.3) — PRODUCT-LEVEL variant of the lifecycle gate, used
 * by paths that create/replace many points at once (deep bulk xlsx import)
 * where there is no single existing pointDefId to resolve against. Same rule as
 * {@link resolveThresholdEditGate} but keyed by the product directly.
 *
 * Returns `decision: "requires_approval"` when the product is live (active/eol/
 * archived) OR already has a released inspection program — the caller must then
 * strip limit-bearing fields (or skip) and surface it, exactly like the machine
 * delta-sync path (B.6). A missing product is treated fail-safe (strict).
 */
export async function resolveProductThresholdGate(productModelId: number): Promise<ThresholdGateResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

  const [product] = await db
    .select()
    .from(productModels)
    .where(eq(productModels.id, productModelId))
    .limit(1);

  // Fail-safe: an unknown product is treated as strict (requires approval).
  const lifecycleStatus = (product as { lifecycleStatus?: string } | undefined)?.lifecycleStatus ?? "active";

  const releasedRows = await db
    .select()
    .from(inspectionProgramReleases)
    .where(
      and(
        eq(inspectionProgramReleases.productModelId, productModelId),
        eq(inspectionProgramReleases.status, "released"),
      ),
    );
  const hasReleasedProgram = releasedRows.length > 0;

  const decision: ThresholdEditDecision =
    lifecycleStatus === "development" && !hasReleasedProgram ? "direct" : "requires_approval";

  return {
    decision,
    productModelId,
    lifecycleStatus,
    hasReleasedProgram,
    enforced: isThresholdGateEnforced(),
  };
}

/**
 * Assert a DIRECT limit edit is allowed for `pointDefId`. Returns the gate
 * result when the edit may proceed directly (caller MUST then write an audit
 * row). Throws FORBIDDEN — pointing the caller at the approval queue — when the
 * product is live and the gate is enforced.
 *
 * When THRESHOLD_GATE_ENFORCED=false the block is downgraded to a pass-through
 * (break-glass); the returned `decision` still reports `requires_approval` so
 * the caller can note the override in its audit row.
 */
export async function assertThresholdEditAllowed(pointDefId: number): Promise<ThresholdGateResult> {
  const res = await resolveThresholdEditGate(pointDefId);
  if (res.decision === "requires_approval" && res.enforced) {
    const because = res.hasReleasedProgram
      ? `has a released inspection program`
      : `is '${res.lifecycleStatus}'`;
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        `Product ${because} — threshold changes require approval; ` +
        `submit via the approval queue (Threshold Approvals). ` +
        `Sản phẩm đang hoạt động — thay đổi ngưỡng phải qua hàng đợi duyệt.`,
    });
  }
  return res;
}
