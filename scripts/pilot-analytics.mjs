// doc 56 Đ5 — LIVE proof that the analytics layer (SPC + fleet rollup + daily mart)
// reads the REAL pilot process_results (SCRW-SIM-01 id243, the 12 torque cycles from
// the Đ3 pilot) against the live DB — the raw mart-refresh SQL, the I-MR control chart,
// and the machineType rollup, all on real rows.
//
//   DATABASE_URL="postgresql://aoi:aoi@127.0.0.1:5434/aoi_management" npx tsx scripts/pilot-analytics.mjs
process.env.PROCESS_ANALYTICS_ENABLED = "true";

import { getDb } from "../server/db/connection.ts";
import {
  refreshProcessResultDaily,
  readProcessResultDaily,
  getProcessMetricPoints,
  aggregateProcessResultStatsByType,
} from "../server/db/processResult.ts";
import { buildProcessControlChart } from "../server/services/processSpc.ts";

const MACHINE_ID = 243;
const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
const line = () => console.log("─".repeat(78));

const db = await getDb();
if (!db) throw new Error("DB not connected — set owner DATABASE_URL.");

// 1) MART refresh (raw INSERT…SELECT…ON CONFLICT on the live DB).
const written = await refreshProcessResultDaily(365);
console.log(`MART refreshProcessResultDaily(365) → ${written} rollup row(s) upserted.`);
const daily = await readProcessResultDaily({ machineId: MACHINE_ID, sinceDays: 365 });
for (const r of daily) console.log(`  ${r.day}  m${r.machineId} ${r.machineType} ${r.stepType}  total=${r.total} pass=${r.pass} fail=${r.fail} FPY=${r.firstPassYield != null ? (r.firstPassYield * 100).toFixed(1) + "%" : "—"}`);
line();

// 2) SPC I-MR on the real torque individuals.
const points = await getProcessMetricPoints({ machineId: MACHINE_ID, metricKey: "torque", since, limit: 5000 });
console.log(`SPC getProcessMetricPoints(m${MACHINE_ID}, "torque") → ${points.length} individual measurement(s).`);
const chart = buildProcessControlChart("torque", points, { usl: 13.5, lsl: 10.5 });
if (chart.ok) {
  console.log(`  I-MR: UCL=${chart.limits.UCL.toFixed(3)} CL=${chart.limits.CL.toFixed(3)} LCL=${chart.limits.LCL.toFixed(3)} σ̂=${chart.estimatedSigma.toFixed(4)}`);
  console.log(`  out-of-control: ${chart.outOfControlCount}/${chart.n}  ·  Cpk=${chart.capability?.cpk != null ? chart.capability.cpk.toFixed(2) : "—"} (USL 13.5 / LSL 10.5)`);
} else {
  console.log(`  (need ≥2 numeric torque samples for a control chart)`);
}
line();

// 3) Fleet rollup by machineType.
const fleet = await aggregateProcessResultStatsByType({ since });
console.log(`FLEET aggregateProcessResultStatsByType → ${fleet.length} machineType group(s):`);
for (const r of fleet) console.log(`  ${r.machineType ?? "—"}  total=${r.total} pass=${r.pass} fail=${r.fail} warn=${r.warn} skip=${r.skip}`);
line();

const pass = written >= 1 && daily.length >= 1 && chart.ok && chart.n >= 2 && fleet.length >= 1;
console.log(pass
  ? "✅ ANALYTICS LAYER PROVEN on real pilot data: mart populated, SPC I-MR computed, fleet rollup grouped."
  : "❌ FAILED — see values above (pilot may have no torque rows; re-run the Đ3 pilot emitter first).");
process.exit(pass ? 0 : 1);
