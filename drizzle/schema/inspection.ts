// Schema domain: Inspection tables
//
// W3-A (doc 27 §2 M1/M11, migrations 0179/0180): FK declarations below mirror
// what 0180 enforces at the DB. ⚠ CONDITIONAL-ENFORCEMENT CAVEAT: when 0172 has
// converted product_inspections/measurement_results to TimescaleDB hypertables,
// the DB CANNOT hold an FK **to** a hypertable — 0180 then SKIPS
// fk_measurement_results_inspection (recorded in db_feature_status) and the
// weekly integrityScanService orphan scan covers it. The .references() here are
// metadata-only for runtime queries (migrations are hand-written SQL).
import { sql } from "drizzle-orm";
import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, decimal, boolean, bigint, index, uniqueIndex, primaryKey, json, jsonb, real } from "drizzle-orm/pg-core";
import { overallResultEnum, originalResultEnum, aiDecisionEnum } from "./enums";
import { machines } from "./hierarchy";
import { measurementPointDefs, defectCatalog } from "./product";

export const productInspections = pgTable("product_inspections", {
  id: serial("id").primaryKey(),
  // W3-A (0180): fk_product_inspections_machine, ON DELETE RESTRICT — a machine
  // with inspection history cannot be hard-deleted (deletes are soft anyway).
  // High-volume table: FK adds a cheap per-insert PK lookup on `machines`.
  machineId: integer("machineId").notNull()
    .references(() => machines.id, { onDelete: "restrict" }),
  productModelId: integer("productModelId"), // Liên kết với Product Model
  corporateCode: varchar("corporateCode", { length: 50 }), // Mã tập đoàn
  factoryCode: varchar("factoryCode", { length: 50 }), // Mã nhà máy
  workshopCode: varchar("workshopCode", { length: 50 }), // Mã nhà xưởng
  lineCode: varchar("lineCode", { length: 50 }), // Mã dây chuyền
  stageCode: varchar("stageCode", { length: 50 }), // Mã công đoạn
  productionOrderCode: varchar("productionOrderCode", { length: 100 }), // Mã lệnh sản xuất
  // Mã công nhân vận hành — doc 29 §3.2: re-defined as the BADGE CODE the machine
  // sends (operator_badges.badgeCode). Kept varchar (hypertable — no type rewrite);
  // resolve to users.id via operatorBadgeService / the stamped operatorUserId below.
  operatorId: varchar("operatorId", { length: 50 }),
  serialNumber: varchar("serialNumber", { length: 100 }).notNull(),
  productModel: varchar("productModel", { length: 100 }), // Backward compatibility
  batchNumber: varchar("batchNumber", { length: 100 }),
  overallResult: overallResultEnum("overallResult").notNull(),
  originalResult: originalResultEnum("originalResult").notNull(),
  ntfConfirmedBy: integer("ntfConfirmedBy"),
  ntfConfirmedAt: timestamp("ntfConfirmedAt"),
  ntfReason: text("ntfReason"),
  inspectionTime: timestamp("inspectionTime").notNull(),
  cycleTime: decimal("cycleTime", { precision: 10, scale: 2 }),
  // Batch operations fields
  notes: text("notes"),
  tags: text("tags"), // JSON array of tags
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  isArchived: boolean("isArchived").default(false),
  archivedAt: timestamp("archivedAt"),
  archivedBy: integer("archivedBy"),
  // AI Quality Gate fields
  aiDecision: aiDecisionEnum("aiDecision"),
  aiConfidence: decimal("aiConfidence", { precision: 5, scale: 4 }),
  aiModelId: integer("aiModelId"),
  aiProcessedAt: timestamp("aiProcessedAt"),
  aiDetails: json("aiDetails").$type<{
    predictions?: Array<{ label: string; confidence: number }>;
    ensembleResults?: Array<{ modelId: number; topLabel: string; confidence: number }>;
    processingTimeMs?: number;
    reviewReason?: string;
    // Doc 27 W7-A (V18) — honest AI-down marker from the INLINE ingest path:
    // 'ai_unavailable' (circuit breaker open) | 'ai_error' (gate threw).
    // Present ⇒ aiDecision=NEEDS_REVIEW was routed WITHOUT an inference verdict
    // (aiConfidence/aiModelId stay NULL).
    skipped?: "ai_unavailable" | "ai_error";
    inline?: boolean;
    source?: string;
  }>(),
  // ============ P4.C G16 — Specialized subforms ============
  // Discriminator (e.g. "FAI" | "IQC" | "OQC" | "AOI" | "FCT" ...). NULLABLE for back-compat.
  inspectionType: varchar("inspectionType", { length: 40 }),
  // Polymorphic payload validated server-side via inspectionVariant.validatePayload.
  variantPayload: jsonb("variantPayload").$type<Record<string, unknown>>(),
  // ============ end G16 ============
  // Doc 27 W2-C/W2-D (gap C4/M8, migration 0178) — SOFT commissioning gate tag.
  // "commissioning" = the machine had no signed commissioning record at ingest
  // time (submission accepted but TAGGED, never rejected). NULL = production.
  ingestMode: varchar("ingestMode", { length: 20 }),
  // Doc 27 W7-A (Đợt 7, migration 0187) — Đợt-3 deferred stamping: the RELEASED
  // inspection_program_releases.id in force for (productModelId, machineId) at
  // ingest time. SOFT ref (product_inspections may be a hypertable — see file
  // header; 0182/0183 convention). NULL = no released program / legacy row.
  // Stamped fail-open by processInspectionSubmission via getActiveRelease.
  programReleaseId: integer("programReleaseId"),
  // Doc 27 W7-B (gap V3, migration 0188) — heuristic false-call likelihood
  // (0..1) from ntfPredictorService (repeat-offender + near-limit margin +
  // machine trend). NULL = not scored. ADVISORY ONLY: pre-sorts the operator
  // verify queue and drives the "Nghi báo giả" badge — never changes a verdict.
  ntfScore: real("ntfScore"),
  // ── Doc 29 §2.3/§3.2 — W8-B (migration 0192, hypertable-safe metadata-only adds) ──
  // Panel multi-up: the machine-reported panel serial/identifier (st4i header
  // panel_id) and 1-based board index inside the panel (product_panel_boards.
  // boardIndex of the product's panel def). NULL = single-board / legacy ingest;
  // analytics must stay null-safe (COALESCE(boardIndex, 1)).
  panelSerial: varchar("panelSerial", { length: 100 }),
  boardIndex: integer("boardIndex"),
  // Operator/badge master: users.id resolved from operatorId (the BADGE CODE the
  // machine sends — see operator_badges) at ingest time. Stamped fail-open by
  // processInspectionSubmission via operatorBadgeService; NULL = badge unknown/
  // unassigned or pre-0192 row (those resolve on read).
  operatorUserId: integer("operatorUserId"),
  // ── Doc 51 P1 (migration 0275) — INGEST PROVENANCE. All nullable, never
  // backfilled: a NULL means "this row predates 0275 / was never measured",
  // which is the truth. See drizzle/0275_inspection_provenance.sql.
  //
  // CASE #3 (clock skew). `inspectionTime` is whatever the MACHINE said; nothing
  // ever compared it to the server's clock, so a machine 6h off silently filed
  // boards into the wrong shift/day and no column could even identify the damage
  // afterwards. These four make it measurable on EVERY row:
  //   serverReceivedAt — when the SERVER received the submission. The one clock a
  //     machine cannot lie about. For a WAL replay this is the ORIGINAL receive
  //     time (stamped by the mutation BEFORE buffering), not the replay time.
  serverReceivedAt: timestamp("serverReceivedAt"),
  //   timeSkewSeconds — SIGNED (machineTime − serverReceivedAt). The sign matters:
  //     "machine runs behind" and "machine runs ahead" are different faults.
  timeSkewSeconds: integer("timeSkewSeconds"),
  //   clockSkewFlagged — |skew| exceeded INGEST_CLOCK_SKEW_WARN_SECONDS (default
  //     300) at ingest. NULL ≠ false: NULL = never evaluated (pre-0275 row).
  clockSkewFlagged: boolean("clockSkewFlagged"),
  //   timeSource — 'machine_utc' (timestamp carried an offset/Z → absolute instant,
  //     skew is trustworthy) | 'machine_naive' (no offset → the server had to ASSUME
  //     its own local zone, so a machine off by a whole number of hours measures
  //     skew ≈ 0 — this is exactly what INGEST_REQUIRE_TIME_OFFSET exists to stop)
  //     | 'server' (machine sent no time; server stamped now() — skew 0 by
  //     definition, and this board is NOT covered by 0272's natural key).
  timeSource: varchar("timeSource", { length: 20 }),
  // Idempotency (doc 51 P1, closing the 0272 hole) — AUDIT ONLY. The ENFORCEMENT
  // lives in `inspectionIdempotencyKeys` below: product_inspections is a Timescale
  // hypertable, and a unique index on it MUST contain the partition column
  // `inspectionTime` — the very column that changes on every retry of a machine
  // that omits it. Verified on the dev DB: "cannot create a unique index without
  // the column inspectionTime (used in partitioning)".
  idempotencyKey: varchar("idempotencyKey", { length: 200 }),
  // CASE #12 (version pinning) — the points-config version the MACHINE DECLARED it
  // was grading with, stamped VERBATIM (it is the machine's claim, not the server's
  // verdict). Without it "which thresholds graded this board?" is unanswerable,
  // because product_models.pointsConfigVersion is LIVE and moves under your feet.
  // ★ This column is the seam QĐ#2 rests on: re-grade against the SNAPSHOT of THIS
  //   version — never against the live limits.
  pointsConfigVersion: integer("pointsConfigVersion"),
  // Server's SOFT verdict on that claim: 'current' | 'stale' (machine grading with
  // outdated thresholds — TAGGED, never rejected, QĐ#3) | 'ahead' (machine claims
  // newer than the server — config rollback / lying machine / restored DB) |
  // 'unknown' (machine didn't declare, or no product model resolved).
  configVersionStatus: varchar("configVersionStatus", { length: 20 }),
  // ── Doc 51 P2 (CASE #8, migration 0281) — SERIAL-COLLISION SOFT DETECT. ──────
  // The column `suspectedDuplicateSerial timestamp` is provisioned by migration
  // 0281 and written BEST-EFFORT via a raw UPDATE (machineApiRouters.
  // persistSuspectedDuplicateSerial), NOT declared here — same fail-open pattern
  // as gateConfigVersion (0276): keeping it out of the drizzle table means the
  // generated INSERT never references it, so ingest cannot break on a DB where
  // 0281 has not been applied yet. It records the instant the SAME serial was
  // already on record from a DIFFERENT machine in the recent window (QĐ#3: the
  // board is TAGGED, never rejected). Distinct from an idempotency retry (same
  // machine + same key ⇒ short-circuited as a duplicate long before this check).
  //
  // ── Doc 55 Item 3 PV0/PV2 (migration 0286) — PRODUCT VARIANT stamp. ──────────
  // Which product_variants.id this board was inspected AS. Nullable + never
  // backfilled: NULL = legacy/pre-0286 row OR ingest ran with PRODUCT_VARIANT_ENABLED
  // OFF (the whole variant layer inert ⇒ variantId stays NULL, byte-identical to
  // pre-variant). Under the flag, submitInspection stamps the resolved variant's id
  // (the BASE variant's id when the machine sends no variantCode — QĐ#12; the
  // matched non-base variant's id when it does). Soft ref (product_inspections is a
  // Timescale hypertable → no FK); analytics must stay null-safe. Declared here so
  // the generated INSERT carries it when set — additive on a DB where 0286 added
  // the column, and an omitted (undefined) value simply never references it.
  variantId: integer("variantId"),
  // ── Pha 1A (2026-08-25, migration 0339) — CÂY KẾT QUẢ header-level fields. ────────────
  // Tất cả NULLABLE, KHÔNG backfill: header đã Timescale-compress một phần (chunk cũ có
  // thể đã nén) nên NOT NULL DEFAULT chưa được chứng minh an toàn — xem drizzle/
  // 0339_inspection_result_tree.sql. NULL trên mọi cột dưới đây = hàng lịch sử trước Pha 1
  // (kể cả sau khi ingest mới bắt đầu ghi, một số hàng vẫn có thể NULL nếu máy không khai).
  //
  // Nguồn của ntf HEADER-level ('machine' | ta CUỘN từ inspection_surfaces con) — đối
  // xứng với ntfSource ở mọi cấp trong cây kết quả (surface/position/capture).
  ntfSource: varchar("ntfSource", { length: 10 }),
  // Chỉ số board TRONG một lượt máy báo (khác boardIndex ở trên — đó là chỉ số trong
  // PANEL vật lý; cái này là index máy tự đếm theo THỨ TỰ SUBMIT, dùng để phát hiện board
  // bị máy bỏ qua/trùng khi đối chiếu với productionOrderCode).
  machineProductIndex: integer("machineProductIndex"),
  // Cờ LỆCH cấu hình phát hiện tại ingest — mảng JSON các mã lệch (VD: surface/position/
  // capture máy gửi không khớp cây CẤU HÌNH đã dạy ở product_surfaces/product_positions/
  // product_captures). NULL = chưa từng đối chiếu (pre-0339) hoặc không lệch gì.
  configDriftFlags: jsonb("configDriftFlags").$type<string[]>(),
  // Bộ đếm tổng hợp CUỘN từ cây kết quả con (đếm surface/position/capture theo OK/NG/NTF)
  // — cache đọc nhanh cho dashboard, không phải nguồn sự thật (nguồn sự thật là chính các
  // hàng inspection_surfaces/positions/captures). NULL = chưa cuộn (pre-0339 hoặc cây con
  // rỗng).
  summaryCounts: jsonb("summaryCounts").$type<Record<string, number>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_inspections_machine").on(table.machineId),
  index("idx_inspections_serial").on(table.serialNumber),
  index("idx_inspections_time").on(table.inspectionTime),
  index("idx_inspections_result").on(table.overallResult),
  index("idx_inspections_product_model").on(table.productModelId),
  index("idx_inspections_corporate").on(table.corporateCode),
  index("idx_inspections_factory").on(table.factoryCode),
  // Composite index for common queries
  index("idx_inspections_machine_time").on(table.machineId, table.inspectionTime),
  index("idx_inspections_corporate_factory").on(table.corporateCode, table.factoryCode),
  index("idx_inspections_workshop").on(table.workshopCode),
  index("idx_inspections_line").on(table.lineCode),
  index("idx_inspections_production_order").on(table.productionOrderCode),
  index("idx_inspections_type").on(table.inspectionType),
  // Doc 51 P0 (R2, migration 0272) — INGEST IDEMPOTENCY natural key. A machine
  // that retries the SAME board (network timeout on the ACK, agent restart, WAL
  // replay racing a live retry) must never produce a SECOND product_inspections
  // row: that double-counts completedQuantity/yield and re-fires the NG alert.
  //   • Partition column `inspectionTime` IS in the key → valid on plain PG AND
  //     on the Timescale hypertable (0172: every unique index must carry the
  //     partition column). Equal inspectionTime ⇒ same chunk ⇒ uniqueness is
  //     global, not per-chunk.
  //   • PARTIAL (serialNumber <> ''): legacy/empty-serial rows are EXEMPT so a
  //     pre-existing batch of blank serials can never collide with each other.
  //     New ingest can't create them anyway (submitInspection zod min(1)).
  //   • App side: createProductInspection uses ON CONFLICT DO NOTHING and
  //     resolves the existing row — inert (harmless no-op) if the DB index is
  //     not in force yet (0272 records 'partial' in db_feature_status then).
  // ⚠ LIMIT: keyed on the machine-sent inspectionTime. A machine that OMITS it
  // gets a fresh receive-time stamp per retry → different key → NOT caught here.
  // That case is doc 51 P1 (explicit idempotencyKey in the machine contract).
  uniqueIndex("uq_inspections_machine_serial_time")
    .on(table.machineId, table.serialNumber, table.inspectionTime)
    .where(sql`${table.serialNumber} <> ''`),
]);

