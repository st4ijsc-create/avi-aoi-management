import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function checkMachine() {
  try {
    const machine = await sql`
      SELECT id, code, name, "image2DUrl", "image3DUrl"
      FROM machines
      WHERE code = 'FAC-HN-DIP-B-ST3-AOI'
    `;
    
    console.log('Machine data:');
    console.log(JSON.stringify(machine[0], null, 2));
    
    if (machine[0]) {
      console.log('\nImage status:');
      console.log('- Has image2DUrl:', !!machine[0].image2DUrl);
      console.log('- Has image3DUrl:', !!machine[0].image3DUrl);
    } else {
      console.log('Machine not found!');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sql.end();
  }
}

checkMachine();
