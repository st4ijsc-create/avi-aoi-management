import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function checkData() {
  try {
    // Check machine positions for FAC-HN-DIP-B-ST3-AOI
    const positions = await sql`
      SELECT mp.*, m.code, m.name, m."image2DUrl", m."image3DUrl"
      FROM machine_positions mp
      JOIN machines m ON mp."machineId" = m.id
      WHERE m.code = 'FAC-HN-DIP-B-ST3-AOI'
    `;
    
    console.log('Machine FAC-HN-DIP-B-ST3-AOI positions:', JSON.stringify(positions, null, 2));
    
    if (positions.length === 0) {
      console.log('\n⚠️ Machine is NOT in any layout positions!');
      
      // Find which layout(s) exist
      const layouts = await sql`
        SELECT id, name, "workshopId"
        FROM factory_layouts
      `;
      console.log('\nAvailable layouts:', JSON.stringify(layouts, null, 2));
      
      // Check what machines are in positions
      const allMachines = await sql`
        SELECT mp."layoutId", m.code, m.name
        FROM machine_positions mp
        JOIN machines m ON mp."machineId" = m.id
        ORDER BY mp."layoutId", m.code
      `;
      console.log('\nMachines in layouts:', JSON.stringify(allMachines, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sql.end();
  }
}

checkData();
