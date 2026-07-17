/**
 * Phase E1 — Factory Control Plane: UNIFIED MACHINE API (versioned REST /api/v1).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A THIN external-facing Express surface over the E0 equipment layer
 * (equipmentRegistry / getCapabilitiesForMachine / PackML) + the existing inbound
 * inspection path. The SINGLE integration contract external machines/systems use.
 *
 * Every route:
 *   • authenticates via a scoped API key (auth.requireScope).
 *   • returns the consistent `{ ok, data?, error? }` envelope.
 *   • is fail-safe (envelope.wrap → structured error, never a 500 crash).
 *
 * SAFETY (non-negotiable): POST /equipment/:id/commands routes through
 * equipmentRegistry.getAdapter(kind).sendCommand(...) which goes through the EXISTING
 * HITL/dry-run dispatcher (commandDispatcher / robotCommandDispatcher). With the
 * control flag off (the default) the dispatcher returns `simulated` and writes
 * NOTHING. This API NEVER performs a direct device write.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { Router, type Request, type Response, json as jsonBody } from "express";
import { nanoid } from "nanoid";
import { API_SCOPES } from "./scopes";
import { requireScope } from "./auth";
import { sendOk, sendError, wrap, ApiHttpError } from "./envelope";
import { buildV1OpenApiSpec } from "./openapi";
import { emit } from "./webhookBridge";
import { registerErpIntakeRoutes } from "./erpIntake";
import { registerModuleReadRoutes } from "./moduleReads";
import { registerPdmHealthRoutes } from "./pdmHealth";
import { registerModelRegistryRoutes } from "./modelRegistry";
import { registerAssetRoutes } from "./assets";
import { registerStateRoutes } from "./state";
import { registerTimeseriesRoutes } from "./timeseries";
import { registerEventRoutes } from "./events";
import { registerMetricRoutes } from "./metricsApi";
import { registerGenealogyRoutes } from "./genealogyApi";
import { registerAdviceRoutes } from "./advice";
import { registerPolicyRoutes } from "./policy";
import { registerLineRoutes } from "./lines";
import { registerOrdersLifecycleRoutes } from "./ordersLifecycle";
import { registerErpOauthRoutes } from "./erpOauth";
import { mtlsGuard } from "./erpMtls";
import {
  getCapabilitiesForMachine,
  type EquipmentCapability,
  type CommandDescriptor,
} from "../../services/equipment/capabilityModel";
import { equipmentRegistry, type EquipmentCommand } from "../../services/equipment/equipmentAdapter";
import type { CanonicalSample, TelemetryProtocol, TelemetryQuality } from "../../services/telemetryBus";

// ── helpers ───────────────────────────────────────────────────────────────────

interface MachineRow {
  id: number;
  code: string;
  name: string;
  machineType: string;
  operationStatus: string;
  capabilities: unknown;
  stationId: number;
}

/** Load a machine by id (fail-safe; throws ApiHttpError 404/500). */
async function loadMachine(id: number): Promise<MachineRow> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiHttpError(400, "bad_request", "Invalid machine id.");
  }
  const { getMachineById } = await import("../../db");
  const m = await getMachineById(id);
  if (!m) throw new ApiHttpError(404, "not_found", `Machine ${id} not found.`);
  return m as unknown as MachineRow;
}

function resolveCapability(m: MachineRow): EquipmentCapability {
  return getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
}

function operationStatusToPackml(status: string): string {
  switch (status) {
    case "running": return "Execute";
    case "stopped": return "Stopped";
    case "error": return "Aborted";
    case "maintenance": return "Held";
    case "warming_up": return "Starting";
    case "changeover": return "Suspended";
    case "starved":
    case "blocked": return "Held";
    default: return "Idle";
  }
}

/**
 * Build the EquipmentCommand envelope for the dispatcher from a capability command
 * + the request body args. Translates known verbs into the dispatcher's `writes`
 * (OT) / `job` (robot) shape. The HITL provenance is synthesized for an automated
 * external caller — the dispatcher still applies its dry-run gate.
 */
