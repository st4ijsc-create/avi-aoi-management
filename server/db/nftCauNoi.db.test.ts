import { describe, it, expect } from "vitest";
import { getDb } from "./connection";
import { sql } from "drizzle-orm";
import { verdictLuuTru } from "@shared/rollupVerdict";
import { FINAL_YIELD_PASS_RESULTS } from "@shared/kpiYield";

/**
 * BG-7 (§13 Đ-15). Canh cầu nối NTF bằng DỮ LIỆU THẬT, không bằng ví dụ tự chế.
 * Nếu ai đó bỏ `verdictLuuTru` khỏi đường ingest, lưới đơn vị vẫn xanh — nhưng
 * mệnh đề "cột lưu trữ còn dùng NTF" thì đo được trên DB thật.
 */
describe("cầu nối NTF — bảng chữ cái cột lưu trữ", () => {
  it("bo NTF trong DB KHÔNG bằng 0 — nếu bằng 0 thì mọi phép đo dưới đây tự thoả", async () => {
    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
    const r: any = await db.execute(sql`
      SELECT count(*) FILTER (WHERE "overallResult" = 'NTF')::int AS ntf,
             count(*)::int AS tong FROM product_inspections`);
    const { ntf, tong } = ((r.rows ?? r) as Array<{ ntf: number; tong: number }>)[0];
    expect(tong, "bảng rỗng ⇒ phép đo vô nghĩa").toBeGreaterThan(0);
    expect(ntf, `bo NTF = 0/${tong} ⇒ cầu nối NTF không còn gì để canh`).toBeGreaterThan(0);
  });

  it("MỌI giá trị verdictLuuTru sinh ra đều là giá trị cột đã thật sự dùng", async () => {
    const db = await getDb();
    const r: any = await db!.execute(sql`
      SELECT DISTINCT "overallResult" AS kq FROM product_inspections WHERE "overallResult" IS NOT NULL`);
    const trongDb = new Set(((r.rows ?? r) as Array<{ kq: string }>).map((x) => x.kq));
    const sinhRa = new Set<string>();
    for (const result of ["OK", "NG"] as const)
      for (const ntf of [true, false]) sinhRa.add(verdictLuuTru({ result, ntf }));
    for (const v of sinhRa)
      expect(trongDb.has(v), `verdictLuuTru sinh "${v}" nhưng cột chưa từng chứa giá trị này`).toBe(true);
  });

  it("NTF nằm trong tập PASS của final yield — nếu đổi, 6,55% bo đổi phe", () => {
    expect([...FINAL_YIELD_PASS_RESULTS]).toContain("NTF");
  });
});
