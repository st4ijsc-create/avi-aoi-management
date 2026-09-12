import { readFileSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url, { max: 1 });
console.log("phan bo operationStatus (isActive=true):");
console.table(await sql.unsafe(`select coalesce("operationStatus"::text,'KHONG-CO(null)') op, count(*)::int n from machines where "isActive"=true group by 1 order by 2 desc`));
console.log("12 may cua twin:");
console.table(await sql.unsafe(`select id, code, "operationStatus", "lastHeartbeat" from machines where id in (6,7,13,14,17,18,20,21,22,23,246,247) order by id`));
await sql.end();
