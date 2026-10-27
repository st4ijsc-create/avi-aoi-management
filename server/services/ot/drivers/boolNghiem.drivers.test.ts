/**
 * SCADA R1b-2b-1 Task 2 (kiem-dinh G1) — MỌI driver ghi bool bằng MỘT luật (`boolChoGhi`): "false" / "0" ⇒ FALSE tới thư viện; "off" / "on" /
 * 2 ⇒ write ĐÓ ok:false và thư viện KHÔNG được gọi cho nó (lô không sập); STOP ĐÃ XÁC MINH (`dungGhim: true`, KD-T2) ⇒ khoan dung — ghim cũ 255
 * trên coil kiểu int ⇒ thiết bị nhận TRUE, không bao giờ bị driver chặn. Giải mã ĐỌC: "1" ⇒ true, chuỗi lạ ⇒ bad (+ lý do khi cờ V2 bật).
 * Thư viện giả (vi.doMock + vi.resetModules), không thiết bị thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OtWrite } from "../otDriver";

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("modbus-serial");
  vi.doUnmock("nodes7");
  vi.doUnmock("mcprotocol");
  vi.doUnmock("st-ethernet-ip");
  vi.doUnmock("node-opcua");
});

// ─────────────────────────────── Modbus ───────────────────────────────
function mockModbus() {
  const client = {
    connectTCP: vi.fn(async () => {}),
    setID: vi.fn(),
    setTimeout: vi.fn(),
    readHoldingRegisters: vi.fn(async () => ({ data: [0] })),
    readCoils: vi.fn(async () => ({ data: [true] })),
    writeCoil: vi.fn(async () => ({})),
    writeRegister: vi.fn(async () => ({})),
    writeRegisters: vi.fn(async () => ({})),
    close: vi.fn((cb: () => void) => cb()),
  };
  function ModbusRTU(this: Record<string, unknown>) {
    Object.assign(this, client);
  }
  vi.doMock("modbus-serial", () => ({ default: ModbusRTU }));
  return client;
}
async function modbus() {
  const client = mockModbus();
  const { ModbusDriver } = await import("./modbusDriver");
  const d = new ModbusDriver();
  await d.connect({ endpoint: "127.0.0.1" });
  return { d, client };
}

describe("Modbus coil — một luật bool bất kể dataType", () => {
  it('coil bool "false" ⇒ writeCoil(reg, false) (trước: Boolean("false") = TRUE)', async () => {
    const { d, client } = await modbus();
    const [r] = await d.writeTags([{ tagKey: "run", address: "coil:3", value: "false", dataType: "bool" }]);
    expect(r.ok).toBe(true);
    expect(client.writeCoil).toHaveBeenCalledTimes(1);
    expect(client.writeCoil).toHaveBeenCalledWith(2, false);
  });

  it('coil "0" / " FALSE " / 0 ⇒ false; "1" / "true" / 1 / true ⇒ true', async () => {
    const { d, client } = await modbus();
    const gt: Array<[unknown, boolean]> = [["0", false], [" FALSE ", false], [0, false], ["1", true], ["true", true], [1, true], [true, true]];
    for (const [v, k] of gt) {
      client.writeCoil.mockClear();
      const [r] = await d.writeTags([{ tagKey: "run", address: "coil:1", value: v, dataType: "bool" }]);
      expect(r.ok, JSON.stringify(v)).toBe(true);
      expect(client.writeCoil, JSON.stringify(v)).toHaveBeenCalledWith(0, k);
    }
  });

  it('coil "off" / "on" / 2 / {} ⇒ ok:false, client 0 lần; write hợp lệ cùng lô vẫn đi', async () => {
    const { d, client } = await modbus();
    for (const v of ["off", "on", 2, {}]) {
      client.writeCoil.mockClear();
      const [r] = await d.writeTags([{ tagKey: "run", address: "coil:1", value: v, dataType: "bool" }]);
      expect(r.ok, JSON.stringify(v)).toBe(false);
      expect(r.error).toMatch(/bool không hợp lệ/);
      expect(client.writeCoil).not.toHaveBeenCalled();
    }
    client.writeCoil.mockClear();
    const out = await d.writeTags([
      { tagKey: "a", address: "coil:1", value: "off", dataType: "bool" },
      { tagKey: "b", address: "coil:2", value: "0", dataType: "bool" },
    ]);
    expect(out.map((x) => x.ok)).toEqual([false, true]);
    expect(client.writeCoil).toHaveBeenCalledTimes(1);
    expect(client.writeCoil).toHaveBeenCalledWith(1, false);
  });

  it("coil kiểu INT (đường thường) 255 ⇒ ok:false — coil nhận bool chặt bất kể dataType", async () => {
    const { d, client } = await modbus();
    const [r] = await d.writeTags([{ tagKey: "dung", address: "coil:1", value: 255, dataType: "int" }]);
    expect(r.ok).toBe(false);
    expect(client.writeCoil).not.toHaveBeenCalled();
  });

  it("KD-T2: STOP ĐÃ XÁC MINH (dungGhim) lên coil kiểu int16 / uint16 với ghim 255 ⇒ driver ghi TRUE (không bao giờ chặn STOP); ghim 1 ⇒ TRUE; 0 ⇒ FALSE", async () => {
    const { d, client } = await modbus();
    for (const [v, k] of [[255, true], [1, true], [0, false], [2, true]] as const) {
      client.writeCoil.mockClear();
      const w: OtWrite = { tagKey: "dung", address: "coil:5", value: v, dataType: "int", dungGhim: true };
      const [r] = await d.writeTags([w]);
      expect(r.ok, String(v)).toBe(true);
      expect(client.writeCoil, String(v)).toHaveBeenCalledWith(4, k);
    }
  });

  it("holding kiểu bool: \"false\" ⇒ writeRegister(reg, 0); \"on\" ⇒ ok:false, 0 lần; STOP dungGhim 1 ⇒ 1", async () => {
    const { d, client } = await modbus();
    const [a] = await d.writeTags([{ tagKey: "h", address: "40002", value: "false", dataType: "bool" }]);
    expect(a.ok).toBe(true);
    expect(client.writeRegister).toHaveBeenCalledWith(1, 0);
    client.writeRegister.mockClear();
    const [b] = await d.writeTags([{ tagKey: "h", address: "40002", value: "on", dataType: "bool" }]);
    expect(b.ok).toBe(false);
    expect(client.writeRegister).not.toHaveBeenCalled();
    const [c] = await d.writeTags([{ tagKey: "h", address: "40002", value: true, dataType: "bool", dungGhim: true }]);
    expect(c.ok).toBe(true);
    expect(client.writeRegister).toHaveBeenCalledWith(1, 1);
  });

  it("vòng ghi → đọc qua thiết bị giả: coil ghi \"false\" rồi đọc lại ⇒ false (ghi và đọc cùng luật)", async () => {
    const client = mockModbus();
    let coil = true;
    client.writeCoil.mockImplementation(async (_r: number, v: boolean) => {
      coil = v;
      return {};
    });
    client.readCoils.mockImplementation(async () => ({ data: [coil] }));
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    for (const [v, k] of [["false", false], ["1", true], [" FALSE ", false], [true, true]] as const) {
      await d.writeTags([{ tagKey: "run", address: "coil:1", value: v, dataType: "bool" }]);
      const [s] = await d.readTags([{ tagKey: "run", address: "coil:1", dataType: "bool" }]);
      expect(s.value, JSON.stringify(v)).toBe(k);
    }
  });
});

// ─────────────────────────────── S7 / MC (nodes7 / mcprotocol giả) ───────────────────────────────
function mockNodes(lib: "nodes7" | "mcprotocol", values: Record<string, unknown> = {}) {
  const conn = {
    initiateConnection: vi.fn((_o: unknown, cb: (err?: unknown) => void) => cb()),
    setTranslationCB: vi.fn(),
    addItems: vi.fn(),
    removeItems: vi.fn(),
    readAllItems: vi.fn((cb: (bad: boolean, vals: Record<string, unknown>) => void) => cb(false, values)),
    writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
      cb(false);
      return 0;
    }),
    dropConnection: vi.fn((cb: () => void) => cb()),
  };
  function Lib(this: Record<string, unknown>) {
    Object.assign(this, conn);
  }
  vi.doMock(lib, () => ({ default: Lib }));
  return conn;
}

for (const [ten, lib, mod, lop, diaChi] of [
  ["S7", "nodes7", "./s7Driver", "S7Driver", "DB1,X0.0"],
  ["MC", "mcprotocol", "./mitsubishiMcDriver", "MitsubishiMcDriver", "M100"],
] as const) {
  describe(`${ten} — ghi bool một luật`, () => {
    async function dung() {
      const conn = mockNodes(lib);
      const m = (await import(/* @vite-ignore */ mod)) as Record<string, new () => import("../otDriver").OtDriver>;
      const d = new m[lop]();
      await d.connect({ endpoint: "tcp://127.0.0.1:102" });
      return { d, conn };
    }
    it('"0" ⇒ thư viện nhận false; "1" ⇒ true', async () => {
      const { d, conn } = await dung();
      const out = await d.writeTags([
        { tagKey: "a", address: diaChi, value: "0", dataType: "bool" },
        { tagKey: "b", address: diaChi, value: "1", dataType: "bool" },
      ]);
      expect(out.every((r) => r.ok)).toBe(true);
      expect(conn.writeItems).toHaveBeenCalledTimes(1);
      expect(conn.writeItems.mock.calls[0][0]).toEqual(["a", "b"]);
      expect(conn.writeItems.mock.calls[0][1]).toEqual([false, true]);
    });
    it('"on" ⇒ write ĐÓ ok:false, không vào writeItems; write hợp lệ cùng lô vẫn đi', async () => {
      const { d, conn } = await dung();
      const out = await d.writeTags([
        { tagKey: "a", address: diaChi, value: "on", dataType: "bool" },
        { tagKey: "b", address: diaChi, value: "false", dataType: "bool" },
      ]);
      expect(out.find((r) => r.tagKey === "a")!.ok).toBe(false);
      expect(out.find((r) => r.tagKey === "a")!.error).toMatch(/bool không hợp lệ/);
      expect(conn.writeItems.mock.calls[0][0]).toEqual(["b"]);
      expect(conn.writeItems.mock.calls[0][1]).toEqual([false]);
    });
    it("KD-T2: STOP dungGhim với ghim 255 trên tag bool ⇒ true (không chặn)", async () => {
      const { d, conn } = await dung();
      const [r] = await d.writeTags([{ tagKey: "a", address: diaChi, value: 255, dataType: "bool", dungGhim: true }]);
      expect(r.ok).toBe(true);
      expect(conn.writeItems.mock.calls[0][1]).toEqual([true]);
    });
  });
}

