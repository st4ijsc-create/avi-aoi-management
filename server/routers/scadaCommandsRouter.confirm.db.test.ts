/**
 * SCADA R1a Task 9 — `scadaCommands.confirm` / `huy` / `trangThai` (K1, K6, K8, K9) trên CSDL `_test` THẬT.
 *
 * Đường ghi THẬT tới thiết bị: dispatcher THẬT (cổng binding requireBoundAction, cổng chế độ 3c, cổng interlock, đặt chỗ ghi trước +
 * CAS confirmed→executed, đọc lại bắt buộc `docLai:"bat_buoc"`), thiết bị = StubDriver THẬT (RAM; `simDatLoi({giaTri})` ép giá trị đọc
 * lại) trả qua `getActiveDriver` giả cho ĐÚNG adapter của tệp. `OT_CONTROL_ENABLED=true` CHỈ trong tiến trình test; nguồn safety-PLC giả
 * báo OK (cùng khuôn `commandDispatcher.dot1b.db.test.ts:27-42`); `OT_COMMISSIONING_REQUIRED=false`.
 *
 * Oracle độc lập với mã sản phẩm: số lần thiết bị bị ghi (`writeTags` của stub đếm), số lần `dispatch()` được gọi (bọc), hàng
 * `command_log` theo `actionId`, hàng `scada_command_attempts` theo request, hàng khoá `scada_khoa_chon`.
 *
 * `command_log` + `scada_command_attempts` là WORM: hàng của tệp này ở lại (đúng thiết kế).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

const RUN = `r1a9${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => ({
  emits: [] as Array<{ room: string; ev: string; payload: Record<string, unknown> }>,
  drivers: new Map<number, unknown>(),
  writeCalls: 0,
  dispatchCalls: 0,
  /** R1a final I-2 — đầu vào của mỗi lần dispatch() (kiểm queueTtlMs / deadlineMs) */
  dispatchInputs: [] as Array<Record<string, unknown>>,
  dispatchNem: false,
  /** chạy MỘT lần bên trong lệnh ghi thiết bị kế tiếp (giữa "kiểm khoá" và "hết dispatch") */
  trongKhiGhi: null as null | (() => Promise<void>),
  /** fix round 1 — chạy MỘT lần ngay sau `giaHanKhoaChon` thật (giữa bước 5 và CAS bước 6) */
  sauGiaHan: null as null | (() => Promise<void>),
  /** fix round 1 — thay dispatch: mô phỏng "đặt chỗ đã CAS confirmed→executed rồi bị từ chối không gửi" (QUEUE_EXPIRED) */
  tuChoiSauDatCho: false,
  /** fix round 2 — làm câu UPDATE chốt dòng chờ SAU dispatch ném lỗi (status executed / bi_tu_choi_ghi qua `db`, không qua tx) */
  chotNem: false,
}));

// fix round 2 — getDb THẬT bọc Proxy: khi `H.chotNem`, `db.update(ai_pending_actions).set({status: executed|bi_tu_choi_ghi})` NÉM
// (mô phỏng lỗi DB đúng ở bước chốt). Đặt chỗ của dispatcher chạy trong `tx` (không qua Proxy) nên không bị ảnh hưởng.
vi.mock("../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db/connection")>();
  const { aiPendingActions: bang } = await import("../../drizzle/schema");
  return {
    ...real,
    getDb: async () => {
      const d = await real.getDb();
      if (!d) return d;
      return new Proxy(d, {
        get(t, p) {
          if (p === "update") {
            return (tbl: unknown) => {
              const b = (t as any).update(tbl);
              if (tbl !== bang) return b;
              return new Proxy(b, {
                get(bt, bp) {
                  if (bp === "set") {
                    return (v: { status?: string }) => {
                      if (H.chotNem && (v?.status === "executed" || v?.status === "bi_tu_choi_ghi")) throw new Error("r1a9: chot nem (mo phong loi DB)");
                      return (bt as any).set(v);
                    };
                  }
                  const x = Reflect.get(bt, bp, bt);
                  return typeof x === "function" ? x.bind(bt) : x;
                },
              });
            };
          }
          const x = Reflect.get(t, p, t);
          return typeof x === "function" ? x.bind(t) : x;
        },
      });
    },
  };
});

vi.mock("../services/scada/khoaChon", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/scada/khoaChon")>();
  return {
    ...real,
    giaHanKhoaChon: async (...a: Parameters<typeof real.giaHanKhoaChon>) => {
      const kq = await real.giaHanKhoaChon(...a);
      const moc = H.sauGiaHan;
      if (moc) {
        H.sauGiaHan = null;
        await moc();
      }
      return kq;
    },
  };
});

vi.mock("../_core/socket", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/socket")>();
  return {
    ...real,
    getIO: () =>
      ({
        to: (room: string) => ({
          emit: (ev: string, payload: Record<string, unknown>) => {
            H.emits.push({ room, ev, payload });
            return true;
          },
        }),
      }) as never,
  };
});

// Nguồn safety-PLC nền của facade THẬT: một PLC "thật" đọc sạch (OK) — như dot1b.
vi.mock("../services/safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [
      { code: "R1A9-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
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
  };
});

vi.mock("../services/ot/commandDispatcher", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/commandDispatcher")>();
  return {
    ...real,
    dispatch: async (...a: Parameters<typeof real.dispatch>) => {
      H.dispatchCalls += 1;
      H.dispatchInputs.push(a[0] as unknown as Record<string, unknown>);
      if (H.dispatchNem) throw new Error("r1a9: dispatch nem (mo phong loi ha tang)");
      if (H.tuChoiSauDatCho) {
        const { getDb: g } = await import("../db/connection");
        const { sql: q } = await import("drizzle-orm");
        const d = await g();
        const id = (a[0].triggeredBy as { actionId?: string }).actionId;
        await d!.execute(q`UPDATE ai_pending_actions SET status = 'executed', "executedAt" = now() WHERE id = ${id} AND status = 'confirmed'`);
        return { ok: false, simulated: false, status: "rejected" as const, reason: "QUEUE_EXPIRED", results: [], commandLogIds: [] };
      }
      return real.dispatch(...a);
    },
  };
});

