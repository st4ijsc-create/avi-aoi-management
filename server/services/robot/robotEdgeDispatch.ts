/**
 * doc 81 Đợt 10 task D (design §2.9, §2.13, §2.14) — the EDGE front end of a robot job. No central DB: the robot's facts come
 * from the SIGNED config snapshot; central's decisions (approval, enabled, motion-lock rows / requests, commissioning, FIELD_V2,
 * policy, interlock, central kill switch) arrive as the SIGNED per-step authorisation.
 *
 * MOTION, in order (fail-closed — nothing reaches the robot unless every step passed):
 *   1. the robot must be in the snapshot (= owned by this node) and enabled there;
 *   2. VERIFY the authorisation for exactly this job (edgeAuthorizationVerifier: signature, node, credential, context, payload
 *      hash recomputed from the job about to be sent, signed target = robot + job type, TTL from the request send, nonce pending,
 *      jti unused) — a refusal is journaled as an anomaly;
 *   3. LOCAL GATES: the driver active + connected, its in-memory MOTION LOCK (the authority's source of truth, §2.11), journal
 *      admission, the safety-PLC preflight (snapshot configs), the MOTION SLOT (R14, robotDeviceRun);
 *   4. re-check the window, CONSUME the jti in the journal (durable BEFORE the driver call) — refused ⇒ nothing sent;
 *   5. mode: central's signed `mode` simulated, `verdicts.commissioned` false, or this edge's ROBOT_CONTROL off ⇒ simulated;
 *   6. the DEVICE STAGE shared with central (robotDeviceRun: one channel, deadline, lock-then-stop on an unknown outcome);
 *   7. REPORT one ledger record quoting the jti (central writes robot_jobs from it).
 * STOP (L-7): the canonical abort (caller params dropped, R-1C-m) goes straight to the driver — no authorisation, no verifier,
 * no consume, no lock / slot / safety gate, with or without a runtime. A robot the snapshot KNOWS is uncommissioned records it
 * `simulated` (R-1C-d); unknown ⇒ sent. The STOP is journaled after the send, bounded.
 */
import { CANONICAL_STOP_JOB, ROBOT_DISABLED_REASON_CODE, ROBOT_MOTION_IN_PROGRESS, ROBOT_NO_OT_ADAPTER_ID } from "./robotCommandDispatcher";
import { claimRobotMotionSlot, releaseRobotMotionSlot, runRobotDeviceStage } from "./robotDeviceRun";
import { getActiveRobot } from "./robotManager";
import { sessionQuiescing } from "./robotQuiesce"; // doc 81 Đợt 12 N fix 1 (R-12-d)
import { isStopJob } from "./stopJob";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";
import type { RobotJobSpec } from "./robotDriver";
import { withDeadline } from "../ot/drivers/boundedClose";
import { isRobotSafetyPreflightEnabled, safetyPreflightReason } from "../ot/safetyPreflightPolicy";
import { edgeAuthorizationStillValid, verifyEdgeStepAuthorization, type EdgeStepAuthorization } from "../edge/edgeAuthorizationVerifier";
import { edgeDeviceRuntime, envRobotControlEnabled, type EdgeDeviceRuntime } from "../edge/edgeDeviceRuntime";

/** Same bound as central's robot safety preflight. */
const EDGE_ROBOT_SAFETY_PREFLIGHT_DEADLINE_MS = 5000;

export interface EdgeRobotDispatchInput {
  robotId: number;
  job: RobotJobSpec;
  idempotencyKey: string;
  authorization?: EdgeStepAuthorization | null;
  run?: { runId: number; claimSeq: number; stepId: string; attempt: number } | null;
  source?: "command" | "anomaly" | "local";
  requestId?: number | null;
}

export interface EdgeRobotDispatchResult {
  ok: boolean;
  status: "done" | "failed" | "simulated" | "rejected";
  reason?: string;
  detail?: string;
  stop: boolean;
  jti?: string;
  error?: string;
  driverDetail?: Readonly<Record<string, unknown>>;
  result?: Record<string, unknown>;
}

const timeoutMs = () => Math.max(1000, Number(process.env.ROBOT_CONTROL_TIMEOUT_MS) || 10_000);
/** doc 81 Đợt 12 N fix 1 (R-12-d) — the robot's session is being taken down on this edge (quiesce): no motion. */
export const ROBOT_QUIESCING = "ROBOT_QUIESCING" as const;
const refusal = (reason: string, extra: Partial<EdgeRobotDispatchResult> = {}): EdgeRobotDispatchResult => ({ ok: false, status: "rejected", reason, stop: false, ...extra });

/** R-10-bn — `{ ownerEpoch }` of the robot in the verified config (absent when the config does not name it — central then refuses, as it must) */
function ownerEpochOf(rt: EdgeDeviceRuntime, robotId: number): { ownerEpoch?: number } {
  const e = rt.config()?.robots.find((r) => r.id === robotId)?.ownerEpoch;
  return typeof e === "number" ? { ownerEpoch: e } : {};
}

