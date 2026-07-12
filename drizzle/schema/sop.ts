// Schema domain: e-SOP (doc 44 W6-1 / gap G5.14 — SYNAPSE LDS-L5 Chương 6.2).
//
// ════════════════════════════════════════════════════════════════════════════
// e-SOP (quy trình thao tác chuẩn điện tử) — spec §6.2:
//   • Hướng dẫn TỪNG BƯỚC theo ngữ cảnh (sản phẩm / trạm / changeover).
//   • Checklist BẮT BUỘC: một số bước phải xác nhận mới cho tiếp (kiểm jig, đúng
//     vật tư) — requires_confirm + expected_input (giá trị scan mong đợi).
//   • Gắn readiness tuyến (Tầng 3) — sopReadinessContribution() ở sopService.
//   • Ghi VẾT thao tác tay: sop_executions.step_confirmations vào genealogy con
//     người (ai xác nhận bước nào, lúc nào, nhập gì).
//
// BA bảng:
//   sops             — định nghĩa SOP (code + version + status draft|active|retired).
//                      Nhiều row cùng `code` khác `version`; bản đang hiệu lực =
//                      status='active'. unique(code, version).
//   sop_steps        — các bước của MỘT sop (step_no, text, media_ref,
//                      requires_confirm, expected_input). unique(sop_id, step_no).
//   sop_executions   — MỖI lần thực thi SOP trên một đơn vị/serial (operator,
//                      started/finished, step_confirmations jsonb). Append-only.
//
// Repo convention (như lineController.ts): status là varchar + app-validation
// (KHÔNG pg enum) — thêm trạng thái sau không cần ALTER TYPE. Cột snake_case.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, varchar, boolean, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { productModels } from "./product";
import { stations } from "./hierarchy";

/** Vòng đời một SOP (spec §6.2). */
export const SOP_STATUSES = ["draft", "active", "retired"] as const;
export type SopStatus = (typeof SOP_STATUSES)[number];

/** Vòng đời một phiên thực thi SOP. */
export const SOP_EXECUTION_STATUSES = ["in_progress", "completed", "abandoned"] as const;
export type SopExecutionStatus = (typeof SOP_EXECUTION_STATUSES)[number];

/**
 * Một xác nhận bước (ghi vào genealogy con người — spec §6.2 "ghi vết thao tác
 * tay"). confirmedAt = ISO string; input = giá trị operator nhập/scan tại bước
 * requires_confirm có expected_input.
 */
export interface SopStepConfirmation {
  stepNo: number;
  confirmedBy?: number | null;
  confirmedAt: string;
  input?: string | null;
}

/**
 * SOPs — định nghĩa quy trình. code+version là định danh phát hành; bản hiệu lực
 * = status='active'. product_model_id / station_id nullable → SOP có thể gắn cụ
 * thể sản phẩm/trạm hoặc chung (null = áp mọi ngữ cảnh). SET NULL: xóa sản
 * phẩm/trạm không kéo sập catalog SOP.
 */
export const sops = pgTable("sops", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 80 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  productModelId: integer("product_model_id").references(() => productModels.id, { onDelete: "set null" }),
  stationId: integer("station_id").references(() => stations.id, { onDelete: "set null" }),
  version: integer("version").default(1).notNull(),
  status: varchar("status", { length: 16 }).$type<SopStatus>().default("draft").notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("uq_sops_code_version").on(t.code, t.version),
  index("idx_sops_status").on(t.status),
  index("idx_sops_product").on(t.productModelId),
  index("idx_sops_station").on(t.stationId),
]);

export type SopRow = typeof sops.$inferSelect;
export type InsertSopRow = typeof sops.$inferInsert;

/**
 * SOP Steps — các bước của một sop. requires_confirm=true → phải xác nhận mới cho
 * tiếp; expected_input (nếu có) = giá trị mong đợi (mã jig/vật tư scan) — bước chỉ
 * qua khi input khớp. CASCADE theo sop (step là dữ liệu con của định nghĩa SOP).
 */
export const sopSteps = pgTable("sop_steps", {
  id: serial("id").primaryKey(),
  sopId: integer("sop_id").notNull().references(() => sops.id, { onDelete: "cascade" }),
  stepNo: integer("step_no").notNull(),
  text: text("text").notNull(),
  mediaRef: varchar("media_ref", { length: 500 }),
  requiresConfirm: boolean("requires_confirm").default(false).notNull(),
  expectedInput: varchar("expected_input", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("uq_sop_steps_sop_stepno").on(t.sopId, t.stepNo),
  index("idx_sop_steps_sop").on(t.sopId),
]);

export type SopStepRow = typeof sopSteps.$inferSelect;
export type InsertSopStepRow = typeof sopSteps.$inferInsert;

/**
 * SOP Executions — sổ append-only MỖI phiên thực thi SOP (spec §6.2 genealogy con
 * người). RESTRICT trên sop_id → không hard-delete SOP còn phiên tham chiếu.
 * step_confirmations jsonb giữ toàn bộ dấu tay operator.
 */
export const sopExecutions = pgTable("sop_executions", {
  id: serial("id").primaryKey(),
  sopId: integer("sop_id").notNull().references(() => sops.id, { onDelete: "restrict" }),
  unitSerial: varchar("unit_serial", { length: 128 }),
  lineId: integer("line_id"),
  stationId: integer("station_id"),
  operatorId: integer("operator_id"),
  status: varchar("status", { length: 16 }).$type<SopExecutionStatus>().default("in_progress").notNull(),
  stepConfirmations: jsonb("step_confirmations").$type<SopStepConfirmation[]>().default([]).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_sop_exec_sop").on(t.sopId),
  index("idx_sop_exec_status").on(t.status),
  index("idx_sop_exec_started").on(t.startedAt),
]);

export type SopExecutionRow = typeof sopExecutions.$inferSelect;
export type InsertSopExecutionRow = typeof sopExecutions.$inferInsert;
