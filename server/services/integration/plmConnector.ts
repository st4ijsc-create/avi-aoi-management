/**
 * PLM CONNECTOR — doc 44 W6-5 (G5.24) · SYNAPSE_Tang5 §8–9 (PLM integration).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PLM is the MASTER SOURCE for product definitions, BOMs, recipes and ECNs. This
 * connector RECEIVES those from PLM and upserts them into the canonical tables via
 * the EXISTING authoring paths (product_models / bom_definitions+bom_line_items /
 * recipe_sets / engineering_changes) — the SAME natural-key upserts the ERP intake
 * uses, so PLM data flows through one canonical door.
 *
 * ANTI-CORRUPTION LAYER (the whole point): PLM's own field names and semantics
 * (partNumber, lifecyclePhase, uom, referenceDesignators, object ids …) are
 * translated into the canonical vocabulary by PURE `mapPlm*` functions that emit a
 * FIXED WHITELIST shape. Any extra PLM field is dropped — PLM semantics never leak
 * into a canonical row. PLM object ids are retained ONLY in enterprise_id_map for
 * two-way reconciliation. Gated by PLM_INTEGRATION_ENABLED (default OFF).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq } from "drizzle-orm";
import {
  upsertIdMap,
  recordSync,
  pullExternalJson,
  getPath,
  toNumber,
  plmEnabled,
} from "./enterpriseIntegrationCore";

const SYSTEM = "plm" as const;

// ── Small field pickers (PLM shapes vary; map by alias, not by one vendor) ────

function pickString(obj: unknown, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = getPath(obj, k);
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

// ── Canonical vocabulary translation tables (anti-corruption) ────────────────

/** PLM lifecycle phase → canonical lifecycleStatusEnum (development|active|eol|archived). */
export function mapLifecycle(phase: string | undefined): "development" | "active" | "eol" | "archived" {
  const p = (phase ?? "").toLowerCase();
  if (/(release|production|active|effective)/.test(p)) return "active";
  if (/(obsolete|end.?of.?life|eol|discontinu)/.test(p)) return "eol";
  if (/(archive|cancel|superseded)/.test(p)) return "archived";
  if (/(work|develop|design|prototype|draft|wip)/.test(p)) return "development";
  return "active";
}

/** PLM recipe status → canonical RecipeSetStatus (draft|active|retired). */
export function mapRecipeStatus(status: string | undefined): "draft" | "active" | "retired" {
  const s = (status ?? "").toLowerCase();
  if (/(release|active|production|effective)/.test(s)) return "active";
  if (/(retire|obsolete|eol|superseded)/.test(s)) return "retired";
  return "draft";
}

/** PLM ECN status → canonical EcnStatus. */
export function mapEcnStatus(status: string | undefined): "draft" | "submitted" | "in_review" | "approved" | "rejected" | "implemented" | "closed" {
  const s = (status ?? "").toLowerCase();
  if (/(implement|effective|complete)/.test(s)) return "implemented";
  if (/(close)/.test(s)) return "closed";
  if (/(reject)/.test(s)) return "rejected";
  if (/(approve|release)/.test(s)) return "approved";
  if (/(review)/.test(s)) return "in_review";
  if (/(submit)/.test(s)) return "submitted";
  return "draft";
}

// ── PURE anti-corruption maps (no DB) ────────────────────────────────────────

export interface CanonicalProduct {
  code: string;
  name: string;
  description: string | null;
  revision: string | null;
  lifecycleStatus: "development" | "active" | "eol" | "archived";
  /** PLM object id (retained for id-map only — never written onto the canonical row). */
  externalId: string | null;
}

