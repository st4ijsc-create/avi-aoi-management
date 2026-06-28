/**
 * Doc 07 §③ — masterDataRouter tests (MES/MOM master-data CRUD + RBAC + fail-safe).
 *
 * Covers: CRUD shape for each sub-router (suppliers/materials/customers/
 * skills+certs/tools), the "masterdata" RBAC gate on writes, and the fail-safe
 * (DB offline → reads degrade to []; writers throw "Database not available").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import {
  suppliers, materials, materialClasses, customers, skills, userCertifications, tools,
} from "../../drizzle/schema";

const fake = new FakeDb();
let dbOnline = true;

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  // asc behaves like a desc-less order ref; the FakeDb only checks `dir`.
  const makeAsc = (col: any) => ({ name: col.name, dir: "asc" as const });
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc, asc: makeAsc };
});

// Router imports getDb from "../db/connection".
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

import { masterDataRouter } from "./masterDataRouter";

const ctx = { user: { id: 7, role: "admin", name: "Admin" } } as any;
const caller = masterDataRouter.createCaller(ctx);

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  dbOnline = true;
});

describe("suppliers CRUD", () => {
  it("creates, lists, gets, updates and deletes a supplier", async () => {
    const { id } = await caller.suppliers.create({ code: "SUP-1", name: "Acme", rating: 4.5 });
    expect(id).toBeGreaterThan(0);

    const list = await caller.suppliers.list();
    expect(list.map((r: any) => r.code)).toContain("SUP-1");

    const got = await caller.suppliers.get({ id });
    expect(got).toMatchObject({ code: "SUP-1", name: "Acme" });
    expect(String(got!.rating)).toBe("4.5"); // numeric stored as string

    const upd = await caller.suppliers.update({ id, approvalStatus: "approved" });
    expect(upd).toMatchObject({ approvalStatus: "approved" });

    const del = await caller.suppliers.delete({ id });
    expect(del).toEqual({ success: true });
    expect(await caller.suppliers.get({ id })).toBeNull();
  });
});

describe("materials + classes", () => {
  it("creates a material class and a material", async () => {
    const cls = await caller.materials.createClass({ code: "CAP", name: "Capacitors" });
    expect(cls.id).toBeGreaterThan(0);
    const { id } = await caller.materials.create({ code: "C0402", name: "Cap 100nF", materialClass: "CAP", rohs: true });
    const got = await caller.materials.get({ id });
    expect(got).toMatchObject({ code: "C0402", materialClass: "CAP", rohs: true });
    const classes = await caller.materials.listClasses();
    expect(classes.map((c: any) => c.code)).toContain("CAP");
  });
});

describe("customers CRUD", () => {
  it("creates and lists a customer", async () => {
    // isActive passed explicitly: the in-memory fake does not apply DB-level
    // column defaults, so activeOnly would otherwise filter the row out.
    await caller.customers.create({ code: "CUST-1", name: "BigCo", country: "VN", isActive: true });
    const list = await caller.customers.list({ activeOnly: true });
    expect(list.map((r: any) => r.code)).toContain("CUST-1");
  });
});

describe("skills + certifications", () => {
  it("creates a skill and grants/updates/revokes a certification", async () => {
    const skill = await caller.skills.create({ code: "AOI-OP", name: "AOI Operator", category: "AOI" });
    const cert = await caller.skills.grantCertification({ userId: 42, skillId: skill.id, level: "qualified" });
    expect(cert.id).toBeGreaterThan(0);

    const certs = await caller.skills.listCertifications({ userId: 42 });
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ skillId: skill.id, level: "qualified", certifiedBy: 7 });

    const upd = await caller.skills.updateCertification({ id: cert.id, level: "expert" });
    expect(upd).toMatchObject({ level: "expert" });

    await caller.skills.revokeCertification({ id: cert.id });
    expect(await caller.skills.listCertifications({ userId: 42 })).toHaveLength(0);
  });
});

describe("tools CRUD", () => {
  it("creates a tool with type/status/life fields", async () => {
    // status/lifeUsed are DB-level defaults (applied by Postgres, not the fake),
    // so the test passes them explicitly to assert the persisted shape.
    const { id } = await caller.tools.create({ code: "NOZ-1", name: "Nozzle 0402", type: "nozzle", lifeLimit: 100000, status: "available", lifeUsed: 0 });
    const got = await caller.tools.get({ id });
    expect(got).toMatchObject({ code: "NOZ-1", type: "nozzle", status: "available", lifeUsed: 0, lifeLimit: 100000 });
  });
});

describe("RBAC gate", () => {
  it("blocks writes when permission denied (FORBIDDEN)", async () => {
    perm.allow = false;
    await expect(caller.suppliers.create({ code: "X", name: "Y" })).rejects.toThrow(/FORBIDDEN|masterdata/);
    await expect(caller.tools.delete({ id: 1 })).rejects.toThrow(/FORBIDDEN|masterdata/);
  });
});

describe("fail-safe when DB offline", () => {
  it("reads degrade to [] / null and writers throw", async () => {
    dbOnline = false;
    expect(await caller.suppliers.list()).toEqual([]);
    expect(await caller.suppliers.get({ id: 1 })).toBeNull();
    await expect(caller.suppliers.create({ code: "Z", name: "Z" })).rejects.toThrow(/Database not available/);
  });
});
