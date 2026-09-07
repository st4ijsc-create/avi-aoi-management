/**
 * khungNhin.unit.test.ts — Fit-all-in-view + Fullscreen (§11.9 #58).
 *
 * ★★★ G20 — import CHÍNH MODULE GIAO HÀNG (`./khungNhin`), không bản chép.
 * ★★★ G5  — mọi phép đo hình học chạy trên cảnh CÓ VẬT Ở VỊ TRÍ BIẾT TRƯỚC và
 *   khẳng định camera tới ĐÚNG chỗ. Test "fit trên cảnh rỗng không nổ" có mặt,
 *   nhưng nó KHÔNG được tính là bằng chứng fit đúng — và `fitTatCa` trả `null`
 *   trên tập rỗng chính là để phân biệt hai ca đó bằng KIỂU.
 */

import { describe, expect, it } from "vitest";

import {
  BAN_KINH_TOI_THIEU_M,
  HE_SO_DEM_FIT,
  HUONG_NHIN_MAC_DINH,
  KHOANG_CACH_TOI_THIEU_M,
  banKinhBao,
  bboxNoiDung,
  bboxSan,
  bboxVatThe,
  congFullscreen,
  doiFullscreen,
  fitBBox,
  fitTatCa,
  khoangCachFit,
  type VatTheTrongKhung,
} from "./khungNhin";
import { bboxCoThuc, tamBBox } from "../heToaDo";

/** Máy 1200×1800×800 mm đứng ở (x, 0, z) mét. */
function may(x: number, z: number): VatTheTrongKhung {
  return {
    viTri: { x, y: 0, z },
    kichThuocMm: { rongMm: 1200, caoMm: 1800, sauMm: 800 },
  };
}

describe("bboxVatThe — vị trí là ĐÁY, không phải tâm", () => {
  it("nâng tâm hộp lên nửa chiều cao", () => {
    const b = bboxVatThe(may(10, 20));
    // cao 1800 mm = 1,8 m ⇒ đáy 0, đỉnh 1,8
    expect(b.minY).toBeCloseTo(0, 9);
    expect(b.maxY).toBeCloseTo(1.8, 9);
  });

  it("rộng theo X, sâu theo Z — KHÔNG hoán vị", () => {
    const b = bboxVatThe(may(10, 20));
    expect(b.maxX - b.minX).toBeCloseTo(1.2, 9);
    expect(b.maxZ - b.minZ).toBeCloseTo(0.8, 9);
  });
});

describe("bboxNoiDung — BBOX THẬT của nội dung, không hằng số", () => {
  it("bao đúng hai máy ở hai góc biết trước", () => {
    const b = bboxNoiDung([may(5, 5), may(35, 25)]);
    expect(b.minX).toBeCloseTo(5 - 0.6, 9);
    expect(b.maxX).toBeCloseTo(35 + 0.6, 9);
    expect(b.minZ).toBeCloseTo(5 - 0.4, 9);
    expect(b.maxZ).toBeCloseTo(25 + 0.4, 9);
  });

  it("★ ĐỔI VỊ TRÍ MỘT MÁY LÀ ĐỔI BBOX — chỉ báo không phải hằng số", () => {
    const a = bboxNoiDung([may(5, 5), may(35, 25)]);
    const c = bboxNoiDung([may(5, 5), may(200, 25)]);
    expect(c.maxX).toBeGreaterThan(a.maxX + 100);
  });

  it("danh sách rỗng cho bbox KHÔNG CÓ THỰC (G5)", () => {
    expect(bboxCoThuc(bboxNoiDung([]))).toBe(false);
  });
});

