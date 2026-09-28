/**
 * Doc 56 Đ2a Việc 9 — MQTT → telemetry bus bridge (synapse/…/telemetry).
 *
 * Loads mqttService with the same doMock(unsPublisher/aoiBridge) shim as the sibling
 * tests (no broker, no DB) and additionally mocks telemetryBus so the fire-and-forget
 * ingest is observable. Proves: canonical parse (asset_id → device/machine), the
 * synapse/…/telemetry topic gate, and the default-OFF flag gate (byte-identical).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ingestTelemetry = vi.hoisted(() => vi.fn(async () => 1));

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
  vi.doMock("./telemetryBus", () => ({ ingestTelemetry }));
  return import("./mqttService");
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const frame = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    asset_id: "DEV1",
    ts: "2026-07-17T00:00:00.000Z",
    metrics: [{ name: "temperature", value: 42, unit: "degC", quality: "good" }],
    ...over,
  });

beforeEach(() => {
  ingestTelemetry.mockClear();
  delete process.env.MQTT_TELEMETRY_BRIDGE_ENABLED;
});

describe("Việc 9 — parseCanonicalTelemetry", () => {
  it("maps a canonical frame → CanonicalSample[] (deviceId from asset_id)", async () => {
    const { parseCanonicalTelemetry } = await load();
    const samples = parseCanonicalTelemetry("synapse/f/1/DEV1/telemetry", frame());
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      deviceId: "DEV1",
      machineId: null,
      protocol: "mqtt",
      metric: "temperature",
      value: 42,
      unit: "degC",
      quality: "good",
    });
  });

  it('asset_id "machine:<n>" resolves to machineId (not deviceId)', async () => {
    const { parseCanonicalTelemetry } = await load();
    const samples = parseCanonicalTelemetry("synapse/x/telemetry", frame({ asset_id: "machine:5" }));
    expect(samples[0].machineId).toBe(5);
    expect(samples[0].deviceId).toBeNull();
  });

  it("non-JSON / non-telemetry payloads yield [] (never throws)", async () => {
    const { parseCanonicalTelemetry } = await load();
    expect(parseCanonicalTelemetry("synapse/x/telemetry", "not json")).toEqual([]);
    expect(parseCanonicalTelemetry("synapse/x/telemetry", JSON.stringify({ foo: 1 }))).toEqual([]);
    expect(parseCanonicalTelemetry("synapse/x/telemetry", JSON.stringify({ metrics: [] }))).toEqual([]);
  });
});

describe("Việc 9 — handleTelemetryBridge gate", () => {
  it("flag OFF (default): NO-OP even for a matching topic (byte-identical)", async () => {
    const { handleTelemetryBridge } = await load();
    handleTelemetryBridge("synapse/f/1/DEV1/telemetry", frame());
    await tick();
    expect(ingestTelemetry).not.toHaveBeenCalled();
  });

  // ★ 2026-09-27 (doc 81 Đợt 1C Task 5): the bridge no longer trusts `asset_id` on its own — the
  // frame must come from a device BOUND to the machine it names. This case used to call the
  // bridge with no origin and expect ingest; it now passes the bound machine (code DEV1, id 7).
  const BOUND = { deviceId: "esp-1", machine: { id: 7, code: "DEV1", factoryId: 1, isa95Path: null } };

  it("flag ON + synapse/…/telemetry from the BOUND device: bridges into ingestTelemetry, machineId pinned", async () => {
    process.env.MQTT_TELEMETRY_BRIDGE_ENABLED = "true";
    const { handleTelemetryBridge } = await load();
    handleTelemetryBridge("synapse/f/1/DEV1/telemetry", frame(), BOUND);
    await tick();
    expect(ingestTelemetry).toHaveBeenCalledTimes(1);
    const passed = ingestTelemetry.mock.calls[0][0] as any[];
    expect(passed[0]).toMatchObject({ deviceId: "DEV1", machineId: 7, protocol: "mqtt", metric: "temperature" });
  });

  it('flag ON: asset_id "machine:<bound id>" is accepted too', async () => {
    process.env.MQTT_TELEMETRY_BRIDGE_ENABLED = "true";
    const { handleTelemetryBridge } = await load();
    handleTelemetryBridge("synapse/f/1/DEV1/telemetry", frame({ asset_id: "machine:7" }), BOUND);
    await tick();
    expect(ingestTelemetry).toHaveBeenCalledTimes(1);
    expect((ingestTelemetry.mock.calls[0][0] as any[])[0]).toMatchObject({ machineId: 7, deviceId: null });
  });

  it("flag ON: no origin / unbound device / asset_id of another machine ⇒ dropped and COUNTED, nothing ingested", async () => {
    process.env.MQTT_TELEMETRY_BRIDGE_ENABLED = "true";
    const { handleTelemetryBridge, getMqttBindingDropStats } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const before = getMqttBindingDropStats();
      handleTelemetryBridge("synapse/f/1/DEV1/telemetry", frame());
      handleTelemetryBridge("synapse/f/1/DEV1/telemetry", frame(), { deviceId: "esp-2", machine: null });
      handleTelemetryBridge("synapse/f/1/DEV1/telemetry", frame({ asset_id: "OTHER" }), BOUND);
      handleTelemetryBridge("synapse/f/1/DEV1/telemetry", frame({ asset_id: "machine:8" }), BOUND);
      await tick();
      expect(ingestTelemetry).not.toHaveBeenCalled();
      const after = getMqttBindingDropStats();
      expect(after.telemetryFrames - before.telemetryFrames).toBe(4);
      expect(after.telemetrySamples - before.telemetrySamples).toBe(4);
    } finally {
      warn.mockRestore();
    }
  });

  it("flag ON but a non-telemetry topic: NO-OP", async () => {
    process.env.MQTT_TELEMETRY_BRIDGE_ENABLED = "true";
    const { handleTelemetryBridge } = await load();
    handleTelemetryBridge("synapse/client/DEV1/info", frame());
    await tick();
    expect(ingestTelemetry).not.toHaveBeenCalled();
  });
});
