import * as db from "../db/aiAdvanced";

/**
 * Collect and store a performance snapshot for a model over a time period
 */
export async function collectPerformanceSnapshot(options: {
  modelId: number;
  modelVersion: string;
  periodStart: Date;
  periodEnd: Date;
}) {
  const stats = await db.getInferenceStatsForPeriod(
    options.modelId,
    options.modelVersion,
    options.periodStart,
    options.periodEnd,
  );

  const snapshot = await db.createPerformanceSnapshot({
    modelId: options.modelId,
    modelVersion: options.modelVersion,
    periodStart: options.periodStart,
    periodEnd: options.periodEnd,
    totalInferences: stats.totalInferences,
    completedInferences: stats.completedInferences,
    failedInferences: stats.failedInferences,
    avgLatencyMs: String(stats.avgLatencyMs),
    p50LatencyMs: String(stats.p50LatencyMs),
    p95LatencyMs: String(stats.p95LatencyMs),
    p99LatencyMs: String(stats.p99LatencyMs),
    accuracy: stats.accuracy != null ? String(stats.accuracy) : null,
    precision: stats.precision != null ? String(stats.precision) : null,
    recall: stats.recall != null ? String(stats.recall) : null,
    f1Score: stats.f1Score != null ? String(stats.f1Score) : null,
    confidenceDistribution: stats.confidenceDistribution,
    labelDistribution: stats.labelDistribution,
    errorRate: String(stats.errorRate),
    timeoutRate: String(stats.timeoutRate),
  });

  // After snapshot, check for drift
  await detectDrift(options.modelId, options.modelVersion, snapshot);

  return snapshot;
}

/**
 * Detect data/concept drift by comparing current snapshot to baseline
 */
async function detectDrift(
  modelId: number,
  modelVersion: string,
  currentSnapshot: NonNullable<Awaited<ReturnType<typeof db.createPerformanceSnapshot>>>,
) {
  const baseline = await db.getBaselineSnapshot(modelId, modelVersion);
  if (!baseline) return; // No baseline to compare against

  const alerts: Array<{
    alertType: "ACCURACY_DROP" | "LATENCY_SPIKE" | "DRIFT_DETECTED" | "ERROR_RATE_HIGH";
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    message: string;
    details: Record<string, unknown>;
    currentValue: string;
    baselineValue: string;
  }> = [];

  // 1. Check accuracy drop
  if (currentSnapshot.accuracy != null && baseline.accuracy != null) {
    const drop = Number(baseline.accuracy) - Number(currentSnapshot.accuracy);
    if (drop > 0.1) {
      alerts.push({
        alertType: "ACCURACY_DROP",
        severity: drop > 0.2 ? "CRITICAL" : "HIGH",
        message: `Accuracy dropped by ${(drop * 100).toFixed(1)}% from baseline`,
        details: { current: currentSnapshot.accuracy, baseline: baseline.accuracy },
        currentValue: String(Number(currentSnapshot.accuracy)),
        baselineValue: String(Number(baseline.accuracy)),
      });
    }
  }

  // 2. Check latency spike
  if (currentSnapshot.p95LatencyMs != null && baseline.p95LatencyMs != null) {
    const ratio = Number(currentSnapshot.p95LatencyMs) / Number(baseline.p95LatencyMs);
    if (ratio > 2) {
      alerts.push({
        alertType: "LATENCY_SPIKE",
        severity: ratio > 5 ? "HIGH" : "MEDIUM",
        message: `P95 latency increased ${ratio.toFixed(1)}x from baseline`,
        details: { currentP95: currentSnapshot.p95LatencyMs, baselineP95: baseline.p95LatencyMs },
        currentValue: String(Number(currentSnapshot.p95LatencyMs)),
        baselineValue: String(Number(baseline.p95LatencyMs)),
      });
    }
  }

  // 3. Check error rate
  if (currentSnapshot.errorRate != null && baseline.errorRate != null) {
    const currentErr = Number(currentSnapshot.errorRate);
    const baselineErr = Number(baseline.errorRate);
    if (currentErr > 0.05 && currentErr > baselineErr * 2) {
      alerts.push({
        alertType: "ERROR_RATE_HIGH",
        severity: currentErr > 0.15 ? "CRITICAL" : currentErr > 0.1 ? "HIGH" : "MEDIUM",
        message: `Error rate ${(currentErr * 100).toFixed(1)}% exceeds baseline ${(baselineErr * 100).toFixed(1)}%`,
        details: { current: currentErr, baseline: baselineErr },
        currentValue: String(currentErr),
        baselineValue: String(baselineErr),
      });
    }
  }

  // 4. Distribution drift (PSI — Population Stability Index)
  if (currentSnapshot.labelDistribution && baseline.labelDistribution) {
    const psi = calculatePSI(
      baseline.labelDistribution as Record<string, number>,
      currentSnapshot.labelDistribution as Record<string, number>,
    );
    if (psi > 0.2) {
      alerts.push({
        alertType: "DRIFT_DETECTED",
        severity: psi > 0.5 ? "CRITICAL" : psi > 0.3 ? "HIGH" : "MEDIUM",
        message: `Label distribution drift detected (PSI: ${psi.toFixed(3)})`,
        details: {
          psi,
          currentDistribution: currentSnapshot.labelDistribution,
          baselineDistribution: baseline.labelDistribution,
        },
        currentValue: String(psi),
        baselineValue: "0",
      });
    }

    // Store drift score on the snapshot
    await db.updatePerformanceSnapshot(currentSnapshot.id, {
      driftScore: String(psi),
      driftDetails: { psiScore: psi, method: "PSI", baselineSnapshotId: baseline.id } as any,
    });
  }

  // Create alerts
  for (const alert of alerts) {
    await db.createDriftAlert({
      modelId,
      modelVersion,
      ...alert,
    });
  }
}

