import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.PG_URL, { max: 4, onnotice: () => {} });
const LOI_GIAI = fs.readFileSync(new URL("./sol.sql", import.meta.url), "utf8");
before(async () => {
  await sql.unsafe(`create table do_kiem(id bigserial primary key, may text not null, luc timestamptz not null, gia_tri numeric(10,2) not null);
    insert into do_kiem(may, luc, gia_tri) values
      ('M01','2026-10-18 00:07:00+00', 10.00),
      ('M01','2026-10-18 00:14:59+00', 11.00),
      ('M02','2026-10-18 00:15:00+00', 20.00),
      ('M01','2026-10-18 00:52:00+00', 1.00),
      ('M02','2026-10-18 00:53:00+00', 2.00),
      ('M02','2026-10-18 00:54:00+00', 2.00),
      ('M01','2026-10-17 23:59:59+00', 99.00),
      ('M01','2026-10-18 01:00:00+00', 99.00)`);
});
after(async () => { await sql.end({ timeout: 2 }); });
const t = (s) => new Date(s);
test("4 khung 15 phut, ke ca khung trong, loai ban ghi ngoai khoang", async () => {
  const r = await sql.unsafe(LOI_GIAI, [t("2026-10-18T00:00:00Z"), t("2026-10-18T01:00:00Z")]);
  assert.deepEqual(r.columns.map((c) => c.name), ["khung", "so_ban_ghi", "tb"]);
  const g = r.map((x) => [new Date(x.khung).toISOString(), String(x.so_ban_ghi), x.tb === null ? null : String(x.tb)]);
  assert.deepEqual(g, [
    ["2026-10-18T00:00:00.000Z", "2", "10.50"],
    ["2026-10-18T00:15:00.000Z", "1", "20.00"],
    ["2026-10-18T00:30:00.000Z", "0", null],
    ["2026-10-18T00:45:00.000Z", "3", "1.67"],
  ]);
});
test("can theo moc bat dau le (00:05)", async () => {
  const r = await sql.unsafe(LOI_GIAI, [t("2026-10-18T00:05:00Z"), t("2026-10-18T00:35:00Z")]);
  const g = r.map((x) => [new Date(x.khung).toISOString(), String(x.so_ban_ghi), x.tb === null ? null : String(x.tb)]);
  assert.deepEqual(g, [
    ["2026-10-18T00:05:00.000Z", "3", "13.67"],
    ["2026-10-18T00:20:00.000Z", "0", null],
  ]);
});
