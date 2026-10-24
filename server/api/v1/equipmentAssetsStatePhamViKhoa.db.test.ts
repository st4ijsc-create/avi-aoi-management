/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24, nhóm 1: /api/v1 equipment (router.ts), assets (assets.ts), state (state.ts) theo PHẠM VI KHOÁ API.
 *
 * Lỗ: các tuyến này nhận machineId / asset id / station id / adapter id / đường dẫn ISA-95 từ client và đọc (hoặc GHI: lệnh thiết bị, đổi vòng đời, duyệt baseline cấu hình,
 * đăng ký tài sản, khởi động lại adapter) mà KHÔNG nhìn req.apiPrincipal ⇒ khoá của nhà máy A chạm máy của nhà máy B.
 * Luật: khoá MỘT NHÀ MÁY ⇒ chỉ máy của nhà máy đó; id ngoài phạm vi ≡ 404 cùng hình dạng "không tồn tại" và KHÔNG có tác dụng phụ; khoá TOÀN CỤC ⇒ không thêm mệnh đề;
 * khoá CHƯA KHAI ⇒ rỗng/404; khoá GẮN MÁY (máy-principal) luôn dùng được CHÍNH máy của nó (đối chứng dương — không phá tích hợp máy tự đọc trạng thái mình).
 * Chỉ thay requireScope (đặt principal theo ô); envelope, wrap, handler, CSDL là THẬT.
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

import { createV1Router } from "./router";

