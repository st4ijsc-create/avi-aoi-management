/**
 * doc 44 W6-2 / G5.11 — IMPACT-BASED alert priority + dedup/fingerprint.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The command-view issue feed used to sort by severity-then-age only (every red
 * andon outranked every yellow, forever; the same machine spamming N alarms
 * produced N rows). SYNAPSE Tầng 5 §5.1 ("ưu tiên theo TÁC ĐỘNG, giảm nhiễu +
 * gộp") asks for two things this module provides — both PURE (no DB, unit-
 * testable) so factoryCommandService only has to feed it the already-aggregated
 * issues + a tiny machine context map:
 *
 *   1. computeIssueImpact() — a 0..100 score = f(severity, production impact,
 *      OEE shortfall, kind, age). A `down` machine on an ACTIVELY-PRODUCING line
 *      outranks a `down` machine whose line is already stopped; a fresh critical
 *      still beats a stale warning, but a long-standing warning floats up.
 *
 *   2. dedupIssues() — fingerprint = (machineId : kind); N raw issues on the
 *      same machine+kind collapse to ONE row carrying `count`, keeping the most
 *      impactful/oldest representative. Kills the "same machine, 12 rows" noise.
 *
 * FLAG: IMPACT_ALERT_ENABLED (default OFF). OFF → prioritizeIssues() reproduces
 * the LEGACY severity-then-age sort with NO dedup / NO count / NO impact stamped
 * (byte-for-byte behaviour parity with the pre-W6-2 screen). ON → dedup + impact
 * sort, and each surviving issue carries `impact` and `count`.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { CommandIssue, CommandMachineStatus } from "./factoryCommandService";

// ─── Flag ─────────────────────────────────────────────────────────────────────

/** G5.11 gate — read at call time so tests can flip it with stubEnv. */
export function impactAlertEnabled(): boolean {
  return process.env.IMPACT_ALERT_ENABLED === "true" || process.env.IMPACT_ALERT_ENABLED === "1";
}

// ─── Context the score needs about the issue's machine ───────────────────────

/** Everything computeIssueImpact needs about the machine an issue belongs to. */
export interface IssueImpactContext {
  /** Command-view status of the machine (running/idle/down/offline/maintenance). */
  machineStatus: CommandMachineStatus;
  /** OEE % (0-100) or null when unknown — a running low-OEE machine bleeds output. */
  oeePercent: number | null;
  /** True when ANY machine on the same line is running (line actively producing). */
  lineProducing: boolean;
}

