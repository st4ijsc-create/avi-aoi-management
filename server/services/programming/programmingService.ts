/**
 * Doc 09 / Phase D0 — Device Programming & Control (DPC): the programming SERVICE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Owns the artifact → build → simulate → DEPLOY(staged + sign-off + rollback) state
 * machine over the program_* tables, delegating language work to a ProgrammingAdapter.
 *
 * SAFETY (the GATE lives here, not in the router or the adapter):
 *   • validate/build/simulate are always safe (no device I/O).
 *   • deploy() reaches a device ONLY when BOTH:
 *       (1) DPC_DEPLOY_ENABLED is on (default OFF), AND
 *       (2) a human signed off — hitl.confirmedBy is present.
 *     Otherwise the deploy is recorded 'simulated' and the adapter's hardware path is
 *     never invoked. Every attempt writes an append-only program_deployments row.
 *   • Idempotency: a terminal deployment for an idempotencyKey is returned as-is.
 *     doc 80 WS-06 — a 'pending' reservation row (INSERT … ON CONFLICT DO NOTHING) is taken
 *     BEFORE the adapter is invoked, so concurrent callers with the same key never reach the
 *     device twice; a loser gets the existing row (possibly still 'pending').
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash, randomUUID } from "node:crypto";
import { appError } from "../../_core/appError";
import { DbUnavailableError } from "../../_core/dbErrors";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  programProjects,
  programArtifacts,
  programBuilds,
  programSimRuns,
  programDeployments,
  aiPendingActions,
} from "../../../drizzle/schema";
import {
  programmingRegistry,
  type ProgrammingAdapter,
  type ProgrammingKind,
  type ProgramSource,
  type ProgSimScenario,
  type ProgDeployResult,
} from "./programmingAdapter";

export interface DpcUser {
  id: number;
  role: string;
  name?: string | null;
}

// ── Flags (read at runtime so tests/ops can toggle; all default OFF) ──
export function dpcDeployEnabled(): boolean {
  return process.env.DPC_DEPLOY_ENABLED === "true" || process.env.DPC_DEPLOY_ENABLED === "1";
}
export function dpcStreamingEnabled(): boolean {
  return process.env.DPC_STREAMING_ENABLED === "true" || process.env.DPC_STREAMING_ENABLED === "1";
}
export function dpcForceEnabled(): boolean {
  return process.env.DPC_ONLINE_FORCE_ENABLED === "true" || process.env.DPC_ONLINE_FORCE_ENABLED === "1";
}
/**
 * doc 38 T-2 — FOUR-EYES AT THE VERSION. When on, an artifact version must be 'approved'
 * (by a reviewer ≠ author) before it can be built or deployed. Default OFF so applying
 * migration 0236 changes NO behaviour until an operator opts in (staged rollout).
 */
export function dpcVersionReviewEnabled(): boolean {
  return process.env.DPC_VERSION_REVIEW_ENABLED === "true" || process.env.DPC_VERSION_REVIEW_ENABLED === "1";
}
/**
 * doc 40 ENG-F2 — DEPLOY APPROVAL INBOX (two-phase request→approve). Default OFF.
 * When ON, a PRODUCTION real-deploy no longer executes on the requester's click: the
 * requester REQUESTS approval (an 'awaiting_approval' program_deployments row + a REAL
 * ai_pending_actions row) and a SECOND person signs it off from THEIR OWN session
 * (approveDeployment actuation procedure), which then runs the existing deploy gate with
 * the REAL actionId — so the mitsubishi/robot dispatcher's ai_pending_actions re-verify
 * passes instead of NOT_CONFIRMED. Staging / simulated deploys are UNCHANGED. With the
 * flag OFF the legacy four-eyes path (deployBuild) is untouched (applying 0239 is inert).
 */
export function dpcDeployApprovalEnabled(): boolean {
  return process.env.DPC_DEPLOY_APPROVAL_ENABLED === "true" || process.env.DPC_DEPLOY_APPROVAL_ENABLED === "1";
}
/** TTL cho một yêu cầu deploy đang chờ duyệt trước khi hết hạn (7 ngày — dài hơn AI 5' vì duyệt deploy cần thời gian). */
const DEPLOY_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * doc 38 T-2 — VERIFY-AFTER-DOWNLOAD contract.
 *
 * A deploy is only ever recorded 'verified' when we READ THE PROGRAM BACK from the device
 * and it matches — NEVER on the strength of a written audit row. This is the honest seam:
 *   • verified:true  — read-back succeeded AND the hash matches → caller promotes to 'verified'.
 *   • mismatch:true  — read-back succeeded BUT the hash differs → the download did not stick.
 *   • verified:false, mismatch:false — no read-back was possible (device absent / dry-run /
 *     adapter has no upload path). The caller keeps 'deployed' and records the reason; it must
 *     NOT fabricate a 'verified'. `reason` is 'no-device/dry-run' for the HW-absent case.
 */
export interface VerifyResult {
  verified: boolean;
  mismatch: boolean;
  method: "read-back-hash" | "none";
  reason?: string;
  expectedHash?: string;
  actualHash?: string;
}

/**
 * Read a program back from the device via the adapter's upload() path and compare its hash
 * to the built version. Fail-honest: any missing capability / absent device / thrown error
 * → verified:false with a precise reason (never a fake success). This is the ONLY thing that
 * may promote a deployment to 'verified'.
 */
