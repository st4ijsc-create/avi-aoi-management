/**
 * Phase 3 — Robotics framework entrypoint. Registers vendor drivers (side-effect
 * on import) and re-exports the public surface.
 */
import { registerRobotDriver } from "./driverRegistry";
import { createSimRobotDriver } from "./drivers/simRobotDriver";
import { createFanucDriver } from "./drivers/fanucDriver";
import { createMitsubishiRobotDriver } from "./drivers/mitsubishiRobotDriver";
import { createDeltaRobotDriver } from "./drivers/deltaRobotDriver";
import { createTechmanDriver } from "./drivers/techmanDriver";

registerRobotDriver("sim", createSimRobotDriver);
registerRobotDriver("fanuc", createFanucDriver);
registerRobotDriver("mitsubishi", createMitsubishiRobotDriver);
registerRobotDriver("delta", createDeltaRobotDriver);
registerRobotDriver("techman", createTechmanDriver);

export { startRobots, stopRobots, getActiveRobot } from "./robotManager";
export { dispatchRobotJob } from "./robotCommandDispatcher";
export { registerRobotDriver, createRobotDriver, listVendors } from "./driverRegistry";
