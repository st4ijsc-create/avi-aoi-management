/**
 * AI Local Tools — Handlers
 *
 * 5 read-only tools that query Postgres via Drizzle and return ToolResult.
 *
 *  - get_today_stats     → today's OK / NG / NTF counts + NG rate
 *  - get_lot_status      → production order progress by orderCode
 *  - get_machine_status  → machines list (online/offline/heartbeat)
 *  - get_defect_trend    → 7-day NG-rate trend
 *  - get_top_defects     → top measurement points with most NG (last N days)
 */

import { z } from "zod";
import { and, desc, eq, gte, lt, sql, ilike, asc } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  productionOrders,
  machines,
  dailyStatistics,
  factories,
  oeeMetrics,
  productModels,
} from "../../../drizzle/schema";
import { registerTool, type Tool, type ToolResult } from "./toolRegistry";

// -------- helpers --------

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function fmtDateISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function pct(num: number, total: number): number {
  if (!total) return 0;
  return Math.round((num / total) * 10000) / 100;
}

function noDbResult<T>(type: ToolResult["type"], title: string, fallback: T): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: "Không có kết nối CSDL — không thể truy vấn dữ liệu thời gian thực.",
    note: "DB_UNAVAILABLE",
  };
}

// -------- 1. get_today_stats --------

interface TodayStatsData {
  date: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  ngRate: number; // %
  byMachine: Array<{ machineId: number; machineName: string; total: number; ng: number; ngRate: number }>;
}

const todayStatsParams = z.object({}).strict();

const getTodayStats: Tool<z.infer<typeof todayStatsParams>, TodayStatsData> = {
  name: "get_today_stats",
  description: "Số liệu kiểm tra trong ngày hôm nay: tổng, OK, NG, NTF, tỉ lệ NG, top máy NG.",
  parameters: todayStatsParams,
  triggers: [
    "hôm nay", "ngày hôm nay", "today", "ca này", "đến giờ", "hiện tại bao nhiêu",
    "đã kiểm tra", "tỉ lệ ng", "tỷ lệ ng", "ng rate", "sản lượng",
  ],
  handler: async () => {
    const db = await getDb();
    if (!db) {
      return noDbResult<TodayStatsData>("today_stats", "Sản lượng hôm nay", {
        date: fmtDateISO(new Date()),
        total: 0, ok: 0, ng: 0, ntf: 0, ngRate: 0, byMachine: [],
      });
    }

    const since = startOfTodayLocal();

    const totalsRow = await db
      .select({
        total: sql<number>`count(*)::int`,
        ok: sql<number>`count(*) filter (where ${productInspections.overallResult} = 'OK')::int`,
        ng: sql<number>`count(*) filter (where ${productInspections.overallResult} = 'NG')::int`,
        ntf: sql<number>`count(*) filter (where ${productInspections.overallResult} = 'NTF')::int`,
      })
      .from(productInspections)
      .where(gte(productInspections.inspectionTime, since));

    const t = totalsRow[0] ?? { total: 0, ok: 0, ng: 0, ntf: 0 };

    const byMachineRows = await db
      .select({
        machineId: productInspections.machineId,
        machineName: machines.name,
        total: sql<number>`count(*)::int`,
        ng: sql<number>`count(*) filter (where ${productInspections.overallResult} = 'NG')::int`,
      })
      .from(productInspections)
      .leftJoin(machines, eq(machines.id, productInspections.machineId))
      .where(gte(productInspections.inspectionTime, since))
      .groupBy(productInspections.machineId, machines.name)
      .orderBy(desc(sql`count(*) filter (where ${productInspections.overallResult} = 'NG')`))
      .limit(5);

    const byMachine = byMachineRows.map((r) => ({
      machineId: r.machineId,
      machineName: r.machineName ?? `#${r.machineId}`,
      total: Number(r.total ?? 0),
      ng: Number(r.ng ?? 0),
      ngRate: pct(Number(r.ng ?? 0), Number(r.total ?? 0)),
    }));

    const data: TodayStatsData = {
      date: fmtDateISO(since),
      total: Number(t.total ?? 0),
      ok: Number(t.ok ?? 0),
      ng: Number(t.ng ?? 0),
      ntf: Number(t.ntf ?? 0),
      ngRate: pct(Number(t.ng ?? 0), Number(t.total ?? 0)),
      byMachine,
    };

    const machineLine = byMachine.length
      ? "\nTop máy NG: " + byMachine.map((m) => `${m.machineName} (${m.ng}/${m.total}, ${m.ngRate}%)`).join("; ")
      : "";

    return {
      type: "today_stats",
      title: `Sản lượng hôm nay (${data.date})`,
      data,
      textSummary:
        `Hôm nay đã kiểm tra ${data.total} sản phẩm: OK=${data.ok}, NG=${data.ng}, NTF=${data.ntf}. ` +
        `Tỉ lệ NG = ${data.ngRate}%.${machineLine}`,
    };
  },
};

