/**
 * ★★★ 2026-08-23 — LƯỚI CHO TRẦN KHUNG LÀM VIỆC: **hằng đoán bị thay bằng phép đo**.
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest client gom bằng `client/src/**\/*.unit.test.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA BỘ SỐ Ở §1 LÀ SỐ **ĐO ĐƯỢC**, KHÔNG PHẢI SỐ SUY RA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chúng lấy từ `getBoundingClientRect`/`getComputedStyle` trên `/ai-coding-workspace` chạy thật
 * (Playwright, 2026-08-23), mỗi cỡ một lượt:
 *
 *   cỡ màn      đỉnh khung(tuyệt đối)   đệm dưới   cao khung SAU vá   thừa trang TRƯỚC vá
 *   1600×1000        226 px               48 px        726 px               138 px
 *   1280×800         226 px               48 px        526 px               138 px
 *    900×700         255 px               48 px        397 px               167 px
 *
 * ⚠⚠ `demDuoi = 48`, **không phải 96**, và con số ấy là bài học: `<main>` mang chuỗi lớp
 *    `p-3 sm:p-4 md:p-6 pb-24`, đọc bằng mắt thì "đệm dưới 96 px" (`pb-24`), nhưng ở `md` luật
 *    `p-6` (24 px) đứng SAU trong biểu định kiểu nên nó THẮNG. Giá trị thật là 24 px của `main` +
 *    24 px của `PageContainer`. Tức một bản vá "sửa hằng 8.5rem thành hằng khác" tính bằng tay sẽ
 *    lệch **48 px** — và lệch im lặng. Đó là toàn bộ lý do trần này phải ĐO chứ không được KHAI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SAN_CAO_KHUNG_PX,
  SAN_KHUNG_PX,
  TONG_TOI_THIEU_BA_KHUNG_PX,
  conCuonDuoc,
  tinhChieuCaoVua,
  xepMotKhung,
} from "./khungVuaManHinh";

/** Ba lượt đo THẬT. `caoCu` = chiều cao mà hằng `calc(100vh-8.5rem)` sinh ra ở cỡ ấy. */
const DO_THAT = [
  { ten: "1600×1000", dinhTuyetDoi: 226, caoManHinh: 1000, demDuoi: 48, caoSauVa: 726, caoCu: 1000 - 136, thuaTruocVa: 138 },
  { ten: "1280×800", dinhTuyetDoi: 226, caoManHinh: 800, demDuoi: 48, caoSauVa: 526, caoCu: 800 - 136, thuaTruocVa: 138 },
  { ten: "900×700", dinhTuyetDoi: 255, caoManHinh: 700, demDuoi: 48, caoSauVa: 397, caoCu: 700 - 136, thuaTruocVa: 167 },
] as const;

describe("§1 TRẦN KHUNG — khớp ĐÚNG con số trình duyệt đã dựng", () => {
  for (const d of DO_THAT) {
    it(`${d.ten}: tinhChieuCaoVua = ${d.caoSauVa} px, và trang KHÔNG còn cuộn được`, () => {
      // `toBe`, không `toBeCloseTo`: bài học repo — số TỤT nguy hiểm hơn số PHÌNH, mọi ngân sách
      // phải khớp tuyệt đối để một lượt trôi 5 px cũng bị bắt.
      expect(tinhChieuCaoVua(d)).toBe(d.caoSauVa);
      expect(conCuonDuoc(d)).toBe(false);
    });
  }

  it("★ CHỐNG TỰ THOẢ — hằng CŨ `calc(100vh-8.5rem)` phải làm vị từ nói CÓ CUỘN ở cả ba cỡ", () => {
    // Không có ô này, ba ô trên có thể xanh vì `conCuonDuoc` luôn trả `false` — một vị từ chết.
    for (const d of DO_THAT) {
      const conCuonVoiHangCu = d.caoCu + d.dinhTuyetDoi + d.demDuoi > d.caoManHinh;
      expect(conCuonVoiHangCu, d.ten).toBe(true);
      // …và cuộn đúng bằng phần thừa ĐO ĐƯỢC ở trình duyệt.
      expect(d.caoCu + d.dinhTuyetDoi + d.demDuoi - d.caoManHinh, d.ten).toBe(d.thuaTruocVa);
    }
  });

  it("★ đệm dưới bị BỎ QUA ⇒ trang cuộn lại (chứng minh ô `demDuoi` không phải trang trí)", () => {
    for (const d of DO_THAT) {
      const cao = tinhChieuCaoVua({ ...d, demDuoi: 0 });
      expect(cao, d.ten).toBe(d.caoSauVa + d.demDuoi);
      expect(cao + d.dinhTuyetDoi + d.demDuoi > d.caoManHinh, d.ten).toBe(true);
    }
  });

  it("SÀN cứng: màn quá thấp ⇒ trả về sàn, và lúc ấy trang LẠI cuộn được (đánh đổi đã nói ra)", () => {
    const p = { dinhTuyetDoi: 255, caoManHinh: 420, demDuoi: 48 };
    expect(tinhChieuCaoVua(p)).toBe(SAN_CAO_KHUNG_PX);
    expect(conCuonDuoc(p)).toBe(true);
  });
});

