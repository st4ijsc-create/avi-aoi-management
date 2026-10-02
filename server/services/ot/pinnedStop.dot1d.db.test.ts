/**
 * doc 81 Đợt 1D Task 2 — lệnh DỪNG OT ghim theo máy đi qua preflight an toàn CHỈ khi nó ghi ĐÚNG các cặp
 * (tagKey, giá trị) đã ghim (Task 1, `device_tags.stop_value`), và thứ tới dây là GIÁ TRỊ GHIM (chuẩn hoá),
 * không bao giờ là giá trị của người gọi.
 *
 * CSDL THẬT (`_test`): adapter/tag/ghim/commissioning/HITL action/sổ lệnh là hàng thật. Cấu hình safety-PLC
 * (SIM / real có gán tag / real không kết nối được — khuôn `safetySimOnly.dot1c.db.test.ts`) được TRAO cho facade
 * THẬT qua `listPlcConfigs` giả (một danh sách do TEST giữ) thay vì chèn vào bảng dùng chung `safety_plc_configs`:
 * chạy song song với safetySimOnly (hàng "real" của nó có e-stop bật / đọc sạch) thì hai tệp đọc hàng của nhau
 * (ĐO: 3 ca đỏ chéo khi chạy gộp). Phân loại (effectiveBackend), đọc (backendForConfig → OtReadSafetyPlcBackend →
 * ModbusDriver) vẫn là mã THẬT; safety-PLC "real" là `ServerTCP` Modbus GIẢ trong tiến trình (127.0.0.1 cổng 0,
 * đóng ở afterAll), kho coil do TEST giữ. Thiết bị đích: driver OT giả GHI LẠI từng lô `writeTags` (oracle: thiết bị nhận gì, bao nhiêu lần).
 * Ghim đặt bằng UPDATE thô (oracle độc lập với `datStopPin`).
 *
 * Seam có điều khiển: `loadStopPins` (ném theo cờ — ca (g)), policy (SEC_PLATFORM + verdict), cổng interlock
 * (chặn theo cờ). Tắt cờ ⇒ bản THẬT. Treo đo bằng `within(...)` tường minh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import net from "node:net";
import { and, eq, like } from "drizzle-orm";
import postgres from "postgres";
import * as ModbusSerialNs from "modbus-serial";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fake = vi.hoisted(() => ({
  otDrivers: new Map<number, unknown>(),
  /** final wave 1 (R-1D-k) — dấu vân tay kết nối mà otManager "ghi lúc nối" cho từng adapter (test giữ). */
  otFingerprints: new Map<number, string>(),
  pinLoadThrows: false,
  pinLoadCalls: 0,
  policyOn: false,
  policyVerdict: {} as Record<string, "deny" | "require_approval">,
  interlockBlocked: false,
  interlockFailClosed: false,
  pinOverride: null as null | Array<{ tagKey: string; value: unknown }>,
  plcRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    listPlcConfigs: async (filter?: { onlyEnabled?: boolean }) =>
      fake.plcRows.filter((r) => !filter?.onlyEnabled || r.enabled === true) as unknown as Awaited<ReturnType<typeof orig.listPlcConfigs>>,
  };
});

vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => fake.otDrivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => fake.otFingerprints.get(adapterId),
  };
});
vi.mock("./stopPin", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./stopPin")>();
  return {
    ...orig,
    loadStopPins: async (...a: Parameters<typeof orig.loadStopPins>) => {
      fake.pinLoadCalls++;
      if (fake.pinLoadThrows) throw new Error("D1T2-forced pin load failure (connection terminated)");
      // fix round 1 — pins read AFTER step 3 but changed in between (re-pinned under a new dataType).
      if (fake.pinOverride) return fake.pinOverride;
      return orig.loadStopPins(...a);
    },
  };
});
vi.mock("../security/policyGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../security/policyGate")>();
  return {
    ...orig,
    secPlatformEnabled: (...a: Parameters<typeof orig.secPlatformEnabled>) => (fake.policyOn ? true : orig.secPlatformEnabled(...a)),
    evaluateCommandPolicy: (ctx: Parameters<typeof orig.evaluateCommandPolicy>[0], opts?: Parameters<typeof orig.evaluateCommandPolicy>[1]) => {
      if (!fake.policyOn) return orig.evaluateCommandPolicy(ctx, opts);
      const v = fake.policyVerdict[String(ctx.action)];
      if (v === "deny") return { allow: false, effect: "deny" as const, reason: "D1T2 policy cam", policyId: "p-d1t2-deny" };
      if (v === "require_approval") return { allow: false, effect: "require_approval" as const, reason: "D1T2 can duyet", policyId: "p-d1t2-approve" };
      return { allow: true, effect: "allow" as const, reason: "ok", policyId: null };
    },
  };
});
vi.mock("../interlock/interlockGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../interlock/interlockGate")>();
  return {
    ...orig,
    evaluateInterlockGate: async (...a: Parameters<typeof orig.evaluateInterlockGate>) =>
      fake.interlockFailClosed
        ? { blocked: true, failClosed: true, violations: [] }
        : fake.interlockBlocked
          ? { blocked: true, failClosed: false, violations: [{ ruleId: 424242, ruleName: "D1T2 rule", action: "stop_line" }] }
          : orig.evaluateInterlockGate(...a),
  };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, commandLog, controlAuditLog, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import {
  canonicalisePinnedStop,
  classifyOtStop,
  dispatch,
  type DispatchInput,
  _adapterCommandQueueDepthForTests,
  _resetAdapterCommandQueuesForTests,
} from "./commandDispatcher";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { createModbusDriver } from "./drivers/modbusDriver";
import { registerDriver } from "./driverRegistry";
import { adapterTargetFingerprint } from "./adapterTarget";

const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;

const DB_URL = process.env.DATABASE_URL;
const DAU = `D1DT2-${Date.now()}`;
const OWNER = 990_820_101;
const STRANGER = 990_820_102;
const MACHINE = 990_820_001;
const MACHINE_NOPIN = 990_820_002;
const MACHINE_REPOINT = 990_820_003;
const TOOL = "machine_stop";

// ── Thiết bị đích giả: GHI LẠI từng lô writeTags ──────────────────────────────
let received: Array<Array<{ tagKey: string; value: unknown }>> = [];
const fakeOtDriver = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string; value: unknown }>) {
    received.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags() {
    return [];
  },
};

