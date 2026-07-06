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
 *
 * doc 33 I4 (F5 §5.11.2) — HASH-CHAIN WORM: khi SEC_PLATFORM bật, mỗi dòng mới liên kết
 * hash của dòng trước (serialize bằng advisory-lock để chuỗi không rẽ nhánh) → mọi
 * sửa/chèn/xoá bị `verifyControlAuditChain` phát hiện. SEC_PLATFORM tắt (mặc định) → INSERT
 * thường như cũ (non-breaking). Cột hash NULLABLE + additive (migration 0220).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { sql, desc, asc } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { controlAuditLog, type ControlAuditLog } from "../../../drizzle/schema";
import { canonicalize, GENESIS_HASH } from "../security/auditChain";
import { secPlatformEnabled } from "../security/policyGate";

/** Kiểu db drizzle đã resolve (khớp getDb) — caller luôn truyền db non-null. */
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Advisory-lock key that serialises audit-chain appends (arbitrary constant). */
const AUDIT_CHAIN_LOCK = 918_273_645;

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

/** The content fields folded into an audit row's hash. */
export interface AuditHashFields {
  entityType: string;
  entityId: string;
  action: string;
  actorId: number | null;
  before: unknown;
  after: unknown;
  reason: string | null;
}

/** sha256 over (prevHash + canonical content + hashTs). Deterministic + pure. */
export function computeAuditHash(prevHash: string, fields: AuditHashFields, ts: number): string {
  return createHash("sha256").update(canonicalize({ prevHash, ...fields, hashTs: ts })).digest("hex");
}

/**
 * Ghi ĐÚNG MỘT dòng audit bất biến. Trả về dòng vừa ghi (hoặc null). Khi SEC_PLATFORM bật,
 * dòng được nối vào hash-chain (advisory-lock serialise); tắt → INSERT thường (hành vi cũ).
 */
export async function recordAuditEvent(db: Db, e: AuditEventInput): Promise<ControlAuditLog | null> {
  const base = {
    entityType: e.entityType,
    entityId: String(e.entityId),
    action: e.action,
    actorId: e.actorId ?? null,
    beforeJson: (e.before ?? null) as never,
    afterJson: (e.after ?? null) as never,
    reason: e.reason ?? null,
  };

  if (!secPlatformEnabled()) {
    // Legacy plain append — byte-for-byte the old behavior.
    const [row] = await db.insert(controlAuditLog).values(base).returning();
    return row ?? null;
  }

  // Hash-chain append: serialise so the chain never forks under concurrency.
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`);
    const [prev] = await tx
      .select({ hash: controlAuditLog.hash })
      .from(controlAuditLog)
      .where(sql`${controlAuditLog.hash} IS NOT NULL`)
      .orderBy(desc(controlAuditLog.id))
      .limit(1);
    const prevHash = prev?.hash ?? GENESIS_HASH;
    const hashTs = Date.now();
    const fields: AuditHashFields = {
      entityType: base.entityType,
      entityId: base.entityId,
      action: base.action,
      actorId: base.actorId,
      before: e.before ?? null,
      after: e.after ?? null,
      reason: base.reason,
    };
    const hash = computeAuditHash(prevHash, fields, hashTs);
    const [row] = await tx.insert(controlAuditLog).values({ ...base, prevHash, hash, hashTs }).returning();
    return row ?? null;
  });
}

/** A hashed audit row (subset) for verification. */
export interface HashedAuditRow {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  actorId: number | null;
  beforeJson: unknown;
  afterJson: unknown;
  reason: string | null;
  prevHash: string | null;
  hash: string | null;
  hashTs: number | null;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  /** id of the first tampered row, or null when intact. */
  brokenAtId: number | null;
  reason?: string;
}

/**
 * Verify an id-ordered set of rows (hashed AND unhashed). Pure — any edit/insert/delete surfaces.
 *
 * ANCHORING (doc 33 §11 fix): a LEADING contiguous prefix of unhashed rows is allowed (legacy
 * rows written before SEC_PLATFORM was enabled). But once the chain has STARTED (first hashed row
 * seen), any subsequent unhashed row is treated as TAMPERING — an attacker with DB-write access
 * could otherwise strip `hash`/`prevHash` from the newest hashed row(s) to make them vanish from a
 * "hashed rows only" query and hide an edit. Note: disabling SEC_PLATFORM after it was on will
 * therefore make this report the unhashed tail (by design — do not turn off the WORM chain).
 */
export function verifyAuditRows(rows: readonly HashedAuditRow[]): ChainVerification {
  let prevHash = GENESIS_HASH;
  let started = false; // true once the first hashed row is seen (legacy prefix has ended)
  let checked = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const hashed = r.hash != null && r.hashTs != null;
    if (!hashed) {
      if (started) {
        return { ok: false, checked, brokenAtId: r.id, reason: "unhashed row after chain start (hash stripped?)" };
      }
      continue; // legacy pre-SEC_PLATFORM prefix row — allowed
    }
    started = true;
    if ((r.prevHash ?? GENESIS_HASH) !== prevHash) {
      return { ok: false, checked, brokenAtId: r.id, reason: "prevHash mismatch" };
    }
    const fields: AuditHashFields = {
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      actorId: r.actorId,
      before: r.beforeJson ?? null,
      after: r.afterJson ?? null,
      reason: r.reason,
    };
    if (computeAuditHash(r.prevHash ?? GENESIS_HASH, fields, r.hashTs!) !== r.hash) {
      return { ok: false, checked, brokenAtId: r.id, reason: "hash mismatch (row altered)" };
    }
    prevHash = r.hash;
    checked++;
  }
  return { ok: true, checked, brokenAtId: null };
}

/**
 * Verify the persisted control-audit hash-chain. Loads ALL rows in id order (not just hashed) so a
 * stripped-hash tail row is detectable (see verifyAuditRows anchoring).
 */
export async function verifyControlAuditChain(db: Db, limit = 10_000): Promise<ChainVerification> {
  const rows = (await db
    .select()
    .from(controlAuditLog)
    .orderBy(asc(controlAuditLog.id))
    .limit(limit)) as unknown as HashedAuditRow[];
  return verifyAuditRows(rows);
}
