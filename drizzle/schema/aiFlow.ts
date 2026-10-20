/**
 * ★★ AI Local Đợt 8.0 (2026-10-20) — LUỒNG AI, migration `0401`. Spec §4.3–4.4.
 * ⚠ CHECK ở `drizzle/0401_ai_flows.sql`. Thời điểm hàng đợi/lease/lượt chạy là `timestamptz` (so với now()).
 */
import { pgTable, varchar, integer, boolean, jsonb, uuid, bigserial, smallint, timestamp, primaryKey, unique, index } from "drizzle-orm/pg-core";
import { users } from "./auth";

const tz = (ten: string) => timestamp(ten, { withTimezone: true });

export const aiFlows = pgTable("ai_flows", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }),
  name: varchar("name", { length: 200 }).notNull(),
  activeVersion: integer("activeVersion"),
  ownerId: integer("ownerId").references(() => users.id, { onDelete: "set null" }),
  /** `thuan` | `doc` | `ngoai-ghi` | `ot` */
  riskClass: varchar("riskClass", { length: 12 }).notNull().default("thuan"),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: tz("createdAt").defaultNow().notNull(),
  updatedAt: tz("updatedAt").defaultNow().notNull(),
});

export const aiFlowVersions = pgTable(
  "ai_flow_versions",
  {
    flowId: varchar("flowId", { length: 64 }).notNull().references(() => aiFlows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").notNull(),
    riskClass: varchar("riskClass", { length: 12 }).notNull(),
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    approvedBy: integer("approvedBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: tz("createdAt").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.flowId, t.version] })],
);

export const aiFlowRuns = pgTable(
  "ai_flow_runs",
  {
    id: uuid("id").primaryKey(),
    flowId: varchar("flowId", { length: 64 }).notNull(),
    version: integer("version").notNull(),
    triggerKind: varchar("triggerKind", { length: 24 }).notNull(),
    /** `dang-chay` | `cho-duyet` | `xong` | `loi` | `huy` */
    status: varchar("status", { length: 16 }).notNull().default("dang-chay"),
    uuTien: varchar("uuTien", { length: 12 }).notNull().default("background"),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).unique(),
    parentRunId: uuid("parentRunId"),
    retryOf: uuid("retryOf"),
    error: jsonb("error"),
    startedAt: tz("startedAt").defaultNow().notNull(),
    finishedAt: tz("finishedAt"),
  },
  (t) => [index("ai_flow_runs_flow_idx").on(t.flowId, t.startedAt)],
);

export const aiFlowSteps = pgTable(
  "ai_flow_steps",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("runId").notNull().references(() => aiFlowRuns.id, { onDelete: "cascade" }),
    nodeId: varchar("nodeId", { length: 64 }).notNull(),
    lan: integer("lan").notNull(),
    lanThu: integer("lanThu").notNull().default(1),
    /** `dang-chay` | `xong` | `loi` | `khong-ro` | `bo-qua` */
    status: varchar("status", { length: 12 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 200 }).notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    error: jsonb("error"),
    startedAt: tz("startedAt").defaultNow().notNull(),
    finishedAt: tz("finishedAt"),
  },
  (t) => [unique().on(t.runId, t.nodeId, t.lan, t.lanThu)],
);

export const aiFlowEvents = pgTable("ai_flow_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("runId").notNull().references(() => aiFlowRuns.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  payload: jsonb("payload"),
  at: tz("at").defaultNow().notNull(),
});

export const aiFlowQueue = pgTable("ai_flow_queue", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("runId").notNull().references(() => aiFlowRuns.id, { onDelete: "cascade" }),
  nodeId: varchar("nodeId", { length: 64 }).notNull(),
  lan: integer("lan").notNull(),
  inputs: jsonb("inputs").notNull().default({}),
  uuTien: smallint("uuTien").notNull().default(2),
  availableAt: tz("availableAt").defaultNow().notNull(),
  leaseOwner: varchar("leaseOwner", { length: 64 }),
  leaseUntil: tz("leaseUntil"),
  attempts: integer("attempts").notNull().default(0),
});

export const aiFlowInbox = pgTable(
  "ai_flow_inbox",
  {
    runId: uuid("runId").notNull().references(() => aiFlowRuns.id, { onDelete: "cascade" }),
    nodeId: varchar("nodeId", { length: 64 }).notNull(),
    port: varchar("port", { length: 32 }).notNull(),
    items: jsonb("items").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.nodeId, t.port] })],
);

export const aiFlowWaits = pgTable(
  "ai_flow_waits",
  {
    runId: uuid("runId").notNull().references(() => aiFlowRuns.id, { onDelete: "cascade" }),
    nodeId: varchar("nodeId", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }),
    expiresAt: tz("expiresAt"),
    payload: jsonb("payload"),
  },
  (t) => [primaryKey({ columns: [t.runId, t.nodeId] })],
);