describe("§2 BA KHUNG HAY MỘT KHUNG — hỏi BỀ RỘNG KHUNG, không hỏi cửa sổ", () => {
  /**
   * ★★★ 2026-08-23 — CỘT "PHIÊN" ĐÃ THÀNH POPOVER ⇒ ngưỡng tụt 1110 → 920. Ba track dưới đây là
   * SỐ ĐO trên grid `minmax` THẬT dựng trong Chromium (không phải cộng tay từ spec):
   *
   *   khung cha   TRƯỚC (4 cột)              SAU (3 cột)                Trình xem được gì
   *   1240 px     190 · 240 · 370 · 440      240 · 560 · 440            +190 px (370 → 560)
   *    920 px     một-khung (920 < 1110)     240 · 320 · 360 vừa khít   ba khung CÙNG hiện
   *    756 px     một-khung                  một-khung (756 < 920)      (không đổi)
   */
  it("ngưỡng = tổng ba sàn = 920 px", () => {
    expect(TONG_TOI_THIEU_BA_KHUNG_PX).toBe(920);
  });

  it("ba bề rộng khung ĐO ĐƯỢC quyết định đúng chế độ", () => {
    // Đo thật: cửa sổ 1600 ⇒ khung 1240 · cửa sổ 1280 ⇒ khung 920 · cửa sổ 900 ⇒ khung 756.
    expect(xepMotKhung(1240)).toBe(false);
    // ★ MỐC CỦA ĐỢT BỎ CỘT: khung 920 TRƯỚC là một-khung, NAY ba khung vừa khít (240+320+360).
    expect(xepMotKhung(920)).toBe(false);
    expect(xepMotKhung(756)).toBe(true);
  });

  it("★ CHỐNG QUAY LẠI 4 CỘT: `SAN_KHUNG_PX` không còn ô `phien`, và ngưỡng KHÔNG là 1110", () => {
    // Mọc lại ô `phien` (tức mọc lại cột thứ tư) thì hai khẳng định này ĐỎ trước cả khi ai đó
    // kịp sửa `grid-cols` — §3 bắt nốt phía trang.
    expect("phien" in SAN_KHUNG_PX).toBe(false);
    expect(TONG_TOI_THIEU_BA_KHUNG_PX).not.toBe(1110);
  });

  it("biên: đúng ngưỡng thì vẫn là BA khung; thiếu 1 px thì MỘT khung", () => {
    expect(xepMotKhung(TONG_TOI_THIEU_BA_KHUNG_PX)).toBe(false);
    expect(xepMotKhung(TONG_TOI_THIEU_BA_KHUNG_PX - 1)).toBe(true);
  });

  it("★ nhịp render đầu (chưa đo được gì, bề rộng 0) ⇒ KHÔNG nháy sang chế độ hẹp", () => {
    expect(xepMotKhung(0)).toBe(false);
  });
});

