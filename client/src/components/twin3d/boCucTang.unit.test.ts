/**
 * boCucTang.unit.test.ts — Test cho con đường B (§10A.2).
 *
 * ★★★ TÊN TỆP: `.unit.test.ts`, KHÔNG phải `.test.ts`. `vitest.config.ts` chỉ
 *   include `client/src/**\/*.unit.test.ts`; đặt sai tên thì file KHÔNG ĐƯỢC THU
 *   THẬP mà cổng vẫn báo XANH — đúng lớp lỗi "glob rỗng ⇒ vitest im lặng, cổng
 *   khai xanh" (bài học VRAM pha 4).
 *
 * Trục kiểm chính, theo thứ tự quan trọng:
 *   1. MÉT vào → MILIMÉT ra, đúng hệ số 1000 và đúng ánh xạ tên cột.
 *   2. Cao độ tự tính = caoDo + caoThongThuy + 300 mm, và SỬA ĐÈ ĐƯỢC.
 *   3. NT-4: giá trị người nhập không bị lần sinh sau đè.
 *   4. Tầng nhỏ hơn toà nhà (tầng lửng) dựng được; tầng TRÀN bị chặn.
 *   5. Sinh đúng 4 tường bao dày 200 mm, không chồng góc, nằm trong chu vi.
 */

import { describe, expect, it } from "vitest";
import {
  apDungCaoDoTuTinh,
  bboxTangScene,
  bboxToaNhaScene,
  caoDoTangKeTiepMm,
  DAY_SAN_MM,
  DAY_TUONG_MM,
  kiemTraNhapLieu,
  sinhTuongBao,
  tangMetSangMm,
  tangNhoHonToaNha,
  tangTranKhoiToaNha,
  toaNhaMetSangMm,
  type TangNhapMet,
  type ToaNhaNhapMet,
} from "./boCucTang";
import { kichThuocBBox } from "./heToaDo";

/** Toà nhà chuẩn của cổng ra Đ3: 84 × 52 × 6 m. */
const TOA_NHA_84: ToaNhaNhapMet = {
  ma: "TN-A",
  ten: "Toà A",
  daiM: 84,
  rongM: 52,
  caoM: 6,
};

const TANG_TRET: TangNhapMet = {
  capSo: 1,
  ten: "Tầng trệt",
  caoThongThuyM: 6,
};

describe("toaNhaMetSangMm — mét vào, milimét ra (§10A.2)", () => {
  it("84 × 52 × 6 m ra đúng 84000 × 52000 × 6000 mm", () => {
    const tn = toaNhaMetSangMm(TOA_NHA_84);
    expect(tn.rongMm).toBe(84000);
    expect(tn.sauMm).toBe(52000);
    expect(tn.caoMm).toBe(6000);
  });

  it("ánh xạ tên: form DÀI vào cột rongMm, form RỘNG vào cột sauMm", () => {
    // Hai cạnh KHÁC NHAU để hoán vị nhầm trục lộ ra ngay, thay vì trốn sau
    // một hình vuông.
    const tn = toaNhaMetSangMm({ ...TOA_NHA_84, daiM: 100, rongM: 30 });
    expect(tn.rongMm).toBe(100_000);
    expect(tn.sauMm).toBe(30_000);
  });

  it("vị trí trong khuôn viên cũng quy đổi, và cao độ toà nhà là 0", () => {
    const tn = toaNhaMetSangMm({ ...TOA_NHA_84, viTriXM: 12.5, viTriYM: -3 });
    expect(tn.viTriXMm).toBe(12_500);
    expect(tn.viTriYMm).toBe(-3000);
    expect(tn.viTriZMm).toBe(0);
  });

  it("số người GÕ mang nguon='tay' — không badge chưa đo (NT-4)", () => {
    expect(toaNhaMetSangMm(TOA_NHA_84).nguon).toBe("tay");
  });

  it("số lẻ giữ đủ độ chính xác mm (7,25 m = 7250 mm)", () => {
    const tn = toaNhaMetSangMm({ ...TOA_NHA_84, caoM: 7.25 });
    expect(tn.caoMm).toBe(7250);
  });
});

