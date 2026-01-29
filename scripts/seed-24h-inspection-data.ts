/**
 * Seed 24-Hour Inspection Data Script for AVI/AOI Factory Management System
 * 
 * Creates inspection records concentrated in the last 24 hours
 * to populate the timeline chart on the dashboard.
 * 
 * Usage: npx tsx scripts/seed-24h-inspection-data.ts
 */

import {
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

// Main seed function
async function seed24HourInspectionData() {
  console.log('\n🚀 Starting 24-Hour Inspection Data Seed...\n');
  
  let totalInspections = 0;
  let totalMeasurements = 0;
  
  try {
    // 1. Get existing product models
    console.log('📦 Fetching Product Models...');
    const productModels = await getProductModels();
    console.log(`  📋 Found ${productModels.length} product models`);
    
    if (productModels.length === 0) {
      console.log('  ❌ No product models found. Please run seed-inspection-data.ts first.');
      return;
    }
    
    // 2. Get all machines
    console.log('\n🤖 Fetching machines...');
    const machines = await getMachines();
    console.log(`  📋 Found ${machines.length} machines`);
    
    if (machines.length === 0) {
      console.log('  ❌ No machines found. Please run seed-demo-data.ts first.');
      return;
    }
    
    // 3. Get measurement points for each product model
    console.log('\n📍 Fetching Measurement Points...');
    const measurementPointsMap = new Map<number, Array<{ id: number; code: string }>>();
    
    for (const pm of productModels) {
      const points = await getMeasurementPointDefsByProductModel(Number(pm.id));
      if (points.length > 0) {
        measurementPointsMap.set(Number(pm.id), points.map(p => ({ id: Number(p.id), code: p.code })));
        console.log(`  ✅ Product ${pm.code}: ${points.length} measurement points`);
      }
    }
    
    // 4. Create Inspection Data for last 24 hours
    console.log('\n📊 Creating Inspection Data (24 hours)...\n');
    
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Create inspections distributed across 24 hours
    // Target: 10-15 inspections per hour = 240-360 total inspections
    const inspectionsPerHour = 12;
    const totalHours = 24;
    
    for (let hour = 0; hour < totalHours; hour++) {
      const hourStart = new Date(twentyFourHoursAgo.getTime() + hour * 60 * 60 * 1000);
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
      
      let hourInspections = 0;
      
      for (let i = 0; i < inspectionsPerHour; i++) {
        // Random machine
        const machine = randomChoice(machines);
        
        // Random product model
        const productModel = randomChoice(productModels);
        const points = measurementPointsMap.get(Number(productModel.id)) || [];
        
        if (points.length === 0) {
          continue;
        }
        
        // Random time within this hour
        const randomTime = new Date(
          hourStart.getTime() + Math.random() * (hourEnd.getTime() - hourStart.getTime())
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
          originalResult = 'NG';
        }
        
        const serialNumber = generateSerialNumber(productModel.code.split('-')[1]);
        const cycleTime = randomFloat(2.5, 8.0, 2).toString();
        
        try {
          const inspectionId = await createProductInspection({
            machineId: Number(machine.id),
            productModelId: Number(productModel.id),
            serialNumber: serialNumber,
            productModel: productModel.code,
            overallResult: overallResult,
            originalResult: originalResult,
            inspectionTime: randomTime,
            cycleTime: cycleTime
          });
          
          hourInspections++;
          totalInspections++;
          
          // Create measurement results for this inspection
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
            
            if (isFailing) {
              result = 'NG';
              measuredValue = randomFloat(-0.2, 0.2, 4).toString();
            } else {
              result = 'OK';
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
              totalMeasurements++;
            } catch (e: any) {
              // Skip errors
            }
          }
        } catch (e: any) {
          // Skip errors
        }
      }
      
      const hourLabel = hourStart.toISOString().substring(11, 16);
      console.log(`  ⏰ Hour ${hour + 1}/24 (${hourLabel}): ${hourInspections} inspections`);
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 24-HOUR INSPECTION DATA SEED SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Inspections:         ${totalInspections}`);
    console.log(`  Measurement Results: ${totalMeasurements}`);
    console.log(`  Time Range:          Last 24 hours`);
    console.log(`  Distribution:        ~${inspectionsPerHour} inspections per hour`);
    console.log(`  Result Distribution: ~85% OK, ~10% NG, ~5% NTF`);
    console.log('='.repeat(60));
    console.log('\n✅ 24-hour inspection data seeding completed successfully!\n');
    
  } catch (error: any) {
    console.error('\n❌ Error seeding 24-hour inspection data:', error.message);
    throw error;
  }
}

// Run the seed
seed24HourInspectionData()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