export async function verifyAfterDownload(
  adapter: ProgrammingAdapter,
  ctx: { expectedHash: string; deviceId?: number; endpoint?: string },
): Promise<VerifyResult> {
  // Adapter cannot read a program back (no upload path) → cannot verify. Honest, not faked.
  if (!adapter.capabilities.canUpload || typeof adapter.upload !== "function") {
    return {
      verified: false,
      mismatch: false,
      method: "none",
      reason: "no-device/dry-run: adapter has no read-back (upload) path — deploy recorded but not device-verified.",
      expectedHash: ctx.expectedHash,
    };
  }
  try {
    const readBack = await adapter.upload({ deviceId: ctx.deviceId, endpoint: ctx.endpoint });
    const actualHash = hashContent(readBack.content ?? "");
    const verified = actualHash === ctx.expectedHash;
    return {
      verified,
      mismatch: !verified,
      method: "read-back-hash",
      expectedHash: ctx.expectedHash,
      actualHash,
    };
  } catch (e) {
    // Device absent / read protocol not HW-validated (e.g. zmotion upload() throws) →
    // honest verified:false, NOT a mismatch (we simply could not read it back).
    return {
      verified: false,
      mismatch: false,
      method: "none",
      reason: `no-device/dry-run: read-back failed — ${(e as Error).message}`,
      expectedHash: ctx.expectedHash,
    };
  }
}

/**
 * Validate an artifact's source against its adapter and persist the diagnostics +
 * status. Always safe (no device I/O).
 */
export async function validateArtifact(artifactId: number) {
  const d = await db();
  const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, artifactId)).limit(1);
  if (!art) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programmingArtifact" }, `Artifact ${artifactId} not found`);

  const adapter = programmingRegistry.getAdapter(art.kind as ProgrammingKind);
  const src: ProgramSource = { kind: art.kind as ProgrammingKind, language: art.language, content: art.content ?? "" };
  const result = await adapter.validate(src);

  await d
    .update(programArtifacts)
    .set({
      diagnosticsJson: { diagnostics: result.diagnostics },
      status: result.ok ? "validated" : "draft",
    })
    .where(eq(programArtifacts.id, artifactId));

  return { ok: result.ok, diagnostics: result.diagnostics };
}

/**
 * doc 38 T-2 — FOUR-EYES AT THE VERSION. Record a review DECISION on an artifact version.
 * SoD (segregation of duties): the reviewer must DIFFER from the author (createdBy) — the
 * same two-person control the deploy path enforces, moved UP to the version. Always safe
 * (no device I/O). Idempotent-friendly: re-approving an approved version is a no-op update.
 *
 * Enforcement of "must be approved before build/deploy" is flag-gated
 * (DPC_VERSION_REVIEW_ENABLED); recording the decision itself is always allowed so an
 * operator can pre-populate approvals before flipping the flag on.
 */
export async function reviewArtifact(
  artifactId: number,
  decision: "approved" | "rejected",
  reviewer: DpcUser,
) {
  const d = await db();
  const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, artifactId)).limit(1);
  if (!art) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programmingArtifact" }, `Artifact ${artifactId} not found`);

  // SoD — a version may NOT be self-approved: the reviewer must differ from the author.
  // (createdBy may be null on legacy rows; only enforce when we know the author.)
  if (art.createdBy != null && art.createdBy === reviewer.id) {
    throw new Error(
      "Segregation of duties — người duyệt phiên bản phải KHÁC tác giả (không được tự duyệt phiên bản của chính mình).",
    );
  }

  const [row] = await d
    .update(programArtifacts)
    .set({ reviewStatus: decision, reviewedBy: reviewer.id, reviewedAt: new Date() })
    .where(eq(programArtifacts.id, artifactId))
    .returning();
  return row;
}

/**
 * Compile an artifact → a program_builds row. Always safe (no device I/O).
 *
 * doc 38 T-2 — with DPC_VERSION_REVIEW_ENABLED on, a version that is not 'approved'
 * (four-eyes) cannot be built. Off (default) → unchanged.
 */
export async function buildArtifact(artifactId: number, user: DpcUser) {
  const d = await db();
  const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, artifactId)).limit(1);
  if (!art) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programmingArtifact" }, `Artifact ${artifactId} not found`);

  if (dpcVersionReviewEnabled() && art.reviewStatus !== "approved") {
    throw new Error(
      `Four-eyes — phiên bản #${artifactId} chưa được DUYỆT (reviewStatus="${art.reviewStatus}"). ` +
        "Cần người thứ hai duyệt (reviewer ≠ tác giả) trước khi build/deploy.",
    );
  }

  const adapter = programmingRegistry.getAdapter(art.kind as ProgrammingKind);
  const src: ProgramSource = { kind: art.kind as ProgrammingKind, language: art.language, content: art.content ?? "" };
  const t0 = Date.now();
  const res = await adapter.compile(src);
  const durationMs = Date.now() - t0;

  const [row] = await d
    .insert(programBuilds)
    .values({
      artifactId,
      adapterKind: art.kind,
      status: res.ok ? "ok" : "failed",
      ok: res.ok,
      diagnosticsJson: { diagnostics: res.diagnostics },
      outputRef: res.outputRef ?? null,
      durationMs,
      createdBy: user.id,
    })
    .returning();
  return { ...row, diagnostics: res.diagnostics };
}

/**
 * Simulate a build on a twin/emulator → a program_sim_runs row. Always safe.
 */
