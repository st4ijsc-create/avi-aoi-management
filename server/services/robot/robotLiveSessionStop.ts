/**
 * doc 81 Đợt 10 task D fix review 4 — ruling R-10-av (L-7). A console STOP for a robot this process holds a LIVE in-memory session
 * for is SENT FIRST, with ZERO database reads before it: the canonical abort goes straight to the session's driver (the same device
 * stage as the dispatcher's, robotDeviceRun.runRobotDeviceStage, bounded by ROBOT_CONTROL_TIMEOUT_MS). Only AFTER the send is its
 * ledger row written — best-effort, under the STOP DB bound (robotCommandDispatcher.recordLiveSessionStop). A hung or dead DB
 * therefore never delays or blocks the STOP of an attached robot.
 *   • dry-run (ROBOT_CONTROL_ENABLED off) ⇒ null: the dispatcher's existing simulated path (nothing is sent either way);
 *   • no session here ⇒ null: the caller's no-session path (owner + robot row, read in parallel under one bound — NF-2);
 *   • what this path does NOT consult before the send (all need the DB): idempotency replay, FIELD_V2 command authorization,
 *     commissioning ("known uncommissioned ⇒ simulated", R-1C-d), the policy seam. A STOP only removes energy; the operator has
 *     already passed actuationProcedure (role floor + 2FA) and machine_control:canEdit. Recorded on the row as `liveSessionStop`.
 * The driver itself clears its motion lock on a confirmed STOP (as on the dispatcher path).
 */
import { getActiveRobot } from "./robotManager";
import { runRobotDeviceStage } from "./robotDeviceRun";
import type { RobotDispatchResult } from "./robotCommandDispatcher";

export async function sendLiveSessionStopFirst(a: { robotId: number; requestedBy: number; idempotencyKey?: string; command: string }): Promise<RobotDispatchResult | null> {
  const robot = getActiveRobot(a.robotId);
  if (!robot) return null;
  if (process.env.ROBOT_CONTROL_ENABLED !== "true") return null; // == isRobotControlEnabled() (no import of the dispatcher before the send)
  const timeoutMs = Math.max(1000, Number(process.env.ROBOT_CONTROL_TIMEOUT_MS) || 10_000);
  const job = { jobType: "abort" as const, params: {} };
  const sentAt = new Date().toISOString();
  const stage = await runRobotDeviceStage({ robotId: a.robotId, driver: robot.driver, job, motion: false, timeoutMs });
  // the ledger AFTER the send (bounded, best-effort) — the dispatcher owns the robot_jobs row shape
  try {
    const { recordLiveSessionStop } = await import("./robotCommandDispatcher");
    return await recordLiveSessionStop(
      { robotId: a.robotId, job, triggerKind: "manual", requestedBy: a.requestedBy, confirmedBy: a.requestedBy, idempotencyKey: a.idempotencyKey },
      stage,
      { liveSessionStop: { ruling: "R-10-av", sentAt, command: a.command } },
    );
  } catch (err) {
    console.error(`[Robot] STOP on robot ${a.robotId} was SENT (${stage.status}) on the live session; its ledger row could not be written: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    return { ok: stage.status === "done", status: stage.status, error: stage.errorText, ledgerError: "LEDGER_WRITE_FAILED_AFTER_STOP", ...stage.driverOut };
  }
}
