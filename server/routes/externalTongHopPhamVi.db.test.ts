/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24, nhóm ⑤: các tuyến TỔNG HỢP của /api/external theo PHẠM VI người gọi:
 *   inspections/{summary, trend, defect-pareto} (trạm tuỳ chọn) · inspections/{control-chart, histogram, stratification, fail-history, diagnostics, scatter, check-sheet, cause-effect,
 *   ai-analysis, yield-comparison} (BẮT BUỘC stationId) · oee|fleet|safety|pdm|alerts /summary · statistics/measurement-points · dashboard/summary.
 * Lỗ: tài khoản Bearer gán nhà máy A nhận số tổng hợp của MỌI nhà máy (số lượng NG, năng suất, sự kiện an toàn, lệnh bảo trì…), hoặc truy vấn thẳng trạm B.
 * Luật: danh sách/tổng chỉ tính phạm vi người gọi + `scopeApplied`; stationId ngoài phạm vi ⇒ 403 `external_factory_scope_denied`; master key / admin không đổi.
 * Chỉ thay middleware xác thực; handler, SQL, CSDL là THẬT.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import postgres from "postgres";
import { registerExternalInspectionRoutes } from "./externalInspectionApi";
import { registerExternalHierarchyRoutes } from "./externalHierarchyApi";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

// Bọc bộ tính OEE thật bằng spy (vẫn gọi bản gốc) để đo phạm vi người xem ĐƯỢC TRUYỀN XUỐNG — OEE cần dữ liệu trạng thái/sản lượng nên không dựng nổi số liệu đối chứng ngắn.
const oeeGoi = vi.hoisted(() => ({ args: [] as unknown[] }));
vi.mock("../services/oeeService", async (goc) => {
  const m = await goc<typeof import("../services/oeeService")>();
  return { ...m, getAllMachinesOEELive: vi.fn(async (...a: Parameters<typeof m.getAllMachinesOEELive>) => { oeeGoi.args.push(a[0] ?? null); return m.getAllMachinesOEELive(...a); }) };
});

