/**
 * Enhanced Audit Trail Service
 * Provides detailed logging for all CRUD operations with:
 * - Before/After snapshots for updates
 * - Request metadata (IP, user-agent, session)
 * - Batch operation tracking
 * - Performance metrics
 * - Configurable detail levels
 */

import { createHmac } from "node:crypto";
import * as db from "../db";
import { canonicalize } from "./security/auditChain"; // doc 33 D4 (F5 §5.11.2)
import { secPlatformEnabled } from "./security/policyGate";
import { getSecretSync } from "./security/secretManager"; // doc 44 G5.23

// ─── Content-hash integrity (doc 33 D4, hardened §11) ────────────────────────
// The high-frequency CRUD audit gets a per-row KEYED content hash (HMAC-SHA256), tamper-evident
// against in-place EDITS of a still-hashed row — rather than a serialized chain (a chain here would
// add lock contention on a hot path; the full hash-chain is reserved for the low-frequency control
// audit, I4). SEC_PLATFORM-gated.
//
// HONEST SCOPE: this detects content EDITS to hashed rows. It does NOT by itself detect a DB-writer
// who also STRIPS the hash fields — a per-row scheme has no neighbour to notice a missing hash. That
// stronger threat is covered by the audit_log append-only trigger (migration 0102) and, for control-
// critical events, the I4 hash-CHAIN (server/services/audit/controlAuditService.ts). The HMAC key
// (AUDIT_HASH_SECRET, else SESSION_SECRET) prevents an attacker from RE-SIGNING altered content;
// set AUDIT_HASH_SECRET in production for real tamper-evidence.

/**
 * Stable secret for the CRUD-audit HMAC. MUST be constant across restarts so old rows still verify.
 *
 * doc 44 G5.23 — resolved through the secret manager (OpenBao/Vault) with an honest env fallback.
 * When SECRET_MANAGER_ENABLED is OFF (default) this is exactly the prior env behaviour (bit-compat).
 * When ON, the operator MUST store the SAME value in Vault (the constancy requirement extends to the
 * Vault-backed value) or previously-hashed rows will no longer verify.
 */
function auditHashKey(): string {
  return getSecretSync("AUDIT_HASH_SECRET") || getSecretSync("SESSION_SECRET") || "synapse-crud-audit-v1";
}

/** Stored `details` without the integrity fields (so the hash is over stable content). */
function stableDetails(details: Record<string, any> | null | undefined): Record<string, any> {
  const { contentHash, hashTs, ...rest } = (details ?? {}) as Record<string, any>;
  void contentHash;
  void hashTs;
  return rest;
}

/** Deterministic keyed (HMAC-SHA256) content hash over a CRUD audit row's core + details. */
export function computeCrudContentHash(
  row: { userId?: number | null; action: string; entityType: string; entityId: unknown; entityName?: string | null; details?: Record<string, any> | null },
  hashTs: number,
): string {
  return createHmac("sha256", auditHashKey())
    .update(canonicalize({
      userId: row.userId ?? null,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? null,
      entityName: row.entityName ?? null,
      details: stableDetails(row.details),
      hashTs,
    }))
    .digest("hex");
}

/**
 * Verify a stored CRUD audit row's content hash. Legacy/unhashed rows pass (ok) — a per-row scheme
 * cannot distinguish a genuine pre-flag row from a stripped one (see HONEST SCOPE above; the
 * append-only trigger / I4 chain cover the strip threat).
 */
