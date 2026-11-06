/**
 * SCADA R1b-2b-2a A2(k) (AN TOÀN, phòng thủ chiều sâu) — trong GIỮ CHỖ (reserveRealWrite): hàng uỷ quyền FOE đúc cho CHÍNH khoá này đã tiêu ('executed'),
 * khoá không có hàng sổ nào ⇒ lệnh có thể đã tới thiết bị qua đường khác (edge /authorize ghi hàng `foe-<khoá>` 'executed') ⇒ `FOE_ROW_SPENT_FOR_KEY`
 * (lớp "có thể đã bay": không gửi lại dưới attempt key mới, bước failed, bù trừ chạy, run failed), KHÔNG phải NOT_CONFIRMED (FOE: "chưa bay" ⇒ thử lại).
 * Chỉ khi đủ k1..k5 (không STOP theo khoá, tool FOE, id = orchestrationActionId(khoá), phần còn lại của ràng buộc khớp, không phải hàng mới STOP ghim A2(m));
 * thiếu một ⇒ NOT_CONFIRMED như trước.
 *
 * DB THẬT (`_test`): dispatcher THẬT + mặt tiền thiết bị THẬT (equipmentRegistry) + bộ ghi hàng uỷ quyền FOE THẬT (ensureOrchestrationAction) + engine FOE
 * THẬT (rehydrate → tiếp tục bền → resumeRun → execCommand) + driver GIẢ đếm gói ghi. Mọi ghi trong giao dịch ROLLBACK của test (ngoài nó getDb = null và
 * được ĐẾM — phải 0 ⇒ không gì được commit); command_log (WORM): không id tường minh; không DELETE / TRUNCATE.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const H = vi.hoisted(() => ({
  tx: null as unknown,
  bay: 0,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  /** K3 — adapter do node edge giữ (mock otAdapterOwnerGate) */
  edgeOwned: new Set<number>(),
}));
const EDGE_NODE = 990_917_901;

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
    listPlcConfigs: async () => [{ code: "A2K-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
// K3 — adapter "do edge giữ": CHỈ adapter trong H.edgeOwned (mọi adapter khác: hàm thật). STOP ghim không bao giờ bị cổng chủ chặn (như hàm thật).
vi.mock("./otAdapterOwnerGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otAdapterOwnerGate")>();
  return {
    ...orig,
    adapterOwnedByEdgeInTx: async (tx: unknown, adapterId: number, opts: { pinnedStop?: boolean } = {}) => {
      if (!H.edgeOwned.has(adapterId)) return orig.adapterOwnedByEdgeInTx(tx, adapterId, opts);
      if (opts.pinnedStop === true) return null;
      return { code: orig.ADAPTER_OWNED_BY_EDGE, edgeNodeId: EDGE_NODE, edgeCode: "A2K-EDGE", detail: `adapter ${adapterId} is owned by edge node ${EDGE_NODE}` };
    },
  };
});
vi.mock("../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async () => undefined };
});

