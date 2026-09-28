/**
 * doc 81 Đợt 1C Task 1 — quyết định chủ dự án 2026-09-27: SIM safety-PLC KHÔNG được thoả preflight
 * đối với đích đã commission; tag an toàn đọc ra chất lượng XẤU trên backend thật ⇒ UNKNOWN.
 *
 * CSDL THẬT (`_test`, vitest.setup ép DATABASE_URL): cấu hình safety-PLC là hàng thật trong
 * `safety_plc_configs`, đọc bằng `listPlcConfigs` THẬT, phân loại bằng `effectiveBackend` THẬT,
 * đọc bằng `backendForConfig` → `OtReadSafetyPlcBackend` → `ModbusDriver` THẬT nói chuyện với một
 * safety-PLC GIẢ trong tiến trình: `ServerTCP` của `modbus-serial` trên 127.0.0.1 cổng 0 (đóng ở
 * afterAll). Kho coil của PLC giả là Map/Set do TEST giữ (oracle độc lập với mã sản phẩm): coil nào
 * nằm trong `plc.bad` thì server trả ngoại lệ Modbus ⇒ driver báo quality "bad".
 *
 * Thiết bị đích: driver OT giả ĐẾM `writeTags`, driver robot giả ĐẾM `runJob` — số lần thiết bị bị
 * lệnh là oracle. Driver OT giả KHÔNG cài getSafetyStatus ⇒ facade đi nhánh safety-PLC (đúng như
 * 0/6 driver sản xuất hôm nay). Commission = hàng `commissioning_records` / `robot_commissioning_records`
 * thật, cờ OT_/ROBOT_COMMISSIONING_REQUIRED để MẶC ĐỊNH (bật).
 *
 * ⚠ `safety_plc_configs` của `_test` dùng chung (hàng seed SIM-SAFETY-PLC-1 sạch luôn có mặt; tệp
 *   safetySourceHealth.dot1 chèn thêm một hàng SIM sạch khi chạy song song) ⇒ mọi kịch bản ở đây
 *   ĐÚNG khi có thêm hàng SIM sạch, và hàng của tệp này chỉ sống trong đúng một ca (xoá ở finally).
 *   OT và robot nằm CHUNG một tệp (chạy tuần tự) để hàng "real" của ca này không lọt vào ca kia.
 * Treo đo bằng `within(...)` tường minh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import net from "node:net";
import { like } from "drizzle-orm";
import postgres from "postgres";
import * as ModbusSerialNs from "modbus-serial";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fake = vi.hoisted(() => ({
  otDrivers: new Map<number, unknown>(),
  robots: new Map<number, unknown>(),
}));

vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => fake.otDrivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
  };
});
vi.mock("../robot/robotManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/robotManager")>();
  return {
    ...orig,
    getActiveRobot: (id: number) => (fake.robots.has(id) ? { driver: fake.robots.get(id) } : undefined),
  };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags, interlockEvents, interlockRules } from "../../../drizzle/schema";
import { dispatch, type DispatchInput } from "./commandDispatcher";
import { dispatchRobotJob, type RobotDispatchInput } from "../robot/robotCommandDispatcher";
import { otPayloadHash, robotPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { createAdapterFacade } from "./adapterFacade";
import { ModbusDriver, createModbusDriver } from "./drivers/modbusDriver";
import { registerDriver } from "./driverRegistry";

const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;

const DB_URL = process.env.DATABASE_URL;
const DAU = `D1CT1-${Date.now()}`;
const OWNER = 990_810_101;
const MACHINE = 990_810_001;
const ROBOT_OK = 990_811_000 + (Date.now() % 900);
const ROBOT_UNCOMMISSIONED = ROBOT_OK + 1;
const TOOL = "set_machine_param";

// ── Thiết bị đích giả: ĐẾM số lần bị lệnh ──────────────────────────────────────
let otWrites = 0;
let robotRuns = 0;
let robotJobTypes: string[] = [];
const fakeOtDriver = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string; value: unknown }>) {
    otWrites++;
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags() {
    return [];
  },
};
// fix round 1 #3 — driver TỰ báo an toàn OK (đếm số lần được hỏi): ở đường lệnh THẬT nó KHÔNG được thay safety-PLC.
let selfReportCalls = 0;
const fakeSelfReportDriver = {
  ...fakeOtDriver,
  async getSafetyStatus() {
    selfReportCalls++;
    return { state: "OK" as const, source: "self-report-driver", ts: new Date().toISOString() };
  },
};
const fakeRobotDriver = {
  vendor: "sim",
  isConnected: () => true,
  runJob: async (job: { jobType: string }) => {
    robotRuns++;
    robotJobTypes.push(job.jobType);
    return { ok: true, status: "done", detail: { fake: true } };
  },
  abort: async () => undefined,
  health: async () => ({ vendor: "sim", connected: true }),
};

// ── Safety-PLC giả (Modbus TCP theo đặc tả; kho coil do TEST giữ) ───────────────
const plc = { coils: new Map<number, boolean>(), bad: new Set<number>(), port: 0, close: async () => undefined as unknown };
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

// Địa chỉ Modbus "coil:N" ⇒ coil N-1 (1-based, như modbusDriver.sim.test ghim).
const ESTOP_COIL = "coil:1"; // coil 0
const ZONE_COIL = "coil:2"; // coil 1

let sql: ReturnType<typeof postgres>;
let adapterCommissioned = 0;
let adapterUncommissioned = 0;
let adapterSelfReport = 0; // fix round 1 #3 — driver TỰ báo getSafetyStatus = OK
let adapterInterlock = 0; // fix round 1 #4 — đích lệnh interlock stop_line (máy riêng, không đụng cổng interlock của ca HITL)
const MACHINE_IL = MACHINE + 1;
const APPROVER = OWNER;
let seq = 0;
const nextKey = (label: string) => `${DAU}-${label}-${++seq}`;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

type PlcRow = { backend: "sim" | "modbus"; endpoint?: string | null; statusMap?: unknown };
const SIM: PlcRow = { backend: "sim", endpoint: null, statusMap: null };
const realMapped = (): PlcRow => ({
  backend: "modbus",
  endpoint: `tcp://127.0.0.1:${plc.port}`,
  statusMap: { estop: { address: ESTOP_COIL, dataType: "bool" }, zoneOccupied: { address: ZONE_COIL, dataType: "bool" } },
});
const realDown = (): PlcRow => ({ backend: "modbus", endpoint: `tcp://127.0.0.1:${closedPort}`, statusMap: { estop: { address: ESTOP_COIL } } });
const realUnmapped = (): PlcRow => ({ backend: "modbus", endpoint: `tcp://127.0.0.1:${plc.port}`, statusMap: {} });

/** Chèn cấu hình safety-PLC THẬT cho đúng một ca, chạy, rồi xoá. */
async function withPlcConfigs<T>(rows: PlcRow[], fn: () => Promise<T>): Promise<T> {
  const ids: number[] = [];
  try {
    for (const r of rows) {
      const [x] = await sql`
        INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", enabled, scope)
        VALUES (${`${DAU}-${++seq}`.slice(0, 64)}, 'Đợt 1C T1', 'generic', ${r.backend}, ${r.endpoint ?? null},
                ${r.statusMap == null ? null : sql.json(r.statusMap as never)}, true, ${r.backend === "sim" ? "sim" : null})
        RETURNING id`;
      ids.push(Number(x.id));
    }
    return await fn();
  } finally {
    if (ids.length) await sql`DELETE FROM safety_plc_configs WHERE id IN ${sql(ids)}`;
  }
}