// ── Safety-PLC giả (Modbus TCP; kho coil do TEST giữ) ───────────────────────────
const plc = { coils: new Map<number, boolean>(), port: 0, close: async () => undefined as unknown };
let closedPort = 0;
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}
async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${what}: không trả về trong ${ms} ms (treo)`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(t);
  }
}

type PlcRow = { backend: "sim" | "modbus"; endpoint?: string | null; statusMap?: unknown };
const SIM: PlcRow = { backend: "sim", endpoint: null, statusMap: null };
const realMapped = (): PlcRow => ({
  backend: "modbus",
  endpoint: `tcp://127.0.0.1:${plc.port}`,
  statusMap: { estop: { address: "coil:1", dataType: "bool" } },
});
const realDown = (): PlcRow => ({ backend: "modbus", endpoint: `tcp://127.0.0.1:${closedPort}`, statusMap: { estop: { address: "coil:1" } } });

let sql: ReturnType<typeof postgres>;
let seq = 0;
const nextKey = (label: string) => `${DAU}-${label}-${++seq}`;
let adapterPinned = 0;
let adapterNoPin = 0;
let adapterRepoint = 0;

/** "Nối" adapter như otManager làm lúc khởi động: ghi dấu vân tay của cấu hình hàng ĐANG có ở thời điểm nối. */
async function connectFake(adapterId: number, driver: unknown): Promise<void> {
  const [row] = await (await d()).select().from(deviceAdapters).where(eq(deviceAdapters.id, adapterId));
  fake.otDrivers.set(adapterId, driver);
  fake.otFingerprints.set(adapterId, adapterTargetFingerprint(row!));
}

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