// -------- 2. get_lot_status --------

interface LotStatusData {
  orderCode: string;
  status: string;
  targetQuantity: number;
  completedQuantity: number;
  okQuantity: number;
  ngQuantity: number;
  ntfQuantity: number;
  progressPct: number;
  ngRate: number;
}

const lotStatusParams = z.object({
  orderCode: z.string().min(1).max(100),
}).strict();

const getLotStatus: Tool<z.infer<typeof lotStatusParams>, LotStatusData | null> = {
  name: "get_lot_status",
  description: "Trạng thái lệnh sản xuất theo mã (orderCode): tiến độ, OK/NG/NTF, % hoàn thành.",
  parameters: lotStatusParams,
  triggers: [
    "lệnh sản xuất", "lot", "po ", "po#", "production order", "orderCode", "mã lệnh",
    "tiến độ", "tiến trình", "đơn hàng",
    "lô ", "trạng thái lô", "trạng thái lệnh", "tình trạng lô", "lot status",
  ],
  handler: async ({ orderCode }) => {
    const db = await getDb();
    if (!db) {
      return noDbResult<LotStatusData | null>("lot_status", `Lệnh ${orderCode}`, null);
    }

    const rows = await db
      .select()
      .from(productionOrders)
      .where(eq(productionOrders.orderCode, orderCode))
      .limit(1);

    if (rows.length === 0) {
      // Fuzzy ILIKE prefix suggestions (top 3) for typo / partial matches.
      let suggestions: string[] = [];
      try {
        const head = orderCode.replace(/[%_]/g, "").slice(0, 6);
        if (head.length >= 2) {
          const sug = await db
            .select({ orderCode: productionOrders.orderCode })
            .from(productionOrders)
            .where(ilike(productionOrders.orderCode, `${head}%`))
            .orderBy(desc(productionOrders.createdAt))
            .limit(3);
          suggestions = sug.map((s) => s.orderCode);
        }
      } catch {
        suggestions = [];
      }
      const sugLine = suggestions.length
        ? ` Có thể bạn muốn: ${suggestions.map((s) => `"${s}"`).join(", ")}.`
        : "";
      return {
        type: "lot_status",
        title: `Lệnh ${orderCode}`,
        data: null,
        textSummary: `Không tìm thấy lệnh sản xuất "${orderCode}".${sugLine}`,
        note: suggestions.length ? "NOT_FOUND_WITH_SUGGESTIONS" : "NOT_FOUND",
      };
    }

    const r = rows[0]!;
    const data: LotStatusData = {
      orderCode: r.orderCode,
      status: String(r.status ?? "pending"),
      targetQuantity: Number(r.targetQuantity ?? 0),
      completedQuantity: Number(r.completedQuantity ?? 0),
      okQuantity: Number(r.okQuantity ?? 0),
      ngQuantity: Number(r.ngQuantity ?? 0),
      ntfQuantity: Number(r.ntfQuantity ?? 0),
      progressPct: pct(Number(r.completedQuantity ?? 0), Number(r.targetQuantity ?? 0)),
      ngRate: pct(Number(r.ngQuantity ?? 0), Number(r.completedQuantity ?? 0)),
    };

    return {
      type: "lot_status",
      title: `Lệnh ${data.orderCode}`,
      data,
      textSummary:
        `Lệnh ${data.orderCode} (${data.status}): ${data.completedQuantity}/${data.targetQuantity} ` +
        `(${data.progressPct}%). OK=${data.okQuantity}, NG=${data.ngQuantity}, NTF=${data.ntfQuantity}, ` +
        `tỉ lệ NG=${data.ngRate}%.`,
    };
  },
};

