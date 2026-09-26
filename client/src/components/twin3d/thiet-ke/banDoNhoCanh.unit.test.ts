import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CANH_BAN_DO_PX, CANH_BAN_DO_TOI_THIEU_PX, TI_LE_BAN_DO_TREN_KHUNG, canhBanDoTheoKhung } from "./banDoNho";
import { SAN_CAO_CANH_THIET_KE_PX } from "./khungNhin";
import { SAN_CAO_KHUNG_CANH_PX } from "../loi/KhungCanh";

describe("Đợt 45 mục 5 — mini-map theo vùng cảnh + sàn canvas studio", () => {
  it("số đo QA Đợt 44: 1280 vùng 541×193 ⇒ 88 (tối thiểu, thay vì 148 = 82 % cao); 1600 vùng 726×373 ⇒ 148", () => {
    expect(canhBanDoTheoKhung(541, 193)).toBe(CANH_BAN_DO_TOI_THIEU_PX);
    expect(canhBanDoTheoKhung(726, 373)).toBe(CANH_BAN_DO_PX);
  });
  it("sau mục 7 @1280 vùng ~541×290 ⇒ 116 = ⌊290·0,4⌋ — nằm giữa hai kẹp; ≤ 45 % chiều cao", () => {
    const c = canhBanDoTheoKhung(541, 290);
    expect(c).toBe(Math.floor(290 * TI_LE_BAN_DO_TREN_KHUNG));
    // hộp DOM = cạnh + p-1 (4 px ×2) + viền (1 px ×2) = cạnh + 10 — lưới bbox M5 đo ≤ 45 % chiều cao vùng.
    expect(c + 10).toBeLessThanOrEqual(0.45 * 290);
  });
  it("chưa đo được (0/NaN/âm) ⇒ 148 như cũ — jsdom và khung hình đầu không được co bản đồ", () => {
    for (const [r, c] of [[0, 0], [NaN, 300], [300, -1], [Infinity, 300]] as const) expect(canhBanDoTheoKhung(r, c)).toBe(CANH_BAN_DO_PX);
  });
  it("đơn điệu theo cạnh ngắn; không vượt trần; không dưới sàn", () => {
    let truoc = 0;
    for (let h = 100; h <= 600; h += 25) {
      const c = canhBanDoTheoKhung(2000, h);
      expect(c).toBeGreaterThanOrEqual(truoc);
      expect(c).toBeGreaterThanOrEqual(CANH_BAN_DO_TOI_THIEU_PX);
      expect(c).toBeLessThanOrEqual(CANH_BAN_DO_PX);
      truoc = c;
    }
  });
  it("★ G16 — `ThanhCongCuCanh` GỌI `canhBanDoTheoKhung` và SVG lấy cạnh từ đó (viewBox vẫn 148)", () => {
    const src = readFileSync(new URL("./ThanhCongCuCanh.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/canhBanDoTheoKhung\(/);
    expect(src).toMatch(/width=\{canhPx\}/);
    expect(src).toMatch(/viewBox=\{`0 0 \$\{CANH_BAN_DO_PX\} \$\{CANH_BAN_DO_PX\}`\}/);
  });
  it("sàn canvas studio 240 < sàn kit 320 (cùng khuôn màn Máy), và `CanhThietKe` truyền nó", () => {
    expect(SAN_CAO_CANH_THIET_KE_PX).toBe(240);
    expect(SAN_CAO_CANH_THIET_KE_PX).toBeLessThan(SAN_CAO_KHUNG_CANH_PX);
    const src = readFileSync(new URL("./CanhThietKe.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/sanCaoPx=\{SAN_CAO_CANH_THIET_KE_PX\}/);
  });
});
