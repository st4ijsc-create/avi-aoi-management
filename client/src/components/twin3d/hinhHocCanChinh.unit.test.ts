/**
 * hinhHocCanChinh.unit.test.ts — bộ 12 công cụ căn chỉnh (§7.2).
 *
 * ★★★ Test QUAN TRỌNG NHẤT của cả đợt nằm ở describe "RB-2":
 *     `snapGocTuyetDoi(8, 15)` PHẢI ra 15, KHÔNG phải 23.
 *     Công thức tương đối của three (`goc + buoc`) cho 23 và máy không bao giờ
 *     chạm được một góc trên lưới.
 *
 * ★ Tên tệp `.unit.test.ts` bắt buộc (vitest.config.ts include, luật G3).
 */

import { describe, expect, it } from "vitest";
import {
  BUOC_GOC_MAC_DINH_DO,
  BUOC_LUOI_MAC_DINH_MM,
  BUOC_NUDGE_LON_MM,
  BUOC_NUDGE_MM,
  SO_LUONG_NHAN_BAN_TOI_DA,
  type VatTheCoBBox,
  buocNhanBanHopLe,
  buocNudgeCho,
  canhTheoBien,
  chuanHoaGocDo,
  daSnapGoc,
  daSnapLuoi,
  danDeu,
  dichBBox,
  doKheHoMatBang,
  doKhoangCach,
  doKhoangCachMatBang,
  nhanBanToaTron,
  nhanBanTuyenTinh,
  nudge,
  snapCoHieuLuc,
  snapGocTuyetDoi,
  snapLuoi,
  snapLuoiMatBang,
} from "./hinhHocCanChinh";
import { type BBox, bboxGiaoNhauTrenSan } from "./heToaDo";

/** BBox mặt bằng (độ cao 0..1) — mọi test align/distribute dùng dạng này. */
function o(khoa: string, minX: number, maxX: number, minZ: number, maxZ: number): VatTheCoBBox {
  return { khoa, bbox: { minX, maxX, minY: 0, maxY: 1, minZ, maxZ } };
}

function theoKhoa(ds: { khoa: string; bbox: BBox }[]): Map<string, BBox> {
  return new Map(ds.map((d) => [d.khoa, d.bbox]));
}

// ===========================================================================
// RB-2 — snap xoay TUYỆT ĐỐI
// ===========================================================================

describe("★★★ RB-2 — snapGocTuyetDoi là TUYỆT ĐỐI, không tương đối", () => {
  it("GHIM: snapGocTuyetDoi(8, 15) === 15, KHÔNG phải 23", () => {
    expect(snapGocTuyetDoi(8, 15)).toBe(15);
    // Đối chứng: đây là kết quả của công thức TƯƠNG ĐỐI mà three dùng.
    expect(snapGocTuyetDoi(8, 15)).not.toBe(8 + 15);
    expect(snapGocTuyetDoi(8, 15)).not.toBe(23);
  });

  it("máy ở 8° bấm snap NHIỀU LẦN vẫn đứng ở 15 (tương đối sẽ trôi 23→38→53)", () => {
    let goc = 8;
    const duong: number[] = [];
    for (let i = 0; i < 4; i++) {
      goc = snapGocTuyetDoi(goc, 15);
      duong.push(goc);
    }
    expect(duong).toEqual([15, 15, 15, 15]);
    // Đường đi của công thức tương đối, để thấy rõ hai chiều khác nhau:
    let tuongDoi = 8;
    const duongTuongDoi: number[] = [];
    for (let i = 0; i < 4; i++) {
      tuongDoi = tuongDoi + 15;
      duongTuongDoi.push(tuongDoi);
    }
    expect(duongTuongDoi).toEqual([23, 38, 53, 68]);
    // KHÔNG số nào trong đường tương đối nằm trên lưới 15.
    expect(duongTuongDoi.every((g) => g % 15 !== 0)).toBe(true);
  });

  it("chạm đúng bộ góc 0/15/30/45/90 mà §7.2 #3 yêu cầu", () => {
    expect(snapGocTuyetDoi(3, 15)).toBe(0);
    expect(snapGocTuyetDoi(8, 15)).toBe(15);
    expect(snapGocTuyetDoi(28, 15)).toBe(30);
    expect(snapGocTuyetDoi(41, 15)).toBe(45);
    expect(snapGocTuyetDoi(87, 15)).toBe(90);
  });

  it("làm tròn về bội GẦN NHẤT theo cả hai chiều", () => {
    expect(snapGocTuyetDoi(7.4, 15)).toBe(0);
    expect(snapGocTuyetDoi(7.6, 15)).toBe(15);
    expect(snapGocTuyetDoi(-8, 15)).toBe(-15);
    expect(snapGocTuyetDoi(-3, 15)).toBe(0);
  });

  it("bước <= 0 hoặc NaN trả nguyên giá trị (không sinh NaN làm máy biến mất)", () => {
    expect(snapGocTuyetDoi(8, 0)).toBe(8);
    expect(snapGocTuyetDoi(8, -15)).toBe(8);
    expect(snapGocTuyetDoi(8, Number.NaN)).toBe(8);
  });

  it("-0 chuẩn hoá về 0 để deep-equal không lệch", () => {
    expect(Object.is(snapGocTuyetDoi(-3, 15), 0)).toBe(true);
  });

  it("bước mặc định của §7.2 là 15°", () => {
    expect(BUOC_GOC_MAC_DINH_DO).toBe(15);
    expect(snapGocTuyetDoi(8, BUOC_GOC_MAC_DINH_DO)).toBe(15);
  });
});