export async function simulateBuild(buildId: number, scenario: ProgSimScenario, user: DpcUser) {
  const d = await db();
  const [b] = await d.select().from(programBuilds).where(eq(programBuilds.id, buildId)).limit(1);
  if (!b) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programBuild" }, `Build ${buildId} not found`);

  const adapter = programmingRegistry.getAdapter(b.adapterKind as ProgrammingKind);
  if (!adapter.simulate) {
    throw new Error(`Adapter "${b.adapterKind}" does not support simulation.`);
  }

  // program_builds does not persist BuildResult.meta (moves/ops/rungs/stepList), which
  // adapter.simulate needs. RECOMPILE from the artifact source so the fresh BuildResult
  // carries its meta — deterministic, no schema change, and stays in lock-step with the
  // built artifact.
  const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, b.artifactId)).limit(1);
  if (!art) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programmingArtifact" }, `Artifact ${b.artifactId} not found`);
  const fresh = await adapter.compile({ kind: art.kind as ProgrammingKind, language: art.language, content: art.content ?? "" });

  const t0 = Date.now();
  const sim = await adapter.simulate(fresh, scenario);
  const durationMs = Date.now() - t0;

  const [row] = await d
    .insert(programSimRuns)
    .values({
      buildId,
      scenarioJson: scenario as Record<string, unknown>,
      ok: sim.ok,
      timelineJson: { timeline: sim.timeline },
      warningsJson: sim.warnings,
      durationMs,
      createdBy: user.id,
    })
    .returning();
  return { ...row, timeline: sim.timeline, warnings: sim.warnings };
}

export interface DeployRequest {
  buildId: number;
  stage: "staging" | "production";
  idempotencyKey: string;
  /** HITL provenance — the human confirming the deploy (== sign-off). */
  hitl: { actionId: string; requestedBy: number; confirmedBy?: number; reason?: string };
  deviceId?: number;
}

/** Kết quả TÍNH TOÁN của deploy (đã qua mọi gate + có thể đã gọi adapter) — CHƯA persist. */
interface DeployComputed {
  status: "rejected" | "simulated" | "deployed" | "verified" | "failed";
  simulated: boolean;
  signedOffBy: number | null;
  error: string | null;
  detailJson: Record<string, unknown> | null;
}

/** Nạp build + artifact + project cho một deploy (ném lỗi nếu thiếu). deviceId gắn ở PROJECT. */
async function loadDeployCtx(buildId: number) {
  const d = await db();
  const [b] = await d.select().from(programBuilds).where(eq(programBuilds.id, buildId)).limit(1);
  if (!b) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programBuild" }, `Build ${buildId} not found`);
  const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, b.artifactId)).limit(1);
  if (!art) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programmingArtifact" }, `Artifact ${b.artifactId} not found`);
  const [proj] = await d.select().from(programProjects).where(eq(programProjects.id, art.projectId)).limit(1);
  return { b, art, proj: proj ?? null, projectDeviceId: proj?.deviceId ?? null };
}

/**
 * THE DEPLOY GATE (pure of persistence). Runs EVERY safety gate in order — four-eyes-at-
 * version, build-ok, SoD (production self-approve), Simulation Gate — and only then invokes
 * the adapter's REAL device path (when DPC_DEPLOY_ENABLED is on AND a human signed off),
 * followed by VERIFY-AFTER-DOWNLOAD. Returns the computed row values; the CALLER persists
 * them (deployBuild inserts an append-only audit row; approveDeployment updates the queued
 * 'awaiting_approval' row in place). This keeps the two callers byte-identical on the gate.
 */
