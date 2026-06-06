/**
 * Sprint F3b — handleAoiPublish (wiring): cờ AOI bridge điều khiển gọi publishAoiBridge.
 *
 * Mock ./uns/aoiBridge + ./unsPublisher (vi.doMock) để test wiring thuần, KHÔNG broker.
 * Regression: publishNormalized KHÔNG bị động bởi nhánh bridge (handleAoiPublish chỉ
 * thêm Sparkplug; handler aedes vẫn gọi publishNormalized riêng — ngoài phạm vi test này).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("handleAoiPublish — cờ Sparkplug AOI bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function load(opts: { mapResult?: unknown } = {}) {
    const defaultMapping = {
      deviceId: "Station45",
      metricDefs: [{ name: "ng_count", type: "Int64", value: 1 }],
      metrics: [{ name: "ng_count", type: "Int64", value: 1 }],
    };
    const result = "mapResult" in opts ? opts.mapResult : defaultMapping;
    const mapAoiTopicToSparkplug = vi.fn(() => result);
    const publishAoiBridge = vi.fn();
    vi.doMock("./uns/aoiBridge", () => ({ mapAoiTopicToSparkplug }));
    vi.doMock("./unsPublisher", () => ({
      publishAoiBridge,
      // các export khác mqttService import — stub no-op để module load được.
      initUnsPublisher: vi.fn(),
      publishNormalized: vi.fn(),
      publishNdeathGraceful: vi.fn(),
      shutdownUnsPublisher: vi.fn(),
    }));
    const mod = await import("./mqttService");
    return { handleAoiPublish: mod.handleAoiPublish, mapAoiTopicToSparkplug, publishAoiBridge };
  }

  it("ENABLED + AOI_BRIDGE = true → gọi publishAoiBridge với mapping", async () => {
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_AOI_BRIDGE", "true");
    const { handleAoiPublish, mapAoiTopicToSparkplug, publishAoiBridge } = await load();

    handleAoiPublish(
      "avi/factory/12/workshop/3/station/45/errors",
      Buffer.from(JSON.stringify({ totalNG: 1 })),
    );

    expect(mapAoiTopicToSparkplug).toHaveBeenCalledTimes(1);
    expect(publishAoiBridge).toHaveBeenCalledTimes(1);
    expect(publishAoiBridge).toHaveBeenCalledWith(
      "Station45",
      expect.any(Array),
      expect.any(Array),
    );
  });

  it("AOI_BRIDGE tắt → KHÔNG gọi bridge (no-op)", async () => {
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_AOI_BRIDGE", "false");
    const { handleAoiPublish, mapAoiTopicToSparkplug, publishAoiBridge } = await load();

    handleAoiPublish("avi/factory/12/workshop/3/station/45/errors", Buffer.from("{}"));

    expect(mapAoiTopicToSparkplug).not.toHaveBeenCalled();
    expect(publishAoiBridge).not.toHaveBeenCalled();
  });

  it("SPARKPLUG_ENABLED tắt → KHÔNG gọi bridge (no-op)", async () => {
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "false");
    vi.stubEnv("UNS_SPARKPLUG_AOI_BRIDGE", "true");
    const { handleAoiPublish, publishAoiBridge } = await load();

    handleAoiPublish("avi/factory/12/workshop/3/station/45/errors", Buffer.from("{}"));
    expect(publishAoiBridge).not.toHaveBeenCalled();
  });

  it("payload non-JSON → KHÔNG sập, KHÔNG gọi bridge", async () => {
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_AOI_BRIDGE", "true");
    const { handleAoiPublish, mapAoiTopicToSparkplug, publishAoiBridge } = await load();

    expect(() =>
      handleAoiPublish("avi/factory/12/workshop/3/station/45/errors", Buffer.from("<not-json>")),
    ).not.toThrow();
    expect(mapAoiTopicToSparkplug).not.toHaveBeenCalled();
    expect(publishAoiBridge).not.toHaveBeenCalled();
  });

  it("mapping = null (topic lạ) → KHÔNG gọi publishAoiBridge", async () => {
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_AOI_BRIDGE", "true");
    const { handleAoiPublish, publishAoiBridge } = await load({ mapResult: null });

    handleAoiPublish("foo/bar", Buffer.from("{}"));
    expect(publishAoiBridge).not.toHaveBeenCalled();
  });

  it("publishAoiBridge ném (chưa connect) → handleAoiPublish KHÔNG sập", async () => {
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_AOI_BRIDGE", "true");
    vi.doMock("./uns/aoiBridge", () => ({
      mapAoiTopicToSparkplug: vi.fn(() => ({ deviceId: "Station1", metricDefs: [], metrics: [] })),
    }));
    vi.doMock("./unsPublisher", () => ({
      publishAoiBridge: vi.fn(() => { throw new Error("not connected"); }),
      initUnsPublisher: vi.fn(),
      publishNormalized: vi.fn(),
      publishNdeathGraceful: vi.fn(),
      shutdownUnsPublisher: vi.fn(),
    }));
    const mod = await import("./mqttService");
    expect(() =>
      mod.handleAoiPublish("avi/factory/1/workshop/1/station/1/errors", Buffer.from("{}")),
    ).not.toThrow();
  });
});

/**
 * F3b regression-guard — processAedesPublish (thân handler aedes.on('publish')).
 *
 * Khóa tiêu chí backward-compat TỐI QUAN TRỌNG: publishNormalized(topic, payload) JSON
 * cũ (mirror UNS/Android/AOI) được gọi VÔ ĐIỀU KIỆN — KHÔNG phụ thuộc cờ Sparkplug —
 * và LUÔN chạy TRƯỚC nhánh bridge (publishAoiBridge). Mock ./unsPublisher để bắt cả 2.
 */
