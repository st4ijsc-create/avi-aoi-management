/**
 * SCADA R1b-2b-2a T2 (mục 66, phần 1) — "không rõ kết cục" là thuộc tính của TỪNG write (`OtCommandResult.ketCucKhongRo`):
 *   • write mang `ketCucKhongRo` ⇒ outcome `timeout` "outcome unknown", không đọc lại, đếm lỗi; các write khác của lô giữ kết quả riêng;
 *   • dispatcher cuộn trạng thái: không rõ THẮNG thất bại (`timeout` khi có ≥ 1 outcome `timeout`) — người vận hành phải đọc lại trước khi gửi lần nữa;
 *   • tuần tự hoá bật ⇒ ghi rủi ro "lệnh ghi cũ" (cửa sổ) MỘT lần mỗi lệnh ⇒ STOP acked kế tiếp có canh chỉ-báo-động (B3, R-4-q);
 *   • ÂN HẠN B3: lời ghi đã quá hạn LỆNH mà reject (bất kỳ lỗi nào) hoặc trả kết quả mang `ketCucKhongRo` trong ân hạn ⇒ KHÔNG phải "đã xong": ghi rủi ro,
 *     nhả chỗ ngay, KHÔNG đặt lại phiên (thư viện đã thôi giữ yêu cầu). Chỉ kết quả không mang `ketCucKhongRo` mới là "đã xong" (Q5).
 *
 * Bộ dispatcher THẬT + CSDL giả của testkit (khuôn commandTimedOutWriteStop.dot4.test.ts); driver giả trả kết quả THEO KỊCH BẢN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeLedgerFakeDb, boundPending, TESTKIT_TOOL, resultRows } from "./commandDispatcher.testkit";

type Row = Record<string, any>;
const pending = new Map<string, Row>();
const adapters: Row[] = [];
const tags: Row[] = [];
const cmdLog: Row[] = [];
let cmdSeq = 1;

vi.mock("drizzle-orm", async () => (await import("./commandDispatcher.testkit")).fakeOrm);
function tableFor(table: any): Row[] {
  switch (table.__table) {
    case "ai_pending_actions": return Array.from(pending.values());
    case "device_adapters": return adapters;
    case "device_tags": return tags;
    case "command_log": return cmdLog;
    default: return [];
  }
}
function makeFakeDb() {
  return makeLedgerFakeDb({
    tableFor,
    onInsert: (table: any, vals: Row) => {
      const row = { id: cmdSeq++, ...vals };
      if (table.__table === "command_log") cmdLog.push(row);
      return { id: row.id };
    },
  });
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../../drizzle/schema", () => ({
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, tool: { __name: "tool" } },
  deviceAdapters: { __table: "device_adapters", id: { __name: "id" }, machineId: { __name: "machineId" }, isEnabled: { __name: "isEnabled" } },
  deviceTags: { __table: "device_tags", id: { __name: "id" }, adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, dataType: { __name: "dataType" }, scale: { __name: "scale" }, offset: { __name: "offset" }, isEnabled: { __name: "isEnabled" }, writable: { __name: "writable" }, stopValue: { __name: "stopValue" } },
  commandLog: { __table: "command_log", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" }, status: { __name: "status" } },
  interlockRules: { __table: "interlock_rules", id: { __name: "id" } },
  interlockEvents: { __table: "interlock_events", id: { __name: "id" } },
}));
vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { INTERLOCK_AUTO_BLOCK: "interlock_auto_block" },
  createAuditContext: (x: any) => x,
  logCrudOperation: vi.fn(async () => ({ id: 1 })),
}));
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async () => ({ blocked: false, failClosed: false, violations: [] })),
}));
vi.mock("../audit/controlAuditService", () => ({ recordAuditEvent: vi.fn(async () => null) }));
vi.mock("../ecosystem/ecosystemEvents", () => ({ publishAnomalyDetected: vi.fn() }));
vi.mock("../notificationService", () => ({ sendNotification: vi.fn(async () => ({ id: 1 })) }));

type KetQuaGhi = { tagKey: string; ok: boolean; error?: string; ketCucKhongRo?: string };
const D = vi.hoisted(() => ({
  /** kịch bản của lời ghi kế tiếp: nhận writes, trả promise kết quả */
  kichBan: null as null | ((w: Array<{ tagKey: string; value?: unknown }>) => Promise<unknown>),
  soGhi: 0,
  device: new Map<string, unknown>(),
  reset: { calls: 0 },
  fingerprint: undefined as string | undefined,
}));
const driver = {
  protocol: "modbus",
  isConnected: () => true,
  readTags: async (t: Array<{ tagKey: string }>) => t.filter((x) => D.device.has(x.tagKey)).map((x) => ({ tagKey: x.tagKey, value: D.device.get(x.tagKey), quality: "good", ts: new Date() })),
  writeTags: (w: Array<{ tagKey: string; value?: unknown }>) => {
    D.soGhi += 1;
    const k = D.kichBan;
    if (k) return k(w);
    for (const x of w) D.device.set(x.tagKey, x.value);
    return Promise.resolve(w.map((x) => ({ tagKey: x.tagKey, ok: true })));
  },
};
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn(() => driver),
  getActiveConnectionFingerprint: vi.fn(() => D.fingerprint),
  adapterSessionResetBoundMs: vi.fn(() => 300),
  listActiveAdapters: vi.fn(() => []),
  resetAdapterSession: vi.fn(async () => {
    D.reset.calls += 1;
    return { reset: true, via: "supervisor" };
  }),
}));

