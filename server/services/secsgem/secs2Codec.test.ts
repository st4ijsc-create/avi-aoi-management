/**
 * SECS-II full item codec + standard S1 messages — unit tests.
 *
 * Covers:
 *   - round-trip (encode∘decode == identity) for EVERY supported format code,
 *   - min/max boundary values for each integer width + 64-bit bigint,
 *   - float round-trips (F4/F8) incl. negatives / fractions / specials,
 *   - deeply nested lists (list-of-lists) and mixed-type lists,
 *   - correct length-byte-width selection + big-endian on the wire,
 *   - explicit range-check throws,
 *   - S1F1/S1F2/S1F13/S1F14 builders + parsers (round-trip through the codec),
 *   - hsmsClient wiring: a real S1F1 is emitted and an injected S1F2 is parsed
 *     via probeOnline() over a mock socket, gated on SECS_GEM_ENABLED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

import {
  I,
  Secs2Format,
  encodeItem,
  decodeItem,
  decodeItemWithLength,
  type Secs2Item,
} from "./secs2Codec";
import {
  s1f1,
  s1f2,
  s1f13,
  s1f14,
  parseS1F2,
  parseS1F13,
  parseS1F14,
  encodeBody,
  decodeBody,
  COMMACK,
} from "./s1Messages";
import {
  frameControl,
  frameSecs2Message,
  frameStreamFunction,
  parseHsmsFrames,
  decodeFrameBodySecs2,
  SType,
  HsmsClient,
} from "./hsmsClient";

// ─── generic round-trip helper ────────────────────────────────────────────────

function roundtrip(item: Secs2Item): Secs2Item {
  return decodeItem(encodeItem(item));
}

// ─── per-format round-trips ───────────────────────────────────────────────────

describe("SECS-II codec — per-format round-trip", () => {
  it("A (ASCII) — including 8-bit latin1 bytes", () => {
    expect(roundtrip(I.A("MODEL-X1"))).toEqual({ format: "A", value: "MODEL-X1" });
    expect(roundtrip(I.A(""))).toEqual({ format: "A", value: "" });
    const hi = String.fromCharCode(0xff, 0x00, 0x41);
    expect(roundtrip(I.A(hi))).toEqual({ format: "A", value: hi });
  });

  it("B (binary)", () => {
    expect(roundtrip(I.B(0x00, 0x80, 0xff))).toEqual({ format: "B", value: [0x00, 0x80, 0xff] });
    expect(roundtrip(I.B())).toEqual({ format: "B", value: [] });
  });

  it("BOOLEAN — non-zero decodes to true, zero to false", () => {
    expect(roundtrip(I.BOOLEAN(true, false, true))).toEqual({
      format: "BOOLEAN",
      value: [true, false, true],
    });
  });

  it("U1/U2/U4 — min and max", () => {
    expect(roundtrip(I.U1(0, 255))).toEqual({ format: "U1", value: [0, 255] });
    expect(roundtrip(I.U2(0, 65535))).toEqual({ format: "U2", value: [0, 65535] });
    expect(roundtrip(I.U4(0, 4294967295))).toEqual({ format: "U4", value: [0, 4294967295] });
  });

  it("U8 — full unsigned 64-bit via bigint", () => {
    const max = 2n ** 64n - 1n;
    expect(roundtrip(I.U8(0n, 1n, max))).toEqual({ format: "U8", value: [0n, 1n, max] });
  });

  it("I1/I2/I4 — signed min and max", () => {
    expect(roundtrip(I.I1(-128, 127, -1))).toEqual({ format: "I1", value: [-128, 127, -1] });
    expect(roundtrip(I.I2(-32768, 32767))).toEqual({ format: "I2", value: [-32768, 32767] });
    expect(roundtrip(I.I4(-2147483648, 2147483647))).toEqual({
      format: "I4",
      value: [-2147483648, 2147483647],
    });
  });

  it("I8 — full signed 64-bit via bigint", () => {
    const min = -(2n ** 63n);
    const max = 2n ** 63n - 1n;
    expect(roundtrip(I.I8(min, 0n, max, -1n))).toEqual({ format: "I8", value: [min, 0n, max, -1n] });
  });

  it("F4 (single) — sign, fraction, exact powers of two", () => {
    // Values exactly representable in float32 so equality holds after round-trip.
    expect(roundtrip(I.F4(0, 1, -1, 0.5, -0.25, 1024))).toEqual({
      format: "F4",
      value: [0, 1, -1, 0.5, -0.25, 1024],
    });
  });

  it("F8 (double) — arbitrary doubles are exact", () => {
    expect(roundtrip(I.F8(0, -0.1, 3.141592653589793, 1e308, -1e-308))).toEqual({
      format: "F8",
      value: [0, -0.1, 3.141592653589793, 1e308, -1e-308],
    });
  });

  it("F4/F8 — NaN and Infinity survive the round-trip", () => {
    const rt4 = roundtrip(I.F4(NaN, Infinity, -Infinity)) as { format: "F4"; value: number[] };
    expect(rt4.value[0]).toBeNaN();
    expect(rt4.value[1]).toBe(Infinity);
    expect(rt4.value[2]).toBe(-Infinity);
    const rt8 = roundtrip(I.F8(NaN, Infinity, -Infinity)) as { format: "F8"; value: number[] };
    expect(rt8.value[0]).toBeNaN();
    expect(rt8.value[1]).toBe(Infinity);
    expect(rt8.value[2]).toBe(-Infinity);
  });

  it("empty list", () => {
    expect(roundtrip(I.L())).toEqual({ format: "L", value: [] });
  });
});

// ─── nesting ──────────────────────────────────────────────────────────────────

describe("SECS-II codec — nesting", () => {
  it("mixed-type single-level list", () => {
    const item = I.L(I.A("id"), I.U4(7), I.BOOLEAN(true), I.F8(1.5), I.B(0xaa));
    expect(roundtrip(item)).toEqual(item);
  });

  it("list of lists (2 levels)", () => {
    const item = I.L(I.A("a"), I.L(I.U4(7), I.BOOLEAN(true)));
    expect(roundtrip(item)).toEqual(item);
  });

  it("deeply nested list (4 levels) with every numeric width at the leaves", () => {
    const item = I.L(
      I.I1(-5),
      I.L(
        I.U2(300),
        I.L(
          I.I8(1234567890123n),
          I.L(I.U8(18446744073709551615n), I.F4(0.5), I.A("deep")),
        ),
      ),
    );
    expect(roundtrip(item)).toEqual(item);
  });

  it("list containing many empty lists", () => {
    const item = I.L(I.L(), I.L(I.L()), I.L());
    expect(roundtrip(item)).toEqual(item);
  });
});

// ─── wire-format assertions ───────────────────────────────────────────────────

describe("SECS-II codec — wire format", () => {
  it("format byte packs the 6-bit code and 2-bit length-byte count", () => {
    const buf = encodeItem(I.U4(1));
    expect((buf[0] >>> 2) & 0x3f).toBe(Secs2Format.U4);
    expect(buf[0] & 0x03).toBe(1); // 4 data bytes ≤ 255 → 1 length byte
  });

  it("selects 2 length bytes when the payload exceeds 255 bytes", () => {
    const long = "x".repeat(300);
    const buf = encodeItem(I.A(long));
    expect(buf[0] & 0x03).toBe(2);
    expect(buf.readUInt16BE(1)).toBe(300); // big-endian length
    expect(decodeItem(buf)).toEqual({ format: "A", value: long });
  });

  it("selects 3 length bytes past 65535 bytes", () => {
    const long = "y".repeat(70000);
    const buf = encodeItem(I.A(long));
    expect(buf[0] & 0x03).toBe(3);
    expect(buf.readUIntBE(1, 3)).toBe(70000);
    expect(decodeItem(buf)).toEqual({ format: "A", value: long });
  });

  it("numerics are big-endian on the wire", () => {
    const buf = encodeItem(I.U4(0x01020304));
    // [format][len=4][01 02 03 04]
    expect([...buf.subarray(2)]).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it("list length is ELEMENT count, not byte count", () => {
    const buf = encodeItem(I.L(I.U1(1), I.U1(2), I.U1(3)));
    expect((buf[0] >>> 2) & 0x3f).toBe(Secs2Format.L);
    expect(buf[1]).toBe(3); // three child elements
  });

  it("decodeItemWithLength reports the exact consumed byte count", () => {
    const buf = encodeItem(I.L(I.A("hi"), I.U2(1)));
    const { item, consumed } = decodeItemWithLength(buf);
    expect(consumed).toBe(buf.length);
    expect(item).toEqual(I.L(I.A("hi"), I.U2(1)));
  });
});

// ─── range checks + fail-safe decode ──────────────────────────────────────────

describe("SECS-II codec — validation", () => {
  it("throws on out-of-range U1/U2/U4", () => {
    expect(() => encodeItem(I.U1(256))).toThrowError(/out of range/);
    expect(() => encodeItem(I.U2(65536))).toThrowError(/out of range/);
    expect(() => encodeItem(I.U4(4294967296))).toThrowError(/out of range/);
  });

  it("throws on out-of-range signed ints", () => {
    expect(() => encodeItem(I.I1(128))).toThrowError(/out of range/);
    expect(() => encodeItem(I.I1(-129))).toThrowError(/out of range/);
    expect(() => encodeItem(I.I8(2n ** 63n))).toThrowError(/out of range/);
    expect(() => encodeItem(I.U8(-1n))).toThrowError(/out of range/);
    expect(() => encodeItem(I.U8(2n ** 64n))).toThrowError(/out of range/);
  });

  it("throws on out-of-range binary byte", () => {
    expect(() => encodeItem(I.B(256))).toThrowError(/out of range/);
    expect(() => encodeItem(I.B(-1))).toThrowError(/out of range/);
  });

  it("throws on an unsupported/illegal format code while decoding", () => {
    // format code 0o21 (JIS-8, unsupported) with 1 length byte = 0.
    const bad = Buffer.from([(0o21 << 2) | 1, 0]);
    expect(() => decodeItem(bad)).toThrowError(/unsupported format code/);
  });

  it("throws on a length-byte count of 0 (illegal)", () => {
    const bad = Buffer.from([(Secs2Format.U1 << 2) | 0]);
    expect(() => decodeItem(bad)).toThrowError(/illegal length-byte count/);
  });

  it("throws on truncated numeric data", () => {
    // U4 declares 4 bytes but only 2 are present.
    const bad = Buffer.from([(Secs2Format.U4 << 2) | 1, 4, 0x01, 0x02]);
    expect(() => decodeItem(bad)).toThrowError(/truncated data/);
  });

  it("throws when a numeric byte-count is not a multiple of the element width", () => {
    // U2 (width 2) with 3 data bytes.
    const bad = Buffer.from([(Secs2Format.U2 << 2) | 1, 3, 0x00, 0x01, 0x02]);
    expect(() => decodeItem(bad)).toThrowError(/not a multiple of element width/);
  });
});

// ─── standard S1 messages ─────────────────────────────────────────────────────

describe("S1 messages — builders/parsers", () => {
  it("S1F1 is Are-You-There with W-bit and an empty-list body", () => {
    const m = s1f1();
    expect(m.stream).toBe(1);
    expect(m.streamFunction).toBe(1);
    expect(m.wbit).toBe(true);
    expect(m.body).toEqual({ format: "L", value: [] });
    expect(decodeBody(encodeBody(m))).toEqual(m.body);
  });

  it("S1F2 carries MDLN + SOFTREV and parses back", () => {
    const m = s1f2({ modelName: "EQ-100", softRev: "1.2.3" });
    expect(m.streamFunction).toBe(2);
    expect(m.wbit).toBe(false);
    const decoded = decodeBody(encodeBody(m));
    expect(decoded).toEqual(m.body);
    expect(parseS1F2(decoded)).toEqual({ modelName: "EQ-100", softRev: "1.2.3" });
  });

  it("parseS1F2 tolerates an empty-list reply (liveness only)", () => {
    expect(parseS1F2(I.L())).toEqual({ modelName: "", softRev: "" });
  });

  it("parseS1F2 returns null when the body is not a list", () => {
    expect(parseS1F2(I.A("nope"))).toBeNull();
  });

  it("S1F13 Establish Communications Request round-trips + parses", () => {
    const m = s1f13({ modelName: "TOOL-7", softRev: "9.9" });
    expect(m.streamFunction).toBe(13);
    expect(m.wbit).toBe(true);
    const decoded = decodeBody(encodeBody(m));
    expect(decoded).toEqual(m.body);
    expect(parseS1F13(decoded)).toEqual({ modelName: "TOOL-7", softRev: "9.9" });
  });

  it("S1F14 wraps COMMACK + inner MDLN/SOFTREV and parses (accepted)", () => {
    const m = s1f14(COMMACK.ACCEPTED, { modelName: "TOOL-7", softRev: "9.9" });
    expect(m.streamFunction).toBe(14);
    expect(m.wbit).toBe(false);
    const decoded = decodeBody(encodeBody(m));
    expect(decoded).toEqual(m.body);
    const parsed = parseS1F14(decoded);
    expect(parsed).toEqual({
      commack: 0,
      accepted: true,
      data: { modelName: "TOOL-7", softRev: "9.9" },
    });
  });

  it("S1F14 with COMMACK denied parses accepted:false", () => {
    const m = s1f14(COMMACK.DENIED_TRY_AGAIN, { modelName: "X", softRev: "1" });
    const parsed = parseS1F14(decodeBody(encodeBody(m)));
    expect(parsed?.accepted).toBe(false);
    expect(parsed?.commack).toBe(1);
  });
});

// ─── hsmsClient wiring ────────────────────────────────────────────────────────

describe("hsmsClient — SECS-II data framing", () => {
  it("frameSecs2Message sets Stream/Function/W-bit in the header and a decodable body", () => {
    const frame = frameSecs2Message(0, s1f13({ modelName: "EQ", softRev: "1" }));
    const { frames } = parseHsmsFrames(frame);
    expect(frames).toHaveLength(1);
    const sf = frameStreamFunction(frames[0]);
    expect(sf).toEqual({ stream: 1, function: 13, wbit: true });
    expect(frames[0].sType).toBe(SType.DATA);
    const body = decodeFrameBodySecs2(frames[0]);
    expect(parseS1F13(body!)).toEqual({ modelName: "EQ", softRev: "1" });
  });

  it("decodeFrameBodySecs2 returns null for control frames / empty bodies", () => {
    const { frames } = parseHsmsFrames(frameControl(0, SType.SELECT_RSP));
    expect(decodeFrameBodySecs2(frames[0])).toBeNull();
  });
});

/**
 * Mock socket that, on receiving an S1F1 DATA frame, replies with a real
 * codec-encoded S1F2 carrying model/softrev — exercising the send+decode path.
 */
class ProbeMockSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;
  constructor(private readonly reply: { modelName: string; softRev: string }) {
    super();
  }
  write(buf: Buffer): boolean {
    this.written.push(buf);
    const { frames } = parseHsmsFrames(buf);
    for (const f of frames) {
      if (f.sType === SType.SELECT_REQ) this.emitLater(frameControl(0, SType.SELECT_RSP));
      else if (f.sType === SType.LINKTEST_REQ) this.emitLater(frameControl(0, SType.LINKTEST_RSP));
      else if (f.sType === SType.DATA) {
        const sf = frameStreamFunction(f);
        if (sf.stream === 1 && sf.function === 1) {
          this.emitLater(frameSecs2Message(0, s1f2(this.reply)));
        }
      }
    }
    return true;
  }
  private emitLater(frame: Buffer): void {
    setImmediate(() => this.emit("data", frame));
  }
  destroy(): void {
    this.destroyed = true;
  }
  off(event: string, listener: (...args: unknown[]) => void): this {
    return this.removeListener(event, listener) as unknown as this;
  }
}

describe("hsmsClient.probeOnline — real S1F1 out, S1F2 parsed in", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SECS_GEM_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.SECS_GEM_ENABLED;
  });

  async function connectSelected(mock: ProbeMockSocket): Promise<HsmsClient> {
    const net = await import("node:net");
    vi.spyOn(net.default, "connect").mockImplementation(((..._args: unknown[]) => {
      setImmediate(() => mock.emit("connect"));
      return mock as unknown as import("node:net").Socket;
    }) as typeof net.default.connect);
    const client = new HsmsClient({ host: "127.0.0.1", port: 5000, controlTimeoutMs: 1000 });
    await client.connect();
    await client.select();
    return client;
  }

  it("sends a real S1F1 and returns the parsed S1F2 online data", async () => {
    const mock = new ProbeMockSocket({ modelName: "EQ-100", softRev: "1.2.3" });
    const client = await connectSelected(mock);

    const online = await client.probeOnline();
    expect(online).toEqual({ modelName: "EQ-100", softRev: "1.2.3" });

    // The client actually emitted an S1F1 DATA frame (W-bit set, empty body).
    const dataFrames = mock.written
      .flatMap((b) => parseHsmsFrames(b).frames)
      .filter((f) => f.sType === SType.DATA);
    expect(dataFrames).toHaveLength(1);
    expect(frameStreamFunction(dataFrames[0])).toEqual({ stream: 1, function: 1, wbit: true });
    expect(decodeFrameBodySecs2(dataFrames[0])).toEqual({ format: "L", value: [] });

    vi.restoreAllMocks();
  });

  it("throws when the flag is OFF (no S1F1 emitted)", async () => {
    const mock = new ProbeMockSocket({ modelName: "EQ", softRev: "1" });
    const client = await connectSelected(mock);
    delete process.env.SECS_GEM_ENABLED; // disable AFTER select
    await expect(client.probeOnline()).rejects.toThrow(/disabled/);
    const dataFrames = mock.written
      .flatMap((b) => parseHsmsFrames(b).frames)
      .filter((f) => f.sType === SType.DATA);
    expect(dataFrames).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("throws when not SELECTED", async () => {
    process.env.SECS_GEM_ENABLED = "true";
    const client = new HsmsClient({ host: "127.0.0.1", port: 5000 });
    await expect(client.probeOnline()).rejects.toThrow(/requires SELECTED/);
  });
});
