/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24, nhóm ④: /api/external/hierarchy/{tree, factory/:factoryId, mqtt-topics, summary} theo PHẠM VI người gọi
 * (token Bearer ⇒ nhà máy được gán; master key / admin ⇒ toàn quyền). Quy ước cụm `_phamViNgoai.ts`: id ngoài phạm vi ⇒ 403 `external_factory_scope_denied`; danh sách/tổng kèm `scopeApplied`.
 * Lỗ: một tài khoản gán nhà máy A đọc CẢ CÂY tổ chức (mọi nhà máy→xưởng→chuyền→trạm→máy), danh sách topic MQTT và số đếm của mọi nhà máy.
 * Chỉ thay middleware xác thực; handler, SQL, CSDL là THẬT.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import postgres from "postgres";
import { registerExternalHierarchyRoutes } from "./externalHierarchyApi";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const DB_URL = process.env.DATABASE_URL;
const DAU = `EHI-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";
const x = <T>(r: unknown): T => (r as T[])[0]!;

interface Nm { factoryId: number; workshopId: number; lineId: number; stationId: number; machineId: number; userId: number; code: string }
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
  const m = x<{ id: number }>(await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const u = await taoNguoiDungTest(ten.toLowerCase(), "engineer", { tienTo: "ehi", ts: DAU, ten: `EHI ${ten}` });
  await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`;
  usersById.set(u.id, { id: u.id, role: "engineer" });
  return { factoryId: f.id, workshopId: w.id, lineId: l.id, stationId: s.id, machineId: m.id, userId: u.id, code };
}
async function goi(path: string, who: "master" | number): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, { headers: { "x-test-who": String(who) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const cayId = (r: { body: any }): number[] => (r.body.data as Array<{ id: number }>).map((f) => f.id);

describe.skipIf(!DB_URL)("external hierarchy — phạm vi người gọi", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    A = await taoNhanh("A");
    B = await taoNhanh("B");
    const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "ehi", ts: DAU, ten: "EHI ad" });
    admin = { id: ad.id, role: "admin" };
    usersById.set(admin.id, admin);
    const ur = await taoNguoiDungTest("ur", "engineer", { tienTo: "ehi", ts: DAU, ten: "EHI ur" });
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
    registerExternalHierarchyRoutes(app, xacThuc, xacThuc);
    await new Promise<void>((resolve) => { server = createServer(app).listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 90_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => { try { await q; } catch { /* dọn best-effort */ } };
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
    expect(A.factoryId).not.toBe(B.factoryId);
  });

  it("★★★ hierarchy/tree — người nhà máy A chỉ thấy cây của A (đúng 1 nhà máy), kèm scopeApplied", async () => {
    const r = await goi("/api/external/hierarchy/tree", A.userId);
    expect(r.status).toBe(200);
    expect(cayId(r)).toEqual([A.factoryId]);
    expect(r.body.scopeApplied).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(B.code);
  });
  it("★★★ hierarchy/factory/:factoryId — nhà máy B ⇒ 403 external_factory_scope_denied; A ⇒ 200", async () => {
    const b = await goi(`/api/external/hierarchy/factory/${B.factoryId}`, A.userId);
    expect(b.status).toBe(403);
    expect(b.body.code).toBe("external_factory_scope_denied");
    const a = await goi(`/api/external/hierarchy/factory/${A.factoryId}`, A.userId);
    expect(a.status).toBe(200);
    expect(a.body.data.id).toBe(A.factoryId);
  });
  it("★★★ hierarchy/mqtt-topics — scope id ngoài phạm vi (factory/workshop/line/station) ⇒ 403 và KHÔNG lộ tên nhà máy B; của A ⇒ 200", async () => {
    const truyVan = (q: string, who: number) => goi(`/api/external/hierarchy/mqtt-topics?${q}`, who);
    for (const q of [
      `level=factory&factoryId=${B.factoryId}`,
      `level=workshop&factoryId=${B.factoryId}&workshopId=${B.workshopId}`,
      `level=line&lineId=${B.lineId}`,
      `level=station&stationId=${B.stationId}`,
      `factoryId=${B.factoryId}`,
    ]) {
      const r = await truyVan(q, A.userId);
      expect(r.status, q).toBe(403);
      expect(JSON.stringify(r.body), q).not.toContain(B.code);
    }
    const a = await truyVan(`level=factory&factoryId=${A.factoryId}`, A.userId);
    expect(a.status).toBe(200);
    expect(JSON.stringify(a.body.data)).toContain(`factory/${A.factoryId}/`);
    expect(a.body.scopeApplied).toBe(true);
    expect((await truyVan(`level=station&stationId=${A.stationId}`, A.userId)).status).toBe(200);
  });
  it("★★★ hierarchy/summary — chỉ đếm nhà máy của A (1 nhà máy · 1 xưởng · 1 chuyền · 1 trạm · 1 máy)", async () => {
    const r = await goi("/api/external/hierarchy/summary", A.userId);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ factories: 1, workshops: 1, lines: 1, stations: 1, machines: 1 });
    expect(r.body.scopeApplied).toBe(true);
  });
  it("người dùng không gán nhà máy ⇒ cây rỗng, tổng 0", async () => {
    expect((await goi("/api/external/hierarchy/tree", userRong.id)).body.data).toEqual([]);
    expect((await goi("/api/external/hierarchy/summary", userRong.id)).body.data.factories).toBe(0);
  });
  it("đối chứng DƯƠNG: master key và admin thấy cả A lẫn B", async () => {
    for (const who of ["master", admin.id] as const) {
      expect(cayId(await goi("/api/external/hierarchy/tree", who)), String(who)).toEqual(expect.arrayContaining([A.factoryId, B.factoryId]));
      expect((await goi(`/api/external/hierarchy/factory/${B.factoryId}`, who)).status, String(who)).toBe(200);
      expect((await goi(`/api/external/hierarchy/mqtt-topics?level=factory&factoryId=${B.factoryId}`, who)).status, String(who)).toBe(200);
      expect((await goi("/api/external/hierarchy/summary", who)).body.data.factories, String(who)).toBeGreaterThanOrEqual(2);
    }
    expect((await goi("/api/external/hierarchy/tree", "master")).body.scopeApplied).toBe(false);
  });
});
