/**
 * khungNhinSoDoLine.unit.test.ts — KHUNG NHÌN CỦA BỐ CỤC SƠ ĐỒ MÀN LINE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TỆP NÀY GHIM MỘT KHUYẾT TẬT MÀ TÔI ĐÃ MẮC **HAI LẦN Ở ĐÚNG MỘT CHỖ**
 * ════════════════════════════════════════════════════════════════════════════
 * Cả hai lần đều là "lấy một thống kê của bbox làm mặt phẳng máy", và cả hai lần đều **không có
 * lỗi nào nổ** — chỉ có cảnh trống và một con số vô lý ở phép đo live:
 *
 *   lần 1: `muc.y = tamBBox(bbox).y`  ⇒ ngắm cao hơn sàn 8,3 m  ⇒ lấp 333 % / 1.134 %
 *   lần 2: `muc.y = bbox.minY`        ⇒ ngắm thấp hơn máy 16,6 m ⇒ máy chiếu xuống y ≈ 975 px
 *
 * Lý do gốc: bbox của màn Line trộn **ba** cao độ khác nhau —
 *   · mặt phẳng máy (ở `/twin/line/526` là **tầng 3, y = 16,6 m**);
 *   · đáy cột WIP, mà `bboxKemCotWip` **ép cứng `minY: 0`**;
 *   · đỉnh cột WIP (tới 16,6 m, vì chiều cao cột mã hoá 314 WIP).
 * Không một thống kê nào của một bbox như thế trả lời được câu *"mặt phẳng máy ở đâu"*.
 * Chỉ **tập máy** trả lời được, nên `yMatPhang` phải được TRUYỀN VÀO, không được suy ra.
 *
 * ⇒ Ca ★★★ đầu tiên dưới đây dựng lại đúng hình dạng bbox ấy và đòi camera ngắm vào 16,6.
 *   Nó đỏ với cả hai bản sai, và đó là toàn bộ lý do nó tồn tại.
 */
import { describe, expect, it } from "vitest";

import {
  HE_SO_CAO_SO_DO_LINE,
  HE_SO_LUI_SO_DO_LINE,
  dinhBBox,
  khungNhinSoDoLine,
  lotKhung,
} from "./phamViCanh";
import { bboxRong, type BBox } from "../heToaDo";

/** Hình dạng bbox ĐÃ ĐO ở `/twin/line/526`: máy trên tầng 3, cột WIP từ y=0. */
const BBOX_TANG_3: BBox = {
  minX: 117.52,
  maxX: 130.48,
  minY: 0,
  maxY: 16.6,
  minZ: 127.84,
  maxZ: 132.16,
};
const Y_MAT_PHANG = 16.6;

