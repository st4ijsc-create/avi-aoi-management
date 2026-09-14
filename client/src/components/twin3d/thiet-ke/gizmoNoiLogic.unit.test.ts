/**
 * Test cho `gizmoNoiLogic.ts` — phần đo được của RB-1/RB-2.
 *
 * ★★★ RB-2 là lý do file này tồn tại. Bằng chứng phải là một khẳng định SO SÁNH
 *   hai công thức, không phải một khẳng định "kết quả là bội của 15": công thức
 *   TƯƠNG ĐỐI của three (`goc + buoc`) cũng cho ra bội của 15 khi góc ban đầu
 *   tình cờ là bội của 15. Chỉ ca "góc ban đầu KHÔNG phải bội của bước" mới
 *   phân biệt được hai công thức — và đó chính là ca 8° của spec.
 */

import { describe, expect, it } from "vitest";

import {
  BUOC_GOC_MAC_DINH_DO,
  BUOC_LUOI_MAC_DINH_MM,
} from "../hinhHocCanChinh";
import {
  CHE_DO_MAC_DINH,
  cheDoTuPhim,
  coTrucHienThi,
  gocSauXoay,
  nenGanGizmo,
  snapDangBat,
  trucSauPhim,
  viTriSauKeo,
  type CheDoGizmo,
} from "./gizmoNoiLogic";

// ---------------------------------------------------------------------------
// Chế độ / phím
// ---------------------------------------------------------------------------

describe("cheDoTuPhim — quy ước Unity W/E (R đã gỡ)", () => {
  it("W → translate, E → rotate", () => {
    expect(cheDoTuPhim("w")).toBe("translate");
    expect(cheDoTuPhim("e")).toBe("rotate");
  });

  it("nhận cả chữ HOA (Shift đang giữ)", () => {
    expect(cheDoTuPhim("W")).toBe("translate");
    expect(cheDoTuPhim("E")).toBe("rotate");
  });

  /**
   * ★★★ G67 — PHÍM R LÀ ĐƯỜNG VÀO THỨ HAI của chế độ scale.
   *
   * Chỉ gỡ nút trên thanh công cụ mà quên phím tắt sẽ để nguyên lời nói dối cũ
   * sau ĐÚNG MỘT phím bấm: người dùng kéo scale, thấy hình đổi, bấm Lưu, và
   * kích thước KHÔNG được ghi (tiLe bị bỏ ở 4 tầng, cả 82 hàng DB vẫn 1.000000).
   * Lưới này ghim cả hai nửa: R không còn ra "scale", VÀ nó trả null để phím
   * rơi về trình duyệt thay vì bị nuốt câm.
   */
  it("★ G67 — R KHÔNG còn là scale, trả null (không nuốt phím)", () => {
    expect(cheDoTuPhim("r")).toBeNull();
    expect(cheDoTuPhim("R")).toBeNull();
  });

  it("★ G8 — phím khác trả NULL để không nuốt phím của trình duyệt", () => {
    expect(cheDoTuPhim("z")).toBeNull();
    expect(cheDoTuPhim("Escape")).toBeNull();
    expect(cheDoTuPhim("ArrowLeft")).toBeNull();
    expect(cheDoTuPhim("")).toBeNull();
  });

  it("chế độ mở màn là di chuyển", () => {
    expect(CHE_DO_MAC_DINH).toBe<CheDoGizmo>("translate");
  });
});

// ---------------------------------------------------------------------------
// ★★★ RB-2 — snap xoay TUYỆT ĐỐI
// ---------------------------------------------------------------------------

