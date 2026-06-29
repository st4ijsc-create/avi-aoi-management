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
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  programProjects,
  programArtifacts,
  programBuilds,
  programSimRuns,
  programDeployments,
} from "../../../drizzle/schema";
import {
  programmingRegistry,
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

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not connected");
  return d;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Validate an artifact's source against its adapter and persist the diagnostics +
 * status. Always safe (no device I/O).
 */
export async function validateArtifact(artifactId: number) {
  const d = await db();
  const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, artifactId)).limit(1);
  if (!art) throw new Error(`Artifact ${artifactId} not found`);

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
 * Compile an artifact → a program_builds row. Always safe (no device I/O).
 */
export async function buildArtifact(artifactId: number, user: DpcUser) {
  const d = await db();
  const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, artifactId)).limit(1);
  if (!art) throw new Error(`Artifact ${artifactId} not found`);

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
  if (!b) throw new Error(`Build ${buildId} not found`);

  const adapter = programmingRegistry.getAdapter(b.adapterKind as ProgrammingKind);
  if (!adapter.simulate) {
    throw new Error(`Adapter "${b.adapterKind}" does not support simulation.`);
  }
  const t0 = Date.now();
  const sim = await adapter.simulate(
    { ok: b.ok, diagnostics: [], outputRef: b.outputRef ?? undefined, meta: { lines: undefined } },
    scenario,
  );
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
  hitl: { actionId: string; requestedBy: number; confirmedBy?: number };
  deviceId?: number;
}

/**
 * THE DEPLOY GATE. Records an append-only program_deployments row. Reaches the device
 * ONLY when DPC_DEPLOY_ENABLED is on AND a human signed off; otherwise 'simulated'.
 */
export async function deployBuild(req: DeployRequest, user: DpcUser) {
  const d = await db();

  // Idempotency — return a prior terminal deployment for this key as-is.
  const [prior] = await d
    .select()
    .from(programDeployments)
    .where(eq(programDeployments.idempotencyKey, req.idempotencyKey))
    .limit(1);
  if (prior) return prior;

  const [b] = await d.select().from(programBuilds).where(eq(programBuilds.id, req.buildId)).limit(1);
  if (!b) throw new Error(`Build ${req.buildId} not found`);
  const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, b.artifactId)).limit(1);
  if (!art) throw new Error(`Artifact ${b.artifactId} not found`);
  const [proj] = await d.select().from(programProjects).where(eq(programProjects.id, art.projectId)).limit(1);
  // deviceId is bound at the PROJECT level (artifacts have none); the request may override.
  const projectDeviceId = proj?.deviceId ?? null;

  // A non-ok build can never be deployed (even simulated).
  if (!b.ok) {
    const [row] = await d
      .insert(programDeployments)
      .values({
        buildId: req.buildId,
        projectId: art.projectId,
        deviceId: req.deviceId ?? projectDeviceId,
        stage: req.stage,
        status: "rejected",
        simulated: true,
        requestedBy: user.id,
        idempotencyKey: req.idempotencyKey,
        error: "Build is not ok — refusing to deploy.",
      })
      .returning();
    return row;
  }

  const signedOff = req.hitl.confirmedBy != null;
  const realDeploy = dpcDeployEnabled() && signedOff;

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

  const [row] = await d
    .insert(programDeployments)
    .values({
      buildId: req.buildId,
      projectId: art.projectId,
      deviceId: req.deviceId ?? projectDeviceId,
      stage: req.stage,
      status: result.status,
      simulated: result.simulated,
      signedOffBy: signedOff ? req.hitl.confirmedBy : null,
      requestedBy: user.id,
      idempotencyKey: req.idempotencyKey,
      detailJson: result.detail ?? null,
      error: result.error ?? null,
    })
    .returning();
  return row;
}

/**
 * Roll back a project/stage to the build of a prior successful deployment by recording
 * a NEW deployment (rolledBackFromId set). Honours the same gate as deployBuild.
 */
export async function rollbackDeployment(
  deploymentId: number,
  user: DpcUser,
  hitl: { actionId: string; requestedBy: number; confirmedBy?: number },
  idempotencyKey: string,
) {
  const d = await db();
  const [target] = await d.select().from(programDeployments).where(eq(programDeployments.id, deploymentId)).limit(1);
  if (!target) throw new Error(`Deployment ${deploymentId} not found`);

  // Find the most recent successful deployment BEFORE the target, to revert to.
  const history = await d
    .select()
    .from(programDeployments)
    .where(and(eq(programDeployments.projectId, target.projectId), eq(programDeployments.stage, target.stage)))
    .orderBy(desc(programDeployments.id));
  const previous = history.find((h) => h.id < target.id && (h.status === "deployed" || h.status === "verified" || h.status === "simulated"));
  if (!previous) throw new Error("No prior deployment to roll back to.");

  const dep = await deployBuild(
    { buildId: previous.buildId, stage: target.stage, idempotencyKey, hitl, deviceId: previous.deviceId ?? undefined },
    user,
  );

  // Stamp the rollback link + mark the target as rolled_back (audit only).
  await d.update(programDeployments).set({ rolledBackFromId: target.id }).where(eq(programDeployments.id, dep.id));
  await d.update(programDeployments).set({ status: "rolled_back" }).where(eq(programDeployments.id, target.id));
  return { ...dep, rolledBackFromId: target.id };
}
