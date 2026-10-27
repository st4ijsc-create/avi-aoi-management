/**
 * SCADA R1b-2b-2a Task 1 (mục 61) — MỌI lượt ghi nền của đường STOP (`scadaCommands.dungMay`) chịu MỘT trần ghi đang bay = 8 (Review Focus 1).
 * CSDL `_test` THẬT: router tRPC THẬT → `lenhHmi.dungMayHmi` THẬT → `dispatch()` THẬT → StubDriver THẬT (RAM).
 *
 * Nguồn ghi nền mỗi lần bấm máy G (đo — N × 3 nguồn chậm được):
 *   1. audit HMI `scada_hmi_stop` (DA_GUI) — `lenhHmi.ghiAudit`;
 *   2. attempts `scada_command_attempts` — `guiStopMotAdapter` / `ghiThuCoHan`;
 *   3. audit của dispatcher cho STOP ghim `stop_interlock_override` — `commandDispatcher.auditPinnedStopOverride` (cổng interlock của máy G bị giả là
 *      "đang chặn" bằng vi.mock(importOriginal) ⇒ STOP ghim được gửi đè + audit override — đúng đường R-1D-c).
 *   (+ chốt dòng chờ `ai_pending_actions` — luôn nhanh ở đây.)
 *
 * ── SỔ CHẬM THẬT (Global Constraints: KHÔNG khoá bảng, KHÔNG khoá chuỗi audit toàn cục) ──────────────────────────────────────────────
 *   · audit chậm: `recordAuditEvent` bọc vi.mock(importOriginal) — khi `H.chamAudit`, chạy trong MỘT giao dịch THẬT trên kết nối pool: chờ
 *     `pg_advisory_xact_lock(KHOA_AUDIT, pid)` (kết nối "giữ" của tệp cầm khoá ⇒ Postgres CHẶN THẬT, giữ một kết nối pool như khi khoá chuỗi băm
 *     bị giữ) rồi gọi bản THẬT. Áp cho cả lời gọi tĩnh (lenhHmi) lẫn `import()` động (dispatcher).
 *   · attempts chậm: khuôn `chamThu` của `soCoHan.r1b2b.db.test.ts` (INSERT attempts trong giao dịch chờ `KHOA_THU`).
 *   · khoá advisory 2-khoá (LOP của tệp, objid = pid) ⇒ không phiên / tệp nào khác đụng. Kết nối giữ tự nhả sau `GIU_TU_NHA_MS` (an toàn).
 *   · oracle ĐỘC LẬP ở Postgres: số backend `NOT granted` trên các khoá của tệp trong `pg_locks` (= số lượt ghi nền đang giữ kết nối và treo),
 *     lấy mẫu LIÊN TỤC qua kết nối giữ (ngoài hàng đợi pool) từ TRƯỚC lần bấm đầu tới sau khi mọi lần bấm trả lời.
 * `DB_POOL_MAX` = 18 trong tiến trình (vi.hoisted): 18 − 1 kết nối giữ − 8 trần = 9 = `DU_TRU_POOL_CHO_DUNG_MAY` (cùng phần dự trữ của production
 * 25 − 8 khảo sát − 8 ghi treo). Bản cũ (đếm chỉ khi quá 500 ms, ghi nền bắn-rồi-quên ngoài bộ đếm) ⇒ > 8 backend chờ ⇒ ĐỎ.
 * `OT_CONTROL_ENABLED` / `SCADA_COMMANDS_ENABLED` / `SEC_PLATFORM` (false) CHỈ trong tiến trình. Cận đồng hồ tường (máy G2) dùng `batDauDoLag`.
 * Fix round 1 (điều phối DUYỆT hàng chờ có trần thay "bỏ khi đầy"): đầy trần ⇒ lượt ghi XẾP HÀNG (`<nhan>_xep_hang`, warn), xả dưới CÙNG trần khi
 * DB hết chậm, mang giờ SỰ KIỆN (audit `after.lucSuKien` + `tuHangCho`; attempts cột `at`). Chỉ TRÀN (256) mới bỏ ⇒ `_bo_tran` + `ghi_so_loi` (Q2) +
 * đếm posture + MỘT dòng tóm tắt `ot_stop_ghi_nen_bo_roi`. Đối chiếu: đang chờ ở Postgres + còn trong hàng chờ = số nguồn × số lần bấm.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `r1b2b2t1${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => {
  process.env.DB_POOL_MAX = "18";
  return {
    drivers: new Map<number, unknown>(),
    fingerprints: new Map<number, string>(),
    dispatchInputs: [] as Array<{ adapterId: number; actionId: string }>,
    lucVaoDispatch: new Map<number, number>(),
    lucRaDispatch: new Map<number, number>(),
    /** adapter mà cổng interlock (giả) báo "đang chặn" ⇒ STOP ghim gửi đè + audit `stop_interlock_override` */
    chanInterlock: new Set<number>(),
    chamAudit: false,
    khoaAudit: [0x7b1a, process.pid] as const,
    chamThu: false,
    bangThu: null as unknown,
    khoaThu: [0x7b1b, process.pid] as const,
  };
});

