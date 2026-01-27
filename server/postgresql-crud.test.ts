import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("PostgreSQL CRUD Tests", () => {
  let pool: Pool;

  beforeAll(async () => {
    const caCertPath = path.join(__dirname, "certs", "prod-ca-2021.crt");
    let sslConfig: any = { rejectUnauthorized: false };
    if (fs.existsSync(caCertPath)) {
      const caCert = fs.readFileSync(caCertPath, "utf8");
      sslConfig = { rejectUnauthorized: true, ca: caCert };
    }
    pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: sslConfig });
  });

  afterAll(async () => { await pool.end(); });

  it("should connect with SSL", async () => {
    const result = await pool.query("SELECT 1 as test");
    expect(result.rows[0].test).toBe(1);
  });

  it("should have 88 tables", async () => {
    const result = await pool.query("SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'");
    expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(80);
  });
});
