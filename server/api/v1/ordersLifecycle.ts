/**
 * W3-A3 (doc 44 G3.6/G3.7) — Orchestration API: ORDER LIFECYCLE (SYNAPSE LDS-L3 §13.1).
 *
 *   GET  /v1/orders               → list + effective lifecycle + allocation   (orders:read)
 *   GET  /v1/orders/{id}          → detail + full transition history          (orders:read)
 *   POST /v1/orders/{id}/allocate → §9.1 allocation {lineId?}                 (orders:write)
 *   POST /v1/orders/{id}/hold     → running → held {reason}                   (orders:write)
 *   POST /v1/orders/{id}/resume   → held → running {reason}                   (orders:write)
 *   POST /v1/orders/{id}/cancel   → created/allocated→rejected ·
 *                                   running/held→compensating→failed {reason} (orders:write)
 *   GET  /v1/orders/{id}/trace    → transitions + genealogy refs (honest-empty) (orders:read)
 *
 * NOT SELF-REGISTERED: another batch owns router.ts/openapi.ts/scopes.ts — the
 * wiring snippet ships in the batch report. POST /v1/orders (intake) stays with
 * erpIntake.ts; this file adds only the lifecycle verbs + reads (no clash:
 * different method/paths).
 *
 * Every route: scoped API key ({ ok, data?, error? } envelope, wrap() fail-safe),
 * gated by ORDER_LIFECYCLE_ENABLED (default OFF → structured 503; also protects
 * an un-migrated DB, mig 0258). All state changes route through
 * orderLifecycleService (policy seam + transactional audit); this layer is thin.
 *
 * SCOPES: "orders:read" / "orders:write" literals cast to ApiScope — canonical
 * registration in scopes.ts is part of the wiring snippet. scopeSatisfied()
 * matches the literal, the "orders:*" namespace wildcard and "*"; the MASTER
 * key implicitly holds every scope (auth.ts) — so the routes work the moment
 * they are mounted, and the scopes.ts entries only add docs/validation.
 */
import { type Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireScope } from "./auth";
import type { ApiScope } from "./scopes";
import { sendOk, sendError, wrap, ApiHttpError } from "./envelope";
import {
  orderLifecycleEnabled,
  OrderLifecycleError,
  listOrders,
  getOrderDetail,
  traceOrder,
  allocateOrder,
  holdOrder,
  resumeOrder,
  cancelOrder,
} from "../../services/orders/orderLifecycleService";

// Scope literals (see header — canonical scopes.ts registration is snippet-only).
const ORDERS_READ = "orders:read" as ApiScope;
const ORDERS_WRITE = "orders:write" as ApiScope;

// ── helpers ───────────────────────────────────────────────────────────────────

/** Guard: structured 503 when the lifecycle layer is off. */
function ensureLifecycleEnabled(res: Response): boolean {
  if (!orderLifecycleEnabled()) {
    sendError(
      res,
      503,
      "order_lifecycle_disabled",
      "Order lifecycle API is disabled (ORDER_LIFECYCLE_ENABLED, default OFF; requires migration 0258).",
      { phase: "W3-A3" },
    );
    return false;
  }
  return true;
}

function parseOrderId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiHttpError(400, "bad_request", "Invalid order id.");
  }
  return id;
}

/** Map a typed service error onto the envelope; rethrow anything else. */
function toApiError(err: unknown): never {
  if (err instanceof OrderLifecycleError) {
    throw new ApiHttpError(err.httpStatus, err.code, err.message);
  }
  throw err;
}

function actorOf(req: Request): string {
  return `api-key:${req.apiPrincipal?.name ?? "unknown"}`;
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  lifecycle: z
    .enum(["created", "allocated", "running", "held", "compensating", "done", "failed", "rejected"])
    .optional(),
  lineId: z.coerce.number().int().positive().optional(),
});

const allocateBodySchema = z.object({
  lineId: z.number().int().positive().optional(),
  reason: z.string().max(1000).optional(),
}).strip();

const reasonBodySchema = z.object({
  reason: z.string().max(1000).optional(),
}).strip();

// ── routes ────────────────────────────────────────────────────────────────────

