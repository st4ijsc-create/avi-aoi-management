/**
 * SCADA R1b-2b-1 Task 9 (mục 44) — STOP HMI (`scadaCommands.dungMay`): mỗi lượt ghi sổ trên đường TRẢ LỜI (từ chối trước-gửi; chốt dòng chờ +
 * attempts sau dispatch) có hạn `HAN_GHI_SO_STOP_HMI_MS` = 500 ms. CSDL `_test` THẬT: router tRPC THẬT → `lenhHmi.dungMayHmi` (KHÔNG giả
 * gì bên trong) → `dispatch()` THẬT → StubDriver THẬT (RAM).
 *
 * ── SỔ CHẬM THẬT — cách chọn (điều kiện điều phối C2/C14: KHÔNG khoá bảng độc quyền) ─────────────────────────────────────────────────────
 * Brief gốc: `LOCK TABLE scada_command_attempts, ai_pending_actions IN EXCLUSIVE MODE` 5 s — BỊ CẤM: `_test` dùng chung, khoá treo mọi tệp DB
 * khác (kể cả phiên khác) đang ghi hai bảng đó. Khoá HÀNG thì không làm được cho attempts: bảng không có FK, không unique nào ngoài id
 * bigserial (đặt trước id ⇒ chặn lượt chèn của MỌI phiên). Trigger thử nghiệm trên bảng thật = đổi schema dùng chung (census trigger / WORM
 * của phiên khác thấy). ⇒ Chọn: **BÃO HOÀ POOL kết nối của CHÍNH tiến trình test** — DB "chậm-mà-sống" đúng như người vận hành gặp (truy vấn
 * xếp hàng chờ kết nối):
 *   · một giao dịch (kết nối "giữ", lấy từ pool) cầm `pg_advisory_xact_lock(LOP, pid)`; (DB_POOL_MAX − 1) truy vấn `pg_advisory_xact_lock`
 *     cùng khoá chiếm MỌI kết nối còn lại của pool, bị Postgres CHẶN THẬT (khoá thật, không hẹn giờ giả). Lượt ghi sổ kế tiếp của `dungMay`
 *     xếp hàng trong postgres.js tới khi khoá nhả (5000 ms sau khi bão hoà).
 *   · CHỨNG MINH bão hoà là thật (không giả định): kết nối giữ đếm trong `pg_locks` đủ (DB_POOL_MAX − 1) backend `NOT granted` trên khoá
 *     của tệp trước khi trả cho `dungMay`.
 *   · phạm vi: khoá advisory 2-khoá (LOP hằng của tệp, objid = pid tiến trình) ⇒ không phiên nào khác đụng; pool là của tiến trình này
 *     (vitest pool 'forks', mỗi tệp một tiến trình) ⇒ tệp khác / phiên khác không chờ gì. DB_POOL_MAX = 4 (vitest.setup) ⇒ chỉ 4 kết nối.
 *   · "rào" (thay cho rào dòng chờ của brief): bão hoà dựng NGAY SAU bản thật của callee — sau `dispatch()` thật (máy có ghim: dòng chờ đã
 *     chèn, STOP đã gửi) hoặc sau `loadStopPinsHmi` thật (máy chưa ghim: mọi lượt đọc trước-gửi đã xong). Bọc callee kiểu
 *     vi.mock(importOriginal) như hanTruocGui.r1b2 — `lenhHmi.ts` không bị giả chỗ nào.
 *   · Lúc trả lời, pool vẫn bão hoà ⇒ oracle "lượt ghi CHƯA xong" đọc qua CHÍNH kết nối giữ (dòng chờ còn 'confirmed', 0 dòng attempts).
 * Cận trên đồng hồ tường dùng `batDauDoLag` (server/testing/doLagBucleSuKien.ts — điều kiện C14); cận dưới (≥ số lượt × 500 ms) giữ thô:
 * chứng minh sổ chậm THẬT chạm hạn. Phần nới bị CHẶN TRÊN bằng chính cận (`lag.dung(CAN)`): ĐO 2026-10-26 trên máy Windows này
 * `setInterval(5)` chỉ bắn 64 lần/s (độ phân giải hẹn giờ ~15,6 ms) ⇒ bộ đo ghi ~68 % thời gian NGỦ thành "máy không chạy ta" (ngủ 1000 ms ⇒
 * nới 688 ms; ngủ 3000 ⇒ 2052) — không chặn thì cận 1700 ms nới tới ~5,3 s và đột biến "bỏ hạn" (chờ 5 s) chỉ đỏ với dư 14 ms. Thêm oracle: log `ghiLoiChot` nhãn `<nhan>_qua_han` (đếm lượt chạm hạn); đối chứng DB nhanh ⇒ 0 lượt.
 * `OT_CONTROL_ENABLED=true` CHỈ trong tiến trình (D9).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `r1b2bt9${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  dispatchInputs: [] as Array<{ adapterId: number; actionId: string }>,
  /** chạy SAU dispatch() thật, trước khi trả về lenhHmi (rào: STOP đã gửi, dòng chờ đã chèn) */
  sauDispatch: null as null | (() => Promise<unknown>),
  /** chạy SAU loadStopPinsHmi thật (rào: mọi lượt đọc trước-gửi đã xong) — theo adapterId */
  sauGhim: null as null | ((adapterId: number) => Promise<unknown> | undefined),
}));

