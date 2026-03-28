/**
 * External Inspection API — REST endpoints for third-party integration
 * 
 * All endpoints use /api/external/inspections/* prefix
 * Auth: x-master-key header OR Authorization: Bearer <token>
 * 
 * Endpoints:
 *   GET /api/external/inspections/summary        — Inspection summary by station/product/date range
 *   GET /api/external/inspections/trend           — Time-series OK/NG trend data (hour/day/week)
 *   GET /api/external/inspections/defect-pareto   — Defect Pareto analysis (NG by measurement point)
 *   GET /api/external/inspections/images          — Inspection images with filters (station/point/result)
 *   GET /api/external/inspections/events          — Package activity logs / inspection events
 *   GET /api/external/inspections/measurements    — Raw measurement values for a point over time
 *   GET /api/external/products                    — Product list (search, pagination)
 *   GET /api/external/products/:id                — Product detail with measurement points
 */
import express from "express";
import { sql } from "drizzle-orm";

// Helper: parse integer query param
function parseIntParam(val: unknown): number | undefined {
  if (val == null || val === "") return undefined;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? undefined : n;
}

// Helper: parse date query param
function parseDateParam(val: unknown): Date | undefined {
  if (val == null || val === "") return undefined;
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? undefined : d;
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
      const endDate = parseDateParam(req.query.endDate);

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
      const endDate = parseDateParam(req.query.endDate);
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
      const endDate = parseDateParam(req.query.endDate);
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
        WHERE mr.result = 'NG'
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${stationId ? sql`AND pi."machineId" IN (SELECT id FROM machines WHERE "stationId" = ${stationId})` : sql``}
          ${resolvedProductModelId ? sql`AND pi."productModelId" = ${resolvedProductModelId}` : sql``}
        GROUP BY mpd.id, mpd.code, mpd.name, mpd."measurementType"
        ORDER BY COUNT(mr.id) DESC
        LIMIT ${limit}
      `);

      const rows = (result as any).rows || (result as any);
      const items = (rows as any[]).map((r: any) => ({
        pointDefId: Number(r.pointDefId),
        pointCode: r.pointCode || "",
        pointName: r.pointName || "",
        measurementType: r.measurementType || "OTHER",
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
      const endDate = parseDateParam(req.query.endDate);
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
        ORDER BY pi."inspectionTime" DESC
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
      const endDate = parseDateParam(req.query.endDate);
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
      const endDate = parseDateParam(req.query.endDate);
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
        SELECT id, code, name, "measurementType", unit, "lowerLimit", "upperLimit", "nominalValue"
        FROM measurement_point_defs
        WHERE id = ${pointDefId}
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
          "imageWidth", "imageHeight",
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
          "referenceImageUrl", "imageWidth", "imageHeight",
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
}
