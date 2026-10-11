/**
 * Phase E4 — Factory Control Plane: EDGE CONTROL RUNTIME (EDGE-SIDE).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The module that RUNS ON AN EDGE HOST near the machines. It hosts the EXISTING E2
 * FOE engine (foeEngine.ts — NO fork) to EXECUTE workflow runs ASSIGNED to this edge
 * node, with OFFLINE RESILIENCE:
 *
 *   • executeAssignedRun(run)  — execute the run via the shared foeEngine.startRun.
 *     Every command still routes through equipmentRegistry → HITL/dry-run dispatcher.
 *   • OFFLINE BUFFER          — when the central platform is unreachable, run/step
 *     results are BUFFERED (in-memory + optional file-backed JSONL) and SYNCED back
 *     on reconnect. Idempotent by run/step id (central reconcile upserts).
 *   • HEARTBEAT               — periodic heartbeat to central (best-effort).
 *
 * ⚠️ HONESTY (read this): this is a COORDINATION + OFFLINE-BUFFER + EXECUTION
 * WRAPPER. It does NOT make Node.js hard real-time. Sub-ms determinism / motion
 * control needs a DEDICATED edge host (RTOS / a C/Rust agent). SAFETY (E-stop /
 * interlock / SIL motion) ALWAYS stays on the certified L1 PLC. This runtime only
 * SEQUENCES high-level operations and buffers their results.
 *
 * FLAG-GATED by EDGE_RUNTIME_ENABLED (default OFF). With the flag off EVERY entry
 * point is a safe no-op (returns a disabled result; the buffer/heartbeat never start).
 * FAIL-SAFE: a transport/engine error never crashes the host — it falls back to the
 * offline buffer.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { edgeRuntimeEnabled, type SyncRunPayload, type SyncedStep } from "./edgeCoordinator";

// ── config (env-driven; honest defaults) ──────────────────────────────────────

/** This edge node's own code (identity it registers/heartbeats/syncs as). */
function nodeCode(): string {
  return process.env.EDGE_NODE_CODE?.trim() || "edge-local";
}

/** Optional file-backed buffer path (JSONL). When unset the buffer is in-memory only. */
function bufferFile(): string | null {
  const p = process.env.EDGE_BUFFER_FILE?.trim();
  return p ? path.resolve(p) : null;
}

// ── the offline buffer (in-memory queue; optional file mirror) ─────────────────

/**
 * A FIFO queue of run-result payloads that could not be synced to central. Keyed by
 * runId so a re-buffer of the same run REPLACES the prior snapshot (latest wins);
 * the replay to central is itself idempotent (reconcile upserts step rows).
 */
const buffer = new Map<number, SyncRunPayload>();

/** Append/replace a payload in the buffer (latest snapshot per run wins). */
async function bufferPayload(payload: SyncRunPayload): Promise<void> {
  buffer.set(payload.runId, payload);
  const file = bufferFile();
  if (!file) return;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Persist the WHOLE buffer (small; one line per run) so a restart can replay it.
    const lines = [...buffer.values()].map((p) => JSON.stringify(p)).join("\n");
    await fs.writeFile(file, lines.length ? lines + "\n" : "", "utf8");
  } catch {
    // file mirror is best-effort; the in-memory queue is the source of truth.
  }
}

/** Restore the buffer from the file mirror (call on edge-runtime start). */
export async function restoreBuffer(): Promise<number> {
  const file = bufferFile();
  if (!file) return buffer.size;
  try {
    const raw = await fs.readFile(file, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const p = JSON.parse(t) as SyncRunPayload;
        if (p && Number.isInteger(p.runId)) buffer.set(p.runId, p);
      } catch {
        /* skip a corrupt line */
      }
    }
  } catch {
    /* no file yet → empty buffer */
  }
  return buffer.size;
}

/** How many run-result payloads are currently buffered (offline). */
export function bufferedCount(): number {
  return buffer.size;
}

/** Clear the buffer (test/maintenance helper). Also forgets the local-run map of doc 81 Đợt 7 I1. */
export function _clearBuffer(): void {
  buffer.clear();
  localRunOf.clear();
  centralAborted.clear();
}

// ── central transport (pluggable; default tRPC/HTTP via an injected sender) ────

