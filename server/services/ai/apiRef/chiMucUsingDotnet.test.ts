/**
 * ★ 2026-10-18 — nạp bảng kiểu→namespace cho R2B: bảng CHỌN TAY `dotnet-using.json` (theo dõi trong git) hợp với bảng
 * SINH `ky-hieu/dotnet-kieu-ns.json` (gitignore). Bảng cũ THẮNG cho tên nó có (tương thích tuyệt đối); bảng sinh chỉ
 * góp tên MỚI vào `kieuMoRong`; `moRong` (phương thức mở rộng) chỉ lấy từ bảng cũ.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hopNhatChiMucUsing, napChiMucUsingDotnet } from "./chiMucUsingDotnet";

const CU = {
  nguon: [".NET 10.0.10 (net10.0)"],
  kieu: { SqlConnection: ["Microsoft.Data.SqlClient"], DataTable: ["System.Data"] },
  moRong: { GetInt32: { ns: "System.Data", doiTuong: ["DbDataReader"], thamSo2: ["String"] } },
};
const SINH = {
  nguon: [".NET 10.0.10", "ASP.NET Core 10.0.10"],
  kieu: {
    SqlConnection: ["Microsoft.Data.SqlClient", "System.Data.SqlClient"],
    JsonSerializer: ["System.Text.Json"],
    DataTable: ["System.Data"],
  },
  moRong: { Append: { ns: "Microsoft.AspNetCore.Http", doiTuong: ["IHeaderDictionary"], thamSo2: ["String"] } },
  nsBiet: ["System.Data", "System.Text.Json", "Microsoft.Data.SqlClient"],
};

describe("hopNhatChiMucUsing", () => {
  it("bảng cũ thắng tên trùng; tên mới vào kieuMoRong; moRong chỉ từ bảng cũ; nsBiet gồm cả namespace bảng cũ", () => {
    const r = hopNhatChiMucUsing(CU, SINH)!;
    expect(r.kieu).toEqual(CU.kieu);
    expect(r.kieuMoRong).toEqual({ JsonSerializer: ["System.Text.Json"] });
    expect(r.moRong).toEqual(CU.moRong);
    expect(new Set(r.nsBiet)).toEqual(new Set(["System.Data", "System.Text.Json", "Microsoft.Data.SqlClient"]));
    expect(r.nguon).toEqual([".NET 10.0.10 (net10.0)", ".NET 10.0.10", "ASP.NET Core 10.0.10"]);
  });
  it("không có bảng sinh ⇒ đúng bảng cũ (không kieuMoRong)", () => {
    expect(hopNhatChiMucUsing(CU, null)).toEqual(CU);
  });
  it("không có bảng cũ ⇒ bảng sinh vào kieu (vẫn dùng được), moRong rỗng", () => {
    const r = hopNhatChiMucUsing(null, SINH)!;
    expect(r.kieu).toEqual({});
    expect(r.kieuMoRong!.JsonSerializer).toEqual(["System.Text.Json"]);
    expect(r.moRong).toEqual({});
  });
  it("cả hai vắng ⇒ null", () => {
    expect(hopNhatChiMucUsing(null, null)).toBeNull();
  });
});

describe("napChiMucUsingDotnet", () => {
  it("đọc hai tệp theo thư mục gốc knowledge; tệp hỏng ⇒ coi như vắng, không ném", () => {
    const goc = fs.mkdtempSync(path.join(os.tmpdir(), "using-"));
    fs.mkdirSync(path.join(goc, "api-ref", "ky-hieu"), { recursive: true });
    fs.writeFileSync(path.join(goc, "api-ref", "dotnet-using.json"), JSON.stringify(CU));
    fs.writeFileSync(path.join(goc, "api-ref", "ky-hieu", "dotnet-kieu-ns.json"), JSON.stringify(SINH));
    expect(napChiMucUsingDotnet(goc)!.kieuMoRong).toEqual({ JsonSerializer: ["System.Text.Json"] });
    fs.writeFileSync(path.join(goc, "api-ref", "ky-hieu", "dotnet-kieu-ns.json"), "{hỏng");
    expect(napChiMucUsingDotnet(goc)).toEqual(CU);
    fs.rmSync(goc, { recursive: true, force: true });
  });
});
