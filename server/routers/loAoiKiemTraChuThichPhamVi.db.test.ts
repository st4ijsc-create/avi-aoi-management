/**
 * CỔNG CSDL THẬT — lô L1 (rà bảo mật tRPC nhóm A, 2026-10-24): aoiPackage · inspection/measurementResult · annotation · annotationComparison theo PHẠM VI người dùng.
 *
 * Lỗ: tài khoản gán nhà máy A (chỉ cần đăng nhập — `protectedProcedure`) tải ZIP gói ảnh kiểm tra, ảnh, nhật ký, chi tiết kiểm tra + kết quả đo, chú thích ảnh, so sánh và số tổng hợp của
 * MỌI nhà máy theo id / theo khoảng ngày. Luật: dữ liệu thuộc MÁY (qua `machineId` của gói / lần kiểm tra); máy ngoài phạm vi ≡ "không tồn tại" (NOT_FOUND cùng thực thể, hoặc danh sách rỗng
 * cho thủ tục kiểu danh sách theo id); danh sách/tổng hợp chỉ tính máy trong phạm vi; admin (phạm vi toàn quyền) không đổi; người dùng không gán nhà máy ⇒ rỗng.
 * Riêng aoiPackage.getImage: kiểm cả path-traversal (fileName / pointCode) — phải BAD_REQUEST, KHÔNG đọc tệp ngoài gói.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `l1${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

interface Nm { fid: number; mid: number; code: string; pkgId: number; pkgCode: string; insp: number; mr: number; ann: number; imgUrl: string; userId: number }
let A!: Nm;
let B!: Nm;
let sessA = 0, sessB = 0, sessMix = 0, sessKhaiB = 0;
const factories: string[] = [];
const uids: number[] = [];
let uA: any, uRong: any, uAdmin: any;
let R: { aoiPackage: any; inspection: any; measurementResult: any; annotation: any; annotationComparison: any };

async function chiTiet(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const x = e as { code?: string };
    const meta = readAppErrorMeta(e);
    const pr = (meta?.appParams ?? {}) as { entity?: string; operation?: string; field?: string };
    return `${x.code ?? "?"}:${meta?.appCode ?? "?"}:${pr.entity ?? pr.operation ?? pr.field ?? ""}`;
  }
}
async function seed(ten: string): Promise<Nm> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  factories.push(code);
  const u = await taoNguoiDungTest(ten.toLowerCase(), "engineer", { tienTo: "l1", ts: RUN, ten: `L1 ${ten}` });
  uids.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  const pkgCode = `${RUN}-PK${ten}`;
  const [pk] = await dung(sql`INSERT INTO inspection_packages ("machineId", "packageId", "machineCode", "serialNumber") VALUES (${m.id}, ${pkgCode}, ${code}, ${RUN + ten}) RETURNING id`);
  await dung(sql`INSERT INTO package_images ("packageId", "pointCode", "fileName") VALUES (${pk.id}, 'MP1', 'MP1.jpg')`);
  const ev = (await dung(sql`SELECT e.enumlabel AS l FROM information_schema.columns c JOIN pg_type t ON t.typname = c.udt_name JOIN pg_enum e ON e.enumtypid = t.oid WHERE c.table_name = 'package_activity_logs' AND c.column_name = 'event' ORDER BY e.enumsortorder LIMIT 1`))[0].l;
  await dung(sql`INSERT INTO package_activity_logs ("packageDbId", "packageId", "machineId", event, message) VALUES (${pk.id}, ${pkgCode}, ${m.id}, ${ev}, ${RUN})`);
  await dung(sql`INSERT INTO upload_queue_metrics ("machineId", "queuedCount") VALUES (${m.id}, ${ten === "A" ? 7 : 9})`);
  const ok = (await dung(sql`SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'overallresultenum' AND e.enumlabel = 'OK'`))[0].l;
  const orig = (await dung(sql`SELECT e.enumlabel AS l FROM information_schema.columns c JOIN pg_type t ON t.typname = c.udt_name JOIN pg_enum e ON e.enumtypid = t.oid WHERE c.table_name = 'product_inspections' AND c.column_name = 'originalResult' ORDER BY e.enumsortorder LIMIT 1`))[0].l;
  const [pi] = await dung(sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime") VALUES (${m.id}, ${RUN + ten}, ${ok}, ${orig}, now()) RETURNING id`);
  const imgUrl = `/uploads/${RUN}-${ten}.jpg`;
  const [pd] = await dung(sql`SELECT id FROM measurement_point_defs LIMIT 1`);
  const [mr] = await dung(sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "imageUrl", "measuredValue") VALUES (${pi.id}, ${pd.id}, ${ok}, ${imgUrl}, 1.5) RETURNING id`);
  const [an] = await dung(sql`INSERT INTO image_annotations ("inspectionId", "measurementResultId", "imageUrl", annotations) VALUES (${pi.id}, ${mr.id}, ${imgUrl}, ${JSON.stringify([{ type: "rect", color: "red", text: RUN + ten }])}::json) RETURNING id`);
  // thống kê ngày (3 ngày, khoảng thời gian cô lập năm 2001): A yield 90%, B yield 50%
  for (const d of [1, 2, 3]) {
    await dung(sql`INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", date, "totalCount", "okCount", "ngCount", "ntfCount") VALUES (${m.id}, ${f.id}, ${w.id}, ${"2001-01-0" + d}::timestamp, 100, ${ten === "A" ? 90 : 50}, ${ten === "A" ? 10 : 50}, 0)`);
  }
  return { fid: f.id, mid: m.id, code, pkgId: pk.id, pkgCode, insp: pi.id, mr: mr.id, ann: an.id, imgUrl, userId: u.id };
}
const caller = async (u: { id: number; role: string; name: string }) => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [aoi, insp, mres, ann, cmp] = await Promise.all([
    import("./aoiPackageRouter").then((m) => m.aoiPackageRouter.createCaller(ctx)),
    import("./inspectionRouters").then((m) => m.inspectionRouter.createCaller(ctx)),
    import("./inspectionRouters").then((m) => m.measurementResultRouter.createCaller(ctx)),
    import("./annotationRouters").then((m) => m.annotationRouter.createCaller(ctx)),
    import("./annotationComparisonRouter").then((m) => m.annotationComparisonRouter.createCaller(ctx)),
  ]);
  return { aoiPackage: aoi, inspection: insp, measurementResult: mres, annotation: ann, annotationComparison: cmp };
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seed("A");
  B = await seed("B");
  const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "l1", ts: RUN, ten: "L1 ad" });
  const ur = await taoNguoiDungTest("ur", "engineer", { tienTo: "l1", ts: RUN, ten: "L1 ur" });
  uids.push(ad.id, ur.id);
  uA = await caller({ id: A.userId, role: "engineer", name: "L1 A" });
  uAdmin = await caller({ id: ad.id, role: "admin", name: "L1 ad" });
  uRong = await caller({ id: ur.id, role: "engineer", name: "L1 ur" });
  R = uA;
  const sess = async (ten: string, ids: number[], mid: number | null) =>
    (await dung(sql`INSERT INTO annotation_comparison_sessions (name, "inspectionIds", "machineId", "createdBy") VALUES (${RUN + ten}, ${JSON.stringify(ids)}::json, ${mid}, ${A.userId}) RETURNING id`))[0].id as number;
  sessA = await sess("sa", [A.insp, A.insp], A.mid);
  sessB = await sess("sb", [B.insp, B.insp], B.mid);
  sessMix = await sess("sm", [A.insp, B.insp], null);
  sessKhaiB = await sess("sk", [A.insp], B.mid); // lần kiểm tra của A nhưng KHAI BÁO máy B
}, 180_000);

afterAll(async () => {
  if (!db) return;
  const d = async (q: ReturnType<typeof sql>) => { try { await dung(q); } catch { /* dọn best-effort */ } };
  try {
    const { default: postgres } = await import("postgres");
    const u = new URL(process.env.DATABASE_URL!);
    u.username = "aoi";
    u.password = "aoi";
    const chu = postgres(u.toString(), { max: 1, onnotice: () => {} });
    await chu`DELETE FROM measurement_results WHERE "imageUrl" LIKE ${"/uploads/" + RUN + "%"}`;
    await chu`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${RUN + "%"}`;
    await chu.end({ timeout: 5 });
  } catch { /* dọn best-effort */ }
  await d(sql`DELETE FROM annotation_comparison_sessions WHERE name LIKE ${RUN + "%"}`);
  await d(sql`DELETE FROM image_annotations WHERE "imageUrl" LIKE ${"/uploads/" + RUN + "%"}`);
  await d(sql`DELETE FROM daily_statistics WHERE "machineId" IN (SELECT id FROM machines WHERE code LIKE ${RUN + "%"})`);
  await d(sql`DELETE FROM upload_queue_metrics WHERE "machineId" IN (SELECT id FROM machines WHERE code LIKE ${RUN + "%"})`);
  await d(sql`DELETE FROM package_activity_logs WHERE message = ${RUN}`);
  await d(sql`DELETE FROM package_images WHERE "packageId" IN (SELECT id FROM inspection_packages WHERE "packageId" LIKE ${RUN + "%"})`);
  await d(sql`DELETE FROM inspection_packages WHERE "packageId" LIKE ${RUN + "%"}`);
  await d(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${RUN + "%"}`);
  for (const t of ["machines", "stations", "production_lines", "workshops", "factories"]) await d(sql`DELETE FROM ${sql.raw(t)} WHERE code LIKE ${RUN + "%"}`);
});

describe("★★★ aoiPackage — gói ảnh kiểm tra của máy nhà máy khác", () => {
  it("getPackage / getPackageImages / getPackageLogs (theo packageId VÀ theo id) — gói B ⇒ NOT_FOUND aoiPackage; gói A thấy", async () => {
    for (const [ten, goi] of [
      ["getPackage", (n: Nm, byId: boolean) => R.aoiPackage.getPackage(byId ? { id: n.pkgId } : { packageId: n.pkgCode })],
      ["getPackageImages", (n: Nm, byId: boolean) => R.aoiPackage.getPackageImages(byId ? { id: n.pkgId } : { packageId: n.pkgCode })],
      ["getPackageLogs", (n: Nm, byId: boolean) => R.aoiPackage.getPackageLogs(byId ? { id: n.pkgId } : { packageId: n.pkgCode })],
    ] as const) {
      for (const byId of [false, true]) {
        expect(await chiTiet(() => goi(B, byId)), `${ten} B byId=${byId}`).toBe("NOT_FOUND:ENTITY_NOT_FOUND:aoiPackage");
        expect(await chiTiet(() => goi(A, byId)), `${ten} A byId=${byId}`).toBeNull();
      }
    }
  });
  it("downloadZip / getImage — gói B ⇒ NOT_FOUND aoiPackage (TRƯỚC khi đụng kho/ZIP); gói A qua cổng phạm vi (lỗi muộn hơn: chưa có ZIP)", async () => {
    expect(await chiTiet(() => R.aoiPackage.downloadZip({ packageId: B.pkgCode }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:aoiPackage");
    expect(await chiTiet(() => R.aoiPackage.getImage({ packageId: B.pkgCode, pointCode: "MP1" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:aoiPackage");
    const a1 = await chiTiet(() => R.aoiPackage.downloadZip({ packageId: A.pkgCode }));
    const a2 = await chiTiet(() => R.aoiPackage.getImage({ packageId: A.pkgCode, pointCode: "MP1" }));
    expect(a1).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:aoiPackage");
    expect(a2).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:aoiPackage");
  });
  it("★★★ getImage — path traversal / đường tuyệt đối trong fileName và pointCode: KHÔNG BAO GIỜ trả ảnh/tệp ngoài gói", async () => {
    // Đường tuyệt đối và mọi chuỗi có `..` ⇒ BAD_REQUEST (L1b: TỪ CHỐI, không còn cắt-rồi-tra). Bộ test đầy đủ ở loAoiGhiPhamVi.db.test.ts.
    for (const fileName of ["/etc/passwd", "../../etc/passwd", "..\\..\\boot.ini", "a/../../b.jpg", "x/../../../y"]) {
      expect(await chiTiet(() => R.aoiPackage.getImage({ packageId: A.pkgCode, fileName })), fileName).toBe("BAD_REQUEST:INVALID_VALUE:fileName");
    }
    expect(await chiTiet(() => R.aoiPackage.getImage({ packageId: A.pkgCode, pointCode: "../../../secret" }))).toBe("BAD_REQUEST:INVALID_VALUE:fileName");
  });
  it("listPackages / getUploadStats / getQueueStatus — chỉ máy của A", async () => {
    const ds = await R.aoiPackage.listPackages({ page: 1, pageSize: 500 });
    const ids: string[] = ds.data.map((p: { packageId: string }) => p.packageId);
    expect(ids).toContain(A.pkgCode);
    expect(ids).not.toContain(B.pkgCode);
    expect(ds.total).toBe(1);
    const st = await R.aoiPackage.getUploadStats({});
    expect(st.summary.total).toBe(1);
    expect(st.perMachine.map((m: { machineId: number }) => m.machineId)).toEqual([A.mid]);
    const q = await R.aoiPackage.getQueueStatus({});
    expect(q.map((r: { machineId: number }) => r.machineId)).toContain(A.mid);
    expect(q.map((r: { machineId: number }) => r.machineId)).not.toContain(B.mid);
    expect(await R.aoiPackage.getQueueStatus({ machineId: B.mid })).toEqual([]);
    expect((await R.aoiPackage.listPackages({ page: 1, pageSize: 50, machineId: B.mid })).total).toBe(0);
  });
});

describe("★★★ inspection / measurementResult", () => {
  it("inspection.getById — B ⇒ NOT_FOUND inspection; A thấy; measurementResult.getById / getByInspection — B ⇒ NOT_FOUND / []", async () => {
    expect(await chiTiet(() => R.inspection.getById({ id: B.insp }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:inspection");
    expect(await chiTiet(() => R.inspection.getById({ id: A.insp }))).toBeNull();
    expect(await chiTiet(() => R.measurementResult.getById({ id: B.mr }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:measurementResult");
    expect(await chiTiet(() => R.measurementResult.getById({ id: A.mr }))).toBeNull();
    expect(await R.measurementResult.getByInspection({ inspectionId: B.insp })).toEqual([]);
    expect((await R.measurementResult.getByInspection({ inspectionId: A.insp })).length).toBe(1);
  });
  it("aiAnalysis — chỉ thống kê ngày của máy A (yield trung bình 90, không trộn B = 50)", async () => {
    const r = await R.inspection.aiAnalysis({ startDate: new Date("2000-12-31"), endDate: new Date("2001-02-01") });
    expect(Math.round(r.statistics.mean)).toBe(90);
    const ad = await uAdmin.inspection.aiAnalysis({ startDate: new Date("2000-12-31"), endDate: new Date("2001-02-01") });
    expect(Math.round(ad.statistics.mean)).toBe(70); // admin: (90+50)/2 — đối chứng DƯƠNG
  });
  it("defectPatternClusters — chỉ điểm NG của máy A", async () => {
    // tạo một điểm đo NG ở mỗi nhà máy
    for (const n of [A, B]) {
      const [pi] = await dung(sql`SELECT id FROM product_inspections WHERE id = ${n.insp}`);
      const [pd] = await dung(sql`SELECT id FROM measurement_point_defs LIMIT 1`);
      await dung(sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "imageUrl") VALUES (${pi.id}, ${pd.id}, 'NG', ${"/uploads/" + RUN + "-ng"})`);
    }
    const goi = (c: any) => c.inspection.defectPatternClusters({ startDate: new Date(Date.now() - 3600_000), endDate: new Date(Date.now() + 3600_000), limit: 20 });
    const dem = (r: Array<{ totalNG: number }>) => r.reduce((a, c) => a + c.totalNG, 0);
    const a = dem(await goi(R));
    const ad = dem(await goi(uAdmin));
    expect(a).toBe(1);
    expect(ad).toBeGreaterThanOrEqual(2);
  });
});

