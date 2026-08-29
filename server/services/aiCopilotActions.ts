/**
 * AI Copilot Actions — GĐ2 HITL write-action lifecycle service.
 *
 * Two-phase, human-in-the-loop flow for AI-proposed write actions:
 *
 *   propose  → record a `proposed` row (dry-run preview, NO DB mutation),
 *              RBAC gated, returns a pendingAction the UI renders as a confirm
 *              card. Token = row id (uuid) bound to userId, TTL 5'.
 *   confirm  → verify status/expiry/userId/token → RBAC re-check → idempotency
 *              (already executed/bi_tu_choi_ghi ⇒ return cached result) → execute()
 *              with args read from the DB row (never the client) → mark status
 *              THEO KẾT QUẢ THẬT (`trangThaiSauThucThi`, Đợt B · Task 6: byte thật
 *              vào đĩa ⇒ executed; execute() TỪ CHỐI GHI ⇒ bi_tu_choi_ghi) + audit.
 *   cancel   → mark cancelled (only the owner, only while proposed).
 *
 * Safety invariants (Mục 8):
 *   - confirm is mandatory; propose never auto-executes.
 *   - execute() args come from ai_pending_actions.argsJson, not the request.
 *     ★ ĐỢT 3 (2026-08-23): với `apply_diff`, request ĐƯỢC PHÉP mang thêm `selectedHunkIds`
 *     (CHỈ SỐ khối, không bao giờ là byte nội dung); server tự dựng lại kế hoạch khối từ argsJson
 *     trong CSDL, xác thực, rồi CẬP NHẬT `argsJson.modified` = bản chiếu trong CÙNG câu UPDATE
 *     giành quyền — bất biến trên vẫn đúng theo chữ: cái execute() nhận là cái vừa persist.
 *   - idempotencyKey unique → at most one execution.
 *   - RBAC checked TWICE (propose + execute), role taken from session.
 *   - audit logged at every milestone via audit_logs (append-only).
 */

import { randomUUID } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiPendingActions } from "../../drizzle/schema";
import { checkPermission } from "../_core/accessControl";
import { getTool, isWriteTool, assertExecutable, type ActionPreview, type Tool, type ToolExecContext, type ToolLang } from "./aiLocalTools/toolRegistry";
// ★★★ ĐỢT 3 (2026-08-23) — DUYỆT THEO KHỐI THẬT: server import THẲNG bộ vị từ khối của client
// (`keHoachKhoiDuyet` + `chieuTheoChiSoKhoi`) — tiền lệ đã có (`aiCodingCli/cli.ts` import
// `computeHunkPlan` từ đúng file này). KHÔNG chép hàm sang server: hai bản sao của một thuật toán
// chiếu là đúng lớp lỗi "hai bản sao một vị từ" repo này đếm nhiều lần — bản lỏng hơn bao giờ
// cũng là bản đang chạy.
import { chieuTheoChiSoKhoi, keHoachKhoiDuyet } from "../../client/src/lib/diffHunks";
// `bam` (sha256) + `trich` (trích-đã-che) của chính apply_diff — để lời khai audit sau một lượt
// chọn tập-con mang đúng băm/trích của BYTE THẬT, bằng đúng thước mà tool dùng.
import { bam as bamNoiDung, trich } from "./aiLocalTools/writeHandlers/applyDiff";
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
  createAuditContext,
  logCrudOperation,
  logUpdate,
  type AuditContext,
} from "./auditTrailService";
// doc 69 Giai đoạn 4/Wave 3 D2 — bounded-autonomy policy (master flag OFF default;
// see server/services/ai/autonomyPolicy.ts for the full predicate + kill-switch).
import {
  evaluateAutonomy,
  isAutonomyEnabled,
  recordAutonomousExecution,
  AUTONOMY_REASONS,
  type AutonomyDecision,
} from "./ai/autonomyPolicy";
// E2-4 (doc69 Giai đoạn 4/Wave E2) — realtime refresh nudge for the Agent Command
// Center. ADDITIVE: fire-and-forget/non-throwing, minimal non-sensitive payload
// only (no args/preview/result on the wire) — see aiAgentRealtime.ts.
import { publishAiAgentEvent } from "./aiAgentRealtime";
// ★★★ Đợt B · Task 6 (2026-08-29, spec §6.6) — vị từ CHUNG, THUẦN, MỘT bản duy nhất (0 import),
// đã có 3 nơi gọi (CLI · web · vòng tự-trị-ghi). Dùng lại NGUYÊN VĂN — KHÔNG viết bản thứ hai.
// Xem docblock đầy đủ ở shared/aiCodingLoop.ts:325-360 cho lý lẽ vì sao vị từ này đứng một mình.
import { daBiTuChoiGhi, maTuChoiGhi } from "@shared/aiCodingLoop";

/** E2-4 — defensive call site: a realtime-nudge failure must never break the
 *  choke point that triggered it. Belt-and-suspenders (publishAiAgentEvent
 *  itself already never throws — see aiAgentRealtime.ts). */
function nudge(event: Parameters<typeof publishAiAgentEvent>[0]): void {
  try {
    publishAiAgentEvent(event);
  } catch (err) {
    console.error("[aiCopilotActions] realtime nudge failed:", (err as Error)?.message ?? err);
  }
}

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
  /**
   * D2 — present ONLY when the bounded-autonomy tier attempted (and here, succeeded
   * at) auto-confirming this proposal without a human. Absent for every legacy
   * caller/response (master flag OFF ⇒ this field never appears). `true` ⇔
   * `executionResult.status === "executed"`.
   */
  autoConfirmed?: boolean;
  /** D2 — the confirmAction() result from the autonomous confirm attempt, when one ran. */
  executionResult?: ConfirmResult;
}

