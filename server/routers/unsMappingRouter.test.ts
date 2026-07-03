/**
 * Doc 24 / Connectivity — unsMappingRouter tests.
 *
 * Covers: mapping CRUD round-trip, unique(adapterId,tag) conflict, the pure live
 * preview, and RBAC denial without machine_control. The service talks to drizzle via
 * getDb() from ../db/connection — mocked with the in-memory FakeDb; drizzle's
 * eq/and/desc are mocked to JS predicates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import { unsTagMappings } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});

vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

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

import { unsMappingRouter } from "./unsMappingRouter";

const ctx = { user: { id: 7, role: "supervisor", name: "Sup" } } as any;
const caller = unsMappingRouter.createCaller(ctx);

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  fake.setUnique(unsTagMappings, [["adapterId", "tag"]]);
});

describe("mapping CRUD", () => {
  it("create → list → get → update → delete", async () => {
    const created = await caller.create({
      adapterId: 1,
      tag: "temperature",
      unsTopic: "ENT/{adapterCode}/{tag}",
      sparkplugMetric: "Temp",
      transform: { scale: 0.1, unit: "C", deadband: 1 },
    });
    expect(created.tag).toBe("temperature");
    expect(created.enabled).toBe(true);
    expect(created.createdBy).toBe(7);
    expect(created.transform).toMatchObject({ scale: 0.1, unit: "C" });

    const list = await caller.list({ adapterId: 1 });
    expect(list).toHaveLength(1);

    const got = await caller.get({ id: created.id });
    expect(got.tag).toBe("temperature");

    const updated = await caller.update({ id: created.id, enabled: false, sparkplugMetric: "Temp2" });
    expect(updated.enabled).toBe(false);
    expect(updated.sparkplugMetric).toBe("Temp2");

    const del = await caller.delete({ id: created.id });
    expect(del).toEqual({ success: true });
    expect(await caller.list({ adapterId: 1 })).toHaveLength(0);
  });

  it("rejects a duplicate (adapterId, tag) with a friendly CONFLICT", async () => {
    await caller.create({ adapterId: 1, tag: "t", unsTopic: "a" });
    await expect(caller.create({ adapterId: 1, tag: "t", unsTopic: "b" })).rejects.toThrow(/đã có mapping/);
  });

  it("get on a missing id → NOT_FOUND", async () => {
    await expect(caller.get({ id: 999 })).rejects.toThrow(/không tồn tại/);
  });
});

describe("preview (pure)", () => {
  it("reshapes a sample raw value → topic + metric + transformed value", async () => {
    const p = await caller.preview({
      adapterId: 1,
      tag: "t",
      unsTopic: "E/{adapterCode}/{tag}",
      sparkplugMetric: "M",
      transform: { scale: 2, offset: 1, unit: "C" },
      rawValue: 10,
      adapterCode: "A1",
    });
    expect(p.unsTopic).toBe("E/A1/t");
    expect(p.sparkplugMetric).toBe("M");
    expect(p.transformedValue).toBe(21);
    expect(p.unit).toBe("C");
    expect(p.willPublish).toBe(true);
  });

  it("willPublish=false when a deadband suppresses vs prevValue", async () => {
    const p = await caller.preview({
      adapterId: 1,
      tag: "t",
      unsTopic: "E/{tag}",
      transform: { deadband: 5 },
      rawValue: 21,
      prevValue: 20,
    });
    expect(p.willPublish).toBe(false);
  });
});

describe("RBAC", () => {
  it("denies create without machine_control", async () => {
    perm.allow = false;
    await expect(caller.create({ adapterId: 1, tag: "t", unsTopic: "a" })).rejects.toThrow(/machine_control/);
  });
});
