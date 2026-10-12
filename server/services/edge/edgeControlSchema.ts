/**
 * doc 81 Đợt 10 task A (mig 0372–0375) — NARROW drizzle projections of the edge-control tables and of the NEW columns on
 * existing tables. Kept OUT of drizzle/schema on purpose (0368 lesson, design §3): a new column on robots / device_adapters /
 * edge_nodes / robot_motion_locks in the FULL drizzle objects would break every `select().from(robots)` on a DB where the
 * migration is missing. Here a missing 0372–0375 only ever surfaces where these projections are used (isEdgeControlSchemaMissing
 * ⇒ the v2 node routes answer 503 edge_unavailable; central paths are unchanged).
 *
 * Write rules enforced by the DB (see the migrations): write-once identities (IS DISTINCT FROM), one result per jti, cursors
 * start at 0 and never decrease, key status next → active → retired, ownership change refused while a ledger row is in flight
 * (and logged WORM in device_owner_changes with the actor of setEdgeOwnershipActor), 'edge:N' lock rows only for robots N
 * owns, lock requests only for owned devices, maker ≠ checker on trust approvals.
 */
import { sql } from "drizzle-orm";
import { bigint, integer, jsonb, pgTable, serial, smallint, text, timestamp, uuid, varchar, bigserial } from "drizzle-orm/pg-core";

/** The migration files of this đợt, in their safe order. */
export const EDGE_CONTROL_MIGRATIONS = Object.freeze([
  "0372_edge_step_authorizations.sql",
  "0373_edge_report_streams_and_keys.sql",
  "0374_edge_device_ownership_and_lock_authority.sql",
  "0375_edge_robot_trust_approvals.sql",
] as const);

// ── 0372 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const edgeStepAuthorizations = pgTable("edge_step_authorizations", {
  jti: uuid("jti").primaryKey(),
  edgeNodeId: integer("edgeNodeId").notNull(),
  credentialId: integer("credentialId").notNull(),
  runId: integer("runId").notNull(),
  claimSeq: integer("claimSeq").notNull(),
  stepId: varchar("stepId", { length: 128 }).notNull(),
  attempt: integer("attempt").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
  kind: varchar("kind", { length: 8 }).$type<"ot" | "robot">().notNull(),
  payloadHash: varchar("payloadHash", { length: 71 }).notNull(),
  approvalJson: jsonb("approvalJson").$type<Record<string, unknown> | null>(),
  verdictJson: jsonb("verdictJson").$type<Record<string, unknown>>().notNull(),
  kid: varchar("kid", { length: 64 }).notNull(),
  reqNonceHash: varchar("reqNonceHash", { length: 64 }).notNull(),
  issuedAt: timestamp("issuedAt", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  resultReportedAt: timestamp("resultReportedAt", { withTimezone: true }),
  resultStatus: varchar("resultStatus", { length: 32 }),
  supersededAt: timestamp("supersededAt", { withTimezone: true }),
});
export type EdgeStepAuthorizationRow = typeof edgeStepAuthorizations.$inferSelect;

// ── 0373 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const edgeNodeReportCursors = pgTable("edge_node_report_cursors", {
  edgeNodeId: integer("edgeNodeId").notNull(),
  stream: varchar("stream", { length: 40 }).notNull(),
  epoch: varchar("epoch", { length: 32 }).notNull(),
  lastSeq: bigint("lastSeq", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});
export type EdgeNodeReportCursorRow = typeof edgeNodeReportCursors.$inferSelect;

export const edgeNodeProgramReports = pgTable("edge_node_program_reports", {
  edgeNodeId: integer("edgeNodeId").notNull(),
  adapterId: integer("adapterId").notNull(),
  status: varchar("status", { length: 16 }).$type<"verified" | "unsupported" | "unreadable">().notNull(),
  checksum: varchar("checksum", { length: 256 }),
  reason: varchar("reason", { length: 32 }),
  readAt: timestamp("readAt", { withTimezone: true }).notNull(),
  receivedAt: timestamp("receivedAt", { withTimezone: true }).defaultNow().notNull(),
});
export type EdgeNodeProgramReportRow = typeof edgeNodeProgramReports.$inferSelect;

