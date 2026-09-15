/** Neo dữ kiện cho đợt NGHIỆM-THU CUỐI — SELECT xong ghi tho/CUOI/moc.json */
import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:2});
const fac = await sql`select id, code, name from factories where code like 'QATD-%' order by code`;
const F = Object.fromEntries(fac.map(f=>[f.code,f.id]));
const tang = await sql`select f.code fcode, b.id toa_id, b.ma toa_ma, t.id tang_id, t."capSo" cap,
   (select count(*)::int from twin_dat_cho d where d."tangId"=t.id and d."loaiThucThe"='machine') so_may
  from twin_tang t join twin_toa_nha b on b.id=t."toaNhaId" join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%' order by f.code, b.ma, t."capSo"`;
const dong = [...tang].sort((a,b)=>b.so_may-a.so_may)[0];
const rongA = tang.find(t=>t.fcode==='QATD-A' && t.so_may===0);
const tangC = tang.find(t=>t.fcode==='QATD-C' && t.so_may>0);
const tangA = tang.find(t=>t.fcode==='QATD-A' && t.so_may>0);
// chuyền + máy trên tầng đông (cho deep-link H1)
const mayDong = await sql`select m.id, m.code, s.id tram, l.id chuyen from twin_dat_cho d
  join machines m on m.id=d."thucTheId" join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId"
  where d."tangId"=${dong.tang_id} and d."loaiThucThe"='machine' order by m.id limit 3`;
// máy QATD-B (ngoài phạm vi công nhân) và QATD-C (trong phạm vi)
const mayB = await sql`select m.id, m.code from twin_dat_cho d join machines m on m.id=d."thucTheId"
  join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId"
  join factories f on f.id=w."factoryId" where f.code='QATD-B' and d."loaiThucThe"='machine' order by m.id limit 2`;
const mayC = await sql`select m.id, m.code from twin_dat_cho d join machines m on m.id=d."thucTheId"
  join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId"
  join factories f on f.id=w."factoryId" where f.code='QATD-C' and d."tangId"=${tangC.tang_id} and d."loaiThucThe"='machine' order by m.id limit 3`;
// andon mẫu: 1 trong QATD-A (kỹ thuật ghi chú được), 1 trong QATD-C (ngoài phạm vi kỹ thuật)
const andonA = await sql`select a.id, a.status, a.message, a."resolvedAt", a."machineId", m.code may
  from andon_events a join machines m on m.id=a."machineId" join stations s on s.id=m."stationId"
  join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where f.code='QATD-A' and a."resolvedAt" is null order by a.id limit 2`;
const andonC = await sql`select a.id, a."machineId", m.code may from andon_events a join machines m on m.id=a."machineId"
  join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId"
  join factories f on f.id=w."factoryId" where f.code='QATD-C' and a."resolvedAt" is null order by a.id limit 2`;
// T2: tầng có >=6 máy CHƯA khoá, trong phạm vi kỹ thuật (QATD-A/B)
const tangT2 = await sql`select f.code fcode, b.id toa_id, t.id tang_id, t."capSo" cap, count(*)::int n
  from twin_dat_cho d join twin_tang t on t.id=d."tangId" join twin_toa_nha b on b.id=t."toaNhaId"
  join factories f on f.id=b."factoryId" where f.code in ('QATD-A','QATD-B') and d."loaiThucThe"='machine' and d."daKhoa"=false
  group by 1,2,3,4 having count(*)>=6 order by n desc limit 3`;
const maxTangMoiToa = await sql`select max(n)::int m from (select count(*)::int n from twin_tang group by "toaNhaId") x`;
const M = { luc: new Date().toISOString(), factories: fac, F, tangDong: dong, tangRongA: rongA, tangC, tangA,
  mayDong, mayB, mayC, andonA, andonC, tangT2, maxTangMoiToa: maxTangMoiToa[0].m,
  soTangTheoToa: tang.reduce((a,t)=>{a[t.toa_ma]=(a[t.toa_ma]??0)+1; return a;},{}),
  tangRongDs: tang.filter(t=>t.so_may===0).slice(0,5) };
fs.mkdirSync(".qa-tapdoan/tho/CUOI",{recursive:true});
fs.writeFileSync(".qa-tapdoan/tho/CUOI/moc.json", JSON.stringify(M,null,1));
console.log(JSON.stringify({tangDong:dong, tangRongA:rongA, tangC, tangA, mayDong, mayB, mayC, andonA, andonC, tangT2, maxTangMoiToa:M.maxTangMoiToa},null,1));
await sql.end();
