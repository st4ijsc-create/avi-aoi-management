import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { eq, and, desc, asc, gte, lte, gt, lt, like, sql, or, isNull, isNotNull, inArray, SQL } from "drizzle-orm";
import {
  productInspections, InsertProductInspection,
  inspectionIdempotencyKeys,
  measurementResults, InsertMeasurementResult,
  measurementPointDefs,
  productModels,
  defectCatalog,
  alertHistory,
  mqttAlertHistory,
  machines,
  stations,
  productionLines,
  workshops,
  factories,
  // Pha 1B Task 5 (BG-11) — cây KẾT QUẢ 3 cấp, migration 0339/0340.
  inspectionSurfaces,
  inspectionPositions,
  inspectionCaptures,
} from "../../drizzle/schema";
import { getUserCorporateAssignments, getUserFactoryAssignments } from "./auth";
// ⚠ CHỈ nhập KIỂU (`import type`) — bị xoá lúc biên dịch, nên không tạo vòng import
// router → db → `_core/accessControl` → `_core/trpc`. Giá trị vẫn nạp qua `import()` động,
// đúng khuôn sẵn có trong file này.
import { UNSCOPED_LABELS, type ScopeEmptyReason, type ScopeLabels, scopeLabelsOf } from "../_core/accessControlLabels";
// Pha 1B Task 5 — bộ dịch THUẦN payload v2.0 → cây 4 cấp (Task 4). Type-only: không tạo
// phụ thuộc runtime vòng (ingestCayKetQua.ts không import ngược lại file này).
import type { CayDaDich, SurfaceDaDich, PositionDaDich, CaptureDaDich } from "../services/ingestCayKetQua";

// ============ LIST PROJECTION (doc 27 gap B9) ============
/**
 * Columns actually consumed by the LIST consumers of product_inspections
 * (inspection.list / inspection.listCursor / inspection.search →
 * History, Dashboard widgets, HistoryInfiniteScroll, drill-down, exports,
 * cachedStatistics). Heavy/detail-only columns are deliberately NOT read on
 * these hot paths: notes, tags, ntfConfirmedBy/At, ntfReason, isArchived,
 * archivedAt/By, aiConfidence, aiModelId, aiProcessedAt, aiDetails (json),
 * inspectionType, variantPayload (jsonb), operatorId, productionOrderCode,
 * ingestMode, updatedAt. Detail views (inspection.getById) keep full rows.
 */
export const inspectionListProjection = {
  id: productInspections.id,
  machineId: productInspections.machineId,
  productModelId: productInspections.productModelId,
  corporateCode: productInspections.corporateCode,
  factoryCode: productInspections.factoryCode,
  workshopCode: productInspections.workshopCode,
  lineCode: productInspections.lineCode,
  stageCode: productInspections.stageCode,
  serialNumber: productInspections.serialNumber,
  productModel: productInspections.productModel,
  batchNumber: productInspections.batchNumber,
  overallResult: productInspections.overallResult,
  originalResult: productInspections.originalResult,
  inspectionTime: productInspections.inspectionTime,
  cycleTime: productInspections.cycleTime,
  acknowledgedBy: productInspections.acknowledgedBy,
  acknowledgedAt: productInspections.acknowledgedAt,
  aiDecision: productInspections.aiDecision,
  // W7-B (doc 27 V3): heuristic false-call likelihood — History queue sort +
  // "Nghi báo giả" badge read it from the list projection (advisory only).
  ntfScore: productInspections.ntfScore,
  createdAt: productInspections.createdAt,
} as const;

/** Row shape returned by the projected list reads. */
export type InspectionListRow = Pick<
  typeof productInspections.$inferSelect,
  keyof typeof inspectionListProjection
>;

// ============ PRODUCT INSPECTION FUNCTIONS ============

/**
 * Doc 51 P0 (R2) — OPTIONAL out-param of {@link createProductInspection}.
 *
 * WHY an out-param and not a richer return type: `createProductInspection` is
 * called by ~20 seeds/tests/analytics fixtures that all consume `Promise<number>`.
 * Widening the return would churn every one of them; the ingest path is the ONLY
 * caller that needs to know an insert was swallowed by the idempotency index.
 * Pass an object, read `.duplicate` after the await. Callers that don't care stay
 * byte-for-byte unchanged.
 */
export interface CreateInspectionOutcome {
  /**
   * true ⇒ the row ALREADY existed (natural key uq_inspections_machine_serial_time
   * from 0272, or — doc 51 P1 — the explicit idempotency ledger from 0275) and the
   * returned id is the ORIGINAL row's — the caller MUST skip every side-effect
   * (order quantities, ERP outbox, NG alerts, measurement inserts), otherwise the
   * de-duplication is pointless.
   */
  duplicate: boolean;
}

/**
 * Minimal surface of a drizzle db/tx handle used by the insert helpers below, so
 * the SAME code runs on the pooled handle and inside a transaction.
 */
type InsertRunner = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "insert" | "select">;

/**
 * Doc 51 P0 (R2) — the idempotent header insert, shared by both paths below.
 *
 * ON CONFLICT DO NOTHING with NO conflict target: ANY unique violation (in
 * practice uq_inspections_machine_serial_time, the partial natural key from
 * migration 0272) returns zero rows instead of throwing. Inert when the index is
 * absent — then nothing ever conflicts and this behaves exactly like a plain
 * insert. On conflict, resolves the EXISTING row (lowest id = the original) so
 * the machine gets the same inspectionId back.
 */