vi.mock("../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db/connection")>();
  const { sql: s } = await import("drizzle-orm");
  const boc = (d: any) =>
    new Proxy(d, {
      get(t, p) {
        if (p === "insert") {
          return (bang: unknown) => {
            const q = t.insert(bang);
            if (!H.chamThu || bang !== H.bangThu) return q;
            return {
              values: (v: unknown) =>
                t.transaction(async (tx: any) => {
                  await tx.execute(s`SELECT pg_advisory_xact_lock(${H.khoaThu[0]}::int, ${H.khoaThu[1]}::int)`);
                  await tx.insert(bang).values(v);
                }),
            };
          };
        }
        const v = Reflect.get(t, p, t);
        return typeof v === "function" && p !== "constructor" ? v.bind(t) : v;
      },
    });
  return {
    ...real,
    getDb: (async (...a: Parameters<typeof real.getDb>) => {
      const d = await real.getDb(...a);
      return d ? boc(d) : d;
    }) as typeof real.getDb,
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
        ? { blocked: true, failClosed: false, violations: [{ ruleId: 990001, ruleName: "R1B2B2-T1 giả", action: "stop" }] }
        : real.evaluateInterlockGate(p)) as typeof real.evaluateInterlockGate,
  };
});

vi.mock("../services/ot/commandDispatcher", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/commandDispatcher")>();
  return {
    ...real,
    dispatch: async (...a: Parameters<typeof real.dispatch>) => {
      const inp = a[0] as { adapterId: number; triggeredBy?: { actionId?: string } };
      H.dispatchInputs.push({ adapterId: inp.adapterId, actionId: String(inp.triggeredBy?.actionId ?? "") });
      H.lucVaoDispatch.set(inp.adapterId, Date.now());
      const kq = await real.dispatch(...a);
      H.lucRaDispatch.set(inp.adapterId, Date.now());
      return kq;
    },
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
      { code: "R1B2B2T1-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
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
import { DU_TRU_POOL_CHO_DUNG_MAY, soGhiSoTreoStopHmi, TRAN_GHI_SO_TREO_STOP_HMI } from "../services/scada/lenhHmi";
import { demGhiBoQuaDay, ghiCoTran, TRAN_HANG_CHO_GHI_NEN, trangThaiGhiTreo } from "../services/ot/ghiTreoCoTran";
import { demStopQuaHanKhongGhiSo } from "../_core/hanStopHmi";
import { scadaCommandAttempts } from "../../drizzle/schema";
import { batDauDoLag } from "../testing/doLagBucleSuKien";
import { logger } from "../logger";

class StubGhi extends StubDriver {
  ghi: Array<Array<{ tagKey: string; value: unknown }>> = [];
  override async writeTags(writes: Array<{ tagKey: string; address: string; value: unknown }>) {
    this.ghi.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
    return super.writeTags(writes);
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Router = typeof import("./scadaCommandsRouter").scadaCommandsRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let scadaCommandsRouter: Router;
let boDem: typeof import("../services/scada/boDemHienTai");
const fx = { fCode: "", sid: 0, mG: 0, mG2: 0, aG: 0, aG2: 0 };
let stubG: StubGhi;
let stubG2: StubGhi;
const userIds: number[] = [];
let op: { id: number; caller: Caller; name: string };

const TRAN = TRAN_GHI_SO_TREO_STOP_HMI;
/** số lần bấm song song (Review Focus 1) */
const SO_BAM = 12;
/** kết nối giữ tự nhả sau ngần này (an toàn — bản lỗi treo pool không kẹt tệp) */
const GIU_TU_NHA_MS = 12_000;

const cho = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    (t as { unref?: () => void }).unref?.();
  });
async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}
const uuid = () => crypto.randomUUID();

// ─── kết nối giữ khoá (sổ chậm THẬT, phạm vi tiến trình này) ──────────────────────────────────────────────────────────────────────
interface Giu {
  tx: Tx;
  nha(): Promise<void>;
}
const dangGiu: Giu[] = [];
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
  const hen = setTimeout(nhaFn, GIU_TU_NHA_MS);
  (hen as { unref?: () => void }).unref?.();
  try {
    const tx = await Promise.race([txP, giu.then(() => Promise.reject(new Error("giao dịch giữ kết thúc sớm")))]);
    const g: Giu = {
      tx,
      async nha() {
        clearTimeout(hen);
        nhaFn();
        await giu.catch(() => undefined);
      },
    };
    dangGiu.push(g);
    return g;
  } catch (e) {
    clearTimeout(hen);
    nhaFn();
    await giu.catch(() => undefined);
    throw e;
  }
}

/** số backend `NOT granted` trên các khoá advisory 2-khoá của tệp — đọc qua kết nối `tx` (ngoài hàng đợi pool) */
async function demCho(tx: Tx, khoas: ReadonlyArray<readonly [number, number]>): Promise<number> {
  let n = 0;
  for (const [lop, id] of khoas) {
    const [r] = (await tx.execute(
      sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid::bigint = ${lop} AND objid::bigint = ${id} AND objsubid = 2 AND NOT granted`,
    )) as unknown as Array<{ n: number }>;
    n += r.n;
  }
  return n;
}

/** lấy mẫu LIÊN TỤC (từ trước lần bấm đầu) số backend chờ + bộ đếm của tiến trình */
function layMau(tx: Tx, khoas: ReadonlyArray<readonly [number, number]>) {
  let thoi = false;
  const pg: number[] = [];
  const js: number[] = [];
  const chay = (async () => {
    while (!thoi) {
      js.push(soGhiSoTreoStopHmi());
      pg.push(await demCho(tx, khoas));
      await new Promise<void>((r) => setImmediate(r));
    }
  })();
  return {
    pg,
    js,
    async dung() {
      thoi = true;
      await chay;
      return { maxPg: Math.max(0, ...pg), maxJs: Math.max(0, ...js), soMau: pg.length };
    },
  };
}

let loiLog: ReturnType<typeof vi.spyOn>;
let canhLog: ReturnType<typeof vi.spyOn>;
type BanLog = { cho?: string; noiDung?: any; requestId?: string };
const locLog = (spy: ReturnType<typeof vi.spyOn>, pred: (o: BanLog) => boolean) =>
  spy.mock.calls.map((c) => c[0] as BanLog).filter((o) => typeof o?.cho === "string" && pred(o));
const logCo = (pred: (o: BanLog) => boolean) => locLog(loiLog, pred);
const logCanh = (pred: (o: BanLog) => boolean) => locLog(canhLog, pred);
/** fix round 1 — lượt ghi nền BỊ BỎ (không bao giờ ghi): `_bo_tran` / `_bo_qua_tuoi` / `_bo_qua_lon` / `_bo_tat_may` (bản cũ: `_bo_qua_day`) */
const boLog = () => logCo((o) => /_bo_(tran|qua_tuoi|qua_lon|tat_may|qua_day)$/.test(o.cho!));
async function mocThu(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM scada_command_attempts`);
  return Number(r.m);
}

async function bamSongSong(machineId: number, n: number) {
  const t0 = Date.now();
  const ps = Array.from({ length: n }, () => op.caller.dungMay({ machineId, clientRequestId: uuid() }));
  const phatTrong = Date.now() - t0;
  const kq = await Promise.all(ps);
  return { kq, phatTrong };
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
  ({ scadaCommandsRouter } = await import("./scadaCommandsRouter"));
  boDem = await import("../services/scada/boDemHienTai");
  H.bangThu = scadaCommandAttempts;

  const code = `${RUN}f`;
  fx.fCode = code;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  fx.sid = Number(s.id);
  const may = async (ma: string) =>
    Number((await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${fx.sid}, ${RUN + ma}, ${"May T1 " + ma}, 'AOI', true) RETURNING id`))[0].id);
  fx.mG = await may("mg");
  fx.mG2 = await may("mg2");
  const adapter = async (mid: number, ma: string) => {
    const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
      VALUES (${mid}, ${`${RUN}-${ma}`}, ${`${RUN}-${ma}`}, 'stub', ${`stub://${RUN}-${ma}`}, 60000, true, 'disabled') RETURNING id`);
    const id = Number(r.id);
    await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, stop_value, stop_pinned_by, stop_pinned_at, actuation_level)
      VALUES (${id}, 'stop_cmd', 'M.stop_cmd', 'bool', true, true, 'input_output'::scada_channel_kind, 'true'::jsonb, '1', now(), 1)`);
    return id;
  };
  fx.aG = await adapter(fx.mG, "ag");
  fx.aG2 = await adapter(fx.mG2, "ag2");
  boDem.datThongTinAdapter(fx.aG, { pollMs: 60_000, coDeadband: false, machineId: fx.mG, code: `${RUN}-ag` });

  stubG = new StubGhi();
  stubG2 = new StubGhi();
  for (const [aid, st, ma] of [[fx.aG, stubG, "ag"], [fx.aG2, stubG2, "ag2"]] as const) {
    await st.connect({ endpoint: `stub://${RUN}-${ma}` } as never);
    H.drivers.set(aid, st);
    const [row] = await dung(sql`SELECT protocol, endpoint, "machineId", "connectionOptions" FROM device_adapters WHERE id = ${aid}`);
    H.fingerprints.set(
      aid,
      adapterTargetFingerprint({ protocol: row.protocol, endpoint: row.endpoint, machineId: row.machineId ?? null, connectionOptions: row.connectionOptions ?? null }),
    );
  }

  const u = await taoNguoiDungTest("opT1", "operator", { tienTo: "r1b2b2t1", ts: RUN, ten: "R1B2B2 T1 op" });
  userIds.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`);
  op = { id: u.id, name: u.name, caller: scadaCommandsRouter.createCaller({ user: { id: u.id, role: "operator", name: u.name, twoFactorEnabled: false } } as never) };
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  try {
    boDem?.xoaAdapter(fx.aG);
    await stubG?.disconnect();
    await stubG2?.disconnect();
  } catch {
    /* bỏ qua */
  }
  if (!db) return;
  try {
    for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool LIKE 'hmi.%'`);
    for (const id of [fx.aG, fx.aG2].filter(Boolean)) {
      await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${id}`);
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
      await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
    }
    await dung(sql`DELETE FROM machines WHERE code IN (${RUN + "mg"}, ${RUN + "mg2"})`);
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${fx.fCode}`);
    await dung(sql`DELETE FROM stations WHERE code = ${fx.fCode}`);
    await dung(sql`DELETE FROM production_lines WHERE code = ${fx.fCode}`);
    await dung(sql`DELETE FROM workshops WHERE code = ${fx.fCode}`);
    await dung(sql`DELETE FROM factories WHERE code = ${fx.fCode}`);
  } catch (e) {
    console.warn("[r1b2b2t1] dọn dữ liệu:", (e as Error).message, String((e as { cause?: unknown }).cause ?? ""));
  }
}, 120_000);

