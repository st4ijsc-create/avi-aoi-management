/**
 * doc 81 Đợt 1B Task 6 — OT dispatcher: HITL gắn đúng lệnh + tiêu thụ một lần, sổ ghi TRƯỚC
 * thiết bị, safety UNKNOWN chặn, Sparkplug DCMD bắt buộc actionId. CSDL THẬT (`_test`, ép bởi
 * vitest.setup) — FOR UPDATE / CAS / pg_advisory_xact_lock / WORM chỉ kiểm được trên Postgres thật.
 *
 * Thiết bị: MỘT driver giả trong tiến trình (không socket, không cổng) thay `getActiveDriver`
 * cho đúng adapter của test; nó ĐẾM `writeTags` (oracle độc lập với mã sản phẩm: số lần thiết bị
 * bị ghi) và trễ 50 ms để các lượt song song chắc chắn chồng lên nhau. Mọi thứ khác là mã sản phẩm
 * thật: dispatcher, facade safety, interlock gate, commandLog, ai_pending_actions.
 *
 * command_log là WORM (avi_app không có UPDATE/DELETE) ⇒ hàng test ở lại; mọi khoá mang tiền tố
 * DAU (duy nhất theo lượt chạy) nên không va hàng cũ. Adapter/tag/pending action được dọn.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import postgres from "postgres";

const fake = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
}));

// doc 81 Đợt 1C Task 1 fix round 1 (review #3): preflight lệnh THẬT không còn nghe driver TỰ báo an toàn
// (getSafetyStatus của driver) — chỉ safety-PLC `real` có gán tag. Nguồn safety-PLC nền của facade THẬT
// được giả ở đây, lái bởi CÙNG biến `safetyState` của tệp: OK ⇒ PLC thật đọc sạch; BLOCKED ⇒ e-stop
// active; UNKNOWN ⇒ adapter safety-PLC tắt. (Cấu hình giả mang endpoint TEST-NET-1, không bao giờ nối.)
const safetyRef = vi.hoisted(() => ({ get: (): string => "OK" }));
vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => safetyRef.get() !== "UNKNOWN",
    listPlcConfigs: async () => [
      { code: "T6-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
    ],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: safetyRef.get() === "BLOCKED" }),
      readChecked: async () => ({ status: { estop: safetyRef.get() === "BLOCKED" }, unreadable: [] }),
    }),
  };
});

vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => fake.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
  };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags, interlockEvents, interlockRules } from "../../../drizzle/schema";
import { dispatch, NO_CONFIRMER, type DispatchInput } from "./commandDispatcher";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { makeFoeGateRun, type FoeGateRunFixture } from "../orchestration/foe/__foeGateRunFixture";

const fixtures: FoeGateRunFixture[] = []; // doc 81 Đợt 4 fix round 1 — real run/gate rows, removed in afterAll
import { SparkplugCommandHandler, SPARKPLUG_ACTION_ID_METRIC, SPARKPLUG_COMMAND_TOOL } from "../uns/sparkplugCommand";
import { encodePayload } from "../uns/sparkplugEncoder";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T6D1B-${Date.now()}`;
const OWNER = 990_600_101;
const OTHER_USER = 990_600_102;
const MACHINE = 990_600_001;
const TOOL = "set_machine_param";

// ── driver giả: đếm số lần thiết bị bị ghi ──────────────────────────────────
let writeCalls = 0;
let writtenBatches: Array<Array<{ tagKey: string; value: unknown }>> = [];
let safetyState: "OK" | "BLOCKED" | "UNKNOWN" = "OK";
safetyRef.get = () => safetyState;
const fakeDriver = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string; value: unknown }>) {
    writeCalls++;
    writtenBatches.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
    await new Promise((r) => setTimeout(r, 50));
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags() {
    return [];
  },
  // Giữ lại: đường ĐỌC CŨ (không tham số) vẫn uỷ quyền; preflight lệnh thật thì KHÔNG (fix round 1 #3).
  async getSafetyStatus() {
    return { state: safetyState, source: "fake-driver", ts: new Date().toISOString() };
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

/** A pending action exactly as the product creators store it (same helper). */
async function makeAction(opts: {
  status?: "confirmed" | "executed" | "proposed";
  tool?: string;
  userId?: number;
  bind?: { tool?: string; adapterId?: number; machineId?: number | null; commandType?: string; writes?: Writes } | null;
  expiresInMs?: number;
}): Promise<string> {
  const id = `${DAU}-act-${++seq}`;
  const tool = opts.tool ?? TOOL;
  const b = opts.bind === undefined ? {} : opts.bind;
  const previewJson =
    b === null
      ? { note: "no binding (AI-coding shaped row)" }
      : withOtPayloadHash(
          { entityType: "machine" },
          otPayloadHash({
            tool: b.tool ?? tool,
            adapterId: b.adapterId ?? adapterId,
            machineId: b.machineId === undefined ? MACHINE : b.machineId,
            commandType: b.commandType ?? "set_param",
            writes: b.writes ?? [{ tagKey: "speed_sp", value: 42 }],
          }),
        );
  await (await d()).insert(aiPendingActions).values({
    id,
    tool,
    argsJson: {},
    userId: opts.userId ?? OWNER,
    userRole: "engineer",
    summary: `${DAU} test action`,
    previewJson,
    status: opts.status ?? "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 600_000)),
  });
  return id;
}

function input(over: Partial<DispatchInput> & { actionId?: string | undefined; tool?: string } = {}): DispatchInput {
  const { actionId, tool, ...rest } = over;
  return {
    adapterId,
    machineId: MACHINE,
    commandType: "set_param",
    writes: [{ tagKey: "speed_sp", value: 42 }],
    triggeredBy: { kind: "hitl", actionId, tool: tool ?? TOOL, confirmedBy: OWNER, requestedBy: OWNER },
    idempotencyKey: nextKey("k"),
    ...rest,
  };
}

async function ledger(base: string) {
  return (await d())
    .select()
    .from(commandLog)
    .where(like(commandLog.idempotencyKey, `%${base}%`));
}

async function pendingStatus(id: string) {
  const [row] = await (await d()).select().from(aiPendingActions).where(eq(aiPendingActions.id, id)).limit(1);
  return row?.status;
}