/**
 * The function that actually delivers a payload to central. Injected so the edge host
 * can use whatever transport it has (tRPC client, HTTP POST /api/v1/edge/sync, MQTT).
 * Returns true on a confirmed central ACK. Default = "unreachable" (buffer everything)
 * until a transport is wired — HONEST: no transport is assumed to exist.
 */
export type CentralSync = (payload: SyncRunPayload) => Promise<boolean | CentralSyncAck>;
/**
 * doc 81 Đợt 7 task I1 — central's answer to a sync, as the transport maps it (POST /api/v1/edge/sync → 202
 * `{ data: { abortRequested } }`; tRPC edgeRuntime.syncRunResult → `data.abortRequested`). `abortRequested` ⇔ central has
 * aborted the run, or a central gate rejection claimed it: the edge stops the run's walker (applyCentralAbort).
 * A transport that answers a plain boolean never requests an abort (the pre-Đợt-7 contract).
 */
export interface CentralSyncAck {
  ack: boolean;
  abortRequested?: boolean;
}
let centralSync: CentralSync = async () => false;

/** Wire the transport the edge host uses to reach central. */
export function setCentralSync(fn: CentralSync): void {
  centralSync = fn;
}

/**
 * The heartbeat transport (best-effort). Injected like centralSync. Default no-op.
 */
export type HeartbeatSender = (code: string, health: Record<string, unknown>) => Promise<void>;
let heartbeatSender: HeartbeatSender = async () => undefined;
export function setHeartbeatSender(fn: HeartbeatSender): void {
  heartbeatSender = fn;
}

// ── sync / replay ──────────────────────────────────────────────────────────────

/**
 * Try to deliver a payload to central. On success it is removed from the buffer; on
 * failure it is BUFFERED for later replay. Returns whether central ACK'd.
 */
async function trySync(payload: SyncRunPayload): Promise<boolean> {
  return (await trySyncAck(payload)).ack;
}

/** trySync + central's abort request (doc 81 Đợt 7 I1). A refused / failed sync never requests an abort. */
async function trySyncAck(payload: SyncRunPayload): Promise<{ ack: boolean; abortRequested: boolean }> {
  try {
    const answer = await centralSync(payload);
    const ack = typeof answer === "boolean" ? answer : answer?.ack === true;
    const abortRequested = typeof answer === "object" && answer !== null && answer.ack === true && answer.abortRequested === true;
    if (ack) {
      buffer.delete(payload.runId);
      // rewrite the file mirror without this run
      const file = bufferFile();
      if (file) {
        try {
          const lines = [...buffer.values()].map((p) => JSON.stringify(p)).join("\n");
          await fs.writeFile(file, lines.length ? lines + "\n" : "", "utf8");
        } catch { /* best-effort */ }
      }
      if (abortRequested) await applyCentralAbort(payload.runId);
      return { ack: true, abortRequested };
    }
  } catch {
    /* transport threw → treat as unreachable */
  }
  await bufferPayload(payload);
  return { ack: false, abortRequested: false };
}

// ── doc 81 Đợt 7 task I1 — a CENTRAL abort / rejection stops the walker of the run executing HERE ─────────────────────
//
// While a run assigned to this node executes, its progress is synced to central every EDGE_ABORT_POLL_MS (default 2 s,
// clamped to [50 ms, 60 s]); every sync answer — that one, the final one after the walk, a buffered replay — may carry
// `abortRequested`. Then the LOCAL run is aborted through the shared engine (foeEngine.abortRun, as the edge system user):
//   • its walker is flagged at once — no further NON-STOP step is dispatched, a wait / delay wakes up;
//   • a STOP already handed to a dispatcher is let finish, and the run's remaining real STOP steps and due STOP
//     compensations are still SENT (the engine's abort sweep, Đợt 6 — only if the run acted): the edge never stops a STOP;
//   • central's own abort sweep may send the same STOPs too (a run driven on an edge counts as having acted, R-6-c): a
//     duplicate STOP is harmless.
// ★ CANNOT DECIDE — central unreachable: the edge cannot learn of the abort; it goes on walking (offline execution is what
//   the edge is for) and stops at the first sync that reaches central. To stop equipment at once, use the machine's direct
//   STOP / E-STOP — central's abort also sends the run's STOPs from central. Logged as such on every failed progress sync.