async function insertInspectionHeader(
  runner: InsertRunner,
  data: InsertProductInspection,
): Promise<{ id: number; duplicate: boolean }> {
  const inserted = await runner
    .insert(productInspections)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: productInspections.id });

  const newId: number | undefined = inserted[0]?.id;
  if (newId !== undefined) return { id: newId, duplicate: false };

  const existing = await runner
    .select({ id: productInspections.id })
    .from(productInspections)
    .where(and(
      eq(productInspections.machineId, data.machineId),
      eq(productInspections.serialNumber, data.serialNumber),
      eq(productInspections.inspectionTime, data.inspectionTime as Date),
    ))
    .orderBy(asc(productInspections.id))
    .limit(1);
  const existingId: number | undefined = existing[0]?.id;
  if (existingId === undefined) {
    // Conflicted on something OTHER than the natural key (or the row vanished
    // between the two statements). Never invent an id — fail loudly; the ingest
    // path treats this as transient and buffers to the WAL.
    throw new Error(
      `createProductInspection: insert conflicted but no existing row for ` +
        `(machineId=${data.machineId}, serialNumber=${data.serialNumber}, ` +
        `inspectionTime=${String(data.inspectionTime)})`,
    );
  }
  return { id: existingId, duplicate: true };
}

/** `undefined` khi máy không khai (ISO string) — Date khi có. `''`/thiếu trường ⇒ undefined. */
function toDateOrUndefined(iso: string | undefined): Date | undefined {
  return iso === undefined ? undefined : new Date(iso);
}

/**
 * Cấp 1 (Pha 1B Task 5, BG-11) — ghi/khử-trùng MỘT `inspection_surfaces`. `ON CONFLICT DO
 * NOTHING` theo `uq_insp_surfaces_inspection_name` (migration 0340): gửi lại cùng bo ⇒
 * KHÔNG hàng mới, SELECT lại hàng đã có để lấy `id` làm cha cho các position. Cùng khuôn
 * `insertInspectionHeader` phía trên — một chỗ sửa nếu khuôn đổi.
 */
async function upsertInspectionSurface(
  runner: InsertRunner,
  inspectionId: number,
  inspectionTime: Date,
  s: SurfaceDaDich,
): Promise<number> {
  const inserted = await runner
    .insert(inspectionSurfaces)
    .values({
      inspectionId,
      inspectionTime,
      surfaceName: s.surfaceName,
      // QĐ-BG6: KHÔNG ghi surfaceExtId ở đường ingest kết quả — chỉ điền từ đồng bộ teach
      // data (Khối B, pha sau). Không đặt key ⇒ cột giữ NULL mặc định.
      result: s.result,
      ntf: s.ntf,
      ntfSource: s.ntfSource,
      rolledResult: s.rolledResult,
      rolledNtf: s.rolledNtf,
      declaredMismatch: s.declaredMismatch,
    })
    .onConflictDoNothing()
    .returning({ id: inspectionSurfaces.id });

  const newId = inserted[0]?.id;
  if (newId !== undefined) return newId;

  const existing = await runner
    .select({ id: inspectionSurfaces.id })
    .from(inspectionSurfaces)
    .where(and(
      eq(inspectionSurfaces.inspectionId, inspectionId),
      eq(inspectionSurfaces.surfaceName, s.surfaceName),
    ))
    .limit(1);
  const existingId = existing[0]?.id;
  if (existingId === undefined) {
    throw new Error(
      `ghiCayKetQua: surface "${s.surfaceName}" xung đột ở uq_insp_surfaces_inspection_name ` +
        `nhưng không tìm lại được hàng đã có (inspectionId=${inspectionId}) — bất thường.`,
    );
  }
  return existingId;
}

/**
 * Cấp 2 — ghi/khử-trùng MỘT `inspection_positions`. `ON CONFLICT DO NOTHING` theo
 * `uq_insp_positions_surface_posid` (migration 0340).
 */
async function upsertInspectionPosition(
  runner: InsertRunner,
  surfaceRowId: number,
  inspectionId: number,
  inspectionTime: Date,
  p: PositionDaDich,
): Promise<number> {
  const inserted = await runner
    .insert(inspectionPositions)
    .values({
      surfaceRowId,
      inspectionId,
      inspectionTime,
      positionId: p.positionId,
      positionNumber: p.positionNumber,
      result: p.result,
      ntf: p.ntf,
      ntfSource: p.ntfSource,
      rolledResult: p.rolledResult,
      rolledNtf: p.rolledNtf,
      declaredMismatch: p.declaredMismatch,
      startedAt: toDateOrUndefined(p.startedAt),
      completedAt: toDateOrUndefined(p.completedAt),
    })
    .onConflictDoNothing()
    .returning({ id: inspectionPositions.id });

  const newId = inserted[0]?.id;
  if (newId !== undefined) return newId;

  const existing = await runner
    .select({ id: inspectionPositions.id })
    .from(inspectionPositions)
    .where(and(
      eq(inspectionPositions.surfaceRowId, surfaceRowId),
      eq(inspectionPositions.positionId, p.positionId),
    ))
    .limit(1);
  const existingId = existing[0]?.id;
  if (existingId === undefined) {
    throw new Error(
      `ghiCayKetQua: position "${p.positionId}" xung đột ở uq_insp_positions_surface_posid ` +
        `nhưng không tìm lại được hàng đã có (surfaceRowId=${surfaceRowId}) — bất thường.`,
    );
  }
  return existingId;
}

/**
 * Cấp 3 — ghi/khử-trùng MỘT `inspection_captures`. `ON CONFLICT DO NOTHING` theo
 * `uq_insp_captures_position_extid` (migration 0339). Đây là cấp mà `measurement_results.
 * inspectionCaptureRowId` (0340) sẽ trỏ tới — id trả về ở đây LÀ giá trị đường ingest thật
 * (Task 6) sẽ gán vào cột đó, KHÔNG phải `product_captures.id` (cây CẤU HÌNH, dãy id khác).
 */
