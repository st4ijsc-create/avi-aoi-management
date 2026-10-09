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
  getDb: async () => ({ execute: () => (queue.shift() ?? (() => Promise.resolve([])))() }),
}));

import { readUiPrefs, mergeUiPrefs } from "./userUiPrefs";

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

  it("0 hàng trả về từ câu gộp (WHERE trần kích thước sai) ⇒ tooLarge", async () => {
    next(async () => []);
    expect(await mergeUiPrefs(1, { showLabs: true })).toEqual({ ok: false, reason: "tooLarge" });
  });

  it("đọc chỉ trả khoá hợp lệ (rác do SQL tay không rời server)", async () => {
    next(async () => [{ p: { showLabs: true, junk: 1, "layoutKit:ide:u1:bottomCollapsed": "x" } }]);
    expect(await readUiPrefs(1)).toEqual({ prefs: { showLabs: true }, available: true });
  });
});