import { dispatch, _resetAdapterCommandQueuesForTests, _stopWatchCountForTests, _sweepStaleWriteRiskForTests } from "./commandDispatcher";
import { executeOtDeviceWrite, _staleWriteRiskIntentIdsForTests, type ExecutedWrite } from "./otDeviceWrite";
import { adapterTargetFingerprint } from "./adapterTarget";

const ADAPTER = 10;
const sau = <T>(ms: number, f: () => T | Promise<T>) => new Promise<T>((res, rej) => setTimeout(() => Promise.resolve().then(f).then(res, rej), ms));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await sleep(5);
  }
  return true;
}

let actSeq = 0;
function input(writes: Array<{ tagKey: string; value: unknown }>, commandType = "set_speed") {
  const actionId = `khongro-act-${++actSeq}`;
  const inp = {
    adapterId: ADAPTER,
    machineId: 5,
    commandType,
    writes,
    triggeredBy: { kind: "hitl" as const, actionId, tool: TESTKIT_TOOL, confirmedBy: 1, requestedBy: 1 },
    lang: "vi" as const,
    idempotencyKey: `khongro-${actSeq}`,
  };
  pending.set(actionId, boundPending(actionId, inp));
  return inp;
}

const diaChi = (k: string) => (k === "cmd_a" ? "coil:1" : "coil:2");
/** Đường ghi THẬT của MỘT lệnh, gọi thẳng (ledger tường minh ⇒ intent đối chiếu được). */
function ghi(a: { tagKeys: string[]; timeoutMs?: number; stop?: boolean; intentIds: number[] }): Promise<ExecutedWrite> {
  const writes = a.tagKeys.map((k) => ({ tagKey: k, value: a.stop ? false : true }));
  return executeOtDeviceWrite({
    input: { adapterId: ADAPTER, machineId: 5, commandType: a.stop ? "stop" : "set_speed", idempotencyKey: `khongro-x-${++actSeq}`, writes } as any,
    driver: driver as any,
    resolved: writes.map((w) => ({ write: w, address: diaChi(w.tagKey), dataType: "bool" })) as any,
    driverWrites: writes.map((w) => ({ tagKey: w.tagKey, address: diaChi(w.tagKey), value: w.value, dataType: "bool" as any })),
    timeoutMs: a.timeoutMs ?? 2000,
    stopTyped: a.stop === true,
    bumpStopEpoch: a.stop === true,
    ledger: { intentIds: a.intentIds, confirmedBy: 1 },
  });
}

const KHONG_RO = (tagKey: string): KetQuaGhi => ({ tagKey, ok: false, error: "Timed out", ketCucKhongRo: "qua_han_driver" });