describe("daSnapGoc — G8", () => {
  it("FALSE với góc lệch lưới (8 trên bước 15)", () => {
    expect(daSnapGoc(8, 15)).toBe(false);
  });
  it("TRUE với góc trên lưới (30 trên bước 15)", () => {
    expect(daSnapGoc(30, 15)).toBe(true);
    expect(daSnapGoc(0, 15)).toBe(true);
    expect(daSnapGoc(-45, 15)).toBe(true);
  });
  it("bước 0 = không lưới ⇒ mọi góc coi là đã snap", () => {
    expect(daSnapGoc(8, 0)).toBe(true);
  });
});

describe("chuanHoaGocDo", () => {
  it("đưa về [0, 360)", () => {
    expect(chuanHoaGocDo(0)).toBe(0);
    expect(chuanHoaGocDo(370)).toBe(10);
    expect(chuanHoaGocDo(-90)).toBe(270);
    expect(chuanHoaGocDo(360)).toBe(0);
  });
  it("NaN → 0, không lan NaN ra cảnh", () => {
    expect(chuanHoaGocDo(Number.NaN)).toBe(0);
  });
});

// ===========================================================================
// #2 — snap lưới
// ===========================================================================

describe("snapLuoi — tuyệt đối theo lưới thế giới", () => {
  it("làm tròn cả ba trục về bội của bước", () => {
    expect(snapLuoi({ x: 137, y: 249, z: -60 }, 100)).toEqual({ x: 100, y: 200, z: -100 });
  });

  it("hai vật xuất phát lệch 37 mm cùng về MỘT lưới (điều tương đối không làm được)", () => {
    const a = snapLuoi({ x: 1037, y: 0, z: 0 }, 100);
    const b = snapLuoi({ x: 1000, y: 0, z: 0 }, 100);
    expect(a.x).toBe(b.x);
  });

  it("bước mặc định 100 mm (§7.2 #2)", () => {
    expect(BUOC_LUOI_MAC_DINH_MM).toBe(100);
    expect(snapLuoi({ x: 137, y: 0, z: 0 })).toEqual({ x: 100, y: 0, z: 0 });
  });

  it("snapLuoiMatBang GIỮ NGUYÊN độ cao (máy không bị nhấc khỏi sàn)", () => {
    expect(snapLuoiMatBang({ x: 137, y: 6237, z: 60 }, 100)).toEqual({
      x: 100,
      y: 6237,
      z: 100,
    });
  });

  it("bước 0 = không snap", () => {
    expect(snapLuoi({ x: 137, y: 0, z: 0 }, 0)).toEqual({ x: 137, y: 0, z: 0 });
  });
});

describe("daSnapLuoi — G8", () => {
  it("FALSE với vị trí lệch lưới", () => {
    expect(daSnapLuoi({ x: 37, y: 0, z: 0 }, 100)).toBe(false);
  });
  it("TRUE với vị trí trên lưới", () => {
    expect(daSnapLuoi({ x: 100, y: 200, z: -300 }, 100)).toBe(true);
  });
});

