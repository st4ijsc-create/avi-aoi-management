/**
 * Automation Orchestration R0-3 (doc 16 §4 Khối 0 / §15) — INBOUND ERP intake.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The /api/v1 endpoints an external ERP/MES uses to PUSH master/transactional
 * data INTO the platform: work orders (`/orders`) and BOM (`/bom`). MIRRORS the
 * existing inspection-ingest pattern (POST /ingest/inspection):
 *   • scoped API-key auth (erp:write),
 *   • the `{ ok, data?, error? }` envelope,
 *   • idempotency: every POST requires an X-Idempotency-Key (or body
 *     `idempotencyKey`); a duplicate key REPLAYS the prior result (no double
 *     insert), tracked in integration_inbound_idempotency.
 *   • versioning: every POST requires/accepts a `schemaVersion` envelope field.
 *   • Zod validation → upsert into the REAL tables (production_orders /
 *     bom_definitions + bom_line_items).
 *
 * Emits `order.created` on the internal eventBus after a successful NEW order
 * intake (Khối 2 task allocation can subscribe later).
 *
 * Gated by ERP_INBOUND_ENABLED (default OFF) → endpoints return a structured
 * 503 `erp_inbound_disabled` envelope when off.
 *
 * routing + material-availability are intentionally NOT exposed: no routing
 * master table exists in the schema (see TODO below); inventing one is out of
 * scope for R0.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { text as textBody, type Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, sendError, wrap, ApiHttpError } from "./envelope";
import { eventBus } from "../../_core/eventBus";
import { b2mmlEnabled, decodeOrderB2MML, decodeBomB2MML, looksLikeXml } from "../../services/integration/b2mmlCodec";

/** True when inbound ERP intake is enabled (default OFF for safety). */
export function erpInboundEnabled(): boolean {
  return process.env.ERP_INBOUND_ENABLED === "true" || process.env.ERP_INBOUND_ENABLED === "1";
}

/**
 * Resolve the intake body to a plain JSON object. When the request carried B2MML
 * XML (Content-Type: application/xml or a body that looks like B2MML) AND the
 * codec flag is on, decode it via the appropriate ISA-95 decoder → the SAME shape
 * the Zod schema validates. Otherwise the JSON body (already parsed by jsonBody)
 * is used unchanged. `resource` selects the decoder ("orders" | "bom").
 *
 * HONEST SEAM: when a body looks like XML but ERP_B2MML_ENABLED is OFF, we throw a
 * clear 415 rather than silently trying to treat XML as JSON.
 */
function resolveIntakeBody(req: Request, resource: "orders" | "bom"): Record<string, unknown> {
  const contentType = (req.header("content-type") || "").toLowerCase();
  const rawText = typeof req.body === "string" ? req.body : undefined;
  const isXml = contentType.includes("xml") || (rawText !== undefined && looksLikeXml(rawText));

  if (isXml) {
    if (!b2mmlEnabled()) {
      throw new ApiHttpError(415, "b2mml_disabled", "B2MML/XML intake is disabled (ERP_B2MML_ENABLED). Send application/json instead.");
    }
    const xml = rawText ?? (typeof req.body === "object" ? "" : String(req.body ?? ""));
    if (!xml) {
      throw new ApiHttpError(400, "empty_xml", "Empty XML body.");
    }
    try {
      const decoded = resource === "orders" ? decodeOrderB2MML(xml) : decodeBomB2MML(xml);
      return decoded as unknown as Record<string, unknown>;
    } catch (err) {
      throw new ApiHttpError(400, "b2mml_decode_failed", `Failed to decode B2MML ${resource}: ${(err as Error)?.message ?? err}`);
    }
  }

  return (req.body ?? {}) as Record<string, unknown>;
}

/** Extract the idempotency key from header or body. Required for every POST. */
function extractIdempotencyKey(req: Request, body: Record<string, unknown>): string {
  const header = req.header("x-idempotency-key") || req.header("X-Idempotency-Key");
  const fromBody = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
  const key = (header || fromBody || "").trim();
  if (!key) {
    throw new ApiHttpError(400, "idempotency_required", "An idempotency key is required (X-Idempotency-Key header or body `idempotencyKey`).");
  }
  return key;
}

/** Guard: 503 when the inbound gateway is off. */
function ensureEnabled(res: Response): boolean {
  if (!erpInboundEnabled()) {
    sendError(res, 503, "erp_inbound_disabled", "ERP inbound intake is disabled (ERP_INBOUND_ENABLED).", { phase: "R0" });
    return false;
  }
  return true;
}

/**
 * Look up a prior accepted result for (resource, idempotencyKey). Returns the
 * stored data envelope or null. Fail-safe.
 */
