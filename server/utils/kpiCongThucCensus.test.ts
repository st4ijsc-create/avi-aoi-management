import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Cổng điều tra dân số: cấm công thức FINAL YIELD viết tay tái xuất hiện.
 * Nguồn sự thật duy nhất là server/utils/kpi.ts.
 *
 * ⚠ Cổng bắt theo HÌNH DẠNG mã nên nó KHÔNG phân biệt được ý nghĩa. Khi nó đỏ,
 * ĐỌC ĐÚNG DÒNG bị tố trước khi sửa — có thể là FPY (lỗi khác) chứ không phải
 * final yield. Sửa nhầm FPY thành finalYield sẽ làm NTF thành first-pass, sai hơn.
 */
const MIEN_TRU_FILE = new Set<string>([
  "server/utils/kpi.ts",
  "server/utils/kpiCongThucCensus.test.ts",
  "server/utils/kpi.test.ts",
]);

/**
 * Miễn trừ theo DÒNG, mỗi mục kèm LÝ DO. Đây là bản kiểm kê nợ đã biết —
 * không phải chỗ để giấu lỗi mới. Thêm mục vào đây phải kèm lý do thật.
 */
const MIEN_TRU_DONG: Array<{ file: string; dong: number; lyDo: string }> = [
  { file: "server/routers/productionDashboardRouter.ts", dong: 236, lyDo: "FPY proxy — lỗi KHÁC, sửa cần firstInspectionsSql" },
  { file: "server/routers/productionDashboardRouter.ts", dong: 426, lyDo: "FPY proxy — lỗi KHÁC" },
  { file: "server/routers/productionDashboardRouter.ts", dong: 474, lyDo: "FPY proxy — lỗi KHÁC" },
  { file: "server/routers/stationAnalysisRouter.ts",     dong: 814, lyDo: "FPY proxy — lỗi KHÁC" },
];

const HINH_DANG_CAM = /\(\s*\(?\s*(ok|okCount|okQuantity)\s*\/\s*(total|totalCount|totalQuantity)\s*\)?\s*\*\s*(100|1000|10000)/i;

/** Bỏ chú thích trước khi khớp — thước không được tố chính lời giải thích về nó. */
function boChuThich(dong: string): string {
  return dong.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "").replace(/\/\*.*?\*\//g, "");
}

function quetFileTs(goc: string): string[] {
  const ra: string[] = [];
  for (const muc of readdirSync(goc, { withFileTypes: true })) {
    const duong = join(goc, muc.name).replace(/\\/g, "/");
    if (muc.isDirectory()) {
      if (muc.name === "node_modules" || muc.name === "dist") continue;
      ra.push(...quetFileTs(duong));
    } else if (muc.name.endsWith(".ts")) {
      ra.push(duong);
    }
  }
  return ra;
}

describe("điều tra dân số công thức final yield", () => {
  it("KHÔNG file nào trong server/ viết lại công thức final yield bằng tay", () => {
    const viPham: string[] = [];
    for (const f of quetFileTs("server")) {
      if (MIEN_TRU_FILE.has(f)) continue;
      // split(/\r?\n/): repo dùng CRLF trên Windows — nếu chỉ split("\n") thì mỗi dòng
      // còn sót "\r" cuối, khiến regex $ (không có cờ m) không khớp nữa trong boChuThich(),
      // tức phần bỏ-chú-thích LẶNG LẼ thất bại và cổng tố nhầm DÒNG TÀI LIỆU (đã đo thật:
      // JSDoc ở stationAnalysisRouter.ts:43 giải thích công thức cũ bị tố sai).
      readFileSync(f, "utf8").split(/\r?\n/).forEach((dong, i) => {
        const soDong = i + 1;
        if (MIEN_TRU_DONG.some((m) => m.file === f && m.dong === soDong)) return;
        if (HINH_DANG_CAM.test(boChuThich(dong))) viPham.push(`${f}:${soDong}  ${dong.trim()}`);
      });
    }
    expect(viPham, `Dùng finalYield() từ server/utils/kpi.ts:\n${viPham.join("\n")}`).toEqual([]);
  });

  it("cổng thật sự quét được file — chống glob rỗng khai xanh giả", () => {
    expect(quetFileTs("server").length).toBeGreaterThan(300);
  });

  it("danh sách miễn trừ không rỗng và mọi mục đều có lý do", () => {
    expect(MIEN_TRU_DONG.length).toBeGreaterThan(0);
    expect(MIEN_TRU_DONG.every((m) => m.lyDo.trim().length > 10)).toBe(true);
  });
});