beforeEach(() => {
  H.chanInterlock = new Set([fx.aG]);
  loiLog = vi.spyOn(logger, "error");
  canhLog = vi.spyOn(logger, "warn");
});
afterEach(async () => {
  H.chamAudit = false;
  H.chamThu = false;
  for (const g of dangGiu.splice(0)) await g.nha();
  // mọi lượt ghi bỏ rơi của ca này đã xong (bộ đếm của tiến trình sạch cho ca sau)
  // mọi lượt treo + hàng chờ + tóm tắt của ca này đã xả (trạng thái của tiến trình sạch cho ca sau)
  await vi.waitFor(() => expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0, tomTatCho: 0 }), { timeout: 20_000, interval: 50 });
  vi.restoreAllMocks();
}, 40_000);

describe("R1b-2b-2a T1 — ngân sách pool của tiến trình test", () => {
  it("pool 18 − 1 kết nối giữ − trần 8 = 9 = DU_TRU_POOL_CHO_DUNG_MAY", () => {
    expect(resolvePoolMax()).toBe(18);
    expect(resolvePoolMax() - 1 - TRAN).toBe(DU_TRU_POOL_CHO_DUNG_MAY);
  });
});

describe("★ Review Focus 1 (KD-A1) — 12 lần bấm SONG SONG khi CHỈ audit chậm", () => {
  it("★ backend chờ khoá audit ≤ 8 NGAY và SUỐT; 12 × acked_verified; audit XẾP HÀNG (0 bị bỏ); máy G2 vẫn dừng trong hạn KHI hàng chờ có mục; DB hết chậm ⇒ đủ 24 audit, lượt xếp hàng mang giờ sự kiện", async () => {
    const giu = await moGiu(H.khoaAudit);
    H.chamAudit = true;
    const boTruoc = demGhiBoQuaDay().tong;
    const ghiTruoc = stubG.ghi.length;
    const dTu = H.dispatchInputs.length;
    const [mc] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM control_audit_log`);
    const moc = Number(mc.m);
    const mau = layMau(giu.tx, [H.khoaAudit]);
    await cho(5);
    const { kq, phatTrong } = await bamSongSong(fx.mG, SO_BAM);
    expect(phatTrong, "12 lần bấm phát trong < 500 ms").toBeLessThan(500);
    // STOP không đổi kết quả: 12 × acked_verified, 12 lượt ghi thật tới thiết bị
    kq.forEach((k, i) => expect(k.ketQua[0], `lần bấm ${i + 1}`).toMatchObject({ adapterId: fx.aG, status: "acked_verified", ok: true }));
    expect(stubG.ghi.length - ghiTruoc).toBe(SO_BAM);
    expect(H.dispatchInputs.slice(dTu).filter((x) => x.adapterId === fx.aG)).toHaveLength(SO_BAM);
    await cho(300); // "và SUỐT": lượt ghi nền phát sau câu trả lời (void) đã tới Postgres
    const m = await mau.dung();
    console.info(`[r1b2b2t1] RF1: ${m.soMau} mẫu, max backend chờ audit ${m.maxPg}, max đếm JS ${m.maxJs}, hàng chờ ${trangThaiGhiTreo().hangCho}`);
    expect(m.soMau).toBeGreaterThan(5);
    expect(m.maxPg, "số backend NOT granted trên khoá audit — mọi mẫu").toBeLessThanOrEqual(TRAN);
    expect(m.maxJs).toBeLessThanOrEqual(TRAN);
    const choLuc = await demCho(giu.tx, [H.khoaAudit]);
    expect(choLuc).toBeLessThanOrEqual(TRAN);
    expect(choLuc, "audit chậm THẬT (lượt treo đã tới Postgres)").toBeGreaterThanOrEqual(1);
    // 2 nguồn audit chậm mỗi lần bấm (HMI + dispatcher): đang chờ ở Postgres + CÒN trong hàng chờ = 24 — không lượt nào bị bỏ (một lượt xếp hàng
    // có thể đã được xả rồi treo — nó nằm ở vế đầu)
    const xepAudit = logCanh((o) => o.cho === "audit_hmi_stop_xep_hang" || o.cho === "dispatch_pinned_stop_audit_xep_hang");
    expect(choLuc + (trangThaiGhiTreo().hangChoTheoBang.control_audit_log ?? 0)).toBe(2 * SO_BAM);
    expect(xepAudit.filter((o) => o.cho === "audit_hmi_stop_xep_hang").length).toBeGreaterThanOrEqual(4);
    expect(boLog()).toEqual([]);
    expect(demGhiBoQuaDay().tong - boTruoc).toBe(0);
    expect(trangThaiGhiTreo().hangCho).toBeGreaterThanOrEqual(xepAudit.length > 0 ? 1 : 0);

    // (c) điều phối — máy KHÁC (G2) vẫn dừng trong hạn KHI hàng chờ đang có mục và trần đầy (pha trước-gửi còn kết nối: 9 dự trữ)
    expect(trangThaiGhiTreo().dangBay).toBe(TRAN);
    const ghi2 = stubG2.ghi.length;
    const lag = batDauDoLag();
    const batDau = Date.now();
    const kq2 = await op.caller.dungMay({ machineId: fx.mG2, clientRequestId: uuid() });
    const tra = Date.now();
    const truocGui = H.lucVaoDispatch.get(fx.aG2)! - batDau;
    const dongDispatch = H.lucRaDispatch.get(fx.aG2)! - H.lucVaoDispatch.get(fx.aG2)!;
    const sauDispatch = tra - H.lucRaDispatch.get(fx.aG2)!;
    console.info(`[r1b2b2t1] G2: trôi ${tra - batDau} ms; truocGui ${truocGui} · dispatch ${dongDispatch} · sauDispatch ${sauDispatch}`);
    expect(kq2.ketQua[0]).toMatchObject({ adapterId: fx.aG2, status: "acked_verified", ok: true });
    expect(stubG2.ghi.length - ghi2).toBe(1);
    // trước-gửi: bảo đảm mà trần giữ (đọc không xếp hàng sau lượt ghi treo) — trễ / vòng bận ở đầu dungMayHmi ⇒ đỏ
    expect(truocGui).toBeLessThan(1_000 + (await lag.dung(150)));
    // dispatch: cận chống treo của thiết bị đo (T0 b)
    expect(dongDispatch).toBeLessThan(2_500 + (await lag.dung(300)));
    // sau dispatch: chốt dòng chờ + attempts XẾP HÀNG (trả ngay) — STOP không chờ hàng chờ
    expect(sauDispatch).toBeLessThan(500 + 400 + (await lag.dung(300)));
    expect(await demCho(giu.tx, [H.khoaAudit])).toBeLessThanOrEqual(TRAN);

    // DB hết chậm ⇒ hàng chờ xả dưới CÙNG trần: đủ 12 audit HMI DA_GUI (+1 của G2) + 12 override; lượt xếp hàng mang giờ SỰ KIỆN (trước lúc nhả)
    const lucNha = Date.now();
    H.chamAudit = false;
    await giu.nha();
    let hmi: any[] = [];
    let ovr: any[] = [];
    await vi.waitFor(
      async () => {
        hmi = await dung(sql`SELECT "afterJson" FROM control_audit_log WHERE id > ${moc} AND action = 'scada_hmi_stop' AND "entityId" = ${String(fx.mG)}`);
        ovr = await dung(sql`SELECT "afterJson" FROM control_audit_log WHERE id > ${moc} AND action = 'stop_interlock_override' AND "afterJson"->>'adapterId' = ${String(fx.aG)}`);
        if (hmi.length < SO_BAM || ovr.length < SO_BAM) throw new Error(`chưa xả: hmi ${hmi.length} override ${ovr.length}`);
      },
      { timeout: 15_000, interval: 50 },
    );
    expect(hmi).toHaveLength(SO_BAM);
    expect(ovr).toHaveLength(SO_BAM);
    const tuHang = [...hmi, ...ovr].filter((r) => r.afterJson?.tuHangCho === true);
    expect(tuHang.length, "mọi audit đã xếp hàng mang dấu tuHangCho").toBe(xepAudit.length);
    for (const r of tuHang) expect(Date.parse(r.afterJson.lucSuKien), "giờ sự kiện ≤ lúc DB hết chậm (không phải giờ xả)").toBeLessThanOrEqual(lucNha);
    await vi.waitFor(() => expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0, tomTatCho: 0 }), { timeout: 10_000, interval: 50 });
  }, 60_000);
});

describe("★ audit + attempts CÙNG chậm — 12 lần bấm song song", () => {
  it("tổng backend chờ trên HAI khoá ≤ 8 ở mọi mẫu; 12 × acked_verified; 0 bị bỏ; DB hết chậm ⇒ 12 attempts, attempts xếp hàng mang `at` = giờ sự kiện", async () => {
    const gA = await moGiu(H.khoaAudit);
    const gT = await moGiu(H.khoaThu);
    H.chamAudit = true;
    H.chamThu = true;
    const mThu = await mocThu();
    const mau = layMau(gA.tx, [H.khoaAudit, H.khoaThu]);
    await cho(5);
    const { kq, phatTrong } = await bamSongSong(fx.mG, SO_BAM);
    expect(phatTrong).toBeLessThan(500);
    kq.forEach((k, i) => expect(k.ketQua[0], `lần bấm ${i + 1}`).toMatchObject({ adapterId: fx.aG, status: "acked_verified", ok: true }));
    await cho(300);
    const m = await mau.dung();
    console.info(`[r1b2b2t1] audit+attempts: ${m.soMau} mẫu, max backend chờ ${m.maxPg}, max đếm JS ${m.maxJs}, hàng chờ ${trangThaiGhiTreo().hangCho}`);
    expect(m.maxPg).toBeLessThanOrEqual(TRAN);
    expect(m.maxJs).toBeLessThanOrEqual(TRAN);
    expect(await demCho(gA.tx, [H.khoaAudit, H.khoaThu])).toBeLessThanOrEqual(TRAN);
    expect(boLog()).toEqual([]);
    const lucNha = Date.now();
    H.chamAudit = false;
    H.chamThu = false;
    await gT.nha();
    await gA.nha();
    let rows: Array<{ at: Date; request_id: string }> = [];
    await vi.waitFor(
      async () => {
        rows = (await dung(sql`SELECT at, request_id FROM scada_command_attempts WHERE id > ${mThu} AND user_id = ${op.id} AND adapter_id = ${fx.aG} AND outcome = 'dispatched'`)) as typeof rows;
        if (rows.length < SO_BAM) throw new Error(`attempts chưa đủ ${rows.length}`);
      },
      { timeout: 15_000, interval: 50 },
    );
    expect(rows).toHaveLength(SO_BAM);
    const xepThu = logCanh((o) => o.cho === "attempts_hmi_stop_xep_hang");
    // lượt attempts XẾP HÀNG: cột `at` = giờ sự kiện (TRƯỚC lúc nhả), không phải giờ xả
    const truocNha = rows.filter((r) => new Date(r.at).getTime() <= lucNha);
    expect(truocNha.length, `attempts có at ≤ lúc nhả (xếp hàng ${xepThu.length})`).toBe(SO_BAM);
    await vi.waitFor(() => expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0 }), { timeout: 10_000, interval: 50 });
  }, 60_000);
});

describe("★ STOP_QUA_HAN (hạn tổng đã cạn) dưới audit chậm", () => {
  // handler nhận hạn tổng ĐÃ cạn (middleware vừa kịp) — khuôn hanTruocGui.r1b2 "buoc het_han_tong_truoc_handler": gọi THẲNG dungMayHmi (qua router,
  // middleware cổng đổi mật khẩu từ chối trước ở pha xac_thuc — không có dòng sổ)
  const dungHetHan = async (clientRequestId: string) => {
    const { dungMayHmi } = await import("../services/scada/lenhHmi");
    const kq = await dungMayHmi(
      { user: { id: op.id, role: "operator", twoFactorEnabled: false } } as never,
      { userId: op.id, userRole: "operator" } as never,
      { machineId: fx.mG, clientRequestId },
      { hanChotYeuCau: Date.now() - 1 },
    );
    return kq.ok ? "ok" : kq.tuChoi.ma;
  };
  const thuQuaHan = async () =>
    (await dung(sql`SELECT reason_code, adapter_id, requested_value, at FROM scada_command_attempts WHERE user_id = ${op.id} AND reason_code = 'STOP_QUA_HAN'
      AND requested_value->>'buoc' = 'het_han_tong_truoc_handler' AND at > now() - interval '1 minute' ORDER BY id`)) as Array<{ requested_value: any; at: Date }>;
  /** bấm TUẦN TỰ máy G (mỗi lần: audit override + audit HMI, cả hai chậm) tới khi trần đầy */
  const lamDayTran = async () => {
    for (let i = 0; i < 2 * TRAN && soGhiSoTreoStopHmi() < TRAN; i++) {
      const k = await op.caller.dungMay({ machineId: fx.mG, clientRequestId: uuid() });
      expect(k.ketQua[0]).toMatchObject({ status: "acked_verified" });
      await cho(20);
    }
    await vi.waitFor(() => expect(soGhiSoTreoStopHmi()).toBe(TRAN), { timeout: 5_000, interval: 25 });
  };

  it("trần CÒN chỗ: STOP_QUA_HAN; dòng attempts CÓ (attempts nhanh); bộ đếm khongGhiSo KHÔNG đổi; audit QUA_HAN đang chờ (chậm thật)", async () => {
    const giu = await moGiu(H.khoaAudit);
    H.chamAudit = true;
    const truoc = demStopQuaHanKhongGhiSo().tong;
    const nTruoc = (await thuQuaHan()).length;
    expect(await dungHetHan(uuid())).toBe("STOP_QUA_HAN");
    await vi.waitFor(async () => {
      if ((await thuQuaHan()).length < nTruoc + 1) throw new Error("attempts chưa ghi");
    }, { timeout: 3_000, interval: 25 });
    await vi.waitFor(async () => {
      if ((await demCho(giu.tx, [H.khoaAudit])) < 1) throw new Error("audit QUA_HAN chưa tới Postgres");
    }, { timeout: 3_000, interval: 25 });
    expect(demStopQuaHanKhongGhiSo().tong).toBe(truoc);
    expect(boLog()).toEqual([]);
  }, 30_000);

  it("★ trần ĐẦY ⇒ STOP_QUA_HAN vẫn trả NGAY; attempts + audit QUA_HAN XẾP HÀNG (ghi_so_loi KHÔNG đổi); DB hết chậm ⇒ dòng attempts có, `at` = giờ sự kiện; audit có lucSuKien", async () => {
    const giu = await moGiu(H.khoaAudit);
    H.chamAudit = true;
    await lamDayTran();
    const truoc = demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi ?? 0;
    const nTruoc = (await thuQuaHan()).length;
    canhLog.mockClear();
    const crid = uuid();
    const lucBam = Date.now();
    expect(await dungHetHan(crid)).toBe("STOP_QUA_HAN");
    expect(logCanh((o) => o.cho === "attempts_hmi_stop_qua_han_xep_hang")).toHaveLength(1);
    expect(logCanh((o) => o.cho === "audit_hmi_stop_qua_han_xep_hang")).toHaveLength(1);
    expect(demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi ?? 0).toBe(truoc);
    await cho(300);
    const lucNha = Date.now();
    H.chamAudit = false;
    await giu.nha();
    let rows: Array<{ requested_value: any; at: Date }> = [];
    await vi.waitFor(async () => {
      rows = await thuQuaHan();
      if (rows.length < nTruoc + 1) throw new Error("attempts chưa ghi");
    }, { timeout: 10_000, interval: 25 });
    const dong = rows.at(-1)!;
    expect(dong.requested_value).toMatchObject({ buoc: "het_han_tong_truoc_handler", machineId: fx.mG });
    expect(new Date(dong.at).getTime(), "at = giờ sự kiện (lúc bấm), không phải lúc xả").toBeLessThan(lucNha);
    expect(new Date(dong.at).getTime()).toBeGreaterThanOrEqual(lucBam - 5);
    let au: any[] = [];
    await vi.waitFor(async () => {
      au = (await dung(sql`SELECT "afterJson" FROM control_audit_log WHERE action = 'scada_hmi_stop' AND "afterJson"->>'clientRequestId' = ${crid}`)) as any[];
      if (au.length < 1) throw new Error("audit QUA_HAN chưa ghi");
    }, { timeout: 10_000, interval: 25 });
    expect(au[0].afterJson).toMatchObject({ ketCuc: "QUA_HAN", tuHangCho: true });
    expect(Date.parse(au[0].afterJson.lucSuKien)).toBeLessThan(lucNha);
    expect(demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi ?? 0).toBe(truoc);
  }, 60_000);

  it("★ hàng chờ TRÀN ⇒ attempts STOP_QUA_HAN BỊ BỎ có nội dung ⇒ ghi_so_loi +1 (Q2) + đếm posture; DB hết chậm ⇒ MỘT dòng tóm tắt ot_stop_ghi_nen_bo_roi chứa requestId", async () => {
    const giu = await moGiu(H.khoaAudit);
    H.chamAudit = true;
    await lamDayTran();
    // lấp hàng chờ bằng lượt nền giả (giải ở cuối) — tràn là trạng thái của tiến trình, không của nguồn nào
    const nhaGia = (() => {
      let r!: () => void;
      const p = new Promise<void>((a) => (r = a));
      return { p, r };
    })();
    while (trangThaiGhiTreo().hangCho < TRAN_HANG_CHO_GHI_NEN) void ghiCoTran(() => nhaGia.p, { nhan: "lap_hang_cho", requestId: "lap" });
    const truoc = demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi ?? 0;
    const bqTruoc = demGhiBoQuaDay().theoBang;
    const nTruoc = (await thuQuaHan()).length;
    const [mc] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM control_audit_log`);
    loiLog.mockClear();
    const crid = uuid();
    expect(await dungHetHan(crid)).toBe("STOP_QUA_HAN");
    expect(demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi ?? 0).toBe(truoc + 1);
    const bqThu = boLog().filter((o) => o.cho === "attempts_hmi_stop_qua_han_bo_tran");
    expect(bqThu).toHaveLength(1);
    expect(bqThu[0].noiDung).toMatchObject({ bang: "scada_command_attempts", reasonCode: "STOP_QUA_HAN", outcome: "rejected" });
    expect(bqThu[0].noiDung.requestedValue).toMatchObject({ buoc: "het_han_tong_truoc_handler", machineId: fx.mG });
    const bqAu = boLog().filter((o) => o.cho === "audit_hmi_stop_qua_han_bo_tran");
    expect(bqAu).toHaveLength(1);
    expect(bqAu[0].noiDung).toMatchObject({ bang: "control_audit_log", action: "scada_hmi_stop", after: { ketCuc: "QUA_HAN", clientRequestId: crid } });
    const bqSau = demGhiBoQuaDay().theoBang;
    expect((bqSau.scada_command_attempts ?? 0) - (bqTruoc.scada_command_attempts ?? 0)).toBe(1);
    expect((bqSau.control_audit_log ?? 0) - (bqTruoc.control_audit_log ?? 0)).toBe(1);
    // fix round 2 (re-review m4) — (c) ở chế độ TRÀN: hàng chờ ĐẦY 256 + trần đầy ⇒ STOP máy KHÁC vẫn trong hạn (mọi lượt ghi nền của nó đi qua `bo()`)
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: TRAN, hangCho: TRAN_HANG_CHO_GHI_NEN });
    const boTruocG2 = boLog().length;
    const lag = batDauDoLag();
    const batDau = Date.now();
    const kq2 = await op.caller.dungMay({ machineId: fx.mG2, clientRequestId: uuid() });
    const truocGui = H.lucVaoDispatch.get(fx.aG2)! - batDau;
    const sauDispatch = Date.now() - H.lucRaDispatch.get(fx.aG2)!;
    console.info(`[r1b2b2t1] G2 khi hàng chờ TRÀN: truocGui ${truocGui} · sauDispatch ${sauDispatch}`);
    expect(kq2.ketQua[0]).toMatchObject({ adapterId: fx.aG2, status: "acked_verified", ok: true });
    expect(truocGui).toBeLessThan(1_000 + (await lag.dung(150)));
    expect(sauDispatch).toBeLessThan(500 + 400 + (await lag.dung(300)));
    const boG2 = boLog().length - boTruocG2;
    expect(boG2, "các lượt ghi nền của G2 bị bỏ vì tràn (có log + tóm tắt)").toBeGreaterThanOrEqual(1);
    // DB hết chậm + lượt giả xong ⇒ hàng chờ xả; MỘT dòng tóm tắt (SEC_PLATFORM tắt ở tệp này: INSERT thường)
    H.chamAudit = false;
    nhaGia.r();
    await giu.nha();
    let tt: any[] = [];
    await vi.waitFor(async () => {
      tt = (await dung(sql`SELECT "afterJson" FROM control_audit_log WHERE id > ${Number(mc.m)} AND action = 'ot_stop_ghi_nen_bo_roi'`)) as any[];
      tt = tt.filter((r) => r.afterJson?.requestIds?.includes(crid));
      if (tt.length < 1) throw new Error("chưa có tóm tắt");
    }, { timeout: 15_000, interval: 50 });
    expect(tt).toHaveLength(1);
    expect(tt[0].afterJson).toMatchObject({ soLuong: 2 + boG2, theoLyDo: { tran: 2 + boG2 }, theoNhan: { attempts_hmi_stop_qua_han: 1, audit_hmi_stop_qua_han: 1 } });
    expect(tt[0].afterJson.ma).toEqual(expect.any(String));
    await cho(200);
    expect((await thuQuaHan()).length).toBe(nTruoc); // dòng bị bỏ: không có hàng (chỉ log + đếm + tóm tắt)
    await vi.waitFor(() => expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0, tomTatCho: 0 }), { timeout: 15_000, interval: 50 });
  }, 90_000);
});

