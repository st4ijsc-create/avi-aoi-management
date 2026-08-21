/**
 * Doc 24 / Connectivity — No-code Tag → UNS mapping service (HighByte-style).
 *
 * Two responsibilities, cleanly separated:
 *   1. PURE transform + publish-decision (no I/O): apply a mapping's conditioning
 *      (rename / scale / offset / unit / cast / deadband) to a raw value, render the
 *      target UNS topic, and decide whether/where to publish. Fully unit-testable.
 *   2. CRUD + a small read-through cache (`getMappingForTag`) over the
 *      `uns_tag_mappings` table, used by the tRPC router and the OT publish path.
 *
 * SAFETY: this is a READ-DIRECTION publish concern ONLY. It reshapes how a telemetry
 * sample is PUBLISHED to the UNS. It opens NO control path and never influences the
 * inbound NCMD/DCMD → commandDispatcher safety. The OT publish path consults it ONLY
 * when UNS_MAPPING_ENABLED === "true" (default OFF ⇒ today's normalization unchanged;
 * an unmapped tag always keeps the default behaviour).
 */
import { and, eq, desc } from "drizzle-orm";
import { DbUnavailableError } from "../_core/dbErrors";
import { getDb } from "../db/connection";
import { unsTagMappings, type UnsTagMapping, type UnsTagTransform } from "../../drizzle/schema/ot";
import type { OtDataType } from "./ot/otDriver";
import type { MetricSample } from "./uns/sparkplugNode";
import { otTypeToSparkplug } from "./uns/sparkplugEncoder";

export type { UnsTagTransform };

/** Feature flag — default OFF ⇒ the OT publish path ignores mappings entirely. */
export function isUnsMappingEnabled(): boolean {
  return process.env.UNS_MAPPING_ENABLED === "true";
}

/** Enterprise name used to expand the {enterprise} topic placeholder. */
function enterpriseName(): string {
  return process.env.UNS_ENTERPRISE_NAME || "AVI-AOI";
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE transforms
// ─────────────────────────────────────────────────────────────────────────────

export type OtScalar = number | string | boolean | null;

/** Coerce anything into a UNS-publishable scalar (objects → JSON string). */
export function coerceScalar(v: unknown): OtScalar {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Best-effort numeric coercion (bool→1/0, numeric string→number), else null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Deterministic truthiness for a cast to bool. */
export function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "1", "on", "yes", "y"].includes(t)) return true;
    if (["false", "0", "off", "no", "n", ""].includes(t)) return false;
    return Boolean(t);
  }
  return Boolean(v);
}

/** Coerce a value to the requested cast target. */
export function castValue(v: unknown, cast: NonNullable<UnsTagTransform["cast"]>): OtScalar {
  switch (cast) {
    case "number":
      return toNumber(v);
    case "bool":
      return toBool(v);
    case "string":
      return v === null || v === undefined ? "" : String(v);
    default:
      return coerceScalar(v);
  }
}

/**
 * Apply the value-affecting conditioning (scale/offset then cast). `rename`, `unit`
 * and `deadband` do NOT change the value — they are handled by the caller. Pure.
 */
export function applyValueTransform(raw: unknown, transform?: UnsTagTransform | null): OtScalar {
  if (!transform) return coerceScalar(raw);
  let v: unknown = raw;

  const hasScale = typeof transform.scale === "number" && Number.isFinite(transform.scale);
  const hasOffset = typeof transform.offset === "number" && Number.isFinite(transform.offset);
  if (hasScale || hasOffset) {
    const n = toNumber(v);
    if (n !== null) {
      v = n * (hasScale ? (transform.scale as number) : 1) + (hasOffset ? (transform.offset as number) : 0);
    }
  }

  if (transform.cast) {
    v = castValue(v, transform.cast);
  }
  return coerceScalar(v);
}

/**
 * Deadband gate: returns true when the sample SHOULD be published.
 *  - no deadband (or ≤ 0)         → always publish
 *  - first sample (no prior)      → always publish
 *  - numeric prev & next          → publish only when |next − prev| ≥ deadband
 *  - non-numeric                  → publish only on a change
 */
