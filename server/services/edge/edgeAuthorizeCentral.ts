/**
 * doc 81 Đợt 10 task B (design §2.5, §2.13, L-7) — POST /edge/node/runs/:runId/authorize: central's per-step, single-use,
 * SIGNED authorisation of ONE non-STOP command attempt of an edge run. The edge drives a device only under one (its verifier
 * checks node, credential, run, claim, step, attempt, idempotency key, the hash of the exact bytes it sends, the nonce it is
 * waiting on, the TTL from its own request send, and that the jti was never consumed).
 *
 * CHECKS — in this order, cheapest first (N5): nothing heavier runs before a cheaper refusal could have answered.
 *   1. node & run   — the assignment is the caller's and the run is in the node's factory scope (else THE 404); the claim is
 *                     CURRENT (else 409 claim_stale {abortRequested}); central stopped it (abort / gate rejection) ⇒ 409
 *                     stopped; the run is running / compensating (else 409 run_not_active). (Protocol v2: the route.)
 *   2. definition   — the head definition is still the assignment's defHash (409 definition_changed); stepId is a command
 *                     step (or a compensation of one) of it; attempt ≤ the engine's attempts (maxAttempts + 1 = step.maxAttempts + 1 tries, I-5); the idempotency key is the engine's
 *                     `run<id>-<step>-a<attempt>` (400 step_invalid).
 *   3. payload      — central REBUILDS the command from the definition with its own adapter resolution and hashes it; the
 *                     request's payloadHash must equal both that hash and the hash of the command body the edge sent
 *                     (409 payload_mismatch + EDGE_ANOMALY audit). The edge's command body is never trusted.
 *   4. ownership    — the target robot / adapter is owned by the caller (409 not_owned).
 *   5. not a STOP   — a robot abort or a PINNED OT stop needs no authorisation and gets none (400
 *                     stop_needs_no_authorization): central never gates a STOP (L-7). An unpinned stop-typed write is a write.
 *   6. approval     — deriveRunApprovalIdentity + evaluateWithPrograms(computeBindingDetail(def, pre)): `pre` is the node's
 *                     program checks of THIS request for its own adapters (stale ⇒ unreadable); any other adapter is
 *                     unreadable — central NEVER reads an edge-owned controller (D7). Refusal ⇒ 409 gate_required {reason}.
 *   7. device gates — robot: enabled, no motion-lock row of ANY authority, no outstanding central lock / stop request,
 *                     FIELD_V2, policy + interlock (real mode); OT: adapter enabled, tags enabled + writable, policy +
 *                     interlock (real mode) ⇒ 409 device_refused {gate}. Commissioning only lowers the mode to simulated
 *                     (the dispatchers' rule).
 *   8. mode         — real ⇔ central's ROBOT_/OT_CONTROL_ENABLED and commissioned; the edge applies the stricter of this and
 *                     its own (central's kill switch over edge actuation).
 *   9. one transaction — the claim re-checked FOR UPDATE; an existing authorisation of (run, claim, step, attempt) with the
 *                     SAME nonce ⇒ the identical token again (re-signed from the stored row — Ed25519 is deterministic), a
 *                     different nonce ⇒ 409 already_authorized; else an `ai_pending_actions` row (status executed, bound to
 *                     the payload hash and the gate approval — today's audit / inbox semantics) + the
 *                     `edge_step_authorizations` row (mig 0372: the DB re-checks the claim and the credential).
 *  10. sign + audit — {authorization, ttlMs}; EDGE_STEP_AUTHORIZED.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { aiPendingActions, orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows, users } from "../../../drizzle/schema";
import {
  EDGE_PROTOCOL_VERSION,
  clampEdgeAuthTtlMs,
  edgeAuthClaimsSchema,
  edgeAuthorizeRequestSchema,
  edgeError,
  parseEdgeBody,
  type EdgeAnswer,
  type EdgeAuthClaims,
  type EdgeAuthorizeAnswer,
  type EdgeAuthorizeRequest,
  type EdgeDeviceGate,
  type EdgeProgramCheck,
} from "./edgeProtocol";
import { EDGE_TYP_NAME } from "./edgeSigning";
import { edgeStepAuthorizations, robotMotionLockAuthority, type EdgeStepAuthorizationRow } from "./edgeControlSchema";
import { runEdgeAssignments, type RunEdgeAssignment } from "./edgeExecutionSchema";
import { hashEdgeSecret, sameDigest, type EdgeNodePrincipal } from "./edgeNodeCredentials";
import {
  auditNode,
  centralDb,
  centralSigner,
  edgeUnavailable,
  isEdgeUnavailableError,
  nodeProtocolVersion,
  protocolVersionAnswer,
  robotOwners,
  adapterOwners,
  deviceInNodeFactory,
  runInNodeScope,
  runNotFound,
  sha256Hex,
  signForNode,
  type CentralSigner,
  type Db,
} from "./edgeCentralCommon";
import { edgeStepIdempotencyKey, isPinnedOtStop, loadMachineMap, rebuildCommand, requestPayloadHash, stopPinsOf, type RebuiltCommand } from "./edgeRunAnalysis";
import { adapterStopOutstanding, lockRequestOutstanding } from "./edgeNodeCommands";
import type { WorkflowDefinition } from "../orchestration/foe/workflowModel";
import type { ProgramCheck } from "../ot/programChecksum";

/** foeEngine.FOE_GATE_REQUIRED — the Studio keys its text on `FOE_GATE_REQUIRED(<reason>)`. */
const FOE_GATE_REQUIRED = "FOE_GATE_REQUIRED";

