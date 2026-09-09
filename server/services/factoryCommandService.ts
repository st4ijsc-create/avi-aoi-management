/**
 * Factory Command View — AGGREGATION service (doc 40 Wave 4d §13.1-13.3).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Read-only aggregation for the whole-factory command screen (2D/3D theo Line):
 * one SET-BASED call returns every machine (position + live status + OEE + andon +
 * PdM risk) plus a prioritized issue feed, so the FE renders the plant floor and
 * the drill-down drawer without fanning out to a dozen routers.
 *
 * DESIGN PRINCIPLES (mirror assetCockpitService / commandCenterService):
 *   • AGGREGATION ONLY — sourced from EXISTING tables/services. No health/OEE math
 *     is re-implemented; OEE comes from oeeService.getAllMachinesOEELive (Wave 3A
 *     set-based fleet path), PdM risk from the persisted machine_health_history,
 *     status from machine_status_logs + machines.operationStatus.
 *   • SET-BASED — a FIXED handful of grouped queries regardless of fleet size
 *     (no N+1: DISTINCT ON for latest status/position/health; one andon/alert/WO
 *     scan). Safe on the polling command screen.
 *   • HONEST NULL — oeePercent is null when its inputs are absent (never fabricated);
 *     a machine without a layout position returns 0 (client auto-layout).
 *   • NO CONTROL PATH — read-only; nothing here writes to a machine.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  machines,
  stations,
  productionLines,
  workshops,
  factories,
  andonEvents,
  maintenanceWorkOrders,
  alertHistory,
  alertSettings,
} from "../../drizzle/schema";
import { getAllMachinesOEELive } from "./oeeService";
import { executeRows } from "../utils/kpi";
// doc 44 W6-2 (G5.11) — impact-based priority + dedup (PURE, flag-gated).
import { prioritizeIssues, type IssueImpactContext } from "./factoryCommandPriority";
// doc 44 W2-A4 (G2.14/G2.15): governed metric provenance — the OEE numbers on
// this screen come from the ONE semantic-layer definition (contracts/metrics/
// oee.yaml → oeeService, the canonical implementation this service already
// delegates to). FAIL-SAFE: returns null if the registry cannot load.
import { getMetricDefinitionVersion } from "./semantics/metricRegistry";
// ★ Đợt 34 (Pareto #1 QA Đợt 32) — MỘT hợp đồng trạng thái: kiểu + phép ánh xạ + ngưỡng tươi sống ở
//   `trangThaiMayTuoi.ts` (THUẦN, dùng chung với `ecosystem/assetCockpitService`). Đọc docblock ở đó
//   trước khi sửa: 43/43 máy của DB này có log `online` 3…20 ngày tuổi, và bản cũ vẽ chúng "running"/"idle".
import { isoCua, mapMachineStatus, type CommandMachineStatus } from "./trangThaiMayTuoi";
// ★ Mốc "còn nói chuyện với ta" = NHỊP TIM, chọn bằng ĐÚNG hai hàm mà kho realtime của twin
//   (`twin:trangThai` → `traTrangThaiHangLoat`) dùng — cùng hàm ⇒ fleet API và kho không thể lệch mốc (G12).
import { chonNguonMocTuoi, quyTuoiMay } from "../db/twinCanh";

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT TYPES (shape consumed by factory-scene component + command page).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Trạng thái máy đã chuẩn hóa cho lăng kính chỉ huy — khai ở `trangThaiMayTuoi.ts`, re-export để
 * `factoryCommandPriority.ts` và mọi consumer cũ giữ nguyên đường import.
 */
export type { CommandMachineStatus };

