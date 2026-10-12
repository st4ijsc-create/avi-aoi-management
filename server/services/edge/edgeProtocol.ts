/**
 * doc 81 Đợt 10 task A (design §2.3–2.5, §2.8, §2.11) — THE node protocol v2 contract between central and an edge gateway
 * that has NO database login. Groups B (central endpoints), C (edge run store), D (edge dispatch / verifier) and E (edge
 * runtime / client) code against these types; nothing else defines a body or answer shape of `/api/v1/edge/node/*`.
 *
 * RULES (fail-closed):
 *   • every schema is STRICT — an unknown key anywhere is a 400 (z.strictObject), never silently dropped;
 *   • no TRUST field exists in any body: an edge can never mark an event trusted / safety-critical / give an origin, and can
 *     never name its own node / factory / credential (the identity is the authenticated credential's node — central only);
 *   • open JSON bags exist only where the shape belongs to another module and is covered by a signature or a hash: the
 *     workflow definition (defHash), run params / context, driver connectionOptions, dispatcher results, safety-PLC config;
 *   • signed objects travel as EdgeSignedEnvelope (edgeSigning.ts; payload = canonical JSON TEXT): the edge verifies them
 *     ONLY through the typed verifiers of edgeTrust.ts (its local EdgeTrustStore + the schema below + node / run / claim /
 *     TTL binding) — never with a keyset taken from a message.
 *
 * Signed payloads (typ → schema):   auth → edgeAuthClaimsSchema · config → edgeConfigSnapshotSchema ·
 *   runpkg → edgeRunPackageSchema | edgeSweepPictureSchema (discriminated by `kind`) · cmd → edgeCommandSchema ·
 *   keyset → edgeKeysetSchema (edgeSigning.ts).
 *
 * Streams (journal → central, design §2.6): every report carries (epoch, stream, seq); central keeps one cursor per
 * (node, stream, epoch) — mig 0373 `edge_node_report_cursors`:
 *   • `run:<runId>:<claimSeq>` → POST runs/:id/report  (step / context / abort_stop / ledger records)
 *   • `events`                 → POST locks/events     (lock / stop / refusal / anomaly / command_ack records)
 *   • `robot_state`            → POST robots/state
 *   OT telemetry is NOT a stream: storeForward's natural key (adapterId, tagKey, ts) makes POST telemetry idempotent.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { EDGE_TYP_NAME, edgeCanonicalJson, edgeSignedEnvelopeSchema, type EdgeSignedEnvelope } from "./edgeSigning";

export { edgeSignedEnvelopeSchema, type EdgeSignedEnvelope };

// ── versions, routes, limits ────────────────────────────────────────────────────────────────────────────────────────

export const EDGE_PROTOCOL_VERSION = 2 as const;

/** Paths relative to the /api/v1 router (`:runId` is a positive integer). */
export const EDGE_NODE_ROUTES = Object.freeze({
  config: "/edge/node/config",
  heartbeat: "/edge/node/heartbeat",
  programChecks: "/edge/node/program-checks",
  pull: "/edge/node/pull",
  claim: "/edge/node/runs/:runId/claim",
  progress: "/edge/node/runs/:runId/progress",
  authorize: "/edge/node/runs/:runId/authorize",
  report: "/edge/node/runs/:runId/report",
  complete: "/edge/node/runs/:runId/complete",
  release: "/edge/node/runs/:runId/release",
  interrupted: "/edge/node/runs/:runId/interrupted",
  telemetry: "/edge/node/telemetry",
  robotsState: "/edge/node/robots/state",
  locksEvents: "/edge/node/locks/events",
});
export type EdgeNodeRoute = keyof typeof EDGE_NODE_ROUTES;

/** Authorisation TTL (design §2.13 / D8): default 10 s, bounded to [3 s, 30 s]; measured on the EDGE from its request send. */
export const EDGE_AUTH_TTL_DEFAULT_MS = 10_000;
export const EDGE_AUTH_TTL_MIN_MS = 3_000;
export const EDGE_AUTH_TTL_MAX_MS = 30_000;
export function clampEdgeAuthTtlMs(n: unknown): number {
  const v = typeof n === "number" ? n : Number.parseInt(String(n ?? ""), 10);
  if (!Number.isFinite(v)) return EDGE_AUTH_TTL_DEFAULT_MS;
  return Math.min(EDGE_AUTH_TTL_MAX_MS, Math.max(EDGE_AUTH_TTL_MIN_MS, Math.trunc(v)));
}
export const EDGE_REPORT_BATCH_MAX = 500;
export const EDGE_TELEMETRY_BATCH_MAX = 5_000;
export const EDGE_PULL_COMMANDS_MAX = 100;
/** attempt is at most maxAttempts + 1 centrally; this is only the wire bound. */
export const EDGE_ATTEMPT_MAX = 1_000;

// ── error codes ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every error code a node route may answer, with its HTTP status. */
export const EDGE_ERROR_HTTP = Object.freeze({
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited: 429,
  edge_disabled: 503,
  edge_unavailable: 503,
  /** the node is not on protocol v2 (or a v1 call reached a v2 node) */
  protocol_version: 409,
  claim_conflict: 409,
  /** data: { abortRequested: boolean } */
  claim_stale: 409,
  claim_live: 409,
  definition_changed: 409,
  binding_changed: 409,
  replayed: 409,
  not_finished: 409,
  /** central aborted / a gate rejection claimed the run — the walker sweeps locally */
  stopped: 409,
  /** the run is not running / compensating */
  run_not_active: 409,
  /** stepId is not a command step (or a compensation of one) of the definition, or attempt > maxAttempts + 1 */
  step_invalid: 400,
  /** central's rebuild of the command ≠ the request (audited EDGE_ANOMALY) */
  payload_mismatch: 409,
  /** the target robot / adapter is not owned by the calling node */
  not_owned: 409,
  /** a verified STOP never asks (L-7) */
  stop_needs_no_authorization: 400,
  /** data: { reason } — the FOE_GATE_REQUIRED(<reason>) text */
  gate_required: 409,
  /** data: { gate: EdgeDeviceGate } */
  device_refused: 409,
  /** another nonce already holds the (run, claim, step, attempt) authorisation */
  already_authorized: 409,
  /** data: { expectedSeq } — resend from the cursor */
  gap: 409,
  /** a new epoch must start at seq 1 */
  epoch_rejected: 409,
  /** a non-STOP result without a jti issued for that (run, claim, step, attempt) — audited EDGE_ANOMALY */
  unauthorised_actuation: 409,
} as const);
export type EdgeErrorCode = keyof typeof EDGE_ERROR_HTTP;
export const EDGE_ERROR_CODES = Object.freeze(Object.keys(EDGE_ERROR_HTTP) as EdgeErrorCode[]);

