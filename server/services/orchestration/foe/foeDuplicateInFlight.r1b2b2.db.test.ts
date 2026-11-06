/**
 * SCADA R1b-2b-2a T3F (backlog 91, AN TOÀN) — sau khi SẬP + DỰNG LẠI, `DUPLICATE_IN_FLIGHT` (dispatcher trung tâm từ chối: khoá có hàng ý định mà không
 * có hàng kết quả) = KẾT CỤC KHÔNG RÕ: FOE KHÔNG gửi lại, KHÔNG attempt key mới cho bước không phải STOP; STOP vẫn gửi lại.
 *
 * Mọi thứ là mã sản phẩm THẬT trên DB `_test` (ép bởi vitest.setup): engine FOE (rehydrateInterruptedRuns → autoResumeInterruptedRuns → resumeRun →
 * execStep → execCommand → kho trung tâm: uỷ quyền ai_pending_actions), mặt tiền OT (equipmentRegistry), dispatcher (đặt chỗ write-ahead, khoá advisory,
 * hàng ý định / kết quả command_log), driver S7 THẬT (nodes7) trên `__s7commSim` — ĐẾM PDU ghi = số lần thiết bị bị ghi (oracle độc lập).
 * Bù trừ đi tới adapter thứ hai mà driver là một bộ đếm trong tiến trình (không socket) ⇒ PDU của sim chỉ là của bước chính.
 *
 * SẬP giữa "đã ghi thiết bị" và "ghi hàng kết quả": chỗ cắt CHỈ-TEST của dispatcher `__catSauGhiThietBiChoTest` (cổng VITEST ở cả bên đặt lẫn bên đọc):
 * lần gửi đầu (khoá `run<N>-main-a1`) ghi xuống thiết bị rồi treo VĨNH VIỄN — như tiến trình chết (lượt đi đó không bao giờ chạy tiếp, không ghi gì nữa).
 * "Khởi động lại" = hook khởi động của FOE (rehydrate: run `running` ⇒ `held` interrupted) + tiếp tục bền (FOE_DURABLE) — run được đi lại từ sổ.
 *
 * Mọi ghi DB nằm trong giao dịch ROLLBACK của chính test (getDb ⇒ giao dịch ấy; ngoài nó getDb là BẪY ⇒ không gì được commit). Bảng WORM
 * (command_log): không id tường minh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const H = vi.hoisted(() => ({
  tx: null as unknown,
  bay: 0,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
}));

vi.mock("../../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../db/connection")>();
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
vi.mock("../../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "T3F-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});
vi.mock("../../ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => H.fingerprints.get(adapterId),
  };
});

// R1b-2b-2a A2(n) (m-11) — an unknown outcome now raises the URGENT: RECORDED here (never an inbox insert for every active admin of `_test`, which
// would outlast the transaction and trip the getDb trap)
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async () => undefined };
});

import * as conn from "../../../db/connection";
import { aiPendingActions, commandLog, orchestrationRunSteps, orchestrationRuns } from "../../../../drizzle/schema";
import { startS7commSim, type S7commSim } from "../../ot/drivers/__s7commSim";
import { S7Driver } from "../../ot/drivers/s7Driver";
import { adapterTargetFingerprint } from "../../ot/adapterTarget";
import { __catSauGhiThietBiChoTest, bamLenhOt, perWriteKey, type DispatchInput } from "../../ot/commandDispatcher";
import { makeFoeGateRun } from "./__foeGateRunFixture";
import { autoResumeInterruptedRuns, FOE_OUTCOME_UNKNOWN, rehydrateInterruptedRuns } from "./foeEngine";
import type { WorkflowStep } from "./workflowModel";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T3F-${Date.now()}`;
const OWNER = 990_913_101;
const APPROVER = 990_913_102;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

let sim: S7commSim;
let s7: S7Driver;
const soPduGhi = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).length;
/** driver của adapter bù trừ: chỉ đếm (không socket) */
let ghiBuTru = 0;
const driverBuTru = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string }>) {
    ghiBuTru++;
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags() {
    return [];
  },
};

/** Chạy `fn` trong một giao dịch của test rồi ROLLBACK (không gì ở lại `_test`). */
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

const motId = async (tx: Tx, q: ReturnType<typeof sql>) => Number(((await tx.execute(q)) as unknown as Array<{ id: number | string }>)[0]!.id);

