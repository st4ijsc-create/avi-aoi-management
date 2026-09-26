import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Cổng điều tra dân số: cấm công thức FINAL YIELD viết tay tái xuất hiện.
 * Nguồn sự thật duy nhất là shared/kpiYield.ts (re-export ở server/utils/kpi.ts).
 *
 * Task 15: mở rộng sang `client/src` — trước bản vá này cổng CHỈ canh `server/`,
 * còn client tự viết tay `(ok+ntf)/total*100` ở 23 chỗ (1 chỗ trong đó SAI:
 * DrillDownDashboard.tsx thiếu hẳn `ntf`) mà không ai bắt được.
 *
 * ★★★ Đợt vá sau-review (2026-08-25): thước CŨ chỉ khớp định danh TRẦN
 * (`ok`, `total`) — `s.ok / s.total`, `Number(d.okCount) / Number(d.totalCount)`,
 * `o / t`, `currentOk / currentTotal` đều MÙ, để lọt ~15 dòng qua 15 lượt review
 * từng-task. HINH_DANG_CAM giờ cho phép một tiền tố thu nhận tuỳ chọn
 * (`[A-Za-z_$][\w$]*\.`) và một lớp bọc `Number(...)` tuỳ chọn quanh mỗi vế,
 * cộng thêm các tên ngắn/biến thể thường gặp (`o`, `t`, `pass`, `currentOk`, …).
 *
 * ⚠ Cổng bắt theo HÌNH DẠNG mã nên nó KHÔNG phân biệt được ý nghĩa. Khi nó đỏ,
 * ĐỌC ĐÚNG DÒNG bị tố trước khi sửa — có thể là FPY (lỗi khác) chứ không phải
 * final yield. Sửa nhầm FPY thành finalYield sẽ làm NTF thành first-pass, sai hơn.
 *
 * ⚠⚠ Cổng này bắt theo HÌNH DẠNG, không phải AST — xanh KHÔNG chứng minh đã quét
 * sạch. Một biến đổi cú pháp đủ lạ (phá vỡ hình dạng `(A/B)*100` mà thước tìm)
 * vẫn có thể lọt qua mà không ai biết, kể cả sau bản mở rộng này.
 */
const MIEN_TRU_FILE = new Set<string>([
  "server/utils/kpi.ts",
  "server/utils/kpiCongThucCensus.test.ts",
  "server/utils/kpi.test.ts",
  // Cổng PARITY MV↔truy-vấn-sống: bản chất của nó là phát biểu công thức ĐỘC LẬP để so
  // với MV — bắt nó dùng helper là làm phép so mất tính độc lập (helper sai thì cả hai
  // vế cùng sai và parity vẫn xanh). Thước mở rộng 2026-08-24 tố tiêu đề `it(...)` của
  // nó — tiêu đề MÔ TẢ công thức, không TÍNH công thức.
  "server/db/mvYieldParity.db.test.ts",
  // shared/kpiYield.ts là NƠI Ở THẬT của công thức (kpi.ts chỉ re-export).
  "shared/kpiYield.ts",
]);

/** Mỗi gốc quét kèm phần mở rộng file được coi là "mã" ở gốc đó. */
const CAC_GOC_QUET: Array<{ goc: string; duoi: string[] }> = [
  { goc: "server", duoi: [".ts"] },
  { goc: "client/src", duoi: [".ts", ".tsx"] },
];

/**
 * Miễn trừ theo DÒNG, mỗi mục kèm LÝ DO. Đây là bản kiểm kê nợ đã biết —
 * không phải chỗ để giấu lỗi mới. Thêm mục vào đây phải kèm lý do thật.
 */