// fix round 1 (M1) — địa chỉ BIT của S7 / MC: MỘT luật bool BẤT KỂ dataType (như coil Modbus / bit SLMP); word ⇒ theo dataType như cũ
for (const [ten, lib, mod, lop, bit, word] of [
  ["S7", "nodes7", "./s7Driver", "S7Driver", "DB1,X0.1", "DB1,INT2"],
  ["MC", "mcprotocol", "./mitsubishiMcDriver", "MitsubishiMcDriver", "M100", "D100"],
] as const) {
  describe(`${ten} — địa chỉ BIT kiểu INT: bool chặt; STOP khoan dung; word không đổi`, () => {
    async function dung() {
      const conn = mockNodes(lib);
      const m = (await import(/* @vite-ignore */ mod)) as Record<string, new () => import("../otDriver").OtDriver>;
      const d = new m[lop]();
      await d.connect({ endpoint: "tcp://127.0.0.1:102" });
      return { d, conn };
    }
    it(`${bit} int: 2 ⇒ ok:false, không vào writeItems; "1" ⇒ true; STOP dungGhim 2 ⇒ true; ${word} int 2 ⇒ số 2`, async () => {
      const { d, conn } = await dung();
      const out = await d.writeTags([
        { tagKey: "a", address: bit, value: 2, dataType: "int" },
        { tagKey: "b", address: bit, value: "1", dataType: "int" },
        { tagKey: "c", address: word, value: 2, dataType: "int" },
      ]);
      expect(out.map((r) => r.ok)).toEqual([false, true, true]);
      expect(out[0].error).toMatch(/bool không hợp lệ: 2/);
      expect(conn.writeItems.mock.calls[0][0]).toEqual(["b", "c"]);
      expect(conn.writeItems.mock.calls[0][1]).toEqual([true, 2]);
      const [s] = await d.writeTags([{ tagKey: "a", address: bit, value: 2, dataType: "int", dungGhim: true }]);
      expect(s.ok).toBe(true);
      expect(conn.writeItems.mock.calls[1][1]).toEqual([true]);
    });
  });
}

