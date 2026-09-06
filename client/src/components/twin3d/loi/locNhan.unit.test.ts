/**
 * locNhan.unit.test.ts — sàng cho bộ lọc nhãn.
 *
 * ⚠ TÊN TỆP phải là `*.unit.test.ts`. `vitest.config.ts` chỉ include
 * `client/src/**./*.unit.test.ts`; đặt tên `.test.ts` thì test KHÔNG ĐƯỢC THU
 * THẬP mà cổng VẪN BÁO XANH — một suite 0 test cũng xanh.
 *
 * Sàng này phải KÊU khi: đổi trần 30, đổi thứ tự ưu tiên, bỏ khử chồng lấp, hoặc
 * làm kết quả phụ thuộc thứ tự đầu vào.
 */

import { describe, it, expect } from "vitest";
import {
  locNhan,
  diemUuTienNhan,
  TRAN_NHAN_DOM,
  BAN_KINH_VA_CHAM_PX,
  type NhanUngVien,
} from "./locNhan";

/** Sinh N nhãn RỜI NHAU (cách xa hơn bán kính va chạm) để cô lập luật trần. */
function nhanRoiNhau(n: number, tuy: Partial<NhanUngVien> = {}): NhanUngVien[] {
  const buoc = BAN_KINH_VA_CHAM_PX * 3;
  return Array.from({ length: n }, (_, i) => ({
    khoa: `may:${String(i).padStart(3, "0")}`,
    x: (i % 20) * buoc,
    y: Math.floor(i / 20) * buoc,
    khoangCachMet: 10 + i,
    ...tuy,
  }));
}

describe("diemUuTienNhan — thứ tự ưu tiên là HẠNG, không phải điểm cộng dồn", () => {
  it("máy đang chọn ở RẤT XA vẫn thắng máy bình thường ngay trước mũi camera", () => {
    const chonXa: NhanUngVien = { khoa: "a", x: 0, y: 0, khoangCachMet: 9999, dangChon: true };
    const thuongGan: NhanUngVien = { khoa: "b", x: 0, y: 0, khoangCachMet: 0.001 };
    expect(diemUuTienNhan(chonXa)).toBeGreaterThan(diemUuTienNhan(thuongGan));
  });

  it("bất thường thắng hover, hover thắng chỉ-gần-camera", () => {
    const batThuong: NhanUngVien = { khoa: "a", x: 0, y: 0, khoangCachMet: 500, batThuong: true };
    const hover: NhanUngVien = { khoa: "b", x: 0, y: 0, khoangCachMet: 1, hover: true };
    const thuong: NhanUngVien = { khoa: "c", x: 0, y: 0, khoangCachMet: 1 };
    expect(diemUuTienNhan(batThuong)).toBeGreaterThan(diemUuTienNhan(hover));
    expect(diemUuTienNhan(hover)).toBeGreaterThan(diemUuTienNhan(thuong));
  });

  it("đang chọn thắng đang bất thường (luật '>' của brief)", () => {
    const chon: NhanUngVien = { khoa: "a", x: 0, y: 0, khoangCachMet: 50, dangChon: true };
    const loi: NhanUngVien = { khoa: "b", x: 0, y: 0, khoangCachMet: 50, batThuong: true };
    expect(diemUuTienNhan(chon)).toBeGreaterThan(diemUuTienNhan(loi));
  });

  it("cùng hạng thì gần camera hơn được điểm cao hơn", () => {
    const gan: NhanUngVien = { khoa: "a", x: 0, y: 0, khoangCachMet: 5 };
    const xa: NhanUngVien = { khoa: "b", x: 0, y: 0, khoangCachMet: 50 };
    expect(diemUuTienNhan(gan)).toBeGreaterThan(diemUuTienNhan(xa));
  });

  it("khoảng cách vô hạn / NaN không làm điểm thành NaN", () => {
    expect(Number.isFinite(diemUuTienNhan({ khoa: "a", x: 0, y: 0, khoangCachMet: Infinity }))).toBe(true);
    expect(Number.isFinite(diemUuTienNhan({ khoa: "a", x: 0, y: 0, khoangCachMet: NaN }))).toBe(true);
  });
});

