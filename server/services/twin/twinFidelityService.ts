/**
 * doc 44 W5-A1 (gap G4.1) — Digital-Twin fidelity loop (SYNAPSE Tầng-4 §5.2).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * "Twin chỉ hữu ích khi được hiệu chỉnh." Gap nặng nhất của Tầng 4: driftDetector
 * là hàm thuần nhưng chưa có ai nuôi nó bằng SỐ THẬT, không persist, không cơ
 * chế tự vô hiệu. Batch này khép vòng:
 *
 *   1. Chạy DES ngắn từ cấu hình tuyến hiện tại → DỰ ĐOÁN throughput + cycle.
 *   2. Đo THỰC TẾ cùng cửa sổ từ line_balance_metrics.
 *   3. err% = |sim − real| / real → detectDrift (ngưỡng TWIN_FIDELITY_THRESHOLD_PCT).
 *   4. Persist simulation_runs (mode='fidelity_check') + upsert twin_trust:
 *      lệch ≥ N lần LIÊN TIẾP ⇒ trusted=false + Andon; đạt ⇒ trusted=true, reset.
 *
 * isTwinTrusted(twinRef) là hàm public cho optimizer/advisor: twin untrusted ⇒
 * chỉ tham khảo, KHÔNG dùng cho quyết định tự động (spec §5.2). Thiếu dữ liệu
 * thật ⇒ SKIP honest (không bịa, không đổi trust). Sweep gated TWIN_FIDELITY_ENABLED
 * (default OFF), unref'd + non-overlapping (mirror configDriftService).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { detectDrift, type MetricPair } from "./driftDetector";
import type { SimConfig } from "../simulation/desEngine";

// ── flags / config (PURE) ─────────────────────────────────────────────────────

export function twinFidelityEnabled(): boolean {
  return process.env.TWIN_FIDELITY_ENABLED === "true";
}

export function twinFidelityIntervalMs(): number {
  const n = Number(process.env.TWIN_FIDELITY_INTERVAL_MS);
  // default 1h; floor 5 min so a typo cannot melt the DB with DES runs.
  return Number.isFinite(n) && n >= 5 * 60_000 ? n : 60 * 60 * 1000;
}

/** Fidelity threshold as a FRACTION (0.1 = 10% — SDD §5.7.3). */
export function twinFidelityThreshold(): number {
  const n = Number(process.env.TWIN_FIDELITY_THRESHOLD_PCT);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.1;
}

