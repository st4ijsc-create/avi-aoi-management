// Schema domain: Hierarchy tables (Corporate > Factory > Workshop > Line > Station > Machine)
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { machineTypeEnum, statusEnum_1, operationStatusEnum, processTypeEnum } from "./enums";

/**
 * Sprint F2 — generic capability flags for a machine, so the UI / services can
 * adapt behaviour per device kind without hard-coding machineType checks.
 * Open-ended ([k:string]:unknown) for forward-compat.
 */
export type MachineCapabilities = {
  canMeasureTorque?: boolean;
  canMeasureDispenseVolume?: boolean;
  hasRecipe?: boolean;
  emitsProcessResult?: boolean;
  cycleTimeTracked?: boolean;
  [k: string]: unknown;
};

/**
 * Doc 27 §2 M13 / doc 29 §4 (W8-A, 0191) — persisted result of validating
 * machines.capabilities against the deviceTypes attributesSchema contract
 * (server/services/standards/capabilitiesValidation.ts). Soft 2-tier gate:
 * tier 1 stamps this on every capabilities save (warning only); tier 2
 * (CAPABILITIES_VALIDATION_ENFORCED) rejects on required-attribute violations.
 */
export type CapabilitiesValidationStamp = {
  checkedAt: string;                 // ISO timestamp of the validation run
  deviceTypeKey: string;             // resolved device type (via mappedMachineTypes)
  deviceTypeVersion?: string;
  ok: boolean;                       // no errors (unknown keys never fail it)
  skipped?: boolean;                 // true when capabilities was NULL/empty
  errors: Array<{ path: string; expected: string; got: string; required?: boolean }>;
  unknownKeys: string[];             // vendor-extension keys outside the contract (never blocking)
  source?: string;                   // 'save' | 'drift-scan'
};

/** Floor-plan transform for the 3D plant view. x/y mirror layoutPositionX/Y (0–1). */
export type MachineLayout = {
  x?: number; // normalized 0–1 (mirror of layoutPositionX)
  y?: number; // normalized 0–1 (mirror of layoutPositionY)
  rotationDeg?: number; // yaw around vertical axis, 0–360
  footprintW?: number; // scene-unit width (default ~1.5)
  footprintD?: number; // scene-unit depth (default ~1.5)
};

/**
 * Corporate - Tập đoàn (cấp cao nhất)
 * Enables proper multi-tenant corporate rollup with FK integrity.
 * productInspections.corporateCode references this table's code.
 */
