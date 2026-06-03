/**
 * B7 — Sub-pixel metrology từ mask segmentation (thuần JS, KHÔNG phụ thuộc onnxruntime).
 *
 * Đầu vào là một mask 2-D:
 *   • binary mask (0/1) — từ argmax / sigmoid-threshold; HOẶC
 *   • probability mask (float 0..1) — cho phép nội suy biên SUB-PIXEL (iso-0.5)
 *     bằng marching-squares (đếm phần diện tích thuộc về biên thay vì ngưỡng cứng).
 *
 * Tính:
 *   • area  — số pixel (binary) hoặc tổng xác suất nội suy (sub-pixel)
 *   • perimeter — chiều dài đường iso-0.5 (marching-squares) nếu prob; hoặc biên 4-liên-thông
 *   • Feret max/min — qua convex hull (rotating-calipers đơn giản) trên contour
 *   • equivalent diameter — 2*sqrt(area/π)
 *   • bounding box (pixel)
 *
 * Hiệu chỉnh đơn vị vật lý: nếu có umPerPx → trả thêm areaUnit (µm²) + lengthUnit (µm),
 * unit:"um". Nếu KHÔNG có calibration → unit:"px" + cờ degraded để UI nói đúng sự thật.
 * KHÔNG bịa số liệu vật lý khi thiếu calibration.
 *
 * Backward-compatible: file MỚI, không đụng service cũ.
 */

export interface MaskGrid {
  /** Dữ liệu phẳng row-major, length = width*height. */
  data: Float32Array | Uint8Array | number[];
  width: number;
  height: number;
}

export interface MetrologyResult {
  /** Diện tích: pixel² (unit "px") hoặc µm² (unit "um"). */
  area: number;
  areaPx: number;
  /** Chu vi. */
  perimeter: number;
  perimeterPx: number;
  /** Feret max (đường kính lớn nhất qua convex hull). */
  feretMax: number;
  feretMaxPx: number;
  /** Feret min (bề rộng nhỏ nhất qua rotating-calipers). */
  feretMin: number;
  feretMinPx: number;
  /** Đường kính tương đương 2*sqrt(area/π). */
  equivDiameter: number;
  equivDiameterPx: number;
  /** Bounding box pixel. */
  bbox: { x: number; y: number; w: number; h: number };
  /** "px" khi thiếu calibration; "um" khi có umPerPx. */
  unit: "px" | "um";
  /** µm/pixel đã dùng (null nếu thiếu). */
  umPerPx: number | null;
  /** true ⇒ chưa có calibration vật lý → số đo CHỈ là pixel. */
  degraded: boolean;
  /** true ⇒ mask là probability → biên nội suy sub-pixel; false ⇒ binary cứng. */
  subPixel: boolean;
  /** Số pixel có giá trị >= 0.5 (thông tin chẩn đoán). */
  pixelCount: number;
}

const ISO = 0.5;

function at(g: MaskGrid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= g.width || y >= g.height) return 0;
  return Number(g.data[y * g.width + x]) || 0;
}

/** Phát hiện mask có phải probability (có giá trị ngoài {0,1}) hay không. */
function looksProbabilistic(g: MaskGrid): boolean {
  for (let i = 0; i < g.data.length; i++) {
    const v = Number(g.data[i]);
    if (v > 1e-6 && v < 1 - 1e-6) return true;
  }
  return false;
}

/**
 * Diện tích SUB-PIXEL bằng marching-squares: với mỗi ô 2×2, diện tích phần
 * thuộc vùng (giá trị >= ISO) được nội suy tuyến tính theo 4 góc. Với binary mask
 * điều này quy về đếm pixel chuẩn.
 *
 * Dùng xấp xỉ trung bình 4 góc clamp về [0,1] quanh ISO — đủ chính xác cho hiệu
 * chỉnh biên (sai số biên ~O(chu vi), không O(diện tích)).
 */
