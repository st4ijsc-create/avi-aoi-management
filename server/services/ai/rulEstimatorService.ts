/**
 * G4.7 (doc 44 W5-B3) — RUL ESTIMATOR (survival / Weibull, pure-TS, software-only).
 * Flag: RUL_WEIBULL_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SYNAPSE Tầng-4 §7.2 "Dự đoán RUL (tuổi thọ còn lại): khi CÓ đủ lịch sử hỏng
 * hóc; ước tính thời gian còn lại tới hỏng." Batch này thay heuristic
 * EWMA-linear-extrapolation (predictiveMaintenanceService) bằng một fit SURVIVAL
 * thật:
 *   1. Thu thập time-to-failure (TTF) từ lịch sử hỏng THẬT (maintenance_work_orders
 *      + downtime_events + failure_events): mỗi cặp fail→fail (hoặc install→fail)
 *      = 1 quan sát uncensored; khoảng-từ-lần-hỏng-cuối→nay = 1 quan sát censored.
 *   2. Fit Weibull 2 tham số (shape k, scale λ) bằng MLE có kiểm duyệt (censoring)
 *      — Newton-Raphson trên phương trình profile-likelihood (numerically stable,
 *      log-domain). Pool theo machine-class (machineType) để vượt nghẽn dữ liệu.
 *   3. RUL = KỲ VỌNG CÒN LẠI có điều kiện tuổi hiện tại t:
 *        RUL(t) = ∫_t^∞ R(u) du / R(t),  R(u) = exp(-(u/λ)^k).
 *
 * NGHẼN DỮ LIỆU (honest): nếu < RUL_MIN_OBSERVATIONS quan sát HỎNG THẬT (default 5)
 * → FALLBACK heuristic hiện có + method:'heuristic' (KHÔNG bịa độ tin cậy). confidence
 * suy TỪ SỐ QUAN SÁT, không phải model tự khai.
 *
 * PURE-first: fitWeibull / conditionalRemainingLife / weibullMean / estimateRul là
 * hàm THUẦN (unit-testable, không I/O, không cờ). estimateRulForMachine là lớp DB
 * (đọc bảng thật) + cờ; NO-OP (trả null) khi cờ RUL_WEIBULL_ENABLED tắt → caller
 * heuristic nguyên vẹn.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  machines,
  maintenanceWorkOrders,
  downtimeEvents,
  failureEvents,
  rulEstimates,
  type RulMethod,
} from "../../../drizzle/schema";

// ─── Flag + tunables ──────────────────────────────────────────────────────────

export function isRulWeibullEnabled(): boolean {
  return process.env.RUL_WEIBULL_ENABLED === "true";
}

/** Minimum REAL (uncensored) failure observations before a Weibull fit is trusted. */
export const RUL_MIN_OBSERVATIONS = Math.max(2, Number(process.env.RUL_MIN_OBSERVATIONS ?? 5));

/** Failure-history lookback window (days) for gathering TTF observations. */
const RUL_LOOKBACK_DAYS = Math.max(30, Number(process.env.RUL_LOOKBACK_DAYS ?? 365));

/** Cap on sibling machines pooled per class (keeps queries bounded). */
const RUL_MAX_CLASS_MACHINES = 200;

/** Unplanned-downtime categories treated as real failures. */
const UD_CATEGORIES = new Set(["unplanned", "breakdown", "failure", "fault"]);

/** Work-order types/triggers treated as ACTUAL (not predicted/preventive) failures. */
const FAILURE_WO_TYPES = new Set(["CORRECTIVE"]);
const FAILURE_WO_TRIGGERS = new Set(["BREAKDOWN"]);

// ─── Types ────────────────────────────────────────────────────────────────────

/** One survival observation. durationHours = TTF (or run-time so far when censored). */
export interface FailureObservation {
  durationHours: number;
  /** TRUE ⇒ right-censored (still running, no failure yet). */
  censored: boolean;
}

export interface WeibullFit {
  /** Shape k. k<1 infant-mortality, k=1 random (exponential), k>1 wear-out. */
  shape: number;
  /** Scale λ (characteristic life, hours). */
  scale: number;
  /** Uncensored failures used. */
  failures: number;
  /** Censored observations used. */
  censored: number;
  /** Newton iterations to convergence. */
  iterations: number;
  /** TRUE if the solver hit its bound rather than converging (degenerate data). */
  bounded: boolean;
}

