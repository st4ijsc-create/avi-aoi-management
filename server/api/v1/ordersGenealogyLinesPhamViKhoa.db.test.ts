/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24, nhóm 2: /api/v1 orders (ordersLifecycle.ts), genealogy (genealogyApi.ts), lines (lines.ts) theo PHẠM VI KHOÁ API.
 *
 * Lỗ: khoá của nhà máy A đọc lệnh sản xuất / lịch sử truy xuất / trạng thái chuyền của nhà máy B, và GHI: allocate/hold/resume/cancel lệnh B, ra lệnh chuyền B
 * (start/stop...), nạp recipe set cho chuyền B. Luật: ngoài phạm vi ≡ 404 cùng hình dạng "không tồn tại", kiểm TRƯỚC mọi tác dụng phụ; danh sách chỉ mục trong phạm vi;
 * genealogy: một đơn vị (serial) chỉ thấy khi có ÍT NHẤT MỘT bản ghi bước/linh kiện thuộc máy trong phạm vi, và CHỈ các bản ghi ấy được trả; khoá TOÀN CỤC không thêm mệnh đề;
 * khoá CHƯA KHAI ⇒ rỗng/404. Chỉ thay requireScope; envelope, wrap, handler, CSDL là THẬT.
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
const DAU = `OGL-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";

interface Nm { factoryId: number; code: string; workshopId: number; lineId: number; stationId: number; machineId: number; orderId: number; serial: string }
let A!: Nm;
let B!: Nm;
let modelId = 0;
const serialAB = `${DAU}-SAB`; // đơn vị có bản ghi ở CẢ HAI nhà máy
const serialIN = `${DAU}-SIN`; // đơn vị có KIỂM TRA (product_inspections) ở cả hai nhà máy
const serialCH = `${DAU}-SCH`; // đơn vị CHỈ có sự kiện chuỗi (genealogy_chain) — không mang máy nào
const x = <T>(r: unknown): T => (r as T[])[0]!;

async function taoNhanh(ten: string): Promise<Nm> {
  const code = `${DAU}-${ten}`;
  const f = x<{ id: number }>(await sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const w = x<{ id: number }>(await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const l = x<{ id: number }>(await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const s = x<{ id: number }>(await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const m = x<{ id: number }>(await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const o = x<{ id: number }>(await sql`INSERT INTO production_orders ("orderCode", "companyCode", "factoryId", "workshopId", "lineId", "productModelId", "targetQuantity")
    VALUES (${code + "-PO"}, ${"CO"}, ${f.id}, ${w.id}, ${l.id}, ${modelId}, 10) RETURNING id`);
  const serial = `${DAU}-S${ten}`;
  await sql`INSERT INTO process_results ("serialNumber", "machineId", "stepType", result, "measuredAt") VALUES (${serial}, ${m.id}, 'aoi', 'pass', now())`;
  await sql`INSERT INTO component_installations ("serialNumber", "componentCode", "machineId") VALUES (${serial}, ${DAU + "-PART-" + ten}, ${m.id})`;
  return { factoryId: f.id, code, workshopId: w.id, lineId: l.id, stationId: s.id, machineId: m.id, orderId: o.id, serial };
}
const khoaNm = (tenantScope: ApiKeyTenantScope): ApiPrincipal => ({
  kind: "api-key", name: `${DAU}-khoa`, scopes: ["orders:read", "orders:write", "data:read", "lines:read", "lines:write"], apiKeyId: 0, tenantScope,
});
async function goi(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => null) };
}
const gui = (method: string, path: string, body?: unknown) =>
  goi(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const trangThaiDon = async (id: number) => x<{ s: string | null; l: string | null }>(await sql`SELECT status::text AS s, lifecycle_state AS l FROM production_orders WHERE id = ${id}`);

describe.skipIf(!DB_URL)("orders + genealogy + lines — phạm vi KHOÁ API", () => {
  beforeAll(async () => {
    vi.stubEnv("ORDER_LIFECYCLE_ENABLED", "true");
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const pm = await sql`SELECT id FROM product_models ORDER BY id LIMIT 1`;
    modelId = pm.length ? (pm[0] as { id: number }).id : x<{ id: number }>(await sql`INSERT INTO product_models (code, name) VALUES (${DAU + "-PM"}, ${DAU}) RETURNING id`).id;
    A = await taoNhanh("A");
    B = await taoNhanh("B");
    // đơn vị AB: một bước ở máy A, một bước ở máy B
    await sql`INSERT INTO process_results ("serialNumber", "machineId", "stepType", result, "measuredAt") VALUES (${serialAB}, ${A.machineId}, 'a-step', 'pass', now())`;
    await sql`INSERT INTO process_results ("serialNumber", "machineId", "stepType", result, "measuredAt") VALUES (${serialAB}, ${B.machineId}, 'b-step', 'pass', now())`;
    for (const nm of [A, B]) {
      await sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime") VALUES (${nm.machineId}, ${serialIN}, 'OK', 'OK', now())`;
    }
    await sql`INSERT INTO genealogy_chain ("prevHash", "currHash", "serialNumber", "eventType", payload) VALUES (${'0'.repeat(64)}, ${DAU.padEnd(64, '0')}, ${serialCH}, 'probe', '{}'::jsonb)`;
    const app = express();
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => { server = createServer(app).listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => { try { await q; } catch { /* dọn best-effort */ } };
      await d(sql`DELETE FROM order_state_transitions WHERE "orderId" IN (${A.orderId}, ${B.orderId})`);
      await d(sql`DELETE FROM production_orders WHERE "orderCode" LIKE ${DAU + "%"}`);
      // product_inspections là WORM với avi_app (REVOKE DELETE) ⇒ dọn hàng THỬ của chính mình bằng chủ sở hữu `aoi` (tiền lệ: ANALYZE trong lưới planner-stats)
      try {
        const u = new URL(DB_URL!);
        u.username = "aoi";
        u.password = "aoi";
        const chu = postgres(u.toString(), { max: 1, onnotice: () => {} });
        await chu`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${DAU + "%"}`;
        await chu.end({ timeout: 5 });
      } catch { /* dọn best-effort */ }
      await d(sql`DELETE FROM genealogy_chain WHERE "serialNumber" LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM process_results WHERE "serialNumber" LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM component_installations WHERE "serialNumber" LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM line_states WHERE line_id IN (${A.lineId}, ${B.lineId})`);
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
    expect(A.orderId).not.toBe(B.orderId);
  });

  describe("khoá MỘT NHÀ MÁY (A)", () => {
    beforeAll(() => { principalHienTai = khoaNm({ mode: "factory", corporateCode: null, factoryCode: A.code }); });

    it("★★★ GET /orders — chỉ lệnh của A", async () => {
      const ids = (b: any) => (b.data.orders as Array<{ id: number }>).map((o) => o.id);
      expect(ids((await goi(`/api/v1/orders?lineId=${A.lineId}`)).body)).toContain(A.orderId);
      expect(ids((await goi(`/api/v1/orders?lineId=${B.lineId}`)).body)).not.toContain(B.orderId);
      expect(ids((await goi("/api/v1/orders?limit=200")).body)).not.toContain(B.orderId);
    });
    it("★★★ GET /orders/:id và /trace — lệnh B ⇒ 404; lệnh A ⇒ 200", async () => {
      for (const p of ["", "/trace"]) {
        expect((await goi(`/api/v1/orders/${A.orderId}${p}`)).status, `A ${p}`).toBe(200);
        expect((await goi(`/api/v1/orders/${B.orderId}${p}`)).status, `B ${p}`).toBe(404);
      }
    });
    it("★★★ POST /orders/:id/{hold,resume,cancel,allocate} — lệnh B ⇒ 404 và trạng thái KHÔNG đổi", async () => {
      const truoc = await trangThaiDon(B.orderId);
      for (const p of ["hold", "resume", "cancel", "allocate"]) {
        expect((await gui("POST", `/api/v1/orders/${B.orderId}/${p}`, {})).status, p).toBe(404);
      }
      expect(await trangThaiDon(B.orderId)).toEqual(truoc);
    });
    it("★★★ POST /orders/:id/allocate lệnh A sang chuyền của B ⇒ 404", async () => {
      expect((await gui("POST", `/api/v1/orders/${A.orderId}/allocate`, { lineId: B.lineId })).status).toBe(404);
    });
    it("★★★ GET /genealogy/:unitId — đơn vị B ⇒ 404; đơn vị A ⇒ 200; đơn vị AB chỉ trả bước ở máy A", async () => {
      expect((await goi(`/api/v1/genealogy/${A.serial}`)).status).toBe(200);
      expect((await goi(`/api/v1/genealogy/${B.serial}`)).status).toBe(404);
      const ab = await goi(`/api/v1/genealogy/${serialAB}`);
      expect(ab.status).toBe(200);
      const buoc = (ab.body.data.steps as Array<{ station: string }>).map((s) => s.station);
      expect(buoc).toContain(A.code);
      expect(buoc).not.toContain(B.code);
    });
    it("★★★ genealogy — đơn vị có KIỂM TRA ở cả hai nhà máy chỉ trả bước ở máy A; đơn vị chỉ có sự kiện chuỗi (không mang máy) ⇒ 404", async () => {
      const r = await goi(`/api/v1/genealogy/${serialIN}`);
      expect(r.status).toBe(200);
      const buoc = (r.body.data.steps as Array<{ station: string }>).map((x2) => x2.station);
      expect(buoc).toContain(A.code);
      expect(buoc).not.toContain(B.code);
      expect((await goi(`/api/v1/genealogy/${serialCH}`)).status).toBe(404);
    });
    it("★★★ POST /genealogy/search?part — chỉ đơn vị của A", async () => {
      const a = await gui("POST", "/api/v1/genealogy/search", { part: `${DAU}-PART-A` });
      expect(a.body.data.units).toEqual([A.serial]);
      const b = await gui("POST", "/api/v1/genealogy/search", { part: `${DAU}-PART-B` });
      expect(b.body.data.units).toEqual([]);
    });
    it("★★★ GET /lines — chỉ chuyền của A; /lines/:id/state|stages của B ⇒ 404", async () => {
      const ids = (await goi("/api/v1/lines")).body.data.lines.map((l: { lineId: number }) => l.lineId);
      expect(ids).toContain(A.lineId);
      expect(ids).not.toContain(B.lineId);
      for (const p of ["state", "stages"]) {
        expect((await goi(`/api/v1/lines/${A.lineId}/${p}`)).status, `A ${p}`).toBe(200);
        expect((await goi(`/api/v1/lines/${B.lineId}/${p}`)).status, `B ${p}`).toBe(404);
      }
    });
    it("★★★ POST /lines/:id/command và /recipe — chuyền B ⇒ 404 và line_states KHÔNG đổi", async () => {
      const truoc = await sql`SELECT state FROM line_states WHERE line_id = ${B.lineId}`;
      expect((await gui("POST", `/api/v1/lines/${B.lineId}/command`, { command: "start" })).status).toBe(404);
      const rc = await gui("POST", `/api/v1/lines/${B.lineId}/recipe`, { recipeSetCode: "X@v1" });
      expect(rc.status).toBe(404);
      expect(rc.body.error.code).toBe("not_found"); // chuyền ngoài phạm vi — KHÔNG phải recipe_set_not_found (tức đã chạm tới nạp recipe)
      expect(await sql`SELECT state FROM line_states WHERE line_id = ${B.lineId}`).toEqual(truoc);
    });
  });

  describe("khoá TOÀN CỤC tường minh — KHÔNG thêm mệnh đề nào", () => {
    beforeAll(() => { principalHienTai = khoaNm(GLOBAL_TENANT_SCOPE); });
    it("thấy cả A lẫn B", async () => {
      expect((await goi(`/api/v1/orders/${B.orderId}`)).status).toBe(200);
      expect((await goi(`/api/v1/genealogy/${B.serial}`)).status).toBe(200);
      const ab = await goi(`/api/v1/genealogy/${serialAB}`);
      const buoc = (ab.body.data.steps as Array<{ station: string }>).map((s) => s.station);
      expect(buoc).toEqual(expect.arrayContaining([A.code, B.code]));
      expect((await goi(`/api/v1/lines/${B.lineId}/state`)).status).toBe(200);
      expect((await goi(`/api/v1/genealogy/${serialCH}`)).status).toBe(200);
      const inb = (await goi(`/api/v1/genealogy/${serialIN}`)).body.data.steps.map((x2: { station: string }) => x2.station);
      expect(inb).toEqual(expect.arrayContaining([A.code, B.code]));
      expect((await gui("POST", "/api/v1/genealogy/search", { part: `${DAU}-PART-B` })).body.data.units).toEqual([B.serial]);
    });
  });

  describe("khoá CHƯA KHAI — fail-closed", () => {
    beforeAll(() => { principalHienTai = khoaNm(UNDECLARED_TENANT_SCOPE); });
    it("mọi id ⇒ 404, danh sách rỗng (kể cả của A)", async () => {
      expect((await goi(`/api/v1/orders/${A.orderId}`)).status).toBe(404);
      expect((await goi(`/api/v1/genealogy/${A.serial}`)).status).toBe(404);
      expect((await goi(`/api/v1/lines/${A.lineId}/state`)).status).toBe(404);
      expect((await gui("POST", "/api/v1/genealogy/search", { part: `${DAU}-PART-A` })).body.data.units).toEqual([]);
      const lines = (await goi("/api/v1/lines")).body.data.lines.map((l: { lineId: number }) => l.lineId);
      expect(lines).not.toContain(A.lineId);
    });
  });
});
