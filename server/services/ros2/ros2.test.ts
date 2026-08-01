/**
 * I3a-2 — ROS2 rosbridge client + bridge tests (vitest). Mock-backed: a fake WebSocket
 * (EventEmitter, injected via wsFactory) plays the rosbridge server — no real ROS2 /
 * rosbridge / DB needed. Covers:
 *   1. connect + advertise/subscribe/publish round-trip (ops reach the server; an inbound
 *      publish reaches the subscription handler).
 *   2. telemetry from a ROS2 /joint_states message lands in the ingest path (normalized
 *      CanonicalSamples: joint.<name>.position, protocol='other', meta.source='ros2').
 *   3. call_service resolves on service_response.
 *   4. HONEST: connect to an "error" WS → rejects with a clear error.
 *   5. flag-off → startRos2Bridge no-op (returns null, connects nothing).
 *   6. ros2Mapping unit: normalizeRos2Message for joint_states / odom.
 */
import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RosbridgeClient } from "./rosbridgeClient";
import { Ros2Bridge, startRos2Bridge, ros2BridgeEnabled } from "./ros2Bridge";
import { normalizeRos2Message, mapJointStates, mapOdom } from "./ros2Mapping";

/** A fake rosbridge WS server. Records outbound frames; lets tests inject inbound frames. */
class FakeWs extends EventEmitter {
  sent: any[] = [];
  closed = false;
  autoOpen: boolean;
  constructor(autoOpen = true) {
    super();
    this.autoOpen = autoOpen;
    if (autoOpen) setImmediate(() => this.emit("open"));
  }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.emit("close"); }
  /** Simulate the server pushing a frame to the client. */
  inject(obj: any) { this.emit("message", JSON.stringify(obj)); }
}

beforeEach(() => {
  delete process.env.ROS2_BRIDGE_ENABLED;
  delete process.env.ROSBRIDGE_URL;
});
afterEach(() => {
  delete process.env.ROS2_BRIDGE_ENABLED;
  delete process.env.ROSBRIDGE_URL;
});

describe("RosbridgeClient", () => {
  it("connects, advertises, subscribes, publishes, and routes inbound publishes", async () => {
    const fake = new FakeWs();
    const client = new RosbridgeClient({ url: "ws://mock", wsFactory: () => fake as any });
    await client.connect();
    expect(client.isConnected()).toBe(true);

    const received: any[] = [];
    client.subscribe("/joint_states", "sensor_msgs/msg/JointState", (topic, msg) => received.push({ topic, msg }));
    client.advertise("/cmd", "std_msgs/msg/String");
    client.publish("/cmd", "std_msgs/msg/String", { data: "go" });

    // Outbound ops reached the server.
    const ops = fake.sent.map((f) => f.op);
    expect(ops).toContain("subscribe");
    expect(ops).toContain("advertise");
    expect(ops).toContain("publish");
    // advertise sent only once even though publish advertises too.
    expect(fake.sent.filter((f) => f.op === "advertise" && f.topic === "/cmd")).toHaveLength(1);

    // Inbound publish reaches the handler.
    fake.inject({ op: "publish", topic: "/joint_states", msg: { name: ["j1"], position: [1.23] } });
    expect(received).toHaveLength(1);
    expect(received[0].msg.position[0]).toBe(1.23);
  });

  it("call_service resolves on service_response", async () => {
    const fake = new FakeWs();
    const client = new RosbridgeClient({ url: "ws://mock", wsFactory: () => fake as any });
    await client.connect();
    const p = client.callService("/my_svc", { a: 1 });
    // Grab the id the client generated.
    const call = fake.sent.find((f) => f.op === "call_service");
    expect(call).toBeTruthy();
    fake.inject({ op: "service_response", id: call.id, result: true, values: { ok: true } });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it("HONEST: an error WS → connect rejects with a clear error", async () => {
    const fake = new FakeWs(false); // no auto-open
    setImmediate(() => fake.emit("error", new Error("ECONNREFUSED")));
    const client = new RosbridgeClient({ url: "ws://down", wsFactory: () => fake as any, timeoutMs: 500 });
    await expect(client.connect()).rejects.toThrow(/unreachable|ECONNREFUSED/i);
    expect(client.isConnected()).toBe(false);
  });
});

describe("Ros2Bridge telemetry ingest", () => {
  it("a /joint_states message → normalized samples reach the ingest sink", async () => {
    const fake = new FakeWs();
    const ingested: any[] = [];
    const bridge = new Ros2Bridge({
      url: "ws://mock",
      wsFactory: () => fake as any,
      telemetryTopics: [{ topic: "/joint_states", type: "sensor_msgs/msg/JointState" }],
      ingest: async (samples) => { ingested.push(...samples); return samples.length; },
    });
    await bridge.start();
    expect(bridge.isConnected()).toBe(true);

    fake.inject({
      op: "publish",
      topic: "/joint_states",
      msg: { name: ["shoulder", "elbow"], position: [0.5, -1.2], velocity: [0.01, 0.0] },
    });
    // ingest is async (void) — flush microtasks.
    await new Promise((r) => setImmediate(r));

    expect(ingested.length).toBeGreaterThan(0);
    const posSample = ingested.find((s) => s.metric === "joint.shoulder.position");
    expect(posSample).toBeTruthy();
    expect(posSample.value).toBe(0.5);
    expect(posSample.protocol).toBe("other");
    expect(posSample.meta.source).toBe("ros2");
    expect(posSample.meta.topic).toBe("/joint_states");
    await bridge.stop();
  });
});

describe("Ros2 flag-off + mapping", () => {
  it("startRos2Bridge is a no-op when ROS2_BRIDGE_ENABLED is off", async () => {
    delete process.env.ROS2_BRIDGE_ENABLED;
    expect(ros2BridgeEnabled()).toBe(false);
    const b = await startRos2Bridge();
    expect(b).toBeNull();
  });

  it("startRos2Bridge does not connect when URL is empty even if flag on", async () => {
    process.env.ROS2_BRIDGE_ENABLED = "true";
    delete process.env.ROSBRIDGE_URL;
    const b = await startRos2Bridge();
    expect(b).toBeNull();
  });

  it("normalizeRos2Message routes joint_states and odom by topic/type", () => {
    const js = normalizeRos2Message("dev", "/joint_states", { name: ["a"], position: [2] }, "sensor_msgs/msg/JointState");
    expect(js.some((s) => s.metric === "joint.a.position" && s.value === 2)).toBe(true);

    const odom = mapOdom("dev", "/odom", { pose: { pose: { position: { x: 1, y: 2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } } });
    expect(odom.some((s) => s.metric === "odom.position.x" && s.value === 1)).toBe(true);
    expect(odom.some((s) => s.metric === "odom.orientation.w" && s.value === 1)).toBe(true);

    const direct = mapJointStates("dev", "/joint_states", { name: ["j"], position: [9], effort: [0.3] });
    expect(direct.find((s) => s.metric === "joint.j.effort")?.value).toBe(0.3);
  });
});
