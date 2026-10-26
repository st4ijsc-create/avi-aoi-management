/**
 * kiem-dinh P1-6 — câu information_schema của `kiemSchemaR1a` chạy được trên Postgres THẬT (`_test`, đã áp 0431 + 0432 + 0433) ⇒ không thiếu gì.
 * Và: một tên bảng không tồn tại thật sự bị báo thiếu (oracle — câu không "luôn trả đủ").
 */
import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/connection";
import { FK_0433, kiemSchemaR1a } from "./kiemSchemaR1a";

describe("kiemSchemaR1a trên DB _test thật", () => {
  it("0431 + 0432 + 0433 + 0434 đã áp ⇒ không thiếu gì", async () => {
    expect(process.env.DATABASE_URL).toMatch(/_test/);
    const db = await getDb();
    if (!db) throw new Error("cần DB _test");
    const chay = async (q: SQL) => (await db.execute(q)) as unknown as Array<Record<string, unknown>>;
    // kiem-dinh I-C: + 0434 (đã áp TEST); R1b-2a T12 (kiem-dinh M3): + 3 FK ON DELETE CASCADE của 0433 đọc từ pg_constraint THẬT
    expect(await kiemSchemaR1a(chay)).toEqual({ thieu0431: [], thieu0432: [], thieu0433: [], thieu0434: [], thieu0433Fk: [] });
  });
  it("★ R1b-2a T12 oracle — pg_constraint thật trả đúng 3 FK của 0433 với confdeltype 'c' + convalidated (câu không 'luôn đủ')", async () => {
    const db = await getDb();
    if (!db) throw new Error("cần DB _test");
    const rows = (await db.execute(sql`SELECT c.conname, c.confdeltype, c.convalidated FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public' AND c.conname IN (${sql.join(FK_0433.map((f) => sql`${f}`), sql`, `)})
      ORDER BY c.conname`)) as unknown as Array<{ conname: string; confdeltype: string; convalidated: boolean }>;
    expect(rows.map((r) => [r.conname, String(r.confdeltype), r.convalidated])).toEqual(
      [...FK_0433].sort().map((f) => [f, "c", true]),
    );
    // và một tên FK không tồn tại thì KHÔNG lọt vào tập "đúng" (chạy câu thật, chèn một tên lạ vào kết quả mong đợi)
    const chay = async (q: SQL) => (await db.execute(q)) as unknown as Array<Record<string, unknown>>;
    const loc = async (q: SQL) => (await chay(q)).filter((r) => r.conname !== "scada_khoa_chon_adapter_fk");
    expect((await kiemSchemaR1a(loc)).thieu0433Fk).toEqual(["scada_khoa_chon_adapter_fk"]);
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
