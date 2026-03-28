import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../server/db/connection';

async function verify() {
  const db = await getDb();
  if (!db) { console.log('No DB'); return; }
  const tables = [
    'users', 'permissions', 'user_roles', 'factories', 'workshops',
    'production_lines', 'stations', 'machines', 'workstations',
    'product_categories', 'product_models', 'measurement_point_defs',
    'product_machine_mappings', 'shift_configs', 'processes',
    'line_process_assignments', 'production_orders',
    'line_product_assignments', 'line_stages',
    'product_inspections', 'measurement_results', 'daily_statistics',
    'alert_settings', 'yield_alert_thresholds',
    'spc_configurations', 'quality_gates', 'system_settings'
  ];
  console.log('='.repeat(50));
  console.log('  DATA VERIFICATION REPORT');
  console.log('='.repeat(50));
  for (const t of tables) {
    try {
      const r = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM "${t}"`));
      console.log(`  ${t.padEnd(30)}: ${(r as any)[0]?.count ?? '?'}`);
    } catch (e: any) {
      console.log(`  ${t.padEnd(30)}: ERROR - ${e.message?.slice(0, 60)}`);
    }
  }
  console.log('='.repeat(50));
  process.exit(0);
}
verify();
