/**
 * ★★★ ĐỢT 45 (mục 3) — `dichKhungDoc`: dải máy cấp Line ở nửa GIỮA-DƯỚI canvas, 12/12 + WIP vẫn lọt.
 * Cùng fixture chuyền 2 THẬT của lưới Đợt 35 (`phamViCanh.unit.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TAM_DOC_NDC_LINE,
  dichKhungDoc,
  dinhBBox,
  khoangDocNdc,
  khungNhinLine,
  lotKhung,
} from "./phamViCanh";

const BBOX_L2 = { minX: 4.85, maxX: 33.55, minY: 0, maxY: 1.6, minZ: 14.2, maxZ: 15.4 };
const BBOX_L2_WIP = { ...BBOX_L2, maxY: 6 };
const K1600 = { rongPx: 1288, caoPx: 659 };
const K1280 = { rongPx: 968, caoPx: 479 };
const dist = (k: { viTri: readonly number[]; muc: readonly number[] }) =>
  Math.hypot(k.viTri[0] - k.muc[0], k.viTri[1] - k.muc[1], k.viTri[2] - k.muc[2]);
const tamDoc = (bbox: typeof BBOX_L2, k: { viTri: [number, number, number]; muc: [number, number, number] }, K: typeof K1600) => {
  const kd = khoangDocNdc(dinhBBox(bbox), k.viTri, k.muc, K)!;
  return (kd.min + kd.max) / 2;
};

describe("Đợt 45 mục 3 — dichKhungDoc", () => {
  it("★★★ ĐỐI CHỨNG: sau khớp khung Đợt 35, tâm dải nằm ở TÂM màn (NDC y ≈ 0) — đúng lỗi QA đo", () => {
    for (const K of [K1600, K1280]) {
      const k = khungNhinLine(BBOX_L2_WIP, "X", true, K)!;
      expect(Math.abs(tamDoc(BBOX_L2_WIP, k, K)), `khung ${K.rongPx}`).toBeLessThan(0.05);
    }
  });

  it("★★★ dịch xong: tâm dải ≈ TAM_DOC_NDC_LINE (−0,28 ⇒ 64 % từ trên) ở CẢ hai vp, mọi đỉnh (kèm WIP 6 m) vẫn lọt lề", () => {
    expect(TAM_DOC_NDC_LINE).toBeLessThan(0);
    for (const K of [K1600, K1280]) {
      const k = khungNhinLine(BBOX_L2_WIP, "X", true, K)!;
      const d = dichKhungDoc(BBOX_L2_WIP, k, K);
      expect(tamDoc(BBOX_L2_WIP, d, K), `khung ${K.rongPx}`).toBeCloseTo(TAM_DOC_NDC_LINE, 2);
      expect(lotKhung(dinhBBox(BBOX_L2_WIP), d.viTri, d.muc, K)).toBe(true);
      // Máy (bbox không WIP) nằm THẤP hơn tâm màn rõ rệt: mọi đỉnh máy có NDC y < −0,2.
      const may = khoangDocNdc(dinhBBox(BBOX_L2), d.viTri, d.muc, K)!;
      expect(may.max).toBeLessThan(-0.2);
    }
  });

  it("hướng nhìn, khoảng cách, bán kính, chiếu X GIỮ NGUYÊN — chỉ trượt dọc up′ (x của mục không đổi với trục X)", () => {
    const k = khungNhinLine(BBOX_L2_WIP, "X", true, K1600)!;
    const d = dichKhungDoc(BBOX_L2_WIP, k, K1600);
    expect(dist(d)).toBeCloseTo(dist(k), 6);
    expect(d.banKinh).toBe(k.banKinh);
    expect(d.muc[0]).toBeCloseTo(k.muc[0], 9);
    expect(d.viTri[0]).toBeCloseTo(k.viTri[0], 9);
    // Cùng vector dịch cho camera và mục.
    for (let i = 0; i < 3; i += 1) expect(d.viTri[i] - k.viTri[i]).toBeCloseTo(d.muc[i] - k.muc[i], 9);
    // Mục đi LÊN (nhìn cao hơn ⇒ nội dung xuống dưới màn).
    expect(d.muc[1]).toBeGreaterThan(k.muc[1]);
  });

  it("tất định; tamNdc = 0 ⇒ (gần như) không dịch; lề quá chật không lọt ⇒ trả gốc nguyên vẹn", () => {
    const k = khungNhinLine(BBOX_L2_WIP, "X", true, K1600)!;
    expect(dichKhungDoc(BBOX_L2_WIP, k, K1600)).toEqual(dichKhungDoc(BBOX_L2_WIP, k, K1600));
    // tamNdc = 0 ⇒ chỉ sửa phần lệch nhỏ còn lại sau khớp (|tâm| < 0,05 NDC) — dịch ÍT hơn hẳn mục tiêu mặc định.
    const khong = dichKhungDoc(BBOX_L2_WIP, k, K1600, 0);
    expect(Math.abs(tamDoc(BBOX_L2_WIP, khong, K1600))).toBeLessThan(0.005);
    const macDinh = dichKhungDoc(BBOX_L2_WIP, k, K1600);
    expect(Math.abs(khong.muc[1] - k.muc[1])).toBeLessThan(0.2 * Math.abs(macDinh.muc[1] - k.muc[1]));
    // Khung với lề cực lớn: gốc đã không lọt ⇒ không được bịa tư thế.
    const chat = { ...K1600, lePx: 400 };
    expect(lotKhung(dinhBBox(BBOX_L2_WIP), k.viTri, k.muc, chat)).toBe(false);
    expect(dichKhungDoc(BBOX_L2_WIP, k, chat)).toEqual(k);
    // bbox KHÔNG THỰC (G8: rỗng = Infinity/−Infinity, như `khungNhinCho`) ⇒ gốc nguyên vẹn, cùng tham chiếu.
    const rong = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    expect(dichKhungDoc(rong, k, K1600)).toBe(k);
  });

  it("bước dịch bị CO khi vượt lề: khung thấp (lề ăn gần hết) ⇒ vẫn lọt, tâm dịch ÍT hơn mục tiêu nhưng < 0", () => {
    const K = { rongPx: 1288, caoPx: 330 };
    const k = khungNhinLine(BBOX_L2_WIP, "X", true, K)!;
    const d = dichKhungDoc(BBOX_L2_WIP, k, K);
    expect(lotKhung(dinhBBox(BBOX_L2_WIP), d.viTri, d.muc, K)).toBe(true);
    const tam = tamDoc(BBOX_L2_WIP, d, K);
    expect(tam).toBeLessThanOrEqual(0);
    expect(tam).toBeGreaterThanOrEqual(TAM_DOC_NDC_LINE - 0.01);
  });

  it("★ G16 — `TwinLine` GỌI `dichKhungDoc` sau `khungNhinLine` (không phải hàm mồ côi)", () => {
    const src = readFileSync(new URL("../../../pages/TwinLine.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/dichKhungDoc\(bbox, k, kichThuocKhung\)/);
  });
});
