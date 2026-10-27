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
import { demGhiBoQuaDay } from "../services/ot/ghiTreoCoTran";
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
type BanLog = { cho?: string; noiDung?: any; requestId?: string };
const logCo = (pred: (o: BanLog) => boolean) => loiLog.mock.calls.map((c) => c[0] as BanLog).filter((o) => typeof o?.cho === "string" && pred(o));
const boQuaLog = () => logCo((o) => o.cho!.endsWith("_bo_qua_day"));

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
});
afterEach(async () => {
  H.chamAudit = false;
  H.chamThu = false;
  for (const g of dangGiu.splice(0)) await g.nha();
  // mọi lượt ghi bỏ rơi của ca này đã xong (bộ đếm của tiến trình sạch cho ca sau)
  await vi.waitFor(() => expect(soGhiSoTreoStopHmi()).toBe(0), { timeout: 15_000, interval: 50 });
  vi.restoreAllMocks();
}, 30_000);

describe("R1b-2b-2a T1 — ngân sách pool của tiến trình test", () => {
  it("pool 18 − 1 kết nối giữ − trần 8 = 9 = DU_TRU_POOL_CHO_DUNG_MAY", () => {
    expect(resolvePoolMax()).toBe(18);
    expect(resolvePoolMax() - 1 - TRAN).toBe(DU_TRU_POOL_CHO_DUNG_MAY);
  });
});

describe("★ Review Focus 1 (KD-A1) — 12 lần bấm SONG SONG khi CHỈ audit chậm", () => {
  it("★ backend chờ khoá audit ≤ 8 NGAY và SUỐT; 12 × acked_verified; audit bỏ qua có nội dung + được ĐẾM; máy G2 vẫn dừng trong hạn", async () => {
    const giu = await moGiu(H.khoaAudit);
    H.chamAudit = true;
    const boQuaTruoc = demGhiBoQuaDay().theoBang.control_audit_log ?? 0;
    const ghiTruoc = stubG.ghi.length;
    const dTu = H.dispatchInputs.length;
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
    console.info(`[r1b2b2t1] RF1: ${m.soMau} mẫu, max backend chờ audit ${m.maxPg}, max đếm JS ${m.maxJs}`);
    expect(m.soMau).toBeGreaterThan(5);
    expect(m.maxPg, "số backend NOT granted trên khoá audit — mọi mẫu").toBeLessThanOrEqual(TRAN);
    expect(m.maxJs).toBeLessThanOrEqual(TRAN);
    const choLuc = await demCho(giu.tx, [H.khoaAudit]);
    expect(choLuc).toBeLessThanOrEqual(TRAN);
    expect(choLuc, "audit chậm THẬT (lượt treo đã tới Postgres)").toBeGreaterThanOrEqual(1);

    // 2 nguồn audit chậm mỗi lần bấm (HMI + dispatcher) ⇒ đang chờ + bị bỏ qua = 24 (không lượt nào biến mất im lặng)
    const bqAudit = boQuaLog().filter((o) => o.noiDung?.bang === "control_audit_log");
    expect(choLuc + bqAudit.length).toBe(2 * SO_BAM);
    const bqHmi = bqAudit.filter((o) => o.cho === "audit_hmi_stop_bo_qua_day");
    expect(bqHmi.length).toBeGreaterThanOrEqual(4);
    for (const o of bqHmi) {
      expect(o.noiDung.action).toBe("scada_hmi_stop");
      expect(o.noiDung.after.ketCuc).toBe("DA_GUI");
      expect(o.noiDung.after.adapters[0]).toMatchObject({ adapterId: fx.aG, status: "acked_verified" });
    }
    for (const o of bqAudit.filter((x) => x.cho === "dispatch_pinned_stop_audit_bo_qua_day")) {
      expect(o.noiDung).toMatchObject({ bang: "control_audit_log", action: "stop_interlock_override", adapterId: fx.aG });
    }
    // KD-A3 — audit bị bỏ qua ĐƯỢC ĐẾM (posture), không chỉ log
    expect((demGhiBoQuaDay().theoBang.control_audit_log ?? 0) - boQuaTruoc).toBe(bqAudit.length);

    // máy KHÁC (G2) vẫn dừng trong hạn: pha trước-gửi còn kết nối (9 dự trữ)
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
    // sau dispatch: chốt dòng chờ + attempts nhanh (hoặc bỏ qua vì đầy); audit HMI là void
    expect(sauDispatch).toBeLessThan(500 + 400 + (await lag.dung(300)));
    expect(await demCho(giu.tx, [H.khoaAudit])).toBeLessThanOrEqual(TRAN);
  }, 60_000);
});

