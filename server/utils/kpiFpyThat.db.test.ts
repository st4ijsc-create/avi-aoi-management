/**
 * Q0-2 — FPY THẬT trên SQL thật: serial kiểm >1 lần + NTF ⇒ FPY mới KHÁC proxy cũ ok/total.
 * kiem-dinh 2026-11-06 (lô C ❌): `kpiFpyThat.test.ts` chỉ mock `execute`, nên đột biến f1/f2 (đưa fpyPctOver /
 * fpyPctByBucket về ok/total) sống sót. Ca này chạy `fpyAggregateSql` THẬT.
 *
 * Cách dựng (không để lại gì trong `_test`, không dùng owner `aoi`): MỘT giao dịch, bảng TEMP `product_inspections`
 * che bảng thật (pg_temp đứng đầu search_path) `ON COMMIT DROP`, rồi ném ROLLBACK. 9 hàng:
 *   A: NG@03 → OK@03 (kiểm lại)   B: NTF@03 → OK@04   C: OK@04   D: OK@04 → OK@04   '' ×2: không serial (bị loại)
 * Tính tay: 4 serial dùng được, lần kiểm ĐẦU TIÊN OK chỉ ở C, D ⇒ FPY = 2/4 = 50. Proxy cũ = 7 OK / 9 hàng = 77,78.
 * Theo ngày (bo thuộc ngày của lần kiểm đầu): ngày 03 = {A:NG, B:NTF} = 0 ; ngày 04 = {C, D} = 100.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { fpyPctOver, fpyPctByBucket } from "./kpi";
import { productInspections } from "../../drizzle/schema";

const ROLLBACK = Symbol("rollback");
const DB_URL = process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("FPY thật theo serial — SQL thật, bảng TEMP trong giao dịch ROLLBACK", () => {
  it("serial kiểm lại + NTF ⇒ FPY mới = 50, proxy cũ = 77,78; bucket theo lần kiểm đầu: ngày 03 = 0, ngày 04 = 100", async () => {
    const db = await getDb();
    expect(db).not.toBeNull();
    const out: { fpy?: number; proxy?: number; buckets?: Array<[string, number]> } = {};
    try {
      await db!.transaction(async (tx: any) => {
        await tx.execute(sql`CREATE TEMP TABLE product_inspections (id serial primary key, "serialNumber" text, "inspectionTime" timestamptz, "overallResult" text, "machineId" int) ON COMMIT DROP`);
        const rows: Array<[string, string, string]> = [
          ["A", "2026-11-03T01:00:00Z", "NG"], ["A", "2026-11-03T02:00:00Z", "OK"],
          ["B", "2026-11-03T03:00:00Z", "NTF"], ["B", "2026-11-04T03:00:00Z", "OK"],
          ["C", "2026-11-04T04:00:00Z", "OK"],
          ["D", "2026-11-04T05:00:00Z", "OK"], ["D", "2026-11-04T06:00:00Z", "OK"],
          ["", "2026-11-04T07:00:00Z", "OK"], ["", "2026-11-04T08:00:00Z", "OK"],
        ];
        for (const [s, t, r] of rows) {
          await tx.execute(sql`INSERT INTO product_inspections ("serialNumber","inspectionTime","overallResult","machineId") VALUES (${s}, ${t}, ${r}, 1)`);
        }
        out.fpy = await fpyPctOver(tx, undefined);
        out.proxy = (rows.filter((r) => r[2] === "OK").length / rows.length) * 100;
        const m = await fpyPctByBucket(tx, undefined, sql`date_trunc('day', ${productInspections.inspectionTime})`);
        out.buckets = [...m.entries()].map(([k, v]) => [new Date(Number(k)).toISOString().slice(0, 10), v] as [string, number]);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    expect(out.fpy).toBe(50); // 4 serial dùng được; first-pass = C, D ⇒ 2/4
    expect(out.proxy).toBeCloseTo(77.78, 2); // 7 OK / 9 hàng — công thức CŨ
    expect(out.fpy).toBeLessThan(out.proxy!);
    expect(Object.fromEntries(out.buckets!)).toEqual({ "2026-11-03": 0, "2026-11-04": 100 });
  });
});
