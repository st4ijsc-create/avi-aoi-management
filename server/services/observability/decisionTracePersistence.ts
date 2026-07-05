/**
 * Decision-trace persistence — SYNAPSE §5.12.1 (doc 33 W4).
 *
 * Registers a best-effort SINK on the pure decisionTrace ring buffer that flushes each trace to
 * the `decision_traces` table (migration 0221) when OBSERVABILITY is on. The pure module stays
 * DB-free. Persistence never blocks or throws into the recording caller.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { setDecisionSink, type DecisionTrace } from "./decisionTrace";
import { getDb } from "../../db/connection";
import { decisionTraces, type DecisionTraceRow } from "../../../drizzle/schema/synapseObservability";

function observabilityEnabled(): boolean {
  return process.env.OBSERVABILITY === "true" || process.env.OBSERVABILITY === "1";
}

const cut = (s: string | null | undefined, n: number): string | null => (s == null ? null : s.slice(0, n));

async function persist(trace: DecisionTrace): Promise<void> {
  if (!observabilityEnabled()) return;
  const db = await getDb();
  if (!db) return;
  await db.insert(decisionTraces).values({
    decisionType: cut(trace.decisionType, 64)!,
    subject: cut(trace.subject, 128)!,
    chosen: cut(trace.chosen, 128),
    candidatesJson: trace.candidates as never,
    version: cut(trace.version, 64)!,
    correlationId: cut(trace.correlationId, 64),
    ts: trace.ts,
    note: trace.note ?? null,
  });
}

let registered = false;
/** Install the DB sink (idempotent). Called at import so the router activates it. */
export function registerDecisionPersistence(): void {
  if (registered) return;
  registered = true;
  setDecisionSink((t) => {
    void persist(t).catch(() => {
      /* best-effort */
    });
  });
}

// Register at import (the sink itself re-checks OBSERVABILITY per write, so a flag flip works).
registerDecisionPersistence();

export interface PersistedDecisionQuery {
  decisionType?: string;
  subject?: string;
  since?: number;
  limit?: number;
}

/** Query persisted decision-traces (most recent first). */
export async function queryPersistedDecisions(q: PersistedDecisionQuery = {}): Promise<DecisionTraceRow[]> {
  const db = await getDb();
  if (!db) return [];
  const where = [
    q.decisionType ? eq(decisionTraces.decisionType, q.decisionType) : undefined,
    q.subject ? eq(decisionTraces.subject, q.subject) : undefined,
    q.since !== undefined ? gte(decisionTraces.ts, q.since) : undefined,
  ].filter(Boolean);
  const rows = await db
    .select()
    .from(decisionTraces)
    .where(where.length ? and(...(where as [])) : undefined)
    .orderBy(desc(decisionTraces.id))
    .limit(Math.min(q.limit ?? 100, 1000));
  return rows;
}