/** Why central's device gate refused a step authorisation (design §2.5 step 7). */
export const EDGE_DEVICE_GATES = [
  "robot_disabled",
  "motion_locked",
  "lock_requested",
  "not_commissioned",
  "field_v2",
  "policy",
  "interlock",
  "adapter_disabled",
  "tag_disabled",
  "tag_not_writable",
] as const;
export type EdgeDeviceGate = (typeof EDGE_DEVICE_GATES)[number];

/** Why an edge segment ended `held` (D5: an offline non-STOP step is held, never failed + compensated). */
export const EDGE_HELD_REASONS = ["centralUnreachable", "journalFull", "keysetUnknown", "configStale"] as const;
export type EdgeHeldReason = (typeof EDGE_HELD_REASONS)[number];

/** The answer shape every central node handler returns (the route maps it to the /api/v1 envelope). */
export interface EdgeAnswer<T = unknown> {
  http: number;
  code?: EdgeErrorCode | string;
  message?: string;
  data?: T;
}
export function edgeError<T = never>(code: EdgeErrorCode, message: string, data?: unknown): EdgeAnswer<T> {
  return { http: EDGE_ERROR_HTTP[code], code, message, ...(data === undefined ? {} : { data: data as T }) };
}

/**
 * Parse a request body with its strict schema. Failure ⇒ 400 bad_request naming the first offending PATH and issue code
 * (never echoing a value — a body may carry a token).
 */
export function parseEdgeBody<S extends z.ZodType>(schema: S, body: unknown): { ok: true; data: z.infer<S> } | { ok: false; answer: EdgeAnswer<never> } {
  const r = schema.safeParse(body ?? {});
  if (r.success) return { ok: true, data: r.data };
  const i = r.error.issues[0];
  const keys = i && "keys" in i && Array.isArray((i as { keys?: unknown }).keys) ? ` ${((i as { keys: string[] }).keys).slice(0, 5).join(",")}` : "";
  const where = i ? `${i.path.join(".") || "(body)"}: ${i.code}${keys}` : "invalid";
  return { ok: false, answer: edgeError("bad_request", `Invalid body — ${where}`) };
}

// ── streams, epochs, lock authority ─────────────────────────────────────────────────────────────────────────────────

export const EDGE_STREAM_EVENTS = "events" as const;
export const EDGE_STREAM_ROBOT_STATE = "robot_state" as const;
/** Same pattern as mig 0373's CHECK on edge_node_report_cursors.stream. */
export const EDGE_STREAM_RE = /^(events|robot_state|run:[1-9][0-9]{0,9}:[1-9][0-9]{0,9})$/;
const RUN_STREAM_RE = /^run:([1-9][0-9]{0,9}):([1-9][0-9]{0,9})$/;
export function edgeRunStream(runId: number, claimSeq: number): string {
  if (!Number.isSafeInteger(runId) || runId <= 0 || !Number.isSafeInteger(claimSeq) || claimSeq <= 0) throw new Error("edgeRunStream: positive integers required");
  return `run:${runId}:${claimSeq}`;
}
export type EdgeStream = { kind: "events" } | { kind: "robot_state" } | { kind: "run"; runId: number; claimSeq: number };
export function parseEdgeStream(s: unknown): EdgeStream | null {
  if (typeof s !== "string" || !EDGE_STREAM_RE.test(s)) return null;
  if (s === EDGE_STREAM_EVENTS) return { kind: "events" };
  if (s === EDGE_STREAM_ROBOT_STATE) return { kind: "robot_state" };
  const m = RUN_STREAM_RE.exec(s)!;
  const runId = Number(m[1]);
  const claimSeq = Number(m[2]);
  if (runId > 2_147_483_647 || claimSeq > 2_147_483_647) return null;
  return { kind: "run", runId, claimSeq };
}
/** 128-bit random journal epoch (32 lowercase hex). */
export const EDGE_EPOCH_RE = /^[0-9a-f]{32}$/;
export function newEdgeEpoch(): string {
  return randomBytes(16).toString("hex");
}

/** robot_motion_locks.authority (mig 0374): 'central' or 'edge:<nodeId>'. */
export const EDGE_LOCK_AUTHORITY_RE = /^(central|edge:[1-9][0-9]{0,9})$/;
export function edgeLockAuthority(nodeId: number | null): string {
  if (nodeId === null) return "central";
  if (!Number.isSafeInteger(nodeId) || nodeId <= 0) throw new Error("edgeLockAuthority: positive node id required");
  return `edge:${nodeId}`;
}

/** sha256 hex of the canonical signed config envelope (heartbeat `configHash`, POST config `configHash`). */
export function edgeConfigHash(envelope: EdgeSignedEnvelope): string {
  return createHash("sha256").update(edgeCanonicalJson(envelope), "utf8").digest("hex");
}

// ── primitives ──────────────────────────────────────────────────────────────────────────────────────────────────────

