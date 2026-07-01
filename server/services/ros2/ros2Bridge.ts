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
 *                   + append-only robot_jobs). ONLY when the dispatcher returns a real
 *                   (non-simulated) result does the bridge actually publish to ROS2. The
 *                   gate stays upstream; the bridge is merely the wire.
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
import { dispatchRobotJob, type RobotDispatchInput, type RobotDispatchResult } from "../robot/robotCommandDispatcher";

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
   * robotCommandDispatcher first; it applies idempotency + HITL + dry-run + authz +
   * append-only robot_jobs. The bridge publishes to ROS2 ONLY for a real (non dry-run)
   * result. In dry-run (ROBOT_CONTROL_ENABLED off) the dispatcher returns 'simulated'
   * and NOTHING is published — identical to the VDA5050 adapter's contract.
   */
  async dispatchToRos2(
    input: RobotDispatchInput,
    publishSpec: { topic: string; type: string; msg: Ros2Message },
  ): Promise<{ dispatch: RobotDispatchResult; published: boolean }> {
    const dispatch = await dispatchRobotJob(input);
    let published = false;
    // Only a real, successful dispatch (control enabled + HITL passed) may reach the wire.
    if (dispatch.ok && dispatch.status === "done") {
      if (!this.client.isConnected()) {
        return { dispatch, published: false };
      }
      this.client.publish(publishSpec.topic, publishSpec.type, publishSpec.msg);
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
