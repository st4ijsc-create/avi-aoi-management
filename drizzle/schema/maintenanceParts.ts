// Schema domain: Maintenance automation — spare-parts consumption (doc 35 W4-A).
// ============================================================================
// Closes the orphan gap: spare_parts_inventory (mes.ts) had NO consumption link
// to a work order. work_order_parts is the append-per-consumption ledger that
// records which parts a maintenance work order used and decrements the on-hand
// inventory (done atomically in maintenanceRouter.recordPartsUsed).
//
// FK NOTES (deliberate soft references, mirroring mes.ts's style):
//   * workOrderId — soft ref -> maintenance_work_orders.id (NOT NULL). No hard FK
//     so this stays additive (CREATE TABLE/INDEX only, no cross-table constraint
//     that could block additive rollout).
//   * sparePartId — soft ref -> spare_parts_inventory.id (nullable). partCode is
//     kept alongside as the human-facing/denormalised handle (the inventory row
//     may be resolved by either id or its unique partCode at record time).
//   * unitCost is a SNAPSHOT of spare_parts_inventory.unitCost at consumption
//     time (cost history must not drift when the master unitCost later changes).
import { pgTable, serial, integer, text, timestamp, varchar, decimal, index } from "drizzle-orm/pg-core";

/**
 * Work Order Parts — phụ tùng đã tiêu thụ trên 1 lệnh công việc bảo trì.
 * Mỗi bản ghi = 1 lần ghi nhận tiêu thụ (append-only ledger).
 */
export const workOrderParts = pgTable("work_order_parts", {
  id: serial("id").primaryKey(),
  workOrderId: integer("workOrderId").notNull(),        // soft FK -> maintenance_work_orders.id
  sparePartId: integer("sparePartId"),                  // soft FK -> spare_parts_inventory.id (nullable)
  partCode: varchar("partCode", { length: 64 }).notNull(),
  quantityUsed: integer("quantityUsed").default(1).notNull(),
  unitCost: decimal("unitCost", { precision: 14, scale: 2 }), // snapshot at consumption time
  consumedAt: timestamp("consumedAt").defaultNow().notNull(),
  consumedBy: integer("consumedBy"),                    // FK -> users.id (nullable)
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_wop_workorder").on(table.workOrderId),
  index("idx_wop_sparepart").on(table.sparePartId),
  index("idx_wop_partcode").on(table.partCode),
]);

export type WorkOrderPart = typeof workOrderParts.$inferSelect;
export type InsertWorkOrderPart = typeof workOrderParts.$inferInsert;
