/**
 * phamViLine.unit.test.ts — Line là PHẠM VI (§10C.1, QĐ-14) + 3 công cụ §10C.4.
 * ★ Tên tệp `.unit.test.ts` bắt buộc (luật G3).
 */

import { describe, expect, it } from "vitest";
import {
  BUOC_RAI_TRAM_MAC_DINH_MM,
  type ViTriDaDat,
  coTramThieuThuTu,
  doiHuongLine,
  fitDuongThang,
  hinhHocLine,
  huongDongChay,
  nanThangLine,
  phuongSai,
  raiTramDocLine,
  sapTramTheoThuTu,
  trucChinh,
} from "./phamViLine";

/** Một trạm tại (x, z) với orderIndex. Kích thước 1×1×1 để bbox có thực. */
function tram(id: number, x: number, z: number, thuTu: number | null): ViTriDaDat {
  return {
    khoa: `station:${id}`,
    tam: { x, y: 0, z },
    co: { rong: 1, cao: 1, sau: 1 },
    thuTu,
  };
}

function may(id: number, x: number, z: number): ViTriDaDat {
  return {
    khoa: `machine:${id}`,
    tam: { x, y: 0, z },
    co: { rong: 1, cao: 1, sau: 1 },
  };
}

/** 12 trạm rải dọc trục X, bước 2.5 m — hình dạng của SIM-L1 (§10C.0). */
function lineDoc12(): ViTriDaDat[] {
  return Array.from({ length: 12 }, (_, i) => tram(i + 1, i * 2.5, 0, i + 1));
}

describe("hinhHocLine — bao lồi", () => {
  it("bbox bao MỌI trạm và máy của line", () => {
    const h = hinhHocLine([tram(1, 0, 0, 1), tram(2, 10, 0, 2)], [may(1, 5, 4)]);
    expect(h.bbox.minX).toBeCloseTo(-0.5, 9);
    expect(h.bbox.maxX).toBeCloseTo(10.5, 9);
    expect(h.bbox.minZ).toBeCloseTo(-0.5, 9);
    expect(h.bbox.maxZ).toBeCloseTo(4.5, 9);
  });

  it("máy nằm NGOÀI dải trạm vẫn kéo bbox ra (bao lồi, không phải bao trạm)", () => {
    const chiTram = hinhHocLine([tram(1, 0, 0, 1), tram(2, 10, 0, 2)], []);
    const coMay = hinhHocLine([tram(1, 0, 0, 1), tram(2, 10, 0, 2)], [may(9, 30, 0)]);
    expect(coMay.bbox.maxX).toBeGreaterThan(chiTram.bbox.maxX);
  });

  it("Line rỗng: bbox rỗng, coHinhHoc=false, KHÔNG ném lỗi", () => {
    const h = hinhHocLine([], []);
    expect(h.coHinhHoc).toBe(false);
    expect(h.diemDuongTam).toEqual([]);
  });

  it("coHinhHoc — G8, TRUE với một trạm bất kỳ có toạ độ", () => {
    expect(hinhHocLine([tram(1, 5, 5, 1)], []).coHinhHoc).toBe(true);
  });
});

