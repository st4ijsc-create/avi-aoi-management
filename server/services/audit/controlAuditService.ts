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
import { sql, desc, asc, getTableName } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { controlAuditLog, type ControlAuditLog } from "../../../drizzle/schema";
import { canonicalize, GENESIS_HASH } from "../security/auditChain";
import { secPlatformEnabled } from "../security/policyGate";
import { hangKetQua } from "../../db/hangKetQua";

/** Kiểu db drizzle đã resolve (khớp getDb) — caller luôn truyền db non-null. */
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
// ILK-10 (doc 80 Phụ lục D §7.4) — recordAuditEvent giờ được gọi TỪ BÊN TRONG
// `db.transaction(async (tx) => { ... })` của caller (interlockRouter), để dòng
// audit và thay đổi cấu hình rule chung một transaction (cùng thất bại/cùng đậu).
// `DbOrTx` là idiom đã dùng ở server/db/hierarchy.ts, machineRecipe.ts,
// inspectionProgramService.ts — kiểu của tham số `tx` được SUY ra từ chính
// `Db["transaction"]` nên không cần tự khai lại kiểu PgTransaction.
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

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
 * Cột nội dung của MỘT dòng audit — R1b-2b-1 T11: rút nguyên văn từ thân `recordAuditEvent`, dùng CHUNG với `recordAuditEvents` ⇒ nội dung
 * hai đường giống hệt nhau.
 */
function cotAuditCua(e: AuditEventInput) {
  return {
    entityType: e.entityType,
    entityId: String(e.entityId),
    action: e.action,
    actorId: e.actorId ?? null,
    beforeJson: (e.before ?? null) as never,
    afterJson: (e.after ?? null) as never,
    reason: e.reason ?? null,
  };
}

/** Trường được băm của MỘT dòng (cùng chuẩn hoá với `cotAuditCua`; rút nguyên văn từ `recordAuditEvent`). */
function truongBamCua(e: AuditEventInput): AuditHashFields {
  return {
    entityType: e.entityType,
    entityId: String(e.entityId),
    action: e.action,
    actorId: e.actorId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    reason: e.reason ?? null,
  };
}

/** `hash` của hàng băm có id LỚN NHẤT (GENESIS khi chưa có). Bên gọi PHẢI đang giữ `AUDIT_CHAIN_LOCK`. */
async function hashCuoiTx(tx: DbOrTx): Promise<string> {
  const [prev] = await tx
    .select({ hash: controlAuditLog.hash })
    .from(controlAuditLog)
    .where(sql`${controlAuditLog.hash} IS NOT NULL`)
    .orderBy(desc(controlAuditLog.id))
    .limit(1);
  return prev?.hash ?? GENESIS_HASH;
}

/**
 * Ghi ĐÚNG MỘT dòng audit bất biến. Trả về dòng vừa ghi (hoặc null). Khi SEC_PLATFORM bật,
 * dòng được nối vào hash-chain (advisory-lock serialise); tắt → INSERT thường (hành vi cũ).
 */
