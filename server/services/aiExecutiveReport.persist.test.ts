import { describe, it, expect } from "vitest";
import { hasReportableContent } from "./aiExecutiveReport";

const base = {
  headline: "", highlights: [] as string[], risks: [] as string[], recommendations: [] as string[],
  kpis: { fpy: 0, ngRate: 0 } as any,
};

describe("hasReportableContent — không sinh báo cáo rỗng", () => {
  it("KPI toàn 0, không rủi ro, không điểm nhấn ⇒ KHÔNG đáng lưu", () => {
    expect(hasReportableContent(base as any)).toBe(false);
  });
  it("có điểm nhấn ⇒ đáng lưu", () => {
    expect(hasReportableContent({ ...base, highlights: ["FPY tăng 3%"] } as any)).toBe(true);
  });
  it("có rủi ro ⇒ đáng lưu", () => {
    expect(hasReportableContent({ ...base, risks: ["Máy L1-AOI nguy cơ hỏng"] } as any)).toBe(true);
  });
  it("KPI khác 0 ⇒ đáng lưu dù không có điểm nhấn", () => {
    expect(hasReportableContent({ ...base, kpis: { fpy: 96.2, ngRate: 3.8 } } as any)).toBe(true);
  });
});
