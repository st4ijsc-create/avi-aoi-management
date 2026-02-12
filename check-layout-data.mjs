import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function checkLayoutData() {
  try {
    // Check layout for SMT 1
    const layouts = await sql`
      SELECT id, name, "workshopId"
      FROM factory_layouts
      WHERE name LIKE '%SMT%'
    `;
    
    console.log('Layouts:', JSON.stringify(layouts, null, 2));
    
    if (layouts.length > 0) {
      const layoutId = layouts[0].id;
      console.log('\n=== Checking positions for layout', layoutId, '===');
      
      const positions = await sql`
        SELECT lmp.*, m.code, m.name, m."image2DUrl", m."image3DUrl"
        FROM layout_machine_positions lmp
        JOIN machines m ON lmp."machineId" = m.id
        WHERE lmp."layoutId" = ${layoutId}
      `;
      
      console.log('\nMachines in layout:', JSON.stringify(positions, null, 2));
      
      // Specifically check for FAC-HN-DIP-B-ST3-AOI
      const aoi = positions.find(p => p.code === 'FAC-HN-DIP-B-ST3-AOI');
      if (aoi) {
        console.log('\n=== FAC-HN-DIP-B-ST3-AOI Details ===');
        console.log('image2DUrl:', aoi.image2DUrl);
        console.log('image3DUrl:', aoi.image3DUrl);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sql.end();
  }
}

checkLayoutData();
