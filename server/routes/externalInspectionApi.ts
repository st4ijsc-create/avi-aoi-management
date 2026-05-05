/**
 * External Inspection API — REST endpoints for third-party integration
 * 
 * All endpoints use /api/external/inspections/* prefix
 * Auth: x-master-key header OR Authorization: Bearer <token>
 * 
 * Endpoints:
 *   GET /api/external/inspections/summary          — Inspection summary by station/product/date range
 *   GET /api/external/inspections/trend             — Time-series OK/NG trend data (hour/day/week)
 *   GET /api/external/inspections/defect-pareto     — Defect Pareto analysis (NG by measurement point)
 *   GET /api/external/inspections/images            — Inspection images with filters (station/point/result)
 *   GET /api/external/inspections/events            — Package activity logs / inspection events
 *   GET /api/external/inspections/measurements      — Raw measurement values for a point over time
 *   GET /api/external/inspections/control-chart     — SPC control chart (UCL/LCL, Western Electric Rules, Cpk)
 *   GET /api/external/inspections/histogram         — Yield distribution histogram with statistics
 *   GET /api/external/inspections/stratification    — Breakdown by machine, shift, day of week
 *   GET /api/external/inspections/fail-history      — Recent NG inspections with failed measurement details
 *   GET /api/external/inspections/diagnostics       — AI diagnostics (alerts, patterns, recommendations)
 *   GET /api/external/inspections/scatter           — Scatter/correlation (output volume vs NG rate)
 *   GET /api/external/inspections/check-sheet       — Defect type × day matrix
 *   GET /api/external/inspections/cause-effect      — Cause-effect Ishikawa 6M analysis
 *   GET /api/external/inspections/ai-analysis       — AI analysis (anomaly detection, forecasting, clustering)
 *   GET /api/external/inspections/yield-comparison  — Period-over-period yield comparison
 *   GET /api/external/products                      — Product list (search, pagination)
 *   GET /api/external/products/:id                  — Product detail with measurement points
 */
import express from "express";
import { sql } from "drizzle-orm";

// Helper: parse integer query param
function parseIntParam(val: unknown): number | undefined {
  if (val == null || val === "") return undefined;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? undefined : n;
}

// Helper: parse date query param — returns a "fake UTC" Date for timestamp without time zone.
// drizzle-orm calls toISOString() (UTC) when serializing, but our columns store LOCAL time.
// Shift so UTC representation = local time to avoid timezone offset in queries.
function parseDateParam(val: unknown, endOfDay = false): Date | undefined {
  if (val == null || val === "") return undefined;
  let str = String(val);
  if (str.endsWith('Z')) str = str.slice(0, -1);
  // Date-only strings (e.g. "2026-04-03") are parsed as UTC midnight by JS spec.
  // Append time component so they are parsed as LOCAL time instead.
  if (!str.includes('T')) str += endOfDay ? 'T23:59:59.999' : 'T00:00:00';
  const d = new Date(str);
  if (isNaN(d.getTime())) return undefined;
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
}

// Helper: clamp limit
function clampLimit(val: unknown, defaultVal = 50, max = 500): number {
  const n = parseIntParam(val);
  if (n == null) return defaultVal;
  return Math.min(Math.max(n, 1), max);
}

