// ĐỢT 54 — TẠM đặt machines."operationStatus" = NULL / '' cho 1 máy (ca THIẾU DỮ KIỆN), rồi trả lại.
//   node .qa-dot54/opnull.mjs dat <mid> <null|rong>   |   tra <mid> <giaTriCu>   |   xem <mid>
import { readFileSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url, { max: 1 });
const [lenh, midS, v] = process.argv.slice(2);
const mid = Number(midS);
const xem = async () => (await sql`select id, code, "operationStatus" from machines where id=${mid}`)[0];
let out = {};
if (lenh === "xem") out = { xem: await xem() };
else if (lenh === "dat") {
  const truoc = await xem();
  const moi = v === "rong" ? "" : null;
  await sql`update machines set "operationStatus"=${moi} where id=${mid}`;
  out = { truoc, dat: moi === null ? "NULL" : "''", sau: await xem() };
} else if (lenh === "tra") {
  const truoc = await xem();
  await sql`update machines set "operationStatus"=${v} where id=${mid}`;
  out = { truoc, tra: v, sau: await xem() };
} else out = { err: "dat|tra|xem" };
out.tongMay = (await sql`select count(*)::int c from machines`)[0].c;
console.log(JSON.stringify(out));
await sql.end();
