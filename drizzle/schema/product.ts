// Schema domain: Product tables
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, bigint, text, timestamp, varchar, decimal, boolean, json, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { lifecycleStatusEnum, measurementTypeEnum, syncOperationEnum, syncStatusEnum } from "./enums";
// W3-A (doc 27 M1/M6, 0180): productMachineMappings now carries real FKs to machines.
import { machines } from "./hierarchy";

/**
 * Product Model - Mẫu sản phẩm với ảnh tham chiếu
 */
export const productModels = pgTable("product_models", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Product hierarchy
  category: varchar("category", { length: 100 }), // Product family/category (legacy text field)
  categoryId: integer("categoryId"), // Foreign key to product_categories table
  productLine: varchar("productLine", { length: 100 }), // Product line
  // @deprecated doc 55 PV0 (QĐ#13) — legacy free-text variant LABEL. Superseded by
  // the first-class `product_variants` table (+ inheritance/override). NOT dropped
  // (existing rows keep their label); no longer the source of truth for variants.
  variant: varchar("variant", { length: 100 }), // Product variant (legacy label)
  // Lifecycle status
  lifecycleStatus: lifecycleStatusEnum("lifecycleStatus").default("active").notNull(),
  // Doc 31 PM2 (decision #6, migration 0197) — free-text engineering revision
  // (e.g. "A", "B", "Rev2"). NOT a genealogy table: revisions are created by
  // cloning (PM1) into a new code and bumping this field. Nullable, no default.
  revision: varchar("revision", { length: 32 }),
  // Doc 31 PM1/PM2 (0197) — lightweight provenance. When this product was created
  // via productModel.clone, this holds the source product's id. Plain int, NO hard
  // FK (soft-ref convention) so deleting the source never blocks the clone. NULL =
  // authored from scratch.
  clonedFromId: integer("clonedFromId"),
  // Reference image
  referenceImageUrl: text("referenceImageUrl"), // Ảnh mẫu sản phẩm
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  imageWidth: integer("imageWidth"), // Kích thước ảnh gốc
  imageHeight: integer("imageHeight"),
  imageDisplayMode: varchar("imageDisplayMode", { length: 20 }).default("contain"), // contain | cover | stretch | none
  // Quality targets
  targetYieldRate: decimal("targetYieldRate", { precision: 5, scale: 2 }), // Target FPY %
  minYieldRate: decimal("minYieldRate", { precision: 5, scale: 2 }), // Minimum acceptable FPY %
  // Points config version - incremented when measurement points change
  pointsConfigVersion: integer("pointsConfigVersion").default(1).notNull(),
  // Image hash for deduplication (SHA-256)
  imageHash: varchar("imageHash", { length: 64 }),
  // P1: pixel | mm — coordinate system used by measurementPointDefs/fiducials
  // for this product model. "pixel" preserves legacy semantics.
  coordinateMode: varchar("coordinateMode", { length: 20 }).default("pixel").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  // P0 soft-delete marker. NULL = live row. Set when row is logically deleted.
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_product_models_code").on(table.code),
  index("idx_product_models_category").on(table.category),
  index("idx_product_models_category_id").on(table.categoryId),
  index("idx_product_models_lifecycle").on(table.lifecycleStatus),
  index("idx_product_models_deleted_at").on(table.deletedAt),
]);

export type ProductModel = typeof productModels.$inferSelect;
export type InsertProductModel = typeof productModels.$inferInsert;

/**
 * P1: Fiducial Marks — alignment reference marks on the product reference image.
 * Used by AOI machines to register the captured frame against the product model
 * coordinate system before locating measurement points.
 */
export const fiducialMarks = pgTable("fiducial_marks", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // type: cross | circle | square | custom
  type: varchar("type", { length: 20 }).default("cross").notNull(),
  // Position on reference image (pixel coordinates)
  positionX: integer("positionX").notNull(),
  positionY: integer("positionY").notNull(),
  // Normalized (0-1) for resolution-independent transport
  normalizedX: decimal("normalizedX", { precision: 10, scale: 8 }),
  normalizedY: decimal("normalizedY", { precision: 10, scale: 8 }),
  // Search window the machine uses to locate this mark in the captured frame
  searchWindowW: integer("searchWindowW").default(80).notNull(),
  searchWindowH: integer("searchWindowH").default(80).notNull(),
  // Optional template image for "custom" type
  templateImageUrl: text("templateImageUrl"),
  templateImageKey: varchar("templateImageKey", { length: 255 }),
  orderIndex: integer("orderIndex").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_fiducial_marks_product").on(table.productModelId),
  index("idx_fiducial_marks_code").on(table.code),
  index("idx_fiducial_marks_deleted_at").on(table.deletedAt),
  index("uq_fiducial_marks_product_code").on(table.productModelId, table.code),
]);

export type FiducialMark = typeof fiducialMarks.$inferSelect;
export type InsertFiducialMark = typeof fiducialMarks.$inferInsert;

/**
 * Measurement Point Definition - Định nghĩa điểm đo với tọa độ trên ảnh mẫu
 * Mỗi sản phẩm có thể có 30-50 điểm đo
 */
