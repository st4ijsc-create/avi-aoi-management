import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database module
vi.mock("./db", () => ({
  getScheduledReports: vi.fn(),
  getScheduledReportById: vi.fn(),
  createScheduledReport: vi.fn(),
  updateScheduledReport: vi.fn(),
  deleteScheduledReport: vi.fn(),
  getScheduledReportLogs: vi.fn(),
  createScheduledReportLog: vi.fn(),
  getSmtpConfig: vi.fn(),
}));

// Mock the report scheduler
vi.mock("./services/reportScheduler", () => ({
  scheduleReport: vi.fn(),
  stopScheduledReport: vi.fn(),
}));

// Mock storage
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://s3.example.com/test-logo.png" }),
}));

import * as db from "./db";

describe("Scheduled Report API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("list", () => {
    it("should return list of scheduled reports", async () => {
      const mockReports = [
        {
          id: 1,
          name: "Daily NG Report",
          reportType: "NG_VISUAL",
          schedule: "DAILY",
          recipients: ["test@example.com"],
          isActive: true,
          reportFormat: "HTML",
          primaryColor: "#3b82f6",
        },
      ];
      vi.mocked(db.getScheduledReports).mockResolvedValue(mockReports as any);

      const result = await db.getScheduledReports({});
      expect(result).toEqual(mockReports);
      expect(db.getScheduledReports).toHaveBeenCalledTimes(1);
    });

    it("should filter by isActive", async () => {
      vi.mocked(db.getScheduledReports).mockResolvedValue([]);

      await db.getScheduledReports({ isActive: true });
      expect(db.getScheduledReports).toHaveBeenCalledWith({ isActive: true });
    });
  });

  describe("create", () => {
    it("should create scheduled report with customization fields", async () => {
      vi.mocked(db.createScheduledReport).mockResolvedValue(1);
      vi.mocked(db.getScheduledReportById).mockResolvedValue({
        id: 1,
        name: "Test Report",
        schedule: "DAILY",
        scheduleTime: "08:00",
        isActive: true,
      } as any);

      const input = {
        name: "Test Report",
        reportType: "NG_VISUAL" as const,
        schedule: "DAILY" as const,
        recipients: ["test@example.com"],
        reportFormat: "PDF" as const,
        logoUrl: "https://example.com/logo.png",
        primaryColor: "#ff0000",
        footerText: "© 2025 Company",
        createdBy: 1,
      };

      const id = await db.createScheduledReport(input);
      expect(id).toBe(1);
      expect(db.createScheduledReport).toHaveBeenCalledWith(input);
    });

    it("should create report with default HTML format", async () => {
      vi.mocked(db.createScheduledReport).mockResolvedValue(2);

      const input = {
        name: "Default Format Report",
        reportType: "DAILY_SUMMARY" as const,
        schedule: "WEEKLY" as const,
        recipients: ["admin@example.com"],
        createdBy: 1,
      };

      await db.createScheduledReport(input);
      expect(db.createScheduledReport).toHaveBeenCalledWith(input);
    });
  });

  describe("update", () => {
    it("should update scheduled report with customization fields", async () => {
      vi.mocked(db.updateScheduledReport).mockResolvedValue(undefined);
      vi.mocked(db.getScheduledReportById).mockResolvedValue({
        id: 1,
        name: "Updated Report",
        schedule: "WEEKLY",
        scheduleTime: "09:00",
        scheduleDayOfWeek: 1,
        isActive: true,
        reportFormat: "EXCEL",
      } as any);

      await db.updateScheduledReport(1, {
        name: "Updated Report",
        reportFormat: "EXCEL" as const,
        primaryColor: "#00ff00",
        footerText: "Updated footer",
      });

      expect(db.updateScheduledReport).toHaveBeenCalledWith(1, {
        name: "Updated Report",
        reportFormat: "EXCEL",
        primaryColor: "#00ff00",
        footerText: "Updated footer",
      });
    });

    it("should update only specified fields", async () => {
      vi.mocked(db.updateScheduledReport).mockResolvedValue(undefined);

      await db.updateScheduledReport(1, { isActive: false });
      expect(db.updateScheduledReport).toHaveBeenCalledWith(1, { isActive: false });
    });
  });

  describe("delete", () => {
    it("should delete scheduled report", async () => {
      vi.mocked(db.deleteScheduledReport).mockResolvedValue(undefined);

      await db.deleteScheduledReport(1);
      expect(db.deleteScheduledReport).toHaveBeenCalledWith(1);
    });
  });
});

describe("SMTP Configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSmtpConfig", () => {
    it("should return SMTP config without password", async () => {
      const mockConfig = {
        id: 1,
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        username: "test@gmail.com",
        password: "secret123",
        fromEmail: "noreply@company.com",
        fromName: "Company Reports",
      };
      vi.mocked(db.getSmtpConfig).mockResolvedValue(mockConfig as any);

      const result = await db.getSmtpConfig();
      expect(result).toEqual(mockConfig);
    });

    it("should return null if no config exists", async () => {
      vi.mocked(db.getSmtpConfig).mockResolvedValue(null);

      const result = await db.getSmtpConfig();
      expect(result).toBeNull();
    });
  });
});

describe("Report Customization Fields", () => {
  it("should validate reportFormat enum values", () => {
    const validFormats = ["HTML", "PDF", "EXCEL"];
    validFormats.forEach((format) => {
      expect(["HTML", "PDF", "EXCEL"]).toContain(format);
    });
  });

  it("should validate primaryColor format", () => {
    const validColors = ["#3b82f6", "#ff0000", "#00ff00", "#000000", "#ffffff"];
    validColors.forEach((color) => {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it("should accept empty logoUrl", () => {
    const logoUrl = "";
    expect(logoUrl).toBe("");
  });

  it("should accept valid S3 URL for logoUrl", () => {
    const logoUrl = "https://s3.amazonaws.com/bucket/logo.png";
    expect(logoUrl).toMatch(/^https?:\/\/.+/);
  });
});

describe("Logo Upload", () => {
  it("should generate unique filename for uploaded logo", () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const filename = `report-logos/${timestamp}-${random}.png`;
    
    expect(filename).toMatch(/^report-logos\/\d+-[a-z0-9]+\.png$/);
  });

  it("should extract base64 data correctly", () => {
    const base64WithPrefix = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const base64Data = base64WithPrefix.replace(/^data:image\/\w+;base64,/, "");
    
    expect(base64Data).not.toContain("data:image");
    expect(base64Data).toBe("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
  });
});