const zId = z.number().int().positive().max(2_147_483_647);
const zCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const zSeq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const zClaimSeqNext = z.number().int().nonnegative().max(2_147_483_647);
const zClaimSeq = zId;
const zEpochMs = z.number().int().nonnegative().max(8_640_000_000_000_000);
const zHex64 = z.string().regex(/^[0-9a-f]{64}$/);
const zPayloadHash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const zClaimToken = z.string().regex(/^ect_[A-Za-z0-9_-]{43}$/);
const zEpoch = z.string().regex(EDGE_EPOCH_RE);
const zReqNonce = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
const zJti = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const zKid = z.string().regex(/^edk_[A-Za-z0-9_-]{22}$/);
const zStepId = z.string().min(1).max(128);
const zIdemKey = z.string().min(1).max(128);
const zAttempt = z.number().int().positive().max(EDGE_ATTEMPT_MAX);
const zText = (max: number) => z.string().max(max);
const zCode = (max: number) => z.string().min(1).max(max);
/** An open JSON bag (shape owned elsewhere; covered by a signature / hash). */
const zJsonRecord = z.record(z.string(), z.unknown());
const zRunStatus = z.enum(["queued", "running", "held", "awaiting_confirm", "completed", "failed", "aborted", "compensating"]);
const zStepStatus = z.enum(["pending", "running", "awaiting_confirm", "held", "completed", "failed", "skipped", "compensated"]);
const zOtDataType = z.enum(["bool", "int", "float", "string", "json"]);
const zOtProtocol = z.enum(["opcua", "modbus", "s7", "mitsubishi-mc", "ethernet-ip", "stub", "slmp"]);
const zRobotVendor = z.enum(["fanuc", "mitsubishi", "delta", "techman", "sim", "vda5050", "ur"]);
const zRobotKind = z.enum(["arm", "scara", "cobot", "agv"]);
const zRobotJobType = z.enum(["move", "pick_place", "dispense", "screw", "home", "abort", "custom", "weld"]);
const zLockAuthority = z.string().regex(EDGE_LOCK_AUTHORITY_RE);
const zFinite = z.number().finite();

export const edgeRunStreamSchema = z.string().regex(RUN_STREAM_RE);

// ── shared pieces ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One program-checksum reading of an edge-owned adapter (programChecksum.readAdapterProgramCheck, D7). */
export const edgeProgramCheckSchema = z
  .strictObject({
    adapterId: zId,
    status: z.enum(["verified", "unsupported", "unreadable"]),
    checksum: zCode(256).optional(),
    reason: z.enum(["notConnected", "timeout", "error", "invalid", "inconsistent"]).optional(),
    source: zText(32).optional(),
    readAt: zEpochMs,
  })
  .refine((v) => (v.status === "verified") === (v.checksum !== undefined), { message: "checksum present iff verified", path: ["checksum"] })
  .refine((v) => (v.status === "unreadable") === (v.reason !== undefined), { message: "reason present iff unreadable", path: ["reason"] });
export type EdgeProgramCheck = z.infer<typeof edgeProgramCheckSchema>;
const zProgramChecks = z.array(edgeProgramCheckSchema).max(256);

const zSignedList = (max: number) => z.array(edgeSignedEnvelopeSchema).max(max);
const zRobotTarget = z.strictObject({ robotId: zId });
const zAdapterTarget = z.strictObject({ adapterId: zId });
const zClaimRef = { claimSeq: zClaimSeq, claimToken: zClaimToken };

/** The prior-segment picture (foeEngine loadCompletedSteps / priorStepsOf) shipped centrally, never read from a DB. */
export const edgePriorPictureSchema = z.strictObject({
  completed: z.array(zStepId).max(2_000),
  settled: z.array(zStepId).max(2_000),
  attempted: z.array(zStepId).max(2_000),
  startOrder: z.array(zStepId).max(2_000),
  branches: z.array(z.strictObject({ stepId: zStepId, branch: z.enum(["then", "else"]) })).max(2_000),
  /** STOPs an earlier sweep confirmed sent (`abort:<id>` completed) — never sent again */
  abortSentBefore: z.array(zStepId).max(2_000),
  /** the rows could not be read: whether the run acted is unknown ⇒ counted as acted */
  unknown: z.boolean(),
});
export type EdgePriorPicture = z.infer<typeof edgePriorPictureSchema>;

const zMachine = z.strictObject({ id: zId, machineType: zCode(64), capabilities: z.unknown() });

/** A verified STOP (makeStopVerifier result, resolved centrally): robot abort, or a PINNED OT stop with its pins. */
export const edgeVerifiedStopSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("robot"), stepId: zStepId, robotId: zId }),
  z.strictObject({ kind: z.literal("ot"), stepId: zStepId, adapterId: zId, pins: z.array(z.strictObject({ tagKey: zCode(128), value: z.unknown() })).min(1).max(64) }),
]);
export type EdgeVerifiedStop = z.infer<typeof edgeVerifiedStopSchema>;

// ── signed: per-step authorisation (typ auth, design §2.5) ──────────────────────────────────────────────────────────

const authBase = {
  typ: z.literal(EDGE_TYP_NAME.auth),
  kid: zKid,
  jti: zJti,
  nodeId: zId,
  credentialId: zId,
  runId: zId,
  claimSeq: zClaimSeq,
  stepId: zStepId,
  attempt: zAttempt,
  idempotencyKey: zIdemKey,
  payloadHash: zPayloadHash,
  approval: z.strictObject({ approvedBy: zId, gateStepId: zStepId.nullable() }).nullable(),
  /** central's ROBOT_/OT_CONTROL_ENABLED — the edge applies the stricter of this and its own env (central kill switch) */
  mode: z.enum(["real", "simulated"]),
  verdicts: z.strictObject({ commissioned: z.boolean(), policy: zCode(32), interlock: zCode(32) }),
  safetyConfigIds: z.array(zId).max(64),
  reqNonce: zReqNonce,
  /** central wall clock, informational — the edge measures the TTL from its own request send (monotonic) */
  iat: zEpochMs,
  ttlMs: z.number().int().min(EDGE_AUTH_TTL_MIN_MS).max(EDGE_AUTH_TTL_MAX_MS),
};
export const edgeOtAuthWriteSchema = z.strictObject({
  tagKey: zCode(128),
  address: zCode(255),
  dataType: zOtDataType,
  scale: zFinite.nullable(),
  offset: zFinite.nullable(),
});
export const edgeAuthClaimsSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...authBase, kind: z.literal("ot"), target: z.strictObject({ adapterId: zId, writes: z.array(edgeOtAuthWriteSchema).min(1).max(64) }) }),
  z.strictObject({ ...authBase, kind: z.literal("robot"), target: z.strictObject({ robotId: zId, jobType: zRobotJobType }) }),
]);
export type EdgeAuthClaims = z.infer<typeof edgeAuthClaimsSchema>;

