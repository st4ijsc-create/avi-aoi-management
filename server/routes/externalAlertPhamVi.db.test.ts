/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24, nhóm ②: /api/external/{alerts, alerts/:alertId, alerts/:alertId/acknowledge|resolve, bulletins} theo PHẠM VI người gọi
 * (token Bearer ⇒ nhà máy được gán; master key ⇒ toàn quyền). Quy ước cụm `_phamViNgoai.ts`: danh sách kèm `scopeApplied`; tra/ghi theo id ngoài phạm vi ⇒ 403 `external_factory_scope_denied`.
 *
 * Quy tắc quy thuộc: alert_history ⇒ qua alert_settings (machineId/factoryId; quy tắc "toàn bộ" không định vị ⇒ chỉ toàn quyền); mqtt_alert_history ⇒ quy tắc MQTT cấp HỆ THỐNG
 * (không có cột nhà máy) ⇒ chỉ toàn quyền; mqtt_connection_alerts ⇒ (targetType, targetId) máy/trạm/nhà máy; bulletins ⇒ stationId.
 * Chỉ thay middleware xác thực; handler, SQL, CSDL là THẬT.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import postgres from "postgres";
import { registerExternalAlertRoutes } from "./externalAlertApi";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const DB_URL = process.env.DATABASE_URL;
const DAU = `EAL-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";
const x = <T>(r: unknown): T => (r as T[])[0]!;

interface Nm { factoryId: number; code: string; machineId: number; stationId: number; userId: number; setId: number; ahId: number; connId: number; connMId: number; bulId: number }
let A!: Nm;
let B!: Nm;
let admin!: { id: number; role: string };
let userRong!: { id: number; role: string };
const g: Record<string, number> = {};
const usersById = new Map<number, { id: number; role: string }>();

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
  const u = await taoNguoiDungTest(ten.toLowerCase(), "engineer", { tienTo: "eal", ts: DAU, ten: `EAL ${ten}` });
  await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`;
  usersById.set(u.id, { id: u.id, role: "engineer" });
  const set = x<{ id: number }>(await sql`INSERT INTO alert_settings ("userId", name, "alertType", threshold, "machineId") VALUES (${u.id}, ${DAU + ten}, ${await nhan("alert_settings", "alertType")}, 1, ${m.id}) RETURNING id`);
  const ah = x<{ id: number }>(await sql`INSERT INTO alert_history ("alertSettingId", "triggeredValue", message) VALUES (${set.id}, 1, ${DAU + ten}) RETURNING id`);
  const connT = await nhan("mqtt_connection_alerts", "alertType");
  const conn = x<{ id: number }>(await sql`INSERT INTO mqtt_connection_alerts ("profileId", "targetType", "targetId", "alertType", title, message)
    VALUES (0, 'station', ${s.id}, ${connT}, ${DAU + ten}, ${DAU}) RETURNING id`);
  const connM = x<{ id: number }>(await sql`INSERT INTO mqtt_connection_alerts ("profileId", "targetType", "targetId", "alertType", title, message)
    VALUES (0, 'machine', ${m.id}, ${connT}, ${DAU + ten + "m"}, ${DAU}) RETURNING id`);
  const bul = x<{ id: number }>(await sql`INSERT INTO mqtt_bulletin_history ("stationId", "periodStart", "periodEnd", payload) VALUES (${s.id}, now(), now(), ${sql.json({ ghi: DAU })}) RETURNING id`);
  return { factoryId: f.id, code, machineId: m.id, stationId: s.id, userId: u.id, setId: set.id, ahId: ah.id, connId: conn.id, connMId: connM.id, bulId: bul.id };
}
async function goi(method: string, path: string, who: "master" | number, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, { method, headers: { "x-test-who": String(who), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const idsDs = (r: { body: any }): string[] => (r.body.data as Array<{ id: string }>).map((a) => a.id);

describe.skipIf(!DB_URL)("external alerts + bulletins — phạm vi người gọi", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    A = await taoNhanh("A");
    B = await taoNhanh("B");
    // quy tắc "toàn bộ" (không định vị) + quy tắc/lịch sử MQTT cấp hệ thống
    const set = x<{ id: number }>(await sql`INSERT INTO alert_settings ("userId", name, "alertType", threshold) VALUES (${A.userId}, ${DAU + "G"}, ${await nhan("alert_settings", "alertType")}, 1) RETURNING id`);
    g.ahG = x<{ id: number }>(await sql`INSERT INTO alert_history ("alertSettingId", "triggeredValue", message) VALUES (${set.id}, 1, ${DAU + "G"}) RETURNING id`).id;
    const rule = x<{ id: number }>(await sql`INSERT INTO mqtt_alert_rules (name, "ruleType", "thresholdValue") VALUES (${DAU}, ${await nhan("mqtt_alert_rules", "ruleType")}, 1) RETURNING id`);
    g.mqtt = x<{ id: number }>(await sql`INSERT INTO mqtt_alert_history ("ruleId", "ruleName", "ruleType", "triggeredValue", "thresholdValue", message) VALUES (${rule.id}, ${DAU}, 'x', 1, 1, ${DAU}) RETURNING id`).id;
    const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "eal", ts: DAU, ten: "EAL ad" });
    admin = { id: ad.id, role: "admin" };
    usersById.set(admin.id, admin);
    const ur = await taoNguoiDungTest("ur", "engineer", { tienTo: "eal", ts: DAU, ten: "EAL ur" });
    userRong = { id: ur.id, role: "engineer" };
    usersById.set(userRong.id, userRong);

    const app = express();
    app.use(express.json());
    const xacThuc: express.RequestHandler = (req, res, next) => {
      const who = String(req.header("x-test-who") ?? "");
      if (who === "master") return next();
      const u = usersById.get(Number(who));
      if (!u) return res.status(401).json({ success: false });
      (req as any).externalUser = u;
      next();
    };
    registerExternalAlertRoutes(app, xacThuc);
    await new Promise<void>((resolve) => { server = createServer(app).listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 90_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => { try { await q; } catch { /* dọn best-effort */ } };
      await d(sql`DELETE FROM mqtt_bulletin_history WHERE payload::text LIKE ${"%" + DAU + "%"}`);
      await d(sql`DELETE FROM mqtt_connection_alerts WHERE message = ${DAU}`);
      await d(sql`DELETE FROM mqtt_alert_history WHERE "ruleName" = ${DAU}`);
      await d(sql`DELETE FROM mqtt_alert_rules WHERE name = ${DAU}`);
      await d(sql`DELETE FROM alert_history WHERE message LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM alert_settings WHERE name LIKE ${DAU + "%"}`);
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
    expect(A.ahId).not.toBe(B.ahId);
  });

  describe("GET /alerts (danh sách)", () => {
    it("★★★ người nhà máy A chỉ thấy cảnh báo của A: cảnh báo theo quy tắc (máy A), kết nối (trạm A, máy A); KHÔNG thấy của B, quy tắc 'toàn bộ', MQTT hệ thống", async () => {
      const r = await goi("GET", "/api/external/alerts?limit=200", A.userId);
      expect(r.status).toBe(200);
      const ids = idsDs(r);
      expect(ids).toEqual(expect.arrayContaining([`alert-${A.ahId}`, `conn-${A.connId}`, `conn-${A.connMId}`]));
      for (const k of [`alert-${B.ahId}`, `conn-${B.connId}`, `conn-${B.connMId}`, `alert-${g.ahG}`, `mqtt-${g.mqtt}`]) expect(ids, k).not.toContain(k);
      expect(r.body.scopeApplied).toBe(true);
    });
    it("người dùng không gán nhà máy ⇒ rỗng", async () => {
      expect(idsDs(await goi("GET", "/api/external/alerts?limit=200", userRong.id))).toEqual([]);
    });
    it("đối chứng DƯƠNG: master key và admin thấy tất cả", async () => {
      for (const who of ["master", admin.id] as const) {
        const ids = idsDs(await goi("GET", "/api/external/alerts?limit=200", who));
        expect(ids, String(who)).toEqual(expect.arrayContaining([`alert-${A.ahId}`, `alert-${B.ahId}`, `conn-${B.connId}`, `alert-${g.ahG}`, `mqtt-${g.mqtt}`]));
      }
      expect((await goi("GET", "/api/external/alerts", "master")).body.scopeApplied).toBe(false);
    });
  });

  describe("GET /alerts/:alertId", () => {
    it("★★★ cảnh báo B ⇒ 403 external_factory_scope_denied (mọi nguồn); của A ⇒ 200; không tồn tại ⇒ 404", async () => {
      for (const id of [`alert-${B.ahId}`, `conn-${B.connId}`, `conn-${B.connMId}`, `alert-${g.ahG}`, `mqtt-${g.mqtt}`]) {
        const r = await goi("GET", `/api/external/alerts/${id}`, A.userId);
        expect(r.status, id).toBe(403);
        expect(r.body.code, id).toBe("external_factory_scope_denied");
      }
      for (const id of [`alert-${A.ahId}`, `conn-${A.connId}`]) expect((await goi("GET", `/api/external/alerts/${id}`, A.userId)).status, id).toBe(200);
      expect((await goi("GET", "/api/external/alerts/alert-999999999", A.userId)).status).toBe(404);
    });
    it("đối chứng DƯƠNG: master đọc được cảnh báo B", async () => {
      expect((await goi("GET", `/api/external/alerts/alert-${B.ahId}`, "master")).status).toBe(200);
    });
  });

  describe("POST acknowledge / resolve", () => {
    it("★★★ xác nhận/xử lý cảnh báo B ⇒ 403 và hàng KHÔNG đổi; cảnh báo A ⇒ 200 và hàng đổi", async () => {
      expect((await goi("POST", `/api/external/alerts/alert-${B.ahId}/acknowledge`, A.userId)).status).toBe(403);
      expect((await goi("POST", `/api/external/alerts/conn-${B.connId}/acknowledge`, A.userId)).status).toBe(403);
      expect((await goi("POST", `/api/external/alerts/conn-${B.connId}/resolve`, A.userId, {})).status).toBe(403);
      expect((await goi("POST", `/api/external/alerts/mqtt-${g.mqtt}/resolve`, A.userId, {})).status).toBe(403);
      expect(x<{ a: Date | null }>(await sql`SELECT "acknowledgedAt" AS a FROM alert_history WHERE id = ${B.ahId}`).a).toBeNull();
      const cb = x<{ a: boolean; r: boolean }>(await sql`SELECT "isAcknowledged" AS a, "isResolved" AS r FROM mqtt_connection_alerts WHERE id = ${B.connId}`);
      expect(cb).toEqual({ a: false, r: false });
      expect(x<{ r: boolean }>(await sql`SELECT "isResolved" AS r FROM mqtt_alert_history WHERE id = ${g.mqtt}`).r).toBe(false);
      // đối chứng DƯƠNG
      expect((await goi("POST", `/api/external/alerts/alert-${A.ahId}/acknowledge`, A.userId)).status).toBe(200);
      expect(x<{ a: Date | null }>(await sql`SELECT "acknowledgedAt" AS a FROM alert_history WHERE id = ${A.ahId}`).a).not.toBeNull();
      expect((await goi("POST", `/api/external/alerts/conn-${A.connId}/resolve`, A.userId, {})).status).toBe(200);
    });
  });

  describe("GET /bulletins", () => {
    it("★★★ chỉ bản tin của trạm A; ?stationId=B ⇒ rỗng (không phải bản tin B)", async () => {
      const r = await goi("GET", "/api/external/bulletins?limit=200", A.userId);
      const ids: number[] = r.body.data.map((b: { id: number }) => b.id);
      expect(ids).toContain(A.bulId);
      expect(ids).not.toContain(B.bulId);
      expect(r.body.scopeApplied).toBe(true);
      const rb = await goi("GET", `/api/external/bulletins?stationId=${B.stationId}`, A.userId);
      expect(rb.body.data.map((b: { id: number }) => b.id)).not.toContain(B.bulId);
    });
    it("đối chứng DƯƠNG: master thấy cả hai", async () => {
      const ids: number[] = (await goi("GET", "/api/external/bulletins?limit=200", "master")).body.data.map((b: { id: number }) => b.id);
      expect(ids).toEqual(expect.arrayContaining([A.bulId, B.bulId]));
    });
  });
});