export async function recordAuditEvent(db: DbOrTx, e: AuditEventInput): Promise<ControlAuditLog | null> {
  const base = cotAuditCua(e);

  if (!secPlatformEnabled()) {
    // Legacy plain append — byte-for-byte the old behavior.
    const [row] = await db.insert(controlAuditLog).values(base).returning();
    return row ?? null;
  }

  // Hash-chain append: serialise so the chain never forks under concurrency.
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`);
    const prevHash = await hashCuoiTx(tx);
    const hashTs = Date.now();
    const hash = computeAuditHash(prevHash, truongBamCua(e), hashTs);
    const [row] = await tx.insert(controlAuditLog).values({ ...base, prevHash, hash, hashTs }).returning();
    return row ?? null;
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// R1b-2b-1 Task 11 (mục 48, T6 m-1) — AUDIT THEO LÔ. `scadaKenh.khaiHangLoat` (≤ 200 tag) từng gọi `recordAuditEvent` 201 lần trong MỘT
// giao dịch: khoá chuỗi (`pg_advisory_xact_lock`, giữ tới COMMIT của giao dịch NGOÀI) bị lấy ở dòng audit ĐẦU rồi giữ suốt 200 vòng
// UPDATE + SELECT hash + INSERT còn lại ⇒ mọi bên ghi audit khác của toàn hệ thống xếp hàng chờ. Nay: MỘT lần đọc hash cuối, băm cả lô trong
// bộ nhớ (`xauChuoiAudit`, thuần), MỘT INSERT nhiều hàng, gọi CUỐI giao dịch (sau mọi khoá hàng).
//
// THỨ TỰ id ↔ chuỗi (phán quyết KD-T11 #1): KHÔNG dựa vào việc INSERT nhiều hàng cấp `serial` theo thứ tự VALUES (Postgres không cam kết điều
// đó). Dưới khoá chuỗi, cấp TRƯỚC n id bằng `nextval(<sequence của control_audit_log.id>)` trên `generate_series(1, n)`, SẮP TĂNG, gán id
// thứ i cho phần tử chuỗi thứ i và INSERT với id TƯỜNG MINH ⇒ thứ tự chuỗi = thứ tự id, đúng thứ `verifyAuditRows` kiểm. Mọi bên ghi hàng
// BĂM chỉ gọi nextval (mặc định cột, hoặc ở đây) khi ĐANG giữ khoá chuỗi, và khoá giữ tới COMMIT ⇒ không hàng băm nào của bên khác có id nằm
// giữa id của lô (lô = một khối liền trong chuỗi). id bỏ khi rollback chỉ là lỗ số — `verifyAuditRows` duyệt theo id, không đòi liền số.
//
// Kiểu tham số: INSERT … VALUES của drizzle nhắm cột đích có kiểu (Postgres ép VALUES của INSERT về kiểu cột đích, cả cột toàn NULL) và ánh
// xạ json / bigint qua CÙNG `mapToDriverValue` như `recordAuditEvent` ⇒ nội dung từng dòng y hệt đường đơn lẻ; không có VALUES "trôi" kiểu
// như ở `UPDATE … FROM (VALUES …)` (chỗ đó ép kiểu tường minh từng cột — `services/scada/khaiKenh.ts` `ghiKenhLoTx`).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Trần số dòng của MỘT `recordAuditEvents` (lô khai kênh ≤ 200 tag + 1 dòng tổng; dư cho bên gọi sau). */
export const TRAN_HANG_AUDIT_MOT_LO = 500;
/** Giao thức postgres: số tham số bind của MỘT câu lệnh là uint16 ⇒ phải < 65535. */
export const TRAN_THAM_SO_PG = 65_535;
/** Tham số bind của MỘT dòng trong INSERT audit theo lô (id, entityType, entityId, action, actorId, beforeJson, afterJson, reason, prevHash, hash, hashTs). */
export const SO_THAM_SO_MOT_HANG_AUDIT = 11;

export type LoGhiQuaTranReason = "audit_lo_qua_tran_hang" | "lo_qua_tran_tham_so";

/**
 * Lô ghi vượt trần — lỗi LẬP TRÌNH của bên gọi (bên gọi nghiệp vụ phải chặn trước bằng lỗi có mã cho người dùng, vd.
 * `QUA_NHIEU_KENH_DA_KHAI`). Lớp có kiểu theo khuôn `OpcuaConfigError` / `MelfaReplyError` (không `Error` trần — rawErrorCensus).
 */
export class LoGhiQuaTranError extends Error {
  readonly reasonCode: LoGhiQuaTranReason;
  readonly soHang: number;
  readonly toiDa: number;
  readonly soThamSo?: number;
  constructor(reasonCode: LoGhiQuaTranReason, message: string, o: { soHang: number; toiDa: number; soThamSo?: number }) {
    super(message);
    this.name = "LoGhiQuaTranError";
    this.reasonCode = reasonCode;
    this.soHang = o.soHang;
    this.toiDa = o.toiDa;
    if (o.soThamSo !== undefined) this.soThamSo = o.soThamSo;
  }
}

/** Ném `LoGhiQuaTranError(lo_qua_tran_tham_so)` khi `soHang × soThamSoMoiHang + soThamSoThem ≥ 65535` (trần giao thức postgres). */
export function kiemThamSoLo(soHang: number, soThamSoMoiHang: number, soThamSoThem = 0): void {
  const soThamSo = soHang * soThamSoMoiHang + soThamSoThem;
  if (soThamSo >= TRAN_THAM_SO_PG) {
    throw new LoGhiQuaTranError(
      "lo_qua_tran_tham_so",
      `Batch of ${soHang} rows needs ${soThamSo} bind parameters (postgres limit < ${TRAN_THAM_SO_PG}).`,
      { soHang, toiDa: Math.floor((TRAN_THAM_SO_PG - 1 - soThamSoThem) / soThamSoMoiHang), soThamSo },
    );
  }
}

/**
 * THUẦN — băm nối một lô vào chuỗi: phần tử 0 dùng `prevHash`, phần tử i dùng `hash` của phần tử i−1; MỌI phần tử cùng `hashTs`; băm bằng
 * `computeAuditHash` trên CÙNG trường như `recordAuditEvent`.
 */
export function xauChuoiAudit(prevHash: string, es: ReadonlyArray<AuditEventInput>, hashTs: number): Array<{ prevHash: string; hash: string }> {
  const ra: Array<{ prevHash: string; hash: string }> = [];
  let truoc = prevHash;
  for (const e of es) {
    const hash = computeAuditHash(truoc, truongBamCua(e), hashTs);
    ra.push({ prevHash: truoc, hash });
    truoc = hash;
  }
  return ra;
}

/** Cấp trước `n` id từ sequence của `control_audit_log.id`, SẮP TĂNG (xem khối chú thích trên). Bên gọi đang giữ `AUDIT_CHAIN_LOCK`. */
async function capIdAuditTx(tx: DbOrTx, n: number): Promise<number[]> {
  const rows = hangKetQua<{ id: unknown }>(
    await tx.execute(
      sql`SELECT nextval(pg_get_serial_sequence(${getTableName(controlAuditLog)}, ${controlAuditLog.id.name}))::int AS id FROM generate_series(1, ${n}::int)`,
    ),
  );
  return rows.map((r) => Number(r.id)).sort((a, b) => a - b);
}

/**
 * Ghi MỘT LÔ dòng audit bất biến bằng MỘT INSERT nhiều hàng; trả các hàng theo `id` TĂNG (SEC_PLATFORM bật: = thứ tự `es`).
 *   • `es` rỗng ⇒ `[]`, không chạm DB; > `TRAN_HANG_AUDIT_MOT_LO` ⇒ `LoGhiQuaTranError` (trước khi chạm DB); cổng tham số bind < 65535;
 *   • SEC_PLATFORM tắt ⇒ MỘT `INSERT … VALUES (…),(…) RETURNING` (hash NULL — như `recordAuditEvent` khi tắt);
 *   • bật ⇒ MỘT giao dịch con: `pg_advisory_xact_lock(AUDIT_CHAIN_LOCK)` → đọc `hash` cuối MỘT lần → `xauChuoiAudit` (MỘT `hashTs`) →
 *     cấp id tường minh → MỘT INSERT nhiều hàng. Lỗi ở bất kỳ đâu ⇒ cả lô (và giao dịch của bên gọi) rollback, chuỗi không đổi.
 * Bên gọi gọi hàm này CUỐI giao dịch (sau mọi khoá hàng) để khoá chuỗi bị giữ ngắn nhất.
 */
export async function recordAuditEvents(db: DbOrTx, es: ReadonlyArray<AuditEventInput>): Promise<ControlAuditLog[]> {
  if (es.length === 0) return [];
  if (es.length > TRAN_HANG_AUDIT_MOT_LO) {
    throw new LoGhiQuaTranError(
      "audit_lo_qua_tran_hang",
      `Audit batch of ${es.length} rows exceeds TRAN_HANG_AUDIT_MOT_LO (${TRAN_HANG_AUDIT_MOT_LO}).`,
      { soHang: es.length, toiDa: TRAN_HANG_AUDIT_MOT_LO },
    );
  }
  kiemThamSoLo(es.length, SO_THAM_SO_MOT_HANG_AUDIT);
  const theoId = (rows: ControlAuditLog[]) => [...rows].sort((a, b) => a.id - b.id);

  if (!secPlatformEnabled()) {
    return theoId(await db.insert(controlAuditLog).values(es.map(cotAuditCua)).returning());
  }

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`);
    const prevHash = await hashCuoiTx(tx);
    const hashTs = Date.now();
    const chuoi = xauChuoiAudit(prevHash, es, hashTs);
    const ids = await capIdAuditTx(tx, es.length);
    const rows = await tx
      .insert(controlAuditLog)
      .values(es.map((e, i) => ({ id: ids[i], ...cotAuditCua(e), prevHash: chuoi[i].prevHash, hash: chuoi[i].hash, hashTs })))
      .returning();
    return theoId(rows);
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
