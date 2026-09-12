import { readFileSync } from "node:fs"; import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url,{max:1});
const u = await sql`select id, username, role from users where username in ('operator1','e2e_tai_loE')`;
console.log("users:", JSON.stringify(u));
for (const r of u) {
  const a = await sql`select * from user_factory_assignments where "userId" = ${r.id}`;
  console.log(`  ${r.username} (id=${r.id}, role=${r.role}) -> ${a.length} gan nha may`, JSON.stringify(a));
}
console.log("tat ca ufa:", JSON.stringify(await sql`select * from user_factory_assignments`));
await sql.end();
