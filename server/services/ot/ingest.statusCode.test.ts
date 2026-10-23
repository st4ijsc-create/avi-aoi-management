/**
 * SCADA R0 Task 6 — sampleToCanonical giữ statusCode/reason trong meta.
 */
import { describe, expect, it } from "vitest";
import { sampleToCanonical } from "./ingest";
import type { OtSample } from "./otDriver";
import type { RuntimeAdapter } from "./deviceAdapter";

const adapter = {
  adapterId: 7,
  code: "A7",
  machineId: 2,
  protocol: "modbus",
  connection: { endpoint: "tcp://x" },
  pollIntervalMs: 1000,
  tags: [],
  driver: {} as never,
} as unknown as RuntimeAdapter;

const base: OtSample = {
  tagKey: "t",
  raw: null,
  value: null,
  quality: "bad",
  timestamp: new Date("2026-01-01T00:00:00.000Z"),
};

describe("sampleToCanonical — meta", () => {
  it("mẫu bad mang statusCode + reason ⇒ meta đủ 4 khoá", () => {
    const c = sampleToCanonical(adapter, { ...base, statusCode: "modbus_exc_02", reason: "config_error" });
    expect(c.meta).toEqual({ adapterId: 7, tagKey: "t", statusCode: "modbus_exc_02", reason: "config_error" });
  });

  it("mẫu good không có statusCode/reason ⇒ meta giữ hình cũ (không khoá undefined)", () => {
    const c = sampleToCanonical(adapter, { ...base, quality: "good", value: 1 });
    expect(c.meta).toEqual({ adapterId: 7, tagKey: "t" });
    expect(Object.keys(c.meta as object)).toEqual(["adapterId", "tagKey"]);
  });

  it("chỉ có statusCode ⇒ chỉ thêm statusCode", () => {
    const c = sampleToCanonical(adapter, { ...base, statusCode: "BadNodeIdUnknown" });
    expect(c.meta).toEqual({ adapterId: 7, tagKey: "t", statusCode: "BadNodeIdUnknown" });
  });
});
