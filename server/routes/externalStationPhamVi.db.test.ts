/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24, nhóm ③: /api/external/stations/:id (+ 8 nhánh con), stations/resolve-topic, workstations, workstations/:id theo PHẠM VI người gọi
 * (token Bearer ⇒ nhà máy được gán; master key / admin ⇒ toàn quyền). Quy ước cụm `_phamViNgoai.ts`: tra theo id ngoài phạm vi ⇒ 403 `external_factory_scope_denied`; danh sách kèm `scopeApplied`.
 * Chỉ thay middleware xác thực; handler, SQL, CSDL là THẬT.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import postgres from "postgres";
import { registerExternalStationRoutes } from "./externalStationApi";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const DB_URL = process.env.DATABASE_URL;
const DAU = `EST-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";
const x = <T>(r: unknown): T => (r as T[])[0]!;

interface Nm { factoryId: number; workshopId: number; lineId: number; stationId: number; wsId: number; userId: number; code: string }
let A!: Nm;
let B!: Nm;
let admin!: { id: number; role: string };
let userRong!: { id: number; role: string };
const usersById = new Map<number, { id: number; role: string }>();

async function taoNhanh(ten: string): Promise<Nm> {
  const code = `${DAU}-${ten}`;
  const f = x<{ id: number }>(await sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const w = x<{ id: number }>(await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const l = x<{ id: number }>(await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const s = x<{ id: number }>(await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI')`;
  const ws = x<{ id: number }>(await sql`INSERT INTO workstations (code, name, "factoryId", "workshopId", "lineId") VALUES (${code}, ${code}, ${f.id}, ${w.id}, ${l.id}) RETURNING id`);
  const u = await taoNguoiDungTest(ten.toLowerCase(), "engineer", { tienTo: "est", ts: DAU, ten: `EST ${ten}` });
  await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`;
  usersById.set(u.id, { id: u.id, role: "engineer" });
  return { factoryId: f.id, workshopId: w.id, lineId: l.id, stationId: s.id, wsId: ws.id, userId: u.id, code };
}
async function goi(path: string, who: "master" | number): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, { headers: { "x-test-who": String(who) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const NHANH = ["", "/inspection-points", "/products", "/reference-image", "/statistics", "/measurement-stats", "/fail-history", "/point-detail"];
const KHOANG = "startDate=2020-01-01&endDate=2099-01-01&pointDefId=1&days=7";

describe.skipIf(!DB_URL)("external stations/workstations — phạm vi người gọi", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    A = await taoNhanh("A");
    B = await taoNhanh("B");
    const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "est", ts: DAU, ten: "EST ad" });
    admin = { id: ad.id, role: "admin" };
    usersById.set(admin.id, admin);
    const ur = await taoNguoiDungTest("ur", "engineer", { tienTo: "est", ts: DAU, ten: "EST ur" });
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
    registerExternalStationRoutes(app, xacThuc);
    await new Promise<void>((resolve) => { server = createServer(app).listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 90_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => { try { await q; } catch { /* dọn best-effort */ } };
      await d(sql`DELETE FROM workstations WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM machines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM stations WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM production_lines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM workshops WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM factories WHERE code LIKE ${DAU + "%"}`);
      await sql.end({ timeout: 5 });
    }
  }, 60_000);

  it("fixture dựng được thật", () => {
    expect(A.stationId).not.toBe(B.stationId);
  });

  it("★★★ stations/:id và 7 nhánh con — trạm B ⇒ 403 external_factory_scope_denied; trạm A KHÔNG bị 403", async () => {
    for (const nhanh of NHANH) {
      const b = await goi(`/api/external/stations/${B.stationId}${nhanh}?${KHOANG}`, A.userId);
      expect(b.status, `B ${nhanh}`).toBe(403);
      expect(b.body.code, `B ${nhanh}`).toBe("external_factory_scope_denied");
      const a = await goi(`/api/external/stations/${A.stationId}${nhanh}?${KHOANG}`, A.userId);
      expect(a.status, `A ${nhanh}`).not.toBe(403);
    }
  });
  it("★★★ stations/resolve-topic — trạm B ⇒ 403; trạm A ⇒ 200", async () => {
    const tp = (n: Nm) => `avi/${n.factoryId}/workshop/${n.workshopId}/station/${n.stationId}/errors`;
    expect((await goi(`/api/external/stations/resolve-topic?topic=${encodeURIComponent(tp(B))}`, A.userId)).status).toBe(403);
    expect((await goi(`/api/external/stations/resolve-topic?topic=${encodeURIComponent(tp(A))}`, A.userId)).status).toBe(200);
  });
  it("★★★ workstations (danh sách) — chỉ công trạm của A; workstations/:id của B ⇒ 403", async () => {
    const r = await goi("/api/external/workstations", A.userId);
    const ids: number[] = r.body.data.map((w: { id: number }) => w.id);
    expect(ids).toContain(A.wsId);
    expect(ids).not.toContain(B.wsId);
    expect(r.body.scopeApplied).toBe(true);
    expect((await goi(`/api/external/workstations/${B.wsId}`, A.userId)).status).toBe(403);
    expect((await goi(`/api/external/workstations/${A.wsId}`, A.userId)).status).toBe(200);
    expect((await goi(`/api/external/workstations?factoryId=${B.factoryId}`, A.userId)).body.data.map((w: { id: number }) => w.id)).not.toContain(B.wsId);
  });
  it("người dùng không gán nhà máy ⇒ 403 trạm, danh sách công trạm rỗng", async () => {
    expect((await goi(`/api/external/stations/${A.stationId}`, userRong.id)).status).toBe(403);
    expect((await goi("/api/external/workstations", userRong.id)).body.data).toEqual([]);
  });
  it("đối chứng DƯƠNG: master key và admin thấy trạm/công trạm của cả A lẫn B", async () => {
    for (const who of ["master", admin.id] as const) {
      expect((await goi(`/api/external/stations/${B.stationId}`, who)).status, String(who)).toBe(200);
      expect((await goi(`/api/external/stations/${B.stationId}/inspection-points`, who)).status, String(who)).not.toBe(403);
      expect((await goi(`/api/external/workstations/${B.wsId}`, who)).status, String(who)).toBe(200);
      const ids: number[] = (await goi("/api/external/workstations", who)).body.data.map((w: { id: number }) => w.id);
      expect(ids, String(who)).toEqual(expect.arrayContaining([A.wsId, B.wsId]));
    }
  });
});