describe("bboxToaNhaScene — xem trước bước 3 (mét, Y hướng lên)", () => {
  it("khối 84 × 52 × 6 m đứng TRÊN sàn: đáy y=0, đỉnh y=6", () => {
    const b = bboxToaNhaScene(toaNhaMetSangMm(TOA_NHA_84));
    expect(b.minY).toBe(0);
    expect(b.maxY).toBe(6);
    expect(kichThuocBBox(b)).toEqual({ rong: 84, cao: 6, sau: 52 });
  });

  it("vị trí trong khuôn viên dịch bbox theo trục X và Z scene", () => {
    const b = bboxToaNhaScene(
      toaNhaMetSangMm({ ...TOA_NHA_84, viTriXM: 10, viTriYM: 20 }),
    );
    expect(b.minX).toBe(10);
    expect(b.minZ).toBe(20);
    expect(b.maxX).toBe(94);
    expect(b.maxZ).toBe(72);
  });
});

describe("caoDoTangKeTiepMm — công thức cao độ (§10A.2)", () => {
  it("caoDo + caoThongThuy + 300 mm bề dày sàn", () => {
    expect(caoDoTangKeTiepMm(0, 6000)).toBe(6300);
    expect(caoDoTangKeTiepMm(6300, 4500)).toBe(11_100);
  });

  it("hằng bề dày sàn đúng 300 mm — không phải một số khác", () => {
    expect(DAY_SAN_MM).toBe(300);
    // Đo hằng qua HÀNH VI, không chỉ qua giá trị: nếu ai đổi hằng mà quên đổi
    // công thức (hoặc ngược lại), một trong hai assertion này đỏ.
    expect(caoDoTangKeTiepMm(1000, 2000) - 1000 - 2000).toBe(DAY_SAN_MM);
  });
});

describe("apDungCaoDoTuTinh — tự tính, và SỬA ĐÈ ĐƯỢC (NT-4)", () => {
  const BA_TANG: TangNhapMet[] = [
    { capSo: 1, ten: "Tầng trệt", caoThongThuyM: 6 },
    { capSo: 2, ten: "Tầng 2", caoThongThuyM: 4.5 },
    { capSo: 3, ten: "Tầng 3", caoThongThuyM: 4.5 },
  ];

  it("chuỗi tự tính: 0 → 6300 → 11100 mm", () => {
    expect(apDungCaoDoTuTinh(BA_TANG).map((t) => t.caoDoMm)).toEqual([
      0, 6300, 11_100,
    ]);
  });

  it("mọi cao độ tự tính mang nguon='sinh' ⇒ badge chưa đo", () => {
    expect(apDungCaoDoTuTinh(BA_TANG).every((t) => t.nguon === "sinh")).toBe(true);
  });

  it("★ cao độ người nhập KHÔNG BỊ ĐÈ, và mang nguon='tay'", () => {
    const suaDe = [...BA_TANG];
    suaDe[1] = { ...suaDe[1], caoDoM: 7 }; // người dùng gõ 7 m thay vì 6,3
    const ket = apDungCaoDoTuTinh(suaDe);
    expect(ket[1].caoDoMm).toBe(7000);
    expect(ket[1].nguon).toBe("tay");
  });

  it("★ tầng TRÊN một cao độ đã sửa tay nối từ số THẬT, không từ chuỗi sinh", () => {
    const suaDe = [...BA_TANG];
    suaDe[1] = { ...suaDe[1], caoDoM: 7 };
    const ket = apDungCaoDoTuTinh(suaDe);
    // 7000 + 4500 + 300 = 11800, KHÔNG phải 11100 của chuỗi sinh thuần.
    expect(ket[2].caoDoMm).toBe(11_800);
    expect(ket[2].nguon).toBe("sinh");
  });

  it("danh sách vào lộn xộn vẫn ra đúng thứ tự capSo tăng dần", () => {
    const loray = [BA_TANG[2], BA_TANG[0], BA_TANG[1]];
    expect(apDungCaoDoTuTinh(loray).map((t) => t.capSo)).toEqual([1, 2, 3]);
    expect(apDungCaoDoTuTinh(loray).map((t) => t.caoDoMm)).toEqual([0, 6300, 11_100]);
  });

  it("tầng hầm (capSo âm) là mốc, tầng 1 tính từ nó", () => {
    const coHam: TangNhapMet[] = [
      { capSo: -1, ten: "Hầm", caoThongThuyM: 3, caoDoM: -3.3 },
      { capSo: 1, ten: "Tầng trệt", caoThongThuyM: 6 },
    ];
    const ket = apDungCaoDoTuTinh(coHam);
    expect(ket[0].caoDoMm).toBe(-3300);
    // -3300 + 3000 + 300 = 0 — mặt sàn tầng trệt về đúng cốt 0.
    expect(ket[1].caoDoMm).toBe(0);
  });

  it("danh sách rỗng cho ra mảng rỗng, không ném", () => {
    expect(apDungCaoDoTuTinh([])).toEqual([]);
  });
});

