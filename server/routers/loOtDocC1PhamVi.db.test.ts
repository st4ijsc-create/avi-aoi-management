/**
 * CỔNG CSDL THẬT — lô L6c-C1 (rà bảo mật tRPC, 2026-10-25): đọc theo TRỤC MÁY / robot / adapter của vùng OT:
 * aoiOnboarding ×4 · feederVerify ×3 · machineApi.listKeys · hotFolder ×3 · parameterGuardrail ×4 · equipmentStandards.complianceMetrics ·
 * simulation.fromScene · field.health/healthSummary · systemHealth.connectionSupervisors.
 * Luật: ngoài phạm vi ≡ không tồn tại (NOT_FOUND máy / [] / null); hàng guardrail theo LOẠI máy (machine_type) vẫn thấy; admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";
import { readAppErrorMeta } from "../_core/appError";

const giaLap = vi.hoisted(() => ({ sup: [] as Array<{ adapterId: number }> }));
vi.mock("../services/ot/otManager", async (orig) => {
  const m = await orig<typeof import("../services/ot/otManager")>();
  return { ...m, listSupervisorStatuses: () => giaLap.sup };
});

const RUN = `l6c1${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
const Q: Array<[string, string]> = [["machine_monitoring", "machine_status"], ["machine_control", "machine_control"], ["admin", "admin_system"]];
type C = Record<string, any>;
let cA: C, cAdm: C, cRong: C;
const ad: Record<string, number> = {};
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const mk = async (p: string, k: string) => ((await import(p))[k] as any).createCaller(ctx);
  return {
    ob: await mk("./aoiOnboardingRouter", "aoiOnboardingRouter"),
    fv: await mk("./feederVerifyRouter", "feederVerifyRouter"),
    ma: await mk("./machineApiRouters", "machineApiRouter"),
    hf: await mk("./hotFolderRouter", "hotFolderRouter"),
    pg: await mk("./parameterGuardrailRouter", "parameterGuardrailRouter"),
    es: await mk("./equipmentStandardsRouter", "equipmentStandardsRouter"),
    sim: await mk("./simulationRouter", "simulationRouter"),
    fd: await mk("./fieldRouter", "fieldRouter"),
    sh: await mk("./systemHealthRouter", "systemHealthRouter"),
  };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}
const J = (x: unknown) => JSON.stringify(x);

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6c1", Q, dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PM", name: RUN } as never)), taoNguoiDungTest);
  const { A, B } = H;
  for (const [k, x] of [["A", A], ["B", B]] as const) {
    await H.dung(sql`INSERT INTO aoi_commissioning_records ("machineId", status) VALUES (${x.mid}, 'draft')`);
    await H.dung(sql`INSERT INTO api_keys (name, "keyHash", scopes, "machineId") VALUES (${RUN + "key" + k}, ${RUN + "h" + k}, '[]'::json, ${x.mid})`);
    const [hc] = await H.dung(sql`INSERT INTO hot_folder_configs ("machineId", "adapterKey", "watchPath") VALUES (${x.mid}, ${RUN + "ak" + k}, ${"/tmp/" + RUN + k}) RETURNING id`);
    ad["hc" + k] = hc.id;
    await H.dung(sql`INSERT INTO hot_folder_files ("configId", "machineId", "fileName", "contentHash", "idempotencyKey", status) VALUES (${hc.id}, ${x.mid}, ${RUN + "f" + k}, ${RUN + "c" + k}, ${RUN + "i" + k}, 'done')`);
    await H.dung(sql`INSERT INTO parameter_guardrails (scope, machine_id, param_key, min_value, max_value) VALUES ('machine', ${x.mid}, ${RUN + "pk" + k}, 0, 1)`);
    await H.dung(sql`INSERT INTO parameter_change_log (machine_id, param_key, source) VALUES (${x.mid}, ${RUN + "pk" + k}, 'test')`);
    await H.dung(sql`INSERT INTO field_device_health ("deviceKey", "machineId", "factoryId", state) VALUES (${RUN + "dk" + k}, ${x.mid}, ${x.fid}, 'alive')`);
    const [da] = await H.dung(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "machineId") VALUES (${RUN + "ad" + k}, ${RUN + "ad" + k}, 'stub', 'x', ${x.mid}) RETURNING id`);
    ad["ad" + k] = da.id;
  }
  await H.dung(sql`INSERT INTO parameter_guardrails (scope, machine_type, param_key, min_value, max_value) VALUES ('machine_type', 'AOI', ${RUN + "pkT"}, 0, 1)`);
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 300_000);

afterAll(async () => {
  if (!H) return;
  const l = `'${RUN}%'`;
  for (const s of [
    `DELETE FROM feeder_setup_verifications WHERE "machineId" IN (${H.A.mid}, ${H.B.mid})`,
    `DELETE FROM device_adapters WHERE code LIKE ${l}`,
    `DELETE FROM field_device_health WHERE "deviceKey" LIKE ${l}`,
    `DELETE FROM parameter_change_log WHERE param_key LIKE ${l}`,
    `DELETE FROM parameter_guardrails WHERE param_key LIKE ${l}`,
    `DELETE FROM hot_folder_files WHERE "fileName" LIKE ${l}`,
    `DELETE FROM hot_folder_configs WHERE "adapterKey" LIKE ${l}`,
    `DELETE FROM api_keys WHERE name LIKE ${l}`,
    `DELETE FROM aoi_commissioning_records WHERE "machineId" IN (${H.A.mid}, ${H.B.mid})`,
  ]) await qChuTest(s).catch(() => undefined);
  await H.don();
});

const khongMay = "NOT_FOUND:ENTITY_NOT_FOUND:machine";

describe("★★★ aoiOnboarding", () => {
  it("listAoiMachines chỉ máy của A; getDraft/listRecords máy B ⇒ null / []; status máy B ⇒ NOT_FOUND; admin thấy cả hai", async () => {
    const ds = J(await cA.ob.listAoiMachines());
    expect(ds).toContain(H.A.code);
    expect(ds).not.toContain(H.B.code);
    expect(J(await cAdm.ob.listAoiMachines())).toContain(H.B.code);
    expect(await cA.ob.getDraft({ machineId: H.B.mid })).toBeNull();
    expect((await cA.ob.getDraft({ machineId: H.A.mid }))?.machineId).toBe(H.A.mid);
    expect(await cA.ob.listRecords({ machineId: H.B.mid })).toEqual([]);
    expect((await cA.ob.listRecords({ machineId: H.A.mid })).length).toBe(1);
    expect((await cAdm.ob.listRecords({ machineId: H.B.mid })).length).toBe(1);
    expect(await loi(() => cA.ob.status({ machineId: H.B.mid }))).toBe(khongMay);
    expect(await loi(() => cA.ob.status({ machineId: H.A.mid }))).toBeNull();
    expect(await loi(() => cRong.ob.status({ machineId: H.A.mid }))).toBe(khongMay);
  });
});

describe("★★★ feederVerify ×3 · machineApi.listKeys", () => {
  it("máy B: listForSetup [] · setupStatus/runGate NOT_FOUND; máy A đọc được", async () => {
    for (const m of [H.A.mid, H.B.mid]) await cAdm.fv.verifyScan({ machineId: m, slotCode: "S1", scannedComponentCode: "X", expectedComponentCode: "X" });
    expect(await cA.fv.listForSetup({ machineId: H.B.mid })).toEqual([]);
    expect((await cA.fv.listForSetup({ machineId: H.A.mid })).length).toBeGreaterThan(0);
    expect((await cAdm.fv.listForSetup({ machineId: H.B.mid })).length).toBeGreaterThan(0);
    expect(await loi(() => cA.fv.setupStatus({ machineId: H.B.mid, productModelId: H.modelId }))).toBe(khongMay);
    expect(await loi(() => cA.fv.setupStatus({ machineId: H.A.mid, productModelId: H.modelId }))).toBeNull();
    expect(await loi(() => cA.fv.runGate({ machineId: H.B.mid, productModelId: H.modelId }))).toBe(khongMay);
    expect(await loi(() => cAdm.fv.runGate({ machineId: H.B.mid, productModelId: H.modelId }))).toBeNull();
  });
  it("listKeys: khoá của máy B ẩn với A; admin thấy", async () => {
    expect(await cA.ma.listKeys({ machineId: H.B.mid })).toEqual([]);
    expect((await cA.ma.listKeys({ machineId: H.A.mid })).length).toBe(1);
    expect((await cAdm.ma.listKeys({ machineId: H.B.mid })).length).toBe(1);
    expect(J(await cA.ma.listKeys({ machineId: H.A.mid }))).not.toContain(RUN + "hA");
  });
});

describe("★★★ hotFolder ×3", () => {
  it("status/listConfigs chỉ cấu hình máy A; recentFiles của cấu hình B ⇒ []", async () => {
    const st = J(await cA.hf.status());
    expect(st).toContain(RUN + "ak" + "A");
    expect(st).not.toContain(RUN + "akB");
    const ls = J(await cA.hf.listConfigs());
    expect(ls).toContain(RUN + "akA");
    expect(ls).not.toContain(RUN + "akB");
    expect(J(await cAdm.hf.listConfigs())).toContain(RUN + "akB");
    expect(await cA.hf.recentFiles({ configId: ad.hcB })).toEqual([]);
    expect((await cA.hf.recentFiles({ configId: ad.hcA })).length).toBe(1);
    expect((await cAdm.hf.recentFiles({ configId: ad.hcB })).length).toBe(1);
  });
});

describe("★★★ parameterGuardrail", () => {
  it("list/changeLog: hàng máy B ẩn; hàng theo LOẠI máy vẫn thấy; admin thấy hết", async () => {
    const ds = J(await cA.pg.list({}));
    expect(ds).toContain(RUN + "pkA");
    expect(ds).not.toContain(RUN + "pkB");
    expect(ds).toContain(RUN + "pkT");
    expect(J(await cAdm.pg.list({}))).toContain(RUN + "pkB");
    const nk = J(await cA.pg.changeLog({}));
    expect(nk).toContain(RUN + "pkA");
    expect(nk).not.toContain(RUN + "pkB");
    expect(J(await cAdm.pg.changeLog({}))).toContain(RUN + "pkB");
  });
  it("get theo id: hàng máy B ⇒ null", async () => {
    const [b] = await H.dung(sql`SELECT id FROM parameter_guardrails WHERE param_key = ${RUN + "pkB"}`);
    const [a] = await H.dung(sql`SELECT id FROM parameter_guardrails WHERE param_key = ${RUN + "pkA"}`);
    expect(await cA.pg.get({ id: b.id })).toBeNull();
    expect((await cA.pg.get({ id: a.id }))?.id).toBe(a.id);
    expect((await cAdm.pg.get({ id: b.id }))?.id).toBe(b.id);
  });
});

describe("★★★ fromScene · field health · connectionSupervisors · complianceMetrics", () => {
  it("fromScene: nhà máy B ⇒ NOT_FOUND factory; nhà máy A không bị cổng chặn", async () => {
    const goi = (c: C, f: number) => loi(() => c.sim.fromScene({ factoryId: f }));
    expect(await goi(cA, H.B.fid)).toBe("NOT_FOUND:ENTITY_NOT_FOUND:factory");
    expect(await goi(cA, H.A.fid)).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:factory");
    expect(await goi(cAdm, H.B.fid)).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:factory");
  });
  it("field.health / healthSummary chỉ thiết bị trong phạm vi", async () => {
    const h = J(await cA.fd.health({}));
    expect(h).toContain(RUN + "dkA");
    expect(h).not.toContain(RUN + "dkB");
    expect(J(await cAdm.fd.health({}))).toContain(RUN + "dkB");
    const tong = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + Number(n), 0);
    expect(tong(await cA.fd.healthSummary())).toBe(1);
    expect(tong(await cRong.fd.healthSummary())).toBe(0);
    expect(tong(await cAdm.fd.healthSummary())).toBeGreaterThanOrEqual(2);
  });
  it("connectionSupervisors lọc theo adapter của máy trong phạm vi", async () => {
    giaLap.sup = [{ adapterId: ad.adA }, { adapterId: ad.adB }];
    expect((await cA.sh.connectionSupervisors()).supervisors.map((s: any) => s.adapterId)).toEqual([ad.adA]);
    expect((await cRong.sh.connectionSupervisors()).supervisors).toEqual([]);
    expect((await cAdm.sh.connectionSupervisors()).supervisors.length).toBe(2);
  });
  it("complianceMetrics đếm máy theo phạm vi", async () => {
    const tongMay = (o: any) => Number(o.totalMachines ?? o.machines ?? o.machineCount ?? -1);
    const a = await cA.es.complianceMetrics();
    const adm = await cAdm.es.complianceMetrics();
    expect(J(a)).not.toBe(J(adm));
    expect(tongMay(a)).toBeLessThan(tongMay(adm));
  });
});
