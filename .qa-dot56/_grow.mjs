import { readFileSync } from "node:fs"; import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url,{max:1});
for (const t of ["machine_status_logs","machine_health_history"]) {
  const r = (await sql.unsafe(`select count(*)::int n, min("timestamp")::text a, max("timestamp")::text b from ${t}`))[0];
  const ngay = (new Date(r.b) - new Date(r.a)) / 86400000;
  console.log(`${t}: ${r.n} hang · ${r.a} -> ${r.b} (${ngay.toFixed(1)} ngay) · ~${(r.n/Math.max(ngay,1)).toFixed(0)} hang/ngay · toi 50000 hang con ~${((50000-r.n)/Math.max(r.n/Math.max(ngay,1),1)).toFixed(0)} ngay`);
}
console.log("machine_positions:", JSON.stringify((await sql.unsafe(`select count(*)::int n from machine_positions`))[0]));
await sql.end();
