/**
 * SCADA R1a Task 2 — luật kênh THUẦN: loại kênh, mức tác động, ép kiểu, dải, bước.
 * Không DB. Điều phối 2026-10-24 mục 7: `goiY` chỉ là gợi ý — kiemGiaTriGhi KHÔNG BAO GIỜ trả ok với giá trị đã làm tròn.
 */
import { describe, expect, it } from "vitest";
import { canonicalOtValue } from "../ot/otActionBinding";
import { kiemGiaTriGhi, laKenhGhi, loaiKenh, mucTacDongKenh, type KetQuaGiaTri } from "./kenhScada";

type KenhThu = {
  dataType: "bool" | "int" | "float" | "string" | "json";
  writeMin: number | null;
  writeMax: number | null;
  writeStep: number | null;
};
const kenh = (o: Partial<KenhThu>): KenhThu => ({
  dataType: "float",
  writeMin: null,
  writeMax: null,
  writeStep: null,
  ...o,
});
const bool = kenh({ dataType: "bool" });
const nhiet = kenh({ writeMin: 240, writeMax: 250, writeStep: 0.5 });

function loi(r: KetQuaGiaTri) {
  if (r.ok) throw new Error(`mong đợi từ chối, nhận ok ${JSON.stringify(r.giaTri)}`);
  return r;
}
function tot(r: KetQuaGiaTri) {
  if (!r.ok) throw new Error(`mong đợi ok, nhận ${r.ma}: ${r.chiTiet}`);
  return r.giaTri;
}

describe("loaiKenh / laKenhGhi / mucTacDongKenh", () => {
  it("NULL ⇒ suy từ writable", () => {
    expect(loaiKenh({ channelKind: null, writable: true })).toBe("input_output");
    expect(loaiKenh({ channelKind: null, writable: false })).toBe("input");
  });
  it("giá trị tường minh thắng writable", () => {
    expect(loaiKenh({ channelKind: "calculated", writable: true })).toBe("calculated");
  });
  it("laKenhGhi: input_output | calculated_output | output", () => {
    expect(laKenhGhi({ channelKind: "input", writable: false })).toBe(false);
    expect(laKenhGhi({ channelKind: "calculated", writable: false })).toBe(false);
    expect(laKenhGhi({ channelKind: "input_output", writable: false })).toBe(true);
    expect(laKenhGhi({ channelKind: "calculated_output", writable: false })).toBe(true);
    expect(laKenhGhi({ channelKind: "output", writable: false })).toBe(true);
    expect(laKenhGhi({ channelKind: null, writable: true })).toBe(true);
    expect(laKenhGhi({ channelKind: null, writable: false })).toBe(false);
  });
  it("actuationLevel NULL ⇒ 5 (fail-closed), bất kể loại kênh", () => {
    expect(mucTacDongKenh({ actuationLevel: null })).toBe(5);
  });
  it("actuationLevel đặt rõ được giữ nguyên", () => {
    for (const m of [1, 3, 4, 5] as const) expect(mucTacDongKenh({ actuationLevel: m })).toBe(m);
  });
});

describe("kiemGiaTriGhi — bool", () => {
  it.each([["1"], [1], [true], ["true"], ["TRUE"], [" True "]])("%j ⇒ true", (v) => {
    expect(tot(kiemGiaTriGhi(bool, v))).toBe(true);
  });
  it.each([["0"], [0], [false], ["false"], ["False"]])("%j ⇒ false", (v) => {
    expect(tot(kiemGiaTriGhi(bool, v))).toBe(false);
  });
  it.each([["x"], [2], ["2"], [null], [undefined], [{}], [""], ["yes"], [1.5]])("%j ⇒ TYPE_MISMATCH", (v) => {
    expect(loi(kiemGiaTriGhi(bool, v)).ma).toBe("TYPE_MISMATCH");
  });
  it("bool bỏ qua dải/bước", () => {
    expect(tot(kiemGiaTriGhi({ ...bool, writeMin: 5, writeMax: 6, writeStep: 3 }, 1))).toBe(true);
  });
});

