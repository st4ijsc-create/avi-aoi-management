/**
 * SCADA R1b-2b-1 Task 1 (mục 59; điều phối 2026-10-26 Q1 + điều kiện 6; ruling C6 / C11 / C16; Review Focus 1) — người vận hành có quyền
 * dừng, ĐANG BỊ BUỘC ĐỔI MẬT KHẨU, vẫn tới được STOP: `scadaCommands.mayDungKhanCap` (thủ tục đọc tối thiểu, phần tử thứ hai của tập miễn
 * cổng) + `scadaCommands.dungMay`; MỌI thủ tục khác vẫn `MUST_CHANGE_PASSWORD`. CSDL `_test` THẬT, gọi qua `appRouter` (đường THẬT mà cổng
 * nhìn thấy trong `path`), `dispatch()` THẬT → StubDriver (RAM).
 *
 * Khuôn cờ buộc đổi: `scadaCommandsRouter.dungMay.hanTruocGui.r1b2.db.test.ts` (hai mốc trên hàng users). Ba nhà máy: A (người dùng tệp),
 * B (không gán — máy B không bao giờ hiện), C (201 máy có adapter — điều kiện 6). `OT_CONTROL_ENABLED` / `SCADA_COMMANDS_ENABLED` CHỈ trong
 * tiến trình; AI_OT_CONTROL_ENABLED không đụng. Đồng hồ thật, mỗi ca < 10 s.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `r1b2bt1${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  /** ms chờ trước idsTrongPhamVi thật (ca hạn 3 s của thân) */
  phamViCho: 0,
}));

const cho = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    (t as { unref?: () => void }).unref?.();
  });

vi.mock("../db/hierarchy", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db/hierarchy")>();
  return {
    ...real,
    idsTrongPhamVi: (async (...a: Parameters<typeof real.idsTrongPhamVi>) => {
      if (H.phamViCho > 0) await cho(H.phamViCho);
      return real.idsTrongPhamVi(...a);
    }) as typeof real.idsTrongPhamVi,
  };
});

vi.mock("../_core/socket", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/socket")>();
  return { ...real, getIO: () => ({ to: () => ({ emit: () => true }) }) as never };
});

vi.mock("../services/safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [
      { code: "R1B2BT1-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
    ],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});

vi.mock("../services/ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/ot/otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => H.fingerprints.get(adapterId),
  };
});

vi.mock("../services/robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async () => undefined };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { StubDriver } from "../services/ot/drivers/stubDriver";
import { adapterTargetFingerprint } from "../services/ot/adapterTarget";
import { HAN_DANH_SACH_DUNG_KHAN_CAP_MS, TRAN_MAY_DUNG_KHAN_CAP } from "../services/scada/mayDungKhanCap";

class StubGhi extends StubDriver {
  ghi: Array<Array<{ tagKey: string; value: unknown }>> = [];
  override async writeTags(writes: Array<{ tagKey: string; address: string; value: unknown }>) {
    this.ghi.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
    return super.writeTags(writes);
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Goc = ReturnType<(typeof import("../routers"))["appRouter"]["createCaller"]>;

let db: Db;
const fx = { fA: "", fB: "", fC: "", sA: 0, mA1: 0, mA2: 0, mB: 0, a1: 0, a2: 0, aB: 0 };
let stubA1: StubGhi;
const userIds: number[] = [];
const goc: Record<"op" | "viewer" | "opKhongSua" | "opC", { id: number; caller: Goc }> = {} as never;

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}
async function seedNhaMay(code: string): Promise<number> {
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${"Chuyen " + code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  return Number(s.id);
}
async function seedMay(sid: number, ma: string, ten: string): Promise<number> {
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${sid}, ${RUN + ma}, ${ten}, 'AOI', true) RETURNING id`);
  return Number(m.id);
}
async function seedAdapter(mid: number, ma: string): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "lastError")
    VALUES (${mid}, ${`${RUN}-${ma}`}, ${`${RUN}-${ma}`}, 'stub', ${`stub://${RUN}-${ma}`}, 60000, true, 'disabled', ${"LOI-BI-MAT-" + ma}) RETURNING id`);
  return Number(r.id);
}
/** tag ghim DỪNG (bool true) mức tác động 1 — đúng thứ STOP HMI gửi */
async function seedGhim(adapterId: number, key: string): Promise<void> {
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, stop_value, stop_pinned_by, stop_pinned_at, actuation_level)
    VALUES (${adapterId}, ${key}, ${"M." + key}, 'bool', true, true, 'input_output'::scada_channel_kind, 'true'::jsonb, '1', now(), 1)`);
}
async function seedNguoi(tag: string, role: "operator" | "viewer", nhaMay: string, canEdit: boolean) {
  const u = await taoNguoiDungTest(tag, role, { tienTo: "r1b2bt1", ts: RUN, ten: `R1B2B T1 ${tag}` });
  userIds.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${nhaMay})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, ${canEdit})`);
  const { appRouter } = await import("../routers");
  return { id: u.id, caller: appRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled: false } } as never) };
}
/** hai mốc trên hàng users (khuôn buocDoiMatKhau.test.ts): thu hồi SAU lượt đổi gần nhất ⇒ phải đổi */
const datCo = (uid: number, bat: boolean) =>
  bat
    ? dung(sql`UPDATE users SET "passwordChangedAt" = now() - interval '1 minute', "passwordInvalidBefore" = now() WHERE id = ${uid}`)
    : dung(sql`UPDATE users SET "passwordChangedAt" = now(), "passwordInvalidBefore" = NULL WHERE id = ${uid}`);