import { getDb } from "../db/connection";
import { aiPendingActions } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import speakeasy from "speakeasy";
import { setup2FA, enable2FA } from "../db/auth";
import { StubDriver } from "../services/ot/drivers/stubDriver";

/** StubDriver THẬT + bộ đếm lần ghi + móc chạy giữa lệnh ghi. */
class StubDem extends StubDriver {
  override async writeTags(writes: Array<{ tagKey: string; address: string; value: unknown }>) {
    H.writeCalls += 1;
    const moc = H.trongKhiGhi;
    if (moc) {
      H.trongKhiGhi = null;
      await moc();
    }
    return super.writeTags(writes);
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Router = typeof import("./scadaCommandsRouter").scadaCommandsRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let scadaCommandsRouter: Router;
let boDem: typeof import("../services/scada/boDemHienTai");
let lenhHmi: typeof import("../services/scada/lenhHmi");
let stub!: StubDem;

let A!: { fid: number; mid: number; code: string };
let B!: { fid: number; mid: number; code: string };
const ad = { a: 0 };
const ma = { a: `${RUN}-a` };
let edgeNodeId = 0;
const factories: string[] = [];
const userIds: number[] = [];
const ruleIds: number[] = [];
const nguoi: Record<string, { id: number; role: "operator" | "engineer"; caller: Caller }> = {};

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

async function seedNhaMay(ten: string) {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${"May " + ten.toUpperCase()}, 'AOI', true) RETURNING id`,
  );
  factories.push(code);
  return { fid: Number(f.id), mid: Number(m.id), code };
}

async function seedTag(adapterId: number, key: string, o: { kind?: string; writable?: boolean; level?: number | null; dataType?: string } = {}) {
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", unit, writable, "isEnabled",
      channel_kind, display_name, write_min, write_max, write_step, actuation_level)
    VALUES (${adapterId}, ${key}, ${"DB1." + key}, ${o.dataType ?? "float"}, ${"°C"}, ${o.writable ?? true}, true,
      ${o.kind ?? "input_output"}::scada_channel_kind, ${"Kenh " + key}, 0, 300, 0.5, ${o.level === undefined ? 3 : o.level})`);
}

async function seedNguoi(ten: string, role: "operator" | "engineer", factoryCode: string): Promise<void> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "r1a9", ts: RUN, ten: `R1A9 ${ten}` });
  userIds.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${factoryCode})`);
  await dung(
    sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`,
  );
  nguoi[ten] = { id: u.id, role, caller: scadaCommandsRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never) };
}

type Loi = { code?: string; message?: string; appCode?: string; appParams?: Record<string, unknown> };
async function loiCua(p: Promise<unknown>): Promise<Loi> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, message: x.message, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

const LY_DO = "chinh nhiet theo phieu";
const uuid = () => crypto.randomUUID();
function mauOt(tagKey: string, value: number) {
  return { tagKey, raw: value, value, quality: "good" as const, timestamp: new Date() };
}

async function yeuCau(ten: string, tagKey: string, value: number | string = 200): Promise<string> {
  const kq = await nguoi[ten].caller.request({ adapterId: ad.a, tagKey, value, lyDo: LY_DO, clientRequestId: uuid() });
  return kq.requestId;
}