export interface RulEstimate {
  machineId: number | null;
  machineType: string | null;
  componentKey: string;
  method: RulMethod;
  /** Remaining useful life (hours). NULL when unknown. */
  rulHours: number | null;
  /** Age used as the conditioning time (hours). */
  ageHours: number | null;
  shape: number | null;
  scale: number | null;
  observations: number;
  failures: number;
  censored: number;
  /** 0..1 — from number of failure observations (honest, not self-reported). */
  confidence: number;
  note: string;
}

// ─── gamma / lgamma (Lanczos) — self-contained ────────────────────────────────

/** Natural log of the gamma function (Lanczos approximation, g=7). */
function lgamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaFn(z: number): number {
  return Math.exp(lgamma(z));
}

// ─── Weibull mean + conditional remaining life ────────────────────────────────

/** Mean life E[T] = λ·Γ(1 + 1/k). */
export function weibullMean(shape: number, scale: number): number {
  if (!(shape > 0) || !(scale > 0)) return NaN;
  return scale * gammaFn(1 + 1 / shape);
}

/**
 * Conditional expected remaining life at age t:
 *   RUL(t) = (1/R(t)) ∫_t^∞ R(u) du,  R(u)=exp(-(u/λ)^k).
 *
 * Computed by Simpson integration in a numerically stable ratio form:
 *   RUL(t) = ∫_t^U exp( (t/λ)^k − (u/λ)^k ) du   (integrand=1 at u=t).
 * The upper bound U is where the exponent difference reaches ~25 (contribution
 * negligible). For k=1 (memoryless) this correctly returns ≈ λ for every t.
 */
export function conditionalRemainingLife(shape: number, scale: number, ageHours: number): number {
  const k = shape;
  const lambda = scale;
  if (!(k > 0) || !(lambda > 0)) return NaN;
  const t = Math.max(0, ageHours);

  const ht = Math.pow(t / lambda, k); // hazard-integral at t (dimensionless)
  // Upper bound: (U/λ)^k − ht = 25  ⇒  U = λ·(ht+25)^(1/k)
  const U = lambda * Math.pow(ht + 25, 1 / k);
  if (!(U > t)) return 0;

  const N = 2000; // even → Simpson
  const h = (U - t) / N;
  const f = (u: number): number => {
    const hu = Math.pow(u / lambda, k);
    return Math.exp(ht - hu); // = R(u)/R(t), in (0,1]
  };

  let sum = f(t) + f(U);
  for (let i = 1; i < N; i++) {
    sum += (i % 2 === 1 ? 4 : 2) * f(t + i * h);
  }
  const integral = (h / 3) * sum;
  return Math.max(0, integral);
}

// ─── Weibull MLE with right-censoring ─────────────────────────────────────────

/**
 * Fit a 2-parameter Weibull to right-censored survival data by maximum likelihood.
 *
 * Concentrating out λ (λ^k = (Σ_i t_i^k)/r), the shape k solves the profile eq.
 *   f(k) = Σ_i t_i^k·ln t_i / Σ_i t_i^k − 1/k − (1/r)·Σ_{failures} ln t_i = 0
 * (sums in the ratio run over ALL observations incl. censored; r = #failures).
 * f is strictly increasing (Cauchy–Schwarz ⇒ variance term ≥ 0, plus 1/k²>0) so
 * Newton-Raphson from k=1 converges to the unique root. All power sums are formed
 * in the log domain with the max-log factored out, so t values of any magnitude
 * are safe. Returns null when there are no failures (nothing to estimate).
 */
