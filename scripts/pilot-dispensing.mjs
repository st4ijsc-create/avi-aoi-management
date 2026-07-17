// doc 56 Đ7 — LIVE proof that the standardisation GENERALISES to a 2nd automation
// family: a GLUE DISPENSER (DISPENSING / glue_dispense) flows through the SAME
// pipeline the screwdriver proved (Đ3) — real submitProcessResult (auth mk_ +
// stepType validate + spec-gate vs mig-0295 limits + idempotency), then the SAME
// analytics (SPC) + AI (device_health) read it. Zero new endpoints; pure reuse.
//
//   DATABASE_URL="postgresql://aoi:aoi@127.0.0.1:5434/aoi_management" npx tsx scripts/pilot-dispensing.mjs
process.env.PROCESS_RESULT_INGEST_ENABLED = "true";
process.env.PROCESS_SPEC_GATE_ENABLED = "true";
process.env.PROCESS_ANALYTICS_ENABLED = "true";

import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../server/db/connection.ts";
import { machines, apiKeys, processResults } from "../drizzle/schema/index.ts";
import { and, eq } from "drizzle-orm";
import { appRouter } from "../server/routers.ts";
import { aggregateProcessResultStats, getProcessMetricPoints } from "../server/db/processResult.ts";
import { buildProcessControlChart } from "../server/services/processSpc.ts";
import { getDeviceHealth } from "../server/services/aiLocalTools/handlersF7.ts";

const CODE = "GLUE-SIM-01";
const STEP = "glue_dispense";
const VOL_LSL = 0.15, VOL_USL = 0.35, VOL_NOM = 0.25;
const PRES_LSL = 180, PRES_USL = 320, PRES_NOM = 250;
const N = 10;
const hashKey = (k) => createHash("sha256").update(String(k), "utf8").digest("hex");
const line = () => console.log("─".repeat(78));

const db = await getDb();
if (!db) throw new Error("DB not connected — set owner DATABASE_URL.");

// ── provision the dispenser pilot + a fresh mk_ key ────────────────────────────
const [station] = await db.select({ id: machines.stationId }).from(machines).where(eq(machines.code, "SCRW-SIM-01")).limit(1);
let [m] = await db.select({ id: machines.id }).from(machines).where(eq(machines.code, CODE)).limit(1);
if (!m) {
  const stationId = station?.id ?? (await db.execute(`SELECT id FROM stations WHERE "isActive"=true ORDER BY id LIMIT 1`)).at?.(0)?.id;
  [m] = await db.insert(machines).values({ code: CODE, name: "Máy điểm keo pilot 01", machineType: "DISPENSING", stationId, registrationStatus: "approved", isActive: true, lifecycleStatus: "active" }).returning({ id: machines.id });
  console.log(`[pilot] created ${CODE} (id=${m.id}, DISPENSING)`);
} else {
  await db.update(machines).set({ registrationStatus: "approved", isActive: true, lifecycleStatus: "active", machineType: "DISPENSING" }).where(eq(machines.id, m.id));
  console.log(`[pilot] reuse ${CODE} (id=${m.id})`);
}
const key = `mk_pilot_${randomBytes(24).toString("base64url")}`;
await db.insert(apiKeys).values({ name: `machine:${CODE}:dispense`, description: "doc56 Đ7 dispensing pilot", keyHash: hashKey(key), keyPrefix: key.slice(0, 9), scopes: ["ingest:write", "equipment:read"], isActive: true, machineId: m.id });
line();

// ── emit N glue dots via the REAL submitProcessResult (2 starved = out-of-spec) ─
const caller = appRouter.createCaller({});
let posted = 0, accepted = 0, pass = 0, fail = 0;
for (let i = 1; i <= N; i++) {
  const starved = i === 4 || i === 8; // under-fill → below LSL
  const volume = +(starved ? VOL_LSL - 0.04 - Math.random() * 0.02 : VOL_NOM + (Math.random() - 0.5) * 0.06).toFixed(4);
  const pressure = +(PRES_NOM + (Math.random() - 0.5) * 40).toFixed(1);
  const result = volume < VOL_LSL || volume > VOL_USL ? "fail" : "pass";
  const serial = `GLUE${String(i).padStart(6, "0")}`;
  posted++;
  try {
    const r = await caller.machineApi.submitProcessResult({
      schemaVersion: "1.0",
      apiKey: key,
      serialNumber: serial,
      stepType: STEP,
      result,
      ts: new Date().toISOString(),
      recipe: { code: "GLUE-RC-001", version: "1" },
      metrics: [
        { name: "volume", value: volume, unit: "ml", lsl: VOL_LSL, usl: VOL_USL, nominal: VOL_NOM },
        { name: "pressure", value: pressure, unit: "kPa", lsl: PRES_LSL, usl: PRES_USL, nominal: PRES_NOM },
      ],
      idempotencyKey: `${CODE}-${serial}`,
    });
    if (r?.processResultId != null || r?.success) { accepted++; result === "pass" ? pass++ : fail++; }
  } catch (e) {
    console.log(`  #${i} ${serial} ${result} vol=${volume} → ERROR ${e?.message ?? e}`);
  }
}
console.log(`EMIT ${STEP}: posted=${posted} accepted=${accepted} pass=${pass} fail=${fail} (2 starved dots forced under-fill)`);
line();

// ── verify DB + analytics + AI, all on the dispenser's real rows ───────────────
const rows = await db.select({ id: processResults.id }).from(processResults).where(and(eq(processResults.machineId, m.id), eq(processResults.stepType, STEP)));
const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
const stats = await aggregateProcessResultStats({ machineId: m.id, since });
console.log(`DB process_results(${CODE}, ${STEP}) = ${rows.length} rows · analytics stats pass=${stats.pass} fail=${stats.fail}`);

const points = await getProcessMetricPoints({ machineId: m.id, metricKey: "volume", since, limit: 500 });
const chart = buildProcessControlChart("volume", points, { usl: VOL_USL, lsl: VOL_LSL });
if (chart.ok) console.log(`SPC volume: CL=${chart.limits.CL.toFixed(4)} [${chart.limits.LCL.toFixed(4)}–${chart.limits.UCL.toFixed(4)}] OOC=${chart.outOfControlCount}/${chart.n} Cpk=${chart.capability?.cpk != null ? chart.capability.cpk.toFixed(2) : "—"}`);

const health = await getDeviceHealth.handler({ machineCode: CODE, days: 1 });
console.log("AI get_device_health:");
console.log("  " + health.textSummary.split("\n").join("\n  "));
line();

const ok = accepted === N && rows.length >= N && stats.fail >= 2 && chart.ok && health.data.machineType === "DISPENSING";
console.log(ok
  ? "✅ DISPENSING GENERALISATION PROVEN: điểm keo chảy qua CÙNG pipeline (ingest+spec-gate+SPC+AI) như máy vít — chuẩn hoá tổng quát."
  : "❌ FAILED — see values above.");
process.exit(ok ? 0 : 1);