export function verifyCrudContentHash(row: {
  userId?: number | null; action: string; entityType: string; entityId: unknown; entityName?: string | null; details?: Record<string, any> | null;
}): { ok: boolean; reason?: string } {
  const d = (row.details ?? {}) as Record<string, any>;
  if (d.contentHash == null || d.hashTs == null) return { ok: true, reason: "unhashed (legacy / flag was off) — not covered by the per-row hash" };
  return computeCrudContentHash(row, Number(d.hashTs)) === d.contentHash
    ? { ok: true }
    : { ok: false, reason: "content hash mismatch (row altered)" };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditDetailLevel = "minimal" | "standard" | "detailed" | "full";

export interface AuditContext {
  userId?: number | null;
  userName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  source?: "web" | "api" | "mqtt" | "system" | "scheduler" | "trpc" | "orchestration";
}

export interface AuditChangeField {
  field: string;
  oldValue: any;
  newValue: any;
  displayName?: string;
}

export interface AuditLogEntry {
  action: string;
  entityType: string;
  entityId?: number | null;
  entityName?: string | null;
  details: {
    operation: string;
    changes?: AuditChangeField[];
    before?: Record<string, any>;
    after?: Record<string, any>;
    metadata?: Record<string, any>;
    duration?: number;
    batchId?: string;
    batchSize?: number;
    errorMessage?: string;
    stackTrace?: string;
    affectedFields?: string[];
    relatedEntities?: Array<{ type: string; id: number; name?: string }>;
    /**
     * Chế độ 2FA theo triển khai (2026-08-24, `AUTH_2FA_BAT_BUOC=0`): lượt MUTATION chạm
     * máy/deploy đi QUA cổng step-up KHÔNG có OTP vì người gọi CHƯA bật 2FA. Người ghi DUY
     * NHẤT: `_core/trpc.ts` (`stepUpTotpMiddleware`) — kiểu literal để giá trị không trôi;
     * lưới đọc lại bảng thật: `_core/cheDo2faTheoTrienKhai.test.ts` §3.
     */
    stepUp?: "bo_qua_che_do_noi_bo";
  };
  status: "success" | "failure";
}

// ─── Action Constants ────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = {
  // Auth
  LOGIN: "login",
  LOGIN_FAILED: "login_failed",
  LOGOUT: "logout",
  PASSWORD_CHANGE: "password_change",
  TWO_FACTOR_ENABLE: "2fa_enable",
  TWO_FACTOR_DISABLE: "2fa_disable",
  SESSION_CREATED: "session_created",
  SESSION_EXPIRED: "session_expired",
  
  // CRUD
  CREATE: "create",
  READ: "read",
  UPDATE: "update",
  DELETE: "delete",
  BULK_CREATE: "bulk_create",
  BULK_UPDATE: "bulk_update",
  BULK_DELETE: "bulk_delete",
  
  // Inspection
  INSPECT_SUBMIT: "inspection_submit",
  INSPECT_CORRECT: "inspection_correct",
  INSPECT_NTF: "inspection_ntf_confirm",
  INSPECT_ACKNOWLEDGE: "inspection_acknowledge",
  INSPECT_ARCHIVE: "inspection_archive",
  
  // Reports
  REPORT_GENERATE: "report_generate",
  REPORT_EXPORT: "report_export",
  REPORT_SCHEDULE: "report_schedule",
  REPORT_EMAIL_SENT: "report_email_sent",
  
  // System
  CONFIG_CHANGE: "config_change",
  ROLE_CHANGE: "role_change",
  PERMISSION_CHANGE: "permission_change",
  BACKUP_CREATE: "backup_create",
  BACKUP_RESTORE: "backup_restore",
  
  // Data
  IMPORT: "import",
  EXPORT: "export",
  BULK_IMPORT: "bulk_import",

  // AI Copilot write-action lifecycle (GĐ2 HITL)
  AI_ACTION_PROPOSED: "ai_action_proposed",
  AI_ACTION_CONFIRMED: "ai_action_confirmed",
  AI_ACTION_EXECUTED: "ai_action_executed",
  AI_ACTION_DENIED: "ai_action_denied",
  AI_ACTION_CANCELLED: "ai_action_cancelled",
  // D2 (doc69 Giai đoạn 4/Wave 3) — bounded-autonomy DECISION, audited as a separate
  // lightweight follow-up entry AFTER the PROPOSED row (and after any CONFIRMED/
  // EXECUTED/DENIED rows an auto-confirm attempt wrote), so it never distorts the
  // causal PROPOSED → CONFIRMED → EXECUTED ordering. See aiCopilotActions.ts:proposeAction.
  AI_AUTONOMY_DECISION: "ai_autonomy_decision",
  // D4 (doc69 Giai đoạn 4/Wave 3) — operator trip/untrip of the D2 bounded-autonomy
  // kill-switch (admin + 2FA). Distinct from AI_AUTONOMY_DECISION (a per-proposal
  // decision trace): this is the durable master-switch flip itself.
  AI_AUTONOMY_KILL_SWITCH: "ai_autonomy_kill_switch",
  // ★★★ 2026-08-24 — VÒNG TỰ-TRỊ-GHI (AI_CODING_TU_TRI_GHI). MỘT hàng WORM cho MỖI lượt của vòng
  // model-tự-ghi-mã-KHÔNG-người-duyệt: băm tệp TRƯỚC/SAU, lệnh kiểm chứng đã chạy, kết quả test,
  // lượt thứ mấy. Đây là sổ để sau truy được CHÍNH XÁC model đã làm gì mà KHÔNG có người xem —
  // xem server/services/aiCodingTuTriGhi.ts.
  AI_CODING_TU_TRI_LUOT: "ai_coding_tu_tri_luot",

  // Interlock auto-block (GĐ F5b) — a DETERMINISTIC, human-approved interlock
  // rule auto-fired a block/stop/reduce command down to the machine. NOT an AI
  // action: the AI has no code path here (it can only propose inert rules).
  INTERLOCK_AUTO_BLOCK: "interlock_auto_block",

  // D3 (doc69 Giai đoạn 4/Wave 3) — MODEL-LIFECYCLE governance trail: every
  // activate / rollback / force-override of a model_versions row writes ONE of these,
  // recording modelId/versionId/actor/evalGate result/card-gate result/forced/reason.
  // Distinct from ai_llm_audit (LLM-decision audit, G2-5) and from stageHistory (the
  // per-version transition ledger this does NOT duplicate — see aiModelService.ts).
  AI_MODEL_GOVERNANCE: "ai_model_governance",
} as const;

