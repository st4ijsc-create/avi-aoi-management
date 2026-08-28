/**
 * LƯỚI gộp danh sách dự án. Bất biến CHỐNG NHẦM LẪN CHẾT NGƯỜI: mục LOCAL và SERVER phải phân
 * biệt được bằng mắt (nhãn) và bằng mã (trường `loai`) — dev tưởng sửa tệp local mà thật ra động
 * vào box AI là tai nạn không cứu được.
 */
import { describe, it, expect } from "vitest";
import { gopDanhSachDuAn } from "./duAn";

describe("gopDanhSachDuAn", () => {
  it("★★★ LOCAL đứng trước và có nhãn LOCAL", () => {
    const ds = gopDanhSachDuAn(["d:/du-an/aoi"], [{ id: "csharp", name: "Demo Csharp" }]);
    expect(ds[0].loai).toBe("local");
    expect(ds[0].nhan).toContain("LOCAL");
  });

  it("★★★ mục SERVER có nhãn SERVER", () => {
    const ds = gopDanhSachDuAn([], [{ id: "csharp", name: "Demo Csharp" }]);
    expect(ds[0].loai).toBe("server");
    expect(ds[0].nhan).toContain("SERVER");
    expect(ds[0].nhan).toContain("Demo Csharp");
  });

  it("★★★ id KHÔNG đụng nhau giữa hai nguồn (tiền tố riêng)", () => {
    const ds = gopDanhSachDuAn(["d:/x/csharp"], [{ id: "csharp", name: "Csharp" }]);
    expect(new Set(ds.map((m) => m.id)).size).toBe(ds.length);
  });

  it("★★ không có workspace và không có dự án server ⇒ danh sách rỗng", () => {
    expect(gopDanhSachDuAn([], [])).toEqual([]);
  });
});
