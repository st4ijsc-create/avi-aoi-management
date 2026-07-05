/**
 * W4-D (doc 27 §8 gap B7) — Background scheduler bootstrap.
 * =========================================================
 * The ~30 schedulers the monolith entry used to start inline are split here
 * into the CRON-LIKE, request-decoupled set, so the same init functions can be
 * started by either entry:
 *
 *   ROLE (env)      | HTTP/API/socket/MQTT | schedulers in this file
 *   ----------------|----------------------|------------------------
 *   (unset, default)| yes                  | yes  — all-in-one, behaviour unchanged
 *   "api"           | yes                  | NO   — run `npm run start:worker` alongside
 *   "worker"        | no                   | yes  — scheduler-only process, no HTTP bind
 *
 * WHAT BELONGS HERE (moved): pure cron/interval sweeps whose only side effects
 * are DB writes, filesystem cleanup, outbound HTTP/e-mail — reports, backups,
 * retention/image lifecycle, matview refresh, integrity scan, AI cron jobs
 * (batch RCA, self-learning, anomaly-bank rebuild, threshold auto-tune,
 * KB sync, model rollback/perf sweeps), predictive maintenance, PdM
 * work-orders, DR verify, edge staleness checks, fleet DB-state sweeps and the
 * ERP outbox drain (whose single-instance placement here also removes the R9
 * double-drain risk when running api+worker).
 *
 * WHAT STAYS IN THE API ENTRY (request-coupled — judged one by one):
 * Socket.IO emitters (twin/device/field stream gateways, offline monitor,
 * alert escalation/evaluator, federation aggregator's live site updates,
 * safety sim tracks), the in-process MQTT broker + its sub-schedulers,
 * event-bus subscribers (orchestration rules, AI watcher, auto-proposer,
 * fleet orchestrator, ecosystem bridges), ingest paths (hot-folder,
 * inspection store-forward WAL restore) and device/control gateways
 * (robots, VDA5050, ROS2, OPC-UA, OT, MTConnect, interlock, FOE rehydrate).
 *
 * SINGLE-WORKER ASSUMPTION (documented, out of scope to enforce): there is NO
 * leader election — run exactly ONE worker process per deployment. Running
 * two workers (or a worker next to a default all-in-one API) double-schedules
 * the jobs in this file.
 *
 * Fail-safe: every start is individually try/caught (a broken scheduler must
 * never take down boot) — semantics copied verbatim from the old inline blocks.
 */

let started = false;
let chargingSweepTimer: NodeJS.Timeout | null = null;

export function backgroundSchedulersStarted(): boolean {
  return started;
}

