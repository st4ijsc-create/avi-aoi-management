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
 *   sc10      int,   dải 0..300, scale 10                                 ⇒ kiem-dinh P1-3: lưới thô (tag ĐÃ khai)
 *   sc10cu    int,   cột mới NULL, scale 10                               ⇒ R1b-1 T13: lưới thô cho tag CHƯA khai (không ép kiểu)
 *   sc2o1     int,   cột mới NULL, scale 2, offset 1                      ⇒ R1b-1 T13: lưới 1, 3, 5, …
 *   sc05      int,   dải 0..10, scale 0.5                                 ⇒ R1b-2a T2 (m5): giá trị kỹ thuật 2.5 (thô 5) được nhận
 *   fcu       float, cột mới NULL                                         ⇒ R1b-2a T2 (phán quyết T1 c3): không phải số hữu hạn ⇒ TYPE_MISMATCH
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
import { and, eq, like, sql } from "drizzle-orm";

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
import { dongDauDuyetLuat } from "../../testing/dauDuyetInterlock";
import { congKenhSom, dispatch, type DispatchInput, type TagCongKenh } from "./commandDispatcher";
import { inverseScale } from "./drivers/otScale";
import { FOE_ENGINE_TOOL, otPayloadHash, withOtPayloadHash } from "./otActionBinding";
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
        // R1b-1 T13 — int CHƯA khai, scale 2 offset 1 (lưới thô 1, 3, 5, …)
        { adapterId, tagKey: "sc2o1", address: "D207", dataType: "int", writable: true, scale: "2", offset: "1" },
        // R1b-2a T2 — int scale 0.5 ĐÃ khai (dải 0..10; giá trị kỹ thuật 2.5 = thô 5) + float CHƯA khai (M2 mở rộng, phán quyết T1 c3)
        { adapterId, tagKey: "sc05", address: "D208", dataType: "int", writable: true, writeMin: 0, writeMax: 10, scale: "0.5" },
        { adapterId, tagKey: "fcu", address: "D209", dataType: "float", writable: true },
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
      await dongDauDuyetLuat(ruleId); // kiem-dinh R1b-1 I1 (a) FIXTURE — "đã duyệt" gieo thẳng mang bám định nghĩa hiện tại
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

    // R1b-2a T1 (Q-T13 b) — thay ghim cũ "12.5 cho int chưa khai đi nguyên dạng": int scale 1 có lưới số nguyên ⇒ OFF_STEP. "7" vẫn KHÔNG ép kiểu.
    it('hồi quy: mọi cột mới NULL ⇒ KHÔNG ép kiểu ("7" cho int đi nguyên dạng tới simulated như trước); 12.5 ⇒ OFF_STEP (R1b-2a T1)', async () => {
      const a = input({ writes: [{ tagKey: "cu", value: "7" }] });
      expect((await dispatch(a)).status).toBe("simulated");
      expect(await requestedTypes(a.idempotencyKey)).toEqual(["string"]);
      const b = input({ writes: [{ tagKey: "cu", value: 12.5 }] });
      const rb = await dispatch(b);
      expect(rb.status).toBe("rejected");
      expect(rb.reason).toBe("OFF_STEP");
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

    // ═════════════════ R1b-1 T13 — kênh CHƯA khai, int scale/offset: không làm tròn im lặng (thay ca ghim "GIỚI HẠN ĐÃ BIẾT" của P1-3) ═════════════════
    it("T13 AI (set_machine_param): kênh CHƯA khai, int scale 10, 25 ⇒ OFF_STEP (goiY=30, appError SCADA_VALUE_OFF_STEP step 10), driver 0 lần, action KHÔNG bị tiêu thụ", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "sc10cu", value: 25 }];
      const actionId = await makeAction({ writes });
      const inp = input({ actionId, writes });
      const res = await dispatch(inp);
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("OFF_STEP");
      expect(res.appError).toEqual({ appCode: "SCADA_VALUE_OFF_STEP", appParams: { ma: "OFF_STEP", tagKey: "sc10cu", step: 10, goiY: 30 } });
      expect(writeCalls).toBe(0);
      expect(rawBatches).toEqual([]);
      const rows = await ledger(inp.idempotencyKey);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tagKey).toBe("sc10cu");
      expect(rows[0]!.errorText).toMatch(/^OFF_STEP: Tag "sc10cu": .*\(goiY=30\)$/);
      expect(await pendingStatus(actionId)).toBe("confirmed");
    });

    it("T13 AI (set_machine_param): kênh CHƯA khai, int scale 10, 30 ⇒ gửi NGUYÊN 30, driver ⇒ số thô 3", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "sc10cu", value: 30 }];
      const actionId = await makeAction({ writes });
      const res = await dispatch(input({ actionId, writes }));
      expect(res.ok).toBe(true);
      expect(writtenBatches).toEqual([[{ tagKey: "sc10cu", value: 30 }]]);
      expect(rawBatches).toEqual([[{ tagKey: "sc10cu", raw: 3 }]]);
    });

    it('T13 kênh CHƯA khai KHÔNG bị ép kiểu (hành vi cũ giữ): "30" ⇒ đi tiếp NGUYÊN chuỗi (requestedValue string); "25" ⇒ OFF_STEP — kiểm trên Number(giá trị) như inverseScale', async () => {
      const inp30 = input({ writes: [{ tagKey: "sc10cu", value: "30" }] });
      const r30 = await dispatch(inp30);
      expect(r30.status).toBe("simulated");
      expect(await requestedTypes(inp30.idempotencyKey)).toEqual(["string"]);
      const r25 = await dispatch(input({ writes: [{ tagKey: "sc10cu", value: "25" }] }));
      expect(r25.reason).toBe("OFF_STEP");
    });

    it("T13 bool true lên kênh CHƯA khai int scale 10 ⇒ OFF_STEP goiY 0 (driver trước đây ghi raw round(0.1) = 0 — ngược ý định)", async () => {
      const inp = input({ writes: [{ tagKey: "sc10cu", value: true }] });
      const res = await dispatch(inp);
      expect(res.reason).toBe("OFF_STEP");
      expect(res.appError?.appParams).toMatchObject({ goiY: 0, step: 10 });
    });

    it("T13 offset: kênh CHƯA khai int scale 2 offset 1 — 4 ⇒ OFF_STEP (goiY 5, step 2); 5 ⇒ số thô 2", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const r4 = await dispatch(input({ writes: [{ tagKey: "sc2o1", value: 4 }] }));
      expect(r4.reason).toBe("OFF_STEP");
      expect(r4.appError).toEqual({ appCode: "SCADA_VALUE_OFF_STEP", appParams: { ma: "OFF_STEP", tagKey: "sc2o1", step: 2, goiY: 5 } });
      const writes = [{ tagKey: "sc2o1", value: 5 }];
      const actionId = await makeAction({ writes });
      const r5 = await dispatch(input({ actionId, writes }));
      expect(r5.ok).toBe(true);
      expect(rawBatches).toEqual([[{ tagKey: "sc2o1", raw: 2 }]]);
    });

    it("T13 kênh CHƯA khai int scale 1 / offset 0 (cu): số nguyên 25 nằm trên lưới số nguyên ⇒ simulated (R1b-2a T1: tag này nay CÓ kiểm lưới)", async () => {
      const res = await dispatch(input({ writes: [{ tagKey: "cu", value: 25 }] }));
      expect(res.status).toBe("simulated");
    });

    it("T13 INTERLOCK: luật nhắm kênh CHƯA khai int scale 10 — commandValue 25 ⇒ OFF_STEP, driver 0 lần; 30 ⇒ gửi, số thô 3", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
      const x = await d();
      const chay = async (giaTri: number) => {
        const [rule] = await x
          .insert(interlockRules)
          .values({
            name: `${DAU} rule t13 ${giaTri}`,
            scope: "machine",
            machineId: MACHINE,
            sourceType: "ng_rate",
            comparisonOperator: "gt",
            threshold: "99999",
            action: "reduce_speed",
            targetMachineId: MACHINE,
            targetAdapterId: adapterId,
            commandTag: "sc10cu",
            commandValue: giaTri as never, // ghi thẳng DB (mô phỏng luật có trước T13 — cổng cấu hình nay từ chối 25)
            requiresHumanConfirm: false,
            enabled: true,
            approvedBy: APPROVER,
            approvedAt: new Date(),
          })
          .returning();
        await dongDauDuyetLuat(rule!.id); // kiem-dinh R1b-1 I1 (a) FIXTURE — "đã duyệt" gieo thẳng mang bám định nghĩa hiện tại
        const [ev] = await x.insert(interlockEvents).values({ ruleId: rule!.id, action: "reduce_speed", status: "fired" }).returning();
        try {
          return await dispatch({
            adapterId,
            machineId: MACHINE,
            commandType: "reduce_speed",
            writes: [{ tagKey: "sc10cu", value: giaTri }],
            triggeredBy: { kind: "interlock", ruleId: rule!.id, eventId: ev!.id, approvedBy: APPROVER },
            idempotencyKey: nextKey("il-t13"),
          });
        } finally {
          await x.update(interlockRules).set({ enabled: false }).where(eq(interlockRules.id, rule!.id));
          await x.delete(interlockEvents).where(eq(interlockEvents.ruleId, rule!.id)).catch(() => {});
        }
      };
      const r25 = await chay(25);
      expect(r25.status).toBe("rejected");
      expect(r25.reason).toBe("OFF_STEP");
      expect(writeCalls).toBe(0);
      const r30 = await chay(30);
      expect(r30.ok).toBe(true);
      expect(rawBatches).toEqual([[{ tagKey: "sc10cu", raw: 3 }]]);
    });

    it("T13 FOE (lệnh bước FOE qua equipmentAdapter, ánh xạ buildEquipmentCommand thật): 25 lên kênh CHƯA khai int scale 10 ⇒ rejected OFF_STEP + detail.appError (Studio dịch); 30 ⇒ qua cổng kênh (simulated, requestedValue 30)", async () => {
      const { buildEquipmentCommand } = await import("../orchestration/foe/foeStepClass");
      const { equipmentRegistry } = await import("../equipment/equipmentAdapter");
      const x = await d();
      const ids: string[] = [];
      // Hàng ai_pending_actions của bước FOE (động cơ tạo nó khi cổng hitl_gate duyệt; ở đây ghi thẳng): id = orchestrationActionId(khoá),
      // tool foe.orchestration, đã xác nhận bởi người xác nhận của lệnh — đủ cho cổng 1 (đường mô phỏng) để lệnh TỚI cổng kênh 3b.
      const lenh = async (giaTri: number) => {
        const cmd = buildEquipmentCommand(
          { name: "write_tag" } as never,
          { adapterKind: "ot-modbus" } as never,
          MACHINE,
          { adapterId, writes: [{ tagKey: "sc10cu", value: giaTri }] },
          nextKey("foe-t13"),
          { id: OWNER, role: "engineer" },
        );
        ids.push(cmd.hitl.actionId);
        await x.insert(aiPendingActions).values({
          id: cmd.hitl.actionId,
          tool: FOE_ENGINE_TOOL,
          argsJson: {},
          userId: OWNER,
          userRole: "engineer",
          summary: `${DAU} foe t13`,
          previewJson: { entityType: "machine" },
          status: "confirmed",
          idempotencyKey: `${cmd.hitl.actionId}-idem`,
          expiresAt: new Date(Date.now() + 600_000),
        });
        return cmd;
      };
      try {
        const c25 = await lenh(25);
        const r25 = await equipmentRegistry.getAdapter("ot-modbus").sendCommand(c25);
        expect(r25.status).toBe("rejected");
        expect(r25.detail).toMatchObject({ reason: "OFF_STEP", appError: { appCode: "SCADA_VALUE_OFF_STEP", appParams: { tagKey: "sc10cu", step: 10, goiY: 30 } } });
        expect((await ledger(c25.idempotencyKey))[0]!.errorText).toMatch(/^OFF_STEP: Tag "sc10cu": /);
        const c30 = await lenh(30);
        const r30 = await equipmentRegistry.getAdapter("ot-modbus").sendCommand(c30);
        expect(r30.status).toBe("simulated");
        const rows = await ledger(c30.idempotencyKey);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.requestedValue).toBe(30);
        expect(writeCalls).toBe(0);
      } finally {
        for (const id of ids) await x.delete(aiPendingActions).where(eq(aiPendingActions.id, id)).catch(() => {});
      }
    });

    it("T13 STOP GHIM lệch lưới (stop_value 25 trên kênh CHƯA khai int scale 10) ⇒ KHÔNG bị chặn (miễn cả lệnh) — driver vẫn làm tròn ⇒ raw 3: phát hiện CẤU HÌNH, không phải từ chối dispatch", async () => {
      const x = await d();
      await x.update(deviceTags).set({ stopValue: 25 as never }).where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, "sc10cu")));
      try {
        const inp = input({ commandType: "stop", writes: [{ tagKey: "sc10cu", value: 25 }] });
        const res = await dispatch(inp);
        expect(res.reason).not.toBe("OFF_STEP");
        expect(res.status).toBe("simulated");
        // stop KHÔNG khớp ghim (24) ⇒ không miễn ⇒ OFF_STEP như mọi lệnh
        const lech = await dispatch(input({ commandType: "stop", writes: [{ tagKey: "sc10cu", value: 24 }] }));
        expect(lech.reason).toBe("OFF_STEP");
      } finally {
        await x.update(deviceTags).set({ stopValue: null }).where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, "sc10cu")));
      }
    });

    // ═════════════════ R1b-2a T1 — một luật cho giá trị ghi lên tag int (Q-T13 b + kiem-dinh M2; phán quyết K3) ═════════════════
    // Hành động AI ĐÃ xác nhận (khuôn T13 / X2 R1b-1): OT bật, action gắn đúng ⇒ cổng kênh 3b là cổng từ chối; `AI_OT_CONTROL_ENABLED` không
    // được dispatch đọc (đã xoá ở beforeEach). Thiết bị = driver giả đếm `writeTags`.
    it("R1b-2a T1 AI (set_machine_param): 2.5 lên int CHƯA khai scale 1 (cu) ⇒ rejected OFF_STEP, appError {SCADA_VALUE_OFF_STEP, step 1, goiY 3}, thiết bị 0 lần, action KHÔNG bị tiêu thụ", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "cu", value: 2.5 }];
      const actionId = await makeAction({ writes });
      const inp = input({ actionId, writes });
      const res = await dispatch(inp);
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("OFF_STEP");
      expect(res.appError).toEqual({ appCode: "SCADA_VALUE_OFF_STEP", appParams: { ma: "OFF_STEP", tagKey: "cu", step: 1, goiY: 3 } });
      expect(writeCalls).toBe(0);
      const rows = await ledger(inp.idempotencyKey);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.errorText).toMatch(/^OFF_STEP: Tag "cu": .*\(goiY=3\)$/);
      expect(await pendingStatus(actionId)).toBe("confirmed");
    });

    it('R1b-2a T1 AI (M2): "abc" lên int CHƯA khai scale 1 ⇒ rejected TYPE_MISMATCH, thiết bị 0 lần (trước: driver ghi Math.round(NaN))', async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "cu", value: "abc" }];
      const actionId = await makeAction({ writes });
      const inp = input({ actionId, writes });
      const res = await dispatch(inp);
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("TYPE_MISMATCH");
      expect(writeCalls).toBe(0);
      expect((await ledger(inp.idempotencyKey))[0]!.errorText).toMatch(/^TYPE_MISMATCH: Tag "cu": giá trị không phải số hữu hạn — tag int không ghi được/);
      expect(await pendingStatus(actionId)).toBe("confirmed");
    });

    it("R1b-2a T1 (K3): [3] / null / \"\" / \"Infinity\" / {v:3} lên int CHƯA khai (scale 1 và scale 10) ⇒ TYPE_MISMATCH, thiết bị 0 lần", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      for (const tagKey of ["cu", "sc10cu"]) {
        for (const value of [[3], null, "", "Infinity", { v: 3 }]) {
          const writes = [{ tagKey, value }];
          const actionId = await makeAction({ writes });
          const res = await dispatch(input({ actionId, writes }));
          expect(res.reason, `${tagKey} ${JSON.stringify(value)}`).toBe("TYPE_MISMATCH");
        }
      }
      expect(writeCalls).toBe(0);
    });

    it("R1b-2a T1 AI: 3 lên int CHƯA khai scale 1 ⇒ driver nhận 3 (số thô 3)", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "cu", value: 3 }];
      const actionId = await makeAction({ writes });
      const res = await dispatch(input({ actionId, writes }));
      expect(res.ok).toBe(true);
      expect(writtenBatches).toEqual([[{ tagKey: "cu", value: 3 }]]);
      expect(rawBatches).toEqual([[{ tagKey: "cu", raw: 3 }]]);
    });

    it("R1b-2a T1: STOP ghim 2 trên int CHƯA khai scale 1 ⇒ ok (simulated); stop KHÔNG khớp ghim (1.5) ⇒ OFF_STEP như mọi lệnh", async () => {
      const x = await d();
      const datGhim = (v: unknown) => x.update(deviceTags).set({ stopValue: v as never }).where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, "cu")));
      try {
        await datGhim(2);
        const r2 = await dispatch(input({ commandType: "stop", writes: [{ tagKey: "cu", value: 2 }] }));
        expect(r2.ok).toBe(true);
        expect(r2.status).toBe("simulated");
        expect((await dispatch(input({ commandType: "stop", writes: [{ tagKey: "cu", value: 1.5 }] }))).reason).toBe("OFF_STEP");
      } finally {
        await datGhim(null);
      }
    });

    it("R1b-2a T1: stop_value 2.5 ghi thẳng trên tag int KHÔNG phải ghim hợp lệ (validateStopValue: int ⇒ số nguyên an toàn; setStopPin không đặt được) ⇒ stop 2.5 KHÔNG phải STOP ghim ⇒ OFF_STEP; STOP ghim hợp lệ không bị ảnh hưởng (ca trên)", async () => {
      const x = await d();
      const datGhim = (v: unknown) => x.update(deviceTags).set({ stopValue: v as never }).where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, "cu")));
      try {
        await datGhim(2.5);
        const r = await dispatch(input({ commandType: "stop", writes: [{ tagKey: "cu", value: 2.5 }] }));
        expect(r.status).toBe("rejected");
        expect(r.reason).toBe("OFF_STEP");
        expect(writeCalls).toBe(0);
      } finally {
        await datGhim(null);
      }
    });

    // ═════════════════ R1b-2a T2 — HMI và dispatch cùng luật cho int scale lẻ (m5); float CHƯA khai (phán quyết T1 c3); cổng 1 (K4) ═════════════════
    const datGhimTag = async (tagKey: string, v: unknown) =>
      (await d()).update(deviceTags).set({ stopValue: v as never }).where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, tagKey)));
    const hangTag = async (keys: string[]): Promise<Map<string, TagCongKenh>> => {
      const rows = (await (await d()).select().from(deviceTags).where(eq(deviceTags.adapterId, adapterId))) as TagCongKenh[];
      return new Map(rows.filter((r) => keys.includes(r.tagKey)).map((r) => [r.tagKey, r]));
    };

    it("R1b-2a T2 (m5): int scale 0.5 ĐÃ khai — 2.5 ⇒ gửi, thiết bị nhận 2.5 ⇒ số thô 5 (trước: TYPE_MISMATCH ở pass 1 — epInt); \"2.5\" ⇒ ép thành SỐ 2.5", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "sc05", value: 2.5 }];
      const actionId = await makeAction({ writes });
      const res = await dispatch(input({ actionId, writes }));
      expect(res.reason).toBeUndefined();
      expect(res.ok).toBe(true);
      expect(writtenBatches).toEqual([[{ tagKey: "sc05", value: 2.5 }]]);
      expect(rawBatches).toEqual([[{ tagKey: "sc05", raw: 5 }]]);
      process.env.OT_CONTROL_ENABLED = "false"; // đường mô phỏng (không action): kiểm dạng đã ép trên sổ
      const inpChuoi = input({ writes: [{ tagKey: "sc05", value: "2.5" }] });
      expect((await dispatch(inpChuoi)).status).toBe("simulated");
      expect(await requestedTypes(inpChuoi.idempotencyKey)).toEqual(["number"]);
    });

    it("R1b-2a T2 (m5): int scale 0.5 ĐÃ khai — 2.6 ⇒ OFF_STEP {step 0.5, goiY 2.5}; 10.5 ⇒ OUT_OF_RANGE; scale 1 (cu) 2.5 vẫn OFF_STEP — thiết bị 0 lần", async () => {
      const r26 = await dispatch(input({ writes: [{ tagKey: "sc05", value: 2.6 }] }));
      expect(r26.reason).toBe("OFF_STEP");
      expect(r26.appError).toEqual({ appCode: "SCADA_VALUE_OFF_STEP", appParams: { ma: "OFF_STEP", tagKey: "sc05", step: 0.5, goiY: 2.5 } });
      expect((await dispatch(input({ writes: [{ tagKey: "sc05", value: 10.5 }] }))).reason).toBe("OUT_OF_RANGE");
      expect(writeCalls).toBe(0);
    });

    it("R1b-2a T2: STOP ghim 3 trên int scale 10 CHƯA khai ⇒ ok (không bị pass 1 chặn); STOP ghim 3 trên int scale 10 ĐÃ khai (lệch lưới thô — dữ liệu cũ) ⇒ ok (pass 1 chỉ ép kiểu, lưới ở pass 2 sau miễn trừ)", async () => {
      try {
        await datGhimTag("sc10cu", 3);
        const r1 = await dispatch(input({ commandType: "stop", writes: [{ tagKey: "sc10cu", value: 3 }] }));
        expect(r1.reason).toBeUndefined();
        expect(r1.status).toBe("simulated");
        await datGhimTag("sc10", 3);
        const r2 = await dispatch(input({ commandType: "stop", writes: [{ tagKey: "sc10", value: 3 }] }));
        expect(r2.reason).toBeUndefined();
        expect(r2.status).toBe("simulated");
        // không phải lệnh dừng ⇒ không miễn ⇒ lưới thô ở pass 2
        expect((await dispatch(input({ writes: [{ tagKey: "sc10", value: 3 }] }))).reason).toBe("OFF_STEP");
      } finally {
        await datGhimTag("sc10cu", null);
        await datGhimTag("sc10", null);
      }
    });

    it('R1b-2a T2 (K4) — cổng 1 (requireBoundAction): int scale 10 ĐÃ khai, action băm trên 30, gửi "30.0" ⇒ cổng 1 ép CÙNG cách pass 1 ⇒ khớp, thiết bị nhận 30 ⇒ số thô 3', async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const actionId = await makeAction({ writes: [{ tagKey: "sc10", value: 30 }] });
      const res = await dispatch(input({ actionId, requireBoundAction: true, writes: [{ tagKey: "sc10", value: "30.0" }] }));
      expect(res.reason).toBeUndefined();
      expect(res.status).toBe("acked");
      expect(writtenBatches).toEqual([[{ tagKey: "sc10", value: 30 }]]);
      expect(rawBatches).toEqual([[{ tagKey: "sc10", raw: 3 }]]);
    });

    it("R1b-2a T2 (K4) — CHẴN LẺ cổng 1 ↔ pass 1: với mỗi (tag, giá trị thô), action băm trên giá trị pass 1 (congKenhSom thuần, hàng tag THẬT) ép ra ⇒ cổng 1 KHÔNG BAO GIỜ ACTION_BINDING_MISMATCH", async () => {
      const keys = ["sc10", "sc05", "nhiet_sp", "toc_do"];
      const theo = await hangTag(keys);
      const ca: Array<{ tagKey: string; value: unknown }> = [
        { tagKey: "sc10", value: "30.0" },
        { tagKey: "sc10", value: " 300 " },
        { tagKey: "sc10", value: 30 },
        { tagKey: "sc05", value: "2.5" },
        { tagKey: "sc05", value: "-0" },
        { tagKey: "sc05", value: 7 },
        { tagKey: "nhiet_sp", value: "245.0" },
        { tagKey: "toc_do", value: "50" },
      ];
      for (const w of ca) {
        const p1 = congKenhSom("set_param", [w], [theo.get(w.tagKey)!]);
        expect(p1.ok, `pass 1 ${JSON.stringify(w)}`).toBe(true);
        const epKieu = p1.ok ? p1.writes : [];
        const actionId = await makeAction({ writes: epKieu.map((x) => ({ tagKey: x.tagKey, value: x.value })) });
        const res = await dispatch(input({ actionId, requireBoundAction: true, writes: [w] }));
        expect(res.reason, `cổng 1 ${JSON.stringify(w)} ⇒ băm trên ${JSON.stringify(epKieu)}`).not.toBe("ACTION_BINDING_MISMATCH");
        expect(res.status, JSON.stringify(w)).toBe("simulated");
      }
    });

    it("R1b-2a T2 (phán quyết T1 c3): float CHƯA khai — NaN / Infinity / \"abc\" / \"\" / chỉ khoảng trắng / [1.5] / {v:1.5} ⇒ TYPE_MISMATCH, thiết bị 0 lần, action KHÔNG bị tiêu thụ", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "abc", "", "   ", [1.5], { v: 1.5 }]) {
        const writes = [{ tagKey: "fcu", value }];
        const actionId = await makeAction({ writes });
        const inp = input({ actionId, writes });
        const res = await dispatch(inp);
        expect(res.reason, String(JSON.stringify(value))).toBe("TYPE_MISMATCH");
        expect((await ledger(inp.idempotencyKey))[0]!.errorText).toMatch(/^TYPE_MISMATCH: Tag "fcu": giá trị không phải số hữu hạn — tag float không ghi được/);
        expect(await pendingStatus(actionId)).toBe("confirmed");
      }
      expect(writeCalls).toBe(0);
    });

    it("R1b-2a T2: float CHƯA khai — 2.25 ⇒ thiết bị nhận 2.25; \"1.5\" ⇒ đi tiếp NGUYÊN chuỗi (không ép kiểu — hành vi cũ)", async () => {
      process.env.OT_CONTROL_ENABLED = "true";
      const writes = [{ tagKey: "fcu", value: 2.25 }];
      const actionId = await makeAction({ writes });
      const res = await dispatch(input({ actionId, writes }));
      expect(res.ok).toBe(true);
      expect(writtenBatches).toEqual([[{ tagKey: "fcu", value: 2.25 }]]);
      process.env.OT_CONTROL_ENABLED = "false";
      const inp = input({ writes: [{ tagKey: "fcu", value: "1.5" }] });
      expect((await dispatch(inp)).status).toBe("simulated");
      expect(await requestedTypes(inp.idempotencyKey)).toEqual(["string"]);
    });
  }
);