/** central run id → the LOCAL run id the edge engine created for it. */
const localRunOf = new Map<number, number>();
/** central run ids whose local run this node has already aborted (once). */
const centralAborted = new Set<number>();

/** The principal recorded on an edge-side abort requested by central (never a real person: id 0). */
export const EDGE_CENTRAL_ABORT_USER = { id: 0, role: "system", name: "edge: central abort" } as const;

function abortPollMs(): number {
  const n = parseInt(process.env.EDGE_ABORT_POLL_MS || "2000", 10);
  return Number.isFinite(n) ? Math.min(60_000, Math.max(50, n)) : 2000;
}

/** Abort (once) the local run of a central run central has stopped. Never throws. */
export async function applyCentralAbort(centralRunId: number): Promise<{ aborted: boolean; localRunId?: number }> {
  const localRunId = localRunOf.get(centralRunId);
  if (localRunId == null) {
    console.warn(`[EdgeRuntime] central stopped run ${centralRunId}, but no local run of it is known on this node — nothing to stop here`);
    return { aborted: false };
  }
  if (centralAborted.has(centralRunId)) return { aborted: false, localRunId };
  centralAborted.add(centralRunId);
  try {
    const { abortRun } = await import("../orchestration/foe/foeEngine");
    const r = await abortRun(localRunId, { ...EDGE_CENTRAL_ABORT_USER }, `aborted centrally (run ${centralRunId}) — edge sync`);
    console.warn(`[EdgeRuntime] central stopped run ${centralRunId}: local run ${localRunId} aborted (non-STOP steps stopped; STOPs still sent) — ${r?.status ?? r?.message ?? ""}`);
    return { aborted: true, localRunId };
  } catch (err) {
    centralAborted.delete(centralRunId); // the next sync answer retries
    console.error(`[EdgeRuntime] central stopped run ${centralRunId}: local abort failed — ${(err as Error)?.message ?? err}; use the machine's direct STOP / E-STOP`);
    return { aborted: false, localRunId };
  }
}

/**
 * PROGRESS sync (doc 81 Đợt 7 I1 fix 1, review I-1): sent straight through the transport — it NEVER touches the offline
 * buffer (which holds only FINAL payloads): a progress snapshot that fails is simply dropped (the next tick or the final
 * sync carries newer state), and one that succeeds never deletes a buffered final payload. Never throws.
 */
async function sendProgress(payload: SyncRunPayload): Promise<{ ack: boolean; abortRequested: boolean }> {
  try {
    const answer = await centralSync(payload);
    const ack = typeof answer === "boolean" ? answer : answer?.ack === true;
    const abortRequested = typeof answer === "object" && answer !== null && answer.ack === true && answer.abortRequested === true;
    return { ack, abortRequested };
  } catch {
    return { ack: false, abortRequested: false };
  }
}

/**
 * Sync the local run's progress to central until stopped; an abort request stops the local walker.
 * fix 1 (review I-1) — the returned stop() resolves only once a progress tick already in flight has FINISHED, so no stale
 * "running" snapshot can reach central after the final sync (the caller awaits it before the final sync); a tick that
 * finishes after stop() was called applies nothing (no abort, no re-schedule).
 */
function startAbortWatch(centralRunId: number, localRunId: number): () => Promise<void> {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;
  const schedule = () => {
    timer = setTimeout(() => {
      inFlight = tick().finally(() => {
        inFlight = null;
      });
    }, abortPollMs());
    if (typeof timer.unref === "function") timer.unref();
  };
  const tick = async () => {
    if (stopped) return;
    try {
      const { getRun } = await import("../orchestration/foe/foeEngine");
      const view = await getRun(localRunId);
      if (stopped) return;
      const payload = view ? buildPayload(centralRunId, view) : minimalPayload(centralRunId, "running");
      const { ack, abortRequested } = await sendProgress(payload);
      if (!ack) {
        console.warn(`[EdgeRuntime] run ${centralRunId}: central unreachable — a central abort cannot be learned until it is reached (the walk goes on; direct STOP / E-STOP stops equipment now)`);
      }
      if (abortRequested) {
        stopped = true;
        await applyCentralAbort(centralRunId);
      }
    } catch {
      /* a failed progress read / sync never stops the walk */
    }
    if (!stopped) schedule();
  };
  schedule();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (inFlight) await inFlight;
  };
}