async function upsertInspectionCapture(
  runner: InsertRunner,
  positionRowId: number,
  inspectionId: number,
  inspectionTime: Date,
  c: CaptureDaDich,
): Promise<number> {
  const inserted = await runner
    .insert(inspectionCaptures)
    .values({
      positionRowId,
      inspectionId,
      inspectionTime,
      captureExtId: c.captureId,
      captureName: c.captureName,
      captureIndex: c.index,
      result: c.result,
      ntf: c.ntf,
      ntfSource: c.ntfSource,
      rolledResult: c.rolledResult,
      rolledNtf: c.rolledNtf,
      declaredMismatch: c.declaredMismatch,
      startedAt: toDateOrUndefined(c.startedAt),
      completedAt: toDateOrUndefined(c.completedAt),
    })
    .onConflictDoNothing()
    .returning({ id: inspectionCaptures.id });

  const newId = inserted[0]?.id;
  if (newId !== undefined) return newId;

  const existing = await runner
    .select({ id: inspectionCaptures.id })
    .from(inspectionCaptures)
    .where(and(
      eq(inspectionCaptures.positionRowId, positionRowId),
      eq(inspectionCaptures.captureExtId, c.captureId),
    ))
    .limit(1);
  const existingId = existing[0]?.id;
  if (existingId === undefined) {
    throw new Error(
      `ghiCayKetQua: capture "${c.captureId}" xung đột ở uq_insp_captures_position_extid ` +
        `nhưng không tìm lại được hàng đã có (positionRowId=${positionRowId}) — bất thường.`,
    );
  }
  return existingId;
}

/**
 * Pha 1B Task 5 (BG-11 ⛔, §3.6) — ghi CÂY 3 cấp `surface → position → capture` đã dịch
 * bởi `dichCayKetQua` (Task 4, `server/services/ingestCayKetQua.ts`) vào ba bảng cây.
 * KHÔNG ghi cấp component/measurement — cấp đó thuộc `measurement_results` hiện có, ghi
 * bởi CÙNG transaction ở caller (xem `persistInspectionAtomic` — truyền `opts.cay` để tự
 * gọi hàm này bằng đúng `tx` của nó, KHÔNG mở transaction riêng).
 *
 * ⚠ BẮT BUỘC chạy trong CÙNG transaction với việc ghi header `product_inspections` — nếu
 * ghi ở một lượt riêng, một lỗi giữa chừng (mất kết nối, vi phạm ràng buộc ở position/
 * capture sau) để lại bo có header mà không có cây: đúng lớp mồ côi §3.6 phải dọn, không
 * phải giả thuyết — `persistInspectionAtomic` gọi hàm này TRƯỚC KHI trả về, bên trong
 * `db.transaction()` của chính nó.
 *
 * Khử trùng (BG-11): mỗi cấp `INSERT ... ON CONFLICT DO NOTHING` theo đúng unique index
 * của migration 0340/0339, rồi SELECT lại hàng đã có khi bị conflict. Gửi lại một bo
 * (retry mạng, hoặc hành vi "replay = duplicate" máy đã ghi nhận ở doc 61) không tạo thêm
 * hàng ở BẤT KỲ cấp nào trong ba cấp — số hàng sau lượt hai bằng đúng số hàng sau lượt một.
 *
 * `inspectionTime` được truyền RIÊNG (không đọc từ `cay`) vì `CayDaDich` không mang mốc
 * thời gian của bo — đúng thiết kế "sao thời gian xuống mọi cấp" của migration 0339: caller
 * (đã có `data.inspectionTime` cho header) truyền lại y nguyên xuống đây.
 */
export async function ghiCayKetQua(
  runner: InsertRunner,
  inspectionId: number,
  inspectionTime: Date,
  cay: CayDaDich,
): Promise<void> {
  for (const surface of cay.surfaces) {
    const surfaceRowId = await upsertInspectionSurface(runner, inspectionId, inspectionTime, surface);
    for (const position of surface.positions) {
      const positionRowId = await upsertInspectionPosition(
        runner, surfaceRowId, inspectionId, inspectionTime, position,
      );
      for (const capture of position.captures) {
        await upsertInspectionCapture(runner, positionRowId, inspectionId, inspectionTime, capture);
      }
    }
  }
}

export async function createProductInspection(
  data: InsertProductInspection,
  outcome?: CreateInspectionOutcome,
) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const idempotencyKey = data.idempotencyKey?.trim() || undefined;

  let id: number;
  let duplicate: boolean;

  if (idempotencyKey) {
    // ══ Doc 51 P1 — EXPLICIT IDEMPOTENCY KEY (closes the 0272 hole) ═════════
    // 0272's natural key needs inspectionTime; a machine that omits it gets a
    // fresh now() per retry ⇒ a different key per retry ⇒ no protection at all.
    // A client-generated key is stable across retries, but CANNOT be a unique
    // index on product_inspections (Timescale hypertable — every unique index
    // must carry the partition column inspectionTime; see the ledger's doc
    // comment in drizzle/schema/inspection.ts). So the constraint lives in the
    // plain ledger table and the two writes are made atomic here.
    //
    // Ordering is deliberate: CLAIM FIRST. Postgres' ON CONFLICT DO NOTHING
    // waits on an in-flight conflicting insert before deciding, so two
    // concurrent retries of the same key serialise — the loser sees the winner's
    // COMMITTED row (inspectionId already back-filled in the same transaction)
    // and reports duplicate. A crash mid-way rolls the claim back with the
    // header, so a lost board never leaves a poisoned key behind.
    ({ id, duplicate } = await db.transaction(async (tx) => {
      const claimed = await tx
        .insert(inspectionIdempotencyKeys)
        .values({
          machineId: data.machineId,
          idempotencyKey,
          inspectionTime: (data.inspectionTime as Date | undefined) ?? null,
        })
        .onConflictDoNothing()
        .returning({ machineId: inspectionIdempotencyKeys.machineId });

      if (claimed.length === 0) {
        // Key already used by a COMMITTED submission → this is a retry.
        const prior = await tx
          .select({ inspectionId: inspectionIdempotencyKeys.inspectionId })
          .from(inspectionIdempotencyKeys)
          .where(and(
            eq(inspectionIdempotencyKeys.machineId, data.machineId),
            eq(inspectionIdempotencyKeys.idempotencyKey, idempotencyKey),
          ))
          .limit(1);
        const priorId = prior[0]?.inspectionId;
        if (priorId == null) {
          // A committed claim with no inspectionId breaks the write protocol's
          // invariant. Never invent an id — throw; the ingest path treats this
          // as transient and buffers to the WAL.
          throw new Error(
            `createProductInspection: idempotency key claimed but unresolved ` +
              `(machineId=${data.machineId}, idempotencyKey=${idempotencyKey})`,
          );
        }
        return { id: priorId, duplicate: true };
      }

      // We own the key. The header can STILL collide on 0272's natural key (same
      // serial+time re-sent under a NEW idempotency key) — then we point this
      // key at the original row and report duplicate, which is exactly right.
      const header = await insertInspectionHeader(tx, data);
      await tx
        .update(inspectionIdempotencyKeys)
        .set({ inspectionId: header.id })
        .where(and(
          eq(inspectionIdempotencyKeys.machineId, data.machineId),
          eq(inspectionIdempotencyKeys.idempotencyKey, idempotencyKey),
        ));
      return header;
    }));
  } else {
    // No explicit key → 0272 natural-key protection only. Byte-for-byte the P0
    // behaviour (single statement, no transaction) for the ~20 seed/test/
    // analytics callers and every machine that hasn't adopted the key yet.
    ({ id, duplicate } = await insertInspectionHeader(db, data));
  }

  if (outcome) outcome.duplicate = duplicate;

  // Doc 38 T-1 (P0 #3) — an inspection submit is also machine "activity". Feed the
  // downtime auto-detector so machines that report only via inspection (no separate
  // heartbeat) still avoid false-positive downtime. Fire-and-forget + dynamic import
  // (avoids a db⇄service require cycle); inert unless DOWNTIME_DETECTION_ENABLED.
  if (typeof data.machineId === "number") {
    const mid = data.machineId;
    void import("../services/downtimeDetectionService")
      .then((m) => m.recordMachineActivity(mid))
      .catch(() => {});
  }

  return id;
}

