import { readFileSync } from "node:fs"; import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url,{max:1});
console.log("factories:", JSON.stringify(await sql`select id, code, name from factories order by id`));
console.log("may/factory:", JSON.stringify(await sql`select f.id, count(m.id)::int n from factories f left join workshops w on w."factoryId"=f.id left join production_lines pl on pl."workshopId"=w.id left join stations s on s."lineId"=pl.id left join machines m on m."stationId"=s.id and m."isActive" group by f.id order by f.id`));
await sql.end();