describe("§3 BA SÀN PHẢI KHỚP `grid-cols` CỦA TRANG — hai chỗ, một sự thật", () => {
  const trang = readFileSync(
    join(resolve(dirname(fileURLToPath(import.meta.url)), "..", "pages"), "AICodingWorkspace.tsx"),
    "utf8",
  );

  it("`grid-cols` trong AICodingWorkspace.tsx dùng đúng 240/320/360", () => {
    const m = /grid-cols-\[(\d+)px_minmax\((\d+)px,1fr\)_minmax\((\d+)px,(\d+)px\)\]/.exec(trang);
    expect(m, "không tìm thấy grid-cols ba khung trong trang").not.toBeNull();
    const [, tep, xem, chat, tranChat] = m!;
    expect(Number(tep)).toBe(SAN_KHUNG_PX.tep);
    expect(Number(xem)).toBe(SAN_KHUNG_PX.xem);
    expect(Number(chat)).toBe(SAN_KHUNG_PX.chat);
    // Trần cột hội thoại phải LỚN HƠN sàn (nới được) nhưng CÓ trần — không có trần thì nó nuốt
    // `1fr` của Trình xem và ta quay lại đúng lỗi 82 px, chỉ đổi chiều.
    expect(Number(tranChat)).toBeGreaterThan(SAN_KHUNG_PX.chat);
  });

  it("★ CHỐNG QUAY LẠI 4 CỘT: không còn `grid-cols` nào mở đầu bằng HAI cột cố định", () => {
    // Hình dạng 4 cột cũ là `[190px_240px_…]` — hai track px liền nhau. Ai khôi phục cột phiên
    // (dù đổi số 190 thành số khác) đều tạo lại hình dạng ấy ⇒ ô này ĐỎ.
    expect(trang).not.toMatch(/grid-cols-\[\d+px_\d+px_/);
  });

  it("★ sàn Trình xem ≥ 320 — con số cổng ra đòi, và bản cũ đo được 82", () => {
    expect(SAN_KHUNG_PX.xem).toBeGreaterThanOrEqual(320);
    expect(82).toBeLessThan(SAN_KHUNG_PX.xem); // ghi lại phép đo cũ để không ai "tối ưu" sàn xuống
  });
});

describe("§4 CUỘN TỰ ĐỘNG KHÔNG ĐƯỢC CHẠM VÀO TRANG", () => {
  /**
   * ⚠ Ô này QUÉT VĂN BẢN mã nguồn, và như vậy nó chỉ trả lời *"mã có hình dạng ấy không"* — yếu hơn
   *   §1/§2. Nó là **đai thứ hai**: §1 đã đóng GỐC RỄ (trang không cuộn được nữa thì không cú cuộn
   *   nào kéo nổi nó), ô này đóng ĐƯỜNG (không còn lời gọi kéo được cả tài liệu). Đừng để nó trôi
   *   thành "đã canh rồi" — bằng chứng thật là phép đo live: `window.scrollY` **138 → 0** lúc vào màn.
   */
  it("`AICodingWorkspace.tsx` KHÔNG còn gọi `scrollIntoView` (nó cuộn MỌI tổ tiên, kể cả tài liệu)", () => {
    const trang = readFileSync(
      join(resolve(dirname(fileURLToPath(import.meta.url)), "..", "pages"), "AICodingWorkspace.tsx"),
      "utf8",
    );
    // Bỏ chú thích trước: docblock của bản vá NHẮC tới `scrollIntoView` để giải thích vì sao bỏ nó,
    // và nếu đếm cả chú thích thì ô này ĐỎ vì chính lời giải thích — xanh/đỏ vì lý do sai.
    const ma = trang.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(ma).not.toContain("scrollIntoView");
    // …và vẫn PHẢI còn cuộn khung hội thoại (chống vá quá tay: gỡ sạch = hội thoại đứng im).
    expect(ma).toContain("scroll-area-viewport");
    expect(ma).toContain("scrollTop");
  });
});
