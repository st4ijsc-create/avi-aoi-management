/**
 * SCADA R1b-2b-2a Task 1 fix round 1 (review I-1) — "DB nhanh không làm mất lượt ghi nền nào" trong hình dạng DỄ vỡ nhất:
 * MỘT máy nhiều adapter, mỗi adapter có override của cổng interlock (dispatcher ghi audit `stop_interlock_override` cho TỪNG adapter),
 * `SEC_PLATFORM=true` trong tiến trình (mọi `recordAuditEvent` chờ khoá chuỗi băm `AUDIT_CHAIN_LOCK` THẬT trong khi giữ một kết nối) và HAI lần
 * bấm SONG SONG (bấm đúp). Số lượt ghi nền mỗi lần bấm ≈ 2K (chốt + attempts, tuần tự theo adapter) + K audit override + 1 audit HMI > 8.
 *
 * DB KHOẺ: không khoá giả, không làm chậm gì. `DB_POOL_MAX` = 25 (mặc định production) trong tiến trình.
 * ĐO thực tế (2026-10-27, chỉ đọc): DEV `aoi_management` — 15 máy, mỗi máy ĐÚNG 1 adapter, 0 máy có ghim STOP; `_test` (dữ liệu test để lại) —
 * tối đa 9 adapter bật / máy (2 máy), tối đa 3 adapter có ghim / máy. Mã KHÔNG giới hạn số adapter / máy (`lenhHmi.ts` đọc adapter không `limit`).
 *
 * Trước fix round 1 (bỏ-khi-đầy, đo trên d441fda3e): ĐỎ — xem task-1-report.md "Fix round 1". Sau (hàng chờ có trần): 0 lượt bị bỏ, đủ mọi dòng.
 * Ô (b) của điều phối: DB chậm + TRÀN hàng chờ ⇒ ĐÚNG MỘT dòng tóm tắt `control_audit_log` nằm TRONG chuỗi băm (kiểm đoạn chuỗi của chính tệp).
 * `OT_CONTROL_ENABLED` / `SCADA_COMMANDS_ENABLED` / `SEC_PLATFORM` CHỈ trong tiến trình.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `r1b2b2t1k${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => {
  process.env.DB_POOL_MAX = "25";
  return {
    drivers: new Map<number, unknown>(),
    fingerprints: new Map<number, string>(),
    /** adapter mà cổng interlock (giả) báo "đang chặn" ⇒ STOP ghim gửi đè + audit `stop_interlock_override` */
    chanInterlock: new Set<number>(),
    chamAudit: false,
    khoaAudit: [0x7b1c, process.pid] as const,
  };
});

vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  const { sql: s } = await import("drizzle-orm");
  return {
    ...real,
    recordAuditEvent: (async (d: any, e: Parameters<typeof real.recordAuditEvent>[1]) => {
      if (!H.chamAudit) return real.recordAuditEvent(d, e);
      return d.transaction(async (tx: any) => {
        await tx.execute(s`SELECT pg_advisory_xact_lock(${H.khoaAudit[0]}::int, ${H.khoaAudit[1]}::int)`);
        return real.recordAuditEvent(tx, e);
      });
    }) as typeof real.recordAuditEvent,
  };
});

vi.mock("../services/interlock/interlockGate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/interlock/interlockGate")>();
  return {
    ...real,
    evaluateInterlockGate: (async (p: Parameters<typeof real.evaluateInterlockGate>[0]) =>
      H.chanInterlock.has(p.adapterId)
        ? { blocked: true, failClosed: false, violations: [{ ruleId: 990002, ruleName: "R1B2B2-T1-K giả", action: "stop" }] }
        : real.evaluateInterlockGate(p)) as typeof real.evaluateInterlockGate,
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
      { code: "R1B2B2T1K-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
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

vi.mock("../services/robot/criticalStopAlert", () => ({ raiseCriticalStopAlert: async () => undefined }));

import { getDb, resolvePoolMax } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { StubDriver } from "../services/ot/drivers/stubDriver";
import { adapterTargetFingerprint } from "../services/ot/adapterTarget";
import { soGhiSoTreoStopHmi } from "../services/scada/lenhHmi";
import * as ghiTreo from "../services/ot/ghiTreoCoTran";
import { computeAuditHash } from "../services/audit/controlAuditService";
import { logger } from "../logger";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Router = typeof import("./scadaCommandsRouter").scadaCommandsRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let scadaCommandsRouter: Router;
const fx = { fCode: "", sid: 0, m5: 0, m9: 0, a5: [] as number[], a9: [] as number[] };
const stubs: StubDriver[] = [];
const userIds: number[] = [];
let op: { id: number; caller: Caller };
const uuid = () => crypto.randomUUID();
const cho = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    (t as { unref?: () => void }).unref?.();
  });