describe("khungNhinSoDoLine", () => {
  it("★★★ NGẮM VÀO MẶT PHẲNG MÁY — không vào tâm dọc bbox (8,3), không vào `minY` (0)", () => {
    const k = khungNhinSoDoLine(BBOX_TANG_3, Y_MAT_PHANG)!;
    expect(k.muc[1]).toBeCloseTo(Y_MAT_PHANG, 9);
    expect(k.muc[1]).not.toBeCloseTo((BBOX_TANG_3.minY + BBOX_TANG_3.maxY) / 2, 3);
    expect(k.muc[1]).not.toBeCloseTo(BBOX_TANG_3.minY, 3);
  });

  it("★★★ ngắm vào TÂM NGANG của bbox (x, z) — lưới nằm giữa khung", () => {
    const k = khungNhinSoDoLine(BBOX_TANG_3, Y_MAT_PHANG)!;
    expect(k.muc[0]).toBeCloseTo((BBOX_TANG_3.minX + BBOX_TANG_3.maxX) / 2, 9);
    expect(k.muc[2]).toBeCloseTo((BBOX_TANG_3.minZ + BBOX_TANG_3.maxZ) / 2, 9);
  });

  it("★★★ nhìn GẦN THẲNG ĐỨNG (~14° khỏi phương đứng) — không phải góc thấp của bố cục dải", () => {
    const k = khungNhinSoDoLine(BBOX_TANG_3, Y_MAT_PHANG)!;
    const cao = k.viTri[1] - k.muc[1];
    const ngang = Math.hypot(k.viTri[0] - k.muc[0], k.viTri[2] - k.muc[2]);
    expect(cao).toBeGreaterThan(0);
    const gocKhoiPhuongDung = (Math.atan2(ngang, cao) * 180) / Math.PI;
    expect(gocKhoiPhuongDung).toBeGreaterThan(5);
    expect(gocKhoiPhuongDung).toBeLessThan(25);
    // …và đúng bằng cặp hằng đã khai (hai hằng này là MỘT gói với `heSoNghieng` của `soDoLine`).
    expect(Math.atan2(HE_SO_LUI_SO_DO_LINE, HE_SO_CAO_SO_DO_LINE)).toBeCloseTo(
      Math.atan2(ngang, cao),
      9,
    );
  });

  it("★★★ có khung canvas ⇒ MỌI đỉnh bbox lọt khung (khớp thật, không chỉ đổi số)", () => {
    const khung = { rongPx: 968, caoPx: 437.5 };
    const k = khungNhinSoDoLine(BBOX_TANG_3, Y_MAT_PHANG, khung)!;
    expect(lotKhung(dinhBBox(BBOX_TANG_3), k.viTri, k.muc, khung)).toBe(true);
  });

  it("★★★ CA NGHỊCH — KHÔNG có khung thì KHÔNG khớp: hai đường phải cho hai kết quả khác nhau", () => {
    const khong = khungNhinSoDoLine(BBOX_TANG_3, Y_MAT_PHANG)!;
    const co = khungNhinSoDoLine(BBOX_TANG_3, Y_MAT_PHANG, { rongPx: 968, caoPx: 437.5 })!;
    expect(co.viTri[1]).not.toBeCloseTo(khong.viTri[1], 3);
    // Hướng nhìn thì GIỮ NGUYÊN — `khopKhungNhin` chỉ đổi "bao nhiêu xa".
    const huong = (k: typeof co) =>
      Math.atan2(Math.hypot(k.viTri[0] - k.muc[0], k.viTri[2] - k.muc[2]), k.viTri[1] - k.muc[1]);
    expect(huong(co)).toBeCloseTo(huong(khong), 9);
  });

  it("★★★ khung HẸP hơn ⇒ camera phải LÙI XA hơn (ghim rằng khung canvas được dùng thật)", () => {
    const rong = khungNhinSoDoLine(BBOX_TANG_3, Y_MAT_PHANG, { rongPx: 1600, caoPx: 720 })!;
    const hep = khungNhinSoDoLine(BBOX_TANG_3, Y_MAT_PHANG, { rongPx: 400, caoPx: 720 })!;
    expect(hep.viTri[1] - hep.muc[1]).toBeGreaterThan(rong.viTri[1] - rong.muc[1]);
  });

  it("★★★ G8 — bbox KHÔNG THỰC ⇒ `null`, không phải một khung nhìn trông hợp lệ", () => {
    expect(khungNhinSoDoLine(bboxRong(), 0)).toBeNull();
  });

  it("★★★ `yMatPhang` RÁC ⇒ rơi về tâm dọc bbox, KHÔNG ra NaN (camera NaN = màn trắng câm)", () => {
    for (const rac of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const k = khungNhinSoDoLine(BBOX_TANG_3, rac)!;
      expect(k).not.toBeNull();
      for (const v of [...k.viTri, ...k.muc, k.banKinh]) expect(Number.isFinite(v)).toBe(true);
      expect(k.muc[1]).toBeCloseTo((BBOX_TANG_3.minY + BBOX_TANG_3.maxY) / 2, 6);
    }
  });

  it("★ bbox suy biến một chiều (lưới một hàng) ⇒ vẫn có bán kính DƯƠNG", () => {
    const det: BBox = { minX: 0, maxX: 10, minY: 2, maxY: 2, minZ: 5, maxZ: 5 };
    const k = khungNhinSoDoLine(det, 2)!;
    expect(k.banKinh).toBeGreaterThan(0);
    expect(k.viTri[1]).toBeGreaterThan(k.muc[1]);
  });
});
