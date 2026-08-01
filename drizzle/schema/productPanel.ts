// Schema domain: PCB Panel / Board multi-up master (doc 29 §2 — gap doc 27 §2 M12b)
// Agent W8-B (doc 27 Đợt 8, migration 0192).
//
// AOI machines run PANELS (N-up arrays of identical boards); results come back per
// board index. `product_panel_defs` describes the panel of a productModels row
// (the single board stays the system's unit); `product_panel_boards` places each
// board inside the panel coordinate space (offset + rotation + mirror + X-out).
//
// Conventions (inherited from doc 29 §0):
//   • additive-only migration (0192): CREATE TABLE IF NOT EXISTS, varchar statuses,
//     no new pg enums;
//   • SOFT references (productModelId / panelDefId are app-validated ints, no DB FK)
//     — mirrors fleet/safetyWorkforce/inspection soft-ref convention + the weekly
//     integrity orphan scan;
//   • coordinate transform semantics live in server/services/panel/panelTransform.ts:
//     board_xy = R(−rotationDeg) · (panel_xy − offset), mirror flips X.
import { pgTable, serial, integer, varchar, decimal, boolean, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Panel definition for a product model (one product can have several panel
 * versions — e.g. a 2×4 V1 and a 2×5 V2). `nUp` is usually rows*cols but may be
 * smaller for panels with permanently omitted positions.
 *
 * boardWidthMm/boardHeightMm (delta vs doc 29, deliberate): the single-board
 * physical dims — required to make the panel→board transform + board assignment
 * well-defined. When NULL, consumers fall back to panelWidthMm/cols ×
 * panelHeightMm/rows (only exact for unrotated, gap-less grids).
 */
export const productPanelDefs = pgTable("product_panel_defs", {
  id: serial("id").primaryKey(),
  // Soft ref -> product_models.id (the single board — the unit the system already has).
  productModelId: integer("productModelId").notNull(),
  code: varchar("code", { length: 60 }).notNull(), // e.g. "PNL-2x4-V1"
  name: varchar("name", { length: 255 }),
  rows: integer("rows").notNull().default(1),
  cols: integer("cols").notNull().default(1),
  // Usually rows*cols; may differ (panel with omitted positions).
  nUp: integer("nUp").notNull(),
  panelWidthMm: decimal("panelWidthMm", { precision: 10, scale: 3 }),
  panelHeightMm: decimal("panelHeightMm", { precision: 10, scale: 3 }),
  boardWidthMm: decimal("boardWidthMm", { precision: 10, scale: 3 }),
  boardHeightMm: decimal("boardHeightMm", { precision: 10, scale: 3 }),
  // Panel coordinate origin: top_left | top_right | bottom_left | bottom_right.
  originCorner: varchar("originCorner", { length: 20 }).default("top_left"),
  // How a board serial derives from the panel serial: suffix | range | barcode_per_board.
  serialScheme: varchar("serialScheme", { length: 30 }).default("suffix"),
  // Panel-level fiducials [{x,y,type}] in mm (board-level fiducials already exist
  // in fiducial_marks — this does NOT replace them).
  fiducials: jsonb("fiducials").$type<Array<{ x: number; y: number; type?: string }>>(),
  version: integer("version").notNull().default(1),
  isActive: boolean("isActive").notNull().default(true),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_panel_defs_product").on(table.productModelId),
  uniqueIndex("uq_panel_defs_product_code_version").on(table.productModelId, table.code, table.version),
]);

export type ProductPanelDef = typeof productPanelDefs.$inferSelect;
export type InsertProductPanelDef = typeof productPanelDefs.$inferInsert;

/**
 * One board placement inside a panel. `boardIndex` (1..nUp) matches the index
 * the machine reports (product_inspections.boardIndex — 0192). `skipped` marks
 * X-out positions (panel with a marked-bad/omitted board).
 */
export const productPanelBoards = pgTable("product_panel_boards", {
  id: serial("id").primaryKey(),
  // Soft ref -> product_panel_defs.id.
  panelDefId: integer("panelDefId").notNull(),
  boardIndex: integer("boardIndex").notNull(), // 1..nUp
  // Board origin inside the panel coordinate space (mm).
  offsetXMm: decimal("offsetXMm", { precision: 10, scale: 3 }).notNull(),
  offsetYMm: decimal("offsetYMm", { precision: 10, scale: 3 }).notNull(),
  // 0|90|180|270 typical; free values allowed.
  rotationDeg: decimal("rotationDeg", { precision: 6, scale: 2 }).notNull().default("0"),
  mirrored: boolean("mirrored").notNull().default(false), // bottom-side panel
  skipped: boolean("skipped").notNull().default(false),   // X-out board
  refDesPrefix: varchar("refDesPrefix", { length: 20 }),  // e.g. "B3-" when CAD numbers per board
}, (table) => [
  index("idx_panel_boards_def").on(table.panelDefId),
  uniqueIndex("uq_panel_boards_def_index").on(table.panelDefId, table.boardIndex),
]);

export type ProductPanelBoard = typeof productPanelBoards.$inferSelect;
export type InsertProductPanelBoard = typeof productPanelBoards.$inferInsert;
