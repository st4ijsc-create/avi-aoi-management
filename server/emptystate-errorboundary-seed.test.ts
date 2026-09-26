import { describe, it, expect, vi } from "vitest";
import * as db from "./db";

// Mock database functions
vi.mock("./db", async () => {
  const actual = await vi.importActual("./db");
  return {
    ...actual,
    getDb: vi.fn(),
  };
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
});
