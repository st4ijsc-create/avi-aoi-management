/**
 * SCADA R1a Task 4 (K2/D3) — cổng CHẾ ĐỘ MÁY (LOCAL/REMOTE) trong `dispatchCore`, cùng khối cổng sớm với 3b (ruling R-1 của sổ cái:
 * trước cổng chế độ OT / nghiệm thu ⇒ từ chối LOCAL là `rejected` kể cả khi OT_CONTROL_ENABLED tắt).
 * Cổng chạy khi `SCADA_CONG_CHE_DO_ENABLED=true` HOẶC lệnh hitl của tool `hmi.write_tag`; STOP ghim (cả lệnh) được miễn.
 * CSDL THẬT (`_test`, ép bởi vitest.setup): command_log WORM, scada_kenh_che_do, ai_pending_actions.
 *
 * Thiết bị: MỘT driver giả trong tiến trình thay `getActiveDriver` (khuôn commandDispatcher.kenh.r1a.db.test.ts); nó ĐẾM `writeTags`.
 * Bộ đệm giá trị hiện tại là mã THẬT (`datThongTinAdapter` + `napTuOt`, như đường OT trong tiến trình nuôi nó).
 *
 * Bố trí:
 *   adapter A — máy MAY_CHUA_KHAI (KHÔNG có hàng scada_kenh_che_do)
 *     sp      int, mọi cột kênh NULL (cổng 3b không đụng)
 *     toc_do  int, stop_value 0 (STOP ghim)
 *   adapter B — máy MAY_KHAI, kênh chế độ (B, "che_do"), gia_tri_remote = 2
 *     sp      int
 *     che_do  int, writable=false (tag đọc)
 *   adapter C — CÙNG máy MAY_KHAI, không mang kênh chế độ (fix round 1 M-1: ghi tới C ⇒ cổng đọc kênh của B)
 *     sp      int
 *
 * fix round 1 (M-3): `cheDoMay` được bọc một bộ đếm (gọi xuyên qua mã thật) — cờ OFF ⇒ 0 lần gọi (không truy vấn thêm).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";

const fake = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  cheDoMayCalls: [] as unknown[],
}));

vi.mock("../scada/cheDoMay", async importOriginal => {
  const orig = await importOriginal<typeof import("../scada/cheDoMay")>();
  return {
    ...orig,
    cheDoMay: (...a: Parameters<typeof orig.cheDoMay>) => {
      fake.cheDoMayCalls.push(a[0]);
      return orig.cheDoMay(...a);
    },
  };
});

vi.mock("../safety/plc/safetyPlcAdapter", async importOriginal => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [
      { code: "R1A-T4-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
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
    getActiveDriver: (adapterId: number) => fake.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
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
  scadaKenhCheDo,
} from "../../../drizzle/schema";
import { dispatch, type DispatchInput } from "./commandDispatcher";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";
import { datThongTinAdapter, napTuOt, xoaAdapter, POLL_MAC_DINH_MS } from "../scada/boDemHienTai";
import type { OtQuality } from "./otDriver";

const DB_URL = process.env.DATABASE_URL;
const DAU = `R1AT4-${Date.now()}`;
const OWNER = 990_641_101;
const APPROVER = 990_641_201;
const MAY_CHUA_KHAI = 990_641_001;
const MAY_KHAI = 990_641_002;
const TOOL = "set_machine_param";
const HMI = "hmi.write_tag";

let writeCalls = 0;
let writtenBatches: Array<Array<{ tagKey: string; value: unknown }>> = [];
const fakeDriver = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string; value: unknown }>) {
    writeCalls++;
    writtenBatches.push(writes.map(w => ({ tagKey: w.tagKey, value: w.value })));
    return writes.map(w => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags() {
    return [];
  },
  async getSafetyStatus() {
    return { state: "OK", source: "fake-driver", ts: new Date().toISOString() };
  },
};

let adA = 0;
let adB = 0;
let adC = 0;
let ruleId = 0;
let seq = 0;
const nextKey = (label: string) => `${DAU}-${label}-${++seq}`;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

type Writes = Array<{ tagKey: string; value: unknown }>;

async function makeAction(bind: { adapterId: number; machineId: number; commandType?: string; writes: Writes; tool?: string }): Promise<string> {
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
      otPayloadHash({ tool, adapterId: bind.adapterId, machineId: bind.machineId, commandType: bind.commandType ?? "set_param", writes: bind.writes }),
    ),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return id;
}

/** Lệnh hitl trên adapter A (máy chưa khai) trừ khi nói khác. `machineId: undefined` tường minh ⇒ bỏ trường. */
function input(over: Partial<DispatchInput> & { actionId?: string; tool?: string } = {}): DispatchInput {
  const { actionId, tool, ...rest } = over;
  const out: DispatchInput = {
    adapterId: adA,
    machineId: MAY_CHUA_KHAI,
    commandType: "set_param",
    writes: [{ tagKey: "sp", value: 42 }],
    triggeredBy: { kind: "hitl", actionId, tool: tool ?? TOOL, confirmedBy: OWNER, requestedBy: OWNER },
    idempotencyKey: nextKey("k"),
    ...rest,
  };
  if ("machineId" in over && over.machineId === undefined) delete out.machineId;
  return out;
}