// ── signed: central → edge commands (typ cmd, design §2.8 / §2.11) ─────────────────────────────────────────────────

const cmdBase = {
  /** robot_motion_lock_requests.id (mig 0374) */
  requestId: zId,
  nodeId: zId,
  /** fix review 1 (I4) — the node credential the command is for (edgeTrust.verifyEdgeCommand binds it) */
  credentialId: zId,
  /** R-10-b — the target device's owner epoch the request was made for (mismatch with the config ⇒ not applied, except STOP) */
  ownerEpoch: zId,
  issuedAt: zEpochMs,
  /** a `clear` past expiresAt is refused; a `stop` is sent anyway (L-7) */
  expiresAt: zEpochMs,
};
export const edgeCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...cmdBase, kind: z.literal("stop"), target: z.union([zRobotTarget, zAdapterTarget]) }),
  z.strictObject({ ...cmdBase, kind: z.literal("lock"), robotId: zId, reason: zText(300) }),
  z.strictObject({ ...cmdBase, kind: z.literal("clear"), robotId: zId, expectedGeneration: zId, clearedBy: zId, reason: zText(300) }),
]);
export type EdgeCommand = z.infer<typeof edgeCommandSchema>;

// ── signed: config snapshot (typ config, design §2.4) ───────────────────────────────────────────────────────────────

export const edgeConfigTagSchema = z.strictObject({
  id: zId,
  tagKey: zCode(128),
  address: zCode(255),
  dataType: zOtDataType,
  scale: zFinite.nullable(),
  offset: zFinite.nullable(),
  writable: z.boolean(),
  isEnabled: z.boolean(),
  /** the STOP pin (mig 0362); null = not a stop tag */
  stopValue: z.unknown(),
  updatedAt: zEpochMs,
});
export const edgeConfigAdapterSchema = z.strictObject({
  id: zId,
  code: zCode(64),
  machineId: zId.nullable(),
  protocol: zOtProtocol,
  endpoint: zCode(500),
  /** decrypted centrally, shipped only for the node's OWN adapters (D4) */
  connectionOptions: zJsonRecord.nullable(),
  pollIntervalMs: zId,
  isEnabled: z.boolean(),
  /** sha256 of (protocol, endpoint, connectionOptions) — compared before a pinned STOP (replaces runningConnectionMatchesAdapterRow) */
  connectionFingerprint: zHex64,
  /** R-10-b — the adapter's owner epoch (quoted back in commands / reports) */
  ownerEpoch: zId,
  updatedAt: zEpochMs,
  tags: z.array(edgeConfigTagSchema).max(5_000),
});
export const edgeConfigRobotSchema = z.strictObject({
  id: zId,
  code: zCode(64),
  name: zCode(255),
  vendor: zRobotVendor,
  model: zText(128).nullable(),
  kind: zRobotKind,
  endpoint: zCode(255),
  connectionOptions: zJsonRecord.nullable(),
  pollIntervalMs: zId,
  isEnabled: z.boolean(),
  /** null = unknown (a STOP is then SENT, never simulated — design §2.9) */
  commissioned: z.boolean().nullable(),
  lineId: zId.nullable(),
  stationId: zId.nullable(),
  motionLock: z.strictObject({ reasonCode: zCode(64), generation: zId, authority: zLockAuthority, ownerEpoch: zId.nullable(), lockedAt: zEpochMs }).nullable(),
  motionLockGenerationFloor: zCount,
  /** R-10-b — the robot's owner epoch: every lock event / command of this robot quotes it */
  ownerEpoch: zId,
  updatedAt: zEpochMs,
});
export const edgeConfigSafetyPlcSchema = z.strictObject({
  id: zId,
  trustDigest: zHex64.nullable(),
  approved: z.boolean(),
  /** the safety_plc_configs row as safetyPlcAdapter / safetyTarget read it (resolved centrally with the safetyTarget matcher) */
  config: zJsonRecord,
});
export const edgeConfigLimitsSchema = z.strictObject({
  authTtlMs: z.number().int().min(EDGE_AUTH_TTL_MIN_MS).max(EDGE_AUTH_TTL_MAX_MS),
  maxClockSkewMs: z.number().int().min(0).max(300_000),
  journalMaxBytes: zId,
  programReportMs: zId,
  programReportMaxAgeMs: zId,
  heartbeatMs: zId,
  pullMs: zId,
});
export const edgeConfigSnapshotSchema = z.strictObject({
  kind: z.literal("config_snapshot"),
  protocolVersion: z.literal(EDGE_PROTOCOL_VERSION),
  /** strictly increasing per node */
  configVersion: zId,
  issuedAt: zEpochMs,
  /** central-owned identity — the node can no longer rename itself or change its factory / lines; credentialId = the
   *  credential this config was fetched with (the edge binds every authorisation's credentialId to it) */
  node: z.strictObject({ id: zId, code: zCode(128), credentialId: zId, factoryCode: zText(128).nullable(), lineCodes: z.array(zCode(128)).max(200) }),
  adapters: z.array(edgeConfigAdapterSchema).max(500),
  robots: z.array(edgeConfigRobotSchema).max(500),
  machines: z.array(zMachine).max(1_000),
  safetyPlcConfigs: z.array(edgeConfigSafetyPlcSchema).max(200),
  /** the signed keyset (typ keyset) — verified against the pinned / chain-trusted keyset (verifyEdgeKeysetUpdate) */
  keyset: edgeSignedEnvelopeSchema,
  limits: edgeConfigLimitsSchema,
});
export type EdgeConfigSnapshot = z.infer<typeof edgeConfigSnapshotSchema>;