type Loi = { code?: string; appCode?: string; appParams?: Record<string, unknown> };
async function loiCua(p: Promise<unknown>): Promise<Loi> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}
async function mocAudit(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM control_audit_log`);
  return Number(r.m);
}

beforeAll(async () => {
  vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("OT_CONTROL_ENABLED", "true");
  vi.stubEnv("OT_COMMISSIONING_REQUIRED", "false");
  vi.stubEnv("OT_READBACK_ENABLED", "false"); // dungMay vẫn đọc lại (docLai bat_buoc)
  vi.stubEnv("OT_CMD_SERIALIZE_ENABLED", "false");
  vi.stubEnv("SEC_PLATFORM", "false");
  vi.stubEnv("UNS_CMD_ACK_ENABLED", "false");
  vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "false");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;

  fx.fA = `${RUN}a`;
  fx.fB = `${RUN}b`;
  fx.fC = `${RUN}c`;
  fx.sA = await seedNhaMay(fx.fA);
  const sB = await seedNhaMay(fx.fB);
  const sC = await seedNhaMay(fx.fC);
  // A: mA1 có adapter ghim DỪNG (nhận STOP); mA2 có adapter KHÔNG ghim (coDung false, 0 adapter)
  fx.mA1 = await seedMay(fx.sA, "m1", "May T1-1");
  fx.mA2 = await seedMay(fx.sA, "m2", "May T1-2");
  fx.a1 = await seedAdapter(fx.mA1, "a1");
  await seedGhim(fx.a1, "stop_cmd");
  fx.a2 = await seedAdapter(fx.mA2, "a2");
  // B: máy có adapter ghim — KHÔNG được hiện cho người nhà máy A
  fx.mB = await seedMay(sB, "mB", "May T1-B");
  fx.aB = await seedAdapter(fx.mB, "aB");
  await seedGhim(fx.aB, "stop_cmd");
  // C: TRẦN + 1 = 201 máy, mỗi máy MỘT adapter TẮT (vị từ "có nối"; khảo sát không gọi gì theo adapter) — điều kiện 6
  await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
    SELECT ${sC}, ${RUN + "c"} || lpad(g::text, 3, '0'), 'May C ' || g, 'AOI', true FROM generate_series(1, ${TRAN_MAY_DUNG_KHAN_CAP + 1}) g`);
  await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    SELECT m.id, ${RUN + "-ac"} || m.id, ${RUN + "-ac"} || m.id, 'stub', 'stub://' || m.id, 60000, false, 'disabled'
    FROM machines m WHERE m."stationId" = ${sC}`);

  stubA1 = new StubGhi();
  await stubA1.connect({ endpoint: `stub://${RUN}-a1` } as never);
  H.drivers.set(fx.a1, stubA1);
  const [row] = await dung(sql`SELECT protocol, endpoint, "machineId", "connectionOptions" FROM device_adapters WHERE id = ${fx.a1}`);
  H.fingerprints.set(
    fx.a1,
    adapterTargetFingerprint({ protocol: row.protocol, endpoint: row.endpoint, machineId: row.machineId ?? null, connectionOptions: row.connectionOptions ?? null }),
  );

  goc.op = await seedNguoi("op", "operator", fx.fA, true);
  // viewer CÓ machine_control.canEdit ⇒ thứ chặn là SÀN VAI mức 1 (đột biến "bỏ kiemCongVaiTro" làm ca viewer đỏ)
  goc.viewer = await seedNguoi("viewer", "viewer", fx.fA, true);
  goc.opKhongSua = await seedNguoi("opks", "operator", fx.fA, false);
  goc.opC = await seedNguoi("opC", "operator", fx.fC, true);
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  try {
    await stubA1?.disconnect();
  } catch {
    /* bỏ qua */
  }
  if (!db) return;
  try {
    await cho(500);
    for (const id of userIds) {
      await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool LIKE 'hmi.%'`);
      await dung(sql`DELETE FROM permissions WHERE "userId" = ${id}`);
    }
    for (const id of [fx.a1, fx.a2, fx.aB].filter(Boolean)) {
      await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${id}`);
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
      await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
    }
    await dung(sql`DELETE FROM device_adapters WHERE code LIKE ${RUN + "-ac%"}`);
    await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "%"}`);
    for (const c of [fx.fA, fx.fB, fx.fC].filter(Boolean)) {
      await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${c}`);
      await dung(sql`DELETE FROM stations WHERE code = ${c}`);
      await dung(sql`DELETE FROM production_lines WHERE code = ${c}`);
      await dung(sql`DELETE FROM workshops WHERE code = ${c}`);
      await dung(sql`DELETE FROM factories WHERE code = ${c}`);
    }
  } catch (e) {
    console.warn("[r1b2bt1] dọn dữ liệu:", (e as Error).message, String((e as { cause?: unknown }).cause ?? ""));
  }
}, 120_000);

