/**
 * SCADA R1b-2b-2a A2(a) (AN TOÀN, dieu-phoi 2026-11-02, + AMENDMENT 1 / 2) — lệnh OT THƯỜNG không có khoá idempotency bị TỪ CHỐI ở cửa vào duy nhất
 * (`dispatch()` → `dispatchCore`, ngay SAU cổng uỷ quyền (1), TRƯỚC idempotency (2), giữ chỗ, ý định, thiết bị); STOP không khoá VẪN BAY.
 *
 * Vì sao: từ T6d khoá quyết phát lại / từ chối. Lệnh thường không khoá không có chống trùng nào (thử lại = ghi hai lần). Kiểm kê bên gọi
 * (a2a-kiem-ke-khoa.md): không đường SỐNG nào gửi không khoá.
 *
 * Ba biến thể (mỗi biến thể một mã):
 *   • IDEMPOTENCY_KEY_REQUIRED                — không write nào chạm tag ghim STOP;
 *   • IDEMPOTENCY_KEY_REQUIRED_STOP_LIKE      — có write vào tag ghim STOP nhưng lệnh KHÔNG phải STOP (lô trộn / giá trị khác ghim) ⇒ cảnh báo KHẨN;
 *   • IDEMPOTENCY_KEY_REQUIRED_PIN_UNREADABLE — không đọc được ghim ⇒ không chứng minh được STOP ⇒ từ chối + cảnh báo KHẨN.
 * Cảnh báo khử trùng theo (adapter, tập tag, người yêu cầu) trong 60 s; bảng đầy ⇒ gộp vào khoá tràn `__tran__` (một cảnh báo / cửa sổ).
 *
 * DB THẬT (`_test`): dispatcher THẬT + driver GIẢ đếm `writeTags`; mọi ghi trong giao dịch ROLLBACK; command_log (WORM): không id tường minh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const H = vi.hoisted(() => ({
  tx: null as unknown,
  bay: 0,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  canhBao: [] as Array<{ kind: string; title: string; message: string; recipients: ReadonlyArray<number>; dedupKey: string }>,
}));

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...real,
    getDb: (async () => {
      if (H.tx) return H.tx;
      H.bay++;
      return null;
    }) as typeof real.getDb,
    __realGetDb: real.getDb,
  };
});
vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "A2A-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});
vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => H.fingerprints.get(adapterId),
  };
});
vi.mock("../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return {
    ...orig,
    raiseCriticalStopAlert: async (a: { kind: string; title: string; message: string; recipients: ReadonlyArray<number>; dedupKey: string }) => {
      H.canhBao.push(a);
    },
  };
});

import * as conn from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags, interlockEvents, interlockRules } from "../../../drizzle/schema";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";
import {
  dispatch,
  demCanhBaoKhongKhoa,
  __datLaiCanhBaoKhongKhoaChoTest,
  KHOA_BAT_BUOC_CANH_BAO_CUA_SO_MS,
  KHOA_BAT_BUOC_CANH_BAO_TOI_DA,
  KHOA_BAT_BUOC_CANH_BAO_TRAN,
  MA_THIEU_KHOA,
  MA_THIEU_KHOA_GIONG_STOP,
  MA_THIEU_KHOA_GHIM_LOI_DOC,
  type DispatchResult,
  type DispatchInput,
} from "./commandDispatcher";
import { _setPinReadProbeForTests } from "./stopPin";
import type { OtCommandResult, OtWrite } from "./otDriver";
import { dongDauDuyetLuat } from "../../testing/dauDuyetInterlock";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2A-${Date.now()}`;
const OWNER = 990_908_101;
const KHAC = 990_908_102;
const MACHINE = 990_908_001;
const TOOL = "set_machine_param";
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

type KichBan = (w: OtWrite) => OtCommandResult;
const ACK: KichBan = (w) => ({ tagKey: w.tagKey, ok: true });

function driverGia(kb: KichBan = ACK) {
  const d = {
    protocol: "modbus",
    soGhi: 0,
    kb,
    isConnected: () => true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    health: async () => ({ protocol: "modbus", connected: true }),
    writeTags: async (ws: OtWrite[]) => {
      d.soGhi += 1;
      return ws.map((w) => d.kb(w));
    },
    readTags: async () => [],
  };
  return d;
}

/** adapter modbus + tag thường `t`, `u` và hai tag GHIM STOP `a` (stopValue 0), `b` (stopValue 0) — driver giả của riêng adapter. */
async function taoAdapter(tx: Tx, d: unknown): Promise<number> {
  // địa chỉ TEST-NET cố định (RFC 5737): driver giả, endpoint không bao giờ được kết nối — chỉ vào dấu vân tay đích của chính adapter
  const endpoint = "tcp://192.0.2.10:502";
  const [a] = await tx.insert(deviceAdapters).values({ code: `${DAU}-A-${randomUUID()}`, name: `${DAU} adapter`, protocol: "modbus", endpoint, isEnabled: true, machineId: MACHINE }).returning();
  const adapterId = a!.id;
  await tx.insert(deviceTags).values([
    { adapterId, tagKey: "t", address: "40001", dataType: "int", writable: true },
    { adapterId, tagKey: "u", address: "40002", dataType: "int", writable: true },
    { adapterId, tagKey: "a", address: "40003", dataType: "int", writable: true, stopValue: 0 as never },
    { adapterId, tagKey: "b", address: "40004", dataType: "int", writable: true, stopValue: 0 as never },
  ]);
  H.drivers.set(adapterId, d);
  H.fingerprints.set(adapterId, adapterTargetFingerprint({ protocol: "modbus", endpoint, machineId: MACHINE, connectionOptions: null }));
  return adapterId;
}

