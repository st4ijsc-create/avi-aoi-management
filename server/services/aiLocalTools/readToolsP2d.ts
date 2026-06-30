/**
 * AI Local Tools — Phase P2 (group D) READ tools.
 *
 * Continues readToolsP2.ts (group A) and readToolsP2bc.ts (groups B & C). Doc 11
 * (AI Assistant Knowledge Remediation, Phase P2 group D) lists a few more
 * high-value READ tools so the assistant can answer live questions over
 * anomaly detection, product/lot genealogy, energy/ENPI and process routing.
 *
 *   1. list_anomalies   → predictive_alerts (PATTERN_ANOMALY + DEFECT_SPIKE +
 *                         QUALITY_DEGRADATION alert types = "detected anomalies")
 *                         RBAC analytics_root_cause
 *   2. trace_genealogy  → genealogy_chain (serialNumber OR lotCode required)
 *                         RBAC mes_bom
 *   3. get_energy_metrics → energy_readings (+ enpi_metrics aggregate)
 *                         RBAC energy
 *   4. get_routing      → processes + line_process_assignments (+ line_stages)
 *                         RBAC settings_products
 *
 * Design — mirrors readToolsP2bc.ts EXACTLY:
 *   - `kind: 'read'` with a declared `requiredPermission` ALSO enforced in the
 *     handler via the shared `rbacGate` (fail-safe: missing/invalid `__authCtx`
 *     OR denied → no-data "denied" result; never throws, never leaks).
 *   - SELECT-only Drizzle ORM (parameterized). No INSERT/UPDATE/DELETE.
 *   - `getDb()` guard → noDbResult. Vietnamese `textSummary`.
 *   - Each tool's `data` carries a render-friendly `rows: Array<{label,value}>`
 *     so the FE AIToolResultCard generic fallback renders it without a bespoke
 *     card.
 *
 * Self-registers on import (see index.ts → `import "./readToolsP2d"`).
 *
 * Schema adaptations vs the doc-11 spec (noted, no invented columns):
 *   - No dedicated anomaly-detection RESULTS table exists. ai_anomaly_memory_bank
 *     / ai_anomaly_profiles are PatchCore REFERENCE data (embeddings + thresholds),
 *     not detected events. The closest "detected anomaly" stream is
 *     predictive_alerts whose alertType is PATTERN_ANOMALY / DEFECT_SPIKE /
 *     QUALITY_DEGRADATION (carry score=confidenceScore, severity, status, time,
 *     machine). list_anomalies queries those rows.
 *   - energy_readings / enpi_metrics key on machineId (not machineCode) → the
 *     machineCode filter is resolved to a machineId via the machines table first.
 *   - genealogy_chain has serialNumber/parentSerial/lotCode/stationCode/
 *     eventType/recordedAt — used directly. There is no separate lot/serial
 *     master to join, so trace returns the chain rows for the serial/lot.
 */

import { z } from "zod";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  predictiveAlerts,
  genealogyChain,
  energyReadings,
  enpiMetrics,
  machines,
  processes,
  lineProcessAssignments,
  productionLines,
  productModels,
  lineProductAssignments,
} from "../../../drizzle/schema";
import { checkPermission } from "../../_core/accessControl";
import { registerTool, type Tool, type ToolResult, type ToolLang, type ToolResultType } from "./toolRegistry";

