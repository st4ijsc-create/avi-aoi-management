/**
 * Enhanced Audit Trail Service
 * Provides detailed logging for all CRUD operations with:
 * - Before/After snapshots for updates
 * - Request metadata (IP, user-agent, session)
 * - Batch operation tracking
 * - Performance metrics
 * - Configurable detail levels
 */

import * as db from "../db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditDetailLevel = "minimal" | "standard" | "detailed" | "full";

export interface AuditContext {
  userId?: number | null;
  userName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  source?: "web" | "api" | "mqtt" | "system" | "scheduler";
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
    const result = await db.createAuditLog({
      userId: context.userId,
      userName: context.userName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityName: entry.entityName,
      details: {
        ...entry.details,
        source: context.source || "web",
        sessionId: context.sessionId,
        requestId: context.requestId,
        timestamp: new Date().toISOString(),
      },
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
