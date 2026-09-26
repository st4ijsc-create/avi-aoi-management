// server/routers/stationAnalysis.yield.test.ts
import { describe, it, expect } from "vitest";
import { tinhYieldTheoBucket } from "./stationAnalysisRouter";

describe("tinhYieldTheoBucket — đầu vào của biểu đồ kiểm soát", () => {
  it("NTF là PASS: bucket 10 bo, 7 OK + 3 NTF ⇒ 100", () => {
    const r = tinhYieldTheoBucket([{ bucket: "2026-08-01T08", total: 10, ok: 7, ntf: 3 }]);
    expect(r[0].yieldRate).toBeCloseTo(100, 6);
  });

  it("giữ nguyên thứ tự bucket — chuỗi thời gian không được xáo", () => {
    const r = tinhYieldTheoBucket([
      { bucket: "2026-08-01T08", total: 10, ok: 9, ntf: 0 },
      { bucket: "2026-08-01T09", total: 10, ok: 5, ntf: 5 },
      { bucket: "2026-08-01T10", total: 10, ok: 4, ntf: 0 },
    ]);
    expect(r.map((x) => x.bucket)).toEqual(["2026-08-01T08", "2026-08-01T09", "2026-08-01T10"]);
    expect(r.map((x) => Math.round(x.yieldRate))).toEqual([90, 100, 40]);
  });

  it("bucket rỗng ⇒ 0, không NaN (NaN sẽ phá mean/UCL/LCL)", () => {
    const r = tinhYieldTheoBucket([{ bucket: "x", total: 0, ok: 0, ntf: 0 }]);
    expect(r[0].yieldRate).toBe(0);
    expect(Number.isNaN(r[0].yieldRate)).toBe(false);
  });
});