// -------- 3. get_machine_status --------

interface MachineStatusItem {
  id: number;
  code: string;
  name: string;
  type: string;
  operationStatus: string;
  isOnline: boolean;
  lastHeartbeat: string | null;
  minutesSinceHeartbeat: number | null;
}

const machineStatusParams = z.object({
  onlyOffline: z.boolean().optional().default(false),
}).strict();

const getMachineStatus: Tool<z.infer<typeof machineStatusParams>, MachineStatusItem[]> = {
  name: "get_machine_status",
  description: "Trạng thái các máy AOI/AVI: chạy, dừng, lỗi, bảo trì + heartbeat.",
  parameters: machineStatusParams,
  triggers: [
    "máy nào", "trạng thái máy", "máy đang", "máy chạy", "máy dừng", "máy lỗi",
    "machine status", "online", "offline", "heartbeat", "máy bảo trì",
  ],
  handler: async ({ onlyOffline }) => {
    const db = await getDb();
    if (!db) {
      return noDbResult<MachineStatusItem[]>("machine_status", "Trạng thái máy", []);
    }

    const rows = await db
      .select({
        id: machines.id,
        code: machines.code,
        name: machines.name,
        type: machines.machineType,
        operationStatus: machines.operationStatus,
        lastHeartbeat: machines.lastHeartbeat,
        isActive: machines.isActive,
      })
      .from(machines)
      .where(eq(machines.isActive, true))
      .orderBy(machines.code);

    const now = Date.now();
    const items: MachineStatusItem[] = rows.map((r) => {
      const hbMs = r.lastHeartbeat ? new Date(r.lastHeartbeat).getTime() : null;
      const mins = hbMs == null ? null : Math.floor((now - hbMs) / 60000);
      const isOnline = mins != null && mins <= 5;
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        type: String(r.type),
        operationStatus: String(r.operationStatus),
        isOnline,
        lastHeartbeat: r.lastHeartbeat ? new Date(r.lastHeartbeat).toISOString() : null,
        minutesSinceHeartbeat: mins,
      };
    });

    const filtered = onlyOffline ? items.filter((m) => !m.isOnline) : items;

    const onlineCount = items.filter((m) => m.isOnline).length;
    const errCount = items.filter((m) => m.operationStatus === "error").length;
    const offlineList = items.filter((m) => !m.isOnline).slice(0, 5).map((m) => m.code).join(", ");

    return {
      type: "machine_status",
      title: onlyOffline ? "Máy đang offline" : "Trạng thái máy",
      data: filtered,
      textSummary:
        `Tổng ${items.length} máy: ${onlineCount} online, ${items.length - onlineCount} offline, ${errCount} lỗi.` +
        (offlineList ? ` Offline: ${offlineList}.` : ""),
    };
  },
};

// -------- 4. get_defect_trend --------

interface DefectTrendData {
  days: number;
  series: Array<{ date: string; total: number; ng: number; ngRate: number }>;
}

const defectTrendParams = z.object({
  days: z.number().int().min(2).max(30).optional().default(7),
}).strict();