class Answer extends Error {
  constructor(public readonly answer: EdgeAnswer<never>) {
    super(answer.code ?? "refused");
  }
}


/**
 * R-10-m — the program checks of an edge run come from ONE rule for approval AND /authorize: Group C's
 * edgeProgramReportRule.edgeProgramPreOf (key = this node's own adapter, capability = central's config verdict, owner epoch,
 * freshness; every other adapter ⇒ unreadable). Here the readings are the request's own ("live"); the approval reads the
 * stored reports ("stored") through the same predicate. The readings are also stored (approver's screen). Central never
 * reads an edge controller (D7).
 */
export async function edgeProgramPreFor(d: Db, node: EdgeNodePrincipal, readings: readonly EdgeProgramCheck[]): Promise<ReadonlyMap<number, ProgramCheck>> {
  const { deviceAdapters } = await import("../../../drizzle/schema");
  const { adapterOwnership } = await import("./edgeControlSchema");
  const { edgeProgramPreOf } = await import("./edgeProgramReportRule");
  const { upsertProgramReports } = await import("./edgeIngestCentral");
  const { eq: eqOp } = await import("drizzle-orm");
  // the adapters THIS node owns (central's config rows: capability is central's verdict, R-10-m)
  // (two reads: both projections name the same table device_adapters)
  const own = await d.select({ id: adapterOwnership.id, edgeNodeId: adapterOwnership.edgeNodeId, ownerEpoch: adapterOwnership.ownerEpoch }).from(adapterOwnership).where(eqOp(adapterOwnership.edgeNodeId, node.nodeId));
  const { inArray: inArrayOp } = await import("drizzle-orm");
  const rows = own.length
    ? await d.select({ id: deviceAdapters.id, protocol: deviceAdapters.protocol, connectionOptions: deviceAdapters.connectionOptions, code: deviceAdapters.code, name: deviceAdapters.name }).from(deviceAdapters).where(inArrayOp(deviceAdapters.id, own.map((o) => o.id)))
    : [];
  const owned = rows.flatMap((r) => {
    const o = own.find((x) => x.id === r.id);
    return o && o.edgeNodeId === node.nodeId ? [{ ...r, edgeNodeId: o.edgeNodeId, ownerEpoch: o.ownerEpoch }] : [];
  });
  const mine = new Set(owned.map((a) => a.id));
  await upsertProgramReports(d, node, readings.filter((r) => mine.has(r.adapterId))); // the approver's screen sees them too
  return edgeProgramPreOf(
    node.nodeId,
    owned.map((a) => ({ ...a, ownerEpoch: a.ownerEpoch == null ? null : Number(a.ownerEpoch) })),
    readings.map((r) => ({ ...r, edgeNodeId: node.nodeId })),
    { source: "live" },
  );
}

type Gate = { gate: EdgeDeviceGate; detail: string };
interface Verdict {
  mode: "real" | "simulated";
  verdicts: { commissioned: boolean; policy: string; interlock: string };
  safetyConfigIds: number[];
  target: EdgeAuthClaims["target"];
}

/**
 * The safety-PLC configs guarding the target (the safetyTarget matcher; an unresolvable target ⇒ every config). A read that
 * FAILS throws (the authorisation is refused — 503, nothing signed): an empty list must never stand for "could not read".
 */
async function safetyConfigIdsFor(ref: { adapterId?: number; machineId?: number | null; robotId?: number }): Promise<number[]> {
  const { resolveSafetyTargets } = await import("../ot/safetyTarget");
  const { plcConfigAppliesToTargets } = await import("../ot/safetyPreflightPolicy");
  const { listPlcConfigs } = await import("../safety/plc/safetyPlcAdapter");
  const targets = await resolveSafetyTargets(ref);
  return (await listPlcConfigs({ onlyEnabled: true }))
    .filter((c) => plcConfigAppliesToTargets(c as never, targets))
    .map((c) => c.id)
    .sort((a, b) => a - b)
    .slice(0, 64);
}

