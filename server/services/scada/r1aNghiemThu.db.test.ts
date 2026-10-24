/**
 * SCADA R1a Task 15 — NGHIỆM THU R1a "Điều khiển lõi": ma trận 8 ô (+ đọc lại lệch) trên CSDL `_test` THẬT.
 *
 * Đường chạy thật: `scadaCommands.request/confirm` (tRPC caller, người dùng qua `taoNguoiDungTest`, phạm vi `idsTrongPhamVi` THẬT,
 * quyền `machine_control` THẬT) → `lenhHmi` → `dispatch()` THẬT (cổng binding, cổng kênh sớm 3b, cổng chế độ 3c, nghiệm thu/commissioning
 * BẬT mặc định, preflight safety THẬT, cổng interlock THẬT, đặt chỗ ghi trước, đọc lại `docLai:"bat_buoc"`) → StubDriver THẬT (RAM;
 * `simDatLoi({giaTri})` ép giá trị đọc lại). Chế độ máy: `cheDoMay` THẬT trên bộ đệm THẬT (`datThongTinAdapter` + `napTuOt`).
 *
 * Safety PLC MÔ PHỎNG theo D9 (khuôn `safetySimOnly.dot1c.db.test.ts`): một hàng `safety_plc_configs` THẬT backend `modbus`, phạm vi
 * trạm của máy thử, trỏ một safety-PLC GIẢ trong tiến trình (`modbus-serial` `ServerTCP`, 127.0.0.1 cổng HĐH cấp); facade đọc bằng
 * `OtReadSafetyPlcBackend` → `ModbusDriver` THẬT. Kho coil do TEST giữ. KHÔNG mock `safetyPlcAdapter`. Giữ khoá seed độc quyền
 * (`acquireSeedExclusive`) để hàng PLC thật của harness E2E không lọt vào. Adapter thử có hàng `commissioning_records` thật.
 *
 * Chỉ ba chỗ giả: `getActiveDriver` / `getActiveConnectionFingerprint` (adapter của tệp ⇒ StubDriver), `getIO` (ghi lại mọi
 * `to(room).emit`), và `dispatch` được BỌC để đếm số lần gọi (gọi xuyên mã thật). `OT_CONTROL_ENABLED=true` CHỈ trong tiến trình (D9).
 *
 * Mỗi ô một `it`: đúng mã **và** đúng số dòng WORM tăng thêm. Đếm theo khoá của tệp (không theo max(id) toàn bảng — `_test` dùng
 * chung): `scada_command_attempts` theo `user_id` của người dùng tệp, `command_log` theo `adapterId` của adapter tệp.
 * Thêm hai ô ĐỐI CHỨNG (không thuộc 8 ô): đường vui `acked_verified` (chứng minh bố trí CHO PHÉP ghi — mọi từ chối dưới là do kích
 * thích của ô, không do bố trí hỏng) và e-stop trên PLC giả ⇒ `SAFETY_BLOCKED` (chứng minh safety mô phỏng nằm TRONG vòng).
 *
 * CHỈ CHẠY KHI GỌI TƯỜNG MINH (như R0):
 *   Bash:       SCADA_R1A_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r1aNghiemThu.db.test.ts
 *   PowerShell: $env:SCADA_R1A_NGHIEM_THU='1'; npx vitest run -c vitest.db.config.ts server/services/scada/r1aNghiemThu.db.test.ts
 * Không đặt biến ⇒ cả tệp bị bỏ qua (không dựng dữ liệu).
 *
 * `command_log` + `scada_command_attempts` là WORM: hàng của tệp ở lại (đúng thiết kế). Mọi hàng khác được dọn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { eq, sql } from "drizzle-orm";
import * as ModbusSerialNs from "modbus-serial";

const RUN = `r1ant${process.pid}${Date.now().toString(36)}`;
const CHAY_NGHIEM_THU = process.env.SCADA_R1A_NGHIEM_THU === "1";

const H = vi.hoisted(() => ({
  emits: [] as Array<{ room: string; ev: string; payload: Record<string, unknown> }>,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  writeCalls: 0,
  dispatchCalls: 0,
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

import { getDb } from "../../db/connection";
import { aiPendingActions } from "../../../drizzle/schema";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import speakeasy from "speakeasy";
import { setup2FA, enable2FA, disable2FA } from "../../db/auth";
import { StubDriver } from "../ot/drivers/stubDriver";
import { createModbusDriver } from "../ot/drivers/modbusDriver";
import { registerDriver } from "../ot/driverRegistry";
import { otPayloadHash, withOtPayloadHash } from "../ot/otActionBinding";
import { adapterTargetFingerprint } from "../ot/adapterTarget";
import { acquireSeedExclusive } from "../edge/__edgeSeedGuard.dot10";

const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;

class StubDem extends StubDriver {
  override async writeTags(writes: Array<{ tagKey: string; address: string; value: unknown }>) {
    H.writeCalls += 1;
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
let stub!: StubDem;

let A!: { fid: number; sid: number; mid: number; code: string };
let ad = 0;
const MA_AD = `${RUN}-a`;
const ENDPOINT = `stub://${MA_AD}`;
const factories: string[] = [];
const userIds: number[] = [];
const ruleIds: number[] = [];
const nguoi: Record<string, { id: number; role: "operator" | "engineer" }> = {};

/** Safety PLC giả (Modbus TCP theo đặc tả; kho coil do TEST giữ — oracle độc lập với mã sản phẩm). */
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
  return { fid: Number(f.id), sid: Number(s.id), mid: Number(m.id), code };
}