export type ProductInspection = typeof productInspections.$inferSelect;
export type InsertProductInspection = typeof productInspections.$inferInsert;

/**
 * Doc 51 P1 (migration 0275) — EXPLICIT INGEST IDEMPOTENCY LEDGER.
 *
 * WHY A SEPARATE TABLE AND NOT AN INDEX ON product_inspections:
 * 0272 keys idempotency on (machineId, serialNumber, inspectionTime). A machine
 * that OMITS inspectionTime gets a fresh now() stamp on every retry → a different
 * key each time → 0272 never fires and the board is double-counted. The fix is a
 * client-generated key that is STABLE across retries — but it cannot be a unique
 * index on product_inspections, because that table is a TimescaleDB hypertable and
 * Timescale requires every unique index to carry the partition column
 * `inspectionTime`. Verified directly against the dev DB:
 *
 *     CREATE UNIQUE INDEX ... ON product_inspections ("machineId", <col>)
 *     → ERROR: cannot create a unique index without the column "inspectionTime"
 *              (used in partitioning)
 *
 * (Same rule forced 0172 to rewrite the PK to (id, inspectionTime).) Putting
 * inspectionTime back into the key defeats the entire purpose. So the constraint
 * moves to a PLAIN table where PK (machineId, idempotencyKey) is legal and global.
 *
 * ⚠ NEVER convert this table to a hypertable — that would silently re-open the hole.
 *
 * Write protocol (server/db/inspection.ts createProductInspection): claim → insert
 * header → back-fill inspectionId, ALL in ONE transaction. Postgres' ON CONFLICT
 * DO NOTHING waits on an in-flight conflicting insert before deciding, so two
 * concurrent retries of the same key serialise correctly and exactly one wins.
 */
