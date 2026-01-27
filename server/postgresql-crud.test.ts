import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('PostgreSQL CRUD Tests with SSL Certificate', () => {
  let pool: Pool;

  beforeAll(async () => {
    const caCertPath = path.join(__dirname, 'certs', 'prod-ca-2021.crt');
    let sslConfig: any = { rejectUnauthorized: false };
    
    if (fs.existsSync(caCertPath)) {
      const caCert = fs.readFileSync(caCertPath, 'utf8');
      sslConfig = { rejectUnauthorized: true, ca: caCert };
    }
    
    pool = new Pool({
      connectionString: process.env.SUPABASE_DATABASE_URL,
      ssl: sslConfig
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('SSL Certificate Connection', () => {
    it('should connect to database with SSL', async () => {
      const result = await pool.query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
    });

    it('should verify SSL certificate is loaded', async () => {
      const caCertPath = path.join(__dirname, 'certs', 'prod-ca-2021.crt');
      expect(fs.existsSync(caCertPath)).toBe(true);
    });
  });

  describe('Database Tables', () => {
    it('should have tables created', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(50);
    });

    it('should have factories table', async () => {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'factories'
        )
      `);
      expect(result.rows[0].exists).toBe(true);
    });
  });

  describe('CRUD Operations - Factories', () => {
    let testFactoryId: number;

    it('should INSERT a factory', async () => {
      const result = await pool.query(`
        INSERT INTO factories (name, code, address, "isActive", "createdAt", "updatedAt")
        VALUES ('Test Factory CRUD', 'TEST-CRUD-001', 'Test Address', true, NOW(), NOW())
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `);
      testFactoryId = result.rows[0].id;
      expect(testFactoryId).toBeDefined();
    });

    it('should SELECT the factory', async () => {
      const result = await pool.query(`
        SELECT * FROM factories WHERE id = $1
      `, [testFactoryId]);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].name).toBe('Test Factory CRUD');
    });

    it('should UPDATE the factory', async () => {
      await pool.query(`
        UPDATE factories SET name = $1, "updatedAt" = NOW() WHERE id = $2
      `, ['Updated Factory Name', testFactoryId]);
      
      const result = await pool.query(`
        SELECT name FROM factories WHERE id = $1
      `, [testFactoryId]);
      expect(result.rows[0].name).toBe('Updated Factory Name');
    });

    it('should soft DELETE the factory', async () => {
      await pool.query(`
        UPDATE factories SET "isActive" = false WHERE id = $1
      `, [testFactoryId]);
      
      const result = await pool.query(`
        SELECT "isActive" FROM factories WHERE id = $1
      `, [testFactoryId]);
      expect(result.rows[0].isActive).toBe(false);
    });
  });
});
