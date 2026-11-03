/**
 * SCADA R1b-2b-2a A2(g) (AN TOÀN, dieu-phoi 2026-11-02) — lệnh CÓ khoá idempotency bị từ chối TRƯỚC bước idempotency (2) — ở cổng uỷ quyền (1) — rồi thử
 * lại CÙNG khoá KHÔNG được làm `dispatch()` NÉM.
 *
 * Lỗi (trước A2(g)): hàng từ chối ở (1) mang `perWriteKey(key, tag, idx)`; `command_log_idempotencyKey_unique` là UNIQUE TOÀN BẢNG ⇒ lời từ chối thứ hai cùng
 * khoá (hoặc lời từ chối sau khi khoá ĐÃ bay, hoặc cùng khoá trên adapter khác) vỡ UNIQUE ⇒ `dispatch()` ném.
 *
 * Phán quyết: mọi hàng từ chối ghi TRƯỚC (2) mang khoá NULL + `ackValue.khoaGoc` = khoá của bên gọi; mã / lý do / chi tiết không đổi. Từ chối trước (2) =
 * KHÔNG gì được gửi ⇒ khoá không bị tiêu (lần sau được uỷ quyền đúng ĐI QUA, kể cả payload khác). Khoá ĐÃ bay giữ phát lại / IDEMPOTENCY_KEY_REUSED.
 *
 * DB THẬT (`_test`): dispatcher THẬT + driver GIẢ đếm `writeTags`; mọi ghi trong giao dịch ROLLBACK; command_log (WORM): không id tường minh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const H = vi.hoisted(() => ({
  tx: null as unknown,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
}));

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...real,
    getDb: (async () => (H.tx ? H.tx : null)) as typeof real.getDb,
    __realGetDb: real.getDb,
  };
});
// bàn an toàn (preflight) đọc PLC an toàn: PLC giả "thật", estop=false — không mock ⇒ SAFETY_UNKNOWN (cùng mock với khoaBatBuoc.a2a)
vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "A2G-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
  return { ...orig, raiseCriticalStopAlert: async () => undefined };
});

import * as conn from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";
import { dispatch, perWriteKey, type DispatchResult, type DispatchInput } from "./commandDispatcher";
import type { OtWrite } from "./otDriver";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2G-${Date.now()}`;
const OWNER = 990_908_301;
const MACHINE = 990_908_311;
/** quy tắc interlock không tồn tại (int4 lớn — không bao giờ là id thật của bảng). */
const LUAT_KHONG_CO = 2_147_483_000;
const TOOL = "set_machine_param";
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;
type W = Array<{ tagKey: string; value: unknown }>;

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

function driverGia() {
  const d = {
    protocol: "modbus",
    soGhi: 0,
    isConnected: () => true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    health: async () => ({ protocol: "modbus", connected: true }),
    writeTags: async (ws: OtWrite[]) => {
      d.soGhi += 1;
      return ws.map((w) => ({ tagKey: w.tagKey, ok: true }));
    },
    readTags: async () => [],
  };
  return d;
}

/** adapter modbus + tag thường `t`, `u` và tag GHIM STOP `a` (stopValue 0) — driver giả của riêng adapter. */
async function taoAdapter(tx: Tx, d: unknown): Promise<number> {
  // địa chỉ TEST-NET cố định (RFC 5737): driver giả, endpoint không bao giờ được kết nối
  const endpoint = "tcp://192.0.2.20:502";
  const [a] = await tx.insert(deviceAdapters).values({ code: `${DAU}-A-${randomUUID()}`, name: `${DAU} adapter`, protocol: "modbus", endpoint, isEnabled: true, machineId: MACHINE }).returning();
  const adapterId = a!.id;
  await tx.insert(deviceTags).values([
    { adapterId, tagKey: "t", address: "40001", dataType: "int", writable: true },
    { adapterId, tagKey: "u", address: "40002", dataType: "int", writable: true },
    { adapterId, tagKey: "a", address: "40003", dataType: "int", writable: true, stopValue: 0 as never },
  ]);
  H.drivers.set(adapterId, d);
  H.fingerprints.set(adapterId, adapterTargetFingerprint({ protocol: "modbus", endpoint, machineId: MACHINE, connectionOptions: null }));
  return adapterId;
}