function buildCommand(
  descriptor: CommandDescriptor,
  capability: EquipmentCapability,
  machineId: number,
  args: Record<string, unknown>,
  idempotencyKey: string,
  principalName: string,
): EquipmentCommand {
  const isRobot = capability.adapterKind === "robot" || capability.adapterKind === "vda5050";
  const cmd: EquipmentCommand = {
    name: descriptor.name,
    machineId,
    idempotencyKey,
    // Automated external caller: actionId tags the audit trail; requestedBy 0 = system.
    hitl: { actionId: `apiv1-${idempotencyKey}`, requestedBy: 0 },
  };

  if (isRobot) {
    cmd.robotId = typeof args.robotId === "number" ? args.robotId : machineId;
    if (descriptor.name === "run_job" && typeof args.jobType === "string") {
      cmd.job = { jobType: args.jobType as never, params: (args.params as Record<string, unknown>) ?? {} };
    }
  } else {
    // OT-family: adapterId for the dispatcher; tag writes derived from args.
    cmd.adapterId = typeof args.adapterId === "number" ? args.adapterId : machineId;
    if (Array.isArray(args.writes)) {
      cmd.writes = (args.writes as Array<{ tagKey: string; value: unknown }>).filter(
        (w) => w && typeof w.tagKey === "string",
      );
    } else if (typeof args.tagKey === "string") {
      cmd.writes = [{ tagKey: args.tagKey, value: args.value }];
    }
  }
  return cmd;
}

// ── telemetry normalization (mirrors POST /api/ot/ingest in _core/index.ts) ───
// The versioned alias POST /api/v1/ingest/telemetry funnels into the SAME unified
// bus (ingestTelemetry); it only differs in surface (the {ok,data,error} envelope +
// OpenAPI visibility, AIR-8). Keep these normalizers byte-aligned with the OT route.
const OT_PROTOCOLS = new Set<string>([
  "mqtt", "opcua", "modbus", "s7", "ethernet_ip", "mtconnect", "sparkplug", "inspection", "other",
]);
const OT_QUALITY = new Set<string>(["good", "bad", "uncertain"]);
const normProtocol = (p: unknown): TelemetryProtocol =>
  typeof p === "string" && OT_PROTOCOLS.has(p) ? (p as TelemetryProtocol) : "other";
const normQuality = (q: unknown): TelemetryQuality =>
  typeof q === "string" && OT_QUALITY.has(q) ? (q as TelemetryQuality) : "good";

/** Map one raw JSON sample → CanonicalSample (deviceId preserved for bus-side resolve). */
function toCanonicalSample(s: unknown): CanonicalSample {
  const o = (s ?? {}) as Record<string, unknown>;
  return {
    ts: o.ts ? new Date(o.ts as string) : undefined,
    machineId: typeof o.machineId === "number" ? o.machineId : null,
    deviceId: typeof o.deviceId === "string" ? o.deviceId : null,
    protocol: normProtocol(o.protocol),
    metric: String(o.metric ?? ""),
    value:
      typeof o.value === "number" || typeof o.value === "string" || typeof o.value === "boolean"
        ? (o.value as number | string | boolean)
        : null,
    unit: typeof o.unit === "string" ? o.unit : null,
    quality: normQuality(o.quality),
    meta: o.meta && typeof o.meta === "object" ? (o.meta as Record<string, unknown>) : null,
  };
}

// ── router ──────────────────────────────────────────────────────────────────

