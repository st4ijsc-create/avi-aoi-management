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
  unitsOfMeasure, unitConversions, plantCalendars, calendarDays,
  warehouses, storageLocations, inventoryBalances,
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

describe("units of measure + conversions", () => {
  it("creates a UoM and a conversion (numeric stored as string)", async () => {
    const { id } = await caller.uom.create({ code: "kg", name: "Kilogram", dimension: "mass", isBase: true, isActive: true });
    expect(id).toBeGreaterThan(0);
    const got = await caller.uom.get({ id });
    expect(got).toMatchObject({ code: "kg", dimension: "mass", isBase: true });

    const list = await caller.uom.list({ activeOnly: true });
    expect(list.map((r: any) => r.code)).toContain("kg");

    const conv = await caller.uom.createConversion({ fromUomCode: "kg", toUomCode: "g", factor: 1000 });
    expect(conv.id).toBeGreaterThan(0);
    const convs = await caller.uom.listConversions();
    expect(convs).toHaveLength(1);
    expect(String(convs[0].factor)).toBe("1000");

    const updc = await caller.uom.updateConversion({ id: conv.id, factor: 1000.5 });
    expect(String(updc!.factor)).toBe("1000.5");
    await caller.uom.deleteConversion({ id: conv.id });
    expect(await caller.uom.listConversions()).toHaveLength(0);
  });
});

describe("plant calendar + days", () => {
  it("creates a calendar and tags days by type", async () => {
    const { id } = await caller.calendar.create({ code: "PLANT-A", name: "Plant A 2026", factoryCode: "F1", isActive: true });
    expect(id).toBeGreaterThan(0);
    await caller.calendar.createDay({ calendarId: id, date: "2026-01-01", dayType: "holiday" });
    await caller.calendar.createDay({ calendarId: id, date: "2026-01-02", dayType: "working" });
    const days = await caller.calendar.listDays({ calendarId: id });
    expect(days).toHaveLength(2);
    expect(days.map((d: any) => d.dayType)).toContain("holiday");

    const upd = await caller.calendar.updateDay({ id: days[0].id, dayType: "planned_downtime" });
    expect(upd).toMatchObject({ dayType: "planned_downtime" });
    await caller.calendar.deleteDay({ id: days[0].id });
    expect(await caller.calendar.listDays({ calendarId: id })).toHaveLength(1);
  });
});

describe("inventory: warehouses + locations + balances", () => {
  it("creates a warehouse, location and inventory balance", async () => {
    const wh = await caller.inventory.createWarehouse({ code: "WH-RAW", name: "Raw store", type: "raw", isActive: true });
    expect(wh.id).toBeGreaterThan(0);
    const whList = await caller.inventory.listWarehouses({ activeOnly: true });
    expect(whList.map((r: any) => r.code)).toContain("WH-RAW");

    const loc = await caller.inventory.createLocation({ warehouseId: wh.id, code: "A-01", kind: "bin", isActive: true });
    const locs = await caller.inventory.listLocations({ warehouseId: wh.id });
    expect(locs.map((l: any) => l.code)).toContain("A-01");

    const bal = await caller.inventory.upsertBalance({ materialCode: "C0402", warehouseCode: "WH-RAW", quantityOnHand: 1500, uomCode: "pcs" });
    expect(bal.id).toBeGreaterThan(0);
    const bals = await caller.inventory.listBalances({ materialCode: "C0402" });
    expect(bals).toHaveLength(1);
    expect(String(bals[0].quantityOnHand)).toBe("1500");

    const updb = await caller.inventory.updateBalance({ id: bal.id, quantityOnHand: 1200 });
    expect(String(updb!.quantityOnHand)).toBe("1200");

    await caller.inventory.deleteLocation({ id: loc.id });
    await caller.inventory.deleteBalance({ id: bal.id });
    expect(await caller.inventory.listBalances({ materialCode: "C0402" })).toHaveLength(0);
  });
});

describe("unique constraints (schema tables wired)", () => {
  it("rejects duplicate codes via the unique keysets", async () => {
    // Wire the FakeDb unique keysets to the REAL drizzle table objects to prove
    // the router writes to the expected tables (and the masters carry unique codes).
    fake.setUnique(unitsOfMeasure, [["code"]]);
    fake.setUnique(plantCalendars, [["code"]]);
    fake.setUnique(warehouses, [["code"]]);
    fake.setUnique(unitConversions, [["fromUomCode", "toUomCode"]]);
    fake.setUnique(calendarDays, [["calendarId", "date"]]);
    fake.setUnique(storageLocations, [["warehouseId", "code"]]);
    fake.setUnique(inventoryBalances, [["materialCode", "warehouseCode", "locationCode", "lotCode"]]);

    await caller.uom.create({ code: "L", name: "Litre", dimension: "volume" });
    await expect(caller.uom.create({ code: "L", name: "Litre dup" })).rejects.toThrow(/duplicate key/);

    const cal = await caller.calendar.create({ code: "DUP-CAL", name: "Cal" });
    await caller.calendar.createDay({ calendarId: cal.id, date: "2026-03-01", dayType: "working" });
    await expect(caller.calendar.createDay({ calendarId: cal.id, date: "2026-03-01" })).rejects.toThrow(/duplicate key/);
  });
});

describe("RBAC gate", () => {
  it("blocks writes when permission denied (FORBIDDEN)", async () => {
    perm.allow = false;
    await expect(caller.suppliers.create({ code: "X", name: "Y" })).rejects.toThrow(/FORBIDDEN|masterdata/);
    await expect(caller.tools.delete({ id: 1 })).rejects.toThrow(/FORBIDDEN|masterdata/);
    await expect(caller.uom.create({ code: "m", name: "Metre" })).rejects.toThrow(/FORBIDDEN|masterdata/);
    await expect(caller.calendar.create({ code: "C", name: "C" })).rejects.toThrow(/FORBIDDEN|masterdata/);
    await expect(caller.inventory.createWarehouse({ code: "W", name: "W" })).rejects.toThrow(/FORBIDDEN|masterdata/);
  });
});

describe("fail-safe when DB offline", () => {
  it("reads degrade to [] / null and writers throw", async () => {
    dbOnline = false;
    expect(await caller.suppliers.list()).toEqual([]);
    expect(await caller.suppliers.get({ id: 1 })).toBeNull();
    await expect(caller.suppliers.create({ code: "Z", name: "Z" })).rejects.toThrow(/Database not available/);
    // new sub-routers degrade identically
    expect(await caller.uom.list()).toEqual([]);
    expect(await caller.calendar.listDays({ calendarId: 1 })).toEqual([]);
    expect(await caller.inventory.listBalances()).toEqual([]);
    await expect(caller.inventory.upsertBalance({ materialCode: "M", warehouseCode: "W", quantityOnHand: 1 })).rejects.toThrow(/Database not available/);
  });
});
