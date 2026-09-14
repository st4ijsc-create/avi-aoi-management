import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NGUONG_GON_PX, SO_MAT_XICH_HIEN_DU, gopBreadcrumb, laGon } from "./boCucThanhCongCu";
import type { MatXich } from "./phamViCanh";

const C = (n: number): MatXich[] =>
  (["tapDoan", "nhaMay", "tang", "line", "may"] as const).slice(0, n).map((cap, i) => ({ cap, id: i, nhan: `cap-${cap}` }));

describe("Đợt 45 mục 2/9 — boCucThanhCongCu", () => {
  it("laGon: header 968 (1280 có sidebar) ⇒ gọn; 1288 (1600) và 1232 (1280 thu sidebar) ⇒ không; chưa đo ⇒ không", () => {
    expect(NGUONG_GON_PX).toBe(1100);
    expect(laGon(968)).toBe(true);
    expect(laGon(1288)).toBe(false);
    expect(laGon(1232)).toBe(false);
    expect(laGon(null)).toBe(false);
    expect(laGon(0)).toBe(false);
    expect(laGon(undefined)).toBe(false);
  });
  it("gopBreadcrumb: ≤ 3 mắt xích & rộng ⇒ hiện hết, không '…'", () => {
    expect(SO_MAT_XICH_HIEN_DU).toBe(3);
    expect(gopBreadcrumb(C(3), false)).toEqual({ anCap: [], hien: C(3) });
    expect(gopBreadcrumb(C(1), false)).toEqual({ anCap: [], hien: C(1) });
    expect(gopBreadcrumb(C(0), true)).toEqual({ anCap: [], hien: [] });
  });
  it("gopBreadcrumb: gọn ⇒ gập cấp trên, GIỮ cha + hiện tại; ≥ 4 mắt xích gập cả khi rộng", () => {
    expect(gopBreadcrumb(C(3), true)).toEqual({ anCap: C(3).slice(0, 1), hien: C(3).slice(1) });
    expect(gopBreadcrumb(C(5), false)).toEqual({ anCap: C(5).slice(0, 3), hien: C(5).slice(3) });
    expect(gopBreadcrumb(C(2), true)).toEqual({ anCap: [], hien: C(2) });
  });
  it("bất biến: phần tử cuối của `hien` LUÔN là cấp hiện tại; anCap + hien = đầu vào", () => {
    for (const n of [1, 2, 3, 4, 5]) for (const gon of [true, false]) {
      const g = gopBreadcrumb(C(n), gon);
      expect([...g.anCap, ...g.hien]).toEqual(C(n));
      if (n > 0) expect(g.hien[g.hien.length - 1]).toEqual(C(n)[n - 1]);
    }
  });
  it("★ G16 — `TwinVanHanh` GỌI cả hai hàm; viên trạng thái sống trong khung neo cảnh với `data-che-nhan`", () => {
    const src = readFileSync(new URL("../../../pages/TwinVanHanh.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/laGon\(/);
    expect(src).toMatch(/gopBreadcrumb\(/);
    expect(src).toMatch(/data-testid="cum-trang-thai-du-lieu"[\s\S]{0,400}data-che-nhan="1"/);
    // Bốn huy hiệu tin cậy vẫn còn NGUYÊN testid (hợp đồng đo Đợt 21/38/44).
    for (const t of ["trang-thai-ket-noi", "co-che-giao-so", "badge-xuat-xu", "do-tuoi-nen", "badge-qua-cu-nen"]) {
      expect(src, t).toMatch(new RegExp(`data-testid="${t}"`));
    }
  });
});
