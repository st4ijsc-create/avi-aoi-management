/**
 * Doc 24 / Wave-1 phase C2 — Hardware commissioning / FAT gate service.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (STRENGTHEN-ONLY): this service owns the `commissioning_records` sign-off
 * ledger and the single predicate the command dispatcher consults BEFORE any real
 * hardware write: isCommissioned(adapterId). It mirrors the proven sim-gate → deploy
 * precondition (programmingService): a real (non-simulated) control write is refused
 * (degraded to 'simulated') unless the adapter has an ACTIVE, non-expired, SIGNED
 * commissioning record.
 *
 *   • isCommissioned(adapterId) — TRUE iff ≥1 record with status='active' AND
 *     (expiresAt IS NULL OR expiresAt > now()). Read at call time so a just-created /
 *     just-revoked / just-expired record takes effect immediately. NEVER throws for
 *     the "no DB" case → returns false (fail-safe: uncommissioned ⇒ blocked).
 *   • createRecord — SIGN an adapter as commissioned (admin-gated at the router).
 *   • revokeRecord — rescind an active record (admin-gated). Append-mostly: we flip
 *     status to 'revoked' + stamp revokedBy/revokedAt/revokeReason (auditable).
 *   • listRecords — read the ledger for an adapter (admin visibility).
 *
 * This service has NO device I/O and NEVER calls a driver. It only reads/writes the
 * ledger. The gate itself lives in commandDispatcher.dispatch() (single write path).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { DbUnavailableError } from "../../_core/dbErrors";
import { getDb } from "../../db/connection";
import { commissioningRecords, controlAuditLog, type CommissioningRecord } from "../../../drizzle/schema";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Commissioning record lifecycle status (plain string; no pg enum). */
export type CommissioningStatus = "active" | "revoked" | "expired";

/**
 * Master flag for the C2 gate. When ON (the DEFAULT — safe by default) the
 * dispatcher requires an adapter to be commissioned before a real write; an
 * uncommissioned adapter is FORCED down the 'simulated' path. May be set false ONLY
 * for legacy/dev. Read at RUNTIME (not module load) so tests/ops can toggle it.
 *
 * DEFAULT-ON rationale: a missing/misconfigured flag must be the SAFE state. Absence
 * of the env var ⇒ gate ENGAGED ⇒ no real write to an un-signed adapter. Only an
 * explicit "false"/"0" opts out (for legacy adapters already commissioned out-of-band
 * or dev boxes with no hardware).
 */
export function isCommissioningRequired(): boolean {
  const v = process.env.OT_COMMISSIONING_REQUIRED;
  // DEFAULT ON: only an explicit opt-out disables the gate.
  return !(v === "false" || v === "0");
}

/**
 * TRUE iff `adapterId` has an ACTIVE, non-expired, signed commissioning record.
 *
 * Fail-safe: if the DB is unavailable we return FALSE (⇒ the dispatcher will NOT do
 * a real write; it degrades to simulated). This can only ever be STRICTER than the
 * pre-C2 behaviour — it never authorizes a write that wasn't already authorized.
 */
export async function isCommissioned(adapterId: number, dbOrTx?: DbOrTx): Promise<boolean> {
  // doc 81 Đợt 1D Task 1 — `dbOrTx` (tuỳ chọn): đọc TRONG transaction của nơi gọi (stopPin).
  return (await currentSignatureId(adapterId, dbOrTx)) != null;
}

/**
 * doc 81 Đợt 5 task F7 (item 31) — the id of the signature IN FORCE for `adapterId`: the largest `active`, non-expired
 * commissioning record (the same predicate as isCommissioned, which is `currentSignatureId(...) != null`), or null.
 * Fail-safe: no DB ⇒ null (not commissioned).
 */