/** Build the /api/v1 router (mounted in server/_core/index.ts). */
export function createV1Router(): Router {
  const r = Router();
  // The parent app may already parse JSON, but make this router self-contained.
  r.use(jsonBody({ limit: "25mb" }));

  // mTLS HONEST SEAM (K0+-a): NO-OP unless REQUIRE_CLIENT_CERT is set. When set,
  // fail-closed if the TLS-terminating layer did not present a verified client
  // cert. Real mTLS is transport/deploy config (see erpMtls.ts) — never faked here.
  r.use(mtlsGuard);

  // GET /equipment — list machines + resolved capabilities.
  r.get(
    "/equipment",
    requireScope(API_SCOPES.EQUIPMENT_READ),
    wrap(async (req: Request, res: Response) => {
      const { getMachines } = await import("../../db");
      const rows = (await getMachines()) as unknown as MachineRow[];
      const stationId = req.query.stationId ? Number(req.query.stationId) : undefined;
      const filtered = stationId ? rows.filter((m) => m.stationId === stationId) : rows;
      const data = filtered.map((m) => {
        const capability = resolveCapability(m);
        return {
          machineId: m.id,
          code: m.code,
          name: m.name,
          machineType: m.machineType,
          operationStatus: m.operationStatus,
          adapterKind: capability.adapterKind,
          commandCount: capability.supportedCommands.length,
          telemetryCount: capability.telemetryTags.length,
          capability,
        };
      });
      sendOk(res, { equipment: data, count: data.length });
    }),
  );

  // GET /equipment/:id/capabilities — resolved EquipmentCapability.
  r.get(
    "/equipment/:id/capabilities",
    requireScope(API_SCOPES.EQUIPMENT_READ),
    wrap(async (req, res) => {
      const m = await loadMachine(Number(req.params.id));
      sendOk(res, { machineId: m.id, machineType: m.machineType, capability: resolveCapability(m) });
    }),
  );

  // GET /equipment/:id/telemetry?from=&to=&limit= — recent OR ranged telemetry.
  r.get(
    "/equipment/:id/telemetry",
    requireScope(API_SCOPES.EQUIPMENT_READ),
    wrap(async (req, res) => {
      const m = await loadMachine(Number(req.params.id));
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 1000) : 50;

      // W2-B1 (doc 44) — W0-audit bug fix: from/to used to be ECHOED without ever
      // filtering. When a range is supplied we now run a REAL range query.
      const fromRaw = typeof req.query.from === "string" && req.query.from ? req.query.from : null;
      const toRaw = typeof req.query.to === "string" && req.query.to ? req.query.to : null;
      if (fromRaw || toRaw) {
        const from = fromRaw ? new Date(fromRaw) : new Date(0);
        const to = toRaw ? new Date(toRaw) : new Date();
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
          throw new ApiHttpError(400, "bad_request", "Invalid from/to — expected ISO date-times.");
        }
        const { queryTelemetryRangeRows } = await import("./timeseries");
        const rows = await queryTelemetryRangeRows({ machineId: m.id, from, to, limit }).catch(() => []);
        return sendOk(res, {
          machineId: m.id,
          from: from.toISOString(),
          to: to.toISOString(),
          ranged: true,
          count: rows.length,
          samples: rows,
        });
      }

      // No range → latest known samples (newest first), unchanged behaviour.
      const { getLatestTelemetry } = await import("../../db/otTelemetry");
      const rows = await getLatestTelemetry({ machineId: m.id, limit }).catch(() => []);
      sendOk(res, {
        machineId: m.id,
        from: null,
        to: null,
        ranged: false,
        count: rows.length,
        samples: rows,
      });
    }),
  );

  // GET /equipment/:id/state — PackML state projection.
  r.get(
    "/equipment/:id/state",
    requireScope(API_SCOPES.EQUIPMENT_READ),
    wrap(async (req, res) => {
      const m = await loadMachine(Number(req.params.id));
      const capability = resolveCapability(m);
      const { allowedCommands } = await import("../../services/equipment/packml");
      const packmlState = operationStatusToPackml(m.operationStatus);
      sendOk(res, {
        machineId: m.id,
        operationStatus: m.operationStatus,
        packmlState,
        allowedPackmlCommands: allowedCommands(packmlState as never),
        adapterKind: capability.adapterKind,
        supportedStates: capability.supportedStates,
      });
    }),
  );

  // POST /equipment/:id/commands — route via the HITL/dry-run dispatcher.
  r.post(
    "/equipment/:id/commands",
    requireScope(API_SCOPES.EQUIPMENT_COMMAND),
    wrap(async (req, res) => {
      const m = await loadMachine(Number(req.params.id));
      const capability = resolveCapability(m);
      const body = (req.body ?? {}) as { command?: string; args?: Record<string, unknown>; idempotencyKey?: string };
      const commandName = body.command;
      if (!commandName || typeof commandName !== "string") {
        throw new ApiHttpError(400, "bad_request", "Body field `command` is required.");
      }
      const descriptor = capability.supportedCommands.find((c) => c.name === commandName);
      if (!descriptor) {
        throw new ApiHttpError(400, "unsupported_command", `Command "${commandName}" is not supported by this machine.`, {
          supported: capability.supportedCommands.map((c) => c.name),
        });
      }
      const args = (body.args ?? {}) as Record<string, unknown>;
      const idempotencyKey = body.idempotencyKey?.trim() || nanoid();
      const command = buildCommand(
        descriptor,
        capability,
        m.id,
        args,
        idempotencyKey,
        req.apiPrincipal?.name ?? "api-key",
      );

      // ROUTE THROUGH THE EXISTING HITL DISPATCHER (honours the dry-run gate).
      const adapter = equipmentRegistry.getAdapter(capability.adapterKind);
      const result = await adapter.sendCommand(command);

      // Outbound webhook (flag-gated, fail-safe — never blocks the response).
      void emit("equipment.command.executed", {
        machineId: m.id,
        machineCode: m.code,
        command: commandName,
        status: result.status,
        routedTo: result.routedTo,
        simulated: result.detail?.simulated ?? undefined,
      });

      sendOk(res, {
        machineId: m.id,
        command: commandName,
        idempotencyKey,
        routedTo: result.routedTo,
        status: result.status,
        accepted: result.ok,
        detail: result.detail ?? null,
        error: result.error ?? null,
      });
    }),
  );

  // POST /ingest/inspection — reuse the existing submitInspection path.
  r.post(
    "/ingest/inspection",
    requireScope(API_SCOPES.INGEST_WRITE),
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Reuse the tRPC machineApi.submitInspection caller (same validation/side-effects).
      const { appRouter } = await import("../../routers");
      const { createContext } = await import("../../_core/context");
      const ctx = await createContext({ req: req as never, res: res as never });
      const caller = appRouter.createCaller(ctx);

      // A machine-principal carries its own apiKey identity; otherwise the body must
      // supply machineCode/apiKey (submitInspection enforces one is present).
      const input: Record<string, unknown> = { ...body };
      try {
        const result = await caller.machineApi.submitInspection(input as never);
        void emit("inspection.committed", {
          serialNumber: body.serialNumber,
          overallResult: body.overallResult,
          inspectionId: (result as { inspectionId?: number })?.inspectionId,
        });
        sendOk(res, result, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // tRPC validation / auth errors → 400 (structured), not a crash.
        throw new ApiHttpError(400, "ingest_failed", message);
      }
    }),
  );

  // POST /ingest/process-result — ST4I Standard Process Feed v1 (doc 56 nhóm C).
  // Nhân pattern /ingest/inspection: reuse the tRPC machineApi.submitProcessResult
  // caller (same validation/side-effects). A generic per-step process RESULT
  // (telemetry-of-record), NOT a control command — no device actuation here.
  r.post(
    "/ingest/process-result",
    requireScope(API_SCOPES.INGEST_WRITE),
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { appRouter } = await import("../../routers");
      const { createContext } = await import("../../_core/context");
      const ctx = await createContext({ req: req as never, res: res as never });
      const caller = appRouter.createCaller(ctx);

      // A machine-principal carries its own apiKey identity (its `name` is the machine
      // code); when the body supplies neither machineCode nor apiKey, adopt the
      // principal's machine code so submitProcessResult can resolve the machine.
      const input: Record<string, unknown> = { ...body };
      if (!input.machineCode && !input.apiKey && req.apiPrincipal?.kind === "machine" && req.apiPrincipal.name) {
        input.machineCode = req.apiPrincipal.name;
      }
      // Locally-typed view so this file has NO compile-time dependency on agent B's
      // in-flight `submitProcessResult` procedure (resolved dynamically at runtime).
      const machineApi = caller.machineApi as unknown as {
        submitProcessResult(payload: Record<string, unknown>): Promise<unknown>;
      };
      try {
        const result = await machineApi.submitProcessResult(input);
        void emit("process.committed", {
          serialNumber: body.serialNumber,
          stepType: body.stepType,
          result: body.result,
          processResultId:
            (result as { processResultId?: number; id?: number })?.processResultId ??
            (result as { id?: number })?.id,
        });
        sendOk(res, result, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // tRPC validation / auth errors → 400 (structured), not a crash.
        throw new ApiHttpError(400, "ingest_failed", message);
      }
    }),
  );

  // POST /ingest/telemetry — versioned alias of the LIVE POST /api/ot/ingest (doc 56
  // AIR-8). Same unified bus (ingestTelemetry) + same per-machine credential model,
  // but under /api/v1 with the {ok,data,error} envelope so the TELEMETRY path is
  // finally visible in the published OpenAPI. Body: { samples: CanonicalSample[] }
  // (or a bare array). Auth is the shared ingest:write scope (requireScope above).
  r.post(
    "/ingest/telemetry",
    requireScope(API_SCOPES.INGEST_WRITE),
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as { samples?: unknown } | unknown[];
      const rawSamples = Array.isArray(body) ? body : (body as { samples?: unknown }).samples;
      if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
        throw new ApiHttpError(400, "bad_request", "Body must be { samples: [ ... ] } (or a bare array) with at least one sample.");
      }
      const samples = rawSamples.map(toCanonicalSample);
      const { ingestTelemetry } = await import("../../services/telemetryBus");
      const accepted = await ingestTelemetry(samples);
      sendOk(
        res,
        {
          accepted,
          received: samples.length,
          machine: req.apiPrincipal?.kind === "machine" ? req.apiPrincipal.name : undefined,
        },
        202,
      );
    }),
  );

  // ── Orchestration (E2) — Factory Orchestration Engine via the build-own FOE. ──
  // Control still routes through the E0 equipmentRegistry → existing HITL/dry-run
  // dispatcher. Flag-gated by FOE_ENABLED (off → a structured `disabled` envelope).

  // POST /orchestration/workflows — deploy (validate + persist) a workflow definition.
  r.post(
    "/orchestration/workflows",
    requireScope(API_SCOPES.ORCHESTRATION_WRITE),
    wrap(async (req, res) => {
      const { deployWorkflow } = await import("../../services/orchestration/foe/foeEngine");
      const def = (req.body ?? {}) as never;
      const principal = req.apiPrincipal?.name ?? "api-key";
      const result = await deployWorkflow(def, { id: 0, role: "api", name: principal });
      if (!result.enabled) {
        return sendError(res, 503, "foe_disabled", "Orchestration engine is disabled (FOE_ENABLED).", { phase: "E2" });
      }
      if (!result.ok) {
        throw new ApiHttpError(400, "invalid_workflow", result.message ?? "Workflow validation failed.", {
          errors: result.errors ?? [],
        });
      }
      sendOk(res, { workflowId: result.workflowId, ref: result.ref, version: result.version }, 201);
    }),
  );

  // POST /orchestration/runs — start a run of a deployed workflow { workflowRef, params }.
  r.post(
    "/orchestration/runs",
    requireScope(API_SCOPES.ORCHESTRATION_WRITE),
    wrap(async (req, res) => {
      const { startRun } = await import("../../services/orchestration/foe/foeEngine");
      const body = (req.body ?? {}) as { workflowRef?: string; params?: Record<string, unknown> };
      if (!body.workflowRef || typeof body.workflowRef !== "string") {
        throw new ApiHttpError(400, "bad_request", "Body field `workflowRef` is required.");
      }
      const principal = req.apiPrincipal?.name ?? "api-key";
      const result = await startRun(body.workflowRef, body.params ?? {}, { id: 0, role: "api", name: principal });
      if (!result.enabled) {
        return sendError(res, 503, "foe_disabled", "Orchestration engine is disabled (FOE_ENABLED).", { phase: "E2" });
      }
      void emit("orchestration.run.finished", {
        runId: result.runId,
        workflowRef: body.workflowRef,
        status: result.status,
      });
      sendOk(res, { runId: result.runId, status: result.status, accepted: result.ok }, 202);
    }),
  );

  // POST /orchestration/simulate — DIGITAL-TWIN (E3a): predict a workflow WITHOUT dispatch.
  // Read-only (no control) → orchestration:read. PURE + fail-safe; NOT flag-gated.
  // Body: { workflow?, workflowRef?, params?, assumedTelemetry?, commandDurations?, defaultCommandMs?, gateMs? }.
  r.post(
    "/orchestration/simulate",
    requireScope(API_SCOPES.ORCHESTRATION_READ),
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as {
        workflow?: unknown;
        workflowRef?: string;
        params?: Record<string, unknown>;
        assumedTelemetry?: Record<string, Record<string, unknown>>;
        commandDurations?: Record<string, number>;
        defaultCommandMs?: number;
        gateMs?: number;
      };
      const { simulateWorkflow } = await import("../../services/orchestration/foe/foeSimulator");
      const { validateWorkflow } = await import("../../services/orchestration/foe/workflowModel");

      // Resolve the definition: inline `workflow` wins, else load by `workflowRef`.
      let def: import("../../services/orchestration/foe/workflowModel").WorkflowDefinition;
      if (body.workflow && typeof body.workflow === "object") {
        def = body.workflow as never;
      } else if (typeof body.workflowRef === "string" && body.workflowRef) {
        const { getDb } = await import("../../db/connection");
        const { orchestrationWorkflows } = await import("../../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const d = await getDb();
        if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");
        const [wf] = await d
          .select()
          .from(orchestrationWorkflows)
          .where(eq(orchestrationWorkflows.ref, body.workflowRef))
          .limit(1);
        if (!wf) throw new ApiHttpError(404, "not_found", `Workflow "${body.workflowRef}" not found.`);
        def = wf.definitionJson as never;
      } else {
        throw new ApiHttpError(400, "bad_request", "Provide either `workflow` or `workflowRef`.");
      }

      // Load referenced machine rows for capability resolution (PURE simulator input).
      const refIds = new Set(validateWorkflow(def, null).referencedMachineIds);
      const machineRows: Array<{ id: number; machineType: string; capabilities?: unknown }> = [];
      if (refIds.size > 0) {
        const { getDb } = await import("../../db/connection");
        const { machines } = await import("../../../drizzle/schema");
        const d = await getDb();
        if (d) {
          const rows = await d.select().from(machines);
          for (const m of rows) {
            if (refIds.has(m.id)) {
              machineRows.push({ id: m.id, machineType: m.machineType, capabilities: m.capabilities });
            }
          }
        }
      }

      const assumedTelemetry = body.assumedTelemetry
        ? Object.fromEntries(
            Object.entries(body.assumedTelemetry).map(([k, v]) => [Number(k), v as Record<string, unknown>]),
          )
        : undefined;

      const result = simulateWorkflow(def, body.params ?? {}, {
        machines: machineRows,
        assumedTelemetry,
        commandDurations: body.commandDurations,
        defaultCommandMs: body.defaultCommandMs,
        gateMs: body.gateMs,
      });
      sendOk(res, result);
    }),
  );

  // GET /orchestration/runs/:id — run status + per-step audit.
  r.get(
    "/orchestration/runs/:id",
    requireScope(API_SCOPES.ORCHESTRATION_READ),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new ApiHttpError(400, "bad_request", "Invalid run id.");
      }
      const { getRun } = await import("../../services/orchestration/foe/foeEngine");
      const view = await getRun(id);
      if (!view) throw new ApiHttpError(404, "not_found", `Run ${id} not found.`);
      sendOk(res, {
        run: {
          id: view.run.id,
          workflowId: view.run.workflowId,
          workflowRef: view.run.workflowRef,
          status: view.run.status,
          currentStepId: view.run.currentStepId,
          startedAt: view.run.startedAt,
          finishedAt: view.run.finishedAt,
          error: view.run.error,
        },
        steps: view.steps,
      });
    }),
  );

  // ── Edge control runtime (E4) — a headless edge node syncs run results back. ──
  // Authenticated via a scoped API key with the "edge:sync" scope. Idempotent
  // (reconcile upserts on runId+stepId). Flag-gated by EDGE_RUNTIME_ENABLED (off →
  // a structured `disabled` envelope). HONEST: coordination only; safety stays on PLC.
  r.post(
    "/edge/sync",
    requireScope(API_SCOPES.EDGE_SYNC),
    wrap(async (req, res) => {
      const { syncRunResult } = await import("../../services/edge/edgeCoordinator");
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.runId || typeof body.runId !== "number") {
        throw new ApiHttpError(400, "bad_request", "Body field `runId` (number) is required.");
      }
      // The node identity comes from the body but the API key is the real auth.
      const payload = {
        edgeNodeCode: typeof body.edgeNodeCode === "string" ? body.edgeNodeCode : (req.apiPrincipal?.name ?? "edge"),
        runId: body.runId,
        status: typeof body.status === "string" ? body.status : "running",
        error: (body.error as string | null) ?? null,
        currentStepId: (body.currentStepId as string | null) ?? null,
        contextJson: (body.contextJson as Record<string, unknown> | null) ?? null,
        startedAt: (body.startedAt as string | null) ?? null,
        finishedAt: (body.finishedAt as string | null) ?? null,
        steps: Array.isArray(body.steps) ? (body.steps as never[]) : [],
      };
      const result = await syncRunResult(payload as never);
      if (!result.enabled) {
        return sendError(res, 503, "edge_disabled", "Edge runtime is disabled (EDGE_RUNTIME_ENABLED).", { phase: "E4" });
      }
      if (!result.ok) {
        throw new ApiHttpError(400, "edge_sync_failed", result.message ?? "Edge sync failed.");
      }
      sendOk(res, result.data, 202);
    }),
  );

  // ── OAuth2 client-credentials (K0+-a) — POST /oauth/token. ──────────────────
  // ADDITIVE machine-to-machine auth for ERP partners; issues a short-lived signed
  // JWT carrying scopes. Gated by ERP_OAUTH_ENABLED (off → structured 503). The
  // issued token is accepted as an alternative Bearer on /orders /bom (auth.ts).
  registerErpOauthRoutes(r);

  // ── Inbound ERP intake (R0 Khối 0) — POST /orders, POST /bom. ───────────────
  // Idempotent (X-Idempotency-Key), versioned (schemaVersion), erp:write scope,
  // gated by ERP_INBOUND_ENABLED (off → structured 503). Emits order.created.
  // Accepts JSON or B2MML XML (K0+-b, ERP_B2MML_ENABLED) — same upsert path.
  registerErpIntakeRoutes(r);

  // ── U4a (doc 21 §6 U4 / §3 G-6) — open the NEW upper-layer modules to /api/v1. ──
  // READ-ONLY, scope-gated (fleet/safety/twin/programs/pdm/anomaly/standards + the
  // equipment:read-scoped ecosystem roll-up + cockpit). Each endpoint reuses the SAME
  // service functions the corresponding tRPC router calls — no logic duplication, no
  // new device-control path. Writes/actions stay behind the existing gated tRPC flow.
  registerModuleReadRoutes(r);

  // ── W0-F (doc 44) — PdM asset health + prediction history (READ, pdm:read). ──
  registerPdmHealthRoutes(r);

  // ── W0-F G4.27 (doc 44) — AI model registry: catalogue + drift (models:read),
  // promote/rollback (models:write, gated by V1_MODEL_MUTATIONS_ENABLED, default
  // OFF → structured 501). Mutations wrap the SAME internal lifecycle paths.
  registerModelRegistryRoutes(r);

  // ── W2-A2 (doc 44 G1.10-G1.12) — SYNAPSE control-plane asset registry:
  // /assets discovery + detail + lifecycle (validated transitions) + health +
  // tags + config-drift (view/approve), /adapters/:id/restart (gated by
  // V1_ADAPTER_RESTART_ENABLED, default OFF → 501), /gateways/:id/status.
  registerAssetRoutes(r);

  // ── W2-B1 (doc 44 G2.16-G2.18) — SYNAPSE Tầng-2 Access APIs (scope data:read):
  // GET /state/{path+} (state store + real state-read-p95 SLO feed), POST
  // /query/timeseries (time_bucket khi Timescale, epoch-floor plain-PG fallback),
  // GET /events (andon ∪ safety ∪ interlock, union Event shape), GET
  // /metrics/{metric} (semantic layer — computeMetric + definition_version),
  // GET /genealogy/{unitId} + POST /genealogy/search (spec §10.3 record).
  registerStateRoutes(r);
  registerTimeseriesRoutes(r);
  registerEventRoutes(r);
  registerMetricRoutes(r);
  registerGenealogyRoutes(r);

  // ── W3-A (doc 44) — SYNAPSE Tầng-3 Điều phối: Policy §13.3 + Line Controller
  // §13.2 + Order lifecycle §13.1. Mọi lệnh line/order đi qua policy seam.
  registerPolicyRoutes(r);
  registerLineRoutes(r);
  registerOrdersLifecycleRoutes(r);
  // W5-A3 (doc 44 G4.30) — SYNAPSE Tầng-4 Advice API: POST /predict/{task},
  // POST /recommend, GET /recommendations. Scope advice:read; advisory-only.
  registerAdviceRoutes(r);

  // GET /openapi.json — the published contract (no auth; describes only).
  r.get(
    "/openapi.json",
    wrap((req, res) => {
      const proto = (req.header("x-forwarded-proto") || req.protocol || "http").split(",")[0];
      const host = req.header("x-forwarded-host") || req.get("host") || "";
      const serverUrl = host ? `${proto}://${host}` : "/";
      res.status(200).json(buildV1OpenApiSpec(serverUrl));
    }),
  );

  // Unknown /api/v1/* path → structured 404 envelope.
  r.use((_req, res) => sendError(res, 404, "not_found", "Unknown /api/v1 endpoint."));

  return r;
}