export function fitWeibull(observations: FailureObservation[]): WeibullFit | null {
  const clean = observations.filter((o) => Number.isFinite(o.durationHours) && o.durationHours > 0);
  const times = clean.map((o) => o.durationHours);
  const isFailure = clean.map((o) => !o.censored);
  const failureLogs = clean.filter((o) => !o.censored).map((o) => Math.log(o.durationHours));
  const r = failureLogs.length;
  if (r === 0 || times.length < 2) return null;

  const logs = times.map((t) => Math.log(t));
  const maxLog = Math.max(...logs);
  const meanLnFailures = failureLogs.reduce((a, b) => a + b, 0) / r;

  // Power sums, stabilized: a_i = exp(k·(ln t_i − maxLog)) ∈ (0,1].
  const powerSums = (k: number) => {
    let P0 = 0, P1 = 0, P2 = 0;
    for (let i = 0; i < logs.length; i++) {
      const a = Math.exp(k * (logs[i] - maxLog));
      P0 += a;
      P1 += a * logs[i];
      P2 += a * logs[i] * logs[i];
    }
    return { P0, P1, P2 };
  };

  const f = (k: number) => {
    const { P0, P1 } = powerSums(k);
    return P1 / P0 - 1 / k - meanLnFailures;
  };
  const fPrime = (k: number) => {
    const { P0, P1, P2 } = powerSums(k);
    return (P2 * P0 - P1 * P1) / (P0 * P0) + 1 / (k * k);
  };

  const K_MIN = 0.05, K_MAX = 100;
  let k = 1;
  let iterations = 0;
  let bounded = false;
  for (; iterations < 100; iterations++) {
    const fk = f(k);
    if (Math.abs(fk) < 1e-10) break;
    const d = fPrime(k);
    if (!(Math.abs(d) > 1e-12)) break;
    let next = k - fk / d;
    // Damp into the bracket; f is monotone so this stays well-behaved.
    if (!(next > K_MIN)) next = (k + K_MIN) / 2;
    if (next > K_MAX) next = (k + K_MAX) / 2;
    if (Math.abs(next - k) < 1e-9) { k = next; break; }
    k = next;
  }
  if (k <= K_MIN + 1e-6 || k >= K_MAX - 1e-6) bounded = true;
  k = Math.min(K_MAX, Math.max(K_MIN, k));

  // λ = exp( maxLog + ln(P0/r)/k ).
  const { P0 } = powerSums(k);
  const lambda = Math.exp(maxLog + Math.log(P0 / r) / k);
  if (!(lambda > 0) || !Number.isFinite(lambda)) return null;

  return {
    shape: k,
    scale: lambda,
    failures: r,
    censored: clean.length - r,
    iterations,
    bounded,
  };
}

// ─── confidence from observation count (honest) ───────────────────────────────

/** Weibull-path confidence: saturating in the number of REAL failures. */
function weibullConfidence(failures: number): number {
  return Math.min(0.9, failures / (failures + 8));
}
/** Heuristic-fallback confidence: deliberately capped low (we did NOT fit). */
function heuristicConfidence(failures: number): number {
  return Math.min(0.35, failures / (failures + 20));
}

// ─── Pure orchestration (fit → RUL, with honest fallback) ─────────────────────

export interface EstimateRulOptions {
  minObservations?: number;
  /** Existing heuristic timeframe (hours) to fall back to when data is thin. */
  heuristicRulHours?: number | null;
  machineId?: number | null;
  machineType?: string | null;
  componentKey?: string;
}

/**
 * Produce a RUL estimate from survival observations at the current age. PURE — no
 * DB, no flag. Weibull when ≥ minObservations real failures fit cleanly; otherwise
 * honest 'heuristic' fallback (or 'insufficient_data' when no fallback exists).
 */