describe("snapCoHieuLuc — ngữ nghĩa ĐẢO của Ctrl (G8)", () => {
  it("snap bật + KHÔNG giữ Ctrl → có hiệu lực", () => {
    expect(snapCoHieuLuc(true, false)).toBe(true);
  });
  it("snap bật + GIỮ Ctrl → THOÁT snap (đường thoát bắt buộc của §7.2 #2)", () => {
    expect(snapCoHieuLuc(true, true)).toBe(false);
  });
  it("snap tắt + giữ Ctrl → snap ngay", () => {
    expect(snapCoHieuLuc(false, true)).toBe(true);
  });
  it("snap tắt + không Ctrl → không snap", () => {
    expect(snapCoHieuLuc(false, false)).toBe(false);
  });
});

// ===========================================================================
// #6 — align
// ===========================================================================

describe("canhTheoBien — 6 hướng", () => {
  const ds = [o("a", 0, 100, 0, 50), o("b", 200, 260, 300, 340), o("c", 50, 90, 100, 200)];

  it("trái: mọi minX bằng minX của bbox bao chung", () => {
    const m = theoKhoa(canhTheoBien(ds, "trai"));
    expect([...m.values()].map((b) => b.minX)).toEqual([0, 0, 0]);
  });

  it("phải: mọi maxX bằng maxX của bao chung", () => {
    const m = theoKhoa(canhTheoBien(ds, "phai"));
    expect([...m.values()].map((b) => b.maxX)).toEqual([260, 260, 260]);
  });

  it("giữa ngang: mọi tâm X bằng nhau", () => {
    const m = theoKhoa(canhTheoBien(ds, "giua_ngang"));
    const tamX = [...m.values()].map((b) => (b.minX + b.maxX) / 2);
    expect(new Set(tamX).size).toBe(1);
    expect(tamX[0]).toBe(130); // bao chung 0..260
  });

  it("trên/dưới chạy trên trục Z (mặt bằng), KHÔNG phải trục Y/độ cao", () => {
    const m = theoKhoa(canhTheoBien(ds, "tren"));
    expect([...m.values()].map((b) => b.minZ)).toEqual([0, 0, 0]);
    // Độ cao KHÔNG đổi.
    expect([...m.values()].every((b) => b.minY === 0 && b.maxY === 1)).toBe(true);
  });

  it("dưới: mọi maxZ bằng maxZ bao chung", () => {
    const m = theoKhoa(canhTheoBien(ds, "duoi"));
    expect([...m.values()].map((b) => b.maxZ)).toEqual([340, 340, 340]);
  });

  it("giữa dọc: mọi tâm Z bằng nhau", () => {
    const m = theoKhoa(canhTheoBien(ds, "giua_doc"));
    const tamZ = [...m.values()].map((b) => (b.minZ + b.maxZ) / 2);
    expect(new Set(tamZ).size).toBe(1);
  });

  it("KHÔNG đổi kích thước vật thể (chỉ dịch)", () => {
    const m = theoKhoa(canhTheoBien(ds, "trai"));
    const a = m.get("a") as BBox;
    expect(a.maxX - a.minX).toBe(100);
  });

  it("dưới 2 vật thể → nguyên trạng, dịch bằng 0 (không làm bẩn stack undo)", () => {
    const kq = canhTheoBien([o("a", 0, 10, 0, 10)], "trai");
    expect(kq[0].bbox).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 1, minZ: 0, maxZ: 10 });
    expect(kq[0].dich).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("danh sách rỗng → rỗng", () => {
    expect(canhTheoBien([], "trai")).toEqual([]);
  });

  it("giữ NGUYÊN thứ tự đầu vào trong kết quả", () => {
    expect(canhTheoBien(ds, "trai").map((k) => k.khoa)).toEqual(["a", "b", "c"]);
  });
});

// ===========================================================================
// #6 — distribute
// ===========================================================================

