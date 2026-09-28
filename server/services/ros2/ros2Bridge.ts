/**
 * Doc 20 §3/§5 (I3a-2) — ROS2 ↔ platform BRIDGE via rosbridge WebSocket.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The bridge is a TRANSPORT that connects a ROS2 stack (through `rosbridge_server`) to
 * the platform in BOTH directions:
 *
 *   TELEMETRY IN  : subscribe configured ROS2 topics (/joint_states, /tf, /odom, …) →
 *                   normalizeRos2Message → telemetryBus.ingestTelemetry (the ONE unified
 *                   ingest path → ot_telemetry + `telemetry:sample` broadcast). Reuses the
 *                   X1/UDM fields where they map (joint positions, pose).
 *
 *   COMMANDS OUT  : platform commands DO NOT get a new control path. `dispatchToRos2` runs
 *                   the EXISTING robotCommandDispatcher (idempotency + HITL + dry-run gate
 *                   + append-only robot_jobs). The gate stays upstream; the bridge is merely
 *                   the wire. doc 81 Đợt 1C final wave 3 (ruling R-1C-j): the wire payload is
 *                   built ONLY from the bound job — a MOTION publishes `job.params.ros2`
 *                   (part of the hashed payload the dispatcher verifies) as the dispatcher's
 *                   motionActuator, i.e. INSTEAD of driver.runJob (one job, one channel); a
 *                   STOP goes to the driver (abort) and the bridge adds the FIXED stop message
 *                   ROS2_STOP_MESSAGE. A caller-supplied publishSpec is never published.
 *
 * HONEST: needs rosbridge_server + ROS2 running (doc 20 §7). Unreachable → connect()
 * rejects, the bridge stays down, and startRos2Bridge logs it (connects nothing). No
 * telemetry or command is ever fabricated.
 *
 * Flag: ROS2_BRIDGE_ENABLED (default OFF) gates the lifecycle; ROSBRIDGE_URL is the WS.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { RosbridgeClient, type RosbridgeOptions, type Ros2Message } from "./rosbridgeClient";
import { normalizeRos2Message } from "./ros2Mapping";
import { ingestTelemetry, type CanonicalSample } from "../telemetryBus";
import { dispatchRobotJob, isMotionJob, type RobotDispatchInput, type RobotDispatchResult } from "../robot/robotCommandDispatcher";
import { ensureBoundRobotAction } from "../robot/robotAutomationAction"; // doc 81 Đợt 1C Task 3
import type { RobotJobSpec } from "../robot/robotDriver";

export function ros2BridgeEnabled(): boolean {
  return process.env.ROS2_BRIDGE_ENABLED === "true" || process.env.ROS2_BRIDGE_ENABLED === "1";
}

export function rosbridgeUrlFromEnv(): string | null {
  const url = process.env.ROSBRIDGE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

/** A topic the bridge subscribes for telemetry ingest. */
export interface Ros2TopicSub {
  topic: string;
  /** ROS2 message type (e.g. "sensor_msgs/msg/JointState") — helps normalization. */
  type?: string;
  /** deviceId used in the CanonicalSample (defaults to the topic). */
  deviceId?: string;
}

export interface Ros2BridgeConfig extends Omit<RosbridgeOptions, "url"> {
  url: string;
  /** Topics to subscribe for telemetry (default: /joint_states + /odom + /tf). */
  telemetryTopics?: Ros2TopicSub[];
  /** Ingest sink (injectable for tests). Default: telemetryBus.ingestTelemetry. */
  ingest?: (samples: CanonicalSample[]) => Promise<number>;
}

/**
 * doc 81 Đợt 1C final wave 3 (R-1C-j) — the ONLY message the bridge publishes for a STOP: a zero
 * geometry_msgs/Twist on /cmd_vel (REP-103 velocity command; all zero ⇒ stand still). Fixed server-side,
 * never taken from a caller.
 */
export const ROS2_STOP_MESSAGE: Readonly<{ topic: string; type: string; msg: Ros2Message }> = Object.freeze({
  topic: "/cmd_vel",
  type: "geometry_msgs/msg/Twist",
  msg: { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } },
});

/** Refusal: a MOTION job carries no `params.ros2 = { topic, type, msg }` — nothing bound to publish. */
export const ROS2_JOB_MESSAGE_REQUIRED = "ROS2_JOB_MESSAGE_REQUIRED" as const;

