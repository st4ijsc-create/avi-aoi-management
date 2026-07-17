/**
 * AI Local Tools — doc 56 Đ6 (device-standardization persona tools, READ-ONLY).
 *
 * Two tools that make the local assistant fluent in the STANDARDISED device data
 * that đợt Đ1–Đ5 put in place (process_results + config-sync shadow + SPC + mart),
 * shaped for the three personas the platform serves:
 *
 *   • get_device_health        — ONE machine at a glance: pass/fail + FPY, config
 *     drift (desired vs reported shadow), and an I-MR SPC verdict (Cpk / out-of-
 *     control) for its primary metric. Serves CÔNG NHÂN ("máy này ổn không?") and
 *     KỸ THUẬT ("lệch cấu hình / năng lực quá trình ra sao?").
 *   • get_fleet_process_summary — pass-rate & first-pass-yield rolled up by machine
 *     type / deviceClass. Serves QUẢN LÝ ("phân xưởng automation hôm nay thế nào?").
 *
 * Same KHUÔN as handlersF6: zod `.strict()` params, getDb() guard → noDbResult,
 * db/* helpers (no ad-hoc SQL), Vietnamese textSummary. kind:'read' (omitted) — NO
 * write/execute. Self-registers on import (index.ts → `import "./handlersF7"`).
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { machines } from "../../../drizzle/schema";
import {
  aggregateProcessResultStats,
  aggregateProcessResultStatsByType,
  getProcessMetricPoints,
  listProcessResultsByMachine,
} from "../../db/processResult";
import { readConfigState } from "../configDriftService";
import { buildProcessControlChart } from "../processSpc";
import { deviceClassOf } from "../../constants/machineTypes";
import { registerTool, type Tool, type ToolResult } from "./toolRegistry";

function sinceDays(days: number): Date {
  return new Date(Date.now() - Math.min(Math.max(days, 1), 90) * 24 * 60 * 60 * 1000);
}
function pct(num: number, total: number): number {
  return total ? Math.round((num / total) * 10000) / 100 : 0;
}
function noDb<T>(type: ToolResult["type"], title: string, fallback: T): ToolResult<T> {
  return { type, title, data: fallback, textSummary: "Không có kết nối CSDL — không thể truy vấn dữ liệu thời gian thực.", note: "DB_UNAVAILABLE" };
}

/** Pick the first numeric metric key from a metrics bag (for SPC when none given). */
function firstNumericMetric(metrics: Record<string, unknown> | null | undefined): string | null {
  if (!metrics) return null;
  for (const [k, v] of Object.entries(metrics)) {
    if (typeof v === "number" && Number.isFinite(v)) return k;
    if (typeof v === "string" && /^-?[0-9.]+$/.test(v.trim())) return k;
  }
  return null;
}

// ── 1. get_device_health ──────────────────────────────────────────────────────

interface DeviceHealthData {
  machineCode: string;
  machineType: string | null;
  deviceClass: string | null;
  lastActivity: string | null;
  process: { pass: number; fail: number; warn: number; skip: number; total: number; failRate: number; fpy: number | null };
  configDrift: { configKind: string; state: string } | null;
  spc: { metricKey: string; ok: boolean; ucl: number | null; cl: number | null; lcl: number | null; cpk: number | null; outOfControl: number; n: number } | null;
}

const deviceHealthParams = z
  .object({
    machineCode: z.string().min(1).max(50),
    metricKey: z.string().min(1).max(64).optional(),
    days: z.number().int().min(1).max(30).optional().default(7),
  })
  .strict();