export const inspectionIdempotencyKeys = pgTable("inspection_idempotency_keys", {
  machineId: integer("machineId").notNull(),
  /** Client-generated, stable across retries of the SAME board. */
  idempotencyKey: varchar("idempotencyKey", { length: 200 }).notNull(),
  /**
   * The inspection this key produced. NULL exists ONLY inside the claiming
   * transaction; a COMMITTED row with NULL here means the invariant broke — the
   * app throws (transient → WAL buffers) rather than invent an id.
   */
  inspectionId: integer("inspectionId"),
  /** Copy of the header's inspectionTime so the ledger can be pruned on the same
   *  horizon as product_inspections without joining back into the hypertable. */
  inspectionTime: timestamp("inspectionTime"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.machineId, table.idempotencyKey] }),
  // Age-based pruning (retention). Without it, cleaning the ledger seq-scans.
  index("idx_inspection_idem_created").on(table.createdAt),
]);

export type InspectionIdempotencyKey = typeof inspectionIdempotencyKeys.$inferSelect;
export type InsertInspectionIdempotencyKey = typeof inspectionIdempotencyKeys.$inferInsert;

/**
 * Measurement Result - Kết quả đo thực tế
 */
export const measurementResults = pgTable("measurement_results", {
  id: serial("id").primaryKey(),
  // W3-A (0180): fk_measurement_results_inspection, ON DELETE CASCADE — results
  // die with their inspection. ⚠ DB enforcement is CONDITIONAL: skipped when the
  // two tables are hypertables (Timescale forbids FKs referencing a hypertable);
  // the weekly orphan scan covers it there. See file header.
  inspectionId: integer("inspectionId").notNull()
    .references(() => productInspections.id, { onDelete: "cascade" }),
  // W3-A (0180): fk_measurement_results_point_def, ON DELETE RESTRICT (column is
  // NOT NULL so SET NULL is impossible; point defs are app-soft-deleted anyway).
  // Legacy hard-deleted defs left orphans → 0180 may leave this NOT VALID until
  // repaired (see integrity_scan_results).
  pointDefId: integer("pointDefId").notNull()
    .references(() => measurementPointDefs.id, { onDelete: "restrict" }),
  measuredValue: decimal("measuredValue", { precision: 15, scale: 6 }),
  measuredValueText: varchar("measuredValueText", { length: 255 }), // Giá trị dạng texts
  result: overallResultEnum("result").notNull(),
  imageUrl: text("imageUrl"), // Ảnh thực tế của điểm đo
  imageKey: varchar("imageKey", { length: 255 }),
  remark: text("remark"),
  aiAnalysisResult: text("aiAnalysisResult"), // Kết quả phân tích AI
  aiConfidence: decimal("aiConfidence", { precision: 5, scale: 4 }),
  aiComparisonScore: decimal("aiComparisonScore", { precision: 5, scale: 4 }), // Điểm so sánh với ảnh mẫu
  // ============ P2 — extended 3D / solder / xray measurement values ============
  // All NULLABLE; populated only when the matching point def opts into 3D inspection.
  valueZ: decimal("valueZ", { precision: 15, scale: 6 }),
  valueHeight: decimal("valueHeight", { precision: 15, scale: 6 }),
  valueArea: decimal("valueArea", { precision: 15, scale: 6 }),
  valueVolume: decimal("valueVolume", { precision: 15, scale: 6 }),
  valueVoidPct: decimal("valueVoidPct", { precision: 15, scale: 6 }),
  valueCoplanarity: decimal("valueCoplanarity", { precision: 15, scale: 6 }),
  valueWarpage: decimal("valueWarpage", { precision: 15, scale: 6 }),
  valueOffsetX: decimal("valueOffsetX", { precision: 15, scale: 6 }),
  valueOffsetY: decimal("valueOffsetY", { precision: 15, scale: 6 }),
  valueTilt: decimal("valueTilt", { precision: 15, scale: 6 }),
  valueThickness: decimal("valueThickness", { precision: 15, scale: 6 }),
  // W3-A (doc 27 M11, 0180): now a REAL FK — fk_measurement_results_defect_catalog,
  // ON DELETE SET NULL (deleting a catalog entry detaches, never breaks, results).
  defectCatalogId: integer("defectCatalogId")
    .references(() => defectCatalog.id, { onDelete: "set null" }),
  defectSeverity: varchar("defectSeverity", { length: 20 }),
  // Doc 31 Đợt B (OP3, migration 0194) — the RAW defect code as reported by the
  // machine/AI, retained even when it did NOT resolve to a defect_catalog row
  // (then defectCatalogId stays NULL). Honest, never-dropped fallback so an
  // unmatched code can be recovered/curated later (see unmatched_defect_codes).
  defectCodeRaw: varchar("defectCodeRaw", { length: 50 }),
  // ============ Defect location on board image (pixel coordinates) ============
  // Bounding box of defect region on the full board/panel image.
  // Enables: visual overlay in UI, AI training data (YOLO/COCO format), defect density heatmap.
  // Coordinates are in pixels relative to the top-left corner of imageUrl.
  defectBboxX: integer("defectBboxX"),       // left pixel
  defectBboxY: integer("defectBboxY"),       // top pixel
  defectBboxW: integer("defectBboxW"),       // width in pixels
  defectBboxH: integer("defectBboxH"),       // height in pixels
  defectCropUrl: text("defectCropUrl"),      // pre-cropped defect region image (optional, for fast display)
  defectCropKey: varchar("defectCropKey", { length: 255 }), // storage key for defectCropUrl
  // ============ end defect location ============
  // ── Pha 1A (2026-08-25, migration 0339) → Pha 1B (2026-08-26, migration 0340) — CÂY KẾT
  // QUẢ leaf-level field. Tất cả NULLABLE — measurement_results là hypertable ĐÃ NÉN một phần.
  //
  // 0339 tạo cột tên "captureRowId" KHÔNG FK. 0340 đổi tên thành "inspectionCaptureRowId" +
  // thêm FK THẬT (fk_measurement_results_inspection_capture, ON DELETE SET NULL) — xem
  // drizzle/0340_capture_rowid_ro_nghia.sql. BG-8 (Critical, §13 Đ-16): có HAI cột từng cùng
  // tên "captureRowId" trỏ HAI bảng khác nhau (đây trỏ inspection_captures — cây KẾT QUẢ;
  // measurement_point_defs."captureRowId" trỏ product_captures — cây CẤU HÌNH) và hai dãy id
  // CHỒNG KHOẢNG — đổi tên để không còn nhầm lẫn khi JOIN.
  //
  // Soft-ref CÓ CHỦ ĐÍCH ở Drizzle (KHÔNG `.references()`): DB đã có FK THẬT (đặt trong
  // 0340), nhưng khai `.references()` ở đây sẽ tạo import vòng inspection.ts ↔ inspectionTree.ts
  // — mirror đúng quy ước soft-ref đã dùng ở measurement_point_defs.captureRowId (product.ts).
  //
  // NULL = hàng LỊCH SỬ trước Pha 1 (ghi trước khi cây inspection_captures tồn tại) —
  // không backfill, không suy đoán. Khi có giá trị: trỏ tới inspection_captures.id mà
  // measurement này thuộc về.
  inspectionCaptureRowId: integer("inspectionCaptureRowId"),
  // Khoá join sang teach data = ComponentProject.Id (measurement_point_defs.componentExtId,
  // migration 0338) — KHÔNG phải id nội bộ, là id máy khai cho linh kiện. NULL = chưa nối
  // được (pre-0339 hoặc máy không khai).
  componentExtId: varchar("componentExtId", { length: 64 }),
  // NTF do MÁY khai ở cấp measurement — đối xứng ntf/rolledNtf trong cây kết quả phía trên
  // (inspection_surfaces/positions/captures). NULL = máy không khai (khác false = khai
  // KHÔNG NTF).
  ntf: boolean("ntf"),
  // Nguồn của ntf ở dòng này ('machine' | nơi khác cuộn/gán) — cùng quy ước ntfSource ở
  // mọi cấp khác trong cây kết quả.
  ntfSource: varchar("ntfSource", { length: 10 }),
  // Mã lỗi/ngoại lệ pipeline máy báo cho PHÉP ĐO này (khác defectCodeRaw — đó là mã LỖI
  // SẢN PHẨM đã có từ trước; errorCode là lỗi VẬN HÀNH của chính phép đo, VD cảm biến
  // timeout, camera lỗi lấy nét). NULL = đo bình thường, không lỗi.
  errorCode: varchar("errorCode", { length: 50 }),
  // Mô tả người-đọc-được của errorCode (raw text từ máy, không chuẩn hoá).
  errorDesc: text("errorDesc"),
  // Mốc thời gian bắt đầu/kết thúc phép đo NÀY (khác createdAt — đó là lúc SERVER ghi
  // hàng, hai giá trị có thể lệch nhau nếu ingest trễ). NULL = máy không khai timing
  // per-measurement.
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_results_inspection").on(table.inspectionId),
  index("idx_results_point").on(table.pointDefId),
  index("idx_results_result").on(table.result),
  // Composite indexes for optimized queries
  index("idx_results_inspection_result").on(table.inspectionId, table.result),
  index("idx_results_point_result").on(table.pointDefId, table.result),
  // R-1 (doc 38, migration 0234): time-ordered scans of the hottest table by
  // measurement point (per-point trend / SPC / recent-results queries). The
  // (pointDefId, createdAt) composite lets the planner range-scan by point AND
  // time without a separate sort. Additive — see drizzle/0234_perf_indexes.sql.
  index("idx_results_pointdef_created").on(table.pointDefId, table.createdAt),
  // W3-A (0180): supports the ON DELETE SET NULL scan when a defect_catalog row
  // is deleted (partial — only rows that actually reference a defect).
  index("idx_results_defect_catalog").on(table.defectCatalogId).where(sql`${table.defectCatalogId} IS NOT NULL`),
  // Pha 1A (migration 0339, cột đổi tên ở 0340): partial — chỉ hàng ĐÃ nối vào cây kết quả
  // mới cần scan theo inspectionCaptureRowId (hàng lịch sử pre-0339 có giá trị NULL, không
  // cần index). Postgres tự cập nhật định nghĩa index/partial-predicate khi RENAME COLUMN
  // (tra theo attnum, không theo tên) — index vật lý idx_results_capture không đổi tên.
  index("idx_results_capture").on(table.inspectionCaptureRowId).where(sql`${table.inspectionCaptureRowId} IS NOT NULL`),
]);

