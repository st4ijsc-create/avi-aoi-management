/**
 * doc 81 Đợt 4 Task D1 — DB CHƯA áp 0365 (dev, tới khi chủ dự án áp): cột vắng ⇒ 42703 (drizzle bọc trong `cause`).
 * Đọc ⇒ `{}` + available:false; ghi ⇒ `unavailable` — không ném, không hỏng thứ khác. Lỗi khác vẫn NÉM.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Hàng đợi kết quả của `execute` — hàm THƯỜNG, không `vi.fn().mockRejectedValue…`: đo được 2026-10-10, với vi.fn ca
 * 42703 báo ĐỎ ("pg 42703") dù cả hai lời gọi đều trả đúng (log), vì bộ theo dõi kết quả của mock giữ promise bị từ chối.
 */
const queue: Array<() => Promise<unknown>> = [];
const next = (fn: () => Promise<unknown>) => queue.push(fn);
const fail = (e: unknown) => () => Promise.reject(e);
vi.mock("./connection", () => ({
  getDb: async () => {
    const execute = () => (queue.shift() ?? (() => Promise.resolve([])))();
    return { execute, transaction: async (fn: (tx: { execute: typeof execute }) => Promise<unknown>) => fn({ execute }) };
  },
}));

import { readUiPrefs, mergeUiPrefs, planUiPrefsMerge, jsonbTextBytes, UI_PREFS_ORDER_KEY } from "./userUiPrefs";

const pgErr = (code: string, wrapped: boolean) => {
  const inner = Object.assign(new Error(`pg ${code}`), { code });
  return wrapped ? Object.assign(new Error("Failed query"), { cause: inner }) : inner;
};

describe("userUiPrefs — DB chưa áp 0365", () => {
  beforeEach(() => void (queue.length = 0));

  for (const wrapped of [false, true]) {
    it(`42703 ${wrapped ? "(bọc trong cause)" : "(trần)"} ⇒ đọc {} available:false; ghi unavailable`, async () => {
      next(fail(pgErr("42703", wrapped)));
      next(fail(pgErr("42703", wrapped)));
      expect(await readUiPrefs(1)).toEqual({ prefs: {}, available: false });
      expect(await mergeUiPrefs(1, { showLabs: true })).toEqual({ ok: false, reason: "unavailable" });
    });
  }

  it("23514 (CHECK của 0365) ⇒ tooLarge; lỗi khác ⇒ ném", async () => {
    next(fail(pgErr("23514", true)));
    expect(await mergeUiPrefs(1, { showLabs: true })).toEqual({ ok: false, reason: "tooLarge" });
    next(fail(pgErr("57P01", true)));
    await expect(mergeUiPrefs(1, { showLabs: true })).rejects.toThrow("Failed query");
    next(fail(pgErr("08006", false)));
    await expect(readUiPrefs(1)).rejects.toThrow("pg 08006");
  });

  it("fix 1 #5 — không vừa dù đã bỏ hết khoá bố cục ⇒ tooLarge (giao dịch hoàn tác, không UPDATE)", async () => {
    next(async () => []); // INSERT … DO NOTHING
    next(async () => [{ p: { showLabs: true } }]); // SELECT … FOR UPDATE
    const patch: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) patch[`layoutKit:l${i}:u1:hpx`] = { left: { px: 260, pct: 20 }, right: { px: 380, pct: 25 } };
    expect(await mergeUiPrefs(1, patch)).toEqual({ ok: false, reason: "tooLarge" });
    expect(queue.length).toBe(0);
  });

  it("đọc chỉ trả khoá hợp lệ (rác do SQL tay không rời server)", async () => {
    next(async () => [{ p: { showLabs: true, junk: 1, "layoutKit:ide:u1:bottomCollapsed": "x", "layoutKit:ide:u2:bottomCollapsed": true, "layoutKit:ide:u1:vpx": { bottom: { px: 1, pct: 1 } }, [UI_PREFS_ORDER_KEY]: ["layoutKit:ide:u1:vpx"] } }]);
    // fix 1 #8 — khoá bố cục của người KHÁC (u2) và khoá nội bộ __order cũng bị bỏ.
    expect(await readUiPrefs(1)).toEqual({ prefs: { showLabs: true, "layoutKit:ide:u1:vpx": { bottom: { px: 1, pct: 1 } } }, available: true });
  });
});