/** Translate a PLM item/part into a canonical product-model shape. Whitelist only. */
export function mapPlmProduct(plm: unknown): CanonicalProduct | null {
  const code = pickString(plm, ["partNumber", "part_number", "itemNumber", "item_number", "number", "code"]);
  if (!code) return null;
  const name = pickString(plm, ["name", "itemName", "title", "description"]) ?? code;
  return {
    code,
    name,
    description: pickString(plm, ["longDescription", "description", "details"]) ?? null,
    revision: pickString(plm, ["revision", "rev", "version"]) ?? null,
    lifecycleStatus: mapLifecycle(pickString(plm, ["lifecyclePhase", "lifecycle", "phase", "state", "status"])),
    externalId: pickString(plm, ["objectId", "plmId", "id", "oid"]) ?? code,
  };
}

export interface CanonicalBomLine {
  componentCode: string;
  componentName: string | null;
  qtyPer: number;
  unit: string;
  refDesignator: string | null;
}

export interface CanonicalBom {
  productCode: string;
  code: string;
  version: number;
  name: string | null;
  status: "draft" | "active" | "archived";
  lines: CanonicalBomLine[];
  externalId: string | null;
}

/** Translate a PLM BOM into the canonical bom-definition shape. Whitelist only. */
export function mapPlmBom(plm: unknown): CanonicalBom | null {
  const productCode = pickString(plm, ["productNumber", "parentPartNumber", "assemblyNumber", "productCode", "partNumber"]);
  if (!productCode) return null;
  const code = pickString(plm, ["bomCode", "bomNumber", "code", "name"]) ?? `${productCode}-BOM`;
  const versionStr = pickString(plm, ["revision", "version", "rev"]);
  const version = versionStr ? Math.max(1, Math.trunc(Number(versionStr)) || 1) : 1;
  const rawLines = getPath(plm, "components") ?? getPath(plm, "lines") ?? getPath(plm, "items") ?? getPath(plm, "bomItems");
  const lines: CanonicalBomLine[] = [];
  if (Array.isArray(rawLines)) {
    for (const raw of rawLines) {
      const componentCode = pickString(raw, ["partNumber", "itemNumber", "componentCode", "childPartNumber", "code"]);
      const qty = toNumber(getPath(raw, "quantity") ?? getPath(raw, "qty") ?? getPath(raw, "qtyPer"));
      if (!componentCode || qty == null) continue;
      lines.push({
        componentCode,
        componentName: pickString(raw, ["description", "name", "itemName"]) ?? null,
        qtyPer: qty,
        unit: pickString(raw, ["uom", "unit"]) ?? "pcs",
        refDesignator: pickString(raw, ["referenceDesignators", "refDes", "refDesignator", "reference"]) ?? null,
      });
    }
  }
  const rawStatus = (pickString(plm, ["status", "state", "lifecyclePhase"]) ?? "").toLowerCase();
  const status = /(release|active|production|effective)/.test(rawStatus) ? "active" : /(archive|obsolete)/.test(rawStatus) ? "archived" : "draft";
  return { productCode, code, version, name: pickString(plm, ["name", "title"]) ?? null, status, lines, externalId: pickString(plm, ["objectId", "plmId", "id"]) ?? code };
}

export interface CanonicalRecipe {
  code: string;
  productCode: string | null;
  version: number;
  status: "draft" | "active" | "retired";
  notes: string | null;
  externalId: string | null;
}

/** Translate a PLM recipe/process-definition into a canonical recipe-set header. */
export function mapPlmRecipe(plm: unknown): CanonicalRecipe | null {
  const code = pickString(plm, ["recipeCode", "recipeName", "code", "name", "number"]);
  if (!code) return null;
  const versionStr = pickString(plm, ["revision", "version", "rev"]);
  return {
    code,
    productCode: pickString(plm, ["productNumber", "productCode", "partNumber"]) ?? null,
    version: versionStr ? Math.max(1, Math.trunc(Number(versionStr)) || 1) : 1,
    status: mapRecipeStatus(pickString(plm, ["status", "state", "lifecyclePhase"])),
    notes: pickString(plm, ["notes", "description"]) ?? null,
    externalId: pickString(plm, ["objectId", "plmId", "id"]) ?? code,
  };
}