/** Uỷ quyền HITL gắn ĐÚNG lệnh này (confirmed, chủ = OWNER). */
async function taoHanhDong(tx: Tx, adapterId: number, writes: Array<{ tagKey: string; value: unknown }>, commandType = "set_param"): Promise<string> {
  const actionId = `${DAU}-act-${randomUUID()}`;
  await tx.insert(aiPendingActions).values({
    id: actionId,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} test action`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId, machineId: MACHINE, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return actionId;
}

const KHONG_TRUYEN = Symbol("khong truyen");
type Khoa = string | typeof KHONG_TRUYEN | unknown;

function lenh(adapterId: number, writes: Array<{ tagKey: string; value: unknown }>, khoa: Khoa, commandType: string, triggeredBy: DispatchInput["triggeredBy"]): DispatchInput {
  const inp = { adapterId, machineId: MACHINE, commandType, writes, triggeredBy, idempotencyKey: khoa } as DispatchInput;
  if (khoa === KHONG_TRUYEN) delete (inp as { idempotencyKey?: unknown }).idempotencyKey;
  return inp;
}

async function gui(
  tx: Tx,
  adapterId: number,
  writes: Array<{ tagKey: string; value: unknown }>,
  khoa: Khoa,
  o: { commandType?: string; requestedBy?: number; actionId?: string | null } = {},
): Promise<DispatchResult> {
  const commandType = o.commandType ?? "set_param";
  const actionId = o.actionId === undefined ? await taoHanhDong(tx, adapterId, writes, commandType) : o.actionId;
  return dispatch(lenh(adapterId, writes, khoa, commandType, { kind: "hitl", ...(actionId ? { actionId } : {}), tool: TOOL, confirmedBy: OWNER, requestedBy: o.requestedBy ?? OWNER }));
}

const hangCua = async (tx: Tx, r: DispatchResult) => tx.select().from(commandLog).where(inArray(commandLog.id, r.commandLogIds));
const moiHangAdapter = async (tx: Tx, adapterId: number) => tx.select().from(commandLog).where(eq(commandLog.adapterId, adapterId));
const canhBaoKhongKhoa = () => H.canhBao.filter((a) => a.kind.startsWith("ot_keyless_"));
const lang = (ms = 40) => new Promise((r) => setTimeout(r, ms));
type CanhBaoHang = { khoa: string; lanThu: number; daPhat: boolean };
const canhBaoHang = (h: { ackValue: unknown }) => (h.ackValue as { canhBao?: CanhBaoHang } | null)?.canhBao;
const chieu = (r: DispatchResult) => ({ ok: r.ok, simulated: r.simulated, status: r.status, reason: r.reason ?? null, results: r.results.map((x) => ({ tagKey: x.tagKey, ok: x.ok, status: x.status })) });

const ENV_KEYS = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe("A2(a) — cửa sổ khử trùng cảnh báo lệnh không khoá giống STOP (thuần, đồng hồ tiêm)", () => {
  beforeEach(() => __datLaiCanhBaoKhongKhoaChoTest());
  afterAll(() => __datLaiCanhBaoKhongKhoaChoTest());

  it("hằng: cửa sổ 60 000 ms, trần 1024, khoá tràn `__tran__`", () => {
    expect(KHOA_BAT_BUOC_CANH_BAO_CUA_SO_MS).toBe(60_000);
    expect(KHOA_BAT_BUOC_CANH_BAO_TOI_DA).toBe(1024);
    expect(KHOA_BAT_BUOC_CANH_BAO_TRAN).toBe("__tran__");
  });

  it("cùng bộ trong cửa sổ ⇒ chỉ lần ĐẦU phát, lanThu đếm; hết cửa sổ (đúng 60 000 ms) ⇒ cửa sổ MỚI phát lại, lanThu về 1", () => {
    const t0 = 1_000_000;
    expect(demCanhBaoKhongKhoa("k1", t0)).toEqual({ khoa: "k1", lanThu: 1, daPhat: true, batDau: t0 });
    expect(demCanhBaoKhongKhoa("k1", t0 + 1)).toEqual({ khoa: "k1", lanThu: 2, daPhat: false, batDau: t0 });
    expect(demCanhBaoKhongKhoa("k1", t0 + 59_999)).toEqual({ khoa: "k1", lanThu: 3, daPhat: false, batDau: t0 });
    expect(demCanhBaoKhongKhoa("k1", t0 + 60_000)).toEqual({ khoa: "k1", lanThu: 1, daPhat: true, batDau: t0 + 60_000 });
    expect(demCanhBaoKhongKhoa("k2", t0 + 60_001)).toMatchObject({ khoa: "k2", lanThu: 1, daPhat: true });
  });

  it("★ bảng ĐẦY: KHÔNG đuổi khoá còn sống (nó không được phát lại) — bộ mới gộp vào `__tran__`, MỘT lần phát / cửa sổ; khoá hết hạn được dọn trước", () => {
    __datLaiCanhBaoKhongKhoaChoTest(2);
    const t0 = 5_000_000;
    expect(demCanhBaoKhongKhoa("k1", t0).daPhat).toBe(true);
    expect(demCanhBaoKhongKhoa("k2", t0 + 1).daPhat).toBe(true);
    expect(demCanhBaoKhongKhoa("k3", t0 + 2)).toEqual({ khoa: "__tran__", lanThu: 1, daPhat: true, batDau: t0 + 2 });
    expect(demCanhBaoKhongKhoa("k4", t0 + 3)).toEqual({ khoa: "__tran__", lanThu: 2, daPhat: false, batDau: t0 + 2 });
    // k1 vẫn sống: KHÔNG bị đuổi ⇒ không phát lại
    expect(demCanhBaoKhongKhoa("k1", t0 + 4)).toEqual({ khoa: "k1", lanThu: 2, daPhat: false, batDau: t0 });
    // hết cửa sổ của k1/k2 ⇒ được dọn ⇒ bộ mới có chỗ (không tràn)
    expect(demCanhBaoKhongKhoa("k5", t0 + 60_001)).toEqual({ khoa: "k5", lanThu: 1, daPhat: true, batDau: t0 + 60_001 });
    // tràn cũng theo cửa sổ: cửa sổ tràn mới ⇒ phát một lần nữa
    expect(demCanhBaoKhongKhoa("k6", t0 + 60_002)).toMatchObject({ khoa: "k6", daPhat: true });
    expect(demCanhBaoKhongKhoa("k7", t0 + 60_003)).toEqual({ khoa: "__tran__", lanThu: 1, daPhat: true, batDau: t0 + 60_003 });
  });
});

describe.skipIf(!DB_URL)("A2(a) — dispatcher từ chối lệnh THƯỜNG không khoá; STOP không khoá vẫn bay (DB thật, giao dịch ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    await import("../robot/criticalStopAlert");
  }, 60_000);
  afterAll(() => {
    H.drivers.clear();
    _setPinReadProbeForTests(null);
    __datLaiCanhBaoKhongKhoaChoTest();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => {
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    for (const k of ENV_KEYS.slice(2)) delete process.env[k];
    H.bay = 0;
    H.canhBao.length = 0;
    __datLaiCanhBaoKhongKhoaChoTest();
    _setPinReadProbeForTests(null);
  });
  afterEach(() => _setPinReadProbeForTests(null));

  for (const [ten, khoa] of [["không truyền", KHONG_TRUYEN], ['""', ""], ['"   " (chỉ khoảng trắng)', "   "], ["không phải chuỗi (42)", 42]] as Array<[string, Khoa]>) {
    it(`★ A1 khoá ${ten}, lệnh THƯỜNG ⇒ ${"IDEMPOTENCY_KEY_REQUIRED"}, 0 gói, hàng rejected khoá NULL, không ý định, duyệt KHÔNG bị tiêu, không cảnh báo`, async () => {
      await trongGiaoDich(async (tx) => {
        const d = driverGia();
        const ad = await taoAdapter(tx, d);
        const writes = [{ tagKey: "t", value: 1 }, { tagKey: "u", value: 2 }];
        const actionId = await taoHanhDong(tx, ad, writes);
        const r = await gui(tx, ad, writes, khoa, { actionId });
        expect(chieu(r)).toEqual({
          ok: false,
          simulated: false,
          status: "rejected",
          reason: MA_THIEU_KHOA,
          results: [
            { tagKey: "t", ok: false, status: "rejected" },
            { tagKey: "u", ok: false, status: "rejected" },
          ],
        });
        expect(d.soGhi).toBe(0);
        const hang = await moiHangAdapter(tx, ad);
        expect(hang).toHaveLength(2); // đúng các hàng từ chối — không ý định, không hàng nào khác
        expect(hang.map((h) => h.id).sort()).toEqual([...r.commandLogIds].sort());
        for (const h of hang) {
          expect(h.status).toBe("rejected");
          expect(h.idempotencyKey).toBeNull();
          expect(String(h.errorText)).toBe(`${MA_THIEU_KHOA}: idempotency key required for a non-STOP command — not sent`);
          expect((h.ackValue as { ledger?: string } | null)?.ledger).not.toBe("intent");
          expect(canhBaoHang(h)).toBeUndefined();
        }
        const [act] = await tx.select().from(aiPendingActions).where(eq(aiPendingActions.id, actionId));
        expect(act!.status).toBe("confirmed");
        expect(act!.executedAt).toBeNull();
      });
      await lang();
      expect(canhBaoKhongKhoa()).toEqual([]);
      expect(H.bay).toBe(0);
    }, 30_000);
  }

  it("★ A2 / (a) STOP theo LOẠI LỆNH không khoá ⇒ BAY (+1 gói), kể cả khi lô có write thường kèm tag ghim", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const s1 = await gui(tx, ad, [{ tagKey: "a", value: 0 }], "", { commandType: "stop" });
      expect(s1).toMatchObject({ ok: true, simulated: false, status: "acked" });
      expect(d.soGhi).toBe(1);
      const s2 = await gui(tx, ad, [{ tagKey: "a", value: 0 }, { tagKey: "t", value: 1 }], KHONG_TRUYEN, { commandType: "stop" });
      expect(s2.reason ?? "").not.toMatch(/^IDEMPOTENCY_KEY_REQUIRED/);
      expect(s2).toMatchObject({ ok: true, simulated: false, status: "acked" });
      expect(d.soGhi).toBe(2);
    });
    await lang();
    expect(canhBaoKhongKhoa()).toEqual([]);
  }, 30_000);

  it("★ A3 / (c) STOP theo NỘI DUNG (loại lệnh thường, MỌI write = tag ghim + giá trị ghim) không khoá ⇒ BAY (+1 gói)", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const r = await gui(tx, ad, [{ tagKey: "a", value: 0 }, { tagKey: "b", value: 0 }], "   ");
      expect(r).toMatchObject({ ok: true, simulated: false, status: "acked" });
      expect(d.soGhi).toBe(1);
    });
    await lang();
    expect(canhBaoKhongKhoa()).toEqual([]);
  }, 30_000);

  it("★ A4 (AMENDMENT 1) lệnh không khoá GIỐNG STOP mà uỷ quyền HỎNG ⇒ lời từ chối uỷ quyền NHƯ main (NOT_CONFIRMED / INTERLOCK_AUTO_BLOCK_DISABLED), KHÔNG cảnh báo, KHÔNG hàng IDEMPOTENCY_KEY_REQUIRED*; cùng lệnh được uỷ quyền ⇒ STOP_LIKE + cảnh báo", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const writes = [{ tagKey: "a", value: 0 }, { tagKey: "t", value: 1 }];
      // HITL: hành động không tồn tại ⇒ cổng (1) từ chối
      const r1 = await gui(tx, ad, writes, "", { actionId: `${DAU}-khong-co` });
      expect(chieu(r1)).toMatchObject({ ok: false, status: "rejected", reason: "NOT_CONFIRMED" });
      const hang = await moiHangAdapter(tx, ad);
      expect(hang.length).toBeGreaterThan(0);
      expect(hang.filter((h) => /^IDEMPOTENCY_KEY_REQUIRED/.test(String(h.errorText)))).toEqual([]);
      expect(hang.every((h) => canhBaoHang(h) === undefined)).toBe(true);
      await lang();
      expect(canhBaoKhongKhoa()).toEqual([]);
      // đối chứng: CÙNG lệnh, uỷ quyền hợp lệ ⇒ STOP_LIKE + một cảnh báo
      const r3 = await gui(tx, ad, writes, "");
      expect(r3).toMatchObject({ ok: false, status: "rejected", reason: MA_THIEU_KHOA_GIONG_STOP });
      expect(d.soGhi).toBe(0);
      await vi.waitFor(() => expect(canhBaoKhongKhoa()).toHaveLength(1), { timeout: 3000 });
    });
    // interlock: cờ tự chặn TẮT ⇒ cổng (1) từ chối (giao dịch riêng; từ fix round 1 F1 hai lời từ chối không khoá cùng tag KHÔNG còn đụng UNIQUE — ca F1 dưới).
    H.canhBao.length = 0;
    await trongGiaoDich(async (tx) => {
      const ad = await taoAdapter(tx, driverGia());
      const r2 = await dispatch(lenh(ad, [{ tagKey: "a", value: 5 }], "", "stop_line", { kind: "interlock", ruleId: 1, eventId: 1, approvedBy: OWNER }));
      expect(chieu(r2)).toMatchObject({ ok: false, status: "rejected", reason: "INTERLOCK_AUTO_BLOCK_DISABLED" });
      const hang = await moiHangAdapter(tx, ad);
      expect(hang).toHaveLength(1);
      expect(String(hang[0]!.errorText)).toMatch(/^INTERLOCK_AUTO_BLOCK_DISABLED: /);
      expect(canhBaoHang(hang[0]!)).toBeUndefined();
    });
    await lang();
    expect(canhBaoKhongKhoa()).toEqual([]);
  }, 30_000);

  it("★ A5 khoá `\"  K  \"` (không rỗng, có khoảng trắng) KHÔNG bị từ chối", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const r = await gui(tx, ad, [{ tagKey: "t", value: 1 }], `  K-${randomUUID().slice(0, 8)}  `);
      expect(r).toMatchObject({ ok: true, simulated: false, status: "acked" });
      expect(d.soGhi).toBe(1);
    });
  }, 30_000);

  it("★ (b) lô TRỘN không khoá (tag ghim + giá trị ghim KÈM tag thường, loại lệnh thường) ⇒ STOP_LIKE, 0 gói, hàng rejected (mỗi write, khoá NULL, canhBao), MỘT cảnh báo ot_keyless_stop_like_refused: KHÔNG gửi, dùng STOP máy HMI / gửi lại kèm khoá", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const r = await gui(tx, ad, [{ tagKey: "a", value: 0 }, { tagKey: "t", value: 1 }], "", { requestedBy: KHAC });
      expect(chieu(r)).toEqual({
        ok: false,
        simulated: false,
        status: "rejected",
        reason: MA_THIEU_KHOA_GIONG_STOP,
        results: [
          { tagKey: "a", ok: false, status: "rejected" },
          { tagKey: "t", ok: false, status: "rejected" },
        ],
      });
      expect(d.soGhi).toBe(0);
      const hang = await hangCua(tx, r);
      expect(hang).toHaveLength(2);
      for (const h of hang) {
        expect(h.status).toBe("rejected");
        expect(h.idempotencyKey).toBeNull();
        expect(String(h.errorText).startsWith(`${MA_THIEU_KHOA_GIONG_STOP}: idempotency key required for a non-STOP command — not sent`)).toBe(true);
        expect(canhBaoHang(h)).toMatchObject({ lanThu: 1, daPhat: true });
      }
      expect((await moiHangAdapter(tx, ad)).length).toBe(2); // không ý định
      await vi.waitFor(() => expect(canhBaoKhongKhoa()).toHaveLength(1), { timeout: 3000 });
      await lang();
      const cb = canhBaoKhongKhoa();
      expect(cb).toHaveLength(1);
      expect(cb[0]!.kind).toBe("ot_keyless_stop_like_refused");
      expect(cb[0]!.title).toBe(`Keyless OT command refused (not sent) — adapter ${ad}`); // fix round 1 F3
      expect(cb[0]!.message).toMatch(/NOT sent/);
      expect(cb[0]!.message).toMatch(/HMI machine stop/);
      expect(cb[0]!.message).toMatch(/idempotency key/);
      expect([...cb[0]!.recipients].sort()).toEqual([OWNER, KHAC].sort());
      expect(cb[0]!.dedupKey).toContain(canhBaoHang(hang[0]!)!.khoa);
      // một write vào tag ghim với giá trị KHÁC ghim (không phải STOP) ⇒ cũng STOP_LIKE
      const r2 = await gui(tx, ad, [{ tagKey: "b", value: 7 }], KHONG_TRUYEN);
      expect(r2.reason).toBe(MA_THIEU_KHOA_GIONG_STOP);
      expect(d.soGhi).toBe(0);
    });
  }, 30_000);

  it("★ (d) KHÔNG đọc được ghim (loadStopPins ném) + STOP theo nội dung không khoá ⇒ PIN_UNREADABLE, 0 gói, hàng rejected (canhBao), cảnh báo ot_keyless_pin_unreadable_refused", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const actionId = await taoHanhDong(tx, ad, [{ tagKey: "a", value: 0 }]);
      _setPinReadProbeForTests((id) => {
        if (id === ad) throw new Error("pin read down (test)");
      });
      const r = await gui(tx, ad, [{ tagKey: "a", value: 0 }], "", { actionId });
      _setPinReadProbeForTests(null);
      expect(chieu(r)).toEqual({ ok: false, simulated: false, status: "rejected", reason: MA_THIEU_KHOA_GHIM_LOI_DOC, results: [{ tagKey: "a", ok: false, status: "rejected" }] });
      expect(d.soGhi).toBe(0);
      const hang = await hangCua(tx, r);
      expect(hang).toHaveLength(1);
      expect(hang[0]!.idempotencyKey).toBeNull();
      expect(String(hang[0]!.errorText).startsWith(`${MA_THIEU_KHOA_GHIM_LOI_DOC}: `)).toBe(true);
      expect(canhBaoHang(hang[0]!)).toMatchObject({ lanThu: 1, daPhat: true });
      await vi.waitFor(() => expect(canhBaoKhongKhoa()).toHaveLength(1), { timeout: 3000 });
      const cb = canhBaoKhongKhoa()[0]!;
      expect(cb.kind).toBe("ot_keyless_pin_unreadable_refused");
      expect(cb.title).toBe(`Keyless OT command refused (not sent) — adapter ${ad}`); // fix round 1 F3
      expect(cb.message).toMatch(/NOT sent/);
      expect(cb.message).toMatch(/HMI machine stop/);
    });
  }, 30_000);

  it("(e) đối chứng: ghim KHÔNG đọc được, CÙNG lệnh CÓ khoá ⇒ đúng hành vi của main 0211196f6 (A2(a) không đổi đường có khoá)", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const actionId = await taoHanhDong(tx, ad, [{ tagKey: "a", value: 0 }]);
      _setPinReadProbeForTests((id) => {
        if (id === ad) throw new Error("pin read down (test)");
      });
      const r = await gui(tx, ad, [{ tagKey: "a", value: 0 }], `K-${randomUUID()}`, { actionId });
      _setPinReadProbeForTests(null);
      expect({ ...chieu(r), soGhi: d.soGhi }).toEqual(E_MAIN);
    });
    await lang();
    expect(canhBaoKhongKhoa()).toEqual([]);
  }, 30_000);

  it("★ (f) lệnh thường không khoá (không tag ghim nào) ⇒ IDEMPOTENCY_KEY_REQUIRED, KHÔNG cảnh báo, hàng không mang canhBao", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const r = await gui(tx, ad, [{ tagKey: "t", value: 3 }], "");
      expect(r).toMatchObject({ ok: false, status: "rejected", reason: MA_THIEU_KHOA });
      expect(d.soGhi).toBe(0);
      expect(canhBaoHang((await hangCua(tx, r))[0]!)).toBeUndefined();
    });
    await lang(80);
    expect(canhBaoKhongKhoa()).toEqual([]);
  }, 30_000);

  it("★ KHỬ TRÙNG (AMENDMENT 1): 10 lần STOP_LIKE giống hệt, được uỷ quyền ⇒ ĐÚNG 1 cảnh báo, 10 lần từ chối đều có hàng; hàng thứ 10 lanThu 10, daPhat false", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const writes = [{ tagKey: "a", value: 0 }, { tagKey: "t", value: 1 }];
      const actionId = await taoHanhDong(tx, ad, writes);
      const kq: DispatchResult[] = [];
      for (let i = 0; i < 10; i++) kq.push(await gui(tx, ad, writes, "", { actionId }));
      expect(kq.every((r) => r.reason === MA_THIEU_KHOA_GIONG_STOP)).toBe(true);
      expect(d.soGhi).toBe(0);
      const cuaTung = await Promise.all(kq.map((r) => hangCua(tx, r)));
      expect(cuaTung.every((h) => h.length === 2)).toBe(true);
      expect((await moiHangAdapter(tx, ad)).length).toBe(20);
      expect(canhBaoHang(cuaTung[0]![0]!)).toMatchObject({ lanThu: 1, daPhat: true });
      const thu10 = canhBaoHang(cuaTung[9]![0]!)!;
      expect(thu10).toMatchObject({ lanThu: 10, daPhat: false });
      expect(thu10.khoa).toBe(canhBaoHang(cuaTung[0]![0]!)!.khoa);
      await vi.waitFor(() => expect(canhBaoKhongKhoa().length).toBeGreaterThanOrEqual(1), { timeout: 3000 });
      await lang(80);
      expect(canhBaoKhongKhoa()).toHaveLength(1);
    });
  }, 60_000);

  it("★ KHỬ TRÙNG: NGƯỜI YÊU CẦU khác (cùng adapter, cùng tập tag, cùng cửa sổ) ⇒ cảnh báo THỨ HAI; tập tag khác ⇒ thứ ba", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const writes = [{ tagKey: "a", value: 0 }, { tagKey: "t", value: 1 }];
      const actionId = await taoHanhDong(tx, ad, writes);
      const r1 = await gui(tx, ad, writes, "", { actionId, requestedBy: OWNER });
      const r2 = await gui(tx, ad, writes, "", { actionId, requestedBy: KHAC });
      expect([r1.reason, r2.reason]).toEqual([MA_THIEU_KHOA_GIONG_STOP, MA_THIEU_KHOA_GIONG_STOP]);
      await vi.waitFor(() => expect(canhBaoKhongKhoa()).toHaveLength(2), { timeout: 3000 });
      expect(canhBaoHang((await hangCua(tx, r2))[0]!)).toMatchObject({ lanThu: 1, daPhat: true });
      const r3 = await gui(tx, ad, [{ tagKey: "b", value: 0 }, { tagKey: "u", value: 1 }], "", { requestedBy: OWNER });
      expect(r3.reason).toBe(MA_THIEU_KHOA_GIONG_STOP);
      await vi.waitFor(() => expect(canhBaoKhongKhoa()).toHaveLength(3), { timeout: 3000 });
      expect(new Set(canhBaoKhongKhoa().map((c) => c.dedupKey)).size).toBe(3);
    });
  }, 30_000);

  it("★ TRÀN (AMENDMENT 2): bảng đầy (trần hạ xuống 2) rồi 3 bộ MỚI khác nhau trong cùng cửa sổ ⇒ ĐÚNG 1 cảnh báo tràn (nêu số lần tràn), mỗi lần từ chối vẫn có hàng (canhBao.khoa = `__tran__`)", async () => {
    __datLaiCanhBaoKhongKhoaChoTest(2);
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const writes = [{ tagKey: "a", value: 0 }, { tagKey: "t", value: 1 }];
      const actionId = await taoHanhDong(tx, ad, writes);
      const nguoi = [OWNER, KHAC, 990_908_103, 990_908_104, 990_908_105];
      const kq: DispatchResult[] = [];
      for (const n of nguoi) kq.push(await gui(tx, ad, writes, "", { actionId, requestedBy: n }));
      expect(kq.every((r) => r.reason === MA_THIEU_KHOA_GIONG_STOP)).toBe(true);
      expect(d.soGhi).toBe(0);
      const cb = await Promise.all(kq.map(async (r) => canhBaoHang((await hangCua(tx, r))[0]!)!));
      expect(cb.slice(0, 2).map((c) => c.daPhat)).toEqual([true, true]);
      expect(cb.slice(2).map((c) => ({ khoa: c.khoa, lanThu: c.lanThu, daPhat: c.daPhat }))).toEqual([
        { khoa: "__tran__", lanThu: 1, daPhat: true },
        { khoa: "__tran__", lanThu: 2, daPhat: false },
        { khoa: "__tran__", lanThu: 3, daPhat: false },
      ]);
      expect((await moiHangAdapter(tx, ad)).length).toBe(10);
      await vi.waitFor(() => expect(canhBaoKhongKhoa().length).toBeGreaterThanOrEqual(3), { timeout: 3000 });
      await lang(80);
      const tatCa = canhBaoKhongKhoa();
      expect(tatCa).toHaveLength(3); // 2 bộ trong bảng + ĐÚNG 1 cảnh báo tràn
      const tran = tatCa.filter((c) => c.dedupKey.includes("__tran__"));
      expect(tran).toHaveLength(1);
      expect(tran[0]!.message).toMatch(/overflow/i);
      expect(tran[0]!.message).toMatch(/#1\b/);
      expect(tran[0]!.message).toMatch(/canhBao\.lanThu/); // F5: số lần sau lần #1 nằm ở canhBao.lanThu của hàng sổ
    });
  }, 60_000);

  it("interlock không khoá: lệnh bảo vệ thường (reduce_speed, tag thường) được uỷ quyền ⇒ IDEMPOTENCY_KEY_REQUIRED, 0 gói; STOP theo nội dung (stop_line = tag ghim + ghim) ⇒ BAY", async () => {
    await trongGiaoDich(async (tx) => {
      process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const luat = async (action: "reduce_speed" | "stop_line", commandTag: string, commandValue: number) => {
        const [rule] = await tx
          .insert(interlockRules)
          .values({ name: `${DAU} rule ${action}`, scope: "machine", machineId: MACHINE, sourceType: "ng_rate", comparisonOperator: "gt", threshold: "99999", action, targetMachineId: MACHINE, targetAdapterId: ad, commandTag, commandValue: commandValue as never, requiresHumanConfirm: false, enabled: true, approvedBy: OWNER, approvedAt: new Date() })
          .returning();
        await dongDauDuyetLuat(rule!.id);
        return async () => {
          const [ev] = await tx.insert(interlockEvents).values({ ruleId: rule!.id, action, status: "fired" }).returning();
          return dispatch(lenh(ad, [{ tagKey: commandTag, value: commandValue }], "", action, { kind: "interlock", ruleId: rule!.id, eventId: ev!.id, approvedBy: OWNER }));
        };
      };
      const giam = await luat("reduce_speed", "t", 30);
      expect(await giam()).toMatchObject({ ok: false, status: "rejected", reason: MA_THIEU_KHOA });
      expect(d.soGhi).toBe(0);
      const dung = await luat("stop_line", "a", 0);
      expect(await dung()).toMatchObject({ ok: true, simulated: false, status: "acked" });
      expect(d.soGhi).toBe(1);
    });
  }, 30_000);
  // ── A2(a) fix round 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  it("★ F1 lời từ chối ở cổng uỷ quyền của lệnh KHÔNG khoá: HAI adapter cùng tag + CÙNG adapter lần hai (HITL NOT_CONFIRMED / requireBoundAction PRECONDITION_FAILED / interlock tắt) ⇒ đúng lời từ chối uỷ quyền, KHÔNG ném; mọi hàng khoá NULL", async () => {
    await trongGiaoDich(async (tx) => {
      const ad1 = await taoAdapter(tx, driverGia());
      const ad2 = await taoAdapter(tx, driverGia());
      const ids: number[] = [];
      for (const ad of [ad1, ad2, ad1]) {
        for (const [ct, writes] of [
          ["stop", [{ tagKey: "a", value: 0 }]],
          ["set_param", [{ tagKey: "a", value: 0 }, { tagKey: "t", value: 1 }]],
        ] as Array<[string, Array<{ tagKey: string; value: unknown }>]>) {
          const r1 = await gui(tx, ad, writes, "", { commandType: ct, actionId: `${DAU}-khong-co` });
          expect(r1).toMatchObject({ ok: false, status: "rejected", reason: "NOT_CONFIRMED" });
          const r2 = await dispatch(lenh(ad, writes, KHONG_TRUYEN, ct, { kind: "hitl", tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER, requireBoundAction: true }));
          expect(r2).toMatchObject({ ok: false, status: "rejected", reason: "PRECONDITION_FAILED" });
          const r3 = await dispatch(lenh(ad, [writes[0]!], "", "stop_line", { kind: "interlock", ruleId: 1, eventId: 1, approvedBy: OWNER }));
          expect(r3).toMatchObject({ ok: false, status: "rejected", reason: "INTERLOCK_AUTO_BLOCK_DISABLED" });
          ids.push(...r1.commandLogIds, ...r2.commandLogIds, ...r3.commandLogIds);
        }
      }
      const hang = await tx.select().from(commandLog).where(inArray(commandLog.id, ids));
      expect(hang).toHaveLength(ids.length);
      expect(hang.every((h) => h.idempotencyKey === null && h.status === "rejected")).toBe(true);
      expect(hang.filter((h) => /^IDEMPOTENCY_KEY_REQUIRED/.test(String(h.errorText)))).toEqual([]);
    });
    await lang();
    expect(canhBaoKhongKhoa()).toEqual([]);
  }, 60_000);

  it("★ F1 STOP không khoá bị từ chối SAU (tag thiếu / tag không ghi được / adapter tắt) trên HAI adapter cùng tag, mỗi cái HAI lần ⇒ đúng mã, không ném, hàng khoá NULL", async () => {
    await trongGiaoDich(async (tx) => {
      const ad1 = await taoAdapter(tx, driverGia());
      const ad2 = await taoAdapter(tx, driverGia());
      await tx.insert(deviceTags).values([
        { adapterId: ad1, tagKey: "ro", address: "40009", dataType: "int", writable: false },
        { adapterId: ad2, tagKey: "ro", address: "40009", dataType: "int", writable: false },
      ]);
      const ids: number[] = [];
      for (const ad of [ad1, ad2, ad1, ad2]) {
        const thieu = await gui(tx, ad, [{ tagKey: "khong-co", value: 0 }], "", { commandType: "stop" });
        expect(thieu).toMatchObject({ ok: false, reason: "TAG_NOT_FOUND" });
        const ro = await gui(tx, ad, [{ tagKey: "ro", value: 0 }], KHONG_TRUYEN, { commandType: "stop" });
        expect(ro).toMatchObject({ ok: false, reason: "TAG_NOT_WRITABLE" });
        ids.push(...thieu.commandLogIds, ...ro.commandLogIds);
      }
      await tx.update(deviceAdapters).set({ isEnabled: false }).where(inArray(deviceAdapters.id, [ad1, ad2]));
      for (const ad of [ad1, ad2, ad1, ad2]) {
        const tat = await gui(tx, ad, [{ tagKey: "a", value: 0 }], "", { commandType: "stop" });
        expect(tat).toMatchObject({ ok: false, reason: "ADAPTER_DISABLED" });
        ids.push(...tat.commandLogIds);
      }
      const hang = await tx.select().from(commandLog).where(inArray(commandLog.id, ids));
      expect(hang).toHaveLength(ids.length);
      expect(hang.map((h) => h.idempotencyKey)).toEqual(hang.map(() => null));
    });
  }, 60_000);

  it("★ F1 BẢNG THẬT: UNIQUE command_log_idempotencyKey_unique KHÔNG đặt NULLS NOT DISTINCT (nhiều NULL hợp lệ), hai lời từ chối không khoá cùng tag ⇒ hai hàng NULL; sau đó lệnh CÓ khoá trên CÙNG tag bay bình thường (+1 gói, hàng mới, không phát lại, không IDEMPOTENCY_KEY_REUSED)", async () => {
    await trongGiaoDich(async (tx) => {
      const [chiMuc] = (await tx.execute(
        sql`SELECT i.indisunique AS "duyNhat", i.indnullsnotdistinct AS "nullKhongPhanBiet", pg_get_indexdef(i.indexrelid) AS "dinhNghia" FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'command_log_idempotencyKey_unique'`,
      )) as unknown as Array<{ duyNhat: boolean; nullKhongPhanBiet: boolean; dinhNghia: string }>;
      expect(chiMuc).toBeDefined();
      expect(chiMuc!.duyNhat).toBe(true);
      expect(chiMuc!.nullKhongPhanBiet).toBe(false);
      expect(chiMuc!.dinhNghia).toMatch(/UNIQUE INDEX .*\("idempotencyKey"\)/);
      expect(chiMuc!.dinhNghia).not.toMatch(/NULLS NOT DISTINCT/i);
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const r1 = await gui(tx, ad, [{ tagKey: "t", value: 1 }], "", { actionId: `${DAU}-khong-co` });
      const r2 = await gui(tx, ad, [{ tagKey: "t", value: 1 }], "", { actionId: `${DAU}-khong-co-2` });
      const r3 = await gui(tx, ad, [{ tagKey: "t", value: 1 }], KHONG_TRUYEN);
      expect([r1.reason, r2.reason, r3.reason]).toEqual(["NOT_CONFIRMED", "NOT_CONFIRMED", MA_THIEU_KHOA]);
      const cu = [...r1.commandLogIds, ...r2.commandLogIds, ...r3.commandLogIds];
      const hangNull = await tx.select().from(commandLog).where(inArray(commandLog.id, cu));
      expect(hangNull.map((h) => h.idempotencyKey)).toEqual([null, null, null]);
      const k = await gui(tx, ad, [{ tagKey: "t", value: 1 }], `K-${randomUUID()}`);
      expect(k).toMatchObject({ ok: true, simulated: false, status: "acked" });
      expect(k.reason ?? null).toBeNull();
      expect(d.soGhi).toBe(1);
      expect(k.commandLogIds.some((id) => cu.includes(id))).toBe(false);
    });
  }, 30_000);

  it("★ F1 hàng MÔ PHỎNG của STOP không khoá (OT_CONTROL_ENABLED=false) trên HAI adapter cùng tag ⇒ không ném, hàng khoá NULL", async () => {
    await trongGiaoDich(async (tx) => {
      process.env.OT_CONTROL_ENABLED = "false";
      const ad1 = await taoAdapter(tx, driverGia());
      const ad2 = await taoAdapter(tx, driverGia());
      const ids: number[] = [];
      for (const ad of [ad1, ad2, ad1]) {
        const r = await gui(tx, ad, [{ tagKey: "a", value: 0 }], "", { commandType: "stop" });
        expect(r).toMatchObject({ ok: true, simulated: true, status: "simulated" });
        ids.push(...r.commandLogIds);
      }
      const hang = await tx.select().from(commandLog).where(inArray(commandLog.id, ids));
      expect(hang.map((h) => h.idempotencyKey)).toEqual([null, null, null]);
    });
  }, 30_000);

  it("★ F2 STOP_LIKE không khoá từ HITL KHÔNG actionId (cổng (1) không kiểm gì) ⇒ vẫn từ chối + hàng, KHÔNG cảnh báo, canhBao.boQua = khong_rang_buoc, KHÔNG chạm cửa sổ; cùng bộ được uỷ quyền + ghi thật ⇒ cảnh báo lần 1", async () => {
    await trongGiaoDich(async (tx) => {
      const ad = await taoAdapter(tx, driverGia());
      const writes = [{ tagKey: "a", value: 0 }, { tagKey: "t", value: 1 }];
      const r = await gui(tx, ad, writes, "", { actionId: null });
      expect(r).toMatchObject({ ok: false, status: "rejected", reason: MA_THIEU_KHOA_GIONG_STOP });
      const h = await hangCua(tx, r);
      expect(h).toHaveLength(2);
      expect(canhBaoHang(h[0]!)).toMatchObject({ daPhat: false, boQua: "khong_rang_buoc", lanThu: 0 });
      await lang(80);
      expect(canhBaoKhongKhoa()).toEqual([]);
      const r2 = await gui(tx, ad, writes, "");
      expect(r2.reason).toBe(MA_THIEU_KHOA_GIONG_STOP);
      const h2 = await hangCua(tx, r2);
      expect(canhBaoHang(h2[0]!)).toMatchObject({ daPhat: true, lanThu: 1 });
      expect((canhBaoHang(h2[0]!) as { boQua?: unknown }).boQua).toBeUndefined();
      await vi.waitFor(() => expect(canhBaoKhongKhoa()).toHaveLength(1), { timeout: 3000 });
    });
  }, 30_000);

  it("★ F2 STOP_LIKE / PIN_UNREADABLE không khoá khi CHẠY THỬ (OT_CONTROL_ENABLED=false — cùng vị từ bước 5) dù có uỷ quyền ⇒ hàng, KHÔNG cảnh báo, canhBao.boQua = chay_thu", async () => {
    await trongGiaoDich(async (tx) => {
      process.env.OT_CONTROL_ENABLED = "false";
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const r = await gui(tx, ad, [{ tagKey: "a", value: 0 }, { tagKey: "t", value: 1 }], "");
      expect(r.reason).toBe(MA_THIEU_KHOA_GIONG_STOP);
      expect(canhBaoHang((await hangCua(tx, r))[0]!)).toMatchObject({ daPhat: false, boQua: "chay_thu", lanThu: 0 });
      const actionId = await taoHanhDong(tx, ad, [{ tagKey: "a", value: 0 }]);
      _setPinReadProbeForTests((id) => {
        if (id === ad) throw new Error("pin read down (test)");
      });
      const r2 = await gui(tx, ad, [{ tagKey: "a", value: 0 }], "", { actionId });
      _setPinReadProbeForTests(null);
      expect(r2.reason).toBe(MA_THIEU_KHOA_GHIM_LOI_DOC);
      expect(canhBaoHang((await hangCua(tx, r2))[0]!)).toMatchObject({ daPhat: false, boQua: "chay_thu" });
      expect(d.soGhi).toBe(0);
    });
    await lang(80);
    expect(canhBaoKhongKhoa()).toEqual([]);
  }, 30_000);

  it("★ F5 chèn sổ của lời từ chối STOP_LIKE LỖI (CSDL từ chối NUL trong jsonb) ⇒ dispatch ném như mọi lỗi sổ, NHƯNG cảnh báo khẩn VẪN phát (đếm trước, phát trong finally) và nói hàng sổ không ghi được", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const writes = [{ tagKey: "a", value: "x\u0000y" }];
      const actionId = await taoHanhDong(tx, ad, writes);
      await expect(gui(tx, ad, writes, "", { actionId })).rejects.toThrow();
      expect(d.soGhi).toBe(0);
      await vi.waitFor(() => expect(canhBaoKhongKhoa()).toHaveLength(1), { timeout: 3000 });
      const cb = canhBaoKhongKhoa()[0]!;
      expect(cb.kind).toBe("ot_keyless_stop_like_refused");
      expect(cb.message).toMatch(/could NOT be written to command_log/);
      expect(cb.message).toMatch(/NOT sent/);
    });
  }, 30_000);
});

/** (e) — kết quả ĐO trên main 0211196f6 trước khi sửa (2026-11-02, tệp tạm chạy riêng ca (e)): STOP theo nội dung CÓ khoá, ghim lỗi đọc ⇒ acked, 1 gói. */
const E_MAIN = { ok: true, simulated: false, status: "acked", reason: null, results: [{ tagKey: "a", ok: true, status: "acked" }], soGhi: 1 };
