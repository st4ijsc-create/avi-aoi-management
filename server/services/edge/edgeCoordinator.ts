/**
 * Phase E4 — Factory Control Plane: EDGE COORDINATOR (CENTRAL-SIDE).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The CENTRAL half of the edge control runtime framework. It:
 *   • registers / lists / heart-beats edge nodes (edge_nodes table).
 *   • ASSIGNS a workflow RUN to an edge node (orchestration_runs.edgeNodeId).
 *   • RECEIVES synced run/step results from an edge node and RECONCILES them into
 *     the EXISTING E2 orchestration_runs / orchestration_run_steps tables.
 *   • marks a node OFFLINE when its heartbeat goes stale (mirrors the
 *     edgeStaleScheduler interval pattern).
 *
 * HONESTY (non-negotiable): this is COORDINATION, not hard real-time control.
 * Hard-RT / sub-ms determinism needs a DEDICATED edge host; safety (E-stop /
 * interlock / motion) ALWAYS stays on the certified L1 PLC. Every command an edge
 * run issues still routes through the SAME equipmentRegistry → HITL/dry-run path.
 *
 * FLAG-GATED by EDGE_RUNTIME_ENABLED (default OFF). With the flag off every mutating
 * entry point returns a structured `disabled` result and writes NOTHING. Reads are
 * always safe. FAIL-SAFE: a DB/transport error never crashes the process.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, lt, inArray } from "drizzle-orm";
import { DbUnavailableError } from "../../_core/dbErrors";
import { getDb } from "../../db/connection";
import {
  edgeNodes,
  orchestrationRuns,
  orchestrationRunSteps,
  type EdgeNode,
} from "../../../drizzle/schema";

// ── Flag ─────────────────────────────────────────────────────────────────────

/** Read the flag at call time so config toggles / tests take effect. */
export function edgeRuntimeEnabled(): boolean {
  return process.env.EDGE_RUNTIME_ENABLED === "true" || process.env.EDGE_RUNTIME_ENABLED === "1";
}

// ── Public shapes ──────────────────────────────────────────────────────────────

export interface EdgeResult<T = unknown> {
  ok: boolean;
  enabled: boolean;
  data?: T;
  message?: string;
}

export interface RegisterNodeInput {
  code: string;
  name?: string;
  factoryCode?: string | null;
  assignedLineCodes?: string[] | null;
  version?: string | null;
}

export interface HeartbeatInput {
  code: string;
  status?: "online" | "degraded";
  version?: string | null;
  health?: Record<string, unknown> | null;
}

/** One step result an edge node syncs back (idempotent by runId+stepId). */
export interface SyncedStep {
  stepId: string;
  stepType: string;
  status: string;
  attempt?: number;
  result?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
}

/** A whole run-result envelope an edge node syncs back. */
export interface SyncRunPayload {
  edgeNodeCode: string;
  runId: number;
  status: string;
  error?: string | null;
  currentStepId?: string | null;
  contextJson?: Record<string, unknown> | null;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
  steps: SyncedStep[];
}

// ── db helper (fail-safe) ─────────────────────────────────────────────────────

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const RUN_STATUSES = new Set([
  "queued", "running", "held", "awaiting_confirm",
  "completed", "failed", "aborted", "compensating",
]);
const STEP_STATUSES = new Set([
  "pending", "running", "awaiting_confirm", "held",
  "completed", "failed", "skipped", "compensated",
]);

// ════════════════════════════════════════════════════════════════════════════════
// NODE REGISTRY
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Register (upsert by code) an edge node. Flag-gated. On (re)registration the node is
 * marked online with a fresh heartbeat. Returns the persisted node.
 */