async function computeDeploy(
  req: DeployRequest,
  b: typeof programBuilds.$inferSelect,
  art: typeof programArtifacts.$inferSelect,
  projectDeviceId: number | null,
): Promise<DeployComputed> {
  const d = await db();

  // doc 38 T-2 — FOUR-EYES AT THE VERSION. With DPC_VERSION_REVIEW_ENABLED on, a version
  // that was not 'approved' by a second person (reviewer ≠ author) can NOT be deployed —
  // not even simulated. Off (default) → unchanged.
  if (dpcVersionReviewEnabled() && art.reviewStatus !== "approved") {
    return {
      status: "rejected",
      simulated: true,
      signedOffBy: null,
      error:
        `Four-eyes — phiên bản chưa được DUYỆT (reviewStatus="${art.reviewStatus}"). ` +
        "Cần người thứ hai duyệt (reviewer ≠ tác giả) trước khi deploy.",
      detailJson: null,
    };
  }

  // A non-ok build can never be deployed (even simulated).
  if (!b.ok) {
    return {
      status: "rejected",
      simulated: true,
      signedOffBy: null,
      error: "Build is not ok — refusing to deploy.",
      detailJson: null,
    };
  }

  const signedOff = req.hitl.confirmedBy != null;
  const realDeploy = dpcDeployEnabled() && signedOff;

  // W2-9 (doc 25 T6) — SEGREGATION OF DUTIES. A REAL production deploy may NOT be
  // self-approved: the human who signs off (confirmedBy) must differ from the requester.
  // Staging / simulated deploys are unaffected — two-person control applies to production
  // hardware writes only.
  if (realDeploy && req.stage === "production" && req.hitl.confirmedBy === req.hitl.requestedBy) {
    return {
      status: "rejected",
      simulated: true,
      signedOffBy: req.hitl.confirmedBy ?? null,
      error:
        "Segregation of duties — người ký duyệt deploy production phải KHÁC người yêu cầu (không được tự ký).",
      detailJson: req.hitl.reason ? { approvalReason: req.hitl.reason } : null,
    };
  }

  // P0 — ENFORCE THE SIMULATION GATE. A real (hardware) deploy is refused unless the
  // most-recent simulation run for this build PASSED (program_sim_runs.ok === true).
  if (realDeploy) {
    const [latestSim] = await d
      .select()
      .from(programSimRuns)
      .where(eq(programSimRuns.buildId, req.buildId))
      .orderBy(desc(programSimRuns.id))
      .limit(1);
    if (!latestSim || latestSim.ok !== true) {
      return {
        status: "rejected",
        simulated: true,
        signedOffBy: req.hitl.confirmedBy ?? null,
        error: latestSim
          ? "Simulation Gate not passed (latest sim run failed) — refusing real deploy."
          : "Simulation Gate required — no simulation run recorded for this build. Refusing real deploy.",
        detailJson: null,
      };
    }
  }

  let result: ProgDeployResult;
  if (realDeploy) {
    const adapter = programmingRegistry.getAdapter(b.adapterKind as ProgrammingKind);
    result = await adapter.deploy(
      { ok: b.ok, diagnostics: [], outputRef: b.outputRef ?? undefined },
      {
        stage: req.stage,
        idempotencyKey: req.idempotencyKey,
        hitl: req.hitl,
        deviceId: req.deviceId ?? projectDeviceId ?? undefined,
      },
    );

    // doc 38 T-2 — VERIFY-AFTER-DOWNLOAD. A deploy is only 'verified' when we READ IT BACK
    // from the device and the read-back matches — never on the strength of an audit row.
    //   • match          → promote status to 'verified'.
    //   • mismatch       → the download did NOT stick → status 'failed' (honest).
    //   • no read-back   → device absent / adapter can't upload → stays 'deployed' with
    //                      verified:false + reason (NEVER faked as verified).
    if (result.ok && result.status === "deployed") {
      const verify = await verifyAfterDownload(adapter, {
        expectedHash: art.contentHash ?? hashContent(art.content ?? ""),
        deviceId: req.deviceId ?? projectDeviceId ?? undefined,
        endpoint: (result.detail?.endpoint as string | undefined),
      });
      const detail = { ...(result.detail ?? {}), verify };
      if (verify.verified) {
        result = { ...result, status: "verified", detail };
      } else if (verify.mismatch) {
        result = {
          ok: false,
          status: "failed",
          simulated: false,
          detail,
          error: `Verify-after-download MISMATCH — read-back hash differs (expected ${verify.expectedHash?.slice(0, 12)}…, got ${verify.actualHash?.slice(0, 12)}…). Program on device does NOT match the built version.`,
        };
      } else {
        // Downloaded but NOT read-back-verified (device absent / read-back unsupported).
        result = { ...result, detail };
      }
    }
  } else {
    // Gate closed → SIMULATED. The adapter's hardware path is never invoked.
    result = {
      ok: true,
      status: "simulated",
      simulated: true,
      detail: {
        reason: !dpcDeployEnabled()
          ? "DPC_DEPLOY_ENABLED is off (default) — recorded as simulated."
          : "No HITL sign-off (confirmedBy) — recorded as simulated.",
      },
    };
  }

  return {
    status: result.status as DeployComputed["status"],
    simulated: result.simulated,
    signedOffBy: signedOff ? (req.hitl.confirmedBy ?? null) : null,
    // W2-9 — ghi kèm lý do duyệt (nếu có) vào detailJson để lưu vết SoD.
    detailJson: mergeApprovalReason(result.detail ?? null, req.hitl.reason),
    error: result.error ?? null,
  };
}

/**
 * THE DEPLOY GATE. Records an append-only program_deployments row. Reaches the device
 * ONLY when DPC_DEPLOY_ENABLED is on AND a human signed off; otherwise 'simulated'.
 *
 * doc 40 ENG-F2 — UNCHANGED entry for STAGING + rollback (they pass through here as before).
 * A PRODUCTION real-deploy through the Approval Inbox goes via requestDeployApproval →
 * approveDeployment; this function stays the byte-identical legacy path (flag OFF) + the
 * executor approveDeployment reuses via computeDeploy.
 */
export async function deployBuild(req: DeployRequest, user: DpcUser) {
  const d = await db();

  // Idempotency — return a prior deployment for this key as-is (fast path, no reservation).
  const prior = await findDeploymentByKey(req.idempotencyKey);
  if (prior) return prior;

  const { b, art, projectDeviceId } = await loadDeployCtx(req.buildId);

  // doc 80 WS-06 / FLOW-04 — GIỮ CHỖ TRƯỚC KHI CHẠM THIẾT BỊ. Trước đây: SELECT → adapter →
  // INSERT ⇒ N lượt song song cùng khoá đều lọt SELECT, đều gọi adapter (ghi thiết bị N lần),
  // rồi N-1 lượt vỡ unique `uq_prog_deploy_idem` (500). Nay: INSERT một dòng trạng thái trung
  // gian 'pending' (giá trị enum SẴN CÓ, không migration) ON CONFLICT DO NOTHING RETURNING —
  // unique index là trọng tài: đúng MỘT lượt nhận được dòng ⇒ chỉ lượt đó gọi adapter rồi
  // UPDATE kết quả; lượt thua trả dòng hiện có (có thể còn 'pending' nếu lượt thắng chưa xong).
  const [reserved] = await d
    .insert(programDeployments)
    .values({
      buildId: req.buildId,
      projectId: art.projectId,
      deviceId: req.deviceId ?? projectDeviceId,
      stage: req.stage,
      status: "pending",
      simulated: true,
      requestedBy: user.id,
      idempotencyKey: req.idempotencyKey,
      detailJson: { reservedAt: new Date().toISOString() },
    })
    .onConflictDoNothing({ target: programDeployments.idempotencyKey })
    .returning();
  if (!reserved) {
    const existing = await findDeploymentByKey(req.idempotencyKey);
    if (existing) return existing;
    throw appError(
      "CONFLICT",
      "OPERATION_FAILED",
      { operation: "deployBuild", reason: "idempotencyKeyUnreadable" },
      `Idempotency key "${req.idempotencyKey}" is in use but its deployment could not be read back.`,
    );
  }

  let computed: DeployComputed;
  try {
    computed = await computeDeploy(req, b, art, projectDeviceId);
  } catch (e) {
    // Không để dòng giữ chỗ kẹt 'pending' mãi: ghi 'failed' + lỗi thật rồi để lỗi nổi lên như
    // trước. `simulated` giữ nguyên — không biết chắc thiết bị đã bị chạm hay chưa, nên không
    // khẳng định một lần ghi thật.
    const [failedRow] = await d
      .update(programDeployments)
      .set({ status: "failed", error: (e as Error)?.message ?? String(e) })
      .where(eq(programDeployments.id, reserved.id))
      .returning();
    publishDeployed(failedRow);
    throw e;
  }

  const [row] = await d
    .update(programDeployments)
    .set({
      status: computed.status,
      simulated: computed.simulated,
      signedOffBy: computed.signedOffBy,
      detailJson: computed.detailJson,
      error: computed.error,
    })
    .where(eq(programDeployments.id, reserved.id))
    .returning();
  publishDeployed(row);
  return row;
}

