/**
 * banDoNho.unit.test.ts — mini-map click-to-navigate (§11.9 #56).
 *
 * ★★★ G20 — import `./banDoNho`, module giao hàng.
 * ★★★ G5  — mọi phép đo trên bản đồ CÓ CHẤM ở toạ độ biết trước; click ở điểm
 *   biết trước phải cho điểm scene biết trước. Một mini-map rỗng "chiếu đúng"
 *   với mọi công thức, kể cả công thức sai.
 * ★★★ BẪY HOÁN VỊ TRỤC — có test riêng chứng minh trục ĐỨNG (Y) bị BỎ, không
 *   phải trục Z.
 */

import { describe, expect, it } from "vitest";

import {
  CANH_BAN_DO_PX,
  DEM_BAN_DO_PX,
  camDiToi,
  diemNgamTuClick,
  dungCham,
  dungPhepChieu,
  pxSangScene,
  pxTuChuot,
  sceneSangPx,
} from "./banDoNho";

/** Sàn thật đo được trên DB dev: 38,4 × 29,6 m. */
const SAN = { minX: 0, maxX: 38.4, minY: 0, maxY: 0, minZ: 0, maxZ: 29.6 };
const HOP = { left: 0, top: 0, width: CANH_BAN_DO_PX, height: CANH_BAN_DO_PX };

