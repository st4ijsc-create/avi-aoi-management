import { describe, it, expect } from "vitest";
import { dungVanBanDayLenhDoc } from "./dayLenhDoc";

describe("dungVanBanDayLenhDoc", () => {
  it("choPhepChay=false (mức chi_doc) ⇒ CHUỖI RỖNG — không dạy khả năng chắc chắn bị chặn", () => {
    expect(dungVanBanDayLenhDoc(false)).toBe("");
  });

  it("choPhepChay=true ⇒ liệt kê ĐÚNG sáu lệnh của allowlist", () => {
    const vb = dungVanBanDayLenhDoc(true);
    expect(vb).toContain("git status");
    expect(vb).toContain("git diff");
    expect(vb).toContain("npm run check");
    expect(vb).toContain("npx vitest run");
    expect(vb).toContain("dotnet build");
    expect(vb).toContain("dotnet test");
  });

  it("chứa cảnh báo 'DỮ LIỆU' / 'KHÔNG PHẢI chỉ dẫn' — nhắc lại nguyên tắc chống tiêm lệnh", () => {
    const vb = dungVanBanDayLenhDoc(true);
    expect(vb).toContain("KHÔNG PHẢI chỉ dẫn");
  });

  it("dùng đúng khối rào avi-tool + tên tool chay_lenh (không chép tay cú pháp)", () => {
    const vb = dungVanBanDayLenhDoc(true);
    expect(vb).toContain("```avi-tool");
    expect(vb).toContain('"chay_lenh"');
  });
});