export async function registerNode(input: RegisterNodeInput): Promise<EdgeResult<EdgeNode>> {
  if (!edgeRuntimeEnabled()) {
    return { ok: false, enabled: false, message: "Edge runtime is disabled (set EDGE_RUNTIME_ENABLED=true)." };
  }
  const code = String(input.code ?? "").trim();
  if (!code) return { ok: false, enabled: true, message: "Edge node `code` is required." };
  try {
    const d = await db();
    const now = new Date();
    const [existing] = await d.select().from(edgeNodes).where(eq(edgeNodes.code, code)).limit(1);
    if (existing) {
      const [row] = await d
        .update(edgeNodes)
        .set({
          name: input.name ?? existing.name,
          factoryCode: input.factoryCode ?? existing.factoryCode,
          assignedLineCodes: input.assignedLineCodes ?? existing.assignedLineCodes,
          version: input.version ?? existing.version,
          status: "online",
          lastHeartbeatAt: now,
          updatedAt: now,
        })
        .where(eq(edgeNodes.id, existing.id))
        .returning();
      return { ok: true, enabled: true, data: row };
    }
    const [row] = await d
      .insert(edgeNodes)
      .values({
        code,
        name: input.name ?? code,
        factoryCode: input.factoryCode ?? null,
        assignedLineCodes: input.assignedLineCodes ?? null,
        version: input.version ?? null,
        status: "online",
        lastHeartbeatAt: now,
      })
      .returning();
    return { ok: true, enabled: true, data: row };
  } catch (err) {
    return { ok: false, enabled: true, message: err instanceof Error ? err.message : String(err) };
  }
}

/** List edge nodes (optionally by factory). Read — always safe (not flag-gated). */
export async function listNodes(factoryCode?: string): Promise<EdgeNode[]> {
  try {
    const d = await getDb();
    if (!d) return [];
    const q = d.select().from(edgeNodes);
    const rows = factoryCode
      ? await q.where(eq(edgeNodes.factoryCode, factoryCode)).orderBy(desc(edgeNodes.updatedAt))
      : await q.orderBy(desc(edgeNodes.updatedAt));
    return rows;
  } catch {
    return [];
  }
}