/**
 * Replay all buffered payloads to central (call on reconnect / periodically). Each
 * replay is IDEMPOTENT (central reconcile upserts on runId+stepId). Returns the count
 * successfully drained. No-op when the flag is off.
 */
export async function replayBuffer(): Promise<{ enabled: boolean; drained: number; remaining: number }> {
  if (!edgeRuntimeEnabled()) return { enabled: false, drained: 0, remaining: buffer.size };
  let drained = 0;
  // snapshot keys so deletes during iteration are safe
  for (const runId of [...buffer.keys()]) {
    const payload = buffer.get(runId);
    if (!payload) continue;
    const ack = await trySync(payload); // doc 81 Đợt 7 I1 — an abort request in the answer stops the local run
    if (ack) drained += 1;
  }
  return { enabled: true, drained, remaining: buffer.size };
}

// ── heartbeat loop ─────────────────────────────────────────────────────────────

let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * Start the periodic heartbeat to central (also opportunistically drains the buffer).
 * No-op when the flag is off. Idempotent. The timer is unref'd so it never keeps the
 * process alive on its own.
 */
export function startHeartbeat(): void {
  if (!edgeRuntimeEnabled()) {
    console.log("[EdgeRuntime] heartbeat disabled (EDGE_RUNTIME_ENABLED off)");
    return;
  }
  if (heartbeatTimer) return;
  const intervalMs = parseInt(process.env.EDGE_HEARTBEAT_INTERVAL_MS || "30000", 10);
  heartbeatTimer = setInterval(() => {
    const health = { bufferedRuns: buffer.size, ts: new Date().toISOString() };
    heartbeatSender(nodeCode(), health).catch(() => undefined);
    // opportunistic replay of anything buffered while offline
    replayBuffer().catch(() => undefined);
  }, intervalMs);
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
  console.log(`[EdgeRuntime] heartbeat started (every ${intervalMs}ms) as node "${nodeCode()}"`);
}

/** Stop the heartbeat loop. */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ── execute an assigned run via the SHARED FOE engine (NO fork) ────────────────

export interface ExecuteAssignedResult {
  ok: boolean;
  enabled: boolean;
  runId?: number;
  status?: string;
  synced?: boolean;
  buffered?: boolean;
  message?: string;
}

/**
 * doc 81 Đợt 5 final wave F4 (final review M1) — the principal an assigned run is started AS on the edge: the account that
 * started it centrally (`orchestration_runs.startedBy`), with its REAL role — so the engine resolves that account's real
 * factory scope (and an admin keeps the admin bypass). No principal, an unknown or a disabled account ⇒ null (the run is
 * NOT started: fail-closed). A lookup error throws (the caller's fail-safe path records a failure).
 */
async function startingPrincipal(startedBy: number | null | undefined): Promise<{ id: number; role: string } | null> {
  if (typeof startedBy !== "number" || !Number.isInteger(startedBy) || startedBy <= 0) return null;
  const [{ getDb }, { users }, { eq }, { DbUnavailableError }] = await Promise.all([
    import("../../db/connection"),
    import("../../../drizzle/schema"),
    import("drizzle-orm"),
    import("../../_core/dbErrors"),
  ]);
  const d = await getDb();
  if (!d) throw new DbUnavailableError(); // the caller's fail-safe path records a failed run
  const [u] = await d.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, startedBy)).limit(1);
  if (!u || u.isActive === false || typeof u.role !== "string" || !u.role) return null;
  return { id: u.id, role: u.role };
}

/** Minimal shape of an assigned run row the edge runtime needs. */
export interface AssignedRun {
  id: number;
  workflowRef?: string | null;
  paramsJson?: Record<string, unknown> | null;
  startedBy?: number | null;
}

/**
 * EXECUTE a run assigned to THIS edge node by REUSING the shared E2 FOE engine. After
 * execution the run + per-step audit are read back and SYNCED to central; if central
 * is unreachable the result is BUFFERED for idempotent replay.
 *
 * SAFETY: foeEngine.startRun dispatches every command through equipmentRegistry →
 * HITL/dry-run dispatcher — identical to central execution. With OT_CONTROL_ENABLED
 * off the whole run is SIMULATION (writes nothing). Flag-gated; fail-safe.
 */
