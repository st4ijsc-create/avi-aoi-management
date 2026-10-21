import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { danhGia, danhGiaChuoi, danhGiaThamSo, kiemCuPhap, LoiBieuThuc, TRAN_KET_QUA_CHUOI, type NguCanhBieuThuc } from "./bieuThuc";

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

describe("trần độ dài kết quả chuỗi (Đợt 9 — L1)", () => {
  const ngu = (json: Record<string, unknown>): NguCanhBieuThuc => ({ json });
  const TRAN = TRAN_KET_QUA_CHUOI;

  it("phép nối vượt trần ⇒ LoiBieuThuc NGAY (kiểm độ dài trước khi nối); đúng bằng trần ⇒ được; thêm một ký tự ⇒ lỗi", () => {
    const a = "x".repeat(TRAN / 2);
    expect(() => danhGia("$json.a + $json.a + 'y'", ngu({ a }))).toThrow(/phép nối dài quá/);
    expect(danhGia("$json.a + $json.a", ngu({ a })) as string).toHaveLength(TRAN);
    expect(() => danhGia("$json.a + $json.a + '1'", ngu({ a }))).toThrow(LoiBieuThuc);
    expect(danhGia("'a' + 1 + null", ngu({}))).toBe("a1");
    expect(danhGia("1 + 2", ngu({}))).toBe(3);
  });

  it("★ khuếch đại: biểu thức ≤ 2000 ký tự lặp `a+a+…` trên chuỗi 5 KB (×249 ≈ 1,2 MB) bị chặn; dưới trần vẫn chạy", () => {
    const bt = Array(249).fill("$json.a").join("+"); // 249×7 + 248 = 1991 ký tự
    expect(bt.length).toBeLessThanOrEqual(2000);
    expect(() => danhGia(bt, ngu({ a: "z".repeat(5000) }))).toThrow(/phép nối dài quá/);
    expect((danhGia(bt, ngu({ a: "z".repeat(4000) })) as string).length).toBe(996_000);
  });

  it("mẫu {{ }} lẫn chữ: tổng độ dài vượt trần ⇒ lỗi; trả nguyên kiểu (một {{ }}) không bị ảnh hưởng ở dưới trần", () => {
    const a = "q".repeat(400_000);
    expect(() => danhGiaChuoi("{{ $json.a }}-{{ $json.a }}-{{ $json.a }}", ngu({ a }))).toThrow(/mẫu dài quá/);
    expect(danhGiaChuoi("{{ $json.a }}-{{ $json.a }}", ngu({ a })) as string).toHaveLength(800_001);
    expect(danhGiaChuoi("{{ $json.n }}", ngu({ n: 5 }))).toBe(5);
    expect(() => danhGiaThamSo({ s: "{{ $json.a }}{{ $json.a }}{{ $json.a }}" }, ngu({ a }))).toThrow(LoiBieuThuc);
  });

  it("join: dấu phân cách dài × nhiều phần tử vượt trần ⇒ lỗi trước khi nối; phần tử lớn cũng vậy; bình thường vẫn chạy", () => {
    const l = Array(2000).fill("a");
    expect(() => danhGia("join($json.l, $json.sep)", ngu({ l, sep: "S".repeat(1024) }))).toThrow(/join dài quá/);
    expect(() => danhGia("join($json.l)", ngu({ l: ["x".repeat(TRAN), "y"] }))).toThrow(/join dài quá/);
    expect(danhGia("join($json.l, '-')", ngu({ l: ["a", null, 3] }))).toBe("a--3");
    expect(danhGia("join($json.l)", ngu({ l: [] }))).toBe("");
  });
});
