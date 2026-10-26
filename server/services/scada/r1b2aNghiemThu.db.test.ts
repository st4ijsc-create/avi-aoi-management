/**
 * SCADA R1b-2a Task 15 — NGHIỆM THU R1b-2a "An toàn, đúng đắn và nợ R1b-1": ma trận 14 ô L1 L2 L3 M1 G1 G2 D1 S1 K1 N1 W1 W2 B1 H1 trên CSDL
 * `_test` THẬT (khuôn `r1bNghiemThu.db.test.ts`).
 *
 * Đường chạy thật:
 *   • L1 / L2 / M1 / W1 / D1: router tRPC THẬT (`scadaCommands.request / confirm / dungMay`, người dùng qua `taoNguoiDungTest`, `ctx.user` dựng
 *     TỪ hàng `users`) và `dispatch()` THẬT (binding, cổng kênh 3b, cổng chế độ 3c, đặt chỗ ghi, đọc lại) → StubDriver THẬT (RAM, ghi lại lô).
 *     Commissioning BẬT (adapter có `commissioning_records`), preflight safety THẬT trên safety PLC MÔ PHỎNG (D9, `ServerTCP` trong tiến trình).
 *   • L2: `proposeControlFromVerdict` THẬT (bộ nạp lưới mặc định của sản phẩm đọc `device_tags` của adapter `adapterIdForMachine`); `deps.propose`
 *     ghi lại args; chính args ấy qua `congKenhSom` VÀ `dispatch()` THẬT.
 *   • L3: `TRUY_VAN_TRUOC_TRIEN_KHAI` (hằng của mã) chạy trên `_test` so với `luatLenhLechLuoi` (hàm JS của cổng dispatch).
 *   • G1 / G2: express + `createHmiStopLimiter` / `createApiLimiter` / `createUnverifiedCredentialIpLimiter` THẬT gắn ĐÚNG thứ tự `_core/index.ts`,
 *     vé ký bằng `sdk.signSession` THẬT, `user_sessions` THẬT, `createContext` THẬT (vé thu hồi bị từ chối).
 *   • S1 / K1 / N1: `deviceAdapter.*` / `scadaDiag.tamTat` / `scadaKenh.khaiHangLoat` THẬT, kỹ sư nhà máy A (không admin), phạm vi
 *     `idsTrongPhamVi` THẬT, quyền `checkPermission` THẬT, TOTP THẬT (speakeasy + setup2FA / enable2FA, `kiemXacThucTheoMuc` + bộ đếm T16).
 *     S1: đổi máy đồng thời bằng HAI GIAO DỊCH THẬT (khuôn `phamViDuoiKhoa.r1b2.db.test.ts`, đo chặn bằng `pg_blocking_pids`).
 *   • W2: bộ điều tiết THẬT (`dieuTietThuLenh`) + hẹn giờ xả của nó (đồng hồ giả chỉ cho Date / setInterval; CSDL dùng setTimeout thật).
 *   • B1: `verifyBackupCode` ĐẦY ĐỦ (bộ đếm T16 + hoàn lượt T10) trên `backup_codes` THẬT, 10 lượt song song.
 *   • H1: `createHealthHandler` THẬT (ping DB `_test` thật) + `kiemSchemaR1a` THẬT trên `pg_constraint` (lọc bỏ một FK của 0433 ở tầng kết quả).
 *
 * Chỗ giả (hạ tầng, không phải cổng): `getActiveDriver` / `getActiveConnectionFingerprint` (StubDriver + vân tay TÍNH từ hàng adapter); `getIO`;
 * `dispatch` BỌC để đếm (gọi xuyên mã thật); `raiseCriticalStopAlert` + `sendCentralAdapterStop` ghi lại; D1: `loadStopPinsHmi` (callee THẬT của
 * dungMay, ruling K5) BỌC chờ N ms rồi gọi bản thật — chỉ trong ô D1.
 * `OT_CONTROL_ENABLED=true` CHỈ trong tiến trình (D9). `AI_OT_CONTROL_ENABLED="false"` (không đổi ở đâu khác).
 *
 * CHỈ CHẠY KHI GỌI TƯỜNG MINH (như R0 / R1a / R1b-1):
 *   Bash:       SCADA_R1B2A_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r1b2aNghiemThu.db.test.ts
 *   PowerShell: $env:SCADA_R1B2A_NGHIEM_THU='1'; npx vitest run -c vitest.db.config.ts server/services/scada/r1b2aNghiemThu.db.test.ts
 * Không đặt biến ⇒ cả tệp bị bỏ qua (không dựng dữ liệu).
 *
 * `command_log` + `scada_command_attempts` + `control_audit_log` là WORM: hàng của tệp ở lại (đúng thiết kế). Mọi hàng khác được dọn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import net from "node:net";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { like, sql, type SQL } from "drizzle-orm";
import * as ModbusSerialNs from "modbus-serial";

vi.hoisted(() => {
  process.env.JWT_SECRET ||= "r1b2a-nghiem-thu-secret-t15";
  process.env.VITE_APP_ID ||= "avi-aoi-management";
});

const RUN = `r1b2ant${process.pid}${Date.now().toString(36)}`;
const CHAY_NGHIEM_THU = process.env.SCADA_R1B2A_NGHIEM_THU === "1";

const H = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  dispatchCalls: 0,
  /** D1 — adapterId ⇒ ms chờ trước khi gọi loadStopPinsHmi thật */
  ghimCho: new Map<number, number>(),
}));

vi.mock("../../_core/socket", async importOriginal => {
  const real = await importOriginal<typeof import("../../_core/socket")>();
  return {
    ...real,
    getIO: () => ({ to: () => ({ emit: () => true }) }) as never,
  };
});

vi.mock("../ot/otManager", async importOriginal => {
  const orig = await importOriginal<typeof import("../ot/otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) =>
      H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) =>
      H.fingerprints.get(adapterId),
  };
});

vi.mock("../ot/commandDispatcher", async importOriginal => {
  const real = await importOriginal<typeof import("../ot/commandDispatcher")>();
  return {
    ...real,
    dispatch: async (...a: Parameters<typeof real.dispatch>) => {
      H.dispatchCalls += 1;
      return real.dispatch(...a);
    },
  };
});

vi.mock("../ot/stopPin", async importOriginal => {
  const real = await importOriginal<typeof import("../ot/stopPin")>();
  return {
    ...real,
    loadStopPinsHmi: (async (...a: Parameters<typeof real.loadStopPinsHmi>) => {
      const ms = H.ghimCho.get(a[1]) ?? 0;
      if (ms > 0) {
        await new Promise<void>(r => {
          const t = setTimeout(r, ms);
          (t as { unref?: () => void }).unref?.();
        });
      }
      return real.loadStopPinsHmi(...a);
    }) as typeof real.loadStopPinsHmi,
  };
});

vi.mock("../robot/criticalStopAlert", async importOriginal => {
  const real =
    await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return { ...real, raiseCriticalStopAlert: async () => undefined };
});
vi.mock("../robot/deviceOwnershipService", async importOriginal => {
  const orig =
    await importOriginal<typeof import("../robot/deviceOwnershipService")>();
  return {
    ...orig,
    sendCentralAdapterStop: async () => ({
      ok: true,
      sent: "sent" as const,
      detail: "r1b2ant recorded",
    }),
  };
});

import { getDb, resolvePoolMax } from "../../db/connection";
import { aiPendingActions, interlockRules } from "../../../drizzle/schema";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import speakeasy from "speakeasy";
import {
  setup2FA,
  enable2FA,
  quayVongMaDuPhong,
  verifyBackupCode,
} from "../../db/auth";
import { __resetSoTotpChoTest } from "../../_core/totpOnce";
import { docKhoa } from "../../_core/totpKhoaSai";
import { readAppErrorMeta } from "../../_core/appError";
import { COOKIE_NAME } from "@shared/const";
import { StubDriver } from "../ot/drivers/stubDriver";
import { createModbusDriver } from "../ot/drivers/modbusDriver";
import { registerDriver } from "../ot/driverRegistry";
import { inverseScale } from "../ot/drivers/otScale";
import { otPayloadHash, withOtPayloadHash } from "../ot/otActionBinding";
import { adapterTargetFingerprint } from "../ot/adapterTarget";
import { acquireSeedExclusive } from "../edge/__edgeSeedGuard.dot10";
import { congKenhSom, type TagCongKenh } from "../ot/commandDispatcher";
import {
  proposeControlFromVerdict,
  type ProposeControlDeps,
} from "../qualityControlProposer";
import {
  luatLenhLechLuoi,
  TRUY_VAN_TRUOC_TRIEN_KHAI,
} from "./lenhInterlockLechLuoi";
import { HAN_TRUOC_GUI_STOP_HMI_MS, MA_STOP_QUA_HAN } from "./lenhHmi";

const ServerTCP: any =
  (ModbusSerialNs as any).ServerTCP ??
  (ModbusSerialNs as any).default?.ServerTCP;