export type MeasurementResult = typeof measurementResults.$inferSelect;
export type InsertMeasurementResult = typeof measurementResults.$inferInsert;

// ============================================================
// Inspection Packages - Gói ZIP ảnh AOI
// ============================================================

export const packageStatusEnum = pgEnum("packagestatusenum", [
  "pending",      // Presign URL generated, waiting for upload
  "uploading",    // ZIP upload in progress
  "uploaded",     // ZIP uploaded to storage, not yet committed
  "committed",    // Metadata parsed and linked to inspection
  "failed",       // Upload or processing failed
]);

/**
 * Inspection Packages - Gói ZIP ảnh AOI
 * Mỗi gói chứa ảnh các điểm đo của một lần kiểm tra
 */
export const inspectionPackages = pgTable("inspection_packages", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspectionId"),                    // Linked after commit
  machineId: integer("machineId").notNull(),                // Máy AOI/AVI
  
  // Package identity
  packageId: varchar("packageId", { length: 100 }).notNull().unique(), // UUID or inspectionId from agent
  storageKey: varchar("storageKey", { length: 500 }),       // S3/MinIO object key
  storageUrl: text("storageUrl"),                           // Download URL
  
  // Metadata from meta.json
  serialNumber: varchar("serialNumber", { length: 100 }),
  productModel: varchar("productModel", { length: 100 }),
  factoryCode: varchar("factoryCode", { length: 50 }),
  lineCode: varchar("lineCode", { length: 50 }),
  machineCode: varchar("machineCode", { length: 50 }),
  inspectionTime: timestamp("inspectionTime"),
  overallResult: overallResultEnum("overallResult"),
  totalPoints: integer("totalPoints").default(0),
  okCount: integer("okCount").default(0),
  ngCount: integer("ngCount").default(0),
  
  // File info
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }),
  imageCount: integer("imageCount").default(0),
  
  // Status tracking
  status: packageStatusEnum("status").default("pending").notNull(),
  errorMessage: text("errorMessage"),
  presignExpiresAt: timestamp("presignExpiresAt"),
  uploadedAt: timestamp("uploadedAt"),
  committedAt: timestamp("committedAt"),
  
  // Metadata
  metaJson: json("metaJson"),                               // Full meta.json content
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pkg_inspection").on(table.inspectionId),
  index("idx_pkg_machine").on(table.machineId),
  index("idx_pkg_package_id").on(table.packageId),
  index("idx_pkg_serial").on(table.serialNumber),
  index("idx_pkg_status").on(table.status),
  index("idx_pkg_inspection_time").on(table.inspectionTime),
  index("idx_pkg_machine_time").on(table.machineId, table.inspectionTime),
]);

