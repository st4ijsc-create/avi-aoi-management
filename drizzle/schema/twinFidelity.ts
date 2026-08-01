// Schema domain: Digital-Twin Fidelity (doc 44 W5-A1, gap G4.1).
//
// ════════════════════════════════════════════════════════════════════════════
// SYNAPSE Tầng-4 spec §5.2 "Twin chỉ hữu ích khi được hiệu chỉnh": một twin
// KHÔNG hiệu chỉnh cho khuyến nghị SAI một cách tự tin — nguy hiểm hơn KHÔNG có
// twin. Vì vậy mọi twin dùng cho quyết định phải có (a) chỉ số trung thực đo
// được, (b) ngưỡng chấp nhận rõ ràng, (c) cơ chế TỰ VÔ HIỆU khi lệch.
//
//   • simulation_runs — sổ mọi lần chạy twin (mirror / what_if / replay /
//     vcommission / fidelity_check); mode=fidelity_check ghi kết quả so sim-vs-thực.
//   • twin_trust      — 1 hàng/twin_ref: trusted + fidelity_pct + số lần lệch
//     LIÊN TIẾP (chỉ vô hiệu sau ≥N lần để không rung theo 1 nhiễu đơn lẻ).
//
// isTwinTrusted(twinRef) là hàm public để optimizer/advisor tiêu thụ — twin
// untrusted ⇒ chỉ tham khảo, KHÔNG dùng cho quyết định tự động (spec §5.2).
// Maintained by server/services/twin/twinFidelityService (sweep TWIN_FIDELITY_ENABLED,
// default OFF). Migration: drizzle/0260_twin_fidelity.sql.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, timestamp, jsonb, doublePrecision, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";

/** App-validated twin run modes (SYNAPSE §5.1). */
export const SIMULATION_RUN_MODES = ["mirror", "what_if", "replay", "vcommission", "fidelity_check"] as const;
export type SimulationRunMode = (typeof SIMULATION_RUN_MODES)[number];

/** App-validated run statuses. */
export const SIMULATION_RUN_STATUSES = ["running", "done", "failed"] as const;
export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUSES)[number];

export const simulationRuns = pgTable(
  "simulation_runs",
  {
    id: serial("id").primaryKey(),
    /** Stable external id (e.g. "sim-fid-<lineId>-<ts>"). */
    simId: text("sim_id").notNull(),
    /** Twin the run targets: "line:<id>" | "machine:<id>" | "factory:<id>". */
    twinRef: text("twin_ref").notNull(),
    mode: text("mode").$type<SimulationRunMode>().notNull(),
    /** What-if / fidelity scenario inputs (JSON). */
    scenario: jsonb("scenario").$type<Record<string, unknown>>(),
    /** Run outputs (throughput, cycle, bottleneck…). */
    result: jsonb("result").$type<Record<string, unknown>>(),
    /** { cycle_err_pct, throughput_err_pct, sample_window, computed_at }. NULL for non-fidelity runs. */
    fidelity: jsonb("fidelity").$type<Record<string, unknown>>(),
    status: text("status").$type<SimulationRunStatus>().default("running").notNull(),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    uniqueIndex("uq_simulation_runs_sim_id").on(table.simId),
    index("idx_simulation_runs_twin_ref").on(table.twinRef, table.createdAt),
  ],
);

export const twinTrust = pgTable("twin_trust", {
  /** One row per twin. "line:<id>" | "machine:<id>" | "factory:<id>". */
  twinRef: text("twin_ref").primaryKey(),
  /** FALSE ⇒ twin không đủ trung thực cho quyết định tự động (chỉ tham khảo). */
  trusted: boolean("trusted").default(true).notNull(),
  /** Latest fidelity as a percentage (100 = perfect); NULL until first check. */
  fidelityPct: doublePrecision("fidelity_pct"),
  /** Số lần lệch LIÊN TIẾP (reset về 0 khi 1 lần đạt). */
  consecutiveBreaches: integer("consecutive_breaches").default(0).notNull(),
  lastCheckAt: timestamp("last_check_at"),
  /** Lý do lần cập nhật gần nhất (vì sao trusted/untrusted). */
  reason: text("reason"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
