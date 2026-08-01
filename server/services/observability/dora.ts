/**
 * DORA metrics — pure math (doc 44 W6-4 · gap G5.20; SYNAPSE_Tang5 Ch.15 GitOps/DORA).
 *
 * The four DORA "Accelerate" keys computed over a rolling window from a list of
 * deployment events. PURE + testable: no DB, no clock side-effects (the caller
 * passes `now`). The DB/I-O + flag wiring live in doraService.ts.
 *
 *   1. Deployment frequency      — successful deploys per day
 *   2. Lead time for changes     — median (commit → production) latency
 *   3. Change-failure rate       — fraction of deploys that failed / rolled back
 *   4. Mean time to restore      — median (failure → next recovery) latency
 *
 * Ratings follow the Google/DORA "State of DevOps" performance bands (elite/high/
 * medium/low). `no_data` is an HONEST band — never invented when the window is empty.
 */

export type DeploymentStatus = "success" | "failed" | "rolled_back";

export interface DeploymentEvent {
  id?: number;
  version?: string | null;
  commitSha?: string | null;
  environment: string;
  status: DeploymentStatus;
  /** When the deploy landed. */
  deployedAt: Date;
  deployedBy?: string | null;
  /** Commit → deploy latency in ms (nullable — CI may not supply it). */
  leadTimeMs?: number | null;
  service?: string | null;
}

export type DoraRating = "elite" | "high" | "medium" | "low" | "no_data";

export interface DoraMetrics {
  windowDays: number;
  from: string;
  to: string;
  totalDeployments: number;
  successfulDeployments: number;
  failedDeployments: number;

  deploymentFrequency: {
    perDay: number;
    perWeek: number;
    rating: DoraRating;
  };
  leadTimeForChanges: {
    medianMs: number | null;
    sampleSize: number;
    rating: DoraRating;
  };
  changeFailureRate: {
    /** Fraction in [0,1]. */
    rate: number | null;
    rating: DoraRating;
  };
  meanTimeToRestore: {
    medianMs: number | null;
    /** Number of failure→recovery intervals measured. */
    sampleSize: number;
    rating: DoraRating;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const HOUR_MS = 60 * 60 * 1000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function frequencyRating(perDay: number, totalDeploys: number): DoraRating {
  if (totalDeploys === 0) return "no_data";
  if (perDay >= 1) return "elite"; // on-demand / multiple per day
  if (perDay >= 1 / 7) return "high"; // ≥ 1 / week
  if (perDay >= 1 / 30) return "medium"; // ≥ 1 / month
  return "low";
}

function leadTimeRating(ms: number | null): DoraRating {
  if (ms === null) return "no_data";
  if (ms < DAY_MS) return "elite"; // < 1 day
  if (ms < WEEK_MS) return "high"; // < 1 week
  if (ms < MONTH_MS) return "medium"; // < 1 month
  return "low";
}

function cfrRating(rate: number | null): DoraRating {
  if (rate === null) return "no_data";
  if (rate <= 0.15) return "elite";
  if (rate <= 0.3) return "medium";
  return "low";
}

function mttrRating(ms: number | null): DoraRating {
  if (ms === null) return "no_data";
  if (ms < HOUR_MS) return "elite"; // < 1 hour
  if (ms < DAY_MS) return "high"; // < 1 day
  if (ms < WEEK_MS) return "medium"; // < 1 week
  return "low";
}

/**
 * Compute the four DORA metrics from deployment events.
 *
 * @param events   deployment log rows (any order)
 * @param opts.now epoch ms of "now" (default Date.now()) — injected for deterministic tests
 * @param opts.windowDays rolling window in days (default 30)
 */
export function computeDoraMetrics(
  events: DeploymentEvent[],
  opts: { now?: number; windowDays?: number } = {},
): DoraMetrics {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? 30;
  const windowMs = windowDays * DAY_MS;
  const from = now - windowMs;

  // Keep only in-window events, ascending by time.
  const inWindow = events
    .filter((e) => {
      const t = e.deployedAt instanceof Date ? e.deployedAt.getTime() : new Date(e.deployedAt).getTime();
      return Number.isFinite(t) && t >= from && t <= now;
    })
    .map((e) => ({ ...e, _t: (e.deployedAt instanceof Date ? e.deployedAt : new Date(e.deployedAt)).getTime() }))
    .sort((a, b) => a._t - b._t);

  const total = inWindow.length;
  const successes = inWindow.filter((e) => e.status === "success");
  const failures = inWindow.filter((e) => e.status === "failed" || e.status === "rolled_back");

  // 1) Deployment frequency — successful deploys per day.
  const perDay = successes.length / windowDays;
  const perWeek = perDay * 7;

  // 2) Lead time for changes — median commit→deploy over successful deploys that carry it.
  const leadTimes = successes
    .map((e) => e.leadTimeMs)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  const leadMedian = median(leadTimes);

  // 3) Change-failure rate — failures / all deploys.
  const cfr = total === 0 ? null : failures.length / total;

  // 4) MTTR — median (failure → next success in the same environment).
  const restoreIntervals: number[] = [];
  for (const f of failures) {
    const recovery = inWindow.find((e) => e.status === "success" && e.environment === f.environment && e._t > f._t);
    if (recovery) restoreIntervals.push(recovery._t - f._t);
  }
  const mttrMedian = median(restoreIntervals);

  return {
    windowDays,
    from: new Date(from).toISOString(),
    to: new Date(now).toISOString(),
    totalDeployments: total,
    successfulDeployments: successes.length,
    failedDeployments: failures.length,
    deploymentFrequency: {
      perDay,
      perWeek,
      rating: frequencyRating(perDay, total),
    },
    leadTimeForChanges: {
      medianMs: leadMedian,
      sampleSize: leadTimes.length,
      rating: leadTimeRating(leadMedian),
    },
    changeFailureRate: {
      rate: cfr,
      rating: cfrRating(cfr),
    },
    meanTimeToRestore: {
      medianMs: mttrMedian,
      sampleSize: restoreIntervals.length,
      rating: mttrRating(mttrMedian),
    },
  };
}
