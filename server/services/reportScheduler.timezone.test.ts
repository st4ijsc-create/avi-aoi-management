/**
 * Doc 27 §6 gap A1 (P0) — every cron.schedule in reportScheduler.ts must pass
 * { timezone } anchored to the factory timezone (FACTORY_TZ, default
 * Asia/Ho_Chi_Minh). Before the fix, user scheduled-report crons fired in the
 * server/OS timezone (the +7h manual-data-patch incident — doc 27 §6 A1)
 * while only the executive-report path passed a timezone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => {
  const schedule = vi.fn(() => ({ stop: vi.fn() }));
  return { default: { schedule }, schedule };
});

vi.mock("../db", () => ({
  getScheduledReports: vi.fn(),
  getScheduledReportById: vi.fn(),
  updateScheduledReport: vi.fn(),
  createScheduledReportLog: vi.fn(),
  getSmtpConfig: vi.fn(),
}));

vi.mock("../_core/email", () => ({
  sendEmail: vi.fn(),
  createTransporterFromConfig: vi.fn(),
}));

vi.mock("./reportGenerator", () => ({
  generateNGVisualReport: vi.fn(),
  generateNGVisualEmailHTML: vi.fn(),
  generateReport: vi.fn(),
}));

import cron from "node-cron";
import { scheduleReport, stopScheduledReport } from "./reportScheduler";

const scheduleMock = vi.mocked(cron.schedule);

describe("scheduleReport — user scheduled reports carry the factory timezone", () => {
  beforeEach(() => {
    scheduleMock.mockClear();
    vi.stubEnv("FACTORY_TZ", ""); // force default
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("DAILY report passes { timezone: 'Asia/Ho_Chi_Minh' } by default", () => {
    scheduleReport({ id: 9101, schedule: "DAILY", scheduleTime: "06:00" });
    expect(scheduleMock).toHaveBeenCalledWith(
      "0 0 6 * * *",
      expect.any(Function),
      { timezone: "Asia/Ho_Chi_Minh" },
    );
    stopScheduledReport(9101);
  });

  it("WEEKLY report keeps its cron expression and honors FACTORY_TZ", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Tokyo");
    scheduleReport({ id: 9102, schedule: "WEEKLY", scheduleTime: "09:30", scheduleDayOfWeek: 1 });
    expect(scheduleMock).toHaveBeenCalledWith(
      "0 30 9 * * 1",
      expect.any(Function),
      { timezone: "Asia/Tokyo" },
    );
    stopScheduledReport(9102);
  });

  it("MONTHLY report passes the timezone too", () => {
    scheduleReport({ id: 9103, schedule: "MONTHLY", scheduleTime: "07:15", scheduleDayOfMonth: 15 });
    expect(scheduleMock).toHaveBeenCalledWith(
      "0 15 7 15 * *",
      expect.any(Function),
      { timezone: "Asia/Ho_Chi_Minh" },
    );
    stopScheduledReport(9103);
  });

  it("invalid FACTORY_TZ falls back to Asia/Ho_Chi_Minh instead of server TZ", () => {
    vi.stubEnv("FACTORY_TZ", "Not/AZone");
    scheduleReport({ id: 9104, schedule: "DAILY", scheduleTime: "06:00" });
    expect(scheduleMock).toHaveBeenCalledWith(
      "0 0 6 * * *",
      expect.any(Function),
      { timezone: "Asia/Ho_Chi_Minh" },
    );
    stopScheduledReport(9104);
  });
});

describe("executive-report scheduler — same timezone convention (EXEC_REPORT_TZ override)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function freshSchedulerWithEnv(env: Record<string, string>) {
    vi.resetModules();
    vi.stubEnv("EXEC_REPORT_ENABLED", "true");
    vi.stubEnv("EXEC_REPORT_SCHEDULE", "day");
    vi.stubEnv("FACTORY_TZ", "");
    vi.stubEnv("EXEC_REPORT_TZ", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    // Re-import AFTER stubbing: EXEC_REPORT_ENABLED is read at module load.
    const cronMod = (await import("node-cron")).default;
    const mod = await import("./reportScheduler");
    return { cronMod, mod };
  }

  it("defaults to the shared factory timezone when EXEC_REPORT_TZ is unset", async () => {
    const { cronMod, mod } = await freshSchedulerWithEnv({});
    mod.startExecutiveReportScheduler();
    expect(cronMod.schedule).toHaveBeenCalledWith(
      "0 5 6 * * *", // default day cron
      expect.any(Function),
      { timezone: "Asia/Ho_Chi_Minh" },
    );
    mod.stopExecutiveReportScheduler();
  });

  it("follows FACTORY_TZ when no explicit EXEC_REPORT_TZ is set", async () => {
    const { cronMod, mod } = await freshSchedulerWithEnv({ FACTORY_TZ: "Asia/Bangkok" });
    mod.startExecutiveReportScheduler();
    expect(cronMod.schedule).toHaveBeenCalledWith(
      "0 5 6 * * *",
      expect.any(Function),
      { timezone: "Asia/Bangkok" },
    );
    mod.stopExecutiveReportScheduler();
  });

  it("EXEC_REPORT_TZ overrides the factory timezone", async () => {
    const { cronMod, mod } = await freshSchedulerWithEnv({
      FACTORY_TZ: "Asia/Tokyo",
      EXEC_REPORT_TZ: "America/Chicago",
    });
    mod.startExecutiveReportScheduler();
    expect(cronMod.schedule).toHaveBeenCalledWith(
      "0 5 6 * * *",
      expect.any(Function),
      { timezone: "America/Chicago" },
    );
    mod.stopExecutiveReportScheduler();
  });

  it("invalid EXEC_REPORT_TZ falls back to the factory timezone", async () => {
    const { cronMod, mod } = await freshSchedulerWithEnv({
      FACTORY_TZ: "Asia/Tokyo",
      EXEC_REPORT_TZ: "Bad/Zone",
    });
    mod.startExecutiveReportScheduler();
    expect(cronMod.schedule).toHaveBeenCalledWith(
      "0 5 6 * * *",
      expect.any(Function),
      { timezone: "Asia/Tokyo" },
    );
    mod.stopExecutiveReportScheduler();
  });
});