async function findDeploymentByKey(idempotencyKey: string) {
  const d = await db();
  const [row] = await d
    .select()
    .from(programDeployments)
    .where(eq(programDeployments.idempotencyKey, idempotencyKey))
    .limit(1);
  return row;
}

// ════════════════════════════════════════════════════════════════════════════
// doc 40 ENG-F2 + Minh-P0 — DEPLOY APPROVAL INBOX (two-phase request→approve).
// ════════════════════════════════════════════════════════════════════════════

export interface DeployApprovalRequest {
  buildId: number;
  deviceId?: number;
  /** Lý do yêu cầu (bắt buộc ở UI cho deploy production). */
  reason?: string;
  /** Khóa idempotency ổn định theo (build, production) → double-click không tạo 2 yêu cầu. */
  idempotencyKey: string;
}

/**
 * PHIÊN 1 — YÊU CẦU DUYỆT. Tạo một hàng 'awaiting_approval' + một hàng ai_pending_actions
 * THẬT (id = actionId mà dispatcher tái xác minh). KHÔNG gọi adapter, KHÔNG chạm thiết bị.
 * ai_pending_actions.userId để tạm = người yêu cầu (hàng 'proposed' KHÔNG thể authorize
 * dispatch); khi approveDeployment ký, nó lật sang 'confirmed' VÀ đặt userId = người ký
 * (approver) — đúng điều kiện dispatcher: status confirmed/executed AND userId === confirmedBy.
 */
export async function requestDeployApproval(req: DeployApprovalRequest, requester: DpcUser) {
  const d = await db();

  // Idempotency — trả lại hàng deployment đã có cho key này (đang chờ / đã kết thúc).
  const prior = await findDeploymentByKey(req.idempotencyKey);
  if (prior) return prior;

  const { b, art, proj, projectDeviceId } = await loadDeployCtx(req.buildId);
  const deviceId = req.deviceId ?? projectDeviceId;

  // doc 80 FLOW-04 — hai lượt song song cùng khoá từng cùng lọt SELECT rồi lượt sau vỡ unique
  // (500) sau khi ĐÃ tạo một ai_pending_actions mồ côi. Nay unique index là trọng tài
  // (ON CONFLICT DO NOTHING); lượt thua trả dòng của lượt thắng.
  const loserReturnsExisting = async () => {
    const existing = await findDeploymentByKey(req.idempotencyKey);
    if (existing) return existing;
    throw appError(
      "CONFLICT",
      "OPERATION_FAILED",
      { operation: "requestDeployApproval", reason: "idempotencyKeyUnreadable" },
      `Idempotency key "${req.idempotencyKey}" is in use but its deployment could not be read back.`,
    );
  };

  // Build không ok → không xếp hàng chờ duyệt (từ chối trung thực, append-only audit).
  if (!b.ok) {
    const [row] = await d
      .insert(programDeployments)
      .values({
        buildId: req.buildId,
        projectId: art.projectId,
        deviceId,
        stage: "production",
        status: "rejected",
        simulated: true,
        requestedBy: requester.id,
        idempotencyKey: req.idempotencyKey,
        error: "Build is not ok — refusing to queue for approval.",
      })
      .onConflictDoNothing({ target: programDeployments.idempotencyKey })
      .returning();
    if (!row) return loserReturnsExisting();
    publishDeployed(row);
    return row;
  }

  // Hàng ai_pending_actions THẬT — id chính là actionId dispatcher tái xác minh.
  const actionId = randomUUID();
  const pendingIdem = `progdeploy-${req.idempotencyKey}-${randomUUID().slice(0, 8)}`;
  const expiresAt = new Date(Date.now() + DEPLOY_APPROVAL_TTL_MS);

  // Một transaction: dòng chờ duyệt (trọng tài theo khoá) + pending record chỉ cùng xuất hiện
  // — không bao giờ có dòng chờ duyệt thiếu pending record hay pending record mồ côi.
  const row = await d.transaction(async (tx) => {
    const [dep] = await tx
      .insert(programDeployments)
      .values({
        buildId: req.buildId,
        projectId: art.projectId,
        deviceId,
        stage: "production",
        status: "awaiting_approval",
        simulated: true, // chưa chạm thiết bị cho tới khi được duyệt
        requestedBy: requester.id,
        idempotencyKey: req.idempotencyKey,
        detailJson: {
          pendingActionId: actionId,
          approvalReason: req.reason ?? null,
          requestedAt: new Date().toISOString(),
        },
      })
      .onConflictDoNothing({ target: programDeployments.idempotencyKey })
      .returning();
    if (!dep) return null;
    await tx.insert(aiPendingActions).values({
      id: actionId,
      tool: "program_deploy",
      argsJson: {
        buildId: req.buildId,
        stage: "production",
        deviceId: deviceId ?? null,
        artifactId: art.id,
        projectId: art.projectId,
      },
      userId: requester.id, // tạm; approveDeployment sẽ đặt lại = người ký (approver)
      userRole: requester.role,
      requiredPermissionJson: { module: "machine_control", action: "canCreate" },
      summary: `Deploy production build #${req.buildId} (project ${proj?.code ?? art.projectId})`,
      status: "proposed",
      idempotencyKey: pendingIdem,
      expiresAt,
    });
    return dep;
  });
  if (!row) return loserReturnsExisting();
  publishDeployed(row);
  return row;
}