/** Consecutive breaches required before a twin is marked untrusted (min 1). */
export function twinFidelityBreachLimit(): number {
  const n = Number(process.env.TWIN_FIDELITY_BREACH_LIMIT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

// ── pure decision logic (unit-tested, no IO) ──────────────────────────────────

export interface FidelityInput {
  /** DES-predicted steady-state throughput (good parts / hour). */
  predictedThroughputPerHour: number;
  /** DES-predicted mean cycle time (seconds). */
  predictedCycleSec: number;
  /** Measured throughput (good parts / hour) over the same window. */
  actualThroughputPerHour: number;
  /** Measured mean cycle time (seconds). */
  actualCycleSec: number;
}

export interface FidelityEvaluation {
  pairs: MetricPair[];
  throughputErrPct: number;
  cycleErrPct: number;
  /** 100·(1 − max|err|), clamped to [0,100]. Higher = twin tracks reality better. */
  fidelityPct: number;
  breached: boolean;
  drifted: string[];
}

/**
 * Compare DES prediction to reality. `threshold` is a fraction (0.1 = 10%).
 * Uses the shared detectDrift() so the twin drift rule is defined in ONE place.
 */
export function evaluateFidelity(input: FidelityInput, threshold = twinFidelityThreshold()): FidelityEvaluation {
  const pairs: MetricPair[] = [
    { metric: "throughput_per_hour", simulated: input.predictedThroughputPerHour, actual: input.actualThroughputPerHour },
    { metric: "cycle_time_sec", simulated: input.predictedCycleSec, actual: input.actualCycleSec },
  ];
  const report = detectDrift(pairs, threshold);
  const errFor = (m: string) => {
    const item = report.items.find((i) => i.metric === m);
    return item ? Math.abs(item.relativeDrift) : 0;
  };
  const throughputErrPct = errFor("throughput_per_hour");
  const cycleErrPct = errFor("cycle_time_sec");
  const worst = Math.max(throughputErrPct, cycleErrPct);
  // Infinity (real=0, sim≠0) → fidelity 0.
  const fidelityPct = Number.isFinite(worst) ? Math.max(0, Math.min(100, 100 * (1 - worst))) : 0;
  return {
    pairs,
    throughputErrPct,
    cycleErrPct,
    fidelityPct,
    breached: !report.ok,
    drifted: report.drifted,
  };
}

export interface TrustDecision {
  trusted: boolean;
  consecutiveBreaches: number;
  /** True on the FIRST tick a trusted twin becomes untrusted (→ route ONE alert). */
  newlyUntrusted: boolean;
  reason: string;
}

/**
 * Fold a fidelity evaluation into the next trust state. A twin only flips to
 * untrusted after `breachLimit` CONSECUTIVE breaches (one noisy sample must not
 * disable the twin); a single good check restores trust immediately.
 */
export function decideTrust(
  evaluation: FidelityEvaluation,
  prev: { trusted: boolean; consecutiveBreaches: number },
  breachLimit = twinFidelityBreachLimit(),
): TrustDecision {
  if (!evaluation.breached) {
    return {
      trusted: true,
      consecutiveBreaches: 0,
      newlyUntrusted: false,
      reason: `fidelity ${evaluation.fidelityPct.toFixed(1)}% — within threshold`,
    };
  }
  const consecutiveBreaches = prev.consecutiveBreaches + 1;
  const trusted = consecutiveBreaches < breachLimit;
  const newlyUntrusted = prev.trusted && !trusted;
  const reason = trusted
    ? `drift on ${evaluation.drifted.join(", ")} (${consecutiveBreaches}/${breachLimit} consecutive) — still trusted`
    : `drift on ${evaluation.drifted.join(", ")} for ${consecutiveBreaches} consecutive checks — twin UNTRUSTED for auto decisions`;
  return { trusted, consecutiveBreaches, newlyUntrusted, reason };
}

// ── IO: read real, run DES, persist, upsert trust ─────────────────────────────

/** Resolve the factory a production line belongs to (line → workshop → factory). */
async function resolveFactoryForLine(lineId: number): Promise<number | null> {
  const { getDb } = await import("../../db/connection");
  const { productionLines, workshops } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) return null;
  const rows = await d
    .select({ factoryId: workshops.factoryId })
    .from(productionLines)
    .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .where(eq(productionLines.id, lineId))
    .limit(1);
  return rows[0]?.factoryId ?? null;
}

export interface FidelityCheckResult {
  lineId: number;
  twinRef: string;
  /** "skipped" when the twin can't be built or real data is missing (HONEST). */
  status: "checked" | "skipped";
  skipReason?: string;
  evaluation?: FidelityEvaluation;
  trust?: TrustDecision;
}

/**
 * Run one fidelity check for a line: DES prediction vs measured line_balance.
 * Persists a simulation_runs row (mode='fidelity_check') and upserts twin_trust.
 * Returns "skipped" (no writes) when the twin can't be built or reality is absent.
 */
export async function runFidelityCheck(lineId: number): Promise<FidelityCheckResult> {
  const twinRef = `line:${lineId}`;

  // 1. Measured reality (line_balance_metrics latest).
  const { getLatestLineBalance } = await import("../../db/lineBalance");
  const real = await getLatestLineBalance(lineId);
  if (!real || real.avgCycleTimeMs == null || real.throughputUnits <= 0 || !real.periodStart || !real.periodEnd) {
    return { lineId, twinRef, status: "skipped", skipReason: "no measured line_balance (throughput/cycle) for this line" };
  }
  const windowHours = (Date.parse(real.periodEnd) - Date.parse(real.periodStart)) / 3_600_000;
  if (!(windowHours > 0)) {
    return { lineId, twinRef, status: "skipped", skipReason: "line_balance window is zero/negative" };
  }
  const actualThroughputPerHour = real.throughputUnits / windowHours;
  const actualCycleSec = real.avgCycleTimeMs / 1000;

  // 2. DES prediction from the current line configuration.
  const factoryId = await resolveFactoryForLine(lineId);
  if (factoryId == null) {
    return { lineId, twinRef, status: "skipped", skipReason: "cannot resolve factory for line" };
  }
  const { buildSceneGraph } = await import("./sceneGraph");
  const { buildLineModelFromScene } = await import("../simulation/desModel");
  const { runDes } = await import("../simulation/desEngine");
  const scene = await buildSceneGraph(factoryId);
  const line = scene.lines.find((l) => l.refId === lineId);
  if (!line || line.stations.length === 0) {
    return { lineId, twinRef, status: "skipped", skipReason: "twin scene has no line/stations to simulate" };
  }
  let predictedThroughputPerHour: number;
  let predictedCycleSec: number;
  try {
    const model = buildLineModelFromScene(line);
    const des = runDes(model, {} as SimConfig);
    if (!des.ok || des.throughputPerHour <= 0) {
      return { lineId, twinRef, status: "skipped", skipReason: "DES run degraded / zero throughput" };
    }
    predictedThroughputPerHour = des.throughputPerHour;
    predictedCycleSec = des.cycleTime.meanSec;
  } catch (err) {
    return { lineId, twinRef, status: "skipped", skipReason: `DES error: ${(err as Error)?.message ?? err}` };
  }

  // 3. Evaluate + fold into trust.
  const evaluation = evaluateFidelity({
    predictedThroughputPerHour,
    predictedCycleSec,
    actualThroughputPerHour,
    actualCycleSec,
  });
  const prev = await getTwinTrust(twinRef);
  const trust = decideTrust(evaluation, { trusted: prev?.trusted ?? true, consecutiveBreaches: prev?.consecutiveBreaches ?? 0 });

  // 4. Persist run + upsert trust.
  await persistFidelity({
    twinRef,
    lineId,
    scenario: { windowHours, source: "line_balance_metrics" },
    result: {
      predictedThroughputPerHour,
      predictedCycleSec,
      actualThroughputPerHour,
      actualCycleSec,
      bottleneck: null,
    },
    fidelity: {
      cycle_err_pct: evaluation.cycleErrPct,
      throughput_err_pct: evaluation.throughputErrPct,
      fidelity_pct: evaluation.fidelityPct,
      sample_window_hours: windowHours,
      computed_at: new Date().toISOString(),
    },
    trust,
    fidelityPct: evaluation.fidelityPct,
  });

  // 5. One Andon warning on the tick a twin first becomes untrusted.
  if (trust.newlyUntrusted) {
    try {
      const { routeAlert } = await import("../aiSmartAlertRouter");
      await routeAlert({
        type: "PATTERN_ANOMALY",
        severity: "MEDIUM",
        message: `Digital twin ${twinRef} lệch thực tế quá ngưỡng — đã VÔ HIỆU cho quyết định tự động. ${trust.reason}`,
        data: { twinRef, fidelityPct: evaluation.fidelityPct, drifted: evaluation.drifted, runbookRef: "rb-twin-recalibrate" },
      });
    } catch (err) {
      console.error("[twinFidelity] routeAlert failed:", (err as Error)?.message ?? err);
    }
  }

  return { lineId, twinRef, status: "checked", evaluation, trust };
}

// ── persistence ───────────────────────────────────────────────────────────────

interface TwinTrustRow {
  twinRef: string;
  trusted: boolean;
  consecutiveBreaches: number;
  fidelityPct: number | null;
}

async function getTwinTrust(twinRef: string): Promise<TwinTrustRow | null> {
  const { getDb } = await import("../../db/connection");
  const { twinTrust } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) return null;
  const [row] = await d.select().from(twinTrust).where(eq(twinTrust.twinRef, twinRef)).limit(1);
  return row
    ? { twinRef: row.twinRef, trusted: row.trusted, consecutiveBreaches: row.consecutiveBreaches, fidelityPct: row.fidelityPct ?? null }
    : null;
}