describe("Giải mã ĐỌC bool (S7 / MC / EIP / OPC UA)", () => {
  it('S7: bool "1" ⇒ true, "false" ⇒ false, "x" ⇒ bad (cờ V2 bật ⇒ lý do bad_value / device_error)', async () => {
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "true");
    mockNodes("nodes7", { a: "1", b: "false", c: "x" });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const out = await d.readTags([
      { tagKey: "a", address: "DB1,X0.0", dataType: "bool" },
      { tagKey: "b", address: "DB1,X0.1", dataType: "bool" },
      { tagKey: "c", address: "DB1,X0.2", dataType: "bool" },
    ]);
    const s = (k: string) => out.find((x) => x.tagKey === k)!;
    expect(s("a")).toMatchObject({ value: true, quality: "good" });
    expect(s("b")).toMatchObject({ value: false, quality: "good" });
    expect(s("c")).toMatchObject({ value: null, quality: "bad", statusCode: "bad_value", reason: "device_error" });
  });
  it("hàm giải mã thuần: coerceS7Value / coerceMcValue / coerceEipValue / normalizeOpcuaValue cùng luật", async () => {
    const { coerceS7Value } = await import("./s7Address");
    const { coerceMcValue } = await import("./mcAddress");
    const { coerceEipValue } = await import("./eipTag");
    const { normalizeOpcuaValue } = await import("./opcuaAddress");
    for (const f of [coerceS7Value, coerceMcValue, coerceEipValue, (r: unknown, t: "bool") => normalizeOpcuaValue(r, t)]) {
      expect(f("1", "bool")).toEqual({ value: true, quality: "good" });
      expect(f(" FALSE ", "bool")).toEqual({ value: false, quality: "good" });
      expect(f(2, "bool")).toEqual({ value: true, quality: "good" });
      expect(f(0, "bool")).toEqual({ value: false, quality: "good" });
      expect(f("x", "bool")).toEqual({ value: null, quality: "bad" });
      expect(f({}, "bool")).toEqual({ value: null, quality: "bad" });
    }
  });
});

