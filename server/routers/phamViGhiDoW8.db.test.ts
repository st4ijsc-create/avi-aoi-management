/**
 * ★★★ Lô W8 — phạm vi nhà máy của thủ tục GHI ĐIỀU KHIỂN: interlock (luật + sự kiện) · lineController (tuyến + recipe set) · safety còn lại
 * (recordEvent · auditEvent · upsertCameraCalibration · signalHandshake · advancePhase · abortCollaboration), kiểm định phamViGhi 2026-10-24.
 * Kỹ sư CHỈ gán nhà máy A (đủ quyền, role engineer + 2FA) gọi lên tuyến/máy/robot của nhà máy B. Ngoài phạm vi ≡ NOT_FOUND + trạng thái B không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw8${process.pid}${Date.now().toString(36)}`;
const CO = ["SAFETY_AUDIT_ENABLED", "SAFETY_VISION_ENABLED", "WORKFORCE_ENABLED"] as const;
const coCu: Record<string, string | undefined> = {};
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay {
  fid: number;
  lid: number;
  sid: number;
  mid: number;
  rid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const factories: string[] = [];
let userA!: {
  ilk: ReturnType<typeof import("./interlockRouter").interlockRouter.createCaller>;
  lc: ReturnType<typeof import("./lineControllerRouter").lineControllerRouter.createCaller>;
  saf: ReturnType<typeof import("./safetyRouter").safetyRouter.createCaller>;
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
  const [r] = await dung(sql`INSERT INTO robots (code, name, vendor, endpoint, "lineId") VALUES (${code}, ${code}, 'sim', 'sim://x', ${l.id}) RETURNING id`);
  factories.push(code);
  return { fid: Number(f.id), lid: Number(l.id), sid: Number(s.id), mid: Number(m.id), rid: Number(r.id), code };
}
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
const luatInput = (machineId: number, ten: string) => ({
  name: `${RUN}-${ten}`,
  scope: "machine" as const,
  machineId,
  sourceType: "ng_rate" as const,
  comparisonOperator: "gt" as const,
  threshold: 0.5,
  action: "alert" as const,
});
async function seedLuat(machineId: number, ten: string): Promise<number> {
  const [r] = await dung(sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceType", "comparisonOperator", threshold, action, enabled)
    VALUES (${`${RUN}-${ten}`}, 'machine', ${machineId}, 'ng_rate', 'gt', '0.5', 'alert', false) RETURNING id`);
  return Number(r.id);
}

beforeAll(async () => {
  for (const k of CO) {
    coCu[k] = process.env[k];
    process.env[k] = "true";
  }
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw8", ts: RUN, ten: "PW8 ua" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [
    ["interlock", resolvePermissionModule("interlock")],
    ["machine_control", resolvePermissionModule("machine_control")],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
  }
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  userA = {
    ilk: (await import("./interlockRouter")).interlockRouter.createCaller(ctx),
    lc: (await import("./lineControllerRouter")).lineControllerRouter.createCaller(ctx),
    saf: (await import("./safetyRouter")).safetyRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  for (const k of CO) {
    if (coCu[k] === undefined) delete process.env[k];
    else process.env[k] = coCu[k];
  }
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM interlock_events WHERE "ruleId" IN (SELECT id FROM interlock_rules WHERE name LIKE ${like})`).catch(() => undefined);
  await dung(sql`DELETE FROM interlock_rules WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM recipe_set_items WHERE recipe_set_id IN (SELECT id FROM recipe_sets WHERE code LIKE ${like})`).catch(() => undefined);
  await dung(sql`DELETE FROM recipe_sets WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM machine_recipes WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM camera_calibrations WHERE "cameraId" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM collaboration_sessions WHERE "operationCode" LIKE ${like}`).catch(() => undefined);
  const rb = [A?.rid, B?.rid].filter(Boolean) as number[];
  if (rb.length) {
    const L = sql.join(rb.map((i) => sql`${i}`), sql`, `);
    await dung(sql`DELETE FROM safety_events WHERE "robotId" IN (${L}) OR notes LIKE ${like}`).catch(() => undefined);
    await dung(sql`DELETE FROM robots WHERE id IN (${L})`).catch(() => undefined);
  }
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("interlock — luật & sự kiện của máy nhà máy khác", () => {
  it("đối chứng: luật máy A ⇒ tạo / sửa được", async () => {
    const r = await userA.ilk.create(luatInput(A.mid, "ca"));
    expect(r.id).toBeGreaterThan(0);
    await userA.ilk.update({ id: r.id, description: "do-a" });
  });
  it("create nhắm máy B / update đẩy luật A sang máy B ⇒ NOT_FOUND, không luật mới", async () => {
    const lb = await maLoi(() => userA.ilk.create(luatInput(B.mid, "cb")));
    const ia = await seedLuat(A.mid, "mv");
    const lm = await maLoi(() => userA.ilk.update({ id: ia, machineId: B.mid }));
    const mid = Number((await one(sql`SELECT "machineId" AS m FROM interlock_rules WHERE id = ${ia}`)).m);
    expect({ lb, lm, hangB: Number((await one(sql`SELECT count(*)::int AS n FROM interlock_rules WHERE name = ${RUN + "-cb"}`)).n), mid }).toEqual({ lb: NF, lm: NF, hangB: 0, mid: A.mid });
  });
  it("update / delete / enable / disable luật máy B ⇒ NOT_FOUND, luật B nguyên vẹn; resolveEvent sự kiện của luật B ⇒ NOT_FOUND", async () => {
    const ib = await seedLuat(B.mid, "b");
    const [ev] = await dung(sql`INSERT INTO interlock_events ("ruleId") VALUES (${ib}) RETURNING id`);
    const l = [
      await maLoi(() => userA.ilk.update({ id: ib, description: "hack" })),
      await maLoi(() => userA.ilk.delete({ id: ib, reason: "hack hack" })),
      await maLoi(() => userA.ilk.enable({ id: ib, expectedVersion: "x" } as never)),
      await maLoi(() => userA.ilk.disable({ id: ib, reason: "hack hack" })),
      ...(Number(ev.id) > 0 ? [await maLoi(() => userA.ilk.resolveEvent({ id: Number(ev.id), reason: "hack hack" }))] : [NF]),
    ];
    const r = await one(sql`SELECT description AS d FROM interlock_rules WHERE id = ${ib}`);
    expect({ l, con: r !== undefined, d: r?.d ?? null }).toEqual({ l: [NF, NF, NF, NF, NF], con: true, d: null });
  });
});

describe("lineController — tuyến & recipe set của nhà máy khác", () => {
  it("transition / command / distribute lên tuyến B ⇒ NOT_FOUND; tuyến A qua cổng", async () => {
    const [set] = await dung(sql`INSERT INTO recipe_sets (code) VALUES (${RUN + "-vuong"}) RETURNING id`);
    const l = [
      await maLoi(() => userA.lc.transition({ lineId: B.lid, to: "ready" } as never)),
      await maLoi(() => userA.lc.command({ lineId: B.lid, command: "hold" } as never)),
      await maLoi(() => userA.lc.recipeSet.distribute({ lineId: B.lid, recipeSetId: Number(set.id) })),
    ];
    const a1 = await maLoi(() => userA.lc.transition({ lineId: A.lid, to: "ready" } as never));
    expect({ l, aQuaCong: a1 !== NF }).toEqual({ l: [NF, NF, NF], aQuaCong: true });
  });
  it("recipe set có máy nhà máy B: unlock / removeItem / addItem ⇒ NOT_FOUND; set rỗng (nháp) và máy A qua cổng", async () => {
    const [rc] = await dung(sql`INSERT INTO machine_recipes (code, name, version, payload, status, "machineId") VALUES (${RUN + "-rc"}, 'rc', 1, '{}'::jsonb, 'draft', ${B.mid}) RETURNING id`);
    const [setB] = await dung(sql`INSERT INTO recipe_sets (code) VALUES (${RUN + "-setb"}) RETURNING id`);
    await dung(sql`INSERT INTO recipe_set_items (recipe_set_id, machine_id, machine_recipe_id) VALUES (${setB.id}, ${B.mid}, ${rc.id})`);
    const [setA] = await dung(sql`INSERT INTO recipe_sets (code) VALUES (${RUN + "-seta"}) RETURNING id`);
    const l = [
      await maLoi(() => userA.lc.recipeSet.unlock({ id: Number(setB.id) } as never)),
      await maLoi(() => userA.lc.recipeSet.removeItem({ recipeSetId: Number(setB.id), itemId: 1 })),
      await maLoi(() => userA.lc.recipeSet.addItem({ recipeSetId: Number(setA.id), machineId: B.mid, machineRecipeId: Number(rc.id) })),
      await maLoi(() => userA.lc.recipeSet.addItem({ recipeSetId: Number(setB.id), machineId: A.mid, machineRecipeId: Number(rc.id) })),
    ];
    const itemsB = Number((await one(sql`SELECT count(*)::int AS n FROM recipe_set_items WHERE recipe_set_id = ${setB.id}`)).n);
    const itemsA = Number((await one(sql`SELECT count(*)::int AS n FROM recipe_set_items WHERE recipe_set_id = ${setA.id}`)).n);
    expect({ l, itemsB, itemsA }).toEqual({ l: [NF, NF, NF, NF], itemsB: 1, itemsA: 0 });
  });
});

describe("safety còn lại — sự kiện · phiên cộng tác · hiệu chuẩn máy ảnh", () => {
  it("recordEvent: robot / trạm B ⇒ NOT_FOUND không sự kiện; trạm A ⇒ qua cổng", async () => {
    const base = { eventType: "near_miss" as const, notes: `${RUN}-ev` };
    const l1 = await maLoi(() => userA.saf.recordEvent({ ...base, robotId: B.rid }));
    const l2 = await maLoi(() => userA.saf.recordEvent({ ...base, stationId: B.sid }));
    const l3 = await maLoi(() => userA.saf.recordEvent({ ...base }));
    const ok = await maLoi(() => userA.saf.recordEvent({ ...base, stationId: A.sid }));
    expect({ l1, l2, l3, ok, n: Number((await one(sql`SELECT count(*)::int AS n FROM safety_events WHERE notes = ${RUN + "-ev"} AND "stationId" = ${B.sid}`)).n) }).toEqual({ l1: NF, l2: NF, l3: "BAD_REQUEST", ok: null, n: 0 });
  });
  it("auditEvent: sự kiện robot B ⇒ NOT_FOUND, chưa ký kiểm tra", async () => {
    const [e] = await dung(sql`INSERT INTO safety_events ("eventType", "robotId", notes) VALUES ('near_miss', ${B.rid}, ${RUN + "-ae"}) RETURNING id`);
    const loi = await maLoi(() => userA.saf.auditEvent({ eventId: Number(e.id) }));
    const r = await one(sql`SELECT "auditedBy" AS a FROM safety_events WHERE id = ${e.id}`);
    expect({ loi, daKy: r?.a != null }).toEqual({ loi: NF, daKy: false });
  });
  it("signalHandshake / advancePhase / abortCollaboration phiên robot B ⇒ NOT_FOUND, phiên nguyên vẹn", async () => {
    const [c] = await dung(sql`INSERT INTO collaboration_sessions ("operationCode", "robotDeviceId", phase, "handshakeState") VALUES (${RUN + "-cs"}, ${B.rid}, 'human_prep', 'pending') RETURNING id`);
    const id = Number(c.id);
    const l = [
      await maLoi(() => userA.saf.signalHandshake({ sessionId: id, state: "ack" })),
      await maLoi(() => userA.saf.advancePhase({ sessionId: id })),
      await maLoi(() => userA.saf.abortCollaboration({ sessionId: id, reason: "hack" })),
    ];
    const r = await one(sql`SELECT phase AS p, "handshakeState" AS h, "endedAt" AS e FROM collaboration_sessions WHERE id = ${id}`);
    expect({ l, p: r.p, h: r.h, ended: r.e != null }).toEqual({ l: [NF, NF, NF], p: "human_prep", h: "pending", ended: false });
  });
  it("upsertCameraCalibration: robot B ⇒ NOT_FOUND không hàng; robot A ⇒ qua cổng", async () => {
    const homo = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const lb = await maLoi(() => userA.saf.upsertCameraCalibration({ cameraId: `${RUN}-cb`, homography: homo, robotId: B.rid }));
    const la = await maLoi(() => userA.saf.upsertCameraCalibration({ cameraId: `${RUN}-ca`, homography: homo, robotId: A.rid }));
    expect({ lb, la, n: Number((await one(sql`SELECT count(*)::int AS n FROM camera_calibrations WHERE "cameraId" = ${RUN + "-cb"}`)).n) }).toEqual({ lb: NF, la: null, n: 0 });
  });
});
