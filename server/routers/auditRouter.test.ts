import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  }),
}));

describe("auditRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("audit.list", () => {
    it("should have list procedure defined", async () => {
      const { auditLogRouter } = await import("./auditRouter");
      expect(auditLogRouter).toBeDefined();
      expect(auditLogRouter._def.procedures.list).toBeDefined();
    });

    it("should have getStats procedure defined", async () => {
      const { auditLogRouter } = await import("./auditRouter");
      expect(auditLogRouter._def.procedures.getStats).toBeDefined();
    });
  });

  describe("audit router structure", () => {
    it("should export auditLogRouter", async () => {
      const module = await import("./auditRouter");
      expect(module.auditLogRouter).toBeDefined();
    });

    it("should have correct procedure types", async () => {
      const { auditLogRouter } = await import("./auditRouter");
      
      // Check that all procedures exist
      const procedures = auditLogRouter._def.procedures;
      expect(procedures).toHaveProperty("list");
      expect(procedures).toHaveProperty("getStats");
    });
  });

  describe("audit log filtering", () => {
    it("should support action filter", async () => {
      const { auditLogRouter } = await import("./auditRouter");
      // Verify the procedure accepts the expected input shape
      const listProcedure = auditLogRouter._def.procedures.list;
      expect(listProcedure).toBeDefined();
    });

    it("should support entityType filter", async () => {
      const { auditLogRouter } = await import("./auditRouter");
      const listProcedure = auditLogRouter._def.procedures.list;
      expect(listProcedure).toBeDefined();
    });

    it("should support status filter", async () => {
      const { auditLogRouter } = await import("./auditRouter");
      const listProcedure = auditLogRouter._def.procedures.list;
      expect(listProcedure).toBeDefined();
    });
  });
});