describe("dungPhepChieu", () => {
  it("MỘT tỉ lệ cho cả hai trục — không bóp hình dạng nhà xưởng", () => {
    const c = dungPhepChieu(SAN);
    const trong = CANH_BAN_DO_PX - DEM_BAN_DO_PX * 2;
    // Chiều dài hơn (38,4) là chiều chi phối.
    expect(c.tiLe).toBeCloseTo(trong / 38.4, 9);
  });

  it("★ vùng CAO hơn RỘNG thì chiều sâu chi phối", () => {
    const c = dungPhepChieu({ minX: 0, maxX: 10, minY: 0, maxY: 0, minZ: 0, maxZ: 50 });
    const trong = CANH_BAN_DO_PX - DEM_BAN_DO_PX * 2;
    expect(c.tiLe).toBeCloseTo(trong / 50, 9);
  });

  it("gốc chiếu là góc min của vùng, không phải gốc toạ độ", () => {
    const c = dungPhepChieu({ minX: 100, maxX: 110, minY: 0, maxY: 0, minZ: 200, maxZ: 210 });
    expect(c.gocX).toBe(100);
    expect(c.gocZ).toBe(200);
  });

  it("vùng suy biến không cho tỉ lệ Infinity/NaN (chia 0)", () => {
    const c = dungPhepChieu({ minX: 5, maxX: 5, minY: 0, maxY: 0, minZ: 5, maxZ: 5 });
    expect(Number.isFinite(c.tiLe)).toBe(true);
    expect(Number.isFinite(sceneSangPx({ x: 5, y: 0, z: 5 }, c).px)).toBe(true);
  });

  it("vùng KHÔNG CÓ THỰC vẫn cho phép chiếu dùng được", () => {
    const c = dungPhepChieu({ minX: 1, maxX: -1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
    expect(Number.isFinite(c.tiLe)).toBe(true);
  });
});

describe("sceneSangPx — CHIẾU X–Z (bẫy hoán vị trục)", () => {
  const c = dungPhepChieu(SAN);

  it("góc (minX, minZ) rơi đúng vào (DEM, DEM)", () => {
    const p = sceneSangPx({ x: 0, y: 0, z: 0 }, c);
    expect(p.px).toBeCloseTo(DEM_BAN_DO_PX, 9);
    expect(p.py).toBeCloseTo(DEM_BAN_DO_PX, 9);
  });

  it("★★★ BỎ TRỤC ĐỨNG Y — hai máy chỉ khác ĐỘ CAO phải CHỒNG KHÍT trên mini-map", () => {
    const duoi = sceneSangPx({ x: 12, y: 0, z: 20 }, c);
    const tren = sceneSangPx({ x: 12, y: 9.5, z: 20 }, c);
    expect(tren.px).toBeCloseTo(duoi.px, 12);
    expect(tren.py).toBeCloseTo(duoi.py, 12);
  });

  it("★★★ KHÔNG bỏ trục Z — hai máy khác Z phải TÁCH RA (đối chứng của test trên)", () => {
    const a = sceneSangPx({ x: 12, y: 0, z: 4 }, c);
    const b = sceneSangPx({ x: 12, y: 0, z: 24 }, c);
    expect(Math.abs(b.py - a.py)).toBeGreaterThan(20);
  });

  it("★ scene.z TĂNG ⇒ px.y TĂNG (xuống dưới) — không lật trục", () => {
    const gan = sceneSangPx({ x: 0, y: 0, z: 2 }, c);
    const xa = sceneSangPx({ x: 0, y: 0, z: 25 }, c);
    expect(xa.py).toBeGreaterThan(gan.py);
  });

  it("★ scene.x TĂNG ⇒ px.x TĂNG (sang phải)", () => {
    expect(sceneSangPx({ x: 30, y: 0, z: 0 }, c).px).toBeGreaterThan(
      sceneSangPx({ x: 3, y: 0, z: 0 }, c).px,
    );
  });

  it("mọi điểm trong sàn nằm TRONG ô mini-map", () => {
    for (const p of [
      { x: 0, y: 0, z: 0 },
      { x: 38.4, y: 0, z: 29.6 },
      { x: 19.2, y: 3, z: 14.8 },
    ]) {
      const q = sceneSangPx(p, c);
      expect(q.px).toBeGreaterThanOrEqual(0);
      expect(q.px).toBeLessThanOrEqual(CANH_BAN_DO_PX);
      expect(q.py).toBeGreaterThanOrEqual(0);
      expect(q.py).toBeLessThanOrEqual(CANH_BAN_DO_PX);
    }
  });
});

describe("pxSangScene — nghịch đảo CHÍNH XÁC của sceneSangPx", () => {
  const c = dungPhepChieu(SAN);

  it("khứ hồi giữ nguyên x và z", () => {
    for (const p of [
      { x: 0, y: 0, z: 0 },
      { x: 5.45, y: 0, z: 4.95 },
      { x: 32.95, y: 0, z: 20.8 },
    ]) {
      const lai = pxSangScene(sceneSangPx(p, c), c);
      expect(lai.x).toBeCloseTo(p.x, 9);
      expect(lai.z).toBeCloseTo(p.z, 9);
    }
  });

  it("y trả 0 — mini-map KHÔNG mang độ cao và tự khai điều đó", () => {
    expect(pxSangScene({ px: 50, py: 50 }, c).y).toBe(0);
  });
});

describe("pxTuChuot", () => {
  it("trừ left/top của hộp, không dùng offset", () => {
    const p = pxTuChuot({ clientX: 1000, clientY: 700 }, { left: 900, top: 640, width: CANH_BAN_DO_PX, height: CANH_BAN_DO_PX });
    expect(p.px).toBeCloseTo(100, 9);
    expect(p.py).toBeCloseTo(60, 9);
  });

  it("★ phần tử bị CSS co giãn ⇒ quy về hệ px logic của SVG", () => {
    // Phần tử hiển thị 296 px nhưng viewBox vẫn 148 ⇒ hệ số 0,5.
    const p = pxTuChuot(
      { clientX: 100, clientY: 60 },
      { left: 0, top: 0, width: 296, height: 296 },
    );
    expect(p.px).toBeCloseTo(50, 9);
    expect(p.py).toBeCloseTo(30, 9);
  });

  it("hộp rộng 0 không cho NaN", () => {
    const p = pxTuChuot({ clientX: 10, clientY: 10 }, { left: 0, top: 0, width: 0, height: 0 });
    expect(Number.isFinite(p.px)).toBe(true);
  });
});

describe("diemNgamTuClick — CLICK Ở ĐÂU, CAMERA TỚI ĐÓ (ca dương G5)", () => {
  const c = dungPhepChieu(SAN);

  it("★★★ click ĐÚNG chỗ chấm của một máy ⇒ điểm ngắm TRÙNG vị trí máy đó", () => {
    // Máy thật đo trên DB: (5,45 m ; 4,95 m). Chiếu ra px rồi click lại vào đó.
    const may = { x: 5.45, y: 0, z: 4.95 };
    const p = sceneSangPx(may, c);
    const ngam = diemNgamTuClick({ clientX: p.px, clientY: p.py }, HOP, c, SAN);
    expect(ngam.x).toBeCloseTo(may.x, 6);
    expect(ngam.z).toBeCloseTo(may.z, 6);
  });

  it("★★★ click ở GÓC ĐỐI DIỆN cho điểm ngắm KHÁC HẲN — không phải hằng số", () => {
    const a = diemNgamTuClick({ clientX: DEM_BAN_DO_PX, clientY: DEM_BAN_DO_PX }, HOP, c, SAN);
    const p = sceneSangPx({ x: 38.4, y: 0, z: 29.6 }, c);
    const b = diemNgamTuClick({ clientX: p.px, clientY: p.py }, HOP, c, SAN);
    expect(a.x).toBeCloseTo(0, 6);
    expect(b.x).toBeCloseTo(38.4, 6);
    expect(b.z - a.z).toBeCloseTo(29.6, 6);
  });

  it("★ click vào PHẦN ĐỆM (ngoài sàn) bị KẸP về mép, không đẩy camera ra ngoài xưởng", () => {
    const ngam = diemNgamTuClick({ clientX: 0, clientY: 0 }, HOP, c, SAN);
    expect(ngam.x).toBeGreaterThanOrEqual(SAN.minX);
    expect(ngam.z).toBeGreaterThanOrEqual(SAN.minZ);
    const xa = diemNgamTuClick({ clientX: 999, clientY: 999 }, HOP, c, SAN);
    expect(xa.x).toBeLessThanOrEqual(SAN.maxX);
    expect(xa.z).toBeLessThanOrEqual(SAN.maxZ);
  });

  it("vùng không có thực ⇒ không kẹp, trả thẳng điểm chiếu ngược", () => {
    const rong = { minX: 1, maxX: -1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    const ngam = diemNgamTuClick({ clientX: 50, clientY: 50 }, HOP, c, rong);
    expect(Number.isFinite(ngam.x)).toBe(true);
  });
});

describe("camDiToi — TỊNH TIẾN cả cặp (camera, target)", () => {
  const cam = { x: 40, y: 25, z: 60 };
  const ngamCu = { x: 19.2, y: 1, z: 14.8 };

  it("★★★ giữ nguyên VECTOR NHÌN — camera ĐI, không QUAY tại chỗ", () => {
    const moi = { x: 5, y: 0, z: 25 };
    const kq = camDiToi(cam, ngamCu, moi);
    const truocX = cam.x - ngamCu.x;
    const truocZ = cam.z - ngamCu.z;
    expect(kq.viTri.x - kq.ngam.x).toBeCloseTo(truocX, 9);
    expect(kq.viTri.z - kq.ngam.z).toBeCloseTo(truocZ, 9);
  });

  it("★★★ giữ nguyên KHOẢNG CÁCH — không lao vào giữa đám máy", () => {
    const moi = { x: 5, y: 0, z: 25 };
    const kq = camDiToi(cam, ngamCu, moi);
    const d0 = Math.hypot(cam.x - ngamCu.x, cam.y - ngamCu.y, cam.z - ngamCu.z);
    const d1 = Math.hypot(
      kq.viTri.x - kq.ngam.x,
      kq.viTri.y - kq.ngam.y,
      kq.viTri.z - kq.ngam.z,
    );
    expect(d1).toBeCloseTo(d0, 9);
  });

  it("ngắm mới ĐÚNG chỗ đã click trên mặt bằng", () => {
    const kq = camDiToi(cam, ngamCu, { x: 5, y: 0, z: 25 });
    expect(kq.ngam.x).toBe(5);
    expect(kq.ngam.z).toBe(25);
  });

  it("★ KHÔNG đổi độ cao camera — mini-map không mang độ cao nên không bịa ra", () => {
    const kq = camDiToi(cam, ngamCu, { x: 5, y: 0, z: 25 });
    expect(kq.viTri.y).toBe(cam.y);
    expect(kq.ngam.y).toBe(ngamCu.y);
  });

  it("click đúng chỗ đang ngắm ⇒ không dời gì", () => {
    const kq = camDiToi(cam, ngamCu, { x: ngamCu.x, y: 0, z: ngamCu.z });
    expect(kq.viTri).toEqual(cam);
  });
});

describe("dungCham", () => {
  const c = dungPhepChieu(SAN);

  it("giữ nguyên thứ tự và khoá đầu vào", () => {
    const ds = dungCham(
      [
        { khoa: "machine:1", viTri: { x: 5, y: 0, z: 5 }, mau: "#0f0" },
        { khoa: "machine:2", viTri: { x: 30, y: 0, z: 20 }, mau: "#f00", chon: true },
      ],
      c,
    );
    expect(ds.map((d) => d.khoa)).toEqual(["machine:1", "machine:2"]);
    expect(ds[1].chon).toBe(true);
    expect(ds[0].chon).toBe(false);
  });

  it("★ 42 máy thật cho 42 chấm — số chấm bám nội dung, không phải hằng", () => {
    const ds = dungCham(
      Array.from({ length: 42 }, (_, i) => ({
        khoa: `machine:${i}`,
        viTri: { x: 5 + i * 0.6, y: 0, z: 5 + (i % 7) * 2 },
        mau: "#888",
      })),
      c,
    );
    expect(ds).toHaveLength(42);
    expect(new Set(ds.map((d) => `${d.px.toFixed(3)},${d.py.toFixed(3)}`)).size).toBeGreaterThan(30);
  });

  it("rỗng cho mảng rỗng, không ném", () => {
    expect(dungCham([], c)).toEqual([]);
  });
});
