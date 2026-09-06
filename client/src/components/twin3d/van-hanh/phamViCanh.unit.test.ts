/**
 * Test của `phamViCanh.ts` — năm cấp phạm vi §10C.2.
 *
 * ★ Trục canh nặng nhất: **bbox rỗng KHÔNG được sinh ra một khung nhìn trông
 *   hợp lệ**. Bay camera tới bbox rỗng đưa nó ra Infinity ⇒ cảnh TRẮNG XOÁ mà
 *   không lỗi nào nổ — đúng lớp lỗi chia-cho-0 của G11 (gizmo hiện đẹp mà kéo
 *   không lưu được).
 */
import { describe, it, expect } from "vitest";
import { bboxRong, bboxTuDiem } from "../heToaDo";
import {
  DO_MO_NGOAI_PHAM_VI,
  KHOANG_CACH_TOI_DA_CAP_MAY,
  TI_LE_PHA_NGOAI_PHAM_VI,
  TWEEN_DOI_CAP_MS,
  bboxCuaTap,
  capCha,
  doMoTheoPhamVi,
  dungBreadcrumb,
  khungNhinCho,
  khungNhinLine,
  phaVeNen,
  trongPhamVi,
  type VatTheCoPhamVi,
} from "./phamViCanh";
import type { CapPhamVi } from "./duongDanTwin";

function vt(sua: Partial<VatTheCoPhamVi> = {}): VatTheCoPhamVi {
  return {
    machineId: 1,
    stationId: 10,
    lineId: 1,
    workshopId: 5,
    factoryId: 4,
    tangId: 1,
    ...sua,
  };
}

const BBOX_LINE = bboxTuDiem([
  { x: 0, y: 0, z: 0 },
  { x: 30, y: 3, z: 4 },
]);

describe("trongPhamVi", () => {
  it("lọc đúng theo từng cấp", () => {
    expect(trongPhamVi(vt(), { cap: "line", id: 1 })).toBe(true);
    expect(trongPhamVi(vt(), { cap: "line", id: 2 })).toBe(false);
    expect(trongPhamVi(vt(), { cap: "nhaMay", id: 4 })).toBe(true);
    expect(trongPhamVi(vt(), { cap: "nhaMay", id: 9 })).toBe(false);
    expect(trongPhamVi(vt(), { cap: "tang", id: 1 })).toBe(true);
    expect(trongPhamVi(vt(), { cap: "may", id: 1 })).toBe(true);
    expect(trongPhamVi(vt(), { cap: "may", id: 2 })).toBe(false);
  });

  it("★ tapDoan bao trùm MỌI vật thể (là cấp cao nhất, không phải 'chưa chọn')", () => {
    expect(trongPhamVi(vt({ factoryId: 999 }), { cap: "tapDoan", id: null })).toBe(true);
  });

  it("★ phạm vi thiếu id ⇒ KHÔNG lọc sạch màn hình", () => {
    // Lọc sạch vì một id thiếu là cách nhanh nhất để người dùng thấy "nhà máy
    // trống rỗng" và đi tìm lỗi ở chỗ không có lỗi.
    expect(trongPhamVi(vt(), { cap: "line", id: null })).toBe(true);
  });

  it("vật thể thiếu lineId KHÔNG thuộc phạm vi line nào", () => {
    expect(trongPhamVi(vt({ lineId: null }), { cap: "line", id: 1 })).toBe(false);
  });
});

describe("doMoTheoPhamVi", () => {
  it("trong phạm vi ⇒ 1; ngoài ⇒ mờ 12 %", () => {
    expect(doMoTheoPhamVi(vt(), { cap: "line", id: 1 })).toBe(1);
    expect(doMoTheoPhamVi(vt(), { cap: "line", id: 2 })).toBe(DO_MO_NGOAI_PHAM_VI);
  });

  it("★ cấp `may` KHÔNG mờ hàng xóm — chọn một máy không xoá cả nhà máy", () => {
    // Người vận hành vẫn cần thấy hàng xóm để định vị; cấp `may` chỉ siết CAMERA.
    expect(doMoTheoPhamVi(vt({ machineId: 99 }), { cap: "may", id: 1 })).toBe(1);
  });

  it("cấp tapDoan không mờ gì cả", () => {
    expect(doMoTheoPhamVi(vt(), { cap: "tapDoan", id: null })).toBe(1);
  });
});

