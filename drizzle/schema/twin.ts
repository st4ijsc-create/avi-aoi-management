// Schema domain: Digital Twin — Equipment 3D Model Registry (Khối 7, doc 16 §11.2 / §15 T1)
//
// ════════════════════════════════════════════════════════════════════════════
// THE registry that maps a piece of equipment (a specific machine/robot OR an
// equipment CLASS) to an already-converted, web-ready 3D model URI (glTF/URDF).
// Consumed by the FE drei `<Gltf>` loader and by the scene-graph builder
// (server/services/twin/sceneGraph.ts) so sim + viz share ONE model source — the
// "single source of 3D truth" principle from the reference report (doc 16 §1.1 / §11.2).
//
// HONESTY (CAD→glTF conversion is NOT in-process): the actual STEP/IGES/URDF → glTF
// conversion needs external CAD/robotics tooling and is OUT OF SCOPE for T1. This
// table is an HONEST SEAM: callers register an ALREADY-CONVERTED model URI plus a
// `conversionStatus` that records where that asset came from / whether it is ready.
// `sourceFormat` keeps provenance (step|iges|urdf|gltf) for a future pipeline, but
// the backend never pretends to convert anything itself.
//
// TENANT SCOPE: corporateCode (varchar) + factoryId (int) mirror the neighbouring
// fleet tables (zones.corporateCode/factoryId). RLS is wired inert-by-default in
// migration 0144 via the shared app_tenant_allows() helper on corporateCode
// (mirrors 0142/0143) — a no-op until TENANT_RLS_ENABLED.
//
// status / modelKind / sourceFormat / conversionStatus columns are varchar (NOT new
// pg enums) on purpose → the migration stays additive (CREATE TABLE/INDEX/POLICY
// only, no ALTER TYPE on an existing enum), matching fleet (0142/0143).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Equipment 3D Model — one registered, web-ready model bound to either a specific
 * machine/robot (machineId / equipmentId set) OR an equipment CLASS fallback
 * (equipmentClass set, e.g. "AOI" / "ROBOT"). Resolution prefers the most specific
 * match: explicit machineId → equipmentId → equipmentClass.
 *
 *  modelKind        : gltf | urdf   (what the FE loader should instantiate)
 *  sourceFormat     : step | iges | urdf | gltf  (provenance of the original CAD)
 *  conversionStatus : pending | converting | ready | failed | external
 *                     'ready'    → modelUri points at a usable web asset
 *                     'external' → asset is hosted/managed outside this system
 *                     'pending'/'converting'/'failed' → seam states; the FE should
 *                       fall back to a primitive (block) until 'ready'
 *  status           : active | archived  (soft lifecycle; archived hidden from resolve)
 *  bounds           : optional jsonb axis-aligned bounds for layout/LOD/culling,
 *                     e.g. { min:[x,y,z], max:[x,y,z] } or { w,h,d }.
 */
export const equipment3dModels = pgTable("equipment_3d_models", {
  id: serial("id").primaryKey(),
  // Stable external key — lets registration be idempotent (uniqueIndex below).
  modelKey: varchar("modelKey", { length: 128 }).notNull(),
  // Specific binding (at most one of these three is the primary key for resolve):
  machineId: integer("machineId"),
  // External equipment identifier (robots.id, device code, …) when not a platform machine.
  equipmentId: varchar("equipmentId", { length: 128 }),
  // Class-level fallback (capabilityModel class, e.g. "AOI", "ROBOT", "SCARA").
  equipmentClass: varchar("equipmentClass", { length: 64 }),
  // Web-ready asset URI (glTF .glb/.gltf or URDF .urdf path). The drei loader consumes this.
  modelUri: text("modelUri").notNull(),
  modelKind: varchar("modelKind", { length: 16 }).default("gltf").notNull(),
  // Monotonic version per modelKey (each re-register bumps it).
  version: integer("version").default(1).notNull(),
  sourceFormat: varchar("sourceFormat", { length: 16 }).default("gltf").notNull(),
  // HONEST conversion seam — see header. NOT a converter; a status record.
  conversionStatus: varchar("conversionStatus", { length: 16 }).default("ready").notNull(),
  // Optional axis-aligned bounds for layout / LOD / frustum culling.
  bounds: jsonb("bounds").$type<Record<string, unknown>>(),
  status: varchar("status", { length: 16 }).default("active").notNull(),
  // Free-form scope tag (deployment/site label), mirrors fleetResource.scope.
  scope: varchar("scope", { length: 64 }),
  notes: text("notes"),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_eq3d_machine").on(table.machineId),
  index("idx_eq3d_equipment").on(table.equipmentId),
  index("idx_eq3d_class").on(table.equipmentClass),
  index("idx_eq3d_status").on(table.status),
]);

export type Equipment3dModel = typeof equipment3dModels.$inferSelect;
export type InsertEquipment3dModel = typeof equipment3dModels.$inferInsert;
