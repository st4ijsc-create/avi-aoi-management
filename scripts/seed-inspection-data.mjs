// Seed script to generate 5 days x 100 inspection records
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

async function main() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  try {
    console.log('Starting seed data generation...');
    
    // Get existing machines
    const [machines] = await connection.execute('SELECT id, code, name FROM machines LIMIT 5');
    if (machines.length === 0) {
      console.log('No machines found. Creating sample machines first...');
      // Insert sample machines if none exist
      await connection.execute(`
        INSERT INTO machines (code, name, type, status, created_at, updated_at) 
        VALUES 
          ('AVI001', 'AVI Machine 1', 'AVI', 'online', NOW(), NOW()),
          ('AVI002', 'AVI Machine 2', 'AVI', 'online', NOW(), NOW()),
          ('AOI001', 'AOI Machine 1', 'AOI', 'online', NOW(), NOW())
        ON DUPLICATE KEY UPDATE name = VALUES(name)
      `);
      const [newMachines] = await connection.execute('SELECT id, code, name FROM machines LIMIT 5');
      machines.push(...newMachines);
    }
    
    console.log(`Found ${machines.length} machines`);
    
    // Get existing product models
    const [productModels] = await connection.execute('SELECT id, code, name FROM product_models LIMIT 5');
    const modelCodes = productModels.length > 0 
      ? productModels.map(m => m.code) 
      : ['MODEL-A', 'MODEL-B', 'MODEL-C'];
    
    // Generate 5 days of data
    const now = new Date();
    const results = ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'NG', 'NTF']; // 80% OK, 10% NG, 10% NTF
    
    let totalInserted = 0;
    
    for (let dayOffset = 4; dayOffset >= 0; dayOffset--) {
      const date = new Date(now);
      date.setDate(date.getDate() - dayOffset);
      date.setHours(0, 0, 0, 0);
      
      console.log(`Generating data for ${date.toISOString().split('T')[0]}...`);
      
      for (let i = 0; i < 100; i++) {
        const machine = machines[Math.floor(Math.random() * machines.length)];
        const productModel = modelCodes[Math.floor(Math.random() * modelCodes.length)];
        const result = results[Math.floor(Math.random() * results.length)];
        
        // Random time during work hours (6:00 - 22:00)
        const hour = 6 + Math.floor(Math.random() * 16);
        const minute = Math.floor(Math.random() * 60);
        const second = Math.floor(Math.random() * 60);
        
        const inspectionTime = new Date(date);
        inspectionTime.setHours(hour, minute, second);
        
        const serialNumber = `SN${date.toISOString().split('T')[0].replace(/-/g, '')}${String(i).padStart(4, '0')}`;
        const batchNumber = `BATCH${date.toISOString().split('T')[0].replace(/-/g, '')}`;
        const cycleTime = 3 + Math.random() * 4; // 3-7 seconds
        
        // Calculate OK, NG, NTF counts based on result
        const okCount = result === 'OK' ? Math.floor(Math.random() * 5) + 5 : Math.floor(Math.random() * 3);
        const ngCount = result === 'NG' ? Math.floor(Math.random() * 3) + 1 : 0;
        const ntfCount = result === 'NTF' ? Math.floor(Math.random() * 2) + 1 : 0;
        
        try {
          await connection.execute(`
            INSERT INTO product_inspections 
            (machineId, serialNumber, productModel, batchNumber, cycleTime, overallResult, originalResult, inspectionTime, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
          `, [
            machine.id,
            serialNumber,
            productModel,
            batchNumber,
            cycleTime.toFixed(2),
            result,
            result === 'NTF' ? 'NG' : result, // originalResult is either OK or NG
            inspectionTime
          ]);
          totalInserted++;
        } catch (err) {
          if (err.code !== 'ER_DUP_ENTRY') {
            console.error(`Error inserting record: ${err.message}`);
          }
        }
      }
    }
    
    console.log(`\\nSeed data generation complete!`);
    console.log(`Total records inserted: ${totalInserted}`);
    
    // Show summary
    const [summary] = await connection.execute(`
      SELECT 
        DATE(inspection_time) as date,
        COUNT(*) as total,
        SUM(CASE WHEN overall_result = 'OK' THEN 1 ELSE 0 END) as ok_count,
        SUM(CASE WHEN overall_result = 'NG' THEN 1 ELSE 0 END) as ng_count,
        SUM(CASE WHEN overall_result = 'NTF' THEN 1 ELSE 0 END) as ntf_count
      FROM product_inspections
      WHERE inspection_time >= DATE_SUB(NOW(), INTERVAL 5 DAY)
      GROUP BY DATE(inspection_time)
      ORDER BY date DESC
    `);
    
    console.log('\\nSummary by date:');
    console.table(summary);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.end();
  }
}

main();
