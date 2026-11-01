/**
 * SCADA R1b-2b-2a T6c (AN TOÀN, dieu-phoi 2026-11-01) — phát lại theo khoá idempotency PHẢI bằng câu trả lời sống.
 *
 * Trước T6c: phát lại (`cachedResult`) chỉ đọc HÀNG 0 của lô ⇒ lô `timeout` trộn có hàng 0 acked được phát lại là `ok: true` — THÀNH CÔNG giả cho một
 * lô mà câu trả lời sống là "không rõ" (cùng hạng lỗi T2 / T3F). Sau T6c: kết cục phát lại tính trên MỌI hàng kết quả của lô bằng `ketCucLo` (cùng hàm
 * với đường sống), có dấu `ackValue.khongRo` trên mọi hàng của lô `timeout`; hàng cũ không dấu ⇒ fail-closed.
 *
 * DB THẬT (`_test`, ép bởi vitest.setup): dispatcher THẬT + driver GIẢ theo kịch bản (kết quả theo từng write như driver thật trả), `getActiveDriver`
 * trỏ vào driver giả. Mọi ghi DB nằm trong giao dịch ROLLBACK của chính test (ngoài giao dịch getDb là BẪY). Bảng WORM command_log: không id tường minh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { like } from "drizzle-orm";

const H = vi.hoisted(() => ({
  tx: null as unknown,
  bay: 0,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
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
    listPlcConfigs: async () => [{ code: "T6C-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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

import * as conn from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";
import { dispatch, type DispatchResult } from "./commandDispatcher";
import { equipmentRegistry } from "../equipment/equipmentAdapter";
import { ketCucLenhFoe, khongGuiLaiMotPhan } from "../orchestration/foe/foeEngine";
import { LOI_CHUA_GUI_MAT_LIEN_KET } from "./drivers/dangBay";
import type { OtCommandResult, OtWrite } from "./otDriver";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T6C-${Date.now()}`;
const OWNER = 990_906_101;
const MACHINE = 990_906_001;
const TOOL = "set_machine_param";
const ROLLBACK = Symbol("rollback");
const ENDPOINT = "tcp://192.0.2.66:502";
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
const QUA_HAN: KichBan = (w) => ({ tagKey: w.tagKey, ok: false, error: "Timed out", ketCucKhongRo: "qua_han_driver" });
const MAT_LIEN_KET: KichBan = (w) => ({ tagKey: w.tagKey, ok: false, error: "modbus link lost while a request was in flight (socket close) — outcome unknown", ketCucKhongRo: "mat_lien_ket" });
const CHUA_GUI: KichBan = (w) => ({ tagKey: w.tagKey, ok: false, error: LOI_CHUA_GUI_MAT_LIEN_KET });
const HONG: KichBan = (w) => ({ tagKey: w.tagKey, ok: false, error: "modbus exception 2 (illegal data address)" });

/** Driver giả: write i ⇒ kichBan[i]; đếm số lời gọi writeTags (phát lại KHÔNG được gọi lại thiết bị). */
function driverGia(kichBan: KichBan[]) {
  const d = {
    protocol: "modbus",
    soGhi: 0,
    isConnected: () => true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    health: async () => ({ protocol: "modbus", connected: true }),
    writeTags: async (ws: OtWrite[]) => {
      d.soGhi += 1;
      return ws.map((w, i) => kichBan[i]!(w));
    },
    readTags: async () => [],
  };
  return d;
}

/**
 * adapter modbus + tag a/b/c + uỷ quyền HITL gắn đúng lệnh — TRONG giao dịch. Polish m2: `isEnabled` (ADAPTER_DISABLED), `commandType` (STOP ghim),
 * tag `a` có `stopValue` 0 (giá trị ghim), `driver: null` ⇒ không driver nào chạy cho adapter (ADAPTER_OFFLINE).
 */