export function passesDeadband(
  prev: OtScalar | undefined,
  next: OtScalar,
  deadband?: number,
): boolean {
  if (!deadband || !(deadband > 0)) return true;
  if (prev === undefined || prev === null) return true;
  if (typeof next === "number" && typeof prev === "number") {
    return Math.abs(next - prev) >= deadband;
  }
  return next !== prev;
}

/** Expand {enterprise} {adapterCode} {tag} {rename} {machineId} in a topic template. */
export function renderUnsTopic(
  template: string,
  ctx: { adapterCode: string; tag: string; machineId: number | null; rename?: string },
): string {
  return template
    .replace(/\{enterprise\}/g, enterpriseName())
    .replace(/\{adapterCode\}/g, ctx.adapterCode)
    .replace(/\{tag\}/g, ctx.tag)
    .replace(/\{rename\}/g, ctx.rename ?? ctx.tag)
    .replace(/\{machineId\}/g, ctx.machineId != null ? String(ctx.machineId) : "");
}

/** Effective output metric/leaf name: explicit sparkplugMetric → rename → tag. */
export function effectiveMetricName(mapping: ResolvedMapping, tag: string): string {
  return (
    (mapping.sparkplugMetric && mapping.sparkplugMetric.trim()) ||
    (mapping.transform?.rename && mapping.transform.rename.trim()) ||
    tag
  );
}