/** Legacy severity ordering (critical worst) — kept for the flag-OFF path. */
const SEVERITY_RANK: Record<CommandIssue["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

// Weights — deliberately spread so severity dominates but production impact can
// lift a warning above a low-value critical (§5.1 "theo tác động").
const SEVERITY_BASE: Record<CommandIssue["severity"], number> = {
  critical: 50,
  warning: 25,
  info: 8,
};
const KIND_WEIGHT: Record<CommandIssue["kind"], number> = {
  andon: 6, // human-escalated, active
  offline: 5, // machine gone dark
  alarm: 4, // live alarm
  workorder: 3, // overdue maintenance
  pdm: 2, // future risk / advisory
};

/** Is the machine physically NOT producing right now (a hole on the floor)? */
function isMachineStopped(status: CommandMachineStatus): boolean {
  return status === "down" || status === "offline";
}

/**
 * Impact score 0..100 for ONE issue. Higher = more production/quality loss NOW.
 * Pure + deterministic. Contributions:
 *   • severity base         (critical 50 / warning 25 / info 8)
 *   • production impact      a stopped machine on a producing line = biggest hole
 *   • OEE shortfall          running machine bleeding yield (mild tie-breaker)
 *   • kind weight            andon/offline > alarm > WO > pdm
 *   • age boost              older open issues float up (capped, never dominates)
 */
export function computeIssueImpact(
  issue: Pick<CommandIssue, "severity" | "kind" | "ageMinutes">,
  ctx: IssueImpactContext,
): number {
  let score = SEVERITY_BASE[issue.severity] ?? 8;

  // Production impact — the core of "theo tác động".
  if (isMachineStopped(ctx.machineStatus)) {
    score += ctx.lineProducing ? 30 : 8;
  } else {
    score += ctx.lineProducing ? 12 : 4;
  }

  // OEE shortfall (only meaningful, mild): lower OEE ⇒ more loss. Unknown → 5.
  if (ctx.oeePercent != null && Number.isFinite(ctx.oeePercent)) {
    const shortfall = Math.max(0, Math.min(100, 100 - ctx.oeePercent));
    score += Math.min(10, Math.round(shortfall / 10));
  } else {
    score += 5;
  }

  score += KIND_WEIGHT[issue.kind] ?? 0;

  // Age boost — linear to 30 min then flat; max 6 so a stale info can't outrank
  // a fresh critical, but a long-standing warning creeps upward.
  const age = Number.isFinite(issue.ageMinutes) ? Math.max(0, issue.ageMinutes) : 0;
  score += Math.round(Math.min(1, age / 30) * 6);

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Dedup / fingerprint ─────────────────────────────────────────────────────

/** Fingerprint that groups "the same alert" — same machine + same kind. */
export function issueFingerprint(issue: Pick<CommandIssue, "machineId" | "kind">): string {
  return `${issue.machineId}:${issue.kind}`;
}

/**
 * Collapse issues sharing a fingerprint into ONE representative carrying `count`.
 * Representative = highest impact (when stamped), tie → oldest, tie → smallest id
 * — fully deterministic. Input order is otherwise preserved (first occurrence of
 * each fingerprint fixes the output position). Non-mutating.
 */
export function dedupIssues(issues: CommandIssue[]): CommandIssue[] {
  const groups = new Map<string, CommandIssue[]>();
  const order: string[] = [];
  for (const iss of issues) {
    const fp = issueFingerprint(iss);
    let g = groups.get(fp);
    if (!g) {
      g = [];
      groups.set(fp, g);
      order.push(fp);
    }
    g.push(iss);
  }

  const out: CommandIssue[] = [];
  for (const fp of order) {
    const g = groups.get(fp)!;
    if (g.length === 1) {
      out.push({ ...g[0], count: 1 });
      continue;
    }
    // pick representative
    let rep = g[0];
    for (const cand of g) {
      const ci = cand.impact ?? -1;
      const ri = rep.impact ?? -1;
      if (ci !== ri) {
        if (ci > ri) rep = cand;
        continue;
      }
      // impact tie → prefer the more severe, then older, then smaller id
      const cs = SEVERITY_RANK[cand.severity];
      const rs = SEVERITY_RANK[rep.severity];
      if (cs !== rs) {
        if (cs < rs) rep = cand;
        continue;
      }
      if (cand.ageMinutes !== rep.ageMinutes) {
        if (cand.ageMinutes > rep.ageMinutes) rep = cand;
        continue;
      }
      if (String(cand.id) < String(rep.id)) rep = cand;
    }
    out.push({ ...rep, count: g.length });
  }
  return out;
}

// ─── Public entry — prioritize (flag-gated) ──────────────────────────────────

/**
 * Order the issue feed for the command view.
 *
 *  • flag OFF → LEGACY: stable sort by severity then age desc; issues returned
 *    untouched (no impact / no count) — parity with the pre-W6-2 screen.
 *  • flag ON  → stamp `impact` per issue (using the machine context), dedup by
 *    fingerprint, then sort by impact desc, age desc, severity — noisiest signal
 *    first, most-impactful on top.
 *
 * `getContext` returns the machine context for an issue, or null when the machine
 * is unknown (then a neutral context is used so scoring never throws).
 */
export function prioritizeIssues(
  issues: CommandIssue[],
  getContext: (issue: CommandIssue) => IssueImpactContext | null,
): CommandIssue[] {
  if (!impactAlertEnabled()) {
    return [...issues].sort((a, b) => {
      const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (s !== 0) return s;
      return b.ageMinutes - a.ageMinutes;
    });
  }

  const neutral: IssueImpactContext = { machineStatus: "offline", oeePercent: null, lineProducing: false };
  const scored = issues.map((iss) => ({
    ...iss,
    impact: computeIssueImpact(iss, getContext(iss) ?? neutral),
  }));

  const deduped = dedupIssues(scored);

  return deduped.sort((a, b) => {
    const bi = b.impact ?? 0;
    const ai = a.impact ?? 0;
    if (bi !== ai) return bi - ai;
    if (b.ageMinutes !== a.ageMinutes) return b.ageMinutes - a.ageMinutes;
    return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  });
}
