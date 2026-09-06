/**
 * hieuChinhNhapModel.unit.test.ts — spec §13.1: quy đổi đơn vị mm/cm/m/inch, đổi
 * trục Z-up<->Y-up, xoay, đặt gốc; bbox sau hiệu chỉnh đúng.
 *
 * ★ Test then chốt: đổi mm -> m làm kích thước đổi ĐÚNG 1000 lần.
 */
import { describe, it, expect } from "vitest";
import { bboxCoThuc, bboxRong, kichThuocBBox, type BBox } from "./heToaDo";
import {
  CAU_HINH_MAC_DINH,
  DANH_SACH_DON_VI,
  HE_SO_SANG_MM,
  NGUONG_LECH,
  apDungHieuChinh,
  apMaTranLenDiem,
  bienDoiBBox,
  doiSangMm,
  heSoCoVeKhaiBao,
  heSoDoiDonVi,
  maTranDonVi,
  maTranTiLe,
  maTranTinhTien,
  maTranXoayQuanhY,
  maTranZupSangYup,
  nhanMaTran,
  soSanhVoiKhaiBao,
  type CauHinhHieuChinh,
} from "./hieuChinhNhapModel";

/** Hộp 1x1x1 đơn vị nguồn, góc thấp tại gốc. */
const HOP_DON_VI: BBox = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };

function cauHinh(ghiDe: Partial<CauHinhHieuChinh> = {}): CauHinhHieuChinh {
  return { ...CAU_HINH_MAC_DINH, ...ghiDe };
}

describe("hieuChinhNhapModel — quy đổi đơn vị", () => {
  it("bảng hệ số đúng chuẩn", () => {
    expect(HE_SO_SANG_MM.mm).toBe(1);
    expect(HE_SO_SANG_MM.cm).toBe(10);
    expect(HE_SO_SANG_MM.m).toBe(1000);
    expect(HE_SO_SANG_MM.inch).toBe(25.4);
    expect(DANH_SACH_DON_VI).toEqual(["mm", "cm", "m", "inch"]);
  });

  it("doiSangMm áp đúng hệ số", () => {
    expect(doiSangMm(1, "m")).toBe(1000);
    expect(doiSangMm(2.5, "cm")).toBe(25);
    expect(doiSangMm(1, "inch")).toBe(25.4);
    expect(doiSangMm(1400, "mm")).toBe(1400);
  });

  it("heSoDoiDonVi khứ hồi bằng 1", () => {
    for (const a of DANH_SACH_DON_VI) {
      for (const b of DANH_SACH_DON_VI) {
        expect(heSoDoiDonVi(a, b) * heSoDoiDonVi(b, a)).toBeCloseTo(1, 12);
      }
    }
  });

  it("★★★ đổi mm -> m làm kích thước đổi ĐÚNG 1000 lần", () => {
    // Cùng một bbox số học, chỉ khai khác đơn vị nguồn.
    const nhuMm = apDungHieuChinh(HOP_DON_VI, cauHinh({ donViNguon: "mm" }));
    const nhuMet = apDungHieuChinh(HOP_DON_VI, cauHinh({ donViNguon: "m" }));

    expect(nhuMm.kichThuocMm.rongMm).toBe(1);
    expect(nhuMet.kichThuocMm.rongMm).toBe(1000);
    expect(nhuMet.kichThuocMm.rongMm / nhuMm.kichThuocMm.rongMm).toBe(1000);
    expect(nhuMet.kichThuocMm.caoMm / nhuMm.kichThuocMm.caoMm).toBe(1000);
    expect(nhuMet.kichThuocMm.sauMm / nhuMm.kichThuocMm.sauMm).toBe(1000);
    expect(nhuMet.heSoTiLe / nhuMm.heSoTiLe).toBe(1000);
  });

  it("cm -> 10 lần, inch -> 25.4 lần so với mm", () => {
    const mm = apDungHieuChinh(HOP_DON_VI, cauHinh({ donViNguon: "mm" }));
    const cm = apDungHieuChinh(HOP_DON_VI, cauHinh({ donViNguon: "cm" }));
    const inch = apDungHieuChinh(HOP_DON_VI, cauHinh({ donViNguon: "inch" }));
    expect(cm.kichThuocMm.rongMm / mm.kichThuocMm.rongMm).toBeCloseTo(10, 9);
    expect(inch.kichThuocMm.rongMm / mm.kichThuocMm.rongMm).toBeCloseTo(25.4, 9);
  });

  it("★ nhập nhầm đơn vị lộ ra ngay: nhà xưởng 84 m khai 'mm' thành 8,4 cm", () => {
    const nha: BBox = { minX: 0, minY: 0, minZ: 0, maxX: 84, maxY: 12, maxZ: 52 };
    const dung = apDungHieuChinh(nha, cauHinh({ donViNguon: "m" }));
    const sai = apDungHieuChinh(nha, cauHinh({ donViNguon: "mm" }));
    expect(dung.kichThuocMm.rongMm).toBe(84_000);
    expect(sai.kichThuocMm.rongMm).toBe(84);
    expect(dung.kichThuocMm.rongMm / sai.kichThuocMm.rongMm).toBe(1000);
  });
});