export async function startBackgroundSchedulers(): Promise<void> {
  if (started) return;
  started = true;

  // Scheduled + executive reports (e-mail delivery; non-blocking with retry).
  try {
    const { initializeScheduledReports, startExecutiveReportScheduler } = await import(
      "../services/reportScheduler"
    );
    initializeScheduledReports().catch((err: any) => {
      console.error(
        "[ReportScheduler] Initialization failed, process continues without scheduled reports:",
        err?.message || err,
      );
    });
    startExecutiveReportScheduler();
  } catch (err) {
    console.error("[ReportScheduler] init failed:", (err as any)?.message || err);
  }

  // W5-D (doc 27 §6 A11) — report-delivery drain worker (retry/backoff over the
  // report_deliveries ledger for reports that opted into deliveryChannels).
  // Default ON; escape hatch REPORT_DELIVERY_WORKER_ENABLED=false.
  try {
    const { startReportDeliveryWorker } = await import("../services/reportDeliveryService");
    startReportDeliveryWorker();
  } catch (err) {
    console.error("[ReportDelivery] worker start failed:", (err as any)?.message || err);
  }

  // Scheduled backups (ISO 22301 DR — non-blocking).
  try {
    const { initializeScheduledBackups } = await import("../services/backupSchedulerService");
    initializeScheduledBackups().catch((err: any) => {
      console.error("[BackupScheduler] Initialization failed:", err?.message || err);
    });
  } catch (err) {
    console.error("[BackupScheduler] init failed:", (err as any)?.message || err);
  }

  // S3.4 — AI batch RCA cron (daily 02:00 by default).
  try {
    const { initBatchRcaScheduler } = await import("../services/aiBatchRcaScheduler");
    initBatchRcaScheduler();
  } catch (err) {
    console.error("[aiBatchRcaScheduler] init failed:", (err as any)?.message || err);
  }

  // WS-1 — AI self-learning scan. Opt in via AI_SELF_LEARNING_ENABLED=true.
  try {
    const { initSelfLearningScheduler } = await import("../services/aiSelfLearningScheduler");
    initSelfLearningScheduler();
  } catch (err) {
    console.error("[aiSelfLearningScheduler] init failed:", (err as any)?.message || err);
  }

  // WS-4 — Predictive maintenance cycle. Opt in via PREDICTIVE_MAINTENANCE_ENABLED=true.
  try {
    const { startPredictiveMaintenanceJob } = await import("../services/predictiveMaintenanceService");
    startPredictiveMaintenanceJob(30); // every 30 minutes
  } catch (err) {
    console.error("[PredictiveMaintenance] init failed:", (err as any)?.message || err);
  }

  // WS-2 — Edge stale-deployment checker (ACTIVE→OUTDATED past threshold).
  try {
    const { startEdgeStaleScheduler } = await import("../services/edgeStaleScheduler");
    startEdgeStaleScheduler();
  } catch (err) {
    console.error("[EdgeStale] init failed:", (err as any)?.message || err);
  }

  // E4 — Edge node heartbeat checker (online→offline when heartbeat stale).
  try {
    const { startEdgeNodeHealthChecker } = await import("../services/edge/edgeNodeHealthScheduler");
    startEdgeNodeHealthChecker();
  } catch (err) {
    console.error("[EdgeNodeHealth] init failed:", (err as any)?.message || err);
  }

  // QW3 — Materialized view refresh. Opt in via MATVIEW_REFRESH_ENABLED=true.
  try {
    const { startMaterializedViewRefresh } = await import("../services/materializedViewRefreshService");
    startMaterializedViewRefresh();
  } catch (err) {
    console.error("[MatviewRefresh] init failed:", (err as any)?.message || err);
  }

  // P1 WS1.1 — Data retention pruning. Opt in via DATA_RETENTION_ENABLED=true.
  try {
    const { startDataRetention } = await import("../services/dataRetentionService");
    startDataRetention();
  } catch (err) {
    console.error("[Retention] init failed:", (err as any)?.message || err);
  }

  // Doc 27 §11 #2/#5 — image lifecycle on the uploads volume (same master
  // switch as row retention). NOTE: in a split topology the worker must see
  // the SAME uploads volume as the API (single-host or shared mount).
  try {
    const { startImageLifecycle } = await import("../services/imageLifecycleService");
    startImageLifecycle();
  } catch (err) {
    console.error("[ImageLifecycle] init failed:", (err as any)?.message || err);
  }

  // B3 — Anomaly bank auto-rebuild. Opt in via ANOMALY_BANK_AUTO_REBUILD_ENABLED=true.
  try {
    const { startAnomalyBankScheduler } = await import("../services/aiAnomalyBankScheduler");
    startAnomalyBankScheduler();
  } catch (err) {
    console.error("[anomalyBankScheduler] init failed:", (err as any)?.message || err);
  }

  // Threshold auto-tune (HITL). Opt in via AI_THRESHOLD_AUTOTUNE_ENABLED=true.
  try {
    const { startThresholdTuneScheduler } = await import("../services/aiThresholdTuneScheduler");
    startThresholdTuneScheduler();
  } catch (err) {
    console.error("[aiThresholdTuneScheduler] init failed:", (err as any)?.message || err);
  }

  // Doc 31 OP9 — periodic Cpk snapshot → cpk_history. Opt in via CPK_SNAPSHOT_ENABLED=true.
  try {
    const { startCpkSnapshotScheduler } = await import("../services/cpkSnapshotScheduler");
    startCpkSnapshotScheduler();
  } catch (err) {
    console.error("[cpkSnapshotScheduler] init failed:", (err as any)?.message || err);
  }

  // doc 11 · W1.2 — KB auto-sync nightly cron. Opt in via KB_AUTOSYNC_ENABLED=true.
  try {
    const { startKbSyncScheduler } = await import("../services/kbSyncScheduler");
    startKbSyncScheduler();
  } catch (err) {
    console.error("[kbSyncScheduler] init failed:", (err as any)?.message || err);
  }

  // W3-A (doc 27 §2 M1/M6/M11) — weekly master-data integrity scan (default ON).
  try {
    const { startIntegrityScanScheduler } = await import("../services/integrityScanService");
    startIntegrityScanScheduler();
  } catch (err) {
    console.error("[integrityScan] init failed:", (err as any)?.message || err);
  }

  // W8-A (doc 27 M13 / doc 29 §4.2) — weekly machines.capabilities drift scan vs
  // deviceTypes contract (default ON; read + jsonb re-stamp only, bounded work).
  try {
    const { startCapabilitiesDriftScheduler } = await import("../services/standards/capabilitiesValidation");
    startCapabilitiesDriftScheduler();
  } catch (err) {
    console.error("[capabilitiesDrift] init failed:", (err as any)?.message || err);
  }

  // I2-b (doc 16 Khối 4) — model auto-rollback sweep (flag-gated no-op).
  try {
    const { startModelAutoRollbackSweep } = await import("../services/ai/modelAutoRollback");
    startModelAutoRollbackSweep();
  } catch (err) {
    console.error("[modelAutoRollback] sweep start failed:", (err as any)?.message || err);
  }

  // doc 22 P2 — model performance snapshot producer (flag-gated no-op).
  try {
    const { startModelPerfSnapshotSweep } = await import("../services/ai/modelPerfSnapshotProducer");
    startModelPerfSnapshotSweep();
  } catch (err) {
    console.error("[modelPerfSnapshots] sweep start failed:", (err as any)?.message || err);
  }

  // R0 (doc 16 Khối 0) — ERP integration outbox drain worker (no-op unless
  // ERP_OUTBOX_ENABLED=true). Single placement here also removes the R9
  // double-drain risk when running ROLE=api + ROLE=worker.
  try {
    const { startOutboxWorker } = await import("../services/integration/erpOutbox");
    startOutboxWorker();
  } catch (err) {
    console.error("[erpOutbox] worker start failed:", (err as any)?.message || err);
  }

  // doc 22 P3 — fleet pending-drain sweep (no-op unless FLEET_ORCH_ENABLED).
  try {
    const { startFleetRebalanceSweep } = await import("../services/fleet/taskAllocator");
    startFleetRebalanceSweep();
  } catch (err) {
    console.error("[Fleet] pending-drain sweep start failed:", (err as any)?.message || err);
  }

  // G2 (doc 16 Khối 2 c&d) — predictive charging sweep (no-op unless
  // FLEET_RESOURCE_ENABLED — sweepChargingPlans self-gates). Unref'd +
  // non-overlapping; only writes 'planned' rows consumed by the gated dispatcher.
  try {
    const { sweepChargingPlans } = await import("../services/fleet/chargingPlanner");
    const intervalMs = Math.max(60_000, Number(process.env.FLEET_CHARGING_SWEEP_MS ?? 300_000));
    let sweeping = false;
    chargingSweepTimer = setInterval(async () => {
      if (sweeping) return; // no overlap
      sweeping = true;
      try {
        const r = await sweepChargingPlans();
        if (r.enabled && r.scheduled > 0)
          console.log(`[Fleet] charging sweep: ${r.scheduled} plan(s) scheduled`);
      } catch (err) {
        console.error("[Fleet] charging sweep failed:", (err as any)?.message || err);
      } finally {
        sweeping = false;
      }
    }, intervalMs);
    if (typeof chargingSweepTimer.unref === "function") chargingSweepTimer.unref();
  } catch (err) {
    console.error("[Fleet] charging planner start failed:", (err as any)?.message || err);
  }

  // G2/G7 — PdM closed-loop work-orders. Opt in via PDM_WORKORDER_ENABLED=true.
  try {
    const { startPdmWorkOrderService } = await import("../services/pdmWorkOrderService");
    startPdmWorkOrderService();
  } catch (err) {
    console.error("[PdmWorkOrder] init failed:", (err as any)?.message || err);
  }

  // G3/G12 — DR verify-restore cadence. Opt in via DR_VERIFY_ENABLED=true.
  try {
    const { startDisasterRecoveryService } = await import("../services/disasterRecoveryService");
    startDisasterRecoveryService();
  } catch (err) {
    console.error("[DR] init failed:", (err as any)?.message || err);
  }

  // SYNAPSE I6 (doc 33 §11) — daily MES/ERP/WMS reconciliation cycle. No-op unless RECONCILE_CRON=true.
  try {
    const { startReconciliationScheduler } = await import("../services/contracts/reconciliationCron");
    startReconciliationScheduler();
  } catch (err) {
    console.error("[Reconcile] scheduler start failed:", (err as any)?.message || err);
  }

  console.log("[BackgroundJobs] cron-like schedulers started (W4-D/B7 set)");
}