export function estimateRul(
  observations: FailureObservation[],
  ageHours: number | null,
  opts: EstimateRulOptions = {},
): RulEstimate {
  const min = Math.max(2, opts.minObservations ?? RUL_MIN_OBSERVATIONS);
  const componentKey = opts.componentKey ?? "machine";
  const machineId = opts.machineId ?? null;
  const machineType = opts.machineType ?? null;

  const failures = observations.filter((o) => !o.censored && Number.isFinite(o.durationHours) && o.durationHours > 0);
  const censored = observations.filter((o) => o.censored).length;
  const total = failures.length + censored;

  const base = { machineId, machineType, componentKey, ageHours, observations: total, failures: failures.length, censored };

  if (failures.length < min) {
    const hasFallback = opts.heuristicRulHours != null && Number.isFinite(opts.heuristicRulHours);
    return {
      ...base,
      method: hasFallback ? "heuristic" : "insufficient_data",
      rulHours: hasFallback ? Number(opts.heuristicRulHours) : null,
      shape: null,
      scale: null,
      confidence: hasFallback ? heuristicConfidence(failures.length) : 0,
      note: `Only ${failures.length} real failure observation(s) (need ${min}); ` +
        (hasFallback ? "using heuristic EWMA/MTBF proxy." : "no RUL available (cold start)."),
    };
  }

  const fit = fitWeibull(observations);
  if (!fit) {
    const hasFallback = opts.heuristicRulHours != null && Number.isFinite(opts.heuristicRulHours);
    return {
      ...base,
      method: hasFallback ? "heuristic" : "insufficient_data",
      rulHours: hasFallback ? Number(opts.heuristicRulHours) : null,
      shape: null,
      scale: null,
      confidence: hasFallback ? heuristicConfidence(failures.length) : 0,
      note: "Weibull fit did not converge on the available data; using heuristic fallback.",
    };
  }

  const rulHours = conditionalRemainingLife(fit.shape, fit.scale, ageHours ?? 0);
  return {
    ...base,
    method: "weibull",
    rulHours: Number.isFinite(rulHours) ? rulHours : null,
    shape: fit.shape,
    scale: fit.scale,
    confidence: weibullConfidence(fit.failures),
    note: `Weibull(k=${fit.shape.toFixed(2)}, λ=${fit.scale.toFixed(1)}h) over ${fit.failures} failure(s)` +
      `${fit.censored > 0 ? ` + ${fit.censored} censored` : ""}` +
      `${fit.bounded ? " [shape hit bound — degenerate data]" : ""}.`,
  };
}

// ─── DB layer: gather REAL failure history + estimate + persist ───────────────

interface GatheredHistory {
  observations: FailureObservation[];
  /** Age (hours since last failure) for the TARGET machine specifically. */
  ageHours: number | null;
  machineType: string | null;
  classMachineCount: number;
}

/** Hours between two dates. */
function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

/**
 * Gather survival observations for a machine, pooling over its equipment class
 * (machineType) from REAL failure history:
 *   • maintenance_work_orders — CORRECTIVE / BREAKDOWN openedAt
 *   • downtime_events         — unplanned/breakdown/failure/fault startTime
 *   • failure_events          — forward store (uncensored occurredAt)
 * Per machine: inter-arrival gaps = uncensored TTF; last-failure→now = censored.
 */
