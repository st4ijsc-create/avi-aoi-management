/**
 * SCADA R1b-2b-2a T3E (backlog 90, AN TOÀN) — DB THẬT (`_test`, ép bởi vitest.setup): dispatcher THẬT + mặt tiền OT THẬT (đúng lời gọi FOE
 * `adapter.sendCommand`) + driver S7 THẬT (nodes7 0.3.18) trên `__s7commSim` (`writeMixed`: item địa chỉ thấp 0xFF, item kia 0x0A; ĐẾM PDU ghi).
 *
 *   (1) lô 2 item trộn ⇒ DispatchResult `failed` + reason MOT_PHAN + motPhan đúng; command_log: MỌI hàng kết quả mang ackValue.motPhan, hàng KHÔNG áp
 *       mang tiền tố mã `MOT_PHAN:` (maLoiCua ⇒ MOT_PHAN — luật C1), hàng áp giữ `acked`.
 *   (3) "dựng lại từ sổ": lượt đi lại của FOE sau khởi động lại gửi CÙNG khoá (`run<N>-<step>-a1`) ⇒ dispatcher trả kết cục từ command_log (không bộ
 *       nhớ nào): vẫn MOT_PHAN + motPhan, thiết bị KHÔNG bị ghi lần hai; quyết định của engine trên kết quả ấy (`ketCucLenhFoe` + `khongGuiLaiMotPhan`,
 *       đúng hai hàm execCommand / execStep dùng) = FOE_OUTCOME_PARTIAL, dừng; STOP thì không dừng (đối chứng).
 *       Thứ tự [a, b]: hàng ĐẦU (hàng `cachedResult` đọc) là hàng ĐÃ ÁP (`acked`) — trước T3E lượt thử lại báo `ok: true` cho một lô áp một phần.
 *
 * Mọi ghi DB nằm trong giao dịch ROLLBACK của chính test (getDb ⇒ giao dịch ấy; ngoài giao dịch getDb là BẪY ⇒ không gì được commit, kể cả ghi nền
 * muộn). Bảng WORM command_log: không id tường minh.
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
      H.bay++; // ngoài giao dịch của test: không bao giờ chạm DB thật (không commit)
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
    listPlcConfigs: async () => [{ code: "T3E-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
import { startS7commSim, type S7commSim } from "./drivers/__s7commSim";
import { S7Driver } from "./drivers/s7Driver";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";
import { dispatch } from "./commandDispatcher";
import { equipmentRegistry } from "../equipment/equipmentAdapter";
import { MA_MOT_PHAN, motPhanCua } from "./motPhan";
import { maLoiCua } from "../../routers/_chiTietKyThuat";
import { FOE_OUTCOME_PARTIAL, ketCucLenhFoe, khongGuiLaiMotPhan } from "../orchestration/foe/foeEngine";
import { __datLaiBoDem, layMotPhanGanNhat } from "./boDemTruyenThong";
import { motPhanHienThi } from "../../routers/scadaDiagRouter";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T3E-${Date.now()}`;
const OWNER = 990_903_101;
const MACHINE = 990_903_001;
const TOOL = "set_machine_param";
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

let sim: S7commSim;
let s7: S7Driver;
const soPduGhi = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).length;

/** Chạy `fn` trong một giao dịch của test rồi ROLLBACK (không gì ở lại `_test`). */
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

