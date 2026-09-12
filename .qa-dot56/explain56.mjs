// DOT 56 muc A — EXPLAIN (ANALYZE, BUFFERS) AM cho 4 cau DISTINCT ON THAT trong factoryCommandService.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import postgres from "postgres";
const OUT = ".qa-dot56";
mkdirSync(OUT, { recursive: true });
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url, { max: 1 });
const TAG = process.argv[2] ?? "truoc";

// 4 cau NGUYEN VAN tai HEAD f4e74493 (doc tu file, khong go tay)
const CAU = {
  "Q1 dong252 machine_status_logs (ORDER BY timestamp DESC)": {
    bang: "machine_status_logs",
    q: `SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, status, "timestamp" AT TIME ZONE 'UTC' AS ts
      FROM machine_status_logs
      ORDER BY "machineId", "timestamp" DESC`,
  },
  "Q2 dong264 machine_heartbeats (ORDER BY timestamp DESC)": {
    bang: "machine_heartbeats",
    q: `SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "timestamp" AT TIME ZONE 'UTC' AS ts
      FROM machine_heartbeats
      ORDER BY "machineId", "timestamp" DESC`,
  },
  "Q3 dong277 machine_positions (ORDER BY updatedAt DESC)": {
    bang: "machine_positions",
    q: `SELECT DISTINCT ON ("machineId") "machineId" AS machine_id,
        "positionX" AS x, "positionY" AS y, "positionZ" AS z,
        width, height, depth, rotation
      FROM machine_positions
      ORDER BY "machineId", "updatedAt" DESC`,
  },
  "Q4 dong317 machine_health_history (ORDER BY createdAt DESC — DA VA dot53)": {
    bang: "machine_health_history",
    q: `SELECT DISTINCT ON ("machineId") "machineId" AS machine_id,
        "predictedFailureRisk" AS risk, "maintenanceUrgency" AS urgency, "timestamp" AT TIME ZONE 'UTC' AS ts
      FROM machine_health_history
      ORDER BY "machineId", "createdAt" DESC`,
  },
};

let ra = `=== DOT 56 muc A — EXPLAIN AM 4 cau DISTINCT ON (${TAG}) — ${new Date().toISOString()} ===\n`;
ra += `TIEU CHI BENH THAT (G137): quet > 50 000 hang  HOAC  external merge  HOAC  AM > 20 ms\n`;
const tomtat = [];
for (const [ten, { bang, q }] of Object.entries(CAU)) {
  ra += `\n════════ ${ten} ════════\n`;
  const nhang = Number((await sql.unsafe(`SELECT count(*)::bigint n FROM ${bang}`))[0].n);
  ra += `so hang bang ${bang}: ${nhang}\n--- index co san ---\n`;
  for (const r of await sql.unsafe(`select indexname, indexdef from pg_indexes where tablename='${bang}' order by indexname`)) ra += `  ${r.indexname}  ${r.indexdef}\n`;
  const ams = [];
  let planCuoi = "";
  for (let i = 0; i < 6; i++) {
    const p = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${q}`);
    const txt = p.map((x) => x["QUERY PLAN"]).join("\n");
    const et = Number((txt.match(/Execution Time: ([\d.]+) ms/) || [])[1]);
    if (i === 0) ra += `\n[lan 1 NGUOI] Execution ${et} ms\n${txt}\n`;
    else { ams.push(et); planCuoi = txt; }
  }
  ra += `\n[5 lan AM] ${ams.map((x) => x.toFixed(3)).join(" · ")} ms  ⇒ trung vi ${ams.slice().sort((a,b)=>a-b)[2].toFixed(3)} ms\n`;
  ra += `[plan AM lan cuoi]\n${planCuoi}\n`;
  const amTV = ams.slice().sort((a,b)=>a-b)[2];
  const quet = Math.max(0, ...[...planCuoi.matchAll(/rows=(\d+) width/g)].map((m) => Number(m[1])));
  const ext = /Sort Method: external/.test(planCuoi);
  const soHangRa = Number((planCuoi.match(/^ [^\n]*actual time=[^\n]*rows=(\d+)/m)||[])[1] ?? 0);
  const benh = nhang > 50000 || ext || amTV > 20;
  ra += `\n>>> CHAN DOAN: bang ${nhang} hang · am(trung vi) ${amTV.toFixed(3)} ms · external merge: ${ext} · uoc quet toi da ${quet} hang ⇒ BENH THAT = ${benh ? "CO" : "KHONG"}\n`;
  tomtat.push({ ten, bang, nhang, amTV: +amTV.toFixed(3), ext, quet, benh, seq: /Seq Scan/.test(planCuoi), sortMethod: (planCuoi.match(/Sort Method: [^\n]*/)||[])[0] ?? "(khong sort)" });
}
ra += `\n\n=== TOM TAT ===\n` + tomtat.map((t) => `${t.ten}\n   hang=${t.nhang} am=${t.amTV}ms seq=${t.seq} ${t.sortMethod} quet<=${t.quet} ⇒ BENH=${t.benh ? "CO" : "KHONG"}`).join("\n") + "\n";
const p = `${OUT}/A-explain-${TAG}.txt`;
writeFileSync(p + ".tmp", ra); renameSync(p + ".tmp", p);
console.log(ra.slice(ra.indexOf("=== TOM TAT ===")));
await sql.end();