// ─── shared helpers (same shape as readToolsP2bc.ts) ─────────────────────────

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
 * RBAC gate shared by every P2d read tool. Returns null when ALLOWED; otherwise
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

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** Resolve a machineCode → machineId (read-only). null when not found. */
async function resolveMachineId(db: any, machineCode: string): Promise<number | null> {
  const m = await db.select({ id: machines.id }).from(machines).where(eq(machines.code, machineCode)).limit(1);
  return m[0]?.id ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. list_anomalies — recently detected anomalies (predictive_alerts subset)
//    "Detected anomaly" = predictive_alerts whose alertType is one of the
//    anomaly-flavoured types. score = confidenceScore; type = alertType.
// ════════════════════════════════════════════════════════════════════════════

// alertTypeEnum_1 values that represent a DETECTED anomaly event.
const ANOMALY_ALERT_TYPES = ["PATTERN_ANOMALY", "DEFECT_SPIKE", "QUALITY_DEGRADATION"] as const;

interface AnomalyItem {
  id: number;
  time: string | null;
  machine: string | null;
  type: string;
  title: string;
  severity: string;
  score: number | null;
  status: string;
}

interface AnomalyListData {
  count: number;
  items: AnomalyItem[];
  rows: RenderRow[];
}

const anomaliesParams = z
  .object({
    machineCode: z.string().min(1).max(64).optional(),
    severity: z.string().min(1).max(20).optional(),
    limit: z.number().int().min(1).max(50).optional().default(15),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const listAnomalies: Tool<z.infer<typeof anomaliesParams>, AnomalyListData> = {
  name: "list_anomalies",
  description:
    "Danh sách bất thường được phát hiện gần đây (predictive_alerts loại PATTERN_ANOMALY / DEFECT_SPIKE / " +
    "QUALITY_DEGRADATION): thời gian, máy, loại, mức độ, điểm tin cậy, trạng thái. Lọc theo mã máy / mức độ. " +
    "READ-ONLY, RBAC analytics_root_cause.",
  parameters: anomaliesParams,
  triggers: [
    "bất thường", "anomaly nào", "phát hiện bất thường", "danh sách anomaly", "异常列表",
  ],
  kind: "read",
  requiredPermission: { module: "analytics_root_cause", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { machineCode, severity, limit } = params;
    const empty: AnomalyListData = { count: 0, items: [], rows: [] };
    const title = "Bất thường phát hiện";
    const denied = await rbacGate<AnomalyListData>(
      (params as any).__authCtx, "analytics_root_cause", "anomaly_list", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<AnomalyListData>("anomaly_list", title, empty);

    const conds = [inArray(predictiveAlerts.alertType, ANOMALY_ALERT_TYPES as any)];
    if (machineCode) conds.push(eq(predictiveAlerts.machineCode, machineCode));
    if (severity) conds.push(eq(predictiveAlerts.severity, severity.toUpperCase() as any));

    const dbRows = await db
      .select({
        id: predictiveAlerts.id,
        alertType: predictiveAlerts.alertType,
        severity: predictiveAlerts.severity,
        title: predictiveAlerts.title,
        machineCode: predictiveAlerts.machineCode,
        confidenceScore: predictiveAlerts.confidenceScore,
        status: predictiveAlerts.status,
        createdAt: predictiveAlerts.createdAt,
      })
      .from(predictiveAlerts)
      .where(and(...conds))
      .orderBy(desc(predictiveAlerts.createdAt))
      .limit(limit);

    const items: AnomalyItem[] = dbRows.map((r: any) => ({
      id: r.id,
      time: fmtTs(r.createdAt),
      machine: r.machineCode ?? null,
      type: String(r.alertType),
      title: r.title,
      severity: String(r.severity),
      score: num(r.confidenceScore),
      status: String(r.status),
    }));

    const renderRows: RenderRow[] = items.map((a) => ({
      label: `${a.type}${a.machine ? ` · ${a.machine}` : ""} (${a.severity})`,
      value: `${a.title} — tin cậy ${a.score ?? "—"}% · ${a.status} (${a.time?.slice(0, 10) ?? "—"})`,
    }));
    const data: AnomalyListData = { count: items.length, items, rows: renderRows };

    const scope = machineCode ? `máy ${machineCode}` : severity ? `mức độ ${severity}` : "gần đây";
    if (items.length === 0) {
      return {
        type: "anomaly_list",
        title,
        data,
        textSummary: `Không có bất thường nào (${scope}).`,
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 8)
      .map((a, i) => `${i + 1}. ${a.type}${a.machine ? `/${a.machine}` : ""} (${a.severity}): ${a.title} — ${a.status}`)
      .join("; ");
    return {
      type: "anomaly_list",
      title,
      data,
      textSummary: `${items.length} bất thường (${scope}): ${listing}.`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 2. trace_genealogy — lineage chain for a serial / lot (genealogy_chain)
//    Requires serialNumber OR lotId (=lotCode). Clarifies when neither given.
// ════════════════════════════════════════════════════════════════════════════

interface GenealogyItem {
  id: number;
  recordedAt: string | null;
  serialNumber: string;
  parentSerial: string | null;
  eventType: string;
  station: string | null;
  lotCode: string | null;
}

interface GenealogyTraceData {
  serialNumber: string | null;
  lotCode: string | null;
  count: number;
  items: GenealogyItem[];
  rows: RenderRow[];
}

const genealogyParams = z
  .object({
    serialNumber: z.string().min(1).max(128).optional(),
    lotId: z.string().min(1).max(80).optional(),
    limit: z.number().int().min(1).max(50).optional().default(20),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const CLARIFY_GENEALOGY: Record<Lang, string> = {
  vi: "Bạn muốn truy xuất nguồn gốc của **serial** hay **lô** nào? Vui lòng cung cấp `serial` (ví dụ `SN12345`) hoặc `mã lô` (ví dụ `LOT-001`).",
  en: "Which **serial** or **lot** do you want to trace? Please provide a `serialNumber` (e.g. `SN12345`) or `lotId`/lot code (e.g. `LOT-001`).",
  zh: "您想追溯哪个**序列号**或**批次**？请提供 `serialNumber`（如 `SN12345`）或 `lotId`/批次号（如 `LOT-001`）。",
};

const traceGenealogy: Tool<z.infer<typeof genealogyParams>, GenealogyTraceData> = {
  name: "trace_genealogy",
  description:
    "Truy xuất nguồn gốc / phả hệ (genealogy_chain) cho một serial hoặc lô: chuỗi sự kiện cha→con, công trạm, " +
    "loại sự kiện, thời gian. BẮT BUỘC serialNumber HOẶC lotId. READ-ONLY, RBAC mes_bom.",
  parameters: genealogyParams,
  triggers: [
    "truy xuất nguồn gốc", "genealogy", "lô cha", "trace lot", "serial nào", "谱系",
  ],
  kind: "read",
  requiredPermission: { module: "mes_bom", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { serialNumber, lotId, limit } = params;
    const empty: GenealogyTraceData = { serialNumber: null, lotCode: null, count: 0, items: [], rows: [] };
    const title = "Truy xuất nguồn gốc (genealogy)";
    const denied = await rbacGate<GenealogyTraceData>(
      (params as any).__authCtx, "mes_bom", "genealogy_trace", title, empty, lang,
    );
    if (denied) return denied;

    // Required-arg clarify (mirrors get_lot_status pattern; no DB call needed).
    if (!serialNumber && !lotId) {
      return {
        type: "genealogy_trace",
        title,
        data: empty,
        textSummary: CLARIFY_GENEALOGY[lang],
        note: "MISSING_REQUIRED_ARG",
      };
    }

    const db = await getDb();
    if (!db) return noDbResult<GenealogyTraceData>("genealogy_trace", title, empty);

    const conds = [];
    if (serialNumber) {
      // Match the serial as a node serial OR a parent serial (both lineage directions).
      conds.push(
        or(eq(genealogyChain.serialNumber, serialNumber), eq(genealogyChain.parentSerial, serialNumber)),
      );
    }
    if (lotId) conds.push(eq(genealogyChain.lotCode, lotId));

    const dbRows = await db
      .select({
        id: genealogyChain.id,
        serialNumber: genealogyChain.serialNumber,
        parentSerial: genealogyChain.parentSerial,
        eventType: genealogyChain.eventType,
        stationCode: genealogyChain.stationCode,
        lotCode: genealogyChain.lotCode,
        recordedAt: genealogyChain.recordedAt,
      })
      .from(genealogyChain)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(genealogyChain.recordedAt))
      .limit(limit);

    const items: GenealogyItem[] = dbRows.map((r: any) => ({
      id: r.id,
      recordedAt: fmtTs(r.recordedAt),
      serialNumber: r.serialNumber,
      parentSerial: r.parentSerial ?? null,
      eventType: String(r.eventType),
      station: r.stationCode ?? null,
      lotCode: r.lotCode ?? null,
    }));

    const renderRows: RenderRow[] = items.map((g) => ({
      label: `${g.recordedAt?.slice(0, 16).replace("T", " ") ?? "—"} · ${g.eventType}`,
      value: `${g.serialNumber}${g.parentSerial ? ` ← ${g.parentSerial}` : ""}${g.station ? ` @ ${g.station}` : ""}${g.lotCode ? ` (lô ${g.lotCode})` : ""}`,
    }));
    const data: GenealogyTraceData = {
      serialNumber: serialNumber ?? null,
      lotCode: lotId ?? null,
      count: items.length,
      items,
      rows: renderRows,
    };

    const scope = serialNumber ? `serial ${serialNumber}` : `lô ${lotId}`;
    if (items.length === 0) {
      return {
        type: "genealogy_trace",
        title,
        data,
        textSummary: `Không có dữ liệu phả hệ cho ${scope}.`,
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 8)
      .map((g, i) => `${i + 1}. ${g.eventType}: ${g.serialNumber}${g.parentSerial ? ` ← ${g.parentSerial}` : ""}${g.station ? ` @${g.station}` : ""}`)
      .join("; ");
    return {
      type: "genealogy_trace",
      title,
      data,
      textSummary: `Phả hệ ${scope} (${items.length} mắt xích): ${listing}.`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 3. get_energy_metrics — recent energy readings (+ ENPI aggregate)
//    energy_readings + enpi_metrics. machineCode → machineId resolution.
// ════════════════════════════════════════════════════════════════════════════

interface EnergyReadingItem {
  id: number;
  machineId: number | null;
  timestamp: string | null;
  source: string;
  value: number | null;
  unit: string;
  powerKw: number | null;
}

interface EnpiItem {
  id: number;
  machineId: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalKwh: number | null;
  goodUnits: number;
  energyPerUnit: number | null;
  carbonKg: number | null;
}

interface EnergyMetricsData {
  machineCode: string | null;
  sinceDays: number;
  totalKwh: number;
  readings: EnergyReadingItem[];
  enpi: EnpiItem[];
  rows: RenderRow[];
}

const energyParams = z
  .object({
    machineCode: z.string().min(1).max(64).optional(),
    sinceDays: z.number().int().min(1).max(365).optional().default(7),
    limit: z.number().int().min(1).max(50).optional().default(20),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const getEnergyMetrics: Tool<z.infer<typeof energyParams>, EnergyMetricsData> = {
  name: "get_energy_metrics",
  description:
    "Số đo năng lượng gần đây (energy_readings): kWh, công suất, nguồn — kèm chỉ số ENPI (enpi_metrics: kWh/đơn vị, " +
    "CO2). Lọc theo mã máy và số ngày. READ-ONLY, RBAC energy.",
  parameters: energyParams,
  triggers: [
    "năng lượng", "điện tiêu thụ", "energy", "enpi", "kwh", "能耗",
  ],
  kind: "read",
  requiredPermission: { module: "energy", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { machineCode, sinceDays, limit } = params;
    const empty: EnergyMetricsData = {
      machineCode: machineCode ?? null, sinceDays, totalKwh: 0, readings: [], enpi: [], rows: [],
    };
    const title = "Năng lượng & ENPI";
    const denied = await rbacGate<EnergyMetricsData>(
      (params as any).__authCtx, "energy", "energy_metrics", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<EnergyMetricsData>("energy_metrics", title, empty);

    // Resolve machineCode → machineId (energy tables key on machineId).
    let resolvedMachineId: number | null = null;
    if (machineCode) {
      resolvedMachineId = await resolveMachineId(db, machineCode);
      if (resolvedMachineId == null) {
        return {
          type: "energy_metrics",
          title,
          data: empty,
          textSummary: `Không tìm thấy máy "${machineCode}".`,
          note: "NOT_FOUND",
        };
      }
    }

    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const readConds = [gte(energyReadings.timestamp, since)];
    if (resolvedMachineId != null) readConds.push(eq(energyReadings.machineId, resolvedMachineId));
    const readRows = await db
      .select({
        id: energyReadings.id,
        machineId: energyReadings.machineId,
        timestamp: energyReadings.timestamp,
        source: energyReadings.source,
        value: energyReadings.value,
        unit: energyReadings.unit,
        powerKw: energyReadings.powerKw,
      })
      .from(energyReadings)
      .where(and(...readConds))
      .orderBy(desc(energyReadings.timestamp))
      .limit(limit);

    const readings: EnergyReadingItem[] = readRows.map((r: any) => ({
      id: r.id,
      machineId: r.machineId ?? null,
      timestamp: fmtTs(r.timestamp),
      source: String(r.source),
      value: num(r.value),
      unit: String(r.unit ?? "kWh"),
      powerKw: num(r.powerKw),
    }));
    const totalKwh = readings
      .filter((r) => r.unit.toLowerCase() === "kwh")
      .reduce((s, r) => s + (r.value ?? 0), 0);

    // ENPI aggregate for the same scope/window.
    const enpiConds = [gte(enpiMetrics.periodStart, since)];
    if (resolvedMachineId != null) enpiConds.push(eq(enpiMetrics.machineId, resolvedMachineId));
    const enpiRows = await db
      .select({
        id: enpiMetrics.id,
        machineId: enpiMetrics.machineId,
        periodStart: enpiMetrics.periodStart,
        periodEnd: enpiMetrics.periodEnd,
        totalKwh: enpiMetrics.totalKwh,
        goodUnits: enpiMetrics.goodUnits,
        energyPerUnit: enpiMetrics.energyPerUnit,
        carbonKg: enpiMetrics.carbonKg,
      })
      .from(enpiMetrics)
      .where(and(...enpiConds))
      .orderBy(desc(enpiMetrics.periodStart))
      .limit(limit);

    const enpi: EnpiItem[] = enpiRows.map((r: any) => ({
      id: r.id,
      machineId: r.machineId ?? null,
      periodStart: fmtTs(r.periodStart),
      periodEnd: fmtTs(r.periodEnd),
      totalKwh: num(r.totalKwh),
      goodUnits: Number(r.goodUnits ?? 0),
      energyPerUnit: num(r.energyPerUnit),
      carbonKg: num(r.carbonKg),
    }));

    const renderRows: RenderRow[] = [
      ...readings.map((r) => ({
        label: `${r.timestamp?.slice(0, 16).replace("T", " ") ?? "—"}${r.machineId != null ? ` · máy #${r.machineId}` : ""} · ${r.source}`,
        value: `${r.value ?? "—"} ${r.unit}${r.powerKw != null ? ` (${r.powerKw} kW)` : ""}`,
      })),
      ...enpi.map((e) => ({
        label: `ENPI ${e.periodStart?.slice(0, 10) ?? "—"}→${e.periodEnd?.slice(0, 10) ?? "—"}${e.machineId != null ? ` · máy #${e.machineId}` : ""}`,
        value: `${e.totalKwh ?? "—"} kWh / ${e.goodUnits} đv = ${e.energyPerUnit ?? "—"} kWh/đv${e.carbonKg != null ? ` · ${e.carbonKg} kg CO2` : ""}`,
      })),
    ];
    const data: EnergyMetricsData = {
      machineCode: machineCode ?? null,
      sinceDays,
      totalKwh: Math.round(totalKwh * 1000) / 1000,
      readings,
      enpi,
      rows: renderRows,
    };

    const scope = machineCode ? `máy ${machineCode}` : "toàn bộ";
    if (readings.length === 0 && enpi.length === 0) {
      return {
        type: "energy_metrics",
        title,
        data,
        textSummary: `Không có dữ liệu năng lượng (${scope}, ${sinceDays} ngày).`,
        note: "NOT_FOUND",
      };
    }
    const enpiLine = enpi.length
      ? ` ENPI mới nhất: ${enpi[0]!.energyPerUnit ?? "—"} kWh/đv (${enpi[0]!.totalKwh ?? "—"} kWh / ${enpi[0]!.goodUnits} đv).`
      : "";
    return {
      type: "energy_metrics",
      title,
      data,
      textSummary: `Năng lượng ${scope} (${sinceDays} ngày): ${readings.length} số đo, tổng ${data.totalKwh} kWh.${enpiLine}`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 4. get_routing — ordered process steps for a line (or all processes).
//    processes + line_process_assignments. lineCode → line; productCode is NOT
//    cleanly modeled per-process (line_product_assignments only ties a product
//    to a LINE, not to individual processes), so productCode resolves to the
//    line(s) running that product and we return THAT line's routing.
// ════════════════════════════════════════════════════════════════════════════

interface RoutingStepItem {
  orderIndex: number;
  processCode: string;
  processName: string;
  processType: string;
  cycleTimeTarget: number | null;
  lineCode: string | null;
  stationId: number | null;
}

interface RoutingData {
  lineCode: string | null;
  count: number;
  items: RoutingStepItem[];
  rows: RenderRow[];
}

const routingParams = z
  .object({
    lineCode: z.string().min(1).max(64).optional(),
    productCode: z.string().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(50).optional().default(20),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const getRouting: Tool<z.infer<typeof routingParams>, RoutingData> = {
  name: "get_routing",
  description:
    "Quy trình / routing công đoạn (processes + line_process_assignments): các bước sản xuất theo thứ tự cho một " +
    "dây chuyền (lineCode). Không có lineCode → liệt kê quy trình chung. READ-ONLY, RBAC settings_products.",
  parameters: routingParams,
  triggers: [
    "quy trình", "routing", "công đoạn của", "các bước sản xuất", "工艺路线",
  ],
  kind: "read",
  requiredPermission: { module: "settings_products", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { lineCode, productCode, limit } = params;
    const empty: RoutingData = { lineCode: lineCode ?? null, count: 0, items: [], rows: [] };
    const title = "Quy trình sản xuất (routing)";
    const denied = await rbacGate<RoutingData>(
      (params as any).__authCtx, "settings_products", "routing_steps", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<RoutingData>("routing_steps", title, empty);

    let resolvedLineId: number | null = null;
    let resolvedLineCode: string | null = lineCode ?? null;
    if (lineCode) {
      const ln = await db
        .select({ id: productionLines.id, code: productionLines.code })
        .from(productionLines)
        .where(eq(productionLines.code, lineCode))
        .limit(1);
      if (!ln[0]) {
        return {
          type: "routing_steps",
          title,
          data: empty,
          textSummary: `Không tìm thấy dây chuyền "${lineCode}".`,
          note: "NOT_FOUND",
        };
      }
      resolvedLineId = ln[0].id;
      resolvedLineCode = ln[0].code;
    } else if (productCode) {
      // productCode → productModel → active line_product_assignment → line.
      // Routing is modeled per LINE (not per product↔process), so we resolve
      // the line that runs this product and return THAT line's routing.
      const lp = await db
        .select({ lineId: lineProductAssignments.lineId, lineCode: productionLines.code })
        .from(lineProductAssignments)
        .innerJoin(productModels, eq(productModels.id, lineProductAssignments.productModelId))
        .leftJoin(productionLines, eq(productionLines.id, lineProductAssignments.lineId))
        .where(and(eq(productModels.code, productCode), eq(lineProductAssignments.isActive, true)))
        .orderBy(desc(lineProductAssignments.startDate))
        .limit(1);
      if (!lp[0]) {
        return {
          type: "routing_steps",
          title,
          data: empty,
          textSummary: `Không tìm thấy dây chuyền đang chạy sản phẩm "${productCode}".`,
          note: "NOT_FOUND",
        };
      }
      resolvedLineId = lp[0].lineId;
      resolvedLineCode = lp[0].lineCode ?? null;
    }

    let items: RoutingStepItem[] = [];
    if (resolvedLineId != null) {
      // Line-specific routing via line_process_assignments → processes.
      const rows = await db
        .select({
          orderIndex: lineProcessAssignments.orderIndex,
          cycleTimeTarget: lineProcessAssignments.cycleTimeTarget,
          stationId: lineProcessAssignments.stationId,
          processCode: processes.code,
          processName: processes.name,
          processType: processes.processType,
          processCycle: processes.cycleTimeTarget,
        })
        .from(lineProcessAssignments)
        .leftJoin(processes, eq(processes.id, lineProcessAssignments.processId))
        .where(and(eq(lineProcessAssignments.lineId, resolvedLineId), eq(lineProcessAssignments.isActive, true)))
        .orderBy(lineProcessAssignments.orderIndex)
        .limit(limit);
      items = rows.map((r: any) => ({
        orderIndex: Number(r.orderIndex ?? 0),
        processCode: String(r.processCode ?? "—"),
        processName: String(r.processName ?? "—"),
        processType: String(r.processType ?? "OTHER"),
        cycleTimeTarget: num(r.cycleTimeTarget) ?? num(r.processCycle),
        lineCode: resolvedLineCode,
        stationId: r.stationId ?? null,
      }));
    } else {
      // No line → the generic process catalog ordered by its own orderIndex.
      const rows = await db
        .select({
          orderIndex: processes.orderIndex,
          processCode: processes.code,
          processName: processes.name,
          processType: processes.processType,
          cycleTimeTarget: processes.cycleTimeTarget,
        })
        .from(processes)
        .where(eq(processes.isActive, true))
        .orderBy(processes.orderIndex)
        .limit(limit);
      items = rows.map((r: any) => ({
        orderIndex: Number(r.orderIndex ?? 0),
        processCode: String(r.processCode),
        processName: String(r.processName),
        processType: String(r.processType ?? "OTHER"),
        cycleTimeTarget: num(r.cycleTimeTarget),
        lineCode: null,
        stationId: null,
      }));
    }

    const renderRows: RenderRow[] = items.map((p) => ({
      label: `${p.orderIndex}. ${p.processCode}${p.lineCode ? ` · ${p.lineCode}` : ""}`,
      value: `${p.processName} (${p.processType})${p.cycleTimeTarget != null ? ` — chu kỳ ${p.cycleTimeTarget}s` : ""}`,
    }));
    const data: RoutingData = { lineCode: resolvedLineCode, count: items.length, items, rows: renderRows };

    const scope = resolvedLineCode ? `dây chuyền ${resolvedLineCode}` : "quy trình chung";
    if (items.length === 0) {
      return {
        type: "routing_steps",
        title,
        data,
        textSummary: `Không có công đoạn nào (${scope}).`,
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 10)
      .map((p) => `${p.orderIndex}. ${p.processCode} (${p.processName})`)
      .join(" → ");
    return {
      type: "routing_steps",
      title,
      data,
      textSummary: `${items.length} công đoạn (${scope}): ${listing}.`,
    };
  },
};

// ─── register ────────────────────────────────────────────────────────────────

let _registeredP2d = false;
export function registerP2dReadTools(): void {
  if (_registeredP2d) return;
  _registeredP2d = true;
  registerTool(listAnomalies);
  registerTool(traceGenealogy);
  registerTool(getEnergyMetrics);
  registerTool(getRouting);
}

registerP2dReadTools();

export { listAnomalies, traceGenealogy, getEnergyMetrics, getRouting };
