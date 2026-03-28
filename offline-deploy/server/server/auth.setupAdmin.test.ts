import { describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";

describe("auth.setupAdmin", () => {
  beforeEach(async () => {
    // Clean up users table before each test
    const allUsers = await db.getAllUsers();
    for (const user of allUsers) {
      await db.deleteUser(user.id);
    }
  });

  it("should create first admin user successfully", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    const result = await caller.auth.setupAdmin({
      username: "admin",
      email: "admin@test.com",
      name: "Test Admin",
      password: "password123",
    });

    expect(result.success).toBe(true);
    expect(result.userId).toBeTypeOf("number");

    // Verify user was created with admin role
    const admins = await db.getUsersByRole("admin");
    expect(admins.length).toBe(1);
    expect(admins[0].email).toBe("admin@test.com");
    expect(admins[0].name).toBe("Test Admin");
    expect(admins[0].role).toBe("admin");
  });

  it("should reject if admin already exists", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    // Create first admin
    await caller.auth.setupAdmin({
      username: "admin1",
      email: "admin1@test.com",
      name: "First Admin",
      password: "password123",
    });

    // Try to create second admin
    await expect(
      caller.auth.setupAdmin({
        username: "admin2",
        email: "admin2@test.com",
        name: "Second Admin",
        password: "password123",
      })
    ).rejects.toThrow("Admin already exists");
  });

  it("should validate email format", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    await expect(
      caller.auth.setupAdmin({
        username: "admin",
        email: "invalid-email",
        name: "Test Admin",
        password: "password123",
      })
    ).rejects.toThrow();
  });

  it("should validate password length", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    await expect(
      caller.auth.setupAdmin({
        username: "admin",
        email: "admin@test.com",
        name: "Test Admin",
        password: "short",
      })
    ).rejects.toThrow();
  });

  it("should validate name is not empty", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    await expect(
      caller.auth.setupAdmin({
        username: "admin",
        email: "admin@test.com",
        name: "",
        password: "password123",
      })
    ).rejects.toThrow();
  });

  it("should hash password before storing", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    const plainPassword = "password123";
    await caller.auth.setupAdmin({
      username: "testadmin",
      email: "admin@test.com",
      name: "Test Admin",
      password: plainPassword,
    });

    const admins = await db.getUsersByRole("admin");
    expect(admins[0].passwordHash).toBeDefined();
    expect(admins[0].passwordHash).not.toBe(plainPassword);
    expect(admins[0].passwordHash?.length).toBeGreaterThan(20); // bcrypt hash is long
  });
});