beforeEach(() => {
  H.phamViCho = 0;
});
afterEach(async () => {
  H.phamViCho = 0;
  vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
  for (const k of ["op", "viewer", "opKhongSua", "opC"] as const) if (goc[k]) await datCo(goc[k].id, false);
});

/** Năm trường của hợp đồng tối thiểu (ruling C16) — sắp xếp để so tập khoá. */
const KHOA_HOP_DONG = ["chuyen", "coDung", "machineId", "soAdapter", "ten"];

describe("★★★ mục 59 — operator ĐANG BỊ BUỘC ĐỔI MẬT KHẨU tới được STOP; mọi thủ tục khác vẫn bị chặn", () => {
  it("cầu chì — cờ bật thật trong DB (phaiDoiMatKhau đọc MỚI)", async () => {
    const { phaiDoiMatKhau } = await import("../db");
    await datCo(goc.op.id, true);
    expect(await phaiDoiMatKhau(goc.op.id)).toBe(true);
    await datCo(goc.op.id, false);
    expect(await phaiDoiMatKhau(goc.op.id)).toBe(false);
  });

  it("★★★ cờ BẬT ⇒ mayDungKhanCap trả ĐÚNG máy của A (không máy B), có coDung / soAdapter; JSON KHÔNG lộ adapter / endpoint / lastError / ghim", async () => {
    await datCo(goc.op.id, true);
    const kq = await goc.op.caller.scadaCommands.mayDungKhanCap();
    expect(kq.biCat).toBe(false);
    expect(kq.may.map((m) => m.machineId)).toEqual([fx.mA1, fx.mA2]);
    expect(kq.may[0]).toEqual({ machineId: fx.mA1, ten: `${RUN}m1 · May T1-1`, chuyen: `Chuyen ${fx.fA}`, coDung: true, soAdapter: 1 });
    expect(kq.may[1]).toEqual({ machineId: fx.mA2, ten: `${RUN}m2 · May T1-2`, chuyen: `Chuyen ${fx.fA}`, coDung: false, soAdapter: 0 });
    for (const m of kq.may) expect(Object.keys(m).sort()).toEqual(KHOA_HOP_DONG);
    expect(Object.keys(kq).sort()).toEqual(["biCat", "may"]);
    // ruling C16 + Q1: không mã adapter / edgeCode / tagKey / endpoint / lastError / stopValue / giá trị ghim
    const json = JSON.stringify(kq);
    for (const cam of [`${RUN}-a1`, `${RUN}-a2`, "stub://", "LOI-BI-MAT", "stop_cmd", "endpoint", "lastError", "stopValue", "edgeCode", "adapters", "khaNangDung", "ghimBoQua", "tagKey"]) {
      expect(json, `JSON lộ "${cam}"`).not.toContain(cam);
    }
    expect(json).not.toContain(String(fx.mB));
  }, 10_000);

  it("★★★ CÙNG người, cờ BẬT ⇒ dungMay máy A acked_verified + ĐÚNG MỘT audit 'scada_hmi_stop_buoc_doi_mat_khau' (hồi quy)", async () => {
    await datCo(goc.op.id, true);
    const am = await mocAudit();
    const ghiTruoc = stubA1.ghi.length;
    const crid = crypto.randomUUID();
    const kq = await goc.op.caller.scadaCommands.dungMay({ machineId: fx.mA1, clientRequestId: crid });
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.a1, status: "acked_verified", ok: true });
    expect(stubA1.ghi.length).toBe(ghiTruoc + 1);
    const docAudit = async () =>
      ((await dung(sql`SELECT "entityType", "entityId", "afterJson" FROM control_audit_log
        WHERE id > ${am} AND action = 'scada_hmi_stop_buoc_doi_mat_khau' AND "actorId" = ${goc.op.id} ORDER BY id`)) as Array<{ entityType: string; entityId: string; afterJson: any }>).filter(
        (r) => r.afterJson?.clientRequestId === crid,
      );
    await vi.waitFor(
      async () => {
        if ((await docAudit()).length < 1) throw new Error("audit chưa ghi");
      },
      { timeout: 5_000, interval: 50 },
    );
    await cho(200);
    const rows = await docAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: "machine", entityId: String(fx.mA1) });
  }, 10_000);

  it("★★★ CÙNG người, cờ BẬT ⇒ thủ tục KHÁC vẫn FORBIDDEN / MUST_CHANGE_PASSWORD: scadaKenh.cheDo.danhSach (đọc), scadaKenh.danhSach (đọc), scadaCommands.request (ghi)", async () => {
    await datCo(goc.op.id, true);
    expect(await loiCua(goc.op.caller.scadaKenh.cheDo.danhSach())).toMatchObject({ code: "FORBIDDEN", appCode: "MUST_CHANGE_PASSWORD" });
    expect(await loiCua(goc.op.caller.scadaKenh.danhSach({ adapterId: fx.a1 }))).toMatchObject({ code: "FORBIDDEN", appCode: "MUST_CHANGE_PASSWORD" });
    expect(
      await loiCua(goc.op.caller.scadaCommands.request({ adapterId: fx.a1, tagKey: "stop_cmd", value: true, lyDo: "thu cong doi mat khau", clientRequestId: crypto.randomUUID() } as never)),
    ).toMatchObject({ code: "FORBIDDEN", appCode: "MUST_CHANGE_PASSWORD" });
    // đối chứng trong cùng ca: thủ tục miễn vẫn đi qua
    expect((await goc.op.caller.scadaCommands.mayDungKhanCap()).may).toHaveLength(2);
  }, 10_000);

  it("★★★ đối chứng — người KHÔNG cờ ⇒ CÙNG danh sách", async () => {
    await datCo(goc.op.id, true);
    const coCo = await goc.op.caller.scadaCommands.mayDungKhanCap();
    await datCo(goc.op.id, false);
    const khongCo = await goc.op.caller.scadaCommands.mayDungKhanCap();
    expect(khongCo).toEqual(coCo);
  }, 10_000);
});

