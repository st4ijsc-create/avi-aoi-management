// Schema domain: Parameter Guardrails (doc 44 W5-A2, gaps G4.18/G4.19/G4.20).
//
// ════════════════════════════════════════════════════════════════════════════
// SYNAPSE Tầng-4 §9.2 "Guardrail cứng": dải min–max do KỸ SƯ QUÁ TRÌNH đặt —
// mô hình/AI KHÔNG được đề xuất hay ghi ngoài dải (chặn ở cả Tầng-4 và Policy).
// §18.1 chốt chặn #1. Trước batch này `set_machine_param` nhận value tùy ý KHÔNG
// clamp và KHÔNG có bảng dải per-parameter → đây là bảng đó.
//
//   • parameter_guardrails — 1 hàng / (scope, target, param_key). scope='machine'
//     (máy cụ thể) THẮNG scope='machine_type' (mặc định theo loại máy). max_step =
//     bước điều chỉnh tối đa mỗi lần (§9.2 "thay đổi nhỏ, có kiểm chứng").
//     requires_twin_validation = §18.1 chốt #2 (twin-first) cho param nhạy cảm.
//   • parameter_change_log — APPEND-ONLY sổ mọi lần đổi param (§9.2 "ghi nhận &
//     lùi được"). verify_status khép vòng closed-loop (§16): so metrics_before vs
//     metrics_after sau verify_after → improved|degraded|neutral (degraded→Andon).
//
// Maintained by server/services/ai/parameterGuardrailService. Enforcement điểm:
// set_machine_param (writeHandlers/machineControl). Migration: 0261_parameter_guardrails.sql.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, timestamp, jsonb, doublePrecision, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Guardrail scope: a concrete machine, or a default for a machine type. */
export const PARAM_GUARDRAIL_SCOPES = ["machine", "machine_type"] as const;
export type ParameterGuardrailScope = (typeof PARAM_GUARDRAIL_SCOPES)[number];

/** Where a change originated (audit provenance). */
export const PARAM_CHANGE_SOURCES = ["ai_proposal", "manual", "auto_tune"] as const;
export type ParameterChangeSource = (typeof PARAM_CHANGE_SOURCES)[number];

/** Closed-loop verify verdict (§16). 'pending' until verify_after has elapsed. */
export const PARAM_VERIFY_STATUSES = ["pending", "improved", "degraded", "neutral"] as const;
export type ParameterVerifyStatus = (typeof PARAM_VERIFY_STATUSES)[number];

export const parameterGuardrails = pgTable(
  "parameter_guardrails",
  {
    id: serial("id").primaryKey(),
    /** 'machine' (machineId set) | 'machine_type' (machineType set). */
    scope: text("scope").$type<ParameterGuardrailScope>().notNull(),
    /** Target machine id (scope='machine'). NULL for machine_type scope. */
    machineId: integer("machine_id"),
    /** Target machine type/code (scope='machine_type'). NULL for machine scope. */
    machineType: text("machine_type"),
    /** Parameter key (e.g. the writable tag key: 'torque_nm', 'temp_c'). */
    paramKey: text("param_key").notNull(),
    /** Hard lower bound — reject below (do NOT clamp silently). */
    minValue: doublePrecision("min_value").notNull(),
    /** Hard upper bound — reject above. */
    maxValue: doublePrecision("max_value").notNull(),
    /** Max change per single write (|new-old|). NULL ⇒ no step limit. */
    maxStep: doublePrecision("max_step"),
    unit: text("unit"),
    /** §18.1 chốt #2 — sensitive param: AI proposals need twin-first validation. */
    requiresTwinValidation: boolean("requires_twin_validation").default(false).notNull(),
    /** Engineer who set the range (accountability). */
    setBy: integer("set_by"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One machine-scoped guardrail per (machine, param). Partial: machine scope only.
    uniqueIndex("uq_param_guardrail_machine")
      .on(table.machineId, table.paramKey)
      .where(sql`scope = 'machine' AND machine_id IS NOT NULL`),
    // One type-scoped guardrail per (machineType, param). Partial: type scope only.
    uniqueIndex("uq_param_guardrail_type")
      .on(table.machineType, table.paramKey)
      .where(sql`scope = 'machine_type' AND machine_type IS NOT NULL`),
    index("idx_param_guardrail_param").on(table.paramKey),
  ],
);

export type ParameterGuardrail = typeof parameterGuardrails.$inferSelect;
export type InsertParameterGuardrail = typeof parameterGuardrails.$inferInsert;

export const parameterChangeLog = pgTable(
  "parameter_change_log",
  {
    id: serial("id").primaryKey(),
    machineId: integer("machine_id"),
    paramKey: text("param_key").notNull(),
    oldValue: doublePrecision("old_value"),
    newValue: doublePrecision("new_value"),
    source: text("source").$type<ParameterChangeSource>().notNull(),
    /** Guardrail row that governed this change (NULL when none configured). */
    guardrailId: integer("guardrail_id"),
    /** Closed-loop verdict; 'pending' until the sweep verifies after verify_after. */
    verifyStatus: text("verify_status").$type<ParameterVerifyStatus>().default("pending").notNull(),
    /** Earliest time the change may be verified (now + PARAM_VERIFY_DELAY). */
    verifyAfter: timestamp("verify_after", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Machine KPI snapshot at change time ({ ngRatePct, total, computedAt }). */
    metricsBefore: jsonb("metrics_before").$type<Record<string, unknown>>(),
    /** Machine KPI snapshot at verify time. */
    metricsAfter: jsonb("metrics_after").$type<Record<string, unknown>>(),
    correlationId: text("correlation_id"),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_param_change_machine").on(table.machineId, table.paramKey),
    // Drives the verify sweep: pending rows past their verify_after.
    index("idx_param_change_verify").on(table.verifyStatus, table.verifyAfter),
  ],
);

export type ParameterChangeLogRow = typeof parameterChangeLog.$inferSelect;
export type InsertParameterChangeLog = typeof parameterChangeLog.$inferInsert;
