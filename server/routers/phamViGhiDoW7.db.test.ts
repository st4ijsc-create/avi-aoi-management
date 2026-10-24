/**
 * ★★★ Lô W7 — phạm vi nhà máy của thủ tục GHI masterDataRouter (suppliers · materials · customers · tools · plantCalendars(+ngày, +ca) · warehouses(+vị trí, +tồn kho)),
 * kiểm định phamViGhi 2026-10-24. Kỹ sư CHỈ gán nhà máy A (mã `factoryCode`) gọi lên danh mục của nhà máy B.
 * Luật: hàng ngoài phạm vi ≡ không tồn tại (NOT_FOUND "record"), hàng B không đổi/không mất; hàng MỚI không được khai tenant của nhà máy khác;
 * không khai tenant ⇒ đóng dấu nhà máy A; import không ghi đè hàng B trùng mã.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw7${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
let fA = "";
let fB = "";
let fidA = 0;
let fidB = 0;
const factories: string[] = [];
let md!: ReturnType<typeof import("./masterDataRouter").masterDataRouter.createCaller>;

async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const NF = "NOT_FOUND";
async function hang(bang: string, code: string, fc: string): Promise<number> {
  const [r] = await dung(sql`INSERT INTO ${sql.raw(bang)} (code, name, "factoryCode") VALUES (${code}, ${code}, ${fc}) RETURNING id`);
  return Number(r.id);
}
const tenDoc = async (bang: string, id: number) => (await one(sql`SELECT name AS n, "factoryCode" AS f FROM ${sql.raw(bang)} WHERE id = ${id}`)) as { n: string; f: string } | undefined;

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  fA = `${RUN}a`;
  fB = `${RUN}b`;
  fidA = Number((await dung(sql`INSERT INTO factories (code, name) VALUES (${fA}, ${fA}) RETURNING id`))[0].id);
  fidB = Number((await dung(sql`INSERT INTO factories (code, name) VALUES (${fB}, ${fB}) RETURNING id`))[0].id);
  factories.push(fA, fB);
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw7", ts: RUN, ten: "PW7 ua" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${fA})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'settings', 'masterdata', true, true, true, true)`);
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  md = (await import("./masterDataRouter")).masterDataRouter.createCaller(ctx);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM inventory_balances WHERE "warehouseCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM storage_locations WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM warehouses WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM calendar_day_shifts WHERE "calendarDayId" IN (SELECT cd.id FROM calendar_days cd JOIN plant_calendars pc ON pc.id = cd."calendarId" WHERE pc.code LIKE ${like})`).catch(() => undefined);
  await dung(sql`DELETE FROM calendar_days WHERE "calendarId" IN (SELECT id FROM plant_calendars WHERE code LIKE ${like})`).catch(() => undefined);
  await dung(sql`DELETE FROM plant_calendars WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM shift_configs WHERE code LIKE ${like}`).catch(() => undefined);
  for (const t of ["suppliers", "materials", "customers", "tools"]) await dung(sql`DELETE FROM ${sql.raw(t)} WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("suppliers / materials / customers / tools — hàng mang mã tenant", () => {
  it("đối chứng: hàng nhà máy A ⇒ sửa được", async () => {
    const id = await hang("suppliers", `${RUN}-sa`, fA);
    await md.suppliers.update({ id, name: "a2" });
    expect((await tenDoc("suppliers", id))?.n).toBe("a2");
  });
  it("update / delete hàng nhà máy B ⇒ NOT_FOUND, hàng nguyên vẹn (cả 4 danh mục)", async () => {
    const ket: Record<string, unknown> = {};
    for (const [bang, router] of [["suppliers", "suppliers"], ["materials", "materials"], ["customers", "customers"], ["tools", "tools"]] as const) {
      const id = await hang(bang, `${RUN}-${bang}-b`, fB);
      const r = (md as any)[router];
      const l1 = await maLoi(() => r.update({ id, name: "hack" }));
      const l2 = await maLoi(() => r.delete({ id }));
      const x = await tenDoc(bang, id);
      ket[bang] = { l1, l2, name: x?.n };
    }
    const mong = (b: string) => ({ l1: NF, l2: NF, name: `${RUN}-${b}-b` });
    expect(ket).toEqual({ suppliers: mong("suppliers"), materials: mong("materials"), customers: mong("customers"), tools: mong("tools") });
  });
  it("bulkDelete / bulkSetActive: id nhà máy B bị đếm failed, id nhà máy A thực hiện", async () => {
    const ia = await hang("customers", `${RUN}-ca`, fA);
    const ib = await hang("customers", `${RUN}-cb`, fB);
    const bs = await md.customers.bulkSetActive({ ids: [ia, ib], isActive: false });
    const act = async (id: number) => (await one(sql`SELECT "isActive" AS a FROM customers WHERE id = ${id}`)).a;
    const bd = await md.customers.bulkDelete({ ids: [ia, ib] });
    const conB = Number((await one(sql`SELECT count(*)::int AS n FROM customers WHERE id = ${ib}`)).n);
    expect({ bs: [bs.updated, bs.failed], bd: [bd.deleted, bd.failed], conB, actB: await act(ib) }).toEqual({ bs: [1, 1], bd: [1, 1], conB: 1, actB: true });
  });
  it("create: khai tenant nhà máy B ⇒ NOT_FOUND không hàng; không khai ⇒ đóng dấu nhà máy A; khai nhà máy A ⇒ giữ", async () => {
    const l = await maLoi(() => md.suppliers.create({ code: `${RUN}-nb`, name: "nb", factoryCode: fB }));
    const r1 = await md.suppliers.create({ code: `${RUN}-nn`, name: "nn" });
    const r2 = await md.suppliers.create({ code: `${RUN}-na`, name: "na", factoryCode: fA });
    expect({ l, nb: Number((await one(sql`SELECT count(*)::int AS n FROM suppliers WHERE code = ${RUN + "-nb"}`)).n), f1: (await tenDoc("suppliers", r1.id))?.f, f2: (await tenDoc("suppliers", r2.id))?.f }).toEqual({ l: NF, nb: 0, f1: fA, f2: fA });
  });
  it("update: đẩy hàng nhà máy A sang nhà máy B (patch factoryCode) ⇒ NOT_FOUND, vẫn ở A", async () => {
    const id = await hang("materials", `${RUN}-mv`, fA);
    const l = await maLoi(() => md.materials.update({ id, factoryCode: fB }));
    expect({ l, f: (await tenDoc("materials", id))?.f }).toEqual({ l: NF, f: fA });
  });
  it("importRows: mã trùng hàng nhà máy B ⇒ lỗi dòng, KHÔNG ghi đè; mã mới ⇒ chèn và đóng dấu nhà máy A", async () => {
    const ib = await hang("suppliers", `${RUN}-ib`, fB);
    const r = await md.suppliers.importRows({ rows: [{ code: `${RUN}-ib`, name: "ghi-de" }, { code: `${RUN}-in`, name: "moi" }] });
    const moi = await one(sql`SELECT "factoryCode" AS f FROM suppliers WHERE code = ${RUN + "-in"}`);
    expect({ ins: r.inserted, upd: r.updated, fail: r.failed, bName: (await tenDoc("suppliers", ib))?.n, moi: moi?.f }).toEqual({ ins: 1, upd: 0, fail: 1, bName: `${RUN}-ib`, moi: fA });
  });
});

describe("lịch nhà máy (ngày + ca) — chiếu qua cha", () => {
  it("lịch / ngày / ca của nhà máy B ⇒ NOT_FOUND; lịch A dùng được", async () => {
    const cb = await hang("plant_calendars", `${RUN}-calb`, fB);
    const ca = await hang("plant_calendars", `${RUN}-cala`, fA);
    const [dB] = await dung(sql`INSERT INTO calendar_days ("calendarId", date) VALUES (${cb}, '2026-01-01') RETURNING id`);
    const [shB] = await dung(sql`INSERT INTO shift_configs (name, code, "startHour", "endHour", "factoryId") VALUES ('s', ${RUN + "-shb"}, 1, 2, ${fidB}) RETURNING id`);
    const [shA] = await dung(sql`INSERT INTO shift_configs (name, code, "startHour", "endHour", "factoryId") VALUES ('s', ${RUN + "-sha"}, 1, 2, ${fidA}) RETURNING id`);
    const [dA] = await dung(sql`INSERT INTO calendar_days ("calendarId", date) VALUES (${ca}, '2026-01-01') RETURNING id`);
    const l = [
      await maLoi(() => md.calendar.update({ id: cb, name: "hack" })),
      await maLoi(() => md.calendar.delete({ id: cb })),
      await maLoi(() => md.calendar.createDay({ calendarId: cb, date: "2026-02-02" })),
      await maLoi(() => md.calendar.updateDay({ id: Number(dB.id), notes: "hack" })),
      await maLoi(() => md.calendar.deleteDay({ id: Number(dB.id) })),
      await maLoi(() => md.calendar.assignShift({ calendarDayId: Number(dB.id), shiftConfigId: Number(shA.id) })),
      await maLoi(() => md.calendar.assignShift({ calendarDayId: Number(dA.id), shiftConfigId: Number(shB.id) })),
    ];
    const ok = await md.calendar.assignShift({ calendarDayId: Number(dA.id), shiftConfigId: Number(shA.id) });
    const con = Number((await one(sql`SELECT count(*)::int AS n FROM calendar_days WHERE id = ${dB.id}`)).n);
    expect({ l, con, ok: ok.id > 0 }).toEqual({ l: [NF, NF, NF, NF, NF, NF, NF], con: 1, ok: true });
  });
});

describe("kho (vị trí + tồn) — chiếu qua kho", () => {
  it("vị trí / tồn kho của kho nhà máy B ⇒ NOT_FOUND; kho A dùng được", async () => {
    const wb = await hang("warehouses", `${RUN}-whb`, fB);
    const wa = await hang("warehouses", `${RUN}-wha`, fA);
    const [lB] = await dung(sql`INSERT INTO storage_locations ("warehouseId", code) VALUES (${wb}, ${RUN + "-lb"}) RETURNING id`);
    const [bB] = await dung(sql`INSERT INTO inventory_balances ("materialCode", "warehouseCode", "quantityOnHand") VALUES (${RUN + "-mat"}, ${RUN + "-whb"}, 5) RETURNING id`);
    const l = [
      await maLoi(() => md.inventory.updateWarehouse({ id: wb, name: "hack" })),
      await maLoi(() => md.inventory.deleteWarehouse({ id: wb })),
      await maLoi(() => md.inventory.createLocation({ warehouseId: wb, code: `${RUN}-lx` })),
      await maLoi(() => md.inventory.updateLocation({ id: Number(lB.id), name: "hack" })),
      await maLoi(() => md.inventory.deleteLocation({ id: Number(lB.id) })),
      await maLoi(() => md.inventory.upsertBalance({ materialCode: RUN + "-mat", warehouseCode: RUN + "-whb", quantityOnHand: 99 })),
      await maLoi(() => md.inventory.updateBalance({ id: Number(bB.id), quantityOnHand: 99 })),
      await maLoi(() => md.inventory.deleteBalance({ id: Number(bB.id) })),
    ];
    const q = Number((await one(sql`SELECT "quantityOnHand"::float AS q FROM inventory_balances WHERE id = ${bB.id}`)).q);
    const lx = Number((await one(sql`SELECT count(*)::int AS n FROM storage_locations WHERE code = ${RUN + "-lx"}`)).n);
    await md.inventory.createLocation({ warehouseId: wa, code: `${RUN}-la` });
    expect({ l, q, lx }).toEqual({ l: [NF, NF, NF, NF, NF, NF, NF, NF], q: 5, lx: 0 });
  });
});

describe("chứng chỉ kỹ năng — theo NGƯỜI được cấp (lô W7b)", () => {
  it("cấp / sửa / thu hồi cho người nhà máy B hoặc người chưa gán nhà máy ⇒ NOT_FOUND; người nhà máy A ⇒ được", async () => {
    const [sk] = await dung(sql`INSERT INTO skills (code, name) VALUES (${RUN + "-sk"}, 'sk') RETURNING id`);
    const uA = await taoNguoiDungTest("xa", "engineer", { tienTo: "pw7", ts: RUN, ten: "PW7 xa" });
    const uB = await taoNguoiDungTest("xb", "engineer", { tienTo: "pw7", ts: RUN, ten: "PW7 xb" });
    const uZ = await taoNguoiDungTest("xz", "engineer", { tienTo: "pw7", ts: RUN, ten: "PW7 xz" });
    await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uA.id}, ${fA})`);
    await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uB.id}, ${fB})`);
    const skillId = Number(sk.id);
    const ok = await md.skills.grantCertification({ userId: uA.id, skillId });
    const [cb] = await dung(sql`INSERT INTO user_certifications ("userId", "skillId", level) VALUES (${uB.id}, ${skillId}, 'trainee') RETURNING id`);
    const l = [
      await maLoi(() => md.skills.grantCertification({ userId: uB.id, skillId })),
      await maLoi(() => md.skills.grantCertification({ userId: uZ.id, skillId })),
      await maLoi(() => md.userCertifications.assign({ userId: uB.id, skillId })),
      await maLoi(() => md.skills.updateCertification({ id: Number(cb.id), level: "expert" } as never)),
      await maLoi(() => md.skills.revokeCertification({ id: Number(cb.id) })),
      await maLoi(() => md.userCertifications.revoke({ id: Number(cb.id) })),
    ];
    const lv = (await one(sql`SELECT level AS l FROM user_certifications WHERE id = ${cb.id}`))?.l;
    await md.skills.revokeCertification({ id: ok.id });
    expect({ l, lv }).toEqual({ l: [NF, NF, NF, NF, NF, NF], lv: "trainee" });
    await dung(sql`DELETE FROM user_certifications WHERE "skillId" = ${skillId}`);
    await dung(sql`DELETE FROM skills WHERE id = ${skillId}`);
  });
});
