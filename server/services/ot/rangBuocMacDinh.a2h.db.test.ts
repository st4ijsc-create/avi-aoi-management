/**
 * SCADA R1b-2b-2a A2(h) (AN TOÀN) — lệnh HITL phải mang uỷ quyền GẮN đúng lệnh theo MẶC ĐỊNH; STOP ghim không bao giờ bị từ chối vì thiếu duyệt riêng.
 * AMENDMENT 2 — hàng `executed` (đã tiêu) gắn đúng lệnh ở cổng (1) đi tiếp tới bước (2) (phát lại / DUPLICATE_IN_FLIGHT …); giữ chỗ vẫn chỉ nhận `confirmed`.
 *
 * DB THẬT (`_test`): dispatcher THẬT + mặt tiền thiết bị THẬT (equipmentRegistry) + bộ ghi hàng uỷ quyền FOE THẬT (ensureOrchestrationAction) + driver
 * GIẢ đếm gói ghi; mọi ghi trong giao dịch ROLLBACK của test (ngoài nó getDb = null ⇒ không gì được commit); command_log (WORM): không id tường minh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const H = vi.hoisted(() => ({
  tx: null as unknown,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  /** H7 — adapter do node edge giữ (mock otAdapterOwnerGate) + yêu cầu STOP xếp cho node + STOP dự phòng của trung tâm */
  edgeOwned: new Set<number>(),
  enqueued: [] as Array<Record<string, unknown>>,
  fallback: [] as number[],
}));
const EDGE_NODE = 990_914_901;

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...real,
    getDb: (async () => (H.tx ? H.tx : null)) as typeof real.getDb,
    __realGetDb: real.getDb,
  };
});
// bàn an toàn (preflight): PLC giả "thật", estop=false (cùng mock với A2(a) / A2(g))
vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "A2H-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
// H7 — adapter "do edge giữ": CHỈ adapter trong H.edgeOwned (mọi adapter khác: hàm thật). STOP ghim không bao giờ bị cổng chủ chặn (như hàm thật).
vi.mock("./otAdapterOwnerGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otAdapterOwnerGate")>();
  return {
    ...orig,
    adapterOwnedByEdgeInTx: async (tx: unknown, adapterId: number, opts: { pinnedStop?: boolean } = {}) => {
      if (!H.edgeOwned.has(adapterId)) return orig.adapterOwnedByEdgeInTx(tx, adapterId, opts);
      if (opts.pinnedStop === true) return null;
      return { code: orig.ADAPTER_OWNED_BY_EDGE, edgeNodeId: EDGE_NODE, edgeCode: "A2H-EDGE", detail: `adapter ${adapterId} is owned by edge node ${EDGE_NODE}` };
    },
  };
});
vi.mock("../edge/edgeNodeCommands", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../edge/edgeNodeCommands")>();
  return {
    ...orig,
    enqueueEdgeDeviceRequest: async (x: Record<string, unknown>) => {
      H.enqueued.push(x);
      return { requestId: 4242, edgeNodeId: EDGE_NODE, ownerEpoch: 1 };
    },
    edgeNodeReachability: async () => ({ reachable: true, basis: "pull", ageMs: 0 }),
  };
});
vi.mock("../robot/deviceOwnershipService", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/deviceOwnershipService")>();
  return {
    ...orig,
    sendCentralAdapterStop: async (adapterId: number) => {
      H.fallback.push(adapterId);
      return { ok: true, sent: "sent", detail: "" };
    },
  };
});
vi.mock("../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async () => undefined };
});

