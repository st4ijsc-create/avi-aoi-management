/**
 * doc 81 Đợt 10 task D (design §2.14) — the DEVICE STAGE of a robot job, extracted VERBATIM from robotCommandDispatcher so the
 * central dispatcher and the edge front end (robotEdgeDispatch.ts) drive a robot through ONE implementation:
 *   • the per-robot MOTION SLOT (ruling R14 — one motion per robot in this process, refused not queued; a STOP never claims it);
 *   • the timeout race of ONE job on ONE channel (the motion actuator OR the driver, never both — R-1C-j);
 *   • on a MOTION whose outcome is unknown (our deadline, or a driver reply timeout / dropped link): lockMotion FIRST, then the
 *     driver's stop (stopAfterUnknownOutcome — never through any gate), bounded.
 * No gate, no ledger, no DB here: the callers decide (central: robot_jobs; edge: journal) — byte-identical behaviour for central.
 */
import type { RobotDriver, RobotJobResult, RobotJobSpec } from "./robotDriver";
import { DISPATCH_DEADLINE_REASON_CODE, MOTION_OUTCOME_UNKNOWN_REASON_CODES, RobotAbortUnsupportedError } from "./robotDriver";
import { withDeadline } from "../ot/drivers/boundedClose";

/**
 * Ruling R14 — PER-ROBOT MOTION SERIALISATION (this process). See robotCommandDispatcher (step 5-R14): claimed SYNCHRONOUSLY
 * right before the real-motion path starts, released by the caller's try/finally once its terminal write is done.
 */
const motionInFlight = new Map<number, { jobType: string; since: string }>();

/** Snapshot of the in-flight motion on `robotId` (null when idle) — observability + tests. */
export function robotMotionInFlight(robotId: number): { jobType: string; since: string } | null {
  return motionInFlight.get(robotId) ?? null;
}

/**
 * Claim the motion slot of `robotId` SYNCHRONOUSLY (no await between check and set). Returns the in-flight motion when the slot
 * is taken (nothing claimed — the caller refuses ROBOT_MOTION_IN_PROGRESS), or null when it is now claimed by this caller.
 */
export function claimRobotMotionSlot(robotId: number, jobType: string): { jobType: string; since: string } | null {
  const busy = motionInFlight.get(robotId);
  if (busy) return busy;
  motionInFlight.set(robotId, { jobType, since: new Date().toISOString() });
  return null;
}

/** Release the slot claimed by claimRobotMotionSlot (call from the caller's finally). */
export function releaseRobotMotionSlot(robotId: number): void {
  motionInFlight.delete(robotId);
}

export type AbortOutcome =
  | { abort: "abort_sent" }
  | { abort: "abort_failed"; abortError: string }
  | { abort: "abort_unsupported"; abortError: string };

/**
 * doc 81 Đợt 1B Task 5 (BE2 §3 S5) — stop a motion whose outcome is unknown. Goes straight to the driver's stop (NOT through
 * the gates: a stop must never be blocked by them), bounded by `deadlineMs`. Never throws.
 */
export async function stopAfterUnknownOutcome(driver: RobotDriver, deadlineMs: number): Promise<AbortOutcome> {
  if (typeof (driver as Partial<RobotDriver>).abort !== "function") {
    return { abort: "abort_unsupported", abortError: `${driver.vendor} driver has no abort()` };
  }
  try {
    await withDeadline(driver.abort(), deadlineMs, `${driver.vendor} abort`);
    return { abort: "abort_sent" };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (err instanceof RobotAbortUnsupportedError) return { abort: "abort_unsupported", abortError: msg };
    return { abort: "abort_failed", abortError: msg };
  }
}

/** What the device stage observed for one job (the caller merges its own notes and writes its ledger). */
export interface RobotDeviceRunOutcome {
  status: "done" | "failed";
  detail: Record<string, unknown> | undefined;
  errorText: string | undefined;
  /** the driver's OWN result detail, untouched (B1); empty when the driver returned no detail */
  driverOut: { driverDetail?: Readonly<Record<string, unknown>> };
}

/**
 * Run ONE job on the device under `timeoutMs` (extracted from runRealJob, unchanged): one channel per job (the motion actuator
 * for motion when given, else the driver; a STOP always takes the driver); a MOTION with an unknown outcome is locked and then
 * stopped before this returns. Never throws for a driver error / timeout (they are the outcome).
 */
export async function runRobotDeviceStage(a: {
  robotId: number;
  driver: RobotDriver;
  job: RobotJobSpec;
  motion: boolean;
  timeoutMs: number;
  motionActuator?: (job: RobotJobSpec) => Promise<RobotJobResult>;
}): Promise<RobotDeviceRunOutcome> {
  const { driver, job, motion, timeoutMs, motionActuator } = a;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const outcome = await Promise.race([
    // R-1C-j — exactly ONE channel per job: the motion actuator (ROS2 bridge) OR the driver, never both;
    // a STOP always takes the driver (the actuator is only ever passed for motion).
    (motion && motionActuator ? motionActuator(job) : driver.runJob(job)).then(
      (r) => ({ kind: "result" as const, r }),
      (e: unknown) => ({ kind: "error" as const, e }),
    ),
    deadline,
  ]);
  clearTimeout(timer);

  let status: "done" | "failed";
  let detail: Record<string, unknown> | undefined;
  let errorText: string | undefined;
  // B1 — the driver's own detail, before the dispatcher merges its notes into `detail`.
  const driverOut = outcome.kind === "result" && outcome.r.detail ? { driverDetail: { ...outcome.r.detail } } : {};
  if (outcome.kind === "result") {
    status = outcome.r.ok ? "done" : "failed";
    detail = outcome.r.detail;
    errorText = outcome.r.error;
  } else if (outcome.kind === "error") {
    status = "failed";
    errorText = (outcome.e as Error)?.message ?? String(outcome.e);
  } else {
    status = "failed";
    detail = { timeout: true, timeoutMs, reasonCode: DISPATCH_DEADLINE_REASON_CODE };
    errorText = `robot job timeout after ${timeoutMs}ms`;
  }

  const reasonCode = typeof detail?.reasonCode === "string" ? detail.reasonCode : undefined;
  const outcomeUnknown =
    outcome.kind === "timeout" ||
    (status === "failed" && reasonCode != null && MOTION_OUTCOME_UNKNOWN_REASON_CODES.has(reasonCode));
  if (motion && outcomeUnknown) {
    // Fix round 5 (c) — R13 "lock on outcome-unknown" applied directly: lock the driver BEFORE the
    // stop goes out (the driver's own timer may not have fired yet when OUR deadline did). A
    // confirmed stop clears it again; a failed stop leaves it set. Drivers without a lock no-op.
    try {
      driver.lockMotion?.(reasonCode ?? DISPATCH_DEADLINE_REASON_CODE, errorText);
    } catch (err) {
      console.error(`[Robot] lockMotion failed for robot ${a.robotId} (stop still sent):`, (err as Error)?.message ?? err);
    }
    const stop = await stopAfterUnknownOutcome(driver, timeoutMs);
    detail = { ...(detail ?? {}), ...stop };
    errorText = `${errorText ?? "motion outcome unknown"} — ${stop.abort}${"abortError" in stop ? `: ${stop.abortError}` : ""}`;
  }
  return { status, detail, errorText, driverOut };
}
