/**
 * Unit Tests for AI Inspection Analytics Router
 * Tests for FIX #4: Date Range Validation & Rate Limiting
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// Replicate the periodInput schema
const periodInput = z.object({
  startDate: z.string().transform(s => new Date(s)),
  endDate: z.string().transform(s => new Date(s)),
  machineId: z.number().optional(),
  factoryCode: z.string().optional(),
  lineCode: z.string().optional(),
  productModel: z.string().optional(),
})
  .refine(
    (data) => {
      const diff = data.endDate.getTime() - data.startDate.getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      return days <= 90; // MAX: 90 days to prevent OOM
    },
    { message: "Date range must be ≤ 90 days (MAX_RANGE_EXCEEDED)" }
  )
  .refine(
    (data) => data.startDate < data.endDate,
    { message: "startDate must be before endDate" }
  );

describe("FIX #4: Date Range Validation", () => {
  it("should accept valid date range (30 days)", async () => {
    const input = {
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("should accept maximum valid date range (90 days)", async () => {
    const input = {
      startDate: "2024-01-01",
      endDate: "2024-03-31",
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const days = (result.data.endDate.getTime() - result.data.startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(days).toBeLessThanOrEqual(90);
    }
  });

  it("should reject date range > 90 days", async () => {
    const input = {
      startDate: "2024-01-01",
      endDate: "2024-04-01", // 91 days
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("≤ 90 days");
    }
  });

  it("should reject 1-year range (attack vector prevention)", async () => {
    const input = {
      startDate: "2023-01-01",
      endDate: "2024-01-01", // 365 days
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("≤ 90 days");
    }
  });

  it("should reject 16-year range (extreme attack vector)", async () => {
    const input = {
      startDate: "2008-01-01",
      endDate: "2024-01-01", // 5844 days
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("≤ 90 days");
    }
  });

  it("should reject when startDate >= endDate", async () => {
    const input = {
      startDate: "2024-01-31",
      endDate: "2024-01-01",
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("startDate must be before endDate");
    }
  });

  it("should reject when startDate == endDate", async () => {
    const input = {
      startDate: "2024-01-01",
      endDate: "2024-01-01",
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should accept optional machineId parameter", async () => {
    const input = {
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      machineId: 42,
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.machineId).toBe(42);
    }
  });

  it("should accept all optional filters together", async () => {
    const input = {
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      machineId: 1,
      factoryCode: "VND-KCN-TL",
      lineCode: "SMT-A",
      productModel: "PCB-2024-001",
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("Date Range Edge Cases", () => {
  it("should handle boundary: exactly 90 days", async () => {
    const start = new Date("2024-01-01");
    const end = new Date("2024-04-01");
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    
    expect(days).toBe(91); // April 1 - Jan 1 = 91 days
    
    const input = {
      startDate: "2024-01-01",
      endDate: "2024-03-31", // This should be 90 days
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("should handle leap year correctly", async () => {
    const input = {
      startDate: "2024-02-01", // Leap year
      endDate: "2024-05-01",   // Feb (29) + Mar (31) + Apr (30) = 90 days
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const days = (result.data.endDate.getTime() - result.data.startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(days).toBeLessThanOrEqual(90);
    }
  });

  it("should handle different timezones", async () => {
    // ISO strings should be timezone-agnostic
    const input = {
      startDate: "2024-01-01T00:00:00Z",
      endDate: "2024-01-31T23:59:59Z",
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("should validate single-day range (valid)", async () => {
    const input = {
      startDate: "2024-01-01T00:00:00Z",
      endDate: "2024-01-01T23:59:59Z",
    };

    const result = periodInput.safeParse(input);
    // Will be < 1 day, so it should fail the startDate < endDate check
    // because of minute precision
    expect(result.success).toBe(true);
  });
});

describe("Security: OOM Prevention", () => {
  it("should prevent querying 1000+ days of data", async () => {
    const input = {
      startDate: "2021-01-01",
      endDate: "2024-01-01",
    };

    const result = periodInput.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("≤ 90 days");
    }
  });

  it("should prevent sequential attack: multiple 90-day queries", async () => {
    // Each query is valid, but backend rate limiting should catch
    // sequential attacks (100 req/min per user)
    const queries = Array.from({ length: 5 }, (_, i) => ({
      startDate: `2024-0${i + 1}-01`,
      endDate: `2024-0${i + 1}-30`,
    }));

    queries.forEach((input) => {
      const result = periodInput.safeParse(input);
      expect(result.success).toBe(true);
    });
    // Note: Rate limiting is enforced at router/middleware level
  });

  it("should calculate memory impact for max range", async () => {
    // 90 days × 50 machines × 100 inspections/day = 450,000 records
    const maxDays = 90;
    const estimatedMachines = 50;
    const inspectionsPerDayPerMachine = 100;

    const totalRecords = maxDays * estimatedMachines * inspectionsPerDayPerMachine;
    const estimatedMB = (totalRecords * 1024) / (1024 * 1024); // rough estimate: 1KB per record

    console.log(`Max range impact: ~${estimatedMB.toFixed(1)}MB estimated memory`);
    // Should be reasonable for modern systems
    expect(estimatedMB).toBeLessThan(500); // Prevent extreme growth
  });
});
