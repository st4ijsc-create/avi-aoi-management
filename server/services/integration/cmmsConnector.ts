/**
 * CMMS CONNECTOR — doc 44 W6-5 (G5.24) · SYNAPSE_Tang5 §8–9 (CMMS integration).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Bridges the maintenance loop to a Computerised Maintenance Management System:
 *
 *   OUTBOUND (durable outbox): push PdM/RUL maintenance RECOMMENDATIONS to the CMMS.
 *     REUSES the existing PdM output — the PREDICTIVE work orders that
 *     pdmAutoWorkOrderService already creates (doc 16 R0-2) — WITHOUT modifying that
 *     service: syncPredictiveWorkOrdersToCmms() reads the open PREDICTIVE work orders
 *     and pushes each, idempotent per work-order number.
 *
 *   INBOUND (poll → anti-corruption map → upsert): receive maintenance SCHEDULES /
 *     requests from the CMMS and upsert them into canonical maintenance_schedules.
 *
 * CMMS asset ids / field names are translated by a PURE map and resolved to a
 * canonical machineId via enterprise_id_map or machine code — CMMS semantics never
 * leak in. Gated by CMMS_INTEGRATION_ENABLED (default OFF).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  enqueueEnterpriseOutbound,
  upsertIdMap,
  resolveInternalId,
  recordSync,
  pullExternalJson,
  getPath,
  toNumber,
  cmmsEnabled,
  type EnterpriseOutboundResult,
} from "./enterpriseIntegrationCore";

const SYSTEM = "cmms" as const;

function outboundEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CMMS_OUTBOUND_ENDPOINT ?? env.CMMS_ENDPOINT ?? "").trim();
}

async function conn(): Promise<any | null> {
  try {
    const { getDb } = await import("../../db/connection");
    return (await getDb()) ?? null;
  } catch {
    return null;
  }
}

// ── OUTBOUND: push maintenance recommendation ────────────────────────────────

export interface MaintenanceRecommendationInput {
  workOrderNumber: string;
  machineId: number;
  machineCode?: string | null;
  failureRisk?: number | null;
  urgency?: string | null;
  predictedTimeframe?: string | null;
  priority?: number | null;
  title?: string | null;
  description?: string | null;
  scheduledFor?: string | null;
  corporateCode?: string | null;
  idempotencyKey?: string;
}

/** Push one predictive-maintenance recommendation to the CMMS. Durable + idempotent. */
export function pushMaintenanceRecommendation(input: MaintenanceRecommendationInput): Promise<EnterpriseOutboundResult> {
  const idem = input.idempotencyKey ?? `cmms-rec-${input.workOrderNumber}`;
  return enqueueEnterpriseOutbound({
    system: SYSTEM,
    family: "production-event",
    kind: "cmms.maintenance.recommendation",
    payload: {
      workOrderNumber: input.workOrderNumber,
      machineId: input.machineId,
      machineCode: input.machineCode ?? null,
      failureRisk: input.failureRisk ?? null,
      urgency: input.urgency ?? null,
      predictedTimeframe: input.predictedTimeframe ?? null,
      priority: input.priority ?? null,
      title: input.title ?? null,
      description: input.description ?? null,
      scheduledFor: input.scheduledFor ?? null,
      recommendedAt: new Date().toISOString(),
    },
    idempotencyKey: idem,
    targetEndpoint: outboundEndpoint(),
    corporateCode: input.corporateCode ?? null,
  });
}

export interface SyncPredictiveResult { ok: boolean; found: number; pushed: number; duplicate: number; disabled?: boolean; error?: string }

/**
 * Push every OPEN predictive work order (as created by pdmAutoWorkOrderService) to
 * the CMMS. Idempotent per work-order number (the outbox dedupes), so re-running
 * across cycles never double-sends. No-op (disabled) when CMMS_INTEGRATION_ENABLED
 * is off. Fail-safe.
 */