describe("banKinhBao", () => {
  it("là nửa đường chéo hộp", () => {
    // hộp 6 × 8 × 0 ⇒ đường chéo 10 ⇒ bán kính 5
    const r = banKinhBao({ minX: 0, maxX: 6, minY: 0, maxY: 8, minZ: 0, maxZ: 0 });
    expect(r).toBeCloseTo(5, 9);
  });

  it("bbox suy biến một điểm vẫn cho bán kính tối thiểu (không chia 0 ở dưới)", () => {
    const r = banKinhBao({ minX: 3, maxX: 3, minY: 3, maxY: 3, minZ: 3, maxZ: 3 });
    expect(r).toBe(BAN_KINH_TOI_THIEU_M);
  });
});

describe("khoangCachFit — fov NGANG là ràng buộc chặt hơn khi khung hẹp", () => {
  it("khung vuông: khoảng cách = r·đệm / sin(fov/2)", () => {
    const d = khoangCachFit(10, 90, 1);
    // sin(45°) = √2/2 ⇒ d = 10·1.12 / (√2/2)
    expect(d).toBeCloseTo((10 * HE_SO_DEM_FIT) / Math.sin(Math.PI / 4), 6);
  });

  it("★ KHUNG HẸP PHẢI LÙI XA HƠN khung rộng — nếu không, hai bên bị cắt", () => {
    const rong = khoangCachFit(10, 45, 2.0);
    const hep = khoangCachFit(10, 45, 0.5);
    expect(hep).toBeGreaterThan(rong);
  });

  it("khung rộng (aspect ≥ 1) bị fov DỌC chi phối — khoảng cách không đổi theo aspect", () => {
    expect(khoangCachFit(10, 45, 1.5)).toBeCloseTo(khoangCachFit(10, 45, 3), 6);
  });

  it("bán kính 0 vẫn cho khoảng cách tối thiểu, không cho 0", () => {
    expect(khoangCachFit(0, 45, 1)).toBe(KHOANG_CACH_TOI_THIEU_M);
  });

  it("aspect 0 / NaN coi như vuông thay vì cho NaN", () => {
    expect(Number.isFinite(khoangCachFit(10, 45, 0))).toBe(true);
    expect(Number.isFinite(khoangCachFit(10, 45, Number.NaN))).toBe(true);
  });
});

describe("HUONG_NHIN_MAC_DINH", () => {
  it("đã chuẩn hoá (độ dài 1) — nếu không, khoảng cách fit sai theo tỉ lệ", () => {
    const u = HUONG_NHIN_MAC_DINH;
    expect(Math.sqrt(u.x * u.x + u.y * u.y + u.z * u.z)).toBeCloseTo(1, 12);
  });

  it("★ BẪY HOÁN VỊ TRỤC — thành phần Y (độ cao) phải DƯƠNG, camera nhìn XUỐNG", () => {
    expect(HUONG_NHIN_MAC_DINH.y).toBeGreaterThan(0);
  });
});