export interface CanonicalEcn {
  ecnKey: string;
  title: string;
  status: "draft" | "submitted" | "in_review" | "approved" | "rejected" | "implemented" | "closed";
  reason: string | null;
  affectedProductCode: string | null;
  effectivityDate: string | null;
  externalId: string | null;
}

/** Translate a PLM change notice into a canonical engineering-change header. */
export function mapPlmEcn(plm: unknown): CanonicalEcn | null {
  const ecnKey = pickString(plm, ["ecnNumber", "changeNumber", "ecnKey", "number", "code", "id"]);
  if (!ecnKey) return null;
  return {
    ecnKey,
    title: pickString(plm, ["title", "name", "subject", "description"]) ?? ecnKey,
    status: mapEcnStatus(pickString(plm, ["status", "state", "lifecyclePhase"])),
    reason: pickString(plm, ["reason", "justification", "description"]) ?? null,
    affectedProductCode: pickString(plm, ["affectedProduct", "productNumber", "partNumber", "productCode"]) ?? null,
    effectivityDate: pickString(plm, ["effectivityDate", "effectiveDate", "effectiveOn"]) ?? null,
    externalId: pickString(plm, ["objectId", "plmId", "id"]) ?? ecnKey,
  };
}

// ── DB helpers (dynamic import → tests mock ../../db/connection) ──────────────

async function conn(): Promise<any | null> {
  try {
    const { getDb } = await import("../../db/connection");
    return (await getDb()) ?? null;
  } catch {
    return null;
  }
}

// ── Canonical upserts (natural-key idempotent; mirror erpIntake) ─────────────

export interface UpsertResult { ok: boolean; id?: number; created?: boolean; error?: string }

