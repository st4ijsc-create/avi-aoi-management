/**
 * Correlation request middleware — doc 44 W6-4 (gap G5.17). SYNAPSE §5.12.1.
 *
 * Establishes the per-request correlation context (AsyncLocalStorage backbone) so the
 * WHOLE downstream chain — tRPC handlers, command dispatch, genealogy writes, and every
 * pino log line (via correlationMixin) — shares ONE id. This closes the "nút bấm → lệnh
 * → máy" trace end-to-end.
 *
 * Ingest order:
 *   1. `x-correlation-id` header (emitted by the web client per user-action batch), else
 *   2. the trace-id inside a W3C `traceparent` header (00-<trace-id>-<span-id>-<flags>), else
 *   3. a fresh uuid.
 *
 * The resolved id is echoed back as `X-Correlation-Id` so the browser/devtools can read it.
 * Additive + non-gated (log/trace enrichment only) — zero behaviour change to any handler.
 */
import type { NextFunction, Request, Response } from "express";
import { newCorrelationId, withCorrelation } from "../services/observability/correlation";

const UUID_LIKE = /^[a-zA-Z0-9._-]{1,128}$/;
// W3C traceparent: version(2) "-" trace-id(32 hex) "-" parent-id(16 hex) "-" flags(2)
const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i;

/** Extract a usable correlation id from request headers (x-correlation-id → traceparent). */
export function readIncomingCorrelationId(headers: Record<string, unknown>): string | undefined {
  const raw = headers["x-correlation-id"];
  const cid = Array.isArray(raw) ? raw[0] : raw;
  if (typeof cid === "string" && UUID_LIKE.test(cid.trim())) return cid.trim();

  const tpRaw = headers["traceparent"];
  const tp = Array.isArray(tpRaw) ? tpRaw[0] : tpRaw;
  if (typeof tp === "string") {
    const m = TRACEPARENT.exec(tp.trim());
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Express middleware that wraps the rest of the request in a correlation context.
 * Mount EARLY (before route handlers) so every log line + command carries the id.
 */
export function correlationRequestMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = readIncomingCorrelationId(req.headers as Record<string, unknown>) ?? newCorrelationId();
    try {
      res.setHeader("X-Correlation-Id", correlationId);
    } catch {
      /* headers may already be sent on odd paths — never block the request */
    }
    // als.run wraps next(); every async op started downstream inherits the store.
    withCorrelation({ correlationId }, () => next());
  };
}
