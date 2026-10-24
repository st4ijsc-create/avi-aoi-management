/**
 * SCADA R1a Task 3 (K4) — cổng LOẠI KÊNH + DẢI/BƯỚC ghi trong `dispatchCore`, áp cho MỌI người gọi `dispatch()`.
 * CSDL THẬT (`_test`, ép bởi vitest.setup): command_log WORM, ai_pending_actions FOR UPDATE/CAS chỉ kiểm được trên Postgres thật.
 *
 * Thiết bị: MỘT driver giả trong tiến trình thay `getActiveDriver` cho đúng adapter của test (khuôn
 * commandDispatcher.dot1b.db.test.ts:27-42); nó ĐẾM `writeTags` và GHI LẠI giá trị nhận được (oracle độc lập: thiết bị nhận gì).
 * Mọi thứ khác là mã sản phẩm thật.
 *
 * Bố trí tag (cột mới của mig 0431 điền thẳng vào DB):
 *   in_ro     float, writable=true, channel_kind='input'                 ⇒ CHANNEL_READ_ONLY
 *   nhiet_sp  float, write_min 240, write_max 250, write_step 0.5         ⇒ dải + bước; "245" ⇒ 245
 *   toc_do    int,   write_min 10, write_max 100, stop_value 0 (NGOÀI dải — dữ liệu cũ ghi thẳng DB)
 *   cu        int,   mọi cột mới NULL                                     ⇒ hành vi cũ (không ép kiểu, không kiểm)
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { eq, like, sql } from "drizzle-orm";

const fake = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
}));

// Nguồn safety-PLC nền của facade THẬT được giả (khuôn dot1b): OK ⇒ PLC thật đọc sạch. Endpoint TEST-NET-1, không bao giờ nối.
vi.mock("../safety/plc/safetyPlcAdapter", async importOriginal => {
  const orig =
    await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [
      {
        code: "R1A-T3-SPLC",
        backend: "modbus",
        endpoint: "tcp://192.0.2.1:502",
        statusMap: { estop: { address: "coil:1" } },
      },
    ],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});

vi.mock("./otManager", async importOriginal => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) =>
      fake.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    // fix round 1 (M-4) — the running connection's fingerprint (5a-stop: the pin is honoured only on a connection made for the
    // adapter's CURRENT target), as pinnedStop.dot1d.db.test.ts does.
    getActiveConnectionFingerprint: (adapterId: number) => fake.fingerprints.get(adapterId),
  };
});

import { getDb } from "../../db/connection";
import {
  aiPendingActions,
  commandLog,
  deviceAdapters,
  deviceTags,
  interlockEvents,
  interlockRules,
} from "../../../drizzle/schema";
import { dispatch, type DispatchInput } from "./commandDispatcher";
import { inverseScale } from "./drivers/otScale";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";

const DB_URL = process.env.DATABASE_URL;
const DAU = `R1AT3-${Date.now()}`;
const OWNER = 990_631_101;
const APPROVER = 990_631_201;
const MACHINE = 990_631_001;
const TOOL = "set_machine_param";

// ── driver giả: đếm số lần thiết bị bị ghi + giá trị nhận được ─────────────────
let writeCalls = 0;
let writtenBatches: Array<Array<{ tagKey: string; value: unknown }>> = [];
/** kiem-dinh P1-3 — số THÔ một driver thật sẽ ghi (`inverseScale` trên đúng write driver nhận). */
let rawBatches: Array<Array<{ tagKey: string; raw: unknown }>> = [];
const fakeDriver = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string; value: unknown; dataType?: "int" | "float"; scale?: number; offset?: number }>) {
    writeCalls++;
    writtenBatches.push(
      writes.map(w => ({ tagKey: w.tagKey, value: w.value }))
    );
    rawBatches.push(writes.map(w => ({ tagKey: w.tagKey, raw: w.dataType ? inverseScale(w.value, w.dataType, w.scale ?? 1, w.offset ?? 0) : w.value })));
    return writes.map(w => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags() {
    return [];
  },
  async getSafetyStatus() {
    return { state: "OK", source: "fake-driver", ts: new Date().toISOString() };
  },
};

let adapterId = 0;
let ruleId = 0;
let eventId = 0;
let seq = 0;
const nextKey = (label: string) => `${DAU}-${label}-${++seq}`;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

type Writes = Array<{ tagKey: string; value: unknown }>;

/** Pending action đúng như nơi tạo của sản phẩm lưu (cùng helper otActionBinding). */
async function makeAction(bind: {
  commandType?: string;
  writes: Writes;
  tool?: string;
}): Promise<string> {
  const id = `${DAU}-act-${++seq}`;
  const tool = bind.tool ?? TOOL;
  await (await d()).insert(aiPendingActions).values({
    id,
    tool,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} test action`,
    previewJson: withOtPayloadHash(
      { entityType: "machine" },
      otPayloadHash({
        tool,
        adapterId,
        machineId: MACHINE,
        commandType: bind.commandType ?? "set_param",
        writes: bind.writes,
      })
    ),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return id;
}

function input(
  over: Partial<DispatchInput> & {
    actionId?: string;
    tool?: string;
    requireBoundAction?: boolean;
  } = {}
): DispatchInput {
  const { actionId, tool, requireBoundAction, ...rest } = over;
  return {
    adapterId,
    machineId: MACHINE,
    commandType: "set_param",
    writes: [{ tagKey: "nhiet_sp", value: 245 }],
    triggeredBy: requireBoundAction
      ? {
          kind: "hitl",
          actionId,
          tool: tool ?? TOOL,
          requestedBy: OWNER,
          requireBoundAction: true,
        }
      : {
          kind: "hitl",
          actionId,
          tool: tool ?? TOOL,
          confirmedBy: OWNER,
          requestedBy: OWNER,
        },
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

/** jsonb_typeof của requestedValue — drizzle `jsonb()` parse lại chuỗi ("245" ⇒ 245) nên đọc qua drizzle KHÔNG phân biệt được. */
async function requestedTypes(base: string): Promise<string[]> {
  const rows = (await (
    await d()
  ).execute(
    sql`SELECT jsonb_typeof("requestedValue") AS t FROM command_log WHERE "idempotencyKey" LIKE ${`%${base}%`} ORDER BY id`
  )) as unknown as Array<{ t: string }>;
  return rows.map(r => r.t);
}

async function pendingStatus(id: string) {
  const [row] = await (await d())
    .select()
    .from(aiPendingActions)
    .where(eq(aiPendingActions.id, id))
    .limit(1);
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
  "INTERLOCK_AUTO_BLOCK_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)(
  "R1a T3 — dispatch: cổng loại kênh + dải/bước ghi cho mọi người gọi (DB thật)",
  () => {
    beforeAll(async () => {
      expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
      for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
      await import("./adapterFacade");
      await import("../safety/plc/safetyPlcAdapter");
      const x = await d();
      // Dọn adapter mồ côi của lượt trước bị ngắt (máy tổng hợp cố định).
      const old = await x
        .select({ id: deviceAdapters.id })
        .from(deviceAdapters)
        .where(eq(deviceAdapters.machineId, MACHINE));
      for (const a of old) {
        await x.delete(deviceTags).where(eq(deviceTags.adapterId, a.id));
        await x.delete(deviceAdapters).where(eq(deviceAdapters.id, a.id));
      }
      const [a] = await x
        .insert(deviceAdapters)
        .values({
          code: `${DAU}-A`,
          name: `${DAU} adapter`,
          protocol: "stub",
          endpoint: "stub://r1a-t3",
          isEnabled: true,
          machineId: MACHINE,
        })
        .returning();
      adapterId = a!.id;
      await x.insert(deviceTags).values([
        {
          adapterId,
          tagKey: "in_ro",
          address: "D200",
          dataType: "float",
          writable: true,
          channelKind: "input",
        },
        {
          adapterId,
          tagKey: "nhiet_sp",
          address: "D201",
          dataType: "float",
          writable: true,
          writeMin: 240,
          writeMax: 250,
          writeStep: 0.5,
        },
        // stop_value NGOÀI dải ghi thẳng DB (mô phỏng dữ liệu có trước Task 12 — nhất quán dải ↔ ghim kiểm lúc cấu hình ở Task 12).
        {
          adapterId,
          tagKey: "toc_do",
          address: "D202",
          dataType: "int",
          writable: true,
          writeMin: 10,
          writeMax: 100,
          stopValue: 0,
        },
        {
          adapterId,
          tagKey: "cu",
          address: "D203",
          dataType: "int",
          writable: true,
        },
        // fix round 1 (M-1) — a NON-writable tag, for TAG_NOT_WRITABLE at write index ≥ 1
        { adapterId, tagKey: "ro_kv", address: "D204", dataType: "int", writable: false },
        // kiem-dinh P1-3 — int, scale 10: ĐÃ khai (dải 0..300) / CHƯA khai (cột 0431 NULL)
        { adapterId, tagKey: "sc10", address: "D205", dataType: "int", writable: true, writeMin: 0, writeMax: 300, scale: "10" },
        { adapterId, tagKey: "sc10cu", address: "D206", dataType: "int", writable: true, scale: "10" },
      ]);
      fake.drivers.set(adapterId, fakeDriver);
      fake.fingerprints.set(
        adapterId,
        adapterTargetFingerprint({ protocol: "stub", endpoint: "stub://r1a-t3", machineId: MACHINE, connectionOptions: null }),
      );
    }, 60_000);

    afterAll(async () => {
      fake.drivers.clear();
      const x = await d();
      await x
        .update(interlockRules)
        .set({ enabled: false })
        .where(like(interlockRules.name, `${DAU}%`));
      if (ruleId)
        await x
          .delete(interlockEvents)
          .where(eq(interlockEvents.ruleId, ruleId))
          .catch(() => {});
      await x
        .delete(interlockRules)
        .where(like(interlockRules.name, `${DAU}%`))
        .catch(() => {});
      await x
        .delete(aiPendingActions)
        .where(like(aiPendingActions.id, `${DAU}%`));
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
      rawBatches = [];
      process.env.OT_CONTROL_ENABLED = "false"; // mặc định: đường mô phỏng — cổng mới phải chạy TRƯỚC cổng chế độ OT
      process.env.OT_COMMISSIONING_REQUIRED = "false";
      delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
      delete process.env.OT_READBACK_ENABLED;
      delete process.env.OT_CMD_SERIALIZE_ENABLED;
      delete process.env.SEC_PLATFORM;
      delete process.env.UNS_CMD_ACK_ENABLED;
      delete process.env.AI_OT_CONTROL_ENABLED;
      delete process.env.PARAM_GUARDRAIL_ENABLED;
      delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
    });

    // ═════════════════ loại kênh ═════════════════
    it("tag channel_kind='input' nhưng writable=true ⇒ rejected CHANNEL_READ_ONLY, 1 dòng command_log, driver 0 lần, action KHÔNG bị tiêu thụ (OT bật)", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "in_ro", value: 1.5 }];
      const actionId = await makeAction({ writes });
      const inp = input({ actionId, writes });
      const res = await dispatch(inp);
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("CHANNEL_READ_ONLY");
      expect(writeCalls).toBe(0);
      const rows = await ledger(inp.idempotencyKey);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("rejected");
      expect(rows[0]!.tagKey).toBe("in_ro");
      expect(rows[0]!.address).toBe("D200");
      expect(rows[0]!.errorText).toMatch(/^CHANNEL_READ_ONLY: /);
      expect(await pendingStatus(actionId)).toBe("confirmed");
    });

    // ═════════════════ dải / bước ═════════════════
    it("dải 240..250 + giá trị 251 ⇒ OUT_OF_RANGE (OT TẮT — bị từ chối TRƯỚC cổng chế độ, không phải simulated), 1 dòng", async () => {
      const inp = input({ writes: [{ tagKey: "nhiet_sp", value: 251 }] });
      const res = await dispatch(inp);
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("OUT_OF_RANGE");
      expect(res.simulated).toBe(false);
      expect(writeCalls).toBe(0);
      const rows = await ledger(inp.idempotencyKey);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.errorText).toMatch(
        /^OUT_OF_RANGE: Tag "nhiet_sp": .*251/
      );
    });

    it("dải 240..250 + giá trị 251 với action gắn đúng (OT BẬT) ⇒ OUT_OF_RANGE, driver 0 lần, action KHÔNG bị tiêu thụ", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "nhiet_sp", value: 251 }];
      const actionId = await makeAction({ writes });
      const res = await dispatch(input({ actionId, writes }));
      expect(res.reason).toBe("OUT_OF_RANGE");
      expect(writeCalls).toBe(0);
      expect(await pendingStatus(actionId)).toBe("confirmed");
    });

    it("bước 0.5 + 240.2 ⇒ OFF_STEP, chi tiết mang goiY (240)", async () => {
      const inp = input({ writes: [{ tagKey: "nhiet_sp", value: 240.2 }] });
      const res = await dispatch(inp);
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("OFF_STEP");
      const rows = await ledger(inp.idempotencyKey);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.errorText).toMatch(
        /^OFF_STEP: Tag "nhiet_sp": .*\(goiY=240\)$/
      );
    });

    it("kiểu sai trên tag đã khai ('abc' cho float) ⇒ TYPE_MISMATCH", async () => {
      const res = await dispatch(
        input({ writes: [{ tagKey: "nhiet_sp", value: "abc" }] })
      );
      expect(res.reason).toBe("TYPE_MISMATCH");
    });

    it("lệnh nhiều write: tag đầu hợp lệ, tag sau ngoài dải ⇒ cả lệnh bị từ chối, dòng sổ của tag vi phạm", async () => {
      const inp = input({
        writes: [
          { tagKey: "nhiet_sp", value: 245 },
          { tagKey: "toc_do", value: 101 },
        ],
      });
      const res = await dispatch(inp);
      expect(res.reason).toBe("OUT_OF_RANGE");
      const rows = await ledger(inp.idempotencyKey);
      expect(rows.map(r => r.tagKey)).toEqual(["toc_do"]);
    });

    // ═════════════════ STOP ghim được miễn dải/bước (điều phối 2026-10-24 mục 4) ═════════════════
    it("STOP ghim (stop_value 0 NGOÀI dải 10..100) ⇒ KHÔNG bị OUT_OF_RANGE, đi tiếp các cổng như trước (simulated, giá trị 0)", async () => {
      const inp = input({
        commandType: "stop",
        writes: [{ tagKey: "toc_do", value: 0 }],
      });
      const res = await dispatch(inp);
      expect(res.reason).not.toBe("OUT_OF_RANGE");
      expect(res.status).toBe("simulated");
      const rows = await ledger(inp.idempotencyKey);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.requestedValue).toBe(0);
    });

    it('STOP ghim dạng chuỗi "0" trên tag ĐÃ khai ⇒ ép kiểu 0 = stop_value ⇒ vẫn miễn (simulated, ghi số 0)', async () => {
      const inp = input({
        commandType: "stop",
        writes: [{ tagKey: "toc_do", value: "0" }],
      });
      const res = await dispatch(inp);
      expect(res.status).toBe("simulated");
      expect(await requestedTypes(inp.idempotencyKey)).toEqual(["number"]);
    });

    it("lệnh stop với giá trị KHÁC stop_value và ngoài dải ⇒ OUT_OF_RANGE", async () => {
      const res = await dispatch(
        input({ commandType: "stop", writes: [{ tagKey: "toc_do", value: 5 }] })
      );
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("OUT_OF_RANGE");
    });

    it("đúng giá trị ghim nhưng lệnh KHÔNG phải kiểu dừng (set_param) ⇒ OUT_OF_RANGE (miễn theo dữ liệu CẦN cả kiểu dừng)", async () => {
      const res = await dispatch(
        input({
          commandType: "set_param",
          writes: [{ tagKey: "toc_do", value: 0 }],
        })
      );
      expect(res.reason).toBe("OUT_OF_RANGE");
    });

    // ═════════════════ mọi người gọi: interlock ═════════════════
    it("lệnh INTERLOCK (luật đã duyệt) mang giá trị ngoài dải đã khai ⇒ OUT_OF_RANGE, driver 0 lần (OT bật)", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
      // Luật tạo TRONG test và tắt ngay sau: một luật bật nhắm adapter này sẽ chen vào cổng interlock (5a-bis) của các test HITL khác.
      const x = await d();
      const [rule] = await x
        .insert(interlockRules)
        .values({
          name: `${DAU} rule reduce_speed`,
          scope: "machine",
          machineId: MACHINE,
          sourceType: "ng_rate",
          comparisonOperator: "gt",
          threshold: "99999",
          action: "reduce_speed",
          targetMachineId: MACHINE,
          targetAdapterId: adapterId,
          commandTag: "nhiet_sp",
          commandValue: 251 as never, // luật CŨ mang giá trị ngoài dải đã khai
          requiresHumanConfirm: false,
          enabled: true,
          approvedBy: APPROVER,
          approvedAt: new Date(),
        })
        .returning();
      ruleId = rule!.id;
      const [ev] = await x
        .insert(interlockEvents)
        .values({ ruleId, action: "reduce_speed", status: "fired" })
        .returning();
      eventId = ev!.id;
      try {
        const inp: DispatchInput = {
          adapterId,
          machineId: MACHINE,
          commandType: "reduce_speed",
          writes: [{ tagKey: "nhiet_sp", value: 251 }],
          triggeredBy: {
            kind: "interlock",
            ruleId,
            eventId,
            approvedBy: APPROVER,
          },
          idempotencyKey: nextKey("il"),
        };
        const res = await dispatch(inp);
        expect(res.status).toBe("rejected");
        expect(res.reason).toBe("OUT_OF_RANGE");
        expect(writeCalls).toBe(0);
      } finally {
        await x
          .update(interlockRules)
          .set({ enabled: false })
          .where(eq(interlockRules.id, ruleId));
      }
    });

    // ═════════════════ mọi cột NULL ⇒ hành vi cũ ═════════════════
    // ═════════════════ fix round 1 ═════════════════
    it("M-2: stop [tag ghim = giá trị ghim (NGOÀI dải), tag khác TRONG dải] ⇒ KHÔNG miễn (miễn chỉ khi CẢ lệnh là STOP ghim) ⇒ OUT_OF_RANGE trên tag ghim", async () => {
      const inp = input({
        commandType: "stop",
        writes: [
          { tagKey: "toc_do", value: 0 },
          { tagKey: "nhiet_sp", value: 245 },
        ],
      });
      const res = await dispatch(inp);
      expect(res.reason).toBe("OUT_OF_RANGE");
      const rows = await ledger(inp.idempotencyKey);
      expect(rows.map(r => r.tagKey)).toEqual(["toc_do"]);
    });

    it("M-2: stop [tag ghim = giá trị ghim, tag khác NGOÀI dải] ⇒ OUT_OF_RANGE", async () => {
      const res = await dispatch(
        input({
          commandType: "stop",
          writes: [
            { tagKey: "toc_do", value: 0 },
            { tagKey: "nhiet_sp", value: 251 },
          ],
        })
      );
      expect(res.reason).toBe("OUT_OF_RANGE");
    });

    it("fix round 2 (M-2 dư): stop [tag ghim = giá trị ghim (NGOÀI dải), tag CHƯA khai không ghim] ⇒ KHÔNG miễn ⇒ OUT_OF_RANGE trên tag ghim", async () => {
      const inp = input({
        commandType: "stop",
        writes: [
          { tagKey: "toc_do", value: 0 },
          { tagKey: "cu", value: 42 },
        ],
      });
      const res = await dispatch(inp);
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("OUT_OF_RANGE");
      const rows = await ledger(inp.idempotencyKey);
      expect(rows.map(r => r.tagKey)).toEqual(["toc_do"]);
    });

    it("M-1: lệnh nhiều write bị từ chối ở write #1 (OUT_OF_RANGE), gọi lại CÙNG khoá ⇒ trả từ chối đã lưu, không ném, sổ vẫn 1 dòng (khoá mang chỉ số GỐC)", async () => {
      const inp = input({
        writes: [
          { tagKey: "nhiet_sp", value: 245 },
          { tagKey: "toc_do", value: 101 },
        ],
      });
      const r1 = await dispatch(inp);
      expect(r1.reason).toBe("OUT_OF_RANGE");
      const r2 = await dispatch({ ...inp });
      expect(r2.status).toBe("rejected");
      expect(r2.reason).toMatch(/^OUT_OF_RANGE: /); // cachedResult: reason = errorText của dòng đã lưu
      expect(r2.commandLogIds).toEqual(r1.commandLogIds);
      const rows = await ledger(inp.idempotencyKey);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.idempotencyKey).toBe(`${inp.idempotencyKey}:toc_do:1`);
    });

    it("M-1: TAG_NOT_WRITABLE ở write #1, gọi lại CÙNG khoá ⇒ cùng hành vi (trả từ chối đã lưu, không ném)", async () => {
      const inp = input({
        writes: [
          { tagKey: "nhiet_sp", value: 245 },
          { tagKey: "ro_kv", value: 1 },
        ],
      });
      const r1 = await dispatch(inp);
      expect(r1.reason).toBe("TAG_NOT_WRITABLE");
      const r2 = await dispatch({ ...inp });
      expect(r2.status).toBe("rejected");
      expect(r2.reason).toMatch(/^TAG_NOT_WRITABLE: /);
      expect(r2.commandLogIds).toEqual(r1.commandLogIds);
      const rows = await ledger(inp.idempotencyKey);
      expect(rows.map(r => r.idempotencyKey)).toEqual([`${inp.idempotencyKey}:ro_kv:1`]);
    });

    it("M-4: STOP ghim gửi \"0\" (ép kiểu ⇒ 0) với OT BẬT, commissioning tắt ⇒ 5a-stop phân loại là STOP GHIM (pinnedStop), thiết bị nhận số 0", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const actionId = await makeAction({ commandType: "stop", writes: [{ tagKey: "toc_do", value: 0 }] });
      const inp = input({ actionId, commandType: "stop", writes: [{ tagKey: "toc_do", value: "0" }] });
      const res = await dispatch(inp);
      expect(res.reason).toBeUndefined();
      expect(res.status).toBe("acked");
      expect(res.pinnedStop).toBe(true);
      expect(writtenBatches[0]).toEqual([{ tagKey: "toc_do", value: 0 }]);
      expect(await pendingStatus(actionId)).toBe("executed");
    });

    it("hồi quy: mọi cột mới NULL ⇒ lệnh hitl hợp lệ đi tới simulated như trước", async () => {
      const inp = input({ writes: [{ tagKey: "cu", value: 42 }] });
      const res = await dispatch(inp);
      expect(res.status).toBe("simulated");
      expect(res.ok).toBe(true);
      const rows = await ledger(inp.idempotencyKey);
      expect(rows.map(r => r.status)).toEqual(["simulated"]);
      expect(rows[0]!.requestedValue).toBe(42);
    });

    it('hồi quy: mọi cột mới NULL ⇒ KHÔNG ép kiểu, KHÔNG kiểm kiểu ("7" và 12.5 cho int đi nguyên dạng tới simulated như trước)', async () => {
      const a = input({ writes: [{ tagKey: "cu", value: "7" }] });
      expect((await dispatch(a)).status).toBe("simulated");
      expect(await requestedTypes(a.idempotencyKey)).toEqual(["string"]);
      const b = input({ writes: [{ tagKey: "cu", value: 12.5 }] });
      expect((await dispatch(b)).status).toBe("simulated");
    });

    // ═════════════════ ép kiểu trước khi băm / trước driver ═════════════════
    it('"245" cho float đã khai, action băm trên 245 (giá trị đã ép kiểu) ⇒ khớp ràng buộc, driver nhận SỐ 245, sổ ghi số', async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const actionId = await makeAction({
        writes: [{ tagKey: "nhiet_sp", value: 245 }],
      });
      const inp = input({
        actionId,
        writes: [{ tagKey: "nhiet_sp", value: "245" }],
      });
      const res = await dispatch(inp);
      expect(res.reason).toBeUndefined();
      expect(res.status).toBe("acked");
      expect(writeCalls).toBe(1);
      expect(writtenBatches[0]).toEqual([{ tagKey: "nhiet_sp", value: 245 }]);
      expect(typeof writtenBatches[0]![0]!.value).toBe("number");
      expect(await pendingStatus(actionId)).toBe("executed");
      expect(await requestedTypes(inp.idempotencyKey)).toEqual([
        "number",
        "number",
      ]); // intent + kết quả
    });

    it('action băm trên giá trị THÔ "245" (công cụ AI băm nguyên dạng) ⇒ VẪN khớp (không thành ACTION_BINDING_MISMATCH vì task này), driver nhận 245', async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "nhiet_sp", value: "245" }];
      const actionId = await makeAction({ writes });
      const res = await dispatch(input({ actionId, writes }));
      expect(res.status).toBe("acked");
      expect(writtenBatches[0]).toEqual([{ tagKey: "nhiet_sp", value: 245 }]);
    });

    it('action băm trên 246, gửi "245" ⇒ ACTION_BINDING_MISMATCH (cả dạng thô lẫn dạng ép kiểu đều không khớp), driver 0 lần', async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const actionId = await makeAction({
        writes: [{ tagKey: "nhiet_sp", value: 246 }],
      });
      const res = await dispatch(
        input({ actionId, writes: [{ tagKey: "nhiet_sp", value: "245" }] })
      );
      expect(res.reason).toBe("ACTION_BINDING_MISMATCH");
      expect(writeCalls).toBe(0);
      expect(await pendingStatus(actionId)).toBe("confirmed");
    });

    it('Sparkplug (requireBoundAction, ràng buộc kiểm ở cổng 1 TRƯỚC khi đọc tag): action băm trên 245, gửi "245" ⇒ khớp, driver nhận 245', async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const actionId = await makeAction({
        writes: [{ tagKey: "nhiet_sp", value: 245 }],
      });
      const res = await dispatch(
        input({
          actionId,
          requireBoundAction: true,
          writes: [{ tagKey: "nhiet_sp", value: "245" }],
        })
      );
      expect(res.reason).toBeUndefined();
      expect(res.status).toBe("acked");
      expect(writtenBatches[0]).toEqual([{ tagKey: "nhiet_sp", value: 245 }]);
    });

    it('Sparkplug (requireBoundAction): action băm trên 246, gửi "245" ⇒ ACTION_BINDING_MISMATCH ở cổng 1, driver 0 lần', async () => {
      const actionId = await makeAction({
        writes: [{ tagKey: "nhiet_sp", value: 246 }],
      });
      const inp = input({
        actionId,
        requireBoundAction: true,
        writes: [{ tagKey: "nhiet_sp", value: "245" }],
      });
      const res = await dispatch(inp);
      expect(res.reason).toBe("ACTION_BINDING_MISMATCH");
      expect(writeCalls).toBe(0);
    });

    it('tag chưa khai: action băm trên 42, gửi "42" ⇒ vẫn ACTION_BINDING_MISMATCH như trước (không ép kiểu khi cột mới NULL)', async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const actionId = await makeAction({
        writes: [{ tagKey: "cu", value: 42 }],
      });
      const res = await dispatch(
        input({ actionId, writes: [{ tagKey: "cu", value: "42" }] })
      );
      expect(res.reason).toBe("ACTION_BINDING_MISMATCH");
      expect(writeCalls).toBe(0);
    });

    // ═════════════════ kiem-dinh P1-3 — scale/offset ═════════════════
    it("P1-3 kênh ĐÃ khai, int scale 10, 25 ⇒ OFF_STEP (goiY=30), driver 0 lần — không làm tròn im lặng thành raw 3", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "sc10", value: 25 }];
      const actionId = await makeAction({ writes });
      const inp = input({ actionId, writes });
      const res = await dispatch(inp);
      expect(res.reason).toBe("OFF_STEP");
      expect(writeCalls).toBe(0);
      const rows = await ledger(inp.idempotencyKey);
      expect(rows[0]!.errorText).toMatch(/^OFF_STEP: Tag "sc10": .*\(goiY=30\)$/);
    });

    it("P1-3 kênh ĐÃ khai, int scale 10, 30 ⇒ gửi, driver nhận 30 + scale 10 ⇒ số thô 3", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "sc10", value: 30 }];
      const actionId = await makeAction({ writes });
      const res = await dispatch(input({ actionId, writes }));
      expect(res.ok).toBe(true);
      expect(rawBatches).toEqual([[{ tagKey: "sc10", raw: 3 }]]);
    });

    it("P1-3 GIỚI HẠN ĐÃ BIẾT (ghim): kênh CHƯA khai, int scale 10, 25 ⇒ dispatch KHÔNG kiểm (tương đương cờ tắt R1a) ⇒ driver làm tròn im lặng raw 3 (= 30) — R1b", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "sc10cu", value: 25 }];
      const actionId = await makeAction({ writes });
      const res = await dispatch(input({ actionId, writes }));
      expect(res.ok).toBe(true);
      expect(rawBatches).toEqual([[{ tagKey: "sc10cu", raw: 3 }]]);
    });
  }
);
