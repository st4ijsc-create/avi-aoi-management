/**
 * Sprint F1.1 / P2 — ingest unit tests.
 *
 * `sampleToCanonical` is pure → mapped CanonicalSample shape (canonical columns).
 * `ingestSample` funnels through the unified telemetry bus (mocked) + optional UNS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sampleToCanonical, otProtocolToCanonical } from "./ingest";
import type { OtSample } from "./otDriver";
import type { RuntimeAdapter } from "./deviceAdapter";

function sample(value: OtSample["value"], extra: Partial<OtSample> = {}): OtSample {
  return {
    tagKey: "t",
    raw: value,
    value,
    quality: "good",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    ...extra,
  };
}

const adapter = (over: Partial<RuntimeAdapter> = {}): RuntimeAdapter =>
  ({
    adapterId: 1,
    code: "A1",
    machineId: 2,
    protocol: "stub",
    connection: { endpoint: "stub://x" },
    pollIntervalMs: 1000,
    tags: [{ tagKey: "t", address: "addr", dataType: "float" as const }],
    driver: {} as never,
    ...over,
  }) as RuntimeAdapter;

describe("otProtocolToCanonical", () => {
  it("maps OT driver protocols to canonical enum members", () => {
    expect(otProtocolToCanonical("opcua")).toBe("opcua");
    expect(otProtocolToCanonical("modbus")).toBe("modbus");
    expect(otProtocolToCanonical("s7")).toBe("s7");
    expect(otProtocolToCanonical("ethernet-ip")).toBe("ethernet_ip");
    expect(otProtocolToCanonical("mitsubishi-mc")).toBe("other");
    expect(otProtocolToCanonical("stub")).toBe("other");
  });
});

describe("sampleToCanonical", () => {
  it("number → value passed through, machineId + deviceId + protocol set", () => {
    const c = sampleToCanonical(adapter({ protocol: "opcua" }), sample(42.5));
    expect(c.machineId).toBe(2);
    expect(c.deviceId).toBe("A1");
    expect(c.protocol).toBe("opcua");
    expect(c.metric).toBe("t");
    expect(c.value).toBe(42.5);
    expect(c.ts).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("null machineId is carried through (resolved by the bus via deviceId)", () => {
    const c = sampleToCanonical(adapter({ machineId: null }), sample(true));
    expect(c.machineId).toBeNull();
    expect(c.deviceId).toBe("A1");
    expect(c.value).toBe(true);
  });

  it("passes through quality", () => {
    const c = sampleToCanonical(adapter(), sample(1, { quality: "uncertain" }));
    expect(c.quality).toBe("uncertain");
  });
});

describe("ingestSample", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  const baseAdapter = adapter({ machineId: null });

  it("funnels the sample through ingestTelemetry (the unified bus)", async () => {
    const ingestTelemetry = vi.fn(async () => 1);
    vi.doMock("../telemetryBus", () => ({ ingestTelemetry }));
    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(23.4));
    expect(ingestTelemetry).toHaveBeenCalledTimes(1);
    const [arr] = ingestTelemetry.mock.calls[0];
    expect(arr[0]).toMatchObject({ metric: "t", value: 23.4, deviceId: "A1", protocol: "other" });
  });

  it("no-op safe when UNS off (bus mocked)", async () => {
    vi.doMock("../telemetryBus", () => ({ ingestTelemetry: vi.fn(async () => 0) }));
    const { ingestSample } = await import("./ingest");
    await expect(ingestSample(baseAdapter, sample(1))).resolves.toBeUndefined();
  });

  it("UNS_SPARKPLUG_ENABLED=true → publishSparkplugDData (not publishNormalized)", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.doMock("../telemetryBus", () => ({ ingestTelemetry: vi.fn(async () => 0) }));
    vi.doMock("../unsBridge", () => ({ isUnsBridgeEnabled: () => true }));
    const publishSparkplugDData = vi.fn();
    const publishNormalized = vi.fn();
    vi.doMock("../unsPublisher", () => ({ publishSparkplugDData, publishNormalized }));

    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(23.4));

    expect(publishSparkplugDData).toHaveBeenCalledTimes(1);
    expect(publishNormalized).not.toHaveBeenCalled();
    const [deviceId, metrics] = publishSparkplugDData.mock.calls[0];
    expect(deviceId).toBe("A1");
    expect(metrics[0]).toMatchObject({ name: "t", type: "Double", value: 23.4 });
  });

  it("Sparkplug off → legacy JSON publishNormalized", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "false");
    vi.doMock("../telemetryBus", () => ({ ingestTelemetry: vi.fn(async () => 0) }));
    vi.doMock("../unsBridge", () => ({ isUnsBridgeEnabled: () => true }));
    const publishSparkplugDData = vi.fn();
    const publishNormalized = vi.fn();
    vi.doMock("../unsPublisher", () => ({ publishSparkplugDData, publishNormalized }));

    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(1));

    expect(publishNormalized).toHaveBeenCalledTimes(1);
    expect(publishSparkplugDData).not.toHaveBeenCalled();
  });

  it("does not throw when publisher not connected (publishSparkplugDData throws)", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.doMock("../telemetryBus", () => ({ ingestTelemetry: vi.fn(async () => 0) }));
    vi.doMock("../unsBridge", () => ({ isUnsBridgeEnabled: () => true }));
    vi.doMock("../unsPublisher", () => ({
      publishSparkplugDData: vi.fn(() => {
        throw new Error("not connected");
      }),
      publishNormalized: vi.fn(),
    }));

    const { ingestSample } = await import("./ingest");
    await expect(ingestSample(baseAdapter, sample(1))).resolves.toBeUndefined();
  });
});
