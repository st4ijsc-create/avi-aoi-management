/**
 * catCanh.unit.test.ts — MẶT PHẲNG CẮT CỦA CAMERA (PH-50b).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ TỆP NÀY — MỘT CON SỐ "THÍCH ỨNG" MÀ KHÔNG AI ĐO ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * `CanhVanHanh` khai `far={Math.max(2000, banKinh * 24)}` từ Đợt 8 — đọc như một
 * `far` thích ứng theo cỡ cảnh. Đo SỐNG (`.qa-tapdoan/p50b-far-t2.json`, đọc
 * `camera.far` thật qua `useThree`, không suy từ px) ở 5 vai QATD:
 *
 *   | vai            | prop yêu cầu | `camera.far` THẬT |
 *   |----------------|--------------|-------------------|
 *   | qatd_admin     | 25.449,6     | **2000**          |
 *   | qatd_giamdoc   | 16.156,8     | **2000**          |
 *   | qatd_kythuat   | 16.156,8     | **2000**          |
 *   | qatd_quanly    |  6.864,0     | **2000**          |
 *   | qatd_congnhan  |  6.864,0     | **2000**          |
 *
 * Tức con số "thích ứng" chưa bao giờ tới được camera: R3F 9.5 chỉ áp cấu hình
 * `camera` LÚC TẠO. Hệ quả người dùng: cuộn ra xa là **mất toà nhà**, và khởi
 * phát bám theo `camXa ≈ 2000` chứ không theo cỡ cảnh.
 *
 * Tệp này ghim PHÉP TÍNH (thuần) — `catCanhDongBo.dom.test.tsx` ghim phép ÁP.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ `far` PHẢI SUY TỪ THỨ QUYẾT ĐỊNH NÓ, KHÔNG PHẢI TỪ MỘT HỆ SỐ ĐẸP
 * ════════════════════════════════════════════════════════════════════════════
 * `24` là một con số không ai giải thích được. Thứ thật sự quyết định `far` là
 * **camera lùi được xa tới đâu** — và đó là `maxDistance` của OrbitControls, do
 * chính `CanhVanHanh` đặt (`Math.max(80, banKinh * 8)`). Hai số ấy nằm hai tệp và
 * trôi khỏi nhau được mà không lưới nào kêu. Ở đây chúng dùng CHUNG một hằng.
 *
 * ★ `far` quá tay KHÔNG miễn phí: §7.2 cảnh báo z-fighting khi `far/near` lớn.
 *   Nên lưới dưới đây đo CẢ HAI chiều — đủ xa để không cắt, đủ gần để còn độ
 *   chính xác z — và `near` có TRẦN để không bao giờ cắt mất vật ở gần.
 */
import { describe, expect, it } from "vitest";

import {
  FAR_TOI_THIEU_M,
  HE_SO_DEM_FAR,
  HE_SO_ZOOM_XA_NHAT,
  KHOANG_CACH_ZOOM_XA_NHAT_TOI_THIEU_M,
  NEAR_TOI_DA_M,
  NEAR_TOI_THIEU_M,
  TRAN_TI_LE_FAR_TREN_NEAR,
  catCanhTheoBanKinh,
  farTheoBanKinh,
  khoangCachZoomXaNhat,
  nearTheoFar,
} from "./catCanh";

/** Bán kính cảnh ĐO ĐƯỢC ở 5 vai QATD (m) — suy từ `far` prop chia 24, đối chiếu sa bàn. */
const BAN_KINH_QATD = {
  admin: 1060.4,
  giamdoc: 673.2,
  kythuat: 673.2,
  quanly: 286,
  congnhan: 286,
} as const;

/** Nửa đường chéo mặt sàn tính từ mục ngắm: sàn `rong × sau`, cả hai ≤ `banKinh`. */
const nuaDuongCheo = (banKinh: number) => banKinh * Math.SQRT2;

describe("khoangCachZoomXaNhat — DÙNG CHUNG với `maxDistance` của OrbitControls", () => {
  it("cảnh lớn: tỉ lệ theo bán kính", () => {
    expect(khoangCachZoomXaNhat(1000)).toBe(1000 * HE_SO_ZOOM_XA_NHAT);
  });
  it("cảnh nhỏ: có sàn, không cho zoom-out cụt", () => {
    expect(khoangCachZoomXaNhat(1)).toBe(KHOANG_CACH_ZOOM_XA_NHAT_TOI_THIEU_M);
    expect(khoangCachZoomXaNhat(10)).toBe(KHOANG_CACH_ZOOM_XA_NHAT_TOI_THIEU_M);
  });
});

