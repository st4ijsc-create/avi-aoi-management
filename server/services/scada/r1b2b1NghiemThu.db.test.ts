/**
 * SCADA R1b-2b-1 Task 16 — NGHIỆM THU R1b-2b-1 "An toàn, đúng đắn và nợ": lưới P1 B1 B2 Q1 M1 C1 R1 E1 T1 L1 L2 I1 A1 G3 G4 (+ đối chứng R1-đc) trên CSDL `_test`
 * THẬT (khuôn `r1b2aNghiemThu.db.test.ts`). Mỗi ô kiểm ĐÚNG thứ task sở hữu đã xây (sổ `.superpowers/sdd/2026-10-26-scada-r1b-2b-1-an-toan-va-no/
 * progress.md`; phán quyết thắng chữ kế hoạch).
 *
 * Đường chạy thật:
 *   • P1 (T1): `appRouter` THẬT (cổng buộc đổi mật khẩu thấy `path`), `scadaCommands.mayDungKhanCap` + `dungMay` → `dispatch()` THẬT → StubDriver.
 *   • B1 / R1 (T2 + T6): "dispatch AI" = `dispatch()` THẬT với dòng chờ AI ĐÃ XÁC NHẬN (tool `set_machine_param`, kind `hitl`) — ĐÚNG nguồn mà test DB
 *     của T2 dùng (`commandDispatcher.kenh.r1a.db.test.ts`): cổng AI (`AI_OT_CONTROL_ENABLED`) nằm ở TẦNG TOOL, `dispatch()` không đọc cờ ấy; cờ giữ
 *     "false" trong tiến trình. Driver Modbus THẬT (`ModbusDriver.writeTags` / `readTags`) trên một "thiết bị" giả trong RAM (coil + holding) —
 *     oracle độc lập: thiết bị nhận gì, đọc lại gì. Đọc lại BẬT (`OT_READBACK_ENABLED`) ⇒ trạng thái là `acked_verified` / `acked_unverified`.
 *   • B2 (T2): luật bật `"on"` trên tag bool ⇒ `luatLenhLechLuoi` (JS) ⊆ `TRUY_VAN_TRUOC_TRIEN_KHAI` ∪ `TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL` (SQL, hằng của mã).
 *   • Q1 / C1 (T3 + T5): phiên OT THẬT (`otManager.startOt`, vòng poll chung THẬT, `S7Driver` THẬT; chỉ thư viện nodes7 giả qua `loadPackage`).
 *     C1 chạy cả nhánh legacy và HA (ConnectionSupervisor thật). Đồng hồ thật, chu kỳ poll 300 ms.
 *   • M1 (T4): `MitsubishiMcDriver` THẬT, thư viện mcprotocol giả; thời gian TỈ LỆ theo `globalTimeout` của instance như T4 (400 ms ≙ 4500 ms:
 *     382 ms ≙ 4300 ms, 409 ms ≙ 4600 ms; đồng hồ của driver là `performance.now()` nên dùng hẹn giờ THẬT).
 *   • E1 (T7): `EthernetIpDriver` THẬT (Controller giả phát 'error' giữa connect), `SlmpDriver` THẬT (socket giả, callback ghi muộn).
 *   • T1 (T8): `stopOt({ tatTienTrinh: true })` THẬT trên adapter stub THẬT trong DB, ghi trạng thái DB THẬT (điều tiết 5 s).
 *   • L1 / L2 (T9): sổ chậm KHÔNG khoá bảng (điều kiện 2 / C14): L1 bão hoà pool CỦA CHÍNH tiến trình bằng khoá tư vấn (khuôn T9); L2 chỉ INSERT
 *     `scada_command_attempts` chờ khoá tư vấn (khuôn T9 fix round 1). Cận trên dùng `batDauDoLag` (server/testing/doLagBucleSuKien.ts) có trần.
 *   • I1 (T10): 5 thủ tục interlock THẬT; giao dịch "người đổi máy" THẬT khoá hàng adapter (đo chặn bằng `pg_blocking_pids`).
 *   • A1 (T11): `scadaKenh.khaiHangLoat` THẬT, TOTP THẬT, SEC_PLATFORM bật trong tiến trình, 20 `recordAuditEvent` song song bắn ĐÚNG lúc lô vào bước
 *     audit. Chuỗi chỉ kiểm ĐOẠN id của chính ô (chuỗi toàn bảng của `_test` dùng chung đã gãy ~1733 chỗ do phiên khác — sổ dòng 130 / 147).
 *   • G3 (T14): express + `createHmiStopLimiter` / `createAuthLimiter` THẬT, client ioredis THẬT (hạn 250 ms là của ioredis) nói RESP2 với máy chủ
 *     Redis GIẢ trong tiến trình (khuôn `rateLimitConfig.duPhongBoNho.test.ts`).
 *   • G4 (T15): `fetchRequestHandler` + `createContext` + `appRouter` THẬT; batch `[auth.logout, scadaCommands.dungMay]` (auth.me là QUERY nên không
 *     chung được một POST batch với mutation — mọi mutation anh em có cùng hình; createContext ném trước khi thủ tục nào chạy).
 *
 * Chỗ giả (hạ tầng, không phải cổng): `getActiveDriver` / `getActiveConnectionFingerprint`; `getIO`; `raiseCriticalStopAlert`; nguồn safety-PLC nền
 * (đọc sạch); `ingest` (không ghi telemetry); `dispatch` / `loadStopPinsHmi` / `recordAuditEvent(s)` BỌC (gọi xuyên bản thật, móc rào); `getDb` BỌC
 * (chỉ L2 đổi cách phát INSERT attempts); `loadEnabledAdapters` / `createDriver` chỉ đổi khi ô OT đặt móc.
 * `OT_CONTROL_ENABLED=true`, `AI_OT_CONTROL_ENABLED="false"` CHỈ trong tiến trình.
 *
 * Mã fixture RIÊNG `nt2b1…` (không `r1b2` / `pvk` / `tth` — script dọn `_test` của T13 không bắt nhầm). Dọn ở afterAll. `command_log` +
 * `scada_command_attempts` + `control_audit_log` là WORM: hàng của tệp ở lại (đúng thiết kế).
 *
 * CHỈ CHẠY KHI GỌI TƯỜNG MINH:
 *   Bash:       SCADA_R1B2B1_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r1b2b1NghiemThu.db.test.ts
 *   PowerShell: $env:SCADA_R1B2B1_NGHIEM_THU='1'; npx vitest run -c vitest.db.config.ts server/services/scada/r1b2b1NghiemThu.db.test.ts
 * Không đặt biến ⇒ cả tệp bị bỏ qua (không dựng dữ liệu).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { like, sql, type SQL } from "drizzle-orm";

const CHAY_NGHIEM_THU = process.env.SCADA_R1B2B1_NGHIEM_THU === "1";
const RUN = `nt2b1${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => {
  // L2 (khuôn T9 fix round 1): pool của TIẾN TRÌNH NÀY = trần lượt sổ treo (8) + 4 — đặt trước getDb() đầu tiên (client tạo lười).
  process.env.DB_POOL_MAX = "12";
  process.env.JWT_SECRET ||= "nt2b1-nghiem-thu-r1b2b1-secret";
  process.env.VITE_APP_ID ||= "avi-aoi-management";
  return {
    drivers: new Map<number, unknown>(),
    fingerprints: new Map<number, string>(),
    dispatchInputs: [] as Array<{ adapterId: number; actionId: string }>,
    /** chạy SAU dispatch() thật (rào STOP đã gửi) */
    sauDispatch: null as null | (() => Promise<unknown>),
    /** chạy SAU loadStopPinsHmi thật (rào: mọi lượt đọc trước-gửi đã xong) */
    sauGhim: null as null | ((adapterId: number) => Promise<unknown> | undefined),
    /** L2 — INSERT scada_command_attempts chạy trong giao dịch chờ khoá tư vấn `khoaThu` */
    chamThu: false,
    bangThu: null as unknown,
    khoaThu: [0x7516, process.pid] as const,
    /** A1 — gọi (không await) đúng lúc router gọi recordAuditEvents */
    truocLo: null as null | (() => void),
    /** ô OT — danh sách adapter thay cho loadEnabledAdapters; locIds ⇒ bản thật lọc theo id của ô */
    napAdapter: null as null | (() => Promise<unknown[]>),
    locIds: null as null | Set<number>,
    /** ô OT — tạo driver thay cho driverRegistry (null ⇒ bản thật) */
    taoDriver: null as null | ((p: string) => unknown),
    idTheoDoi: 0,
    bao: [] as string[],
    mau: [] as Array<{ quality: string; value: unknown; tagKey: string }>,
  };
});
const spy = vi.hoisted(() => ({ don: undefined as any, lo: undefined as any }));

vi.mock("../../_core/socket", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../_core/socket")>();
  return { ...real, getIO: () => ({ to: () => ({ emit: () => true }) }) as never };
});

// L2 — "CHỈ bảng sổ chậm" (khuôn T9 fix round 1): getDb THẬT bọc proxy; khi H.chamThu, INSERT scada_command_attempts chạy trong MỘT giao dịch THẬT
// chờ `pg_advisory_xact_lock(khoaThu)` rồi INSERT thật. Bảng / lượt khác đi nguyên. `lenhHmi.ts` không bị giả chỗ nào.
vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
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

vi.mock("../ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../ot/otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => H.fingerprints.get(adapterId),
  };
});

vi.mock("../ot/commandDispatcher", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ot/commandDispatcher")>();
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

vi.mock("../ot/stopPin", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ot/stopPin")>();
  return {
    ...real,
    loadStopPinsHmi: (async (...a: Parameters<typeof real.loadStopPinsHmi>) => {
      const kq = await real.loadStopPinsHmi(...a);
      if (H.sauGhim) await H.sauGhim(a[1]);
      return kq;
    }) as typeof real.loadStopPinsHmi,
  };
});

vi.mock("../robot/criticalStopAlert", async (importOriginal) => {
  const real = await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return { ...real, raiseCriticalStopAlert: async () => undefined };
});

vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [
      { code: "NT2B1-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
    ],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});

vi.mock("../audit/controlAuditService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../audit/controlAuditService")>();
  spy.don = vi.fn((...a: Parameters<typeof real.recordAuditEvent>) => real.recordAuditEvent(...a));
  spy.lo = vi.fn(async (...a: Parameters<typeof real.recordAuditEvents>) => {
    const truoc = H.truocLo;
    H.truocLo = null;
    truoc?.();
    return real.recordAuditEvents(...a);
  });
  return { ...real, recordAuditEvent: spy.don, recordAuditEvents: spy.lo };
});

vi.mock("../ot/driverRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ot/driverRegistry")>();
  return {
    ...real,
    createDriver: ((p: Parameters<typeof real.createDriver>[0]) => (H.taoDriver?.(p) as ReturnType<typeof real.createDriver>) ?? real.createDriver(p)) as typeof real.createDriver,
  };
});

vi.mock("../ot/deviceAdapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ot/deviceAdapter")>();
  return {
    ...real,
    loadEnabledAdapters: (async (...a: Parameters<typeof real.loadEnabledAdapters>) => {
      if (H.napAdapter) return (await H.napAdapter()) as Awaited<ReturnType<typeof real.loadEnabledAdapters>>;
      const ds = await real.loadEnabledAdapters(...a);
      return H.locIds ? ds.filter((x) => H.locIds!.has(x.adapterId)) : ds;
    }) as typeof real.loadEnabledAdapters,
  };
});

