// VÒNG 3 — kiểm DỌN cuối lượt (CHỈ SELECT): số hàng + số hàng bị khoá + hàng của máy đã sửa.
import postgres from "postgres";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url, { max: 2 });
const chung = JSON.parse(readFileSync(".qa-tapdoan/tho/V3/H1-CHUNG.json","utf8"));
const ids = [chung.mayL1, chung.mayL4].filter((x) => typeof x === "number");
const out = { mayDaCham: ids };
out.tong = Number((await sql`select count(*) as n from twin_dat_cho`)[0].n);
out.qatd = Number((await sql`select count(*) as n from twin_dat_cho dc
  join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=b."factoryId" where f.code like 'QATD-%'`)[0].n);
out.qatdDaKhoa = Number((await sql`select count(*) as n from twin_dat_cho dc
  join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=b."factoryId" where f.code like 'QATD-%' and dc."daKhoa"=true`)[0].n);
out.toanBoDaKhoa = Number((await sql`select count(*) as n from twin_dat_cho where "daKhoa"=true`)[0].n);
out.hangMayDaCham = ids.length ? await sql`select id, "tangId", "thucTheId", "daKhoa", nguon, "viTriXMm", "viTriYMm", "viTriZMm", "updatedAt"
  from twin_dat_cho where "loaiThucThe"='machine' and "thucTheId" in ${sql(ids)} order by "thucTheId"` : [];
out.mocDauVong3 = { tong: 2420, qatd: 2338, qatdDaKhoa: 0 };
out.sach = out.tong === 2420 && out.qatd === 2338 && out.qatdDaKhoa === 0;
await sql.end();
const s = JSON.stringify(out, (k,v)=>typeof v==="bigint"?Number(v):v, 1);
writeFileSync(".qa-tapdoan/tho/V3/.tmp-don.json", s);
renameSync(".qa-tapdoan/tho/V3/.tmp-don.json", ".qa-tapdoan/tho/V3/don-cuoi.json");
console.log(JSON.stringify(out, (k,v)=>typeof v==="bigint"?Number(v):v));
