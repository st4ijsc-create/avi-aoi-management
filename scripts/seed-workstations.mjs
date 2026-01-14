import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'avi_aoi_management',
});

const workstations = [
  { name: 'SMT Line 1', code: 'SMT-01', description: 'Surface Mount Technology Line 1' },
  { name: 'SMT Line 2', code: 'SMT-02', description: 'Surface Mount Technology Line 2' },
  { name: 'DIP Assembly', code: 'DIP-01', description: 'Dual In-line Package Assembly' },
  { name: 'Manual Assembly', code: 'ASM-01', description: 'Manual Assembly Workstation' },
  { name: 'Wave Soldering', code: 'SOL-01', description: 'Wave Soldering Machine' },
  { name: 'Functional Test', code: 'TEST-01', description: 'Functional Testing Station' },
  { name: 'Burn-in Test', code: 'BURN-01', description: 'Burn-in Testing Equipment' },
  { name: 'Final Inspection', code: 'INS-01', description: 'Final Inspection Station' },
  { name: 'Packaging', code: 'PKG-01', description: 'Product Packaging Station' },
  { name: 'QC Verification', code: 'QC-01', description: 'Quality Control Verification' },
];

try {
  for (const ws of workstations) {
    await connection.execute(
      'INSERT INTO workstations (name, code, description, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [ws.name, ws.code, ws.description]
    );
    console.log(`✓ Created workstation: ${ws.name}`);
  }

  // Update measurementPointDefs with workstationId
  const [points] = await connection.execute('SELECT id FROM measurement_point_defs LIMIT 1');
  if (points.length > 0) {
    const [allPoints] = await connection.execute('SELECT id FROM measurement_point_defs');
    const workstationIds = workstations.map(ws => ws.code);
    
    for (let i = 0; i < allPoints.length; i++) {
      const workstationId = workstationIds[i % workstationIds.length];
      const [ws] = await connection.execute(
        'SELECT id FROM workstations WHERE code = ?',
        [workstationId]
      );
      
      if (ws.length > 0) {
        await connection.execute(
          'UPDATE measurement_point_defs SET workstation_id = ? WHERE id = ?',
          [ws[0].id, allPoints[i].id]
        );
      }
    }
    console.log(`✓ Updated ${allPoints.length} measurement points with workstationId`);
  }

  console.log('\n✓ Workstations seed data completed successfully!');
} catch (error) {
  console.error('Error seeding workstations:', error.message);
} finally {
  await connection.end();
}
