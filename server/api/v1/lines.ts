/**
 * doc 44 W3-A2 / G3.1 — Line Controller API (SYNAPSE LDS-L3 §13.2).
 *
 *   GET  /v1/lines              — danh sách tuyến + trạng thái FSM      (lines:read)
 *   GET  /v1/lines/:id/state    — trạng thái + nhịp/bottleneck + readiness cache
 *   GET  /v1/lines/:id/stages   — per-trạm: máy, op-state, dwell, blocked/starved
 *   POST /v1/lines/:id/command  — start|hold|resume|changeover|complete|reset_fault
 *                                 (qua policy seam trong lineControllerService)  (lines:write)
 *
 * KHÔNG tự đăng ký vào router.ts/openapi.ts/scopes.ts (thuộc batch cha) —
 * xuất `registerLineRoutes(r)` + hằng scope; snippet đăng ký trong báo cáo batch.
 *
 * Scope strings: `lines:read` / `lines:write` — CHƯA có trong API_SCOPES
 * (scopes.ts out-of-scope batch này) nên khai báo tại đây và cast. Wildcard
 * grants ("*", "lines:*") và master key hoạt động ngay; sau khi cha thêm
 * LINES_READ/LINES_WRITE vào scopes.ts thì thay cast bằng API_SCOPES.*.
 */
import { type Router, type Request, type Response } from "express";
import { requireScope } from "./auth";
import type { ApiScope } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";
import {
  listLinesWithState,
  getLineStateDetail,
  getLineStages,
  executeLineCommand,
  LINE_COMMANDS,
  type LineCommand,
  type TransitionResult,
} from "../../services/lineController/lineControllerService";

// Snippet cho scopes.ts (batch cha): LINES_READ: "lines:read", LINES_WRITE: "lines:write".
export const LINES_READ_SCOPE = "lines:read" as unknown as ApiScope;
export const LINES_WRITE_SCOPE = "lines:write" as unknown as ApiScope;

/** Parse :id path param → positive int, else 400. */
function parseLineId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiHttpError(400, "bad_request", "Line id phải là số nguyên dương.");
  }
  return id;
}

/** Map một TransitionResult thất bại → ApiHttpError (status + code envelope). */
function throwTransitionFailure(result: Exclude<TransitionResult, { ok: true }>): never {
  switch (result.code) {
    case "INVALID_TRANSITION":
      throw new ApiHttpError(400, "invalid_transition", result.message, {
        from: result.from,
        to: result.to,
        allowed: result.allowed,
      });
    case "NOT_READY":
      throw new ApiHttpError(409, "not_ready", result.message, {
        from: result.from,
        to: result.to,
        checks: result.readiness.checks,
      });
    case "POLICY_DENIED":
      throw new ApiHttpError(403, "policy_denied", result.message, {
        effect: result.effect,
        policyRef: result.policyRef,
      });
    case "LINE_NOT_FOUND":
      throw new ApiHttpError(404, "not_found", result.message);
    case "CONFLICT":
      throw new ApiHttpError(409, "conflict", result.message);
    case "DB_UNAVAILABLE":
    default:
      throw new ApiHttpError(503, "db_unavailable", result.message);
  }
}

/** Đăng ký các route /lines trên /api/v1 router (gọi từ createV1Router — batch cha). */
export function registerLineRoutes(r: Router): void {
  // ── GET /v1/lines — danh sách tuyến ACTIVE + trạng thái FSM ────────────────
  r.get(
    "/lines",
    requireScope(LINES_READ_SCOPE),
    wrap(async (_req: Request, res: Response) => {
      const lines = await listLinesWithState();
      sendOk(res, { lines, count: lines.length });
    }),
  );

  // ── GET /v1/lines/:id/state — trạng thái + nhịp + bottleneck + readiness ───
  r.get(
    "/lines/:id/state",
    requireScope(LINES_READ_SCOPE),
    wrap(async (req: Request, res: Response) => {
      const id = parseLineId(req);
      const detail = await getLineStateDetail(id);
      if (!detail) throw new ApiHttpError(404, "not_found", `Không tìm thấy production line id=${id}.`);
      sendOk(res, detail);
    }),
  );

  // ── GET /v1/lines/:id/stages — trạng thái từng trạm trong tuyến ────────────
  r.get(
    "/lines/:id/stages",
    requireScope(LINES_READ_SCOPE),
    wrap(async (req: Request, res: Response) => {
      const id = parseLineId(req);
      const stages = await getLineStages(id);
      if (!stages) throw new ApiHttpError(404, "not_found", `Không tìm thấy production line id=${id}.`);
      sendOk(res, stages);
    }),
  );

  // ── POST /v1/lines/:id/command — lệnh tuyến (qua policy seam) ───────────────
  r.post(
    "/lines/:id/command",
    requireScope(LINES_WRITE_SCOPE),
    wrap(async (req: Request, res: Response) => {
      const id = parseLineId(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const command = String(body.command ?? "");
      if (!(LINE_COMMANDS as readonly string[]).includes(command)) {
        throw new ApiHttpError(
          400,
          "bad_request",
          `command phải là một trong: ${LINE_COMMANDS.join(" | ")}.`,
        );
      }
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;
      const recipeSetRef =
        typeof body.recipeSetRef === "string" && body.recipeSetRef.trim()
          ? body.recipeSetRef.trim().slice(0, 200)
          : undefined;

      const result = await executeLineCommand(id, command as LineCommand, {
        reason,
        recipeSetRef,
        actor: `api:${req.apiPrincipal?.name ?? "unknown"}`,
      });
      if (!result.ok) throwTransitionFailure(result);
      sendOk(res, {
        lineId: result.lineId,
        command,
        from: result.from,
        to: result.to,
        ts: result.ts,
        correlationId: result.correlationId,
        ...(result.readiness ? { readiness: result.readiness } : {}),
      });
    }),
  );
}
