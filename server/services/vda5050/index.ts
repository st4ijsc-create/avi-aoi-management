/**
 * VDA 5050 (AGV/AMR fleet) connectivity framework — public entrypoint.
 *
 * VDA 5050 is the open MQTT-based standard for AGV ↔ master-control. This module
 * is an HONEST, flag-gated scaffold:
 *   - VDA5050_ENABLED (default OFF) gates the adapter manager lifecycle.
 *   - AGV commands (Order/InstantActions) ALWAYS route through the robot
 *     commandDispatcher → HITL + DRY-RUN unless ROBOT_CONTROL_ENABLED==="true".
 *     In dry-run we build the Order JSON but publish NOTHING to MQTT.
 *   - Field mapping + topic layout MUST be validated against a real AGV before
 *     going live.
 *
 * Importing this module registers the `vda5050` RobotDriver (side-effect via
 * vda5050Manager) and re-exports the lifecycle + helpers.
 */
export {
  startVda5050,
  stopVda5050,
  isVda5050Enabled,
  isVda5050Running,
  getAgvAdapter,
  listAgvAdapters,
  loadEnabledAgvs,
} from "./vda5050Manager";

export { Vda5050Adapter, resolveAgvRobot, agvConfigFromRobot } from "./vda5050Adapter";
export { Vda5050RobotDriver, createVda5050Driver, VDA5050_VENDOR } from "./vda5050Driver";
export {
  mapStateToRobotTelemetry,
  mapConnectionToOnline,
  buildOrder,
  jobToOrderNodes,
} from "./vda5050Mapping";
export * from "./vda5050Messages";
