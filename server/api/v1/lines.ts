/**
 * doc 44 W3-A2 / G3.1 (+W3-B1 / G3.3) — Line Controller API (SYNAPSE LDS-L3 §13.2).
 *
 *   GET  /v1/lines              — danh sách tuyến + trạng thái FSM      (lines:read)
 *   GET  /v1/lines/:id/state    — trạng thái + nhịp/bottleneck + readiness cache
 *   GET  /v1/lines/:id/stages   — per-trạm: máy, op-state, dwell, blocked/starved
 *   POST /v1/lines/:id/command  — start|hold|resume|changeover|complete|reset_fault
 *                                 (qua policy seam trong lineControllerService)  (lines:write)
 *   POST /v1/lines/:id/recipe   — nạp recipe set {recipeSetCode} (spec §13.2):
 *                                 distribute qua đường deploy sẵn có + XÁC NHẬN
 *                                 NẠP + khóa phiên bản suốt lô           (lines:write)
 *
 * Đăng ký: router.ts gọi registerLineRoutes(r) (đã wire ở batch W3-A2);
 * openapi.ts path mới POST /lines/{id}/recipe = snippet trong báo cáo W3-B1
 * (file đó ngoài phạm vi batch này).
 *
 * Scopes: LINES_READ/LINES_WRITE đã CHÍNH THỨC trong API_SCOPES (scopes.ts,
 * batch cha W3-A2 wire) — dùng thẳng, hết cast tạm.
 */
import { type Router, type Request, type Response } from "express";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
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
import {
  distributeRecipeSetByCode,
  type RecipeSetFailure,
} from "../../services/lineController/recipeSetService";

// Scope chính thức từ scopes.ts (batch cha đã thêm LINES_READ/LINES_WRITE).
export const LINES_READ_SCOPE = API_SCOPES.LINES_READ;
export const LINES_WRITE_SCOPE = API_SCOPES.LINES_WRITE;

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

/** Map một RecipeSetFailure → ApiHttpError (status + code envelope) — W3-B1. */
function throwRecipeSetFailure(f: RecipeSetFailure): never {
  switch (f.code) {
    case "NOT_FOUND":
      throw new ApiHttpError(404, "recipe_set_not_found", f.message);
    case "LINE_NOT_FOUND":
      throw new ApiHttpError(404, "not_found", f.message);
    case "LOCKED":
      throw new ApiHttpError(409, "recipe_set_locked", f.message);
    case "INVALID_STATE":
      throw new ApiHttpError(409, "invalid_state", f.message);
    case "CONFLICT":
      throw new ApiHttpError(409, "conflict", f.message);
    case "VALIDATION":
      throw new ApiHttpError(400, "bad_request", f.message);
    case "DB_UNAVAILABLE":
    default:
      throw new ApiHttpError(503, "db_unavailable", f.message);
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

  // ── POST /v1/lines/:id/recipe — nạp recipe set, khóa phiên bản (spec §13.2) ──
  // W3-B1 (G3.3): distribute qua đường recipe_deployments sẵn có (GIỮ
  // second-approver gate) + XÁC NHẬN NẠP mọi máy required → set
  // line_states.recipe_set_ref + KHÓA set suốt lô. Chưa xác nhận đủ → 409
  // recipe_not_confirmed kèm per-máy results + missing (honest partial).
  r.post(
    "/lines/:id/recipe",
    requireScope(LINES_WRITE_SCOPE),
    wrap(async (req: Request, res: Response) => {
      const id = parseLineId(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const code =
        typeof body.recipeSetCode === "string" && body.recipeSetCode.trim()
          ? body.recipeSetCode.trim().slice(0, 200)
          : "";
      if (!code) {
        throw new ApiHttpError(400, "bad_request", "recipeSetCode (string) là bắt buộc — mã recipe set, vd MODEL-X@v3.");
      }
      const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : undefined;

      const result = await distributeRecipeSetByCode(id, code, {
        actor: `api:${req.apiPrincipal?.name ?? "unknown"}`,
        notes,
      });
      if (!result.ok) throwRecipeSetFailure(result);
      if (!result.confirmed) {
        throw new ApiHttpError(
          409,
          "recipe_not_confirmed",
          `Recipe set '${code}' phân phối nhưng CHƯA xác nhận nạp đủ trên tuyến ${id} — ${result.missing.length} máy required chưa active đúng phiên bản.`,
          { results: result.results, missing: result.missing },
        );
      }
      sendOk(res, {
        lineId: id,
        recipeSet: result.code,
        recipeSetId: result.recipeSetId,
        confirmed: true,
        locked: result.locked,
        results: result.results,
      });
    }),
  );
}