describe("★★★ farTheoBanKinh — BẤT BIẾN: KHÔNG CẮT Ở BẤT KỲ ĐÂU NGƯỜI DÙNG LÙI TỚI ĐƯỢC", () => {
  /*
   * Đây là bất biến THẬT, không phải một con số chép lại: ở khoảng cách lùi xa
   * nhất mà OrbitControls cho phép, điểm xa nhất của sàn vẫn phải nằm trong `far`.
   */
  const DAI = [10, 25, 60, 120, 169, 171, 286, 400, 673.2, 1060.4, 2250, 5000];
  it.each(DAI)("banKinh=%s m — far ≥ (lùi xa nhất + nửa đường chéo)", (b) => {
    expect(farTheoBanKinh(b)).toBeGreaterThanOrEqual(khoangCachZoomXaNhat(b) + nuaDuongCheo(b));
  });

  it("★ ĐỐI CHỨNG DƯƠNG — bất biến trên BIẾT KÊU: `far` cũ hằng 2000 thì 5/5 vai QATD trượt", () => {
    const truot = Object.values(BAN_KINH_QATD).filter(
      (b) => 2000 < khoangCachZoomXaNhat(b) + nuaDuongCheo(b),
    );
    /*
     * CẢ NĂM, kể cả vai nhỏ nhất: banKinh 286 m ⇒ lùi xa nhất 2288 m, đã vượt 2000
     * TRƯỚC KHI cộng đường chéo. Đây đúng là điều đo sống thấy — `qatd_quanly` mất
     * sạch cảnh dù sa bàn chỉ 286 m, chuyện BẤT KHẢ nếu `far` thật sự thích ứng.
     */
    expect(truot).toHaveLength(5);
  });

  it("★ ĐỐI CHỨNG DƯƠNG — bất biến bắt luôn công thức `banKinh * 8` (thiếu đường chéo)", () => {
    const thieu = Object.values(BAN_KINH_QATD).filter(
      (b) => b * 8 < khoangCachZoomXaNhat(b) + nuaDuongCheo(b),
    );
    expect(thieu).toHaveLength(5);
  });

  it("KHÔNG quá tay — far ≤ 1,5 lần mức tối thiểu cần (mỗi mét thừa là z-buffer mất)", () => {
    for (const b of DAI) {
      const canToiThieu = khoangCachZoomXaNhat(b) + nuaDuongCheo(b);
      if (farTheoBanKinh(b) === FAR_TOI_THIEU_M) continue; // vùng sàn, xét riêng ở dưới
      expect(farTheoBanKinh(b)).toBeLessThanOrEqual(canToiThieu * 1.5);
    }
  });

  it("★★★ far cũ `banKinh * 24` là 2,5 lần mức cần — nay còn 1,25", () => {
    const b = BAN_KINH_QATD.admin;
    const can = khoangCachZoomXaNhat(b) + nuaDuongCheo(b);
    expect(Math.round(((b * 24) / can) * 100) / 100).toBe(2.55);
    expect(Math.round((farTheoBanKinh(b) / can) * 100) / 100).toBe(HE_SO_DEM_FAR);
  });

  it("đơn điệu không giảm theo bán kính", () => {
    for (let i = 1; i < DAI.length; i += 1) {
      expect(farTheoBanKinh(DAI[i])).toBeGreaterThanOrEqual(farTheoBanKinh(DAI[i - 1]));
    }
  });

  it("có sàn 2000 m cho cảnh nhỏ (màn Máy/Line/Tầng) — GIỮ NGUYÊN số của hôm nay", () => {
    expect(farTheoBanKinh(10)).toBe(FAR_TOI_THIEU_M);
    expect(farTheoBanKinh(100)).toBe(FAR_TOI_THIEU_M);
    expect(farTheoBanKinh(169)).toBe(FAR_TOI_THIEU_M);
    // 169,96 m là ngưỡng đúng: (8b + √2·b)·1,25 = 2000 ⟺ b = 169,955…
    expect(farTheoBanKinh(171)).toBeGreaterThan(FAR_TOI_THIEU_M);
  });
});