async function dung(tx: Tx, writes: Array<{ tagKey: string; value: unknown }>, driver: unknown, tc: { isEnabled?: boolean; commandType?: string } = {}) {
  const [a] = await tx.insert(deviceAdapters).values({ code: `${DAU}-A-${Math.random().toString(36).slice(2, 8)}`, name: `${DAU} adapter`, protocol: "modbus", endpoint: ENDPOINT, isEnabled: tc.isEnabled ?? true, machineId: MACHINE }).returning();
  const adapterId = a!.id;
  await tx.insert(deviceTags).values([
    { adapterId, tagKey: "a", address: "40001", dataType: "int", writable: true, stopValue: 0 as never },
    { adapterId, tagKey: "b", address: "40002", dataType: "int", writable: true },
    { adapterId, tagKey: "c", address: "40003", dataType: "int", writable: true },
  ]);
  if (driver !== null) H.drivers.set(adapterId, driver);
  H.fingerprints.set(adapterId, adapterTargetFingerprint({ protocol: "modbus", endpoint: ENDPOINT, machineId: MACHINE, connectionOptions: null }));
  const actionId = `${DAU}-act-${Math.random().toString(36).slice(2, 10)}`;
  await tx.insert(aiPendingActions).values({
    id: actionId,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} test action`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId, machineId: MACHINE, commandType: tc.commandType ?? "set_param", writes })),
    status: "confirmed",
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return { adapterId, actionId };
}

const lenh = (adapterId: number, actionId: string, writes: Array<{ tagKey: string; value: unknown }>, key: string, commandType = "set_param") => ({
  adapterId,
  machineId: MACHINE,
  commandType,
  writes,
  triggeredBy: { kind: "hitl" as const, actionId, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER },
  idempotencyKey: key,
});

/** Phần câu trả lời mà phát lại PHẢI bằng đường sống. */
const chieu = (r: DispatchResult) => ({
  ok: r.ok,
  simulated: r.simulated,
  status: r.status,
  reason: r.reason ?? null,
  motPhan: r.motPhan ?? null,
  pinnedStop: r.pinnedStop === true, // polish m2 — STOP ghim phát lại vẫn nói là STOP ghim
  results: r.results.map((x) => ({ tagKey: x.tagKey, ok: x.ok, status: x.status })),
});

const ENV_KEYS = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("T6c — phát lại theo khoá idempotency = câu trả lời sống (DB thật, giao dịch ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
  }, 60_000);

  afterAll(() => {
    H.drivers.clear();
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
  });

  const MA_TRAN: Array<{ ten: string; kb: KichBan[]; mong: { ok: boolean; status: string; motPhan?: boolean } }> = [
    { ten: "K1 [acked, acked, acked]", kb: [ACK, ACK, ACK], mong: { ok: true, status: "acked" } },
    { ten: "★ K2 [acked, qua_han, acked] — hàng 0 acked, lô timeout", kb: [ACK, QUA_HAN, ACK], mong: { ok: false, status: "timeout" } },
    { ten: "★ K3 [acked, mat_lien_ket, chưa gửi] — T6", kb: [ACK, MAT_LIEN_KET, CHUA_GUI], mong: { ok: false, status: "timeout" } },
    { ten: "K4 [qua_han, acked, acked] — hàng 0 timeout", kb: [QUA_HAN, ACK, ACK], mong: { ok: false, status: "timeout" } },
    { ten: "K5 [acked, failed, failed] — MOT_PHAN", kb: [ACK, HONG, HONG], mong: { ok: false, status: "failed", motPhan: true } },
    { ten: "K6 [failed, failed, failed]", kb: [HONG, HONG, HONG], mong: { ok: false, status: "failed" } },
    { ten: "K7 [acked, failed, qua_han] — không rõ thắng một phần", kb: [ACK, HONG, QUA_HAN], mong: { ok: false, status: "timeout" } },
  ];

  for (const ca of MA_TRAN) {
    it(`${ca.ten} ⇒ phát lại deepEqual câu trả lời sống; thiết bị KHÔNG bị ghi lần hai; lô timeout ⇒ ackValue.khongRo trên MỌI hàng`, async () => {
      await trongGiaoDich(async (tx) => {
        const writes = [{ tagKey: "a", value: 1 }, { tagKey: "b", value: 2 }, { tagKey: "c", value: 3 }];
        const d = driverGia(ca.kb);
        const { adapterId, actionId } = await dung(tx, writes, d);
        const key = `${DAU}-${ca.ten.replace(/\W+/g, "").slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}`;
        const song = await dispatch(lenh(adapterId, actionId, writes, key));
        expect(song).toMatchObject({ ok: ca.mong.ok, status: ca.mong.status });
        expect(!!song.motPhan).toBe(!!ca.mong.motPhan);
        const phatLai = await dispatch(lenh(adapterId, actionId, writes, key));
        expect(d.soGhi).toBe(1); // phát lại không ghi thiết bị
        expect(chieu(phatLai)).toEqual(chieu(song));
        const hang = (await tx.select().from(commandLog).where(like(commandLog.idempotencyKey, `${key}:%`))).filter((r) => (r.ackValue as { ledger?: unknown } | null)?.ledger === "result");
        expect(hang).toHaveLength(3);
        for (const r of hang) expect((r.ackValue as { khongRo?: unknown }).khongRo === true).toBe(ca.mong.status === "timeout");
      });
      expect(H.bay).toBe(0);
    }, 30_000);
  }

  it("1 write [qua_han] ⇒ phát lại = sống (timeout), dấu khongRo", async () => {
    await trongGiaoDich(async (tx) => {
      const writes = [{ tagKey: "a", value: 1 }];
      const d = driverGia([QUA_HAN]);
      const { adapterId, actionId } = await dung(tx, writes, d);
      const key = `${DAU}-don-${Math.random().toString(36).slice(2, 8)}`;
      const song = await dispatch(lenh(adapterId, actionId, writes, key));
      const phatLai = await dispatch(lenh(adapterId, actionId, writes, key));
      expect(song.status).toBe("timeout");
      expect(chieu(phatLai)).toEqual(chieu(song));
      expect(d.soGhi).toBe(1);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  /** Hàng kết quả ghi TRƯỚC bản vá (không dấu `khongRo`): chèn trực tiếp (KHÔNG id tường minh) rồi phát lại bằng khoá ấy. */
  async function chenHangCu(tx: Tx, adapterId: number, actionId: string, key: string, hang: Array<{ tagKey: string; status: "acked" | "timeout" | "failed" | "acked_verified"; khongRo?: boolean } | null>) {
    const addr: Record<string, string> = { a: "40001", b: "40002", c: "40003" };
    for (const [i, h] of hang.entries()) {
      if (!h) continue; // hàng THIẾU (L3)
      // literal TẠI CHỖ, không spread: census wormIdTuongMinh thấy được là không có `id`
      await tx.insert(commandLog).values({
        actionId,
        adapterId,
        machineId: MACHINE,
        tagKey: h.tagKey,
        address: addr[h.tagKey]!,
        commandType: "set_param",
        requestedValue: i + 1,
        requestedBy: OWNER,
        confirmedBy: OWNER,
        status: h.status,
        errorText: h.status === "acked" || h.status === "acked_verified" ? null : h.status === "timeout" ? "Timed out — outcome unknown: the write may have been applied on the device" : "modbus exception 2",
        ackValue: h.khongRo ? { ledger: "result", khongRo: true } : { ledger: "result" },
        idempotencyKey: `${key}:${h.tagKey}:${i}`,
        sentAt: new Date(),
      });
    }
  }

  const CU: Array<{ ten: string; hang: Parameters<typeof chenHangCu>[4]; mong: { ok: false; status: string; reason?: string; motPhan?: { daAp: string[]; khongAp: string[] } } }> = [
    { ten: "★ L1 hàng cũ [acked, timeout] không dấu", hang: [{ tagKey: "a", status: "acked" }, { tagKey: "b", status: "timeout" }], mong: { ok: false, status: "timeout" } },
    { ten: "L2 hàng cũ [acked, failed] không dấu motPhan", hang: [{ tagKey: "a", status: "acked" }, { tagKey: "b", status: "failed" }], mong: { ok: false, status: "failed", reason: "MOT_PHAN", motPhan: { daAp: ["a"], khongAp: ["b"] } } }, // polish m2: khẳng định reason + motPhan
    { ten: "L3 hàng cũ [acked, (THIẾU hàng 1)]", hang: [{ tagKey: "a", status: "acked" }, null], mong: { ok: false, status: "timeout" } },
    { ten: "L4 dấu khongRo trên hàng acked (dấu thắng)", hang: [{ tagKey: "a", status: "acked", khongRo: true }, { tagKey: "b", status: "acked_verified", khongRo: true }], mong: { ok: false, status: "timeout" } },
  ];
  for (const ca of CU) {
    it(`${ca.ten} ⇒ phát lại fail-closed: KHÔNG ok, status ${ca.mong.status}; thiết bị không bị ghi`, async () => {
      await trongGiaoDich(async (tx) => {
        const writes = [{ tagKey: "a", value: 1 }, { tagKey: "b", value: 2 }];
        const d = driverGia([ACK, ACK]);
        const { adapterId, actionId } = await dung(tx, writes, d);
        const key = `${DAU}-cu-${Math.random().toString(36).slice(2, 8)}`;
        await chenHangCu(tx, adapterId, actionId, key, ca.hang);
        const phatLai = await dispatch(lenh(adapterId, actionId, writes, key));
        expect(d.soGhi).toBe(0);
        expect(phatLai.ok).toBe(false);
        expect(phatLai.status).toBe(ca.mong.status);
        if (ca.mong.reason) expect(phatLai.reason).toBe(ca.mong.reason);
        if (ca.mong.motPhan) expect(phatLai.motPhan).toEqual(ca.mong.motPhan);
      });
      expect(H.bay).toBe(0);
    }, 30_000);
  }

  /**
   * T6c polish 2 (re-review Important) — hàng CŨ ghi TRƯỚC sổ ghi trước: KHÔNG `ackValue` (không `ledger`). Chèn literal tại chỗ (KHÔNG id tường minh, bảng WORM),
   * trong giao dịch ROLLBACK của test. `null` ⇒ write ấy KHÔNG có hàng.
   */
  async function chenHangTruocLedger(tx: Tx, adapterId: number, actionId: string, key: string, hang: Array<{ tagKey: string; status: "acked" | "failed" | "simulated"; errorText?: string } | null>) {
    const addr: Record<string, string> = { a: "40001", b: "40002", c: "40003" };
    for (const [i, h] of hang.entries()) {
      if (!h) continue; // hàng THIẾU
      await tx.insert(commandLog).values({
        actionId,
        adapterId,
        machineId: MACHINE,
        tagKey: h.tagKey,
        address: addr[h.tagKey]!,
        commandType: "set_param",
        requestedValue: i + 1,
        requestedBy: OWNER,
        confirmedBy: OWNER,
        status: h.status,
        errorText: h.errorText ?? (h.status === "failed" ? "modbus exception 2" : null),
        idempotencyKey: `${key}:${h.tagKey}:${i}`,
        sentAt: h.status === "acked" ? new Date() : null,
      });
    }
  }

  const TRUOC_LEDGER: Array<{ ten: string; hang: Parameters<typeof chenHangTruocLedger>[4]; mong: { ok: boolean; status: string; reason?: string; motPhan?: { daAp: string[]; khongAp: string[] } } }> = [
    { ten: "★ N1 trước ledger [acked, (THIẾU hàng 1)]", hang: [{ tagKey: "a", status: "acked" }, null], mong: { ok: false, status: "timeout" } },
    { ten: "★ N2 trước ledger [acked, failed] ⇒ failed MOT_PHAN như đường sống", hang: [{ tagKey: "a", status: "acked" }, { tagKey: "b", status: "failed" }], mong: { ok: false, status: "failed", reason: "MOT_PHAN", motPhan: { daAp: ["a"], khongAp: ["b"] } } },
    { ten: "N3 trước ledger [acked, acked] ⇒ ok như trước", hang: [{ tagKey: "a", status: "acked" }, { tagKey: "b", status: "acked" }], mong: { ok: true, status: "acked" } },
    { ten: "★ N4 [simulated, (THIẾU hàng 1)] — nhánh không-thiết-bị, write thiếu hàng ⇒ timeout", hang: [{ tagKey: "a", status: "simulated" }, null], mong: { ok: false, status: "timeout" } },
    { ten: "N5 trước ledger [ADAPTER_OFFLINE, ADAPTER_OFFLINE] ⇒ thất bại KHÔNG gửi: giữ reason", hang: [{ tagKey: "a", status: "failed", errorText: "ADAPTER_OFFLINE: No connected driver for adapter" }, { tagKey: "b", status: "failed", errorText: "ADAPTER_OFFLINE: No connected driver for adapter" }], mong: { ok: false, status: "failed", reason: "ADAPTER_OFFLINE" } },
  ];
  for (const ca of TRUOC_LEDGER) {
    it(`${ca.ten} ⇒ phát lại ok=${ca.mong.ok}, status ${ca.mong.status}; thiết bị không bị ghi`, async () => {
      await trongGiaoDich(async (tx) => {
        const writes = [{ tagKey: "a", value: 1 }, { tagKey: "b", value: 2 }];
        const d = driverGia([ACK, ACK]);
        const { adapterId, actionId } = await dung(tx, writes, d);
        const key = `${DAU}-tl-${Math.random().toString(36).slice(2, 8)}`;
        await chenHangTruocLedger(tx, adapterId, actionId, key, ca.hang);
        const phatLai = await dispatch(lenh(adapterId, actionId, writes, key));
        expect(d.soGhi).toBe(0);
        expect(phatLai.ok).toBe(ca.mong.ok);
        expect(phatLai.status).toBe(ca.mong.status);
        expect(phatLai.reason ?? null).toBe(ca.mong.reason ?? null);
        expect(phatLai.motPhan ?? null).toEqual(ca.mong.motPhan ?? null);
        if (ca.mong.status === "timeout") expect(phatLai.results.find((x) => x.tagKey === "b")).toMatchObject({ ok: false, status: "timeout" });
      });
      expect(H.bay).toBe(0);
    }, 30_000);
  }

  // ── polish m2 — các hình lô KHÔNG phải "thiết bị đã trả lời": phát lại vẫn deepEqual câu trả lời sống (ok / status / reason / motPhan / pinnedStop) ──
  const KHAC: Array<{ ten: string; writes: Array<{ tagKey: string; value: unknown }>; tc: { isEnabled?: boolean; commandType?: string; khongDriver?: boolean; tatDieuKhien?: boolean }; mong: Partial<DispatchResult>; soGhi: number }> = [
    { ten: "★ P1 STOP ghim (a = stopValue 0)", writes: [{ tagKey: "a", value: 0 }], tc: { commandType: "stop" }, mong: { ok: true, status: "acked", pinnedStop: true }, soGhi: 1 },
    { ten: "★ R2 từ chối MỘT write (TAG_NOT_FOUND: chỉ hàng của write ấy) — polish 2: thiếu hàng của lô rejected KHÔNG thành timeout", writes: [{ tagKey: "a", value: 1 }, { tagKey: "zz", value: 2 }], tc: {}, mong: { ok: false, status: "rejected", reason: "TAG_NOT_FOUND" }, soGhi: 0 },
    { ten: "R1 lô bị từ chối hết (ADAPTER_DISABLED)", writes: [{ tagKey: "a", value: 1 }, { tagKey: "b", value: 2 }], tc: { isEnabled: false }, mong: { ok: false, status: "rejected", reason: "ADAPTER_DISABLED" }, soGhi: 0 },
    { ten: "S1 lô mô phỏng (OT_CONTROL_ENABLED tắt)", writes: [{ tagKey: "a", value: 1 }, { tagKey: "b", value: 2 }], tc: { tatDieuKhien: true }, mong: { ok: true, simulated: true, status: "simulated" }, soGhi: 0 },
    { ten: "★ O1 ADAPTER_OFFLINE (không driver nào chạy) — failed KHÔNG gửi gì", writes: [{ tagKey: "a", value: 1 }, { tagKey: "b", value: 2 }], tc: { khongDriver: true }, mong: { ok: false, status: "failed", reason: "ADAPTER_OFFLINE" }, soGhi: 0 },
  ];
  for (const ca of KHAC) {
    it(`${ca.ten} ⇒ phát lại deepEqual câu trả lời sống (gồm reason + pinnedStop)`, async () => {
      await trongGiaoDich(async (tx) => {
        if (ca.tc.tatDieuKhien) process.env.OT_CONTROL_ENABLED = "false";
        const d = driverGia([ACK, ACK]);
        const { adapterId, actionId } = await dung(tx, ca.writes, ca.tc.khongDriver ? null : d, { isEnabled: ca.tc.isEnabled, commandType: ca.tc.commandType });
        const key = `${DAU}-khac-${Math.random().toString(36).slice(2, 8)}`;
        const song = await dispatch(lenh(adapterId, actionId, ca.writes, key, ca.tc.commandType));
        expect(song).toMatchObject(ca.mong);
        const phatLai = await dispatch(lenh(adapterId, actionId, ca.writes, key, ca.tc.commandType));
        expect(chieu(phatLai)).toEqual(chieu(song));
        expect(d.soGhi).toBe(ca.soGhi); // phát lại không ghi thiết bị
      });
      expect(H.bay).toBe(0);
    }, 30_000);
  }

  it("FOE / T3F: lượt đi lại gửi CÙNG khoá của lô K2 ⇒ phát lại `timeout` ⇒ engine coi KHÔNG RÕ (outcomeUnknown), không phải ok, không MOT_PHAN", async () => {
    await trongGiaoDich(async (tx) => {
      const writes = [{ tagKey: "a", value: 1 }, { tagKey: "b", value: 2 }, { tagKey: "c", value: 3 }];
      const d = driverGia([ACK, QUA_HAN, ACK]);
      const { adapterId, actionId } = await dung(tx, writes, d);
      const ot = equipmentRegistry.getAdapter("ot-modbus");
      const cmd = { name: "set_param", adapterId, machineId: MACHINE, writes, idempotencyKey: `run${990_906}-main-a1-${Math.random().toString(36).slice(2, 6)}`, hitl: { actionId, tool: TOOL, requestedBy: OWNER, confirmedBy: OWNER } };
      const r1 = await ot.sendCommand(cmd);
      const r2 = await ot.sendCommand(cmd); // khởi động lại: chỉ command_log
      expect(d.soGhi).toBe(1);
      expect(r1).toMatchObject({ ok: false, status: "timeout" });
      expect(r2).toMatchObject({ ok: false, status: "timeout" });
      const buoc = ketCucLenhFoe(r2, "set_param");
      expect(buoc).toMatchObject({ kind: "failed", outcomeUnknown: true });
      expect((buoc as { motPhan?: unknown }).motPhan).toBeUndefined();
      expect(khongGuiLaiMotPhan(buoc, false)).toBeNull(); // không phải MOT_PHAN — quyết định "không rõ" của FOE giữ như cũ
    });
    expect(H.bay).toBe(0);
  }, 30_000);
});
