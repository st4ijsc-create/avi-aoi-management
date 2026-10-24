/**
 * /api/external/{stations*, workstations*} — TRÍCH NGUYÊN VĂN từ server/_core/index.ts (2026-10-24) để đo được trên Express + CSDL thật
 * (index.ts không dựng được trong test). Hành vi giữ nguyên; phạm vi người gọi (rà bảo mật 2026-10-24) áp tại đây.
 */
import type express from "express";
import { getDb } from "../db";
import { docGioTuongNhaMay } from "../utils/factoryTime";
import { appRouter } from "../routers";
import { createContext } from "../_core/context";
import { finalYield } from "../utils/kpi";
import { kyAnhTrongThan } from "../_core/anhKyUrl";
import type { PhamViNguoiXem } from "../db/hierarchy";
import { phamViGoiNgoai, nguoiXemCuaPhamVi, phamViDaAp as phamViDaApNgoai, thanTuChoiPhamViNgoai } from "./_phamViNgoai";
import { idsCapExternal, idTrongPhamViExternal } from "./phamViExternal";

/**
 * phạm vi người gọi (rà bảo mật 2026-10-24): master key/admin ⇒ không lọc; tài khoản Bearer ⇒ chỉ trạm/công trạm của nhà máy được gán; ngoài phạm vi ⇒ 403 external_factory_scope_denied
 * Trả `true` (đã gửi 403) nếu id (trạm | công trạm) client gửi nằm NGOÀI phạm vi; id không đọc được ⇒ `false` (handler tự trả 400 như cũ).
 */
async function chanNgoaiPhamVi(res: express.Response, nguoiXem: PhamViNguoiXem | undefined, cap: "station" | "workstation", idRaw: unknown): Promise<boolean> {
  const id = typeof idRaw === "number" ? idRaw : parseInt(String(idRaw), 10);
  if (!Number.isFinite(id)) return false;
  if (await idTrongPhamViExternal(nguoiXem, cap, id)) return false;
  res.status(403).json(thanTuChoiPhamViNgoai(cap === "station" ? "station" : "workstation", String(id)));
  return true;
}

// BG-96: chuỗi người dùng gõ đọc theo giờ tường NHÀ MÁY (cùng bản trong _core/index.ts; call site đã guard isNaN).
function parseLocalDate(dateStr: string, endOfDay = false): Date {
  return docGioTuongNhaMay(dateStr, endOfDay) ?? new Date(NaN);
}

