/**
 * AI Copilot Actions — GĐ2 HITL write-action lifecycle service.
 *
 * Two-phase, human-in-the-loop flow for AI-proposed write actions:
 *
 *   propose  → record a `proposed` row (dry-run preview, NO DB mutation),
 *              RBAC gated, returns a pendingAction the UI renders as a confirm
 *              card. Token = row id (uuid) bound to userId, TTL 5'.
 *   confirm  → verify status/expiry/userId/token → RBAC re-check → idempotency
 *              (already executed ⇒ return cached result) → execute() with args
 *              read from the DB row (never the client) → mark executed + audit.
 *   cancel   → mark cancelled (only the owner, only while proposed).
 *
 * Safety invariants (Mục 8):
 *   - confirm is mandatory; propose never auto-executes.
 *   - execute() args come from ai_pending_actions.argsJson, not the request.
 *   - idempotencyKey unique → at most one execution.
 *   - RBAC checked TWICE (propose + execute), role taken from session.
 *   - audit logged at every milestone via audit_logs (append-only).
 */

import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiPendingActions } from "../../drizzle/schema";
import { checkPermission } from "../_core/accessControl";
import { getTool, isWriteTool, assertExecutable, type ActionPreview, type Tool, type ToolExecContext, type ToolLang } from "./aiLocalTools/toolRegistry";
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
  createAuditContext,
  logCrudOperation,
  logUpdate,
  type AuditContext,
} from "./auditTrailService";

// TTL for a proposed action before it expires (5 minutes — Mục 2).
const PENDING_TTL_MS = 5 * 60 * 1000;

export interface CopilotUser {
  id: number;
  role: string;
  name?: string | null;
}

export interface PendingActionDTO {
  actionId: string;
  token: string; // == actionId; bound to userId (no separate HMAC — quyết định đã chốt)
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  preview: ActionPreview;
  requiredPermission?: { module: string; action: string } | null;
  expiresAt: string; // ISO
}

export interface ProposeResult {
  ok: boolean;
  /** Present on success. */
  pendingAction?: PendingActionDTO;
  /** When denied by RBAC (or other refusal), a localized explanation. */
  denied?: boolean;
  reason?: string;
  message?: string;
}

export interface ConfirmResult {
  ok: boolean;
  status: "executed" | "denied" | "expired" | "not_found" | "invalid";
  result?: unknown;
  message?: string;
}

function buildAuditCtx(user: CopilotUser, req?: ToolExecContext["req"]): AuditContext {
  return createAuditContext({ user: { id: user.id, name: user.name ?? null }, req });
}

function denyMessage(lang: ToolLang, summary: string): string {
  switch (lang) {
    case "en":
      return `You do not have permission to perform this action: ${summary}. Please contact an administrator.`;
    case "zh":
      return `您没有执行此操作的权限：${summary}。请联系管理员。`;
    case "vi":
    default:
      return `Bạn không có quyền thực hiện thao tác này: ${summary}. Vui lòng liên hệ quản trị viên.`;
  }
}

/**
 * Phase 1 — propose. RBAC gate → preview (NO DB write) → store `proposed`.
 * Returns a denied result (without storing) when the user lacks permission.
 */