describe("★★★ annotation", () => {
  it("getByImage / getByInspection — chú thích của B ⇒ null / []", async () => {
    expect(await R.annotation.getByImage({ imageUrl: B.imgUrl })).toBeNull();
    expect((await R.annotation.getByImage({ imageUrl: A.imgUrl }))?.id).toBe(A.ann);
    expect(await R.annotation.getByInspection({ inspectionId: B.insp })).toEqual([]);
    expect((await R.annotation.getByInspection({ inspectionId: A.insp })).map((x: { id: number }) => x.id)).toEqual([A.ann]);
  });
  it("search / statistics / comparison / heatmapData / trendPrediction — chỉ chú thích của A", async () => {
    const tim = await R.annotation.search({ textQuery: RUN });
    const ds: string[] = tim.map((r: { annotationText: string }) => r.annotationText);
    expect(ds).toContain(RUN + "A");
    expect(ds).not.toContain(RUN + "B");
    const st = await R.annotation.statistics({});
    expect(st.byMachine.map((m: { code: string }) => m.code)).toEqual([A.code]);
    const so = await R.annotation.comparison({ serialNumber: RUN + "B" });
    expect(so.totalInspections).toBe(0);
    expect((await R.annotation.comparison({ serialNumber: RUN + "A" })).totalInspections).toBeGreaterThan(0);
    const hm = await R.annotation.heatmapData({});
    expect(hm.machines.map((m: { machineId: number }) => m.machineId)).toEqual([A.mid]);
    const tp = await R.annotation.trendPrediction({ days: 3 });
    expect(tp.statistics.totalDefects).toBe(1);
  });
});

