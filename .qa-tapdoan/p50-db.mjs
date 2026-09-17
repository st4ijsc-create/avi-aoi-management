/**
 * p50-db.mjs — PH-50 BƯỚC 1 ①②: phân bố kích thước toà nhà THẬT theo TỪNG VAI.
 * Đọc thẳng CSDL (nguồn độc lập với trình duyệt), tái hiện ĐÚNG phép kẹp sàn của
 * `saBanTapDoan` (`kepDuong(soMm(x), toiThieu)`) để con số nói về cái sa bàn thấy.
 *   node .qa-tapdoan/p50-db.mjs
 */
import postgres from "postgres";
import fs from "node:fs";
const url = fs.readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

const BIEU_TUONG_TOI_THIEU_MM = 2000; // sẽ đối chiếu với hằng thật ở dưới
const toas = await sql`
  select t.id, t.ma, t.ten, t."factoryId", t."rongMm", t."sauMm", t."caoMm",
         f.code as fcode, f.name as fname
  from twin_toa_nha t join factories f on f.id = t."factoryId"
  order by t."factoryId", t.id`;
const factories = await sql`select id, code, name, "corporateCode" from factories order by id`;
const corps = await sql`select id, code, name from corporates order by id`;

const so = (v) => (v === null || v === undefined ? null : Number(v));
console.log("=== TOÀN BỘ toà nhà trong CSDL ===");
console.table(toas.map((t) => ({ id: t.id, ma: t.ma, nm: t.fcode, rongMm: so(t.rongMm), sauMm: so(t.sauMm), caoMm: so(t.caoMm) })));
console.log("=== factories ===");
console.table(factories.map((f) => ({ id: f.id, code: f.code, name: f.name, corporateCode: f.corporateCode })));
console.log("=== corporates ===");
console.table(corps.map((c) => ({ id: c.id, code: c.code, name: c.name })));

// phạm vi từng vai: gán nhà máy + gán tập đoàn
const us = await sql`select id, username, role from users where username like 'qatd\_%' order by id`;
for (const u of us) {
  const fa = await sql`select "factoryCode" from user_factory_assignments where "userId"=${u.id}`;
  const ca = await sql`select "corporateCode" from user_corporate_assignments where "userId"=${u.id}`;
  console.log(`${u.username} role=${u.role} gánNM=[${fa.map((r) => r.factoryCode).join(",")}] gánTĐ=[${ca.map((r) => r.corporateCode).join(",")}]`);
}
await sql.end();