export const ENTITY_TYPES = {
  USER: "user",
  FACTORY: "factory",
  WORKSHOP: "workshop",
  LINE: "line",
  STATION: "station",
  MACHINE: "machine",
  PRODUCT_MODEL: "product_model",
  MEASUREMENT_POINT: "measurement_point",
  INSPECTION: "inspection",
  MEASUREMENT_RESULT: "measurement_result",
  ALERT: "alert",
  THRESHOLD: "threshold",
  PRODUCTION_ORDER: "production_order",
  REPORT: "report",
  SCHEDULED_REPORT: "scheduled_report",
  SYSTEM_CONFIG: "system_config",
  SMTP_CONFIG: "smtp_config",
  TEMPLATE: "template",
  DASHBOARD_WIDGET: "dashboard_widget",
  ANNOTATION: "annotation",
  SPC_CONFIG: "spc_config",
  QUALITY_GATE: "quality_gate",
  AI_ACTION: "ai_action",
  // D3 (doc69 Giai đoạn 4/Wave 3) — model registry governance.
  MODEL_VERSION: "model_version",
  AI_MODEL_CARD: "ai_model_card",
  // D4 (doc69 Giai đoạn 4/Wave 3) — bounded-autonomy kill-switch entity.
  AI_AUTONOMY: "ai_autonomy",
} as const;

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Compute field-level differences between two objects
 */
export function computeChanges(
  before: Record<string, any>,
  after: Record<string, any>,
  fieldDisplayNames?: Record<string, string>
): AuditChangeField[] {
  const changes: AuditChangeField[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    // Skip internal/system fields
    if (["createdAt", "updatedAt", "passwordHash"].includes(key)) continue;

    const oldVal = before[key];
    const newVal = after[key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({
        field: key,
        oldValue: sanitizeValue(key, oldVal),
        newValue: sanitizeValue(key, newVal),
        displayName: fieldDisplayNames?.[key] || key,
      });
    }
  }

  return changes;
}

/**
 * Sanitize sensitive field values (passwords, tokens, etc.)
 */
function sanitizeValue(fieldName: string, value: any): any {
  const sensitiveFields = ["password", "passwordHash", "token", "secret", "apiKey", "accessToken", "refreshToken"];
  if (sensitiveFields.some((f) => fieldName.toLowerCase().includes(f.toLowerCase()))) {
    return value ? "***REDACTED***" : null;
  }
  return value;
}

/**
 * Generate a unique batch ID for bulk operations
 */
export function generateBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ─── Main Audit Functions ───────────────────────────────────────────────────

/**
 * Log a CRUD operation with full detail
 */
export async function logCrudOperation(
  context: AuditContext,
  entry: AuditLogEntry
): Promise<{ id: number }> {
  try {
    const details: Record<string, any> = {
      ...entry.details,
      source: context.source || "web",
      sessionId: context.sessionId,
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
    };
    // doc 33 D4 (F5 §5.11.2) — per-row content hash for tamper-evidence (SEC_PLATFORM). No
    // serialization (perf-safe on this hot path); catches content edits.
    if (secPlatformEnabled()) {
      const hashTs = Date.now();
      details.hashTs = hashTs;
      details.contentHash = computeCrudContentHash(
        { userId: context.userId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId, entityName: entry.entityName, details },
        hashTs,
      );
    }
    const result = await db.createAuditLog({
      userId: context.userId,
      userName: context.userName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityName: entry.entityName,
      details,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      status: entry.status,
    });
    return result;
  } catch (error) {
    console.error("[AuditTrail] Failed to log audit entry:", error);
    // Don't throw - audit logging should never break the main operation
    return { id: -1 };
  }
}