async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

let loiLog: ReturnType<typeof vi.spyOn>;
let canhLog: ReturnType<typeof vi.spyOn>;
type BanLog = { cho?: string; noiDung?: any };
const nhanTrong = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c) => c[0] as BanLog).filter((o) => typeof o?.cho === "string").map((o) => o.cho as string);
/** mọi nhãn "lượt ghi nền KHÔNG vào sổ": bản cũ `_bo_qua_day`; bản hàng chờ `_bo_tran` / `_bo_qua_tuoi` / `_bo_qua_lon` / `_bo_tat_may` */
const nhanBo = () => [...nhanTrong(loiLog), ...nhanTrong(canhLog)].filter((c) => /_bo_(qua_day|tran|qua_tuoi|qua_lon|tat_may)$/.test(c));

beforeAll(async () => {
  vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("OT_CONTROL_ENABLED", "true");
  vi.stubEnv("OT_COMMISSIONING_REQUIRED", "false");
  vi.stubEnv("OT_READBACK_ENABLED", "false");
  vi.stubEnv("OT_CMD_SERIALIZE_ENABLED", "false");
  vi.stubEnv("SEC_PLATFORM", "true");
  vi.stubEnv("UNS_CMD_ACK_ENABLED", "false");
  vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "false");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  ({ scadaCommandsRouter } = await import("./scadaCommandsRouter"));

  const code = `${RUN}f`;
  fx.fCode = code;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  fx.sid = Number(s.id);
  const may = async (ma: string) =>
    Number((await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${fx.sid}, ${RUN + ma}, ${"May K " + ma}, 'AOI', true) RETURNING id`))[0].id);
  fx.m5 = await may("m5");
  fx.m9 = await may("m9");
  const adapter = async (mid: number, ma: string) => {
    const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
      VALUES (${mid}, ${`${RUN}-${ma}`}, ${`${RUN}-${ma}`}, 'stub', ${`stub://${RUN}-${ma}`}, 60000, true, 'disabled') RETURNING id`);
    const id = Number(r.id);
    await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, stop_value, stop_pinned_by, stop_pinned_at, actuation_level)
      VALUES (${id}, 'stop_cmd', 'M.stop_cmd', 'bool', true, true, 'input_output'::scada_channel_kind, 'true'::jsonb, '1', now(), 1)`);
    const st = new StubDriver();
    await st.connect({ endpoint: `stub://${RUN}-${ma}` } as never);
    stubs.push(st);
    H.drivers.set(id, st);
    const [row] = await dung(sql`SELECT protocol, endpoint, "machineId", "connectionOptions" FROM device_adapters WHERE id = ${id}`);
    H.fingerprints.set(id, adapterTargetFingerprint({ protocol: row.protocol, endpoint: row.endpoint, machineId: row.machineId ?? null, connectionOptions: row.connectionOptions ?? null }));
    return id;
  };
  for (let i = 0; i < 5; i++) fx.a5.push(await adapter(fx.m5, `a5${i}`));
  for (let i = 0; i < 9; i++) fx.a9.push(await adapter(fx.m9, `a9${i}`));

  const u = await taoNguoiDungTest("opT1K", "operator", { tienTo: "r1b2b2t1k", ts: RUN, ten: "R1B2B2 T1 K op" });
  userIds.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`);
  op = { id: u.id, caller: scadaCommandsRouter.createCaller({ user: { id: u.id, role: "operator", name: u.name, twoFactorEnabled: false } } as never) };
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const st of stubs) await st.disconnect().catch(() => undefined);
  if (!db) return;
  try {
    for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool LIKE 'hmi.%'`);
    for (const id of [...fx.a5, ...fx.a9]) {
      await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${id}`);
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
      await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
    }
    await dung(sql`DELETE FROM machines WHERE code IN (${RUN + "m5"}, ${RUN + "m9"})`);
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${fx.fCode}`);
    await dung(sql`DELETE FROM stations WHERE code = ${fx.fCode}`);
    await dung(sql`DELETE FROM production_lines WHERE code = ${fx.fCode}`);
    await dung(sql`DELETE FROM workshops WHERE code = ${fx.fCode}`);
    await dung(sql`DELETE FROM factories WHERE code = ${fx.fCode}`);
  } catch (e) {
    console.warn("[r1b2b2t1k] dọn dữ liệu:", (e as Error).message);
  }
}, 120_000);