/**
 * R-1C-j — the ROS2 message of a MOTION job, read ONLY from the job's own params (`params.ros2`), which
 * robotPayloadHash covers — so a bound, single-use HITL action binds exactly what goes on the wire.
 * Null when absent/malformed.
 */
export function ros2MessageFromJob(job: RobotJobSpec): { topic: string; type: string; msg: Ros2Message } | null {
  const spec = (job.params as Record<string, unknown> | undefined)?.ros2 as Record<string, unknown> | undefined;
  if (!spec || typeof spec !== "object") return null;
  const { topic, type, msg } = spec;
  if (typeof topic !== "string" || !topic.startsWith("/") || typeof type !== "string" || !type) return null;
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  return { topic, type, msg: msg as Ros2Message };
}

let warnedPublishSpecIgnored = false;

const DEFAULT_TOPICS: Ros2TopicSub[] = [
  { topic: "/joint_states", type: "sensor_msgs/msg/JointState" },
  { topic: "/odom", type: "nav_msgs/msg/Odometry" },
  { topic: "/tf", type: "tf2_msgs/msg/TFMessage" },
];

export class Ros2Bridge {
  private client: RosbridgeClient;
  private readonly topics: Ros2TopicSub[];
  private readonly ingest: (samples: CanonicalSample[]) => Promise<number>;
  private started = false;