export async function proposeAction(
  tool: Tool<any, any>,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<ProposeResult> {
  assertExecutable(tool);
  const perm = tool.requiredPermission!;
  const summary = tool.summarize ? tool.summarize(args, ctx.lang) : tool.name;

  // RBAC gate #1 (before proposing).
  const allowed = await checkPermission(ctx.user.id, ctx.user.role, perm.module, perm.action);
  if (!allowed) {
    // Audit: denied at propose stage.
    await logCrudOperation(buildAuditCtx(ctx.user, ctx.req), {
      action: AUDIT_ACTIONS.AI_ACTION_DENIED,
      entityType: ENTITY_TYPES.AI_ACTION,
      entityName: tool.name,
      details: {
        operation: "AI_ACTION_DENIED",
        metadata: {
          tool: tool.name,
          requiredPermission: perm,
          args: sanitizeArgs(args),
          denyReason: "MISSING_PERMISSION",
          stage: "propose",
        },
      },
      status: "failure",
    });
    return { ok: false, denied: true, reason: "MISSING_PERMISSION", message: denyMessage(ctx.lang, summary) };
  }

  // Dry-run preview (must NOT mutate the DB).
  const preview = await tool.preview!(args, ctx);

  const db = await getDb();
  if (!db) {
    return { ok: false, reason: "DB_UNAVAILABLE", message: denyMessage(ctx.lang, summary) };
  }

  const actionId = randomUUID();
  const idempotencyKey = randomUUID();
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

  await db.insert(aiPendingActions).values({
    id: actionId,
    tool: tool.name,
    argsJson: args,
    userId: ctx.user.id,
    userRole: ctx.user.role,
    requiredPermissionJson: perm,
    summary,
    previewJson: preview as unknown as Record<string, unknown>,
    status: "proposed",
    idempotencyKey,
    expiresAt,
  });

  // Audit: proposed.
  await logCrudOperation(buildAuditCtx(ctx.user, ctx.req), {
    action: AUDIT_ACTIONS.AI_ACTION_PROPOSED,
    entityType: ENTITY_TYPES.AI_ACTION,
    entityName: tool.name,
    details: {
      operation: "AI_ACTION_PROPOSED",
      changes: preview.changes,
      metadata: {
        actionId,
        tool: tool.name,
        requiredPermission: perm,
        args: sanitizeArgs(args),
        preview: { entityType: preview.entityType, entityId: preview.entityId, warnings: preview.warnings },
      },
    },
    status: "success",
  });

  return {
    ok: true,
    pendingAction: {
      actionId,
      token: actionId,
      tool: tool.name,
      args,
      summary,
      preview,
      requiredPermission: perm,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/**
 * Phase 2 — confirm. Verifies ownership/expiry/token, re-checks RBAC, then
 * executes with args from the DB row. Idempotent: a second confirm on an
 * already-executed action returns the cached result without re-running.
 */
export async function confirmAction(
  actionId: string,
  token: string,
  user: CopilotUser,
  lang: ToolLang,
  req?: ToolExecContext["req"],
): Promise<ConfirmResult> {
  const db = await getDb();
  if (!db) return { ok: false, status: "invalid", message: "DB_UNAVAILABLE" };

  const [row] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, actionId)).limit(1);
  if (!row) return { ok: false, status: "not_found", message: "Action không tồn tại." };

  // Token bound to userId — both must match the session user.
  if (token !== row.id || row.userId !== user.id) {
    await auditConfirmFailure(user, req, row.tool, actionId, "TOKEN_OR_OWNER_MISMATCH");
    return { ok: false, status: "invalid", message: "Token hoặc người dùng không khớp." };
  }

  // Idempotency: already executed → return cached result.
  if (row.status === "executed") {
    return { ok: true, status: "executed", result: row.resultJson ?? null, message: "Đã thực thi trước đó." };
  }
  if (row.status !== "proposed" && row.status !== "confirmed") {
    return { ok: false, status: row.status === "expired" ? "expired" : "invalid", message: `Trạng thái không hợp lệ: ${row.status}.` };
  }

  // Expiry check (TTL).
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.update(aiPendingActions).set({ status: "expired" }).where(eq(aiPendingActions.id, actionId));
    return { ok: false, status: "expired", message: "Đề xuất đã hết hạn. Vui lòng yêu cầu lại." };
  }

  const tool = getTool(row.tool);
  if (!tool || !isWriteTool(tool)) {
    return { ok: false, status: "invalid", message: "Tool không khả dụng." };
  }
  assertExecutable(tool);
  const perm = row.requiredPermissionJson ?? tool.requiredPermission!;

  // Mark confirmed + audit.
  await db.update(aiPendingActions).set({ status: "confirmed" }).where(eq(aiPendingActions.id, actionId));
  await logCrudOperation(buildAuditCtx(user, req), {
    action: AUDIT_ACTIONS.AI_ACTION_CONFIRMED,
    entityType: ENTITY_TYPES.AI_ACTION,
    entityName: row.tool,
    details: { operation: "AI_ACTION_CONFIRMED", metadata: { actionId, tool: row.tool, requiredPermission: perm } },
    status: "success",
  });

  // RBAC gate #2 (before execute — role may have changed between phases).
  const allowed = await checkPermission(user.id, user.role, perm.module, perm.action as any);
  if (!allowed) {
    await db.update(aiPendingActions).set({ status: "denied" }).where(eq(aiPendingActions.id, actionId));
    await logCrudOperation(buildAuditCtx(user, req), {
      action: AUDIT_ACTIONS.AI_ACTION_DENIED,
      entityType: ENTITY_TYPES.AI_ACTION,
      entityName: row.tool,
      details: {
        operation: "AI_ACTION_DENIED",
        metadata: { actionId, tool: row.tool, requiredPermission: perm, denyReason: "MISSING_PERMISSION", stage: "execute" },
      },
      status: "failure",
    });
    return { ok: false, status: "denied", message: denyMessage(lang, row.summary) };
  }

  // Execute with args FROM THE DB ROW (never the client). Thread the confirmed
  // action id so write-tools (e.g. machine control) can pass it to the
  // commandDispatcher for defense-in-depth re-verification.
  const execCtx: ToolExecContext = { user, lang, req, actionId };
  const previewBefore = (row.previewJson as unknown as ActionPreview | null) ?? null;
  const result = await tool.execute!(row.argsJson as Record<string, unknown>, execCtx);

  await db
    .update(aiPendingActions)
    .set({ status: "executed", executedAt: new Date(), resultJson: result as unknown as Record<string, unknown> })
    .where(eq(aiPendingActions.id, actionId));

  // Audit: executed (lifecycle) + target-entity update (before/after) when the
  // preview captured a concrete entity + changes.
  await logCrudOperation(buildAuditCtx(user, req), {
    action: AUDIT_ACTIONS.AI_ACTION_EXECUTED,
    entityType: ENTITY_TYPES.AI_ACTION,
    entityName: row.tool,
    details: {
      operation: "AI_ACTION_EXECUTED",
      changes: previewBefore?.changes,
      metadata: { actionId, tool: row.tool, requiredPermission: perm, args: sanitizeArgs(row.argsJson as Record<string, unknown>) },
    },
    status: "success",
  });

  if (previewBefore && previewBefore.entityId != null && previewBefore.changes.length > 0) {
    const before: Record<string, any> = {};
    const after: Record<string, any> = {};
    for (const c of previewBefore.changes) {
      before[c.field] = c.oldValue;
      after[c.field] = c.newValue;
    }
    await logUpdate(
      buildAuditCtx(user, req),
      previewBefore.entityType,
      previewBefore.entityId,
      previewBefore.entityName ?? String(previewBefore.entityId),
      before,
      after,
      { source: "ai_copilot", actionId, tool: row.tool },
    );
  }

  return { ok: true, status: "executed", result, message: "Đã thực thi." };
}

/** Cancel a proposed action (owner only, only while proposed/confirmed). */
export async function cancelAction(
  actionId: string,
  user: CopilotUser,
  req?: ToolExecContext["req"],
): Promise<{ ok: boolean; status: string; message?: string }> {
  const db = await getDb();
  if (!db) return { ok: false, status: "invalid", message: "DB_UNAVAILABLE" };

  const [row] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, actionId)).limit(1);
  if (!row) return { ok: false, status: "not_found", message: "Action không tồn tại." };
  if (row.userId !== user.id) return { ok: false, status: "invalid", message: "Người dùng không khớp." };
  if (row.status === "executed") return { ok: false, status: "executed", message: "Đã thực thi, không thể hủy." };
  if (row.status !== "proposed" && row.status !== "confirmed") {
    return { ok: false, status: row.status, message: `Không thể hủy ở trạng thái ${row.status}.` };
  }

  await db.update(aiPendingActions).set({ status: "cancelled" }).where(eq(aiPendingActions.id, actionId));
  await logCrudOperation(buildAuditCtx(user, req), {
    action: AUDIT_ACTIONS.AI_ACTION_CANCELLED,
    entityType: ENTITY_TYPES.AI_ACTION,
    entityName: row.tool,
    details: { operation: "AI_ACTION_CANCELLED", metadata: { actionId, tool: row.tool } },
    status: "success",
  });
  return { ok: true, status: "cancelled", message: "Đã hủy." };
}

