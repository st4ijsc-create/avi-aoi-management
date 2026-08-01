/**
 * Enterprise Integration CORE — doc 44 W6-5 (G5.24) · SYNAPSE_Tang5 §8–9.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Shared substrate for the WMS / PLM / CMMS connectors. Every connector is:
 *   • ASYNCHRONOUS — outbound goes through the EXISTING durable outbox
 *     (integration_outbox + circuit-breaker + dead-letter), not a blocking call;
 *   • IDEMPOTENT — outbound dedupes on a deterministic idempotency key (the outbox
 *     already enforces this); inbound dedupes on enterprise_sync_log's partial
 *     unique (system, operation, idempotencyKey);
 *   • AUTONOMOUS when the external system is down — enqueue/persist never throws
 *     into the caller's path, so production is never blocked by a dead partner;
 *   • ANTI-CORRUPTION — external identifiers live in enterprise_id_map, never
 *     inside canonical rows; canonical upserts receive a whitelisted shape only.
 *
 * This module owns: per-system feature flags, the id-map, the sync-log (audit +
 * inbound idempotency), the outbound bridge onto the outbox, and a generic REST
 * pull helper (timeout + auth + injectable fetch for tests). It does NOT modify
 * erpOutbox/erpIntake — it REUSES enqueueOutbox and mirrors the intake patterns.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  enqueueOutbox,
  type OutboxEventType,
  type EnqueueResult,
} from "./erpOutbox";
import type { EnterpriseSystem } from "../../../drizzle/schema/enterpriseIntegration";

export type { EnterpriseSystem };
export type SyncDirection = "inbound" | "outbound";
export type SyncStatus = "ok" | "error" | "skipped" | "duplicate";

// ── Per-system feature flags (each default OFF) ──────────────────────────────

function flagOn(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env[name] === "true" || env[name] === "1";
}

export const WMS_FLAG = "WMS_INTEGRATION_ENABLED";
export const PLM_FLAG = "PLM_INTEGRATION_ENABLED";
export const CMMS_FLAG = "CMMS_INTEGRATION_ENABLED";

export function wmsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagOn(WMS_FLAG, env);
}
export function plmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagOn(PLM_FLAG, env);
}
export function cmmsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagOn(CMMS_FLAG, env);
}

/** Is a given external system's connector enabled? */
export function systemEnabled(system: EnterpriseSystem, env: NodeJS.ProcessEnv = process.env): boolean {
  switch (system) {
    case "wms": return wmsEnabled(env);
    case "plm": return plmEnabled(env);
    case "cmms": return cmmsEnabled(env);
    default: return false;
  }
}

/** Snapshot of all connector flags (for the admin surface). */
export function connectorFlags(env: NodeJS.ProcessEnv = process.env): Record<EnterpriseSystem, boolean> {
  return { wms: wmsEnabled(env), plm: plmEnabled(env), cmms: cmmsEnabled(env) };
}

// ── DB helper (dynamic import → tests mock ../../db/connection) ───────────────

async function db(): Promise<any | null> {
  try {
    const { getDb } = await import("../../db/connection");
    return (await getDb()) ?? null;
  } catch {
    return null;
  }
}

async function schema() {
  return import("../../../drizzle/schema");
}

// ── Anti-corruption ID map ───────────────────────────────────────────────────

export interface UpsertIdMapInput {
  system: EnterpriseSystem;
  entityType: string;
  externalId: string;
  internalId?: string | number | null;
  externalRef?: Record<string, unknown> | null;
  corporateCode?: string | null;
}

/**
 * Upsert an (system, entityType, externalId) → internalId mapping. Fail-safe:
 * returns false on any error/DB-absent (the connector treats mapping as best-effort
 * bookkeeping and never blocks the sync on it).
 */
