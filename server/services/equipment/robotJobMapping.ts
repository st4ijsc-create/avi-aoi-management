/**
 * doc 81 Đợt 1B final wave (item 2) — EquipmentCommand → RobotJobSpec, in ONE place.
 *
 * Both the robot route (equipmentAdapter.RobotEquipmentAdapter.sendCommand) and the producer of
 * the robot authorisation row (foeEngine.ensureOrchestrationAction, which hashes the job with
 * otActionBinding.robotPayloadHash) MUST map a command to the same job, or the hash the human
 * confirmed and the job the dispatcher verifies drift apart. Kept dependency-free (no dispatcher,
 * no registry) so foeEngine can import it without a module cycle.
 */
import type { RobotJobSpec, RobotJobType } from "../robot/robotDriver";

/** The subset of EquipmentCommand this mapping reads. */
export interface RobotCommandLike {
  name: string;
  job?: RobotJobSpec;
}

const ROBOT_VERBS: readonly RobotJobType[] = ["move", "pick_place", "dispense", "screw", "home", "abort", "custom"];

/**
 * doc 81 Đợt 1C Task 3 fix round 1 (ruling R-1C-c) — the STOP verbs. `e_stop` (CMD_ESTOP, whose docblock
 * already says "maps to the robot 'abort' job at the dispatcher boundary") and `stop` used to fall through
 * to `custom`, i.e. a MOTION job ⇒ HITL/confirmation, safety preflight, interlock, motion lock and the R14
 * slot all applied to an emergency stop. They are energy-REDUCING commands (L-7) and map to `abort`.
 */
const STOP_VERBS: ReadonlySet<string> = new Set(["abort", "e_stop", "stop"]);

/** A command's explicit job wins; a STOP verb is `abort`; a known verb maps 1:1; anything else is `custom` with empty params. */
export function toRobotJob(command: RobotCommandLike): RobotJobSpec {
  if (command.job) return command.job;
  const jobType: RobotJobType = STOP_VERBS.has(command.name)
    ? "abort"
    : ROBOT_VERBS.includes(command.name as RobotJobType)
      ? (command.name as RobotJobType)
      : "custom";
  return { jobType, params: {} };
}
