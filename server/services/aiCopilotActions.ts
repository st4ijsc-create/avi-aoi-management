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

// ════════════════════════════════════════════════════════════════════════════
// G4.29 (doc 44 W5-A3) — ADVICE / RECOMMENDATION CONTRACT (SYNAPSE Tầng-4 §12.1
// + §13.1 "Hợp đồng khuyến nghị luôn kèm điều kiện thực thi").
//
// A recommendation now carries its safety envelope as DATA, not convention:
// `guardrail{min,max}` (the safe band a value must stay inside) and `requires[]`
// (the conditions Tầng-3 MUST verify before turning advice into a command). Every
// field is OPTIONAL → a legacy PendingActionDTO (no contract) still parses byte
// for byte, and the confirm path only enforces them when ADVICE_CONTRACT_ENABLED.
// ════════════════════════════════════════════════════════════════════════════

/** Execution pre-conditions a recommendation may demand (spec §12.1 requires[]). */
export type AdviceRequirement = "twin_validation" | "policy_permit" | "human_approval";

/** Hard safety band for a proposed value (spec §12.1 guardrail{min,max,unit}). */
export interface AdviceGuardrail {
  min: number;
  max: number;
  unit?: string;
  /**
   * ADDITIVE superset of spec §12.1: the arg KEY this band bounds. When present the
   * confirm-time enforcement double-checks args[key] ∈ [min,max] (defense-in-depth,
   * layer 2). When absent the guardrail is descriptive only — the tool's own zod
   * bounds + the AI-side clamp stay the primary guard.
   */
  key?: string;
}

/** The advice contract attached to a proposal (all fields optional). */
export interface AdviceContract {
  guardrail?: AdviceGuardrail;
  requires?: AdviceRequirement[];
  confidence?: number;
  expected?: Record<string, number>;
  explain?: string[];
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
  // ── G4.29 advice contract (all OPTIONAL — backward-compatible; spec §12.1) ──
  guardrail?: AdviceGuardrail;
  requires?: AdviceRequirement[];
  confidence?: number;
  expected?: Record<string, number>;
  explain?: string[];
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
  /**
   * G4.29 — advice-contract reject code when the confirm was blocked by the
   * contract (POLICY_DENIED | TWIN_UNTRUSTED | GUARDRAIL_VIOLATION | …). Absent on
   * legacy rejects (ownership/expiry/RBAC) so the ConfirmResult stays bit-compat.
   */
  reason?: string;
}

// ── G4.29 — confirm-time contract-enforcement flags / reason codes / seams ──────

/** Master gate for confirm-time advice-contract enforcement. Default OFF (legacy). */
export function isAdviceContractEnabled(): boolean {
  return process.env.ADVICE_CONTRACT_ENABLED === "true";
}

/**
 * When a `twin_validation` requirement CANNOT resolve a twin ref: strict blocks
 * (fail-closed), default passes (spec §5.2 "không suy được ⇒ không áp dụng").
 */
function adviceRequiresStrict(): boolean {
  return process.env.ADVICE_REQUIRES_STRICT === "true";
}

/** Reject codes surfaced on ConfirmResult.reason + audited on a contract block. */
export const ADVICE_REJECT_REASONS = {
  POLICY_DENIED: "POLICY_DENIED",
  TWIN_UNTRUSTED: "TWIN_UNTRUSTED",
  GUARDRAIL_VIOLATION: "GUARDRAIL_VIOLATION",
  TWIN_NOT_RESOLVABLE: "TWIN_NOT_RESOLVABLE",
} as const;

/**
 * Injectable seams for confirm-time enforcement. Defaults call the REAL W3-A1
 * Policy engine + W5-A1 twin-fidelity service directly; tests override them.
 */