type DongLenh = { id: number; status: string; tagKey: string; readBackValue: unknown; errorText: string | null; ledger: string | null };
async function dongLenh(requestId: string): Promise<DongLenh[]> {
  return (await dung(sql`SELECT id, status::text AS status, "tagKey", "readBackValue", "errorText", "ackValue"->>'ledger' AS ledger
    FROM command_log WHERE "actionId" = ${requestId} ORDER BY id`)) as DongLenh[];
}
async function trangThaiCho(requestId: string): Promise<string> {
  const [r] = await dung(sql`SELECT status::text AS s FROM ai_pending_actions WHERE id = ${requestId}`);
  return r?.s;
}
async function khoa(tagKey: string): Promise<{ user_id: number; request_id: string; expires_at: Date } | undefined> {
  const [r] = await dung(sql`SELECT user_id, request_id, expires_at FROM scada_khoa_chon WHERE adapter_id = ${ad.a} AND tag_key = ${tagKey}`);
  return r;
}
type DongThu = { stage: string; outcome: string; reason_code: string | null; command_log_ids: number[] | null; user_id: number; request_id: string | null };
async function thuCua(requestId: string): Promise<DongThu[]> {
  return (await dung(sql`SELECT stage, outcome, reason_code, command_log_ids, user_id, request_id
    FROM scada_command_attempts WHERE request_id = ${requestId} ORDER BY id`)) as DongThu[];
}
async function moc(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM scada_command_attempts`);
  return Number(r.m);
}
async function thuSau(m: number, userId: number): Promise<DongThu[]> {
  return (await dung(sql`SELECT stage, outcome, reason_code, command_log_ids, user_id, request_id
    FROM scada_command_attempts WHERE id > ${m} AND user_id = ${userId} ORDER BY id`)) as DongThu[];
}

/** Một lần `confirm` bị từ chối TRƯỚC dispatch: đúng mã + một dòng attempts {confirm, rejected|expired, reason} + dispatch 0 lần. */
async function tuChoiXacNhan(
  ten: string,
  requestId: string,
  mong: { code: string; appCode: string; reason: string; outcome?: string },
  totpCode?: string,
): Promise<Loi> {
  const truoc = H.dispatchCalls;
  const m = await moc();
  const loi = await loiCua(nguoi[ten].caller.confirm({ requestId, ...(totpCode !== undefined ? { totpCode } : {}) }));
  expect(loi.code, JSON.stringify(loi)).toBe(mong.code);
  expect(loi.appCode).toBe(mong.appCode);
  expect(loi.appParams).toMatchObject({ ma: mong.reason });
  const dong = await thuSau(m, nguoi[ten].id);
  expect(dong, "đúng MỘT dòng attempts").toHaveLength(1);
  expect(dong[0]).toMatchObject({ stage: "confirm", outcome: mong.outcome ?? "rejected", reason_code: mong.reason });
  expect(H.dispatchCalls - truoc, "dispatch KHÔNG được gọi").toBe(0);
  expect(await dongLenh(requestId), "không hàng command_log nào").toHaveLength(0);
  return loi;
}

beforeAll(async () => {
  vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("OT_CONTROL_ENABLED", "true");
  vi.stubEnv("OT_COMMISSIONING_REQUIRED", "false");
  vi.stubEnv("OT_READBACK_ENABLED", "false"); // đường HMI vẫn đọc lại (docLai bat_buoc)
  vi.stubEnv("OT_CMD_SERIALIZE_ENABLED", "false");
  vi.stubEnv("SEC_PLATFORM", "false");
  vi.stubEnv("UNS_CMD_ACK_ENABLED", "false");
  vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "false");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  ({ scadaCommandsRouter } = await import("./scadaCommandsRouter"));
  boDem = await import("../services/scada/boDemHienTai");
  lenhHmi = await import("../services/scada/lenhHmi");

  A = await seedNhaMay("a");
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${A.mid}, ${ma.a}, ${ma.a}, 'stub', ${"stub://" + ma.a}, 60000, true, 'disabled') RETURNING id`);
  ad.a = Number(r.id);
  const [n] = await dung(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${RUN + "-en"}, 'r1a9 edge', 'offline') RETURNING id`);
  edgeNodeId = Number(n.id);

  await seedTag(ad.a, "che_do", { kind: "input", writable: false, level: null, dataType: "int" });
  for (const key of ["vui", "lech", "het", "song", "local", "tat", "edge", "len", "il", "otoff", "huy", "chiem", "nem", "treo", "tt",
    "maydoi", "khoamat", "hep", "san", "casmiss", "cashet", "qexp", "chot1", "chot2", "conlai1", "conlai30"]) {
    await seedTag(ad.a, key, { level: 3 });
  }
  await seedTag(ad.a, "m5", { level: 5 });
  await seedTag(ad.a, "m5khoa", { level: 5 }); // R1a T16
  await seedTag(ad.a, "m5local", { level: 5 }); // R1a final M-3

  await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by)
    VALUES (${A.mid}, ${ad.a}, 'che_do', '2'::jsonb, 1)`);
  boDem.datThongTinAdapter(ad.a, { pollMs: 60_000, coDeadband: false, machineId: A.mid, code: ma.a });
  boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 2)]);

  stub = new StubDem();
  await stub.connect({ endpoint: `stub://${RUN}` } as never);
  H.drivers.set(ad.a, stub);

  await seedNguoi("opA", "operator", A.code);
  await seedNguoi("opA2", "operator", A.code);
  await seedNguoi("engA", "engineer", A.code);
  B = await seedNhaMay("b");
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${nguoi.opA.id}, ${B.code})`);
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  try {
    boDem?.xoaAdapter(ad.a);
  } catch {
    /* bỏ qua */
  }
  try {
    await stub?.disconnect();
  } catch {
    /* bỏ qua */
  }
  if (!db) return;
  try {
    for (const id of ruleIds) await dung(sql`DELETE FROM interlock_rules WHERE id = ${id}`);
    for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool = 'hmi.write_tag'`);
    for (const id of userIds) await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${id}`); // R1a T16
    if (ad.a) {
      await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${ad.a}`);
      await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${A.mid}`);
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${ad.a}`);
      await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ad.a}`);
      await dung(sql`DELETE FROM device_adapters WHERE id = ${ad.a}`);
    }
    if (edgeNodeId) await dung(sql`DELETE FROM edge_nodes WHERE id = ${edgeNodeId}`);
    for (const code of factories) {
      await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`);
      await dung(sql`DELETE FROM machines WHERE code = ${code}`);
      await dung(sql`DELETE FROM stations WHERE code = ${code}`);
      await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
      await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
      await dung(sql`DELETE FROM factories WHERE code = ${code}`);
    }
  } catch (e) {
    console.warn("[r1a9] dọn dữ liệu:", (e as Error).message);
  }
}, 60_000);

describe("confirm — đường vui (dispatch hitl hmi.write_tag, đọc lại bắt buộc)", () => {
  it("operator + mức 3 ⇒ acked_verified, 1 ý định + 1 kết quả, dòng chờ executed, khoá đã nhả, attempts confirmed + dispatched, scada:cmd", async () => {
    const u = nguoi.opA;
    const requestId = await yeuCau("opA", "vui", "245");
    H.emits.length = 0;
    const ghiTruoc = H.writeCalls;
    const kq = await u.caller.confirm({ requestId });
    expect(kq).toMatchObject({ status: "acked_verified", ok: true, simulated: false, readBackValue: 245 });
    expect(kq.reason).toBeUndefined();
    expect(H.writeCalls - ghiTruoc).toBe(1);

    const dong = await dongLenh(requestId);
    expect(dong.map((d) => [d.ledger, d.status])).toEqual([
      ["intent", "sent"],
      ["result", "acked_verified"],
    ]);
    expect(kq.commandLogIds).toEqual([dong[1].id]);
    expect(dong[1].readBackValue).toBe(245);
    expect(await trangThaiCho(requestId)).toBe("executed");
    expect(await khoa("vui")).toBeUndefined();

    const thu = await thuCua(requestId);
    expect(thu.map((t) => [t.stage, t.outcome])).toEqual([
      ["request", "proposed"],
      ["confirm", "confirmed"],
      ["dispatch", "dispatched"],
    ]);
    expect(thu[2].command_log_ids?.map(Number)).toEqual([dong[1].id]);
    expect(thu[2].reason_code).toBeNull();

    expect(H.emits.every((e) => e.room === `user:${u.id}` && e.ev === "scada:cmd")).toBe(true);
    expect(H.emits.map((e) => e.payload.status)).toEqual(["confirmed", "acked_verified"]);
    expect(H.emits[1].payload).toMatchObject({ requestId, status: "acked_verified", at: expect.any(String), readBackValue: 245 });
  });

  it("Review Focus 5 — đọc lại lệch (stub ép 245 sau khi ghi 200) ⇒ acked_unverified, readBackValue 245, ok giữ true", async () => {
    const requestId = await yeuCau("opA", "lech", 200);
    stub.simDatLoi({ giaTri: { lech: 245 } });
    try {
      const kq = await nguoi.opA.caller.confirm({ requestId });
      expect(kq).toMatchObject({ status: "acked_unverified", ok: true, simulated: false, readBackValue: 245 });
      const dong = await dongLenh(requestId);
      expect(dong.at(-1)).toMatchObject({ status: "acked_unverified", readBackValue: 245 });
      expect(H.emits.at(-1)?.payload).toMatchObject({ status: "acked_unverified", readBackValue: 245 });
    } finally {
      stub.simDatLoi({});
    }
  });
});

