/**
 * apiKeyRouter tests — control-plane scoped API-key CRUD.
 *
 * Covers the SECURITY invariants:
 *   • create returns the PLAINTEXT key exactly once AND stores only its sha256 hash
 *     (same algo as server/api/v1/auth.ts hashApiKey) — never the plaintext.
 *   • list NEVER leaks keyHash / plaintext.
 *   • update edits scopes/expiry/active; revoke flips isActive=false; delete removes.
 *   • RBAC gate denies when the caller lacks the admin module permission.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import { apiKeys } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
vi.mock("../db", () => ({ getDb: vi.fn(async () => fake) }));

const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no admin_system" });
    }
    return next({ ctx });
  },
}));

import { apiKeyRouter } from "./apiKeyRouter";

const ctx = { user: { id: 7, role: "admin", name: "Admin" } } as any;
const caller = apiKeyRouter.createCaller(ctx);

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
});

describe("create", () => {
  it("returns the plaintext key ONCE and stores only its sha256 hash", async () => {
    const res = await caller.create({ name: "edge-a", scopes: ["equipment:read", "ingest:write"] });
    expect(res.plaintextKey).toBeTruthy();
    expect(res.plaintextKey).toMatch(/^ak_[0-9a-f]{48}$/);
    // The stored row holds the HASH, never the plaintext.
    const stored = fake.store.get((apiKeys as any)[Symbol.for("drizzle:Name")])![0];
    expect(stored.keyHash).toBe(sha256(res.plaintextKey));
    expect(stored.keyHash).not.toContain(res.plaintextKey);
    expect(stored.keyPrefix).toBe(res.plaintextKey.slice(0, 9)); // ak_ + 6 hex
    // The create response itself must NOT echo the hash.
    expect((res as any).keyHash).toBeUndefined();
  });

  it("rejects an unknown scope", async () => {
    await expect(caller.create({ name: "bad", scopes: ["totally:bogus"] })).rejects.toThrow();
  });

  it("accepts namespace + global wildcards", async () => {
    const res = await caller.create({ name: "wild", scopes: ["equipment:*", "*"] });
    expect(res.scopes).toEqual(["equipment:*", "*"]);
  });
});

describe("list", () => {
  it("never exposes keyHash or plaintext", async () => {
    await caller.create({ name: "k1", scopes: ["equipment:read"] });
    const rows = await caller.list();
    expect(rows.length).toBe(1);
    for (const r of rows) {
      expect("keyHash" in r).toBe(false);
      expect("plaintextKey" in r).toBe(false);
      expect(r.keyPrefix).toBeTruthy();
    }
  });
});

describe("update", () => {
  it("edits scopes and expiry and active flag", async () => {
    const created = await caller.create({ name: "k", scopes: ["equipment:read"] });
    const updated = await caller.update({
      id: created.id,
      scopes: ["equipment:read", "equipment:command"],
      isActive: true,
      expiresAt: new Date("2030-01-01").toISOString(),
    });
    expect(updated.scopes).toEqual(["equipment:read", "equipment:command"]);
    expect(new Date(updated.expiresAt!).getFullYear()).toBe(2030);
    expect((updated as any).keyHash).toBeUndefined();
  });

  it("throws NOT_FOUND for a missing id", async () => {
    await expect(caller.update({ id: 999, name: "x" })).rejects.toThrow(/not found/i);
  });
});

describe("revoke + delete", () => {
  it("revoke flips isActive to false", async () => {
    const created = await caller.create({ name: "k", scopes: ["ingest:write"] });
    const revoked = await caller.revoke({ id: created.id });
    expect(revoked.isActive).toBe(false);
  });

  it("delete removes the row", async () => {
    const created = await caller.create({ name: "k", scopes: ["ingest:write"] });
    const res = await caller.delete({ id: created.id });
    expect(res.deleted).toBe(true);
    const rows = await caller.list();
    expect(rows.find((r) => r.id === created.id)).toBeUndefined();
  });

  it("delete throws NOT_FOUND for a missing id", async () => {
    await expect(caller.delete({ id: 12345 })).rejects.toThrow(/not found/i);
  });
});

describe("RBAC gate", () => {
  it("denies list when the caller lacks admin_system", async () => {
    perm.allow = false;
    await expect(caller.list()).rejects.toThrow(/admin_system|FORBIDDEN/i);
  });
  it("denies create when the caller lacks admin_system", async () => {
    perm.allow = false;
    await expect(caller.create({ name: "x", scopes: ["ingest:write"] })).rejects.toThrow(/admin_system|FORBIDDEN/i);
  });
});
