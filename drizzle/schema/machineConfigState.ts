// Schema domain: Generic Machine Config Shadow (doc 56 Đ4 — CONFIG-SYNC-1/2/3/6).
//
// ════════════════════════════════════════════════════════════════════════════
// GENERIC config-sync shadow — one row per (machineId, configKind). It is the
// server-side "digital shadow" of what a machine is SUPPOSED to run (desired*,
// set when a config is deployed/notified) vs what it REPORTS running (reported*,
// set on ackConfigApplied / heartbeat drift). driftState summarises the two.
//
// configKind is a free varchar (NOT a pg enum — repo convention: grow catalogs by
// ROW, not ALTER TYPE): 'recipe' | 'device_settings' | 'points' | 'model' today,
// extensible without a migration. desired/reported version+checksum are varchar so
// ANY config family's version representation fits (recipe int, points int, model
// semver-ish) — checksum is the authoritative drift signal, version is context.
//
// Consumers: machineApi.checkConfigVersion / getActiveConfig / ackConfigApplied
// (machineApiRouters) + machineRecipe.recipes.deploy (writes desired* + retained
// MQTT notify) + heartbeat drift (writes reported*). All gated behind
// CONFIG_SYNC_GENERIC_ENABLED / CONFIG_DRIFT_REPORT_ENABLED (default OFF ⇒ this
// table is written by NOTHING → inert). Migration: 0293_machine_config_state.sql.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, timestamp, index, unique } from "drizzle-orm/pg-core";

export const machineConfigState = pgTable("machine_config_state", {
  id: serial("id").primaryKey(),
  /** Target machine (soft ref — no FK, mirrors process_results/idempotency tables). */
  machineId: integer("machineId").notNull(),
  /** Config family: 'recipe' | 'device_settings' | 'points' | 'model' (open vocab). */
  configKind: varchar("configKind", { length: 32 }).notNull(),
  // ── DESIRED (server intent) — written on deploy/notify ──────────────────────
  desiredCode: varchar("desiredCode", { length: 128 }),
  desiredVersion: varchar("desiredVersion", { length: 64 }),
  desiredChecksum: varchar("desiredChecksum", { length: 128 }),
  /** When the server last published the retained notify for this desired config. */
  notifiedAt: timestamp("notifiedAt"),
  // ── REPORTED (machine truth) — written on ack / heartbeat drift ─────────────
  reportedCode: varchar("reportedCode", { length: 128 }),
  reportedVersion: varchar("reportedVersion", { length: 64 }),
  reportedChecksum: varchar("reportedChecksum", { length: 128 }),
  reportedAt: timestamp("reportedAt"),
  /** in_sync | drift | unknown (default). Recomputed on every reported write. */
  driftState: varchar("driftState", { length: 16 }).default("unknown").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  // One shadow row per (machine, configKind) — the upsert conflict target.
  unique("uq_machine_config_state").on(table.machineId, table.configKind),
  index("idx_machine_config_state_machine").on(table.machineId),
  index("idx_machine_config_state_drift").on(table.driftState),
]);

export type MachineConfigState = typeof machineConfigState.$inferSelect;
export type InsertMachineConfigState = typeof machineConfigState.$inferInsert;
