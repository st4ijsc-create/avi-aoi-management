// ĐỢT 54 — EXPLAIN ẤM cho 2 câu DISTINCT ON của oeeService (dòng 837, 855) — G137: log chậm ≠ bệnh.
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url, { max: 1 });
const CAU = {
  "oeeService:837 oee_metrics idealCycleTime": `
    SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "idealCycleTime" AS ideal
    FROM oee_metrics WHERE "idealCycleTime" IS NOT NULL ORDER BY "machineId", "timestamp" DESC`,
  "oeeService:855 product_machine_mappings idealCycleTimeSec": `
    SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "idealCycleTimeSec" AS ideal
    FROM product_machine_mappings WHERE "isActive" = true AND "idealCycleTimeSec" IS NOT NULL AND "idealCycleTimeSec" > 0
    ORDER BY "machineId", "priority" DESC, "idealCycleTimeSec" ASC`,
};
let ra = `=== EXPLAIN oeeService — ${new Date().toISOString()} ===\n`;
for (const t of ["oee_metrics","product_machine_mappings"]) {
  ra += `\n--- ${t}: ${(await sql.unsafe(`select count(*)::int c from ${t}`))[0].c} hang ---\n`;
  for (const r of await sql.unsafe(`select indexname from pg_indexes where tablename='${t}' order by 1`)) ra += `  ${r.indexname}\n`;
}
for (const [ten, q] of Object.entries(CAU)) {
  ra += `\n════ ${ten} ════\n`;
  for (let i = 0; i < 5; i++) {
    const p = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${q}`);
    const txt = p.map((x) => x["QUERY PLAN"]).join("\n");
    if (i === 0) ra += `[lan 1 NGUOI]\n${txt}\n`;
    else ra += `[lan ${i+1} AM] ${txt.split("\n").filter((l) => /Execution Time|Planning Time/.test(l)).join(" · ")}\n`;
  }
}
writeFileSync(process.argv[2] ?? ".qa-dot54/explain-oee-A.txt", ra);
console.log(ra.split("\n").filter(l=>/hang ---|════|lan .* AM|Execution Time|Seq Scan|Index Scan|Sort Method/.test(l)).join("\n"));
await sql.end();
