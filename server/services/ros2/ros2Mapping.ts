/**
 * Doc 20 §3/§5 (I3a-2) — ROS2 message → CanonicalSample normalization.
 *
 * Maps common ROS2 std/sensor/nav message shapes to the platform's unified telemetry
 * (telemetryBus.CanonicalSample). ROS2 has no telemetryProtocolEnum value, so we tag
 * protocol='other' + meta.source='ros2' + meta.topic — honest + needs no migration.
 * Where a field maps onto the X1 robot-telemetry UDM (joint positions, pose), we surface
 * it as a metric so it lands in the same ot_telemetry store as every other protocol.
 *
 * PURE — no I/O, unit-testable. Unknown/opaque messages fall back to a single JSON metric.
 */
import type { CanonicalSample } from "../telemetryBus";

const NS = "ros2";

function baseSample(deviceId: string, metric: string, value: CanonicalSample["value"], topic: string, extraMeta?: Record<string, unknown>): CanonicalSample {
  return {
    deviceId,
    protocol: "other",
    metric,
    value,
    meta: { source: NS, topic, ...(extraMeta ?? {}) },
  };
}

/** sensor_msgs/JointState → one numeric sample per named joint position (+ velocity/effort). */
export function mapJointStates(deviceId: string, topic: string, msg: Record<string, unknown>): CanonicalSample[] {
  const names = Array.isArray(msg.name) ? (msg.name as unknown[]).map(String) : [];
  const positions = Array.isArray(msg.position) ? (msg.position as unknown[]) : [];
  const velocities = Array.isArray(msg.velocity) ? (msg.velocity as unknown[]) : [];
  const efforts = Array.isArray(msg.effort) ? (msg.effort as unknown[]) : [];
  const out: CanonicalSample[] = [];
  const n = Math.max(names.length, positions.length);
  for (let i = 0; i < n; i++) {
    const joint = names[i] ?? `joint_${i}`;
    const pos = Number(positions[i]);
    if (Number.isFinite(pos)) out.push(baseSample(deviceId, `joint.${joint}.position`, pos, topic, { unit: "rad" }));
    const vel = Number(velocities[i]);
    if (Number.isFinite(vel)) out.push(baseSample(deviceId, `joint.${joint}.velocity`, vel, topic));
    const eff = Number(efforts[i]);
    if (Number.isFinite(eff)) out.push(baseSample(deviceId, `joint.${joint}.effort`, eff, topic));
  }
  return out;
}

/** nav_msgs/Odometry → pose x/y/z + orientation quaternion + linear/angular twist. */
export function mapOdom(deviceId: string, topic: string, msg: Record<string, unknown>): CanonicalSample[] {
  const out: CanonicalSample[] = [];
  const pose = ((msg.pose as Record<string, unknown>)?.pose ?? {}) as Record<string, unknown>;
  const pos = (pose.position ?? {}) as Record<string, unknown>;
  const ori = (pose.orientation ?? {}) as Record<string, unknown>;
  for (const axis of ["x", "y", "z"] as const) {
    const v = Number(pos[axis]);
    if (Number.isFinite(v)) out.push(baseSample(deviceId, `odom.position.${axis}`, v, topic, { unit: "m" }));
  }
  for (const axis of ["x", "y", "z", "w"] as const) {
    const v = Number(ori[axis]);
    if (Number.isFinite(v)) out.push(baseSample(deviceId, `odom.orientation.${axis}`, v, topic));
  }
  const twist = ((msg.twist as Record<string, unknown>)?.twist ?? {}) as Record<string, unknown>;
  const lin = (twist.linear ?? {}) as Record<string, unknown>;
  const ang = (twist.angular ?? {}) as Record<string, unknown>;
  for (const axis of ["x", "y", "z"] as const) {
    const lv = Number(lin[axis]);
    if (Number.isFinite(lv)) out.push(baseSample(deviceId, `odom.twist.linear.${axis}`, lv, topic));
    const av = Number(ang[axis]);
    if (Number.isFinite(av)) out.push(baseSample(deviceId, `odom.twist.angular.${axis}`, av, topic));
  }
  return out;
}

/** geometry_msgs/TransformStamped[] (tf) → per-transform translation x/y/z. */
export function mapTf(deviceId: string, topic: string, msg: Record<string, unknown>): CanonicalSample[] {
  const transforms = Array.isArray(msg.transforms) ? (msg.transforms as Record<string, unknown>[]) : [];
  const out: CanonicalSample[] = [];
  for (const t of transforms) {
    const child = String((t as Record<string, unknown>).child_frame_id ?? "frame");
    const tr = (((t.transform as Record<string, unknown>)?.translation) ?? {}) as Record<string, unknown>;
    for (const axis of ["x", "y", "z"] as const) {
      const v = Number(tr[axis]);
      if (Number.isFinite(v)) out.push(baseSample(deviceId, `tf.${child}.${axis}`, v, topic, { unit: "m" }));
    }
  }
  return out;
}

/**
 * Normalize a single ROS2 message (chosen by topic + optional declared type) into
 * CanonicalSamples for the telemetry bus. Recognises joint_states / odom / tf by topic
 * suffix or message type; everything else becomes one JSON metric (honest passthrough).
 */
export function normalizeRos2Message(
  deviceId: string,
  topic: string,
  msg: Record<string, unknown>,
  type?: string,
): CanonicalSample[] {
  const t = topic.toLowerCase();
  const ty = (type ?? "").toLowerCase();
  if (ty.includes("jointstate") || t.endsWith("/joint_states")) return mapJointStates(deviceId, topic, msg);
  if (ty.includes("odometry") || t.endsWith("/odom")) return mapOdom(deviceId, topic, msg);
  if (ty.includes("tfmessage") || t.endsWith("/tf") || t.endsWith("/tf_static")) return mapTf(deviceId, topic, msg);
  // Unknown shape → one opaque JSON sample (never dropped, never fabricated).
  return [baseSample(deviceId, topic.replace(/^\//, "").replace(/\//g, "."), JSON.stringify(msg), topic, { raw: true })];
}