/** Nhà máy → … → máy M1 (adapter S7 trên sim, tag `a`) + máy M2 (adapter đếm, tag `c`) — TRONG giao dịch. */
async function dungThietBi(tx: Tx, opts: { aWritable?: boolean } = {}) {
  const t = Math.random().toString(36).slice(2, 8);
  const factory = await motId(tx, sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${DAU}-${t}`}, 'T3F factory', true) RETURNING id`);
  const workshop = await motId(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${factory}, ${`W-${DAU}-${t}`}, 'T3F ws') RETURNING id`);
  const line = await motId(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${workshop}, ${`L-${DAU}-${t}`}, 'T3F line') RETURNING id`);
  const station = await motId(tx, sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`S-${DAU}-${t}`}, 'T3F st') RETURNING id`);
  const m1 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M1-${DAU}-${t}`}, 'T3F m1', 'AUTOMATION', true) RETURNING id`);
  const m2 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M2-${DAU}-${t}`}, 'T3F m2', 'AUTOMATION', true) RETURNING id`);
  const endpoint = `127.0.0.1:${sim.port}`;
  const a1 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A1-${DAU}-${t}`}, 'T3F s7', 's7', ${endpoint}, true, ${m1}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a1}, 'a', 'DB1,INT0', 'int', ${opts.aWritable ?? true})`);
  const a2 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A2-${DAU}-${t}`}, 'T3F dem', 'stub', 'stub://t3f', true, ${m2}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a2}, 'c', 'D100', 'int', true)`);
  H.drivers.set(a1, s7);
  H.fingerprints.set(a1, adapterTargetFingerprint({ protocol: "s7", endpoint, machineId: m1, connectionOptions: null }));
  H.drivers.set(a2, driverBuTru);
  return { m1, m2, a1, a2 };
}

/** Run THẬT (chủ OWNER, cổng g0 do APPROVER duyệt) đang `running` — bước `main` theo sau. */
async function dungRun(main: WorkflowStep) {
  const fx = await makeFoeGateRun({ tag: `${DAU}-${Math.random().toString(36).slice(2, 8)}`, owner: OWNER, approvedBy: APPROVER, steps: [main] });
  return fx.runId;
}

/** "Tiến trình khởi động": hook khởi động FOE + tiếp tục bền CHỈ run của test (đúng hàm sản phẩm). */
async function khoiDong(runId: number) {
  await rehydrateInterruptedRuns();
  return autoResumeInterruptedRuns([runId]);
}

/** Lượt đi ĐẦU: tới chỗ cắt (đã ghi thiết bị, chưa ghi hàng kết quả) của khoá `<runId>-main-a1` rồi TREO mãi (sập). Trả khi đã tới chỗ cắt. */
async function sapGiuaGhiVaSo(runId: number) {
  const khoa = `run${runId}-main-a1`;
  let toi!: () => void;
  const daToi = new Promise<void>((r) => (toi = r));
  expect(
    __catSauGhiThietBiChoTest(async (input: DispatchInput) => {
      if (input.idempotencyKey !== khoa) return;
      toi();
      await new Promise<never>(() => undefined); // tiến trình "chết" ở đây: lượt đi này không bao giờ chạy tiếp
    }),
  ).toBe(true);
  void khoiDong(runId);
  await Promise.race([daToi, new Promise((_, rej) => setTimeout(() => rej(new Error("chỗ cắt không tới trong 60 s")), 60_000))]);
  __catSauGhiThietBiChoTest(null);
}

/** R1b-2b-2a T6d — tiền tố theo base của khoá (cách viết cũ `intent:<base>` / `<base>`) ⇒ khoá v2 không mơ hồ (`intent:v2:<len>:<base>:…` / `v2:<len>:<base>:…`). */
const ketQuaCuaKhoa = (tx: Tx, prefix: string) =>
  tx.select().from(commandLog).where(like(commandLog.idempotencyKey, prefix.startsWith("intent:") ? `intent:v2:%:${prefix.slice("intent:".length)}%` : `v2:%:${prefix}%`));
const buoc = async (tx: Tx, runId: number, stepId: string) =>
  (await tx.select().from(orchestrationRunSteps).where(and(eq(orchestrationRunSteps.runId, runId), eq(orchestrationRunSteps.stepId, stepId))).limit(1))[0];

const ENV_KEYS = ["FOE_ENABLED", "FOE_DURABLE", "OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("T3F — sập giữa ghi thiết bị và ghi sổ ⇒ dựng lại ⇒ DUPLICATE_IN_FLIGHT = không rõ kết cục (FOE + dispatcher + DB thật, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("../../ot/adapterFacade");
    await import("../../ot/safetyTarget");
    await import("../../safety/plc/safetyPlcAdapter");
    await import("../../robot/criticalStopAlert"); // the mock, once: concurrent first imports race its factory and one gets the REAL alert
    sim = await startS7commSim();
    sim.setFault(null);
    s7 = new S7Driver();
    await s7.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: 1500 });
  }, 60_000);

  afterAll(async () => {
    __catSauGhiThietBiChoTest(null);
    H.drivers.clear();
    await s7?.disconnect().catch(() => undefined);
    await sim?.close().catch(() => undefined);
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
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    delete process.env.OT_READBACK_ENABLED;
    delete process.env.OT_CMD_SERIALIZE_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.UNS_CMD_ACK_ENABLED;
    delete process.env.AI_OT_CONTROL_ENABLED;
    delete process.env.PARAM_GUARDRAIL_ENABLED;
    delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
    H.bay = 0;
    ghiBuTru = 0;
  });

  it("★ (1) bước KHÔNG phải STOP (maxAttempts 2 = 3 lần): sập sau khi thiết bị đã ghi ⇒ dựng lại ⇒ 0 PDU gửi lại, KHÔNG attempt key a2, failed FOE_OUTCOME_UNKNOWN (DUPLICATE_IN_FLIGHT), bù trừ KHÔNG-STOP bị GIỮ (A2(n): 0 lần ghi, run held)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const runId = await dungRun({
        id: "main",
        type: "command",
        machineId: m1,
        command: "start",
        args: { tagKey: "a", value: 5 },
        maxAttempts: 2,
        compensation: { id: "undo", type: "command", machineId: m2, command: "reset", args: { tagKey: "c", value: 1 } },
      });

      const pdu0 = soPduGhi();
      await sapGiuaGhiVaSo(runId);
      expect(soPduGhi() - pdu0).toBe(1); // thiết bị ĐÃ bị ghi
      const sauSap = await ketQuaCuaKhoa(tx, `intent:run${runId}-main-`);
      expect(sauSap.map((r) => r.idempotencyKey)).toEqual([`intent:${perWriteKey(`run${runId}-main-a1`, "a", 0)}`]); // ý định a1 … (T6d — khoá v2)
      expect(await ketQuaCuaKhoa(tx, `run${runId}-main-`)).toHaveLength(0); // … mà KHÔNG có hàng kết quả

      // khởi động lại: rehydrate + tiếp tục bền ⇒ đi lại từ sổ
      const pdu1 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu1).toBe(0); // ★ 0 gói gửi lại
      const [run] = await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId));
      expect(run!.status).toBe("held"); // R1b-2b-2a A2(n) — the non-STOP compensation waits for a person (was: failed after an automatic write)
      const main = await buoc(tx, runId, "main");
      expect(main?.status).toBe("failed");
      expect(String(main?.error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: DUPLICATE_IN_FLIGHT: command "start" — .*outcome unknown — not sent again; check the device\\.$`));
      // ★ không attempt key mới: không uỷ quyền, không hàng sổ nào cho a2 / a3
      expect(await tx.select().from(aiPendingActions).where(like(aiPendingActions.id, `foe-run${runId}-main-a%`)).then((x) => x.map((a) => a.id).sort())).toEqual([`foe-run${runId}-main-a1`]);
      expect(await ketQuaCuaKhoa(tx, `run${runId}-main-a2`)).toHaveLength(0);
      expect(await ketQuaCuaKhoa(tx, `intent:run${runId}-main-a2`)).toHaveLength(0);
      // dispatcher ghi lời từ chối DUPLICATE_IN_FLIGHT (khoá NULL) cho lượt đi lại
      const tuChoi = await tx.select().from(commandLog).where(and(eq(commandLog.status, "rejected"), like(commandLog.errorText, `DUPLICATE_IN_FLIGHT: idempotency key already has a write-ahead intent (#${sauSap[0]!.id})%`)));
      expect(tuChoi).toHaveLength(1);

      // R1b-2b-2a A2(n) — the compensation (a reset on ANOTHER machine — not a pinned STOP) is NOT written to a device whose state is unknown:
      // held, resume state compensationHeld (a person's Continue sends it — foeKetCucKhongRo.a2n.db.test.ts N6)
      expect(ghiBuTru).toBe(0);
      expect((await buoc(tx, runId, "undo"))?.status).toBe("held");
      expect(await ketQuaCuaKhoa(tx, `run${runId}-undo-`)).toEqual([]);
      expect((run!.contextJson as Record<string, any>).foeResumeState).toMatchObject({ main: { state: "compensationHeld", khongRo: true } });
    });
    expect(H.bay).toBe(0);
  });

  it("(2) đối chứng STOP: cùng kịch bản với bước STOP ⇒ VẪN gửi lại (attempt a2, một PDU mới), bước hoàn tất", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1 } = await dungThietBi(tx);
      const runId = await dungRun({ id: "main", type: "command", machineId: m1, command: "stop", args: { tagKey: "a", value: 0 }, maxAttempts: 2 });

      const pdu0 = soPduGhi();
      await sapGiuaGhiVaSo(runId);
      expect(soPduGhi() - pdu0).toBe(1);
      expect(await ketQuaCuaKhoa(tx, `run${runId}-main-`)).toHaveLength(0);

      const pdu1 = soPduGhi();
      await khoiDong(runId);
      const [run] = await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId));
      expect(run!.status).toBe("completed");
      expect(soPduGhi() - pdu1).toBe(1); // STOP gửi lại (dừng là idempotent)
      const main = await buoc(tx, runId, "main");
      expect(main?.status).toBe("completed");
      expect(main?.attempt).toBe(2);
      expect((await ketQuaCuaKhoa(tx, `run${runId}-main-a2`)).map((x) => x.status)).toEqual(["acked"]);
    });
    expect(H.bay).toBe(0);
  });

  it("(3) đối chứng: từ chối CHẮC CHƯA GỬI (TAG_NOT_WRITABLE) ⇒ hành vi cũ: thử lại tới maxAttempts (a1, a2, a3), 0 PDU, không FOE_OUTCOME_UNKNOWN", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1 } = await dungThietBi(tx, { aWritable: false });
      const runId = await dungRun({ id: "main", type: "command", machineId: m1, command: "start", args: { tagKey: "a", value: 5 }, maxAttempts: 2 });
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      const [run] = await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId));
      expect(run!.status).toBe("failed");
      expect(soPduGhi() - pdu0).toBe(0);
      const main = await buoc(tx, runId, "main");
      expect(main?.attempt).toBe(3);
      expect(String(main?.error)).not.toContain(FOE_OUTCOME_UNKNOWN);
      const tuChoi = await tx.select().from(commandLog).where(and(like(commandLog.idempotencyKey, `v2:%:run${runId}-main-a%`), eq(commandLog.status, "rejected"))); // T6d — khoá v2
      expect(tuChoi.map((x) => x.idempotencyKey).sort()).toEqual([1, 2, 3].map((n) => perWriteKey(`run${runId}-main-a${n}`, "a", 0)).sort());
      expect(tuChoi.every((x) => String(x.errorText).startsWith("TAG_NOT_WRITABLE"))).toBe(true);
    });
    expect(H.bay).toBe(0);
  });
  // ── SCADA R1b-2b-2a T6d fix 1 (review I1 + bộ điều khiển) ─────────────────────────────────────────────────────────────────────────────────────────
  // FOE tiếp tục bền chạy dưới SYSTEM_FOE_USER; hàng sổ của lần đi TRƯỚC cùng khoá `run<N>-main-a1` có thể mang người yêu cầu KHÁC (lần đi đầu do người dùng
  // chạy / một đường không cổng ghi user.id). Khoá FOE là khoá MÁY CHỦ sinh ⇒ chốt phát lại CHỈ adapter + tag + băm + commandType: không bao giờ
  // IDEMPOTENCY_KEY_REUSED vì người khác, không attempt key mới, không ghi thiết bị lần hai. Và nếu khoá thật sự mang lệnh KHÁC (băm lệch ⇒
  // IDEMPOTENCY_KEY_REUSED) ⇒ lớp "có thể đã áp": FOE KHÔNG gửi lại với khoá mới.
  const NGUOI_LAN_TRUOC = 990_913_103;
  const bamStart = bamLenhOt({ commandType: "start", writes: [{ tagKey: "a", value: 5 }] });
  async function hangLanTruoc(tx: Tx, o: { a1: number; m1: number; key: string; status: "sent" | "acked"; ackValue: unknown }) {
    await tx.insert(commandLog).values({
      actionId: null,
      adapterId: o.a1,
      machineId: o.m1,
      tagKey: "a",
      address: "DB1,INT0",
      commandType: "start",
      requestedValue: 5 as never,
      requestedBy: NGUOI_LAN_TRUOC,
      confirmedBy: APPROVER,
      status: o.status,
      ackValue: o.ackValue as never,
      idempotencyKey: o.key,
      sentAt: new Date(),
    });
  }
  const buocMain = (m1: number) => ({ id: "main", type: "command" as const, machineId: m1, command: "start", args: { tagKey: "a", value: 5 }, maxAttempts: 2 });

  it("★ (4) T6d fix 1 — tiếp tục dưới SYSTEM_FOE_USER, ý định a1 của lần trước (CÙNG lệnh, người yêu cầu KHÁC) ⇒ DUPLICATE_IN_FLIGHT (không IDEMPOTENCY_KEY_REUSED), 0 PDU, KHÔNG attempt key a2", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, a1 } = await dungThietBi(tx);
      const runId = await dungRun(buocMain(m1));
      await hangLanTruoc(tx, { a1, m1, key: `intent:${perWriteKey(`run${runId}-main-a1`, "a", 0)}`, status: "sent", ackValue: { ledger: "intent", bam: bamStart } });
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(0); // ★ thiết bị KHÔNG bị ghi lần hai
      const main = await buoc(tx, runId, "main");
      expect(main?.status).toBe("failed");
      expect(String(main?.error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: DUPLICATE_IN_FLIGHT: `));
      expect(String(main?.error)).not.toContain("IDEMPOTENCY_KEY_REUSED");
      expect(await tx.select().from(aiPendingActions).where(like(aiPendingActions.id, `foe-run${runId}-main-a%`)).then((x) => x.map((a) => a.id))).toEqual([`foe-run${runId}-main-a1`]);
      expect(await ketQuaCuaKhoa(tx, `run${runId}-main-a2`)).toHaveLength(0);
      expect(await ketQuaCuaKhoa(tx, `intent:run${runId}-main-a2`)).toHaveLength(0);
    });
    expect(H.bay).toBe(0);
  });

  it("★ (5) T6d fix 1 — tiếp tục dưới SYSTEM_FOE_USER, lần trước ĐÃ áp (ý định + kết quả acked, CÙNG lệnh, người yêu cầu KHÁC) ⇒ PHÁT LẠI: bước hoàn tất, 0 PDU, không a2", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, a1 } = await dungThietBi(tx);
      const runId = await dungRun(buocMain(m1));
      await hangLanTruoc(tx, { a1, m1, key: `intent:${perWriteKey(`run${runId}-main-a1`, "a", 0)}`, status: "sent", ackValue: { ledger: "intent", bam: bamStart } });
      await hangLanTruoc(tx, { a1, m1, key: perWriteKey(`run${runId}-main-a1`, "a", 0), status: "acked", ackValue: { ledger: "result", bam: bamStart } });
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(0); // ★ phát lại, không ghi thiết bị
      const [run] = await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId));
      expect(run!.status).toBe("completed");
      const main = await buoc(tx, runId, "main");
      expect(main?.status).toBe("completed");
      expect(main?.attempt).toBe(1);
      expect(await ketQuaCuaKhoa(tx, `run${runId}-main-a2`)).toHaveLength(0);
    });
    expect(H.bay).toBe(0);
  });

  it("★ (6) T6d fix 1 (bộ điều khiển) — khoá a1 mang lệnh KHÁC (băm lệch) ⇒ IDEMPOTENCY_KEY_REUSED = lớp \"có thể đã áp\": FOE KHÔNG gửi lại với attempt key a2, 0 PDU; câu lỗi nói THẬT (không rõ đã áp chưa — kiểm thiết bị)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, a1 } = await dungThietBi(tx);
      const runId = await dungRun(buocMain(m1));
      await hangLanTruoc(tx, { a1, m1, key: perWriteKey(`run${runId}-main-a1`, "a", 0), status: "acked", ackValue: { ledger: "result", bam: "lenh-khac" } });
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      const main = await buoc(tx, runId, "main");
      expect(main?.status).toBe("failed");
      expect(main?.attempt).toBe(1);
      expect(String(main?.error)).toMatch(
        new RegExp(`^${FOE_OUTCOME_UNKNOWN}: IDEMPOTENCY_KEY_REUSED: command "start" — .*unknown whether that earlier command was applied to the device; check the device before continuing; outcome unknown — not sent again; check the device\\.$`),
      );
      expect(await tx.select().from(aiPendingActions).where(like(aiPendingActions.id, `foe-run${runId}-main-a%`)).then((x) => x.map((a) => a.id))).toEqual([`foe-run${runId}-main-a1`]);
      expect(await ketQuaCuaKhoa(tx, `run${runId}-main-a2`)).toHaveLength(0);
      expect(await ketQuaCuaKhoa(tx, `intent:run${runId}-main-a2`)).toHaveLength(0);
    });
    expect(H.bay).toBe(0);
  });
});