type Ghi = {
  tagKey: string;
  value: unknown;
  dataType?: "int" | "float";
  scale?: number;
  offset?: number;
};
/** StubDriver THẬT + ghi lại MỌI lô ghi nó nhận (oracle: giá trị + số THÔ một driver thật sẽ ghi). */
class StubGhi extends StubDriver {
  ghi: Ghi[][] = [];
  override async writeTags(
    writes: Array<{ tagKey: string; address: string; value: unknown }>
  ) {
    this.ghi.push(
      (writes as unknown as Ghi[]).map(w => ({
        tagKey: w.tagKey,
        value: w.value,
        dataType: w.dataType,
        scale: w.scale,
        offset: w.offset,
      }))
    );
    return super.writeTags(writes);
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Router =
  typeof import("../../routers/scadaCommandsRouter").scadaCommandsRouter;
type Caller = ReturnType<Router["createCaller"]>;
type DispatchMod = typeof import("../ot/commandDispatcher");

let db: Db;
let scadaCommandsRouter: Router;
let disp: DispatchMod;
let boDem: typeof import("./boDemHienTai");

type May = { fid: number; sid: number; mid: number; code: string };
let A!: May;
let B!: May;
/** máy phụ trong nhà máy A: S (S1), S2 (đối chứng dương S1), K (K1 / N1) */
const mayA: Record<"S" | "S2" | "K", number> = { S: 0, S2: 0, K: 0 };
const AD = { ad: 0, adX: 0, adL3: 0, adK: 0 };
const MA_AD = `${RUN}-a`;
const ENDPOINT = `stub://${MA_AD}`;
let stub!: StubGhi;
const factories: string[] = [];
const mayCodes: string[] = [];
const userIds: number[] = [];
const extraAdapterIds: number[] = [];
const nguoi: Record<
  string,
  { id: number; role: string; openId: string; name: string; username: string }
> = {};

const plc = { port: 0, close: async () => undefined as unknown };
let seedLock: { release(): Promise<void> } | null = null;
const MA_PLC = `${RUN}-splc`.slice(0, 64);

async function dung(q: SQL): Promise<any[]> {
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
const cho = (ms: number) => new Promise(r => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
const inIds = (ids: number[]) =>
  sql.join(
    ids.map(i => sql`${i}`),
    sql`, `
  );

async function seedNhaMay(ten: string): Promise<May> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(
    sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`
  );
  const [w] = await dung(
    sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`
  );
  const [l] = await dung(
    sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`
  );
  const [s] = await dung(
    sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`
  );
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${"May " + ten.toUpperCase()}, 'AOI', true) RETURNING id`
  );
  factories.push(code);
  return { fid: Number(f.id), sid: Number(s.id), mid: Number(m.id), code };
}
async function seedMayThem(stationId: number, ten: string): Promise<number> {
  const code = `${RUN}${ten}`;
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${stationId}, ${code}, ${"May " + ten.toUpperCase()}, 'AOI', true) RETURNING id`
  );
  mayCodes.push(code);
  return Number(m.id);
}
let soAd = 0;
async function seedAdapter(
  mid: number | null,
  o: { isEnabled?: boolean } = {}
): Promise<number> {
  const ma = `${RUN}-x${++soAd}`;
  const [r] =
    await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${mid}, ${ma}, ${ma}, 'stub', ${"stub://" + ma}, 60000, ${o.isEnabled ?? false}, 'disabled') RETURNING id`);
  extraAdapterIds.push(Number(r.id));
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
  const stop =
    t.stopValue === undefined || t.stopValue === null
      ? null
      : JSON.stringify(t.stopValue);
  const [r] =
    await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", unit, scale, writable, "isEnabled",
      channel_kind, display_name, write_min, write_max, write_step, actuation_level, stop_value, stop_pinned_by, stop_pinned_at)
    VALUES (${adapterId}, ${t.key}, ${"DB1." + t.key}, ${t.dataType ?? "float"}, ${"u"}, ${t.scale ?? 1}, ${t.writable ?? true}, true,
      ${t.kind === null ? null : sql`${t.kind ?? "input_output"}::scada_channel_kind`}, ${"Kenh " + t.key},
      ${t.min === undefined ? 0 : t.min}, ${t.max === undefined ? 300 : t.max}, ${t.step === undefined ? 0.5 : t.step},
      ${t.level === undefined ? 3 : t.level}, ${stop}::jsonb, ${stop === null ? null : "1"}, ${stop === null ? null : sql`now()`}) RETURNING id`);
  return Number(r.id);
}
/** tag int CHƯA khai mô hình ghi (channel_kind / min / max / step NULL) */
const chuaKhai = (
  key: string,
  scale: number,
  level: 3 | null = null
): TagSeed => ({
  key,
  dataType: "int",
  kind: null,
  level,
  min: null,
  max: null,
  step: null,
  scale,
});

