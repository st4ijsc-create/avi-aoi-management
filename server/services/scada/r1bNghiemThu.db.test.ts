/**
 * SCADA R1b-1 Task 12 — NGHIỆM THU R1b-1 "An toàn & nợ": ma trận ô S1–S6, C1, R1, W1, B1 (+ X1–X3 của điều phối) trên CSDL `_test` THẬT.
 *
 * Đường chạy thật (khuôn `r1aNghiemThu.db.test.ts`):
 *   • STOP HMI: `scadaCommands.dungMay` (tRPC caller; người dùng qua `taoNguoiDungTest`; `ctx.user` dựng TỪ hàng `users` ⇒ cờ 2FA đọc từ DB;
 *     phạm vi `idsTrongPhamVi` THẬT; quyền `machine_control` THẬT) → `lenhHmi.dungMayHmi` → `dispatch()` THẬT (binding requireBoundAction,
 *     cổng kênh 3b, cổng chế độ 3c — luôn chạy cho `hmi.*` —, phân loại STOP ghim 5a-stop với dấu vân tay kết nối THẬT, đặt chỗ ghi trước,
 *     đọc lại bắt buộc) → StubDriver THẬT (RAM). Commissioning BẬT (adapter có `commissioning_records` thật), preflight safety THẬT.
 *   • Safety PLC MÔ PHỎNG (D9): hàng `safety_plc_configs` THẬT backend `modbus`, phạm vi trạm, trỏ PLC giả trong tiến trình (`ServerTCP`).
 *   • Edge (S5): `edge_nodes` + `device_adapters.edgeNodeId` THẬT ⇒ dispatcher định tuyến STOP sang node edge (`enqueueEdgeDeviceRequest` THẬT).
 *   • C1: otManager THẬT (`startOt`, legacy VÀ HA) + ModbusDriver THẬT trên một máy chủ TCP IM LẶNG trong tiến trình (nhận kết nối, không
 *     bao giờ trả lời ⇒ TCP lên, MỌI lần đọc quá hạn). Trạng thái ghi `device_adapters.status` THẬT.
 *   • R1: router REST v1 THẬT (`createV1Router`) trên express, máy AUTOMATION THẬT trong `_test`.
 *   • W1: `scadaCommands.confirm` lặp trên yêu cầu đã xử lý ⇒ `DA_XU_LY` qua bộ điều tiết THẬT (`dieuTietThuLenh`).
 *   • B1: `tieuMaDuPhongNguyenTu` THẬT trên bảng `backup_codes` (băm bcrypt) — 10 lượt song song.
 *   • X1: `deviceAdapter.tags.update` THẬT với TOTP THẬT (speakeasy + setup2FA/enable2FA, `kiemXacThucTheoMuc` + bộ đếm T16 THẬT).
 *
 * Chỗ giả (hạ tầng, không phải cổng):
 *   • `getActiveDriver` / `getActiveConnectionFingerprint` (adapter của tệp ⇒ StubDriver + vân tay TÍNH từ chính hàng adapter);
 *   • `getIO` (ghi lại emit); `dispatch` được BỌC để đếm (gọi xuyên mã thật);
 *   • `raiseCriticalStopAlert` + `sendCentralAdapterStop` (đường edge) ghi lại, không gửi thông báo / phiên tạm thật;
 *   • `baoTrangThaiAdapter` được BỌC để ghi MỌI trạng thái báo ra (C1 — oracle không lỡ một nhịp `connected` ngắn; gọi xuyên mã thật);
 *   • `masterKey` (R1): khoá "MASTER" là khoá master hợp lệ (như `equipmentCommands.r1a.db.test.ts`).
 * `OT_CONTROL_ENABLED=true` CHỈ trong tiến trình (D9).
 *
 * Mỗi ô một `it`: đúng mã **và** đúng số dòng WORM tăng thêm, đếm theo KHOÁ CỦA TỆP (`_test` dùng chung): `scada_command_attempts` theo
 * `user_id` người dùng tệp, `command_log` theo `adapterId` adapter tệp.
 *
 * CHỈ CHẠY KHI GỌI TƯỜNG MINH (như R0 / R1a):
 *   Bash:       SCADA_R1B_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r1bNghiemThu.db.test.ts
 *   PowerShell: $env:SCADA_R1B_NGHIEM_THU='1'; npx vitest run -c vitest.db.config.ts server/services/scada/r1bNghiemThu.db.test.ts
 * Không đặt biến ⇒ cả tệp bị bỏ qua (không dựng dữ liệu).
 *
 * `command_log` + `scada_command_attempts` + `control_audit_log` là WORM: hàng của tệp ở lại (đúng thiết kế). Mọi hàng khác được dọn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import net from "node:net";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import * as ModbusSerialNs from "modbus-serial";

const RUN = `r1bnt${process.pid}${Date.now().toString(36)}`;
const CHAY_NGHIEM_THU = process.env.SCADA_R1B_NGHIEM_THU === "1";

const H = vi.hoisted(() => ({
  emits: [] as Array<{ room: string; ev: string; payload: Record<string, unknown> }>,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  dispatchCalls: 0,
  alerts: [] as Array<{ kind: string }>,
  fallback: [] as number[],
  /** C1 — mọi trạng thái baoTrangThaiAdapter báo ra, theo adapter */
  bao: new Map<number, string[]>(),
}));

vi.mock("../../_core/socket", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../_core/socket")>();
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
      H.dispatchCalls += 1;
      return real.dispatch(...a);
    },
  };
});

vi.mock("../robot/criticalStopAlert", async (importOriginal) => {
  const real = await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return {
    ...real,
    raiseCriticalStopAlert: async (a: { kind: string }) => {
      H.alerts.push({ kind: a.kind });
    },
  };
});
vi.mock("../robot/deviceOwnershipService", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/deviceOwnershipService")>();
  return {
    ...orig,
    sendCentralAdapterStop: async (adapterId: number) => {
      H.fallback.push(adapterId);
      return { ok: true, sent: "sent" as const, detail: "r1bnt recorded" };
    },
  };
});

vi.mock("../ot/trangThaiAdapter", async (importOriginal) => {
  const that = await importOriginal<typeof import("../ot/trangThaiAdapter")>();
  return {
    ...that,
    baoTrangThaiAdapter: (...args: Parameters<typeof that.baoTrangThaiAdapter>) => {
      const id = args[0].adapterId;
      const ds = H.bao.get(id) ?? [];
      ds.push(args[1]);
      H.bao.set(id, ds);
      return that.baoTrangThaiAdapter(...args);
    },
  };
});

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

import { getDb } from "../../db/connection";
import { aiPendingActions } from "../../../drizzle/schema";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import speakeasy from "speakeasy";
import { setup2FA, enable2FA, quayVongMaDuPhong, tieuMaDuPhongNguyenTu, verifyBackupCode, SO_MA_DU_PHONG } from "../../db/auth";
import { resolvePoolMax } from "../../db/connection";
import { __resetSoTotpChoTest } from "../../_core/totpOnce";
import { StubDriver } from "../ot/drivers/stubDriver";
import { createModbusDriver } from "../ot/drivers/modbusDriver";
import { registerDriver, createDriver } from "../ot/driverRegistry";
import { inverseScale } from "../ot/drivers/otScale";
import { otPayloadHash, withOtPayloadHash } from "../ot/otActionBinding";
import { adapterTargetFingerprint } from "../ot/adapterTarget";
import { acquireSeedExclusive } from "../edge/__edgeSeedGuard.dot10";

