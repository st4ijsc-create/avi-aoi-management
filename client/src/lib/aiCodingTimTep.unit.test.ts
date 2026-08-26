/**
 * ★★★ LƯỚI cho TÌM TRONG TỆP (`aiCodingTimTep.ts`). Ca biên: rỗng · hoa-thường · CRLF · nhiều khớp một
 * dòng tính MỘT · vòng-lại chỉ số. Đo THẲNG bằng `toEqual`/`toBe`, không qua render trang.
 */
import { describe, it, expect } from "vitest";
import { timDongKhop, chiSoKhopKeTiep } from "./aiCodingTimTep";

const MA = "using System;\nclass Calc {\n  int Add(int a, int b) => a + b;\n  int add2(int x) => x + 2;\n}\n";

describe("§1 timDongKhop — số dòng (1-based) chứa từ khoá", () => {
  it("★★★ không phân biệt hoa/thường; trả 1-based đúng gutter", () => {
    // 'add' khớp dòng 3 ('Add') và dòng 4 ('add2') — hoa/thường đều nhận.
    expect(timDongKhop(MA, "add")).toEqual([3, 4]);
    expect(timDongKhop(MA, "ADD")).toEqual([3, 4]);
  });

  it("★★★ từ khoá RỖNG ⇒ [] (không coi cả tệp là khớp)", () => {
    expect(timDongKhop(MA, "")).toEqual([]);
  });

  it("★★ một dòng chứa NHIỀU lần từ khoá vẫn tính ĐÚNG MỘT dòng", () => {
    expect(timDongKhop("xxxx\nyy\nx x x\n", "x")).toEqual([1, 3]);
  });

  it("★★ tách CRLF (Windows) như LF", () => {
    expect(timDongKhop("alpha\r\nbeta\r\nAlphaBeta\r\n", "alpha")).toEqual([1, 3]);
  });

  it("★ không khớp ⇒ []", () => {
    expect(timDongKhop(MA, "zzz")).toEqual([]);
  });
});

describe("§2 chiSoKhopKeTiep — điều hướng có VÒNG LẠI", () => {
  it("★★★ tiến: cuối → đầu (vòng lại)", () => {
    expect(chiSoKhopKeTiep(2, 3, true)).toBe(0); // đang ở khớp cuối (index 2/3) → về đầu
    expect(chiSoKhopKeTiep(0, 3, true)).toBe(1);
  });

  it("★★★ lùi: đầu → cuối (vòng lại)", () => {
    expect(chiSoKhopKeTiep(0, 3, false)).toBe(2);
    expect(chiSoKhopKeTiep(2, 3, false)).toBe(1);
  });

  it("★ tổng = 0 ⇒ 0 (không có khớp để nhảy)", () => {
    expect(chiSoKhopKeTiep(0, 0, true)).toBe(0);
  });
});