/**
 * Log a CREATE operation
 */
export async function logCreate(
  context: AuditContext,
  entityType: string,
  entityId: number,
  entityName: string,
  data: Record<string, any>,
  metadata?: Record<string, any>
): Promise<void> {
  await logCrudOperation(context, {
    action: AUDIT_ACTIONS.CREATE,
    entityType,
    entityId,
    entityName,
    details: {
      operation: "CREATE",
      after: sanitizeObject(data),
      metadata,
      affectedFields: Object.keys(data),
    },
    status: "success",
  });
}

/**
 * Log an UPDATE operation with before/after diff
 */
export async function logUpdate(
  context: AuditContext,
  entityType: string,
  entityId: number,
  entityName: string,
  before: Record<string, any>,
  after: Record<string, any>,
  metadata?: Record<string, any>
): Promise<void> {
  const changes = computeChanges(before, after);
  
  if (changes.length === 0) return; // No actual changes

  await logCrudOperation(context, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType,
    entityId,
    entityName,
    details: {
      operation: "UPDATE",
      changes,
      before: sanitizeObject(before),
      after: sanitizeObject(after),
      metadata,
      affectedFields: changes.map((c) => c.field),
    },
    status: "success",
  });
}

/**
 * Log a DELETE operation
 */
export async function logDelete(
  context: AuditContext,
  entityType: string,
  entityId: number,
  entityName: string,
  deletedData?: Record<string, any>,
  metadata?: Record<string, any>
): Promise<void> {
  await logCrudOperation(context, {
    action: AUDIT_ACTIONS.DELETE,
    entityType,
    entityId,
    entityName,
    details: {
      operation: "DELETE",
      before: deletedData ? sanitizeObject(deletedData) : undefined,
      metadata,
    },
    status: "success",
  });
}

/**
 * Log a bulk/batch operation
 */
export async function logBulkOperation(
  context: AuditContext,
  action: string,
  entityType: string,
  items: Array<{ id: number; name?: string }>,
  metadata?: Record<string, any>
): Promise<void> {
  const batchId = generateBatchId();

  await logCrudOperation(context, {
    action,
    entityType,
    entityName: `${items.length} items`,
    details: {
      operation: action,
      batchId,
      batchSize: items.length,
      metadata: {
        ...metadata,
        itemIds: items.map((i) => i.id),
        itemNames: items.map((i) => i.name).filter(Boolean),
      },
    },
    status: "success",
  });
}

/**
 * Log an error/failure
 */
export async function logFailure(
  context: AuditContext,
  action: string,
  entityType: string,
  error: Error | string,
  metadata?: Record<string, any>
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : error;
  const stackTrace = error instanceof Error ? error.stack : undefined;

  await logCrudOperation(context, {
    action,
    entityType,
    details: {
      operation: action,
      errorMessage,
      stackTrace: stackTrace?.substring(0, 1000), // Limit stack trace length
      metadata,
    },
    status: "failure",
  });
}

/**
 * Create audit context from tRPC context
 */
export function createAuditContext(ctx: {
  user?: { id: number; name?: string | null } | null;
  req?: { ip?: string; headers?: Record<string, any>; socket?: { remoteAddress?: string } };
}): AuditContext {
  const ip = ctx.req?.headers?.["x-forwarded-for"] ||
    ctx.req?.headers?.["x-real-ip"] ||
    ctx.req?.socket?.remoteAddress ||
    ctx.req?.ip ||
    null;

  return {
    userId: ctx.user?.id,
    userName: ctx.user?.name,
    ipAddress: typeof ip === "string" ? ip : null,
    userAgent: ctx.req?.headers?.["user-agent"] || null,
    source: "web",
    requestId: generateRequestId(),
  };
}

/**
 * Sanitize an entire object, removing sensitive fields
 */
function sanitizeObject(obj: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

/**
 * Wrap a mutation with automatic audit logging
 */
export function withAuditLog<T>(
  context: AuditContext,
  entityType: string,
  action: string,
  operation: () => Promise<T>,
  getEntityInfo?: (result: T) => { id: number; name: string }
): Promise<T> {
  const startTime = Date.now();

  return operation()
    .then(async (result) => {
      const entityInfo = getEntityInfo?.(result);
      await logCrudOperation(context, {
        action,
        entityType,
        entityId: entityInfo?.id,
        entityName: entityInfo?.name,
        details: {
          operation: action,
          duration: Date.now() - startTime,
        },
        status: "success",
      });
      return result;
    })
    .catch(async (error) => {
      await logFailure(context, action, entityType, error);
      throw error;
    });
}
