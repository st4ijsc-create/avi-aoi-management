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
// doc 37 §6.2: fanuc (RMI) + mitsubishi (MELFA R3) + delta drivers are UNVERIFIED against
// vendor comms manuals (protocol shapes assumed). Delta's frame/port/checksum is fictional
// per the DRAStudio manual — treat as MOCK until the DRL/comms manual is added. All stay
// dry-run: real motion requires ROBOT_CONTROL_ENABLED=true (default OFF) + commissioning.
registerRobotDriver("fanuc", createFanucDriver);
registerRobotDriver("mitsubishi", createMitsubishiRobotDriver);
registerRobotDriver("delta", createDeltaRobotDriver); // MOCK — protocol not documented (doc 37 §6.2)
registerRobotDriver("techman", createTechmanDriver);
registerRobotDriver(VDA5050_VENDOR, createVda5050Driver);

export { startRobots, stopRobots, getActiveRobot } from "./robotManager";
export { dispatchRobotJob } from "./robotCommandDispatcher";
export { registerRobotDriver, createRobotDriver, listVendors } from "./driverRegistry";
