/**
 * W3-A1 (doc 44 G3.13 + G3.16) — SYNAPSE Tầng-3 Policy API (spec §13.3 + §13.4).
 *
 *   POST /v1/policy/evaluate  — DRY-RUN standardized evaluation (spec §13.4):
 *                               { subject, action, resource?, verb?, context? }
 *                               → { decision: PERMIT|DENY, obligations[],
 *                                   reason_code, policy_ref, latency_ms }.
 *                               READ-ONLY: this endpoint NEVER dispatches a
 *                               command — enforcement stays inside the existing
 *                               gates (policyGate → commandDispatcher).
 *   GET  /v1/policy/policies  — list the governed rule set (DB store when
 *                               POLICY_STORE_ENABLED, else the built-in
 *                               DEFAULT_POLICIES presented in the same shape).
 *   GET  /v1/policy/audit     — the APPEND-ONLY decision log, filtered by
 *                               subject/action/decision/from/to/limit.
 *
 * NOT self-registered: the parent wires registerPolicyRoutes(r) into
 * server/api/v1/router.ts + adds POLICY_READ/POLICY_WRITE to scopes.ts and the
 * OpenAPI paths (see the W3-A1 report snippets). Until scopes.ts carries the
 * "policy:read" literal, the local const below is cast — scopeSatisfied() is
 * string-based, so master keys / "*" / "policy:*" grants already work.
 */
import { type Router, type Request, type Response } from "express";
import { requireScope } from "./auth";
import type { ApiScope } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";

/** parent: replace with API_SCOPES.POLICY_READ once scopes.ts carries it. */
const POLICY_READ = "policy:read" as ApiScope;

const DECISIONS = new Set(["PERMIT", "DENY"]);

/** Register the /policy/* routes on the /api/v1 router (parent wires this). */
export function registerPolicyRoutes(r: Router): void {
  // POST /policy/evaluate — dry-run standardized evaluation (spec §13.4 example).
  r.post(
    "/policy/evaluate",
    requireScope(POLICY_READ),
    wrap(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as {
        subject?: unknown;
        action?: unknown;
        resource?: unknown;
        verb?: unknown;
        context?: unknown;
        request_id?: unknown;
      };
      if (typeof body.action !== "string" || body.action.trim() === "") {
        throw new ApiHttpError(400, "bad_request", "Body field `action` is required (non-empty string).");
      }
      if (body.context != null && (typeof body.context !== "object" || Array.isArray(body.context))) {
        throw new ApiHttpError(400, "bad_request", "Body field `context` must be an object when present.");
      }
      const subject =
        typeof body.subject === "string" && body.subject.trim() !== ""
          ? body.subject.trim()
          : (req.apiPrincipal?.name ?? "api");
      const resource = typeof body.resource === "string" && body.resource.trim() !== "" ? body.resource.trim() : null;
      // Spec §13.4 carries a top-level `verb` — fold it into the condition-visible context.
      const context: Record<string, unknown> = {
        ...((body.context as Record<string, unknown> | null | undefined) ?? {}),
        ...(typeof body.verb === "string" && body.verb ? { verb: body.verb } : {}),
      };

      const { evaluatePolicy } = await import("../../services/security/policyEvaluate");
      const { currentP95Ms } = await import("../../services/security/policyLatency");
      const d = evaluatePolicy(subject, body.action.trim(), resource, context, {
        requestId: typeof body.request_id === "string" ? body.request_id : null,
      });
      sendOk(res, {
        decision: d.decision,
        obligations: d.obligations,
        reason_code: d.reason_code,
        policy_ref: d.policy_ref,
        latency_ms: d.latency_ms,
        // advisory extras (additive): human reason + current in-window p95
        reason: d.reason,
        eval_p95_ms_1min: currentP95Ms(),
      });
    }),
  );

  // GET /policy/policies — the governed rule set (as-code/DB view).
  r.get(
    "/policy/policies",
    requireScope(POLICY_READ),
    wrap(async (_req: Request, res: Response) => {
      const { listStoredPolicies } = await import("../../services/security/policyStore");
      const out = await listStoredPolicies();
      sendOk(res, { storeEnabled: out.storeEnabled, count: out.policies.length, policies: out.policies });
    }),
  );

  // GET /policy/audit — immutable decision log (newest first, filterable).
  r.get(
    "/policy/audit",
    requireScope(POLICY_READ),
    wrap(async (req: Request, res: Response) => {
      const q = req.query as Record<string, unknown>;
      const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
      const decision = str(q.decision);
      if (decision && !DECISIONS.has(decision)) {
        throw new ApiHttpError(400, "bad_request", 'Query `decision` must be "PERMIT" or "DENY".');
      }
      let from: Date | undefined;
      let to: Date | undefined;
      if (str(q.from)) {
        from = new Date(String(q.from));
        if (Number.isNaN(from.getTime())) throw new ApiHttpError(400, "bad_request", "Invalid `from` — expected an ISO date-time.");
      }
      if (str(q.to)) {
        to = new Date(String(q.to));
        if (Number.isNaN(to.getTime())) throw new ApiHttpError(400, "bad_request", "Invalid `to` — expected an ISO date-time.");
      }
      const limitRaw = Number(q.limit);
      const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

      const { queryDecisionLog, policyStoreEnabled } = await import("../../services/security/policyStore");
      try {
        const rows = await queryDecisionLog({ subject: str(q.subject), action: str(q.action), decision, from, to, limit });
        sendOk(res, { count: rows.length, storeEnabled: policyStoreEnabled(), decisions: rows });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ApiHttpError(
          503,
          "policy_audit_unavailable",
          `Decision log unavailable (is migration 0256_policy_store applied?): ${message}`,
        );
      }
    }),
  );
}
