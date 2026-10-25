/**
 * ★★★ SCADA R1b-2a Task 12 (điều phối 2026-10-25, ruling K11 + K7) — `oversight.posture` lọc theo PHẠM VI NHÀ MÁY của người gọi.
 *
 * Trước: posture đếm luật interlock (độ phủ / hỏng cấu hình / lệch lưới) trên TOÀN bảng ⇒ người nhà máy A thấy số luật hỏng của nhà máy B (mục cuối của
 * sổ nợ đọc `phamViDocBaseline.ts`). Nay: mọi số đếm theo phạm vi từ `ctx` (`idsTrongPhamVi` THẬT đọc `user_factory_assignments`; quyền qua
 * `checkPermission` THẬT; người dùng qua `taoNguoiDungTest`).
 *
 * Gieo hai nhà máy A/B (mỗi nơi chuyền → trạm → máy + adapter gắn máy) + một adapter KHÔNG gắn máy, rồi:
 *   • luật độ phủ (bật + duyệt + chặn được + có đích): cA, cB, cAB (vị trí máy A nhưng đích adapter của B ⇒ KHÔNG ai ngoài toàn quyền thấy);
 *   • luật hỏng cấu hình (telemetry_tag thiếu sourceKey): hA, hB, hN (không nêu vị trí nào ⇒ chỉ toàn quyền);
 *   • luật lệch lưới (bật, commandValue 2.5 lên tag int CHƯA khai): lA, lB;
 *   • dòng STOP HMI quá hạn 24 h (`STOP_QUA_HAN`): sA (cả lệnh, đã xác minh, máy A), sAx (cả lệnh, CHƯA xác minh, máy A ⇒ chỉ toàn quyền),
 *     sB, sAdA / sAdB (theo adapter), sCu (máy A nhưng 25 h trước ⇒ ngoài cửa sổ).
 * A/B: người A chỉ thấy phần của A, người B chỉ thấy phần của B, người không được gán nhà máy thấy 0, admin thấy cả hai (+ hàng chỉ-toàn-quyền +
 * bộ đếm trong bộ nhớ). Đột biến bỏ lọc (`dieuKienLuatTrongPhamVi` / `dieuKienStopQuaHanTrongPhamVi` ⇒ undefined) ⇒ ca A/B ĐỎ.
 * ⚠ scada_command_attempts là WORM (avi_app không xoá được) — 6 dòng STOP_QUA_HAN của tệp này ở lại `_test` (user_id = người dùng test, adapter đã xoá).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { interlockRules, scadaCommandAttempts } from "../../drizzle/schema";
import { _datLaiDemStopQuaHanChoTest, ghiNhanStopQuaHanKhongGhiSo } from "../_core/hanStopHmi";

const RUN = `opv${process.pid}${Date.now().toString(36)}`;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

interface NhaMay {
  fid: number;
  lid: number;
  sid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const ad = { a: 0, b: 0, n: 0 };
const ruleIds: number[] = [];
const factories: string[] = [];
let adminId = 0;

type Caller = ReturnType<typeof import("./oversightRouter").oversightRouter.createCaller>;
let rt!: typeof import("./oversightRouter");
let userA!: Caller;
let userB!: Caller;
let userRong!: Caller;
let admin!: Caller;
let ctxAdmin!: { user: { id: number; role: string } };
let ctxA!: { user: { id: number; role: string } };
const luatN = { cN: 0, cAN: 0 };

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
  return { fid: Number(f.id), lid: Number(l.id), sid: Number(s.id), mid: Number(m.id), code };
}

async function seedAdapter(code: string, machineId: number | null): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${machineId}, ${code}, ${code}, 'stub', ${"stub://" + code}, 500, false, 'disabled') RETURNING id`);
  return Number(r.id);
}

async function seedNguoi(ten: string, role: "engineer" | "admin", factoryCodes: string[]): Promise<{ caller: Caller; id: number }> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "opv", ts: RUN, ten: `OPV ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true)`);
  }
  const ctx = { user: { id: u.id, role, name: u.name } } as never;
  return { caller: rt.oversightRouter.createCaller(ctx), id: u.id };
}

/** Một luật; trả id. `v` = cột tuỳ chọn. */
async function seedLuat(ten: string, v: {
  scope?: string;
  sourceType?: string;
  sourceKey?: string | null;
  action?: string;
  lineId?: number | null;
  stationId?: number | null;
  machineId?: number | null;
  targetMachineId?: number | null;
  targetAdapterId?: number | null;
  commandTag?: string | null;
  commandValue?: unknown;
  enabled?: boolean;
  approved?: boolean;
}): Promise<number> {
  const [r] = await dung(sql`INSERT INTO interlock_rules (name, scope, "sourceType", "sourceKey", "comparisonOperator", threshold, action,
      "lineId", "stationId", "machineId", "targetMachineId", "targetAdapterId", "commandTag", "commandValue", enabled, "approvedBy", "createdBy")
    VALUES (${`${RUN}-${ten}`}, ${v.scope ?? "machine"}, ${v.sourceType ?? "ng_rate"}, ${v.sourceKey ?? null}, 'gt', 80, ${v.action ?? "block_downstream"},
      ${v.lineId ?? null}, ${v.stationId ?? null}, ${v.machineId ?? null}, ${v.targetMachineId ?? null}, ${v.targetAdapterId ?? null},
      ${v.commandTag ?? null}, ${v.commandValue === undefined ? null : JSON.stringify(v.commandValue)}::jsonb, ${v.enabled ?? true},
      ${v.approved === false ? null : adminId}, ${adminId}) RETURNING id`);
  ruleIds.push(Number(r.id));
  return Number(r.id);
}

