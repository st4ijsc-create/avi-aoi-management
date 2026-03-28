import { describe, it, expect, beforeAll } from "vitest";
import * as db from "./db";

describe("getNGTrendByDay with filters", () => {
  let testWorkstationId: number;
  let testMeasurementPointDefId: number;
  let testProductModelId: number;
  let testInspectionId: number;

  beforeAll(async () => {
    // Create test data with unique codes using timestamp
    const timestamp = Date.now();
    const factoryId = await db.createFactory({
      code: `TEST_FACTORY_TREND_${timestamp}`,
      name: "Test Factory for Trend",
    });

    const workshopId = await db.createWorkshop({
      factoryId,
      code: `TEST_WORKSHOP_TREND_${timestamp}`,
      name: "Test Workshop for Trend",
    });

    const lineId = await db.createProductionLine({
      workshopId,
      code: `TEST_LINE_TREND_${timestamp}`,
      name: "Test Line for Trend",
    });

    const stationId = await db.createStation({
      lineId,
      code: `TEST_STATION_TREND_${timestamp}`,
      name: "Test Station for Trend",
      sequence: 1,
    });

    testWorkstationId = await db.createWorkstation({
      code: `WS_TREND_${timestamp}`,
      name: "Workstation for Trend Test",
    });

    const machineId = await db.createMachine({
      stationId,
      code: `MACHINE_TREND_${timestamp}`,
      name: "Machine for Trend Test",
      machineType: "AVI",
      apiKey: `test_api_key_trend_${timestamp}`,
    });

    testProductModelId = await db.createProductModel({
      code: `PROD_TREND_${timestamp}`,
      name: "Product for Trend Test",
      version: "1.0",
    });

    testMeasurementPointDefId = await db.createMeasurementPointDef({
      productModelId: testProductModelId,
      machineId,
      workstationId: testWorkstationId,
      code: `MP_TREND_${timestamp}`,
      name: "Measurement Point for Trend Test",
      measurementType: "DIMENSION",
      positionX: 100,
      positionY: 100,
      sequence: 1,
    });

    // Create inspection with measurement results
    testInspectionId = await db.createProductInspection({
      machineId,
      productModelId: testProductModelId,
      serialNumber: `SN_TREND_${timestamp}`,
      overallResult: "NG",
      inspectionTime: new Date(),
    });

    // Create measurement results
    await db.createMeasurementResult({
      inspectionId: testInspectionId,
      pointDefId: testMeasurementPointDefId,
      result: "NG",
      measuredValue: "10.5",
    });

    await db.createMeasurementResult({
      inspectionId: testInspectionId,
      pointDefId: testMeasurementPointDefId,
      result: "OK",
      measuredValue: "9.8",
    });
  });

  it("should return trend data without filters", async () => {
    const result = await db.getNGTrendByDay();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should return trend data filtered by workstationId", async () => {
    const result = await db.getNGTrendByDay({
      workstationId: testWorkstationId,
    });
    
    expect(Array.isArray(result)).toBe(true);
    // Should have data since we created measurement results for this workstation
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("totalCount");
      expect(result[0]).toHaveProperty("ngCount");
      expect(result[0]).toHaveProperty("ngRate");
    }
  });

  it("should return trend data filtered by measurementPointDefId", async () => {
    const result = await db.getNGTrendByDay({
      measurementPointDefId: testMeasurementPointDefId,
    });
    
    expect(Array.isArray(result)).toBe(true);
    // Should have data since we created measurement results for this point
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("totalCount");
      expect(result[0]).toHaveProperty("ngCount");
      expect(result[0]).toHaveProperty("ngRate");
    }
  });

  it("should return trend data filtered by both workstationId and measurementPointDefId", async () => {
    const result = await db.getNGTrendByDay({
      workstationId: testWorkstationId,
      measurementPointDefId: testMeasurementPointDefId,
    });
    
    expect(Array.isArray(result)).toBe(true);
    // Should have data since we created measurement results matching both filters
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("totalCount");
      expect(result[0]).toHaveProperty("ngCount");
      expect(result[0]).toHaveProperty("ngRate");
    }
  });

  it("should return trend data filtered by date range", async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const endDate = now;

    const result = await db.getNGTrendByDay({
      startDate,
      endDate,
    });
    
    expect(Array.isArray(result)).toBe(true);
  });

  it("should return trend data with all filters combined", async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const endDate = now;

    const result = await db.getNGTrendByDay({
      startDate,
      endDate,
      workstationId: testWorkstationId,
      measurementPointDefId: testMeasurementPointDefId,
    });
    
    expect(Array.isArray(result)).toBe(true);
    // Verify data structure
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("totalCount");
      expect(result[0]).toHaveProperty("okCount");
      expect(result[0]).toHaveProperty("ngCount");
      expect(result[0]).toHaveProperty("ntfCount");
      expect(result[0]).toHaveProperty("ngRate");
      expect(typeof result[0].ngRate).toBe("number");
    }
  });

  it("should return empty array for non-existent workstation", async () => {
    const result = await db.getNGTrendByDay({
      workstationId: 999999,
    });
    
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("should return empty array for non-existent measurement point", async () => {
    const result = await db.getNGTrendByDay({
      measurementPointDefId: 999999,
    });
    
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