vi.mock("../services/ot/stopPin", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/stopPin")>();
  return {
    ...real,
    loadStopPinsHmi: (async (...a: Parameters<typeof real.loadStopPinsHmi>) => {
      const kq = await real.loadStopPinsHmi(...a);
      if (H.sauGhim) await H.sauGhim(a[1]);
      return kq;
    }) as typeof real.loadStopPinsHmi,
  };
});

vi.mock("../services/ot/commandDispatcher", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/commandDispatcher")>();
  return {
    ...real,
    dispatch: async (...a: Parameters<typeof real.dispatch>) => {
      const inp = a[0] as { adapterId: number; triggeredBy?: { actionId?: string } };
      H.dispatchInputs.push({ adapterId: inp.adapterId, actionId: String(inp.triggeredBy?.actionId ?? "") });
      const kq = await real.dispatch(...a);
      if (H.sauDispatch) await H.sauDispatch();
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
      { code: "R1B2BT9-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
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
import { HAN_GHI_SO_STOP_HMI_MS } from "../services/scada/lenhHmi";
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
type Router = typeof import("./scadaCommandsRouter").scadaCommandsRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let scadaCommandsRouter: Router;
let boDem: typeof import("../services/scada/boDemHienTai");

const fx = { fCode: "", sid: 0, mG: 0, mN: 0, aG: 0, aN: 0 };
let stubG: StubGhi;
const userIds: number[] = [];
let op: { id: number; caller: Caller };

/** Sổ chậm giữ 5000 ms (brief) tính từ lúc pool bão hoà. */
const GIU_MS = 5_000;
/** Cận trên brief: chưa ghim — 1 lượt sổ; có ghim — 2 lượt sổ × 500 ms + dispatch stub. */
const CAN_CHUA_GHIM_MS = 1_200;
const CAN_CO_GHIM_MS = 1_700;
/** khoá advisory 2-khoá của tệp: (LOP, pid) — không phiên nào khác dùng */
const KHOA_LOP = 0x7509;
const KHOA_ID = process.pid;

const cho = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    (t as { unref?: () => void }).unref?.();
  });
async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

// ─── bão hoà pool (sổ chậm THẬT, phạm vi tiến trình này) ───────────────────────────────────────────────────────────────────────────
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
interface BaoHoa {
  /** kết nối GIỮ (ngoài hàng đợi pool) — đọc trạng thái sổ lúc pool còn bão hoà */
  tx: Tx;
  /** resolve khi khoá đã nhả và mọi truy vấn chiếm chỗ đã xong (hẹn GIU_MS hoặc `nha()`) */
  daNha: Promise<void>;
  nha(): Promise<void>;
  lucBaoHoa: number;
}
let baoHoa: BaoHoa | null = null;

async function moBaoHoa(giuMs: number): Promise<BaoHoa> {
  let nhaFn!: () => void;
  const nhaP = new Promise<void>((r) => (nhaFn = r));
  let coTx!: (tx: Tx) => void;
  const txP = new Promise<Tx>((r) => (coTx = r));
  const giu = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${KHOA_LOP}::int, ${KHOA_ID}::int)`);
    coTx(tx);
    await nhaP;
  });
  const tx = await Promise.race([txP, giu.then(() => Promise.reject(new Error("giao dịch giữ kết thúc sớm")))]);
  const n = resolvePoolMax() - 1;
  expect(n, "pool ≥ 2 — không thì không có kết nối nào để bão hoà").toBeGreaterThanOrEqual(1);
  const chiemCho = Array.from({ length: n }, () => Promise.resolve(db.execute(sql`SELECT pg_advisory_xact_lock(${KHOA_LOP}::int, ${KHOA_ID}::int)`)));
  // chứng minh bão hoà THẬT: n backend đang bị Postgres chặn trên khoá của tệp
  const t0 = Date.now();
  for (;;) {
    const [r] = (await tx.execute(
      sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid::bigint = ${KHOA_LOP} AND objid::bigint = ${KHOA_ID} AND objsubid = 2 AND NOT granted`,
    )) as unknown as Array<{ n: number }>;
    if (r.n >= n) break;
    if (Date.now() - t0 > 5_000) throw new Error(`pool không bão hoà: ${r.n}/${n} backend chờ khoá`);
    await cho(5);
  }
  const hen = setTimeout(nhaFn, giuMs);
  const daNha = (async () => {
    await giu.catch((e) => console.warn("[r1b2bt9] giao dịch giữ:", (e as Error).message));
    await Promise.allSettled(chiemCho);
  })();
  return {
    tx,
    daNha,
    lucBaoHoa: Date.now(),
    async nha() {
      clearTimeout(hen);
      nhaFn();
      await daNha;
    },
  };
}
const datBaoHoa = async () => {
  baoHoa = await moBaoHoa(GIU_MS);
};

