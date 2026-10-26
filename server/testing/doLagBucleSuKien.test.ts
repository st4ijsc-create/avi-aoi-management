/**
 * Helper `doLagBucleSuKien` (kiem-dinh 2026-10-26) — kiểm TẤT ĐỊNH bằng đồng hồ/CPU giả (hẹn giờ thật + tải thật làm phép đo tự nó nhiễu).
 * Bất biến: (1) máy RẢNH (khoảng nhịp = chu kỳ hẹn giờ thật) ⇒ nới ≈ 0 — bản đầu trừ buocMs=5 trong khi Windows bắn mỗi 15,6 ms ⇒ ~68 % thời gian
 * ngủ bị tính "máy không chạy ta"; (2) bị chiếm CPU ⇒ nới > 0; (3) tự chặn đồng bộ (CPU ≈ trễ) ⇒ KHÔNG nới; (4) `dung()` có trần mặc định,
 * không trần phải tường minh; (5) hiệu chuẩn lấy phân vị thấp (tải không làm lệch chu kỳ rảnh).
 * Đột biến: quay về trừ `buocMs` ⇒ (1) đỏ; bỏ trừ CPU ⇒ (3) đỏ; bỏ trần mặc định ⇒ (4) đỏ.
 */
import { describe, expect, it } from "vitest";
import { batDauDoLag, hieuChuanChuKy, TRAN_MAC_DINH, type PhuThuocDoLag } from "./doLagBucleSuKien";

/** Đồng hồ + CPU + hẹn giờ giả; `chay(khoang, cpu)` đẩy thời gian và bắn nhịp. */
function dongHoGia(chuKyRanh: number) {
  let t = 0;
  let cpu = 0;
  let cb: (() => void) | null = null;
  const dep: PhuThuocDoLag = {
    now: () => t,
    cpuMs: () => cpu,
    setInterval: (f) => ((cb = f), 1),
    clearInterval: () => {
      cb = null;
    },
    setTimeout: (f) => (f(), 2),
    chuKyRanh: async () => chuKyRanh,
  };
  return {
    dep,
    chay(khoang: number, cpuDung: number, soNhip = 1) {
      for (let i = 0; i < soNhip; i++) {
        t += khoang;
        cpu += cpuDung;
        cb?.();
      }
    },
  };
}

describe("doLagBucleSuKien", () => {
  it("(1) máy rảnh: 64 nhịp đúng chu kỳ 15,6 ms (≈1 000 ms ngủ) ⇒ nới ≤ 5 % (bản cũ trừ 5 ms ⇒ ~680 ms)", async () => {
    const g = dongHoGia(15.6);
    const lag = batDauDoLag(5, g.dep);
    g.chay(15.6, 0, 64);
    const noi = await lag.dung(Infinity);
    expect(noi).toBeLessThanOrEqual(50);
  });

  it("(2) bị chiếm CPU: 10 nhịp trễ 500 ms, tiến trình không chạy ⇒ nới ≈ tổng trễ", async () => {
    const g = dongHoGia(15.6);
    const lag = batDauDoLag(5, g.dep);
    g.chay(500, 0, 10);
    const noi = await lag.dung(Infinity);
    expect(noi).toBeGreaterThan(4500);
    expect(noi).toBeLessThanOrEqual(10 * 500);
  });

  it("(3) tự chặn đồng bộ 500 ms (tiến trình CHẠY: CPU ≈ trễ) ⇒ KHÔNG nới", async () => {
    const g = dongHoGia(15.6);
    const lag = batDauDoLag(5, g.dep);
    g.chay(500, 500, 1);
    expect(await lag.dung(Infinity)).toBeLessThanOrEqual(20);
  });

  it("(4) trần mặc định 100 ms; không trần phải tường minh (Infinity); trần tuỳ chọn", async () => {
    const lap = async (tran?: number) => {
      const g = dongHoGia(15.6);
      const lag = batDauDoLag(5, g.dep);
      g.chay(500, 0, 10);
      return tran === undefined ? lag.dung() : lag.dung(tran);
    };
    expect(TRAN_MAC_DINH).toBe(100);
    expect(await lap()).toBe(100);
    expect(await lap(30)).toBe(30);
    expect(await lap(Infinity)).toBeGreaterThan(4500);
  });

  it("(5) hiệu chuẩn: phân vị 10 % ⇒ chu kỳ rảnh dù 2/20 khoảng nhịp bị tải kéo dài", async () => {
    const khoang = [...Array(18).fill(15.6), 120, 300];
    let t = 0;
    let i = 0;
    let cb: (() => void) | null = null;
    const dep = {
      now: () => t,
      setInterval: (f: () => void) => ((cb = f), 1),
      clearInterval: () => {
        cb = null;
      },
    };
    const p = hieuChuanChuKy(dep, 5, 20);
    for (; i < 20; i++) {
      t += khoang[i]!;
      cb?.();
    }
    expect(await p).toBeCloseTo(15.6, 5);
  });

  it("hiệu chuẩn không bao giờ nhỏ hơn buocMs (đồng hồ giả chạy nhanh hơn bước yêu cầu)", async () => {
    let t = 0;
    let cb: (() => void) | null = null;
    const dep = { now: () => t, setInterval: (f: () => void) => ((cb = f), 1), clearInterval: () => (cb = null) };
    const p = hieuChuanChuKy(dep, 5, 10);
    for (let i = 0; i < 10; i++) {
      t += 2;
      cb?.();
    }
    expect(await p).toBe(5);
  });

  it("bản thật: hiệu chuẩn trả chu kỳ trong khoảng hợp lý và dung() chạy được (không khẳng định mức nới — đồng hồ thật + tải)", async () => {
    const lag = batDauDoLag();
    await new Promise((r) => setTimeout(r, 120));
    const noi = await lag.dung(Infinity);
    expect(Number.isFinite(noi)).toBe(true);
    expect(noi).toBeGreaterThanOrEqual(0);
  });
});