/**
 * Doc 55 Item 1 (PA-A "reserve-id") — reserve a product_inspections surrogate id
 * from its sequence WITHOUT inserting a row.
 *
 * THIS is what makes a single physical transaction reachable from the ingest path
 * (see the deleteInspectionForCompensation doc-comment below for why it was NOT,
 * before): the measurement images are stored under object keys that EMBED the
 * inspection id, and those uploads must stay OUTSIDE any DB transaction — so the id
 * has to exist before the header row does. `serial("id")` (drizzle/schema/
 * inspection.ts) owns the sequence product_inspections_id_seq; nextval advances it
 * atomically and never hands the same value to two callers, so concurrent
 * reservations can never collide. A reserved id that is never inserted (a
 * duplicate, or a rolled-back tx) simply leaves a GAP — sequences are explicitly
 * allowed to, and every downstream reader keys off the row, never off contiguity.
 *
 * On a Timescale hypertable the column's sequence still exists and behaves
 * identically (verified on the dev/test DB). Returns a plain positive integer
 * (nextval comes back as a bigint string over postgres-js → coerced + validated).
 */
export async function reserveInspectionId(): Promise<number> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const res = await db.execute(sql`SELECT nextval('product_inspections_id_seq') AS id`);
  const rows = ((res as { rows?: unknown[] })?.rows ?? (res as unknown[])) as Array<{ id?: unknown }>;
  const raw = rows?.[0]?.id;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`reserveInspectionId: unexpected nextval result ${String(raw)}`);
  }
  return id;
}

/**
 * Doc 55 Item 1 (PA-A) — persist an inspection HEADER together with its measurement
 * rows (and the optional spec-gate overall→NG promotion) in ONE physical
 * transaction, closing the two-phase crash window that leaves an EMPTY header (the
 * gap the OFF-path deleteInspectionForCompensation below only *mitigates*).
 *
 * `data.id` MUST be a caller-reserved id (reserveInspectionId) — the SAME id the
 * caller already embedded in the pre-uploaded image object keys AND in every
 * `measurementRows[i].inspectionId` — so header, measurements and images all agree.
 *
 * Dedup semantics are byte-for-byte IDENTICAL to createProductInspection (they MUST
 * be — the WAL replay + machine-retry short-circuit depend on it):
 *   • idempotencyKey present → CLAIM the ledger (0275) FIRST. Claim lost ⇒ this is a
 *     retry: return the PRIOR row's id, duplicate=true, and write NO measurements.
 *   • header still natural-key-collides (0272: same serial+time, possibly under a
 *     NEW key) ⇒ point the key at the ORIGINAL row, duplicate=true, write NO
 *     measurements (they belong to the row that already exists).
 *   • genuinely new board ⇒ insert measurements + promote + back-fill the ledger id,
 *     ALL inside the same tx, duplicate=false.
 *
 * On duplicate the caller MUST skip every side-effect (order qty, ERP outbox, NG
 * alerts) exactly as with createProductInspection's duplicate short-circuit.
 * `opts.outcome.duplicate` is set for the out-param contract callers already use.
 *
 * Pha 1B Task 5 (BG-11 ⛔) — `opts.cay`: khi có, gọi `ghiCayKetQua` bằng ĐÚNG `tx` của
 * transaction này (KHÔNG mở transaction riêng) NGAY SAU khi ghi measurements, chỉ trên
 * nhánh board MỚI (không phải duplicate — cây của board gốc coi như đã có, giống hệt lý do
 * measurementRows cũng bị bỏ qua trên nhánh duplicate). Đây là cách DUY NHẤT hàm này và
 * `ghiCayKetQua` chia sẻ một transaction vật lý: nếu ghi cây ở một lượt riêng sau khi hàm
 * này trả về, một lỗi giữa chừng để lại bo có header mà không có cây (mồ côi §3.6).
 */
