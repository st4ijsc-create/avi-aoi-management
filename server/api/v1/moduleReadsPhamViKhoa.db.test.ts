/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24: các GET /api/v1/{safety,fleet,programs,anomaly,twin,pdm}/… của moduleReads.ts theo PHẠM VI KHOÁ API.
 *
 * Lỗ (cùng lớp /machines/:id/detail Đợt 42): các handler này đọc bảng tenant (safety_events, safety_zones, tasks, zones, program_projects, program_deployments,
 * robot_behavior_anomalies) hoặc nhận id từ client (/twin/scene-graph?factoryId, /pdm/risk?machineId) mà KHÔNG nhìn req.apiPrincipal.tenantScope ⇒ khoá của nhà máy A đọc
 * được dữ liệu nhà máy B. Luật vá (một bộ phân giải, trục ②): khoá MỘT NHÀ MÁY ⇒ chỉ hàng có định vị trong nhà máy đó (hàng không định vị bị ẩn — fail-closed) / id ngoài phạm vi ⇒ 404 cùng hình
 * dạng "không tồn tại"; khoá TOÀN CỤC ⇒ không thêm mệnh đề (chiều dương chống vá quá tay); khoá CHƯA KHAI ⇒ rỗng/404.
 * Chỉ thay requireScope (đặt principal theo ô); envelope, wrap, service, CSDL là THẬT.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import postgres from "postgres";
import type { ApiPrincipal } from "./auth";
import { GLOBAL_TENANT_SCOPE, UNDECLARED_TENANT_SCOPE, type ApiKeyTenantScope } from "./apiKeyScope";

let principalHienTai: ApiPrincipal | null = null;
vi.mock("./auth", async (importOriginal) => {
  const goc = await importOriginal<typeof import("./auth")>();
  return {
    ...goc,
    requireScope: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!principalHienTai) {
        res.status(401).json({ ok: false, error: { code: "unauthorized", message: "no key (probe)" } });
        return;
      }
      req.apiPrincipal = principalHienTai;
      next();
    },
  };
});

import { registerModuleReadRoutes } from "./moduleReads";

