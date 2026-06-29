/**
 * AI Local Tools — Phase P2 (group A) READ tools.
 *
 * Doc 11 (AI Assistant Knowledge Remediation) found a READ/WRITE asymmetry: the
 * assistant could WRITE work-orders, ack alerts, set spec limits and control
 * recipes, but had NO matching READ tool to answer "live data" questions over
 * those same domains. This file adds the 4 highest-priority READ tools:
 *
 *   1. list_work_orders        → maintenance_work_orders (RBAC machine_downtime)
 *   2. list_active_alerts      → alert_history + predictive_alerts (RBAC mqtt_alerts)
 *   3. list_thresholds         → measurement_point_defs + yield_alert_thresholds
 *                                (RBAC settings_measurement_points)
 *   4. list_recipes            → machine_recipes (RBAC machine_control)
 *
 * Design — mirrors analyticsTools.ts EXACTLY:
 *   - `kind: 'read'` with a declared `requiredPermission` that is ALSO enforced
 *     inside the handler via the shared `rbacGate` (fail-safe: missing/invalid
 *     `__authCtx` OR denied → no-data "denied" result; never throws, never leaks).
 *   - SELECT-only Drizzle ORM (parameterized). No INSERT/UPDATE/DELETE.
 *   - A `getDb()` guard returning `noDbResult`. Vietnamese `textSummary`.
 *   - Each tool's `data` carries a render-friendly `rows: Array<{label,value}>`
 *     so the frontend AIToolResultCard generic fallback renders it as a titled
 *     list without a bespoke card.
 *
 * Self-registers on import (see index.ts → `import "./readToolsP2"`).
 */

import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  maintenanceWorkOrders,
  machines,
  alertHistory,
  alertSettings,
  predictiveAlerts,
  measurementPointDefs,
  productModels,
  yieldAlertThresholds,
  machineRecipes,
} from "../../../drizzle/schema";
import { checkPermission } from "../../_core/accessControl";
import { registerTool, type Tool, type ToolResult, type ToolLang, type ToolResultType } from "./toolRegistry";

// ─── shared helpers (same shape as analyticsTools.ts) ────────────────────────

type Lang = ToolLang;

/** A render-friendly row the FE generic fallback can show as label: value. */
interface RenderRow {
  label: string;
  value: string;
}

const authCtxSchema = z
  .object({
    userId: z.number().int().positive(),
    role: z.string().min(1),
  })
  .strict();
type AuthCtx = z.infer<typeof authCtxSchema>;

function langOf(params: { lang?: unknown }): Lang {
  const l = params.lang;
  return l === "en" || l === "zh" ? l : "vi";
}

function noDbResult<T>(type: ToolResultType, title: string, fallback: T): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: "Không có kết nối CSDL — không thể truy vấn dữ liệu thời gian thực.",
    note: "DB_UNAVAILABLE",
  };
}

const DENY_MSG: Record<Lang, (mod: string) => string> = {
  vi: (m) => `Bạn không có quyền xem dữ liệu "${m}". Vui lòng liên hệ quản trị viên.`,
  en: (m) => `You do not have permission to view "${m}". Please contact an administrator.`,
  zh: (m) => `您无权查看 "${m}" 数据。请联系管理员。`,
};

function deniedResult<T>(type: ToolResultType, title: string, fallback: T, module: string, lang: Lang): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: DENY_MSG[lang](module),
    note: "PERMISSION_DENIED",
  };
}

/**
 * RBAC gate shared by every P2 read tool. Returns null when ALLOWED; otherwise
 * a no-data "denied" ToolResult the handler returns as-is. FAIL-SAFE: a
 * missing/invalid `__authCtx` → DENY (never leaks data).
 */
async function rbacGate<T>(
  rawAuthCtx: unknown,
  module: string,
  type: ToolResultType,
  title: string,
  fallback: T,
  lang: Lang,
): Promise<ToolResult<T> | null> {
  const parsed = authCtxSchema.safeParse(rawAuthCtx);
  if (!parsed.success) return deniedResult(type, title, fallback, module, lang);
  const auth: AuthCtx = parsed.data;
  let allowed = false;
  try {
    allowed = await checkPermission(auth.userId, auth.role, module, "canView");
  } catch {
    allowed = false; // fail-safe on any RBAC lookup error
  }
  if (!allowed) return deniedResult(type, title, fallback, module, lang);
  return null;
}