const DB_URL = process.env.DATABASE_URL;
const DAU = `ETH-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";
const x = <T>(r: unknown): T => (r as T[])[0]!;

interface Nm { pmId: number; factoryId: number; workshopId: number; lineId: number; stationId: number; machineId: number; userId: number; code: string }
let A!: Nm;
let B!: Nm;
let pdId = 0;
let pdPm: number | null = null;
let admin!: { id: number; role: string };
let userRong!: { id: number; role: string };
const usersById = new Map<number, { id: number; role: string }>();

async function nhan(bang: string, cot: string, thu = 0): Promise<string> {
  return x<{ l: string }>(await sql`SELECT e.enumlabel AS l FROM information_schema.columns c JOIN pg_type t ON t.typname = c.udt_name JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE c.table_name = ${bang} AND c.column_name = ${cot} ORDER BY e.enumsortorder OFFSET ${thu} LIMIT 1`).l;
}
async function nhanCo(bang: string, cot: string, gt: string): Promise<string> {
  return x<{ l: string }>(await sql`SELECT e.enumlabel AS l FROM information_schema.columns c JOIN pg_type t ON t.typname = c.udt_name JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE c.table_name = ${bang} AND c.column_name = ${cot} AND e.enumlabel = ${gt}`).l;
}
async function taoNhanh(ten: string, pmId: number): Promise<Nm> {
  const code = `${DAU}-${ten}`;
  const f = x<{ id: number }>(await sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const w = x<{ id: number }>(await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const l = x<{ id: number }>(await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const s = x<{ id: number }>(await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const m = x<{ id: number }>(await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const u = await taoNguoiDungTest(ten.toLowerCase(), "engineer", { tienTo: "eth", ts: DAU, ten: `ETH ${ten}` });
  await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`;
  usersById.set(u.id, { id: u.id, role: "engineer" });
  const ok = await nhanCo("product_inspections", "overallResult", "OK");
  const ng = await nhanCo("product_inspections", "overallResult", "NG");
  const orig = await nhan("product_inspections", "originalResult");
  // MỘT kiểm tra NG (+ MỘT điểm đo NG) và MỘT kiểm tra OK trên máy này — hôm nay
  for (const [i, kq] of [ng, ok].entries()) {
    const pi = x<{ id: number }>(await sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "productModelId", "factoryCode")
      VALUES (${m.id}, ${DAU + "-S" + ten + i}, ${kq}, ${orig}, now(), ${pmId}, ${code}) RETURNING id`);
    await sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "measuredValue") VALUES (${pi.id}, ${pdId}, ${kq}, 1.5)`;
  }
  if (pdPm !== null && pmId !== pdPm) {
    // nhà máy khác cũng kiểm sản phẩm của điểm đo (pdPm): số đếm theo sản phẩm sẽ lẫn nhau nếu thiếu phạm vi
    const pi2 = x<{ id: number }>(await sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "productModelId", "factoryCode")
      VALUES (${m.id}, ${DAU + "-S" + ten + "x"}, ${ok}, ${orig}, now(), ${pdPm}, ${code}) RETURNING id`);
    await sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "measuredValue") VALUES (${pi2.id}, ${pdId}, ${ok}, 1.5)`;
  }
  await sql`INSERT INTO safety_events ("eventType", "lineId", "isNearMiss", notes) VALUES ('near_miss', ${l.id}, true, ${DAU})`;
  await sql`INSERT INTO andon_events (state, reason, status, "machineId", title) VALUES ('red', ${await nhan("andon_events", "reason")}, 'raised', ${m.id}, ${DAU})`;
  const set = x<{ id: number }>(await sql`INSERT INTO alert_settings ("userId", name, "alertType", threshold, "machineId") VALUES (${u.id}, ${DAU + ten}, ${await nhan("alert_settings", "alertType")}, 1, ${m.id}) RETURNING id`);
  await sql`INSERT INTO alert_history ("alertSettingId", "triggeredValue", message) VALUES (${set.id}, 1, ${DAU + ten})`;
  await sql`INSERT INTO mqtt_connection_alerts ("profileId", "targetType", "targetId", "alertType", title, message) VALUES (0, 'station', ${s.id}, ${await nhan("mqtt_connection_alerts", "alertType")}, ${DAU}, ${DAU})`;
  if (ten === "A") {
    const rule = x<{ id: number }>(await sql`INSERT INTO mqtt_alert_rules (name, "ruleType", "thresholdValue") VALUES (${DAU}, ${await nhan("mqtt_alert_rules", "ruleType")}, 1) RETURNING id`);
    await sql`INSERT INTO mqtt_alert_history ("ruleId", "ruleName", "ruleType", "triggeredValue", "thresholdValue", message) VALUES (${rule.id}, ${DAU}, 'x', 1, 1, ${DAU})`;
  }
  await sql`INSERT INTO mqtt_bulletin_history ("stationId", "periodStart", "periodEnd", payload) VALUES (${s.id}, now(), now(), ${sql.json({ ghi: DAU })})`;
  await sql`INSERT INTO tasks ("taskKey", "requiredCapability", priority, status, "factoryId") VALUES (${DAU + ten}, 'move', 5, 'pending', ${f.id})`;
  await sql`INSERT INTO robots (code, name, vendor, kind, endpoint, "lineId", status) VALUES (${code}, ${code}, 'sim', 'arm', 'tcp://127.0.0.1:1', ${l.id}, 'idle')`;
  await sql`INSERT INTO maintenance_work_orders ("workOrderNumber", "machineId", type, status, title, "factoryId") VALUES (${DAU + ten}, ${m.id}, 'PREDICTIVE', 'OPEN', ${DAU}, ${f.id})`;
  return { pmId, factoryId: f.id, workshopId: w.id, lineId: l.id, stationId: s.id, machineId: m.id, userId: u.id, code };
}
async function goi(path: string, who: "master" | number): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, { headers: { "x-test-who": String(who) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const KHOANG = "startDate=2020-01-01&endDate=2099-01-01";
const Q = (n: Nm) => `${KHOANG}&stationId=${n.stationId}&pointDefId=${pdId}&productModelId=${n.pmId}&days=7`;
const BAT_BUOC_TRAM = ["control-chart", "histogram", "stratification", "fail-history", "diagnostics", "scatter", "check-sheet", "cause-effect", "ai-analysis", "yield-comparison"];

describe.skipIf(!DB_URL)("external tuyến tổng hợp — phạm vi người gọi", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const pmA = x<{ id: number }>(await sql`INSERT INTO product_models (code, name) VALUES (${DAU + "-PMA"}, ${DAU}) RETURNING id`).id;
    const pmB = x<{ id: number }>(await sql`INSERT INTO product_models (code, name) VALUES (${DAU + "-PMB"}, ${DAU}) RETURNING id`).id;
    pdId = x<{ id: number }>(await sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${pmA}, ${DAU + "-PD"}, ${DAU}, ${await nhan("measurement_point_defs", "measurementType")}, 1, 1) RETURNING id`).id;
    pdPm = pmA;
    A = await taoNhanh("A", pmA);
    B = await taoNhanh("B", pmB);
    const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "eth", ts: DAU, ten: "ETH ad" });
    admin = { id: ad.id, role: "admin" };
    usersById.set(admin.id, admin);
    const ur = await taoNguoiDungTest("ur", "engineer", { tienTo: "eth", ts: DAU, ten: "ETH ur" });
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
    registerExternalHierarchyRoutes(app, xacThuc, xacThuc);
    await new Promise<void>((resolve) => { server = createServer(app).listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => { try { await q; } catch { /* dọn best-effort */ } };
      try {
        const u = new URL(DB_URL!);
        u.username = "aoi";
        u.password = "aoi";
        const chu = postgres(u.toString(), { max: 1, onnotice: () => {} });
        await chu`DELETE FROM measurement_results WHERE "pointDefId" = ${pdId}`;
        await chu`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${DAU + "%"}`;
        await chu.end({ timeout: 5 });
      } catch { /* dọn best-effort */ }
      await d(sql`DELETE FROM mqtt_alert_history WHERE "ruleName" = ${DAU}`);
      await d(sql`DELETE FROM mqtt_alert_rules WHERE name = ${DAU}`);
      await d(sql`DELETE FROM maintenance_work_orders WHERE "workOrderNumber" LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM robots WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM tasks WHERE "taskKey" LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM mqtt_bulletin_history WHERE payload::text LIKE ${"%" + DAU + "%"}`);
      await d(sql`DELETE FROM mqtt_connection_alerts WHERE message = ${DAU}`);
      await d(sql`DELETE FROM alert_history WHERE message LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM alert_settings WHERE name LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM andon_events WHERE title = ${DAU}`);
      await d(sql`DELETE FROM safety_events WHERE notes = ${DAU}`);
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
    expect(A.stationId).not.toBe(B.stationId);
  });

  describe("inspections — trạm tuỳ chọn", () => {
    it("★★★ summary — chỉ máy của A (đúng 1 hàng máy); ?stationId=B ⇒ 403", async () => {
      const r = await goi(`/api/external/inspections/summary?${KHOANG}`, A.userId);
      expect(r.status).toBe(200);
      const may: number[] = r.body.data.details.map((s: { machineId: number }) => s.machineId);
      expect(may).toContain(A.machineId);
      expect(may).not.toContain(B.machineId);
      expect(r.body.data.totals.totalInspections).toBe(2); // 2 kiểm tra của A; B cũng có 2 nhưng KHÔNG được cộng
      expect((await goi(`/api/external/inspections/summary?${KHOANG}&stationId=${B.stationId}`, A.userId)).status).toBe(403);
    });
    it("★★★ trend / defect-pareto với ?stationId=B ⇒ 403 (cả trend theo điểm đo); trend theo điểm đo chỉ đếm A", async () => {
      expect((await goi(`/api/external/inspections/trend?${KHOANG}&groupBy=day&stationId=${B.stationId}`, A.userId)).status).toBe(403);
      expect((await goi(`/api/external/inspections/defect-pareto?${KHOANG}&stationId=${B.stationId}`, A.userId)).status).toBe(403);
      const t = await goi(`/api/external/inspections/trend?${KHOANG}&groupBy=day&pointDefId=${pdId}`, A.userId);
      expect(t.status).toBe(200);
      const tong = (t.body.data.trend as Array<{ totalCount: number }>).reduce((a, p) => a + p.totalCount, 0);
      expect(tong).toBe(2); // 2 kết quả đo của A tại điểm đo; B có 3 ghi vào cùng điểm đo nhưng KHÔNG được cộng
    });
    it("★★★ trend — tổng số kiểm tra chỉ của A (2); defect-pareto — chỉ NG của A (1)", async () => {
      const t = await goi(`/api/external/inspections/trend?${KHOANG}&groupBy=day`, A.userId);
      expect(t.status).toBe(200);
      const tong = (t.body.data.trend as Array<{ totalInspections: number }>).reduce((a, p) => a + p.totalInspections, 0);
      expect(tong).toBe(2);
      const p = await goi(`/api/external/inspections/defect-pareto?${KHOANG}`, A.userId);
      expect(p.status).toBe(200);
      const ng = (p.body.data.items as Array<{ ngCount: number; pointDefId: number }>).filter((i) => i.pointDefId === pdId).reduce((a, i) => a + i.ngCount, 0);
      expect(ng).toBe(1);
      const mauSo = (p.body.data.items as Array<{ totalCount: number; pointDefId: number }>).find((i) => i.pointDefId === pdId)?.totalCount;
      expect(mauSo).toBe(2); // mẫu số tỉ lệ NG cũng chỉ của A (truy vấn con pi2)
    });
  });

  describe("inspections — BẮT BUỘC stationId (mười tuyến)", () => {
    it("★★★ trạm B ⇒ 403 external_factory_scope_denied; trạm A KHÔNG bị 403", async () => {
      for (const t of BAT_BUOC_TRAM) {
        const b = await goi(`/api/external/inspections/${t}?${Q(B)}`, A.userId);
        expect(b.status, `B ${t}`).toBe(403);
        expect(b.body.code, `B ${t}`).toBe("external_factory_scope_denied");
        expect((await goi(`/api/external/inspections/${t}?${Q(A)}`, A.userId)).status, `A ${t}`).not.toBe(403);
      }
    });
  });

  describe("summary feeds + dashboard + thống kê điểm đo", () => {
    it("★★★ safety/summary & alerts/summary — chỉ sự kiện của A (không cộng B)", async () => {
      const sA = await goi("/api/external/safety/summary", A.userId);
      const sM = await goi("/api/external/safety/summary", "master");
      expect(sA.body.data.openEvents).toBe(1);
      expect(sM.body.data.openEvents).toBeGreaterThan(sA.body.data.openEvents);
      const aA = await goi("/api/external/alerts/summary", A.userId);
      expect(aA.body.data.open).toBe(2); // 1 andon mở + 1 sự kiện an toàn của A
    });
    it("★★★ fleet/summary & pdm/summary — chỉ task/robot/lệnh bảo trì của A", async () => {
      const f = await goi("/api/external/fleet/summary", A.userId);
      expect(f.body.data.tasksPending).toBe(1);
      expect(f.body.data.robotsTotal).toBe(1);
      const p = await goi("/api/external/pdm/summary", A.userId);
      expect(p.body.data.openPredictiveWos).toBe(1);
    });
    it("★★★ oee/summary — phạm vi người xem được TRUYỀN xuống bộ tính OEE (người dùng ⇒ userId/userRole; master ⇒ không)", async () => {
      oeeGoi.args.length = 0;
      const a = await goi("/api/external/oee/summary", A.userId);
      expect(a.status).toBe(200);
      expect(a.body.scopeApplied).toBe(true);
      await goi("/api/external/oee/summary", "master");
      const [choNguoiDung, choMaster] = oeeGoi.args as Array<{ userId?: number; userRole?: string } | null>;
      expect(choNguoiDung?.userId).toBe(A.userId);
      expect(choNguoiDung?.userRole).toBe("engineer");
      expect(choMaster?.userId).toBeUndefined();
    });
    it("★★★ dashboard/summary — chỉ cảnh báo/bản tin của A (alertHistory 1, kết nối 1, bản tin 1; MQTT hệ thống 0)", async () => {
      const r = await goi("/api/external/dashboard/summary", A.userId);
      expect(r.status).toBe(200);
      expect(r.body.data.alerts.breakdown.alertHistory.total).toBe(1);
      expect(r.body.data.alerts.breakdown.alertHistory.pending).toBe(1);
      expect(r.body.data.alerts.breakdown.connectionAlerts.pending).toBe(1);
      expect(r.body.data.alerts.breakdown.mqttAlerts.pending).toBe(0);
      expect(r.body.data.alerts.breakdown.connectionAlerts.total).toBe(1);
      expect(r.body.data.alerts.breakdown.mqttAlerts.total).toBe(0);
      expect(r.body.data.bulletins.total).toBe(1);
      expect(r.body.scopeApplied).toBe(true);
    });
    it("★★★ statistics/measurement-points — số đếm điểm đo chỉ của A (1 kết quả của A; không cộng B); sản phẩm B ⇒ 403", async () => {
      const r = await goi(`/api/external/statistics/measurement-points?productModelId=${A.pmId}&${KHOANG}`, A.userId);
      expect(r.status).toBe(200);
      const diem = (r.body.data.points as Array<{ pointDefId: number; totalCount: number }>).find((p) => p.pointDefId === pdId);
      expect(diem?.totalCount).toBe(2); // 2 điểm đo (1 NG + 1 OK) của A; B cũng có 2 ghi vào cùng pointDef nhưng KHÔNG được cộng
      expect((await goi(`/api/external/statistics/measurement-points?productModelId=${B.pmId}&${KHOANG}`, A.userId)).status).toBe(403);
    });
    it("người dùng không gán nhà máy ⇒ tổng 0", async () => {
      expect((await goi("/api/external/safety/summary", userRong.id)).body.data.openEvents).toBe(0);
      expect((await goi("/api/external/fleet/summary", userRong.id)).body.data.tasksPending).toBe(0);
      expect((await goi("/api/external/dashboard/summary", userRong.id)).body.data.bulletins.total).toBe(0);
    });
    it("đối chứng DƯƠNG: master key và admin thấy cả A lẫn B", async () => {
      for (const who of ["master", admin.id] as const) {
        expect((await goi("/api/external/safety/summary", who)).body.data.openEvents, String(who)).toBeGreaterThanOrEqual(2);
        expect((await goi("/api/external/fleet/summary", who)).body.data.tasksPending, String(who)).toBeGreaterThanOrEqual(2);
        expect((await goi(`/api/external/inspections/histogram?${Q(B)}`, who)).status, String(who)).not.toBe(403);
        expect((await goi(`/api/external/statistics/measurement-points?productModelId=${B.pmId}&${KHOANG}`, who)).status, String(who)).toBe(200);
      }
      expect((await goi("/api/external/safety/summary", "master")).body.scopeApplied).toBe(false);
    });
  });
});
