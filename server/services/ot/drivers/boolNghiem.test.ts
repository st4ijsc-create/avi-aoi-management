/**
 * SCADA R1b-2b-1 Task 2 (kiem-dinh G1) — MỘT luật bool: tập hợp lệ, ghi chặt, ghi STOP khoan dung (KD-T2), giải mã đọc, đối xứng ghi ↔ đọc,
 * và lớp địa chỉ coil / bit (điều kiện 1b). THUẦN, không DB.
 */
import { describe, expect, it } from "vitest";
import { boolChoGhi, boolDungGhim, boolGhi, boolTuGiaTri, giaiMaBoolDoc, LoiGiaTriBool } from "./boolNghiem";
import { kiemGiaTriDiaChiBit, lopDiaChiBit } from "./diaChiBit";

const HOP_LE: ReadonlyArray<readonly [unknown, boolean]> = [
  [true, true],
  [false, false],
  [1, true],
  [0, false],
  ["1", true],
  ["0", false],
  ["true", true],
  ["false", false],
  [" FALSE ", false],
  ["True", true],
  ["\t0\n", false],
];
const NGOAI_TAP: ReadonlyArray<unknown> = [2, -1, 255, 0.5, NaN, Infinity, "on", "off", "yes", "no", "", "  ", "2", "BAD 255", [1], [], {}, { v: 1 }, null, undefined];

describe("boolTuGiaTri — tập hợp lệ 8 giá trị (chuỗi sau trim + lower)", () => {
  it("boolTuGiaTri chặt", () => {
    for (const [v, k] of [[true, true], [false, false], [1, true], [0, false], ["1", true], [" FALSE ", false], ["true", true]] as const) expect(boolTuGiaTri(v)).toBe(k);
    for (const v of [2, -1, NaN, "on", "off", "yes", "no", "", "  ", [1], {}, null, undefined]) expect(boolTuGiaTri(v)).toBeUndefined();
  });
  it("bảng đầy đủ", () => {
    for (const [v, k] of HOP_LE) expect(boolTuGiaTri(v), JSON.stringify(v)).toBe(k);
    for (const v of NGOAI_TAP) expect(boolTuGiaTri(v), String(JSON.stringify(v))).toBeUndefined();
  });
});

describe("boolGhi — đường GHI thường: ngoài tập ⇒ ném lớp có kiểu", () => {
  it("boolGhi('off') ném, boolGhi('0') = false", () => {
    expect(() => boolGhi("off")).toThrow(/bool không hợp lệ/);
    expect(boolGhi("0")).toBe(false);
  });
  it("mọi giá trị ngoài tập ⇒ LoiGiaTriBool (không phải Error thô), message mang giá trị", () => {
    for (const v of NGOAI_TAP) {
      let loi: unknown;
      try {
        boolGhi(v);
      } catch (e) {
        loi = e;
      }
      expect(loi, String(JSON.stringify(v))).toBeInstanceOf(LoiGiaTriBool);
      expect((loi as LoiGiaTriBool).name).toBe("LoiGiaTriBool");
      expect((loi as LoiGiaTriBool).giaTri).toBe(v);
    }
    expect(() => boolGhi("on")).toThrow('giá trị bool không hợp lệ: "on"');
    expect(() => boolGhi(255)).toThrow("giá trị bool không hợp lệ: 255");
  });
  it("(đột biến 'boolGhi khoan dung' ⇒ đỏ) 2 / 255 / 'on' KHÔNG thành TRUE trên đường thường", () => {
    for (const v of [2, 255, "on", "yes", -1]) expect(() => boolGhi(v)).toThrow(LoiGiaTriBool);
  });
});

describe("boolDungGhim — STOP ĐÃ XÁC MINH (KD-T2): không bao giờ ném; tập hợp lệ như boolTuGiaTri; số khác 0 ⇒ TRUE", () => {
  it("ghim 255 / 2 / -1 / 0.5 ⇒ TRUE; 0 ⇒ FALSE; 'false' ⇒ FALSE (không bao giờ truthy JS với tập hợp lệ)", () => {
    expect(boolDungGhim(255)).toBe(true);
    expect(boolDungGhim(2)).toBe(true);
    expect(boolDungGhim(-1)).toBe(true);
    expect(boolDungGhim(0.5)).toBe(true);
    expect(boolDungGhim(0)).toBe(false);
    expect(boolDungGhim("false")).toBe(false);
    expect(boolDungGhim(" 0 ")).toBe(false);
  });
  it("mọi giá trị (cả ngoài tập) ⇒ một boolean, không ném", () => {
    for (const v of [...NGOAI_TAP, ...HOP_LE.map(([x]) => x)]) expect(typeof boolDungGhim(v)).toBe("boolean");
    for (const [v, k] of HOP_LE) expect(boolDungGhim(v)).toBe(k);
  });
  it("boolChoGhi: dungGhim=true ⇒ khoan dung; vắng / false ⇒ chặt", () => {
    expect(boolChoGhi(255, true)).toBe(true);
    expect(() => boolChoGhi(255, false)).toThrow(LoiGiaTriBool);
    expect(() => boolChoGhi(255, undefined)).toThrow(LoiGiaTriBool);
    expect(boolChoGhi("false", undefined)).toBe(false);
  });
});

