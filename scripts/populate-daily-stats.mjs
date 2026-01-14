import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function populateDailyStats() {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const connection = await mysql.createConnection(DATABASE_URL);

  try {
    console.log('Populating daily_statistics from product_inspections...');

    // Get aggregated data from product_inspections grouped by date and machine
    const [rows] = await connection.execute(`
      INSERT INTO daily_statistics (machineId, factoryId, workshopId, date, okCount, ngCount, ntfCount, createdAt, updatedAt)
      SELECT 
        machineId,
        1 as factoryId,
        1 as workshopId,
        DATE(inspectionTime) as date,
        SUM(CASE WHEN overallResult = 'OK' THEN 1 ELSE 0 END) as okCount,
        SUM(CASE WHEN overallResult = 'NG' THEN 1 ELSE 0 END) as ngCount,
        SUM(CASE WHEN overallResult = 'NTF' THEN 1 ELSE 0 END) as ntfCount,
        NOW() as createdAt,
        NOW() as updatedAt
      FROM product_inspections
      WHERE inspectionTime IS NOT NULL
      GROUP BY machineId, DATE(inspectionTime)
      ON DUPLICATE KEY UPDATE
        okCount = VALUES(okCount),
        ngCount = VALUES(ngCount),
        ntfCount = VALUES(ntfCount),
        updatedAt = NOW()
    `);

    console.log('Daily statistics populated successfully');

    // Check results
    const [stats] = await connection.execute('SELECT COUNT(*) as count FROM daily_statistics');
    console.log(`Total daily_statistics records: ${stats[0].count}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.end();
  }
}

populateDailyStats();
