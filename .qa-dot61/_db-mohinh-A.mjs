// MÔ HÌNH A — LỌC + ĐẾM (cách quen thuộc; đây là cách DỄ SAI của BG-127)
import postgres from 'postgres'; import fs from 'fs';
const url = fs.readFileSync('.env','utf8').split(/\r?\n/).find(l=>/^DATABASE_URL=/.test(l)).slice('DATABASE_URL='.length).trim();
const sql = postgres(url,{max:1,idle_timeout:5});
const out = {};
console.log('DB =', url.replace(/:[^:@]*@/,':***@'));
for (const t of ['factory_zones','safety_zones']) {
  try { const r = await sql.unsafe(`select count(*)::int c from "${t}"`); out[t]=r[0].c; console.log('A count', t.padEnd(16), r[0].c); }
  catch(e){ out[t]='ERR '+e.message.slice(0,60); console.log('A count', t.padEnd(16), 'ERR', e.message.slice(0,70)); }
}
for (const col of ['layoutPositionX','layoutPositionY','layout']) {
  try { const r = await sql.unsafe(`select count(*)::int c from machines where "${col}" is not null`); out['machines.'+col+'_notnull']=r[0].c; console.log('A count machines.'+col.padEnd(16),'not null =',r[0].c); }
  catch(e){ out['machines.'+col]='ERR '+e.message.slice(0,60); console.log('A ERR',col,e.message.slice(0,70)); }
}
fs.writeFileSync('.qa-dot61/01-db-A.json', JSON.stringify(out,null,2));
await sql.end();