describe("processAedesPublish — publishNormalized vô điều kiện (regression-guard)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function loadProcess() {
    const calls: string[] = [];
    const publishNormalized = vi.fn((_t: string, _p: unknown) => { calls.push("publishNormalized"); });
    const publishAoiBridge = vi.fn((..._a: unknown[]) => { calls.push("publishAoiBridge"); });
    const mapAoiTopicToSparkplug = vi.fn(() => ({
      deviceId: "Station45",
      metricDefs: [{ name: "ng_count", type: "Int64", value: 1 }],
      metrics: [{ name: "ng_count", type: "Int64", value: 1 }],
    }));
    vi.doMock("./uns/aoiBridge", () => ({ mapAoiTopicToSparkplug }));
    vi.doMock("./unsPublisher", () => ({
      publishNormalized,
      publishAoiBridge,
      initUnsPublisher: vi.fn(),
      publishNdeathGraceful: vi.fn(),
      shutdownUnsPublisher: vi.fn(),
    }));
    const mod = await import("./mqttService");
    return { processAedesPublish: mod.processAedesPublish, publishNormalized, publishAoiBridge, calls };
  }

  it("Sparkplug OFF + AOI_BRIDGE OFF → publishNormalized VẪN gọi đúng (topic, payload); bridge KHÔNG gọi", async () => {
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "false");
    vi.stubEnv("UNS_SPARKPLUG_AOI_BRIDGE", "false");
    const { processAedesPublish, publishNormalized, publishAoiBridge } = await loadProcess();

    const topic = "avi/factory/12/workshop/3/station/45/errors";
    const payload = Buffer.from(JSON.stringify({ totalNG: 1 }));
    processAedesPublish(topic, payload);

    expect(publishNormalized).toHaveBeenCalledTimes(1);
    expect(publishNormalized).toHaveBeenCalledWith(topic, payload);
    expect(publishAoiBridge).not.toHaveBeenCalled();
  });

  it("Sparkplug ON + AOI_BRIDGE ON → publishNormalized VẪN gọi (topic, payload) VÀ publishAoiBridge cũng gọi", async () => {
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_AOI_BRIDGE", "true");
    const { processAedesPublish, publishNormalized, publishAoiBridge } = await loadProcess();

    const topic = "avi/factory/12/workshop/3/station/45/errors";
    const payload = Buffer.from(JSON.stringify({ totalNG: 1 }));
    processAedesPublish(topic, payload);

    expect(publishNormalized).toHaveBeenCalledTimes(1);
    expect(publishNormalized).toHaveBeenCalledWith(topic, payload);
    expect(publishAoiBridge).toHaveBeenCalledTimes(1);
  });

  it("publishNormalized LUÔN chạy TRƯỚC nhánh bridge (thứ tự cố định)", async () => {
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.stubEnv("UNS_SPARKPLUG_AOI_BRIDGE", "true");
    const { processAedesPublish, calls } = await loadProcess();

    processAedesPublish("avi/factory/12/workshop/3/station/45/errors", Buffer.from("{}"));

    expect(calls).toEqual(["publishNormalized", "publishAoiBridge"]);
  });
});
