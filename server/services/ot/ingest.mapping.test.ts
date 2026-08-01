/**
 * Doc 24 / Connectivity — ingest × UNS mapping WIRING tests.
 *
 * Verifies that when UNS_MAPPING_ENABLED is on, a MAPPED tag publishes to the mapped
 * topic/metric with the transform applied (publisher mocked), an UNMAPPED tag keeps
 * today's default normalization, the flag OFF keeps the default, and the deadband
 * suppresses a mapped sub-threshold change.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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

const baseAdapter = {
  adapterId: 1,
  code: "A1",
  machineId: null,
  protocol: "stub",
  connection: { endpoint: "stub://x" },
  pollIntervalMs: 1000,
  tags: [{ tagKey: "t", address: "addr", dataType: "float" as const }],
  driver: {} as never,
} as unknown as RuntimeAdapter;

const RESOLVED = {
  id: 1,
  adapterId: 1,
  tag: "t",
  unsTopic: "ENT/{adapterCode}/{rename}",
  sparkplugMetric: null as string | null,
  transform: { rename: "temperature", scale: 2, offset: 1 } as Record<string, unknown>,
  enabled: true,
};

async function mockService(getMappingForTag: (a: number, t: string) => Promise<unknown>) {
  const actual = await vi.importActual<typeof import("../unsMappingService")>("../unsMappingService");
  vi.doMock("../unsMappingService", () => ({ ...actual, getMappingForTag }));
}

describe("ingestSample × UNS mapping", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doMock("../telemetryBus", () => ({ ingestTelemetry: vi.fn(async () => 0) }));
    vi.doMock("../unsBridge", () => ({ isUnsBridgeEnabled: () => true }));
  });

  it("mapped tag → publishNormalized to the MAPPED topic with transformed value", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_MAPPING_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "false");
    const publishNormalized = vi.fn();
    const publishSparkplugDData = vi.fn();
    vi.doMock("../unsPublisher", () => ({ publishNormalized, publishSparkplugDData }));
    await mockService(async () => ({ ...RESOLVED }));

    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(10)); // 10*2+1 = 21

    expect(publishNormalized).toHaveBeenCalledTimes(1);
    const [topic, payload] = publishNormalized.mock.calls[0];
    expect(topic).toBe("ENT/A1/temperature");
    expect(payload).toMatchObject({ metric: "temperature", value: 21, tag: "t" });
    expect(publishSparkplugDData).not.toHaveBeenCalled();
  });

  it("mapped tag (Sparkplug) → publishSparkplugDData with mapped metric name", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_MAPPING_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    const publishNormalized = vi.fn();
    const publishSparkplugDData = vi.fn();
    vi.doMock("../unsPublisher", () => ({ publishNormalized, publishSparkplugDData }));
    await mockService(async () => ({ ...RESOLVED, sparkplugMetric: "Temp", transform: { scale: 0.1 } }));

    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(250)); // 250*0.1 = 25

    expect(publishSparkplugDData).toHaveBeenCalledTimes(1);
    const [deviceId, metrics] = publishSparkplugDData.mock.calls[0];
    expect(deviceId).toBe("A1");
    expect(metrics[0]).toMatchObject({ name: "Temp", value: 25, type: "Double" });
    expect(publishNormalized).not.toHaveBeenCalled();
  });

  it("UNMAPPED tag → keeps the DEFAULT normalization (default topic)", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_MAPPING_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "false");
    const publishNormalized = vi.fn();
    const publishSparkplugDData = vi.fn();
    vi.doMock("../unsPublisher", () => ({ publishNormalized, publishSparkplugDData }));
    await mockService(async () => null); // no mapping

    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(10));

    expect(publishNormalized).toHaveBeenCalledTimes(1);
    const [topic, payload] = publishNormalized.mock.calls[0];
    expect(topic).toBe("avi/0/workshop/ot/station/A1/t"); // default unsTopicFor
    expect(payload).toMatchObject({ tagKey: "t", value: 10 }); // default payload shape (raw value)
  });

  it("flag OFF → DEFAULT normalization, mapping service never consulted", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    // UNS_MAPPING_ENABLED intentionally NOT set (default off)
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "false");
    const publishNormalized = vi.fn();
    const publishSparkplugDData = vi.fn();
    vi.doMock("../unsPublisher", () => ({ publishNormalized, publishSparkplugDData }));
    const getMappingForTag = vi.fn(async () => ({ ...RESOLVED }));
    await mockService(getMappingForTag);

    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(10));

    expect(getMappingForTag).not.toHaveBeenCalled();
    expect(publishNormalized).toHaveBeenCalledTimes(1);
    expect(publishNormalized.mock.calls[0][0]).toBe("avi/0/workshop/ot/station/A1/t");
  });

  it("deadband suppresses a mapped sub-threshold change (no publish)", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_MAPPING_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "false");
    const publishNormalized = vi.fn();
    const publishSparkplugDData = vi.fn();
    vi.doMock("../unsPublisher", () => ({ publishNormalized, publishSparkplugDData }));
    await mockService(async () => ({
      ...RESOLVED,
      unsTopic: "ENT/{tag}",
      transform: { deadband: 5 },
    }));

    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(100)); // first → publishes
    await ingestSample(baseAdapter, sample(102)); // |2| < 5 → suppressed

    expect(publishNormalized).toHaveBeenCalledTimes(1);
    expect(publishNormalized.mock.calls[0][1]).toMatchObject({ value: 100 });
  });
});
