/**
 * Phase 3 — Robot command dispatcher: the SINGLE gated path to run a motion job.
 *
 * Mirrors the OT commandDispatcher safety model. NOT exported to tRPC as a
 * mutation — reachable only from an internal caller (an AI write-tool after HITL
 * confirm, or a server-side operator action). Gates, in order:
 *   1. idempotency (per key, terminal job returned as-is — no blind re-run),
 *   2. HITL: triggerKind='hitl' requires a confirmedBy user,
 *   3. active + connected driver,
 *   4. MODE GATE: ROBOT_CONTROL_ENABLED!=='true' → record status 'simulated',
 *      never call driver.runJob (default is dry-run),
 *   5. real run under timeout → record done/failed.
 * Every branch writes an append-only robot_jobs row.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { robotJobs } from "../../../drizzle/schema";
import { getActiveRobot } from "./robotManager";
import type { RobotJobSpec, RobotJobResult } from "./robotDriver";

export interface RobotDispatchInput {
  robotId: number;
  job: RobotJobSpec;
  triggerKind?: "hitl" | "manual";
  actionId?: string;
  requestedBy: number;
  confirmedBy?: number;
  idempotencyKey?: string;
}

export interface RobotDispatchResult {
  ok: boolean;
  status: "done" | "failed" | "simulated" | "rejected";
  jobId?: number;
  error?: string;
}

function controlEnabled(): boolean {
  return process.env.ROBOT_CONTROL_ENABLED === "true";
}

async function record(
  input: RobotDispatchInput,
  // "running" is accepted so an in-flight job can be recorded before it reaches a terminal
  // state; the completedAt guard below relies on it. Callers currently pass terminal statuses.
  status: RobotDispatchResult["status"] | "running",
  result?: Record<string, unknown>,
  errorText?: string,
): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  try {
    const now = new Date();
    const [row] = await db.insert(robotJobs).values({
      robotId: input.robotId,
      jobType: input.job.jobType,
      params: input.job.params,
      status,
      triggerKind: input.triggerKind ?? "hitl",
      actionId: input.actionId,
      requestedBy: input.requestedBy,
      confirmedBy: input.confirmedBy,
      idempotencyKey: input.idempotencyKey,
      result,
      errorText,
      startedAt: now,
      completedAt: status === "running" ? undefined : now,
    }).returning({ id: robotJobs.id });
    return row?.id;
  } catch (err) {
    console.error("[Robot] failed to record job:", (err as Error)?.message ?? err);
    return undefined;
  }
}

export async function dispatchRobotJob(input: RobotDispatchInput): Promise<RobotDispatchResult> {
  const triggerKind = input.triggerKind ?? "hitl";

  // 1) Idempotency — return a prior terminal job for the same key.
  if (input.idempotencyKey) {
    const db = await getDb();
    if (db) {
      const [prior] = await db.select().from(robotJobs)
        .where(eq(robotJobs.idempotencyKey, input.idempotencyKey)).limit(1);
      if (prior) {
        return { ok: prior.status === "done" || prior.status === "simulated", status: prior.status as RobotDispatchResult["status"], jobId: prior.id };
      }
    }
  }

  // 2) HITL gate.
  if (triggerKind === "hitl" && !input.confirmedBy) {
    const jobId = await record(input, "rejected", undefined, "HITL required: no confirmedBy");
    return { ok: false, status: "rejected", jobId, error: "HITL confirmation required" };
  }

  // 3) Active + connected driver.
  const robot = getActiveRobot(input.robotId);
  if (!robot || !robot.driver.isConnected()) {
    const jobId = await record(input, "rejected", undefined, "robot not active/connected");
    return { ok: false, status: "rejected", jobId, error: "robot not active/connected" };
  }

  // 4) MODE GATE — dry-run by default.
  if (!controlEnabled()) {
    const jobId = await record(input, "simulated", { dryRun: true });
    return { ok: true, status: "simulated", jobId };
  }

  // 5) Real run under timeout.
  const timeoutMs = Math.max(1000, Number(process.env.ROBOT_CONTROL_TIMEOUT_MS) || 10_000);
  try {
    const result = await Promise.race<RobotJobResult>([
      robot.driver.runJob(input.job),
      new Promise<RobotJobResult>((_, rej) => setTimeout(() => rej(new Error("robot job timeout")), timeoutMs)),
    ]);
    const status = result.ok ? "done" : "failed";
    const jobId = await record(input, status, result.detail, result.error);
    return { ok: result.ok, status, jobId, error: result.error };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    const jobId = await record(input, "failed", undefined, msg);
    return { ok: false, status: "failed", jobId, error: msg };
  }
}