const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;

type Ghi = { tagKey: string; value: unknown; dataType?: "int" | "float"; scale?: number; offset?: number };
/** StubDriver THẬT + ghi lại MỌI lô ghi nó nhận (oracle: đúng giá trị ghim; số THÔ một driver thật sẽ ghi). */
class StubGhi extends StubDriver {
  ghi: Ghi[][] = [];
  override async writeTags(writes: Array<{ tagKey: string; address: string; value: unknown }>) {
    this.ghi.push((writes as unknown as Ghi[]).map((w) => ({ tagKey: w.tagKey, value: w.value, dataType: w.dataType, scale: w.scale, offset: w.offset })));
    return super.writeTags(writes);
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Router = typeof import("../../routers/scadaCommandsRouter").scadaCommandsRouter;
type Caller = ReturnType<Router["createCaller"]>;
type DispatchMod = typeof import("../ot/commandDispatcher");

let db: Db;
let scadaCommandsRouter: Router;
let disp: DispatchMod;
let boDem: typeof import("./boDemHienTai");
let cheDoMod: typeof import("./cheDoMay");

type May = { fid: number; sid: number; mid: number; code: string };
let A!: May;
const mayKhac: Record<"E" | "N" | "AUTO" | "C", number> = { E: 0, N: 0, AUTO: 0, C: 0 };
/** ad: adapter REMOTE/LOCAL chính (stub); adE edge; adN không ghim; adAuto máy AUTOMATION (REST); adX1 tắt, cho X1 */
const AD = { ad: 0, adE: 0, adN: 0, adAuto: 0, adX1: 0 };
const MA_AD = `${RUN}-a`;
const ENDPOINT = `stub://${MA_AD}`;
let stub!: StubGhi;
let stubAuto!: StubGhi;
let edgeNodeId = 0;
const factories: string[] = [];
const mayCodes: string[] = [];
const userIds: number[] = [];
const extraAdapterIds: number[] = [];
const nguoi: Record<string, { id: number; role: string }> = {};

const plc = { coils: new Map<number, boolean>(), port: 0, close: async () => undefined as unknown };
let seedLock: { release(): Promise<void> } | null = null;
const MA_PLC = `${RUN}-splc`.slice(0, 64);

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

async function seedNhaMay(ten: string): Promise<May> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${"May " + ten.toUpperCase()}, 'AOI', true) RETURNING id`,
  );
  factories.push(code);
  return { fid: Number(f.id), sid: Number(s.id), mid: Number(m.id), code };
}
async function seedMayThem(ten: string, machineType = "AOI"): Promise<number> {
  const code = `${RUN}${ten}`;
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${A.sid}, ${code}, ${"May " + ten.toUpperCase()}, ${machineType}, true) RETURNING id`,
  );
  mayCodes.push(code);
  return Number(m.id);
}
async function seedAdapter(mid: number, ma: string, o: { isEnabled?: boolean; protocol?: string; endpoint?: string; pollMs?: number; opts?: unknown } = {}): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "connectionOptions")
    VALUES (${mid}, ${`${RUN}-${ma}`}, ${`${RUN}-${ma}`}, ${o.protocol ?? "stub"}, ${o.endpoint ?? `stub://${RUN}-${ma}`}, ${o.pollMs ?? 60000},
      ${o.isEnabled ?? true}, 'disabled', ${o.opts === undefined ? null : JSON.stringify(o.opts)}::json) RETURNING id`);
  return Number(r.id);
}

interface TagSeed {
  key: string;
  dataType?: "float" | "int" | "bool";
  kind?: "input" | "input_output" | "output" | null;
  writable?: boolean;
  level?: 1 | 3 | 4 | 5 | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  stopValue?: unknown;
  scale?: number;
}
async function seedTag(adapterId: number, t: TagSeed): Promise<number> {
  const stop = t.stopValue === undefined || t.stopValue === null ? null : JSON.stringify(t.stopValue);
  const [r] = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", unit, scale, writable, "isEnabled",
      channel_kind, display_name, write_min, write_max, write_step, actuation_level, stop_value, stop_pinned_by, stop_pinned_at)
    VALUES (${adapterId}, ${t.key}, ${"DB1." + t.key}, ${t.dataType ?? "float"}, ${"u"}, ${t.scale ?? 1}, ${t.writable ?? true}, true,
      ${t.kind === null ? null : sql`${t.kind ?? "input_output"}::scada_channel_kind`}, ${"Kenh " + t.key},
      ${t.min === undefined ? 0 : t.min}, ${t.max === undefined ? 300 : t.max}, ${t.step === undefined ? 0.5 : t.step},
      ${t.level === undefined ? 3 : t.level}, ${stop}::jsonb, ${stop === null ? null : "1"}, ${stop === null ? null : sql`now()`}) RETURNING id`);
  return Number(r.id);
}

