/**
 * `hoatAnhDongChay.unit.test.ts` — ĐỢT 35, Pareto #6 (§15.6 D-7): dòng chảy chỉ chạy sau một KÍCH.
 *
 * Đo trước vá: `/twin/line/2` đứng yên **88–158 khung / 4 s**; `/twin/may/14` 0–5 / 2 s. Mục tiêu
 * E7: idle ≤ 2 khung / 4 s, kéo chuột ⇒ vẫn vẽ. Hạng A: luật thuần. Hạng B: `DongChayLine.tsx`
 * đã nối luật vào `useFrame` (không còn `invalidate()` vô điều kiện khi có nhịp).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CUA_SO_HOAT_ANH_MS, NHIP_TOI_DA_MS, cameraDaDoi, nenHoatAnh, nhipHopLe } from "./hoatAnhDongChay";

describe("★★★ nenHoatAnh — chạy trong cửa sổ sau kích, đứng ngoài cửa sổ", () => {
  const NHIP = 2400;
  it("chưa từng kích ⇒ KHÔNG chạy, dù nhịp hợp lệ", () => {
    expect(nenHoatAnh(10_000, null, NHIP)).toBe(false);
    expect(nenHoatAnh(10_000, NaN, NHIP)).toBe(false);
  });
  it("vừa kích ⇒ chạy; đúng hết cửa sổ ⇒ đứng (biên [0, CỬA SỔ))", () => {
    expect(nenHoatAnh(1000, 1000, NHIP)).toBe(true);
    expect(nenHoatAnh(1000 + CUA_SO_HOAT_ANH_MS - 1, 1000, NHIP)).toBe(true);
    expect(nenHoatAnh(1000 + CUA_SO_HOAT_ANH_MS, 1000, NHIP)).toBe(false);
    expect(nenHoatAnh(1000 + 60_000, 1000, NHIP)).toBe(false);
  });
  it("★★★ nhịp null / 0 / âm / NaN / quá chậm ⇒ ĐỨNG YÊN kể cả khi vừa kích (không tốc độ bịa)", () => {
    for (const n of [null, undefined, 0, -5, NaN, Infinity, NHIP_TOI_DA_MS + 1]) {
      expect(nenHoatAnh(1000, 1000, n), String(n)).toBe(false);
      expect(nhipHopLe(n)).toBe(false);
    }
    expect(nhipHopLe(NHIP_TOI_DA_MS)).toBe(true);
    expect(nhipHopLe(1)).toBe(true);
  });
  it("đồng hồ lùi (bayGio < mocKich) ⇒ coi như vừa kích — không kẹt vĩnh viễn", () => {
    expect(nenHoatAnh(500, 1000, NHIP)).toBe(true);
  });
  it("★ cửa sổ ≤ 2 000 ms — để phép đo idle 4 s của QA (≤ 2 khung) còn dư địa sau khi camera dừng", () => {
    expect(CUA_SO_HOAT_ANH_MS).toBeGreaterThan(0);
    expect(CUA_SO_HOAT_ANH_MS).toBeLessThanOrEqual(2000);
  });
  it("cửa sổ tuỳ chỉnh được tôn trọng", () => {
    expect(nenHoatAnh(1000 + 300, 1000, NHIP, 200)).toBe(false);
    expect(nenHoatAnh(1000 + 100, 1000, NHIP, 200)).toBe(true);
  });
});

describe("cameraDaDoi — nhận ra tương tác bằng 7 số của camera", () => {
  const A = [1, 2, 3, 0, 0, 0, 1];
  it("chưa có mốc ⇒ ĐỔI (lần đầu cũng kích); giống hệt ⇒ không đổi; lệch quá epsilon ⇒ đổi", () => {
    expect(cameraDaDoi(null, A)).toBe(true);
    expect(cameraDaDoi(A, [...A])).toBe(false);
    expect(cameraDaDoi(A, [1, 2, 3.001, 0, 0, 0, 1])).toBe(true);
    expect(cameraDaDoi(A, [1, 2, 3 + 1e-9, 0, 0, 0, 1])).toBe(false);
  });
  it("độ dài khác ⇒ đổi (không so nhầm một mảng cụt)", () => {
    expect(cameraDaDoi([1, 2, 3], A)).toBe(true);
  });
});

describe("★★★ Hạng B — `DongChayLine.tsx` nối luật vào `useFrame` (G93: kit đúng ≠ ai gọi)", () => {
  const MA = readFileSync(resolve(__dirname, "DongChayLine.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const useFrameBody = MA.slice(MA.indexOf("useFrame((_, delta) => {"));
  it("`useFrame` hỏi `nenHoatAnh(bayGio, mocKich.current, nhipMs)` TRƯỚC khi `invalidate()`", () => {
    const CUA = "if (!nenHoatAnh(bayGio, mocKich.current, nhipMs)) return;";
    const iNen = useFrameBody.indexOf(CUA);
    const iInv = useFrameBody.indexOf("invalidate();");
    expect(iNen).toBeGreaterThan(-1);
    expect(iInv).toBeGreaterThan(iNen);
    // Giữa cửa `nenHoatAnh` và `invalidate()` KHÔNG có `return` nào khác (không đường vòng qua cửa).
    expect(useFrameBody.slice(iNen + CUA.length, iInv)).not.toMatch(/\breturn\b/);
  });
  it("kích khi camera đổi (`cameraDaDoi` trên vị trí + quaternion) và khi dữ liệu/nhịp đổi (`useEffect` đặt `mocKich`)", () => {
    expect(useFrameBody).toMatch(/cameraDaDoi\(tuTheCu\.current, tuThe\)/);
    expect(useFrameBody).toMatch(/\[p\.x, p\.y, p\.z, q\.x, q\.y, q\.z, q\.w\]/);
    expect(MA).toMatch(/useEffect\(\(\) => \{\s*datMuiTen\(tienDo\.current\);\s*mocKich\.current = performance\.now\(\);\s*invalidate\(\);\s*\}, \[datMuiTen, invalidate, nhipMs\]\)/);
  });
  it("★ ĐỐI CHỨNG — không còn dạng cũ `if (nhipMs == null || …) return;` rồi `invalidate()` vô điều kiện", () => {
    expect(useFrameBody).not.toMatch(/nhipMs > NHIP_TOI_DA_MS\) return;/);
    expect(MA).toMatch(/export \{ CUA_SO_HOAT_ANH_MS, NHIP_TOI_DA_MS \};/);
  });
});
