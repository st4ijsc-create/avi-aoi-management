/**
 * Sprint F1.2 — opcuaAddress helper tests (THUẦN, offline).
 */
import { describe, it, expect } from "vitest";
import { parseOpcuaAddress, normalizeOpcuaValue, coerceOpcuaWriteValue } from "./opcuaAddress";

describe("parseOpcuaAddress", () => {
  it("parses valid string/numeric/guid/bytestring nodeIds", () => {
    expect(parseOpcuaAddress("ns=2;s=Temperature").nodeId).toBe("ns=2;s=Temperature");
    expect(parseOpcuaAddress("ns=0;i=2258").nodeId).toBe("ns=0;i=2258");
    expect(parseOpcuaAddress("ns=1;g=09087e75-8e5e-499b-954f-f2a9603db28a").nodeId).toContain("g=");
    expect(parseOpcuaAddress("ns=3;b=YmFzZTY0").nodeId).toContain("b=");
  });

  it("trims whitespace", () => {
    expect(parseOpcuaAddress("  ns=2;s=Foo  ").nodeId).toBe("ns=2;s=Foo");
  });

  it("throws on invalid nodeId", () => {
    expect(() => parseOpcuaAddress("DB1.0")).toThrow(/invalid OPC-UA nodeId/);
    expect(() => parseOpcuaAddress("ns=2;x=Foo")).toThrow(/invalid OPC-UA nodeId/);
    expect(() => parseOpcuaAddress("s=Foo")).toThrow(/invalid OPC-UA nodeId/);
    expect(() => parseOpcuaAddress("ns=2;s=")).toThrow(/invalid OPC-UA nodeId/);
  });
});

describe("normalizeOpcuaValue", () => {
  it("null/undefined raw → bad", () => {
    expect(normalizeOpcuaValue(null, "float")).toEqual({ value: null, quality: "bad" });
    expect(normalizeOpcuaValue(undefined, "int")).toEqual({ value: null, quality: "bad" });
  });

  it("bool → Boolean", () => {
    expect(normalizeOpcuaValue(1, "bool")).toEqual({ value: true, quality: "good" });
    expect(normalizeOpcuaValue(0, "bool")).toEqual({ value: false, quality: "good" });
    expect(normalizeOpcuaValue(true, "bool")).toEqual({ value: true, quality: "good" });
  });

  it("int applies scale+offset then rounds", () => {
    // 12.3 * 10 + 5 = 128 → round 128
    expect(normalizeOpcuaValue(12.3, "int", 10, 5)).toEqual({ value: 128, quality: "good" });
    expect(normalizeOpcuaValue(7, "int")).toEqual({ value: 7, quality: "good" });
  });

  it("float applies scale+offset without rounding", () => {
    expect(normalizeOpcuaValue(2, "float", 1.5, 0.5)).toEqual({ value: 3.5, quality: "good" });
  });

  it("string → String", () => {
    expect(normalizeOpcuaValue(42, "string")).toEqual({ value: "42", quality: "good" });
    expect(normalizeOpcuaValue("hi", "string")).toEqual({ value: "hi", quality: "good" });
  });

  it("json parses string and serializes objects", () => {
    expect(normalizeOpcuaValue('{"a":1}', "json")).toEqual({ value: '{"a":1}', quality: "good" });
    expect(normalizeOpcuaValue({ a: 1 }, "json")).toEqual({ value: '{"a":1}', quality: "good" });
  });

  it("json invalid string → bad", () => {
    expect(normalizeOpcuaValue("not json", "json")).toEqual({ value: null, quality: "bad" });
  });

  it("non-numeric int/float → bad", () => {
    expect(normalizeOpcuaValue("abc", "int")).toEqual({ value: null, quality: "bad" });
    expect(normalizeOpcuaValue("abc", "float")).toEqual({ value: null, quality: "bad" });
  });
});

// ── doc 81 Đợt 1B Task 12 — nsu= + ép kiểu ghi theo DataType của node ─────────────
// Oracle ĐỘC LẬP: mã DataType dựng sẵn theo OPC UA Part 6 §5.1.2 (Boolean=1 … String=12)
// và miền giá trị theo Part 3/Part 6 (Byte 0..255, Int16 −32768..32767, …) — gõ tay ở đây,
// KHÔNG lấy từ node-opcua hay từ mã sản phẩm.
const SPEC = { Boolean: 1, SByte: 2, Byte: 3, Int16: 4, UInt16: 5, Int32: 6, UInt32: 7, Int64: 8, UInt64: 9, Float: 10, Double: 11, String: 12 };

describe("parseOpcuaAddress — nsu= (Task 12)", () => {
  it("accepts nsu=<uri>;<id> and exposes namespaceUri + identifier", () => {
    const p = parseOpcuaAddress("nsu=urn:host:Server;s=Line1.Temp");
    expect(p.namespaceUri).toBe("urn:host:Server");
    expect(p.identifier).toBe("s=Line1.Temp");
    const q = parseOpcuaAddress("nsu=http://www.siemens.com/simatic-s7-opcua;i=42");
    expect(q.namespaceUri).toBe("http://www.siemens.com/simatic-s7-opcua");
    expect(q.identifier).toBe("i=42");
  });
  it("ns= form has no namespaceUri (unchanged)", () => {
    expect(parseOpcuaAddress("ns=2;s=Foo").namespaceUri).toBeUndefined();
  });
  it("rejects empty uri / missing identifier", () => {
    expect(() => parseOpcuaAddress("nsu=;s=Foo")).toThrow(/invalid OPC-UA nodeId/);
    expect(() => parseOpcuaAddress("nsu=urn:x")).toThrow(/invalid OPC-UA nodeId/);
    expect(() => parseOpcuaAddress("nsu=urn:x;s=")).toThrow(/invalid OPC-UA nodeId/);
  });
});

