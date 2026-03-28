import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../server/db/connection';
import { getMachines, getStations, getProductionLines, getWorkshops, getFactories } from '../server/db';

async function debug() {
  const db = await getDb();
  if (!db) { console.log('No DB'); return; }

  const factories = await getFactories();
  const workshops = await getWorkshops();
  const lines = await getProductionLines();
  const stations = await getStations();
  const machines = await getMachines();

  console.log('Factories:', factories.length);
  console.log('Workshops:', workshops.length, '- sample:', workshops.slice(0, 2).map(w => ({ id: w.id, factoryId: w.factoryId })));
  console.log('Lines:', lines.length, '- sample:', lines.slice(0, 2).map(l => ({ id: l.id, workshopId: l.workshopId })));
  console.log('Stations:', stations.length, '- sample:', stations.slice(0, 2).map(s => ({ id: s.id, lineId: s.lineId })));
  console.log('Machines:', machines.length, '- sample:', machines.slice(0, 2).map(m => ({ id: m.id, stationId: m.stationId })));

  // Replicate the lookup chain
  const stationToLine = new Map<number, number>();
  const lineToWorkshop = new Map<number, number>();
  const workshopToFactory = new Map<number, number>();
  for (const line of lines) lineToWorkshop.set(Number(line.id), Number(line.workshopId));
  for (const ws of workshops) workshopToFactory.set(Number(ws.id), Number(ws.factoryId));
  for (const st of stations) stationToLine.set(Number(st.id), Number(st.lineId));

  const machineDetails = new Map<number, { factoryId: number; workshopId: number }>();
  for (const m of machines) {
    const lineId = stationToLine.get(Number(m.stationId));
    const wsId = lineId ? lineToWorkshop.get(lineId) : undefined;
    const facId = wsId ? workshopToFactory.get(wsId) : undefined;
    if (facId && wsId) machineDetails.set(Number(m.id), { factoryId: facId, workshopId: wsId });
  }

  console.log('\nmachineDetails size:', machineDetails.size);
  console.log('First 5 machine IDs:', machines.slice(0, 5).map(m => Number(m.id)));
  for (const m of machines.slice(0, 5)) {
    const d = machineDetails.get(Number(m.id));
    console.log(`  Machine ${m.id}: stationId=${m.stationId} → details:`, d);
  }

  // Check daily_statistics schema
  const cols = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'daily_statistics' ORDER BY ordinal_position`);
  console.log('\ndaily_statistics columns:', (cols as any[]).map((c: any) => `${c.column_name}(${c.data_type})`).join(', '));

  // Check constraints
  const constraints = await db.execute(sql`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'daily_statistics'::regclass`);
  console.log('daily_statistics constraints:', constraints);

  process.exit(0);
}
debug();