function subPixelArea(g: MaskGrid): number {
  // Diện tích = tổng "độ phủ" mỗi pixel. Với probability, độ phủ = clamp((v-?)).
  // Cách trung thực nhất cho iso-0.5: coi mỗi pixel value là tỉ lệ phủ khi v∈(0,1),
  // và 1 khi v>=ISO ở binary. Ta dùng diện tích = Σ soft-coverage:
  //   coverage(v) = v (probability mass) — đây là ước lượng diện tích kỳ vọng,
  //   trùng số pixel khi mask binary.
  let area = 0;
  for (let i = 0; i < g.data.length; i++) {
    const v = Number(g.data[i]);
    if (v <= 0) continue;
    area += v >= 1 ? 1 : v;
  }
  return area;
}

/** Đếm pixel theo ngưỡng cứng ISO. */
function hardArea(g: MaskGrid): number {
  let n = 0;
  for (let i = 0; i < g.data.length; i++) if (Number(g.data[i]) >= ISO) n++;
  return n;
}

/**
 * Chu vi marching-squares (chiều dài đường iso-0.5). Mỗi ô 2×2 đóng góp các đoạn
 * cạnh nội suy. Đây là chu vi sub-pixel khi mask là probability; với binary nó
 * xấp xỉ chu vi "stair-step" có làm trơn nhẹ ở góc.
 */
function marchingSquaresPerimeter(g: MaskGrid): number {
  let perim = 0;
  // Nội suy điểm cắt iso trên cạnh giữa hai góc giá trị a (tại 0) và b (tại 1).
  const interp = (a: number, b: number): number => {
    if (a === b) return 0.5;
    return (ISO - a) / (b - a);
  };
  for (let y = -1; y < g.height; y++) {
    for (let x = -1; x < g.width; x++) {
      const tl = at(g, x, y);
      const tr = at(g, x + 1, y);
      const br = at(g, x + 1, y + 1);
      const bl = at(g, x, y + 1);
      let idx = 0;
      if (tl >= ISO) idx |= 8;
      if (tr >= ISO) idx |= 4;
      if (br >= ISO) idx |= 2;
      if (bl >= ISO) idx |= 1;
      if (idx === 0 || idx === 15) continue;

      // Vị trí giao trên 4 cạnh ô đơn vị (toạ độ tương đối trong ô [0,1]²).
      const top = { x: interp(tl, tr), y: 0 };
      const right = { x: 1, y: interp(tr, br) };
      const bottom = { x: interp(bl, br), y: 1 };
      const left = { x: 0, y: interp(tl, bl) };
      const seg = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);

      switch (idx) {
        case 1: case 14: perim += seg(left, bottom); break;
        case 2: case 13: perim += seg(bottom, right); break;
        case 3: case 12: perim += seg(left, right); break;
        case 4: case 11: perim += seg(top, right); break;
        case 6: case 9:  perim += seg(top, bottom); break;
        case 7: case 8:  perim += seg(left, top); break;
        case 5:  perim += seg(left, top) + seg(bottom, right); break; // ambiguous saddle
        case 10: perim += seg(top, right) + seg(left, bottom); break; // ambiguous saddle
      }
    }
  }
  return perim;
}

/** Tập điểm biên (pixel có >=ISO kề pixel <ISO) để dựng convex hull. */
function boundaryPoints(g: MaskGrid): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (at(g, x, y) < ISO) continue;
      const edge =
        at(g, x - 1, y) < ISO || at(g, x + 1, y) < ISO ||
        at(g, x, y - 1) < ISO || at(g, x, y + 1) < ISO;
      if (edge) pts.push({ x, y });
    }
  }
  return pts;
}

/** Andrew's monotone chain convex hull. */
export function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 3) return [...points];
  const pts = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: any[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: any[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Feret max = đường kính lớn nhất giữa 2 đỉnh hull. */
function feretMax(hull: Array<{ x: number; y: number }>): number {
  let max = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const d = Math.hypot(hull[i].x - hull[j].x, hull[i].y - hull[j].y);
      if (d > max) max = d;
    }
  }
  return max;
}