const getDefectTrend: Tool<z.infer<typeof defectTrendParams>, DefectTrendData> = {
  name: "get_defect_trend",
  description: "Xu hướng tỉ lệ NG trong N ngày gần đây (mặc định 7 ngày).",
  parameters: defectTrendParams,
  triggers: [
    "xu hướng", "trend", "tuần qua", "7 ngày", "ngày qua", "biểu đồ ng",
    "tỷ lệ ng theo ngày", "tỉ lệ ng theo ngày",
  ],
  handler: async ({ days }) => {
    const db = await getDb();
    if (!db) {
      return noDbResult<DefectTrendData>("defect_trend", `Xu hướng NG ${days} ngày`, { days, series: [] });
    }

    const start = startOfDay(new Date());
    start.setDate(start.getDate() - (days - 1));

    const rows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${productInspections.inspectionTime}), 'YYYY-MM-DD')`,
        total: sql<number>`count(*)::int`,
        ng: sql<number>`count(*) filter (where ${productInspections.overallResult} = 'NG')::int`,
      })
      .from(productInspections)
      .where(gte(productInspections.inspectionTime, start))
      .groupBy(sql`date_trunc('day', ${productInspections.inspectionTime})`)
      .orderBy(sql`date_trunc('day', ${productInspections.inspectionTime})`);

    const map = new Map<string, { total: number; ng: number }>();
    for (const r of rows) {
      map.set(r.day, { total: Number(r.total ?? 0), ng: Number(r.ng ?? 0) });
    }

    const series: DefectTrendData["series"] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = fmtDateISO(d);
      const v = map.get(key) ?? { total: 0, ng: 0 };
      series.push({ date: key, total: v.total, ng: v.ng, ngRate: pct(v.ng, v.total) });
    }

    const avgRate = series.length
      ? Math.round((series.reduce((s, x) => s + x.ngRate, 0) / series.length) * 100) / 100
      : 0;
    const worst = series.reduce<DefectTrendData["series"][number] | null>(
      (acc, x) => (acc == null || x.ngRate > acc.ngRate ? x : acc),
      null,
    );

    return {
      type: "defect_trend",
      title: `Xu hướng NG ${days} ngày`,
      data: { days, series },
      textSummary:
        `Xu hướng ${days} ngày: tỉ lệ NG TB = ${avgRate}%.` +
        (worst ? ` Cao nhất ngày ${worst.date} (${worst.ngRate}%).` : ""),
    };
  },
};

// -------- 5. get_top_defects --------

interface TopDefectItem {
  pointCode: string;
  pointName: string;
  ngCount: number;
  totalCount: number;
  ngRate: number;
}

const topDefectsParams = z.object({
  days: z.number().int().min(1).max(30).optional().default(7),
  limit: z.number().int().min(1).max(20).optional().default(5),
}).strict();

const getTopDefects: Tool<z.infer<typeof topDefectsParams>, TopDefectItem[]> = {
  name: "get_top_defects",
  description: "Top điểm đo có nhiều NG nhất trong N ngày gần đây.",
  parameters: topDefectsParams,
  triggers: [
    "lỗi nhiều nhất", "top lỗi", "điểm đo lỗi", "ng nhiều nhất", "defect nhiều",
    "top defect", "lỗi phổ biến",
  ],
  handler: async ({ days, limit }) => {
    const db = await getDb();
    if (!db) {
      return noDbResult<TopDefectItem[]>("top_defects", "Top lỗi", []);
    }

    const start = startOfDay(new Date());
    start.setDate(start.getDate() - (days - 1));

    const rows = await db
      .select({
        pointCode: measurementPointDefs.code,
        pointName: measurementPointDefs.name,
        ngCount: sql<number>`count(*) filter (where ${measurementResults.result} = 'NG')::int`,
        totalCount: sql<number>`count(*)::int`,
      })
      .from(measurementResults)
      .innerJoin(productInspections, eq(productInspections.id, measurementResults.inspectionId))
      .innerJoin(measurementPointDefs, eq(measurementPointDefs.id, measurementResults.pointDefId))
      .where(gte(productInspections.inspectionTime, start))
      .groupBy(measurementPointDefs.code, measurementPointDefs.name)
      .having(sql`count(*) filter (where ${measurementResults.result} = 'NG') > 0`)
      .orderBy(desc(sql`count(*) filter (where ${measurementResults.result} = 'NG')`))
      .limit(limit);

    const data: TopDefectItem[] = rows.map((r) => {
      const ng = Number(r.ngCount ?? 0);
      const total = Number(r.totalCount ?? 0);
      return {
        pointCode: r.pointCode,
        pointName: r.pointName,
        ngCount: ng,
        totalCount: total,
        ngRate: pct(ng, total),
      };
    });

    const summary = data.length
      ? data.map((d, i) => `${i + 1}. ${d.pointCode} (${d.pointName}) — NG ${d.ngCount}/${d.totalCount} (${d.ngRate}%)`).join("; ")
      : "Không có điểm đo nào lỗi trong khoảng thời gian này.";

    return {
      type: "top_defects",
      title: `Top ${data.length} lỗi (${days} ngày)`,
      data,
      textSummary: `Top điểm đo NG nhiều nhất ${days} ngày qua: ${summary}`,
    };
  },
};

// -------- 6. get_factory_stats --------

interface FactoryStatsItem {
  factoryId: number;
  factoryCode: string;
  factoryName: string;
  total: number;
  ok: number;
  ng: number;
  ngRate: number;
}

const factoryStatsParams = z.object({
  days: z.number().int().min(1).max(30).optional().default(1),
}).strict();

const getFactoryStats: Tool<z.infer<typeof factoryStatsParams>, FactoryStatsItem[]> = {
  name: "get_factory_stats",
  description: "Tổng hợp sản lượng / NG theo từng nhà máy (factory) trong N ngày gần đây.",
  parameters: factoryStatsParams,
  triggers: [
    "nhà máy", "factory", "các nhà máy", "theo nhà máy", "tổng hợp factory",
    "so sánh nhà máy", "so sánh factory", "ranking nhà máy",
  ],
  handler: async ({ days }) => {
    const db = await getDb();
    if (!db) return noDbResult<FactoryStatsItem[]>("factory_stats", "Sản lượng theo nhà máy", []);

    const start = startOfDay(new Date());
    start.setDate(start.getDate() - (days - 1));

    const rows = await db
      .select({
        factoryId: dailyStatistics.factoryId,
        factoryCode: factories.code,
        factoryName: factories.name,
        total: sql<number>`coalesce(sum(${dailyStatistics.totalCount}),0)::int`,
        ok: sql<number>`coalesce(sum(${dailyStatistics.okCount}),0)::int`,
        ng: sql<number>`coalesce(sum(${dailyStatistics.ngCount}),0)::int`,
      })
      .from(dailyStatistics)
      .leftJoin(factories, eq(factories.id, dailyStatistics.factoryId))
      .where(gte(dailyStatistics.date, start))
      .groupBy(dailyStatistics.factoryId, factories.code, factories.name)
      .orderBy(desc(sql`coalesce(sum(${dailyStatistics.totalCount}),0)`));

    const data: FactoryStatsItem[] = rows.map((r) => {
      const total = Number(r.total ?? 0);
      const ng = Number(r.ng ?? 0);
      return {
        factoryId: r.factoryId,
        factoryCode: r.factoryCode ?? `#${r.factoryId}`,
        factoryName: r.factoryName ?? `#${r.factoryId}`,
        total,
        ok: Number(r.ok ?? 0),
        ng,
        ngRate: pct(ng, total),
      };
    });

    const summary = data.length
      ? data.map((d) => `${d.factoryCode} (${d.factoryName}): ${d.total} sp, NG ${d.ng} (${d.ngRate}%)`).join("; ")
      : "Không có dữ liệu sản lượng trong khoảng thời gian này.";

    return {
      type: "factory_stats",
      title: `Sản lượng theo nhà máy (${days} ngày)`,
      data,
      textSummary: `Tổng hợp ${data.length} nhà máy trong ${days} ngày: ${summary}`,
    };
  },
};