describe("tangMetSangMm — hàng twin_tang (§10A.4)", () => {
  const TN = toaNhaMetSangMm(TOA_NHA_84);

  it("tầng không khai kích thước THỪA KẾ toà nhà và tự khai là SINH", () => {
    const [t] = tangMetSangMm([TANG_TRET], TN);
    expect(t.daiMm).toBe(84_000);
    expect(t.rongMm).toBe(52_000);
    expect(t.kichThuocNguon).toBe("sinh");
    expect(t.nguonHinhHoc).toBe("sinh");
    expect(t.nguon).toBe("sinh");
  });

  it("tầng khai kích thước riêng mang nguonHinhHoc='nhap_tay' và nguon='tay'", () => {
    const [t] = tangMetSangMm(
      [{ ...TANG_TRET, daiM: 40, rongM: 20 }],
      TN,
    );
    expect(t.daiMm).toBe(40_000);
    expect(t.rongMm).toBe(20_000);
    expect(t.kichThuocNguon).toBe("tay");
    expect(t.nguonHinhHoc).toBe("nhap_tay");
    expect(t.nguon).toBe("tay");
  });

  it("★ tầng LỬNG nhỏ hơn toà nhà là hợp lệ, và nhận diện được", () => {
    const [gac] = tangMetSangMm(
      [{ capSo: 2, ten: "Gác lửng", caoThongThuyM: 2.8, daiM: 30, rongM: 12 }],
      TN,
    );
    expect(tangNhoHonToaNha(gac, TN)).toBe(true);
    expect(tangTranKhoiToaNha(gac, TN)).toBe(false);
  });

  it("★ tầng TRÀN khỏi bao ngoài bị nhận diện (gõ 840 thay vì 84)", () => {
    const [tran] = tangMetSangMm(
      [{ ...TANG_TRET, daiM: 840, rongM: 52 }],
      TN,
    );
    expect(tangTranKhoiToaNha(tran, TN)).toBe(true);
  });

  it("chỉ khai MỘT cạnh thì KHÔNG tính là khai — vẫn thừa kế cả hai", () => {
    // Nửa vời là chưa đo: một cạnh đo, một cạnh đoán vẫn là một mặt sàn đoán.
    const [t] = tangMetSangMm([{ ...TANG_TRET, daiM: 40 }], TN);
    expect(t.daiMm).toBe(84_000);
    expect(t.kichThuocNguon).toBe("sinh");
  });

  it("cao thông thuỷ quy đổi đúng và cao độ nối chuỗi giữa các tầng", () => {
    const ds = tangMetSangMm(
      [TANG_TRET, { capSo: 2, ten: "Tầng 2", caoThongThuyM: 4.5 }],
      TN,
    );
    expect(ds[0].caoThongThuyMm).toBe(6000);
    expect(ds[1].caoDoMm).toBe(6300);
  });

  it("tầng chỉ sửa cao độ (không sửa kích thước) vẫn mang nguon='tay'", () => {
    const [t] = tangMetSangMm([{ ...TANG_TRET, caoDoM: 1.5 }], TN);
    expect(t.caoDoMm).toBe(1500);
    expect(t.caoDoNguon).toBe("tay");
    expect(t.nguon).toBe("tay");
  });
});

