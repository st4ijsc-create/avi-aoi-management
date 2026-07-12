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
  unitsOfMeasure, unitConversions, plantCalendars, calendarDays, calendarDayShifts, shiftConfigs,
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

// ─── doc 42 Đợt 4B H1 — skill matrix (assign upsert + joined list + revoke) ───
describe("skill matrix: userCertifications", () => {
  it("assign upserts by (userId,skillId), lists, and revokes", async () => {
    fake.setUnique(userCertifications, [["userId", "skillId"]]);
    const skill = await caller.skills.create({ code: "SMT-OP", name: "SMT Operator", category: "SMT" });

    const a1 = await caller.userCertifications.assign({
      userId: 99, skillId: skill.id, level: "qualified", expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(a1.id).toBeGreaterThan(0);

    const bySkill = await caller.userCertifications.list({ skillId: skill.id });
    expect(bySkill).toHaveLength(1);
    expect(bySkill[0]).toMatchObject({ userId: 99, skillId: skill.id, level: "qualified", certifiedBy: 7, isActive: true });

    // Re-assign the same (user,skill) → UPSERT (no duplicate-key throw); level updated.
    const a2 = await caller.userCertifications.assign({ userId: 99, skillId: skill.id, level: "expert" });
    expect(a2.id).toBe(a1.id);
    const byUser = await caller.userCertifications.list({ userId: 99 });
    expect(byUser).toHaveLength(1);
    expect(byUser[0].level).toBe("expert");

    await caller.userCertifications.revoke({ id: a1.id });
    expect(await caller.userCertifications.list({ skillId: skill.id })).toHaveLength(0);
  });

  it("gates assign/revoke behind masterdata perms and degrades when DB offline", async () => {
    perm.allow = false;
    await expect(caller.userCertifications.assign({ userId: 1, skillId: 1 })).rejects.toThrow(/FORBIDDEN|masterdata/);
    await expect(caller.userCertifications.revoke({ id: 1 })).rejects.toThrow(/FORBIDDEN|masterdata/);

    perm.allow = true;
    dbOnline = false;
    expect(await caller.userCertifications.list({ skillId: 1 })).toEqual([]);
    await expect(caller.userCertifications.assign({ userId: 1, skillId: 1 })).rejects.toThrow(/Database not available/);
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

    // doc 42 Đợt 4A #2 — conversion refs must exist: create the target uom "g".
    await caller.uom.create({ code: "g", name: "Gram", dimension: "mass" });
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

// ─── doc 42 T9 — calendar day shifts (junction calendar_days ↔ shift_configs) ──
describe("calendar day shifts", () => {
  it("lists active shift configs, assigns (upsert on day+shift), and unassigns", async () => {
    fake.setUnique(calendarDayShifts, [["calendarDayId", "shiftConfigId"]]);
    // shift_configs has no create endpoint here → seed rows directly (one active,
    // one inactive) to prove listShiftConfigs filters to active only.
    fake.seed(shiftConfigs, [
      { id: 501, name: "Ca sáng", code: "S1", startHour: 6, startMinute: 0, endHour: 14, endMinute: 0, isActive: true, orderIndex: 1 },
      { id: 502, name: "Ca đêm", code: "S3", startHour: 22, startMinute: 0, endHour: 6, endMinute: 0, isActive: false, orderIndex: 3 },
    ]);
    const cfgs = await caller.calendar.listShiftConfigs();
    expect(cfgs.map((c: any) => c.code)).toContain("S1");
    expect(cfgs.map((c: any) => c.code)).not.toContain("S3"); // inactive filtered out

    const cal = await caller.calendar.create({ code: "SHIFT-CAL", name: "Cal" });
    const day = await caller.calendar.createDay({ calendarId: cal.id, date: "2026-06-01", dayType: "working" });

    const a1 = await caller.calendar.assignShift({ calendarDayId: day.id, shiftConfigId: 501 });
    expect(a1.id).toBeGreaterThan(0);
    const list = await caller.calendar.listDayShifts({ calendarDayId: day.id });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ calendarDayId: day.id, shiftConfigId: 501 });

    // Re-assign the same (day,shift) → UPSERT (no duplicate-key throw); same row id.
    const a2 = await caller.calendar.assignShift({ calendarDayId: day.id, shiftConfigId: 501 });
    expect(a2.id).toBe(a1.id);
    expect(await caller.calendar.listDayShifts({ calendarDayId: day.id })).toHaveLength(1);

    await caller.calendar.unassignShift({ id: a1.id });
    expect(await caller.calendar.listDayShifts({ calendarDayId: day.id })).toHaveLength(0);
  });

  it("gates assign/unassign behind masterdata perms and degrades when DB offline", async () => {
    perm.allow = false;
    await expect(caller.calendar.assignShift({ calendarDayId: 1, shiftConfigId: 1 })).rejects.toThrow(/FORBIDDEN|masterdata/);
    await expect(caller.calendar.unassignShift({ id: 1 })).rejects.toThrow(/FORBIDDEN|masterdata/);

    perm.allow = true;
    dbOnline = false;
    expect(await caller.calendar.listShiftConfigs()).toEqual([]);
    expect(await caller.calendar.listDayShifts({ calendarDayId: 1 })).toEqual([]);
    await expect(caller.calendar.assignShift({ calendarDayId: 1, shiftConfigId: 1 })).rejects.toThrow(/Database not available/);
  });
});

describe("inventory: warehouses + locations + balances", () => {
  it("creates a warehouse, location and inventory balance", async () => {
    // doc 42 Đợt 4A #2 — balance refs must exist: seed material + uom first.
    await caller.uom.create({ code: "pcs", name: "Pieces", dimension: "count", isActive: true });
    await caller.materials.create({ code: "C0402", name: "Cap 100nF" });
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
  it("rejects duplicate codes as CONFLICT with a friendly message (no SQL leak)", async () => {
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
    // Doc 42 Đợt 0 — unique violations surface as CONFLICT "Mã đã tồn tại",
    // never the raw driver "duplicate key ..."/SQL message.
    const dup = await caller.uom.create({ code: "L", name: "Litre dup" }).then(
      () => null,
      (e: any) => e,
    );
    expect(dup).not.toBeNull();
    expect(dup.code).toBe("CONFLICT");
    expect(dup.message).toBe("Mã đã tồn tại");
    expect(dup.message).not.toMatch(/duplicate key|insert into/i);

    const cal = await caller.calendar.create({ code: "DUP-CAL", name: "Cal" });
    await caller.calendar.createDay({ calendarId: cal.id, date: "2026-03-01", dayType: "working" });
    await expect(caller.calendar.createDay({ calendarId: cal.id, date: "2026-03-01" })).rejects.toThrow(/Mã đã tồn tại/);
  });

  it("update with null-valued nullable fields passes (doc 42 P0 revive-update)", async () => {
    const { id } = await caller.suppliers.create({ code: "SUP-NULL", name: "Null Co" });
    // Simulates the old EntityDialog payload: nullable columns arrive as null.
    const upd = await caller.suppliers.update({
      id,
      name: "Null Co 2",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      country: null,
      rating: null,
      corporateCode: null,
      factoryCode: null,
      notes: null,
    });
    expect(upd).toMatchObject({ name: "Null Co 2", contactName: null, notes: null });
  });

  it("rejects a malformed supplier contactEmail", async () => {
    await expect(caller.suppliers.create({ code: "SUP-EM", name: "Em", contactEmail: "abc" }))
      .rejects.toThrow(/email|invalid/i);
    const { id } = await caller.suppliers.create({ code: "SUP-EM", name: "Em" });
    await expect(caller.suppliers.update({ id, contactEmail: "abc" })).rejects.toThrow(/email|invalid/i);
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

// ─── doc 42 Đợt 4A #2 — validate mã tham chiếu tồn tại (chặn đường API trực tiếp) ─
describe("reference validation", () => {
  it("rejects a material with a non-existent materialClass (BAD_REQUEST tiếng Việt)", async () => {
    const err = await caller.materials.create({ code: "AUDIT4_MX", name: "X", materialClass: "KHONG_TON_TAI" })
      .then(() => null, (e: any) => e);
    expect(err).not.toBeNull();
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toMatch(/Nhóm vật tư "KHONG_TON_TAI" không tồn tại/);
  });

  it("accepts a material whose materialClass + unit exist", async () => {
    await caller.materials.createClass({ code: "RES", name: "Resistors" });
    await caller.uom.create({ code: "pcs", name: "Pieces", dimension: "count" });
    const { id } = await caller.materials.create({ code: "AUDIT4_R1", name: "R 10k", materialClass: "RES", unit: "pcs" });
    expect(id).toBeGreaterThan(0);
  });

  it("rejects a uom conversion whose target uom does not exist", async () => {
    await caller.uom.create({ code: "kg", name: "Kilogram", dimension: "mass" });
    const err = await caller.uom.createConversion({ fromUomCode: "kg", toUomCode: "GHOST", factor: 1000 })
      .then(() => null, (e: any) => e);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toMatch(/Đơn vị "GHOST" không tồn tại/);
  });

  it("rejects an inventory balance whose material does not exist", async () => {
    await caller.inventory.createWarehouse({ code: "WH1", name: "WH1" });
    await caller.uom.create({ code: "pcs", name: "Pieces" });
    const err = await caller.inventory.upsertBalance({ materialCode: "GHOSTMAT", warehouseCode: "WH1", quantityOnHand: 1, uomCode: "pcs" })
      .then(() => null, (e: any) => e);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toMatch(/Vật tư "GHOSTMAT" không tồn tại/);
  });
});

// ─── doc 42 Đợt 4A #1 — import (upsert theo code) ────────────────────────────
describe("import by code", () => {
  it("upserts suppliers by code: insert new + update existing, counts results", async () => {
    fake.setUnique(suppliers, [["code"]]);
    await caller.suppliers.create({ code: "AUDIT4_SUP01", name: "Old name" });

    const res = await caller.suppliers.importRows({
      rows: [
        { code: "AUDIT4_SUP01", name: "New name", type: "component", rating: 4.5 },
        { code: "AUDIT4_SUP02", name: "Second", isActive: true },
      ],
    });
    expect(res.inserted).toBe(1);
    expect(res.updated).toBe(1);
    expect(res.failed).toBe(0);

    const list = await caller.suppliers.list();
    expect(list.find((r: any) => r.code === "AUDIT4_SUP01")?.name).toBe("New name");
    expect(list.map((r: any) => r.code)).toContain("AUDIT4_SUP02");
  });

  it("reports per-row errors (missing required code) without blocking valid rows", async () => {
    const res = await caller.suppliers.importRows({
      rows: [
        { code: "AUDIT4_OK", name: "Ok" },
        { name: "No code" }, // fails required `code`
      ],
    });
    expect(res.inserted).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].row).toBe(2);
  });

  it("materials import surfaces a missing-ref error per row (BAD_REQUEST message)", async () => {
    const res = await caller.materials.importRows({
      rows: [{ code: "AUDIT4_M1", name: "Has ghost class", materialClass: "GHOST" }],
    });
    expect(res.inserted).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.errors[0].message).toMatch(/Nhóm vật tư "GHOST" không tồn tại/);
  });

  it("imports customers + material classes by code", async () => {
    const cust = await caller.customers.importRows({ rows: [{ code: "AUDIT4_C1", name: "Cust 1" }] });
    expect(cust.inserted).toBe(1);
    const cls = await caller.materials.importClasses({ rows: [{ code: "AUDIT4_CLS", name: "Nhóm A" }] });
    expect(cls.inserted).toBe(1);
    expect((await caller.materials.listClasses()).map((c: any) => c.code)).toContain("AUDIT4_CLS");
  });

  it("import writers are gated by masterdata canCreate (FORBIDDEN)", async () => {
    perm.allow = false;
    await expect(caller.suppliers.importRows({ rows: [{ code: "X", name: "Y" }] }))
      .rejects.toThrow(/FORBIDDEN|masterdata/);
  });
});

// ─── doc 42 Đợt 4C J1 — mass-actions (xoá / bật-tắt hàng loạt) ────────────────
describe("bulk mass-actions", () => {
  it("bulkDelete removes the selected suppliers and leaves the rest", async () => {
    const a = await caller.suppliers.create({ code: "AUDIT4C_B1", name: "B1" });
    const b = await caller.suppliers.create({ code: "AUDIT4C_B2", name: "B2" });
    const c = await caller.suppliers.create({ code: "AUDIT4C_B3", name: "B3" });

    const res = await caller.suppliers.bulkDelete({ ids: [a.id, b.id] });
    expect(res.deleted).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.errors).toHaveLength(0);

    const left = (await caller.suppliers.list()).map((r: any) => r.code);
    expect(left).not.toContain("AUDIT4C_B1");
    expect(left).not.toContain("AUDIT4C_B2");
    expect(left).toContain("AUDIT4C_B3");
    // clean up the survivor
    await caller.suppliers.bulkDelete({ ids: [c.id] });
  });

  it("bulkSetActive flips isActive on the selected materials", async () => {
    const m1 = await caller.materials.create({ code: "AUDIT4C_M1", name: "M1", isActive: true });
    const m2 = await caller.materials.create({ code: "AUDIT4C_M2", name: "M2", isActive: true });

    const off = await caller.materials.bulkSetActive({ ids: [m1.id, m2.id], isActive: false });
    expect(off.updated).toBe(2);
    expect(off.failed).toBe(0);
    expect((await caller.materials.get({ id: m1.id }))!.isActive).toBe(false);
    expect((await caller.materials.get({ id: m2.id }))!.isActive).toBe(false);

    const on = await caller.materials.bulkSetActive({ ids: [m1.id], isActive: true });
    expect(on.updated).toBe(1);
    expect((await caller.materials.get({ id: m1.id }))!.isActive).toBe(true);
  });

  it("customers bulk actions are wired too", async () => {
    const c1 = await caller.customers.create({ code: "AUDIT4C_CU1", name: "CU1", isActive: true });
    const upd = await caller.customers.bulkSetActive({ ids: [c1.id], isActive: false });
    expect(upd.updated).toBe(1);
    const del = await caller.customers.bulkDelete({ ids: [c1.id] });
    expect(del.deleted).toBe(1);
  });

  it("gates bulk actions behind masterdata perms and rejects empty id arrays", async () => {
    // empty array fails zod (min 1) before touching the DB
    await expect(caller.suppliers.bulkDelete({ ids: [] })).rejects.toThrow();

    perm.allow = false;
    await expect(caller.suppliers.bulkDelete({ ids: [1] })).rejects.toThrow(/FORBIDDEN|masterdata/);
    await expect(caller.materials.bulkSetActive({ ids: [1], isActive: true })).rejects.toThrow(/FORBIDDEN|masterdata/);

    perm.allow = true;
    dbOnline = false;
    await expect(caller.suppliers.bulkDelete({ ids: [1] })).rejects.toThrow(/Database not available/);
    await expect(caller.customers.bulkSetActive({ ids: [1], isActive: false })).rejects.toThrow(/Database not available/);
  });
});

// ─── doc 42 Đợt 5 K1 — data-quality dashboard (gate + fail-safe) ─────────────
// The summary uses db.execute(sql`COUNT(*) FILTER …`) which the in-memory FakeDb
// does not emulate; here we assert the two paths that DON'T touch execute — the
// masterdata canView gate and the DB-offline fail-safe ([]). The real aggregation
// (per-entity counts) is verified against the live Postgres DB via createCaller.
describe("quality.summary", () => {
  it("is gated behind masterdata canView", async () => {
    perm.allow = false;
    await expect(caller.quality.summary()).rejects.toThrow(/FORBIDDEN|masterdata/);
  });

  it("degrades to [] when the DB is offline", async () => {
    dbOnline = false;
    expect(await caller.quality.summary()).toEqual([]);
  });
});

// ─── doc 42 Đợt 4A #3 — workflow duyệt NCC (đổi approvalStatus + field mới) ────
describe("supplier approval workflow", () => {
  it("carries the new form fields and flips approvalStatus pending -> approved", async () => {
    const { id } = await caller.suppliers.create({
      code: "AUDIT4_APP", name: "Approvable Co", type: "raw_material",
      contactPhone: "0900000000", address: "Hà Nội", approvalStatus: "pending",
    });
    const created = await caller.suppliers.get({ id });
    expect(created).toMatchObject({ type: "raw_material", contactPhone: "0900000000", approvalStatus: "pending" });

    const upd = await caller.suppliers.update({ id, approvalStatus: "approved" });
    expect(upd).toMatchObject({ approvalStatus: "approved", type: "raw_material" });
  });
});
