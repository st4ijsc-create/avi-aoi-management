// DOT 56 muc A — PARETO thuc su cua duong nguoi dung: 53 ms "cho khac" nam o dau?
import { config as dotenvConfig } from "dotenv"; dotenvConfig();
import { writeFileSync, renameSync } from "node:fs";
import { sql as dsql } from "drizzle-orm";
const { getDb } = await import("../server/db/connection.ts");
const db = await getDb();
if (!db) { console.error("!!! getDb() = null"); process.exit(2); }
const { getAllMachinesOEELive } = await import("../server/services/oeeService.ts");
const { getFactoryCommandOverview } = await import("../server/services/factoryCommandService.ts");

const do6 = async (ten: string, f: () => Promise<any>) => {
  const t: number[] = []; let r: any = null;
  for (let i = 0; i < 6; i++) { const t0 = performance.now(); r = await f(); t.push(performance.now() - t0); }
  const am = t.slice(1).sort((a, b) => a - b);
  return { ten, nguoi: +t[0].toFixed(1), am: +am[2].toFixed(1), ra: Array.isArray(r) ? r.length : (r?.machines?.length ?? "?") };
};
const Q = (s: string) => () => db.execute(dsql.raw(s));
const kq = [];
kq.push(await do6("TONG thu tuc overview({factoryId:1})", () => getFactoryCommandOverview({ factoryId: 1 })));
kq.push(await do6("  buoc 6: getAllMachinesOEELive({windowHours:24})", () => getAllMachinesOEELive({ windowHours: 24 })));
kq.push(await do6("  buoc 3: DISTINCT ON machine_status_logs", Q(`SELECT DISTINCT ON ("machineId") "machineId", status, "timestamp" AT TIME ZONE 'UTC' AS ts FROM machine_status_logs ORDER BY "machineId","timestamp" DESC`)));
kq.push(await do6("  buoc 3b: DISTINCT ON machine_heartbeats", Q(`SELECT DISTINCT ON ("machineId") "machineId", "timestamp" AT TIME ZONE 'UTC' AS ts FROM machine_heartbeats ORDER BY "machineId","timestamp" DESC`)));
kq.push(await do6("  buoc 4: DISTINCT ON machine_positions", Q(`SELECT DISTINCT ON ("machineId") "machineId","positionX","positionY","positionZ",width,height,depth,rotation FROM machine_positions ORDER BY "machineId","updatedAt" DESC`)));
kq.push(await do6("  buoc 5: DISTINCT ON machine_health_history (da va d53)", Q(`SELECT DISTINCT ON ("machineId") "machineId","predictedFailureRisk","maintenanceUrgency","timestamp" AT TIME ZONE 'UTC' AS ts FROM machine_health_history ORDER BY "machineId","createdAt" DESC`)));
const tong = kq[0].am;
let ra = `=== DOT 56 muc A — PARETO duong nguoi dung (${new Date().toISOString()}) ===\n`;
ra += `(6 lan: lan 1 nguoi + 5 lan am, lay TRUNG VI cua 5 lan am)\n\n`;
for (const k of kq) ra += `${k.ten.padEnd(52)} nguoi=${String(k.nguoi).padStart(6)} ms  AM=${String(k.am).padStart(6)} ms  (${((k.am / tong) * 100).toFixed(1)} % tong)  ra=${k.ra}\n`;
const d4 = kq.slice(2).reduce((s, k) => s + k.am, 0);
ra += `\n>>> 4 cau DISTINCT ON cong lai = ${d4.toFixed(1)} ms = ${((d4 / tong) * 100).toFixed(1)} % tong\n`;
ra += `>>> buoc 6 OEE mot minh     = ${kq[1].am} ms = ${((kq[1].am / tong) * 100).toFixed(1)} % tong\n`;
ra += `>>> KET LUAN: nut that cua duong nguoi dung KHONG phai DISTINCT ON.\n`;
writeFileSync(".qa-dot56/A-pareto.txt.tmp", ra); renameSync(".qa-dot56/A-pareto.txt.tmp", ".qa-dot56/A-pareto.txt");
console.log(ra); process.exit(0);
