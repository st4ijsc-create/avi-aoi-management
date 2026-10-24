/**
 * ★★★ Lô W4 — phạm vi nhà máy của thủ tục GHI productRouters khoá theo MÁY (kiểm định phamViGhi, 2026-10-24).
 * Khuôn `phamViGhiDoW2.db.test.ts`: hai nhà máy A/B, kỹ sư CHỈ gán nhà máy A gọi lên máy/ánh xạ của nhà máy B.
 * Chỉ phần khoá theo máy (productMachineMapping.update/delete · measurementSamples.ingest). Phần khoá theo SẢN PHẨM chờ chính sách chủ dự án.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw4${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay {
  fid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const factories: string[] = [];
let pm = 0;
let userA!: {
  map: ReturnType<typeof import("./productRouters").productMachineMappingRouter.createCaller>;
  smp: ReturnType<typeof import("./productRouters").measurementSamplesRouter.createCaller>;
};

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`,
  );
  factories.push(code);
  return { fid: Number(f.id), mid: Number(m.id), code };
}
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
const seedMap = async (machineId: number): Promise<number> =>
  Number((await dung(sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", priority, "isActive") VALUES (${pm}, ${machineId}, 1, true) RETURNING id`))[0].id);
const dongMap = async (id: number) => (await dung(sql`SELECT priority AS p FROM product_machine_mappings WHERE id = ${id}`))[0];

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  pm = Number((await dung(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-pm"}, ${RUN}) RETURNING id`))[0].id);
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw4", ts: RUN, ten: "PW4 ua" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [["machine_control", resolvePermissionModule("machine_control")], ["machine_monitoring", resolvePermissionModule("machine_monitoring")]] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
  }
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  const pr = await import("./productRouters");
  userA = { map: pr.productMachineMappingRouter.createCaller(ctx), smp: pr.measurementSamplesRouter.createCaller(ctx) };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await dung(sql`DELETE FROM measurement_samples WHERE "lotCode" = ${RUN}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_machine_mappings WHERE "productModelId" = ${pm}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_models WHERE id = ${pm}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
}, 60_000);

describe("productMachineMapping.update / delete — ánh xạ sản phẩm↔máy của nhà máy khác", () => {
  it("đối chứng: ánh xạ máy A ⇒ sửa được", async () => {
    const id = await seedMap(A.mid);
    await userA.map.update({ id, priority: 7 });
    expect(Number((await dongMap(id)).p)).toBe(7);
  });
  it("update ánh xạ máy B ⇒ NOT_FOUND, giá trị không đổi", async () => {
    await dung(sql`DELETE FROM product_machine_mappings WHERE "productModelId" = ${pm}`);
    const id = await seedMap(B.mid);
    const loi = await maLoi(() => userA.map.update({ id, priority: 9 }));
    expect({ loi, p: Number((await dongMap(id)).p) }).toEqual({ loi: "NOT_FOUND", p: 1 });
  });
  it("delete ánh xạ máy B ⇒ NOT_FOUND, hàng còn; delete ánh xạ máy A ⇒ xoá được", async () => {
    await dung(sql`DELETE FROM product_machine_mappings WHERE "productModelId" = ${pm}`);
    const ib = await seedMap(B.mid);
    const ia = await seedMap(A.mid);
    const loi = await maLoi(() => userA.map.delete({ id: ib }));
    await userA.map.delete({ id: ia });
    expect({ loi, b: (await dongMap(ib)) !== undefined, a: (await dongMap(ia)) !== undefined }).toEqual({ loi: "NOT_FOUND", b: true, a: false });
  });
});

describe("measurementSamples.ingest — lô mẫu đo ghi lên máy nhà máy khác", () => {
  const dong = (machineId?: number) => ({ pointDefId: 1, ...(machineId ? { machineId } : {}), lotCode: RUN, value: 1.5, sampledAt: new Date() });
  const dem = async (mid: number) => Number((await dung(sql`SELECT count(*)::int AS n FROM measurement_samples WHERE "lotCode" = ${RUN} AND "machineId" = ${mid}`))[0].n);
  it("lô có một dòng máy B ⇒ NOT_FOUND, KHÔNG dòng nào được ghi (kể cả dòng máy A)", async () => {
    const loi = await maLoi(() => userA.smp.ingest({ rows: [dong(A.mid), dong(B.mid)] }));
    expect({ loi, a: await dem(A.mid), b: await dem(B.mid) }).toEqual({ loi: "NOT_FOUND", a: 0, b: 0 });
  });
  it("dòng không nêu máy (phạm vi hẹp) ⇒ BAD_REQUEST, không ghi", async () => {
    expect(await maLoi(() => userA.smp.ingest({ rows: [dong()] }))).toBe("BAD_REQUEST");
  });
  it("đối chứng: toàn dòng máy A ⇒ qua cổng phạm vi (không NOT_FOUND/BAD_REQUEST do phạm vi)", async () => {
    const loi = await maLoi(() => userA.smp.ingest({ rows: [dong(A.mid)] }));
    expect(["NOT_FOUND", "BAD_REQUEST", "FORBIDDEN"]).not.toContain(loi);
  });
});