export async function syncPredictiveWorkOrdersToCmms(limit = 100): Promise<SyncPredictiveResult> {
  if (!cmmsEnabled()) return { ok: false, found: 0, pushed: 0, duplicate: 0, disabled: true };
  try {
    const d = await conn();
    if (!d) return { ok: false, found: 0, pushed: 0, duplicate: 0, error: "db unavailable" };
    const { maintenanceWorkOrders } = await import("../../../drizzle/schema");
    const rows = await d
      .select({
        workOrderNumber: maintenanceWorkOrders.workOrderNumber,
        machineId: maintenanceWorkOrders.machineId,
        machineCode: maintenanceWorkOrders.machineCode,
        predictedFailureRisk: maintenanceWorkOrders.predictedFailureRisk,
        priority: maintenanceWorkOrders.priority,
        title: maintenanceWorkOrders.title,
        description: maintenanceWorkOrders.description,
        scheduledFor: maintenanceWorkOrders.scheduledFor,
      })
      .from(maintenanceWorkOrders)
      .where(and(eq(maintenanceWorkOrders.type, "PREDICTIVE"), inArray(maintenanceWorkOrders.status, ["OPEN", "SCHEDULED", "IN_PROGRESS"] as never)))
      .limit(Math.min(Math.max(limit, 1), 500));
    let pushed = 0;
    let duplicate = 0;
    for (const r of rows) {
      const res = await pushMaintenanceRecommendation({
        workOrderNumber: r.workOrderNumber,
        machineId: r.machineId,
        machineCode: r.machineCode,
        failureRisk: r.predictedFailureRisk == null ? null : Number(r.predictedFailureRisk),
        priority: r.priority,
        title: r.title,
        description: r.description,
        scheduledFor: r.scheduledFor ? new Date(r.scheduledFor).toISOString() : null,
      });
      if (res.duplicate) duplicate += 1;
      else if (res.ok) pushed += 1;
    }
    return { ok: true, found: rows.length, pushed, duplicate };
  } catch (err) {
    return { ok: false, found: 0, pushed: 0, duplicate: 0, error: (err as Error)?.message ?? String(err) };
  }
}

// ── INBOUND: maintenance schedule (anti-corruption) ──────────────────────────

/** PURE map: CMMS schedule → canonical maintenance-schedule shape. Whitelist only. */
export interface CanonicalSchedule {
  externalId: string;
  machineExternalId: string | null;
  machineCode: string | null;
  taskName: string;
  description: string | null;
  scheduleType: "TIME_BASED" | "USAGE_BASED" | "CONDITION_BASED" | "PREDICTIVE";
  intervalDays: number | null;
  nextDueAt: string | null;
}