/** Lệnh trên adapter B (máy đã khai kênh chế độ). */
function inputB(over: Partial<DispatchInput> & { actionId?: string; tool?: string } = {}): DispatchInput {
  return input({ adapterId: adB, machineId: MAY_KHAI, ...over });
}

async function ledger(base: string) {
  return (await d()).select().from(commandLog).where(like(commandLog.idempotencyKey, `%${base}%`));
}

async function pendingStatus(id: string) {
  const [row] = await (await d()).select().from(aiPendingActions).where(eq(aiPendingActions.id, id)).limit(1);
  return row?.status;
}

/** Nuôi bộ đệm THẬT cho kênh chế độ của máy đã khai (đường OT trong tiến trình). */
function napCheDo(v: number | null, q: OtQuality = "good") {
  datThongTinAdapter(adB, { pollMs: POLL_MAC_DINH_MS, coDeadband: false, machineId: MAY_KHAI, code: `${DAU}-B` });
  napTuOt({ adapterId: adB, machineId: MAY_KHAI }, [{ tagKey: "che_do", raw: v, value: v, quality: q, timestamp: new Date() }]);
}

/** Kết quả quan sát được của một lệnh (đầu ra + sổ) — để so "trước/sau" cổng. */
async function ketQua(inp: DispatchInput) {
  const res = await dispatch(inp);
  const rows = await ledger(inp.idempotencyKey);
  return {
    ok: res.ok,
    simulated: res.simulated,
    status: res.status,
    reason: res.reason,
    rowStatus: rows.map(r => r.status).sort(),
    errorText: rows.map(r => r.errorText),
  };
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
  "SCADA_CONG_CHE_DO_ENABLED",
  "SCADA_LIVE_CACHE_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

/**
 * mig 0433: `scada_kenh_che_do.machine_id` -> machines(id) ON DELETE CASCADE, nên MAY_KHAI / MAY_CHUA_KHAI phải là hàng `machines` THẬT.
 * Chỉ điền cột NOT NULL (mượn stationId + machineType của một máy có sẵn), id cố định, code/tên riêng của bài. Dọn ở afterAll
 * (xoá máy ⇒ CASCADE dọn nốt hàng kênh chế độ nếu còn).
 */
async function xoaMayThat(x: Awaited<ReturnType<typeof d>>) {
  await x.execute(sql`DELETE FROM machines WHERE id IN (${MAY_CHUA_KHAI}, ${MAY_KHAI})`);
}
async function taoMayThat(x: Awaited<ReturnType<typeof d>>) {
  await xoaMayThat(x);
  await x.execute(sql`INSERT INTO machines (id, "stationId", code, name, "machineType")
    SELECT v.id, m."stationId", ${DAU}::text || '-' || v.hau, ${DAU}::text || ' máy ' || v.hau, m."machineType"
      FROM (VALUES (${MAY_CHUA_KHAI}::int, 'A'), (${MAY_KHAI}::int, 'B')) AS v(id, hau), (SELECT "stationId", "machineType" FROM machines ORDER BY id LIMIT 1) m`);
}

describe.skipIf(!DB_URL)("R1a T4 — dispatch: cổng chế độ máy K2 (LOCAL/REMOTE) trong khối cổng sớm (DB thật)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    const x = await d();
    const old = await x.select({ id: deviceAdapters.id }).from(deviceAdapters).where(inArray(deviceAdapters.machineId, [MAY_CHUA_KHAI, MAY_KHAI]));
    for (const a of old) {
      await x.delete(deviceTags).where(eq(deviceTags.adapterId, a.id));
      await x.delete(deviceAdapters).where(eq(deviceAdapters.id, a.id));
    }
    await x.delete(scadaKenhCheDo).where(inArray(scadaKenhCheDo.machineId, [MAY_CHUA_KHAI, MAY_KHAI]));
    await taoMayThat(x); // mig 0433: scada_kenh_che_do.machine_id có FK → machines(id) ON DELETE CASCADE
    const [a] = await x
      .insert(deviceAdapters)
      .values({ code: `${DAU}-A`, name: `${DAU} adapter A`, protocol: "stub", endpoint: "stub://r1a-t4-a", isEnabled: true, machineId: MAY_CHUA_KHAI })
      .returning();
    adA = a!.id;
    const [b] = await x
      .insert(deviceAdapters)
      .values({ code: `${DAU}-B`, name: `${DAU} adapter B`, protocol: "stub", endpoint: "stub://r1a-t4-b", isEnabled: true, machineId: MAY_KHAI })
      .returning();
    adB = b!.id;
    const [c] = await x
      .insert(deviceAdapters)
      .values({ code: `${DAU}-C`, name: `${DAU} adapter C`, protocol: "stub", endpoint: "stub://r1a-t4-c", isEnabled: true, machineId: MAY_KHAI })
      .returning();
    adC = c!.id;
    await x.insert(deviceTags).values([
      { adapterId: adA, tagKey: "sp", address: "D100", dataType: "int", writable: true },
      { adapterId: adA, tagKey: "toc_do", address: "D101", dataType: "int", writable: true, stopValue: 0 },
      { adapterId: adB, tagKey: "sp", address: "D100", dataType: "int", writable: true },
      { adapterId: adB, tagKey: "che_do", address: "D900", dataType: "int", writable: false },
      { adapterId: adC, tagKey: "sp", address: "D100", dataType: "int", writable: true },
    ]);
    await x.insert(scadaKenhCheDo).values({ machineId: MAY_KHAI, adapterId: adB, tagKey: "che_do", giaTriRemote: 2, updatedBy: OWNER });
    fake.drivers.set(adA, fakeDriver);
    fake.drivers.set(adB, fakeDriver);
    fake.drivers.set(adC, fakeDriver);
    fake.fingerprints.set(adA, adapterTargetFingerprint({ protocol: "stub", endpoint: "stub://r1a-t4-a", machineId: MAY_CHUA_KHAI, connectionOptions: null }));
  }, 60_000);

  afterAll(async () => {
    fake.drivers.clear();
    if (adB) xoaAdapter(adB);
    const x = await d();
    await x.update(interlockRules).set({ enabled: false }).where(like(interlockRules.name, `${DAU}%`));
    if (ruleId) await x.delete(interlockEvents).where(eq(interlockEvents.ruleId, ruleId)).catch(() => {});
    await x.delete(interlockRules).where(like(interlockRules.name, `${DAU}%`)).catch(() => {});
    await x.delete(aiPendingActions).where(like(aiPendingActions.id, `${DAU}%`));
    await x.delete(scadaKenhCheDo).where(inArray(scadaKenhCheDo.machineId, [MAY_CHUA_KHAI, MAY_KHAI]));
    for (const id of [adA, adB, adC]) {
      if (!id) continue;
      await x.delete(deviceTags).where(eq(deviceTags.adapterId, id));
      await x.delete(deviceAdapters).where(eq(deviceAdapters.id, id));
    }
    await xoaMayThat(x);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }, 60_000);

  beforeEach(() => {
    writeCalls = 0;
    writtenBatches = [];
    fake.cheDoMayCalls = [];
    process.env.OT_CONTROL_ENABLED = "false";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    process.env.SCADA_LIVE_CACHE_ENABLED = "true";
    delete process.env.SCADA_CONG_CHE_DO_ENABLED;
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    delete process.env.OT_READBACK_ENABLED;
    delete process.env.OT_CMD_SERIALIZE_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.UNS_CMD_ACK_ENABLED;
    delete process.env.AI_OT_CONTROL_ENABLED;
    delete process.env.PARAM_GUARDRAIL_ENABLED;
    delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
    if (adB) xoaAdapter(adB); // bộ đệm sạch mỗi ca: mục kênh chế độ chỉ có khi ca tự nạp
  });

  // ═════════════════ hồi quy (điều phối yêu cầu): cờ OFF ⇒ đường cũ KHÔNG đổi kết quả ═════════════════
  // Cùng một lệnh, máy CHƯA khai kênh chế độ. Các giá trị kỳ vọng dưới đây là đường cũ, đo trên mã TRƯỚC thay đổi (chạy đỏ/xanh
  // ghi trong báo cáo task 4): cờ OFF phải cho đúng chúng. Ca thứ hai của mỗi cặp bật cờ cho CÙNG lệnh ⇒ MODE_LOCAL — chứng minh
  // cổng có thật cho lệnh này và chỉ cờ (không phải gì khác) để nó qua.
  it("hồi quy cờ OFF + OT TẮT: lệnh hitl thường (máy chưa khai) ⇒ simulated như trước (status / reason / errorText không đổi), cheDoMay 0 lần", async () => {
    expect(await ketQua(input())).toEqual({
      ok: true,
      simulated: true,
      status: "simulated",
      reason: undefined,
      rowStatus: ["simulated"],
      errorText: [null],
    });
    expect(fake.cheDoMayCalls).toEqual([]);
  });

  it("đối chứng cờ BẬT + OT TẮT: CÙNG lệnh ⇒ rejected MODE_LOCAL: chua_khai", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    expect(await ketQua(input())).toEqual({
      ok: false,
      simulated: false,
      status: "rejected",
      reason: "MODE_LOCAL",
      rowStatus: ["rejected"],
      errorText: ["MODE_LOCAL: chua_khai"],
    });
    expect(fake.cheDoMayCalls).toEqual([MAY_CHUA_KHAI]); // đối chứng của bộ đếm: cờ bật ⇒ đúng 1 lần
  });

  it("hồi quy cờ OFF + OT BẬT: lệnh hitl có action gắn đúng (máy chưa khai) ⇒ acked như trước, driver 1 lần, action executed", async () => {
    process.env.OT_CONTROL_ENABLED = "true";
    const writes = [{ tagKey: "sp", value: 42 }];
    const actionId = await makeAction({ adapterId: adA, machineId: MAY_CHUA_KHAI, writes });
    expect(await ketQua(input({ actionId, writes }))).toEqual({
      ok: true,
      simulated: false,
      status: "acked",
      reason: undefined,
      rowStatus: ["acked", "sent"],
      errorText: [null, null],
    });
    expect(writeCalls).toBe(1);
    expect(await pendingStatus(actionId)).toBe("executed");
    expect(fake.cheDoMayCalls).toEqual([]);
  });

  it("đối chứng cờ BẬT + OT BẬT: CÙNG lệnh ⇒ rejected MODE_LOCAL, driver 0 lần, action KHÔNG bị tiêu thụ", async () => {
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    const writes = [{ tagKey: "sp", value: 42 }];
    const actionId = await makeAction({ adapterId: adA, machineId: MAY_CHUA_KHAI, writes });
    expect(await ketQua(input({ actionId, writes }))).toEqual({
      ok: false,
      simulated: false,
      status: "rejected",
      reason: "MODE_LOCAL",
      rowStatus: ["rejected"],
      errorText: ["MODE_LOCAL: chua_khai"],
    });
    expect(writeCalls).toBe(0);
    expect(await pendingStatus(actionId)).toBe("confirmed");
  });

  it("hồi quy cờ OFF: máy ĐÃ khai nhưng đang LOCAL (bộ đệm khác REMOTE) — lệnh thường vẫn simulated (cờ OFF ⇒ không đọc chế độ)", async () => {
    napCheDo(1);
    expect((await ketQua(inputB())).status).toBe("simulated");
    expect(fake.cheDoMayCalls).toEqual([]);
  });

  // ═════════════════ cờ bật ═════════════════
  it("cờ bật + máy chưa khai + OT TẮT ⇒ rejected MODE_LOCAL: chua_khai (KHÔNG simulated), 1 dòng WORM, driver 0 lần", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    const inp = input();
    const res = await dispatch(inp);
    expect(res).toMatchObject({ ok: false, simulated: false, status: "rejected", reason: "MODE_LOCAL" });
    expect(res.results).toEqual([{ tagKey: "sp", ok: false, status: "rejected", error: "MODE_LOCAL" }]);
    expect(writeCalls).toBe(0);
    const rows = await ledger(inp.idempotencyKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "rejected", tagKey: "sp", errorText: "MODE_LOCAL: chua_khai", machineId: MAY_CHUA_KHAI });
    expect(res.commandLogIds).toEqual([rows[0]!.id]);
  });

  it("gọi lại CÙNG khoá sau MODE_LOCAL ⇒ trả từ chối đã lưu, không thêm dòng", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    const inp = input();
    const r1 = await dispatch(inp);
    const r2 = await dispatch(inp);
    expect(r2.status).toBe("rejected");
    expect(r2.commandLogIds).toEqual(r1.commandLogIds);
    expect(await ledger(inp.idempotencyKey)).toHaveLength(1);
  });

  it("cờ bật + máy ĐÃ khai + bộ đệm good, tươi, v = gia_tri_remote ⇒ REMOTE ⇒ đi tiếp (simulated)", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2);
    expect((await ketQua(inputB())).status).toBe("simulated");
  });

  it("cờ bật + máy đã khai, v ≠ gia_tri_remote ⇒ MODE_LOCAL: khac_remote", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(1);
    expect((await ketQua(inputB())).errorText).toEqual(["MODE_LOCAL: khac_remote"]);
  });

  it("cờ bật + máy đã khai, v đúng nhưng q='uncertain' ⇒ MODE_LOCAL: chat_luong_xau", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2, "uncertain");
    expect((await ketQua(inputB())).errorText).toEqual(["MODE_LOCAL: chat_luong_xau"]);
  });

  it("cờ bật + máy đã khai, chưa có mẫu ⇒ MODE_LOCAL: chua_co_mau", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    expect((await ketQua(inputB())).errorText).toEqual(["MODE_LOCAL: chua_co_mau"]);
  });

  it("cờ bật + bộ đệm TẮT (SCADA_LIVE_CACHE_ENABLED) ⇒ MODE_LOCAL: bo_dem_tat", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2);
    process.env.SCADA_LIVE_CACHE_ENABLED = "false";
    expect((await ketQua(inputB())).errorText).toEqual(["MODE_LOCAL: bo_dem_tat"]);
  });

  // ═════════════════ máy nào: máy của ADAPTER (fix round 1 ruling 1) ═════════════════
  it("input KHÔNG mang machineId ⇒ dùng máy của adapter (B → máy đã khai, REMOTE ⇒ đi tiếp)", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2);
    expect((await ketQua(inputB({ machineId: undefined }))).status).toBe("simulated");
    napCheDo(1);
    expect((await ketQua(inputB({ machineId: undefined }))).errorText).toEqual(["MODE_LOCAL: khac_remote"]);
  });

  it("fix round 1 (ruling 1): adapter trên máy LOCAL (A), input.machineId = máy REMOTE (B) ⇒ MODE_LOCAL — máy của ADAPTER quyết", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2); // máy đã khai đang REMOTE
    const r = await ketQua(input({ machineId: MAY_KHAI }));
    expect(r).toMatchObject({ status: "rejected", reason: "MODE_LOCAL", errorText: ["MODE_LOCAL: chua_khai"] });
    expect(fake.cheDoMayCalls).toEqual([MAY_CHUA_KHAI]);
    expect(writeCalls).toBe(0);
  });

  it("fix round 1 (ruling 1): adapter trên máy REMOTE, input.machineId = máy khác ⇒ đi tiếp (lệch machineId KHÔNG tự nó là lý do từ chối)", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2);
    expect((await ketQua(inputB({ machineId: MAY_CHUA_KHAI }))).status).toBe("simulated");
    expect(fake.cheDoMayCalls).toEqual([MAY_KHAI]);
  });

  it("fix round 1 (M-1): máy có 2 adapter — kênh chế độ trên B, lệnh ghi tới C ⇒ cổng đọc giá trị của B", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2);
    expect((await ketQua(input({ adapterId: adC, machineId: MAY_KHAI }))).status).toBe("simulated");
    napCheDo(1);
    expect((await ketQua(input({ adapterId: adC, machineId: MAY_KHAI }))).errorText).toEqual(["MODE_LOCAL: khac_remote"]);
  });

  it("fix round 1 (I-1): adapter của kênh (B) bị CHUYỂN sang máy khác ⇒ lệnh tới C (máy đã khai) MODE_LOCAL: kenh_sai_may, dù bộ đệm còn REMOTE", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2); // đăng ký OT trong tiến trình chưa theo kịp việc chuyển máy
    const x = await d();
    await x.update(deviceAdapters).set({ machineId: MAY_CHUA_KHAI }).where(eq(deviceAdapters.id, adB));
    try {
      expect((await ketQua(input({ adapterId: adC, machineId: MAY_KHAI }))).errorText).toEqual(["MODE_LOCAL: kenh_sai_may"]);
    } finally {
      await x.update(deviceAdapters).set({ machineId: MAY_KHAI }).where(eq(deviceAdapters.id, adB));
    }
  });

  it("fix round 1 (I-1): adapter của kênh (B) bị TẮT ⇒ lệnh tới C MODE_LOCAL: kenh_sai_may", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2);
    const x = await d();
    await x.update(deviceAdapters).set({ isEnabled: false }).where(eq(deviceAdapters.id, adB));
    try {
      expect((await ketQua(input({ adapterId: adC, machineId: MAY_KHAI }))).errorText).toEqual(["MODE_LOCAL: kenh_sai_may"]);
    } finally {
      await x.update(deviceAdapters).set({ isEnabled: true }).where(eq(deviceAdapters.id, adB));
    }
  });

  // ═════════════════ STOP ghim được miễn (cả lệnh, khớp theo dữ liệu) ═════════════════
  it("cờ bật + STOP ghim (stop toc_do=0) trên máy LOCAL ⇒ đi qua (simulated, OT tắt)", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    const r = await ketQua(input({ commandType: "stop", writes: [{ tagKey: "toc_do", value: 0 }] }));
    expect(r.reason).not.toBe("MODE_LOCAL");
    expect(r.status).toBe("simulated");
  });

  it("cờ bật + STOP ghim, OT BẬT, action gắn đúng ⇒ acked pinnedStop, thiết bị nhận 0 (máy LOCAL không chặn DỪNG)", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    const writes = [{ tagKey: "toc_do", value: 0 }];
    const actionId = await makeAction({ adapterId: adA, machineId: MAY_CHUA_KHAI, commandType: "stop", writes });
    const res = await dispatch(input({ actionId, commandType: "stop", writes }));
    expect(res.reason).toBeUndefined();
    expect(res.status).toBe("acked");
    expect(res.pinnedStop).toBe(true);
    expect(writtenBatches).toEqual([[{ tagKey: "toc_do", value: 0 }]]);
  });

  it("tool hmi.write_tag + cờ TẮT + STOP ghim ⇒ vẫn đi qua", async () => {
    const r = await ketQua(input({ tool: HMI, commandType: "stop", writes: [{ tagKey: "toc_do", value: 0 }] }));
    expect(r.status).toBe("simulated");
  });

  it("cờ bật + stop với giá trị KHÁC stop_value ⇒ MODE_LOCAL (miễn theo dữ liệu)", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    const r = await ketQua(input({ commandType: "stop", writes: [{ tagKey: "toc_do", value: 5 }] }));
    expect(r.errorText).toEqual(["MODE_LOCAL: chua_khai"]);
  });

  it("cờ bật + stop [toc_do=0 (ghim), sp=42 (không ghim)] ⇒ MODE_LOCAL (miễn chỉ khi CẢ lệnh là STOP ghim), mỗi write một dòng", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    const inp = input({ commandType: "stop", writes: [{ tagKey: "toc_do", value: 0 }, { tagKey: "sp", value: 42 }] });
    const r = await ketQua(inp);
    expect(r.reason).toBe("MODE_LOCAL");
    expect(r.errorText).toEqual(["MODE_LOCAL: chua_khai", "MODE_LOCAL: chua_khai"]);
  });

  it("cờ bật + đúng giá trị ghim nhưng KHÔNG phải kiểu dừng (set_param toc_do=0) ⇒ MODE_LOCAL", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    const r = await ketQua(input({ commandType: "set_param", writes: [{ tagKey: "toc_do", value: 0 }] }));
    expect(r.reason).toBe("MODE_LOCAL");
  });

  // ═════════════════ tool HMI: cổng luôn chạy ═════════════════
  it("tool hmi.write_tag + cờ TẮT + máy chưa khai ⇒ vẫn MODE_LOCAL: chua_khai", async () => {
    const r = await ketQua(input({ tool: HMI }));
    expect(r).toMatchObject({ status: "rejected", reason: "MODE_LOCAL", errorText: ["MODE_LOCAL: chua_khai"] });
  });

  it("tool hmi.write_tag + cờ TẮT + máy đã khai REMOTE ⇒ đi tiếp", async () => {
    napCheDo(2);
    expect((await ketQua(inputB({ tool: HMI }))).status).toBe("simulated");
  });

  // ═════════════════ chốt "K2 với lệnh interlock" ═════════════════
  it("cờ bật + lệnh INTERLOCK (luật đã duyệt) trên máy LOCAL ⇒ MODE_LOCAL, driver 0 lần; cờ tắt ⇒ cùng lệnh không bị cổng", async () => {
    process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
    const x = await d();
    const [rule] = await x
      .insert(interlockRules)
      .values({
        name: `${DAU} rule reduce_speed`,
        scope: "machine",
        machineId: MAY_CHUA_KHAI,
        sourceType: "ng_rate",
        comparisonOperator: "gt",
        threshold: "99999",
        action: "reduce_speed",
        targetMachineId: MAY_CHUA_KHAI,
        targetAdapterId: adA,
        commandTag: "sp",
        commandValue: 42 as never,
        requiresHumanConfirm: false,
        enabled: true,
        approvedBy: APPROVER,
        approvedAt: new Date(),
      })
      .returning();
    ruleId = rule!.id;
    const ev = async () => (await x.insert(interlockEvents).values({ ruleId, action: "reduce_speed", status: "fired" }).returning())[0]!.id;
    const il = async (): Promise<DispatchInput> => ({
      adapterId: adA,
      machineId: MAY_CHUA_KHAI,
      commandType: "reduce_speed",
      writes: [{ tagKey: "sp", value: 42 }],
      triggeredBy: { kind: "interlock", ruleId, eventId: await ev(), approvedBy: APPROVER },
      idempotencyKey: nextKey("il"),
    });
    try {
      const tat = await ketQua(await il());
      expect(tat.status).toBe("simulated");
      process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
      process.env.OT_CONTROL_ENABLED = "true";
      const bat = await ketQua(await il());
      expect(bat).toMatchObject({ status: "rejected", reason: "MODE_LOCAL", errorText: ["MODE_LOCAL: chua_khai"] });
      expect(writeCalls).toBe(0);
    } finally {
      await x.update(interlockRules).set({ enabled: false }).where(eq(interlockRules.id, ruleId));
    }
  });

  // ═════════════════ thứ tự: kiểm tag (bước 3) chạy trước K2 ═════════════════
  it("cờ bật + tag KHÔNG ghi được ⇒ TAG_NOT_WRITABLE (bước 3, trước K2) — K2 không che lỗi cũ", async () => {
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    napCheDo(2);
    const r = await ketQua(inputB({ writes: [{ tagKey: "che_do", value: 2 }] }));
    expect(r.reason).toBe("TAG_NOT_WRITABLE");
  });
});
