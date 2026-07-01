import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

// V3: Rewritten off the `pg` driver (uninstallable in this sandbox) onto the repo's real
// driver `postgres` (postgres.js). A tiny Pool-compatible shim keeps every test body
// unchanged: `.query(text, params)` returns `{ rows }`, and `$1` positional params +
// RETURNING all work via postgres.js `sql.unsafe(text, params)`.
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

describe('PostgreSQL CRUD Operations', () => {
  let pool: PoolLike;

  beforeAll(async () => {
    pool = makePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Factory CRUD', () => {
    let testFactoryId: number;
    const testFactoryCode = `TEST_FACTORY_${Date.now()}`;

    it('should CREATE a factory', async () => {
      const result = await pool.query(`
        INSERT INTO factories (code, name, address, description, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id
      `, [testFactoryCode, 'Test Factory', 'Test Address', 'Test Description', true]);
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].id).toBeDefined();
      testFactoryId = result.rows[0].id;
    });

    it('should READ the factory', async () => {
      const result = await pool.query(`
        SELECT * FROM factories WHERE id = $1
      `, [testFactoryId]);
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].code).toBe(testFactoryCode);
      expect(result.rows[0].name).toBe('Test Factory');
    });

    it('should UPDATE the factory', async () => {
      await pool.query(`
        UPDATE factories SET name = $1, "updatedAt" = NOW() WHERE id = $2
      `, ['Updated Factory Name', testFactoryId]);
      
      const result = await pool.query(`
        SELECT * FROM factories WHERE id = $1
      `, [testFactoryId]);
      
      expect(result.rows[0].name).toBe('Updated Factory Name');
    });

    it('should DELETE the factory', async () => {
      await pool.query(`
        DELETE FROM factories WHERE id = $1
      `, [testFactoryId]);
      
      const result = await pool.query(`
        SELECT * FROM factories WHERE id = $1
      `, [testFactoryId]);
      
      expect(result.rows.length).toBe(0);
    });
  });

  describe('Workshop CRUD', () => {
    let testWorkshopId: number;
    let testFactoryId: number;
    const testWorkshopCode = `TEST_WS_${Date.now()}`;

    beforeAll(async () => {
      // Create a factory for the workshop
      const result = await pool.query(`
        INSERT INTO factories (code, name, address, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`FACTORY_FOR_WS_${Date.now()}`, 'Factory for Workshop Test', 'Address', true]);
      testFactoryId = result.rows[0].id;
    });

    afterAll(async () => {
      // Cleanup
      await pool.query(`DELETE FROM workshops WHERE id = $1`, [testWorkshopId]);
      await pool.query(`DELETE FROM factories WHERE id = $1`, [testFactoryId]);
    });

    it('should CREATE a workshop', async () => {
      const result = await pool.query(`
        INSERT INTO workshops (code, name, "factoryId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [testWorkshopCode, 'Test Workshop', testFactoryId, true]);
      
      expect(result.rows.length).toBe(1);
      testWorkshopId = result.rows[0].id;
    });

    it('should READ the workshop with factory relation', async () => {
      const result = await pool.query(`
        SELECT w.*, f.name as factory_name
        FROM workshops w
        JOIN factories f ON w."factoryId" = f.id
        WHERE w.id = $1
      `, [testWorkshopId]);
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].code).toBe(testWorkshopCode);
      expect(result.rows[0].factory_name).toBe('Factory for Workshop Test');
    });

    it('should UPDATE the workshop', async () => {
      await pool.query(`
        UPDATE workshops SET name = $1, "updatedAt" = NOW() WHERE id = $2
      `, ['Updated Workshop Name', testWorkshopId]);
      
      const result = await pool.query(`
        SELECT * FROM workshops WHERE id = $1
      `, [testWorkshopId]);
      
      expect(result.rows[0].name).toBe('Updated Workshop Name');
    });
  });

  describe('Production Line CRUD', () => {
    let testLineId: number;
    let testWorkshopId: number;
    let testFactoryId: number;
    const testLineCode = `TEST_LINE_${Date.now()}`;

    beforeAll(async () => {
      // Create factory and workshop
      const factoryResult = await pool.query(`
        INSERT INTO factories (code, name, address, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`FACTORY_FOR_LINE_${Date.now()}`, 'Factory for Line Test', 'Address', true]);
      testFactoryId = factoryResult.rows[0].id;

      const workshopResult = await pool.query(`
        INSERT INTO workshops (code, name, "factoryId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`WS_FOR_LINE_${Date.now()}`, 'Workshop for Line Test', testFactoryId, true]);
      testWorkshopId = workshopResult.rows[0].id;
    });

    afterAll(async () => {
      // Cleanup
      await pool.query(`DELETE FROM production_lines WHERE id = $1`, [testLineId]);
      await pool.query(`DELETE FROM workshops WHERE id = $1`, [testWorkshopId]);
      await pool.query(`DELETE FROM factories WHERE id = $1`, [testFactoryId]);
    });

    it('should CREATE a production line', async () => {
      const result = await pool.query(`
        INSERT INTO production_lines (code, name, "workshopId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [testLineCode, 'Test Production Line', testWorkshopId, true]);
      
      expect(result.rows.length).toBe(1);
      testLineId = result.rows[0].id;
    });

    it('should READ the production line with relations', async () => {
      const result = await pool.query(`
        SELECT pl.*, w.name as workshop_name, f.name as factory_name
        FROM production_lines pl
        JOIN workshops w ON pl."workshopId" = w.id
        JOIN factories f ON w."factoryId" = f.id
        WHERE pl.id = $1
      `, [testLineId]);
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].code).toBe(testLineCode);
      expect(result.rows[0].workshop_name).toBe('Workshop for Line Test');
      expect(result.rows[0].factory_name).toBe('Factory for Line Test');
    });

    it('should UPDATE the production line', async () => {
      await pool.query(`
        UPDATE production_lines SET name = $1, "updatedAt" = NOW() WHERE id = $2
      `, ['Updated Line Name', testLineId]);
      
      const result = await pool.query(`
        SELECT * FROM production_lines WHERE id = $1
      `, [testLineId]);
      
      expect(result.rows[0].name).toBe('Updated Line Name');
    });
  });

  describe('Machine CRUD', () => {
    let testMachineId: number;
    let testStationId: number;
    let testLineId: number;
    let testWorkshopId: number;
    let testFactoryId: number;
    const testMachineCode = `TEST_MACHINE_${Date.now()}`;

    beforeAll(async () => {
      // Create factory, workshop, line, station
      const factoryResult = await pool.query(`
        INSERT INTO factories (code, name, address, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`FACTORY_FOR_MACHINE_${Date.now()}`, 'Factory for Machine Test', 'Address', true]);
      testFactoryId = factoryResult.rows[0].id;

      const workshopResult = await pool.query(`
        INSERT INTO workshops (code, name, "factoryId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`WS_FOR_MACHINE_${Date.now()}`, 'Workshop for Machine Test', testFactoryId, true]);
      testWorkshopId = workshopResult.rows[0].id;

      const lineResult = await pool.query(`
        INSERT INTO production_lines (code, name, "workshopId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`LINE_FOR_MACHINE_${Date.now()}`, 'Line for Machine Test', testWorkshopId, true]);
      testLineId = lineResult.rows[0].id;

      const stationResult = await pool.query(`
        INSERT INTO stations (code, name, "lineId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`STATION_FOR_MACHINE_${Date.now()}`, 'Station for Machine Test', testLineId, true]);
      testStationId = stationResult.rows[0].id;
    });

    afterAll(async () => {
      // Cleanup
      await pool.query(`DELETE FROM machines WHERE id = $1`, [testMachineId]);
      await pool.query(`DELETE FROM stations WHERE id = $1`, [testStationId]);
      await pool.query(`DELETE FROM production_lines WHERE id = $1`, [testLineId]);
      await pool.query(`DELETE FROM workshops WHERE id = $1`, [testWorkshopId]);
      await pool.query(`DELETE FROM factories WHERE id = $1`, [testFactoryId]);
    });

    it('should CREATE a machine', async () => {
      const apiKey = `test_api_key_${Date.now()}`;
      const result = await pool.query(`
        INSERT INTO machines (code, name, "stationId", "machineType", "operationStatus", "apiKey", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id
      `, [testMachineCode, 'Test Machine', testStationId, 'AOI', 'stopped', apiKey, true]);
      
      expect(result.rows.length).toBe(1);
      testMachineId = result.rows[0].id;
    });

    it('should READ the machine with full hierarchy', async () => {
      if (!testMachineId) {
        console.log('Skipping - testMachineId not set');
        return;
      }
      const result = await pool.query(`
        SELECT m.*, s.name as station_name, pl.name as line_name, w.name as workshop_name, f.name as factory_name
        FROM machines m
        JOIN stations s ON m."stationId" = s.id
        JOIN production_lines pl ON s."lineId" = pl.id
        JOIN workshops w ON pl."workshopId" = w.id
        JOIN factories f ON w."factoryId" = f.id
        WHERE m.id = $1
      `, [testMachineId]);
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].code).toBe(testMachineCode);
      expect(result.rows[0].station_name).toBe('Station for Machine Test');
      expect(result.rows[0].line_name).toBe('Line for Machine Test');
      expect(result.rows[0].workshop_name).toBe('Workshop for Machine Test');
      expect(result.rows[0].factory_name).toBe('Factory for Machine Test');
    });

    it('should UPDATE the machine operationStatus', async () => {
      if (!testMachineId) {
        console.log('Skipping - testMachineId not set');
        return;
      }
      await pool.query(`
        UPDATE machines SET "operationStatus" = $1, "updatedAt" = NOW() WHERE id = $2
      `, ['running', testMachineId]);
      
      const result = await pool.query(`
        SELECT * FROM machines WHERE id = $1
      `, [testMachineId]);
      
      expect(result.rows[0].operationStatus).toBe('running');
    });

    it('should UPDATE the machine with API key', async () => {
      if (!testMachineId) {
        console.log('Skipping - testMachineId not set');
        return;
      }
      const apiKey = `api_key_${Date.now()}`;
      await pool.query(`
        UPDATE machines SET "apiKey" = $1, "updatedAt" = NOW() WHERE id = $2
      `, [apiKey, testMachineId]);
      
      const result = await pool.query(`
        SELECT * FROM machines WHERE id = $1
      `, [testMachineId]);
      
      expect(result.rows[0].apiKey).toBe(apiKey);
    });
  });

  describe('Product Inspection CRUD', () => {
    let testInspectionId: number;
    let testMachineId: number;
    let testStationId: number;
    let testLineId: number;
    let testWorkshopId: number;
    let testFactoryId: number;

    beforeAll(async () => {
      // Create full hierarchy
      const factoryResult = await pool.query(`
        INSERT INTO factories (code, name, address, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`FACTORY_FOR_INSP_${Date.now()}`, 'Factory for Inspection Test', 'Address', true]);
      testFactoryId = factoryResult.rows[0].id;

      const workshopResult = await pool.query(`
        INSERT INTO workshops (code, name, "factoryId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`WS_FOR_INSP_${Date.now()}`, 'Workshop for Inspection Test', testFactoryId, true]);
      testWorkshopId = workshopResult.rows[0].id;

      const lineResult = await pool.query(`
        INSERT INTO production_lines (code, name, "workshopId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`LINE_FOR_INSP_${Date.now()}`, 'Line for Inspection Test', testWorkshopId, true]);
      testLineId = lineResult.rows[0].id;

      const stationResult = await pool.query(`
        INSERT INTO stations (code, name, "lineId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`STATION_FOR_INSP_${Date.now()}`, 'Station for Inspection Test', testLineId, true]);
      testStationId = stationResult.rows[0].id;

      const machineResult = await pool.query(`
        INSERT INTO machines (code, name, "stationId", "machineType", "operationStatus", "apiKey", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id
      `, [`MACHINE_FOR_INSP_${Date.now()}`, 'Machine for Inspection Test', testStationId, 'AOI', 'running', `api_insp_${Date.now()}`, true]);
      testMachineId = machineResult.rows[0].id;
    });

    afterAll(async () => {
      // Cleanup
      await pool.query(`DELETE FROM product_inspections WHERE id = $1`, [testInspectionId]);
      await pool.query(`DELETE FROM machines WHERE id = $1`, [testMachineId]);
      await pool.query(`DELETE FROM stations WHERE id = $1`, [testStationId]);
      await pool.query(`DELETE FROM production_lines WHERE id = $1`, [testLineId]);
      await pool.query(`DELETE FROM workshops WHERE id = $1`, [testWorkshopId]);
      await pool.query(`DELETE FROM factories WHERE id = $1`, [testFactoryId]);
    });

    it('should CREATE a product inspection', async () => {
      const result = await pool.query(`
        INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "createdAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [testMachineId, `SN_${Date.now()}`, 'OK', 'OK']);
      
      expect(result.rows.length).toBe(1);
      testInspectionId = result.rows[0].id;
    });

    it('should READ the product inspection', async () => {
      if (!testInspectionId) {
        console.log('Skipping - testInspectionId not set');
        return;
      }
      const result = await pool.query(`
        SELECT pi.*, m.name as machine_name
        FROM product_inspections pi
        JOIN machines m ON pi."machineId" = m.id
        WHERE pi.id = $1
      `, [testInspectionId]);
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].overallResult).toBe('OK');
      expect(result.rows[0].machine_name).toBe('Machine for Inspection Test');
    });

    it('should UPDATE the product inspection result', async () => {
      if (!testInspectionId) {
        console.log('Skipping - testInspectionId not set');
        return;
      }
      await pool.query(`
        UPDATE product_inspections SET "overallResult" = $1 WHERE id = $2
      `, ['NG', testInspectionId]);
      
      const result = await pool.query(`
        SELECT * FROM product_inspections WHERE id = $1
      `, [testInspectionId]);
      
      expect(result.rows[0].overallResult).toBe('NG');
    });
  });

  describe('PostgreSQL Specific Features', () => {
    it('should support RETURNING clause', async () => {
      const result = await pool.query(`
        INSERT INTO factories (code, name, address, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id, code, name
      `, [`RETURNING_TEST_${Date.now()}`, 'Returning Test Factory', 'Address', true]);
      
      expect(result.rows[0].id).toBeDefined();
      expect(result.rows[0].code).toContain('RETURNING_TEST');
      expect(result.rows[0].name).toBe('Returning Test Factory');
      
      // Cleanup
      await pool.query(`DELETE FROM factories WHERE id = $1`, [result.rows[0].id]);
    });

    it('should support ON CONFLICT DO UPDATE (upsert)', async () => {
      const code = `UPSERT_TEST_${Date.now()}`;
      
      // First insert
      await pool.query(`
        INSERT INTO factories (code, name, address, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, "updatedAt" = NOW()
        RETURNING id
      `, [code, 'Original Name', 'Address', true]);
      
      // Upsert with same code
      const result = await pool.query(`
        INSERT INTO factories (code, name, address, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, "updatedAt" = NOW()
        RETURNING id, name
      `, [code, 'Updated Name', 'Address', true]);
      
      expect(result.rows[0].name).toBe('Updated Name');
      
      // Cleanup
      await pool.query(`DELETE FROM factories WHERE id = $1`, [result.rows[0].id]);
    });

    it('should support JSON/JSONB operations', async () => {
      // Test with factory_layouts which has jsonb column
      const factoryResult = await pool.query(`
        INSERT INTO factories (code, name, address, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id
      `, [`JSON_TEST_${Date.now()}`, 'JSON Test Factory', 'Address', true]);
      
      const factoryId = factoryResult.rows[0].id;
      
      const layoutData = {
        width: 1000,
        height: 800,
        elements: [
          { type: 'machine', x: 100, y: 100 },
          { type: 'conveyor', x: 200, y: 200 }
        ]
      };
      
      const layoutResult = await pool.query(`
        INSERT INTO factory_layouts ("factoryId", name, "layoutData", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id, "layoutData"
      `, [factoryId, 'Test Layout', JSON.stringify(layoutData)]);
      
      expect(layoutResult.rows[0].layoutData).toBeDefined();
      
      // Cleanup
      await pool.query(`DELETE FROM factory_layouts WHERE id = $1`, [layoutResult.rows[0].id]);
      await pool.query(`DELETE FROM factories WHERE id = $1`, [factoryId]);
    });
  });
});
