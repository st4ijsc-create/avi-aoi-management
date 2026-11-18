/**
 * Q0-4 — cổng chất lượng `pause`/`stop` là KHUYẾN CÁO: ghi sự kiện (đúng `action`) và KHÔNG UPDATE bảng nào,
 * nhất là `machines` (trước đây tự đổi `operationStatus`). kiem-dinh 2026-11-06 (lô C ❌): đột biến "khôi phục UPDATE
 * machines" (cả pause+stop, hoặc chỉ stop) sống sót vì không test nào ghim. Không chạm DB: getDb là bản giả ghi lại
 * mọi `insert().values()` và mọi `update(table)`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ q: [] as unknown[][], updates: [] as string[], inserts: [] as unknown[] }));
function chain(kq: unknown[]): any {
  const c: any = new Proxy(function () {}, {
    get(_t, p) {
      if (p === "then") return (res: (v: unknown) => void) => res(kq);
      return () => c;
    },
    apply() { return c; },
  });
  return c;
}
vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: () => chain(h.q.shift() ?? []),
    insert: () => ({ values: (v: unknown) => { h.inserts.push(v); return { returning: async () => [{ id: 99 }] }; } }),
    update: (t: unknown) => {
      h.updates.push(String((t as Record<symbol, unknown>)?.[Symbol.for("drizzle:Name")] ?? "?"));
      const c: any = new Proxy(function () {}, {
        get(_t, p) {
          if (p === "then") return (r: (v: unknown) => void) => r([]);
          return () => c;
        },
        apply() { return c; },
      });
      return c;
    },
  }),
}));

import { evaluateGatesAfterInspection } from "./qualityGateEvaluator";

beforeEach(() => { h.q.length = 0; h.updates.length = 0; h.inserts.length = 0; });

describe("qualityGateEvaluator — pause/stop là khuyến cáo (không đổi trạng thái máy)", () => {
  for (const action of ["pause", "stop"] as const) {
    it(`gate action=${action} KHI VI PHẠM: ghi 1 sự kiện (action=${action}) và KHÔNG UPDATE bảng nào (nhất là machines)`, async () => {
      const gate = { id: 5, name: "g", isActive: true, gateType: "consecutive_ng", comparisonOperator: "gte", threshold: "3", windowSize: 10, action, machineId: 7, productModelId: null, lineId: null, workstationId: null };
      // select #1: danh sách gate; #2: sự kiện gần đây (chống trùng); #3: cửa sổ kết quả gần nhất — 3 NG liên tiếp ⇒ vi phạm
      h.q.push([gate], [], [{ overallResult: "NG" }, { overallResult: "NG" }, { overallResult: "NG" }, { overallResult: "OK" }]);
      await evaluateGatesAfterInspection({ inspectionId: 1, machineId: 7, productModelId: null, lineId: null } as never);
      expect(h.inserts.length, "sự kiện cổng chất lượng phải được ghi").toBe(1);
      expect((h.inserts[0] as { action: string }).action).toBe(action);
      expect(h.updates, "cổng chất lượng KHÔNG được UPDATE trạng thái máy").toEqual([]);
    });
  }
});
