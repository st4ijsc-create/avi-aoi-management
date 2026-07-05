/**
 * Durable RunEvent store — SYNAPSE §5.1.2 (doc 33 W4).
 *
 * Persists the F8 event-sourcing log to `orchestration_run_events` (migration 0222) so a run's
 * exact state can be replayed after a crash (replay-from-events), complementing the run_steps
 * re-walk. Best-effort appends (gated by FOE_DURABLE); a persistence failure never blocks the
 * engine. Reuses the pure F8 reducer (replayRun).
 */
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { orchestrationRunEvents } from "../../../drizzle/schema/synapseObservability";
import { replayRun, type RunEvent, type RunEventType, type RunState } from "./eventSourcing";

function foeDurableEnabled(): boolean {
  return process.env.FOE_DURABLE === "true" || process.env.FOE_DURABLE === "1";
}

/**
 * Append a run event (best-effort). seq is assigned as max(seq)+1 for the run. No-op unless
 * FOE_DURABLE. Never throws.
 */
export async function appendRunEvent(
  runId: number,
  type: RunEventType,
  opts: { taskId?: string; ts: number; data?: unknown } = { ts: 0 },
): Promise<void> {
  if (!foeDurableEnabled()) return;
  try {
    const db = await getDb();
    if (!db) return;
    const [{ maxSeq } = { maxSeq: 0 }] = await db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${orchestrationRunEvents.seq}), 0)` })
      .from(orchestrationRunEvents)
      .where(eq(orchestrationRunEvents.runId, runId));
    await db.insert(orchestrationRunEvents).values({
      runId,
      seq: Number(maxSeq) + 1,
      type,
      taskId: opts.taskId ?? null,
      ts: opts.ts,
      dataJson: (opts.data ?? null) as never,
    });
  } catch {
    /* durable log is best-effort */
  }
}

/** Load a run's event log (seq order). */
export async function loadRunEvents(runId: number): Promise<RunEvent[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(orchestrationRunEvents)
    .where(eq(orchestrationRunEvents.runId, runId))
    .orderBy(asc(orchestrationRunEvents.seq));
  return rows.map((r) => ({ seq: r.seq, type: r.type as RunEventType, taskId: r.taskId ?? undefined, ts: Number(r.ts), data: r.dataJson }));
}

/** Replay a run's persisted events into its current state (F8 reducer). */
export async function replayPersistedRun(runId: number): Promise<RunState> {
  const events = await loadRunEvents(runId);
  return replayRun(String(runId), events);
}
