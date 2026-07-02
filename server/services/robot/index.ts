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
// VDA 5050 (AGV/AMR) driver lives under services/vda5050 but registers here so a
// robots.vendor='vda5050' row is selectable through the SAME robot framework path
// (registry → robotManager → robotCommandDispatcher HITL/dry-run gate). The import
// is pure (messages/mapping only — no DB, no mqtt at import time). The standalone
// vda5050Manager also registers it; registration is idempotent (Map.set).
import { createVda5050Driver, VDA5050_VENDOR } from "../vda5050/vda5050Driver";

registerRobotDriver("sim", createSimRobotDriver);
registerRobotDriver("fanuc", createFanucDriver);
registerRobotDriver("mitsubishi", createMitsubishiRobotDriver);
registerRobotDriver("delta", createDeltaRobotDriver);
registerRobotDriver("techman", createTechmanDriver);
registerRobotDriver(VDA5050_VENDOR, createVda5050Driver);

export { startRobots, stopRobots, getActiveRobot } from "./robotManager";
export { dispatchRobotJob } from "./robotCommandDispatcher";
export { registerRobotDriver, createRobotDriver, listVendors } from "./driverRegistry";
