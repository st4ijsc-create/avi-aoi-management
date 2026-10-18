import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.PG_URL, { max: 10, onnotice: () => {} });
const LOI_GIAI = fs.readFileSync(new URL("./sol.sql", import.meta.url), "utf8");
before(async () => {
  await sql`create table dem_loi(ma text primary key, so_lan integer not null)`;
  await sql.unsafe(LOI_GIAI).simple();
});
after(async () => { await sql.end({ timeout: 2 }); });
const goi = async (ma, them) => { const r = await sql`select * from ghi_dem(${ma}, ${them}::integer)`; assert.equal(r.length, 1, "phai tra dung MOT hang"); return { ma: r[0].ma, so_lan: r[0].so_lan, moi: r[0].moi }; };
test("them moi roi cong don", async () => {
  assert.deepEqual(await goi("E01", 2), { ma: "E01", so_lan: 2, moi: true });
  assert.deepEqual(await goi("E01", 3), { ma: "E01", so_lan: 5, moi: false });
  assert.deepEqual(await goi("E02", 7), { ma: "E02", so_lan: 7, moi: true });
  const [r] = await sql`select so_lan from dem_loi where ma = 'E01'`;
  assert.equal(r.so_lan, 5);
});
test("20 phien dong thoi: tong dung, dung MOT lan moi", async () => {
  const kq = await Promise.all(Array.from({ length: 20 }, () => goi("E09", 1)));
  assert.equal(kq.filter((x) => x.moi).length, 1);
  assert.deepEqual(kq.map((x) => x.so_lan).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
});
test("p_them khong hop le ⇒ SQLSTATE 22023, khong ghi", async () => {
  for (const v of [0, -3, null]) {
    await assert.rejects(() => sql`select * from ghi_dem('E77', ${v}::integer)`, (e) => e.code === "22023");
  }
  assert.equal((await sql`select 1 from dem_loi where ma = 'E77'`).length, 0);
});
