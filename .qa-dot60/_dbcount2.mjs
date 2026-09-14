import postgres from 'postgres'; import fs from 'fs';
const url=fs.readFileSync('.env','utf8').split(/\r?\n/).find(l=>/^DATABASE_URL=/.test(l)).slice(13).trim();
const sql=postgres(url,{max:1,idle_timeout:5});
for(const t of ['safety_zones','zones','zone_reservations','machines','factories']){
  try{const r=await sql.unsafe(`select count(*)::int c from ${t}`);console.log(t.padEnd(20),r[0].c);}catch(e){console.log(t.padEnd(20),'ERR',e.message.slice(0,60));}
}
// twin canh tables
try{const r=await sql`select table_name from information_schema.tables where table_schema='public' and table_name like 'twin%' order by 1`;
console.log('\ntwin* tables:');for(const x of r){const c=await sql.unsafe(`select count(*)::int c from ${x.table_name}`);console.log('  ',x.table_name.padEnd(28),c[0].c);}}catch(e){console.log(e.message);}
// machine layout cols
try{const r=await sql`select column_name from information_schema.columns where table_name='machines' and (column_name ilike '%layout%' or column_name ilike '%pos%' or column_name ilike '%coord%') order by 1`;
console.log('\nmachines layout cols:',r.map(x=>x.column_name).join(', ')||'(khong co)');}catch(e){console.log(e.message);}
await sql.end();
