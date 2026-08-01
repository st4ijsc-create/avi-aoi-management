/**
 * W8-A (doc 27 M12a / doc 29 §1) — componentLibraryRouter tests: package CRUD
 * (soft delete, family filter, numeric string mapping), footprint CRUD,
 * materials↔package link, RBAC gate and DB-offline fail-safe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import { componentPackages, componentFootprints, materials } from "../../drizzle/schema";

const fake = new FakeDb();
let dbOnline = true;

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  const makeAsc = (col: any) => ({ name: col.name, dir: "asc" as const });
  const makeIsNull = (col: any) => (row: any) => row[col.name] == null;
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc, asc: makeAsc, isNull: makeIsNull };
});

vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => (dbOnline ? fake : null)) }));

const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: (_mod: string, _act: string) => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no masterdata permission" });
    }
    return next({ ctx });
  },
}));

import { componentLibraryRouter } from "./componentLibraryRouter";

const ctx = { user: { id: 7, role: "admin", name: "Admin" } } as any;
const caller = componentLibraryRouter.createCaller(ctx);

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  dbOnline = true;
  fake.setUnique(componentPackages, [["code"]]);
  fake.setUnique(componentFootprints, [["packageId", "code"]]);
});

describe("packages CRUD", () => {
  it("creates, lists, gets, updates and SOFT-deletes a package", async () => {
    const { id } = await caller.packages.create({
      code: "0402", family: "CHIP", mountType: "SMT",
      bodyLengthMm: 1.0, bodyWidthMm: 0.5, pinCount: 2, hasPolarity: false, isActive: true,
    });
    expect(id).toBeGreaterThan(0);

    const list = await caller.packages.list({});
    expect(list.map((r: any) => r.code)).toContain("0402");
    // numeric(10,4) travels as string
    expect(String((list[0] as any).bodyLengthMm)).toBe("1");
    expect((list[0] as any).origin).toBe("manual");

    const got = await caller.packages.get({ id });
    expect(got).toMatchObject({ code: "0402", family: "CHIP" });

    const upd = await caller.packages.update({ id, hasPolarity: true, polarityMark: "band", pitchMm: 0.5 });
    expect(upd).toMatchObject({ hasPolarity: true, polarityMark: "band" });
    expect(String((upd as any).pitchMm)).toBe("0.5");

    await caller.packages.delete({ id });
    // Soft delete: row survives with deletedAt + inactive, and leaves default lists.
    const after = await caller.packages.get({ id });
    expect(after?.deletedAt).toBeTruthy();
    expect(after?.isActive).toBe(false);
    const defaultList = await caller.packages.list({});
    expect(defaultList.map((r: any) => r.id)).not.toContain(id);
    const withDeleted = await caller.packages.list({ includeDeleted: true });
    expect(withDeleted.map((r: any) => r.id)).toContain(id);
  });

  it("filters by family and rejects a duplicate code with CONFLICT", async () => {
    await caller.packages.create({ code: "SOT-23-3", family: "SOT", isActive: true });
    await caller.packages.create({ code: "0603", family: "CHIP", isActive: true });
    const sot = await caller.packages.list({ family: "SOT" });
    expect(sot.map((r: any) => r.code)).toEqual(["SOT-23-3"]);

    await expect(caller.packages.create({ code: "0603", family: "CHIP" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("footprints CRUD", () => {
  it("creates/lists/updates/deletes footprints per package + duplicate guard", async () => {
    const { id: packageId } = await caller.packages.create({ code: "QFN-48-7x7", family: "QFN" });
    const { id } = await caller.footprints.create({
      packageId, code: "QFN50P700X700X100-48M", density: "most", padCount: 49,
    });
    expect(id).toBeGreaterThan(0);

    const list = await caller.footprints.listByPackage({ packageId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: "QFN50P700X700X100-48M", density: "most", padCount: 49 });

    const upd = await caller.footprints.update({ id, density: "nominal" });
    expect(upd).toMatchObject({ density: "nominal" });

    await expect(caller.footprints.create({ packageId, code: "QFN50P700X700X100-48M" }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    await caller.footprints.delete({ id });
    expect(await caller.footprints.listByPackage({ packageId })).toHaveLength(0);
  });
});

describe("materials ↔ package link", () => {
  it("links and unlinks a material; unknown package/material → NOT_FOUND", async () => {
    const { id: packageId } = await caller.packages.create({ code: "0805", family: "CHIP" });
    fake.seed(materials, [{ id: 501, code: "C-100NF-0805", name: "Cap 100nF", packageType: "0805", packageId: null }]);

    const linked = await caller.linkMaterial({ materialId: 501, packageId });
    expect(linked).toMatchObject({ id: 501, packageId });

    const cleared = await caller.linkMaterial({ materialId: 501, packageId: null });
    expect(cleared).toMatchObject({ id: 501, packageId: null });

    await expect(caller.linkMaterial({ materialId: 501, packageId: 9999 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.linkMaterial({ materialId: 9999, packageId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to link to a soft-deleted package", async () => {
    const { id: packageId } = await caller.packages.create({ code: "1206", family: "CHIP" });
    await caller.packages.delete({ id: packageId });
    fake.seed(materials, [{ id: 502, code: "R-10K-1206", name: "Res 10k", packageId: null }]);
    await expect(caller.linkMaterial({ materialId: 502, packageId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("RBAC + fail-safe", () => {
  it("denies writes without the masterdata grant", async () => {
    perm.allow = false;
    await expect(caller.packages.create({ code: "X", family: "OTHER" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reads degrade to [] / null when the DB is offline; writes throw", async () => {
    dbOnline = false;
    expect(await caller.packages.list({})).toEqual([]);
    expect(await caller.packages.get({ id: 1 })).toBeNull();
    expect(await caller.footprints.listByPackage({ packageId: 1 })).toEqual([]);
    await expect(caller.packages.create({ code: "Y", family: "OTHER" }))
      .rejects.toThrow("Database not available");
  });
});
