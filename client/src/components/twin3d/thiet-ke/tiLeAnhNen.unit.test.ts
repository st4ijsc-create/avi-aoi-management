/**
 * tiLeAnhNen.unit.test.ts — công cụ "Đặt tỉ lệ" cho ảnh nền CAD (#43, §7.4).
 *
 * ★ G5/G32 — mọi ca dùng số THẬT, và ca then chốt hỏi "đầu ra có KHÁC đầu vào
 *   không": đổi khoảng cách thật phải đổi tỉ lệ, và hai cặp điểm khác nhau trên
 *   cùng một ảnh phải cho hai tỉ lệ khác nhau.
 */
import { describe, expect, it } from "vitest";

import {
  KHOANG_CACH_TOI_THIEU_PX,
  NGUONG_LECH_SAN,
  TI_LE_TOI_DA_MM_MOI_PX,
  doiChieuVoiSan,
  khoangCachPx,
  kichThuocAnhMm,
  laAnhNenHopLe,
  tinhTiLe,
} from "./tiLeAnhNen";

describe("tinhTiLe — phép chia có xuất xứ", () => {
  it("★ ca thật: 400 px = 12.000 mm ⇒ 30 mm/px", () => {
    const kq = tinhTiLe({ x: 100, y: 100 }, { x: 500, y: 100 }, 12_000);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.ketQua.mmMoiPx).toBe(30);
    expect(kq.ketQua.khoangCachPx).toBe(400);
  });

  it("hai điểm CHÉO — dùng khoảng cách Euclid, không phải hiệu toạ độ", () => {
    // 3-4-5: (0,0)→(300,400) là 500 px, không phải 300 và cũng không phải 700.
    const kq = tinhTiLe({ x: 0, y: 0 }, { x: 300, y: 400 }, 5_000);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.ketQua.khoangCachPx).toBe(500);
    expect(kq.ketQua.mmMoiPx).toBe(10);
  });

  it("★★★ ĐỔI KHOẢNG CÁCH THẬT ⇒ ĐỔI TỈ LỆ (đối chứng G5)", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 0 };
    const mot = tinhTiLe(a, b, 12_000);
    const hai = tinhTiLe(a, b, 24_000);
    expect(mot.ok && hai.ok).toBe(true);
    if (!mot.ok || !hai.ok) return;
    expect(hai.ketQua.mmMoiPx).toBe(mot.ketQua.mmMoiPx * 2);
    expect(hai.ketQua.mmMoiPx).not.toBe(mot.ketQua.mmMoiPx);
  });

  it("thiếu điểm ⇒ lỗi RIÊNG, không phải 0", () => {
    expect(tinhTiLe(null, { x: 1, y: 1 }, 1000)).toEqual({ ok: false, loi: "thieu_diem" });
    expect(tinhTiLe({ x: 1, y: 1 }, null, 1000)).toEqual({ ok: false, loi: "thieu_diem" });
  });

  it("★★★ HAI ĐIỂM QUÁ GẦN BỊ CHẶN — 3 px khai 12 m là 4.000 mm/px", () => {
    // Không có sàn này thì phép chia vẫn chạy, không gì nổ, và sai số một pixel
    // của cú click đổi kết quả tới 33 %.
    const kq = tinhTiLe({ x: 100, y: 100 }, { x: 103, y: 100 }, 12_000);
    expect(kq).toEqual({ ok: false, loi: "hai_diem_qua_gan" });
  });

  it("★ RANH GIỚI sàn 20 px — đúng ngưỡng thì QUA, dưới một pixel thì chặn", () => {
    const a = { x: 0, y: 0 };
    expect(tinhTiLe(a, { x: KHOANG_CACH_TOI_THIEU_PX, y: 0 }, 1_000).ok).toBe(true);
    expect(tinhTiLe(a, { x: KHOANG_CACH_TOI_THIEU_PX - 1, y: 0 }, 1_000).ok).toBe(false);
  });

  it("khoảng cách thật <= 0 hoặc không hữu hạn ⇒ lỗi riêng", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 0 };
    for (const xau of [0, -5, NaN, Infinity]) {
      expect(tinhTiLe(a, b, xau)).toEqual({
        ok: false,
        loi: "khoang_cach_that_khong_hop_le",
      });
    }
  });

  it("tỉ lệ vô lý (gõ nhầm đơn vị) bị chặn", () => {
    // 25 px khai 1.000 km = 10^9 mm ⇒ 4×10^7 mm/px.
    const kq = tinhTiLe({ x: 0, y: 0 }, { x: 25, y: 0 }, 1_000_000_000);
    expect(kq).toEqual({ ok: false, loi: "ti_le_vo_ly" });
    // Ngay dưới trần thì vẫn qua — chỉ báo phải biết cả hai chiều.
    const sat = tinhTiLe({ x: 0, y: 0 }, { x: 100, y: 0 }, TI_LE_TOI_DA_MM_MOI_PX * 100);
    expect(sat.ok).toBe(true);
  });

  it("khoangCachPx — hàm phụ đo đúng, và KHÁC 0 trên đầu vào thật", () => {
    expect(khoangCachPx({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(khoangCachPx({ x: 7, y: 7 }, { x: 7, y: 7 })).toBe(0);
  });
});

describe("kichThuocAnhMm — quy ảnh ra mét để đối chiếu", () => {
  it("1600×900 px @ 30 mm/px ⇒ 48 m × 27 m", () => {
    expect(kichThuocAnhMm(1600, 900, 30)).toEqual({ rongMm: 48_000, caoMm: 27_000 });
  });

  it("đầu vào <= 0 hoặc không hữu hạn ⇒ null, KHÔNG phải 0", () => {
    expect(kichThuocAnhMm(0, 900, 30)).toBeNull();
    expect(kichThuocAnhMm(1600, 900, 0)).toBeNull();
    expect(kichThuocAnhMm(NaN, 900, 30)).toBeNull();
  });
});

describe("doiChieuVoiSan — ảnh nền và nhà xưởng phải nói cùng một con số", () => {
  it("★★★ ảnh 240 m / sàn 84 m ⇒ VƯỢT ngưỡng, phải hỏi TRƯỚC khi đặt máy", () => {
    const kq = doiChieuVoiSan(240_000, 84_000);
    expect(kq?.vuotNguong).toBe(true);
    expect(kq?.lech).toBeCloseTo(1.857, 2);
  });

  it("lệch 10 % ⇒ KHÔNG vượt ngưỡng 20 %", () => {
    const kq = doiChieuVoiSan(92_400, 84_000);
    expect(kq?.vuotNguong).toBe(false);
    expect(kq?.lech).toBeCloseTo(0.1, 5);
  });

  it("★ MẪU SỐ LÀ SỐ SÀN — đảo hai đối số cho tỉ lệ KHÁC", () => {
    const xuoi = doiChieuVoiSan(120_000, 84_000)!;
    const nguoc = doiChieuVoiSan(84_000, 120_000)!;
    expect(xuoi.lech).not.toBeCloseTo(nguoc.lech, 4);
  });

  it("ngưỡng truyền vào ĐỔI được kết luận (chỉ báo biết kêu)", () => {
    expect(doiChieuVoiSan(92_400, 84_000, NGUONG_LECH_SAN)!.vuotNguong).toBe(false);
    expect(doiChieuVoiSan(92_400, 84_000, 0.05)!.vuotNguong).toBe(true);
  });

  it("sàn chưa khai (0) ⇒ null, không phải 'lệch vô hạn'", () => {
    expect(doiChieuVoiSan(48_000, 0)).toBeNull();
  });
});

describe("laAnhNenHopLe — khớp MIME mà `taiAnhNen` chấp nhận", () => {
  it("nhận png/jpg/jpeg/webp, không phân biệt hoa thường", () => {
    for (const n of ["mat-bang.png", "MAT-BANG.JPG", "a.jpeg", "b.webp"]) {
      expect(laAnhNenHopLe(n)).toBe(true);
    }
  });

  it("★ từ chối .dwg/.pdf/.svg — chúng KHÔNG đi qua `taiAnhNen`", () => {
    for (const n of ["ban-ve.dwg", "ban-ve.pdf", "so-do.svg", "khongcoduoi"]) {
      expect(laAnhNenHopLe(n)).toBe(false);
    }
  });
});