/**
 * PHIÊN 2 — DUYỆT & DEPLOY. approver ký bằng SESSION CỦA CHÍNH HỌ (actuationProcedure ở
 * router: role-floor + 2FA). Xác minh hàng chờ + pending record, lật pending → 'confirmed'
 * VÀ gắn userId = approver, RỒI chạy đúng đường deploy thật qua computeDeploy (sim-gate,
 * four-eyes-version, SoD, verify-after-download y nguyên) với actionId THẬT → dispatcher
 * không còn NOT_CONFIRMED. Cập nhật TẠI CHỖ hàng 'awaiting_approval' sang trạng thái kết
 * quả (rời khỏi inbox). SoD: approver ≠ requester.
 */
/** doc 80 WS-06 — hàng không (còn) ở 'awaiting_approval' ⇒ CONFLICT có mã (trước đây: Error trần ⇒ 500). */
function notAwaitingApproval(deploymentId: number, status: string, operation: string) {
  return appError(
    "CONFLICT",
    "OPERATION_FAILED",
    { operation, reason: "deploymentNotAwaitingApproval" },
    `Deployment ${deploymentId} không ở trạng thái chờ duyệt (status=${status}).`,
  );
}

export async function approveDeployment(
  deploymentId: number,
  approver: DpcUser,
  approval: { reason?: string },
) {
  const d = await db();
  const [dep] = await d.select().from(programDeployments).where(eq(programDeployments.id, deploymentId)).limit(1);
  if (!dep) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programDeployment" }, `Deployment ${deploymentId} not found`);
  if (dep.status !== "awaiting_approval") throw notAwaitingApproval(deploymentId, dep.status, "approveDeployment");
  // SoD (defense-in-depth; computeDeploy tái kiểm) — người duyệt phải KHÁC người yêu cầu.
  if (dep.requestedBy != null && dep.requestedBy === approver.id) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      { action: "selfApproveProgramDeploy" },
      "Segregation of duties — người ký duyệt deploy phải KHÁC người yêu cầu (không được tự duyệt).",
    );
  }

  const detail = (dep.detailJson ?? {}) as Record<string, unknown>;
  const actionId = typeof detail.pendingActionId === "string" ? detail.pendingActionId : null;
  if (!actionId) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation: "approveDeployment", reason: "deployApprovalRecordMissing" },
      "Bản ghi chờ duyệt thiếu pendingActionId — không thể duyệt.",
    );
  }

  const [pending] = await d.select().from(aiPendingActions).where(eq(aiPendingActions.id, actionId)).limit(1);
  if (!pending) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation: "approveDeployment", reason: "deployApprovalRecordMissing" },
      "Không tìm thấy bản ghi phê duyệt (ai_pending_actions).",
    );
  }
  if (pending.status !== "proposed" && pending.status !== "confirmed") {
    throw appError(
      "CONFLICT",
      "OPERATION_FAILED",
      { operation: "approveDeployment", reason: "deployApprovalRecordInvalid" },
      `Bản ghi phê duyệt không hợp lệ (status=${pending.status}).`,
    );
  }
  if (pending.expiresAt.getTime() <= Date.now()) {
    // Có điều kiện: chỉ đóng hàng nếu NÓ VẪN đang chờ duyệt (không đè lượt khác đã nhận).
    const [row] = await d
      .update(programDeployments)
      .set({ status: "rejected", error: "Yêu cầu deploy đã hết hạn chờ duyệt." })
      .where(and(eq(programDeployments.id, deploymentId), eq(programDeployments.status, "awaiting_approval")))
      .returning();
    if (!row) throw notAwaitingApproval(deploymentId, "changed concurrently", "approveDeployment");
    await d.update(aiPendingActions).set({ status: "expired" }).where(eq(aiPendingActions.id, actionId));
    publishDeployed(row);
    return row;
  }

  // doc 80 WS-06 / FLOW-04 — NHẬN hàng chờ duyệt NGUYÊN TỬ trước khi thực thi. Trước đây hai
  // approve song song đều đọc 'awaiting_approval' rồi cùng deploy (ghi thiết bị 2 lần). Nay
  // UPDATE … WHERE status='awaiting_approval' RETURNING: Postgres khoá hàng, lượt thứ hai đánh
  // giá lại WHERE sau khi lượt đầu commit ⇒ 0 hàng ⇒ CONFLICT. Trạng thái trung gian 'pending'
  // (enum SẴN CÓ) giữ hàng ra khỏi Hộp duyệt trong lúc deploy chạy.
  const [claimed] = await d
    .update(programDeployments)
    .set({
      status: "pending",
      detailJson: { ...detail, approvingBy: approver.id, approvingAt: new Date().toISOString() },
    })
    .where(and(eq(programDeployments.id, deploymentId), eq(programDeployments.status, "awaiting_approval")))
    .returning();
  if (!claimed) throw notAwaitingApproval(deploymentId, "claimed by a concurrent approval", "approveDeployment");

  let computed: DeployComputed;
  try {
    // Lật pending → 'confirmed' và GẮN vào approver (userId = approver.id). Đây là điều kiện
    // để dispatcher HITL vượt qua (status confirmed/executed AND userId === confirmedBy).
    await d
      .update(aiPendingActions)
      .set({ status: "confirmed", userId: approver.id, userRole: approver.role })
      .where(eq(aiPendingActions.id, actionId));

    const { b, art, projectDeviceId } = await loadDeployCtx(dep.buildId);
    const reason = (typeof detail.approvalReason === "string" ? detail.approvalReason : undefined) ?? approval.reason;
    computed = await computeDeploy(
      {
        buildId: dep.buildId,
        stage: "production",
        idempotencyKey: dep.idempotencyKey ?? `progdeploy-${deploymentId}`,
        deviceId: dep.deviceId ?? undefined,
        hitl: {
          actionId,
          requestedBy: dep.requestedBy ?? approver.id,
          confirmedBy: approver.id,
          reason,
        },
      },
      b,
      art,
      projectDeviceId,
    );
  } catch (e) {
    // Không để hàng kẹt 'pending': ghi 'failed' + lỗi thật, rồi để lỗi nổi lên.
    const [failedRow] = await d
      .update(programDeployments)
      .set({
        status: "failed",
        error: (e as Error)?.message ?? String(e),
        detailJson: { ...detail, approvedBy: approver.id, approvedAt: new Date().toISOString() },
      })
      .where(eq(programDeployments.id, deploymentId))
      .returning();
    publishDeployed(failedRow);
    throw e;
  }

  // Lượt DUYỆT đã được xử lý xong → pending = 'executed' (giá trị enum hợp lệ:
  // proposed/confirmed/executed/denied/expired/cancelled). Kết quả deploy THẬT
  // (deployed/verified/rejected/failed do sim-gate...) nằm ở resultJson.status VÀ ở
  // chính deployment row bên dưới — nên audit vẫn trung thực, không phụ thuộc pending.
  await d
    .update(aiPendingActions)
    .set({ status: "executed", executedAt: new Date(), resultJson: { deploymentId, status: computed.status } })
    .where(eq(aiPendingActions.id, actionId));

  // Cập nhật TẠI CHỖ hàng chờ → trạng thái kết quả (một hàng sạch, rời khỏi inbox).
  const [row] = await d
    .update(programDeployments)
    .set({
      status: computed.status,
      simulated: computed.simulated,
      signedOffBy: computed.signedOffBy ?? approver.id,
      error: computed.error,
      detailJson: {
        ...detail,
        ...(computed.detailJson ?? {}),
        approvedBy: approver.id,
        approvedAt: new Date().toISOString(),
      },
    })
    .where(eq(programDeployments.id, deploymentId))
    .returning();
  publishDeployed(row);
  return row;
}

