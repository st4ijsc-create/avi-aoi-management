// Schema domain: SMT Line Materials (doc 35 W4-C) — feeder-setup verification,
// MSD floor-life clock (J-STD-020), stencil cycle counter.
//
// SAFETY / SCOPE: these are MATERIAL-HANDLING ledgers (telemetry of setup checks
// and consumable exposure). There is NO machine control write path here. All new
// behaviour is flag-gated OFF by default (FEEDER_VERIFY_ENFORCED / MSD_TRACKING_ENABLED
// / STENCIL_TRACKING_ENABLED); RECORDING checks works regardless of any flag —
// only the ENFORCEMENT / scheduler side-effects are gated.
//
// Status / verdict / mslLevel are plain varchar (NOT pg enums) to keep migration
// 0227 additive + idempotent (CREATE TABLE IF NOT EXISTS only, no ALTER TYPE) —
// mirroring the commissioning_records precedent (migration 0157).
import { pgTable, serial, integer, text, timestamp, varchar, decimal, index } from "drizzle-orm/pg-core";

// =============================================================
// W4-C.1 — Feeder-setup verification (highest value: wrong-part guard)
// =============================================================
/**
 * Feeder Setup Verifications — 1 bản ghi cho MỖI lần quét kiểm tra 1 slot feeder.
 *
 * Trước khi chạy 1 sản phẩm, người vận hành quét (reel + slot) → service tra
 * linh kiện KỲ VỌNG cho slot đó (từ feeder_materials đã nạp / hoặc truyền vào)
 * rồi so khớp với linh kiện QUÉT ĐƯỢC → verdict match|mismatch. Đây là mắt xích
 * chống nạp sai linh kiện (một nguồn lỗi SMT nghiêm trọng).
 *
 * verdict: 'match' | 'mismatch' (plain varchar — additive).
 */
export const feederSetupVerifications = pgTable("feeder_setup_verifications", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  lineId: integer("lineId"),                                     // FK by id -> production_lines.id (nullable)
  productModelId: integer("productModelId"),                     // FK by id -> product_models.id (nullable)
  programId: integer("programId"),                               // optional program/recipe context (nullable)
  slotCode: varchar("slotCode", { length: 40 }),                 // feeder position / slot
  expectedComponentCode: varchar("expectedComponentCode", { length: 100 }), // from feeder setup / BOM (nullable if slot unknown)
  scannedComponentCode: varchar("scannedComponentCode", { length: 100 }),   // decoded from the scanned reel/part
  scannedReel: varchar("scannedReel", { length: 128 }),          // raw reel / lot barcode scanned
  feederMaterialId: integer("feederMaterialId"),                 // FK by id -> feeder_materials.id (matched setup row, nullable)
  verdict: varchar("verdict", { length: 16 }).notNull(),         // 'match' | 'mismatch'
  verifiedBy: integer("verifiedBy"),                             // FK by id -> users.id
  verifiedAt: timestamp("verifiedAt").defaultNow().notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_feederverify_machine").on(table.machineId),
  index("idx_feederverify_machine_slot").on(table.machineId, table.slotCode),
  index("idx_feederverify_product").on(table.productModelId),
  index("idx_feederverify_verdict").on(table.verdict),
  index("idx_feederverify_verifiedat").on(table.verifiedAt),
]);

export type FeederSetupVerification = typeof feederSetupVerifications.$inferSelect;
export type InsertFeederSetupVerification = typeof feederSetupVerifications.$inferInsert;

// =============================================================
// W4-C.2 — MSD floor-life clock (J-STD-020)
// =============================================================
/**
 * MSD Exposure Logs — đồng hồ đếm floor-life của linh kiện nhạy ẩm (MSD).
 *
 * Khi 1 reel MSD được lấy ra khỏi tủ khô (removedFromDryAt), đồng hồ floor-life
 * bắt đầu chạy. floorLifeHoursAllowed suy ra từ mslLevel (J-STD-020, xem
 * MSL_FLOOR_LIFE_HOURS trong msdService). status là advisory (ok|warning|expired|
 * baking) — KHÔNG có enforcement cứng; scheduler cảnh báo gated bởi
 * MSD_TRACKING_ENABLED. closedAt = đã trả về tủ khô (dừng đồng hồ).
 *
 * mslLevel: '1' | '2' | '2a' | '3' | '4' | '5' | '5a' | '6' (plain varchar).
 * status:   'ok' | 'warning' | 'expired' | 'baking'.
 */