// ── signed: run package + sweep picture (typ runpkg, design §2.4 / §2.14) ──────────────────────────────────────────

const runPicture = {
  runId: zId,
  nodeId: zId,
  /** fix review 1 (I4) — the node credential the package / picture is for (verifyEdgeRunPackage / verifyEdgeSweepPicture bind it) */
  credentialId: zId,
  defHash: zHex64,
  /** the WorkflowDefinition — the edge re-checks hashWorkflowDefinition(definition) === defHash */
  definition: zJsonRecord,
  machines: z.array(zMachine).max(1_000),
  verifiedStops: z.array(edgeVerifiedStopSchema).max(1_000),
  /** may be stops but could not be verified centrally (no exemption) */
  stopsUnsure: z.array(zStepId).max(1_000),
  prior: edgePriorPictureSchema,
  issuedAt: zEpochMs,
};
export const edgeRunPackageSchema = z.strictObject({
  kind: z.literal("run_package"),
  ...runPicture,
  claimSeq: zClaimSeq,
  workflowId: zId,
  workflowVersion: zId,
  params: zJsonRecord,
  /** branch decisions + foeDispatchedSteps */
  context: zJsonRecord,
  /** validated centrally as active */
  owner: z.strictObject({ id: zId, role: zCode(32) }).nullable(),
  startedViaApi: z.boolean(),
  /** the adapter per OT step (withResolvedAdapter rule) */
  resolvedAdapters: z.array(z.strictObject({ stepId: zStepId, adapterId: zId })).max(1_000),
  /** INFORMATIONAL only (logs / fail-fast) — never used to decide; /authorize decides */
  approvals: z.array(z.strictObject({ gateStepId: zStepId, approvedBy: zId, approvedAt: zEpochMs })).max(200),
  /** INFORMATIONAL central binding digest */
  bindingDigest: zHex64.nullable(),
});
export type EdgeRunPackage = z.infer<typeof edgeRunPackageSchema>;
/** The stored picture of an ABORTED run whose STOPs central could not confirm (pull `stopsUnconfirmed`) — the edge re-sends. */
export const edgeSweepPictureSchema = z.strictObject({ kind: z.literal("sweep_picture"), ...runPicture });
export type EdgeSweepPicture = z.infer<typeof edgeSweepPictureSchema>;
export const edgeRunPkgPayloadSchema = z.discriminatedUnion("kind", [edgeRunPackageSchema, edgeSweepPictureSchema]);

// ── POST config ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** `configHash` = the one the edge holds (also sent as If-None-Match). */
export const edgeConfigRequestSchema = z.strictObject({ configHash: zHex64.nullable().optional() });
export const edgeConfigAnswerSchema = z.union([
  z.strictObject({ notModified: z.literal(true), configHash: zHex64 }),
  z.strictObject({ config: edgeSignedEnvelopeSchema, configHash: zHex64 }),
]);
export type EdgeConfigRequest = z.infer<typeof edgeConfigRequestSchema>;
export type EdgeConfigAnswer = z.infer<typeof edgeConfigAnswerSchema>;

// ── POST heartbeat ──────────────────────────────────────────────────────────────────────────────────────────────────

export const edgeHeartbeatRequestSchema = z.strictObject({
  protocolVersion: z.literal(EDGE_PROTOCOL_VERSION),
  status: z.enum(["online", "degraded"]),
  version: zCode(64),
  capacity: z.strictObject({ liveRuns: zCount, maxRuns: zId }),
  journal: z.strictObject({ epoch: zEpoch, backlog: zCount, bytes: zCount, full: z.boolean() }),
  configHash: zHex64.nullable(),
  keysetVersion: zCount,
  wallClockMs: zEpochMs,
  uptimeMs: zCount,
});
export const edgeHeartbeatAnswerSchema = z.strictObject({
  serverTimeMs: zEpochMs,
  configVersion: zCount,
  keysetVersion: zCount,
  programCheckRequested: z.boolean(),
});
export type EdgeHeartbeatRequest = z.infer<typeof edgeHeartbeatRequestSchema>;
export type EdgeHeartbeatAnswer = z.infer<typeof edgeHeartbeatAnswerSchema>;

// ── POST program-checks ─────────────────────────────────────────────────────────────────────────────────────────────

export const edgeProgramChecksRequestSchema = z.strictObject({ readings: zProgramChecks.min(1) });
export const edgeProgramChecksAnswerSchema = z.strictObject({ accepted: zCount, refused: z.array(zId).max(256) });
export type EdgeProgramChecksRequest = z.infer<typeof edgeProgramChecksRequestSchema>;
export type EdgeProgramChecksAnswer = z.infer<typeof edgeProgramChecksAnswerSchema>;

// ── POST pull ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const edgePullRequestSchema = z.strictObject({});
export const edgePulledRunSchema = z.strictObject({
  runId: zId,
  workflowId: zId,
  workflowRef: zText(255).nullable(),
  workflowVersion: zId,
  defHash: zHex64,
  claimSeq: zClaimSeqNext,
  refused: z.literal("definitionChanged").optional(),
});
export const edgeNodeClaimSchema = z.strictObject({ runId: zId, claimSeq: zClaimSeq, status: zRunStatus, abortRequested: z.boolean(), stale: z.boolean() });
export const edgePullAnswerSchema = z.strictObject({
  node: zCode(128),
  protocolVersion: z.literal(EDGE_PROTOCOL_VERSION),
  configVersion: zCount,
  keysetVersion: zCount,
  programCheckRequested: z.boolean(),
  runs: z.array(edgePulledRunSchema).max(100),
  claims: z.array(edgeNodeClaimSchema).max(200),
  /** aborted runs whose STOPs central could not confirm: a SIGNED sweep picture each (typ runpkg, kind sweep_picture) */
  stopsUnconfirmed: z.array(z.strictObject({ runId: zId, picture: edgeSignedEnvelopeSchema })).max(50),
  /** signed commands (typ cmd) */
  commands: zSignedList(EDGE_PULL_COMMANDS_MAX),
});
export type EdgePulledRun = z.infer<typeof edgePulledRunSchema>;
export type EdgeNodeClaim = z.infer<typeof edgeNodeClaimSchema>;
export type EdgePullAnswer = z.infer<typeof edgePullAnswerSchema>;

