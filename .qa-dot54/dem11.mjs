import { readFileSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url, { max: 1 });
const q = async (t, w) => (await sql.unsafe(`select count(*)::int c from ${t}${w?` where ${w}`:""}`))[0].c;
const db = (await sql.unsafe(`select current_database() d, now() n, current_setting('TimeZone') tz`))[0];
console.log(JSON.stringify({ db, factories: await q("factories"), twin_dat_cho: await q("twin_dat_cho"), stations: await q("stations"), machines_active: await q("machines","\"isActive\" = true"), users: await q("users"), andon: await q("andon_events"), andon_raised: await q("andon_events","status = 'raised'"), hb: await q("machine_heartbeats"), msl: await q("machine_status_logs"), permissions: await q("permissions"), ufa: await q("user_factory_assignments") }, null, 0));
await sql.end();
