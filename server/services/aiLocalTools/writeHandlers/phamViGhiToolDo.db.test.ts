/**
 * ★★★ Lô W11c — phạm vi nhà máy của TOOL GHI do AI đề xuất (`aiLocalTools/writeHandlers`), kiểm định phamViGhi 2026-10-25.
 * Đường THẬT: `proposeAction(tool, args, ctx)` → hàng `ai_pending_actions` → `confirmAction(actionId, token, user, lang)` → `tool.execute`.
 * Người dùng nhà máy B (đủ quyền module, gán CHỈ nhà máy B) nhờ AI ghi lên MÁY / điểm đo / cảnh báo của nhà máy A:
 *   • đối chứng: người dùng A ghi lên thực thể A ⇒ được (chứng minh quyền module + cầu nối đúng — không đỏ vì quyền / đầu vào);
 *   • xuyên nhà máy: B ghi lên A ⇒ bị từ chối `OUT_OF_SCOPE` TRƯỚC khi lưu đề xuất, hàng A không đổi.
 * Cổng chung `kiemPhamViGhiTool` (`../phamViGhi.ts`) gọi ở proposeAction + confirmAction. Tool OT vẫn đi qua aiControlGate (L-7) / AI_OT_CONTROL_ENABLED (tắt) — ở đây chỉ kiểm
 * bước ĐỀ XUẤT của chúng (không xác nhận ⇒ không đụng thiết bị). Gỡ cổng ⇒ các ca "B → A" đỏ (đột biến).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { getTool } from "../toolRegistry";
import { invalidateAssignmentCache } from "../../../_core/accessControl";
import { proposeAction, confirmAction } from "../../aiCopilotActions";

const RUN = `pw12${process.pid}${Date.now().toString(36)}`;
const cross = it;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
interface NhaMay {
  fid: number;
  mid: number;
  lid: number;
  sid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
let pmA = 0;
let alertA = 0;
let mpA = 0;
let thrA = 0;
let histA = 0;
let uadmin!: { id: number; role: string; name: string };
const factories: string[] = [];
let ua!: { id: number; role: string; name: string };
let ub!: { id: number; role: string; name: string };

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`,
  );
  factories.push(code);
  return { fid: Number(f.id), mid: Number(m.id), lid: Number(l.id), sid: Number(s.id), code };
}
async function nguoi(ten: string, nm: NhaMay) {
  const u = await taoNguoiDungTest(ten, "engineer", { tienTo: "pw12", ts: RUN, ten: `PW12 ${ten}` });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${nm.code})`);
  for (const [cat, mod] of [
    ["machine_monitoring", resolvePermissionModule("machine_monitoring")],
    ["settings", "settings_products"],
    ["analytics", "analytics_predictive_alerts"],
    ["settings", "settings_measurement_points"],
    ["settings", "settings_alerts"],
    ["settings", "mqtt_alerts"],
    ["settings", "interlock"],
    ["machine_monitoring", "machine_control"],
    ["analytics", "analytics_root_cause"],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, false)`);
  }
  return { id: u.id, role: "engineer", name: u.name };
}
/** Đề xuất rồi XÁC NHẬN một tool ghi dưới danh nghĩa `user` — đúng đường của trợ lý / agent. Trả trạng thái confirm. */
async function aiGhi(tool: string, args: Record<string, unknown>, user: { id: number; role: string; name: string }): Promise<{ propose: string; confirm: string | null }> {
  const t = getTool(tool);
  if (!t) throw new Error("không có tool " + tool);
  const p = await proposeAction(t, args, { user, lang: "vi" });
  if (!p.ok || !p.pendingAction) return { propose: p.denied ? `denied:${p.reason ?? "?"}` : `loi:${p.reason ?? "?"}`, confirm: null };
  const c = await confirmAction(p.pendingAction.actionId, p.pendingAction.token, user, "vi");
  return { propose: "ok", confirm: c.status };
}

