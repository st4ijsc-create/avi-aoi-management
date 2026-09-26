/**
 * vungAnToan.unit.test.ts — vùng 3D translucent + nhãn (§11.1 #5) và CRUD vùng
 * an toàn (§11.7 #42).
 *
 * ★★★ G20 — import `./vungAnToan`, module giao hàng.
 * ★★★ G5  — Đợt 7 đo được `twin_vat_the` có **0 hàng `loai='vung'`**, nên MỌI
 *   ca dương ở đây do test tự dựng. Không một test nào dựa vào dữ liệu có sẵn.
 * ★★★ BẪY HOÁN VỊ TRỤC — `diemDa` là `[xMm, yMm]` MẶT BẰNG; `yMm` phải thành
 *   `scene.z`, KHÔNG thành độ cao. Có test riêng và có ĐỐI CHỨNG.
 */

import { describe, expect, it } from "vitest";

import {
  DAY_VUNG_MAC_DINH_MM,
  DO_MO_VUNG,
  DO_MO_VUNG_CHON,
  MAU_VUNG_MAC_DINH,
  NHAC_KHOI_SAN_M,
  SO_DINH_TOI_DA,
  bboxPolygonMm,
  dienTichCoDauMm2,
  dienTichM2,
  diemDatNhan,
  diemTrongPolygon,
  docDiemDa,
  dungVungGhi,
  polygonHopLe,
  trongTam,
  vungTuDanhSach,
  vungTuHang,
  type HangVung,
} from "./vungAnToan";

/** Vuông 4 × 4 m ở góc (2 m, 3 m) — mm. */
const VUONG: [number, number][] = [
  [2000, 3000],
  [6000, 3000],
  [6000, 7000],
  [2000, 7000],
];

