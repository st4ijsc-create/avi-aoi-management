/**
 * doc 81 Đợt 1C residual round 2 (ruling R-1C-m, layer b) — the ONE "is this job a STOP?" classifier.
 *
 * Imported by the dispatcher (isMotionJob), every robot driver's runJob, the MotionLock / AbortFence in
 * robotDriver.ts, and the VDA 5050 driver. Before this module each place had its own copy: the dispatcher
 * accepted abort/stop/e_stop (trimmed, any case) while MELFA, Delta, FANUC, Techman, UR and the motion lock
 * matched only the exact string "abort" — so, without the dispatcher's canonicalisation (layer a),
 * `run_job {jobType:"stop"|"e_stop"|"ABORT", params:{joints}}` reached a driver as MOTION.
 *
 * Direction of failure: anything not recognised is NOT a stop (⇒ motion, fully gated). Dependency-free
 * (type-only import) so robotDriver.ts can use it without a module cycle.
 */
import type { RobotJobSpec } from "./robotDriver";

/** Job types that are a STOP (energy-reducing), compared trimmed and case-insensitive. */
export const STOP_JOB_TYPES: ReadonlySet<string> = new Set(["abort", "stop", "e_stop"]);

export function isStopJobType(jobType: unknown): boolean {
  return typeof jobType === "string" && STOP_JOB_TYPES.has(jobType.trim().toLowerCase());
}

export function isStopJob(job: Pick<RobotJobSpec, "jobType"> | null | undefined): boolean {
  return !!job && isStopJobType(job.jobType);
}

/**
 * What a driver executes for a job: a STOP (any spelling, any params) becomes the canonical
 * `{ jobType: "abort", params: {} }` — the driver then takes its OWN fixed stop primitive and no caller
 * parameter can reach the wire. A motion job is returned unchanged.
 */
export function driverJob(job: RobotJobSpec): RobotJobSpec {
  return isStopJob(job) ? { jobType: "abort", params: {} } : job;
}
