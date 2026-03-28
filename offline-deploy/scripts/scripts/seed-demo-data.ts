/**
 * Seed Demo Data Script for AVI/AOI Factory Management System
 * 
 * This script creates comprehensive demo data using existing db functions.
 * 
 * Usage: npx tsx scripts/seed-demo-data.ts
 */

import {
  createFactory,
  createWorkshop,
  createProductionLine,
  createStation,
  createMachine,
  createProductInspection,
  getFactories,
  getWorkshops,
  getProductionLines,
  getStations,
  getMachines
} from '../server/db';

// Helper functions
function generateApiKey(): string {
  const chars = 'abcdef0123456789';
  let key = 'avi_';
  for (let i = 0; i < 48; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Demo data definitions
const factoriesData = [
  { code: 'FAC-HN', name: 'Nhà máy Hà Nội', address: 'KCN Thăng Long, Đông Anh, Hà Nội', description: 'Nhà máy sản xuất linh kiện điện tử cao cấp' },
  { code: 'FAC-BN2', name: 'Nhà máy Bắc Ninh 2', address: 'KCN VSIP Bắc Ninh', description: 'Nhà máy lắp ráp và kiểm tra PCB' },
  { code: 'FAC-HP', name: 'Nhà máy Hải Phòng', address: 'KCN VSIP, Hải Phòng', description: 'Nhà máy sản xuất module camera' }
];

const workshopTypes = [
  { suffix: 'SMT', name: 'Xưởng SMT', description: 'Xưởng gắn linh kiện bề mặt' },
  { suffix: 'DIP', name: 'Xưởng DIP', description: 'Xưởng hàn linh kiện xuyên lỗ' },
  { suffix: 'TEST', name: 'Xưởng Testing', description: 'Xưởng kiểm tra chất lượng' }
];

const lineTypes = [
  { suffix: 'A', name: 'Dây chuyền A' },
  { suffix: 'B', name: 'Dây chuyền B' }
];

const machineTypes = ['AVI', 'AOI', 'SPI'] as const;
const machineModels: Record<string, string[]> = {
  AVI: ['KY-8000', 'KY-8030', 'Zenith-II'],
  AOI: ['Mirtec MV-6', 'Koh Young Zenith', 'Omron VT-S730'],
  SPI: ['Koh Young KY8030-3', 'Mirtec MS-11']
};
const manufacturers: Record<string, string[]> = {
  AVI: ['Koh Young', 'Mirtec'],
  AOI: ['Mirtec', 'Koh Young', 'Omron'],
  SPI: ['Koh Young', 'Mirtec']
};

// Main seed function
async function seedDemoData() {
  console.log('\n🚀 Starting Demo Data Seed...\n');
  
  const createdFactories: Array<{ id: number; code: string; name: string }> = [];
  const createdWorkshops: Array<{ id: number; code: string; name: string; factoryId: number }> = [];
  const createdLines: Array<{ id: number; code: string; name: string; workshopId: number | null }> = [];
  const createdStations: Array<{ id: number; code: string; name: string; lineId: number }> = [];
  const createdMachines: Array<{ id: number; code: string; name: string; stationId: number }> = [];
  
  try {
    // 1. Create Factories
    console.log('📦 Creating Factories...');
    for (const factory of factoriesData) {
      try {
        const id = await createFactory({
          code: factory.code,
          name: factory.name,
          address: factory.address,
          description: factory.description
        });
        createdFactories.push({ id: Number(id), code: factory.code, name: factory.name });
        console.log(`  ✅ Factory: ${factory.name} (ID: ${id})`);
      } catch (e: any) {
        if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
          console.log(`  ⚠️ Factory ${factory.code} already exists, skipping...`);
        } else {
          console.log(`  ❌ Error creating factory ${factory.code}: ${e.message}`);
        }
      }
    }
    
    // Get existing factories if none created
    if (createdFactories.length === 0) {
      console.log('  📋 Fetching existing factories...');
      const existing = await getFactories();
      for (const f of existing) {
        createdFactories.push({ id: Number(f.id), code: f.code, name: f.name });
      }
      console.log(`  📋 Found ${createdFactories.length} existing factories`);
    }
    
    // 2. Create Workshops for each Factory
    console.log('\n🏭 Creating Workshops...');
    for (const factory of createdFactories.slice(0, 3)) {
      for (const wsType of workshopTypes) {
        const wsCode = `${factory.code}-${wsType.suffix}`;
        const wsName = `${wsType.name} - ${factory.name.split(' ').pop()}`;
        
        try {
          const id = await createWorkshop({
            factoryId: factory.id,
            code: wsCode,
            name: wsName,
            description: wsType.description
          });
          createdWorkshops.push({ id: Number(id), code: wsCode, name: wsName, factoryId: factory.id });
          console.log(`  ✅ Workshop: ${wsName} (ID: ${id})`);
        } catch (e: any) {
          if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
            console.log(`  ⚠️ Workshop ${wsCode} already exists, skipping...`);
          } else {
            console.log(`  ❌ Error creating workshop ${wsCode}: ${e.message}`);
          }
        }
      }
    }
    
    // Get existing workshops if none created
    if (createdWorkshops.length === 0) {
      console.log('  📋 Fetching existing workshops...');
      const existing = await getWorkshops();
      for (const w of existing) {
        createdWorkshops.push({ id: Number(w.id), code: w.code, name: w.name, factoryId: Number(w.factoryId) });
      }
      console.log(`  📋 Found ${createdWorkshops.length} existing workshops`);
    }
    
    // 3. Create Lines for each Workshop
    console.log('\n🔗 Creating Production Lines...');
    for (const workshop of createdWorkshops.slice(0, 6)) {
      for (const lineType of lineTypes) {
        const lineCode = `${workshop.code}-${lineType.suffix}`;
        const lineName = `${lineType.name} - ${workshop.name.split(' - ')[0]}`;
        
        try {
          const id = await createProductionLine({
            workshopId: workshop.id,
            code: lineCode,
            name: lineName,
            description: `Dây chuyền sản xuất ${lineType.suffix}`
          });
          createdLines.push({ id: Number(id), code: lineCode, name: lineName, workshopId: workshop.id });
          console.log(`  ✅ Line: ${lineName} (ID: ${id})`);
        } catch (e: any) {
          if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
            console.log(`  ⚠️ Line ${lineCode} already exists, skipping...`);
          } else {
            console.log(`  ❌ Error creating line ${lineCode}: ${e.message}`);
          }
        }
      }
    }
    
    // Get existing lines if none created
    if (createdLines.length === 0) {
      console.log('  📋 Fetching existing lines...');
      const existing = await getProductionLines();
      for (const l of existing) {
        createdLines.push({ id: Number(l.id), code: l.code, name: l.name, workshopId: Number(l.workshopId) });
      }
      console.log(`  📋 Found ${createdLines.length} existing lines`);
    }
    
    // 4. Create Stations for each Line
    console.log('\n📍 Creating Stations...');
    const stationNames = ['Pre-AOI', 'Post-Reflow', 'Final'];
    for (const line of createdLines.slice(0, 8)) {
      for (let i = 0; i < stationNames.length; i++) {
        const stCode = `${line.code}-ST${i + 1}`;
        const stName = `${stationNames[i]} - ${line.code}`;
        
        try {
          const id = await createStation({
            lineId: line.id,
            code: stCode,
            name: stName,
            orderIndex: i + 1,
            description: `Trạm kiểm tra ${stationNames[i]}`
          });
          createdStations.push({ id: Number(id), code: stCode, name: stName, lineId: line.id });
          console.log(`  ✅ Station: ${stName} (ID: ${id})`);
        } catch (e: any) {
          if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
            console.log(`  ⚠️ Station ${stCode} already exists, skipping...`);
          } else {
            console.log(`  ❌ Error creating station ${stCode}: ${e.message}`);
          }
        }
      }
    }
    
    // Get existing stations if none created
    if (createdStations.length === 0) {
      console.log('  📋 Fetching existing stations...');
      const existing = await getStations();
      for (const s of existing) {
        createdStations.push({ id: Number(s.id), code: s.code, name: s.name, lineId: Number(s.lineId) });
      }
      console.log(`  📋 Found ${createdStations.length} existing stations`);
    }
    
    // 5. Create Machines for each Station
    console.log('\n🤖 Creating Machines...');
    for (const station of createdStations.slice(0, 15)) {
      const machineType = randomChoice([...machineTypes]);
      const model = randomChoice(machineModels[machineType]);
      const manufacturer = randomChoice(manufacturers[machineType]);
      const apiKey = generateApiKey();
      
      const machineCode = `${station.code}-${machineType}`;
      const machineName = `${machineType} ${model}`;
      
      try {
        const id = await createMachine({
          stationId: station.id,
          code: machineCode,
          name: machineName,
          machineType: machineType,
          model: model,
          manufacturer: manufacturer,
          apiKey: apiKey
        });
        createdMachines.push({ id: Number(id), code: machineCode, name: machineName, stationId: station.id });
        console.log(`  ✅ Machine: ${machineName} (ID: ${id})`);
      } catch (e: any) {
        if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
          console.log(`  ⚠️ Machine ${machineCode} already exists, skipping...`);
        } else {
          console.log(`  ❌ Error creating machine ${machineCode}: ${e.message}`);
        }
      }
    }
    
    // Get existing machines if none created
    if (createdMachines.length === 0) {
      console.log('  📋 Fetching existing machines...');
      const existing = await getMachines();
      for (const m of existing) {
        createdMachines.push({ id: Number(m.id), code: m.code, name: m.name, stationId: Number(m.stationId) });
      }
      console.log(`  📋 Found ${createdMachines.length} existing machines`);
    }
    
    // 6. Create Sample Inspections
    console.log('\n📊 Creating Sample Inspections...');
    let totalInspections = 0;
    
    for (const machine of createdMachines.slice(0, 10)) {
      const numInspections = randomInt(30, 60);
      
      for (let i = 0; i < numInspections; i++) {
        // Weighted random result: 85% OK, 10% NG, 5% NTF
        const rand = Math.random();
        let result: 'OK' | 'NG' | 'NTF';
        if (rand < 0.85) result = 'OK';
        else if (rand < 0.95) result = 'NG';
        else result = 'NTF';
        
        const serialNumber = `SN${Date.now()}${randomInt(1000, 9999)}`;
        const daysAgo = randomInt(0, 7);
        const inspectedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - randomInt(0, 23) * 60 * 60 * 1000);
        
        try {
          await createProductInspection({
            machineId: machine.id,
            serialNumber: serialNumber,
            result: result,
            inspectedAt: inspectedAt
          });
          totalInspections++;
        } catch (e: any) {
          // Ignore duplicate errors
        }
      }
    }
    console.log(`  ✅ Created ${totalInspections} sample inspections`);
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SEED DATA SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Factories:   ${createdFactories.length}`);
    console.log(`  Workshops:   ${createdWorkshops.length}`);
    console.log(`  Lines:       ${createdLines.length}`);
    console.log(`  Stations:    ${createdStations.length}`);
    console.log(`  Machines:    ${createdMachines.length}`);
    console.log(`  Inspections: ${totalInspections}`);
    console.log('='.repeat(60));
    console.log('\n✅ Demo data seeding completed successfully!\n');
    
  } catch (error: any) {
    console.error('\n❌ Error seeding data:', error.message);
    throw error;
  }
}

// Run the seed
seedDemoData()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
