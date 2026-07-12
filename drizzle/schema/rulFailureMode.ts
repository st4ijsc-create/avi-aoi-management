// Schema domain: RUL survival estimates + failure-mode classification
// (doc 44 W5-B3, gaps G4.7 software + G4.8 software).
//
// ════════════════════════════════════════════════════════════════════════════
// SYNAPSE Tầng-4 §7.2 "Dự đoán RUL": khi CÓ đủ lịch sử hỏng hóc → ước tính thời
// gian còn lại tới hỏng. §7.2 "Phân loại chế độ hỏng": gợi ý nguyên nhân (mòn
// vòng bi, lệch trục, tắc kim keo…) để bảo trì ĐÚNG HƯỚNG.
//
// Bối cảnh (audit T4): RUL cũ tự khai "heuristic proxy … no dedicated RUL
// regressor" (EWMA-linear-extrapolation cắt ngưỡng 40, cap MTBF); failure-mode
// classification = 0. Batch này thêm:
//   • rul_estimates  — sổ mọi lần ước tính RUL. method='weibull' khi fit được
//     survival Weibull 2-tham-số trên đủ quan sát hỏng thật; method='heuristic'
//     khi thiếu quan sát (< RUL_MIN_OBSERVATIONS) → FALLBACK trung thực, KHÔNG
//     bịa độ tin cậy. confidence suy từ SỐ QUAN SÁT hỏng thật.
//   • failure_events — sổ chuẩn thời-điểm-hỏng + chế-độ-hỏng (TTF + failureMode).
//     failureMode='unknown' reason='no vibration sensor' khi KHÔNG có cảm biến
//     rung (hầu hết máy hiện tại) — KHÔNG đoán bừa. features = phổ tần/rung khi CÓ.
//
// Maintained by:
//   server/services/ai/rulEstimatorService  (cờ RUL_WEIBULL_ENABLED, default OFF)
//   server/services/ai/failureModeClassifier (cờ FAILURE_MODE_ENABLED, default OFF)
// Migration: drizzle/0265_rul_failure_mode.sql (additive + idempotent).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, timestamp, jsonb, doublePrecision, boolean, index } from "drizzle-orm/pg-core";

/** How the RUL was produced (honest provenance — never fabricate confidence). */
export const RUL_METHODS = ["weibull", "heuristic", "insufficient_data"] as const;
export type RulMethod = (typeof RUL_METHODS)[number];

export const rulEstimates = pgTable(
  "rul_estimates",
  {
    id: serial("id").primaryKey(),
    machineId: integer("machine_id").notNull(),
    /** Machine class the survival fit pooled over (equipment class). */
    machineType: text("machine_type"),
    /** Component granularity ('machine' when whole-asset). */
    componentKey: text("component_key").default("machine").notNull(),
    method: text("method").$type<RulMethod>().notNull(),
    /** Estimated remaining useful life in HOURS (conditional expectation). NULL when unknown. */
    rulHours: doublePrecision("rul_hours"),
    /** Current age used as the conditioning time (hours since last failure/install). */
    ageHours: doublePrecision("age_hours"),
    /** Fitted Weibull shape k (NULL when method != 'weibull'). */
    shape: doublePrecision("shape"),
    /** Fitted Weibull scale λ in hours (NULL when method != 'weibull'). */
    scale: doublePrecision("scale"),
    /** Total observations used (failures + censored). */
    observations: integer("observations").default(0).notNull(),
    /** Uncensored failure observations (the gate for 'weibull' vs 'heuristic'). */
    failures: integer("failures").default(0).notNull(),
    /** Right-censored observations (still-running / no failure yet). */
    censored: integer("censored").default(0).notNull(),
    /** 0..1 — derived from number of failure observations (NOT model self-report). */
    confidence: doublePrecision("confidence").default(0).notNull(),
    /** Honest one-line explanation (why weibull / why fallback). */
    note: text("note"),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_rul_estimates_machine").on(table.machineId, table.computedAt),
    index("idx_rul_estimates_type").on(table.machineType),
  ],
);

export type RulEstimateRow = typeof rulEstimates.$inferSelect;
export type InsertRulEstimate = typeof rulEstimates.$inferInsert;

/** Where a failure event was sourced from (audit provenance). */
export const FAILURE_EVENT_SOURCES = ["work_order", "downtime_event", "classifier", "manual"] as const;
export type FailureEventSource = (typeof FAILURE_EVENT_SOURCES)[number];

export const failureEvents = pgTable(
  "failure_events",
  {
    id: serial("id").primaryKey(),
    machineId: integer("machine_id").notNull(),
    machineType: text("machine_type"),
    /** Component the failure is attributed to (NULL = whole machine). */
    componentKey: text("component_key"),
    /** Failure mode taxonomy label; 'unknown' when no discriminating signal. */
    failureMode: text("failure_mode"),
    /** Honest reason for the mode verdict (e.g. 'no vibration sensor'). */
    failureModeReason: text("failure_mode_reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** Time-to-failure in hours (since previous failure / install). NULL if unknown. */
    ttfHours: doublePrecision("ttf_hours"),
    /** TRUE ⇒ right-censored (no failure yet — used by the survival fit). */
    censored: boolean("censored").default(false).notNull(),
    source: text("source").$type<FailureEventSource>().notNull(),
    /** Link back to the originating row (work_order.id / downtime_event.id). */
    sourceId: integer("source_id"),
    /** Spectral/vibration features when available ({rms,kurtosis,crestFactor,peakFreqHz,...}). */
    features: jsonb("features").$type<Record<string, unknown>>(),
    /** 0..1 classifier confidence (NULL when mode 'unknown'). */
    confidence: doublePrecision("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_failure_events_machine").on(table.machineId, table.occurredAt),
    index("idx_failure_events_type").on(table.machineType),
    index("idx_failure_events_mode").on(table.failureMode),
  ],
);

export type FailureEventRow = typeof failureEvents.$inferSelect;
export type InsertFailureEvent = typeof failureEvents.$inferInsert;
