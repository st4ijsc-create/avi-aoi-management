/**
 * Q0-3 — `summarizeInspections`: KPI của trang Lịch sử tính ở SERVER trên toàn tập đã lọc (không phải mẫu `limit`).
 * Không DB: getDb là bản giả, bốn truy vấn trả kết quả xếp sẵn theo thứ tự (tổng · theo máy · theo ngày · theo sản phẩm).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const hangDoi: unknown[][] = [];
function chuoi(): any {
  const kq = hangDoi.shift() ?? [];
  const c: any = new Proxy(function () {}, {
    get(_t, p) {
      if (p === "then") return (res: (v: unknown) => void) => res(kq);
      return () => c;
    },
    apply() { return c; },
  });
  return c;
}
vi.mock("./connection", () => ({ getDb: async () => ({ select: () => chuoi() }) }));

import { summarizeInspections } from "./statistics";

beforeEach(() => { hangDoi.length = 0; });

describe("summarizeInspections", () => {
  it("★ yield = (OK + NTF) / total trên TOÀN tập (kể cả NTF), theo máy/ngày/sản phẩm", async () => {
    hangDoi.push(
      [{ total: 1000, ok: 800, ng: 100, ntf: 100 }],
      [{ id: 7, name: "AOI-7", total: 600, ok: 500, ng: 50, ntf: 50 }, { id: 8, name: null, total: 400, ok: 300, ng: 50, ntf: 50 }],
      [{ day: "2026-11-03", total: 500, ok: 400, ng: 50, ntf: 50 }, { day: "2026-11-04", total: 500, ok: 400, ng: 50, ntf: 50 }],
      [{ model: "PM-A", total: 1000, ok: 800, ng: 100, ntf: 100 }, { model: null, total: 0, ok: 0, ng: 0, ntf: 0 }],
    );
    const r = await summarizeInspections({});
    expect(r).toMatchObject({ total: 1000, okCount: 800, ngCount: 100, ntfCount: 100 });
    expect(r.yieldRate).toBe(90); // (800 + 100) / 1000 — KHÔNG phải 80 (chỉ OK)
    expect(r.machineStats.map((m) => [m.id, m.name, m.yieldRate])).toEqual([[7, "AOI-7", (550 / 600) * 100], [8, "Machine #8", (350 / 400) * 100]]);
    expect(r.dateStats.map((d) => [d.day, d.yieldRate])).toEqual([["2026-11-03", 90], ["2026-11-04", 90]]);
    expect(r.productStats[0]).toMatchObject({ model: "PM-A", yieldRate: 90 });
    expect(r.productStats[1]).toMatchObject({ model: "", total: 0, yieldRate: 0 }); // tập rỗng ⇒ 0, không NaN
  });
  it("chuỗi số từ DB (count → string) vẫn cộng đúng", async () => {
    hangDoi.push([{ total: "10", ok: "5", ng: "3", ntf: "2" }], [], [], []);
    const r = await summarizeInspections({});
    expect(r.total).toBe(10);
    expect(r.yieldRate).toBe(70);
  });
  it("không có hàng nào ⇒ tổng 0, yield 0 (không NaN), các mảng rỗng", async () => {
    hangDoi.push([{ total: 0, ok: null, ng: null, ntf: null }], [], [], []);
    const r = await summarizeInspections({});
    expect(r).toMatchObject({ total: 0, okCount: 0, yieldRate: 0, machineStats: [], dateStats: [], productStats: [] });
  });
});
