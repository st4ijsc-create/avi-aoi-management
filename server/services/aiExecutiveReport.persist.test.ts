/**
 * Vòng sửa 1 (code review round 1) — round-1 `hasReportableContent` checked
 * `s.highlights` / `s.risks` / `s.recommendations` first. Those three arrays are ALWAYS
 * non-empty for every real call: `offlineSummary()` (aiExecutiveReport.ts:368-423) fills
 * them unconditionally — highlights always gets a "Sản lượng: 0 (OK 0/NG 0)" line, risks
 * always falls back to "Không phát hiện rủi ro nghiêm trọng trong kỳ.", recommendations
 * always ends with "Tiếp tục theo dõi...". `generateExecutiveSummary` only overwrites a
 * section when the LLM actually supplied one (:542-548), so the offline fallback survives
 * untouched whenever the LLM is skipped/unavailable/empty. Net effect: the round-1
 * predicate always returned `true` in production, making the empty-report guard dead
 * code — exactly the `fpy:0, ngRate:0` bug the brief was written to fix kept happening.
 *
 * Fix: `hasReportableContent` now reads RAW KPI signals only (`s.kpis.totalInspections`,
 * `s.kpis.pdmRiskMachines`), never the narrative arrays derived from them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks for generateExecutiveSummary's KPI sources + DB (same pattern used by
// aiExecutiveReport.test.ts) — needed ONLY for the "real offlineSummary() output" test
// below, which must exercise the actual generation path (not a hand-typed fixture) to
// prove the predicate reacts correctly to what production genuinely produces for a
// period with zero inspections.
const getDb = vi.fn();
const getYieldTrendData = vi.fn();
const paretoByDefectType = vi.fn();
const getMachines = vi.fn();
const computeFailureRisk = vi.fn();

vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));
vi.mock("../db/statistics", () => ({ getYieldTrendData: (...a: unknown[]) => getYieldTrendData(...a) }));
vi.mock("./paretoAnalysisService", () => ({ paretoByDefectType: (...a: unknown[]) => paretoByDefectType(...a) }));
vi.mock("../db/hierarchy", () => ({ getMachines: (...a: unknown[]) => getMachines(...a) }));
vi.mock("./predictiveMaintenanceService", () => ({ computeFailureRisk: (...a: unknown[]) => computeFailureRisk(...a) }));

import { hasReportableContent, generateExecutiveSummary } from "./aiExecutiveReport";

const base = {
  headline: "", highlights: [] as string[], risks: [] as string[], recommendations: [] as string[],
  kpis: { fpy: 0, ngRate: 0 } as any,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Ca không có dữ liệu: không lượt kiểm tra, không xu hướng, không lỗi, không máy rủi ro.
  const zeroSelect: any = { from: () => zeroSelect, where: () => Promise.resolve([{ total: 0, ok: 0, ng: 0 }]) };
  getDb.mockResolvedValue({ select: () => zeroSelect });
  getYieldTrendData.mockResolvedValue([]);
  paretoByDefectType.mockResolvedValue({ items: [] });
  getMachines.mockResolvedValue([]);
});

describe("hasReportableContent — không sinh báo cáo rỗng", () => {
  it("fixture tối giản: KPI toàn 0, không totalInspections, không PdM risk ⇒ KHÔNG đáng lưu", () => {
    expect(hasReportableContent(base as any)).toBe(false);
  });

  // ★ Ca bắt buộc (coordinator round-1 review): đối tượng dưới đây do CHÍNH
  // `generateExecutiveSummary({skipLlm:true})` sinh ra — đường thật production dùng để
  // đọc-theo-nhu-cầu (router `executiveReportRouter.latest`) — cho một kỳ KHÔNG có lượt
  // kiểm tra nào, KHÔNG phải fixture tự bịa. Đây là ca DUY NHẤT chứng minh tính năng
  // "không lưu báo cáo rỗng" thật sự hoạt động trên đường sinh thật.
  it("đối tượng THẬT từ generateExecutiveSummary({skipLlm:true}) cho kỳ KHÔNG có lượt kiểm tra ⇒ KHÔNG đáng lưu", async () => {
    const s = await generateExecutiveSummary("shift", "vi", undefined, undefined, { skipLlm: true });
    // Xác nhận tiền đề: đúng ca "không dữ liệu" mà brief mô tả (totalInspections=0), và
    // tường thuật (do offlineSummary sinh) VẪN không rỗng — chính là cái bẫy round 1.
    expect(s.kpis.totalInspections).toBe(0);
    expect(s.highlights.length).toBeGreaterThan(0); // tường thuật luôn không rỗng — không đáng tin làm tín hiệu
    expect(hasReportableContent(s)).toBe(false);
  });

  it("có điểm nhấn tường thuật (offline luôn tự sinh) nhưng KPI thô vẫn totalInspections=0 ⇒ VẪN KHÔNG đáng lưu (không tin tường thuật)", () => {
    expect(hasReportableContent({ ...base, highlights: ["FPY tăng 3%"], kpis: { totalInspections: 0 } } as any)).toBe(false);
  });

  it("có câu rủi ro tường thuật (mảng risks luôn có fallback 'không phát hiện rủi ro') nhưng KPI thô vẫn 0 ⇒ VẪN KHÔNG đáng lưu", () => {
    expect(
      hasReportableContent({ ...base, risks: ["Không phát hiện rủi ro nghiêm trọng trong kỳ."], kpis: { totalInspections: 0 } } as any),
    ).toBe(false);
  });

  it("có rủi ro PdM THẬT (raw pdmRiskMachines HIGH/CRITICAL) dù không có lượt kiểm tra nào ⇒ đáng lưu", () => {
    expect(
      hasReportableContent({
        ...base,
        kpis: {
          totalInspections: 0,
          pdmRiskMachines: [{ machineCode: "L1-AOI", failureRisk: 82, urgency: "HIGH", predictedTimeframe: "18h" }],
        },
      } as any),
    ).toBe(true);
  });

  it("có lượt kiểm tra thật (totalInspections > 0) ⇒ đáng lưu dù không có điểm nhấn tường thuật", () => {
    expect(hasReportableContent({ ...base, kpis: { totalInspections: 500, fpy: 96.2, ngRate: 3.8 } } as any)).toBe(true);
  });

  it("ca bình thường, FPY tốt, LLM không sinh highlight nào ⇒ vẫn lưu (predicate không quá tay chặn báo cáo có giá trị)", () => {
    expect(
      hasReportableContent({
        headline: "",
        highlights: [],
        risks: [],
        recommendations: [],
        kpis: { totalInspections: 1200, okCount: 1180, ngCount: 20, fpy: 98.3, ngRate: 1.7 },
      } as any),
    ).toBe(true);
  });
});