async function persistFidelity(args: {
  twinRef: string;
  lineId: number;
  scenario: Record<string, unknown>;
  result: Record<string, unknown>;
  fidelity: Record<string, unknown>;
  trust: TrustDecision;
  fidelityPct: number;
}): Promise<void> {
  const { getDb } = await import("../../db/connection");
  const { simulationRuns, twinTrust } = await import("../../../drizzle/schema");
  const d = await getDb();
  if (!d) return;
  const now = new Date();
  const simId = `sim-fid-${args.lineId}-${now.getTime()}`;
  await d.insert(simulationRuns).values({
    simId,
    twinRef: args.twinRef,
    mode: "fidelity_check",
    scenario: args.scenario,
    result: args.result,
    fidelity: args.fidelity,
    status: "done",
    finishedAt: now,
  });
  await d
    .insert(twinTrust)
    .values({
      twinRef: args.twinRef,
      trusted: args.trust.trusted,
      fidelityPct: args.fidelityPct,
      consecutiveBreaches: args.trust.consecutiveBreaches,
      lastCheckAt: now,
      reason: args.trust.reason,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: twinTrust.twinRef,
      set: {
        trusted: args.trust.trusted,
        fidelityPct: args.fidelityPct,
        consecutiveBreaches: args.trust.consecutiveBreaches,
        lastCheckAt: now,
        reason: args.trust.reason,
        updatedAt: now,
      },
    });
}