const MIEN_TRU_DONG: Array<{ file: string; dong: number; lyDo: string }> = [
  { file: "server/routers/productionDashboardRouter.ts", dong: 236, lyDo: "FPY proxy — lỗi KHÁC, sửa cần firstInspectionsSql" },
  { file: "server/routers/productionDashboardRouter.ts", dong: 426, lyDo: "FPY proxy — lỗi KHÁC" },
  { file: "server/routers/productionDashboardRouter.ts", dong: 474, lyDo: "FPY proxy — lỗi KHÁC" },
  // ⚠ 814 → 816 → 832 (2026-09-03, BG-96 Task 2 follow-up, HAI đợt vá liên tiếp trong cùng
  // ngày): đợt 1 xoá hàm toFakeUtc + đổi doc-comment (+2 dòng); đợt 2 (Important-2, review)
  // thêm import 4 helper factory-TZ + khối comment + 2 dòng `piLocalDay`/`piLocalHourOfDay`
  // (+16 dòng). Dòng fpy ở đây KHÔNG đổi nội dung qua cả hai đợt, chỉ dịch chuyển — cập nhật
  // số dòng đi CÙNG commit theo đúng khuôn đã có ở dưới.
  { file: "server/routers/stationAnalysisRouter.ts",     dong: 832, lyDo: "FPY proxy — lỗi KHÁC" },

  // ── Đợt vá sau-review (2026-08-25) — thước mở rộng (tiền tố + tên ngắn) khai quật
  // thêm các chỗ TRƯỚC ĐÂY vô hình với thước cũ. Đọc từng dòng trước khi tin dòng này:
  // đây không phải chỗ giấu lỗi mới, là nợ ĐÃ XÁC MINH không phải final-yield-sai.
  { file: "server/routers/productionDashboardRouter.ts", dong: 245, lyDo: "FPY proxy (prevFPY, kỳ trước) — cùng họ với :236, KHÁC lỗi" },
  // ⚠ 179 → 181 → 197 (2026-09-03, BG-96 Task 2 follow-up, cùng hai đợt dịch nêu ở :832 trên).
  { file: "server/routers/stationAnalysisRouter.ts",      dong: 197, lyDo: "FPY proxy (biến fpy, tên ngắn t=total) — cùng họ với :832" },
  { file: "server/services/aiExecutiveReport.ts",          dong: 202, lyDo: "FPY proxy (biến fpy trong gatherKpis) — cùng họ, KHÁC lỗi" },
  // ⚠ 3698 → 3699 (2026-08-24): dòng fy ngay dưới được di trú sang finalYield() và file
  // nhận thêm MỘT dòng import ở đầu ⇒ mọi số dòng phía dưới lệch +1. Miễn trừ theo số
  // dòng GIÒN trước chính loại sửa mà cổng này khuyến khích — cập nhật phải đi CÙNG commit.
  // ⚠ 3699 → 3695 (2026-09-03, BG-96 Task 2): parseLocalDate (server/_core/index.ts) đổi
  // ruột sang gọi docGioTuongNhaMay() — thân hàm cũ 6 dòng co còn 1 dòng, cộng thêm 1 dòng
  // import mới ở đầu file ⇒ lệch RÒNG -4 dòng. Bỏ sót lượt cập nhật này ở commit gốc của
  // Task 2 (chỉ phát hiện khi chạy lại cổng này ở đợt vá toFakeUtc) — bài học: MỌI sửa vào
  // `_core/index.ts` phải chạy cổng này trước khi commit, không chỉ cổng liên quan trực tiếp.
  { file: "server/_core/index.ts",                          dong: 3695, lyDo: "FPY proxy (biến fpy, tên ngắn t=total) — cùng khuôn với stationAnalysisRouter:197" },

  // aiInspectionAnalytics.ts: `pass` ở BỐN dòng này KHÔNG phải OK-only — nó là
  // COUNT(*) FILTER (WHERE finalYieldPassCondSql(...)) tính Ở SQL, tức đã CHÍNH LÀ
  // OK+NTF (xem comment "canonical FINAL-yield definition (OK + NTF)" ngay cạnh mỗi
  // dòng SELECT nguồn). (pass/total)*100 ở đây toán học BẰNG finalYield() — không phải
  // FPY, không phải lỗi; giữ "pass" trong HINH_DANG_CAM vì đề bài yêu cầu bắt hình dạng
  // `pass / total`, nên xử lý bốn ca ĐÃ-ĐÚNG này bằng miễn trừ có lý do thay vì bỏ tên
  // "pass" (bỏ sẽ làm thước mù lại với các `pass/total` SAI thật ở nơi khác).
  { file: "server/services/aiInspectionAnalytics.ts", dong: 569,  lyDo: "pass = SQL FILTER finalYieldPassCondSql (đã OK+NTF) — toán ĐÚNG, không phải FPY" },
  { file: "server/services/aiInspectionAnalytics.ts", dong: 882,  lyDo: "pass = SQL FILTER finalYieldPassCondSql (đã OK+NTF) — toán ĐÚNG, không phải FPY" },
  { file: "server/services/aiInspectionAnalytics.ts", dong: 1501, lyDo: "pass = SQL FILTER finalYieldPassCondSql (đã OK+NTF) — toán ĐÚNG, không phải FPY" },
  { file: "server/services/aiInspectionAnalytics.ts", dong: 1596, lyDo: "pass = SQL FILTER finalYieldPassCondSql (đã OK+NTF) — toán ĐÚNG, không phải FPY" },

  // client/src — biến/field `fpy` là FPY thật (first-pass yield, cố ý loại NTF khỏi
  // tử số), không phải final yield viết sai. ComparisonStudio đặt `fpy` NGAY CẠNH
  // `finalYield` tính đúng bằng finalYield() ở dòng kế — hai field khác nhau CÓ CHỦ Ý.
  // Dashboard.tsx có docblock "doc65 W1" ngay trên xác nhận đây là FPY canonical.
  { file: "client/src/pages/ComparisonStudio.tsx", dong: 230, lyDo: "FPY field, cạnh finalYield tính đúng ở dòng kế — hai metric khác nhau có chủ ý" },
  { file: "client/src/pages/ComparisonStudio.tsx", dong: 270, lyDo: "FPY field, cạnh finalYield tính đúng ở dòng kế — hai metric khác nhau có chủ ý" },
  { file: "client/src/pages/Dashboard.tsx",         dong: 1184, lyDo: "FPY (calculateYields) — docblock doc65 W1 ngay trên xác nhận first-pass yield có chủ ý" },
  { file: "client/src/pages/Dashboard.tsx",         dong: 1206, lyDo: "FPY (yieldAlerts) — cùng quy ước fpy=ok/total với calculateYields ở trên" },

  // RfTestCellSim.tsx: bộ mô phỏng RF test cell — `view` chỉ mô phỏng hai biến ok/ng
  // (total := ok+ng, xem :411), KHÔNG có khái niệm NTF trong dữ liệu giả lập này.
  // Không phải final-yield-sai — không có NTF nào để thiếu.
  { file: "client/src/pages/RfTestCellSim.tsx", dong: 412, lyDo: "bộ mô phỏng: view.ok/view.ng thuần, không có khái niệm NTF trong dữ liệu giả lập" },
];

