import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { maskTheoMep, tinhMep } from "./CuonNgangCoMep";

describe("Đợt 45 mục 11 — CuonNgangCoMep: mép tính từ số đo thật", () => {
  it("vừa khung ⇒ không cuộn được, không mép, không mask", () => {
    expect(tinhMep(0, 680, 680)).toEqual({ cuonDuoc: false, trai: false, phai: false });
    expect(tinhMep(0, 680, 681)).toEqual({ cuonDuoc: false, trai: false, phai: false });
    expect(maskTheoMep(false, false)).toBe("");
  });
  it("tràn ⇒ đầu: chỉ mép phải · giữa: hai mép · cuối: chỉ mép trái", () => {
    expect(tinhMep(0, 680, 1100)).toEqual({ cuonDuoc: true, trai: false, phai: true });
    expect(tinhMep(200, 680, 1100)).toEqual({ cuonDuoc: true, trai: true, phai: true });
    expect(tinhMep(420, 680, 1100)).toEqual({ cuonDuoc: true, trai: true, phai: false });
  });
  it("mask chỉ mờ phía CÒN nội dung", () => {
    expect(maskTheoMep(false, true)).toMatch(/^linear-gradient\(to right, black 0, black calc\(100% - 36px\), transparent\)$/);
    expect(maskTheoMep(true, false)).toMatch(/transparent, black 36px, black 100%/);
    expect(maskTheoMep(true, true)).toMatch(/transparent, black 36px, black calc\(100% - 36px\), transparent/);
  });
  it("★ G16 — `MachineCockpit` bọc TabsList bằng `CuonNgangCoMep` (testid `thanh-tab-cockpit`), không còn `ScrollArea` câm quanh tab", () => {
    const src = readFileSync(new URL("../../pages/MachineCockpit.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/<CuonNgangCoMep[\s\S]*?testid="thanh-tab-cockpit"[\s\S]*?<TabsList/);
    expect(src).not.toMatch(/<ScrollArea className="w-full">\s*<TabsList/);
  });
});
