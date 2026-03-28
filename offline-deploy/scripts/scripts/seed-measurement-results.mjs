import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function seedMeasurementResults() {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const connection = await mysql.createConnection(DATABASE_URL);

  try {
    console.log('Seeding measurement_results for product_inspections...');

    // Get all inspections that don't have measurement results yet
    const [inspections] = await connection.execute(`
      SELECT pi.id as inspectionId, pi.machineId, pi.overallResult, pi.inspectionTime
      FROM product_inspections pi
      WHERE NOT EXISTS (
        SELECT 1 FROM measurement_results mr WHERE mr.inspectionId = pi.id
      )
      LIMIT 1000
    `);

    console.log(`Found ${inspections.length} inspections without measurement results`);

    if (inspections.length === 0) {
      console.log('All inspections already have measurement results');
      return;
    }

    // Get all measurement point definitions
    const [pointDefs] = await connection.execute(
      "SELECT id, machineId, code, name, measurementType, `lowerLimit` as minVal, `upperLimit` as maxVal, `nominalValue` as targetVal FROM measurement_point_defs WHERE isActive = 1"
    );

    console.log(`Found ${pointDefs.length} active measurement point definitions`);

    // If no point defs exist, create some default ones
    if (pointDefs.length === 0) {
      console.log('Creating default measurement point definitions...');
      
      // Get unique machineIds from inspections
      const machineIds = [...new Set(inspections.map(i => i.machineId))];
      
      for (const machineId of machineIds) {
        // Create 5 measurement points per machine
        const points = [
          { code: `MP-${machineId}-001`, name: 'Kích thước X', type: 'numeric', min: 9.5, max: 10.5, target: 10.0 },
          { code: `MP-${machineId}-002`, name: 'Kích thước Y', type: 'numeric', min: 4.8, max: 5.2, target: 5.0 },
          { code: `MP-${machineId}-003`, name: 'Độ dày', type: 'numeric', min: 0.9, max: 1.1, target: 1.0 },
          { code: `MP-${machineId}-004`, name: 'Góc nghiêng', type: 'numeric', min: 89, max: 91, target: 90 },
          { code: `MP-${machineId}-005`, name: 'Chất lượng bề mặt', type: 'visual', min: null, max: null, target: null },
        ];

        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          await connection.execute(`
            INSERT INTO measurement_point_defs 
            (productModelId, machineId, code, name, measurementType, lowerLimit, upperLimit, nominalValue, positionX, positionY, radius, orderIndex, isActive, createdAt, updatedAt)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, 100, 100, 20, ?, 1, NOW(), NOW())
          `, [machineId, p.code, p.name, p.type, p.min, p.max, p.target, i + 1]);
        }
      }

      // Reload point defs
      const [newPointDefs] = await connection.execute(
        "SELECT id, machineId, code, name, measurementType, `lowerLimit` as minVal, `upperLimit` as maxVal, `nominalValue` as targetVal FROM measurement_point_defs WHERE isActive = 1"
      );
      pointDefs.push(...newPointDefs);
      console.log(`Created ${newPointDefs.length} measurement point definitions`);
    }

    // Group point defs by machineId
    const pointDefsByMachine = {};
    for (const pd of pointDefs) {
      if (!pointDefsByMachine[pd.machineId]) {
        pointDefsByMachine[pd.machineId] = [];
      }
      pointDefsByMachine[pd.machineId].push(pd);
    }

    // Generate measurement results for each inspection
    let totalResults = 0;
    const batchSize = 100;
    let batch = [];

    for (const inspection of inspections) {
      const machinePointDefs = pointDefsByMachine[inspection.machineId] || [];
      
      // If no point defs for this machine, use any available
      const availablePointDefs = machinePointDefs.length > 0 ? machinePointDefs : pointDefs.slice(0, 5);

      for (const pointDef of availablePointDefs) {
        // Generate result based on inspection overall result
        let result;
        let measuredValue = null;
        
        if (inspection.overallResult === 'OK') {
          // 95% chance of OK for OK inspections
          result = Math.random() < 0.95 ? 'OK' : 'NG';
        } else if (inspection.overallResult === 'NG') {
          // 30% chance of NG for NG inspections (at least one point should be NG)
          result = Math.random() < 0.3 ? 'NG' : 'OK';
        } else {
          // NTF - originally NG but re-tested as OK
          result = Math.random() < 0.1 ? 'NG' : 'OK';
        }

        // Generate measured value for numeric types
        if (pointDef.measurementType !== 'VISUAL' && pointDef.targetVal) {
          const target = parseFloat(pointDef.targetVal);
          const min = parseFloat(pointDef.minVal) || target * 0.95;
          const max = parseFloat(pointDef.maxVal) || target * 1.05;
          const range = max - min;

          if (result === 'OK') {
            // Value within spec
            measuredValue = min + Math.random() * range;
          } else {
            // Value out of spec
            if (Math.random() < 0.5) {
              measuredValue = min - Math.random() * range * 0.2; // Below min
            } else {
              measuredValue = max + Math.random() * range * 0.2; // Above max
            }
          }
          measuredValue = Math.round(measuredValue * 1000000) / 1000000;
        }

        // AI analysis simulation
        const aiConfidence = 0.85 + Math.random() * 0.14;
        const aiComparisonScore = result === 'OK' ? 0.9 + Math.random() * 0.1 : 0.3 + Math.random() * 0.4;

        batch.push([
          inspection.inspectionId,
          pointDef.id,
          measuredValue,
          null, // measuredValueText
          result,
          null, // imageUrl
          null, // imageKey
          null, // remark
          JSON.stringify({ prediction: result, confidence: aiConfidence }),
          aiConfidence.toFixed(4),
          aiComparisonScore.toFixed(4),
        ]);

        totalResults++;

        // Insert in batches
        if (batch.length >= batchSize) {
          await connection.query(`
            INSERT INTO measurement_results 
            (inspectionId, pointDefId, measuredValue, measuredValueText, result, imageUrl, imageKey, remark, aiAnalysisResult, aiConfidence, aiComparisonScore)
            VALUES ?
          `, [batch]);
          console.log(`Inserted ${totalResults} measurement results...`);
          batch = [];
        }
      }
    }

    // Insert remaining batch
    if (batch.length > 0) {
      await connection.query(`
        INSERT INTO measurement_results 
        (inspectionId, pointDefId, measuredValue, measuredValueText, result, imageUrl, imageKey, remark, aiAnalysisResult, aiConfidence, aiComparisonScore)
        VALUES ?
      `, [batch]);
    }

    console.log(`\nTotal measurement results created: ${totalResults}`);

    // Verify
    const [stats] = await connection.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN result = 'OK' THEN 1 ELSE 0 END) as ok_count,
        SUM(CASE WHEN result = 'NG' THEN 1 ELSE 0 END) as ng_count
      FROM measurement_results
    `);
    console.log('Measurement results stats:', stats[0]);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.end();
  }
}

seedMeasurementResults();