async function makeOtAction(adapterId: number, writes = [{ tagKey: "speed_sp", value: 42 }]): Promise<string> {
  const id = `${DAU}-ot-${++seq}`;
  await (await d()).insert(aiPendingActions).values({
    id,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} OT action`,
    previewJson: withOtPayloadHash(
      { entityType: "machine" },
      otPayloadHash({ tool: TOOL, adapterId, machineId: MACHINE, commandType: "set_param", writes }),
    ),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return id;
}

async function makeRobotAction(robotId: number): Promise<string> {
  const id = `${DAU}-rb-${++seq}`;
  await (await d()).insert(aiPendingActions).values({
    id,
    tool: "foe.orchestration",
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} robot action`,
    previewJson: withOtPayloadHash(null, robotPayloadHash({ robotId, jobType: "home", params: {} })),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return id;
}

async function otInput(adapterId: number): Promise<DispatchInput> {
  const actionId = await makeOtAction(adapterId);
  return {
    adapterId,
    machineId: MACHINE,
    commandType: "set_param",
    writes: [{ tagKey: "speed_sp", value: 42 }],
    triggeredBy: { kind: "hitl", actionId, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER },
    idempotencyKey: nextKey("ot"),
  };
}

async function robotInput(robotId: number): Promise<RobotDispatchInput> {
  const actionId = await makeRobotAction(robotId);
  return {
    robotId,
    job: { jobType: "home", params: {} },
    triggerKind: "hitl",
    actionId,
    requestedBy: OWNER,
    confirmedBy: OWNER,
    idempotencyKey: nextKey("rb"),
  };
}

async function otLedger(key: string) {
  return (await d()).select().from(commandLog).where(like(commandLog.idempotencyKey, `%${key}%`));
}

const runOt = async (adapterId: number) => {
  const inp = await otInput(adapterId);
  const res = await within(dispatch(inp), 15_000, "OT dispatch");
  return { inp, res };
};
const runRobot = async (robotId: number) => within(dispatchRobotJob(await robotInput(robotId)), 15_000, "robot dispatch");

const ENV_KEYS = [
  "SAFETY_PLC_ADAPTER_ENABLED",
  "OT_CONTROL_ENABLED",
  "OT_COMMISSIONING_REQUIRED",
  "OT_SAFETY_PREFLIGHT_ENABLED",
  "OT_READBACK_ENABLED",
  "OT_CMD_SERIALIZE_ENABLED",
  "ROBOT_CONTROL_ENABLED",
  "ROBOT_COMMISSIONING_REQUIRED",
  "ROBOT_SAFETY_PREFLIGHT_ENABLED",
  "ROBOT_CONTROL_TIMEOUT_MS",
  "SEC_PLATFORM",
  "UNS_CMD_ACK_ENABLED",
  "AI_OT_CONTROL_ENABLED",
  "PARAM_GUARDRAIL_ENABLED",
  "FIELD_V2_ENABLED",
  "INTERLOCK_AUTO_BLOCK_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("Đợt 1C Task 1 — SIM safety-PLC không thoả preflight cho đích đã commission (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    // Đợt 1D Task 2 fix round 1 (R-1D-h) — nạp NÓNG facade + nguồn safety-PLC: dispatcher nạp chúng bằng import
    // động BÊN TRONG hạn preflight 5 s; chạy gộp ~150 tệp thì lượt nạp nguội đầu tiên vượt hạn ⇒ UNKNOWN (ĐO: ~5,2 s).
    // Hạn sản xuất KHÔNG đổi.
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });

    // Đăng ký driver modbus THẬT đúng như server/services/ot/index.ts làm lúc boot (tệp đó còn khởi
    // động otManager/store-forward nên không nạp nó ở đây) — OtReadSafetyPlcBackend dùng createDriver.
    registerDriver("modbus", createModbusDriver);

    // Safety-PLC giả.
    plc.port = await freePort();
    closedPort = await freePort(); // đã đóng ⇒ ECONNREFUSED
    const vector = {
      getCoil: (addr: number) => {
        if (plc.bad.has(addr)) throw new Error(`illegal data address ${addr}`);
        return plc.coils.get(addr) ?? false;
      },
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
    const mk = async (suffix: string, driver: unknown = fakeOtDriver, machineId = MACHINE) => {
      const [a] = await x
        .insert(deviceAdapters)
        .values({ code: `${DAU}-${suffix}`, name: `${DAU} ${suffix}`, protocol: "stub", endpoint: `stub://${suffix}`, isEnabled: true, machineId })
        .returning();
      await x.insert(deviceTags).values([
        { adapterId: a!.id, tagKey: "speed_sp", address: "D100", dataType: "int", writable: true },
        { adapterId: a!.id, tagKey: "cmd_run", address: "M10", dataType: "bool", writable: true },
      ]);
      fake.otDrivers.set(a!.id, driver);
      return a!.id;
    };
    adapterCommissioned = await mk("C");
    adapterUncommissioned = await mk("U");
    adapterSelfReport = await mk("S", fakeSelfReportDriver);
    adapterInterlock = await mk("I", fakeOtDriver, MACHINE_IL);
    for (const id of [adapterCommissioned, adapterSelfReport, adapterInterlock]) {
      await sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference")
                VALUES (${id}, 'active', ${OWNER}, ${DAU})`;
    }
    await sql`INSERT INTO robot_commissioning_records ("robotId", status, "signedBy", "fatReference")
              VALUES (${ROBOT_OK}, 'active', ${OWNER}, ${DAU})`;
    fake.robots.set(ROBOT_OK, fakeRobotDriver);
    fake.robots.set(ROBOT_UNCOMMISSIONED, fakeRobotDriver);
  });

  afterAll(async () => {
    fake.otDrivers.clear();
    fake.robots.clear();
    try {
      await plc.close();
    } catch {
      /* ignore */
    }
    if (sql) {
      await sql`DELETE FROM safety_plc_configs WHERE code LIKE ${DAU + "%"}`;
      await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${DAU + "%"}`;
      await sql`UPDATE interlock_rules SET enabled = false WHERE name LIKE ${DAU + "%"}`.catch(() => undefined);
      await sql`DELETE FROM interlock_events WHERE "ruleId" IN (SELECT id FROM interlock_rules WHERE name LIKE ${DAU + "%"})`.catch(() => undefined);
      await sql`DELETE FROM interlock_rules WHERE name LIKE ${DAU + "%"}`.catch(() => undefined);
      for (const id of [adapterCommissioned, adapterUncommissioned, adapterSelfReport, adapterInterlock].filter(Boolean)) {
        await sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`;
        await sql`DELETE FROM device_adapters WHERE id = ${id}`;
        await sql`DELETE FROM commissioning_records WHERE "adapterId" = ${id}`.catch(() => undefined);
      }
      await sql`DELETE FROM robot_commissioning_records WHERE "robotId" IN (${ROBOT_OK}, ${ROBOT_UNCOMMISSIONED})`.catch(() => undefined);
      await sql`DELETE FROM robot_jobs WHERE "robotId" IN (${ROBOT_OK}, ${ROBOT_UNCOMMISSIONED})`.catch(() => undefined);
      await sql.end();
    }
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    otWrites = 0;
    robotRuns = 0;
    robotJobTypes = [];
    selfReportCalls = 0;
    delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
    plc.coils.clear();
    plc.bad.clear();
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    delete process.env.OT_COMMISSIONING_REQUIRED; // mặc định BẬT
    delete process.env.ROBOT_COMMISSIONING_REQUIRED; // mặc định BẬT
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED; // mặc định BẬT
    delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED; // mặc định BẬT
    for (const k of ["OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "FIELD_V2_ENABLED"]) {
      delete process.env[k];
    }
  });

  // ═════════ oracle độc lập cho "chất lượng xấu": ModbusDriver đọc thẳng PLC giả ═════════
  it("oracle: coil nằm trong plc.bad ⇒ ModbusDriver THẬT báo quality 'bad'; coil thường ⇒ 'good'", async () => {
    plc.bad.add(1);
    const drv = new ModbusDriver();
    await within(drv.connect({ endpoint: `tcp://127.0.0.1:${plc.port}`, timeoutMs: 2000 }), 5000, "connect");
    try {
      const s = await within(
        drv.readTags([
          { tagKey: "estop", address: ESTOP_COIL, dataType: "bool" },
          { tagKey: "zoneOccupied", address: ZONE_COIL, dataType: "bool" },
        ]),
        5000,
        "readTags",
      );
      expect(s.map((x) => [x.tagKey, x.quality])).toEqual([
        ["estop", "good"],
        ["zoneOccupied", "bad"],
      ]);
    } finally {
      await within(drv.disconnect(), 5000, "disconnect");
    }
  });

  // ═════════════════════════════ OT ═════════════════════════════
  describe("OT dispatcher (đích commission)", () => {
    it("chỉ SIM ⇒ rejected SAFETY_SIM_ONLY, thiết bị 0 lần ghi, sổ ghi lý do", async () => {
      await withPlcConfigs([SIM], async () => {
        const { inp, res } = await runOt(adapterCommissioned);
        expect(res.status).toBe("rejected");
        expect(res.reason).toBe("SAFETY_SIM_ONLY");
        expect(otWrites).toBe(0);
        const rows = await otLedger(inp.idempotencyKey);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.status === "rejected" && String(r.errorText).startsWith("SAFETY_SIM_ONLY:"))).toBe(true);
      });
    });

    it("chỉ real_unmapped (endpoint thật, 0 tag an toàn) ⇒ SAFETY_SIM_ONLY, 0 lần ghi", async () => {
      await withPlcConfigs([realUnmapped()], async () => {
        const { res } = await runOt(adapterCommissioned);
        expect(res.reason).toBe("SAFETY_SIM_ONLY");
        expect(otWrites).toBe(0);
      });
    });

    it("★ đường hợp lệ: real có gán tag, đọc sạch ⇒ ghi ĐÚNG 1 lần (kể cả khi có thêm SIM)", async () => {
      await withPlcConfigs([realMapped(), SIM], async () => {
        const { res } = await runOt(adapterCommissioned);
        expect(res.status).toBe("acked");
        expect(otWrites).toBe(1);
      });
    });

    it("trộn real + SIM, real đọc LỖI (cổng đóng) ⇒ chặn SAFETY_UNKNOWN (SIM không được gánh), 0 lần ghi", async () => {
      await withPlcConfigs([realDown(), SIM], async () => {
        const { res } = await runOt(adapterCommissioned);
        expect(res.status).toBe("rejected");
        expect(res.reason).toBe("SAFETY_UNKNOWN");
        expect(otWrites).toBe(0);
      });
    });

    it("real đọc tag chất lượng XẤU ⇒ chặn SAFETY_UNKNOWN, 0 lần ghi", async () => {
      plc.bad.add(1); // zoneOccupied không đọc được; estop sạch
      await withPlcConfigs([realMapped()], async () => {
        const { res } = await runOt(adapterCommissioned);
        expect(res.status).toBe("rejected");
        expect(res.reason).toBe("SAFETY_UNKNOWN");
        expect(otWrites).toBe(0);
      });
    });

    it("real chất lượng XẤU + SIM sạch ⇒ vẫn chặn, 0 lần ghi", async () => {
      plc.bad.add(0);
      await withPlcConfigs([realMapped(), SIM], async () => {
        const { res } = await runOt(adapterCommissioned);
        expect(res.status).toBe("rejected");
        expect(res.reason).toBe("SAFETY_UNKNOWN");
        expect(otWrites).toBe(0);
      });
    });

    it("real báo e-stop ACTIVE ⇒ SAFETY_BLOCKED (BLOCKED vẫn thắng), 0 lần ghi", async () => {
      plc.coils.set(0, true);
      await withPlcConfigs([realMapped(), SIM], async () => {
        const { res } = await runOt(adapterCommissioned);
        expect(res.reason).toBe("SAFETY_BLOCKED");
        expect(otWrites).toBe(0);
      });
    });

    it("đích CHƯA commission + chỉ SIM ⇒ vẫn mô phỏng như cũ (simulated / not_commissioned), 0 lần ghi", async () => {
      await withPlcConfigs([SIM], async () => {
        const { res } = await runOt(adapterUncommissioned);
        expect(res.status).toBe("simulated");
        expect(res.simulated).toBe(true);
        expect(res.reason).toBe("not_commissioned");
        expect(otWrites).toBe(0);
      });
    });

    it("OT_CONTROL tắt (dry-run) + chỉ SIM ⇒ simulated như cũ, 0 lần ghi", async () => {
      delete process.env.OT_CONTROL_ENABLED;
      await withPlcConfigs([SIM], async () => {
        const { res } = await runOt(adapterCommissioned);
        expect(res.status).toBe("simulated");
        expect(otWrites).toBe(0);
      });
    });
  });

  // ═════════════════════════════ robot ═════════════════════════════
  describe("robot dispatcher (robot commission)", () => {
    it("chỉ SIM ⇒ rejected SAFETY_SIM_ONLY, robot 0 lần chạy", async () => {
      await withPlcConfigs([SIM], async () => {
        const r = await runRobot(ROBOT_OK);
        expect(r.status).toBe("rejected");
        expect(r.error).toBe("SAFETY_SIM_ONLY");
        expect(robotRuns).toBe(0);
      });
    });

    it("chỉ real_unmapped ⇒ SAFETY_SIM_ONLY, 0 lần chạy", async () => {
      await withPlcConfigs([realUnmapped()], async () => {
        const r = await runRobot(ROBOT_OK);
        expect(r.error).toBe("SAFETY_SIM_ONLY");
        expect(robotRuns).toBe(0);
      });
    });

    it("★ đường hợp lệ: real có gán tag, đọc sạch ⇒ chạy ĐÚNG 1 lần", async () => {
      await withPlcConfigs([realMapped(), SIM], async () => {
        const r = await runRobot(ROBOT_OK);
        expect(r.status).toBe("done");
        expect(robotRuns).toBe(1);
      });
    });

    it("trộn real + SIM, real đọc LỖI ⇒ chặn SAFETY_UNKNOWN, 0 lần chạy", async () => {
      await withPlcConfigs([realDown(), SIM], async () => {
        const r = await runRobot(ROBOT_OK);
        expect(r.status).toBe("rejected");
        expect(r.error).toBe("SAFETY_UNKNOWN");
        expect(robotRuns).toBe(0);
      });
    });

    it("real đọc tag chất lượng XẤU ⇒ chặn SAFETY_UNKNOWN, 0 lần chạy", async () => {
      plc.bad.add(1);
      await withPlcConfigs([realMapped()], async () => {
        const r = await runRobot(ROBOT_OK);
        expect(r.status).toBe("rejected");
        expect(r.error).toBe("SAFETY_UNKNOWN");
        expect(robotRuns).toBe(0);
      });
    });

    it("robot CHƯA commission + chỉ SIM ⇒ vẫn simulated như cũ, 0 lần chạy", async () => {
      await withPlcConfigs([SIM], async () => {
        const r = await runRobot(ROBOT_UNCOMMISSIONED);
        expect(r.status).toBe("simulated");
        expect(r.ok).toBe(true);
        expect(robotRuns).toBe(0);
      });
    });
  });

  // ═════════ Fix round 1 (review 2026-09-27) ═════════
  describe("fix round 1", () => {
    const realMappedAt = (coil: string): PlcRow => ({ backend: "modbus", endpoint: `tcp://127.0.0.1:${plc.port}`, statusMap: { estop: { address: coil, dataType: "bool" } } });

    it("R-1C-b (OT + robot): PLC thật A sạch + PLC thật B có e-stop chất lượng XẤU ⇒ SAFETY_UNKNOWN (A không che B), 0 lần lệnh", async () => {
      plc.bad.add(2); // coil:3 của PLC B
      await withPlcConfigs([realMappedAt("coil:1"), realMappedAt("coil:3")], async () => {
        const { res } = await runOt(adapterCommissioned);
        expect(res.reason).toBe("SAFETY_UNKNOWN");
        const r = await runRobot(ROBOT_OK);
        expect(r.error).toBe("SAFETY_UNKNOWN");
        expect(otWrites).toBe(0);
        expect(robotRuns).toBe(0);
      });
    });

    it("R-1C-b (OT + robot): PLC thật A sạch + PLC thật B không kết nối được ⇒ SAFETY_UNKNOWN, 0 lần lệnh", async () => {
      await withPlcConfigs([realMapped(), realDown()], async () => {
        const { res } = await runOt(adapterCommissioned);
        expect(res.reason).toBe("SAFETY_UNKNOWN");
        const r = await runRobot(ROBOT_OK);
        expect(r.error).toBe("SAFETY_UNKNOWN");
        expect(otWrites).toBe(0);
        expect(robotRuns).toBe(0);
      });
    });

    it("#3: driver OT TỰ báo getSafetyStatus=OK, chỉ có SIM ⇒ SAFETY_SIM_ONLY; driver không được hỏi, 0 lần ghi", async () => {
      await withPlcConfigs([SIM], async () => {
        const { res } = await runOt(adapterSelfReport);
        expect(res.status).toBe("rejected");
        expect(res.reason).toBe("SAFETY_SIM_ONLY");
        expect(selfReportCalls).toBe(0);
        expect(otWrites).toBe(0);
      });
    });

    it("#4: chỉ SIM — lệnh interlock stop_line (tự dừng, không qua preflight) VẪN ghi đúng 1 lần", async () => {
      process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
      const [rule] = await (await d())
        .insert(interlockRules)
        .values({
          name: `${DAU} rule stop_line`,
          scope: "machine",
          machineId: MACHINE_IL,
          sourceType: "ng_rate",
          comparisonOperator: "gt",
          threshold: "99999",
          action: "stop_line",
          targetMachineId: MACHINE_IL,
          targetAdapterId: adapterInterlock,
          commandTag: "cmd_run",
          commandValue: null as never,
          requiresHumanConfirm: false,
          enabled: true,
          approvedBy: APPROVER,
          approvedAt: new Date(),
        })
        .returning();
      const [ev] = await (await d()).insert(interlockEvents).values({ ruleId: rule!.id, action: "stop_line", status: "fired" }).returning();
      await withPlcConfigs([SIM], async () => {
        const res = await within(
          dispatch({
            adapterId: adapterInterlock,
            machineId: MACHINE_IL,
            commandType: "stop_line",
            writes: [{ tagKey: "cmd_run", value: true }],
            triggeredBy: { kind: "interlock", ruleId: rule!.id, eventId: ev!.id, approvedBy: APPROVER },
            idempotencyKey: nextKey("il"),
          }),
          15_000,
          "interlock dispatch",
        );
        expect(res.status).toBe("acked");
        expect(otWrites).toBe(1);
      });
    });

    it("#4: chỉ SIM — robot abort (DỪNG) vẫn tới driver đúng 1 lần", async () => {
      await withPlcConfigs([SIM], async () => {
        const r = await within(
          dispatchRobotJob({ robotId: ROBOT_OK, job: { jobType: "abort" }, triggerKind: "manual", requestedBy: OWNER, idempotencyKey: nextKey("abort") }),
          15_000,
          "robot abort",
        );
        expect(r.status).toBe("done");
        expect(robotRuns).toBe(1);
        expect(robotJobTypes).toEqual(["abort"]);
      });
    });
  });

  // ═════════ các đường đọc KHÁC của facade giữ nguyên (cổng AI L-7, bảng so sánh) ═════════
  it("facade getSafetyStatus() KHÔNG tham số (đường cũ: cổng AI, lineReadiness mirror) — SIM sạch vẫn OK như trước", async () => {
    await withPlcConfigs([SIM], async () => {
      const s = await within(createAdapterFacade({ adapterId: -1, machineId: null }).getSafetyStatus(), 15_000, "facade");
      expect(s.state).toBe("OK");
      expect(s.source).toBe("safety_plc");
    });
  });
});

