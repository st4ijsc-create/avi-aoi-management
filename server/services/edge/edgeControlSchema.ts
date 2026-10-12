/**
 * doc 81 Đợt 10 task A (mig 0372–0375) — NARROW drizzle projections of the edge-control tables and of the NEW columns on
 * existing tables. Kept OUT of drizzle/schema on purpose (0368 lesson, design §3): a new column on robots / device_adapters /
 * edge_nodes / robot_motion_locks in the FULL drizzle objects would break every `select().from(robots)` on a DB where the
 * migration is missing. Here a missing 0372–0375 only ever surfaces where these projections are used (isEdgeControlSchemaMissing
 * ⇒ the v2 node routes answer 503 edge_unavailable; central paths are unchanged).
 *
 * Write rules enforced by the DB (see the migrations): write-once identities (IS DISTINCT FROM), one result per jti, cursors
 * start at 0 and never decrease, key status next → active → retired, ownership change refused while a ledger row is in flight
 * (and logged WORM in device_owner_changes with the actor of setEdgeOwnershipActor), maker ≠ checker on trust approvals.
 * R-10-b OWNER EPOCH: robots / device_adapters."ownerEpoch" is bumped by every ownership change (never otherwise); an
 * ownership change LOCKS the robot under the new authority + epoch ('ownerChanged'); 'edge:N' lock rows, lock requests,
 * program reports and trust approvals are bound to (device, owner, ownerEpoch) — match ALL of them when applying or clearing
 * (edgeLockRowMatch); a stale epoch is refused (23514) or matches nothing. Edge lock rows are written ONLY through
 * applyEdgeMotionLock / clearEdgeMotionLock, trust approvals ONLY through request / approve / revokeEdgeRobotTrust (fix scan 2).
 * edge_auth_signing_keys is a MIRROR of the central key files (R-10-c) — never read for trust.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { bigint, bigserial, boolean, integer, jsonb, pgTable, serial, smallint, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

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
/**
 * fix review 4 (R-10-ag) — the contentHash of EVERY accepted stream record (mig 0373). Insert one row per applied record in the
 * same transaction as the cursor advance; a record with seq ≤ cursor is a duplicate ONLY if its hash equals the stored one,
 * otherwise a conflict (anomaly + refuse). Write-once: avi_app SELECT / INSERT only; an UPDATE is refused for every writer.
 * contentHash = sha256 hex (64 lower-case chars) of the record's canonical JSON; the row's cursor must exist (FK); seq ≥ 1.
 */