export const msdExposureLogs = pgTable("msd_exposure_logs", {
  id: serial("id").primaryKey(),
  componentCode: varchar("componentCode", { length: 100 }).notNull(),
  reelId: varchar("reelId", { length: 128 }),                    // reel / lot barcode (nullable)
  materialId: integer("materialId"),                             // FK by id -> materials.id (nullable)
  mslLevel: varchar("mslLevel", { length: 8 }).notNull(),        // J-STD-020 level
  removedFromDryAt: timestamp("removedFromDryAt").notNull(),     // floor-life clock start
  floorLifeHoursAllowed: decimal("floorLifeHoursAllowed", { precision: 10, scale: 2 }), // null = unlimited (MSL 1)
  exposedHoursAccrued: decimal("exposedHoursAccrued", { precision: 10, scale: 2 }).default("0").notNull(),
  status: varchar("status", { length: 16 }).default("ok").notNull(), // ok|warning|expired|baking
  bakeStartedAt: timestamp("bakeStartedAt"),                     // set when a bake cycle begins
  closedAt: timestamp("closedAt"),                               // returned to dry storage (clock stopped)
  machineId: integer("machineId"),                               // optional where it is being consumed
  loggedBy: integer("loggedBy"),                                 // FK by id -> users.id
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_msd_component").on(table.componentCode),
  index("idx_msd_reel").on(table.reelId),
  index("idx_msd_status").on(table.status),
  index("idx_msd_removedat").on(table.removedFromDryAt),
  index("idx_msd_material").on(table.materialId),
]);

export type MsdExposureLog = typeof msdExposureLogs.$inferSelect;
export type InsertMsdExposureLog = typeof msdExposureLogs.$inferInsert;

// =============================================================
// W4-C.3 — Stencil cycle counter
// =============================================================
/**
 * Stencil Usage Logs — sổ tích lũy số lần in (print cycles) của 1 stencil.
 *
 * stencilToolId -> tools.id (tools master đọc-only; KHÔNG ghi vào tools ở đây).
 * status của stencil = tools.lifeUsed (baseline) + SUM(stencil_usage_logs.printCount)
 * so với tools.lifeLimit (tính trong stencilService.getStatus). cleanedAt /
 * tensionCheckAt ghi lại bảo dưỡng. Side-effect (cảnh báo worn) gated bởi
 * STENCIL_TRACKING_ENABLED; recording luôn hoạt động.
 */
export const stencilUsageLogs = pgTable("stencil_usage_logs", {
  id: serial("id").primaryKey(),
  stencilToolId: integer("stencilToolId").notNull(),             // FK by id -> tools.id (type='stencil')
  printCount: integer("printCount").default(0).notNull(),        // print cycles accrued in THIS entry
  cleanedAt: timestamp("cleanedAt"),                             // stencil cleaned at this event (nullable)
  tensionCheckAt: timestamp("tensionCheckAt"),                   // tension checked at this event (nullable)
  tensionValue: decimal("tensionValue", { precision: 8, scale: 2 }), // optional measured tension (N/mm)
  machineId: integer("machineId"),                               // printer/machine used (nullable)
  recordedBy: integer("recordedBy"),                             // FK by id -> users.id
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_stencilusage_tool").on(table.stencilToolId),
  index("idx_stencilusage_createdat").on(table.createdAt),
]);

export type StencilUsageLog = typeof stencilUsageLogs.$inferSelect;
export type InsertStencilUsageLog = typeof stencilUsageLogs.$inferInsert;