const getDeviceHealth: Tool<z.infer<typeof deviceHealthParams>, DeviceHealthData> = {
  name: "get_device_health",
  description:
    "Sức khỏe một thiết bị theo tiêu chuẩn: pass/fail + FPY, lệch cấu hình (desired vs reported), và SPC I-MR (Cpk, số điểm ngoài kiểm soát) của thông số chính. Hỗ trợ công nhân + kỹ thuật.",
  triggers: [
    "sức khỏe thiết bị", "sức khỏe máy", "máy này ổn không", "thiết bị này ổn không",
    "device health", "tình trạng thiết bị", "lệch cấu hình", "config drift",
    "năng lực quá trình", "cpk máy", "máy này thế nào",
  ],
  parameters: deviceHealthParams,
  handler: async ({ machineCode, metricKey, days }) => {
    const empty: DeviceHealthData = {
      machineCode, machineType: null, deviceClass: null, lastActivity: null,
      process: { pass: 0, fail: 0, warn: 0, skip: 0, total: 0, failRate: 0, fpy: null },
      configDrift: null, spc: null,
    };
    const db = await getDb();
    if (!db) return noDb<DeviceHealthData>("device_health", "Sức khỏe thiết bị", empty);

    const [m] = await db
      .select({ id: machines.id, machineType: machines.machineType })
      .from(machines)
      .where(eq(machines.code, machineCode))
      .limit(1);
    if (!m) {
      return { type: "device_health", title: `Thiết bị ${machineCode}`, data: empty, textSummary: `Không tìm thấy thiết bị "${machineCode}".`, note: "NOT_FOUND" };
    }
    const machineType = m.machineType == null ? null : String(m.machineType);
    const deviceClass = machineType ? deviceClassOf(machineType) : null;
    const since = sinceDays(days);

    // process stats + FPY
    const stats = await aggregateProcessResultStats({ machineId: m.id, since });
    const total = stats.pass + stats.fail + stats.warn + stats.skip;
    const fpyDen = stats.pass + stats.fail + stats.warn;
    const fpy = fpyDen > 0 ? Math.round((stats.pass / fpyDen) * 1000) / 10 : null;

    // last activity + primary metric inference
    const recent = await listProcessResultsByMachine({ machineId: m.id, since, limit: 1 });
    const lastActivity = recent[0]?.measuredAt ? new Date(recent[0].measuredAt as unknown as string).toISOString() : null;
    const key = metricKey ?? firstNumericMetric(recent[0]?.metrics as Record<string, unknown> | null);

    // config drift — report the worst of the recipe / device_settings shadows
    let configDrift: DeviceHealthData["configDrift"] = null;
    for (const kind of ["recipe", "device_settings"] as const) {
      const shadow = await readConfigState(m.id, kind);
      if (shadow && shadow.driftState && shadow.driftState !== "unknown") {
        if (shadow.driftState === "drift") { configDrift = { configKind: kind, state: "drift" }; break; }
        if (!configDrift) configDrift = { configKind: kind, state: shadow.driftState };
      }
    }

    // SPC I-MR for the primary metric
    let spc: DeviceHealthData["spc"] = null;
    if (key) {
      const points = await getProcessMetricPoints({ machineId: m.id, metricKey: key, since, limit: 2000 });
      const chart = buildProcessControlChart(key, points);
      spc = {
        metricKey: key, ok: chart.ok,
        ucl: chart.limits?.UCL ?? null, cl: chart.limits?.CL ?? null, lcl: chart.limits?.LCL ?? null,
        cpk: chart.capability?.cpk ?? null, outOfControl: chart.outOfControlCount, n: chart.n,
      };
    }

    const parts: string[] = [];
    parts.push(`Thiết bị ${machineCode}${machineType ? ` (${machineType}${deviceClass ? `/${deviceClass}` : ""})` : ""} — ${days} ngày:`);
    parts.push(`• Kết quả: ${total} bản ghi, đạt ${stats.pass} · lỗi ${stats.fail} (fail ${pct(stats.fail, total)}%)${fpy != null ? `, FPY ${fpy}%` : ""}.`);
    if (configDrift) parts.push(`• Cấu hình: ${configDrift.state === "drift" ? `⚠ LỆCH (${configDrift.configKind})` : `đồng bộ (${configDrift.configKind})`}.`);
    else parts.push("• Cấu hình: chưa có shadow desired/reported (chưa deploy hoặc chưa ack).");
    if (spc?.ok) parts.push(`• SPC ${spc.metricKey}: CL ${spc.cl?.toFixed(3)} [${spc.lcl?.toFixed(3)}–${spc.ucl?.toFixed(3)}], ngoài kiểm soát ${spc.outOfControl}/${spc.n}${spc.cpk != null ? `, Cpk ${spc.cpk.toFixed(2)}` : ""}.`);
    else if (key) parts.push(`• SPC ${key}: chưa đủ mẫu (cần ≥2).`);

    return {
      type: "device_health",
      title: `Sức khỏe thiết bị ${machineCode}`,
      data: { machineCode, machineType, deviceClass, lastActivity, process: { ...stats, total, failRate: pct(stats.fail, total), fpy }, configDrift, spc },
      textSummary: parts.join("\n"),
    };
  },
};