interface TagSeed {
  key: string;
  dataType?: "float" | "int";
  kind?: "input" | "input_output" | "output";
  writable?: boolean;
  level?: 1 | 3 | 4 | 5 | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  stopValue?: number | null;
}
async function seedTag(t: TagSeed): Promise<void> {
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", unit, writable, "isEnabled",
      channel_kind, display_name, write_min, write_max, write_step, actuation_level, stop_value)
    VALUES (${ad}, ${t.key}, ${"DB1." + t.key}, ${t.dataType ?? "float"}, ${"°C"}, ${t.writable ?? true}, true,
      ${t.kind ?? "input_output"}::scada_channel_kind, ${"Kenh " + t.key}, ${t.min === undefined ? 0 : t.min}, ${t.max === undefined ? 300 : t.max},
      ${t.step === undefined ? 0.5 : t.step}, ${t.level === undefined ? 3 : t.level}, ${t.stopValue == null ? null : sql`${JSON.stringify(t.stopValue)}::jsonb`})`);
}

async function seedNguoi(ten: string, role: "operator" | "engineer"): Promise<void> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "r1ant", ts: RUN, ten: `R1A NT ${ten}` });
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

const LY_DO = "nghiem thu R1a theo phieu";
const uuid = () => crypto.randomUUID();
const mauOt = (tagKey: string, value: number) => ({ tagKey, raw: value, value, quality: "good" as const, timestamp: new Date() });
const napCheDo = (v: number) => boDem.napTuOt({ adapterId: ad, machineId: A.mid }, [mauOt("che_do", v)]);

/** Đếm WORM theo khoá của tệp. */
async function demWorm(): Promise<{ attempts: number; commandLog: number }> {
  const ids = sql.join([...userIds, -1].map((i) => sql`${i}`), sql`, `);
  const [a] = await dung(sql`SELECT count(*)::int AS n FROM scada_command_attempts WHERE user_id IN (${ids})`);
  const [c] = await dung(sql`SELECT count(*)::int AS n FROM command_log WHERE "adapterId" = ${ad}`);
  return { attempts: Number(a.n), commandLog: Number(c.n) };
}
async function tang(truoc: { attempts: number; commandLog: number }) {
  const sau = await demWorm();
  return { attempts: sau.attempts - truoc.attempts, commandLog: sau.commandLog - truoc.commandLog };
}

type DongThu = { stage: string; outcome: string; reason_code: string | null; user_id: number; request_id: string | null };
async function thuMoiNhat(userId: number, n: number): Promise<DongThu[]> {
  const r = (await dung(sql`SELECT stage, outcome, reason_code, user_id, request_id FROM scada_command_attempts
    WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${n}`)) as DongThu[];
  return r.reverse();
}
type DongLenh = { status: string; errorText: string | null; readBackValue: unknown; ledger: string | null; tagKey: string };
async function lenhMoiNhat(n: number): Promise<DongLenh[]> {
  const r = (await dung(sql`SELECT status::text AS status, "errorText", "readBackValue", "ackValue"->>'ledger' AS ledger, "tagKey"
    FROM command_log WHERE "adapterId" = ${ad} ORDER BY id DESC LIMIT ${n}`)) as DongLenh[];
  return r.reverse();
}

async function yeuCau(ten: string, tagKey: string, value: number | string): Promise<string> {
  const kq = await (await caller(ten)).request({ adapterId: ad, tagKey, value, lyDo: LY_DO, clientRequestId: uuid() });
  return kq.requestId;
}

/** "Tool AI" gọi thẳng dispatch(): dòng chờ AI ĐÃ XÁC NHẬN, gắn đúng lệnh (băm), như propose/confirm của copilot đã làm. */
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
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL_AI, adapterId: ad, machineId: A.mid, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return {
    adapterId: ad,
    machineId: A.mid,
    commandType,
    writes,
    triggeredBy: { kind: "hitl" as const, actionId, tool: TOOL_AI, confirmedBy: owner, requestedBy: owner },
    idempotencyKey: `${RUN}-ai-${uuid()}`,
  };
}

const ENV: Record<string, string> = {
  SCADA_COMMANDS_ENABLED: "true",
  SCADA_LIVE_CACHE_ENABLED: "true",
  SCADA_CONG_CHE_DO_ENABLED: "false",
  OT_CONTROL_ENABLED: "true", // D9: CHỈ trong tiến trình test
  OT_COMMISSIONING_REQUIRED: "true", // mặc định sản phẩm — adapter thử CÓ hàng commissioning
  OT_SAFETY_PREFLIGHT_ENABLED: "true",
  SAFETY_PLC_ADAPTER_ENABLED: "true",
  OT_READBACK_ENABLED: "false", // đường HMI vẫn đọc lại (docLai bat_buoc) — đột biến ô 7 dựa vào điều này
  OT_CMD_SERIALIZE_ENABLED: "false",
  SEC_PLATFORM: "false",
  UNS_CMD_ACK_ENABLED: "false",
  AI_OT_CONTROL_ENABLED: "false", // dispatch() không đọc cờ này (cổng AI ở tầng tool); giữ OFF như .env (D9)
  INTERLOCK_AUTO_BLOCK_ENABLED: "false",
};

describe.skipIf(!CHAY_NGHIEM_THU)("nghiệm thu R1a — ma trận 8 ô (SCADA_R1A_NGHIEM_THU=1)", () => {
  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    const url = process.env.DATABASE_URL ?? "";
    expect(url).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    seedLock = await acquireSeedExclusive(url, { waitMs: 30_000 });
    const d = await getDb();
    if (!d) throw new Error("test cần CSDL _test");
    db = d;
    // nạp NÓNG facade + nguồn safety-PLC (dispatcher nạp chúng bằng import động bên trong hạn preflight 5 s — khuôn dot1c)
    await import("../ot/adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    registerDriver("modbus", createModbusDriver); // như server/services/ot/index.ts lúc boot (OtReadSafetyPlcBackend dùng createDriver)
    ({ scadaCommandsRouter } = await import("../../routers/scadaCommandsRouter"));
    disp = await import("../ot/commandDispatcher");
    boDem = await import("./boDemHienTai");

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
      VALUES (${MA_PLC}, 'R1a T15 safety PLC mo phong', 'generic', 'modbus', ${`tcp://127.0.0.1:${plc.port}`},
        ${JSON.stringify({ estop: { address: "coil:1", dataType: "bool" } })}::jsonb, true, NULL, ${A.sid})`);

    const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
      VALUES (${A.mid}, ${MA_AD}, ${MA_AD}, 'stub', ${ENDPOINT}, 60000, true, 'disabled') RETURNING id`);
    ad = Number(r.id);
    await dung(sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${ad}, 'active', 1, ${RUN})`);
    H.fingerprints.set(ad, adapterTargetFingerprint({ protocol: "stub", endpoint: ENDPOINT, machineId: A.mid, connectionOptions: null }));

    // kênh chế độ: input, không ghi, int; REMOTE khi = 2
    await seedTag({ key: "che_do", dataType: "int", kind: "input", writable: false, level: null, min: null, max: null, step: null });
    await seedTag({ key: "vui" });
    await seedTag({ key: "estop" });
    await seedTag({ key: "vao", kind: "input", writable: true, level: null }); // ô 1: kênh VÀO (writable=true để dispatch tới được cổng 3b)
    await seedTag({ key: "sp_dai", min: 240, max: 250, step: 0.5 }); // ô 2
    await seedTag({ key: "sp_local" }); // ô 3
    await seedTag({ key: "dung", dataType: "int", level: 1, min: 0, max: 100, step: 1, stopValue: 0 }); // ô 3: STOP ghim
    await seedTag({ key: "khoa" }); // ô 4
    await seedTag({ key: "het" }); // ô 5
    await seedTag({ key: "il" }); // ô 6
    await seedTag({ key: "lech" }); // ô 7
    await seedTag({ key: "m4", level: 4 }); // ô 8
    await seedTag({ key: "m4b", level: 4 }); // ô 8 (confirm)
    await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by)
      VALUES (${A.mid}, ${ad}, 'che_do', '2'::jsonb, 1)`);
    boDem.datThongTinAdapter(ad, { pollMs: 60_000, coDeadband: false, machineId: A.mid, code: MA_AD });
    napCheDo(2);

    stub = new StubDem();
    await stub.connect({ endpoint: ENDPOINT } as never);
    H.drivers.set(ad, stub);

    await seedNguoi("opA", "operator");
    await seedNguoi("opB", "operator");
    await seedNguoi("engAi", "engineer");
    await seedNguoi("engKhong2fa", "engineer");
    await seedNguoi("engBo2fa", "engineer");
  }, 90_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    try {
      boDem?.xoaAdapter(ad);
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
        for (const id of ruleIds) {
          await dung(sql`UPDATE interlock_rules SET enabled = false WHERE id = ${id}`);
          await dung(sql`DELETE FROM interlock_events WHERE "ruleId" = ${id}`).catch(() => undefined);
          await dung(sql`DELETE FROM interlock_rules WHERE id = ${id}`);
        }
        for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id}`);
        for (const id of userIds) await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${id}`);
        for (const id of userIds) await dung(sql`DELETE FROM totp_consumed WHERE "userId" = ${id}`).catch(() => undefined);
        await dung(sql`DELETE FROM safety_plc_configs WHERE code = ${MA_PLC}`);
        if (ad) {
          await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${ad}`);
          await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${ad}`);
          await dung(sql`DELETE FROM commissioning_records WHERE "adapterId" = ${ad}`).catch(() => undefined);
          await dung(sql`DELETE FROM device_adapters WHERE id = ${ad}`);
        }
        if (A?.mid) await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${A.mid}`);
        for (const code of factories) {
          await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`);
          await dung(sql`DELETE FROM machines WHERE code = ${code}`);
          await dung(sql`DELETE FROM stations WHERE code = ${code}`);
          await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
          await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
          await dung(sql`DELETE FROM factories WHERE code = ${code}`);
        }
      } catch (e) {
        console.warn("[r1a-nt] dọn dữ liệu:", (e as Error).message);
      }
    }
    await seedLock?.release();
    seedLock = null;
  }, 90_000);

  // ═════════ ĐỐI CHỨNG (không thuộc 8 ô) ═════════
  it("đối chứng A — đường vui: opA mức 3, 245 ⇒ acked_verified, thiết bị 1 lần, attempts +3, command_log +2 (ý định + kết quả)", async () => {
    const truoc = await demWorm();
    const ghi = H.writeCalls;
    const requestId = await yeuCau("opA", "vui", "245");
    const kq = await (await caller("opA")).confirm({ requestId });
    expect(kq).toMatchObject({ status: "acked_verified", ok: true, simulated: false, readBackValue: 245 });
    expect(H.writeCalls - ghi).toBe(1);
    expect(await tang(truoc)).toEqual({ attempts: 3, commandLog: 2 });
    expect((await lenhMoiNhat(2)).map((d) => [d.ledger, d.status])).toEqual([
      ["intent", "sent"],
      ["result", "acked_verified"],
    ]);
  });

  it("đối chứng B — safety PLC mô phỏng TRONG vòng: e-stop coil ACTIVE ⇒ SAFETY_BLOCKED, thiết bị 0 lần, command_log +1", async () => {
    const requestId = await yeuCau("opA", "estop", 100);
    const truoc = await demWorm();
    const ghi = H.writeCalls;
    plc.coils.set(0, true);
    try {
      const kq = await (await caller("opA")).confirm({ requestId });
      expect(kq).toMatchObject({ status: "rejected", ok: false, reason: "SAFETY_BLOCKED" });
    } finally {
      plc.coils.set(0, false);
    }
    expect(H.writeCalls - ghi).toBe(0);
    expect(await tang(truoc)).toEqual({ attempts: 2, commandLog: 1 });
    expect((await lenhMoiNhat(1))[0].errorText).toMatch(/^SAFETY_BLOCKED/);
  });

  // ═════════ 8 Ô ═════════
  it("ô 1 — kênh VÀO: request CHANNEL_READ_ONLY (attempts +1, command_log 0); dispatch AI trực tiếp CHANNEL_READ_ONLY (command_log +1, attempts 0)", async () => {
    let truoc = await demWorm();
    const loi = await loiCua((await caller("opA")).request({ adapterId: ad, tagKey: "vao", value: 1, lyDo: LY_DO, clientRequestId: uuid() }));
    expect(loi).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CHANNEL_READ_ONLY" });
    expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 0 });
    expect((await thuMoiNhat(nguoi.opA.id, 1))[0]).toMatchObject({ stage: "request", outcome: "rejected", reason_code: "CHANNEL_READ_ONLY" });

    truoc = await demWorm();
    const ghi = H.writeCalls;
    const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "vao", value: 1 }]));
    expect(res).toMatchObject({ ok: false, status: "rejected", reason: "CHANNEL_READ_ONLY" });
    expect(H.writeCalls - ghi).toBe(0);
    expect(await tang(truoc)).toEqual({ attempts: 0, commandLog: 1 });
    expect((await lenhMoiNhat(1))[0]).toMatchObject({ status: "rejected", tagKey: "vao" });
    expect((await lenhMoiNhat(1))[0].errorText).toMatch(/^CHANNEL_READ_ONLY/);
  });

  it("ô 2 — 251 với dải 240..250: request OUT_OF_RANGE (attempts +1); dispatch AI trực tiếp OUT_OF_RANGE (command_log +1), thiết bị 0 lần", async () => {
    let truoc = await demWorm();
    const loi = await loiCua((await caller("opA")).request({ adapterId: ad, tagKey: "sp_dai", value: 251, lyDo: LY_DO, clientRequestId: uuid() }));
    expect(loi).toMatchObject({ code: "BAD_REQUEST", appCode: "SCADA_VALUE_OUT_OF_RANGE", appParams: { ma: "OUT_OF_RANGE", min: 240, max: 250 } });
    expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 0 });
    expect((await thuMoiNhat(nguoi.opA.id, 1))[0]).toMatchObject({ stage: "request", outcome: "rejected", reason_code: "OUT_OF_RANGE" });

    truoc = await demWorm();
    const ghi = H.writeCalls;
    const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sp_dai", value: 251 }]));
    expect(res, JSON.stringify(res)).toMatchObject({ ok: false, status: "rejected", reason: "OUT_OF_RANGE" });
    expect(H.writeCalls - ghi).toBe(0);
    expect(await tang(truoc)).toEqual({ attempts: 0, commandLog: 1 });
    expect((await lenhMoiNhat(1))[0].errorText).toMatch(/^OUT_OF_RANGE/);
  });

  it("ô 3 — máy LOCAL: request MODE_LOCAL (attempts +1); SCADA_CONG_CHE_DO_ENABLED ⇒ dispatch AI MODE_LOCAL (command_log +1); STOP ghim vẫn qua (thiết bị 1 lần)", async () => {
    napCheDo(1);
    try {
      let truoc = await demWorm();
      const loi = await loiCua((await caller("opA")).request({ adapterId: ad, tagKey: "sp_local", value: 100, lyDo: LY_DO, clientRequestId: uuid() }));
      expect(loi).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_MACHINE_NOT_REMOTE", appParams: { lyDo: "khac_remote" } });
      expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 0 });
      expect((await thuMoiNhat(nguoi.opA.id, 1))[0]).toMatchObject({ stage: "request", outcome: "rejected", reason_code: "MODE_LOCAL" });

      vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "true");
      try {
        truoc = await demWorm();
        let ghi = H.writeCalls;
        const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sp_local", value: 100 }]));
        expect(res, JSON.stringify(res)).toMatchObject({ ok: false, status: "rejected", reason: "MODE_LOCAL" });
        expect(H.writeCalls - ghi).toBe(0);
        expect(await tang(truoc)).toEqual({ attempts: 0, commandLog: 1 });
        expect((await lenhMoiNhat(1))[0].errorText).toMatch(/^MODE_LOCAL: khac_remote/);

        // STOP ghim (stop dung=0 khớp stop_value) trên CÙNG máy LOCAL, cờ bật ⇒ không bị cổng chế độ chặn, tới thiết bị đúng 1 lần
        truoc = await demWorm();
        ghi = H.writeCalls;
        const stop = await disp.dispatch(await lenhAi("stop", [{ tagKey: "dung", value: 0 }]));
        expect(stop, JSON.stringify(stop)).toMatchObject({ ok: true, status: "acked", simulated: false });
        expect(H.writeCalls - ghi).toBe(1);
        const t = await tang(truoc);
        expect(t.attempts).toBe(0);
        const dong = await lenhMoiNhat(t.commandLog);
        expect(dong.every((x) => !String(x.errorText ?? "").startsWith("MODE_LOCAL")), JSON.stringify(dong)).toBe(true);
        expect(t, JSON.stringify(dong)).toEqual({ attempts: 0, commandLog: 2 });
      } finally {
        vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "false");
      }
    } finally {
      napCheDo(2);
    }
  });

  it("ô 4 — opB yêu cầu kênh opA đang giữ ⇒ DANG_DUOC_CHON (boiUserId = opA), attempts +1 của opB, command_log 0", async () => {
    await yeuCau("opA", "khoa", 100);
    const truoc = await demWorm();
    const loi = await loiCua((await caller("opB")).request({ adapterId: ad, tagKey: "khoa", value: 120, lyDo: LY_DO, clientRequestId: uuid() }));
    expect(loi).toMatchObject({ code: "CONFLICT", appCode: "SCADA_TAG_SELECTED_BY_OTHER", appParams: { ma: "DANG_DUOC_CHON", boiUserId: nguoi.opA.id } });
    expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 0 });
    expect((await thuMoiNhat(nguoi.opB.id, 1))[0]).toMatchObject({ stage: "request", outcome: "rejected", reason_code: "DANG_DUOC_CHON" });
    await (await caller("opA")).huy({ requestId: (await thuMoiNhat(nguoi.opA.id, 1))[0].request_id! });
  });

  it("ô 5 — confirm sau expiresAt ⇒ HET_HAN, dispatch 0 lần, attempts +1 (confirm/expired), command_log 0", async () => {
    const requestId = await yeuCau("opA", "het", 100);
    await db.update(aiPendingActions).set({ expiresAt: new Date(Date.now() - 5_000) }).where(eq(aiPendingActions.id, requestId));
    const truoc = await demWorm();
    const d0 = H.dispatchCalls;
    const loi = await loiCua((await caller("opA")).confirm({ requestId }));
    expect(loi).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_REQUEST_EXPIRED", appParams: { ma: "HET_HAN" } });
    expect(H.dispatchCalls - d0).toBe(0);
    expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 0 });
    expect((await thuMoiNhat(nguoi.opA.id, 1))[0]).toMatchObject({ stage: "confirm", outcome: "expired", reason_code: "HET_HAN", request_id: requestId });
  });

  it("ô 6 — luật telemetry_tag bật, chặn, không có mẫu ⇒ confirm → dispatch INTERLOCK_BLOCKED (thieu_du_lieu), command_log +1, thiết bị 0 lần", async () => {
    const [r] = await dung(sql`INSERT INTO interlock_rules
        (name, scope, "machineId", "sourceType", "sourceKey", "comparisonOperator", threshold, "windowSize", "windowSeconds",
         action, "targetMachineId", "targetAdapterId", enabled, "approvedBy")
      VALUES (${RUN + "-il"}, 'machine', ${A.mid}, 'telemetry_tag', ${RUN + "-khong-co-mau"}, 'gt', 80, 50, 300,
         'block_downstream', ${A.mid}, ${ad}, true, 1) RETURNING id`);
    ruleIds.push(Number(r.id));
    try {
      const requestId = await yeuCau("opA", "il", 100);
      const truoc = await demWorm();
      const ghi = H.writeCalls;
      const kq = await (await caller("opA")).confirm({ requestId });
      expect(kq).toMatchObject({ status: "rejected", ok: false, simulated: false, reason: "INTERLOCK_BLOCKED" });
      expect(H.writeCalls - ghi).toBe(0);
      expect(await tang(truoc)).toEqual({ attempts: 2, commandLog: 1 });
      expect((await lenhMoiNhat(1))[0]).toMatchObject({ status: "rejected", tagKey: "il" });
      expect((await lenhMoiNhat(1))[0].errorText).toMatch(/^INTERLOCK_BLOCKED: .*thieu_du_lieu/);
      expect((await thuMoiNhat(nguoi.opA.id, 1))[0]).toMatchObject({ stage: "dispatch", outcome: "dispatched", reason_code: "INTERLOCK_BLOCKED" });
    } finally {
      await dung(sql`UPDATE interlock_rules SET enabled = false WHERE id = ${r.id}`);
    }
  });

  it("ô 7 — đọc lại lệch (stub ép 245 sau khi ghi 200) ⇒ acked_unverified, scada:cmd mang readBackValue 245, command_log +2 (ý định + kết quả)", async () => {
    const requestId = await yeuCau("opA", "lech", 200);
    const truoc = await demWorm();
    H.emits.length = 0;
    stub.simDatLoi({ giaTri: { lech: 245 } });
    try {
      const kq = await (await caller("opA")).confirm({ requestId });
      expect(kq, JSON.stringify(kq)).toMatchObject({ status: "acked_unverified", ok: true, simulated: false, readBackValue: 245 });
    } finally {
      stub.simDatLoi({});
    }
    expect(await tang(truoc)).toEqual({ attempts: 2, commandLog: 2 });
    expect((await lenhMoiNhat(2)).map((d) => [d.ledger, d.status, d.readBackValue])).toEqual([
      ["intent", "sent", null],
      ["result", "acked_unverified", 245],
    ]);
    const cuoi = H.emits.at(-1)!;
    expect(cuoi.room).toBe(`user:${nguoi.opA.id}`);
    expect(cuoi.ev).toBe("scada:cmd");
    expect(cuoi.payload).toMatchObject({ requestId, status: "acked_unverified", readBackValue: 245 });
  });

  it("ô 8 — engineer CHƯA đăng ký 2FA, kênh mức 4 ⇒ request TOTP_CHUA_DANG_KY (attempts +1); yêu cầu tạo khi CÒN 2FA rồi bỏ đăng ký ⇒ confirm cùng mã; dispatch 0 lần", async () => {
    // (a) request
    let truoc = await demWorm();
    const d0 = H.dispatchCalls;
    const loi = await loiCua((await caller("engKhong2fa")).request({ adapterId: ad, tagKey: "m4", value: 100, lyDo: LY_DO, clientRequestId: uuid() }));
    expect(loi).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_TOTP_NOT_ENROLLED", appParams: { level: 4 } });
    expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 0 });
    expect((await thuMoiNhat(nguoi.engKhong2fa.id, 1))[0]).toMatchObject({ stage: "request", outcome: "rejected", reason_code: "TOTP_CHUA_DANG_KY" });

    // (b) confirm: đăng ký 2FA (DB) ⇒ request qua (needsTotp) ⇒ bỏ đăng ký (DB) ⇒ confirm ⇒ cùng mã
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    await setup2FA(nguoi.engBo2fa.id, secret);
    await enable2FA(nguoi.engBo2fa.id);
    const kq = await (await caller("engBo2fa")).request({ adapterId: ad, tagKey: "m4b", value: 100, lyDo: LY_DO, clientRequestId: uuid() });
    expect(kq.preview).toMatchObject({ level: 4, needsTotp: true });
    await disable2FA(nguoi.engBo2fa.id);
    truoc = await demWorm();
    const maDung = speakeasy.totp({ secret, encoding: "base32" });
    const loi2 = await loiCua((await caller("engBo2fa")).confirm({ requestId: kq.requestId, totpCode: maDung }));
    expect(loi2).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_TOTP_NOT_ENROLLED", appParams: { ma: "TOTP_CHUA_DANG_KY", level: 4 } });
    expect(await tang(truoc)).toEqual({ attempts: 1, commandLog: 0 });
    expect((await thuMoiNhat(nguoi.engBo2fa.id, 1))[0]).toMatchObject({ stage: "confirm", outcome: "rejected", reason_code: "TOTP_CHUA_DANG_KY" });
    expect(H.dispatchCalls - d0, "dispatch 0 lần qua cả (a) và (b)").toBe(0);
    await (await caller("engBo2fa")).huy({ requestId: kq.requestId }); // nhả khoá chọn (QĐ T9-2 giữ khoá khi từ chối 2FA)
  });
});
