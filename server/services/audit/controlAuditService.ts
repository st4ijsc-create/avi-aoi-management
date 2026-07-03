/**
 * Control Audit Service (audit doc 25 · T6 / task W2-7).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Helper APPEND-ONLY dùng chung để ghi một sự kiện audit bất biến cho các mutation
 * cấu hình / an toàn (interlock, equipment-standards, workforce/collaboration).
 *
 * BẤT BIẾN: service này CHỈ cung cấp recordAuditEvent (INSERT). Không có update/delete
 * — mọi thay đổi phải là một dòng MỚI. Caller truyền sẵn db đã resolve (tránh mở lại
 * connection) + actor lấy từ ctx.user.id (KHÔNG bao giờ từ body).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { getDb } from "../../db/connection";
import { controlAuditLog, type ControlAuditLog } from "../../../drizzle/schema";

/** Kiểu db drizzle đã resolve (khớp getDb) — caller luôn truyền db non-null. */
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface AuditEventInput {
  entityType: string;
  /** id số (rule/assignment/session) hoặc khóa chuỗi (crKey) — coerce về string. */
  entityId: string | number;
  action: string;
  /** ctx.user.id — người thực hiện. null nếu hệ thống/không xác định. */
  actorId?: number | null;
  /** Ảnh chụp trạng thái trước (tùy chọn). */
  before?: unknown;
  /** Ảnh chụp trạng thái sau (tùy chọn). */
  after?: unknown;
  reason?: string | null;
}

/**
 * Ghi ĐÚNG MỘT dòng audit bất biến. Trả về dòng vừa ghi (hoặc null nếu insert không
 * trả về hàng — không nên xảy ra). Caller đã đảm bảo db kết nối.
 */
export async function recordAuditEvent(db: Db, e: AuditEventInput): Promise<ControlAuditLog | null> {
  const [row] = await db
    .insert(controlAuditLog)
    .values({
      entityType: e.entityType,
      entityId: String(e.entityId),
      action: e.action,
      actorId: e.actorId ?? null,
      beforeJson: (e.before ?? null) as never,
      afterJson: (e.after ?? null) as never,
      reason: e.reason ?? null,
    })
    .returning();
  return row ?? null;
}
