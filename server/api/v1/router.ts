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
import {
  getCapabilitiesForMachine,
  type EquipmentCapability,
  type CommandDescriptor,
} from "../../services/equipment/capabilityModel";
import { equipmentRegistry, type EquipmentCommand } from "../../services/equipment/equipmentAdapter";

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

// ── router ──────────────────────────────────────────────────────────────────

/** Build the /api/v1 router (mounted in server/_core/index.ts). */
export function createV1Router(): Router {
  const r = Router();
  // The parent app may already parse JSON, but make this router self-contained.
  r.use(jsonBody({ limit: "25mb" }));

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

  // GET /equipment/:id/telemetry?from=&to= — recent telemetry.
  r.get(
    "/equipment/:id/telemetry",
    requireScope(API_SCOPES.EQUIPMENT_READ),
    wrap(async (req, res) => {
      const m = await loadMachine(Number(req.params.id));
      const { getLatestTelemetry } = await import("../../db/otTelemetry");
      // E1: latest known samples (newest first). from/to are echoed; deep historical
      // range queries land with the timeseries store integration later.
      const rows = await getLatestTelemetry({ machineId: m.id, limit: 50 }).catch(() => []);
      sendOk(res, {
        machineId: m.id,
        from: (req.query.from as string) ?? null,
        to: (req.query.to as string) ?? null,
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

  // ── Orchestration stubs (E2) — published now so the contract is fixed. ──
  const notImplemented = (res: Response) =>
    sendError(res, 501, "not_implemented", "Orchestration is coming in Phase E2.", { phase: "E2" });

  r.post("/orchestration/workflows", requireScope(API_SCOPES.ORCHESTRATION_WRITE), wrap((_req, res) => notImplemented(res)));
  r.post("/orchestration/runs", requireScope(API_SCOPES.ORCHESTRATION_WRITE), wrap((_req, res) => notImplemented(res)));
  r.get("/orchestration/runs/:id", requireScope(API_SCOPES.ORCHESTRATION_READ), wrap((_req, res) => notImplemented(res)));

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
