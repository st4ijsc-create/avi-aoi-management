/** ★ `dangKyModelSanPhamTest` trên CSDL `_test` thật: model + biến thể BASE đã đăng ký bị XOÁ HẲN; model chưa đăng ký KHÔNG bị đụng. */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { __modelDangGiu, dangKyModelSanPhamTest, donModelSanPhamTest } from "./modelSanPhamTest";

const TS = `msp${Date.now()}`;
const conTrongDb = describe.skipIf(!/_test\b/.test(process.env.DATABASE_URL ?? ""));

async function taoModel(code: string): Promise<number> {
  const db = (await getDb())!;
  const [r] = (await db.execute(sql`INSERT INTO public.product_models (code, name) VALUES (${code}, ${code}) RETURNING id`)) as unknown as Array<{ id: number }>;
  return r.id;
}
async function dem(ids: number[]): Promise<{ models: number; variants: number }> {
  const db = (await getDb())!;
  const ds = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const [m] = (await db.execute(sql`SELECT count(*)::int AS n FROM public.product_models WHERE id IN (${ds})`)) as unknown as Array<{ n: number }>;
  const [v] = (await db.execute(sql`SELECT count(*)::int AS n FROM public.product_variants WHERE "productModelId" IN (${ds})`)) as unknown as Array<{ n: number }>;
  return { models: m.n, variants: v.n };
}

conTrongDb("modelSanPhamTest — dọn", () => {
  it("★ đã đăng ký ⇒ xoá hẳn model + biến thể BASE; chưa đăng ký ⇒ còn nguyên", async () => {
    const db = (await getDb())!;
    const a = dangKyModelSanPhamTest(await taoModel(`${TS}-a`));
    const giu = await taoModel(`${TS}-giu`);
    await db.execute(sql`INSERT INTO public.product_variants ("productModelId", code, name, "isBase", "pointsConfigVersion", "lifecycleStatus") VALUES (${a}, 'BASE', 'Base', true, 1, 'active')`);
    expect(__modelDangGiu()).toContain(a);
    expect(await dem([a])).toEqual({ models: 1, variants: 1 });
    const kq = await donModelSanPhamTest();
    expect(kq.daXoa).toBeGreaterThanOrEqual(1);
    expect(await dem([a])).toEqual({ models: 0, variants: 0 });
    expect(await dem([giu])).toEqual({ models: 1, variants: 0 });
    expect(__modelDangGiu()).toEqual([]);
    await db.execute(sql`DELETE FROM public.product_models WHERE id = ${giu}`); // dọn chính ca này
  });
});
