// Schema domain: S2b — Vision human-detection + Safety-PLC status adapter
//                (doc 20 §2/§5 S2b, doc 16 §8)
//                — flags SAFETY_VISION_ENABLED / SAFETY_PLC_ADAPTER_ENABLED (default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// S2b feeds the S2a ADVISORY safety layer with two producers:
//
//   camera_calibrations — per-camera pixel→floor planar HOMOGRAPHY. A camera looking
//     at a (locally) flat floor maps image pixels to world-floor mm by a 3×3 homography
//     H (floor is z=0). We store either a precomputed H (9 numbers, row-major) and/or
//     the ≥4 image↔floor correspondence points it was solved from, plus which safety
//     zone / robot / station the camera watches. A person DETECTION (pixel bbox) is
//     projected through H to a FLOOR position, then fed to the S2a evaluator.
//
//   safety_plc_configs — a READ-ONLY safety-PLC status endpoint (Pilz PNOZmulti/PSS,
//     Sick Flexi Soft). These certified controllers expose NON-safety-rated STATUS
//     (e-stop state, zone occupied, reset-required, muting) over Modbus-TCP / OPC-UA.
//     We MONITOR that status and map it to advisory safety_events. A 'sim' backend
//     (scripted status) is the default until a real endpoint is set.
//
// ════════════════════════════════════════════════════════════════════════════
// ⚠ CRITICAL HONESTY / SAFETY (read this):
//   NOTHING here is safety-rated. The vision producer + PLC adapter are ADVISORY
//   MONITORING. The vision producer NEVER fabricates a detection — with no inference
//   backend it produces NOTHING (a real camera + calibration + exported model is
//   required; yolo26n.pt is PyTorch and needs a one-time Python→ONNX export). The PLC
//   adapter is READ-ONLY: it OBSERVES the certified PLC's status and LOGS advisory
//   events — it NEVER actuates a rated stop (the certified Safety PLC performs that
//   itself, in hardware). Both drive the SAME S2a evaluator / S1 advisory path; they
//   open NO new device-control path.
//
// TENANT SCOPE: corporateCode (varchar) + factoryId (int) + a free `scope` tag mirror
// safetyZones.ts / safetyWorkforce.ts. RLS is wired in migration 0154 with the shared
// inert-by-default app_tenant_allows() helper on corporateCode.
//
// type columns are varchar (NOT new pg enums) → the migration stays additive.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, boolean, jsonb, timestamp, index, real } from "drizzle-orm/pg-core";
import type { CalibrationPair, Homography } from "../../server/services/safety/vision/homography";

/**
 * Per-camera calibration: a pixel→floor planar homography plus (optionally) the
 * correspondence points it was solved from. `homography` is a 9-number row-major H;
 * `imagePoints`/`floorPoints`/`pairs` retain provenance so it can be re-solved.
 */
export const cameraCalibrations = pgTable("camera_calibrations", {
  id: serial("id").primaryKey(),
  // A stable camera identifier (device tag / RTSP id / logical name). No DB FK.
  cameraId: varchar("cameraId", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }),
  // The solved (or precomputed) 3×3 homography, row-major (9 numbers).
  homography: jsonb("homography").$type<Homography>(),
  // The ≥4 image↔floor correspondence pairs (mm). Kept for re-solve/audit.
  pairs: jsonb("pairs").$type<CalibrationPair[]>(),
  // Mean reprojection residual (mm) of the solved H against its pairs — honesty metric.
  residualMm: real("residualMm"),
  // Which safety zone / robot / station this camera watches (drives evaluator scope).
  safetyZoneId: integer("safetyZoneId"),
  robotId: integer("robotId"),
  stationId: integer("stationId"),
  lineId: integer("lineId"),
  // Optional pixel image size (for bbox → floor-point choice, e.g. bottom-centre foot).
  imageWidth: integer("imageWidth"),
  imageHeight: integer("imageHeight"),
  enabled: boolean("enabled").default(true).notNull(),
  notes: text("notes"),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_camcalib_camera").on(table.cameraId),
  index("idx_camcalib_zone").on(table.safetyZoneId),
  index("idx_camcalib_robot").on(table.robotId),
  index("idx_camcalib_enabled").on(table.enabled),
]);

export type CameraCalibration = typeof cameraCalibrations.$inferSelect;
export type InsertCameraCalibration = typeof cameraCalibrations.$inferInsert;

/** Backend for the safety-PLC adapter: a scripted 'sim' (default) or a real read via OT. */
export type SafetyPlcBackend = "sim" | "modbus" | "opcua";
/** Recognised safety-PLC vendors (informational; the read path is the same). */
export type SafetyPlcVendor = "pilz" | "sick" | "generic";

/**
 * A READ-ONLY safety-PLC status endpoint. `backend='sim'` (default) drives a scripted
 * status stream; `modbus`/`opcua` read live NON-safety-rated status via the existing
 * OT driver (endpoint + a statusMap of which register/node carries each status flag).
 */
export const safetyPlcConfigs = pgTable("safety_plc_configs", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  vendor: varchar("vendor", { length: 32 }).default("generic").notNull(),
  // 'sim' | 'modbus' | 'opcua'.
  backend: varchar("backend", { length: 16 }).default("sim").notNull(),
  // For real backends: the OT endpoint ("tcp://host:502" / "opc.tcp://host:4840").
  endpoint: varchar("endpoint", { length: 512 }),
  // Maps each advisory status flag → the tag/node that carries it (real backends) OR a
  // scripted status sequence (sim backend). jsonb keeps this vendor-flexible.
  statusMap: jsonb("statusMap").$type<SafetyPlcStatusMap>(),
  // Which robot/station/line this PLC guards (for advisory-event scoping).
  robotId: integer("robotId"),
  stationId: integer("stationId"),
  lineId: integer("lineId"),
  enabled: boolean("enabled").default(true).notNull(),
  notes: text("notes"),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_safetyplc_code").on(table.code),
  index("idx_safetyplc_backend").on(table.backend),
  index("idx_safetyplc_robot").on(table.robotId),
  index("idx_safetyplc_enabled").on(table.enabled),
]);

export type SafetyPlcConfig = typeof safetyPlcConfigs.$inferSelect;
export type InsertSafetyPlcConfig = typeof safetyPlcConfigs.$inferInsert;

/** One boolean status flag carried by the PLC, and where to read it. */
export interface SafetyPlcTagRef {
  /** OT tag address (Modbus "40001"/"1@coil" or OPC-UA nodeId) for the real backend. */
  address?: string;
  /** OT data type used by the driver read (default 'bool'). */
  dataType?: "bool" | "int" | "float";
  /** True when a value ≥ this (or truthy) means the flag is ACTIVE (default: truthy). */
  activeWhen?: "truthy" | "falsy";
}

/**
 * How to interpret a safety-PLC's status. For real backends each flag names an OT tag;
 * for the sim backend, `simScript` is a scripted sequence of status snapshots the
 * adapter cycles through (clearly labelled sim — never presented as a live PLC).
 */
export interface SafetyPlcStatusMap {
  estop?: SafetyPlcTagRef;
  zoneOccupied?: SafetyPlcTagRef;
  resetRequired?: SafetyPlcTagRef;
  muting?: SafetyPlcTagRef;
  /** Sim-only scripted status stream (each entry = one snapshot; adapter cycles). */
  simScript?: SafetyPlcStatusSnapshot[];
}

/** One observed safety-PLC status snapshot (all flags optional; absent = unknown). */
export interface SafetyPlcStatusSnapshot {
  estop?: boolean;
  zoneOccupied?: boolean;
  resetRequired?: boolean;
  muting?: boolean;
}
