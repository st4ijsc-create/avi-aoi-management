/**
 * SECS/GEM Connectivity FRAMEWORK — unit tests.
 *
 * Covers:
 *   - SECS-II item encode/decode round-trip for the implemented formats,
 *   - GEM message factories + body round-trip (S6F11, S5F1, S1F13),
 *   - HSMS framing/parse + the Select/Linktest/Separate state machine (mock socket),
 *   - GEM event → process_results / S5F1 → alarm / SV → ot_telemetry mappers,
 *   - flag-off no-op + fail-safe behaviour.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

import {
  Item,
  encodeItem,
  decodeItem,
  s1f13,
  s5f1,
  s6f11,
  type SecsItem,
} from "./secsMessages";
import {
  frameControl,
  frameHsms,
  parseHsmsFrames,
  SType,
  HsmsClient,
} from "./hsmsClient";
import {
  GemModel,
  mapEventReportToProcessResult,
  mapAlarmToAndon,
  mapStatusVariablesToTelemetry,
} from "./gemModel";
import {
  isSecsGemEnabled,
  listSecsGemKeys,
  createSecsGem,
  registerSecsGem,
  createSkeletonSecsGem,
  _clearSecsGemRegistry,
} from "./secsGemRegistry";

// ─── SECS-II codec round-trip ─────────────────────────────────────────────────

describe("SECS-II item codec", () => {
  function roundtrip(item: SecsItem): SecsItem {
    return decodeItem(encodeItem(item));
  }

  it("round-trips ASCII", () => {
    expect(roundtrip(Item.A("MODEL-X1"))).toEqual({ format: "A", value: "MODEL-X1" });
  });

  it("round-trips BOOLEAN array", () => {
    expect(roundtrip(Item.BOOLEAN(true, false, true))).toEqual({
      format: "BOOLEAN",
      value: [true, false, true],
    });
  });

  it("round-trips BINARY", () => {
    expect(roundtrip(Item.BINARY(0x80, 0x00, 0xff))).toEqual({
      format: "BINARY",
      value: [0x80, 0x00, 0xff],
    });
  });

  it("round-trips U1/U2/U4", () => {
    expect(roundtrip(Item.U1(0, 255))).toEqual({ format: "U1", value: [0, 255] });
    expect(roundtrip(Item.U2(0, 65535))).toEqual({ format: "U2", value: [0, 65535] });
    expect(roundtrip(Item.U4(0, 4294967295))).toEqual({ format: "U4", value: [0, 4294967295] });
  });

  it("round-trips a nested list", () => {
    const item = Item.L(Item.A("a"), Item.L(Item.U4(7), Item.BOOLEAN(true)));
    expect(roundtrip(item)).toEqual(item);
  });

  it("throws on out-of-range unsigned", () => {
    expect(() => encodeItem(Item.U1(256))).toThrowError(/out of range/);
  });

  it("uses 2 length bytes when payload exceeds 255 bytes", () => {
    const long = "x".repeat(300);
    const buf = encodeItem(Item.A(long));
    // format byte low 2 bits = number of length bytes
    expect(buf[0] & 0x03).toBe(2);
    expect(decodeItem(buf)).toEqual({ format: "A", value: long });
  });
});

describe("GEM message factories", () => {
  it("S1F13 carries MDLN + SOFTREV and round-trips", () => {
    const msg = s1f13("EQ-100", "1.2.3");
    expect(msg.stream).toBe(1);
    expect(msg.function).toBe(13);
    expect(msg.reply).toBe(true);
    expect(decodeItem(encodeItem(msg.body))).toEqual(msg.body);
  });

  it("S5F1 sets ALCD bit7 when set=true", () => {
    const set = s5f1(42, "Door open", true);
    const cleared = s5f1(42, "Door open", false);
    expect((set.body.format === "L" && set.body.value[0])).toEqual({ format: "BINARY", value: [0x80] });
    expect((cleared.body.format === "L" && cleared.body.value[0])).toEqual({ format: "BINARY", value: [0x00] });
  });

  it("S6F11 body round-trips with reports", () => {
    const msg = s6f11(1, 1001, [{ rptId: 5, values: [Item.U4(7), Item.A("OK")] }]);
    expect(decodeItem(encodeItem(msg.body))).toEqual(msg.body);
  });
});

// ─── HSMS framing + state machine ──────────────────────────────────────────────

describe("HSMS framing", () => {
  it("frames with a 4-byte length covering header+body", () => {
    const f = frameControl(0, SType.SELECT_REQ);
    expect(f.readUInt32BE(0)).toBe(10); // header only, no body
    expect(f[5 + 4]).toBe(SType.SELECT_REQ); // sType at header offset 5 (+4 length)
  });

  it("parses concatenated frames and returns the partial remainder", () => {
    const a = frameControl(0, SType.SELECT_RSP);
    const b = frameControl(0, SType.LINKTEST_RSP);
    const partial = b.subarray(0, 3);
    const { frames, rest } = parseHsmsFrames(Buffer.concat([a, b, partial]));
    expect(frames.map((x) => x.sType)).toEqual([SType.SELECT_RSP, SType.LINKTEST_RSP]);
    expect(rest.length).toBe(3);
  });

  it("frameHsms + parse preserve the body bytes", () => {
    const header = frameControl(0, SType.DATA).subarray(4, 14);
    const body = Buffer.from([1, 2, 3, 4]);
    const { frames } = parseHsmsFrames(frameHsms(header, body));
    expect(frames[0].body).toEqual(body);
  });
});

/** A mock net.Socket that auto-replies to HSMS control requests. */
class MockSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;
  write(buf: Buffer): boolean {
    this.written.push(buf);
    const { frames } = parseHsmsFrames(buf);
    for (const f of frames) {
      // Reply Select.req → Select.rsp, Linktest.req → Linktest.rsp.
      if (f.sType === SType.SELECT_REQ) this.replyControl(SType.SELECT_RSP);
      else if (f.sType === SType.LINKTEST_REQ) this.replyControl(SType.LINKTEST_RSP);
    }
    return true;
  }
  replyControl(sType: number): void {
    const reply = frameControl(0, sType);
    // emit asynchronously like a real socket
    setImmediate(() => this.emit("data", reply));
  }
  destroy(): void {
    this.destroyed = true;
  }
  off(event: string, listener: (...args: unknown[]) => void): this {
    return this.removeListener(event, listener) as unknown as this;
  }
}

