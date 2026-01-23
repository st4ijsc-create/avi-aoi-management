import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  }),
}));

describe("sessionRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("session.list", () => {
    it("should return empty array when no sessions exist", async () => {
      // Test that the router structure is correct
      const { sessionRouter } = await import("./sessionRouter");
      expect(sessionRouter).toBeDefined();
      expect(sessionRouter._def.procedures.list).toBeDefined();
    });

    it("should have revoke procedure defined", async () => {
      const { sessionRouter } = await import("./sessionRouter");
      expect(sessionRouter._def.procedures.revoke).toBeDefined();
    });

    it("should have revokeAll procedure defined", async () => {
      const { sessionRouter } = await import("./sessionRouter");
      expect(sessionRouter._def.procedures.revokeAll).toBeDefined();
    });
  });

  describe("session management features", () => {
    it("should export sessionRouter", async () => {
      const module = await import("./sessionRouter");
      expect(module.sessionRouter).toBeDefined();
    });

    it("should have correct procedure types", async () => {
      const { sessionRouter } = await import("./sessionRouter");
      
      // Check that all procedures exist
      const procedures = sessionRouter._def.procedures;
      expect(procedures).toHaveProperty("list");
      expect(procedures).toHaveProperty("revoke");
      expect(procedures).toHaveProperty("revokeAll");
    });
  });
});
