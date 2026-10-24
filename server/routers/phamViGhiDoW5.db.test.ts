/**
 * ★★★ Lô W5 — phạm vi nhà máy của thủ tục GHI cây phân cấp (factory · zone · workshop · line · station · machine), kiểm định phamViGhi 2026-10-24.
 * Khuôn `phamViGhiDoW2.db.test.ts`: kỹ sư CHỈ gán nhà máy A (đủ quyền settings_factory/machine_control) gọi lên cây của nhà máy B.
 * Luật: ngoài phạm vi ≡ không tồn tại (NOT_FOUND) + hàng B không đổi/không mất; cây A vẫn dùng được; gắn con vào cha của B bị từ chối.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw5${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay {
  fid: number;
  wid: number;
  lid: number;
  sid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const factories: string[] = [];
let userA!: {
  fac: ReturnType<typeof import("./hierarchyRouters").factoryRouter.createCaller>;
  zone: ReturnType<typeof import("./hierarchyRouters").factoryZoneRouter.createCaller>;
  ws: ReturnType<typeof import("./hierarchyRouters").workshopRouter.createCaller>;
  line: ReturnType<typeof import("./hierarchyRouters").lineRouter.createCaller>;
  st: ReturnType<typeof import("./hierarchyRouters").stationRouter.createCaller>;
  mc: ReturnType<typeof import("./hierarchyRouters").machineRouter.createCaller>;
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
  return { fid: Number(f.id), wid: Number(w.id), lid: Number(l.id), sid: Number(s.id), mid: Number(m.id), code };
}
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
const dem = async (q: ReturnType<typeof sql>): Promise<number> => Number((await dung(q))[0]?.n ?? 0);
const NF = "NOT_FOUND";

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw5", ts: RUN, ten: "PW5 ua" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [["settings", "settings_factory"], ["machine_control", resolvePermissionModule("machine_control")]] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
  }
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  const h = await import("./hierarchyRouters");
  userA = {
    fac: h.factoryRouter.createCaller(ctx),
    zone: h.factoryZoneRouter.createCaller(ctx),
    ws: h.workshopRouter.createCaller(ctx),
    line: h.lineRouter.createCaller(ctx),
    st: h.stationRouter.createCaller(ctx),
    mc: h.machineRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await dung(sql`DELETE FROM factory_zones WHERE name LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM stations WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM production_lines WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM workshops WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
}, 60_000);

describe("factory / factoryZone — nhà máy & vùng mặt bằng của nhà máy khác", () => {
  it("đối chứng: nhà máy A ⇒ sửa được", async () => {
    await userA.fac.update({ id: A.fid, description: "do-a" });
    expect((await dung(sql`SELECT description AS v FROM factories WHERE id = ${A.fid}`))[0]?.v).toBe("do-a");
  });
  it("update / updateMapPosition / updateFloorDims / delete / restore nhà máy B ⇒ NOT_FOUND, B nguyên vẹn", async () => {
    const l = [
      await maLoi(() => userA.fac.update({ id: B.fid, description: "hack" })),
      await maLoi(() => userA.fac.updateMapPosition({ id: B.fid, mapPositionX: 0.1, mapPositionY: 0.1 })),
      await maLoi(() => userA.fac.updateFloorDims({ id: B.fid, floorWidthM: 5 })),
      await maLoi(() => userA.fac.delete({ id: B.fid, cascade: true })),
      await maLoi(() => userA.fac.restore({ id: B.fid })),
    ];
    const r = (await dung(sql`SELECT description AS d, "isActive" AS x FROM factories WHERE id = ${B.fid}`))[0];
    expect({ l, desc: r?.d ?? null, xoa: r?.x }).toEqual({ l: [NF, NF, NF, NF, NF], desc: null, xoa: true });
  });
  it("factoryZone: tạo vào nhà máy B / sửa / xoá vùng của B ⇒ NOT_FOUND; vùng A thao tác được", async () => {
    const za = await userA.zone.create({ factoryId: A.fid, name: `${RUN}-za` });
    const [zb] = await dung(sql`INSERT INTO factory_zones ("factoryId", name, color, points) VALUES (${B.fid}, ${RUN + "-zb"}, '#fff', '[]'::jsonb) RETURNING id`);
    const l = [
      await maLoi(() => userA.zone.create({ factoryId: B.fid, name: `${RUN}-zx` })),
      await maLoi(() => userA.zone.update({ id: Number(zb.id), name: `${RUN}-hack` })),
      await maLoi(() => userA.zone.delete({ id: Number(zb.id) })),
    ];
    await userA.zone.delete({ id: za.id });
    const con = await dem(sql`SELECT count(*)::int AS n FROM factory_zones WHERE id = ${zb.id} AND name = ${RUN + "-zb"}`);
    expect({ l, con, zx: await dem(sql`SELECT count(*)::int AS n FROM factory_zones WHERE name = ${RUN + "-zx"}`) }).toEqual({ l: [NF, NF, NF], con: 1, zx: 0 });
  });
});

describe("workshop / line / station — cây của nhà máy khác", () => {
  it("workshop: update/delete(cascade)/restore xưởng B ⇒ NOT_FOUND; create dưới nhà máy B ⇒ NOT_FOUND; chuyển xưởng A sang nhà máy B ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => userA.ws.update({ id: B.wid, description: "hack" })),
      await maLoi(() => userA.ws.delete({ id: B.wid, cascade: true })),
      await maLoi(() => userA.ws.restore({ id: B.wid })),
      await maLoi(() => userA.ws.create({ factoryId: B.fid, code: `${RUN}-wx`, name: "wx" })),
      await maLoi(() => userA.ws.update({ id: A.wid, factoryId: B.fid })),
    ];
    const w = (await dung(sql`SELECT "factoryId" AS f, "isActive" AS x FROM workshops WHERE id = ${B.wid}`))[0];
    expect({ l, bf: Number(w?.f), xoa: w?.x, wx: await dem(sql`SELECT count(*)::int AS n FROM workshops WHERE code = ${RUN + "-wx"}`), aFac: Number((await dung(sql`SELECT "factoryId" AS f FROM workshops WHERE id = ${A.wid}`))[0].f) }).toEqual({ l: [NF, NF, NF, NF, NF], bf: B.fid, xoa: true, wx: 0, aFac: A.fid });
    await userA.ws.update({ id: A.wid, description: "ok-a" });
  });
  it("line: update/delete/restore chuyền B ⇒ NOT_FOUND; create dưới xưởng B ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => userA.line.update({ id: B.lid, description: "hack" })),
      await maLoi(() => userA.line.delete({ id: B.lid, cascade: true })),
      await maLoi(() => userA.line.restore({ id: B.lid })),
      await maLoi(() => userA.line.create({ workshopId: B.wid, code: `${RUN}-lx`, name: "lx" })),
      await maLoi(() => userA.line.update({ id: A.lid, workshopId: B.wid })),
    ];
    expect({ l, lx: await dem(sql`SELECT count(*)::int AS n FROM production_lines WHERE code = ${RUN + "-lx"}`), con: await dem(sql`SELECT count(*)::int AS n FROM production_lines WHERE id = ${B.lid} AND "isActive" = true`) }).toEqual({ l: [NF, NF, NF, NF, NF], lx: 0, con: 1 });
  });
  it("station: update/delete/restore trạm B ⇒ NOT_FOUND; create dưới chuyền B ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => userA.st.update({ id: B.sid, description: "hack" })),
      await maLoi(() => userA.st.delete({ id: B.sid, cascade: true })),
      await maLoi(() => userA.st.restore({ id: B.sid })),
      await maLoi(() => userA.st.create({ lineId: B.lid, code: `${RUN}-sx`, name: "sx" })),
      await maLoi(() => userA.st.update({ id: A.sid, lineId: B.lid })),
    ];
    expect({ l, sx: await dem(sql`SELECT count(*)::int AS n FROM stations WHERE code = ${RUN + "-sx"}`), con: await dem(sql`SELECT count(*)::int AS n FROM stations WHERE id = ${B.sid} AND "isActive" = true`) }).toEqual({ l: [NF, NF, NF, NF, NF], sx: 0, con: 1 });
  });
});

describe("machine — máy của nhà máy khác", () => {
  it("đối chứng: máy A ⇒ sửa được, tạo dưới trạm A được", async () => {
    await userA.mc.update({ id: A.mid, description: "do-a" });
    expect((await dung(sql`SELECT description AS v FROM machines WHERE id = ${A.mid}`))[0]?.v).toBe("do-a");
    const r = await userA.mc.create({ stationId: A.sid, code: `${RUN}-ma`, name: "ma", machineType: "AOI" } as never);
    expect(r).toBeTruthy();
  });
  it("create dưới trạm B / update / delete / restore / setLifecycleStatus / updateLayout(+Position) máy B ⇒ NOT_FOUND, B nguyên vẹn; chuyển máy A sang trạm B ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => userA.mc.create({ stationId: B.sid, code: `${RUN}-mx`, name: "mx", machineType: "AOI" } as never)),
      await maLoi(() => userA.mc.update({ id: B.mid, description: "hack" })),
      await maLoi(() => userA.mc.delete({ id: B.mid })),
      await maLoi(() => userA.mc.restore({ id: B.mid })),
      await maLoi(() => userA.mc.setLifecycleStatus({ id: B.mid, status: "retired", reason: "hack hack" } as never)),
      await maLoi(() => userA.mc.updateLayout({ id: B.mid, x: 0.5, y: 0.5 })),
      await maLoi(() => userA.mc.updateLayoutPosition({ id: B.mid, layoutPositionX: 0.5, layoutPositionY: 0.5 })),
      await maLoi(() => userA.mc.update({ id: A.mid, stationId: B.sid })),
    ];
    const m = (await dung(sql`SELECT description AS d, "isActive" AS x, "lifecycleStatus" AS ls FROM machines WHERE id = ${B.mid}`))[0];
    expect({ l, d: m?.d ?? null, x: m?.x, mx: await dem(sql`SELECT count(*)::int AS n FROM machines WHERE code = ${RUN + "-mx"}`), aSt: Number((await dung(sql`SELECT "stationId" AS s FROM machines WHERE id = ${A.mid}`))[0].s) }).toEqual({ l: [NF, NF, NF, NF, NF, NF, NF, NF], d: null, x: true, mx: 0, aSt: A.sid });
  });
});
