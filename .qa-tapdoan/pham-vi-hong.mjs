// Bán kính ảnh hưởng của `factories[0]` + `toaNha[0]` — CHỈ SELECT.
// Mô hình: màn Line/Máy chỉ vẽ đủ khi line/máy thuộc factories[0] VÀ tầng của nó thuộc toaNha[0] của nhà máy ấy.
import postgres from "postgres";
import { readFileSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:2});
const VAI = {
  qatd_kythuat:  { fac0: 38, scope: [38,39] },
  qatd_giamdoc:  { fac0: 38, scope: [38,39,40] },
  qatd_admin:    { fac0: 38, scope: null },
  qatd_congnhan: { fac0: 40, scope: [40] },
  qatd_quanly:   { fac0: 38, scope: [38] },
};
const rows = await sql`
  select l.id as "lineId", f.id as "facId", f.code as fac, b.id as "toaId", b.ma as toa,
   (select count(*) from machines m join stations st on st.id=m."stationId" where st."lineId"=l.id and st."isActive"=true and m."isActive"=true) as may
  from production_lines l join workshops w on w.id=l."workshopId"
  left join twin_tang s on s.id=w."tangId" left join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=w."factoryId" where l."isActive"=true and f."isActive"=true`;
const toa0 = {}; // nhà máy → toà nhà [0] (order by ma asc)
for (const b of await sql`select id, "factoryId", ma from twin_toa_nha where "isActive"=true order by "factoryId", ma`)
  if (toa0[b.factoryId] === undefined) toa0[b.factoryId] = b.id;
console.log("toaNha[0] mỗi nhà máy:", JSON.stringify(toa0));
for (const [u, v] of Object.entries(VAI)) {
  const trong = rows.filter(r => v.scope === null || v.scope.includes(r.facId));
  const ok   = trong.filter(r => r.facId === v.fac0 && r.toaId === toa0[v.fac0]);
  const tier2= trong.filter(r => r.facId === v.fac0 && r.toaId !== toa0[v.fac0]);
  const tier1= trong.filter(r => r.facId !== v.fac0);
  const s = a => a.reduce((x,r)=>x+Number(r.may),0);
  console.log(`${u.padEnd(15)} phạm vi ${trong.length} line / ${s(trong)} máy | VẼ ĐỦ ${ok.length} line / ${s(ok)} máy | ĐẦU ĐÚNG CẢNH RỖNG ${tier2.length} line / ${s(tier2)} máy | TỪ CHỐI HẲN ${tier1.length} line / ${s(tier1)} máy  ⇒ hỏng ${(100*(trong.length-ok.length)/trong.length).toFixed(1)}% line`);
}
await sql.end();