// ── POST runs/:id/claim ─────────────────────────────────────────────────────────────────────────────────────────────

export const edgeClaimRequestSchema = z.strictObject({ claimSeq: zClaimSeqNext, defHash: zHex64, programChecks: zProgramChecks });
export const edgeClaimAnswerSchema = z.strictObject({
  runId: zId,
  claimSeq: zClaimSeq,
  claimToken: zClaimToken,
  /** signed run package (typ runpkg, kind run_package) */
  package: edgeSignedEnvelopeSchema,
});
export type EdgeClaimRequest = z.infer<typeof edgeClaimRequestSchema>;
export type EdgeClaimAnswer = z.infer<typeof edgeClaimAnswerSchema>;

// ── POST runs/:id/progress ──────────────────────────────────────────────────────────────────────────────────────────

export const edgeProgressRequestSchema = z.strictObject({ ...zClaimRef, seq: zSeq, status: zRunStatus.optional(), currentStepId: zStepId.nullable().optional() });
export const edgeProgressAnswerSchema = z.strictObject({ abortRequested: z.boolean(), status: zRunStatus, consistent: z.boolean(), commands: zSignedList(EDGE_PULL_COMMANDS_MAX) });
export type EdgeProgressRequest = z.infer<typeof edgeProgressRequestSchema>;
export type EdgeProgressAnswer = z.infer<typeof edgeProgressAnswerSchema>;

// ── POST runs/:id/authorize (design §2.5) ───────────────────────────────────────────────────────────────────────────

export const edgeAuthorizeCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ot"),
    adapterId: zId,
    machineId: zId.nullable(),
    commandType: zCode(64),
    writes: z.array(z.strictObject({ tagKey: zCode(128), value: z.unknown() })).min(1).max(64),
  }),
  z.strictObject({ kind: z.literal("robot"), robotId: zId, jobType: zRobotJobType, params: zJsonRecord }),
]);
export const edgeAuthorizeRequestSchema = z.strictObject({
  ...zClaimRef,
  stepId: zStepId,
  attempt: zAttempt,
  idempotencyKey: zIdemKey,
  /** issued by THIS edge process and still pending — the same nonce returns the same token (idempotent) */
  reqNonce: zReqNonce,
  /** NEVER trusted: central rebuilds the command from the definition and compares hashes (payload_mismatch) */
  command: edgeAuthorizeCommandSchema,
  payloadHash: zPayloadHash,
  programChecks: zProgramChecks,
});
export const edgeAuthorizeAnswerSchema = z.strictObject({
  /** signed EdgeAuthClaims (typ auth) */
  authorization: edgeSignedEnvelopeSchema,
  ttlMs: z.number().int().min(EDGE_AUTH_TTL_MIN_MS).max(EDGE_AUTH_TTL_MAX_MS),
});
export type EdgeAuthorizeCommand = z.infer<typeof edgeAuthorizeCommandSchema>;
export type EdgeAuthorizeRequest = z.infer<typeof edgeAuthorizeRequestSchema>;
export type EdgeAuthorizeAnswer = z.infer<typeof edgeAuthorizeAnswerSchema>;

// ── POST runs/:id/report (design §2.6) ──────────────────────────────────────────────────────────────────────────────

export const edgeStepRecordSchema = z.strictObject({
  kind: z.literal("step"),
  seq: zSeq,
  stepId: zStepId,
  stepType: zCode(32),
  status: zStepStatus,
  attempt: z.number().int().nonnegative().max(EDGE_ATTEMPT_MAX),
  startedAt: zEpochMs.nullable(),
  finishedAt: zEpochMs.nullable(),
  error: zText(4_000).nullable(),
  result: zJsonRecord.nullable(),
  /** the authorisation a NON-STOP command step ran under; null for non-command / STOP steps */
  jti: zJti.nullable(),
});
export const edgeContextRecordSchema = z.strictObject({ kind: z.literal("context"), seq: zSeq, patch: zJsonRecord });
export const edgeAbortStopRecordSchema = z.strictObject({
  kind: z.literal("abort_stop"),
  seq: zSeq,
  stepId: zStepId,
  status: z.enum(["completed", "failed"]),
  result: zJsonRecord.nullable(),
  at: zEpochMs,
});
export const edgeLedgerRecordSchema = z.strictObject({
  kind: z.literal("ledger"),
  seq: zSeq,
  stepId: zStepId,
  attempt: z.number().int().nonnegative().max(EDGE_ATTEMPT_MAX),
  idempotencyKey: zIdemKey,
  /** required for a non-STOP result (else 409 unauthorised_actuation); null only for a STOP */
  jti: zJti.nullable(),
  stop: z.boolean(),
  target: z.union([z.strictObject({ robotId: zId, jobType: zRobotJobType }), z.strictObject({ adapterId: zId, commandType: zCode(64) })]),
  status: zCode(32),
  result: zJsonRecord.nullable(),
  at: zEpochMs,
});
export const edgeRunReportRecordSchema = z.discriminatedUnion("kind", [edgeStepRecordSchema, edgeContextRecordSchema, edgeAbortStopRecordSchema, edgeLedgerRecordSchema]);