describe("kiemGiaTriGhi — float có dải + bước", () => {
  it('"240.0" ⇒ ok giaTri===240', () => {
    expect(tot(kiemGiaTriGhi(nhiet, "240.0"))).toBe(240);
  });
  it("240.2 ⇒ OFF_STEP, goiY 240", () => {
    const r = loi(kiemGiaTriGhi(nhiet, 240.2));
    expect(r.ma).toBe("OFF_STEP");
    expect(r.goiY).toBe(240);
  });
  it("249.9 ⇒ OFF_STEP, goiY 250 (không bao giờ ok với giá trị làm tròn)", () => {
    const r = kiemGiaTriGhi(nhiet, 249.9);
    expect(r.ok).toBe(false);
    expect(loi(r).ma).toBe("OFF_STEP");
    expect(loi(r).goiY).toBe(250);
  });
  it("giá trị lệch bước không bao giờ ok", () => {
    for (const v of [240.2, 249.9, 240.25, 244.75, "240.3"]) expect(kiemGiaTriGhi(nhiet, v).ok).toBe(false);
  });
  it("250.5 ⇒ OUT_OF_RANGE", () => {
    expect(loi(kiemGiaTriGhi(nhiet, 250.5)).ma).toBe("OUT_OF_RANGE");
  });
  it("239.9999999999 ⇒ OUT_OF_RANGE (dải không có dung sai)", () => {
    expect(loi(kiemGiaTriGhi(nhiet, 239.9999999999)).ma).toBe("OUT_OF_RANGE");
  });
  it("245.00000000001 ⇒ ok (dung sai bước 1e-9 × max(1,|step|)); giá trị KHÔNG bị làm tròn", () => {
    expect(tot(kiemGiaTriGhi(nhiet, 245.00000000001))).toBe(245.00000000001);
  });
  it("biên 240 và 250 hợp lệ", () => {
    expect(tot(kiemGiaTriGhi(nhiet, 240))).toBe(240);
    expect(tot(kiemGiaTriGhi(nhiet, 250))).toBe(250);
  });
  it("dung sai tỷ lệ theo bước lớn: bước 100, lệch 1e-8 vẫn ok, lệch 1e-6 thì không", () => {
    const k = kenh({ writeMin: 0, writeMax: 1000, writeStep: 100 });
    expect(tot(kiemGiaTriGhi(k, 300 + 1e-8))).toBe(300 + 1e-8);
    expect(loi(kiemGiaTriGhi(k, 300 + 1e-6)).ma).toBe("OFF_STEP");
  });
  it("bước tính từ writeMin, không từ 0", () => {
    const k = kenh({ writeMin: 0.25, writeMax: 10, writeStep: 0.5 });
    expect(tot(kiemGiaTriGhi(k, 0.75))).toBe(0.75);
    const r = loi(kiemGiaTriGhi(k, 1));
    expect(r.ma).toBe("OFF_STEP");
    expect([0.75, 1.25]).toContain(r.goiY);
  });
  it("không có writeMin ⇒ bước tính từ 0", () => {
    const k = kenh({ writeMax: 10, writeStep: 0.5 });
    expect(tot(kiemGiaTriGhi(k, 3.5))).toBe(3.5);
    expect(loi(kiemGiaTriGhi(k, 3.2)).goiY).toBe(3);
  });
  it("goiY luôn nằm trong dải ngay cả khi bước gần nhất theo toán học ở ngoài dải", () => {
    // bước tính từ 240.2: 240.2, 240.7, …, 249.7 (> max) ⇒ bước lớn nhất trong dải là 249.2
    const k = kenh({ writeMin: 240.2, writeMax: 249.6, writeStep: 0.5 });
    const r = loi(kiemGiaTriGhi(k, 249.5));
    expect(r.ma).toBe("OFF_STEP");
    expect(r.goiY as number).toBeLessThanOrEqual(249.6);
    expect(r.goiY as number).toBeGreaterThanOrEqual(240.2);
    expect(r.goiY).toBeCloseTo(249.2, 9);
  });
  it("dải hẹp hơn một bước ⇒ goiY là writeMin (lưới luôn chứa writeMin)", () => {
    const k = kenh({ writeMin: 0.1, writeMax: 0.4, writeStep: 1 });
    const r = loi(kiemGiaTriGhi(k, 0.2));
    expect(r.ma).toBe("OFF_STEP");
    expect(r.goiY).toBe(0.1);
  });
  it.each([[NaN], [Infinity], [-Infinity], ["abc"], [""], ["0x10"], [true], [null], [undefined], [{}], ["NaN"], ["Infinity"]])(
    "%j ⇒ TYPE_MISMATCH",
    (v) => {
      expect(loi(kiemGiaTriGhi(nhiet, v)).ma).toBe("TYPE_MISMATCH");
    },
  );
});