/** M-2 — the role of a user for FIELD_V2 / policy. A read error THROWS (503): an unreadable role is never "user" by default. */
async function roleOf(d: Db, userId: number): Promise<string> {
  const [u] = await d.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return typeof u?.role === "string" && u.role ? u.role : "user"; // a user with no role is the least-privileged one, as central
}

/** The policy refusal text (the dispatchers' codes). */
const policyRefusal = (v: { effect: string; reason: string }) => `${v.effect === "deny" ? "POLICY_DENIED" : "POLICY_APPROVAL_REQUIRED"}: ${v.reason}`;

/**
 * I-1 — central's SAFETY-PLC PREFLIGHT, exactly as the dispatchers run it on their real path (commandDispatcher
 * readSafetyStateForPreflight / robotCommandDispatcher 4a-safety): the adapter facade's read-only getSafetyStatus with
 * { forRealActuation: true } under the 5 s deadline; anything but OK (BLOCKED, UNKNOWN, SIM_ONLY, a read error / timeout) refuses.
 */
async function safetyPreflight(ref: { adapterId: number; machineId: number | null; robotId?: number }): Promise<Gate | null> {
  const { safetyPreflightReason } = await import("../ot/safetyPreflightPolicy");
  const { withDeadline } = await import("../ot/drivers/boundedClose");
  let state = "UNKNOWN";
  let basis: Parameters<typeof safetyPreflightReason>[1];
  try {
    const { createAdapterFacade } = await import("../ot/adapterFacade");
    const s = await withDeadline(
      createAdapterFacade(ref.robotId !== undefined ? { adapterId: ref.adapterId, machineId: null, robotId: ref.robotId } : { adapterId: ref.adapterId, machineId: ref.machineId }).getSafetyStatus({ forRealActuation: true }),
      5_000,
      "edge authorize safety-PLC preflight",
    );
    state = s?.state ?? "UNKNOWN";
    basis = s?.basis;
  } catch {
    state = "ERROR";
  }
  if (state === "OK") return null;
  return { gate: "safety", detail: `${safetyPreflightReason(state, basis)}: central's safety-PLC preflight read ${state}` };
}

