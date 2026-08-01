/**
 * W2-A2 (doc 44, gaps G1.10 + G1.11 + G1.12) — SYNAPSE control-plane REST:
 * /v1/assets discovery/lifecycle/health/tags + config-drift + adapter restart
 * + gateway status (spec: SYNAPSE Tầng-1 Chương 12.2).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Follows the moduleReads/pdmHealth pattern: scope-gated (`assets:read` /
 * `assets:write`), `{ ok, data?, error? }` envelope, wrap() fail-safe, reuse of
 * the SAME db/service functions the tRPC routers call. Mutating requests are
 * audited by the global v1Guard (guard.ts) like every other /api/v1 write;
 * lifecycle changes ADDITIONALLY land in the append-only control_audit_log —
 * the same ledger the tRPC machine.lifecycle mutation writes.
 *
 * HONEST SURFACES:
 *   • Asset ids resolve as URN *or* numeric machine id.
 *   • health — derived from REAL signals only (lastHeartbeat, machine_status_logs
 *     presence, adapter connection status); no signal → nulls, never fabricated.
 *   • POST /assets registers a DECLARATIVE asset (lifecycle 'registered', spec
 *     §6.3/§12.3) — it does NOT connect anything; the response says exactly what
 *     onboarding steps remain (commissioning → approval → adapter mapping).
 *   • POST /adapters/:id/restart — otManager (read-only for this batch) exposes
 *     NO per-adapter restart, only whole-framework startOt/stopOt. Composing
 *     those restarts EVERY adapter, so the endpoint is gated by
 *     V1_ADAPTER_RESTART_ENABLED (default OFF → structured 501) and, when ON,
 *     says honestly that the restart is framework-wide.
 *   • GET /gateways/:id/status maps to the edge_nodes registry (E4).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { type Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, sendError, wrap, ApiHttpError } from "./envelope";
// NOTE: from the BARREL (not schema/hierarchy directly) so test suites that mock
// "../../../drizzle/schema" never pull the real schema under a partial drizzle-orm mock.
import { MACHINE_LIFECYCLE_STATUSES } from "../../../drizzle/schema";

/** True when /api/v1 adapter restart is enabled (default OFF). */
export function v1AdapterRestartEnabled(): boolean {
  return process.env.V1_ADAPTER_RESTART_ENABLED === "true" || process.env.V1_ADAPTER_RESTART_ENABLED === "1";
}

function limitParam(raw: unknown, def: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(1, Math.trunc(n)), max);
}

function posInt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ApiHttpError(400, "bad_request", `Invalid ${label}.`);
  return n;
}

type MachineRow = {
  id: number;
  code: string;
  name: string;
  machineType: string;
  model: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
  stationId: number;
  lifecycleStatus: string | null;
  registrationStatus: string;
  operationStatus: string;
  capabilities: unknown;
  urn: string | null;
  isa95Path: string | null;
  lastHeartbeat: Date | null;
  isActive: boolean;
};

/**
 * Resolve `:id` as a URN (urn:…) or a numeric machine id. 404 when absent.
 * Tombstones resolve too (registry keeps retired assets for traceability).
 */
async function resolveAsset(idParam: string): Promise<MachineRow> {
  const { getDb } = await import("../../db/connection");
  const { machines } = await import("../../../drizzle/schema");
  const d = await getDb();
  if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

  const raw = String(idParam ?? "").trim();
  let where;
  if (/^\d+$/.test(raw)) {
    where = eq(machines.id, Number(raw));
  } else if (raw.toLowerCase().startsWith("urn:")) {
    where = eq(machines.urn, raw);
  } else {
    throw new ApiHttpError(400, "bad_request", "Asset id must be a numeric machine id or a urn:… identifier.");
  }
  const [m] = await d.select().from(machines).where(where).limit(1);
  if (!m) throw new ApiHttpError(404, "not_found", `Asset "${raw}" not found.`);
  return m as unknown as MachineRow;
}