const ENV = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "OT_CONTROL_TIMEOUT_MS", "OT_READBACK_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];
let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  pending.clear();
  adapters.length = 0;
  tags.length = 0;
  cmdLog.length = 0;
  cmdSeq = 1;
  D.kichBan = null;
  D.soGhi = 0;
  D.device.clear();
  D.reset.calls = 0;
  _resetAdapterCommandQueuesForTests();
  _sweepStaleWriteRiskForTests(Number.MAX_SAFE_INTEGER);
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
  process.env.OT_CMD_SERIALIZE_ENABLED = "false";
  process.env.OT_CONTROL_TIMEOUT_MS = "2000";
  delete process.env.OT_READBACK_ENABLED;
  const row = { id: ADAPTER, machineId: 5, code: "A10", isEnabled: true, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", connectionOptions: null };
  adapters.push(row);
  D.fingerprint = adapterTargetFingerprint({ protocol: row.protocol, endpoint: row.endpoint, machineId: row.machineId, connectionOptions: null });
  for (const [i, k] of ["cmd_a", "cmd_b"].entries()) {
    tags.push({ id: 100 + i, adapterId: ADAPTER, tagKey: k, address: `coil:${i + 1}`, dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  }
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  await until(() => _stopWatchCountForTests(ADAPTER) === 0, 3000);
  errSpy.mockRestore();
  warnSpy.mockRestore();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _sweepStaleWriteRiskForTests(Number.MAX_SAFE_INTEGER);
});

describe("R1b-2b-2a T2 — write không rõ kết cục THEO TỪNG write ⇒ 'timeout', dispatcher cuộn 'timeout'", () => {
  it("lô 2 write [acked, qua_han_driver] ⇒ outcomes acked + timeout; dispatcher status 'timeout'", async () => {
    D.kichBan = async () => [{ tagKey: "cmd_a", ok: true }, KHONG_RO("cmd_b")];
    const r = await dispatch(input([{ tagKey: "cmd_a", value: true }, { tagKey: "cmd_b", value: true }]));
    expect(r.ok).toBe(false);
    expect(r.status).toBe("timeout");
    expect(r.results.map((x) => x.status)).toEqual(["acked", "timeout"]);
    expect(r.results[1].error).toBe("Timed out — outcome unknown: the write may have been applied on the device");
    const rows = resultRows(cmdLog);
    expect(rows.map((x) => x.status)).toEqual(["acked", "timeout"]);
    expect(rows[1].ackedAt).toBeNull();
  });

  it("lô [failed thường, qua_han_driver] ⇒ cuộn 'timeout' (không rõ THẮNG thất bại)", async () => {
    D.kichBan = async () => [{ tagKey: "cmd_a", ok: false, error: "x" }, KHONG_RO("cmd_b")];
    const r = await dispatch(input([{ tagKey: "cmd_a", value: true }, { tagKey: "cmd_b", value: true }]));
    expect(r.ok).toBe(false);
    expect(r.status).toBe("timeout");
    expect(r.results.map((x) => x.status)).toEqual(["failed", "timeout"]);
    expect(r.results[0].error).toBe("x");
  });

  it("đối chứng: lô [failed thường] ⇒ 'failed' (không đổi)", async () => {
    D.kichBan = async () => [{ tagKey: "cmd_a", ok: false, error: "Modbus exception 2: Illegal data address (register not supported by device)" }];
    const r = await dispatch(input([{ tagKey: "cmd_a", value: true }]));
    expect(r.status).toBe("failed");
  });

  it("đọc lại BẬT: write không rõ KHÔNG được đọc lại (chỉ write acked)", async () => {
    process.env.OT_READBACK_ENABLED = "true";
    const doc: string[][] = [];
    const goc = driver.readTags;
    driver.readTags = async (t) => (doc.push(t.map((x) => x.tagKey)), goc(t));
    try {
      D.kichBan = async (w) => {
        D.device.set("cmd_a", w[0].value);
        return [{ tagKey: "cmd_a", ok: true }, KHONG_RO("cmd_b")];
      };
      const ex = await ghi({ tagKeys: ["cmd_a", "cmd_b"], intentIds: [1, 2] });
      expect(ex.outcomes.map((o) => o.status)).toEqual(["acked_verified", "timeout"]);
      expect(ex.outcomes[1].readBackValue).toBeNull();
      expect(doc).toEqual([["cmd_a"]]);
    } finally {
      driver.readTags = goc;
    }
  });
});

describe("R1b-2b-2a T2 — rủi ro 'lệnh ghi cũ' của write không rõ (tuần tự hoá bật)", () => {
  it("tuần tự hoá bật: write qua_han_driver ⇒ rủi ro mang intent của lệnh; STOP acked kế tiếp ⇒ canh STOP = 1", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
    D.kichBan = async () => [KHONG_RO("cmd_a")];
    const r1 = await ghi({ tagKeys: ["cmd_a"], intentIds: [71] });
    expect(r1.outcomes[0].status).toBe("timeout");
    expect(r1.slotHold).toBeUndefined(); // lời ghi đã TRẢ LỜI (driver tự hết hạn) — không có gì để giữ chỗ
    expect(_staleWriteRiskIntentIdsForTests(ADAPTER)).toEqual([71]);
    D.kichBan = null;
    const r2 = await ghi({ tagKeys: ["cmd_b"], stop: true, intentIds: [72] });
    expect(r2.outcomes[0].status).toBe("acked");
    expect(_stopWatchCountForTests(ADAPTER)).toBe(1);
  });

  it("tuần tự hoá tắt ⇒ không ghi rủi ro (phạm vi như B3)", async () => {
    D.kichBan = async () => [KHONG_RO("cmd_a")];
    const r1 = await ghi({ tagKeys: ["cmd_a"], intentIds: [73] });
    expect(r1.outcomes[0].status).toBe("timeout");
    expect(_staleWriteRiskIntentIdsForTests(ADAPTER)).toBeNull();
  });
});