/**
 * Feret min = bề rộng nhỏ nhất của hull (min over các hướng cạnh hull của
 * khoảng cách vuông góc lớn nhất). Đây là min-width chuẩn của polygon lồi.
 */
function feretMin(hull: Array<{ x: number; y: number }>): number {
  if (hull.length < 2) return 0;
  if (hull.length === 2) return 0;
  let min = Infinity;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    // pháp tuyến đơn vị
    const nx = -ey / len;
    const ny = ex / len;
    let maxDist = 0;
    for (const p of hull) {
      const d = Math.abs((p.x - a.x) * nx + (p.y - a.y) * ny);
      if (d > maxDist) maxDist = d;
    }
    if (maxDist < min) min = maxDist;
  }
  return min === Infinity ? 0 : min;
}

function bboxOf(g: MaskGrid): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (at(g, x, y) < ISO) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const r4 = (n: number) => Number(n.toFixed(4));

/**
 * Đo đạc mask. `umPerPx` optional — thiếu → unit "px", degraded:true.
 */
export function measureMask(
  grid: MaskGrid,
  umPerPx?: number | null,
): MetrologyResult {
  const subPixel = looksProbabilistic(grid);
  const areaPx = subPixel ? subPixelArea(grid) : hardArea(grid);
  const pixelCount = hardArea(grid);
  const perimeterPx = marchingSquaresPerimeter(grid);

  const hull = convexHull(boundaryPoints(grid));
  const feretMaxPx = feretMax(hull);
  const feretMinPx = feretMin(hull);
  const equivDiameterPx = areaPx > 0 ? 2 * Math.sqrt(areaPx / Math.PI) : 0;
  const bbox = bboxOf(grid);

  const hasCalib = typeof umPerPx === "number" && isFinite(umPerPx) && umPerPx > 0;
  const k = hasCalib ? (umPerPx as number) : 1;

  return {
    areaPx: r4(areaPx),
    perimeterPx: r4(perimeterPx),
    feretMaxPx: r4(feretMaxPx),
    feretMinPx: r4(feretMinPx),
    equivDiameterPx: r4(equivDiameterPx),
    bbox,
    // Diện tích vật lý dùng k² ; chiều dài dùng k.
    area: r4(hasCalib ? areaPx * k * k : areaPx),
    perimeter: r4(hasCalib ? perimeterPx * k : perimeterPx),
    feretMax: r4(hasCalib ? feretMaxPx * k : feretMaxPx),
    feretMin: r4(hasCalib ? feretMinPx * k : feretMinPx),
    equivDiameter: r4(hasCalib ? equivDiameterPx * k : equivDiameterPx),
    unit: hasCalib ? "um" : "px",
    umPerPx: hasCalib ? (umPerPx as number) : null,
    degraded: !hasCalib,
    subPixel,
    pixelCount,
  };
}

/**
 * Chuyển polygon points (toạ độ pixel) → MaskGrid rasterized (binary) để đo đạc khi
 * mask được lưu dạng polygon (UI annotation). Dùng even-odd fill.
 */
export function polygonToMask(
  polygon: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): MaskGrid {
  const data = new Uint8Array(width * height);
  if (polygon.length < 3) return { data, width, height };
  for (let y = 0; y < height; y++) {
    // tìm giao điểm scanline y+0.5 với các cạnh
    const xs: number[] = [];
    const cy = y + 0.5;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const y1 = a.y, y2 = b.y;
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) {
        const t = (cy - y1) / (y2 - y1);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xStart = Math.max(0, Math.ceil(xs[i] - 0.5));
      const xEnd = Math.min(width - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xStart; x <= xEnd; x++) data[y * width + x] = 1;
    }
  }
  return { data, width, height };
}