describe("đối chứng — DB nhanh: không lượt nào xếp hàng / bị bỏ / chạm hạn; đúng 1 audit HMI + 1 audit override mỗi lần bấm", () => {
  it("5 lần bấm tuần tự ⇒ 5 × acked_verified; 5 audit scada_hmi_stop (DA_GUI) + 5 stop_interlock_override; 0 xếp hàng, 0 bỏ, 0 `_qua_han`; đếm về 0", async () => {
    const [mc] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM control_audit_log`);
    const moc = Number(mc.m);
    const crids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const crid = uuid();
      crids.push(crid);
      const kq = await op.caller.dungMay({ machineId: fx.mG, clientRequestId: crid });
      expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.aG, status: "acked_verified", ok: true });
    }
    let hmi: Array<{ afterJson: any }> = [];
    let ovr: Array<{ afterJson: any }> = [];
    await vi.waitFor(
      async () => {
        hmi = (await dung(sql`SELECT "afterJson" FROM control_audit_log WHERE id > ${moc} AND action = 'scada_hmi_stop' AND "entityId" = ${String(fx.mG)}`)) as typeof hmi;
        ovr = (await dung(sql`SELECT "afterJson" FROM control_audit_log WHERE id > ${moc} AND action = 'stop_interlock_override' AND "afterJson"->>'adapterId' = ${String(fx.aG)}`)) as typeof ovr;
        if (hmi.length < 5 || ovr.length < 5) throw new Error("audit chưa đủ");
      },
      { timeout: 5_000, interval: 50 },
    );
    expect(hmi.map((r) => r.afterJson.clientRequestId).sort()).toEqual([...crids].sort());
    expect(hmi.every((r) => r.afterJson.ketCuc === "DA_GUI" && r.afterJson.tuHangCho === undefined)).toBe(true);
    expect(ovr).toHaveLength(5);
    expect(boLog()).toEqual([]);
    expect(logCanh((o) => o.cho!.endsWith("_xep_hang"))).toEqual([]);
    expect([...logCo((o) => o.cho!.endsWith("_qua_han")), ...logCanh((o) => o.cho!.endsWith("_qua_han"))]).toEqual([]);
    expect(soGhiSoTreoStopHmi()).toBe(0);
  }, 30_000);
});
