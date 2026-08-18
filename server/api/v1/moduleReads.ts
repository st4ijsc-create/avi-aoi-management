/**
 * U4a (doc 21 §6 U4 / §3 G-6) — OPEN THE NEW UPPER-LAYER MODULES TO /api/v1 (READ).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * GAP closed: `/api/v1` previously exposed only equipment/ingest/orchestration/edge/
 * ERP. Fleet, safety, twin, IR/programs, PdM, anomaly and equipment-governance were
 * tRPC-internal — a third party (or another ecosystem module) could not build on them.
 *
 * This module registers READ-ONLY, scope-gated /api/v1 endpoints that REUSE THE SAME
 * service functions the tRPC routers call (NO logic duplication). Every endpoint:
 *   • declares the ONE least-privilege scope it needs (fleet/safety/twin/programs/
 *     pdm/anomaly/standards + reuse equipment:read for the roll-up/cockpit),
 *   • returns the consistent `{ ok, data?, error? }` envelope,
 *   • is fail-safe (envelope.wrap → structured error, never a 500 crash),
 *   • is HONEST: empty/absent data is returned as empty (never fabricated); a missing
 *     DB yields an empty payload where the underlying service already degrades.
 *
 * SAFETY (non-negotiable): READ-ONLY. NO new device-control path is opened here. The
 * advisory subsystems (safety, anomaly) are surfaced with their advisory/honest flags
 * intact. Any ACTION (create task, deploy build, record safety event, publish device
 * type, rollback model) is DELIBERATELY NOT exposed in U4a — those remain behind the
 * existing tRPC gated flow (perm + flag + HITL). Writes can be a later phase.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { type Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";
import type { DeviceTypeNode } from "../../services/standards/deviceTypeRegistry";
import type { AlarmMapping } from "../../services/standards/alarmTaxonomy";
import type { TenantCodeScope } from "../../_core/tenantCodeScope";

/** Parse a positive-integer path/query param or throw a 400. */
function posInt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ApiHttpError(400, "bad_request", `Invalid ${label}.`);
  return n;
}

/** Optional positive-int query param → number | undefined (400 on garbage). */
function optPosInt(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return posInt(raw, label);
}

/** Clamp a caller-supplied limit to [1, max] with a default. */
function limitParam(raw: unknown, def: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(1, Math.trunc(n)), max);
}

/**
 * Register the U4a module READ routes on the /api/v1 router. Additive — called from
 * createV1Router after the equipment/orchestration/edge/ERP surface is mounted.
 */
