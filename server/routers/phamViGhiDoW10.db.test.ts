/**
 * ★★★ Lô W7c — THIẾT BỊ ĐO THEO NHÀ MÁY (migration 0421: `measurement_instruments."factoryId"`), kiểm định phamViGhi 2026-10-25.
 * Thiết bị thấy được ⇔ factoryId ∈ phạm vi (NULL ⇒ chỉ toàn quyền); hiệu chuẩn / bản ghi MSA / nghiên cứu MSA suy qua instrumentId.
 * Kỹ sư CHỈ gán nhà máy A đọc / phân tích thiết bị nhà máy B và thiết bị chưa gán; admin thấy tất cả. Yêu cầu CSDL `_test` đã áp 0421.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw10${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const ids: Record<string, number> = {};
const studies: Record<string, number> = {};
let fidA = 0;
let fidB = 0;
let pm = 0;
type Caller = {
  inst: ReturnType<typeof import("./productRouters").measurementInstrumentRouter.createCaller>;
  cal: ReturnType<typeof import("./productRouters").instrumentCalibrationRouter.createCaller>;
  msaRec: ReturnType<typeof import("./productRouters").instrumentMsaRecordRouter.createCaller>;
  msa: ReturnType<typeof import("./productRouters").msaWizardRouter.createCaller>;
  adv: ReturnType<typeof import("./productRouters").msaAdvancedRouter.createCaller>;
};
let userA!: Caller;
let admin!: Caller;
const nhom = async (ctx: never): Promise<Caller> => {
  const p = await import("./productRouters");
  return {
    inst: p.measurementInstrumentRouter.createCaller(ctx),
    cal: p.instrumentCalibrationRouter.createCaller(ctx),
    msaRec: p.instrumentMsaRecordRouter.createCaller(ctx),
    msa: p.msaWizardRouter.createCaller(ctx),
    adv: p.msaAdvancedRouter.createCaller(ctx),
  };
};
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
const NF = "NOT_FOUND";

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const fa = `${RUN}a`;
  const fb = `${RUN}b`;
  fidA = Number((await dung(sql`INSERT INTO factories (code, name) VALUES (${fa}, ${fa}) RETURNING id`))[0].id);
  fidB = Number((await dung(sql`INSERT INTO factories (code, name) VALUES (${fb}, ${fb}) RETURNING id`))[0].id);
  pm = Number((await dung(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-pm"}, ${RUN}) RETURNING id`))[0].id);
  for (const [k, f] of [["a", fidA], ["b", fidB], ["n", null]] as const) {
    ids[k] = Number((await dung(sql`INSERT INTO measurement_instruments (code, name, "instrumentType", "factoryId") VALUES (${`${RUN}-${k}`}, ${`${RUN}-${k}`}, 'caliper', ${f}) RETURNING id`))[0].id);
    await dung(sql`INSERT INTO instrument_calibrations ("instrumentId", "certNumber", "performedAt", "validUntil") VALUES (${ids[k]}, ${`C-${RUN}-${k}`}, now(), now() + interval '1 year')`);
    await dung(sql`INSERT INTO instrument_msa_records ("instrumentId", "validUntil") VALUES (${ids[k]}, now() + interval '1 year')`);
    studies[k] = Number((await dung(sql`INSERT INTO msa_studies ("productModelId", "studyCode", name, "instrumentId") VALUES (${pm}, ${`S-${RUN}-${k}`}, ${`S-${k}`}, ${ids[k]}) RETURNING id`))[0].id);
  }
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw10", ts: RUN, ten: "PW10 ua" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${fa})`);
  userA = await nhom({ user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never);
  const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "pw10", ts: RUN, ten: "PW10 admin" });
  admin = await nhom({ user: { id: ad.id, role: "admin", name: ad.name, twoFactorEnabled: true } } as never);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  const L = sql.join(Object.values(ids).map((i) => sql`${i}`), sql`, `);
  await dung(sql`DELETE FROM msa_studies WHERE "studyCode" LIKE ${"S-" + like}`).catch(() => undefined);
  await dung(sql`DELETE FROM instrument_msa_records WHERE "instrumentId" IN (${L})`).catch(() => undefined);
  await dung(sql`DELETE FROM instrument_calibrations WHERE "instrumentId" IN (${L})`).catch(() => undefined);
  await dung(sql`DELETE FROM measurement_instruments WHERE id IN (${L})`).catch(() => undefined);
  await dung(sql`DELETE FROM product_models WHERE id = ${pm}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("thiết bị đo theo nhà máy — ĐỌC", () => {
  it("list: kỹ sư nhà máy A chỉ thấy thiết bị A; admin thấy cả A, B và chưa gán", async () => {
    const co = (rows: Array<{ code: string }>) => rows.map((r) => r.code).filter((c) => c.startsWith(RUN)).sort();
    expect(co(await userA.inst.list({ includeInactive: true }))).toEqual([`${RUN}-a`]);
    expect(co(await admin.inst.list({ includeInactive: true }))).toEqual([`${RUN}-a`, `${RUN}-b`, `${RUN}-n`]);
  });
  it("getById: thiết bị B / chưa gán ⇒ như không tồn tại; thiết bị A ⇒ thấy", async () => {
    expect((await userA.inst.getById({ id: ids.a! }))?.code).toBe(`${RUN}-a`);
    expect(await userA.inst.getById({ id: ids.b! })).toBeUndefined();
    expect(await userA.inst.getById({ id: ids.n! })).toBeUndefined();
    expect((await admin.inst.getById({ id: ids.n! }))?.code).toBe(`${RUN}-n`);
  });
  it("hiệu chuẩn / MSA / sức khoẻ thiết bị: suy qua instrumentId", async () => {
    expect((await userA.cal.list({ instrumentId: ids.a! })).length).toBe(1);
    expect(await userA.cal.list({ instrumentId: ids.b! })).toEqual([]);
    expect(await userA.cal.list({ instrumentId: ids.n! })).toEqual([]);
    expect(await userA.msaRec.list({ instrumentId: ids.b! })).toEqual([]);
    expect((await userA.msaRec.list({ instrumentId: ids.a! })).length).toBe(1);
    expect(await maLoi(() => userA.cal.health({ instrumentId: ids.b! }))).toBe(NF);
    expect(await maLoi(() => userA.cal.health({ instrumentId: ids.a! }))).toBeNull();
    expect((await admin.cal.list({ instrumentId: ids.b! })).length).toBe(1);
  });
  it("nghiên cứu MSA: listByProduct chỉ gồm nghiên cứu thiết bị A; getStudy / anovaOfStudy của thiết bị B hoặc chưa gán ⇒ NOT_FOUND", async () => {
    const ds = await userA.msa.listByProduct({ productModelId: pm });
    expect(ds.map((s) => s.studyCode).sort()).toEqual([`S-${RUN}-a`]);
    expect((await admin.msa.listByProduct({ productModelId: pm })).length).toBe(3);
    expect(await maLoi(() => userA.msa.getStudy({ studyId: studies.b! }))).toBe(NF);
    expect(await maLoi(() => userA.msa.getStudy({ studyId: studies.n! }))).toBe(NF);
    expect(await maLoi(() => userA.msa.getStudy({ studyId: studies.a! }))).toBeNull();
    expect(await maLoi(() => userA.adv.anovaOfStudy({ studyId: studies.b! }))).toBe(NF);
    expect(await maLoi(() => userA.adv.anovaOfStudy({ studyId: studies.n! }))).toBe(NF);
    expect(await maLoi(() => userA.adv.anovaOfStudy({ studyId: studies.a! }))).not.toBe(NF);
  });
});

describe("thiết bị đo theo nhà máy — admin GÁN nhà máy", () => {
  it("admin gán factoryId cho thiết bị chưa gán ⇒ kỹ sư nhà máy đó thấy ngay", async () => {
    expect(await userA.inst.getById({ id: ids.n! })).toBeUndefined();
    await admin.inst.update({ id: ids.n!, factoryId: fidA });
    expect((await userA.inst.getById({ id: ids.n! }))?.code).toBe(`${RUN}-n`);
    await admin.inst.update({ id: ids.n!, factoryId: null });
    expect(await userA.inst.getById({ id: ids.n! })).toBeUndefined();
  });
});
