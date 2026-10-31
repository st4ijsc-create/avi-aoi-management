/**
 * ★ Đợt 12 H0.1 (2026-10-31, dieu-phoi) — CỔNG CSDL THẬT: khai Drizzle của `ai_gateway_metrics` khớp CỘT THẬT trên `_test`, HAI chiều.
 *
 * VÌ SAO RIÊNG BẢNG NÀY: hàng đo được xả theo lô bằng `db.insert(aiGatewayMetrics).values(...)` và lỗi xả bị NUỐT (đo lường không được làm
 * hỏng lượt AI — `aiGateway.flush`). Drizzle liệt kê MỌI cột đã khai trong INSERT ⇒ thêm cột vào schema mà migration chưa áp = MỌI lô
 * xả hỏng, mất số đo IM LẶNG trên sản xuất (không lỗi, không test đỏ). Lưới này làm thiếu migration ĐỎ ở cổng thay vì nuốt ở sản xuất.
 *   (1) Drizzle → DB: mọi cột khai tồn tại thật (migration chưa áp / tên SQL gõ sai).
 *   (2) DB → Drizzle: không cột DB nào vắng trong khai (migration thêm mà quên khai — cột NOT NULL không default sẽ làm INSERT hỏng).
 * Đọc `pg_attribute` (khuôn `cayKetQuaSchema.db.test.ts`); chống-tự-thoả: tập cột đọc được phải đủ lớn và chứa cột gốc `id`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { getTableColumns, getTableName } from "drizzle-orm";
import { aiGatewayMetrics } from "../../drizzle/schema";

let sql: ReturnType<typeof postgres>;

async function cotThat(tenBang: string): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT a.attname AS name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${tenBang} AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attname`;
  return rows.map((r) => r.name);
}

const cotKhai = () => Object.values(getTableColumns(aiGatewayMetrics)).map((c) => c.name).sort();

beforeAll(() => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
});
afterAll(async () => {
  await sql?.end();
});

describe("ai_gateway_metrics — Drizzle ⇄ cột thật (_test)", () => {
  it("đang đo đúng CSDL test và đúng bảng (chống-tự-thoả)", async () => {
    const [{ db }] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
    expect(db).toMatch(/_test$/);
    expect(getTableName(aiGatewayMetrics)).toBe("ai_gateway_metrics");
    const that = await cotThat("ai_gateway_metrics");
    expect(that.length).toBeGreaterThanOrEqual(19);
    expect(that).toContain("id");
  });

  it("(1) mọi cột Drizzle khai đều có trên DB — thiếu ⇒ migration chưa áp, lô xả sẽ hỏng im lặng", async () => {
    const that = new Set(await cotThat("ai_gateway_metrics"));
    expect(cotKhai().filter((c) => !that.has(c))).toEqual([]);
  });

  it("(2) mọi cột DB đều được khai trong Drizzle", async () => {
    const khai = new Set(cotKhai());
    expect((await cotThat("ai_gateway_metrics")).filter((c) => !khai.has(c))).toEqual([]);
  });

  it("H0.1 — hai cột 0445 có mặt ở cả hai phía", async () => {
    const that = await cotThat("ai_gateway_metrics");
    for (const c of ["cacheTokens", "promptEvalTokens"]) {
      expect(cotKhai()).toContain(c);
      expect(that).toContain(c);
    }
  });
});