export function registerModuleReadRoutes(r: Router): void {
  // ── FLEET (Khối 2) — tasks + zones (READ). Reuses getZoneOccupancy; the raw task/
  //    zone rows are the SAME drizzle selects fleetRouter.listTasks/listZones run. ──
  r.get(
    "/fleet/tasks",
    requireScope(API_SCOPES.FLEET_READ),
    wrap(async (req: Request, res: Response) => {
      const { getDb } = await import("../../db/connection");
      const { tasks } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) return sendOk(res, { tasks: [], count: 0 });
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const deviceId = optPosInt(req.query.deviceId, "deviceId");
      const limit = limitParam(req.query.limit, 100, 500);
      const conds = [];
      if (status) conds.push(eq(tasks.status, status));
      if (deviceId != null) conds.push(eq(tasks.assignedDeviceId, deviceId));
      const rows = await d
        .select()
        .from(tasks)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(tasks.priority), desc(tasks.createdAt))
        .limit(limit);
      sendOk(res, { tasks: rows, count: rows.length });
    }),
  );

  r.get(
    "/fleet/zones",
    requireScope(API_SCOPES.FLEET_READ),
    wrap(async (_req, res) => {
      const { getDb } = await import("../../db/connection");
      const { zones } = await import("../../../drizzle/schema");
      const { getZoneOccupancy } = await import("../../services/fleet/trafficManager");
      const d = await getDb();
      if (!d) return sendOk(res, { zones: [], count: 0 });
      const rows = await d.select().from(zones).orderBy(zones.code);
      // Derive occupancy per zone via the SAME service fleetRouter.listZones uses.
      const out = [];
      for (const z of rows) out.push({ ...z, occupancy: await getZoneOccupancy(z.id) });
      sendOk(res, { zones: out, count: out.length });
    }),
  );

  // ── SAFETY (Khối 3, ADVISORY) — events + zones (READ). Reuses queryFeed / listZones. ──
  r.get(
    "/safety/events",
    requireScope(API_SCOPES.SAFETY_READ),
    wrap(async (req, res) => {
      const { queryFeed } = await import("../../services/safety/safetyAuditService");
      const eventType = typeof req.query.eventType === "string" ? req.query.eventType : undefined;
      const robotId = optPosInt(req.query.robotId, "robotId");
      const sinceHours = optPosInt(req.query.sinceHours, "sinceHours");
      const limit = limitParam(req.query.limit, 200, 500);
      const events = await queryFeed({ eventType: eventType as never, robotId, sinceHours, limit });
      // HONEST: this feed is ADVISORY monitoring — never a safety-rated signal.
      sendOk(res, { advisory: true, events, count: events.length });
    }),
  );

  r.get(
    "/safety/zones",
    requireScope(API_SCOPES.SAFETY_READ),
    wrap(async (req, res) => {
      const { listZones } = await import("../../services/safety/safetyZoneService");
      const robotId = optPosInt(req.query.robotId, "robotId");
      const stationId = optPosInt(req.query.stationId, "stationId");
      const lineId = optPosInt(req.query.lineId, "lineId");
      const zones = await listZones({ robotId, stationId, lineId });
      sendOk(res, { advisory: true, ratedStopIsHardware: true, zones, count: zones.length });
    }),
  );

  // ── TWIN (Khối 7) — scene graph + 3D model registry (READ). Reuses buildSceneGraph
  //    / listModels (the SAME functions twinRouter.sceneGraph / models.list call). ──
  r.get(
    "/twin/scene-graph",
    requireScope(API_SCOPES.TWIN_READ),
    wrap(async (req, res) => {
      const factoryId = posInt(req.query.factoryId, "factoryId (query)");
      const { buildSceneGraph } = await import("../../services/twin/sceneGraph");
      sendOk(res, await buildSceneGraph(factoryId));
    }),
  );

  r.get(
    "/twin/models",
    requireScope(API_SCOPES.TWIN_READ),
    wrap(async (req, res) => {
      const { listModels } = await import("../../services/twin/modelRegistry");
      const equipmentClass = typeof req.query.equipmentClass === "string" ? req.query.equipmentClass : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const limit = limitParam(req.query.limit, 200, 1000);
      const models = await listModels({ equipmentClass, status, limit });
      sendOk(res, { models, count: models.length });
    }),
  );

  // ── PROGRAMS (Khối 6, device programming) — projects + deployments (READ). Same
  //    drizzle selects programmingRouter.listProjects / listDeployments run. Deploy /
  //    rollback ACTIONS stay behind the EXISTING gated tRPC flow (NOT exposed here). ──
  r.get(
    "/programs",
    requireScope(API_SCOPES.PROGRAMS_READ),
    wrap(async (req, res) => {
      const { getDb } = await import("../../db/connection");
      const { programProjects } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) return sendOk(res, { programs: [], count: 0 });
      const limit = limitParam(req.query.limit, 200, 500);
      const rows = await d.select().from(programProjects).orderBy(desc(programProjects.updatedAt)).limit(limit);
      sendOk(res, { programs: rows, count: rows.length });
    }),
  );

  r.get(
    "/programs/:id/deployments",
    requireScope(API_SCOPES.PROGRAMS_READ),
    wrap(async (req, res) => {
      const projectId = posInt(req.params.id, "program id");
      const { getDb } = await import("../../db/connection");
      const { programProjects, programDeployments } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");
      const [proj] = await d.select().from(programProjects).where(eq(programProjects.id, projectId)).limit(1);
      if (!proj) throw new ApiHttpError(404, "not_found", `Program ${projectId} not found.`);
      const rows = await d
        .select()
        .from(programDeployments)
        .where(eq(programDeployments.projectId, projectId))
        .orderBy(desc(programDeployments.id));
      sendOk(res, { programId: projectId, deployments: rows, count: rows.length });
    }),
  );

  // ── PdM (WS-4) — per-machine failure risk (READ). Reuses computeFailureRisk (the
  //    SAME function predictiveMaintenanceRouter.getMachineRisk calls). ──
  r.get(
    "/pdm/risk",
    requireScope(API_SCOPES.PDM_READ),
    wrap(async (req, res) => {
      const machineId = posInt(req.query.machineId, "machineId (query)");
      const windowHours = optPosInt(req.query.windowHours, "windowHours");
      const { computeFailureRisk } = await import("../../services/predictiveMaintenanceService");
      // computeFailureRisk already echoes `machineId` in its result.
      sendOk(res, await computeFailureRisk(machineId, windowHours));
    }),
  );

  // ── ANOMALY (Khối 4, ADVISORY) — robot-behaviour anomaly events (READ). Same
  //    drizzle select aiRobotAnomalyRouter.listAnomalies runs. Acknowledge / scan /
  //    rollback ACTIONS stay behind the EXISTING gated tRPC flow (NOT exposed here). ──
  r.get(
    "/anomaly/events",
    requireScope(API_SCOPES.ANOMALY_READ),
    wrap(async (req, res) => {
      const { getDb } = await import("../../db/connection");
      const { robotBehaviorAnomalies } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) return sendOk(res, { advisory: true, anomalies: [], count: 0 });
      const robotId = optPosInt(req.query.robotId, "robotId");
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const limit = limitParam(req.query.limit, 50, 200);
      const conds = [];
      if (robotId != null) conds.push(eq(robotBehaviorAnomalies.robotId, robotId));
      if (status) conds.push(eq(robotBehaviorAnomalies.status, status));
      const rows = await d
        .select()
        .from(robotBehaviorAnomalies)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(robotBehaviorAnomalies.detectedAt))
        .limit(limit);
      sendOk(res, { advisory: true, anomalies: rows, count: rows.length });
    }),
  );

  // ── STANDARDS (Khối 5 governance) — device types + alarm taxonomy + compliance
  //    (READ). Reuses the registry/taxonomy/compliance service functions (SEED ∪
  //    persisted merge, then buildTree/mapAlarm/computeCompliance). ──
  r.get(
    "/standards/device-types",
    requireScope(API_SCOPES.STANDARDS_READ),
    wrap(async (_req, res) => {
      const { getDb } = await import("../../db/connection");
      const { deviceTypes } = await import("../../../drizzle/schema/equipmentStandards");
      const { buildSeedTypes, buildTree } = await import("../../services/standards/deviceTypeRegistry");
      const seed = buildSeedTypes();
      const d = await getDb();
      let nodes: DeviceTypeNode[] = seed;
      if (d) {
        const rows = await d.select().from(deviceTypes);
        // SEED ∪ persisted rows — buildTree()/preferNode() pick published>draft + top SemVer.
        nodes = [
          ...seed,
          ...rows.map((r): DeviceTypeNode => ({
            typeKey: r.typeKey,
            parentTypeKey: r.parentTypeKey ?? null,
            version: r.version,
            status: (r.status as DeviceTypeNode["status"]) ?? "draft",
            label: r.label ?? undefined,
            description: r.description ?? undefined,
            attributesSchema: (r.attributesSchema ?? []) as DeviceTypeNode["attributesSchema"],
            supportedCommands: (r.supportedCommands ?? []) as DeviceTypeNode["supportedCommands"],
            supportedStates: (r.supportedStates ?? []) as DeviceTypeNode["supportedStates"],
            extensionFields: (r.extensionFields ?? {}) as Record<string, unknown>,
            mappedMachineTypes: (r.mappedMachineTypes ?? []) as string[],
            adapterKind: r.adapterKind ?? undefined,
          })),
        ];
      }
      sendOk(res, { tree: buildTree(nodes), typeCount: new Set(nodes.map((n) => n.typeKey)).size });
    }),
  );

  r.get(
    "/standards/alarm-taxonomy",
    requireScope(API_SCOPES.STANDARDS_READ),
    wrap(async (req, res) => {
      const { getDb } = await import("../../db/connection");
      const { alarmTaxonomy } = await import("../../../drizzle/schema/equipmentStandards");
      const { SEED_ALARM_MAPPINGS, listVendors, asSeverity } = await import(
        "../../services/standards/alarmTaxonomy"
      );
      // SEED ∪ persisted (persisted overrides by vendor+native) — same merge as the router.
      const merged = new Map<string, AlarmMapping>();
      for (const m of SEED_ALARM_MAPPINGS) merged.set(`${m.vendor.toLowerCase()}::${m.nativeCode}`, m);
      const d = await getDb();
      if (d) {
        const rows = await d.select().from(alarmTaxonomy);
        for (const r of rows) {
          merged.set(`${r.vendor.toLowerCase()}::${r.nativeCode}`, {
            vendor: r.vendor,
            machineType: r.machineType ?? undefined,
            deviceTypeKey: r.deviceTypeKey ?? undefined,
            nativeCode: r.nativeCode,
            standardCode: r.standardCode,
            severity: asSeverity(r.severity),
            description: r.description ?? undefined,
            recommendedAction: r.recommendedAction ?? undefined,
          });
        }
      }
      const entries = Array.from(merged.values());
      const vendor = typeof req.query.vendor === "string" ? req.query.vendor.trim().toLowerCase() : undefined;
      sendOk(res, {
        vendors: listVendors(entries),
        mappings: vendor ? entries.filter((e) => e.vendor.toLowerCase() === vendor) : entries,
      });
    }),
  );

  r.get(
    "/standards/compliance",
    requireScope(API_SCOPES.STANDARDS_READ),
    wrap(async (_req, res) => {
      const { getDb } = await import("../../db/connection");
      const { machines } = await import("../../../drizzle/schema");
      const { deviceTypes, alarmTaxonomy, deviceTypeChangeRequests } = await import(
        "../../../drizzle/schema/equipmentStandards"
      );
      const { buildSeedTypes } = await import("../../services/standards/deviceTypeRegistry");
      const { SEED_ALARM_MAPPINGS } = await import("../../services/standards/alarmTaxonomy");
      const { computeCompliance } = await import("../../services/standards/complianceService");
      // Assemble computeCompliance inputs EXACTLY as equipmentStandardsRouter.complianceMetrics does.
      const machineTypes: string[] = [];
      const publishedTypeKeys = new Set<string>();
      const mappedVendors = new Set<string>();
      const crStatuses: string[] = [];
      for (const n of buildSeedTypes()) if (n.status === "published") publishedTypeKeys.add(n.typeKey);
      for (const m of SEED_ALARM_MAPPINGS) mappedVendors.add(m.vendor.toLowerCase());
      const d = await getDb();
      if (d) {
        const ms = await d.select({ machineType: machines.machineType }).from(machines);
        for (const m of ms) machineTypes.push(m.machineType);
        const dts = await d.select().from(deviceTypes).where(eq(deviceTypes.status, "published"));
        for (const t of dts) publishedTypeKeys.add(t.typeKey);
        const at = await d.select({ vendor: alarmTaxonomy.vendor }).from(alarmTaxonomy);
        for (const a of at) mappedVendors.add(a.vendor.toLowerCase());
        const crs = await d.select({ status: deviceTypeChangeRequests.status }).from(deviceTypeChangeRequests);
        for (const c of crs) crStatuses.push(c.status);
      }
      sendOk(
        res,
        computeCompliance({
          machineTypes,
          publishedTypeKeys: Array.from(publishedTypeKeys),
          crStatuses,
          mappedVendors: Array.from(mappedVendors),
        }),
      );
    }),
  );

  // ── ECOSYSTEM ROLL-UP (U2 Command Center) — the SINGLE external panorama. Reuses
  //    buildHierarchy / buildKpiSummary / commandCenterStatus. Uses equipment:read
  //    (a caller already trusted to read equipment gets the whole-ecosystem view). ──
  r.get(
    "/ecosystem/hierarchy",
    requireScope(API_SCOPES.EQUIPMENT_READ),
    wrap(async (req, res) => {
      const { buildHierarchy, commandCenterStatus } = await import(
        "../../services/ecosystem/commandCenterService"
      );
      const factoryId = optPosInt(req.query.factoryId, "factoryId");
      const corporateCode = typeof req.query.corporateCode === "string" ? req.query.corporateCode : undefined;
      const scope = factoryId != null || corporateCode ? { factoryId, corporateCode } : undefined;
      const tree = await buildHierarchy(scope);
      sendOk(res, { ...tree, status: commandCenterStatus() });
    }),
  );

  r.get(
    "/ecosystem/kpi",
    requireScope(API_SCOPES.EQUIPMENT_READ),
    wrap(async (req, res) => {
      const { buildKpiSummary, commandCenterStatus } = await import(
        "../../services/ecosystem/commandCenterService"
      );
      const factoryId = optPosInt(req.query.factoryId, "factoryId");
      const corporateCode = typeof req.query.corporateCode === "string" ? req.query.corporateCode : undefined;
      const scope = factoryId != null || corporateCode ? { factoryId, corporateCode } : undefined;
      // An external API principal is not a DB user — buildKpiSummary only reads the
      // AI-inbox count with this identity (id 0 → honest empty), never writes.
      const principal = req.apiPrincipal?.name ?? "api-key";

      // ★★★ 2026-08-18 — PHẠM VI THẬT CỦA KHOÁ, thay cho principal tổng hợp `{id:0, role:"api"}`.
      //
      // ⚠ Trước bản vá này, `{id: 0, role: "api"}` là danh tính DUY NHẤT đi xuống, và
      //   `buildKpiSummary` không nhận `tenant` nào ⇒ **mọi ô của dải KPI đọc số của TOÀN BỘ nhà
      //   máy**, kể cả khi khoá chỉ được cấp một nhà máy (mig 0325). `{id: 0}` chưa bao giờ là
      //   một phạm vi — nó chỉ khiến ô `aiInsights` trả rỗng một cách trung thực, và điều đó đã
      //   che mất năm ô còn lại.
      //
      // ⚠ `scope` (factoryId/corporateCode từ QUERY) là lời TỰ KHAI của người gọi và chỉ là bộ
      //   lọc TRÌNH BÀY. Trục phạm vi thật đến từ `req.apiPrincipal.tenantScope` — máy chủ tự
      //   tra từ `api_keys`. Hai thứ này không được lẫn: một `?corporateCode=` không được phép
      //   NỚI phạm vi của khoá ra.
      const { tenantCodeScopeOf } = await import("./apiKeyScope");
      const tenantCodes = tenantCodeScopeOf(req.apiPrincipal?.tenantScope);
      let tenant:
        | { factoryIds: number[] | null; tenantScope?: TenantCodeScope | null }
        | undefined;
      if (tenantCodes) {
        const { resolveTenantCodeFactoryIds } = await import("../../db/reportAggregators");
        const { factoryIds } = await resolveTenantCodeFactoryIds(tenantCodes);
        // `[]` ⇒ mọi cổng sinh `1 = 0` TƯỜNG MINH. KHÔNG có đường nào biến rỗng thành "không lọc".
        tenant = { factoryIds, tenantScope: tenantCodes };
      }

      const summary = await buildKpiSummary({ id: 0, role: "api", name: principal }, scope, tenant);
      sendOk(res, { ...summary, status: commandCenterStatus() });
    }),
  );

  // ── COCKPIT (U3) — full per-machine / per-robot detail. Reuses machineDetail /
  //    robotDetail (the SAME aggregators assetCockpitRouter calls). gatedActions in
  //    the payload are METADATA ONLY (which commands MAY be proposed) — no exec here. ──
  r.get(
    "/machines/:id/detail",
    requireScope(API_SCOPES.EQUIPMENT_READ),
    wrap(async (req, res) => {
      const machineId = posInt(req.params.id, "machine id");
      const { machineDetail } = await import("../../services/ecosystem/assetCockpitService");
      const detail = await machineDetail(machineId);
      if (!detail) throw new ApiHttpError(404, "not_found", `Machine ${machineId} not found.`);
      sendOk(res, detail);
    }),
  );

  r.get(
    "/robots/:id/detail",
    requireScope(API_SCOPES.EQUIPMENT_READ),
    wrap(async (req, res) => {
      const robotId = posInt(req.params.id, "robot id");
      const { robotDetail } = await import("../../services/ecosystem/assetCockpitService");
      const detail = await robotDetail(robotId);
      if (!detail) throw new ApiHttpError(404, "not_found", `Robot ${robotId} not found.`);
      sendOk(res, detail);
    }),
  );
}
