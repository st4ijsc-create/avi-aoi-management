/**
 * Doc 20 §3/§5 (I3a-1) — URSim DEPLOY TARGET for the programming pipeline.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Lets an IR/URScript program be deployed to a configured URSim endpoint through the
 * EXISTING gated deploy flow — treating URSim as a SAFE VIRTUAL DEVICE (no physical arm).
 * It REUSES the identical gate as programmingService.deployBuild:
 *
 *   realDeploy  ⇔  URSIM_ENABLED && DPC_DEPLOY_ENABLED && HITL confirmedBy present
 *
 * When the gate is OPEN we run validateUrscriptOnUrsim (send program → poll state) and
 * record status 'deployed' (accepted+running) / 'verified' (running confirmed) / 'failed'.
 * When the gate is CLOSED (any flag off, or no sign-off) we record 'simulated' and NEVER
 * open a socket — exactly the programmingService dry-run semantics. Every attempt writes
 * an append-only program_deployments row with stage 'staging' + detailJson.target='ursim'
 * (distinct from a real-device deploy; no new enum / no migration). Idempotency mirrors
 * deployBuild (a terminal row for the key is returned as-is).
 *
 * This opens NO new control path: the gate lives here (same flags), the transport is the
 * URSim client, and the audit trail is the same program_deployments ledger.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { programDeployments } from "../../../../drizzle/schema";
import { dpcDeployEnabled } from "../../programming/programmingService";
import { validateUrscriptOnUrsim, ursimEnabled, type UrsimValidationResult } from "./ursimHarness";
import type { UrsimEndpoint } from "./ursimClient";

export interface UrsimDeployRequest {
  /** The URScript TEXT (as produced by the D1 transpiler / a build). */
  urscript: string;
  endpoint: UrsimEndpoint;
  /** Ties the deploy to a build/project for the audit row (optional in ad-hoc validation). */
  buildId?: number;
  projectId?: number;
  idempotencyKey: string;
  /** HITL provenance — the human confirming (== sign-off), mirrors DeployRequest. */
  hitl: { actionId: string; requestedBy: number; confirmedBy?: number };
}

export interface UrsimDeployResult {
  status: "simulated" | "deployed" | "verified" | "failed" | "rejected";
  simulated: boolean;
  deploymentId?: number;
  validation?: UrsimValidationResult;
  reason?: string;
}

/** True ⇔ the URSim deploy path is allowed to touch the (virtual) controller. */
export function ursimRealDeployAllowed(signedOff: boolean): boolean {
  return ursimEnabled() && dpcDeployEnabled() && signedOff;
}

async function record(
  req: UrsimDeployRequest,
  status: UrsimDeployResult["status"],
  simulated: boolean,
  detail: Record<string, unknown>,
  error?: string,
): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  try {
    // Idempotency — a prior terminal row for this key is returned as-is by the caller;
    // here we only INSERT (the caller checked). program_deployments requires build/project
    // (notNull) — ad-hoc validation with no build uses 0 sentinels, marked in detailJson.
    const [row] = await db
      .insert(programDeployments)
      .values({
        buildId: req.buildId ?? 0,
        projectId: req.projectId ?? 0,
        deviceId: null,
        stage: "staging",
        status,
        simulated,
        signedOffBy: req.hitl.confirmedBy ?? null,
        requestedBy: req.hitl.requestedBy,
        idempotencyKey: req.idempotencyKey,
        detailJson: { target: "ursim", ...detail },
        error: error ?? null,
      })
      .returning({ id: programDeployments.id });
    return row?.id;
  } catch (err) {
    console.error("[URSim] failed to record deployment:", (err as Error)?.message ?? err);
    return undefined;
  }
}

/**
 * Deploy a URScript program to a URSim endpoint through the gate. Same gate/idempotency
 * semantics as programmingService.deployBuild; the ONLY device path is the URSim client.
 */
export async function deployUrscriptToUrsim(req: UrsimDeployRequest): Promise<UrsimDeployResult> {
  const db = await getDb();

  // Idempotency — return a prior terminal deployment for this key as-is.
  if (db) {
    try {
      const [prior] = await db
        .select()
        .from(programDeployments)
        .where(eq(programDeployments.idempotencyKey, req.idempotencyKey))
        .limit(1);
      if (prior) {
        return {
          status: prior.status as UrsimDeployResult["status"],
          simulated: prior.simulated,
          deploymentId: prior.id,
          reason: "idempotent: prior deployment returned as-is",
        };
      }
    } catch {
      /* fall through — a read failure must not fabricate a deploy */
    }
  }

  const signedOff = req.hitl.confirmedBy != null;

  // GATE CLOSED → 'simulated'. No socket is opened; the URSim client is never invoked.
  if (!ursimRealDeployAllowed(signedOff)) {
    const reason = !ursimEnabled()
      ? "URSIM_ENABLED is off (default) — recorded as simulated."
      : !dpcDeployEnabled()
        ? "DPC_DEPLOY_ENABLED is off (default) — recorded as simulated."
        : "No HITL sign-off (confirmedBy) — recorded as simulated.";
    const deploymentId = await record(req, "simulated", true, { reason, sent: false });
    return { status: "simulated", simulated: true, deploymentId, reason };
  }

  // GATE OPEN → send to the (virtual) controller + validate execution. Honest on failure.
  const validation = await validateUrscriptOnUrsim(req.urscript, req.endpoint);
  let status: UrsimDeployResult["status"];
  if (validation.error) {
    status = "failed";
  } else if (validation.running) {
    status = "verified"; // program confirmed executing on the controller
  } else if (validation.accepted) {
    status = "deployed"; // controller accepted (running state not yet confirmed)
  } else {
    status = "failed"; // sent but the controller did not accept/run — a broken transpile
  }
  const deploymentId = await record(
    req,
    status,
    false,
    { validation },
    validation.error,
  );
  return { status, simulated: false, deploymentId, validation, reason: validation.error };
}
