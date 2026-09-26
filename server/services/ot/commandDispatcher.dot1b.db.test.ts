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

vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => fake.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
  };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { dispatch, NO_CONFIRMER, type DispatchInput } from "./commandDispatcher";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
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
    const cmd = buildEquipmentCommand(descriptor, cap, MACHINE, args, key, user);
    await ensureOrchestrationAction(user, key, { id: "s1", type: "command" } as never, args, cmd);
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
