/**
 * tenKhaTruyCapCuaCanh.unit.test.ts — ★★★ CẢNH TỰ GIỚI THIỆU VỚI TRÌNH ĐỌC MÀN HÌNH
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỆP NÀY TỒN TẠI — MỘT CHỖ DỰA KHÔNG AI GIỮ
 * ════════════════════════════════════════════════════════════════════════════
 * Chủ đợt đo sống trên cổng 3064 (`_probe-aria.mjs`, 2026-09-16), cả hai phạm vi:
 *
 *   tập đoàn 3D    => { ariaTrenCanvas: null, roleTrenCanvas: null,
 *                       toTienGanNhatCoAria: null, soPhanTuCoAriaTrongMan: 18 }
 *   một nhà máy 3D => { ariaTrenCanvas: null, ... soPhanTuCoAriaTrongMan: 19 }
 *
 * Tức `<canvas>` của bản 3D **không có tên khả truy cập**, và **không tổ tiên nào
 * của nó có**. 18-19 phần tử khác trong màn thì có — nên đây không phải "màn này
 * chưa làm a11y", mà là **đúng bề mặt chính bị bỏ trống**.
 *
 * ★★★ NHƯNG KẾT LUẬN "cảnh 3D câm" LÀ SAI, và đó là lý do tệp này ghim HAI thứ
 *   chứ không phải một. Người dùng trình đọc màn hình **vẫn nghe được cảnh**, qua
 *   **hai cơ chế KHÁC NHAU** tuỳ chế độ:
 *
 *     2D — `CanhVanHanh2D.tsx:178` đặt `aria-label={ariaLabel}` THẲNG lên `<svg>`.
 *     3D — không đặt được: chuỗi đi vào `NoiDung {...props}` **bên trong cây
 *          `<Canvas>`**, mà phần tử R3F không sinh DOM nên nó rơi ở đó. Bù lại,
 *          TRANG in cùng chuỗi ấy ra một đoạn `sr-only`
 *          (`TwinVanHanh.tsx`, `data-testid="tom-tat-canh"`), kèm chú thích
 *          nguyên văn *"canvas WebGL vô hình với nó (§9.9)"*.
 *
 * ⇒ Hai lối, một kết cục. Vấn đề là **lối thứ hai không có một ca lưới nào giữ**:
 *   xoá đoạn `sr-only` ấy thì `tsc` xanh, `i18n:check` xanh, 3.022 ca twin3d xanh,
 *   và người dùng trình đọc màn hình mất sạch mô tả cảnh mà **không một cổng nào
 *   kêu**. Đợt này đã đếm được **năm** lời khai sai sống sót nhiều đợt và nhiều
 *   nhánh mã chết chỉ vì không ai ghim — đây là chỗ thứ sáu, ghim trước khi mất.
 *
 * ★ Tệp này đo MÃ NGUỒN chứ không dựng `TwinVanHanh` (trang ấy kéo theo tRPC,
 *   socket, R3F — dựng được thì cũng không còn là phép đo rẻ). Khuôn `docMaNguon`
 *   là khuôn đang dùng của 25 lưới khác trong cây này; nó chuẩn hoá EOL nên không
 *   dính lớp lỗi CRLF của Đợt 63 (G150).
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

const GOC = resolve(__dirname, "../../../..");

/** Mã TRANG, GIỮ NGUYÊN chú thích: ca cuối cần đọc được chính docblock §9.9. */
const TRANG_THO = docMaNguon(resolve(GOC, "src/pages/TwinVanHanh.tsx"));