async function seedNguoi(ten: string, role: "operator" | "engineer" | "admin"): Promise<void> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "r1bnt", ts: RUN, ten: `R1B NT ${ten}` });
  userIds.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  await dung(
    sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`,
  );
  nguoi[ten] = { id: u.id, role };
}

/** Caller tRPC với ctx.user dựng TỪ HÀNG users hiện tại (như phiên thật: cờ 2FA đọc từ DB mỗi lần). */
async function caller(ten: string): Promise<Caller> {
  const n = nguoi[ten];
  const [u] = await dung(sql`SELECT id, role, name, two_factor_enabled AS "twoFactorEnabled" FROM users WHERE id = ${n.id}`);
  return scadaCommandsRouter.createCaller({ user: { id: Number(u.id), role: u.role, name: u.name, twoFactorEnabled: u.twoFactorEnabled === true } } as never);
}

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

const LY_DO = "nghiem thu R1b-1 theo phieu";
const uuid = () => crypto.randomUUID();
const mauOt = (tagKey: string, value: number, at: number = Date.now()) => ({ tagKey, raw: value, value, quality: "good" as const, timestamp: new Date(at) });
/** Nạp kênh chế độ của máy A; `tuoiMs` = mẫu đã nhận cách đây bao lâu (rx của bộ đệm). */
const napCheDo = (v: number, tuoiMs = 0) => {
  const at = Date.now() - tuoiMs;
  boDem.napTuOt({ adapterId: AD.ad, machineId: A.mid }, [mauOt("che_do", v, at)], at);
};

/** Đếm WORM theo khoá của tệp. */
async function demWorm(adapterId: number = AD.ad): Promise<{ attempts: number; commandLog: number }> {
  const ids = sql.join([...userIds, -1].map((i) => sql`${i}`), sql`, `);
  const [a] = await dung(sql`SELECT count(*)::int AS n FROM scada_command_attempts WHERE user_id IN (${ids})`);
  const [c] = await dung(sql`SELECT count(*)::int AS n FROM command_log WHERE "adapterId" = ${adapterId}`);
  return { attempts: Number(a.n), commandLog: Number(c.n) };
}
async function tang(truoc: { attempts: number; commandLog: number }, adapterId: number = AD.ad) {
  const sau = await demWorm(adapterId);
  return { attempts: sau.attempts - truoc.attempts, commandLog: sau.commandLog - truoc.commandLog };
}
type DongThu = { stage: string; outcome: string; reason_code: string | null; ly_do: string | null; adapter_id: number | null };
async function thuMoiNhat(userId: number, n: number): Promise<DongThu[]> {
  const r = (await dung(sql`SELECT stage, outcome, reason_code, ly_do, adapter_id FROM scada_command_attempts
    WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${n}`)) as DongThu[];
  return r.reverse();
}
type DongLenh = { status: string; errorText: string | null; ledger: string | null; tagKey: string; pinned: boolean | null };
async function lenhMoiNhat(adapterId: number, n: number): Promise<DongLenh[]> {
  const r = (await dung(sql`SELECT status::text AS status, "errorText", "ackValue"->>'ledger' AS ledger, "tagKey",
      ("ackValue"->>'pinnedStop')::boolean AS pinned
    FROM command_log WHERE "adapterId" = ${adapterId} ORDER BY id DESC LIMIT ${n}`)) as DongLenh[];
  return r.reverse();
}

/** "Tool AI" gọi thẳng dispatch(): dòng chờ AI ĐÃ XÁC NHẬN, gắn đúng lệnh (băm) — khuôn R1a. */
const TOOL_AI = "set_machine_param";
async function lenhAi(commandType: string, writes: Array<{ tagKey: string; value: unknown }>) {
  const owner = nguoi.engAi.id;
  const actionId = `${RUN}-ai-${uuid()}`;
  await db.insert(aiPendingActions).values({
    id: actionId,
    tool: TOOL_AI,
    argsJson: {},
    userId: owner,
    userRole: "engineer",
    summary: `${RUN} AI action`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL_AI, adapterId: AD.ad, machineId: A.mid, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return {
    adapterId: AD.ad,
    machineId: A.mid,
    commandType,
    writes,
    triggeredBy: { kind: "hitl" as const, actionId, tool: TOOL_AI, confirmedBy: owner, requestedBy: owner },
    idempotencyKey: `${RUN}-ai-${uuid()}`,
  };
}

/** Ghim DỪNG của adapter chính (oracle: driver nhận ĐÚNG các giá trị này, không gì khác) — sắp theo tagKey. */
const GHIM_A = [
  { tagKey: "dung", value: 0 },
  { tagKey: "stop_cmd", value: true },
];
const loCuoi = (s: StubGhi) => [...(s.ghi.at(-1) ?? [])].map((w) => ({ tagKey: w.tagKey, value: w.value })).sort((a, b) => a.tagKey.localeCompare(b.tagKey));

const ENV: Record<string, string> = {
  SCADA_COMMANDS_ENABLED: "true",
  SCADA_LIVE_CACHE_ENABLED: "true",
  SCADA_CONG_CHE_DO_ENABLED: "false", // cổng chế độ 3c vẫn chạy cho hmi.* — không nhờ cờ
  OT_CONTROL_ENABLED: "true", // D9: CHỈ trong tiến trình test
  OT_COMMISSIONING_REQUIRED: "true", // mặc định sản phẩm — adapter thử CÓ hàng commissioning
  OT_SAFETY_PREFLIGHT_ENABLED: "true",
  SAFETY_PLC_ADAPTER_ENABLED: "true",
  OT_READBACK_ENABLED: "false", // HMI (request/confirm/dungMay) vẫn đọc lại (docLai bat_buoc)
  OT_CMD_SERIALIZE_ENABLED: "false",
  SEC_PLATFORM: "false",
  UNS_CMD_ACK_ENABLED: "false",
  AI_OT_CONTROL_ENABLED: "false", // dispatch() không đọc cờ này (cổng AI ở tầng tool); giữ OFF như .env (D9)
  INTERLOCK_AUTO_BLOCK_ENABLED: "false",
  EDGE_RUNTIME_ENABLED: "true",
  OT_GATEWAY_ENABLED: "false", // C1 bật riêng trong khối của nó
};

describe.skipIf(!CHAY_NGHIEM_THU)("nghiệm thu R1b-1 — S1–S6, C1, R1, W1, B1, X1–X3 (SCADA_R1B_NGHIEM_THU=1)", () => {
  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    const url = process.env.DATABASE_URL ?? "";
    expect(url).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    seedLock = await acquireSeedExclusive(url, { waitMs: 30_000 });
    const d = await getDb();
    if (!d) throw new Error("test cần CSDL _test");
    db = d;
    await import("../ot/adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    registerDriver("modbus", createModbusDriver);
    ({ scadaCommandsRouter } = await import("../../routers/scadaCommandsRouter"));
    disp = await import("../ot/commandDispatcher");
    boDem = await import("./boDemHienTai");
    cheDoMod = await import("./cheDoMay");

    // safety-PLC giả: coil 0 = estop (false = sạch)
    plc.port = await freePort();
    const srv = new ServerTCP(
      {
        getCoil: (addr: number) => plc.coils.get(addr) ?? false,
        getDiscreteInput: () => false,
        getHoldingRegister: () => 0,
        getInputRegister: () => 0,
        setRegister: () => undefined,
        setCoil: () => undefined,
      },
      { host: "127.0.0.1", port: plc.port, unitID: 1 },
    );
    await new Promise<void>((resolve, reject) => {
      srv.once("initialized", () => resolve());
      srv.once("serverError", reject);
    });
    plc.close = () => new Promise<void>((resolve) => srv.close(() => resolve()));

    A = await seedNhaMay("a");
    await dung(sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", enabled, scope, "stationId")
      VALUES (${MA_PLC}, 'R1b-1 T12 safety PLC mo phong', 'generic', 'modbus', ${`tcp://127.0.0.1:${plc.port}`},
        ${JSON.stringify({ estop: { address: "coil:1", dataType: "bool" } })}::jsonb, true, NULL, ${A.sid})`);

    // ── máy A: adapter stub chính, kênh chế độ, hai ghim DỪNG (dung = 0 int mức 1, stop_cmd = true), sp (W1/X3), sc10cu (X2) ──
    const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
      VALUES (${A.mid}, ${MA_AD}, ${MA_AD}, 'stub', ${ENDPOINT}, 60000, true, 'disabled') RETURNING id`);
    AD.ad = Number(r.id);
    await dung(sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${AD.ad}, 'active', 1, ${RUN})`);
    H.fingerprints.set(AD.ad, adapterTargetFingerprint({ protocol: "stub", endpoint: ENDPOINT, machineId: A.mid, connectionOptions: null }));
    await seedTag(AD.ad, { key: "che_do", dataType: "int", kind: "input", writable: false, level: null, min: null, max: null, step: null });
    await seedTag(AD.ad, { key: "dung", dataType: "int", level: 1, min: 0, max: 100, step: 1, stopValue: 0 });
    await seedTag(AD.ad, { key: "stop_cmd", dataType: "bool", kind: "output", level: 1, min: null, max: null, step: null, stopValue: true });
    await seedTag(AD.ad, { key: "sp" }); // float mức 3, 0..300 bước 0.5
    // X2: tag int CHƯA khai (mọi cột 0431 NULL), scale 10
    await seedTag(AD.ad, { key: "sc10cu", dataType: "int", kind: null, level: null, min: null, max: null, step: null, scale: 10 });
    await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by)
      VALUES (${A.mid}, ${AD.ad}, 'che_do', '2'::jsonb, 1)`);
    boDem.datThongTinAdapter(AD.ad, { pollMs: 60_000, coDeadband: false, machineId: A.mid, code: MA_AD });
    napCheDo(2);
    stub = new StubGhi();
    await stub.connect({ endpoint: ENDPOINT } as never);
    H.drivers.set(AD.ad, stub);

    // X1: adapter TẮT trên máy A (dungMay chỉ gửi adapter BẬT) — tag đã khai đang ghim, đã khai, chưa khai
    AD.adX1 = await seedAdapter(A.mid, "x1", { isEnabled: false });

    // ── máy E: do edge sở hữu, có ghim ──
    mayKhac.E = await seedMayThem("e");
    AD.adE = await seedAdapter(mayKhac.E, "e");
    await seedTag(AD.adE, { key: "stop_cmd", dataType: "bool", kind: "output", level: 1, min: null, max: null, step: null, stopValue: true });
    const [n] = await dung(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${RUN + "-en"}, 'r1bnt edge', 'online') RETURNING id`);
    edgeNodeId = Number(n.id);
    await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id = ${AD.adE}`);

    // ── máy N: adapter bật, không ghim ──
    mayKhac.N = await seedMayThem("n");
    AD.adN = await seedAdapter(mayKhac.N, "n");
    await seedTag(AD.adN, { key: "sp" });

    // ── máy AUTO (AUTOMATION): REST v1 ──
    mayKhac.AUTO = await seedMayThem("auto", "AUTOMATION");
    AD.adAuto = await seedAdapter(mayKhac.AUTO, "auto");
    await seedTag(AD.adAuto, { key: "speed_sp", dataType: "int", level: 3, min: 0, max: 100, step: 1 });
    await seedTag(AD.adAuto, { key: "toc_do", dataType: "int", level: 1, min: 0, max: 100, step: 1, stopValue: 0 });
    stubAuto = new StubGhi();
    await stubAuto.connect({ endpoint: `stub://${RUN}-auto` } as never);
    H.drivers.set(AD.adAuto, stubAuto);

    // ── máy C: C1 (adapter modbus thật tạo trong khối C1) ──
    mayKhac.C = await seedMayThem("c");

    await seedNguoi("opA", "operator");
    await seedNguoi("opB", "operator");
    await seedNguoi("opKhong2fa", "operator");
    await seedNguoi("engAi", "engineer");
    await seedNguoi("adm2fa", "admin");
    await seedNguoi("b1", "operator");
    // opA / opB có 2FA (cờ DB) — opKhong2fa KHÔNG (S4)
    await dung(sql`UPDATE users SET two_factor_enabled = true WHERE id IN (${nguoi.opA.id}, ${nguoi.opB.id})`);
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    try {
      boDem?.xoaAdapter(AD.ad);
    } catch {
      /* bỏ qua */
    }
    for (const s of [stub, stubAuto]) {
      try {
        await s?.disconnect();
      } catch {
        /* bỏ qua */
      }
    }
    try {
      await plc.close();
    } catch {
      /* bỏ qua */
    }
    if (db) {
      try {
        for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id}`);
        for (const id of userIds) await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${id}`);
        for (const id of userIds) await dung(sql`DELETE FROM totp_consumed WHERE "userId" = ${id}`).catch(() => undefined);
        for (const id of userIds) await dung(sql`DELETE FROM backup_codes WHERE "userId" = ${id}`).catch(() => undefined);
        await __resetSoTotpChoTest(userIds).catch(() => undefined);
        await dung(sql`DELETE FROM safety_plc_configs WHERE code = ${MA_PLC}`);
        const ids = [...Object.values(AD), ...extraAdapterIds].filter(Boolean);
        for (const id of ids) {
          await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${id}`);
          // STOP edge chưa ack không xoá được thiết bị (0374 R-10-i) ⇒ ack TRƯỚC khi gỡ edgeNodeId (bài học T2: gỡ trước ⇒ ownerEpoch đổi, không ack được)
          await dung(sql`SELECT public.edge_stop_ack_edge(q.id, q."edgeNodeId", q."robotId", q."adapterId", q."ownerEpoch", 'done', false, NULL)
            FROM robot_motion_lock_requests q WHERE q."adapterId" = ${id} AND q."ackedAt" IS NULL AND q.kind = 'stop'`).catch((e) =>
            console.warn("[r1b-nt] ack STOP edge:", (e as Error).message),
          );
        }
        if (A?.mid) await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${A.mid}`);
        for (const id of ids) {
          await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
          await dung(sql`DELETE FROM commissioning_records WHERE "adapterId" = ${id}`).catch(() => undefined);
          await dung(sql`DELETE FROM config_snapshots WHERE entity_id = ${id} AND entity_type = 'mapping_file'`).catch(() => undefined);
          await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${id}`);
          await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
        }
        if (edgeNodeId) await dung(sql`DELETE FROM edge_nodes WHERE id = ${edgeNodeId}`);
        for (const code of mayCodes) await dung(sql`DELETE FROM machines WHERE code = ${code}`);
        for (const code of factories) {
          await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`);
          await dung(sql`DELETE FROM machines WHERE code = ${code}`);
          await dung(sql`DELETE FROM stations WHERE code = ${code}`);
          await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
          await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
          await dung(sql`DELETE FROM factories WHERE code = ${code}`);
        }
      } catch (e) {
        console.warn("[r1b-nt] dọn dữ liệu:", (e as Error).message, String((e as { cause?: unknown }).cause ?? ""));
      }
    }
    await seedLock?.release();
    seedLock = null;
  }, 120_000);

  // ═════════ S1–S6 — STOP HMI (`scadaCommands.dungMay`) ═════════
  it("S1 — STOP HMI, máy REMOTE ⇒ acked_verified; thiết bị nhận ĐÚNG giá trị ghim {dung:0, stop_cmd:true}; ledger pinnedStop; attempts +1, command_log +4", async () => {
    napCheDo(2);
    expect((await cheDoMod.cheDoMay(A.mid)).cheDo, "bố trí: máy REMOTE").toBe("REMOTE");
    const truoc = await demWorm();
    const ghi = stub.ghi.length;
    const d0 = H.dispatchCalls;
    const kq = await (await caller("opA")).dungMay({ machineId: A.mid, clientRequestId: uuid() });
    expect(kq.ketQua).toHaveLength(1);
    expect(kq.ketQua[0]).toMatchObject({ adapterId: AD.ad, status: "acked_verified", ok: true, simulated: false });
    expect(stub.ghi.length - ghi).toBe(1);
    expect(loCuoi(stub)).toEqual(GHIM_A);
    expect(H.dispatchCalls - d0).toBe(1);
    expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 4 });
    const dong = await lenhMoiNhat(AD.ad, 4);
    expect(dong.map((x) => [x.ledger, x.status])).toEqual([
      ["intent", "sent"],
      ["intent", "sent"],
      ["result", "acked_verified"],
      ["result", "acked_verified"],
    ]);
    expect(dong.every((x) => x.pinned === true), JSON.stringify(dong)).toBe(true);
    expect((await thuMoiNhat(nguoi.opA.id, 1))[0]).toMatchObject({ stage: "dispatch", outcome: "dispatched", reason_code: null, adapter_id: AD.ad, ly_do: "STOP: acked_verified" });
  });

  it("S2 — STOP HMI, máy LOCAL ⇒ VẪN gửi (không MODE_LOCAL), cả khi SCADA_CONG_CHE_DO_ENABLED tắt lẫn bật; đối chứng: request thường trên máy đó MODE_LOCAL", async () => {
    napCheDo(1);
    try {
      expect(await cheDoMod.cheDoMay(A.mid)).toMatchObject({ cheDo: "LOCAL", lyDo: "khac_remote" });
      // đối chứng: cổng chế độ THẬT SỰ thấy máy LOCAL (lệnh ghi thường bị chặn)
      const loi = await loiCua((await caller("opA")).request({ adapterId: AD.ad, tagKey: "sp", value: 100, lyDo: LY_DO, clientRequestId: uuid() }));
      expect(loi).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_MACHINE_NOT_REMOTE", appParams: { lyDo: "khac_remote" } });
      for (const co of ["false", "true"]) {
        vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", co);
        try {
          const truoc = await demWorm();
          const ghi = stub.ghi.length;
          const kq = await (await caller("opA")).dungMay({ machineId: A.mid, clientRequestId: uuid() });
          expect(kq.ketQua[0].reason, `cờ cổng chế độ = ${co}`).not.toBe("MODE_LOCAL");
          expect(kq.ketQua[0], `cờ cổng chế độ = ${co}`).toMatchObject({ adapterId: AD.ad, status: "acked_verified", ok: true, simulated: false });
          expect(stub.ghi.length - ghi).toBe(1);
          expect(loCuoi(stub)).toEqual(GHIM_A);
          expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 4 });
          expect((await lenhMoiNhat(AD.ad, 4)).every((x) => !String(x.errorText ?? "").startsWith("MODE_LOCAL"))).toBe(true);
        } finally {
          vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "false");
        }
      }
    } finally {
      napCheDo(2);
    }
  });

  it("S3 — STOP HMI khi NGƯỜI KHÁC giữ khoá chọn kênh dừng ⇒ VẪN gửi; khoá của opB giữ nguyên; đối chứng: request của opA trên kênh đó DANG_DUOC_CHON", async () => {
    napCheDo(2);
    const reqB = await (await caller("opB")).request({ adapterId: AD.ad, tagKey: "dung", value: 50, lyDo: LY_DO, clientRequestId: uuid() });
    try {
      const doi = await loiCua((await caller("opA")).request({ adapterId: AD.ad, tagKey: "dung", value: 40, lyDo: LY_DO, clientRequestId: uuid() }));
      expect(doi).toMatchObject({ code: "CONFLICT", appCode: "SCADA_TAG_SELECTED_BY_OTHER", appParams: { ma: "DANG_DUOC_CHON", boiUserId: nguoi.opB.id } });
      const truoc = await demWorm();
      const ghi = stub.ghi.length;
      const kq = await (await caller("opA")).dungMay({ machineId: A.mid, clientRequestId: uuid() });
      expect(kq.ketQua[0]).toMatchObject({ adapterId: AD.ad, status: "acked_verified", ok: true });
      expect(stub.ghi.length - ghi).toBe(1);
      expect(loCuoi(stub)).toEqual(GHIM_A);
      expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 4 });
      const [k] = await dung(sql`SELECT user_id, request_id FROM scada_khoa_chon WHERE adapter_id = ${AD.ad} AND tag_key = 'dung'`);
      expect(k).toMatchObject({ user_id: nguoi.opB.id, request_id: reqB.requestId });
    } finally {
      await (await caller("opB")).huy({ requestId: reqB.requestId });
    }
  });

  it("S4 — STOP HMI bởi operator CHƯA 2FA (two_factor_enabled=false trong DB) ⇒ VẪN gửi (mức 1)", async () => {
    napCheDo(2);
    const [u] = await dung(sql`SELECT two_factor_enabled AS t FROM users WHERE id = ${nguoi.opKhong2fa.id}`);
    expect(u.t, "bố trí: người bấm chưa có 2FA").not.toBe(true);
    const truoc = await demWorm();
    const ghi = stub.ghi.length;
    const kq = await (await caller("opKhong2fa")).dungMay({ machineId: A.mid, clientRequestId: uuid() });
    expect(kq.ketQua[0]).toMatchObject({ adapterId: AD.ad, status: "acked_verified", ok: true, simulated: false });
    expect(stub.ghi.length - ghi).toBe(1);
    expect(loCuoi(stub)).toEqual(GHIM_A);
    expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 4 });
    expect((await thuMoiNhat(nguoi.opKhong2fa.id, 1))[0]).toMatchObject({ stage: "dispatch", outcome: "dispatched", adapter_id: AD.ad });
  });

  it("S5 — STOP HMI máy EDGE ⇒ edgeStopRequest (hàng stop xếp cho node edge), không MODE_LOCAL, không STOP dự phòng trung tâm; command_log +1, attempts +1", async () => {
    (await import("../edge/edgeNodeCommands")).noteEdgeNodePull(edgeNodeId);
    H.fallback.length = 0;
    const truoc = await demWorm(AD.adE);
    const kq = await (await caller("opA")).dungMay({ machineId: mayKhac.E, clientRequestId: uuid() });
    expect(kq.ketQua).toHaveLength(1);
    expect(kq.ketQua[0]).toMatchObject({ adapterId: AD.adE, edgeStopRequest: true, reason: "ADAPTER_OWNED_BY_EDGE", ok: false });
    expect(kq.ketQua[0].reason).not.toBe("MODE_LOCAL");
    const [row] = await dung(sql`SELECT kind, "edgeNodeId" FROM robot_motion_lock_requests WHERE "adapterId" = ${AD.adE} ORDER BY id DESC LIMIT 1`);
    expect(row).toMatchObject({ kind: "stop", edgeNodeId });
    expect(H.fallback, "node edge tới được ⇒ không STOP dự phòng của trung tâm").toEqual([]);
    expect(await tang(truoc, AD.adE)).toEqual({ attempts: 1, commandLog: 1 });
    expect((await lenhMoiNhat(AD.adE, 1))[0].errorText).toMatch(/^ADAPTER_OWNED_BY_EDGE: .*STOP queued for it as request #\d+/);
  });

  it("S6 — máy chưa ghim ⇒ CHUA_GHIM_STOP (SCADA_STOP_NOT_PINNED) + ĐÚNG 1 dòng WORM attempts; dispatch 0 lần; command_log 0", async () => {
    const truoc = await demWorm(AD.adN);
    const d0 = H.dispatchCalls;
    const loi = await loiCua((await caller("opA")).dungMay({ machineId: mayKhac.N, clientRequestId: uuid() }));
    expect(loi).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_STOP_NOT_PINNED", appParams: { ma: "CHUA_GHIM_STOP" } });
    expect(H.dispatchCalls - d0).toBe(0);
    expect(await tang(truoc, AD.adN)).toEqual({ attempts: 1, commandLog: 0 });
    const [t] = await thuMoiNhat(nguoi.opA.id, 1);
    expect(t).toMatchObject({ stage: "dispatch", outcome: "rejected", reason_code: "CHUA_GHIM_STOP", adapter_id: null });
    expect(t.ly_do).toContain("E-STOP");
  });

  // ═════════ R1 — REST v1 lệnh OT ⇒ 501, 0 command_log ═════════
  it("R1 — REST v1 POST /equipment/:id/commands trên máy OT (AUTOMATION): write_tag / set_machine_param / stop (ghim & trần) ⇒ 501 not_implemented; command_log 0; thiết bị 0 lần", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/v1", (await import("../../api/v1/router")).createV1Router());
    let server!: Server;
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, "127.0.0.1", () => resolve());
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const truoc = await demWorm(AD.adAuto);
      const ghi = stubAuto.ghi.length;
      const d0 = H.dispatchCalls;
      const keys: string[] = [];
      const lenh = [
        { command: "write_tag", args: { adapterId: AD.adAuto, tagKey: "speed_sp", value: 42 } },
        { command: "set_machine_param", args: { adapterId: AD.adAuto, paramKey: "speed_sp", paramValue: "9" } },
        { command: "stop", args: { adapterId: AD.adAuto, writes: [{ tagKey: "toc_do", value: 0 }] } },
        { command: "stop", args: { adapterId: AD.adAuto } },
      ];
      for (const b of lenh) {
        const k = `${RUN}-rest-${uuid()}`;
        keys.push(k);
        const res = await fetch(`${base}/api/v1/equipment/${mayKhac.AUTO}/commands`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer MASTER" },
          body: JSON.stringify({ ...b, idempotencyKey: k }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: { code?: string } };
        expect(res.status, `${b.command}: ${JSON.stringify(body)}`).toBe(501);
        expect(body).toMatchObject({ ok: false, error: { code: "not_implemented" } });
      }
      expect(await tang(truoc, AD.adAuto)).toEqual({ attempts: 0, commandLog: 0 });
      const ds = sql.join(keys.map((k) => sql`${"%" + k + "%"}`), sql`, `);
      const [c] = await dung(sql`SELECT count(*)::int AS n FROM command_log WHERE "idempotencyKey" LIKE ANY (ARRAY[${ds}])`);
      expect(Number(c.n), "không hàng command_log nào mang khoá của các lệnh REST").toBe(0);
      expect(stubAuto.ghi.length - ghi).toBe(0);
      expect(H.dispatchCalls - d0).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ═════════ W1 — 100 DA_XU_LY / phút ⇒ ≤ 31 dòng attempts ═════════
  it("W1 — 100 lần confirm trên yêu cầu ĐÃ xử lý (DA_XU_LY) trong 1 phút ⇒ 30 dòng (≤ 31), client luôn nhận đúng mã; +61 s ⇒ 1 dòng DIEU_TIET '70 lần…' + dòng hiện tại; đối chứng mã an toàn MODE_LOCAL ×40 ⇒ 40 dòng", async () => {
    const dt = await import("./dieuTietThuLenh");
    dt.__datLaiDieuTiet();
    napCheDo(2);
    const c = await caller("opA");
    const { requestId } = await c.request({ adapterId: AD.ad, tagKey: "sp", value: 245, lyDo: LY_DO, clientRequestId: uuid() });
    expect(await c.confirm({ requestId })).toMatchObject({ status: "acked_verified", ok: true });
    const truoc = await demWorm();
    try {
      for (let i = 0; i < 100; i++) {
        const loi = await loiCua(c.confirm({ requestId }));
        expect(loi).toMatchObject({ code: "CONFLICT", appCode: "SCADA_REQUEST_ALREADY_HANDLED" });
      }
      const t = await tang(truoc);
      expect(t.attempts).toBeLessThanOrEqual(31);
      expect(t).toEqual({ attempts: 30, commandLog: 0 });
      expect((await thuMoiNhat(nguoi.opA.id, 30)).every((d) => d.stage === "confirm" && d.reason_code === "DA_XU_LY")).toBe(true);
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
      const loi = await loiCua(c.confirm({ requestId }));
      expect(loi.appCode).toBe("SCADA_REQUEST_ALREADY_HANDLED");
    } finally {
      vi.useRealTimers();
    }
    expect((await thuMoiNhat(nguoi.opA.id, 2)).map((d) => [d.reason_code, d.ly_do])).toEqual([
      ["DIEU_TIET", "70 lần DA_XU_LY bị gộp"],
      ["DA_XU_LY", expect.any(String)],
    ]);

    // đối chứng: mã cổng an toàn (MODE_LOCAL) KHÔNG bị điều tiết — 40 lần ⇒ 40 dòng (> trần 30)
    napCheDo(1);
    try {
      const t0 = await demWorm();
      for (let i = 0; i < 40; i++) {
        const loi = await loiCua(c.request({ adapterId: AD.ad, tagKey: "sp", value: 100, lyDo: LY_DO, clientRequestId: uuid() }));
        expect(loi.appCode).toBe("SCADA_MACHINE_NOT_REMOTE");
      }
      expect(await tang(t0)).toEqual({ attempts: 40, commandLog: 0 });
    } finally {
      napCheDo(2);
    }
  }, 180_000);

  // ═════════ B1 — 10 lượt song song cùng mã dự phòng ⇒ đúng 1 thành công ═════════
  it("B1 — 10 lượt SONG SONG cùng một mã dự phòng (tiêu nguyên tử) ⇒ ĐÚNG 1 thành công, 9 thất bại; đúng 1 mã bị tiêu; dùng lại sau đó thất bại", async () => {
    expect(resolvePoolMax(), "pool > 1 — không thì song song là xếp hàng giả").toBeGreaterThanOrEqual(2);
    const uid = nguoi.b1.id;
    const ma = await quayVongMaDuPhong(uid);
    const conLai = async () => Number((await dung(sql`SELECT count(*)::int AS n FROM backup_codes WHERE "userId" = ${uid} AND "isUsed" = false`))[0].n);
    expect(await conLai()).toBe(SO_MA_DU_PHONG);
    const kq = await Promise.all(Array.from({ length: 10 }, () => tieuMaDuPhongNguyenTu(uid, ma[0]!)));
    expect(kq.filter((x) => x === true).length, JSON.stringify(kq)).toBe(1);
    expect(kq.filter((x) => x === false).length).toBe(9);
    expect(await conLai()).toBe(SO_MA_DU_PHONG - 1);
    expect(await tieuMaDuPhongNguyenTu(uid, ma[0]!)).toBe(false);
  }, 60_000);

  it("B1 (quan sát, không phải cổng) — 10 lượt song song qua verifyBackupCode ĐẦY ĐỦ (bộ đếm T16, trần 10/giờ): không bao giờ tiêu hai lần; ghi lại số thắng / thua / bị khoá", async () => {
    const uid = nguoi.b1.id;
    await __resetSoTotpChoTest([uid]);
    await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${uid}`);
    const ma = await quayVongMaDuPhong(uid);
    const kq = await Promise.allSettled(Array.from({ length: 10 }, () => verifyBackupCode(uid, ma[0]!)));
    const dung1 = kq.filter((x) => x.status === "fulfilled" && x.value === true).length;
    const sai = kq.filter((x) => x.status === "fulfilled" && x.value === false).length;
    const nem = kq.filter((x) => x.status === "rejected").map((x) => String(((x as PromiseRejectedResult).reason as { message?: string })?.message ?? "").slice(0, 60));
    const [daTieu] = await dung(sql`SELECT count(*)::int AS n FROM backup_codes WHERE "userId" = ${uid} AND "isUsed" = true`);
    console.log(`[r1b-nt] B1 qua verifyBackupCode ×10: true=${dung1} false=${sai} ném=${nem.length} ${JSON.stringify([...new Set(nem)])} · mã đã tiêu=${daTieu.n}`);
    expect(dung1).toBeLessThanOrEqual(1);
    expect(Number(daTieu.n), "không bao giờ tiêu hai lần").toBeLessThanOrEqual(1);
    await __resetSoTotpChoTest([uid]);
    await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${uid}`);
  }, 60_000);

  // ═════════ X1 — trỏ lại tag ĐÃ KHAI qua deviceAdapter.tags.update ═════════
  it("X1 — đổi scale tag ĐÃ KHAI không mã ⇒ TOTP_CAN (hàng nguyên); có mã đúng + ghim DỪNG lệch lưới mới ⇒ STOP_PIN_NGOAI_DAI (mã không bị tiêu); tag CHƯA khai ⇒ như cũ (không mã)", async () => {
    const { deviceAdapterRouter } = await import("../../routers/deviceAdapterRouter");
    const u = nguoi.adm2fa;
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    await setup2FA(u.id, secret);
    await enable2FA(u.id);
    const c = deviceAdapterRouter.createCaller({ user: { id: u.id, role: "admin", name: "R1B NT adm", twoFactorEnabled: true } } as never);
    const tDk = await seedTag(AD.adX1, { key: "dk", dataType: "int", level: 3, min: 0, max: 100, step: 1 });
    const tPin = await seedTag(AD.adX1, { key: "dkpin", dataType: "int", level: 1, min: 0, max: 100, step: 1, stopValue: 3 });
    const tCu = await seedTag(AD.adX1, { key: "cu", dataType: "int", kind: null, level: null, min: null, max: null, step: null });
    const hang = async (id: number) =>
      (await dung(sql`SELECT scale::float8 AS scale, address, stop_value AS "stopValue" FROM device_tags WHERE id = ${id}`))[0] as { scale: number; address: string; stopValue: unknown };

    const e1 = await loiCua(c.tags.update({ id: tDk, scale: 2 }));
    expect(e1).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_REQUIRED", appParams: { ma: "TOTP_CAN" } });
    expect((await hang(tDk)).scale).toBe(1);

    const ma = speakeasy.totp({ secret, encoding: "base32" });
    const e2 = await loiCua(c.tags.update({ id: tPin, scale: 2, totpCode: ma }));
    expect(e2).toMatchObject({ code: "BAD_REQUEST", appCode: "STOP_PIN_NGOAI_DAI" });
    expect(e2.appParams).toMatchObject({ ma: "STOP_PIN_NGOAI_DAI", lyDo: "OFF_STEP", tagKey: "dkpin" });
    expect(await hang(tPin)).toMatchObject({ scale: 1, stopValue: 3 });
    // cùng mã vẫn dùng được cho một lượt hợp lệ ⇒ lượt bị từ chối KHÔNG tiêu mã (TOTP kiểm cuối)
    await c.tags.update({ id: tDk, scale: 2, totpCode: ma });
    expect((await hang(tDk)).scale).toBe(2);

    await c.tags.update({ id: tCu, scale: 5, address: "DB1.cu2" });
    expect(await hang(tCu)).toMatchObject({ scale: 5, address: "DB1.cu2" });
  }, 60_000);

  // ═════════ X2 — dispatch AI lên tag int CHƯA khai scale 10 ═════════
  it("X2 — AI dispatch 25 lên tag int CHƯA khai scale 10 ⇒ OFF_STEP (goiY 30, step 10, appError SCADA_VALUE_OFF_STEP), thiết bị 0 lần, command_log +1; 30 ⇒ gửi nguyên 30, số thô 3", async () => {
    napCheDo(2);
    let truoc = await demWorm();
    let ghi = stub.ghi.length;
    const r25 = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sc10cu", value: 25 }]));
    expect(r25, JSON.stringify(r25)).toMatchObject({ ok: false, status: "rejected", reason: "OFF_STEP" });
    expect(r25.appError).toEqual({ appCode: "SCADA_VALUE_OFF_STEP", appParams: { ma: "OFF_STEP", tagKey: "sc10cu", step: 10, goiY: 30 } });
    expect(stub.ghi.length - ghi).toBe(0);
    expect(await tang(truoc)).toEqual({ attempts: 0, commandLog: 1 });
    expect((await lenhMoiNhat(AD.ad, 1))[0].errorText).toMatch(/^OFF_STEP: Tag "sc10cu": .*\(goiY=30\)$/);

    truoc = await demWorm();
    ghi = stub.ghi.length;
    const r30 = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sc10cu", value: 30 }]));
    expect(r30, JSON.stringify(r30)).toMatchObject({ ok: true, simulated: false });
    expect(stub.ghi.length - ghi).toBe(1);
    const w = stub.ghi.at(-1)![0];
    expect(w).toMatchObject({ tagKey: "sc10cu", value: 30, dataType: "int", scale: 10 });
    expect(inverseScale(w.value, w.dataType!, w.scale ?? 1, w.offset ?? 0), "số THÔ driver thật sẽ ghi").toBe(3);
  });

  // ═════════ X3 — mẫu REMOTE cũ hơn 30 s trên adapter poll 60 s ═════════
  it("X3 — kênh chế độ REMOTE nhận cách đây 31 s, adapter poll 60 s (bộ đệm CHƯA stale) ⇒ cổng chế độ LOCAL 'cu' (fail-closed): request HMI MODE_LOCAL {cu}, dispatch AI (cổng bật) MODE_LOCAL; đối chứng 20 s ⇒ REMOTE", async () => {
    napCheDo(2, 31_000);
    try {
      const g = boDem.layGiaTri(AD.ad, "che_do")!;
      expect(g.stale, "bộ đệm: ngưỡng stale max(3·60 s) ⇒ CHƯA stale — chỉ kẹp 30 s của cổng chế độ làm LOCAL").toBe(false);
      expect(g.ageMs).toBeGreaterThanOrEqual(31_000);
      expect(await cheDoMod.cheDoMay(A.mid)).toMatchObject({ cheDo: "LOCAL", lyDo: "cu" });
      let truoc = await demWorm();
      const loi = await loiCua((await caller("opA")).request({ adapterId: AD.ad, tagKey: "sp", value: 100, lyDo: LY_DO, clientRequestId: uuid() }));
      expect(loi).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_MACHINE_NOT_REMOTE", appParams: { lyDo: "cu" } });
      expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 0 });
      expect((await thuMoiNhat(nguoi.opA.id, 1))[0]).toMatchObject({ stage: "request", outcome: "rejected", reason_code: "MODE_LOCAL" });

      vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "true");
      try {
        truoc = await demWorm();
        const ghi = stub.ghi.length;
        const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sp", value: 100 }]));
        expect(res, JSON.stringify(res)).toMatchObject({ ok: false, status: "rejected", reason: "MODE_LOCAL" });
        expect(stub.ghi.length - ghi).toBe(0);
        expect(await tang(truoc)).toEqual({ attempts: 0, commandLog: 1 });
        expect((await lenhMoiNhat(AD.ad, 1))[0].errorText).toMatch(/^MODE_LOCAL: cu/);
      } finally {
        vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "false");
      }

      // đối chứng: cùng giá trị, tuổi 20 s (< 30 s) ⇒ REMOTE, request được nhận
      napCheDo(2, 20_000);
      expect((await cheDoMod.cheDoMay(A.mid)).cheDo).toBe("REMOTE");
      const kq = await (await caller("opA")).request({ adapterId: AD.ad, tagKey: "sp", value: 100, lyDo: LY_DO, clientRequestId: uuid() });
      expect(kq.requestId).toBeTruthy();
      await (await caller("opA")).huy({ requestId: kq.requestId });
    } finally {
      napCheDo(2);
    }
  });

  // ═════════ C1 — TCP lên, mọi đọc quá hạn (cờ V2) ⇒ không bao giờ `connected` ═════════
  describe("C1 — otManager THẬT + ModbusDriver THẬT trên máy chủ TCP IM LẶNG", () => {
    const CUA_SO_MS = 9_000;
    let telemetrySeam: typeof import("../telemetryBus") | null = null;
    let otMod: typeof import("../ot/otManager");
    let devAd: typeof import("../ot/deviceAdapter");

    beforeAll(async () => {
      otMod = await import("../ot/otManager");
      devAd = await import("../ot/deviceAdapter");
      telemetrySeam = await import("../telemetryBus");
      telemetrySeam.setTelemetryPersistFn(async (rows) => rows.length); // không ghi ot_telemetry (mẫu xấu comm_lost) xuống _test
    });
    afterAll(async () => {
      try {
        await otMod?.stopOt();
      } catch {
        /* bỏ qua */
      }
      devAd?.setAdapterSource(null);
      telemetrySeam?.setTelemetryPersistFn(null);
    }, 30_000);

    /** Một lượt: máy chủ TCP im lặng, adapter modbus (poll 1 s, timeout 800 ms), otManager chạy CUA_SO_MS; trả mọi trạng thái RAM + DB. */
    async function motLuot(nhan: string, ha: "true" | "false", v2: "true" | "false") {
      vi.stubEnv("OT_GATEWAY_ENABLED", "true");
      vi.stubEnv("OT_CONN_HA_ENABLED", ha);
      vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", v2);
      vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "true");
      vi.stubEnv("OT_LEGACY_RECONNECT_MS", "1000");
      vi.stubEnv("OT_CONN_HA_BACKOFF_MS", "1000");
      vi.stubEnv("OT_CONN_HA_BACKOFF_JITTER", "0");
      vi.stubEnv("OT_STORE_FORWARD_ENABLED", "false");
      vi.stubEnv("OT_POLL_BATCH_ENABLED", "false");
      vi.stubEnv("OT_TAG_DEADBAND_ENABLED", "false");
      vi.stubEnv("OT_INGEST_TO_UNS", "false");
      vi.stubEnv("SCADA_SOCKET_ENABLED", "false");
      const ketNoi: net.Socket[] = [];
      let soByteNhan = 0;
      const srv = net.createServer((s) => {
        ketNoi.push(s);
        s.on("data", (b) => {
          soByteNhan += b.length; // nhận yêu cầu Modbus, KHÔNG BAO GIỜ trả lời
        });
        s.on("error", () => undefined);
      });
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
      const port = (srv.address() as AddressInfo).port;
      const endpoint = `tcp://127.0.0.1:${port}`;
      const code = `${RUN}-c1-${nhan}`;
      const id = await seedAdapter(mayKhac.C, `c1-${nhan}`, { protocol: "modbus", endpoint, pollMs: 1000, opts: { unitId: 1, timeoutMs: 800 } });
      extraAdapterIds.push(id);
      await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled") VALUES
        (${id}, 'r1', 'holding:1', 'int', false, true), (${id}, 'r2', 'holding:2', 'int', false, true)`);
      H.bao.delete(id);
      devAd.setAdapterSource(async () => [
        {
          adapterId: id,
          code,
          machineId: mayKhac.C,
          protocol: "modbus" as const,
          connection: { endpoint, timeoutMs: 800, options: { unitId: 1, timeoutMs: 800 } },
          pollIntervalMs: 1000,
          tags: [
            { tagKey: "r1", address: "holding:1", dataType: "int" as const },
            { tagKey: "r2", address: "holding:2", dataType: "int" as const },
          ],
          driver: createDriver("modbus"),
        } as never,
      ]);
      const dbSeen = new Set<string>();
      try {
        expect(await otMod.startOt()).toBe(true);
        const t0 = Date.now();
        while (Date.now() - t0 < CUA_SO_MS) {
          dbSeen.add(String((await dung(sql`SELECT status FROM device_adapters WHERE id = ${id}`))[0]?.status ?? ""));
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        await otMod.stopOt();
        devAd.setAdapterSource(null);
        for (const s of ketNoi) s.destroy();
        await new Promise<void>((r) => srv.close(() => r()));
      }
      // xả lần ghi DB đang hẹn (điều tiết 5 s) rồi đọc lần cuối
      await new Promise((r) => setTimeout(r, 6_000));
      dbSeen.add(String((await dung(sql`SELECT status FROM device_adapters WHERE id = ${id}`))[0]?.status ?? ""));
      const bao = H.bao.get(id) ?? [];
      const kq = { nhan, ha, v2, soKetNoiTcp: ketNoi.length, soByteYeuCau: soByteNhan, baoRam: bao, dbThay: [...dbSeen] };
      console.log(`[r1b-nt] C1 ${JSON.stringify(kq)}`);
      return kq;
    }

    it("C1 — cờ V2 BẬT, nhánh legacy: TCP lên (≥ 2 kết nối), yêu cầu tới nơi, mọi đọc quá hạn ⇒ RAM không bao giờ báo 'connected', DB không bao giờ 'connected'", async () => {
      const kq = await motLuot("lg-v2", "false", "true");
      expect(kq.soKetNoiTcp, "TCP thật sự lên, qua nhiều phiên nối lại").toBeGreaterThanOrEqual(2);
      expect(kq.soByteYeuCau, "yêu cầu đọc thật sự tới thiết bị").toBeGreaterThan(0);
      expect(kq.baoRam).not.toContain("connected");
      expect(kq.dbThay).not.toContain("connected");
    }, 60_000);

    it("C1 — cờ V2 BẬT, nhánh HA (ConnectionSupervisor): như trên ⇒ không bao giờ 'connected' (RAM lẫn DB)", async () => {
      const kq = await motLuot("ha-v2", "true", "true");
      expect(kq.soKetNoiTcp).toBeGreaterThanOrEqual(1);
      expect(kq.soByteYeuCau).toBeGreaterThan(0);
      expect(kq.baoRam).not.toContain("connected");
      expect(kq.dbThay).not.toContain("connected");
    }, 60_000);

    it("C1 đối chứng (cờ V2 TẮT, legacy): CÙNG kích thích ⇒ 'connected' GIẢ xuất hiện — chứng minh phép đo NHÌN THẤY được 'connected'", async () => {
      const kq = await motLuot("lg-v1", "false", "false");
      expect(kq.soKetNoiTcp).toBeGreaterThanOrEqual(1);
      expect(kq.baoRam).toContain("connected");
    }, 60_000);
  });
});