/** Register the order-lifecycle routes on the /api/v1 router (see snippet). */
export function registerOrdersLifecycleRoutes(r: Router): void {
  // GET /orders — list with effective lifecycle + allocation (projection-aware filter).
  r.get(
    "/orders",
    requireScope(ORDERS_READ),
    wrap(async (req: Request, res: Response) => {
      if (!ensureLifecycleEnabled(res)) return;
      const parsed = listQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        throw new ApiHttpError(400, "bad_request", "Invalid list query.", { issues: parsed.error.issues });
      }
      const result = await listOrders(parsed.data).catch(toApiError);
      sendOk(res, result);
    }),
  );

  // GET /orders/:id — detail + transition history.
  r.get(
    "/orders/:id",
    requireScope(ORDERS_READ),
    wrap(async (req, res) => {
      if (!ensureLifecycleEnabled(res)) return;
      const id = parseOrderId(req);
      const detail = await getOrderDetail(id).catch(toApiError);
      if (!detail) throw new ApiHttpError(404, "not_found", `Order ${id} not found.`);
      sendOk(res, detail);
    }),
  );

  // GET /orders/:id/trace — transitions + genealogy references (honest-empty).
  r.get(
    "/orders/:id/trace",
    requireScope(ORDERS_READ),
    wrap(async (req, res) => {
      if (!ensureLifecycleEnabled(res)) return;
      const id = parseOrderId(req);
      const trace = await traceOrder(id).catch(toApiError);
      if (!trace) throw new ApiHttpError(404, "not_found", `Order ${id} not found.`);
      sendOk(res, trace);
    }),
  );

  // POST /orders/:id/allocate — §9.1 allocation (explicit line or least-loaded).
  r.post(
    "/orders/:id/allocate",
    requireScope(ORDERS_WRITE),
    wrap(async (req, res) => {
      if (!ensureLifecycleEnabled(res)) return;
      const id = parseOrderId(req);
      const parsed = allocateBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiHttpError(400, "bad_request", "Invalid allocate body.", { issues: parsed.error.issues });
      }
      const result = await allocateOrder(id, {
        lineId: parsed.data.lineId,
        reason: parsed.data.reason,
        actor: actorOf(req),
      }).catch(toApiError);
      // 200 either way: a capacity REJECTED outcome is a valid domain result
      // (order is terminally rejected per spec §8.2), surfaced in data.state.
      sendOk(res, result);
    }),
  );

  // POST /orders/:id/hold — running → held.
  r.post(
    "/orders/:id/hold",
    requireScope(ORDERS_WRITE),
    wrap(async (req, res) => {
      if (!ensureLifecycleEnabled(res)) return;
      const id = parseOrderId(req);
      const parsed = reasonBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiHttpError(400, "bad_request", "Invalid body.", { issues: parsed.error.issues });
      }
      const result = await holdOrder(id, { reason: parsed.data.reason, actor: actorOf(req) }).catch(toApiError);
      sendOk(res, result);
    }),
  );

  // POST /orders/:id/resume — held → running.
  r.post(
    "/orders/:id/resume",
    requireScope(ORDERS_WRITE),
    wrap(async (req, res) => {
      if (!ensureLifecycleEnabled(res)) return;
      const id = parseOrderId(req);
      const parsed = reasonBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiHttpError(400, "bad_request", "Invalid body.", { issues: parsed.error.issues });
      }
      const result = await resumeOrder(id, { reason: parsed.data.reason, actor: actorOf(req) }).catch(toApiError);
      sendOk(res, result);
    }),
  );

  // POST /orders/:id/cancel — created/allocated → rejected · running/held →
  // compensating → failed (resources released via derived occupancy).
  r.post(
    "/orders/:id/cancel",
    requireScope(ORDERS_WRITE),
    wrap(async (req, res) => {
      if (!ensureLifecycleEnabled(res)) return;
      const id = parseOrderId(req);
      const parsed = reasonBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiHttpError(400, "bad_request", "Invalid body.", { issues: parsed.error.issues });
      }
      const result = await cancelOrder(id, parsed.data.reason, { actor: actorOf(req) }).catch(toApiError);
      sendOk(res, result);
    }),
  );
}