export async function upsertIdMap(input: UpsertIdMapInput): Promise<boolean> {
  try {
    const d = await db();
    if (!d) return false;
    const { enterpriseIdMap } = await schema();
    const internalId = input.internalId == null ? null : String(input.internalId);
    const existing = await d
      .select({ id: enterpriseIdMap.id })
      .from(enterpriseIdMap)
      .where(
        and(
          eq(enterpriseIdMap.system, input.system),
          eq(enterpriseIdMap.entityType, input.entityType),
          eq(enterpriseIdMap.externalId, input.externalId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await d
        .update(enterpriseIdMap)
        .set({
          internalId,
          externalRef: (input.externalRef ?? null) as never,
          corporateCode: input.corporateCode ?? null,
          updatedAt: new Date(),
        })
        .where(eq(enterpriseIdMap.id, existing[0].id));
    } else {
      await d.insert(enterpriseIdMap).values({
        system: input.system,
        entityType: input.entityType,
        externalId: input.externalId,
        internalId,
        externalRef: (input.externalRef ?? null) as never,
        corporateCode: input.corporateCode ?? null,
      });
    }
    return true;
  } catch (err) {
    console.error("[enterpriseCore] upsertIdMap failed:", (err as Error)?.message ?? err);
    return false;
  }
}

/** Resolve the canonical internal id for an external id. null when unmapped. */
export async function resolveInternalId(
  system: EnterpriseSystem,
  entityType: string,
  externalId: string,
): Promise<string | null> {
  try {
    const d = await db();
    if (!d) return null;
    const { enterpriseIdMap } = await schema();
    const rows = await d
      .select({ internalId: enterpriseIdMap.internalId })
      .from(enterpriseIdMap)
      .where(
        and(
          eq(enterpriseIdMap.system, system),
          eq(enterpriseIdMap.entityType, entityType),
          eq(enterpriseIdMap.externalId, externalId),
        ),
      )
      .limit(1);
    return rows[0]?.internalId ?? null;
  } catch {
    return null;
  }
}

export async function listIdMap(opts: { system?: EnterpriseSystem; entityType?: string; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  try {
    const d = await db();
    if (!d) return [];
    const { enterpriseIdMap } = await schema();
    const preds = [];
    if (opts.system) preds.push(eq(enterpriseIdMap.system, opts.system));
    if (opts.entityType) preds.push(eq(enterpriseIdMap.entityType, opts.entityType));
    const q = d.select().from(enterpriseIdMap);
    const rows = await (preds.length ? q.where(and(...preds)) : q)
      .orderBy(desc(enterpriseIdMap.updatedAt))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500));
    return rows as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

// ── Sync log (audit + inbound idempotency) ───────────────────────────────────

export interface RecordSyncInput {
  system: EnterpriseSystem;
  direction: SyncDirection;
  operation: string;
  externalId?: string | null;
  internalId?: string | number | null;
  idempotencyKey?: string | null;
  status?: SyncStatus;
  detail?: Record<string, unknown> | null;
}

/**
 * Record a sync operation. When an idempotencyKey is supplied, a racing/duplicate
 * key is treated as `duplicate` (the caller uses this for inbound de-dup). Fail-safe.
 */
export async function recordSync(input: RecordSyncInput): Promise<{ recorded: boolean; duplicate: boolean }> {
  try {
    const d = await db();
    if (!d) return { recorded: false, duplicate: false };
    const { enterpriseSyncLog } = await schema();
    await d.insert(enterpriseSyncLog).values({
      system: input.system,
      direction: input.direction,
      operation: input.operation,
      externalId: input.externalId ?? null,
      internalId: input.internalId == null ? null : String(input.internalId),
      idempotencyKey: input.idempotencyKey ?? null,
      status: input.status ?? "ok",
      detail: (input.detail ?? null) as never,
    });
    return { recorded: true, duplicate: false };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    // A unique-violation on the partial idempotency index → this op already ran.
    if (/duplicate key|unique/i.test(msg)) return { recorded: false, duplicate: true };
    console.error("[enterpriseCore] recordSync failed:", msg);
    return { recorded: false, duplicate: false };
  }
}

/**
 * Has an inbound op with this idempotency key already been applied? Used to skip a
 * replayed inbound message (in addition to the DB unique guard). Fail-safe → false
 * (worst case: a natural-key upsert re-runs harmlessly).
 */
export async function wasSyncApplied(system: EnterpriseSystem, operation: string, idempotencyKey: string): Promise<boolean> {
  try {
    const d = await db();
    if (!d) return false;
    const { enterpriseSyncLog } = await schema();
    const rows = await d
      .select({ id: enterpriseSyncLog.id })
      .from(enterpriseSyncLog)
      .where(
        and(
          eq(enterpriseSyncLog.system, system),
          eq(enterpriseSyncLog.operation, operation),
          eq(enterpriseSyncLog.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function listSyncLog(opts: { system?: EnterpriseSystem; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  try {
    const d = await db();
    if (!d) return [];
    const { enterpriseSyncLog } = await schema();
    const q = d.select().from(enterpriseSyncLog);
    const rows = await (opts.system ? q.where(eq(enterpriseSyncLog.system, opts.system)) : q)
      .orderBy(desc(enterpriseSyncLog.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 50, 1), 500));
    return rows as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

/** Counts grouped by (system, status) for the admin health surface. */
export async function syncStatusSummary(): Promise<Array<{ system: string; status: string; count: number }>> {
  try {
    const d = await db();
    if (!d) return [];
    const { enterpriseSyncLog } = await schema();
    const rows = await d
      .select({ system: enterpriseSyncLog.system, status: enterpriseSyncLog.status, count: sql<number>`count(*)` })
      .from(enterpriseSyncLog)
      .groupBy(enterpriseSyncLog.system, enterpriseSyncLog.status);
    return rows.map((r: any) => ({ system: r.system, status: r.status, count: Number(r.count) }));
  } catch {
    return [];
  }
}

// ── Outbound bridge onto the durable outbox ──────────────────────────────────

export interface EnterpriseOutboundInput {
  system: EnterpriseSystem;
  /**
   * The outbox event FAMILY to carry this on. erpOutbox's event-type vocabulary is
   * intentionally NOT extended in this batch (we don't touch erpOutbox); like
   * publishOrderCompletion (W3-A3) we REUSE an existing family and discriminate with
   * `kind` in the payload. The receiving system is selected by targetEndpoint.
   */
  family: OutboxEventType;
  /** Discriminator, e.g. "wms.material.request". Stored under payload.kind. */
  kind: string;
  payload: Record<string, unknown>;
  /** Deterministic dedup key → the outbox never double-publishes a retried event. */
  idempotencyKey: string;
  targetEndpoint: string;
  corporateCode?: string | null;
}

export interface EnterpriseOutboundResult extends EnqueueResult {
  /** true when the system flag was OFF (nothing enqueued — no-op). */
  disabled?: boolean;
  /** true when no targetEndpoint was configured (family not subscribed). */
  noEndpoint?: boolean;
}

/**
 * Enqueue an outbound enterprise event onto the durable outbox. NO-OP (disabled)
 * when the system's own flag is OFF; NO-OP (noEndpoint) when no endpoint is
 * configured. Idempotent (outbox dedupes on idempotencyKey). Fail-safe — never
 * throws into the connector. NOTE: actual DELIVERY additionally requires the outbox
 * worker (ERP_OUTBOX_ENABLED); until then rows sit `pending` and drain when it starts.
 */
export async function enqueueEnterpriseOutbound(input: EnterpriseOutboundInput): Promise<EnterpriseOutboundResult> {
  if (!systemEnabled(input.system)) return { ok: false, disabled: true, reason: `${input.system} connector disabled` };
  if (!input.targetEndpoint || !input.targetEndpoint.trim()) return { ok: false, noEndpoint: true, reason: "no endpoint configured" };
  try {
    const res = await enqueueOutbox({
      eventType: input.family,
      payload: { kind: input.kind, ...input.payload },
      targetEndpoint: input.targetEndpoint.trim(),
      idempotencyKey: input.idempotencyKey,
      corporateCode: input.corporateCode ?? undefined,
    });
    // Best-effort audit (never blocks the outbound path).
    void recordSync({
      system: input.system,
      direction: "outbound",
      operation: input.kind,
      idempotencyKey: input.idempotencyKey,
      status: res.duplicate ? "duplicate" : res.ok ? "ok" : "error",
      detail: { outboxId: res.id ?? null, reason: res.reason ?? null },
    }).catch(() => {});
    return res;
  } catch (err) {
    return { ok: false, reason: (err as Error)?.message ?? String(err) };
  }
}

// ── Generic REST pull helper (inbound poll) ──────────────────────────────────

export interface RestPullConfig {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Injectable fetch (tests pass a mock); defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * GET/POST an external endpoint and parse JSON, with an abort timeout. Throws on a
 * non-2xx or a transport error — the CALLER decides autonomy (log + skip; never
 * block production). Kept generic so no vendor URL/shape is hardcoded.
 */
export async function pullExternalJson<T = any>(cfg: RestPullConfig): Promise<T> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15_000);
  try {
    const res = await doFetch(cfg.url, {
      method: cfg.method ?? "GET",
      headers: { Accept: "application/json", ...(cfg.body ? { "Content-Type": "application/json" } : {}), ...(cfg.headers ?? {}) },
      body: cfg.body !== undefined ? JSON.stringify(cfg.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a nested field by dot-path (e.g. "attributes.qty"). Used by the configurable
 * field-mapping in the connectors/reconciliation providers so a partner's JSON shape
 * is mapped by CONFIG, not by hardcoded field names.
 */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Coerce an external value to a finite number (or null). */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
