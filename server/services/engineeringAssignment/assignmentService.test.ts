/**
 * doc 81 Đợt 3 Task 4 — `fetchMineCategory` (hộp "Của tôi"): luật tên HUB-02 ở tầng truy vấn — `showNames=false`
 * ⇒ đúng MỘT lượt đọc (đếm), không lượt đọc mẫu nào (tên không thể rò qua lượt thứ hai); lỗi ⇒ degraded, không throw.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchMineCategory } from "./assignmentService";
import { ASSIGNABLE_ENTITY_TYPES } from "@shared/engineeringAssignment";

function fakeDb(queue: unknown[]) {
  let i = 0;
  const chain: any = {};
  for (const k of ["select", "from", "where", "orderBy", "limit", "leftJoin", "innerJoin"]) chain[k] = () => chain;
  chain.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
    const v = queue[i++];
    if (v instanceof Error) rej?.(v);
    else res(v);
  };
  return { db: { select: () => chain } as any, calls: () => i };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("fetchMineCategory", () => {
  for (const type of ASSIGNABLE_ENTITY_TYPES) {
    it(`${type}: showNames=false ⇒ chỉ đếm, KHÔNG đọc mẫu`, async () => {
      const { db, calls } = fakeDb([[{ c: 3 }]]);
      const r = await fetchMineCategory(db, type, 7, false);
      expect(r).toEqual({ count: 3, samples: [], degraded: false });
      expect(calls()).toBe(1);
    });
    it(`${type}: truy vấn ném ⇒ degraded, không throw`, async () => {
      const { db } = fakeDb([new Error("relation engineering_assignments does not exist")]);
      await expect(fetchMineCategory(db, type, 7, true)).resolves.toEqual({ count: 0, samples: [], degraded: true });
    });
  }
  it("ecn: showNames=true ⇒ mẫu có nhãn", async () => {
    const { db } = fakeDb([[{ c: 1 }], [{ id: 5, ecnKey: "ECN-1", title: "Đổi keo", status: "submitted" }]]);
    expect(await fetchMineCategory(db, "ecn", 7, true)).toEqual({ count: 1, degraded: false, samples: [{ id: 5, label: "ECN-1 · Đổi keo", hint: "submitted" }] });
  });
});