/** Mã TRANG đã tước chú thích — dùng cho mọi ca đo MÃ SỐNG (G92). */
const TRANG = TRANG_THO.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CANH_2D = docMaNguon(resolve(GOC, "src/components/twin3d/van-hanh/CanhVanHanh2D.tsx"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const NGON_NGU = ["vi", "en", "zh"] as const;
const KHOA = ["canhAria", "canhAria2D", "canhAriaSaBan", "canhAriaSaBan2D"] as const;

const doiTuongNgonNgu = (ngu: string): Record<string, string> => {
  const json = JSON.parse(docMaNguon(resolve(GOC, `src/i18n/locales/${ngu}.json`)));
  return json?.twin3d?.vanHanh ?? {};
};

describe("★★★ Tên khả truy cập của cảnh — HAI lối, và cả hai phải còn", () => {
  it("★ TIỀN ĐỀ: ba tệp đọc được và có kích thước thật (tập rỗng ⇒ mọi ca dưới xanh giả)", () => {
    // G146: `every()`/`toContain` trên chuỗi rỗng không bao giờ đỏ. Khẳng định
    // kích thước TRƯỚC, để một đường dẫn sai không hoá thành một cổng xanh.
    expect(TRANG_THO.length).toBeGreaterThan(50_000);
    expect(TRANG.length).toBeGreaterThan(20_000);
    expect(CANH_2D.length).toBeGreaterThan(2_000);
  });

  it("★★★ LỐI 3D — đoạn `sr-only` `tom-tat-canh` còn sống và in ĐÚNG chuỗi `ariaLabel`", () => {
    const i = TRANG.indexOf('data-testid="tom-tat-canh"');
    expect(i, "đoạn tóm tắt cảnh cho trình đọc màn hình đã BIẾN MẤT").toBeGreaterThan(-1);

    // Cửa sổ cắt theo DẤU KẾT của chính thẻ, không theo độ dài cố định — cùng bài
    // học `usePhanTichLine.unit.test.ts` (cửa sổ cố định đọc lấn hàng xóm).
    const than = TRANG.slice(Math.max(0, i - 200), TRANG.indexOf("</p>", i) + 4);

    // Ba mảnh, mỗi mảnh hỏng một kiểu khác nhau:
    expect(than, "mất `sr-only` ⇒ đoạn văn HIỆN RA giữa màn").toContain("sr-only");
    expect(than, "không in `ariaLabel` ⇒ đoạn rỗng, trình đọc nghe được đúng con số 0").toMatch(
      /\{\s*ariaLabel\s*\}/,
    );
    expect(than, "in chuỗi cứng thay vì biến ⇒ nói sai mỗi khi cảnh đổi").not.toMatch(
      /<p[^>]*>\s*["'`]/,
    );
  });

  it("★★★ LỐI 2D — `aria-label` đặt THẲNG lên `<svg>`, không đi vòng", () => {
    expect(CANH_2D).toMatch(/aria-label=\{\s*ariaLabel\s*\}/);
    // Đối chứng cho chính phép đo trên: chuỗi phải tới từ prop, không phải hằng.
    expect(CANH_2D).toMatch(/\bariaLabel\b\s*,/);
  });

  it("★★★ `ariaLabel` rẽ ĐỦ BỐN nhánh — sa bàn × 2D, và không nhánh nào dùng lại khoá của nhánh khác", () => {
    const i = TRANG.indexOf("const ariaLabel");
    expect(i).toBeGreaterThan(-1);
    const than = TRANG.slice(i, i + 700);

    for (const k of KHOA) {
      expect(than, `nhánh \`${k}\` biến mất khỏi phép rẽ`).toContain(`twin3d.vanHanh.${k}`);
    }
    // Bốn khoá phải XUẤT HIỆN ĐÚNG MỘT LẦN: dùng lại một khoá cho hai nhánh là
    // cách im lặng nhất để một chế độ mô tả chế độ kia (đúng lớp lỗi
    // `CanhVanHanh2D:94` đã khai "cùng hành vi bản 3D" khi bản 3D không có).
    for (const k of KHOA) {
      const n = [...than.matchAll(new RegExp(`twin3d\\.vanHanh\\.${k}\\b`, "g"))].length;
      expect(n, `khoá \`${k}\` xuất hiện ${n} lần trong phép rẽ, phải đúng 1`).toBe(1);
    }
    // Và phép rẽ phải thật sự đọc HAI biến điều kiện, không phải một.
    expect(than).toContain("veSaBan");
    expect(than).toContain("che2D");
  });

  it("★ bốn khoá có đủ ở CẢ BA ngôn ngữ, và en/zh KHÔNG lẫn dấu tiếng Việt", () => {
    const daco = Object.fromEntries(NGON_NGU.map((n) => [n, doiTuongNgonNgu(n)]));
    // Tiền đề: đối tượng phải có nội dung, nếu không mọi khẳng định dưới là rỗng.
    for (const n of NGON_NGU) expect(Object.keys(daco[n]).length).toBeGreaterThan(10);

    for (const n of NGON_NGU) {
      for (const k of KHOA) {
        expect(daco[n][k], `thiếu \`${k}\` ở locale ${n}`).toBeTruthy();
      }
    }
    const dauViet = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
    for (const n of ["en", "zh"] as const) {
      for (const k of KHOA) {
        expect(dauViet.test(daco[n][k]), `\`${k}\` ở locale ${n} còn dấu tiếng Việt`).toBe(false);
      }
    }
  });

  it("★ lý do của lối 3D còn được ghi lại — xoá chú thích là xoá lý do tồn tại của đoạn `sr-only`", () => {
    // Ca này đo mã THÔ (còn chú thích) một cách CÓ CHỦ Ý. Không có câu giải thích
    // ấy, người sau đọc đoạn `sr-only` sẽ tưởng là rác và dọn đi — đúng thứ vừa
    // xảy ra với nhánh `machineId === null` ở `XuongThietKe:1088` (mã chết suốt
    // nhiều đợt vì không ai nhớ nó chờ `onPointerMissed`).
    const i = TRANG_THO.indexOf('data-testid="tom-tat-canh"');
    expect(i).toBeGreaterThan(-1);
    expect(TRANG_THO.slice(Math.max(0, i - 400), i)).toMatch(/Trình đọc màn hình|canvas WebGL/);
  });
});
