import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
const r = await sql`select f.code, count(*)::int n,
  count(*) filter (where a."raisedAt" < now() - interval '24 hours')::int qua24h,
  min(a."raisedAt") som, max(a."raisedAt") muon
 from andon_events a join machines m on m.id=a."machineId" join stations s on s.id=m."stationId"
 join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
 where a."resolvedAt" is null group by f.code order by f.code`;
console.log(JSON.stringify(r,null,1));
const t = await sql`select count(*)::int n, count(*) filter (where "raisedAt" < now() - interval '24 hours')::int qua24h from andon_events where "resolvedAt" is null`;
console.log("tong dang mo",JSON.stringify(t));
await sql.end();