describe("giaiMaBoolDoc — đường ĐỌC", () => {
  it("giaiMaBoolDoc: số khác 0 là TRUE; chuỗi lạ ⇒ undefined", () => {
    expect(giaiMaBoolDoc(2)).toBe(true);
    expect(giaiMaBoolDoc(0)).toBe(false);
    expect(giaiMaBoolDoc("false")).toBe(false);
    expect(giaiMaBoolDoc("BAD 255")).toBeUndefined();
  });
  it("boolean ⇒ chính nó; NaN / Infinity / null / đối tượng ⇒ undefined", () => {
    expect(giaiMaBoolDoc(true)).toBe(true);
    expect(giaiMaBoolDoc(false)).toBe(false);
    expect(giaiMaBoolDoc(255)).toBe(true);
    for (const v of [NaN, Infinity, null, undefined, {}, [1], "x", "on"]) expect(giaiMaBoolDoc(v), String(v)).toBeUndefined();
  });
});

describe("ĐỐI XỨNG ghi ↔ đọc (một luật hai chiều)", () => {
  it("vòng ghi → đọc: với mọi v hợp lệ, giaiMaBoolDoc(boolGhi(v)) và giaiMaBoolDoc(bit 0/1 thiết bị lưu) === boolTuGiaTri(v)", () => {
    for (const [v, k] of HOP_LE) {
      const ghi = boolGhi(v);
      expect(giaiMaBoolDoc(ghi), JSON.stringify(v)).toBe(k);
      expect(giaiMaBoolDoc(ghi ? 1 : 0), JSON.stringify(v)).toBe(k);
      expect(giaiMaBoolDoc(String(ghi)), JSON.stringify(v)).toBe(k);
    }
  });
  it("STOP khoan dung và phía đọc cùng quy ước thanh ghi: số khác 0 ⇔ TRUE (ghim 255 ghi TRUE; thanh ghi đọc 255 ra TRUE)", () => {
    for (const n of [255, 2, -1, 0.5, 0]) {
      expect(giaiMaBoolDoc(n)).toBe(boolDungGhim(n));
      expect(giaiMaBoolDoc(boolDungGhim(n) ? 1 : 0)).toBe(boolDungGhim(n));
    }
  });
});

describe("lopDiaChiBit — địa chỉ driver ghi thành MỘT BIT (điều kiện 1b)", () => {
  it("Modbus coil (mọi dataType), holding chỉ khi bool; input / discrete / holding int ⇒ null", () => {
    for (const a of ["coil:1", "0x:5", "00001", "1", "9999"]) for (const dt of ["bool", "int", "float", "string"]) expect(lopDiaChiBit("modbus", a, dt), `${a} ${dt}`).toBe("modbus_coil");
    for (const a of ["40001", "holding:40010", "4x:3"]) {
      expect(lopDiaChiBit("modbus", a, "bool")).toBe("modbus_holding_bool");
      expect(lopDiaChiBit("modbus", a, "int")).toBeNull();
    }
    for (const a of ["30001", "10001", "rác"]) expect(lopDiaChiBit("modbus", a, "bool")).toBeNull();
  });
  it("SLMP / MC bit-device (mọi dataType); word-device ⇒ null; MC '<word>.<bit>' ⇒ bit", () => {
    for (const a of ["M100", "Y1A", "SM400", "B1F", "L0", "TS0"]) expect(lopDiaChiBit("slmp", a, "int"), a).toBe("slmp_bit");
    for (const a of ["D100", "W10", "ZR0", "SD10"]) expect(lopDiaChiBit("slmp", a, "int"), a).toBeNull();
    for (const a of ["M100", "D6000.1", "TS0", "X1A"]) expect(lopDiaChiBit("mitsubishi-mc", a, "int"), a).toBe("mc_bit");
    for (const a of ["D100", "TN0", "RFLOAT5000"]) expect(lopDiaChiBit("mitsubishi-mc", a, "int"), a).toBeNull();
  });
  it("fix round 1 (M1 + lo ngại 4): bit S7 (DB…,X / M0.0 / MX3.1 / Q0.0) ⇒ s7_bit mọi dataType; word S7 ⇒ null", () => {
    for (const a of ["DB1,X14.0", "M0.0", "MX3.1", "Q0.0"]) expect(lopDiaChiBit("s7", a, "int"), a).toBe("s7_bit");
    for (const a of ["DB1,INT12", "MW0", "MD4", "rác"]) expect(lopDiaChiBit("s7", a, "int"), a).toBeNull();
  });
  it("kiemGiaTriDiaChiBit: lớp bit ⇒ tập bool; ngoài lớp / thiếu protocol hay address ⇒ ok", () => {
    expect(kiemGiaTriDiaChiBit("modbus", "coil:1", "int", 2)).toMatchObject({ ok: false, lopBit: "modbus_coil", chiTiet: expect.stringMatching(/được ghi thành MỘT BIT/) });
    for (const v of [1, 0, true, "false", " 1 "]) expect(kiemGiaTriDiaChiBit("modbus", "coil:1", "int", v)).toEqual({ ok: true });
    expect(kiemGiaTriDiaChiBit("modbus", "40001", "int", 2)).toEqual({ ok: true });
    expect(kiemGiaTriDiaChiBit("s7", "M0.0", "int", 255)).toMatchObject({ ok: false, lopBit: "s7_bit" });
    expect(kiemGiaTriDiaChiBit(null, "coil:1", "int", 2)).toEqual({ ok: true });
    expect(kiemGiaTriDiaChiBit("modbus", null, "int", 2)).toEqual({ ok: true });
  });
  it("EtherNet/IP / OPC UA / stub ⇒ null (địa chỉ là TÊN / driver không phải Modbus)", () => {
    expect(lopDiaChiBit("ethernet-ip", "Run", "int")).toBeNull();
    expect(lopDiaChiBit("opcua", "ns=2;s=Run", "int")).toBeNull();
    expect(lopDiaChiBit("stub", "coil:1", "int")).toBeNull();
  });
});
