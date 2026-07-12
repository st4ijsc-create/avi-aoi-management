/**
 * ENTERPRISE RECONCILIATION PROVIDERS — doc 44 W6-5 (G5.24) · SYNAPSE_Tang5 §8–9
 * (đối soát) · builds on the F7 reconciliation engine (SYNAPSE §5.9.2).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The reconciliation cron already has a pluggable ReconcileProvider seam but only
 * shipped `exampleRestProvider` (a demo GET returning both sides pre-baked). This
 * module adds REAL providers that fetch the two sides SEPARATELY and compare per
 * canonical key:
 *
 *   • makeWmsInventoryReconcileProvider — the first REAL provider: external =
 *     the WMS's live inventory (field-mapped, external material ids resolved to
 *     canonical `materials.code` via enterprise_id_map); internal = SYNAPSE's own
 *     line inventory (SUM(feeder_materials.qtyOnFeeder) BY componentCode, a real DB
 *     query). Drift per material → an investigation ticket (never a silent fix).
 *
 *   • makeGenericReconcileProvider — a GENERIC provider: each side is a MetricSource
 *     (a REST endpoint + field mapping, OR an injected function). No vendor URL or
 *     JSON shape is hardcoded — everything is configured. Used for MES production
 *     reconciliation (both sides REST) and reusable for any other system.
 *
 * registerEnterpriseReconcileProviders() wires these from env; the existing cron
 * (reconciliationCron.startReconciliationScheduler) calls it, so a configured
 * deployment reconciles for real. Nothing is registered without config (honest).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { ReconcileProvider } from "../contracts/reconciliationCron";
import type { ReconcileInput } from "../contracts/reconciliation";
import {
  pullExternalJson,
  getPath,
  toNumber,
  resolveInternalId,
  type EnterpriseSystem,
} from "./enterpriseIntegrationCore";

// ── Metric sources ───────────────────────────────────────────────────────────

/** A REST endpoint + field mapping producing a { key → number } metric map. */
export interface RestMetricSource {
  kind: "rest";
  url: string;
  headers?: Record<string, string>;
  /** Dot-path to the line-item array (default "items"). */
  itemsPath?: string;
  /** Field holding the metric key (material code / id, order code …). */
  keyField: string;
  /** Field holding the numeric value (qty, count …). */
  valueField: string;
  /** When true, keyField is an EXTERNAL id → resolve to canonical via enterprise_id_map. */
  keyIsExternalId?: boolean;
  system?: EnterpriseSystem;
  /** id-map entity type when resolving (default "material"). */
  entityType?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** An injected function producing a metric map (e.g. an internal DB query). */
export interface FnMetricSource {
  kind: "fn";
  fetch: () => Promise<Record<string, number>>;
}

export type MetricSource = RestMetricSource | FnMetricSource;

/** Resolve a MetricSource to a canonical metric map. Anti-corruption on external keys. */
export async function resolveMetrics(src: MetricSource): Promise<Record<string, number>> {
  if (src.kind === "fn") return (await src.fetch()) ?? {};
  const body = await pullExternalJson({ url: src.url, headers: src.headers, timeoutMs: src.timeoutMs, fetchImpl: src.fetchImpl });
  const arr = getPath(body, src.itemsPath ?? "items");
  const out: Record<string, number> = {};
  if (!Array.isArray(arr)) return out;
  for (const raw of arr) {
    const rawKey = getPath(raw, src.keyField);
    const val = toNumber(getPath(raw, src.valueField));
    if (rawKey == null || val == null) continue;
    let key = String(rawKey);
    if (src.keyIsExternalId && src.system) {
      const internal = await resolveInternalId(src.system, src.entityType ?? "material", key);
      if (!internal) continue; // unmapped external key → excluded → surfaces as a discrepancy
      key = internal;
    }
    out[key] = (out[key] ?? 0) + val;
  }
  return out;
}

// ── Generic provider ─────────────────────────────────────────────────────────

export interface GenericReconcileConfig {
  id: string;
  description: string;
  internal: MetricSource;
  external: MetricSource;
  toleranceAbs?: number;
  toleranceRel?: number;
}

/** Build a reconciliation provider from two independently-fetched metric sources. */
export function makeGenericReconcileProvider(cfg: GenericReconcileConfig): ReconcileProvider {
  return {
    id: cfg.id,
    description: cfg.description,
    async pull(): Promise<ReconcileInput> {
      const [internal, external] = await Promise.all([resolveMetrics(cfg.internal), resolveMetrics(cfg.external)]);
      return { internal, external, toleranceAbs: cfg.toleranceAbs, toleranceRel: cfg.toleranceRel };
    },
  };
}

// ── Real WMS inventory provider ──────────────────────────────────────────────

/**
 * SYNAPSE-side line inventory: SUM(feeder_materials.qtyOnFeeder) grouped by
 * componentCode (excluding removed feeders). A REAL DB metric — the internal side of
 * the WMS inventory reconciliation. Fail-safe → {} on any error.
 */
export async function internalLineInventoryMetrics(): Promise<Record<string, number>> {
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (!db) return {};
    const { feederMaterials } = await import("../../../drizzle/schema");
    const { sql, ne } = await import("drizzle-orm");
    const rows = await db
      .select({ code: feederMaterials.componentCode, qty: sql<number>`sum(${feederMaterials.qtyOnFeeder})` })
      .from(feederMaterials)
      .where(ne(feederMaterials.status, "removed"))
      .groupBy(feederMaterials.componentCode);
    const out: Record<string, number> = {};
    for (const r of rows as Array<{ code: string; qty: number }>) {
      const n = Number(r.qty);
      if (r.code && Number.isFinite(n)) out[r.code] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export interface WmsInventoryReconcileConfig {
  url: string;
  headers?: Record<string, string>;
  itemsPath?: string;
  keyField: string;
  valueField: string;
  keyIsExternalId?: boolean;
  toleranceAbs?: number;
  toleranceRel?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Override the internal side (tests inject a fixed map). Defaults to the real DB query. */
  internalSource?: MetricSource;
}

/** Real WMS-inventory-vs-SYNAPSE-line-inventory provider. */
export function makeWmsInventoryReconcileProvider(cfg: WmsInventoryReconcileConfig): ReconcileProvider {
  return makeGenericReconcileProvider({
    id: "wms-inventory",
    description: "WMS inventory vs SYNAPSE line inventory (by material)",
    internal: cfg.internalSource ?? { kind: "fn", fetch: internalLineInventoryMetrics },
    external: {
      kind: "rest",
      url: cfg.url,
      headers: cfg.headers,
      itemsPath: cfg.itemsPath,
      keyField: cfg.keyField,
      valueField: cfg.valueField,
      keyIsExternalId: cfg.keyIsExternalId,
      system: "wms",
      entityType: "material",
      timeoutMs: cfg.timeoutMs,
      fetchImpl: cfg.fetchImpl,
    },
    toleranceAbs: cfg.toleranceAbs,
    toleranceRel: cfg.toleranceRel,
  });
}

// ── Env registration (called by the reconciliation cron) ─────────────────────

function num(v: string | undefined): number | undefined {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Register real enterprise reconciliation providers from env. Honest no-op when the
 * relevant *_RECONCILE_URL is unset. Returns the number registered.
 *
 *   WMS  : WMS_RECONCILE_URL (+ WMS_RECONCILE_KEY_FIELD/VALUE_FIELD/ITEMS_PATH/
 *          KEY_IS_EXTERNAL/AUTH/TOL_REL) → real inventory reconciliation.
 *   MES  : MES_RECONCILE_URL + MES_RECONCILE_INTERNAL_URL (+ *_KEY_FIELD/VALUE_FIELD/
 *          ITEMS_PATH/AUTH/TOL_REL) → production reconciliation (both sides REST).
 */
export function registerEnterpriseReconcileProviders(
  register: (p: ReconcileProvider) => void,
  env: NodeJS.ProcessEnv = process.env,
): number {
  let n = 0;

  if (env.WMS_RECONCILE_URL) {
    register(
      makeWmsInventoryReconcileProvider({
        url: env.WMS_RECONCILE_URL,
        itemsPath: env.WMS_RECONCILE_ITEMS_PATH,
        keyField: env.WMS_RECONCILE_KEY_FIELD ?? "materialCode",
        valueField: env.WMS_RECONCILE_VALUE_FIELD ?? "onHand",
        keyIsExternalId: env.WMS_RECONCILE_KEY_IS_EXTERNAL === "true" || env.WMS_RECONCILE_KEY_IS_EXTERNAL === "1",
        headers: env.WMS_RECONCILE_AUTH ? { Authorization: env.WMS_RECONCILE_AUTH } : undefined,
        toleranceRel: num(env.WMS_RECONCILE_TOL_REL) ?? 0.02,
        toleranceAbs: num(env.WMS_RECONCILE_TOL_ABS),
      }),
    );
    n += 1;
  }

  if (env.MES_RECONCILE_URL && env.MES_RECONCILE_INTERNAL_URL) {
    register(
      makeGenericReconcileProvider({
        id: "mes-production",
        description: "MES production vs SYNAPSE (by order)",
        external: {
          kind: "rest",
          url: env.MES_RECONCILE_URL,
          headers: env.MES_RECONCILE_AUTH ? { Authorization: env.MES_RECONCILE_AUTH } : undefined,
          itemsPath: env.MES_RECONCILE_ITEMS_PATH,
          keyField: env.MES_RECONCILE_KEY_FIELD ?? "orderCode",
          valueField: env.MES_RECONCILE_VALUE_FIELD ?? "produced",
        },
        internal: {
          kind: "rest",
          url: env.MES_RECONCILE_INTERNAL_URL,
          headers: env.MES_RECONCILE_INTERNAL_AUTH ? { Authorization: env.MES_RECONCILE_INTERNAL_AUTH } : undefined,
          itemsPath: env.MES_RECONCILE_ITEMS_PATH,
          keyField: env.MES_RECONCILE_KEY_FIELD ?? "orderCode",
          valueField: env.MES_RECONCILE_VALUE_FIELD ?? "produced",
        },
        toleranceRel: num(env.MES_RECONCILE_TOL_REL) ?? 0.01,
        toleranceAbs: num(env.MES_RECONCILE_TOL_ABS),
      }),
    );
    n += 1;
  }

  return n;
}
