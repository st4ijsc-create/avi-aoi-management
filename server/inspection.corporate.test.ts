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

  /**
   * ★★★ 2026-08-18 — **HAI CA TRONG KHỐI NÀY TỪNG ĐÓNG DẤU CHÍNH CÁI LỖ.**
   *
   * Bản cũ khẳng định, nguyên văn:
   *   • máy thuộc nhà máy `TEST_CORP_FAC_*` khai `factoryCode: 'FAC-HN'` ⇒ hàng ghi **'FAC-HN'**;
   *   • máy không khai gì ⇒ hàng ghi **NULL/NULL**, và gọi đó là *"backward compatibility"*.
   *
   * Cả hai đều là hình dạng ĐÚNG của lỗ: (1) lời tự khai quyết định bản ghi kiểm rơi vào phạm vi
   * xem của nhà máy nào (`getAccessFilterConditions` lọc `factoryCode IN (…)`), và (2) hàng
   * NULL/NULL rơi ra ngoài **cả hai** vế của phép lọc ⇒ biến mất khỏi mọi báo cáo bị thu hẹp.
   * Một lưới khẳng định hành vi ấy không phải là lưới — nó là **giấy chứng nhận** cho cái lỗ.
   *
   * Từ lượt này, mã tenant SUY từ chuỗi `machine → station → line → workshop → factory`; JSON chỉ
   * còn là lời khai để ĐỐI CHIẾU. Ba ca dưới đây đo đúng luật mới, giữ nguyên chiều DƯƠNG (máy
   * khai đúng vẫn nộp được) để một bản vá "từ chối tất" không thể lọt.
   */
  describe('submitInspection — mã tenant SUY TỪ MÁY, không lấy từ JSON', () => {
    it('★★★ khai mã của nhà máy KHÁC ⇒ TỪ CHỐI (trước đây: ghi thẳng lời khai vào cột)', async () => {
      const caller = appRouter.createCaller({ user: null });
      const machine = await db.getMachineById(testMachineId);
      if (!machine) throw new Error('Machine not found');

      await expect(
        caller.machineApi.submitInspection({
          apiKey: machine.apiKey,
          serialNumber: 'SN-CORP-001',
          productModel: 'MODEL-A',
          batchNumber: 'BATCH-001',
          overallResult: 'OK',
          companyCode: 'CORP-VN',
          factoryCode: 'FAC-HN', // ← nhà máy của máy này KHÔNG phải 'FAC-HN'
          measurements: [],
        }),
      ).rejects.toThrow(/machine_tenant_claim_mismatch/);
    });

    it('★★★ KHÔNG khai mã nào ⇒ vẫn NHẬN, và hàng mang mã SUY RA (trước đây: NULL/NULL)', async () => {
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
      testInspectionId = result.inspectionId!;

      const inspection = await db.getProductInspectionById(result.inspectionId!);
      expect(inspection).toBeDefined();
      const factory = await db.getFactoryById(testFactoryId);
      expect(inspection?.factoryCode).toBe(factory?.code);
      // Nhà máy dựng ở `beforeAll` không có mã tập đoàn ⇒ cột đúng là NULL (chuỗi phân cấp nói thế),
      // KHÔNG phải vì lời khai bị bỏ qua.
      expect(inspection?.corporateCode).toBeNull();
    });

    it('CHIỀU DƯƠNG — máy khai ĐÚNG mã nhà máy của chính nó ⇒ VẪN nộp được (chống vá quá tay)', async () => {
      const caller = appRouter.createCaller({ user: null });
      const machine = await db.getMachineById(testMachineId);
      if (!machine) throw new Error('Machine not found');
      const factory = await db.getFactoryById(testFactoryId);

      const result = await caller.machineApi.submitInspection({
        apiKey: machine.apiKey,
        serialNumber: 'SN-CORP-OK-001',
        productModel: 'MODEL-A',
        overallResult: 'OK',
        factoryCode: factory?.code,
        measurements: [],
      });

      expect(result.success).toBe(true);
      const inspection = await db.getProductInspectionById(result.inspectionId!);
      expect(inspection?.factoryCode).toBe(factory?.code);
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