function hang(p: Partial<HangVung> = {}): HangVung {
  return {
    id: 900,
    ten: "Vùng an toàn robot",
    diemDa: VUONG,
    viTriZMm: 0,
    caoMm: 50,
    mau: "#ef4444",
    hienThi: true,
    ...p,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */

describe("polygonHopLe — G8: liệt kê đầu vào làm nó trả FALSE", () => {
  const dinh = (p: [number, number][]) => p.map(([xMm, yMm]) => ({ xMm, yMm }));

  it("vuông 4 đỉnh ⇒ true (CA DƯƠNG)", () => {
    expect(polygonHopLe(dinh(VUONG))).toBe(true);
  });

  it("null / undefined / rỗng ⇒ false", () => {
    expect(polygonHopLe(null)).toBe(false);
    expect(polygonHopLe(undefined)).toBe(false);
    expect(polygonHopLe([])).toBe(false);
  });

  it("2 đỉnh ⇒ false (không có diện tích)", () => {
    expect(polygonHopLe(dinh([[0, 0], [100, 0]]))).toBe(false);
  });

  it("★ 3 đỉnh THẲNG HÀNG ⇒ false — đủ số đỉnh nhưng diện tích 0", () => {
    expect(polygonHopLe(dinh([[0, 0], [100, 0], [200, 0]]))).toBe(false);
  });

  it("toạ độ NaN / Infinity ⇒ false", () => {
    expect(polygonHopLe(dinh([[0, 0], [100, 0], [Number.NaN, 50]]))).toBe(false);
    expect(polygonHopLe(dinh([[0, 0], [100, 0], [Number.POSITIVE_INFINITY, 50]]))).toBe(false);
  });

  it(`★ quá ${SO_DINH_TOI_DA} đỉnh ⇒ false`, () => {
    const nhieu = Array.from({ length: SO_DINH_TOI_DA + 1 }, (_, i) => ({
      xMm: Math.cos((i / 201) * Math.PI * 2) * 1000,
      yMm: Math.sin((i / 201) * Math.PI * 2) * 1000,
    }));
    expect(polygonHopLe(nhieu)).toBe(false);
    expect(polygonHopLe(nhieu.slice(0, SO_DINH_TOI_DA))).toBe(true);
  });
});

describe("dienTich", () => {
  const dinh = VUONG.map(([xMm, yMm]) => ({ xMm, yMm }));

  it("vuông 4 × 4 m = 16 m²", () => {
    expect(dienTichM2(dinh)).toBeCloseTo(16, 9);
  });

  it("★ diện tích CÓ DẤU đổi dấu khi đảo chiều quay — dấu mang thông tin", () => {
    const xuoi = dienTichCoDauMm2(dinh);
    const nguoc = dienTichCoDauMm2([...dinh].reverse());
    expect(Math.sign(xuoi)).toBe(-Math.sign(nguoc));
    expect(Math.abs(xuoi)).toBeCloseTo(Math.abs(nguoc), 6);
  });

  it("diện tích m² luôn không âm dù chiều quay nào", () => {
    expect(dienTichM2([...dinh].reverse())).toBeCloseTo(16, 9);
  });
});

describe("trongTam — nhãn phải nằm TRONG vùng", () => {
  it("vuông ⇒ tâm hình học", () => {
    const t = trongTam(VUONG.map(([xMm, yMm]) => ({ xMm, yMm })));
    expect(t.xMm).toBeCloseTo(4000, 6);
    expect(t.yMm).toBeCloseTo(5000, 6);
  });

  it("★ BẤT BIẾN với mật độ đỉnh — chia đôi một cạnh KHÔNG dời trọng tâm", () => {
    const d = VUONG.map(([xMm, yMm]) => ({ xMm, yMm }));
    // Cùng hình dạng, thêm một đỉnh giữa cạnh dưới.
    const dayHon = [d[0], { xMm: 4000, yMm: 3000 }, d[1], d[2], d[3]];
    const a = trongTam(d);
    const b = trongTam(dayHon);
    expect(b.xMm).toBeCloseTo(a.xMm, 6);
    expect(b.yMm).toBeCloseTo(a.yMm, 6);

    // ĐỐI CHỨNG: trung bình ĐỈNH thì DỜI, dù hình dạng y hệt.
    const tb = (p: typeof d) => p.reduce((s, q) => s + q.yMm, 0) / p.length;
    expect(tb(dayHon)).not.toBeCloseTo(tb(d), 3);
  });

  it("★ chiều quay NGƯỢC vẫn cho cùng trọng tâm (không lật sang phía đối diện)", () => {
    const d = VUONG.map(([xMm, yMm]) => ({ xMm, yMm }));
    const a = trongTam(d);
    const b = trongTam([...d].reverse());
    expect(b.xMm).toBeCloseTo(a.xMm, 6);
    expect(b.yMm).toBeCloseTo(a.yMm, 6);
  });

  it("polygon suy biến ⇒ trung bình đỉnh, không NaN", () => {
    const t = trongTam([{ xMm: 0, yMm: 0 }, { xMm: 100, yMm: 0 }, { xMm: 200, yMm: 0 }]);
    expect(Number.isFinite(t.xMm)).toBe(true);
    expect(t.xMm).toBeCloseTo(100, 9);
  });

  it("rỗng ⇒ gốc, không NaN", () => {
    expect(trongTam([])).toEqual({ xMm: 0, yMm: 0 });
  });
});

describe("diemDatNhan — BẢO ĐẢM nhãn nằm TRONG vùng", () => {
  /** Chữ L đo được là ca HỎNG của trọng tâm diện tích (xem docblock `trongTam`). */
  const L: { xMm: number; yMm: number }[] = [
    { xMm: 0, yMm: 0 },
    { xMm: 12000, yMm: 0 },
    { xMm: 12000, yMm: 4000 },
    { xMm: 3000, yMm: 4000 },
    { xMm: 3000, yMm: 12000 },
    { xMm: 0, yMm: 12000 },
  ];

  it("★★★ CA ĐỐI CHỨNG — trên chữ L này, `trongTam` rơi RA NGOÀI vùng", () => {
    const tt = trongTam(L);
    expect(tt.xMm).toBeCloseTo(4500, 0);
    expect(tt.yMm).toBeCloseTo(4000, 0);
    // Đây chính là lý do `diemDatNhan` tồn tại. Nếu dòng này thành `true`
    // (đổi hình L chẳng hạn), test dưới không còn chứng minh gì.
    expect(diemTrongPolygon(tt, L)).toBe(false);
  });

  it("★★★ `diemDatNhan` trên CÙNG chữ L đó rơi VÀO TRONG vùng", () => {
    expect(diemTrongPolygon(diemDatNhan(L), L)).toBe(true);
  });

  it("★ vùng LỒI: dùng thẳng trọng tâm — không đi đường vòng vô cớ", () => {
    const d = VUONG.map(([xMm, yMm]) => ({ xMm, yMm }));
    expect(diemDatNhan(d)).toEqual(trongTam(d));
  });

  it("★ nhiều hình lõm khác nhau đều cho nhãn NẰM TRONG", () => {
    const chuU: { xMm: number; yMm: number }[] = [
      { xMm: 0, yMm: 0 },
      { xMm: 9000, yMm: 0 },
      { xMm: 9000, yMm: 9000 },
      { xMm: 6000, yMm: 9000 },
      { xMm: 6000, yMm: 3000 },
      { xMm: 3000, yMm: 3000 },
      { xMm: 3000, yMm: 9000 },
      { xMm: 0, yMm: 9000 },
    ];
    const chuT: { xMm: number; yMm: number }[] = [
      { xMm: 0, yMm: 0 },
      { xMm: 12000, yMm: 0 },
      { xMm: 12000, yMm: 3000 },
      { xMm: 7500, yMm: 3000 },
      { xMm: 7500, yMm: 10000 },
      { xMm: 4500, yMm: 10000 },
      { xMm: 4500, yMm: 3000 },
      { xMm: 0, yMm: 3000 },
    ];
    for (const p of [L, chuU, chuT]) {
      expect(diemTrongPolygon(diemDatNhan(p), p)).toBe(true);
    }
  });

  it("polygon suy biến ⇒ rơi về trọng tâm, không NaN", () => {
    const thang = [{ xMm: 0, yMm: 0 }, { xMm: 100, yMm: 0 }, { xMm: 200, yMm: 0 }];
    const p = diemDatNhan(thang);
    expect(Number.isFinite(p.xMm)).toBe(true);
    expect(Number.isFinite(p.yMm)).toBe(true);
  });

  it("dưới 3 đỉnh ⇒ trọng tâm, không ném", () => {
    expect(Number.isFinite(diemDatNhan([{ xMm: 1, yMm: 2 }]).xMm)).toBe(true);
  });

  it("TẤT ĐỊNH — cùng đầu vào cho cùng đầu ra", () => {
    expect(diemDatNhan(L)).toEqual(diemDatNhan(L));
  });
});

describe("diemTrongPolygon", () => {
  const d = VUONG.map(([xMm, yMm]) => ({ xMm, yMm }));
  it("điểm giữa ⇒ true", () => {
    expect(diemTrongPolygon({ xMm: 4000, yMm: 5000 }, d)).toBe(true);
  });
  it("điểm ngoài ⇒ false", () => {
    expect(diemTrongPolygon({ xMm: 10000, yMm: 5000 }, d)).toBe(false);
    expect(diemTrongPolygon({ xMm: 4000, yMm: 100 }, d)).toBe(false);
  });
  it("polygon dưới 3 đỉnh ⇒ luôn false", () => {
    expect(diemTrongPolygon({ xMm: 0, yMm: 0 }, [{ xMm: 0, yMm: 0 }])).toBe(false);
  });
});

describe("bboxPolygonMm", () => {
  it("bao đúng vuông", () => {
    const b = bboxPolygonMm(VUONG.map(([xMm, yMm]) => ({ xMm, yMm })));
    expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([2000, 6000, 3000, 7000]);
  });
});

describe("docDiemDa — jsonb lỏng kiểu", () => {
  it("đọc đúng polygon hợp lệ", () => {
    expect(docDiemDa(VUONG)).toHaveLength(4);
  });
  it("null / không phải mảng ⇒ rỗng", () => {
    expect(docDiemDa(null)).toEqual([]);
    expect(docDiemDa(undefined)).toEqual([]);
    expect(docDiemDa("bad" as never)).toEqual([]);
  });
  it("★ bỏ QUA cặp hỏng, giữ cặp tốt — một đỉnh rác không giết cả vùng", () => {
    const d = docDiemDa([[0, 0], ["x", 1] as never, [10, 0], [10, 10]] as never);
    expect(d).toHaveLength(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Hàng DB → vùng vẽ                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("vungTuHang — CA DƯƠNG do test tự dựng (DB có 0 hàng 'vung')", () => {
  it("dựng được vùng vẽ từ một hàng hợp lệ", () => {
    const v = vungTuHang(hang())!;
    expect(v).not.toBeNull();
    expect(v.khoa).toBe("vung:900");
    expect(v.ten).toBe("Vùng an toàn robot");
    expect(v.dinh).toHaveLength(4);
    expect(v.dienTichM2).toBeCloseTo(16, 6);
  });

  it("★★★ BẪY HOÁN VỊ TRỤC — `yMm` thành scene.z (MẶT BẰNG), không thành độ cao", () => {
    const v = vungTuHang(hang())!;
    // Đỉnh đầu (2000 mm, 3000 mm) ⇒ scene (2 m, z = 3 m).
    expect(v.dinh[0].x).toBeCloseTo(2, 9);
    expect(v.dinh[0].z).toBeCloseTo(3, 9);
    // Vùng trải 4 m theo CẢ HAI trục mặt bằng — nếu yMm bị coi là độ cao thì
    // chiều sâu sẽ là 0 và đây sẽ là một bức tường dựng đứng.
    const zs = v.dinh.map((d) => d.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(4, 9);
  });

  it("★★★ ĐỐI CHỨNG — độ cao đến từ `viTriZMm`, KHÔNG từ `diemDa`", () => {
    const san = vungTuHang(hang({ viTriZMm: 0 }))!;
    const gac = vungTuHang(hang({ viTriZMm: 4000 }))!;
    expect(san.caoDoY).toBeCloseTo(NHAC_KHOI_SAN_M, 9);
    expect(gac.caoDoY).toBeCloseTo(4 + NHAC_KHOI_SAN_M, 9);
    // Và mặt bằng KHÔNG đổi khi độ cao đổi.
    expect(gac.dinh).toEqual(san.dinh);
  });

  it("★ nhấc khỏi sàn > 0 — chống z-fighting với mặt sàn", () => {
    expect(vungTuHang(hang({ viTriZMm: 0 }))!.caoDoY).toBeGreaterThan(0);
  });

  it("nhãn đặt ở TRỌNG TÂM mặt bằng và NỔI TRÊN mặt vùng", () => {
    const v = vungTuHang(hang())!;
    expect(v.nhan.x).toBeCloseTo(4, 6);
    expect(v.nhan.z).toBeCloseTo(5, 6);
    expect(v.nhan.y).toBeGreaterThan(v.caoDoY);
  });

  it("`caoMm` NULL / 0 / âm ⇒ dùng bề dày mặc định, không cho vùng dày 0", () => {
    for (const c of [null, 0, -5]) {
      const v = vungTuHang(hang({ caoMm: c }))!;
      expect(v.dayM).toBeCloseTo(DAY_VUNG_MAC_DINH_MM / 1000, 9);
    }
  });

  it("`mau` NULL ⇒ màu mặc định §10.2", () => {
    expect(vungTuHang(hang({ mau: null }))!.mau).toBe(MAU_VUNG_MAC_DINH);
  });

  it("độ mờ đổi khi ĐANG CHỌN — người dùng biết mình chọn đúng vùng nào", () => {
    expect(vungTuHang(hang(), false)!.doMo).toBe(DO_MO_VUNG);
    expect(vungTuHang(hang(), true)!.doMo).toBe(DO_MO_VUNG_CHON);
    expect(DO_MO_VUNG_CHON).toBeGreaterThan(DO_MO_VUNG);
  });

  it("★ `hienThi=false` ⇒ null, KHÔNG phải một vùng trong suốt", () => {
    expect(vungTuHang(hang({ hienThi: false }))).toBeNull();
  });

  it("★ polygon hỏng ⇒ null, KHÔNG phải mesh 0 đỉnh", () => {
    expect(vungTuHang(hang({ diemDa: null }))).toBeNull();
    expect(vungTuHang(hang({ diemDa: [[0, 0], [1, 1]] }))).toBeNull();
  });
});

describe("vungTuDanhSach", () => {
  it("★ CA DƯƠNG + CA ÂM trong cùng danh sách — chỉ hàng vẽ được mới qua", () => {
    const ds = vungTuDanhSach([
      hang({ id: 1 }),
      hang({ id: 2, hienThi: false }),
      hang({ id: 3, diemDa: null }),
      hang({ id: 4 }),
    ]);
    expect(ds.map((v) => v.khoa)).toEqual(["vung:1", "vung:4"]);
  });

  it("đánh dấu đúng vùng đang chọn", () => {
    const ds = vungTuDanhSach([hang({ id: 1 }), hang({ id: 4 })], "vung:4");
    expect(ds[0].doMo).toBe(DO_MO_VUNG);
    expect(ds[1].doMo).toBe(DO_MO_VUNG_CHON);
  });

  it("★★★ G5 — danh sách RỖNG cho 0 vùng; đây KHÔNG phải bằng chứng gì về ca dương", () => {
    expect(vungTuDanhSach([])).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Đường GHI (#42)                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("dungVungGhi — cổng của đường GHI", () => {
  const dinh = VUONG.map(([xMm, yMm]) => ({ xMm, yMm }));

  it("dựng payload đầy đủ từ polygon hợp lệ", () => {
    const g = dungVungGhi(28, "Vùng robot 1", dinh)!;
    expect(g).not.toBeNull();
    expect(g.tangId).toBe(28);
    expect(g.ten).toBe("Vùng robot 1");
    expect(g.diemDa).toEqual(VUONG);
    expect(g.caoMm).toBe(DAY_VUNG_MAC_DINH_MM);
    expect(g.mau).toBe(MAU_VUNG_MAC_DINH);
  });

  it("★ neo `viTriXMm/YMm` ở TRỌNG TÂM, không ở một góc", () => {
    const g = dungVungGhi(28, "V", dinh)!;
    expect(g.viTriXMm).toBeCloseTo(4000, 6);
    expect(g.viTriYMm).toBeCloseTo(5000, 6);
  });

  it("★ polygon không hợp lệ ⇒ null — cổng ở CLIENT, không đợi 400 của server", () => {
    expect(dungVungGhi(28, "V", [{ xMm: 0, yMm: 0 }, { xMm: 1, yMm: 1 }])).toBeNull();
    expect(dungVungGhi(28, "V", [])).toBeNull();
  });

  it("★ tên rỗng / toàn khoảng trắng ⇒ null", () => {
    expect(dungVungGhi(28, "", dinh)).toBeNull();
    expect(dungVungGhi(28, "   ", dinh)).toBeNull();
  });

  it("tên được cắt khoảng trắng hai đầu", () => {
    expect(dungVungGhi(28, "  Vùng A  ", dinh)!.ten).toBe("Vùng A");
  });

  it("có `id` ⇒ payload SỬA; không có ⇒ payload TẠO", () => {
    expect(dungVungGhi(28, "V", dinh, { id: 77 })!.id).toBe(77);
    expect(dungVungGhi(28, "V", dinh)).not.toHaveProperty("id");
  });

  it("nhận đè cao độ / bề dày / màu", () => {
    const g = dungVungGhi(28, "V", dinh, { caoDoZMm: 500, dayMm: 120, mau: "#00f" })!;
    expect([g.viTriZMm, g.caoMm, g.mau]).toEqual([500, 120, "#00f"]);
  });

  it("★★★ KHỨ HỒI ghi → đọc: payload ghi ra đúng vùng vẽ ban đầu", () => {
    const g = dungVungGhi(28, "Vùng khứ hồi", dinh, { id: 5, dayMm: 50 })!;
    const v = vungTuHang({
      id: g.id!,
      ten: g.ten,
      diemDa: g.diemDa,
      viTriZMm: g.viTriZMm,
      caoMm: g.caoMm,
      mau: g.mau,
      hienThi: true,
    })!;
    expect(v.dienTichM2).toBeCloseTo(16, 6);
    expect(v.nhan.x).toBeCloseTo(4, 6);
    expect(v.nhan.z).toBeCloseTo(5, 6);
  });
});