// ─────────────────────────────── EtherNet/IP ───────────────────────────────
describe("EtherNet/IP — ghi bool một luật", () => {
  function mockEip() {
    const plc = {
      connect: vi.fn(async () => {}),
      newTag: vi.fn((name: string) => ({ name, value: undefined as unknown })),
      readTag: vi.fn(async () => {}),
      writeTag: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    };
    vi.doMock("st-ethernet-ip", () => ({
      Controller: function () {
        return plc;
      },
    }));
    return plc;
  }
  it('"0" ⇒ writeTag(.., false); "on" ⇒ ok:false, newTag / writeTag 0 lần; STOP dungGhim 255 ⇒ true', async () => {
    const plc = mockEip();
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const [a] = await d.writeTags([{ tagKey: "run", address: "Run", value: "0", dataType: "bool" }]);
    expect(a.ok).toBe(true);
    expect(plc.writeTag.mock.calls[0][1]).toBe(false);
    plc.writeTag.mockClear();
    plc.newTag.mockClear();
    const [b] = await d.writeTags([{ tagKey: "run", address: "Run", value: "on", dataType: "bool" }]);
    expect(b.ok).toBe(false);
    expect(plc.newTag).not.toHaveBeenCalled();
    expect(plc.writeTag).not.toHaveBeenCalled();
    const [c] = await d.writeTags([{ tagKey: "run", address: "Run", value: 255, dataType: "bool", dungGhim: true }]);
    expect(c.ok).toBe(true);
    expect(plc.writeTag.mock.calls[0][1]).toBe(true);
  });
});