describe("★★★ nearTheoFar — NỚI `far` KHÔNG ĐƯỢC ĂN HẾT ĐỘ CHÍNH XÁC Z", () => {
  it("cảnh nhỏ (far = sàn 2000) — `near` ĐÚNG BẰNG 0,1 như hôm nay, tỉ lệ 20.000", () => {
    expect(nearTheoFar(FAR_TOI_THIEU_M)).toBe(NEAR_TOI_THIEU_M);
    expect(FAR_TOI_THIEU_M / nearTheoFar(FAR_TOI_THIEU_M)).toBeCloseTo(TRAN_TI_LE_FAR_TREN_NEAR, 6);
  });

  it("★ `near` có TRẦN — không bao giờ cắt mất vật ở gần dù `far` lớn cỡ nào", () => {
    for (const far of [2000, 8000, 12_000, 26_000, 54_000, 1_000_000]) {
      expect(nearTheoFar(far)).toBeLessThanOrEqual(NEAR_TOI_DA_M);
      expect(nearTheoFar(far)).toBeGreaterThanOrEqual(NEAR_TOI_THIEU_M);
    }
  });

  it("★★★ TRẦN `near` = 1/3 khoảng cách zoom-in tối thiểu (1,5 m) — còn 3 lần đệm", () => {
    // `CanhVanHanh` đặt `khoangCachToiThieu: 1.5`. `near` phải nhỏ hơn hẳn số ấy,
    // nếu không người dùng zoom sát sẽ thấy vật bị CẮT ĐÔI — một hồi quy do chính
    // bản vá `far` sinh ra nếu `near` thả nổi theo `far`.
    expect(NEAR_TOI_DA_M * 3).toBeLessThanOrEqual(1.5);
  });

  it("giữa hai trần: `near` tỉ lệ với `far`, tỉ lệ far/near đứng yên ở 20.000", () => {
    for (const far of [3000, 6000, 9000, 10_000]) {
      expect(far / nearTheoFar(far)).toBeCloseTo(TRAN_TI_LE_FAR_TREN_NEAR, 6);
    }
  });

  it("★ ĐỐI CHỨNG DƯƠNG — nếu `near` KHÔNG theo `far` thì tỉ lệ vọt lên 5 lần", () => {
    const farAdmin = farTheoBanKinh(BAN_KINH_QATD.admin);
    expect(Math.round(farAdmin / NEAR_TOI_THIEU_M)).toBeGreaterThan(100_000);
    expect(Math.round(farAdmin / nearTheoFar(farAdmin))).toBeLessThan(30_000);
  });
});

describe("catCanhTheoBanKinh — một lời gọi, hai số đi cùng nhau", () => {
  it.each(Object.entries(BAN_KINH_QATD))("%s", (_vai, b) => {
    const c = catCanhTheoBanKinh(b);
    expect(c.far).toBe(farTheoBanKinh(b));
    expect(c.near).toBe(nearTheoFar(c.far));
    expect(c.near).toBeGreaterThan(0);
    expect(c.far).toBeGreaterThan(c.near);
  });

  it("★ 4 vai QATD: bảng số CHỐT, để ai đổi hệ số cũng phải đổi ở đây và nhìn thấy", () => {
    const lam1 = (n: number) => Math.round(n * 10) / 10;
    expect(lam1(catCanhTheoBanKinh(BAN_KINH_QATD.admin).far)).toBe(12_478.5);
    expect(lam1(catCanhTheoBanKinh(BAN_KINH_QATD.giamdoc).far)).toBe(7922.1);
    expect(lam1(catCanhTheoBanKinh(BAN_KINH_QATD.quanly).far)).toBe(3365.6);
    expect(catCanhTheoBanKinh(BAN_KINH_QATD.admin).near).toBe(NEAR_TOI_DA_M);
    expect(lam1(catCanhTheoBanKinh(BAN_KINH_QATD.giamdoc).near)).toBe(0.4);
    expect(lam1(catCanhTheoBanKinh(BAN_KINH_QATD.quanly).near)).toBe(0.2);
  });

  it("★★★ CẢNH NHỎ KHÔNG ĐỔI MỘT BYTE — far 2000 / near 0,1 y như trước bản vá", () => {
    for (const b of [10, 40, 80, 120, 169]) {
      expect(catCanhTheoBanKinh(b)).toEqual({ near: 0.1, far: 2000 });
    }
  });
});
