import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

// V3: Rewritten off the `pg` driver (uninstallable in this sandbox) onto the repo's real
// driver `postgres` (postgres.js). A tiny Pool-compatible shim keeps the test bodies
// unchanged: `.query(text, params)` returns `{ rows }` with `$1` params + RETURNING.
// SSL is driven from the DATABASE_URL (sslmode / pg's `ssl` search param) exactly as the
// app does, so no separate `pg` SSL config object is needed.
interface PoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
}

function makePool(): PoolLike {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 30,
  });
  return {
    async query(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as any[]);
      return { rows: rows as unknown as any[] };
    },
    async end() {
      await sql.end({ timeout: 5 });
    },
  };
}

describe('PostgreSQL CRUD Tests', () => {
  let pool: PoolLike;

  beforeAll(async () => {
    pool = makePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Connection', () => {
    it('should connect to the database', async () => {
      const result = await pool.query('SELECT 1 as test');
      expect(Number(result.rows[0].test)).toBe(1);
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