describe("khungNhinCho — ★★★ G8: bbox rỗng KHÔNG sinh khung nhìn", () => {
  it("★★★ bbox RỖNG ⇒ null, KHÔNG phải một khung nhìn mặc định", () => {
    // Bay tới bbox rỗng ⇒ camera ra Infinity ⇒ cảnh trắng xoá, không lỗi.
    expect(khungNhinCho(bboxRong(), "tang")).toBeNull();
    expect(khungNhinCho(bboxRong(), "line")).toBeNull();
  });

  it("bbox thực ⇒ khung nhìn hữu hạn, mục ngắm đúng tâm", () => {
    const kn = khungNhinCho(BBOX_LINE, "tang");
    expect(kn).not.toBeNull();
    expect(kn!.muc).toEqual([15, 1.5, 2]);
    expect(kn!.viTri.every(Number.isFinite)).toBe(true);
    expect(kn!.banKinh).toBeGreaterThan(0);
  });

  it("★ cấp càng cao camera càng lùi xa — thứ tự phải ĐƠN ĐIỆU", () => {
    const caps: CapPhamVi[] = ["may", "line", "tang", "nhaMay", "tapDoan"];
    const luiDan = caps.map((c) => {
      const kn = khungNhinCho(BBOX_LINE, c)!;
      const m = kn.muc;
      return Math.hypot(kn.viTri[0] - m[0], kn.viTri[1] - m[1], kn.viTri[2] - m[2]);
    });
    for (let i = 1; i < luiDan.length; i += 1) {
      expect(luiDan[i]).toBeGreaterThan(luiDan[i - 1]);
    }
  });

  it("★ cấp `may` bị ÉP ≤ 8 m (§10C.2 'Orbit gần')", () => {
    // Ngay cả với một bbox khổng lồ, cấp máy vẫn phải sát.
    const to = bboxTuDiem([
      { x: 0, y: 0, z: 0 },
      { x: 500, y: 50, z: 500 },
    ]);
    const kn = khungNhinCho(to, "may")!;
    expect(kn.viTri[0] - kn.muc[0]).toBeLessThanOrEqual(KHOANG_CACH_TOI_DA_CAP_MAY);
    expect(kn.viTri[1] - kn.muc[1]).toBeLessThanOrEqual(KHOANG_CACH_TOI_DA_CAP_MAY);
  });
});

describe("khungNhinLine — §10C.2 orbit DỌC trục chính", () => {
  it("★ trục X đáng tin ⇒ camera lệch theo trục PHỤ (Z), không lệch theo X", () => {
    // Nhìn dọc trục chính để cả dây chuyền 12 trạm vào khung; nhìn chéo thì hai
    // đầu xa nhau tới mức không đọc nổi.
    const kn = khungNhinLine(BBOX_LINE, "X", true)!;
    expect(kn.viTri[0]).toBeCloseTo(kn.muc[0]); // không lệch dọc trục chính
    expect(kn.viTri[2]).toBeGreaterThan(kn.muc[2]); // lệch theo trục phụ
  });

  it("trục Z đáng tin ⇒ lệch theo X", () => {
    const kn = khungNhinLine(BBOX_LINE, "Z", true)!;
    expect(kn.viTri[2]).toBeCloseTo(kn.muc[2]);
    expect(kn.viTri[0]).toBeGreaterThan(kn.muc[0]);
  });

  it("★★★ trục KHÔNG đáng tin ⇒ rơi về khung nhìn CHUNG, không xoay theo trục bịa", () => {
    // §10C.1: 1 trạm, hoặc phương sai hai trục bằng nhau ⇒ không có trục trội.
    expect(khungNhinLine(BBOX_LINE, "X", false)).toEqual(khungNhinCho(BBOX_LINE, "line"));
  });

  it("bbox rỗng ⇒ null bất kể trục", () => {
    expect(khungNhinLine(bboxRong(), "X", true)).toBeNull();
    expect(khungNhinLine(bboxRong(), "X", false)).toBeNull();
  });
});

describe("bboxCuaTap", () => {
  it("tập rỗng ⇒ bbox rỗng, KHÔNG ném ('phạm vi chưa có gì' là hợp lệ)", () => {
    const b = bboxCuaTap([]);
    expect(khungNhinCho(b, "tang")).toBeNull();
  });

  it("gộp đúng kích thước từng vật thể, không chỉ tâm", () => {
    const b = bboxCuaTap([
      { tam: { x: 0, y: 0, z: 0 }, co: { rong: 2, cao: 3, sau: 4 } },
      { tam: { x: 10, y: 0, z: 0 }, co: { rong: 2, cao: 1, sau: 2 } },
    ]);
    expect(b.minX).toBe(-1);
    expect(b.maxX).toBe(11);
    expect(b.maxY).toBe(3);
  });

  it("vật thể thiếu `co` được coi là điểm", () => {
    const b = bboxCuaTap([{ tam: { x: 5, y: 1, z: 2 } }]);
    expect(b.minX).toBe(5);
    expect(b.maxX).toBe(5);
  });
});

