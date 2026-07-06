/**
 * Priority / SLA / four-eyes — SYNAPSE §5.1.4 / §5.3.4 (doc 33 §3.6 / F8 · H3).
 *
 * The missing orchestration governance: P0–P3 priority bands, aging/anti-starvation, EDF
 * ordering, preemption rules, and a four-eyes gate for high-risk actions (delegating to the
 * F5 policy-as-code engine). Pure + testable. Additive — the dispatcher can adopt it.
 */
import { evaluatePolicies, DEFAULT_POLICIES, type Policy } from "../security/policyEngine";

/** P0 = highest (safety/line-stop). Lower number = more urgent. */
export type PriorityBand = 0 | 1 | 2 | 3;

export interface PrioritizedTask {
  id: string;
  priority: PriorityBand;
  /** Epoch ms the task entered the queue. */
  createdTs: number;
  /** Optional deadline (epoch ms) for EDF ordering. */
  deadlineTs?: number;
  /** May a higher-priority task preempt this one mid-flight? */
  preemptible?: boolean;
}

/** Default aging window: a task waiting this long is promoted one band (anti-starvation). */
export const DEFAULT_AGING_MS = 15 * 60 * 1000;

/** Effective (aged) priority band. Waiting ≥ N aging windows promotes N bands (clamped to P0). */
export function effectivePriority(task: PrioritizedTask, now: number, agingMs = DEFAULT_AGING_MS): PriorityBand {
  const waited = Math.max(0, now - task.createdTs);
  const bumps = agingMs > 0 ? Math.floor(waited / agingMs) : 0;
  return Math.max(0, task.priority - bumps) as PriorityBand;
}

/**
 * Ordering for dispatch: effective priority (P0 first) → earliest deadline (EDF) → FIFO.
 * Returns <0 if `a` should go before `b`.
 */
export function compareForDispatch(a: PrioritizedTask, b: PrioritizedTask, now: number, agingMs = DEFAULT_AGING_MS): number {
  const pa = effectivePriority(a, now, agingMs);
  const pb = effectivePriority(b, now, agingMs);
  if (pa !== pb) return pa - pb;
  const da = a.deadlineTs ?? Infinity;
  const db = b.deadlineTs ?? Infinity;
  if (da !== db) return da - db;
  return a.createdTs - b.createdTs;
}

/** Order a queue for dispatch (stable, non-mutating). */
export function orderQueue(tasks: readonly PrioritizedTask[], now: number, agingMs = DEFAULT_AGING_MS): PrioritizedTask[] {
  return [...tasks].sort((a, b) => compareForDispatch(a, b, now, agingMs));
}

/**
 * May `incoming` preempt a `running` task? Only a strictly-higher band preempts, and only if the
 * running task is preemptible (a task in EXECUTING is not cut mid-way unless flagged). P0 may
 * preempt P2/P3 (SDD §5.3.4).
 */
export function canPreempt(incoming: PrioritizedTask, running: PrioritizedTask, now: number, agingMs = DEFAULT_AGING_MS): boolean {
  if (running.preemptible !== true) return false;
  return effectivePriority(incoming, now, agingMs) < effectivePriority(running, now, agingMs);
}

export interface FourEyesDecision {
  required: boolean;
  reason: string;
  policyId: string | null;
}

/**
 * Does a high-risk action require four-eyes approval? Delegates to the F5 policy-as-code engine:
 * a `require_approval` (or `deny`) verdict → approval needed. P0 override is also gated.
 */
export function requiresFourEyes(
  input: { action?: string } & Record<string, unknown>,
  policies: readonly Policy[] = DEFAULT_POLICIES,
): FourEyesDecision {
  const decision = evaluatePolicies(input, policies);
  if (decision.effect === "deny") {
    return { required: true, reason: `denied by policy: ${decision.reason}`, policyId: decision.policyId };
  }
  if (decision.effect === "require_approval") {
    return { required: true, reason: decision.reason, policyId: decision.policyId };
  }
  return { required: false, reason: "no approval required", policyId: null };
}
