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

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT TYPES (shape consumed by factory-scene component + command page).
// ════════════════════════════════════════════════════════════════════════════

/** Trạng thái máy đã chuẩn hóa cho lăng kính chỉ huy. */
export type CommandMachineStatus = "running" | "idle" | "down" | "offline" | "maintenance";

/** Một máy trên sàn nhà máy — CÙNG shape với MachineNode của <FactoryScene2D/3D>. */
export interface CommandMachineNode {
  id: number;
  code: string;
  name: string;
  machineType: string;
  lineId: number;
  lineName: string;
  status: CommandMachineStatus;
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
}

export interface FactoryCommandOverview {
  factories: Array<{ id: number; name: string; code: string }>;
  machines: CommandMachineNode[];
  issues: CommandIssue[];
}

// ════════════════════════════════════════════════════════════════════════════
// MAPPING HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Map (latest machine_status_logs.status ⊕ machines.operationStatus) → lăng kính
 * chỉ huy 5-trạng-thái. Nếu log mới nhất = 'offline' (hoặc chưa có log) → offline;
 * ngược lại (online) dựa vào operationStatus: maintenance→maintenance, error→down,
 * stopped→idle, còn lại (running/warming_up/changeover/starved/blocked)→running.
 */
function mapMachineStatus(
  latestLogStatus: string | undefined,
  operationStatus: string | null | undefined,
): CommandMachineStatus {
  if (latestLogStatus !== "online") return "offline";
  switch (operationStatus) {
    case "maintenance":
      return "maintenance";
    case "error":
      return "down";
    case "stopped":
      return "idle";
    default:
      return "running";
  }
}

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

const SEVERITY_RANK: Record<CommandIssue["severity"], number> = { critical: 0, warning: 1, info: 2 };

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
  if (!db) return { factories: [], machines: [], issues: [] };
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
    return { factories: factoryRows, machines: [], issues: [] };
  }
  const machineIds = machineRows.map((m) => m.id);
  const machineIdSet = new Set(machineIds);
  const codeById = new Map(machineRows.map((m) => [m.id, m.code]));

  // 3) Trạng thái log mới nhất / máy (DISTINCT ON — không N+1).
  const statusRows = executeRows(
    await db.execute(sql`
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, status, "timestamp" AS ts
      FROM machine_status_logs
      ORDER BY "machineId", "timestamp" DESC
    `),
  ) as Array<{ machine_id: number; status: string; ts: string }>;
  const statusByMachine = new Map<number, { status: string; ts: string }>();
  for (const r of statusRows) statusByMachine.set(Number(r.machine_id), { status: r.status, ts: r.ts });

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
        "predictedFailureRisk" AS risk, "maintenanceUrgency" AS urgency, "timestamp" AS ts
      FROM machine_health_history
      ORDER BY "machineId", "timestamp" DESC
    `),
  ) as Array<{ machine_id: number; risk: number | null; urgency: string | null; ts: string }>;
  const healthByMachine = new Map<number, { risk: number | null; urgency: string | null; ts: string }>();
  for (const r of healthRows) healthByMachine.set(Number(r.machine_id), { risk: r.risk, urgency: r.urgency, ts: r.ts });

  // 6) OEE fleet (set-based, Wave 3A) → map machineId → oee%.
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
    const status = mapMachineStatus(st?.status, m.operationStatus);
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
    issues.push({
      id: `offline-${node.id}`,
      kind: "offline",
      machineId: node.id,
      machineCode: node.code,
      severity: "warning",
      label: `Máy offline: ${node.code}`,
      ageMinutes: st ? ageMinutesFrom(st.ts, now) : 0,
    });
  }

  // Sắp xếp: severity trước, rồi tuổi giảm dần (cũ/nặng lên trên).
  issues.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    return b.ageMinutes - a.ageMinutes;
  });

  return { factories: factoryRows, machines: nodes, issues };
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
  oee: { availability: number | null; performance: number | null; quality: number | null; oee: number | null } | null;
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
  const status = mapMachineStatus(
    liveStatusRaw ?? undefined,
    detail.liveState.value?.operationStatus ?? undefined,
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
    oee: detail.oee.value,
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