describe("dungBreadcrumb + capCha", () => {
  it("★ luôn bắt đầu từ Tập đoàn và dừng ở cấp đang chọn", () => {
    const bc = dungBreadcrumb({ cap: "line", id: 1 }, (cap) => cap);
    expect(bc.map((m) => m.cap)).toEqual(["tapDoan", "nhaMay", "tang", "line"]);
    // Chỉ cấp đang chọn mới mang id.
    expect(bc[bc.length - 1].id).toBe(1);
    expect(bc.slice(0, -1).every((m) => m.id === null)).toBe(true);
  });

  it("cấp tapDoan cho breadcrumb một mắt xích", () => {
    expect(dungBreadcrumb({ cap: "tapDoan", id: null }, () => "x")).toHaveLength(1);
  });

  it("cấp may cho đủ năm mắt xích", () => {
    expect(dungBreadcrumb({ cap: "may", id: 42 }, () => "x")).toHaveLength(5);
  });

  it("capCha đi lên đúng một bậc, và tapDoan không có cha", () => {
    expect(capCha("may")).toBe("line");
    expect(capCha("line")).toBe("tang");
    expect(capCha("tang")).toBe("nhaMay");
    expect(capCha("nhaMay")).toBe("tapDoan");
    expect(capCha("tapDoan")).toBeNull();
  });
});

describe("phaVeNen — ★ 'mờ đi' phải là PHA VỀ NỀN, không phải LÀM TỐI", () => {
  it("pha 0 giữ nguyên, pha 1 thành đúng màu nền", () => {
    expect(phaVeNen("rgb(0, 0, 0)", "rgb(255, 255, 255)", 0)).toBe("rgb(0, 0, 0)");
    expect(phaVeNen("rgb(0, 0, 0)", "rgb(255, 255, 255)", 1)).toBe("rgb(255, 255, 255)");
  });

  it("★★★ TRÊN NỀN SÁNG, pha làm màu SÁNG LÊN — điều mà làm-tối không bao giờ làm được", () => {
    // Đây là lỗi thị giác đo được bằng ảnh: `LoBatchMay` chỉ có kênh làm tối
    // (`multiplyScalar`), nên một màu nhạt ngoài phạm vi thành gần ĐEN trên sàn
    // sáng — đọc như MÁY HỎNG chứ không như "lùi khỏi tiền cảnh".
    const ra = phaVeNen("rgb(100, 100, 100)", "rgb(248, 250, 252)", 0.72);
    const [r] = ra.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(100);
  });

  it("★ trên nền TỐI, cùng công thức làm màu TỐI đi — đúng ở CẢ hai theme", () => {
    const ra = phaVeNen("rgb(200, 200, 200)", "rgb(15, 23, 42)", 0.72);
    const [r] = ra.match(/\d+/g)!.map(Number);
    expect(r).toBeLessThan(200);
  });

  it("nhận cả #rrggbb và #rgb", () => {
    expect(phaVeNen("#000000", "#ffffff", 1)).toBe("rgb(255, 255, 255)");
    expect(phaVeNen("#000", "#fff", 1)).toBe("rgb(255, 255, 255)");
  });

  it("★ màu KHÔNG phân giải được ⇒ trả NGUYÊN màu gốc, không trả màu bịa", () => {
    // Thà đậm còn hơn vẽ một màu không ai chọn — người dùng vẫn thấy vật thể.
    expect(phaVeNen("oklch(0.5 0.1 200)", "rgb(0,0,0)", 0.5)).toBe("oklch(0.5 0.1 200)");
    expect(phaVeNen("rgb(1,2,3)", "khong-phai-mau", 0.5)).toBe("rgb(1,2,3)");
  });

  it("tỉ lệ ngoài [0,1] và NaN bị kẹp an toàn", () => {
    expect(phaVeNen("rgb(0,0,0)", "rgb(255,255,255)", 5)).toBe("rgb(255, 255, 255)");
    expect(phaVeNen("rgb(0,0,0)", "rgb(255,255,255)", -3)).toBe("rgb(0, 0, 0)");
    expect(phaVeNen("rgb(0,0,0)", "rgb(255,255,255)", NaN)).toBe("rgb(0, 0, 0)");
  });

  it("tỉ lệ mặc định nằm trong khoảng còn ĐỌC ĐƯỢC hình khối", () => {
    expect(TI_LE_PHA_NGOAI_PHAM_VI).toBeGreaterThan(0.5);
    expect(TI_LE_PHA_NGOAI_PHAM_VI).toBeLessThan(0.9);
  });
});

describe("hằng số", () => {
  it("tween đổi cấp là 500 ms (§10C.2)", () => {
    expect(TWEEN_DOI_CAP_MS).toBe(500);
  });
});
