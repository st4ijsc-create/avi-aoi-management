/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24, nhóm 3: /api/v1 events, metrics, advice, pdmHealth + moduleReads (standards/compliance) theo PHẠM VI KHOÁ API.
 *
 * Lỗ: khoá của nhà máy A đọc sự kiện andon/an toàn/interlock, chỉ số OEE theo máy/chuyền, dự đoán/khuyến nghị, đề xuất HITL (ai_pending_actions) và điểm sức khoẻ/cảnh báo dự đoán của
 * nhà máy B; /standards/compliance đếm TỔNG trên mọi máy (lộ số lượng nhà máy khác). Luật: ngoài phạm vi ≡ 404 cùng hình dạng "không tồn tại"; danh sách chỉ mục trong phạm vi;
 * khoá TOÀN CỤC không thêm mệnh đề; khoá CHƯA KHAI ⇒ rỗng/404. Chỉ thay requireScope; envelope, wrap, handler, CSDL là THẬT.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import postgres from "postgres";
import type { ApiPrincipal } from "./auth";
import { GLOBAL_TENANT_SCOPE, UNDECLARED_TENANT_SCOPE, type ApiKeyTenantScope } from "./apiKeyScope";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";

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
const DAU = `EMA-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";

interface Nm { factoryId: number; code: string; lineId: number; stationId: number; machineId: number; ruleId: number; userId: number }
let A!: Nm;
let B!: Nm;
const id: Record<string, number | string> = {};
const x = <T>(r: unknown): T => (r as T[])[0]!;

async function nhan(bang: string, cot: string): Promise<string> {
  return x<{ l: string }>(await sql`SELECT e.enumlabel AS l FROM information_schema.columns c JOIN pg_type t ON t.typname = c.udt_name JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE c.table_name = ${bang} AND c.column_name = ${cot} ORDER BY e.enumsortorder LIMIT 1`).l;
}

async function taoNhanh(ten: string): Promise<Nm> {
  const code = `${DAU}-${ten}`;
  const f = x<{ id: number }>(await sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const w = x<{ id: number }>(await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const l = x<{ id: number }>(await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const s = x<{ id: number }>(await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const m = x<{ id: number }>(await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const u = await taoNguoiDungTest(`${ten.toLowerCase()}`, "engineer", { tienTo: "ema", ts: DAU, ten: `EMA ${ten}` });
  await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`;
  const rule = x<{ id: number }>(await sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceType", "comparisonOperator", action)
    VALUES (${code}, ${await nhan("interlock_rules", "scope")}, ${m.id}, ${await nhan("interlock_rules", "sourceType")}, ${await nhan("interlock_rules", "comparisonOperator")}, ${await nhan("interlock_rules", "action")}) RETURNING id`);
  return { factoryId: f.id, code, lineId: l.id, stationId: s.id, machineId: m.id, ruleId: rule.id, userId: u.id };
}
const khoaNm = (tenantScope: ApiKeyTenantScope): ApiPrincipal => ({
  kind: "api-key", name: `${DAU}-khoa`, scopes: ["data:read", "pdm:read", "advice:read", "standards:read"], apiKeyId: 0, tenantScope,
});
async function goi(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => null) };
}
const gui = (path: string, body: unknown) => goi(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe.skipIf(!DB_URL)("events + metrics + advice + pdmHealth + compliance — phạm vi KHOÁ API", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    A = await taoNhanh("A");
    B = await taoNhanh("B");
    const andonState = await nhan("andon_events", "state");
    const andonReason = await nhan("andon_events", "reason");
    for (const [k, nm] of [["A", A], ["B", B]] as const) {
      id[`andon${k}`] = x<{ id: number }>(await sql`INSERT INTO andon_events (state, reason, "machineId", title) VALUES (${andonState}, ${andonReason}, ${nm.machineId}, ${DAU}) RETURNING id`).id;
      id[`ilk${k}`] = x<{ id: number }>(await sql`INSERT INTO interlock_events ("ruleId", notes) VALUES (${nm.ruleId}, ${DAU}) RETURNING id`).id;
      id[`saf${k}`] = x<{ id: number }>(await sql`INSERT INTO safety_events ("eventType", "lineId", notes) VALUES ('near_miss', ${nm.lineId}, ${DAU}) RETURNING id`).id;
      id[`pa${k}`] = x<{ id: number }>(await sql`INSERT INTO predictive_alerts ("alertType", title, description, "machineId", "factoryId")
        VALUES ('PATTERN_ANOMALY', ${DAU + k}, ${DAU}, ${nm.machineId}, ${nm.factoryId}) RETURNING id`).id;
      id[`ng${k}`] = x<{ id: number }>(await sql`INSERT INTO mqtt_ng_rate_thresholds ("stationId", name, "warningThreshold", "criticalThreshold") VALUES (${nm.stationId}, ${DAU + k}, 5, 10) RETURNING id`).id;
      id[`act${k}`] = `${DAU}-act${k}`;
      await sql`INSERT INTO ai_pending_actions (id, tool, "argsJson", "userId", "userRole", summary, "idempotencyKey", "expiresAt")
        VALUES (${id[`act${k}`] as string}, ${DAU}, '{}'::json, ${nm.userId}, 'engineer', ${DAU + k}, ${DAU + "-idem" + k}, now() + interval '1 day')`;
    }
    id.andonN = 0;
    id.sayN = x<{ id: number }>(await sql`INSERT INTO safety_events ("eventType", notes) VALUES ('near_miss', ${DAU}) RETURNING id`).id; // không định vị
    const app = express();
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => { server = createServer(app).listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => { try { await q; } catch { /* dọn best-effort */ } };
      await d(sql`DELETE FROM ai_pending_actions WHERE tool = ${DAU}`);
      await d(sql`DELETE FROM mqtt_ng_rate_thresholds WHERE name LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM predictive_alerts WHERE description = ${DAU}`);
      await d(sql`DELETE FROM safety_events WHERE notes = ${DAU}`);
      await d(sql`DELETE FROM interlock_events WHERE notes = ${DAU}`);
      await d(sql`DELETE FROM andon_events WHERE title = ${DAU}`);
      await d(sql`DELETE FROM interlock_rules WHERE name LIKE ${DAU + "%"}`);
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
    expect(A.machineId).not.toBe(B.machineId);
  });

  describe("khoá MỘT NHÀ MÁY (A)", () => {
    beforeAll(() => { principalHienTai = khoaNm({ mode: "factory", corporateCode: null, factoryCode: A.code }); });

    it("★★★ GET /events — chỉ sự kiện andon/an toàn/interlock của A", async () => {
      const r = await goi("/api/v1/events?limit=1000");
      expect(r.status).toBe(200);
      const got: string[] = r.body.data.events.map((e: { event_id: string }) => e.event_id);
      for (const k of ["andonA", "ilkA", "safA"]) expect(got, k).toContain(`${k.slice(0, -1) === "andon" ? "andon" : k.slice(0, -1) === "ilk" ? "interlock" : "safety"}-${id[k]}`);
      for (const k of ["andonB", "ilkB", "safB"]) expect(got, k).not.toContain(`${k.slice(0, -1) === "andon" ? "andon" : k.slice(0, -1) === "ilk" ? "interlock" : "safety"}-${id[k]}`);
      expect(got).not.toContain(`safety-${id.sayN}`);
    });
    it("★★★ GET /metrics/OEE — máy/chuyền B ⇒ 404; máy/chuyền A qua cổng phạm vi; thiếu scopeId ⇒ 400", async () => {
      expect((await goi(`/api/v1/metrics/OEE?scope=equipment&scopeId=${B.machineId}`)).status).toBe(404);
      expect((await goi(`/api/v1/metrics/OEE?scope=line&scopeId=${B.lineId}`)).status).toBe(404);
      expect((await goi(`/api/v1/metrics/OEE?scope=equipment&scopeId=${A.machineId}`)).status).not.toBe(404);
      expect((await goi(`/api/v1/metrics/OEE?scope=line&scopeId=${A.lineId}`)).status).not.toBe(404);
      expect((await goi("/api/v1/metrics/OEE?scope=equipment")).status).toBe(400);
    });
    it("★★★ POST /predict/forecast|anomaly — tài sản B ⇒ 404; tài sản A ⇒ 200", async () => {
      for (const t of ["forecast", "anomaly"]) {
        expect((await gui(`/api/v1/predict/${t}`, { assetId: B.machineId })).status, `B ${t}`).toBe(404);
        expect((await gui(`/api/v1/predict/${t}`, { assetId: A.machineId })).status, `A ${t}`).toBe(200);
      }
    });
    it("★★★ POST /recommend adjust_param — machineId B ⇒ 404; thiếu machineId (khoá hẹp) ⇒ 400", async () => {
      const goiY = (machineId?: number) => gui("/api/v1/recommend", { action_type: "adjust_param", target: { measurementPointId: 1, ...(machineId ? { machineId } : {}) } });
      expect((await goiY(B.machineId)).status).toBe(404);
      expect((await goiY()).status).toBe(400);
      expect((await goiY(A.machineId)).status).not.toBe(404);
    });
    it("★★★ POST /recommend adjust_ng_threshold — ngưỡng NG của trạm B ⇒ 404; của trạm A qua cổng phạm vi", async () => {
      const goiY = (ngThresholdId: number) => gui("/api/v1/recommend", { action_type: "adjust_ng_threshold", target: { ngThresholdId } });
      expect((await goiY(id.ngB as number)).status).toBe(404);
      expect((await goiY(id.ngA as number)).status).not.toBe(404);
    });
    it("★★★ GET /recommendations — chỉ đề xuất của người dùng thuộc nhà máy A", async () => {
      const got: string[] = (await goi("/api/v1/recommendations?limit=200")).body.data.recommendations.map((r: { rec_id: string }) => r.rec_id);
      expect(got).toContain(id.actA);
      expect(got).not.toContain(id.actB);
    });
    it("★★★ GET /health/assets/:id — máy B ⇒ 404; máy A ⇒ 200", async () => {
      expect((await goi(`/api/v1/health/assets/${A.machineId}`)).status).toBe(200);
      expect((await goi(`/api/v1/health/assets/${B.machineId}`)).status).toBe(404);
    });
    it("★★★ GET /predictions — chỉ cảnh báo dự đoán của A; ?assetId=B ⇒ 404", async () => {
      const got = (await goi("/api/v1/predictions?limit=500")).body.data;
      const ids = JSON.stringify(got);
      expect(ids).toContain(DAU + "A");
      expect(ids).not.toContain(DAU + "B");
      expect((await goi(`/api/v1/predictions?assetId=${B.machineId}`)).status).toBe(404);
    });
    it("★★★ GET /standards/compliance — chỉ đếm máy trong phạm vi khoá (khoá A đếm đúng 1 máy)", async () => {
      const r = await goi("/api/v1/standards/compliance");
      expect(r.status).toBe(200);
      expect(r.body.data.machineCount).toBe(1);
    });
  });

  describe("khoá TOÀN CỤC tường minh — KHÔNG thêm mệnh đề nào", () => {
    beforeAll(() => { principalHienTai = khoaNm(GLOBAL_TENANT_SCOPE); });
    it("thấy cả A lẫn B", async () => {
      const got: string[] = (await goi("/api/v1/events?limit=1000")).body.data.events.map((e: { event_id: string }) => e.event_id);
      expect(got).toEqual(expect.arrayContaining([`andon-${id.andonA}`, `andon-${id.andonB}`, `safety-${id.safA}`, `safety-${id.safB}`, `safety-${id.sayN}`, `interlock-${id.ilkB}`]));
      expect((await gui("/api/v1/predict/forecast", { assetId: B.machineId })).status).toBe(200);
      expect((await goi(`/api/v1/health/assets/${B.machineId}`)).status).toBe(200);
      expect((await goi(`/api/v1/metrics/OEE?scope=equipment&scopeId=${B.machineId}`)).status).not.toBe(404);
      const rec: string[] = (await goi("/api/v1/recommendations?limit=200")).body.data.recommendations.map((r: { rec_id: string }) => r.rec_id);
      expect(rec).toEqual(expect.arrayContaining([id.actA, id.actB]));
      expect((await goi("/api/v1/standards/compliance")).body.data.machineCount).toBeGreaterThan(1);
    });
  });

  describe("khoá CHƯA KHAI — fail-closed", () => {
    beforeAll(() => { principalHienTai = khoaNm(UNDECLARED_TENANT_SCOPE); });
    it("rỗng/404 kể cả của A", async () => {
      const got: string[] = (await goi("/api/v1/events?limit=1000")).body.data.events.map((e: { event_id: string }) => e.event_id);
      expect(got).not.toContain(`andon-${id.andonA}`);
      expect((await goi(`/api/v1/health/assets/${A.machineId}`)).status).toBe(404);
      expect((await gui("/api/v1/predict/forecast", { assetId: A.machineId })).status).toBe(404);
      const rec: string[] = (await goi("/api/v1/recommendations?limit=200")).body.data.recommendations.map((r: { rec_id: string }) => r.rec_id);
      expect(rec).not.toContain(id.actA);
    });
  });
});