export async function persistInspectionAtomic(
  data: InsertProductInspection & { id: number },
  measurementRows: InsertMeasurementResult[],
  opts?: { promoteOverallToNg?: boolean; outcome?: CreateInspectionOutcome; cay?: CayDaDich },
): Promise<{ id: number; duplicate: boolean }> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const idempotencyKey = data.idempotencyKey?.trim() || undefined;

  const { id, duplicate } = await db.transaction(async (tx) => {
    // ── 1) LEDGER CLAIM (only when the machine sent an explicit key) ───────────
    // Same protocol + ordering as createProductInspection: CLAIM FIRST so two
    // concurrent retries of one key serialise and the loser reports duplicate.
    if (idempotencyKey) {
      const claimed = await tx
        .insert(inspectionIdempotencyKeys)
        .values({
          machineId: data.machineId,
          idempotencyKey,
          inspectionTime: (data.inspectionTime as Date | undefined) ?? null,
        })
        .onConflictDoNothing()
        .returning({ machineId: inspectionIdempotencyKeys.machineId });

      if (claimed.length === 0) {
        // Key already used by a COMMITTED submission → retry. Resolve its row.
        const prior = await tx
          .select({ inspectionId: inspectionIdempotencyKeys.inspectionId })
          .from(inspectionIdempotencyKeys)
          .where(and(
            eq(inspectionIdempotencyKeys.machineId, data.machineId),
            eq(inspectionIdempotencyKeys.idempotencyKey, idempotencyKey),
          ))
          .limit(1);
        const priorId = prior[0]?.inspectionId;
        if (priorId == null) {
          throw new Error(
            `persistInspectionAtomic: idempotency key claimed but unresolved ` +
              `(machineId=${data.machineId}, idempotencyKey=${idempotencyKey})`,
          );
        }
        return { id: priorId, duplicate: true };
      }
    }

    // ── 2) HEADER (natural-key idempotent, 0272) ───────────────────────────────
    // We own the key (or there is none). The header can STILL collide on the
    // natural key (same serial+time under a NEW key) — then point the key at the
    // original row and report duplicate, exactly like createProductInspection.
    const header = await insertInspectionHeader(tx, data);

    if (header.duplicate) {
      if (idempotencyKey) {
        await tx
          .update(inspectionIdempotencyKeys)
          .set({ inspectionId: header.id })
          .where(and(
            eq(inspectionIdempotencyKeys.machineId, data.machineId),
            eq(inspectionIdempotencyKeys.idempotencyKey, idempotencyKey),
          ));
      }
      return { id: header.id, duplicate: true };
    }

    // ── 3) NEW board → MEASUREMENTS + overall-NG promotion IN THE SAME TX ───────
    // THE point of PA-A: if either write throws, the WHOLE tx (header + ledger
    // claim + measurements + promotion) rolls back, so a retry re-inserts a
    // COMPLETE board instead of the P0 short-circuit resolving to an empty header.
    if (measurementRows.length > 0) {
      await tx.insert(measurementResults).values(measurementRows);
    }
    // Pha 1B Task 5 (BG-11) — cây kết quả, CÙNG tx với header + measurements ở trên.
    if (opts?.cay) {
      await ghiCayKetQua(tx, header.id, data.inspectionTime as Date, opts.cay);
    }
    if (opts?.promoteOverallToNg) {
      await tx
        .update(productInspections)
        .set({ overallResult: "NG", updatedAt: new Date() })
        .where(and(
          eq(productInspections.id, header.id),
          eq(productInspections.overallResult, "OK"),
        ));
    }
    // ── 4) BACK-FILL the ledger claim with the header id ───────────────────────
    if (idempotencyKey) {
      await tx
        .update(inspectionIdempotencyKeys)
        .set({ inspectionId: header.id })
        .where(and(
          eq(inspectionIdempotencyKeys.machineId, data.machineId),
          eq(inspectionIdempotencyKeys.idempotencyKey, idempotencyKey),
        ));
    }
    return { id: header.id, duplicate: false };
  });

  if (opts?.outcome) opts.outcome.duplicate = duplicate;

  // Parity with createProductInspection — an inspection submit is also machine
  // "activity" for the downtime auto-detector. Fire-and-forget + dynamic import;
  // inert unless DOWNTIME_DETECTION_ENABLED. Kept identical so the single-tx path
  // does not silently drop the heartbeat-less-machine downtime feed.
  if (typeof data.machineId === "number") {
    const mid = data.machineId;
    void import("../services/downtimeDetectionService")
      .then((m) => m.recordMachineActivity(mid))
      .catch(() => {});
  }

  return { id, duplicate };
}

/**
 * Doc 51 P2 (§11.2 residual #1) — COMPENSATE an orphaned inspection header.
 *
 * THE RESIDUAL P1 GAP: createProductInspection commits the header in its own
 * transaction; the measurement rows are then written in a SEPARATE transaction by
 * the ingest router. If that second transaction fails, the header is already
 * committed — an EMPTY inspection — and the P0 duplicate short-circuit means a
 * retry resolves to that empty header and never writes the measurements.
 *
 * A single physical transaction spanning both writes is not reachable from the
 * ingest path (the image object-storage uploads that populate the measurement
 * rows must stay OUTSIDE any DB transaction, and they are keyed by the header's
 * generated id — so the header must be inserted first to obtain the id). This
 * helper instead COMPENSATES: when the measurement transaction throws, the caller
 * deletes the just-created header so the next retry re-inserts a COMPLETE board
 * (header + measurements) rather than short-circuiting to the empty one.
 *
 * It also removes the idempotency-ledger claim (0275) for the same key: the claim
 * points at the header we are deleting, so leaving it would make every retry
 * resolve to a now-nonexistent id. Best-effort, transactional, never throws for a
 * missing ledger/row; the ONLY id deleted is the one passed in.
 *
 * ⚠ Residual after compensation: a process crash in the window between the header
 * commit and this delete still leaves an empty header (documented; the crash-safe
 * fix is a schema/flow change tracked in the P2 report). This closes the dominant
 * failure mode — a measurement-write error while the process is alive.
 */