export interface ConfirmContractDeps {
  evaluatePolicy?: (
    subject: string,
    action: string,
    resource: string | null | undefined,
    context: Record<string, unknown>,
  ) => { decision: "PERMIT" | "DENY"; reason_code?: string; policy_ref?: string | null };
  isTwinTrusted?: (twinRef: string) => Promise<boolean>;
  /** machine/line args → `line:<id>` twin ref (spec §5.2 machine→line), or null. */
  resolveTwinRef?: (args: Record<string, unknown>) => Promise<string | null>;
}

interface ContractEnforcement {
  ok: boolean;
  reason?: string;
  message?: string;
  /** true ⇒ mark the action `denied` (token burned); false ⇒ leave re-confirmable. */
  burnToken?: boolean;
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
  contract?: AdviceContract,
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

  // G4.29 — persist the advice contract INSIDE previewJson (additive; needs no
  // migration). The contract is server-owned so confirm-time enforcement reads it
  // from the row, never from the client. No contract ⇒ previewJson is unchanged
  // (byte-for-byte the legacy blob).
  const previewForStore: Record<string, unknown> = contract
    ? { ...(preview as unknown as Record<string, unknown>), contract }
    : (preview as unknown as Record<string, unknown>);

  await db.insert(aiPendingActions).values({
    id: actionId,
    tool: tool.name,
    argsJson: args,
    userId: ctx.user.id,
    userRole: ctx.user.role,
    requiredPermissionJson: perm,
    summary,
    previewJson: previewForStore,
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
      // G4.29 — surface the contract on the DTO (only keys that are set) so the
      // confirm card can render the guardrail / required conditions / explanation.
      ...(contract?.guardrail ? { guardrail: contract.guardrail } : {}),
      ...(contract?.requires ? { requires: contract.requires } : {}),
      ...(contract?.confidence != null ? { confidence: contract.confidence } : {}),
      ...(contract?.expected ? { expected: contract.expected } : {}),
      ...(contract?.explain ? { explain: contract.explain } : {}),
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
  deps: ConfirmContractDeps = {},
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

  // ── G4.29/G4.30 — CONFIRM-TIME ADVICE-CONTRACT ENFORCEMENT ────────────────────
  // Flag ADVICE_CONTRACT_ENABLED. OFF ⇒ legacy flow, byte-for-byte (this block is a
  // pure no-op). ON ⇒ the contract stored on the row (previewJson.contract) is the
  // authority: requires[]/guardrail are verified BEFORE execute — policy_permit via
  // the W3-A1 Policy engine, twin_validation via the W5-A1 twin-fidelity service,
  // guardrail via a 2nd-layer bounds check. Spec §13.1: "Tầng 3 BẮT BUỘC kiểm các
  // điều kiện này trước khi biến khuyến nghị thành lệnh."
  if (isAdviceContractEnabled()) {
    const contract = readContract(row.previewJson as Record<string, unknown> | null);
    if (contract) {
      const enforcement = await enforceAdviceContract(
        contract,
        { user, tool: row.tool, actionId, args: row.argsJson as Record<string, unknown>, lang },
        deps,
      );
      if (!enforcement.ok) {
        // TOKEN SEMANTICS (see enforceAdviceContract): POLICY_DENIED / TWIN_UNTRUSTED
        // do NOT burn the token — those conditions are transient (policy may flip to
        // PERMIT, a twin may recalibrate), so the row stays `confirmed` and the user
        // can retry the SAME action while the TTL holds. GUARDRAIL_VIOLATION burns it
        // (status→denied): args are immutable, so the proposal is permanently unsafe.
        if (enforcement.burnToken) {
          await db.update(aiPendingActions).set({ status: "denied" }).where(eq(aiPendingActions.id, actionId));
        }
        await logCrudOperation(buildAuditCtx(user, req), {
          action: AUDIT_ACTIONS.AI_ACTION_DENIED,
          entityType: ENTITY_TYPES.AI_ACTION,
          entityName: row.tool,
          details: {
            operation: "AI_ACTION_DENIED",
            metadata: {
              actionId,
              tool: row.tool,
              denyReason: enforcement.reason,
              stage: "contract",
              tokenBurned: enforcement.burnToken ?? false,
            },
          },
          status: "failure",
        });
        return { ok: false, status: "denied", reason: enforcement.reason, message: enforcement.message };
      }
    }
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

// ════════════════════════════════════════════════════════════════════════════
// G4.29 — advice-contract enforcement helpers (confirm path)
// ════════════════════════════════════════════════════════════════════════════

/** Read the contract stored inside previewJson (null when absent/legacy row). */
function readContract(previewJson: Record<string, unknown> | null | undefined): AdviceContract | null {
  if (!previewJson || typeof previewJson !== "object") return null;
  const c = (previewJson as Record<string, unknown>).contract;
  return c && typeof c === "object" ? (c as AdviceContract) : null;
}

/**
 * Resolve a `line:<id>` twin ref from an action's args (spec §5.2 machine→line):
 * an explicit lineId wins; else machineId is joined machines→stations→lines.
 * Fail-safe → null (⇒ twin validation is "not applicable" unless STRICT).
 */
async function defaultResolveTwinRef(args: Record<string, unknown>): Promise<string | null> {
  try {
    const lineId = typeof args.lineId === "number" ? args.lineId : Number(args.lineId);
    if (Number.isFinite(lineId) && lineId > 0) return `line:${lineId}`;

    const machineId = typeof args.machineId === "number" ? args.machineId : Number(args.machineId);
    if (!Number.isFinite(machineId) || machineId <= 0) return null;

    const db = await getDb();
    if (!db) return null;
    const { machines, stations, productionLines } = await import("../../drizzle/schema");
    const [rowLine] = await db
      .select({ lineId: productionLines.id })
      .from(machines)
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .where(eq(machines.id, machineId))
      .limit(1);
    return rowLine?.lineId ? `line:${rowLine.lineId}` : null;
  } catch {
    return null;
  }
}

/**
 * Enforce a proposal's contract before execute. Order: (1) guardrail double-check
 * (independent of requires[]), (2) policy_permit, (3) twin_validation, (4)
 * human_approval (satisfied by the confirm itself). Returns ok:true when nothing
 * blocks. NEVER throws — evaluatePolicy/isTwinTrusted are themselves fail-safe.
 */
async function enforceAdviceContract(
  contract: AdviceContract,
  ctx: { user: CopilotUser; tool: string; actionId: string; args: Record<string, unknown>; lang: ToolLang },
  deps: ConfirmContractDeps,
): Promise<ContractEnforcement> {
  const requires = Array.isArray(contract.requires) ? contract.requires : [];

  // (1) GUARDRAIL — 2nd-layer bounds check on the keyed value (defense in depth;
  // the AI-side clamp + the tool's own zod bounds are the primary guard).
  const g = contract.guardrail;
  if (g && typeof g.key === "string" && g.key) {
    const raw = ctx.args[g.key];
    const v = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(v) && (v < g.min || v > g.max)) {
      return {
        ok: false,
        reason: ADVICE_REJECT_REASONS.GUARDRAIL_VIOLATION,
        burnToken: true,
        message: contractRejectMessage(
          ctx.lang,
          ADVICE_REJECT_REASONS.GUARDRAIL_VIOLATION,
          `${g.key}=${v} ∉ [${g.min}, ${g.max}]${g.unit ? " " + g.unit : ""}`,
        ),
      };
    }
  }

  // (2) POLICY_PERMIT — the confirm path is now Policy-gated (W3-A1 seam).
  if (requires.includes("policy_permit")) {
    const evalFn = deps.evaluatePolicy ?? (await import("./security/policyEvaluate")).evaluatePolicy;
    const decision = evalFn(String(ctx.user.id), "ai.recommendation.execute", ctx.tool, {
      tool: ctx.tool,
      actionId: ctx.actionId,
      argsKeys: Object.keys(ctx.args),
      role: ctx.user.role,
      userId: ctx.user.id,
    });
    if (decision.decision === "DENY") {
      return {
        ok: false,
        reason: ADVICE_REJECT_REASONS.POLICY_DENIED,
        burnToken: false, // transient → retryable after policy/context changes
        message: contractRejectMessage(ctx.lang, ADVICE_REJECT_REASONS.POLICY_DENIED, decision.reason_code ?? null),
      };
    }
  }

  // (3) TWIN_VALIDATION — the twin must be trusted for automated actuation (W5-A1 seam).
  if (requires.includes("twin_validation")) {
    const resolveRef = deps.resolveTwinRef ?? defaultResolveTwinRef;
    const twinRef = await resolveRef(ctx.args);
    if (twinRef) {
      const trustedFn = deps.isTwinTrusted ?? (await import("./twin/twinFidelityService")).isTwinTrusted;
      const trusted = await trustedFn(twinRef);
      if (!trusted) {
        return {
          ok: false,
          reason: ADVICE_REJECT_REASONS.TWIN_UNTRUSTED,
          burnToken: false, // twin may recalibrate → retryable
          message: contractRejectMessage(ctx.lang, ADVICE_REJECT_REASONS.TWIN_UNTRUSTED, twinRef),
        };
      }
    } else if (adviceRequiresStrict()) {
      // No twin resolvable + STRICT ⇒ cannot prove trust → block (fail-closed).
      return {
        ok: false,
        reason: ADVICE_REJECT_REASONS.TWIN_NOT_RESOLVABLE,
        burnToken: false,
        message: contractRejectMessage(ctx.lang, ADVICE_REJECT_REASONS.TWIN_NOT_RESOLVABLE, null),
      };
    }
    // twinRef null + non-strict ⇒ validation not applicable (spec §5.2).
  }

  // (4) HUMAN_APPROVAL — satisfied by THIS confirm (a human explicitly clicked
  // confirm). No separate four-eyes channel is wired into the copilot confirm path
  // today, so the requirement maps to the confirm action itself.
  return { ok: true };
}

/** Localized message for a contract reject (vi default, en/zh variants). */
function contractRejectMessage(lang: ToolLang, reason: string, detail: string | null): string {
  const s = detail ? ` (${detail})` : "";
  switch (reason) {
    case ADVICE_REJECT_REASONS.POLICY_DENIED:
      return lang === "en"
        ? `Blocked by policy${s}.`
        : lang === "zh"
          ? `策略拒绝${s}。`
          : `Chính sách từ chối thao tác này${s}.`;
    case ADVICE_REJECT_REASONS.TWIN_UNTRUSTED:
      return lang === "en"
        ? `Digital twin is untrusted — automated action blocked${s}.`
        : lang === "zh"
          ? `数字孪生不可信，已阻止自动操作${s}。`
          : `Song sinh số không đáng tin — đã chặn hành động tự động${s}.`;
    case ADVICE_REJECT_REASONS.GUARDRAIL_VIOLATION:
      return lang === "en"
        ? `Value is outside the safety guardrail${s}.`
        : lang === "zh"
          ? `数值超出安全护栏${s}。`
          : `Giá trị vượt ngoài dải an toàn (guardrail)${s}.`;
    case ADVICE_REJECT_REASONS.TWIN_NOT_RESOLVABLE:
      return lang === "en"
        ? `Twin validation required but no twin could be resolved${s}.`
        : lang === "zh"
          ? `需要孪生校验但无法解析孪生${s}。`
          : `Yêu cầu kiểm chứng twin nhưng không xác định được twin${s}.`;
    default:
      return lang === "en" ? `Blocked by advice contract${s}.` : `Bị chặn bởi hợp đồng khuyến nghị${s}.`;
  }
}
