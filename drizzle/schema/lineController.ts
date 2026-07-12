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
// Bốn bảng:
//   line_states            — trạng thái HIỆN TẠI mỗi tuyến (1 row / line, FSM bền
//                            qua restart — spec §7 "trạng thái bền vững").
//   line_state_transitions — sổ append-only mọi lần chuyển (và mọi lần bị policy
//                            DENY, đánh dấu rõ trong reason) — audit spec §19.3.
//                            metadata (W3-B1 §6.3): {orderId, recipeSetRef} khi
//                            transition dính pha producing — truy vết lô↔recipe↔line.
//   recipe_sets            — RecipeSet cấp tuyến (W3-B1 / spec §6.1 + §12.3):
//                            "MODEL-X@v3" — một bộ recipe THEO SẢN PHẨM, khóa
//                            (locked) suốt lô để nhất quán & truy xuất.
//   recipe_set_items       — item của set: máy nào nạp recipe VERSION nào.
//                            machine_recipe_id trỏ thẳng machineRecipes (ot.ts) —
//                            KHÔNG nhân đôi payload; deploy đi đường
//                            recipe_deployments sẵn có (db/machineRecipe.ts).
//
// Repo convention (see hierarchy.ts MACHINE_LIFECYCLE_*): trạng thái là
// text/varchar + app-level validation (KHÔNG pg enum) — thêm trạng thái sau này
// không cần ALTER TYPE. Transition map tường minh sống ở đây (cạnh schema,
// mirrors MACHINE_LIFECYCLE_TRANSITIONS) và được lineControllerService cưỡng chế.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, timestamp, real, boolean, jsonb, index, unique } from "drizzle-orm/pg-core";
import { productionLines, machines } from "./hierarchy";
import { productModels } from "./product";
import { machineRecipes } from "./ot";

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
  // W3-B1 (§6.3 genealogy v1, mig 0259): {orderId, recipeSetRef} khi transition
  // dính pha producing và tuyến có đơn hàng — truy vết lô ↔ recipe ↔ line.
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_line_state_transitions_line_ts").on(table.lineId, table.ts),
]);

export type LineStateTransitionRow = typeof lineStateTransitions.$inferSelect;
export type InsertLineStateTransitionRow = typeof lineStateTransitions.$inferInsert;

// ─── RecipeSet cấp tuyến (doc 44 W3-B1 / gap G3.3 — spec §6.1 + §12.3) ────────

/** Trạng thái vòng đời một recipe set (text + app-validation, không pg enum). */
export const RECIPE_SET_STATUSES = ["draft", "active", "retired"] as const;
export type RecipeSetStatus = (typeof RECIPE_SET_STATUSES)[number];

/**
 * Recipe Sets — bộ recipe CẤP TUYẾN theo sản phẩm (spec §12.3 RecipeSet
 * "MODEL-X@v3"). `code` là định danh phát hành (line_states.recipe_set_ref trỏ
 * vào đây); `locked` = khóa phiên bản suốt lô (spec §6.1) — set bởi
 * distributeRecipeSet khi XÁC NHẬN NẠP đủ, chỉ gỡ khi mọi tuyến dùng set ở
 * idle/completing/fault (unlockRecipeSet — compensation dùng sau).
 */
export const recipeSets = pgTable("recipe_sets", {
  id: serial("id").primaryKey(),
  // Định danh phát hành, vd "MODEL-X@v3" — unique toàn cục.
  code: text("code").notNull().unique(),
  // SET NULL: xóa product model không được kéo sập catalog recipe set (item vẫn
  // giữ nguyên tham chiếu recipe versioned — audit lineage nằm ở machineRecipes).
  productModelId: integer("product_model_id")
    .references(() => productModels.id, { onDelete: "set null" }),
  version: integer("version").default(1).notNull(),
  // Khóa phiên bản suốt lô (spec §6.1). lockedBy = actor string (user id |
  // 'api:<key>' | 'system') — không FK, giữ được actor máy/API.
  locked: boolean("locked").default(false).notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  status: text("status").$type<RecipeSetStatus>().default("draft").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_recipe_sets_status").on(table.status),
]);

export type RecipeSetRow = typeof recipeSets.$inferSelect;
export type InsertRecipeSetRow = typeof recipeSets.$inferInsert;

/**
 * Recipe Set Items — MỖI máy của set nạp recipe VERSION nào. machine_recipe_id
 * trỏ MỘT row machine_recipes cụ thể (một phiên bản) — tham chiếu recipe
 * versioned SẴN CÓ, không nhân đôi payload. RESTRICT trên máy + recipe: item
 * của set là cấu hình "khóa suốt lô" — không được rút ruột âm thầm.
 * station_id là soft ref denormalized (máy đã ngầm định trạm) — không FK.
 */
export const recipeSetItems = pgTable("recipe_set_items", {
  id: serial("id").primaryKey(),
  recipeSetId: integer("recipe_set_id").notNull()
    .references(() => recipeSets.id, { onDelete: "cascade" }),
  stationId: integer("station_id"),
  machineId: integer("machine_id").notNull()
    .references(() => machines.id, { onDelete: "restrict" }),
  machineRecipeId: integer("machine_recipe_id").notNull()
    .references(() => machineRecipes.id, { onDelete: "restrict" }),
  // required=true → máy PHẢI active đúng phiên bản mới đạt "xác nhận nạp" (§6.1).
  required: boolean("required").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("uq_recipe_set_items_set_machine").on(table.recipeSetId, table.machineId),
  index("idx_recipe_set_items_set").on(table.recipeSetId),
]);

export type RecipeSetItemRow = typeof recipeSetItems.$inferSelect;
export type InsertRecipeSetItemRow = typeof recipeSetItems.$inferInsert;
