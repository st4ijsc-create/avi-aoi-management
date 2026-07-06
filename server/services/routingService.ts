/**
 * Routing Master service — doc 35 Wave W4-E, task 3.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Owns the ISA-95 routing master (operations sequence) over drizzle/schema/
 * routing.ts. A routing is a per-product, versioned header (routing_master) with
 * an ordered list of operation steps (routing_steps). This is the table the ERP
 * order-intake path resolves operations against (see server/api/v1/erpIntake.ts
 * TODO — "no routing master table exists").
 *
 * Lifecycle: draft ──activate──▶ active ──archive──▶ archived
 *   • At most ONE `active` routing per product (partial unique index). activate()
 *     first archives any currently-active routing for the same product so the
 *     switch is atomic-by-intent and never trips the unique index.
 *   • getActiveRouting(productModelId) returns the single active header + steps.
 *
 * Pure DB; null-guarded. RBAC + zod validation live in routingRouter.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  routingMaster,
  routingSteps,
  type InsertRoutingStep,
  type RoutingMaster,
  type RoutingStatus,
  type RoutingStep,
} from "../../drizzle/schema/routing";

export class RoutingError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "BAD_STATE" | "CONFLICT" | "DB" = "BAD_STATE") {
    super(message);
    this.name = "RoutingError";
  }
}

async function db() {
  const d = await getDb();
  if (!d) throw new RoutingError("Database not available", "DB");
  return d;
}

// ── Routing header CRUD ───────────────────────────────────────────────────────

export interface CreateRoutingInput {
  productModelId: number;
  code: string;
  version?: number;
  name?: string | null;
  description?: string | null;
  createdBy?: number | null;
  /** Optional initial steps created alongside the header. */
  steps?: Array<Omit<InsertRoutingStep, "routingId" | "id">>;
}

export async function createRouting(input: CreateRoutingInput): Promise<RoutingMaster> {
  const d = await db();
  const [header] = await d
    .insert(routingMaster)
    .values({
      productModelId: input.productModelId,
      code: input.code,
      version: input.version ?? 1,
      name: input.name ?? null,
      description: input.description ?? null,
      status: "draft",
      createdBy: input.createdBy ?? null,
    })
    .returning();

  if (input.steps && input.steps.length > 0) {
    await d.insert(routingSteps).values(
      input.steps.map((s) => ({ ...s, routingId: header.id })),
    );
  }
  return header;
}

export interface ListRoutingFilter {
  productModelId?: number;
  status?: RoutingStatus;
  limit?: number;
}

export async function listRoutings(filter: ListRoutingFilter = {}): Promise<RoutingMaster[]> {
  const d = await getDb();
  if (!d) return [];
  const conds = [] as any[];
  if (filter.productModelId) conds.push(eq(routingMaster.productModelId, filter.productModelId));
  if (filter.status) conds.push(eq(routingMaster.status, filter.status));
  return d
    .select()
    .from(routingMaster)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(routingMaster.updatedAt))
    .limit(filter.limit ?? 100);
}

export interface RoutingWithSteps extends RoutingMaster {
  steps: RoutingStep[];
}

export async function getRoutingById(id: number): Promise<RoutingWithSteps | null> {
  const d = await getDb();
  if (!d) return null;
  const [header] = await d.select().from(routingMaster).where(eq(routingMaster.id, id)).limit(1);
  if (!header) return null;
  const steps = await d
    .select()
    .from(routingSteps)
    .where(eq(routingSteps.routingId, id))
    .orderBy(asc(routingSteps.stepNo));
  return { ...header, steps };
}

/** The single active routing (header + ordered steps) for a product, if any. */
export async function getActiveRouting(productModelId: number): Promise<RoutingWithSteps | null> {
  const d = await getDb();
  if (!d) return null;
  const [header] = await d
    .select()
    .from(routingMaster)
    .where(and(eq(routingMaster.productModelId, productModelId), eq(routingMaster.status, "active")))
    .limit(1);
  if (!header) return null;
  const steps = await d
    .select()
    .from(routingSteps)
    .where(eq(routingSteps.routingId, header.id))
    .orderBy(asc(routingSteps.stepNo));
  return { ...header, steps };
}

export interface UpdateRoutingInput {
  id: number;
  code?: string;
  version?: number;
  name?: string | null;
  description?: string | null;
}

