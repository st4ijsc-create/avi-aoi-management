/**
 * ★★★ safety.feed / safety.nearMissTrend — phạm vi nhà máy (rà bảo mật 2026-10-24, tiếp `lenhCongThucPhamVi.db.test.ts`).
 * Luật: sự kiện thấy được ⇔ toàn quyền, HOẶC có ≥1 thuộc tính định vị (line/station/factory/robot) và MỌI thuộc tính định vị đều trong phạm vi. Sự kiện không định vị được chỉ toàn quyền thấy.
 * Test trên CSDL `_test` THẬT: hai nhà máy A/B, người dùng nhà máy B, admin.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `sfp${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay { fid: number; lid: number; sid: number; rid: number; code: string }
let A!: NhaMay;
let B!: NhaMay;
const ev: Record<string, number> = {};
const factories: string[] = [];
let userB: any;
let admin: any;
let userRong: any;

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [r] = await dung(sql`INSERT INTO robots (code, name, vendor, endpoint, "lineId") VALUES (${code}, ${code}, 'sim', 'sim://x', ${l.id}) RETURNING id`);
  factories.push(code);
  return { fid: Number(f.id), lid: Number(l.id), sid: Number(s.id), rid: Number(r.id), code };
}
async function seedEvent(k: string, cols: { lineId?: number; stationId?: number; factoryId?: number; robotId?: number }, nearMiss = false) {
  const [e] = await dung(sql`INSERT INTO safety_events ("eventType", "lineId", "stationId", "factoryId", "robotId", "isNearMiss", notes)
    VALUES ('near_miss', ${cols.lineId ?? null}, ${cols.stationId ?? null}, ${cols.factoryId ?? null}, ${cols.robotId ?? null}, ${nearMiss}, ${RUN + k}) RETURNING id`);
  ev[k] = Number(e.id);
}
async function seedNguoi(ten: string, role: "engineer" | "admin", codes: string[]) {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "sfp", ts: RUN, ten: `SFP ${ten}` });
  for (const code of codes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true, true, true, true)`);
  }
  const { safetyRouter } = await import("./safetyRouter");
  return safetyRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never);
}
const ids = (rows: Array<{ id: number }>) => rows.map((r) => r.id);

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  await seedEvent("aLine", { lineId: A.lid }, true);
  await seedEvent("bLine", { lineId: B.lid }, true);
  await seedEvent("aStation", { stationId: A.sid });
  await seedEvent("bStation", { stationId: B.sid });
  await seedEvent("aFactory", { factoryId: A.fid });
  await seedEvent("bFactory", { factoryId: B.fid });
  await seedEvent("aRobot", { robotId: A.rid });
  await seedEvent("bRobot", { robotId: B.rid });
  await seedEvent("khongDinhVi", {});
  await seedEvent("lai", { lineId: B.lid, factoryId: A.fid }); // định vị mâu thuẫn ⇒ KHÔNG cho B thấy
  userB = await seedNguoi("ub", "engineer", [B.code]);
  userRong = await seedNguoi("ur", "engineer", []);
  admin = await seedNguoi("ad", "admin", []);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await dung(sql`DELETE FROM safety_events WHERE notes LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM robots WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  if (factories.length) await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`).catch(() => undefined);
  for (const t of ["stations", "production_lines", "workshops", "factories"]) {
    await dung(sql`DELETE FROM ${sql.raw(t)} WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  }
});

describe("★★★ safety.feed — chỉ sự kiện của nhà máy mình", () => {
  it("người nhà máy B thấy sự kiện định vị vào B (line/station/factory/robot) và KHÔNG thấy của A, không định vị, mâu thuẫn", async () => {
    const got = ids(await userB.feed({ limit: 500 }));
    for (const k of ["bLine", "bStation", "bFactory", "bRobot"]) expect(got, k).toContain(ev[k]);
    for (const k of ["aLine", "aStation", "aFactory", "aRobot", "khongDinhVi", "lai"]) expect(got, k).not.toContain(ev[k]);
  });
  it("lọc robotId của A ⇒ không trả hàng của A", async () => {
    expect(ids(await userB.feed({ robotId: A.rid, limit: 500 }))).not.toContain(ev.aRobot);
  });
  it("người không gán nhà máy nào ⇒ rỗng (phạm vi rỗng)", async () => {
    const got = ids(await userRong.feed({ limit: 500 }));
    for (const k of Object.keys(ev)) expect(got, k).not.toContain(ev[k]);
  });
  it("đối chứng DƯƠNG: admin thấy tất cả, kể cả sự kiện không định vị", async () => {
    const got = ids(await admin.feed({ limit: 500 }));
    for (const k of Object.keys(ev)) expect(got, k).toContain(ev[k]);
  });
});

describe("★★★ safety.nearMissTrend — chỉ đếm near-miss của nhà máy mình", () => {
  const tong = (r: Array<{ count: number }>) => r.reduce((a, x) => a + x.count, 0);
  it("B đếm đúng 1 near-miss (bLine); admin đếm ≥ 2 (cả aLine)", async () => {
    expect(tong(await userB.nearMissTrend({ sinceDays: 1 }))).toBe(1);
    expect(tong(await userRong.nearMissTrend({ sinceDays: 1 }))).toBe(0);
    expect(tong(await admin.nearMissTrend({ sinceDays: 1 }))).toBeGreaterThanOrEqual(2);
  });
});