describe("fitBBox — CAMERA TỚI ĐÚNG CHỖ (G5, ca dương)", () => {
  const b = { minX: 10, maxX: 30, minY: 0, maxY: 4, minZ: 40, maxZ: 60 };

  it("ngắm đúng TÂM bbox — không phải gốc toạ độ", () => {
    const k = fitBBox(b, 45, 1)!;
    expect(k).not.toBeNull();
    expect(k.ngam).toEqual(tamBBox(b));
    expect(k.ngam.x).toBeCloseTo(20, 9);
    expect(k.ngam.z).toBeCloseTo(50, 9);
  });

  it("camera đứng CÁCH tâm đúng `khoangCach` theo hướng đã cho", () => {
    const k = fitBBox(b, 45, 1)!;
    const dx = k.viTri.x - k.ngam.x;
    const dy = k.viTri.y - k.ngam.y;
    const dz = k.viTri.z - k.ngam.z;
    expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeCloseTo(k.khoangCach, 6);
  });

  it("★★★ NÂNG THEO TRỤC Y, KHÔNG PHẢI Z — bẫy hoán vị trục", () => {
    // Hướng thuần đứng: camera phải bay LÊN (y tăng), z giữ nguyên tâm.
    const k = fitBBox(b, 45, 1, { x: 0, y: 1, z: 0 })!;
    expect(k.viTri.y).toBeGreaterThan(k.ngam.y + 1);
    expect(k.viTri.x).toBeCloseTo(k.ngam.x, 9);
    expect(k.viTri.z).toBeCloseTo(k.ngam.z, 9);
  });

  it("★ DỜI BBOX 100 m thì camera DỜI THEO 100 m — không đứng yên ở hằng số", () => {
    const k1 = fitBBox(b, 45, 1)!;
    const k2 = fitBBox(
      { ...b, minX: b.minX + 100, maxX: b.maxX + 100 },
      45,
      1,
    )!;
    expect(k2.viTri.x - k1.viTri.x).toBeCloseTo(100, 6);
    expect(k2.ngam.x - k1.ngam.x).toBeCloseTo(100, 6);
  });

  it("★ BBOX TO GẤP ĐÔI thì camera LÙI GẤP ĐÔI", () => {
    const nho = fitBBox({ minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 }, 45, 1)!;
    const to = fitBBox({ minX: 0, maxX: 20, minY: 0, maxY: 20, minZ: 0, maxZ: 20 }, 45, 1)!;
    expect(to.khoangCach / nho.khoangCach).toBeCloseTo(2, 6);
  });

  it("hướng chưa chuẩn hoá vẫn cho đúng khoảng cách (tự chuẩn hoá)", () => {
    const k = fitBBox(b, 45, 1, { x: 0, y: 7, z: 0 })!;
    expect(k.viTri.y - k.ngam.y).toBeCloseTo(k.khoangCach, 6);
  });

  it("bbox rỗng trả null — 'không có gì để fit' là một câu trả lời", () => {
    expect(fitBBox({ minX: 1, maxX: -1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }, 45, 1)).toBeNull();
  });
});

describe("fitTatCa — CA DƯƠNG trên cảnh có vật ở vị trí biết trước", () => {
  it("★★★ hai máy ở (5,5) và (35,25) ⇒ ngắm ĐÚNG trung điểm (20,15)", () => {
    const k = fitTatCa([may(5, 5), may(35, 25)], 45, 1.6)!;
    expect(k).not.toBeNull();
    expect(k.ngam.x).toBeCloseTo(20, 6);
    expect(k.ngam.z).toBeCloseTo(15, 6);
    // Nội dung cao 1,8 m ⇒ tâm cao 0,9 m.
    expect(k.ngam.y).toBeCloseTo(0.9, 6);
  });

  it("★★★ MỘT máy duy nhất ở (7, 13) ⇒ ngắm ĐÚNG (7, 13) — không về gốc", () => {
    const k = fitTatCa([may(7, 13)], 45, 1.6)!;
    expect(k.ngam.x).toBeCloseTo(7, 6);
    expect(k.ngam.z).toBeCloseTo(13, 6);
  });

  it("★★★ G5 — tập RỖNG trả `null`, KHÔNG trả một khung nhìn 'đúng'", () => {
    expect(fitTatCa([], 45, 1.6)).toBeNull();
  });

  it("camera nằm NGOÀI bbox nội dung (không chui vào giữa đám máy)", () => {
    const ds = [may(5, 5), may(35, 25)];
    const k = fitTatCa(ds, 45, 1.6)!;
    const b = bboxNoiDung(ds);
    const trong =
      k.viTri.x >= b.minX &&
      k.viTri.x <= b.maxX &&
      k.viTri.y >= b.minY &&
      k.viTri.y <= b.maxY &&
      k.viTri.z >= b.minZ &&
      k.viTri.z <= b.maxZ;
    expect(trong).toBe(false);
  });
});