describe("★ audit + attempts CÙNG chậm — 12 lần bấm song song", () => {
  it("tổng backend chờ trên HAI khoá ≤ 8 ở mọi mẫu; 12 × acked_verified; đang chờ + bỏ qua = 3 nguồn × 12", async () => {
    const gA = await moGiu(H.khoaAudit);
    const gT = await moGiu(H.khoaThu);
    H.chamAudit = true;
    H.chamThu = true;
    const mau = layMau(gA.tx, [H.khoaAudit, H.khoaThu]);
    await cho(5);
    const { kq, phatTrong } = await bamSongSong(fx.mG, SO_BAM);
    expect(phatTrong).toBeLessThan(500);
    kq.forEach((k, i) => expect(k.ketQua[0], `lần bấm ${i + 1}`).toMatchObject({ adapterId: fx.aG, status: "acked_verified", ok: true }));
    await cho(300);
    const m = await mau.dung();
    console.info(`[r1b2b2t1] audit+attempts: ${m.soMau} mẫu, max backend chờ ${m.maxPg}, max đếm JS ${m.maxJs}`);
    expect(m.maxPg).toBeLessThanOrEqual(TRAN);
    expect(m.maxJs).toBeLessThanOrEqual(TRAN);
    const choLuc = await demCho(gA.tx, [H.khoaAudit, H.khoaThu]);
    expect(choLuc).toBeLessThanOrEqual(TRAN);
    const bq = boQuaLog().filter((o) => o.noiDung?.bang === "control_audit_log" || o.noiDung?.bang === "scada_command_attempts");
    expect(choLuc + bq.length).toBe(3 * SO_BAM);
    const bqThu = bq.filter((o) => o.cho === "attempts_hmi_stop_bo_qua_day");
    for (const o of bqThu) expect(o.noiDung).toMatchObject({ bang: "scada_command_attempts", adapterId: fx.aG, outcome: "dispatched" });
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
    (await dung(sql`SELECT reason_code, adapter_id, requested_value FROM scada_command_attempts WHERE user_id = ${op.id} AND reason_code = 'STOP_QUA_HAN'
      AND requested_value->>'buoc' = 'het_han_tong_truoc_handler' AND at > now() - interval '1 minute' ORDER BY id`)) as Array<{ requested_value: any }>;

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
    expect(boQuaLog()).toEqual([]);
  }, 30_000);

  it("★ trần ĐẦY (8 audit treo từ lần bấm máy G) ⇒ STOP_QUA_HAN vẫn trả; dòng attempts BỎ QUA có nội dung ⇒ ghi_so_loi +1; audit QUA_HAN bỏ qua ⇒ đếm posture", async () => {
    const giu = await moGiu(H.khoaAudit);
    H.chamAudit = true;
    // bấm TUẦN TỰ máy G (mỗi lần: audit override của dispatcher + audit HMI, cả hai chậm) tới khi đầy trần
    for (let i = 0; i < 2 * TRAN && soGhiSoTreoStopHmi() < TRAN; i++) {
      const k = await op.caller.dungMay({ machineId: fx.mG, clientRequestId: uuid() });
      expect(k.ketQua[0]).toMatchObject({ status: "acked_verified" });
      await cho(20);
    }
    await vi.waitFor(() => expect(soGhiSoTreoStopHmi()).toBe(TRAN), { timeout: 5_000, interval: 25 });
    await vi.waitFor(async () => {
      if ((await demCho(giu.tx, [H.khoaAudit])) < TRAN) throw new Error("chưa đủ 8 lượt treo ở Postgres");
    }, { timeout: 5_000, interval: 25 });
    const truoc = demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi ?? 0;
    const bqTruoc = demGhiBoQuaDay().theoBang;
    const nTruoc = (await thuQuaHan()).length;
    loiLog.mockClear();
    const crid = uuid();
    expect(await dungHetHan(crid)).toBe("STOP_QUA_HAN");
    expect(demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi ?? 0).toBe(truoc + 1);
    const bqThu = boQuaLog().filter((o) => o.cho === "attempts_hmi_stop_qua_han_bo_qua_day");
    expect(bqThu).toHaveLength(1);
    expect(bqThu[0].noiDung).toMatchObject({ bang: "scada_command_attempts", reasonCode: "STOP_QUA_HAN", outcome: "rejected" });
    expect(bqThu[0].noiDung.requestedValue).toMatchObject({ buoc: "het_han_tong_truoc_handler", machineId: fx.mG });
    const bqAu = boQuaLog().filter((o) => o.cho === "audit_hmi_stop_qua_han_bo_qua_day");
    expect(bqAu).toHaveLength(1);
    expect(bqAu[0].noiDung).toMatchObject({ bang: "control_audit_log", action: "scada_hmi_stop", after: { ketCuc: "QUA_HAN", clientRequestId: crid } });
    const bqSau = demGhiBoQuaDay().theoBang;
    expect((bqSau.scada_command_attempts ?? 0) - (bqTruoc.scada_command_attempts ?? 0)).toBe(1);
    expect((bqSau.control_audit_log ?? 0) - (bqTruoc.control_audit_log ?? 0)).toBe(1);
    expect(await demCho(giu.tx, [H.khoaAudit])).toBe(TRAN);
    await cho(200);
    expect((await thuQuaHan()).length).toBe(nTruoc); // không có dòng (chỉ log + đếm)
  }, 30_000);
});

describe("đối chứng — DB nhanh: không lượt nào bị bỏ qua / chạm hạn; đúng 1 audit HMI + 1 audit override mỗi lần bấm", () => {
  it("5 lần bấm tuần tự ⇒ 5 × acked_verified; 5 audit scada_hmi_stop (DA_GUI) + 5 stop_interlock_override; 0 `_bo_qua_day`, 0 `_qua_han`; đếm về 0", async () => {
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
    expect(hmi.every((r) => r.afterJson.ketCuc === "DA_GUI")).toBe(true);
    expect(ovr).toHaveLength(5);
    expect(boQuaLog()).toEqual([]);
    expect(logCo((o) => o.cho!.endsWith("_qua_han"))).toEqual([]);
    expect(soGhiSoTreoStopHmi()).toBe(0);
  }, 30_000);
});
