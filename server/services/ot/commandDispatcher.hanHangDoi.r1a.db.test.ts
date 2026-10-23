/**
 * SCADA R1a Task 5 (K7 + K9) — qua `dispatch()` thật, CSDL thật (`_test`, ép bởi vitest.setup): command_log WORM + trigger
 * `trg_command_log_result_guard` (một kết quả cho mỗi ý định) chỉ kiểm được trên Postgres thật.
 *
 *   K9 — OT_CMD_SERIALIZE_ENABLED bật: lệnh B chờ sau lệnh A đang treo; đồng hồ (Date.now) nhảy 61 s rồi A xong ⇒ B KHÔNG BAO GIỜ tới
 *        driver, kết quả `rejected QUEUE_EXPIRED` là dòng KẾT QUẢ DUY NHẤT của dòng ý định đã có (ackValue {ledger:'result', intentId}).
 *        deadlineMs của lệnh là hạn chờ (B deadlineMs 50 ms chờ ~150 ms thật ⇒ hết hạn). DỪNG ghim và lệnh kiểu stop chưa xác minh
 *        không có hạn (chờ "61 s" vẫn chạy). Cờ tắt ⇒ không có hàng đợi, không có gì đổi.
 *   K7 — docLai:'bat_buoc' qua dispatch: OT_READBACK_ENABLED tắt mà vẫn đọc lại; thiết bị trả 245 cho lệnh ghi 240 ⇒ acked_unverified,
 *        readBackValue 245 trên dòng sổ. Không docLai ⇒ acked, readTags 0 lần.
 *
 * Thiết bị: driver giả trong tiến trình thay `getActiveDriver` (khuôn commandDispatcher.kenh.r1a.db.test.ts), ĐẾM writeTags/readTags và
 * giữ lệnh ghi ĐẦU TIÊN treo khi test yêu cầu. Mọi thứ khác là mã sản phẩm thật.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { eq, like } from "drizzle-orm";

const fake = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
}));

vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "R1A-T5-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
    getActiveDriver: (adapterId: number) => fake.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => fake.fingerprints.get(adapterId),
  };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { dispatch, type DispatchInput, _adapterCommandQueueDepthForTests, _resetAdapterCommandQueuesForTests } from "./commandDispatcher";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";

const DB_URL = process.env.DATABASE_URL;
const DAU = `R1AT5-${Date.now()}`;
const OWNER = 990_635_101;
const MACHINE = 990_635_001;
const TOOL = "set_machine_param";
const ENDPOINT = "stub://r1a-t5";

// ── driver giả ──────────────────────────────────────────────────────────────
let writeCalls = 0;
let readCalls = 0;
let writtenBatches: Array<Array<{ tagKey: string; value: unknown }>> = [];
let holdFirstWrite: Promise<void> | null = null;
let readValue: Record<string, number> = {};
const fakeDriver = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string; value: unknown }>) {
    writeCalls++;
    writtenBatches.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
    const hold = holdFirstWrite;
    holdFirstWrite = null;
    if (hold) await hold;
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags(tags: Array<{ tagKey: string }>) {
    readCalls++;
    return tags.map((t) => ({ tagKey: t.tagKey, value: readValue[t.tagKey] ?? null, quality: "good", ts: new Date() }));
  },
  async getSafetyStatus() {
    return { state: "OK", source: "fake-driver", ts: new Date().toISOString() };
  },
};

let adapterId = 0;
let seq = 0;
const nextKey = (label: string) => `${DAU}-${label}-${++seq}`;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

type Writes = Array<{ tagKey: string; value: unknown }>;

async function makeAction(bind: { commandType?: string; writes: Writes }): Promise<string> {
  const id = `${DAU}-act-${++seq}`;
  await (await d()).insert(aiPendingActions).values({
    id,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} test action`,
    previewJson: withOtPayloadHash(
      { entityType: "machine" },
      otPayloadHash({ tool: TOOL, adapterId, machineId: MACHINE, commandType: bind.commandType ?? "set_param", writes: bind.writes }),
    ),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return id;
}

/** Lệnh gắn một action đã duyệt (đường ghi thật bắt buộc khi OT bật). */
async function input(over: Partial<DispatchInput> & { writes?: Writes } = {}): Promise<DispatchInput> {
  const writes = over.writes ?? [{ tagKey: "nhiet_sp", value: 245 }];
  const commandType = over.commandType ?? "set_param";
  const actionId = await makeAction({ commandType, writes });
  return {
    adapterId,
    machineId: MACHINE,
    commandType,
    triggeredBy: { kind: "hitl", actionId, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER },
    idempotencyKey: nextKey("k"),
    ...over,
    writes,
  };
}