/**
 * Stop everything startBackgroundSchedulers started. Every stop is an
 * idempotent no-op when the scheduler never ran, so this is safe to call from
 * any entry's shutdown path regardless of ROLE.
 */
export function stopBackgroundSchedulers(): void {
  if (chargingSweepTimer) {
    clearInterval(chargingSweepTimer);
    chargingSweepTimer = null;
  }
  import("../services/reportScheduler")
    .then((m) => {
      m.shutdownScheduledReports();
      m.stopExecutiveReportScheduler();
    })
    .catch(() => {});
  import("../services/reportDeliveryService")
    .then((m) => m.stopReportDeliveryWorker())
    .catch(() => {});
  import("../services/backupSchedulerService")
    .then((m) => m.shutdownScheduledBackups())
    .catch(() => {});
  import("../services/aiBatchRcaScheduler")
    .then((m) => m.stopBatchRcaScheduler())
    .catch(() => {});
  import("../services/aiSelfLearningScheduler")
    .then((m) => m.stopSelfLearningScheduler())
    .catch(() => {});
  import("../services/predictiveMaintenanceService")
    .then((m) => m.stopPredictiveMaintenanceJob())
    .catch(() => {});
  import("../services/edgeStaleScheduler")
    .then((m) => m.stopEdgeStaleScheduler())
    .catch(() => {});
  import("../services/edge/edgeNodeHealthScheduler")
    .then((m) => m.stopEdgeNodeHealthChecker())
    .catch(() => {});
  import("../services/materializedViewRefreshService")
    .then((m) => m.stopMaterializedViewRefresh())
    .catch(() => {});
  import("../services/dataRetentionService")
    .then((m) => m.stopDataRetention())
    .catch(() => {});
  import("../services/imageLifecycleService")
    .then((m) => m.stopImageLifecycle())
    .catch(() => {});
  import("../services/aiAnomalyBankScheduler")
    .then((m) => m.stopAnomalyBankScheduler())
    .catch(() => {});
  import("../services/aiThresholdTuneScheduler")
    .then((m) => m.stopThresholdTuneScheduler())
    .catch(() => {});
  import("../services/cpkSnapshotScheduler")
    .then((m) => m.stopCpkSnapshotScheduler())
    .catch(() => {});
  import("../services/kbSyncScheduler")
    .then((m) => m.stopKbSyncScheduler())
    .catch(() => {});
  import("../services/integrityScanService")
    .then((m) => m.stopIntegrityScanScheduler())
    .catch(() => {});
  import("../services/standards/capabilitiesValidation")
    .then((m) => m.stopCapabilitiesDriftScheduler())
    .catch(() => {});
  import("../services/ai/modelAutoRollback")
    .then((m) => m.stopModelAutoRollbackSweep())
    .catch(() => {});
  import("../services/ai/modelPerfSnapshotProducer")
    .then((m) => m.stopModelPerfSnapshotSweep())
    .catch(() => {});
  import("../services/integration/erpOutbox")
    .then((m) => m.stopOutboxWorker())
    .catch(() => {});
  import("../services/fleet/taskAllocator")
    .then((m) => m.stopFleetRebalanceSweep())
    .catch(() => {});
  import("../services/pdmWorkOrderService")
    .then((m) => m.stopPdmWorkOrderService())
    .catch(() => {});
  import("../services/disasterRecoveryService")
    .then((m) => m.stopDisasterRecoveryService())
    .catch(() => {});
  import("../services/contracts/reconciliationCron")
    .then((m) => m.stopReconciliationScheduler())
    .catch(() => {});
  started = false;
}

