/**
 * heToaDo.unit.test.ts — spec §13.1: mm<->m, Y<->Z, quaternion chuẩn hoá, bbox, làm tròn.
 *
 * Đuôi `.unit.test.ts` chứ KHÔNG phải `.test.ts` như bảng §13.1 ghi: `vitest.config.ts`
 * chỉ include `client/src/**\/*.unit.test.ts`. Đo được: đặt tên `.test.ts` thì vitest
 * báo "No test files found" và cổng vẫn khai xanh — đúng lớp lỗi "glob rỗng, vitest
 * im lặng" đã ghi trong bộ nhớ dự án.
 */
import { describe, it, expect } from "vitest";
import {
  MM_MOI_MET,
  bboxCoThuc,
  bboxGiaoNhau,
  bboxGiaoNhauTrenSan,
  bboxMmSangScene,
  bboxNamTrong,
  bboxRong,
  bboxTuDiem,
  bboxTuTamVaKichThuoc,
  chuanHoaQuat,
  chuanQuat,
  gocTuQuatTrucDung,
  gopBBox,
  gopNhieuBBox,
  khoangCach,
  kichThuocBBox,
  laQuatChuanHoa,
  laQuatSuyBien,
  lamTronDiemVeLuoi,
  lamTronGocVeBuocDo,
  lamTronVeLuoi,
  metSangMm,
  mmSangMet,
  mmSangScene,
  quatXoayQuanhTrucDung,
  sceneSangMm,
  tamBBox,
} from "./heToaDo";

describe("heToaDo — mm <-> mét", () => {
  it("1000 mm = 1 m", () => {
    expect(mmSangMet(1000)).toBe(1);
    expect(metSangMm(1)).toBe(1000);
    expect(MM_MOI_MET).toBe(1000);
  });

  it("khứ hồi mm -> m -> mm giữ nguyên giá trị", () => {
    for (const mm of [0, 1, 1400, 84_000, -2500.5]) {
      expect(metSangMm(mmSangMet(mm))).toBeCloseTo(mm, 9);
    }
  });

  it("giá trị âm và 0 vẫn quy đổi tuyến tính", () => {
    expect(mmSangMet(0)).toBe(0);
    expect(mmSangMet(-1000)).toBe(-1);
  });
});

describe("heToaDo — quy ước trục §5.2 (Z của DB là ĐỘ CAO)", () => {
  it("scene.y lấy từ zMm, scene.z lấy từ yMm", () => {
    const scene = mmSangScene({ xMm: 1000, yMm: 2000, zMm: 3000 });
    expect(scene).toEqual({ x: 1, y: 3, z: 2 });
  });

  it("★ ĐỘ CAO của DB (zMm) đi vào trục ĐỨNG của scene, không vào trục z", () => {
    // Máy cao 1,6 m đặt trên sàn: zMm = 1600 phải thành scene.y = 1.6
    const scene = mmSangScene({ xMm: 0, yMm: 0, zMm: 1600 });
    expect(scene.y).toBe(1.6);
    expect(scene.z).toBe(0);
  });

  it("★ Y mặt bằng (hướng xuống) đi vào trục z của scene, KHÔNG vào trục y", () => {
    const scene = mmSangScene({ xMm: 0, yMm: 5000, zMm: 0 });
    expect(scene.z).toBe(5);
    expect(scene.y).toBe(0);
  });

  it("sceneSangMm là nghịch đảo đúng của mmSangScene", () => {
    const goc = { xMm: 12_345, yMm: -6_789, zMm: 1_600 };
    expect(sceneSangMm(mmSangScene(goc))).toEqual(goc);
  });

  it("hoán vị trục KHÔNG phải phép đồng nhất (bắt lỗi copy-paste)", () => {
    const scene = mmSangScene({ xMm: 1000, yMm: 2000, zMm: 3000 });
    expect(scene.y).not.toBe(2);
    expect(scene.z).not.toBe(3);
  });
});

