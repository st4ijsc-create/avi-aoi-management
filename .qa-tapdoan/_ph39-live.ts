// PH-39 — CHẠY THẬT trên CSDL phát triển (CHỈ ĐỌC).
import "dotenv/config";
import { computeFailureRisk, computeReliabilityStats } from "../server/services/predictiveMaintenanceService";
import { machineDetail } from "../server/services/ecosystem/assetCockpitService";
import { getDb } from "../server/db/connection";
import { machines } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const db = await getDb();
if (!db) { console.log(JSON.stringify({ loi: "khong co db" })); process.exit(1); }
const rows = await db.select({ id: machines.id, code: machines.code })
  .from(machines).where(eq(machines.isActive, true)).limit(3);

const ra: unknown[] = [];
for (const m of rows) {
  const r = await computeFailureRisk(m.id);
  const d = await machineDetail(m.id);
  ra.push({
    id: m.id, ma: m.code,
    dichVu: { riskMethod: r.riskMethod, failureRisk: r.failureRisk, urgency: r.maintenanceUrgency, soDacTrung: r.factors.length },
    doTinCay: await computeReliabilityStats(m.id).then((x) => ({ unplannedEvents: x.unplannedEvents, uptimeMinutes: x.uptimeMinutes })),
    cockpit: d ? { available: d.health.available, failureRisk: d.health.value?.failureRisk ?? null, riskMethod: d.health.value?.riskMethod ?? null } : null,
  });
}
console.log(JSON.stringify(ra, null, 1));
process.exit(0);
