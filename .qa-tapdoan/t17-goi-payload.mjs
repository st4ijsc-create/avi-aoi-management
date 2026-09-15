// Task 17 — kích thước phản hồi (thô + gzip) và phân bố Z theo tầng. CHỈ SELECT.
import postgres from "postgres";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url, { max: 2 });
const nm = [41,42,43];
const out = { moc: new Date().toISOString() };
const cay = async (ids) => {
  const xuong = await sql`select id, code, name, "factoryId" from workshops where "factoryId" in ${sql(ids)}`;
  const chuyen = xuong.length ? await sql`select id, code, name, "workshopId" from production_lines where "workshopId" in ${sql(xuong.map(x=>x.id))}` : [];
  const tram = chuyen.length ? await sql`select id, code, name, "lineId", "orderIndex" from stations where "lineId" in ${sql(chuyen.map(c=>c.id))}` : [];
  const may = tram.length ? await sql`select id, code, name, "machineType", "isActive", "stationId" from machines where "stationId" in ${sql(tram.map(t=>t.id))}` : [];
  return { xuong, chuyen, tram, may };
};
const tangCua = async (ids) => (await sql`select s.id from twin_tang s join twin_toa_nha b on b.id=s."toaNhaId"
  where b."factoryId" in ${sql(ids)} and s."isActive" and b."isActive" order by s.id`).map(r=>Number(r.id));
const datCho = async (tangIds) => (await sql`select id, "tangId", "loaiThucThe", "thucTheId",
  ("viTriXMm")::float8 as "viTriXMm", ("viTriYMm")::float8 as "viTriYMm", ("viTriZMm")::float8 as "viTriZMm",
  ("rongMm")::float8 as "rongMm", ("caoMm")::float8 as "caoMm", ("sauMm")::float8 as "sauMm",
  "kichThuocDaDo", ("quatX")::float8 as "quatX", ("quatY")::float8 as "quatY", ("quatZ")::float8 as "quatZ", ("quatW")::float8 as "quatW",
  "daKhoa", "hienThi", nguon, "updatedAt" from twin_dat_cho where "tangId" in ${sql(tangIds)}`);
const kichThuoc = await sql`select * from twin_kich_thuoc_loai`.catch(()=>[]);
const toaNha = async (ids) => sql`select id, "factoryId", ma, ten, ("viTriXMm")::float8 as x, ("viTriYMm")::float8 as y, ("viTriZMm")::float8 as z,
  ("rongMm")::float8 as rong, ("sauMm")::float8 as sau, ("caoMm")::float8 as cao from twin_toa_nha where "factoryId" in ${sql(ids)} and "isActive"`;

for (const [ten, ids] of [["1 nha may (41)", [41]], ["3 nha may (41,42,43)", nm]]) {
  const t = await tangCua(ids);
  const body = { ...(await cay(ids)), datCho: await datCho(t), kichThuoc, toaNha: await toaNha(ids), vung: [] };
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  out[ten] = {
    soTang: t.length, soMay: body.may.length, soDatCho: body.datCho.length, soToa: body.toaNha.length,
    byteJson: raw.length, kbJson: +(raw.length/1024).toFixed(1),
    byteGzip: gzipSync(raw).length, kbGzip: +(gzipSync(raw).length/1024).toFixed(1),
  };
}
// Z của đặt chỗ theo tầng — có đang xếp chồng theo độ cao không?
out.zTheoTang = (await sql`select s.id as "tangId", s."capSo", b.ma as toa, f.code as nm,
  min(dc."viTriZMm")::float8 as "zMin", max(dc."viTriZMm")::float8 as "zMax", count(*)::int as n,
  (s."caoDoMm")::float8 as "caoDoTangMm"
  from twin_dat_cho dc join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=b."factoryId" where f.code like 'QATD-%' group by s.id, s."capSo", b.ma, f.code, s."caoDoMm"
  order by f.code, b.ma, s."capSo"`).slice(0, 14);
await sql.end();
mkdirSync(".qa-tapdoan/tho/T17", { recursive: true });
writeFileSync(".qa-tapdoan/tho/T17/.tmp-pl.json", JSON.stringify(out, null, 1));
renameSync(".qa-tapdoan/tho/T17/.tmp-pl.json", ".qa-tapdoan/tho/T17/payload.json");
console.log(JSON.stringify(out, null, 1));
