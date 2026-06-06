/**
 * Sprint G2.2a — deviceAdapterRouter tests.
 *
 * Covers: adapter + tag CRUD, unique(code), unique(adapterId,tagKey), delete-enabled
 * guard, testConnection (stub→ok / unregistered protocol→clean error, NO write),
 * and RBAC denial when the caller lacks machine_control.
 *
 * The router talks to drizzle via getDb() — we mock `../db` with an in-memory fake
 * and mock drizzle's eq/and/gte/desc to JS predicates. testConnection uses the REAL
 * driver registry (stub driver registered via side-effect import).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeGte, makeDesc, resetSeq } from "./__otFakeDb";
import { deviceAdapters, deviceTags } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, gte: makeGte, desc: makeDesc };
});

vi.mock("../db", () => ({ getDb: vi.fn(async () => fake) }));

// Driver registry: delegate to the REAL implementation by default, but allow a
// per-test override of createDriver (to exercise the clean-error branch).
const driverOverride = vi.hoisted(() => ({ createDriver: null as ((p: any) => any) | null }));
vi.mock("../services/ot/driverRegistry", async (orig) => {
  const actual = await orig<typeof import("../services/ot/driverRegistry")>();
  return {
    ...actual,
    createDriver: (p: any) => (driverOverride.createDriver ?? actual.createDriver)(p),
  };
});

// RBAC: a configurable permission gate. `allow` toggles the machine_control grant.
const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: (_module: string, _action: string) =>
    async ({ ctx, next }: any) => {
      if (!perm.allow) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "FORBIDDEN", message: "no machine_control" });
      }
      return next({ ctx });
    },
}));

import { deviceAdapterRouter } from "./deviceAdapterRouter";

const ctx = { user: { id: 9, role: "supervisor", name: "Sup" } } as any;
const caller = deviceAdapterRouter.createCaller(ctx);

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  fake.setUnique(deviceAdapters, [["code"]]);
  fake.setUnique(deviceTags, [["adapterId", "tagKey"]]);
});

describe("adapter CRUD", () => {
  it("create → list → get(with tags) → update → delete", async () => {
    const created = await caller.create({
      code: "PLC-1", name: "Line1 PLC", protocol: "stub", endpoint: "stub://x",
    });
    expect(created.code).toBe("PLC-1");
    expect(created.isEnabled).toBe(false);
    expect(created.createdBy).toBe(9);

    const list = await caller.list();
    expect(list).toHaveLength(1);

    const got = await caller.get({ id: created.id });
    expect(got.tags).toEqual([]);

    const updated = await caller.update({ id: created.id, name: "Renamed" });
    expect(updated.name).toBe("Renamed");

    const del = await caller.delete({ id: created.id });
    expect(del).toEqual({ success: true });
    expect(await caller.list()).toHaveLength(0);
  });

  it("rejects duplicate code with friendly CONFLICT", async () => {
    await caller.create({ code: "DUP", name: "A", protocol: "stub", endpoint: "stub://a" });
    await expect(
      caller.create({ code: "DUP", name: "B", protocol: "stub", endpoint: "stub://b" }),
    ).rejects.toThrow(/đã tồn tại/);
  });

  it("refuses to delete an enabled adapter", async () => {
    const a = await caller.create({ code: "EN", name: "On", protocol: "stub", endpoint: "stub://e", isEnabled: true });
    await expect(caller.delete({ id: a.id })).rejects.toThrow(/đang bật/);
  });

  it("list filters by protocol", async () => {
    await caller.create({ code: "A", name: "a", protocol: "stub", endpoint: "s://a" });
    await caller.create({ code: "B", name: "b", protocol: "modbus", endpoint: "tcp://b" });
    const onlyStub = await caller.list({ protocol: "stub" });
    expect(onlyStub.map((r) => r.code)).toEqual(["A"]);
  });
});

describe("tag CRUD + unique", () => {
  it("create tag → unique(adapterId,tagKey) friendly error → list → update → delete", async () => {
    const a = await caller.create({ code: "T", name: "t", protocol: "stub", endpoint: "s://t" });
    const tag = await caller.tags.create({ adapterId: a.id, tagKey: "temp", address: "DB1.0", dataType: "float" });
    expect(tag.tagKey).toBe("temp");
    expect(tag.writable).toBe(false);

    await expect(
      caller.tags.create({ adapterId: a.id, tagKey: "temp", address: "DB1.4", dataType: "float" }),
    ).rejects.toThrow(/đã tồn tại trong adapter/);

    const tags = await caller.tags.listByAdapter({ adapterId: a.id });
    expect(tags).toHaveLength(1);

    const upd = await caller.tags.update({ id: tag.id, writable: true });
    expect(upd.writable).toBe(true);

    const del = await caller.tags.delete({ id: tag.id });
    expect(del).toEqual({ success: true });
    expect(await caller.tags.listByAdapter({ adapterId: a.id })).toHaveLength(0);
  });
});

describe("testConnection (read-only probe, NO write)", () => {
  it("stub protocol → ok with latency", async () => {
    const res = await caller.testConnection({ protocol: "stub", endpoint: "stub://probe" });
    expect(res.ok).toBe(true);
    expect(typeof res.latencyMs).toBe("number");
  });

  it("by adapter id → ok", async () => {
    const a = await caller.create({ code: "P", name: "p", protocol: "stub", endpoint: "stub://p" });
    const res = await caller.testConnection({ id: a.id });
    expect(res.ok).toBe(true);
  });

  it("driver create/connect failure (e.g. missing protocol lib) → ok:false with clean error, never throws", async () => {
    driverOverride.createDriver = () => { throw new Error("modbus-serial not installed"); };
    try {
      const res = await caller.testConnection({ protocol: "modbus", endpoint: "tcp://x:502" });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not installed/);
      expect(res.latencyMs).toBe(0);
    } finally {
      driverOverride.createDriver = null;
    }
  });
});

describe("RBAC", () => {
  it("denies create when caller lacks machine_control", async () => {
    perm.allow = false;
    await expect(
      caller.create({ code: "X", name: "x", protocol: "stub", endpoint: "s://x" }),
    ).rejects.toThrow(/machine_control|FORBIDDEN/i);
  });

  it("denies list when caller lacks machine_control", async () => {
    perm.allow = false;
    await expect(caller.list()).rejects.toThrow(/machine_control|FORBIDDEN/i);
  });
});