export async function currentSignatureId(adapterId: number, dbOrTx?: DbOrTx): Promise<number | null> {
  const db = dbOrTx ?? (await getDb());
  if (!db) return null;
  const rows = await db
    .select()
    .from(commissioningRecords)
    .where(and(eq(commissioningRecords.adapterId, adapterId), eq(commissioningRecords.status, "active")));
  const now = Date.now();
  const live = rows.filter((r) => r.status === "active" && (r.expiresAt == null || new Date(r.expiresAt).getTime() > now));
  return live.length === 0 ? null : Math.max(...live.map((r) => r.id));
}

/**
 * doc 81 Đợt 5 task F7 (item 31) — advisory-lock namespace (two-key form: its key space never overlaps the single-key
 * locks of the audit chain / genealogy / worker leader) serialising, PER ADAPTER, a commissioning SIGNATURE (createRecord)
 * and every STOP-PIN change (stopPin.ts: datStopPin, ghiAuditGoStopPinTx). Lock order everywhere: tag row locks first,
 * then this lock (createRecord takes only this one) — no lock cycle. Released at COMMIT/ROLLBACK.
 */
export const COMMISSIONING_PIN_LOCK_NS = 563_118_407;

/** Take the per-adapter signature / stop-pin lock inside `tx` (blocks until a concurrent holder commits). */
export async function lockAdapterCommissioningTx(tx: DbOrTx, adapterId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${COMMISSIONING_PIN_LOCK_NS}, ${adapterId})`);
}

export interface CreateCommissioningInput {
  adapterId: number;
  /** User (users.id) signing off — owns responsibility for the FAT acceptance. */
  signedBy: number;
  fatReference?: string | null;
  /** Optional validity expiry; omit / null = no expiry. */
  expiresAt?: Date | null;
  notes?: string | null;
}

/**
 * SIGN an adapter as commissioned (create an 'active' record). Admin-gated at the
 * router. Verifies the adapter exists so we never commission a phantom id.
 */
export async function createRecord(input: CreateCommissioningInput): Promise<CommissioningRecord> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  // doc 81 Đợt 5 task F7 (item 31) — the signature is strictly ordered with every stop-pin change of this adapter: a
  // pin-change tx in flight finishes (commits) before the signature lands, and one that starts later sees this record
  // and stamps its id (latestCommissioningRecheck compares those ids, not transaction-start clocks).
  return db.transaction(async (tx) => {
    await lockAdapterCommissioningTx(tx, input.adapterId);
    const [row] = await tx
      .insert(commissioningRecords)
      .values({
        adapterId: input.adapterId,
        status: "active",
        fatReference: input.fatReference ?? null,
        signedBy: input.signedBy,
        signedAt: new Date(),
        expiresAt: input.expiresAt ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return row;
  });
}

/**
 * REVOKE a commissioning record (flip 'active' → 'revoked' + stamp who/when/why).
 * Append-mostly (no delete) so the ledger stays auditable. Returns the updated row,
 * or null if the record does not exist / was already terminal.
 */
export async function revokeRecord(
  recordId: number,
  revokedBy: number,
  reason?: string | null,
): Promise<CommissioningRecord | null> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const [row] = await db
    .update(commissioningRecords)
    .set({
      status: "revoked",
      revokedBy,
      revokedAt: new Date(),
      revokeReason: reason ?? null,
    })
    .where(and(eq(commissioningRecords.id, recordId), eq(commissioningRecords.status, "active")))
    .returning();
  return row ?? null;
}

/** List the commissioning ledger for an adapter (newest first). Admin visibility. */
export async function listRecords(adapterId: number): Promise<CommissioningRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(commissioningRecords)
    .where(eq(commissioningRecords.adapterId, adapterId))
    .orderBy(desc(commissioningRecords.id));
}

/**
 * doc 81 Đợt 4 Task C3 — thay đổi ghim DỪNG cần SOÁT LẠI commissioning, hiện ở "Sổ ký".
 *
 * Mọi đổi ghim (setStopPin, gỡ tự động khi sửa/xoá tag, đổi đích adapter, import mapping/CLI) ghi một dòng
 * `control_audit_log` (`entityType = device_tag_stop_pin`) mà `afterJson.commissioningRecheckRequired = true` khi
 * adapter ĐANG commissioning lúc đổi. Hàm này trả dòng MỚI NHẤT như thế của `adapterId` xảy ra SAU bản ký HIỆN TẠI,
 * hoặc null. Ký lại ⇒ bản ký mới hơn ⇒ null (chip tự tắt).
 *
 *   • bản ký hiện tại = bản `active`, chưa hết hạn (cùng vị từ `isCommissioned`), id LỚN NHẤT; không có ⇒ null
 *     (adapter không commissioned thì không có gì để "soát lại" — cổng đã ép mô phỏng);
 *   • so thời điểm TRÊN SERVER, trong SQL: `control_audit_log."createdAt"` vs `commissioning_records."createdAt"` —
 *     cả hai cùng DEFAULT now() của CSDL (cùng đồng hồ, cùng quy ước múi giờ phiên). KHÔNG so với `signedAt`
 *     (giá trị JS ghi vào) và KHÔNG dùng đồng hồ client.
 * Ném khi CSDL lỗi — nơi gọi (commissioning.status) chuyển thành cờ "không đọc được" chứ không làm hỏng status.
 */
export interface CommissioningRecheck {
  auditId: number;
  tagId: number;
  tagKey: string | null;
  action: string;
  autoClearedBy: string | null;
  actorId: number | null;
  changedAt: Date;
  signatureId: number;
}

export async function latestCommissioningRecheck(adapterId: number, dbOrTx?: DbOrTx): Promise<CommissioningRecheck | null> {
  const db = dbOrTx ?? (await getDb());
  if (!db) throw new DbUnavailableError();
  const rows = await db
    .select({ id: commissioningRecords.id, expiresAt: commissioningRecords.expiresAt })
    .from(commissioningRecords)
    .where(and(eq(commissioningRecords.adapterId, adapterId), eq(commissioningRecords.status, "active")));
  const now = Date.now();
  const live = rows.filter((r) => r.expiresAt == null || new Date(r.expiresAt).getTime() > now);
  if (live.length === 0) return null;
  const signatureId = Math.max(...live.map((r) => r.id));

  const [row] = await db
    .select({
      id: controlAuditLog.id,
      entityId: controlAuditLog.entityId,
      action: controlAuditLog.action,
      actorId: controlAuditLog.actorId,
      afterJson: controlAuditLog.afterJson,
      createdAt: controlAuditLog.createdAt,
    })
    .from(controlAuditLog)
    .where(
      and(
        eq(controlAuditLog.entityType, "device_tag_stop_pin"),
        sql`${controlAuditLog.afterJson}->>'adapterId' = ${String(adapterId)}`,
        sql`${controlAuditLog.afterJson}->>'commissioningRecheckRequired' = 'true'`,
        // doc 81 Đợt 5 task F7 — a change audited WITH the signature id in force when it was made (stamped under the
        // per-adapter lock) is "after the current signature" iff that id >= the current one. Older rows (no stamp) keep
        // the transaction-start comparison.
        sql`(CASE WHEN (${controlAuditLog.afterJson}->>'commissioningSignatureId') ~ '^[0-9]{1,18}$'
                  THEN (${controlAuditLog.afterJson}->>'commissioningSignatureId')::bigint >= ${signatureId}
                  ELSE ${controlAuditLog.createdAt} > (SELECT cr."createdAt" FROM commissioning_records cr WHERE cr.id = ${signatureId})
             END)`,
      ),
    )
    .orderBy(desc(controlAuditLog.id))
    .limit(1);
  if (!row) return null;
  const after = (row.afterJson ?? {}) as { tagKey?: unknown; autoClearedBy?: unknown };
  return {
    auditId: row.id,
    tagId: Number(row.entityId),
    tagKey: typeof after.tagKey === "string" ? after.tagKey : null,
    action: row.action,
    autoClearedBy: typeof after.autoClearedBy === "string" ? after.autoClearedBy : null,
    actorId: row.actorId ?? null,
    changedAt: row.createdAt,
    signatureId,
  };
}
