/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24, nhóm ①: /api/external/inspections/{images,measurements,events} theo PHẠM VI (tài khoản đăng nhập `Bearer` ⇒ gán nhà máy; master key ⇒ toàn quyền).
 *
 * Lỗ: một tài khoản gán nhà máy A gọi các tuyến này (qua /api/external/auth/login) đọc được ảnh/đo/sự kiện gói của MỌI nhà máy. Tuyến còn CẤP VÉ ẢNH ký (`kyAnhTrongThan`) cho đường dẫn ảnh
 * của nhà máy khác ⇒ nay chỉ cấp vé cho ảnh trong phạm vi (tải tệp thật là tầng `/uploads` — xem báo cáo).
 * Chỉ thay middleware xác thực (đặt `req.externalUser` / master); handler, SQL, CSDL là THẬT.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import postgres from "postgres";
import { registerExternalInspectionRoutes } from "./externalInspectionApi";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const DB_URL = process.env.DATABASE_URL;
const DAU = `EXI-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";
const x = <T>(r: unknown): T => (r as T[])[0]!;

interface Nm { factoryId: number; code: string; machineId: number; stationId: number; inspId: number; mrId: number; userId: number; anh: string }
let A!: Nm;
let B!: Nm;
let admin!: { id: number; role: string };
let userRong!: { id: number; role: string };
let pdId = 0;
let pkgId = 0;
const usersById = new Map<number, { id: number; role: string }>();

async function nhan(bang: string, cot: string): Promise<string> {
  return x<{ l: string }>(await sql`SELECT e.enumlabel AS l FROM information_schema.columns c JOIN pg_type t ON t.typname = c.udt_name JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE c.table_name = ${bang} AND c.column_name = ${cot} ORDER BY e.enumsortorder LIMIT 1`).l;
}
async function taoNhanh(ten: string, pmId: number): Promise<Nm> {
  const code = `${DAU}-${ten}`;
  const f = x<{ id: number }>(await sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const w = x<{ id: number }>(await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const l = x<{ id: number }>(await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const s = x<{ id: number }>(await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const m = x<{ id: number }>(await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const u = await taoNguoiDungTest(ten.toLowerCase(), "engineer", { tienTo: "exi", ts: DAU, ten: `EXI ${ten}` });
  await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`;
  usersById.set(u.id, { id: u.id, role: "engineer" });
  const ok = await nhan("product_inspections", "overallResult");
  const orig = await nhan("product_inspections", "originalResult");
  const anh = `/uploads/inspections/${DAU}-${ten}.jpg`;
  const pi = x<{ id: number }>(await sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "productModelId")
    VALUES (${m.id}, ${DAU + "-S" + ten}, ${ok}, ${orig}, now(), ${pmId}) RETURNING id`);
  const mr = x<{ id: number }>(await sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "imageUrl", "measuredValue")
    VALUES (${pi.id}, ${pdId}, ${ok}, ${anh}, 1.5) RETURNING id`);
  const pk = x<{ id: number }>(await sql`INSERT INTO inspection_packages ("machineId", "packageId") VALUES (${m.id}, ${DAU + "-P" + ten}) RETURNING id`);
  pkgId = pk.id;
  await sql`INSERT INTO package_activity_logs ("packageDbId", "packageId", "machineId", event, message) VALUES (${pk.id}, ${DAU + "-P" + ten}, ${m.id}, ${await nhan("package_activity_logs", "event")}, ${DAU})`;
  return { factoryId: f.id, code, machineId: m.id, stationId: s.id, inspId: pi.id, mrId: mr.id, userId: u.id, anh };
}
async function goi(path: string, who: "master" | number): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, { headers: { "x-test-who": String(who) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const KHOANG = "startDate=2020-01-01&endDate=2099-01-01";

describe.skipIf(!DB_URL)("external inspections images/measurements/events — phạm vi người dùng", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const pm = x<{ id: number }>(await sql`INSERT INTO product_models (code, name) VALUES (${DAU + "-PM"}, ${DAU}) RETURNING id`);
    const pd = x<{ id: number }>(await sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${pm.id}, ${DAU + "-PD"}, ${DAU}, ${await nhan("measurement_point_defs", "measurementType")}, 1, 1) RETURNING id`);
    pdId = pd.id;
    A = await taoNhanh("A", pm.id);
    B = await taoNhanh("B", pm.id);
    const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "exi", ts: DAU, ten: "EXI ad" });
    admin = { id: ad.id, role: "admin" };
    usersById.set(admin.id, admin);
    const ur = await taoNguoiDungTest("ur", "engineer", { tienTo: "exi", ts: DAU, ten: "EXI ur" });
    userRong = { id: ur.id, role: "engineer" };
    usersById.set(userRong.id, userRong);

    const app = express();
    const xacThuc: express.RequestHandler = (req, res, next) => {
      const who = String(req.header("x-test-who") ?? "");
      if (who === "master") return next();
      const u = usersById.get(Number(who));
      if (!u) return res.status(401).json({ success: false });
      (req as any).externalUser = u;
      next();
    };
    registerExternalInspectionRoutes(app, xacThuc);
    await new Promise<void>((resolve) => { server = createServer(app).listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 90_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => { try { await q; } catch { /* dọn best-effort */ } };
      // product_inspections là WORM với avi_app ⇒ dọn hàng THỬ của chính mình bằng chủ sở hữu `aoi` (CHỈ trên _test)
      try {
        const u = new URL(DB_URL!);
        u.username = "aoi";
        u.password = "aoi";
        const chu = postgres(u.toString(), { max: 1, onnotice: () => {} });
        await chu`DELETE FROM measurement_results WHERE "pointDefId" = ${pdId}`;
        await chu`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${DAU + "%"}`;
        await chu`DELETE FROM package_activity_logs WHERE message = ${DAU}`;
        await chu`DELETE FROM inspection_packages WHERE "packageId" LIKE ${DAU + "%"}`;
        await chu.end({ timeout: 5 });
      } catch { /* dọn best-effort */ }
      await d(sql`DELETE FROM measurement_point_defs WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM machines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM stations WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM production_lines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM workshops WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM factories WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM product_models WHERE code LIKE ${DAU + "%"}`);
      await sql.end({ timeout: 5 });
    }
  }, 60_000);

  it("fixture dựng được thật", () => {
    expect(A.inspId).not.toBe(B.inspId);
  });

  it("★★★ GET /inspections/images — người nhà máy A chỉ thấy ảnh của A (và vé ký chỉ cho ảnh của A)", async () => {
    const r = await goi(`/api/external/inspections/images?${KHOANG}&pointDefId=${pdId}&limit=200`, A.userId);
    expect(r.status).toBe(200);
    const urls: string[] = r.body.data.images.map((i: { imageUrl: string }) => i.imageUrl.split("?")[0]);
    expect(urls).toContain(A.anh);
    expect(urls).not.toContain(B.anh);
    expect(JSON.stringify(r.body)).not.toContain(B.anh);
    expect(r.body.data.pagination.total).toBe(1);
    expect(r.body.data.scopeApplied).toBe(true); // 0 dòng/ít dòng không im lặng: phía gọi biết mình vừa bị thu hẹp
  });
  it("★★★ GET /inspections/measurements — chỉ giá trị đo của A", async () => {
    const r = await goi(`/api/external/inspections/measurements?${KHOANG}&pointDefId=${pdId}&limit=200`, A.userId);
    expect(r.status).toBe(200);
    const ids: number[] = r.body.data.measurements.map((m: { measurementResultId: number }) => m.measurementResultId);
    expect(ids).toEqual([A.mrId]);
    expect(r.body.data.pagination.total).toBe(1);
  });
  it("★★★ GET /inspections/events — chỉ nhật ký gói của máy A", async () => {
    const r = await goi(`/api/external/inspections/events?${KHOANG}&limit=500`, A.userId);
    expect(r.status).toBe(200);
    const may: number[] = r.body.data.events.map((e: { machineId: number }) => e.machineId);
    expect(may).toContain(A.machineId);
    expect(may).not.toContain(B.machineId);
    expect(r.body.data.pagination.total).toBe(1);
  });
  it("người dùng không gán nhà máy ⇒ rỗng", async () => {
    const r = await goi(`/api/external/inspections/images?${KHOANG}&pointDefId=${pdId}`, userRong.id);
    expect(r.body.data.images).toEqual([]);
    expect((await goi(`/api/external/inspections/measurements?${KHOANG}&pointDefId=${pdId}`, userRong.id)).body.data.measurements).toEqual([]);
  });
  it("đối chứng DƯƠNG: master key và admin thấy cả A lẫn B", async () => {
    for (const who of ["master", admin.id] as const) {
      const im = await goi(`/api/external/inspections/images?${KHOANG}&pointDefId=${pdId}&limit=200`, who);
      const urls: string[] = im.body.data.images.map((i: { imageUrl: string }) => i.imageUrl.split("?")[0]);
      expect(urls, String(who)).toEqual(expect.arrayContaining([A.anh, B.anh]));
      expect(im.body.data.scopeApplied, String(who)).toBe(who !== "master") // master ⇒ false; admin là NGƯỜI DÙNG ⇒ true (phạm vi toàn quyền theo vai);
      const ms = await goi(`/api/external/inspections/measurements?${KHOANG}&pointDefId=${pdId}&limit=200`, who);
      expect(ms.body.data.measurements.map((m: { measurementResultId: number }) => m.measurementResultId), String(who)).toEqual(expect.arrayContaining([A.mrId, B.mrId]));
    }
  });
});