export const edgeNodeReportRecords = pgTable("edge_node_report_records", {
  edgeNodeId: integer("edgeNodeId").notNull(),
  stream: varchar("stream", { length: 40 }).notNull(),
  epoch: varchar("epoch", { length: 32 }).notNull(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  contentHash: varchar("contentHash", { length: 64 }).notNull(),
  receivedAt: timestamp("receivedAt", { withTimezone: true }).defaultNow().notNull(),
});
export type EdgeNodeReportRecordRow = typeof edgeNodeReportRecords.$inferSelect;

export const edgeNodeProgramReports = pgTable("edge_node_program_reports", {
  edgeNodeId: integer("edgeNodeId").notNull(),
  adapterId: integer("adapterId").notNull(),
  status: varchar("status", { length: 16 }).$type<"verified" | "unsupported" | "unreadable">().notNull(),
  checksum: varchar("checksum", { length: 256 }),
  reason: varchar("reason", { length: 32 }),
  readAt: timestamp("readAt", { withTimezone: true }).notNull(),
  receivedAt: timestamp("receivedAt", { withTimezone: true }).defaultNow().notNull(),
  /** 0374 — the adapter's owner epoch at write time (stamped by the trigger); a reading of another epoch is stale */
  ownerEpoch: bigint("ownerEpoch", { mode: "number" }),
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
  /** R-10-b — bumped by every ownership change (trigger); never written by the app */
  ownerEpoch: bigint("ownerEpoch", { mode: "number" }).notNull(),
});
/** device_adapters ownership column only (NULL = central). */
export const adapterOwnership = pgTable("device_adapters", {
  id: integer("id").primaryKey(),
  edgeNodeId: integer("edgeNodeId"),
  ownerEpoch: bigint("ownerEpoch", { mode: "number" }).notNull(),
});
/** robot_motion_locks with the 0374 authority ('central' | 'edge:<id>' — edgeProtocol.edgeLockAuthority). */
export const robotMotionLockAuthority = pgTable("robot_motion_locks", {
  robotId: integer("robotId").primaryKey(),
  reasonCode: varchar("reasonCode", { length: 64 }).notNull(),
  detail: text("detail"),
  generation: integer("generation").notNull(),
  lockedAt: timestamp("lockedAt").defaultNow().notNull(),
  authority: varchar("authority", { length: 40 }).notNull().default("central"),
  /** NULL for 'central'; the node of 'edge:<id>' (FK edge_nodes ON DELETE RESTRICT) */
  authorityNodeId: integer("authorityNodeId"),
  /** the robot's owner epoch the row was written under (a central row is stamped by the trigger) */
  ownerEpoch: bigint("ownerEpoch", { mode: "number" }),
  /**
   * fix review 5 (R-10-ap) — the WRITER INSTANCE of the row (mig 0374): REQUIRED on every new row (trigger 23514); write-once —
   * another writer takes the row over only with generation ≥ old + 1; never cleared. Legacy rows may be NULL. DB writers use
   * md5('relock:<robot>:<epoch>') (owner-change relock) and md5('edge:<node>') (edge authority) as uuid.
   */
  writerInstanceId: uuid("writerInstanceId"),
});
export const robotMotionLockRequests = pgTable("robot_motion_lock_requests", {
  id: serial("id").primaryKey(),
  robotId: integer("robotId"),
  adapterId: integer("adapterId"),
  edgeNodeId: integer("edgeNodeId").notNull(),
  /** the device's owner epoch at request time — delivered only while it still holds */
  ownerEpoch: bigint("ownerEpoch", { mode: "number" }).notNull(),
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
  /** fix review 2 (R-10-i) — the user who acked a STOP central executed (edge_stop_ack_central only); written with the ack */
  ackedBy: integer("ackedBy"),
  /** fix review 2 (second scan) — the request this STOP was carried to on an owner change (carry only); NULL = chain head */
  carriedToId: integer("carriedToId"),
  /** fix review 3 — the node acked this STOP over the unsigned-STOP channel (R-10-k / R-10-o) */
  ackViaUnsigned: boolean("ackViaUnsigned"),
  /** fix review 3 — resolution of a refused / failed STOP (edge_stop_resolve only), written once */
  resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
  resolvedBy: integer("resolvedBy"),
  resolution: text("resolution"),
});
/**
 * fix review 2 (R-10-i, L-7) — VIEW device_pending_stops (SELECT only): every STOP request nobody acknowledged, with the
 * device's CURRENT owner. centralMustExecute ⇒ the device is central-owned now: central executes the STOP and acks it with
 * ackCentralStop. overdue ⇒ past expiresAt and still pending (raise an alert; a STOP never expires). stale ⇒ the request's
 * (node, epoch) is no longer the device's. One row per chain HEAD (a STOP carried on to a new owner is listed as its carry).
 * undeliverable ⇒ edge-owned, but the request's node has no active credential (it never pulls) — raise it to a person.
 */
export const devicePendingStops = pgTable("device_pending_stops", {
  requestId: integer("requestId").notNull(),
  robotId: integer("robotId"),
  adapterId: integer("adapterId"),
  requestEdgeNodeId: integer("requestEdgeNodeId").notNull(),
  requestOwnerEpoch: bigint("requestOwnerEpoch", { mode: "number" }).notNull(),
  currentEdgeNodeId: integer("currentEdgeNodeId"),
  currentOwnerEpoch: bigint("currentOwnerEpoch", { mode: "number" }),
  requestedBy: integer("requestedBy").notNull(),
  reason: text("reason"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  deliveredAt: timestamp("deliveredAt", { withTimezone: true }),
  overdue: boolean("overdue").notNull(),
  centralMustExecute: boolean("centralMustExecute").notNull(),
  stale: boolean("stale").notNull(),
  /** edge-owned device, but the request's node has no ACTIVE credential — it can never pull this STOP: central must act */
  undeliverable: boolean("undeliverable").notNull(),
  requestNodeStatus: text("requestNodeStatus"),
  requestNodeLastHeartbeatAt: timestamp("requestNodeLastHeartbeatAt"),
  /** fix review 3 (R-10-aa N2) — refused / failed STOPs stay listed until resolved (edge_stop_resolve) */
  outcome: varchar("outcome", { length: 16 }).$type<"refused" | "failed">(),
  needsResolution: boolean("needsResolution").notNull(),
});
export type DevicePendingStopRow = typeof devicePendingStops.$inferSelect;
export type RobotMotionLockRequestRow = typeof robotMotionLockRequests.$inferSelect;
/** WORM — written only by the owner-change triggers; read-only for the app. */
export const deviceOwnerChanges = pgTable("device_owner_changes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  deviceKind: varchar("deviceKind", { length: 8 }).$type<"robot" | "adapter">().notNull(),
  deviceId: integer("deviceId").notNull(),
  fromEdgeNodeId: integer("fromEdgeNodeId"),
  toEdgeNodeId: integer("toEdgeNodeId"),
  generationFloor: integer("generationFloor"),
  fromOwnerEpoch: bigint("fromOwnerEpoch", { mode: "number" }),
  toOwnerEpoch: bigint("toOwnerEpoch", { mode: "number" }),
  changedBy: varchar("changedBy", { length: 128 }).notNull(),
  changedAt: timestamp("changedAt", { withTimezone: true }).defaultNow().notNull(),
});

// ── 0375 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const edgeRobotTrustApprovals = pgTable("edge_robot_trust_approvals", {
  edgeNodeId: integer("edgeNodeId").notNull(),
  robotId: integer("robotId").notNull(),
  digest: varchar("digest", { length: 64 }).notNull(),
  /** R-10-b — approved only for this owner epoch of the robot; another epoch ⇒ NOT approved */
  ownerEpoch: bigint("ownerEpoch", { mode: "number" }).notNull(),
  editedBy: integer("editedBy").notNull(),
  editedAt: timestamp("editedAt", { withTimezone: true }).defaultNow().notNull(),
  /** every user who requested / edited since the approval in force (the approver is never one of them) */
  editorsSinceApproval: integer("editorsSinceApproval").array().notNull(),
  approvedBy: integer("approvedBy"),
  approvedAt: timestamp("approvedAt", { withTimezone: true }),
  approvedDigest: varchar("approvedDigest", { length: 64 }),
  approvedOwnerEpoch: bigint("approvedOwnerEpoch", { mode: "number" }),
});
export type EdgeRobotTrustApprovalRow = typeof edgeRobotTrustApprovals.$inferSelect;

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 42P01 undefined_table / 42703 undefined_column / 42883 undefined_function (fix review 1, I6: the guarded functions of 0374 /
 * 0375 are absent) — a migration of 0372–0375 is not applied (code on err or err.cause) ⇒ the route answers 503 edge_unavailable.
 */
