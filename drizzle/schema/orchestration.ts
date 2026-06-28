// Schema domain: Phase E2 — Factory Control Plane / Factory Orchestration Engine (FOE).
//
// ════════════════════════════════════════════════════════════════════════════
// Persistence for the BUILD-OWN ISA-88-style workflow runtime that sequences
// commands ACROSS MULTIPLE MACHINES (any type) with interlocks, HITL gates, and
// compensation. Every control still routes through the E0 equipmentRegistry →
// existing HITL/dry-run dispatcher; these tables only record DEFINITIONS, RUNS and
// per-step AUDIT. Additive; nothing existing is altered.
//
//   • orchestration_workflows  — a deployed, versioned, portable JSON definition.
//   • orchestration_runs       — one execution of a workflow (status machine + ctx).
//   • orchestration_run_steps  — append-style per-step audit (state/attempt/result).
// ════════════════════════════════════════════════════════════════════════════
import {
  pgTable, serial, integer, varchar, text, jsonb, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import {
  orchestrationWorkflowStatusEnum,
  orchestrationRunStatusEnum,
  orchestrationRunStepStatusEnum,
} from "./enums";
import type { WorkflowDefinition } from "../../server/services/orchestration/foe/workflowModel";

/** A deployed orchestration workflow (the portable ISA-88-ish JSON definition). */
export const orchestrationWorkflows = pgTable("orchestration_workflows", {
  id: serial("id").primaryKey(),
  /** Stable code/ref (unique) — what a run references. */
  ref: varchar("ref", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  version: integer("version").default(1).notNull(),
  description: text("description"),
  /** The full WorkflowDefinition (steps/params/conditions). */
  definitionJson: jsonb("definitionJson").$type<WorkflowDefinition>().notNull(),
  status: orchestrationWorkflowStatusEnum("status").default("active").notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_orch_workflows_status").on(table.status),
  index("idx_orch_workflows_ref").on(table.ref),
]);

/** One RUN (execution) of a workflow. The run-level status machine lives here. */
export const orchestrationRuns = pgTable("orchestration_runs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflowId").notNull(),
  /** Denormalised ref for convenience/audit (workflow may be re-versioned). */
  workflowRef: varchar("workflowRef", { length: 128 }),
  status: orchestrationRunStatusEnum("status").default("queued").notNull(),
  /** Run-level input params (validated against the workflow param decls). */
  paramsJson: jsonb("paramsJson").$type<Record<string, unknown>>(),
  /** Run-level mutable context (cursor bookkeeping, gate decisions, last telemetry). */
  contextJson: jsonb("contextJson").$type<Record<string, unknown>>(),
  /** The step the run is currently AT (a hitl_gate / held step, when paused). */
  currentStepId: varchar("currentStepId", { length: 128 }),
  /**
   * Phase E4 — OPTIONAL: the edge node a run is DELEGATED to (null = central).
   * Additive nullable column (migration 0128). When set, an edge runtime hosts the
   * FOE execution near the line and SYNCS step results back to central.
   */
  edgeNodeId: integer("edgeNodeId"),
  startedBy: integer("startedBy"),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_orch_runs_workflow").on(table.workflowId),
  index("idx_orch_runs_status").on(table.status),
  index("idx_orch_runs_created").on(table.createdAt),
]);

/** Per-step audit row — one per step the run touches (append-style; latest wins). */
export const orchestrationRunSteps = pgTable("orchestration_run_steps", {
  id: serial("id").primaryKey(),
  runId: integer("runId").notNull(),
  /** The step.id from the definition. */
  stepId: varchar("stepId", { length: 128 }).notNull(),
  stepType: varchar("stepType", { length: 32 }).notNull(),
  status: orchestrationRunStepStatusEnum("status").default("pending").notNull(),
  attempt: integer("attempt").default(0).notNull(),
  /** Result of the step (e.g. the dispatcher EquipmentCommandResult, branch taken). */
  resultJson: jsonb("resultJson").$type<Record<string, unknown>>(),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_orch_run_steps_run").on(table.runId),
  index("idx_orch_run_steps_status").on(table.status),
  unique("uq_orch_run_step").on(table.runId, table.stepId),
]);

export type OrchestrationWorkflow = typeof orchestrationWorkflows.$inferSelect;
export type InsertOrchestrationWorkflow = typeof orchestrationWorkflows.$inferInsert;
export type OrchestrationRun = typeof orchestrationRuns.$inferSelect;
export type InsertOrchestrationRun = typeof orchestrationRuns.$inferInsert;
export type OrchestrationRunStep = typeof orchestrationRunSteps.$inferSelect;
export type InsertOrchestrationRunStep = typeof orchestrationRunSteps.$inferInsert;
