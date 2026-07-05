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

/** Advisory-lock namespace that serialises per-run seq assignment (arbitrary constant). */
const RUN_EVENT_LOCK_NS = 771_004_221;

/**
 * Append a run event (best-effort). seq is assigned as max(seq)+1 for the run, SERIALISED per-run
 * by a transaction advisory lock so concurrent appends (parallel DAG branches, fire-and-forget
 * transitions) cannot read the same MAX(seq) and write a duplicate seq. A UNIQUE(runId, seq)
 * constraint (migration 0223) is the fail-loud backstop. No-op unless FOE_DURABLE. Never throws.
 * — doc 33 §11 fix.
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
    await db.transaction(async (tx) => {
      // Serialise seq assignment for THIS run (other runs proceed concurrently — key includes runId).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${RUN_EVENT_LOCK_NS}, ${runId})`);
      const [{ maxSeq } = { maxSeq: 0 }] = await tx
        .select({ maxSeq: sql<number>`COALESCE(MAX(${orchestrationRunEvents.seq}), 0)` })
        .from(orchestrationRunEvents)
        .where(eq(orchestrationRunEvents.runId, runId));
      await tx.insert(orchestrationRunEvents).values({
        runId,
        seq: Number(maxSeq) + 1,
        type,
        taskId: opts.taskId ?? null,
        ts: opts.ts,
        dataJson: (opts.data ?? null) as never,
      });
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