vi.mock("../ot/ingest", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ot/ingest")>();
  const ghi = (a: { adapterId?: number }, ms: Array<{ quality: string; value: unknown; tagKey: string }>) => {
    if (a?.adapterId === H.idTheoDoi) H.mau.push(...ms);
  };
  return {
    ...real,
    ingestSample: async (a: any, s: any) => ghi(a, [s]),
    ingestSamples: async (a: any, ms: any[]) => ghi(a, ms),
  };
});

vi.mock("../ot/trangThaiAdapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ot/trangThaiAdapter")>();
  return {
    ...real,
    baoTrangThaiAdapter: ((...args: Parameters<typeof real.baoTrangThaiAdapter>) => {
      if ((args[0] as { adapterId?: number })?.adapterId === H.idTheoDoi) H.bao.push(String(args[1]));
      return real.baoTrangThaiAdapter(...args);
    }) as typeof real.baoTrangThaiAdapter,
  };
});

import speakeasy from "speakeasy";
import { MemoryStore } from "express-rate-limit";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { COOKIE_NAME } from "@shared/const";
import { resolvePermissionModule } from "@shared/permissions";
import { getDb, resolvePoolMax } from "../../db/connection";
import { aiPendingActions, deviceTags, interlockRules, scadaCommandAttempts } from "../../../drizzle/schema";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { dongDauDuyetLuat } from "../../testing/dauDuyetInterlock";
import { batDauDoLag } from "../../testing/doLagBucleSuKien";
import { setup2FA, enable2FA } from "../../db/auth";
import { readAppErrorMeta } from "../../_core/appError";
import { logger } from "../../logger";
import { StubDriver, createStubDriver } from "../ot/drivers/stubDriver";
import { ModbusDriver } from "../ot/drivers/modbusDriver";
import { S7Driver } from "../ot/drivers/s7Driver";
import { MitsubishiMcDriver, MC_ERRCODE_QUA_HAN_GOI } from "../ot/drivers/mitsubishiMcDriver";
import { EthernetIpDriver } from "../ot/drivers/ethernetIpDriver";
import { SlmpDriver } from "../ot/drivers/slmpDriver";
import type { OtDriver, OtProtocol, OtTagAddress, SuKienDoc } from "../ot/otDriver";
import { laDocTot, laTickHong } from "../ot/reconnectNhanh";
import { otPayloadHash, withOtPayloadHash } from "../ot/otActionBinding";
import { adapterTargetFingerprint } from "../ot/adapterTarget";
import { GENESIS_HASH } from "../security/auditChain";
import { HAN_GHI_SO_STOP_HMI_MS, soGhiSoTreoStopHmi, TRAN_GHI_SO_TREO_STOP_HMI } from "./lenhHmi";
import { luatLenhLechLuoi, TRUY_VAN_TRUOC_TRIEN_KHAI, TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL } from "./lenhInterlockLechLuoi";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Goc = ReturnType<(typeof import("../../routers"))["appRouter"]["createCaller"]>;
type CmdCaller = ReturnType<(typeof import("../../routers/scadaCommandsRouter"))["scadaCommandsRouter"]["createCaller"]>;
type IlkCaller = ReturnType<(typeof import("../../routers/interlockRouter"))["interlockRouter"]["createCaller"]>;
type KenhCaller = ReturnType<(typeof import("../../routers/scadaKenhRouter"))["scadaKenhRouter"]["createCaller"]>;
type DispatchMod = typeof import("../ot/commandDispatcher");
type ThatAudit = typeof import("../audit/controlAuditService");

let db: Db;
let disp: DispatchMod;
let that!: ThatAudit;
const dung = async (q: SQL): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const cho = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    (t as { unref?: () => void }).unref?.();
  });
const uuid = () => crypto.randomUUID();
const inIds = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

// ─── môi trường: nền (BASE) + đặt tạm theo ô, trả về nền sau mỗi ô ────────────────────────────────────────────────────────────
const BASE: Record<string, string> = {
  SCADA_COMMANDS_ENABLED: "true",
  SCADA_LIVE_CACHE_ENABLED: "true",
  SCADA_CONG_CHE_DO_ENABLED: "false",
  OT_CONTROL_ENABLED: "true", // CHỈ trong tiến trình test
  OT_COMMISSIONING_REQUIRED: "false",
  OT_READBACK_ENABLED: "false", // HMI (dungMay) vẫn đọc lại (docLai bat_buoc); B1 / R1 bật riêng
  OT_CMD_SERIALIZE_ENABLED: "false",
  SEC_PLATFORM: "false",
  UNS_CMD_ACK_ENABLED: "false",
  AI_OT_CONTROL_ENABLED: "false", // GIỮ TẮT — dispatch() không đọc cờ này (cổng AI ở tầng tool)
  INTERLOCK_AUTO_BLOCK_ENABLED: "false",
  EDGE_RUNTIME_ENABLED: "false",
  OT_GATEWAY_ENABLED: "false",
  OT_CONN_HA_ENABLED: "false",
  OT_GHI_TRANG_THAI_ADAPTER_ENABLED: "false",
  OT_CHAT_LUONG_V2_ENABLED: "true",
};
const envGoc: Record<string, string | undefined> = {};
const envDaDat = new Set<string>();
function datEnv(o: Record<string, string>): void {
  for (const [k, v] of Object.entries(o)) {
    if (!(k in envGoc)) envGoc[k] = process.env[k];
    envDaDat.add(k);
    process.env[k] = v;
  }
}
function veBase(): void {
  for (const k of envDaDat) {
    if (k in BASE) process.env[k] = BASE[k];
    else if (envGoc[k] === undefined) delete process.env[k];
    else process.env[k] = envGoc[k]!;
  }
}

// ─── fixture ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type NhaMay = { sid: number; mid: number; mid2: number; code: string };
let A!: NhaMay;
let B!: NhaMay;
const factories: string[] = [];
const adapters: number[] = [];
const may = { P: 0, M: 0, L: 0, G: 0, G2: 0, K: 0 };
const AD = { P: 0, M: 0, L: 0, G: 0, G2: 0, K: 0 };
let TK: number[] = []; // 200 tag của A1

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${"Chuyen " + code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  const [m2] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code + "-2"}, ${code + " m2"}, 'AOI', true) RETURNING id`);
  factories.push(code);
  return { sid: Number(s.id), mid: Number(m.id), mid2: Number(m2.id), code };
}
async function seedMay(sid: number, ma: string): Promise<number> {
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${sid}, ${RUN + ma}, ${"May NT " + ma}, 'AOI', true) RETURNING id`);
  return Number(m.id);
}
async function seedAdapter(mid: number | null, ma: string, o: { protocol?: string; endpoint?: string; bat?: boolean } = {}): Promise<number> {
  const code = `${RUN}-${ma}`;
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${mid}, ${code}, ${code}, ${o.protocol ?? "stub"}::otprotocolenum, ${o.endpoint ?? "stub://" + code}, 60000, ${o.bat ?? true}, 'disabled') RETURNING id`);
  adapters.push(Number(r.id));
  return Number(r.id);
}
async function vanTay(adapterId: number): Promise<void> {
  const [row] = await dung(sql`SELECT protocol, endpoint, "machineId", "connectionOptions" FROM device_adapters WHERE id = ${adapterId}`);
  H.fingerprints.set(
    adapterId,
    adapterTargetFingerprint({ protocol: row.protocol, endpoint: row.endpoint, machineId: row.machineId ?? null, connectionOptions: row.connectionOptions ?? null }),
  );
}
/** ghim DỪNG (bool true) mức 1 — đúng thứ STOP HMI gửi */
async function seedGhim(adapterId: number, key = "stop_cmd"): Promise<void> {
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, stop_value, stop_pinned_by, stop_pinned_at, actuation_level)
    VALUES (${adapterId}, ${key}, ${"M." + key}, 'bool', true, true, 'input_output'::scada_channel_kind, 'true'::jsonb, '1', now(), 1)`);
}

class StubGhi extends StubDriver {
  ghi: Array<Array<{ tagKey: string; value: unknown }>> = [];
  override async writeTags(writes: Array<{ tagKey: string; address: string; value: unknown }>) {
    this.ghi.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
    return super.writeTags(writes);
  }
}
const stub: Record<"P" | "G" | "G2", StubGhi> = {} as never;
async function ganStub(k: "P" | "G" | "G2"): Promise<void> {
  const s = new StubGhi();
  await s.connect({ endpoint: `stub://${RUN}-${k.toLowerCase()}` } as never);
  H.drivers.set(AD[k], s);
  await vanTay(AD[k]);
  stub[k] = s;
}

/** "Thiết bị" Modbus trong RAM sau ModbusDriver THẬT: coil + holding; `docHold` ép giá trị ĐỌC LẠI (R1). Ghi lại MỌI lượt chạm. */
const thietBi = {
  coil: new Map<number, boolean>(),
  hold: new Map<number, number>(),
  docHold: new Map<number, number>(),
  cham: [] as Array<[string, number, unknown]>,
};
let modbusThat!: ModbusDriver;
function taoModbusThat(): ModbusDriver {
  const d = new ModbusDriver();
  Object.assign(d as unknown as Record<string, unknown>, {
    connected: true,
    client: {
      writeCoil: async (reg: number, v: boolean) => {
        thietBi.cham.push(["writeCoil", reg, v]);
        thietBi.coil.set(reg, v);
        return {};
      },
      writeRegister: async (reg: number, w: number) => {
        thietBi.cham.push(["writeRegister", reg, w]);
        thietBi.hold.set(reg, w);
        return {};
      },
      writeRegisters: async (reg: number, ws: number[]) => {
        thietBi.cham.push(["writeRegisters", reg, ws]);
        thietBi.hold.set(reg, ws[0]);
        return {};
      },
      readCoils: async (reg: number) => {
        thietBi.cham.push(["readCoils", reg, null]);
        return { data: [thietBi.coil.get(reg) ?? false] };
      },
      readHoldingRegisters: async (reg: number) => {
        thietBi.cham.push(["readHoldingRegisters", reg, null]);
        return { data: [thietBi.docHold.get(reg) ?? thietBi.hold.get(reg) ?? 0] };
      },
    },
  });
  return d;
}
const lanGhi = () => thietBi.cham.filter((c) => c[0].startsWith("write"));

type Nguoi = { id: number; name: string; username: string; role: string };
const nguoi: Record<"op" | "viewer" | "engI" | "engK", Nguoi> = {} as never;
let goc!: Record<"op" | "viewer", Goc>;
let cmdOp!: CmdCaller;
let ilk!: IlkCaller;
let kenhK!: KenhCaller;
let secretK = "";