export function registerExternalStationRoutes(app: express.Express, validateExternalAuth: express.RequestHandler) {
  // ============================================================
  // Station REST proxy — for third-party (non-tRPC) clients
  // GET /api/external/stations            — List all stations
  // GET /api/external/stations/resolve-topic — Resolve MQTT topic → station info
  // GET /api/external/stations/:id        — Get station by ID
  // GET /api/external/stations/:id/products — Products mapped to a station
  // GET /api/external/stations/:id/inspection-points — Get inspection points for station
  // GET /api/external/stations/:id/reference-image   — Get station reference image
  // ============================================================

  app.get("/api/external/stations", validateExternalAuth, async (req, res) => {
    try {
      const { getStations } = await import("../db");
      // ★★★ 2026-08-18 (§D · HẠNG 3) — bản đồ TRẠM của toàn bộ các nhà máy, cho bất kỳ tài khoản
      // nào đăng nhập được. `getStations` đã nhận `PhamViNguoiXem` từ đợt trả nợ tRPC; ở đây chỉ
      // là nối đúng trục ấy vào cửa REST, KHÔNG một dòng SQL phân cấp mới nào.
      const { phamViGoiNgoai, nguoiXemCuaPhamVi, phamViDaAp } = await import("../routes/_phamViNgoai");
      const phamVi = phamViGoiNgoai(req);
      const stations = await getStations(nguoiXemCuaPhamVi(phamVi));
      res.json({ success: true, scopeApplied: phamViDaAp(phamVi), data: stations });
    } catch (error: any) {
      console.error("[External] stations list error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get stations" });
    }
  });

  // GET /api/external/stations/resolve-topic?topic=avi/{fId}/workshop/{wId}/station/{sId}/errors
  // Parse MQTT topic string → return station info with full hierarchy
  // NOTE: Must be registered BEFORE /stations/:id to avoid "resolve-topic" matching as :id
  app.get("/api/external/stations/resolve-topic", validateExternalAuth, async (req, res) => {
    try {
      const topic = req.query.topic as string;
      if (!topic) {
        return res.status(400).json({ success: false, message: "Query param 'topic' is required (e.g. avi/1/workshop/2/station/3/errors)" });
      }

      // Pattern: avi/[factory/]{factoryId}/workshop/{workshopId}/station/{stationId}[/messageType]
      // Accept both legacy "avi/{fId}/..." and new "avi/factory/{fId}/..." formats
      // Also strip trailing MQTT wildcards (#, +) before matching
      const cleanedTopic = topic.replace(/\/[#+]$/, '');
      const match = cleanedTopic.match(/^avi\/(?:factory\/)?(\d+)\/workshop\/(\d+)\/station\/(\d+)(?:\/(.+))?$/);
      if (!match) {
        return res.status(400).json({
          success: false,
          message: "Invalid MQTT topic format. Expected: avi/{factoryId}/workshop/{workshopId}/station/{stationId}[/{messageType}]",
        });
      }

      const factoryId = parseInt(match[1], 10);
      const workshopId = parseInt(match[2], 10);
      const stationId = parseInt(match[3], 10);
      const messageType = match[4] || null;
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "station", stationId)) return;

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { stations, productionLines, workshops, factories } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      // Get station with full hierarchy in a single query
      const rows = await database
        .select({
          stationId: stations.id,
          stationCode: stations.code,
          stationName: stations.name,
          stationDescription: stations.description,
          lineId: productionLines.id,
          lineCode: productionLines.code,
          lineName: productionLines.name,
          workshopId: workshops.id,
          workshopCode: workshops.code,
          workshopName: workshops.name,
          factoryId: factories.id,
          factoryCode: factories.code,
          factoryName: factories.name,
        })
        .from(stations)
        .innerJoin(productionLines, eqOp(stations.lineId, productionLines.id))
        .innerJoin(workshops, eqOp(productionLines.workshopId, workshops.id))
        .innerJoin(factories, eqOp(workshops.factoryId, factories.id))
        .where(eqOp(stations.id, stationId))
        .limit(1);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: `Station ${stationId} not found` });
      }

      const row = rows[0];

      // Validate topic hierarchy matches DB
      if (row.factoryId !== factoryId || row.workshopId !== workshopId) {
        return res.status(400).json({
          success: false,
          message: "Topic hierarchy mismatch: factoryId or workshopId in topic does not match station's actual hierarchy",
          expected: { factoryId: row.factoryId, workshopId: row.workshopId },
          provided: { factoryId, workshopId },
        });
      }

      res.json({
        success: true,
        data: {
          station: { id: row.stationId, code: row.stationCode, name: row.stationName, description: row.stationDescription },
          line: { id: row.lineId, code: row.lineCode, name: row.lineName },
          workshop: { id: row.workshopId, code: row.workshopCode, name: row.workshopName },
          factory: { id: row.factoryId, code: row.factoryCode, name: row.factoryName },
          mqttTopic: topic,
          messageType,
        },
      });
    } catch (error: any) {
      console.error("[External] station resolve-topic error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to resolve MQTT topic" });
    }
  });

  app.get("/api/external/stations/:id", validateExternalAuth, async (req, res) => {
    try {
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "station", req.params.id)) return;
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { stations } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const rows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (rows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      res.json({ success: true, data: rows[0] });
    } catch (error: any) {
      console.error("[External] station detail error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get station" });
    }
  });

  app.get("/api/external/stations/:id/inspection-points", validateExternalAuth, async (req, res) => {
    try {
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "station", req.params.id)) return;
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      // Optional productModelId filter
      const productModelIdParam = req.query.productModelId as string | undefined;
      const filterProductModelId = productModelIdParam ? parseInt(productModelIdParam, 10) : null;
      if (productModelIdParam && (isNaN(filterProductModelId!) || filterProductModelId! <= 0)) {
        return res.status(400).json({ success: false, message: "Invalid productModelId" });
      }

      const { getMachinesByStation } = await import("../db");
      const { getMeasurementPointDefsByMachine, getMeasurementPointDefsByWorkstation } = await import("../db");

      // Verify station exists
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { stations } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machines for station, then get measurement point defs for each
      const stationMachines = await getMachinesByStation(stationId);
      const activeMachines = stationMachines.filter((m: any) => m.isActive);

      const allPoints: any[] = [];
      const seenPointIds = new Set<number>();
      for (const machine of activeMachines) {
        const points = await getMeasurementPointDefsByMachine(machine.id);
        for (const p of points) {
          if (seenPointIds.has(p.id)) continue;
          seenPointIds.add(p.id);
          allPoints.push({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            measurementType: p.measurementType,
            unit: p.unit,
            lowerLimit: p.lowerLimit != null ? Number(p.lowerLimit) : null,
            upperLimit: p.upperLimit != null ? Number(p.upperLimit) : null,
            nominalValue: p.nominalValue != null ? Number(p.nominalValue) : null,
            positionX: p.positionX,
            positionY: p.positionY,
            radius: p.radius,
            normalizedX: p.normalizedX != null ? Number(p.normalizedX) : null,
            normalizedY: p.normalizedY != null ? Number(p.normalizedY) : null,
            normalizedRadius: p.normalizedRadius != null ? Number(p.normalizedRadius) : null,
            cropWidth: p.cropWidth,
            cropHeight: p.cropHeight,
            referenceImageUrl: p.referenceImageUrl,
            workstationId: p.workstationId ?? null,
            productModelId: p.productModelId,
            imageWidth: null as number | null,
            imageHeight: null as number | null,
            imageDisplayMode: "contain" as string,
            machineId: machine.id,
            machineCode: machine.code,
            machineName: machine.name,
          });
        }
      }

      // Also get measurement point defs linked directly via workstationId (not through machine)
      const workstationPoints = await getMeasurementPointDefsByWorkstation(stationId);
      for (const p of workstationPoints) {
        if (seenPointIds.has(p.id)) continue;
        seenPointIds.add(p.id);
        // Find the machine for this point (if any) for display purposes
        const linkedMachine = activeMachines.find((m: any) => m.id === p.machineId);
        allPoints.push({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description,
          measurementType: p.measurementType,
          unit: p.unit,
          lowerLimit: p.lowerLimit != null ? Number(p.lowerLimit) : null,
          upperLimit: p.upperLimit != null ? Number(p.upperLimit) : null,
          nominalValue: p.nominalValue != null ? Number(p.nominalValue) : null,
          positionX: p.positionX,
          positionY: p.positionY,
          radius: p.radius,
          normalizedX: p.normalizedX != null ? Number(p.normalizedX) : null,
          normalizedY: p.normalizedY != null ? Number(p.normalizedY) : null,
          normalizedRadius: p.normalizedRadius != null ? Number(p.normalizedRadius) : null,
          cropWidth: p.cropWidth,
          cropHeight: p.cropHeight,
          referenceImageUrl: p.referenceImageUrl,
          workstationId: p.workstationId ?? null,
          productModelId: p.productModelId,
          imageWidth: null as number | null,
          imageHeight: null as number | null,
          imageDisplayMode: "contain" as string,
          machineId: linkedMachine?.id ?? null,
          machineCode: linkedMachine?.code ?? null,
          machineName: linkedMachine?.name ?? null,
        });
      }

      // Filter by productModelId if specified
      const pointsToReturn = filterProductModelId
        ? allPoints.filter(p => p.productModelId === filterProductModelId)
        : allPoints;

      // Batch-fetch product model image dimensions for scaling
      const uniqueModelIds = [...new Set(pointsToReturn.map(p => p.productModelId).filter(Boolean))] as number[];
      if (uniqueModelIds.length > 0) {
        const { productModels } = await import("../../drizzle/schema");
        const { inArray } = await import("drizzle-orm");
        const models = await database.select({
          id: productModels.id,
          imageWidth: productModels.imageWidth,
          imageHeight: productModels.imageHeight,
          imageDisplayMode: productModels.imageDisplayMode,
        }).from(productModels).where(inArray(productModels.id, uniqueModelIds));
        const modelMap = new Map(models.map(m => [m.id, { imageWidth: m.imageWidth, imageHeight: m.imageHeight, imageDisplayMode: m.imageDisplayMode }]));
        for (const p of pointsToReturn) {
          const model = modelMap.get(p.productModelId);
          if (model) {
            p.imageWidth = model.imageWidth;
            p.imageHeight = model.imageHeight;
            p.imageDisplayMode = model.imageDisplayMode || "contain";
          }
        }
      }

      // ★★★ NƠI CẤP VÉ. `validateExternalAuth` đã chạy ⇒ lượt gọi đã được chứng thực.
      //
      // ⚠⚠ ĐÂY LÀ VÍ DỤ MẪU CHO "VÌ SAO KÝ Ở BIÊN": `pointsToReturn` gộp từ **HAI** vòng lặp riêng
      //   (điểm-qua-máy và điểm-qua-workstation), mỗi vòng chép tay `referenceImageUrl` một lần.
      //   Ký từng trường sẽ phải nhớ sửa cả hai — và nhánh thứ ba của người sau sẽ lặng lẽ trả thô.
      res.json(
        kyAnhTrongThan(
          { success: true, data: pointsToReturn, total: pointsToReturn.length },
          "anh",
        ),
      );
    } catch (error: any) {
      console.error("[External] station inspection-points error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get inspection points" });
    }
  });

  // GET /api/external/stations/:id/products — Products mapped to a station (via its machines)
  app.get("/api/external/stations/:id/products", validateExternalAuth, async (req, res) => {
    try {
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "station", req.params.id)) return;
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { stations, machines, productMachineMappings, productModels } = await import("../../drizzle/schema");
      const { eq: eqOp, and: andOp, desc: descOp } = await import("drizzle-orm");

      // Verify station exists
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get products mapped to all machines of this station
      const rows = await database
        .select({
          productId: productModels.id,
          productCode: productModels.code,
          productName: productModels.name,
          description: productModels.description,
          category: productModels.category,
          lifecycleStatus: productModels.lifecycleStatus,
          referenceImageUrl: productModels.referenceImageUrl,
          imageWidth: productModels.imageWidth,
          imageHeight: productModels.imageHeight,
          targetYieldRate: productModels.targetYieldRate,
          minYieldRate: productModels.minYieldRate,
          machineId: machines.id,
          machineCode: machines.code,
          machineName: machines.name,
          mappingPriority: productMachineMappings.priority,
        })
        .from(productMachineMappings)
        .innerJoin(productModels, eqOp(productMachineMappings.productModelId, productModels.id))
        .innerJoin(machines, eqOp(productMachineMappings.machineId, machines.id))
        .where(andOp(
          eqOp(machines.stationId, stationId),
          eqOp(productModels.isActive, true),
        ))
        .orderBy(descOp(productMachineMappings.priority));

      // Group by product to avoid duplicates (same product via different machines)
      const productMap = new Map<number, any>();
      for (const r of rows) {
        if (!productMap.has(r.productId)) {
          productMap.set(r.productId, {
            id: r.productId,
            code: r.productCode,
            name: r.productName,
            description: r.description,
            category: r.category,
            lifecycleStatus: r.lifecycleStatus,
            hasReferenceImage: !!r.referenceImageUrl,
            imageWidth: r.imageWidth ? Number(r.imageWidth) : null,
            imageHeight: r.imageHeight ? Number(r.imageHeight) : null,
            targetYieldRate: r.targetYieldRate != null ? Number(r.targetYieldRate) : null,
            minYieldRate: r.minYieldRate != null ? Number(r.minYieldRate) : null,
            machines: [],
          });
        }
        productMap.get(r.productId).machines.push({
          id: r.machineId,
          code: r.machineCode,
          name: r.machineName,
          priority: r.mappingPriority ?? 0,
        });
      }

      const products = Array.from(productMap.values());
      res.json({
        success: true,
        data: {
          station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
          products,
          total: products.length,
        },
      });
    } catch (error: any) {
      console.error("[External] station products error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get station products" });
    }
  });

  app.get("/api/external/stations/:id/reference-image", validateExternalAuth, async (req, res) => {
    try {
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "station", req.params.id)) return;
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      // Find the latest product model assigned to this station's machine, then get its image
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { machines, stations } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      // Get station to verify it exists
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machines assigned to this station
      const machineRows = await database.select().from(machines).where(eqOp(machines.stationId, stationId));
      if (machineRows.length === 0) {
        return res.json({ success: true, data: { stationId, referenceImage: null, message: "No machine assigned to this station" } });
      }

      // Use tRPC to get the product image via the machine's current product
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      try {
        const machine = machineRows[0];
        const products = await caller.publicProductApi.listProducts({
          machineCode: machine.code,
          limit: 1,
        });
        if (products?.data?.length > 0) {
          const product = products.data[0];
          const image = await caller.publicProductApi.getProductImage({
            machineCode: machine.code,
            productCode: product.code,
          });
          return res.json({ success: true, data: { stationId, referenceImage: image } });
        }
      } catch {
        // fallback: no image
      }
      res.json({ success: true, data: { stationId, referenceImage: null, message: "No reference image available" } });
    } catch (error: any) {
      console.error("[External] station reference-image error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get reference image" });
    }
  });


  // ============================================================
  // Station Statistics APIs — per-station KPIs, measurement point stats, fail history
  // ============================================================

  // A7. GET /api/external/stations/:id/statistics — Station KPI summary
  app.get("/api/external/stations/:id/statistics", validateExternalAuth, async (req, res) => {
    try {
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "station", req.params.id)) return;
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      // Optional productModelId / productCode filter
      const productModelIdParam = req.query.productModelId as string | undefined;
      let filterProductModelId = productModelIdParam ? parseInt(productModelIdParam, 10) : null;
      if (productModelIdParam && (isNaN(filterProductModelId!) || filterProductModelId! <= 0)) {
        return res.status(400).json({ success: false, message: "Invalid productModelId" });
      }
      const productCodeFilter = (req.query.productCode as string) || null;

      const startDateStr = req.query.startDate as string | undefined;
      const endDateStr = req.query.endDate as string | undefined;
      if (!startDateStr || !endDateStr) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }
      const startDate = parseLocalDate(startDateStr);
      const endDate = parseLocalDate(endDateStr, true);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { machines, stations, productionLines, workshops, factories, productInspections, productModels } = await import("../../drizzle/schema");
      const { eq: eqOp, and: andOp, inArray, gte, lte, sql: sqlOp } = await import("drizzle-orm");

      // Resolve productModelId from productCode if not provided directly
      if (!filterProductModelId && productCodeFilter) {
        const pmByCode = await database.select({ id: productModels.id })
          .from(productModels).where(eqOp(productModels.code, productCodeFilter)).limit(1);
        if (pmByCode.length > 0) filterProductModelId = pmByCode[0].id;
      }

      // Verify station exists with hierarchy
      const stationRows = await database.select({
        station: stations,
        line: productionLines,
        workshop: workshops,
        factory: factories,
      })
        .from(stations)
        .innerJoin(productionLines, eqOp(stations.lineId, productionLines.id))
        .innerJoin(workshops, eqOp(productionLines.workshopId, workshops.id))
        .innerJoin(factories, eqOp(workshops.factoryId, factories.id))
        .where(eqOp(stations.id, stationId))
        .limit(1);

      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });
      const row = stationRows[0];

      // Get machine IDs for this station
      const machineRows = await database.select({ id: machines.id }).from(machines).where(eqOp(machines.stationId, stationId));
      const machineIds = machineRows.map((r: any) => r.id);

      if (machineIds.length === 0) {
        return res.json({
          success: true,
          data: {
            station: { id: row.station.id, code: row.station.code, name: row.station.name },
            factory: { id: row.factory.id, code: row.factory.code, name: row.factory.name },
            workshop: { id: row.workshop.id, code: row.workshop.code, name: row.workshop.name },
            line: { id: row.line.id, code: row.line.code, name: row.line.name },
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            machineCount: 0,
            totalInspections: 0, okCount: 0, ngCount: 0, ntfCount: 0,
            firstPassYield: 0, finalYield: 0, retestRate: 0, yieldChange: 0,
          },
        });
      }

      // Current period stats
      // Use raw SQL with ::timestamp to avoid pg driver local-time serialization bug
      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      const statsConditions = [
        inArray(productInspections.machineId, machineIds),
        sqlOp`${productInspections.inspectionTime} >= ${startStr}::timestamp`,
        sqlOp`${productInspections.inspectionTime} <= ${endStr}::timestamp`,
      ];
      if (filterProductModelId) {
        statsConditions.push(eqOp(productInspections.productModelId, filterProductModelId));
      }
      const stats = await database.select({
        total: sqlOp<number>`count(*)`,
        ok: sqlOp<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sqlOp<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
        ntf: sqlOp<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
      }).from(productInspections).where(andOp(...statsConditions));

      const t = Number(stats[0]?.total) || 0;
      const ok = Number(stats[0]?.ok) || 0;
      const ng = Number(stats[0]?.ng) || 0;
      const ntf = Number(stats[0]?.ntf) || 0;

      const fpy = t > 0 ? Math.round((ok / t) * 10000) / 100 : 0;
      const fy = Math.round(finalYield({ ok, ntf, total: t }) * 100) / 100;
      const retest = t > 0 ? Math.round((ntf / t) * 10000) / 100 : 0;

      // Previous period yield change
      const duration = endDate.getTime() - startDate.getTime();
      const prevEnd = new Date(startDate.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - duration);
      const prevStartStr = prevStart.toISOString();
      const prevEndStr = prevEnd.toISOString();
      const prevConditions = [
        inArray(productInspections.machineId, machineIds),
        sqlOp`${productInspections.inspectionTime} >= ${prevStartStr}::timestamp`,
        sqlOp`${productInspections.inspectionTime} <= ${prevEndStr}::timestamp`,
      ];
      if (filterProductModelId) {
        prevConditions.push(eqOp(productInspections.productModelId, filterProductModelId));
      }
      const prev = await database.select({
        total: sqlOp<number>`count(*)`,
        ok: sqlOp<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
      }).from(productInspections).where(andOp(...prevConditions));

      const pt = Number(prev[0]?.total) || 0;
      const po = Number(prev[0]?.ok) || 0;
      const prevFPY = pt > 0 ? (po / pt) * 100 : 0;
      const yieldChange = Math.round((fpy - prevFPY) * 100) / 100;

      res.json({
        success: true,
        data: {
          station: { id: row.station.id, code: row.station.code, name: row.station.name },
          factory: { id: row.factory.id, code: row.factory.code, name: row.factory.name },
          workshop: { id: row.workshop.id, code: row.workshop.code, name: row.workshop.name },
          line: { id: row.line.id, code: row.line.code, name: row.line.name },
          dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
          machineCount: machineIds.length,
          totalInspections: t,
          okCount: ok,
          ngCount: ng,
          ntfCount: ntf,
          firstPassYield: fpy,
          finalYield: fy,
          retestRate: retest,
          yieldChange,
        },
      });
    } catch (error: any) {
      console.error("[External] station statistics error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get station statistics" });
    }
  });

  // A8. GET /api/external/stations/:id/measurement-stats — Per-measurement-point stats
  app.get("/api/external/stations/:id/measurement-stats", validateExternalAuth, async (req, res) => {
    try {
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "station", req.params.id)) return;
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      const startDateStr = req.query.startDate as string | undefined;
      const endDateStr = req.query.endDate as string | undefined;
      if (!startDateStr || !endDateStr) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }
      const startDate = parseLocalDate(startDateStr);
      const endDate = parseLocalDate(endDateStr, true);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const groupBy = (req.query.groupBy as string) || "none"; // none | hour | day | week
      if (!["none", "hour", "day", "week"].includes(groupBy)) {
        return res.status(400).json({ success: false, message: "groupBy must be one of: none, hour, day, week" });
      }

      // Optional: filter by productModelId or productCode
      const productModelIdParam = req.query.productModelId as string | undefined;
      const productCodeFilter = (req.query.productCode as string) || null;
      let filterProductModelId = productModelIdParam ? parseInt(productModelIdParam, 10) : null;
      if (productModelIdParam && (isNaN(filterProductModelId!) || filterProductModelId! <= 0)) {
        return res.status(400).json({ success: false, message: "Invalid productModelId" });
      }

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { machines, stations, productModels } = await import("../../drizzle/schema");
      const { eq: eqOp, sql: sqlOp } = await import("drizzle-orm");

      // Resolve productCode to productModelId if needed
      if (!filterProductModelId && productCodeFilter) {
        const pmRows = await database.select({ id: productModels.id }).from(productModels).where(eqOp(productModels.code, productCodeFilter)).limit(1);
        if (pmRows.length > 0) filterProductModelId = pmRows[0].id;
      }

      // Verify station exists
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machine IDs
      const machineRows = await database.select({ id: machines.id }).from(machines).where(eqOp(machines.stationId, stationId));
      const machineIds = machineRows.map((r: any) => r.id);

      if (machineIds.length === 0) {
        return res.json({ success: true, data: { dateRange: { startDate: startDateStr, endDate: endDateStr }, points: [] } });
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      const machineIdList = machineIds.join(",");

      const productFilter = filterProductModelId ? sqlOp`AND mpd."productModelId" = ${filterProductModelId}` : sqlOp``;

      if (groupBy === "none") {
        // Aggregated stats per measurement point (no time breakdown)
        const result = await database.execute(sqlOp`
          SELECT
            mpd.id AS "pointDefId",
            mpd.code AS "pointCode",
            mpd.name AS "pointName",
            mpd."measurementType",
            mpd."workstationId",
            mpd."productModelId",
            pm.code AS "productCode",
            pm.name AS "productName",
            COUNT(mr.id) AS "totalChecks",
            SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END) AS "okCount",
            SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) AS "ngCount",
            SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END) AS "ntfCount",
            COALESCE(ROUND(
              SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0
              / NULLIF(COUNT(mr.id), 0), 2
            ), 0) AS "ngRate",
            COALESCE(AVG(mr."measuredValue"::numeric), 0) AS "avgValue",
            COALESCE(MIN(mr."measuredValue"::numeric), 0) AS "minValue",
            COALESCE(MAX(mr."measuredValue"::numeric), 0) AS "maxValue",
            (SELECT COUNT(mr2.id) FROM measurement_results mr2
              INNER JOIN product_inspections pi2 ON mr2."inspectionId" = pi2.id
              WHERE mr2."pointDefId" = mpd.id
                AND mr2.result = 'NG'
                AND mr2."imageUrl" IS NOT NULL AND mr2."imageUrl" != ''
                AND pi2."machineId" = ANY(ARRAY[${sqlOp.raw(machineIdList)}])
                AND pi2."inspectionTime" >= ${startStr}::timestamp
                AND pi2."inspectionTime" <= ${endStr}::timestamp
            ) AS "ngImageCount"
          FROM measurement_results mr
          INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
          INNER JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
          LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
          WHERE pi."machineId" = ANY(ARRAY[${sqlOp.raw(machineIdList)}])
            AND pi."inspectionTime" >= ${startStr}::timestamp
            AND pi."inspectionTime" <= ${endStr}::timestamp
            ${productFilter}
          GROUP BY mpd.id, mpd.code, mpd.name, mpd."measurementType", mpd."workstationId",
                   mpd."productModelId", pm.code, pm.name
          ORDER BY COUNT(mr.id) DESC
        `);

        const rows = (result as any).rows || (result as any);
        const points = (rows as any[]).map((r: any) => ({
          pointDefId: Number(r.pointDefId),
          pointCode: r.pointCode || "",
          pointName: r.pointName || "",
          measurementType: r.measurementType || "OTHER",
          workstationId: r.workstationId != null ? Number(r.workstationId) : null,
          productModelId: r.productModelId != null ? Number(r.productModelId) : null,
          productCode: r.productCode || null,
          productName: r.productName || null,
          totalChecks: Number(r.totalChecks),
          okCount: Number(r.okCount),
          ngCount: Number(r.ngCount),
          ntfCount: Number(r.ntfCount),
          ngRate: Number(r.ngRate),
          avgValue: r.avgValue != null ? Number(Number(r.avgValue).toFixed(6)) : null,
          minValue: r.minValue != null ? Number(Number(r.minValue).toFixed(6)) : null,
          maxValue: r.maxValue != null ? Number(Number(r.maxValue).toFixed(6)) : null,
          ngImageCount: Number(r.ngImageCount || 0),
        }));

        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startStr, endDate: endStr },
            station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
            points,
          },
        });
      }

      // Time-series stats per measurement point (groupBy = hour | day | week)
      const dateTrunc = groupBy === "hour" ? "hour" : groupBy === "week" ? "week" : "day";

      const dateTruncLiteral = sqlOp.raw(`'${dateTrunc}'`);
      const result = await database.execute(sqlOp`
        SELECT
          mpd.id AS "pointDefId",
          mpd.code AS "pointCode",
          mpd.name AS "pointName",
          mpd."measurementType",
          mpd."workstationId",
          mpd."productModelId",
          pm.code AS "productCode",
          pm.name AS "productName",
          date_trunc(${dateTruncLiteral}, pi."inspectionTime") AS "period",
          COUNT(mr.id) AS "totalChecks",
          SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END) AS "okCount",
          SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) AS "ngCount",
          COALESCE(ROUND(
            SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(mr.id), 0), 2
          ), 0) AS "ngRate",
          COALESCE(AVG(mr."measuredValue"::numeric), 0) AS "avgValue"
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        INNER JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
        LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
        WHERE pi."machineId" = ANY(ARRAY[${sqlOp.raw(machineIdList)}])
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${productFilter}
        GROUP BY mpd.id, mpd.code, mpd.name, mpd."measurementType", mpd."workstationId",
                 mpd."productModelId", pm.code, pm.name,
                 date_trunc(${dateTruncLiteral}, pi."inspectionTime")
        ORDER BY mpd.code, "period"
      `);

      const rows = (result as any).rows || (result as any);

      // Group by pointDefId → { point info, trend: [...] }
      const pointMap = new Map<number, any>();
      for (const r of rows as any[]) {
        const pid = Number(r.pointDefId);
        if (!pointMap.has(pid)) {
          pointMap.set(pid, {
            pointDefId: pid,
            pointCode: r.pointCode || "",
            pointName: r.pointName || "",
            measurementType: r.measurementType || "OTHER",
            workstationId: r.workstationId != null ? Number(r.workstationId) : null,
            productModelId: r.productModelId != null ? Number(r.productModelId) : null,
            productCode: r.productCode || null,
            productName: r.productName || null,
            trend: [],
          });
        }
        pointMap.get(pid).trend.push({
          period: r.period,
          totalChecks: Number(r.totalChecks),
          okCount: Number(r.okCount),
          ngCount: Number(r.ngCount),
          ngRate: Number(r.ngRate),
          avgValue: r.avgValue != null ? Number(Number(r.avgValue).toFixed(6)) : null,
        });
      }

      res.json({
        success: true,
        data: {
          groupBy,
          dateRange: { startDate: startStr, endDate: endStr },
          station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
          points: Array.from(pointMap.values()),
        },
      });
    } catch (error: any) {
      console.error("[External] station measurement-stats error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get measurement stats" });
    }
  });

  // A9. GET /api/external/stations/:id/fail-history — Recent NG inspections with failed point details
  app.get("/api/external/stations/:id/fail-history", validateExternalAuth, async (req, res) => {
    try {
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "station", req.params.id)) return;
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      // Optional productModelId or productCode filter
      const productModelIdParam = req.query.productModelId as string | undefined;
      const productCodeFilter = (req.query.productCode as string) || null;
      let filterProductModelId = productModelIdParam ? parseInt(productModelIdParam, 10) : null;
      if (productModelIdParam && (isNaN(filterProductModelId!) || filterProductModelId! <= 0)) {
        return res.status(400).json({ success: false, message: "Invalid productModelId" });
      }

      const startDateStr = req.query.startDate as string | undefined;
      const endDateStr = req.query.endDate as string | undefined;
      if (!startDateStr || !endDateStr) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }
      const startDate = parseLocalDate(startDateStr);
      const endDate = parseLocalDate(endDateStr, true);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const limitParam = parseInt(req.query.limit as string, 10);
      const limit = isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 200);
      const offsetParam = parseInt(req.query.offset as string, 10);
      const offset = isNaN(offsetParam) ? 0 : Math.max(offsetParam, 0);

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { machines, stations, productInspections, measurementResults, measurementPointDefs, productModels } = await import("../../drizzle/schema");
      const { eq: eqOp, and: andOp, inArray, gte, lte, desc: descOp } = await import("drizzle-orm");

      // Resolve productCode to productModelId if needed
      if (!filterProductModelId && productCodeFilter) {
        const pmRows = await database.select({ id: productModels.id }).from(productModels).where(eqOp(productModels.code, productCodeFilter)).limit(1);
        if (pmRows.length > 0) filterProductModelId = pmRows[0].id;
      }

      // Verify station exists
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machine IDs
      const machineRows = await database.select({ id: machines.id }).from(machines).where(eqOp(machines.stationId, stationId));
      const machineIds = machineRows.map((r: any) => r.id);

      if (machineIds.length === 0) {
        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            pagination: { total: 0, limit, offset, hasMore: false },
            inspections: [],
          },
        });
      }

      // Count total NG inspections
      const { sql: sqlOp } = await import("drizzle-orm");
      const failStartStr = startDate.toISOString();
      const failEndStr = endDate.toISOString();
      const failConditions = [
        inArray(productInspections.machineId, machineIds),
        eqOp(productInspections.overallResult, "NG"),
        sqlOp`${productInspections.inspectionTime} >= ${failStartStr}::timestamp`,
        sqlOp`${productInspections.inspectionTime} <= ${failEndStr}::timestamp`,
      ];
      if (filterProductModelId) {
        failConditions.push(eqOp(productInspections.productModelId, filterProductModelId));
      }
      const countResult = await database.select({
        total: sqlOp<number>`count(*)`,
      }).from(productInspections).where(andOp(...failConditions));
      const total = Number(countResult[0]?.total) || 0;

      // Get NG inspections with pagination
      const inspections = await database.select({
        id: productInspections.id,
        serialNumber: productInspections.serialNumber,
        inspectionTime: productInspections.inspectionTime,
        overallResult: productInspections.overallResult,
        machineId: productInspections.machineId,
        machineCode: machines.code,
        machineName: machines.name,
        productModelId: productInspections.productModelId,
      })
        .from(productInspections)
        .innerJoin(machines, eqOp(productInspections.machineId, machines.id))
        .where(andOp(...failConditions))
        .orderBy(descOp(productInspections.inspectionTime))
        .limit(limit)
        .offset(offset);

      if (inspections.length === 0) {
        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            pagination: { total, limit, offset, hasMore: false },
            inspections: [],
          },
        });
      }

      // Get failed measurement points for these inspections
      const inspIds = inspections.map(i => i.id);
      const measResults = await database.select({
        inspectionId: measurementResults.inspectionId,
        pointDefId: measurementResults.pointDefId,
        result: measurementResults.result,
        measuredValue: measurementResults.measuredValue,
        imageUrl: measurementResults.imageUrl,
        pointCode: measurementPointDefs.code,
        pointName: measurementPointDefs.name,
        workstationId: measurementPointDefs.workstationId,
        positionX: measurementPointDefs.positionX,
        positionY: measurementPointDefs.positionY,
        radius: measurementPointDefs.radius,
        normalizedX: measurementPointDefs.normalizedX,
        normalizedY: measurementPointDefs.normalizedY,
        normalizedRadius: measurementPointDefs.normalizedRadius,
      })
        .from(measurementResults)
        .innerJoin(measurementPointDefs, eqOp(measurementResults.pointDefId, measurementPointDefs.id))
        .where(andOp(
          inArray(measurementResults.inspectionId, inspIds),
          eqOp(measurementResults.result, "NG"),
        ));

      const measMap = new Map<number, any[]>();
      for (const m of measResults) {
        const arr = measMap.get(m.inspectionId) || [];
        arr.push({
          pointDefId: m.pointDefId,
          pointCode: m.pointCode || "",
          pointName: m.pointName || "",
          measuredValue: m.measuredValue,
          imageUrl: m.imageUrl || null,
          workstationId: m.workstationId ?? null,
          positionX: m.positionX,
          positionY: m.positionY,
          radius: m.radius,
          normalizedX: m.normalizedX != null ? Number(m.normalizedX) : null,
          normalizedY: m.normalizedY != null ? Number(m.normalizedY) : null,
          normalizedRadius: m.normalizedRadius != null ? Number(m.normalizedRadius) : null,
        });
        measMap.set(m.inspectionId, arr);
      }

      // Batch-fetch product model image dimensions for scaling
      const uniquePmIds = [...new Set(inspections.map(i => i.productModelId).filter(Boolean))] as number[];
      const pmDimMap = new Map<number, { imageWidth: number | null; imageHeight: number | null; imageDisplayMode: string }>();
      if (uniquePmIds.length > 0) {
        const pmDims = await database.select({
          id: productModels.id,
          imageWidth: productModels.imageWidth,
          imageHeight: productModels.imageHeight,
          imageDisplayMode: productModels.imageDisplayMode,
        }).from(productModels).where(inArray(productModels.id, uniquePmIds));
        for (const pm of pmDims) {
          pmDimMap.set(pm.id, { imageWidth: pm.imageWidth, imageHeight: pm.imageHeight, imageDisplayMode: pm.imageDisplayMode || "contain" });
        }
      }

      const data = inspections.map(insp => {
        const pmDim = insp.productModelId ? pmDimMap.get(insp.productModelId) : null;
        return {
          inspectionId: insp.id,
          serialNumber: insp.serialNumber || "",
          inspectionTime: insp.inspectionTime,
          machineId: insp.machineId,
          machineCode: insp.machineCode || "",
          machineName: insp.machineName || "",
          productModelId: insp.productModelId,
          imageWidth: pmDim?.imageWidth ?? null,
          imageHeight: pmDim?.imageHeight ?? null,
          imageDisplayMode: pmDim?.imageDisplayMode ?? "contain",
          failedPoints: measMap.get(insp.id) || [],
        };
      });

      // ★★★ NƠI CẤP VÉ — `inspections[].failedPoints[].imageUrl` (`measurement_results.imageUrl`).
      res.json(kyAnhTrongThan({
        success: true,
        data: {
          dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
          pagination: { total, limit, offset, hasMore: offset + limit < total },
          inspections: data,
        },
      }, "anh"));
    } catch (error: any) {
      console.error("[External] station fail-history error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get fail history" });
    }
  });

  // A10. GET /api/external/stations/:id/point-detail — Per-point stats + NG images (like StationAnalysis Station Detail)
  app.get("/api/external/stations/:id/point-detail", validateExternalAuth, async (req, res) => {
    try {
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "station", req.params.id)) return;
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      const startDateStr = req.query.startDate as string | undefined;
      const endDateStr = req.query.endDate as string | undefined;
      if (!startDateStr || !endDateStr) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }
      const startDate = parseLocalDate(startDateStr);
      const endDate = parseLocalDate(endDateStr, true);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const productModelIdParam = parseInt(req.query.productModelId as string, 10);
      const productModelIdFilter = isNaN(productModelIdParam) ? null : productModelIdParam;
      const productCodeFilter = (req.query.productCode as string) || null;
      const pointDefIdParam = parseInt(req.query.pointDefId as string, 10);
      const pointDefIdFilter = isNaN(pointDefIdParam) ? null : pointDefIdParam;
      const imageLimitParam = parseInt(req.query.imageLimit as string, 10);
      const imageLimit = isNaN(imageLimitParam) ? 10 : Math.min(Math.max(imageLimitParam, 1), 50);

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const {
        machines, stations, productInspections, measurementResults,
        measurementPointDefs, productModels,
      } = await import("../../drizzle/schema");
      const {
        eq: eqOp, and: andOp, inArray, gte, lte, desc: descOp,
        sql: sqlOp, asc: ascOp, isNotNull,
      } = await import("drizzle-orm");

      // Verify station
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machine IDs
      const machineRows = await database.select({ id: machines.id }).from(machines)
        .where(andOp(eqOp(machines.stationId, stationId), eqOp(machines.isActive, true)));
      const machineIds = machineRows.map((r: any) => r.id);

      if (machineIds.length === 0) {
        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
            productImage: null,
            boardInfo: null,
            points: [],
          },
        });
      }

      // Build inspection conditions — use raw SQL to avoid pg driver local-time serialization bug
      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      const inspConds: any[] = [
        inArray(productInspections.machineId, machineIds),
        sqlOp`${productInspections.inspectionTime} >= ${startStr}::timestamp`,
        sqlOp`${productInspections.inspectionTime} <= ${endStr}::timestamp`,
      ];

      // Resolve product model filter
      let resolvedProductModelId = productModelIdFilter;
      if (!resolvedProductModelId && productCodeFilter) {
        const pmByCode = await database.select({ id: productModels.id })
          .from(productModels).where(eqOp(productModels.code, productCodeFilter)).limit(1);
        if (pmByCode.length > 0) resolvedProductModelId = pmByCode[0].id;
      }

      if (resolvedProductModelId) {
        inspConds.push(eqOp(productInspections.productModelId, resolvedProductModelId));
      }

      // Determine the primary product model (most used in range, or the specified one)
      let primaryModelId = resolvedProductModelId;
      if (!primaryModelId) {
        const pmRows = await database.select({
          modelId: productInspections.productModelId,
          cnt: sqlOp<number>`count(*)`.as('cnt'),
        })
          .from(productInspections)
          .where(andOp(...inspConds))
          .groupBy(productInspections.productModelId)
          .orderBy(descOp(sqlOp`count(*)`))
          .limit(1);
        primaryModelId = pmRows.length > 0 ? pmRows[0].modelId : null;
      }

      // Fetch product model info (reference image)
      let productImage: { url: string | null; width: number | null; height: number | null; imageDisplayMode: string } | null = null;
      let boardInfo: { model: string; code: string } | null = null;
      if (primaryModelId) {
        const pm = await database.select({
          code: productModels.code, name: productModels.name,
          imageUrl: productModels.referenceImageUrl,
          imageWidth: productModels.imageWidth, imageHeight: productModels.imageHeight,
          imageDisplayMode: productModels.imageDisplayMode,
        }).from(productModels).where(eqOp(productModels.id, primaryModelId)).limit(1);
        if (pm.length > 0) {
          productImage = { url: pm[0].imageUrl, width: pm[0].imageWidth, height: pm[0].imageHeight, imageDisplayMode: pm[0].imageDisplayMode || "contain" };
          boardInfo = { model: pm[0].name, code: pm[0].code };
        }
      }

      // Fetch measurement point definitions by machineId
      const pointDefConds: any[] = [
        inArray(measurementPointDefs.machineId, machineIds),
        eqOp(measurementPointDefs.isActive, true),
      ];
      if (pointDefIdFilter) pointDefConds.push(eqOp(measurementPointDefs.id, pointDefIdFilter));

      let allPointDefs: any[] = await database.select().from(measurementPointDefs)
        .where(andOp(...pointDefConds)).orderBy(ascOp(measurementPointDefs.orderIndex));

      // Also fetch by workstationId = stationId (points linked to workstation, not machine)
      const wsConds: any[] = [
        eqOp(measurementPointDefs.workstationId, stationId),
        eqOp(measurementPointDefs.isActive, true),
      ];
      if (pointDefIdFilter) wsConds.push(eqOp(measurementPointDefs.id, pointDefIdFilter));
      const wsPointDefs = await database.select().from(measurementPointDefs)
        .where(andOp(...wsConds)).orderBy(ascOp(measurementPointDefs.orderIndex));

      // Merge machineId + workstationId points with dedup
      const seenPointIds = new Set(allPointDefs.map((p: any) => p.id));
      for (const wp of wsPointDefs) {
        if (!seenPointIds.has(wp.id)) {
          allPointDefs.push(wp);
          seenPointIds.add(wp.id);
        }
      }

      // Always merge product model points (not just fallback) to include points without machineId
      if (primaryModelId) {
        const pmConds: any[] = [
          eqOp(measurementPointDefs.productModelId, primaryModelId),
          eqOp(measurementPointDefs.isActive, true),
        ];
        if (pointDefIdFilter) pmConds.push(eqOp(measurementPointDefs.id, pointDefIdFilter));
        const pmPointDefs = await database.select().from(measurementPointDefs)
          .where(andOp(...pmConds)).orderBy(ascOp(measurementPointDefs.orderIndex));
        for (const pp of pmPointDefs) {
          if (!seenPointIds.has(pp.id)) {
            allPointDefs.push(pp);
            seenPointIds.add(pp.id);
          }
        }
      }

      if (allPointDefs.length === 0) {
        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
            productImage, boardInfo, points: [],
          },
        });
      }

      const pointDefIds = allPointDefs.map((p: any) => p.id);

      // Per-point statistics
      const pointStats = await database.select({
        pointDefId: measurementResults.pointDefId,
        total: sqlOp<number>`count(*)`.as('total'),
        ng: sqlOp<number>`sum(case when ${measurementResults.result} = 'NG' then 1 else 0 end)`.as('ng'),
        ntf: sqlOp<number>`sum(case when ${measurementResults.result} = 'NTF' then 1 else 0 end)`.as('ntf'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eqOp(measurementResults.inspectionId, productInspections.id))
        .where(andOp(inArray(measurementResults.pointDefId, pointDefIds), ...inspConds))
        .groupBy(measurementResults.pointDefId);

      const statsMap = new Map<number, { total: number; ng: number; ntf: number }>(
        pointStats.map((s: any) => [s.pointDefId, { total: Number(s.total), ng: Number(s.ng), ntf: Number(s.ntf) }])
      );

      // Last measurement per point
      const lastMeasurements = await database.select({
        pointDefId: measurementResults.pointDefId,
        measuredValue: measurementResults.measuredValue,
        measuredValueText: measurementResults.measuredValueText,
        result: measurementResults.result,
      })
        .from(measurementResults)
        .innerJoin(productInspections, eqOp(measurementResults.inspectionId, productInspections.id))
        .where(andOp(inArray(measurementResults.pointDefId, pointDefIds), ...inspConds))
        .orderBy(descOp(productInspections.inspectionTime))
        .limit(pointDefIds.length);

      const lastMeasMap = new Map<number, { value: string; result: string }>();
      for (const m of lastMeasurements) {
        if (!lastMeasMap.has(m.pointDefId)) {
          lastMeasMap.set(m.pointDefId, {
            value: m.measuredValueText || (m.measuredValue != null ? String(m.measuredValue) : '—'),
            result: m.result,
          });
        }
      }

      // NG error images per point (up to imageLimit per point)
      const ngImages = await database.select({
        id: measurementResults.id,
        pointDefId: measurementResults.pointDefId,
        imageUrl: measurementResults.imageUrl,
        measuredValue: measurementResults.measuredValue,
        measuredValueText: measurementResults.measuredValueText,
        result: measurementResults.result,
        inspectionTime: productInspections.inspectionTime,
        serialNumber: productInspections.serialNumber,
      })
        .from(measurementResults)
        .innerJoin(productInspections, eqOp(measurementResults.inspectionId, productInspections.id))
        .where(andOp(
          inArray(measurementResults.pointDefId, pointDefIds),
          eqOp(measurementResults.result, 'NG'),
          isNotNull(measurementResults.imageUrl),
          ...inspConds,
        ))
        .orderBy(descOp(productInspections.inspectionTime))
        .limit(pointDefIds.length * imageLimit);

      const errorImagesMap = new Map<number, any[]>();
      for (const img of ngImages) {
        const arr = errorImagesMap.get(img.pointDefId) || [];
        if (arr.length < imageLimit) {
          arr.push({
            id: img.id,
            imageUrl: img.imageUrl,
            measuredValue: img.measuredValueText || (img.measuredValue != null ? String(img.measuredValue) : '—'),
            result: img.result,
            inspectionTime: img.inspectionTime ? new Date(img.inspectionTime).toISOString() : '',
            serialNumber: img.serialNumber || '',
          });
          errorImagesMap.set(img.pointDefId, arr);
        }
      }

      // Assemble points
      const points = allPointDefs.map((def: any) => {
        const st = statsMap.get(def.id) || { total: 0, ng: 0, ntf: 0 };
        const defectRate = st.total > 0 ? Math.round((st.ng / st.total) * 10000) / 100 : 0;
        const ntfRate = st.total > 0 ? Math.round((st.ntf / st.total) * 10000) / 100 : 0;
        const status: string = defectRate >= 2 ? 'fail' : defectRate >= 0.5 ? 'warn' : 'pass';
        const lastMeas = lastMeasMap.get(def.id);

        return {
          id: def.id,
          code: def.code,
          name: def.name,
          type: def.measurementType,
          positionX: def.positionX,
          positionY: def.positionY,
          radius: def.radius,
          normalizedX: def.normalizedX != null ? Number(def.normalizedX) : null,
          normalizedY: def.normalizedY != null ? Number(def.normalizedY) : null,
          normalizedRadius: def.normalizedRadius != null ? Number(def.normalizedRadius) : null,
          cropWidth: def.cropWidth,
          cropHeight: def.cropHeight,
          workstationId: def.workstationId ?? null,
          status,
          defectRate,
          totalInspected: st.total,
          ngCount: st.ng,
          ntfCount: st.ntf,
          ntfRate,
          lowerLimit: def.lowerLimit ? Number(def.lowerLimit) : null,
          upperLimit: def.upperLimit ? Number(def.upperLimit) : null,
          nominalValue: def.nominalValue ? Number(def.nominalValue) : null,
          unit: def.unit,
          lastValue: lastMeas?.value ?? null,
          lastResult: lastMeas?.result ?? null,
          errorImages: errorImagesMap.get(def.id) || [],
        };
      });

      // ★★★ NƠI CẤP VÉ — `productImage.url` (`product_models.referenceImageUrl`) và
      //     `points[].errorImages[].imageUrl` (`measurement_results.imageUrl`).
      // ⚠ `productImage.url` hiện đo được là `data:` trên `aoi_management` (10/10 hàng) ⇒ phép ký
      //   để nguyên nó, đúng theo `kyDuongDanAnh` chỉ chạm chuỗi có tiền tố có cổng canh.
      res.json(kyAnhTrongThan({
        success: true,
        data: {
          dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
          station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
          productImage,
          boardInfo,
          points,
        },
      }, "anh"));
    } catch (error: any) {
      console.error("[External] station point-detail error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get point detail" });
    }
  });

  // ============================================================
  // A11. GET /api/external/workstations — List workstations for third-party apps
  // ============================================================
  app.get("/api/external/workstations", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { workstations, factories, workshops, productionLines } = await import("../../drizzle/schema");
      const { eq: eqOp, and: andOp } = await import("drizzle-orm");

      // Optional filters
      const factoryId = req.query.factoryId ? parseInt(req.query.factoryId as string, 10) : undefined;
      const workshopId = req.query.workshopId ? parseInt(req.query.workshopId as string, 10) : undefined;
      const lineId = req.query.lineId ? parseInt(req.query.lineId as string, 10) : undefined;

      const conditions: any[] = [eqOp(workstations.isActive, true)];
      // phạm vi người gọi (rà bảo mật 2026-10-24): chỉ công trạm trong phạm vi (cap "workstation": factoryId/workshopId/lineId độc lập, mồ côi bị loại)
      const pvNgoai = phamViGoiNgoai(req);
      const wsTrongPhamVi = await idsCapExternal(nguoiXemCuaPhamVi(pvNgoai), "workstation");
      if (wsTrongPhamVi !== null) {
        const { inArray } = await import("drizzle-orm");
        conditions.push(inArray(workstations.id, wsTrongPhamVi.length > 0 ? wsTrongPhamVi : [-1]));
      }
      if (factoryId && !isNaN(factoryId)) conditions.push(eqOp(workstations.factoryId, factoryId));
      if (workshopId && !isNaN(workshopId)) conditions.push(eqOp(workstations.workshopId, workshopId));
      if (lineId && !isNaN(lineId)) conditions.push(eqOp(workstations.lineId, lineId));

      const rows = await database
        .select({
          id: workstations.id,
          code: workstations.code,
          name: workstations.name,
          description: workstations.description,
          processType: workstations.processType,
          orderIndex: workstations.orderIndex,
          lineId: workstations.lineId,
          workshopId: workstations.workshopId,
          factoryId: workstations.factoryId,
          factoryName: factories.name,
          workshopName: workshops.name,
          lineName: productionLines.name,
        })
        .from(workstations)
        .leftJoin(factories, eqOp(workstations.factoryId, factories.id))
        .leftJoin(workshops, eqOp(workstations.workshopId, workshops.id))
        .leftJoin(productionLines, eqOp(workstations.lineId, productionLines.id))
        .where(andOp(...conditions))
        .orderBy(workstations.orderIndex);

      res.json({
        success: true,
        scopeApplied: phamViDaApNgoai(pvNgoai),
        data: rows.map(r => ({
          id: r.id,
          code: r.code,
          name: r.name,
          description: r.description,
          processType: r.processType,
          orderIndex: r.orderIndex,
          lineId: r.lineId,
          workshopId: r.workshopId,
          factoryId: r.factoryId,
          factoryName: r.factoryName ?? null,
          workshopName: r.workshopName ?? null,
          lineName: r.lineName ?? null,
        })),
      });
    } catch (error: any) {
      console.error("[External] workstations list error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get workstations" });
    }
  });

  // A11b. GET /api/external/workstations/:id — Get workstation detail
  app.get("/api/external/workstations/:id", validateExternalAuth, async (req, res) => {
    try {
      const wsId = parseInt(req.params.id, 10);
      if (isNaN(wsId)) return res.status(400).json({ success: false, message: "Invalid workstation ID" });
      const nguoiXemNgoai = nguoiXemCuaPhamVi(phamViGoiNgoai(req)); // phạm vi người gọi (rà bảo mật 2026-10-24)
      if (await chanNgoaiPhamVi(res, nguoiXemNgoai, "workstation", wsId)) return;

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { workstations, factories, workshops, productionLines } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      const rows = await database
        .select({
          id: workstations.id,
          code: workstations.code,
          name: workstations.name,
          description: workstations.description,
          processType: workstations.processType,
          orderIndex: workstations.orderIndex,
          isActive: workstations.isActive,
          lineId: workstations.lineId,
          workshopId: workstations.workshopId,
          factoryId: workstations.factoryId,
          factoryName: factories.name,
          workshopName: workshops.name,
          lineName: productionLines.name,
        })
        .from(workstations)
        .leftJoin(factories, eqOp(workstations.factoryId, factories.id))
        .leftJoin(workshops, eqOp(workstations.workshopId, workshops.id))
        .leftJoin(productionLines, eqOp(workstations.lineId, productionLines.id))
        .where(eqOp(workstations.id, wsId))
        .limit(1);

      if (rows.length === 0) return res.status(404).json({ success: false, message: "Workstation not found" });
      const r = rows[0];

      res.json({
        success: true,
        data: {
          id: r.id,
          code: r.code,
          name: r.name,
          description: r.description,
          processType: r.processType,
          orderIndex: r.orderIndex,
          isActive: r.isActive,
          lineId: r.lineId,
          workshopId: r.workshopId,
          factoryId: r.factoryId,
          factoryName: r.factoryName ?? null,
          workshopName: r.workshopName ?? null,
          lineName: r.lineName ?? null,
        },
      });
    } catch (error: any) {
      console.error("[External] workstation detail error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get workstation" });
    }
  });
}