describe("heToaDo — quaternion", () => {
  it("identity đã chuẩn hoá", () => {
    expect(laQuatChuanHoa({ x: 0, y: 0, z: 0, w: 1 })).toBe(true);
  });

  it("★ T6: x²+y²+z²+w² xấp xỉ 1 với sai số 1e-6", () => {
    const q = chuanHoaQuat({ x: 3, y: 4, z: 5, w: 6 });
    const binhPhuong = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
    expect(Math.abs(binhPhuong - 1)).toBeLessThanOrEqual(1e-6);
    expect(laQuatChuanHoa(q)).toBe(true);
  });

  it("quaternion CHƯA chuẩn hoá bị bác bỏ", () => {
    expect(laQuatChuanHoa({ x: 0, y: 0, z: 0, w: 2 })).toBe(false);
    expect(laQuatChuanHoa({ x: 1, y: 1, z: 1, w: 1 })).toBe(false);
  });

  it("sai số 1e-6 là biên CHẶT: lệch 1e-3 bị bác bỏ", () => {
    // w sao cho w² = 1 + 1e-3
    const w = Math.sqrt(1 + 1e-3);
    expect(laQuatChuanHoa({ x: 0, y: 0, z: 0, w })).toBe(false);
  });

  it("quaternion độ dài 0 -> identity, không NaN", () => {
    const q = chuanHoaQuat({ x: 0, y: 0, z: 0, w: 0 });
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(Number.isNaN(q.w)).toBe(false);
    expect(laQuatSuyBien({ x: 0, y: 0, z: 0, w: 0 })).toBe(true);
    expect(laQuatSuyBien({ x: 0, y: 0, z: 0, w: 1 })).toBe(false);
  });

  it("chuanQuat đo đúng độ dài", () => {
    expect(chuanQuat({ x: 0, y: 0, z: 0, w: 1 })).toBe(1);
    expect(chuanQuat({ x: 3, y: 4, z: 0, w: 0 })).toBe(5);
  });

  it("xoay quanh trục đứng: 0°, 90°, 180° đều chuẩn hoá và khứ hồi đúng", () => {
    for (const goc of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const q = quatXoayQuanhTrucDung(goc);
      expect(laQuatChuanHoa(q)).toBe(true);
      expect(q.x).toBe(0);
      expect(q.z).toBe(0);
      expect(gocTuQuatTrucDung(q)).toBeCloseTo(goc, 9);
    }
  });
});