async function seedNguoi(k: keyof typeof nguoi, role: "operator" | "viewer" | "engineer", perms: Array<[string, string, boolean]>): Promise<void> {
  const u = await taoNguoiDungTest(k, role, { tienTo: "nt2b1", ts: RUN, ten: `NT2B1 ${k}` });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod, sua] of perms) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete")
      VALUES (${u.id}, ${cat}, ${mod}, true, ${sua}, ${sua}, ${sua})`);
  }
  nguoi[k] = { id: u.id, name: u.name ?? k, username: u.username ?? k, role };
}
/** hai mốc trên hàng users (khuôn buocDoiMatKhau.test.ts): thu hồi SAU lượt đổi gần nhất ⇒ phải đổi */
const datCo = (uid: number, bat: boolean) =>
  bat
    ? dung(sql`UPDATE users SET "passwordChangedAt" = now() - interval '1 minute', "passwordInvalidBefore" = now() WHERE id = ${uid}`)
    : dung(sql`UPDATE users SET "passwordChangedAt" = now(), "passwordInvalidBefore" = NULL WHERE id = ${uid}`);

type Loi = { code?: string; appCode?: string; appParams?: Record<string, unknown> };
function moTa(e: unknown): Loi {
  const meta = readAppErrorMeta(e);
  return { code: (e as { code?: string }).code, appCode: meta?.appCode, appParams: meta?.appParams as Record<string, unknown> | undefined };
}
async function loiCua(p: Promise<unknown>): Promise<Loi> {
  try {
    await p;
  } catch (e) {
    return moTa(e);
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

/** "Dispatch AI" — dòng chờ AI ĐÃ XÁC NHẬN gắn đúng lệnh (băm), khuôn `commandDispatcher.kenh.r1a.db.test.ts` (nguồn của test DB T2). */
const TOOL_AI = "set_machine_param";
let soAct = 0;
async function lenhAi(commandType: string, writes: Array<{ tagKey: string; value: unknown }>) {
  const owner = nguoi.engI.id;
  const actionId = `${RUN}-act-${++soAct}`;
  await db.insert(aiPendingActions).values({
    id: actionId,
    tool: TOOL_AI,
    argsJson: {},
    userId: owner,
    userRole: "engineer",
    summary: `${RUN} AI action`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL_AI, adapterId: AD.M, machineId: may.M, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return {
    adapterId: AD.M,
    machineId: may.M,
    commandType,
    writes,
    triggeredBy: { kind: "hitl" as const, actionId, tool: TOOL_AI, confirmedBy: owner, requestedBy: owner },
    idempotencyKey: `${RUN}-ai-${uuid()}`,
  };
}
const datGhimM = async (tagKey: string, v: unknown) =>
  db.update(deviceTags).set({ stopValue: v as never }).where(sql`${deviceTags.adapterId} = ${AD.M} AND ${deviceTags.tagKey} = ${tagKey}`);

// ─── thư viện PLC giả (qua loadPackage của driver THẬT) ────────────────────────────────────────────────────────────────────────
function thuVienGia(overrides: Record<string, unknown>) {
  const conn: Record<string, unknown> = {
    initiateConnection: vi.fn((_o: unknown, cb: (err?: unknown) => void) => cb()),
    setTranslationCB: vi.fn(),
    addItems: vi.fn(),
    removeItems: vi.fn(),
    readAllItems: vi.fn((cb: (bad: boolean, v: Record<string, unknown>) => void) => cb(false, {})),
    writeItems: vi.fn(),
    dropConnection: vi.fn((cb: () => void) => cb()),
    isoConnectionState: 4,
    ...overrides,
  };
  function Lib(this: Record<string, unknown>) {
    Object.assign(this, conn);
  }
  return { conn, mod: { default: Lib } };
}
function voiThuVien<T extends OtDriver>(d: T, mod: unknown): T {
  (d as unknown as { loadPackage: () => Promise<unknown> }).loadPackage = async () => mod;
  return d;
}

// ─── phiên OT THẬT (otManager.startOt) cho Q1 / C1 ─────────────────────────────────────────────────────────────────────────────
let ot!: typeof import("../ot/otManager");
let tt!: typeof import("../ot/trangThaiAdapter");
async function moPhienOt(o: { id: number; protocol: OtProtocol; tags: OtTagAddress[]; ha: "true" | "false"; taoDriver: () => OtDriver }) {
  datEnv({
    OT_GATEWAY_ENABLED: "true",
    OT_CONN_HA_ENABLED: o.ha,
    OT_CONN_HA_BACKOFF_MS: "500",
    OT_CONN_HA_BACKOFF_JITTER: "0",
    OT_CONN_HA_HEALTH_INTERVAL_MS: "100",
    OT_LEGACY_RECONNECT_MS: "1000", // nối lại NHANH nếu phiên bị coi mất ⇒ "không nối lại" trong cửa sổ đo là có nghĩa
    OT_CHAT_LUONG_V2_ENABLED: "true",
    OT_GHI_TRANG_THAI_ADAPTER_ENABLED: "false",
  });
  H.bao = [];
  H.mau = [];
  H.idTheoDoi = o.id;
  let soTao = 0;
  const tao = () => {
    soTao += 1;
    return o.taoDriver();
  };
  const fixture = tao();
  H.taoDriver = () => tao();
  H.napAdapter = async () => [
    {
      adapterId: o.id,
      code: `${RUN}-ot${o.id}`,
      machineId: null,
      protocol: o.protocol,
      connection: { endpoint: "tcp://127.0.0.1:102", timeoutMs: 800 },
      pollIntervalMs: 300,
      tags: o.tags,
      driver: fixture,
    },
  ];
  tt.__datLaiTrangThaiAdapter();
  tt.__datGhiDb(async () => undefined);
  expect(await ot.startOt()).toBe(true);
  return {
    soTao: () => soTao,
    trangThai: () => tt.layTrangThaiAdapter(o.id),
    async dong() {
      await ot.stopOt();
      tt.__datGhiDb(null);
      tt.__datLaiTrangThaiAdapter();
      H.napAdapter = null;
      H.taoDriver = null;
      H.idTheoDoi = 0;
    },
  };
}

// ─── sổ chậm THẬT (L1: bão hoà pool của tiến trình; L2: khoá tư vấn chỉ cho INSERT attempts) ─────────────────────────────────────
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const KHOA_LOP = 0x7515;
const KHOA_ID = process.pid;
async function demChoKhoa(tx: Tx, lop: number, id: number): Promise<number> {
  const [r] = (await tx.execute(
    sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid::bigint = ${lop} AND objid::bigint = ${id} AND objsubid = 2 AND NOT granted`,
  )) as unknown as Array<{ n: number }>;
  return r.n;
}
async function choDuChoKhoa(tx: Tx, lop: number, id: number, n: number, loi: string): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    const k = await demChoKhoa(tx, lop, id);
    if (k >= n) return k;
    if (Date.now() - t0 > 5_000) throw new Error(`${loi}: ${k}/${n} backend chờ khoá`);
    await cho(5);
  }
}
interface GiuKhoa {
  tx: Tx;
  daNha: Promise<void>;
  nha(): Promise<void>;
}
/** Giao dịch giữ khoá tư vấn (lop, id); `chiemCho` truy vấn cùng khoá chiếm kết nối pool (bị Postgres CHẶN THẬT), chứng minh qua pg_locks. */
async function moGiuKhoa(lop: number, id: number, chiemCho: number, giuMs: number): Promise<GiuKhoa> {
  let nhaFn!: () => void;
  const nhaP = new Promise<void>((r) => (nhaFn = r));
  let coTx!: (tx: Tx) => void;
  const txP = new Promise<Tx>((r) => (coTx = r));
  const giu = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lop}::int, ${id}::int)`);
    coTx(tx);
    await nhaP;
  });
  let cc: Array<Promise<unknown>> = [];
  let tx: Tx;
  try {
    tx = await Promise.race([txP, giu.then(() => Promise.reject(new Error("giao dịch giữ kết thúc sớm")))]);
    cc = Array.from({ length: chiemCho }, () => Promise.resolve(db.execute(sql`SELECT pg_advisory_xact_lock(${lop}::int, ${id}::int)`)));
    if (chiemCho > 0) await choDuChoKhoa(tx, lop, id, chiemCho, "pool không bão hoà");
  } catch (e) {
    nhaFn();
    await giu.catch(() => undefined);
    await Promise.allSettled(cc);
    throw e;
  }
  const hen = setTimeout(nhaFn, giuMs);
  (hen as { unref?: () => void }).unref?.();
  const daNha = (async () => {
    await giu.catch((e) => console.warn("[nt2b1] giao dịch giữ:", (e as Error).message));
    await Promise.allSettled(cc);
  })();
  return {
    tx,
    daNha,
    async nha() {
      clearTimeout(hen);
      nhaFn();
      await daNha;
    },
  };
}
let baoHoa: GiuKhoa | null = null;
let giuThu: GiuKhoa | null = null;
let loiLog: ReturnType<typeof vi.spyOn> | null = null;
const nhanGhiLoiChot = () =>
  (loiLog?.mock.calls ?? []).map((c) => (c[0] as { cho?: unknown })?.cho).filter((x): x is string => typeof x === "string");

// ─── chuỗi audit: kiểm ĐOẠN id của chính ô (khuôn T11 `kiemDoan`) ────────────────────────────────────────────────────────────────
async function kiemDoan(lo: number, hi: number): Promise<{ soHang: number; loi: string[]; ids: number[] }> {
  const rows = await dung(sql`SELECT id, "entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason, "prevHash", hash, "hashTs"
    FROM control_audit_log WHERE hash IS NOT NULL AND id BETWEEN ${lo} AND ${hi} ORDER BY id`);
  const [truoc] = await dung(sql`SELECT hash FROM control_audit_log WHERE hash IS NOT NULL AND id < ${lo} ORDER BY id DESC LIMIT 1`);
  const loi: string[] = [];
  let prev: string = truoc?.hash ?? GENESIS_HASH;
  for (const r of rows) {
    if (r.prevHash !== prev) loi.push(`#${r.id} prevHash ≠ hash hàng trước (rẽ nhánh)`);
    const h = that.computeAuditHash(
      r.prevHash,
      {
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        actorId: r.actorId === null ? null : Number(r.actorId),
        before: r.beforeJson ?? null,
        after: r.afterJson ?? null,
        reason: r.reason,
      },
      Number(r.hashTs),
    );
    if (h !== r.hash) loi.push(`#${r.id} hash tính lại không khớp`);
    prev = r.hash;
  }
  return { soHang: rows.length, loi, ids: rows.map((r) => Number(r.id)) };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!CHAY_NGHIEM_THU)(
  "nghiệm thu R1b-2b-1 — P1 B1 B2 Q1 M1 C1 R1 E1 T1 L1 L2 I1 A1 G3 G4 (SCADA_R1B2B1_NGHIEM_THU=1)",
  () => {
    beforeAll(async () => {
      datEnv(BASE);
      const url = process.env.DATABASE_URL ?? "";
      expect(url).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
      const d = await getDb();
      if (!d) throw new Error("test cần CSDL _test");
      db = d;
      const [{ ten }] = (await db.execute(sql`SELECT current_database() AS ten`)) as unknown as Array<{ ten: string }>;
      expect(ten).toMatch(/_test$/);
      await import("../ot/adapterFacade");
      disp = await import("../ot/commandDispatcher");
      that = await vi.importActual<ThatAudit>("../audit/controlAuditService");
      ot = await import("../ot/otManager");
      tt = await import("../ot/trangThaiAdapter");
      H.bangThu = scadaCommandAttempts;

      A = await seedNhaMay("a");
      B = await seedNhaMay("b");
      // P1: máy có MỘT adapter stub + ghim DỪNG mức 1
      may.P = A.mid;
      AD.P = await seedAdapter(may.P, "p");
      await seedGhim(AD.P);
      // B1 / B2 / R1: adapter MODBUS (driver THẬT trên thiết bị RAM)
      may.M = await seedMay(A.sid, "m");
      AD.M = await seedAdapter(may.M, "m", { protocol: "modbus", endpoint: `tcp://127.0.0.1:1/${RUN}` });
      await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", scale, writable, "isEnabled") VALUES
        (${AD.M}, 'bcoil', 'coil:7', 'bool', 1, true, true),
        (${AD.M}, 'icoil', 'coil:8', 'int', 1, true, true),
        (${AD.M}, 'h05', 'holding:10', 'int', 0.5, true, true),
        (${AD.M}, 'h01', 'holding:11', 'int', 0.1, true, true)`);
      modbusThat = taoModbusThat();
      H.drivers.set(AD.M, modbusThat);
      await vanTay(AD.M);
      // L1: máy CHƯA ghim (tag ghi được, không ghim) ⇒ CHUA_GHIM_STOP
      may.L = await seedMay(A.sid, "l");
      AD.L = await seedAdapter(may.L, "l");
      await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind)
        VALUES (${AD.L}, 'sp', 'M.sp', 'float', true, true, 'input_output'::scada_channel_kind)`);
      // L2: hai máy có ghim
      may.G = await seedMay(A.sid, "g");
      AD.G = await seedAdapter(may.G, "g");
      await seedGhim(AD.G);
      may.G2 = await seedMay(A.sid, "g2");
      AD.G2 = await seedAdapter(may.G2, "g2");
      await seedGhim(AD.G2);
      // A1: 200 tag int writable mức 5 (adapter TẮT)
      may.K = A.mid2;
      AD.K = await seedAdapter(may.K, "k", { bat: false });
      TK = (
        await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", actuation_level)
          SELECT ${AD.K}, 'k' || lpad(g::text, 3, '0'), 'addr-k' || g::text, 'int', true, true, 5 FROM generate_series(0, 199) g RETURNING id`)
      )
        .map((r) => Number(r.id))
        .sort((x, y) => x - y);
      for (const k of ["P", "G", "G2"] as const) await ganStub(k);

      await seedNguoi("op", "operator", [["machine_control", "machine_control", true]]);
      // viewer CÓ machine_control.canEdit ⇒ thứ chặn là SÀN VAI mức 1
      await seedNguoi("viewer", "viewer", [["machine_control", "machine_control", true]]);
      await seedNguoi("engI", "engineer", [
        ["interlock", resolvePermissionModule("interlock"), true],
        ["machine_control", resolvePermissionModule("machine_control"), true],
      ]);
      await seedNguoi("engK", "engineer", [
        ["machine_control", "machine_control", true],
        ["machine_monitoring", "machine_status", false],
      ]);
      const { appRouter } = await import("../../routers");
      const ctxCua = (n: Nguoi, tf: boolean) =>
        ({ user: { id: n.id, role: n.role, name: n.name, username: n.username, twoFactorEnabled: tf } }) as never;
      goc = { op: appRouter.createCaller(ctxCua(nguoi.op, false)), viewer: appRouter.createCaller(ctxCua(nguoi.viewer, false)) };
      cmdOp = (await import("../../routers/scadaCommandsRouter")).scadaCommandsRouter.createCaller(ctxCua(nguoi.op, false));
      ilk = (await import("../../routers/interlockRouter")).interlockRouter.createCaller(ctxCua(nguoi.engI, true));
      kenhK = (await import("../../routers/scadaKenhRouter")).scadaKenhRouter.createCaller(ctxCua(nguoi.engK, true));
    }, 180_000);

    afterEach(async () => {
      H.sauDispatch = null;
      H.sauGhim = null;
      H.truocLo = null;
      if (baoHoa) {
        await baoHoa.nha();
        baoHoa = null;
        await cho(300);
      }
      H.chamThu = false;
      if (giuThu) {
        await giuThu.nha();
        giuThu = null;
      }
      loiLog?.mockRestore();
      loiLog = null;
      veBase();
    });

    afterAll(async () => {
      for (const k of ["P", "G", "G2"] as const) {
        try {
          await stub[k]?.disconnect();
        } catch {
          /* bỏ qua */
        }
      }
      if (!db) return;
      try {
        await cho(500); // lượt ghi bỏ rơi / audit nền của ô cuối kịp xong
        await dung(sql`DELETE FROM interlock_events WHERE "ruleId" IN (SELECT id FROM interlock_rules WHERE name LIKE ${RUN + "%"})`);
        await dung(sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "%"}`);
        await dung(sql`DELETE FROM ai_pending_actions WHERE id LIKE ${RUN + "%"}`);
        for (const n of Object.values(nguoi)) {
          await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${n.id} AND tool LIKE 'hmi.%'`);
          await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${n.id}`);
        }
        const ds = await dung(sql`SELECT id FROM device_adapters WHERE code LIKE ${RUN + "%"}`);
        const ids = ds.map((r) => Number(r.id));
        if (ids.length) {
          await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id IN (${inIds(ids)})`);
          await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${inIds(ids)})`);
          await dung(sql`DELETE FROM device_adapters WHERE id IN (${inIds(ids)})`);
        }
        await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`);
        await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "%"}`);
        await dung(sql`DELETE FROM stations WHERE code LIKE ${RUN + "%"}`);
        await dung(sql`DELETE FROM production_lines WHERE code LIKE ${RUN + "%"}`);
        await dung(sql`DELETE FROM workshops WHERE code LIKE ${RUN + "%"}`);
        await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`);
        const [con] = await dung(sql`SELECT (SELECT count(*) FROM device_adapters WHERE code LIKE ${RUN + "%"})::int AS a,
          (SELECT count(*) FROM machines WHERE code LIKE ${RUN + "%"})::int AS m, (SELECT count(*) FROM factories WHERE code LIKE ${RUN + "%"})::int AS f`);
        console.info(`[nt2b1] dọn xong — còn lại adapter ${con.a}, máy ${con.m}, nhà máy ${con.f} (mã ${RUN})`);
      } catch (e) {
        console.warn("[nt2b1] dọn dữ liệu:", (e as Error).message, String((e as { cause?: unknown }).cause ?? ""));
      } finally {
        for (const [k, v] of Object.entries(envGoc)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }, 120_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it("P1 (T1, mục 59) — operator có quyền dừng, cờ buộc đổi BẬT: mayDungKhanCap ⇒ máy trong phạm vi; dungMay ⇒ acked_verified + ĐÚNG 1 audit buộc đổi; viewer cùng cờ ⇒ []; scadaKenh.cheDo.danhSach ⇒ MUST_CHANGE_PASSWORD", async () => {
      try {
        await datCo(nguoi.op.id, true);
        await datCo(nguoi.viewer.id, true);
        const ds = await goc.op.scadaCommands.mayDungKhanCap();
        const ids = ds.may.map((m) => m.machineId);
        expect(ids).toContain(may.P);
        expect(ids).not.toContain(B.mid);
        expect(ids).not.toContain(B.mid2);
        const mayA = new Set((await dung(sql`SELECT m.id FROM machines m WHERE m."stationId" = ${A.sid}`)).map((r) => Number(r.id)));
        for (const id of ids) expect(mayA.has(id), `máy ${id} ngoài phạm vi`).toBe(true);
        expect(ds.may.find((m) => m.machineId === may.P)).toMatchObject({ coDung: true, soAdapter: 1, tongHop: "du" });
        expect(JSON.stringify(ds)).not.toMatch(/endpoint|lastError|stopValue|stop_cmd|tagKey/);

        const am = Number((await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM control_audit_log`))[0].m);
        const crid = uuid();
        const ghiTruoc = stub.P.ghi.length;
        const kq = await goc.op.scadaCommands.dungMay({ machineId: may.P, clientRequestId: crid });
        expect(kq.ketQua).toHaveLength(1);
        expect(kq.ketQua[0]).toMatchObject({ adapterId: AD.P, status: "acked_verified", ok: true });
        expect(stub.P.ghi.length - ghiTruoc).toBe(1);
        expect(stub.P.ghi.at(-1)).toEqual([{ tagKey: "stop_cmd", value: true }]);
        const docAudit = async () =>
          (
            (await dung(sql`SELECT "entityType", "entityId", "afterJson" FROM control_audit_log
              WHERE id > ${am} AND action = 'scada_hmi_stop_buoc_doi_mat_khau' AND "actorId" = ${nguoi.op.id} ORDER BY id`)) as Array<{ entityType: string; entityId: string; afterJson: any }>
          ).filter((r) => r.afterJson?.clientRequestId === crid);
        await vi.waitFor(
          async () => {
            if ((await docAudit()).length < 1) throw new Error("audit chưa ghi");
          },
          { timeout: 5_000, interval: 50 },
        );
        await cho(200);
        const au = await docAudit();
        expect(au).toHaveLength(1);
        expect(au[0]).toMatchObject({ entityType: "machine", entityId: String(may.P) });

        expect(await goc.viewer.scadaCommands.mayDungKhanCap()).toEqual({ may: [], biCat: false });
        expect(await loiCua(goc.op.scadaKenh.cheDo.danhSach())).toMatchObject({ code: "FORBIDDEN", appCode: "MUST_CHANGE_PASSWORD" });
      } finally {
        await datCo(nguoi.op.id, false);
        await datCo(nguoi.viewer.id, false);
      }
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it('B1 (T2 + T6, kiem-dinh G1 + điều kiện 1c) — dispatch AI (AI_OT_CONTROL_ENABLED="false") lên bool CHƯA khai trên coil Modbus: "false" / "0" ⇒ FALSE; "off" / 2 ⇒ TYPE_MISMATCH, thiết bị 0 lần; ghim STOP 1 / 255 trên coil INT ⇒ TRUE + acked_verified; 2 không-STOP trên coil INT ⇒ TYPE_MISMATCH sớm, 0 lần', async () => {
      datEnv({ OT_READBACK_ENABLED: "true" });
      expect(process.env.AI_OT_CONTROL_ENABLED).toBe("false");
      // (a) "false" / "0" ⇒ coil nhận FALSE (trước: Boolean("false") = TRUE), đọc lại khớp
      for (const value of ["false", "0"]) {
        thietBi.coil.set(6, true);
        const n0 = lanGhi().length;
        const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "bcoil", value }]));
        expect(res.status, JSON.stringify(value)).toBe("acked_verified");
        expect(lanGhi().slice(n0)).toEqual([["writeCoil", 6, false]]);
        expect(thietBi.coil.get(6)).toBe(false);
      }
      // (b) "off" / 2 ⇒ rejected TYPE_MISMATCH, thiết bị KHÔNG bị chạm (0 ghi, 0 đọc)
      for (const value of ["off", 2]) {
        const c0 = thietBi.cham.length;
        const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "bcoil", value }]));
        expect(res.status, JSON.stringify(value)).toBe("rejected");
        expect(res.reason).toBe("TYPE_MISMATCH");
        expect(res.appError).toEqual({ appCode: "SCADA_VALUE_TYPE_MISMATCH", appParams: { ma: "TYPE_MISMATCH", tagKey: "bcoil", dataType: "bool" } });
        expect(thietBi.cham.length - c0).toBe(0);
      }
      // (c) điều kiện 1c — ghim STOP 1 và ghim CŨ 255 trên coil kiểu INT ⇒ coil TRUE, acked_verified (T6: đọc lại lớp bit so theo bool)
      try {
        for (const ghim of [1, 255]) {
          await datGhimM("icoil", ghim); // ghi thẳng DB: ghim có TRƯỚC luật lúc đặt (điều kiện 1b)
          thietBi.coil.set(7, false);
          const n0 = lanGhi().length;
          const res = await disp.dispatch(await lenhAi("stop", [{ tagKey: "icoil", value: ghim }]));
          expect(res.status, `ghim ${ghim}`).toBe("acked_verified");
          expect(res.pinnedStop).toBe(true);
          expect(lanGhi().slice(n0)).toEqual([["writeCoil", 7, true]]);
          expect(thietBi.coil.get(7)).toBe(true);
        }
      } finally {
        await datGhimM("icoil", null);
      }
      // (d) T2 fix round — 2 KHÔNG phải STOP lên coil kiểu INT ⇒ rejected TYPE_MISMATCH SỚM (cổng kênh, luật địa chỉ bit), 0 lần thiết bị
      const c0 = thietBi.cham.length;
      const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "icoil", value: 2 }]));
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("TYPE_MISMATCH");
      expect(res.appError).toEqual({ appCode: "SCADA_VALUE_TYPE_MISMATCH", appParams: { ma: "TYPE_MISMATCH", tagKey: "icoil", dataType: "int" } });
      expect(thietBi.cham.length - c0).toBe(0);
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it('B2 (T2) — luật interlock BẬT commandValue "on" trên tag bool ⇒ JS (luatLenhLechLuoi) từ chối ⊆ SQL ∪ SQL bool; "false" không ai báo', async () => {
      const tien = `${RUN}-b2-`;
      const seedLuat = async (ten: string, jsonTho: string) => {
        const [r] = await dung(sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
            "commandTag", "commandValue", enabled, "createdBy")
          VALUES (${tien + ten}, 'machine', ${may.M}, 'ng_rate', 'gt', 5, 'reduce_speed', ${AD.M}, 'bcoil', ${jsonTho}::text::jsonb, true, ${nguoi.engI.id})
          RETURNING id`);
        return Number(r.id);
      };
      try {
        const idOn = await seedLuat("on", '"on"');
        const idFalse = await seedLuat("false", '"false"');
        const js = (await luatLenhLechLuoi(db as never, like(interlockRules.name, `${tien}%`))).map((r) => r.id);
        const sqlCu = await dung(sql`SELECT id::int AS id FROM (${sql.raw(TRUY_VAN_TRUOC_TRIEN_KHAI)}) q WHERE q.name LIKE ${tien + "%"}`);
        const sqlBool = await dung(sql`SELECT id::int AS id, ket_luan FROM (${sql.raw(TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL)}) q WHERE q.name LIKE ${tien + "%"}`);
        const idsSql = new Set([...sqlCu, ...sqlBool].map((r) => Number(r.id)));
        expect(js).toEqual([idOn]);
        for (const i of js) expect(idsSql.has(i), `JS từ chối luật #${i} nhưng SQL bỏ sót`).toBe(true);
        expect(sqlBool.map((r) => Number(r.id))).toEqual([idOn]);
        expect(String(sqlBool[0].ket_luan)).toBe("KHONG_PARSE_DUOC");
        expect(idsSql.has(idFalse)).toBe(false);
      } finally {
        await dung(sql`DELETE FROM interlock_rules WHERE name LIKE ${tien + "%"}`);
      }
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it('Q1 (T3, G2) — S7 tag string giá trị THẬT "BAD 12": anythingBad=false ⇒ mẫu tốt "BAD 12" + phiên OT THẬT "connected" (tag duy nhất); anythingBad=true ⇒ mẫu xấu', async () => {
      const tags: OtTagAddress[] = [{ tagKey: "t", address: "DB1,CHAR0", dataType: "string" }];
      const ID_Q = 2_000_000_000 - (process.pid % 100_000) * 10 - 1;
      const tot = thuVienGia({ readAllItems: vi.fn((cb: (b: boolean, v: Record<string, unknown>) => void) => cb(false, { t: "BAD 12" })) });
      const phien = await moPhienOt({ id: ID_Q, protocol: "s7", tags, ha: "false", taoDriver: () => voiThuVien(new S7Driver(), tot.mod) });
      try {
        await vi.waitFor(() => expect(phien.trangThai()?.tt).toBe("connected"), { timeout: 5_000, interval: 50 });
        expect(H.mau.length).toBeGreaterThan(0);
        expect(H.mau.every((s) => s.quality === "good" && s.value === "BAD 12")).toBe(true);
        expect(H.bao).not.toContain("lost");
      } finally {
        await phien.dong();
      }
      // cùng chuỗi khi thư viện BÁO lỗi ⇒ mẫu xấu
      datEnv({ OT_CHAT_LUONG_V2_ENABLED: "true" });
      const xau = thuVienGia({ readAllItems: vi.fn((cb: (b: boolean, v: Record<string, unknown>) => void) => cb(true, { t: "BAD 12" })) });
      const d = voiThuVien(new S7Driver(), xau.mod);
      await d.connect({ endpoint: "tcp://127.0.0.1:102" });
      try {
        expect((await d.readTags(tags))[0]).toMatchObject({ quality: "bad", value: null });
      } finally {
        await d.disconnect();
      }
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it("M1 (T4, mục 58) — MC mọi item BAD sau ≈4300 ms (tỉ lệ 382/400) errCode 'MC Error Response' ⇒ device_error, KHÔNG ném, tick đọc tốt, STOP ghim ghi được; errCode quá hạn gói (409/400 ≈ 4600) ⇒ mất liên lạc (ném McReadTimeoutError)", async () => {
      datEnv({ OT_CHAT_LUONG_V2_ENABLED: "true" });
      const GT = 400; // globalTimeout của instance ≙ 4500 ms thật
      const hai: OtTagAddress[] = [
        { tagKey: "t1", address: "D100", dataType: "int" },
        { tagKey: "t3", address: "M100", dataType: "bool" },
      ];
      const LOI_PLC = "MC Error Response - Second Byte is 91 and error code is 0";
      const mcDoc = (troMs: number, errCode: string, writeItems?: unknown) =>
        thuVienGia({
          globalTimeout: GT,
          readAllItems: vi.fn((cb: (b: boolean, v: Record<string, unknown>) => void) => void setTimeout(() => cb(true, { t1: "BAD 255", t3: "BAD 255" }), troMs)),
          readPacketArray: [{ itemList: [{ valid: false, errCode }, { valid: false, errCode }] }],
          ...(writeItems ? { writeItems } : {}),
        });
      // (a) PLC trả lời LỖI chậm (95 % hạn gói — trên ngưỡng 90 % của luật thời gian cũ)
      const writeItems = vi.fn((_k: string[], _v: unknown[], cb: (anyBad: boolean) => void) => {
        setImmediate(() => cb(false));
        return 0;
      });
      const plc = mcDoc(Math.round(GT * (4300 / 4500)), LOI_PLC, writeItems);
      const d = voiThuVien(new MitsubishiMcDriver(), plc.mod);
      await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
      try {
        const t0 = performance.now();
        const out = await d.readTags(hai);
        expect(performance.now() - t0).toBeGreaterThanOrEqual(GT * 0.9); // luật thời gian cũ sẽ coi là quá hạn
        for (const s of out) expect(s).toMatchObject({ quality: "bad", value: null, reason: "device_error" });
        const ticks: SuKienDoc[] = [];
        const h = await d.subscribe(hai, () => undefined, 30, { onTick: (e) => void ticks.push(e) });
        try {
          await vi.waitFor(() => expect(ticks.length).toBeGreaterThanOrEqual(1), { timeout: 3_000, interval: 20 });
        } finally {
          await h.close();
        }
        expect(ticks[0].ok).toBe(true);
        expect(laDocTot(ticks[0])).toBe(true);
        expect(laTickHong(ticks[0])).toBe(false);
        expect(d.isConnected()).toBe(true);
        const kq = await d.writeTags([{ tagKey: "stop_pin", address: "M200", value: true, dataType: "bool", dungGhim: true } as never]);
        expect(kq).toEqual([{ tagKey: "stop_pin", ok: true }]);
        expect(writeItems).toHaveBeenCalledTimes(1);
      } finally {
        await d.disconnect();
      }
      // (b) quá hạn gói THẬT (errCode của thư viện) ⇒ mất liên lạc
      const im = mcDoc(Math.round(GT * (4600 / 4500)), MC_ERRCODE_QUA_HAN_GOI);
      const d2 = voiThuVien(new MitsubishiMcDriver(), im.mod);
      await d2.connect({ endpoint: "tcp://127.0.0.1:1281" });
      try {
        expect(await d2.readTags(hai).catch((e) => e as Error)).toMatchObject({ name: "McReadTimeoutError" });
      } finally {
        await d2.disconnect();
      }
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    for (const [nhan, ha] of [
      ["legacy", "false"],
      ["HA", "true"],
    ] as const) {
      it(`C1 (T5, mục 51, điều kiện 5) — phiên S7 THẬT (${nhan}) mà MỌI địa chỉ sai ⇒ 'connecting' + lý do 'moi_tag_sai_cau_hinh'; không lost, không connected, không nối lại, không gửi đọc`, async () => {
        const tags: OtTagAddress[] = [
          { tagKey: "a", address: "XYZ", dataType: "float" },
          { tagKey: "b", address: "DB1,QQQ9", dataType: "float" },
        ];
        const ID_C = 2_000_000_000 - (process.pid % 100_000) * 10 - (ha === "true" ? 3 : 2);
        const lib = thuVienGia({});
        let soDoc = 0;
        const phien = await moPhienOt({
          id: ID_C,
          protocol: "s7",
          tags,
          ha,
          taoDriver: () => {
            const d = voiThuVien(new S7Driver(), lib.mod);
            const doc = d.readTags.bind(d);
            d.readTags = async (t) => {
              soDoc += 1;
              return doc(t);
            };
            return d;
          },
        });
        try {
          await vi.waitFor(() => expect(soDoc).toBeGreaterThanOrEqual(3), { timeout: 6_000, interval: 50 });
          expect(phien.trangThai()?.tt).toBe("connecting");
          expect(phien.trangThai()?.lyDo).toBe("moi_tag_sai_cau_hinh");
          await cho(2_500); // ≥ 8 chu kỳ thêm: D1 không bắn; hạn nối lại (1 s legacy / 0,5 s HA) đã qua nhiều lần
          expect(phien.trangThai()?.tt).toBe("connecting");
          expect(phien.trangThai()?.lyDo).toBe("moi_tag_sai_cau_hinh");
          expect(H.bao).not.toContain("lost");
          expect(H.bao).not.toContain("connected");
          expect(lib.conn.initiateConnection).toHaveBeenCalledTimes(1);
          expect(phien.soTao()).toBe(ha === "true" ? 2 : 1); // HA: driver fixture (không dùng) + MỘT driver của supervisor
          expect(lib.conn.readAllItems).not.toHaveBeenCalled();
        } finally {
          await phien.dong();
        }
      }, 30_000);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    /**
     * T6 fix round 1: thô 6 → thô 7. Driver THẬT đọc thô 6 ở scale 0,5 thành round(3,0) = 3 — ĐÚNG bằng đọc của thô 5 đã ghi ⇒ làm tròn che lỗi, KHÔNG
     * phát hiện được khi chưa có đọc lại THÔ (R1b-2b-2 mục 64; ca giới hạn ghim ở otDeviceWrite.readback.r1b2b.test.ts). Thô 7 ⇒ round(3,5) = 4 ≠ 3.
     */
    it("R1 (T6, mục 42) — int scale 0,5 ghi 2,5 (thô 5) mà thiết bị trả thô 7 (đọc lại 4) ⇒ acked_unverified", async () => {
      datEnv({ OT_READBACK_ENABLED: "true" });
      thietBi.docHold.set(9, 7);
      try {
        const n0 = lanGhi().length;
        const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "h05", value: 2.5 }]));
        expect(lanGhi().slice(n0)).toEqual([["writeRegister", 9, 5]]);
        expect(res.status).toBe("acked_unverified");
      } finally {
        thietBi.docHold.delete(9);
      }
    }, 30_000);

    /**
     * ĐỐI CHỨNG của R1 (thêm ở T16 — KHÔNG có trong bảng ô của kế hoạch). Thiết bị giữ ĐÚNG số thô vừa ghi ⇒ phải `acked_verified`.
     * ĐỎ khi đo lần đầu (2026-10-27): driver Modbus THẬT trả giá trị kỹ thuật của tag int đã LÀM TRÒN (`Math.round(raw * scale + offset)`,
     * modbusDriver.ts readOne; S7 / MC / EIP / OPC UA cùng hình) ⇒ thô 5 ở scale 0,5 đọc về 3 (= thô 6), thô 23 ở scale 0,1 đọc về 2 (= thô 20) ⇒ so ở
     * không gian thô của T6 coi lượt ghi ĐÚNG là lệch. Cùng lý do: R1 ở trên KHÔNG phân biệt được "thiết bị giữ 6" với "thiết bị giữ 5" trên driver
     * thật. Chuyển task sở hữu (T6) — không nới gì ở đây. XANH sau T6 fix round 1 (so với giá trị ĐỌC MÔ PHỎNG `scaleXuoi(inverseScale(e))`), mong đợi
     * của ô này KHÔNG đổi.
     */
    it("R1-đc (đối chứng R1, T6) — thiết bị giữ ĐÚNG số thô vừa ghi (scale 0,5: 2,5 ⇒ thô 5; scale 0,1: 2,3 ⇒ thô 23) ⇒ acked_verified", async () => {
      datEnv({ OT_READBACK_ENABLED: "true" });
      const n0 = lanGhi().length;
      const r05 = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "h05", value: 2.5 }]));
      const r01 = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "h01", value: 2.3 }]));
      expect(lanGhi().slice(n0)).toEqual([
        ["writeRegister", 9, 5],
        ["writeRegister", 10, 23],
      ]);
      expect({ h05: r05.status, h01: r01.status }).toEqual({ h05: "acked_verified", h01: "acked_verified" });
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it("E1 (T7, mục 11 + 12) — EIP 'error' lúc kết nối ⇒ không sập tiến trình; SLMP callback ghi MUỘN của giao dịch hết hạn ⇒ giao dịch kế không bị hỏng", async () => {
      const loi: unknown[] = [];
      const bat = (e: unknown) => void loi.push(e);
      process.on("uncaughtException", bat);
      process.on("unhandledRejection", bat);
      try {
        class Fake extends EventEmitter {
          timeout_sp: unknown = undefined;
          connect = vi.fn(() => {
            setTimeout(() => this.emit("error", new Error("ECONNRESET giua connect")), 5);
            return new Promise<void>(() => {}); // không bao giờ xong ⇒ hạn connect
          });
          disconnect = vi.fn(async () => {});
        }
        const plc = new Fake();
        const eip = voiThuVien(new EthernetIpDriver(), { Controller: function () {
          return plc;
        } });
        await expect(eip.connect({ endpoint: "192.168.1.10", timeoutMs: 60 })).rejects.toThrow();
        await cho(30);
        expect(loi).toEqual([]);
        expect(typeof (await eip.health()).lastError).toBe("string");
        expect(eip.isConnected()).toBe(false);
        expect(plc.timeout_sp).toBe(60);

        // SLMP: giao dịch A hết hạn; callback ghi MUỘN (lỗi) của A tới khi B đang chờ ⇒ B vẫn nhận đúng khung trả lời
        const d = new SlmpDriver();
        const writes: Array<{ cb: (err?: Error | null) => void }> = [];
        const x = d as unknown as Record<string, unknown>;
        x.socket = {
          write: vi.fn((_b: Buffer, cb: (err?: Error | null) => void) => {
            writes.push({ cb });
            return true;
          }),
          destroy: vi.fn(),
        };
        x.connected = true;
        x.frame = "3E";
        x.timeoutMs = 40;
        const transact = (req: Buffer) => (d as unknown as { transact(r: Buffer): Promise<Buffer> }).transact(req);
        const onData = (b: Buffer) => (d as unknown as { onData(b: Buffer): void }).onData(b);
        const aKq = await transact(Buffer.from([1])).then(() => "ok", (e: Error) => e.message);
        expect(aKq).toMatch(/timeout/);
        x.connected = true; // như sau nối lại (cùng socket giả)
        const b = transact(Buffer.from([2]));
        await cho(1);
        writes[0].cb(new Error("EPIPE muon cua A"));
        // khung 3E trả lời: D0 00 00 FF FF 03 00 | len=2 | endCode 0
        onData(Buffer.from([0xd0, 0x00, 0x00, 0xff, 0xff, 0x03, 0x00, 0x02, 0x00, 0x00, 0x00]));
        await expect(b).resolves.toBeInstanceOf(Buffer);
        await cho(10);
        expect(loi).toEqual([]);
      } finally {
        process.off("uncaughtException", bat);
        process.off("unhandledRejection", bat);
      }
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it("T1 (T8, mục 13) — stopOt({ tatTienTrinh: true }) ⇒ DB `status` GIỮ 'connected' (RAM 'disabled'); đối chứng stopOt() trần ⇒ DB 'disabled'", async () => {
      const id = await seedAdapter(null, "t1");
      await dung(sql`UPDATE device_adapters SET "pollIntervalMs" = 500 WHERE id = ${id}`);
      await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", "isEnabled") VALUES (${id}, 't_a', 'a', 'float', true)`);
      const status = async () => String((await dung(sql`SELECT status::text AS s FROM device_adapters WHERE id = ${id}`))[0].s);
      datEnv({ OT_GATEWAY_ENABLED: "true", OT_CONN_HA_ENABLED: "false", OT_GHI_TRANG_THAI_ADAPTER_ENABLED: "true", OT_CHAT_LUONG_V2_ENABLED: "false" });
      H.locIds = new Set([id]);
      H.taoDriver = (p) => (p === "stub" ? createStubDriver() : null);
      tt.__datGhiDb(null);
      tt.__datLaiTrangThaiAdapter();
      try {
        expect(await ot.startOt()).toBe(true);
        await vi.waitFor(async () => expect(await status()).toBe("connected"), { timeout: 12_000, interval: 250 });
        await ot.stopOt({ tatTienTrinh: true });
        expect(tt.layTrangThaiAdapter(id)?.tt).toBe("disabled");
        await cho(7_000); // quá khoảng điều tiết 5 s: mọi lượt ghi hẹn đã chạy
        expect(await status()).toBe("connected");
        // đối chứng: khởi động lại trong cùng tiến trình rồi tắt THẬT ⇒ 'disabled' được ghi
        expect(await ot.startOt()).toBe(true);
        await vi.waitFor(() => expect(tt.layTrangThaiAdapter(id)?.tt).not.toBe("disabled"), { timeout: 5_000, interval: 50 });
        await ot.stopOt();
        await vi.waitFor(async () => expect(await status()).toBe("disabled"), { timeout: 12_000, interval: 250 });
      } finally {
        await ot.stopOt();
        tt.__datLaiTrangThaiAdapter();
        H.locIds = null;
        H.taoDriver = null;
      }
    }, 60_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it("L1 (T9, mục 44) — sổ chậm 5 s (pool của tiến trình bão hoà, KHÔNG khoá bảng), máy CHƯA ghim ⇒ CHUA_GHIM_STOP < 1,2 s (batDauDoLag); lúc trả lời dòng attempts chưa có; dispatch 0", async () => {
      const CAN = 1_200;
      loiLog = vi.spyOn(logger, "error");
      H.sauGhim = (adapterId) =>
        adapterId === AD.L
          ? moGiuKhoa(KHOA_LOP, KHOA_ID, resolvePoolMax() - 1, 5_000).then((g) => {
              baoHoa = g;
            })
          : undefined;
      const [mm] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM scada_command_attempts`);
      const dTu = H.dispatchInputs.length;
      const lag = batDauDoLag();
      const batDau = Date.now();
      const e = await loiCua(cmdOp.dungMay({ machineId: may.L, clientRequestId: uuid() }));
      const troi = Date.now() - batDau;
      const phanNoi = await lag.dung(CAN);
      console.info(`[nt2b1] L1: trôi ${troi} ms, phần nới ${phanNoi} ms`);
      expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_STOP_NOT_PINNED", appParams: { ma: "CHUA_GHIM_STOP" } });
      expect(baoHoa, "rào đã dựng (sổ chậm thật)").not.toBeNull();
      expect(troi).toBeGreaterThanOrEqual(HAN_GHI_SO_STOP_HMI_MS - 5); // cận dưới thô: lượt sổ ĐÃ chạm hạn
      expect(troi).toBeLessThan(CAN + phanNoi);
      expect(nhanGhiLoiChot()).toContain("attempts_hmi_stop_chua_ghim_qua_han");
      expect(H.dispatchInputs.length - dTu).toBe(0);
      const luc = (await baoHoa!.tx.execute(
        sql`SELECT id FROM scada_command_attempts WHERE id > ${Number(mm.m)} AND user_id = ${nguoi.op.id}`,
      )) as unknown as unknown[];
      expect(luc).toEqual([]);
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it("L2 (T9 fix round, I1) — CHỈ bảng attempts chậm + bấm STOP TRẦN+4 lần ⇒ lượt ghi sổ treo ≤ TRẦN (8) (Postgres xác nhận), 4 lượt bỏ qua có nội dung; máy KHÁC vẫn acked_verified < 1,7 s", async () => {
      const CAN = 1_700;
      expect(TRAN_GHI_SO_TREO_STOP_HMI).toBe(8);
      expect(resolvePoolMax()).toBeGreaterThanOrEqual(TRAN_GHI_SO_TREO_STOP_HMI + 3);
      await vi.waitFor(() => expect(soGhiSoTreoStopHmi()).toBe(0), { timeout: 10_000, interval: 50 });
      loiLog = vi.spyOn(logger, "error");
      giuThu = await moGiuKhoa(H.khoaThu[0], H.khoaThu[1], 0, 60_000);
      H.chamThu = true;
      const SO_BAM = TRAN_GHI_SO_TREO_STOP_HMI + 4;
      let treoMax = 0;
      for (let i = 0; i < SO_BAM; i++) {
        const kq = await cmdOp.dungMay({ machineId: may.G, clientRequestId: uuid() });
        expect(kq.ketQua[0], `lần bấm ${i + 1}`).toMatchObject({ adapterId: AD.G, status: "acked_verified", ok: true });
        treoMax = Math.max(treoMax, soGhiSoTreoStopHmi());
      }
      expect(treoMax).toBeLessThanOrEqual(TRAN_GHI_SO_TREO_STOP_HMI);
      expect(treoMax).toBe(TRAN_GHI_SO_TREO_STOP_HMI);
      await choDuChoKhoa(giuThu.tx, H.khoaThu[0], H.khoaThu[1], TRAN_GHI_SO_TREO_STOP_HMI, "lượt treo chưa tới Postgres");
      await cho(200);
      expect(await demChoKhoa(giuThu.tx, H.khoaThu[0], H.khoaThu[1])).toBe(TRAN_GHI_SO_TREO_STOP_HMI);
      const boQua = (loiLog.mock.calls as unknown[][])
        .map((c) => c[0] as { cho?: string; noiDung?: Record<string, unknown> })
        .filter((o) => o?.cho === "attempts_hmi_stop_bo_qua_day");
      expect(boQua).toHaveLength(SO_BAM - TRAN_GHI_SO_TREO_STOP_HMI);
      expect(boQua[0].noiDung).toMatchObject({ bang: "scada_command_attempts", adapterId: AD.G, outcome: "dispatched" });

      const ghiTruoc = stub.G2.ghi.length;
      const lag = batDauDoLag();
      const batDau = Date.now();
      const kq2 = await cmdOp.dungMay({ machineId: may.G2, clientRequestId: uuid() });
      const troi = Date.now() - batDau;
      const phanNoi = await lag.dung(CAN);
      console.info(`[nt2b1] L2 máy G2: trôi ${troi} ms, phần nới ${phanNoi} ms`);
      expect(kq2.ketQua[0]).toMatchObject({ adapterId: AD.G2, status: "acked_verified", ok: true });
      expect(stub.G2.ghi.length - ghiTruoc).toBe(1);
      expect(troi).toBeLessThan(CAN + phanNoi);

      H.chamThu = false;
      await giuThu.nha();
      giuThu = null;
      await vi.waitFor(() => expect(soGhiSoTreoStopHmi()).toBe(0), { timeout: 10_000, interval: 50 });
    }, 90_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it("I1 (T10, mục 47) — adapter đích sang nhà máy B commit giữa kiểm-trước và khoá: create / update / delete / enable / disable ⇒ NOT_FOUND, 0 hàng đổi, 0 audit; đối chứng cùng nhà máy ⇒ tạo được", async () => {
      const NF = { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "interlockRule" } };
      let soAdI = 0;
      const adapterI = () => seedAdapter(A.mid, `i${++soAdI}`, { bat: false });
      let soLuat = 0;
      const seedLuat = async (target: number, o: { enabled?: boolean; duyet?: boolean } = {}) => {
        const [r] = await dung(sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceType", "comparisonOperator", threshold, action,
            "targetAdapterId", enabled, "approvedBy", "createdBy")
          VALUES (${`${RUN}-ir${++soLuat}`}, 'machine', ${A.mid}, 'ng_rate', 'gt', '0.5', 'alert', ${target}, ${o.enabled ?? false},
            ${o.duyet ? nguoi.engK.id : null}, ${nguoi.op.id}) RETURNING id`);
        if (o.duyet) await dongDauDuyetLuat(Number(r.id));
        return Number(r.id);
      };
      const hangLuat = async (id: number) =>
        (await dung(sql`SELECT description, enabled, "targetAdapterId" FROM interlock_rules WHERE id = ${id}`))[0];
      const soAudit = async () => Number((await dung(sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "actorId" = ${nguoi.engI.id}`))[0].n);
      const soBiChanBoi = async (pid: number) =>
        Number((await dung(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`))[0].n);
      /** Giao dịch "người đổi máy" THẬT: khoá adapter FOR UPDATE; thủ tục BỊ CHẶN ở hàng ấy (đã qua kiểm-trước); đổi máy rồi COMMIT. */
      async function doiMayGiuaKiemVaKhoa<T>(adapterId: number, mayMoi: number, goi: () => Promise<T>): Promise<{ loi: unknown }> {
        let moKhoa!: () => void;
        const choMo = new Promise<void>((r) => (moKhoa = r));
        let daKhoa!: (pid: number) => void;
        const choKhoa = new Promise<number>((r) => (daKhoa = r));
        const giu = db.transaction(async (tx) => {
          const [p] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
          await tx.execute(sql`SELECT id FROM device_adapters WHERE id = ${adapterId} FOR UPDATE`);
          daKhoa(Number(p.pid));
          await choMo;
          await tx.execute(sql`UPDATE device_adapters SET "machineId" = ${mayMoi} WHERE id = ${adapterId}`);
        });
        const pid = await choKhoa;
        const p = goi().then(
          () => ({ loi: null as unknown }),
          (loi: unknown) => ({ loi }),
        );
        try {
          await vi.waitFor(async () => expect(await soBiChanBoi(pid), "thủ tục phải BỊ CHẶN ở hàng adapter").toBeGreaterThan(0), {
            timeout: 10_000,
            interval: 20,
          });
        } finally {
          moKhoa();
          await giu;
        }
        return p;
      }
      const luatMoi = (ten: string, targetAdapterId: number) => ({
        name: `${RUN}-${ten}`,
        scope: "machine" as const,
        machineId: A.mid,
        sourceType: "ng_rate" as const,
        comparisonOperator: "gt" as const,
        threshold: 0.5,
        action: "alert" as const,
        targetAdapterId,
      });
      const soTen = async (ten: string) => Number((await dung(sql`SELECT count(*)::int AS n FROM interlock_rules WHERE name = ${ten}`))[0].n);
      const audit0 = await soAudit();

      // create
      let x = await adapterI();
      let r = await doiMayGiuaKiemVaKhoa(x, B.mid, () => ilk.create(luatMoi("c-ngoai", x)));
      expect(moTa(r.loi), "create").toMatchObject(NF);
      expect(await soTen(`${RUN}-c-ngoai`)).toBe(0);
      // update
      x = await adapterI();
      let id = await seedLuat(x);
      r = await doiMayGiuaKiemVaKhoa(x, B.mid, () => ilk.update({ id, description: "sua-ngoai-pham-vi" }));
      expect(moTa(r.loi), "update").toMatchObject(NF);
      expect(await hangLuat(id)).toMatchObject({ description: null, targetAdapterId: x });
      // delete
      x = await adapterI();
      id = await seedLuat(x);
      r = await doiMayGiuaKiemVaKhoa(x, B.mid, () => ilk.delete({ id, reason: "xoa ngoai pham vi" }));
      expect(moTa(r.loi), "delete").toMatchObject(NF);
      expect(await hangLuat(id)).toBeTruthy();
      // enable (đã duyệt, đang tắt)
      x = await adapterI();
      id = await seedLuat(x, { duyet: true });
      const token = (await ilk.get({ id })).versionToken;
      r = await doiMayGiuaKiemVaKhoa(x, B.mid, () => ilk.enable({ id, expectedVersion: token }));
      expect(moTa(r.loi), "enable").toMatchObject(NF);
      expect((await hangLuat(id)).enabled).toBe(false);
      // disable (đang bật)
      x = await adapterI();
      id = await seedLuat(x, { enabled: true, duyet: true });
      r = await doiMayGiuaKiemVaKhoa(x, B.mid, () => ilk.disable({ id, reason: "tat ngoai pham vi" }));
      expect(moTa(r.loi), "disable").toMatchObject(NF);
      expect((await hangLuat(id)).enabled).toBe(true);
      expect(await soAudit(), "0 audit cho 5 thủ tục bị từ chối").toBe(audit0);

      // đối chứng DƯƠNG: cùng khuôn, máy MỚI cùng nhà máy A ⇒ tạo được (bộ đo không câm)
      x = await adapterI();
      r = await doiMayGiuaKiemVaKhoa(x, A.mid2, () => ilk.create(luatMoi("c-trong", x)));
      expect(r.loi).toBeNull();
      expect(await soTen(`${RUN}-c-trong`)).toBe(1);
    }, 90_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it("A1 (T11, mục 48) — khai mức 200 tag, SEC_PLATFORM bật, 20 recordAuditEvent song song ⇒ MỘT lượt recordAuditEvents (201); đoạn chuỗi CỦA Ô liền, lô là một khối id; thời gian ghi số đo", async () => {
      datEnv({ SEC_PLATFORM: "true" });
      secretK = speakeasy.generateSecret({ length: 20 }).base32;
      await setup2FA(nguoi.engK.id, secretK);
      await enable2FA(nguoi.engK.id);
      await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${nguoi.engK.id}`);
      spy.don.mockClear();
      spy.lo.mockClear();
      let don!: Promise<Array<{ id: number }>>;
      H.truocLo = () => {
        don = Promise.all(
          Array.from({ length: 20 }, async (_, i) => {
            const r = await that.recordAuditEvent(db, {
              entityType: "nt2b1_don",
              entityId: i,
              action: "nt2b1_don",
              actorId: null,
              before: null,
              after: { i },
              reason: `${RUN} a1 don`,
            });
            return { id: Number(r!.id) };
          }),
        );
      };
      const ld = `${RUN} a1 khai muc`;
      const t0 = performance.now();
      const kq = await kenhK.khaiHangLoat({
        adapterId: AD.K,
        items: TK.map((tagId) => ({ tagId, patch: { actuationLevel: 3 } })),
        lyDo: ld,
        totpCode: speakeasy.totp({ secret: secretK, encoding: "base32" }),
      });
      const ms = performance.now() - t0;
      console.info(`[nt2b1] A1: khaiHangLoat 200 tag (SEC_PLATFORM bật, 20 audit song song) ${ms.toFixed(0)} ms`);
      const dons = await don;
      expect(kq.soDoi).toBe(200);
      expect(spy.lo).toHaveBeenCalledTimes(1);
      expect((spy.lo.mock.calls[0][1] as unknown[]).length).toBe(201);
      expect(spy.don).toHaveBeenCalledTimes(0);
      const au = await dung(sql`SELECT id FROM control_audit_log WHERE reason = ${ld} ORDER BY id`);
      expect(au).toHaveLength(201);
      const loIds = au.map((r) => Number(r.id));
      const tatCa = [...loIds, ...dons.map((r) => r.id)];
      const d = await kiemDoan(Math.min(...tatCa), Math.max(...tatCa));
      expect(d.loi).toEqual([]);
      expect(d.soHang).toBeGreaterThanOrEqual(221);
      expect(d.ids.filter((i) => i >= loIds[0] && i <= loIds[200])).toEqual(loIds);
      const muc = await dung(sql`SELECT count(*)::int AS n FROM device_tags WHERE id IN (${inIds(TK)}) AND actuation_level = 3`);
      expect(Number(muc[0].n)).toBe(200);
    }, 60_000);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    describe("G3 (T14, G3 + mục 45, điều kiện 4 b) — Redis giả qua RESP2; client ioredis THẬT hạn 250 ms; mọi bộ giới hạn rơi xuống bộ nhớ", () => {
      const CRLF = "\r\n";
      const LENH = new Set(["incr", "pttl", "pexpire", "decr", "del", "get", "eval", "evalsha"]);
      const gia = {
        cheDo: "khoe" as "khoe" | "loi",
        treMs: 0,
        dem: new Map<string, number>(),
        het: new Map<string, number>(),
        soEval: 0,
        choTraLoi: 0,
        socket: new Set<net.Socket>(),
      };
      let rl!: typeof import("../../_core/rateLimitConfig");
      let sdk!: (typeof import("../../_core/sdk"))["sdk"];
      let server: net.Server | null = null;
      const urlGoc = process.env.REDIS_URL;
      const rlrGoc = process.env.RATE_LIMIT_REDIS;
      const so = (n: number) => `:${n}${CRLF}`;
      const donHet = (k: string) => {
        const h = gia.het.get(k);
        if (h !== undefined && h <= Date.now()) {
          gia.dem.delete(k);
          gia.het.delete(k);
        }
      };
      function thucThi(args: string[]): string {
        const ten = args[0]!.toLowerCase();
        if (ten === "eval") gia.soEval += 1;
        if (LENH.has(ten) && gia.cheDo === "loi") return `-ERR redis gia sap${CRLF}`;
        if (ten === "eval") {
          const [, script, , khoa = "", argv1] = args;
          donHet(khoa);
          if (script === rl.LUA_TANG_DEM) {
            const v = (gia.dem.get(khoa) ?? 0) + 1;
            gia.dem.set(khoa, v);
            let t = gia.het.has(khoa) ? gia.het.get(khoa)! - Date.now() : -1;
            if (t < 0) {
              gia.het.set(khoa, Date.now() + Number(argv1));
              t = Number(argv1);
            }
            return `*2${CRLF}${so(v)}${so(t)}`;
          }
          if (script === rl.LUA_GIAM_DEM) {
            const v = gia.dem.get(khoa) ?? 0;
            if (v <= 0) return so(0);
            gia.dem.set(khoa, v - 1);
            return so(v - 1);
          }
          return `-ERR script khong biet${CRLF}`;
        }
        if (ten === "del") {
          gia.dem.delete(args[1] ?? "");
          gia.het.delete(args[1] ?? "");
          return so(1);
        }
        if (ten === "info") {
          const b = "# Server\r\nredis_version:7.2.0\r\nloading:0\r\n";
          return `$${Buffer.byteLength(b)}\r\n${b}\r\n`;
        }
        return "+OK\r\n";
      }
      function docLenh(buf: Buffer): { args: string[]; dung: number } | null {
        if (buf.length === 0 || buf[0] !== 0x2a) return null;
        const i = buf.indexOf("\r\n");
        if (i < 0) return null;
        const n = Number(buf.subarray(1, i).toString());
        let pos = i + 2;
        const args: string[] = [];
        for (let k = 0; k < n; k++) {
          const j = buf.indexOf("\r\n", pos);
          if (j < 0) return null;
          const len = Number(buf.subarray(pos + 1, j).toString());
          const s = j + 2;
          if (buf.length < s + len + 2) return null;
          args.push(buf.subarray(s, s + len).toString());
          pos = s + len + 2;
        }
        return { args, dung: pos };
      }
      async function choHetHang(): Promise<void> {
        while (gia.choTraLoi > 0) await cho(20);
      }
      async function cheDo(c: "khoe" | "loi", treMs: number, xoa: boolean): Promise<void> {
        gia.treMs = 0;
        await choHetHang();
        gia.cheDo = c;
        gia.treMs = treMs;
        if (xoa) {
          gia.dem.clear();
          gia.het.clear();
          gia.soEval = 0;
        }
      }
      async function taoApp(): Promise<{ server: Server; base: string }> {
        const app = express();
        app.use("/api/", rl.createHmiStopLimiter());
        app.use("/api/auth/", rl.createAuthLimiter());
        const ok = (_q: express.Request, r: express.Response) => void r.status(200).json({ ok: true });
        app.post("/api/trpc/:p", ok);
        app.post("/api/auth/login", ok);
        let s!: Server;
        await new Promise<void>((r) => {
          s = app.listen(0, "127.0.0.1", () => r());
        });
        return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
      }
      const dongApp = (s: Server) => new Promise<void>((r) => s.close(() => r()));
      const cookieCua = async (openId: string) =>
        `${COOKIE_NAME}=${encodeURIComponent(await sdk.signSession({ openId, appId: process.env.VITE_APP_ID!, name: "HMI operator" }))}`;
      const stop = async (base: string, cookie: string) => {
        const r = await fetch(`${base}/api/trpc/scadaCommands.dungMay`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" });
        await r.arrayBuffer();
        return r.status;
      };
      const login = async (base: string) => {
        const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        await r.arrayBuffer();
        return r.status;
      };
      async function dongThoi<T>(n: number, f: () => Promise<T>, song = 100): Promise<T[]> {
        const ra: T[] = new Array(n);
        let ke = 0;
        await Promise.all(
          Array.from({ length: Math.min(song, n) }, async () => {
            while (ke < n) {
              const i = ke++;
              ra[i] = await f();
            }
          }),
        );
        return ra;
      }

      beforeAll(async () => {
        server = net.createServer((sock) => {
          gia.socket.add(sock);
          sock.on("close", () => gia.socket.delete(sock));
          sock.on("error", () => {});
          let buf = Buffer.alloc(0);
          let hang: Promise<void> = Promise.resolve(); // trả lời ĐÚNG THỨ TỰ nhận (như Redis); THỰC THI lúc nhận, chỉ câu trả lời trễ
          sock.on("data", (d) => {
            buf = Buffer.concat([buf, d]);
            for (;;) {
              const r = docLenh(buf);
              if (!r) break;
              buf = buf.subarray(r.dung);
              const han = Date.now() + (LENH.has(r.args[0]!.toLowerCase()) ? gia.treMs : 0);
              const traLoi = thucThi(r.args);
              gia.choTraLoi++;
              hang = hang
                .then(() => new Promise<void>((xong) => (han - Date.now() <= 0 ? xong() : void setTimeout(xong, han - Date.now()))))
                .then(() => {
                  gia.choTraLoi--;
                  if (!sock.destroyed) sock.write(traLoi);
                });
            }
          });
        });
        await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
        process.env.REDIS_URL = `redis://127.0.0.1:${(server.address() as AddressInfo).port}`;
        delete process.env.RATE_LIMIT_REDIS; // chế độ redis (khôi phục ở afterAll)
        rl = await import("../../_core/rateLimitConfig");
        ({ sdk } = await import("../../_core/sdk"));
        expect(rl.resolveRateLimitStoreKind()).toBe("redis");
        const c = rl.getRateLimitRedis() as unknown as { status: string; options: { commandTimeout?: number; port?: number }; once(e: string, f: () => void): void };
        expect(c.options.port, "client Redis dùng chung phải trỏ máy chủ GIẢ của ô (chưa ai tạo trước)").toBe((server.address() as AddressInfo).port);
        expect(c.options.commandTimeout).toBe(rl.HAN_LENH_REDIS_GIOI_HAN_MS);
        expect(rl.HAN_LENH_REDIS_GIOI_HAN_MS).toBe(250);
        if (c.status !== "ready") await new Promise<void>((r) => c.once("ready", () => r()));
        // làm ấm import động của phép kiểm vé (lần nạp đầu không tính)
        const app = await taoApp();
        expect(await stop(app.base, await cookieCua(`${RUN}-lam-am`))).toBe(200);
        await dongApp(app.server);
      }, 30_000);
      afterAll(async () => {
        try {
          (rl?.getRateLimitRedis() as unknown as { disconnect(): void } | null)?.disconnect();
        } catch {
          /* đã ngắt */
        }
        for (const s of gia.socket) s.destroy();
        if (server) await new Promise<void>((r) => server!.close(() => r()));
        if (urlGoc === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = urlGoc;
        if (rlrGoc !== undefined) process.env.RATE_LIMIT_REDIS = rlrGoc;
      });

      it("Redis NÉM ở mọi lệnh ⇒ 600 STOP một phiên đi qua, lượt 601 ⇒ 429; phiên khác 200; đăng nhập 429 đúng lượt (đếm trong bộ nhớ, không fail-open)", async () => {
        await cheDo("loi", 0, true);
        const memInc = vi.spyOn(MemoryStore.prototype, "increment");
        const app = await taoApp();
        try {
          const TRAN = rl.TRAN_STOP_HMI_MOI_PHUT;
          expect(TRAN).toBe(600);
          const a = await cookieCua(`${RUN}-g3a-${Date.now()}`);
          const lo = await dongThoi(TRAN, () => stop(app.base, a));
          expect(lo.filter((s) => s !== 200)).toEqual([]);
          expect(await stop(app.base, a), "lượt 601").toBe(429);
          expect(await stop(app.base, await cookieCua(`${RUN}-g3b-${Date.now()}`)), "phiên khác").toBe(200);
          expect(gia.soEval, "Redis đã được hỏi (rồi lỗi)").toBeGreaterThan(0);
          expect(memInc.mock.calls.length, "đếm rơi xuống bộ nhớ").toBeGreaterThanOrEqual(TRAN + 2);
          const max = rl.AUTH_RATE_LIMIT.max;
          const dn = await dongThoi(max, () => login(app.base));
          expect(dn.every((s) => s === 200)).toBe(true);
          expect(await login(app.base), `đăng nhập lượt ${max + 1}`).toBe(429);
        } finally {
          memInc.mockRestore();
          await dongApp(app.server);
        }
      }, 30_000);

      it("T14 fix round (I1) — Redis CHẬM (400 ms > hạn 250) rồi KHOẺ, KHÔNG xoá trạng thái ⇒ mọi khoá Redis đã tạo đều CÓ TTL; bộ giới hạn đăng nhập vẫn đếm (429 đúng lượt)", async () => {
        await cheDo("khoe", 400, true);
        const app = await taoApp();
        try {
          const max = rl.AUTH_RATE_LIMIT.max;
          const c = await cookieCua(`${RUN}-g3c-${Date.now()}`);
          const [dn, st] = await Promise.all([dongThoi(max + 1, () => login(app.base)), dongThoi(5, () => stop(app.base, c))]);
          expect(dn.filter((s) => s === 200)).toHaveLength(max);
          expect(dn.filter((s) => s === 429)).toHaveLength(1);
          expect(st.every((s) => s === 200)).toBe(true);
          await cheDo("khoe", 0, false); // Redis khoẻ lại — dữ liệu GIỮ nguyên (lệnh client đã bỏ vẫn được Redis thực thi)
          const khoa = [...gia.dem.keys()].filter((k) => k.startsWith("rl:auth:") || k.startsWith("rl:hmistop:"));
          expect(khoa.some((k) => k.startsWith("rl:auth:")), "Redis đã thực thi lượt đếm đăng nhập").toBe(true);
          expect(khoa.some((k) => k.startsWith("rl:hmistop:")), "Redis đã thực thi lượt đếm STOP").toBe(true);
          for (const k of khoa) {
            const h = gia.het.get(k);
            expect(h, `khoá ${k} KHÔNG có TTL`).toBeDefined();
            expect(h! - Date.now()).toBeGreaterThan(0);
          }
        } finally {
          await dongApp(app.server);
        }
      }, 30_000);
    });

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    it("G4 (T15, G4 + KD-T15) — batch [auth.logout, scadaCommands.dungMay] qua HTTP THẬT (appRouter THẬT), xác thực treo 5 s ⇒ CẢ HAI 503 SCADA_STOP_PRECHECK_TIMEOUT < 1,7 s (batDauDoLag); bộ đếm posture tăng ĐÚNG +1", async () => {
      const { sdk } = await import("../../_core/sdk");
      const { createContext, HAN_XAC_THUC_STOP_HMI_MS } = await import("../../_core/context");
      const { demStopQuaHanKhongGhiSo } = await import("../../_core/hanStopHmi");
      const { appRouter } = await import("../../routers");
      const xt = vi.spyOn(sdk, "authenticateRequest").mockImplementation(
        () => new Promise((r) => setTimeout(() => r({ id: nguoi.op.id, role: "operator", name: "op" } as never), 5_000)) as never,
      );
      try {
        const truoc = demStopQuaHanKhongGhiSo();
        const lag = batDauDoLag();
        const batDau = Date.now();
        const res = await fetchRequestHandler({
          endpoint: "/api/trpc",
          req: new Request("http://x/api/trpc/auth.logout,scadaCommands.dungMay?batch=1", {
            method: "POST",
            headers: { "content-type": "application/json", cookie: "app_session_id=abc" },
            body: JSON.stringify({ 0: { json: null }, 1: { json: { machineId: may.P, clientRequestId: uuid() } } }),
          }),
          router: appRouter,
          createContext: ({ info }) => createContext({ req: { headers: { cookie: "app_session_id=abc" } } as never, res: {} as never, info }),
        });
        const tho = Date.now() - batDau;
        const troi = tho - (await lag.dung());
        console.info(`[nt2b1] G4: thô ${tho} ms, trừ lag ${troi} ms`);
        expect(tho).toBeGreaterThanOrEqual(HAN_XAC_THUC_STOP_HMI_MS - 50);
        expect(troi).toBeLessThan(1_700);
        const body = (await res.json()) as Array<{ error: { json: { data: Record<string, unknown> } } }>;
        expect(body).toHaveLength(2);
        for (const phan of body) {
          expect(phan.error.json.data.code).toBe("SERVICE_UNAVAILABLE");
          expect(phan.error.json.data.appCode).toBe("SCADA_STOP_PRECHECK_TIMEOUT");
        }
        const sau = demStopQuaHanKhongGhiSo();
        expect(sau.tong - truoc.tong, "posture stopQuaHan24h tăng đúng +1 (dungMay), không +2").toBe(1);
        expect((sau.theoBuoc.xac_thuc ?? 0) - (truoc.theoBuoc.xac_thuc ?? 0)).toBe(1);
      } finally {
        xt.mockRestore();
      }
    }, 30_000);
  },
);
