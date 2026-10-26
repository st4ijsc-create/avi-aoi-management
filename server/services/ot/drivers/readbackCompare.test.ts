/**
 * Sprint G2.1 — readbackCompare helper tests (THUẦN, offline).
 */
import { describe, it, expect } from "vitest";
import { readbackMatches } from "./readbackCompare";
import { inverseScale, scaleXuoi } from "./otScale";
import { normalizeOpcuaValue } from "./opcuaAddress";

describe("readbackMatches", () => {
  it("float within tolerance → true; outside → false", () => {
    expect(readbackMatches(1.0, 1.0000005, "float", 1e-6)).toBe(true); // diff 5e-7 <= 1e-6
    expect(readbackMatches(1.0, 1.001, "float", 1e-6)).toBe(false);
    expect(readbackMatches(100.0, 100.0, "float")).toBe(true);
    // custom looser tolerance
    expect(readbackMatches(10, 10.4, "float", 0.5)).toBe(true);
    expect(readbackMatches(10, 10.6, "float", 0.5)).toBe(false);
  });

  it("int compares on round", () => {
    expect(readbackMatches(5, 5, "int")).toBe(true);
    expect(readbackMatches(5, 5.4, "int")).toBe(true); // round 5 === round 5
    expect(readbackMatches(5, 6, "int")).toBe(false);
  });

  it("bool compares Boolean", () => {
    expect(readbackMatches(true, true, "bool")).toBe(true);
    expect(readbackMatches(true, 1, "bool")).toBe(true);
    expect(readbackMatches(true, false, "bool")).toBe(false);
    expect(readbackMatches(false, 0, "bool")).toBe(true);
  });

  it("R1b-2b-1 T2 — bool: 'false' khớp false; 'off' không khớp gì", () => {
    expect(readbackMatches("false", false, "bool")).toBe(true);
    expect(readbackMatches("off", true, "bool")).toBe(false);
  });

  it("R1b-2b-1 T2 — bool cùng luật ghi / đọc: kỳ vọng theo boolTuGiaTri, đọc lại theo giaiMaBoolDoc; một bên ngoài luật ⇒ false", () => {
    expect(readbackMatches("0", 0, "bool")).toBe(true);
    expect(readbackMatches(" TRUE ", 255, "bool")).toBe(true); // thanh ghi khác 0 ⇒ TRUE
    expect(readbackMatches("off", false, "bool")).toBe(false); // trước: Boolean("off") = true ≠ false ⇒ false (đúng nhờ may); nay: ngoài luật
    expect(readbackMatches("off", "off", "bool")).toBe(false);
    expect(readbackMatches(true, "BAD 255", "bool")).toBe(false);
    expect(readbackMatches(false, "x", "bool")).toBe(false); // trước: Boolean("x") = true ≠ false; giờ "x" ngoài luật
    expect(readbackMatches(true, "x", "bool")).toBe(false); // trước: Boolean("x") = true ⇒ "khớp" sai
    expect(readbackMatches({}, true, "bool")).toBe(false); // trước: Boolean({}) = true ⇒ "khớp" sai
  });

  it("string compares String()", () => {
    expect(readbackMatches("RUN", "RUN", "string")).toBe(true);
    expect(readbackMatches("RUN", "STOP", "string")).toBe(false);
    expect(readbackMatches(42, "42", "string")).toBe(true);
  });

  it("json compares String()", () => {
    expect(readbackMatches('{"a":1}', '{"a":1}', "json")).toBe(true);
    expect(readbackMatches('{"a":1}', '{"a":2}', "json")).toBe(false);
  });

  it("actual null/undefined → false (cannot verify)", () => {
    expect(readbackMatches(1, null, "float")).toBe(false);
    expect(readbackMatches(1, undefined, "int")).toBe(false);
    expect(readbackMatches(true, null, "bool")).toBe(false);
    expect(readbackMatches("x", null, "string")).toBe(false);
  });

  it("NaN → false", () => {
    expect(readbackMatches(NaN, 1, "float")).toBe(false);
    expect(readbackMatches(1, NaN, "float")).toBe(false);
    expect(readbackMatches(NaN, 1, "int")).toBe(false);
  });

  // R1b-2b-1 T6 fix round 1 (T16 ô R1-đc) — THAY ca T6 cũ (mô hình sai: driver giả trả 2,5 chưa làm tròn; "đọc 3,0 ⇒ lệch"). Driver thật trả
  // tag int = Math.round(thô·s + o) ⇒ mong đợi = scaleXuoi(inverseScale(e)). Ca qua ModbusDriver THẬT: otDeviceWrite.readback.r1b2b.test.ts.
  it("R1b-2b-1 T6 fix round 1 — int có thang đo: so với giá trị ĐỌC MÔ PHỎNG round(round((e − o)/s)·s + o)", () => {
    // scale 0,5: ghi 2,5 ⇒ thô 5 ⇒ driver đọc round(2,5) = 3
    expect(readbackMatches(2.5, 3, "int", 1e-6, { scale: "0.5", offset: null })).toBe(true);
    expect(readbackMatches(2.5, 4, "int", 1e-6, { scale: 0.5 })).toBe(false); // thô 7 ⇒ round(3,5) = 4
    expect(readbackMatches(2.5, 2, "int", 1e-6, { scale: 0.5 })).toBe(false); // thô 4 ⇒ 2
    // scale 0,1: ghi 2,3 ⇒ thô 23 ⇒ đọc round(2,3000000000000003) = 2
    expect(readbackMatches(2.3, 2, "int", 1e-6, { scale: 0.1 })).toBe(true);
    expect(readbackMatches(2.3, 3, "int", 1e-6, { scale: 0.1 })).toBe(false);
    // scale 10: ghi 30 ⇒ thô 3 ⇒ đọc 30; thô 4 ⇒ 40
    expect(readbackMatches(30, 30, "int", 1e-6, { scale: 10, offset: 0 })).toBe(true);
    expect(readbackMatches(30, 40, "int", 1e-6, { scale: 10, offset: 0 })).toBe(false);
    // offset: scale 2 offset 10, ghi 12 ⇒ thô 1 ⇒ đọc 12; 14 = thô 2 ⇒ lệch
    expect(readbackMatches(12, 12, "int", 1e-6, { scale: 2, offset: 10 })).toBe(true);
    expect(readbackMatches(12, 14, "int", 1e-6, { scale: 2, offset: 10 })).toBe(false);
    // scale 0,5 offset 10: ghi 12,5 ⇒ thô 5 ⇒ đọc round(12,5) = 13
    expect(readbackMatches(12.5, 13, "int", 1e-6, { scale: 0.5, offset: 10 })).toBe(true);
    expect(readbackMatches(12.5, 12, "int", 1e-6, { scale: 0.5, offset: 10 })).toBe(false);
    // scale 0 / NULL / không hữu hạn ⇒ 1 (chuanHoaThangDo)
    expect(readbackMatches(25, 25, "int", 1e-6, { scale: 0, offset: null })).toBe(true);
    expect(readbackMatches(25, 25, "int", 1e-6, { scale: "abc" })).toBe(true);
    // không thang đo ⇒ ĐÚNG như cũ: Math.round(e) === Math.round(a)
    expect(readbackMatches(3, 3.4, "int")).toBe(true);
    expect(readbackMatches(5, 5.4, "int", 1e-6, {})).toBe(true);
    expect(readbackMatches(5, 6, "int")).toBe(false);
  });

  it("R1b-2b-1 T6 fix round 1 — GIỚI HẠN đã biết (R1b-2b-2 mục 64): làm tròn che số thô sai ⇒ không phân biệt được", () => {
    // scale 0,5: thô 6 đọc round(3,0) = 3 = đọc của thô 5 ⇒ "khớp" — cần đọc lại THÔ thật mới phát hiện.
    expect(readbackMatches(2.5, 3, "int", 1e-6, { scale: 0.5 })).toBe(true);
  });

  it("R1b-2b-1 T6 fix round 1 — float có thang đo: so với ĐỌC MÔ PHỎNG ((e − o)/s)·s + o trong dung sai; không thang đo như cũ", () => {
    expect(readbackMatches(2.3, 23 * 0.1, "float", 1e-6, { scale: 0.1 })).toBe(true); // driver đọc thô 23 ⇒ 2,3000000000000003
    expect(readbackMatches(2.3, 2.4, "float", 1e-6, { scale: 0.1 })).toBe(false);
    expect(readbackMatches(12.5, 12.5, "float", 1e-6, { scale: 0.5, offset: 10 })).toBe(true);
    expect(readbackMatches(1.0, 1.0000005, "float", 1e-6, {})).toBe(true);
  });

  it("R1b-2b-1 T6 — địa chỉ lớp bit: so theo luật bool bất kể dataType (STOP ghim 255 trên coil dataType int)", () => {
    const stop = { lopBit: true, dungGhim: true };
    expect(readbackMatches(255, 1, "int", 1e-6, undefined, stop)).toBe(true);
    expect(readbackMatches(255, true, "int", 1e-6, undefined, stop)).toBe(true);
    expect(readbackMatches(255, 0, "int", 1e-6, undefined, stop)).toBe(false);
    expect(readbackMatches(255, "x", "int", 1e-6, undefined, stop)).toBe(false);
    // không phải STOP đã xác minh: boolTuGiaTri(255) = undefined ⇒ lệch
    expect(readbackMatches(255, 1, "int", 1e-6, undefined, { lopBit: true })).toBe(false);
    expect(readbackMatches(1, 1, "int", 1e-6, undefined, { lopBit: true })).toBe(true);
    // không bit ⇒ như int thường (255 ≠ 1)
    expect(readbackMatches(255, 1, "int", 1e-6, undefined, { lopBit: false, dungGhim: true })).toBe(false);
  });

  // MỘT nguồn: đường đọc OPC UA (`normalizeOpcuaValue`, hàm thuần) = scaleXuoi; mô phỏng của so đọc lại = scaleXuoi(inverseScale(e)).
  it("R1b-2b-1 T6 fix round 1 — scaleXuoi khớp đường đọc thật (OPC UA thuần) và ma trận số thô / scale / offset", () => {
    for (const s of [0.5, 0.1, 10, 2, -0.5, 1]) {
      for (const o of [0, 10, -3]) {
        for (const raw of [0, 3, 5, 6, 7, 23, -5]) {
          expect(normalizeOpcuaValue(raw, "int", s, o).value).toBe(scaleXuoi(raw, "int", s, o));
          expect(normalizeOpcuaValue(raw, "float", s, o).value).toBe(scaleXuoi(raw, "float", s, o));
          // giá trị driver đọc từ thô `raw` LUÔN khớp với chính nó khi được ghi lại (mô phỏng ổn định trên lưới)
          const doc = scaleXuoi(raw, "int", s, o);
          expect(readbackMatches(raw * s + o, doc, "int", 1e-6, { scale: s, offset: o })).toBe(true);
          expect(Number(inverseScale(raw * s + o, "int", s, o)) + 0).toBe(raw); // + 0: thô 0 ở scale âm là −0
        }
      }
    }
  });
});