describe("danDeu — khoảng TRỐNG đều nhau", () => {
  it("3 vật cùng kích thước: khoảng trống bằng nhau", () => {
    const ds = [o("a", 0, 100, 0, 10), o("b", 150, 250, 0, 10), o("c", 400, 500, 0, 10)];
    const m = theoKhoa(danDeu(ds, "X"));
    const a = m.get("a") as BBox;
    const b = m.get("b") as BBox;
    const c = m.get("c") as BBox;
    expect(b.minX - a.maxX).toBeCloseTo(c.minX - b.maxX, 9);
  });

  it("vật ĐẦU và CUỐI đứng yên làm mốc", () => {
    const ds = [o("a", 0, 100, 0, 10), o("b", 150, 250, 0, 10), o("c", 400, 500, 0, 10)];
    const m = theoKhoa(danDeu(ds, "X"));
    expect((m.get("a") as BBox).minX).toBe(0);
    expect((m.get("c") as BBox).maxX).toBe(500);
  });

  it("★ KHÁC kích thước: khoảng TRỐNG đều, tâm KHÔNG đều (khác distribute-centers)", () => {
    // ⚠ Ba vật ĐỐI XỨNG (nhỏ–to–nhỏ) KHÔNG phân biệt được hai ngữ nghĩa: với
    //   chúng, rải-đều-khe và rải-đều-tâm cho CÙNG kết quả. Phải dùng bề rộng
    //   TĂNG DẦN thì phép đo mới nói được điều gì.
    const ds = [o("a", 0, 100, 0, 10), o("b", 200, 500, 0, 10), o("c", 600, 1200, 0, 10)];
    const m = theoKhoa(danDeu(ds, "X"));
    const a = m.get("a") as BBox;
    const b = m.get("b") as BBox;
    const c = m.get("c") as BBox;
    expect(b.minX - a.maxX).toBeCloseTo(c.minX - b.maxX, 9);
    // Nếu là distribute-centers thì hai khoảng cách TÂM sẽ bằng nhau; ở đây KHÔNG.
    const tamA = (a.minX + a.maxX) / 2;
    const tamB = (b.minX + b.maxX) / 2;
    const tamC = (c.minX + c.maxX) / 2;
    expect(Math.abs(tamB - tamA - (tamC - tamB))).toBeGreaterThan(1);
  });

  it("chạy trên trục Z", () => {
    const ds = [o("a", 0, 10, 0, 100), o("b", 0, 10, 150, 250), o("c", 0, 10, 400, 500)];
    const m = theoKhoa(danDeu(ds, "Z"));
    const a = m.get("a") as BBox;
    const b = m.get("b") as BBox;
    const c = m.get("c") as BBox;
    expect(b.minZ - a.maxZ).toBeCloseTo(c.minZ - b.maxZ, 9);
  });

  it("trục Y bị TỪ CHỐI — không nhấc máy khỏi sàn", () => {
    const ds = [o("a", 0, 100, 0, 10), o("b", 150, 250, 0, 10), o("c", 400, 500, 0, 10)];
    expect(danDeu(ds, "Y").every((k) => k.dich.x === 0 && k.dich.y === 0 && k.dich.z === 0)).toBe(
      true,
    );
  });

  it("dưới 3 vật → nguyên trạng", () => {
    const ds = [o("a", 0, 100, 0, 10), o("b", 400, 500, 0, 10)];
    expect(danDeu(ds, "X").every((k) => k.dich.x === 0)).toBe(true);
  });

  it("tất định: đảo thứ tự đầu vào cho cùng vị trí kết quả", () => {
    const ds = [o("a", 0, 100, 0, 10), o("b", 150, 250, 0, 10), o("c", 400, 500, 0, 10)];
    const xuoi = theoKhoa(danDeu(ds, "X"));
    const nguoc = theoKhoa(danDeu([...ds].reverse(), "X"));
    for (const k of ["a", "b", "c"]) expect(nguoc.get(k)).toEqual(xuoi.get(k));
  });
});

// ===========================================================================
// #11 — nhân bản
// ===========================================================================

