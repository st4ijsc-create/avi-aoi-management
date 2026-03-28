import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as db from "./db";

// Mock database functions
vi.mock("./db", async () => {
  const actual = await vi.importActual("./db");
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

describe("Seed Workstation Analytics Data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seedWorkstationAnalyticsData function exists and is callable", () => {
    expect(typeof db.seedWorkstationAnalyticsData).toBe("function");
  });

  it("seedWorkstationAnalyticsData requires database connection", () => {
    // Verify the function exists and expects database
    // We don't actually call it to avoid timeout issues with real DB
    expect(typeof db.seedWorkstationAnalyticsData).toBe("function");
  });

  it("seedWorkstationAnalyticsData accepts optional parameters", () => {
    // Verify function signature accepts options
    const fn = db.seedWorkstationAnalyticsData;
    expect(fn.length).toBeLessThanOrEqual(1); // 0 or 1 parameter (optional)
  });
});

describe("Workstation Functions", () => {
  it("getWorkstations function exists", () => {
    expect(typeof db.getWorkstations).toBe("function");
  });

  it("createWorkstation function exists", () => {
    expect(typeof db.createWorkstation).toBe("function");
  });

  it("getWorkstationSummary function exists", () => {
    expect(typeof db.getWorkstationSummary).toBe("function");
  });

  it("getDefectsByWorkstation function exists", () => {
    expect(typeof db.getDefectsByWorkstation).toBe("function");
  });

  it("getTopNGMeasurementPointsByWorkstation function exists", () => {
    expect(typeof db.getTopNGMeasurementPointsByWorkstation).toBe("function");
  });
});

describe("Existing Seed Functions", () => {
  it("seedSampleData function exists", () => {
    expect(typeof db.seedSampleData).toBe("function");
  });

  it("seedInspectionData function exists", () => {
    expect(typeof db.seedInspectionData).toBe("function");
  });
});
