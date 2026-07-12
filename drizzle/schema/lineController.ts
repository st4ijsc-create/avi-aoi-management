// Schema domain: Line Controller (doc 44 W3-A2 / gap G3.1 — SYNAPSE LDS-L3 PHẦN II, Chương 4-7).
//
// ════════════════════════════════════════════════════════════════════════════
// Line Controller giữ MỘT máy trạng thái thống nhất cho mỗi tuyến (spec §4.1):
//
//   IDLE ──▶ READY ──▶ PRODUCING ⇄ HELD ──▶ COMPLETING ──▶ IDLE
//     │        │           │
//     │        │           └──(sự cố)──▶ FAULT ──▶ (khắc phục + xác nhận) READY
//     └────────┴──(đổi sản phẩm)──▶ CHANGEOVER ──▶ READY
//
// Hai bảng:
//   line_states            — trạng thái HIỆN TẠI mỗi tuyến (1 row / line, FSM bền
//                            qua restart — spec §7 "trạng thái bền vững").
//   line_state_transitions — sổ append-only mọi lần chuyển (và mọi lần bị policy
//                            DENY, đánh dấu rõ trong reason) — audit spec §19.3.
//
// Repo convention (see hierarchy.ts MACHINE_LIFECYCLE_*): trạng thái là
// text/varchar + app-level validation (KHÔNG pg enum) — thêm trạng thái sau này
// không cần ALTER TYPE. Transition map tường minh sống ở đây (cạnh schema,
// mirrors MACHINE_LIFECYCLE_TRANSITIONS) và được lineControllerService cưỡng chế.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, timestamp, real, index } from "drizzle-orm/pg-core";
import { productionLines } from "./hierarchy";

/** 7 trạng thái tuyến — spec LDS-L3 §4.1 (lowercase tokens; UNS publish dùng UPPERCASE). */
export const LINE_STATES = [
  "idle",
  "ready",
  "producing",
  "held",
  "completing",
  "changeover",
  "fault",
] as const;
export type LineControllerState = (typeof LINE_STATES)[number];

/**
 * Transition map tường minh (spec §4.1 + doc 44 W3-A2):
 *   idle→ready (readiness đạt) · ready→producing (start) · producing⇄held
 *   (hold/resume) · producing→completing (drain) · completing→idle ·
 *   {idle,ready}→changeover→ready · *→fault (sự cố) · fault→ready (khắc phục +
 *   xác nhận). Mọi cặp không liệt kê (kể cả same-state) = INVALID_TRANSITION.
 */
export const LINE_STATE_TRANSITIONS: Record<LineControllerState, readonly LineControllerState[]> = {
  idle: ["ready", "changeover", "fault"],
  ready: ["producing", "changeover", "fault"],
  producing: ["held", "completing", "fault"],
  held: ["producing", "fault"],
  completing: ["idle", "fault"],
  changeover: ["ready", "fault"],
  fault: ["ready"],
};

/** Là một transition hợp lệ theo map? (same-state luôn false — không phải chuyển.) */
export function isLegalLineStateTransition(from: string, to: string): boolean {
  const allowed = LINE_STATE_TRANSITIONS[from as LineControllerState];
  return Array.isArray(allowed) ? (allowed as readonly string[]).includes(to) : false;
}

/** Parse an toàn một nhãn trạng thái tuyến (fail-safe → null, không bịa). */
export function asLineControllerState(raw: unknown): LineControllerState | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return (LINE_STATES as readonly string[]).includes(s) ? (s as LineControllerState) : null;
}

/**
 * Line States — trạng thái FSM hiện tại của MỖI tuyến (1 row / line).
 * takt_target_s / active_order_id / recipe_set_ref do Orchestration (W3-B) nạp;
 * batch này chỉ đọc + set recipe_set_ref khi changeover truyền vào.
 */
export const lineStates = pgTable("line_states", {
  id: serial("id").primaryKey(),
  // 1 tuyến = 1 row (unique). CASCADE: row trạng thái là dữ liệu phái sinh của
  // tuyến — hard-delete tuyến (vốn đã bị RESTRICT bởi stations) không bị chặn thêm.
  lineId: integer("line_id").notNull().unique()
    .references(() => productionLines.id, { onDelete: "cascade" }),
  state: text("state").$type<LineControllerState>().default("idle").notNull(),
  // Lý do giữ tuyến (spec §12.2 held_reason) — chỉ có nghĩa khi state='held',
  // được xóa khi rời held.
  heldReason: text("held_reason"),
  // Recipe set đang khóa cho lô (spec §6.1 "MODEL-X@v3") — RecipeSet đầy đủ = W3-B.
  recipeSetRef: text("recipe_set_ref"),
  // Đơn hàng đang chạy trên tuyến (production_orders.id) — Orchestration W3-B nạp.
  activeOrderId: integer("active_order_id"),
  // Takt mục tiêu (giây) — spec §12.2 takt_s. NULL = chưa đặt (honest).
  taktTargetS: real("takt_target_s"),
  // Thời điểm VÀO trạng thái hiện tại (đổi mỗi transition).
  enteredAt: timestamp("entered_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_line_states_state").on(table.state),
]);

export type LineStateRow = typeof lineStates.$inferSelect;
export type InsertLineStateRow = typeof lineStates.$inferInsert;

/**
 * Line State Transitions — sổ audit append-only (spec §19.3): mỗi lần chuyển
 * trạng thái MỘT row; một attempt bị policy DENY cũng được ghi (reason có tiền
 * tố "POLICY_DENIED:" — KHÔNG phải transition thật, line_states không đổi).
 * KHÔNG FK để audit sống lâu hơn cả tuyến bị xóa.
 */
export const lineStateTransitions = pgTable("line_state_transitions", {
  id: serial("id").primaryKey(),
  lineId: integer("line_id").notNull(),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  reason: text("reason"),
  // user id | 'system' | 'orchestration' | 'api:<key-name>' — ai kích hoạt.
  triggeredBy: text("triggered_by").default("system").notNull(),
  // Correlation id xuyên tầng (ALS backbone — observability/correlation.ts).
  correlationId: text("correlation_id"),
  // policy id đã PERMIT/DENY lệnh (spec §12.3 PolicyDecision.policy_ref).
  policyRef: text("policy_ref"),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_line_state_transitions_line_ts").on(table.lineId, table.ts),
]);

export type LineStateTransitionRow = typeof lineStateTransitions.$inferSelect;
export type InsertLineStateTransitionRow = typeof lineStateTransitions.$inferInsert;
