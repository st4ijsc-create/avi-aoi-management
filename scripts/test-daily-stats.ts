import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../server/db/connection';
import { getMachines, getStations, getProductionLines, getWorkshops } from '../server/db';

function randomInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min: number, max: number) { return Math.random() * (max - min) + min; }

async function testDailyStats() {
  const db = await getDb();
  if (!db) { console.log('No DB'); return; }

  const allWorkshops = await getWorkshops();
  const allLines = await getProductionLines();
  const allStations = await getStations();
  const allMachines = await getMachines();

  const stationToLine = new Map<number, number>();
  const lineToWorkshop = new Map<number, number>();
  const workshopToFactory = new Map<number, number>();
  for (const line of allLines) lineToWorkshop.set(Number(line.id), Number(line.workshopId));
  for (const ws of allWorkshops) workshopToFactory.set(Number(ws.id), Number(ws.factoryId));
  for (const st of allStations) stationToLine.set(Number(st.id), Number(st.lineId));

  const machineDetails = new Map<number, { factoryId: number; workshopId: number }>();
  for (const m of allMachines) {
    const lineId = stationToLine.get(Number(m.stationId));
    const wsId = lineId ? lineToWorkshop.get(lineId) : undefined;
    const facId = wsId ? workshopToFactory.get(wsId) : undefined;
    if (facId && wsId) machineDetails.set(Number(m.id), { factoryId: facId, workshopId: wsId });
  }

  console.log(`machineDetails size: ${machineDetails.size}`);
  const machines = allMachines.slice(0, 10);
  console.log(`Testing ${machines.length} machines, 30 days each...`);

  let inserted = 0;
  const now = new Date();
  for (const m of machines) {
    const details = machineDetails.get(Number(m.id));
    if (!details) { console.log(`  No details for machine ${m.id}`); continue; }

    for (let d = 29; d >= 0; d--) {
      const date = new Date(now.getTime() - d * 86400000);
      date.setHours(0, 0, 0, 0);
      const total = randomInt(150, 400);
      const ok = Math.floor(total * randomFloat(0.90, 0.97));
      const ng = Math.floor(total * randomFloat(0.02, 0.06));
      const ntf = Math.max(0, total - ok - ng);
      const yieldRate = ((ok / total) * 100).toFixed(2);

      try {
        await db.execute(sql`INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", "date", "totalCount", "okCount", "ngCount", "ntfCount", "yieldRate", "avgCycleTime") VALUES (${Number(m.id)}, ${details.factoryId}, ${details.workshopId}, ${date.toISOString()}, ${total}, ${ok}, ${ng}, ${ntf}, ${yieldRate}, ${randomFloat(2.0, 6.0).toFixed(2)}) ON CONFLICT DO NOTHING`);
        inserted++;
      } catch (e: any) {
        console.log(`  ERROR machine ${m.id} day ${d}: ${e.message}`);
      }
    }
  }

  console.log(`Inserted ${inserted} daily_statistics records`);

  const count = await db.execute(sql`SELECT COUNT(*) as count FROM daily_statistics`);
  console.log(`Total daily_statistics now: ${(count as any)[0]?.count}`);

  process.exit(0);
}
testDailyStats();