/** Fetch a single action (owner only) for the UI to re-render its state. */
export async function getAction(actionId: string, user: CopilotUser) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, actionId)).limit(1);
  if (!row || row.userId !== user.id) return null;
  return row;
}

/** Lazy housekeeping: mark stale `proposed` rows as expired. Best-effort. */
export async function expireStaleActions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const res = await db
    .update(aiPendingActions)
    .set({ status: "expired" })
    .where(and(eq(aiPendingActions.status, "proposed"), lt(aiPendingActions.expiresAt, new Date())));
  return (res as any)?.rowCount ?? 0;
}

async function auditConfirmFailure(
  user: CopilotUser,
  req: ToolExecContext["req"] | undefined,
  tool: string,
  actionId: string,
  reason: string,
): Promise<void> {
  await logCrudOperation(buildAuditCtx(user, req), {
    action: AUDIT_ACTIONS.AI_ACTION_DENIED,
    entityType: ENTITY_TYPES.AI_ACTION,
    entityName: tool,
    details: { operation: "AI_ACTION_DENIED", metadata: { actionId, tool, denyReason: reason, stage: "confirm" } },
    status: "failure",
  });
}

/** Redact obviously-sensitive arg keys before they hit the audit log. */
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const sensitive = ["password", "token", "secret", "apikey", "accesstoken", "refreshtoken"];
  for (const [k, v] of Object.entries(args)) {
    out[k] = sensitive.some((s) => k.toLowerCase().includes(s)) ? "***REDACTED***" : v;
  }
  return out;
}
