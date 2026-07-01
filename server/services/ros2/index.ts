/**
 * Doc 20 §3/§5 (I3a-2) — ROS2 bridge public surface.
 *
 * A pure-JS ROS2↔platform bridge over `rosbridge_server` WebSocket (no native ROS2 dep).
 * Telemetry topics → telemetryBus; platform commands → the EXISTING robotCommandDispatcher
 * gate (never a new control path). Flag-gated (ROS2_BRIDGE_ENABLED, default OFF) + HONEST
 * (unreachable → clear error, connects nothing). See doc 20 §7 runbook.
 */
export { RosbridgeClient, type RosbridgeOptions, type Ros2Message, type Ros2MessageHandler } from "./rosbridgeClient";
export {
  normalizeRos2Message,
  mapJointStates,
  mapOdom,
  mapTf,
} from "./ros2Mapping";
export {
  Ros2Bridge,
  startRos2Bridge,
  stopRos2Bridge,
  getRos2Bridge,
  ros2BridgeEnabled,
  rosbridgeUrlFromEnv,
  type Ros2BridgeConfig,
  type Ros2TopicSub,
} from "./ros2Bridge";