const DB_URL = process.env.DATABASE_URL;
const DAU = `EAS-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";

interface Nm { factoryId: number; code: string; lineId: number; stationId: number; machineId: number; adapterId: number; path: string }
let A!: Nm;
let B!: Nm;
const edge: Record<string, number> = {};
const x = <T>(r: unknown): T => (r as T[])[0]!;

async function taoNhanh(ten: string): Promise<Nm> {
  const code = `${DAU}-${ten}`;
  const path = `${DAU.toLowerCase()}/${ten.toLowerCase()}/l/c/e`;
  const f = x<{ id: number }>(await sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const w = x<{ id: number }>(await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const l = x<{ id: number }>(await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const s = x<{ id: number }>(await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const m = x<{ id: number }>(await sql`INSERT INTO machines ("stationId", code, name, "machineType", isa95_path, "isActive") VALUES (${s.id}, ${code}, ${code}, 'AOI', ${path}, true) RETURNING id`);
  const a = x<{ id: number }>(await sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status) VALUES (${m.id}, ${code}, ${code}, 'stub', ${"stub://" + code}, 500, false, 'disabled') RETURNING id`);
  return { factoryId: f.id, code, lineId: l.id, stationId: s.id, machineId: m.id, adapterId: a.id, path };
}
const khoaNm = (tenantScope: ApiKeyTenantScope, extra: Partial<ApiPrincipal> = {}): ApiPrincipal => ({
  kind: "api-key", name: `${DAU}-khoa`, scopes: ["equipment:read", "equipment:command", "assets:read", "assets:write", "data:read"], apiKeyId: 0, tenantScope, ...extra,
});
async function goi(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => null) };
}
const gui = (method: string, path: string, body?: unknown) =>
  goi(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const mids = (rows: Array<{ machineId?: number; machine_id?: number }> | undefined) => (rows ?? []).map((r) => r.machineId ?? r.machine_id);
/** Danh sách máy của đúng MỘT trạm (lọc ?stationId — bảng test có hàng chục nghìn máy khác). */
const dsMay = async (url: string, nm: Nm) => mids((await goi(`${url}?stationId=${nm.stationId}`)).body.data.equipment);
/** Danh sách tài sản theo tiền tố đường dẫn ISA-95 của đúng một nhà máy test. */
const dsTs = async (ten: string) => mids((await goi(`/api/v1/assets?limit=1000&path=${encodeURIComponent(`${DAU.toLowerCase()}/${ten.toLowerCase()}/`)}`)).body.data.assets);
const lifecycleCua = async (mid: number) => x<{ s: string | null }>(await sql`SELECT "lifecycleStatus" AS s FROM machines WHERE id = ${mid}`).s;

describe.skipIf(!DB_URL)("equipment + assets + state — phạm vi KHOÁ API", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    A = await taoNhanh("A");
    B = await taoNhanh("B");
    edge.a = x<{ id: number }>(await sql`INSERT INTO edge_nodes (code, name, "factoryCode") VALUES (${DAU + "-ea"}, ${DAU}, ${A.code}) RETURNING id`).id;
    edge.b = x<{ id: number }>(await sql`INSERT INTO edge_nodes (code, name, "factoryCode") VALUES (${DAU + "-eb"}, ${DAU}, ${B.code}) RETURNING id`).id;
    const app = express();
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => { server = createServer(app).listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => { try { await q; } catch { /* dọn best-effort */ } };
      await d(sql`DELETE FROM edge_nodes WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM machines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM device_adapters WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM stations WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM production_lines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM workshops WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM factories WHERE code LIKE ${DAU + "%"}`);
      await sql.end({ timeout: 5 });
    }
  }, 60_000);

  it("fixture dựng được thật", () => {
    expect(A.machineId).not.toBe(B.machineId);
  });

  describe("khoá MỘT NHÀ MÁY (A, không gắn máy)", () => {
    beforeAll(() => { principalHienTai = khoaNm({ mode: "factory", corporateCode: null, factoryCode: A.code }); });

    it("★★★ GET /equipment — chỉ máy của A", async () => {
      expect(await dsMay("/api/v1/equipment", A)).toEqual([A.machineId]);
      expect(await dsMay("/api/v1/equipment", B)).toEqual([]);
    });
    it("★★★ GET /equipment/:id/{capabilities,telemetry,state} — máy B ⇒ 404; máy A ⇒ 200", async () => {
      for (const p of ["capabilities", "telemetry", "state"]) {
        expect((await goi(`/api/v1/equipment/${A.machineId}/${p}`)).status, `A ${p}`).toBe(200);
        expect((await goi(`/api/v1/equipment/${B.machineId}/${p}`)).status, `B ${p}`).toBe(404);
      }
    });
    it("★★★ POST /equipment/:id/commands — máy B ⇒ 404 TRƯỚC khi chạm dispatcher; máy A qua cổng phạm vi (400 lệnh không hỗ trợ, không phải 404)", async () => {
      const b = await gui("POST", `/api/v1/equipment/${B.machineId}/commands`, { command: "start" });
      expect(b.status).toBe(404);
      const a = await gui("POST", `/api/v1/equipment/${A.machineId}/commands`, { command: "khong-co-lenh-nay" });
      expect(a.status).not.toBe(404);
    });
    it("★★★ GET /assets — chỉ tài sản của A", async () => {
      expect(await dsTs("A")).toEqual([A.machineId]);
      expect(await dsTs("B")).toEqual([]);
    });
    it("★★★ GET /assets/:id (id số VÀ urn) /health /tags /config-drift — của B ⇒ 404; của A ⇒ 200", async () => {
      for (const p of ["", "/health", "/tags", "/config-drift"]) {
        expect((await goi(`/api/v1/assets/${A.machineId}${p}`)).status, `A ${p}`).toBe(200);
        expect((await goi(`/api/v1/assets/${B.machineId}${p}`)).status, `B ${p}`).toBe(404);
      }
    });
    it("★★★ PUT /assets/:id/lifecycle — máy B ⇒ 404 và vòng đời KHÔNG đổi", async () => {
      const truoc = await lifecycleCua(B.machineId);
      const r = await gui("PUT", `/api/v1/assets/${B.machineId}/lifecycle`, { state: "retired", reason: "probe" });
      expect(r.status).toBe(404);
      expect(await lifecycleCua(B.machineId)).toBe(truoc);
    });
    it("★★★ POST /assets/:id/config-drift/approve — máy B ⇒ 404", async () => {
      expect((await gui("POST", `/api/v1/assets/${B.machineId}/config-drift/approve`, { adapterId: B.adapterId })).status).toBe(404);
    });
    it("★★★ POST /assets — đăng ký vào trạm của B ⇒ 404 và KHÔNG tạo máy", async () => {
      const code = `${DAU}-moi`;
      const r = await gui("POST", "/api/v1/assets", { code, name: code, class: "AOI", stationId: B.stationId });
      expect(r.status).toBe(404);
      expect(x<{ n: number }>(await sql`SELECT count(*)::int AS n FROM machines WHERE code = ${code}`).n).toBe(0);
    });
    it("★★★ POST /adapters/:id/restart (cờ BẬT) — adapter của máy B ⇒ 404 TRƯỚC khi chạm otManager; adapter của máy A qua cổng phạm vi (409 OT chưa chạy, không phải 404)", async () => {
      vi.stubEnv("V1_ADAPTER_RESTART_ENABLED", "true");
      try {
        expect((await gui("POST", `/api/v1/adapters/${B.adapterId}/restart`)).status).toBe(404);
        expect((await gui("POST", `/api/v1/adapters/${A.adapterId}/restart`)).status).not.toBe(404);
      } finally {
        vi.unstubAllEnvs();
      }
    });
    it("★★★ GET /gateways/:id/status — nút biên của B ⇒ 404; của A ⇒ 200", async () => {
      expect((await goi(`/api/v1/gateways/${edge.a}/status`)).status).toBe(200);
      expect((await goi(`/api/v1/gateways/${edge.b}/status`)).status).toBe(404);
    });
    it("★★★ GET /state/<đường dẫn ISA-95> — của B ⇒ 404; của A ⇒ 200", async () => {
      expect((await goi(`/api/v1/state/${A.path}`)).status).toBe(200);
      expect((await goi(`/api/v1/state/${B.path}`)).status).toBe(404);
    });
  });

  describe("khoá GẮN MÁY chưa khai (máy-principal của máy A) — chỉ CHÍNH máy của nó", () => {
    beforeAll(() => { principalHienTai = khoaNm(UNDECLARED_TENANT_SCOPE, { kind: "machine", machineId: A.machineId }); });
    it("thấy máy A (đối chứng dương), không thấy máy B", async () => {
      expect(await dsMay("/api/v1/equipment", A)).toEqual([A.machineId]);
      expect(await dsMay("/api/v1/equipment", B)).toEqual([]);
      expect((await goi(`/api/v1/equipment/${A.machineId}/state`)).status).toBe(200);
      expect((await goi(`/api/v1/equipment/${B.machineId}/state`)).status).toBe(404);
      expect((await goi(`/api/v1/assets/${B.machineId}`)).status).toBe(404);
    });
  });

  describe("khoá TOÀN CỤC tường minh — KHÔNG thêm mệnh đề nào", () => {
    beforeAll(() => { principalHienTai = khoaNm(GLOBAL_TENANT_SCOPE); });
    it("thấy cả A lẫn B ở mọi tuyến", async () => {
      expect(await dsMay("/api/v1/equipment", A)).toEqual([A.machineId]);
      expect(await dsMay("/api/v1/equipment", B)).toEqual([B.machineId]);
      expect(await dsTs("A")).toEqual([A.machineId]);
      expect(await dsTs("B")).toEqual([B.machineId]);
      expect((await goi(`/api/v1/equipment/${B.machineId}/state`)).status).toBe(200);
      expect((await goi(`/api/v1/assets/${B.machineId}/health`)).status).toBe(200);
      expect((await goi(`/api/v1/gateways/${edge.b}/status`)).status).toBe(200);
      expect((await goi(`/api/v1/state/${B.path}`)).status).toBe(200);
    });
  });

  describe("khoá CHƯA KHAI (không gắn máy) — fail-closed", () => {
    beforeAll(() => { principalHienTai = khoaNm(UNDECLARED_TENANT_SCOPE); });
    it("danh sách rỗng, id ⇒ 404 (kể cả máy A)", async () => {
      expect(await dsMay("/api/v1/equipment", A)).toEqual([]);
      expect(await dsTs("A")).toEqual([]);
      expect((await goi(`/api/v1/equipment/${A.machineId}/state`)).status).toBe(404);
      expect((await goi(`/api/v1/assets/${A.machineId}`)).status).toBe(404);
      expect((await goi(`/api/v1/gateways/${edge.a}/status`)).status).toBe(404);
      expect((await goi(`/api/v1/state/${A.path}`)).status).toBe(404);
    });
  });
});
