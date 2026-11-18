/**
 * Q0-2 — so sánh kỳ: cột yield theo NGÀY dùng công thức chuẩn `overallResult IN ('OK','NTF')` (finalYieldPctSql), không còn chỉ-OK.
 * kiem-dinh 2026-11-06 (lô C ❌): đột biến y4 (khôi phục SQL cũ chỉ-OK) sống sót. Không chạm DB: `execute` là bản giả ghi lại câu SQL
 * thật (qua PgDialect) — đo văn bản SQL mà truy vấn theo ngày gửi đi.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ cau: [] as unknown[] }));
function chuoi(kq: unknown[]): any {
  const c: any = new Proxy(function () {}, {
    get(_t, p) {
      if (p === "then") return (res: (v: unknown) => void) => res(kq);
      return () => c;
    },
    apply() { return c; },
  });
  return c;
}
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return {
    ...actual,
    getDb: async () => ({
      execute: async (q: unknown) => { h.cau.push(q); return []; },
      select: () => chuoi([]),
    }),
  };
});

import { generateComparison } from "./dataComparisonService";

const dialect = new PgDialect();
beforeEach(() => { h.cau.length = 0; });

describe("generateComparison — yield theo ngày", () => {
  it("y4 — câu SQL theo ngày tính yieldRate bằng `IN ('OK', 'NTF')` (NTF là đạt), không phải `= 'OK'` chia COUNT(*)", async () => {
    await generateComparison({
      periodType: "custom",
      currentStart: new Date("2026-09-10T00:00:00Z"),
      currentEnd: new Date("2026-09-11T00:00:00Z"),
      previousStart: new Date("2026-09-08T00:00:00Z"),
      previousEnd: new Date("2026-09-09T00:00:00Z"),
    } as never);
    const theoNgay = h.cau
      .map((q) => dialect.sqlToQuery(q as never).sql)
      .filter((s) => s.includes("TO_CHAR(product_inspections") && s.includes("GROUP BY TO_CHAR"));
    expect(theoNgay.length, "phải có câu SQL theo ngày (kỳ này + kỳ trước)").toBeGreaterThanOrEqual(2);
    for (const s of theoNgay) {
      expect(s).toMatch(/"overallResult" IN \('OK', 'NTF'\)[\s\S]*as "yieldRate"/);
      expect(s).not.toMatch(/\* 100\.0 \/ COUNT\(\*\), 1\)\s*ELSE 0 END as "yieldRate"/);
    }
  });
});