describe("kiemGiaTriGhi — dung sai tương đối, dải âm, -0, giá trị khổng lồ", () => {
  it("1e8 + 0.3 với bước 0.1 (min NULL) ⇒ ok, không OFF_STEP oan", () => {
    const k = kenh({ writeStep: 0.1 });
    expect(tot(kiemGiaTriGhi(k, 1e8 + 0.3))).toBe(1e8 + 0.3);
    expect(tot(kiemGiaTriGhi(k, "100000000.3"))).toBe(100000000.3);
  });
  it("1e8 + 0.35 với bước 0.1 vẫn là OFF_STEP (dung sai tương đối không nuốt nửa bước)", () => {
    expect(loi(kiemGiaTriGhi(kenh({ writeStep: 0.1 }), 1e8 + 0.35)).ma).toBe("OFF_STEP");
  });
  it("dải âm min -10, step 0.3: -9.7 ok; -9.75 ⇒ OFF_STEP, goiY trong dải", () => {
    const k = kenh({ writeMin: -10, writeMax: 0, writeStep: 0.3 });
    expect(tot(kiemGiaTriGhi(k, -9.7))).toBe(-9.7);
    const r = loi(kiemGiaTriGhi(k, -9.75));
    expect(r.ma).toBe("OFF_STEP");
    expect(r.goiY).toBe(-9.7);
    expect(r.goiY as number).toBeGreaterThanOrEqual(-10);
    expect(r.goiY as number).toBeLessThanOrEqual(0);
  });
  it("writeMax + writeStep, writeMin NULL: lưới từ 0, goiY kẹp về điểm lưới ≤ max", () => {
    const k = kenh({ writeMax: 1, writeStep: 0.3 });
    expect(tot(kiemGiaTriGhi(k, 0.9))).toBe(0.9);
    expect(tot(kiemGiaTriGhi(k, -0.6))).toBe(-0.6); // không có cận dưới
    expect(loi(kiemGiaTriGhi(k, 1.1)).ma).toBe("OUT_OF_RANGE");
    const r = loi(kiemGiaTriGhi(k, 0.99)); // gần 1.2 nhất, nhưng 1.2 > max ⇒ 0.9
    expect(r.ma).toBe("OFF_STEP");
    expect(r.goiY).toBe(0.9);
  });
  it("-0 chuẩn hoá thành 0 cho int, float và chuỗi", () => {
    for (const k of [kenh({}), kenh({ dataType: "int" })]) {
      for (const v of [-0, "-0", "-0.0"]) {
        if (k.dataType === "int" && v === "-0.0") continue;
        const g = tot(kiemGiaTriGhi(k, v));
        expect(Object.is(g, 0)).toBe(true);
        expect(canonicalOtValue(g)).toBe(canonicalOtValue(0));
      }
    }
    expect(Object.is(tot(kiemGiaTriGhi(kenh({ writeMin: -1, writeMax: 1, writeStep: 0.5 }), -0)), 0)).toBe(true);
  });
  it("giá trị khổng lồ với bước: không ném, không NaN, trả ok nguyên giá trị", () => {
    expect(tot(kiemGiaTriGhi(kenh({ writeStep: 2 }), 1e30))).toBe(1e30);
    expect(tot(kiemGiaTriGhi(kenh({ writeStep: 0.1 }), 1.7e308))).toBe(1.7e308);
    expect(tot(kiemGiaTriGhi(kenh({ writeMin: 0, writeMax: 1e300, writeStep: 0.5 }), 1e299))).toBe(1e299);
  });
});

describe("kiemGiaTriGhi — cột NULL ⇒ không kiểm phần đó", () => {
  it("mọi cột NULL ⇒ chỉ ép kiểu", () => {
    expect(tot(kiemGiaTriGhi(kenh({}), "-1234.5e2"))).toBe(-123450);
    expect(tot(kiemGiaTriGhi(kenh({}), 1e30))).toBe(1e30);
  });
  it("chỉ min", () => {
    expect(loi(kiemGiaTriGhi(kenh({ writeMin: 0 }), -0.1)).ma).toBe("OUT_OF_RANGE");
    expect(tot(kiemGiaTriGhi(kenh({ writeMin: 0 }), 1e9))).toBe(1e9);
  });
  it("chỉ max", () => {
    expect(loi(kiemGiaTriGhi(kenh({ writeMax: 5 }), 5.1)).ma).toBe("OUT_OF_RANGE");
  });
  it("chỉ step (không dải)", () => {
    const r = loi(kiemGiaTriGhi(kenh({ writeStep: 2 }), 3));
    expect(r.ma).toBe("OFF_STEP");
    expect([2, 4]).toContain(r.goiY);
    expect(tot(kiemGiaTriGhi(kenh({ writeStep: 2 }), 4))).toBe(4);
    expect(tot(kiemGiaTriGhi(kenh({ writeStep: 2 }), -6))).toBe(-6);
  });
});