export const corporates = pgTable("corporates", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  country: varchar("country", { length: 100 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  logoUrl: text("logoUrl"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_corporates_code").on(table.code),
  index("idx_corporates_active").on(table.isActive),
]);

export type Corporate = typeof corporates.$inferSelect;
export type InsertCorporate = typeof corporates.$inferInsert;

/**
 * Factory - Nhà máy (thuộc tập đoàn)
 */
export const factories = pgTable("factories", {
  id: serial("id").primaryKey(),
  // W3-A (doc 27 M1, 0180): real FK to corporates.code (fk_factories_corporate,
  // ON DELETE RESTRICT). Nullable for back-compat — NULL means "no corporate".
  corporateCode: varchar("corporateCode", { length: 50 })
    .references(() => corporates.code, { onDelete: "restrict" }),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  address: text("address"),
  region: varchar("region", { length: 100 }), // Khu vực địa lý
  country: varchar("country", { length: 100 }),
  timezone: varchar("timezone", { length: 64 }).default("Asia/Ho_Chi_Minh"), // IANA timezone for shift boundary calc
  mapPositionX: decimal("mapPositionX", { precision: 10, scale: 4 }), // Vị trí X trên bản đồ (0-1)
  mapPositionY: decimal("mapPositionY", { precision: 10, scale: 4 }), // Vị trí Y trên bản đồ (0-1)
  // W6-25 — Floor-plan editor: ảnh nền (CAD/ảnh) + kích thước sàn thật (mét)
  floorPlanImageUrl: text("floorPlanImageUrl"), // Ảnh nền mặt bằng đã upload
  floorPlanImageKey: varchar("floorPlanImageKey", { length: 255 }), // Storage key của ảnh nền
  floorWidthM: decimal("floorWidthM", { precision: 10, scale: 2 }), // Chiều rộng sàn (mét thật)
  floorDepthM: decimal("floorDepthM", { precision: 10, scale: 2 }), // Chiều sâu sàn (mét thật)
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_factories_code").on(table.code),
  index("idx_factories_active").on(table.isActive),
  index("idx_factories_corporate").on(table.corporateCode),
]);

export type Factory = typeof factories.$inferSelect;
export type InsertFactory = typeof factories.$inferInsert;

/**
 * Workshop - Nhà xưởng (thuộc Factory, 1-6 per factory)
 */
export const workshops = pgTable("workshops", {
  id: serial("id").primaryKey(),
  // W3-A (doc 27 M1, 0180): fk_workshops_factory, ON DELETE RESTRICT.
  factoryId: integer("factoryId").notNull()
    .references(() => factories.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  floorArea: decimal("floorArea", { precision: 10, scale: 2 }), // Diện tích m2
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_workshops_factory").on(table.factoryId),
  index("idx_workshops_code").on(table.code),
  // W3-A (doc 27 M6, 0180): per-factory code uniqueness among ACTIVE rows only —
  // deletes are soft (isActive=false), a retired code may be reused.
  // NOTE: DB enforcement is conditional — 0180 defers the build if duplicates
  // exist (see integrity_scan_results / db_feature_status 'integrity_uq_*').
  uniqueIndex("uq_workshops_factory_code_active").on(table.factoryId, table.code).where(sql`${table.isActive} = true`),
]);

export type Workshop = typeof workshops.$inferSelect;
export type InsertWorkshop = typeof workshops.$inferInsert;

/**
 * Production Line - Dây chuyền sản xuất
 */
export const productionLines = pgTable("production_lines", {
  id: serial("id").primaryKey(),
  // W3-A (doc 27 M1, 0180): fk_production_lines_workshop, ON DELETE RESTRICT.
  workshopId: integer("workshopId").notNull()
    .references(() => workshops.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  capacityPerHour: integer("capacityPerHour"), // Sản lượng mỗi giờ
  maxConcurrentOrders: integer("maxConcurrentOrders").default(1), // Số lệnh tối đa cùng lúc
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_lines_workshop").on(table.workshopId),
  index("idx_lines_code").on(table.code),
  // W3-A (doc 27 M6, 0180): per-workshop code uniqueness among ACTIVE rows (see
  // uq_workshops_factory_code_active note — conditional build, soft-delete aware).
  uniqueIndex("uq_production_lines_workshop_code_active").on(table.workshopId, table.code).where(sql`${table.isActive} = true`),
]);

export type ProductionLine = typeof productionLines.$inferSelect;
export type InsertProductionLine = typeof productionLines.$inferInsert;

/**
 * Station - Công trạm (thuộc Production Line)
 */
export const stations = pgTable("stations", {
  id: serial("id").primaryKey(),
  // W3-A (doc 27 M1, 0180): fk_stations_line, ON DELETE RESTRICT.
  lineId: integer("lineId").notNull()
    .references(() => productionLines.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  orderIndex: integer("orderIndex").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_stations_line").on(table.lineId),
  index("idx_stations_code").on(table.code),
  // W3-A (doc 27 M6, 0180): per-line code uniqueness among ACTIVE rows (see
  // uq_workshops_factory_code_active note — conditional build, soft-delete aware).
  uniqueIndex("uq_stations_line_code_active").on(table.lineId, table.code).where(sql`${table.isActive} = true`),
]);

export type Station = typeof stations.$inferSelect;
export type InsertStation = typeof stations.$inferInsert;

/**
 * Doc 27 Đợt 3 / W3-B — gap M2: machine ASSET lifecycle (distinct from runtime
 * operationStatus and from registrationStatus).
 *
 * Repo convention for varchar enums (see registrationStatus above,
 * aoi_commissioning_records.status): plain varchar + app-level validation — no
 * pg enum / CHECK constraint, so adding states later never needs ALTER TYPE.
 * (Doc 44 W2-A2 verified: adding 'registered'/'faulted' below therefore needed
 * NO ALTER TYPE — the column is varchar(20), app-validated.)
 *
 * Doc 44 W2-A2 (gap G1.10, SYNAPSE Tầng-1 spec §6.3) — two ADDITIVE states:
 *   registered — declared in the Asset Registry (POST /v1/assets), not yet
 *                connected/verified. Sits BEFORE commissioning.
 *   faulted    — link-loss/error while active; recovers to active or goes to
 *                maintenance. (Spec: ACTIVE ─(sự cố)─▶ FAULTED ─▶ MAINTENANCE.)
 * The column DEFAULT stays 'active' (unchanged — existing create flows are not
 * disturbed; the register flow still stamps 'commissioning' explicitly and the
 * declarative /v1/assets registration stamps 'registered' explicitly).
 *
 * Legal transitions (enforced by server/db/hierarchy.ts transitionMachineLifecycle;
 * anything not listed is a CONFLICT):
 *   registered     → commissioning | decommissioned (hủy onboard, spec §6.3)
 *   commissioning  → active | decommissioned (hủy onboard, spec §6.3)
 *   active         → maintenance | decommissioned | faulted
 *   faulted        → active (recovered) | maintenance
 *   maintenance    → active | decommissioned
 *   decommissioned → retired | active (re-commission)
 *   retired        → (terminal for transitions)
 * Out-of-band stamps (documented, not part of the transition map):
 *   deleteMachine  (soft-delete) force-stamps 'retired'
 *   restoreMachine (undelete)    lands on 'decommissioned' — one legal step from
 *                                'active', so a restored machine stays excluded
 *                                from auto-assign until explicitly re-commissioned.
 */
export const MACHINE_LIFECYCLE_STATUSES = [
  "registered",
  "commissioning",
  "active",
  "faulted",
  "maintenance",
  "decommissioned",
  "retired",
] as const;
export type MachineLifecycleStatus = (typeof MACHINE_LIFECYCLE_STATUSES)[number];

export const MACHINE_LIFECYCLE_TRANSITIONS: Record<MachineLifecycleStatus, readonly MachineLifecycleStatus[]> = {
  registered: ["commissioning", "decommissioned"],
  commissioning: ["active", "decommissioned"],
  active: ["maintenance", "decommissioned", "faulted"],
  faulted: ["active", "maintenance"],
  maintenance: ["active", "decommissioned"],
  decommissioned: ["retired", "active"],
  retired: [],
};

export function isLegalLifecycleTransition(from: string, to: string): boolean {
  const allowed = MACHINE_LIFECYCLE_TRANSITIONS[from as MachineLifecycleStatus];
  return Array.isArray(allowed) ? (allowed as readonly string[]).includes(to) : false;
}

/** Lifecycle states that must be kept OUT of auto-assign/registration reuse. */
export const MACHINE_LIFECYCLE_EXCLUDED: readonly MachineLifecycleStatus[] = ["decommissioned", "retired"];

/**
 * Machine - Máy AVI/AOI/Tự động hóa
 *
 * Doc 27 Đợt 3 / W3-B — gap M3: machines.code is NO LONGER globally unique.
 * Uniqueness is a PARTIAL unique index (uq_machines_code_active, WHERE
 * "isActive" = true — migration 0181): soft-deleted machines keep their code as
 * a tombstone, and the code becomes reusable by a new registration. Restoring a
 * tombstone whose code has been reused is a CONFLICT (see restoreMachine).
 */
export const machines = pgTable("machines", {
  id: serial("id").primaryKey(),
  // W3-A (doc 27 M1, 0180): fk_machines_station, ON DELETE RESTRICT.
  stationId: integer("stationId").notNull()
    .references(() => stations.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  machineType: machineTypeEnum("machineType").notNull(),
  model: varchar("model", { length: 100 }),
  manufacturer: varchar("manufacturer", { length: 100 }),
  apiKey: varchar("apiKey", { length: 128 }).unique(), // Có thể null khi máy chưa được duyệt
  description: text("description"),
  // Machine images for 2D/3D visualization
  image2DUrl: text("image2DUrl"), // Ảnh 2D của máy
  image2DKey: varchar("image2DKey", { length: 255 }),
  image3DUrl: text("image3DUrl"), // Ảnh 3D của máy
  image3DKey: varchar("image3DKey", { length: 255 }),
  // Layout position for drag & drop
  layoutPositionX: decimal("layoutPositionX", { precision: 10, scale: 4 }), // Vị trí X trong Layout (0-1)
  layoutPositionY: decimal("layoutPositionY", { precision: 10, scale: 4 }), // Vị trí Y trong Layout (0-1)
  // --- Bổ sung cho đồng bộ online/offline ---
  serialNumber: varchar("serialNumber", { length: 100 }), // Serial number từ máy AOI/AVI
  firmwareVersion: varchar("firmwareVersion", { length: 50 }), // Phiên bản firmware
  // Doc 40 W1 (Tuấn-P0, 0238) — địa chỉ kết nối máy nhập ở onboarding wizard (Step 2).
  // Trước đây IP/port/protocol chỉ dùng cho probe testConnection rồi bị vứt; nay lưu
  // vào bản ghi máy. Nullable để không phá caller cũ (create không truyền các field này).
  ipAddress: varchar("ipAddress", { length: 45 }), // IPv4/IPv6 literal của máy
  port: integer("port"), // Cổng TCP/WS (1-65535)
  connectionProtocol: varchar("connectionProtocol", { length: 20 }), // "websocket" | "tcp" | "http"
  syncMode: statusEnum_1("syncMode").default("online").notNull(), // "online" | "offline"
  registrationStatus: varchar("registrationStatus", { length: 20 }).default("pending").notNull(), // "pending" | "approved" | "rejected" | "unmapped"
  // Doc 27 Đợt 3 / W3-B — gap M2: asset lifecycle state (varchar-enum, app-validated).
  lifecycleStatus: varchar("lifecycleStatus", { length: 20 }).$type<MachineLifecycleStatus>().default("active").notNull(),
  // Doc 44 W2-A2 (gap G1.10, migration 0251) — SYNAPSE asset identity. Nullable:
  // maintained by server/services/assetRegistry/urnService.syncAssetIdentity
  // (hooked into create/update/approve + station/line reassignment) and backfilled
  // by 0251. Slug rule shared with UNS topics: lowercase [a-z0-9-], Vietnamese
  // diacritics stripped, missing hierarchy level → 'unassigned'.
  //   urn        — urn:syn:asset:{site}:{line}:{cell}:{equipment}
  //   isa95Path  — {site}/{area}/{line}/{cell}/{equipment}
  // Uniqueness is a PARTIAL index (active rows only — mirrors uq_machines_code_active:
  // tombstones keep their URN for traceability without blocking code/URN reuse).
  urn: text("urn"),
  isa95Path: text("isa95_path"),
  lastSyncAt: timestamp("lastSyncAt"),
  pendingConfig: text("pendingConfig"), // Cấu hình chờ duyệt (offline)
  isActive: boolean("isActive").default(true).notNull(),
  lastHeartbeat: timestamp("lastHeartbeat"),
  operationStatus: operationStatusEnum("operationStatus").default("stopped").notNull(),
  // Sprint F2 — generic device capability flags (nullable; defaults inferred per machineType)
  capabilities: jsonb("capabilities").$type<MachineCapabilities>(),
  // Doc 27 M13 / doc 29 §4 (W8-A, 0191): last capabilities-validation result
  // ({checkedAt, deviceTypeKey, ok, errors, unknownKeys}). NULL = never validated.
  capabilitiesValidation: jsonb("capabilitiesValidation").$type<CapabilitiesValidationStamp>(),
  layout: jsonb("layout").$type<MachineLayout>(), // floor-plan transform (rotation/footprint); x/y also in layoutPositionX/Y
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_machines_station").on(table.stationId),
  index("idx_machines_code").on(table.code),
  // M3: code unique ONLY among live rows — tombstones (isActive=false) keep the
  // code without blocking re-registration (replaces the old machines_code_unique).
  uniqueIndex("uq_machines_code_active").on(table.code).where(sql`${table.isActive} = true`),
  index("idx_machines_apikey").on(table.apiKey),
  index("idx_machines_registration_status").on(table.registrationStatus),
  index("idx_machines_lifecycle").on(table.lifecycleStatus),
  // G1.10 (0251): URN unique among LIVE rows only (see column comment above).
  uniqueIndex("uq_machines_urn_active").on(table.urn).where(sql`${table.isActive} = true`),
  index("idx_machines_isa95_path").on(table.isa95Path),
  index("idx_machines_syncmode").on(table.syncMode),
  index("idx_machines_serial_number").on(table.serialNumber),
]);

export type Machine = typeof machines.$inferSelect;
export type InsertMachine = typeof machines.$inferInsert;

/**
 * Workstations - Công trạm sản xuất
 * Mỗi điểm kiểm tra của máy AVI/AOI được thực hiện bởi một công trạm trước đó
 */
export const workstations = pgTable("workstations", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  lineId: integer("lineId"), // Thuộc dây chuyền nào
  workshopId: integer("workshopId"), // Thuộc xưởng nào
  factoryId: integer("factoryId"), // Thuộc nhà máy nào
  processType: processTypeEnum("processType").default("OTHER"),
  orderIndex: integer("orderIndex").default(0).notNull(), // Thứ tự trong dây chuyền
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_workstations_code").on(table.code),
  index("idx_workstations_line").on(table.lineId),
  index("idx_workstations_workshop").on(table.workshopId),
  index("idx_workstations_factory").on(table.factoryId),
]);
export type Workstation = typeof workstations.$inferSelect;
export type InsertWorkstation = typeof workstations.$inferInsert;