const ENV_KEYS = [
  "OT_CONTROL_ENABLED",
  "OT_COMMISSIONING_REQUIRED",
  "OT_SAFETY_PREFLIGHT_ENABLED",
  "OT_READBACK_ENABLED",
  "OT_CMD_SERIALIZE_ENABLED",
  "SEC_PLATFORM",
  "UNS_CMD_ACK_ENABLED",
  "AI_OT_CONTROL_ENABLED",
  "PARAM_GUARDRAIL_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("Task 6 — OT dispatcher HITL binding + write-ahead + safety (DB thật)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    // Đợt 1D Task 2 fix round 1 (R-1D-h) — nạp NÓNG facade + nguồn safety-PLC: dispatcher nạp chúng bằng import
    // động BÊN TRONG hạn preflight 5 s; chạy gộp ~150 tệp thì lượt nạp nguội đầu tiên vượt hạn ⇒ UNKNOWN (ĐO: ~5,2 s).
    // Hạn sản xuất KHÔNG đổi.
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    const x = await d();
    const [a] = await x
      .insert(deviceAdapters)
      .values({ code: `${DAU}-A`, name: `${DAU} adapter`, protocol: "stub", endpoint: "stub://t6", isEnabled: true, machineId: MACHINE })
      .returning();
    adapterId = a!.id;
    await x.insert(deviceTags).values([
      { adapterId, tagKey: "speed_sp", address: "D100", dataType: "int", writable: true },
      { adapterId, tagKey: "other_sp", address: "D101", dataType: "int", writable: true },
      { adapterId, tagKey: "label_sp", address: "D102", dataType: "string", writable: true },
      { adapterId, tagKey: "cmd_run", address: "M10", dataType: "bool", writable: true },
    ]);
    fake.drivers.set(adapterId, fakeDriver);
  }, 60_000);

  afterAll(async () => {
    fake.drivers.clear();
    for (const f of fixtures.splice(0)) await f.cleanup();
    const x = await d();
    await x.delete(aiPendingActions).where(like(aiPendingActions.id, `${DAU}%`));
    await x.delete(aiPendingActions).where(like(aiPendingActions.id, `foe-${DAU}%`));
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
    writeCalls = 0;
    writtenBatches = [];
    safetyState = "OK";
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false"; // commissioning has its own suite
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED; // default ON
    delete process.env.OT_READBACK_ENABLED;
    delete process.env.OT_CMD_SERIALIZE_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.UNS_CMD_ACK_ENABLED;
    delete process.env.AI_OT_CONTROL_ENABLED;
    delete process.env.PARAM_GUARDRAIL_ENABLED;
  });

  // ═════════════════ đường hợp lệ ═════════════════
  it("★ đường hợp lệ: action confirmed + gắn đúng ⇒ ghi ĐÚNG 1 lần; sổ có intent (trước) + kết quả gắn intent; action → executed; gọi lại cùng khoá ⇒ cache, không ghi lần 2", async () => {
    const actionId = await makeAction({});
    const inp = input({ actionId });
    const res = await dispatch(inp);
    expect(res.ok).toBe(true);
    expect(res.status).toBe("acked");
    expect(writeCalls).toBe(1);
    expect(writtenBatches[0]).toEqual([{ tagKey: "speed_sp", value: 42 }]);
    expect(await pendingStatus(actionId)).toBe("executed");

    const rows = await ledger(inp.idempotencyKey);
    const intent = rows.find((r) => r.idempotencyKey === `intent:${inp.idempotencyKey}:speed_sp:0`);
    const result = rows.find((r) => r.idempotencyKey === `${inp.idempotencyKey}:speed_sp:0`);
    expect(rows).toHaveLength(2);
    expect(intent?.status).toBe("sent");
    expect(intent?.ackValue).toEqual({ ledger: "intent" });
    expect(intent?.actionId).toBe(actionId);
    expect(intent?.requestedValue).toBe(42);
    expect(intent?.confirmedBy).toBe(OWNER);
    expect(result?.status).toBe("acked");
    expect(result?.ackValue).toEqual({ ledger: "result", intentId: intent!.id });
    expect(result!.id).toBeGreaterThan(intent!.id); // intent INSERTed first

    const replay = await dispatch({ ...inp });
    expect(replay.status).toBe("acked");
    expect(writeCalls).toBe(1);
  });

  it("đường mô phỏng (OT_CONTROL_ENABLED tắt) giữ NGUYÊN hành vi cũ: action 'executed' vẫn cho ghi sổ simulated, không tiêu thụ, không intent", async () => {
    process.env.OT_CONTROL_ENABLED = "false";
    const actionId = await makeAction({ status: "executed", bind: null });
    const inp = input({ actionId });
    const res = await dispatch(inp);
    expect(res.simulated).toBe(true);
    expect(res.status).toBe("simulated");
    expect(writeCalls).toBe(0);
    const rows = await ledger(inp.idempotencyKey);
    expect(rows.map((r) => r.status)).toEqual(["simulated"]);
  });

  // ═════════════════ HITL bắt buộc + gắn đúng lệnh ═════════════════
  it("lệnh ghi thật KHÔNG có actionId ⇒ PRECONDITION_FAILED, driver 0 lần, sổ 1 dòng rejected, không intent", async () => {
    const inp = input({ actionId: undefined });
    const res = await dispatch(inp);
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("PRECONDITION_FAILED");
    expect(writeCalls).toBe(0);
    const rows = await ledger(inp.idempotencyKey);
    expect(rows.map((r) => r.status)).toEqual(["rejected"]);
    expect(rows[0]!.errorText).toMatch(/^PRECONDITION_FAILED/);
  });

  it.each([
    ["tool khác (hàng công cụ lập trình AI, không có binding)", { tool: "apply_diff", bind: null }, {}],
    ["tool khác (binding của set_machine_param, lệnh khai machine_start)", {}, { tool: "machine_start" }],
    ["tag khác", {}, { writes: [{ tagKey: "other_sp", value: 42 }] }],
    ["giá trị khác", {}, { writes: [{ tagKey: "speed_sp", value: 43 }] }],
    ["giá trị khác KIỂU ('42' ≠ 42)", {}, { writes: [{ tagKey: "speed_sp", value: "42" }] }],
    ["adapter khác (binding cho adapter+1)", { bind: { adapterId: -1 } }, {}],
    ["commandType khác", {}, { commandType: "start" }],
  ] as const)("actionId gắn với lệnh khác — %s ⇒ từ chối, driver 0 lần, action KHÔNG bị tiêu thụ", async (_n, act, cmd) => {
    const actionId = await makeAction(act as Parameters<typeof makeAction>[0]);
    const res = await dispatch(input({ actionId, ...(cmd as Partial<DispatchInput> & { tool?: string }) }));
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("ACTION_BINDING_MISMATCH");
    expect(writeCalls).toBe(0);
    expect(await pendingStatus(actionId)).not.toBe("executed");
  });

  it("actionId 'executed' (đã dùng — dạng 594 hàng của công cụ lập trình AI) ⇒ NOT_CONFIRMED, driver 0 lần — kể cả khi binding khớp", async () => {
    const actionId = await makeAction({ status: "executed" });
    const inp = input({ actionId });
    const res = await dispatch(inp);
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("NOT_CONFIRMED");
    expect(writeCalls).toBe(0);
    const rows = await ledger(inp.idempotencyKey);
    expect(rows[0]!.errorText).toMatch(/status is 'executed'/);
  });

  it("actionId của người khác / 'proposed' / hết hạn ⇒ từ chối, driver 0 lần", async () => {
    const other = await makeAction({ userId: OTHER_USER });
    const proposed = await makeAction({ status: "proposed" });
    const expired = await makeAction({ expiresInMs: -1_000 });
    for (const actionId of [other, proposed, expired]) {
      const res = await dispatch(input({ actionId }));
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("NOT_CONFIRMED");
    }
    expect(writeCalls).toBe(0);
  });

  // ═════════════════ tiêu thụ đúng một lần ═════════════════
  it("★★ hai lượt SONG SONG cùng actionId, khoá idempotency KHÁC nhau ⇒ thiết bị bị ghi ĐÚNG 1 lần; lượt kia NOT_CONFIRMED", async () => {
    const actionId = await makeAction({});
    const [a, b] = await Promise.all([dispatch(input({ actionId })), dispatch(input({ actionId }))]);
    expect(writeCalls).toBe(1);
    const statuses = [a, b].map((r) => `${r.status}/${r.reason ?? ""}`).sort();
    expect(statuses).toEqual(["acked/", "rejected/NOT_CONFIRMED"]);
    expect(await pendingStatus(actionId)).toBe("executed");
  });

  it("★★ race CƯỠNG BỨC: giao dịch ngoài giữ khoá hàng action; 2 lượt dispatch (khoá khác nhau) dồn về CÙNG điểm rồi được thả cùng lúc ⇒ thiết bị bị ghi ĐÚNG 1 lần", async () => {
    const actionId = await makeAction({});
    const ext = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockedP = new Promise<void>((r) => (locked = r));
      const holder = ext.begin(async (tx) => {
        await tx`SELECT id FROM ai_pending_actions WHERE id = ${actionId} FOR UPDATE`;
        locked();
        await gate;
      });
      await lockedP;
      const both = Promise.all([dispatch(input({ actionId })), dispatch(input({ actionId }))]);
      await new Promise((r) => setTimeout(r, 500)); // cả hai lượt đã tới chỗ khoá hàng
      expect(writeCalls).toBe(0);
      release();
      await holder;
      const [a, b] = await both;
      expect(writeCalls).toBe(1);
      expect([a, b].map((r) => `${r.status}/${r.reason ?? ""}`).sort()).toEqual(["acked/", "rejected/NOT_CONFIRMED"]);
    } finally {
      await ext.end();
    }
  });

  it("★★ hai lượt SONG SONG cùng actionId VÀ cùng khoá idempotency ⇒ ghi ĐÚNG 1 lần; lượt kia không ghi (đang bay / cache)", async () => {
    const actionId = await makeAction({});
    const key = nextKey("same");
    const [a, b] = await Promise.all([
      dispatch(input({ actionId, idempotencyKey: key })),
      dispatch(input({ actionId, idempotencyKey: key })),
    ]);
    expect(writeCalls).toBe(1);
    expect([a, b].filter((r) => r.ok && r.status === "acked")).toHaveLength(1);
    const loser = [a, b].find((r) => !(r.ok && r.status === "acked"))!;
    expect(["DUPLICATE_IN_FLIGHT", "NOT_CONFIRMED"]).toContain(loser.reason);
  });

  it("★★ hai lượt SONG SONG cùng khoá idempotency, HAI action hợp lệ khác nhau ⇒ ghi ĐÚNG 1 lần; lượt kia DUPLICATE_IN_FLIGHT (khoá advisory), action của nó KHÔNG bị tiêu thụ", async () => {
    const a1 = await makeAction({});
    const a2 = await makeAction({});
    const key = nextKey("lock");
    const [r1, r2] = await Promise.all([
      dispatch(input({ actionId: a1, idempotencyKey: key })),
      dispatch(input({ actionId: a2, idempotencyKey: key })),
    ]);
    expect(writeCalls).toBe(1);
    const winner = [r1, r2].find((r) => r.ok)!;
    const loser = [r1, r2].find((r) => !r.ok)!;
    expect(winner.status).toBe("acked");
    expect(loser.reason).toBe("DUPLICATE_IN_FLIGHT");
    const loserAction = r1 === loser ? a1 : a2;
    expect(await pendingStatus(loserAction)).toBe("confirmed");
  });

  // ═════════════════ sổ ghi TRƯỚC thiết bị ═════════════════
  it("★ INSERT intent lỗi (CSDL từ chối giá trị NUL trong jsonb) ⇒ driver 0 lần, LEDGER_INTENT_FAILED, action KHÔNG bị tiêu thụ (rollback)", async () => {
    const writes = [{ tagKey: "label_sp", value: "A\u0000B" }];
    const actionId = await makeAction({ bind: { writes } });
    const inp = input({ actionId, writes });
    const res = await dispatch(inp);
    expect(writeCalls).toBe(0);
    expect(res.ok).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.reason).toBe("LEDGER_INTENT_FAILED");
    expect(await pendingStatus(actionId)).toBe("confirmed");
    expect(await ledger(inp.idempotencyKey)).toHaveLength(0);
  });

  it("intent có mà KHÔNG có kết quả (tiến trình chết giữa ghi và sổ) ⇒ gọi lại cùng khoá bị từ chối DUPLICATE_IN_FLIGHT, không ghi lại", async () => {
    const key = nextKey("orphan");
    // Mô phỏng một lượt trước đã giữ chỗ (intent) rồi chết trước khi ghi kết quả.
    await (await d()).insert(commandLog).values({
      adapterId,
      machineId: MACHINE,
      tagKey: "speed_sp",
      commandType: "set_param",
      requestedValue: 42 as any,
      requestedBy: OWNER,
      confirmedBy: OWNER,
      status: "sent",
      ackValue: { ledger: "intent" } as any,
      idempotencyKey: `intent:${key}:speed_sp:0`,
      sentAt: new Date(),
    });
    const actionId = await makeAction({});
    const res = await dispatch(input({ actionId, idempotencyKey: key }));
    expect(writeCalls).toBe(0);
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("DUPLICATE_IN_FLIGHT");
    expect(await pendingStatus(actionId)).toBe("confirmed");
  });

  // ═════════════════ safety ═════════════════
  it("★ safety preflight UNKNOWN ⇒ SAFETY_UNKNOWN, driver 0 lần, action không bị tiêu thụ", async () => {
    safetyState = "UNKNOWN";
    const actionId = await makeAction({});
    const res = await dispatch(input({ actionId }));
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("SAFETY_UNKNOWN");
    expect(writeCalls).toBe(0);
    expect(await pendingStatus(actionId)).toBe("confirmed");
  });

  it("safety preflight BLOCKED ⇒ SAFETY_BLOCKED (không đổi), driver 0 lần", async () => {
    safetyState = "BLOCKED";
    const actionId = await makeAction({});
    const res = await dispatch(input({ actionId }));
    expect(res.reason).toBe("SAFETY_BLOCKED");
    expect(writeCalls).toBe(0);
  });

  // ═════════════════ Sparkplug DCMD ═════════════════
  function sparkplugHandler() {
    return new SparkplugCommandHandler({
      subscribe: () => {},
      dispatch,
      onRebirth: () => {},
      resolveTarget: () => ({ machineId: MACHINE, adapterId }),
      metricToWrite: (m) => (typeof m.name === "string" && m.name ? { tagKey: m.name, value: m.value, commandType: "sparkplug.dcmd" } : null),
      systemUserId: 0,
      log: { warn: () => {}, error: () => {}, info: () => {} },
    });
  }

  it.each([["true"], ["false"]])(
    "★ Sparkplug DCMD KHÔNG có actionId (OT_CONTROL_ENABLED=%s) ⇒ rejected + ghi sổ, driver 0 lần, confirmedBy KHÔNG phải 0",
    async (ctl) => {
      process.env.OT_CONTROL_ENABLED = ctl;
      const before = Date.now();
      const payload = encodePayload({ metrics: [{ name: "cmd_run", type: "Boolean", value: true }] });
      await sparkplugHandler().handleMessage(`spBv1.0/${DAU}/DCMD/node1/dev1`, payload);
      expect(writeCalls).toBe(0);
      const rows = (await (await d()).select().from(commandLog).where(like(commandLog.idempotencyKey, `spcmd-${MACHINE}-DCMD-%`))).filter(
        (r) => r.createdAt.getTime() >= before - 1000 && r.adapterId === adapterId,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[rows.length - 1]!;
      expect(row.status).toBe("rejected");
      expect(row.errorText).toMatch(/^PRECONDITION_FAILED/);
      expect(row.confirmedBy).toBe(NO_CONFIRMER);
      expect(row.confirmedBy).not.toBe(0);
    },
  );

  it("Sparkplug DCMD mang actionId KHÔNG gắn (hàng của tool khác) ⇒ rejected, driver 0 lần — cả khi đường mô phỏng", async () => {
    process.env.OT_CONTROL_ENABLED = "false";
    const actionId = await makeAction({ tool: TOOL }); // tool ≠ sparkplug.command
    const payload = encodePayload({
      metrics: [
        { name: "cmd_run", type: "Boolean", value: true },
        { name: SPARKPLUG_ACTION_ID_METRIC, type: "String", value: actionId },
      ],
    });
    const spy = vi.fn(dispatch);
    const h = new SparkplugCommandHandler({
      subscribe: () => {},
      dispatch: spy,
      onRebirth: () => {},
      resolveTarget: () => ({ machineId: MACHINE, adapterId }),
      metricToWrite: (m) => (typeof m.name === "string" && m.name ? { tagKey: m.name, value: m.value, commandType: "sparkplug.dcmd" } : null),
      systemUserId: 0,
      log: { warn: () => {}, error: () => {}, info: () => {} },
    });
    await h.handleMessage(`spBv1.0/${DAU}/DCMD/node1/dev1`, payload);
    expect(spy).toHaveBeenCalledTimes(1);
    const res = await spy.mock.results[0]!.value;
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("ACTION_BINDING_MISMATCH");
    expect(writeCalls).toBe(0);
    // metric actionId KHÔNG bao giờ thành một lệnh ghi
    expect(spy.mock.calls[0]![0].writes).toEqual([{ tagKey: "cmd_run", value: true }]);
  });

  it("Sparkplug DCMD mang actionId gắn đúng nhưng ĐÃ 'executed' ⇒ rejected NOT_CONFIRMED ngay cả trên đường mô phỏng", async () => {
    process.env.OT_CONTROL_ENABLED = "false";
    const writes = [{ tagKey: "cmd_run", value: true }];
    const actionId = await makeAction({ status: "executed", tool: SPARKPLUG_COMMAND_TOOL, bind: { commandType: "sparkplug.dcmd", writes } });
    const payload = encodePayload({
      metrics: [
        { name: "cmd_run", type: "Boolean", value: true },
        { name: SPARKPLUG_ACTION_ID_METRIC, type: "String", value: actionId },
      ],
    });
    await sparkplugHandler().handleMessage(`spBv1.0/${DAU}/DCMD/node1/dev1`, payload);
    const rows = await (await d()).select().from(commandLog).where(eq(commandLog.actionId, actionId));
    expect(rows.map((r) => r.status)).toEqual(["rejected"]);
    expect(rows[0]!.errorText).toMatch(/^NOT_CONFIRMED/);
    expect(writeCalls).toBe(0);
  });

  it("Sparkplug DCMD mang actionId gắn đúng (tool sparkplug.command, confirmed) ⇒ ghi 1 lần, confirmedBy = chủ hàng; dùng lại ⇒ từ chối", async () => {
    const writes = [{ tagKey: "cmd_run", value: true }];
    const actionId = await makeAction({ tool: SPARKPLUG_COMMAND_TOOL, bind: { commandType: "sparkplug.dcmd", writes } });
    const payload = encodePayload({
      metrics: [
        { name: "cmd_run", type: "Boolean", value: true },
        { name: SPARKPLUG_ACTION_ID_METRIC, type: "String", value: actionId },
      ],
    });
    await sparkplugHandler().handleMessage(`spBv1.0/${DAU}/DCMD/node1/dev1`, payload);
    expect(writeCalls).toBe(1);
    expect(await pendingStatus(actionId)).toBe("executed");
    const rows = await (await d()).select().from(commandLog).where(eq(commandLog.actionId, actionId));
    expect(rows.map((r) => r.status).sort()).toEqual(["acked", "sent"]);
    expect(rows.every((r) => r.confirmedBy === OWNER)).toBe(true);

    await new Promise((r) => setTimeout(r, 5)); // khoá spcmd dùng Date.now()
    await sparkplugHandler().handleMessage(`spBv1.0/${DAU}/DCMD/node1/dev1`, payload);
    expect(writeCalls).toBe(1);
  });

  // ═════════════════ R4 — FOE vẫn chạy ═════════════════
  it("R4: bước FOE (tự tạo action confirmed + binding cùng hash) qua OtEquipmentAdapter ⇒ ghi 1 lần; bước khác không tái dùng được action đó", async () => {
    const { buildEquipmentCommand, ensureOrchestrationAction } = await import("../orchestration/foe/foeEngine");
    const { equipmentRegistry } = await import("../equipment/equipmentAdapter");
    const user = { id: OWNER, role: "engineer" } as never;
    const key = `${DAU}-run1-s1-a1`;
    const args = { adapterId, tagKey: "speed_sp", value: 7 };
    const descriptor = { name: "set_param", label: "p", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
    const cap = { adapterKind: "ot-stub" } as never;
    // doc 81 Đợt 4 Task A5 + fix round 1 (R-4-i) — the step rides on a REAL run (owner OWNER) whose gate OTHER_USER
    // approved through the server path; the dispatcher re-reads both from the DB.
    const fx = await makeFoeGateRun({ tag: `${DAU}-r4`, owner: OWNER, approvedBy: OTHER_USER });
    fixtures.push(fx);
    const approval = { runId: fx.runId, runOwner: OWNER, approvedBy: OTHER_USER, gateStepId: "g0" };
    const cmd = buildEquipmentCommand(descriptor, cap, MACHINE, args, key, user, approval);
    expect(cmd.hitl).toMatchObject({ requestedBy: OWNER, confirmedBy: OTHER_USER });
    await ensureOrchestrationAction(user, key, { id: "s1", type: "command" } as never, args, cmd, approval);
    const res = await equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
    expect(res.ok).toBe(true);
    expect(writeCalls).toBe(1);
    expect(writtenBatches[0]).toEqual([{ tagKey: "speed_sp", value: 7 }]);

    // Cùng actionId, lệnh khác (giá trị 8, khoá khác) ⇒ bị từ chối.
    const replay = await equipmentRegistry
      .getAdapter("ot-stub")
      .sendCommand({ ...cmd, idempotencyKey: `${key}-x`, writes: [{ tagKey: "speed_sp", value: 8 }] });
    expect(replay.ok).toBe(false);
    expect(writeCalls).toBe(1);
  });

  // ═════════════════ Đợt 4 A5 — lớp dispatcher: FOE không tự duyệt ═════════════════
  it("★ Đợt 4 A5 (verifyActionBinding): hàng FOE xác nhận bởi CHÍNH người chạy (cũ, hoặc người duyệt = người chạy) ⇒ NOT_CONFIRMED, 0 ghi, hàng vẫn confirmed", async () => {
    const { buildEquipmentCommand, ensureOrchestrationAction } = await import("../orchestration/foe/foeEngine");
    const { equipmentRegistry } = await import("../equipment/equipmentAdapter");
    const user = { id: OWNER, role: "engineer" } as never;
    const descriptor = { name: "set_param", label: "p", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
    const cap = { adapterKind: "ot-stub" } as never;
    const before = writeCalls;
    for (const [i, approval] of [[1, undefined], [2, { runId: 1, runOwner: OWNER, approvedBy: OWNER, gateStepId: "g0" }]] as const) {
      const key = `${DAU}-self${i}-s1-a1`;
      const args = { adapterId, tagKey: "speed_sp", value: 40 + i };
      const cmd = buildEquipmentCommand(descriptor, cap, MACHINE, args, key, user, approval);
      await ensureOrchestrationAction(user, key, { id: `self${i}`, type: "command" } as never, args, cmd, approval);
      const res = await equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
      expect(res.ok, `case ${i}`).toBe(false);
      const [row] = await (await d()).select().from(aiPendingActions).where(eq(aiPendingActions.id, cmd.hitl!.actionId));
      expect(row?.status, `case ${i}`).toBe("confirmed");
    }
    expect(writeCalls).toBe(before);
  });

  // ═════════════════ Đợt 4 fix round 1 (R-4-i) — lớp CSDL của dispatcher, đo RIÊNG từng lớp ═════════════════
  it("★ R-4-i: hàng FOE mà previewJson TỰ NHẤT QUÁN (lớp thuần qua) nhưng CSDL nói khác ⇒ NOT_CONFIRMED, 0 ghi, hàng vẫn confirmed", async () => {
    const { buildEquipmentCommand, ensureOrchestrationAction } = await import("../orchestration/foe/foeEngine");
    const { equipmentRegistry } = await import("../equipment/equipmentAdapter");
    const user = { id: OWNER, role: "engineer" } as never;
    const descriptor = { name: "set_param", label: "p", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
    const cap = { adapterKind: "ot-stub" } as never;
    const Z = OTHER_USER + 7;
    const cases: Array<[string, Parameters<typeof makeFoeGateRun>[0] | null]> = [
      ["run really owned by the confirmer", { tag: `${DAU}-i1`, owner: OTHER_USER, approvedBy: Z }],
      ["gate approved by someone else (not the confirmer)", { tag: `${DAU}-i2`, owner: OWNER, approvedBy: Z }],
      ["gate row edge-synced", { tag: `${DAU}-i3`, owner: OWNER, approvedBy: OTHER_USER, source: "edge" }],
      ["gate approval stale (redeploy)", { tag: `${DAU}-i4`, owner: OWNER, approvedBy: OTHER_USER, stale: true }],
      ["run without owner", { tag: `${DAU}-i5`, owner: null, approvedBy: OTHER_USER }],
      ["no gate row", { tag: `${DAU}-i6`, owner: OWNER, approvedBy: null }],
      ["run does not exist", null],
    ];
    const before = writeCalls;
    let i = 0;
    for (const [label, spec] of cases) {
      i += 1;
      const fx = spec ? await makeFoeGateRun(spec) : null;
      if (fx) fixtures.push(fx);
      // previewJson says what a VALID approval looks like: owner OWNER, approver OTHER_USER = confirmer.
      const approval = { runId: fx?.runId ?? 2_000_000_000, runOwner: OWNER, approvedBy: OTHER_USER, gateStepId: "g0" };
      const key = `${DAU}-dbl${i}-s1-a1`;
      const args = { adapterId, tagKey: "speed_sp", value: 60 + i };
      const cmd = buildEquipmentCommand(descriptor, cap, MACHINE, args, key, user, approval);
      await ensureOrchestrationAction(user, key, { id: `dbl${i}`, type: "command" } as never, args, cmd, approval);
      const res = await equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
      expect(res.ok, label).toBe(false);
      const [row] = await (await d()).select().from(aiPendingActions).where(eq(aiPendingActions.id, cmd.hitl!.actionId));
      expect(row?.status, label).toBe("confirmed");
    }
    expect(writeCalls).toBe(before);
  });

  it("★ lớp THUẦN đo riêng: CSDL hợp lệ (B duyệt gate) nhưng previewJson ghi người duyệt KHÁC người xác nhận ⇒ NOT_CONFIRMED (lớp CSDL một mình sẽ cho qua)", async () => {
    const { buildEquipmentCommand, ensureOrchestrationAction } = await import("../orchestration/foe/foeEngine");
    const { equipmentRegistry } = await import("../equipment/equipmentAdapter");
    const user = { id: OWNER, role: "engineer" } as never;
    const descriptor = { name: "set_param", label: "p", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
    const cap = { adapterKind: "ot-stub" } as never;
    const fx = await makeFoeGateRun({ tag: `${DAU}-pure`, owner: OWNER, approvedBy: OTHER_USER });
    fixtures.push(fx);
    const key = `${DAU}-pure-s1-a1`;
    const args = { adapterId, tagKey: "speed_sp", value: 77 };
    const real = { runId: fx.runId, runOwner: OWNER, approvedBy: OTHER_USER, gateStepId: "g0" };
    const cmd = buildEquipmentCommand(descriptor, cap, MACHINE, args, key, user, real);
    await ensureOrchestrationAction(user, key, { id: "pure", type: "command" } as never, args, cmd, real);
    // tamper ONLY the preview's claimed approver (row confirmer stays OTHER_USER = the real DB approver)
    const [row0] = await (await d()).select().from(aiPendingActions).where(eq(aiPendingActions.id, cmd.hitl!.actionId));
    const preview = { ...(row0!.previewJson as Record<string, unknown>), __foeGateApproval: { ...real, approvedBy: OTHER_USER + 9 } };
    await (await d()).update(aiPendingActions).set({ previewJson: preview }).where(eq(aiPendingActions.id, cmd.hitl!.actionId));
    const before = writeCalls;
    const res = await equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
    expect(res.ok).toBe(false);
    expect(writeCalls).toBe(before);
  });

  // ═════════════════ tool AI: propose (lưu binding) → confirm → execute → dispatch ═════════════════
  it("★ tool AI set_machine_param đi TRỌN HITL thật: proposeAction lưu binding (cùng helper) → confirmAction → execute ⇒ ghi 1 lần; confirm lại ⇒ không ghi lần 2", async () => {
    process.env.AI_OT_CONTROL_ENABLED = "true";
    await import("../aiLocalTools/writeHandlers/machineControl");
    const { getTool } = await import("../aiLocalTools/toolRegistry");
    const { proposeAction, confirmAction } = await import("../aiCopilotActions");
    const tool = getTool("set_machine_param")!;
    const admin = { id: OWNER, role: "admin", name: "t6" };
    const params = { machineId: MACHINE, tagKey: "speed_sp", value: 55 };
    const proposed = await proposeAction(tool, params, { user: admin, lang: "vi" });
    expect(proposed.ok).toBe(true);
    const actionId = (proposed as { pendingAction: { actionId: string } }).pendingAction.actionId;
    try {
      const [row] = await (await d()).select().from(aiPendingActions).where(eq(aiPendingActions.id, actionId)).limit(1);
      expect(row!.previewJson).toHaveProperty("__otPayloadHash");
      const res = await confirmAction(actionId, actionId, admin, "vi");
      expect(res.status).toBe("executed");
      expect(((res.result as { data?: { status?: string } }).data ?? {}).status).toBe("acked");
      expect(writeCalls).toBe(1);
      expect(writtenBatches[0]).toEqual([{ tagKey: "speed_sp", value: 55 }]);
      const again = await confirmAction(actionId, actionId, admin, "vi");
      expect(again.status).toBe("executed");
      expect(writeCalls).toBe(1);
    } finally {
      await (await d()).delete(aiPendingActions).where(eq(aiPendingActions.id, actionId));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 1B Task 6 — FIX ROUND 1: interlock rule pins the command exactly (R15 hardening);
// keys > 128 chars stay unique; command-log stats do not double-count write-ahead intents.
// ══════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!DB_URL)("Task 6 fix round 1 — interlock exact match, long keys, stats (DB thật)", () => {
  const MI = 990_600_011; // machine of the interlock/long-key adapter
  const MS = 990_600_012; // machine of the stats-only adapter
  const APPROVER = 990_600_201;
  let adI = 0;
  let adS = 0;
  let ruleReduce = 0;
  let ruleStop = 0;
  let evReduce = 0;
  let evStop = 0;
  let ruleObj = 0;
  let evObj = 0;

  async function makeAdapter(code: string, machineId: number) {
    const x = await d();
    const [a] = await x
      .insert(deviceAdapters)
      .values({ code: `${DAU}-${code}`, name: `${DAU} ${code}`, protocol: "stub", endpoint: "stub://t6f", isEnabled: true, machineId })
      .returning();
    await x.insert(deviceTags).values([
      { adapterId: a!.id, tagKey: "speed_sp", address: "D100", dataType: "int", writable: true },
      { adapterId: a!.id, tagKey: "other_sp", address: "D101", dataType: "int", writable: true },
      { adapterId: a!.id, tagKey: "label_sp", address: "D102", dataType: "string", writable: true },
      { adapterId: a!.id, tagKey: "cmd_run", address: "M10", dataType: "bool", writable: true },
    ]);
    fake.drivers.set(a!.id, fakeDriver);
    return a!.id;
  }

  async function makeRule(v: { action: "reduce_speed" | "stop_line" | "block_downstream"; commandTag: string; commandValue: unknown }) {
    const x = await d();
    const [rule] = await x
      .insert(interlockRules)
      .values({
        name: `${DAU} rule ${v.action}`,
        scope: "machine",
        machineId: MI,
        sourceType: "ng_rate",
        comparisonOperator: "gt",
        threshold: "99999",
        action: v.action,
        targetMachineId: MI,
        targetAdapterId: adI,
        commandTag: v.commandTag,
        commandValue: v.commandValue as never,
        requiresHumanConfirm: false,
        enabled: true,
        approvedBy: APPROVER,
        approvedAt: new Date(),
      })
      .returning();
    const [ev] = await x.insert(interlockEvents).values({ ruleId: rule!.id, action: v.action, status: "fired" }).returning();
    return { ruleId: rule!.id, eventId: ev!.id };
  }

  const ilInput = (
    r: { ruleId: number; eventId: number },
    over: { commandType?: string; writes?: Writes } = {},
  ): DispatchInput => ({
    adapterId: adI,
    machineId: MI,
    commandType: over.commandType ?? "reduce_speed",
    writes: over.writes ?? [{ tagKey: "speed_sp", value: 30 }],
    triggeredBy: { kind: "interlock", ruleId: r.ruleId, eventId: r.eventId, approvedBy: APPROVER },
    idempotencyKey: nextKey("il"),
  });

  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of [...ENV_KEYS, "INTERLOCK_AUTO_BLOCK_ENABLED"]) savedEnv[k] = process.env[k];
    adI = await makeAdapter("FI", MI);
    adS = await makeAdapter("FS", MS);
    ({ ruleId: ruleReduce, eventId: evReduce } = await makeRule({ action: "reduce_speed", commandTag: "speed_sp", commandValue: 30 }));
    ({ ruleId: ruleStop, eventId: evStop } = await makeRule({ action: "stop_line", commandTag: "cmd_run", commandValue: null }));
    ({ ruleId: ruleObj, eventId: evObj } = await makeRule({ action: "block_downstream", commandTag: "other_sp", commandValue: { pct: 30, mode: "slow" } }));
  }, 60_000);

  afterAll(async () => {
    const x = await d();
    // Disable first (belt and braces), then remove the fixtures.
    await x.update(interlockRules).set({ enabled: false }).where(like(interlockRules.name, `${DAU}%`));
    await x.delete(interlockEvents).where(eq(interlockEvents.ruleId, ruleReduce)).catch(() => {});
    await x.delete(interlockEvents).where(eq(interlockEvents.ruleId, ruleStop)).catch(() => {});
    await x.delete(interlockEvents).where(eq(interlockEvents.ruleId, ruleObj)).catch(() => {});
    await x.delete(interlockRules).where(like(interlockRules.name, `${DAU}%`)).catch(() => {});
    await x.delete(aiPendingActions).where(like(aiPendingActions.id, `${DAU}%`));
    for (const id of [adI, adS]) {
      fake.drivers.delete(id);
      await x.delete(deviceTags).where(eq(deviceTags.adapterId, id));
      await x.delete(deviceAdapters).where(eq(deviceAdapters.id, id));
    }
    for (const k of [...ENV_KEYS, "INTERLOCK_AUTO_BLOCK_ENABLED"]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }, 60_000);

  beforeEach(() => {
    writeCalls = 0;
    writtenBatches = [];
    safetyState = "OK";
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    delete process.env.OT_READBACK_ENABLED;
    delete process.env.OT_CMD_SERIALIZE_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.UNS_CMD_ACK_ENABLED;
  });

  // ───────────── (1) interlock rule pins the command exactly ─────────────
  it("interlock hợp lệ (đúng tag, đúng commandValue, đúng action, 1 write) ⇒ ghi ĐÚNG 1 lần, có intent + kết quả", async () => {
    const inp = ilInput({ ruleId: ruleReduce, eventId: evReduce });
    const res = await dispatch(inp);
    expect(res.status).toBe("acked");
    expect(writeCalls).toBe(1);
    expect(writtenBatches[0]).toEqual([{ tagKey: "speed_sp", value: 30 }]);
    const rows = await ledger(inp.idempotencyKey);
    expect(rows.map((r) => r.status).sort()).toEqual(["acked", "sent"]);
  });

  it("interlock commandValue null ⇒ giá trị mặc định true (đúng thứ interlockEngine gửi) ⇒ ghi 1 lần", async () => {
    const res = await dispatch(ilInput({ ruleId: ruleStop, eventId: evStop }, { commandType: "stop_line", writes: [{ tagKey: "cmd_run", value: true }] }));
    expect(res.status).toBe("acked");
    expect(writeCalls).toBe(1);
  });

  it("interlock commandValue là OBJECT (jsonb) — lệnh mang cùng giá trị, khác thứ tự khoá ⇒ so theo dạng chuẩn hoá ⇒ ghi 1 lần; khác một trường ⇒ VALUE_MISMATCH", async () => {
    const r = { ruleId: ruleObj, eventId: evObj };
    const ok = await dispatch(ilInput(r, { commandType: "block_downstream", writes: [{ tagKey: "other_sp", value: { mode: "slow", pct: 30 } }] }));
    expect(ok.status).toBe("acked");
    expect(writeCalls).toBe(1);
    const bad = await dispatch(ilInput(r, { commandType: "block_downstream", writes: [{ tagKey: "other_sp", value: { mode: "slow", pct: 31 } }] }));
    expect(bad.reason).toBe("INTERLOCK_VALUE_MISMATCH");
    expect(writeCalls).toBe(1);
  });

  it.each([
    ["giá trị khác (reduce_speed đặt speed_sp=9999)", "INTERLOCK_VALUE_MISMATCH", { writes: [{ tagKey: "speed_sp", value: 9999 }] }, "reduce"],
    ["giá trị khác KIỂU ('30' ≠ 30)", "INTERLOCK_VALUE_MISMATCH", { writes: [{ tagKey: "speed_sp", value: "30" }] }, "reduce"],
    ["commandValue null ⇒ chỉ true được phép (1 ≠ true)", "INTERLOCK_VALUE_MISMATCH", { commandType: "stop_line", writes: [{ tagKey: "cmd_run", value: 1 }] }, "stop"],
    ["write thừa trên tag khác", "INTERLOCK_WRITES_MISMATCH", { writes: [{ tagKey: "speed_sp", value: 30 }, { tagKey: "other_sp", value: 1 }] }, "reduce"],
    ["write thừa trùng tag lệnh (2 write)", "INTERLOCK_WRITES_MISMATCH", { writes: [{ tagKey: "speed_sp", value: 30 }, { tagKey: "speed_sp", value: 30 }] }, "reduce"],
    ["tag khác", "INTERLOCK_TAG_MISMATCH", { writes: [{ tagKey: "other_sp", value: 30 }] }, "reduce"],
    ["commandType ≠ rule.action", "INTERLOCK_COMMAND_MISMATCH", { commandType: "stop_line" }, "reduce"],
  ] as const)("interlock %s ⇒ rejected %s + ghi sổ, driver 0 lần", async (_n, reason, over, which) => {
    const r = which === "reduce" ? { ruleId: ruleReduce, eventId: evReduce } : { ruleId: ruleStop, eventId: evStop };
    const inp = ilInput(r, over as { commandType?: string; writes?: Writes });
    const res = await dispatch(inp);
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe(reason);
    expect(writeCalls).toBe(0);
    const rows = await ledger(inp.idempotencyKey);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row.status === "rejected" && String(row.errorText).startsWith(reason))).toBe(true);
  });

  // ───────────── (3) idempotency keys > 128 chars ─────────────
  it("khoá idempotency DÀI (150 ký tự) + 3 write ⇒ 3 intent + 3 kết quả, khoá KHÁC nhau, ≤128, gắn đúng cặp; ghi 1 lần", async () => {
    const writes = [
      { tagKey: "speed_sp", value: 11 },
      { tagKey: "other_sp", value: 12 },
      { tagKey: "label_sp", value: "x" },
    ];
    const actionId = await makeAction({ bind: { adapterId: adI, machineId: MI, writes } });
    const key = `${DAU}-long-${"k".repeat(150)}`;
    const res = await dispatch({ ...input({ actionId, writes }), adapterId: adI, machineId: MI, idempotencyKey: key });
    expect(res.status).toBe("acked");
    expect(writeCalls).toBe(1);
    const rows = await ledger(key.slice(0, 60));
    const intents = rows.filter((r) => (r.ackValue as { ledger?: string } | null)?.ledger === "intent");
    const results = rows.filter((r) => (r.ackValue as { ledger?: string } | null)?.ledger === "result");
    expect(intents).toHaveLength(3);
    expect(results).toHaveLength(3);
    const keys = rows.map((r) => r.idempotencyKey!);
    expect(new Set(keys).size).toBe(6);
    expect(keys.every((k) => k.length <= 128)).toBe(true);
    expect(new Set(results.map((r) => (r.ackValue as { intentId: number }).intentId))).toEqual(new Set(intents.map((r) => r.id)));
    // Replaying the same long key ⇒ cached, no second write.
    const again = await dispatch({ ...input({ actionId, writes }), adapterId: adI, machineId: MI, idempotencyKey: key });
    expect(again.status).toBe("acked");
    expect(writeCalls).toBe(1);
  });

  it("khoá kết quả VỪA ≤128 nhưng khoá intent >128, 2 write cùng tag (khác nhau đúng ':0'/':1') ⇒ 2 intent khác nhau, ghi 1 lần", async () => {
    const writes = [
      { tagKey: "speed_sp", value: 1 },
      { tagKey: "speed_sp", value: 2 },
    ];
    const actionId = await makeAction({ bind: { adapterId: adI, machineId: MI, writes } });
    const head = `${DAU}-edge-`;
    const key = head + "e".repeat(114 - head.length); // result key = 114 + ':speed_sp:N' = 125 chars
    expect(`${key}:speed_sp:0`.length).toBe(125);
    const res = await dispatch({ ...input({ actionId, writes }), adapterId: adI, machineId: MI, idempotencyKey: key });
    expect(res.status).toBe("acked");
    expect(writeCalls).toBe(1);
    const rows = await ledger(key.slice(0, 60));
    expect(rows.filter((r) => (r.ackValue as { ledger?: string } | null)?.ledger === "intent")).toHaveLength(2);
    expect(rows.map((r) => r.idempotencyKey)).toEqual(expect.arrayContaining([`${key}:speed_sp:0`, `${key}:speed_sp:1`]));
  });

  it("hai khoá dài KHÁC nhau chỉ ở đuôi (chung 128 ký tự đầu) ⇒ HAI lệnh độc lập, không cache/DUPLICATE giả", async () => {
    const writes = [{ tagKey: "speed_sp", value: 21 }];
    const common = `${DAU}-tail-${"p".repeat(140)}`;
    const a1 = await makeAction({ bind: { adapterId: adI, machineId: MI, writes } });
    const a2 = await makeAction({ bind: { adapterId: adI, machineId: MI, writes } });
    const r1 = await dispatch({ ...input({ actionId: a1, writes }), adapterId: adI, machineId: MI, idempotencyKey: `${common}-A` });
    const r2 = await dispatch({ ...input({ actionId: a2, writes }), adapterId: adI, machineId: MI, idempotencyKey: `${common}-B` });
    expect(r1.status).toBe("acked");
    expect(r2.status).toBe("acked");
    expect(writeCalls).toBe(2);
  });

  // ───────────── (2) stats do not double-count intents ─────────────
  it("commandLog.stats: 1 ghi thật + 1 từ chối + 1 intent mồ côi ⇒ byStatus KHÔNG có 'sent' (không đếm 2 lần), intents {total 2, open 1}", async () => {
    const writes = [{ tagKey: "speed_sp", value: 5 }];
    const actionId = await makeAction({ bind: { adapterId: adS, machineId: MS, writes } });
    const ok = await dispatch({ ...input({ actionId, writes }), adapterId: adS, machineId: MS });
    expect(ok.status).toBe("acked");
    const rej = await dispatch({ ...input({ actionId: undefined, writes }), adapterId: adS, machineId: MS });
    expect(rej.reason).toBe("PRECONDITION_FAILED");
    await (await d()).insert(commandLog).values({
      adapterId: adS,
      machineId: MS,
      tagKey: "speed_sp",
      commandType: "set_param",
      requestedValue: 5 as any,
      requestedBy: OWNER,
      confirmedBy: OWNER,
      status: "sent",
      ackValue: { ledger: "intent" } as any,
      idempotencyKey: `intent:${nextKey("orphanS")}:speed_sp:0`,
      sentAt: new Date(),
    });

    const { commandLogRouter } = await import("../../routers/commandLogRouter");
    const caller = commandLogRouter.createCaller({ user: { id: OWNER, role: "admin", name: "t6" } } as never);
    const st = await caller.stats({ sinceHours: 1, adapterId: adS });
    const byStatus = Object.fromEntries(st.byStatus.map((r) => [r.status, r.count]));
    expect(byStatus).toEqual({ acked: 1, rejected: 1 });
    expect(Object.fromEntries(st.byTrigger.map((r) => [r.triggerKind, r.count]))).toEqual({ hitl: 2 });
    expect(st.intents).toEqual({ total: 2, open: 1 });
  });
});
