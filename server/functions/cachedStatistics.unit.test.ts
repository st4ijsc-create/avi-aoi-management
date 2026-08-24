// server/functions/cachedStatistics.unit.test.ts
import { describe, it, expect } from "vitest";
import { tinhThongKeMay } from "./cachedStatistics";

const bo = (overallResult: string, ngay: string) => ({
  overallResult,
  inspectionTime: new Date(`${ngay}T08:00:00Z`),
});

describe("tinhThongKeMay — NTF phải tính là PASS (decision #4)", () => {
  it("NTF vào vế pass: 8 OK + 2 NTF trên 10 bo ⇒ yield 100.00", () => {
    const r = tinhThongKeMay([
      ...Array.from({ length: 8 }, () => bo("OK", "2026-08-01")),
      ...Array.from({ length: 2 }, () => bo("NTF", "2026-08-01")),
    ]);
    expect(r.total).toBe(10);
    expect(r.ntfCount).toBe(2);
    expect(r.yieldRate).toBe("100.00");
  });

  it("ca giết đột biến mạnh nhất: TOÀN BỘ là NTF ⇒ yield 100.00, không phải 0.00", () => {
    const r = tinhThongKeMay(Array.from({ length: 5 }, () => bo("NTF", "2026-08-01")));
    expect(r.yieldRate).toBe("100.00");
  });

  it("NG vẫn là fail: 6 OK + 1 NTF + 3 NG ⇒ yield 70.00", () => {
    const r = tinhThongKeMay([
      ...Array.from({ length: 6 }, () => bo("OK", "2026-08-01")),
      bo("NTF", "2026-08-01"),
      ...Array.from({ length: 3 }, () => bo("NG", "2026-08-01")),
    ]);
    expect(r.yieldRate).toBe("70.00");
  });

  it("trend theo ngày dùng CÙNG công thức với tổng", () => {
    const r = tinhThongKeMay([
      bo("OK", "2026-08-01"), bo("NTF", "2026-08-01"),
      bo("NG", "2026-08-02"), bo("OK", "2026-08-02"),
    ]);
    expect(r.trend).toHaveLength(2);
    expect(r.trend[0]).toMatchObject({ date: "2026-08-01", yieldRate: "100.00" });
    expect(r.trend[1]).toMatchObject({ date: "2026-08-02", yieldRate: "50.00" });
  });

  it("tập rỗng ⇒ 0.00, không chia cho 0", () => {
    expect(tinhThongKeMay([]).yieldRate).toBe("0.00");
  });
});
