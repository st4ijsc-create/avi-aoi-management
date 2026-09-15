// Lô G — hợp đồng trạng thái: API overview vs DB, cùng luật tuổi heartbeat 5 phút.
import postgres from "postgres"; import fs from "node:fs";
const BASE = process.argv[2] || "http://localhost:3064";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL="))?.slice(13).replace(/^["']|["']$/g,"");
const sql = postgres(url,{max:1});
const lg = await fetch(`${BASE}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"qatd_kythuat",password:"Qatd!2026"}),redirect:"manual"});
const cookie = (lg.headers.getSetCookie?.()??[]).map(c=>c.split(";")[0]).join("; ");
const r = await fetch(`${BASE}/api/trpc/factoryCommand.overview?input=${encodeURIComponent(JSON.stringify({json:{factoryId:39}}))}`,{headers:{cookie}});
const j = await r.json(); const d = j?.result?.data?.json ?? j?.result?.data;
const may = d?.machines ?? [];
const apiPhanBo = {}; for (const m of may) { const k = m.status ?? m.operationStatus ?? m.trangThai ?? "(không có ô status)"; apiPhanBo[k] = (apiPhanBo[k]||0)+1; }
const oMau = may[0] ? Object.keys(may[0]) : [];
const db = await sql`
  select m."operationStatus" tt,
         (m."lastHeartbeat" is not null and m."lastHeartbeat" >= now() - interval '5 minutes') as tuoi,
         count(*)::int n
  from machines m join stations s on s.id=m."stationId" join production_lines l on l."id"=s."lineId"
  join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where f.code='QATD-B' group by 1,2 order by 1,2`;
const dbTong = db.reduce((a,b)=>a+b.n,0);
console.log(JSON.stringify({
  apiSoMay: may.length, dbSoMay: dbTong,
  apiPhanBoTrangThai: apiPhanBo,
  dbPhanBo: db.map(r=>({ tt:r.tt, heartbeatTuoi:r.tuoi, n:r.n })),
  oCuaMotMay: oMau,
  mauMay: may[0] ? Object.fromEntries(Object.entries(may[0]).slice(0,14)) : null,
}, null, 1));
await sql.end();