/** adapter S7 + tag a (DB1,INT0) / b (DB1,INT2) + uỷ quyền HITL gắn đúng lệnh — TRONG giao dịch. */
async function dung(tx: Tx, writes: Array<{ tagKey: string; value: unknown }>) {
  const endpoint = `127.0.0.1:${sim.port}`;
  const [a] = await tx.insert(deviceAdapters).values({ code: `${DAU}-A-${Math.random().toString(36).slice(2, 8)}`, name: `${DAU} adapter`, protocol: "s7", endpoint, isEnabled: true, machineId: MACHINE }).returning();
  const adapterId = a!.id;
  await tx.insert(deviceTags).values([
    { adapterId, tagKey: "a", address: "DB1,INT0", dataType: "int", writable: true },
    { adapterId, tagKey: "b", address: "DB1,INT2", dataType: "int", writable: true },
  ]);
  H.drivers.set(adapterId, s7);
  H.fingerprints.set(adapterId, adapterTargetFingerprint({ protocol: "s7", endpoint, machineId: MACHINE, connectionOptions: null }));
  const actionId = `${DAU}-act-${Math.random().toString(36).slice(2, 10)}`;
  await tx.insert(aiPendingActions).values({
    id: actionId,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} test action`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId, machineId: MACHINE, commandType: "set_param", writes })),
    status: "confirmed",
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return { adapterId, actionId };
}

const ENV_KEYS = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("T3E — lô áp MỘT PHẦN qua dispatcher THẬT + command_log (DB thật, giao dịch ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    sim = await startS7commSim();
    sim.setFault("writeMixed");
    s7 = new S7Driver();
    await s7.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: 1500 });
  }, 60_000);

  afterAll(async () => {
    H.drivers.clear();
    await s7?.disconnect().catch(() => undefined);
    await sim?.close().catch(() => undefined);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    delete process.env.OT_READBACK_ENABLED;
    delete process.env.OT_CMD_SERIALIZE_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.UNS_CMD_ACK_ENABLED;
    delete process.env.AI_OT_CONTROL_ENABLED;
    delete process.env.PARAM_GUARDRAIL_ENABLED;
    delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
    H.bay = 0;
    __datLaiBoDem();
  });

  it("★ (1) lô 2 item trộn (0xFF + 0x0A) ⇒ failed + MOT_PHAN + motPhan; command_log: ackValue.motPhan trên MỌI hàng kết quả, hàng không áp có tiền tố MOT_PHAN:", async () => {
    const pdu0 = soPduGhi();
    await trongGiaoDich(async (tx) => {
      const writes = [{ tagKey: "b", value: 7 }, { tagKey: "a", value: 5 }]; // b (địa chỉ CAO) trước: ánh xạ theo tagKey
      const { adapterId, actionId } = await dung(tx, writes);
      const key = `${DAU}-k1`;
      const res = await dispatch({ adapterId, machineId: MACHINE, commandType: "set_param", writes, triggeredBy: { kind: "hitl", actionId, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER }, idempotencyKey: key });
      expect(soPduGhi() - pdu0).toBe(1);
      expect(res).toMatchObject({ ok: false, simulated: false, status: "failed", reason: MA_MOT_PHAN, motPhan: { daAp: ["a"], khongAp: ["b"] } });
      expect(res.results.map((r) => [r.tagKey, r.ok, r.status])).toEqual([["b", false, "failed"], ["a", true, "acked"]]);
      expect(String(res.message)).toContain("applied: a; not applied: b");

      const rows = await tx.select().from(commandLog).where(like(commandLog.idempotencyKey, `%${key}%`));
      const ketQua = rows.filter((r) => (r.ackValue as { ledger?: unknown } | null)?.ledger === "result");
      expect(ketQua).toHaveLength(2);
      for (const r of ketQua) expect(motPhanCua((r.ackValue as { motPhan?: unknown }).motPhan)).toEqual({ daAp: ["a"], khongAp: ["b"] });
      const hb = ketQua.find((r) => r.tagKey === "b")!;
      const ha = ketQua.find((r) => r.tagKey === "a")!;
      expect(hb.status).toBe("failed");
      expect(hb.errorText).toMatch(/^MOT_PHAN: bad write quality \(S7 return code 0x0A\) — the batch was applied only partly/);
      expect(maLoiCua(hb.errorText, hb.status)).toBe("MOT_PHAN");
      expect(ha.status).toBe("acked");
      expect(ha.errorText).toBeNull();

      // scadaDiag (M10): lô áp một phần gần nhất của adapter — mã + số cho mọi người xem, danh sách chỉ khi được xem chi tiết kỹ thuật (C1)
      const gn = layMotPhanGanNhat(adapterId);
      expect(gn).toMatchObject({ daAp: ["a"], khongAp: ["b"], commandLogIds: res.commandLogIds });
      expect(motPhanHienThi(gn, true)).toMatchObject({ ma: MA_MOT_PHAN, soDaAp: 1, soKhongAp: 1, daAp: ["a"], khongAp: ["b"], commandLogIds: res.commandLogIds });
      expect(motPhanHienThi(gn, false)).toMatchObject({ ma: MA_MOT_PHAN, soDaAp: 1, soKhongAp: 1, daAp: null, khongAp: null });
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("★ (3) dựng lại từ sổ: lượt đi lại gửi CÙNG khoá FOE ⇒ kết cục từ command_log = MOT_PHAN + motPhan, thiết bị KHÔNG bị ghi lần hai; engine ⇒ FOE_OUTCOME_PARTIAL (STOP: không dừng)", async () => {
    const pdu0 = soPduGhi();
    await trongGiaoDich(async (tx) => {
      const writes = [{ tagKey: "a", value: 5 }, { tagKey: "b", value: 7 }]; // hàng ĐẦU (cachedResult đọc) = hàng ĐÃ ÁP
      const { adapterId, actionId } = await dung(tx, writes);
      const ot = equipmentRegistry.getAdapter("ot-s7");
      const cmd = { name: "set_param", adapterId, machineId: MACHINE, writes, idempotencyKey: `run${990_903}-main-a1`, hitl: { actionId, tool: TOOL, requestedBy: OWNER, confirmedBy: OWNER } };
      const r1 = await ot.sendCommand(cmd);
      expect(r1).toMatchObject({ ok: false, status: "failed", detail: { reason: MA_MOT_PHAN, motPhan: { daAp: ["a"], khongAp: ["b"] } } });
      expect(soPduGhi() - pdu0).toBe(1);

      // khởi động lại: không gì trong bộ nhớ của lượt trước được dùng — chỉ command_log
      const r2 = await ot.sendCommand(cmd);
      expect(soPduGhi() - pdu0).toBe(1); // không gói ghi thứ hai
      expect(r2.ok).toBe(false);
      expect(r2.status).toBe("failed");
      expect(r2.detail).toMatchObject({ reason: MA_MOT_PHAN, motPhan: { daAp: ["a"], khongAp: ["b"] } });

      const buoc = ketCucLenhFoe(r2, "set_param");
      const chot = khongGuiLaiMotPhan(buoc, false);
      expect(chot).toMatchObject({ kind: "failed" });
      expect(String((chot as { error?: string }).error)).toMatch(new RegExp(`^${FOE_OUTCOME_PARTIAL}: .*applied: a; not applied: b`));
      expect(khongGuiLaiMotPhan(buoc, true)).toBeNull(); // STOP: vòng thử lại quyết định như cũ (gửi lại)
    });
    expect(H.bay).toBe(0);
  }, 30_000);
});