describe("planUiPrefsMerge — bỏ khoá bố cục CŨ NHẤT khi chạm trần (fix 1 #5)", () => {
  const K = (i: number) => `layoutKit:l${i}:u1:bottomCollapsed`;
  // Phép đo giả: mỗi khoá bố cục 10 đơn vị, showLabs 1, __order 0 ⇒ trần 35 = tối đa 3 khoá bố cục.
  const measure = (o: Record<string, unknown>) => Object.keys(o).reduce((n, k) => n + (k === "showLabs" ? 1 : k === UI_PREFS_ORDER_KEY ? 0 : 10), 0);

  it("bỏ theo thứ tự dùng (cũ trước); khoá vừa ghi thành MỚI NHẤT; showLabs không bao giờ bị bỏ", async () => {
    const stored = { showLabs: true, [K(1)]: true, [K(2)]: true, [K(3)]: true, [UI_PREFS_ORDER_KEY]: [K(2), K(1), K(3)] };
    const r = await planUiPrefsMerge(stored, { [K(4)]: false }, 1, measure, 35);
    expect(r?.evicted).toEqual([K(2)]);
    expect(r?.next[UI_PREFS_ORDER_KEY]).toEqual([K(1), K(3), K(4)]);
    expect(r?.next.showLabs).toBe(true);
    // ghi lại K(1) (cũ nhất) cùng K(5) ⇒ K(1) lên MỚI NHẤT, người bị bỏ là K(3)
    const r2 = await planUiPrefsMerge(r!.next, { [K(1)]: false, [K(5)]: true }, 1, measure, 35);
    expect(r2?.evicted).toEqual([K(3)]);
    expect(r2?.next[UI_PREFS_ORDER_KEY]).toEqual([K(4), K(1), K(5)]);
    expect(Object.keys(r2!.next).filter((k) => k !== UI_PREFS_ORDER_KEY).sort()).toEqual([K(1), K(4), K(5), "showLabs"].sort());
  });

  it("khoá của CHÍNH bản vá không bao giờ bị bỏ; bản vá một mình quá trần ⇒ null", async () => {
    expect(await planUiPrefsMerge({ showLabs: true }, { [K(1)]: true, [K(2)]: true, [K(3)]: true, [K(4)]: true }, 1, measure, 35)).toBeNull();
  });

  it("khoá bố cục có trong hàng nhưng sổ thứ tự không biết (hàng cũ / sửa tay) ⇒ coi là CŨ NHẤT; khoá người khác bị bỏ khỏi hàng", async () => {
    const stored = { [K(1)]: true, [K(2)]: true, "layoutKit:x:u9:hpx": { left: { px: 1, pct: 1 } }, [UI_PREFS_ORDER_KEY]: [K(2), "rác", 7] };
    const r = await planUiPrefsMerge(stored, { [K(3)]: true, [K(4)]: true }, 1, measure, 35);
    expect(r?.evicted).toEqual([K(1)]);
    expect(r?.next[UI_PREFS_ORDER_KEY]).toEqual([K(2), K(3), K(4)]);
    expect("layoutKit:x:u9:hpx" in r!.next).toBe(false);
  });

  it("jsonbTextBytes = độ dài đúng định dạng jsonb::text của Postgres", () => {
    expect(jsonbTextBytes({ a: 1, b: { c: [1, 2] }, d: true })).toBe('{"a": 1, "b": {"c": [1, 2]}, "d": true}'.length);
    expect(jsonbTextBytes({})).toBe(2);
  });
});
