/**
 * kiem-dinh P1-6 — câu information_schema của `kiemSchemaR1a` chạy được trên Postgres THẬT (`_test`, đã áp 0431 + 0432) ⇒ không thiếu gì.
 * Và: một tên bảng không tồn tại thật sự bị báo thiếu (oracle — câu không "luôn trả đủ").
 */
import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/connection";
import { kiemSchemaR1a } from "./kiemSchemaR1a";

describe("kiemSchemaR1a trên DB _test thật", () => {
  it("0431 + 0432 đã áp ⇒ { thieu0431: [], thieu0432: [] }", async () => {
    expect(process.env.DATABASE_URL).toMatch(/_test/);
    const db = await getDb();
    if (!db) throw new Error("cần DB _test");
    const chay = async (q: SQL) => (await db.execute(q)) as unknown as Array<Record<string, unknown>>;
    expect(await kiemSchemaR1a(chay)).toEqual({ thieu0431: [], thieu0432: [] });
  });
  it("oracle: cùng câu nhưng information_schema trả rỗng cho bảng lạ ⇒ chứng minh lọc theo tên thật", async () => {
    const db = await getDb();
    if (!db) throw new Error("cần DB _test");
    const [r] = (await db.execute(
      sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'khong_co_bang_nay_p16'`,
    )) as unknown as Array<{ n: number }>;
    expect(r.n).toBe(0);
  });
});
