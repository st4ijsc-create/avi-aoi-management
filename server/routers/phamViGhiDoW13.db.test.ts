/**
 * ★★★ Lô W13 — phạm vi nhà máy của GHI cấu hình hạ tầng: shiftConfig · layout (+vị trí máy) · maintenanceSchedule · maintenance (phiếu) · ngRateThreshold · process (gán chuyền) ·
 * productPanel · productVariant · thresholdApproval · workstation (+gán máy) · alert (tạo cảnh báo), kiểm định phamViGhi 2026-10-25.
 * Giám sát viên CHỈ gán nhà máy A (đủ quyền module) gọi lên thực thể nhà máy B: ngoài phạm vi ≡ NOT_FOUND + dữ liệu B không đổi; đối chứng A→A thành công (không NOT_FOUND giả).
 * Đột biến: gỡ cổng ở từng tệp ⇒ ca B đỏ.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw15${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const so = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);
const NF = "NOT_FOUND";

interface NhaMay {
  fid: number;
  wid: number;
  lid: number;
  sid: number;
  mid: number;
  code: string;
  shift: number;
  layout: number;
  pos: number;
  sched: number;
  wo: number;
  thr: number;
  ngAlert: number;
  assign: number;
  ws: number;
  product: number;
  panel: number;
  variant: number;
  point: number;
  approval: number;
}
let A!: NhaMay;
let B!: NhaMay;
let procId = 0;
let uid = 0;
const factories: string[] = [];
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const ma = String((e as { code?: string }).code ?? "LOI_LA");
    return ma === NF ? ma : `${ma}:${(e as Error).message.slice(0, 120)}`;
  }
}

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  const [sh] = await dung(sql`INSERT INTO shift_configs ("factoryId", name, code, "startHour", "endHour") VALUES (${f.id}, ${code + "-ca"}, ${code}, 6, 14) RETURNING id`);
  const [ly] = await dung(sql`INSERT INTO factory_layouts ("workshopId", "factoryId", name) VALUES (${w.id}, ${f.id}, ${code + "-ly"}) RETURNING id`);
  const [po] = await dung(sql`INSERT INTO machine_positions ("layoutId", "machineId", "positionX", "positionY") VALUES (${ly.id}, ${m.id}, 1, 1) RETURNING id`);
  const [sc] = await dung(sql`INSERT INTO maintenance_schedules ("machineId", "taskName", "factoryId") VALUES (${m.id}, ${code + "-pm"}, ${f.id}) RETURNING id`);
  const [wo] = await dung(sql`INSERT INTO maintenance_work_orders ("workOrderNumber", "machineId", title) VALUES (${code + "-wo"}, ${m.id}, ${code + "-wo"}) RETURNING id`);
  const [th] = await dung(sql`INSERT INTO mqtt_ng_rate_thresholds ("stationId", "machineId", name, "warningThreshold", "criticalThreshold") VALUES (${s.id}, ${m.id}, ${code + "-thr"}, 5, 10) RETURNING id`);
  const [na] = await dung(sql`INSERT INTO mqtt_ng_rate_alert_history ("thresholdId", "stationId", "machineId", "currentNgRate", "thresholdValue", "totalInspections", "ngCount", severity, message)
    VALUES (${th.id}, ${s.id}, ${m.id}, 1, 1, 1, 1, 'warning', ${code + "-na"}) RETURNING id`);
  const [as] = await dung(sql`INSERT INTO line_process_assignments ("lineId", "processId") VALUES (${l.id}, ${procId}) RETURNING id`);
  const [ws] = await dung(sql`INSERT INTO workstations (code, name, "factoryId") VALUES (${code + "-ws"}, ${code + "-ws"}, ${f.id}) RETURNING id`);
  const [pr] = await dung(sql`INSERT INTO product_models (code, name) VALUES (${code + "-pm"}, ${code}) RETURNING id`);
  await dung(sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", priority, "isActive") VALUES (${pr.id}, ${m.id}, 1, true)`);
  const [pa] = await dung(sql`INSERT INTO product_panel_defs ("productModelId", code, "nUp") VALUES (${pr.id}, ${code + "-pnl"}, 1) RETURNING id`);
  const [va] = await dung(sql`INSERT INTO product_variants ("productModelId", code) VALUES (${pr.id}, ${code + "-v"}) RETURNING id`);
  const [pt] = await dung(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY") VALUES (${pr.id}, ${code + "-pt"}, ${code}, 'DIMENSION', 1, 1) RETURNING id`);
  const [ap] = await dung(sql`INSERT INTO threshold_approvals ("pointDefId", "requestedBy", suggestion) VALUES (${pt.id}, ${uid}, '{}'::jsonb) RETURNING id`);
  factories.push(code);
  return {
    fid: Number(f.id), wid: Number(w.id), lid: Number(l.id), sid: Number(s.id), mid: Number(m.id), code,
    shift: Number(sh.id), layout: Number(ly.id), pos: Number(po.id), sched: Number(sc.id), wo: Number(wo.id), thr: Number(th.id), ngAlert: Number(na.id),
    assign: Number(as.id), ws: Number(ws.id), product: Number(pr.id), panel: Number(pa.id), variant: Number(va.id), point: Number(pt.id), approval: Number(ap.id),
  };
}

let c!: {
  shift: ReturnType<typeof import("./shiftConfigRouter").shiftConfigRouter.createCaller>;
  layout: ReturnType<typeof import("./layoutRouters").layoutRouter.createCaller>;
  sched: ReturnType<typeof import("./maintenanceScheduleRouter").maintenanceScheduleRouter.createCaller>;
  mt: ReturnType<typeof import("./maintenanceRouter").maintenanceRouter.createCaller>;
  ng: ReturnType<typeof import("./ngRateThresholdRouter").ngRateThresholdRouter.createCaller>;
  proc: ReturnType<typeof import("./processRouter").processRouter.createCaller>;
  panel: ReturnType<typeof import("./productPanelRouter").productPanelRouter.createCaller>;
  variant: ReturnType<typeof import("./productVariantRouter").productVariantRouter.createCaller>;
  appr: ReturnType<typeof import("./thresholdApprovalRouter").thresholdApprovalRouter.createCaller>;
  ws: ReturnType<typeof import("./systemRouters").workstationRouter.createCaller>;
  alert: ReturnType<typeof import("./alertRouters").alertRouter.createCaller>;
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const u = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw15", ts: RUN, ten: "PW15 ua" });
  uid = u.id;
  procId = Number((await one(sql`INSERT INTO processes (code, name) VALUES (${RUN + "-proc"}, ${RUN}) RETURNING id`)).id);
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [
    ["settings", "settings_factory"],
    ["analytics", "analytics_oee"],
    ["machine_monitoring", "machine_downtime"],
    ["machine_monitoring", "machine_status"],
    ["machine_monitoring", "machine_monitoring"],
    ["settings", "settings_products"],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
  }
  const ctx = { user: { id: u.id, role: "supervisor", name: u.name, twoFactorEnabled: true } } as never;
  c = {
    shift: (await import("./shiftConfigRouter")).shiftConfigRouter.createCaller(ctx),
    layout: (await import("./layoutRouters")).layoutRouter.createCaller(ctx),
    sched: (await import("./maintenanceScheduleRouter")).maintenanceScheduleRouter.createCaller(ctx),
    mt: (await import("./maintenanceRouter")).maintenanceRouter.createCaller(ctx),
    ng: (await import("./ngRateThresholdRouter")).ngRateThresholdRouter.createCaller(ctx),
    proc: (await import("./processRouter")).processRouter.createCaller(ctx),
    panel: (await import("./productPanelRouter")).productPanelRouter.createCaller(ctx),
    variant: (await import("./productVariantRouter")).productVariantRouter.createCaller(ctx),
    appr: (await import("./thresholdApprovalRouter")).thresholdApprovalRouter.createCaller(ctx),
    ws: (await import("./systemRouters")).workstationRouter.createCaller(ctx),
    alert: (await import("./alertRouters")).alertRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  const ids = (k: keyof NhaMay) => [A?.[k] ?? 0, B?.[k] ?? 0];
  await dung(sql`DELETE FROM threshold_approvals WHERE "pointDefId" IN (${A?.point ?? 0}, ${B?.point ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM measurement_point_defs WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_panel_defs WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_variants WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_machine_mappings WHERE "productModelId" IN (${A?.product ?? 0}, ${B?.product ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM product_models WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM workstation_machines WHERE "workstationId" IN (${A?.ws ?? 0}, ${B?.ws ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM workstations WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM line_process_assignments WHERE "processId" = ${procId}`).catch(() => undefined);
  await dung(sql`DELETE FROM processes WHERE id = ${procId}`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_ng_rate_alert_history WHERE message LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_ng_rate_thresholds WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM work_order_parts WHERE "workOrderId" IN (${A?.wo ?? 0}, ${B?.wo ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM maintenance_work_orders WHERE title LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM maintenance_schedules WHERE "taskName" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM machine_positions WHERE "layoutId" IN (${ids("layout")[0]}, ${ids("layout")[1]})`).catch(() => undefined);
  await dung(sql`DELETE FROM factory_layouts WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM shift_configs WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM alert_history WHERE message LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM alert_settings WHERE name LIKE ${like}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("shiftConfig", () => {
  it("ca của nhà máy B ⇒ NOT_FOUND, không đổi; ca mặc định toàn cục (factoryId null) chỉ toàn quyền; A→A được", async () => {
    const [glob] = await dung(sql`INSERT INTO shift_configs (name, code, "startHour", "endHour") VALUES (${RUN + "-glob"}, ${RUN + "g"}, 1, 2) RETURNING id`);
    const l = [
      await maLoi(() => c.shift.update({ id: B.shift, name: `${RUN}-hack` })),
      await maLoi(() => c.shift.delete({ id: B.shift })),
      await maLoi(() => c.shift.create({ factoryId: B.fid, name: `${RUN}-x`, code: `${RUN}x`, startHour: 1, endHour: 2 })),
      await maLoi(() => c.shift.create({ name: `${RUN}-y`, code: `${RUN}y`, startHour: 1, endHour: 2 })),
      await maLoi(() => c.shift.update({ id: Number(glob.id), name: `${RUN}-hack2` })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM shift_configs WHERE name = ${RUN + "-hack"} OR name = ${RUN + "-hack2"} OR name = ${RUN + "-x"} OR name = ${RUN + "-y"}`)).toBe(0);
    expect(await maLoi(() => c.shift.update({ id: A.shift, name: `${RUN}-ok` }))).toBeNull();
    expect(await so(sql`SELECT count(*)::int AS n FROM shift_configs WHERE id = ${A.shift} AND name = ${RUN + "-ok"}`)).toBe(1);
  });
});

describe("layout + vị trí máy", () => {
  it("bố cục / vị trí máy của xưởng B ⇒ NOT_FOUND; tạo bố cục lên xưởng B ⇒ NOT_FOUND; đặt máy B lên bố cục A ⇒ NOT_FOUND; A→A được", async () => {
    const l = [
      await maLoi(() => c.layout.update({ id: B.layout, name: `${RUN}-ly-hack` })),
      await maLoi(() => c.layout.delete({ id: B.layout })),
      await maLoi(() => c.layout.create({ workshopId: B.wid, name: `${RUN}-ly-x` })),
      await maLoi(() => c.layout.addMachinePosition({ layoutId: A.layout, machineId: B.mid, positionX: 1, positionY: 1 })),
      await maLoi(() => c.layout.addMachinePosition({ layoutId: B.layout, machineId: A.mid, positionX: 1, positionY: 1 })),
      await maLoi(() => c.layout.updateMachinePosition({ id: B.pos, positionX: 99 })),
      await maLoi(() => c.layout.removeMachinePosition({ id: B.pos })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM factory_layouts WHERE name LIKE ${RUN + "-ly-%"}`)).toBe(0);
    expect(await so(sql`SELECT count(*)::int AS n FROM machine_positions WHERE id = ${B.pos} AND "positionX" = 1`)).toBe(1);
    expect(await maLoi(() => c.layout.updateMachinePosition({ id: A.pos, positionX: 5 }))).toBeNull();
    expect(await maLoi(() => c.layout.update({ id: A.layout, name: `${RUN}-ly-ok` }))).toBeNull();
  });
});

describe("maintenanceSchedule + maintenance (phiếu)", () => {
  it("lịch bảo trì của máy B ⇒ NOT_FOUND; tạo lịch lên máy B ⇒ NOT_FOUND; A→A được", async () => {
    const l = [
      await maLoi(() => c.sched.create({ machineId: B.mid, name: `${RUN}-pm-x`, taskType: "TIME_BASED", isActive: true })),
      await maLoi(() => c.sched.update({ id: B.sched, name: `${RUN}-pm-hack` })),
      await maLoi(() => c.sched.setEnabled({ id: B.sched, isActive: false })),
      await maLoi(() => c.sched.remove({ id: B.sched })),
    ];
    expect(l).toEqual([NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM maintenance_schedules WHERE id = ${B.sched} AND "isActive" = true`)).toBe(1);
    expect(await maLoi(() => c.sched.update({ id: A.sched, name: `${RUN}-pm-ok` }))).toBeNull();
  });
  it("phiếu bảo trì của máy B (đóng · xoá · sửa · ghi vật tư) ⇒ NOT_FOUND; A→A sửa được", async () => {
    const l = [
      await maLoi(() => c.mt.updateWorkOrder({ id: B.wo, title: `${RUN}-wo-hack` })),
      await maLoi(() => c.mt.closeWorkOrder({ id: B.wo } as never)),
      await maLoi(() => c.mt.deleteWorkOrder({ id: B.wo })),
      await maLoi(() => c.mt.recordPartsUsed({ workOrderId: B.wo, partCode: "X", quantityUsed: 1 })),
    ];
    expect(l).toEqual([NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM maintenance_work_orders WHERE id = ${B.wo}`)).toBe(1);
    expect(await maLoi(() => c.mt.updateWorkOrder({ id: A.wo, title: `${RUN}-wo-ok` }))).toBeNull();
  });
});

describe("ngRateThreshold", () => {
  it("ngưỡng / cảnh báo NG của trạm B ⇒ NOT_FOUND; tạo ngưỡng lên trạm B ⇒ NOT_FOUND; A→A được", async () => {
    const l = [
      await maLoi(() => c.ng.create({ stationId: B.sid, name: `${RUN}-thr-x`, warningThreshold: 1, criticalThreshold: 2 } as never)),
      await maLoi(() => c.ng.update({ id: B.thr, name: `${RUN}-thr-hack` })),
      await maLoi(() => c.ng.update({ id: A.thr, machineId: B.mid })),
      await maLoi(() => c.ng.toggle({ id: B.thr, isEnabled: false })),
      await maLoi(() => c.ng.delete({ id: B.thr })),
      await maLoi(() => c.ng.resolveAlert({ id: B.ngAlert })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_ng_rate_thresholds WHERE id = ${B.thr} AND "isEnabled" = true`)).toBe(1);
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_ng_rate_alert_history WHERE id = ${B.ngAlert} AND "isResolved" = false`)).toBe(1);
    expect(await maLoi(() => c.ng.toggle({ id: A.thr, isEnabled: false }))).toBeNull();
    expect(await maLoi(() => c.ng.resolveAlert({ id: A.ngAlert }))).toBeNull();
  });
});

describe("process — gán quy trình vào chuyền", () => {
  it("gán / sửa / xoá / sắp xếp trên chuyền B ⇒ NOT_FOUND; A→A được", async () => {
    const l = [
      await maLoi(() => c.proc.createLineAssignment({ lineId: B.lid, processId: procId })),
      await maLoi(() => c.proc.updateLineAssignment({ id: B.assign, orderIndex: 9 })),
      await maLoi(() => c.proc.deleteLineAssignment({ id: B.assign })),
      await maLoi(() => c.proc.reorderLineAssignments({ lineId: B.lid, orderedIds: [B.assign] })),
    ];
    expect(l).toEqual([NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM line_process_assignments WHERE id = ${B.assign} AND "orderIndex" = 0`)).toBe(1);
    expect(await maLoi(() => c.proc.updateLineAssignment({ id: A.assign, orderIndex: 3 }))).toBeNull();
  });
});

describe("productPanel + productVariant", () => {
  it("panel của sản phẩm B ⇒ NOT_FOUND; tạo panel lên sản phẩm B ⇒ NOT_FOUND; A→A được", async () => {
    const l = [
      await maLoi(() => c.panel.create({ productModelId: B.product, code: `${RUN}-p-x` } as never)),
      await maLoi(() => c.panel.update({ id: B.panel, name: "hack" })),
      await maLoi(() => c.panel.remove({ id: B.panel })),
      await maLoi(() => c.panel.saveBoards({ panelDefId: B.panel, boards: [{ boardIndex: 1, offsetXMm: 0, offsetYMm: 0 }] })),
    ];
    expect(l).toEqual([NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM product_panel_defs WHERE id = ${B.panel} AND name IS NULL`)).toBe(1);
    expect(await maLoi(() => c.panel.update({ id: A.panel, name: "ok" }))).toBeNull();
  });
  it("biến thể của sản phẩm B ⇒ NOT_FOUND; A→A được", async () => {
    const l = [
      await maLoi(() => c.variant.createVariant({ productModelId: B.product, code: `${RUN}-v-x` } as never)),
      await maLoi(() => c.variant.updateVariant({ variantId: B.variant, name: "hack" })),
      await maLoi(() => c.variant.deleteVariant({ variantId: B.variant })),
    ];
    expect(l).toEqual([NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM product_variants WHERE id = ${B.variant} AND name IS NULL`)).toBe(1);
    expect(await maLoi(() => c.variant.updateVariant({ variantId: A.variant, name: "ok" }))).toBeNull();
  });
});

describe("thresholdApproval", () => {
  it("yêu cầu / duyệt / từ chối / rút / hoàn tác trên điểm đo của sản phẩm B ⇒ NOT_FOUND; đề xuất cho điểm đo A được", async () => {
    const l = [
      await maLoi(() => c.appr.request({ pointDefId: B.point, proposedLsl: 1, proposedUsl: 2 })),
      await maLoi(() => c.appr.approve({ id: B.approval, apply: false })),
      await maLoi(() => c.appr.reject({ id: B.approval, comment: "no" })),
      await maLoi(() => c.appr.withdraw({ id: B.approval })),
      await maLoi(() => c.appr.revert({ approvalId: B.approval })),
      await maLoi(() => c.appr.revert({ pointDefId: B.point })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF, NF]);
    const b = await c.appr.batchApprove({ ids: [B.approval], apply: false });
    expect(b.summary).toEqual({ approved: 0, skipped: 0, failed: 1 });
    expect(await so(sql`SELECT count(*)::int AS n FROM threshold_approvals WHERE "pointDefId" = ${B.point} AND status = 'requested'`)).toBe(1);
    expect(await maLoi(() => c.appr.request({ pointDefId: A.point, proposedLsl: 1, proposedUsl: 2 }))).toBeNull();
  });
});

describe("workstation + gán máy", () => {
  it("công trạm của nhà máy B ⇒ NOT_FOUND; tạo công trạm lên nhà máy B / không vị trí ⇒ NOT_FOUND; gán máy B vào trạm A ⇒ NOT_FOUND; A→A được", async () => {
    const l = [
      await maLoi(() => c.ws.create({ code: `${RUN}-w1`, name: "x", factoryId: B.fid })),
      await maLoi(() => c.ws.create({ code: `${RUN}-w2`, name: "x" })),
      await maLoi(() => c.ws.update({ id: B.ws, name: `${RUN}-hack` })),
      await maLoi(() => c.ws.update({ id: A.ws, factoryId: B.fid })),
      await maLoi(() => c.ws.delete(B.ws)),
      await maLoi(() => c.ws.restore({ id: B.ws })),
      await maLoi(() => c.ws.assignMachine({ workstationId: A.ws, machineId: B.mid })),
      await maLoi(() => c.ws.assignMachine({ workstationId: B.ws, machineId: A.mid })),
      await maLoi(() => c.ws.unassignMachine({ workstationId: B.ws, machineId: B.mid })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM workstations WHERE code LIKE ${RUN + "-w%"} AND code NOT LIKE ${"%-ws"}`)).toBe(0);
    expect(await so(sql`SELECT count(*)::int AS n FROM workstations WHERE id = ${B.ws} AND name = ${B.code + "-ws"}`)).toBe(1);
    expect(await so(sql`SELECT count(*)::int AS n FROM workstations WHERE id = ${A.ws} AND "factoryId" = ${A.fid}`)).toBe(1);
    expect(await maLoi(() => c.ws.assignMachine({ workstationId: A.ws, machineId: A.mid }))).toBeNull();
    expect(await maLoi(() => c.ws.create({ code: `${RUN}-w3`, name: "ok", factoryId: A.fid }))).toBeNull();
  });
});

describe("alert — tạo cảnh báo", () => {
  it("cảnh báo trỏ máy / nhà máy B ⇒ NOT_FOUND; trỏ máy A ⇒ được", async () => {
    const l = [
      await maLoi(() => c.alert.create({ name: `${RUN}-al-x`, alertType: "ng_count", threshold: 1, machineId: B.mid })),
      await maLoi(() => c.alert.create({ name: `${RUN}-al-y`, alertType: "ng_count", threshold: 1, factoryId: B.fid })),
    ];
    expect(l).toEqual([NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM alert_settings WHERE name LIKE ${RUN + "-al-%"}`)).toBe(0);
    expect(await maLoi(() => c.alert.create({ name: `${RUN}-al-ok`, alertType: "ng_count", threshold: 1, machineId: A.mid }))).toBeNull();
  });
});
