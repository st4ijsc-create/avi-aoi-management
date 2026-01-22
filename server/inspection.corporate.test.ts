import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { appRouter } from './routers';
import * as db from './db';

describe('Inspection API with Corporate/Factory Codes', () => {
  let testMachineId: number;
  let testInspectionId: number;
  let testFactoryId: number;
  let testWorkshopId: number;
  let testLineId: number;
  let testStationId: number;

  beforeAll(async () => {
    const timestamp = Date.now();
    // Create test factory
    testFactoryId = await db.createFactory({
      code: `TEST_CORP_FAC_${timestamp}`,
      name: 'Test Corporate Factory',
      isActive: true,
    });
    const factoryId = testFactoryId;

    // Create test workshop
    testWorkshopId = await db.createWorkshop({
      factoryId,
      code: `WS_TEST_${timestamp}`,
      name: 'Test Workshop',
      isActive: true,
    });

    // Create test line
    testLineId = await db.createProductionLine({
      workshopId: testWorkshopId,
      code: `LINE_TEST_${timestamp}`,
      name: 'Test Line',
      isActive: true,
    });

    // Create test station
    testStationId = await db.createStation({
      lineId: testLineId,
      code: `ST_TEST_${timestamp}`,
      name: 'Test Station',
      isActive: true,
    });

    // Create test machine
    testMachineId = await db.createMachine({
      stationId: testStationId,
      code: `MCH_TEST_${timestamp}`,
      name: 'Test Machine',
      machineType: 'AVI',
      apiKey: `TEST_API_KEY_${timestamp}`,
      isActive: true,
    });
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      if (testMachineId) await db.deleteMachine(testMachineId);
      if (testStationId) await db.deleteStation(testStationId);
      if (testLineId) await db.deleteProductionLine(testLineId);
      if (testWorkshopId) await db.deleteWorkshop(testWorkshopId);
      if (testFactoryId) await db.deleteFactory(testFactoryId);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('submitInspection with corporate/factory codes', () => {
    it('should create inspection with corporateCode and factoryCode', async () => {
      const caller = appRouter.createCaller({ user: null });
      
      const machine = await db.getMachineById(testMachineId);
      if (!machine) throw new Error('Machine not found');

      const result = await caller.machineApi.submitInspection({
        apiKey: machine.apiKey,
        serialNumber: 'SN-CORP-001',
        productModel: 'MODEL-A',
        batchNumber: 'BATCH-001',
        overallResult: 'OK',
        companyCode: 'CORP-VN',
        factoryCode: 'FAC-HN',
        measurements: [],
      });

      expect(result.success).toBe(true);
      expect(result.inspectionId).toBeDefined();
      
      testInspectionId = result.inspectionId!;

      // Verify inspection has corporate/factory codes
      const inspection = await db.getProductInspectionById(testInspectionId);
      expect(inspection).toBeDefined();
      expect(inspection?.corporateCode).toBe('CORP-VN');
      expect(inspection?.factoryCode).toBe('FAC-HN');
    });

    it('should create inspection without corporate/factory codes (backward compatibility)', async () => {
      const caller = appRouter.createCaller({ user: null });
      
      const machine = await db.getMachineById(testMachineId);
      if (!machine) throw new Error('Machine not found');

      const result = await caller.machineApi.submitInspection({
        apiKey: machine.apiKey,
        serialNumber: 'SN-NO-CORP-001',
        productModel: 'MODEL-B',
        overallResult: 'NG',
        measurements: [],
      });

      expect(result.success).toBe(true);
      expect(result.inspectionId).toBeDefined();

      // Verify inspection has null corporate/factory codes
      const inspection = await db.getProductInspectionById(result.inspectionId!);
      expect(inspection).toBeDefined();
      expect(inspection?.corporateCode).toBeNull();
      expect(inspection?.factoryCode).toBeNull();
    });
  });

  describe.skip('getProductInspections with corporate/factory filters', () => {
    it('should filter inspections by corporateCode', async () => {
      const result = await db.getProductInspections({
        corporateCode: 'CORP-VN',
        limit: 100,
      });

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every(i => i.corporateCode === 'CORP-VN')).toBe(true);
    });

    it('should filter inspections by factoryCode', async () => {
      const result = await db.getProductInspections({
        factoryCode: 'FAC-HN',
        limit: 100,
      });

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every(i => i.factoryCode === 'FAC-HN')).toBe(true);
    });

    it('should filter inspections by both corporateCode and factoryCode', async () => {
      const result = await db.getProductInspections({
        corporateCode: 'CORP-VN',
        factoryCode: 'FAC-HN',
        limit: 100,
      });

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every(i => 
        i.corporateCode === 'CORP-VN' && i.factoryCode === 'FAC-HN'
      )).toBe(true);
    });

    it('should return empty when filtering non-existent corporateCode', async () => {
      const result = await db.getProductInspections({
        corporateCode: 'NON-EXISTENT',
        limit: 100,
      });

      expect(result.data.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe.skip('inspection list API with corporate/factory filters', () => {
    it('should list inspections filtered by corporateCode via tRPC', async () => {
      const mockUser = { id: 1, role: 'admin' as const };
      const caller = appRouter.createCaller({ user: mockUser });

      const result = await caller.inspection.list({
        corporateCode: 'CORP-VN',
        limit: 100,
      });

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every(i => i.corporateCode === 'CORP-VN')).toBe(true);
    });

    it('should list inspections filtered by factoryCode via tRPC', async () => {
      const mockUser = { id: 1, role: 'admin' as const };
      const caller = appRouter.createCaller({ user: mockUser });

      const result = await caller.inspection.list({
        factoryCode: 'FAC-HN',
        limit: 100,
      });

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every(i => i.factoryCode === 'FAC-HN')).toBe(true);
    });

    it('should combine corporate/factory filters with other filters', async () => {
      const mockUser = { id: 1, role: 'admin' as const };
      const caller = appRouter.createCaller({ user: mockUser });

      const result = await caller.inspection.list({
        corporateCode: 'CORP-VN',
        factoryCode: 'FAC-HN',
        result: 'OK',
        limit: 100,
      });

      expect(result.data.every(i => 
        i.corporateCode === 'CORP-VN' && 
        i.factoryCode === 'FAC-HN' &&
        i.overallResult === 'OK'
      )).toBe(true);
    });
  });
});