export interface ConfirmResult {
  ok: boolean;
  /**
   * ★★★ Đợt B · Task 6 — `"bi_tu_choi_ghi"` MỚI (drizzle/0341, giá trị enum
   * `aipendingactionstatus`): `execute()` ĐÃ CHẠY nhưng TỪ CHỐI GHI (BASE_MISMATCH/FILE_DIRTY/…,
   * `daBiTuChoiGhi(result) === true`) — 0 byte vào đĩa. KHÁC `"denied"` (bị chặn TRƯỚC execute(),
   * bởi RBAC/hợp đồng khuyến nghị) — hai lớp lỗi khác nhau, không được trộn.
   * ⚠ `ok:true` với status này vẫn có thể xảy ra (xem nhánh cache-return): `ok` nói *"vòng đời HITL
   *   chạy hết chặng"*, KHÔNG nói *"byte đã vào đĩa"* — luôn đọc `result`/`daBiTuChoiGhi(result)`
   *   để biết sự thật, đúng hợp đồng mà CLI/web/extension đã dựa vào từ trước bản vá này.
   */
  status: "executed" | "bi_tu_choi_ghi" | "denied" | "expired" | "not_found" | "invalid";
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
  //
  // ★★★ doc 79 · TRỤC 2 — cùng khuôn "server-owned trong previewJson": lưu GỐC DỰ ÁN
  // (`ctx.projectRoot`) đã phân giải từ id (danh sách trắng) để `confirmAction` chạy `execute()`
  // trên ĐÚNG gốc mà `propose`/`preview` đã kiểm — request confirm (một lượt HTTP khác) KHÔNG mang
  // projectId. Chỉ ghi khi có gốc; write tool không-repo (set_spec…) không set ⇒ previewJson KHÔNG
  // đổi một byte. Đây là ĐƯỜNG DẪN server (đã hiện trong warnings của run_command), không phải bí mật.
  let previewForStore: Record<string, unknown> = preview as unknown as Record<string, unknown>;
  if (contract) previewForStore = { ...previewForStore, contract };
  if (typeof ctx.projectRoot === "string" && ctx.projectRoot !== "") {
    previewForStore = { ...previewForStore, __projectRoot: ctx.projectRoot };
  }

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

  // E2-4 — nudge AFTER the row is persisted. Fire-and-forget, minimal payload
  // (event + timestamp only — no tool/args/preview on the wire). No sessionId:
  // proposeAction is used both standalone and by the agent orchestrator's write
  // steps, which have already/will separately nudge their OWN session lifecycle.
  nudge("action_proposed");

  // ── FIX 3 (D2 review) — Audit: the PROPOSED row is written FIRST, before the D2
  // bounded-autonomy attempt below, so the audit trail's causal order is always
  // PROPOSED → CONFIRMED → EXECUTED even for an auto-confirmed action — confirmAction(),
  // called below when autonomy allows it, writes its own CONFIRMED/EXECUTED/DENIED rows,
  // which must never precede this one. The autonomy DECISION itself (allowed/reason/
  // executed) is audited SEPARATELY as a lightweight follow-up entry AFTER the decision
  // is made (see below) — it must never block on, or be entangled with, this row.
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

  // ── D2 (doc69 Giai đoạn 4/Wave 3) — bounded-autonomy: may this proposal skip ONLY
  // the human wait? Master flag OFF (default) ⇒ evaluateAutonomy short-circuits
  // immediately (no DB/contract work at all) and everything below is BYTE-IDENTICAL
  // to the pre-D2 flow. When allowed, the confirmation is driven through the SAME
  // confirmAction() used by a human click — RBAC re-check, guardrail enforcement,
  // idempotency and args-from-DB all still run; autonomy supplies only the token
  // (== the row id it just created) instead of a human doing so.
  //
  // FIX 2 (D2 review) — belt-and-suspenders: evaluateAutonomy() itself fails closed and
  // never throws (see autonomyPolicy.ts), but this WHOLE attempt is additionally wrapped
  // here so that if confirmAction() (or anything else in this block) throws unexpectedly,
  // the exception can never escape proposeAction() — a successful propose must never turn
  // into a 500 just because the autonomy attempt blew up. The `proposed` row above already
  // exists either way; on any error here the action is simply left `proposed`, exactly as
  // if autonomy had declined normally.
  let autonomyDecision: AutonomyDecision = { allowed: false, reason: AUTONOMY_REASONS.AUTONOMY_CHECK_ERROR };
  let autoConfirmResult: ConfirmResult | undefined;
  try {
    autonomyDecision = await evaluateAutonomy(
      { type: tool.name, idempotencyKey, contract: contract ?? null, args },
      { user: ctx.user, tool: tool.name, actionId, lang: ctx.lang, req: ctx.req },
    );
    if (autonomyDecision.allowed) {
      autoConfirmResult = await confirmAction(actionId, actionId, ctx.user, ctx.lang, ctx.req, {}, {
        reason: autonomyDecision.reason,
      });
      if (autoConfirmResult.status === "executed") {
        recordAutonomousExecution(ctx.user.id);
      }
    }
  } catch {
    autonomyDecision = { allowed: false, reason: AUTONOMY_REASONS.AUTONOMY_CHECK_ERROR };
    autoConfirmResult = undefined;
  }

