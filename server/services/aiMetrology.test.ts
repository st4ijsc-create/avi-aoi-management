/**
 * B7 — aiMetrology tests. So số đo với giá trị giải tích trên hình ĐÃ BIẾT.
 * Pure (không cần onnxruntime).
 */
import { describe, it, expect } from "vitest";
import { measureMask, polygonToMask, convexHull, type MaskGrid } from "./aiMetrology";

/** Tạo mask hình vuông N×N (binary) trong lưới size×size, gốc tại (ox,oy). */
function squareMask(size: number, n: number, ox = 0, oy = 0): MaskGrid {
  const data = new Uint8Array(size * size);
  for (let y = oy; y < oy + n; y++)
    for (let x = ox; x < ox + n; x++)
      if (x < size && y < size) data[y * size + x] = 1;
  return { data, width: size, height: size };
}

/** Mask hình tròn bán kính R, tâm (cx,cy), trong lưới size×size. */
function circleMask(size: number, R: number, cx: number, cy: number, prob = false): MaskGrid {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (prob) {
        // probability mask: soft edge quanh R (sub-pixel)
        data[y * size + x] = Math.max(0, Math.min(1, R + 0.5 - d));
      } else {
        data[y * size + x] = d <= R ? 1 : 0;
      }
    }
  return { data, width: size, height: size };
}

describe("measureMask — hình vuông", () => {
  it("vuông 10×10 → area=100, Feret≈ đường chéo, bbox đúng", () => {
    const N = 10;
    const m = measureMask(squareMask(40, N, 5, 5));
    expect(m.areaPx).toBe(N * N); // 100, binary → đếm pixel chính xác
    expect(m.pixelCount).toBe(N * N);
    // Feret max = đường chéo giữa 2 góc đối: ~ sqrt(2)*(N-1)
    const diag = Math.SQRT2 * (N - 1);
    expect(Math.abs(m.feretMaxPx - diag)).toBeLessThan(1.5);
    // Feret min ≈ cạnh (N-1)
    expect(Math.abs(m.feretMinPx - (N - 1))).toBeLessThan(1.5);
    expect(m.bbox).toEqual({ x: 5, y: 5, w: N, h: N });
    expect(m.unit).toBe("px");
    expect(m.degraded).toBe(true);
  });
});

describe("measureMask — hình tròn", () => {
  it("tròn R=15 → area≈πR², equivDia≈2R, chu vi≈2πR", () => {
    const R = 15;
    const m = measureMask(circleMask(60, R, 30, 30));
    const analyticArea = Math.PI * R * R; // ~706.9
    // sai số rasterization < 5%
    expect(Math.abs(m.areaPx - analyticArea) / analyticArea).toBeLessThan(0.05);
    // equivDia = 2*sqrt(area/π) ≈ 2R
    expect(Math.abs(m.equivDiameterPx - 2 * R)).toBeLessThan(2);
    // Feret max ≈ 2R (đường kính)
    expect(Math.abs(m.feretMaxPx - 2 * R)).toBeLessThan(2);
    // chu vi ≈ 2πR ~ 94.2 (marching-squares, sai số biên)
    const analyticPerim = 2 * Math.PI * R;
    expect(Math.abs(m.perimeterPx - analyticPerim) / analyticPerim).toBeLessThan(0.1);
  });

  it("probability mask (sub-pixel) → subPixel=true, area gần giải tích", () => {
    const R = 12;
    const m = measureMask(circleMask(50, R, 25, 25, true));
    expect(m.subPixel).toBe(true);
    const analyticArea = Math.PI * R * R;
    expect(Math.abs(m.areaPx - analyticArea) / analyticArea).toBeLessThan(0.05);
  });
});

describe("measureMask — calibration µm/pixel", () => {
  it("umPerPx=2 → diện tích ×4, chiều dài ×2, unit 'um'", () => {
    const N = 10;
    const px = measureMask(squareMask(40, N, 5, 5));
    const um = measureMask(squareMask(40, N, 5, 5), 2);
    expect(um.unit).toBe("um");
    expect(um.degraded).toBe(false);
    expect(um.umPerPx).toBe(2);
    expect(um.area).toBeCloseTo(px.areaPx * 4, 3);
    expect(um.feretMax).toBeCloseTo(px.feretMaxPx * 2, 3);
    expect(um.equivDiameter).toBeCloseTo(px.equivDiameterPx * 2, 3);
    // cột pixel vẫn giữ nguyên
    expect(um.areaPx).toBe(px.areaPx);
  });

  it("thiếu calibration → unit 'px', umPerPx null, degraded true", () => {
    const m = measureMask(squareMask(20, 5, 2, 2));
    expect(m.unit).toBe("px");
    expect(m.umPerPx).toBeNull();
    expect(m.degraded).toBe(true);
  });

  it("umPerPx không hợp lệ (0/âm) → degrade về px", () => {
    expect(measureMask(squareMask(20, 5, 2, 2), 0).unit).toBe("px");
    expect(measureMask(squareMask(20, 5, 2, 2), -1).degraded).toBe(true);
  });
});

describe("convexHull + polygonToMask", () => {
  it("hull của tập điểm vuông trả 4 góc", () => {
    const hull = convexHull([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 },
    ]);
    expect(hull.length).toBe(4);
  });

  it("polygon vuông → rasterize ra area xấp xỉ diện tích polygon", () => {
    const poly = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];
    const grid = polygonToMask(poly, 40, 40);
    const m = measureMask(grid);
    // diện tích polygon = 10×10 = 100; rasterization sai số nhỏ
    expect(Math.abs(m.areaPx - 100) / 100).toBeLessThan(0.2);
    expect(m.areaPx).toBeGreaterThan(0);
  });
});
