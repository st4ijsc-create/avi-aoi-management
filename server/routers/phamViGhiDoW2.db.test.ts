/**
 * ★★★ Lô W2 — phạm vi nhà máy của thủ tục GHI an toàn / robot / twin / nguyên nhân gốc (kiểm định phamViGhi, 2026-10-24).
 * Khuôn `phamViGhiDo.db.test.ts`: hai nhà máy A/B, kỹ sư CHỈ gán nhà máy A, đủ quyền module, gọi lên thực thể nhà máy B.
 * Luật: ngoài phạm vi ≡ không tồn tại (NOT_FOUND, KHÔNG phải FORBIDDEN) + hàng B không đổi/không phát sinh; thực thể A vẫn dùng được.
 * `safety.*` ngủ sau cờ — test bật cờ trong beforeAll và trả lại ở afterAll. Đường ingest của MÁY/dịch vụ không đi qua tRPC này.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw2${process.pid}${Date.now().toString(36)}`;
const CO = ["SAFETY_ZONE_SW_ENABLED", "SAFETY_AUDIT_ENABLED", "SAFETY_VISION_ENABLED", "WORKFORCE_ENABLED", "AI_ROBOT_ANOMALY_ENABLED", "MODEL_PIPELINE_ENABLED"] as const;
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
  saf: ReturnType<typeof import("./safetyRouter").safetyRouter.createCaller>;
  anom: ReturnType<typeof import("./aiRobotAnomalyRouter").aiRobotAnomalyRouter.createCaller>;
  twin: ReturnType<typeof import("./twinRouter").twinRouter.createCaller>;
  rca: ReturnType<typeof import("./aiRouters").rootCauseRouter.createCaller>;
};
let nguoiB = 0;

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
const dem = async (q: ReturnType<typeof sql>): Promise<number> => Number((await dung(q))[0]?.n ?? 0);
async function seedZone(ma: string, stationId: number): Promise<number> {
  const [r] = await dung(sql`INSERT INTO safety_zones (code, name, "stationId", "stopDistanceMm") VALUES (${ma}, ${ma}, ${stationId}, 1000) RETURNING id`);
  return Number(r.id);
}
async function seedAnomaly(robotId: number): Promise<number> {
  const [r] = await dung(sql`INSERT INTO robot_behavior_anomalies ("robotId", kind, score) VALUES (${robotId}, ${"k" + RUN}, 1.5) RETURNING id`);
  return Number(r.id);
}
async function seedRca(machineId: number | null, factoryId: number | null, requestedBy: number | null): Promise<number> {
  const [r] = await dung(sql`INSERT INTO root_cause_analysis ("analysisType", "machineId", "factoryId", "startDate", "endDate", "dataPointsAnalyzed", "topFactors", "requestedBy", "requestedByName")
    VALUES ('DEFECT_ANALYSIS', ${machineId}, ${factoryId}, now(), now(), 0, '[]'::jsonb, ${requestedBy}, ${RUN}) RETURNING id`);
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
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw2", ts: RUN, ten: "PW2 ua" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [["machine_control", resolvePermissionModule("machine_control")], ["machine_monitoring", resolvePermissionModule("machine_monitoring")], ["analytics", "analytics_root_cause"]] as const) {
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`,
    );
  }
  const ub = await taoNguoiDungTest("ub", "engineer", { tienTo: "pw2", ts: RUN, ten: "PW2 ub" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ub.id}, ${B.code})`);
  nguoiB = ub.id;
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  userA = {
    saf: (await import("./safetyRouter")).safetyRouter.createCaller(ctx),
    anom: (await import("./aiRobotAnomalyRouter")).aiRobotAnomalyRouter.createCaller(ctx),
    twin: (await import("./twinRouter")).twinRouter.createCaller(ctx),
    rca: (await import("./aiRouters")).rootCauseRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  for (const k of CO) {
    if (coCu[k] === undefined) delete process.env[k];
    else process.env[k] = coCu[k];
  }
  if (!db) return;
  const rb = [A?.rid, B?.rid].filter(Boolean) as number[];
  const L = (xs: number[]) => sql.join(xs.map((i) => sql`${i}`), sql`, `);
  await dung(sql`DELETE FROM safety_zones WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM camera_calibrations WHERE "cameraId" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM collaboration_sessions WHERE "operationCode" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM root_cause_analysis WHERE "requestedByName" = ${RUN}`).catch(() => undefined);
  await dung(sql`DELETE FROM equipment_3d_models WHERE "modelKey" LIKE ${RUN + "%"}`).catch(() => undefined);
  if (rb.length) {
    await dung(sql`DELETE FROM robot_behavior_anomalies WHERE "robotId" IN (${L(rb)})`).catch(() => undefined);
    await dung(sql`DELETE FROM safety_events WHERE "robotId" IN (${L(rb)})`).catch(() => undefined);
    await dung(sql`DELETE FROM robots WHERE id IN (${L(rb)})`).catch(() => undefined);
  }
  const fs = [A?.fid, B?.fid].filter(Boolean) as number[];
  if (fs.length) await dung(sql`DELETE FROM safety_events WHERE "factoryId" IN (${L(fs)})`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
}, 60_000);

const NF = "NOT_FOUND";

describe("safety.updateZone / createZone — vùng an toàn của trạm nhà máy khác", () => {
  it("đối chứng: vùng trạm A ⇒ sửa được", async () => {
    const id = await seedZone(`${RUN}-za`, A.sid);
    await userA.saf.updateZone({ id, stopDistanceMm: 900 });
    expect((await dung(sql`SELECT "stopDistanceMm" AS v FROM safety_zones WHERE id = ${id}`))[0]?.v).toBe(900);
  });
  it("updateZone vùng trạm B ⇒ NOT_FOUND, ngưỡng dừng vẫn 1000 mm", async () => {
    const id = await seedZone(`${RUN}-zb`, B.sid);
    const loi = await maLoi(() => userA.saf.updateZone({ id, stopDistanceMm: 600 }));
    expect({ loi, v: (await dung(sql`SELECT "stopDistanceMm" AS v FROM safety_zones WHERE id = ${id}`))[0]?.v }).toEqual({ loi: NF, v: 1000 });
  });
  it("updateZone vùng A nhưng ĐỔI sang trạm B ⇒ NOT_FOUND, vẫn ở trạm A", async () => {
    const id = await seedZone(`${RUN}-zm`, A.sid);
    const loi = await maLoi(() => userA.saf.updateZone({ id, stationId: B.sid }));
    expect({ loi, st: Number((await dung(sql`SELECT "stationId" AS v FROM safety_zones WHERE id = ${id}`))[0]?.v) }).toEqual({ loi: NF, st: A.sid });
  });
  it("createZone: trạm A ⇒ được; trạm B ⇒ NOT_FOUND không hàng; không nêu vị trí ⇒ BAD_REQUEST", async () => {
    await userA.saf.createZone({ code: `${RUN}-ca`, name: "ca", stationId: A.sid, geometry: { aabb: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } } } });
    expect(await dem(sql`SELECT count(*)::int AS n FROM safety_zones WHERE code = ${RUN + "-ca"}`)).toBe(1);
    const lb = await maLoi(() => userA.saf.createZone({ code: `${RUN}-cb`, name: "cb", stationId: B.sid, geometry: { aabb: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } } } }));
    const lr = await maLoi(() => userA.saf.createZone({ code: `${RUN}-cr`, name: "cr", geometry: { aabb: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } } } }));
    const n = await dem(sql`SELECT count(*)::int AS n FROM safety_zones WHERE code IN (${RUN + "-cb"}, ${RUN + "-cr"})`);
    expect({ lb, lr, n }).toEqual({ lb: NF, lr: "BAD_REQUEST", n: 0 });
  });
});

describe("safety.ingest* — bơm sự kiện / khung hình lên robot-trạm nhà máy khác", () => {
  it("ingestProximity: trạm B / robot B / nhà máy B ⇒ NOT_FOUND, không sự kiện; vị trí A ⇒ qua cổng", async () => {
    const truoc = await dem(sql`SELECT count(*)::int AS n FROM safety_events WHERE "stationId" = ${B.sid} OR "robotId" = ${B.rid} OR "factoryId" = ${B.fid}`);
    const base = { distance: 100, confidence: 0.9, source: "test" as const };
    const l1 = await maLoi(() => userA.saf.ingestProximity({ ...base, stationId: B.sid }));
    const l2 = await maLoi(() => userA.saf.ingestProximity({ ...base, robotId: B.rid }));
    const l3 = await maLoi(() => userA.saf.ingestProximity({ ...base, factoryId: B.fid }));
    const l4 = await maLoi(() => userA.saf.ingestProximity({ ...base }));
    const sau = await dem(sql`SELECT count(*)::int AS n FROM safety_events WHERE "stationId" = ${B.sid} OR "robotId" = ${B.rid} OR "factoryId" = ${B.fid}`);
    expect({ l1, l2, l3, l4, delta: sau - truoc }).toEqual({ l1: NF, l2: NF, l3: NF, l4: "BAD_REQUEST", delta: 0 });
    expect(await maLoi(() => userA.saf.ingestProximity({ ...base, stationId: A.sid, robotId: A.rid }))).toBeNull();
  });
  it("ingestSimulatedHuman: filter trạm B / robot B trong danh sách ⇒ NOT_FOUND; filter A ⇒ qua cổng", async () => {
    const human = [{ id: "h1", x: 0, y: 0, confidence: 1 }];
    const l1 = await maLoi(() => userA.saf.ingestSimulatedHuman({ humans: human, robots: [{ id: "r", x: 1, y: 1 }], filter: { stationId: B.sid } }));
    const l2 = await maLoi(() => userA.saf.ingestSimulatedHuman({ humans: human, robots: [{ id: B.rid, x: 1, y: 1 }], filter: { stationId: A.sid } }));
    expect({ l1, l2 }).toEqual({ l1: NF, l2: NF });
    expect(await maLoi(() => userA.saf.ingestSimulatedHuman({ humans: human, robots: [{ id: "r", x: 1, y: 1 }], filter: { stationId: A.sid } }))).toBeNull();
  });
  it("ingestDetectionFrame: máy ảnh hiệu chuẩn cho robot B ⇒ NOT_FOUND; máy ảnh của A ⇒ qua cổng", async () => {
    const homo = JSON.stringify([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    await dung(sql`INSERT INTO camera_calibrations ("cameraId", homography, "robotId", enabled) VALUES (${RUN + "-cb"}, ${homo}::jsonb, ${B.rid}, true)`);
    await dung(sql`INSERT INTO camera_calibrations ("cameraId", homography, "robotId", enabled) VALUES (${RUN + "-ca"}, ${homo}::jsonb, ${A.rid}, true)`);
    const det = [{ x: 10, y: 10, w: 5, h: 5, confidence: 0.9 }];
    expect(await maLoi(() => userA.saf.ingestDetectionFrame({ cameraId: RUN + "-cb", detections: det }))).toBe(NF);
    expect(await maLoi(() => userA.saf.ingestDetectionFrame({ cameraId: RUN + "-ca", detections: det }))).toBeNull();
  });
});

describe("safety.startCollaboration — phiên cộng tác người-robot", () => {
  const dem1 = (op: string) => dem(sql`SELECT count(*)::int AS n FROM collaboration_sessions WHERE "operationCode" = ${op}`);
  it("robot A ⇒ mở được; robot B ⇒ NOT_FOUND không phiên; người vận hành nhà máy B ⇒ NOT_FOUND", async () => {
    await userA.saf.startCollaboration({ operationCode: `${RUN}-s1`, robotDeviceId: A.rid });
    const l1 = await maLoi(() => userA.saf.startCollaboration({ operationCode: `${RUN}-s2`, robotDeviceId: B.rid }));
    const l2 = await maLoi(() => userA.saf.startCollaboration({ operationCode: `${RUN}-s3`, robotDeviceId: A.rid, humanOperatorId: nguoiB }));
    const l3 = await maLoi(() => userA.saf.startCollaboration({ operationCode: `${RUN}-s4` }));
    expect({ l1, l2, l3, a: await dem1(`${RUN}-s1`), b: await dem1(`${RUN}-s2`) + (await dem1(`${RUN}-s3`)) + (await dem1(`${RUN}-s4`)) }).toEqual({ l1: NF, l2: NF, l3: "BAD_REQUEST", a: 1, b: 0 });
  });
});

describe("aiRobotAnomaly.scanRobot / acknowledgeAnomaly — robot nhà máy khác", () => {
  it("scanRobot: robot B ⇒ NOT_FOUND; robot A ⇒ qua cổng", async () => {
    expect(await maLoi(() => userA.anom.scanRobot({ robotId: B.rid }))).toBe(NF);
    expect(await maLoi(() => userA.anom.scanRobot({ robotId: A.rid }))).not.toBe(NF);
  });
  it("acknowledgeAnomaly: bất thường robot B ⇒ NOT_FOUND vẫn 'raised'; robot A ⇒ 'acknowledged'", async () => {
    const ia = await seedAnomaly(A.rid);
    const ib = await seedAnomaly(B.rid);
    await userA.anom.acknowledgeAnomaly({ id: ia });
    const loi = await maLoi(() => userA.anom.acknowledgeAnomaly({ id: ib }));
    const st = async (id: number) => (await dung(sql`SELECT status AS v FROM robot_behavior_anomalies WHERE id = ${id}`))[0]?.v;
    expect({ loi, a: await st(ia), b: await st(ib) }).toEqual({ loi: NF, a: "acknowledged", b: "raised" });
  });
});

describe("twin.pipeline.convertUrdf / convertStep — máy / nhà máy khai kèm", () => {
  const dem1 = (k: string) => dem(sql`SELECT count(*)::int AS n FROM equipment_3d_models WHERE "modelKey" = ${k}`);
  it("máy B / nhà máy B ⇒ NOT_FOUND, không hàng registry (cả URDF lẫn STEP)", async () => {
    const l1 = await maLoi(() => userA.twin.pipeline.convertUrdf({ modelKey: `${RUN}-u1`, sample: "sample-2dof-planar", machineId: B.mid }));
    const l2 = await maLoi(() => userA.twin.pipeline.convertUrdf({ modelKey: `${RUN}-u2`, sample: "sample-2dof-planar", factoryId: B.fid }));
    const l3 = await maLoi(() => userA.twin.pipeline.convertStep({ modelKey: `${RUN}-u3`, sourceFormat: "step", machineId: B.mid }));
    const l4 = await maLoi(() => userA.twin.pipeline.convertStep({ modelKey: `${RUN}-u4`, sourceFormat: "step", factoryId: B.fid }));
    const n = (await dem1(`${RUN}-u1`)) + (await dem1(`${RUN}-u2`)) + (await dem1(`${RUN}-u3`)) + (await dem1(`${RUN}-u4`));
    expect({ l1, l2, l3, l4, n }).toEqual({ l1: NF, l2: NF, l3: NF, l4: NF, n: 0 });
  });
});

describe("rootCause.analyze / update / delete — phân tích nguyên nhân gốc nhà máy khác", () => {
  it("analyze: máy B / nhà máy B ⇒ NOT_FOUND, không hàng", async () => {
    const dau = new Date(Date.now() - 86_400_000);
    const l1 = await maLoi(() => userA.rca.analyze({ analysisType: "DEFECT_ANALYSIS", machineId: B.mid, startDate: dau, endDate: new Date() }));
    const l2 = await maLoi(() => userA.rca.analyze({ analysisType: "DEFECT_ANALYSIS", factoryId: B.fid, startDate: dau, endDate: new Date() }));
    const n = await dem(sql`SELECT count(*)::int AS n FROM root_cause_analysis WHERE "machineId" = ${B.mid} OR "factoryId" = ${B.fid}`);
    expect({ l1, l2, n }).toEqual({ l1: NF, l2: NF, n: 0 });
  });
  it("update / delete: bản của máy B hoặc nhà máy B ⇒ NOT_FOUND, còn nguyên; bản của A xoá được; bản vô chủ của người khác ⇒ NOT_FOUND", async () => {
    const rb = await seedRca(B.mid, null, nguoiB);
    const rf = await seedRca(null, B.fid, nguoiB);
    const ro = await seedRca(null, null, nguoiB);
    const ra = await seedRca(A.mid, null, nguoiB);
    const l = [
      await maLoi(() => userA.rca.update({ id: rb, notes: "x" })),
      await maLoi(() => userA.rca.delete({ id: rb })),
      await maLoi(() => userA.rca.delete({ id: rf })),
      await maLoi(() => userA.rca.delete({ id: ro })),
    ];
    const con = await dem(sql`SELECT count(*)::int AS n FROM root_cause_analysis WHERE id IN (${rb}, ${rf}, ${ro})`);
    await userA.rca.delete({ id: ra });
    expect({ l, con, a: await dem(sql`SELECT count(*)::int AS n FROM root_cause_analysis WHERE id = ${ra}`) }).toEqual({ l: [NF, NF, NF, NF], con: 3, a: 0 });
  });
});
