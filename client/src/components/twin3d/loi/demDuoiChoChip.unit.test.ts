import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { demDuoiChoChip } from "./locNhan";

/** Vùng cấm đo THẬT trên /twin @1600 (canvas 1288×669, gốc canvas): panel trái 288 px full-height, thanh tua 38 px full-width, viên trạng thái + gợi ý góc trên-phải, KPI nổi trên-trái. */
const RONG = 1288;
const CAO = 669;
const PANEL_TRAI = { trai: 0, phai: 288, tren: 0, duoi: 669 };
const THANH_TUA = { trai: 0, phai: 1288, tren: 631, duoi: 669 };
const VIEN_TT = { trai: 926, phai: 1280, tren: 8, duoi: 37 };
const GOI_Y = { trai: 923, phai: 1280, tren: 48, duoi: 75 };
const KPI = { trai: 8, phai: 216, tren: 8, duoi: 220 };

describe("Đợt 45 mục 4d — demDuoiChoChip: chỉ lớp phủ NGANG QUA TÂM & chạm mép dưới mới đẩy chip", () => {
  it("★★★ đo được (probe-chip.json): bộ vùng cấm thật của /twin ⇒ đệm = 38 (thanh tua), KHÔNG phải 669 (panel trái)", () => {
    expect(demDuoiChoChip([PANEL_TRAI, THANH_TUA, VIEN_TT, GOI_Y, KPI], RONG, CAO)).toBe(38);
  });
  it("★ ĐỐI CHỨNG lỗi 4b/4c: chỉ panel trái ⇒ 0 (trước: 669 = cả canvas ⇒ chip bay lên trên mép)", () => {
    expect(demDuoiChoChip([PANEL_TRAI], RONG, CAO)).toBe(0);
    const cu = [PANEL_TRAI].reduce((m, v) => (v.duoi >= CAO - 1 && v.tren < CAO ? Math.max(m, CAO - v.tren) : m), 0);
    expect(cu).toBe(669); // phép tính cũ — lưới biết kêu
  });
  it("lớp phủ đáy KHÔNG qua tâm (góc phải rộng 300) ⇒ 0; qua tâm ⇒ đúng chiều cao nó chiếm", () => {
    expect(demDuoiChoChip([{ trai: 988, phai: 1288, tren: 600, duoi: 669 }], RONG, CAO)).toBe(0);
    expect(demDuoiChoChip([{ trai: 500, phai: 800, tren: 600, duoi: 669 }], RONG, CAO)).toBe(69);
  });
  it("hai lớp qua tâm ⇒ lấy MAX; không chạm đáy ⇒ 0; canvas rỗng ⇒ 0", () => {
    expect(demDuoiChoChip([THANH_TUA, { trai: 0, phai: 1288, tren: 560, duoi: 669 }], RONG, CAO)).toBe(109);
    expect(demDuoiChoChip([{ trai: 0, phai: 1288, tren: 600, duoi: 640 }], RONG, CAO)).toBe(0);
    expect(demDuoiChoChip([THANH_TUA], 0, 0)).toBe(0);
  });
  it("★ G16 — `LopNhan` GỌI `demDuoiChoChip(vungCam, size.width, size.height)` (không còn reduce tại chỗ)", () => {
    const src = readFileSync(new URL("./LopNhan.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/demDuoiChoChip\(vungCam, size\.width, size\.height\)/);
    expect(src).not.toMatch(/v\.duoi >= size\.height - 1 && v\.tren < size\.height/);
  });
});