describe("confirm — hết TTL, đã xử lý, song song", () => {
  it("hết TTL ⇒ HET_HAN, dispatch 0 lần, dòng chờ expired, khoá nhả, attempts expired/HET_HAN", async () => {
    const requestId = await yeuCau("opA", "het");
    await db.update(aiPendingActions).set({ expiresAt: new Date(Date.now() - 5_000) }).where(eq(aiPendingActions.id, requestId));
    H.emits.length = 0;
    await tuChoiXacNhan("opA", requestId, {
      code: "PRECONDITION_FAILED",
      appCode: "SCADA_REQUEST_EXPIRED",
      reason: "HET_HAN",
      outcome: "expired",
    });
    expect(await trangThaiCho(requestId)).toBe("expired");
    expect(await khoa("het")).toBeUndefined();
    expect(H.emits.map((e) => e.payload)).toEqual([{ requestId, status: "expired", at: expect.any(String), reason: "HET_HAN" }]);
  });

  it("★ R1a final I-2 — còn 1 s (< 3000 ms) ⇒ HET_HAN, dispatch 0 lần, dòng chờ expired, khoá nhả, attempts expired/HET_HAN", async () => {
    const requestId = await yeuCau("opA", "conlai1");
    await db.update(aiPendingActions).set({ expiresAt: new Date(Date.now() + 1_000) }).where(eq(aiPendingActions.id, requestId));
    await tuChoiXacNhan("opA", requestId, { code: "PRECONDITION_FAILED", appCode: "SCADA_REQUEST_EXPIRED", reason: "HET_HAN", outcome: "expired" });
    expect(await trangThaiCho(requestId)).toBe("expired");
    expect(await khoa("conlai1")).toBeUndefined();
  });

  it("★ R1a final I-2 — còn 30 s ⇒ dispatch nhận queueTtlMs ≈ 30 000 (CHỈ hạn chờ) và KHÔNG deadlineMs (hạn ack/đọc lại = OT_CONTROL_TIMEOUT_MS)", async () => {
    const requestId = await yeuCau("opA", "conlai30");
    await db.update(aiPendingActions).set({ expiresAt: new Date(Date.now() + 30_000) }).where(eq(aiPendingActions.id, requestId));
    const truoc = H.dispatchInputs.length;
    const kq = await nguoi.opA.caller.confirm({ requestId });
    expect(kq).toMatchObject({ ok: true, status: "acked_verified" });
    expect(H.dispatchInputs.length - truoc).toBe(1);
    const vao = H.dispatchInputs.at(-1)!;
    expect(vao.queueTtlMs).toBeGreaterThan(27_000);
    expect(vao.queueTtlMs).toBeLessThanOrEqual(30_000);
    expect(Number.isInteger(vao.queueTtlMs)).toBe(true);
    expect("deadlineMs" in vao, "HMI KHÔNG truyền deadlineMs (nếu truyền, hạn ack = thời gian còn lại)").toBe(false);
    const [dong] = await dung(sql`SELECT deadline_ms FROM command_log WHERE "actionId" = ${requestId} ORDER BY id LIMIT 1`);
    expect(dong.deadline_ms).toBeNull();
  });

  it("Review Focus 1 — hai confirm song song cùng requestId ⇒ một ok, một DA_XU_LY, đúng MỘT ý định, thiết bị bị ghi đúng 1 lần", async () => {
    const requestId = await yeuCau("opA", "song");
    const ghiTruoc = H.writeCalls;
    const dispTruoc = H.dispatchCalls;
    const goi = () => nguoi.opA.caller.confirm({ requestId });
    const kq = await Promise.allSettled([goi(), goi()]);
    const ok = kq.filter((k) => k.status === "fulfilled");
    const loi = kq.filter((k): k is PromiseRejectedResult => k.status === "rejected");
    expect(ok, JSON.stringify(kq.map((k) => (k.status === "rejected" ? String(k.reason) : k.value)))).toHaveLength(1);
    expect((ok[0] as PromiseFulfilledResult<{ ok: boolean; status: string }>).value).toMatchObject({ ok: true, status: "acked_verified" });
    expect(loi).toHaveLength(1);
    expect((loi[0].reason as { cause?: { appCode?: string } }).cause?.appCode).toBe("SCADA_REQUEST_ALREADY_HANDLED");
    const dong = await dongLenh(requestId);
    expect(dong.filter((d) => d.ledger === "intent")).toHaveLength(1);
    expect(H.writeCalls - ghiTruoc).toBe(1);
    expect(H.dispatchCalls - dispTruoc).toBe(1);
    const thu = await thuCua(requestId);
    expect(thu.filter((t) => t.reason_code === "DA_XU_LY")).toHaveLength(1);
    expect(await khoa("song")).toBeUndefined();
  });

  it("confirm yêu cầu của NGƯỜI KHÁC ⇒ NOT_FOUND (giống hệt requestId không tồn tại), không chạm dòng chờ", async () => {
    const requestId = await yeuCau("opA", "tt");
    const l1 = await tuChoiXacNhan("opA2", requestId, { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", reason: "NOT_FOUND" });
    const l2 = await tuChoiXacNhan("opA2", uuid(), { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", reason: "NOT_FOUND" });
    expect(l1).toEqual(l2);
    expect(l1.appParams).toMatchObject({ entity: "scadaRequest" });
    expect(await trangThaiCho(requestId)).toBe("proposed");
    expect((await khoa("tt"))?.request_id).toBe(requestId);
  });
});

describe("Review Focus 2 — dữ liệu đổi giữa request và confirm ⇒ từ chối đúng mã, khoá nhả, có attempts, dispatch 0 lần", () => {
  it("máy chuyển LOCAL ⇒ MODE_LOCAL (lyDo khac_remote)", async () => {
    const requestId = await yeuCau("opA", "local");
    boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 1)]);
    try {
      const loi = await tuChoiXacNhan("opA", requestId, { code: "PRECONDITION_FAILED", appCode: "SCADA_MACHINE_NOT_REMOTE", reason: "MODE_LOCAL" });
      expect(loi.appParams).toMatchObject({ lyDo: "khac_remote" });
    } finally {
      boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 2)]);
    }
    expect(await khoa("local")).toBeUndefined();
    expect(await trangThaiCho(requestId)).toBe("denied");
  });

  it("tag bị tắt ⇒ NOT_FOUND (deviceTag)", async () => {
    const requestId = await yeuCau("opA", "tat");
    await dung(sql`UPDATE device_tags SET "isEnabled" = false WHERE "adapterId" = ${ad.a} AND "tagKey" = 'tat'`);
    const loi = await tuChoiXacNhan("opA", requestId, { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", reason: "NOT_FOUND" });
    expect(loi.appParams).toMatchObject({ entity: "deviceTag" });
    expect(await khoa("tat")).toBeUndefined();
  });

  it("adapter chuyển sang edge ⇒ EDGE_CHUA_HO_TRO", async () => {
    const requestId = await yeuCau("opA", "edge");
    await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id = ${ad.a}`);
    try {
      const loi = await tuChoiXacNhan("opA", requestId, { code: "PRECONDITION_FAILED", appCode: "SCADA_EDGE_NOT_SUPPORTED", reason: "EDGE_CHUA_HO_TRO" });
      expect(loi.appParams).toMatchObject({ edgeCode: `${RUN}-en` });
    } finally {
      await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ad.a}`);
    }
    expect(await khoa("edge")).toBeUndefined();
  });

  it("★ khoá bị chiếm KHÔNG được giữa lúc kiểm khoá và lúc dispatch xong: B (đồng hồ +61 s, quá hạn khoá gốc) gặp DANG_DUOC_CHON", async () => {
    const requestId = await yeuCau("opA", "chiem");
    const goc = await khoa("chiem");
    expect(goc?.request_id).toBe(requestId);
    let kqB: Awaited<ReturnType<typeof lenhHmi.yeuCauGhiTag>> | null = null;
    H.trongKhiGhi = async () => {
      // B ra yêu cầu trên CÙNG kênh khi A đang ghi; đồng hồ của B đã qua hạn khoá gốc (TTL 60 s của yêu cầu A).
      kqB = await lenhHmi.yeuCauGhiTag(
        { user: { id: nguoi.opA2.id, role: "operator", twoFactorEnabled: true } },
        { userId: nguoi.opA2.id, userRole: "operator" },
        { adapterId: ad.a, tagKey: "chiem", value: 100, lyDo: LY_DO, clientRequestId: uuid() },
        new Date(new Date(goc!.expires_at).getTime() + 1_000),
      );
    };
    try {
      const kq = await nguoi.opA.caller.confirm({ requestId });
      expect(kq).toMatchObject({ ok: true, status: "acked_verified" });
    } finally {
      H.trongKhiGhi = null;
    }
    expect(kqB, "móc trong lệnh ghi đã chạy").not.toBeNull();
    expect(kqB!.ok, JSON.stringify(kqB)).toBe(false);
    expect((kqB as unknown as { tuChoi: { ma: string; boiUserId: number } }).tuChoi).toMatchObject({ ma: "DANG_DUOC_CHON", boiUserId: nguoi.opA.id });
    expect(await khoa("chiem"), "A nhả khoá sau dispatch").toBeUndefined();
  });
});