describe("trục chính — từ PHƯƠNG SAI lớn hơn", () => {
  it("Line DỌC trục X → truc = 'X'", () => {
    const h = hinhHocLine(lineDoc12(), []);
    expect(h.truc).toBe("X");
    expect(h.trucDangTin).toBe(true);
  });

  it("Line DỌC trục Z → truc = 'Z'", () => {
    const ngang = Array.from({ length: 12 }, (_, i) => tram(i + 1, 0, i * 2.5, i + 1));
    const h = hinhHocLine(ngang, []);
    expect(h.truc).toBe("Z");
    expect(h.trucDangTin).toBe(true);
  });

  it("★ một trạm LẠC CHỖ không lật được kết luận của 11 trạm còn lại", () => {
    const ds = lineDoc12();
    // Lệch 8 m khỏi một Line dài 27,5 m — một trạm bị kéo nhầm, không phải một
    // trạm ở nhà máy khác. (Phương sai đo được: psX = 74,5 · psZ = 4,9.)
    ds[5] = tram(6, 12.5, 8, 6);
    expect(hinhHocLine(ds, []).truc).toBe("X");
  });

  it("trucDangTin — G8, FALSE khi chỉ có 1 trạm (không có phương sai để so)", () => {
    const h = hinhHocLine([tram(1, 5, 5, 1)], []);
    expect(h.trucDangTin).toBe(false);
    expect(h.truc).toBe("X"); // mặc định, nhưng đã tự khai là không đáng tin
  });

  it("trucDangTin — G8, FALSE khi phương sai hai trục BẰNG NHAU (chéo 45°)", () => {
    const cheo = [tram(1, 0, 0, 1), tram(2, 10, 10, 2), tram(3, 20, 20, 3)];
    expect(hinhHocLine(cheo, []).trucDangTin).toBe(false);
  });

  it("trucChinh trên danh sách rỗng không ném", () => {
    expect(trucChinh([]).dangTin).toBe(false);
  });
});

describe("phuongSai", () => {
  it("dãy hằng số → 0", () => {
    expect(phuongSai([5, 5, 5, 5])).toBe(0);
  });
  it("dãy < 2 phần tử → 0", () => {
    expect(phuongSai([])).toBe(0);
    expect(phuongSai([7])).toBe(0);
  });
  it("giá trị đã biết: [0,2,4] → 8/3", () => {
    expect(phuongSai([0, 2, 4])).toBeCloseTo(8 / 3, 9);
  });
});

describe("hướng dòng chảy — từ orderIndex", () => {
  it("orderIndex tăng theo chiều X tăng → huong = 1", () => {
    expect(hinhHocLine(lineDoc12(), []).huong).toBe(1);
  });

  it("★ ĐẢO orderIndex → huong ĐẢO thành -1", () => {
    const dao = Array.from({ length: 12 }, (_, i) => tram(i + 1, i * 2.5, 0, 12 - i));
    expect(hinhHocLine(dao, []).huong).toBe(-1);
  });

  it("★ so TRẠM ĐẦU với TRẠM CUỐI, không so hai trạm liền kề", () => {
    // 12 trạm xuôi, nhưng trạm 6 và 7 bị kéo lệch NGƯỢC nhau.
    const ds = lineDoc12();
    ds[5] = tram(6, 20, 0, 6);
    ds[6] = tram(7, 12, 0, 7);
    // Một cặp liền kề đi ngược KHÔNG được lật cả mũi tên của Line.
    expect(hinhHocLine(ds, []).huong).toBe(1);
  });

  it("dưới 2 trạm → huong mặc định 1", () => {
    expect(huongDongChay([tram(1, 0, 0, 1)], "X")).toBe(1);
    expect(huongDongChay([], "X")).toBe(1);
  });
});

describe("đường tâm — nối tâm trạm theo orderIndex", () => {
  it("đúng số điểm và ĐÚNG thứ tự orderIndex, không phải thứ tự đầu vào", () => {
    const xaoTron = [tram(3, 5, 0, 3), tram(1, 0, 0, 1), tram(2, 2.5, 0, 2)];
    const h = hinhHocLine(xaoTron, []);
    expect(h.diemDuongTam.map((d) => d.x)).toEqual([0, 2.5, 5]);
  });

  it("KHÔNG gồm máy — máy chỉ nhân bản vị trí trạm", () => {
    const h = hinhHocLine([tram(1, 0, 0, 1), tram(2, 10, 0, 2)], [may(1, 5, 9)]);
    expect(h.diemDuongTam.length).toBe(2);
  });

  it("tất định: đảo thứ tự đầu vào cho cùng đường tâm", () => {
    const ds = lineDoc12();
    expect(hinhHocLine([...ds].reverse(), []).diemDuongTam).toEqual(
      hinhHocLine(ds, []).diemDuongTam,
    );
  });
});

