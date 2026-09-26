/**
 * kpiThuOKhungHepCaHaiMan.unit.test.ts — **BẢNG KPI THU Ở KHUNG HẸP, TRÊN CẢ HAI MÀN.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ "VÁ XONG PHẢI KIỂM NHÁNH KIA" — VÀ LẦN NÀY NHÁNH KIA ĐÃ BỊ BỎ QUÊN
 * ════════════════════════════════════════════════════════════════════════════
 * HM-2 đo được ở `/twin`: ở khung ≤ 1366 px, bảng KPI phủ **70,8 %** canvas và chỉ **1/24** máy
 * hỏng còn đọc được tên. Bản vá cho bảng **mặc định thu** ở khung hẹp ⇒ 1 → 7 tên.
 *
 * Bản vá ấy chỉ vào `TwinVanHanh.tsx`. Màn Line giữ nguyên `useState(true)` — bảng **luôn mở**.
 * Đo ở `/twin/line/526` sau khi trải sơ đồ:
 *
 *   | khung | `biChe` (tên bị lớp phủ che) |
 *   |---|---|
 *   | 1280×720  | **5** |
 *   | 1920×1080 | **0** |
 *
 * `biChe = 0` ở khung rộng chứng minh đây là khuyết tật **BỐ CỤC**, không phải khuyết tật nhãn.
 * Sau khi áp cùng luật: **5 → 0**, và nghiệm thu bấm (39/39 đạt 24×24) **không đổi một ô**.
 *
 * ★ Tệp này ghim CẢ HAI màn trong MỘT ca, cố ý: một luật bố cục chỉ đúng ở một bề mặt thì nó
 *   không phải luật, nó là một lần vá lẻ — và lần vá lẻ ấy vừa tốn thêm một vòng đo để phát hiện.
 *
 * ★ Hạng B (đo VĂN BẢN của trang): luật nằm trong thân component React. Hành vi của chính
 *   `useKhungHep` đã có lưới riêng (`useKhungHep.dom.test.tsx`); tệp này chỉ hỏi **trang có
 *   dùng nó không**, đúng lớp G93.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

const GOC = resolve(__dirname, "../../../..");
/**
 * ⚠⚠ **G92 — TƯỚC CHÚ THÍCH TRƯỚC KHI ĐO.** Ca đầu của chính tệp này đã dính: nó tra
 *    `"useKhungHep(1366)"` trên văn bản THÔ, và docblock mà tôi vừa viết trong `TwinLine.tsx`
 *    nhắc nguyên văn chuỗi ấy. Đột biến `const khungHep = false;` **sống sót** — thước báo ĐẠT
 *    cho một trang đã gỡ mất bản vá. Một chú thích tốt không được biến thành một phép đo giả.
 */
const doc = (t: string) =>
  docMaNguon(resolve(GOC, "src/pages", t))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("★★★ bảng KPI thu ở khung hẹp — CẢ HAI màn, cùng một ngưỡng", () => {
  for (const tep of ["TwinVanHanh.tsx", "TwinLine.tsx"]) {
    it(`${tep} dùng \`useKhungHep(1366)\` để quyết mặc định`, () => {
      const ma = doc(tep);
      expect(ma).toContain("useKhungHep(1366)");
    });

    it(`★★★ ${tep} KHÔNG mở cứng bảng KPI (một hằng \`true\` là chính khuyết tật)`, () => {
      expect(doc(tep)).not.toMatch(/const \[moKpi,\s*datMoKpi\] = useState\(true\)/);
    });
  }

  it("★★★ LỰA CHỌN CỦA NGƯỜI DÙNG THẮNG mặc định — ép thu là lấy mất quyền quyết định", () => {
    // Màn Vận hành: `daTuMoKpi`. Màn Line: `moKpiTay ?? !khungHep` (gói trong một biến vì màn
    // này không ghi ngược `?thu=`). Hai hình dạng, CÙNG một cam kết.
    expect(doc("TwinVanHanh.tsx")).toContain("daTuMoKpi");
    expect(doc("TwinLine.tsx")).toContain("moKpiTay ?? !khungHep");
  });

  it("★ màn Line vẫn truyền `mo={moKpi}` xuống `BangKpiNoi` (gỡ chặng này là vá thành vô can)", () => {
    const ma = doc("TwinLine.tsx");
    expect(ma).toContain("mo={moKpi}");
    expect(ma).toContain("onDoiMo={datMoKpi}");
  });
});