/** Cấu hình safety-PLC mà facade THẬT thấy trong đúng một ca (cùng hình hàng `safety_plc_configs`). */
async function withPlcConfigs<T>(rows: PlcRow[], fn: () => Promise<T>): Promise<T> {
  fake.plcRows = rows.map((r, i) => ({
    id: 9_000_000 + ++seq + i,
    code: `${DAU}-${seq}`.slice(0, 64),
    name: "Đợt 1D T2",
    vendor: "generic",
    backend: r.backend,
    endpoint: r.endpoint ?? null,
    statusMap: r.statusMap ?? null,
    robotId: null,
    stationId: null,
    lineId: null,
    enabled: true,
    notes: null,
    scope: r.backend === "sim" ? "sim" : null,
    corporateCode: null,
    factoryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  try {
    return await fn();
  } finally {
    fake.plcRows = [];
  }
}

type W = { tagKey: string; value: unknown };

/** Một HITL action ĐÃ xác nhận, gắn đúng lệnh NGƯỜI GỌI gửi (tool + hash payload), chủ = OWNER. */
async function makeAction(adapterId: number, machineId: number, commandType: string, writes: W[]): Promise<string> {
  const id = `${DAU}-a-${++seq}`;
  await (await d()).insert(aiPendingActions).values({
    id,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} stop`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId, machineId, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return id;
}

async function stopInput(
  writes: W[],
  over: { commandType?: string; adapterId?: number; machineId?: number; confirmedBy?: number; noAction?: boolean } = {},
): Promise<DispatchInput> {
  const adapterId = over.adapterId ?? adapterPinned;
  const machineId = over.machineId ?? MACHINE;
  const commandType = over.commandType ?? "stop";
  const actionId = over.noAction ? undefined : await makeAction(adapterId, machineId, commandType, writes);
  return {
    adapterId,
    machineId,
    commandType,
    writes,
    triggeredBy: { kind: "hitl", actionId, tool: TOOL, confirmedBy: over.confirmedBy ?? OWNER, requestedBy: over.confirmedBy ?? OWNER },
    idempotencyKey: nextKey(commandType),
  };
}

const run = async (inp: DispatchInput) => within(dispatch(inp), 15_000, "OT dispatch");
async function ledger(key: string) {
  return (await d()).select().from(commandLog).where(like(commandLog.idempotencyKey, `%${key}%`));
}

const ENV_KEYS = [
  "SAFETY_PLC_ADAPTER_ENABLED",
  "OT_CONTROL_ENABLED",
  "OT_COMMISSIONING_REQUIRED",
  "OT_SAFETY_PREFLIGHT_ENABLED",
  "OT_READBACK_ENABLED",
  "OT_CMD_SERIALIZE_ENABLED",
  "OT_CMD_QUEUE_MAX",
  "OT_CONTROL_TIMEOUT_MS",
  "SEC_PLATFORM",
  "UNS_CMD_ACK_ENABLED",
  "INTERLOCK_AUTO_BLOCK_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("Đợt 1D Task 2 — DỪNG OT ghim qua preflight an toàn (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [cot] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'device_tags' AND column_name IN ('stop_value','stop_pinned_by','stop_pinned_at')`;
    expect(cot.n, "mig 0362 chưa áp lên _test").toBe(3);

    registerDriver("modbus", createModbusDriver);
    // Nạp NÓNG facade: dispatcher nạp nó bằng import động BÊN TRONG hạn preflight 5 s — chạy gộp ~150 tệp thì lượt
    // nạp nguội đầu tiên vượt hạn ⇒ UNKNOWN thay vì SIM_ONLY (ĐO: ca (b) 5277 ms; dot1b/safetySimOnly cùng hình).
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    plc.port = await freePort();
    closedPort = await freePort();
    const vector = {
      getCoil: (addr: number) => plc.coils.get(addr) ?? false,
      getDiscreteInput: () => false,
      getHoldingRegister: () => 0,
      getInputRegister: () => 0,
      setRegister: () => undefined,
      setCoil: () => undefined,
    };
    const srv = new ServerTCP(vector, { host: "127.0.0.1", port: plc.port, unitID: 1 });
    await new Promise<void>((resolve, reject) => {
      srv.once("initialized", () => resolve());
      srv.once("serverError", reject);
    });
    plc.close = () => new Promise<void>((resolve) => srv.close(() => resolve()));

    const x = await d();
    const mk = async (suffix: string, machineId: number) => {
      const [a] = await x
        .insert(deviceAdapters)
        .values({ code: `${DAU}-${suffix}`, name: `${DAU} ${suffix}`, protocol: "stub", endpoint: `stub://${suffix}`, isEnabled: true, machineId })
        .returning();
      await x.insert(deviceTags).values([
        { adapterId: a!.id, tagKey: "cmd_stop", address: "M20", dataType: "bool", writable: true },
        { adapterId: a!.id, tagKey: "speed_sp", address: "D100", dataType: "int", writable: true },
        { adapterId: a!.id, tagKey: "cmd_run", address: "M10", dataType: "bool", writable: true },
      ]);
      await connectFake(a!.id, fakeOtDriver);
      await sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${a!.id}, 'active', ${OWNER}, ${DAU})`;
      return a!.id;
    };
    adapterPinned = await mk("P", MACHINE);
    adapterNoPin = await mk("N", MACHINE_NOPIN);
    adapterRepoint = await mk("R", MACHINE_REPOINT);
    // Ghim bằng UPDATE thô: cmd_stop ⇒ true (bool), speed_sp ⇒ 0 (int). cmd_run KHÔNG ghim.
    await sql`UPDATE device_tags SET stop_value = ${sql.json(true)}, stop_pinned_by = ${String(OWNER)}, stop_pinned_at = now()
               WHERE "adapterId" = ${adapterPinned} AND "tagKey" = 'cmd_stop'`;
    await sql`UPDATE device_tags SET stop_value = ${sql.json(0)}, stop_pinned_by = ${String(OWNER)}, stop_pinned_at = now()
               WHERE "adapterId" = ${adapterPinned} AND "tagKey" = 'speed_sp'`;
  });

  afterAll(async () => {
    fake.otDrivers.clear();
    fake.otFingerprints.clear();
    try {
      await plc.close();
    } catch {
      /* ignore */
    }
    if (sql) {
      await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${DAU + "%"}`;
      for (const id of [adapterPinned, adapterNoPin, adapterRepoint].filter(Boolean)) {
        await sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`;
        await sql`DELETE FROM device_adapters WHERE id = ${id}`;
        await sql`DELETE FROM commissioning_records WHERE "adapterId" = ${id}`.catch(() => undefined);
      }
      await sql.end();
    }
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    received = [];
    plc.coils.clear();
    fake.pinLoadThrows = false;
    fake.pinLoadCalls = 0;
    fake.policyOn = false;
    fake.policyVerdict = {};
    fake.interlockBlocked = false;
    fake.interlockFailClosed = false;
    fake.pinOverride = null;
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    delete process.env.OT_COMMISSIONING_REQUIRED; // mặc định BẬT
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED; // mặc định BẬT
    for (const k of ["OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "OT_CMD_QUEUE_MAX", "OT_CONTROL_TIMEOUT_MS", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED"]) {
      delete process.env[k];
    }
  });

  // ═════════ (a) ghim khớp ⇒ tới thiết bị, thiết bị nhận GIÁ TRỊ GHIM, sổ ghi pinnedStop ═════════
  it("(a) chỉ SIM + stop ghi đúng ghim (người gọi gửi 1, ghim là true) ⇒ acked; thiết bị nhận ĐÚNG boolean true; sổ pinnedStop:true", async () => {
    await withPlcConfigs([SIM], async () => {
      const inp = await stopInput([{ tagKey: "cmd_stop", value: 1 }]);
      const res = await run(inp);
      expect(res.status).toBe("acked");
      expect(res.pinnedStop).toBe(true);
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual([{ tagKey: "cmd_stop", value: true }]);
      expect(typeof received[0][0].value).toBe("boolean"); // không phải số 1 của người gọi
      const rows = await ledger(inp.idempotencyKey);
      const intent = rows.filter((r) => (r.ackValue as any)?.ledger === "intent");
      const result = rows.filter((r) => (r.ackValue as any)?.ledger === "result");
      expect(intent).toHaveLength(1);
      expect(result).toHaveLength(1);
      for (const r of [...intent, ...result]) {
        expect((r.ackValue as any).pinnedStop).toBe(true);
        expect(r.requestedValue).toBe(true);
      }
      expect(result[0].status).toBe("acked");
    });
  });

  it("(a2) stop ghi CẢ HAI ghim (tập con = toàn bộ) ⇒ acked, thiết bị nhận đúng hai giá trị ghim theo thứ tự người gọi", async () => {
    await withPlcConfigs([SIM], async () => {
      const inp = await stopInput([{ tagKey: "speed_sp", value: 0 }, { tagKey: "cmd_stop", value: true }]);
      const res = await run(inp);
      expect(res.status).toBe("acked");
      expect(received).toEqual([[{ tagKey: "speed_sp", value: 0 }, { tagKey: "cmd_stop", value: true }]]);
    });
  });

  // ═════════ (b)(c) buôn lậu một lệnh ghi khác trong "stop" ⇒ KHÔNG miễn ═════════
  it("(b) stop = ghim + MỘT tag không ghim ⇒ SAFETY_SIM_ONLY, stopPinReason unpinned_tag, 0 lần ghi", async () => {
    await withPlcConfigs([SIM], async () => {
      const inp = await stopInput([{ tagKey: "cmd_stop", value: true }, { tagKey: "cmd_run", value: true }]);
      const res = await run(inp);
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("SAFETY_SIM_ONLY");
      expect(res.pinnedStop).toBe(false);
      expect(res.appError?.appParams).toMatchObject({ reason: "softwareStopRefusedUseHardwareEstop", stopPinReason: "unpinned_tag" });
      expect(received).toHaveLength(0);
      const rows = await ledger(inp.idempotencyKey);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.status === "rejected" && /stop pin: unpinned_tag/.test(String(r.errorText)))).toBe(true);
      expect(rows.every((r) => (r.ackValue as any)?.pinnedStop === false && (r.ackValue as any)?.stopPinReason === "unpinned_tag")).toBe(true);
    });
  });

  it("(c) stop ghi tag ghim với GIÁ TRỊ KHÁC ⇒ SAFETY_SIM_ONLY, stopPinReason value_mismatch, 0 lần ghi", async () => {
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: false }]));
      expect(res.reason).toBe("SAFETY_SIM_ONLY");
      expect(res.appError?.appParams.stopPinReason).toBe("value_mismatch");
      expect(received).toHaveLength(0);
    });
  });

  it("(c2) chuỗi \"0\" cho tag int ghim 0 ⇒ value_mismatch (không ép kiểu), 0 lần ghi", async () => {
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "speed_sp", value: "0" }]));
      expect(res.reason).toBe("SAFETY_SIM_ONLY");
      expect(res.appError?.appParams.stopPinReason).toBe("value_mismatch");
      expect(received).toHaveLength(0);
    });
  });

  // ═════════ (d) không miễn theo TÊN — và cũng không miễn theo DỮ LIỆU nếu không phải stop ═════════
  it("(d) commandType start với ĐÚNG tag + giá trị ghim ⇒ SAFETY_SIM_ONLY (không phải lệnh dừng), 0 lần ghi, không gắn lý do dừng", async () => {
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }], { commandType: "start" }));
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("SAFETY_SIM_ONLY");
      expect(res.appError).toBeUndefined();
      expect(res.pinnedStop).toBeUndefined();
      expect(received).toHaveLength(0);
      expect(fake.pinLoadCalls).toBe(0); // ghim chỉ được đọc cho lệnh kiểu dừng
    });
  });

  // ═════════ (e) BLOCKED / UNKNOWN + stop ghim ⇒ vẫn tới thiết bị (giảm năng lượng) ═════════
  it("(e) safety-PLC thật báo e-stop ACTIVE (BLOCKED) + stop ghim ⇒ acked, 1 lần ghi giá trị ghim", async () => {
    plc.coils.set(0, true);
    await withPlcConfigs([realMapped()], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }], { commandType: "e_stop" }));
      expect(res.status).toBe("acked");
      expect(res.pinnedStop).toBe(true);
      expect(received).toEqual([[{ tagKey: "cmd_stop", value: true }]]);
    });
  });

  it("(e) safety-PLC thật KHÔNG đọc được (UNKNOWN) + stop ghim ⇒ acked, 1 lần ghi", async () => {
    await withPlcConfigs([realDown()], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }]));
      expect(res.status).toBe("acked");
      expect(received).toEqual([[{ tagKey: "cmd_stop", value: true }]]);
    });
  });

  it("(e-đối chứng) BLOCKED + stop KHÔNG khớp ghim ⇒ vẫn SAFETY_BLOCKED, 0 lần ghi", async () => {
    plc.coils.set(0, true);
    await withPlcConfigs([realMapped()], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: false }]));
      expect(res.reason).toBe("SAFETY_BLOCKED");
      expect(res.appError?.appParams.stopPinReason).toBe("value_mismatch");
      expect(received).toHaveLength(0);
    });
  });

  // ═════════ (f) không ghim ⇒ không miễn ═════════
  it("(f) adapter KHÔNG có ghim + stop ⇒ SAFETY_SIM_ONLY, stopPinReason no_pins, 0 lần ghi", async () => {
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }], { adapterId: adapterNoPin, machineId: MACHINE_NOPIN }));
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("SAFETY_SIM_ONLY");
      expect(res.appError?.appParams.stopPinReason).toBe("no_pins");
      expect(res.message).toMatch(/no stop tag is pinned for this machine/);
      expect(received).toHaveLength(0);
    });
  });

  // ═════════ (g) final wave 3 (M1) — ghim lấy từ HÀNG TAG BƯỚC 3 (một bản chụp với lệnh ghi) ═════════
  it("★ (g) M1: stop khớp ghim ⇒ quyết định từ hàng tag bước 3, KHÔNG đọc ghim riêng (đọc riêng có NÉM cũng không ảnh hưởng) ⇒ acked", async () => {
    fake.pinLoadThrows = true;
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }]));
      expect(fake.pinLoadCalls).toBe(0);
      expect(res.status).toBe("acked");
      expect(res.pinnedStop).toBe(true);
      expect(received).toEqual([[{ tagKey: "cmd_stop", value: true }]]);
    });
  });

  it("(g2) stop CHỈ ghi tag KHÔNG ghim trên adapter CÓ ghim ⇒ nhãn unpinned_tag (như trước M1); đọc nhãn NÉM ⇒ pin_load_failed; 0 lần ghi", async () => {
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_run", value: false }]));
      expect(res.reason).toBe("SAFETY_SIM_ONLY");
      expect(res.appError?.appParams.stopPinReason).toBe("unpinned_tag");
      expect(received).toHaveLength(0);
    });
    fake.pinLoadThrows = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withPlcConfigs([SIM], async () => {
        const res = await run(await stopInput([{ tagKey: "cmd_run", value: false }]));
        expect(fake.pinLoadCalls).toBe(2);
        expect(res.status).toBe("rejected");
        expect(res.reason).toBe("SAFETY_SIM_ONLY");
        expect(res.appError?.appParams.stopPinReason).toBe("pin_load_failed");
        expect(received).toHaveLength(0);
      });
    } finally {
      warn.mockRestore();
    }
  });

  // ═════════ (h) authN/authZ vẫn áp cho stop ghim ═════════
  it("(h) người KHÔNG sở hữu action xác nhận (confirmedBy khác chủ) + stop ghim ⇒ NOT_CONFIRMED, 0 lần ghi", async () => {
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }], { confirmedBy: STRANGER }));
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("NOT_CONFIRMED");
      expect(received).toHaveLength(0);
    });
  });

  it("(h2) stop ghim KHÔNG có actionId (không có người xác nhận) ⇒ PRECONDITION_FAILED, 0 lần ghi", async () => {
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }], { noAction: true }));
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("PRECONDITION_FAILED");
      expect(received).toHaveLength(0);
    });
  });

  it("(h3) action xác nhận cho một lệnh KHÁC (giá trị khác) + stop ghim ⇒ ACTION_BINDING_MISMATCH, 0 lần ghi", async () => {
    await withPlcConfigs([SIM], async () => {
      const inp = await stopInput([{ tagKey: "cmd_stop", value: true }]);
      const other = await makeAction(adapterPinned, MACHINE, "stop", [{ tagKey: "speed_sp", value: 0 }]);
      const res = await run({ ...inp, triggeredBy: { ...(inp.triggeredBy as any), actionId: other } });
      expect(res.reason).toBe("ACTION_BINDING_MISMATCH");
      expect(received).toHaveLength(0);
    });
  });

  // ═════════ các cổng khác không đổi ═════════
  it("idempotency: gửi lại CÙNG khoá một stop ghim ⇒ phát lại kết quả cũ, thiết bị chỉ nhận 1 lần", async () => {
    await withPlcConfigs([SIM], async () => {
      const inp = await stopInput([{ tagKey: "cmd_stop", value: true }]);
      const r1 = await run(inp);
      const r2 = await run(inp);
      expect(r1.status).toBe("acked");
      expect(r2.status).toBe("acked");
      expect(r2.pinnedStop).toBe(true); // fix round 1 — the replay still says it was a pinned stop
      expect(received).toHaveLength(1);
    });
  });

  it("dry-run (OT_CONTROL tắt) + stop ghim ⇒ simulated như cũ, 0 lần ghi", async () => {
    delete process.env.OT_CONTROL_ENABLED;
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }]));
      expect(res.status).toBe("simulated");
      expect(received).toHaveLength(0);
    });
  });

  it("R-1D-c: SEC_PLATFORM + policy DENY ot.command.stop + stop ghim ⇒ vẫn acked; sổ ghi policyOverride; audit stop_policy_override", async () => {
    fake.policyOn = true;
    fake.policyVerdict = { "ot.command.stop": "deny" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withPlcConfigs([SIM], async () => {
        const inp = await stopInput([{ tagKey: "cmd_stop", value: true }]);
        const res = await run(inp);
        expect(res.status).toBe("acked");
        expect(received).toHaveLength(1);
        const rows = await ledger(inp.idempotencyKey);
        const result = rows.find((r) => (r.ackValue as any)?.ledger === "result");
        expect((result?.ackValue as any)?.policyOverride).toMatchObject({ decision: "POLICY_DENIED", effect: "deny", policyRef: "p-d1t2-deny", ruling: "R-1D-c" });
        let audits: Array<typeof controlAuditLog.$inferSelect> = [];
        for (let i = 0; i < 100 && audits.length === 0; i++) {
          audits = await (await d())
            .select()
            .from(controlAuditLog)
            .where(and(eq(controlAuditLog.entityType, "ot_command"), eq(controlAuditLog.entityId, String(result!.id)), eq(controlAuditLog.action, "stop_policy_override")));
          if (audits.length === 0) await new Promise((r) => setTimeout(r, 50));
        }
        expect(audits).toHaveLength(1);
        expect(audits[0].afterJson).toMatchObject({ effect: "deny", policyRef: "p-d1t2-deny" });
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("R-1D-c đối chứng: policy DENY + stop KHÔNG khớp ghim ⇒ POLICY_DENIED như cũ, 0 lần ghi", async () => {
    fake.policyOn = true;
    fake.policyVerdict = { "ot.command.stop": "deny" };
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_run", value: false }]));
      expect(res.reason).toBe("POLICY_DENIED");
      expect(received).toHaveLength(0);
    });
  });

  it("R-1D-c: cổng interlock đang CHẶN máy + stop ghim ⇒ vẫn acked; sổ ghi interlockOverride; audit stop_interlock_override", async () => {
    fake.interlockBlocked = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withPlcConfigs([SIM], async () => {
        const inp = await stopInput([{ tagKey: "cmd_stop", value: true }]);
        const res = await run(inp);
        expect(res.status).toBe("acked");
        expect(received).toHaveLength(1);
        const rows = await ledger(inp.idempotencyKey);
        const result = rows.find((r) => (r.ackValue as any)?.ledger === "result");
        expect((result?.ackValue as any)?.interlockOverride).toMatchObject({ decision: "INTERLOCK_BLOCKED", ruling: "R-1D-c" });
        let audits: Array<typeof controlAuditLog.$inferSelect> = [];
        for (let i = 0; i < 100 && audits.length === 0; i++) {
          audits = await (await d())
            .select()
            .from(controlAuditLog)
            .where(and(eq(controlAuditLog.entityType, "ot_command"), eq(controlAuditLog.entityId, String(result!.id)), eq(controlAuditLog.action, "stop_interlock_override")));
          if (audits.length === 0) await new Promise((r) => setTimeout(r, 50));
        }
        expect(audits).toHaveLength(1);
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("★ M6: stop ghim đường ràng buộc chặt (requireBoundAction, KHÔNG gửi confirmedBy) + interlock CHẶN ⇒ audit stop_interlock_override mang NGƯỜI XÁC NHẬN của sổ (chủ action), không phải -1", async () => {
    fake.interlockBlocked = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withPlcConfigs([SIM], async () => {
        const base = await stopInput([{ tagKey: "cmd_stop", value: true }]);
        const t = base.triggeredBy as any;
        const inp: DispatchInput = { ...base, triggeredBy: { kind: "hitl", actionId: t.actionId, tool: t.tool, requestedBy: OWNER, requireBoundAction: true } as any };
        const res = await run(inp);
        expect(res.status).toBe("acked");
        const rows = await ledger(inp.idempotencyKey);
        const result = rows.find((r) => (r.ackValue as any)?.ledger === "result");
        expect(result?.confirmedBy).toBe(OWNER); // sổ ghi người xác nhận đã ràng buộc
        let audits: Array<typeof controlAuditLog.$inferSelect> = [];
        for (let i = 0; i < 100 && audits.length === 0; i++) {
          audits = await (await d())
            .select()
            .from(controlAuditLog)
            .where(and(eq(controlAuditLog.entityType, "ot_command"), eq(controlAuditLog.entityId, String(result!.id)), eq(controlAuditLog.action, "stop_interlock_override")));
          if (audits.length === 0) await new Promise((r) => setTimeout(r, 50));
        }
        expect(audits).toHaveLength(1);
        expect(audits[0].actorId).toBe(OWNER);
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("R-1D-c đối chứng: interlock CHẶN + lệnh không phải dừng (safety OK giả lập bằng tắt preflight) ⇒ INTERLOCK_BLOCKED như cũ", async () => {
    fake.interlockBlocked = true;
    process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }], { commandType: "start" }));
      expect(res.reason).toBe("INTERLOCK_BLOCKED");
      expect(received).toHaveLength(0);
    });
  });

  // ═════════ fix round 1 (R-1D-h) ═════════
  it("★ fix1 #2 → M1: một lần đọc ghim RIÊNG thấy ghim khác (bool true trên tag int) KHÔNG còn chen được vào quyết định — hàng bước 3 (ghim 0) quyết: stop true ⇒ value_mismatch 0 lần ghi; stop 0 ⇒ acked", async () => {
    fake.pinOverride = [{ tagKey: "speed_sp", value: true }];
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "speed_sp", value: true }]));
      expect(res.status).toBe("rejected");
      expect(res.reason).toBe("SAFETY_SIM_ONLY");
      expect(res.appError?.appParams.stopPinReason).toBe("value_mismatch");
      expect(res.pinnedStop).toBe(false);
      expect(received).toHaveLength(0);
      const ok = await run(await stopInput([{ tagKey: "speed_sp", value: 0 }]));
      expect(ok.status).toBe("acked");
      expect(received).toEqual([[{ tagKey: "speed_sp", value: 0 }]]);
    });
  });

  it("fix1 #3: cổng interlock LỖI ĐÁNH GIÁ (failClosed) + stop ghim ⇒ vẫn acked; sổ interlockOverride.failClosed:true", async () => {
    fake.interlockFailClosed = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withPlcConfigs([SIM], async () => {
        const inp = await stopInput([{ tagKey: "cmd_stop", value: true }]);
        const res = await run(inp);
        expect(res.status).toBe("acked");
        expect(received).toEqual([[{ tagKey: "cmd_stop", value: true }]]);
        const rows = await ledger(inp.idempotencyKey);
        const result = rows.find((r) => (r.ackValue as any)?.ledger === "result");
        expect((result?.ackValue as any)?.interlockOverride).toMatchObject({ decision: "INTERLOCK_BLOCKED", failClosed: true, ruling: "R-1D-c" });
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("fix1 #3 đối chứng: interlock failClosed + stop KHÔNG khớp ghim (preflight tắt để tới cổng interlock) ⇒ INTERLOCK_BLOCKED, 0 lần ghi", async () => {
    fake.interlockFailClosed = true;
    process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_run", value: false }]));
      expect(res.reason).toBe("INTERLOCK_BLOCKED");
      expect(received).toHaveLength(0);
    });
  });

  it("tag ghim bị TẮT sau khi ghim (loadStopPins bỏ qua) ⇒ không miễn — (sau đó bật lại)", async () => {
    await sql`UPDATE device_tags SET "isEnabled" = false WHERE "adapterId" = ${adapterPinned} AND "tagKey" = 'speed_sp'`;
    try {
      await withPlcConfigs([SIM], async () => {
        const res = await run(await stopInput([{ tagKey: "speed_sp", value: 0 }]));
        expect(res.status).toBe("rejected");
        expect(received).toHaveLength(0);
      });
    } finally {
      await sql`UPDATE device_tags SET "isEnabled" = true WHERE "adapterId" = ${adapterPinned} AND "tagKey" = 'speed_sp'`;
    }
  });

  // ═════════ final wave 1 (R-1D-k, I1) — adapter trỏ sang thiết bị MỚI, driver chưa nối lại ═════════
  it("★ I1: sửa adapter sang thiết bị MỚI + ghim lại + stop TRƯỚC khi nối lại ⇒ KHÔNG miễn (adapter_connection_stale), thiết bị CŨ không nhận gì; nối lại ⇒ miễn tới thiết bị MỚI", async () => {
    // Thiết bị CŨ (driver đang chạy, nối lúc adapter còn trỏ stub://R) và thiết bị MỚI — mỗi cái GHI LẠI lô nhận.
    const oldDev: W[][] = [];
    const newDev: W[][] = [];
    const devFor = (sink: W[][]) => ({
      isConnected: () => true,
      async writeTags(writes: W[]) {
        sink.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
        return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
      },
      async readTags() {
        return [];
      },
    });
    await connectFake(adapterRepoint, devFor(oldDev));
    // Kỹ sư trỏ adapter sang thiết bị khác (luật R-1D-a gỡ ghim trong cùng tx — ở đây UPDATE thô gỡ tay), rồi GHIM LẠI
    // cho thiết bị mới: cmd_stop ⇒ true. Driver KHÔNG được nối lại (otManager chỉ khởi động lại toàn khung).
    await sql`UPDATE device_adapters SET endpoint = 'stub://R-moi' WHERE id = ${adapterRepoint}`;
    await sql`UPDATE device_tags SET stop_value = ${sql.json(true)}, stop_pinned_by = ${String(OWNER)}, stop_pinned_at = now()
               WHERE "adapterId" = ${adapterRepoint} AND "tagKey" = 'cmd_stop'`;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withPlcConfigs([SIM], async () => {
        const inp = await stopInput([{ tagKey: "cmd_stop", value: true }], { adapterId: adapterRepoint, machineId: MACHINE_REPOINT });
        const res = await run(inp);
        expect(res.status).toBe("rejected");
        expect(res.reason).toBe("SAFETY_SIM_ONLY");
        expect(res.pinnedStop).toBe(false);
        expect(res.appError?.appParams.stopPinReason).toBe("adapter_connection_stale");
        expect(res.message).toMatch(/running connection was made for a different device/);
        expect(res.message).not.toMatch(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}/); // không lộ tên cờ .env
        expect(oldDev).toHaveLength(0);
        expect(newDev).toHaveLength(0);
        const rows = await ledger(inp.idempotencyKey);
        expect(rows.every((r) => (r.ackValue as any)?.stopPinReason === "adapter_connection_stale")).toBe(true);
      });
      // "Nối lại" (khởi động lại khung OT ⇒ otManager ghi dấu của cấu hình MỚI) ⇒ miễn, thiết bị MỚI nhận giá trị ghim.
      await connectFake(adapterRepoint, devFor(newDev));
      await withPlcConfigs([SIM], async () => {
        const res = await run(await stopInput([{ tagKey: "cmd_stop", value: 1 }], { adapterId: adapterRepoint, machineId: MACHINE_REPOINT }));
        expect(res.status).toBe("acked");
        expect(res.pinnedStop).toBe(true);
        expect(newDev).toEqual([[{ tagKey: "cmd_stop", value: true }]]);
        expect(oldDev).toHaveLength(0);
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("I1 đối chứng: đổi thứ KHÔNG phải đích (tên, pollIntervalMs) ⇒ vẫn miễn; không biết dấu kết nối ⇒ KHÔNG miễn", async () => {
    await sql`UPDATE device_adapters SET name = ${DAU + " P doi ten"}, "pollIntervalMs" = 777 WHERE id = ${adapterPinned}`;
    await withPlcConfigs([SIM], async () => {
      const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }]));
      expect(res.status).toBe("acked");
      expect(received).toEqual([[{ tagKey: "cmd_stop", value: true }]]);
    });
    received = [];
    const fp = fake.otFingerprints.get(adapterPinned)!;
    fake.otFingerprints.delete(adapterPinned);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withPlcConfigs([SIM], async () => {
        const res = await run(await stopInput([{ tagKey: "cmd_stop", value: true }]));
        expect(res.reason).toBe("SAFETY_SIM_ONLY");
        expect(res.appError?.appParams.stopPinReason).toBe("adapter_connection_stale");
        expect(received).toHaveLength(0);
      });
    } finally {
      fake.otFingerprints.set(adapterPinned, fp);
      warn.mockRestore();
    }
  });

  // ═════════ doc 81 Đợt 1E Task 1 (R-1E-a) — DỪNG ghim chen hàng đợi lệnh per-adapter ═════════
  // Thiết bị đích giả GIỮ lần ghi đầu (W1 đang bay) tới khi test nhả. Safety-PLC thật có gán tag, đọc SẠCH ⇒ lệnh
  // ghi thường qua preflight (OK); DỪNG ghim bỏ qua preflight như Đợt 1D. Oracle: thiết bị nhận gì, theo thứ tự nào.
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }
  async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`${what}: không đạt trong ${ms} ms`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  /** Driver giả: ghi lại từng lô; lô ĐẦU TIÊN bị giữ tới khi `release()`. */
  function heldFirstWriteDriver() {
    const gate = deferred<void>();
    const firstStarted = deferred<void>();
    let calls = 0;
    const driver = {
      isConnected: () => true,
      async writeTags(writes: Array<{ tagKey: string; value: unknown }>) {
        received.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
        if (++calls === 1) {
          firstStarted.resolve();
          await gate.promise;
        }
        return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
      },
      async readTags() {
        return [];
      },
    };
    return { driver, firstStarted: firstStarted.promise, release: () => gate.resolve() };
  }
  const writeCmd = (value: number) => stopInput([{ tagKey: "speed_sp", value }], { commandType: "tag.write" });

  it("★ 1E: hàng đợi BẬT, W1 đang bay — max=1: W2 thường ⇒ BUSY như cũ; max=2: W2 chờ + DỪNG ghim ⇒ W2 SUPERSEDED_BY_STOP (sổ nêu DỪNG, thiết bị KHÔNG nhận 333), DỪNG ghi giá trị ghim NGAY sau khi W1 nhả", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
    process.env.OT_CMD_QUEUE_MAX = "1";
    process.env.OT_CONTROL_TIMEOUT_MS = "30000"; // W1 bị giữ: không để hạn ghi 5 s tự nhả hàng
    _resetAdapterCommandQueuesForTests();
    const h = heldFirstWriteDriver();
    fake.otDrivers.set(adapterPinned, h.driver);
    try {
      await withPlcConfigs([realMapped()], async () => {
        const w1 = await writeCmd(111);
        const p1 = dispatch(w1);
        await within(h.firstStarted, 15_000, "W1 tới thiết bị");

        // max=1 ⇒ lệnh thường thứ hai BUSY, như cũ.
        const rBusy = await run(await writeCmd(222));
        expect(rBusy).toMatchObject({ ok: false, status: "rejected", reason: "BUSY" });

        // max=2 ⇒ W2 vào hàng CHỜ sau W1.
        process.env.OT_CMD_QUEUE_MAX = "2";
        const w2 = await writeCmd(333);
        const p2 = dispatch(w2);
        await until(() => _adapterCommandQueueDepthForTests(adapterPinned) === 2, 15_000, "W2 vào hàng chờ");

        // DỪNG ghim tới khi hàng ĐẦY (depth 2 = max) ⇒ không BUSY; W2 bị huỷ NGAY (W1 vẫn đang bay).
        const s = await stopInput([{ tagKey: "cmd_stop", value: 1 }]);
        const pS = dispatch(s);
        const r2 = await within(p2, 15_000, "W2 bị huỷ (không treo)");
        expect(r2).toEqual({
          ok: false,
          simulated: false,
          status: "rejected",
          reason: "SUPERSEDED_BY_STOP",
          results: [{ tagKey: "speed_sp", ok: false, status: "rejected", error: "SUPERSEDED_BY_STOP" }],
          commandLogIds: expect.any(Array),
        });
        expect(r2.commandLogIds).toHaveLength(1);
        const rows2 = await ledger(w2.idempotencyKey);
        const intent2 = rows2.filter((r) => (r.ackValue as any)?.ledger === "intent");
        const result2 = rows2.filter((r) => (r.ackValue as any)?.ledger === "result");
        expect(intent2).toHaveLength(1);
        expect(result2).toHaveLength(1);
        expect(result2[0].id).toBe(r2.commandLogIds[0]);
        expect(result2[0].status).toBe("rejected");
        expect(String(result2[0].errorText)).toMatch(/^SUPERSEDED_BY_STOP: /);
        expect(String(result2[0].errorText)).toContain(s.idempotencyKey); // nêu ĐÚNG lệnh DỪNG
        expect(String(result2[0].errorText)).not.toMatch(/OT_CMD_|OT_CONTROL_/); // không tên cờ
        expect((result2[0].ackValue as any).intentId).toBe(intent2[0].id);
        expect((result2[0].ackValue as any).supersededByStop).toMatchObject({ idempotencyKey: s.idempotencyKey, commandType: "stop" });
        expect((result2[0].ackValue as any).pinnedStop).toBeUndefined(); // W2 không phải DỪNG
        expect(received).toEqual([[{ tagKey: "speed_sp", value: 111 }]]); // DỪNG chưa chạy: W1 KHÔNG bị ngắt

        h.release();
        const r1 = await within(p1, 15_000, "W1");
        expect(r1.status).toBe("acked");
        const rS = await within(pS, 15_000, "DỪNG");
        expect(rS.status).toBe("acked");
        expect(rS.pinnedStop).toBe(true);
        // Thiết bị: W1 rồi NGAY giá trị ghim (boolean true, không phải số 1 của người gọi); 333 KHÔNG BAO GIỜ tới.
        expect(received).toEqual([[{ tagKey: "speed_sp", value: 111 }], [{ tagKey: "cmd_stop", value: true }]]);
        const rowsS = await ledger(s.idempotencyKey);
        expect(rowsS.find((r) => (r.ackValue as any)?.ledger === "result")?.status).toBe("acked");
        await until(() => _adapterCommandQueueDepthForTests(adapterPinned) === 0, 5_000, "hàng cạn");
      });
    } finally {
      h.release();
      fake.otDrivers.set(adapterPinned, fakeOtDriver);
      _resetAdapterCommandQueuesForTests();
    }
  });

  it("1E đối chứng: stop KHÔNG ghim (giá trị khác ghim) cùng thiết lập ⇒ max=1 BUSY; max=3 xếp FIFO sau W2, KHÔNG huỷ W2 (thiết bị nhận W1, W2, stop)", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
    process.env.OT_CMD_QUEUE_MAX = "1";
    process.env.OT_CONTROL_TIMEOUT_MS = "30000";
    _resetAdapterCommandQueuesForTests();
    const h = heldFirstWriteDriver();
    fake.otDrivers.set(adapterPinned, h.driver);
    try {
      await withPlcConfigs([realMapped()], async () => {
        const p1 = dispatch(await writeCmd(111));
        await within(h.firstStarted, 15_000, "W1 tới thiết bị");

        const rBusy = await run(await stopInput([{ tagKey: "cmd_stop", value: false }]));
        expect(rBusy).toMatchObject({ ok: false, status: "rejected", reason: "BUSY" });
        expect(rBusy.pinnedStop).toBeUndefined(); // không phải DỪNG ghim

        process.env.OT_CMD_QUEUE_MAX = "3";
        const p2 = dispatch(await writeCmd(333));
        await until(() => _adapterCommandQueueDepthForTests(adapterPinned) === 2, 15_000, "W2 vào hàng chờ");
        const pU = dispatch(await stopInput([{ tagKey: "cmd_stop", value: false }]));
        await until(() => _adapterCommandQueueDepthForTests(adapterPinned) === 3, 15_000, "stop không ghim vào hàng chờ");
        expect(received).toEqual([[{ tagKey: "speed_sp", value: 111 }]]);

        h.release();
        const [r1, r2, rU] = await within(Promise.all([p1, p2, pU]), 15_000, "W1/W2/stop");
        expect(r1.status).toBe("acked");
        expect(r2.status).toBe("acked"); // KHÔNG bị huỷ
        expect(rU.status).toBe("acked");
        expect(received).toEqual([
          [{ tagKey: "speed_sp", value: 111 }],
          [{ tagKey: "speed_sp", value: 333 }],
          [{ tagKey: "cmd_stop", value: false }],
        ]);
      });
    } finally {
      h.release();
      fake.otDrivers.set(adapterPinned, fakeOtDriver);
      _resetAdapterCommandQueuesForTests();
    }
  });
});

// ═════════ canonicalisePinnedStop — THUẦN (lớp thứ hai, fix round 1) ═════════
describe("canonicalisePinnedStop (thuần, lớp thứ hai)", () => {
  const row = (tagKey: string, value: unknown, dataType: string) => ({ write: { tagKey, value }, dataType });
  it("khớp ⇒ writes là giá trị GHIM theo thứ tự hàng resolved", () => {
    expect(canonicalisePinnedStop([row("speed_sp", 0, "int"), row("cmd_stop", 1, "bool")], [{ tagKey: "cmd_stop", value: true }, { tagKey: "speed_sp", value: 0 }])).toEqual({
      ok: true,
      writes: [{ tagKey: "speed_sp", value: 0 }, { tagKey: "cmd_stop", value: true }],
    });
  });
  it("hàng resolved KHÔNG có ghim (lớp matchPinnedStop bị hỏng/bỏ qua) ⇒ unpinned_tag — lớp này không tin lớp trước", () => {
    expect(canonicalisePinnedStop([row("cmd_stop", true, "bool"), row("cmd_run", true, "bool")], [{ tagKey: "cmd_stop", value: true }])).toEqual({ ok: false, reason: "unpinned_tag" });
  });
  it.each([
    ["int", true],
    ["bool", 0],
    ["float", "0"],
    ["string", 0],
    ["json", true],
  ] as const)("hàng dataType %s + ghim %j ⇒ pin_tag_changed", (dataType, value) => {
    expect(canonicalisePinnedStop([row("t", value, dataType)], [{ tagKey: "t", value }])).toEqual({ ok: false, reason: "pin_tag_changed" });
  });
});

// ═════════ classifyOtStop — THUẦN ═════════
describe("classifyOtStop (thuần)", () => {
  const pins = [
    { tagKey: "cmd_stop", value: true },
    { tagKey: "speed_sp", value: 0 },
  ];
  it("không phải lệnh dừng ⇒ isStop false (không xét ghim)", () => {
    expect(classifyOtStop("start", [{ tagKey: "cmd_stop", value: true }], pins)).toEqual({ isStop: false, pinnedStop: false });
  });
  it("stop khớp ⇒ pinnedStop + writes là GIÁ TRỊ GHIM (1 ⇒ true)", () => {
    expect(classifyOtStop("stop", [{ tagKey: "cmd_stop", value: 1 }], pins)).toEqual({ isStop: true, pinnedStop: true, writes: [{ tagKey: "cmd_stop", value: true }] });
  });
  it("E_STOP (hoa) cũng là lệnh dừng", () => {
    expect(classifyOtStop("E_STOP", [{ tagKey: "speed_sp", value: 0 }], pins).pinnedStop).toBe(true);
  });
  it.each([
    [[{ tagKey: "cmd_stop", value: true }, { tagKey: "cmd_run", value: true }], "unpinned_tag"],
    [[{ tagKey: "cmd_stop", value: false }], "value_mismatch"],
    [[], "empty_writes"],
    [[{ tagKey: "cmd_stop", value: true }, { tagKey: "cmd_stop", value: true }], "duplicate_tag"],
  ] as const)("stop %j ⇒ %s", (writes, reason) => {
    expect(classifyOtStop("stop", writes as any, pins)).toEqual({ isStop: true, pinnedStop: false, stopPinReason: reason });
  });
  it("không ghim ⇒ no_pins; đọc ghim lỗi (null) ⇒ pin_load_failed", () => {
    expect(classifyOtStop("stop", [{ tagKey: "cmd_stop", value: true }], [])).toEqual({ isStop: true, pinnedStop: false, stopPinReason: "no_pins" });
    expect(classifyOtStop("stop", [{ tagKey: "cmd_stop", value: true }], null)).toEqual({ isStop: true, pinnedStop: false, stopPinReason: "pin_load_failed" });
  });
});