/** Upsert a product model by its unique `code`. */
export async function upsertProduct(p: CanonicalProduct): Promise<UpsertResult> {
  try {
    const d = await conn();
    if (!d) return { ok: false, error: "db unavailable" };
    const { productModels } = await import("../../../drizzle/schema");
    const existing = await d.select({ id: productModels.id }).from(productModels).where(eq(productModels.code, p.code)).limit(1);
    const values = { code: p.code, name: p.name, description: p.description, revision: p.revision, lifecycleStatus: p.lifecycleStatus };
    let id: number;
    let created: boolean;
    if (existing[0]) {
      await d.update(productModels).set({ ...values, updatedAt: new Date() }).where(eq(productModels.id, existing[0].id));
      id = existing[0].id;
      created = false;
    } else {
      const [row] = await d.insert(productModels).values(values).returning({ id: productModels.id });
      id = row.id;
      created = true;
    }
    if (p.externalId) await upsertIdMap({ system: SYSTEM, entityType: "product", externalId: p.externalId, internalId: id });
    return { ok: true, id, created };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/** Upsert a BOM (by productModelId+code+version) and replace its line items. */
export async function upsertBom(b: CanonicalBom): Promise<UpsertResult & { lineCount?: number }> {
  try {
    const d = await conn();
    if (!d) return { ok: false, error: "db unavailable" };
    const { productModels, bomDefinitions, bomLineItems } = await import("../../../drizzle/schema");
    const prod = await d.select({ id: productModels.id }).from(productModels).where(eq(productModels.code, b.productCode)).limit(1);
    if (!prod[0]) return { ok: false, error: `unknown product ${b.productCode}` };
    const productModelId = prod[0].id;
    const existing = await d
      .select({ id: bomDefinitions.id })
      .from(bomDefinitions)
      .where(and(eq(bomDefinitions.productModelId, productModelId), eq(bomDefinitions.code, b.code), eq(bomDefinitions.version, b.version)))
      .limit(1);
    const defValues = { productModelId, code: b.code, version: b.version, name: b.name, status: b.status };
    let bomId: number;
    let created: boolean;
    if (existing[0]) {
      await d.update(bomDefinitions).set({ ...defValues, updatedAt: new Date() }).where(eq(bomDefinitions.id, existing[0].id));
      bomId = existing[0].id;
      created = false;
      await d.delete(bomLineItems).where(eq(bomLineItems.bomId, bomId));
    } else {
      const [row] = await d.insert(bomDefinitions).values(defValues).returning({ id: bomDefinitions.id });
      bomId = row.id;
      created = true;
    }
    if (b.lines.length > 0) {
      await d.insert(bomLineItems).values(
        b.lines.map((l) => ({
          bomId,
          componentCode: l.componentCode,
          componentName: l.componentName,
          qtyPer: String(l.qtyPer),
          unit: l.unit,
          refDesignator: l.refDesignator,
        })),
      );
    }
    if (b.externalId) await upsertIdMap({ system: SYSTEM, entityType: "bom", externalId: b.externalId, internalId: bomId });
    return { ok: true, id: bomId, created, lineCount: b.lines.length };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/** Upsert a recipe-set header by its unique `code`. Machine-level items stay engineering-owned. */
export async function upsertRecipe(r: CanonicalRecipe): Promise<UpsertResult> {
  try {
    const d = await conn();
    if (!d) return { ok: false, error: "db unavailable" };
    const { recipeSets, productModels } = await import("../../../drizzle/schema");
    let productModelId: number | null = null;
    if (r.productCode) {
      const prod = await d.select({ id: productModels.id }).from(productModels).where(eq(productModels.code, r.productCode)).limit(1);
      productModelId = prod[0]?.id ?? null;
    }
    const existing = await d.select({ id: recipeSets.id }).from(recipeSets).where(eq(recipeSets.code, r.code)).limit(1);
    const values = { code: r.code, productModelId, version: r.version, status: r.status, notes: r.notes };
    let id: number;
    let created: boolean;
    if (existing[0]) {
      await d.update(recipeSets).set({ productModelId, version: r.version, status: r.status, notes: r.notes }).where(eq(recipeSets.id, existing[0].id));
      id = existing[0].id;
      created = false;
    } else {
      const [row] = await d.insert(recipeSets).values(values).returning({ id: recipeSets.id });
      id = row.id;
      created = true;
    }
    if (r.externalId) await upsertIdMap({ system: SYSTEM, entityType: "recipe", externalId: r.externalId, internalId: id });
    return { ok: true, id, created };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/** Upsert an engineering-change header by its unique `ecnKey`. */
export async function upsertEcn(e: CanonicalEcn): Promise<UpsertResult> {
  try {
    const d = await conn();
    if (!d) return { ok: false, error: "db unavailable" };
    const { engineeringChanges, productModels } = await import("../../../drizzle/schema");
    let productModelId: number | null = null;
    if (e.affectedProductCode) {
      const prod = await d.select({ id: productModels.id }).from(productModels).where(eq(productModels.code, e.affectedProductCode)).limit(1);
      productModelId = prod[0]?.id ?? null;
    }
    const existing = await d.select({ id: engineeringChanges.id }).from(engineeringChanges).where(eq(engineeringChanges.ecnKey, e.ecnKey)).limit(1);
    const values = {
      ecnKey: e.ecnKey,
      title: e.title,
      changeType: "product" as const,
      productModelId,
      reason: e.reason,
      status: e.status,
      effectivityDate: e.effectivityDate ? new Date(e.effectivityDate) : null,
      impactSummary: (e.affectedProductCode ? { affectedProducts: [e.affectedProductCode], notes: "Ingested from PLM (anti-corruption)" } : null) as never,
    };
    let id: number;
    let created: boolean;
    if (existing[0]) {
      await d.update(engineeringChanges).set({ ...values, updatedAt: new Date() }).where(eq(engineeringChanges.id, existing[0].id));
      id = existing[0].id;
      created = false;
    } else {
      const [row] = await d.insert(engineeringChanges).values(values).returning({ id: engineeringChanges.id });
      id = row.id;
      created = true;
    }
    if (e.externalId) await upsertIdMap({ system: SYSTEM, entityType: "ecn", externalId: e.externalId, internalId: id });
    return { ok: true, id, created };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

// ── Ingest orchestrators (map → upsert → audit) ──────────────────────────────

export type PlmEntity = "product" | "bom" | "recipe" | "ecn";

/**
 * Ingest one raw PLM object of a given entity type: anti-corruption map → canonical
 * upsert → id-map + audit. Idempotent (natural-key upsert). Fail-safe — records an
 * error to the sync log and returns { ok:false } rather than throwing, so a single
 * bad PLM object never aborts a poll batch.
 */
export async function ingestPlmEntity(entity: PlmEntity, raw: unknown): Promise<UpsertResult> {
  try {
    let canonical: CanonicalProduct | CanonicalBom | CanonicalRecipe | CanonicalEcn | null;
    let res: UpsertResult;
    switch (entity) {
      case "product": canonical = mapPlmProduct(raw); res = canonical ? await upsertProduct(canonical) : { ok: false, error: "unmappable product" }; break;
      case "bom": canonical = mapPlmBom(raw); res = canonical ? await upsertBom(canonical) : { ok: false, error: "unmappable bom" }; break;
      case "recipe": canonical = mapPlmRecipe(raw); res = canonical ? await upsertRecipe(canonical) : { ok: false, error: "unmappable recipe" }; break;
      case "ecn": canonical = mapPlmEcn(raw); res = canonical ? await upsertEcn(canonical) : { ok: false, error: "unmappable ecn" }; break;
      default: return { ok: false, error: `unknown entity ${entity}` };
    }
    await recordSync({
      system: SYSTEM,
      direction: "inbound",
      operation: `plm.${entity}.upsert`,
      externalId: (canonical as { externalId?: string | null } | null)?.externalId ?? null,
      internalId: res.id ?? null,
      status: res.ok ? "ok" : "error",
      detail: { created: res.created ?? null, error: res.error ?? null },
    });
    return res;
  } catch (err) {
    const error = (err as Error)?.message ?? String(err);
    await recordSync({ system: SYSTEM, direction: "inbound", operation: `plm.${entity}.upsert`, status: "error", detail: { error } });
    return { ok: false, error };
  }
}

export interface PullPlmConfig {
  url: string;
  entity: PlmEntity;
  /** Dot-path to the object array in the response (default "items"). */
  itemsPath?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface PullPlmResult { ok: boolean; ingested: number; failed: number; disabled?: boolean; error?: string }

/**
 * Poll PLM for a batch of one entity type and ingest each. AUTONOMOUS: transport
 * failures are caught + logged (never thrown); a single unmappable object is skipped,
 * not fatal. No-op (disabled) when PLM_INTEGRATION_ENABLED is off.
 */
export async function pullPlm(cfg: PullPlmConfig): Promise<PullPlmResult> {
  if (!plmEnabled()) return { ok: false, ingested: 0, failed: 0, disabled: true };
  try {
    const body = await pullExternalJson({ url: cfg.url, headers: cfg.headers, timeoutMs: cfg.timeoutMs, fetchImpl: cfg.fetchImpl });
    const arr = getPath(body, cfg.itemsPath ?? "items");
    const list = Array.isArray(arr) ? arr : Array.isArray(body) ? (body as unknown[]) : [];
    let ingested = 0;
    let failed = 0;
    for (const raw of list) {
      const r = await ingestPlmEntity(cfg.entity, raw);
      if (r.ok) ingested += 1;
      else failed += 1;
    }
    return { ok: true, ingested, failed };
  } catch (err) {
    const error = (err as Error)?.message ?? String(err);
    await recordSync({ system: SYSTEM, direction: "inbound", operation: `plm.${cfg.entity}.pull`, status: "error", detail: { error } });
    return { ok: false, ingested: 0, failed: 0, error };
  }
}