/** Sparkplug-B type for the transformed value (cast wins, then dataType, then typeof). */
export function sparkplugTypeFor(
  cast: UnsTagTransform["cast"] | undefined,
  dataType: OtDataType | undefined,
  value: OtScalar,
): string {
  if (cast === "number") return "Double";
  if (cast === "bool") return "Boolean";
  if (cast === "string") return "String";
  if (dataType) return otTypeToSparkplug(dataType);
  if (typeof value === "number") return "Double";
  if (typeof value === "boolean") return "Boolean";
  return "String";
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolved mapping shape + publish decision (pure) / consult (stateful deadband)
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of a mapping row the publish path needs. */
export interface ResolvedMapping {
  id: number;
  adapterId: number;
  tag: string;
  unsTopic: string;
  sparkplugMetric: string | null;
  transform: UnsTagTransform | null;
  enabled: boolean;
}

export interface MappedPublishCtx {
  adapterId: number;
  adapterCode: string;
  tag: string;
  machineId: number | null;
  rawValue: unknown;
  timestamp: Date;
  quality?: string;
  dataType?: OtDataType;
}

/**
 * The publish decision:
 *   - default    → no (enabled) mapping ⇒ caller keeps today's default normalization
 *   - suppress   → mapping matched but the deadband gate suppressed this sample
 *   - normalized → publish a JSON payload to `topic`
 *   - sparkplug  → publish a Sparkplug-B DDATA metric to device `deviceId`
 */
export type MappedPublishDecision =
  | { kind: "default" }
  | { kind: "suppress" }
  | { kind: "normalized"; topic: string; metric: string; value: OtScalar; payload: Record<string, unknown> }
  | { kind: "sparkplug"; deviceId: string; metric: MetricSample };

/**
 * PURE: given a resolved mapping (or null), the sample ctx, and the last published
 * value (for deadband), compute the decision + the value that would be published.
 */
export function decideMappedPublish(
  mapping: ResolvedMapping | null,
  ctx: MappedPublishCtx,
  opts: { sparkplugEnabled: boolean; lastValue?: OtScalar },
): { decision: MappedPublishDecision; publishedValue: OtScalar | undefined } {
  if (!mapping || !mapping.enabled) {
    return { decision: { kind: "default" }, publishedValue: undefined };
  }

  const value = applyValueTransform(ctx.rawValue, mapping.transform);
  if (!passesDeadband(opts.lastValue, value, mapping.transform?.deadband)) {
    return { decision: { kind: "suppress" }, publishedValue: undefined };
  }

  const metricName = effectiveMetricName(mapping, ctx.tag);

  if (opts.sparkplugEnabled) {
    const type = sparkplugTypeFor(mapping.transform?.cast, ctx.dataType, value);
    return {
      decision: {
        kind: "sparkplug",
        deviceId: ctx.adapterCode,
        metric: { name: metricName, type, value, timestamp: ctx.timestamp.getTime() },
      },
      publishedValue: value,
    };
  }

  const topic = renderUnsTopic(mapping.unsTopic, {
    adapterCode: ctx.adapterCode,
    tag: ctx.tag,
    machineId: ctx.machineId,
    rename: mapping.transform?.rename,
  });
  const unit = mapping.transform?.unit;
  return {
    decision: {
      kind: "normalized",
      topic,
      metric: metricName,
      value,
      payload: {
        adapterId: ctx.adapterId,
        machineId: ctx.machineId,
        tag: ctx.tag,
        metric: metricName,
        value,
        ...(unit ? { unit } : {}),
        ...(ctx.quality ? { quality: ctx.quality } : {}),
        timestamp: ctx.timestamp.toISOString(),
      },
    },
    publishedValue: value,
  };
}

// Per-(adapter,tag) last PUBLISHED value — backs the deadband gate across samples.
const deadbandStore = new Map<string, OtScalar>();

/**
 * STATEFUL consult used by the OT publish path: resolves the deadband against the
 * last published value, and (only on an actual publish) records the new value.
 * Returns just the decision; the caller performs the I/O (publish).
 */
export function applyMappingForPublish(
  mapping: ResolvedMapping | null,
  ctx: MappedPublishCtx,
  opts: { sparkplugEnabled: boolean },
): MappedPublishDecision {
  const key = `${ctx.adapterId}:${ctx.tag}`;
  const lastValue = deadbandStore.get(key);
  const { decision, publishedValue } = decideMappedPublish(mapping, ctx, {
    sparkplugEnabled: opts.sparkplugEnabled,
    lastValue,
  });
  // Only advance the deadband baseline when we actually publish.
  if ((decision.kind === "normalized" || decision.kind === "sparkplug") && publishedValue !== undefined) {
    deadbandStore.set(key, publishedValue);
  }
  return decision;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live preview (for the UI) — pure, no deadband state
// ─────────────────────────────────────────────────────────────────────────────

export interface MappingPreview {
  unsTopic: string;
  sparkplugMetric: string;
  transformedValue: OtScalar;
  unit: string | null;
  willPublish: boolean;
  note?: string;
}

/**
 * Compute what a mapping WOULD publish for a given raw sample value. `prevValue`
 * (optional) lets the UI demonstrate the deadband gate; without it, the sample is
 * treated as the first (always publishes).
 */
export function previewMapping(
  mapping: ResolvedMapping,
  rawValue: unknown,
  ctx: { adapterCode?: string; tag?: string; machineId?: number | null; prevValue?: OtScalar } = {},
): MappingPreview {
  const tag = ctx.tag ?? mapping.tag;
  const value = applyValueTransform(rawValue, mapping.transform);
  const willPublish = passesDeadband(ctx.prevValue, value, mapping.transform?.deadband);
  const metricName = effectiveMetricName(mapping, tag);
  const unsTopic = renderUnsTopic(mapping.unsTopic, {
    adapterCode: ctx.adapterCode ?? `adapter${mapping.adapterId}`,
    tag,
    machineId: ctx.machineId ?? null,
    rename: mapping.transform?.rename,
  });
  return {
    unsTopic,
    sparkplugMetric: metricName,
    transformedValue: value,
    unit: mapping.transform?.unit ?? null,
    willPublish,
    note: willPublish
      ? undefined
      : `Deadband ${mapping.transform?.deadband} suppresses this change (unchanged vs previous).`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-through cache: enabled mapping for a (adapterId, tag) on the hot path
// ─────────────────────────────────────────────────────────────────────────────

// null = negatively cached "no enabled mapping" (avoids repeat DB hits per sample).
const mappingCache = new Map<string, ResolvedMapping | null>();

function cacheKey(adapterId: number, tag: string): string {
  return `${adapterId}:${tag}`;
}

function toResolved(row: UnsTagMapping): ResolvedMapping {
  return {
    id: row.id,
    adapterId: row.adapterId,
    tag: row.tag,
    unsTopic: row.unsTopic,
    sparkplugMetric: row.sparkplugMetric ?? null,
    transform: (row.transform as UnsTagTransform | null) ?? null,
    enabled: row.enabled,
  };
}

/** Invalidate the whole read-through cache (called after any CRUD write). */
export function clearMappingCache(): void {
  mappingCache.clear();
}

/**
 * Resolve the ENABLED mapping for (adapterId, tag), cached. Returns null when there
 * is no enabled mapping (also negatively cached). Never throws — on DB error returns
 * null so the publish path safely falls back to the default normalization.
 */
export async function getMappingForTag(adapterId: number, tag: string): Promise<ResolvedMapping | null> {
  const key = cacheKey(adapterId, tag);
  if (mappingCache.has(key)) return mappingCache.get(key) ?? null;
  try {
    const db = await getDb();
    if (!db) {
      mappingCache.set(key, null);
      return null;
    }
    const rows = await db
      .select()
      .from(unsTagMappings)
      .where(and(eq(unsTagMappings.adapterId, adapterId), eq(unsTagMappings.tag, tag), eq(unsTagMappings.enabled, true)))
      .limit(1);
    const resolved = rows[0] ? toResolved(rows[0]) : null;
    mappingCache.set(key, resolved);
    return resolved;
  } catch (err) {
    console.error("[UNS-MAP] getMappingForTag failed:", (err as Error)?.message || err);
    mappingCache.set(key, null);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db;
}

export interface CreateMappingInput {
  adapterId: number;
  tag: string;
  unsTopic: string;
  sparkplugMetric?: string | null;
  transform?: UnsTagTransform | null;
  enabled?: boolean;
  notes?: string | null;
  createdBy?: number | null;
}

export async function createMapping(input: CreateMappingInput): Promise<UnsTagMapping> {
  const db = await requireDb();
  const [row] = await db
    .insert(unsTagMappings)
    .values({
      adapterId: input.adapterId,
      tag: input.tag,
      unsTopic: input.unsTopic,
      sparkplugMetric: input.sparkplugMetric ?? null,
      transform: input.transform ?? null,
      enabled: input.enabled ?? true,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  clearMappingCache();
  return row;
}

export async function listMappings(filter?: { adapterId?: number }): Promise<UnsTagMapping[]> {
  const db = await requireDb();
  const conds = [];
  if (filter?.adapterId != null) conds.push(eq(unsTagMappings.adapterId, filter.adapterId));
  return db
    .select()
    .from(unsTagMappings)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(unsTagMappings.createdAt));
}

export async function getMapping(id: number): Promise<UnsTagMapping | null> {
  const db = await requireDb();
  const [row] = await db.select().from(unsTagMappings).where(eq(unsTagMappings.id, id)).limit(1);
  return row ?? null;
}

export type UpdateMappingPatch = Partial<Omit<CreateMappingInput, "adapterId">>;

export async function updateMapping(id: number, patch: UpdateMappingPatch): Promise<UnsTagMapping | null> {
  const db = await requireDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.tag !== undefined) set.tag = patch.tag;
  if (patch.unsTopic !== undefined) set.unsTopic = patch.unsTopic;
  if (patch.sparkplugMetric !== undefined) set.sparkplugMetric = patch.sparkplugMetric;
  if (patch.transform !== undefined) set.transform = patch.transform;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.notes !== undefined) set.notes = patch.notes;
  const [row] = await db.update(unsTagMappings).set(set).where(eq(unsTagMappings.id, id)).returning();
  clearMappingCache();
  return row ?? null;
}

export async function deleteMapping(id: number): Promise<boolean> {
  const db = await requireDb();
  const [row] = await db.delete(unsTagMappings).where(eq(unsTagMappings.id, id)).returning();
  clearMappingCache();
  return !!row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test hooks (DB-free): seed / reset the caches used on the hot path.
// ─────────────────────────────────────────────────────────────────────────────

export function __setMappingCacheForTest(adapterId: number, tag: string, mapping: ResolvedMapping | null): void {
  mappingCache.set(cacheKey(adapterId, tag), mapping);
}
export function __resetMappingCacheForTest(): void {
  mappingCache.clear();
}
export function __resetDeadbandStoreForTest(): void {
  deadbandStore.clear();
}