describe("bboxTangScene — mặt sàn nằm DƯỚI cốt cao độ", () => {
  const TN = toaNhaMetSangMm(TOA_NHA_84);

  it("cốt 6,3 m: mặt trên sàn tại y=6,3 và đáy tại y=6,0", () => {
    const [, t2] = tangMetSangMm(
      [TANG_TRET, { capSo: 2, ten: "Tầng 2", caoThongThuyM: 4.5 }],
      TN,
    );
    const b = bboxTangScene(t2, TN);
    expect(b.maxY).toBeCloseTo(6.3, 9);
    expect(b.minY).toBeCloseTo(6.0, 9);
  });

  it("mặt bằng sàn bằng đúng dài × rộng của tầng", () => {
    const [t] = tangMetSangMm([TANG_TRET], TN);
    const co = kichThuocBBox(bboxTangScene(t, TN));
    expect(co.rong).toBe(84);
    expect(co.sau).toBe(52);
  });
});

describe("sinhTuongBao — 4 tường dày 200 mm theo chu vi (§10A.2)", () => {
  const TN = toaNhaMetSangMm(TOA_NHA_84);
  const [TANG] = tangMetSangMm([TANG_TRET], TN);
  const TUONG = sinhTuongBao(TANG);

  it("sinh ĐÚNG 4 tường", () => {
    expect(TUONG).toHaveLength(4);
  });

  it("mọi tường dày đúng 200 mm ở cạnh mỏng", () => {
    expect(DAY_TUONG_MM).toBe(200);
    for (const t of TUONG) {
      expect(Math.min(t.rongMm, t.sauMm)).toBe(200);
    }
  });

  it("★ mọi tường mang nguon='sinh' — không ai đo bốn bức tường này (NT-4)", () => {
    expect(TUONG.every((t) => t.nguon === "sinh")).toBe(true);
    expect(TUONG.every((t) => t.loai === "tuong")).toBe(true);
  });

  it("hai tường theo trục X kéo hết chiều dài mặt sàn", () => {
    const theoX = TUONG.filter((t) => t.rongMm === TANG.daiMm);
    expect(theoX).toHaveLength(2);
  });

  it("★ hai tường theo trục Y RÚT NGẮN 2×200 mm để không chồng góc", () => {
    const theoY = TUONG.filter((t) => t.rongMm === DAY_TUONG_MM);
    expect(theoY).toHaveLength(2);
    for (const t of theoY) {
      expect(t.sauMm).toBe(TANG.rongMm - 2 * DAY_TUONG_MM);
    }
  });

  it("★ mọi tường nằm TRỌN trong chu vi mặt sàn, không tràn ra ngoài", () => {
    for (const t of TUONG) {
      expect(t.viTriXMm - t.rongMm / 2).toBeGreaterThanOrEqual(0);
      expect(t.viTriXMm + t.rongMm / 2).toBeLessThanOrEqual(TANG.daiMm);
      expect(t.viTriYMm - t.sauMm / 2).toBeGreaterThanOrEqual(0);
      expect(t.viTriYMm + t.sauMm / 2).toBeLessThanOrEqual(TANG.rongMm);
    }
  });

  it("tường cao đúng cao thông thuỷ, đáy đặt tại cao độ sàn", () => {
    for (const t of TUONG) {
      expect(t.caoMm).toBe(TANG.caoThongThuyMm);
      expect(t.viTriZMm - t.caoMm / 2).toBe(TANG.caoDoMm);
    }
  });

  it("tầng trên cao: tường đi lên theo, không dính sàn tầng 1", () => {
    const [, t2] = tangMetSangMm(
      [TANG_TRET, { capSo: 2, ten: "Tầng 2", caoThongThuyM: 4.5 }],
      TN,
    );
    for (const t of sinhTuongBao(t2)) {
      expect(t.viTriZMm - t.caoMm / 2).toBe(6300);
    }
  });

  it("mặt sàn hẹp hơn 2 lần bề dày cho ra cạnh 0, KHÔNG âm", () => {
    const hep = { ...TANG, rongMm: 300 };
    for (const t of sinhTuongBao(hep)) {
      expect(t.rongMm).toBeGreaterThanOrEqual(0);
      expect(t.sauMm).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("kiemTraNhapLieu — chặn ở bước 3", () => {
  it("bộ dữ liệu 84 × 52 × 6 m + 1 tầng là HỢP LỆ (0 lỗi)", () => {
    expect(kiemTraNhapLieu(TOA_NHA_84, [TANG_TRET])).toEqual([]);
  });

  it("thiếu mã và tên đều bị bắt, và bắt CẢ HAI trong một lượt", () => {
    const loi = kiemTraNhapLieu({ ...TOA_NHA_84, ma: "", ten: "  " }, [TANG_TRET]);
    expect(loi.map((l) => l.khoa)).toEqual(
      expect.arrayContaining(["thieuMa", "thieuTen"]),
    );
  });

  it("kích thước 0 hoặc âm bị bắt", () => {
    const loi = kiemTraNhapLieu({ ...TOA_NHA_84, daiM: 0, caoM: -1 }, [TANG_TRET]);
    expect(loi.map((l) => l.khoa)).toEqual(
      expect.arrayContaining([
        "kichThuocKhongHopLe.daiM",
        "kichThuocKhongHopLe.caoM",
      ]),
    );
  });

  it("không tầng nào là lỗi — một toà nhà rỗng không dùng được", () => {
    expect(kiemTraNhapLieu(TOA_NHA_84, []).map((l) => l.khoa)).toContain(
      "khongCoTang",
    );
  });

  it("★ capSo = 0 bị cấm (nhập nhằng tầng trệt vs chưa đặt — migration 0350)", () => {
    const loi = kiemTraNhapLieu(TOA_NHA_84, [{ ...TANG_TRET, capSo: 0 }]);
    expect(loi.map((l) => l.khoa)).toContain("capSoKhongHopLe");
  });

  it("capSo trùng bị bắt — UNIQUE(toaNhaId, capSo) sẽ ném ở DB nếu lọt", () => {
    const loi = kiemTraNhapLieu(TOA_NHA_84, [TANG_TRET, { ...TANG_TRET, ten: "Khác" }]);
    expect(loi.map((l) => l.khoa)).toContain("capSoTrung");
  });

  it("★ tầng tràn khỏi bao ngoài bị CHẶN, kèm capSo để UI chỉ đúng dòng", () => {
    const loi = kiemTraNhapLieu(TOA_NHA_84, [
      { ...TANG_TRET, capSo: 2, daiM: 840, rongM: 52 },
    ]);
    const tran = loi.find((l) => l.khoa === "tangTranKhoiToaNha");
    expect(tran).toBeDefined();
    expect(tran?.capSo).toBe(2);
  });

  it("★ kích thước toà nhà sai KHÔNG đẻ ra lỗi tràn phái sinh che mất lỗi gốc", () => {
    const loi = kiemTraNhapLieu({ ...TOA_NHA_84, daiM: 0, rongM: 0 }, [TANG_TRET]);
    expect(loi.map((l) => l.khoa)).not.toContain("tangTranKhoiToaNha");
  });
});