describe("sapTramTheoThuTu", () => {
  it("trạm thiếu thuTu xuống CUỐI, không bị loại", () => {
    const ds = [tram(1, 0, 0, 2), tram(2, 0, 0, null), tram(3, 0, 0, 1)];
    expect(sapTramTheoThuTu(ds).map((t) => t.khoa)).toEqual([
      "station:3",
      "station:1",
      "station:2",
    ]);
  });

  it("hoà thuTu → phá hoà bằng khoá (tất định)", () => {
    const ds = [tram(9, 0, 0, 1), tram(2, 0, 0, 1)];
    const a = sapTramTheoThuTu(ds).map((t) => t.khoa);
    const b = sapTramTheoThuTu([...ds].reverse()).map((t) => t.khoa);
    expect(a).toEqual(b);
  });

  it("KHÔNG đột biến mảng đầu vào", () => {
    const ds = [tram(1, 0, 0, 2), tram(2, 0, 0, 1)];
    sapTramTheoThuTu(ds);
    expect(ds[0].khoa).toBe("station:1");
  });
});

describe("coTramThieuThuTu — G8", () => {
  it("FALSE với dữ liệu thật của repo (37/37 trạm có orderIndex, §10C.0)", () => {
    expect(coTramThieuThuTu(lineDoc12())).toBe(false);
  });
  it("TRUE khi có ít nhất một trạm thiếu", () => {
    const ds = lineDoc12();
    ds[3] = tram(4, 7.5, 0, null);
    expect(coTramThieuThuTu(ds)).toBe(true);
  });
});

// ===========================================================================
// §10C.4 — ba công cụ Line
// ===========================================================================