export type InspectionPackage = typeof inspectionPackages.$inferSelect;
export type InsertInspectionPackage = typeof inspectionPackages.$inferInsert;

/**
 * Package Images - Thông tin từng ảnh trong gói ZIP
 * Được parse từ meta.json khi commit
 */
export const packageImages = pgTable("package_images", {
  id: serial("id").primaryKey(),
  packageId: integer("packageId").notNull(),               // FK -> inspection_packages.id
  
  // Point info from meta.json
  pointCode: varchar("pointCode", { length: 50 }).notNull(),
  pointName: varchar("pointName", { length: 255 }),
  fileName: varchar("fileName", { length: 255 }).notNull(), // e.g. "MP001.jpg"
  result: overallResultEnum("result"),
  measurementValue: varchar("measurementValue", { length: 100 }),
  
  // Cache info
  cachedUrl: text("cachedUrl"),                             // Extracted & cached URL 
  cachedAt: timestamp("cachedAt"),
  cacheExpiresAt: timestamp("cacheExpiresAt"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pkgimg_package").on(table.packageId),
  index("idx_pkgimg_point").on(table.pointCode),
]);

export type PackageImage = typeof packageImages.$inferSelect;
export type InsertPackageImage = typeof packageImages.$inferInsert;

/**
 * Upload Queue Metrics - Theo dõi hàng đợi upload từ các máy
 * Agent gửi metrics định kỳ
 */
export const uploadQueueMetrics = pgTable("upload_queue_metrics", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  
  // Queue stats
  queuedCount: integer("queuedCount").default(0).notNull(),
  uploadingCount: integer("uploadingCount").default(0).notNull(),
  failedCount: integer("failedCount").default(0).notNull(),
  completedCount: integer("completedCount").default(0).notNull(),
  
  // Disk stats
  diskUsedBytes: bigint("diskUsedBytes", { mode: "number" }),
  diskFreeBytes: bigint("diskFreeBytes", { mode: "number" }),
  
  // Performance
  avgUploadLatencyMs: integer("avgUploadLatencyMs"),
  lastUploadAt: timestamp("lastUploadAt"),
  lastErrorMessage: text("lastErrorMessage"),
  
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_uqm_machine").on(table.machineId),
  index("idx_uqm_recorded").on(table.recordedAt),
]);