export async function gatherFailureObservations(machineId: number): Promise<GatheredHistory> {
  const empty: GatheredHistory = { observations: [], ageHours: null, machineType: null, classMachineCount: 0 };
  const db = await getDb();
  if (!db) return empty;

  const target = await db
    .select({ id: machines.id, machineType: machines.machineType })
    .from(machines)
    .where(eq(machines.id, machineId))
    .limit(1);
  if (target.length === 0) return empty;
  const machineType = (target[0].machineType as string) ?? null;

  // Class siblings (same equipment type) — pool to overcome sparse per-machine data.
  let classIds: number[] = [machineId];
  if (machineType) {
    const siblings = await db
      .select({ id: machines.id })
      .from(machines)
      .where(and(eq(machines.machineType, machineType as any), eq(machines.isActive, true)))
      .limit(RUL_MAX_CLASS_MACHINES);
    const ids = new Set<number>(siblings.map((s) => s.id));
    ids.add(machineId);
    classIds = [...ids];
  }

  const since = new Date(Date.now() - RUL_LOOKBACK_DAYS * 24 * 3_600_000);
  const now = new Date();

  // Per-machine sorted failure timestamps.
  const byMachine = new Map<number, Date[]>();
  const push = (mid: number, ts: Date) => {
    if (!byMachine.has(mid)) byMachine.set(mid, []);
    byMachine.get(mid)!.push(ts);
  };

  // (1) work orders
  const wos = await db
    .select({
      machineId: maintenanceWorkOrders.machineId,
      type: maintenanceWorkOrders.type,
      trigger: maintenanceWorkOrders.trigger,
      openedAt: maintenanceWorkOrders.openedAt,
    })
    .from(maintenanceWorkOrders)
    .where(and(inArray(maintenanceWorkOrders.machineId, classIds), gte(maintenanceWorkOrders.openedAt, since)));
  for (const w of wos) {
    if (!w.openedAt) continue;
    const isFailure = FAILURE_WO_TYPES.has(String(w.type)) || FAILURE_WO_TRIGGERS.has(String(w.trigger));
    if (isFailure) push(w.machineId, new Date(w.openedAt));
  }

  // (2) downtime events (unplanned)
  const dts = await db
    .select({
      machineId: downtimeEvents.machineId,
      category: downtimeEvents.category,
      startTime: downtimeEvents.startTime,
    })
    .from(downtimeEvents)
    .where(and(inArray(downtimeEvents.machineId, classIds), gte(downtimeEvents.startTime, since)));
  for (const d of dts) {
    if (!d.startTime) continue;
    if (UD_CATEGORIES.has(String(d.category).toLowerCase())) push(d.machineId, new Date(d.startTime));
  }

  // (3) failure_events (forward store, uncensored only — censored rows are derived below)
  const fes = await db
    .select({
      machineId: failureEvents.machineId,
      occurredAt: failureEvents.occurredAt,
      censored: failureEvents.censored,
    })
    .from(failureEvents)
    .where(and(inArray(failureEvents.machineId, classIds), gte(failureEvents.occurredAt, since)));
  for (const e of fes) {
    if (!e.occurredAt || e.censored) continue;
    push(e.machineId, new Date(e.occurredAt));
  }

  // Build inter-arrival observations per machine; dedupe near-identical timestamps
  // (<1h apart = same failure logged in two sources).
  const observations: FailureObservation[] = [];
  let ageHours: number | null = null;
  for (const [mid, rawTs] of byMachine) {
    const ts = rawTs.sort((a, b) => a.getTime() - b.getTime());
    const dedup: Date[] = [];
    for (const t of ts) {
      if (dedup.length === 0 || hoursBetween(dedup[dedup.length - 1], t) >= 1) dedup.push(t);
    }
    for (let i = 1; i < dedup.length; i++) {
      const gap = hoursBetween(dedup[i - 1], dedup[i]);
      if (gap > 0) observations.push({ durationHours: gap, censored: false });
    }
    if (dedup.length > 0) {
      const lastGap = hoursBetween(dedup[dedup.length - 1], now);
      if (lastGap > 0) {
        // Censored run-time-since-last-failure for the whole class …
        observations.push({ durationHours: lastGap, censored: true });
        // … and record the TARGET machine's own age for the conditioning time.
        if (mid === machineId) ageHours = lastGap;
      }
    }
  }

  return { observations, ageHours, machineType, classMachineCount: classIds.length };
}

/**
 * DB-backed RUL for a machine. Returns null (heuristic stays default) when the
 * flag is OFF — so callers behave EXACTLY as before unless RUL_WEIBULL_ENABLED is
 * on. Does NOT persist (read-only; persistence happens in the PdM cycle).
 */
export async function estimateRulForMachine(
  machineId: number,
  opts: { ageHours?: number | null; heuristicRulHours?: number | null; componentKey?: string } = {},
): Promise<RulEstimate | null> {
  if (!isRulWeibullEnabled()) return null;
  try {
    const history = await gatherFailureObservations(machineId);
    const ageHours = opts.ageHours ?? history.ageHours;
    return estimateRul(history.observations, ageHours ?? null, {
      heuristicRulHours: opts.heuristicRulHours ?? null,
      machineId,
      machineType: history.machineType,
      componentKey: opts.componentKey ?? "machine",
    });
  } catch (err) {
    console.error(`[RulEstimator] machine ${machineId} failed:`, (err as Error)?.message ?? err);
    return null;
  }
}

/** Persist a RUL estimate row (best-effort; called from the PdM cycle). */
export async function persistRulEstimate(estimate: RulEstimate): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(rulEstimates).values({
    machineId: estimate.machineId ?? 0,
    machineType: estimate.machineType,
    componentKey: estimate.componentKey,
    method: estimate.method,
    rulHours: estimate.rulHours,
    ageHours: estimate.ageHours,
    shape: estimate.shape,
    scale: estimate.scale,
    observations: estimate.observations,
    failures: estimate.failures,
    censored: estimate.censored,
    confidence: estimate.confidence,
    note: estimate.note,
  });
}

/** Latest persisted RUL estimate for a machine (read endpoint helper). */
export async function getLatestRulEstimate(machineId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(rulEstimates)
    .where(eq(rulEstimates.machineId, machineId))
    .orderBy(desc(rulEstimates.computedAt))
    .limit(1);
  return rows[0] ?? null;
}