function pickStr(obj: unknown, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = getPath(obj, k);
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

export function mapCmmsScheduleType(t: string | undefined): CanonicalSchedule["scheduleType"] {
  const s = (t ?? "").toLowerCase();
  if (/(usage|meter|runtime|hours)/.test(s)) return "USAGE_BASED";
  if (/(condition|cbm)/.test(s)) return "CONDITION_BASED";
  if (/(predict|pdm|rul)/.test(s)) return "PREDICTIVE";
  return "TIME_BASED";
}

export function mapCmmsSchedule(raw: unknown): CanonicalSchedule | null {
  const externalId = pickStr(raw, ["id", "scheduleId", "pmId", "taskId", "number"]);
  const taskName = pickStr(raw, ["taskName", "title", "name", "description", "pmName"]);
  if (!externalId || !taskName) return null;
  return {
    externalId,
    machineExternalId: pickStr(raw, ["assetId", "equipmentId", "machineExternalId", "asset"]) ?? null,
    machineCode: pickStr(raw, ["machineCode", "assetCode", "equipmentCode", "assetTag"]) ?? null,
    taskName,
    description: pickStr(raw, ["description", "instructions", "notes"]) ?? null,
    scheduleType: mapCmmsScheduleType(pickStr(raw, ["scheduleType", "type", "pmType", "basis"])),
    intervalDays: toNumber(getPath(raw, "intervalDays") ?? getPath(raw, "frequencyDays") ?? getPath(raw, "interval")),
    nextDueAt: pickStr(raw, ["nextDueAt", "nextDue", "dueDate", "nextDueDate"]) ?? null,
  };
}

/** Resolve a canonical machineId from CMMS refs: id-map first, then machine code. */
async function resolveMachineId(d: any, sched: CanonicalSchedule): Promise<number | null> {
  if (sched.machineExternalId) {
    const mapped = await resolveInternalId(SYSTEM, "machine", sched.machineExternalId);
    if (mapped) {
      const n = Number(mapped);
      if (Number.isFinite(n)) return n;
    }
  }
  if (sched.machineCode) {
    try {
      const { machines } = await import("../../../drizzle/schema");
      const rows = await d.select({ id: machines.id }).from(machines).where(eq(machines.code, sched.machineCode)).limit(1);
      if (rows[0]) return rows[0].id;
    } catch {
      /* machines lookup best-effort */
    }
  }
  return null;
}

export interface UpsertScheduleResult { ok: boolean; id?: number; created?: boolean; skipped?: boolean; error?: string }

/**
 * Upsert a canonical maintenance schedule. Idempotent: keyed by the CMMS externalId
 * via enterprise_id_map (falls back to machineId+taskName). Skips (not error) when
 * the machine can't be resolved. Fail-safe.
 */
export async function upsertMaintenanceSchedule(sched: CanonicalSchedule): Promise<UpsertScheduleResult> {
  try {
    const d = await conn();
    if (!d) return { ok: false, error: "db unavailable" };
    const { maintenanceSchedules } = await import("../../../drizzle/schema");
    const machineId = await resolveMachineId(d, sched);
    if (machineId == null) return { ok: false, skipped: true, error: `unresolved machine for CMMS schedule ${sched.externalId}` };

    const values = {
      machineId,
      machineCode: sched.machineCode,
      scheduleType: sched.scheduleType,
      taskName: sched.taskName,
      description: sched.description,
      intervalDays: sched.intervalDays,
      nextDueAt: sched.nextDueAt ? new Date(sched.nextDueAt) : null,
    };

    // Prefer an existing row via the id-map (stable across CMMS renames of taskName).
    const mappedInternal = await resolveInternalId(SYSTEM, "maintenance_schedule", sched.externalId);
    let existingId: number | null = mappedInternal != null && Number.isFinite(Number(mappedInternal)) ? Number(mappedInternal) : null;
    if (existingId == null) {
      const found = await d
        .select({ id: maintenanceSchedules.id })
        .from(maintenanceSchedules)
        .where(and(eq(maintenanceSchedules.machineId, machineId), eq(maintenanceSchedules.taskName, sched.taskName)))
        .limit(1);
      existingId = found[0]?.id ?? null;
    }

    let id: number;
    let created: boolean;
    if (existingId != null) {
      await d.update(maintenanceSchedules).set({ ...values, updatedAt: new Date() }).where(eq(maintenanceSchedules.id, existingId));
      id = existingId;
      created = false;
    } else {
      const [row] = await d.insert(maintenanceSchedules).values(values).returning({ id: maintenanceSchedules.id });
      id = row.id;
      created = true;
    }
    await upsertIdMap({ system: SYSTEM, entityType: "maintenance_schedule", externalId: sched.externalId, internalId: id });
    return { ok: true, id, created };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/** Map + upsert one CMMS schedule + audit. Fail-safe. */
export async function ingestCmmsSchedule(raw: unknown): Promise<UpsertScheduleResult> {
  const sched = mapCmmsSchedule(raw);
  if (!sched) {
    await recordSync({ system: SYSTEM, direction: "inbound", operation: "cmms.schedule.upsert", status: "error", detail: { error: "unmappable schedule" } });
    return { ok: false, error: "unmappable schedule" };
  }
  const res = await upsertMaintenanceSchedule(sched);
  await recordSync({
    system: SYSTEM,
    direction: "inbound",
    operation: "cmms.schedule.upsert",
    externalId: sched.externalId,
    internalId: res.id ?? null,
    status: res.skipped ? "skipped" : res.ok ? "ok" : "error",
    detail: { created: res.created ?? null, error: res.error ?? null },
  });
  return res;
}

export interface PullSchedulesConfig {
  url: string;
  itemsPath?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface PullSchedulesResult { ok: boolean; ingested: number; skipped: number; failed: number; disabled?: boolean; error?: string }

/**
 * Poll the CMMS for maintenance schedules and upsert each. AUTONOMOUS: transport
 * failures are caught + logged (never thrown); an unresolved machine is skipped, not
 * fatal. No-op (disabled) when CMMS_INTEGRATION_ENABLED is off.
 */
export async function pullSchedules(cfg: PullSchedulesConfig): Promise<PullSchedulesResult> {
  if (!cmmsEnabled()) return { ok: false, ingested: 0, skipped: 0, failed: 0, disabled: true };
  try {
    const body = await pullExternalJson({ url: cfg.url, headers: cfg.headers, timeoutMs: cfg.timeoutMs, fetchImpl: cfg.fetchImpl });
    const arr = getPath(body, cfg.itemsPath ?? "items");
    const list = Array.isArray(arr) ? arr : Array.isArray(body) ? (body as unknown[]) : [];
    let ingested = 0;
    let skipped = 0;
    let failed = 0;
    for (const raw of list) {
      const r = await ingestCmmsSchedule(raw);
      if (r.ok) ingested += 1;
      else if (r.skipped) skipped += 1;
      else failed += 1;
    }
    return { ok: true, ingested, skipped, failed };
  } catch (err) {
    const error = (err as Error)?.message ?? String(err);
    await recordSync({ system: SYSTEM, direction: "inbound", operation: "cmms.schedule.pull", status: "error", detail: { error } });
    return { ok: false, ingested: 0, skipped: 0, failed: 0, error };
  }
}