export const edgeAuthSigningKeys = pgTable("edge_auth_signing_keys", {
  kid: varchar("kid", { length: 64 }).primaryKey(),
  publicKeyPem: text("publicKeyPem").notNull(),
  status: varchar("status", { length: 16 }).$type<"next" | "active" | "retired">().notNull(),
  notBefore: timestamp("notBefore", { withTimezone: true }).defaultNow().notNull(),
  retiredAt: timestamp("retiredAt", { withTimezone: true }),
  createdBy: varchar("createdBy", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  endorsedByKid: varchar("endorsedByKid", { length: 64 }),
  endorsementSig: varchar("endorsementSig", { length: 86 }),
});
export type EdgeAuthSigningKeyRow = typeof edgeAuthSigningKeys.$inferSelect;

/** edge_nodes."protocolVersion" (1 = Đợt 9 DB-backed edge, 2 = this protocol). */
export const edgeNodeProtocol = pgTable("edge_nodes", {
  id: integer("id").primaryKey(),
  protocolVersion: smallint("protocolVersion").notNull(),
});

// ── 0374 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** robots ownership columns only (NULL edgeNodeId = central). */
export const robotOwnership = pgTable("robots", {
  id: integer("id").primaryKey(),
  edgeNodeId: integer("edgeNodeId"),
  motionLockGenerationFloor: integer("motionLockGenerationFloor").notNull(),
});
/** device_adapters ownership column only (NULL = central). */
export const adapterOwnership = pgTable("device_adapters", {
  id: integer("id").primaryKey(),
  edgeNodeId: integer("edgeNodeId"),
});
/** robot_motion_locks with the 0374 authority ('central' | 'edge:<id>' — edgeProtocol.edgeLockAuthority). */
export const robotMotionLockAuthority = pgTable("robot_motion_locks", {
  robotId: integer("robotId").primaryKey(),
  reasonCode: varchar("reasonCode", { length: 64 }).notNull(),
  detail: text("detail"),
  generation: integer("generation").notNull(),
  lockedAt: timestamp("lockedAt").defaultNow().notNull(),
  authority: varchar("authority", { length: 40 }).notNull().default("central"),
});
export const robotMotionLockRequests = pgTable("robot_motion_lock_requests", {
  id: serial("id").primaryKey(),
  robotId: integer("robotId"),
  adapterId: integer("adapterId"),
  edgeNodeId: integer("edgeNodeId").notNull(),
  kind: varchar("kind", { length: 8 }).$type<"lock" | "clear" | "stop">().notNull(),
  expectedGeneration: integer("expectedGeneration"),
  reason: text("reason"),
  requestedBy: integer("requestedBy").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  deliveredAt: timestamp("deliveredAt", { withTimezone: true }),
  ackedAt: timestamp("ackedAt", { withTimezone: true }),
  ackGeneration: integer("ackGeneration"),
  outcome: varchar("outcome", { length: 16 }).$type<"done" | "refused" | "failed" | "expired">(),
});
export type RobotMotionLockRequestRow = typeof robotMotionLockRequests.$inferSelect;
/** WORM — written only by the owner-change triggers; read-only for the app. */
export const deviceOwnerChanges = pgTable("device_owner_changes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  deviceKind: varchar("deviceKind", { length: 8 }).$type<"robot" | "adapter">().notNull(),
  deviceId: integer("deviceId").notNull(),
  fromEdgeNodeId: integer("fromEdgeNodeId"),
  toEdgeNodeId: integer("toEdgeNodeId"),
  generationFloor: integer("generationFloor"),
  changedBy: varchar("changedBy", { length: 128 }).notNull(),
  changedAt: timestamp("changedAt", { withTimezone: true }).defaultNow().notNull(),
});

// ── 0375 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const edgeRobotTrustApprovals = pgTable("edge_robot_trust_approvals", {
  edgeNodeId: integer("edgeNodeId").notNull(),
  robotId: integer("robotId").notNull(),
  digest: varchar("digest", { length: 64 }).notNull(),
  editedBy: integer("editedBy").notNull(),
  editedAt: timestamp("editedAt", { withTimezone: true }).defaultNow().notNull(),
  approvedBy: integer("approvedBy"),
  approvedAt: timestamp("approvedAt", { withTimezone: true }),
});
export type EdgeRobotTrustApprovalRow = typeof edgeRobotTrustApprovals.$inferSelect;

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** 42P01 undefined_table / 42703 undefined_column — a migration of 0372–0375 is not applied (code on err or err.cause). */
export function isEdgeControlSchemaMissing(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = e?.code ?? e?.cause?.code;
  return c === "42P01" || c === "42703";
}

/** 23514 check_violation — a write refused by a 0372–0375 trigger / CHECK (the caller maps it to its own refusal). */
export function isEdgeControlRefusal(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return (e?.code ?? e?.cause?.code) === "23514";
}

/**
 * Name the actor of an ownership change for the WORM history (device_owner_changes.changedBy) — inside the SAME
 * transaction as the UPDATE (SET LOCAL semantics). Without it the DB user name is recorded.
 */
export async function setEdgeOwnershipActor(tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, actor: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('avi.actor', ${String(actor).slice(0, 128)}, true)`);
}