/**
 * Calculate Population Stability Index between two distributions
 */
function calculatePSI(
  baseline: Record<string, number>,
  current: Record<string, number>,
): number {
  const allLabels = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  const baselineTotal = Object.values(baseline).reduce((s, v) => s + v, 0) || 1;
  const currentTotal = Object.values(current).reduce((s, v) => s + v, 0) || 1;

  let psi = 0;
  for (const label of Array.from(allLabels)) {
    const bPct = Math.max((baseline[label] ?? 0) / baselineTotal, 0.0001);
    const cPct = Math.max((current[label] ?? 0) / currentTotal, 0.0001);
    psi += (cPct - bPct) * Math.log(cPct / bPct);
  }

  return psi;
}

/**
 * Get model health dashboard data
 */
export async function getModelHealth(modelId: number, modelVersion?: string) {
  const [latestSnapshot, recentAlerts, snapshots] = await Promise.all([
    db.getLatestPerformanceSnapshot(modelId, modelVersion),
    db.getUnacknowledgedAlerts(modelId, modelVersion),
    db.getPerformanceSnapshots(modelId, modelVersion, 30),
  ]);

  const healthScore = calculateHealthScore(latestSnapshot, recentAlerts);

  return {
    healthScore,
    healthStatus: healthScore >= 90 ? "HEALTHY" : healthScore >= 70 ? "WARNING" : "CRITICAL",
    latestSnapshot,
    activeAlerts: recentAlerts,
    trend: snapshots.map((s: any) => ({
      periodEnd: s.periodEnd,
      accuracy: s.accuracy,
      avgLatencyMs: s.avgLatencyMs,
      errorRate: s.errorRate,
      totalInferences: s.totalInferences,
      driftScore: s.driftScore,
    })),
  };
}

function calculateHealthScore(
  snapshot: Awaited<ReturnType<typeof db.getLatestPerformanceSnapshot>>,
  alerts: Awaited<ReturnType<typeof db.getUnacknowledgedAlerts>>,
): number {
  let score = 100;

  if (!snapshot) return 50; // No data

  // Accuracy penalty
  if (snapshot.accuracy != null) {
    const acc = Number(snapshot.accuracy);
    if (acc < 0.9) score -= (0.9 - acc) * 100;
  }

  // Error rate penalty
  if (snapshot.errorRate != null) {
    const err = Number(snapshot.errorRate);
    if (err > 0.01) score -= err * 200;
  }

  // Alert penalties
  for (const alert of alerts) {
    if (alert.severity === "CRITICAL") score -= 15;
    else if (alert.severity === "HIGH") score -= 10;
    else if (alert.severity === "MEDIUM") score -= 5;
    else score -= 2;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Acknowledge a drift alert
 */
export async function acknowledgeDriftAlert(alertId: number, userId: number) {
  return db.updateDriftAlert(alertId, {
    acknowledged: true,
    acknowledgedBy: userId,
    acknowledgedAt: new Date(),
  });
}

/**
 * Resolve a drift alert
 */
export async function resolveDriftAlert(alertId: number) {
  return db.updateDriftAlert(alertId, {
    resolvedAt: new Date(),
  });
}