/** Stored identity or an on-the-fly fallback for rows 0251 has not stamped yet. */
async function assetIdentity(m: MachineRow): Promise<{ urn: string; path: string }> {
  if (m.urn && m.isa95Path) return { urn: m.urn, path: m.isa95Path };
  const { computeUrn, computePath } = await import("../../services/assetRegistry/urnService");
  const [urn, path] = await Promise.all([computeUrn(m.id), computePath(m.id)]);
  return { urn: m.urn ?? urn ?? `urn:syn:asset:unassigned:unassigned:unassigned:machine-${m.id}`, path: m.isa95Path ?? path ?? "" };
}

/** Register the W2-A2 asset-registry routes on the /api/v1 router. */
export function registerAssetRoutes(r: Router): void {
  // ── GET /assets — discovery: filter by class / path prefix / lifecycle ──────
  r.get(
    "/assets",
    requireScope(API_SCOPES.ASSETS_READ),
    wrap(async (req: Request, res: Response) => {
      const { getDb } = await import("../../db/connection");
      const { machines, deviceAdapters, deviceTags } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) return sendOk(res, { assets: [], count: 0 }); // honest-empty

      const limit = limitParam(req.query.limit, 200, 1000);
      const cls = typeof req.query.class === "string" && req.query.class ? req.query.class : undefined;
      const lifecycle = typeof req.query.lifecycle === "string" && req.query.lifecycle ? req.query.lifecycle : undefined;
      const pathPrefix = typeof req.query.path === "string" && req.query.path ? req.query.path : undefined;
      const includeInactive = req.query.includeInactive === "true";

      if (lifecycle && !(MACHINE_LIFECYCLE_STATUSES as readonly string[]).includes(lifecycle)) {
        throw new ApiHttpError(400, "bad_request", `Invalid lifecycle. Expected one of: ${MACHINE_LIFECYCLE_STATUSES.join(", ")}.`);
      }

      const conds = [];
      if (!includeInactive) conds.push(eq(machines.isActive, true));
      // ::text comparison — garbage `class` must be a clean empty result, not an enum-cast 500.
      if (cls) conds.push(sql`${machines.machineType}::text = ${cls}`);
      if (lifecycle) conds.push(eq(machines.lifecycleStatus, lifecycle as never));
      if (pathPrefix) {
        const escaped = pathPrefix.replace(/[\\%_]/g, (ch) => `\\${ch}`);
        conds.push(sql`${machines.isa95Path} LIKE ${`${escaped}%`}`);
      }

      const rows = (await d
        .select()
        .from(machines)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(machines.id))
        .limit(limit)) as unknown as MachineRow[];

      // Tag counts per machine via its adapters — one grouped query, no N+1.
      const ids = rows.map((m) => m.id);
      const tagCounts = new Map<number, number>();
      if (ids.length > 0) {
        const counted = await d
          .select({ machineId: deviceAdapters.machineId, n: sql<number>`count(*)` })
          .from(deviceTags)
          .innerJoin(deviceAdapters, eq(deviceTags.adapterId, deviceAdapters.id))
          .where(inArray(deviceAdapters.machineId, ids))
          .groupBy(deviceAdapters.machineId);
        for (const c of counted) {
          if (c.machineId != null) tagCounts.set(c.machineId, Number(c.n) || 0);
        }
      }

      const assets = await Promise.all(
        rows.map(async (m) => {
          const identity = await assetIdentity(m);
          return {
            asset_id: identity.urn,
            machine_id: m.id,
            name: m.name,
            class: m.machineType,
            vendor: m.manufacturer ?? null,
            model: m.model ?? null,
            path: identity.path,
            lifecycle_state: m.lifecycleStatus ?? "active",
            capabilities: m.capabilities ?? null,
            tags: tagCounts.get(m.id) ?? 0,
          };
        }),
      );
      sendOk(res, { assets, count: assets.length });
    }),
  );

  // ── GET /assets/:id — detail (id = urn OR machine id) ───────────────────────
  r.get(
    "/assets/:id",
    requireScope(API_SCOPES.ASSETS_READ),
    wrap(async (req, res) => {
      const m = await resolveAsset(req.params.id);
      const identity = await assetIdentity(m);

      const { getDb } = await import("../../db/connection");
      const { deviceAdapters, stations, productionLines, workshops, factories, machines } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

      const [hier] = await d
        .select({
          stationCode: stations.code,
          lineCode: productionLines.code,
          workshopCode: workshops.code,
          factoryCode: factories.code,
        })
        .from(machines)
        .leftJoin(stations, eq(machines.stationId, stations.id))
        .leftJoin(productionLines, eq(stations.lineId, productionLines.id))
        .leftJoin(workshops, eq(productionLines.workshopId, workshops.id))
        .leftJoin(factories, eq(workshops.factoryId, factories.id))
        .where(eq(machines.id, m.id))
        .limit(1);

      const adapters = await d
        .select({
          id: deviceAdapters.id,
          code: deviceAdapters.code,
          protocol: deviceAdapters.protocol,
          status: deviceAdapters.status,
          isEnabled: deviceAdapters.isEnabled,
        })
        .from(deviceAdapters)
        .where(eq(deviceAdapters.machineId, m.id));

      sendOk(res, {
        asset_id: identity.urn,
        machine_id: m.id,
        code: m.code,
        name: m.name,
        class: m.machineType,
        vendor: m.manufacturer ?? null,
        model: m.model ?? null,
        serial_number: m.serialNumber ?? null,
        path: identity.path,
        lifecycle_state: m.lifecycleStatus ?? "active",
        registration_status: m.registrationStatus,
        operation_status: m.operationStatus,
        capabilities: m.capabilities ?? null,
        hierarchy: {
          site: hier?.factoryCode ?? null,
          area: hier?.workshopCode ?? null,
          line: hier?.lineCode ?? null,
          cell: hier?.stationCode ?? null,
        },
        adapters,
        is_active: m.isActive,
      });
    }),
  );

  // ── PUT /assets/:id/lifecycle — validated transition (spec §6.3) ────────────
  r.put(
    "/assets/:id/lifecycle",
    requireScope(API_SCOPES.ASSETS_WRITE),
    wrap(async (req, res) => {
      const m = await resolveAsset(req.params.id);
      const bodySchema = z.object({
        state: z.enum(MACHINE_LIFECYCLE_STATUSES),
        reason: z.string().trim().max(500).optional(),
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiHttpError(400, "bad_request", `Invalid body: state must be one of ${MACHINE_LIFECYCLE_STATUSES.join(", ")}.`, {
          issues: parsed.error.issues,
        });
      }

      // SAME sanctioned path as the tRPC machine.lifecycle mutation — the full
      // transition matrix stays enforced in one place (server/db/hierarchy.ts).
      const { transitionMachineLifecycle } = await import("../../db");
      let result: Awaited<ReturnType<typeof transitionMachineLifecycle>>;
      try {
        result = await transitionMachineLifecycle(m.id, parsed.data.state);
      } catch (err) {
        const e = err as Error;
        if (e?.name === "LifecycleTransitionError") throw new ApiHttpError(409, "illegal_transition", e.message);
        if (e?.message === "Machine not found") throw new ApiHttpError(404, "not_found", `Asset ${m.id} not found.`);
        throw err;
      }

      // Control-grade append-only ledger (same as the tRPC path). Best-effort.
      try {
        const { getDb } = await import("../../db/connection");
        const { recordAuditEvent } = await import("../../services/audit/controlAuditService");
        const d = await getDb();
        if (d) {
          await recordAuditEvent(d as never, {
            entityType: "machine",
            entityId: m.id,
            action: `lifecycle.${parsed.data.state}`,
            actorId: null, // API principal — name carried in `reason`
            before: { lifecycleStatus: result.before.lifecycleStatus },
            after: { lifecycleStatus: result.after.lifecycleStatus },
            reason: parsed.data.reason ?? `via /api/v1 by ${req.apiPrincipal?.name ?? "api-key"}`,
          } as never);
        }
      } catch (err) {
        console.error("[api/v1 assets] control audit failed:", (err as Error)?.message ?? err);
      }

      sendOk(res, {
        asset_id: m.urn ?? String(m.id),
        machine_id: m.id,
        lifecycle_state: result.after.lifecycleStatus,
        previous_state: result.before.lifecycleStatus,
        changed_by: req.apiPrincipal?.name ?? "api-key",
      });
    }),
  );

  // ── GET /assets/:id/health — REAL signals only (honest-null) ────────────────
  r.get(
    "/assets/:id/health",
    requireScope(API_SCOPES.ASSETS_READ),
    wrap(async (req, res) => {
      const m = await resolveAsset(req.params.id);
      const { getDb } = await import("../../db/connection");
      const { machineStatusLogs, deviceAdapters } = await import("../../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

      // Presence: the machine_status_logs stream (socket path + presence sweep).
      const [presence] = await d
        .select({ status: machineStatusLogs.status, timestamp: machineStatusLogs.timestamp })
        .from(machineStatusLogs)
        .where(eq(machineStatusLogs.machineId, m.id))
        .orderBy(desc(machineStatusLogs.timestamp))
        .limit(1);

      // Adapter link states (OT connectivity layer).
      const adapters = await d
        .select({
          id: deviceAdapters.id,
          code: deviceAdapters.code,
          protocol: deviceAdapters.protocol,
          status: deviceAdapters.status,
          isEnabled: deviceAdapters.isEnabled,
          lastConnectedAt: deviceAdapters.lastConnectedAt,
          lastErrorAt: deviceAdapters.lastErrorAt,
          lastError: deviceAdapters.lastError,
        })
        .from(deviceAdapters)
        .where(eq(deviceAdapters.machineId, m.id));

      sendOk(res, {
        asset_id: m.urn ?? String(m.id),
        machine_id: m.id,
        lifecycle_state: m.lifecycleStatus ?? "active",
        operation_status: m.operationStatus,
        // HONEST: null when no presence record has ever been written.
        presence: presence ? { status: presence.status, at: presence.timestamp } : null,
        last_heartbeat: m.lastHeartbeat ?? null,
        adapters,
      });
    }),
  );

  // ── GET /assets/:id/tags — the machine's device_tags via its adapters ───────
  r.get(
    "/assets/:id/tags",
    requireScope(API_SCOPES.ASSETS_READ),
    wrap(async (req, res) => {
      const m = await resolveAsset(req.params.id);
      const { getDb } = await import("../../db/connection");
      const { deviceAdapters, deviceTags } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

      const rows = await d
        .select({
          tagKey: deviceTags.tagKey,
          address: deviceTags.address,
          dataType: deviceTags.dataType,
          unit: deviceTags.unit,
          writable: deviceTags.writable,
          isEnabled: deviceTags.isEnabled,
          adapterId: deviceTags.adapterId,
          adapterCode: deviceAdapters.code,
          protocol: deviceAdapters.protocol,
        })
        .from(deviceTags)
        .innerJoin(deviceAdapters, eq(deviceTags.adapterId, deviceAdapters.id))
        .where(eq(deviceAdapters.machineId, m.id))
        .orderBy(asc(deviceTags.tagKey));

      // Spec §8.3 shape: tag_id / datatype / direction / source_address.
      const tags = rows.map((t) => ({
        tag_id: t.tagKey,
        asset_id: m.urn ?? String(m.id),
        datatype: String(t.dataType),
        unit: t.unit ?? null,
        direction: t.writable ? "rw" : "ro",
        source_address: `${String(t.protocol)}:${t.address}`,
        enabled: t.isEnabled,
        adapter: { id: t.adapterId, code: t.adapterCode },
      }));
      sendOk(res, { asset_id: m.urn ?? String(m.id), machine_id: m.id, tags, count: tags.length });
    }),
  );

  // ── POST /assets — DECLARATIVE registration (spec §12.3 → 'registered') ─────
  r.post(
    "/assets",
    requireScope(API_SCOPES.ASSETS_WRITE),
    wrap(async (req, res) => {
      const bodySchema = z.object({
        code: z.string().trim().min(1).max(50),
        name: z.string().trim().min(1).max(255),
        class: z.string().trim().min(1).max(50),
        stationId: z.number().int().positive(),
        vendor: z.string().trim().max(100).optional(),
        model: z.string().trim().max(100).optional(),
        serialNumber: z.string().trim().max(100).optional(),
        description: z.string().trim().max(2000).optional(),
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiHttpError(400, "bad_request", "Invalid asset registration body.", { issues: parsed.error.issues });
      }
      const input = parsed.data;

      // `class` must be a known machineType (pg enum) — validate up-front so
      // garbage is a clean 400, not an enum-cast 500.
      const { machineTypeEnum } = await import("../../../drizzle/schema");
      const knownClasses: readonly string[] = (machineTypeEnum as { enumValues?: string[] })?.enumValues ?? [];
      if (knownClasses.length > 0 && !knownClasses.includes(input.class)) {
        throw new ApiHttpError(400, "bad_request", `Unknown class "${input.class}". Expected one of: ${knownClasses.join(", ")}.`);
      }

      const db = await import("../../db");
      const station = await db.getStationById(input.stationId);
      if (!station) throw new ApiHttpError(404, "not_found", `Station ${input.stationId} not found.`);

      let machineId: number;
      try {
        machineId = await db.createMachine({
          stationId: input.stationId,
          code: input.code,
          name: input.name,
          machineType: input.class as never,
          manufacturer: input.vendor ?? null,
          model: input.model ?? null,
          serialNumber: input.serialNumber ?? null,
          description: input.description ?? null,
          // Spec §6.3: declared in the registry, NOT yet connected/verified.
          lifecycleStatus: "registered",
        } as never);
      } catch (err) {
        if ((err as Error)?.name === "MachineCodeCollisionError") {
          throw new ApiHttpError(409, "code_collision", (err as Error).message);
        }
        throw err;
      }

      // Stamp the identity synchronously so the 201 carries the URN.
      const { syncAssetIdentity } = await import("../../services/assetRegistry/urnService");
      const identity = await syncAssetIdentity(machineId).catch(() => null);

      sendOk(
        res,
        {
          asset_id: identity?.urn ?? null,
          machine_id: machineId,
          path: identity?.path ?? null,
          lifecycle_state: "registered",
          // HONEST onboarding contract — registration is declarative only.
          onboarding: {
            next_steps: [
              "PUT /api/v1/assets/{id}/lifecycle {\"state\":\"commissioning\"} when connection/tag-mapping work starts",
              "Map connectivity (device adapter + tags) via the internal OT configuration flow",
              "Admin approval (registrationStatus) assigns the machine API key for ingest",
            ],
            note: "This call only declared the asset in the registry — nothing was connected or verified.",
          },
        },
        201,
      );
    }),
  );

  // ── Config drift (G1.11) ─────────────────────────────────────────────────────
  // GET — READ-ONLY view (compares live config vs approved baseline; the
  // periodic sweep is what persists snapshots + raises alerts).
  r.get(
    "/assets/:id/config-drift",
    requireScope(API_SCOPES.ASSETS_READ),
    wrap(async (req, res) => {
      const m = await resolveAsset(req.params.id);
      const { getDb } = await import("../../db/connection");
      const { deviceAdapters } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

      const adapters = await d
        .select({ id: deviceAdapters.id })
        .from(deviceAdapters)
        .where(eq(deviceAdapters.machineId, m.id));

      const { checkAdapterDrift, configDriftEnabled } = await import("../../services/assetRegistry/configDriftService");
      const views = [];
      for (const a of adapters) {
        const v = await checkAdapterDrift(a.id, { persist: false }); // GET must not mutate
        if (v) views.push(v);
      }
      sendOk(res, {
        asset_id: m.urn ?? String(m.id),
        machine_id: m.id,
        adapters: views,
        sweep_enabled: configDriftEnabled(),
        count: views.length,
      });
    }),
  );

  // POST approve — the CURRENT running config becomes the approved baseline.
  r.post(
    "/assets/:id/config-drift/approve",
    requireScope(API_SCOPES.ASSETS_WRITE),
    wrap(async (req, res) => {
      const m = await resolveAsset(req.params.id);
      const body = (req.body ?? {}) as { adapterId?: number };

      const { getDb } = await import("../../db/connection");
      const { deviceAdapters } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

      const adapters = await d
        .select({ id: deviceAdapters.id })
        .from(deviceAdapters)
        .where(eq(deviceAdapters.machineId, m.id));
      if (adapters.length === 0) {
        throw new ApiHttpError(404, "not_found", `Asset ${m.id} has no device adapters to approve.`);
      }

      let targetIds = adapters.map((a) => a.id);
      if (body.adapterId != null) {
        const adapterId = posInt(body.adapterId, "adapterId");
        if (!targetIds.includes(adapterId)) {
          throw new ApiHttpError(404, "not_found", `Adapter ${adapterId} does not belong to asset ${m.id}.`);
        }
        targetIds = [adapterId];
      }

      const { approveCurrentConfig } = await import("../../services/assetRegistry/configDriftService");
      const principal = req.apiPrincipal?.name ?? "api-key";
      const approved = [];
      for (const id of targetIds) {
        approved.push(await approveCurrentConfig(id, null, principal));
      }
      sendOk(res, {
        asset_id: m.urn ?? String(m.id),
        machine_id: m.id,
        approved: approved.map((v) => ({ adapterId: v.adapterId, adapterCode: v.adapterCode, approvedHash: v.approvedHash, status: v.status })),
        approved_by: principal,
      });
    }),
  );

  // ── POST /adapters/:id/restart — flag-gated (default OFF → structured 501) ──
  r.post(
    "/adapters/:id/restart",
    requireScope(API_SCOPES.ASSETS_WRITE),
    wrap(async (req, res) => {
      const adapterId = posInt(req.params.id, "adapter id");

      if (!v1AdapterRestartEnabled()) {
        return sendError(
          res,
          501,
          "v1_adapter_restart_disabled",
          "Adapter restart over /api/v1 is not opened yet (set V1_ADAPTER_RESTART_ENABLED=true). " +
            "NOTE: otManager exposes no per-adapter restart — when enabled, the restart is composed from " +
            "stopOt()+startOt() and therefore reconnects EVERY adapter in the OT framework.",
          { flag: "V1_ADAPTER_RESTART_ENABLED" },
        );
      }

      const { getDb } = await import("../../db/connection");
      const { deviceAdapters } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");
      const [adapter] = await d.select().from(deviceAdapters).where(eq(deviceAdapters.id, adapterId)).limit(1);
      if (!adapter) throw new ApiHttpError(404, "not_found", `Adapter ${adapterId} not found.`);

      const { isOtRunning, stopOt, startOt } = await import("../../services/ot/otManager");
      if (!isOtRunning()) {
        throw new ApiHttpError(409, "ot_not_running", "OT framework is not running — nothing to restart (OT_GATEWAY_ENABLED).");
      }
      await stopOt();
      const started = await startOt();
      sendOk(res, {
        adapterId,
        adapterCode: adapter.code,
        restarted: started,
        // HONEST: the only safe public seam is framework-wide.
        scope: "framework",
        note: "otManager has no per-adapter restart API; the whole OT framework was stopped and restarted (all adapters reconnect).",
        requestedBy: req.apiPrincipal?.name ?? "api-key",
      });
    }),
  );

  // ── GET /gateways/:id/status — edge_nodes registry (id = numeric or code) ───
  r.get(
    "/gateways/:id/status",
    requireScope(API_SCOPES.ASSETS_READ),
    wrap(async (req, res) => {
      const { getDb } = await import("../../db/connection");
      const { edgeNodes } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

      const raw = String(req.params.id ?? "").trim();
      const where = /^\d+$/.test(raw) ? eq(edgeNodes.id, Number(raw)) : eq(edgeNodes.code, raw);
      const [node] = await d.select().from(edgeNodes).where(where).limit(1);
      if (!node) throw new ApiHttpError(404, "not_found", `Gateway "${raw}" not found.`);

      sendOk(res, {
        gateway_id: node.id,
        code: node.code,
        name: node.name,
        status: node.status,
        factory_code: node.factoryCode ?? null,
        last_heartbeat_at: node.lastHeartbeatAt ?? null,
        version: node.version ?? null,
        assigned_line_codes: node.assignedLineCodes ?? [],
        // HONEST: self-reported health detail only (may be null — never fabricated).
        health: node.healthJson ?? null,
      });
    }),
  );
}