beforeEach(() => {
  H.chanInterlock = new Set([...fx.a5]);
  loiLog = vi.spyOn(logger, "error");
  canhLog = vi.spyOn(logger, "warn");
});
afterEach(async () => {
  H.chamAudit = false;
  await vi.waitFor(() => expect(soGhiSoTreoStopHmi()).toBe(0), { timeout: 20_000, interval: 50 });
  vi.restoreAllMocks();
}, 30_000);

/** Mỗi lần bấm: kết quả + mọi dòng sổ mong đợi (audit HMI theo clientRequestId; override theo commandLogId; attempts theo actionId). */
async function choDuSo(crids: string[], kq: Array<Awaited<ReturnType<Caller["dungMay"]>>>, K: number, coOverride: boolean, moc: number) {
  const logIds = kq.flatMap((k) => k.ketQua.flatMap((a) => a.commandLogIds)).map(String);
  let hmi: any[] = [];
  let ovr: any[] = [];
  let thu: any[] = [];
  await vi.waitFor(
    async () => {
      hmi = await dung(sql`SELECT "afterJson" FROM control_audit_log WHERE id > ${moc} AND action = 'scada_hmi_stop' AND "actorId" = ${op.id}`);
      hmi = hmi.filter((r) => crids.includes(r.afterJson?.clientRequestId));
      ovr = coOverride
        ? (await dung(sql`SELECT "entityId" FROM control_audit_log WHERE id > ${moc} AND action = 'stop_interlock_override' AND "entityType" = 'ot_command'`)).filter((r) =>
            logIds.includes(String(r.entityId)),
          )
        : [];
      thu = await dung(sql`SELECT request_id FROM scada_command_attempts WHERE user_id = ${op.id} AND stage = 'dispatch' AND outcome = 'dispatched' AND at > now() - interval '2 minutes'`);
      if (hmi.length < crids.length || ovr.length < (coOverride ? K * crids.length : 0)) throw new Error(`audit chưa đủ: hmi ${hmi.length}, override ${ovr.length}`);
    },
    { timeout: 15_000, interval: 50 },
  );
  return { hmi, ovr, thu, logIds };
}

describe("★ I-1 — DB KHOẺ, nhiều adapter, SEC_PLATFORM bật, bấm đúp ⇒ KHÔNG lượt ghi nền nào bị bỏ", () => {
  it("pool 25 (mặc định production), SEC_PLATFORM bật", () => {
    expect(resolvePoolMax()).toBe(25);
    expect(process.env.SEC_PLATFORM).toBe("true");
  });

  it.each([
    { K: 5, coOverride: true },
    { K: 9, coOverride: false },
  ])("★ K = $K adapter, override = $coOverride, 2 lần bấm song song ⇒ mọi adapter acked; 0 lượt bị bỏ; đủ audit HMI + override + attempts", async ({ K, coOverride }) => {
    if (!coOverride) H.chanInterlock = new Set();
    const machineId = K === 5 ? fx.m5 : fx.m9;
    const [mc] = await dung(sql`SELECT COALESCE(max(id) FILTER (WHERE id <= COALESCE(pg_sequence_last_value(pg_get_serial_sequence('control_audit_log', 'id')::regclass), 0)), 0)::bigint AS m FROM control_audit_log`);
    const moc = Number(mc.m);
    let maxDem = 0;
    const tLay = setInterval(() => (maxDem = Math.max(maxDem, soGhiSoTreoStopHmi())), 1);
    const crids = [uuid(), uuid()];
    const kq = await Promise.all(crids.map((c) => op.caller.dungMay({ machineId, clientRequestId: c })));
    clearInterval(tLay);
    for (const k of kq) {
      expect(k.ketQua).toHaveLength(K);
      for (const a of k.ketQua) expect(a).toMatchObject({ status: "acked_verified", ok: true });
    }
    const bo = nhanBo();
    console.info(`[r1b2b2t1k] K=${K} override=${coOverride}: đếm đang bay tối đa ${maxDem}; lượt bị bỏ ${bo.length}: ${JSON.stringify(bo.reduce((m: Record<string, number>, c) => ((m[c] = (m[c] ?? 0) + 1), m), {}))}`);
    expect(bo, "DB khoẻ: không lượt ghi nền nào bị bỏ").toEqual([]);
    const s = await choDuSo(crids, kq, K, coOverride, moc);
    expect(s.hmi).toHaveLength(2);
    if (coOverride) expect(s.ovr).toHaveLength(2 * K);
    const actionIds = new Set((await dung(sql`SELECT id FROM ai_pending_actions WHERE "userId" = ${op.id} AND "createdAt" > now() - interval '2 minutes'`)).map((r) => String(r.id)));
    expect(s.thu.filter((r) => actionIds.has(String(r.request_id))).length).toBeGreaterThanOrEqual(2 * K);
  }, 60_000);
});