export async function deleteInspectionForCompensation(params: {
  inspectionId: number;
  machineId: number;
  idempotencyKey?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const key = params.idempotencyKey?.trim() || undefined;
  await db.transaction(async (tx) => {
    // measurement_results has an ON DELETE CASCADE FK to product_inspections (when
    // not on a hypertable); explicitly clear them too so the delete is clean under
    // the hypertable path where the FK is skipped (see schema file header).
    await tx.delete(measurementResults).where(eq(measurementResults.inspectionId, params.inspectionId));
    await tx.delete(productInspections).where(eq(productInspections.id, params.inspectionId));
    if (key) {
      await tx
        .delete(inspectionIdempotencyKeys)
        .where(and(
          eq(inspectionIdempotencyKeys.machineId, params.machineId),
          eq(inspectionIdempotencyKeys.idempotencyKey, key),
        ));
    }
  });
}

export async function getProductInspections(filters: {
  machineId?: number;
  corporateCode?: string;
  factoryCode?: string;
  serialNumber?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  const conditions = [];
  if (filters.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));
  if (filters.corporateCode) conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  if (filters.factoryCode) conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  if (filters.serialNumber) conditions.push(like(productInspections.serialNumber, `%${filters.serialNumber}%`));
  if (filters.result) conditions.push(eq(productInspections.overallResult, filters.result));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    const factoryAssignments = await getUserFactoryAssignments(filters.userId);
    
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const accessConditions = [];
      if (corporateAssignments.length > 0) {
        const corporateCodes = corporateAssignments.map(a => a.corporateCode);
        accessConditions.push(inArray(productInspections.corporateCode, corporateCodes));
      }
      if (factoryAssignments.length > 0) {
        const factoryCodes = factoryAssignments.map(a => a.factoryCode);
        accessConditions.push(inArray(productInspections.factoryCode, factoryCodes));
      }
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions));
      } else {
        // User has no assignments, return empty result
        return { data: [], total: 0 };
      }
    } else {
      // User has no assignments, return empty result
      return { data: [], total: 0 };
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    // Projected hot-path read (gap B9) — see inspectionListProjection.
    db.select(inspectionListProjection).from(productInspections)
      .where(whereClause)
      .orderBy(desc(productInspections.inspectionTime))
      .limit(filters.limit || 50)
      .offset(filters.offset || 0),
    db.select({ count: sql<number>`count(*)` }).from(productInspections).where(whereClause)
  ]);

  return { data, total: countResult[0]?.count || 0 };
}

export async function getProductInspectionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productInspections).where(eq(productInspections.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get inspection by ID with joined machine/line/station/workshop/factory names
 * Used by pdfReportRouter for rich inspection report data
 */
export async function getInspectionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select({
      id: productInspections.id,
      machineId: productInspections.machineId,
      productModelId: productInspections.productModelId,
      corporateCode: productInspections.corporateCode,
      factoryCode: productInspections.factoryCode,
      serialNumber: productInspections.serialNumber,
      overallResult: productInspections.overallResult,
      inspectionTime: productInspections.inspectionTime,
      cycleTime: productInspections.cycleTime,
      notes: productInspections.notes,
      acknowledgedBy: productInspections.acknowledgedBy,
      acknowledgedAt: productInspections.acknowledgedAt,
      createdAt: productInspections.createdAt,
      machineCode: machines.code,
      machineName: machines.name,
      stationName: stations.name,
      lineName: productionLines.name,
      workshopName: workshops.name,
      factoryName: factories.name,
    })
    .from(productInspections)
    .leftJoin(machines, eq(productInspections.machineId, machines.id))
    .leftJoin(stations, eq(machines.stationId, stations.id))
    .leftJoin(productionLines, eq(stations.lineId, productionLines.id))
    .leftJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .leftJoin(factories, eq(workshops.factoryId, factories.id))
    .where(eq(productInspections.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function updateProductInspectionNTF(id: number, userId: number, reason: string) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  await db.update(productInspections).set({
    overallResult: "NTF",
    ntfConfirmedBy: userId,
    ntfConfirmedAt: new Date(),
    ntfReason: reason
  }).where(eq(productInspections.id, id));
}

/**
 * Doc 31 MP6 — server spec-gate reconciliation. When the per-point evaluator
 * (pointResultEvaluator) downgraded at least one point to NG on an inspection
 * the machine reported OK, promote overallResult to NG so board yield/FPY stays
 * consistent with the per-point verdicts. Only touches rows STILL recorded OK
 * (never overrides a machine NG/NTF); leaves `originalResult` = the machine's
 * original verdict intact for audit. Best-effort — returns whether it changed a row.
 */
export async function reconcileInspectionOverallNG(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(productInspections)
    .set({ overallResult: "NG", updatedAt: new Date() })
    .where(and(eq(productInspections.id, id), eq(productInspections.overallResult, "OK")))
    .returning({ id: productInspections.id });
  return rows.length > 0;
}

/**
 * Bulk-acknowledge inspections (doc 27 gap F1).
 *
 * Stamps acknowledgedBy/acknowledgedAt on the requested rows. Idempotent:
 * rows that are already acknowledged are left untouched (first acknowledger
 * wins) and reported separately so callers can give an honest count. Ids that
 * match no row are simply not counted.
 */
export async function bulkAcknowledgeInspections(params: {
  ids: number[];
  userId: number;
}): Promise<{ updatedIds: number[]; alreadyAcknowledgedIds: number[] }> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  if (params.ids.length === 0) return { updatedIds: [], alreadyAcknowledgedIds: [] };

  const now = new Date();
  const updated = await db
    .update(productInspections)
    .set({
      acknowledgedBy: params.userId,
      acknowledgedAt: now,
      updatedAt: now,
    })
    .where(and(
      inArray(productInspections.id, params.ids),
      isNull(productInspections.acknowledgedAt),
    ))
    .returning({ id: productInspections.id });

  const updatedIds = updated.map((r) => r.id);
  const updatedSet = new Set(updatedIds);
  // Whatever was requested but not updated is either already acknowledged or nonexistent.
  const remaining = params.ids.filter((id) => !updatedSet.has(id));
  let alreadyAcknowledgedIds: number[] = [];
  if (remaining.length > 0) {
    const rows = await db
      .select({ id: productInspections.id })
      .from(productInspections)
      .where(and(
        inArray(productInspections.id, remaining),
        isNotNull(productInspections.acknowledgedAt),
      ));
    alreadyAcknowledgedIds = rows.map((r) => r.id);
  }

  return { updatedIds, alreadyAcknowledgedIds };
}

// ============ MEASUREMENT RESULT FUNCTIONS ============
export async function createMeasurementResult(data: InsertMeasurementResult) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const [result] = await db.insert(measurementResults).values(data).returning({ id: measurementResults.id });
  return result.id;
}

export async function createMeasurementResults(dataList: InsertMeasurementResult[]) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  if (dataList.length === 0) return;
  await db.insert(measurementResults).values(dataList);
}