// ─────────────────────────────── OPC UA ───────────────────────────────
describe("OPC UA — ghi bool một luật (fallback `coerce` và kiểu dựng sẵn Boolean)", () => {
  function mockOpcua(builtin: number | null) {
    const session: Record<string, unknown> = {
      read: vi.fn(async () => []),
      write: vi.fn(async (nodes: unknown[]) => nodes.map(() => ({ value: 0 }))),
      close: vi.fn(async () => {}),
    };
    if (builtin !== null) session.getBuiltInDataType = vi.fn(async () => builtin);
    const client = { connect: vi.fn(async () => {}), createSession: vi.fn(async () => session), disconnect: vi.fn(async () => {}) };
    class Variant {
      dataType: unknown;
      value: unknown;
      constructor(o: { dataType: unknown; value: unknown }) {
        this.dataType = o.dataType;
        this.value = o.value;
      }
    }
    vi.doMock("node-opcua", () => ({
      OPCUAClient: { create: vi.fn(() => client) },
      AttributeIds: { Value: 13 },
      DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
      Variant,
    }));
    return session as { write: ReturnType<typeof vi.fn> };
  }
  const daGui = (session: { write: ReturnType<typeof vi.fn> }) => (session.write.mock.calls.at(-1)![0] as Array<{ value: { value: { value: unknown } } }>).map((n) => n.value.value.value);

  for (const [ten, builtin] of [["fallback coerce (không đọc được DataType)", null], ["node Boolean (builtin 1)", 1]] as const) {
    it(`${ten}: "0" ⇒ false; "on" ⇒ write đó ok:false, không gửi; STOP dungGhim 255 ⇒ true`, async () => {
      const session = mockOpcua(builtin);
      const { OpcuaDriver } = await import("./opcuaDriver");
      const d = new OpcuaDriver();
      await d.connect({ endpoint: "opc.tcp://x" });
      const out = await d.writeTags([
        { tagKey: "a", address: "ns=2;s=A", value: "0", dataType: "bool" },
        { tagKey: "b", address: "ns=2;s=B", value: "on", dataType: "bool" },
      ]);
      expect(out.map((r) => r.ok)).toEqual([true, false]);
      expect(daGui(session)).toEqual([false]);
      const [c] = await d.writeTags([{ tagKey: "c", address: "ns=2;s=C", value: 255, dataType: "bool", dungGhim: true }]);
      expect(c.ok).toBe(true);
      expect(daGui(session)).toEqual([true]);
    });
  }
});

// ─────────────────────────────── SLMP (transact giả) ───────────────────────────────
describe("SLMP bit-device — một luật bool bất kể dataType", () => {
  const OK_3E = Buffer.from([0xd0, 0x00, 0x00, 0xff, 0xff, 0x03, 0x00, 0x02, 0x00, 0x00, 0x00]);
  async function dung() {
    const { SlmpDriver } = await import("./slmpDriver");
    const d = new SlmpDriver();
    const anyD = d as unknown as { connected: boolean; socket: unknown; transact: ReturnType<typeof vi.fn> };
    anyD.connected = true;
    anyD.socket = {};
    anyD.transact = vi.fn(async () => OK_3E);
    return { d, anyD };
  }
  /** Bit của điểm đầu trong yêu cầu ghi bit (2 điểm/byte, điểm thấp = nibble cao). */
  const bitDau = (req: Buffer) => (req[req.length - 1] & 0x10) !== 0;

  it('M100 bool "0" ⇒ bit 0; "1" ⇒ bit 1; "on" ⇒ ok:false, không giao dịch', async () => {
    const { d, anyD } = await dung();
    const [a] = await d.writeTags([{ tagKey: "a", address: "M100", value: "0", dataType: "bool" }]);
    expect(a.ok).toBe(true);
    expect(bitDau(anyD.transact.mock.calls[0][0])).toBe(false);
    const [b] = await d.writeTags([{ tagKey: "a", address: "M100", value: "1", dataType: "bool" }]);
    expect(b.ok).toBe(true);
    expect(bitDau(anyD.transact.mock.calls[1][0])).toBe(true);
    const [c] = await d.writeTags([{ tagKey: "a", address: "M100", value: "on", dataType: "bool" }]);
    expect(c.ok).toBe(false);
    expect(anyD.transact).toHaveBeenCalledTimes(2);
  });

  it("M100 kiểu INT: đường thường 2 ⇒ ok:false (không gửi); STOP dungGhim 2 ⇒ bit 1 (KD-T2)", async () => {
    const { d, anyD } = await dung();
    const [a] = await d.writeTags([{ tagKey: "a", address: "M100", value: 2, dataType: "int" }]);
    expect(a.ok).toBe(false);
    expect(anyD.transact).not.toHaveBeenCalled();
    const [b] = await d.writeTags([{ tagKey: "a", address: "M100", value: 2, dataType: "int", dungGhim: true }]);
    expect(b.ok).toBe(true);
    expect(bitDau(anyD.transact.mock.calls[0][0])).toBe(true);
  });
});
