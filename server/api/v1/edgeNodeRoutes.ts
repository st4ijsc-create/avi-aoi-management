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

/**
 * doc 81 Đợt 10 task B — the node's protocol decides the handlers: a v2 node (edge_nodes."protocolVersion" = 2) is served ONLY
 * by the v2 handlers (strict bodies, signed package / commands, central the only writer) — a v1 claim is never accepted for it;
 * a v1 node keeps the Đợt 9 handlers for one release (D11). The v2-only routes answer 409 protocol_version to a v1 node.
 * Unreadable version (DB down) ⇒ v2 handlers, which answer 503 themselves (never the DB-backed v1 path by accident).
 */
async function isV2(node: import("../../services/edge/edgeNodeCredentials").EdgeNodePrincipal): Promise<boolean> {
  try {
    const { centralDb, nodeProtocolVersion } = await import("../../services/edge/edgeCentralCommon");
    return (await nodeProtocolVersion(await centralDb(), node.nodeId)) === 2;
  } catch {
    return true;
  }
}

export function registerEdgeNodeRoutes(r: Router): void {
  const auth = requireEdgeNode();
  const svc = () => import("../../services/edge/edgeExecutionCentral");
  const node = (req: Request) => (req as NodeRequest).edgeNode!;
  const body = (req: Request) => ((req.body ?? {}) as Record<string, unknown>);
  /** v1 handler for a v1 node, v2 handler for a v2 node. */
  const byVersion =
    (v1: (req: Request) => Promise<Parameters<typeof answer>[1]>, v2: (req: Request) => Promise<Parameters<typeof answer>[1]>) =>
    async (req: Request, res: Response) =>
      answer(res, (await isV2(node(req))) ? await v2(req) : await v1(req));

  r.post(
    "/edge/node/pull",
    auth,
    wrap(byVersion(async (req) => (await svc()).pullForNode(node(req)), async (req) => (await svc()).pullForNodeV2(node(req), req.body))),
  );
  r.post(
    "/edge/node/runs/:runId/claim",
    auth,
    wrap(byVersion(async (req) => (await svc()).claimForNode(node(req), runIdOf(req), body(req)), async (req) => (await svc()).claimForNodeV2(node(req), runIdOf(req), req.body))),
  );
  r.post(
    "/edge/node/runs/:runId/progress",
    auth,
    wrap(byVersion(async (req) => (await svc()).progressForNode(node(req), runIdOf(req), body(req)), async (req) => (await svc()).progressForNodeV2(node(req), runIdOf(req), req.body))),
  );
  r.post(
    "/edge/node/runs/:runId/complete",
    auth,
    wrap(byVersion(async (req) => (await svc()).completeForNode(node(req), runIdOf(req), body(req)), async (req) => (await svc()).completeForNodeV2(node(req), runIdOf(req), req.body))),
  );
  r.post(
    "/edge/node/runs/:runId/release",
    auth,
    wrap(byVersion(async (req) => (await svc()).releaseForNode(node(req), runIdOf(req), body(req)), async (req) => (await svc()).releaseForNodeV2(node(req), runIdOf(req), req.body))),
  );
  r.post(
    "/edge/node/runs/:runId/interrupted",
    auth,
    wrap(byVersion(async (req) => (await svc()).interruptedForNode(node(req), runIdOf(req), body(req)), async (req) => (await svc()).interruptedForNodeV2(node(req), runIdOf(req), req.body))),
  );

  // ── doc 81 Đợt 10 task B — v2-only routes (each answers 409 protocol_version to a v1 node) ──
  r.post(
    "/edge/node/config",
    auth,
    wrap(async (req, res) => answer(res, await (await import("../../services/edge/edgeConfigCentral")).configForNode(node(req), req.body, req.header("if-none-match") ?? null))),
  );
  r.post(
    "/edge/node/heartbeat",
    auth,
    wrap(async (req, res) => answer(res, await (await import("../../services/edge/edgeCoordinator")).heartbeatFromNode(node(req), req.body))),
  );
  r.post(
    "/edge/node/program-checks",
    auth,
    wrap(async (req, res) => answer(res, await (await import("../../services/edge/edgeIngestCentral")).programChecksForNode(node(req), req.body))),
  );
  r.post(
    "/edge/node/runs/:runId/authorize",
    auth,
    wrap(async (req, res) => answer(res, await (await import("../../services/edge/edgeAuthorizeCentral")).authorizeForNode(node(req), runIdOf(req), req.body))),
  );
  r.post(
    "/edge/node/runs/:runId/report",
    auth,
    wrap(async (req, res) => answer(res, await (await import("../../services/edge/edgeReportsCentral")).reportForNode(node(req), runIdOf(req), req.body))),
  );
  r.post(
    "/edge/node/telemetry",
    auth,
    wrap(async (req, res) => answer(res, await (await import("../../services/edge/edgeIngestCentral")).telemetryForNode(node(req), req.body))),
  );
  r.post(
    "/edge/node/robots/state",
    auth,
    wrap(async (req, res) => answer(res, await (await import("../../services/edge/edgeIngestCentral")).robotStateForNode(node(req), req.body))),
  );
  r.post(
    "/edge/node/locks/events",
    auth,
    wrap(async (req, res) => answer(res, await (await import("../../services/edge/edgeReportsCentral")).eventsForNode(node(req), req.body))),
  );
}
