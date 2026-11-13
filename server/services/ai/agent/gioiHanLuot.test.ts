import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hopGioiHanLuot, soLuotToiDaTuEnv, TRAN_CUNG_SO_LUOT } from "./gioiHanLuot";

describe("soLuotToiDaTuEnv — AI_AGENT_SO_LUOT_TOI_DA", () => {
  it("★★★ chưa đặt / rỗng ⇒ undefined (không đổi gì)", () => {
    expect(soLuotToiDaTuEnv({})).toBeUndefined();
    expect(soLuotToiDaTuEnv({ AI_AGENT_SO_LUOT_TOI_DA: "" })).toBeUndefined();
    expect(soLuotToiDaTuEnv({ AI_AGENT_SO_LUOT_TOI_DA: "   " })).toBeUndefined();
  });
  it.each(["0", "-5", "3.5", "abc", "1e3", "0x20", "+30", "30 lượt", "NaN", "Infinity", "٣٠"])("★★★ giá trị không hợp lệ %s ⇒ undefined", (v) => {
    expect(soLuotToiDaTuEnv({ AI_AGENT_SO_LUOT_TOI_DA: v })).toBeUndefined();
  });
  it.each([
    ["1", 1],
    ["20", 20],
    ["30", 30],
    ["60", 60],
    ["120", 120],
    [" 45 ", 45],
    ["007", 7],
  ])("★★★ %s ⇒ %s", (v, kq) => {
    expect(soLuotToiDaTuEnv({ AI_AGENT_SO_LUOT_TOI_DA: v })).toBe(kq);
  });
  it.each(["121", "500", "999999"])("★★★ %s vượt trần cứng ⇒ kẹp về %s", (v) => {
    expect(soLuotToiDaTuEnv({ AI_AGENT_SO_LUOT_TOI_DA: v })).toBe(TRAN_CUNG_SO_LUOT);
  });
  it("★★ số quá dài (≥ 7 chữ số) ⇒ không hợp lệ (không để Number() tràn)", () => {
    expect(soLuotToiDaTuEnv({ AI_AGENT_SO_LUOT_TOI_DA: "1234567" })).toBeUndefined();
  });
  it("★ trần cứng là 120", () => {
    expect(TRAN_CUNG_SO_LUOT).toBe(120);
  });
});

describe("hopGioiHanLuot", () => {
  it("★★★ env chưa đặt ⇒ trả NGUYÊN tham chiếu gốc (kể cả undefined) — không đổi một byte", () => {
    const goc = { msToiDa: 5 };
    expect(hopGioiHanLuot(goc, {})).toBe(goc);
    expect(hopGioiHanLuot(undefined, {})).toBeUndefined();
    expect(hopGioiHanLuot(goc, { AI_AGENT_SO_LUOT_TOI_DA: "abc" })).toBe(goc);
  });
  it("★★★ env đặt, gốc vắng ⇒ { soLuotToiDa }", () => {
    expect(hopGioiHanLuot(undefined, { AI_AGENT_SO_LUOT_TOI_DA: "60" })).toEqual({ soLuotToiDa: 60 });
  });
  it("★★★ env đặt, gốc có khoá khác ⇒ giữ khoá khác và thêm soLuotToiDa", () => {
    expect(hopGioiHanLuot({ msToiDa: 5 }, { AI_AGENT_SO_LUOT_TOI_DA: "60" })).toEqual({ soLuotToiDa: 60, msToiDa: 5 });
  });
  it("★★★ gốc đã nêu soLuotToiDa ⇒ GỐC THẮNG env (người gọi tường minh)", () => {
    expect(hopGioiHanLuot({ soLuotToiDa: 10 }, { AI_AGENT_SO_LUOT_TOI_DA: "60" })).toEqual({ soLuotToiDa: 10 });
  });
  it("★★ env vượt trần ⇒ kẹp 120", () => {
    expect(hopGioiHanLuot(undefined, { AI_AGENT_SO_LUOT_TOI_DA: "9999" })).toEqual({ soLuotToiDa: 120 });
  });
  it("★★ không sửa đối tượng gốc", () => {
    const goc = { msToiDa: 5 };
    hopGioiHanLuot(goc, { AI_AGENT_SO_LUOT_TOI_DA: "60" });
    expect(goc).toEqual({ msToiDa: 5 });
  });
});

describe("nối vào quanLyLuotChay (đọc nguồn: quanLyLuotChay cần DB nên không nạp ở đây)", () => {
  const nguon = fs.readFileSync(path.join(__dirname, "quanLyLuotChay.ts"), "utf8");
  it("★★★ cả ba nhánh của `gioiHan` đều đi qua hopGioiHanLuot(phuThuoc.gioiHan, process.env); không còn `phuThuoc.gioiHan` trần trong biểu thức đó", () => {
    const i = nguon.indexOf("gioiHan: capNgoai");
    expect(i).toBeGreaterThan(0);
    const khoi = nguon.slice(i, i + 600);
    expect(khoi.match(/hopGioiHanLuot\(phuThuoc\.gioiHan, process\.env\)/g)).toHaveLength(3);
    expect(khoi).not.toMatch(/\.\.\.phuThuoc\.gioiHan/);
    expect(khoi).not.toMatch(/: phuThuoc\.gioiHan,/);
  });
  it("★★ import có thật", () => {
    expect(nguon).toContain('import { hopGioiHanLuot } from "./gioiHanLuot";');
  });
});
