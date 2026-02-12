import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function checkData() {
  try {
    // Check all layouts
    const layouts = await sql`
      SELECT *
      FROM factory_layouts
      ORDER BY id
    `;
    
    console.log('Total layouts:', layouts.length);
    console.log('Layouts:', JSON.stringify(layouts, null, 2));
    
    // Check if machine is in any layout_machine_positions
    const positions = await sql`
      SELECT lmp.*, m.code, m.name
      FROM layout_machine_positions lmp
      JOIN machines m ON lmp."machineId" = m.id
      WHERE m.code = 'FAC-HN-DIP-B-ST3-AOI'
    `;
    
    console.log('\nMachine FAC-HN-DIP-B-ST3-AOI in layouts:', JSON.stringify(positions, null, 2));
    
    // Check machine direct data
    const machine = await sql`
      SELECT id, code, name, "stationId", "image2DUrl", "image3DUrl"
      FROM machines
      WHERE code = 'FAC-HN-DIP-B-ST3-AOI'
    `;
    
    console.log('\nMachine data:', JSON.stringify(machine, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sql.end();
  }
}

checkData();