beforeAll(async () => {
  await import("../index"); // đăng ký tool
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  pmA = Number((await dung(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-pm"}, ${RUN}) RETURNING id`))[0].id);
  await dung(sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", priority, "isActive") VALUES (${pmA}, ${A.mid}, 1, true)`);
  alertA = Number((await dung(sql`INSERT INTO predictive_alerts ("alertType", title, description, "machineId") VALUES ('DEFECT_SPIKE', ${RUN + "-al"}, 'd', ${A.mid}) RETURNING id`))[0].id);
  mpA = Number((await dung(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY") VALUES (${pmA}, ${RUN + "-mp"}, ${RUN}, 'DIMENSION', 1, 1) RETURNING id`))[0].id);
  thrA = Number((await dung(sql`INSERT INTO mqtt_ng_rate_thresholds ("stationId", "machineId", name, "warningThreshold", "criticalThreshold") VALUES (${A.sid}, ${A.mid}, ${RUN + "-thr"}, 5, 10) RETURNING id`))[0].id);
  const asid = Number((await dung(sql`INSERT INTO alert_settings ("userId", name, "alertType", threshold, "machineId") VALUES (1, ${RUN + "-as"}, 'ng_count', 1, ${A.mid}) RETURNING id`))[0].id);
  histA = Number((await dung(sql`INSERT INTO alert_history ("alertSettingId", "triggeredValue", message) VALUES (${asid}, 1, ${RUN + "-h"}) RETURNING id`))[0].id);
  ua = await nguoi("ua", A);
  const adm = await taoNguoiDungTest("uadm", "admin", { tienTo: "pw12", ts: RUN, ten: "PW12 uadm" });
  uadmin = { id: adm.id, role: "admin", name: adm.name };
  ub = await nguoi("ub", B);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" IN (${ua?.id ?? 0}, ${ub?.id ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM maintenance_work_orders WHERE title LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM predictive_alerts WHERE title LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM alert_history WHERE message LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM alert_settings WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_ng_rate_thresholds WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM interlock_rules WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM measurement_point_defs WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_machine_mappings WHERE "productModelId" = ${pmA}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_models WHERE id = ${pmA}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

const dem = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);

describe("create_maintenance_workorder — lệnh bảo trì lên MÁY (machineId)", () => {
  it("đối chứng: người dùng nhà máy A nhờ AI tạo lệnh bảo trì cho máy A ⇒ được", async () => {
    const r = await aiGhi("create_maintenance_workorder", { machineId: A.mid, title: `${RUN}-wo-a` }, ua);
    expect(r).toEqual({ propose: "ok", confirm: "executed" });
    expect(await dem(sql`SELECT count(*)::int AS n FROM maintenance_work_orders WHERE title = ${RUN + "-wo-a"}`)).toBe(1);
  });
  cross("xuyên nhà máy: người dùng B nhờ AI tạo lệnh bảo trì cho máy A ⇒ phải bị từ chối, không có hàng", async () => {
    await aiGhi("create_maintenance_workorder", { machineId: A.mid, title: `${RUN}-wo-x` }, ub);
    expect(await dem(sql`SELECT count(*)::int AS n FROM maintenance_work_orders WHERE title = ${RUN + "-wo-x"}`)).toBe(0);
  });
});

describe("update_product_quality_target — mục tiêu yield của SẢN PHẨM nhà máy A", () => {
  it("đối chứng: người dùng A (sản phẩm gắn máy A) đặt mục tiêu ⇒ được", async () => {
    const r = await aiGhi("update_product_quality_target", { productModelId: pmA, targetYieldRate: "97.5" }, ua);
    expect(r).toEqual({ propose: "ok", confirm: "executed" });
    expect(Number((await one(sql`SELECT "targetYieldRate" AS t FROM product_models WHERE id = ${pmA}`)).t)).toBe(97.5);
  });
  cross("xuyên nhà máy: người dùng B nhờ AI đổi mục tiêu yield sản phẩm chỉ gắn nhà máy A ⇒ phải bị từ chối, giá trị không đổi", async () => {
    await aiGhi("update_product_quality_target", { productModelId: pmA, targetYieldRate: "50" }, ub);
    expect(Number((await one(sql`SELECT "targetYieldRate" AS t FROM product_models WHERE id = ${pmA}`)).t)).toBe(97.5);
  });
});

describe("acknowledge_predictive_alert — xác nhận cảnh báo dự đoán của máy A", () => {
  cross("xuyên nhà máy: người dùng B nhờ AI xác nhận cảnh báo máy A ⇒ phải bị từ chối, vẫn ACTIVE", async () => {
    await aiGhi("acknowledge_predictive_alert", { predictiveAlertId: alertA }, ub);
    expect((await one(sql`SELECT status AS s FROM predictive_alerts WHERE id = ${alertA}`)).s).toBe("ACTIVE");
  });
  it("đối chứng: người dùng A xác nhận cảnh báo máy A ⇒ được", async () => {
    const r = await aiGhi("acknowledge_predictive_alert", { predictiveAlertId: alertA }, ua);
    expect(r).toEqual({ propose: "ok", confirm: "executed" });
    expect((await one(sql`SELECT status AS s FROM predictive_alerts WHERE id = ${alertA}`)).s).toBe("ACKNOWLEDGED");
  });
});

// ── Bảng mọi tool GHI có khoá nhà máy: A → A đề xuất được; B → A bị từ chối OUT_OF_SCOPE TRƯỚC khi lưu (không hàng ai_pending_actions). ──
const OUT = "denied:OUT_OF_SCOPE";
const dsTool: Array<[string, () => Record<string, unknown>]> = [
  ["machine_start", () => ({ machineId: A.mid })],
  ["machine_stop", () => ({ machineId: A.mid })],
  ["machine_pause", () => ({ machineId: A.mid })],
  ["machine_reset", () => ({ machineId: A.mid })],
  ["acknowledge_machine_alarm", () => ({ machineId: A.mid, tagKey: "alarm" })],
  ["create_maintenance_workorder", () => ({ machineId: A.mid, title: RUN + "-wo-t" })],
  ["run_rca_analysis", () => ({ machineId: A.mid })],
  ["acknowledge_alert", () => ({ id: histA })],
  ["acknowledge_predictive_alert", () => ({ predictiveAlertId: alertA })],
  ["resolve_predictive_alert", () => ({ predictiveAlertId: alertA })],
  ["adjust_ng_threshold", () => ({ thresholdId: thrA, warningThreshold: 6 })],
  ["configure_inspection_param", () => ({ thresholdId: thrA, minSampleSize: 20 })],
  ["create_ng_threshold", () => ({ stationId: A.sid, machineId: A.mid, name: RUN + "-n", warningThreshold: 1, criticalThreshold: 2 })],
  ["request_threshold_review", () => ({ machineId: A.mid, pointDefId: mpA })],
  ["update_product_quality_target", () => ({ productModelId: pmA, targetYieldRate: 90 })],
  ["create_measurement_point", () => ({ productModelId: pmA, code: RUN + "-n", name: RUN, measurementType: "DIMENSION" })],
  ["update_measurement_point", () => ({ id: mpA, upperLimit: 9 })],
  ["set_spec_limits", () => ({ measurementPointDefId: mpA, usl: 9, lsl: 1, target: 5 })],
  ["propose_interlock_rule", () => ({ name: RUN + "-il", scope: "machine", machineId: A.mid, sourceType: "ng_rate", comparisonOperator: "gt", threshold: 5, action: "alert" })],
];
describe("cổng chung — mọi tool GHI có khoá nhà máy (propose)", () => {
  for (const [tool, args] of dsTool) {
    it(`${tool}: A→A được đề xuất; B→A bị OUT_OF_SCOPE`, async () => {
      const a = await aiGhi(tool, args(), ua).catch((e) => ({ propose: "ngoai-le:" + (e as Error).message, confirm: null }));
      // đối chứng chỉ cần QUA cổng phạm vi + RBAC (xác nhận / OT chạy thật không phải điều kiểm ở đây)
      expect(a.propose, `đối chứng ${tool}`).not.toBe(OUT);
      expect(a.propose, `đối chứng ${tool} (quyền module)`).not.toMatch(/^denied:MISSING_PERMISSION/);
      const b = await aiGhi(tool, args(), ub);
      expect(b).toEqual({ propose: OUT, confirm: null });
    });
  }
  it("fail-closed: id không tồn tại cho CÙNG kết quả với id nhà máy khác (không lộ sự tồn tại)", async () => {
    const x = await aiGhi("adjust_ng_threshold", { thresholdId: 2_000_000_000, warningThreshold: 6 }, ub);
    const y = await aiGhi("adjust_ng_threshold", { thresholdId: thrA, warningThreshold: 6 }, ub);
    expect(x).toEqual({ propose: OUT, confirm: null });
    expect(y).toEqual(x);
  });
  it("toàn quyền (admin) bỏ qua cổng phạm vi — cùng sàn đã có", async () => {
    const r = await aiGhi("create_maintenance_workorder", { machineId: A.mid, title: `${RUN}-wo-adm` }, uadmin);
    expect(r).toEqual({ propose: "ok", confirm: "executed" });
  });
});

describe("cổng chung — kiểm LẠI lúc xác nhận (TOCTOU) bằng tham số đã lưu", () => {
  it("A đề xuất, rồi bị gỡ gán nhà máy A trước khi bấm duyệt ⇒ confirm bị từ chối, không có hàng", async () => {
    const u = await nguoi("utoc", A);
    const t = getTool("create_maintenance_workorder")!;
    const p = await proposeAction(t, { machineId: A.mid, title: `${RUN}-wo-toc` }, { user: u, lang: "vi" });
    expect(p.ok).toBe(true);
    await dung(sql`DELETE FROM user_factory_assignments WHERE "userId" = ${u.id}`);
    await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${B.code})`);
    invalidateAssignmentCache(u.id); // bộ nhớ đệm gán nhà máy sống 30 s; đường ứng dụng (createFactoryAssignment…) tự xoá
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, u, "vi");
    expect(c.status).toBe("denied");
    expect(await dem(sql`SELECT count(*)::int AS n FROM maintenance_work_orders WHERE title = ${RUN + "-wo-toc"}`)).toBe(0);
  });
});
