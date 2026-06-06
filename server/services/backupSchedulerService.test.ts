/**
 * Unit tests for Backup Scheduler — cron expression generation
 */
import { describe, it, expect } from "vitest";
import { scheduleToCron, computeNextRun } from "./backupSchedulerService";

describe("scheduleToCron", () => {
  it("DAILY at 02:30 → '30 2 * * *'", () => {
    expect(scheduleToCron({ schedule: "DAILY", scheduleTime: "02:30" })).toBe("30 2 * * *");
  });

  it("WEEKLY on Sunday at 03:00 → '0 3 * * 0'", () => {
    expect(scheduleToCron({
      schedule: "WEEKLY", scheduleTime: "03:00", scheduleDayOfWeek: 0,
    })).toBe("0 3 * * 0");
  });

  it("MONTHLY on day 15 at 04:15 → '15 4 15 * *'", () => {
    expect(scheduleToCron({
      schedule: "MONTHLY", scheduleTime: "04:15", scheduleDayOfMonth: 15,
    })).toBe("15 4 15 * *");
  });

  it("HOURLY at minute 7 → '7 * * * *'", () => {
    expect(scheduleToCron({ schedule: "HOURLY", scheduleTime: "00:07" })).toBe("7 * * * *");
  });

  it("defaults to DAILY when schedule unknown", () => {
    expect(scheduleToCron({ schedule: "BOGUS", scheduleTime: "05:00" })).toBe("0 5 * * *");
  });

  it("defaults scheduleTime to 02:00 when missing", () => {
    expect(scheduleToCron({ schedule: "DAILY", scheduleTime: "" })).toBe("0 2 * * *");
  });
});

describe("computeNextRun", () => {
  it("DAILY → returns a future Date", () => {
    const next = computeNextRun({ schedule: "DAILY", scheduleTime: "02:00" });
    expect(next.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("WEEKLY targets specified day of week", () => {
    const next = computeNextRun({
      schedule: "WEEKLY", scheduleTime: "03:00", scheduleDayOfWeek: 3,
    });
    expect(next.getDay()).toBe(3);
  });

  it("MONTHLY targets specified day of month", () => {
    const next = computeNextRun({
      schedule: "MONTHLY", scheduleTime: "04:00", scheduleDayOfMonth: 10,
    });
    expect(next.getDate()).toBe(10);
  });
});
