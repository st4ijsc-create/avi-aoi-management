import { readFileSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url, { max: 1 });
const r = await sql`select id, "machineId", state, status, title, "lineId" from andon_events order by id`;
console.log(JSON.stringify(r, null, 1));
const m = await sql`select id, code, name, "isActive" from machines where id in (6,7,13,14,17,18,20,21,22,23,246,247) order by id`;
console.log("MAY:", JSON.stringify(m));
await sql.end();
