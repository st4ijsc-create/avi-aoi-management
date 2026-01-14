import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;

async function seedAdmin() {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const connection = await mysql.createConnection(DATABASE_URL);
  
  try {
    // Check if admin already exists
    const [existing] = await connection.execute(
      'SELECT id FROM users WHERE username = ?',
      ['admin']
    );
    
    if (existing.length > 0) {
      console.log('Admin user already exists, skipping...');
      return;
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash('admin123', 10);
    const openId = `local_admin_${Date.now()}`;
    const now = new Date();
    
    // Create admin user
    await connection.execute(
      `INSERT INTO users (openId, username, passwordHash, name, email, role, isActive, loginMethod, createdAt, updatedAt, lastSignedIn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        openId,
        'admin',
        passwordHash,
        'Administrator',
        'admin@factory.local',
        'admin',
        1,
        'local',
        now,
        now,
        now
      ]
    );
    
    console.log('✅ Admin user created successfully!');
    console.log('   Username: admin');
    console.log('   Password: admin123');
    console.log('   ⚠️  Please change the password after first login!');
    
  } catch (error) {
    console.error('Error seeding admin:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

seedAdmin().catch(console.error);