const DB_URL = process.env.DATABASE_URL;
const DAU = `PVK-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";

interface Nm { factoryId: number; code: string; workshopId: number; lineId: number; stationId: number; machineId: number; robotId: number }
let A!: Nm;
let B!: Nm;
const id: Record<string, number> = {};
const x = <T>(r: unknown): T => (r as T[])[0]!;

async function taoNhanh(ten: string): Promise<Nm> {
  const code = `${DAU}-${ten}`;
  const f = x<{ id: number }>(await sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const w = x<{ id: number }>(await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const l = x<{ id: number }>(await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const s = x<{ id: number }>(await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const m = x<{ id: number }>(await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const r = x<{ id: number }>(await sql`INSERT INTO robots (code, name, vendor, kind, endpoint, "lineId") VALUES (${code}, ${code}, 'sim', 'arm', 'tcp://127.0.0.1:1', ${l.id}) RETURNING id`);
  return { factoryId: f.id, code, workshopId: w.id, lineId: l.id, stationId: s.id, machineId: m.id, robotId: r.id };
}
const khoa = (tenantScope: ApiKeyTenantScope): ApiPrincipal => ({ kind: "api-key", name: `${DAU}-khoa`, scopes: ["safety:read"], apiKeyId: 0, tenantScope });
async function goi(path: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: await r.json() };
}
const ids = (rows: Array<{ id: number }> | undefined) => (rows ?? []).map((r) => r.id);

describe.skipIf(!DB_URL)("moduleReads — phạm vi KHOÁ API cho safety/fleet/programs/anomaly/twin/pdm", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    A = await taoNhanh("A");
    B = await taoNhanh("B");
    const ev = async (k: string, lineId: number | null) => {
      id[k] = x<{ id: number }>(await sql`INSERT INTO safety_events ("eventType", "lineId", notes) VALUES ('near_miss', ${lineId}, ${DAU}) RETURNING id`).id;
    };
    await ev("evA", A.lineId); await ev("evB", B.lineId); await ev("evN", null);
    const sz = async (k: string, lineId: number | null) => {
      id[k] = x<{ id: number }>(await sql`INSERT INTO safety_zones (code, name, "lineId") VALUES (${DAU + k}, ${DAU}, ${lineId}) RETURNING id`).id;
    };
    await sz("szA", A.lineId); await sz("szB", B.lineId);
    const tk = async (k: string, fid: number | null) => {
      id[k] = x<{ id: number }>(await sql`INSERT INTO tasks ("taskKey", "requiredCapability", priority, "factoryId") VALUES (${DAU + k}, 'move', 5, ${fid}) RETURNING id`).id;
    };
    await tk("tkA", A.factoryId); await tk("tkB", B.factoryId); await tk("tkN", null);
    const fz = async (k: string, fid: number) => {
      id[k] = x<{ id: number }>(await sql`INSERT INTO zones (code, name, "factoryId") VALUES (${"0" + DAU + k}, ${DAU}, ${fid}) RETURNING id`).id;
    };
    await fz("fzA", A.factoryId); await fz("fzB", B.factoryId);
    const pj = async (k: string, fid: number) => {
      id[k] = x<{ id: number }>(await sql`INSERT INTO program_projects (code, name, kind, "factoryId") VALUES (${DAU + k}, ${DAU}, 'stub', ${fid}) RETURNING id`).id;
    };
    await pj("pjA", A.factoryId); await pj("pjB", B.factoryId);
    id.pdB = x<{ id: number }>(await sql`INSERT INTO program_deployments ("buildId", "projectId", "factoryId") VALUES (0, ${id.pjB}, ${B.factoryId}) RETURNING id`).id;
    id.pdA = x<{ id: number }>(await sql`INSERT INTO program_deployments ("buildId", "projectId", "factoryId") VALUES (0, ${id.pjA}, ${A.factoryId}) RETURNING id`).id;
    id.anA = x<{ id: number }>(await sql`INSERT INTO robot_behavior_anomalies ("robotId", kind, score, "factoryId") VALUES (${A.robotId}, 'grip_force', 1, ${A.factoryId}) RETURNING id`).id;
    id.anB = x<{ id: number }>(await sql`INSERT INTO robot_behavior_anomalies ("robotId", kind, score, "factoryId") VALUES (${B.robotId}, 'grip_force', 1, ${B.factoryId}) RETURNING id`).id;

    const app = express();
    const r = express.Router();
    registerModuleReadRoutes(r);
    app.use("/api/v1", r);
    await new Promise<void>((resolve) => { server = createServer(app).listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => { try { await q; } catch { /* dọn best-effort */ } };
      await d(sql`DELETE FROM program_deployments WHERE id = ANY(${[id.pdA, id.pdB].filter(Boolean)})`);
      await d(sql`DELETE FROM program_projects WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM robot_behavior_anomalies WHERE id = ANY(${[id.anA, id.anB].filter(Boolean)})`);
      await d(sql`DELETE FROM zones WHERE code LIKE ${"0" + DAU + "%"}`);
      await d(sql`DELETE FROM tasks WHERE "taskKey" LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM safety_zones WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM safety_events WHERE notes = ${DAU}`);
      await d(sql`DELETE FROM robots WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM machines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM stations WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM production_lines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM workshops WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM factories WHERE code LIKE ${DAU + "%"}`);
      await sql.end({ timeout: 5 });
    }
  }, 60_000);

  it("fixture dựng được thật", () => {
    expect(Object.values(id).every((v) => v > 0)).toBe(true);
  });

  describe("khoá MỘT NHÀ MÁY (A)", () => {
    beforeAll(() => { principalHienTai = khoa({ mode: "factory", corporateCode: null, factoryCode: A.code }); });

    it("★★★ /safety/events — chỉ sự kiện của A (không B, không sự kiện không định vị)", async () => {
      const r = await goi("/api/v1/safety/events?limit=500");
      expect(r.status).toBe(200);
      const got = ids(r.body.data.events);
      expect(got).toContain(id.evA);
      expect(got).not.toContain(id.evB);
      expect(got).not.toContain(id.evN);
    });
    it("★★★ /safety/zones — chỉ vùng của A", async () => {
      const got = ids((await goi("/api/v1/safety/zones")).body.data.zones);
      expect(got).toContain(id.szA);
      expect(got).not.toContain(id.szB);
    });
    it("★★★ /fleet/tasks — chỉ task của A (task không gán nhà máy bị ẩn)", async () => {
      const got = ids((await goi("/api/v1/fleet/tasks?limit=500")).body.data.tasks);
      expect(got).toContain(id.tkA);
      expect(got).not.toContain(id.tkB);
      expect(got).not.toContain(id.tkN);
    });
    it("★★★ /fleet/zones — chỉ vùng của A", async () => {
      const got = ids((await goi("/api/v1/fleet/zones")).body.data.zones);
      expect(got).toContain(id.fzA);
      expect(got).not.toContain(id.fzB);
    });
    it("★★★ /programs — chỉ dự án của A; /programs/:id/deployments của B ⇒ 404", async () => {
      const got = ids((await goi("/api/v1/programs?limit=500")).body.data.programs);
      expect(got).toContain(id.pjA);
      expect(got).not.toContain(id.pjB);
      expect((await goi(`/api/v1/programs/${id.pjA}/deployments`)).status).toBe(200);
      expect((await goi(`/api/v1/programs/${id.pjB}/deployments`)).status).toBe(404);
    });
    it("★★★ /anomaly/events — chỉ bất thường robot của A", async () => {
      const got = ids((await goi("/api/v1/anomaly/events?limit=200")).body.data.anomalies);
      expect(got).toContain(id.anA);
      expect(got).not.toContain(id.anB);
    });
    it("★★★ /twin/scene-graph?factoryId — B ⇒ 404; A ⇒ 200", async () => {
      expect((await goi(`/api/v1/twin/scene-graph?factoryId=${A.factoryId}`)).status).toBe(200);
      expect((await goi(`/api/v1/twin/scene-graph?factoryId=${B.factoryId}`)).status).toBe(404);
    });
    it("★★★ /pdm/risk?machineId — máy B ⇒ 404; máy A qua cổng phạm vi (không 404)", async () => {
      expect((await goi(`/api/v1/pdm/risk?machineId=${B.machineId}`)).status).toBe(404);
      expect((await goi(`/api/v1/pdm/risk?machineId=${A.machineId}`)).status).not.toBe(404);
    });
  });

  describe("khoá TOÀN CỤC tường minh — KHÔNG thêm mệnh đề nào", () => {
    beforeAll(() => { principalHienTai = khoa(GLOBAL_TENANT_SCOPE); });
    it("thấy cả A lẫn B, kể cả hàng không định vị", async () => {
      const ev = ids((await goi("/api/v1/safety/events?limit=500")).body.data.events);
      expect(ev).toEqual(expect.arrayContaining([id.evA, id.evB, id.evN]));
      expect(ids((await goi("/api/v1/fleet/tasks?limit=500")).body.data.tasks)).toEqual(expect.arrayContaining([id.tkA, id.tkB, id.tkN]));
      expect(ids((await goi("/api/v1/programs?limit=500")).body.data.programs)).toEqual(expect.arrayContaining([id.pjA, id.pjB]));
      expect(ids((await goi("/api/v1/anomaly/events?limit=200")).body.data.anomalies)).toEqual(expect.arrayContaining([id.anA, id.anB]));
      expect((await goi(`/api/v1/twin/scene-graph?factoryId=${B.factoryId}`)).status).toBe(200);
      expect((await goi(`/api/v1/pdm/risk?machineId=${B.machineId}`)).status).not.toBe(404);
    });
  });

  describe("khoá CHƯA KHAI — fail-closed", () => {
    beforeAll(() => { principalHienTai = khoa(UNDECLARED_TENANT_SCOPE); });
    it("mọi danh sách rỗng, id ⇒ 404", async () => {
      expect(ids((await goi("/api/v1/safety/events?limit=500")).body.data.events)).not.toContain(id.evA);
      expect(ids((await goi("/api/v1/fleet/tasks?limit=500")).body.data.tasks)).not.toContain(id.tkA);
      expect(ids((await goi("/api/v1/programs?limit=500")).body.data.programs)).not.toContain(id.pjA);
      expect((await goi(`/api/v1/twin/scene-graph?factoryId=${A.factoryId}`)).status).toBe(404);
      expect((await goi(`/api/v1/pdm/risk?machineId=${A.machineId}`)).status).toBe(404);
    });
  });
});
