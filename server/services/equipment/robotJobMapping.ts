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

/** A command's explicit job wins; otherwise a known verb maps 1:1, anything else is `custom` with empty params. */
export function toRobotJob(command: RobotCommandLike): RobotJobSpec {
  if (command.job) return command.job;
  const jobType = ROBOT_VERBS.includes(command.name as RobotJobType)
    ? (command.name as RobotJobType)
    : command.name === "abort"
      ? "abort"
      : "custom";
  return { jobType, params: {} };
}