describe("2FA theo mức — mức lấy từ tag HIỆN TẠI", () => {
  it("mức 5 thiếu mã ⇒ TOTP_CAN, dòng chờ VẪN proposed, khoá VẪN giữ (thử lại trong TTL)", async () => {
    const requestId = await yeuCau("engA", "m5");
    const loi = await tuChoiXacNhan("engA", requestId, { code: "PRECONDITION_FAILED", appCode: "SCADA_TOTP_REQUIRED", reason: "TOTP_CAN" });
    expect(loi.appParams).toMatchObject({ level: 5 });
    expect(await trangThaiCho(requestId)).toBe("proposed");
    expect((await khoa("m5"))?.request_id).toBe(requestId);
    // mã sai định dạng ⇒ TOTP_SAI (không gọi verify), vẫn proposed
    await tuChoiXacNhan("engA", requestId, { code: "PRECONDITION_FAILED", appCode: "SCADA_TOTP_INVALID", reason: "TOTP_SAI" }, "12ab56");
    expect(await trangThaiCho(requestId)).toBe("proposed");
  });

  it("mức tag nâng 3 → 5 giữa request và confirm ⇒ cần mã (TOTP_CAN), không dispatch", async () => {
    const requestId = await yeuCau("engA", "len");
    await dung(sql`UPDATE device_tags SET actuation_level = 5 WHERE "adapterId" = ${ad.a} AND "tagKey" = 'len'`);
    const loi = await tuChoiXacNhan("engA", requestId, { code: "PRECONDITION_FAILED", appCode: "SCADA_TOTP_REQUIRED", reason: "TOTP_CAN" });
    expect(loi.appParams).toMatchObject({ level: 5 });
    expect(await trangThaiCho(requestId)).toBe("proposed");
  });
});