describe("★★★ chỉ người CÓ QUYỀN DỪNG thấy máy (sàn vai mức 1 + machine_control.canEdit) — không ném, rỗng", () => {
  it("★★★ viewer (có canEdit) cờ BẬT ⇒ rỗng", async () => {
    await datCo(goc.viewer.id, true);
    expect(await goc.viewer.caller.scadaCommands.mayDungKhanCap()).toEqual({ may: [], biCat: false });
  }, 10_000);

  it("★★ operator THIẾU machine_control.canEdit ⇒ rỗng (cờ bật và không cờ)", async () => {
    await datCo(goc.opKhongSua.id, true);
    expect(await goc.opKhongSua.caller.scadaCommands.mayDungKhanCap()).toEqual({ may: [], biCat: false });
    await datCo(goc.opKhongSua.id, false);
    expect(await goc.opKhongSua.caller.scadaCommands.mayDungKhanCap()).toEqual({ may: [], biCat: false });
  }, 10_000);

  it("★★ SCADA_COMMANDS_ENABLED tắt ⇒ rỗng", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "false");
    expect(await goc.op.caller.scadaCommands.mayDungKhanCap()).toEqual({ may: [], biCat: false });
  }, 10_000);
});

describe("★★★ điều kiện 6 / ruling C6 — danh sách bị CẮT: TRẦN + 1 hàng + biCat", () => {
  it(`★★★ ${TRAN_MAY_DUNG_KHAN_CAP + 1} máy có nối trong phạm vi ⇒ trả ${TRAN_MAY_DUNG_KHAN_CAP + 1} hàng, biCat = true, thứ tự mã máy`, async () => {
    expect(TRAN_MAY_DUNG_KHAN_CAP).toBe(200);
    await datCo(goc.opC.id, true);
    const kq = await goc.opC.caller.scadaCommands.mayDungKhanCap();
    expect(kq.may).toHaveLength(TRAN_MAY_DUNG_KHAN_CAP + 1);
    expect(kq.biCat).toBe(true);
    expect(kq.may[0].ten).toBe(`${RUN}c001 · May C 1`);
    expect(kq.may[TRAN_MAY_DUNG_KHAN_CAP].ten).toBe(`${RUN}c201 · May C 201`);
    // adapter TẮT ⇒ không adapter nào nhận STOP HMI
    expect(kq.may.every((m) => m.coDung === false && m.soAdapter === 0)).toBe(true);
  }, 10_000);
});

describe("★★ hạn 3 s trên THÂN (ruling C16)", () => {
  it(`phạm vi chờ 3500 ms ⇒ SERVICE_UNAVAILABLE / OPERATION_FAILED {operation: mayDungKhanCap} sau ~${HAN_DANH_SACH_DUNG_KHAN_CAP_MS} ms`, async () => {
    expect(HAN_DANH_SACH_DUNG_KHAN_CAP_MS).toBe(3000);
    H.phamViCho = 3_500;
    const batDau = Date.now();
    const e = await loiCua(goc.op.caller.scadaCommands.mayDungKhanCap());
    const troi = Date.now() - batDau;
    expect(e).toEqual({ code: "SERVICE_UNAVAILABLE", appCode: "OPERATION_FAILED", appParams: { operation: "mayDungKhanCap" } });
    expect(troi).toBeGreaterThanOrEqual(HAN_DANH_SACH_DUNG_KHAN_CAP_MS - 50);
    expect(troi).toBeLessThan(HAN_DANH_SACH_DUNG_KHAN_CAP_MS + 800);
    await cho(700); // lượt phạm vi bị bỏ rơi chạy xong trước ca kế
  }, 10_000);
});
