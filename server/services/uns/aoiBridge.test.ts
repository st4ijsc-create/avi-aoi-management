/**
 * Sprint F3b — aoiBridge: map topic AOI cũ → Sparkplug metric set (THUẦN, offline).
 *
 * Bật UNS_BRIDGE_ENABLED không cần (mapAoiTopicToSparkplug dùng parseAviTopic — chỉ
 * parse chuỗi, không phụ thuộc cờ). Kiểm: NG alert / summary / topic lạ / payload thiếu.
 */
import { describe, it, expect } from "vitest";
import { mapAoiTopicToSparkplug } from "./aoiBridge";

function byName(metrics: Array<{ name: string; value: unknown; type: string }>) {
  return Object.fromEntries(metrics.map((m) => [m.name, m]));
}

describe("mapAoiTopicToSparkplug — NG alert", () => {
  const topic = "avi/factory/12/workshop/3/station/45/errors";
  const payload = {
    severity: "high",
    totalNG: 4,
    inspectionId: 9981,
    overallResult: "NG",
    product: { serialNumber: "SN-ABC-001" },
  };

  it("deviceId = Station{stationId} + đủ metric NG", () => {
    const r = mapAoiTopicToSparkplug(topic, payload);
    expect(r).not.toBeNull();
    expect(r!.deviceId).toBe("Station45");

    const m = byName(r!.metrics);
    expect(m.ng_count).toMatchObject({ type: "Int64", value: 4 });
    expect(m.severity).toMatchObject({ type: "String", value: "high" });
    expect(m.serial).toMatchObject({ type: "String", value: "SN-ABC-001" });
    expect(m.inspection_id).toMatchObject({ type: "Int64", value: 9981 });
    expect(m.result).toMatchObject({ type: "String", value: "NG" });
  });

  it("metricDefs khớp metrics (DBIRTH có cùng tập name + value khởi tạo)", () => {
    const r = mapAoiTopicToSparkplug(topic, payload)!;
    expect(r.metricDefs.map((d) => d.name).sort()).toEqual(
      r.metrics.map((d) => d.name).sort(),
    );
    const defs = byName(r.metricDefs);
    expect(defs.ng_count.value).toBe(4);
  });

  it("topic không prefix 'factory/' vẫn parse (avi/{id}/workshop/...)", () => {
    const r = mapAoiTopicToSparkplug("avi/12/workshop/3/station/45/errors", payload);
    expect(r).not.toBeNull();
    expect(r!.deviceId).toBe("Station45");
  });
});

describe("mapAoiTopicToSparkplug — summary", () => {
  const payload = {
    type: "DAILY_SUMMARY",
    statistics: { totalInspections: 100, totalNG: 7, totalNTF: 1, ngRate: 7 },
  };

  it("daily summary → total_inspections / total_ng / ng_rate (Double)", () => {
    const r = mapAoiTopicToSparkplug(
      "avi/factory/12/workshop/3/station/45/summary/daily",
      payload,
    );
    expect(r).not.toBeNull();
    expect(r!.deviceId).toBe("Station45");
    const m = byName(r!.metrics);
    expect(m.total_inspections).toMatchObject({ type: "Double", value: 100 });
    expect(m.total_ng).toMatchObject({ type: "Double", value: 7 });
    expect(m.ng_rate).toMatchObject({ type: "Double", value: 7 });
  });

  it("weekly summary cũng khớp", () => {
    const r = mapAoiTopicToSparkplug(
      "avi/factory/1/workshop/1/station/2/summary/weekly",
      payload,
    );
    expect(r).not.toBeNull();
    expect(r!.deviceId).toBe("Station2");
  });
});

describe("mapAoiTopicToSparkplug — biên & graceful", () => {
  it("topic lạ → null", () => {
    expect(mapAoiTopicToSparkplug("foo/bar/baz", {})).toBeNull();
    expect(mapAoiTopicToSparkplug("avi/client/dev1/info", {})).toBeNull();
  });

  it("topic AOI hợp lệ nhưng messageType không bridge (status) → null", () => {
    expect(
      mapAoiTopicToSparkplug("avi/factory/12/workshop/3/station/45/status", {}),
    ).toBeNull();
  });

  it("NG payload thiếu field → KHÔNG throw, dùng fallback", () => {
    const r = mapAoiTopicToSparkplug(
      "avi/factory/12/workshop/3/station/45/errors",
      {},
    );
    expect(r).not.toBeNull();
    const m = byName(r!.metrics);
    expect(m.ng_count.value).toBe(0);
    expect(m.severity.value).toBe("");
    expect(m.serial.value).toBe("");
    expect(m.inspection_id.value).toBe(0);
    // overallResult thiếu → fallback "NG"
    expect(m.result.value).toBe("NG");
  });

  it("payload null / không phải object → không throw", () => {
    expect(() =>
      mapAoiTopicToSparkplug("avi/factory/1/workshop/1/station/1/errors", null),
    ).not.toThrow();
    expect(() =>
      mapAoiTopicToSparkplug("avi/factory/1/workshop/1/station/1/summary/daily", 42),
    ).not.toThrow();
  });

  it("topic rỗng / không phải chuỗi → null", () => {
    expect(mapAoiTopicToSparkplug("", {})).toBeNull();
    // @ts-expect-error test runtime guard
    expect(mapAoiTopicToSparkplug(undefined, {})).toBeNull();
  });
});
