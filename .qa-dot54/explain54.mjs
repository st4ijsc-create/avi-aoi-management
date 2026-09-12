import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url, { max: 1 });
const OUT = process.argv[2] ?? ".qa-dot54/explain-truoc.txt";
mkdirSync(".qa-dot54", { recursive: true });
const CAU = {
  "C-cu (DISTINCT ON, khong WHERE, ORDER BY timestamp)": `
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id,
        "predictedFailureRisk" AS risk, "maintenanceUrgency" AS urgency, "timestamp" AT TIME ZONE 'UTC' AS ts
      FROM machine_health_history
      ORDER BY "machineId", "timestamp" DESC`,
  "C-moi (DISTINCT ON, ORDER BY createdAt DESC = cot co index QD-27)": `
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id,
        "predictedFailureRisk" AS risk, "maintenanceUrgency" AS urgency, "timestamp" AT TIME ZONE 'UTC' AS ts
      FROM machine_health_history
      ORDER BY "machineId", "createdAt" DESC`,
};
let ra = `=== EXPLAIN machine_health_history — ${new Date().toISOString()} ===\n`;
ra += "\n--- index co san ---\n";
for (const r of await sql.unsafe(`select indexname, indexdef from pg_indexes where tablename='machine_health_history' order by indexname`)) ra += `${r.indexname}  ${r.indexdef}\n`;
ra += `\n--- so hang: ${(await sql.unsafe(`select count(*)::int c from machine_health_history`))[0].c} ---\n`;
for (const [ten, q] of Object.entries(CAU)) {
  ra += `\n════ ${ten} ════\n`;
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const p = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${q}`);
    const ms = Date.now() - t0;
    const txt = p.map((x) => x["QUERY PLAN"]).join("\n");
    if (i === 0) ra += `[lan 1 NGUOI ${ms} ms]\n${txt}\n`;
    else ra += `[lan ${i + 1} AM ${ms} ms] ${txt.split("\n").filter((l) => /Execution Time|Planning Time/.test(l)).join(" · ")}\n`;
  }
}
// doi chung DAU RA BANG BYTE: hai cau phai tra CUNG tap hang
const A = await sql.unsafe(CAU["C-cu (DISTINCT ON, khong WHERE, ORDER BY timestamp)"]);
const B = await sql.unsafe(CAU["C-moi (DISTINCT ON, ORDER BY createdAt DESC = cot co index QD-27)"]);
const chuan = (rows) => JSON.stringify([...rows].sort((a, b) => a.machine_id - b.machine_id));
ra += `\n--- DOI CHUNG DAU RA ---\ncu ${A.length} hang · moi ${B.length} hang · GIONG HET: ${chuan(A) === chuan(B)}\n`;
if (chuan(A) !== chuan(B)) {
  const ma = new Map(A.map((r) => [r.machine_id, JSON.stringify(r)]));
  for (const r of B) if (ma.get(r.machine_id) !== JSON.stringify(r)) ra += `LECH may ${r.machine_id}:\n  cu  ${ma.get(r.machine_id)}\n  moi ${JSON.stringify(r)}\n`;
}
writeFileSync(OUT, ra);
console.log(ra.split("\n").filter((l) => /Execution Time|Seq Scan|Index|Sort Method|DOI CHUNG|GIONG HET|LECH|so hang|idx_/.test(l)).join("\n"));
await sql.end();
