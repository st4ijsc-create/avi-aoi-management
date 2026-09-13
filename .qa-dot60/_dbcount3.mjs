import postgres from 'postgres'; import fs from 'fs';
const url=fs.readFileSync('.env','utf8').split(/\r?\n/).find(l=>/^DATABASE_URL=/.test(l)).slice(13).trim();
const sql=postgres(url,{max:1,idle_timeout:5});
const r=await sql`select count(*)::int tong,
 count("layoutPositionX")::int co_x, count("layoutPositionY")::int co_y, count(layout)::int co_layout
 from machines`;
console.log('machines:',JSON.stringify(r[0]));
await sql.end();
