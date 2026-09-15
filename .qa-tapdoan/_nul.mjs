import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
for (const t of ["twin_toa_nha","twin_tang"]) {
  const c = await sql`select column_name, is_nullable, column_default, data_type from information_schema.columns where table_name=${t} order by ordinal_position`;
  console.log("== "+t); for (const x of c) console.log(`  ${x.column_name} ${x.data_type} null=${x.is_nullable} def=${x.column_default}`);
}
console.log("== mau toa nha 65"); console.log(JSON.stringify((await sql`select * from twin_toa_nha where id=65`)[0]));
console.log("== mau tang 165"); console.log(JSON.stringify((await sql`select * from twin_tang where id=165`)[0]));
await sql.end();
