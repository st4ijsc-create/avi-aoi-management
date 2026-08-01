/**
 * doc 44 §11 R-3 — mqttService dual-publish wrappers (dualAedesPublish / dualExternalPublish).
 *
 * Loads mqttService with the same doMock(unsPublisher/aoiBridge) shim as the sibling tests (no
 * broker, no DB) and drives the wrappers against MOCK brokers, passing the flag env explicitly.
 * Proves the wire-level guarantee the field rollout depends on: legacy-ONLY by default, BOTH
 * under dual-publish, synapse-ONLY at cutover — for BOTH the internal broker (avi/) and the
 * external bridge (avi-aoi/ AND raw avi/ topics).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const OFF: NodeJS.ProcessEnv = {};
const DUAL: NodeJS.ProcessEnv = { MQTT_TOPIC_DUAL_PUBLISH: "true" };
const CUTOVER: NodeJS.ProcessEnv = { MQTT_TOPIC_DUAL_PUBLISH: "true", MQTT_TOPIC_LEGACY_DISABLE: "true" };

async function load() {
  vi.resetModules();
  vi.doMock("./unsPublisher", () => ({
    initUnsPublisher: vi.fn(),
    publishNormalized: vi.fn(),
    publishAoiBridge: vi.fn(),
    publishNdeathGraceful: vi.fn(),
    shutdownUnsPublisher: vi.fn(),
  }));
  vi.doMock("./uns/aoiBridge", () => ({ mapAoiTopicToSparkplug: vi.fn(() => null) }));
  const mod = await import("./mqttService");
  return { dualAedesPublish: mod.dualAedesPublish, dualExternalPublish: mod.dualExternalPublish };
}

function aedesMock() {
  const publish = vi.fn((_packet: { topic: string }, cb?: (e?: Error) => void) => cb && cb());
  return { publish, topics: () => publish.mock.calls.map((c) => (c[0] as { topic: string }).topic) };
}
function clientMock() {
  const publish = vi.fn((_t: string, _m: unknown, _o: unknown, cb?: (e?: Error) => void) => cb && cb());
  return { publish, topics: () => publish.mock.calls.map((c) => c[0] as string) };
}

beforeEach(() => vi.resetModules());

describe("dualAedesPublish — internal broker avi/ → synapse/", () => {
  it("DEFAULT (flags off) → publishes ONLY the avi/ topic", async () => {
    const { dualAedesPublish } = await load();
    const broker = aedesMock();
    dualAedesPublish(broker, { topic: "avi/client/dev-1/commands", payload: Buffer.from("x") }, undefined, OFF);
    expect(broker.topics()).toEqual(["avi/client/dev-1/commands"]);
  });

  it("dual ON → publishes BOTH, legacy first", async () => {
    const { dualAedesPublish } = await load();
    const broker = aedesMock();
    dualAedesPublish(broker, { topic: "avi/client/dev-1/commands", payload: Buffer.from("x") }, undefined, DUAL);
    expect(broker.topics()).toEqual(["avi/client/dev-1/commands", "synapse/client/dev-1/commands"]);
  });

  it("cutover → publishes ONLY the synapse/ topic", async () => {
    const { dualAedesPublish } = await load();
    const broker = aedesMock();
    dualAedesPublish(broker, { topic: "avi/factory/1/errors", payload: Buffer.from("x") }, undefined, CUTOVER);
    expect(broker.topics()).toEqual(["synapse/factory/1/errors"]);
  });

  it("primary publish keeps the caller's callback (resolve/log semantics)", async () => {
    const { dualAedesPublish } = await load();
    const broker = aedesMock();
    const cb = vi.fn();
    dualAedesPublish(broker, { topic: "avi/a" }, cb, DUAL);
    expect(cb).toHaveBeenCalledTimes(1); // only the primary carries the caller cb
  });

  it("a non-avi topic is published once regardless of flags", async () => {
    const { dualAedesPublish } = await load();
    const broker = aedesMock();
    dualAedesPublish(broker, { topic: "syn/hn/telemetry" }, undefined, DUAL);
    expect(broker.topics()).toEqual(["syn/hn/telemetry"]);
  });
});

describe("dualExternalPublish — external bridge (avi-aoi/ AND raw avi/)", () => {
  it("prefixed avi-aoi/ topic → dual-publishes to synapse/ under dual", async () => {
    const { dualExternalPublish } = await load();
    const client = clientMock();
    dualExternalPublish(client, "avi-aoi/factory/1/errors", "{}", { qos: 1 }, undefined, DUAL);
    expect(client.topics()).toEqual(["avi-aoi/factory/1/errors", "synapse/factory/1/errors"]);
  });

  it("RAW avi/ topic (points-config/model-update path) ALSO gets a synapse/ twin under dual", async () => {
    const { dualExternalPublish } = await load();
    const client = clientMock();
    dualExternalPublish(client, "avi/points-config-changed/PM-001", "{}", { qos: 1 }, undefined, DUAL);
    expect(client.topics()).toEqual(["avi/points-config-changed/PM-001", "synapse/points-config-changed/PM-001"]);
  });

  it("DEFAULT (flags off) → single legacy publish", async () => {
    const { dualExternalPublish } = await load();
    const client = clientMock();
    dualExternalPublish(client, "avi-aoi/factory/1/errors", "{}", { qos: 1 }, undefined, OFF);
    expect(client.topics()).toEqual(["avi-aoi/factory/1/errors"]);
  });

  it("cutover → synapse/ only", async () => {
    const { dualExternalPublish } = await load();
    const client = clientMock();
    dualExternalPublish(client, "avi/edge/dev-9/model-update", "{}", { qos: 1 }, undefined, CUTOVER);
    expect(client.topics()).toEqual(["synapse/edge/dev-9/model-update"]);
  });
});
