/**
 * onDinhTheoGiaTri.unit.test.ts — Đợt 38: khoá giá trị phải NHẠY với mọi trường và BỀN với tham chiếu mới cùng nội dung.
 * Kết cục người dùng (khung vẽ khi đứng yên) đo sống ở `.qa-dot38/do.mjs` p1 — lưới này chỉ ghim phép khoá.
 */
import { describe, it, expect } from "vitest";
import { khoaBanDo, khoaMayVanHanh } from "./onDinhTheoGiaTri";
import type { MayVanHanh } from "./trungThucDuLieu";

const may = (id: number, tuy: Partial<MayVanHanh> = {}): MayVanHanh => ({
  id,
  ma: `M${id}`,
  ten: `Máy ${id}`,
  loaiMay: "AOI",
  trangThaiBaoCao: "idle",
  thoiDiemDuLieu: 1_700_000_000_000,
  isActive: true,
  stationId: 10 + id,
  lineId: 2,
  ...tuy,
});

describe("khoaMayVanHanh — bền với tham chiếu, nhạy với MỌI trường", () => {
  it("★★★ hai mảng MỚI cùng nội dung ⇒ cùng khoá (đây là lý do tệp này tồn tại)", () => {
    expect(khoaMayVanHanh([may(1), may(2)])).toBe(khoaMayVanHanh([may(1), may(2)]));
  });
  it("★★★ đổi BẤT KỲ trường nào ⇒ khoá đổi (không có trường nào bị bỏ ngoài phép so)", () => {
    const goc = khoaMayVanHanh([may(1)]);
    const bien: Array<Partial<MayVanHanh>> = [
      { ma: "X" }, { ten: "Y" }, { loaiMay: "SPI" }, { trangThaiBaoCao: "running" }, { trangThaiBaoCao: null },
      { thoiDiemDuLieu: 1 }, { thoiDiemDuLieu: null }, { isActive: false }, { stationId: null }, { lineId: 3 },
    ];
    for (const b of bien) expect(khoaMayVanHanh([may(1, b)]), JSON.stringify(b)).not.toBe(goc);
  });
  it("thứ tự và số phần tử là một phần của giá trị", () => {
    expect(khoaMayVanHanh([may(1), may(2)])).not.toBe(khoaMayVanHanh([may(2), may(1)]));
    expect(khoaMayVanHanh([may(1)])).not.toBe(khoaMayVanHanh([may(1), may(2)]));
    expect(khoaMayVanHanh([])).toBe(khoaMayVanHanh([]));
  });
});

describe("khoaBanDo — bản đồ id → chuỗi", () => {
  it("cùng nội dung ⇒ cùng khoá; đổi một giá trị / thêm một khoá ⇒ khoá đổi", () => {
    const a = new Map([[1, "idle"], [2, "khong_ro"]]);
    const b = new Map([[1, "idle"], [2, "khong_ro"]]);
    expect(khoaBanDo(a)).toBe(khoaBanDo(b));
    expect(khoaBanDo(new Map([[1, "idle"], [2, "running"]]))).not.toBe(khoaBanDo(a));
    expect(khoaBanDo(new Map([[1, "idle"]]))).not.toBe(khoaBanDo(a));
    expect(khoaBanDo(new Map())).toBe("");
  });
  it("không nhập nhằng giữa `1:ab;` và `1:a;b` — dấu ngăn cách là một phần của mã hoá", () => {
    expect(khoaBanDo(new Map([[1, "a:b"]]))).not.toBe(khoaBanDo(new Map([[1, "a"], [2, "b"]])));
  });
});