async function ledger(base: string) {
  return (await d()).select().from(commandLog).where(like(commandLog.idempotencyKey, `%${base}%`));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitDepth(n: number) {
  const t0 = Date.now();
  while (_adapterCommandQueueDepthForTests(adapterId) < n) {
    if (Date.now() - t0 > 10_000) throw new Error(`queue depth never reached ${n}`);
    await sleep(2);
  }
}

/** A chiếm hàng (lệnh ghi đầu tiên treo tới khi `release`). */
function holdA(): () => void {
  let release!: () => void;
  holdFirstWrite = new Promise<void>((r) => {
    release = r;
  });
  return release;
}

/** Đồng hồ Date.now nhảy `ms` (giả lập lệnh chờ lâu, không phải đợi thật); trả hàm khôi phục. */
function jumpClock(ms: number): () => void {
  const real = Date.now.bind(Date);
  const spy = vi.spyOn(Date, "now").mockImplementation(() => real() + ms);
  return () => spy.mockRestore();
}

const ENV_KEYS = [
  "OT_CONTROL_ENABLED",
  "OT_COMMISSIONING_REQUIRED",
  "OT_SAFETY_PREFLIGHT_ENABLED",
  "OT_READBACK_ENABLED",
  "OT_CMD_SERIALIZE_ENABLED",
  "OT_CMD_QUEUE_MAX",
  "SEC_PLATFORM",
  "UNS_CMD_ACK_ENABLED",
  "AI_OT_CONTROL_ENABLED",
  "PARAM_GUARDRAIL_ENABLED",
  "INTERLOCK_AUTO_BLOCK_ENABLED",
  "SCADA_CONG_CHE_DO_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("R1a T5 — hạn hàng đợi (K9) + đọc lại bắt buộc (K7) qua dispatch (DB thật)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    const x = await d();
    const old = await x.select({ id: deviceAdapters.id }).from(deviceAdapters).where(eq(deviceAdapters.machineId, MACHINE));
    for (const a of old) {
      await x.delete(deviceTags).where(eq(deviceTags.adapterId, a.id));
      await x.delete(deviceAdapters).where(eq(deviceAdapters.id, a.id));
    }
    const [a] = await x
      .insert(deviceAdapters)
      .values({ code: `${DAU}-A`, name: `${DAU} adapter`, protocol: "stub", endpoint: ENDPOINT, isEnabled: true, machineId: MACHINE })
      .returning();
    adapterId = a!.id;
    await x.insert(deviceTags).values([
      { adapterId, tagKey: "nhiet_sp", address: "D201", dataType: "float", writable: true, writeMin: 240, writeMax: 250, writeStep: 0.5 },
      { adapterId, tagKey: "toc_do", address: "D202", dataType: "int", writable: true, stopValue: 0 },
    ]);
    fake.drivers.set(adapterId, fakeDriver);
    fake.fingerprints.set(adapterId, adapterTargetFingerprint({ protocol: "stub", endpoint: ENDPOINT, machineId: MACHINE, connectionOptions: null }));
  }, 60_000);

  afterAll(async () => {
    fake.drivers.clear();
    const x = await d();
    await x.delete(aiPendingActions).where(like(aiPendingActions.id, `${DAU}%`));
    if (adapterId) {
      await x.delete(deviceTags).where(eq(deviceTags.adapterId, adapterId));
      await x.delete(deviceAdapters).where(eq(deviceAdapters.id, adapterId));
    }
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }, 60_000);

  beforeEach(() => {
    _resetAdapterCommandQueuesForTests();
    writeCalls = 0;
    readCalls = 0;
    writtenBatches = [];
    holdFirstWrite = null;
    readValue = {};
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
    process.env.OT_CMD_QUEUE_MAX = "5";
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    delete process.env.OT_READBACK_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.UNS_CMD_ACK_ENABLED;
    delete process.env.AI_OT_CONTROL_ENABLED;
    delete process.env.PARAM_GUARDRAIL_ENABLED;
    delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
    delete process.env.SCADA_CONG_CHE_DO_ENABLED;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    _resetAdapterCommandQueuesForTests();
  });

  // ═════════════════ K9 — hạn hàng đợi ═════════════════
  it("★ B chờ sau A treo, đồng hồ +61 s ⇒ B rejected QUEUE_EXPIRED, driver ghi B 0 lần; đúng MỘT dòng kết quả gắn ý định của B", async () => {
    const release = holdA();
    const inA = await input({ writes: [{ tagKey: "nhiet_sp", value: 241 }] });
    const inB = await input({ writes: [{ tagKey: "nhiet_sp", value: 242 }] });
    const pA = dispatch(inA);
    await waitDepth(1);
    const pB = dispatch(inB);
    await waitDepth(2);
    const restore = jumpClock(61_000);
    try {
      release();
      const [rA, rB] = await Promise.all([pA, pB]);
      expect(rA.status).toBe("acked");
      expect(rB.ok).toBe(false);
      expect(rB.status).toBe("rejected");
      expect(rB.reason).toBe("QUEUE_EXPIRED");
      expect(rB.appError).toEqual({ appCode: "OT_COMMAND_QUEUE_EXPIRED", appParams: {} });
    } finally {
      restore();
    }
    expect(writeCalls).toBe(1);
    expect(writtenBatches).toEqual([[{ tagKey: "nhiet_sp", value: 241 }]]); // B (242) never reached the device

    const rows = await ledger(inB.idempotencyKey);
    const intent = rows.find((r) => r.idempotencyKey === `intent:${inB.idempotencyKey}:nhiet_sp:0`);
    const results = rows.filter((r) => (r.ackValue as { ledger?: string } | null)?.ledger === "result");
    expect(rows).toHaveLength(2);
    expect(intent?.ackValue).toEqual({ ledger: "intent" });
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("rejected");
    expect(results[0]!.errorText).toMatch(/^QUEUE_EXPIRED: expired in the adapter command queue: waited \d+ ms for its turn \(limit 60000 ms\)/);
    expect(results[0]!.ackValue).toMatchObject({ ledger: "result", intentId: intent!.id, queueExpired: { ttlMs: 60_000 } });
  });

  it("B chờ sau A rồi A xong ngay (không nhảy đồng hồ) ⇒ B chạy bình thường (acked) — hạn 60 s không cắt lệnh chờ ngắn", async () => {
    const release = holdA();
    const inA = await input({ writes: [{ tagKey: "nhiet_sp", value: 241 }] });
    const inB = await input({ writes: [{ tagKey: "nhiet_sp", value: 242 }] });
    const pA = dispatch(inA);
    await waitDepth(1);
    const pB = dispatch(inB);
    await waitDepth(2);
    release();
    const [rA, rB] = await Promise.all([pA, pB]);
    expect(rA.status).toBe("acked");
    expect(rB.status).toBe("acked");
    expect(writeCalls).toBe(2);
  });

  it("deadlineMs của lệnh = hạn chờ: B deadlineMs 50 ms chờ ~200 ms thật ⇒ QUEUE_EXPIRED (limit 50 ms); deadline_ms vẫn ghi 50 trên dòng sổ", async () => {
    const release = holdA();
    const inA = await input({ writes: [{ tagKey: "nhiet_sp", value: 241 }] });
    const inB = await input({ writes: [{ tagKey: "nhiet_sp", value: 242 }], deadlineMs: 50 });
    const pA = dispatch(inA);
    await waitDepth(1);
    const pB = dispatch(inB);
    await waitDepth(2);
    await sleep(200);
    release();
    const [, rB] = await Promise.all([pA, pB]);
    expect(rB.reason).toBe("QUEUE_EXPIRED");
    expect(writeCalls).toBe(1);
    const results = (await ledger(inB.idempotencyKey)).filter((r) => (r.ackValue as { ledger?: string } | null)?.ledger === "result");
    expect(results).toHaveLength(1);
    expect(results[0]!.errorText).toMatch(/\(limit 50 ms\)/);
    expect(results[0]!.deadlineMs).toBe(50);
  });

  it("★ DỪNG ghim chờ sau A treo, đồng hồ +61 s ⇒ VẪN chạy (DỪNG không có hạn)", async () => {
    const release = holdA();
    const inA = await input({ writes: [{ tagKey: "nhiet_sp", value: 241 }] });
    const inS = await input({ commandType: "stop", writes: [{ tagKey: "toc_do", value: 0 }] });
    const pA = dispatch(inA);
    await waitDepth(1);
    const pS = dispatch(inS);
    await waitDepth(2);
    const restore = jumpClock(61_000);
    try {
      release();
      const [, rS] = await Promise.all([pA, pS]);
      expect(rS.reason).toBeUndefined();
      expect(rS.status).toBe("acked");
      expect(rS.pinnedStop).toBe(true);
    } finally {
      restore();
    }
    expect(writtenBatches[1]).toEqual([{ tagKey: "toc_do", value: 0 }]);
  });

  it("lệnh kiểu stop CHƯA xác minh (giá trị không phải ghim) chờ sau A, đồng hồ +61 s ⇒ VẪN chạy (bỏ một lệnh dừng là hướng không an toàn)", async () => {
    const release = holdA();
    const inA = await input({ writes: [{ tagKey: "nhiet_sp", value: 241 }] });
    const inU = await input({ commandType: "stop", writes: [{ tagKey: "nhiet_sp", value: 240 }] });
    const pA = dispatch(inA);
    await waitDepth(1);
    const pU = dispatch(inU);
    await waitDepth(2);
    const restore = jumpClock(61_000);
    try {
      release();
      const [, rU] = await Promise.all([pA, pU]);
      expect(rU.reason).not.toBe("QUEUE_EXPIRED");
      expect(rU.status).toBe("acked");
    } finally {
      restore();
    }
    expect(writeCalls).toBe(2);
  });

  it("OT_CMD_SERIALIZE_ENABLED tắt ⇒ không có hàng đợi: hai lệnh chạy, đồng hồ +61 s không đổi gì", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "false";
    const inA = await input({ writes: [{ tagKey: "nhiet_sp", value: 241 }] });
    const restore = jumpClock(61_000);
    try {
      const r = await dispatch(inA);
      expect(r.status).toBe("acked");
    } finally {
      restore();
    }
    expect(writeCalls).toBe(1);
  });

  // ═════════════════ K7 — đọc lại bắt buộc ═════════════════
  it("★ OT_READBACK_ENABLED tắt + docLai:'bat_buoc', thiết bị đọc 245 sau khi ghi 240 ⇒ readTags 1 lần, acked_unverified, readBackValue 245 trên dòng sổ", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "false";
    readValue = { nhiet_sp: 245 };
    const inp = await input({ writes: [{ tagKey: "nhiet_sp", value: 240 }], docLai: "bat_buoc" });
    const r = await dispatch(inp);
    expect(readCalls).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.results[0]).toMatchObject({ status: "acked_unverified" });
    const res = (await ledger(inp.idempotencyKey)).find((x) => (x.ackValue as { ledger?: string } | null)?.ledger === "result");
    expect(res?.status).toBe("acked_unverified");
    expect(res?.readBackValue).toBe(245);
  });

  it("không docLai + cờ tắt ⇒ như cũ: acked, readTags 0 lần", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "false";
    readValue = { nhiet_sp: 245 };
    const inp = await input({ writes: [{ tagKey: "nhiet_sp", value: 240 }] });
    const r = await dispatch(inp);
    expect(readCalls).toBe(0);
    expect(r.results[0]).toMatchObject({ status: "acked" });
  });
});
