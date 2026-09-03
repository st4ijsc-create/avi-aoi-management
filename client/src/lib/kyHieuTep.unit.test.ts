/**
 * ★★★ 2026-09-03 · ĐỢT E2 — LƯỚI CHO `trichKyHieu`.
 *
 * Luật của module là **THÀ THIẾU CÒN HƠN TRỎ SAI**, nên lưới này nặng phần ÂM: §2 liệt kê những
 * thứ KHÔNG được thành mục. Nới một khuôn để "bắt nhiều hơn" mà làm §2 đỏ là đã phá đúng thứ
 * module tồn tại để giữ.
 */
import { describe, expect, it } from "vitest";
import { trichKyHieu, TRAN_KY_HIEU } from "./kyHieuTep";

describe("§1 DƯƠNG — các khuôn khai báo phải bắt được, kèm ĐÚNG số dòng", () => {
  it("★★★ TS/JS: function · const-arrow · class · interface/type · HẰNG HOA", () => {
    const ma = [
      "export function moTep(a: string) {",
      "const chay = async () => {",
      "export class HopCat {",
      "export interface DiaDiemLoi {",
      "type Nhom = 1 | 2;",
      "export const TRAN_BYTE = 1024;",
    ].join("\n");
    expect(trichKyHieu(ma, "x.ts")).toEqual([
      { ten: "moTep", loai: "ham", dong: 1 },
      { ten: "chay", loai: "ham", dong: 2 },
      { ten: "HopCat", loai: "lop", dong: 3 },
      { ten: "DiaDiemLoi", loai: "kieu", dong: 4 },
      { ten: "Nhom", loai: "kieu", dong: 5 },
      { ten: "TRAN_BYTE", loai: "hang", dong: 6 },
    ]);
  });

  it("★★ C# và Python đi bằng khuôn riêng", () => {
    expect(trichKyHieu("public sealed class Calculator {", "a.cs")).toEqual([{ ten: "Calculator", loai: "lop", dong: 1 }]);
    expect(trichKyHieu("public record Diem(int X);", "a.cs")).toEqual([{ ten: "Diem", loai: "kieu", dong: 1 }]);
    expect(trichKyHieu("def tinh_tong(a, b):", "a.py")).toEqual([{ ten: "tinh_tong", loai: "ham", dong: 1 }]);
  });

  it("★ thụt lề vẫn bắt (phương thức trong lớp)", () => {
    expect(trichKyHieu("class A {\n  function b() {}\n}", "a.ts").map((k) => k.ten)).toEqual(["A", "b"]);
  });
});

describe("§2 ÂM — thà THIẾU còn hơn TRỎ SAI", () => {
  it("★★★ biến thường KHÔNG thành mục (outline đầy biến là outline vô dụng)", () => {
    expect(trichKyHieu("const x = 1;\nlet ten = 2;\nconst mang = [1, 2];", "a.ts")).toEqual([]);
  });

  it("★★★ LỜI GỌI hàm không phải KHAI BÁO", () => {
    expect(trichKyHieu("moTep(1);\n  chay();\nawait tinhTong(1, 2);", "a.ts")).toEqual([]);
  });

  it("★★★ tệp DỮ LIỆU (json/md) ⇒ rỗng, không bịa mục từ chuỗi", () => {
    expect(trichKyHieu('{\n  "function": "x"\n}', "package.json")).toEqual([]);
    expect(trichKyHieu("# class Tieu de\nfunction trong markdown", "doc.md")).toEqual([]);
  });

  it("★★ dòng KHỔNG LỒ (bundle/minified) bị bỏ qua", () => {
    expect(trichKyHieu("function a(){}" + " ".repeat(500), "a.js")).toEqual([]);
  });

  it("★ rỗng / không phải chuỗi ⇒ rỗng, không ném", () => {
    expect(trichKyHieu("", "a.ts")).toEqual([]);
    expect(trichKyHieu(undefined as never, "a.ts")).toEqual([]);
  });
});

describe("§3 TRẦN — danh sách phải dừng ở đúng con số đã khai", () => {
  it("★★★ vượt trần ⇒ cắt ở TRAN_KY_HIEU", () => {
    const ma = Array.from({ length: TRAN_KY_HIEU + 50 }, (_, i) => "function f" + i + "() {}").join("\n");
    expect(trichKyHieu(ma, "a.ts").length).toBe(TRAN_KY_HIEU);
  });
});

describe("§4 THỨ TỰ KHUÔN là một quyết định", () => {
  it("★★ `export const FOO_BAR = () => {}` là HÀM, không phải hằng (khuôn hàm đứng trước)", () => {
    expect(trichKyHieu("export const FOO_BAR = () => {};", "a.ts")).toEqual([{ ten: "FOO_BAR", loai: "ham", dong: 1 }]);
  });
});