export async function getMeasurementResultsByInspection(inspectionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: measurementResults.id,
    inspectionId: measurementResults.inspectionId,
    pointDefId: measurementResults.pointDefId,
    measuredValue: measurementResults.measuredValue,
    measuredValueText: measurementResults.measuredValueText,
    result: measurementResults.result,
    imageUrl: measurementResults.imageUrl,
    imageKey: measurementResults.imageKey,
    remark: measurementResults.remark,
    aiAnalysisResult: measurementResults.aiAnalysisResult,
    aiConfidence: measurementResults.aiConfidence,
    aiComparisonScore: measurementResults.aiComparisonScore,
    createdAt: measurementResults.createdAt,
    // Defect classification (NG → defect-code link)
    defectCatalogId: measurementResults.defectCatalogId,
    defectSeverity: measurementResults.defectSeverity,
    // Doc 31 OP3 — raw code retained when it did NOT resolve to a catalog row.
    defectCodeRaw: measurementResults.defectCodeRaw,
    defectCode: defectCatalog.code,
    defectName: defectCatalog.name,
    defectNameVi: defectCatalog.nameVi,
    // Doc 31 OP4 — repair guidance surfaced at RepairStation / InspectionDetail.
    repairGuidance: defectCatalog.repairGuidance,
    repairGuidanceVi: defectCatalog.repairGuidanceVi,
    // Point def info
    pointCode: measurementPointDefs.code,
    pointName: measurementPointDefs.name,
    // Product info
    productModelId: measurementPointDefs.productModelId,
    productCode: productModels.code,
    productName: productModels.name,
  }).from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productModels, eq(measurementPointDefs.productModelId, productModels.id))
    .leftJoin(defectCatalog, eq(measurementResults.defectCatalogId, defectCatalog.id))
    .where(eq(measurementResults.inspectionId, inspectionId))
    .orderBy(measurementResults.id);
}

export async function getMeasurementResultById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementResults).where(eq(measurementResults.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateMeasurementResultRemark(id: number, remark: string) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  await db.update(measurementResults).set({ remark }).where(eq(measurementResults.id, id));
}

// ============ CURSOR-BASED PAGINATION HELPERS ============

export interface CursorPaginationResult<T> {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  totalCount?: number;
  /**
   * ⚠ 2026-08-17 — TRẠNG THÁI RỖNG TRUNG THỰC. `data: []` của một tài khoản CHƯA ĐƯỢC GÁN
   * NHÀ MÁY không được trình bày giống hệt `data: []` của một bộ lọc không khớp gì. Giao
   * diện phải đọc ô này trước khi in "không có dữ liệu" (xem `common.scopeEmpty.*`).
   * `null` = phạm vi bình thường; `undefined` = lối đi không mang danh tính người dùng.
   */
  scopeEmptyReason?: ScopeEmptyReason | null;
  scopeMessage?: string | null;
}

export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
  direction?: 'forward' | 'backward';
}

// Helper to encode cursor
export function encodeCursor(id: number, timestamp: Date): string {
  return Buffer.from(`${id}:${timestamp.getTime()}`).toString('base64');
}

// Helper to decode cursor
export function decodeCursor(cursor: string): { id: number; timestamp: Date } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const [idStr, timestampStr] = decoded.split(':');
    const id = parseInt(idStr, 10);
    const timestamp = new Date(parseInt(timestampStr, 10));
    if (isNaN(id) || isNaN(timestamp.getTime())) return null;
    return { id, timestamp };
  } catch {
    return null;
  }
}