/**
 * TỪ CHỐI một yêu cầu deploy đang chờ duyệt. An toàn (không chạm thiết bị): đánh dấu hàng
 * 'awaiting_approval' → 'rejected' + hủy pending record. Cho phép cả approver lẫn chính
 * người yêu cầu (tự rút yêu cầu). Ghi lý do vào detailJson để lưu vết.
 */
export async function rejectDeployment(
  deploymentId: number,
  actor: DpcUser,
  reason: string,
) {
  const d = await db();
  const [dep] = await d.select().from(programDeployments).where(eq(programDeployments.id, deploymentId)).limit(1);
  if (!dep) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programDeployment" }, `Deployment ${deploymentId} not found`);
  if (dep.status !== "awaiting_approval") throw notAwaitingApproval(deploymentId, dep.status, "rejectDeployment");
  const detail = (dep.detailJson ?? {}) as Record<string, unknown>;
  const actionId = typeof detail.pendingActionId === "string" ? detail.pendingActionId : null;
  // doc 80 WS-06 — có điều kiện: một lượt approve song song đã NHẬN hàng ('pending', đang
  // deploy) thì lượt từ chối không được đè trạng thái (sổ sẽ nói "rejected" trong khi thiết bị
  // đang được ghi). 0 hàng ⇒ CONFLICT.
  const [row] = await d
    .update(programDeployments)
    .set({
      status: "rejected",
      error: `Yêu cầu deploy bị từ chối: ${reason}`,
      detailJson: { ...detail, rejectedBy: actor.id, rejectedAt: new Date().toISOString(), rejectReason: reason },
    })
    .where(and(eq(programDeployments.id, deploymentId), eq(programDeployments.status, "awaiting_approval")))
    .returning();
  if (!row) throw notAwaitingApproval(deploymentId, "changed concurrently", "rejectDeployment");
  if (actionId) {
    await d
      .update(aiPendingActions)
      .set({ status: "cancelled" })
      .where(and(eq(aiPendingActions.id, actionId), eq(aiPendingActions.status, "proposed")));
  }
  publishDeployed(row);
  return row;
}

/** Gộp lý do duyệt vào detailJson (giữ null khi cả hai trống). */
function mergeApprovalReason(
  detail: Record<string, unknown> | null,
  reason?: string,
): Record<string, unknown> | null {
  if (!reason) return detail;
  return { ...(detail ?? {}), approvalReason: reason };
}

/**
 * U1-a — publish program.deployed on the eventBus (fire-and-forget; never throws
 * into the deploy path). Records EVERY deployment attempt (deployed / simulated /
 * rejected) so the ecosystem knows an IR/program change was recorded.
 */
function publishDeployed(row: typeof programDeployments.$inferSelect | undefined): void {
  if (!row) return;
  void import("../ecosystem/ecosystemEvents")
    .then(({ publishProgramDeployed }) =>
      publishProgramDeployed({
        deploymentId: row.id,
        projectId: row.projectId ?? null,
        buildId: row.buildId,
        deviceId: row.deviceId ?? null,
        stage: row.stage,
        status: row.status,
        simulated: row.simulated,
        signedOffBy: row.signedOffBy ?? null,
      }),
    )
    .catch(() => { /* best-effort */ });
}