/** Fetch one node by code (read — safe). */
export async function getNode(code: string): Promise<EdgeNode | null> {
  try {
    const d = await getDb();
    if (!d) return null;
    const [row] = await d.select().from(edgeNodes).where(eq(edgeNodes.code, code)).limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Heartbeat from an edge node. Flag-gated. Refreshes lastHeartbeatAt + status
 * (online / degraded as self-reported) and stores the latest health blob.
 */
export async function heartbeat(input: HeartbeatInput): Promise<EdgeResult<EdgeNode>> {
  if (!edgeRuntimeEnabled()) {
    return { ok: false, enabled: false, message: "Edge runtime is disabled (set EDGE_RUNTIME_ENABLED=true)." };
  }
  const code = String(input.code ?? "").trim();
  if (!code) return { ok: false, enabled: true, message: "Edge node `code` is required." };
  try {
    const d = await db();
    const [existing] = await d.select().from(edgeNodes).where(eq(edgeNodes.code, code)).limit(1);
    if (!existing) {
      return { ok: false, enabled: true, message: `Edge node "${code}" is not registered.` };
    }
    const [row] = await d
      .update(edgeNodes)
      .set({
        status: input.status === "degraded" ? "degraded" : "online",
        version: input.version ?? existing.version,
        healthJson: input.health ?? existing.healthJson,
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(edgeNodes.id, existing.id))
      .returning();
    return { ok: true, enabled: true, data: row };
  } catch (err) {
    return { ok: false, enabled: true, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Mark nodes whose heartbeat is older than `thresholdMin` as OFFLINE. Mirrors the
 * edgeStaleScheduler pattern. Returns the codes flipped offline. Fail-safe; not
 * flag-gated (a health sweep is always safe and a no-op when there are no nodes).
 */
export async function markStaleNodesOffline(thresholdMin = 2): Promise<string[]> {
  try {
    const d = await getDb();
    if (!d) return [];
    const cutoff = new Date(Date.now() - thresholdMin * 60_000);
    // Candidates: currently online/degraded AND (no heartbeat OR heartbeat < cutoff).
    const candidates = await d
      .select()
      .from(edgeNodes)
      .where(inArray(edgeNodes.status, ["online", "degraded"]));
    const staleIds = candidates
      .filter((n) => !n.lastHeartbeatAt || new Date(n.lastHeartbeatAt).getTime() < cutoff.getTime())
      .map((n) => n.id);
    if (staleIds.length === 0) return [];
    await d
      .update(edgeNodes)
      .set({ status: "offline", updatedAt: new Date() })
      .where(and(inArray(edgeNodes.id, staleIds), lt(edgeNodes.lastHeartbeatAt, cutoff)));
    // Also flip nodes that never sent a heartbeat (lastHeartbeatAt IS NULL).
    const noHeartbeat = candidates.filter((n) => !n.lastHeartbeatAt).map((n) => n.id);
    if (noHeartbeat.length > 0) {
      await d
        .update(edgeNodes)
        .set({ status: "offline", updatedAt: new Date() })
        .where(inArray(edgeNodes.id, noHeartbeat));
    }
    return candidates.filter((n) => staleIds.includes(n.id)).map((n) => n.code);
  } catch {
    return [];
  }
}

/**
 * Deregister (delete) an edge node by id. Flag-gated. SAFE-GUARD: refuses to delete a
 * node that still has NON-TERMINAL runs delegated to it (those runs would be orphaned);
 * the caller must first reassign/abort them. Terminal-only history does not block.
 * Fail-safe: a DB error returns a structured failure, never throws to the transport.
 */
export async function deleteNode(id: number): Promise<EdgeResult<{ id: number }>> {
  if (!edgeRuntimeEnabled()) {
    return { ok: false, enabled: false, message: "Edge runtime is disabled (set EDGE_RUNTIME_ENABLED=true)." };
  }
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, enabled: true, message: "A valid node id is required." };
  }
  try {
    const d = await db();
    const [node] = await d.select().from(edgeNodes).where(eq(edgeNodes.id, id)).limit(1);
    if (!node) return { ok: false, enabled: true, message: `Edge node ${id} not found.` };

    // Guard: any non-terminal run still delegated here would be orphaned.
    const assigned = await d
      .select()
      .from(orchestrationRuns)
      .where(eq(orchestrationRuns.edgeNodeId, id));
    const active = assigned.filter(
      (r) => !["completed", "failed", "aborted"].includes(r.status),
    );
    if (active.length > 0) {
      return {
        ok: false,
        enabled: true,
        message: `Node "${node.code}" still has ${active.length} active run(s) delegated to it. Reassign or abort them first.`,
      };
    }
    // Detach terminal-run history from the node (keep the runs, null the FK) then delete.
    if (assigned.length > 0) {
      await d
        .update(orchestrationRuns)
        .set({ edgeNodeId: null, updatedAt: new Date() })
        .where(eq(orchestrationRuns.edgeNodeId, id));
    }
    await d.delete(edgeNodes).where(eq(edgeNodes.id, id));
    return { ok: true, enabled: true, data: { id } };
  } catch (err) {
    return { ok: false, enabled: true, message: err instanceof Error ? err.message : String(err) };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// RUN ASSIGNMENT
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Delegate a workflow RUN to an edge node (sets orchestration_runs.edgeNodeId).
 * Flag-gated. Does NOT itself start execution — it records the delegation so the
 * edge runtime (edgeRuntime.executeAssignedRun) can pick the run up. Fail-safe.
 */
export async function assignRun(runId: number, edgeNodeId: number): Promise<EdgeResult<{ runId: number; edgeNodeId: number }>> {
  if (!edgeRuntimeEnabled()) {
    return { ok: false, enabled: false, message: "Edge runtime is disabled (set EDGE_RUNTIME_ENABLED=true)." };
  }
  if (!Number.isInteger(runId) || runId <= 0 || !Number.isInteger(edgeNodeId) || edgeNodeId <= 0) {
    return { ok: false, enabled: true, message: "Valid runId and edgeNodeId are required." };
  }
  try {
    const d = await db();
    const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return { ok: false, enabled: true, message: `Run ${runId} not found.` };
    if (["completed", "failed", "aborted"].includes(run.status)) {
      return { ok: false, enabled: true, message: `Run ${runId} is terminal (${run.status}); cannot reassign.` };
    }
    const [node] = await d.select().from(edgeNodes).where(eq(edgeNodes.id, edgeNodeId)).limit(1);
    if (!node) return { ok: false, enabled: true, message: `Edge node ${edgeNodeId} not found.` };

    await d
      .update(orchestrationRuns)
      .set({ edgeNodeId, updatedAt: new Date() })
      .where(eq(orchestrationRuns.id, runId));
    return { ok: true, enabled: true, data: { runId, edgeNodeId } };
  } catch (err) {
    return { ok: false, enabled: true, message: err instanceof Error ? err.message : String(err) };
  }
}

/** List runs delegated to a given edge node (read — safe). */
export async function listRunsForNode(edgeNodeId: number, limit = 100): Promise<Array<typeof orchestrationRuns.$inferSelect>> {
  try {
    const d = await getDb();
    if (!d) return [];
    return await d
      .select()
      .from(orchestrationRuns)
      .where(eq(orchestrationRuns.edgeNodeId, edgeNodeId))
      .orderBy(desc(orchestrationRuns.createdAt))
      .limit(limit);
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// RESULT RECONCILE (edge → central sync)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Reconcile a run-result payload SYNCED from an edge node into the E2 tables.
 *
 * IDEMPOTENT: each step is upserted on (runId, stepId) so a replay (offline-buffer
 * drain that re-sends) writes the same row, never duplicates. The run-level status is
 * advanced to the synced terminal/paused state. Flag-gated. Fail-safe.
 *
 * The edge node is authenticated UPSTREAM (a scoped API key / tRPC session); here we
 * only verify the node exists and owns the run (defence in depth).
 */
export async function syncRunResult(payload: SyncRunPayload): Promise<EdgeResult<{ runId: number; stepsApplied: number }>> {
  if (!edgeRuntimeEnabled()) {
    return { ok: false, enabled: false, message: "Edge runtime is disabled (set EDGE_RUNTIME_ENABLED=true)." };
  }
  if (!payload || !Number.isInteger(payload.runId) || payload.runId <= 0) {
    return { ok: false, enabled: true, message: "A valid `runId` is required." };
  }
  try {
    const d = await db();
    const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, payload.runId)).limit(1);
    if (!run) return { ok: false, enabled: true, message: `Run ${payload.runId} not found.` };

    // Defence in depth: the edge node must be the run's assignee (when known).
    const [node] = await d.select().from(edgeNodes).where(eq(edgeNodes.code, payload.edgeNodeCode)).limit(1);
    if (node && run.edgeNodeId != null && run.edgeNodeId !== node.id) {
      return { ok: false, enabled: true, message: `Run ${payload.runId} is not assigned to node "${payload.edgeNodeCode}".` };
    }

    // ── Upsert each step (idempotent on runId+stepId) ──
    let stepsApplied = 0;
    for (const s of payload.steps ?? []) {
      if (!s || typeof s.stepId !== "string" || !STEP_STATUSES.has(s.status)) continue;
      await d
        .insert(orchestrationRunSteps)
        .values({
          runId: payload.runId,
          stepId: s.stepId,
          stepType: s.stepType ?? "command",
          status: s.status as never,
          attempt: s.attempt ?? 0,
          resultJson: s.result ?? null,
          error: s.error ?? null,
          startedAt: toDate(s.startedAt),
          finishedAt: toDate(s.finishedAt),
        })
        .onConflictDoUpdate({
          target: [orchestrationRunSteps.runId, orchestrationRunSteps.stepId],
          set: {
            stepType: s.stepType ?? "command",
            status: s.status as never,
            attempt: s.attempt ?? 0,
            resultJson: s.result ?? null,
            error: s.error ?? null,
            startedAt: toDate(s.startedAt) ?? undefined,
            finishedAt: toDate(s.finishedAt) ?? undefined,
          },
        });
      stepsApplied += 1;
    }

    // ── Advance the run-level status (only to a recognised state) ──
    const runStatus = RUN_STATUSES.has(payload.status) ? payload.status : run.status;
    await d
      .update(orchestrationRuns)
      .set({
        status: runStatus as never,
        error: payload.error ?? run.error,
        currentStepId: payload.currentStepId ?? run.currentStepId,
        contextJson: payload.contextJson ?? run.contextJson,
        startedAt: toDate(payload.startedAt) ?? run.startedAt,
        finishedAt: toDate(payload.finishedAt) ?? run.finishedAt,
        updatedAt: new Date(),
      })
      .where(eq(orchestrationRuns.id, payload.runId));

    return { ok: true, enabled: true, data: { runId: payload.runId, stepsApplied } };
  } catch (err) {
    return { ok: false, enabled: true, message: err instanceof Error ? err.message : String(err) };
  }
}