describe("locNhan — TRẦN CỨNG 30 nhãn DOM (§4)", () => {
  it("trần mặc định đúng bằng 30", () => {
    expect(TRAN_NHAN_DOM).toBe(30);
  });

  it("100 nhãn rời nhau → vẽ đúng 30, phần dư đếm vào soVuotTran", () => {
    const kq = locNhan(nhanRoiNhau(100));
    expect(kq.ve.length).toBe(30);
    expect(kq.tongUngVien).toBe(100);
    expect(kq.soVuotTran).toBe(70);
    expect(kq.ve.length + kq.soVuotTran + kq.soBiChongLap + kq.soNgoaiKhung).toBe(100);
  });

  it("300 nhãn (con số đã đo là 'laggy') vẫn KHÔNG bao giờ vượt 30", () => {
    expect(locNhan(nhanRoiNhau(300)).ve.length).toBeLessThanOrEqual(30);
  });

  it("dưới trần thì vẽ hết, không cắt oan", () => {
    const kq = locNhan(nhanRoiNhau(7));
    expect(kq.ve.length).toBe(7);
    expect(kq.soVuotTran).toBe(0);
  });

  it("trần tuỳ chỉnh được tôn trọng", () => {
    expect(locNhan(nhanRoiNhau(50), { tranNhan: 5 }).ve.length).toBe(5);
  });

  it("trần 0 → không vẽ nhãn nào", () => {
    expect(locNhan(nhanRoiNhau(50), { tranNhan: 0 }).ve.length).toBe(0);
  });
});

describe("locNhan — cull ngoài khung nhìn", () => {
  it("nhãn ngoài khung bị loại NGAY, không tốn suất trong trần", () => {
    const ds: NhanUngVien[] = [
      ...nhanRoiNhau(40).map((n) => ({ ...n, ngoaiKhung: true })),
      ...nhanRoiNhau(5).map((n) => ({ ...n, khoa: `trong:${n.khoa}` })),
    ];
    const kq = locNhan(ds);
    expect(kq.soNgoaiKhung).toBe(40);
    expect(kq.ve.length).toBe(5);
    expect(kq.ve.every((v) => v.khoa.startsWith("trong:"))).toBe(true);
  });
});

describe("locNhan — khử chồng lấp CHẠY TRƯỚC cắt trần", () => {
  it("50 nhãn chồng đúng một chỗ → chỉ 1 sống sót", () => {
    const chong: NhanUngVien[] = Array.from({ length: 50 }, (_, i) => ({
      khoa: `c:${i}`,
      x: 100,
      y: 100,
      khoangCachMet: 10 + i,
    }));
    const kq = locNhan(chong);
    expect(kq.ve.length).toBe(1);
    expect(kq.soBiChongLap).toBe(49);
  });

  it("★ suất bị chồng lấp ăn KHÔNG được tính vào trần: 20 cụm chồng + 25 rời → 25 rời vẫn vẽ", () => {
    // Nếu ai đó đảo thứ tự (cắt 30 trước, khử chồng sau), 20 nhãn chồng nhau sẽ
    // chiếm 20/30 suất và chỉ 10 nhãn rời được vẽ. Test này KÊU đúng lỗi đó.
    const cum: NhanUngVien[] = Array.from({ length: 20 }, (_, i) => ({
      khoa: `cum:${i}`,
      x: 5000,
      y: 5000,
      khoangCachMet: 1, // rất gần → ưu tiên cao, được xét trước
    }));
    const roi = nhanRoiNhau(25).map((n) => ({ ...n, khoangCachMet: 100 + n.khoangCachMet }));
    const kq = locNhan([...cum, ...roi]);
    expect(kq.ve.length).toBe(26); // 1 sống sót của cụm + 25 rời
    expect(kq.soBiChongLap).toBe(19);
    expect(kq.soVuotTran).toBe(0);
  });

  it("★ CHẨN ĐOÁN đúng lý do loại khi cả hai luật cùng áp: 30 rời + 1 chồng + 1 dư", () => {
    // Sàng mật độ bắt được: đảo thứ tự hai nhánh `if` trong vòng lặp KHÔNG đổi
    // tập nhãn được vẽ (nhãn chồng lấp không lọt vào cả hai đường), nhưng ĐỔI
    // LÝ DO ghi vào bộ đếm — và bộ đếm chính là thứ chảy ra `window.__demNhan`
    // để e2e đọc. Một bộ đếm sai lý do làm phép chẩn đoán "vì sao nhãn biến mất"
    // trỏ nhầm chỗ, nên nó đáng được ghim y như tập nhãn.
    const roi = nhanRoiNhau(30).map((n) => ({ ...n, khoangCachMet: 1 + n.khoangCachMet * 0.001 }));
    // Đè LÊN nhãn rời đầu tiên (toạ độ 0,0), ưu tiên thấp hơn → phải tính là CHỒNG LẤP.
    const chong: NhanUngVien = { khoa: "z-chong", x: 3, y: 3, khoangCachMet: 900 };
    // Ở chỗ trống nhưng đã hết suất → phải tính là VƯỢT TRẦN.
    const du: NhanUngVien = { khoa: "z-du", x: 9000, y: 9000, khoangCachMet: 901 };

    const kq = locNhan([...roi, chong, du]);
    expect(kq.ve.length).toBe(30);
    expect(kq.soBiChongLap).toBe(1);
    expect(kq.soVuotTran).toBe(1);
    expect(kq.ve.map((v) => v.khoa)).not.toContain("z-chong");
    expect(kq.ve.map((v) => v.khoa)).not.toContain("z-du");
  });

  it("nhãn cách nhau vừa đúng bán kính KHÔNG bị coi là chồng", () => {
    const kq = locNhan([
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1 },
      { khoa: "b", x: BAN_KINH_VA_CHAM_PX, y: 0, khoangCachMet: 2 },
    ]);
    expect(kq.ve.length).toBe(2);
  });

  it("bán kính va chạm tuỳ chỉnh được", () => {
    const ds: NhanUngVien[] = [
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1 },
      { khoa: "b", x: 100, y: 0, khoangCachMet: 2 },
    ];
    expect(locNhan(ds, { banKinhVaChamPx: 10 }).ve.length).toBe(2);
    expect(locNhan(ds, { banKinhVaChamPx: 200 }).ve.length).toBe(1);
  });

  it("khi chồng nhau, cái ƯU TIÊN CAO HƠN sống sót — không phải cái đến trước", () => {
    const kq = locNhan([
      { khoa: "thuong", x: 10, y: 10, khoangCachMet: 1 },
      { khoa: "loi", x: 12, y: 12, khoangCachMet: 900, batThuong: true },
    ]);
    expect(kq.ve.map((v) => v.khoa)).toEqual(["loi"]);
  });
});