// ═════════ ô (b) của điều phối — DB chậm + TRÀN hàng chờ ⇒ MỘT dòng tóm tắt nằm TRONG chuỗi băm ═════════
type Giu = { tx: Tx; nha(): Promise<void> };
async function moGiu(khoa: readonly [number, number]): Promise<Giu> {
  let nhaFn!: () => void;
  const nhaP = new Promise<void>((r) => (nhaFn = r));
  let coTx!: (tx: Tx) => void;
  const txP = new Promise<Tx>((r) => (coTx = r));
  const giu = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${khoa[0]}::int, ${khoa[1]}::int)`);
    coTx(tx);
    await nhaP;
  });
  const hen = setTimeout(nhaFn, 15_000);
  (hen as { unref?: () => void }).unref?.();
  const tx = await txP;
  return {
    tx,
    async nha() {
      clearTimeout(hen);
      nhaFn();
      await giu.catch(() => undefined);
    },
  };
}

describe("★ (b) DB chậm + tràn hàng chờ ⇒ ĐÚNG MỘT dòng tóm tắt `control_audit_log` (đếm đúng) nằm trong chuỗi băm", () => {
  it("8 đang bay + đầy hàng chờ + 7 tràn ⇒ sau khi DB hết chậm: mọi lượt xếp hàng được ghi, 1 dòng tóm tắt soLuong = 7, đoạn chuỗi băm của tệp hợp lệ; đếm về 0", async () => {
    const bk = ghiTreo as unknown as Record<string, any>;
    expect(typeof bk.TRAN_HANG_CHO_GHI_NEN, "bản có hàng chờ").toBe("number");
    const TRAN_HC: number = bk.TRAN_HANG_CHO_GHI_NEN;
    const [mc] = await dung(sql`SELECT COALESCE(max(id) FILTER (WHERE id <= COALESCE(pg_sequence_last_value(pg_get_serial_sequence('control_audit_log', 'id')::regclass), 0)), 0)::bigint AS m FROM control_audit_log`);
    const moc = Number(mc.m);
    const giu = await moGiu(H.khoaAudit);
    H.chamAudit = true;
    const { recordAuditEvent } = await import("../services/audit/controlAuditService");
    const action = `r1b2b2t1k_thu_${RUN}`.slice(0, 60);
    const TRAN = ghiTreo.TRAN_GHI_TREO_STOP;
    const TONG = TRAN + TRAN_HC + 7;
    for (let i = 0; i < TONG; i++) {
      void ghiTreo.ghiCoTran((t) => recordAuditEvent(db, ghiTreo.themLucSuKien({ entityType: "r1b2b2t1k", entityId: i, action, actorId: null, after: { i } }, t)), {
        nhan: "thu_tran",
        requestId: `rq${i}`,
        noiDung: { bang: "control_audit_log", i },
      });
    }
    expect(ghiTreo.soGhiTreoStop()).toBe(TRAN);
    expect(bk.trangThaiGhiTreo().hangCho).toBe(TRAN_HC);
    expect(nhanTrong(loiLog).filter((c) => c === "thu_tran_bo_tran")).toHaveLength(7);
    // DB hết chậm ⇒ hàng chờ xả dưới CÙNG trần; tóm tắt được ghi một lần
    H.chamAudit = false;
    await giu.nha();
    let rows: any[] = [];
    await vi.waitFor(
      async () => {
        rows = await dung(sql`SELECT id, "entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason, "prevHash", hash, "hashTs" FROM control_audit_log
          WHERE id > ${moc} AND (action = ${action} OR action = 'ot_stop_ghi_nen_bo_roi') ORDER BY id`);
        const tt = rows.filter((r) => r.action === "ot_stop_ghi_nen_bo_roi" && r.afterJson?.requestIds?.includes(`rq${TONG - 1}`));
        if (rows.filter((r) => r.action === action).length < TRAN + TRAN_HC || tt.length < 1) throw new Error(`chưa xả: ${rows.length}`);
      },
      { timeout: 30_000, interval: 100 },
    );
    const thu = rows.filter((r) => r.action === action);
    expect(thu).toHaveLength(TRAN + TRAN_HC);
    // lượt XẾP HÀNG mang giờ sự kiện (không phải giờ xả)
    const xepHang = thu.filter((r) => r.afterJson?.tuHangCho === true);
    expect(xepHang).toHaveLength(TRAN_HC);
    const tomTat = rows.filter((r) => r.action === "ot_stop_ghi_nen_bo_roi" && r.afterJson?.requestIds?.includes(`rq${TONG - 1}`));
    expect(tomTat).toHaveLength(1);
    expect(tomTat[0].afterJson).toMatchObject({ soLuong: 7, theoLyDo: { tran: 7 }, theoNhan: { thu_tran: 7 } });
    // đoạn chuỗi băm của tệp: từ dòng băm NGAY TRƯỚC dòng đầu của tệp tới dòng tóm tắt — mọi dòng băm nối prevHash và băm lại khớp
    // tóm tắt đi TRƯỚC hàng chờ khi có chỗ ⇒ nó có thể nằm giữa các dòng của tệp; đoạn = [dòng băm trước dòng đầu, dòng muộn nhất của tệp]
    const dau = Math.min(thu[0].id, tomTat[0].id);
    const cuoi = Math.max(thu.at(-1).id, tomTat[0].id);
    const doan = (await dung(sql`SELECT id, "entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason, "prevHash", hash, "hashTs" FROM control_audit_log
      WHERE hash IS NOT NULL AND id >= (SELECT max(id) FILTER (WHERE id <= COALESCE(pg_sequence_last_value(pg_get_serial_sequence('control_audit_log', 'id')::regclass), 0)) FROM control_audit_log WHERE hash IS NOT NULL AND id < ${dau}) AND id <= ${cuoi} ORDER BY id`)) as any[];
    expect(doan.length).toBeGreaterThanOrEqual(TRAN + TRAN_HC + 2);
    for (let i = 1; i < doan.length; i++) {
      const r = doan[i];
      expect(r.prevHash, `dòng ${r.id} nối dòng ${doan[i - 1].id}`).toBe(doan[i - 1].hash);
      const h = computeAuditHash(
        r.prevHash,
        { entityType: r.entityType, entityId: r.entityId, action: r.action, actorId: r.actorId, before: r.beforeJson ?? null, after: r.afterJson ?? null, reason: r.reason },
        Number(r.hashTs),
      );
      expect(h, `băm dòng ${r.id}`).toBe(r.hash);
    }
    await vi.waitFor(() => expect(bk.trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0, tomTatCho: 0 }), { timeout: 10_000, interval: 50 });
  }, 90_000);
});

// ═════════ fix round 3 (re-review N2-2) — tắt tiến trình với lượt ĐANG BAY: dòng tóm tắt COMMIT vào control_audit_log (chuỗi băm thật) ═════════
describe("★ N2-2 — xaHangChoKhiTat khi 3 audit đang treo: tóm tắt dang_bay_khi_tat ĐÃ COMMIT (hàng thật, có băm) lúc lượt xả trả", () => {
  it("3 audit treo trên khoá của tệp (KHÔNG giữ khoá chuỗi) ⇒ ≤ 2 s; ngay khi trả: đúng 1 dòng ot_stop_ghi_nen_bo_roi (dang_bay_khi_tat 3, khongRoDaGhi 3, hash có)", async () => {
    const [mc] = await dung(sql`SELECT COALESCE(max(id) FILTER (WHERE id <= COALESCE(pg_sequence_last_value(pg_get_serial_sequence('control_audit_log', 'id')::regclass), 0)), 0)::bigint AS m FROM control_audit_log`);
    const giu = await moGiu(H.khoaAudit);
    H.chamAudit = true;
    const { recordAuditEvent } = await import("../services/audit/controlAuditService");
    const rq = (i: number) => `td${i}-${RUN}`.slice(0, 60);
    for (let i = 0; i < 3; i++) {
      void ghiTreo.ghiCoTran((t) => recordAuditEvent(db, ghiTreo.themLucSuKien({ entityType: "r1b2b2t1k", entityId: i, action: `r1b2b2t1k_tat_${i}`, actorId: null, after: { i } }, t)), {
        nhan: "tat_dang_bay",
        requestId: rq(i),
        noiDung: { bang: "control_audit_log" },
      });
    }
    await vi.waitFor(async () => {
      const [r] = (await giu.tx.execute(
        sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid::bigint = ${H.khoaAudit[0]} AND objid::bigint = ${H.khoaAudit[1]} AND objsubid = 2 AND NOT granted`,
      )) as unknown as Array<{ n: number }>;
      if (r.n < 3) throw new Error(`mới ${r.n} lượt treo`);
    }, { timeout: 5_000, interval: 25 });
    H.chamAudit = false; // dòng tóm tắt đi thẳng bản thật (khoá chuỗi băm thật, không bị lượt treo giữ)
    const t0 = Date.now();
    await ghiTreo.xaHangChoKhiTat();
    const troi = Date.now() - t0;
    // NGAY khi lượt xả trả (process.exit theo sau ở sản phẩm): hàng tóm tắt phải ĐÃ commit
    const rows = (await dung(sql`SELECT "afterJson", hash FROM control_audit_log WHERE id > ${Number(mc.m)} AND action = 'ot_stop_ghi_nen_bo_roi'`)) as any[];
    const cua = rows.filter((r) => (r.afterJson?.requestIds ?? []).includes(rq(0)));
    console.info(`[r1b2b2t1k] N2-2: xả khi tắt ${troi} ms, tóm tắt đã commit ${cua.length}`);
    expect(troi).toBeLessThanOrEqual(2_000 + 200);
    expect(cua).toHaveLength(1);
    expect(cua[0].afterJson).toMatchObject({ theoLyDo: { dang_bay_khi_tat: 3 }, khongRoDaGhi: 3 });
    expect(cua[0].hash, "nằm trong chuỗi băm (SEC_PLATFORM)").toEqual(expect.any(String));
    await giu.nha();
    ghiTreo._datLaiGhiTreoChoTest(); // lượt xả khi tắt được ghi nhớ một lần / tiến trình — đặt lại cho afterEach
  }, 30_000);
});