describe("kiemGiaTriGhi — int", () => {
  const i = kenh({ dataType: "int" });
  it("12.5 ⇒ TYPE_MISMATCH", () => {
    expect(loi(kiemGiaTriGhi(i, 12.5)).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(i, "12.5")).ma).toBe("TYPE_MISMATCH");
  });
  it("số nguyên và chuỗi nguyên được nhận", () => {
    expect(tot(kiemGiaTriGhi(i, 12))).toBe(12);
    expect(tot(kiemGiaTriGhi(i, "12"))).toBe(12);
    expect(tot(kiemGiaTriGhi(i, " -7 "))).toBe(-7);
    expect(tot(kiemGiaTriGhi(i, 12.0))).toBe(12);
  });
  it.each([["1e3"], ["abc"], [""], [true], [NaN], [null], ["0x10"]])("%j ⇒ TYPE_MISMATCH", (v) => {
    expect(loi(kiemGiaTriGhi(i, v)).ma).toBe("TYPE_MISMATCH");
  });
  it("ngoài miền số nguyên an toàn ⇒ TYPE_MISMATCH với thông điệp riêng", () => {
    for (const v of [2 ** 53, -(2 ** 53), 1e300, "9007199254740993", "-9007199254740993"]) {
      const r = loi(kiemGiaTriGhi(i, v));
      expect(r.ma).toBe("TYPE_MISMATCH");
      expect(r.chiTiet).toContain("an toàn");
    }
    expect(loi(kiemGiaTriGhi(i, 12.5)).chiTiet).not.toContain("an toàn");
    expect(tot(kiemGiaTriGhi(i, Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("dải + bước áp dụng cho int", () => {
    const k = kenh({ dataType: "int", writeMin: 0, writeMax: 100, writeStep: 5 });
    expect(tot(kiemGiaTriGhi(k, "50"))).toBe(50);
    expect(loi(kiemGiaTriGhi(k, 101)).ma).toBe("OUT_OF_RANGE");
    const r = loi(kiemGiaTriGhi(k, 52));
    expect(r.ma).toBe("OFF_STEP");
    expect(r.goiY).toBe(50);
  });
});

describe("kiemGiaTriGhi — string / json", () => {
  it("string nhận chuỗi, từ chối không-chuỗi (không stringify số)", () => {
    const s = kenh({ dataType: "string" });
    expect(tot(kiemGiaTriGhi(s, "abc"))).toBe("abc");
    expect(tot(kiemGiaTriGhi(s, ""))).toBe("");
    expect(loi(kiemGiaTriGhi(s, 12)).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(s, true)).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(s, null)).ma).toBe("TYPE_MISMATCH");
  });
  it("string bỏ qua dải/bước", () => {
    expect(tot(kiemGiaTriGhi(kenh({ dataType: "string", writeMin: 1, writeMax: 2, writeStep: 1 }), "zzz"))).toBe("zzz");
  });
  it("json: nhận giá trị tương thích JSON nguyên dạng, không kiểm dải", () => {
    const j = kenh({ dataType: "json", writeMin: 1, writeMax: 2, writeStep: 1 });
    const obj = { a: [1, 2, { b: null }], c: "x" };
    expect(tot(kiemGiaTriGhi(j, obj))).toEqual(obj);
    expect(tot(kiemGiaTriGhi(j, 99))).toBe(99);
    expect(tot(kiemGiaTriGhi(j, '{"a":1}'))).toBe('{"a":1}');
  });
  it("json: từ chối thứ không tương thích JSON", () => {
    const j = kenh({ dataType: "json" });
    expect(loi(kiemGiaTriGhi(j, undefined)).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(j, NaN)).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(j, () => 1)).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(j, { a: undefined })).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(j, BigInt(1))).ma).toBe("TYPE_MISMATCH");
  });
});