export function isEdgeControlSchemaMissing(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = e?.code ?? e?.cause?.code;
  return c === "42P01" || c === "42703" || c === "42883";
}

/**
 * R-10-b — the ONE match of a mirrored lock row of an edge authority: (robotId, authority 'edge:<nodeId>', authorityNodeId,
 * ownerEpoch). Use it for every apply (UPDATE … WHERE) and clear (DELETE … WHERE) of an edge lock event, so an event from a
 * previous ownership (or a reused node id) matches nothing.
 */
export function edgeLockRowMatch(robotId: number, nodeId: number, ownerEpoch: number): SQL {
  return and(
    eq(robotMotionLockAuthority.robotId, robotId),
    eq(robotMotionLockAuthority.authority, `edge:${nodeId}`),
    eq(robotMotionLockAuthority.authorityNodeId, nodeId),
    eq(robotMotionLockAuthority.ownerEpoch, ownerEpoch),
  ) as SQL;
}

type Exec = { execute: (q: SQL) => Promise<unknown> };
const firstRow = (r: unknown): Record<string, unknown> | undefined => (Array.isArray(r) ? r[0] : (r as { rows?: unknown[] })?.rows?.[0]) as Record<string, unknown> | undefined;

/**
 * fix scan 2 (safety-lock bypass) — THE only way the app writes an EDGE-authority lock row (avi_app cannot UPDATE / DELETE /
 * INSERT one directly): an edge `locked` event ⇒ upsert under (robot, 'edge:<node>', ownerEpoch) where the stored generation ≤ g.
 * true = applied; false = a newer / other-authority row stands. A stale (node, epoch) throws 23514 (isEdgeControlRefusal).
 */