async function report(rt: EdgeDeviceRuntime | null, input: EdgeRobotDispatchInput, job: RobotJobSpec, stop: boolean, jti: string | null, res: EdgeRobotDispatchResult): Promise<void> {
  if (!rt) return;
  const at = Date.now();
  try {
    let p: Promise<unknown>;
    if (input.run) {
      p = rt.journal.appendRun(
        input.run.runId,
        input.run.claimSeq,
        {
          kind: "ledger",
          stepId: input.run.stepId,
          attempt: input.run.attempt,
          idempotencyKey: input.idempotencyKey,
          jti,
          stop,
          // fix review 8 (R-10-bn, F1-1) — the robot's owner epoch from the SIGNED config: central records a STOP ledger only
          // under the device's current epoch (a record without it is refused as stop_ledger_refused)
          ...ownerEpochOf(rt, input.robotId),
          target: { robotId: input.robotId, jobType: job.jobType as never },
          status: res.status,
          result: { ...(res.result ?? {}), ...(res.reason ? { reason: res.reason } : {}), ...(res.error ? { error: String(res.error).slice(0, 1000) } : {}) },
          at,
        },
        { stop },
      );
    } else if (stop) {
      p = rt.journal.appendEvent(
        { kind: "stop", target: { robotId: input.robotId }, source: input.source ?? "local", requestId: input.requestId ?? null, outcome: res.ok ? (res.status === "simulated" ? "simulated" : "sent") : "failed", at, detail: (res.reason ?? res.error ?? null)?.slice(0, 500) ?? null },
        { stop: true },
      );
    } else return;
    await (stop ? withDeadline(p, STOP_DB_STEP_DEADLINE_MS, "edge STOP journal") : p);
  } catch (err) {
    console.error(`[EdgeRobot] journal record of a ${stop ? "STOP" : "job"} on robot ${input.robotId} failed (the device outcome stands):`, (err as Error)?.message ?? err);
  }
}

