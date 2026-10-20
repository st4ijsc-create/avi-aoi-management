import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { danhGia, danhGiaChuoi, danhGiaThamSo, kiemCuPhap, LoiBieuThuc, type NguCanhBieuThuc } from "./bieuThuc";

const NGU: NguCanhBieuThuc = {
  json: { ten: "AOI-2", soLoi: 3, ds: [10, 20, 30], ct: { muc: { sau: "x" } }, rong: "" },
  input: [{ json: { a: 1 } }, { json: { a: 2 } }],
  nodes: { doc: [{ json: { line: "L2", oee: 0.87 } }, { json: { line: "L3" } }] },
  env: { NHA_MAY: "HN" },
  run: { id: "r1", flowId: "f1", batDau: "2026-10-20T00:00:00Z" },
};
const g = (s: string) => danhGia(s, NGU);

describe("bieuThuc (Đợt 8.0)", () => {
  it("đường dẫn, mảng, node, input, env, run", () => {
    expect(g("$json.ten")).toBe("AOI-2");
    expect(g("$json.ds[1]")).toBe(20);
    expect(g("$json['ct'].muc.sau")).toBe("x");
    expect(g("$json.khongCo.sau")).toBeUndefined();
    expect(g('$node("doc").json.oee')).toBe(0.87);
    expect(g('$node("doc").items[1].line')).toBe("L3");
    expect(g("$input.length")).toBe(2);
    expect(g("$input.items[1].a")).toBe(2);
    expect(g("$env.NHA_MAY")).toBe("HN");
    expect(g("$env.PATH")).toBeUndefined();
    expect(g("$run.flowId")).toBe("f1");
  });

  it("toán tử + ưu tiên + ba ngôi + so sánh chặt", () => {
    expect(g("1 + 2 * 3")).toBe(7);
    expect(g("(1 + 2) * 3")).toBe(9);
    expect(g("10 - 4 - 3")).toBe(3);
    expect(g("$json.soLoi > 2 && $json.ten == 'AOI-2'")).toBe(true);
    expect(g("$json.soLoi >= 5 ? 'cao' : 'thap'")).toBe("thap");
    expect(g("1 == '1'")).toBe(false);
    expect(g("!($json.soLoi < 1) || false")).toBe(true);
    expect(g("'L' + 2")).toBe("L2");
    expect(g("-$json.soLoi")).toBe(-3);
    expect(g("7 % 4")).toBe(3);
  });

  it("hàm danh sách trắng", () => {
    expect(g("upper($json.ten)")).toBe("AOI-2");
    expect(g("len($json.ds)")).toBe(3);
    expect(g("join($json.ds, '-')")).toBe("10-20-30");
    expect(g("round(2.345, 2)")).toBe(2.35);
    expect(g("max(1, $json.soLoi, 2)")).toBe(3);
    expect(g("isEmpty($json.rong)")).toBe(true);
    expect(g("toNumber('12.5')")).toBe(12.5);
    expect(g("contains($json.ds, 20)")).toBe(true);
  });

  it("mẫu chuỗi: nguyên kiểu khi chỉ một {{ }}, nối khi lẫn chữ; tham số lồng", () => {
    expect(danhGiaChuoi("{{ $json.soLoi }}", NGU)).toBe(3);
    expect(danhGiaChuoi("Máy {{ $json.ten }} có {{ $json.soLoi }} lỗi", NGU)).toBe("Máy AOI-2 có 3 lỗi");
    expect(danhGiaChuoi("không biểu thức", NGU)).toBe("không biểu thức");
    expect(danhGiaThamSo({ a: ["{{ 1 + 1 }}", { b: "x{{ $env.NHA_MAY }}" }] }, NGU)).toEqual({ a: [2, { b: "xHN" }] });
  });

  it("AN TOÀN: không chạm prototype/constructor, không gọi phương thức, không hàm lạ, không biến lạ", () => {
    for (const s of [
      "$json.constructor",
      "$json['__proto__']",
      "$json.ds.constructor",
      "$json['con' + 'structor']",
      "$json.prototype",
    ]) expect(() => g(s), s).toThrow(LoiBieuThuc);
    expect(() => g("$json.ten.toUpperCase()")).toThrow(/phương thức/);
    expect(() => g("eval('1')")).toThrow(/danh sách cho phép/);
    expect(() => g("process")).toThrow(/biến lạ/);
    expect(() => g("globalThis")).toThrow(/biến lạ/);
    expect(g("$json.toString")).toBeUndefined(); // thuộc tính KẾ THỪA không thấy được
    expect(() => danhGia("1+".repeat(1100) + "1", NGU)).toThrow(/dài quá/);
    expect(() => danhGia("(".repeat(70) + "1" + ")".repeat(70), NGU)).toThrow(/lồng sâu/);
    expect(danhGiaThamSo({ __proto__x: 1, constructor: "{{ 1 }}" }, NGU)).toEqual({ __proto__x: 1 });
  });

  it("lỗi cú pháp có thông điệp + vị trí", () => {
    expect(kiemCuPhap("$json.a +")).toMatch(/thiếu toán hạng/);
    expect(kiemCuPhap("'chưa đóng")).toMatch(/chuỗi chưa đóng/);
    expect(kiemCuPhap("1 2")).toMatch(/thừa ký hiệu/);
    expect(kiemCuPhap("$json.a + 1")).toBeNull();
  });

  it("mã nguồn KHÔNG dùng eval / new Function", () => {
    const src = fs.readFileSync(path.join(__dirname, "bieuThuc.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/new\s+Function/);
  });
});
