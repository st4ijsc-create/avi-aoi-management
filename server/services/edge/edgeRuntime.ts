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

/** Clear the buffer (test/maintenance helper). */
export function _clearBuffer(): void {
  buffer.clear();
}

// ── central transport (pluggable; default tRPC/HTTP via an injected sender) ────

/**
 * The function that actually delivers a payload to central. Injected so the edge host
 * can use whatever transport it has (tRPC client, HTTP POST /api/v1/edge/sync, MQTT).
 * Returns true on a confirmed central ACK. Default = "unreachable" (buffer everything)
 * until a transport is wired — HONEST: no transport is assumed to exist.
 */
export type CentralSync = (payload: SyncRunPayload) => Promise<boolean>;
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
  try {
    const ack = await centralSync(payload);
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
      return true;
    }
  } catch {
    /* transport threw → treat as unreachable */
  }
  await bufferPayload(payload);
  return false;
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
    const ack = await trySync(payload);
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
    if (run.workflowRef && foeEnabled()) {
      const user = { id: run.startedBy ?? 0, role: "edge", name: nodeCode() };
      const res = await startRun(run.workflowRef, (run.paramsJson ?? {}) as Record<string, unknown>, user);
      status = res.status;
    }

    // Read back the authoritative run + steps to build the sync payload.
    const view = await getRun(run.id);
    const payload = view ? buildPayload(run.id, view) : minimalPayload(run.id, status ?? "running");

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