/** Một máy trên sàn nhà máy — CÙNG shape với MachineNode của <FactoryScene2D/3D>. */
export interface CommandMachineNode {
  id: number;
  code: string;
  name: string;
  machineType: string;
  lineId: number;
  lineName: string;
  status: CommandMachineStatus;
  /**
   * ★ Đợt 34 — MỐC DỮ LIỆU TRẠNG THÁI (ISO) = nhịp tim mới nhất, `max(machines.lastHeartbeat,
   *   machine_heartbeats)` qua `chonNguonMocTuoi` — **CÙNG mốc** mà kho realtime của twin
   *   (`twin:trangThai.capNhatLuc`) và cockpit `liveState.lastHeartbeat` dùng. `null` = máy CHƯA TỪNG
   *   gửi nhịp tim (2/42 máy của DB này) — và CHỈ khi ấy twin mới được in "Never reported".
   *
   *   ⚠ KHÔNG phải mốc `machine_status_logs."timestamp"`: hàng log là SỰ KIỆN chuyển trạng thái
   *     (connect/disconnect, `recordPresence` chỉ ghi khi đổi), nên tuổi của nó không đo "máy còn nói
   *     chuyện không" — xem docblock `trangThaiMayTuoi.ts` và `db/twinCanh.ts` `chonNguonMocTuoi`.
   *   Trước đợt này client chỉ suy được mốc từ issue `offline`, nên máy có log `online` **không có mốc**
   *   ⇒ twin in "Never reported" cho máy đã từng báo cáo (bịa theo chiều ngược).
   */
  tsTrangThai: string | null;
  /** OEE % (0-100) — honest null khi thiếu dữ liệu availability/performance/quality. */
  oeePercent: number | null;
  positionX: number;
  positionY: number;
  positionZ: number;
  width: number;
  height: number;
  depth: number;
  rotation: number;
  andonActive: boolean;
  pdmRiskHigh: boolean;
}

/** Một sự cố/việc cần chú ý — gộp Andon + Alarm + PdM + WO quá hạn + máy offline. */
export interface CommandIssue {
  id: string;
  kind: "andon" | "alarm" | "pdm" | "workorder" | "offline";
  machineId: number;
  machineCode: string;
  severity: "critical" | "warning" | "info";
  label: string;
  ageMinutes: number;
  /**
   * doc 44 W6-2 (G5.11) — ADDITIVE. Impact score 0..100 (f(severity, production
   * loss, OEE, kind, age)); present only when IMPACT_ALERT_ENABLED is on.
   */
  impact?: number;
  /**
   * doc 44 W6-2 (G5.11) — ADDITIVE. How many raw issues on the same machine+kind
   * were folded into this one (dedup). 1 (or omitted) when nothing was merged.
   */
  count?: number;
}

export interface FactoryCommandOverview {
  factories: Array<{ id: number; name: string; code: string }>;
  machines: CommandMachineNode[];
  issues: CommandIssue[];
  /**
   * doc 44 W2-A4 — ADDITIVE provenance: semantic-layer definition version of the
   * OEE numbers in `machines[].oeePercent` (e.g. "OEE@v1"). Null when the metric
   * registry is unavailable (never breaks the screen).
   */
  oeeDefinitionVersion: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// MAPPING HELPERS
// ════════════════════════════════════════════════════════════════════════════

// `mapMachineStatus(latestLogStatus, operationStatus, tsLog, now)` — xem `trangThaiMayTuoi.ts`. Đợt 34 thêm
// TUỔI của log vào phép ánh xạ: log `online` cũ hơn `NGUONG_TRANG_THAI_TUOI_MS` ⇒ `offline`, không phải
// `running`/`idle`. Hàm cũ ở đây không xét tuổi — đó là gốc rễ Pareto #1 (4 màn · 9 ca) của QA Đợt 32.

/** Andon state → severity band (đồng bộ với assetCockpitService). */
function andonStateToSeverity(state: string | null | undefined): CommandIssue["severity"] {
  const s = (state ?? "").toLowerCase();
  if (s === "red" || s === "call") return "critical";
  if (s === "yellow") return "warning";
  return "info";
}

/** Tuổi (phút) từ một mốc thời gian tới bây giờ; 0 nếu không có. */
function ageMinutesFrom(ts: Date | string | number | null | undefined, now: number): number {
  if (ts == null) return 0;
  const ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.round((now - ms) / 60000));
}

// PdM: coi là rủi ro cao khi failureRisk ≥ 70 HOẶC urgency ∈ {HIGH, CRITICAL}.
const PDM_RISK_THRESHOLD = 70;

// Trạng thái WO chưa đóng (đang cần xử lý).
const WO_OPEN_STATUSES = ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"] as const;

// ════════════════════════════════════════════════════════════════════════════
// OVERVIEW — set-based, toàn nhà máy (hoặc 1 factory nếu truyền factoryId).
// ════════════════════════════════════════════════════════════════════════════

