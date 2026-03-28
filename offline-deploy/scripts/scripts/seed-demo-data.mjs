#!/usr/bin/env node
/**
 * Seed Demo Data Script for AVI/AOI Factory Management System
 * 
 * This script uses fetch to call the tRPC API endpoints to create demo data.
 * 
 * Usage: node scripts/seed-demo-data.mjs
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

// Helper functions
function generateApiKey() {
  const chars = 'abcdef0123456789';
  let key = 'avi_';
  for (let i = 0; i < 48; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// tRPC mutation helper
async function trpcMutate(procedure, input) {
  const url = `${BASE_URL}/api/trpc/${procedure}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return data.result?.data;
  } catch (error) {
    console.error(`  ❌ Error calling ${procedure}:`, error.message);
    return null;
  }
}

// Demo data definitions
const factoriesData = [
  { code: 'FAC-HN', name: 'Nhà máy Hà Nội', address: 'KCN Thăng Long, Đông Anh, Hà Nội', description: 'Nhà máy sản xuất linh kiện điện tử cao cấp' },
  { code: 'FAC-BN', name: 'Nhà máy Bắc Ninh', address: 'KCN Yên Phong, Bắc Ninh', description: 'Nhà máy lắp ráp và kiểm tra PCB' },
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

const machineTypes = ['AVI', 'AOI', 'SPI'];
const machineModels = {
  AVI: ['KY-8000', 'KY-8030', 'Zenith-II'],
  AOI: ['Mirtec MV-6', 'Koh Young Zenith', 'Omron VT-S730'],
  SPI: ['Koh Young KY8030-3', 'Mirtec MS-11']
};
const manufacturers = {
  AVI: ['Koh Young', 'Mirtec'],
  AOI: ['Mirtec', 'Koh Young', 'Omron'],
  SPI: ['Koh Young', 'Mirtec']
};

// Main seed function
async function seedDemoData() {
  console.log('\n🚀 Starting Demo Data Seed via tRPC API...\n');
  console.log(`📡 API URL: ${BASE_URL}\n`);
  
  const createdFactories = [];
  const createdWorkshops = [];
  const createdLines = [];
  const createdStations = [];
  const createdMachines = [];
  
  try {
    // 1. Create Factories
    console.log('📦 Creating Factories...');
    for (const factory of factoriesData) {
      const result = await trpcMutate('factory.create', factory);
      if (result) {
        createdFactories.push(result);
        console.log(`  ✅ Factory: ${result.name} (ID: ${result.id})`);
      }
    }
    
    if (createdFactories.length === 0) {
      console.log('  ⚠️ No factories created. Trying to fetch existing...');
      // Try to use existing factories
      const existingFactories = await fetch(`${BASE_URL}/api/trpc/factory.list`).then(r => r.json());
      if (existingFactories.result?.data) {
        createdFactories.push(...existingFactories.result.data);
        console.log(`  📋 Found ${createdFactories.length} existing factories`);
      }
    }
    
    // 2. Create Workshops for each Factory
    console.log('\n🏭 Creating Workshops...');
    for (const factory of createdFactories) {
      for (const wsType of workshopTypes) {
        const wsCode = `${factory.code || 'FAC'}-${wsType.suffix}`;
        const wsName = `${wsType.name} - ${factory.name?.split(' ').pop() || 'Factory'}`;
        
        const result = await trpcMutate('workshop.create', {
          factoryId: factory.id,
          code: wsCode,
          name: wsName,
          description: wsType.description
        });
        
        if (result) {
          createdWorkshops.push(result);
          console.log(`  ✅ Workshop: ${result.name} (ID: ${result.id})`);
        }
      }
    }
    
    if (createdWorkshops.length === 0) {
      console.log('  ⚠️ No workshops created. Trying to fetch existing...');
      const existingWorkshops = await fetch(`${BASE_URL}/api/trpc/workshop.list`).then(r => r.json());
      if (existingWorkshops.result?.data) {
        createdWorkshops.push(...existingWorkshops.result.data);
        console.log(`  📋 Found ${createdWorkshops.length} existing workshops`);
      }
    }
    
    // 3. Create Lines for each Workshop
    console.log('\n🔗 Creating Production Lines...');
    for (const workshop of createdWorkshops.slice(0, 6)) { // Limit to 6 workshops
      for (const lineType of lineTypes) {
        const lineCode = `${workshop.code || 'WS'}-${lineType.suffix}`;
        const lineName = `${lineType.name} - ${workshop.name?.split(' - ')[0] || 'Workshop'}`;
        
        const result = await trpcMutate('line.create', {
          workshopId: workshop.id,
          code: lineCode,
          name: lineName,
          description: `Dây chuyền sản xuất ${lineType.suffix}`
        });
        
        if (result) {
          createdLines.push(result);
          console.log(`  ✅ Line: ${result.name} (ID: ${result.id})`);
        }
      }
    }
    
    if (createdLines.length === 0) {
      console.log('  ⚠️ No lines created. Trying to fetch existing...');
      const existingLines = await fetch(`${BASE_URL}/api/trpc/line.list`).then(r => r.json());
      if (existingLines.result?.data) {
        createdLines.push(...existingLines.result.data);
        console.log(`  📋 Found ${createdLines.length} existing lines`);
      }
    }
    
    // 4. Create Stations for each Line
    console.log('\n📍 Creating Stations...');
    const stationNames = ['Pre-AOI', 'Post-Reflow', 'Final'];
    for (const line of createdLines.slice(0, 8)) { // Limit to 8 lines
      for (let i = 0; i < stationNames.length; i++) {
        const stCode = `${line.code || 'LINE'}-ST${i + 1}`;
        const stName = `${stationNames[i]} - ${line.code || 'Line'}`;
        
        const result = await trpcMutate('station.create', {
          lineId: line.id,
          code: stCode,
          name: stName,
          orderIndex: i + 1,
          description: `Trạm kiểm tra ${stationNames[i]}`
        });
        
        if (result) {
          createdStations.push(result);
          console.log(`  ✅ Station: ${result.name} (ID: ${result.id})`);
        }
      }
    }
    
    if (createdStations.length === 0) {
      console.log('  ⚠️ No stations created. Trying to fetch existing...');
      const existingStations = await fetch(`${BASE_URL}/api/trpc/station.list`).then(r => r.json());
      if (existingStations.result?.data) {
        createdStations.push(...existingStations.result.data);
        console.log(`  📋 Found ${createdStations.length} existing stations`);
      }
    }
    
    // 5. Create Machines for each Station
    console.log('\n🤖 Creating Machines...');
    for (const station of createdStations.slice(0, 12)) { // Limit to 12 stations
      const machineType = randomChoice(machineTypes);
      const model = randomChoice(machineModels[machineType]);
      const manufacturer = randomChoice(manufacturers[machineType]);
      
      const machineCode = `${station.code || 'ST'}-${machineType}`;
      const machineName = `${machineType} ${model}`;
      
      const result = await trpcMutate('machine.create', {
        stationId: station.id,
        code: machineCode,
        name: machineName,
        machineType: machineType,
        model: model,
        manufacturer: manufacturer
      });
      
      if (result) {
        createdMachines.push(result);
        console.log(`  ✅ Machine: ${result.name} (ID: ${result.id})`);
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SEED DATA SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Factories:   ${createdFactories.length}`);
    console.log(`  Workshops:   ${createdWorkshops.length}`);
    console.log(`  Lines:       ${createdLines.length}`);
    console.log(`  Stations:    ${createdStations.length}`);
    console.log(`  Machines:    ${createdMachines.length}`);
    console.log('='.repeat(60));
    console.log('\n✅ Demo data seeding completed!\n');
    
  } catch (error) {
    console.error('\n❌ Error seeding data:', error.message);
    throw error;
  }
}

// Run the seed
seedDemoData().catch(console.error);