describe("băm: hai cách viết cùng giá trị ⇒ cùng canonicalOtValue", () => {
  it("float", () => {
    const a = tot(kiemGiaTriGhi(nhiet, "240.0"));
    const b = tot(kiemGiaTriGhi(nhiet, 240));
    expect(canonicalOtValue(a)).toBe(canonicalOtValue(b));
  });
  it("bool", () => {
    const vals = ["1", 1, true, "true", "TRUE"].map((v) => canonicalOtValue(tot(kiemGiaTriGhi(bool, v))));
    expect(new Set(vals).size).toBe(1);
  });
  it("int", () => {
    const i = kenh({ dataType: "int" });
    expect(canonicalOtValue(tot(kiemGiaTriGhi(i, "12")))).toBe(canonicalOtValue(tot(kiemGiaTriGhi(i, 12))));
  });
});

describe("kiem-dinh P1-3 — int có scale/offset: (v − offset)/scale phải NGUYÊN (driver `inverseScale` làm tròn im lặng ⇒ ghi = xác nhận)", () => {
  const i10 = { ...kenh({ dataType: "int" }), scale: "10.000000", offset: "0.000000" }; // decimal ⇒ chuỗi, như drizzle trả
  it("scale 10: 30 ⇒ ok (raw 3); 25 ⇒ OFF_STEP, goiY 30 (hoà 2.5 ⇒ Math.round lên — đúng giá trị driver đã lặng lẽ ghi), buoc 10", () => {
    expect(tot(kiemGiaTriGhi(i10, 30))).toBe(30);
    const r = loi(kiemGiaTriGhi(i10, 25));
    expect(r.ma).toBe("OFF_STEP");
    expect(r.goiY).toBe(30);
    expect(r.buoc).toBe(10);
    expect(r.chiTiet).toContain("10");
  });
  it("scale 10: 24 ⇒ goiY 20; 26 ⇒ goiY 30; −25 ⇒ goiY −20 (Math.round: hoà về phía +∞)", () => {
    expect(loi(kiemGiaTriGhi(i10, 24)).goiY).toBe(20);
    expect(loi(kiemGiaTriGhi(i10, 26)).goiY).toBe(30);
    expect(loi(kiemGiaTriGhi(i10, -25)).goiY).toBe(-20);
  });
  it("offset 5, scale 10: 25 ⇒ ok (raw 2); 30 ⇒ OFF_STEP goiY 35", () => {
    const k = { ...kenh({ dataType: "int" }), scale: 10, offset: 5 };
    expect(tot(kiemGiaTriGhi(k, 25))).toBe(25);
    expect(loi(kiemGiaTriGhi(k, 30)).goiY).toBe(35);
  });
  it("goiY KẸP vào dải: max 25 ⇒ 25 ngoài lưới thô ⇒ goiY 20 (30 vượt max); min 15 ⇒ 16 ⇒ goiY 20", () => {
    expect(loi(kiemGiaTriGhi({ ...i10, writeMax: 25 }, 25)).goiY).toBe(20);
    expect(loi(kiemGiaTriGhi({ ...i10, writeMin: 15 }, 16)).goiY).toBe(20);
  });
  it("dải không chứa điểm lưới thô nào ⇒ OFF_STEP KHÔNG có goiY", () => {
    const r = loi(kiemGiaTriGhi({ ...i10, writeMin: 21, writeMax: 29 }, 25));
    expect(r.ma).toBe("OFF_STEP");
    expect(r.goiY).toBeUndefined();
  });
  it("float KHÔNG bị ảnh hưởng (inverseScale không làm tròn float): 25 với scale 10 ⇒ ok", () => {
    expect(tot(kiemGiaTriGhi({ ...kenh({ dataType: "float" }), scale: 10, offset: 0 }, 25))).toBe(25);
  });
  it("scale 1 / offset 0 / vắng / NULL / 0 (driver coi 0 là 1) ⇒ hành vi cũ", () => {
    for (const s of [{ scale: 1, offset: 0 }, {}, { scale: null, offset: null }, { scale: "0", offset: "0" }]) {
      expect(tot(kiemGiaTriGhi({ ...kenh({ dataType: "int" }), ...s }, 25))).toBe(25);
    }
  });
  it("scale 0.5: mọi số nguyên đều nằm trên lưới thô (raw = 2v)", () => {
    expect(tot(kiemGiaTriGhi({ ...kenh({ dataType: "int" }), scale: 0.5 }, 7))).toBe(7);
  });
  it("bước + scale: 25 trên bước 5 nhưng lệch lưới thô 10 ⇒ OFF_STEP (buoc 10)", () => {
    const r = loi(kiemGiaTriGhi({ ...i10, writeMin: 0, writeMax: 100, writeStep: 5 }, 25));
    expect(r.ma).toBe("OFF_STEP");
    expect(r.buoc).toBe(10);
  });
  it("bool / string bỏ qua scale", () => {
    expect(tot(kiemGiaTriGhi({ ...kenh({ dataType: "bool" }), scale: 10 }, true))).toBe(true);
    expect(tot(kiemGiaTriGhi({ ...kenh({ dataType: "string" }), scale: 10 }, "x"))).toBe("x");
  });
});