import * as conn from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { adapterTargetFingerprint } from "./adapterTarget";
import { __catSauGhiThietBiChoTest, dispatch, perWriteKey, phanLoaiStopGhimRangBuoc, type DispatchInput, type DispatchResult } from "./commandDispatcher";
import { foeSelfApprovalRefusal, otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { _setPinReadProbeForTests } from "./stopPin";
import type { OtWrite } from "./otDriver";
import { makeFoeGateRun } from "../orchestration/foe/__foeGateRunFixture";
import { buildEquipmentCommand, orchestrationActionId } from "../orchestration/foe/foeStepClass";
import { centralRunStore, ensureOrchestrationAction } from "../orchestration/foe/foeRunStore";
import { abortStopKey } from "../orchestration/foe/foeEngine";
import { equipmentRegistry, type EquipmentCommand, type EquipmentCommandResult } from "../equipment/equipmentAdapter";
import { coTheDaBayCua } from "../equipment/lenhTruocCoTheDaBay";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2H-${Date.now()}`;
const OWNER = 990_914_101;
const APPROVER = 990_914_102;
const MACHINE = 990_914_111;
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
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

type DriverGia = { soGoi: number; ghi: OtWrite[][]; treo: "khong" | "truoc_goi"; writeTags: (ws: OtWrite[]) => Promise<Array<{ tagKey: string; ok: boolean }>> } & Record<string, unknown>;
/** driver giả: `soGoi` = số gói ghi ĐÃ lên dây. `treo = "truoc_goi"` ⇒ writeTags không bao giờ trả lời và KHÔNG gửi gì (sập trước gói). */
function driverGia(): DriverGia {
  const d: DriverGia = {
    protocol: "modbus",
    soGoi: 0,
    ghi: [],
    treo: "khong",
    isConnected: () => true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    health: async () => ({ protocol: "modbus", connected: true }),
    writeTags: async (ws: OtWrite[]) => {
      if (d.treo === "truoc_goi") return new Promise<never>(() => undefined);
      d.soGoi += 1;
      d.ghi.push(ws.map((w) => ({ ...w })));
      return ws.map((w) => ({ tagKey: w.tagKey, ok: true }));
    },
    readTags: async () => [],
  };
  return d;
}

/** adapter modbus + tag thường `t` và tag GHIM STOP `a` (stopValue 0). */
async function taoAdapter(tx: Tx, d: unknown): Promise<number> {
  const endpoint = "tcp://192.0.2.21:502"; // TEST-NET (RFC 5737): driver giả, không bao giờ kết nối
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

/**
 * kiem-dinh k14 — adapter modbus có kênh GHI ĐÃ KHAI (channelKind "output" ⇒ `kenhDaKhaiGhi` ⇒ giá trị được ép kiểu ở cổng (1) và bước 3b):
 * `ik` int ghim 0 (thanh ghi), `bk` bool ghim true (địa chỉ BIT coil:5 — luật bit của congKenhSom với modbus).
 */
async function taoAdapterKhai(tx: Tx, d: unknown): Promise<number> {
  const endpoint = "tcp://192.0.2.22:502"; // TEST-NET (RFC 5737): driver giả, không bao giờ kết nối
  const [a] = await tx.insert(deviceAdapters).values({ code: `${DAU}-AK-${randomUUID()}`, name: `${DAU} adapter khai`, protocol: "modbus", endpoint, isEnabled: true, machineId: MACHINE }).returning();
  const adapterId = a!.id;
  await tx.insert(deviceTags).values([
    { adapterId, tagKey: "ik", address: "40004", dataType: "int", writable: true, channelKind: "output", stopValue: 0 as never },
    { adapterId, tagKey: "bk", address: "coil:5", dataType: "bool", writable: true, channelKind: "output", stopValue: true as never },
  ]);
  H.drivers.set(adapterId, d);
  H.fingerprints.set(adapterId, adapterTargetFingerprint({ protocol: "modbus", endpoint, machineId: MACHINE, connectionOptions: null }));
  return adapterId;
}

const DESC_SET = { name: "set_param", label: "p", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
const CAP = { adapterKind: "ot-stub" } as never;

/** Bước lệnh FOE THẬT: run thật (chủ OWNER, cổng g0 do APPROVER duyệt), lệnh do buildEquipmentCommand dựng, hàng uỷ quyền do ensureOrchestrationAction ghi. */
async function buocFoe(adapterId: number, key: string, args: Record<string, unknown>): Promise<EquipmentCommand> {
  const fx = await makeFoeGateRun({ tag: `${DAU}-${randomUUID().slice(0, 8)}`, owner: OWNER, approvedBy: APPROVER });
  const approval = { runId: fx.runId, runOwner: OWNER, approvedBy: APPROVER, gateStepId: "g0" };
  const user = { id: OWNER, role: "engineer" } as never;
  const cmd = buildEquipmentCommand(DESC_SET, CAP, MACHINE, { adapterId, ...args }, key, user, approval);
  await ensureOrchestrationAction(user, key, { id: "s1", type: "command" } as never, { adapterId, ...args }, cmd, approval);
  return cmd;
}
const gui = (cmd: EquipmentCommand) => equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
const trangThaiHang = async (tx: Tx, id: string) => (await tx.select().from(aiPendingActions).where(eq(aiPendingActions.id, id)))[0]?.status;
const hangCuaKhoa = (tx: Tx, key: string) => tx.select().from(commandLog).where(like(commandLog.idempotencyKey, `%${key}%`));
/** lớp FOE của một kết quả: "co_the_da_bay" (giữ cho người) hay "chua_bay" (thử lại dưới khoá mới) — đúng hàm FOE dùng. */
const lopFoe = (r: EquipmentCommandResult) => (r.ok ? "ok" : coTheDaBayCua(r) ? "co_the_da_bay" : "chua_bay");

/** Lượt đi đầu tới chỗ cắt (sau khi thiết bị trả lời / quá hạn, TRƯỚC hàng kết quả) rồi TREO mãi = tiến trình chết ở đó. */
async function sapTaiChoCat(cmd: EquipmentCommand): Promise<void> {
  let toi!: () => void;
  const daToi = new Promise<void>((r) => (toi = r));
  expect(
    __catSauGhiThietBiChoTest(async (input: DispatchInput) => {
      if (input.idempotencyKey !== cmd.idempotencyKey) return;
      toi();
      await new Promise<never>(() => undefined);
    }),
  ).toBe(true);
  void gui(cmd);
  await Promise.race([daToi, new Promise((_, rej) => setTimeout(() => rej(new Error("chỗ cắt không tới trong 20 s")), 20_000))]);
  __catSauGhiThietBiChoTest(null);
}

const ENV_KEYS = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_CONTROL_TIMEOUT_MS", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("A2(h) AMENDMENT 2 — hàng uỷ quyền ĐÃ TIÊU ở cổng (1): điểm sập (a)(b)(c) + rào giữ chỗ (DB thật, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    await import("../robot/criticalStopAlert");
  });
  afterAll(() => {
    __catSauGhiThietBiChoTest(null);
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

  it("★ (a) + rào: hàng FOE ĐÃ TIÊU gắn ĐÚNG lệnh, KHÔNG hàng sổ nào của khoá (sau giữ chỗ, trước ý định) ⇒ qua cổng (1), bước (2) không chặn ⇒ giữ chỗ TỪ CHỐI (chỉ nhận confirmed), 0 gói — hôm nay: lớp FOE \"chưa bay\" (lỗ có sẵn, A2(k))", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const key = `${DAU}-a-${randomUUID().slice(0, 8)}`;
      const cmd = await buocFoe(ad, key, { tagKey: "t", value: 5 });
      // trạng thái (a): giữ chỗ đã tiêu hàng (confirmed → executed), chưa có hàng sổ nào mang khoá
      await tx.update(aiPendingActions).set({ status: "executed", executedAt: new Date() }).where(eq(aiPendingActions.id, orchestrationActionId(key)));
      expect(await hangCuaKhoa(tx, key)).toEqual([]);

      const r = await gui(cmd);
      expect(d.soGoi).toBe(0); // ★ rào: không bao giờ tới lệnh ghi thiết bị
      const hang = await tx.select().from(commandLog).where(and(eq(commandLog.adapterId, ad)));
      expect(r).toMatchObject({ ok: false, status: "rejected" });
      expect(r.detail?.reason).toBe("NOT_CONFIRMED");
      expect(hang.map((h) => String(h.errorText))).toEqual([expect.stringMatching(/^NOT_CONFIRMED: HITL action status is 'executed'/)]);
      // hàng ghi bởi GIỮ CHỖ (không phải cổng (1)): mang khoá ghi (lienKetTuChoiTruocBuoc2 cho NULL)
      expect(hang[0]!.idempotencyKey).toBe(perWriteKey(key, "t", 0));
      // ⚠ PRE-EXISTING HOLE on main, edge path (edgeAuthorizeCentral.ts:650-663 writes the row executed), see A2(k). Ghim ĐÚNG hành vi hôm nay
      // (giống hệt main 0ee74e828): giữ chỗ từ chối NOT_CONFIRMED — lớp FOE "chưa bay" (thử lại dưới khoá mới). Ở trung tâm, trạng thái này không thể có do
      // sập (giữ chỗ tiêu hàng + ghi ý định trong MỘT giao dịch) nên "chưa bay" là thật; hàng do edge uỷ quyền thì không. A2(k) lật khẳng định này.
      expect(lopFoe(r)).toBe("chua_bay");
    });
  });

  it("★ (b) sập SAU hàng ý định, TRƯỚC gói (driver không bao giờ gửi) ⇒ chạy lại cùng khoá + cùng hàng (đã tiêu) ⇒ DUPLICATE_IN_FLIGHT (lớp có-thể-đã-bay), 0 gói thêm", async () => {
    process.env.OT_CONTROL_TIMEOUT_MS = "300";
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      d.treo = "truoc_goi";
      const ad = await taoAdapter(tx, d);
      const key = `${DAU}-b-${randomUUID().slice(0, 8)}`;
      const cmd = await buocFoe(ad, key, { tagKey: "t", value: 6 });
      await sapTaiChoCat(cmd);
      expect(d.soGoi).toBe(0);
      expect(await trangThaiHang(tx, orchestrationActionId(key))).toBe("executed");
      const sauSap = await hangCuaKhoa(tx, key);
      expect(sauSap.map((h) => h.idempotencyKey)).toEqual([`intent:${perWriteKey(key, "t", 0)}`]);

      d.treo = "khong";
      const r = await gui(cmd);
      expect(d.soGoi).toBe(0); // ★ 0 gói thêm
      expect(r.detail?.reason).toBe("DUPLICATE_IN_FLIGHT");
      expect(lopFoe(r)).toBe("co_the_da_bay");
    });
  });

  it("★ (c) sập SAU gói, TRƯỚC hàng kết quả ⇒ chạy lại cùng khoá + cùng hàng (đã tiêu) ⇒ DUPLICATE_IN_FLIGHT (lớp có-thể-đã-bay), 0 gói thêm", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const key = `${DAU}-c-${randomUUID().slice(0, 8)}`;
      const cmd = await buocFoe(ad, key, { tagKey: "t", value: 7 });
      await sapTaiChoCat(cmd);
      expect(d.soGoi).toBe(1); // thiết bị ĐÃ bị ghi
      expect(await trangThaiHang(tx, orchestrationActionId(key))).toBe("executed");

      const r = await gui(cmd);
      expect(d.soGoi).toBe(1); // ★ 0 gói thêm
      expect(r.detail?.reason).toBe("DUPLICATE_IN_FLIGHT");
      expect(lopFoe(r)).toBe("co_the_da_bay");
    });
  });
});

// ═══════════════════════════════════ H1–H8 + E1–E3 ═══════════════════════════════════

const TOOL = "set_machine_param";
const OTHER = 990_914_103;
const DESC_STOP = { name: "stop", label: "s", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
const USER = { id: OWNER, role: "engineer" } as never;
type W = Array<{ tagKey: string; value: unknown }>;
const STOP_GHIM: W = [{ tagKey: "a", value: 0 }];

/** Uỷ quyền HITL thường (tool set_machine_param) gắn băm của `writes` + `commandType`; `chu` / `trangThai` chỉnh được. */
async function taoHanhDong(tx: Tx, adapterId: number, writes: W, o: { commandType?: string; chu?: number; trangThai?: "confirmed" | "executed"; khongBam?: boolean } = {}): Promise<string> {
  const actionId = `${DAU}-act-${randomUUID()}`;
  const bam = otPayloadHash({ tool: TOOL, adapterId, machineId: MACHINE, commandType: o.commandType ?? "set_param", writes });
  await tx.insert(aiPendingActions).values({
    id: actionId,
    tool: TOOL,
    argsJson: {},
    userId: o.chu ?? OWNER,
    userRole: "engineer",
    summary: `${DAU} test action`,
    previewJson: o.khongBam ? { entityType: "machine" } : withOtPayloadHash({ entityType: "machine" }, bam),
    status: o.trangThai ?? "confirmed",
    ...(o.trangThai === "executed" ? { executedAt: new Date() } : {}),
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return actionId;
}
const lenh = (adapterId: number, writes: W, khoa: string, triggeredBy: DispatchInput["triggeredBy"], commandType = "set_param"): DispatchInput =>
  ({ adapterId, machineId: MACHINE, commandType, writes, triggeredBy, idempotencyKey: khoa }) as DispatchInput;
const hitl = (actionId?: string) => ({ kind: "hitl" as const, ...(actionId ? { actionId } : {}), tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER });
const k = (t: string) => `${DAU}-${t}-${randomUUID().slice(0, 8)}`;

/** FOE tự xác nhận (KHÔNG duyệt cổng: hàng ensureOrchestrationAction ghi cho STOP — foeRunStore ≈517; lệnh "NO approval, ever" foeEngine ≈3838). */
async function foeTuDuyet(adapterId: number, key: string, desc: unknown, args: Record<string, unknown>): Promise<EquipmentCommand> {
  const a = { adapterId, ...args };
  const cmd = buildEquipmentCommand(desc as never, CAP, MACHINE, a, key, USER);
  await ensureOrchestrationAction(USER, key, { id: "s-self", type: "command" } as never, a, cmd);
  return cmd;
}

/** Hàng từ chối ở cổng (1): rejected, khoá NULL + ackValue.khoaGoc = khoá, errorText `${mã}: …`. */
async function hangCong1(tx: Tx, r: DispatchResult | EquipmentCommandResult, khoa: string, ma: string) {
  const ids = ("commandLogIds" in r ? r.commandLogIds : (r.detail?.commandLogIds as number[])) ?? [];
  const hang = await tx.select().from(commandLog).where(inArray(commandLog.id, ids));
  expect(hang.length).toBeGreaterThan(0);
  for (const h of hang) {
    expect(h.status).toBe("rejected");
    expect(h.idempotencyKey).toBeNull();
    expect((h.ackValue as { khoaGoc?: unknown } | null)?.khoaGoc).toBe(khoa);
    expect(String(h.errorText).startsWith(`${ma}: `)).toBe(true);
  }
  return hang;
}

const docGhimLoi = () =>
  _setPinReadProbeForTests(() => {
    throw new Error("pin read down");
  });

describe.skipIf(!DB_URL)("A2(h) — ràng buộc MẶC ĐỊNH ở cổng (1); STOP ghim không bị từ chối (DB thật, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k2 of ENV_KEYS) savedEnv[k2] = process.env[k2];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    await import("../robot/criticalStopAlert");
  });
  afterAll(() => {
    _setPinReadProbeForTests(null);
    H.drivers.clear();
    H.fingerprints.clear();
    H.edgeOwned.clear();
    for (const k2 of ENV_KEYS) {
      if (savedEnv[k2] === undefined) delete process.env[k2];
      else process.env[k2] = savedEnv[k2];
    }
  });
  beforeEach(() => {
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    for (const k2 of ENV_KEYS.slice(2)) delete process.env[k2];
    H.enqueued.length = 0;
    H.fallback.length = 0;
    _setPinReadProbeForTests(null);
  });

  it("★ H1 nhánh (C): HITL KHÔNG actionId, lệnh thường ⇒ PRECONDITION_FAILED, 0 gói, khoá NULL + khoaGoc — đường thật VÀ mô phỏng", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      for (const bat of ["true", "false"]) {
        process.env.OT_CONTROL_ENABLED = bat;
        const K = k("h1");
        const r = await dispatch(lenh(ad, [{ tagKey: "t", value: 1 }], K, hitl()));
        expect(r).toMatchObject({ ok: false, simulated: false, status: "rejected", reason: "PRECONDITION_FAILED" });
        const [h] = await hangCong1(tx, r, K, "PRECONDITION_FAILED");
        expect(h!.errorText).toBe("PRECONDITION_FAILED: command requires a bound, confirmed HITL actionId (none supplied)");
      }
      expect(d.soGoi).toBe(0);
    });
  });

  it("★ H2 nhánh (B): actionId confirmed + đúng chủ nhưng gắn lệnh KHÁC (tag/giá trị khác) hoặc KHÔNG băm ⇒ từ chối ở cổng (1) (cả mô phỏng); gắn ĐÚNG ⇒ qua cổng như trước", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const W1: W = [{ tagKey: "t", value: 1 }];
      for (const bat of ["false", "true"]) {
        process.env.OT_CONTROL_ENABLED = bat;
        for (const sai of [[{ tagKey: "t", value: 99 }], [{ tagKey: "a", value: 1 }]] as W[]) {
          const K1 = k("h2a");
          const r1 = await dispatch(lenh(ad, W1, K1, hitl(await taoHanhDong(tx, ad, sai))));
          expect(r1).toMatchObject({ ok: false, simulated: false, status: "rejected", reason: "ACTION_BINDING_MISMATCH" });
          await hangCong1(tx, r1, K1, "ACTION_BINDING_MISMATCH");
        }
        const K2 = k("h2b");
        const r2 = await dispatch(lenh(ad, W1, K2, hitl(await taoHanhDong(tx, ad, W1, { khongBam: true }))));
        expect(r2).toMatchObject({ ok: false, status: "rejected", reason: "ACTION_BINDING_MISMATCH" });
        const [h2] = await hangCong1(tx, r2, K2, "ACTION_BINDING_MISMATCH");
        expect(h2!.errorText).toBe("ACTION_BINDING_MISMATCH: HITL action carries no OT payload binding");
      }
      expect(d.soGoi).toBe(0);
      process.env.OT_CONTROL_ENABLED = "false";
      const sim = await dispatch(lenh(ad, W1, k("h2c"), hitl(await taoHanhDong(tx, ad, W1))));
      expect(sim).toMatchObject({ ok: true, simulated: true, status: "simulated" });
      process.env.OT_CONTROL_ENABLED = "true";
      const that = await dispatch(lenh(ad, W1, k("h2d"), hitl(await taoHanhDong(tx, ad, W1))));
      expect(that).toMatchObject({ ok: true, simulated: false, status: "acked" });
      expect(d.soGoi).toBe(1);
    });
  });

  it("★ H3 FOE STOP GHIM ×3 với hàng TỰ XÁC NHẬN của FOE vẫn BAY (+1 gói mỗi lần): (a) quét huỷ, (b) STOP khi cổng bị TỪ CHỐI, (c) bước STOP trong run KHÔNG có cổng duyệt", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const args = { adapterId: ad, writes: STOP_GHIM };
      const step = { id: "s-stop", type: "command", machineId: MACHINE, command: "stop", args } as never;
      // (a) quét huỷ: khoá abortStopKey, lệnh dựng KHÔNG duyệt, hàng do kho trung tâm authorizeAbortStop ghi (đúng đường prepareAbortStop)
      const runA = (await makeFoeGateRun({ tag: `${DAU}-h3a-${randomUUID().slice(0, 6)}`, owner: OWNER, approvedBy: APPROVER })).runId;
      // (b) cổng bị TỪ CHỐI ⇒ cùng quét STOP (resumeRun reject → prepareAbortStop), nonce riêng — run không có duyệt nào
      const runB = (await makeFoeGateRun({ tag: `${DAU}-h3b-${randomUUID().slice(0, 6)}`, owner: OWNER, approvedBy: null })).runId;
      for (const [runId, nonce] of [[runA, "n-abort"], [runB, "n-reject"]] as const) {
        const key = abortStopKey(runId, "s-stop", nonce);
        const cmd = buildEquipmentCommand(DESC_STOP, CAP, MACHINE, args, key, USER);
        await centralRunStore.authorizeAbortStop(runId, USER, step, key, args, cmd);
        const [row] = await tx.select().from(aiPendingActions).where(eq(aiPendingActions.id, cmd.hitl.actionId));
        expect(foeSelfApprovalRefusal(row!, OWNER)).toMatch(/no separate gate approval/); // hàng tự xác nhận thật
        const truoc = d.soGoi;
        const r = await gui(cmd);
        expect(r, nonce).toMatchObject({ ok: true, status: "acked" });
        expect(d.soGoi - truoc).toBe(1);
      }
      // (c) bước STOP của run KHÔNG cổng: uỷ quyền trung tâm THẬT (centralAuthorizeCommand ⇒ không duyệt ⇒ hàng tự xác nhận)
      const runC = (await makeFoeGateRun({ tag: `${DAU}-h3c-${randomUUID().slice(0, 6)}`, owner: OWNER, approvedBy: null })).runId;
      const rc = { runId: runC, def: { ref: `${DAU}-h3c`, name: "h3c", steps: [] }, user: USER, startedViaApi: false } as never;
      const auth = await centralRunStore.authorizeCommand(rc, step, 1, { isStop: true, robotKind: false, rawArgs: args, descriptor: DESC_STOP, cap: CAP, idempotencyKey: `run${runC}-s-stop-a1` });
      expect(auth.ok).toBe(true);
      const { cmd: cmdC, approval } = auth as unknown as { cmd: EquipmentCommand; approval: unknown };
      expect(approval).toBeNull();
      const truoc = d.soGoi;
      const rC = await gui(cmdC);
      expect(rC).toMatchObject({ ok: true, status: "acked" });
      expect(d.soGoi - truoc).toBe(1);
    });
  });

  it("★ H4 hàng FOE tự xác nhận cho lệnh KHÔNG phải STOP ⇒ vẫn bị từ chối NOT_CONFIRMED (tự duyệt) Ở CỔNG (1) — mô phỏng và thật, 0 gói", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      for (const bat of ["false", "true"]) {
        process.env.OT_CONTROL_ENABLED = bat;
        const key = k("h4");
        const r = await gui(await foeTuDuyet(ad, key, DESC_SET, { tagKey: "t", value: 5 }));
        expect(r).toMatchObject({ ok: false, status: "rejected" });
        expect(r.detail?.reason).toBe("NOT_CONFIRMED");
        const [h] = await hangCong1(tx, r, key, "NOT_CONFIRMED");
        expect(h!.errorText).toMatch(/^NOT_CONFIRMED: orchestration action carries no separate gate approval/);
      }
      expect(d.soGoi).toBe(0);
    });
  });

  it("★ H5 loại STOP mà nội dung KHÔNG ghim / nội dung ghim mà loại THƯỜNG / đọc ghim lỗi ⇒ như giữ chỗ với pinnedStop=false: NOT_CONFIRMED (cùng câu foeSelfApprovalRefusal), không mô phỏng, 0 gói", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const ca: Array<[string, unknown, Record<string, unknown>, boolean]> = [
        ["STOP, a=1 (không ghim)", DESC_STOP, { writes: [{ tagKey: "a", value: 1 }] }, false],
        ["set_param, a=0 (nội dung ghim, loại thường)", DESC_SET, { writes: STOP_GHIM }, false],
        ["STOP ghim nhưng đọc ghim LỖI ở cổng (1)", DESC_STOP, { writes: STOP_GHIM }, true],
      ];
      for (const bat of ["false", "true"]) {
        process.env.OT_CONTROL_ENABLED = bat;
        for (const [ten, desc, args, ghimLoi] of ca) {
          // đường thật: 5a-stop đọc ghim từ hàng bước 3 (không qua loadStopPins) — ca đọc-lỗi chỉ đo cổng (1), ở đường mô phỏng
          if (bat === "true" && ghimLoi) continue;
          const key = k("h5");
          const cmd = await foeTuDuyet(ad, key, desc, args);
          const [row] = await tx.select().from(aiPendingActions).where(eq(aiPendingActions.id, cmd.hitl.actionId));
          if (ghimLoi) docGhimLoi();
          const r = await gui(cmd);
          _setPinReadProbeForTests(null);
          expect(r.detail?.reason, `${bat} ${ten}`).toBe("NOT_CONFIRMED");
          const [h] = await hangCong1(tx, r, key, "NOT_CONFIRMED");
          expect(h!.errorText, ten).toBe(`NOT_CONFIRMED: ${foeSelfApprovalRefusal(row!, cmd.hitl.requestedBy)}`);
        }
      }
      expect(d.soGoi).toBe(0);
      // đối chứng: CÙNG kiểu hàng tự xác nhận, STOP GHIM, đọc ghim lành ⇒ không bị từ chối (mô phỏng)
      process.env.OT_CONTROL_ENABLED = "false";
      const ok = await gui(await foeTuDuyet(ad, k("h5ok"), DESC_STOP, { writes: STOP_GHIM }));
      expect(ok).toMatchObject({ ok: true, status: "simulated" });
    });
  });

  it("★ H7 L-7: OT tắt, adapter do EDGE giữ: STOP ghim (hàng FOE tự xác nhận) ⇒ ĐI (yêu cầu STOP xếp cho node); lệnh thường cùng đường ⇒ chặn, không gì xếp; STOP không ghim tự duyệt ⇒ cổng (1) chặn; STOP gắn đúng mà nội dung không ghim ⇒ chỉ ghim đi (yêu cầu không mang giá trị)", async () => {
    process.env.OT_CONTROL_ENABLED = "false";
    await trongGiaoDich(async (tx) => {
      const ad = await taoAdapter(tx, driverGia());
      H.drivers.delete(ad); // trung tâm không giữ driver
      H.edgeOwned.add(ad);
      try {
        const runId = (await makeFoeGateRun({ tag: `${DAU}-h7-${randomUUID().slice(0, 6)}`, owner: OWNER, approvedBy: null })).runId;
        const args = { adapterId: ad, writes: STOP_GHIM };
        const key = abortStopKey(runId, "s-stop", "n-h7");
        const cmd = buildEquipmentCommand(DESC_STOP, CAP, MACHINE, args, key, USER);
        await centralRunStore.authorizeAbortStop(runId, USER, { id: "s-stop", type: "command" } as never, key, args, cmd);
        const r1 = await gui(cmd);
        expect(r1.detail?.reason).toBe("ADAPTER_OWNED_BY_EDGE");
        expect(H.enqueued).toEqual([expect.objectContaining({ kind: "stop", adapterId: ad })]);

        const W1: W = [{ tagKey: "t", value: 5 }];
        const r2 = await dispatch(lenh(ad, W1, k("h7b"), hitl(await taoHanhDong(tx, ad, W1))));
        expect(r2).toMatchObject({ ok: false, status: "rejected", reason: "ADAPTER_OWNED_BY_EDGE" });
        expect(r2.edgeStopRequest).toBeUndefined();
        expect(H.enqueued).toHaveLength(1);

        const r3 = await gui(await foeTuDuyet(ad, k("h7c"), DESC_STOP, { writes: [{ tagKey: "a", value: 1 }] }));
        expect(r3.detail?.reason).toBe("NOT_CONFIRMED");
        expect(H.enqueued).toHaveLength(1);

        const W4: W = [{ tagKey: "a", value: 1 }];
        const r4 = await dispatch(lenh(ad, W4, k("h7d"), hitl(await taoHanhDong(tx, ad, W4, { commandType: "stop" })), "stop"));
        expect(r4.reason).toBe("ADAPTER_OWNED_BY_EDGE");
        expect(H.enqueued).toHaveLength(2);
        expect(Object.keys(H.enqueued[1]!).sort()).toEqual(["adapterId", "kind", "reason", "requestedBy"]); // không giá trị nào của bên gọi
        expect(H.fallback).toEqual([]);
      } finally {
        H.edgeOwned.delete(ad);
      }
    });
  });

  it("★ H8 đường MÔ PHỎNG (OT tắt; OT bật mà chưa nghiệm thu): (C) ⇒ từ chối; (B) gắn đúng ⇒ qua; STOP ghim (tự duyệt FOE / không actionId) ⇒ KHÔNG bị từ chối", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const W1: W = [{ tagKey: "t", value: 2 }];
      const che: Array<[string, string, string]> = [
        ["OT tắt", "false", "false"],
        ["chưa nghiệm thu", "true", "true"],
      ];
      for (const [ten, bat, nghiemThu] of che) {
        process.env.OT_CONTROL_ENABLED = bat;
        process.env.OT_COMMISSIONING_REQUIRED = nghiemThu;
        const KC = k("h8c");
        const rc = await dispatch(lenh(ad, W1, KC, hitl()));
        expect(rc.reason, ten).toBe("PRECONDITION_FAILED");
        await hangCong1(tx, rc, KC, "PRECONDITION_FAILED");
        const rb = await dispatch(lenh(ad, W1, k("h8b"), hitl(await taoHanhDong(tx, ad, W1))));
        expect(rb, ten).toMatchObject({ ok: true, simulated: true, status: "simulated" });
        const rs = await gui(await foeTuDuyet(ad, k("h8s"), DESC_STOP, { writes: STOP_GHIM }));
        expect(rs, ten).toMatchObject({ ok: true, status: "simulated" });
        const rn = await dispatch(lenh(ad, STOP_GHIM, k("h8n"), hitl(), "stop"));
        expect(rn, ten).toMatchObject({ ok: true, simulated: true, status: "simulated" });
      }
      expect(d.soGoi).toBe(0);
    });
  });

  it("★ K14 (kiem-dinh) cổng (1) phân loại STOP ghim trên dạng ĐÃ ÉP KIỂU: STOP FOE tự xác nhận mang giá trị THÔ (\"0\" cho int ghim 0; \"true\" / \"1\" / 1 cho bool ghim true) trên kênh ĐÃ KHAI ⇒ đường thật BAY (+1 gói, thiết bị nhận giá trị GHIM), đường mô phỏng KHÔNG NOT_CONFIRMED", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapterKhai(tx, d);
      // vì sao ca này phân biệt: khớp ghim là CHẶT — dạng thô KHÔNG phải ghim, dạng ép kiểu thì là (k14 = cổng (1) dùng dạng thô ⇒ ĐỎ)
      expect(phanLoaiStopGhimRangBuoc("stop", [{ tagKey: "ik", value: "0" }], [{ tagKey: "ik", value: 0 }]).pinnedStop).toBe(false);
      expect(phanLoaiStopGhimRangBuoc("stop", [{ tagKey: "ik", value: 0 }], [{ tagKey: "ik", value: 0 }]).pinnedStop).toBe(true);
      expect(phanLoaiStopGhimRangBuoc("stop", [{ tagKey: "bk", value: "true" }], [{ tagKey: "bk", value: true }]).pinnedStop).toBe(false);
      const ca: Array<[string, W, W]> = [
        ['int ghim 0, ghi "0"', [{ tagKey: "ik", value: "0" }], [{ tagKey: "ik", value: 0 }]],
        ['bool ghim true, ghi "true"', [{ tagKey: "bk", value: "true" }], [{ tagKey: "bk", value: true }]],
        ['bool ghim true, ghi "1"', [{ tagKey: "bk", value: "1" }], [{ tagKey: "bk", value: true }]],
        // đối chứng: số 1 khớp ghim bool CẢ ở dạng thô (khopGhim 1 ≡ true) — không phân biệt k14, ghim rằng nó vẫn bay
        ["bool ghim true, ghi 1", [{ tagKey: "bk", value: 1 }], [{ tagKey: "bk", value: true }]],
      ];
      for (const [ten, writes, ghim] of ca) {
        process.env.OT_CONTROL_ENABLED = "false";
        const rs = await gui(await foeTuDuyet(ad, k("k14s"), DESC_STOP, { writes }));
        expect(rs.detail?.reason, `mô phỏng: ${ten}`).not.toBe("NOT_CONFIRMED");
        expect(rs, `mô phỏng: ${ten}`).toMatchObject({ ok: true, status: "simulated" });

        process.env.OT_CONTROL_ENABLED = "true";
        const truoc = d.soGoi;
        const rt = await gui(await foeTuDuyet(ad, k("k14t"), DESC_STOP, { writes }));
        expect(rt, `thật: ${ten}`).toMatchObject({ ok: true, status: "acked" });
        expect(d.soGoi - truoc, `thật: ${ten}`).toBe(1);
        expect(d.ghi.at(-1)!.map((w) => ({ tagKey: w.tagKey, value: w.value })), `thật: ${ten}`).toEqual(ghim); // thiết bị nhận giá trị GHIM
      }
    });
  });

  it("★ E1–E3 AMENDMENT 2 (mô phỏng): `executed` gắn ĐÚNG ⇒ qua cổng (1) (simulated như hôm nay); `executed` gắn lệnh KHÁC ⇒ ACTION_BINDING_MISMATCH; `executed` của NGƯỜI KHÁC (băm khớp) ⇒ NOT_CONFIRMED — hàng vẫn executed", async () => {
    process.env.OT_CONTROL_ENABLED = "false";
    await trongGiaoDich(async (tx) => {
      const ad = await taoAdapter(tx, driverGia());
      const W1: W = [{ tagKey: "t", value: 3 }];
      const dung = await dispatch(lenh(ad, W1, k("e1"), hitl(await taoHanhDong(tx, ad, W1, { trangThai: "executed" }))));
      expect(dung).toMatchObject({ ok: true, simulated: true, status: "simulated" });

      const K2 = k("e2");
      const lech = await taoHanhDong(tx, ad, [{ tagKey: "t", value: 4 }], { trangThai: "executed" });
      const r2 = await dispatch(lenh(ad, W1, K2, hitl(lech)));
      expect(r2.reason).toBe("ACTION_BINDING_MISMATCH");
      await hangCong1(tx, r2, K2, "ACTION_BINDING_MISMATCH");

      const K3 = k("e3");
      const khac = await taoHanhDong(tx, ad, W1, { trangThai: "executed", chu: OTHER });
      const r3 = await dispatch(lenh(ad, W1, K3, hitl(khac)));
      expect(r3.reason).toBe("NOT_CONFIRMED");
      const [h3] = await hangCong1(tx, r3, K3, "NOT_CONFIRMED");
      expect(h3!.errorText).toBe("NOT_CONFIRMED: HITL action owner mismatch");
      for (const id of [lech, khac]) expect(await trangThaiHang(tx, id)).toBe("executed");
    });
  });
});