  constructor(private readonly cfg: Ros2BridgeConfig) {
    this.client = new RosbridgeClient({ url: cfg.url, timeoutMs: cfg.timeoutMs, wsFactory: cfg.wsFactory });
    this.topics = cfg.telemetryTopics ?? DEFAULT_TOPICS;
    this.ingest = cfg.ingest ?? ingestTelemetry;
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  getLastError(): string | undefined {
    return this.client.getLastError();
  }

  status(): { connected: boolean; started: boolean; topics: string[]; lastError?: string } {
    return {
      connected: this.client.isConnected(),
      started: this.started,
      topics: this.topics.map((t) => t.topic),
      lastError: this.client.getLastError(),
    };
  }

  /** Connect + subscribe telemetry topics. Rejects (honest) when rosbridge is unreachable. */
  async start(): Promise<void> {
    await this.client.connect();
    for (const sub of this.topics) {
      const deviceId = sub.deviceId ?? sub.topic;
      this.client.subscribe(sub.topic, sub.type, (topic, msg) => {
        void this.onTelemetry(deviceId, topic, msg, sub.type);
      });
    }
    this.started = true;
  }

  private async onTelemetry(deviceId: string, topic: string, msg: Ros2Message, type?: string): Promise<void> {
    try {
      const samples = normalizeRos2Message(deviceId, topic, msg, type);
      if (samples.length > 0) await this.ingest(samples);
    } catch (err) {
      console.error("[ROS2] telemetry ingest failed:", (err as Error)?.message ?? err);
    }
  }

  /**
   * Send a platform command to ROS2 — but ONLY through the existing gate. We run the
   * robotCommandDispatcher; it applies idempotency + HITL + dry-run + authz + append-only
   * robot_jobs. In dry-run (ROBOT_CONTROL_ENABLED off) the dispatcher returns 'simulated'
   * and NOTHING is published — identical to the VDA5050 adapter's contract.
   *
   * doc 81 Đợt 1C final wave 3 (ruling R-1C-j, final review I4):
   *   • MOTION — the message is `ros2MessageFromJob(job)` (the bound job's own params), published by the
   *     dispatcher's motionActuator at the point driver.runJob would run — the driver is NOT called, so the
   *     bridge and the driver can never both move the robot for one job. No `params.ros2` ⇒ refused
   *     ROS2_JOB_MESSAGE_REQUIRED before any dispatch.
   *   • STOP — the driver gets the abort (as before); on the real path the bridge adds ROS2_STOP_MESSAGE.
   *   • `_publishSpec` (legacy parameter) is IGNORED — never published, whatever it holds.
   */
  async dispatchToRos2(
    input: RobotDispatchInput,
    _publishSpec?: unknown,
  ): Promise<{ dispatch: RobotDispatchResult; published: boolean }> {
    if (_publishSpec !== undefined && !warnedPublishSpecIgnored) {
      warnedPublishSpecIgnored = true;
      console.warn("[ROS2] dispatchToRos2: a caller-supplied publishSpec is ignored — messages come only from the bound job (R-1C-j)");
    }
    const motion = isMotionJob(input.job);
    if (motion && !ros2MessageFromJob(input.job)) {
      return {
        dispatch: { ok: false, status: "rejected", error: ROS2_JOB_MESSAGE_REQUIRED },
        published: false,
      };
    }
    // doc 81 Đợt 1C Task 3 — the bridge is an AUTOMATED producer: a 'hitl' input (the default)
    // without an actionId gets a 'confirmed' ai_pending_actions row bound (robotPayloadHash) to
    // exactly input.job first (FOE pattern), owned by input.confirmedBy. Not created ⇒ no actionId
    // ⇒ the dispatcher refuses (HITL_ACTION_REQUIRED) and nothing is published. 'manual' (an
    // operator's own action, R11) and a caller-supplied actionId pass through untouched.
    // Fix round 1 (item 2): a STOP (non-motion job) gets NO row — it needs none (dispatcher R-1C-c) and
    // must never depend on one (a colliding key could turn it into ACTION_BINDING_MISMATCH).
    let dispatchInput = input;
    if ((input.triggerKind ?? "hitl") === "hitl" && !input.actionId && motion) {
      const actionId = await ensureBoundRobotAction({
        tool: "ros2.automation",
        robotId: input.robotId,
        job: input.job,
        ownerUserId: input.confirmedBy,
        idempotencyKey: input.idempotencyKey,
      });
      dispatchInput = { ...input, triggerKind: "hitl", ...(actionId ? { actionId } : {}) };
    }
    let published = false;
    if (motion) {
      const dispatch = await dispatchRobotJob(dispatchInput, {
        // The job handed back here is the one the dispatcher gated and (for 'hitl') hash-verified.
        motionActuator: async (job) => {
          const m = ros2MessageFromJob(job);
          if (!m) return { ok: false, status: "failed", error: ROS2_JOB_MESSAGE_REQUIRED };
          if (!this.client.isConnected()) return { ok: false, status: "failed", error: "rosbridge not connected — nothing published" };
          this.client.publish(m.topic, m.type, m.msg);
          published = true;
          return { ok: true, status: "done", detail: { channel: "ros2", topic: m.topic } };
        },
      });
      return { dispatch, published };
    }
    const dispatch = await dispatchRobotJob(dispatchInput);
    // STOP — the real path was reached (done / failed at the driver): add the fixed stop message.
    if ((dispatch.status === "done" || dispatch.status === "failed") && this.client.isConnected()) {
      this.client.publish(ROS2_STOP_MESSAGE.topic, ROS2_STOP_MESSAGE.type, ROS2_STOP_MESSAGE.msg);
      published = true;
    }
    return { dispatch, published };
  }

  async stop(): Promise<void> {
    await this.client.close();
    this.started = false;
  }
}

// ── Lifecycle (singleton, mirrors vda5050Manager) ────────────────────────────
let bridge: Ros2Bridge | null = null;

/**
 * Start the ROS2 bridge if ROS2_BRIDGE_ENABLED + ROSBRIDGE_URL are set. No-op otherwise.
 * HONEST: a connect failure is logged and the bridge stays null (connects nothing).
 * Returns the running bridge or null.
 */
export async function startRos2Bridge(): Promise<Ros2Bridge | null> {
  if (bridge) return bridge;
  if (!ros2BridgeEnabled()) {
    console.log("[ROS2] bridge disabled (set ROS2_BRIDGE_ENABLED=true to enable)");
    return null;
  }
  const url = rosbridgeUrlFromEnv();
  if (!url) {
    console.warn("[ROS2] ROS2_BRIDGE_ENABLED but ROSBRIDGE_URL is empty — not starting");
    return null;
  }
  const b = new Ros2Bridge({ url });
  try {
    await b.start();
    bridge = b;
    console.log(`[ROS2] bridge connected to ${url} (${b.status().topics.length} topic subscription(s))`);
    return bridge;
  } catch (err) {
    // HONEST: rosbridge unreachable → nothing connects; do not crash the process.
    console.warn(`[ROS2] bridge not started: ${(err as Error)?.message ?? err}`);
    try { await b.stop(); } catch { /* ignore */ }
    return null;
  }
}

export async function stopRos2Bridge(): Promise<void> {
  if (bridge) {
    await bridge.stop();
    bridge = null;
  }
}

export function getRos2Bridge(): Ros2Bridge | null {
  return bridge;
}
