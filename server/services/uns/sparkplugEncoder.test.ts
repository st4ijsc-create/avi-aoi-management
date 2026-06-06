/**
 * Sprint F3a — sparkplugEncoder: round-trip encode/decode THẬT (chứng minh import
 * `sparkplug-payload` ESM chạy) + map otTypeToSparkplug.
 */
import { describe, it, expect } from "vitest";
import { encodePayload, decodePayload, otTypeToSparkplug } from "./sparkplugEncoder";

describe("sparkplugEncoder round-trip", () => {
  it("encode→decode giữ name/type/value/timestamp cho Boolean/Int64/Double/String", () => {
    const ts = 1_700_000_000_000;
    const buf = encodePayload({
      timestamp: ts,
      seq: 3,
      metrics: [
        { name: "b", type: "Boolean", value: true, timestamp: ts },
        { name: "i", type: "Int64", value: 42, timestamp: ts },
        { name: "d", type: "Double", value: 1.5, timestamp: ts },
        { name: "s", type: "String", value: "hello", timestamp: ts },
      ],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);

    const dec = decodePayload(buf);
    expect(dec.seq).toBe(3);
    expect(dec.timestamp).toBe(ts);

    const byName = Object.fromEntries(dec.metrics.map((m) => [m.name, m]));
    expect(byName.b.type).toBe("Boolean");
    expect(byName.b.value).toBe(true);
    expect(byName.i.type).toBe("Int64");
    expect(Number(byName.i.value)).toBe(42);
    expect(byName.d.type).toBe("Double");
    expect(byName.d.value).toBeCloseTo(1.5);
    expect(byName.s.type).toBe("String");
    expect(byName.s.value).toBe("hello");
    expect(byName.s.timestamp).toBe(ts);
  });

  it("decode chuẩn hoá seq/timestamp về number (không Long object)", () => {
    const buf = encodePayload({ timestamp: 123, seq: 0, metrics: [] });
    const dec = decodePayload(buf);
    expect(typeof dec.seq).toBe("number");
    expect(typeof dec.timestamp).toBe("number");
    expect(dec.seq).toBe(0);
  });
});

describe("otTypeToSparkplug", () => {
  it("map đúng các kiểu OT", () => {
    expect(otTypeToSparkplug("bool")).toBe("Boolean");
    expect(otTypeToSparkplug("int")).toBe("Int64");
    expect(otTypeToSparkplug("float")).toBe("Double");
    expect(otTypeToSparkplug("string")).toBe("String");
    expect(otTypeToSparkplug("json")).toBe("String");
  });
});