/** Step 7 + 8 for a robot attempt — the robot dispatcher's order: enabled, lock, FIELD_V2, commissioning ⇒ mode, policy, safety, interlock. */
async function robotGates(d: Db, rb: Extract<RebuiltCommand, { kind: "robot" }>, approvedBy: number, ownerEpoch: number): Promise<Gate | Verdict> {
  const robotId = rb.robotId as number;
  const { readRobotEnabledForMotion } = await import("../robot/robotEnabledGate");
  // fail-closed: only an explicit `true` passes — false, { error } (unreadable / timeout) or a throw all refuse
  let enabled: boolean | { error: string };
  try {
    enabled = await readRobotEnabledForMotion(robotId);
  } catch (err) {
    enabled = { error: String((err as Error)?.message ?? err).slice(0, 160) };
  }
  if (enabled !== true) return { gate: "robot_disabled", detail: enabled === false ? "robot disabled" : `enabled state unreadable (${enabled.error})` };
  const [lock] = await d.select({ authority: robotMotionLockAuthority.authority, reasonCode: robotMotionLockAuthority.reasonCode, generation: robotMotionLockAuthority.generation }).from(robotMotionLockAuthority).where(eq(robotMotionLockAuthority.robotId, robotId)).limit(1);
  if (lock) return { gate: "motion_locked", detail: `motion lock (${lock.authority}, ${lock.reasonCode}, generation ${lock.generation})` };
  if (await lockRequestOutstanding(d, robotId, ownerEpoch)) return { gate: "lock_requested", detail: "a central lock / stop request for this robot is outstanding" };
  const role = await roleOf(d, approvedBy);
  const { authorizeCommand, fieldV2Enabled } = await import("../field/commandAuthz");
  if (fieldV2Enabled()) {
    const authz = await authorizeCommand({ equipmentClass: "ROBOT", verb: "run_job", userId: approvedBy, userRole: role });
    if (!authz.ok) return { gate: "field_v2", detail: authz.reason ?? "command authorization denied" };
  }
  const { isRobotControlEnabled, isRobotCommissioningRequired, isRobotCommissioned, robotInterlockTarget, ROBOT_NO_OT_ADAPTER_ID } = await import("../robot/robotCommandDispatcher");
  const commissioned = isRobotCommissioningRequired() ? await isRobotCommissioned(robotId) : true;
  const real = isRobotControlEnabled() && commissioned;
  let policy = "skipped";
  let interlock = "skipped";
  // R-10-am — the dispatcher policy in EVERY mode (central evaluates it on its real path; the ruling applies it to sim too)
  const { evaluateActionPolicy, secPlatformEnabled } = await import("../security/policyGate");
  if (secPlatformEnabled()) {
    const verdict = evaluateActionPolicy(`user:${approvedBy}`, `robot.command.${rb.jobType}`, `robot:${robotId}`, {
      verb: rb.jobType,
      argsKeys: Object.keys(rb.params ?? {}),
      robotId,
      triggerKind: "hitl",
      role,
      fat_passed: commissioned,
      mode: real ? "real" : "simulated",
      confirmedBy: approvedBy,
    });
    if (!verdict.allow) return { gate: "policy", detail: policyRefusal(verdict) };
    policy = "allow";
  }
  if (real) {
    const { isRobotSafetyPreflightEnabled } = await import("../ot/safetyPreflightPolicy");
    if (isRobotSafetyPreflightEnabled()) {
      const sg = await safetyPreflight({ adapterId: ROBOT_NO_OT_ADAPTER_ID, machineId: null, robotId });
      if (sg) return sg;
    }
    const { evaluateInterlockGate } = await import("../interlock/interlockGate");
    const g = await evaluateInterlockGate(robotInterlockTarget(robotId));
    if (g.blocked) return { gate: "interlock", detail: g.failClosed ? "interlock evaluation error — fail-closed" : `interlock rule(s) ${g.violations.map((v) => `#${v.ruleId}`).join(", ")}` };
    interlock = "clear";
  }
  return {
    mode: real ? "real" : "simulated",
    verdicts: { commissioned, policy, interlock },
    safetyConfigIds: await safetyConfigIdsFor({ robotId }),
    target: { robotId, jobType: rb.jobType as never },
  };
}

/** Step 7 + 8 for an OT attempt — the OT dispatcher's order: adapter, tags, commissioning ⇒ mode, policy, safety, interlock. */
async function otGates(d: Db, rb: Extract<RebuiltCommand, { kind: "ot" }>, ownerEpoch: number): Promise<Gate | Verdict> {
  const adapterId = rb.adapterId as number;
  const { deviceAdapters, deviceTags } = await import("../../../drizzle/schema");
  const [adapter] = await d.select({ isEnabled: deviceAdapters.isEnabled }).from(deviceAdapters).where(eq(deviceAdapters.id, adapterId)).limit(1);
  if (!adapter || adapter.isEnabled !== true) return { gate: "adapter_disabled", detail: "adapter not found or disabled" };
  // M-9 — a console STOP of this adapter not acknowledged done ⇒ no write
  if (await adapterStopOutstanding(d, adapterId, ownerEpoch)) return { gate: "lock_requested", detail: "a central STOP request for this adapter is outstanding" };
  const writes: Array<{ tagKey: string; address: string; dataType: "bool" | "int" | "float" | "string" | "json"; scale: number | null; offset: number | null }> = [];
  for (const w of rb.writes) {
    const [tag] = await d.select().from(deviceTags).where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, w.tagKey))).limit(1);
    if (!tag || tag.isEnabled !== true) return { gate: "tag_disabled", detail: `tag "${w.tagKey}" not found or disabled` };
    if (tag.writable !== true) return { gate: "tag_not_writable", detail: `tag "${w.tagKey}" is not writable` };
    writes.push({ tagKey: tag.tagKey, address: tag.address, dataType: tag.dataType as never, scale: tag.scale == null ? null : Number(tag.scale), offset: tag.offset == null ? null : Number(tag.offset) });
  }
  if (writes.length === 0) return { gate: "tag_disabled", detail: "the command carries no tag write" };
  const { isOtControlEnabled } = await import("../ot/commandDispatcher");
  const { isCommissioningRequired, isCommissioned } = await import("../ot/commissioningService");
  const commissioned = isCommissioningRequired() ? await isCommissioned(adapterId) : true;
  const real = isOtControlEnabled() && commissioned;
  let policy = "skipped";
  let interlock = "skipped";
  // R-10-am — the dispatcher policy in EVERY mode. M-6: the SAME context central's FOE path gives the OT dispatcher — the
  // equipment adapter passes no policyContext, so central evaluates exactly { action: ot.command.<type> }, approved false.
  const { evaluateCommandPolicy, secPlatformEnabled } = await import("../security/policyGate");
  if (secPlatformEnabled()) {
    const verdict = evaluateCommandPolicy({ action: `ot.command.${rb.commandType}` }, { enabled: true, approved: false });
    if (!verdict.allow) return { gate: "policy", detail: policyRefusal(verdict) };
    policy = "allow";
  }
  if (real) {
    const { isOtSafetyPreflightEnabled } = await import("../ot/safetyPreflightPolicy");
    if (isOtSafetyPreflightEnabled()) {
      const sg = await safetyPreflight({ adapterId, machineId: rb.machineId });
      if (sg) return sg;
    }
    const { evaluateInterlockGate } = await import("../interlock/interlockGate");
    const g = await evaluateInterlockGate({ adapterId, machineId: rb.machineId, tagKeys: rb.writes.map((w) => w.tagKey) });
    if (g.blocked) return { gate: "interlock", detail: g.failClosed ? "interlock evaluation error — fail-closed" : `interlock rule(s) ${g.violations.map((v) => `#${v.ruleId}`).join(", ")}` };
    interlock = "clear";
  }
  return {
    mode: real ? "real" : "simulated",
    verdicts: { commissioned, policy, interlock },
    safetyConfigIds: await safetyConfigIdsFor({ adapterId, machineId: rb.machineId }),
    target: { adapterId, writes },
  };
}