describe("coerceOpcuaWriteValue — typed write per node DataType (Task 12)", () => {
  const ok = (raw: unknown, t: number) => {
    const r = coerceOpcuaWriteValue(raw, t);
    if (!r.ok) throw new Error(`expected ok for raw=${String(raw)} type=${t}, got ${r.error}`);
    return r;
  };
  const bad = (raw: unknown, t: number) => {
    const r = coerceOpcuaWriteValue(raw, t);
    expect(r.ok, `raw=${String(raw)} type=${t}`).toBe(false);
    return r;
  };

  it("returns the node's builtin type id (not Int32/Double)", () => {
    expect(ok(3.25, SPEC.Float)).toEqual({ ok: true, dataType: SPEC.Float, value: 3.25 });
    expect(ok(-1234, SPEC.Int16)).toEqual({ ok: true, dataType: SPEC.Int16, value: -1234 });
    expect(ok(65000, SPEC.UInt16)).toEqual({ ok: true, dataType: SPEC.UInt16, value: 65000 });
    expect(ok(4000000000, SPEC.UInt32)).toEqual({ ok: true, dataType: SPEC.UInt32, value: 4000000000 });
    expect(ok(200, SPEC.Byte)).toEqual({ ok: true, dataType: SPEC.Byte, value: 200 });
    expect(ok(-5, SPEC.SByte)).toEqual({ ok: true, dataType: SPEC.SByte, value: -5 });
    expect(ok(123456, SPEC.Int32)).toEqual({ ok: true, dataType: SPEC.Int32, value: 123456 });
    expect(ok(1.5, SPEC.Double)).toEqual({ ok: true, dataType: SPEC.Double, value: 1.5 });
    expect(ok("abc", SPEC.String)).toEqual({ ok: true, dataType: SPEC.String, value: "abc" });
    expect(ok(true, SPEC.Boolean)).toEqual({ ok: true, dataType: SPEC.Boolean, value: true });
  });

  it("integer range limits (Part 3 builtin ranges)", () => {
    ok(0, SPEC.Byte); ok(255, SPEC.Byte); bad(256, SPEC.Byte); bad(-1, SPEC.Byte);
    ok(-128, SPEC.SByte); ok(127, SPEC.SByte); bad(128, SPEC.SByte); bad(-129, SPEC.SByte);
    ok(-32768, SPEC.Int16); ok(32767, SPEC.Int16); bad(32768, SPEC.Int16); bad(-32769, SPEC.Int16);
    ok(0, SPEC.UInt16); ok(65535, SPEC.UInt16); bad(65536, SPEC.UInt16); bad(-1, SPEC.UInt16);
    ok(-2147483648, SPEC.Int32); ok(2147483647, SPEC.Int32); bad(2147483648, SPEC.Int32); bad(-2147483649, SPEC.Int32);
    ok(0, SPEC.UInt32); ok(4294967295, SPEC.UInt32); bad(4294967296, SPEC.UInt32); bad(-1, SPEC.UInt32);
    ok(-9007199254740991, SPEC.Int64); bad(2 ** 60, SPEC.Int64); bad(-1, SPEC.UInt64); ok(9007199254740991, SPEC.UInt64);
  });

  it("integer target: non-integer rejected, float noise within 1e-9 rounded", () => {
    bad(12.5, SPEC.Int16);
    expect(ok(0.3 / 0.1, SPEC.Int16).value).toBe(3);
  });

  it("Float: finite and |v| <= 3.4028234663852886e38", () => {
    ok(3.4028234663852886e38, SPEC.Float);
    bad(1e39, SPEC.Float);
    bad(-1e39, SPEC.Float);
    bad(Number.NaN, SPEC.Float);
    bad(Number.POSITIVE_INFINITY, SPEC.Double);
  });

  it("numeric strings / booleans accepted for numeric targets; garbage rejected", () => {
    expect(ok("42", SPEC.UInt16).value).toBe(42);
    expect(ok(true, SPEC.Byte).value).toBe(1);
    bad("abc", SPEC.Int16);
    bad("", SPEC.Double);
    bad(null, SPEC.Int32);
  });

  it("Boolean domain: true/false, 0/1, 'true'/'false'/'1'/'0' only", () => {
    expect(ok(1, SPEC.Boolean).value).toBe(true);
    expect(ok(0, SPEC.Boolean).value).toBe(false);
    expect(ok("false", SPEC.Boolean).value).toBe(false);
    expect(ok("TRUE", SPEC.Boolean).value).toBe(true);
    bad(2, SPEC.Boolean);
    bad("yes", SPEC.Boolean);
  });

  it("unsupported builtin types (DateTime=13, ByteString=15, …) → ok:false with reason", () => {
    const r = bad(1, 13);
    expect(r.ok === false && r.error).toMatch(/unsupported/i);
  });
});