describe("gocSauXoay — RB-2", () => {
  it("★★★ 8° với bước 15° cho 15°, KHÔNG phải 23° (công thức tương đối của three)", () => {
    const ket = gocSauXoay(8, true, false, 15);
    expect(ket).toBe(15);
    // Ghim đối chứng: công thức của three cho 23 — hai công thức KHÁC nhau.
    expect(ket).not.toBe(8 + 15);
  });

  it("★★★ chuỗi 8 → snap → snap lại vẫn đứng yên ở 15 (tương đối sẽ trôi 23 → 38)", () => {
    const b1 = gocSauXoay(8, true, false, 15);
    const b2 = gocSauXoay(b1, true, false, 15);
    const b3 = gocSauXoay(b2, true, false, 15);
    expect([b1, b2, b3]).toEqual([15, 15, 15]);
  });

  it("mọi kết quả snap là BỘI của bước", () => {
    for (const g of [0, 3, 8, 14, 22, 37, 89, 91, 179, 271, 359]) {
      expect(gocSauXoay(g, true, false, 15) % 15).toBe(0);
    }
  });

  it("làm tròn về mốc GẦN NHẤT, không về mốc dưới", () => {
    expect(gocSauXoay(14, true, false, 15)).toBe(15);
    expect(gocSauXoay(7, true, false, 15)).toBe(0);
    expect(gocSauXoay(23, true, false, 15)).toBe(30);
  });

  it("góc ÂM cũng snap tuyệt đối; -0 được chuẩn hoá về 0", () => {
    expect(gocSauXoay(-8, true, false, 15)).toBe(-15);
    // `snapGocTuyetDoi` khai rõ nó chuẩn hoá -0 → 0 để deep-equal không lệch.
    expect(Object.is(gocSauXoay(-7, true, false, 15), 0)).toBe(true);
  });

  it("★ G8 — snap TẮT thì trả nguyên giá trị, kể cả giá trị lẻ", () => {
    expect(gocSauXoay(8, false, false, 15)).toBe(8);
    expect(gocSauXoay(37.4, false, false, 15)).toBe(37.4);
  });

  it("★ Ctrl ĐẢO: snap bật + Ctrl ⇒ KHÔNG snap (đường thoát của Blender)", () => {
    expect(gocSauXoay(8, true, true, 15)).toBe(8);
  });

  it("★ Ctrl ĐẢO chiều còn lại: snap tắt + Ctrl ⇒ CÓ snap", () => {
    expect(gocSauXoay(8, false, true, 15)).toBe(15);
  });

  it("bước mặc định là 15°", () => {
    expect(BUOC_GOC_MAC_DINH_DO).toBe(15);
    expect(gocSauXoay(8, true, false)).toBe(15);
  });

  it("bước <= 0 trả nguyên giá trị thay vì NaN (máy góc NaN biến mất khỏi cảnh)", () => {
    expect(gocSauXoay(8, true, false, 0)).toBe(8);
    expect(Number.isNaN(gocSauXoay(8, true, false, 0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Snap tịnh tiến
// ---------------------------------------------------------------------------

describe("viTriSauKeo", () => {
  it("snap X và Z về lưới", () => {
    expect(viTriSauKeo({ x: 137, y: 0, z: 268 }, true, false, 100)).toEqual({
      x: 100,
      y: 0,
      z: 300,
    });
  });

  it("★ KHÔNG snap độ cao Y — cao độ tầng không phải bội của bước lưới", () => {
    expect(viTriSauKeo({ x: 0, y: 2850, z: 0 }, true, false, 100).y).toBe(2850);
  });

  it("★ G8 — snap tắt trả NGUYÊN vị trí lẻ", () => {
    expect(viTriSauKeo({ x: 137, y: 0, z: 268 }, false, false, 100)).toEqual({
      x: 137,
      y: 0,
      z: 268,
    });
  });

  it("Ctrl đảo cả hai chiều", () => {
    expect(viTriSauKeo({ x: 137, y: 0, z: 0 }, true, true, 100).x).toBe(137);
    expect(viTriSauKeo({ x: 137, y: 0, z: 0 }, false, true, 100).x).toBe(100);
  });

  it("bước mặc định là 100 mm", () => {
    expect(BUOC_LUOI_MAC_DINH_MM).toBe(100);
    expect(viTriSauKeo({ x: 137, y: 0, z: 0 }, true, false).x).toBe(100);
  });

  it("trả về đối tượng MỚI, không sửa tại chỗ", () => {
    const goc = { x: 137, y: 0, z: 0 };
    const ket = viTriSauKeo(goc, true, false, 100);
    expect(goc.x).toBe(137);
    expect(ket).not.toBe(goc);
  });
});

describe("snapDangBat — bảng chân trị đầy đủ của ngữ nghĩa ĐẢO", () => {
  it("bốn tổ hợp", () => {
    expect(snapDangBat(true, false)).toBe(true);
    expect(snapDangBat(true, true)).toBe(false);
    expect(snapDangBat(false, false)).toBe(false);
    expect(snapDangBat(false, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Khoá trục
// ---------------------------------------------------------------------------

describe("trucSauPhim", () => {
  it("từ tự do sang khoá một trục", () => {
    expect(trucSauPhim(null, "x")).toBe("X");
    expect(trucSauPhim(null, "Y")).toBe("Y");
    expect(trucSauPhim(null, "z")).toBe("Z");
  });

  it("★ bấm LẠI cùng phím thì MỞ khoá (đảo)", () => {
    expect(trucSauPhim("X", "x")).toBeNull();
  });

  it("bấm phím khác thì chuyển sang trục đó", () => {
    expect(trucSauPhim("X", "z")).toBe("Z");
  });

  it("★ G8 — phím không phải XYZ giữ nguyên trạng thái", () => {
    expect(trucSauPhim("X", "w")).toBe("X");
    expect(trucSauPhim(null, "Escape")).toBeNull();
  });
});

describe("coTrucHienThi", () => {
  it("không khoá ⇒ hiện cả ba trục", () => {
    expect(coTrucHienThi(null)).toEqual({ x: true, y: true, z: true });
  });

  it("★ khoá X ⇒ CHỈ hiện X (ngữ nghĩa Blender: 'khoá X' = chỉ trượt dọc X)", () => {
    expect(coTrucHienThi("X")).toEqual({ x: true, y: false, z: false });
    expect(coTrucHienThi("Z")).toEqual({ x: false, y: false, z: true });
  });

  it("★ G8 — mỗi khoá làm ít nhất một cờ FALSE", () => {
    for (const t of ["X", "Y", "Z"] as const) {
      const c = coTrucHienThi(t);
      expect([c.x, c.y, c.z].filter((v) => v === false)).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Điều kiện gắn gizmo
// ---------------------------------------------------------------------------

describe("nenGanGizmo", () => {
  it("có vật thể và chưa khoá ⇒ gắn", () => {
    expect(nenGanGizmo(true, false)).toBe(true);
  });

  it("★ G8 — vật thể ĐÃ KHOÁ thì KHÔNG gắn (cột daKhoa phải mua được cái gì đó)", () => {
    expect(nenGanGizmo(true, true)).toBe(false);
  });

  it("★ G8 — không chọn gì thì không gắn", () => {
    expect(nenGanGizmo(false, false)).toBe(false);
    expect(nenGanGizmo(false, true)).toBe(false);
  });
});
