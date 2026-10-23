/**
 * ★ Helper `taoNguoiDungTest` trên CSDL `_test` thật — hai nhánh dọn:
 *   • bình thường: người dùng + hàng phụ thuộc trong danh sách dọn (gán nhà máy…) ⇒ XOÁ hẳn;
 *   • FK chặn (một hàng con NGOÀI danh sách dọn trỏ tới người dùng: `report_templates.createdBy`, NO ACTION) ⇒ KHÔNG xoá, đặt `isActive=false`, CÓ cảnh báo nêu lý do.
 * Đột biến: bỏ nhánh `UPDATE ... isActive=false` ⇒ ca FK đỏ; bỏ bước xoá hàng phụ thuộc ⇒ ca bình thường đỏ (người dùng còn).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { donNguoiDungTest, taoNguoiDungTest, __idNguoiDungDangGiu } from "./nguoiDungTest";

const TS = `ndt${Date.now()}`;
const conTrongDb = describe.skipIf(!/_test\b/.test(process.env.DATABASE_URL ?? ""));

async function hang(id: number) {
  const db = (await getDb())!;
  return (await db.execute(sql`SELECT id, "isActive" FROM public.users WHERE id = ${id}`)) as unknown as Array<{ id: number; isActive: boolean }>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

conTrongDb("taoNguoiDungTest — dọn", () => {
  it("★ bình thường: người dùng có hàng gán nhà máy ⇒ XOÁ hẳn cả hai, không cảnh báo, registry sạch", async () => {
    const db = (await getDb())!;
    const u = await taoNguoiDungTest("xoa", "admin", { tienTo: "ndt", ts: TS });
    expect(__idNguoiDungDangGiu()).toContain(u.id);
    const [f] = (await db.execute(sql`SELECT code FROM public.factories ORDER BY id LIMIT 1`)) as unknown as Array<{ code: string }>;
    if (f) await db.execute(sql`INSERT INTO public.user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${f.code})`);
    const canhBao = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const kq = await donNguoiDungTest();
    expect(kq.daXoa).toBeGreaterThanOrEqual(1);
    expect(kq.voHieuHoa).toBe(0);
    expect(await hang(u.id)).toEqual([]);
    if (f) expect((await db.execute(sql`SELECT 1 FROM public.user_factory_assignments WHERE "userId" = ${u.id}`)) as unknown as unknown[]).toHaveLength(0);
    expect(canhBao).not.toHaveBeenCalled();
    expect(__idNguoiDungDangGiu()).toEqual([]);
  });

  it("★★ FK chặn: hàng con ngoài danh sách dọn ⇒ người dùng còn, isActive=false, có cảnh báo nêu lý do", async () => {
    const db = (await getDb())!;
    const u = await taoNguoiDungTest("fk", "admin", { tienTo: "ndt", ts: TS });
    expect(u.isActive).toBe(true);
    const [{ udt }] = (await db.execute(
      sql`SELECT udt_name AS udt FROM information_schema.columns WHERE table_name = 'report_templates' AND column_name = 'templateType'`,
    )) as unknown as Array<{ udt: string }>;
    const [con] = (await db.execute(
      sql`INSERT INTO public.report_templates (name, code, "templateType", sections, "createdBy")
          VALUES ('ndt fk', ${"NDT-" + TS}, (enum_range(NULL::${sql.raw(JSON.stringify(udt))}))[1], '{}'::json, ${u.id}) RETURNING id`,
    )) as unknown as Array<{ id: number }>;
    const canhBao = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const kq = await donNguoiDungTest();
      expect(kq).toEqual({ daXoa: 0, voHieuHoa: 1 });
      expect(await hang(u.id)).toEqual([{ id: u.id, isActive: false }]);
      expect(canhBao).toHaveBeenCalledTimes(1);
      expect(String(canhBao.mock.calls[0][0])).toMatch(/\[nguoiDungTest\] FK chặn xoá users \(.*report_templates.*\) ⇒ đặt isActive=false cho 1 người/);
    } finally {
      // dọn chính ca này: gỡ hàng con rồi xoá người dùng
      await db.execute(sql`DELETE FROM public.report_templates WHERE id = ${con.id}`);
      await db.execute(sql`DELETE FROM public.users WHERE id = ${u.id}`);
    }
    expect(await hang(u.id)).toEqual([]);
  });
});
