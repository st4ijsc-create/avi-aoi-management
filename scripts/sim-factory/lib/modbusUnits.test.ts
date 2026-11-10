/**
 * TC-12 — Test cho scripts/sim-factory/lib/modbusUnits.mjs
 *
 * KHÔNG dựng server thật, KHÔNG mở cổng, KHÔNG import simulator.mjs.
 * Kiểm tra thuần logic: hằng, bảng unit, đọc thanh ghi, ca biên.
 */
import { describe, expect, it } from "vitest";
import { MODBUS_ALL_UNITS, dungBangUnit, docThanhGhi } from "./modbusUnits.mjs";
import { buildTopology } from "../topology.mjs";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. Hằng MODBUS_ALL_UNITS
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("MODBUS_ALL_UNITS", () => {
  it("bằng 255 — giá trị modbus-serial coi là 'mọi unit'", () => {
    expect(MODBUS_ALL_UNITS).toBe(255);
  });

  it("là số nguyên dương", () => {
    expect(Number.isInteger(MODBUS_ALL_UNITS)).toBe(true);
    expect(MODBUS_ALL_UNITS).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. dungBangUnit — dựng bảng unit → lineNo
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("dungBangUnit", () => {
  it("dựng từ buildTopology() thật có đủ mọi line (1, 2, 3)", () => {
    const topo = buildTopology();
    const bang = dungBangUnit(topo);
    const keys = Object.keys(bang).sort((a, b) => Number(a) - Number(b));
    expect(keys).toEqual(["1", "2", "3"]);
  });

  it("không trùng unit — mỗi modbusUnitId chỉ xuất hiện một lần", () => {
    const topo = buildTopology();
    const bang = dungBangUnit(topo);
    const values = Object.values(bang);
    expect(new Set(values).size).toBe(values.length);
  });

  it("unit → lineNo đúng: modbusUnitId = lineNo", () => {
    const topo = buildTopology();
    const bang = dungBangUnit(topo);
    for (const line of topo.lines) {
      expect(bang[line.modbusUnitId]).toBe(line.lineNo);
    }
  });

  it("nhận mảng line trực tiếp cũng hoạt động", () => {
    const topo = buildTopology();
    const bang = dungBangUnit(topo.lines);
    expect(Object.keys(bang).length).toBe(3);
  });

  it("unit không có trong bảng → tra cứu trả undefined", () => {
    const bang = dungBangUnit([{ modbusUnitId: 1, lineNo: 1 }]);
    expect(bang[2]).toBeUndefined();
  });

  it("topology rỗng → bảng rỗng", () => {
    const bang = dungBangUnit([]);
    expect(Object.keys(bang).length).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. docThanhGhi — đọc thanh ghi theo unit
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("docThanhGhi", () => {
  const bangUnit = { 1: 1, 2: 2, 3: 3 };
  const state = {
    1: { tags: { "m:0": 100, "m:1": 200, "m:2": 300 } },
    2: { tags: { "m:0": 1000, "m:1": 2000, "m:2": 3000 } },
    3: { tags: { "m:0": 10000, "m:1": 20000, "m:2": 30000 } },
  };

  it("đúng giá trị của ĐÚNG line", () => {
    expect(docThanhGhi(bangUnit, state, 0, 1)).toBe(100);
    expect(docThanhGhi(bangUnit, state, 1, 2)).toBe(2000);
    expect(docThanhGhi(bangUnit, state, 2, 3)).toBe(30000);
  });

  it("unit không có trong bảng → 0", () => {
    expect(docThanhGhi(bangUnit, state, 0, 99)).toBe(0);
    expect(docThanhGhi(bangUnit, state, 0, 0)).toBe(0);
  });

  it("thanh ghi chưa có → 0", () => {
    expect(docThanhGhi(bangUnit, state, 999, 1)).toBe(0);
  });

  it("line không có trong state → 0", () => {
    const bang = { 1: 999 };
    expect(docThanhGhi(bang, state, 0, 1)).toBe(0);
  });

  it("state không có tags → 0", () => {
    const bang = { 1: 1 };
    const st = { 1: {} };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(0);
  });

  it("state là null → 0", () => {
    const bang = { 1: 1 };
    const st = { 1: null };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(0);
  });

  /* ── 16-bit unsigned mask ─────────────────────────────────────────── */
  it("cắt về 16 bit không dấu — số lớn hơn 65535 (70000 → 4464)", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": 70000 } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(4464);
  });

  it("cắt về 16 bit không dấu — số âm (-1 → 65535)", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": -1 } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(65535);
  });

  it("cắt về 16 bit không dấu — số 0 giữ nguyên", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": 0 } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(0);
  });

  it("cắt về 16 bit không dấu — giá trị lớn nhất 16 bit (65535) giữ nguyên", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": 65535 } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(65535);
  });

  it("cắt về 16 bit không dấu — 65536 (vượt 16 bit) → 0", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": 65536 } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(0);
  });

  it("cắt về 16 bit không dấu — số rất lớn (2^32 + 100 → 100)", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": 4294967396 } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(100);
  });

  /* ── Chuỗi số ─────────────────────────────────────────────────────── */
  it("thanh ghi là chuỗi số → Number() rồi & 0xffff", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": "42" } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(42);
  });

  it("chuỗi không phải số → 0", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": "abc" } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(0);
  });

  it("giá trị NaN → 0", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": NaN } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(0);
  });

  it("giá trị Infinity → 0", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": Infinity } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(0);
  });

  it("giá trị -Infinity → 0", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": -Infinity } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(0);
  });

  /* ── Địa chỉ là chuỗi ─────────────────────────────────────────────── */
  it("địa chỉ là chuỗi số cũng hoạt động", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": 123 } } };
    expect(docThanhGhi(bang, st, "0", 1)).toBe(123);
  });

  /* ── Hai unit khác nhau, cùng địa chỉ, giá trị khác nhau ─────────── */
  it("hai unit khác nhau có cùng địa chỉ nhưng giá trị khác nhau → trả đúng giá trị từng unit", () => {
    // Unit 1 có m:0 = 100, unit 2 có m:0 = 1000
    expect(docThanhGhi(bangUnit, state, 0, 1)).toBe(100);
    expect(docThanhGhi(bangUnit, state, 0, 2)).toBe(1000);
    expect(docThanhGhi(bangUnit, state, 0, 3)).toBe(10000);
  });

  /* ── Ca biên ──────────────────────────────────────────────────────── */
  it("giá trị float không nguyên → Number() rồi & 0xffff", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": 3.7 } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(3);
  });

  it("undefined/null trong tags → 0", () => {
    const bang = { 1: 1 };
    const st = { 1: { tags: { "m:0": undefined } } };
    expect(docThanhGhi(bang, st, 0, 1)).toBe(0);
  });

  it("thiếu state hoàn toàn → 0", () => {
    const bang = { 1: 1 };
    expect(docThanhGhi(bang, {}, 0, 1)).toBe(0);
  });
});