async function findPriorResult(resource: string, idempotencyKey: string): Promise<unknown | null> {
  const { getDb } = await import("../../db/connection");
  const { integrationInboundIdempotency } = await import("../../../drizzle/schema");
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(integrationInboundIdempotency)
    .where(and(eq(integrationInboundIdempotency.resource, resource), eq(integrationInboundIdempotency.idempotencyKey, idempotencyKey)))
    .limit(1);
  return rows[0] ? rows[0].result : null;
}

/** Record an accepted result for replay on a duplicate key. Fail-safe. */
async function recordResult(
  resource: string,
  idempotencyKey: string,
  schemaVersion: string,
  result: unknown,
  corporateCode?: string | null,
): Promise<void> {
  try {
    const { getDb } = await import("../../db/connection");
    const { integrationInboundIdempotency } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return;
    await db.insert(integrationInboundIdempotency).values({
      resource,
      idempotencyKey,
      schemaVersion,
      result: result as never,
      corporateCode: corporateCode ?? null,
    });
  } catch (err) {
    // A racing duplicate is fine (the natural unique key on the real table protects us too).
    console.error("[erpIntake] recordResult failed:", (err as Error)?.message ?? err);
  }
}

// ── Zod schemas (the inbound contract) ───────────────────────────────────────

const orderIntakeSchema = z.object({
  schemaVersion: z.string().min(1, "schemaVersion is required"),
  idempotencyKey: z.string().optional(),
  orderCode: z.string().min(1).max(100),
  companyCode: z.string().min(1).max(50),
  factoryId: z.number().int().positive(),
  workshopId: z.number().int().positive(),
  lineId: z.number().int().positive(),
  productModelId: z.number().int().positive(),
  targetQuantity: z.number().int().positive(),
  priority: z.number().int().min(0).optional(),
  plannedStartDate: z.string().datetime().optional(),
  plannedEndDate: z.string().datetime().optional(),
  notes: z.string().optional(),
}).strip();

const bomLineSchema = z.object({
  componentCode: z.string().min(1).max(100),
  componentName: z.string().max(255).optional(),
  qtyPer: z.union([z.number(), z.string()]),
  unit: z.string().max(16).optional(),
  refDesignator: z.string().max(255).optional(),
  alternateGroup: z.string().max(64).optional(),
  isOptional: z.boolean().optional(),
  notes: z.string().optional(),
});

const bomIntakeSchema = z.object({
  schemaVersion: z.string().min(1, "schemaVersion is required"),
  idempotencyKey: z.string().optional(),
  productModelId: z.number().int().positive(),
  code: z.string().min(1).max(100),
  version: z.number().int().positive().optional(),
  name: z.string().max(255).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  notes: z.string().optional(),
  lines: z.array(bomLineSchema).default([]),
}).strip();

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/orders — upsert a production order by its natural key (orderCode).
 * On a NEW order, emits `order.created` on the eventBus.
 */
async function handleOrderIntake(req: Request, res: Response): Promise<void> {
  if (!ensureEnabled(res)) return;
  const body = resolveIntakeBody(req, "orders");
  const idempotencyKey = extractIdempotencyKey(req, body);

  // Idempotent replay BEFORE validation cost — a duplicate key returns the prior result.
  const prior = await findPriorResult("orders", idempotencyKey);
  if (prior) {
    sendOk(res, { ...(prior as object), replayed: true }, 200);
    return;
  }

  const parsed = orderIntakeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiHttpError(400, "validation_failed", "Order intake payload failed validation.", parsed.error.flatten());
  }
  const input = parsed.data;

  const { getDb } = await import("../../db/connection");
  const { productionOrders } = await import("../../../drizzle/schema");
  const db = await getDb();
  if (!db) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

  // Upsert by orderCode (the natural unique key).
  const existing = await db.select().from(productionOrders).where(eq(productionOrders.orderCode, input.orderCode)).limit(1);
  const values = {
    orderCode: input.orderCode,
    companyCode: input.companyCode,
    factoryId: input.factoryId,
    workshopId: input.workshopId,
    lineId: input.lineId,
    productModelId: input.productModelId,
    targetQuantity: input.targetQuantity,
    priority: input.priority ?? 0,
    plannedStartDate: input.plannedStartDate ? new Date(input.plannedStartDate) : null,
    plannedEndDate: input.plannedEndDate ? new Date(input.plannedEndDate) : null,
    notes: input.notes ?? null,
  };

  let orderId: number;
  let created: boolean;
  if (existing[0]) {
    await db.update(productionOrders).set({ ...values, updatedAt: new Date() }).where(eq(productionOrders.id, existing[0].id));
    orderId = existing[0].id;
    created = false;
  } else {
    const [row] = await db.insert(productionOrders).values(values).returning({ id: productionOrders.id });
    orderId = row.id;
    created = true;
  }

  const result = { orderId, orderCode: input.orderCode, created, schemaVersion: input.schemaVersion };
  await recordResult("orders", idempotencyKey, input.schemaVersion, result, input.companyCode);

  // Emit ONLY for a new order (Khối 2 task allocation subscribes later).
  if (created) {
    eventBus.publish("order.created", { orderId, orderCode: input.orderCode, productModelId: input.productModelId, source: "erp-intake" }, "erp-intake");
  }

  sendOk(res, result, created ? 201 : 200);
}