describe("R1a T16 — bộ đếm TOTP sai (chung mọi bên gọi TOTP)", () => {
  it("engA đang TẠM KHOÁ TOTP ⇒ mã ĐÚNG vẫn bị TOTP_TAM_KHOA {ma, level, remainingMinutes}; KẾT THÚC yêu cầu (denied, khoá chọn nhả), dispatch 0", async () => {
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    await setup2FA(nguoi.engA.id, secret);
    await enable2FA(nguoi.engA.id);
    await dung(sql`INSERT INTO totp_khoa_sai (user_id, loai, so_lan_sai, cua_so_bat_dau, khoa_den)
      VALUES (${nguoi.engA.id}, 'totp', 5, now(), now() + interval '4 minutes')`);
    try {
      const requestId = await yeuCau("engA", "m5khoa");
      const maDung = speakeasy.totp({ secret, encoding: "base32" });
      const loi = await tuChoiXacNhan("engA", requestId, { code: "TOO_MANY_REQUESTS", appCode: "TOTP_TAM_KHOA", reason: "TOTP_TAM_KHOA" }, maDung);
      expect(loi.appParams).toMatchObject({ ma: "TOTP_TAM_KHOA", level: 5, remainingMinutes: 4 });
      expect(Object.keys(loi.appParams ?? {}).sort(), "không lộ số lần sai").toEqual(["level", "ma", "remainingMinutes"]);
      expect(await trangThaiCho(requestId)).toBe("denied");
      expect(await khoa("m5khoa"), "khoá 5 phút > TTL 60 s ⇒ nhả khoá chọn cho người khác").toBeUndefined();
      const [tieu] = await dung(sql`SELECT count(*)::int AS n FROM totp_consumed WHERE "userId" = ${nguoi.engA.id}`);
      expect(Number(tieu.n), "đang khoá ⇒ mã không bị tiêu").toBe(0);
    } finally {
      await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${nguoi.engA.id}`);
    }
  });
});

describe("dispatch quyết — interlock, OT tắt, quá hạn ack, ném lỗi", () => {
  it("interlock nhắm adapter này thiếu dữ liệu ⇒ rejected INTERLOCK_BLOCKED, command_log có thieu_du_lieu, thiết bị 0 lần", async () => {
    const [r] = await dung(sql`INSERT INTO interlock_rules
        (name, scope, "machineId", "sourceType", "sourceKey", "comparisonOperator", threshold, "windowSize", "windowSeconds",
         action, "targetMachineId", "targetAdapterId", enabled, "approvedBy")
      VALUES (${RUN + "-il"}, 'machine', ${A.mid}, 'telemetry_tag', ${RUN + "-khong-co"}, 'gt', 80, 50, 300,
         'block_downstream', ${A.mid}, ${ad.a}, true, 1) RETURNING id`);
    ruleIds.push(Number(r.id));
    const requestId = await yeuCau("opA", "il");
    const ghiTruoc = H.writeCalls;
    try {
      const kq = await nguoi.opA.caller.confirm({ requestId });
      expect(kq).toMatchObject({ status: "rejected", ok: false, simulated: false, reason: "INTERLOCK_BLOCKED" });
    } finally {
      await dung(sql`UPDATE interlock_rules SET enabled = false WHERE id = ${r.id}`);
    }
    expect(H.writeCalls - ghiTruoc).toBe(0);
    const dong = await dongLenh(requestId);
    expect(dong).toHaveLength(1);
    expect(dong[0].status).toBe("rejected");
    expect(dong[0].errorText).toMatch(/^INTERLOCK_BLOCKED: .*thieu_du_lieu/);
    const thu = await thuCua(requestId);
    expect(thu.at(-1)).toMatchObject({ stage: "dispatch", outcome: "dispatched", reason_code: "INTERLOCK_BLOCKED" });
    expect(thu.at(-1)!.command_log_ids?.map(Number)).toEqual([dong[0].id]);
    expect(await khoa("il")).toBeUndefined();
    expect(await trangThaiCho(requestId)).toBe("bi_tu_choi_ghi");
  });

  it("OT_CONTROL_ENABLED tắt ⇒ simulated, simulated:true, thiết bị 0 lần", async () => {
    const requestId = await yeuCau("opA", "otoff");
    vi.stubEnv("OT_CONTROL_ENABLED", "false");
    const ghiTruoc = H.writeCalls;
    try {
      const kq = await nguoi.opA.caller.confirm({ requestId });
      expect(kq).toMatchObject({ status: "simulated", ok: true, simulated: true });
    } finally {
      vi.stubEnv("OT_CONTROL_ENABLED", "true");
    }
    expect(H.writeCalls - ghiTruoc).toBe(0);
    expect((await dongLenh(requestId)).map((d) => d.status)).toEqual(["simulated"]);
    expect(await trangThaiCho(requestId)).toBe("executed");
    expect(await khoa("otoff")).toBeUndefined();
  });

  it("dispatch() NÉM ⇒ attempts dispatch/rejected kèm mã, khoá nhả, lỗi KHÔNG bị nuốt", async () => {
    const requestId = await yeuCau("opA", "nem");
    H.dispatchNem = true;
    try {
      await expect(nguoi.opA.caller.confirm({ requestId })).rejects.toThrow(/dispatch nem/);
    } finally {
      H.dispatchNem = false;
    }
    const thu = await thuCua(requestId);
    expect(thu.at(-1)).toMatchObject({ stage: "dispatch", outcome: "rejected", reason_code: "DISPATCH_LOI" });
    expect(await khoa("nem")).toBeUndefined();
    expect(await trangThaiCho(requestId)).toBe("bi_tu_choi_ghi");
  });
});

describe("huy + trangThai", () => {
  it("người khác huy ⇒ NOT_FOUND; chủ huy ⇒ cancelled, khoá nhả, attempts huy/cancelled; confirm sau đó ⇒ DA_XU_LY", async () => {
    const requestId = await yeuCau("opA", "huy");
    const loi = await loiCua(nguoi.opA2.caller.huy({ requestId }));
    expect(loi).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "scadaRequest" } });
    expect(await trangThaiCho(requestId)).toBe("proposed");
    expect((await khoa("huy"))?.request_id).toBe(requestId);

    H.emits.length = 0;
    const kq = await nguoi.opA.caller.huy({ requestId });
    expect(kq).toEqual({ requestId, status: "cancelled" });
    expect(await trangThaiCho(requestId)).toBe("cancelled");
    expect(await khoa("huy")).toBeUndefined();
    const thu = await thuCua(requestId);
    expect(thu.at(-1)).toMatchObject({ stage: "huy", outcome: "cancelled", user_id: nguoi.opA.id });
    expect(H.emits).toEqual([{ room: `user:${nguoi.opA.id}`, ev: "scada:cmd", payload: { requestId, status: "cancelled", at: expect.any(String) } }]);

    await tuChoiXacNhan("opA", requestId, { code: "CONFLICT", appCode: "SCADA_REQUEST_ALREADY_HANDLED", reason: "DA_XU_LY" });
  });

  it("trangThai: chủ thấy dòng chờ + attempts + command_log theo actionId (không address/errorText); người khác ⇒ NOT_FOUND", async () => {
    const requestId = await yeuCau("opA", "vui", 120);
    await nguoi.opA.caller.confirm({ requestId });
    const tt = await nguoi.opA.caller.trangThai({ requestId });
    expect(tt.request).toMatchObject({ requestId, status: "executed", adapterId: ad.a, tagKey: "vui", value: 120 });
    expect(tt.attempts.map((t) => [t.stage, t.outcome])).toEqual([
      ["request", "proposed"],
      ["confirm", "confirmed"],
      ["dispatch", "dispatched"],
    ]);
    expect(tt.commandLog.map((c) => c.status)).toEqual(["sent", "acked_verified"]);
    expect(tt.commandLog[1]).toMatchObject({ tagKey: "vui", readBackValue: 120, requestedValue: 120 });
    for (const c of tt.commandLog) {
      expect(c).not.toHaveProperty("address");
      expect(c).not.toHaveProperty("errorText");
    }
    expect(JSON.stringify(tt)).not.toMatch(/stub:\/\/|__otPayloadHash/);

    const loi = await loiCua(nguoi.opA2.caller.trangThai({ requestId }));
    expect(loi).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "scadaRequest" } });
  });

  it("cờ SCADA_COMMANDS_ENABLED tắt ⇒ confirm/huy/trangThai FEATURE_DISABLED, không ghi attempts", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "false");
    try {
      const m = await moc();
      for (const goi of [
        () => nguoi.opA.caller.confirm({ requestId: uuid() }),
        () => nguoi.opA.caller.huy({ requestId: uuid() }),
        () => nguoi.opA.caller.trangThai({ requestId: uuid() }),
      ]) {
        expect(await loiCua(goi())).toMatchObject({ code: "FORBIDDEN", appCode: "FEATURE_DISABLED" });
      }
      expect(await thuSau(m, nguoi.opA.id)).toHaveLength(0);
    } finally {
      vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
    }
  });
});

describe("fix round 1 — máy đổi, mất khoá, dải hẹp, sàn vai, CAS trượt, từ chối sau đặt chỗ", () => {
  it("SECURITY — adapter gán sang máy khác (vẫn trong phạm vi) giữa request và confirm ⇒ MAY_DA_DOI, denied, khoá nhả, dispatch 0 lần", async () => {
    const requestId = await yeuCau("opA", "maydoi");
    await dung(sql`UPDATE device_adapters SET "machineId" = ${B.mid} WHERE id = ${ad.a}`);
    try {
      await tuChoiXacNhan("opA", requestId, { code: "PRECONDITION_FAILED", appCode: "SCADA_MACHINE_REBOUND", reason: "MAY_DA_DOI" });
    } finally {
      await dung(sql`UPDATE device_adapters SET "machineId" = ${A.mid} WHERE id = ${ad.a}`);
    }
    expect(await trangThaiCho(requestId)).toBe("denied");
    expect(await khoa("maydoi")).toBeUndefined();
  });

  it("Review Focus 2 — KHOA_MAT: opA yêu cầu R1 rồi R2 cùng kênh, confirm R1 ⇒ KHOA_MAT, R1 denied, khoá của R2 NGUYÊN VẸN, dispatch 0", async () => {
    const r1 = await yeuCau("opA", "khoamat", 100);
    const r2 = await yeuCau("opA", "khoamat", 120);
    const truoc = await khoa("khoamat");
    expect(truoc?.request_id).toBe(r2);
    await tuChoiXacNhan("opA", r1, { code: "CONFLICT", appCode: "SCADA_SELECTION_LOST", reason: "KHOA_MAT" });
    expect(await trangThaiCho(r1)).toBe("denied");
    expect(await khoa("khoamat")).toEqual(truoc);
    expect(await trangThaiCho(r2)).toBe("proposed");
  });

  it("dải bị hẹp lại (writeMax < giá trị yêu cầu) giữa request và confirm ⇒ OUT_OF_RANGE, denied, khoá nhả, dispatch 0", async () => {
    const requestId = await yeuCau("opA", "hep", 200);
    await dung(sql`UPDATE device_tags SET write_max = 150 WHERE "adapterId" = ${ad.a} AND "tagKey" = 'hep'`);
    const loi = await tuChoiXacNhan("opA", requestId, { code: "BAD_REQUEST", appCode: "SCADA_VALUE_OUT_OF_RANGE", reason: "OUT_OF_RANGE" });
    expect(loi.appParams).toMatchObject({ max: 150 });
    expect(await trangThaiCho(requestId)).toBe("denied");
    expect(await khoa("hep")).toBeUndefined();
  });

  it("minor 6 — mức nâng 3 → 4 làm operator dưới sàn ⇒ ROLE_FLOOR KẾT THÚC yêu cầu (denied, khoá nhả) — không giữ như TOTP", async () => {
    const requestId = await yeuCau("opA", "san");
    await dung(sql`UPDATE device_tags SET actuation_level = 4 WHERE "adapterId" = ${ad.a} AND "tagKey" = 'san'`);
    const loi = await tuChoiXacNhan("opA", requestId, { code: "FORBIDDEN", appCode: "SCADA_ROLE_FLOOR", reason: "ROLE_FLOOR" });
    expect(loi.appParams).toMatchObject({ level: 4 });
    expect(await trangThaiCho(requestId)).toBe("denied");
    expect(await khoa("san")).toBeUndefined();
  });

  it("minor 1 — dòng chờ bị dời sang 'expired' (expireStaleActions) giữa gia hạn khoá và CAS ⇒ HET_HAN, khoá vừa gia hạn ĐƯỢC NHẢ, dispatch 0", async () => {
    const requestId = await yeuCau("opA", "casmiss");
    H.sauGiaHan = async () => {
      await dung(sql`UPDATE ai_pending_actions SET status = 'expired' WHERE id = ${requestId}`);
    };
    H.emits.length = 0;
    try {
      await tuChoiXacNhan("opA", requestId, { code: "PRECONDITION_FAILED", appCode: "SCADA_REQUEST_EXPIRED", reason: "HET_HAN" });
    } finally {
      H.sauGiaHan = null;
    }
    expect(await khoa("casmiss")).toBeUndefined();
    // fix round 2 — đường "bị dời đi chỗ khác" cũng báo M5
    expect(H.emits.map((e) => [e.room, e.payload.status, e.payload.reason])).toEqual([[`user:${nguoi.opA.id}`, "expired", "HET_HAN"]]);
  });

  it("minor 2 (fix round 2) — TTL hết GIỮA bước 2 và CAS (đồng hồ trôi, KHÔNG sửa expiresAt) ⇒ CAS dùng đồng hồ đọc lại ⇒ HET_HAN sạch, dispatch 0", async () => {
    const requestId = await yeuCau("opA", "cashet");
    const [row] = await db.select({ e: aiPendingActions.expiresAt }).from(aiPendingActions).where(eq(aiPendingActions.id, requestId));
    // Gốc đồng hồ của lượt confirm = 3 040 ms TRƯỚC hạn ⇒ bước 2 qua (sàn còn lại 3 s — R1a final I-2); móc ngay trước CAS cho 150 ms
    // trôi ⇒ lúc CAS còn < 3 s (CAS đòi expiresAt > lúc CAS + 3 s) ⇒ trượt ⇒ HET_HAN qua đường CAS (móc chạy = đã tới bước 5).
    const nowDate = new Date(row.e.getTime() - 3_040);
    let mocDaChay = false;
    H.sauGiaHan = () =>
      new Promise((r) => {
        mocDaChay = true;
        setTimeout(r, 150);
      });
    const truoc = H.dispatchCalls;
    const m = await moc();
    let kq: Awaited<ReturnType<typeof lenhHmi.xacNhanGhiTag>>;
    try {
      kq = await lenhHmi.xacNhanGhiTag(
        { user: { id: nguoi.opA.id, role: "operator", twoFactorEnabled: true } },
        { userId: nguoi.opA.id, userRole: "operator" },
        { requestId },
        nowDate,
      );
    } finally {
      H.sauGiaHan = null;
    }
    expect(kq, JSON.stringify(kq)).toMatchObject({ ok: false, tuChoi: { ma: "HET_HAN" } });
    expect(mocDaChay, "đã qua bước 2 và gia hạn khoá — HET_HAN đến từ CAS").toBe(true);
    expect(H.dispatchCalls - truoc).toBe(0);
    expect(await dongLenh(requestId)).toHaveLength(0);
    expect(await trangThaiCho(requestId)).toBe("expired");
    expect(await khoa("cashet")).toBeUndefined();
    expect((await thuSau(m, nguoi.opA.id)).map((t) => [t.stage, t.outcome, t.reason_code])).toEqual([["confirm", "expired", "HET_HAN"]]);
  });

  it("fix round 2 — chốt dòng chờ NÉM sau dispatch thành công ⇒ khoá VẪN nhả, attempts dispatched VẪN ghi, trả kết quả thật", async () => {
    const requestId = await yeuCau("opA", "chot1");
    H.chotNem = true;
    let kq: Awaited<ReturnType<typeof nguoi.opA.caller.confirm>>;
    try {
      kq = await nguoi.opA.caller.confirm({ requestId });
    } finally {
      H.chotNem = false;
    }
    expect(kq).toMatchObject({ ok: true, status: "acked_verified" });
    expect(await khoa("chot1")).toBeUndefined();
    expect((await thuCua(requestId)).at(-1)).toMatchObject({ stage: "dispatch", outcome: "dispatched" });
  });

  it("fix round 2 — dispatch NÉM + chốt cũng NÉM ⇒ ném lại lỗi GỐC của dispatch (không bị che), khoá nhả, attempts DISPATCH_LOI", async () => {
    const requestId = await yeuCau("opA", "chot2");
    H.chotNem = true;
    H.dispatchNem = true;
    try {
      await expect(nguoi.opA.caller.confirm({ requestId })).rejects.toThrow(/dispatch nem/);
    } finally {
      H.chotNem = false;
      H.dispatchNem = false;
    }
    expect(await khoa("chot2")).toBeUndefined();
    expect((await thuCua(requestId)).at(-1)).toMatchObject({ stage: "dispatch", outcome: "rejected", reason_code: "DISPATCH_LOI" });
    expect(await trangThaiCho(requestId)).toBe("confirmed"); // chốt đã lỗi (mô phỏng) — log nói rõ; dispatch không tới đặt chỗ
  });

  it("minor 4 — dispatcher trả rejected SAU đặt chỗ (QUEUE_EXPIRED: hàng đã 'executed', không gửi) ⇒ dòng chờ bi_tu_choi_ghi, không 'executed'", async () => {
    const requestId = await yeuCau("opA", "qexp");
    H.tuChoiSauDatCho = true;
    try {
      const kq = await nguoi.opA.caller.confirm({ requestId });
      expect(kq).toMatchObject({ status: "rejected", ok: false, reason: "QUEUE_EXPIRED" });
    } finally {
      H.tuChoiSauDatCho = false;
    }
    expect(await trangThaiCho(requestId)).toBe("bi_tu_choi_ghi");
    expect(await khoa("qexp")).toBeUndefined();
    const tt = await nguoi.opA.caller.trangThai({ requestId });
    expect(tt.request.status).toBe("bi_tu_choi_ghi");
    expect((await thuCua(requestId)).at(-1)).toMatchObject({ stage: "dispatch", outcome: "dispatched", reason_code: "QUEUE_EXPIRED" });
  });
});

// Cuối tệp: một lệnh ghi quá hạn để lại "rủi ro ghi treo" theo adapter (otDeviceWrite B3) — không để nó chạm ca nào sau.
describe("dispatch quyết — quá hạn ack (cuối tệp)", () => {
  it("thiết bị không ack trong hạn ⇒ status timeout, ghi là dispatched (lý do TIMEOUT), khoá nhả", async () => {
    // R1a final I-2 — HMI không truyền deadlineMs nữa ⇒ hạn ack = OT_CONTROL_TIMEOUT_MS toàn cục (trước: deadlineMs bị MAX_MS cắt còn 300)
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "300");
    const requestId = await yeuCau("opA", "treo");
    H.trongKhiGhi = () => new Promise((r) => setTimeout(r, 900));
    try {
      const kq = await nguoi.opA.caller.confirm({ requestId });
      expect(kq).toMatchObject({ status: "timeout", ok: false, simulated: false });
    } finally {
      H.trongKhiGhi = null;
      vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "");
    }
    const thu = await thuCua(requestId);
    expect(thu.at(-1)).toMatchObject({ stage: "dispatch", outcome: "dispatched", reason_code: "TIMEOUT" });
    expect(await khoa("treo")).toBeUndefined();
    await new Promise((r) => setTimeout(r, 700)); // để lệnh ghi treo của stub kết thúc trước ca sau
  });
});
