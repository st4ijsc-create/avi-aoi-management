import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.PG_URL, { max: 4, onnotice: () => {} });
const LOI_GIAI = fs.readFileSync(new URL("./sol.sql", import.meta.url), "utf8");
before(async () => {
  await sql.unsafe(`create table do_kiem(id bigserial primary key, may text not null, ket_qua text not null check (ket_qua in ('OK','NG')), luc timestamptz not null, gia_tri numeric(10,2));
    insert into do_kiem(may, ket_qua, luc, gia_tri) values
      ('M02','NG','2026-10-18 08:00+07', 5.00),
      ('M01','OK','2026-10-18 08:00+07', 1.10),
      ('M01','NG','2026-10-18 09:00+07', 2.20),
      ('M01','OK','2026-10-18 09:00+07', 3.30),
      ('M01','OK','2026-10-18 07:00+07', 9.90),
      ('M02','OK','2026-10-18 10:00+07', null),
      ('M02','OK','2026-10-18 06:00+07', 4.00),
      ('M03','OK','2026-10-18 06:00+07', 7.77)`);
});
after(async () => { await sql.end({ timeout: 2 }); });
test("moi may mot hang: gia tri moi nhat (hoa ⇒ id lon), dem NG, ty le 4 chu so", async () => {
  const r = await sql.unsafe(LOI_GIAI);
  const g = r.map((x) => ({ may: x.may, gia_tri_cuoi: x.gia_tri_cuoi === null ? null : String(x.gia_tri_cuoi), so_ng: String(x.so_ng), ty_le_ng: String(x.ty_le_ng) }));
  assert.deepEqual(g, [
    { may: "M01", gia_tri_cuoi: "3.30", so_ng: "1", ty_le_ng: "0.2500" },
    { may: "M02", gia_tri_cuoi: null, so_ng: "1", ty_le_ng: "0.3333" },
    { may: "M03", gia_tri_cuoi: "7.77", so_ng: "0", ty_le_ng: "0.0000" },
  ]);
  assert.deepEqual(r.columns.map((c) => c.name), ["may", "gia_tri_cuoi", "so_ng", "ty_le_ng"]);
});
test("bang rong ⇒ khong hang nao", async () => {
  await sql`truncate do_kiem`;
  assert.equal((await sql.unsafe(LOI_GIAI)).length, 0);
});
