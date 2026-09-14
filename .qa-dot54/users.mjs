import { readFileSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url, { max: 1 });
const r = await sql`select id, username, role, "isActive" from users order by id`;
console.log(JSON.stringify(r));
await sql.end();