describe("nhanBanTuyenTinh", () => {
  const goc: BBox = { minX: 0, maxX: 1000, minY: 0, maxY: 1800, minZ: 0, maxZ: 800 };

  it("sinh đúng soLuong bản, KHÔNG gồm bản gốc", () => {
    const ds = nhanBanTuyenTinh(goc, "X", 2000, 3);
    expect(ds.length).toBe(3);
    expect(ds[0].minX).toBe(2000);
    expect(ds[1].minX).toBe(4000);
    expect(ds[2].minX).toBe(6000);
  });

  it("bản sao KHÔNG chồng lấn khi bước > bề rộng", () => {
    const ds = [goc, ...nhanBanTuyenTinh(goc, "X", 2000, 4)];
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        expect(bboxGiaoNhauTrenSan(ds[i], ds[j])).toBe(false);
      }
    }
  });

  it("chạy trên cả ba trục", () => {
    expect(nhanBanTuyenTinh(goc, "Z", 1000, 1)[0].minZ).toBe(1000);
    expect(nhanBanTuyenTinh(goc, "Y", 1000, 1)[0].minY).toBe(1000);
  });

  it("soLuong <= 0 → rỗng", () => {
    expect(nhanBanTuyenTinh(goc, "X", 2000, 0)).toEqual([]);
    expect(nhanBanTuyenTinh(goc, "X", 2000, -5)).toEqual([]);
  });

  it("soLuong quá lớn bị KẸP, không ném lỗi, không treo trình duyệt", () => {
    expect(nhanBanTuyenTinh(goc, "X", 100, 100_000).length).toBe(SO_LUONG_NHAN_BAN_TOI_DA);
  });

  it("số lẻ bị làm tròn xuống (2.9 bản là 2 bản)", () => {
    expect(nhanBanTuyenTinh(goc, "X", 100, 2.9).length).toBe(2);
  });
});

describe("buocNhanBanHopLe — G8", () => {
  it("FALSE với bước 0 (N bản chồng khít = nhìn như không có gì xảy ra)", () => {
    expect(buocNhanBanHopLe(0)).toBe(false);
  });
  it("FALSE với NaN", () => {
    expect(buocNhanBanHopLe(Number.NaN)).toBe(false);
  });
  it("TRUE với bước thật", () => {
    expect(buocNhanBanHopLe(1400)).toBe(true);
    expect(buocNhanBanHopLe(-1400)).toBe(true);
  });
});

describe("nhanBanToaTron", () => {
  const goc: BBox = { minX: 900, maxX: 1100, minY: 0, maxY: 100, minZ: -100, maxZ: 100 };
  const tam = { x: 0, y: 0, z: 0 };

  it("4 bản cách 90° quay quanh tâm — tâm bản sau đúng vị trí hình học", () => {
    const ds = nhanBanToaTron(goc, tam, 90, 3);
    expect(ds.length).toBe(3);
    // Gốc ở x=1000, z=0. Quay 90° quanh Y → x=0, z=1000.
    const t0 = { x: (ds[0].bbox.minX + ds[0].bbox.maxX) / 2, z: (ds[0].bbox.minZ + ds[0].bbox.maxZ) / 2 };
    expect(t0.x).toBeCloseTo(0, 6);
    expect(t0.z).toBeCloseTo(1000, 6);
    // 180° → x = -1000.
    const t1 = { x: (ds[1].bbox.minX + ds[1].bbox.maxX) / 2 };
    expect(t1.x).toBeCloseTo(-1000, 6);
  });

  it("trả kèm GÓC để nơi gọi ghi quaternion (không mất hướng bản sao)", () => {
    expect(nhanBanToaTron(goc, tam, 90, 4).map((b) => b.gocDo)).toEqual([90, 180, 270, 0]);
  });

  it("giữ nguyên KÍCH THƯỚC gốc (bbox xem trước, không phải bbox va chạm)", () => {
    const b = nhanBanToaTron(goc, tam, 90, 1)[0].bbox;
    expect(b.maxX - b.minX).toBeCloseTo(200, 9);
    expect(b.maxZ - b.minZ).toBeCloseTo(200, 9);
  });

  it("soLuong <= 0 → rỗng; kẹp trần như tuyến tính", () => {
    expect(nhanBanToaTron(goc, tam, 90, 0)).toEqual([]);
    expect(nhanBanToaTron(goc, tam, 1, 99_999).length).toBe(SO_LUONG_NHAN_BAN_TOI_DA);
  });
});

// ===========================================================================
// #12 — đo khoảng cách
// ===========================================================================

describe("doKhoangCach", () => {
  it("3-4-5 trong mặt phẳng", () => {
    expect(doKhoangCach({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 })).toBe(5);
  });
  it("tính cả độ cao", () => {
    expect(doKhoangCach({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 4 })).toBe(5);
  });
  it("hai điểm trùng → 0", () => {
    expect(doKhoangCach({ x: 7, y: 7, z: 7 }, { x: 7, y: 7, z: 7 })).toBe(0);
  });
});

