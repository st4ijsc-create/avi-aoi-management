import { readFileSync } from "node:fs"; import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url,{max:1});
console.log(JSON.stringify(await sql`select username, role, "isActive" from users order by id`, null, 0));
await sql.end();