// ═════════ fix round 3 (S-1 + yêu cầu điều phối) — hàng audit CẮT thật trong chuỗi băm: định danh nguyên văn + DẤU CẮT (độ dài + sha256 bản gốc) ═════════
describe("★ S-1 — audit QUÁ LỚN xếp hàng ⇒ hàng CẮT được lưu: định danh nguyên văn, after.daCat + catGoc khớp bản GỐC, băm hàng kiểm lại được", () => {
  it("8 audit treo + 1 audit 60 KB xếp hàng ⇒ DB hết chậm ⇒ hàng cắt: action/reason/entityType/entityId nguyên văn; catGoc.after = len+sha256 canonicalize(gốc); computeAuditHash khớp + nối prevHash", async () => {
    const { canonicalize } = await import("../services/security/auditChain");
    const { createHash } = await import("node:crypto");
    const [mc] = await dung(sql`SELECT COALESCE(max(id) FILTER (WHERE id <= COALESCE(pg_sequence_last_value(pg_get_serial_sequence('control_audit_log', 'id')::regclass), 0)), 0)::bigint AS m FROM control_audit_log`);
    const giu = await moGiu(H.khoaAudit);
    H.chamAudit = true;
    const { recordAuditEvent } = await import("../services/audit/controlAuditService");
    for (let i = 0; i < ghiTreo.TRAN_GHI_TREO_STOP; i++) {
      void ghiTreo.ghiCoTran((t) => recordAuditEvent(db, ghiTreo.themLucSuKien({ entityType: "r1b2b2t1k", entityId: i, action: `r1b2b2t1k_cat_treo`, actorId: null, after: { i } }, t)), {
        nhan: "cat_treo",
        requestId: `ct${i}`,
        noiDung: { bang: "control_audit_log" },
      });
    }
    const action = `r1b2b2t1k_cat_${RUN}`.slice(0, 60);
    const goc = {
      entityType: "machine",
      entityId: `may-${RUN}`,
      action,
      actorId: op.id,
      reason: "STOP khi đang bị buộc đổi mật khẩu (miễn cổng — điều phối 2026-10-26) — " + "lý do dài ".repeat(20),
      before: null,
      after: { ketCuc: "DA_GUI", adapters: Array.from({ length: 200 }, (_, i) => ({ adapterId: i, ghimDaGui: [{ tagKey: `stop_${i}`, value: true }], ghiChu: "g".repeat(250) })) },
    };
    expect(JSON.stringify(goc).length).toBeGreaterThan(ghiTreo.TRAN_BYTE_MUC_HANG_CHO);
    // người ghi từ nội dung — cùng khuôn `nguoiGhiAuditTuNoiDung` của lenhHmi (phạm vi riêng, chỉ bắt db)
    const nguoiGhi = ((d: typeof db) => (nd: unknown, t: Parameters<Parameters<typeof ghiTreo.ghiCoTran>[0]>[0]) =>
      recordAuditEvent(d, ghiTreo.themLucSuKien(ghiTreo.suKienAuditTuNoiDung<Parameters<typeof recordAuditEvent>[1]>(nd), t)))(db);
    await ghiTreo.ghiCoTran((t) => recordAuditEvent(db, ghiTreo.themLucSuKien(goc, t)), {
      nhan: "audit_cat",
      requestId: "cat1",
      noiDung: { bang: "control_audit_log", ...goc },
      viecTuNoiDung: nguoiGhi,
    });
    H.chamAudit = false;
    await giu.nha();
    let hang: any;
    await vi.waitFor(async () => {
      [hang] = (await dung(sql`SELECT id, "entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason, "prevHash", hash, "hashTs" FROM control_audit_log
        WHERE id > ${Number(mc.m)} AND action = ${action}`)) as any[];
      if (!hang) throw new Error("hàng cắt chưa ghi");
    }, { timeout: 15_000, interval: 50 });
    // định danh NGUYÊN VĂN
    expect(hang.action).toBe(goc.action);
    expect(hang.reason).toBe(goc.reason);
    expect(hang.entityType).toBe(goc.entityType);
    expect(hang.entityId).toBe(goc.entityId);
    expect(hang.actorId).toBe(goc.actorId);
    // DẤU CẮT trong phần được băm, khớp bản GỐC
    const chuoi = canonicalize(goc.after);
    expect(hang.afterJson.daCat).toBe(true);
    expect(hang.afterJson.tuHangCho).toBe(true);
    expect(hang.afterJson.catGoc.after).toEqual({ doDaiGocByteUtf8: Buffer.byteLength(chuoi, "utf8"), sha256Goc: createHash("sha256").update(chuoi).digest("hex") });
    expect(hang.afterJson.catGoc.before).toBeUndefined(); // before null — không bị cắt
    expect(JSON.stringify(hang.afterJson).length).toBeLessThan(JSON.stringify(goc.after).length);
    // băm của hàng ĐÃ LƯU kiểm lại được (cùng hàm verifyAuditRows dùng) + nối hàng băm ngay trước — verifyAuditRows bắt đầu ở GENESIS nên không
    // chạy được giữa chuỗi `_test` dùng chung; bản một hàng của verifyAuditRows chạy ở test đơn vị
    const [truoc] = (await dung(sql`SELECT hash FROM control_audit_log WHERE hash IS NOT NULL AND id < ${hang.id} ORDER BY id DESC LIMIT 1`)) as any[];
    expect(hang.prevHash).toBe(truoc.hash);
    expect(
      computeAuditHash(
        hang.prevHash,
        { entityType: hang.entityType, entityId: hang.entityId, action: hang.action, actorId: hang.actorId, before: hang.beforeJson ?? null, after: hang.afterJson ?? null, reason: hang.reason },
        Number(hang.hashTs),
      ),
    ).toBe(hang.hash);
  }, 60_000);
});
