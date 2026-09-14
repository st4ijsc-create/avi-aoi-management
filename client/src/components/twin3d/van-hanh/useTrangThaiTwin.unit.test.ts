/**
 * Lưới cho T-3 (`useTrangThaiTwin`) — §15.5.2.
 *
 * ★★★ Tệp này chạy dưới `environment: "node"` (RB-8.1 chỉ thu `.unit.test.ts`),
 * nên nó KHÔNG render React. Nó đo hai thứ mà `.dom.test.tsx` không đo được và
 * cũng là hai thứ dễ hỏng CÂM nhất:
 *
 *   1. **BẤT BIẾN G37** — tệp hook **không được chứa** `useSearch`/`useRoute`/
 *      `useLocation`. Đây là bất biến trên MÃ NGUỒN, không phải trên một danh
 *      sách tên tôi nhớ được: nó đọc chính tệp và tìm, nên một người thêm
 *      `useSearch()` vào ngày mai sẽ làm ĐỎ lưới này.
 *
 *      ⚠ Vì sao phải đo bằng bất biến chứ không bằng ca kiểm thử: nếu hook tự
 *      đọc route, nó vẫn CHẠY ĐÚNG trên `/twin` (route mà `useSearch` khớp) và
 *      chỉ sai trên `/twin/line/:id`. Một ca test viết trên `/twin` sẽ XANH
 *      trong khi hàng thật đã hỏng — đúng lớp lỗi `RobotCockpit`/
 *      `StationAnalysis` (`id = NaN`, không exception nào nổ).
 *
 *   2. **Hợp đồng chữ ký** — hook nhận `search` + `dieuHuong` qua THAM SỐ.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { useTrangThaiTwin } from "./useTrangThaiTwin";

const THU_MUC = dirname(fileURLToPath(import.meta.url));
const MA_NGUON = readFileSync(join(THU_MUC, "useTrangThaiTwin.ts"), "utf8");

/** Bỏ chú thích khối và chú thích dòng — docblock CÓ NHẮC TÊN các hook này. */
function boChuThich(ma: string): string {
  return ma.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("★★★ G37 — hook DÙNG CHUNG không được tự đọc route của trang cha", () => {
  const maSach = boChuThich(MA_NGUON);

  /*
   * ★ Ba tên này là toàn bộ cách wouter cho một component tự đọc route.
   *   Liệt kê bằng BẤT BIẾN "không tên nào trong ba", không phải bằng một ca
   *   duy nhất — G70: đếm chỗ gọi phải liệt kê mọi lối, không chỉ lối tôi nhớ.
   */
  it.each(["useSearch", "useRoute", "useLocation"])(
    "KHÔNG gọi %s — ba màn QĐ-19 dùng chung hook này, nó không biết mình ở route nào",
    (ten) => {
      expect(maSach).not.toContain(`${ten}(`);
    },
  );

  it("★ cũng không import gì từ 'wouter' — chặn cả lối vòng", () => {
    expect(maSach).not.toMatch(/from\s+["']wouter["']/);
  });

  it("★ ĐỐI CHỨNG — phép đo này BIẾT KÊU: chuỗi có `useSearch(` thì bị bắt", () => {
    // Nếu ca này xanh mà ba ca trên cũng xanh vì lý do sai (ví dụ `boChuThich`
    // nuốt hết mã), ta sẽ không biết. Ca đối chứng chứng minh bộ dò còn sống.
    expect(boChuThich("const s = useSearch();")).toContain("useSearch(");
  });
});

describe("hợp đồng chữ ký — nhận qua THAM SỐ, không tự lấy", () => {
  it("★ nhận đúng hai tham số: search và dieuHuong", () => {
    expect(useTrangThaiTwin.length).toBe(2);
  });

  it("là một hàm export được (dùng chung cho ba màn)", () => {
    expect(typeof useTrangThaiTwin).toBe("function");
  });
});