describe("raiTramDocLine (§10C.4)", () => {
  it("xếp lại trạm cách đều theo bước, theo orderIndex", () => {
    const lech = [tram(1, 0, 0, 1), tram(2, 7, 0, 2), tram(3, 9, 0, 3)];
    const kq = raiTramDocLine(lech, { truc: "X", huong: 1 }, 2.5);
    expect(kq.map((k) => k.tam.x)).toEqual([0, 2.5, 5]);
  });

  it("trạm ĐẦU theo orderIndex đứng yên làm mốc", () => {
    const lech = [tram(1, 100, 0, 1), tram(2, 107, 0, 2)];
    expect(raiTramDocLine(lech, { truc: "X", huong: 1 }, 2.5)[0].tam.x).toBe(100);
  });

  it("huong = -1 rải về phía ngược lại", () => {
    const kq = raiTramDocLine(
      [tram(1, 0, 0, 1), tram(2, 7, 0, 2)],
      { truc: "X", huong: -1 },
      2.5,
    );
    expect(kq.map((k) => k.tam.x)).toEqual([0, -2.5]);
  });

  it("Line dọc trục Z rải theo Z, giữ nguyên X", () => {
    const kq = raiTramDocLine(
      [tram(1, 5, 0, 1), tram(2, 5, 9, 2)],
      { truc: "Z", huong: 1 },
      2.5,
    );
    expect(kq.map((k) => k.tam.z)).toEqual([0, 2.5]);
    expect(kq.every((k) => k.tam.x === 5)).toBe(true);
  });

  it("giữ nguyên toạ độ trục PHỤ (không tự tiện nắn thẳng)", () => {
    const lech = [tram(1, 0, 0, 1), tram(2, 7, 3, 2)];
    expect(raiTramDocLine(lech, { truc: "X", huong: 1 }, 2.5)[1].tam.z).toBe(3);
  });

  it("trả CẢ trạm không đổi vị trí (lệnh undo cần trạng thái đầy đủ)", () => {
    const kq = raiTramDocLine([tram(1, 0, 0, 1), tram(2, 2.5, 0, 2)], { truc: "X", huong: 1 }, 2.5);
    expect(kq.length).toBe(2);
  });

  it("bước mặc định của §10C.4 là 2.500 mm", () => {
    expect(BUOC_RAI_TRAM_MAC_DINH_MM).toBe(2500);
  });

  it("danh sách rỗng → rỗng", () => {
    expect(raiTramDocLine([], { truc: "X", huong: 1 }, 2.5)).toEqual([]);
  });

  it("★ trạm rải xong KHÔNG chồng nhau khi bước > bề rộng trạm", () => {
    const kq = raiTramDocLine(lineDoc12(), { truc: "X", huong: 1 }, 2.5);
    const xs = kq.map((k) => k.tam.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(2.5, 9);
  });
});

describe("nanThangLine (§10C.4)", () => {
  it("trạm đã thẳng → không đổi", () => {
    const thang = lineDoc12();
    const kq = nanThangLine(thang);
    kq.forEach((k, i) => {
      expect(k.tam.x).toBeCloseTo(thang[i].tam.x, 9);
      expect(k.tam.z).toBeCloseTo(0, 9);
    });
  });

  it("★ trạm lệch được CHIẾU về THẲNG HÀNG (đo bằng độ cong, không bằng z=0)", () => {
    // ⚠ Đường fit KHÔNG nhất thiết nằm ngang: với ba điểm này nó nghiêng nhẹ
    //   (vector chỉ phương đo được −0,999798 / 0,020092) nên z sau khi chiếu là
    //   ±0,1 chứ không phải 0. Đòi "mọi z = 0" là đo SAI THỨ — tính chất thật
    //   của nắn thẳng là ba điểm THẲNG HÀNG, đo bằng diện tích tam giác chúng
    //   tạo ra (0 khi thẳng hàng), một phép đo không phụ thuộc hướng đường.
    const lech = [tram(1, 0, 0.3, 1), tram(2, 5, -0.4, 2), tram(3, 10, 0.1, 3)];
    const truocKhiNan = Math.abs(
      (5 - 0) * (0.1 - 0.3) - (10 - 0) * (-0.4 - 0.3),
    );
    expect(truocKhiNan).toBeGreaterThan(1); // ba điểm ban đầu KHÔNG thẳng hàng

    const kq = nanThangLine(lech);
    const [a, b, c] = kq.map((k) => k.tam);
    const dienTich = Math.abs(
      (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z),
    );
    expect(dienTich).toBeLessThan(1e-9);
  });

  it("★ Line THẲNG ĐỨNG dọc trục Z không vỡ (hồi quy z-theo-x sẽ vô hạn)", () => {
    const doc = [tram(1, 0.3, 0, 1), tram(2, -0.2, 5, 2), tram(3, 0.1, 10, 3)];
    const kq = nanThangLine(doc);
    for (const k of kq) {
      expect(Number.isFinite(k.tam.x)).toBe(true);
      expect(Number.isFinite(k.tam.z)).toBe(true);
      // Hồi quy z-theo-x cho hệ số VÔ HẠN ở hình dạng này; total least squares
      // thì không — bằng chứng là toạ độ hữu hạn và bám sát trục (|x| < 0,5 m).
      expect(Math.abs(k.tam.x)).toBeLessThan(0.5);
    }
    const [a, b, c] = kq.map((k) => k.tam);
    const dienTich = Math.abs(
      (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z),
    );
    expect(dienTich).toBeLessThan(1e-9);
  });

  it("giữ nguyên ĐỘ CAO từng trạm", () => {
    const ds: ViTriDaDat[] = [
      { khoa: "s1", tam: { x: 0, y: 3, z: 1 }, thuTu: 1 },
      { khoa: "s2", tam: { x: 10, y: 7, z: -1 }, thuTu: 2 },
    ];
    const kq = nanThangLine(ds);
    expect(kq.map((k) => k.tam.y)).toEqual([3, 7]);
  });

  it("KHÔNG đảo thứ tự trạm dọc đường (phép chiếu bảo toàn thứ tự)", () => {
    const lech = [tram(1, 0, 0.5, 1), tram(2, 5, -0.5, 2), tram(3, 10, 0.5, 3)];
    const kq = nanThangLine(lech);
    expect(kq[0].tam.x).toBeLessThan(kq[1].tam.x);
    expect(kq[1].tam.x).toBeLessThan(kq[2].tam.x);
  });

  it("rỗng → rỗng; một trạm → đứng yên", () => {
    expect(nanThangLine([])).toEqual([]);
    expect(nanThangLine([tram(1, 7, 9, 1)])[0].tam).toEqual({ x: 7, y: 0, z: 9 });
  });

  it("fitDuongThang trả vector chỉ phương ĐÃ chuẩn hoá, y = 0", () => {
    const d = fitDuongThang(lineDoc12());
    const dai = Math.sqrt(d.huongVector.x ** 2 + d.huongVector.z ** 2);
    expect(dai).toBeCloseTo(1, 9);
    expect(d.huongVector.y).toBe(0);
  });

  it("fitDuongThang trên đám điểm đẳng hướng không sinh NaN", () => {
    const vuong = [tram(1, 0, 0, 1), tram(2, 10, 0, 2), tram(3, 0, 10, 3), tram(4, 10, 10, 4)];
    const d = fitDuongThang(vuong);
    expect(Number.isFinite(d.huongVector.x)).toBe(true);
    expect(Number.isFinite(d.huongVector.z)).toBe(true);
  });
});

describe("doiHuongLine (§10C.4)", () => {
  it("xoay 180° quanh tâm: trạm đầu và cuối ĐỔI CHỖ", () => {
    const ds = [tram(1, 0, 0, 1), tram(2, 10, 0, 2)];
    const kq = doiHuongLine(ds, 180);
    expect(kq[0].tam.x).toBeCloseTo(10, 9);
    expect(kq[1].tam.x).toBeCloseTo(0, 9);
  });

  it("xoay 90°: Line dọc X thành Line dọc Z", () => {
    const kq = doiHuongLine(lineDoc12(), 90);
    const xs = kq.map((k) => k.tam.x);
    const zs = kq.map((k) => k.tam.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(27.5, 6);
  });

  it("giữ nguyên THỨ TỰ trạm trong mảng kết quả (khoá không đổi chỗ)", () => {
    const ds = lineDoc12();
    expect(doiHuongLine(ds, 90).map((k) => k.khoa)).toEqual(ds.map((d) => d.khoa));
  });

  it("360° đưa về đúng chỗ cũ", () => {
    const ds = lineDoc12();
    const kq = doiHuongLine(ds, 360);
    kq.forEach((k, i) => {
      expect(k.tam.x).toBeCloseTo(ds[i].tam.x, 9);
      expect(k.tam.z).toBeCloseTo(ds[i].tam.z, 9);
    });
  });

  it("giữ nguyên độ cao", () => {
    const ds: ViTriDaDat[] = [
      { khoa: "s1", tam: { x: 0, y: 3, z: 0 }, thuTu: 1 },
      { khoa: "s2", tam: { x: 10, y: 3, z: 0 }, thuTu: 2 },
    ];
    expect(doiHuongLine(ds, 90).every((k) => k.tam.y === 3)).toBe(true);
  });

  it("KHÔNG đổi khoảng cách giữa các trạm (phép xoay bảo toàn độ dài)", () => {
    const ds = lineDoc12();
    const kq = doiHuongLine(ds, 37);
    const cach = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
    expect(cach(kq[0].tam, kq[11].tam)).toBeCloseTo(cach(ds[0].tam, ds[11].tam), 9);
  });

  it("rỗng → rỗng; NaN không lan ra toạ độ", () => {
    expect(doiHuongLine([], 90)).toEqual([]);
    const kq = doiHuongLine([tram(1, 5, 5, 1)], Number.NaN);
    expect(Number.isFinite(kq[0].tam.x)).toBe(true);
  });
});