/** records must be in strictly consecutive seq order (the cursor rule is applied per record). */
function consecutive(records: ReadonlyArray<{ seq: number }>): boolean {
  for (let i = 1; i < records.length; i++) if (records[i].seq !== records[i - 1].seq + 1) return false;
  return true;
}
export const edgeReportRequestSchema = z
  .strictObject({
    ...zClaimRef,
    epoch: zEpoch,
    stream: edgeRunStreamSchema,
    records: z.array(edgeRunReportRecordSchema).min(1).max(EDGE_REPORT_BATCH_MAX),
  })
  .refine((v) => consecutive(v.records), { message: "records must have consecutive seq", path: ["records"] })
  .refine((v) => parseEdgeStream(v.stream)?.kind === "run" && (parseEdgeStream(v.stream) as { claimSeq: number }).claimSeq === v.claimSeq, {
    message: "stream must be run:<runId>:<claimSeq> of this claim",
    path: ["stream"],
  });
/** Cursor answer of every stream route. A duplicate (seq ≤ cursor) is acknowledged (counted), a gap is 409 gap {expectedSeq}. */
export const edgeStreamAnswerSchema = z.strictObject({ ackedSeq: zCount, applied: zCount, duplicates: zCount });
export type EdgeRunReportRecord = z.infer<typeof edgeRunReportRecordSchema>;
export type EdgeReportRequest = z.infer<typeof edgeReportRequestSchema>;
export type EdgeStreamAnswer = z.infer<typeof edgeStreamAnswerSchema>;

// ── POST runs/:id/complete / release / interrupted ──────────────────────────────────────────────────────────────────

export const edgeCompleteRequestSchema = z
  .strictObject({
    ...zClaimRef,
    seq: zSeq,
    outcome: z.enum(["completed", "failed", "aborted", "paused", "held"]),
    /** required iff outcome = paused (the gate reached) */
    gateStepId: zStepId.optional(),
    /** required iff outcome = held (D5) */
    heldReason: z.enum(EDGE_HELD_REASONS).optional(),
    error: zText(4_000).optional(),
    epoch: zEpoch,
    /** the last seq of the run stream the edge reported — central requires its cursor to be there (else 409 gap) */
    reportedThrough: zCount,
  })
  .refine((v) => (v.outcome === "paused") === (v.gateStepId !== undefined), { message: "gateStepId iff paused", path: ["gateStepId"] })
  .refine((v) => (v.outcome === "held") === (v.heldReason !== undefined), { message: "heldReason iff held", path: ["heldReason"] });
export const edgeCompleteAnswerSchema = z.strictObject({ abortRequested: z.boolean(), status: zRunStatus });
export const edgeReleaseRequestSchema = z.strictObject({ ...zClaimRef, seq: zSeq, reason: zText(300) });
export const edgeReleaseAnswerSchema = z.strictObject({ status: zRunStatus });
export const edgeInterruptedRequestSchema = z.strictObject({ claimSeq: zClaimSeq });
export const edgeInterruptedAnswerSchema = z.strictObject({ status: zRunStatus });
export type EdgeCompleteRequest = z.infer<typeof edgeCompleteRequestSchema>;
export type EdgeCompleteAnswer = z.infer<typeof edgeCompleteAnswerSchema>;
export type EdgeReleaseRequest = z.infer<typeof edgeReleaseRequestSchema>;
export type EdgeInterruptedRequest = z.infer<typeof edgeInterruptedRequestSchema>;

// ── POST telemetry (D12) ────────────────────────────────────────────────────────────────────────────────────────────

/** One OT sample of an OWNED adapter. machineId / deviceId / protocol / meta are NOT accepted — central derives them from its row. */
export const edgeTelemetrySampleSchema = z.strictObject({
  adapterId: zId,
  tagKey: zCode(128),
  /** device / source time (ms); null ⇒ central stamps it (tsSource server) */
  ts: zEpochMs.nullable(),
  tsSource: z.enum(["device", "server"]).optional(),
  tsReject: z.literal("ts_no_timezone").optional(),
  value: z.union([zFinite, zText(1_000), z.boolean(), z.null()]),
  quality: z.enum(["good", "bad", "uncertain"]).optional(),
  unit: zText(50).nullable().optional(),
});
export const edgeTelemetryRequestSchema = z.strictObject({ samples: z.array(edgeTelemetrySampleSchema).min(1).max(EDGE_TELEMETRY_BATCH_MAX) });
export const edgeTelemetryAnswerSchema = z.strictObject({ accepted: zCount, refused: zCount });
export type EdgeTelemetrySample = z.infer<typeof edgeTelemetrySampleSchema>;
export type EdgeTelemetryRequest = z.infer<typeof edgeTelemetryRequestSchema>;
export type EdgeTelemetryAnswer = z.infer<typeof edgeTelemetryAnswerSchema>;

// ── POST robots/state (design §2.7, D6) ─────────────────────────────────────────────────────────────────────────────

/** A robot state of an OWNED robot (robotDriver.RobotState). NO trust field: e-stop transitions are derived CENTRALLY. */
export const edgeRobotStateRecordSchema = z.strictObject({
  seq: zSeq,
  robotId: zId,
  ts: zEpochMs,
  link: z.enum(["connected", "disconnected"]).optional(),
  mode: zText(32).optional(),
  busy: z.boolean().optional(),
  estop: z.boolean().optional(),
  pose: z
    .strictObject({
      joints: z.array(zFinite).max(32).optional(),
      cartesian: z.strictObject({ x: zFinite, y: zFinite, z: zFinite, rx: zFinite.optional(), ry: zFinite.optional(), rz: zFinite.optional() }).optional(),
      frame: zText(64).optional(),
    })
    .optional(),
  payloadKg: zFinite.optional(),
  speedPct: zFinite.optional(),
  error: zText(1_000).optional(),
  batteryPct: zFinite.optional(),
  jointStates: z.array(zJsonRecord).max(32).optional(),
  safetyZoneId: zId.optional(),
  firmwareVersion: zText(64).optional(),
});
export const edgeRobotStateRequestSchema = z
  .strictObject({ epoch: zEpoch, stream: z.literal(EDGE_STREAM_ROBOT_STATE), records: z.array(edgeRobotStateRecordSchema).min(1).max(EDGE_REPORT_BATCH_MAX) })
  .refine((v) => consecutive(v.records), { message: "records must have consecutive seq", path: ["records"] });