/** Dispatch one robot job on the edge. Never throws for the expected refusals. */
export async function dispatchRobotOnEdge(input: EdgeRobotDispatchInput, rt: EdgeDeviceRuntime | null = edgeDeviceRuntime()): Promise<EdgeRobotDispatchResult> {
  const controlOn = () => (rt?.robotControlEnabled ?? envRobotControlEnabled)();

  // ── STOP (L-7): never asks; canonical job; straight to the driver. ──
  if (isStopJob(input.job)) {
    const job: RobotJobSpec = { jobType: CANONICAL_STOP_JOB.jobType, params: {} };
    const snap = rt?.config()?.robots.find((r) => r.id === input.robotId);
    const robot = getActiveRobot(input.robotId);
    let res: EdgeRobotDispatchResult;
    if (!controlOn() || snap?.commissioned === false) {
      res = { ok: true, status: "simulated", stop: true, result: { dryRun: true, ...(snap?.commissioned === false ? { notCommissioned: true } : {}) } };
    } else if (!robot) {
      res = { ok: false, status: "failed", reason: "ROBOT_NOT_ACTIVE", stop: true, error: "robot not active/connected" };
    } else {
      const stage = await runRobotDeviceStage({ robotId: input.robotId, driver: robot.driver, job, motion: false, timeoutMs: timeoutMs() });
      res = { ok: stage.status === "done", status: stage.status, stop: true, ...(stage.errorText ? { error: stage.errorText } : {}), ...stage.driverOut, ...(stage.detail ? { result: { ...stage.detail } } : {}) };
    }
    await report(rt, input, job, true, null, res);
    return res;
  }

  // ── MOTION: verify → local gates → consume → device → report. ──
  if (!rt) return refusal("EDGE_RUNTIME_UNAVAILABLE");
  const cfg = rt.config();
  if (!cfg) return refusal("CONFIG_UNKNOWN");
  const deps = rt.auth();
  if (!deps) return refusal("KEYSET_UNKNOWN");
  if (!input.authorization) return refusal("AUTHORIZATION_REQUIRED");
  if (!input.run) return refusal("RUN_CONTEXT_REQUIRED");
  const snap = cfg.robots.find((r) => r.id === input.robotId);
  if (!snap) return refusal("NOT_OWNED");
  if (snap.isEnabled !== true) return refusal(ROBOT_DISABLED_REASON_CODE);

  const verdict = verifyEdgeStepAuthorization(
    deps,
    input.authorization,
    { kind: "robot", robotId: input.robotId, jobType: input.job.jobType, params: input.job.params ?? null },
    (jti) => rt.journal.isJtiConsumed(jti),
  );
  if (!verdict.ok) {
    void Promise.resolve()
      .then(() =>
        rt.journal.appendEvent({ kind: "anomaly", code: "EDGE_AUTHORIZATION_REFUSED", runId: input.run?.runId ?? null, detail: `robot ${input.robotId}: authorisation refused (${verdict.reason}) for step ${input.run?.stepId}`, at: Date.now() }),
      )
      .catch(() => undefined);
    return refusal("AUTHORIZATION_INVALID", { detail: verdict.reason });
  }
  const a = input.authorization;
  if (a.runId !== input.run.runId || a.claimSeq !== input.run.claimSeq || a.stepId !== input.run.stepId || a.attempt !== input.run.attempt || a.idempotencyKey !== input.idempotencyKey) {
    return refusal("AUTHORIZATION_INVALID", { detail: "context_mismatch" });
  }

  const robot = getActiveRobot(input.robotId);
  if (!robot) return refusal("ROBOT_NOT_ACTIVE");
  // doc 81 Đợt 12 N fix 1 (I-1, R-12-d) — a session being taken down (left the node / settings changed) moves nothing more
  const quiesce = sessionQuiescing(robot.driver);
  if (quiesce) return refusal(ROBOT_QUIESCING, { detail: quiesce.why });
  const lock = robot.driver.getMotionLock?.();
  if (lock?.locked) return refusal("MOTION_LOCKED", { result: { motionLock: lock } });
  if (!robot.driver.isConnected()) return refusal("ROBOT_NOT_CONNECTED");
  if (rt.journal.admitNonStop && rt.journal.admitNonStop() !== true) return refusal("JOURNAL_FULL");
  const simulated = verdict.mode === "simulated" || verdict.claims.verdicts.commissioned !== true || !controlOn();
  if (!simulated && isRobotSafetyPreflightEnabled()) {
    let state = "UNKNOWN";
    let basis: string | undefined;
    try {
      const { createAdapterFacade } = await import("../ot/adapterFacade");
      const s = await withDeadline(
        createAdapterFacade({ adapterId: ROBOT_NO_OT_ADAPTER_ID, machineId: null, robotId: input.robotId }).getSafetyStatus({ forRealActuation: true }),
        EDGE_ROBOT_SAFETY_PREFLIGHT_DEADLINE_MS,
        "edge robot safety preflight",
      );
      state = s?.state ?? "UNKNOWN";
      basis = s?.basis;
    } catch {
      state = "UNKNOWN";
    }
    if (state !== "OK") return refusal(safetyPreflightReason(state, basis === "sim_only" ? "sim_only" : null));
  }

  // R14 — the slot is claimed synchronously right before the consume + send, released in finally.
  const claimSlot = !simulated;
  if (claimSlot) {
    const busy = claimRobotMotionSlot(input.robotId, input.job.jobType);
    if (busy) return refusal(ROBOT_MOTION_IN_PROGRESS, { result: { inFlight: busy } });
  }
  try {
    // R-12-d — the preflight above awaited: re-check the session (quiescing / replaced) and its lock right before the consume
    if (getActiveRobot(input.robotId) !== robot) return refusal("ROBOT_NOT_ACTIVE");
    const q2 = sessionQuiescing(robot.driver);
    if (q2) return refusal(ROBOT_QUIESCING, { detail: q2.why });
    const lock2 = robot.driver.getMotionLock?.();
    if (lock2?.locked) return refusal("MOTION_LOCKED", { result: { motionLock: lock2 } });
    if (!edgeAuthorizationStillValid(deps, verdict.expiresAtMonoMs)) return refusal("AUTHORIZATION_INVALID", { detail: "expired" });
    const consumed = await rt.journal.consumeAuthorization({ jti: verdict.claims.jti, runId: a.runId, claimSeq: a.claimSeq, stepId: a.stepId, attempt: a.attempt });
    if (!consumed.ok) return refusal("JOURNAL_CONSUME_FAILED", { detail: consumed.reason });
    const jti = verdict.claims.jti;
    let res: EdgeRobotDispatchResult;
    if (simulated) {
      res = { ok: true, status: "simulated", stop: false, jti, result: { dryRun: true, ...(verdict.claims.verdicts.commissioned !== true ? { notCommissioned: true } : {}) } };
    } else {
      const stage = await runRobotDeviceStage({ robotId: input.robotId, driver: robot.driver, job: input.job, motion: true, timeoutMs: timeoutMs() });
      res = { ok: stage.status === "done", status: stage.status, stop: false, jti, ...(stage.errorText ? { error: stage.errorText } : {}), ...stage.driverOut, ...(stage.detail ? { result: { ...stage.detail } } : {}) };
    }
    await report(rt, input, input.job, false, jti, res);
    return res;
  } finally {
    if (claimSlot) releaseRobotMotionSlot(input.robotId);
  }
}
