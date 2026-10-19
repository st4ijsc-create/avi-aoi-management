import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableName } from "drizzle-orm";
import { doKiem, demLoiTheoMay } from "./sol.mjs";
const sql = postgres(process.env.PG_URL!, { max: 4, onnotice: () => {} });
const db = drizzle(sql);
before(async () => {
  await sql`create table do_kiem(id serial primary key, may text not null, ket_qua text not null, luc timestamp with time zone not null, gia_tri double precision)`;
  const t0 = Date.UTC(2026, 9, 18, 0, 0, 0);
  const h = (m: number) => new Date(t0 + m * 60000);
  const dong: [string, string, Date, number | null][] = [
    ["M01", "NG", h(10), 1.5], ["M01", "NG", h(20), 2], ["M01", "OK", h(30), 3], ["M01", "NG", h(-30), 4],
    ["M02", "NG", h(5), null], ["M02", "NG", h(6), 5], ["M02", "NG", h(7), 6],
    ["M03", "NG", h(1), 7], ["M03", "NG", h(2), 8],
    ["M04", "OK", h(3), 9], ["M05", "NG", h(4), 10],
  ];
  const giaTri = dong.map(([m, k, l, g]) => `('${m}', '${k}', '${l.toISOString()}', ${g === null ? "null" : g})`).join(", ");
  await sql.unsafe(`insert into do_kiem(may, ket_qua, luc, gia_tri) values ${giaTri}`);
});
after(async () => { await sql.end({ timeout: 2 }); });
test("khai bao bang dung ten cot va kieu doc ra", async () => {
  assert.equal(getTableName(doKiem), "do_kiem");
  assert.equal((doKiem as any).ketQua.name, "ket_qua");
  assert.equal((doKiem as any).giaTri.name, "gia_tri");
  const [r] = await db.select().from(doKiem).limit(1) as any[];
  assert.ok(r.luc instanceof Date, "luc phai doc ra Date");
  assert.equal(typeof r.giaTri, "number");
  assert.equal(typeof r.ketQua, "string");
});
test("dem loi: loc may + moc thoi gian, sap soLoi giam roi may tang, soLoi la number", async () => {
  const kq = await demLoiTheoMay(db as any, ["M01", "M02", "M03", "M04"], new Date(Date.UTC(2026, 9, 18, 0, 0, 0)));
  assert.deepEqual(kq, [{ may: "M02", soLoi: 3 }, { may: "M01", soLoi: 2 }, { may: "M03", soLoi: 2 }]);
  assert.equal(typeof kq[0].soLoi, "number");
});
test("moc tu loai tru ban ghi truoc do; may khong co loi khong xuat hien", async () => {
  const kq = await demLoiTheoMay(db as any, ["M01", "M04", "M05"], new Date(Date.UTC(2026, 9, 18, 0, 6, 0)));
  assert.deepEqual(kq, [{ may: "M01", soLoi: 2 }]);
});
test("cacMay rong ⇒ [] va khong cham db", async () => {
  const bay = new Proxy({}, { get() { throw new Error("khong duoc cham db"); } });
  assert.deepEqual(await demLoiTheoMay(bay as any, [], new Date()), []);
});