async function seedStop(adapterId: number | null, requestedValue: unknown, gioTruoc = 0): Promise<void> {
  await dung(sql`INSERT INTO scada_command_attempts (user_id, adapter_id, stage, outcome, reason_code, requested_value, ly_do, at)
    VALUES (${adminId}, ${adapterId}, 'dispatch', 'rejected', 'STOP_QUA_HAN', ${JSON.stringify(requestedValue)}::jsonb, ${RUN},
      now() - make_interval(hours => ${gioTruoc}))`);
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  rt = await import("./oversightRouter");
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.a = await seedAdapter(`${RUN}-a`, A.mid);
  ad.b = await seedAdapter(`${RUN}-b`, B.mid);
  ad.n = await seedAdapter(`${RUN}-n`, null);
  const ad_ = await seedNguoi("ad", "admin", []);
  admin = ad_.caller;
  adminId = ad_.id;
  ctxAdmin = { user: { id: adminId, role: "admin" } };
  const ua = await seedNguoi("ua", "engineer", [A.code]);
  userA = ua.caller;
  ctxA = { user: { id: ua.id, role: "engineer" } };
  userB = (await seedNguoi("ub", "engineer", [B.code])).caller;
  userRong = (await seedNguoi("ur", "engineer", [])).caller;

  // tag int CHƯA khai (scale 1) cho luật lệch lưới
  for (const a of [ad.a, ad.b]) {
    await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled") VALUES (${a}, 'ti', '40001', 'int', true, true)`);
  }

  // độ phủ
  await seedLuat("cA", { machineId: A.mid, targetMachineId: A.mid });
  await seedLuat("cB", { machineId: B.mid, targetMachineId: B.mid });
  await seedLuat("cAB", { machineId: A.mid, targetAdapterId: ad.b });
  await seedLuat("cLineA", { scope: "line", lineId: A.lid, targetAdapterId: ad.a }); // vị trí chuyền + đích adapter cùng A
  // Polish M-2 — adapter KHÔNG gắn máy (ad.n): chỉ toàn quyền thấy (adapterNhinThay(null, [..]) = false)
  luatN.cN = await seedLuat("cN", { targetAdapterId: ad.n }); // vị trí DUY NHẤT = đích adapter vô chủ
  luatN.cAN = await seedLuat("cAN", { machineId: A.mid, targetAdapterId: ad.n }); // máy A nhưng đích adapter vô chủ
  // hỏng cấu hình (telemetry_tag thiếu sourceKey)
  await seedLuat("hA", { sourceType: "telemetry_tag", action: "alert", machineId: A.mid });
  await seedLuat("hB", { sourceType: "telemetry_tag", action: "alert", machineId: B.mid });
  await seedLuat("hN", { sourceType: "telemetry_tag", action: "alert" }); // không nêu vị trí ⇒ chỉ toàn quyền
  // lệch lưới: bật, KHÔNG duyệt (không vào độ phủ), 2.5 lên int scale 1
  await seedLuat("lA", { action: "stop_line", machineId: A.mid, targetAdapterId: ad.a, commandTag: "ti", commandValue: 2.5, approved: false });
  await seedLuat("lB", { action: "stop_line", machineId: B.mid, targetAdapterId: ad.b, commandTag: "ti", commandValue: 2.5, approved: false });

  // STOP quá hạn
  await seedStop(null, { machineId: A.mid, daXacMinhPhamVi: true, buoc: "vai_tro", hanMs: 2000 });
  await seedStop(null, { machineId: A.mid, daXacMinhPhamVi: false, buoc: "pham_vi", hanMs: 2000 });
  await seedStop(null, { machineId: B.mid, daXacMinhPhamVi: true, buoc: "vai_tro", hanMs: 2000 });
  await seedStop(ad.a, [{ tagKey: "stop", value: 1 }]);
  await seedStop(ad.b, [{ tagKey: "stop", value: 1 }]);
  await seedStop(ad.n, [{ tagKey: "stop", value: 1 }]); // Polish M-2 — adapter vô chủ ⇒ chỉ toàn quyền
  await seedStop(null, { machineId: A.mid, daXacMinhPhamVi: true, buoc: "doc_ghim", hanMs: 2000 }, 25);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  if (ruleIds.length) await dung(sql`DELETE FROM interlock_rules WHERE id IN (${sql.join(ruleIds.map((i) => sql`${i}`), sql`, `)})`).catch(() => undefined);
  const ids = [ad.a, ad.b, ad.n].filter(Boolean);
  if (ids.length) {
    const ds = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${ds})`).catch(() => undefined);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${ds})`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`).catch(() => undefined);
  await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM stations WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM production_lines WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM workshops WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
});

describe("★★★ oversight.posture — A/B theo phạm vi nhà máy (danh tính từ ctx)", () => {
  it("người nhà máy A: độ phủ = cA + cLineA (KHÔNG cB, KHÔNG cAB — đích adapter của B); hỏng cấu hình = hA + lA (KHÔNG hB / lB / hN)", async () => {
    const r = await userA.posture();
    expect(r.interlockCoverageDegraded).toBe(false);
    expect(r.interlockRulesEnabledWithTarget).toBe(2);
    expect(r.interlockRulesCauHinhHong).toBe(2);
  });

  it("người nhà máy B: độ phủ = cB; hỏng cấu hình = hB + lB", async () => {
    const r = await userB.posture();
    expect(r.interlockCoverageDegraded).toBe(false);
    expect(r.interlockRulesEnabledWithTarget).toBe(1);
    expect(r.interlockRulesCauHinhHong).toBe(2);
  });

  it("người KHÔNG được gán nhà máy nào (phạm vi rỗng): 0 ở mọi số đếm, không degraded (rỗng ≠ không biết)", async () => {
    const r = await userRong.posture();
    expect(r.interlockCoverageDegraded).toBe(false);
    expect(r.interlockRulesEnabledWithTarget).toBe(0);
    expect(r.interlockRulesCauHinhHong).toBe(0);
    expect(r.stopQuaHan24h).toEqual({ count: 0, theoBuoc: {}, khongGhiSo: null, degraded: false });
  });

  it("admin (toàn quyền): thấy CẢ HAI nhà máy + luật không vị trí (đếm toàn bảng ≥ phần của tệp này; đếm chính xác trên tập của tệp)", async () => {
    const r = await admin.posture();
    expect(r.interlockCoverageDegraded).toBe(false);
    expect(r.interlockRulesEnabledWithTarget).toBeGreaterThanOrEqual(4);
    expect(r.interlockRulesCauHinhHong).toBeGreaterThanOrEqual(5);
    // chính xác: cùng hàm + cùng cổng phạm vi admin, thu về hàng của tệp này
    const pv = await rt._internal.layPhamViPosture(ctxAdmin, db);
    expect(pv.toanQuyen).toBe(true);
    const cong = rt._internal.dieuKienLuatTrongPhamVi(pv);
    expect(cong).toBeUndefined();
    const cuaTep = like(interlockRules.name, `${RUN}-%`);
    expect((await rt._internal.fetchInterlockCoverage(db, cuaTep)).count).toBe(6); // cA cB cAB cLineA cN cAN
    expect((await rt._internal.fetchInterlockCauHinhHong(db, cuaTep)).count).toBe(5); // hA hB hN lA lB
  });
});

describe("★★★ STOP HMI quá hạn 24 h (ruling K7) — theo phạm vi; chưa xác minh / bộ nhớ ⇒ chỉ toàn quyền", () => {
  it("người A: sA (vai_tro) + adapter A; KHÔNG sAx (chưa xác minh phạm vi), KHÔNG sB / adapter B, KHÔNG dòng 25 h; không thấy bộ đếm bộ nhớ", async () => {
    _datLaiDemStopQuaHanChoTest();
    ghiNhanStopQuaHanKhongGhiSo("xac_thuc");
    const r = await userA.posture();
    expect(r.stopQuaHan24h).toEqual({ count: 2, theoBuoc: { vai_tro: 1, adapter: 1 }, khongGhiSo: null, degraded: false });
  });

  it("người B: sB + adapter B", async () => {
    const r = await userB.posture();
    expect(r.stopQuaHan24h).toEqual({ count: 2, theoBuoc: { vai_tro: 1, adapter: 1 }, khongGhiSo: null, degraded: false });
  });

  it("admin: mọi dòng trong cửa sổ (kể cả chưa xác minh) + bộ đếm bộ nhớ; chính xác trên dòng của tệp này", async () => {
    _datLaiDemStopQuaHanChoTest();
    ghiNhanStopQuaHanKhongGhiSo("xac_thuc");
    const r = await admin.posture();
    expect(r.stopQuaHan24h.degraded).toBe(false);
    expect(r.stopQuaHan24h.khongGhiSo).toMatchObject({ count: 1, theoBuoc: { xac_thuc: 1 } });
    expect(r.stopQuaHan24h.count).toBeGreaterThanOrEqual(6);
    const pv = await rt._internal.layPhamViPosture(ctxAdmin, db);
    const cuaTep = eq(scadaCommandAttempts.userId, adminId);
    const tep = await rt._internal.fetchStopQuaHan(db, pv, cuaTep);
    expect(tep).toMatchObject({ count: 7, theoBuoc: { vai_tro: 2, pham_vi: 1, adapter: 3 }, degraded: false }); // + adapter vô chủ (M-2)
  });

  it("★ Polish M-2 — adapter KHÔNG gắn máy (ad.n): luật nhắm nó + dòng STOP của nó ĐẾM cho admin, KHÔNG cho người nhà máy A", async () => {
    const chiN = sql`${interlockRules.id} IN (${luatN.cN}, ${luatN.cAN})`;
    const stopN = sql`${scadaCommandAttempts.adapterId} = ${ad.n} AND ${scadaCommandAttempts.userId} = ${adminId}`;
    const pvAdmin = await rt._internal.layPhamViPosture(ctxAdmin, db);
    const pvA = await rt._internal.layPhamViPosture(ctxA, db);
    expect(pvA.toanQuyen).toBe(false);
    expect(pvA.adapter).not.toContain(ad.n);
    const congAdmin = rt._internal.dieuKienLuatTrongPhamVi(pvAdmin);
    const congA = rt._internal.dieuKienLuatTrongPhamVi(pvA);
    const voi = (a: ReturnType<typeof sql> | undefined, b: ReturnType<typeof sql>) => (a ? sql`(${a}) AND (${b})` : b);
    // admin: cả hai luật + một dòng STOP
    expect((await rt._internal.fetchInterlockCoverage(db, voi(congAdmin, chiN))).count).toBe(2);
    expect((await rt._internal.fetchStopQuaHan(db, pvAdmin, stopN)).theoBuoc).toEqual({ adapter: 1 });
    // người A: không luật nào, không dòng nào (cAN có máy A nhưng đích là adapter vô chủ)
    expect((await rt._internal.fetchInterlockCoverage(db, voi(congA, chiN))).count).toBe(0);
    expect(await rt._internal.fetchStopQuaHan(db, pvA, stopN)).toEqual({ count: 0, theoBuoc: {}, khongGhiSo: null, degraded: false });
  });

  it("phạm vi không phân giải được (pv null) ⇒ degraded, 0 (fail-closed, không đoán toàn quyền)", async () => {
    expect(await rt._internal.fetchStopQuaHan(db, null)).toEqual({ count: 0, theoBuoc: {}, khongGhiSo: null, degraded: true });
  });
});