export async function executeAssignedRun(run: AssignedRun): Promise<ExecuteAssignedResult> {
  if (!edgeRuntimeEnabled()) {
    return { ok: false, enabled: false, message: "Edge runtime is disabled (set EDGE_RUNTIME_ENABLED=true)." };
  }
  if (!run || !Number.isInteger(run.id) || run.id <= 0) {
    return { ok: false, enabled: true, message: "A valid assigned run is required." };
  }
  try {
    // REUSE the shared engine — do NOT fork its logic.
    const { startRun, getRun, foeEnabled } = await import("../orchestration/foe/foeEngine");

    let status: string | undefined;
    let localRunId: number | undefined;
    if (run.workflowRef && foeEnabled()) {
      // final wave F4 — started AS the real starting principal (its real role ⇒ its real scope), never an anonymous "edge"
      // role; none ⇒ not started (fail-closed), recorded as a failed run below.
      const principal = await startingPrincipal(run.startedBy);
      if (!principal) {
        const message = `Run ${run.id} has no active starting principal — not started on the edge (its factory scope cannot be established).`;
        await bufferPayload(minimalPayload(run.id, "failed", message)).catch(() => undefined);
        return { ok: false, enabled: true, runId: run.id, status: "failed", buffered: true, message };
      }
      const user = { id: principal.id, role: principal.role, name: nodeCode() };
      // doc 81 Đợt 7 I1 — as soon as the local run exists: remember it and watch central for an abort while it walks.
      const watch: { stop: (() => Promise<void>) | null } = { stop: null };
      try {
        const res = await startRun(run.workflowRef, (run.paramsJson ?? {}) as Record<string, unknown>, user, {
          onStarted: (id: number) => {
            localRunId = id;
            localRunOf.set(run.id, id);
            watch.stop = startAbortWatch(run.id, id);
          },
        });
        status = res.status;
        if (localRunId == null && typeof res.runId === "number") {
          localRunId = res.runId;
          localRunOf.set(run.id, res.runId);
        }
      } finally {
        await watch.stop?.(); // fix 1 (I-1) — waits for a progress tick in flight: nothing stale lands after the final sync
      }
    }

    // Read back the authoritative LOCAL run + steps to build the sync payload (keyed by the CENTRAL run id).
    const view = await getRun(localRunId ?? run.id);
    const payload = view ? buildPayload(run.id, view) : minimalPayload(run.id, status ?? "running");

    // the final sync's answer may also carry central's abort (e.g. a run that paused at a gate here): applied inside
    const synced = await trySync(payload);
    return {
      ok: true,
      enabled: true,
      runId: run.id,
      status: payload.status,
      synced,
      buffered: !synced,
    };
  } catch (err) {
    // FAIL-SAFE: never crash the edge host. Buffer a minimal failure record.
    const message = err instanceof Error ? err.message : String(err);
    await bufferPayload(minimalPayload(run.id, "failed", message)).catch(() => undefined);
    return { ok: false, enabled: true, runId: run.id, status: "failed", buffered: true, message };
  }
}

// ── payload builders ───────────────────────────────────────────────────────────

function buildPayload(
  runId: number,
  view: { run: { status: string; error?: string | null; currentStepId?: string | null; startedAt?: Date | null; finishedAt?: Date | null }; steps: Array<{ stepId: string; stepType: string; status: string; attempt: number; result: Record<string, unknown> | null; error: string | null; startedAt: Date | null; finishedAt: Date | null }> },
): SyncRunPayload {
  const steps: SyncedStep[] = view.steps.map((s) => ({
    stepId: s.stepId,
    stepType: s.stepType,
    status: s.status,
    attempt: s.attempt,
    result: s.result,
    error: s.error,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
  }));
  return {
    edgeNodeCode: nodeCode(),
    runId,
    status: view.run.status,
    error: view.run.error ?? null,
    currentStepId: view.run.currentStepId ?? null,
    startedAt: view.run.startedAt ?? null,
    finishedAt: view.run.finishedAt ?? null,
    steps,
  };
}

function minimalPayload(runId: number, status: string, error?: string): SyncRunPayload {
  return {
    edgeNodeCode: nodeCode(),
    runId,
    status,
    error: error ?? null,
    steps: [],
  };
}