import * as conn from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags, orchestrationRunSteps, orchestrationRuns, type AiPendingAction } from "../../../drizzle/schema";
import { adapterTargetFingerprint } from "./adapterTarget";
import { dispatch, MA_HANG_FOE_DA_TIEU, perWriteKey, type DispatchInput } from "./commandDispatcher";
import { otPayloadHash, withHangMoiStopGhim, withOtPayloadHash } from "./otActionBinding";
import type { OtWrite } from "./otDriver";
import { makeFoeGateRun } from "../orchestration/foe/__foeGateRunFixture";
import { buildEquipmentCommand, orchestrationActionId } from "../orchestration/foe/foeStepClass";
import { ensureOrchestrationAction } from "../orchestration/foe/foeRunStore";
import { autoResumeInterruptedRuns, FOE_OUTCOME_UNKNOWN, rehydrateInterruptedRuns, resumeRun } from "../orchestration/foe/foeEngine";
import type { WorkflowStep } from "../orchestration/foe/workflowModel";
import { equipmentRegistry, type EquipmentCommand, type EquipmentCommandResult } from "../equipment/equipmentAdapter";
import { coTheDaBayCua } from "../equipment/lenhTruocCoTheDaBay";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2K-${Date.now()}`;
const OWNER = 990_917_101;
const APPROVER = 990_917_102;
const MACHINE = 990_917_111;
const TOOL = "set_machine_param";
const ROLLBACK = Symbol("rollback");
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
        await new Promise((r) => setTimeout(r, 300)); // ghi nền muộn của lượt đi (sự kiện run …) còn rơi vào giao dịch
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

type DriverGia = { soGoi: number; writeTags: (ws: OtWrite[]) => Promise<Array<{ tagKey: string; ok: boolean }>> } & Record<string, unknown>;
/** driver giả: `soGoi` = số gói ghi ĐÃ lên dây (oracle độc lập với sổ). */
function driverGia(): DriverGia {
  const d: DriverGia = {
    protocol: "modbus",
    soGoi: 0,
    isConnected: () => true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    health: async () => ({ protocol: "modbus", connected: true }),
    writeTags: async (ws: OtWrite[]) => {
      d.soGoi += 1;
      return ws.map((w) => ({ tagKey: w.tagKey, ok: true }));
    },
    readTags: async () => [],
  };
  return d;
}

/** adapter modbus + tag thường `t` và tag GHIM STOP `a` (stopValue 0), máy giả MACHINE. */
async function taoAdapter(tx: Tx, d: unknown): Promise<number> {
  const endpoint = "tcp://192.0.2.31:502"; // TEST-NET (RFC 5737): driver giả, không bao giờ kết nối
  const [a] = await tx.insert(deviceAdapters).values({ code: `${DAU}-A-${randomUUID()}`, name: `${DAU} adapter`, protocol: "modbus", endpoint, isEnabled: true, machineId: MACHINE }).returning();
  const adapterId = a!.id;
  await tx.insert(deviceTags).values([
    { adapterId, tagKey: "t", address: "40001", dataType: "int", writable: true },
    { adapterId, tagKey: "a", address: "40003", dataType: "int", writable: true, stopValue: 0 as never },
  ]);
  H.drivers.set(adapterId, d);
  H.fingerprints.set(adapterId, adapterTargetFingerprint({ protocol: "modbus", endpoint, machineId: MACHINE, connectionOptions: null }));
  return adapterId;
}

const DESC_SET = { name: "set_param", label: "p", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
const DESC_STOP = { name: "stop", label: "s", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
const CAP = { adapterKind: "ot-stub" } as never;
const USER = { id: OWNER, role: "engineer" } as never;

/** Bước lệnh FOE THẬT: run thật (chủ OWNER, cổng g0 do APPROVER duyệt), lệnh do buildEquipmentCommand dựng, hàng uỷ quyền do ensureOrchestrationAction ghi. */
async function buocFoe(adapterId: number, key: string, args: Record<string, unknown>, desc: unknown = DESC_SET): Promise<EquipmentCommand> {
  const fx = await makeFoeGateRun({ tag: `${DAU}-${randomUUID().slice(0, 8)}`, owner: OWNER, approvedBy: APPROVER });
  const approval = { runId: fx.runId, runOwner: OWNER, approvedBy: APPROVER, gateStepId: "g0" };
  const cmd = buildEquipmentCommand(desc as never, CAP, MACHINE, { adapterId, ...args }, key, USER, approval);
  await ensureOrchestrationAction(USER, key, { id: "s1", type: "command" } as never, { adapterId, ...args }, cmd, approval);
  return cmd;
}
const gui = (cmd: EquipmentCommand) => equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
const hangUyQuyen = async (tx: Tx, id: string) => (await tx.select().from(aiPendingActions).where(eq(aiPendingActions.id, id)))[0];
/** trạng thái "edge đã tiêu hàng đúc cho khoá này" (edgeAuthorizeCentral ghi 'executed' cùng id) — hàng sổ của khoá: KHÔNG có. */
async function tieuNgoai(tx: Tx, id: string, patch: Partial<AiPendingAction> = {}): Promise<AiPendingAction> {
  await tx.update(aiPendingActions).set({ status: "executed", executedAt: new Date(Date.now() - 1_000), ...patch }).where(eq(aiPendingActions.id, id));
  return (await hangUyQuyen(tx, id))!;
}
const hangAdapter = (tx: Tx, adapterId: number) => tx.select().from(commandLog).where(eq(commandLog.adapterId, adapterId));
/** lớp FOE của một kết quả: "co_the_da_bay" (không gửi lại dưới khoá mới) hay "chua_bay" (thử lại) — đúng hàm FOE dùng. */
const lopFoe = (r: EquipmentCommandResult) => (r.ok ? "ok" : coTheDaBayCua(r) ? "co_the_da_bay" : "chua_bay");
/** hàng uỷ quyền KHÔNG đổi (không bị tiêu lần nữa, không bị viết lại) */
const giongHang = (a: AiPendingAction | undefined, b: AiPendingAction) => {
  expect(a?.status).toBe(b.status);
  expect(a?.executedAt?.getTime()).toBe(b.executedAt?.getTime());
  expect(a?.previewJson).toEqual(b.previewJson);
  expect(a?.userId).toBe(b.userId);
};

const ENV_KEYS = ["FOE_ENABLED", "FOE_DURABLE", "OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_CONTROL_TIMEOUT_MS", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("A2(k) — hàng FOE đúc cho CHÍNH khoá đã tiêu, khoá không có hàng ⇒ FOE_ROW_SPENT_FOR_KEY (DB thật, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    await import("../robot/criticalStopAlert");
  });
  afterAll(() => {
    H.drivers.clear();
    H.fingerprints.clear();
    H.edgeOwned.clear();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => {
    process.env.FOE_ENABLED = "true";
    process.env.FOE_DURABLE = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    for (const k of ENV_KEYS.slice(4)) delete process.env[k];
    H.edgeOwned.clear();
    H.bay = 0;
  });

  it("★ K1 lệnh FOE KHÔNG phải STOP, hàng đúc cho CHÍNH khoá (id = orchestrationActionId(khoá)) đã tiêu, không ý định ⇒ FOE_ROW_SPENT_FOR_KEY, 0 gói, VÀO SỔ dưới khoá ghi; lần gọi thứ hai cùng khoá PHÁT LẠI; lớp FOE \"có thể đã bay\"; hàng không đổi", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const key = `${DAU}-k1-${randomUUID().slice(0, 8)}`;
      const cmd = await buocFoe(ad, key, { tagKey: "t", value: 5 });
      expect(cmd.hitl?.actionId).toBe(orchestrationActionId(key));
      const truoc = await tieuNgoai(tx, orchestrationActionId(key));
      expect(await hangAdapter(tx, ad)).toEqual([]);

      const r = await gui(cmd);
      expect(d.soGoi).toBe(0); // ★ không bao giờ tới lệnh ghi thiết bị
      expect(r).toMatchObject({ ok: false, status: "rejected" });
      expect(r.detail?.reason).toBe(MA_HANG_FOE_DA_TIEU);
      expect(MA_HANG_FOE_DA_TIEU).toBe("FOE_ROW_SPENT_FOR_KEY");
      expect(lopFoe(r)).toBe("co_the_da_bay"); // A2(k) lật khẳng định "chua_bay" của A2(h) (a)
      const hang = await hangAdapter(tx, ad);
      expect(hang).toHaveLength(1);
      expect(hang[0]!.status).toBe("rejected");
      expect(hang[0]!.idempotencyKey).toBe(perWriteKey(key, "t", 0)); // ★ vào sổ dưới khoá ghi (giữ chỗ, writeRejected) ⇒ lần sau phát lại
      expect(String(hang[0]!.errorText)).toMatch(new RegExp(`^FOE_ROW_SPENT_FOR_KEY: orchestration action ${orchestrationActionId(key)} was minted for this very idempotency key and is already spent, yet the key has no write-ahead intent`));
      giongHang(await hangUyQuyen(tx, orchestrationActionId(key)), truoc); // ★ không tiêu / không viết lại hàng

      // lần gọi thứ hai CÙNG khoá ⇒ PHÁT LẠI lời từ chối (bước 2), không hàng sổ mới, không gói
      const r2 = await gui(cmd);
      expect(d.soGoi).toBe(0);
      expect(r2.detail?.reason).toBe(MA_HANG_FOE_DA_TIEU);
      expect(lopFoe(r2)).toBe("co_the_da_bay");
      expect(await hangAdapter(tx, ad)).toHaveLength(1);
      giongHang(await hangUyQuyen(tx, orchestrationActionId(key)), truoc);
    });
    expect(H.bay).toBe(0);
  });

  it("★ K2 (k1) STOP theo khoá — STOP theo loại (không ghim) VÀ STOP ghim — hàng đúc cho chính khoá đã tiêu ⇒ NOT_CONFIRMED như trước (STOP không bao giờ vào lớp \"có thể đã bay\")", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      for (const [nhan, args] of [
        ["stop-typed", { tagKey: "t", value: 0 }],
        ["pinned", { tagKey: "a", value: 0 }],
      ] as const) {
        const key = `${DAU}-k1s-${nhan}-${randomUUID().slice(0, 8)}`;
        const cmd = await buocFoe(ad, key, args, DESC_STOP);
        const truoc = await tieuNgoai(tx, orchestrationActionId(key));
        const r = await gui(cmd);
        expect(r.detail?.reason, nhan).toBe("NOT_CONFIRMED");
        const hang = await tx.select().from(commandLog).where(like(commandLog.idempotencyKey, `%${key}%`));
        expect(hang.map((h) => String(h.errorText)), nhan).toEqual([expect.stringMatching(/^NOT_CONFIRMED: HITL action status is 'executed'/)]);
        giongHang(await hangUyQuyen(tx, orchestrationActionId(key)), truoc);
      }
      expect(d.soGoi).toBe(0);
    });
    expect(H.bay).toBe(0);
  });

  it("★ K2 (k2) hàng KHÔNG phải của engine (tool khác) dưới đúng id foe-<khoá>, đã tiêu, gắn đúng lệnh ⇒ NOT_CONFIRMED", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const key = `${DAU}-k2-${randomUUID().slice(0, 8)}`;
      const id = orchestrationActionId(key);
      const writes = [{ tagKey: "t", value: 5 }];
      await tx.insert(aiPendingActions).values({
        id,
        tool: TOOL,
        argsJson: {},
        userId: OWNER,
        userRole: "engineer",
        summary: `${DAU} k2`,
        previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId: ad, machineId: MACHINE, commandType: "set_param", writes })),
        status: "executed",
        executedAt: new Date(Date.now() - 1_000),
        idempotencyKey: `${id}-idem`,
        expiresAt: new Date(Date.now() + 600_000),
      });
      const truoc = (await hangUyQuyen(tx, id))!;
      const r = await dispatch({ adapterId: ad, machineId: MACHINE, commandType: "set_param", writes, idempotencyKey: key, triggeredBy: { kind: "hitl", actionId: id, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER } } as DispatchInput);
      expect(d.soGoi).toBe(0);
      expect(r.reason).toBe("NOT_CONFIRMED");
      expect((await hangAdapter(tx, ad)).map((h) => String(h.errorText))).toEqual([expect.stringMatching(/^NOT_CONFIRMED: HITL action status is 'executed'/)]);
      giongHang(await hangUyQuyen(tx, id), truoc);
    });
    expect(H.bay).toBe(0);
  });

  it("★ K2 (k3) uỷ quyền đã tiêu của KHOÁ KHÁC trình dưới khoá này (dạng Sparkplug / HMI dùng lại actionId) ⇒ NOT_CONFIRMED", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const key = `${DAU}-k3-${randomUUID().slice(0, 8)}`;
      const cmd = await buocFoe(ad, key, { tagKey: "t", value: 5 });
      const truoc = await tieuNgoai(tx, orchestrationActionId(key));
      const khac = `${key}-khac`;
      const r = await gui({ ...cmd, idempotencyKey: khac });
      expect(d.soGoi).toBe(0);
      expect(r.detail?.reason).toBe("NOT_CONFIRMED");
      const hang = await hangAdapter(tx, ad);
      expect(hang.map((h) => [h.idempotencyKey, String(h.errorText).split(":")[0]])).toEqual([[perWriteKey(khac, "t", 0), "NOT_CONFIRMED"]]);
      giongHang(await hangUyQuyen(tx, orchestrationActionId(key)), truoc);
    });
    expect(H.bay).toBe(0);
  });

  it("K2 (k4) băm payload lệch: cổng (1) đã từ chối ACTION_BINDING_MISMATCH TRƯỚC giữ chỗ (không bao giờ tới đó — k4 ở giữ chỗ do test đơn vị phủ), 0 gói, hàng không đổi", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const key = `${DAU}-k4-${randomUUID().slice(0, 8)}`;
      const cmd = await buocFoe(ad, key, { tagKey: "t", value: 5 });
      const truoc = await tieuNgoai(tx, orchestrationActionId(key));
      const r = await gui({ ...cmd, writes: [{ tagKey: "t", value: 6 }] });
      expect(d.soGoi).toBe(0);
      expect(r.detail?.reason).toBe("ACTION_BINDING_MISMATCH");
      expect(lopFoe(r)).toBe("chua_bay");
      giongHang(await hangUyQuyen(tx, orchestrationActionId(key)), truoc);
    });
    expect(H.bay).toBe(0);
  });

  it("★ K2 (k5) hàng mang dấu hangMoiStopGhim (A2(m)) dưới id foe-<khoá>, đã tiêu, lệnh thường gắn đúng ⇒ NOT_CONFIRMED (giữ luật của A2(m))", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const key = `${DAU}-k5-${randomUUID().slice(0, 8)}`;
      const cmd = await buocFoe(ad, key, { tagKey: "t", value: 5 });
      const goc = (await hangUyQuyen(tx, orchestrationActionId(key)))!;
      const truoc = await tieuNgoai(tx, orchestrationActionId(key), { previewJson: withHangMoiStopGhim(goc.previewJson as Record<string, unknown>) });
      const r = await gui(cmd);
      expect(d.soGoi).toBe(0);
      expect(r.detail?.reason).toBe("NOT_CONFIRMED");
      expect((await hangAdapter(tx, ad)).map((h) => String(h.errorText))).toEqual([expect.stringMatching(/^NOT_CONFIRMED: HITL action status is 'executed'/)]);
      giongHang(await hangUyQuyen(tx, orchestrationActionId(key)), truoc);
    });
    expect(H.bay).toBe(0);
  });

  it("★ K3 rào (b2): lệnh FOE trên adapter do EDGE giữ, hàng đúc cho chính khoá đã tiêu ⇒ ADAPTER_OWNED_BY_EDGE (trước ràng buộc), hàng không đổi, 0 gói", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      H.edgeOwned.add(ad);
      const key = `${DAU}-k3e-${randomUUID().slice(0, 8)}`;
      const cmd = await buocFoe(ad, key, { tagKey: "t", value: 5 });
      const truoc = await tieuNgoai(tx, orchestrationActionId(key));
      const r = await gui(cmd);
      expect(d.soGoi).toBe(0);
      expect(r.detail?.reason).toBe("ADAPTER_OWNED_BY_EDGE");
      giongHang(await hangUyQuyen(tx, orchestrationActionId(key)), truoc);
      H.edgeOwned.delete(ad);
    });
    expect(H.bay).toBe(0);
  });
});

// ═══════════════════════════ engine FOE thật: K1 (đi bước) + K3 rào (b1) ═══════════════════════════

const motId = async (tx: Tx, q: ReturnType<typeof sql>) => Number(((await tx.execute(q)) as unknown as Array<{ id: number | string }>)[0]!.id);
const hex64 = () => Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

/** Nhà máy → … → máy M1 (adapter `stub`, tag `a`, driver giả `d1`) + máy M2 (adapter `stub`, tag `c`, driver giả `d2` — bù trừ) — TRONG giao dịch. */
async function dungThietBi(tx: Tx, d1: unknown, d2: unknown) {
  const t = Math.random().toString(36).slice(2, 8);
  const factory = await motId(tx, sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${DAU}-${t}`}, 'A2K factory', true) RETURNING id`);
  const workshop = await motId(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${factory}, ${`W-${DAU}-${t}`}, 'A2K ws') RETURNING id`);
  const line = await motId(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${workshop}, ${`L-${DAU}-${t}`}, 'A2K line') RETURNING id`);
  const station = await motId(tx, sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`S-${DAU}-${t}`}, 'A2K st') RETURNING id`);
  const m1 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M1-${DAU}-${t}`}, 'A2K m1', 'AUTOMATION', true) RETURNING id`);
  const m2 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M2-${DAU}-${t}`}, 'A2K m2', 'AUTOMATION', true) RETURNING id`);
  const e1 = `stub://a2k-1-${t}`;
  const e2 = `stub://a2k-2-${t}`;
  const a1 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A1-${DAU}-${t}`}, 'A2K main', 'stub', ${e1}, true, ${m1}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a1}, 'a', 'D10', 'int', true)`);
  const a2 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A2-${DAU}-${t}`}, 'A2K undo', 'stub', ${e2}, true, ${m2}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a2}, 'c', 'D100', 'int', true)`);
  H.drivers.set(a1, d1);
  H.fingerprints.set(a1, adapterTargetFingerprint({ protocol: "stub", endpoint: e1, machineId: m1, connectionOptions: null }));
  H.drivers.set(a2, d2);
  H.fingerprints.set(a2, adapterTargetFingerprint({ protocol: "stub", endpoint: e2, machineId: m2, connectionOptions: null }));
  return { m1, m2, a1, a2 };
}

