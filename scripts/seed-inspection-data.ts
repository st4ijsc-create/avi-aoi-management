/**
 * Seed Inspection Data Script for AVI/AOI Factory Management System
 * 
 * Creates:
 * 1. Product Models with measurement points
 * 2. Inspection records with measurement results
 * 3. Data distributed over 7 days for dashboard analytics
 * 
 * Usage: npx tsx scripts/seed-inspection-data.ts
 */

import {
  createProductModel,
  createMeasurementPointDef,
  createProductInspection,
  createMeasurementResult,
  getProductModels,
  getMachines,
  getMeasurementPointDefsByProductModel
} from '../server/db';

// Helper functions
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals: number = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSerialNumber(prefix: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

// Product Model definitions
const productModelsData = [
  {
    code: 'PCB-SMT-001',
    name: 'Main Board PCB v1.0',
    description: 'Bo mạch chính cho thiết bị điện tử tiêu dùng',
    category: 'PCB',
    productLine: 'Consumer Electronics',
    variant: 'Standard',
    targetYieldRate: '98.50',
    minYieldRate: '95.00'
  },
  {
    code: 'PCB-SMT-002',
    name: 'Power Supply Board',
    description: 'Bo mạch nguồn điện',
    category: 'PCB',
    productLine: 'Power Electronics',
    variant: 'High Power',
    targetYieldRate: '97.00',
    minYieldRate: '94.00'
  },
  {
    code: 'PCB-AOI-003',
    name: 'Sensor Module PCB',
    description: 'Bo mạch module cảm biến',
    category: 'Module',
    productLine: 'IoT Devices',
    variant: 'Compact',
    targetYieldRate: '99.00',
    minYieldRate: '96.00'
  },
  {
    code: 'PCB-DIP-004',
    name: 'Control Board DIP',
    description: 'Bo mạch điều khiển với linh kiện DIP',
    category: 'PCB',
    productLine: 'Industrial Control',
    variant: 'Industrial',
    targetYieldRate: '96.50',
    minYieldRate: '93.00'
  },
  {
    code: 'MOD-CAM-005',
    name: 'Camera Module Assembly',
    description: 'Module camera hoàn chỉnh',
    category: 'Module',
    productLine: 'Camera Systems',
    variant: 'HD',
    targetYieldRate: '97.50',
    minYieldRate: '94.50'
  }
];

// Measurement point types for PCB inspection
const measurementPointTypes = [
  { type: 'DIMENSION', unit: 'mm', prefix: 'DIM' },
  { type: 'VISUAL', unit: null, prefix: 'VIS' },
  { type: 'POSITION', unit: 'mm', prefix: 'POS' },
  { type: 'SURFACE', unit: '%', prefix: 'SUR' }
];

// Component names for measurement points
const componentNames = [
  'IC U1', 'IC U2', 'IC U3', 'IC U4',
  'Capacitor C1', 'Capacitor C2', 'Capacitor C3',
  'Resistor R1', 'Resistor R2', 'Resistor R3', 'Resistor R4',
  'Connector J1', 'Connector J2',
  'Crystal Y1',
  'Inductor L1', 'Inductor L2',
  'Diode D1', 'Diode D2',
  'Transistor Q1', 'Transistor Q2',
  'LED LED1', 'LED LED2',
  'Solder Joint SJ1', 'Solder Joint SJ2', 'Solder Joint SJ3'
];

// Main seed function
async function seedInspectionData() {
  console.log('\n🚀 Starting Inspection Data Seed...\n');
  
  const createdProductModels: Array<{ id: number; code: string; name: string }> = [];
  const createdMeasurementPoints: Map<number, Array<{ id: number; code: string }>> = new Map();
  let totalInspections = 0;
  let totalMeasurements = 0;
  
  try {
    // 1. Create Product Models
    console.log('📦 Creating Product Models...');
    for (const pm of productModelsData) {
      try {
        const id = await createProductModel({
          code: pm.code,
          name: pm.name,
          description: pm.description,
          category: pm.category,
          productLine: pm.productLine,
          variant: pm.variant,
          targetYieldRate: pm.targetYieldRate,
          minYieldRate: pm.minYieldRate,
          lifecycleStatus: 'active'
        });
        createdProductModels.push({ id: Number(id), code: pm.code, name: pm.name });
        console.log(`  ✅ Product Model: ${pm.name} (ID: ${id})`);
      } catch (e: any) {
        if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
          console.log(`  ⚠️ Product Model ${pm.code} already exists, fetching...`);
        } else {
          console.log(`  ❌ Error creating product model ${pm.code}: ${e.message}`);
        }
      }
    }
    
    // Get existing product models if none created
    if (createdProductModels.length === 0) {
      console.log('  📋 Fetching existing product models...');
      const existing = await getProductModels();
      for (const pm of existing) {
        createdProductModels.push({ id: Number(pm.id), code: pm.code, name: pm.name });
      }
      console.log(`  📋 Found ${createdProductModels.length} existing product models`);
    }
    
    // 2. Create Measurement Points for each Product Model
    console.log('\n📍 Creating Measurement Points...');
    for (const pm of createdProductModels) {
      const points: Array<{ id: number; code: string }> = [];
      const numPoints = randomInt(12, 18);
      
      // Check if points already exist
      const existingPoints = await getMeasurementPointDefsByProductModel(pm.id);
      if (existingPoints.length > 0) {
        console.log(`  ⚠️ Product ${pm.code} already has ${existingPoints.length} measurement points, skipping...`);
        for (const p of existingPoints) {
          points.push({ id: Number(p.id), code: p.code });
        }
        createdMeasurementPoints.set(pm.id, points);
        continue;
      }
      
      for (let i = 0; i < numPoints; i++) {
        const mpType = randomChoice(measurementPointTypes);
        const component = componentNames[i % componentNames.length];
        const pointCode = `${mpType.prefix}-${pm.code.split('-')[1]}-${String(i + 1).padStart(3, '0')}`;
        const pointName = `${component} - ${mpType.type}`;
        
        // Random position on a 1000x800 reference image
        const posX = randomInt(50, 950);
        const posY = randomInt(50, 750);
        
        // Limits based on measurement type
        let lowerLimit: string | null = null;
        let upperLimit: string | null = null;
        let nominalValue: string | null = null;
        
        if (mpType.type === 'DIMENSION') {
          nominalValue = randomFloat(0.5, 5.0, 3).toString();
          lowerLimit = (parseFloat(nominalValue) - 0.1).toFixed(3);
          upperLimit = (parseFloat(nominalValue) + 0.1).toFixed(3);
        } else if (mpType.type === 'POSITION') {
          nominalValue = '0.000';
          lowerLimit = '-0.050';
          upperLimit = '0.050';
        } else if (mpType.type === 'SURFACE') {
          nominalValue = '95.00';
          lowerLimit = '90.00';
          upperLimit = '100.00';
        }
        
        try {
          const id = await createMeasurementPointDef({
            productModelId: pm.id,
            code: pointCode,
            name: pointName,
            measurementType: mpType.type as any,
            unit: mpType.unit,
            lowerLimit: lowerLimit,
            upperLimit: upperLimit,
            nominalValue: nominalValue,
            positionX: posX,
            positionY: posY,
            radius: randomInt(15, 30),
            cropWidth: randomInt(80, 120),
            cropHeight: randomInt(80, 120),
            orderIndex: i + 1
          });
          points.push({ id: Number(id), code: pointCode });
        } catch (e: any) {
          // Skip errors
        }
      }
      
      createdMeasurementPoints.set(pm.id, points);
      console.log(`  ✅ Created ${points.length} measurement points for ${pm.code}`);
    }
    
    // 3. Get all machines
    console.log('\n🤖 Fetching machines...');
    const machines = await getMachines();
    console.log(`  📋 Found ${machines.length} machines`);
    
    if (machines.length === 0) {
      console.log('  ❌ No machines found. Please run seed-demo-data.ts first.');
      return;
    }
    
    // 4. Create Inspection Data
    console.log('\n📊 Creating Inspection Data (7 days)...');
    
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // For each machine, create inspections
    for (const machine of machines.slice(0, 15)) {
      const productModel = randomChoice(createdProductModels);
      const points = createdMeasurementPoints.get(productModel.id) || [];
      
      if (points.length === 0) {
        console.log(`  ⚠️ No measurement points for ${productModel.code}, skipping...`);
        continue;
      }
      
      // Create 40-80 inspections per machine over 7 days
      const numInspections = randomInt(40, 80);
      let machineInspections = 0;
      let machineMeasurements = 0;
      
      for (let i = 0; i < numInspections; i++) {
        // Random time in the last 7 days
        const randomTime = new Date(
          sevenDaysAgo.getTime() + Math.random() * (now.getTime() - sevenDaysAgo.getTime())
        );
        
        // Weighted random result: 85% OK, 10% NG, 5% NTF
        const rand = Math.random();
        let overallResult: 'OK' | 'NG' | 'NTF';
        let originalResult: 'OK' | 'NG';
        
        if (rand < 0.85) {
          overallResult = 'OK';
          originalResult = 'OK';
        } else if (rand < 0.95) {
          overallResult = 'NG';
          originalResult = 'NG';
        } else {
          overallResult = 'NTF';
          originalResult = 'NG'; // NTF was originally NG but confirmed as false alarm
        }
        
        const serialNumber = generateSerialNumber(productModel.code.split('-')[1]);
        const cycleTime = randomFloat(2.5, 8.0, 2).toString();
        
        try {
          const inspectionId = await createProductInspection({
            machineId: Number(machine.id),
            productModelId: productModel.id,
            serialNumber: serialNumber,
            productModel: productModel.code,
            overallResult: overallResult,
            originalResult: originalResult,
            inspectionTime: randomTime,
            cycleTime: cycleTime
          });
          
          machineInspections++;
          totalInspections++;
          
          // Create measurement results for this inspection
          // For OK inspections, all measurements pass
          // For NG inspections, 1-3 measurements fail
          const failingPointCount = overallResult === 'NG' ? randomInt(1, 3) : 0;
          const failingPointIndices = new Set<number>();
          
          while (failingPointIndices.size < failingPointCount) {
            failingPointIndices.add(randomInt(0, points.length - 1));
          }
          
          for (let j = 0; j < points.length; j++) {
            const point = points[j];
            const isFailing = failingPointIndices.has(j);
            
            let measuredValue: string | null = null;
            let result: 'OK' | 'NG' | 'NTF' = 'OK';
            
            // Generate measured value based on pass/fail
            if (isFailing) {
              result = 'NG';
              // Out of spec value
              measuredValue = randomFloat(-0.2, 0.2, 4).toString();
            } else {
              result = 'OK';
              // In spec value
              measuredValue = randomFloat(-0.05, 0.05, 4).toString();
            }
            
            try {
              await createMeasurementResult({
                inspectionId: Number(inspectionId),
                pointDefId: point.id,
                measuredValue: measuredValue,
                result: result,
                aiConfidence: randomFloat(0.85, 0.99, 4).toString(),
                aiComparisonScore: isFailing ? randomFloat(0.3, 0.7, 4).toString() : randomFloat(0.85, 0.99, 4).toString()
              });
              machineMeasurements++;
              totalMeasurements++;
            } catch (e: any) {
              // Skip errors
            }
          }
        } catch (e: any) {
          // Skip errors
        }
      }
      
      console.log(`  ✅ Machine ${machine.code}: ${machineInspections} inspections, ${machineMeasurements} measurements`);
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 INSPECTION DATA SEED SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Product Models:      ${createdProductModels.length}`);
    console.log(`  Measurement Points:  ${Array.from(createdMeasurementPoints.values()).reduce((sum, arr) => sum + arr.length, 0)}`);
    console.log(`  Inspections:         ${totalInspections}`);
    console.log(`  Measurement Results: ${totalMeasurements}`);
    console.log(`  Time Range:          Last 7 days`);
    console.log(`  Result Distribution: ~85% OK, ~10% NG, ~5% NTF`);
    console.log('='.repeat(60));
    console.log('\n✅ Inspection data seeding completed successfully!\n');
    
  } catch (error: any) {
    console.error('\n❌ Error seeding inspection data:', error.message);
    throw error;
  }
}

// Run the seed
seedInspectionData()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