export async function updateRouting(input: UpdateRoutingInput): Promise<RoutingMaster> {
  const d = await db();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.code !== undefined) set.code = input.code;
  if (input.version !== undefined) set.version = input.version;
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description;
  const [row] = await d.update(routingMaster).set(set as any).where(eq(routingMaster.id, input.id)).returning();
  if (!row) throw new RoutingError(`Routing ${input.id} not found`, "NOT_FOUND");
  return row;
}

/**
 * Activate a routing. Archives any OTHER currently-active routing for the same
 * product first so the partial-unique (one active per product) invariant holds.
 */
export async function activateRouting(id: number): Promise<RoutingMaster> {
  const d = await db();
  const [current] = await d.select().from(routingMaster).where(eq(routingMaster.id, id)).limit(1);
  if (!current) throw new RoutingError(`Routing ${id} not found`, "NOT_FOUND");
  const now = new Date();
  // Demote sibling active routings for this product.
  await d
    .update(routingMaster)
    .set({ status: "archived", updatedAt: now })
    .where(and(
      eq(routingMaster.productModelId, current.productModelId),
      eq(routingMaster.status, "active"),
      ne(routingMaster.id, id),
    ));
  const [row] = await d
    .update(routingMaster)
    .set({ status: "active", updatedAt: now })
    .where(eq(routingMaster.id, id))
    .returning();
  return row;
}

export async function archiveRouting(id: number): Promise<RoutingMaster> {
  const d = await db();
  const [row] = await d
    .update(routingMaster)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(routingMaster.id, id))
    .returning();
  if (!row) throw new RoutingError(`Routing ${id} not found`, "NOT_FOUND");
  return row;
}

export async function deleteRouting(id: number): Promise<{ id: number }> {
  const d = await db();
  await d.delete(routingSteps).where(eq(routingSteps.routingId, id));
  const deleted = await d.delete(routingMaster).where(eq(routingMaster.id, id)).returning();
  if (deleted.length === 0) throw new RoutingError(`Routing ${id} not found`, "NOT_FOUND");
  return { id };
}

// ── Step CRUD ─────────────────────────────────────────────────────────────────

export interface UpsertStepInput {
  routingId: number;
  stepNo: number;
  operationCode: string;
  stationOrMachineType?: string | null;
  standardTimeSec?: number | null;
  description?: string | null;
}

export async function addStep(input: UpsertStepInput): Promise<RoutingStep> {
  const d = await db();
  const [row] = await d
    .insert(routingSteps)
    .values({
      routingId: input.routingId,
      stepNo: input.stepNo,
      operationCode: input.operationCode,
      stationOrMachineType: input.stationOrMachineType ?? null,
      standardTimeSec: input.standardTimeSec ?? null,
      description: input.description ?? null,
    })
    .returning();
  return row;
}

export async function updateStep(input: { id: number } & Partial<UpsertStepInput>): Promise<RoutingStep> {
  const d = await db();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.stepNo !== undefined) set.stepNo = input.stepNo;
  if (input.operationCode !== undefined) set.operationCode = input.operationCode;
  if (input.stationOrMachineType !== undefined) set.stationOrMachineType = input.stationOrMachineType;
  if (input.standardTimeSec !== undefined) set.standardTimeSec = input.standardTimeSec;
  if (input.description !== undefined) set.description = input.description;
  const [row] = await d.update(routingSteps).set(set as any).where(eq(routingSteps.id, input.id)).returning();
  if (!row) throw new RoutingError(`Routing step ${input.id} not found`, "NOT_FOUND");
  return row;
}

export async function deleteStep(id: number): Promise<{ id: number }> {
  const d = await db();
  const deleted = await d.delete(routingSteps).where(eq(routingSteps.id, id)).returning();
  if (deleted.length === 0) throw new RoutingError(`Routing step ${id} not found`, "NOT_FOUND");
  return { id };
}

/** Replace the entire step list for a routing (draft authoring convenience). */
export async function replaceSteps(
  routingId: number,
  steps: Array<Omit<UpsertStepInput, "routingId">>,
): Promise<RoutingStep[]> {
  const d = await db();
  await d.delete(routingSteps).where(eq(routingSteps.routingId, routingId));
  if (steps.length === 0) return [];
  return d
    .insert(routingSteps)
    .values(steps.map((s) => ({
      routingId,
      stepNo: s.stepNo,
      operationCode: s.operationCode,
      stationOrMachineType: s.stationOrMachineType ?? null,
      standardTimeSec: s.standardTimeSec ?? null,
      description: s.description ?? null,
    })))
    .returning();
}