export async function applyEdgeMotionLock(tx: Exec, a: { robotId: number; nodeId: number; ownerEpoch: number; generation: number; reasonCode: string; detail?: string | null }): Promise<boolean> {
  const r = await tx.execute(sql`SELECT public.edge_motion_lock_apply(${a.robotId}, ${a.nodeId}, ${a.ownerEpoch}::bigint, ${a.generation}, ${a.reasonCode}, ${a.detail ?? null}) AS ok`);
  return firstRow(r)?.ok === true;
}
/** An edge `cleared` event ⇒ delete only (robot, 'edge:<node>', node, ownerEpoch) with generation ≤ g while still owned. Rows removed. */
export async function clearEdgeMotionLock(tx: Exec, a: { robotId: number; nodeId: number; ownerEpoch: number; generation: number }): Promise<number> {
  const r = await tx.execute(sql`SELECT public.edge_motion_lock_clear(${a.robotId}, ${a.nodeId}, ${a.ownerEpoch}::bigint, ${a.generation}) AS n`);
  return Number(firstRow(r)?.n ?? 0);
}

/**
 * fix review 2 (R-10-i) — THE way central acknowledges a STOP it executed itself (a device now CENTRAL-owned): only a pending
 * STOP, outcome done | failed, a real actor (> 0). Refused (23514) for an edge-owned device, a lock / clear, an acked request.
 */
export async function ackCentralStop(tx: Exec, a: { requestId: number; outcome: "done" | "failed"; actorUserId: number }): Promise<void> {
  await tx.execute(sql`SELECT public.edge_stop_ack_central(${a.requestId}, ${a.outcome}, ${a.actorUserId})`);
}

/**
 * fix review 3 (R-10-aa N2, R-10-o) — THE way a node's STOP ack is recorded (B's ackEdgeCommand, for every STOP — signed or over
 * the unsigned-STOP channel). true = recorded; false = not a pending STOP of THIS node with exactly this target (robot XOR adapter)
 * and owner epoch — nothing changed, the request stays pending (record an anomaly). outcome expired / bad arguments ⇒ 23514.
 * A direct UPDATE of a STOP's ack columns is refused (23514).
 */
export async function ackEdgeStop(
  tx: Exec,
  a: { requestId: number; nodeId: number; robotId: number | null; adapterId: number | null; ownerEpoch: number; outcome: "done" | "refused" | "failed"; unsigned: boolean; generation?: number | null },
): Promise<boolean> {
  const r = await tx.execute(
    sql`SELECT public.edge_stop_ack_edge(${a.requestId}, ${a.nodeId}, ${a.robotId}::integer, ${a.adapterId}::integer, ${a.ownerEpoch}::bigint, ${a.outcome}, ${a.unsigned}, ${a.generation ?? null}::integer) AS ok`,
  );
  return firstRow(r)?.ok === true;
}
/** fix review 3 (R-10-aa N2) — a person records how a refused / failed STOP was resolved (active user, ≥ 3 chars); then it leaves device_pending_stops. */
export async function resolveStop(tx: Exec, a: { requestId: number; actorUserId: number; resolution: string }): Promise<void> {
  await tx.execute(sql`SELECT public.edge_stop_resolve(${a.requestId}, ${a.actorUserId}, ${a.resolution})`);
}

/** fix scan 2 (maker-checker, R-8-a) — the guarded path of edge_robot_trust_approvals (avi_app has SELECT only on the table). */
export async function requestEdgeRobotTrust(tx: Exec, a: { nodeId: number; robotId: number; digest: string; editorUserId: number }): Promise<void> {
  await tx.execute(sql`SELECT public.edge_robot_trust_request(${a.nodeId}, ${a.robotId}, ${a.digest}, ${a.editorUserId})`);
}
/** Approve the digest the approver SAW; refused (23514) for an editor since the last approval, a non-admin, a stale epoch / digest. */
export async function approveEdgeRobotTrust(tx: Exec, a: { nodeId: number; robotId: number; digest: string; approverUserId: number }): Promise<void> {
  await tx.execute(sql`SELECT public.edge_robot_trust_approve(${a.nodeId}, ${a.robotId}, ${a.digest}, ${a.approverUserId})`);
}
export async function revokeEdgeRobotTrust(tx: Exec, a: { nodeId: number; robotId: number; actorUserId: number }): Promise<void> {
  await tx.execute(sql`SELECT public.edge_robot_trust_revoke(${a.nodeId}, ${a.robotId}, ${a.actorUserId})`);
}
/** THE trust predicate (D6): approved, for this digest, for the robot's CURRENT owner and owner epoch. */
export async function isEdgeRobotTrustApproved(tx: Exec, a: { nodeId: number; robotId: number; digest: string }): Promise<boolean> {
  const r = await tx.execute(sql`SELECT public.edge_robot_trust_is_approved(${a.nodeId}, ${a.robotId}, ${a.digest}) AS ok`);
  return firstRow(r)?.ok === true;
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