export async function getFactoryCommandOverview(params?: {
  factoryId?: number;
}): Promise<FactoryCommandOverview> {
  const db = await getDb();
  if (!db) return { factories: [], machines: [], issues: [], oeeDefinitionVersion: getMetricDefinitionVersion("OEE") };
  const now = Date.now();
  const factoryId = params?.factoryId;

  // 1) Danh sách factory (cho bộ lọc trên FE).
  const factoryRows = await db
    .select({ id: factories.id, name: factories.name, code: factories.code })
    .from(factories)
    .orderBy(factories.name);

  // 2) Máy + phả hệ (1 join, leftJoin để máy chưa gán line vẫn hiện).
  const baseWhere = factoryId != null
    ? and(eq(machines.isActive, true), eq(factories.id, factoryId))
    : eq(machines.isActive, true);
  const machineRows = await db
    .select({
      id: machines.id,
      code: machines.code,
      name: machines.name,
      machineType: machines.machineType,
      operationStatus: machines.operationStatus,
      // ★ Đợt 34 — một trong hai nguồn nhịp tim (`chonNguonMocTuoi.hbMay`).
      lastHeartbeat: machines.lastHeartbeat,
      lineId: productionLines.id,
      lineName: productionLines.name,
    })
    .from(machines)
    .leftJoin(stations, eq(machines.stationId, stations.id))
    .leftJoin(productionLines, eq(stations.lineId, productionLines.id))
    .leftJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .leftJoin(factories, eq(workshops.factoryId, factories.id))
    .where(baseWhere);

  if (machineRows.length === 0) {
    return { factories: factoryRows, machines: [], issues: [], oeeDefinitionVersion: getMetricDefinitionVersion("OEE") };
  }
  const machineIds = machineRows.map((m) => m.id);
  const machineIdSet = new Set(machineIds);
  const codeById = new Map(machineRows.map((m) => [m.id, m.code]));

  // 3) Trạng thái log mới nhất / máy (DISTINCT ON — không N+1).
  //    ★★★ Đợt 34 — `AT TIME ZONE 'UTC'`: cột `timestamp` (không múi giờ) lưu giờ UTC (DB `TimeZone=Etc/UTC`,
  //    đo `::text` = "2026-09-06 18:51:22"), nhưng `db.execute` thô đi qua postgres.js đọc naive theo GIỜ MÁY
  //    NODE (+07 ⇒ 11:51Z, lệch −7 h) trong khi `db.select()` typed của drizzle đọc naive là UTC (đúng).
  //    Đo được trên đối chứng máy 18: nhịp tim chèn `now()` ⇒ cockpit (typed) "3 s · Connected" nhưng fleet
  //    (thô) "7 h · offline". Ép về timestamptz ngay trong SQL để cả hai đường trả CÙNG một mốc.
  const statusRows = executeRows(
    await db.execute(sql`
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, status, "timestamp" AT TIME ZONE 'UTC' AS ts
      FROM machine_status_logs
      ORDER BY "machineId", "timestamp" DESC
    `),
  ) as Array<{ machine_id: number; status: string; ts: string }>;
  const statusByMachine = new Map<number, { status: string; ts: string }>();
  for (const r of statusRows) statusByMachine.set(Number(r.machine_id), { status: r.status, ts: r.ts });

  // 3b) ★ Đợt 34 — nhịp tim mới nhất / máy (DISTINCT ON, một truy vấn cho cả đội — không N+1). Đây là
  //     BẰNG CHỨNG SỐNG; hàng log ở bước 3 chỉ là sự kiện chuyển trạng thái (xem `trangThaiMayTuoi.ts`).
  const hbRows = executeRows(
    await db.execute(sql`
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "timestamp" AT TIME ZONE 'UTC' AS ts
      FROM machine_heartbeats
      ORDER BY "machineId", "timestamp" DESC
    `),
  ) as Array<{ machine_id: number; ts: string }>;
  const hbByMachine = new Map<number, string>();
  for (const r of hbRows) hbByMachine.set(Number(r.machine_id), r.ts);
  /** machineId → mốc nhịp tim (ms) đã chọn — dùng cho `status`, `tsTrangThai` và tuổi issue `offline`. */
  const mocNhipTimByMachine = new Map<number, number | null>();

  // 4) Vị trí layout mới nhất / máy (DISTINCT ON updatedAt — 1 máy có thể ở nhiều layout).
  const posRows = executeRows(
    await db.execute(sql`
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id,
        "positionX" AS x, "positionY" AS y, "positionZ" AS z,
        width, height, depth, rotation
      FROM machine_positions
      ORDER BY "machineId", "updatedAt" DESC
    `),
  ) as Array<{ machine_id: number; x: number; y: number; z: number | null; width: number; height: number; depth: number | null; rotation: number | null }>;
  const posByMachine = new Map<number, (typeof posRows)[number]>();
  for (const r of posRows) posByMachine.set(Number(r.machine_id), r);

  // 5) PdM risk mới nhất / máy (DISTINCT ON timestamp — machine_health_history).
  const healthRows = executeRows(
    await db.execute(sql`
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id,
        "predictedFailureRisk" AS risk, "maintenanceUrgency" AS urgency, "timestamp" AT TIME ZONE 'UTC' AS ts
      FROM machine_health_history
      ORDER BY "machineId", "timestamp" DESC
    `),
  ) as Array<{ machine_id: number; risk: number | null; urgency: string | null; ts: string }>;
  const healthByMachine = new Map<number, { risk: number | null; urgency: string | null; ts: string }>();
  for (const r of healthRows) healthByMachine.set(Number(r.machine_id), { risk: r.risk, urgency: r.urgency, ts: r.ts });

  // 6) OEE fleet (set-based, Wave 3A) → map machineId → oee%.
  //    doc 44 W2-A4: this ALREADY delegates to the canonical semantic-layer
  //    implementation (contracts/metrics/oee.yaml → oeeService.getAllMachinesOEELive
  //    — same fleet path); the payload additionally stamps oeeDefinitionVersion
  //    ("OEE@v1") so the UI/consumers can trace which governed definition
  //    produced these numbers.
  const oeeByMachine = new Map<number, number | null>();
  try {
    const oeeList = await getAllMachinesOEELive({ windowHours: 24 });
    for (const o of oeeList) oeeByMachine.set(o.machineId, o.oee);
  } catch {
    /* OEE source lỗi → honest null cho toàn bộ (không phá màn hình) */
  }

  // 7) Andon đang mở (resolvedAt IS NULL).
  const andonRows = await db
    .select({
      id: andonEvents.id,
      machineId: andonEvents.machineId,
      state: andonEvents.state,
      reason: andonEvents.reason,
      title: andonEvents.title,
      raisedAt: andonEvents.raisedAt,
    })
    .from(andonEvents)
    .where(isNull(andonEvents.resolvedAt))
    .orderBy(desc(andonEvents.raisedAt))
    .limit(300);
  const andonActiveSet = new Set<number>();
  for (const a of andonRows) if (a.machineId != null) andonActiveSet.add(a.machineId);

  // 8) Work-order chưa đóng (để lọc quá hạn ở dưới).
  const woRows = await db
    .select({
      id: maintenanceWorkOrders.id,
      machineId: maintenanceWorkOrders.machineId,
      workOrderNumber: maintenanceWorkOrders.workOrderNumber,
      title: maintenanceWorkOrders.title,
      priority: maintenanceWorkOrders.priority,
      scheduledFor: maintenanceWorkOrders.scheduledFor,
      openedAt: maintenanceWorkOrders.openedAt,
    })
    .from(maintenanceWorkOrders)
    .where(inArray(maintenanceWorkOrders.status, WO_OPEN_STATUSES as unknown as any))
    .limit(500);

  // 9) Alert đang mở (chưa acknowledge) + setting còn bật, có machineId.
  const alertRows = await db
    .select({
      id: alertHistory.id,
      machineId: alertSettings.machineId,
      message: alertHistory.message,
      createdAt: alertHistory.createdAt,
    })
    .from(alertHistory)
    .innerJoin(alertSettings, eq(alertHistory.alertSettingId, alertSettings.id))
    .where(and(isNull(alertHistory.acknowledgedAt), eq(alertSettings.isActive, true)))
    .orderBy(desc(alertHistory.createdAt))
    .limit(300);

  // ── Lắp ráp machines[] ──────────────────────────────────────────────────
  const nodes: CommandMachineNode[] = machineRows.map((m) => {
    const st = statusByMachine.get(m.id);
    // ★ Đợt 34 — mốc nhịp tim qua ĐÚNG hai hàm của kho twin; `statusLogTs` được truyền vào rồi bị
    //   `chonNguonMocTuoi` VỨT ĐI có chủ đích (THƯỜNG-4) — muốn trộn log vào phải sửa hàm có test soi.
    const { capNhatLuc: mocNhipTim } = quyTuoiMay(
      chonNguonMocTuoi({ hbBang: hbByMachine.get(m.id), hbMay: m.lastHeartbeat, statusLogTs: st?.ts }),
      now,
    );
    mocNhipTimByMachine.set(m.id, mocNhipTim);
    const status = mapMachineStatus(
      { logStatus: st?.status, logTs: st?.ts, nhipTimTs: mocNhipTim },
      m.operationStatus,
      now,
    );
    const pos = posByMachine.get(m.id);
    const health = healthByMachine.get(m.id);
    const pdmRiskHigh =
      (health?.risk != null && Number(health.risk) >= PDM_RISK_THRESHOLD) ||
      health?.urgency === "HIGH" ||
      health?.urgency === "CRITICAL";
    return {
      id: m.id,
      code: m.code,
      name: m.name,
      machineType: String(m.machineType),
      lineId: m.lineId ?? 0,
      lineName: m.lineName ?? "Chưa gán line",
      status,
      tsTrangThai: isoCua(mocNhipTim),
      oeePercent: oeeByMachine.get(m.id) ?? null,
      positionX: pos ? Number(pos.x) : 0,
      positionY: pos ? Number(pos.y) : 0,
      positionZ: pos ? Number(pos.z ?? 0) : 0,
      width: pos ? Number(pos.width ?? 100) : 100,
      height: pos ? Number(pos.height ?? 80) : 80,
      depth: pos ? Number(pos.depth ?? 60) : 60,
      rotation: pos ? Number(pos.rotation ?? 0) : 0,
      andonActive: andonActiveSet.has(m.id),
      pdmRiskHigh,
    };
  });

  // ── Lắp ráp issues[] (gộp mọi nguồn, chỉ máy trong scope) ─────────────────
  const issues: CommandIssue[] = [];

  for (const a of andonRows) {
    if (a.machineId == null || !machineIdSet.has(a.machineId)) continue;
    issues.push({
      id: `andon-${a.id}`,
      kind: "andon",
      machineId: a.machineId,
      machineCode: codeById.get(a.machineId) ?? String(a.machineId),
      severity: andonStateToSeverity(a.state),
      label: a.title || `Andon (${a.reason ?? "khác"})`,
      ageMinutes: ageMinutesFrom(a.raisedAt, now),
    });
  }

  for (const al of alertRows) {
    if (al.machineId == null || !machineIdSet.has(al.machineId)) continue;
    issues.push({
      id: `alarm-${al.id}`,
      kind: "alarm",
      machineId: al.machineId,
      machineCode: codeById.get(al.machineId) ?? String(al.machineId),
      severity: "warning",
      label: al.message || "Cảnh báo",
      ageMinutes: ageMinutesFrom(al.createdAt, now),
    });
  }

  for (const [machineId, health] of healthByMachine) {
    if (!machineIdSet.has(machineId)) continue;
    const riskHigh =
      (health.risk != null && Number(health.risk) >= PDM_RISK_THRESHOLD) ||
      health.urgency === "HIGH" ||
      health.urgency === "CRITICAL";
    if (!riskHigh) continue;
    issues.push({
      id: `pdm-${machineId}`,
      kind: "pdm",
      machineId,
      machineCode: codeById.get(machineId) ?? String(machineId),
      severity: health.urgency === "CRITICAL" ? "critical" : "warning",
      label: `Nguy cơ hỏng ${health.risk != null ? `${Number(health.risk)}%` : "cao"}${health.urgency ? ` (${health.urgency})` : ""}`,
      ageMinutes: ageMinutesFrom(health.ts, now),
    });
  }

  for (const wo of woRows) {
    if (wo.machineId == null || !machineIdSet.has(wo.machineId)) continue;
    // Chỉ tính "quá hạn": có scheduledFor và đã trôi qua.
    if (!wo.scheduledFor) continue;
    const due = wo.scheduledFor instanceof Date ? wo.scheduledFor.getTime() : new Date(wo.scheduledFor).getTime();
    if (Number.isNaN(due) || due >= now) continue;
    issues.push({
      id: `workorder-${wo.id}`,
      kind: "workorder",
      machineId: wo.machineId,
      machineCode: codeById.get(wo.machineId) ?? String(wo.machineId),
      severity: wo.priority === 1 ? "critical" : "warning",
      label: `WO quá hạn: ${wo.workOrderNumber}${wo.title ? ` — ${wo.title}` : ""}`,
      ageMinutes: ageMinutesFrom(wo.scheduledFor, now),
    });
  }

  for (const node of nodes) {
    if (node.status !== "offline") continue;
    const st = statusByMachine.get(node.id);
    // ★ Đợt 34 — tuổi của "offline" = từ NHỊP TIM cuối (cùng mốc `tsTrangThai`); chỉ khi chưa từng có
    //   nhịp tim mới rơi về mốc hàng log; chưa có gì ⇒ 0 (hợp đồng cũ, `ageMinutes` bắt buộc là số).
    const mocOffline = mocNhipTimByMachine.get(node.id) ?? st?.ts ?? null;
    issues.push({
      id: `offline-${node.id}`,
      kind: "offline",
      machineId: node.id,
      machineCode: node.code,
      severity: "warning",
      label: `Máy offline: ${node.code}`,
      ageMinutes: mocOffline != null ? ageMinutesFrom(mocOffline, now) : 0,
    });
  }

  // ── Ưu tiên theo TÁC ĐỘNG + gộp (doc 44 W6-2 / G5.11) ────────────────────
  // Bối cảnh máy cho điểm tác động: trạng thái + OEE + line có đang sản xuất.
  // "Line đang sản xuất" = có ÍT NHẤT một máy cùng line đang running.
  const lineProducing = new Map<number, boolean>();
  for (const n of nodes) {
    if (n.status === "running") lineProducing.set(n.lineId, true);
  }
  const nodeById = new Map<number, CommandMachineNode>(nodes.map((n) => [n.id, n]));
  const getIssueContext = (issue: CommandIssue): IssueImpactContext | null => {
    const n = nodeById.get(issue.machineId);
    if (!n) return null;
    return {
      machineStatus: n.status,
      oeePercent: n.oeePercent,
      lineProducing: lineProducing.get(n.lineId) ?? false,
    };
  };
  // Flag OFF → sort cũ (severity → tuổi), không dedup/không impact (parity).
  // Flag ON  → stamp impact + gộp fingerprint + sort theo tác động.
  const finalIssues = prioritizeIssues(issues, getIssueContext);

  return {
    factories: factoryRows,
    machines: nodes,
    issues: finalIssues,
    // doc 44 W2-A4 — additive provenance for the OEE KPI (fail-safe null).
    oeeDefinitionVersion: getMetricDefinitionVersion("OEE"),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// MACHINE DETAIL — tóm tắt cho drawer (project từ assetCockpitService, KHÔNG
// nhân bản logic) + work-order đang mở.
// ════════════════════════════════════════════════════════════════════════════

export interface CommandMachineDetail {
  identity: {
    id: number;
    code: string;
    name: string;
    machineType: string;
    lineId: number | null;
    lineName: string | null;
    factoryName: string | null;
  };
  status: CommandMachineStatus;
  liveStatusRaw: string | null;
  oee: {
    availability: number | null;
    performance: number | null;
    quality: number | null;
    oee: number | null;
    /** doc 44 W2-A4 — ADDITIVE: semantic-layer definition version ("OEE@v1"; null fail-safe). */
    definitionVersion?: string | null;
  } | null;
  alarms: Array<{ standardCode: string; severity: string; description: string | null; ts: number }>;
  /** Recipe/nạp gần nhất (từ recipeVersioningService.listLoadHistory qua cockpit). */
  recipe: unknown | null;
  recipeHistory: unknown[];
  workorders: Array<{
    id: number;
    workOrderNumber: string;
    title: string;
    status: string;
    type: string;
    priority: number;
    scheduledFor: number | null;
    openedAt: number | null;
    overdue: boolean;
  }>;
  telemetryTags: unknown[];
}

export async function getCommandMachineDetail(machineId: number): Promise<CommandMachineDetail | null> {
  // Tái dùng aggregation cockpit sẵn có (identity/liveState/oee/alarms/recipes/capability).
  const { machineDetail } = await import("./ecosystem/assetCockpitService");
  const detail = await machineDetail(machineId);
  if (!detail) return null;

  const now = Date.now();
  const liveStatusRaw = detail.liveState.value?.status ?? null;
  // ★ Đợt 34 — CÙNG bằng chứng kết nối với fleet và với `liveState.connected` của cockpit:
  //   log (`status` + `lastStatusChange`) ⊕ nhịp tim (`lastHeartbeat` = mốc đã chọn qua `chonNguonMocTuoi`).
  const status = mapMachineStatus(
    {
      logStatus: liveStatusRaw ?? undefined,
      logTs: detail.liveState.value?.lastStatusChange ?? null,
      nhipTimTs: detail.liveState.value?.lastHeartbeat ?? null,
    },
    detail.liveState.value?.operationStatus ?? undefined,
    now,
  );

  // Work-order đang mở cho máy này (truy vấn nhỏ, chỉ 1 máy).
  const db = await getDb();
  let workorders: CommandMachineDetail["workorders"] = [];
  if (db) {
    try {
      const rows = await db
        .select({
          id: maintenanceWorkOrders.id,
          workOrderNumber: maintenanceWorkOrders.workOrderNumber,
          title: maintenanceWorkOrders.title,
          status: maintenanceWorkOrders.status,
          type: maintenanceWorkOrders.type,
          priority: maintenanceWorkOrders.priority,
          scheduledFor: maintenanceWorkOrders.scheduledFor,
          openedAt: maintenanceWorkOrders.openedAt,
        })
        .from(maintenanceWorkOrders)
        .where(
          and(
            eq(maintenanceWorkOrders.machineId, machineId),
            inArray(maintenanceWorkOrders.status, WO_OPEN_STATUSES as unknown as any),
          ),
        )
        .orderBy(maintenanceWorkOrders.priority, desc(maintenanceWorkOrders.openedAt))
        .limit(50);
      workorders = rows.map((w) => {
        const due = w.scheduledFor
          ? (w.scheduledFor instanceof Date ? w.scheduledFor.getTime() : new Date(w.scheduledFor).getTime())
          : null;
        return {
          id: w.id,
          workOrderNumber: w.workOrderNumber,
          title: w.title,
          status: String(w.status),
          type: String(w.type),
          priority: w.priority,
          scheduledFor: due,
          openedAt: w.openedAt ? (w.openedAt instanceof Date ? w.openedAt.getTime() : new Date(w.openedAt).getTime()) : null,
          overdue: due != null && due < now,
        };
      });
    } catch {
      workorders = [];
    }
  }

  const recipeHistory = (detail.recipes.value?.loadHistory as unknown[]) ?? [];

  return {
    identity: {
      id: detail.identity.id,
      code: detail.identity.code,
      name: detail.identity.name,
      machineType: detail.identity.machineType,
      lineId: detail.identity.lineId,
      lineName: detail.identity.lineName,
      factoryName: detail.identity.factoryName,
    },
    status,
    liveStatusRaw,
    // doc 44 W2-A4 — the cockpit OEE already comes from the canonical
    // oeeService.getMachineOEELive; stamp the governed definition version
    // additively (shape unchanged otherwise, null-honest preserved).
    oee: detail.oee.value
      ? { ...detail.oee.value, definitionVersion: getMetricDefinitionVersion("OEE") }
      : null,
    alarms: (detail.alarms.value ?? []).map((a) => ({
      standardCode: a.standardCode,
      severity: a.severity,
      description: a.description,
      ts: a.ts,
    })),
    recipe: recipeHistory[0] ?? null,
    recipeHistory,
    workorders,
    telemetryTags: (detail.resolvedCapability.value?.telemetryTags as unknown[]) ?? [],
  };
}
