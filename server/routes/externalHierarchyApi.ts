/**
 * /api/external/{hierarchy/*, statistics/measurement-points, dashboard/summary} — TRÍCH NGUYÊN VĂN từ server/_core/index.ts (2026-10-24) để đo được trên Express + CSDL thật
 * (index.ts không dựng được trong test). Hành vi giữ nguyên; phạm vi người gọi (rà bảo mật 2026-10-24) áp tại đây.
 */
import type express from "express";
import { getDb } from "../db";
import { docGioTuongNhaMay } from "../utils/factoryTime";
import { finalYield } from "../utils/kpi";
import { phamViGoiNgoai, nguoiXemCuaPhamVi, phamViDaAp, thanTuChoiPhamViNgoai } from "./_phamViNgoai";
import { idsCapExternal, idTrongPhamViExternal, andSanPhamTrongPhamVi } from "./phamViExternal";
import { congPhamVi } from "./externalAlertApi";
import { kyAnhTrongThan } from "../_core/anhKyUrl";

// BG-96: chuỗi người dùng gõ đọc theo giờ tường NHÀ MÁY (cùng bản trong _core/index.ts; call site đã guard isNaN).
function parseLocalDate(dateStr: string, endOfDay = false): Date {
  return docGioTuongNhaMay(dateStr, endOfDay) ?? new Date(NaN);
}