// Cursor-based pagination for product inspections
export async function getProductInspectionsCursor(params: CursorPaginationParams & {
  machineId?: number;
  serialNumber?: string;
  productModel?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  corporateCode?: string;
  factoryCode?: string;
  userId?: number;
  userRole?: string;
}): Promise<CursorPaginationResult<InspectionListRow>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 50, 500); // Max 500 per request
  const conditions: SQL[] = [];

  // Access filter by user assignments.
  // ⚠ `resolveDataScope` trả CẢ điều kiện SQL lẫn câu giải thích: một tài khoản 0 gán nhà máy
  // nhận vị từ FALSE (không phải `undefined` = không lọc, xem `_core/accessControl.ts`) và
  // `data: []` của nó phải đi kèm lý do, không được im lặng thành "không có dữ liệu".
  let scope: ScopeLabels = UNSCOPED_LABELS;
  if (params.userId && params.userRole !== 'admin') {
    const { resolveDataScope } = await import("../_core/accessControl");
    const resolved = await resolveDataScope(params.userId, params.userRole || 'user');
    if (resolved.filter) conditions.push(resolved.filter);
    scope = scopeLabelsOf(resolved);
  }

  // Build filter conditions
  if (params.machineId) conditions.push(eq(productInspections.machineId, params.machineId));
  if (params.serialNumber) conditions.push(like(productInspections.serialNumber, `%${params.serialNumber}%`));
  if (params.productModel) conditions.push(like(productInspections.productModel, `%${params.productModel}%`));
  if (params.result) conditions.push(eq(productInspections.overallResult, params.result));
  if (params.startDate) conditions.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) conditions.push(lte(productInspections.inspectionTime, params.endDate));
  if (params.corporateCode) conditions.push(eq(productInspections.corporateCode, params.corporateCode));
  if (params.factoryCode) conditions.push(eq(productInspections.factoryCode, params.factoryCode));

  // Cursor condition
  if (params.cursor) {
    const cursorData = decodeCursor(params.cursor);
    if (cursorData) {
      if (params.direction === 'backward') {
        conditions.push(
          or(
            gt(productInspections.inspectionTime, cursorData.timestamp),
            and(
              eq(productInspections.inspectionTime, cursorData.timestamp),
              gt(productInspections.id, cursorData.id)
            )
          )!
        );
      } else {
        conditions.push(
          or(
            lt(productInspections.inspectionTime, cursorData.timestamp),
            and(
              eq(productInspections.inspectionTime, cursorData.timestamp),
              lt(productInspections.id, cursorData.id)
            )
          )!
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch one extra to check if there are more.
  // Projected hot-path read (gap B9) — see inspectionListProjection.
  const results = await db.select(inspectionListProjection)
    .from(productInspections)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(productInspections.inspectionTime)
        : desc(productInspections.inspectionTime),
      params.direction === 'backward'
        ? asc(productInspections.id)
        : desc(productInspections.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  // Reverse if backward direction
  if (params.direction === 'backward') {
    data.reverse();
  }

  // Generate cursors
  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.inspectionTime) : null,
    prevCursor: firstItem ? encodeCursor(firstItem.id, firstItem.inspectionTime) : null,
    hasMore,
    scopeEmptyReason: scope.scopeEmptyReason,
    scopeMessage: scope.scopeMessage,
  };
}

// Cursor-based pagination for measurement results
export async function getMeasurementResultsCursor(params: CursorPaginationParams & {
  inspectionId?: number;
  pointDefId?: number;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
}): Promise<CursorPaginationResult<typeof measurementResults.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 100, 1000); // Max 1000 per request
  const conditions: SQL[] = [];

  if (params.inspectionId) conditions.push(eq(measurementResults.inspectionId, params.inspectionId));
  if (params.pointDefId) conditions.push(eq(measurementResults.pointDefId, params.pointDefId));
  if (params.result) conditions.push(eq(measurementResults.result, params.result));

  // Cursor condition (using id only since measurementResults doesn't have timestamp)
  if (params.cursor) {
    const cursorId = parseInt(Buffer.from(params.cursor, 'base64').toString('utf-8'), 10);
    if (!isNaN(cursorId)) {
      if (params.direction === 'backward') {
        conditions.push(gt(measurementResults.id, cursorId));
      } else {
        conditions.push(lt(measurementResults.id, cursorId));
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select()
    .from(measurementResults)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(measurementResults.id)
        : desc(measurementResults.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  if (params.direction === 'backward') {
    data.reverse();
  }

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? Buffer.from(lastItem.id.toString()).toString('base64') : null,
    prevCursor: firstItem ? Buffer.from(firstItem.id.toString()).toString('base64') : null,
    hasMore,
  };
}

// Cursor-based pagination for alert history
export async function getAlertHistoryCursor(params: CursorPaginationParams & {
  alertSettingId?: number;
  alertType?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<CursorPaginationResult<typeof alertHistory.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 50, 200); // Max 200 per request
  const conditions: SQL[] = [];

  if (params.alertSettingId) conditions.push(eq(alertHistory.alertSettingId, params.alertSettingId));
  if (params.startDate) conditions.push(gte(alertHistory.createdAt, params.startDate));
  if (params.endDate) conditions.push(lte(alertHistory.createdAt, params.endDate));

  // Cursor condition
  if (params.cursor) {
    const cursorData = decodeCursor(params.cursor);
    if (cursorData) {
      if (params.direction === 'backward') {
        conditions.push(
          or(
            gt(alertHistory.createdAt, cursorData.timestamp),
            and(
              eq(alertHistory.createdAt, cursorData.timestamp),
              gt(alertHistory.id, cursorData.id)
            )
          )!
        );
      } else {
        conditions.push(
          or(
            lt(alertHistory.createdAt, cursorData.timestamp),
            and(
              eq(alertHistory.createdAt, cursorData.timestamp),
              lt(alertHistory.id, cursorData.id)
            )
          )!
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select()
    .from(alertHistory)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(alertHistory.createdAt)
        : desc(alertHistory.createdAt),
      params.direction === 'backward'
        ? asc(alertHistory.id)
        : desc(alertHistory.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  if (params.direction === 'backward') {
    data.reverse();
  }

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.createdAt) : null,
    prevCursor: firstItem ? encodeCursor(firstItem.id, firstItem.createdAt) : null,
    hasMore,
  };
}

// Cursor-based pagination for MQTT alert history
export async function getMqttAlertHistoryCursor(params: CursorPaginationParams & {
  ruleId?: number;
  resolved?: boolean;
  startDate?: Date;
  endDate?: Date;
}): Promise<CursorPaginationResult<typeof mqttAlertHistory.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 50, 200);
  const conditions: SQL[] = [];

  if (params.ruleId) conditions.push(eq(mqttAlertHistory.ruleId, params.ruleId));
  if (params.resolved !== undefined) {
    if (params.resolved) {
      conditions.push(isNotNull(mqttAlertHistory.resolvedAt));
    } else {
      conditions.push(isNull(mqttAlertHistory.resolvedAt));
    }
  }
  if (params.startDate) conditions.push(gte(mqttAlertHistory.triggeredAt, params.startDate));
  if (params.endDate) conditions.push(lte(mqttAlertHistory.triggeredAt, params.endDate));

  if (params.cursor) {
    const cursorData = decodeCursor(params.cursor);
    if (cursorData) {
      if (params.direction === 'backward') {
        conditions.push(
          or(
            gt(mqttAlertHistory.triggeredAt, cursorData.timestamp),
            and(
              eq(mqttAlertHistory.triggeredAt, cursorData.timestamp),
              gt(mqttAlertHistory.id, cursorData.id)
            )
          )!
        );
      } else {
        conditions.push(
          or(
            lt(mqttAlertHistory.triggeredAt, cursorData.timestamp),
            and(
              eq(mqttAlertHistory.triggeredAt, cursorData.timestamp),
              lt(mqttAlertHistory.id, cursorData.id)
            )
          )!
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select()
    .from(mqttAlertHistory)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(mqttAlertHistory.triggeredAt)
        : desc(mqttAlertHistory.triggeredAt),
      params.direction === 'backward'
        ? asc(mqttAlertHistory.id)
        : desc(mqttAlertHistory.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  if (params.direction === 'backward') {
    data.reverse();
  }

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.triggeredAt) : null,
    prevCursor: firstItem ? encodeCursor(firstItem.id, firstItem.triggeredAt) : null,
    hasMore,
  };
}
