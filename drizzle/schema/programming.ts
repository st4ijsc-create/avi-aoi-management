// Schema domain: Doc 09 / Phase D0 — Device Programming & Control (DPC).
//
// ════════════════════════════════════════════════════════════════════════════
// Persistence for the "Unified Engineering Workspace" — author device PROGRAMS
// (Zmotion BASIC, G-code, native IEC 61131-3, robot job-lists, vendor engineering)
// in the platform, then build → simulate → (HITL sign-off) → staged deploy → verify
// → rollback. This is the LOGIC tier that the existing command/telemetry tier
// (device_adapters / commandDispatcher) lacked.
//
// SAFETY (non-negotiable): these tables hold DEFINITIONS + an append-only DEPLOY
// AUDIT. No row here writes a device. A deploy reaches hardware ONLY through
// programmingService when DPC_DEPLOY_ENABLED is on AND a human signed off; otherwise
// it is recorded 'simulated'. Additive; nothing existing is altered.
//
//   • program_projects    — a workspace per device/cell (kind + branch + owner).
//   • program_artifacts    — immutable versioned source on a branch.
//   • program_builds       — compile results (diagnostics + optional output ref).
//   • program_sim_runs     — digital-twin/emulator simulation of a build.
//   • program_deployments  — append-only deploy audit (staged + sign-off + rollback).
//   • program_symbols      — the variable/tag/register table (feeds Online Monitor).
// ════════════════════════════════════════════════════════════════════════════
import {
  pgTable, serial, integer, varchar, text, jsonb, boolean, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import {
  programmingKindEnum,
  programArtifactStatusEnum,
  programBuildStatusEnum,
  programDeployStageEnum,
  programDeployStatusEnum,
} from "./enums";

/** A programming workspace for one device/cell. */
export const programProjects = pgTable("program_projects", {
  id: serial("id").primaryKey(),
  /** Stable code/ref (unique) — what artifacts/UI reference. */
  code: varchar("code", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  /** Target class (zmotion-basic / iec61131-st / robot-tm / ...). */
  kind: programmingKindEnum("kind").notNull(),
  /** Optional bound machine (the device this project programs). */
  deviceId: integer("deviceId"),
  description: text("description"),
  defaultBranch: varchar("defaultBranch", { length: 64 }).default("main").notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_prog_projects_kind").on(table.kind),
  index("idx_prog_projects_device").on(table.deviceId),
]);

/** One immutable source version of a project (append-version; never edited in place). */
export const programArtifacts = pgTable("program_artifacts", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  branch: varchar("branch", { length: 64 }).default("main").notNull(),
  version: integer("version").default(1).notNull(),
  kind: programmingKindEnum("kind").notNull(),
  /** Concrete language token (basic / st / ld / gcode / tmscript). */
  language: varchar("language", { length: 32 }).notNull(),
  /** Source text (binary outputs live in program_builds.outputRef). */
  content: text("content"),
  contentHash: varchar("contentHash", { length: 64 }),
  status: programArtifactStatusEnum("status").default("draft").notNull(),
  /** Last validate() diagnostics (errors/warnings). */
  diagnosticsJson: jsonb("diagnosticsJson").$type<Record<string, unknown>>(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_prog_artifacts_project").on(table.projectId),
  index("idx_prog_artifacts_status").on(table.status),
  unique("uq_prog_artifact_version").on(table.projectId, table.branch, table.version),
]);

/** A compile/build of one artifact (by a programming adapter). */
export const programBuilds = pgTable("program_builds", {
  id: serial("id").primaryKey(),
  artifactId: integer("artifactId").notNull(),
  adapterKind: programmingKindEnum("adapterKind").notNull(),
  status: programBuildStatusEnum("status").default("pending").notNull(),
  ok: boolean("ok").default(false).notNull(),
  diagnosticsJson: jsonb("diagnosticsJson").$type<Record<string, unknown>>(),
  /** Ref/path to compiled output (bytecode/PLCopen-XML/transferable), if any. */
  outputRef: text("outputRef"),
  durationMs: integer("durationMs"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_prog_builds_artifact").on(table.artifactId),
  index("idx_prog_builds_status").on(table.status),
]);

/** A digital-twin / emulator simulation of a build (no device I/O). */
export const programSimRuns = pgTable("program_sim_runs", {
  id: serial("id").primaryKey(),
  buildId: integer("buildId").notNull(),
  scenarioJson: jsonb("scenarioJson").$type<Record<string, unknown>>(),
  ok: boolean("ok").default(false).notNull(),
  timelineJson: jsonb("timelineJson").$type<Record<string, unknown>>(),
  warningsJson: jsonb("warningsJson").$type<string[]>(),
  durationMs: integer("durationMs"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_prog_sim_runs_build").on(table.buildId),
]);

/**
 * Append-only DEPLOY AUDIT. Every deploy attempt writes a row (mirrors commandLog).
 * 'simulated' = DPC_DEPLOY_ENABLED off (default) → nothing reached the device.
 */
export const programDeployments = pgTable("program_deployments", {
  id: serial("id").primaryKey(),
  buildId: integer("buildId").notNull(),
  projectId: integer("projectId").notNull(),
  deviceId: integer("deviceId"),
  stage: programDeployStageEnum("stage").default("staging").notNull(),
  status: programDeployStatusEnum("status").default("pending").notNull(),
  /** true when no real device write happened (dry-run / flag off). */
  simulated: boolean("simulated").default(true).notNull(),
  /** HITL sign-off provenance (the human who confirmed the deploy). */
  signedOffBy: integer("signedOffBy"),
  requestedBy: integer("requestedBy"),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }),
  /** When this row is a rollback, the deployment it reverted from. */
  rolledBackFromId: integer("rolledBackFromId"),
  detailJson: jsonb("detailJson").$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_prog_deploy_project").on(table.projectId),
  index("idx_prog_deploy_build").on(table.buildId),
  index("idx_prog_deploy_status").on(table.status),
  unique("uq_prog_deploy_idem").on(table.idempotencyKey),
]);

/** The variable/tag/register table of a project (feeds Online Monitor + force). */
export const programSymbols = pgTable("program_symbols", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  address: varchar("address", { length: 128 }),
  dataType: varchar("dataType", { length: 32 }),
  comment: varchar("comment", { length: 500 }),
  watchable: boolean("watchable").default(true).notNull(),
  forceable: boolean("forceable").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_prog_symbols_project").on(table.projectId),
  unique("uq_prog_symbol_name").on(table.projectId, table.name),
]);

export type ProgramProject = typeof programProjects.$inferSelect;
export type InsertProgramProject = typeof programProjects.$inferInsert;
export type ProgramArtifact = typeof programArtifacts.$inferSelect;
export type InsertProgramArtifact = typeof programArtifacts.$inferInsert;
export type ProgramBuild = typeof programBuilds.$inferSelect;
export type InsertProgramBuild = typeof programBuilds.$inferInsert;
export type ProgramSimRun = typeof programSimRuns.$inferSelect;
export type InsertProgramSimRun = typeof programSimRuns.$inferInsert;
export type ProgramDeployment = typeof programDeployments.$inferSelect;
export type InsertProgramDeployment = typeof programDeployments.$inferInsert;
export type ProgramSymbol = typeof programSymbols.$inferSelect;
export type InsertProgramSymbol = typeof programSymbols.$inferInsert;
