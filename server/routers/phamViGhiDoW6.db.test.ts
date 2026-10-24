/**
 * ★★★ Lô W6 — LUẬT GHI THEO SẢN PHẨM (chủ dự án duyệt 2026-10-24) cho productRouters, kiểm định phamViGhi.
 * Ghi được khi sản phẩm TRONG phạm vi (có liên kết tới nhà máy của người gọi) HOẶC CHƯA gắn nhà máy nào (nháp); chặn khi chỉ gắn nhà máy NGOÀI phạm vi.
 * Sản phẩm DÙNG CHUNG nhiều nhà máy: kỹ sư của bất kỳ nhà máy có gắn đều sửa được — "sửa ở A ảnh hưởng B" (GIỚI HẠN ĐÃ CHỐT, có ca ghi nhận ở dưới).
 * Khuôn `phamViGhiDoW4.db.test.ts`: kỹ sư CHỈ gán nhà máy A.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw6${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay {
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const factories: string[] = [];
const sp: Record<string, number> = {}; // sản phẩm: a (gắn A) · b (gắn B) · nhap (chưa gắn) · chung (gắn A và B)
let userA!: {
  pm: ReturnType<typeof import("./productRouters").productModelRouter.createCaller>;
  mp: ReturnType<typeof import("./productRouters").measurementPointRouter.createCaller>;
  map: ReturnType<typeof import("./productRouters").productMachineMappingRouter.createCaller>;
  doc: ReturnType<typeof import("./productRouters").productDocumentRouter.createCaller>;
  spc: ReturnType<typeof import("./productRouters").spcAlertsRouter.createCaller>;
  cad: ReturnType<typeof import("./productRouters").cadImportRouter.createCaller>;
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
  return { mid: Number(m.id), code };
}
async function seedSp(k: string): Promise<number> {
  const [r] = await dung(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-" + k}, ${RUN + "-" + k}) RETURNING id`);
  sp[k] = Number(r.id);
  return sp[k]!;
}
const gan = (k: string, mid: number) => dung(sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", priority, "isActive") VALUES (${sp[k]}, ${mid}, 1, true)`);
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
const ten = async (k: string) => (await dung(sql`SELECT name AS v, "isActive" AS a FROM product_models WHERE id = ${sp[k]}`))[0];
const NF = "NOT_FOUND";

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  for (const k of ["a", "b", "nhap", "chung"]) await seedSp(k);
  await gan("a", A.mid);
  await gan("b", B.mid);
  await gan("chung", A.mid);
  await gan("chung", B.mid);
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw6", ts: RUN, ten: "PW6 ua" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [
    ["settings", "settings_products"],
    ["settings", "settings_measurement_points"],
    ["machine_control", resolvePermissionModule("machine_control")],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
  }
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  const pr = await import("./productRouters");
  userA = {
    pm: pr.productModelRouter.createCaller(ctx),
    mp: pr.measurementPointRouter.createCaller(ctx),
    map: pr.productMachineMappingRouter.createCaller(ctx),
    doc: pr.productDocumentRouter.createCaller(ctx),
    spc: pr.spcAlertsRouter.createCaller(ctx),
    cad: pr.cadImportRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const ids = Object.values(sp);
  if (ids.length) {
    const L = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    await dung(sql`DELETE FROM mp_spc_alerts WHERE "pointDefId" IN (SELECT id FROM measurement_point_defs WHERE "productModelId" IN (${L}))`).catch(() => undefined);
    await dung(sql`DELETE FROM measurement_point_defs WHERE "productModelId" IN (${L})`).catch(() => undefined);
    await dung(sql`DELETE FROM product_documents WHERE "productModelId" IN (${L})`).catch(() => undefined);
    await dung(sql`DELETE FROM product_machine_mappings WHERE "productModelId" IN (${L})`).catch(() => undefined);
    await dung(sql`DELETE FROM product_models WHERE id IN (${L}) OR code LIKE ${RUN + "%"}`).catch(() => undefined);
  }
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
}, 60_000);

describe("productModel.update / delete / clone — theo luật sản phẩm", () => {
  it("sản phẩm gắn A ⇒ sửa được; NHÁP (chưa gắn) ⇒ sửa được; DÙNG CHUNG A+B ⇒ sửa được (giới hạn đã chốt: ảnh hưởng B)", async () => {
    await userA.pm.update({ id: sp.a!, name: "a2" });
    await userA.pm.update({ id: sp.nhap!, name: "nhap2" });
    await userA.pm.update({ id: sp.chung!, name: "chung2" });
    expect([(await ten("a")).v, (await ten("nhap")).v, (await ten("chung")).v]).toEqual(["a2", "nhap2", "chung2"]);
  });
  it("sản phẩm CHỈ gắn B ⇒ update / delete / clone đều NOT_FOUND, sản phẩm nguyên vẹn", async () => {
    const l = [
      await maLoi(() => userA.pm.update({ id: sp.b!, name: "hack" })),
      await maLoi(() => userA.pm.delete({ id: sp.b! })),
      await maLoi(() => userA.pm.clone({ sourceId: sp.b!, newCode: `${RUN}-clone` })),
    ];
    const r = await ten("b");
    const nhan = Number((await dung(sql`SELECT count(*)::int AS n FROM product_models WHERE code = ${RUN + "-clone"}`))[0].n);
    expect({ l, v: r.v, a: r.a, nhan }).toEqual({ l: [NF, NF, NF], v: RUN + "-b", a: true, nhan: 0 });
  });
});

describe("measurementPoint / productMachineMapping / productDocument / cadImport / spc — theo luật sản phẩm", () => {
  const dem1 = async (q: ReturnType<typeof sql>) => Number((await dung(q))[0].n);
  it("measurementPoint.create: sản phẩm B ⇒ NOT_FOUND; máy B trên sản phẩm A ⇒ NOT_FOUND; sản phẩm NHÁP ⇒ qua cổng", async () => {
    const dau = { code: `${RUN}-mp`, name: "mp", positionX: 1, positionY: 1 } as never;
    const l1 = await maLoi(() => userA.mp.create({ productModelId: sp.b!, ...(dau as object) } as never));
    const l2 = await maLoi(() => userA.mp.create({ productModelId: sp.a!, machineId: B.mid, ...(dau as object) } as never));
    const l3 = await maLoi(() => userA.mp.create({ productModelId: sp.nhap!, ...(dau as object) } as never));
    expect({ l1, l2, nhapQuaCong: l3 !== NF, hang: await dem1(sql`SELECT count(*)::int AS n FROM measurement_point_defs WHERE code = ${RUN + "-mp"} AND "productModelId" IN (${sp.b}, ${sp.a})`) }).toEqual({ l1: NF, l2: NF, nhapQuaCong: true, hang: 0 });
  });
  it("measurementPoint.delete / revertPointsConfigToVersion trên sản phẩm B ⇒ NOT_FOUND, điểm còn", async () => {
    const [pt] = await dung(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY") VALUES (${sp.b}, ${RUN + "-pb"}, 'pb', 'DIMENSION', 1, 1) RETURNING id`);
    const l1 = await maLoi(() => userA.mp.delete({ id: Number(pt.id) }));
    const l2 = await maLoi(() => userA.mp.revertPointsConfigToVersion({ productModelId: sp.b!, targetVersion: 1 }));
    expect({ l1, l2, con: await dem1(sql`SELECT count(*)::int AS n FROM measurement_point_defs WHERE id = ${pt.id} AND "deletedAt" IS NULL`) }).toEqual({ l1: NF, l2: NF, con: 1 });
  });
  it("productMachineMapping.create: máy B ⇒ NOT_FOUND; sản phẩm B + máy A ⇒ NOT_FOUND; không hàng mới", async () => {
    const truoc = await dem1(sql`SELECT count(*)::int AS n FROM product_machine_mappings WHERE "productModelId" IN (${sp.a}, ${sp.b})`);
    const l1 = await maLoi(() => userA.map.create({ productModelId: sp.a!, machineId: B.mid, force: true }));
    const l2 = await maLoi(() => userA.map.create({ productModelId: sp.b!, machineId: A.mid, force: true }));
    const sau = await dem1(sql`SELECT count(*)::int AS n FROM product_machine_mappings WHERE "productModelId" IN (${sp.a}, ${sp.b})`);
    expect({ l1, l2, delta: sau - truoc }).toEqual({ l1: NF, l2: NF, delta: 0 });
  });
  it("productDocument.upload / delete, cadImport.parsePreview / applyCoordinates trên sản phẩm B ⇒ NOT_FOUND", async () => {
    const [dc] = await dung(sql`INSERT INTO product_documents ("productModelId", "fileName", "fileKey", "fileUrl", "mimeType") VALUES (${sp.b}, 'x.pdf', ${RUN + "k"}, 'http://x', 'application/pdf') RETURNING id`);
    const l = [
      await maLoi(() => userA.doc.upload({ productModelId: sp.b!, fileName: "x.pdf", fileBase64: "AA==", mimeType: "application/pdf" })),
      await maLoi(() => userA.doc.delete({ id: Number(dc.id) })),
      await maLoi(() => userA.cad.parsePreview({ productModelId: sp.b!, content: "a,b\n1,2" })),
      await maLoi(() => userA.cad.applyCoordinates({ productModelId: sp.b!, content: "a,b\n1,2" })),
    ];
    expect({ l, doc: await dem1(sql`SELECT count(*)::int AS n FROM product_documents WHERE id = ${dc.id}`), up: await dem1(sql`SELECT count(*)::int AS n FROM product_documents WHERE "productModelId" = ${sp.b}`) }).toEqual({ l: [NF, NF, NF, NF], doc: 1, up: 1 });
  });
  it("spcAlerts.ack: cảnh báo của điểm đo sản phẩm B ⇒ NOT_FOUND, chưa ack", async () => {
    const [pt] = await dung(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY") VALUES (${sp.b}, ${RUN + "-ps"}, 'ps', 'DIMENSION', 1, 1) RETURNING id`);
    const [al] = await dung(sql`INSERT INTO mp_spc_alerts ("pointDefId", "ruleCode", "ruleName", "windowFrom", "windowTo") VALUES (${pt.id}, 'R1', 'r1', now(), now()) RETURNING id`);
    const loi = await maLoi(() => userA.spc.ack({ id: Number(al.id) }));
    expect({ loi, acked: await dem1(sql`SELECT count(*)::int AS n FROM mp_spc_alerts WHERE id = ${al.id} AND "ackAt" IS NOT NULL`) }).toEqual({ loi: NF, acked: 0 });
  });
});