/**
 * Tên số hạng OK / TOTAL thường gặp trong repo (định danh TRẦN — không kèm tiền tố).
 * Đặt tên DÀI trước tên NGẮN chỉ để dễ đọc; thứ tự KHÔNG ảnh hưởng độ chính xác vì
 * mỗi tên đều được chặn hai đầu bằng `\b` (regex tự backtrack qua các nhánh).
 */
const TEN_OK = "okCount|okQuantity|currentOk|prevOk|passed|pass|ok|o";
const TEN_TOTAL = "totalCount|totalQuantity|currentTotal|prevTotal|total|t";
/** Tiền tố thu nhận tuỳ chọn: `s.`, `stats.`, `d.`, `row.`, ... */
const TIEN_TO_THU_NHAN = String.raw`(?:[A-Za-z_$][\w$]*\.)?`;
/** Lớp bọc `Number(...)` tuỳ chọn quanh mỗi vế (rất phổ biến quanh kết quả SQL). */
function veChia(danhSachTen: string): string {
  return String.raw`(?:Number\(\s*)?${TIEN_TO_THU_NHAN}\b(?:${danhSachTen})\b(?:\s*\))?`;
}
/**
 * Tên vế NTF trong tử số dạng TỔNG — `(ok + ntf) / total`.
 *
 * ⚠ Thêm 2026-08-24, sau khi ĐỘT BIẾN SỐNG SÓT ở cổng ra Pha 0: bơm nguyên văn
 * `((ok + ntf) / total) * 100` vào `cachedStatistics.ts` mà cổng vẫn xanh. Regex cũ chỉ
 * bắt tử số MỘT định danh (`ok / total`), trong khi công thức final-yield chuẩn — thứ cả
 * cổng này sinh ra để gom về `kpi.ts` — có tử số là TỔNG. Người tái phạm nhiều khả năng
 * viết đúng hình dạng tổng, tức cổng mù đúng ca dễ xảy ra nhất.
 * ⇒ Cùng lớp lỗi "lưới đo một hình dạng không tồn tại" đã trả giá ở VRAM Pha 7 — chỉ
 *   khác chiều: ở đây lưới đo hình dạng HẸP HƠN hình dạng thật của món nợ.
 */