export type EdgeRobotStateRecord = z.infer<typeof edgeRobotStateRecordSchema>;
export type EdgeRobotStateRequest = z.infer<typeof edgeRobotStateRequestSchema>;

// ── POST locks/events (the `events` stream, design §2.2 / §2.11) ────────────────────────────────────────────────────

export const edgeLockEventRecordSchema = z.strictObject({
  kind: z.literal("lock"),
  seq: zSeq,
  robotId: zId,
  /** locked ⇒ central upserts authority 'edge:<node>' where stored generation ≤ g; cleared ⇒ deletes WHERE authority = 'edge:<node>' AND generation ≤ g */
  event: z.enum(["locked", "cleared"]),
  generation: zId,
  /** R-10-b — the robot's owner epoch the event happened under; central refuses a stale one */
  ownerEpoch: zId,
  reasonCode: zCode(64),
  since: zEpochMs,
  clearedBy: z.enum(["stop", "operator"]).nullable(),
  /** the central lock / clear request this answers, if any */
  requestId: zId.nullable(),
});
export const edgeStopEventRecordSchema = z.strictObject({
  kind: z.literal("stop"),
  seq: zSeq,
  target: z.union([zRobotTarget, zAdapterTarget]),
  source: z.enum(["command", "anomaly", "local"]),
  requestId: zId.nullable(),
  outcome: z.enum(["sent", "failed", "simulated"]),
  at: zEpochMs,
  detail: zText(500).nullable(),
});
export const edgeRefusalEventRecordSchema = z.strictObject({
  kind: z.literal("refusal"),
  seq: zSeq,
  runId: zId.nullable(),
  stepId: zStepId.nullable(),
  reason: zCode(64),
  at: zEpochMs,
});
export const edgeAnomalyEventRecordSchema = z.strictObject({
  kind: z.literal("anomaly"),
  seq: zSeq,
  code: zCode(64),
  runId: zId.nullable(),
  detail: zText(1_000).nullable(),
  at: zEpochMs,
});
export const edgeCommandAckRecordSchema = z.strictObject({
  kind: z.literal("command_ack"),
  seq: zSeq,
  requestId: zId,
  outcome: z.enum(["done", "refused", "failed", "expired"]),
  generation: zId.nullable(),
  at: zEpochMs,
});
export const edgeEventRecordSchema = z.discriminatedUnion("kind", [
  edgeLockEventRecordSchema,
  edgeStopEventRecordSchema,
  edgeRefusalEventRecordSchema,
  edgeAnomalyEventRecordSchema,
  edgeCommandAckRecordSchema,
]);
export const edgeEventsRequestSchema = z
  .strictObject({ epoch: zEpoch, stream: z.literal(EDGE_STREAM_EVENTS), records: z.array(edgeEventRecordSchema).min(1).max(EDGE_REPORT_BATCH_MAX) })
  .refine((v) => consecutive(v.records), { message: "records must have consecutive seq", path: ["records"] });
export type EdgeEventRecord = z.infer<typeof edgeEventRecordSchema>;
export type EdgeEventsRequest = z.infer<typeof edgeEventsRequestSchema>;

// ── error data ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const edgeErrorDataSchemas = Object.freeze({
  claim_stale: z.strictObject({ abortRequested: z.boolean() }),
  gate_required: z.strictObject({ reason: zCode(200) }),
  device_refused: z.strictObject({ gate: z.enum(EDGE_DEVICE_GATES) }),
  gap: z.strictObject({ expectedSeq: zSeq }),
  epoch_rejected: z.strictObject({ expectedSeq: z.literal(1) }),
});

/** Every request body schema by route (the strictness census in edgeProtocol.dot10.test.ts walks this). */
export const EDGE_REQUEST_SCHEMAS = Object.freeze({
  config: edgeConfigRequestSchema,
  heartbeat: edgeHeartbeatRequestSchema,
  programChecks: edgeProgramChecksRequestSchema,
  pull: edgePullRequestSchema,
  claim: edgeClaimRequestSchema,
  progress: edgeProgressRequestSchema,
  authorize: edgeAuthorizeRequestSchema,
  report: edgeReportRequestSchema,
  complete: edgeCompleteRequestSchema,
  release: edgeReleaseRequestSchema,
  interrupted: edgeInterruptedRequestSchema,
  telemetry: edgeTelemetryRequestSchema,
  robotsState: edgeRobotStateRequestSchema,
  locksEvents: edgeEventsRequestSchema,
} satisfies Record<EdgeNodeRoute, z.ZodType>);

/** Every answer `data` schema by route. */
export const EDGE_ANSWER_SCHEMAS = Object.freeze({
  config: edgeConfigAnswerSchema,
  heartbeat: edgeHeartbeatAnswerSchema,
  programChecks: edgeProgramChecksAnswerSchema,
  pull: edgePullAnswerSchema,
  claim: edgeClaimAnswerSchema,
  progress: edgeProgressAnswerSchema,
  authorize: edgeAuthorizeAnswerSchema,
  report: edgeStreamAnswerSchema,
  complete: edgeCompleteAnswerSchema,
  release: edgeReleaseAnswerSchema,
  interrupted: edgeInterruptedAnswerSchema,
  telemetry: edgeTelemetryAnswerSchema,
  robotsState: edgeStreamAnswerSchema,
  locksEvents: edgeStreamAnswerSchema,
} satisfies Record<EdgeNodeRoute, z.ZodType>);

/** Body keys no edge request may ever carry (trust / identity are central's). The strict schemas refuse them; the census pins it. */
export const EDGE_FORBIDDEN_BODY_KEYS = Object.freeze([
  "trusted",
  "origin",
  "safetyCritical",
  "trust",
  "nodeId",
  "edgeNodeId",
  "nodeCode",
  "factoryCode",
  "credentialId",
  "authority",
] as const);