/** Uỷ quyền HITL (confirmed, chủ = OWNER) gắn băm của `writes` — sai payload ⇒ ACTION_BINDING_MISMATCH khi lệnh mang payload khác. */
async function taoHanhDong(tx: Tx, adapterId: number, writes: W, commandType = "set_param"): Promise<string> {
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

const lenh = (adapterId: number, writes: W, khoa: string, triggeredBy: DispatchInput["triggeredBy"], commandType = "set_param"): DispatchInput =>
  ({ adapterId, machineId: MACHINE, commandType, writes, triggeredBy, idempotencyKey: khoa }) as DispatchInput;

/** được uỷ quyền ĐÚNG: hành động mới, gắn đúng payload (đường HITL actionId). */
async function guiDung(tx: Tx, ad: number, writes: W, khoa: string): Promise<DispatchResult> {
  const actionId = await taoHanhDong(tx, ad, writes);
  return dispatch(lenh(ad, writes, khoa, { kind: "hitl", actionId, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER }));
}
/** cổng (1): requireBoundAction KHÔNG actionId ⇒ PRECONDITION_FAILED. */
const tuChoiKhongAction = (ad: number, writes: W, khoa: string) =>
  dispatch(lenh(ad, writes, khoa, { kind: "hitl", tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER, requireBoundAction: true }));
/** cổng (1): requireBoundAction + actionId gắn payload KHÁC ⇒ ACTION_BINDING_MISMATCH. */
const tuChoiRangBuocLech = (ad: number, writes: W, khoa: string, actionSai: string) =>
  dispatch(lenh(ad, writes, khoa, { kind: "hitl", actionId: actionSai, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER, requireBoundAction: true }));
/** cổng (1): HITL actionId không tồn tại (đường cũ) ⇒ NOT_CONFIRMED. */
const tuChoiChuaDuyet = (ad: number, writes: W, khoa: string) =>
  dispatch(lenh(ad, writes, khoa, { kind: "hitl", actionId: `${DAU}-khong-co-${randomUUID()}`, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER }));

const chieu = (r: DispatchResult) => ({ ok: r.ok, simulated: r.simulated, status: r.status, reason: r.reason ?? null, results: r.results.map((x) => ({ tagKey: x.tagKey, ok: x.ok, status: x.status })) });
const hangCua = async (tx: Tx, ids: number[]) => tx.select().from(commandLog).where(inArray(commandLog.id, ids));
const khoaGoc = (h: { ackValue: unknown }) => (h.ackValue as { khoaGoc?: unknown } | null)?.khoaGoc;
/** mọi khoá ghi (kết quả, định dạng v2) mà lệnh `writes` dưới khoá `k` có thể mang. */
const khoaGhi = (k: string, writes: W) => writes.map((w, i) => perWriteKey(k, w.tagKey, i));

/** hàng từ chối trước (2): rejected, khoá NULL, khoaGoc = khoá, errorText `${mã}: …` — đúng số hàng. */
async function kiemHangTuChoi(tx: Tx, r: DispatchResult, khoa: string, ma: string, soHang: number) {
  const hang = await hangCua(tx, r.commandLogIds);
  expect(hang).toHaveLength(soHang);
  for (const h of hang) {
    expect(h.status).toBe("rejected");
    expect(h.idempotencyKey).toBeNull();
    expect(khoaGoc(h)).toBe(khoa);
    expect(String(h.errorText).startsWith(`${ma}: `)).toBe(true);
  }
  return hang;
}

const ENV_KEYS = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("A2(g) — lệnh CÓ khoá bị từ chối trước bước (2), thử lại cùng khoá: không ném, khoá NULL + khoaGoc, khoá không bị tiêu (DB thật, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    await import("../robot/criticalStopAlert");
  }, 60_000);
  afterAll(() => {
    H.drivers.clear();
    H.fingerprints.clear();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => {
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    for (const k of ENV_KEYS.slice(2)) delete process.env[k];
  });

  it("★ G1 cổng HITL hai lần cùng khoá (requireBoundAction không actionId; ràng buộc lệch) ⇒ CÙNG lời từ chối như hôm nay, không ném; hàng khoá NULL + ackValue.khoaGoc = khoá; 0 gói; duyệt KHÔNG bị tiêu", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const writes: W = [{ tagKey: "t", value: 1 }, { tagKey: "u", value: 2 }];
      const tuChoiMoi = [
        { tagKey: "t", ok: false, status: "rejected" },
        { tagKey: "u", ok: false, status: "rejected" },
      ];

      const K1 = `${DAU}-g1a-${randomUUID()}`;
      const a1 = await tuChoiKhongAction(ad, writes, K1);
      const a2 = await tuChoiKhongAction(ad, writes, K1);
      expect(chieu(a1)).toEqual({ ok: false, simulated: false, status: "rejected", reason: "PRECONDITION_FAILED", results: tuChoiMoi });
      expect(chieu(a2)).toEqual(chieu(a1));
      for (const r of [a1, a2]) {
        const hang = await kiemHangTuChoi(tx, r, K1, "PRECONDITION_FAILED", 2);
        for (const h of hang) expect(h.errorText).toBe("PRECONDITION_FAILED: command requires a bound, confirmed HITL actionId (none supplied)");
      }

      const K2 = `${DAU}-g1b-${randomUUID()}`;
      const actionSai = await taoHanhDong(tx, ad, [{ tagKey: "t", value: 99 }, { tagKey: "u", value: 2 }]);
      const b1 = await tuChoiRangBuocLech(ad, writes, K2, actionSai);
      const b2 = await tuChoiRangBuocLech(ad, writes, K2, actionSai);
      expect(chieu(b1)).toEqual({ ok: false, simulated: false, status: "rejected", reason: "ACTION_BINDING_MISMATCH", results: tuChoiMoi });
      expect(chieu(b2)).toEqual(chieu(b1));
      const hb1 = await kiemHangTuChoi(tx, b1, K2, "ACTION_BINDING_MISMATCH", 2);
      const hb2 = await kiemHangTuChoi(tx, b2, K2, "ACTION_BINDING_MISMATCH", 2);
      expect(hb2.map((h) => h.errorText)).toEqual(hb1.map((h) => h.errorText));

      expect(d.soGhi).toBe(0);
      const [act] = await tx.select().from(aiPendingActions).where(eq(aiPendingActions.id, actionSai));
      expect(act!.status).toBe("confirmed");
      // không hàng nào mang khoá ghi của K1 / K2
      expect(await tx.select().from(commandLog).where(inArray(commandLog.idempotencyKey, [...khoaGhi(K1, writes), ...khoaGhi(K2, writes)]))).toEqual([]);
    });
  }, 60_000);

  it("★ G2 sau HAI lời từ chối ở cổng (1), CÙNG khoá được uỷ quyền đúng, CÙNG payload ⇒ BAY (+1 gói, hàng mới mang khoá ghi), không phát lại lời từ chối; lần nữa ⇒ phát lại lần bay (0 gói)", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const writes: W = [{ tagKey: "t", value: 1 }, { tagKey: "u", value: 2 }];
      const K = `${DAU}-g2-${randomUUID()}`;
      const r1 = await tuChoiKhongAction(ad, writes, K);
      const r2 = await tuChoiRangBuocLech(ad, writes, K, await taoHanhDong(tx, ad, [{ tagKey: "t", value: 7 }, { tagKey: "u", value: 2 }]));
      expect([r1.reason, r2.reason]).toEqual(["PRECONDITION_FAILED", "ACTION_BINDING_MISMATCH"]);
      const tuChoiIds = [...r1.commandLogIds, ...r2.commandLogIds];

      const bay = await guiDung(tx, ad, writes, K);
      expect(chieu(bay)).toEqual({
        ok: true,
        simulated: false,
        status: "acked",
        reason: null,
        results: [
          { tagKey: "t", ok: true, status: "acked" },
          { tagKey: "u", ok: true, status: "acked" },
        ],
      });
      expect(d.soGhi).toBe(1);
      expect(bay.commandLogIds.some((id) => tuChoiIds.includes(id))).toBe(false);
      const hangBay = await hangCua(tx, bay.commandLogIds);
      expect(hangBay.map((h) => h.idempotencyKey).sort()).toEqual([...khoaGhi(K, writes)].sort());
      expect(hangBay.every((h) => h.status === "acked")).toBe(true);

      const lai = await guiDung(tx, ad, writes, K);
      expect(chieu(lai)).toEqual(chieu(bay));
      expect([...lai.commandLogIds].sort()).toEqual([...bay.commandLogIds].sort());
      expect(d.soGhi).toBe(1);
    });
  }, 60_000);

  it("★ G3 sau lời từ chối ở cổng (1), CÙNG khoá được uỷ quyền đúng với payload KHÁC ⇒ BAY (chưa gì bay dưới khoá), không IDEMPOTENCY_KEY_REUSED; sau đó payload cũ ⇒ IDEMPOTENCY_KEY_REUSED (khoá giờ thuộc lần bay)", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const P1: W = [{ tagKey: "t", value: 1 }];
      const P2: W = [{ tagKey: "t", value: 5 }];
      const K = `${DAU}-g3-${randomUUID()}`;
      const r1 = await tuChoiKhongAction(ad, P1, K);
      const r2 = await tuChoiChuaDuyet(ad, P1, K);
      expect([r1.reason, r2.reason]).toEqual(["PRECONDITION_FAILED", "NOT_CONFIRMED"]);
      await kiemHangTuChoi(tx, r2, K, "NOT_CONFIRMED", 1);

      const bay = await guiDung(tx, ad, P2, K);
      expect(chieu(bay)).toEqual({ ok: true, simulated: false, status: "acked", reason: null, results: [{ tagKey: "t", ok: true, status: "acked" }] });
      expect(d.soGhi).toBe(1);
      const [hb] = await hangCua(tx, bay.commandLogIds);
      expect(hb!.idempotencyKey).toBe(perWriteKey(K, "t", 0));
      expect(hb!.requestedValue).toBe(5);

      const cu = await guiDung(tx, ad, P1, K);
      expect(cu).toMatchObject({ ok: false, status: "rejected", reason: "IDEMPOTENCY_KEY_REUSED" });
      expect(d.soGhi).toBe(1);
    });
  }, 60_000);

  it("★ G4 khoá BAY trước (+1 gói); rồi cùng khoá bị từ chối ở cổng (1) ⇒ lời từ chối uỷ quyền, không ném, hàng NULL + khoaGoc; rồi uỷ quyền đúng ⇒ PHÁT LẠI lần bay (0 gói), payload khác ⇒ IDEMPOTENCY_KEY_REUSED (0 gói). Không gửi đôi", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const P1: W = [{ tagKey: "t", value: 1 }, { tagKey: "u", value: 2 }];
      const P2: W = [{ tagKey: "t", value: 3 }, { tagKey: "u", value: 2 }];
      const K = `${DAU}-g4-${randomUUID()}`;

      const bay = await guiDung(tx, ad, P1, K);
      expect(bay).toMatchObject({ ok: true, simulated: false, status: "acked" });
      expect(d.soGhi).toBe(1);

      const t1 = await tuChoiKhongAction(ad, P1, K);
      expect(chieu(t1)).toMatchObject({ ok: false, simulated: false, status: "rejected", reason: "PRECONDITION_FAILED" });
      await kiemHangTuChoi(tx, t1, K, "PRECONDITION_FAILED", 2);
      const t2 = await tuChoiRangBuocLech(ad, P1, K, await taoHanhDong(tx, ad, P2));
      expect(t2).toMatchObject({ ok: false, status: "rejected", reason: "ACTION_BINDING_MISMATCH" });
      await kiemHangTuChoi(tx, t2, K, "ACTION_BINDING_MISMATCH", 2);
      const t3 = await tuChoiChuaDuyet(ad, P2, K);
      expect(t3).toMatchObject({ ok: false, status: "rejected", reason: "NOT_CONFIRMED" });
      await kiemHangTuChoi(tx, t3, K, "NOT_CONFIRMED", 2);
      expect(d.soGhi).toBe(1);

      // hàng từ chối không che / thay hàng đã bay: đúng các hàng bay mang khoá ghi
      const mangKhoa = await tx.select().from(commandLog).where(inArray(commandLog.idempotencyKey, khoaGhi(K, P1)));
      expect(mangKhoa.map((h) => h.id).sort()).toEqual([...bay.commandLogIds].sort());

      const lai = await guiDung(tx, ad, P1, K);
      expect(chieu(lai)).toEqual(chieu(bay));
      expect([...lai.commandLogIds].sort()).toEqual([...bay.commandLogIds].sort());
      expect(d.soGhi).toBe(1);

      const khac = await guiDung(tx, ad, P2, K);
      expect(khac).toMatchObject({ ok: false, status: "rejected", reason: "IDEMPOTENCY_KEY_REUSED" });
      expect(d.soGhi).toBe(1);
    });
  }, 60_000);

  it("★ G5 cổng interlock (cờ tắt; quy tắc không tồn tại) hai lần cùng khoá ⇒ không ném, đúng mã, hàng khoá NULL + khoaGoc; 0 gói", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const writes: W = [{ tagKey: "a", value: 0 }];
      const K1 = `${DAU}-g5a-${randomUUID()}`;
      for (let i = 0; i < 2; i++) {
        const r = await dispatch(lenh(ad, writes, K1, { kind: "interlock", ruleId: LUAT_KHONG_CO, eventId: LUAT_KHONG_CO, approvedBy: OWNER }, "stop_line"));
        expect(chieu(r)).toEqual({ ok: false, simulated: false, status: "rejected", reason: "INTERLOCK_AUTO_BLOCK_DISABLED", results: [{ tagKey: "a", ok: false, status: "rejected" }] });
        await kiemHangTuChoi(tx, r, K1, "INTERLOCK_AUTO_BLOCK_DISABLED", 1);
      }
      process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
      const K2 = `${DAU}-g5b-${randomUUID()}`;
      for (let i = 0; i < 2; i++) {
        const r = await dispatch(lenh(ad, writes, K2, { kind: "interlock", ruleId: LUAT_KHONG_CO, eventId: LUAT_KHONG_CO, approvedBy: OWNER }, "stop_line"));
        expect(r).toMatchObject({ ok: false, status: "rejected", reason: "INTERLOCK_RULE_NOT_FOUND" });
        await kiemHangTuChoi(tx, r, K2, "INTERLOCK_RULE_NOT_FOUND", 1);
      }
      expect(d.soGhi).toBe(0);
    });
  }, 60_000);

  it("★ G6 HAI adapter, CÙNG khoá, cùng tag, cả hai bị từ chối ở cổng (1) (mỗi adapter hai kiểu) ⇒ không ném, mọi hàng NULL + khoaGoc; lệnh KHÔNG khoá bị từ chối ở (1) ⇒ hàng NULL KHÔNG có khoaGoc (y như A2(a) F1)", async () => {
    await trongGiaoDich(async (tx) => {
      const ad1 = await taoAdapter(tx, driverGia());
      const ad2 = await taoAdapter(tx, driverGia());
      const writes: W = [{ tagKey: "t", value: 1 }];
      const K = `${DAU}-g6-${randomUUID()}`;
      const ids: number[] = [];
      for (const ad of [ad1, ad2, ad1, ad2]) {
        const r1 = await tuChoiKhongAction(ad, writes, K);
        expect(r1.reason).toBe("PRECONDITION_FAILED");
        const r2 = await tuChoiChuaDuyet(ad, writes, K);
        expect(r2.reason).toBe("NOT_CONFIRMED");
        ids.push(...r1.commandLogIds, ...r2.commandLogIds);
      }
      const hang = await hangCua(tx, ids);
      expect(hang).toHaveLength(8);
      expect(hang.map((h) => [h.idempotencyKey, khoaGoc(h)])).toEqual(hang.map(() => [null, K]));

      const khongKhoa = await tuChoiKhongAction(ad1, writes, "");
      expect(khongKhoa.reason).toBe("PRECONDITION_FAILED");
      const [hk] = await hangCua(tx, khongKhoa.commandLogIds);
      expect(hk!.idempotencyKey).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(hk!.ackValue ?? {}, "khoaGoc")).toBe(false);
    });
  }, 60_000);
});