// R1b-1 T10 — Sparkplug B giao số nguyên 64 bit dưới dạng đối tượng kiểu Long ({low, high, unsigned} + toNumber()).
// Dựng tay (duck-type), KHÔNG import thư viện long (chỉ là phụ thuộc bắc cầu).
function giaLong(n: bigint, unsigned = false) {
  const u = BigInt.asUintN(64, n);
  const low = Number(BigInt.asIntN(32, u & 0xffffffffn));
  const high = Number(BigInt.asIntN(32, u >> 32n));
  return { low, high, unsigned, toNumber: () => Number(unsigned ? u : BigInt.asIntN(64, u)) };
}
describe("kiemGiaTriGhi — đối tượng kiểu Long (Sparkplug B 64 bit)", () => {
  const i = kenh({ dataType: "int" });
  const f = kenh({ dataType: "float" });
  it("★ int: Long trong miền an toàn (cả dương, âm, unsigned) được nhận bằng đúng số", () => {
    expect(tot(kiemGiaTriGhi(i, giaLong(12n)))).toBe(12);
    expect(tot(kiemGiaTriGhi(i, giaLong(-7n)))).toBe(-7);
    expect(tot(kiemGiaTriGhi(i, giaLong(4_000_000_000n, true)))).toBe(4_000_000_000);
    expect(tot(kiemGiaTriGhi(i, giaLong(BigInt(Number.MAX_SAFE_INTEGER))))).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("★ int: Long NGOÀI miền an toàn ⇒ TYPE_MISMATCH (thông điệp miền an toàn), không làm tròn lặng lẽ", () => {
    for (const l of [giaLong(2n ** 53n), giaLong(-(2n ** 53n)), giaLong(2n ** 63n - 1n), giaLong(2n ** 64n - 1n, true)]) {
      const r = loi(kiemGiaTriGhi(i, l));
      expect(r.ma).toBe("TYPE_MISMATCH");
      expect(r.chiTiet).toContain("an toàn");
    }
  });
  it("float: Long an toàn được nhận; ngoài miền ⇒ TYPE_MISMATCH", () => {
    expect(tot(kiemGiaTriGhi(f, giaLong(250n)))).toBe(250);
    expect(loi(kiemGiaTriGhi(f, giaLong(2n ** 62n))).ma).toBe("TYPE_MISMATCH");
  });
  it("đối tượng KHÔNG đủ dấu hiệu Long (thiếu unsigned / toNumber không phải hàm / toNumber ném lỗi) ⇒ TYPE_MISMATCH", () => {
    expect(loi(kiemGiaTriGhi(i, { low: 1, high: 0, toNumber: () => 1 })).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(i, { low: 1, high: 0, unsigned: false, toNumber: 1 })).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(i, { low: 1, high: 0, unsigned: false, toNumber: () => { throw new Error("x"); } })).ma).toBe("TYPE_MISMATCH");
    expect(loi(kiemGiaTriGhi(i, { low: "1", high: 0, unsigned: false, toNumber: () => 1 })).ma).toBe("TYPE_MISMATCH");
  });
  it("Long vẫn chịu dải + bước của kênh", () => {
    const k = kenh({ dataType: "int", writeMin: 0, writeMax: 100, writeStep: 5 });
    expect(tot(kiemGiaTriGhi(k, giaLong(50n)))).toBe(50);
    expect(loi(kiemGiaTriGhi(k, giaLong(101n))).ma).toBe("OUT_OF_RANGE");
  });
});