describe("R1b-2b-2a T2 — ân hạn B3: reject / kết quả không rõ TRONG ân hạn ⇒ ghi rủi ro, không đặt lại phiên", () => {
  beforeEach(() => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
  });

  async function quaHanLenhRoi(kichBan: () => Promise<unknown>, intentIds: number[]) {
    D.kichBan = () => sau(600, kichBan); // TRONG ân hạn 1000 ms sau hạn lệnh 200 ms
    const t0 = performance.now();
    const ex = await ghi({ tagKeys: ["cmd_a"], timeoutMs: 200, intentIds });
    expect(ex.timedOut).toBe(true);
    expect(ex.outcomes[0].status).toBe("timeout");
    expect(ex.slotHold).toBeDefined();
    expect(_staleWriteRiskIntentIdsForTests(ADAPTER)).toBeNull(); // chưa có gì trước khi lời ghi cũ xong
    await ex.slotHold;
    return performance.now() - t0;
  }

  it("driver reject new Error('bad write quality') ở 600 ms ⇒ slotHold xong < 900 ms, rủi ro được ghi, không đặt lại phiên", async () => {
    const ms = await quaHanLenhRoi(async () => {
      throw new Error("bad write quality");
    }, [81]);
    expect(ms).toBeLessThan(900);
    expect(_staleWriteRiskIntentIdsForTests(ADAPTER)).toEqual([81]);
    expect(D.reset.calls).toBe(0);
  });

  it("driver resolve [{ok:false, ketCucKhongRo:'qua_han_driver'}] trong ân hạn ⇒ như trên", async () => {
    const ms = await quaHanLenhRoi(async () => [KHONG_RO("cmd_a")], [82]);
    expect(ms).toBeLessThan(900);
    expect(_staleWriteRiskIntentIdsForTests(ADAPTER)).toEqual([82]);
    expect(D.reset.calls).toBe(0);
  });

  it("đối chứng: driver resolve [{ok:true}] trong ân hạn ⇒ KHÔNG rủi ro, không đặt lại phiên", async () => {
    const ms = await quaHanLenhRoi(async () => [{ tagKey: "cmd_a", ok: true }], [83]);
    expect(ms).toBeLessThan(900);
    expect(_staleWriteRiskIntentIdsForTests(ADAPTER)).toBeNull();
    expect(D.reset.calls).toBe(0);
  });
});
