// Schema domain: Equipment Integration — recipe genealogy load-log (I1, doc 16 §6 / §15)
//                — flag EQ_INTEG_ENABLED (default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// I1-b — RECIPE VERSIONING GENEALOGY.
//
// The platform ALREADY has versioned recipes (drizzle/schema/ot.ts:
//   • machine_recipes   — (code, version) unique; status draft|active|archived;
//                          payload jsonb; checksum; createdBy. Versioning EXISTS.
//   • recipe_deployments — an audit record of DEPLOYING a recipe to a machine
//                          (deployedBy notNull, previousRecipeId for rollback).
//
// This file adds ONE additive, append-only GENEALOGY table on top — it does NOT
// alter machine_recipes (existing recipe reads are untouched):
//
//   • recipe_load_log — WHO loaded WHICH recipe code@version onto WHICH machine and
//                       WHEN. Distinct from recipe_deployments (a control/deploy
//                       record) — this is the lightweight, immutable genealogy trail
//                       the orchestration/traceability layer reads (doc 16 §6 #4
//                       "log ai-nạp-recipe-nào"). One row per load event; never
//                       updated. `action` records create|release|archive|rollback|load.
//
// SAFETY / NO-OP: this is METADATA only (genealogy). It opens NO device-control path.
//   Service mutations are gated behind EQ_INTEG_ENABLED; recipe deploys/commands still
//   route through the EXISTING gated dispatchers.
//
// status / action columns are varchar (NOT new pg enums) on purpose → migration stays
// additive (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE), matching 0142–0146. RLS is
// wired in migration 0147 with the shared inert-by-default app_tenant_allows() helper
// on corporateCode (mirrors 0142–0146) — a no-op until TENANT_RLS_ENABLED.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Recipe Load Log — append-only genealogy of recipe lifecycle + load events.
 *
 *  action : create | release | archive | rollback | load
 *           create   → a new immutable recipe version was created (draft)
 *           release  → a version was promoted to the active/released contract
 *           archive  → a version was archived (superseded)
 *           rollback → the active version was reverted to a prior version
 *           load     → a (code@version) recipe was loaded onto a machine
 *
 *  recipeId      → machine_recipes.id of the version this event concerns (nullable so
 *                  a load referencing a not-yet-imported recipe still records).
 *  recipeCode    + recipeVersion → denormalized snapshot (genealogy survives recipe edits).
 *  fromRecipeId  → for rollback: the version we rolled away FROM.
 *  performedBy   → the user id who performed the action (genealogy: WHO).
 */
export const recipeLoadLog = pgTable("recipe_load_log", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 16 }).notNull(),
  recipeId: integer("recipeId"),
  recipeCode: varchar("recipeCode", { length: 64 }).notNull(),
  recipeVersion: integer("recipeVersion"),
  machineId: integer("machineId"),
  fromRecipeId: integer("fromRecipeId"),
  fromVersion: integer("fromVersion"),
  /** Recorded status AFTER the action (draft|released|archived) — denormalized. */
  status: varchar("status", { length: 16 }),
  performedBy: integer("performedBy"),
  notes: text("notes"),
  /** Free-form extra context (checksum, adapterKind, commandLogId, …). */
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_recipe_load_recipe").on(table.recipeId),
  index("idx_recipe_load_machine").on(table.machineId),
  index("idx_recipe_load_code").on(table.recipeCode),
  index("idx_recipe_load_action").on(table.action),
  index("idx_recipe_load_created").on(table.createdAt),
]);

export type RecipeLoadLog = typeof recipeLoadLog.$inferSelect;
export type InsertRecipeLoadLog = typeof recipeLoadLog.$inferInsert;
