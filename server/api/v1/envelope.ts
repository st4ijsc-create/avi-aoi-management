/**
 * Phase E1 — Unified Machine API: the CONSISTENT response envelope + helpers.
 *
 * Every /api/v1 response is `{ ok, data?, error? }`. These helpers keep status
 * codes + shape uniform and make handlers fail-safe: `wrap()` catches any throw
 * and emits a structured 500 error envelope instead of crashing the process.
 */
import type { Request, Response } from "express";

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ApiError;
}

/** Send a success envelope with an explicit status (default 200). */
export function sendOk<T>(res: Response, data: T, status = 200): void {
  const body: ApiEnvelope<T> = { ok: true, data };
  res.status(status).json(body);
}

/** Send a structured error envelope. */
export function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  const body: ApiEnvelope = { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } };
  res.status(status).json(body);
}

/**
 * Wrap an async Express handler so an unexpected throw becomes a structured 500
 * envelope (never an unhandled rejection / process crash). Handlers that want a
 * specific status throw an `ApiHttpError` (below) — caught and mapped here.
 */
export function wrap(
  handler: (req: Request, res: Response) => Promise<void> | void,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof ApiHttpError) {
        sendError(res, err.status, err.code, err.message, err.details);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      // Never leak a stack to the client; log it server-side.
      console.error("[api/v1] handler error:", message);
      sendError(res, 500, "internal_error", "Internal error processing the request.");
    }
  };
}

/** A typed error a handler can throw to control the HTTP status + envelope. */
export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}