const TEN_NTF = "ntfCount|ntfQuantity|ntf|falseCalls|falseCall";
const HINH_DANG_CAM = new RegExp(
  String.raw`\(\s*\(?\s*` +
    veChia(TEN_OK) +
    // Tử số dạng TỔNG (tuỳ chọn): `+ ntf`, có thể đóng ngoặc trước dấu chia.
    String.raw`(?:\s*\+\s*` + veChia(TEN_NTF) + String.raw`\s*\)?)?` +
    String.raw`\s*\/\s*` +
    veChia(TEN_TOTAL) +
    String.raw`\s*\)?\s*\*\s*(100|1000|10000)`,
  "i",
);

/** Bỏ chú thích trước khi khớp — thước không được tố chính lời giải thích về nó. */
function boChuThich(dong: string): string {
  return dong.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "").replace(/\/\*.*?\*\//g, "");
}

function quetFileTs(goc: string, duoi: string[]): string[] {
  const ra: string[] = [];
  for (const muc of readdirSync(goc, { withFileTypes: true })) {
    const duong = join(goc, muc.name).replace(/\\/g, "/");
    if (muc.isDirectory()) {
      if (muc.name === "node_modules" || muc.name === "dist") continue;
      ra.push(...quetFileTs(duong, duoi));
    } else if (duoi.some((d) => muc.name.endsWith(d))) {
      ra.push(duong);
    }
  }
  return ra;
}

/** Toàn bộ file "mã" trên MỌI gốc đang canh (server + client/src). */
function quetTatCaGoc(): string[] {
  return CAC_GOC_QUET.flatMap(({ goc, duoi }) => quetFileTs(goc, duoi));
}

describe("điều tra dân số công thức final yield", () => {
  it("KHÔNG file nào trong server/ hay client/src/ viết lại công thức final yield bằng tay", () => {
    const viPham: string[] = [];
    for (const f of quetTatCaGoc()) {
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
    expect(viPham, `Dùng finalYield() từ shared/kpiYield.ts (re-export ở server/utils/kpi.ts):\n${viPham.join("\n")}`).toEqual([]);
  });

  it("cổng thật sự quét được file — chống glob rỗng khai xanh giả (server + client)", () => {
    // Đo thật lúc viết bản vá này: server/**/*.ts ≈ 2.060 file, client/src/**/*.{ts,tsx} ≈ 827
    // file. Ngưỡng dưới xa dưới thực tế, chỉ để bắt glob RỖNG (0 hoặc gần 0) khai xanh giả —
    // không phải để khớp số chính xác (số file dao động theo commit).
    const server = quetFileTs("server", [".ts"]);
    const client = quetFileTs("client/src", [".ts", ".tsx"]);
    expect(server.length).toBeGreaterThan(300);
    expect(client.length).toBeGreaterThan(300);
    expect(server.length + client.length).toBeGreaterThan(1000);
  });

  it("danh sách miễn trừ không rỗng và mọi mục đều có lý do", () => {
    expect(MIEN_TRU_DONG.length).toBeGreaterThan(0);
    expect(MIEN_TRU_DONG.every((m) => m.lyDo.trim().length > 10)).toBe(true);
  });
});