describe("★★★ annotationComparison", () => {
  it("getById — phiên B hoặc phiên TRỘN A+B ⇒ NOT_FOUND; phiên A thấy; compareTwo kiểm tra B ⇒ NOT_FOUND", async () => {
    expect(await chiTiet(() => R.annotationComparison.getById({ id: sessB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:comparisonSession");
    expect(await chiTiet(() => R.annotationComparison.getById({ id: sessMix }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:comparisonSession");
    expect(await chiTiet(() => R.annotationComparison.getById({ id: sessKhaiB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:comparisonSession");
    expect(await chiTiet(() => R.annotationComparison.getById({ id: sessA }))).toBeNull();
    expect(await chiTiet(() => R.annotationComparison.compareTwo({ inspectionId1: A.insp, inspectionId2: B.insp }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:inspection");
    expect(await chiTiet(() => R.annotationComparison.compareTwo({ inspectionId1: A.insp, inspectionId2: A.insp }))).toBeNull();
  });
  it("list / getTrendData — chỉ phiên và số kiểm tra của A", async () => {
    const ds = await R.annotationComparison.list({ limit: 100, offset: 0 });
    const ids: number[] = ds.sessions.map((s: { id: number }) => s.id);
    expect(ids).toContain(sessA);
    expect(ids).not.toContain(sessB);
    expect(ids).not.toContain(sessMix);
    expect(ids).not.toContain(sessKhaiB);
    const t = await R.annotationComparison.getTrendData({ dateFrom: new Date(Date.now() - 86400_000).toISOString(), dateTo: new Date(Date.now() + 86400_000).toISOString() });
    expect(t.summary.totalInspections).toBe(1);
  });
});

describe("đối chứng DƯƠNG + phạm vi rỗng", () => {
  it("admin thấy cả A lẫn B ở mọi thủ tục chính", async () => {
    expect(await chiTiet(() => uAdmin.aoiPackage.getPackage({ packageId: B.pkgCode }))).toBeNull();
    expect(await chiTiet(() => uAdmin.aoiPackage.downloadZip({ packageId: B.pkgCode }))).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:aoiPackage");
    expect(await chiTiet(() => uAdmin.inspection.getById({ id: B.insp }))).toBeNull();
    expect((await uAdmin.annotation.getByImage({ imageUrl: B.imgUrl }))?.id).toBe(B.ann);
    expect(await chiTiet(() => uAdmin.annotationComparison.getById({ id: sessMix }))).toBeNull();
    expect((await uAdmin.annotation.statistics({})).byMachine.map((m: { code: string }) => m.code)).toEqual(expect.arrayContaining([A.code, B.code]));
  });
  it("người dùng không gán nhà máy ⇒ rỗng/NOT_FOUND ở mọi nơi", async () => {
    expect(await chiTiet(() => uRong.aoiPackage.getPackage({ packageId: A.pkgCode }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:aoiPackage");
    expect((await uRong.aoiPackage.listPackages({ page: 1, pageSize: 50 })).total).toBe(0);
    expect(await chiTiet(() => uRong.inspection.getById({ id: A.insp }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:inspection");
    expect(await uRong.annotation.getByInspection({ inspectionId: A.insp })).toEqual([]);
    expect((await uRong.annotationComparison.list({ limit: 100, offset: 0 })).sessions.map((s: { id: number }) => s.id)).not.toContain(sessA);
  });
});