async function seedNguoi(
  ten: string,
  role: "operator" | "engineer" | "admin",
  factoryCodes: string[]
): Promise<void> {
  const u = await taoNguoiDungTest(ten, role, {
    tienTo: "r1b2ant",
    ts: RUN,
    ten: `R1B2A NT ${ten}`,
  });
  userIds.push(u.id);
  for (const code of factoryCodes)
    await dung(
      sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`
    );
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete")
    VALUES (${u.id}, 'machine_control', 'machine_control', true, true, true, true)`);
  await dung(
    sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true)`
  );
  nguoi[ten] = {
    id: u.id,
    role,
    openId: u.openId,
    name: u.name,
    username: u.username,
  };
}

/** Caller tRPC scadaCommands với ctx.user dựng TỪ HÀNG users hiện tại (cờ 2FA đọc từ DB mỗi lần). */
async function caller(ten: string): Promise<Caller> {
  const n = nguoi[ten];
  const [u] = await dung(
    sql`SELECT id, role, name, two_factor_enabled AS "twoFactorEnabled" FROM users WHERE id = ${n.id}`
  );
  return scadaCommandsRouter.createCaller({
    user: {
      id: Number(u.id),
      role: u.role,
      name: u.name,
      twoFactorEnabled: u.twoFactorEnabled === true,
    },
  } as never);
}
async function kySu(ten: string) {
  const n = nguoi[ten];
  const ctx = {
    user: {
      id: n.id,
      role: n.role,
      name: n.name,
      username: n.username,
      twoFactorEnabled: true,
    },
  } as never;
  return {
    adapter: (
      await import("../../routers/deviceAdapterRouter")
    ).deviceAdapterRouter.createCaller(ctx),
    diag: (
      await import("../../routers/scadaDiagRouter")
    ).scadaDiagRouter.createCaller(ctx),
    kenh: (
      await import("../../routers/scadaKenhRouter")
    ).scadaKenhRouter.createCaller(ctx),
  };
}

type Loi = {
  code?: string;
  appCode?: string;
  appParams?: Record<string, unknown>;
};
function moTa(e: unknown): Loi {
  const meta = readAppErrorMeta(e);
  return {
    code: (e as { code?: string }).code,
    appCode: meta?.appCode,
    appParams: meta?.appParams as Record<string, unknown> | undefined,
  };
}
async function loiCua(p: Promise<unknown>): Promise<Loi> {
  try {
    await p;
  } catch (e) {
    return moTa(e);
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

const LY_DO = "nghiem thu R1b-2a theo phieu";
const mauOt = (tagKey: string, value: number, at: number = Date.now()) => ({
  tagKey,
  raw: value,
  value,
  quality: "good" as const,
  timestamp: new Date(at),
});
const napCheDo = (v: number) => {
  const at = Date.now();
  boDem.napTuOt(
    { adapterId: AD.ad, machineId: A.mid },
    [mauOt("che_do", v, at)],
    at
  );
};

/** Đếm WORM theo khoá của tệp. */
async function demWorm(
  adapterId: number = AD.ad
): Promise<{ attempts: number; commandLog: number }> {
  const [a] = await dung(
    sql`SELECT count(*)::int AS n FROM scada_command_attempts WHERE user_id IN (${inIds([...userIds, -1])})`
  );
  const [c] = await dung(
    sql`SELECT count(*)::int AS n FROM command_log WHERE "adapterId" = ${adapterId}`
  );
  return { attempts: Number(a.n), commandLog: Number(c.n) };
}
async function tang(
  truoc: { attempts: number; commandLog: number },
  adapterId: number = AD.ad
) {
  const sau = await demWorm(adapterId);
  return {
    attempts: sau.attempts - truoc.attempts,
    commandLog: sau.commandLog - truoc.commandLog,
  };
}
type DongThu = {
  stage: string;
  outcome: string;
  reason_code: string | null;
  ly_do: string | null;
  adapter_id: number | null;
};
async function thuMoiNhat(userId: number, n: number): Promise<DongThu[]> {
  const r =
    (await dung(sql`SELECT stage, outcome, reason_code, ly_do, adapter_id FROM scada_command_attempts
    WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${n}`)) as DongThu[];
  return r.reverse();
}
async function lenhMoiNhat(
  adapterId: number,
  n: number
): Promise<Array<{ status: string; errorText: string | null }>> {
  const r = (await dung(
    sql`SELECT status::text AS status, "errorText" FROM command_log WHERE "adapterId" = ${adapterId} ORDER BY id DESC LIMIT ${n}`
  )) as Array<{
    status: string;
    errorText: string | null;
  }>;
  return r.reverse();
}

/** "Tool AI" gọi thẳng dispatch(): dòng chờ AI ĐÃ XÁC NHẬN, gắn đúng lệnh (băm) — khuôn R1a / R1b-1. */
const TOOL_AI = "set_machine_param";
async function lenhAi(
  commandType: string,
  writes: Array<{ tagKey: string; value: unknown }>
) {
  const owner = nguoi.engAi.id;
  const actionId = `${RUN}-ai-${uuid()}`;
  await db.insert(aiPendingActions).values({
    id: actionId,
    tool: TOOL_AI,
    argsJson: {},
    userId: owner,
    userRole: "engineer",
    summary: `${RUN} AI action`,
    previewJson: withOtPayloadHash(
      { entityType: "machine" },
      otPayloadHash({
        tool: TOOL_AI,
        adapterId: AD.ad,
        machineId: A.mid,
        commandType,
        writes,
      })
    ),
    status: "confirmed",
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return {
    adapterId: AD.ad,
    machineId: A.mid,
    commandType,
    writes,
    triggeredBy: {
      kind: "hitl" as const,
      actionId,
      tool: TOOL_AI,
      confirmedBy: owner,
      requestedBy: owner,
    },
    idempotencyKey: `${RUN}-ai-${uuid()}`,
  };
}

/** Ghim DỪNG của adapter chính (oracle: driver nhận ĐÚNG các giá trị này) — sắp theo tagKey. */
const GHIM_A = [
  { tagKey: "dung", value: 0 },
  { tagKey: "stop_cmd", value: true },
];
const loCuoi = (s: StubGhi) =>
  [...(s.ghi.at(-1) ?? [])]
    .map(w => ({ tagKey: w.tagKey, value: w.value }))
    .sort((a, b) => a.tagKey.localeCompare(b.tagKey));

const ENV: Record<string, string> = {
  SCADA_COMMANDS_ENABLED: "true",
  SCADA_LIVE_CACHE_ENABLED: "true",
  SCADA_CONG_CHE_DO_ENABLED: "false", // cổng chế độ 3c vẫn chạy cho hmi.* — không nhờ cờ
  OT_CONTROL_ENABLED: "true", // D9: CHỈ trong tiến trình test
  OT_COMMISSIONING_REQUIRED: "true",
  OT_SAFETY_PREFLIGHT_ENABLED: "true",
  SAFETY_PLC_ADAPTER_ENABLED: "true",
  OT_READBACK_ENABLED: "false", // HMI (request/confirm/dungMay) vẫn đọc lại (docLai bat_buoc)
  OT_CMD_SERIALIZE_ENABLED: "false",
  SEC_PLATFORM: "false",
  UNS_CMD_ACK_ENABLED: "false",
  AI_OT_CONTROL_ENABLED: "false", // dispatch() không đọc cờ này (cổng AI ở tầng tool); giữ OFF (D9)
  INTERLOCK_AUTO_BLOCK_ENABLED: "false",
  EDGE_RUNTIME_ENABLED: "false",
  OT_GATEWAY_ENABLED: "false",
  VISION_CONTROL_ENABLED: "true", // L2: bộ đề xuất SPI chỉ chạy khi cờ bật — CHỈ trong tiến trình
  RATE_LIMIT_REDIS: "false", // G1 / G2: store bộ nhớ (mỗi app một bộ đếm riêng)
  AUTH_CACHE_TTL_S: "0", // G2: createContext hỏi sổ phiên mỗi lần (vé thu hồi bị từ chối ngay)
};

describe.skipIf(!CHAY_NGHIEM_THU)(
  "nghiệm thu R1b-2a — L1 L2 L3 M1 G1 G2 D1 S1 K1 N1 W1 W2 B1 H1 (SCADA_R1B2A_NGHIEM_THU=1)",
  () => {
    beforeAll(async () => {
      for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
      const url = process.env.DATABASE_URL ?? "";
      expect(url).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
      seedLock = await acquireSeedExclusive(url, { waitMs: 30_000 });
      const d = await getDb();
      if (!d) throw new Error("test cần CSDL _test");
      db = d;
      const [{ ten }] = (await db.execute(
        sql`SELECT current_database() AS ten`
      )) as unknown as Array<{ ten: string }>;
      expect(ten).toMatch(/_test$/);
      await import("../ot/adapterFacade");
      await import("../safety/plc/safetyPlcAdapter");
      registerDriver("modbus", createModbusDriver); // backend modbus của safety PLC mô phỏng
      ({ scadaCommandsRouter } =
        await import("../../routers/scadaCommandsRouter"));
      disp = await import("../ot/commandDispatcher");
      boDem = await import("./boDemHienTai");

      // safety-PLC giả: coil 0 = estop (false = sạch)
      plc.port = await freePort();
      const srv = new ServerTCP(
        {
          getCoil: () => false,
          getDiscreteInput: () => false,
          getHoldingRegister: () => 0,
          getInputRegister: () => 0,
          setRegister: () => undefined,
          setCoil: () => undefined,
        },
        { host: "127.0.0.1", port: plc.port, unitID: 1 }
      );
      await new Promise<void>((resolve, reject) => {
        srv.once("initialized", () => resolve());
        srv.once("serverError", reject);
      });
      plc.close = () =>
        new Promise<void>(resolve => srv.close(() => resolve()));

      A = await seedNhaMay("a");
      B = await seedNhaMay("b");
      await dung(sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", enabled, scope, "stationId")
      VALUES (${MA_PLC}, 'R1b-2a T15 safety PLC mo phong', 'generic', 'modbus', ${`tcp://127.0.0.1:${plc.port}`},
        ${JSON.stringify({ estop: { address: "coil:1", dataType: "bool" } })}::jsonb, true, NULL, ${A.sid})`);

      // ── máy A: adapter stub chính (id NHỎ NHẤT trên máy A — L2 `adapterIdForMachine`), kênh chế độ, ghim DỪNG, tag lưới ──
      const [r] =
        await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
      VALUES (${A.mid}, ${MA_AD}, ${MA_AD}, 'stub', ${ENDPOINT}, 60000, true, 'disabled') RETURNING id`);
      AD.ad = Number(r.id);
      await dung(
        sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${AD.ad}, 'active', 1, ${RUN})`
      );
      H.fingerprints.set(
        AD.ad,
        adapterTargetFingerprint({
          protocol: "stub",
          endpoint: ENDPOINT,
          machineId: A.mid,
          connectionOptions: null,
        })
      );
      await seedTag(AD.ad, {
        key: "che_do",
        dataType: "int",
        kind: "input",
        writable: false,
        level: null,
        min: null,
        max: null,
        step: null,
      });
      await seedTag(AD.ad, {
        key: "dung",
        dataType: "int",
        level: 1,
        min: 0,
        max: 100,
        step: 1,
        stopValue: 0,
      });
      await seedTag(AD.ad, {
        key: "stop_cmd",
        dataType: "bool",
        kind: "output",
        level: 1,
        min: null,
        max: null,
        step: null,
        stopValue: true,
      });
      await seedTag(AD.ad, { key: "sp" }); // float mức 3, 0..300 bước 0.5 (W1 / W2)
      await seedTag(AD.ad, chuaKhai("sc1cu", 1)); // L1: int CHƯA khai scale 1
      await seedTag(AD.ad, chuaKhai("sc05cu", 0.5, 3)); // M1: int CHƯA khai scale 0.5, mức 3
      await seedTag(AD.ad, chuaKhai("printer_offset_x", 1)); // L2: tag đích SPI, int scale 1 chưa khai
      await seedTag(AD.ad, chuaKhai("printer_offset_y", 1));
      await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by)
      VALUES (${A.mid}, ${AD.ad}, 'che_do', '2'::jsonb, 1)`);
      boDem.datThongTinAdapter(AD.ad, {
        pollMs: 60_000,
        coDeadband: false,
        machineId: A.mid,
        code: MA_AD,
      });
      napCheDo(2);
      stub = new StubGhi();
      await stub.connect({ endpoint: ENDPOINT } as never);
      H.drivers.set(AD.ad, stub);
      AD.adX = await seedAdapter(A.mid); // adapter TẮT thứ hai trên máy A (id lớn hơn — L2 phải chọn AD.ad)

      // ── L3: adapter KHÔNG máy (luật bật không chạm máy nào của tệp) ──
      AD.adL3 = await seedAdapter(null);
      await seedTag(AD.adL3, chuaKhai("i1", 1));
      await seedTag(AD.adL3, chuaKhai("i10", 10));
      await seedTag(AD.adL3, {
        key: "f",
        dataType: "float",
        kind: null,
        level: null,
        min: null,
        max: null,
        step: null,
      });

      // ── máy phụ trong nhà máy A ──
      mayA.S = await seedMayThem(A.sid, "s");
      mayA.S2 = await seedMayThem(A.sid, "s2");
      mayA.K = await seedMayThem(A.sid, "k");
      AD.adK = await seedAdapter(mayA.K);

      await seedNguoi("opA", "operator", [A.code]);
      await seedNguoi("engAi", "engineer", [A.code]);
      await seedNguoi("engA", "engineer", [A.code]);
      await seedNguoi("b1", "operator", [A.code]);
      await seedNguoi("g2", "operator", [A.code]);
      await dung(
        sql`UPDATE users SET two_factor_enabled = true WHERE id IN (${nguoi.opA.id}, ${nguoi.engA.id})`
      );
    }, 120_000);

    afterAll(async () => {
      vi.unstubAllEnvs();
      vi.useRealTimers();
      H.ghimCho.clear();
      try {
        boDem?.xoaAdapter(AD.ad);
      } catch {
        /* bỏ qua */
      }
      try {
        await stub?.disconnect();
      } catch {
        /* bỏ qua */
      }
      try {
        await plc.close();
      } catch {
        /* bỏ qua */
      }
      if (db) {
        try {
          await dung(
            sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "%"}`
          );
          for (const id of userIds)
            await dung(
              sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id}`
            );
          for (const id of userIds)
            await dung(
              sql`DELETE FROM user_sessions WHERE "userId" = ${id}`
            ).catch(() => undefined);
          for (const id of userIds)
            await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${id}`);
          for (const id of userIds)
            await dung(
              sql`DELETE FROM totp_consumed WHERE "userId" = ${id}`
            ).catch(() => undefined);
          for (const id of userIds)
            await dung(
              sql`DELETE FROM backup_codes WHERE "userId" = ${id}`
            ).catch(() => undefined);
          await __resetSoTotpChoTest(userIds).catch(() => undefined);
          await dung(
            sql`DELETE FROM safety_plc_configs WHERE code = ${MA_PLC}`
          );
          const ids = [AD.ad, ...extraAdapterIds].filter(Boolean);
          for (const id of ids)
            await dung(
              sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${id}`
            );
          if (A?.mid)
            await dung(
              sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${A.mid}`
            );
          for (const id of ids) {
            await dung(
              sql`DELETE FROM uns_tag_mappings WHERE "adapterId" = ${id}`
            ).catch(() => undefined);
            await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
            await dung(
              sql`DELETE FROM commissioning_records WHERE "adapterId" = ${id}`
            ).catch(() => undefined);
            await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
          }
          for (const code of mayCodes)
            await dung(sql`DELETE FROM machines WHERE code = ${code}`);
          for (const code of factories) {
            await dung(
              sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`
            );
            await dung(sql`DELETE FROM machines WHERE code = ${code}`);
            await dung(sql`DELETE FROM stations WHERE code = ${code}`);
            await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
            await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
            await dung(sql`DELETE FROM factories WHERE code = ${code}`);
          }
        } catch (e) {
          console.warn(
            "[r1b2a-nt] dọn dữ liệu:",
            (e as Error).message,
            String((e as { cause?: unknown }).cause ?? "")
          );
        }
      }
      await seedLock?.release();
      seedLock = null;
    }, 120_000);

    // ═════════ L1 — dispatch AI lên tag int CHƯA khai scale 1 ═════════
    it('L1 — AI dispatch 2,5 ⇒ OFF_STEP goiY 3; "abc" ⇒ TYPE_MISMATCH; thiết bị 0 lần (command_log +1 mỗi lần); rồi 3 ⇒ driver nhận 3 (số thô 3)', async () => {
      napCheDo(2);
      let truoc = await demWorm();
      let ghi = stub.ghi.length;
      const r25 = await disp.dispatch(
        await lenhAi("set_param", [{ tagKey: "sc1cu", value: 2.5 }])
      );
      expect(r25, JSON.stringify(r25)).toMatchObject({
        ok: false,
        status: "rejected",
        reason: "OFF_STEP",
      });
      expect(r25.appError).toEqual({
        appCode: "SCADA_VALUE_OFF_STEP",
        appParams: { ma: "OFF_STEP", tagKey: "sc1cu", step: 1, goiY: 3 },
      });
      expect(stub.ghi.length - ghi).toBe(0);
      expect(await tang(truoc)).toEqual({ attempts: 0, commandLog: 1 });
      expect((await lenhMoiNhat(AD.ad, 1))[0].errorText).toMatch(
        /^OFF_STEP: Tag "sc1cu": .*\(goiY=3\)$/
      );

      truoc = await demWorm();
      ghi = stub.ghi.length;
      const rAbc = await disp.dispatch(
        await lenhAi("set_param", [{ tagKey: "sc1cu", value: "abc" }])
      );
      expect(rAbc, JSON.stringify(rAbc)).toMatchObject({
        ok: false,
        status: "rejected",
        reason: "TYPE_MISMATCH",
      });
      expect(stub.ghi.length - ghi).toBe(0);
      expect(await tang(truoc)).toEqual({ attempts: 0, commandLog: 1 });
      expect((await lenhMoiNhat(AD.ad, 1))[0].errorText).toMatch(
        /^TYPE_MISMATCH: Tag "sc1cu": giá trị không phải số hữu hạn/
      );

      ghi = stub.ghi.length;
      const r3 = await disp.dispatch(
        await lenhAi("set_param", [{ tagKey: "sc1cu", value: 3 }])
      );
      expect(r3, JSON.stringify(r3)).toMatchObject({
        ok: true,
        simulated: false,
      });
      expect(stub.ghi.length - ghi).toBe(1);
      const w = stub.ghi.at(-1)![0];
      expect(w).toMatchObject({ tagKey: "sc1cu", value: 3, dataType: "int" });
      expect(
        inverseScale(w.value, w.dataType!, w.scale ?? 1, w.offset ?? 0),
        "số THÔ driver thật sẽ ghi"
      ).toBe(3);
    });

    // ═════════ L2 — đề xuất SPI theo lưới tag int scale 1 ═════════
    it("L2 — đề xuất SPI (−7,26 / −12,6 µm) trên printer_offset_x/y int scale 1 ⇒ args NGUYÊN −7 / −13; chính args ấy qua congKenhSom ok VÀ dispatch() thật ⇒ driver nhận −7 / −13", async () => {
      const goi: Array<Record<string, unknown>> = [];
      const spiTool = {
        name: "spi_printer_offset",
        kind: "write" as const,
        requiredPermission: {
          module: "machine_control",
          action: "canEdit" as const,
        },
      };
      const deps: ProposeControlDeps = {
        propose: (async (_tool: unknown, args: Record<string, unknown>) => {
          goi.push(args);
          return {
            ok: true,
            pendingAction: { actionId: `${RUN}-spi-${goi.length}` },
          };
        }) as never,
        findTargets: async () => [
          { id: nguoi.engAi.id, role: "engineer", name: "Tech" },
        ],
        getToolByName: n =>
          n === "spi_printer_offset" ? (spiTool as never) : undefined,
        resolveFactory: async () => null,
      };
      const res = await proposeControlFromVerdict(
        {
          verdict: {
            decision: "AUTO_NG",
            confidence: 0.92,
            topLabel: "bridging",
          },
          inspectionId: 1,
          machineId: A.mid,
          spiTrend: [{ offsetXUm: 7.26, offsetYUm: 12.6 }],
          spiOpts: { gain: 1 },
        } as never,
        deps
      );
      expect(res.proposed).toBe(1);
      expect(goi).toHaveLength(1);
      expect(goi[0]).toMatchObject({ offsetXUm: -7, offsetYUm: -13 });
      expect(
        Number.isInteger(goi[0]!.offsetXUm) &&
          Number.isInteger(goi[0]!.offsetYUm),
        "args nguyên"
      ).toBe(true);
      expect(
        res.proposals.find(p => p.kind === "spi_printer_offset")!.rationale
      ).not.toContain("chưa đọc được lưới tag");

      const hang = (await dung(
        sql`SELECT * FROM device_tags WHERE "adapterId" = ${AD.ad} AND "tagKey" IN ('printer_offset_x', 'printer_offset_y')`
      )) as Array<Record<string, unknown>>;
      const drz = (await import("../../../drizzle/schema")).deviceTags;
      const { and, eq, inArray } = await import("drizzle-orm");
      const hangDrz = (await db
        .select()
        .from(drz)
        .where(
          and(
            eq(drz.adapterId, AD.ad),
            inArray(drz.tagKey, ["printer_offset_x", "printer_offset_y"])
          )
        )) as TagCongKenh[];
      expect(hang).toHaveLength(2);
      const theo = new Map(hangDrz.map(h => [h.tagKey, h]));
      const writes = [
        { tagKey: "printer_offset_x", value: goi[0]!.offsetXUm },
        { tagKey: "printer_offset_y", value: goi[0]!.offsetYUm },
      ];
      expect(
        congKenhSom(
          "spi_printer_offset",
          writes,
          writes.map(w => theo.get(w.tagKey)!)
        )
      ).toMatchObject({ ok: true });

      napCheDo(2);
      const ghi = stub.ghi.length;
      const r = await disp.dispatch(await lenhAi("spi_printer_offset", writes));
      expect(r, JSON.stringify(r)).toMatchObject({
        ok: true,
        simulated: false,
      });
      expect(stub.ghi.length - ghi).toBe(1);
      expect(loCuoi(stub)).toEqual([
        { tagKey: "printer_offset_x", value: -7 },
        { tagKey: "printer_offset_y", value: -13 },
      ]);
    });

    // ═════════ L3 — bảng giá trị lạ: JS từ chối ⊆ SQL trước triển khai ═════════
    it("L3 — bảng giá trị lạ (Task 1) trên int CHƯA khai scale 1 / 10 + float CHƯA khai: mọi luật hàm JS của cổng từ chối đều có hàng trong TRUY_VAN_TRUOC_TRIEN_KHAI (SQL chỉ báo DƯ)", async () => {
      const GIA_TRI: Array<{ nhan: string; v: unknown }> = [
        { nhan: "hex", v: "0x19" },
        { nhan: "tab", v: "\t25" },
        { nhan: "nbsp", v: "25 " },
        { nhan: "mangSo", v: [25] },
        { nhan: "mangChuoi", v: ["25"] },
        { nhan: "doiTuong", v: { v: 25 } },
        { nhan: "abc", v: "abc" },
        { nhan: "infinity", v: "Infinity" },
        { nhan: "cach", v: " 25 " },
        { nhan: "so25", v: 25 },
        { nhan: "so2p5", v: 2.5 },
        { nhan: "so30", v: 30 },
        { nhan: "chuoi30", v: "30" },
        { nhan: "null", v: null },
        { nhan: "true", v: true },
        { nhan: "rong", v: "" },
        { nhan: "trang", v: "   " },
        { nhan: "e400", v: "1e400" },
      ];
      const id: Record<string, number> = {};
      try {
        for (const tag of ["i1", "i10", "f"]) {
          for (const g of GIA_TRI) {
            const [row] =
              await dung(sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
            "commandTag", "commandValue", enabled, "createdBy")
          VALUES (${`${RUN}-l3-${tag}-${g.nhan}`}, 'machine', 'ng_rate', 'gt', 5, 'reduce_speed', ${AD.adL3}, ${tag},
            ${g.v === null ? null : sql`${JSON.stringify(g.v)}::jsonb`}, true, ${nguoi.engA.id}) RETURNING id`);
            id[`${tag}-${g.nhan}`] = Number(row.id);
          }
        }
        const js = (
          await luatLenhLechLuoi(db, like(interlockRules.name, `${RUN}-l3-%`))
        )
          .map(x => x.id)
          .sort((a, b) => a - b);
        const q = (await dung(
          sql`SELECT id::int AS id, ket_luan FROM (${sql.raw(TRUY_VAN_TRUOC_TRIEN_KHAI)}) q WHERE q.name LIKE ${`${RUN}-l3-%`} ORDER BY id`
        )) as Array<{ id: number; ket_luan: string }>;
        const coSql = new Set(q.map(x => Number(x.id)));
        const sotSql = js.filter(x => !coSql.has(x));
        console.log(
          `[r1b2a-nt] L3 JS từ chối ${js.length} luật / SQL ${coSql.size} hàng / bỏ sót ${sotSql.length}`
        );
        expect(
          sotSql,
          "JS từ chối nhưng SQL bỏ sót (phải rỗng — SQL chỉ được báo DƯ)"
        ).toEqual([]);

        // tập JS từ chối ĐÚNG như Task 1 / Task 2 đã đo (để ⊆ không đúng một cách rỗng)
        const tuChoi: Record<string, string[]> = {
          i10: [
            "hex",
            "tab",
            "nbsp",
            "mangSo",
            "mangChuoi",
            "doiTuong",
            "abc",
            "infinity",
            "cach",
            "so25",
            "so2p5",
            "null",
            "true",
            "rong",
            "trang",
            "e400",
          ],
          i1: [
            "mangSo",
            "mangChuoi",
            "doiTuong",
            "abc",
            "infinity",
            "so2p5",
            "rong",
            "trang",
            "e400",
          ],
          f: [
            "mangSo",
            "mangChuoi",
            "doiTuong",
            "abc",
            "infinity",
            "rong",
            "trang",
            "e400",
          ],
        };
        const mong = Object.entries(tuChoi)
          .flatMap(([tag, ds]) => ds.map(n => id[`${tag}-${n}`]))
          .sort((a, b) => a - b);
        expect(js).toEqual(mong);
        for (const tag of ["i1", "i10"])
          for (const n of ["so30", "chuoi30"])
            expect(
              coSql.has(id[`${tag}-${n}`]),
              `${tag}-${n}: không ai báo`
            ).toBe(false);
        expect(q.find(x => Number(x.id) === id["i1-so2p5"])?.ket_luan).toBe(
          "LECH_LUOI"
        );
        expect(q.find(x => Number(x.id) === id["f-abc"])?.ket_luan).toBe(
          "KHONG_PARSE_DUOC"
        );
      } finally {
        // luật BẬT của ô này không được ở lại cho các ô gửi lệnh sau
        await dung(
          sql`DELETE FROM interlock_rules WHERE name LIKE ${`${RUN}-l3-%`}`
        );
      }
    });

    // ═════════ M1 — HMI request 2,5 trên int scale 0,5 ═════════
    it("M1 — HMI request 2,5 trên int CHƯA khai scale 0,5 ⇒ NHẬN (dòng chờ mang số 2,5); confirm ⇒ acked_verified, driver nhận 2,5 ⇒ số thô 5", async () => {
      napCheDo(2);
      const c = await caller("opA");
      const kq = await c.request({
        adapterId: AD.ad,
        tagKey: "sc05cu",
        value: "2.5",
        lyDo: LY_DO,
        clientRequestId: uuid(),
      });
      expect(kq.requestId).toEqual(expect.any(String));
      expect(kq.preview).toMatchObject({ requested: 2.5 });
      const ghi = stub.ghi.length;
      expect(await c.confirm({ requestId: kq.requestId })).toMatchObject({
        status: "acked_verified",
        ok: true,
      });
      expect(stub.ghi.length - ghi).toBe(1);
      const w = stub.ghi.at(-1)![0];
      expect(w).toMatchObject({
        tagKey: "sc05cu",
        value: 2.5,
        dataType: "int",
        scale: 0.5,
      });
      expect(
        inverseScale(w.value, w.dataType!, w.scale ?? 1, w.offset ?? 0),
        "số THÔ driver thật sẽ ghi"
      ).toBe(5);
    });

    // ═════════ G1 / G2 — bộ giới hạn STOP HMI (express + limiter THẬT, thứ tự index.ts) ═════════
    describe("G1 / G2 — bộ giới hạn STOP HMI", () => {
      const STOP = "/api/trpc/scadaCommands.dungMay";
      async function appBaLimiter(): Promise<{ server: Server; base: string }> {
        const rl = await import("../../_core/rateLimitConfig");
        const app = express();
        app.use("/api/", rl.createHmiStopLimiter());
        app.use("/api/", rl.createApiLimiter());
        app.use("/api/", rl.createUnverifiedCredentialIpLimiter());
        app.post(
          "/api/trpc/*",
          (_req, res) => void res.status(200).json({ ok: true })
        );
        let server!: Server;
        await new Promise<void>(r => {
          server = app.listen(0, "127.0.0.1", () => r());
        });
        return {
          server,
          base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        };
      }
      const dong = (s: Server) => new Promise<void>(r => s.close(() => r()));
      async function guiNLan(
        base: string,
        cookie: string,
        n: number
      ): Promise<Array<{ status: number; body: string }>> {
        const ra: Array<{ status: number; body: string }> = [];
        for (let i = 0; i < n; i += 50) {
          const lo = Array.from({ length: Math.min(50, n - i) }, () =>
            fetch(`${base}${STOP}`, {
              method: "POST",
              headers: { "content-type": "application/json", cookie },
              body: "{}",
            }).then(async r => ({
              status: r.status,
              body: await r.text(),
            }))
          );
          ra.push(...(await Promise.all(lo)));
        }
        return ra;
      }

      it("G1 — 200 POST dungMay với cookie RÁC qua cả ba tầng giới hạn ⇒ 0 dòng '[Auth]' / 'Session verification' từ đường giới hạn; đối chứng: verifySession mặc định in đúng 1 dòng", async () => {
        const { sdk } = await import("../../_core/sdk");
        const { server, base } = await appBaLimiter();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const dongAuth = () =>
          [...warn.mock.calls, ...err.mock.calls].filter(c =>
            /^\[Auth\]|Session verification/.test(String(c[0]))
          ).length;
        try {
          let ok = 0;
          for (let i = 0; i < 200; i += 50) {
            const lo = await Promise.all(
              Array.from({ length: 50 }, (_, j) =>
                fetch(`${base}${STOP}`, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    cookie: `${COOKIE_NAME}=rac-r1b2a-${i + j}`,
                  },
                  body: "{}",
                }).then(r => r.status)
              )
            );
            ok += lo.length;
          }
          expect(ok).toBe(200);
          const soDong = dongAuth();
          console.log(
            `[r1b2a-nt] G1 200 STOP cookie rác ⇒ ${soDong} dòng [Auth] từ đường giới hạn`
          );
          expect(soDong).toBe(0);
          await sdk.verifySession("rac-doi-chung-g1").catch(() => null);
          expect(
            dongAuth(),
            "đối chứng: spy NHÌN THẤY dòng [Auth] của đường xác thực thật"
          ).toBe(1);
        } finally {
          warn.mockRestore();
          err.mockRestore();
          await dong(server);
        }
      }, 60_000);

      it("G2 — một người: phiên hợp lệ 600 STOP/phút đều 200, lượt 601 ⇒ 429 'use the hard E-STOP'; vé THU HỒI (createContext từ chối) bị trần 600 trong bucket riêng (không vô hạn); phiên mới của cùng người vẫn 200", async () => {
        const { sdk } = await import("../../_core/sdk");
        const { createContext } = await import("../../_core/context");
        const { TRAN_STOP_HMI_MOI_PHUT } =
          await import("../../_core/rateLimitConfig");
        expect(TRAN_STOP_HMI_MOI_PHUT).toBe(600);
        const n = nguoi.g2;
        const veMoi = async () => {
          const t = await sdk.signSession(
            { openId: n.openId, appId: "r1b2a-t15", name: "r1b2a t15" },
            { expiresInMs: 3_600_000 }
          );
          await dung(
            sql`INSERT INTO user_sessions ("userId", "sessionToken", "expiresAt", "isActive") VALUES (${n.id}, ${t}, now() + interval '1 hour', true)`
          );
          return { t, cookie: `${COOKIE_NAME}=${encodeURIComponent(t)}` };
        };
        const ctxCua = (cookie: string) =>
          createContext({
            req: { headers: { cookie } } as never,
            res: {} as never,
          });
        const { server, base } = await appBaLimiter();
        try {
          // (a) phiên hợp lệ của MỘT người: 600 ⇒ 200, 601 ⇒ 429
          const p1 = await veMoi();
          expect(
            (await ctxCua(p1.cookie)).user?.openId,
            "bố trí: phiên xác thực được"
          ).toBe(n.openId);
          const s1 = await guiNLan(base, p1.cookie, TRAN_STOP_HMI_MOI_PHUT);
          expect(
            s1.filter(x => x.status === 429),
            "dưới 600/phút không bao giờ 429"
          ).toHaveLength(0);
          const r601 = (await guiNLan(base, p1.cookie, 1))[0];
          expect(r601.status).toBe(429);
          expect(JSON.parse(r601.body)).toEqual({
            error: "Too many STOP requests — use the hard E-STOP",
          });

          // (b) vé THU HỒI (hàng isActive=false, chữ ký + hạn còn): createContext từ chối, giới hạn vẫn đếm ⇒ trần 600, không vô hạn
          const p2 = await veMoi();
          expect((await ctxCua(p2.cookie)).user?.openId).toBe(n.openId);
          await dung(
            sql`UPDATE user_sessions SET "isActive" = false WHERE "sessionToken" = ${p2.t}`
          );
          expect(
            (await ctxCua(p2.cookie)).user,
            "vé phải THẬT SỰ bị thu hồi"
          ).toBeNull();
          const s2 = await guiNLan(base, p2.cookie, TRAN_STOP_HMI_MOI_PHUT);
          expect(s2.filter(x => x.status === 429)).toHaveLength(0);
          const r2 = (await guiNLan(base, p2.cookie, 1))[0];
          expect(r2.status, "vé thu hồi không còn STOP vô hạn").toBe(429);

          // (c) phiên MỚI của cùng người: bucket riêng ⇒ 200 (vé bị đánh cắp / thu hồi không chặn được người thật)
          const p3 = await veMoi();
          expect((await guiNLan(base, p3.cookie, 1))[0].status).toBe(200);
        } finally {
          await dong(server);
        }
      }, 120_000);
    });

    // ═════════ D1 — DB chậm-mà-sống: loadStopPinsHmi chậm 3 s ═════════
    it("D1 — loadStopPinsHmi chậm 3 s ⇒ SCADA_STOP_PRECHECK_TIMEOUT {STOP_QUA_HAN, truoc_gui} trong < 2,4 s, dispatch 0 lần, thiết bị 0; đúng 1 dòng attempts STOP_QUA_HAN (adapter NULL, 'E-STOP cứng')", async () => {
      expect(HAN_TRUOC_GUI_STOP_HMI_MS).toBe(2000);
      napCheDo(2);
      const truoc = await demWorm();
      const ghi = stub.ghi.length;
      const d0 = H.dispatchCalls;
      H.ghimCho.set(AD.ad, 3000);
      const c = await caller("opA");
      const t0 = Date.now();
      let troi = 0;
      try {
        const loi = await loiCua(
          c.dungMay({ machineId: A.mid, clientRequestId: uuid() })
        );
        troi = Date.now() - t0;
        console.log(`[r1b2a-nt] D1 từ chối sau ${troi} ms`);
        expect(loi).toMatchObject({
          code: "SERVICE_UNAVAILABLE",
          appCode: "SCADA_STOP_PRECHECK_TIMEOUT",
          appParams: { ma: MA_STOP_QUA_HAN, pha: "truoc_gui" },
        });
        expect(troi).toBeGreaterThanOrEqual(HAN_TRUOC_GUI_STOP_HMI_MS - 50);
        expect(troi).toBeLessThan(2400);
        expect(H.dispatchCalls - d0, "dispatch() không được gọi").toBe(0);
        expect(stub.ghi.length - ghi).toBe(0);
        await vi.waitFor(
          async () => {
            if ((await tang(truoc)).attempts < 1)
              throw new Error(
                "attempts STOP_QUA_HAN chưa ghi (fire-and-forget)"
              );
          },
          { timeout: 5_000, interval: 50 }
        );
        expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 0 });
        const [t] = await thuMoiNhat(nguoi.opA.id, 1);
        expect(t).toMatchObject({
          stage: "dispatch",
          outcome: "rejected",
          reason_code: MA_STOP_QUA_HAN,
          adapter_id: null,
        });
        expect(t.ly_do).toContain("E-STOP cứng");
      } finally {
        H.ghimCho.delete(AD.ad);
        await cho(1_500); // lượt đọc ghim bị bỏ rơi chạy nốt (postgres.js không huỷ được) trước ô kế
      }
      expect(stub.ghi.length - ghi, "lượt bỏ rơi không bao giờ gửi").toBe(0);
    }, 30_000);

    // ═════════ S1 — đổi máy đồng thời giữa kiểm-trước và khoá ═════════
    describe("S1 — phạm vi kiểm LẠI dưới khoá adapter (kỹ sư nhà máy A; adapter sang nhà máy B commit giữa kiểm-trước và khoá)", () => {
      async function soBiChanBoi(pid: number): Promise<number> {
        const [r] = await dung(
          sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        );
        return Number(r.n);
      }
      async function doiMayGiuaKiemVaKhoa<T>(
        adapterId: number,
        mayMoi: number,
        goi: () => Promise<T>,
        khoaTag?: number
      ): Promise<{ kq?: T; loi: unknown }> {
        let moKhoa!: () => void;
        const choMo = new Promise<void>(r => (moKhoa = r));
        let daKhoa!: (pid: number) => void;
        const choKhoa = new Promise<number>(r => (daKhoa = r));
        const giu = db.transaction(async tx => {
          const [p] = (await tx.execute(
            sql`SELECT pg_backend_pid() AS pid`
          )) as unknown as Array<{ pid: number }>;
          await tx.execute(
            sql`SELECT id FROM device_adapters WHERE id = ${adapterId} FOR UPDATE`
          );
          if (khoaTag !== undefined)
            await tx.execute(
              sql`SELECT id FROM device_tags WHERE id = ${khoaTag} FOR UPDATE`
            );
          daKhoa(Number(p.pid));
          await choMo;
          await tx.execute(
            sql`UPDATE device_adapters SET "machineId" = ${mayMoi} WHERE id = ${adapterId}`
          );
        });
        const pidGiu = await choKhoa;
        const p = goi().then(
          kq => ({ kq, loi: null as unknown }),
          loi => ({ loi })
        );
        try {
          await vi.waitFor(
            async () => {
              expect(
                await soBiChanBoi(pidGiu),
                "thủ tục phải BỊ CHẶN ở lượt khoá (đã qua kiểm-trước)"
              ).toBeGreaterThan(0);
            },
            { timeout: 10_000, interval: 20 }
          );
        } finally {
          moKhoa();
          await giu;
        }
        return p;
      }
      const soAuditCua = async (actorId: number) =>
        Number(
          (
            await dung(
              sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "actorId" = ${actorId}`
            )
          )[0].n
        );
      const hangAdapter = async (id: number) =>
        (
          await dung(
            sql`SELECT name, "machineId", "isEnabled" FROM device_adapters WHERE id = ${id}`
          )
        )[0];
      const hangTag = async (id: number) =>
        (
          await dung(
            sql`SELECT "adapterId", address, actuation_level AS muc, stop_value FROM device_tags WHERE id = ${id}`
          )
        )[0];
      const tagGhi = async (adapterId: number, key: string) => {
        const [t] =
          await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", actuation_level)
        VALUES (${adapterId}, ${key}, ${"addr-" + key}, 'int', true, true, 5) RETURNING id`);
        return Number(t.id);
      };

      it("S1 — 8 thủ tục (deviceAdapter.update / delete / tags.create / tags.update / tags.delete / tags.setStopPin, scadaDiag.tamTat, scadaKenh.khaiHangLoat) ⇒ mỗi thủ tục ĐÚNG NOT_FOUND của nó, 0 hàng đổi, 0 audit; đối chứng dương: máy khác CÙNG nhà máy A ⇒ thành công", async () => {
        const k = await kySu("engA");
        const actor = nguoi.engA.id;
        const audit0 = await soAuditCua(actor);
        const ketQua: string[] = [];
        const cases: Array<{
          ten: string;
          entity: "adapter" | "deviceTag";
          dung: () => Promise<{
            adapterId: number;
            goi: () => Promise<unknown>;
            khoaTag?: number;
            kiem: () => Promise<void>;
          }>;
        }> = [
          {
            ten: "deviceAdapter.update",
            entity: "adapter",
            dung: async () => {
              const a = await seedAdapter(mayA.S);
              const ten0 = (await hangAdapter(a)).name;
              return {
                adapterId: a,
                goi: () =>
                  k.adapter.update({ id: a, name: "ten-moi-ngoai-pham-vi" }),
                kiem: async () =>
                  expect((await hangAdapter(a)).name).toBe(ten0),
              };
            },
          },
          {
            ten: "deviceAdapter.delete",
            entity: "adapter",
            dung: async () => {
              const a = await seedAdapter(mayA.S);
              return {
                adapterId: a,
                goi: () => k.adapter.delete({ id: a }),
                kiem: async () => expect(await hangAdapter(a)).toBeTruthy(),
              };
            },
          },
          {
            ten: "deviceAdapter.tags.create",
            entity: "adapter",
            dung: async () => {
              const a = await seedAdapter(mayA.S);
              return {
                adapterId: a,
                goi: () =>
                  k.adapter.tags.create({
                    adapterId: a,
                    tagKey: "t-moi",
                    address: "40001",
                    dataType: "float",
                  } as never),
                kiem: async () =>
                  expect(
                    Number(
                      (
                        await dung(
                          sql`SELECT count(*)::int AS n FROM device_tags WHERE "adapterId" = ${a}`
                        )
                      )[0].n
                    )
                  ).toBe(0),
              };
            },
          },
          {
            ten: "deviceAdapter.tags.update",
            entity: "deviceTag",
            dung: async () => {
              const a = await seedAdapter(mayA.S);
              const t = await tagGhi(a, "t-upd");
              return {
                adapterId: a,
                goi: () => k.adapter.tags.update({ id: t, address: "40999" }),
                kiem: async () =>
                  expect((await hangTag(t)).address).toBe("addr-t-upd"),
              };
            },
          },
          {
            ten: "deviceAdapter.tags.delete",
            entity: "deviceTag",
            dung: async () => {
              const a = await seedAdapter(mayA.S);
              const t = await tagGhi(a, "t-xoa");
              return {
                adapterId: a,
                goi: () => k.adapter.tags.delete({ id: t }),
                kiem: async () => expect(await hangTag(t)).toBeTruthy(),
              };
            },
          },
          {
            ten: "deviceAdapter.tags.setStopPin",
            entity: "adapter",
            dung: async () => {
              const a = await seedAdapter(mayA.S);
              const t = await tagGhi(a, "t-ghim");
              return {
                adapterId: a,
                khoaTag: t,
                goi: () =>
                  k.adapter.tags.setStopPin({
                    adapterId: a,
                    tagKey: "t-ghim",
                    stopValue: 0,
                    reason: "ghim dung kiem pham vi",
                  } as never),
                kiem: async () =>
                  expect((await hangTag(t)).stop_value).toBeNull(),
              };
            },
          },
          {
            ten: "scadaDiag.tamTat",
            entity: "adapter",
            dung: async () => {
              const a = await seedAdapter(mayA.S, { isEnabled: true });
              await tagGhi(a, "t-tt");
              return {
                adapterId: a,
                goi: () =>
                  k.diag.tamTat({ adapterId: a, lyDo: "tam tat kiem pham vi" }),
                kiem: async () =>
                  expect((await hangAdapter(a)).isEnabled).toBe(true),
              };
            },
          },
          {
            ten: "scadaKenh.khaiHangLoat",
            entity: "adapter",
            dung: async () => {
              const a = await seedAdapter(mayA.S);
              const t = await tagGhi(a, "t-khl");
              return {
                adapterId: a,
                goi: () =>
                  k.kenh.khaiHangLoat({
                    adapterId: a,
                    items: [{ tagId: t, patch: { actuationLevel: 3 } }],
                    lyDo: "khai muc kiem pham vi",
                    totpCode: "000000",
                  } as never),
                kiem: async () => expect((await hangTag(t)).muc).toBe(5),
              };
            },
          },
        ];
        for (const c of cases) {
          const x = await c.dung();
          const r = await doiMayGiuaKiemVaKhoa(
            x.adapterId,
            B.mid,
            x.goi,
            x.khoaTag
          );
          const m = r.loi ? moTa(r.loi) : null;
          ketQua.push(
            `${c.ten}: ${m ? `${m.code}/${m.appCode}/${String(m.appParams?.entity)}` : "THÀNH CÔNG (sai)"}`
          );
          expect(m, c.ten).toMatchObject({
            code: "NOT_FOUND",
            appCode: "ENTITY_NOT_FOUND",
            appParams: { entity: c.entity },
          });
          expect(
            (await hangAdapter(x.adapterId)).machineId,
            `${c.ten}: người đổi máy đã commit`
          ).toBe(B.mid);
          await x.kiem();
        }
        console.log(`[r1b2a-nt] S1 ${JSON.stringify(ketQua)}`);
        expect(await soAuditCua(actor), "không audit nào của người gọi").toBe(
          audit0
        );

        // đối chứng DƯƠNG: đổi sang máy KHÁC CÙNG nhà máy A ⇒ bộ dựng không tự sinh NOT_FOUND
        const a = await seedAdapter(mayA.S);
        const r = await doiMayGiuaKiemVaKhoa(a, mayA.S2, () =>
          k.adapter.update({ id: a, name: "ten-moi-trong-pham-vi" })
        );
        expect(r.loi ? moTa(r.loi) : null).toBeNull();
        expect(await hangAdapter(a)).toMatchObject({
          name: "ten-moi-trong-pham-vi",
          machineId: mayA.S2,
        });
      }, 180_000);
    });

    // ═════════ K1 — khai mức hàng loạt ═════════
    describe("K1 / N1 — khai mức hàng loạt (TOTP thật) + cột nhịp tag được bảo vệ", () => {
      let T: number[] = [];
      let secret = "";
      const ma = () => speakeasy.totp({ secret, encoding: "base32" });
      const mucCua = async (ids: number[]) =>
        (
          (await dung(
            sql`SELECT id, actuation_level AS m FROM device_tags WHERE id IN (${inIds(ids)}) ORDER BY id`
          )) as Array<{ m: number | null }>
        ).map(r => (r.m === null ? null : Number(r.m)));
      const auditTheoLyDo = async (lyDo: string) =>
        (await dung(
          sql`SELECT action, "entityId", "afterJson" FROM control_audit_log WHERE reason = ${lyDo} ORDER BY id`
        )) as Array<{
          action: string;
          entityId: string;
          afterJson: any;
        }>;

      beforeAll(async () => {
        const rows =
          await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", actuation_level)
        SELECT ${AD.adK}, 't' || lpad(g::text, 3, '0'), 'addr-t' || g::text, 'int', true, true, 5 FROM generate_series(0, 199) g RETURNING id`);
        T = rows.map(r => Number(r.id)).sort((x, y) => x - y);
        secret = speakeasy.generateSecret({ length: 20 }).base32;
        await setup2FA(nguoi.engA.id, secret);
        await enable2FA(nguoi.engA.id);
        await dung(
          sql`DELETE FROM totp_khoa_sai WHERE user_id = ${nguoi.engA.id}`
        );
      }, 60_000);

      it("K1 — lô 200 có 1 tag hỏng (#137 ghim 0, patch writeMin 5) ⇒ STOP_PIN_NGOAI_DAI {tagId #137}, 0 đổi, 0 audit, mã KHÔNG tiêu; CÙNG mã cho lô 200 hợp lệ ⇒ 200 đổi + 201 audit; nâng mức tag ghim mức 1 ⇒ STOP_PIN_GO_TRUOC", async () => {
        const k = await kySu("engA");
        const m = ma();
        await dung(
          sql`UPDATE device_tags SET stop_value = '0'::jsonb, stop_pinned_by = 'test', stop_pinned_at = now() WHERE id = ${T[137]}`
        );
        const ldHong = `${RUN} K1 hong`;
        const e1 = await loiCua(
          k.kenh.khaiHangLoat({
            adapterId: AD.adK,
            items: T.map(tagId => ({
              tagId,
              patch:
                tagId === T[137]
                  ? { writeMin: 5 }
                  : { actuationLevel: 3 as const },
            })),
            lyDo: ldHong,
            totpCode: m,
          })
        );
        expect(e1).toMatchObject({
          code: "BAD_REQUEST",
          appCode: "STOP_PIN_NGOAI_DAI",
        });
        expect(e1.appParams).toMatchObject({
          tagId: T[137],
          lyDo: "OUT_OF_RANGE",
        });
        expect(
          (await mucCua(T)).every(v => v === 5),
          "0 hàng đổi"
        ).toBe(true);
        expect(await auditTheoLyDo(ldHong)).toHaveLength(0);

        const ld = `${RUN} K1 200`;
        const t0 = Date.now();
        const kq = await k.kenh.khaiHangLoat({
          adapterId: AD.adK,
          items: T.map(tagId => ({ tagId, patch: { actuationLevel: 3 } })),
          lyDo: ld,
          totpCode: m,
        });
        console.log(`[r1b2a-nt] K1 lô 200 tag: ${Date.now() - t0} ms`);
        expect(
          kq.soDoi,
          "CÙNG mã dùng được ⇒ lô bị từ chối trước đó KHÔNG tiêu mã"
        ).toBe(200);
        expect(kq.ketQua.map(r => r.tagId)).toEqual(T);
        expect((await mucCua(T)).every(v => v === 3)).toBe(true);
        const au = await auditTheoLyDo(ld);
        expect(au).toHaveLength(201);
        expect(au.filter(r => r.action === "scada_kenh_cap_nhat")).toHaveLength(
          200
        );
        expect(
          au
            .filter(r => r.action === "scada_kenh_khai_hang_loat")
            .map(r => r.afterJson)
        ).toEqual([{ loId: kq.loId, soTag: 200, tagIds: T }]);

        // tag đang ghim DỪNG ở mức 1 bị nâng lên 3 ⇒ sẽ rơi khỏi STOP HMI ⇒ "gỡ ghim trước" (kiểm TRƯỚC mã)
        await dung(
          sql`UPDATE device_tags SET actuation_level = 1, stop_value = '0'::jsonb, stop_pinned_by = 'test', stop_pinned_at = now() WHERE id = ${T[0]}`
        );
        const e3 = await loiCua(
          k.kenh.khaiHangLoat({
            adapterId: AD.adK,
            items: [{ tagId: T[0], patch: { actuationLevel: 3 } }],
            lyDo: `${RUN} K1 ghim`,
            totpCode: m,
          })
        );
        expect(e3).toMatchObject({ appCode: "STOP_PIN_GO_TRUOC" });
        expect(e3.appParams?.tagId).toBe(T[0]);
        expect((await mucCua([T[0]]))[0]).toBe(1);
      }, 120_000);

      it("N1 — đổi samplingMs của tag ĐÃ khai không mã ⇒ SCADA_CONFIG_TOTP_REQUIRED (TOTP_CAN), hàng nguyên", async () => {
        const k = await kySu("engA");
        const id = T[1];
        await dung(
          sql`UPDATE device_tags SET actuation_level = 3, "samplingMs" = NULL WHERE id = ${id}`
        );
        const e = await loiCua(
          k.adapter.tags.update({ id, samplingMs: 500 } as never)
        );
        expect(e).toMatchObject({
          code: "PRECONDITION_FAILED",
          appCode: "SCADA_CONFIG_TOTP_REQUIRED",
          appParams: { ma: "TOTP_CAN" },
        });
        const [h] = await dung(
          sql`SELECT "samplingMs" AS s FROM device_tags WHERE id = ${id}`
        );
        expect(h.s).toBeNull();
      });
    });

    // ═════════ W1 — thiếu 0433 ═════════
    it("W1 — trạng thái thiếu 0433: request ⇒ SCADA_SCHEMA_MISSING {THIEU_MIGRATION, 0433}, 0 dòng attempts; dungMay ⇒ VẪN gửi (acked_verified, driver nhận ghim)", async () => {
      const { __datTrangThaiSchemaR1a, trangThaiSchemaR1a } =
        await import("../../_core/kiemSchemaR1a");
      const goc = trangThaiSchemaR1a();
      napCheDo(2);
      __datTrangThaiSchemaR1a({
        kieu: "da_kiem",
        luc: new Date().toISOString(),
        thieu0431: [],
        thieu0432: [],
        thieu0433: ["scada_command_attempts.ly_do"],
        thieu0434: [],
        thieu0433Fk: [],
      });
      try {
        const c = await caller("opA");
        const truoc = await demWorm();
        const loi = await loiCua(
          c.request({
            adapterId: AD.ad,
            tagKey: "sp",
            value: 100,
            lyDo: LY_DO,
            clientRequestId: uuid(),
          })
        );
        expect(loi).toMatchObject({
          code: "PRECONDITION_FAILED",
          appCode: "SCADA_SCHEMA_MISSING",
          appParams: { ma: "THIEU_MIGRATION", migration: "0433" },
        });
        expect(await tang(truoc)).toEqual({ attempts: 0, commandLog: 0 });
        const ghi = stub.ghi.length;
        const kq = await c.dungMay({
          machineId: A.mid,
          clientRequestId: uuid(),
        });
        expect(kq.ketQua[0]).toMatchObject({
          adapterId: AD.ad,
          status: "acked_verified",
          ok: true,
          simulated: false,
        });
        expect(stub.ghi.length - ghi).toBe(1);
        expect(loCuoi(stub)).toEqual(GHIM_A);
      } finally {
        __datTrangThaiSchemaR1a(goc);
      }
    });

    // ═════════ W2 — 100 DA_XU_LY rồi im 61 s ═════════
    it("W2 — 100 confirm DA_XU_LY rồi IM (không lần gọi kế) ⇒ 30 dòng; sau 61 s hẹn giờ xả ghi ĐÚNG MỘT DIEU_TIET '70 lần DA_XU_LY bị gộp' (stage confirm); không tổng kết thứ hai", async () => {
      const dt = await import("./dieuTietThuLenh");
      dt.__datLaiDieuTiet();
      napCheDo(2);
      const c = await caller("opA");
      const { requestId } = await c.request({
        adapterId: AD.ad,
        tagKey: "sp",
        value: 245,
        lyDo: LY_DO,
        clientRequestId: uuid(),
      });
      expect(await c.confirm({ requestId })).toMatchObject({
        status: "acked_verified",
        ok: true,
      });
      dt.__datLaiDieuTiet();
      const truoc = await demWorm();
      // đồng hồ giả CHỈ cho Date + setInterval (hẹn giờ xả tạo ở lần gộp đầu); setTimeout thật cho CSDL
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      try {
        for (let i = 0; i < 100; i++) {
          const loi = await loiCua(c.confirm({ requestId }));
          expect(loi).toMatchObject({
            code: "CONFLICT",
            appCode: "SCADA_REQUEST_ALREADY_HANDLED",
          });
        }
        expect(await tang(truoc)).toEqual({ attempts: 30, commandLog: 0 });
        expect(dt.__henXaDangChay()).toBe(true);
        await vi.advanceTimersByTimeAsync(61_000);
        let n = (await tang(truoc)).attempts;
        for (let i = 0; i < 100 && n < 31; i++) {
          await new Promise(r => setTimeout(r, 50));
          n = (await tang(truoc)).attempts;
        }
        expect(n).toBe(31);
        expect(
          (await thuMoiNhat(nguoi.opA.id, 1)).map(d => [
            d.stage,
            d.outcome,
            d.reason_code,
            d.ly_do,
          ])
        ).toEqual([
          ["confirm", "rejected", "DIEU_TIET", "70 lần DA_XU_LY bị gộp"],
        ]);
        expect(dt.__henXaDangChay(), "hẹn giờ tự dừng").toBe(false);
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        await new Promise(r => setTimeout(r, 200));
        expect((await tang(truoc)).attempts, "không tổng kết thứ hai").toBe(31);
      } finally {
        vi.useRealTimers();
        dt.__datLaiDieuTiet();
      }
    }, 120_000);

    // ═════════ B1 — 10 lượt song song mã dự phòng đúng (đường đầy đủ) ═════════
    it("B1 — 10 lượt SONG SONG verifyBackupCode ĐẦY ĐỦ cùng mã đúng ⇒ 1 true, 9 false, 0 ném, 0 khoá; đúng 1 mã bị tiêu; mã khác dùng được ngay", async () => {
      expect(
        resolvePoolMax(),
        "pool > 1 — không thì song song là xếp hàng giả"
      ).toBeGreaterThanOrEqual(2);
      const uid = nguoi.b1.id;
      await __resetSoTotpChoTest([uid]);
      await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${uid}`);
      const bo = await quayVongMaDuPhong(uid);
      const kq = await Promise.allSettled(
        Array.from({ length: 10 }, () => verifyBackupCode(uid, bo[3]!))
      );
      const tomTat = JSON.stringify(
        kq.map(r =>
          r.status === "fulfilled"
            ? r.value
            : String(
                (r.reason as { cause?: { appCode?: string } })?.cause
                  ?.appCode ?? r.reason
              )
        )
      );
      console.log(`[r1b2a-nt] B1 verifyBackupCode ×10: ${tomTat}`);
      expect(
        kq.filter(r => r.status === "fulfilled" && r.value === true),
        tomTat
      ).toHaveLength(1);
      expect(
        kq.filter(r => r.status === "fulfilled" && r.value === false),
        tomTat
      ).toHaveLength(9);
      expect(
        kq.filter(r => r.status === "rejected"),
        tomTat
      ).toHaveLength(0);
      expect((await docKhoa(uid, "backup")).conLaiMs, "không khoá").toBe(0);
      expect(
        Number(
          (
            await dung(
              sql`SELECT count(*)::int AS n FROM backup_codes WHERE "userId" = ${uid} AND "isUsed" = true`
            )
          )[0].n
        )
      ).toBe(1);
      expect(
        await verifyBackupCode(uid, bo[0]!),
        "mã khác của bộ dùng được ngay"
      ).toBe(true);
    }, 60_000);

    // ═════════ H1 — /health đang kiểm + thiếu một FK của 0433 ═════════
    it("H1 — /health trước lần kiểm đầu ⇒ schemaR1a 'dang_kiem' (không degraded); kiemSchemaR1a THẬT thiếu 1 FK 0433 ⇒ 'thieu', thieuMigration có '0433', degraded; đủ ⇒ không có khoá", async () => {
      const ks = await import("../../_core/kiemSchemaR1a");
      const hp = await import("../../_core/healthProbes");
      const goc = ks.trangThaiSchemaR1a();
      const app = express();
      app.get(
        "/health",
        hp.createHealthHandler({
          pinger: hp.createDbPinger({ getDb: () => db, timeoutMs: 10_000 }),
        })
      );
      let server!: Server;
      await new Promise<void>(r => {
        server = app.listen(0, "127.0.0.1", () => r());
      });
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const health = async () => {
        const res = await fetch(`${base}/health`);
        expect(res.status, "liveness luôn 200").toBe(200);
        return (await res.json()) as {
          status: string;
          db: string;
          schemaR1a?: {
            ok: boolean;
            trangThai: string;
            thieuMigration: string[] | null;
            lyDo: string;
          };
        };
      };
      const chay = async (q: SQL) =>
        (await db.execute(q)) as unknown as Array<Record<string, unknown>>;
      try {
        ks.__datTrangThaiSchemaR1a({ kieu: "chua_kiem" });
        const h0 = await health();
        expect(h0.schemaR1a).toEqual({
          ok: false,
          trangThai: "dang_kiem",
          thieuMigration: null,
          lyDo: "chua_xong",
        });
        expect(h0.db).toBe("connected");
        expect(h0.status, "đang kiểm ≠ thiếu ⇒ không degraded").toBe("ok");

        const thieuFk = await ks.kiemSchemaR1a(async q =>
          (await chay(q)).filter(
            r => r.conname !== "scada_khoa_chon_adapter_fk"
          )
        );
        expect(thieuFk).toEqual({
          thieu0431: [],
          thieu0432: [],
          thieu0433: [],
          thieu0434: [],
          thieu0433Fk: ["scada_khoa_chon_adapter_fk"],
        });
        ks.__datTrangThaiSchemaR1a({
          kieu: "da_kiem",
          luc: new Date().toISOString(),
          ...thieuFk,
        });
        const h1 = await health();
        expect(h1.schemaR1a?.trangThai).toBe("thieu");
        expect(h1.schemaR1a?.thieuMigration).toEqual(["0433"]);
        expect(h1.schemaR1a?.lyDo).toContain("scada_khoa_chon_adapter_fk");
        expect(h1.status).toBe("degraded");

        const du = await ks.kiemSchemaR1a(chay);
        ks.__datTrangThaiSchemaR1a({
          kieu: "da_kiem",
          luc: new Date().toISOString(),
          ...du,
        });
        const h2 = await health();
        expect(h2.schemaR1a, "đã kiểm và đủ ⇒ VẮNG khoá").toBeUndefined();
      } finally {
        ks.__datTrangThaiSchemaR1a(goc);
        await new Promise<void>(r => server.close(() => r()));
      }
    });
  }
);
