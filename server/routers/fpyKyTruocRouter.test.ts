/**
 * Q0-2 — hành vi ở MỨC ROUTER của FPY thật (kiem-dinh 2026-11-06, lô C ❌: đột biến r2/r6/r8 sống sót).
 *
 * `fpyPctOver` nhận MỘT điều kiện `where` do router dựng. Test này ghi lại điều kiện đó (qua `PgDialect.sqlToQuery`)
 * ở HAI lời gọi — kỳ NÀY và kỳ TRƯỚC — rồi ghim chính xác tham số:
 *   • kỳ này  : máy của trạm + [start, end]          (r8: bỏ bộ lọc ⇒ `where` = undefined ⇒ đỏ)
 *   • kỳ trước: máy của trạm + [prevStart, prevEnd]  (r2 dashboard / r6 stationAnalysis: đổi điều kiện kỳ trước ⇒ đỏ)
 * với prevEnd = start − 1 ms, prevStart = prevEnd − (end − start). Cả hai KHÔNG chạm DB (getDb là bản giả).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

const h = vi.hoisted(() => ({ wheres: [] as unknown[] }));

/** Bảng → hàng giả. Mọi bảng khác → []. */
function tenBang(t: unknown): string {
  return String((t as Record<symbol, unknown>)?.[Symbol.for("drizzle:Name")] ?? "?");
}
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
const HANG: Record<string, unknown[]> = {
  stations: [{ station: { id: 5, code: "S5" }, line: { id: 1 }, workshop: { id: 1 }, factory: { id: 1 } }],
  machines: [{ id: 101, name: "M", code: "M101" }],
  product_inspections: [{ total: 10, ok: 8, ng: 1, ntf: 1 }],
};
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return {
    ...actual,
    getDb: async () => ({
      select: () => ({
        from: (t: unknown) => chuoi(HANG[tenBang(t)] ?? []),
      }),
      execute: async () => [],
    }),
  };
});
vi.mock("../utils/kpi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/kpi")>();
  return {
    ...actual,
    fpyPctOver: async (_db: unknown, where: unknown) => {
      h.wheres.push(where);
      return 60;
    },
  };
});
vi.mock("./_adapterPhamVi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_adapterPhamVi")>();
  return { ...actual, idsMayTrongPhamVi: async () => null };
});
vi.mock("../db/hierarchy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/hierarchy")>();
  return { ...actual, trongPhamVi: async () => true };
});

import { productionDashboardRouter } from "./productionDashboardRouter";
import { stationAnalysisRouter } from "./stationAnalysisRouter";

const dialect = new PgDialect();
/** Tham số của một điều kiện `where`, Date → ISO để so sánh. */
const thamSo = (w: unknown): unknown[] | null =>
  w ? dialect.sqlToQuery(w as never).params.map((p) => (p instanceof Date ? p.toISOString() : p)) : null;

const ctx = { user: { id: 1, role: "admin", name: "x", twoFactorEnabled: true } } as never;
const S = new Date("2026-09-10T00:00:00.000Z");
const E = new Date("2026-09-12T00:00:00.000Z");
const D = E.getTime() - S.getTime();
const prevEnd = new Date(S.getTime() - 1);
const prevStart = new Date(prevEnd.getTime() - D);
const iso = (d: Date) => d.toISOString();

beforeEach(() => { h.wheres.length = 0; });

describe("FPY thật — điều kiện router đưa vào fpyPctOver", () => {
  it("productionDashboard.getStationOverview: kỳ NÀY = máy + [start,end]; kỳ TRƯỚC = máy + [prevStart,prevEnd]", async () => {
    const r: any[] = await productionDashboardRouter.createCaller(ctx).getStationOverview({ startDate: S, endDate: E } as never);
    expect(r[0].firstPassYield).toBe(60); // lấy từ fpyPctOver, không phải ok/total (8/10 = 80)
    expect(h.wheres).toHaveLength(2);
    const [truoc, nay] = h.wheres.map(thamSo); // prevQueryPromise được dựng trước khi chạy Promise.all
    expect(truoc, "r2: điều kiện kỳ trước").toEqual([101, iso(prevStart), iso(prevEnd)]);
    expect(nay, "r8: kỳ này phải có bộ lọc máy + khoảng").toEqual([101, iso(S), iso(E)]);
  });

  it("stationAnalysis.getStationSummary: kỳ NÀY = máy + [start,end]; kỳ TRƯỚC = máy + [prevStart,prevEnd]", async () => {
    const r: any = await stationAnalysisRouter.createCaller(ctx).getStationSummary({ stationId: 5, startDate: S, endDate: E } as never);
    expect(r.firstPassYield).toBe(60);
    expect(h.wheres).toHaveLength(2);
    const [truoc, nay] = h.wheres.map(thamSo);
    expect(truoc, "r6: điều kiện kỳ trước").toEqual([101, iso(prevStart), iso(prevEnd)]);
    expect(nay, "r8: kỳ này phải có bộ lọc máy + khoảng").toEqual([101, iso(S), iso(E)]);
  });

  it("không có khoảng ngày ⇒ KHÔNG dựng kỳ trước: chỉ một lời gọi, vẫn lọc theo máy; yieldChange = 0", async () => {
    const r: any = await stationAnalysisRouter.createCaller(ctx).getStationSummary({ stationId: 5 } as never);
    expect(h.wheres).toHaveLength(1);
    expect(thamSo(h.wheres[0])).toEqual([101]);
    expect(r.yieldChange).toBe(0);
  });
});