describe("heToaDo — bbox", () => {
  it("bboxRong không có thực và gộp với nó là phần tử trung hoà", () => {
    const rong = bboxRong();
    expect(bboxCoThuc(rong)).toBe(false);
    const b = bboxTuTamVaKichThuoc({ x: 0, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    expect(gopBBox(rong, b)).toEqual(b);
    expect(gopNhieuBBox([])).toEqual(rong);
  });

  it("bbox từ tâm + kích thước đặt tâm ở giữa", () => {
    const b = bboxTuTamVaKichThuoc({ x: 10, y: 1, z: -4 }, { rong: 2, cao: 4, sau: 6 });
    expect(b).toEqual({ minX: 9, minY: -1, minZ: -7, maxX: 11, maxY: 3, maxZ: -1 });
    expect(tamBBox(b)).toEqual({ x: 10, y: 1, z: -4 });
    expect(kichThuocBBox(b)).toEqual({ rong: 2, cao: 4, sau: 6 });
  });

  it("bboxTuDiem bao mọi điểm", () => {
    const b = bboxTuDiem([
      { x: 1, y: 2, z: 3 },
      { x: -5, y: 0, z: 9 },
      { x: 4, y: -2, z: 1 },
    ]);
    expect(b).toEqual({ minX: -5, minY: -2, minZ: 1, maxX: 4, maxY: 2, maxZ: 9 });
  });

  it("bboxTuDiem của danh sách rỗng là bbox rỗng", () => {
    expect(bboxTuDiem([])).toEqual(bboxRong());
    expect(kichThuocBBox(bboxRong())).toEqual({ rong: 0, cao: 0, sau: 0 });
    expect(tamBBox(bboxRong())).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("gộp nhiều bbox bằng gộp lần lượt", () => {
    const a = bboxTuTamVaKichThuoc({ x: 0, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    const b = bboxTuTamVaKichThuoc({ x: 10, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    expect(gopNhieuBBox([a, b])).toEqual({
      minX: -1, minY: -1, minZ: -1, maxX: 11, maxY: 1, maxZ: 1,
    });
  });

  it("★ T4: hai bbox chồng lấn thì GIAO", () => {
    const a = bboxTuTamVaKichThuoc({ x: 0, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    const b = bboxTuTamVaKichThuoc({ x: 1, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    expect(bboxGiaoNhau(a, b)).toBe(true);
    expect(bboxGiaoNhauTrenSan(a, b)).toBe(true);
  });

  it("★ T4: CHẠM MÉP không tính là giao (phép so chặt)", () => {
    const a = bboxTuTamVaKichThuoc({ x: 0, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    const b = bboxTuTamVaKichThuoc({ x: 2, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    expect(a.maxX).toBe(b.minX); // đúng là chạm mép
    expect(bboxGiaoNhau(a, b)).toBe(false);
    expect(bboxGiaoNhauTrenSan(a, b)).toBe(false);
  });

  it("bbox rời nhau thì không giao", () => {
    const a = bboxTuTamVaKichThuoc({ x: 0, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    const b = bboxTuTamVaKichThuoc({ x: 100, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    expect(bboxGiaoNhau(a, b)).toBe(false);
  });

  it("★ chồng lấn MẶT BẰNG nhưng khác độ cao: 3D không giao, TRÊN SÀN thì giao", () => {
    const duoi = bboxTuTamVaKichThuoc({ x: 0, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    const tren = bboxTuTamVaKichThuoc({ x: 0, y: 10, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    expect(bboxGiaoNhau(duoi, tren)).toBe(false);
    expect(bboxGiaoNhauTrenSan(duoi, tren)).toBe(true);
  });

  it("bbox rỗng không giao với bất cứ gì", () => {
    const a = bboxTuTamVaKichThuoc({ x: 0, y: 0, z: 0 }, { rong: 2, cao: 2, sau: 2 });
    expect(bboxGiaoNhau(bboxRong(), a)).toBe(false);
    expect(bboxGiaoNhauTrenSan(a, bboxRong())).toBe(false);
  });

  it("★ T5: nằm trong biên, chạm mép vẫn tính là trong", () => {
    const tang = bboxTuTamVaKichThuoc({ x: 0, y: 3, z: 0 }, { rong: 84, cao: 6, sau: 52 });
    const may = bboxTuTamVaKichThuoc({ x: 10, y: 0.8, z: 5 }, { rong: 1.4, cao: 1.6, sau: 1.2 });
    expect(bboxNamTrong(may, tang)).toBe(true);
    const trumMep = bboxTuTamVaKichThuoc({ x: 42 - 0.7, y: 3, z: 0 }, { rong: 1.4, cao: 1, sau: 1 });
    expect(bboxNamTrong(trumMep, tang)).toBe(true);
    const tranRa = bboxTuTamVaKichThuoc({ x: 42, y: 3, z: 0 }, { rong: 1.4, cao: 1, sau: 1 });
    expect(bboxNamTrong(tranRa, tang)).toBe(false);
  });

  it("bboxMmSangScene áp cả tỉ lệ 1000 lẫn hoán vị trục", () => {
    const mm: ReturnType<typeof bboxTuDiem> = {
      minX: 0, minY: 0, minZ: 0, maxX: 1000, maxY: 2000, maxZ: 3000,
    };
    const scene = bboxMmSangScene(mm);
    expect(scene).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 3, maxZ: 2 });
  });

  it("bboxMmSangScene của bbox rỗng vẫn rỗng", () => {
    expect(bboxMmSangScene(bboxRong())).toEqual(bboxRong());
  });
});

describe("heToaDo — làm tròn về lưới", () => {
  it("làm tròn TUYỆT ĐỐI về bội của bước", () => {
    expect(lamTronVeLuoi(1.2, 0.5)).toBeCloseTo(1, 9);
    expect(lamTronVeLuoi(1.3, 0.5)).toBeCloseTo(1.5, 9);
    expect(lamTronVeLuoi(2437, 100)).toBe(2400);
    expect(lamTronVeLuoi(2457, 100)).toBe(2500);
  });

  it("bước <= 0 hoặc không hữu hạn thì không snap", () => {
    expect(lamTronVeLuoi(1.234, 0)).toBe(1.234);
    expect(lamTronVeLuoi(1.234, -5)).toBe(1.234);
    expect(lamTronVeLuoi(1.234, Number.NaN)).toBe(1.234);
  });

  it("-0 được chuẩn hoá về 0 để deep-equal không lệch", () => {
    const ket = lamTronVeLuoi(-0.1, 1);
    expect(Object.is(ket, -0)).toBe(false);
    expect(ket).toBe(0);
  });

  it("làm tròn điểm áp cả ba trục", () => {
    expect(lamTronDiemVeLuoi({ x: 1.2, y: 0.4, z: -1.3 }, 0.5)).toEqual({
      x: 1, y: 0.5, z: -1.5,
    });
  });

  it("★ RB-2: snap góc là TUYỆT ĐỐI — 8° với bước 15° ra 15°, không phải 23°", () => {
    const tam = (8 * Math.PI) / 180;
    const tron = lamTronGocVeBuocDo(tam, 15);
    expect((tron * 180) / Math.PI).toBeCloseTo(15, 9);
    expect((tron * 180) / Math.PI).not.toBeCloseTo(23, 3);
  });

  it("snap góc IDEMPOTENT: snap lần hai không dịch thêm", () => {
    const mot = lamTronGocVeBuocDo((8 * Math.PI) / 180, 15);
    const hai = lamTronGocVeBuocDo(mot, 15);
    expect(hai).toBeCloseTo(mot, 12);
  });

  it("snap góc: 7° ra 0°, 22° ra 15°, 23° ra 30°", () => {
    const doSang = (d: number) => (lamTronGocVeBuocDo((d * Math.PI) / 180, 15) * 180) / Math.PI;
    expect(doSang(7)).toBeCloseTo(0, 9);
    expect(doSang(22)).toBeCloseTo(15, 9);
    expect(doSang(23)).toBeCloseTo(30, 9);
  });

  it("bước góc <= 0 thì không snap", () => {
    const goc = 0.1234;
    expect(lamTronGocVeBuocDo(goc, 0)).toBe(goc);
  });
});

describe("heToaDo — khoảng cách", () => {
  it("tam giác 3-4-5", () => {
    expect(khoangCach({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
  });

  it("khoảng cách tới chính nó bằng 0 và đối xứng", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: -4, y: 5, z: 6 };
    expect(khoangCach(a, a)).toBe(0);
    expect(khoangCach(a, b)).toBe(khoangCach(b, a));
  });
});