/** The claims of a stored authorisation row + the request nonce (re-signing yields the identical envelope). */
function claimsFromRow(row: EdgeStepAuthorizationRow, reqNonce: string): Record<string, unknown> {
  const v = (row.verdictJson ?? {}) as { mode?: unknown; verdicts?: unknown; safetyConfigIds?: unknown; target?: unknown };
  const issued = new Date(row.issuedAt).getTime();
  return {
    typ: EDGE_TYP_NAME.auth,
    kid: row.kid,
    jti: row.jti,
    nodeId: row.edgeNodeId,
    credentialId: row.credentialId,
    runId: row.runId,
    claimSeq: row.claimSeq,
    stepId: row.stepId,
    attempt: row.attempt,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    target: v.target,
    payloadHash: row.payloadHash,
    approval: row.approvalJson ?? null,
    mode: v.mode,
    verdicts: v.verdicts,
    safetyConfigIds: v.safetyConfigIds,
    reqNonce,
    iat: issued,
    ttlMs: new Date(row.expiresAt).getTime() - issued,
  };
}

function signClaims(signer: CentralSigner, claims: Record<string, unknown>, node: EdgeNodePrincipal): EdgeAuthorizeAnswer {
  const authorization = signForNode(signer, "auth", edgeAuthClaimsSchema, claims, node);
  return { authorization, ttlMs: claims.ttlMs as number };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return (e?.code ?? e?.cause?.code) === "23505";
}