describe("HsmsClient state machine (mock socket)", () => {
  let mock: MockSocket;

  beforeEach(() => {
    mock = new MockSocket();
    vi.resetModules();
  });

  it("connect → select → linktest → separate transitions", async () => {
    const net = await import("node:net");
    const connectSpy = vi.spyOn(net.default, "connect").mockImplementation(((..._args: unknown[]) => {
      setImmediate(() => mock.emit("connect"));
      return mock as unknown as import("node:net").Socket;
    }) as typeof net.default.connect);

    const client = new HsmsClient({ host: "127.0.0.1", port: 5000, controlTimeoutMs: 1000 });
    expect(client.state).toBe("NOT_CONNECTED");

    await client.connect();
    expect(client.state).toBe("CONNECTED");

    await client.select();
    expect(client.state).toBe("SELECTED");

    await client.linktest(); // resolves on Linktest.rsp

    await client.separate();
    expect(client.state).toBe("SEPARATED");
    expect(mock.destroyed).toBe(true);

    connectSpy.mockRestore();
  });

  it("testConnection returns ok:true with the honesty caveat", async () => {
    const net = await import("node:net");
    const connectSpy = vi.spyOn(net.default, "connect").mockImplementation(((..._args: unknown[]) => {
      setImmediate(() => mock.emit("connect"));
      return mock as unknown as import("node:net").Socket;
    }) as typeof net.default.connect);

    const client = new HsmsClient({ host: "127.0.0.1", port: 5000, controlTimeoutMs: 1000 });
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    expect(res.selected).toBe(true);
    expect(res.linktestOk).toBe(true);
    expect(res.caveat).toMatch(/FRAMEWORK skeleton/);

    connectSpy.mockRestore();
  });

  it("testConnection is fail-safe on connect error (never throws)", async () => {
    const net = await import("node:net");
    const connectSpy = vi.spyOn(net.default, "connect").mockImplementation(((..._args: unknown[]) => {
      setImmediate(() => mock.emit("error", new Error("ECONNREFUSED")));
      return mock as unknown as import("node:net").Socket;
    }) as typeof net.default.connect);

    const client = new HsmsClient({ host: "127.0.0.1", port: 1, connectTimeoutMs: 500 });
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ECONNREFUSED/);
    expect(res.caveat).toMatch(/FRAMEWORK skeleton/);

    connectSpy.mockRestore();
  });
});

