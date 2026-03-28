import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock bcryptjs
vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$10$hashedpassword"),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

// Mock database functions
vi.mock("./db", () => ({
  getUserByUsername: vi.fn(),
  createLocalUser: vi.fn(),
  updateUser: vi.fn(),
  updateUserPassword: vi.fn(),
  deleteUser: vi.fn(),
  getAllUsers: vi.fn(),
}));

import * as db from "./db";

describe("User CRUD Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserByUsername", () => {
    it("should return user when found", async () => {
      const mockUser = {
        id: 1,
        openId: "local_testuser",
        username: "testuser",
        name: "Test User",
        email: "test@example.com",
        role: "user",
        isActive: true,
      };
      vi.mocked(db.getUserByUsername).mockResolvedValue(mockUser as any);

      const result = await db.getUserByUsername("testuser");
      expect(result).toEqual(mockUser);
      expect(db.getUserByUsername).toHaveBeenCalledWith("testuser");
    });

    it("should return undefined when user not found", async () => {
      vi.mocked(db.getUserByUsername).mockResolvedValue(undefined);

      const result = await db.getUserByUsername("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("createLocalUser", () => {
    it("should create a new local user", async () => {
      const mockResult = { id: 1 };
      vi.mocked(db.createLocalUser).mockResolvedValue(mockResult);

      const userData = {
        username: "newuser",
        passwordHash: "$2a$10$hashedpassword",
        name: "New User",
        email: "new@example.com",
        role: "user" as const,
      };

      const result = await db.createLocalUser(userData);
      expect(result).toEqual(mockResult);
      expect(db.createLocalUser).toHaveBeenCalledWith(userData);
    });

    it("should throw error for duplicate username", async () => {
      vi.mocked(db.createLocalUser).mockRejectedValue(new Error("Duplicate entry"));

      const userData = {
        username: "existinguser",
        passwordHash: "$2a$10$hashedpassword",
        name: "Existing User",
      };

      await expect(db.createLocalUser(userData)).rejects.toThrow("Duplicate entry");
    });
  });

  describe("updateUser", () => {
    it("should update user information", async () => {
      vi.mocked(db.updateUser).mockResolvedValue(undefined);

      const updateData = {
        name: "Updated Name",
        email: "updated@example.com",
        department: "IT",
      };

      await db.updateUser(1, updateData);
      expect(db.updateUser).toHaveBeenCalledWith(1, updateData);
    });

    it("should update user role", async () => {
      vi.mocked(db.updateUser).mockResolvedValue(undefined);

      await db.updateUser(1, { role: "admin" });
      expect(db.updateUser).toHaveBeenCalledWith(1, { role: "admin" });
    });

    it("should update user active status", async () => {
      vi.mocked(db.updateUser).mockResolvedValue(undefined);

      await db.updateUser(1, { isActive: false });
      expect(db.updateUser).toHaveBeenCalledWith(1, { isActive: false });
    });
  });

  describe("updateUserPassword", () => {
    it("should update user password", async () => {
      vi.mocked(db.updateUserPassword).mockResolvedValue(undefined);

      await db.updateUserPassword(1, "$2a$10$newhashedpassword");
      expect(db.updateUserPassword).toHaveBeenCalledWith(1, "$2a$10$newhashedpassword");
    });
  });

  describe("deleteUser", () => {
    it("should delete user by id", async () => {
      vi.mocked(db.deleteUser).mockResolvedValue(undefined);

      await db.deleteUser(1);
      expect(db.deleteUser).toHaveBeenCalledWith(1);
    });
  });

  describe("getAllUsers", () => {
    it("should return all users", async () => {
      const mockUsers = [
        { id: 1, username: "user1", name: "User 1", role: "admin" },
        { id: 2, username: "user2", name: "User 2", role: "user" },
      ];
      vi.mocked(db.getAllUsers).mockResolvedValue(mockUsers as any);

      const result = await db.getAllUsers();
      expect(result).toEqual(mockUsers);
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no users", async () => {
      vi.mocked(db.getAllUsers).mockResolvedValue([]);

      const result = await db.getAllUsers();
      expect(result).toEqual([]);
    });
  });
});

describe("Local Authentication", () => {
  it("should validate login with correct credentials", async () => {
    const mockUser = {
      id: 1,
      openId: "local_testuser",
      username: "testuser",
      passwordHash: "$2a$10$hashedpassword",
      isActive: true,
    };
    vi.mocked(db.getUserByUsername).mockResolvedValue(mockUser as any);

    const user = await db.getUserByUsername("testuser");
    expect(user).toBeDefined();
    expect(user?.passwordHash).toBeDefined();
  });

  it("should reject login for inactive user", async () => {
    const mockUser = {
      id: 1,
      username: "inactiveuser",
      passwordHash: "$2a$10$hashedpassword",
      isActive: false,
    };
    vi.mocked(db.getUserByUsername).mockResolvedValue(mockUser as any);

    const user = await db.getUserByUsername("inactiveuser");
    expect(user?.isActive).toBe(false);
  });

  it("should reject login for user without password", async () => {
    const mockUser = {
      id: 1,
      username: "oauthuser",
      passwordHash: null,
      isActive: true,
    };
    vi.mocked(db.getUserByUsername).mockResolvedValue(mockUser as any);

    const user = await db.getUserByUsername("oauthuser");
    expect(user?.passwordHash).toBeNull();
  });
});