describe("hieuChinhNhapModel — ma trận 4x4", () => {
  it("ma trận đơn vị giữ nguyên điểm", () => {
    const p = { x: 1, y: 2, z: 3 };
    expect(apMaTranLenDiem(maTranDonVi(), p)).toEqual(p);
  });

  it("nhân với đơn vị là phép đồng nhất hai phía", () => {
    const m = maTranXoayQuanhY(0.7);
    expect(nhanMaTran(m, maTranDonVi())).toEqual(m);
    expect(nhanMaTran(maTranDonVi(), m)).toEqual(m);
  });

  it("tỉ lệ và tịnh tiến áp đúng", () => {
    expect(apMaTranLenDiem(maTranTiLe(1000), { x: 1, y: 2, z: 3 })).toEqual({
      x: 1000, y: 2000, z: 3000,
    });
    expect(apMaTranLenDiem(maTranTinhTien(5, -1, 2), { x: 1, y: 1, z: 1 })).toEqual({
      x: 6, y: 0, z: 3,
    });
  });

  it("thứ tự nhân: nhanMaTran(a,b) áp b TRƯỚC rồi a", () => {
    // Tỉ lệ 2 rồi tịnh tiến +10 => (1)*2+10 = 12
    const m = nhanMaTran(maTranTinhTien(10, 0, 0), maTranTiLe(2));
    expect(apMaTranLenDiem(m, { x: 1, y: 0, z: 0 }).x).toBe(12);
    // Ngược lại: tịnh tiến +10 rồi tỉ lệ 2 => (1+10)*2 = 22
    const n = nhanMaTran(maTranTiLe(2), maTranTinhTien(10, 0, 0));
    expect(apMaTranLenDiem(n, { x: 1, y: 0, z: 0 }).x).toBe(22);
  });

  it("xoay quanh Y: 90° đưa +X về -Z, giữ nguyên Y", () => {
    const p = apMaTranLenDiem(maTranXoayQuanhY(Math.PI / 2), { x: 1, y: 5, z: 0 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBe(5);
    expect(p.z).toBeCloseTo(-1, 9);
  });

  it("★ Z-up -> Y-up: trục cao của file (Z) thành trục cao của scene (Y)", () => {
    const p = apMaTranLenDiem(maTranZupSangYup(), { x: 0, y: 0, z: 1 });
    expect(p.y).toBeCloseTo(1, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it("Z-up -> Y-up: Y của file (vào sâu) thành -Z của scene", () => {
    const p = apMaTranLenDiem(maTranZupSangYup(), { x: 0, y: 1, z: 0 });
    expect(p.z).toBeCloseTo(-1, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it("bienDoiBBox biến đổi cả 8 đỉnh rồi bao lại (đúng cả khi xoay 45°)", () => {
    const b: BBox = { minX: -1, minY: 0, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 };
    const xoay = bienDoiBBox(b, maTranXoayQuanhY(Math.PI / 4));
    // Hình vuông 2x2 xoay 45° có bbox cạnh 2*sqrt(2).
    expect(kichThuocBBox(xoay).rong).toBeCloseTo(2 * Math.SQRT2, 9);
    expect(kichThuocBBox(xoay).cao).toBeCloseTo(1, 9);
  });

  it("bienDoiBBox của bbox rỗng vẫn rỗng", () => {
    expect(bboxCoThuc(bienDoiBBox(bboxRong(), maTranDonVi()))).toBe(false);
  });
});

describe("hieuChinhNhapModel — apDungHieuChinh", () => {
  it("★ Z-up: bề CAO của model lấy từ trục Z của file", () => {
    // File Z-up, cao 9,4 m theo trục Z.
    const b: BBox = { minX: 0, minY: 0, minZ: 0, maxX: 84.2, maxY: 51.6, maxZ: 9.4 };
    const kq = apDungHieuChinh(b, cauHinh({ donViNguon: "m", trucLen: "Z" }));
    expect(kq.kichThuocMm.rongMm).toBeCloseTo(84_200, 6);
    expect(kq.kichThuocMm.caoMm).toBeCloseTo(9_400, 6);
    expect(kq.kichThuocMm.sauMm).toBeCloseTo(51_600, 6);
  });

  it("★ Y-up: bề CAO lấy từ trục Y của file — khác hẳn Z-up", () => {
    const b: BBox = { minX: 0, minY: 0, minZ: 0, maxX: 84.2, maxY: 51.6, maxZ: 9.4 };
    const kq = apDungHieuChinh(b, cauHinh({ donViNguon: "m", trucLen: "Y" }));
    expect(kq.kichThuocMm.caoMm).toBeCloseTo(51_600, 6);
    expect(kq.kichThuocMm.sauMm).toBeCloseTo(9_400, 6);
  });

  it("★ chọn nhầm trục lên làm nhà xưởng cao 51 m thay vì 9,4 m", () => {
    const b: BBox = { minX: 0, minY: 0, minZ: 0, maxX: 84.2, maxY: 51.6, maxZ: 9.4 };
    const zup = apDungHieuChinh(b, cauHinh({ donViNguon: "m", trucLen: "Z" }));
    const yup = apDungHieuChinh(b, cauHinh({ donViNguon: "m", trucLen: "Y" }));
    expect(zup.kichThuocMm.caoMm).not.toBeCloseTo(yup.kichThuocMm.caoMm, 0);
  });

  it("xoay 90° quanh trục lên hoán đổi bề rộng và bề sâu", () => {
    const b: BBox = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 2, maxZ: 4 };
    const khong = apDungHieuChinh(b, cauHinh({ donViNguon: "mm", trucLen: "Y" }));
    const chin = apDungHieuChinh(
      b,
      cauHinh({ donViNguon: "mm", trucLen: "Y", xoayQuanhTrucLenDo: 90 }),
    );
    expect(khong.kichThuocMm.rongMm).toBeCloseTo(10, 6);
    expect(chin.kichThuocMm.rongMm).toBeCloseTo(4, 6);
    expect(chin.kichThuocMm.sauMm).toBeCloseTo(10, 6);
    // Bề cao KHÔNG đổi khi xoay quanh trục lên.
    expect(chin.kichThuocMm.caoMm).toBeCloseTo(khong.kichThuocMm.caoMm, 6);
  });

  it("xoay 360° tương đương không xoay", () => {
    const b: BBox = { minX: -3, minY: 0, minZ: -1, maxX: 7, maxY: 2, maxZ: 4 };
    const a = apDungHieuChinh(b, cauHinh({ trucLen: "Y" }));
    const c = apDungHieuChinh(b, cauHinh({ trucLen: "Y", xoayQuanhTrucLenDo: 360 }));
    expect(c.kichThuocMm.rongMm).toBeCloseTo(a.kichThuocMm.rongMm, 6);
    expect(c.kichThuocMm.sauMm).toBeCloseTo(a.kichThuocMm.sauMm, 6);
  });

  it("★ điểm gốc 'goc_bbox': góc thấp nhất về gốc toạ độ, model đứng trên sàn", () => {
    const b: BBox = { minX: 100, minY: 50, minZ: -20, maxX: 110, maxY: 52, maxZ: -10 };
    const kq = apDungHieuChinh(
      b,
      cauHinh({ donViNguon: "mm", trucLen: "Y", kieuDiemGoc: "goc_bbox" }),
    );
    expect(kq.bboxMoi.minX).toBeCloseTo(0, 9);
    expect(kq.bboxMoi.minY).toBeCloseTo(0, 9);
    expect(kq.bboxMoi.minZ).toBeCloseTo(0, 9);
  });

  it("★ 'tam_bbox': tâm mặt bằng về gốc nhưng ĐÁY vẫn chạm sàn (không lơ lửng)", () => {
    const b: BBox = { minX: 100, minY: 50, minZ: -20, maxX: 110, maxY: 52, maxZ: -10 };
    const kq = apDungHieuChinh(
      b,
      cauHinh({ donViNguon: "mm", trucLen: "Y", kieuDiemGoc: "tam_bbox" }),
    );
    expect((kq.bboxMoi.minX + kq.bboxMoi.maxX) / 2).toBeCloseTo(0, 9);
    expect((kq.bboxMoi.minZ + kq.bboxMoi.maxZ) / 2).toBeCloseTo(0, 9);
    expect(kq.bboxMoi.minY).toBeCloseTo(0, 9);
  });

  it("'goc_file' giữ nguyên vị trí gốc của file (chỉ đổi tỉ lệ/trục)", () => {
    const b: BBox = { minX: 100, minY: 50, minZ: -20, maxX: 110, maxY: 52, maxZ: -10 };
    const kq = apDungHieuChinh(
      b,
      cauHinh({ donViNguon: "mm", trucLen: "Y", kieuDiemGoc: "goc_file" }),
    );
    expect(kq.bboxMoi.minX).toBeCloseTo(100, 9);
    expect(kq.bboxMoi.minY).toBeCloseTo(50, 9);
  });

  it("đặt gốc KHÔNG đổi kích thước bao ngoài", () => {
    const b: BBox = { minX: 100, minY: 50, minZ: -20, maxX: 110, maxY: 52, maxZ: -10 };
    const co = (k: CauHinhHieuChinh["kieuDiemGoc"]) =>
      apDungHieuChinh(b, cauHinh({ trucLen: "Y", kieuDiemGoc: k })).kichThuocMm;
    expect(co("tam_bbox")).toEqual(co("goc_bbox"));
    expect(co("goc_file")).toEqual(co("goc_bbox"));
  });

  it("maTranBienDoi khớp với bboxMoi (ma trận trả về dùng được thật)", () => {
    const b: BBox = { minX: 2, minY: 3, minZ: 4, maxX: 12, maxY: 5, maxZ: 9 };
    const kq = apDungHieuChinh(
      b,
      cauHinh({ donViNguon: "cm", trucLen: "Z", xoayQuanhTrucLenDo: 30 }),
    );
    const lai = bienDoiBBox(b, kq.maTranBienDoi);
    expect(lai.minX).toBeCloseTo(kq.bboxMoi.minX, 9);
    expect(lai.maxY).toBeCloseTo(kq.bboxMoi.maxY, 9);
    expect(lai.maxZ).toBeCloseTo(kq.bboxMoi.maxZ, 9);
  });

  it("maTranBienDoi có 16 phần tử hữu hạn (nạp được vào Matrix4.fromArray)", () => {
    const kq = apDungHieuChinh(HOP_DON_VI, cauHinh({ donViNguon: "m", trucLen: "Z" }));
    expect(kq.maTranBienDoi).toHaveLength(16);
    expect(kq.maTranBienDoi.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("bbox rỗng đầu vào -> bbox rỗng ra, không ném lỗi", () => {
    const kq = apDungHieuChinh(bboxRong(), cauHinh());
    expect(bboxCoThuc(kq.bboxMoi)).toBe(false);
    expect(kq.kichThuocMm).toEqual({ rongMm: 0, caoMm: 0, sauMm: 0 });
  });

  it("tất định: hai lần gọi cùng đầu vào cho deep-equal", () => {
    const c = cauHinh({ donViNguon: "inch", trucLen: "Z", xoayQuanhTrucLenDo: 17 });
    expect(apDungHieuChinh(HOP_DON_VI, c)).toEqual(apDungHieuChinh(HOP_DON_VI, c));
  });

  it("cấu hình mặc định là mm + Z-up (giả định CAD, an toàn nhất)", () => {
    expect(CAU_HINH_MAC_DINH.donViNguon).toBe("mm");
    expect(CAU_HINH_MAC_DINH.trucLen).toBe("Z");
    expect(CAU_HINH_MAC_DINH.xoayQuanhTrucLenDo).toBe(0);
  });
});

describe("hieuChinhNhapModel — so sánh với kích thước khai báo (§10B.2)", () => {
  const khai = { rongMm: 1400, caoMm: 1900, sauMm: 1200 };

  it("ngưỡng là 30%", () => {
    expect(NGUONG_LECH).toBe(0.3);
  });

  it("khớp hoàn toàn -> không lệch", () => {
    const kq = soSanhVoiKhaiBao(khai, khai);
    expect(kq.lechQuaNguong).toBe(false);
    expect(kq.trucLech).toEqual([]);
    expect(kq.lechLonNhat).toBe(0);
    expect(kq.khongSoSanhDuoc).toBe(false);
  });

  it("★ VÍ DỤ CỦA SPEC (2400 vs 1900) chỉ lệch 26,3% -> KHÔNG chạm ngưỡng 30%", () => {
    // Ghi lại có chủ ý: câu minh hoạ ở §10B.2 ("Model cao 2,4 m nhưng máy khai
    // 1,9 m") KHÔNG vượt ngưỡng 30% mà chính spec đặt ra. Test này khoá số đo
    // thật lại để không ai "sửa" ngưỡng cho khớp câu ví dụ.
    const kq = soSanhVoiKhaiBao({ ...khai, caoMm: 2400 }, khai);
    expect(kq.lechLonNhat).toBeCloseTo(500 / 1900, 9);
    expect(kq.lechLonNhat).toBeLessThan(NGUONG_LECH);
    expect(kq.lechQuaNguong).toBe(false);
  });

  it("★ model cao 2600 mm nhưng máy khai 1900 mm -> lệch >30%, cờ BẬT", () => {
    const kq = soSanhVoiKhaiBao({ ...khai, caoMm: 2600 }, khai);
    expect(kq.lechQuaNguong).toBe(true);
    expect(kq.trucLech.map((t) => t.truc)).toEqual(["cao"]);
    expect(kq.trucLech[0].tiLeLech).toBeCloseTo(700 / 1900, 9);
  });

  it("lệch 29% KHÔNG bật cờ, lệch 31% thì bật (biên chặt)", () => {
    const duoi = soSanhVoiKhaiBao({ ...khai, caoMm: 1900 * 1.29 }, khai);
    const tren = soSanhVoiKhaiBao({ ...khai, caoMm: 1900 * 1.31 }, khai);
    expect(duoi.lechQuaNguong).toBe(false);
    expect(tren.lechQuaNguong).toBe(true);
  });

  it("lệch đúng 30% không bật (so sánh dùng > chứ không >=)", () => {
    const kq = soSanhVoiKhaiBao({ ...khai, caoMm: 1900 * 1.3 }, khai);
    expect(kq.lechQuaNguong).toBe(false);
  });

  it("model NHỎ hơn khai báo cũng bị bắt (lệch là giá trị tuyệt đối)", () => {
    const kq = soSanhVoiKhaiBao({ ...khai, rongMm: 700 }, khai);
    expect(kq.lechQuaNguong).toBe(true);
    expect(kq.trucLech[0].truc).toBe("rong");
  });

  it("nhiều trục lệch cùng lúc, thứ tự cố định rong -> cao -> sau", () => {
    const kq = soSanhVoiKhaiBao({ rongMm: 5000, caoMm: 5000, sauMm: 5000 }, khai);
    expect(kq.trucLech.map((t) => t.truc)).toEqual(["rong", "cao", "sau"]);
  });

  it("★ khai báo bằng 0 -> khongSoSanhDuoc, KHÁC với 'không lệch' (NT-3)", () => {
    const kq = soSanhVoiKhaiBao(khai, { rongMm: 0, caoMm: 0, sauMm: 0 });
    expect(kq.khongSoSanhDuoc).toBe(true);
    expect(kq.lechQuaNguong).toBe(false);
    expect(kq.trucLech).toEqual([]);
  });

  it("khai báo thiếu một trục vẫn so hai trục còn lại", () => {
    const kq = soSanhVoiKhaiBao({ rongMm: 5000, caoMm: 1900, sauMm: 1200 }, {
      ...khai, sauMm: 0,
    });
    expect(kq.khongSoSanhDuoc).toBe(false);
    expect(kq.trucLech.map((t) => t.truc)).toEqual(["rong"]);
  });

  it("ngưỡng ghi đè được", () => {
    const kq = soSanhVoiKhaiBao({ ...khai, caoMm: 2000 }, khai, 0.01);
    expect(kq.lechQuaNguong).toBe(true);
  });
});

describe("hieuChinhNhapModel — heSoCoVeKhaiBao", () => {
  const khai = { rongMm: 1400, caoMm: 1900, sauMm: 1200 };

  it("model gấp đôi khai báo -> hệ số 0,5", () => {
    const heSo = heSoCoVeKhaiBao(
      { rongMm: 2800, caoMm: 3800, sauMm: 2400 },
      khai,
    );
    expect(heSo).toBeCloseTo(0.5, 12);
  });

  it("★ co ĐỀU theo trục CHẬT nhất để model không tràn khỏi ô khai báo", () => {
    // rộng cần 0,5 ; cao cần 1,0 ; sâu cần 1,0 -> lấy 0,5
    const heSo = heSoCoVeKhaiBao({ rongMm: 2800, caoMm: 1900, sauMm: 1200 }, khai);
    expect(heSo).toBeCloseTo(0.5, 12);
    expect(2800 * heSo).toBeLessThanOrEqual(khai.rongMm + 1e-9);
    expect(1900 * heSo).toBeLessThanOrEqual(khai.caoMm + 1e-9);
  });

  it("model khớp sẵn -> hệ số 1", () => {
    expect(heSoCoVeKhaiBao(khai, khai)).toBeCloseTo(1, 12);
  });

  it("bbox model suy biến (0 mọi trục) -> hệ số 1, không chia cho 0", () => {
    const heSo = heSoCoVeKhaiBao({ rongMm: 0, caoMm: 0, sauMm: 0 }, khai);
    expect(heSo).toBe(1);
    expect(Number.isFinite(heSo)).toBe(true);
  });

  it("khai báo trống -> hệ số 1", () => {
    expect(heSoCoVeKhaiBao(khai, { rongMm: 0, caoMm: 0, sauMm: 0 })).toBe(1);
  });
});