export function registerExternalHierarchyRoutes(app: express.Express, validateMasterKey: express.RequestHandler, validateExternalAuth: express.RequestHandler) {
  // ============================================================
  // Hierarchy Tree & MQTT — REST proxy for external apps
  // Supports: x-master-key header OR Authorization: Bearer <token>
  // ============================================================

  // GET /api/external/hierarchy/tree — Full hierarchy tree
  app.get("/api/external/hierarchy/tree", validateMasterKey, async (req, res) => {
    try {
      const { getFullHierarchyFlat } = await import("../db");
      const { buildHierarchyTree } = await import("../routers/hierarchyTreeRouter");
      // phạm vi người gọi (rà bảo mật 2026-10-24): master key/admin ⇒ không lọc; tài khoản Bearer ⇒ chỉ cây/topic/số đếm của nhà máy được gán; id ngoài phạm vi ⇒ 403 external_factory_scope_denied
      const pvNgoai = phamViGoiNgoai(req);
      const nhaMayTrongPhamVi = await idsCapExternal(nguoiXemCuaPhamVi(pvNgoai), "factory");
      const rows = (await getFullHierarchyFlat()).filter((r) => nhaMayTrongPhamVi === null || nhaMayTrongPhamVi.includes(r.factoryId));
      const tree = buildHierarchyTree(rows);
      res.json({ success: true, scopeApplied: phamViDaAp(pvNgoai), data: tree });
    } catch (error: any) {
      console.error("[External] hierarchy-tree error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get hierarchy tree" });
    }
  });

  // GET /api/external/hierarchy/factory/:factoryId — Single factory tree
  app.get("/api/external/hierarchy/factory/:factoryId", validateMasterKey, async (req, res) => {
    try {
      const factoryId = parseInt(req.params.factoryId, 10);
      if (isNaN(factoryId)) {
        return res.status(400).json({ success: false, message: "factoryId must be a number" });
      }
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (!(await idTrongPhamViExternal(nguoiXemNgoai, "factory", factoryId))) {
        return res.status(403).json(thanTuChoiPhamViNgoai("factory", String(factoryId)));
      }
      const { getFactoryHierarchyFlat } = await import("../db");
      const { buildHierarchyTree } = await import("../routers/hierarchyTreeRouter");
      const rows = await getFactoryHierarchyFlat(factoryId);
      const tree = buildHierarchyTree(rows as any);
      res.json({ success: true, data: tree[0] ?? null });
    } catch (error: any) {
      console.error("[External] factory-tree error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get factory tree" });
    }
  });

  // GET /api/external/hierarchy/mqtt-topics — Generate MQTT subscription topics
  app.get("/api/external/hierarchy/mqtt-topics", validateMasterKey, async (req, res) => {
    try {
      const level = (req.query.level as string) || "all";
      const validLevels = ["all", "factory", "workshop", "line", "station"];
      if (!validLevels.includes(level)) {
        return res.status(400).json({ success: false, message: `level must be one of: ${validLevels.join(", ")}` });
      }
      const factoryId = req.query.factoryId ? parseInt(req.query.factoryId as string, 10) : undefined;
      const workshopId = req.query.workshopId ? parseInt(req.query.workshopId as string, 10) : undefined;
      const lineId = req.query.lineId ? parseInt(req.query.lineId as string, 10) : undefined;
      const stationId = req.query.stationId ? parseInt(req.query.stationId as string, 10) : undefined;
      const messageTypes = req.query.messageTypes ? (req.query.messageTypes as string).split(",") : undefined;

      // phạm vi người gọi (rà bảo mật 2026-10-24): master key/admin ⇒ không lọc; tài khoản Bearer ⇒ chỉ cây/topic/số đếm của nhà máy được gán; id ngoài phạm vi ⇒ 403 external_factory_scope_denied
      const pvNgoai = phamViGoiNgoai(req);
      const nguoiXemNgoai = nguoiXemCuaPhamVi(pvNgoai);
      for (const [cap, id] of [["factory", factoryId], ["workshop", workshopId], ["line", lineId], ["station", stationId]] as const) {
        if (id !== undefined && !isNaN(id) && !(await idTrongPhamViExternal(nguoiXemNgoai, cap, id))) {
          return res.status(403).json(thanTuChoiPhamViNgoai(cap, String(id)));
        }
      }
      const nhaMayTrongPhamVi = await idsCapExternal(nguoiXemNgoai, "factory");
      const { getFullHierarchyFlat } = await import("../db");
      const { buildHierarchyTree, generateMqttTopicsForScope } = await import("../routers/hierarchyTreeRouter");
      const rows = (await getFullHierarchyFlat()).filter((r) => nhaMayTrongPhamVi === null || nhaMayTrongPhamVi.includes(r.factoryId));
      const tree = buildHierarchyTree(rows);
      const topics = generateMqttTopicsForScope(tree, { level, factoryId, workshopId, lineId, stationId }, messageTypes);
      res.json({ success: true, scopeApplied: phamViDaAp(pvNgoai), data: topics });
    } catch (error: any) {
      console.error("[External] mqtt-topics error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to generate MQTT topics" });
    }
  });

  // GET /api/external/hierarchy/mqtt-message-types — List all MQTT message types
  app.get("/api/external/hierarchy/mqtt-message-types", validateMasterKey, async (req, res) => {
    try {
      const { getMqttMessageTypesList } = await import("../routers/hierarchyTreeRouter");
      res.json({ success: true, data: getMqttMessageTypesList() });
    } catch (error: any) {
      console.error("[External] mqtt-message-types error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get message types" });
    }
  });

  // GET /api/external/hierarchy/summary — Hierarchy count summary
  app.get("/api/external/hierarchy/summary", validateMasterKey, async (req, res) => {
    try {
      const { getFullHierarchyFlat } = await import("../db");
      const { buildHierarchyTree } = await import("../routers/hierarchyTreeRouter");
      // phạm vi người gọi (rà bảo mật 2026-10-24)
      const pvNgoai = phamViGoiNgoai(req);
      const nhaMayTrongPhamVi = await idsCapExternal(nguoiXemCuaPhamVi(pvNgoai), "factory");
      const rows = (await getFullHierarchyFlat()).filter((r) => nhaMayTrongPhamVi === null || nhaMayTrongPhamVi.includes(r.factoryId));
      const tree = buildHierarchyTree(rows);

      let totalWorkshops = 0, totalLines = 0, totalStations = 0, totalMachines = 0;
      for (const factory of tree) {
        totalWorkshops += factory.workshops.length;
        for (const workshop of factory.workshops) {
          totalLines += workshop.lines.length;
          for (const line of workshop.lines) {
            totalStations += line.stations.length;
            for (const station of line.stations) {
              totalMachines += station.machines.length;
            }
          }
        }
      }

      res.json({
        success: true,
        scopeApplied: phamViDaAp(pvNgoai),
        data: { factories: tree.length, workshops: totalWorkshops, lines: totalLines, stations: totalStations, machines: totalMachines },
      });
    } catch (error: any) {
      console.error("[External] hierarchy-summary error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get hierarchy summary" });
    }
  });

  // ============================================================
  // Measurement Point Statistics API — for third-party integration
  // GET /api/external/statistics/measurement-points
  // Supports: x-master-key OR Authorization: Bearer <token>
  // ============================================================
  app.get("/api/external/statistics/measurement-points", validateExternalAuth, async (req, res) => {
    try {
      const productModelId = req.query.productModelId ? parseInt(req.query.productModelId as string, 10) : undefined;
      const productCode = req.query.productCode as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      // Validate required params
      if (!productModelId && !productCode) {
        return res.status(400).json({
          success: false,
          message: "Either productModelId or productCode is required",
        });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate are required (ISO 8601 format, e.g. 2025-01-01 or 2025-01-01T00:00:00Z)",
        });
      }

      // Parse dates
      const parsedStart = parseLocalDate(startDate);
      const parsedEnd = parseLocalDate(endDate);
      if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate must be valid ISO 8601 dates",
        });
      }
      if (parsedStart > parsedEnd) {
        return res.status(400).json({
          success: false,
          message: "startDate must be before or equal to endDate",
        });
      }

      const { getProductModelById, getProductModelByCode, getMeasurementPointStatsByProduct, getMeasurementPointImagesByProduct } = await import("../db");

      // Resolve product model
      let productModel: any = null;
      if (productModelId) {
        if (isNaN(productModelId)) {
          return res.status(400).json({ success: false, message: "productModelId must be a number" });
        }
        productModel = await getProductModelById(productModelId);
      } else if (productCode) {
        productModel = await getProductModelByCode(productCode);
      }

      if (!productModel) {
        return res.status(404).json({
          success: false,
          message: productModelId
            ? `Product model with ID ${productModelId} not found`
            : `Product model with code "${productCode}" not found`,
        });
      }

      // phạm vi người gọi (rà bảo mật 2026-10-24): master key/admin ⇒ không lọc; tài khoản Bearer ⇒ chỉ dữ liệu của nhà máy được gán; stationId ngoài phạm vi ⇒ 403 external_factory_scope_denied: sản phẩm ngoài phạm vi ⇒ 403; số đếm CHỈ tính kiểm tra của nhà máy được gán (các hàm thống kê nhận sẵn userId/userRole)
      const pvNgoai = phamViGoiNgoai(req);
      const nguoiXemNgoai = nguoiXemCuaPhamVi(pvNgoai);
      {
        const { sql } = await import("drizzle-orm");
        const { productModels } = await import("../../drizzle/schema");
        const congSp = await andSanPhamTrongPhamVi(nguoiXemNgoai, productModels.id);
        const db2 = await getDb();
        const trong = db2 ? await db2.execute(sql`SELECT 1 AS ok FROM product_models WHERE id = ${productModel.id} ${congSp} LIMIT 1`) : null;
        const trongRows = trong ? ((trong as any).rows || (trong as any)) : [];
        if ((trongRows as any[]).length === 0) return res.status(403).json(thanTuChoiPhamViNgoai("product", String(productModel.id)));
      }

      // Get statistics
      const stats = await getMeasurementPointStatsByProduct({
        productModelId: productModel.id,
        startDate: parsedStart,
        endDate: parsedEnd,
        ...(nguoiXemNgoai ?? {}),
      });

      // Optionally include images
      const includeImages = req.query.includeImages === "true" || req.query.includeImages === "1";
      let imagesByPoint: Record<number, { okImages: any[]; ngImages: any[] }> = {};
      if (includeImages) {
        imagesByPoint = await getMeasurementPointImagesByProduct({
          productModelId: productModel.id,
          startDate: parsedStart,
          endDate: parsedEnd,
          ...(nguoiXemNgoai ?? {}),
        });
      }

      const points = stats.map((point) => {
        const base: any = { ...point };
        if (includeImages) {
          const imgs = imagesByPoint[point.pointDefId] || { okImages: [], ngImages: [] };
          base.images = {
            okImages: imgs.okImages,
            ngImages: imgs.ngImages,
          };
        }
        return base;
      });

      // ★★★ NƠI CẤP VÉ. `points[].images.okImages[].imageUrl` / `.ngImages[].imageUrl` nằm sâu
      //     **bốn** tầng (`data.points[].images.*Images[].imageUrl`) và chỉ xuất hiện khi
      //     `?includeImages=true` — đúng loại trường mà một bộ ký theo-tên-trường sẽ bỏ sót.
      res.json(kyAnhTrongThan({
        success: true,
        scopeApplied: phamViDaAp(pvNgoai),
        data: {
          productModel: {
            id: productModel.id,
            code: productModel.code,
            name: productModel.name,
          },
          dateRange: {
            startDate: parsedStart.toISOString(),
            endDate: parsedEnd.toISOString(),
          },
          totalPoints: points.length,
          points,
        },
      }, "anh"));
    } catch (error: any) {
      console.error("[External] measurement-point-stats error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get measurement point statistics" });
    }
  });


  // ============================================================
  // Dashboard Summary API — for third-party KPI dashboard
  // GET /api/external/dashboard/summary
  // ============================================================
  app.get("/api/external/dashboard/summary", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { alertHistory, mqttAlertHistory, mqttConnectionAlerts, mqttBulletinHistory } = await import("../../drizzle/schema");
      // ★★★ 2026-08-18 — `and`/`isNull`/`eq` được nhập THÊM để thay ba template `sql` thô bên dưới.
      //
      // LỖI ĐÃ ĐO: tuyến này trả **500** và rò NGUYÊN VĂN câu SQL ra client. Gốc rễ là
      // `sql\`${cot} >= ${since}\`` — nội suy một **đối tượng `Date`** vào template THÔ của drizzle.
      // Template thô bind giá trị làm tham số mà **không** đi qua `mapToDriverValue` của cột, nên
      // `Date` tới thẳng bộ tuần tự hoá và ném `TypeError: The "string" argument must be of type
      // string … Received an instance of Date`.
      //
      // ⚠ Vì sao khó thấy: dòng NGAY TRÊN (`gte(alertHistory.createdAt, since)`) truyền **cùng một
      // biến `since`** và chạy tốt — helper có kiểu áp đúng mapper (Date → chuỗi ISO). Hai dòng
      // cạnh nhau, cùng một giá trị, một chạy một vỡ. Và chạy `sql.unsafe()` với chính câu ấy
      // ngoài app cũng **chạy được**, nên phép tái lập bằng driver trần khai VÔ CAN cho một lỗi có
      // thật — khác biệt nằm ở tầng drizzle, không ở tầng driver.
      const { sql, count, eq: eqOp, gte, and, isNull } = await import("drizzle-orm");

      // phạm vi người gọi (rà bảo mật 2026-10-24): master key/admin ⇒ không lọc; tài khoản Bearer ⇒ chỉ dữ liệu của nhà máy được gán; stationId ngoài phạm vi ⇒ 403 external_factory_scope_denied
      const pvNgoai = phamViGoiNgoai(req);
      const nguoiXemNgoai = nguoiXemCuaPhamVi(pvNgoai);
      const congAh = await congPhamVi(nguoiXemNgoai, "alert");
      const congMqtt = await congPhamVi(nguoiXemNgoai, "mqtt");
      const congConn = await congPhamVi(nguoiXemNgoai, "conn");
      const tramTrongPhamVi = await idsCapExternal(nguoiXemNgoai, "station");
      const congBulletin = tramTrongPhamVi === null ? undefined : (await import("drizzle-orm")).inArray(mqttBulletinHistory.stationId, tramTrongPhamVi.length > 0 ? tramTrongPhamVi : [-1]);

      // Default: today's summary
      const sinceParam = req.query.since as string | undefined;
      const since = sinceParam ? new Date(sinceParam) : new Date(new Date().setHours(0, 0, 0, 0));

      // Alert counts
      const [alertCount] = await database
        .select({ total: count() })
        .from(alertHistory)
        .where(and(gte(alertHistory.createdAt, since), congAh));

      const [alertPending] = await database
        .select({ total: count() })
        .from(alertHistory)
        .where(and(gte(alertHistory.createdAt, since), isNull(alertHistory.acknowledgedAt), congAh));

      // MQTT alert counts
      const [mqttAlertCount] = await database
        .select({ total: count() })
        .from(mqttAlertHistory)
        .where(and(gte(mqttAlertHistory.triggeredAt, since), congMqtt));

      const [mqttAlertPending] = await database
        .select({ total: count() })
        .from(mqttAlertHistory)
        .where(and(gte(mqttAlertHistory.triggeredAt, since), eqOp(mqttAlertHistory.isResolved, false), congMqtt));

      // Connection alert counts
      const [connAlertCount] = await database
        .select({ total: count() })
        .from(mqttConnectionAlerts)
        .where(and(gte(mqttConnectionAlerts.triggeredAt, since), congConn));

      const [connAlertPending] = await database
        .select({ total: count() })
        .from(mqttConnectionAlerts)
        .where(and(
          gte(mqttConnectionAlerts.triggeredAt, since),
          eqOp(mqttConnectionAlerts.isResolved, false),
          eqOp(mqttConnectionAlerts.isAcknowledged, false),
          congConn,
        ));

      // Recent bulletins count
      const [bulletinCount] = await database
        .select({ total: count() })
        .from(mqttBulletinHistory)
        .where(and(gte(mqttBulletinHistory.createdAt, since), congBulletin));

      res.json({
        success: true,
        scopeApplied: phamViDaAp(pvNgoai),
        data: {
          since: since.toISOString(),
          alerts: {
            total: (alertCount?.total || 0) + (mqttAlertCount?.total || 0) + (connAlertCount?.total || 0),
            pending: (alertPending?.total || 0) + (mqttAlertPending?.total || 0) + (connAlertPending?.total || 0),
            breakdown: {
              alertHistory: { total: alertCount?.total || 0, pending: alertPending?.total || 0 },
              mqttAlerts: { total: mqttAlertCount?.total || 0, pending: mqttAlertPending?.total || 0 },
              connectionAlerts: { total: connAlertCount?.total || 0, pending: connAlertPending?.total || 0 },
            },
          },
          bulletins: {
            total: bulletinCount?.total || 0,
          },
        },
      });
    } catch (error: any) {
      console.error("[External] dashboard summary error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get dashboard summary" });
    }
  });
}