/**
 * POST /api/v1/bom — upsert a BOM definition (by productModelId+code+version) and
 * REPLACE its line items. version defaults to 1.
 */
async function handleBomIntake(req: Request, res: Response): Promise<void> {
  if (!ensureEnabled(res)) return;
  const body = resolveIntakeBody(req, "bom");
  const idempotencyKey = extractIdempotencyKey(req, body);

  const prior = await findPriorResult("bom", idempotencyKey);
  if (prior) {
    sendOk(res, { ...(prior as object), replayed: true }, 200);
    return;
  }

  const parsed = bomIntakeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiHttpError(400, "validation_failed", "BOM intake payload failed validation.", parsed.error.flatten());
  }
  const input = parsed.data;
  const version = input.version ?? 1;

  const { getDb } = await import("../../db/connection");
  const { bomDefinitions, bomLineItems } = await import("../../../drizzle/schema");
  const db = await getDb();
  if (!db) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

  // Upsert by (productModelId, code, version) — the natural unique key.
  const existing = await db
    .select()
    .from(bomDefinitions)
    .where(and(eq(bomDefinitions.productModelId, input.productModelId), eq(bomDefinitions.code, input.code), eq(bomDefinitions.version, version)))
    .limit(1);

  const defValues = {
    productModelId: input.productModelId,
    code: input.code,
    version,
    name: input.name ?? null,
    status: input.status ?? "draft",
    notes: input.notes ?? null,
  };

  let bomId: number;
  let created: boolean;
  if (existing[0]) {
    await db.update(bomDefinitions).set({ ...defValues, updatedAt: new Date() }).where(eq(bomDefinitions.id, existing[0].id));
    bomId = existing[0].id;
    created = false;
    // Replace line items (full re-statement of the BOM).
    await db.delete(bomLineItems).where(eq(bomLineItems.bomId, bomId));
  } else {
    const [row] = await db.insert(bomDefinitions).values(defValues).returning({ id: bomDefinitions.id });
    bomId = row.id;
    created = true;
  }

  if (input.lines.length > 0) {
    await db.insert(bomLineItems).values(
      input.lines.map((l) => ({
        bomId,
        componentCode: l.componentCode,
        componentName: l.componentName ?? null,
        qtyPer: String(l.qtyPer),
        unit: l.unit ?? "pcs",
        refDesignator: l.refDesignator ?? null,
        alternateGroup: l.alternateGroup ?? null,
        isOptional: l.isOptional ?? false,
        notes: l.notes ?? null,
      })),
    );
  }

  const result = { bomId, code: input.code, version, lineCount: input.lines.length, created, schemaVersion: input.schemaVersion };
  await recordResult("bom", idempotencyKey, input.schemaVersion, result);

  sendOk(res, result, created ? 201 : 200);
}

/**
 * Register the R0 inbound ERP intake routes on the /api/v1 router. Called from
 * createV1Router so the surface stays additive.
 */
export function registerErpIntakeRoutes(r: Router): void {
  // Capture B2MML XML bodies as raw text (K0+-b) — the parent router's json()
  // parser ignores non-JSON content types, so an XML POST arrives with an empty
  // body unless we also parse text/*+xml here. JSON POSTs are unaffected (this
  // text parser only matches xml content types).
  const xmlBody = textBody({ type: ["application/xml", "text/xml", "application/*+xml"], limit: "25mb" });
  r.post("/orders", xmlBody, requireScope(API_SCOPES.ERP_WRITE), wrap(handleOrderIntake));
  r.post("/bom", xmlBody, requireScope(API_SCOPES.ERP_WRITE), wrap(handleBomIntake));

  // TODO (R0 follow-up): POST /routing and GET /material-availability are NOT
  // exposed — no `routing`/`process_routing` master table exists in the schema,
  // and material availability requires an inventory/stock model not yet present.
  // Adding either would mean inventing tables, which is out of scope for R0.
}
