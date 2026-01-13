import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock db functions
vi.mock("./db", () => ({
  getMeasurementResultById: vi.fn(),
  getMeasurementResultsByInspection: vi.fn(),
  getDb: vi.fn(),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

describe("measurementResult.correctResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correctResult mutation defined", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    // Check that the mutation exists
    expect(caller.measurementResult.correctResult).toBeDefined();
    expect(typeof caller.measurementResult.correctResult).toBe("function");
  });

  it("should validate input schema", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    // Test with invalid result value - should throw validation error
    await expect(
      caller.measurementResult.correctResult({
        id: 1,
        result: "INVALID" as "OK",
        reason: "test",
      })
    ).rejects.toThrow();
  });
});

describe("productModel.getByCode", () => {
  it("should have getByCode query defined", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    // Check that the query exists
    expect(caller.productModel.getByCode).toBeDefined();
    expect(typeof caller.productModel.getByCode).toBe("function");
  });
});