// ============================================================
// Package Activity Logs - Nhật ký hoạt động upload gói tin AOI
// Ghi lại mọi sự kiện: presign, upload, commit, lỗi, xem, tải
// ============================================================
export const packageActivityLogEventEnum = pgEnum("package_activity_log_event", [
  "presign",        // Agent yêu cầu presigned URL
  "upload_start",   // Bắt đầu upload ZIP
  "upload_success", // Upload thành công
  "upload_fail",    // Upload thất bại
  "commit_start",   // Bắt đầu commit (parse ZIP)
  "commit_success", // Commit thành công
  "commit_fail",    // Commit thất bại (parse lỗi, meta.json sai, ...)
  "retry",          // Agent retry upload
  "image_view",     // User xem ảnh trong gói tin
  "zip_download",   // User tải ZIP gốc
  "status_change",  // Thay đổi trạng thái khác
]);

export const packageActivityLogs = pgTable("package_activity_logs", {
  id: serial("id").primaryKey(),
  packageDbId: integer("packageDbId").notNull(),            // FK -> inspection_packages.id
  packageId: varchar("packageId", { length: 100 }).notNull(), // Human-readable package ID
  machineId: integer("machineId"),                          // Máy thực hiện (nếu có)
  
  // Event info
  event: packageActivityLogEventEnum("event").notNull(),
  level: varchar("level", { length: 10 }).notNull().default("info"), // info, warn, error
  message: text("message").notNull(),                       // Mô tả sự kiện
  detail: text("detail"),                                   // Chi tiết lỗi / stack trace / thông tin thêm
  
  // Context
  source: varchar("source", { length: 30 }),                // "agent" | "server" | "user"
  userId: integer("userId"),                                // User nào thao tác (nếu có)
  userName: varchar("userName", { length: 100 }),           // Tên user (cache)
  ipAddress: varchar("ipAddress", { length: 45 }),          // IP máy client
  userAgent: varchar("userAgent", { length: 500 }),         // Browser/Agent user-agent
  
  // Metrics (optional)
  durationMs: integer("durationMs"),                        // Thời gian xử lý (ms)
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }), // Kích thước file liên quan
  
  // Metadata blob
  metadata: json("metadata"),                               // Dữ liệu thêm dạng JSON
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pal_package").on(table.packageDbId),
  index("idx_pal_package_id").on(table.packageId),
  index("idx_pal_event").on(table.event),
  index("idx_pal_created").on(table.createdAt),
  index("idx_pal_machine").on(table.machineId),
]);

export type PackageActivityLog = typeof packageActivityLogs.$inferSelect;
export type InsertPackageActivityLog = typeof packageActivityLogs.$inferInsert;
