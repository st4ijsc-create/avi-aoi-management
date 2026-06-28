// Schema domain: Phase E4 — Factory Control Plane / EDGE CONTROL RUNTIME.
//
// ════════════════════════════════════════════════════════════════════════════
// Persistence for the EDGE coordination layer: an edge-node registry (central) +
// an OPTIONAL edgeNodeId on orchestration_runs (which node a run is delegated to).
//
// HONEST SCOPE (read this): this framework provides COORDINATION + an OFFLINE
// BUFFER + an EXECUTION WRAPPER that REUSES the E2 FOE engine on an edge host. It
// does NOT provide hard real-time / sub-ms determinism — that needs a DEDICATED
// edge host (RTOS / Node-RED-edge / a C/Rust agent). SAFETY (E-stop / interlock /
// motion) ALWAYS stays on the certified L1 PLC. Every command an edge run issues
// still routes through the SAME E0 equipmentRegistry → HITL/dry-run dispatcher.
//
//   • edge_nodes  — the registry of known edge runtimes (status/heartbeat/scope).
//   • orchestration_runs.edgeNodeId — added by migration 0128 (ALTER, nullable);
//     it is declared on the orchestration_runs table in schema/orchestration.ts
//     OR referenced here for typing. We keep the column declaration with the runs
//     table; this module owns ONLY edge_nodes.
// Additive; nothing existing is altered destructively.
// ════════════════════════════════════════════════════════════════════════════
import {
  pgTable, serial, integer, varchar, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { edgeNodeStatusEnum } from "./enums";

/** A registered edge control runtime (one per line/cell/edge host). */
export const edgeNodes = pgTable("edge_nodes", {
  id: serial("id").primaryKey(),
  /** Stable code/ref (unique) — the identity an edge host authenticates/reports as. */
  code: varchar("code", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  /** Which factory this edge node serves (denormalised for quick filtering). */
  factoryCode: varchar("factoryCode", { length: 128 }),
  /** online (recent heartbeat) | offline (stale) | degraded (self-reported). */
  status: edgeNodeStatusEnum("status").default("offline").notNull(),
  /** Last heartbeat received from the node (drives the stale→offline checker). */
  lastHeartbeatAt: timestamp("lastHeartbeatAt"),
  /** Line codes this node is responsible for (advisory; assignment is per-run). */
  assignedLineCodes: jsonb("assignedLineCodes").$type<string[]>(),
  /** Reported runtime version (for fleet visibility / compatibility checks). */
  version: varchar("version", { length: 64 }),
  /** Last self-reported health detail (queue depth, buffered count, etc.). */
  healthJson: jsonb("healthJson").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_edge_nodes_status").on(table.status),
  index("idx_edge_nodes_factory").on(table.factoryCode),
  index("idx_edge_nodes_heartbeat").on(table.lastHeartbeatAt),
]);

export type EdgeNode = typeof edgeNodes.$inferSelect;
export type InsertEdgeNode = typeof edgeNodes.$inferInsert;
