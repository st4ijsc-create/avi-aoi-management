import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
const q = async (s,v)=>Number((await v)[0].n);
console.log(JSON.stringify({
  andon_events: await q(0, sql`select count(*)::int n from andon_events`),
  andon_notes: await q(0, sql`select count(*)::int n from andon_notes`),
  twin_dat_cho: await q(0, sql`select count(*)::int n from twin_dat_cho`),
  twin_toa_nha: await q(0, sql`select count(*)::int n from twin_toa_nha`),
  twin_tang: await q(0, sql`select count(*)::int n from twin_tang`),
  users_qatd: await q(0, sql`select count(*)::int n from users where username like 'qatd\_%'`),
  andon_tmp: await q(0, sql`select count(*)::int n from andon_events where title like 'QATD-TMP%' or message like 'QATD-TMP%'`),
  note_tmp: await q(0, sql`select count(*)::int n from andon_notes where note like 'QATD-TMP%'`),
  toa_tmp: await q(0, sql`select count(*)::int n from twin_toa_nha where ma like 'QATD-TMP%'`),
  canCreate_congnhan: (await sql`select "canCreate" from permissions p join users u on u.id=p."userId" where u.username='qatd_congnhan' and p."moduleName"='andon'`)[0].canCreate,
}));
await sql.end();
