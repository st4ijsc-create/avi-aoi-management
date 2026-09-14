import postgres from 'postgres';
import fs from 'fs';
const env=fs.readFileSync('.env','utf8');
const m=env.split(/\r?\n/).find(l=>/^DATABASE_URL=/.test(l));
const url=m.slice('DATABASE_URL='.length).trim();
const sql=postgres(url,{max:1,idle_timeout:5});
const tables=['factory_zones','machine_positions','factory_layouts','twin_ban_ghi'];
for(const t of tables){
  try{ const r=await sql.unsafe(`select count(*)::int c from ${t}`); console.log(t.padEnd(22),r[0].c); }
  catch(e){ console.log(t.padEnd(22),'ERR:',String(e.message).slice(0,70)); }
}
// twinCanh zone table name?
try{ const r=await sql`select table_name from information_schema.tables where table_schema='public' and (table_name like '%vung%' or table_name like '%zone%' or table_name like '%canh%') order by 1`;
 console.log('\nbang lien quan vung/canh:'); r.forEach(x=>console.log('  ',x.table_name)); }catch(e){console.log('ERR',e.message);}
await sql.end();