  // Audit: the autonomy DECISION as a separate, lightweight follow-up entry — only
  // recorded when the master flag is ON, so an auditor can see WHY an eligible-looking
  // action did/did not auto-run, without adding noise to the overwhelming majority of
  // deployments where autonomy is globally off. Deliberately AFTER the PROPOSED row (and
  // after any CONFIRMED/EXECUTED/DENIED rows confirmAction() wrote above) — never
  // renumbers or blocks the PROPOSED row's causal position — and best-effort (a logging
  // failure here must not turn a successful propose into an error).
  if (isAutonomyEnabled()) {
    try {
      await logCrudOperation(buildAuditCtx(ctx.user, ctx.req), {
        action: AUDIT_ACTIONS.AI_AUTONOMY_DECISION,
        entityType: ENTITY_TYPES.AI_ACTION,
        entityName: tool.name,
        details: {
          operation: "AI_AUTONOMY_DECISION",
          metadata: {
            actionId,
            tool: tool.name,
            autonomy: {
              allowed: autonomyDecision.allowed,
              reason: autonomyDecision.reason,
              executed: autoConfirmResult?.status === "executed",
            },
          },
        },
        status: "success",
      });
    } catch {
      /* best-effort — never let a follow-up audit failure break propose's success return */
    }
  }

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
    // D2 — surfaced ONLY when an autonomous confirm attempt actually ran.
    ...(autoConfirmResult
      ? { autoConfirmed: autoConfirmResult.status === "executed", executionResult: autoConfirmResult }
      : {}),
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HỘP THƯ ĐỀ XUẤT — đọc những gì ĐANG CHỜ chính một người duyệt
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ doc 83 · 2026-08-23 — **LỖ DÙNG-ĐƯỢC LỚN NHẤT CỦA LƯỢT TRƯỚC: MCP TẠO ĐƯỢC ĐỀ XUẤT MÀ KHÔNG
 * CÓ CHỖ NÀO DUYỆT.** Hàng `ai_pending_actions` có thật, `confirmAction` duyệt được, nhưng không
 * mặt tiếp xúc nào ĐỌC được chúng ⇒ một đề xuất do MCP tạo chỉ có một kết cục: **tự hết hạn**.
 *
 * ⚠⚠ **VÌ SAO HAI HÀM NÀY NẰM Ở ĐÂY chứ không ở `aiCodingCli/cauNoiCli.ts`** (nơi đã gọi chúng):
 *   bảng `ai_pending_actions` có **một chủ**, và chủ của nó là file này (`propose` ghi vào,
 *   `confirm` đọc ra). Bản đầu của tôi đặt hai hàm ấy trong `cauNoiCli.ts` và **census bắt được**:
 *   file ấy có bất biến *"nó không biết làm gì cả — không hàng rào, không truy cập dữ liệu"*, và
 *   một câu SQL trong đó là bước đầu tiên của lớp lỗi *"hai nơi cùng biết về một bảng"*.
 *   ⇒ Census không chỉ đếm sai một con số; nó chỉ đúng chỗ đoạn mã nên nằm.
 *
 * ⚠⚠⚠ BA RÀNG BUỘC NẰM TRONG **MỆNH ĐỀ `where`**, KHÔNG PHẢI TRONG MỘT LƯỢT LỌC SAU KHI LẤY VỀ:
 *  1. **CHỦ SỞ HỮU** — `summary`+`preview` của một đề xuất chứa **đường dẫn tệp và nguyên văn
 *     diff**; liệt kê của người khác là rò nội dung mã nguồn, không phải "chỉ là một danh sách".
 *  2. **CÒN HẠN** — TTL là hàng rào, và nó phải nhìn thấy được; một hàng hết hạn hiện ra chỉ để
 *     người ta gõ id rồi nhận một lời từ chối khó hiểu.
 *  3. **ĐANG CHỜ** — hàng `executed` giữ `resultJson` cho idempotency; hiện nó là mời duyệt lại
 *     một thứ đã xong.
 *
 * ⚠ Cả hai hàm **CHỈ `select`**. Đường ghi duy nhất vẫn là `confirmAction`.
 */
export interface PendingActionSummary {
  actionId: string;
  tool: string;
  summary: string;
  createdAt: Date;
  expiresAt: Date;
  /** Gốc dự án đã neo lúc `propose` (doc 79 trục 2). `null` với write tool không-repo. */
  projectRoot: string | null;
}

export async function listPendingActionsForUser(userId: number): Promise<PendingActionSummary[]> {
  const db = await getDb();
  /**
   * ⚠⚠ CSDL VẮNG ⇒ **NÉM**, không trả `[]`. Bản đầu của tôi trả mảng rỗng — và CLI in nó ra thành
   *   *"(không có đề xuất nào đang chờ bạn duyệt)"*, tức **một câu SAI về trạng thái thế giới** cho
   *   một người đang có đề xuất chờ thật. Đúng lớp *"cổng chạy đúng mà báo cáo sai"* đã phải vá hai
   *   lần trong chính doc này (`ConfirmResult.ok` và nhãn `CMD_TIMEOUT`). Hai thứ khác nhau về hậu
   *   quả thì không được mang cùng một hình dạng trả về.
   */
  if (!db) throw new Error("DB_UNAVAILABLE — không đọc được hộp thư đề xuất (đây KHÔNG phải 'hộp thư rỗng').");
  const rows = await db
    .select({
      id: aiPendingActions.id,
      tool: aiPendingActions.tool,
      summary: aiPendingActions.summary,
      createdAt: aiPendingActions.createdAt,
      expiresAt: aiPendingActions.expiresAt,
      previewJson: aiPendingActions.previewJson,
    })
    .from(aiPendingActions)
    .where(
      and(
        eq(aiPendingActions.userId, userId),
        eq(aiPendingActions.status, "proposed"),
        gt(aiPendingActions.expiresAt, new Date()),
      ),
    );
  return rows
    .map((r) => ({
      actionId: r.id,
      tool: r.tool,
      summary: r.summary,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      projectRoot: readProjectRoot(r.previewJson),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Dựng lại một `PendingActionDTO` đủ để **VẼ LẠI ĐÚNG THẺ DUYỆT** (diff, cảnh báo, băm neo) rồi
 * hỏi người. `null` khi không hàng nào khớp CẢ BA ràng buộc trên.
 *
 * ⚠ `token: id` đúng quy ước hiện hành (`token === actionId`, ràng vào `userId`) — không có bí mật
 *   thứ hai để rò ở đây.
 */
export async function getPendingActionForUser(
  userId: number,
  actionId: unknown,
): Promise<PendingActionDTO | null> {
  if (typeof actionId !== "string" || actionId === "" || actionId.length > 64) return null;
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE — không đọc được đề xuất.");
  const [r] = await db
    .select()
    .from(aiPendingActions)
    .where(
      and(
        eq(aiPendingActions.id, actionId),
        eq(aiPendingActions.userId, userId),
        eq(aiPendingActions.status, "proposed"),
        gt(aiPendingActions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!r) return null;
  return {
    actionId: r.id,
    token: r.id,
    tool: r.tool,
    args: r.argsJson,
    summary: r.summary,
    preview: (r.previewJson ?? { entityType: "", entityName: "", changes: [], warnings: [] }) as unknown as ActionPreview,
    requiredPermission: r.requiredPermissionJson ?? null,
    expiresAt: r.expiresAt.toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ĐỢT 3 (2026-08-23) — DUYỆT THEO KHỐI **THẬT** cho `apply_diff`
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Mã từ chối lựa-chọn-khối — nổi lên `ConfirmResult.reason`, có mặt trong audit deny. */
export const HUNK_REJECT_REASONS = {
  /** id lạ / trùng / ngoài khoảng / gửi cho tool không hỗ trợ — client hỏng hoặc độc hại. */
  HUNK_IDS_INVALID: "HUNK_IDS_INVALID",
  /** 0 khối được chọn — "ghi y nguyên tệp" vẫn đổi mtime, đánh thức watcher, đẻ audit "đã ghi". */
  NO_HUNKS_SELECTED: "NO_HUNKS_SELECTED",
} as const;
export type HunkRejectReason = (typeof HUNK_REJECT_REASONS)[keyof typeof HUNK_REJECT_REASONS];

interface LuaChonKhoiXanh {
  ok: true;
  /** argsJson MỚI: `modified` = bản chiếu + dấu server-owned `__hunksApplied` cho audit/kết quả. */
  args: Record<string, unknown>;
  /** Chỉ số các khối ĐƯỢC ghi (0-based, đã sắp tăng dần). */
  chiSo: number[];
  tong: number;
  /** Byte THẬT sẽ vào đĩa (bản chiếu) + băm của chính nó — để vá lời khai preview/audit. */
  vanBan: string;
  bamSau: string;
}
type KetQuaLuaChonKhoi = LuaChonKhoiXanh | { ok: false; reason: HunkRejectReason; chiTiet: string };

/**
 * ★★★ XÁC THỰC + CHIẾU lựa chọn khối của MỘT lượt confirm — mọi dữ liệu lấy từ HÀNG CSDL, request
 * chỉ đóng góp **các con số**. Đây là chỗ giữ nguyên tắc gốc của HITL (*"execute() args come from
 * ai_pending_actions.argsJson, not the request"*) theo CHỮ lẫn NGHĨA:
 *   • kế hoạch khối được dựng lại bằng `keHoachKhoiDuyet(argsJson.original, argsJson.modified)` —
 *     đúng hàm client dùng để vẽ thẻ duyệt, nên chỉ số hai đầu dây trỏ cùng một khối;
 *   • tập chỉ số bị `chieuTheoChiSoKhoi` xác thực (lạ/trùng/ngoài khoảng/rỗng ⇒ TỪ CHỐI CÓ MÃ,
 *     không âm thầm lọc — một client gửi id lạ phải bị nói thẳng, không được "sửa hộ");
 *   • chỉ tool `apply_diff` (một tệp) hỗ trợ — `apply_diff_batch` giữ áp-tất-cả (chọn-khối-theo-
 *     từng-tệp cần mỗi tệp một plan + UI phân trang, để dành; gửi lựa chọn cho nó ⇒ TỪ CHỐI).
 * ⚠ THUẦN, không I/O — chạy TRƯỚC phép giành quyền để bản chiếu vào được CÙNG câu UPDATE.
 */
function apLuaChonKhoi(
  toolName: string,
  argsJson: Record<string, unknown>,
  selectedHunkIds: readonly unknown[],
): KetQuaLuaChonKhoi {
  if (toolName !== "apply_diff") {
    return {
      ok: false,
      reason: HUNK_REJECT_REASONS.HUNK_IDS_INVALID,
      chiTiet: `tool "${toolName}" không hỗ trợ chọn khối (chỉ apply_diff một-tệp)`,
    };
  }
  const original = argsJson.original;
  const modified = argsJson.modified;
  if (typeof original !== "string" || typeof modified !== "string") {
    return { ok: false, reason: HUNK_REJECT_REASONS.HUNK_IDS_INVALID, chiTiet: "argsJson thiếu original/modified" };
  }
  const keHoach = keHoachKhoiDuyet(original, modified);
  const chieu = chieuTheoChiSoKhoi(keHoach, selectedHunkIds);
  if (!chieu.ok) return { ok: false, reason: HUNK_REJECT_REASONS[chieu.ma], chiTiet: chieu.chiTiet };
  return {
    ok: true,
    args: { ...argsJson, modified: chieu.text, __hunksApplied: { selected: chieu.chiSo, total: chieu.tong } },
    chiSo: chieu.chiSo,
    tong: chieu.tong,
    vanBan: chieu.text,
    bamSau: bamNoiDung(chieu.text),
  };
}

/** Câu từ chối lựa-chọn-khối theo ngôn ngữ phiên (cùng khuôn `contractRejectMessage`). */
function hunkRejectMessage(lang: ToolLang, reason: HunkRejectReason, chiTiet: string): string {
  if (reason === HUNK_REJECT_REASONS.NO_HUNKS_SELECTED) {
    return lang === "en"
      ? "No hunks selected — select at least one hunk, or cancel the proposal. Nothing was written."
      : lang === "zh"
        ? "未选择任何块——请至少选择一个块，或取消该提议。未写入任何内容。"
        : "Chưa chọn khối nào — hãy chọn ít nhất một khối, hoặc Hủy đề xuất. KHÔNG có byte nào được ghi.";
  }
  return lang === "en"
    ? `Invalid hunk selection (${chiTiet}) — nothing was written. Re-open the review card and try again.`
    : lang === "zh"
      ? `块选择无效（${chiTiet}）——未写入任何内容。请重新打开审核卡后重试。`
      : `Lựa chọn khối không hợp lệ (${chiTiet}) — KHÔNG có byte nào được ghi. Mở lại thẻ duyệt rồi thử lại.`;
}

/**
 * ★★★ Đợt B · Task 6 (2026-08-29, spec §6.6) — QUYẾT ĐỊNH TRẠNG THÁI THẬT sau `tool.execute()`.
 *
 * Trước bản vá này, `confirmAction` đặt `status='executed'` VÔ ĐIỀU KIỆN ngay sau `execute()` trả
 * về — kể cả khi `apply_diff` (hay bất kỳ write tool nào khác mang `note` trên `ToolResult`) TỪ
 * CHỐI GHI đúng như thiết kế (BASE_MISMATCH/FILE_DIRTY/…). 0 byte vào đĩa nhưng cột `status` trong
 * CSDL vẫn khai "đã thực thi" — đúng lớp lỗi mà `shared/aiCodingLoop.daBiTuChoiGhi()` được rút ra
 * để CLI/web tự đoán lại, vì không tin được cột này.
 *
 * Hàm THUẦN, tách riêng để lưới được không cần dựng cả `confirmAction` (DB thật + repo thật) —
 * nhưng đây KHÔNG phải một vị từ mồ côi: nó dùng lại NGUYÊN `daBiTuChoiGhi` (không viết bản thứ
 * hai) và được `confirmAction` gọi THẬT ngay dưới, tại đúng điểm ghi `status` vào CSDL lẫn điểm trả
 * `ConfirmResult` cho người gọi.
 */
export function trangThaiSauThucThi(ketQua: unknown): "executed" | "bi_tu_choi_ghi" {
  return daBiTuChoiGhi(ketQua) ? "bi_tu_choi_ghi" : "executed";
}

/** Câu khai "đã xử lý trước đó" cho nhánh cache-return — đúng bản chất từng trạng thái chung cục. */
function cauDaXuLyTruocDo(trangThai: "executed" | "bi_tu_choi_ghi"): string {
  return trangThai === "executed"
    ? "Đã thực thi trước đó."
    : "Đã bị từ chối ghi trước đó — không byte nào vào đĩa.";
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
  /**
   * D2 — set ONLY by the bounded-autonomy wiring in proposeAction() when it drives
   * this SAME confirm path programmatically instead of a human clicking confirm.
   * Purely additive: every existing caller omits it and the RETURNED ConfirmResult
   * shape is completely unchanged (see aiCopilotActions.contract.test.ts's exact
   * `Object.keys(res)` assertion) — it only tags the audit metadata below so an
   * auditor can tell an autonomous execution apart from a human one.
   */
  autonomy?: { reason: string },
  /**
   * ★★★ ĐỢT 3 (2026-08-23) — CHỈ SỐ các khối `apply_diff` người duyệt CHỌN GHI (0-based theo
   * `keHoachKhoiDuyet`). `undefined` (mọi caller cũ: CLI · MCP · autonomy · client không gửi) ⇒
   * áp TẤT CẢ — hành vi cũ, không đổi một byte. Có mặt ⇒ server TỰ dựng lại kế hoạch khối từ
   * `argsJson` trong CSDL, xác thực tập chỉ số (lạ/trùng/rỗng/ngoài khoảng ⇒ từ chối CÓ MÃ, hàng
   * để nguyên `proposed` — thử lại được trong TTL), rồi thay `argsJson.modified` bằng bản chiếu
   * TRONG CÙNG câu UPDATE giành quyền — "args từ DB" vẫn đúng theo chữ, TOCTOU (`sha256Before` so
   * với đĩa trong `execute`) giữ nguyên, và confirm-lại idempotent vẫn trả kết quả cache như cũ.
   */
  selectedHunkIds?: readonly number[],
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

  // Idempotency: đã có KẾT CỤC CHUNG CUỘC (dù ghi được hay bị TỪ CHỐI ghi) → trả kết quả ĐÃ LƯU,
  // không chạy execute() lần hai. ★ Đợt B · Task 6: 'bi_tu_choi_ghi' đứng CÙNG nhánh với 'executed'
  // — trước bản vá này một hàng bị từ chối ghi vẫn (sai) mang nhãn 'executed' nên vẫn rơi đúng
  // nhánh cache-return này; hành vi retry giữ NGUYÊN, chỉ nhãn trả về đổi cho đúng sự thật.
  if (row.status === "executed" || row.status === "bi_tu_choi_ghi") {
    return { ok: true, status: row.status, result: row.resultJson ?? null, message: cauDaXuLyTruocDo(row.status) };
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

  /**
   * ★★★ ĐỢT 3 — LỰA CHỌN KHỐI: xác thực + chiếu **TRƯỚC** phép giành quyền (thuần, không I/O), để
   * nhánh xanh đưa được bản chiếu vào CÙNG câu UPDATE có điều kiện bên dưới. Nhánh đỏ trả về mà
   * KHÔNG chạm hàng: trạng thái giữ nguyên (`proposed`), TTL vẫn chạy — người duyệt sửa lựa chọn
   * rồi confirm lại được; và đĩa không đổi một byte vì `execute` chưa hề tới lượt.
   */
  let luaChonKhoi: LuaChonKhoiXanh | null = null;
  if (selectedHunkIds !== undefined) {
    const chon = apLuaChonKhoi(row.tool, row.argsJson as Record<string, unknown>, selectedHunkIds);
    if (!chon.ok) {
      await auditConfirmFailure(user, req, row.tool, actionId, chon.reason);
      return { ok: false, status: "invalid", reason: chon.reason, message: hunkRejectMessage(lang, chon.reason, chon.chiTiet) };
    }
    luaChonKhoi = chon;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ 2026-08-23 — **GIÀNH QUYỀN, CHỨ KHÔNG PHẢI GHI NHÃN.** Đóng cửa sổ đua đọc-rồi-ghi.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Bản cũ là `UPDATE … SET status='confirmed' WHERE id=?` — **không điều kiện**. Giữa lượt `SELECT`
   * ở đầu hàm và lượt `UPDATE` này có một khoảng thời gian thật (hai vòng mạng tới CSDL, cộng một
   * lượt `checkPermission` **có I/O** ngay dưới). Hai lượt confirm cùng `actionId` gửi cùng lúc
   * (người bấm hai lần · một tab thứ hai · client thử lại vì mạng chậm) thì **CẢ HAI** đều đọc thấy
   * `status='proposed'`, **CẢ HAI** đều ghi nhãn thành công, và **CẢ HAI** đều chạy `execute()`.
   * Với `run_command` đó là lệnh chạy hai lần; với `apply_diff` lượt thứ hai thường bị `BASE_MISMATCH`
   * chặn — nhưng "thường bị một hàng rào KHÁC chặn" không phải là một hàng rào.
   *
   * ⚠⚠ **ĐIỀU KIỆN LÀ `status` ĐÃ QUAN SÁT ĐƯỢC Ở LƯỢT ĐỌC, KHÔNG PHẢI HẰNG `'proposed'`.**
   *   Ghim cứng `'proposed'` sẽ **phá** đường thử lại mà `enforceAdviceContract` cố ý dựng: khi
   *   POLICY_DENIED/TWIN_UNTRUSTED xảy ra, hàng được để nguyên ở `confirmed` để người dùng thử lại
   *   CÙNG action trong khi TTL còn (xem khối TOKEN SEMANTICS bên dưới). Một lượt thử lại như thế
   *   đọc thấy `confirmed`, nên phép giành phải so với `confirmed`.
   *   ⇒ Ở PostgreSQL, lượt `UPDATE` thứ hai **chặn** tới khi lượt thứ nhất commit rồi **đánh giá
   *     LẠI** mệnh đề `WHERE` trên hàng đã đổi ⇒ `proposed → confirmed` chỉ thắng được MỘT lần.
   *
   * ⚠ **LỖ CÒN LẠI, NÓI THẲNG (đã đo trên mã, chưa vá ở lượt này):** hai lượt thử-lại ĐỒNG THỜI của
   *   một hàng đang ở `confirmed` (chỉ tới được khi `ADVICE_CONTRACT_ENABLED` bật **và** vừa có một
   *   lượt từ chối tạm thời) vẫn cùng khớp `status='confirmed'` ⇒ vẫn lọt cả hai. Đóng nốt nó đòi
   *   một cột "người giành" hoặc một trạng thái trung gian, tức một migration — ngoài phạm vi lượt
   *   này. Cửa sổ đua của đường THƯỜNG (`proposed`) — đường mà mọi lượt duyệt của người dùng đi
   *   qua — thì đã đóng.
   */
  // ★ ĐỢT 3 — bản chiếu (nếu có) đi CÙNG câu UPDATE giành quyền: thắng phép giành ⇔ argsJson đã là
  //   bản chiếu; thua ⇒ không ai ghi gì. Không tồn tại trạng thái "giành được nhưng args còn cũ".
  const daGianh = await db
    .update(aiPendingActions)
    .set({ status: "confirmed", ...(luaChonKhoi ? { argsJson: luaChonKhoi.args } : {}) })
    .where(and(eq(aiPendingActions.id, actionId), eq(aiPendingActions.status, row.status)))
    .returning({ id: aiPendingActions.id });
  if (daGianh.length === 0) {
    // 0 hàng ⇒ ai đó đã CẦM action này trước ta. Đọc lại để nói đúng kết cục, không đoán.
    const [sau] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, actionId)).limit(1);
    if (sau?.status === "executed" || sau?.status === "bi_tu_choi_ghi") {
      // Nhánh idempotent y hệt nhánh đầu hàm: trả kết quả ĐÃ LƯU, không chạy lại `execute()`.
      return { ok: true, status: sau.status, result: sau.resultJson ?? null, message: cauDaXuLyTruocDo(sau.status) };
    }
    await auditConfirmFailure(user, req, row.tool, actionId, "CONCURRENT_CONFIRM");
    return {
      ok: false,
      status: sau?.status === "expired" ? "expired" : "invalid",
      message: `Một lượt duyệt khác đang xử lý action này (trạng thái: ${sau?.status ?? "không rõ"}).`,
    };
  }
  await logCrudOperation(buildAuditCtx(user, req), {
    action: AUDIT_ACTIONS.AI_ACTION_CONFIRMED,
    entityType: ENTITY_TYPES.AI_ACTION,
    entityName: row.tool,
    details: {
      operation: "AI_ACTION_CONFIRMED",
      metadata: {
        actionId,
        tool: row.tool,
        requiredPermission: perm,
        // ĐỢT 3 — người duyệt chọn TẬP CON ⇒ audit CONFIRMED nói rõ ngay từ lúc giành quyền.
        ...(luaChonKhoi ? { hunksApplied: { selected: luaChonKhoi.chiSo, total: luaChonKhoi.tong } } : {}),
        ...autonomyAuditMeta(autonomy),
      },
    },
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
        metadata: {
          actionId,
          tool: row.tool,
          requiredPermission: perm,
          denyReason: "MISSING_PERMISSION",
          stage: "execute",
          ...autonomyAuditMeta(autonomy),
        },
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
              ...autonomyAuditMeta(autonomy),
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
  // ★★★ doc 79 · TRỤC 2 — dựng lại `projectRoot` từ hàng (server-owned trong previewJson) để
  // `execute()` chạy trên ĐÚNG gốc dự án mà propose đã kiểm. Vắng ⇒ gốc mặc định (write tool tự
  // rơi về `gocHopCat()`), tương thích ngược cho mọi write tool không-repo.
  const projectRoot = readProjectRoot(row.previewJson as Record<string, unknown> | null);
  const execCtx: ToolExecContext = { user, lang, req, actionId, ...(projectRoot ? { projectRoot } : {}) };
  /**
   * ★ ĐỢT 3 — lời khai preview phải NÓI THẬT sau một lượt chọn tập-con: `sha256After` trong
   * previewJson là băm của bản áp-TẤT-CẢ (đúng tại lúc propose), nhưng byte thật sắp vào đĩa là
   * BẢN CHIẾU — nên hai ô `sha256After`/`content` trong `changes` được vá bằng băm/trích của chính
   * bản chiếu TRƯỚC khi chúng chảy vào audit EXECUTED + logUpdate. Dùng đúng `bam`/`trich` của
   * apply_diff, không dựng thước thứ hai.
   */
  let previewBefore = (row.previewJson as unknown as ActionPreview | null) ?? null;
  if (luaChonKhoi && previewBefore) {
    const lc = luaChonKhoi;
    previewBefore = {
      ...previewBefore,
      changes: (previewBefore.changes ?? []).map((c) =>
        c.field === "sha256After"
          ? { ...c, newValue: lc.bamSau }
          : c.field === "content"
            ? { ...c, newValue: trich(lc.vanBan) }
            : c,
      ),
    };
  }
  /**
   * ⚠ Args cho `execute` = ĐÚNG đối tượng vừa được persist vào `argsJson` bởi câu UPDATE giành
   * quyền ở trên (hoặc `row.argsJson` nguyên vẹn khi không có lựa chọn) — "args from DB" đúng theo
   * cả chữ lẫn nghĩa; không SELECT lại để khỏi mở thêm một vòng mạng trong đúng đoạn vừa đóng đua.
   */
  const argsThucThi = (luaChonKhoi ? luaChonKhoi.args : row.argsJson) as Record<string, unknown>;
  const result = await tool.execute!(argsThucThi, execCtx);
  // ★★★ Đợt B · Task 6 — CỘT `status` NÓI THẬT TỪ ĐÂY: `trangThaiSauThucThi` đọc đúng `note` mà
  // `execute()` vừa trả (quy ước máy-đọc-được chung của cả nhóm tool: có `note` ⇒ TỪ CHỐI GHI).
  // `resultJson` bên dưới vẫn là `result` NGUYÊN VẸN (mang `note`) — CLI/web/extension tiếp tục tự
  // kiểm `daBiTuChoiGhi(result)` như trước, hợp đồng không đổi; chỉ nhãn `status` hết nói dối.
  const trangThaiThat = trangThaiSauThucThi(result);

  await db
    .update(aiPendingActions)
    .set({ status: trangThaiThat, executedAt: new Date(), resultJson: result as unknown as Record<string, unknown> })
    .where(eq(aiPendingActions.id, actionId));

  // E2-4 — nudge AFTER the row is persisted (executed HOẶC bi_tu_choi_ghi — cả hai đều là một lượt
  // confirm đã xử lý xong, đáng để UI làm tươi). Fire-and-forget, minimal payload (event +
  // timestamp only — no result/args on the wire).
  nudge("action_confirmed");

  // Audit: executed (lifecycle) + target-entity update (before/after) when the
  // preview captured a concrete entity + changes.
  await logCrudOperation(buildAuditCtx(user, req), {
    action: AUDIT_ACTIONS.AI_ACTION_EXECUTED,
    entityType: ENTITY_TYPES.AI_ACTION,
    entityName: row.tool,
    details: {
      operation: "AI_ACTION_EXECUTED",
      changes: previewBefore?.changes,
      metadata: {
        actionId,
        tool: row.tool,
        requiredPermission: perm,
        // ĐỢT 3 — args ĐÃ THỰC THI (bản chiếu khi có lựa chọn), không phải args lúc propose:
        // audit của một lượt EXECUTED phải khai đúng cái vừa chạy.
        args: sanitizeArgs(argsThucThi),
        ...(luaChonKhoi ? { hunksApplied: { selected: luaChonKhoi.chiSo, total: luaChonKhoi.tong } } : {}),
        // D2 — the brief-mandated explicit marker: "the execution audit for an
        // auto-confirmed action must be clearly marked (autoConfirmed:true + the
        // policy decision/reason + the confirming principal recorded as the
        // autonomy tier, not a human user)".
        ...(autonomy ? { autoConfirmed: true } : {}),
        ...autonomyAuditMeta(autonomy),
        // ★★★ Đợt B · Task 6 — ADDITIVE, chỉ có mặt khi bị từ chối: đây vẫn là audit "lượt confirm
        // đã xử lý xong" (AI_ACTION_EXECUTED không đổi tên — vòng đời HITL THẬT SỰ chạy hết chặng),
        // nhưng auditor không còn phải suy ra "ghi được hay không" từ `resultJson.note` nữa.
        ...(trangThaiThat === "bi_tu_choi_ghi" ? { writeRejected: true, rejectCode: maTuChoiGhi(result) } : {}),
      },
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

  // ★★★ Đợt B · Task 6 — `ok:true` KHÔNG đổi (vòng đời HITL chạy hết chặng dù ghi được hay bị từ
  // chối; hợp đồng CLI/web/extension dựa vào `daBiTuChoiGhi(result)`, không dựa vào `ok`, giữ
  // nguyên). Chỉ `status`/`message` đổi để nói ĐÚNG cái vừa xảy ra.
  return {
    ok: true,
    status: trangThaiThat,
    result,
    message: trangThaiThat === "executed" ? "Đã thực thi." : "Bị từ chối ghi — không byte nào vào đĩa.",
  };
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

/**
 * D2 — audit metadata marker threaded onto every audit row confirmAction() writes
 * during an autonomous confirm attempt (CONFIRMED/DENIED/EXECUTED alike), so an
 * auditor can tell "this confirm was driven by the autonomy tier, not a human
 * click" from the audit trail alone. `autonomyReason` is the evaluateAutonomy()
 * decision reason (always "OK" here — a non-OK reason never reaches confirmAction).
 * Absent (⇒ {}) for every legacy human-confirm call.
 */
function autonomyAuditMeta(autonomy: { reason: string } | undefined): Record<string, unknown> {
  return autonomy ? { autonomyAttempt: true, autonomyReason: autonomy.reason, confirmedBy: "autonomy" } : {};
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
 * ★★★ doc 79 · TRỤC 2 — đọc GỐC DỰ ÁN (server-owned) đã lưu trong previewJson lúc propose. `null`
 * cho hàng cũ / write tool không-repo (⇒ `execute` rơi về `gocHopCat()`, tương thích ngược).
 */
function readProjectRoot(previewJson: Record<string, unknown> | null | undefined): string | null {
  if (!previewJson || typeof previewJson !== "object") return null;
  const r = (previewJson as Record<string, unknown>).__projectRoot;
  return typeof r === "string" && r !== "" ? r : null;
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

// ════════════════════════════════════════════════════════════════════════════
// D2 (doc69 Giai đoạn 4/Wave 3) — bounded-autonomy contract pre-check.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bounded-autonomy pre-check, called from server/services/ai/autonomyPolicy.ts
 * evaluateAutonomy() BEFORE it ever decides to drive confirmAction() programmatically.
 * Reuses `enforceAdviceContract` (the EXACT SAME guardrail/policy_permit/twin_validation
 * checks the human-confirm path runs) — it is NOT reimplemented here — but is STRICTER
 * in two ways that only matter for the human-wait-skipping path:
 *
 *   - No contract at all ⇒ ineligible (NO_ADVICE_CONTRACT). Autonomy must never guess at
 *     a safety envelope that was never attached to the proposal.
 *   - `requires: ["human_approval"]` ⇒ PERMANENTLY ineligible (HUMAN_APPROVAL_REQUIRED),
 *     regardless of guardrail/policy/twin outcome. Unlike the confirm path (where this
 *     requirement is satisfied by the human who is, in that flow, actually clicking
 *     confirm), autonomy has no human to satisfy it with — pretending otherwise would
 *     defeat the entire point of the requirement.
 *
 * Unconditional: unlike the confirm path's enforcement (gated by isAdviceContractEnabled()
 * so a human-confirm keeps legacy byte-for-byte behavior when the flag is off), the
 * autonomy pre-check ALWAYS runs when reached — autonomy has its own, independent safety
 * bar that does not depend on the global advice-contract toggle.
 */
export async function evaluateContractForAutonomy(
  contract: AdviceContract | null,
  ctx: { user: CopilotUser; tool: string; actionId: string; args: Record<string, unknown>; lang: ToolLang },
  deps: ConfirmContractDeps = {},
): Promise<{ ok: boolean; reason?: string }> {
  if (!contract) return { ok: false, reason: "NO_ADVICE_CONTRACT" };
  const requires = Array.isArray(contract.requires) ? contract.requires : [];
  if (requires.includes("human_approval")) {
    return { ok: false, reason: "HUMAN_APPROVAL_REQUIRED" };
  }
  const result = await enforceAdviceContract(contract, ctx, deps);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
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