// ── 2. get_fleet_process_summary ──────────────────────────────────────────────

interface FleetGroup { machineType: string | null; deviceClass: string | null; total: number; pass: number; fail: number; fpy: number | null }
interface FleetSummaryData {
  days: number;
  deviceClass: string | null;
  groups: FleetGroup[];
  totals: { total: number; pass: number; fail: number; fpy: number | null };
}

const fleetSummaryParams = z
  .object({
    days: z.number().int().min(1).max(90).optional().default(7),
    deviceClass: z.enum(["aoi_avi", "automation", "iot"]).optional(),
  })
  .strict();

const getFleetProcessSummary: Tool<z.infer<typeof fleetSummaryParams>, FleetSummaryData> = {
  name: "get_fleet_process_summary",
  description:
    "Tổng hợp pass-rate & first-pass-yield theo loại máy / nhóm thiết bị (aoi_avi/automation/iot) trong N ngày. Hỗ trợ quản lý theo dõi cả phân xưởng.",
  triggers: [
    "tổng hợp thiết bị", "fleet", "toàn phân xưởng", "cả nhà máy", "theo loại máy",
    "first pass yield", "fpy", "pass rate phân xưởng", "nhóm thiết bị", "phân xưởng thế nào",
    "automation hôm nay", "tổng quan sản xuất",
  ],
  parameters: fleetSummaryParams,
  handler: async ({ days, deviceClass }) => {
    const empty: FleetSummaryData = { days, deviceClass: deviceClass ?? null, groups: [], totals: { total: 0, pass: 0, fail: 0, fpy: null } };
    const db = await getDb();
    if (!db) return noDb<FleetSummaryData>("fleet_process_summary", "Tổng hợp phân xưởng", empty);

    const rows = await aggregateProcessResultStatsByType({ since: sinceDays(days) });
    const groups: FleetGroup[] = rows
      .map((r) => {
        const dc = r.machineType ? deviceClassOf(r.machineType) : null;
        const den = r.pass + r.fail + r.warn;
        return { machineType: r.machineType, deviceClass: dc, total: r.total, pass: r.pass, fail: r.fail, fpy: den > 0 ? Math.round((r.pass / den) * 1000) / 10 : null };
      })
      .filter((g) => !deviceClass || g.deviceClass === deviceClass);

    const tot = groups.reduce((a, g) => ({ total: a.total + g.total, pass: a.pass + g.pass, fail: a.fail + g.fail }), { total: 0, pass: 0, fail: 0 });
    const totDen = groups.reduce((a, g) => a + g.pass + g.fail, 0);
    const totFpy = totDen > 0 ? Math.round((tot.pass / totDen) * 1000) / 10 : null;

    const lines = groups.map((g) => `  – ${g.machineType ?? "—"}${g.deviceClass ? ` (${g.deviceClass})` : ""}: ${g.total} bản ghi, đạt ${g.pass}/lỗi ${g.fail}${g.fpy != null ? `, FPY ${g.fpy}%` : ""}`);
    const textSummary = [
      `Tổng hợp ${deviceClass ? `nhóm ${deviceClass}` : "toàn bộ"} — ${days} ngày: ${tot.total} bản ghi, đạt ${tot.pass}/lỗi ${tot.fail}${totFpy != null ? `, FPY chung ${totFpy}%` : ""}.`,
      ...(lines.length ? lines : ["  (chưa có kết quả process trong kỳ)"]),
    ].join("\n");

    return { type: "fleet_process_summary", title: "Tổng hợp theo loại máy", data: { days, deviceClass: deviceClass ?? null, groups, totals: { ...tot, fpy: totFpy } }, textSummary };
  },
};

registerTool(getDeviceHealth);
registerTool(getFleetProcessSummary);

export { getDeviceHealth, getFleetProcessSummary };
