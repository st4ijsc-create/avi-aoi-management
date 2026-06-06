// Schema domain: Andon (Sprint F5a — Andon + Interlock model, ALERT-ONLY)
//
// An Andon is a VISUAL SIGNAL / NOTIFICATION raised when attention is needed
// (quality/material/maintenance/safety/setup). It is NEVER a control command —
// raising an Andon does not, and must not, write to any machine. The interlock
// engine raises system Andons; humans raise manual Andons via the router.
import { pgTable, serial, integer, varchar, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { andonStateEnum, andonReasonEnum, andonStatusEnum } from "./enums";

/**
 * Andon Events — một tín hiệu Andon (đèn báo / thông báo). KHÔNG phải lệnh điều khiển.
 * raisedBySystem=true khi do interlock engine sinh; sourceInterlockEventId liên kết về
 * interlock_events. MTTA = acknowledgedAt - raisedAt; MTTR = resolvedAt - raisedAt.
 */
export const andonEvents = pgTable("andon_events", {
  id: serial("id").primaryKey(),
  state: andonStateEnum("state").notNull(),
  reason: andonReasonEnum("reason").notNull(),
  status: andonStatusEnum("status").default("raised").notNull(),
  lineId: integer("lineId"),
  stationId: integer("stationId"),
  machineId: integer("machineId"),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  raisedBy: integer("raisedBy"),
  raisedBySystem: boolean("raisedBySystem").default(false).notNull(),
  sourceInterlockEventId: integer("sourceInterlockEventId"),
  raisedAt: timestamp("raisedAt").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledgedAt"),
  acknowledgedBy: integer("acknowledgedBy"),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: integer("resolvedBy"),
  escalationLevel: integer("escalationLevel").default(0).notNull(),
  mttaSeconds: integer("mttaSeconds"),
  mttrSeconds: integer("mttrSeconds"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_andon_line").on(table.lineId),
  index("idx_andon_station").on(table.stationId),
  index("idx_andon_machine").on(table.machineId),
  index("idx_andon_status").on(table.status),
  index("idx_andon_raised").on(table.raisedAt),
]);

export type AndonEvent = typeof andonEvents.$inferSelect;
export type InsertAndonEvent = typeof andonEvents.$inferInsert;
