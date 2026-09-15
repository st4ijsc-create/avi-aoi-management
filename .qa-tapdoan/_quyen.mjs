import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
const rows = await sql`select u.username, p."moduleName", p.category, p."canView", p."canCreate", p."canEdit", p."canDelete"
  from permissions p join users u on u.id=p."userId" where u.username like 'qatd\_%' order by u.username, p."moduleName"`;
for (const r of rows) console.log(`${r.username.padEnd(16)} ${r.moduleName.padEnd(20)} V=${r.canView?1:0} C=${r.canCreate?1:0} E=${r.canEdit?1:0} D=${r.canDelete?1:0}`);
await sql.end();