export function registerExternalInspectionRoutes(
  app: express.Express,
  validateExternalAuth: express.RequestHandler,
) {
  // ================================================================
  // GET /api/external/inspections/summary
  // Tổng hợp kết quả kiểm tra theo station/product/khoảng thời gian
  // ================================================================
  app.get("/api/external/inspections/summary", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate are required (ISO 8601 format)",
        });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      // Resolve productModelId from productCode if needed
      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      const result = await db.execute(sql`
        SELECT
          pi."machineId",
          m.code AS "machineCode",
          m.name AS "machineName",
          s.id AS "stationId",
          s.code AS "stationCode",
          s.name AS "stationName",
          pm.id AS "productModelId",
          pm.code AS "productCode",
          pm.name AS "productName",
          COUNT(DISTINCT pi.id) AS "totalInspections",
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS "okCount",
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS "ngCount",
          SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END) AS "ntfCount",
          COALESCE(ROUND(
            SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(DISTINCT pi.id), 0), 2
          ), 0) AS "yieldRate",
          MIN(pi."inspectionTime") AS "firstInspection",
          MAX(pi."inspectionTime") AS "lastInspection",
          COALESCE(AVG(pi."cycleTime"), 0) AS "avgCycleTime"
        FROM product_inspections pi
        LEFT JOIN machines m ON pi."machineId" = m.id
        LEFT JOIN stations s ON m."stationId" = s.id
        LEFT JOIN product_models pm ON pi."productModelId" = pm.id
        WHERE pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${stationId ? sql`AND s.id = ${stationId}` : sql``}
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY pi."machineId", m.code, m.name, s.id, s.code, s.name, pm.id, pm.code, pm.name
        ORDER BY s.code, m.code, pm.code
      `);

      const rows = (result as any).rows || (result as any);
      const data = (rows as any[]).map((r: any) => ({
        machineId: Number(r.machineId),
        machineCode: r.machineCode || "",
        machineName: r.machineName || "",
        stationId: r.stationId ? Number(r.stationId) : null,
        stationCode: r.stationCode || "",
        stationName: r.stationName || "",
        productModelId: r.productModelId ? Number(r.productModelId) : null,
        productCode: r.productCode || "",
        productName: r.productName || "",
        totalInspections: Number(r.totalInspections),
        okCount: Number(r.okCount),
        ngCount: Number(r.ngCount),
        ntfCount: Number(r.ntfCount),
        yieldRate: Number(r.yieldRate),
        firstInspection: r.firstInspection,
        lastInspection: r.lastInspection,
        avgCycleTime: r.avgCycleTime ? Number(Number(r.avgCycleTime).toFixed(2)) : 0,
      }));

      // Calculate overall totals
      const totals = data.reduce(
        (acc, r) => ({
          totalInspections: acc.totalInspections + r.totalInspections,
          okCount: acc.okCount + r.okCount,
          ngCount: acc.ngCount + r.ngCount,
          ntfCount: acc.ntfCount + r.ntfCount,
        }),
        { totalInspections: 0, okCount: 0, ngCount: 0, ntfCount: 0 },
      );

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          totals: {
            ...totals,
            yieldRate: totals.totalInspections > 0
              ? Number(((totals.okCount / totals.totalInspections) * 100).toFixed(2))
              : 0,
          },
          details: data,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/summary error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get inspection summary" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/trend
  // Xu hướng OK/NG theo thời gian (group by hour/day/week)
  // ================================================================
  app.get("/api/external/inspections/trend", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const pointDefId = parseIntParam(req.query.pointDefId);
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);
      const groupBy = (req.query.groupBy as string) || "day"; // hour | day | week

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate are required (ISO 8601 format)",
        });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }
      if (!["hour", "day", "week"].includes(groupBy)) {
        return res.status(400).json({ success: false, message: "groupBy must be one of: hour, day, week" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      // Resolve productModelId from code
      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      // Build date truncation expression
      const dateTrunc =
        groupBy === "hour"
          ? sql`date_trunc('hour', pi."inspectionTime")`
          : groupBy === "week"
            ? sql`date_trunc('week', pi."inspectionTime")`
            : sql`date_trunc('day', pi."inspectionTime")`;

      // For measurement-level trend (per point)
      if (pointDefId) {
        // Get point definition info with product context
        const pointDefResult = await db.execute(sql`
          SELECT mpd.id, mpd.code, mpd.name, mpd."measurementType",
            mpd."productModelId", pm.code AS "productCode", pm.name AS "productName"
          FROM measurement_point_defs mpd
          LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
          WHERE mpd.id = ${pointDefId}
          LIMIT 1
        `);
        const pointDefRows = (pointDefResult as any).rows || (pointDefResult as any);
        const pointDefInfo = (pointDefRows as any[])[0] || null;

        const result = await db.execute(sql`
          SELECT
            ${dateTrunc} AS "period",
            COUNT(mr.id) AS "totalCount",
            SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END) AS "okCount",
            SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) AS "ngCount",
            SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END) AS "ntfCount",
            COALESCE(ROUND(
              SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0
              / NULLIF(COUNT(mr.id), 0), 2
            ), 0) AS "ngRate",
            COALESCE(AVG(mr."measuredValue"::numeric), 0) AS "avgValue",
            COALESCE(MIN(mr."measuredValue"::numeric), 0) AS "minValue",
            COALESCE(MAX(mr."measuredValue"::numeric), 0) AS "maxValue"
          FROM measurement_results mr
          INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
          WHERE pi."inspectionTime" >= ${startStr}::timestamp
            AND pi."inspectionTime" <= ${endStr}::timestamp
            AND mr."pointDefId" = ${pointDefId}
            ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
            ${stationId ? sql`AND pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})` : sql``}
          GROUP BY ${dateTrunc}
          ORDER BY "period" ASC
        `);

        const rows = (result as any).rows || (result as any);
        return res.json({
          success: true,
          data: {
            groupBy,
            dateRange: { startDate: startStr, endDate: endStr },
            pointDefId,
            pointCode: pointDefInfo?.code || "",
            pointName: pointDefInfo?.name || "",
            productModelId: pointDefInfo?.productModelId ? Number(pointDefInfo.productModelId) : null,
            productCode: pointDefInfo?.productCode || "",
            productName: pointDefInfo?.productName || "",
            trend: (rows as any[]).map((r: any) => ({
              period: r.period,
              totalCount: Number(r.totalCount),
              okCount: Number(r.okCount),
              ngCount: Number(r.ngCount),
              ntfCount: Number(r.ntfCount),
              ngRate: Number(r.ngRate),
              avgValue: r.avgValue != null ? Number(Number(r.avgValue).toFixed(6)) : null,
              minValue: r.minValue != null ? Number(Number(r.minValue).toFixed(6)) : null,
              maxValue: r.maxValue != null ? Number(Number(r.maxValue).toFixed(6)) : null,
            })),
          },
        });
      }

      // Inspection-level trend
      const result = await db.execute(sql`
        SELECT
          ${dateTrunc} AS "period",
          COUNT(DISTINCT pi.id) AS "totalInspections",
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS "okCount",
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS "ngCount",
          SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END) AS "ntfCount",
          COALESCE(ROUND(
            SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(DISTINCT pi.id), 0), 2
          ), 0) AS "yieldRate"
        FROM product_inspections pi
        LEFT JOIN machines m ON pi."machineId" = m.id
        WHERE pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${stationId ? sql`AND m."stationId" = ${stationId}` : sql``}
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY ${dateTrunc}
        ORDER BY "period" ASC
      `);

      const rows = (result as any).rows || (result as any);
      res.json({
        success: true,
        data: {
          groupBy,
          dateRange: { startDate: startStr, endDate: endStr },
          trend: (rows as any[]).map((r: any) => ({
            period: r.period,
            totalInspections: Number(r.totalInspections),
            okCount: Number(r.okCount),
            ngCount: Number(r.ngCount),
            ntfCount: Number(r.ntfCount),
            yieldRate: Number(r.yieldRate),
          })),
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/trend error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get trend data" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/defect-pareto
  // Phân tích Pareto lỗi (NG) theo điểm đo
  // ================================================================
  app.get("/api/external/inspections/defect-pareto", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);
      const limit = clampLimit(req.query.limit, 20, 100);

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate are required (ISO 8601 format)",
        });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      // Resolve productModelId
      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      // Get NG counts grouped by measurement point definition
      const result = await db.execute(sql`
        SELECT
          mpd.id AS "pointDefId",
          mpd.code AS "pointCode",
          mpd.name AS "pointName",
          mpd."measurementType",
          pm.id AS "productModelId",
          pm.code AS "productCode",
          pm.name AS "productName",
          COUNT(mr.id) AS "ngCount",
          (
            SELECT COUNT(mr2.id)
            FROM measurement_results mr2
            INNER JOIN product_inspections pi2 ON mr2."inspectionId" = pi2.id
            WHERE mr2."pointDefId" = mpd.id
              AND pi2."inspectionTime" >= ${startStr}::timestamp
              AND pi2."inspectionTime" <= ${endStr}::timestamp
              ${stationId ? sql`AND pi2."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})` : sql``}
              ${resolvedProductModelId ? sql`AND pi2."productModelId" = ${resolvedProductModelId}` : sql``}
          ) AS "totalCount"
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        INNER JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
        LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
        WHERE mr.result = 'NG'
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${stationId ? sql`AND pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})` : sql``}
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY mpd.id, mpd.code, mpd.name, mpd."measurementType", pm.id, pm.code, pm.name
        ORDER BY COUNT(mr.id) DESC
        LIMIT ${limit}
      `);

      const rows = (result as any).rows || (result as any);
      const items = (rows as any[]).map((r: any) => ({
        pointDefId: Number(r.pointDefId),
        pointCode: r.pointCode || "",
        pointName: r.pointName || "",
        measurementType: r.measurementType || "OTHER",
        productModelId: r.productModelId ? Number(r.productModelId) : null,
        productCode: r.productCode || "",
        productName: r.productName || "",
        ngCount: Number(r.ngCount),
        totalCount: Number(r.totalCount),
        ngRate: Number(r.totalCount) > 0
          ? Number(((Number(r.ngCount) / Number(r.totalCount)) * 100).toFixed(2))
          : 0,
      }));

      // Calculate percentages and cumulative
      const totalNG = items.reduce((sum, i) => sum + i.ngCount, 0);
      let cumulative = 0;
      const pareto = items.map((item) => {
        const percentage = totalNG > 0 ? Number(((item.ngCount / totalNG) * 100).toFixed(2)) : 0;
        cumulative += percentage;
        return {
          ...item,
          percentage,
          cumulativePercentage: Number(cumulative.toFixed(2)),
        };
      });

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          totalNGCount: totalNG,
          items: pareto,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/defect-pareto error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get defect pareto" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/images
  // Danh sách ảnh kiểm tra (lọc theo station/point/product/result)
  // ================================================================
  app.get("/api/external/inspections/images", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const pointDefId = parseIntParam(req.query.pointDefId);
      const resultFilter = (req.query.result as string)?.toUpperCase() || "ALL"; // OK, NG, ALL
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);
      const limit = clampLimit(req.query.limit, 50, 200);
      const offset = parseIntParam(req.query.offset) || 0;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate are required (ISO 8601 format)",
        });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }
      if (!["OK", "NG", "ALL"].includes(resultFilter)) {
        return res.status(400).json({ success: false, message: "result must be one of: OK, NG, ALL" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      // Resolve productModelId
      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      // Count total for pagination
      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS total
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        LEFT JOIN machines m ON pi."machineId" = m.id
        WHERE pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          AND mr."imageUrl" IS NOT NULL AND mr."imageUrl" != ''
          ${resultFilter !== "ALL" ? sql`AND mr.result = ${resultFilter}` : sql``}
          ${pointDefId ? sql`AND mr."pointDefId" = ${pointDefId}` : sql``}
          ${stationId ? sql`AND m."stationId" = ${stationId}` : sql``}
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
      `);

      const totalRows = (countResult as any).rows || (countResult as any);
      const total = Number((totalRows as any[])[0]?.total || 0);

      // Get images
      const result = await db.execute(sql`
        SELECT
          mr.id AS "measurementResultId",
          mr."pointDefId",
          mpd.code AS "pointCode",
          mpd.name AS "pointName",
          mr.result,
          mr."measuredValue",
          mr."measuredValueText",
          mr."imageUrl",
          mr.remark,
          pi.id AS "inspectionId",
          pi."serialNumber",
          pi."overallResult" AS "inspectionResult",
          pi."inspectionTime",
          pi."productModelId",
          pm.code AS "productCode",
          pm.name AS "productName",
          m.id AS "machineId",
          m.code AS "machineCode",
          s.id AS "stationId",
          s.code AS "stationCode",
          s.name AS "stationName"
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
        LEFT JOIN machines m ON pi."machineId" = m.id
        LEFT JOIN stations s ON m."stationId" = s.id
        LEFT JOIN product_models pm ON pi."productModelId" = pm.id
        WHERE pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          AND mr."imageUrl" IS NOT NULL AND mr."imageUrl" != ''
          ${resultFilter !== "ALL" ? sql`AND mr.result = ${resultFilter}` : sql``}
          ${pointDefId ? sql`AND mr."pointDefId" = ${pointDefId}` : sql``}
          ${stationId ? sql`AND m."stationId" = ${stationId}` : sql``}
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        ORDER BY pi."inspectionTime" DESC, mr.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const rows = (result as any).rows || (result as any);
      const images = (rows as any[]).map((r: any) => ({
        measurementResultId: Number(r.measurementResultId),
        pointDefId: Number(r.pointDefId),
        pointCode: r.pointCode || "",
        pointName: r.pointName || "",
        result: r.result,
        measuredValue: r.measuredValue,
        measuredValueText: r.measuredValueText || null,
        imageUrl: r.imageUrl,
        remark: r.remark || null,
        inspectionId: Number(r.inspectionId),
        serialNumber: r.serialNumber || "",
        inspectionResult: r.inspectionResult,
        inspectionTime: r.inspectionTime,
        productModelId: r.productModelId ? Number(r.productModelId) : null,
        productCode: r.productCode || "",
        productName: r.productName || "",
        machineId: r.machineId ? Number(r.machineId) : null,
        machineCode: r.machineCode || "",
        stationId: r.stationId ? Number(r.stationId) : null,
        stationCode: r.stationCode || "",
        stationName: r.stationName || "",
      }));

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          pagination: { total, limit, offset, hasMore: offset + limit < total },
          images,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/images error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get inspection images" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/events
  // Sự kiện liên quan đến quá trình kiểm tra (package upload, commit, ...)
  // ================================================================
  app.get("/api/external/inspections/events", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const machineId = parseIntParam(req.query.machineId);
      const packageId = req.query.packageId as string | undefined;
      const eventType = req.query.eventType as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);
      const limit = clampLimit(req.query.limit, 50, 500);
      const offset = parseIntParam(req.query.offset) || 0;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate are required (ISO 8601 format)",
        });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      const validEvents = [
        "presign", "upload_start", "upload_success", "upload_fail",
        "commit_start", "commit_success", "commit_fail",
        "retry", "image_view", "zip_download", "status_change",
      ];
      if (eventType && !validEvents.includes(eventType)) {
        return res.status(400).json({
          success: false,
          message: `eventType must be one of: ${validEvents.join(", ")}`,
        });
      }

      // Count total
      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS total
        FROM package_activity_logs pal
        LEFT JOIN machines m ON pal."machineId" = m.id
        WHERE pal."createdAt" >= ${startStr}::timestamp
          AND pal."createdAt" <= ${endStr}::timestamp
          ${machineId ? sql`AND pal."machineId" = ${machineId}` : sql``}
          ${stationId ? sql`AND m."stationId" = ${stationId}` : sql``}
          ${packageId ? sql`AND pal."packageId" = ${packageId}` : sql``}
          ${eventType ? sql`AND pal.event = ${eventType}` : sql``}
      `);

      const totalRows = (countResult as any).rows || (countResult as any);
      const total = Number((totalRows as any[])[0]?.total || 0);

      const result = await db.execute(sql`
        SELECT
          pal.id,
          pal."packageId",
          pal."packageDbId",
          pal."machineId",
          m.code AS "machineCode",
          m.name AS "machineName",
          s.id AS "stationId",
          s.code AS "stationCode",
          pal.event,
          pal.level,
          pal.message,
          pal.detail,
          pal.source,
          pal."fileSizeBytes",
          pal."ipAddress",
          pal."userAgent",
          pal."createdAt"
        FROM package_activity_logs pal
        LEFT JOIN machines m ON pal."machineId" = m.id
        LEFT JOIN stations s ON m."stationId" = s.id
        WHERE pal."createdAt" >= ${startStr}::timestamp
          AND pal."createdAt" <= ${endStr}::timestamp
          ${machineId ? sql`AND pal."machineId" = ${machineId}` : sql``}
          ${stationId ? sql`AND m."stationId" = ${stationId}` : sql``}
          ${packageId ? sql`AND pal."packageId" = ${packageId}` : sql``}
          ${eventType ? sql`AND pal.event = ${eventType}` : sql``}
        ORDER BY pal."createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const rows = (result as any).rows || (result as any);
      const events = (rows as any[]).map((r: any) => ({
        id: Number(r.id),
        packageId: r.packageId || null,
        machineId: r.machineId ? Number(r.machineId) : null,
        machineCode: r.machineCode || "",
        machineName: r.machineName || "",
        stationId: r.stationId ? Number(r.stationId) : null,
        stationCode: r.stationCode || "",
        event: r.event,
        level: r.level,
        message: r.message || "",
        detail: r.detail || null,
        source: r.source || "",
        fileSizeBytes: r.fileSizeBytes ? Number(r.fileSizeBytes) : null,
        createdAt: r.createdAt,
      }));

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          pagination: { total, limit, offset, hasMore: offset + limit < total },
          events,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/events error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get inspection events" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/measurements
  // Giá trị đo thực tế của một điểm đo theo thời gian
  // ================================================================
  app.get("/api/external/inspections/measurements", validateExternalAuth, async (req, res) => {
    try {
      const pointDefId = parseIntParam(req.query.pointDefId);
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);
      const limit = clampLimit(req.query.limit, 100, 1000);
      const offset = parseIntParam(req.query.offset) || 0;

      if (!pointDefId) {
        return res.status(400).json({ success: false, message: "pointDefId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate are required (ISO 8601 format)",
        });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      // Resolve productModelId
      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      // Get point definition info
      const pointDefResult = await db.execute(sql`
        SELECT mpd.id, mpd.code, mpd.name, mpd."measurementType", mpd.unit, mpd."lowerLimit", mpd."upperLimit", mpd."nominalValue",
          mpd."productModelId", pm.code AS "productCode", pm.name AS "productName"
        FROM measurement_point_defs mpd
        LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
        WHERE mpd.id = ${pointDefId}
        LIMIT 1
      `);
      const pointDefRows = (pointDefResult as any).rows || (pointDefResult as any);
      const pointDef = (pointDefRows as any[])[0];
      if (!pointDef) {
        return res.status(404).json({ success: false, message: `Measurement point definition ${pointDefId} not found` });
      }

      // Count total
      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS total
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        LEFT JOIN machines m ON pi."machineId" = m.id
        WHERE mr."pointDefId" = ${pointDefId}
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${stationId ? sql`AND m."stationId" = ${stationId}` : sql``}
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
      `);
      const totalRows2 = (countResult as any).rows || (countResult as any);
      const total = Number((totalRows2 as any[])[0]?.total || 0);

      // Get measurements
      const result = await db.execute(sql`
        SELECT
          mr.id AS "measurementResultId",
          mr."measuredValue",
          mr."measuredValueText",
          mr.result,
          mr.remark,
          mr."imageUrl",
          pi.id AS "inspectionId",
          pi."serialNumber",
          pi."overallResult" AS "inspectionResult",
          pi."inspectionTime",
          m.id AS "machineId",
          m.code AS "machineCode",
          s.id AS "stationId",
          s.code AS "stationCode"
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        LEFT JOIN machines m ON pi."machineId" = m.id
        LEFT JOIN stations s ON m."stationId" = s.id
        WHERE mr."pointDefId" = ${pointDefId}
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${stationId ? sql`AND m."stationId" = ${stationId}` : sql``}
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        ORDER BY pi."inspectionTime" DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const rows = (result as any).rows || (result as any);
      const measurements = (rows as any[]).map((r: any) => ({
        measurementResultId: Number(r.measurementResultId),
        measuredValue: r.measuredValue,
        measuredValueText: r.measuredValueText || null,
        result: r.result,
        remark: r.remark || null,
        hasImage: !!r.imageUrl,
        imageUrl: r.imageUrl || null,
        inspectionId: Number(r.inspectionId),
        serialNumber: r.serialNumber || "",
        inspectionResult: r.inspectionResult,
        inspectionTime: r.inspectionTime,
        machineId: r.machineId ? Number(r.machineId) : null,
        machineCode: r.machineCode || "",
        stationId: r.stationId ? Number(r.stationId) : null,
        stationCode: r.stationCode || "",
      }));

      res.json({
        success: true,
        data: {
          pointDef: {
            id: Number(pointDef.id),
            code: pointDef.code || "",
            name: pointDef.name || "",
            measurementType: pointDef.measurementType || "OTHER",
            unit: pointDef.unit || "",
            lowerLimit: pointDef.lowerLimit != null ? Number(pointDef.lowerLimit) : null,
            upperLimit: pointDef.upperLimit != null ? Number(pointDef.upperLimit) : null,
            nominalValue: pointDef.nominalValue != null ? Number(pointDef.nominalValue) : null,
            productModelId: pointDef.productModelId ? Number(pointDef.productModelId) : null,
            productCode: pointDef.productCode || "",
            productName: pointDef.productName || "",
          },
          dateRange: { startDate: startStr, endDate: endStr },
          pagination: { total, limit, offset, hasMore: offset + limit < total },
          measurements,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/measurements error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get measurements" });
    }
  });

  // ================================================================
  // GET /api/external/products
  // Danh sách sản phẩm (tìm kiếm, phân trang)
  // ================================================================
  app.get("/api/external/products", validateExternalAuth, async (req, res) => {
    try {
      const search = req.query.search as string | undefined;
      const lifecycleStatus = req.query.lifecycleStatus as string | undefined;
      const limit = clampLimit(req.query.limit, 50, 200);
      const offset = parseIntParam(req.query.offset) || 0;

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      // Count total
      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS total
        FROM product_models
        WHERE 1=1
          ${search ? sql`AND (code ILIKE ${"%" + search + "%"} OR name ILIKE ${"%" + search + "%"})` : sql``}
          ${lifecycleStatus ? sql`AND "lifecycleStatus" = ${lifecycleStatus}` : sql``}
      `);
      const totalRows = (countResult as any).rows || (countResult as any);
      const total = Number((totalRows as any[])[0]?.total || 0);

      const result = await db.execute(sql`
        SELECT
          id, code, name, description, category,
          "lifecycleStatus", "targetYieldRate", "minYieldRate",
          "imageWidth", "imageHeight", "imageDisplayMode",
          "pointsConfigVersion",
          "createdAt", "updatedAt"
        FROM product_models
        WHERE 1=1
          ${search ? sql`AND (code ILIKE ${"%" + search + "%"} OR name ILIKE ${"%" + search + "%"})` : sql``}
          ${lifecycleStatus ? sql`AND "lifecycleStatus" = ${lifecycleStatus}` : sql``}
        ORDER BY code ASC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const rows = (result as any).rows || (result as any);
      const products = (rows as any[]).map((r: any) => ({
        id: Number(r.id),
        code: r.code || "",
        name: r.name || "",
        description: r.description || null,
        category: r.category || null,
        lifecycleStatus: r.lifecycleStatus || "active",
        targetYieldRate: r.targetYieldRate != null ? Number(r.targetYieldRate) : null,
        minYieldRate: r.minYieldRate != null ? Number(r.minYieldRate) : null,
        imageWidth: r.imageWidth ? Number(r.imageWidth) : null,
        imageHeight: r.imageHeight ? Number(r.imageHeight) : null,
        imageDisplayMode: r.imageDisplayMode || "contain",
        pointsConfigVersion: r.pointsConfigVersion ? Number(r.pointsConfigVersion) : 1,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

      res.json({
        success: true,
        data: {
          pagination: { total, limit, offset, hasMore: offset + limit < total },
          products,
        },
      });
    } catch (error: any) {
      console.error("[External] products list error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get products" });
    }
  });

  // ================================================================
  // GET /api/external/products/:id
  // Chi tiết sản phẩm kèm danh sách điểm đo
  // ================================================================
  app.get("/api/external/products/:id", validateExternalAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, message: "Invalid product ID" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      // Get product
      const productResult = await db.execute(sql`
        SELECT
          id, code, name, description, category,
          "lifecycleStatus", "targetYieldRate", "minYieldRate",
          "referenceImageUrl", "imageWidth", "imageHeight", "imageDisplayMode",
          "pointsConfigVersion",
          "createdAt", "updatedAt"
        FROM product_models
        WHERE id = ${id}
        LIMIT 1
      `);

      const productRows = (productResult as any).rows || (productResult as any);
      const product = (productRows as any[])[0];
      if (!product) {
        return res.status(404).json({ success: false, message: `Product with ID ${id} not found` });
      }

      // Get measurement points
      const pointsResult = await db.execute(sql`
        SELECT
          mpd.id, mpd.code, mpd.name, mpd."measurementType",
          mpd.unit, mpd."lowerLimit", mpd."upperLimit", mpd."nominalValue",
          mpd."isActive", mpd."orderIndex",
          mpd."machineId", m.code AS "machineCode",
          mpd."referenceImageUrl",
          mpd."cropWidth", mpd."cropHeight"
        FROM measurement_point_defs mpd
        LEFT JOIN machines m ON mpd."machineId" = m.id
        WHERE mpd."productModelId" = ${id}
        ORDER BY mpd."orderIndex", mpd.code
      `);

      const pointRows = (pointsResult as any).rows || (pointsResult as any);
      const measurementPoints = (pointRows as any[]).map((r: any) => ({
        id: Number(r.id),
        code: r.code || "",
        name: r.name || "",
        measurementType: r.measurementType || "OTHER",
        unit: r.unit || "",
        lowerLimit: r.lowerLimit != null ? Number(r.lowerLimit) : null,
        upperLimit: r.upperLimit != null ? Number(r.upperLimit) : null,
        nominalValue: r.nominalValue != null ? Number(r.nominalValue) : null,
        isActive: r.isActive ?? true,
        orderIndex: r.orderIndex ? Number(r.orderIndex) : 0,
        machineId: r.machineId ? Number(r.machineId) : null,
        machineCode: r.machineCode || null,
        hasReferenceImage: !!r.referenceImageUrl,
        cropWidth: r.cropWidth ? Number(r.cropWidth) : null,
        cropHeight: r.cropHeight ? Number(r.cropHeight) : null,
      }));

      res.json({
        success: true,
        data: {
          product: {
            id: Number(product.id),
            code: product.code || "",
            name: product.name || "",
            description: product.description || null,
            category: product.category || null,
            lifecycleStatus: product.lifecycleStatus || "active",
            targetYieldRate: product.targetYieldRate != null ? Number(product.targetYieldRate) : null,
            minYieldRate: product.minYieldRate != null ? Number(product.minYieldRate) : null,
            hasReferenceImage: !!product.referenceImageUrl,
            imageWidth: product.imageWidth ? Number(product.imageWidth) : null,
            imageHeight: product.imageHeight ? Number(product.imageHeight) : null,
            imageDisplayMode: product.imageDisplayMode || "contain",
            pointsConfigVersion: product.pointsConfigVersion ? Number(product.pointsConfigVersion) : 1,
            createdAt: product.createdAt,
            updatedAt: product.updatedAt,
          },
          measurementPoints,
          totalPoints: measurementPoints.length,
          activePoints: measurementPoints.filter((p) => p.isActive).length,
        },
      });
    } catch (error: any) {
      console.error("[External] product detail error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get product details" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/control-chart
  // SPC Control Chart — daily yield with UCL/LCL, Western Electric Rules, Cpk/Ppk
  // ================================================================
  app.get("/api/external/inspections/control-chart", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      const result = await db.execute(sql`
        SELECT
          date_trunc('day', pi."inspectionTime") AS day,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY date_trunc('day', pi."inspectionTime")
        ORDER BY day ASC
      `);

      const rows = (result as any).rows || (result as any);
      const dailyData = (rows as any[]).map((r: any) => ({
        day: String(r.day),
        total: Number(r.total) || 0,
        ok: Number(r.ok) || 0,
        ng: Number(r.ng) || 0,
        yield: Number(r.total) > 0 ? (Number(r.ok) / Number(r.total)) * 100 : 0,
      }));

      const yields = dailyData.map(d => d.yield);
      const n = yields.length;

      if (n < 2) {
        return res.json({ success: true, data: { points: [], statistics: null, ruleViolations: [] } });
      }

      const mean = yields.reduce((a, b) => a + b, 0) / n;
      const stddev = Math.sqrt(yields.reduce((s, y) => s + (y - mean) ** 2, 0) / (n - 1 || 1));
      const ucl = Math.min(100, mean + 3 * stddev);
      const lcl = Math.max(0, mean - 3 * stddev);

      // Moving ranges
      const movingRanges = [0, ...yields.slice(1).map((y, i) => Math.abs(y - yields[i]))];
      const mrMean = movingRanges.slice(1).reduce((a, b) => a + b, 0) / (n - 1 || 1);

      // Cpk / Ppk
      const USL = 100, LSL = 85;
      const cpk = stddev > 0 ? Math.min((USL - mean) / (3 * stddev), (mean - LSL) / (3 * stddev)) : 0;
      const ppk = cpk; // For short-term = long-term when no subgroups

      // Zone classification
      function zoneOf(y: number): string {
        if (y > mean + 3 * stddev) return 'above';
        if (y < mean - 3 * stddev) return 'below';
        if (y > mean + 2 * stddev) return 'A+';
        if (y < mean - 2 * stddev) return 'A-';
        if (y > mean + stddev) return 'B+';
        if (y < mean - stddev) return 'B-';
        return 'C';
      }

      // Western Electric Rules detection
      function detectWesternElectricRules(idx: number): { ruleNumber: number; description: string }[] {
        const violations: { ruleNumber: number; description: string }[] = [];
        const y = yields[idx];

        // Rule 1: Point beyond 3σ
        if (y > ucl || y < lcl) {
          violations.push({ ruleNumber: 1, description: 'Point beyond 3σ limit' });
        }

        // Rule 2: 9 consecutive same side of center
        if (idx >= 8) {
          const last9 = yields.slice(idx - 8, idx + 1);
          if (last9.every(v => v > mean) || last9.every(v => v < mean)) {
            violations.push({ ruleNumber: 2, description: '9 consecutive points on same side of center' });
          }
        }

        // Rule 3: 6 consecutive increasing or decreasing
        if (idx >= 5) {
          const last6 = yields.slice(idx - 5, idx + 1);
          const allUp = last6.every((v, i) => i === 0 || v > last6[i - 1]);
          const allDown = last6.every((v, i) => i === 0 || v < last6[i - 1]);
          if (allUp || allDown) {
            violations.push({ ruleNumber: 3, description: '6 consecutive points trending in one direction' });
          }
        }

        // Rule 4: 14 alternating up/down
        if (idx >= 13) {
          const last14 = yields.slice(idx - 13, idx + 1);
          let alternating = true;
          for (let i = 2; i < last14.length; i++) {
            if (!((last14[i] - last14[i - 1]) * (last14[i - 1] - last14[i - 2]) < 0)) {
              alternating = false;
              break;
            }
          }
          if (alternating) {
            violations.push({ ruleNumber: 4, description: '14 consecutive alternating points' });
          }
        }

        // Rule 5: 2 of 3 in zone A or beyond
        if (idx >= 2) {
          const last3 = yields.slice(idx - 2, idx + 1);
          const aboveA = last3.filter(v => v > mean + 2 * stddev).length;
          const belowA = last3.filter(v => v < mean - 2 * stddev).length;
          if (aboveA >= 2 || belowA >= 2) {
            violations.push({ ruleNumber: 5, description: '2 of 3 points in Zone A or beyond' });
          }
        }

        // Rule 6: 4 of 5 in zone B or beyond
        if (idx >= 4) {
          const last5 = yields.slice(idx - 4, idx + 1);
          const aboveB = last5.filter(v => v > mean + stddev).length;
          const belowB = last5.filter(v => v < mean - stddev).length;
          if (aboveB >= 4 || belowB >= 4) {
            violations.push({ ruleNumber: 6, description: '4 of 5 points in Zone B or beyond' });
          }
        }

        // Rule 7: 15 consecutive in zone C (stratification)
        if (idx >= 14) {
          const last15 = yields.slice(idx - 14, idx + 1);
          if (last15.every(v => Math.abs(v - mean) <= stddev)) {
            violations.push({ ruleNumber: 7, description: '15 consecutive points within 1σ (stratification)' });
          }
        }

        // Rule 8: 8 consecutive beyond 1σ on both sides (mixture)
        if (idx >= 7) {
          const last8 = yields.slice(idx - 7, idx + 1);
          if (last8.every(v => Math.abs(v - mean) > stddev)) {
            violations.push({ ruleNumber: 8, description: '8 consecutive points beyond 1σ (mixture)' });
          }
        }

        return violations;
      }

      const points = dailyData.map((d, i) => {
        const violations = detectWesternElectricRules(i);
        return {
          day: d.day,
          yield: Math.round(d.yield * 100) / 100,
          total: d.total,
          ok: d.ok,
          ng: d.ng,
          zone: zoneOf(d.yield),
          movingRange: Math.round(movingRanges[i] * 100) / 100,
          outOfControl: violations.length > 0,
          violatedRules: violations.map(v => v.ruleNumber),
          ruleDescriptions: violations.map(v => v.description),
        };
      });

      // Rule violation summary
      const ruleViolations: { ruleNumber: number; description: string; count: number }[] = [];
      const ruleCounts = new Map<number, { desc: string; count: number }>();
      for (const p of points) {
        for (let i = 0; i < p.violatedRules.length; i++) {
          const rn = p.violatedRules[i];
          const existing = ruleCounts.get(rn);
          if (existing) existing.count++;
          else ruleCounts.set(rn, { desc: p.ruleDescriptions[i], count: 1 });
        }
      }
      for (const [ruleNumber, { desc, count }] of ruleCounts) {
        ruleViolations.push({ ruleNumber, description: desc, count });
      }
      ruleViolations.sort((a, b) => a.ruleNumber - b.ruleNumber);

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          statistics: {
            mean: Math.round(mean * 100) / 100,
            stddev: Math.round(stddev * 100) / 100,
            ucl: Math.round(ucl * 100) / 100,
            lcl: Math.round(lcl * 100) / 100,
            cpk: Math.round(cpk * 100) / 100,
            ppk: Math.round(ppk * 100) / 100,
            mrMean: Math.round(mrMean * 100) / 100,
            n,
          },
          points,
          ruleViolations,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/control-chart error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get control chart data" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/histogram
  // Yield distribution histogram with statistics
  // ================================================================
  app.get("/api/external/inspections/histogram", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);
      const bins = Math.min(50, Math.max(5, parseIntParam(req.query.bins) || 20));

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      const result = await db.execute(sql`
        SELECT
          date_trunc('day', pi."inspectionTime") AS day,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY date_trunc('day', pi."inspectionTime")
        ORDER BY day ASC
      `);

      const rows = (result as any).rows || (result as any);
      const yields = (rows as any[]).map((r: any) => {
        const total = Number(r.total) || 0;
        const ok = Number(r.ok) || 0;
        return total > 0 ? (ok / total) * 100 : 0;
      });

      const n = yields.length;
      if (n < 2) {
        return res.json({ success: true, data: { bins: [], statistics: null, normalDistribution: [] } });
      }

      const sorted = [...yields].sort((a, b) => a - b);
      const mean = yields.reduce((a, b) => a + b, 0) / n;
      const stddev = Math.sqrt(yields.reduce((s, y) => s + (y - mean) ** 2, 0) / (n - 1));
      const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];

      // Mode (most frequent rounded value)
      const freqMap = new Map<number, number>();
      for (const y of yields) {
        const rounded = Math.round(y * 10) / 10;
        freqMap.set(rounded, (freqMap.get(rounded) || 0) + 1);
      }
      let mode = yields[0], modeCount = 0;
      for (const [val, cnt] of freqMap) { if (cnt > modeCount) { mode = val; modeCount = cnt; } }

      // Skewness & Kurtosis
      const m3 = yields.reduce((s, y) => s + ((y - mean) / stddev) ** 3, 0) / n;
      const m4 = yields.reduce((s, y) => s + ((y - mean) / stddev) ** 4, 0) / n;
      const skewness = m3;
      const kurtosis = m4 - 3; // excess kurtosis

      // Build histogram bins
      const minVal = sorted[0];
      const maxVal = sorted[n - 1];
      const range = maxVal - minVal || 1;
      const binWidth = range / bins;
      const histBins: { binStart: number; binEnd: number; count: number; frequency: number }[] = [];
      for (let i = 0; i < bins; i++) {
        const binStart = Math.round((minVal + i * binWidth) * 100) / 100;
        const binEnd = Math.round((minVal + (i + 1) * binWidth) * 100) / 100;
        const count = yields.filter(y => i === bins - 1 ? y >= binStart && y <= binEnd : y >= binStart && y < binEnd).length;
        histBins.push({ binStart, binEnd, count, frequency: Math.round((count / n) * 10000) / 100 });
      }

      // Normal distribution overlay
      const normalDist = histBins.map(b => {
        const x = (b.binStart + b.binEnd) / 2;
        const z = (x - mean) / stddev;
        const pdf = (1 / (stddev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z);
        return { x: Math.round(x * 100) / 100, pdf: Math.round(pdf * 10000) / 10000 };
      });

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          bins: histBins,
          statistics: {
            n, mean: Math.round(mean * 100) / 100, median: Math.round(median * 100) / 100,
            mode: Math.round(mode * 100) / 100, stddev: Math.round(stddev * 100) / 100,
            skewness: Math.round(skewness * 1000) / 1000, kurtosis: Math.round(kurtosis * 1000) / 1000,
            min: Math.round(minVal * 100) / 100, max: Math.round(maxVal * 100) / 100,
          },
          normalDistribution: normalDist,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/histogram error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get histogram data" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/stratification
  // Stratification analysis — by machine, shift, day of week
  // ================================================================
  app.get("/api/external/inspections/stratification", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      // By Machine
      const machineResult = await db.execute(sql`
        SELECT
          m.id, m.code, m.name,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng,
          SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END) AS ntf
        FROM product_inspections pi
        INNER JOIN machines m ON pi."machineId" = m.id
        WHERE m."stationId" = ${stationId}
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY m.id, m.code, m.name
        ORDER BY m.code
      `);

      // By Shift (Morning 6-14, Afternoon 14-22, Night 22-6)
      const shiftResult = await db.execute(sql`
        SELECT
          CASE
            WHEN EXTRACT(HOUR FROM pi."inspectionTime") >= 6 AND EXTRACT(HOUR FROM pi."inspectionTime") < 14 THEN 'Morning'
            WHEN EXTRACT(HOUR FROM pi."inspectionTime") >= 14 AND EXTRACT(HOUR FROM pi."inspectionTime") < 22 THEN 'Afternoon'
            ELSE 'Night'
          END AS shift,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng,
          SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END) AS ntf
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY shift
        ORDER BY CASE
          WHEN CASE WHEN EXTRACT(HOUR FROM pi."inspectionTime") >= 6 AND EXTRACT(HOUR FROM pi."inspectionTime") < 14 THEN 'Morning'
                    WHEN EXTRACT(HOUR FROM pi."inspectionTime") >= 14 AND EXTRACT(HOUR FROM pi."inspectionTime") < 22 THEN 'Afternoon'
                    ELSE 'Night' END = 'Morning' THEN 1
          WHEN CASE WHEN EXTRACT(HOUR FROM pi."inspectionTime") >= 6 AND EXTRACT(HOUR FROM pi."inspectionTime") < 14 THEN 'Morning'
                    WHEN EXTRACT(HOUR FROM pi."inspectionTime") >= 14 AND EXTRACT(HOUR FROM pi."inspectionTime") < 22 THEN 'Afternoon'
                    ELSE 'Night' END = 'Afternoon' THEN 2
          ELSE 3
        END
      `);

      // By Day of Week
      const dowResult = await db.execute(sql`
        SELECT
          EXTRACT(DOW FROM pi."inspectionTime") AS dow,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng,
          SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END) AS ntf
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY EXTRACT(DOW FROM pi."inspectionTime")
        ORDER BY dow
      `);

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const machineRows = (machineResult as any).rows || (machineResult as any);
      const shiftRows = (shiftResult as any).rows || (shiftResult as any);
      const dowRows = (dowResult as any).rows || (dowResult as any);

      const mapRow = (r: any) => {
        const total = Number(r.total) || 0;
        const ok = Number(r.ok) || 0;
        return { total, ok, ng: Number(r.ng) || 0, ntf: Number(r.ntf) || 0, yield: total > 0 ? Math.round((ok / total) * 10000) / 100 : 0 };
      };

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          byMachine: (machineRows as any[]).map((r: any) => ({
            machineId: Number(r.id), machineCode: r.code || "", machineName: r.name || "", ...mapRow(r),
          })),
          byShift: (shiftRows as any[]).map((r: any) => ({
            shift: r.shift, hours: r.shift === 'Morning' ? '06:00-14:00' : r.shift === 'Afternoon' ? '14:00-22:00' : '22:00-06:00', ...mapRow(r),
          })),
          byDayOfWeek: (dowRows as any[]).map((r: any) => ({
            dayOfWeek: Number(r.dow), dayName: dayNames[Number(r.dow)] || 'Unknown', ...mapRow(r),
          })),
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/stratification error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get stratification data" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/fail-history
  // Recent NG inspections with failed measurement details
  // ================================================================
  app.get("/api/external/inspections/fail-history", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);
      const limit = clampLimit(req.query.limit, 50, 200);

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      // Get NG inspections
      const inspResult = await db.execute(sql`
        SELECT
          pi.id, pi."serialNumber", pi."overallResult",
          pi."inspectionTime", pi."cycleTime",
          m.code AS "machineCode", m.name AS "machineName",
          pm.code AS "productCode", pm.name AS "productName"
        FROM product_inspections pi
        LEFT JOIN machines m ON pi."machineId" = m.id
        LEFT JOIN product_models pm ON pi."productModelId" = pm.id
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."overallResult" = 'NG'
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        ORDER BY pi."inspectionTime" DESC
        LIMIT ${limit}
      `);

      const inspRows = (inspResult as any).rows || (inspResult as any);
      const inspections = (inspRows as any[]);

      if (inspections.length === 0) {
        return res.json({ success: true, data: { failHistory: [] } });
      }

      const inspectionIds = inspections.map((r: any) => Number(r.id));

      // Get failed measurement points for these inspections
      const mrResult = await db.execute(sql`
        SELECT
          mr."inspectionId",
          mr."pointDefId",
          mpd.code AS "pointCode",
          mpd.name AS "pointName",
          mr."measuredValue",
          mr."measuredValueText",
          mr.result,
          mpd."lowerLimit",
          mpd."upperLimit",
          mpd."nominalValue",
          mpd.unit,
          mr."imageUrl",
          pm.id AS "productModelId",
          pm.code AS "productCode",
          pm.name AS "productName"
        FROM measurement_results mr
        LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
        LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
        WHERE mr."inspectionId" = ANY(${sql`ARRAY[${sql.join(inspectionIds.map(id => sql`${id}`), sql`,`)}]`}::int[])
          AND mr.result = 'NG'
        ORDER BY mr."inspectionId", mpd."orderIndex"
      `);

      const mrRows = (mrResult as any).rows || (mrResult as any);

      // Group failed points by inspection
      const failedPointsMap = new Map<number, any[]>();
      for (const r of mrRows as any[]) {
        const inspId = Number(r.inspectionId);
        if (!failedPointsMap.has(inspId)) failedPointsMap.set(inspId, []);
        failedPointsMap.get(inspId)!.push({
          pointDefId: Number(r.pointDefId),
          pointCode: r.pointCode || "",
          pointName: r.pointName || "",
          productModelId: r.productModelId ? Number(r.productModelId) : null,
          productCode: r.productCode || "",
          productName: r.productName || "",
          measuredValue: r.measuredValue,
          measuredValueText: r.measuredValueText || null,
          result: r.result,
          lowerLimit: r.lowerLimit != null ? Number(r.lowerLimit) : null,
          upperLimit: r.upperLimit != null ? Number(r.upperLimit) : null,
          nominalValue: r.nominalValue != null ? Number(r.nominalValue) : null,
          unit: r.unit || "",
          hasImage: !!r.imageUrl,
        });
      }

      const failHistory = inspections.map((r: any) => ({
        inspectionId: Number(r.id),
        serialNumber: r.serialNumber || "",
        overallResult: r.overallResult,
        inspectionTime: r.inspectionTime,
        cycleTime: r.cycleTime != null ? Number(r.cycleTime) : null,
        machineCode: r.machineCode || "",
        machineName: r.machineName || "",
        productCode: r.productCode || "",
        productName: r.productName || "",
        failedPoints: failedPointsMap.get(Number(r.id)) || [],
      }));

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          totalFails: failHistory.length,
          failHistory,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/fail-history error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get fail history" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/diagnostics
  // AI Diagnostics — alerts, patterns, recommendations
  // ================================================================
  app.get("/api/external/inspections/diagnostics", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      const pmFilter = resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``;

      // Overall stats
      const overallResult = await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng,
          SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END) AS ntf
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${pmFilter}
      `);

      const overallRows = (overallResult as any).rows || (overallResult as any);
      const ov = (overallRows as any[])[0] || { total: 0, ok: 0, ng: 0, ntf: 0 };
      const total = Number(ov.total) || 0;
      const ok = Number(ov.ok) || 0;
      const ng = Number(ov.ng) || 0;
      const ntf = Number(ov.ntf) || 0;
      const fpy = total > 0 ? (ok / total) * 100 : 0;
      const retestRate = total > 0 ? (ntf / total) * 100 : 0;

      // Daily yield for trend analysis
      const dailyResult = await db.execute(sql`
        SELECT
          date_trunc('day', pi."inspectionTime") AS day,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${pmFilter}
        GROUP BY date_trunc('day', pi."inspectionTime")
        ORDER BY day ASC
      `);

      const dailyRows = (dailyResult as any).rows || (dailyResult as any);
      const dailyYields = (dailyRows as any[]).map((r: any) => {
        const t = Number(r.total) || 0;
        const o = Number(r.ok) || 0;
        return { day: String(r.day), yield: t > 0 ? (o / t) * 100 : 0 };
      });

      // Hourly pattern for shift analysis
      const hourlyResult = await db.execute(sql`
        SELECT
          EXTRACT(HOUR FROM pi."inspectionTime") AS hour,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${pmFilter}
        GROUP BY EXTRACT(HOUR FROM pi."inspectionTime")
        ORDER BY hour
      `);

      const hourlyRows = (hourlyResult as any).rows || (hourlyResult as any);
      const hourlyData = (hourlyRows as any[]).map((r: any) => ({
        hour: Number(r.hour),
        total: Number(r.total) || 0,
        ng: Number(r.ng) || 0,
        ngRate: Number(r.total) > 0 ? (Number(r.ng) / Number(r.total)) * 100 : 0,
      }));

      // Top 5 defects
      const defectResult = await db.execute(sql`
        SELECT
          mpd.code AS "pointCode", mpd.name AS "pointName",
          pm.id AS "productModelId", pm.code AS "productCode", pm.name AS "productName",
          COUNT(*) AS count
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
        LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          AND mr.result = 'NG'
          ${pmFilter}
        GROUP BY mpd.code, mpd.name, pm.id, pm.code, pm.name
        ORDER BY count DESC
        LIMIT 5
      `);

      const defectRows = (defectResult as any).rows || (defectResult as any);
      const topDefects = (defectRows as any[]).map((r: any) => ({
        pointCode: r.pointCode || "", pointName: r.pointName || "",
        productModelId: r.productModelId ? Number(r.productModelId) : null,
        productCode: r.productCode || "",
        productName: r.productName || "",
        count: Number(r.count),
      }));

      // Generate alerts
      const alerts: { level: string; title: string; description: string }[] = [];
      if (fpy < 85) {
        alerts.push({ level: 'critical', title: 'Low Yield Alert', description: `FPY is ${fpy.toFixed(1)}% — well below the 85% threshold.` });
      } else if (fpy < 95) {
        alerts.push({ level: 'warning', title: 'Below Target Yield', description: `FPY is ${fpy.toFixed(1)}% — below the 95% target.` });
      }
      if (retestRate > 10) {
        alerts.push({ level: 'warning', title: 'High Retest Rate', description: `Retest rate is ${retestRate.toFixed(1)}% — indicating possible intermittent failures.` });
      }
      if (dailyYields.length >= 5) {
        const recent5 = dailyYields.slice(-5);
        const declining = recent5.filter((d, i) => i > 0 && d.yield < recent5[i - 1].yield).length;
        if (declining >= 4) {
          alerts.push({ level: 'warning', title: 'Declining Trend', description: `Yield has declined in 4 of the last 5 days.` });
        }
      }

      // Generate patterns
      const patterns: { name: string; description: string; confidence: number }[] = [];
      if (dailyYields.length >= 5) {
        const recent = dailyYields.slice(-5);
        const dec = recent.filter((d, i) => i > 0 && d.yield < recent[i - 1].yield).length;
        if (dec >= 4) {
          patterns.push({ name: 'Declining Trend', description: 'Consistent daily yield decline observed', confidence: 0.85 });
        }
      }
      if (hourlyData.length > 0) {
        const maxNgHour = hourlyData.reduce((a, b) => b.ngRate > a.ngRate ? b : a);
        const minNgHour = hourlyData.reduce((a, b) => b.ngRate < a.ngRate ? b : a);
        if (maxNgHour.ngRate - minNgHour.ngRate > 10) {
          patterns.push({ name: 'Shift Variation', description: `NG rate varies ${(maxNgHour.ngRate - minNgHour.ngRate).toFixed(1)}% between hours ${minNgHour.hour} and ${maxNgHour.hour}`, confidence: 0.75 });
        }
      }
      if (topDefects.length > 0 && ng > 0) {
        const topPct = (topDefects[0].count / ng) * 100;
        if (topPct > 50) {
          patterns.push({ name: 'Dominant Defect', description: `"${topDefects[0].productCode ? '[' + topDefects[0].productCode + '] ' : ''}${topDefects[0].pointName}" accounts for ${topPct.toFixed(0)}% of all NG results`, confidence: 0.9 });
        }
      }

      // Generate recommendations
      const recommendations: { priority: string; action: string; rationale: string }[] = [];
      if (fpy < 85) {
        recommendations.push({ priority: 'high', action: 'Investigate top defect points immediately', rationale: `FPY at ${fpy.toFixed(1)}% is critically low` });
      }
      if (topDefects.length > 0) {
        recommendations.push({ priority: 'medium', action: `Focus on measurement point "${topDefects[0].productCode ? '[' + topDefects[0].productCode + '] ' : ''}${topDefects[0].pointName}"`, rationale: `This point has ${topDefects[0].count} NG occurrences — the highest contributor` });
      }
      if (retestRate > 10) {
        recommendations.push({ priority: 'medium', action: 'Review NTF patterns to reduce retest rate', rationale: `${retestRate.toFixed(1)}% retest rate suggests unstable measurements` });
      }

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          overallStats: { total, ok, ng, ntf, fpy: Math.round(fpy * 100) / 100, retestRate: Math.round(retestRate * 100) / 100 },
          alerts,
          patterns,
          recommendations,
          topDefects,
          dailyYieldTrend: dailyYields.map(d => ({ day: d.day, yield: Math.round(d.yield * 100) / 100 })),
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/diagnostics error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get diagnostics data" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/scatter
  // Scatter/Correlation — hourly output volume vs NG rate
  // ================================================================
  app.get("/api/external/inspections/scatter", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      const result = await db.execute(sql`
        SELECT
          date_trunc('hour', pi."inspectionTime") AS period,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY date_trunc('hour', pi."inspectionTime")
        HAVING COUNT(*) > 0
        ORDER BY period
      `);

      const rows = (result as any).rows || (result as any);
      const points = (rows as any[]).map((r: any) => {
        const total = Number(r.total) || 0;
        const ng = Number(r.ng) || 0;
        return { period: String(r.period), x: total, y: total > 0 ? Math.round((ng / total) * 10000) / 100 : 0 };
      });

      const n = points.length;
      let correlation = 0, rSquared = 0, slope = 0, intercept = 0;

      if (n >= 3) {
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const xMean = xs.reduce((a, b) => a + b, 0) / n;
        const yMean = ys.reduce((a, b) => a + b, 0) / n;
        const ssxy = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
        const ssxx = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
        const ssyy = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);
        correlation = ssxx > 0 && ssyy > 0 ? ssxy / Math.sqrt(ssxx * ssyy) : 0;
        rSquared = correlation * correlation;
        slope = ssxx > 0 ? ssxy / ssxx : 0;
        intercept = yMean - slope * xMean;
      }

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          points,
          statistics: {
            n,
            correlation: Math.round(correlation * 1000) / 1000,
            rSquared: Math.round(rSquared * 1000) / 1000,
            trendLine: { slope: Math.round(slope * 10000) / 10000, intercept: Math.round(intercept * 100) / 100 },
          },
          xLabel: "Output Volume (inspections/hour)",
          yLabel: "NG Rate (%)",
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/scatter error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get scatter data" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/check-sheet
  // Check Sheet — defect type × day matrix
  // ================================================================
  app.get("/api/external/inspections/check-sheet", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      const result = await db.execute(sql`
        SELECT
          date_trunc('day', pi."inspectionTime") AS day,
          mr."pointDefId",
          mpd.code AS "pointCode",
          mpd.name AS "pointName",
          pm.id AS "productModelId",
          pm.code AS "productCode",
          pm.name AS "productName",
          COUNT(*) AS count
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
        LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          AND mr.result = 'NG'
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY date_trunc('day', pi."inspectionTime"), mr."pointDefId", mpd.code, mpd.name, pm.id, pm.code, pm.name
        ORDER BY day, mpd.code
      `);

      const rows = (result as any).rows || (result as any);

      // Build the matrix
      const days = new Set<string>();
      const defects = new Map<number, { code: string; name: string; productModelId: number | null; productCode: string; productName: string }>();
      const matrix = new Map<string, number>(); // key: "pointDefId|day"

      for (const r of rows as any[]) {
        const day = String(r.day);
        const pdId = Number(r.pointDefId);
        days.add(day);
        if (!defects.has(pdId)) defects.set(pdId, { code: r.pointCode || "", name: r.pointName || "", productModelId: r.productModelId ? Number(r.productModelId) : null, productCode: r.productCode || "", productName: r.productName || "" });
        matrix.set(`${pdId}|${day}`, Number(r.count));
      }

      const sortedDays = [...days].sort();
      const defectList = [...defects.entries()].map(([id, info]) => {
        const byDay = sortedDays.map(d => ({ day: d, count: matrix.get(`${id}|${d}`) || 0 }));
        const total = byDay.reduce((s, d) => s + d.count, 0);
        return { pointDefId: id, pointCode: info.code, pointName: info.name, productModelId: info.productModelId, productCode: info.productCode, productName: info.productName, byDay, total };
      });
      defectList.sort((a, b) => b.total - a.total);

      const totalByDay = sortedDays.map(d => ({
        day: d,
        count: defectList.reduce((s, def) => s + (def.byDay.find(b => b.day === d)?.count || 0), 0),
      }));
      const grandTotal = defectList.reduce((s, d) => s + d.total, 0);

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          periods: sortedDays,
          defects: defectList,
          totalByPeriod: totalByDay,
          grandTotal,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/check-sheet error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get check sheet data" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/cause-effect
  // Cause-Effect (Ishikawa 6M) — data-driven fishbone diagram data
  // ================================================================
  app.get("/api/external/inspections/cause-effect", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      const pmFilter = resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``;

      // Man (Shift NG rates)
      const shiftResult = await db.execute(sql`
        SELECT
          CASE
            WHEN EXTRACT(HOUR FROM pi."inspectionTime") >= 6 AND EXTRACT(HOUR FROM pi."inspectionTime") < 14 THEN 'Morning'
            WHEN EXTRACT(HOUR FROM pi."inspectionTime") >= 14 AND EXTRACT(HOUR FROM pi."inspectionTime") < 22 THEN 'Afternoon'
            ELSE 'Night'
          END AS shift,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${pmFilter}
        GROUP BY shift
      `);

      // Machine (per-machine NG rates)
      const machineResult = await db.execute(sql`
        SELECT
          m.code, m.name,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng
        FROM product_inspections pi
        INNER JOIN machines m ON pi."machineId" = m.id
        WHERE m."stationId" = ${stationId}
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${pmFilter}
        GROUP BY m.code, m.name
        ORDER BY ng DESC
      `);

      // Top defects (Measurement category)
      const defectResult = await db.execute(sql`
        SELECT mpd.code, mpd.name, pm.code AS "productCode", COUNT(*) AS count
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
        LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          AND mr.result = 'NG'
          ${pmFilter}
        GROUP BY mpd.code, mpd.name, pm.code
        ORDER BY count DESC
        LIMIT 5
      `);

      const shiftRows = (shiftResult as any).rows || (shiftResult as any);
      const machineRows = (machineResult as any).rows || (machineResult as any);
      const defectRowsArr = (defectResult as any).rows || (defectResult as any);

      // Build 6M categories
      const categories = [
        {
          name: 'Man', label: 'Operator / Shift',
          causes: (shiftRows as any[]).map((r: any) => {
            const total = Number(r.total) || 0;
            const ng = Number(r.ng) || 0;
            const ngRate = total > 0 ? (ng / total) * 100 : 0;
            return {
              cause: `${r.shift} shift`,
              detail: `NG rate: ${ngRate.toFixed(1)}% (${ng}/${total})`,
              severity: ngRate > 10 ? 'high' : ngRate > 5 ? 'medium' : 'low',
              dataValue: Math.round(ngRate * 100) / 100,
            };
          }),
        },
        {
          name: 'Machine', label: 'Equipment',
          causes: (machineRows as any[]).map((r: any) => {
            const total = Number(r.total) || 0;
            const ng = Number(r.ng) || 0;
            const ngRate = total > 0 ? (ng / total) * 100 : 0;
            return {
              cause: `${r.code} — ${r.name}`,
              detail: `NG rate: ${ngRate.toFixed(1)}% (${ng}/${total})`,
              severity: ngRate > 10 ? 'high' : ngRate > 5 ? 'medium' : 'low',
              dataValue: Math.round(ngRate * 100) / 100,
            };
          }),
        },
        {
          name: 'Material', label: 'Material / Components',
          causes: [{ cause: 'Incoming material quality', detail: 'Requires manual inspection data', severity: 'info', dataValue: null }],
        },
        {
          name: 'Method', label: 'Process / Procedure',
          causes: [{ cause: 'Standard operating procedure', detail: 'Requires process audit data', severity: 'info', dataValue: null }],
        },
        {
          name: 'Measurement', label: 'Inspection Points',
          causes: (defectRowsArr as any[]).map((r: any) => ({
            cause: `${r.productCode ? '[' + r.productCode + '] ' : ''}${r.code} — ${r.name}`,
            detail: `${Number(r.count)} NG occurrences`,
            severity: Number(r.count) > 50 ? 'high' : Number(r.count) > 10 ? 'medium' : 'low',
            dataValue: Number(r.count),
          })),
        },
        {
          name: 'Environment', label: 'Working Conditions',
          causes: [{ cause: 'Temperature / Humidity', detail: 'Requires environmental sensor data', severity: 'info', dataValue: null }],
        },
      ];

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          categories,
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/cause-effect error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get cause-effect data" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/ai-analysis
  // AI Analysis — anomaly detection, forecasting, clustering, process capability
  // ================================================================
  app.get("/api/external/inspections/ai-analysis", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      const result = await db.execute(sql`
        SELECT
          date_trunc('day', pi."inspectionTime") AS day,
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY date_trunc('day', pi."inspectionTime")
        ORDER BY day ASC
      `);

      const rows = (result as any).rows || (result as any);
      const dailyData = (rows as any[]).map((r: any) => ({
        day: String(r.day),
        total: Number(r.total) || 0,
        ok: Number(r.ok) || 0,
        ng: Number(r.ng) || 0,
        yield: Number(r.total) > 0 ? (Number(r.ok) / Number(r.total)) * 100 : 0,
      }));

      const yields = dailyData.map(d => d.yield);
      const n = yields.length;

      if (n < 3) {
        return res.json({ success: true, data: { anomalies: [], forecast: [], clusters: [], insights: [], processCapability: null } });
      }

      const mean = yields.reduce((a, b) => a + b, 0) / n;
      const stddev = Math.sqrt(yields.reduce((s, y) => s + (y - mean) ** 2, 0) / (n - 1 || 1));

      // 1. Anomaly Detection (Modified Z-Score using MAD)
      const medianYield = [...yields].sort((a, b) => a - b)[Math.floor(n / 2)];
      const mad = [...yields].map(y => Math.abs(y - medianYield)).sort((a, b) => a - b)[Math.floor(n / 2)];
      const anomalies = dailyData.map(d => {
        const mzScore = mad > 0 ? 0.6745 * (d.yield - medianYield) / mad : 0;
        return {
          day: d.day, yield: Math.round(d.yield * 100) / 100,
          zScore: Math.round(mzScore * 100) / 100,
          isAnomaly: Math.abs(mzScore) > 3.5,
          type: mzScore > 3.5 ? 'unusually_high' : mzScore < -3.5 ? 'unusually_low' : 'normal',
        };
      }).filter(a => a.isAnomaly);

      // 2. Exponential Smoothing Forecast
      const alpha = 0.3;
      let level = yields[0];
      for (let i = 1; i < n; i++) level = alpha * yields[i] + (1 - alpha) * level;
      const predStddev = stddev * 1.2;
      const forecast: { day: string; predicted: number; lower: number; upper: number }[] = [];
      const lastDate = new Date(dailyData[n - 1].day);
      for (let i = 1; i <= 7; i++) {
        const predDate = new Date(lastDate);
        predDate.setDate(predDate.getDate() + i);
        forecast.push({
          day: predDate.toISOString().split('T')[0],
          predicted: Math.round(Math.min(100, Math.max(0, level)) * 100) / 100,
          lower: Math.round(Math.max(0, level - 1.96 * predStddev) * 100) / 100,
          upper: Math.round(Math.min(100, level + 1.96 * predStddev) * 100) / 100,
        });
      }

      // 3. Clustering (low / normal / high yield days)
      const clusters: { id: number; label: string; centroid: number; count: number; days: string[] }[] = [];
      if (n >= 5) {
        const threshLow = mean - stddev;
        const threshHigh = mean + stddev;
        const lowDays = dailyData.filter(d => d.yield < threshLow);
        const medDays = dailyData.filter(d => d.yield >= threshLow && d.yield <= threshHigh);
        const highDays = dailyData.filter(d => d.yield > threshHigh);
        if (lowDays.length > 0) clusters.push({ id: 0, label: 'Low Performance', count: lowDays.length, centroid: Math.round((lowDays.reduce((s, d) => s + d.yield, 0) / lowDays.length) * 100) / 100, days: lowDays.map(d => d.day) });
        if (medDays.length > 0) clusters.push({ id: 1, label: 'Normal Performance', count: medDays.length, centroid: Math.round((medDays.reduce((s, d) => s + d.yield, 0) / medDays.length) * 100) / 100, days: medDays.map(d => d.day) });
        if (highDays.length > 0) clusters.push({ id: 2, label: 'High Performance', count: highDays.length, centroid: Math.round((highDays.reduce((s, d) => s + d.yield, 0) / highDays.length) * 100) / 100, days: highDays.map(d => d.day) });
      }

      // 4. Process Capability
      const USL = 100, LSL = 85;
      const cp = stddev > 0 ? (USL - LSL) / (6 * stddev) : 0;
      const cpk = stddev > 0 ? Math.min((USL - mean) / (3 * stddev), (mean - LSL) / (3 * stddev)) : 0;
      // Normal CDF approximation
      function normalCdf(x: number): number {
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
        const p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        const ax = Math.abs(x) / Math.sqrt(2);
        const t = 1.0 / (1.0 + p * ax);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
        return 0.5 * (1.0 + sign * y);
      }
      const ppm = stddev > 0 ? Math.round(1000000 * (1 - normalCdf((USL - mean) / stddev) + normalCdf((LSL - mean) / stddev))) : 0;

      // 5. AI Insights
      const insights: { type: string; title: string; description: string; confidence: number; severity: string }[] = [];
      const xVals = yields.map((_, i) => i);
      const xMean = (n - 1) / 2;
      const slopeNum = xVals.reduce((s, x, i) => s + (x - xMean) * (yields[i] - mean), 0);
      const slopeDen = xVals.reduce((s, x) => s + (x - xMean) ** 2, 0);
      const trendSlope = slopeDen > 0 ? slopeNum / slopeDen : 0;

      if (trendSlope < -0.5) {
        insights.push({ type: 'trend', title: 'Downward yield trend detected', description: `Yield is declining at ~${Math.abs(trendSlope).toFixed(2)}% per day.`, confidence: Math.min(0.95, 0.6 + Math.abs(trendSlope) * 0.1), severity: 'warning' });
      } else if (trendSlope > 0.3) {
        insights.push({ type: 'trend', title: 'Positive yield trend', description: `Yield is improving at ~${trendSlope.toFixed(2)}% per day.`, confidence: 0.7, severity: 'info' });
      }

      const cv = mean > 0 ? (stddev / mean) * 100 : 0;
      if (cv > 5) {
        insights.push({ type: 'volatility', title: 'High process variability', description: `CV is ${cv.toFixed(1)}%, indicating an unstable process.`, confidence: 0.85, severity: cv > 10 ? 'critical' : 'warning' });
      }

      if (n >= 14) {
        const lag = 7;
        const autoCorr = xVals.slice(lag).reduce((s, _, i) => s + (yields[i + lag] - mean) * (yields[i] - mean), 0) / yields.reduce((s, y) => s + (y - mean) ** 2, 0);
        if (Math.abs(autoCorr) > 0.5) {
          insights.push({ type: 'periodicity', title: 'Weekly pattern detected', description: `Autocorrelation at 7-day lag: r=${autoCorr.toFixed(2)}.`, confidence: Math.min(0.9, 0.5 + Math.abs(autoCorr) * 0.4), severity: 'info' });
        }
      }

      if (anomalies.length > 0) {
        insights.push({ type: 'anomaly', title: `${anomalies.length} anomalous day(s) detected`, description: `${anomalies.filter(a => a.type === 'unusually_low').length} unusually low.`, confidence: 0.9, severity: anomalies.some(a => a.type === 'unusually_low') ? 'warning' : 'info' });
      }

      if (cpk < 1) {
        insights.push({ type: 'capability', title: 'Process not capable', description: `Cpk = ${cpk.toFixed(2)} (target >= 1.33). Est. ${ppm} PPM defective.`, confidence: 0.95, severity: 'critical' });
      } else if (cpk < 1.33) {
        insights.push({ type: 'capability', title: 'Marginal process capability', description: `Cpk = ${cpk.toFixed(2)} — below 1.33 target.`, confidence: 0.9, severity: 'warning' });
      }

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startStr, endDate: endStr },
          anomalies,
          forecast,
          clusters,
          insights,
          processCapability: {
            cp: Math.round(cp * 100) / 100,
            cpk: Math.round(cpk * 100) / 100,
            ppm, usl: USL, lsl: LSL,
            mean: Math.round(mean * 100) / 100,
            stddev: Math.round(stddev * 100) / 100,
          },
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/ai-analysis error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get AI analysis data" });
    }
  });

  // ================================================================
  // GET /api/external/inspections/yield-comparison
  // Period-over-period yield comparison with change metrics
  // ================================================================
  app.get("/api/external/inspections/yield-comparison", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseIntParam(req.query.stationId);
      const productModelId = parseIntParam(req.query.productModelId);
      const productCode = req.query.productCode as string | undefined;
      const startDate = parseDateParam(req.query.startDate);
      const endDate = parseDateParam(req.query.endDate, true);

      if (!stationId) {
        return res.status(400).json({ success: false, message: "stationId is required" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ success: false, message: "Database unavailable" });

      let resolvedProductModelId = productModelId;
      if (!resolvedProductModelId && productCode) {
        const { getProductModelByCode } = await import("../db");
        const pm = await getProductModelByCode(productCode);
        if (pm) resolvedProductModelId = pm.id;
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      const pmFilter = resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``;

      // Calculate the duration for the comparison period
      const durationMs = endDate.getTime() - startDate.getTime();
      const prevStart = new Date(startDate.getTime() - durationMs);
      const prevEnd = new Date(startDate.getTime());
      const prevStartStr = prevStart.toISOString();
      const prevEndStr = prevEnd.toISOString();

      // Current period stats
      const currentResult = await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng,
          SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END) AS ntf,
          COALESCE(AVG(pi."cycleTime"), 0) AS "avgCycleTime"
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${pmFilter}
      `);

      // Previous period stats
      const prevResult = await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) AS ng,
          SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END) AS ntf,
          COALESCE(AVG(pi."cycleTime"), 0) AS "avgCycleTime"
        FROM product_inspections pi
        WHERE pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})
          AND pi."inspectionTime" >= ${prevStartStr}::timestamp
          AND pi."inspectionTime" < ${prevEndStr}::timestamp
          ${pmFilter}
      `);

      const curRows = (currentResult as any).rows || (currentResult as any);
      const prevRows = (prevResult as any).rows || (prevResult as any);
      const cur = (curRows as any[])[0] || {};
      const prev = (prevRows as any[])[0] || {};

      const curTotal = Number(cur.total) || 0;
      const curOk = Number(cur.ok) || 0;
      const curNg = Number(cur.ng) || 0;
      const curNtf = Number(cur.ntf) || 0;
      const curYield = curTotal > 0 ? (curOk / curTotal) * 100 : 0;
      const curCycleTime = Number(cur.avgCycleTime) || 0;

      const prevTotal = Number(prev.total) || 0;
      const prevOk = Number(prev.ok) || 0;
      const prevNg = Number(prev.ng) || 0;
      const prevNtf = Number(prev.ntf) || 0;
      const prevYield = prevTotal > 0 ? (prevOk / prevTotal) * 100 : 0;
      const prevCycleTime = Number(prev.avgCycleTime) || 0;

      const yieldChange = curYield - prevYield;
      const volumeChange = prevTotal > 0 ? ((curTotal - prevTotal) / prevTotal) * 100 : 0;
      const ngChange = prevNg > 0 ? ((curNg - prevNg) / prevNg) * 100 : 0;

      res.json({
        success: true,
        data: {
          currentPeriod: {
            startDate: startStr, endDate: endStr,
            total: curTotal, ok: curOk, ng: curNg, ntf: curNtf,
            yield: Math.round(curYield * 100) / 100,
            avgCycleTime: Math.round(curCycleTime * 100) / 100,
          },
          previousPeriod: {
            startDate: prevStartStr, endDate: prevEndStr,
            total: prevTotal, ok: prevOk, ng: prevNg, ntf: prevNtf,
            yield: Math.round(prevYield * 100) / 100,
            avgCycleTime: Math.round(prevCycleTime * 100) / 100,
          },
          changes: {
            yieldChange: Math.round(yieldChange * 100) / 100,
            yieldChangeDirection: yieldChange > 0 ? 'improved' : yieldChange < 0 ? 'declined' : 'unchanged',
            volumeChange: Math.round(volumeChange * 100) / 100,
            ngChange: Math.round(ngChange * 100) / 100,
            cycleTimeChange: Math.round((curCycleTime - prevCycleTime) * 100) / 100,
          },
        },
      });
    } catch (error: any) {
      console.error("[External] inspections/yield-comparison error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get yield comparison data" });
    }
  });
}