/**
 * PUBLIC — is a twin trustworthy enough for AUTOMATED decisions? Consumed by the
 * optimizer / advisor (spec §5.2). Default TRUE (no record yet = never failed a
 * check); DB unavailable = TRUE (honest: cannot prove untrusted, don't block).
 */
export async function isTwinTrusted(twinRef: string): Promise<boolean> {
  try {
    const row = await getTwinTrust(twinRef);
    return row ? row.trusted : true;
  } catch {
    return true;
  }
}

// ── sweep ─────────────────────────────────────────────────────────────────────

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

/** Run a fidelity check for every active production line. Non-overlapping. */
export async function sweepTwinFidelity(): Promise<{ checked: number; skipped: number }> {
  if (sweeping) return { checked: 0, skipped: 0 };
  sweeping = true;
  let checked = 0;
  let skipped = 0;
  try {
    const { getDb } = await import("../../db/connection");
    const { productionLines } = await import("../../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { checked: 0, skipped: 0 };
    const lines = await d.select({ id: productionLines.id }).from(productionLines).where(eq(productionLines.isActive, true));
    for (const l of lines) {
      try {
        const r = await runFidelityCheck(l.id);
        if (r.status === "checked") checked++;
        else skipped++;
      } catch (err) {
        skipped++;
        console.error(`[twinFidelity] line ${l.id} check failed:`, (err as Error)?.message ?? err);
      }
    }
  } finally {
    sweeping = false;
  }
  return { checked, skipped };
}

/** Start the fidelity sweep. No-op unless TWIN_FIDELITY_ENABLED=true. Idempotent. */
export function startTwinFidelitySweep(): void {
  if (sweepTimer || !twinFidelityEnabled()) return;
  const interval = twinFidelityIntervalMs();
  sweepTimer = setInterval(() => {
    void sweepTwinFidelity().catch((err) => console.error("[twinFidelity] sweep failed:", (err as Error)?.message ?? err));
  }, interval);
  sweepTimer.unref?.();
  console.log(`[twinFidelity] sweep started (every ${Math.round(interval / 60000)} min)`);
}

export function stopTwinFidelitySweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Test-only: reset the in-process sweep latch. */
export function _resetTwinFidelityForTests(): void {
  stopTwinFidelitySweep();
  sweeping = false;
}
