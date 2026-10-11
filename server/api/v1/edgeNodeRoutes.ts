/**
 * doc 81 Đợt 9 task S2 — the per-node EDGE EXECUTION endpoints (`/api/v1/edge/node/*`). See
 * server/services/edge/edgeExecutionCentral.ts for the protocol and docs/EDGE_GATEWAY.md §Run execution for operators.
 *
 * AUTHENTICATION: ONLY a node credential (`Authorization: Bearer edn_…`, edgeNodeCredentials) — an API key, the master key,
 * a machine key or an OAuth token is never accepted here (they do not have the credential's shape and are not looked up), and
 * a node credential is never accepted anywhere else (auth.resolvePrincipal does not know the table). Missing / malformed /
 * unknown / revoked / node gone ⇒ the SAME 401. The node identity is the credential's node — never a code from the body.
 * FLAG: EDGE_RUNTIME_ENABLED off ⇒ 503 `edge_disabled` (as POST /edge/sync).
 */
import type { NextFunction, Request, Response, Router } from "express";
import { sendError, sendOk, wrap } from "./envelope";

type NodeRequest = Request & { edgeNode?: import("../../services/edge/edgeNodeCredentials").EdgeNodePrincipal };

function bearer(req: Request): string | null {
  const auth = req.header("authorization");
  if (!auth || !/^bearer\s+/i.test(auth)) return null;
  const tok = auth.replace(/^bearer\s+/i, "").trim();
  return tok || null;
}

/** Node-credential authentication (see header). Never logs the token. */
export function requireEdgeNode() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { edgeRuntimeEnabled } = await import("../../services/edge/edgeCoordinator");
    if (!edgeRuntimeEnabled()) {
      sendError(res, 503, "edge_disabled", "Edge runtime is disabled (EDGE_RUNTIME_ENABLED).", { phase: "E4" });
      return;
    }
    const { authenticateEdgeNodeToken } = await import("../../services/edge/edgeNodeCredentials");
    const node = await authenticateEdgeNodeToken(bearer(req));
    if (!node) {
      sendError(res, 401, "unauthorized", "Edge node credential missing, unknown or revoked.");
      return;
    }
    (req as NodeRequest).edgeNode = node;
    next();
  };
}

function runIdOf(req: Request): number {
  const n = Number(req.params.runId);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

function answer(res: Response, a: { http: number; code?: string; message?: string; data?: unknown }): void {
  if (a.http >= 200 && a.http < 300) {
    sendOk(res, a.data ?? null, a.http);
    return;
  }
  sendError(res, a.http, a.code ?? "error", a.message ?? "Refused.", a.data);
}

export function registerEdgeNodeRoutes(r: Router): void {
  const auth = requireEdgeNode();
  const svc = () => import("../../services/edge/edgeExecutionCentral");
  const node = (req: Request) => (req as NodeRequest).edgeNode!;
  const body = (req: Request) => ((req.body ?? {}) as Record<string, unknown>);

  r.post(
    "/edge/node/pull",
    auth,
    wrap(async (req, res) => answer(res, await (await svc()).pullForNode(node(req)))),
  );
  r.post(
    "/edge/node/runs/:runId/claim",
    auth,
    wrap(async (req, res) => answer(res, await (await svc()).claimForNode(node(req), runIdOf(req), body(req)))),
  );
  r.post(
    "/edge/node/runs/:runId/progress",
    auth,
    wrap(async (req, res) => answer(res, await (await svc()).progressForNode(node(req), runIdOf(req), body(req)))),
  );
  r.post(
    "/edge/node/runs/:runId/complete",
    auth,
    wrap(async (req, res) => answer(res, await (await svc()).completeForNode(node(req), runIdOf(req), body(req)))),
  );
  r.post(
    "/edge/node/runs/:runId/release",
    auth,
    wrap(async (req, res) => answer(res, await (await svc()).releaseForNode(node(req), runIdOf(req), body(req)))),
  );
  r.post(
    "/edge/node/runs/:runId/interrupted",
    auth,
    wrap(async (req, res) => answer(res, await (await svc()).interruptedForNode(node(req), runIdOf(req), body(req)))),
  );
}