export const measurementPointDefs = pgTable("measurement_point_defs", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(), // Liên kết với Product Model
  machineId: integer("machineId"), // Optional: máy cụ thể sử dụng điểm đo này
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  measurementType: measurementTypeEnum("measurementType").notNull(),
  unit: varchar("unit", { length: 20 }),
  lowerLimit: decimal("lowerLimit", { precision: 15, scale: 6 }),
  upperLimit: decimal("upperLimit", { precision: 15, scale: 6 }),
  nominalValue: decimal("nominalValue", { precision: 15, scale: 6 }),
  // Tọa độ điểm đo trên ảnh mẫu (vẽ đường tròn)
  positionX: integer("positionX").notNull(), // Tâm X của đường tròn
  positionY: integer("positionY").notNull(), // Tâm Y của đường tròn
  radius: integer("radius").default(20).notNull(), // Bán kính đường tròn
  // Normalized coordinates (0.0 - 1.0) relative to reference image dimensions
  // Ensures coordinate portability across different image resolutions
  normalizedX: decimal("normalizedX", { precision: 10, scale: 8 }),
  normalizedY: decimal("normalizedY", { precision: 10, scale: 8 }),
  normalizedRadius: decimal("normalizedRadius", { precision: 10, scale: 8 }),
  // Ảnh mẫu riêng cho điểm đo này (crop từ ảnh sản phẩm)
  referenceImageUrl: text("referenceImageUrl"),
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  // Kích thước vùng cắt ảnh mẫu (tâm là positionX, positionY)
  cropWidth: integer("cropWidth").default(100).notNull(), // Chiều rộng vùng cắt
  cropHeight: integer("cropHeight").default(100).notNull(), // Chiều cao vùng cắt
  orderIndex: integer("orderIndex").default(0).notNull(), // Thứ tự điểm đo
  workstationId: integer("workstationId"), // Công trạm thực hiện sản xuất điểm đo này
  // P3: optional instrument used as preferred gage for this point.
  preferredInstrumentId: integer("preferredInstrumentId"),
  // P3: optional sampling plan strategy for this point (e.g., AQL-based, fixed-n, risk-based).
  preferredSamplingPlanId: integer("preferredSamplingPlanId"),
  // Image hash for deduplication (SHA-256)
  imageHash: varchar("imageHash", { length: 64 }),
  // Last modified timestamp for delta sync
  lastModifiedAt: timestamp("lastModifiedAt").defaultNow(),
  // P0 shape extension. "circle" preserves legacy positionX/Y + radius semantics.
  // Future shapes (rectangle, polygon, ellipse) carry their data in `geometry`.
  shape: varchar("shape", { length: 20 }).default("circle").notNull(),
  // P0 generic geometry payload for non-circle shapes. Schema is shape-specific
  // (e.g. rectangle: { x, y, width, height }; polygon: { points: [{x,y},...] }).
  geometry: json("geometry").$type<Record<string, any>>(),
  // ============ P2 — 3D / SOLDER / XRAY / TILT extensions ============
  // All new columns NULLABLE — fully backward-compatible.
  // Optional Z coordinate (e.g. for height map / point cloud anchoring).
  positionZ: decimal("positionZ", { precision: 15, scale: 6 }),
  // Height (e.g. solder height, component standoff)
  heightMin: decimal("heightMin", { precision: 15, scale: 6 }),
  heightMax: decimal("heightMax", { precision: 15, scale: 6 }),
  heightNominal: decimal("heightNominal", { precision: 15, scale: 6 }),
  heightUnit: varchar("heightUnit", { length: 20 }),
  // Area (e.g. solder pad coverage area)
  areaMin: decimal("areaMin", { precision: 15, scale: 6 }),
  areaMax: decimal("areaMax", { precision: 15, scale: 6 }),
  areaNominal: decimal("areaNominal", { precision: 15, scale: 6 }),
  areaUnit: varchar("areaUnit", { length: 20 }),
  // Volume (e.g. solder volume from SPI)
  volumeMin: decimal("volumeMin", { precision: 15, scale: 6 }),
  volumeMax: decimal("volumeMax", { precision: 15, scale: 6 }),
  volumeNominal: decimal("volumeNominal", { precision: 15, scale: 6 }),
  volumeUnit: varchar("volumeUnit", { length: 20 }),
  // Coplanarity / warpage / void % (Xray / SPI metrics)
  coplanarityMax: decimal("coplanarityMax", { precision: 15, scale: 6 }),
  warpageMax: decimal("warpageMax", { precision: 15, scale: 6 }),
  voidPctMax: decimal("voidPctMax", { precision: 15, scale: 6 }),
  // Component placement offset / tilt (post-pick & place inspection)
  offsetXMax: decimal("offsetXMax", { precision: 15, scale: 6 }),
  offsetYMax: decimal("offsetYMax", { precision: 15, scale: 6 }),
  tiltMax: decimal("tiltMax", { precision: 15, scale: 6 }),
  // Coating thickness
  thicknessMin: decimal("thicknessMin", { precision: 15, scale: 6 }),
  thicknessMax: decimal("thicknessMax", { precision: 15, scale: 6 }),
  // Optional reference assets for 3D inspection
  depthMapUrl: text("depthMapUrl"),
  pointCloudUrl: text("pointCloudUrl"),
  // P2 — link to fine-grained measurement type from catalog (free-text code, not enum).
  // Legacy `measurementType` enum stays in sync for back-compat (auto-derived from catalog category).
  measurementTypeCode: varchar("measurementTypeCode", { length: 100 }),
  // ============ P2 — Tolerance v2 ============
  // toleranceMode: "min_only" | "max_only" | "range" | "bilateral".
  // Legacy lowerLimit/upperLimit/nominalValue stay populated for back-compat.
  toleranceMode: varchar("toleranceMode", { length: 20 }),
  tolPlus: decimal("tolPlus", { precision: 15, scale: 6 }),
  tolMinus: decimal("tolMinus", { precision: 15, scale: 6 }),
  // Pass/fail criteria array (discriminated union — see zod schema). Stored as jsonb for indexable filtering.
  criteria: jsonb("criteria").$type<unknown[]>(),
  // P4.C G20 — Specialized point-type subform payload. Schema is per-`measurementTypeCode`,
  // validated by server/utils/mpVariantSubform.ts. NULL = legacy generic point.
  extraFields: jsonb("extraFields").$type<Record<string, unknown>>(),
  // GD&T fields
  datumRefs: text("datumRefs").array(), // e.g. ["A","B","C"]
  materialCondition: varchar("materialCondition", { length: 10 }), // MMC, LMC, RFS
  fitClass: varchar("fitClass", { length: 20 }), // ISO/ANSI fit class for hole/shaft
  // ============ end P2 ============
  // P3.4: optional product view/camera this point is measured from (e.g., top | bottom | side).
  // NULL = point applies to all views (default legacy behavior).
  productViewId: integer("productViewId"),
  // ── Doc 29 §1.2 / W8-A (0191) — component linkage for package-level Pareto ──
  // Which COMPONENT this point measures. componentCode relates BY CODE to
  // materials.code (same convention as bomLineItems/feederMaterials.componentCode);
  // refDesignator is the board position (e.g. "R12", "U3"). Both NULLABLE plain
  // ADD COLUMN (this is a regular table, not a hypertable). The Pareto chain:
  // measurement_results → pointDef.componentCode → materials.packageId → component_packages.
  componentCode: varchar("componentCode", { length: 100 }),
  refDesignator: varchar("refDesignator", { length: 64 }),
  // ── doc 55 Item 3 / PV0 (0286) — product-variant linkage ──────────────────
  // NULL = BASE/common point: shared by the model and inherited by EVERY variant
  // (resolveEffectivePoints returns it unless a variant excludes/patches it via
  // variant_point_overrides). Non-NULL (→ product_variants.id) = a point ADDED by
  // that specific variant (QĐ#11 — added points live HERE, not in the override
  // table). All pre-0286 points are NULL (no backfill). ⚠ May be ABSENT at runtime
  // until 0286 applies; the db layer treats absent/NULL as base, so behaviour is
  // identical to pre-variant. Soft-ref (no hard FK — claim/panel convention).
  variantId: integer("variantId"),
  isActive: boolean("isActive").default(true).notNull(),
  // P0 soft-delete marker. NULL = live row. Set when row is logically deleted.
  deletedAt: timestamp("deletedAt"),
  // Doc 51 P1 / CASE #4 (0274) — the product's pointsConfigVersion AT THE MOMENT
  // this point was soft-deleted. Lets deltaSync ship a tombstone only to machines
  // still below that version. NULL = deleted before 0274 (version unknown) → the
  // tombstone is shipped unconditionally (over-ship beats a point that never dies).
  deletedAtVersion: integer("deletedAtVersion"),
  // ── Pha 1A (0338) — neo cấp component (chính bảng này) lên cây CẤU HÌNH 4 cấp
  // surface → position → capture → component. `captureRowId IS NULL` = điểm đo PHẲNG cũ,
  // chạy y hệt trước khi có cây (không backfill, không đổi hành vi resolveEffectivePoints/
  // variant_point_overrides/spec-gate/revertPointsConfigToVersion). Soft-ref có chủ đích
  // (KHÔNG `.references()`): DB có FK THẬT `REFERENCES product_captures(id) ON DELETE SET
  // NULL` (đặt trong chính migration 0338), nhưng khai `.references()` ở đây sẽ tạo import
  // vòng product.ts ↔ productConfigTree.ts — mirror quy ước soft-ref đã dùng nhiều lần trong
  // chính bảng này (variantId, componentCode, …).
  captureRowId: integer("captureRowId"),
  // = Component.Id / RefDesignator phía máy, gắn với capture cha. Free-text, không FK.
  componentExtId: varchar("componentExtId", { length: 64 }),
  // ROI PIXEL TUYỆT ĐỐI trong khung ảnh capture (khác relX/relY 0..1 của product_positions).
  roiX: integer("roiX"),
  roiY: integer("roiY"),
  roiWidth: integer("roiWidth"),
  roiHeight: integer("roiHeight"),
  // Khối B Task 5 (0347) — `machine_template_versions(id)` đã ghi hàng này lần CUỐI.
  // Soft ref (cùng lý do vòng import với `captureRowId` ở trên). NULL = điểm đo phẳng
  // cũ / hàng chưa qua cửa cây dạy. ⚠ Cột này nói bản HIỆN TẠI; muốn biết một bo CŨ
  // chấm theo bản nào thì tra KHOẢNG `[pushedAt, supersededAt)` của sổ bản dạy.
  templateVersionId: integer("templateVersionId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_point_defs_product").on(table.productModelId),
  index("idx_point_defs_machine").on(table.machineId),
  index("idx_point_defs_code").on(table.code),
  // Doc 51 P2 (0274) → doc 55 PV0 (0286) — a product may hold only ONE live def per
  // (variant, code). PARTIAL on "deletedAt" IS NULL so soft-deleted history never
  // blocks re-creating a code. variantId is folded via COALESCE(variantId, 0) so
  // base points (variantId NULL) keep the exact (productModelId, code) uniqueness
  // 0274 gave them, while a variant may add its own point sharing a base code. Two
  // DIFFERENT variants may reuse the same code; the SAME variant may not.
  // Matches the identity the app assumes (getMeasurementPointDefByCode / resolver /
  // remapMeasurementPoints key on productModelId+variant+code) — this only stops the
  // check-then-insert race from minting a second live row.
  // ⚠ May be ABSENT (or still be the pre-0286 uq_point_defs_product_code) at runtime:
  //   0286 is guarded and keeps the old index when pre-existing duplicates block the
  //   swap. All writers use bare ON CONFLICT DO NOTHING so they behave identically
  //   either way.
  // ⚠ Khối B Task 5 (0347) SIẾT VỊ TỪ, KHÔNG đổi tên: thêm `"captureRowId" IS NULL`
  // ⇒ index này nay chỉ phủ hàng PHẲNG. Đo được: 100% hàng đang sống ở CẢ HAI DB
  // (110 / 2.892) là hàng phẳng, nên nghĩa trên dữ liệu thật KHÔNG đổi một chút nào.
  // Hàng CÂY có index riêng `uq_point_defs_cay_may_code` bên dưới, có thêm chiều MÁY —
  // hai máy dạy cùng sản phẩm rất hay mang CÙNG bộ UUID linh kiện (clone bản dạy), và
  // nếu để chung một index thì máy thứ hai vỡ `23505` ở một index KHÔNG AI NHẮM.
  uniqueIndex("uq_point_defs_product_variant_code")
    .on(table.productModelId, sql`COALESCE("variantId", 0)`, table.code)
    .where(sql`${table.deletedAt} IS NULL AND ${table.captureRowId} IS NULL`),
  uniqueIndex("uq_point_defs_cay_may_code")
    .on(table.productModelId, sql`COALESCE("variantId", 0)`, sql`COALESCE("machineId", 0)`, table.code)
    .where(sql`${table.deletedAt} IS NULL AND ${table.captureRowId} IS NOT NULL`),
  index("idx_point_defs_template_version").on(table.templateVersionId)
    .where(sql`${table.templateVersionId} IS NOT NULL`),
  index("idx_point_defs_last_modified").on(table.lastModifiedAt),
  index("idx_point_defs_product_modified").on(table.productModelId, table.lastModifiedAt),
  index("idx_point_defs_image_hash").on(table.imageHash),
  index("idx_point_defs_deleted_at").on(table.deletedAt),
  index("idx_point_defs_type_code").on(table.measurementTypeCode),
  // W8-A (0191): partial — the column is sparse until points are linked.
  index("idx_point_defs_component_code").on(table.componentCode).where(sql`${table.componentCode} IS NOT NULL`),
  // Pha 1A (0338): partial — sparse until the point is anchored on the config tree.
  index("idx_point_defs_capture").on(table.captureRowId).where(sql`${table.captureRowId} IS NOT NULL`),
  index("idx_point_defs_component_ext").on(table.componentExtId).where(sql`${table.componentExtId} IS NOT NULL`),
  // Pha 1B (migration 0340, BG-13) — cấp component là cấp DUY NHẤT trong cây chưa có đích
  // ON CONFLICT cho Task 5. Partial: chỉ áp cho hàng ĐÃ chuyển sang cây (captureRowId +
  // componentExtId khác NULL) và CHƯA xoá mềm — điểm đo phẳng cũ (captureRowId NULL) không
  // bị ràng buộc này chạm tới, hành vi y hệt trước 0340.
  uniqueIndex("uq_point_defs_capture_component")
    .on(table.captureRowId, table.componentExtId)
    .where(sql`${table.captureRowId} IS NOT NULL AND ${table.componentExtId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
]);

export type MeasurementPointDef = typeof measurementPointDefs.$inferSelect;
export type InsertMeasurementPointDef = typeof measurementPointDefs.$inferInsert;

/**
 * Measurement Point Versions - P0 history snapshot for measurement point edits.
 * One row per logical edit of a measurement_point_defs row.
 * Snapshot is the *previous* state of the row (pre-update), so the latest version
 * captures what was overwritten by the most recent update.
 */
export const measurementPointVersions = pgTable("measurement_point_versions", {
  id: serial("id").primaryKey(),
  pointDefId: integer("pointDefId").notNull(), // FK to measurement_point_defs.id (no cascade — kept for audit)
  version: integer("version").notNull(),       // monotonically increasing per pointDefId
  snapshotJson: json("snapshotJson").$type<Record<string, any>>().notNull(),
  changedBy: integer("changedBy"),             // users.id (nullable for system edits)
  changeReason: varchar("changeReason", { length: 500 }),
  // Doc 51 P2 batch-2 (§12.2 #2, migration 0282) — VERSION-EXACT spec-gate
  // provenance. The product's pointsConfigVersion that the pre-edit limits in
  // snapshotJson were live UNDER (read inside updateMeasurementPointDef's tx, just
  // before the router bumps the product +1). Lets the spec-gate reconstruct limits
  // by the MACHINE-DECLARED version V (smallest stamp >= V) rather than by the
  // server-received instant. NULL = snapshot written before 0282 (unknown version)
  // → the gate falls back to the instant-based reconstruction (0276/P1), no
  // regression. ⚠ May be ABSENT at runtime (0282 guarded): writers only include it
  // when a probe detects the column, and the read path projects it conditionally.
  productPointsConfigVersion: integer("productPointsConfigVersion"),
  changedAt: timestamp("changedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_point_versions_point").on(table.pointDefId),
  index("idx_point_versions_changed_at").on(table.changedAt),
  index("uq_point_versions_point_version").on(table.pointDefId, table.version),
]);

export type MeasurementPointVersion = typeof measurementPointVersions.$inferSelect;
export type InsertMeasurementPointVersion = typeof measurementPointVersions.$inferInsert;

// ============================================================
// doc 55 Item 3 / PV0 (migration 0286) — PRODUCT VARIANTS (PA2 first-class)
// ------------------------------------------------------------
// A variant is a first-class build option of a product model (e.g. a region SKU, a
// with/without-connector option). Every product_models row has EXACTLY ONE BASE
// variant (isBase=true, backfilled by 0286); non-base variants inherit the base
// point set and diverge only through:
//   • variant_point_overrides — exclude / patch a BASE point (QĐ#11), and
//   • measurement_point_defs rows carrying variantId — points the variant ADDS.
// Points config is versioned PER VARIANT (pointsConfigVersion, QĐ#10); the base
// variant's version tracks product_models.pointsConfigVersion (kept in lock-step by
// bumpPointsConfigVersion's fan-out).
// SOFT ref productModelId (no hard FK — claim/enrollment/panel convention).
// ============================================================
export const productVariants = pgTable("product_variants", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  code: varchar("code", { length: 100 }).notNull(), // 'BASE' for the base variant
  name: varchar("name", { length: 255 }),
  isBase: boolean("isBase").default(false).notNull(),
  // QĐ#10 — per-variant points config version (machines re-fetch when it moves).
  pointsConfigVersion: integer("pointsConfigVersion").default(1).notNull(),
  // Optional per-variant OVERRIDE of the model's reference image / coordinate mode.
  // NULL = inherit the product_models value.
  referenceImageUrl: text("referenceImageUrl"),
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  coordinateMode: varchar("coordinateMode", { length: 20 }),
  lifecycleStatus: varchar("lifecycleStatus", { length: 20 }).default("active").notNull(),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  // At most ONE live variant per (model, code). PARTIAL on deletedAt IS NULL so a
  // retired code can be reused. Also the guard behind "one base per model" (code
  // 'BASE' can exist once live per model).
  uniqueIndex("uq_product_variants_model_code")
    .on(table.productModelId, table.code)
    .where(sql`${table.deletedAt} IS NULL`),
  index("idx_product_variants_model").on(table.productModelId),
  index("idx_product_variants_base")
    .on(table.productModelId, table.isBase)
    .where(sql`${table.isBase} = true`),
  index("idx_product_variants_deleted_at").on(table.deletedAt),
]);

export type ProductVariant = typeof productVariants.$inferSelect;
export type InsertProductVariant = typeof productVariants.$inferInsert;

/**
 * doc 55 PV0 (0286) — how a non-base variant diverges from a BASE/common point.
 *   • action='exclude'  → the variant DROPS this base point.
 *   • action='override' → the variant PATCHES the base point (patchJson carries the
 *     changed limit/geometry fields, shallow-merged onto the base def).
 * A variant's ADDED points are NOT here — they are measurement_point_defs rows with
 * variantId set (QĐ#11). Soft-ref variantId → product_variants.id and
 * basePointDefId → measurement_point_defs.id (a base point, variantId NULL).
 */
export const variantPointOverrides = pgTable("variant_point_overrides", {
  id: serial("id").primaryKey(),
  variantId: integer("variantId").notNull(),
  basePointDefId: integer("basePointDefId").notNull(),
  // 'exclude' | 'override' (CHECK enforced in 0286).
  action: varchar("action", { length: 20 }).notNull(),
  // Patch payload for action='override' (e.g. { lowerLimit, upperLimit, geometry }).
  // NULL for 'exclude'.
  patchJson: jsonb("patchJson").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_variant_overrides_variant_point").on(table.variantId, table.basePointDefId),
  index("idx_variant_overrides_variant").on(table.variantId),
  index("idx_variant_overrides_base_point").on(table.basePointDefId),
]);

export type VariantPointOverride = typeof variantPointOverrides.$inferSelect;
export type InsertVariantPointOverride = typeof variantPointOverrides.$inferInsert;

// ============================================================
// P4.A G17 — Measurement Point Lighting / Illumination Profile
// One MP can have N shots (multi-shot inspection) — each with its own
// light source / color / intensity / exposure / gain / filter.
// Consumed by AOI/AVI machines via MQTT recipe payload.
// ============================================================
export const mpLightingProfiles = pgTable("mp_lighting_profiles", {
  id: serial("id").primaryKey(),
  pointDefId: integer("pointDefId").notNull(),
  shotIndex: integer("shotIndex").default(1).notNull(),
  name: varchar("name", { length: 120 }),
  // ring | coaxial | dome | side_low_angle | back | uv | ir | multi_spectral | dark_field
  lightSource: varchar("lightSource", { length: 40 }).default("ring").notNull(),
  // white | red | green | blue | rgb | ir | uv | custom
  color: varchar("color", { length: 20 }).default("white").notNull(),
  colorHex: varchar("colorHex", { length: 7 }),
  intensityPct: integer("intensityPct").default(100).notNull(),
  angleDeg: integer("angleDeg"),
  exposureUs: integer("exposureUs"),
  gain: decimal("gain", { precision: 8, scale: 3 }),
  focusOffsetUm: integer("focusOffsetUm"),
  opticalFilter: varchar("opticalFilter", { length: 60 }),
  // presence | scratch | color | ocr | solder_height | ...
  purpose: varchar("purpose", { length: 60 }),
  referenceImageUrl: text("referenceImageUrl"),
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  index("idx_mp_lighting_point").on(table.pointDefId),
  index("idx_mp_lighting_active").on(table.isActive),
  index("idx_mp_lighting_deleted_at").on(table.deletedAt),
]);

export type MpLightingProfile = typeof mpLightingProfiles.$inferSelect;
export type InsertMpLightingProfile = typeof mpLightingProfiles.$inferInsert;

// ============================================================
// P2 — Measurement Type Catalog (free-text categories)
// ------------------------------------------------------------
// Replaces the rigid `measurementTypeEnum` with an editable lookup table.
// `measurement_point_defs.measurementTypeCode` references `code` here.
// Legacy enum column on point defs stays in sync (auto-derived from `category`).
// ============================================================
export const measurementTypeCatalog = pgTable("measurement_type_catalog", {
  id: serial("id").primaryKey(),
  // High-level family — maps 1:1 to legacy enum values for back-compat.
  // Allowed: DIMENSION, GD_T, VISUAL, PRESENCE, SOLDER, XRAY, THERMAL,
  //          ELECTRICAL, POSITION, COLOR, SURFACE, COATING, OTHER.
  category: varchar("category", { length: 50 }).notNull(),
  subType: varchar("subType", { length: 80 }).notNull(),
  // Stable machine-friendly identifier referenced by point defs.
  code: varchar("code", { length: 100 }).notNull(),
  nameEn: varchar("nameEn", { length: 200 }),
  nameVi: varchar("nameVi", { length: 200 }),
  defaultUnit: varchar("defaultUnit", { length: 20 }),
  // valueKind: "numeric" | "text" | "boolean" | "composite"
  valueKind: varchar("valueKind", { length: 20 }),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  uniqueIndex("uq_meas_type_catalog_code").on(table.code),
  index("idx_meas_type_catalog_category").on(table.category),
  index("idx_meas_type_catalog_active").on(table.isActive),
  index("idx_meas_type_catalog_deleted_at").on(table.deletedAt),
]);

export type MeasurementTypeCatalog = typeof measurementTypeCatalog.$inferSelect;
export type InsertMeasurementTypeCatalog = typeof measurementTypeCatalog.$inferInsert;

// ============================================================
// P2 — Defect Catalog (IPC-A-610 aligned defect taxonomy)
// ------------------------------------------------------------
// Referenced from `measurement_results.defectCatalogId` (nullable FK).
// ============================================================
export const defectCatalog = pgTable("defect_catalog", {
  id: serial("id").primaryKey(),
  // Stable machine-friendly identifier (e.g. "BRIDGING", "TOMBSTONING").
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  // Severity: critical | major | minor | cosmetic
  severity: varchar("severity", { length: 20 }).notNull(),
  // Defect category (e.g. "solder", "component", "pcb", "marking").
  category: varchar("category", { length: 80 }).notNull(),
  // IPC-A-610 reference (e.g. "5.2.5", "8.3.5.4").
  ipcReference: varchar("ipcReference", { length: 50 }),
  // Acceptance class per IPC: "1" | "2" | "3".
  // Legacy meaning: "the strictest class this defect is flagged on" (so a
  // value of "2" means it is flagged for both Class 2 and Class 3). For
  // per-class verdict / threshold differences (Class 2 = general electronics,
  // Class 3 = high-reliability automotive/aerospace/medical) use `classRules`.
  acceptanceClass: varchar("acceptanceClass", { length: 2 }),
  // P4.A G11 (extension): per-IPC-class effective rule. Shape:
  //   { class2?: { accept: 'accept'|'process'|'reject',
  //                severity?: 'critical'|'major'|'minor'|'cosmetic',
  //                limit?: string, notes?: string },
  //     class3?: { ... } }
  // When absent, callers fall back to the legacy `acceptanceClass` field.
  classRules: jsonb("classRules"),
  // P4.A G11: top-level IPC-A-610 section ("5","7","8","9","10","11","12","13","14",
  // "MECH","COSM","MARK","3D","ELEC") for filtering / reports.
  ipcSection: varchar("ipcSection", { length: 20 }),
  // Process / package types this defect applies to (e.g. ['SMT','THT','BGA','QFN',
  // 'PCB','MECH','HOUSING','COSMETIC','WIRING','ASSEMBLY','COMPONENT']).
  appliesTo: text("appliesTo").array(),
  // Stations capable of detecting this defect (AOI, AVI, AXI, SPI, ICT, FCT, OCR,
  // 3D, CMM, GLOSS, SPECTRO).
  detectableBy: text("detectableBy").array(),
  description: text("description"),
  // P4.A G11: i18n labels — primary language stays in `name`/`description`.
  nameVi: varchar("nameVi", { length: 255 }),
  nameZh: varchar("nameZh", { length: 255 }),
  descriptionVi: text("descriptionVi"),
  descriptionZh: text("descriptionZh"),
  // Optional photo / illustration in storage.
  referenceImageUrl: text("referenceImageUrl"),
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  // Doc 31 Đợt B (OP4, migration 0194) — free-text repair / disposition guidance
  // shown at RepairStation / InspectionDetail when this defect is classified.
  repairGuidance: text("repairGuidance"),
  repairGuidanceVi: text("repairGuidanceVi"),
  // Doc 31 Đợt E (WE-3, migration 0201) — taxonomy consolidation. When a duplicate
  // code is retired (isActive=false), this points at the SURVIVING canonical code so
  // an incoming duplicate code still resolves forward (see getDefectCatalogByCode).
  aliasOfCode: varchar("aliasOfCode", { length: 50 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  uniqueIndex("uq_defect_catalog_code").on(table.code),
  index("idx_defect_catalog_severity").on(table.severity),
  index("idx_defect_catalog_category").on(table.category),
  index("idx_defect_catalog_active").on(table.isActive),
  index("idx_defect_catalog_deleted_at").on(table.deletedAt),
  index("idx_defect_catalog_ipc_section").on(table.ipcSection),
  index("idx_defect_catalog_alias_of_code").on(table.aliasOfCode).where(sql`${table.aliasOfCode} IS NOT NULL`),
]);

export type DefectCatalog = typeof defectCatalog.$inferSelect;
export type InsertDefectCatalog = typeof defectCatalog.$inferInsert;

// ============================================================
// Doc 31 Đợt B (OP3, migration 0194) — Unmatched defect-code rollup
// ------------------------------------------------------------
// When an inspection reports a defect code that does NOT resolve to a
// defect_catalog row, ingest records it here (aggregate: one row per code) so
// engineers get visibility ("code X seen 400× but not in catalog") and can
// curate it in. machineId/productModelId are LAST-seen sample context.
// resolvedCatalogId is stamped once the code is added to the catalog.
// ============================================================
export const unmatchedDefectCodes = pgTable("unmatched_defect_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull(),
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  seenCount: integer("seenCount").default(0).notNull(),
  resolvedCatalogId: integer("resolvedCatalogId"),
  firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_unmatched_defect_code").on(table.code),
  index("idx_unmatched_defect_last_seen").on(table.lastSeenAt),
]);

export type UnmatchedDefectCode = typeof unmatchedDefectCodes.$inferSelect;
export type InsertUnmatchedDefectCode = typeof unmatchedDefectCodes.$inferInsert;

// ============================================================
// P3.1 — Measurement Instrument Registry
// ------------------------------------------------------------
// Centralized gage/instrument list used by product measurement plans.
// ============================================================
export const measurementInstruments = pgTable("measurement_instruments", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  instrumentType: varchar("instrumentType", { length: 80 }).notNull(),
  manufacturer: varchar("manufacturer", { length: 120 }),
  model: varchar("model", { length: 120 }),
  serialNumber: varchar("serialNumber", { length: 120 }),
  defaultUnit: varchar("defaultUnit", { length: 20 }),
  resolution: decimal("resolution", { precision: 15, scale: 6 }),
  uncertainty: decimal("uncertainty", { precision: 15, scale: 6 }),
  // P3.2: mmPerPixel calibration (e.g., 0.05 mm/pixel at working distance 100mm)
  mmPerPixel: decimal("mmPerPixel", { precision: 15, scale: 8 }),
  calibrationPeriodDays: integer("calibrationPeriodDays"),
  lastCalibrationAt: timestamp("lastCalibrationAt"),
  nextCalibrationAt: timestamp("nextCalibrationAt"),
  msaMethod: varchar("msaMethod", { length: 50 }),
  notes: text("notes"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  uniqueIndex("uq_measurement_instruments_code").on(table.code),
  index("idx_measurement_instruments_type").on(table.instrumentType),
  index("idx_measurement_instruments_active").on(table.isActive),
  index("idx_measurement_instruments_deleted_at").on(table.deletedAt),
]);

export type MeasurementInstrument = typeof measurementInstruments.$inferSelect;
export type InsertMeasurementInstrument = typeof measurementInstruments.$inferInsert;

// ============================================================
// P4.A G19 — Instrument Calibration Certificates (append-only log)
// Required for IATF 16949 / ISO 17025 traceability.
// ============================================================
export const instrumentCalibrations = pgTable("instrument_calibrations", {
  id: serial("id").primaryKey(),
  instrumentId: integer("instrumentId").notNull(),
  certNumber: varchar("certNumber", { length: 120 }).notNull(),
  certPdfUrl: text("certPdfUrl"),
  certPdfKey: varchar("certPdfKey", { length: 255 }),
  // Traceability chain (e.g. "NIST", "VMI", "PJLA", "DKD").
  traceability: varchar("traceability", { length: 80 }),
  performedAt: timestamp("performedAt").notNull(),
  validUntil: timestamp("validUntil").notNull(),
  performedBy: varchar("performedBy", { length: 255 }),
  performedByOrg: varchar("performedByOrg", { length: 255 }),
  referenceStandard: varchar("referenceStandard", { length: 255 }),
  asFoundBias: decimal("asFoundBias", { precision: 15, scale: 6 }),
  asLeftBias: decimal("asLeftBias", { precision: 15, scale: 6 }),
  uncertainty: decimal("uncertainty", { precision: 15, scale: 6 }),
  // Result: pass | conditional | fail
  result: varchar("result", { length: 20 }).default("pass").notNull(),
  notes: text("notes"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  index("idx_instr_cal_instrument").on(table.instrumentId),
  index("idx_instr_cal_valid_until").on(table.validUntil),
  index("idx_instr_cal_performed_at").on(table.performedAt),
  index("idx_instr_cal_deleted_at").on(table.deletedAt),
]);

export type InstrumentCalibration = typeof instrumentCalibrations.$inferSelect;
export type InsertInstrumentCalibration = typeof instrumentCalibrations.$inferInsert;

// ============================================================
// P4.A G19 — Instrument MSA Records (lifecycle gate)
// Tracks Gauge R&R / ANOVA / Bias / Linearity / Stability validity.
// ============================================================
export const instrumentMsaRecords = pgTable("instrument_msa_records", {
  id: serial("id").primaryKey(),
  instrumentId: integer("instrumentId").notNull(),
  msaStudyId: integer("msaStudyId"),
  // Method: ARM | ANOVA | BIAS | LINEARITY | STABILITY
  method: varchar("method", { length: 20 }).default("ARM").notNull(),
  performedAt: timestamp("performedAt").defaultNow().notNull(),
  validUntil: timestamp("validUntil").notNull(),
  evPct: decimal("evPct", { precision: 8, scale: 4 }),
  avPct: decimal("avPct", { precision: 8, scale: 4 }),
  grrPct: decimal("grrPct", { precision: 8, scale: 4 }),
  ndc: integer("ndc"),
  ptRatio: decimal("ptRatio", { precision: 8, scale: 4 }),
  biasValue: decimal("biasValue", { precision: 15, scale: 6 }),
  linearityScore: decimal("linearityScore", { precision: 8, scale: 4 }),
  stabilityScore: decimal("stabilityScore", { precision: 8, scale: 4 }),
  // Verdict: good (<10%), acceptable (10-30%), poor (>30%), unknown
  verdict: varchar("verdict", { length: 20 }).default("unknown").notNull(),
  approvedBy: integer("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  notes: text("notes"),
  reportPdfUrl: text("reportPdfUrl"),
  reportPdfKey: varchar("reportPdfKey", { length: 255 }),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  index("idx_instr_msa_instrument").on(table.instrumentId),
  index("idx_instr_msa_valid_until").on(table.validUntil),
  index("idx_instr_msa_study").on(table.msaStudyId),
  index("idx_instr_msa_deleted_at").on(table.deletedAt),
]);

export type InstrumentMsaRecord = typeof instrumentMsaRecords.$inferSelect;
export type InsertInstrumentMsaRecord = typeof instrumentMsaRecords.$inferInsert;

// ============================================================
// P3.3 — Sampling Plan per Product Model
// ============================================================
export const samplingPlans = pgTable("sampling_plans", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  code: varchar("code", { length: 60 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  strategy: varchar("strategy", { length: 30 }).default("fixed_n").notNull(),
  lotSize: integer("lotSize"),
  aqlCritical: decimal("aqlCritical", { precision: 6, scale: 3 }),
  aqlMajor: decimal("aqlMajor", { precision: 6, scale: 3 }),
  aqlMinor: decimal("aqlMinor", { precision: 6, scale: 3 }),
  sampleSize: integer("sampleSize"),
  acceptanceQty: integer("acceptanceQty"),
  rejectionQty: integer("rejectionQty"),
  // Additional rules in JSON to support future MIL-STD / IPC sampling variants.
  rules: jsonb("rules").$type<Record<string, any>>(),
  version: integer("version").default(1).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  uniqueIndex("uq_sampling_plans_product_code").on(table.productModelId, table.code),
  index("idx_sampling_plans_product").on(table.productModelId),
  index("idx_sampling_plans_active").on(table.isActive),
]);

export type SamplingPlan = typeof samplingPlans.$inferSelect;
export type InsertSamplingPlan = typeof samplingPlans.$inferInsert;

// ============================================================
// P3.4 — Multi-view product references (top/bottom/side/CAD projection)
// ============================================================
export const productViews = pgTable("product_views", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  // top | bottom | side | isometric | custom
  viewType: varchar("viewType", { length: 30 }).default("top").notNull(),
  referenceImageUrl: text("referenceImageUrl"),
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  // Optional transform matrix / calibration metadata for CAD-overlay and multi-view alignment.
  transform: jsonb("transform").$type<Record<string, any>>(),
  orderIndex: integer("orderIndex").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  uniqueIndex("uq_product_views_product_code").on(table.productModelId, table.code),
  index("idx_product_views_product").on(table.productModelId),
  index("idx_product_views_order").on(table.productModelId, table.orderIndex),
]);

export type ProductView = typeof productViews.$inferSelect;
export type InsertProductView = typeof productViews.$inferInsert;

// ============================================================
// P3.6 — MSA Wizard (Gage R&R study scaffold)
// ============================================================
export const msaStudies = pgTable("msa_studies", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  measurementPointDefId: integer("measurementPointDefId"),
  instrumentId: integer("instrumentId"),
  studyCode: varchar("studyCode", { length: 60 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  studyType: varchar("studyType", { length: 30 }).default("gage_rr").notNull(),
  operatorCount: integer("operatorCount").default(3).notNull(),
  partCount: integer("partCount").default(10).notNull(),
  trialCount: integer("trialCount").default(2).notNull(),
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  summary: jsonb("summary").$type<Record<string, any>>(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  uniqueIndex("uq_msa_studies_product_code").on(table.productModelId, table.studyCode),
  index("idx_msa_studies_product").on(table.productModelId),
  index("idx_msa_studies_status").on(table.status),
  index("idx_msa_studies_deleted_at").on(table.deletedAt),
]);

export type MsaStudy = typeof msaStudies.$inferSelect;
export type InsertMsaStudy = typeof msaStudies.$inferInsert;

export const msaObservations = pgTable("msa_observations", {
  id: serial("id").primaryKey(),
  studyId: integer("studyId").notNull(),
  operatorName: varchar("operatorName", { length: 120 }).notNull(),
  partLabel: varchar("partLabel", { length: 120 }).notNull(),
  trialNo: integer("trialNo").notNull(),
  measuredValue: decimal("measuredValue", { precision: 15, scale: 6 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_msa_observations_matrix_cell").on(table.studyId, table.operatorName, table.partLabel, table.trialNo),
  index("idx_msa_observations_study").on(table.studyId),
  index("idx_msa_observations_operator").on(table.operatorName),
  index("idx_msa_observations_part").on(table.partLabel),
]);

export type MsaObservation = typeof msaObservations.$inferSelect;
export type InsertMsaObservation = typeof msaObservations.$inferInsert;

// ============================================================
// P3.6/Step 12 — Shared CSV Mapping Presets for MSA import
// ============================================================
export const msaCsvMappingPresets = pgTable("msa_csv_mapping_presets", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  sourceMachine: varchar("sourceMachine", { length: 120 }).notNull(),
  presetName: varchar("presetName", { length: 120 }).notNull(),
  instrumentId: integer("instrumentId"),
  hasHeader: boolean("hasHeader").default(true).notNull(),
  columnMap: jsonb("columnMap").$type<{
    operator: number;
    part: number;
    trial: number;
    value: number;
    notes: number;
  }>().notNull(),
  createdBy: integer("createdBy"),
  updatedBy: integer("updatedBy"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => [
  uniqueIndex("uq_msa_csv_mapping_presets_scope").on(table.productModelId, table.sourceMachine, table.presetName),
  index("idx_msa_csv_mapping_presets_product").on(table.productModelId),
  index("idx_msa_csv_mapping_presets_source").on(table.sourceMachine),
  index("idx_msa_csv_mapping_presets_deleted_at").on(table.deletedAt),
]);

export type MsaCsvMappingPreset = typeof msaCsvMappingPresets.$inferSelect;
export type InsertMsaCsvMappingPreset = typeof msaCsvMappingPresets.$inferInsert;

/**
 * Product-Machine Mapping - Gán sản phẩm cho máy
 * Một máy có thể kiểm tra nhiều sản phẩm, một sản phẩm có thể được kiểm tra trên nhiều máy
 */
export const productMachineMappings = pgTable("product_machine_mappings", {
  id: serial("id").primaryKey(),
  // W3-A (doc 27 M1/M6, 0180): real FKs both sides, ON DELETE CASCADE — a
  // mapping is a pure join row and dies with either end.
  productModelId: integer("productModelId").notNull()
    .references(() => productModels.id, { onDelete: "cascade" }),
  machineId: integer("machineId").notNull()
    .references(() => machines.id, { onDelete: "cascade" }),
  isActive: boolean("isActive").default(true).notNull(),
  priority: integer("priority").default(0).notNull(), // Ưu tiên sản phẩm trên máy
  // Doc 54 P2.2 (OEE-trust, migration 0285) — CONFIGURED ideal/standard cycle time
  // (giây/đơn vị) cho ĐÚNG cặp (sản phẩm, máy) này. Đây là nguồn CHỦ ĐỘNG cho hệ số
  // Performance của OEE (Performance = ideal × count / runTime). Trước đây "ideal" duy
  // nhất chỉ đến từ việc ĐỌC LẠI một dòng oee_metrics cũ (bài toán con-gà-quả-trứng) hoặc
  // ideal-suy-ra từ oee_targets. NULL = chưa cấu hình → Performance rơi về các nguồn cũ
  // (target-implied / oee_metrics gần nhất / avg cycle quan sát) và HONEST-NULL khi không
  // có gì phân giải — KHÔNG bao giờ bịa một ideal giả làm phồng OEE.
  // ⚠ CÓ THỂ VẮNG lúc chạy: 0285 chỉ ADD COLUMN nhưng app dò cột trước khi đọc
  //   (resolveIdealCycleTimeSec → productMachineMappingHasIdealColumn) và rơi về nguồn cũ
  //   khi cột chưa có, nên hành vi y hệt cho tới khi migration được áp.
  idealCycleTimeSec: integer("idealCycleTimeSec"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pm_mapping_product").on(table.productModelId),
  index("idx_pm_mapping_machine").on(table.machineId),
  // W3-A (doc 27 M6, 0180): a (product, machine) pair exists at most ONCE —
  // FULL unique (re-mapping must reactivate/update the existing row, not
  // insert a duplicate). Conditional build: 0180 defers if duplicates exist.
  uniqueIndex("uq_pm_mappings_pair").on(table.productModelId, table.machineId),
]);

export type ProductMachineMapping = typeof productMachineMappings.$inferSelect;
export type InsertProductMachineMapping = typeof productMachineMappings.$inferInsert;

/**
 * Measurement Point Template - Mẫu điểm đo có thể tái sử dụng
 */
export const measurementPointTemplates = pgTable("measurement_point_templates", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }), // VD: "Electronics", "Mechanical", "Optical"
  points: json("points").$type<Array<{
    code: string;
    name: string;
    description?: string;
    measurementType: "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER";
    unit?: string;
    lowerLimit?: string;
    upperLimit?: string;
    nominalValue?: string;
    positionX: number;
    positionY: number;
    radius: number;
    cropWidth: number;
    cropHeight: number;
    orderIndex: number;
  }>>().notNull(), // Danh sách điểm đo trong template
  pointCount: integer("pointCount").notNull(), // Số lượng điểm đo
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_templates_code").on(table.code),
  index("idx_templates_category").on(table.category),
  index("idx_templates_active").on(table.isActive),
]);

export type MeasurementPointTemplate = typeof measurementPointTemplates.$inferSelect;
export type InsertMeasurementPointTemplate = typeof measurementPointTemplates.$inferInsert;

/**
 * Product Categories - Danh mục sản phẩm tập trung
 */
export const productCategories = pgTable("product_categories", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Parent category for hierarchical structure
  parentId: integer("parentId"), // FK to self (null = root category)
  // Display settings
  color: varchar("color", { length: 20 }).default("#3b82f6"),
  icon: varchar("icon", { length: 50 }), // Lucide icon name
  orderIndex: integer("orderIndex").default(0).notNull(),
  // Stats
  productCount: integer("productCount").default(0).notNull(), // Cached count of products in this category
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_product_categories_code").on(table.code),
  index("idx_product_categories_parent").on(table.parentId),
  index("idx_product_categories_order").on(table.orderIndex),
  index("idx_product_categories_active").on(table.isActive),
]);

export type ProductCategory = typeof productCategories.$inferSelect;
export type InsertProductCategory = typeof productCategories.$inferInsert;

/**
 * Sync Logs - Lịch sử đồng bộ điểm đo và ảnh giữa máy và server
 */
export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 50 }).notNull(),
  productModelId: integer("productModelId"),
  productModelCode: varchar("productModelCode", { length: 100 }),
  syncOperation: syncOperationEnum("syncOperation").notNull(),
  syncStatus: syncStatusEnum("syncStatus").default("SUCCESS").notNull(),
  // Sync details
  pointsSynced: integer("pointsSynced").default(0),
  pointsCreated: integer("pointsCreated").default(0),
  pointsUpdated: integer("pointsUpdated").default(0),
  pointsFailed: integer("pointsFailed").default(0),
  errorDetails: json("errorDetails").$type<Array<{ code: string; message: string }>>(),
  // Coordinate transformation info
  sourceImageWidth: integer("sourceImageWidth"),
  sourceImageHeight: integer("sourceImageHeight"),
  serverImageWidth: integer("serverImageWidth"),
  serverImageHeight: integer("serverImageHeight"),
  coordTransformations: integer("coordTransformations").default(0),
  // Delta sync info
  fromVersion: integer("fromVersion"),
  toVersion: integer("toVersion"),
  // Image sync info
  imageHashBefore: varchar("imageHashBefore", { length: 64 }),
  imageHashAfter: varchar("imageHashAfter", { length: 64 }),
  imageSizeBytes: integer("imageSizeBytes"),
  imageSkipped: boolean("imageSkipped").default(false),
  // Performance
  durationMs: integer("durationMs"),
  requestSizeBytes: integer("requestSizeBytes"),
  // Metadata
  clientVersion: varchar("clientVersion", { length: 50 }),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_sync_logs_machine").on(table.machineId),
  index("idx_sync_logs_machine_code").on(table.machineCode),
  index("idx_sync_logs_product").on(table.productModelId),
  index("idx_sync_logs_operation").on(table.syncOperation),
  index("idx_sync_logs_status").on(table.syncStatus),
  index("idx_sync_logs_created_at").on(table.createdAt),
  index("idx_sync_logs_machine_product").on(table.machineId, table.productModelId),
]);

export type SyncLog = typeof syncLogs.$inferSelect;
export type InsertSyncLog = typeof syncLogs.$inferInsert;

/**
 * Product Documents - Tài liệu đính kèm sản phẩm (PDF, Word, etc.)
 */
export const productDocuments = pgTable("product_documents", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSize: integer("fileSize"),          // bytes
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  uploadedBy: integer("uploadedBy"),      // user id
  uploadedByName: varchar("uploadedByName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_product_documents_product").on(table.productModelId),
]);

export type ProductDocument = typeof productDocuments.$inferSelect;
export type InsertProductDocument = typeof productDocuments.$inferInsert;

// (P4.B tables appended)

// ============================================================
// P4.B G14 — Time-series measurement samples (declarative-partitioned by month)
// Drizzle treats this as a regular table; partitioning is handled in SQL migration.
// ============================================================
export const measurementSamples = pgTable("measurement_samples", {
  id: bigint("id", { mode: "number" }).notNull(),
  pointDefId: integer("pointDefId").notNull(),
  machineId: integer("machineId"),
  inspectionId: integer("inspectionId"),
  serialNumber: varchar("serialNumber", { length: 128 }),
  // Station code: SPI | AOI_PRE | AOI_POST | AXI | ICT | FCT
  stationCode: varchar("stationCode", { length: 50 }),
  value: decimal("value", { precision: 15, scale: 6 }).notNull(),
  isOk: boolean("isOk"),
  operatorId: integer("operatorId"),
  instrumentId: integer("instrumentId"),
  lotCode: varchar("lotCode", { length: 80 }),
  shiftCode: varchar("shiftCode", { length: 20 }),
  envTempC: decimal("envTempC", { precision: 6, scale: 2 }),
  envRhPct: decimal("envRhPct", { precision: 5, scale: 2 }),
  sampledAt: timestamp("sampledAt").notNull(),
});

export type MeasurementSample = typeof measurementSamples.$inferSelect;
export type InsertMeasurementSample = typeof measurementSamples.$inferInsert;

// ============================================================
// P4.B G14 — SPC alerts sink (Western Electric / Nelson rule violations)
// ============================================================
export const mpSpcAlerts = pgTable("mp_spc_alerts", {
  id: serial("id").primaryKey(),
  pointDefId: integer("pointDefId").notNull(),
  machineId: integer("machineId"),
  // ruleCode: WE_1 | WE_2 | WE_3 | WE_4 | NELSON_1..NELSON_8 | EWMA_OOC
  ruleCode: varchar("ruleCode", { length: 40 }).notNull(),
  ruleName: varchar("ruleName", { length: 120 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("warn").notNull(),
  windowFrom: timestamp("windowFrom").notNull(),
  windowTo: timestamp("windowTo").notNull(),
  sampleIds: bigint("sampleIds", { mode: "number" }).array(),
  summary: jsonb("summary").$type<Record<string, any>>(),
  ackBy: integer("ackBy"),
  ackAt: timestamp("ackAt"),
  ackNote: text("ackNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mp_spc_alerts_point").on(table.pointDefId),
  index("idx_mp_spc_alerts_rule").on(table.ruleCode),
  index("idx_mp_spc_alerts_window").on(table.windowFrom, table.windowTo),
]);

export type MpSpcAlert = typeof mpSpcAlerts.$inferSelect;
export type InsertMpSpcAlert = typeof mpSpcAlerts.$inferInsert;

// ============================================================
// P4.B G14 — Cached rolling SPC stats per MP
// ============================================================
export const mpSpcRolling = pgTable("mp_spc_rolling", {
  id: serial("id").primaryKey(),
  pointDefId: integer("pointDefId").notNull(),
  windowSize: integer("windowSize").default(30).notNull(),
  n: integer("n").notNull(),
  mean: decimal("mean", { precision: 18, scale: 6 }),
  stdDev: decimal("stdDev", { precision: 18, scale: 6 }),
  minValue: decimal("minValue", { precision: 18, scale: 6 }),
  maxValue: decimal("maxValue", { precision: 18, scale: 6 }),
  cp: decimal("cp", { precision: 10, scale: 4 }),
  cpk: decimal("cpk", { precision: 10, scale: 4 }),
  pp: decimal("pp", { precision: 10, scale: 4 }),
  ppk: decimal("ppk", { precision: 10, scale: 4 }),
  ewmaLast: decimal("ewmaLast", { precision: 18, scale: 6 }),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
  validUntil: timestamp("validUntil"),
}, (table) => [
  uniqueIndex("uq_mp_spc_rolling_point_window").on(table.pointDefId, table.windowSize),
  index("idx_mp_spc_rolling_computed").on(table.computedAt),
]);

export type MpSpcRolling = typeof mpSpcRolling.$inferSelect;
export type InsertMpSpcRolling = typeof mpSpcRolling.$inferInsert;

// ============================================================
// P4.B G18 — Threshold suggestion approval workflow
// ============================================================
export const thresholdApprovals = pgTable("threshold_approvals", {
  id: serial("id").primaryKey(),
  pointDefId: integer("pointDefId").notNull(),
  requestedBy: integer("requestedBy").notNull(),
  suggestion: jsonb("suggestion").$type<Record<string, any>>().notNull(),
  currentLsl: decimal("currentLsl", { precision: 18, scale: 6 }),
  currentUsl: decimal("currentUsl", { precision: 18, scale: 6 }),
  currentNominal: decimal("currentNominal", { precision: 18, scale: 6 }),
  // 0348 (Lô 7 Mục 1, BG-111) — NULLABLE: một yêu cầu duyệt có thể chỉ đề xuất
  // field khác LSL/USL (vd heightMax) qua suggestion.deXuat. Đường ghi legacy
  // (client cũ gửi proposedLsl/Usl) vẫn hoạt động y nguyên — cột KHÔNG bị xoá.
  proposedLsl: decimal("proposedLsl", { precision: 18, scale: 6 }),
  proposedUsl: decimal("proposedUsl", { precision: 18, scale: 6 }),
  proposedNominal: decimal("proposedNominal", { precision: 18, scale: 6 }),
  // requested | approved | rejected | applied | withdrawn
  status: varchar("status", { length: 20 }).default("requested").notNull(),
  comment: text("comment"),
  decidedBy: integer("decidedBy"),
  decidedAt: timestamp("decidedAt"),
  decidedComment: text("decidedComment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_threshold_approvals_pointdef").on(table.pointDefId),
  index("idx_threshold_approvals_status").on(table.status),
  index("idx_threshold_approvals_requestedby").on(table.requestedBy),
]);

export type ThresholdApproval = typeof thresholdApprovals.$inferSelect;
export type InsertThresholdApproval = typeof thresholdApprovals.$inferInsert;

// ============================================================
// W3-C (doc 27 §2 M9) — Inspection-program approval/release workflow.
// ------------------------------------------------------------
// A "program release" is an immutable, checksummed SNAPSHOT of the FULL
// measurement-point set (+ thresholds) of a product model at a point in time,
// promoted through draft → pending_approval → approved → released →
// superseded (or rejected). Mirrors the proven machine_recipes pattern:
//   • SoD: creator ≠ approver (enforced in inspectionProgramService)
//   • Atomic release: FOR UPDATE lock per productModelId; the previously
//     released version of the SAME scope is superseded in the same tx
//   • Append-only: rows are never deleted; every transition is audited
// Editing measurement_point_defs stays allowed (implicit draft state) — the
// release ledger records what was signed off, and getActiveRelease exposes
// the production-truth program version to ingest/analytics.
// status/varchar on purpose (no new pg enum → migration stays additive).
// ============================================================
export const inspectionProgramReleases = pgTable("inspection_program_releases", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  // NULL = product-level program; set = machine-specific program (mirrors the
  // optional machineId scoping on measurement_point_defs / productMachineMappings).
  machineId: integer("machineId"),
  // Monotonic per productModelId (across machine scopes) — computed in service.
  version: integer("version").notNull(),
  // draft | pending_approval | approved | released | superseded | rejected
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  // Full point-set + thresholds captured at createRelease time (immutable).
  snapshot: jsonb("snapshot").$type<Record<string, any>>().notNull(),
  // sha256 of the stable-stringified snapshot points (dedup/diff/tamper check).
  checksum: varchar("checksum", { length: 64 }).notNull(),
  pointCount: integer("pointCount").default(0).notNull(),
  notes: text("notes"),
  createdBy: integer("createdBy"),
  submittedAt: timestamp("submittedAt"),
  // MUST differ from createdBy — segregation of duties (service-enforced).
  approvedBy: integer("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  approvalNote: text("approvalNote"),
  rejectedBy: integer("rejectedBy"),
  rejectedAt: timestamp("rejectedAt"),
  rejectReason: text("rejectReason"),
  releasedBy: integer("releasedBy"),
  releasedAt: timestamp("releasedAt"),
  supersededAt: timestamp("supersededAt"),
  // Genealogy: the release this one superseded when it went live (nullable).
  previousReleaseId: integer("previousReleaseId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_prog_rel_product").on(table.productModelId),
  index("idx_prog_rel_machine").on(table.machineId),
  index("idx_prog_rel_status").on(table.status),
  index("idx_prog_rel_created_by").on(table.createdBy),
  uniqueIndex("uq_prog_rel_product_version").on(table.productModelId, table.version),
  // At most ONE released program per (productModelId, machine-scope); NULL machineId
  // is folded to 0 so the product-level scope is also single-released (see 0182).
  uniqueIndex("uq_prog_rel_one_released")
    .on(table.productModelId, sql`(COALESCE("machineId", 0))`)
    .where(sql`"status" = 'released'`),
]);

export type InspectionProgramRelease = typeof inspectionProgramReleases.$inferSelect;
export type InsertInspectionProgramRelease = typeof inspectionProgramReleases.$inferInsert;

// (P4.B G9 CAD import tables appended)

// ============================================================
// P4.B G9 — CAD Import jobs (STEP AP242 + DXF) + parsed candidates
// ============================================================
export const cadImportJobs = pgTable("cad_import_jobs", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  format: varchar("format", { length: 20 }).notNull(), // 'step' | 'dxf'
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 255 }),
  fileUrl: text("fileUrl"),
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }),
  fileSha256: varchar("fileSha256", { length: 64 }),
  status: varchar("status", { length: 20 }).default("queued").notNull(),
  parserVersion: varchar("parserVersion", { length: 40 }),
  entityCounts: jsonb("entityCounts").$type<Record<string, number>>(),
  candidatePointCount: integer("candidatePointCount").default(0),
  appliedPointCount: integer("appliedPointCount").default(0),
  errorMessage: text("errorMessage"),
  uploadedBy: integer("uploadedBy"),
  appliedBy: integer("appliedBy"),
  appliedAt: timestamp("appliedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_cad_import_jobs_product").on(table.productModelId),
  index("idx_cad_import_jobs_status").on(table.status),
  index("idx_cad_import_jobs_created").on(table.createdAt),
]);

export type CadImportJob = typeof cadImportJobs.$inferSelect;
export type InsertCadImportJob = typeof cadImportJobs.$inferInsert;

export const cadImportCandidates = pgTable("cad_import_candidates", {
  id: serial("id").primaryKey(),
  jobId: integer("jobId").notNull(),
  candidateIndex: integer("candidateIndex").notNull(),
  code: varchar("code", { length: 100 }),
  name: varchar("name", { length: 255 }),
  shape: varchar("shape", { length: 20 }).default("circle").notNull(),
  positionX: decimal("positionX", { precision: 15, scale: 6 }).notNull(),
  positionY: decimal("positionY", { precision: 15, scale: 6 }).notNull(),
  positionZ: decimal("positionZ", { precision: 15, scale: 6 }),
  radius: decimal("radius", { precision: 15, scale: 6 }),
  geometry: jsonb("geometry").$type<any>(),
  sourceEntityType: varchar("sourceEntityType", { length: 60 }),
  sourceEntityId: varchar("sourceEntityId", { length: 120 }),
  selected: boolean("selected").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_cad_import_candidates_job").on(table.jobId),
  uniqueIndex("uq_cad_import_candidates_job_idx").on(table.jobId, table.candidateIndex),
]);

export type CadImportCandidate = typeof cadImportCandidates.$inferSelect;
export type InsertCadImportCandidate = typeof cadImportCandidates.$inferInsert;

// ============================================================
// P4.C G15 — Station triangulation (cross-station per-serial summary)
// One row per serialNumber summarising path through SPI → AOI_PRE →
// REFLOW → AOI_POST → AXI → ICT → FCT, including escape detection.
// ============================================================
export const stationTraces = pgTable("station_traces", {
  id: serial("id").primaryKey(),
  serialNumber: varchar("serialNumber", { length: 128 }).notNull(),
  productModelId: integer("productModelId"),
  lotCode: varchar("lotCode", { length: 80 }),
  firstSeenAt: timestamp("firstSeenAt"),
  lastSeenAt: timestamp("lastSeenAt"),
  stationsTouched: text("stationsTouched").array(),
  firstDefectStation: varchar("firstDefectStation", { length: 50 }),
  firstEscapeStation: varchar("firstEscapeStation", { length: 50 }),
  totalDefects: integer("totalDefects").default(0).notNull(),
  totalEscapes: integer("totalEscapes").default(0).notNull(),
  summary: jsonb("summary").$type<Record<string, any>>(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  // Doc 51 P3 batch-2 (CASE #8, migration 0284) — genealogy scope. The old
  // UNIQUE(serialNumber) collapsed two different boards sharing a printed serial
  // (or a blank serial) into ONE trace. Scope by (serialNumber, productModelId).
  // ⚠ May be ABSENT at runtime: 0284 is guarded and records 'partial' when
  //   pre-existing duplicate (serial, model) pairs block the rebuild; upsertStationTrace
  //   scopes in the app either way (SELECT-then-write), so behaviour is identical.
  //   NULL productModelId rows are NULLS-DISTINCT here (Postgres default) — two blank-
  //   model boards with the same serial are indistinguishable and still merge; the app
  //   matches them null-safe so a single blank-model board stays one row.
  uniqueIndex("uq_station_traces_serial_model").on(table.serialNumber, table.productModelId),
  index("idx_station_traces_product").on(table.productModelId),
  index("idx_station_traces_lot").on(table.lotCode),
  index("idx_station_traces_first_escape").on(table.firstEscapeStation),
  index("idx_station_traces_updated").on(table.updatedAt),
]);

export type StationTrace = typeof stationTraces.$inferSelect;
export type InsertStationTrace = typeof stationTraces.$inferInsert;

// ============================================================
// P4.C G11 — Genealogy hash-chain
// Append-only ledger. Each row references the SHA-256 of the previous
// row, enabling tamper-evident verification of serial-number genealogy
// (parent serial → child serial / station event / lot tie).
// ============================================================
export const genealogyChain = pgTable("genealogy_chain", {
  id: serial("id").primaryKey(),
  prevHash: varchar("prevHash", { length: 64 }).notNull(),
  currHash: varchar("currHash", { length: 64 }).notNull(),
  serialNumber: varchar("serialNumber", { length: 128 }).notNull(),
  parentSerial: varchar("parentSerial", { length: 128 }),
  eventType: varchar("eventType", { length: 40 }).notNull(),
  stationCode: varchar("stationCode", { length: 50 }),
  lotCode: varchar("lotCode", { length: 80 }),
  productModelId: integer("productModelId"),
  payload: jsonb("payload").$type<Record<string, any>>().notNull(),
  recordedBy: integer("recordedBy"),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
  // ── doc 44 W2-B2 (G5.17, migration 0255 — additive, nullable) ──────────────
  // Cross-layer trace id (order → work-order → command → genealogy event) from
  // the AsyncLocalStorage backbone (server/services/observability/correlation.ts).
  // DELIBERATELY OUTSIDE the hash-chain: utils/genealogyChain.hashEntry hashes a
  // FIXED field list that does not include this column, so old rows (NULL) and
  // new rows (set) verify identically. Trade-off (honest): correlation_id is
  // trace metadata and is NOT tamper-protected by the chain.
  correlationId: text("correlation_id"),
}, (table) => [
  uniqueIndex("uq_genealogy_chain_curr_hash").on(table.currHash),
  index("idx_genealogy_chain_serial").on(table.serialNumber),
  index("idx_genealogy_chain_parent").on(table.parentSerial),
  index("idx_genealogy_chain_lot").on(table.lotCode),
  index("idx_genealogy_chain_recorded").on(table.recordedAt),
  // 0255 — partial (skip NULL): most historical rows carry no correlation id.
  index("idx_genealogy_chain_correlation").on(table.correlationId).where(sql`${table.correlationId} IS NOT NULL`),
]);

export type GenealogyChain = typeof genealogyChain.$inferSelect;
export type InsertGenealogyChain = typeof genealogyChain.$inferInsert;
