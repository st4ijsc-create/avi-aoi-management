/**
 * RL dispatch advisor — SYNAPSE §5.3.4 / §5.8 (doc 33 §3.6 / H6).
 *
 * A reinforcement-learning policy advises the scheduler in three escalating modes:
 *   shadow  → emit the heuristic choice, only LOG the RL choice for comparison;
 *   suggest → emit heuristic, attach RL as a suggestion for a human;
 *   auto    → emit the RL choice, but ONLY if it is inside the hard-constraint candidate set;
 * plus a CIRCUIT BREAKER: if the observed KPI worsens for N consecutive cycles, trip back to the
 * heuristic (SDD §5.3.4). Pure + testable. Additive (flag RL_ADVISOR). RL never acts outside the
 * candidate set — the heuristic's hard constraints remain the safety envelope.
 */

export type RlMode = "off" | "shadow" | "suggest" | "auto";

export interface RlAdvisorState {
  mode: RlMode;
  /** Consecutive cycles the KPI has been worse than baseline. */
  consecutiveWorse: number;
  /** Circuit breaker open → force heuristic regardless of mode. */
  tripped: boolean;
}

export function newRlAdvisorState(mode: RlMode = "shadow"): RlAdvisorState {
  return { mode, consecutiveWorse: 0, tripped: false };
}

export interface RlAdvice {
  /** What to actually dispatch. */
  emittedChoice: string;
  source: "heuristic" | "rl";
  /** RL's choice surfaced for shadow/suggest (or when it was out of bounds in auto). */
  suggestion: string | null;
  /** Was the RL choice inside the hard-constraint candidate set? */
  inBounds: boolean;
  note: string;
}

/** Decide what to dispatch given the heuristic + RL choices and the eligible candidate set. */
export function adviseDispatch(
  state: RlAdvisorState,
  input: { heuristicChoice: string; rlChoice: string; candidateSet: readonly string[] },
): RlAdvice {
  const inBounds = input.candidateSet.includes(input.rlChoice);

  if (state.tripped || state.mode === "off") {
    return { emittedChoice: input.heuristicChoice, source: "heuristic", suggestion: null, inBounds, note: state.tripped ? "breaker open → heuristic" : "RL off" };
  }
  if (state.mode === "shadow") {
    return { emittedChoice: input.heuristicChoice, source: "heuristic", suggestion: input.rlChoice, inBounds, note: "shadow: RL logged only" };
  }
  if (state.mode === "suggest") {
    return { emittedChoice: input.heuristicChoice, source: "heuristic", suggestion: input.rlChoice, inBounds, note: "suggest: RL offered to human" };
  }
  // auto — act on RL only when it is inside the candidate set (safety); else fall back.
  if (inBounds) {
    return { emittedChoice: input.rlChoice, source: "rl", suggestion: input.rlChoice, inBounds, note: "auto: RL within bounds" };
  }
  return { emittedChoice: input.heuristicChoice, source: "heuristic", suggestion: input.rlChoice, inBounds, note: "auto: RL out of bounds → heuristic fallback" };
}

/**
 * Record a cycle's KPI vs baseline; trip the breaker after `maxWorse` consecutive worse cycles.
 * `lowerIsBetter` (default true — e.g. makespan/tardiness): worse = kpi > baseline.
 */
export function recordKpi(
  state: RlAdvisorState,
  kpi: number,
  baseline: number,
  opts: { lowerIsBetter?: boolean; maxWorse?: number } = {},
): { tripped: boolean; consecutiveWorse: number } {
  const lowerIsBetter = opts.lowerIsBetter ?? true;
  const maxWorse = opts.maxWorse ?? 2;
  const worse = lowerIsBetter ? kpi > baseline : kpi < baseline;
  state.consecutiveWorse = worse ? state.consecutiveWorse + 1 : 0;
  if (state.consecutiveWorse >= maxWorse) state.tripped = true;
  return { tripped: state.tripped, consecutiveWorse: state.consecutiveWorse };
}

/** Reset the circuit breaker (e.g. after a human re-enables RL). */
export function resetBreaker(state: RlAdvisorState): void {
  state.tripped = false;
  state.consecutiveWorse = 0;
}
