/**
 * Seed Shift Configurations for AVI/AOI Factory Management System
 * 
 * Creates shift configurations for factories:
 * - Ca 1 (Morning): 6:00 - 14:00
 * - Ca 2 (Afternoon): 14:00 - 22:00
 * - Ca 3 (Night): 22:00 - 6:00
 * 
 * Usage: npx tsx scripts/seed-shift-configs.ts
 */

import { sql } from 'drizzle-orm';
import { getDb } from '../server/db';

async function seedShiftConfigs() {
  console.log('\n🚀 Starting Shift Config Seed...\n');
  
  const db = await getDb();
  if (!db) {
    console.log('❌ Database not available');
    return;
  }
  
  try {
    // Check if shifts already exist
    const existing = await db.execute(sql`SELECT COUNT(*) as count FROM shift_configs`);
    const count = Number(existing.rows[0].count);
    
    if (count > 0) {
      console.log(`  ⚠️ Found ${count} existing shift configs, skipping seed...`);
      return;
    }
    
    // Define shift configurations
    const shifts = [
      {
        name: 'Ca sáng',
        code: 'SHIFT1',
        startHour: 6,
        startMinute: 0,
        endHour: 14,
        endMinute: 0,
        orderIndex: 1
      },
      {
        name: 'Ca chiều',
        code: 'SHIFT2',
        startHour: 14,
        startMinute: 0,
        endHour: 22,
        endMinute: 0,
        orderIndex: 2
      },
      {
        name: 'Ca đêm',
        code: 'SHIFT3',
        startHour: 22,
        startMinute: 0,
        endHour: 6,
        endMinute: 0,
        orderIndex: 3
      }
    ];
    
    // Insert shifts (global - factoryId is null)
    console.log('📊 Creating Shift Configurations...\n');
    
    for (const shift of shifts) {
      try {
        await db.execute(sql`
          INSERT INTO shift_configs (name, code, "startHour", "startMinute", "endHour", "endMinute", "orderIndex", "isActive")
          VALUES (${shift.name}, ${shift.code}, ${shift.startHour}, ${shift.startMinute}, ${shift.endHour}, ${shift.endMinute}, ${shift.orderIndex}, true)
        `);
        console.log(`  ✅ ${shift.name} (${shift.code}): ${shift.startHour}:${String(shift.startMinute).padStart(2, '0')} - ${shift.endHour}:${String(shift.endMinute).padStart(2, '0')}`);
      } catch (e: any) {
        console.log(`  ❌ Error creating ${shift.name}: ${e.message}`);
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SHIFT CONFIG SEED SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Shift Configurations: ${shifts.length}`);
    console.log(`  Ca 1 (Sáng):   6:00 - 14:00`);
    console.log(`  Ca 2 (Chiều): 14:00 - 22:00`);
    console.log(`  Ca 3 (Đêm):   22:00 -  6:00`);
    console.log('='.repeat(60));
    console.log('\n✅ Shift config seeding completed successfully!\n');
    
  } catch (error: any) {
    console.error('\n❌ Error seeding shift configs:', error.message);
    throw error;
  }
}

// Run the seed
seedShiftConfigs()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