// ─── oracle ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
const uuid = () => crypto.randomUUID();
async function moc(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM scada_command_attempts`);
  return Number(r.m);
}
type DongThu = { request_id: string | null; adapter_id: number | null; stage: string; outcome: string; reason_code: string | null; command_log_ids: number[] | null; ly_do: string | null; at: Date };
const cauThu = (m: number) => sql`SELECT request_id, adapter_id, stage, outcome, reason_code, command_log_ids, ly_do, at FROM scada_command_attempts
  WHERE id > ${m} AND user_id = ${op.id} ORDER BY id`;
const cauCho = (actionId: string) => sql`SELECT status::text AS status, "executedAt", "resultJson" FROM ai_pending_actions WHERE id = ${actionId}`;
let loiLog: ReturnType<typeof vi.spyOn>;
/** nhãn `ghiLoiChot` đã log (thân hàm = logger.error với `cho`) */
const nhanGhiLoiChot = () =>
  loiLog.mock.calls.map((c) => (c[0] as { cho?: unknown })?.cho).filter((x): x is string => typeof x === "string");

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

  const code = `${RUN}f`;
  fx.fCode = code;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  fx.sid = Number(s.id);
  const [mG] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${fx.sid}, ${RUN + "mg"}, 'May T9 ghim', 'AOI', true) RETURNING id`);
  const [mN] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${fx.sid}, ${RUN + "mn"}, 'May T9 chua ghim', 'AOI', true) RETURNING id`);
  fx.mG = Number(mG.id);
  fx.mN = Number(mN.id);

  const seedAdapter = async (mid: number, ma: string) => {
    const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
      VALUES (${mid}, ${`${RUN}-${ma}`}, ${`${RUN}-${ma}`}, 'stub', ${`stub://${RUN}-${ma}`}, 60000, true, 'disabled') RETURNING id`);
    return Number(r.id);
  };
  // máy G: REMOTE (kênh chế độ + mẫu = giá trị REMOTE), MỘT adapter, MỘT ghim DỪNG mức 1
  fx.aG = await seedAdapter(fx.mG, "ag");
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind)
    VALUES (${fx.aG}, 'che_do', 'M.che_do', 'int', false, true, 'input'::scada_channel_kind)`);
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, stop_value, stop_pinned_by, stop_pinned_at, actuation_level)
    VALUES (${fx.aG}, 'stop_cmd', 'M.stop_cmd', 'bool', true, true, 'input_output'::scada_channel_kind, 'true'::jsonb, '1', now(), 1)`);
  await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${fx.mG}, ${fx.aG}, 'che_do', '2'::jsonb, 1)`);
  boDem.datThongTinAdapter(fx.aG, { pollMs: 60_000, coDeadband: false, machineId: fx.mG, code: `${RUN}-ag` });
  boDem.napTuOt({ adapterId: fx.aG, machineId: fx.mG }, [{ tagKey: "che_do", raw: 2, value: 2, quality: "good" as const, timestamp: new Date() }]);
  // máy N: adapter BẬT, tag ghi được KHÔNG ghim ⇒ CHUA_GHIM_STOP (loadStopPinsHmi THẬT chạy cho adapter này — điểm rào)
  fx.aN = await seedAdapter(fx.mN, "an");
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind)
    VALUES (${fx.aN}, 'sp', 'M.sp', 'float', true, true, 'input_output'::scada_channel_kind)`);

  stubG = new StubGhi();
  await stubG.connect({ endpoint: `stub://${RUN}-ag` } as never);
  H.drivers.set(fx.aG, stubG);
  const [row] = await dung(sql`SELECT protocol, endpoint, "machineId", "connectionOptions" FROM device_adapters WHERE id = ${fx.aG}`);
  H.fingerprints.set(
    fx.aG,
    adapterTargetFingerprint({ protocol: row.protocol, endpoint: row.endpoint, machineId: row.machineId ?? null, connectionOptions: row.connectionOptions ?? null }),
  );

  const u = await taoNguoiDungTest("opT9", "operator", { tienTo: "r1b2bt9", ts: RUN, ten: "R1B2B T9 op" });
  userIds.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`);
  op = { id: u.id, caller: scadaCommandsRouter.createCaller({ user: { id: u.id, role: "operator", name: u.name, twoFactorEnabled: false } } as never) };
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  try {
    boDem?.xoaAdapter(fx.aG);
    await stubG?.disconnect();
  } catch {
    /* bỏ qua */
  }
  if (!db) return;
  try {
    for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool LIKE 'hmi.%'`);
    await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${fx.mG}`);
    for (const id of [fx.aG, fx.aN].filter(Boolean)) {
      await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${id}`);
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
      await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
    }
    await dung(sql`DELETE FROM machines WHERE code IN (${RUN + "mg"}, ${RUN + "mn"})`);
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${fx.fCode}`);
    await dung(sql`DELETE FROM stations WHERE code = ${fx.fCode}`);
    await dung(sql`DELETE FROM production_lines WHERE code = ${fx.fCode}`);
    await dung(sql`DELETE FROM workshops WHERE code = ${fx.fCode}`);
    await dung(sql`DELETE FROM factories WHERE code = ${fx.fCode}`);
  } catch (e) {
    console.warn("[r1b2bt9] dọn dữ liệu:", (e as Error).message, String((e as { cause?: unknown }).cause ?? ""));
  }
}, 120_000);

beforeEach(() => {
  H.sauDispatch = null;
  H.sauGhim = null;
  loiLog = vi.spyOn(logger, "error");
});
afterEach(async () => {
  H.sauDispatch = null;
  H.sauGhim = null;
  if (baoHoa) {
    await baoHoa.nha();
    baoHoa = null;
    await cho(300); // lượt ghi bị bỏ rơi (chạy nền) kịp xong trước ca sau
  }
  vi.restoreAllMocks();
});

describe("R1b-2b-1 T9 — hằng", () => {
  it("HAN_GHI_SO_STOP_HMI_MS = 500", () => {
    expect(HAN_GHI_SO_STOP_HMI_MS).toBe(500);
  });
});

describe("★ R1b-2b-1 T9 (mục 44) — sổ chậm THẬT: câu trả lời STOP không chờ sổ quá 500 ms mỗi lượt; kết quả STOP không đổi", () => {
  it("★ máy CHƯA ghim ⇒ CHUA_GHIM_STOP < 1200 ms; lúc trả lời dòng attempts CHƯA có (bỏ rơi); nền ghi xong khi DB hết chậm; dispatch 0", async () => {
    H.sauGhim = (adapterId) => (adapterId === fx.aN ? datBaoHoa() : undefined);
    const m = await moc();
    const dTu = H.dispatchInputs.length;
    const lag = batDauDoLag();
    const batDau = Date.now();
    const e = await loiCua(op.caller.dungMay({ machineId: fx.mN, clientRequestId: uuid() }));
    const troi = Date.now() - batDau;
    const phanNoi = await lag.dung(CAN_CHUA_GHIM_MS);
    console.info(`[r1b2bt9] trôi ${troi} ms, phần nới (máy không chạy ta) ${phanNoi} ms`);
    expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_STOP_NOT_PINNED", appParams: { ma: "CHUA_GHIM_STOP" } });
    expect(baoHoa, "rào đã dựng (sổ chậm thật)").not.toBeNull();
    // cận dưới thô: lượt sổ ĐÃ chạm hạn (không phải DB nhanh tình cờ)
    expect(troi).toBeGreaterThanOrEqual(HAN_GHI_SO_STOP_HMI_MS - 5);
    expect(troi).toBeLessThan(CAN_CHUA_GHIM_MS + phanNoi);
    expect(nhanGhiLoiChot()).toEqual(["attempts_hmi_stop_chua_ghim_qua_han"]);
    expect(H.dispatchInputs.length - dTu).toBe(0);
    // pool còn bão hoà ⇒ đọc qua kết nối giữ: dòng attempts CHƯA vào sổ
    const luc = (await baoHoa!.tx.execute(cauThu(m))) as unknown as DongThu[];
    expect(luc).toEqual([]);

    // brief: "sau 6 s ⇒ dòng attempts có trong sổ" — DB hết chậm 5 s sau khi bão hoà; lượt nền xong
    await baoHoa!.daNha;
    let rows: DongThu[] = [];
    await vi.waitFor(
      async () => {
        rows = (await dung(cauThu(m))) as DongThu[];
        if (rows.length < 1) throw new Error("attempts chưa ghi");
      },
      { timeout: 3_000, interval: 50 },
    );
    expect(Date.now() - batDau).toBeLessThan(GIU_MS + 3_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adapter_id: null, stage: "dispatch", outcome: "rejected", reason_code: "CHUA_GHIM_STOP" });
  }, 20_000);

  it("★ máy CÓ ghim ⇒ acked_verified (status/ok KHÔNG đổi) < 1700 ms; dispatch 1; lúc trả lời 0 attempts (bỏ rơi); nền: 1 attempts", async () => {
    H.sauDispatch = datBaoHoa;
    const m = await moc();
    const dTu = H.dispatchInputs.length;
    const ghiTruoc = stubG.ghi.length;
    const lag = batDauDoLag();
    const batDau = Date.now();
    const kq = await op.caller.dungMay({ machineId: fx.mG, clientRequestId: uuid() });
    const troi = Date.now() - batDau;
    const phanNoi = await lag.dung(CAN_CO_GHIM_MS);
    console.info(`[r1b2bt9] trôi ${troi} ms, phần nới (máy không chạy ta) ${phanNoi} ms`);
    expect(kq.ketQua).toHaveLength(1);
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.aG, status: "acked_verified", ok: true, simulated: false, writes: [{ tagKey: "stop_cmd", value: true }] });
    expect(kq.ketQua[0].commandLogIds).toHaveLength(1);
    expect(stubG.ghi.length - ghiTruoc).toBe(1);
    expect(stubG.ghi.at(-1)).toEqual([{ tagKey: "stop_cmd", value: true }]);
    const goi = H.dispatchInputs.slice(dTu);
    expect(goi.filter((d) => d.adapterId === fx.aG)).toHaveLength(1);
    const actionId = goi[0].actionId;
    expect(baoHoa, "rào đã dựng (sổ chậm thật)").not.toBeNull();
    // cận dưới thô: HAI lượt sổ (chốt dòng chờ + attempts) đều chạm hạn
    expect(troi).toBeGreaterThanOrEqual(2 * HAN_GHI_SO_STOP_HMI_MS - 10);
    expect(troi).toBeLessThan(CAN_CO_GHIM_MS + phanNoi);
    expect(nhanGhiLoiChot()).toEqual(["hmi_stop_sau_dispatch_qua_han", "attempts_hmi_stop_qua_han"]);
    // pool còn bão hoà ⇒ đọc qua kết nối giữ. Dòng chờ ĐÃ 'executed' — do dispatcher (đặt chỗ CAS confirmed→executed TRONG dispatch, trước rào);
    // lượt chốt của lenhHmi (CAS confirmed→…, ở đây khớp 0 hàng) còn xếp hàng — bằng chứng nó chạm hạn là log hmi_stop_sau_dispatch_qua_han ở trên.
    const [choLuc] = (await baoHoa!.tx.execute(cauCho(actionId))) as unknown as Array<{ status: string }>;
    expect(choLuc.status).toBe("executed");
    expect((await baoHoa!.tx.execute(cauThu(m))) as unknown as DongThu[]).toEqual([]);

    // nền: DB hết chậm ⇒ cả hai lượt bị bỏ rơi chạy xong (thứ tự giữa hai lượt nền KHÔNG được hứa — pool nhả nhiều kết nối cùng lúc)
    await baoHoa!.daNha;
    let rows: DongThu[] = [];
    await vi.waitFor(
      async () => {
        rows = (await dung(cauThu(m))) as DongThu[];
        if (rows.length < 1) throw new Error("attempts chưa ghi");
      },
      { timeout: 3_000, interval: 50 },
    );
    expect(Date.now() - batDau).toBeLessThan(GIU_MS + 3_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ request_id: actionId, adapter_id: fx.aG, stage: "dispatch", outcome: "dispatched", reason_code: null, ly_do: "STOP: acked_verified" });
    expect(rows[0].command_log_ids).toHaveLength(1);
    const [choSau] = await dung(cauCho(actionId));
    expect(choSau.status).toBe("executed");
  }, 20_000);
});

describe("đối chứng — DB nhanh: thứ tự + nội dung sổ như trước (dungMay.db.test.ts), không lượt nào chạm hạn", () => {
  it("máy CHƯA ghim ⇒ CHUA_GHIM_STOP; dòng attempts ĐÃ có ngay lúc trả lời; 0 log quá hạn", async () => {
    const m = await moc();
    const lag = batDauDoLag();
    const batDau = Date.now();
    const e = await loiCua(op.caller.dungMay({ machineId: fx.mN, clientRequestId: uuid() }));
    const troi = Date.now() - batDau;
    expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_STOP_NOT_PINNED", appParams: { ma: "CHUA_GHIM_STOP" } });
    expect(troi).toBeLessThan(CAN_CHUA_GHIM_MS + (await lag.dung(CAN_CHUA_GHIM_MS)));
    const rows = (await dung(cauThu(m))) as DongThu[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adapter_id: null, stage: "dispatch", outcome: "rejected", reason_code: "CHUA_GHIM_STOP" });
    expect(nhanGhiLoiChot()).toEqual([]);
  }, 20_000);

  it("máy CÓ ghim ⇒ acked_verified; dòng chờ 'executed' + ĐÚNG 1 dòng attempts ĐÃ có ngay lúc trả lời; chốt TRƯỚC attempts; 0 log quá hạn", async () => {
    const m = await moc();
    const dTu = H.dispatchInputs.length;
    const lag = batDauDoLag();
    const batDau = Date.now();
    const kq = await op.caller.dungMay({ machineId: fx.mG, clientRequestId: uuid() });
    const troi = Date.now() - batDau;
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.aG, status: "acked_verified", ok: true, simulated: false });
    expect(troi).toBeLessThan(CAN_CO_GHIM_MS + (await lag.dung(CAN_CO_GHIM_MS)));
    const actionId = H.dispatchInputs.slice(dTu)[0].actionId;
    const rows = (await dung(cauThu(m))) as DongThu[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ request_id: actionId, adapter_id: fx.aG, stage: "dispatch", outcome: "dispatched", reason_code: null, ly_do: "STOP: acked_verified" });
    const [choSau] = await dung(cauCho(actionId));
    expect(choSau.status).toBe("executed");
    // thứ tự: giao dịch chốt dòng chờ nhận xid TRƯỚC giao dịch chèn attempts (xid cấp theo thứ tự ghi đầu tiên; không lệ thuộc đồng hồ)
    const [x] = await dung(sql`SELECT (SELECT xmin::text::bigint FROM ai_pending_actions WHERE id = ${actionId}) AS cho,
      (SELECT xmin::text::bigint FROM scada_command_attempts WHERE id > ${m} AND user_id = ${op.id} AND request_id = ${actionId}) AS thu`);
    expect(Number(x.cho)).toBeLessThan(Number(x.thu));
    expect(nhanGhiLoiChot()).toEqual([]);
  }, 20_000);
});