function fmtTs(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

// ════════════════════════════════════════════════════════════════════════════
// 1. list_work_orders — maintenance work orders (maintenance_work_orders)
// ════════════════════════════════════════════════════════════════════════════

// UI status filter → DB workOrderStatusEnum value(s).
const WO_STATUS_MAP: Record<"open" | "in_progress" | "done", string[]> = {
  open: ["OPEN", "SCHEDULED", "ON_HOLD"],
  in_progress: ["IN_PROGRESS"],
  done: ["COMPLETED", "CANCELLED"],
};

interface WorkOrderItem {
  id: number;
  workOrderNumber: string;
  title: string;
  machineId: number;
  machineCode: string | null;
  priority: number;
  status: string;
  type: string;
  assignedTo: number | null;
  createdAt: string | null;
}

interface WorkOrderListData {
  count: number;
  items: WorkOrderItem[];
  rows: RenderRow[];
}

const workOrdersParams = z
  .object({
    status: z.enum(["open", "in_progress", "done"]).optional(),
    machineCode: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50).optional().default(10),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const listWorkOrders: Tool<z.infer<typeof workOrdersParams>, WorkOrderListData> = {
  name: "list_work_orders",
  description:
    "Danh sách lệnh bảo trì (maintenance work orders): id, tiêu đề, máy, ưu tiên, trạng thái, người nhận. " +
    "Lọc theo trạng thái (open/in_progress/done) và mã máy. READ-ONLY, RBAC machine_downtime.",
  parameters: workOrdersParams,
  triggers: [
    "lệnh bảo trì", "work order", "công việc bảo trì", "phiếu bảo trì", "đang mở", "维修工单",
  ],
  kind: "read",
  requiredPermission: { module: "machine_downtime", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { status, machineCode, limit } = params;
    const empty: WorkOrderListData = { count: 0, items: [], rows: [] };
    const title = "Lệnh bảo trì";
    const denied = await rbacGate<WorkOrderListData>(
      (params as any).__authCtx, "machine_downtime", "work_order_list", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<WorkOrderListData>("work_order_list", title, empty);

    const conds = [];
    if (status) conds.push(inArray(maintenanceWorkOrders.status, WO_STATUS_MAP[status] as any));
    if (machineCode) conds.push(eq(maintenanceWorkOrders.machineCode, machineCode));

    const rows = await db
      .select({
        id: maintenanceWorkOrders.id,
        workOrderNumber: maintenanceWorkOrders.workOrderNumber,
        title: maintenanceWorkOrders.title,
        machineId: maintenanceWorkOrders.machineId,
        machineCode: maintenanceWorkOrders.machineCode,
        priority: maintenanceWorkOrders.priority,
        status: maintenanceWorkOrders.status,
        type: maintenanceWorkOrders.type,
        assignedTo: maintenanceWorkOrders.assignedTo,
        createdAt: maintenanceWorkOrders.createdAt,
      })
      .from(maintenanceWorkOrders)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(maintenanceWorkOrders.openedAt))
      .limit(limit);

    const items: WorkOrderItem[] = rows.map((r) => ({
      id: r.id,
      workOrderNumber: r.workOrderNumber,
      title: r.title,
      machineId: r.machineId,
      machineCode: r.machineCode ?? null,
      priority: Number(r.priority ?? 3),
      status: String(r.status),
      type: String(r.type),
      assignedTo: r.assignedTo ?? null,
      createdAt: fmtTs(r.createdAt),
    }));

    const renderRows: RenderRow[] = items.map((w) => ({
      label: `${w.workOrderNumber} · ${w.machineCode ?? `#${w.machineId}`}`,
      value: `${w.title} — ${w.status} (ưu tiên ${w.priority})`,
    }));
    const data: WorkOrderListData = { count: items.length, items, rows: renderRows };

    const scope = machineCode ? `máy ${machineCode}` : "tất cả máy";
    const statusLabel = status ? ` trạng thái ${status}` : "";
    if (items.length === 0) {
      return {
        type: "work_order_list",
        title,
        data,
        textSummary: `Không có lệnh bảo trì nào${statusLabel} cho ${scope}.`,
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 8)
      .map((w, i) => `${i + 1}. ${w.workOrderNumber} (${w.machineCode ?? `#${w.machineId}`}): ${w.title} — ${w.status}, ưu tiên ${w.priority}`)
      .join("; ");
    return {
      type: "work_order_list",
      title,
      data,
      textSummary: `${items.length} lệnh bảo trì${statusLabel} (${scope}): ${listing}.`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 2. list_active_alerts — current alerts (alert_history + predictive_alerts)
// ════════════════════════════════════════════════════════════════════════════

interface AlertItem {
  source: "alert_history" | "predictive_alert";
  id: number;
  type: string;
  severity: string | null;
  machine: string | null;
  message: string;
  time: string | null;
  acknowledged: boolean;
}

interface AlertListData {
  count: number;
  unacknowledged: number;
  items: AlertItem[];
  rows: RenderRow[];
}

const activeAlertsParams = z
  .object({
    severity: z.string().min(1).max(20).optional(),
    acknowledged: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional().default(10),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const listActiveAlerts: Tool<z.infer<typeof activeAlertsParams>, AlertListData> = {
  name: "list_active_alerts",
  description:
    "Danh sách cảnh báo hiện hành (alert_history + predictive_alerts): loại, máy, mức độ, nội dung, " +
    "thời gian, đã xác nhận hay chưa. Lọc theo mức độ và trạng thái xác nhận. READ-ONLY, RBAC mqtt_alerts.",
  parameters: activeAlertsParams,
  triggers: [
    "cảnh báo đang mở", "active alert", "alert nào", "danh sách cảnh báo", "chưa xác nhận", "报警列表",
  ],
  kind: "read",
  requiredPermission: { module: "mqtt_alerts", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { severity, acknowledged, limit } = params;
    const empty: AlertListData = { count: 0, unacknowledged: 0, items: [], rows: [] };
    const title = "Cảnh báo hiện hành";
    const denied = await rbacGate<AlertListData>(
      (params as any).__authCtx, "mqtt_alerts", "alert_list", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<AlertListData>("alert_list", title, empty);

    // ── 2a. alert_history (joined to alert_settings for type/name + machineId) ──
    const histConds = [];
    if (acknowledged === true) histConds.push(sql`${alertHistory.acknowledgedAt} is not null`);
    if (acknowledged === false) histConds.push(isNull(alertHistory.acknowledgedAt));
    const histRows = await db
      .select({
        id: alertHistory.id,
        message: alertHistory.message,
        acknowledgedAt: alertHistory.acknowledgedAt,
        createdAt: alertHistory.createdAt,
        alertType: alertSettings.alertType,
        machineId: alertSettings.machineId,
      })
      .from(alertHistory)
      .leftJoin(alertSettings, eq(alertSettings.id, alertHistory.alertSettingId))
      .where(histConds.length ? and(...histConds) : undefined)
      .orderBy(desc(alertHistory.createdAt))
      .limit(limit);

    // ── 2b. predictive_alerts (ACTIVE; severity = maintenanceUrgencyEnum) ──
    const predConds = [eq(predictiveAlerts.status, "ACTIVE")];
    if (severity) predConds.push(eq(predictiveAlerts.severity, severity as any));
    if (acknowledged === true) predConds.push(sql`${predictiveAlerts.acknowledgedAt} is not null`);
    if (acknowledged === false) predConds.push(isNull(predictiveAlerts.acknowledgedAt));
    const predRows = await db
      .select({
        id: predictiveAlerts.id,
        alertType: predictiveAlerts.alertType,
        severity: predictiveAlerts.severity,
        title: predictiveAlerts.title,
        machineCode: predictiveAlerts.machineCode,
        acknowledgedAt: predictiveAlerts.acknowledgedAt,
        createdAt: predictiveAlerts.createdAt,
      })
      .from(predictiveAlerts)
      .where(and(...predConds))
      .orderBy(desc(predictiveAlerts.createdAt))
      .limit(limit);

    const histItems: AlertItem[] = histRows.map((r) => ({
      source: "alert_history",
      id: r.id,
      type: String(r.alertType ?? "alert"),
      severity: null, // alert_history has no severity column
      machine: r.machineId != null ? `#${r.machineId}` : null,
      message: r.message,
      time: fmtTs(r.createdAt),
      acknowledged: r.acknowledgedAt != null,
    }));
    const predItems: AlertItem[] = predRows.map((r) => ({
      source: "predictive_alert",
      id: r.id,
      type: String(r.alertType),
      severity: String(r.severity),
      machine: r.machineCode ?? null,
      message: r.title,
      time: fmtTs(r.createdAt),
      acknowledged: r.acknowledgedAt != null,
    }));

    // Merge, sort newest-first, cap at limit.
    let items = [...predItems, ...histItems].sort((a, b) => (b.time ?? "").localeCompare(a.time ?? "")).slice(0, limit);
    // Client-side severity filter for history rows (no severity column there).
    if (severity) items = items.filter((a) => a.severity == null || a.severity.toLowerCase() === severity.toLowerCase() || a.source === "predictive_alert");

    const unacknowledged = items.filter((a) => !a.acknowledged).length;
    const renderRows: RenderRow[] = items.map((a) => ({
      label: `${a.type}${a.severity ? ` (${a.severity})` : ""} · ${a.machine ?? "—"}`,
      value: `${a.message}${a.acknowledged ? " [đã xác nhận]" : " [chưa xác nhận]"}`,
    }));
    const data: AlertListData = { count: items.length, unacknowledged, items, rows: renderRows };

    if (items.length === 0) {
      return {
        type: "alert_list",
        title,
        data,
        textSummary: "Không có cảnh báo nào khớp điều kiện.",
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 8)
      .map((a, i) => `${i + 1}. ${a.type}${a.severity ? `/${a.severity}` : ""} (${a.machine ?? "—"}): ${a.message}${a.acknowledged ? "" : " [chưa ack]"}`)
      .join("; ");
    return {
      type: "alert_list",
      title,
      data,
      textSummary: `${items.length} cảnh báo (${unacknowledged} chưa xác nhận): ${listing}.`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 3. list_thresholds — spec limits (measurement_point_defs) + yield thresholds
//    (yield_alert_thresholds). Spec limits are primary; falls back to / also
//    includes yield thresholds when no measurement point matches.
// ════════════════════════════════════════════════════════════════════════════

interface SpecLimitItem {
  pointDefId: number;
  productModelId: number;
  productCode: string | null;
  pointCode: string;
  pointName: string;
  usl: number | null;
  lsl: number | null;
  target: number | null;
  unit: string | null;
}

interface YieldThresholdItem {
  id: number;
  metricType: string;
  warning: number | null;
  critical: number | null;
  target: number | null;
  enabled: boolean;
}

interface SpecLimitsData {
  specLimits: SpecLimitItem[];
  yieldThresholds: YieldThresholdItem[];
  rows: RenderRow[];
}

const thresholdsParams = z
  .object({
    productCode: z.string().min(1).max(100).optional(),
    productModelId: z.number().int().positive().optional(),
    measurementPoint: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(50).optional().default(15),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const listThresholds: Tool<z.infer<typeof thresholdsParams>, SpecLimitsData> = {
  name: "list_thresholds",
  description:
    "Giới hạn spec điểm đo hiện hành (USL/LSL/target từ measurement_point_defs) và/hoặc ngưỡng yield " +
    "(yield_alert_thresholds). Lọc theo sản phẩm hoặc tên điểm đo. READ-ONLY, RBAC settings_measurement_points.",
  parameters: thresholdsParams,
  triggers: [
    "ngưỡng hiện tại", "giới hạn spec", "spec limit", "USL LSL", "ngưỡng yield",
    "threshold hiện hành", "当前阈值",
  ],
  kind: "read",
  requiredPermission: { module: "settings_measurement_points", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { productCode, productModelId, measurementPoint, limit } = params;
    const empty: SpecLimitsData = { specLimits: [], yieldThresholds: [], rows: [] };
    const title = "Giới hạn spec & ngưỡng";
    const denied = await rbacGate<SpecLimitsData>(
      (params as any).__authCtx, "settings_measurement_points", "spec_limits", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<SpecLimitsData>("spec_limits", title, empty);

    // ── 3a. spec limits from measurement_point_defs (active, not soft-deleted) ──
    const mpConds = [eq(measurementPointDefs.isActive, true), isNull(measurementPointDefs.deletedAt)];
    if (productModelId) mpConds.push(eq(measurementPointDefs.productModelId, productModelId));
    if (productCode) mpConds.push(eq(productModels.code, productCode));
    if (measurementPoint) {
      mpConds.push(sql`(${measurementPointDefs.name} ilike ${`%${measurementPoint}%`} or ${measurementPointDefs.code} ilike ${`%${measurementPoint}%`})`);
    }
    const mpRows = await db
      .select({
        pointDefId: measurementPointDefs.id,
        productModelId: measurementPointDefs.productModelId,
        productCode: productModels.code,
        pointCode: measurementPointDefs.code,
        pointName: measurementPointDefs.name,
        usl: measurementPointDefs.upperLimit,
        lsl: measurementPointDefs.lowerLimit,
        target: measurementPointDefs.nominalValue,
        unit: measurementPointDefs.unit,
      })
      .from(measurementPointDefs)
      .leftJoin(productModels, eq(productModels.id, measurementPointDefs.productModelId))
      .where(and(...mpConds))
      .orderBy(measurementPointDefs.orderIndex)
      .limit(limit);

    const specLimits: SpecLimitItem[] = mpRows.map((r) => ({
      pointDefId: r.pointDefId,
      productModelId: r.productModelId,
      productCode: r.productCode ?? null,
      pointCode: r.pointCode,
      pointName: r.pointName,
      usl: num(r.usl),
      lsl: num(r.lsl),
      target: num(r.target),
      unit: r.unit ?? null,
    }));

    // ── 3b. yield thresholds — included always when no MP filter narrows scope,
    //         and as a fallback when no measurement point matched. ──
    let yieldThresholds: YieldThresholdItem[] = [];
    const includeYield = !measurementPoint && !productCode && !productModelId;
    if (includeYield || specLimits.length === 0) {
      const ytRows = await db
        .select({
          id: yieldAlertThresholds.id,
          metricType: yieldAlertThresholds.metricType,
          warning: yieldAlertThresholds.warningThreshold,
          critical: yieldAlertThresholds.criticalThreshold,
          target: yieldAlertThresholds.targetValue,
          enabled: yieldAlertThresholds.isEnabled,
        })
        .from(yieldAlertThresholds)
        .where(eq(yieldAlertThresholds.isEnabled, true))
        .orderBy(yieldAlertThresholds.metricType)
        .limit(limit);
      yieldThresholds = ytRows.map((r) => ({
        id: r.id,
        metricType: String(r.metricType),
        warning: num(r.warning),
        critical: num(r.critical),
        target: num(r.target),
        enabled: !!r.enabled,
      }));
    }

    const renderRows: RenderRow[] = [
      ...specLimits.map((s) => ({
        label: `${s.pointCode} (${s.pointName})${s.productCode ? ` · ${s.productCode}` : ""}`,
        value: `USL=${s.usl ?? "—"}, LSL=${s.lsl ?? "—"}, target=${s.target ?? "—"}${s.unit ? ` ${s.unit}` : ""}`,
      })),
      ...yieldThresholds.map((y) => ({
        label: `Yield ${y.metricType}`,
        value: `warning=${y.warning ?? "—"}, critical=${y.critical ?? "—"}, target=${y.target ?? "—"}`,
      })),
    ];
    const data: SpecLimitsData = { specLimits, yieldThresholds, rows: renderRows };

    if (specLimits.length === 0 && yieldThresholds.length === 0) {
      return {
        type: "spec_limits",
        title,
        data,
        textSummary: "Không tìm thấy giới hạn spec hoặc ngưỡng yield nào khớp điều kiện.",
        note: "NOT_FOUND",
      };
    }
    const specLine = specLimits.length
      ? `Spec (${specLimits.length} điểm đo): ` +
        specLimits
          .slice(0, 6)
          .map((s) => `${s.pointCode} USL=${s.usl ?? "—"}/LSL=${s.lsl ?? "—"}/target=${s.target ?? "—"}${s.unit ? s.unit : ""}`)
          .join("; ")
      : "";
    const yieldLine = yieldThresholds.length
      ? ` Ngưỡng yield: ` + yieldThresholds.map((y) => `${y.metricType}(W=${y.warning ?? "—"},C=${y.critical ?? "—"})`).join("; ")
      : "";
    return {
      type: "spec_limits",
      title,
      data,
      textSummary: `${specLine}${specLine && yieldLine ? "." : ""}${yieldLine}`.trim() || "Đã tải giới hạn spec & ngưỡng.",
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 4. list_recipes — machine recipes (machine_recipes)
// ════════════════════════════════════════════════════════════════════════════

interface RecipeItem {
  id: number;
  code: string;
  name: string;
  machineId: number | null;
  machineType: string | null;
  version: number;
  status: string;
  active: boolean;
  updatedAt: string | null;
}

interface RecipeListData {
  count: number;
  activeRecipe: RecipeItem | null;
  items: RecipeItem[];
  rows: RenderRow[];
}

const recipesParams = z
  .object({
    machineCode: z.string().min(1).max(64).optional(),
    machineId: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(50).optional().default(15),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const listRecipes: Tool<z.infer<typeof recipesParams>, RecipeListData> = {
  name: "list_recipes",
  description:
    "Danh sách công thức máy (machine_recipes): tên, máy, phiên bản, trạng thái, recipe nào đang active. " +
    "Lọc theo máy. READ-ONLY, RBAC machine_control.",
  parameters: recipesParams,
  triggers: [
    "công thức máy", "recipe nào", "danh sách recipe", "recipe đang chạy", "active recipe", "配方列表",
  ],
  kind: "read",
  requiredPermission: { module: "machine_control", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { machineCode, machineId, limit } = params;
    const empty: RecipeListData = { count: 0, activeRecipe: null, items: [], rows: [] };
    const title = "Công thức máy (recipes)";
    const denied = await rbacGate<RecipeListData>(
      (params as any).__authCtx, "machine_control", "recipe_list", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<RecipeListData>("recipe_list", title, empty);

    // Resolve machineCode → machineId (read-only).
    let resolvedMachineId = machineId ?? null;
    if (resolvedMachineId == null && machineCode) {
      const m = await db.select({ id: machines.id }).from(machines).where(eq(machines.code, machineCode)).limit(1);
      if (!m[0]) {
        return {
          type: "recipe_list",
          title,
          data: empty,
          textSummary: `Không tìm thấy máy "${machineCode}".`,
          note: "NOT_FOUND",
        };
      }
      resolvedMachineId = m[0].id;
    }

    const conds = [];
    if (resolvedMachineId != null) conds.push(eq(machineRecipes.machineId, resolvedMachineId));
    const rows = await db
      .select({
        id: machineRecipes.id,
        code: machineRecipes.code,
        name: machineRecipes.name,
        machineId: machineRecipes.machineId,
        machineType: machineRecipes.machineType,
        version: machineRecipes.version,
        status: machineRecipes.status,
        updatedAt: machineRecipes.updatedAt,
      })
      .from(machineRecipes)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(machineRecipes.updatedAt))
      .limit(limit);

    const items: RecipeItem[] = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      machineId: r.machineId ?? null,
      machineType: r.machineType == null ? null : String(r.machineType),
      version: Number(r.version ?? 1),
      status: String(r.status),
      active: String(r.status) === "active",
      updatedAt: fmtTs(r.updatedAt),
    }));
    const activeRecipe = items.find((r) => r.active) ?? null;

    const renderRows: RenderRow[] = items.map((r) => ({
      label: `${r.code} v${r.version}${r.machineType ? ` · ${r.machineType}` : ""}`,
      value: `${r.name} — ${r.status}${r.active ? " (đang chạy)" : ""}`,
    }));
    const data: RecipeListData = { count: items.length, activeRecipe, items, rows: renderRows };

    const scope = machineCode ?? (resolvedMachineId != null ? `#${resolvedMachineId}` : "tất cả máy");
    if (items.length === 0) {
      return {
        type: "recipe_list",
        title,
        data,
        textSummary: `Không có công thức máy nào cho ${scope}.`,
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 8)
      .map((r, i) => `${i + 1}. ${r.code} v${r.version}: ${r.name} — ${r.status}${r.active ? " (active)" : ""}`)
      .join("; ");
    const activeLine = activeRecipe
      ? ` Đang chạy: ${activeRecipe.code} v${activeRecipe.version} (${activeRecipe.name}).`
      : " Chưa có recipe nào đang active.";
    return {
      type: "recipe_list",
      title,
      data,
      textSummary: `${items.length} công thức máy (${scope}): ${listing}.${activeLine}`,
    };
  },
};

// ─── register ────────────────────────────────────────────────────────────────

let _registeredP2 = false;
export function registerP2ReadTools(): void {
  if (_registeredP2) return;
  _registeredP2 = true;
  registerTool(listWorkOrders);
  registerTool(listActiveAlerts);
  registerTool(listThresholds);
  registerTool(listRecipes);
}

registerP2ReadTools();

export { listWorkOrders, listActiveAlerts, listThresholds, listRecipes };
