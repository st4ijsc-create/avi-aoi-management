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

import { shouldRunClusterSingleton } from "./workerLeader";

let started = false;
let chargingSweepTimer: NodeJS.Timeout | null = null;
let andonSlaSweepTimer: NodeJS.Timeout | null = null;
let storeForwardDrainTimer: NodeJS.Timeout | null = null;
let machineKeyExpiryTimer: NodeJS.Timeout | null = null;

export function backgroundSchedulersStarted(): boolean {
  return started;
}

export async function startBackgroundSchedulers(): Promise<void> {
  if (started) return;

  // doc 54 P2.3 — CLUSTER-SINGLETON GATE. Every scheduler in this file is part of the
  // cron/DB-write "once-per-cluster" set (see header). When WORKER_LEADER_ELECTION_ENABLED=true
  // ONLY the elected leader runs them, so N HA replicas don't double-fire reports/backups/
  // retention/snapshot-rollups/escalation-sweep. Flag OFF (default — single-node pilot /
  // Full-Sim) → runs as today, NO behaviour change. runWorkerProcess() already acquires
  // leadership BEFORE calling this, so this is defense-in-depth for EVERY caller (incl. the
  // all-in-one API boot). Gate is BEFORE `started = true` so a later leader-promotion can still
  // start the set. NOTE: do NOT enable leader-election in all-in-one mode without a dedicated
  // worker — see report.
  if (!shouldRunClusterSingleton()) {
    console.log(
      "[BackgroundJobs] leader-election ON & this instance is not the leader — cluster-singleton schedulers skipped here",
    );
    return;
  }

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

  // Doc 32 Wave R2 (decision #4) — report-artifact retention cleanup. Deletes
  // the storage object + row once expiresAt (default now+365d) has passed.
  // Default ON; disable with REPORT_ARTIFACT_CLEANUP_ENABLED=false.
  try {
    const { startReportArtifactCleanup } = await import("../services/reportArtifactService");
    startReportArtifactCleanup();
  } catch (err) {
    console.error("[ReportArtifact] cleanup start failed:", (err as any)?.message || err);
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

  // Pha 1 điều phối VRAM (Task 5) — bật SỔ CÁI + ĐỐI CHIẾU. ⚠ CHỈ QUAN SÁT: `reserve()` không
  // bao giờ từ chối và không thu hồi của ai ở pha này; giá trị nằm ở chỗ `reconcileOnce()` so sổ
  // với thiết bị mỗi 60 s và hét lên khi lệch — sidecar 7,8 GB (Đợt 0), ONNX +339 và cron +1.251
  // (Đợt 2) đều từng phải chờ một lượt review TOÀN NHÁNH mới lộ ra.
  //
  // ⚠ VỊ TRÍ CÓ CHỦ ĐÍCH — PHẢI ĐỨNG TRƯỚC `initDeepModelWarmup()` ngay bên dưới.
  // `startVramReconciler()` chụp NỀN THIẾT BỊ một lần (review vòng 1, I-1); nền phải được đo
  // khi tiến trình này CHƯA cấp phát gì. Đẩy khối này xuống sau lượt warm model là tự tay nuốt
  // ~17 GB trọng số vào "nền" và làm mù luôn cái sổ.
  //
  // Pha 1.5 Task 4 — bộ đếm giờ nhật ký (`__setVramLogTimerEnabled(true)`) KHÔNG bật ở đây.
  // `startBackgroundSchedulers()` (hàm hiện tại) được gọi từ HAI chỗ khác nhau, và MỖI chỗ gọi
  // tự bật timer TRƯỚC khi gọi vào đây — không phải một điểm bật chung duy nhất:
  //   • all-in-one / `ROLE=api` — bật ở `server/_core/index.ts`, tại lượt gọi
  //     `__setVramLogTimerEnabled(true)` DUY NHẤT của file đó, đứng TRƯỚC nhánh rẽ theo `ROLE`.
  //     ⚠ Minor-4 (review TOÀN NHÁNH): bản trước ghi số dòng cứng (`:5198`) và nó đã LỆCH sang
  //     `:5216` chỉ sau vài commit. Con trỏ vào một file 5.000 dòng phải là MÔ TẢ TƯƠNG ĐỐI
  //     (grep được), không phải một số đếm mà mọi lượt chèn dòng đều làm sai.
  //   • `ROLE=worker` (`server/worker.ts` HOẶC `ROLE=worker` qua `index.ts`) — bật ở ĐẦU
  //     `runWorkerProcess()` (trên, review vòng 1 Critical: bật ở `index.ts` KHÔNG phủ được
  //     worker, vì `worker.ts` không import `index.ts`, và `ROLE=worker` qua `index.ts`
  //     early-return trước khi chạm dòng bật ở đó).
  // `__setVramLogTimerEnabled` idempotent (`if (on && !timer)`) nên hai điểm bật này không
  // đụng nhau — không role nào đi qua CẢ HAI, mỗi nơi chỉ phủ đúng đường vào của chính nó.
  // ★★ Pha 2B Task 2 (I-1) — LƯỢT BẬT ĐỐI CHIẾU ĐÃ RỜI KHỎI ĐÂY, CÓ CHỦ ĐÍCH. Từ Pha 2B, nhịp đối
  // chiếu là NGUỒN SỐ của đường cưỡng chế chứ không chỉ nuôi cái chuông, nên nó không được phụ
  // thuộc vào việc tiến trình này có chạy scheduler hay không: `ROLE=api` không bao giờ vào hàm
  // này ⇒ ô tick rỗng vĩnh viễn ⇒ headroom rơi về chỉ-sổ (nhánh RỘNG NHẤT) đúng ở tiến trình chứa
  // MỌI điểm cấp phát. Hai điểm bật mới nằm cùng chỗ với `__setVramLogTimerEnabled(true)`:
  //   • `server/_core/index.ts` — TRƯỚC nhánh rẽ theo `ROLE` (phủ `api` + all-in-one; `api` bật ở
  //     chế độ `ring: false` — có SỐ, không có CHUÔNG);
  //   • đầu `runWorkerProcess()` (dưới, phủ `ROLE=worker` qua cả `worker.ts` lẫn `index.ts`).
  // ⚠ ĐỪNG THÊM LẠI ở đây: `startVramReconciler()` idempotent (`if (timer) return`) nên lượt gọi
  // thứ hai sẽ ÂM THẦM BỎ QUA tham số `ring` của nó — một cái bẫy im lặng, không phải một no-op.
  // ⚠ Ràng buộc thứ tự CŨ vẫn còn nguyên giá trị và nay do `index.ts` gánh: lượt chụp nền phải
  // đứng TRƯỚC `initDeepModelWarmup()` bên dưới, nếu không ~17 GB trọng số bị nuốt vào "nền".

  // doc69 W1 "modelfix" — WARM THE DEEP (text-generation) MODEL FIRST. node-llama-cpp fragments
  // VRAM when the 30B loads AFTER a small model, and RAG pulls in the 0.6B embedder on the first
  // retrieval; `warmModel()` was written for exactly this and was never called from production
  // code. Best-effort: initDeepModelWarmup never throws, uses an unref'd timer and self-gates on
  // GGUF_WARM_DEEP_MODEL_ON_BOOT=false.
  try {
    const { initDeepModelWarmup } = await import("../services/aiGgufEngine");
    initDeepModelWarmup();
  } catch (err) {
    console.error("[aiGgufEngine] deep-model warm init failed:", (err as any)?.message || err);
  }

  // Wave 3 §4.2 — đóng cảnh báo đã thôi tái diễn, kèm lý do. Best-effort.
  try {
    const { initAlertExpirySweeper } = await import("../services/alertExpirySweeper");
    initAlertExpirySweeper();
  } catch (err) {
    console.error("[alertExpiry] khởi tạo thất bại:", (err as any)?.message || err);
  }

  // S3.4 — AI batch RCA cron (daily 02:00 by default).
  try {
    const { initBatchRcaScheduler } = await import("../services/aiBatchRcaScheduler");
    initBatchRcaScheduler();
  } catch (err) {
    console.error("[aiBatchRcaScheduler] init failed:", (err as any)?.message || err);
  }

  // W0-D — proactive SPC-alert sweep. Opt in via AI_SPC_ALERT_SWEEP_ENABLED=true.
  try {
    const { initSpcAlertScheduler } = await import("../services/aiSpcAlertScheduler");
    initSpcAlertScheduler();
  } catch (err) {
    console.error("[aiSpcAlertScheduler] init failed:", (err as any)?.message || err);
  }

  // WS-1 — AI self-learning scan. Opt in via AI_SELF_LEARNING_ENABLED=true.
  try {
    const { initSelfLearningScheduler } = await import("../services/aiSelfLearningScheduler");
    initSelfLearningScheduler();
  } catch (err) {
    console.error("[aiSelfLearningScheduler] init failed:", (err as any)?.message || err);
  }

  // doc69 Giai đoạn 4/Wave 3 D4 — AI agent housekeeping cron: runs the EXISTING
  // expireStaleSessions()/expireStaleActions() lazy-cleanup functions on an interval
  // instead of leaving them purely reactive. Default ON (only expires ALREADY-stale
  // rows — safe + desirable); opt out via AI_AGENT_HOUSEKEEPING_ENABLED=false.
  try {
    const { initAgentHousekeepingScheduler } = await import("../services/aiAgentHousekeepingScheduler");
    initAgentHousekeepingScheduler();
  } catch (err) {
    console.error("[aiAgentHousekeepingScheduler] init failed:", (err as any)?.message || err);
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

  // doc 35 W5-B — dim/fact reporting mart refresh. NO-OP unless REPORTING_MART_ENABLED=true.
  try {
    const { startReportingMartRefresh } = await import("../services/reportingMartService");
    startReportingMartRefresh();
  } catch (err) {
    console.error("[ReportingMart] start failed:", (err as any)?.message || err);
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

  // Doc 32 Wave R5 (R1 gap) — periodic OEE snapshot → oee_metrics (hourly + daily
  // rollup), so OEE reports/BI have continuous data instead of only on-demand
  // rows. Opt in via OEE_SNAPSHOT_ENABLED=true (WRITES data — default OFF).
  try {
    const { startOeeSnapshotScheduler } = await import("../services/oeeSnapshotScheduler");
    startOeeSnapshotScheduler();
  } catch (err) {
    console.error("[oeeSnapshotScheduler] init failed:", (err as any)?.message || err);
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

  // W4-A (doc 35 §W4.2) — preventive-maintenance auto-scheduler: scans due
  // maintenance_schedules → generates PREVENTIVE work orders (trigger=SCHEDULE).
  // Opt in via PM_SCHEDULE_GEN_ENABLED=true (WRITES work orders — default OFF).
  try {
    const { startPmScheduleService } = await import("../services/pmScheduleService");
    startPmScheduleService();
  } catch (err) {
    console.error("[PmSchedule] init failed:", (err as any)?.message || err);
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

  // SYNAPSE P4 (doc 33 §11) — out-of-process plugin sidecar supervisor. No-op unless PLUGIN_SIDECAR=true.
  try {
    const { startPluginSidecar } = await import("../services/plugins/sidecar/pluginSidecarBootstrap");
    startPluginSidecar();
  } catch (err) {
    console.error("[PluginSidecar] start failed:", (err as any)?.message || err);
  }

  // Doc 35 quy-trình-7 — configured alert-escalation sweep. startAlertScheduler drives
  // sweepEscalations() (the ONLY path that fires admin-configured alert_escalation_rules)
  // + the connection/reconnect checks on its own interval. In production it was started
  // ONLY from an admin mutation, so configured escalation rules never fired. Opt in via
  // ALERT_ESCALATION_SWEEP_ENABLED=true. IDEMPOTENT: startAlertScheduler self-guards with
  // isSchedulerRunning, so this boot start and the admin mutation never double-start.
  try {
    if (process.env.ALERT_ESCALATION_SWEEP_ENABLED === "true") {
      const { startAlertScheduler } = await import("../mqttAlertScheduler");
      startAlertScheduler();
    }
  } catch (err) {
    console.error("[AlertEscalation] scheduler start failed:", (err as any)?.message || err);
  }

  // Doc 35 quy-trình-7 — Andon SLA-breach escalation sweep. Opt in via
  // ANDON_SLA_ESCALATION_ENABLED=true. ADVISORY: sweepAndonSlaBreaches only bumps
  // escalationLevel (+ emits/notifies) on open andons past their per-state SLA — it
  // NEVER writes a device command. Unref'd + non-overlapping (mirrors the charging sweep).
  try {
    if (process.env.ANDON_SLA_ESCALATION_ENABLED === "true") {
      const { sweepAndonSlaBreaches } = await import("../services/andon/andonService");
      const intervalMs = Math.max(60_000, Number(process.env.ANDON_SLA_SWEEP_MS ?? 300_000));
      let sweeping = false;
      andonSlaSweepTimer = setInterval(async () => {
        if (sweeping) return; // no overlap
        sweeping = true;
        try {
          await sweepAndonSlaBreaches();
        } catch (err) {
          console.error("[Andon] SLA sweep failed:", (err as any)?.message || err);
        } finally {
          sweeping = false;
        }
      }, intervalMs);
      if (typeof andonSlaSweepTimer.unref === "function") andonSlaSweepTimer.unref();
    }
  } catch (err) {
    console.error("[Andon] SLA sweep start failed:", (err as any)?.message || err);
  }

  // Doc 38 T-1 (P0 #3) — downtime auto-detection sweep. recordMachineActivity is
  // fed from the heartbeat/inspection ingest choke-points (server/db/machine.ts,
  // server/db/inspection.ts); this arms the periodic inactivity→downtime sweep.
  // Opt in via DOWNTIME_DETECTION_ENABLED=true (WRITES downtime_events — default OFF).
  // startDowntimeDetection self-guards (idempotent — no double-schedule).
  try {
    if (process.env.DOWNTIME_DETECTION_ENABLED === "true") {
      const { startDowntimeDetection } = await import("../services/downtimeDetectionService");
      startDowntimeDetection();
    }
  } catch (err) {
    console.error("[DowntimeDetection] start failed:", (err as any)?.message || err);
  }

  // Doc 40 MON-F1 — machine presence sweep: suy trạng thái online/offline từ recency của
  // ot_telemetry cho MỌI transport OT (bổ sung đường socket đã có), ghi machine_status_logs
  // chống trùng. Opt in via MACHINE_PRESENCE_ENABLED=true (WRITES machine_status_logs —
  // default OFF). startMachinePresence self-gates cờ + idempotent (no double-schedule).
  try {
    const { startMachinePresence } = await import("../services/machinePresenceService");
    startMachinePresence();
  } catch (err) {
    console.error("[MachinePresence] start failed:", (err as any)?.message || err);
  }

  // Doc 44 W2-A2 (G1.11) — config-drift sweep: so khớp hash cấu hình ĐANG CHẠY của
  // device_adapter + device_tags với bản ĐÃ DUYỆT (config_snapshots, mig 0252); lệch
  // → alert qua routeAlert (predictive_alerts). Opt in via CONFIG_DRIFT_ENABLED=true
  // (WRITES config_snapshots — default OFF). Interval: CONFIG_DRIFT_INTERVAL_MS
  // (default 10 phút, floor 60s). startConfigDriftSweep self-gates + idempotent.
  try {
    const { startConfigDriftSweep } = await import("../services/assetRegistry/configDriftService");
    startConfigDriftSweep();
  } catch (err) {
    console.error("[ConfigDrift] start failed:", (err as any)?.message || err);
  }

  // Doc 44 W3-A2 (G3.1) — Line Controller: startup recovery (đọc line_states bền)
  // + sweep quan sát nhịp/fault (LINE_CONTROLLER_ENABLED, default OFF → no-op).
  try {
    const { startLineController } = await import("../services/lineController/lineControllerService");
    void startLineController();
  } catch (err) {
    console.error("[LineController] init failed:", (err as any)?.message || err);
  }

  // Doc 44 W5-A1 (G4.1) — Twin fidelity loop: so DES-dự-đoán vs line_balance-thực
  // → tự vô hiệu twin khi lệch ≥N lần liên tiếp (TWIN_FIDELITY_ENABLED, OFF → no-op).
  try {
    const { startTwinFidelitySweep } = await import("../services/twin/twinFidelityService");
    startTwinFidelitySweep();
  } catch (err) {
    console.error("[TwinFidelity] start failed:", (err as any)?.message || err);
  }

  // Doc 44 W5-A2 (G4.20) — Parameter closed-loop verify sweep: sau verify_after so
  // metrics_before (Cpk/NG-rate máy) vs hiện tại → improved|degraded|neutral; degraded
  // → Andon (routeAlert) kèm old_value. Opt in via PARAM_VERIFY_ENABLED=true (WRITES
  // parameter_change_log verdicts — default OFF). Interval PARAM_VERIFY_INTERVAL_MS
  // (default 1h, floor 5m). startParamVerifySweep self-gates cờ + idempotent + unref'd.
  try {
    const { startParamVerifySweep } = await import("../services/ai/parameterGuardrailService");
    startParamVerifySweep();
  } catch (err) {
    console.error("[ParamVerify] start failed:", (err as any)?.message || err);
  }

  // Doc 44 W3-B3 (G3.8 + G3.9) — QT workflow templates + QT-3 material watcher.
  //   • registerQtTemplates: đăng ký 4 template QT-1..4 (as-code) vào kho workflow FOE,
  //     idempotent theo hash nội dung. No-op trừ khi QT_TEMPLATES_ENABLED (default OFF;
  //     cần FOE_ENABLED — loader trả kết quả honest khi thiếu).
  //   • startMaterialReplenishment: watcher cấp liệu QT-3 (feeder dưới reorder + Andon
  //     'material' → transport task idempotent, KHÔNG lệnh AMR). No-op trừ khi
  //     MATERIAL_REPLENISH_ENABLED=true (default OFF).
  try {
    const { registerQtTemplates } = await import("../services/orchestration/templates/registerQtTemplates");
    void registerQtTemplates().catch((err) =>
      console.error("[QtTemplates] register failed:", (err as any)?.message || err),
    );
    const { startMaterialReplenishment } = await import("../services/orchestration/materialReplenishment");
    startMaterialReplenishment();
  } catch (err) {
    console.error("[W3-B3] QT templates / material replenishment init failed:", (err as any)?.message || err);
  }

  // Doc 38 T-1 (P1) — SECS/GEM production bring-up. Opens an HSMS session per
  // configured equipment (SECS_GEM_EQUIPMENT JSON) and arms attachGemAlarmDispatch
  // so live S5F1 alarms reach the Andon path (EQ_INTEG_ENABLED). Honest no-op unless
  // BOTH SECS_GEM_ENABLED and SECS_GEM_LIVE_ENABLED are true AND equipment is
  // configured. Async connect — fire-and-forget so a slow/unreachable tool never
  // blocks boot; startSecsGemBringup is idempotent + fail-safe per equipment.
  try {
    if (process.env.SECS_GEM_ENABLED === "true" && process.env.SECS_GEM_LIVE_ENABLED === "true") {
      const { startSecsGemBringup } = await import("../services/secsgem/secsGemBringup");
      startSecsGemBringup().catch((err) =>
        console.error("[SecsGemBringup] start failed:", (err as any)?.message || err),
      );
    }
  } catch (err) {
    console.error("[SecsGemBringup] start failed:", (err as any)?.message || err);
  }

  // OT-F10 (doc 40 §11) — store-and-forward INDEPENDENT DRAIN timer. Trước đây backfill()
  // chỉ chạy opportunistic sau MỘT write thành công trong ingestNow, nên khi DB hồi phục
  // đúng lúc vắng traffic (không còn reader nào ingest) thì hàng chờ WAL nằm im vô thời hạn.
  // Timer này định kỳ (OT_STORE_FORWARD_DRAIN_MS, mặc định 45s) tự drain khi còn backlog.
  //
  // SELF-GATED + AN TOÀN: chỉ làm việc khi storeForwardEnabled() && bufferedCount()>0. Với
  // cờ OT_STORE_FORWARD_ENABLED OFF (mặc định) buffer luôn rỗng → mỗi tick chỉ là một phép
  // kiểm tra getter rồi thoát (no-op). Unref'd + non-overlapping (mirror charging sweep).
  // wireStoreForward() bơm lại insert fn (đề phòng WAL restore trên boot mà chưa có ingest
  // nào wire) trước khi backfill.
  try {
    const rawDrainMs = Number(process.env.OT_STORE_FORWARD_DRAIN_MS);
    const intervalMs = Math.max(15_000, Number.isFinite(rawDrainMs) ? rawDrainMs : 45_000); // guard NaN (QA-5): env phi-số → 45s
    let draining = false;
    storeForwardDrainTimer = setInterval(async () => {
      if (draining) return; // no overlap
      draining = true;
      try {
        const sf = await import("../services/ot/storeForward");
        if (sf.storeForwardEnabled() && sf.bufferedCount() > 0) {
          const { wireStoreForward } = await import("../services/telemetryBus");
          await wireStoreForward();
          const r = await sf.backfill();
          if (r.drained > 0)
            console.log(`[StoreForward] drain timer backfilled ${r.drained} row(s); remaining=${r.remaining}`);
        }
      } catch (err) {
        console.error("[StoreForward] drain timer failed:", (err as any)?.message || err);
      } finally {
        draining = false;
      }
    }, intervalMs);
    if (typeof storeForwardDrainTimer.unref === "function") storeForwardDrainTimer.unref();
  } catch (err) {
    console.error("[StoreForward] drain timer start failed:", (err as any)?.message || err);
  }

  // Doc 56 Đ2a Việc 3 — MACHINE-KEY EXPIRY ALERT weekly sweep. runMachineKeyExpiryAlertSweep
  // self-gates on MACHINE_KEY_EXPIRY_ALERT_ENABLED (default OFF → each tick is a cheap flag
  // check then return — no DB read). When ON it turns listExpiringMachineKeys(14) into ONE ops
  // action-inbox item (ai_insights, deduped). Interval MACHINE_KEY_EXPIRY_SWEEP_MS (default 7d,
  // floor 1h). Unref'd + non-overlapping (mirrors the charging sweep). A delayed initial kick
  // (60s, no-op when the flag is off) means enabling it does not wait a full week.
  try {
    const rawMs = Number(process.env.MACHINE_KEY_EXPIRY_SWEEP_MS);
    const intervalMs = Math.max(60 * 60_000, Number.isFinite(rawMs) ? rawMs : 7 * 24 * 60 * 60_000);
    let sweeping = false;
    const runMachineKeyExpiryOnce = async () => {
      if (sweeping) return; // no overlap
      sweeping = true;
      try {
        const { runMachineKeyExpiryAlertSweep } = await import("../services/machineAuthService");
        const r = await runMachineKeyExpiryAlertSweep(14);
        if (r.enabled && (r.created > 0 || r.refreshed > 0)) {
          console.log(
            `[MachineKeyExpiry] ${r.expiring} expiring machine key(s) → action-inbox item ${r.created ? "created" : "refreshed"}`,
          );
        }
      } catch (err) {
        console.error("[MachineKeyExpiry] sweep failed:", (err as any)?.message || err);
      } finally {
        sweeping = false;
      }
    };
    machineKeyExpiryTimer = setInterval(() => void runMachineKeyExpiryOnce(), intervalMs);
    if (typeof machineKeyExpiryTimer.unref === "function") machineKeyExpiryTimer.unref();
    setTimeout(() => void runMachineKeyExpiryOnce(), 60_000).unref?.();
  } catch (err) {
    console.error("[MachineKeyExpiry] sweep start failed:", (err as any)?.message || err);
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
  if (andonSlaSweepTimer) {
    clearInterval(andonSlaSweepTimer);
    andonSlaSweepTimer = null;
  }
  // OT-F10 — idempotent no-op when the drain timer was never started.
  if (storeForwardDrainTimer) {
    clearInterval(storeForwardDrainTimer);
    storeForwardDrainTimer = null;
  }
  // Doc 56 Đ2a Việc 3 — idempotent no-op when the expiry sweep was never started.
  if (machineKeyExpiryTimer) {
    clearInterval(machineKeyExpiryTimer);
    machineKeyExpiryTimer = null;
  }
  // Pha 1 điều phối VRAM (Task 5) — tắt VÔ ĐIỀU KIỆN, idempotent (no-op khi chưa từng bật).
  // ⚠ Pha 2B Task 2 (I-1) — KHÔNG CÒN ĐỐI XỨNG với một chỗ bật trong CÙNG file: lượt bật đã dời
  // sang `index.ts` (trước nhánh rẽ `ROLE`) và đầu `runWorkerProcess()`. Giữ lượt tắt ở đây là CỐ
  // Ý và đúng khuôn `__setVramLogTimerEnabled(false)` ngay dưới — vốn đã tắt vô điều kiện từ Pha
  // 1.5 Task 4 dù chỗ bật của nó cũng nằm ở hai file khác. Đường tắt duy nhất phải phủ mọi đường bật.
  import("../services/vram/vramReconciler")
    .then((m) => m.stopVramReconciler())
    .catch(() => {});
  import("../services/vram/vramEventLog")
    .then((m) => m.__setVramLogTimerEnabled(false))
    .catch(() => {});
  import("../services/reportScheduler")
    .then((m) => {
      m.shutdownScheduledReports();
      m.stopExecutiveReportScheduler();
    })
    .catch(() => {});
  import("../services/reportDeliveryService")
    .then((m) => m.stopReportDeliveryWorker())
    .catch(() => {});
  import("../services/reportArtifactService")
    .then((m) => m.stopReportArtifactCleanup())
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
  // doc69 Giai đoạn 4/Wave 3 D4 — idempotent no-op when never started.
  import("../services/aiAgentHousekeepingScheduler")
    .then((m) => m.stopAgentHousekeepingScheduler())
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
  import("../services/oeeSnapshotScheduler")
    .then((m) => m.stopOeeSnapshotScheduler())
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
  import("../services/pmScheduleService")
    .then((m) => m.stopPmScheduleService())
    .catch(() => {});
  import("../services/disasterRecoveryService")
    .then((m) => m.stopDisasterRecoveryService())
    .catch(() => {});
  import("../services/contracts/reconciliationCron")
    .then((m) => m.stopReconciliationScheduler())
    .catch(() => {});
  import("../services/plugins/sidecar/pluginSidecarBootstrap")
    .then((m) => m.stopPluginSidecar())
    .catch(() => {});
  // Doc 35 quy-trình-7 — idempotent no-op when the alert scheduler was never started
  // here (or was started by the admin mutation, which owns its own lifecycle too).
  import("../mqttAlertScheduler")
    .then((m) => m.stopAlertScheduler())
    .catch(() => {});
  // Doc 38 T-1 (P0 #3 / P1) — idempotent no-ops when never started.
  import("../services/downtimeDetectionService")
    .then((m) => m.stopDowntimeDetection())
    .catch(() => {});
  // Doc 40 MON-F1 — idempotent no-op when presence sweep was never started.
  import("../services/machinePresenceService")
    .then((m) => m.stopMachinePresence())
    .catch(() => {});
  // Doc 44 W5-A2 (G4.20) — idempotent no-op when the verify sweep was never started.
  import("../services/ai/parameterGuardrailService")
    .then((m) => m.stopParamVerifySweep())
    .catch(() => {});
  import("../services/secsgem/secsGemBringup")
    .then((m) => m.stopSecsGemBringup())
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

  // Pha 1.5 Task 4, review vòng 1 (Critical) — BẬT nhật ký NGAY ĐÂY, không phải ở
  // `index.ts`. `runWorkerProcess()` là điểm CHUNG của CẢ HAI đường vào worker:
  //   1. `server/worker.ts` (`npm run start:worker` / `dev:worker`) import THẲNG
  //      hàm này — KHÔNG BAO GIỜ chạm `index.ts`.
  //   2. `ROLE=worker` qua `index.ts` — `startServer()` early-return RẤT SỚM
  //      (đầu hàm), TRƯỚC lượt bật đặt gần khối `SERVER_ROLE === "api"` phía dưới.
  // Đặt lượt bật ở `index.ts` (như bản vá đầu của Task 4 đã làm) là VÔ NGHĨA với
  // cả hai đường trên ⇒ `worker` mất nhật ký hoàn toàn, kể cả sự kiện `baseline`/
  // `drift` do CHÍNH `reconcileOnce()` của tiến trình này ghi — hồi quy so với
  // trước Task 4. Đối xứng với `stopBackgroundSchedulers()` (dưới) vốn đã tắt nó
  // VÔ ĐIỀU KIỆN bất kể ai gọi.
  try {
    const { __setVramLogTimerEnabled } = await import("../services/vram/vramEventLog");
    __setVramLogTimerEnabled(true);
  } catch (err) {
    // Telemetry không bao giờ được làm hỏng boot của worker.
    console.error("[Worker] không bật được bộ đếm giờ nhật ký vram:", (err as any)?.message || err);
  }

  // ★★ Pha 2B Task 2 (I-1) — ĐỐI CHIẾU: bật NGAY ĐÂY, cùng khuôn và cùng lý do với lượt bật nhật
  // ký ngay trên (`runWorkerProcess()` là điểm CHUNG của cả hai đường vào worker; `index.ts` không
  // phủ được đường nào trong hai đường đó). Trước Pha 2B nó nằm trong `startBackgroundSchedulers()`
  // — vẫn chạy cho worker, nhưng chỗ đó KHÔNG phủ `ROLE=api`, và từ Pha 2B nhịp đối chiếu là
  // NGUỒN SỐ của đường cưỡng chế chứ không chỉ là cái chuông. Lý do đầy đủ ở `index.ts`.
  // ⚠ Đặt TRƯỚC `startBackgroundSchedulers()` bên dưới: nền phải được chụp khi tiến trình này CHƯA
  // cấp phát gì (ràng buộc thứ tự có từ Pha 1 — đẩy xuống sau lượt warm model là nuốt ~17 GB vào nền).
  // Worker chạy scheduler ⇒ nó LÀ vai trò được đánh chuông (`ring` mặc định true).
  try {
    const { startVramReconciler } = await import("../services/vram/vramReconciler");
    startVramReconciler();
    console.log("[Worker] [vram] sổ cái + đối chiếu đã bật (nhịp NGAY, chuông BẬT).");
  } catch (err) {
    console.error("[Worker] không bật được sổ cái/đối chiếu vram:", (err as any)?.message || err);
  }

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

  // doc 48 R4 — optional cluster leader election. OFF (default) preserves the
  // historical single-worker behaviour exactly (schedulers start immediately, no
  // lock). ON: block until THIS instance wins the cluster-wide advisory lock;
  // standby replicas wait here and take over automatically if the leader dies.
  const { leaderElectionEnabled, acquireWorkerLeadership, releaseWorkerLeadership } = await import(
    "./workerLeader"
  );
  if (leaderElectionEnabled()) {
    console.log("[Worker] leader-election ON — acquiring cluster leadership before starting schedulers…");
    await acquireWorkerLeadership({
      onLost: () => {
        console.error(
          "[Worker] leadership lost — fail-stopping to avoid split-brain (supervisor restarts us as a standby).",
        );
        try {
          stopBackgroundSchedulers();
        } catch {
          /* ignore */
        }
        setTimeout(() => process.exit(1), 500).unref();
      },
    });
  } else {
    console.log(
      "[Worker] SINGLE-WORKER ASSUMPTION: leader-election OFF — run exactly ONE worker " +
        "(set WORKER_LEADER_ELECTION_ENABLED=true to run HA replicas).",
    );
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
    // Release cluster leadership so a standby can take over immediately (no-op
    // when leader-election is OFF or this instance never became leader).
    void releaseWorkerLeadership();
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
