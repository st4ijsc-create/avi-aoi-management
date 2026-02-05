import pg from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = pg(process.env.DATABASE_URL);

async function testQueries() {
  try {
    console.log('Connected to database\n');

    // Check factories
    const factories = await sql`SELECT id, code, name, "isActive" FROM factories LIMIT 10`;
    console.log('=== FACTORIES ===');
    console.log(`Total: ${factories.length}`);
    console.table(factories);

    // Check workshops
    const workshops = await sql`SELECT id, code, name, "factoryId", "isActive" FROM workshops LIMIT 10`;
    console.log('\n=== WORKSHOPS ===');
    console.log(`Total: ${workshops.length}`);
    console.table(workshops);

    // Check workstations
    const workstations = await sql`SELECT id, code, name, "lineId", "workshopId", "factoryId", "isActive" FROM workstations LIMIT 10`;
    console.log('\n=== WORKSTATIONS ===');
    console.log(`Total: ${workstations.length}`);
    console.table(workstations);

    // Count by isActive status
    console.log('\n=== COUNTS BY isActive ===');
    const factoryCounts = await sql`SELECT "isActive", COUNT(*) FROM factories GROUP BY "isActive"`;
    console.log('Factories:', factoryCounts);
    
    const workshopCounts = await sql`SELECT "isActive", COUNT(*) FROM workshops GROUP BY "isActive"`;
    console.log('Workshops:', workshopCounts);
    
    const workstationCounts = await sql`SELECT "isActive", COUNT(*) FROM workstations GROUP BY "isActive"`;
    console.log('Workstations:', workstationCounts);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await sql.end();
  }
}

testQueries();