/**
 * Roll back a project/stage to the build of a prior successful deployment by recording
 * a NEW deployment (rolledBackFromId set). Honours the same gate as deployBuild.
 *
 * doc 38 T-2 — REAL-ROLLBACK CONTRACT (revert HW): a rollback is a forward RE-DEPLOY of the
 * previous good build through deployBuild — so with DPC_DEPLOY_ENABLED on + sign-off it
 * RE-DOWNLOADS the previous program to the device (a genuine hardware revert), passes the
 * SAME simulation-gate + verify-after-download seam, and the device ends up running the prior
 * version. With the gate OFF (default) or the device absent, the revert is recorded 'simulated'
 * / unverified HONESTLY — the rollback is a stub that changed no hardware, never a fake revert.
 * (A true point-in-time restore of controller state beyond program image is out of scope until
 * per-vendor snapshot/restore is HW-validated.)
 */
export async function rollbackDeployment(
  deploymentId: number,
  user: DpcUser,
  hitl: { actionId: string; requestedBy: number; confirmedBy?: number },
  idempotencyKey: string,
) {
  const d = await db();
  const [target] = await d.select().from(programDeployments).where(eq(programDeployments.id, deploymentId)).limit(1);
  if (!target) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programDeployment" }, `Deployment ${deploymentId} not found`);
  // doc 80 WS-03 — đích chưa từng chạm thiết bị (bị từ chối / đang chờ duyệt / đang chạy)
  // thì không có gì để "lùi": từ chối có mã, không tạo lượt deploy nào.
  if (ROLLBACK_REFUSED_TARGET.has(target.status)) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation: "rollbackDeployment", reason: "rollbackTargetNotDeployed" },
      `Deployment ${deploymentId} ở trạng thái "${target.status}" — không thể khôi phục (chỉ khôi phục một lần deploy đã thực hiện).`,
    );
  }

  // Find the most recent successful deployment BEFORE the target, to revert to.
  // QA W5 (high): phải lọc theo ĐÚNG deviceId của target — trong fleet mọi máy chung
  // 1 projectId, nếu chỉ lọc project+stage thì rollback máy A có thể re-deploy bản của
  // máy B xuống máy B (để máy A vẫn chạy build lỗi). Scope theo máy cho cả single+fleet.
  const conds = [eq(programDeployments.projectId, target.projectId), eq(programDeployments.stage, target.stage)];
  if (target.deviceId != null) conds.push(eq(programDeployments.deviceId, target.deviceId));
  const history = await d
    .select()
    .from(programDeployments)
    .where(and(...conds))
    .orderBy(desc(programDeployments.id));
  const previous = history.find((h) => h.id < target.id && (h.status === "deployed" || h.status === "verified" || h.status === "simulated"));
  if (!previous) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation: "rollbackDeployment", reason: "noPriorDeploymentToRollBack" },
      "No prior deployment to roll back to.",
    );
  }

  const dep = await deployBuild(
    // Ép deviceId = target.deviceId (nếu có) để LÙI ĐÚNG máy, không dùng previous.deviceId.
    { buildId: previous.buildId, stage: target.stage, idempotencyKey, hitl, deviceId: (target.deviceId ?? previous.deviceId) ?? undefined },
    user,
  );

  // doc 80 WS-03 — ROLLBACK TRUNG THỰC. Trước đây đích bị đánh 'rolled_back' VÔ ĐIỀU KIỆN
  // (kể cả khi lượt lùi failed/rejected/simulated) ⇒ sổ WORM nói "đã khôi phục" trong khi
  // máy vẫn chạy bản lỗi. Nay chỉ đánh khi lượt lùi THỰC SỰ ghi được thiết bị (deployed /
  // verified), hoặc khi CẢ đích lẫn lượt lùi đều 'simulated' (ghi nhận nhất quán trong chế độ
  // mô phỏng — không có thiết bị nào bị nói dối). Ngoài ra đích giữ nguyên, client nhận
  // status thật của lượt lùi.
  const markTarget = rollbackMarksTarget(target.status, dep.status);

  // Hai lệnh cập nhật trong MỘT transaction: liên kết rollback + trạng thái đích cùng thành
  // hoặc cùng không. Đánh đích có điều kiện theo trạng thái đã đọc (không đè một thay đổi
  // song song).
  const linked = await d.transaction(async (tx) => {
    const [link] = await tx
      .update(programDeployments)
      .set({ rolledBackFromId: target.id })
      .where(eq(programDeployments.id, dep.id))
      .returning();
    if (markTarget) {
      await tx
        .update(programDeployments)
        .set({ status: "rolled_back" })
        .where(and(eq(programDeployments.id, target.id), eq(programDeployments.status, target.status)));
    }
    return link ?? dep;
  });
  return { ...linked, rolledBackFromId: target.id, targetRolledBack: markTarget };
}

/** Đích ở các trạng thái này chưa từng (hoặc chưa xong) chạm thiết bị ⇒ không có gì để lùi. */
const ROLLBACK_REFUSED_TARGET = new Set<string>(["rejected", "awaiting_approval", "pending"]);

/**
 * doc 80 WS-03 — đích chỉ thành 'rolled_back' khi lượt lùi ghi thật được thiết bị, hoặc khi cả
 * hai đều là bản ghi mô phỏng. Pure/testable.
 */
export function rollbackMarksTarget(targetStatus: string, rollbackStatus: string): boolean {
  if (rollbackStatus === "deployed" || rollbackStatus === "verified") return true;
  return rollbackStatus === "simulated" && targetStatus === "simulated";
}