describe("bboxSan — dự phòng, cố ý TÁCH RIÊNG khỏi bboxNoiDung (G5)", () => {
  it("trải trên X–Z, chiều cao 0", () => {
    const b = bboxSan(38.4, 29.6);
    expect(b.maxX).toBeCloseTo(38.4, 9);
    expect(b.maxZ).toBeCloseTo(29.6, 9);
    expect(b.maxY).toBe(0);
  });

  it("fit trên sàn thật (38,4 × 29,6 m) ngắm đúng tâm sàn", () => {
    const k = fitBBox(bboxSan(38.4, 29.6), 45, 1.6)!;
    expect(k.ngam.x).toBeCloseTo(19.2, 6);
    expect(k.ngam.z).toBeCloseTo(14.8, 6);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Fullscreen                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("congFullscreen / doiFullscreen", () => {
  function docGia(dangFullscreen: Element | null, batCau = false) {
    const ghi: string[] = [];
    const d = {
      fullscreenElement: batCau ? undefined : dangFullscreen,
      webkitFullscreenElement: batCau ? dangFullscreen : undefined,
      exitFullscreen: batCau ? undefined : () => void ghi.push("ra"),
      webkitExitFullscreen: batCau ? () => void ghi.push("ra-webkit") : undefined,
    } as unknown as Document;
    return { d, ghi };
  }
  function elGia(ghi: string[], batCau = false) {
    return (batCau
      ? { webkitRequestFullscreen: () => void ghi.push("vao-webkit") }
      : { requestFullscreen: () => void ghi.push("vao") }) as unknown as Element;
  }

  it("document null ⇒ không hỗ trợ, không ném", () => {
    const c = congFullscreen(null);
    expect(c.coHoTro).toBe(false);
    expect(doiFullscreen({} as Element, c)).toBe("khong-ho-tro");
  });

  it("★ document KHÔNG có API fullscreen ⇒ 'khong-ho-tro' (nhánh jsdom/node)", () => {
    const c = congFullscreen({} as Document);
    expect(c.coHoTro).toBe(false);
    expect(doiFullscreen({} as Element, c)).toBe("khong-ho-tro");
  });

  it("chưa fullscreen ⇒ VÀO, và gọi đúng requestFullscreen của phần tử", () => {
    const ghi: string[] = [];
    const el = elGia(ghi);
    const { d } = docGia(null);
    expect(doiFullscreen(el, congFullscreen(d))).toBe("vao");
    expect(ghi).toEqual(["vao"]);
  });

  it("đang fullscreen ĐÚNG phần tử đó ⇒ RA", () => {
    const ghi: string[] = [];
    const el = elGia(ghi);
    const { d, ghi: ghiDoc } = docGia(el);
    expect(doiFullscreen(el, congFullscreen(d))).toBe("ra");
    expect(ghiDoc).toEqual(["ra"]);
  });

  it("★ đang fullscreen phần tử KHÁC ⇒ VÀO (không nhầm thành thoát)", () => {
    const ghi: string[] = [];
    const el = elGia(ghi);
    const khac = { nodeName: "DIV" } as unknown as Element;
    const { d } = docGia(khac);
    expect(doiFullscreen(el, congFullscreen(d))).toBe("vao");
    expect(ghi).toEqual(["vao"]);
  });

  it("★ nhánh Safari `webkit*` — không ném và vẫn vào/ra được", () => {
    const ghi: string[] = [];
    const el = elGia(ghi, true);
    const { d, ghi: ghiDoc } = docGia(null, true);
    expect(doiFullscreen(el, congFullscreen(d))).toBe("vao");
    expect(ghi).toEqual(["vao-webkit"]);
    const { d: d2, ghi: ghiDoc2 } = docGia(el, true);
    expect(doiFullscreen(el, congFullscreen(d2))).toBe("ra");
    expect(ghiDoc2).toEqual(["ra-webkit"]);
    expect(ghiDoc).toEqual([]);
  });

  it("phần tử null ⇒ 'khong-ho-tro', không ném", () => {
    const { d } = docGia(null);
    expect(doiFullscreen(null, congFullscreen(d))).toBe("khong-ho-tro");
  });
});