export async function authorizeForNode(node: EdgeNodePrincipal, runId: number, body: unknown): Promise<EdgeAnswer<EdgeAuthorizeAnswer>> {
  const parsed = parseEdgeBody(edgeAuthorizeRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  const req: EdgeAuthorizeRequest = parsed.data;
  try {
    const signer = centralSigner();
    if (!signer) return edgeUnavailable;
    const d = await centralDb();
    const v = await nodeProtocolVersion(d, node.nodeId);
    if (v !== EDGE_PROTOCOL_VERSION) return protocolVersionAnswer(v);

    // ── 1. node & run ──
    if (!Number.isInteger(runId) || runId <= 0) return runNotFound(runId);
    const [a] = await d.select().from(runEdgeAssignments).where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.edgeNodeId, node.nodeId))).limit(1);
    if (!a) return runNotFound(runId);
    const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run || !(await runInNodeScope(run, node))) return runNotFound(runId);
    const { centralStopped } = await import("./edgeCoordinator");
    const tokenHash = hashEdgeSecret(req.claimToken);
    if (a.claimSeq !== req.claimSeq || !sameDigest(tokenHash, a.claimTokenHash)) {
      return edgeError("claim_stale", `Run ${runId}: this claim is no longer current — stop walking it.`, { abortRequested: centralStopped(run) });
    }
    if (centralStopped(run)) return edgeError("stopped", `Run ${runId} was stopped centrally (abort / gate rejection) — run the local abort sweep.`);
    if (run.status !== "running" && run.status !== "compensating") return edgeError("run_not_active", `Run ${runId} is ${run.status} — nothing is authorised.`);

    // ── 2. definition & step ──
    const [wf] = await d.select({ definitionJson: orchestrationWorkflows.definitionJson }).from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, a.workflowId)).limit(1);
    const def = wf?.definitionJson as WorkflowDefinition | undefined;
    const { hashWorkflowDefinition, findStepDeep } = await import("../orchestration/foe/foeGateApproval");
    if (!def || !Array.isArray(def.steps) || hashWorkflowDefinition(def) !== a.defHash) return edgeError("definition_changed", `Run ${runId}: the workflow was redeployed after the assignment — nothing is authorised.`);
    const step = findStepDeep(def.steps, req.stepId);
    if (!step || step.type !== "command") return edgeError("step_invalid", `Step "${req.stepId}" is not a command step of run ${runId}.`);
    const maxAttempts = Math.max(1, (step.maxAttempts ?? 0) + 1);
    // I-5 — exactly the engine's bound (foeEngine: attempt 1 … max(1, step.maxAttempts + 1)); never one more
    if (req.attempt > maxAttempts) return edgeError("step_invalid", `Attempt ${req.attempt} exceeds the step's attempts (${maxAttempts}).`);
    const idemKey = edgeStepIdempotencyKey(runId, req.stepId, req.attempt);
    if (req.idempotencyKey !== idemKey) return edgeError("step_invalid", `The idempotency key of step "${req.stepId}" attempt ${req.attempt} is not the run's.`);

    // ── 3. payload binding (central rebuilds; never trusts the body) ──
    const machineMap = await loadMachineMap(d, def);
    const rb = await rebuildCommand(d, step, machineMap, idemKey);
    if (!rb) return edgeError("step_invalid", `Step "${req.stepId}" does not resolve to a command of its machine.`);
    if (rb.kind === "ot" && rb.adapterId === null) return edgeError("device_refused", `Step "${req.stepId}": its adapter cannot be resolved (none or several enabled adapters on the machine).`, { gate: "adapter_disabled" });
    if (rb.kind === "robot" && rb.robotId === null) return edgeError("step_invalid", `Step "${req.stepId}" names no robot.`);
    const bodyHash = req.command.kind === "ot" ? requestPayloadHash({ ...req.command, kind: "ot" }) : requestPayloadHash({ ...req.command, kind: "robot" });
    const kindMatches = req.command.kind === rb.kind;
    if (!kindMatches || rb.payloadHash === null || req.payloadHash !== rb.payloadHash || bodyHash !== rb.payloadHash) {
      await auditNode(node, "EDGE_ANOMALY", { type: "orchestration_run", id: runId }, { anomaly: "payload_mismatch", stepId: req.stepId, attempt: req.attempt, claimed: req.payloadHash, body: bodyHash, central: rb.payloadHash }, "failure");
      return edgeError("payload_mismatch", `Step "${req.stepId}": the command does not match what the definition sends — refused and recorded.`);
    }

    // ── 4. ownership ──
    const owner = rb.kind === "robot" ? (await robotOwners(d, [rb.robotId as number])).get(rb.robotId as number) : (await adapterOwners(d, [rb.adapterId as number])).get(rb.adapterId as number);
    if (!owner || owner.edgeNodeId !== node.nodeId) return edgeError("not_owned", `Step "${req.stepId}": its ${rb.kind === "robot" ? "robot" : "adapter"} is not owned by this node.`);
    // I-4 — ownership never crosses the node's factory: a device placed elsewhere (or unplaced) is not this node's to drive
    if (!(await deviceInNodeFactory(d, node.nodeId, rb.kind === "robot" ? "robot" : "adapter", rb.kind === "robot" ? (rb.robotId as number) : (rb.adapterId as number)))) {
      return edgeError("not_owned", `Step "${req.stepId}": its ${rb.kind === "robot" ? "robot" : "adapter"} is not placed in this node's factory.`);
    }

    // ── 5. a verified STOP never asks (L-7) ──
    if (rb.kind === "robot" && rb.isStop) return edgeError("stop_needs_no_authorization", `Step "${req.stepId}" is a STOP — send it; a STOP needs no authorisation.`);
    if (rb.kind === "ot" && rb.stopTyped) {
      let pins: Array<{ tagKey: string; value: unknown }> | null;
      try {
        pins = (await stopPinsOf(d, [rb.adapterId as number])).get(rb.adapterId as number) ?? [];
      } catch {
        pins = null;
      }
      if ((await isPinnedOtStop(rb, pins)).pinned) return edgeError("stop_needs_no_authorization", `Step "${req.stepId}" is a pinned STOP — send it; a STOP needs no authorisation.`);
    }

    // ── 6. identity & approval (the existing rule; programs from THIS request, never read centrally) ──
    const { deriveRunApprovalIdentity, evaluateWithPrograms, computeBindingDetail, runStartedViaApi } = await import("../orchestration/foe/foeGateApproval");
    const idr = await deriveRunApprovalIdentity(d, run, { viaApiHint: runStartedViaApi(run) });
    if (!idr.ok) return edgeError("gate_required", `${FOE_GATE_REQUIRED}(${idr.reason}): command step "${req.stepId}" not authorised.`, { reason: idr.reason });
    const pre = await edgeProgramPreFor(d, node, req.programChecks);
    const rows = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId));
    const ev = evaluateWithPrograms(rows, def, a.defHash, idr.identity, await computeBindingDetail(d, def, pre));
    if (!ev.ok) return edgeError("gate_required", `${FOE_GATE_REQUIRED}(${ev.reason}): command step "${req.stepId}" not authorised.`, { reason: ev.reason });
    const approval = { approvedBy: ev.approvals[0].approvedBy, gateStepId: ev.approvals[0].gateStepId };

    // ── 6b. I-2 — the ENGINE's policy (foeEngine.execCommand: `foe.command.<cmd>` on foe-run:<id> / machine:<id>), every mode,
    //    with the engine's context (the edge walker's user is the run owner from the package)
    {
      const { evaluateActionPolicy, secPlatformEnabled } = await import("../security/policyGate");
      if (secPlatformEnabled()) {
        const ownerRole = typeof run.startedBy === "number" && run.startedBy > 0 ? await roleOf(d, run.startedBy) : "system";
        const verdict = evaluateActionPolicy(
          `foe-run:${runId}`,
          `foe.command.${step.command}`,
          `machine:${step.machineId}`,
          { runId, workflowRef: def.ref, stepId: step.id, stepType: step.type, command: step.command, machineId: step.machineId, role: ownerRole, startedBy: run.startedBy ?? 0, attempt: req.attempt },
          { requestId: idemKey },
        );
        if (!verdict.allow) return edgeError("device_refused", `Step "${req.stepId}": ${policyRefusal(verdict)}${verdict.policyId ? ` (policy ${verdict.policyId})` : ""}.`, { gate: "policy" });
      }
    }

    // ── 7 + 8. device gates, mode ──
    const g = rb.kind === "robot" ? await robotGates(d, rb, approval.approvedBy, owner.ownerEpoch) : await otGates(d, rb, owner.ownerEpoch);
    if ("gate" in g) return edgeError("device_refused", `Step "${req.stepId}": ${g.detail}.`, { gate: g.gate });

    // ── 9. one transaction ──
    const ttlMs = clampEdgeAuthTtlMs(process.env.EDGE_AUTH_TTL_MS);
    const issuedAt = new Date(Math.floor(Date.now()));
    const jti = randomUUID();
    const nonceHash = sha256Hex(req.reqNonce);
    const claims: Record<string, unknown> = {
      typ: EDGE_TYP_NAME.auth,
      kid: signer.key.kid,
      jti,
      nodeId: node.nodeId,
      credentialId: node.credentialId,
      runId,
      claimSeq: req.claimSeq,
      stepId: req.stepId,
      attempt: req.attempt,
      idempotencyKey: idemKey,
      kind: rb.kind,
      target: g.target,
      payloadHash: rb.payloadHash,
      approval,
      mode: g.mode,
      verdicts: g.verdicts,
      safetyConfigIds: g.safetyConfigIds,
      reqNonce: req.reqNonce,
      iat: issuedAt.getTime(),
      ttlMs,
    };
    if (!edgeAuthClaimsSchema.safeParse(claims).success) throw new Error("authorize: central built invalid claims");
    const out = await insertOrReplay(d, node, signer, runId, req, tokenHash, nonceHash, claims, rb, issuedAt, ttlMs, approval, run.startedBy ?? null);
    if (out.http === 200 && !out.replayed) {
      await auditNode(node, "EDGE_STEP_AUTHORIZED", { type: "orchestration_run", id: runId }, { jti, claimSeq: req.claimSeq, stepId: req.stepId, attempt: req.attempt, kind: rb.kind, payloadHash: rb.payloadHash, approvedBy: approval.approvedBy, mode: g.mode });
    }
    return out.answer;
  } catch (err) {
    if (err instanceof Answer) return err.answer;
    if (!isEdgeUnavailableError(err)) console.error(`[EdgeAuthorize] run ${runId} node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailable;
  }
}

async function insertOrReplay(
  d: Db,
  node: EdgeNodePrincipal,
  signer: CentralSigner,
  runId: number,
  req: EdgeAuthorizeRequest,
  tokenHash: string,
  nonceHash: string,
  claims: Record<string, unknown>,
  rb: RebuiltCommand,
  issuedAt: Date,
  ttlMs: number,
  approval: { approvedBy: number; gateStepId: string },
  runOwner: number | null,
): Promise<{ http: number; replayed: boolean; answer: EdgeAnswer<EdgeAuthorizeAnswer> }> {
  const replayOf = (row: EdgeStepAuthorizationRow) => {
    // M-1 — a replay is re-signed only for the SAME node, credential and nonce
    if (row.edgeNodeId !== node.nodeId || row.credentialId !== node.credentialId || row.reqNonceHash !== nonceHash) throw new Answer(edgeError("already_authorized", `Step "${req.stepId}" attempt ${req.attempt} of this claim is already authorised.`));
    if (row.payloadHash !== req.payloadHash) throw new Answer(edgeError("payload_mismatch", `Step "${req.stepId}": the command differs from the one authorised.`));
    if (row.kid !== signer.key.kid) throw new Answer(edgeError("already_authorized", `Step "${req.stepId}" attempt ${req.attempt} was authorised under a key no longer in use — use the next attempt.`));
    return { http: 200, replayed: true, answer: { http: 200, data: signClaims(signer, claimsFromRow(row, req.reqNonce), node) } };
  };
  const find = async (x: Db) =>
    (
      await x
        .select()
        .from(edgeStepAuthorizations)
        .where(and(eq(edgeStepAuthorizations.runId, runId), eq(edgeStepAuthorizations.claimSeq, req.claimSeq), eq(edgeStepAuthorizations.stepId, req.stepId), eq(edgeStepAuthorizations.attempt, req.attempt)))
        .limit(1)
    )[0] as EdgeStepAuthorizationRow | undefined;
  try {
    return await d.transaction(async (tx) => {
      const [a] = (await tx.select().from(runEdgeAssignments).where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.edgeNodeId, node.nodeId))).for("update").limit(1)) as RunEdgeAssignment[];
      if (!a) throw new Answer(runNotFound(runId));
      if (a.claimSeq !== req.claimSeq || !sameDigest(tokenHash, a.claimTokenHash)) throw new Answer(edgeError("claim_stale", `Run ${runId}: this claim is no longer current — stop walking it.`, { abortRequested: false }));
      const existing = await find(tx as unknown as Db);
      if (existing) return replayOf(existing);
      const { orchestrationActionId } = await import("../orchestration/foe/foeStepClass");
      const { FOE_ENGINE_TOOL, withOtPayloadHash, withFoeGateApproval } = await import("../ot/otActionBinding");
      const actionId = orchestrationActionId(req.idempotencyKey);
      const preview = { ...withFoeGateApproval(withOtPayloadHash(null, rb.payloadHash as string), { runId, runOwner, approvedBy: approval.approvedBy, gateStepId: approval.gateStepId }), __edge: { nodeId: node.nodeId, jti: claims.jti, claimSeq: req.claimSeq } };
      // M-7 — the inbox / audit row of this attempt left by an EARLIER claim (same run-step-attempt key) is replaced: the row
      // always names the authorisation in force
      const [prev] = await tx.select({ previewJson: aiPendingActions.previewJson, tool: aiPendingActions.tool }).from(aiPendingActions).where(eq(aiPendingActions.id, actionId)).limit(1);
      const prevEdge = ((prev?.previewJson ?? null) as { __edge?: { claimSeq?: unknown } } | null)?.__edge;
      if (prev && prev.tool === FOE_ENGINE_TOOL && typeof prevEdge?.claimSeq === "number" && prevEdge.claimSeq < req.claimSeq) {
        await tx.delete(aiPendingActions).where(eq(aiPendingActions.id, actionId));
      }
      await tx
        .insert(aiPendingActions)
        .values({
          id: actionId,
          tool: FOE_ENGINE_TOOL,
          argsJson: (rb.step.args ?? {}) as Record<string, unknown>,
          userId: approval.approvedBy,
          userRole: "foe_gate_approver",
          summary: `FOE orchestration (edge node ${node.nodeCode}): step ${req.stepId}`,
          previewJson: preview,
          status: "executed",
          executedAt: new Date(),
          idempotencyKey: actionId,
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .onConflictDoNothing();
      await tx.insert(edgeStepAuthorizations).values({
        jti: claims.jti as string,
        edgeNodeId: node.nodeId,
        credentialId: node.credentialId,
        runId,
        claimSeq: req.claimSeq,
        stepId: req.stepId,
        attempt: req.attempt,
        idempotencyKey: req.idempotencyKey,
        kind: rb.kind,
        payloadHash: rb.payloadHash as string,
        approvalJson: approval as unknown as Record<string, unknown>,
        verdictJson: { mode: claims.mode, verdicts: claims.verdicts, safetyConfigIds: claims.safetyConfigIds, target: claims.target },
        kid: signer.key.kid,
        reqNonceHash: nonceHash,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + ttlMs),
      });
      return { http: 200, replayed: false, answer: { http: 200, data: signClaims(signer, claims, node) } };
    });
  } catch (err) {
    if (err instanceof Answer) throw err;
    if (isUniqueViolation(err)) {
      // a concurrent request of the same attempt won the insert: answer as if it had been there first
      const existing = await find(d);
      if (existing) return replayOf(existing);
    }
    const { isEdgeControlRefusal } = await import("./edgeControlSchema");
    if (isEdgeControlRefusal(err)) throw new Answer(edgeError("claim_stale", `Run ${runId}: this claim is no longer current — stop walking it.`, { abortRequested: false }));
    throw err;
  }
}
