/**
 * Test của `phamViCanh.ts` — năm cấp phạm vi §10C.2.
 *
 * ★ Trục canh nặng nhất: **bbox rỗng KHÔNG được sinh ra một khung nhìn trông
 *   hợp lệ**. Bay camera tới bbox rỗng đưa nó ra Infinity ⇒ cảnh TRẮNG XOÁ mà
 *   không lỗi nào nổ — đúng lớp lỗi chia-cho-0 của G11 (gizmo hiện đẹp mà kéo
 *   không lưu được).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bboxRong, bboxTuDiem } from "../heToaDo";
import {
  FOV_DOC_MAC_DINH,
  LE_KHOP_KHUNG_PX,
  chieuNdc,
  dinhBBox,
  khopKhungNhin,
  lotKhung,
  DO_MO_NGOAI_PHAM_VI,
  HE_SO_CAO,
  HE_SO_LUI,
  KHOANG_CACH_TOI_DA_CAP_MAY,
  TI_LE_PHA_NGOAI_PHAM_VI,
  TWEEN_DOI_CAP_MS,
  bboxCuaTap,
  capCha,
  doMoTheoPhamVi,
  dungBreadcrumb,
  khungNhinCho,
  khungNhinLine,
  khungNhinTuCamera,
  phaVeNen,
  trongPhamVi,
  type VatTheCoPhamVi,
} from "./phamViCanh";
import { docCamera } from "./duongDanTwin";
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

  /* ═════════════════════════════════════════════════════════════════════ */
  /* ★★★ T-2 (Đợt 5) — VÙNG MÙ `HE_SO_LUI` / `HE_SO_CAO`                    */
  /* ═════════════════════════════════════════════════════════════════════ */
  /*
   * Test "đơn điệu" ngay TRÊN đo `Math.hypot(lui, cao, lui)` — MỘT CON SỐ GỘP.
   * Một con số gộp không thể thấy hai thành phần ĐỔI CHỖ cho nhau, cũng không
   * thấy một cấp bị chép đè giá trị của cấp khác: chỉ cần tổng bình phương giữ
   * thứ tự thì nó vẫn xanh. Đây đúng bài học G7 — ĐO NHẦM ĐẠI LƯỢNG.
   *
   * Bốn test dưới đo `lui` và `cao` RỜI NHAU, trên từng cấp, nên đột biến vào
   * một ô bất kỳ của một trong hai bảng đều có chỗ để kêu.
   */

  /** Bbox nhỏ để cấp `may` KHÔNG chạm trần 8 m — chạm trần thì `lui` bị kẹp và
   *  phép đo mất đúng cái nó định đo (một dạng G7 khác). */
  const BBOX_NHO = bboxTuDiem([
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 1, z: 2 },
  ]);
  const CAPS: CapPhamVi[] = ["tapDoan", "nhaMay", "tang", "line", "may"];
  /** Hệ số lùi ĐO ĐƯỢC từ hình học, tách riêng khỏi trục cao. */
  const luiDo = () =>
    CAPS.map((c) => {
      const kn = khungNhinCho(BBOX_NHO, c)!;
      return (kn.viTri[0] - kn.muc[0]) / kn.banKinh;
    });
  /** Hệ số cao ĐO ĐƯỢC từ hình học, tách riêng khỏi trục lùi. */
  const caoDo = () =>
    CAPS.map((c) => {
      const kn = khungNhinCho(BBOX_NHO, c)!;
      return (kn.viTri[1] - kn.muc[1]) / kn.banKinh;
    });

  /*
   * ⚠ MỖI ràng buộc một `it()` RIÊNG — cố ý. Gộp bốn `expect` vào một `it()`
   * thì vitest dừng ở `expect` đầu tiên hỏng, nên một đột biến chỉ làm ĐỎ được
   * ĐÚNG MỘT test dù nó phá vỡ cả bốn ràng buộc. Số test đỏ khi đó đo "có bao
   * nhiêu it()", KHÔNG đo "đột biến phá bao nhiêu tính chất" — lại là G7.
   */

  it("★ T-2 `HE_SO_LUI` khớp bảng SỐ VIẾT TAY (không đọc lại chính hằng)", () => {
    // So kết quả với chính hằng đang đo thì hai vế cùng trôi theo nhau và phép
    // đo KHÔNG BAO GIỜ đỏ — bẫy "hai phép đo của TÔI tự thoả".
    expect(luiDo()).toEqual([2.4, 1.9, 1.6, 1.35, 1.1].map((v) => expect.closeTo(v, 6)));
  });

  it("★ T-2 năm hệ số lùi ĐÔI MỘT KHÁC NHAU", () => {
    // Bắt ca chép đè: một cấp mang giá trị của cấp khác.
    expect(new Set(luiDo().map((v) => v.toFixed(6))).size).toBe(5);
  });

  it("★ T-2 hệ số lùi GIẢM DẦN CHẶT theo cấp", () => {
    const lui = luiDo();
    for (let i = 1; i < lui.length; i += 1) expect(lui[i]).toBeLessThan(lui[i - 1]);
  });

  it("★ T-2 bảng `HE_SO_LUI` công bố ra ngoài khớp số đo từ hình học", () => {
    const lui = luiDo();
    CAPS.forEach((c, i) => expect(HE_SO_LUI[c]).toBeCloseTo(lui[i], 6));
  });

  it("★ T-2 `HE_SO_CAO` khớp bảng SỐ VIẾT TAY", () => {
    expect(caoDo()).toEqual([1.8, 1.1, 0.9, 0.55, 0.7].map((v) => expect.closeTo(v, 6)));
  });

  it("★ T-2 năm hệ số cao ĐÔI MỘT KHÁC NHAU", () => {
    expect(new Set(caoDo().map((v) => v.toFixed(6))).size).toBe(5);
  });

  it("★ T-2 bảng `HE_SO_CAO` công bố ra ngoài khớp số đo từ hình học", () => {
    const cao = caoDo();
    CAPS.forEach((c, i) => expect(HE_SO_CAO[c]).toBeCloseTo(cao[i], 6));
  });

  it("★ T-2 `cao` KHÔNG đơn điệu — `may` cao hơn `line` (line nhìn THẤP dọc trục)", () => {
    // Ghim đúng chỗ gãy của bảng: một test "đơn điệu" áp cho `cao` sẽ ép sai spec.
    expect(HE_SO_CAO.may).toBeGreaterThan(HE_SO_CAO.line);
  });

  it("★ T-2 hai bảng KHÔNG bằng nhau ở bất kỳ cấp nào", () => {
    // Trỏ cả hai về một bảng thì mọi test dùng `hypot` vẫn xanh.
    for (const c of CAPS) expect(HE_SO_LUI[c]).not.toBeCloseTo(HE_SO_CAO[c], 6);
  });

  it("★ T-2 `lui` và `cao` KHÔNG ĐỔI CHỖ — mọi cấp lùi xa hơn là cao", () => {
    // Ràng buộc HÌNH HỌC của §10C.2: orbit chéo ⇒ khoảng lùi ngang > độ cao.
    const lui = luiDo();
    const cao = caoDo();
    CAPS.forEach((_, i) => expect(lui[i]).toBeGreaterThan(cao[i]));
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

/* ══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 33 (Pareto #9) — `?cam=` thành KhungNhin, không bị nuốt              */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★★★ Đợt 33 — khungNhinTuCamera: `?cam=` của deep-link trở thành khung nhìn thật", () => {
  it("vị trí = (x,y,z) của URL; mục = (mucX, 0, mucZ) — mục ngắm nằm trên sàn theo hợp đồng §9.4", () => {
    const k = khungNhinTuCamera({ x: 19.2, y: 18, z: 30, mucX: 19.2, mucZ: 14.8 });
    expect(k.viTri).toEqual([19.2, 18, 30]);
    expect(k.muc).toEqual([19.2, 0, 14.8]);
  });
  it("★ đi thẳng từ chuỗi URL qua `docCamera` (cùng bộ đọc với /twin) — không bộ đọc thứ hai", () => {
    const cam = docCamera("0,10,14.8,19.2,14.8")!;
    expect(cam).not.toBeNull();
    const k = khungNhinTuCamera(cam);
    expect(k.viTri).toEqual([0, 10, 14.8]);
    expect(k.muc).toEqual([19.2, 0, 14.8]);
  });
  it("banKinh = khoảng cách camera↔mục, sàn 1 m — không bao giờ 0/NaN (G11)", () => {
    expect(khungNhinTuCamera({ x: 3, y: 4, z: 0, mucX: 0, mucZ: 0 }).banKinh).toBe(5);
    expect(khungNhinTuCamera({ x: 0, y: 0, z: 0, mucX: 0, mucZ: 0 }).banKinh).toBe(1);
  });
  it("★★★ ĐỐI CHỨNG — hai tư thế KHÁC nhau cho hai khung nhìn KHÁC nhau (phép đo K7 dựa trên điều này)", () => {
    const a = khungNhinTuCamera(docCamera("19.2,18,30,19.2,14.8")!);
    const b = khungNhinTuCamera(docCamera("0,10,14.8,19.2,14.8")!);
    expect(a.viTri).not.toEqual(b.viTri);
    // và KHÁC khung nhìn theo cấp của một bbox quanh chuyền — nếu không, `?cam=` "có tác dụng" mà không thấy gì
    const theoCap = khungNhinCho(
      bboxTuDiem([
        { x: 5.45, y: 0, z: 14.8 },
        { x: 32.95, y: 2, z: 15.8 },
      ]),
      "line",
    );
    expect(theoCap).not.toBeNull();
    expect(a.viTri).not.toEqual(theoCap!.viTri);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 35 (Pareto #5) — KHỚP KHUNG: 12/12 MÁY + CỘT WIP LỌT FRUSTUM, CHỪA LỀ NHÃN */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★★★ Đợt 35 — khớp khung theo canvas THẬT (khungNhinLine + khung)", () => {
  /**
   * Chuyền 2 THẬT (`twin_dat_cho` đo 2026-09-10): 12 máy x = 5,45 → 32,95 m, z = 14,8 m,
   * khối ~1,2×1,6×1,2 m; cột WIP (`OngWip`) từ sàn tới `CAO_TOI_DA_M` = 6 m.
   */
  const BBOX_L2 = { minX: 4.85, maxX: 33.55, minY: 0, maxY: 1.6, minZ: 14.2, maxZ: 15.4 };
  const BBOX_L2_WIP = { ...BBOX_L2, maxY: 6 };
  /** Canvas `/twin/line/2` đo DOM: 1288×683 @1600×900 · 968×488 @1280×720. */
  const K1600 = { rongPx: 1288, caoPx: 683 };
  const K1280 = { rongPx: 968, caoPx: 488 };
  const dist = (k: { viTri: number[]; muc: number[] }) => Math.hypot(k.viTri[0] - k.muc[0], k.viTri[1] - k.muc[1], k.viTri[2] - k.muc[2]);

  it("chieuNdc: mục ⇒ (0,0) · sau lưng ⇒ null · lệch +X khi nhìn về −Z ⇒ x>0 · cao hơn ⇒ y>0", () => {
    const vt = [0, 5, 10] as const;
    const muc = [0, 0, 0] as const;
    const o = chieuNdc({ x: 0, y: 0, z: 0 }, vt, muc, 45, 1.5)!;
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeCloseTo(0, 9);
    expect(o.sau).toBeCloseTo(Math.hypot(5, 10), 9);
    expect(chieuNdc({ x: 0, y: 5, z: 20 }, vt, muc, 45, 1.5)).toBeNull();
    expect(chieuNdc({ x: 3, y: 0, z: 0 }, vt, muc, 45, 1.5)!.x).toBeGreaterThan(0);
    expect(chieuNdc({ x: 0, y: 3, z: 0 }, vt, muc, 45, 1.5)!.y).toBeGreaterThan(0);
    // Tỉ lệ rộng hơn ⇒ cùng điểm cho |x| NHỎ hơn (khung ngang rộng hơn).
    expect(Math.abs(chieuNdc({ x: 3, y: 0, z: 0 }, vt, muc, 45, 2.5)!.x)).toBeLessThan(Math.abs(chieuNdc({ x: 3, y: 0, z: 0 }, vt, muc, 45, 1.5)!.x));
  });

  it("★★★ ĐỐI CHỨNG — công thức CŨ (không khung) để đỉnh chuyền 2 RA NGOÀI ở CẢ hai tỉ lệ (lưới biết kêu)", () => {
    const cu = khungNhinLine(BBOX_L2_WIP, "X", true)!;
    expect(lotKhung(dinhBBox(BBOX_L2_WIP), cu.viTri, cu.muc, K1600)).toBe(false);
    expect(lotKhung(dinhBBox(BBOX_L2_WIP), cu.viTri, cu.muc, K1280)).toBe(false);
    // ngay cả không WIP, 27 m chuyền vẫn không lọt với camera ~10 m.
    expect(lotKhung(dinhBBox(BBOX_L2), cu.viTri, cu.muc, K1600)).toBe(false);
  });

  it("★★★ có khung ⇒ 8 đỉnh (kèm WIP 6 m) lọt với lề 100 px ở 1600 VÀ 1280", () => {
    for (const K of [K1600, K1280]) {
      const moi = khungNhinLine(BBOX_L2_WIP, "X", true, K)!;
      expect(lotKhung(dinhBBox(BBOX_L2_WIP), moi.viTri, moi.muc, K), `khung ${K.rongPx}x${K.caoPx}`).toBe(true);
      for (const v of [...moi.viTri, ...moi.muc]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("hướng nhìn GIỮ NGUYÊN: vẫn lệch theo trục phụ Z (không theo X), tỉ số cao/lùi như cũ; chỉ khoảng cách đổi", () => {
    const cu = khungNhinLine(BBOX_L2_WIP, "X", true)!;
    const moi = khungNhinLine(BBOX_L2_WIP, "X", true, K1600)!;
    expect(moi.viTri[0]).toBeCloseTo(moi.muc[0], 6);
    expect(moi.viTri[2]).toBeGreaterThan(moi.muc[2]);
    expect(moi.muc).toEqual(cu.muc);
    expect(moi.banKinh).toBe(cu.banKinh);
    const tiSo = (k: { viTri: number[]; muc: number[] }) => (k.viTri[1] - k.muc[1]) / (k.viTri[2] - k.muc[2]);
    expect(tiSo(moi)).toBeCloseTo(tiSo(cu), 6);
    expect(dist(moi)).toBeGreaterThan(dist(cu));
  });

  it("khớp là khoảng cách NHỎ NHẤT còn lọt: tiến 3 % ⇒ không lọt, lùi 3 % ⇒ vẫn lọt", () => {
    const moi = khungNhinLine(BBOX_L2_WIP, "X", true, K1600)!;
    const d = dist(moi);
    const u = [0, 1, 2].map((i) => (moi.viTri[i] - moi.muc[i]) / d);
    const tai = (s: number) => [moi.muc[0] + u[0] * s, moi.muc[1] + u[1] * s, moi.muc[2] + u[2] * s] as [number, number, number];
    expect(lotKhung(dinhBBox(BBOX_L2_WIP), tai(d * 0.97), moi.muc, K1600)).toBe(false);
    expect(lotKhung(dinhBBox(BBOX_L2_WIP), tai(d * 1.03), moi.muc, K1600)).toBe(true);
  });

  it("cột WIP 6 m làm camera XA hơn bbox không WIP — cột không xuyên mép trên", () => {
    const khongWip = khungNhinLine(BBOX_L2, "X", true, K1600)!;
    const coWip = khungNhinLine(BBOX_L2_WIP, "X", true, K1600)!;
    expect(dist(coWip)).toBeGreaterThan(dist(khongWip));
    expect(lotKhung(dinhBBox(BBOX_L2_WIP), khongWip.viTri, khongWip.muc, K1600)).toBe(false);
  });

  it("lề lớn hơn ⇒ xa hơn; cùng đầu vào ⇒ cùng đầu ra (tất định); trục KHÔNG đáng tin cũng được khớp", () => {
    const le100 = khungNhinLine(BBOX_L2_WIP, "X", true, K1600)!;
    const le0 = khungNhinLine(BBOX_L2_WIP, "X", true, { ...K1600, lePx: 0 })!;
    expect(dist(le100)).toBeGreaterThan(dist(le0));
    expect(khungNhinLine(BBOX_L2_WIP, "X", true, K1600)).toEqual(le100);
    const chung = khungNhinLine(BBOX_L2_WIP, "X", false, K1600)!;
    expect(lotKhung(dinhBBox(BBOX_L2_WIP), chung.viTri, chung.muc, K1600)).toBe(true);
    expect(chung.viTri[0]).toBeGreaterThan(chung.muc[0]); // vẫn là khung nhìn CHUNG (chéo), chỉ xa hơn
  });

  it("bbox rỗng ⇒ null; khung không hợp lệ ⇒ trả gốc nguyên vẹn, không NaN", () => {
    expect(khungNhinLine(bboxRong(), "X", true, K1600)).toBeNull();
    const goc = khungNhinLine(BBOX_L2_WIP, "X", true)!;
    expect(khopKhungNhin(BBOX_L2_WIP, goc, { rongPx: 0, caoPx: 0 })).toEqual(goc);
    expect(khopKhungNhin(bboxRong(), goc, K1600)).toEqual(goc);
  });

  it("★ FOV 45 là số THẬT của `KhungCanh` (đọc văn bản, G91); lề ≥ nửa nhãn rộng nhất đo được (198/2)", () => {
    const nguon = readFileSync(resolve(__dirname, "../loi/KhungCanh.tsx"), "utf8");
    expect(nguon).toMatch(/fov = 45\b/);
    expect(FOV_DOC_MAC_DINH).toBe(45);
    expect(LE_KHOP_KHUNG_PX).toBeGreaterThanOrEqual(99);
  });
});
