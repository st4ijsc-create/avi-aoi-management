/**
 * ★★★ Lô W14 — phạm vi nhà máy của GHI còn lại (nhóm không chạm OT): bom (định nghĩa + dòng) · energy · msd · stencil · productOnboarding · qualityGateTemplate.applyToLine · dataRouters
 * (import* + exportMeasurementPoints) · stationTriangulation · mpVariantSubform · twinGov.runFidelityCheck, kèm hai sửa quyền: webhook.test/toggle chỉ admin; reportBuilder.duplicate
 * không sao chép báo cáo riêng của người khác. Giám sát viên CHỈ gán nhà máy A: B ⇒ NOT_FOUND + dữ liệu B không đổi; đối chứng A→A thành công. Đột biến: gỡ cổng từng tệp ⇒ đỏ.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

// xuất tệp cần kho lưu trữ ngoài — thay bằng bản giả (đo đếm dòng, không đo việc lưu)
vi.mock("../storage", async (orig) => ({ ...(await orig<typeof import("../storage")>()), storagePut: async (key: string) => ({ key, url: "http://localhost/" + key }) }));

const RUN = `pw16${process.pid}${Date.now().toString(36)}`;
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
  product: number;
  bom: number;
  bomLine: number;
  point: number;
  msd: number;
  layout: number;
}
let A!: NhaMay;
let B!: NhaMay;
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
  const [pr] = await dung(sql`INSERT INTO product_models (code, name) VALUES (${code + "-pm"}, ${code}) RETURNING id`);
  await dung(sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", priority, "isActive") VALUES (${pr.id}, ${m.id}, 1, true)`);
  const [bo] = await dung(sql`INSERT INTO bom_definitions ("productModelId", code) VALUES (${pr.id}, ${code + "-bom"}) RETURNING id`);
  const [bl] = await dung(sql`INSERT INTO bom_line_items ("bomId", "componentCode", "qtyPer") VALUES (${bo.id}, ${code + "-c"}, 1) RETURNING id`);
  const [pt] = await dung(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY") VALUES (${pr.id}, ${code + "-pt"}, ${code}, 'DIMENSION', 1, 1) RETURNING id`);
  const [ms] = await dung(sql`INSERT INTO msd_exposure_logs ("componentCode", "mslLevel", "removedFromDryAt", "machineId") VALUES (${code + "-c"}, '3', now(), ${m.id}) RETURNING id`);
  const [ly] = await dung(sql`INSERT INTO factory_layouts ("workshopId", "factoryId", name) VALUES (${w.id}, ${f.id}, ${code + "-ly"}) RETURNING id`);
  await dung(sql`INSERT INTO measurement_samples ("pointDefId", value, "sampledAt", "serialNumber", "stationCode") VALUES (${pt.id}, 1, now(), ${code + "-sn"}, 'SPI')`);
  factories.push(code);
  return { fid: Number(f.id), wid: Number(w.id), lid: Number(l.id), sid: Number(s.id), mid: Number(m.id), code, product: Number(pr.id), bom: Number(bo.id), bomLine: Number(bl.id), point: Number(pt.id), msd: Number(ms.id), layout: Number(ly.id) };
}

let c!: {
  bom: ReturnType<typeof import("./bomRouter").bomRouter.createCaller>;
  energy: ReturnType<typeof import("./energyRouter").energyRouter.createCaller>;
  msd: ReturnType<typeof import("./msdRouter").msdRouter.createCaller>;
  stencil: ReturnType<typeof import("./stencilRouter").stencilRouter.createCaller>;
  onb: ReturnType<typeof import("./productOnboardingRouter").productOnboardingRouter.createCaller>;
  qgt: ReturnType<typeof import("./qualityGateTemplateRouter").qualityGateTemplateRouter.createCaller>;
  imp: ReturnType<typeof import("./dataRouters").importRouter.createCaller>;
  exp: ReturnType<typeof import("./dataRouters").exportRouter.createCaller>;
  tri: ReturnType<typeof import("./stationTriangulationRouter").stationTriangulationRouter.createCaller>;
  mpv: ReturnType<typeof import("./mpVariantSubformRouter").mpVariantSubformRouter.createCaller>;
  gov: ReturnType<typeof import("./twinGovRouter").twinGovRouter.createCaller>;
  hook: ReturnType<typeof import("./webhookRouter").webhookRouter.createCaller>;
  rb: ReturnType<typeof import("./reportBuilderRouter").reportBuilderRouter.createCaller>;
};
let tplRieng = 0;
let hookId = 0;

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const u = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw16", ts: RUN, ten: "PW16 ua" });
  const khac = await taoNguoiDungTest("ukhac", "supervisor", { tienTo: "pw16", ts: RUN, ten: "PW16 khac" });
  uid = u.id;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [
    ["settings", "settings_factory"],
    ["settings", "settings_products"],
    ["settings", "settings_measurement_points"],
    ["analytics", "analytics_oee"],
    ["analytics", "analytics_energy"],
    ["machine_monitoring", "machine_monitoring"],
    ["machine_monitoring", "machine_status"],
    ["machine_monitoring", "machine_control"],
    ["settings", "masterdata"],
    ["machine_monitoring", "mes_bom"],
    ["analytics", "energy"],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true, true)`);
  }
  tplRieng = Number((await one(sql`INSERT INTO report_templates (name, code, "templateType", sections, "createdBy") VALUES (${RUN + "-tpl"}, ${RUN + "-tpl"}, 'CUSTOM', '{}'::json, ${khac.id}) RETURNING id`)).id);
  hookId = Number((await one(sql`INSERT INTO webhook_configs (name, url, events, "createdBy") VALUES (${RUN + "-hook"}, 'http://127.0.0.1:9/x', '["a"]'::json, ${khac.id}) RETURNING id`)).id);
  const ctx = { user: { id: u.id, role: "supervisor", name: u.name, twoFactorEnabled: true } } as never;
  c = {
    bom: (await import("./bomRouter")).bomRouter.createCaller(ctx),
    energy: (await import("./energyRouter")).energyRouter.createCaller(ctx),
    msd: (await import("./msdRouter")).msdRouter.createCaller(ctx),
    stencil: (await import("./stencilRouter")).stencilRouter.createCaller(ctx),
    onb: (await import("./productOnboardingRouter")).productOnboardingRouter.createCaller(ctx),
    qgt: (await import("./qualityGateTemplateRouter")).qualityGateTemplateRouter.createCaller(ctx),
    imp: (await import("./dataRouters")).importRouter.createCaller(ctx),
    exp: (await import("./dataRouters")).exportRouter.createCaller(ctx),
    tri: (await import("./stationTriangulationRouter")).stationTriangulationRouter.createCaller(ctx),
    mpv: (await import("./mpVariantSubformRouter")).mpVariantSubformRouter.createCaller(ctx),
    gov: (await import("./twinGovRouter")).twinGovRouter.createCaller(ctx),
    hook: (await import("./webhookRouter")).webhookRouter.createCaller(ctx),
    rb: (await import("./reportBuilderRouter")).reportBuilderRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM quality_gates WHERE "lineId" IN (${A?.lid ?? 0}, ${B?.lid ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM webhook_delivery_logs WHERE "webhookId" = ${hookId}`).catch(() => undefined);
  await dung(sql`DELETE FROM webhook_configs WHERE id = ${hookId}`).catch(() => undefined);
  await dung(sql`DELETE FROM report_templates WHERE code LIKE ${like} OR name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM station_traces WHERE "serialNumber" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM measurement_samples WHERE "serialNumber" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM energy_readings WHERE "machineId" IN (${A?.mid ?? 0}, ${B?.mid ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM msd_exposure_logs WHERE "componentCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_onboarding_drafts WHERE "productModelId" IN (${A?.product ?? 0}, ${B?.product ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM bom_line_items WHERE "componentCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM bom_definitions WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM measurement_point_defs WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_machine_mappings WHERE "productModelId" IN (${A?.product ?? 0}, ${B?.product ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM product_models WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factory_layouts WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM workstations WHERE code LIKE ${like}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("bom — định nghĩa + dòng", () => {
  it("BOM / dòng BOM của sản phẩm B ⇒ NOT_FOUND, không đổi; tạo BOM cho sản phẩm B ⇒ NOT_FOUND; A→A được", async () => {
    const l = [
      await maLoi(() => c.bom.createDefinition({ productModelId: B.product, code: `${RUN}-bom-x` })),
      await maLoi(() => c.bom.updateDefinition({ id: B.bom, name: "hack" })),
      await maLoi(() => c.bom.archiveDefinition({ id: B.bom })),
      await maLoi(() => c.bom.addLineItem({ bomId: B.bom, componentCode: `${RUN}-cx`, qtyPer: 1 })),
      await maLoi(() => c.bom.bulkAddLineItems({ bomId: B.bom, items: [{ componentCode: `${RUN}-cy`, qtyPer: 1 }] })),
      await maLoi(() => c.bom.updateLineItem({ id: B.bomLine, notes: "hack" })),
      await maLoi(() => c.bom.deleteLineItem({ id: B.bomLine })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM bom_definitions WHERE code = ${RUN + "-bom-x"}`)).toBe(0);
    expect(await so(sql`SELECT count(*)::int AS n FROM bom_line_items WHERE id = ${B.bomLine}`)).toBe(1);
    expect(await maLoi(() => c.bom.updateLineItem({ id: A.bomLine, notes: "ok" }))).toBeNull();
    expect(await maLoi(() => c.bom.updateDefinition({ id: A.bom, name: "ok" }))).toBeNull();
  });
});

describe("energy · msd · stencil", () => {
  it("số đo năng lượng: máy B / không nêu máy ⇒ NOT_FOUND; máy A được; ảnh chụp EnPI máy B ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => c.energy.recordReading({ machineId: B.mid, value: 1 })),
      await maLoi(() => c.energy.recordReading({ value: 1 })),
      await maLoi(() => c.energy.snapshotEnpi({ machineId: B.mid, from: new Date(0), to: new Date() })),
      await maLoi(() => c.energy.snapshotEnpi({ from: new Date(0), to: new Date() })),
    ];
    expect(l).toEqual([NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM energy_readings WHERE "machineId" = ${B.mid}`)).toBe(0);
    expect(await maLoi(() => c.energy.recordReading({ machineId: A.mid, value: 1 }))).toBeNull();
  });
  it("MSD: mở phơi nhiễm trên máy B / đóng-nướng nhật ký máy B ⇒ NOT_FOUND; máy A được", async () => {
    const l = [
      await maLoi(() => c.msd.openExposure({ componentCode: `${RUN}-mx`, mslLevel: "3", machineId: B.mid })),
      await maLoi(() => c.msd.startBake({ id: B.msd })),
      await maLoi(() => c.msd.closeExposure({ id: B.msd })),
    ];
    expect(l).toEqual([NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM msd_exposure_logs WHERE id = ${B.msd} AND "closedAt" IS NULL`)).toBe(1);
    expect(await maLoi(() => c.msd.closeExposure({ id: A.msd }))).toBeNull();
  });
  it("stencil: ghi số lần in lên máy B ⇒ NOT_FOUND", async () => {
    expect(await maLoi(() => c.stencil.recordPrints({ stencilToolId: 1, printCount: 1, machineId: B.mid }))).toBe(NF);
  });
});

describe("productOnboarding · qualityGateTemplate.applyToLine · twinGov · mpVariantSubform", () => {
  it("bản nháp onboarding của sản phẩm B ⇒ NOT_FOUND; sản phẩm A được", async () => {
    const l = [
      await maLoi(() => c.onb.saveDraft({ productModelId: B.product, currentStep: 1 })),
      await maLoi(() => c.onb.deleteDraft({ productModelId: B.product })),
      await maLoi(() => c.onb.complete({ productModelId: B.product })),
    ];
    expect(l).toEqual([NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM product_onboarding_drafts WHERE "productModelId" = ${B.product}`)).toBe(0);
    expect(await maLoi(() => c.onb.saveDraft({ productModelId: A.product, currentStep: 1 }))).toBeNull();
  });
  it("áp mẫu cổng chất lượng lên chuyền / máy B ⇒ NOT_FOUND; chạy kiểm tra độ trung thực twin cho chuyền B ⇒ NOT_FOUND; extraFields điểm đo B ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => c.qgt.applyToLine({ templateId: "ipc-a-610", lineId: B.lid })),
      await maLoi(() => c.qgt.applyToLine({ templateId: "ipc-a-610", lineId: A.lid, machineId: B.mid })),
      await maLoi(() => c.gov.runFidelityCheck({ lineId: B.lid })),
      await maLoi(() => c.mpv.setExtra({ pointDefId: B.point, payload: {} })),
    ];
    expect(l).toEqual([NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM quality_gates WHERE "lineId" IN (${A.lid}, ${B.lid})`)).toBe(0);
    expect(await maLoi(() => c.qgt.applyToLine({ templateId: "ipc-a-610", lineId: A.lid }))).toBeNull(); // đối chứng: mẫu dựng sẵn hợp lệ ⇒ tạo cổng cho chuyền A
    expect(await so(sql`SELECT count(*)::int AS n FROM quality_gates WHERE "lineId" = ${A.lid}`)).toBeGreaterThan(0);
    await dung(sql`DELETE FROM quality_gates WHERE "lineId" = ${A.lid}`);
  });
});

describe("dataRouters — import theo mã + export điểm đo", () => {
  it("import xưởng vào nhà máy B / chiếm xưởng mã của B bằng replaceIfExists ⇒ thất bại từng dòng, B không đổi; vào nhà máy A được", async () => {
    const wsB = await so(sql`SELECT count(*)::int AS n FROM workshops WHERE id = ${B.wid} AND "factoryId" = ${B.fid}`);
    expect(wsB).toBe(1);
    const r1 = await c.imp.importWorkshops({ data: [{ factoryCode: B.code, code: `${RUN}-ws-x`, name: "x" }], replaceIfExists: false });
    const r2 = await c.imp.importWorkshops({ data: [{ factoryCode: A.code, code: B.code, name: "chiem" }], replaceIfExists: true });
    expect([r1.success, r1.failed, r2.success, r2.failed]).toEqual([0, 1, 0, 1]);
    expect(await so(sql`SELECT count(*)::int AS n FROM workshops WHERE id = ${B.wid} AND "factoryId" = ${B.fid} AND name = ${B.code + " w"}`)).toBe(1);
    expect(await so(sql`SELECT count(*)::int AS n FROM workshops WHERE code = ${RUN + "-ws-x"}`)).toBe(0);
    const ok = await c.imp.importWorkshops({ data: [{ factoryCode: A.code, code: `${RUN}-ws-ok`, name: "ok" }], replaceIfExists: false });
    expect(ok.success).toBe(1);
    await dung(sql`DELETE FROM workshops WHERE code = ${RUN + "-ws-ok"}`);
  });
  it("import máy / chuyền / trạm / công trạm lên cấp của B ⇒ thất bại từng dòng; công trạm không nêu vị trí ⇒ thất bại", async () => {
    const m = await c.imp.importMachines({ data: [{ stationCode: B.code, code: `${RUN}-m-x`, name: "x", machineType: "AOI" }], replaceIfExists: false });
    const l = await c.imp.importLines({ data: [{ workshopCode: B.code, code: `${RUN}-l-x`, name: "x" }], replaceIfExists: false });
    const s = await c.imp.importStations({ data: [{ lineCode: B.code, code: `${RUN}-s-x`, name: "x" }], replaceIfExists: false });
    const w1 = await c.imp.importWorkstations({ data: [{ code: `${RUN}-w-x`, name: "x", factoryCode: B.code }], replaceIfExists: false });
    const w2 = await c.imp.importWorkstations({ data: [{ code: `${RUN}-w-y`, name: "y" }], replaceIfExists: false });
    expect([m.failed, l.failed, s.failed, w1.failed, w2.failed]).toEqual([1, 1, 1, 1, 1]);
    expect(await so(sql`SELECT count(*)::int AS n FROM machines WHERE code LIKE ${RUN + "-m-x"}`)).toBe(0);
    const ok = await c.imp.importMachines({ data: [{ stationCode: A.code, code: `${RUN}-m-ok`, name: "ok", machineType: "AOI" }], replaceIfExists: false });
    expect(ok.success).toBe(1);
    await dung(sql`DELETE FROM machines WHERE code = ${RUN + "-m-ok"}`);
  });
  it("xuất điểm đo: sản phẩm B ⇒ 0 dòng; sản phẩm A ⇒ 1 dòng", async () => {
    const b = await c.exp.exportMeasurementPoints({ productModelId: B.product });
    const a = await c.exp.exportMeasurementPoints({ productModelId: A.product });
    expect([b.count, a.count]).toEqual([0, 1]);
  });
});

describe("stationTriangulation", () => {
  it("tính lại vết trạm cho serial có mẫu chỉ ở điểm đo của sản phẩm B ⇒ NOT_FOUND (không có mẫu thấy được); serial A được; productModelId B ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => c.tri.recomputeForSerial({ serialNumber: `${B.code}-sn` })),
      await maLoi(() => c.tri.recomputeForSerial({ serialNumber: `${A.code}-sn`, productModelId: B.product })),
    ];
    expect(l).toEqual([NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM station_traces WHERE "serialNumber" = ${B.code + "-sn"}`)).toBe(0);
    expect(await maLoi(() => c.tri.recomputeForSerial({ serialNumber: `${A.code}-sn`, productModelId: A.product }))).toBeNull();
  });
});

describe("hai sửa quyền", () => {
  it("webhook.test / toggle bởi người KHÔNG phải admin ⇒ FORBIDDEN, cấu hình không đổi", async () => {
    const l = [await maLoi(() => c.hook.toggle({ id: hookId, isEnabled: false })), await maLoi(() => c.hook.test({ id: hookId }))];
    expect(l.map((x) => (x ?? "").split(":")[0])).toEqual(["FORBIDDEN", "FORBIDDEN"]);
    expect(await so(sql`SELECT count(*)::int AS n FROM webhook_configs WHERE id = ${hookId} AND "isEnabled" = true`)).toBe(1);
  });
  it("reportBuilder.duplicate báo cáo RIÊNG của người khác ⇒ NOT_FOUND, không tạo bản sao", async () => {
    const truoc = await so(sql`SELECT count(*)::int AS n FROM report_templates WHERE name LIKE ${RUN + "%"}`);
    expect(await maLoi(() => c.rb.duplicate({ id: tplRieng, newName: `${RUN}-copy` }))).toBe(NF);
    expect(await so(sql`SELECT count(*)::int AS n FROM report_templates WHERE name LIKE ${RUN + "%"}`)).toBe(truoc);
  });
});