// -------- 7. get_ng_compare --------

interface NgComparePeriod {
  label: string;
  start: string;
  end: string;
  total: number;
  ng: number;
  ngRate: number;
}

interface NgCompareData {
  period: "week" | "month";
  current: NgComparePeriod;
  previous: NgComparePeriod;
  deltaPct: number; // percentage point delta (current - previous)
  deltaRel: number; // relative % change
}

const ngCompareParams = z.object({
  period: z.enum(["week", "month"]).optional().default("month"),
}).strict();

async function _sumNgRange(db: any, start: Date, end: Date): Promise<{ total: number; ng: number }> {
  const r = await db
    .select({
      total: sql<number>`coalesce(sum(${dailyStatistics.totalCount}),0)::int`,
      ng: sql<number>`coalesce(sum(${dailyStatistics.ngCount}),0)::int`,
    })
    .from(dailyStatistics)
    .where(and(gte(dailyStatistics.date, start), lt(dailyStatistics.date, end)));
  const row = r[0] ?? { total: 0, ng: 0 };
  return { total: Number(row.total ?? 0), ng: Number(row.ng ?? 0) };
}

const getNgCompare: Tool<z.infer<typeof ngCompareParams>, NgCompareData> = {
  name: "get_ng_compare",
  description: "So sánh tỉ lệ NG kỳ này với kỳ trước (theo tuần hoặc tháng).",
  parameters: ngCompareParams,
  triggers: [
    "so với tháng trước", "so với tuần trước", "tháng này", "tháng trước",
    "tuần này", "tuần trước", "kỳ trước", "month over month", "mom", "wow",
    "so sánh kỳ", "tăng giảm so",
  ],
  handler: async ({ period }) => {
    const db = await getDb();
    const now = new Date();
    let curStart: Date, curEnd: Date, prevStart: Date, prevEnd: Date;
    if (period === "week") {
      const day = now.getDay() || 7; // 1..7 (Mon..Sun)
      curStart = startOfDay(now);
      curStart.setDate(curStart.getDate() - (day - 1));
      curEnd = new Date(curStart);
      curEnd.setDate(curEnd.getDate() + 7);
      prevStart = new Date(curStart);
      prevStart.setDate(prevStart.getDate() - 7);
      prevEnd = new Date(curStart);
    } else {
      curStart = new Date(now.getFullYear(), now.getMonth(), 1);
      curEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    if (!db) {
      return noDbResult<NgCompareData>("ng_compare", `So sánh NG (${period})`, {
        period,
        current: { label: "kỳ này", start: fmtDateISO(curStart), end: fmtDateISO(curEnd), total: 0, ng: 0, ngRate: 0 },
        previous: { label: "kỳ trước", start: fmtDateISO(prevStart), end: fmtDateISO(prevEnd), total: 0, ng: 0, ngRate: 0 },
        deltaPct: 0,
        deltaRel: 0,
      });
    }

    const [cur, prev] = await Promise.all([
      _sumNgRange(db, curStart, curEnd),
      _sumNgRange(db, prevStart, prevEnd),
    ]);

    const curRate = pct(cur.ng, cur.total);
    const prevRate = pct(prev.ng, prev.total);
    const deltaPct = Math.round((curRate - prevRate) * 100) / 100;
    const deltaRel = prevRate > 0 ? Math.round(((curRate - prevRate) / prevRate) * 10000) / 100 : 0;

    const data: NgCompareData = {
      period,
      current: { label: period === "month" ? "tháng này" : "tuần này", start: fmtDateISO(curStart), end: fmtDateISO(curEnd), total: cur.total, ng: cur.ng, ngRate: curRate },
      previous: { label: period === "month" ? "tháng trước" : "tuần trước", start: fmtDateISO(prevStart), end: fmtDateISO(prevEnd), total: prev.total, ng: prev.ng, ngRate: prevRate },
      deltaPct,
      deltaRel,
    };

    const dir = deltaPct > 0 ? "tăng" : deltaPct < 0 ? "giảm" : "không đổi";
    return {
      type: "ng_compare",
      title: period === "month" ? "So sánh NG tháng này / tháng trước" : "So sánh NG tuần này / tuần trước",
      data,
      textSummary:
        `${data.current.label}: NG ${cur.ng}/${cur.total} (${curRate}%). ` +
        `${data.previous.label}: NG ${prev.ng}/${prev.total} (${prevRate}%). ` +
        `Tỉ lệ NG ${dir} ${Math.abs(deltaPct)} điểm % (${deltaRel >= 0 ? "+" : ""}${deltaRel}% tương đối).`,
    };
  },
};

// -------- 8. get_oee --------

interface OeeItem {
  machineId: number;
  machineCode: string;
  timestamp: string;
  availability: number; // %
  performance: number; // %
  quality: number; // %
  oee: number; // %
}

const oeeParams = z.object({
  machineCode: z.string().min(1).max(50).optional(),
  days: z.number().int().min(1).max(30).optional().default(7),
}).strict();

const getOee: Tool<z.infer<typeof oeeParams>, OeeItem[]> = {
  name: "get_oee",
  description: "Chỉ số OEE (Availability × Performance × Quality) gần đây của 1 máy hoặc toàn bộ.",
  parameters: oeeParams,
  triggers: [
    "oee", "hiệu suất tổng thể", "availability", "performance", "quality",
    "chỉ số oee", "overall equipment", "hiệu quả thiết bị",
  ],
  handler: async ({ machineCode, days }) => {
    const db = await getDb();
    if (!db) return noDbResult<OeeItem[]>("oee", "OEE", []);

    const start = startOfDay(new Date());
    start.setDate(start.getDate() - (days - 1));

    const where = machineCode
      ? and(gte(oeeMetrics.timestamp, start), eq(oeeMetrics.machineCode, machineCode))
      : gte(oeeMetrics.timestamp, start);

    const rows = await db
      .select({
        machineId: oeeMetrics.machineId,
        machineCode: oeeMetrics.machineCode,
        timestamp: oeeMetrics.timestamp,
        availability: oeeMetrics.availability,
        performance: oeeMetrics.performance,
        quality: oeeMetrics.quality,
        oee: oeeMetrics.oee,
      })
      .from(oeeMetrics)
      .where(where)
      .orderBy(desc(oeeMetrics.timestamp))
      .limit(machineCode ? 24 : 50);

    const data: OeeItem[] = rows.map((r) => ({
      machineId: r.machineId,
      machineCode: r.machineCode,
      timestamp: new Date(r.timestamp).toISOString(),
      availability: Math.round(Number(r.availability) / 100 * 100) / 100,
      performance: Math.round(Number(r.performance) / 100 * 100) / 100,
      quality: Math.round(Number(r.quality) / 100 * 100) / 100,
      oee: Math.round(Number(r.oee) / 100 * 100) / 100,
    }));

    if (data.length === 0) {
      return {
        type: "oee",
        title: machineCode ? `OEE máy ${machineCode}` : `OEE ${days} ngày`,
        data: [],
        textSummary: machineCode
          ? `Chưa có dữ liệu OEE cho máy "${machineCode}" trong ${days} ngày qua.`
          : `Chưa có dữ liệu OEE trong ${days} ngày qua.`,
        note: "NOT_FOUND",
      };
    }

    const avgOee = Math.round((data.reduce((s, x) => s + x.oee, 0) / data.length) * 100) / 100;
    const latest = data[0]!;
    return {
      type: "oee",
      title: machineCode ? `OEE máy ${machineCode}` : `OEE ${days} ngày`,
      data,
      textSummary:
        `OEE ${machineCode ? `máy ${machineCode}` : "tổng hợp"} ${days} ngày: TB ${avgOee}%. ` +
        `Mới nhất ${latest.machineCode} @ ${latest.timestamp.slice(0, 16)}: ` +
        `A=${latest.availability}%, P=${latest.performance}%, Q=${latest.quality}%, OEE=${latest.oee}%.`,
    };
  },
};

// -------- 9. get_model_metrics --------

interface ModelMetricItem {
  productModelId: number;
  productCode: string;
  productName: string;
  total: number;
  ng: number;
  ngRate: number;
}

const modelMetricsParams = z.object({
  days: z.number().int().min(1).max(30).optional().default(7),
  limit: z.number().int().min(1).max(20).optional().default(5),
}).strict();

const getModelMetrics: Tool<z.infer<typeof modelMetricsParams>, ModelMetricItem[]> = {
  name: "get_model_metrics",
  description: "Top mẫu sản phẩm có tỉ lệ NG cao nhất trong N ngày gần đây.",
  parameters: modelMetricsParams,
  triggers: [
    "mẫu sản phẩm", "product model", "model nào", "sản phẩm nào", "theo sản phẩm",
    "ranking sản phẩm", "ranking model", "ng theo model", "ng theo sản phẩm",
  ],
  handler: async ({ days, limit }) => {
    const db = await getDb();
    if (!db) return noDbResult<ModelMetricItem[]>("model_metrics", "Top model NG", []);

    const start = startOfDay(new Date());
    start.setDate(start.getDate() - (days - 1));

    const rows = await db
      .select({
        productModelId: productInspections.productModelId,
        productCode: productModels.code,
        productName: productModels.name,
        total: sql<number>`count(*)::int`,
        ng: sql<number>`count(*) filter (where ${productInspections.overallResult} = 'NG')::int`,
      })
      .from(productInspections)
      .leftJoin(productModels, eq(productModels.id, productInspections.productModelId))
      .where(gte(productInspections.inspectionTime, start))
      .groupBy(productInspections.productModelId, productModels.code, productModels.name)
      .having(sql`count(*) filter (where ${productInspections.overallResult} = 'NG') > 0`)
      .orderBy(desc(sql`count(*) filter (where ${productInspections.overallResult} = 'NG')::float / nullif(count(*),0)`))
      .limit(limit);

    const data: ModelMetricItem[] = rows.map((r) => {
      const total = Number(r.total ?? 0);
      const ng = Number(r.ng ?? 0);
      return {
        productModelId: Number(r.productModelId ?? 0),
        productCode: r.productCode ?? `#${r.productModelId}`,
        productName: r.productName ?? "(unknown)",
        total,
        ng,
        ngRate: pct(ng, total),
      };
    });

    const summary = data.length
      ? data.map((d, i) => `${i + 1}. ${d.productCode} (${d.productName}) — NG ${d.ng}/${d.total} (${d.ngRate}%)`).join("; ")
      : "Không có model nào có NG trong khoảng thời gian này.";

    return {
      type: "model_metrics",
      title: `Top ${data.length} model NG (${days} ngày)`,
      data,
      textSummary: `Top mẫu sản phẩm NG cao nhất ${days} ngày qua: ${summary}`,
    };
  },
};

// -------- register all --------

let _registered = false;
export function registerAllTools(): void {
  if (_registered) return;
  _registered = true;
  registerTool(getTodayStats);
  registerTool(getLotStatus);
  registerTool(getMachineStatus);
  registerTool(getDefectTrend);
  registerTool(getTopDefects);
  registerTool(getFactoryStats);
  registerTool(getNgCompare);
  registerTool(getOee);
  registerTool(getModelMetrics);
}

// Auto-register on import.
registerAllTools();

// Re-export for callers.
export {
  getTodayStats,
  getLotStatus,
  getMachineStatus,
  getDefectTrend,
  getTopDefects,
  getFactoryStats,
  getNgCompare,
  getOee,
  getModelMetrics,
};

// Suppress unused-var lint for `lt`, `asc` (kept for future filters).
void lt; void asc;
