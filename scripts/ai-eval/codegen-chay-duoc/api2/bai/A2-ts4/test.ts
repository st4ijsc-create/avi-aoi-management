import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableName } from "drizzle-orm";
import { demLoi, congDon } from "./sol.mjs";
const sql = postgres(process.env.PG_URL!, { max: 10, onnotice: () => {} });
const db = drizzle(sql);
before(async () => {
  await sql`create table dem_loi(ma text primary key, so_lan integer not null default 0, cap_nhat timestamp with time zone not null default now())`;
});
after(async () => { await sql.end({ timeout: 2 }); });
test("khai bao bang", () => {
  assert.equal(getTableName(demLoi), "dem_loi");
  assert.equal((demLoi as any).soLan.name, "so_lan");
  assert.equal((demLoi as any).capNhat.name, "cap_nhat");
});
test("them moi roi cong don", async () => {
  assert.deepEqual(await congDon(db as any, "E01", 2), { ma: "E01", soLan: 2, moi: true });
  await sql`update dem_loi set cap_nhat = now() - interval '1 day' where ma = 'E01'`;
  assert.deepEqual(await congDon(db as any, "E01", 3), { ma: "E01", soLan: 5, moi: false });
  const [r] = await sql`select so_lan, cap_nhat > now() - interval '1 hour' as moi_cap_nhat from dem_loi where ma = 'E01'`;
  assert.equal(r.so_lan, 5);
  assert.equal(r.moi_cap_nhat, true, "cap_nhat phai duoc dat lai now()");
  assert.deepEqual(await congDon(db as any, "E02", 1), { ma: "E02", soLan: 1, moi: true });
});
test("dong thoi 20 loi goi tren cung ma: tong dung, dung MOT lan moi", async () => {
  const kq = await Promise.all(Array.from({ length: 20 }, () => congDon(db as any, "E09", 1)));
  const [r] = await sql`select so_lan from dem_loi where ma = 'E09'`;
  assert.equal(r.so_lan, 20);
  assert.equal(kq.filter((x) => x.moi).length, 1);
  assert.deepEqual(kq.map((x) => x.soLan).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
});
test("them sai ⇒ RangeError, khong cham db", async () => {
  const bay = new Proxy({}, { get() { throw new Error("khong duoc cham db"); } });
  await assert.rejects(() => congDon(bay as any, "X", 0), RangeError);
  await assert.rejects(() => congDon(bay as any, "X", 1.5), RangeError);
  await assert.rejects(() => congDon(bay as any, "X", -2), RangeError);
});