// ─── GEM event → platform-row mappers ─────────────────────────────────────────

function makeModel(): GemModel {
  return new GemModel({
    machineCode: "M-001",
    modelName: "EQ-100",
    softRev: "1.0",
    statusVariables: [
      { svid: 10, name: "ChamberTemp", tagKey: "chamber_temp", unit: "C" },
      { svid: 11, name: "Running", tagKey: "running" },
    ],
    alarms: [{ alid: 42, name: "Door open", reason: "safety" }],
  });
}

describe("GEM mappers", () => {
  it("S6F11 → process_results row (metrics carry CEID + report values)", () => {
    const msg = s6f11(1, 1001, [{ rptId: 5, values: [Item.U4(7), Item.A("OK")] }]);
    const row = mapEventReportToProcessResult(msg, 123, { serialNumber: "SN1", lineCode: "L1" });
    expect(row.machineId).toBe(123);
    expect(row.stepType).toBe("gem-event");
    expect(row.result).toBe("skip");
    expect(row.serialNumber).toBe("SN1");
    expect(row.metrics).toMatchObject({ ceid: 1001, r5_v0: 7, r5_v1: "OK" });
    expect(row.measuredAt).toBeInstanceOf(Date);
  });

  it("S5F1 set → red Andon alarm; clear → yellow", () => {
    const model = makeModel();
    const setMsg = s5f1(42, "Door open", true);
    const clearMsg = s5f1(42, "Door open", false);

    const setRec = mapAlarmToAndon(setMsg, "M-001", 123, model.alarms.get(42));
    expect(setRec.state).toBe("red");
    expect(setRec.set).toBe(true);
    expect(setRec.reason).toBe("safety");
    expect(setRec.alid).toBe(42);
    expect(setRec.machineId).toBe(123);
    expect(setRec.raisedBySystem).toBe(true);
    expect(setRec.title).toContain("42");

    const clearRec = mapAlarmToAndon(clearMsg, "M-001", 123, model.alarms.get(42));
    expect(clearRec.state).toBe("yellow");
    expect(clearRec.set).toBe(false);
  });

  it("SV poll → ot_telemetry rows using the configured tagKey", () => {
    const model = makeModel();
    const rows = mapStatusVariablesToTelemetry(
      [
        { svid: 10, value: 23.5 },
        { svid: 11, value: true },
        { svid: 99, value: "x" }, // unknown SVID → fallback tagKey
      ],
      model,
      777,
      123,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ adapterId: 777, machineId: 123, tagKey: "chamber_temp", valueNumeric: "23.5" });
    expect(rows[1]).toMatchObject({ tagKey: "running", valueText: "true" });
    expect(rows[2]).toMatchObject({ tagKey: "SVID_99", valueText: "x" });
  });

  it("GEM state transitions update comm/control state", () => {
    const model = makeModel();
    expect(model.commState).toBe("DISABLED");
    expect(model.controlState).toBe("OFFLINE");
    model.onCommunicationsEstablished();
    model.setControlState("ONLINE_REMOTE");
    expect(model.commState).toBe("ENABLED_COMMUNICATING");
    expect(model.controlState).toBe("ONLINE_REMOTE");
  });
});

// ─── Registry + flag ──────────────────────────────────────────────────────────

describe("secsGem registry + flag", () => {
  beforeEach(() => {
    _clearSecsGemRegistry();
    delete process.env.SECS_GEM_ENABLED;
  });

  it("flag defaults OFF", () => {
    expect(isSecsGemEnabled()).toBe(false);
    process.env.SECS_GEM_ENABLED = "true";
    expect(isSecsGemEnabled()).toBe(true);
  });

  it("createSecsGem throws for an unknown key", () => {
    expect(() => createSecsGem("nope", { host: "h", port: 1 }, { machineCode: "M", modelName: "E", softRev: "1" })).toThrowError(
      /No SECS\/GEM connector registered/,
    );
  });

  it("registered factory builds a connector that opens nothing", () => {
    registerSecsGem("secsgem", createSkeletonSecsGem);
    expect(listSecsGemKeys()).toEqual(["secsgem"]);
    const conn = createSecsGem("secsgem", { host: "h", port: 5000 }, { machineCode: "M-1", modelName: "EQ", softRev: "1" });
    expect(conn.hsms.state).toBe("NOT_CONNECTED"); // lazy — no socket opened
    expect(conn.gem.config.machineCode).toBe("M-1");
  });
});
