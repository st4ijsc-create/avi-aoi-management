/**
 * Decision-trace — SYNAPSE §5.12.1 "truy vết quyết định" (doc 33 §3.4 / F6 · H2).
 *
 * The orchestration-specific observability signal: every allocation/dispatch decision records
 * a "why" — the candidate set, each candidate's score, which constraints eliminated whom, and
 * the algorithm/weights/model VERSION. Answers "vì sao robot X được chọn cho việc Y lúc 14:32?"
 * in one query (SDD §5.12.1).
 *
 * F6 uses a bounded in-memory ring buffer (queryable, non-breaking, no migration — persistence
 * to a `decision_traces` hypertable is a later wave, numbered to avoid clashing with doc-32's
 * 0202). Pure w.r.t. inputs; timestamps are passed in by callers (deterministic/testable).
 */
import { getCorrelationId } from "./correlation";

export interface DecisionCandidate {
  id: string;
  score: number;
  /** If eliminated by a hard constraint, which one (else undefined = eligible). */
  eliminatedBy?: string;
  /** Score breakdown (distance/battery/skill/…) for explainability. */
  factors?: Record<string, number>;
}

export interface DecisionTrace {
  /** Monotonic id (assigned by the store). */
  id: number;
  /** Decision family, e.g. "task-allocation", "dispatch", "traffic-route". */
  decisionType: string;
  /** What was being decided (task/order/route id). */
  subject: string;
  /** Chosen candidate id (null when no eligible candidate). */
  chosen: string | null;
  candidates: DecisionCandidate[];
  /** Algorithm + weights/model version that produced the decision. */
  version: string;
  /** correlation id linking this to the end-to-end trace. */
  correlationId?: string;
  /** Epoch ms (passed in by caller). */
  ts: number;
  /** Optional human note. */
  note?: string;
}

export type DecisionTraceInput = Omit<DecisionTrace, "id" | "correlationId"> & {
  correlationId?: string;
};

const RING_MAX = 5000;
const ring: DecisionTrace[] = [];
let nextId = 1;

/** doc 33 W4 — optional persistence sink. A DB-backed sink registers here when OBSERVABILITY is
 *  on; this module stays DB-free/pure. The sink is best-effort — it must never throw. */
export type DecisionSink = (trace: DecisionTrace) => void;
let sink: DecisionSink | null = null;
export function setDecisionSink(fn: DecisionSink | null): void {
  sink = fn;
}

/** Record a decision. Auto-attaches the current correlation id if not supplied. Never throws. */
export function recordDecision(input: DecisionTraceInput): DecisionTrace {
  const rec: DecisionTrace = {
    ...input,
    id: nextId++,
    correlationId: input.correlationId ?? getCorrelationId(),
  };
  ring.push(rec);
  if (ring.length > RING_MAX) ring.shift();
  if (sink) {
    try {
      sink(rec);
    } catch {
      /* persistence is best-effort — never affect the caller */
    }
  }
  return rec;
}

export interface DecisionQuery {
  decisionType?: string;
  subject?: string;
  correlationId?: string;
  /** Only records with ts >= since. */
  since?: number;
  limit?: number;
}

/** Query recent decision traces (most recent first). */
export function queryDecisions(q: DecisionQuery = {}): DecisionTrace[] {
  const limit = q.limit ?? 100;
  const out: DecisionTrace[] = [];
  for (let i = ring.length - 1; i >= 0 && out.length < limit; i--) {
    const r = ring[i];
    if (q.decisionType && r.decisionType !== q.decisionType) continue;
    if (q.subject && r.subject !== q.subject) continue;
    if (q.correlationId && r.correlationId !== q.correlationId) continue;
    if (q.since !== undefined && r.ts < q.since) continue;
    out.push(r);
  }
  return out;
}

/** Explain a single decision in words (for logs / tooltips). */
export function explainDecision(t: DecisionTrace): string {
  if (t.chosen === null) return `${t.decisionType} ${t.subject}: no eligible candidate (v${t.version}).`;
  const winner = t.candidates.find((c) => c.id === t.chosen);
  const eliminated = t.candidates.filter((c) => c.eliminatedBy);
  return (
    `${t.decisionType} ${t.subject}: chose ${t.chosen}` +
    (winner ? ` (score ${winner.score.toFixed(3)})` : "") +
    ` over ${t.candidates.length - 1} others; ${eliminated.length} eliminated by constraints; v${t.version}.`
  );
}

/** Current number of traces held in the in-memory ring (for a health endpoint / gauge). */
export function decisionRingDepth(): number {
  return ring.length;
}

/** Ring capacity + how many traces have been recorded since start (health card). */
export function decisionRingInfo(): { depth: number; capacity: number; totalRecorded: number } {
  return { depth: ring.length, capacity: RING_MAX, totalRecorded: nextId - 1 };
}

/** Test-only: clear the ring. */
export function _clearDecisionTraces(): void {
  ring.length = 0;
  nextId = 1;
}