/** Hàng uỷ quyền `foe-run<R>-main-a1` ĐÚNG như engine đúc (cùng buildEquipmentCommand + ensureOrchestrationAction, duyệt cổng g0 của APPROVER), rồi tiêu ngoài. */
async function hangA1DaTieu(tx: Tx, runId: number, m1: number, a1: number) {
  const key = `run${runId}-main-a1`;
  const approval = { runId, runOwner: OWNER, approvedBy: APPROVER, gateStepId: "g0" };
  const desc = { name: "start", label: "start", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
  const args = { adapterId: a1, tagKey: "a", value: 5 };
  const cmd = buildEquipmentCommand(desc, CAP, m1, args, key, USER, approval);
  expect(await ensureOrchestrationAction(USER, key, { id: "main", type: "command" } as never, args, cmd, approval)).toBe(orchestrationActionId(key));
  return tieuNgoai(tx, orchestrationActionId(key));
}
const buocRun = async (tx: Tx, runId: number, stepId: string) =>
  (await tx.select().from(orchestrationRunSteps).where(and(eq(orchestrationRunSteps.runId, runId), eq(orchestrationRunSteps.stepId, stepId))).limit(1))[0];

describe.skipIf(!DB_URL)("A2(k) — engine FOE thật: bước gặp FOE_ROW_SPENT_FOR_KEY ⇒ FOE_OUTCOME_UNKNOWN, không a2, bù trừ chạy; run edge ⇒ không bao giờ đi ở trung tâm (DB thật, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("./safetyTarget");
    await import("../safety/plc/safetyPlcAdapter");
    await import("../robot/criticalStopAlert");
  });
  afterAll(() => {
    H.drivers.clear();
    H.fingerprints.clear();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => {
    process.env.FOE_ENABLED = "true";
    process.env.FOE_DURABLE = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    for (const k of ENV_KEYS.slice(4)) delete process.env[k];
    H.edgeOwned.clear();
    H.bay = 0;
  });

  it("★ K1 (engine) bước KHÔNG phải STOP (maxAttempts 2), hàng a1 đúc cho chính khoá đã tiêu ở nơi khác, không ý định ⇒ dựng lại ⇒ 0 gói, KHÔNG attempt key a2, failed FOE_OUTCOME_UNKNOWN (FOE_ROW_SPENT_FOR_KEY); A2(n): bù trừ KHÔNG-STOP bị GIỮ (0 lần ghi), run held", async () => {
    await trongGiaoDich(async (tx) => {
      const d1 = driverGia();
      const d2 = driverGia();
      const { m1, m2, a1, a2 } = await dungThietBi(tx, d1, d2);
      const main: WorkflowStep = {
        id: "main",
        type: "command",
        machineId: m1,
        command: "start",
        args: { tagKey: "a", value: 5 },
        maxAttempts: 2,
        compensation: { id: "undo", type: "command", machineId: m2, command: "reset", args: { tagKey: "c", value: 1 } },
      } as WorkflowStep;
      const fx = await makeFoeGateRun({ tag: `${DAU}-${randomUUID().slice(0, 8)}`, owner: OWNER, approvedBy: APPROVER, steps: [main] });
      const runId = fx.runId;
      const truoc = await hangA1DaTieu(tx, runId, m1, a1);

      await rehydrateInterruptedRuns();
      await autoResumeInterruptedRuns([runId]);

      expect(d1.soGoi).toBe(0); // ★ thiết bị KHÔNG bị ghi
      const [run] = await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId));
      expect(run!.status).toBe("held"); // R1b-2b-2a A2(n) — was "failed" after the automatic reset below
      const b = await buocRun(tx, runId, "main");
      expect(b?.status).toBe("failed");
      expect(b?.attempt).toBe(1);
      expect(String(b?.error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: FOE_ROW_SPENT_FOR_KEY: command "start" — .*check the device before continuing; outcome unknown — not sent again; check the device\\.$`));
      // ★ không attempt key mới: không uỷ quyền, không hàng sổ nào cho a2 / a3
      expect(await tx.select().from(aiPendingActions).where(like(aiPendingActions.id, `foe-run${runId}-main-a%`)).then((x) => x.map((a) => a.id).sort())).toEqual([`foe-run${runId}-main-a1`]);
      const soMain = await hangAdapter(tx, a1);
      expect(soMain.map((h) => [h.idempotencyKey, h.status, String(h.errorText).split(":")[0]])).toEqual([[perWriteKey(`run${runId}-main-a1`, "a", 0), "rejected", "FOE_ROW_SPENT_FOR_KEY"]]);
      giongHang(await hangUyQuyen(tx, orchestrationActionId(`run${runId}-main-a1`)), truoc);
      // R1b-2b-2a A2(n) — the compensation (reset on another machine, not a pinned STOP) is NOT written after the unknown outcome: held
      expect(d2.soGoi).toBe(0);
      expect((await buocRun(tx, runId, "undo"))?.status).toBe("held");
      expect(await hangAdapter(tx, a2)).toEqual([]);
    });
    expect(H.bay).toBe(0);
  });

  it("★ K3 rào (b1): run do EDGE thực thi (gán vĩnh viễn) + hàng `foe-run<R>-main-a1` đã tiêu (edge /authorize) ⇒ resumeRun xếp lại cho node (queued), 0 hàng command_log, 0 gói, hàng không đổi", async () => {
    await trongGiaoDich(async (tx) => {
      const d1 = driverGia();
      const d2 = driverGia();
      const { m1, a1 } = await dungThietBi(tx, d1, d2);
      const main = { id: "main", type: "command", machineId: m1, command: "start", args: { tagKey: "a", value: 5 }, maxAttempts: 2 } as WorkflowStep;
      const fx = await makeFoeGateRun({ tag: `${DAU}-${randomUUID().slice(0, 8)}`, owner: OWNER, approvedBy: APPROVER, steps: [main] });
      const runId = fx.runId;
      const nodeId = await motId(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`N-${DAU}-${randomUUID().slice(0, 6)}`}, 'a2k node', 'online') RETURNING id`);
      // trigger 0370: một phép gán mới đòi run `queued` (đúng như startRun gán) ⇒ run về queued trước, rồi gán, rồi nhận (claim 1), rồi "held"
      await tx.update(orchestrationRuns).set({ status: "queued" }).where(eq(orchestrationRuns.id, runId));
      const credId = await motId(tx, sql`INSERT INTO edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${nodeId}, ${`edn_${hex64().slice(0, 12)}`}, ${hex64()}) RETURNING id`);
      await tx.execute(sql`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy") VALUES (${runId}, ${nodeId}, ${fx.workflowId}, 1, ${hex64()}, ${OWNER})`);
      await tx.execute(sql`UPDATE orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${hex64()}, "claimedByCredentialId" = ${credId}, "claimedAt" = now() WHERE "runId" = ${runId}`);
      await tx.execute(sql`INSERT INTO edge_step_authorizations (jti, "edgeNodeId", "credentialId", "runId", "claimSeq", "stepId", attempt, "idempotencyKey", kind, "payloadHash", "approvalJson", "verdictJson", kid, "reqNonceHash", "expiresAt")
        VALUES (${randomUUID()}, ${nodeId}, ${credId}, ${runId}, 1, 'main', 1, ${`run${runId}-main-a1`}, 'ot', ${`sha256:${hex64()}`}, ${JSON.stringify({ approvedBy: APPROVER })}::jsonb, ${JSON.stringify({ target: { adapterId: a1 } })}::jsonb, ${"edk_" + "A".repeat(22)}, ${hex64()}, now() + interval '30 seconds')`);
      const truoc = await hangA1DaTieu(tx, runId, m1, a1);
      await tx.update(orchestrationRuns).set({ status: "held", contextJson: { interrupted: true } }).where(eq(orchestrationRuns.id, runId));

      const r = await resumeRun(runId, { approved: true, note: "a2k continue" }, { id: 0, role: "system", name: "a2k" } as never);
      expect(r).toMatchObject({ ok: true, status: "queued", edgeNodeId: nodeId });
      const [run] = await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId));
      expect(run!.status).toBe("queued");
      expect(d1.soGoi).toBe(0);
      expect(await hangAdapter(tx, a1)).toEqual([]);
      expect(await tx.select().from(commandLog).where(inArray(commandLog.idempotencyKey, [perWriteKey(`run${runId}-main-a1`, "a", 0), `intent:${perWriteKey(`run${runId}-main-a1`, "a", 0)}`]))).toEqual([]);
      giongHang(await hangUyQuyen(tx, orchestrationActionId(`run${runId}-main-a1`)), truoc);
    });
    expect(H.bay).toBe(0);
  });
});
