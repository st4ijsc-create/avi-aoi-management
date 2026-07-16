import type { Response } from "express";

// ── Machine REST proxy error contract (doc 51 P2, §5.6 / CASE #2) ─────────────
// The `/api/machine/*` proxies used to collapse EVERY failure into
// `HTTP 400 {success:false, message}`. That is lossy and dangerous on the ingest
// path: a machine that received 400 on a *transient* fault (DB unavailable,
// throttle) treated the inspection as permanently rejected and DISCARDED it
// instead of retrying — silent data loss. This module maps the tRPC error code to
// the real HTTP status and tells the caller whether the failure is retry-able, so
// the ingest client can safely re-send (transient) vs. give up (its own bad
// request). Kept next to the proxies on purpose; `/api/machine/claim` (P0)
// intentionally maps UNAUTHORIZED→400 and is NOT routed through here.

export interface MachineProxyErrorInfo {
  status: number;
  /** true → the fault is transient; the machine SHOULD retry the same request. */
  retryable: boolean;
  /** Seconds the client should wait before retrying (429 only). */
  retryAfter?: number;
}

/** Default backoff for a 429 whose TRPCError carried no explicit Retry-After.
 *  Every machine throttle in this codebase uses a fixed 60s window, so 60 is an
 *  honest, concrete hint rather than a guess. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export function classifyMachineProxyError(error: any): MachineProxyErrorInfo {
  const code: string | undefined = error?.code;
  switch (code) {
    case "UNAUTHORIZED":
      return { status: 401, retryable: false };
    case "FORBIDDEN":
      return { status: 403, retryable: false };
    case "TOO_MANY_REQUESTS": {
      // Surface Retry-After (seconds) if the throttle attached one; otherwise fall
      // back to the fixed 60s window so clients still get a concrete backoff hint
      // instead of hammering the ingest path.
      const raw = Number(
        error?.retryAfter ?? error?.cause?.retryAfter ?? error?.cause?.retryAfterSeconds,
      );
      const retryAfter = Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : DEFAULT_RETRY_AFTER_SECONDS;
      return { status: 429, retryable: true, retryAfter };
    }
    case "NOT_FOUND":
      return { status: 404, retryable: false };
    case "BAD_REQUEST":
    case "PARSE_ERROR":
      return { status: 400, retryable: false };
    case "CONFLICT":
      // e.g. an idempotency/unique clash — retrying the SAME body will not help.
      return { status: 409, retryable: false };
    case "PAYLOAD_TOO_LARGE":
      return { status: 413, retryable: false };
    case "TIMEOUT":
      return { status: 503, retryable: true };
    case "INTERNAL_SERVER_ERROR":
      // Transient by contract on this path — client MUST retry so data is not lost.
      return { status: 503, retryable: true };
    default:
      break;
  }
  // Plain Errors that never became TRPCErrors (e.g. `throw new Error("Database not
  // available")` on the ingest path) can arrive with no `.code`. Treat a
  // DB/connection-unavailable signal as a transient 503 so the machine retries
  // rather than dropping the record.
  const msg = String(error?.message || "");
  if (/database not available|db not available|econnrefused|connection (terminated|refused)|timed? ?out/i.test(msg)) {
    return { status: 503, retryable: true };
  }
  // Unknown/uncoded: an honest server error, not the client's bad request. Do not
  // claim retryable (could be a real bug) but do not falsely blame the client (400).
  return { status: 500, retryable: false };
}

/** Write a consistent, backward-compatible error response for a machine proxy.
 *  Keeps the legacy `{success:false, message}` shape and ADDS `retryable` so the
 *  client knows whether to re-send. Emits `Retry-After` for 429. */
export function sendMachineProxyError(res: Response, error: any, fallbackMessage: string): void {
  const info = classifyMachineProxyError(error);
  if (info.retryAfter != null) res.set("Retry-After", String(info.retryAfter));
  res.status(info.status).json({
    success: false,
    retryable: info.retryable,
    message: error?.message || fallbackMessage,
  });
}

/** Safe metadata for the submit-inspection hot-path log line. NEVER returns the
 *  measurements array (carries base64 image data) or the apiKey (a live
 *  credential). Structural guarantee for the CASE #2 log-leak fix: no matter what
 *  the body contains, only these three scalar fields are ever produced. */
export function safeMachineLogMeta(
  body: any,
): { machineCode: string; serialNumber: string; measurements: number } {
  return {
    machineCode: typeof body?.machineCode === "string" ? body.machineCode : "?",
    serialNumber: typeof body?.serialNumber === "string" ? body.serialNumber : "?",
    measurements: Array.isArray(body?.measurements) ? body.measurements.length : 0,
  };
}