/**
 * W4-D (B7) — scheduler-only worker process (no express, no HTTP bind, no
 * Socket.IO, no MQTT broker). Entry: `server/worker.ts` (npm run start:worker)
 * or the main entry with ROLE=worker.
 */
export async function runWorkerProcess(): Promise<void> {
  console.log("[Worker] Starting scheduler-only worker (no HTTP listener).");
  console.log(
    "[Worker] SINGLE-WORKER ASSUMPTION: run exactly ONE worker — the schedulers " +
      "have no leader election (doc 27 B7: out of scope this wave).",
  );

  // Observability bootstrap (Sentry/OTel) — no-op unless configured.
  try {
    const { initObservability } = await import("./observability");
    await initObservability();
  } catch (err) {
    console.error("[Worker] observability init failed:", (err as any)?.message || err);
  }

  // Same honest DB requirements banner as the API entry (Timescale check).
  try {
    const { checkDbRequirements } = await import("../services/dbRequirementsCheck");
    await checkDbRequirements();
  } catch (err) {
    console.error("[Worker] DB requirements check failed:", (err as any)?.message || err);
  }

  // Reports/backups deliver by e-mail — the worker needs the transporter.
  try {
    const { initializeEmailTransporter } = await import("./email");
    initializeEmailTransporter();
  } catch (err) {
    console.error("[Worker] email transporter init failed:", (err as any)?.message || err);
  }

  await startBackgroundSchedulers();

  // Most schedulers use unref'd timers — hold the event loop open explicitly
  // so a fully flag-off worker doesn't just exit.
  const keepAlive = setInterval(() => {}, 60_000);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      console.log("[Worker] Force exit...");
      process.exit(0);
    }
    shuttingDown = true;
    console.log(`[Worker] ${signal} received — stopping schedulers...`);
    clearInterval(keepAlive);
    stopBackgroundSchedulers();
    // Give in-flight sweeps a moment to finish their current batch, then exit.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    console.error("[Worker] Unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[Worker] Uncaught exception:", error);
    setTimeout(() => process.exit(1), 1000);
  });

  console.log("[Worker] Ready.");
}