describe("doKhoangCachMatBang — bỏ độ cao", () => {
  it("khác độ cao KHÔNG làm tăng khoảng cách đi bộ", () => {
    expect(doKhoangCachMatBang({ x: 0, y: 0, z: 0 }, { x: 3, y: 9999, z: 4 })).toBe(5);
  });
  it("khác doKhoangCach trên đúng ca đó (hai phép đo không đồng nhất)", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 3, y: 12, z: 4 };
    expect(doKhoangCachMatBang(a, b)).toBe(5);
    expect(doKhoangCach(a, b)).toBe(13);
  });
});

describe("doKheHoMatBang", () => {
  it("hai bbox cách nhau đúng khe hở", () => {
    const a: BBox = { minX: 0, maxX: 100, minY: 0, maxY: 10, minZ: 0, maxZ: 100 };
    const b: BBox = { minX: 400, maxX: 500, minY: 0, maxY: 10, minZ: 0, maxZ: 100 };
    expect(doKheHoMatBang(a, b)).toBe(300);
  });
  it("chồng lấn → 0, KHÔNG trả số âm", () => {
    const a: BBox = { minX: 0, maxX: 100, minY: 0, maxY: 10, minZ: 0, maxZ: 100 };
    const b: BBox = { minX: 50, maxX: 150, minY: 0, maxY: 10, minZ: 50, maxZ: 150 };
    expect(doKheHoMatBang(a, b)).toBe(0);
  });
  it("chạm mép → 0", () => {
    const a: BBox = { minX: 0, maxX: 100, minY: 0, maxY: 10, minZ: 0, maxZ: 100 };
    const b: BBox = { minX: 100, maxX: 200, minY: 0, maxY: 10, minZ: 0, maxZ: 100 };
    expect(doKheHoMatBang(a, b)).toBe(0);
  });
  it("lệch chéo → khoảng cách góc-góc", () => {
    const a: BBox = { minX: 0, maxX: 100, minY: 0, maxY: 10, minZ: 0, maxZ: 100 };
    const b: BBox = { minX: 400, maxX: 500, minY: 0, maxY: 10, minZ: 500, maxZ: 600 };
    expect(doKheHoMatBang(a, b)).toBe(500);
  });
});

// ===========================================================================
// #4 — nudge
// ===========================================================================

describe("nudge", () => {
  const goc = { x: 1000, y: 500, z: 2000 };

  it("trái/phải chạy trên trục X", () => {
    expect(nudge(goc, "trai", 10).x).toBe(990);
    expect(nudge(goc, "phai", 10).x).toBe(1010);
  });

  it("trên/dưới chạy trên trục Z (mặt bằng), KHÔNG phải độ cao", () => {
    expect(nudge(goc, "tren", 10)).toEqual({ x: 1000, y: 500, z: 1990 });
    expect(nudge(goc, "duoi", 10)).toEqual({ x: 1000, y: 500, z: 2010 });
  });

  it("lên/xuống chạy trên độ cao Y", () => {
    expect(nudge(goc, "len", 10).y).toBe(510);
    expect(nudge(goc, "xuong", 10).y).toBe(490);
  });

  it("chỉ đổi ĐÚNG MỘT trục mỗi lần", () => {
    const kq = nudge(goc, "trai", 10);
    expect(kq.y).toBe(goc.y);
    expect(kq.z).toBe(goc.z);
  });

  it("bước mặc định 10 mm; Shift 100 mm (§7.2 #4)", () => {
    expect(BUOC_NUDGE_MM).toBe(10);
    expect(BUOC_NUDGE_LON_MM).toBe(100);
    expect(buocNudgeCho(false)).toBe(10);
    expect(buocNudgeCho(true)).toBe(100);
    expect(nudge(goc, "phai").x).toBe(1010);
  });

  it("NaN không lan ra vị trí", () => {
    expect(nudge(goc, "phai", Number.NaN).x).toBe(1000);
  });
});

describe("dichBBox", () => {
  it("dịch cả 6 mặt", () => {
    const b: BBox = { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 };
    expect(dichBBox(b, { x: 5, y: -2, z: 100 })).toEqual({
      minX: 5,
      maxX: 15,
      minY: -2,
      maxY: 8,
      minZ: 100,
      maxZ: 110,
    });
  });
});