describe("locNhan — TẤT ĐỊNH", () => {
  it("đảo ngược thứ tự đầu vào cho ra CÙNG tập nhãn, CÙNG thứ tự", () => {
    const ds = nhanRoiNhau(60);
    const xuoi = locNhan(ds).ve.map((v) => v.khoa);
    const nguoc = locNhan([...ds].reverse()).ve.map((v) => v.khoa);
    expect(nguoc).toEqual(xuoi);
  });

  it("hai nhãn hoà điểm tuyệt đối → phá hoà bằng khoá, ổn định giữa hai lần gọi", () => {
    const a: NhanUngVien = { khoa: "may:002", x: 0, y: 0, khoangCachMet: 12 };
    const b: NhanUngVien = { khoa: "may:001", x: 500, y: 500, khoangCachMet: 12 };
    expect(locNhan([a, b]).ve.map((v) => v.khoa)).toEqual(["may:001", "may:002"]);
    expect(locNhan([b, a]).ve.map((v) => v.khoa)).toEqual(["may:001", "may:002"]);
  });

  it("không làm biến dạng mảng đầu vào của người gọi", () => {
    const ds = nhanRoiNhau(10);
    const truoc = ds.map((n) => n.khoa);
    locNhan(ds);
    expect(ds.map((n) => n.khoa)).toEqual(truoc);
  });

  it("kết quả sắp theo ưu tiên GIẢM DẦN", () => {
    const kq = locNhan(nhanRoiNhau(20));
    for (let i = 1; i < kq.ve.length; i++) {
      expect(kq.ve[i - 1].diemUuTien).toBeGreaterThanOrEqual(kq.ve[i].diemUuTien);
    }
  });

  it("danh sách rỗng → kết quả rỗng, không ném", () => {
    const kq = locNhan([]);
    expect(kq.ve).toEqual([]);
    expect(kq.tongUngVien).toBe(0);
  });
});

describe("locNhan — NT-2 luật 1: alarm không bao giờ bị góc camera che", () => {
  it("35 máy bình thường ở gần + 1 máy lỗi ở xa → máy lỗi VẪN nằm trong 30 nhãn", () => {
    const thuong = nhanRoiNhau(35).map((n) => ({ ...n, khoangCachMet: 1 + n.khoangCachMet * 0.001 }));
    const loi: NhanUngVien = {
      khoa: "may:LOI",
      x: 5000,
      y: 5000,
      khoangCachMet: 800,
      batThuong: true,
    };
    const kq = locNhan([...thuong, loi]);
    expect(kq.ve.length).toBe(30);
    expect(kq.ve.map((v) => v.khoa)).toContain("may:LOI");
    expect(kq.ve[0].khoa).toBe("may:LOI"); // và nó đứng ĐẦU
  });
});
