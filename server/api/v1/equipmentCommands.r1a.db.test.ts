/**
 * SCADA R1a Task 11 (K10 / D8) — REST v1 `POST /api/v1/equipment/:id/commands`: đặc tả HÀNH VI THẬT + gỡ khỏi OpenAPI.
 *
 * Route này KHÔNG bị gỡ (robotStopExempt / robotAbortNeverOrder gọi nó). Nó chỉ ra khỏi `GET /api/v1/openapi.json` (D8).
 * Thứ giữ nó an toàn là dispatcher, không phải lời hứa trong tài liệu: `buildCommand` gắn `hitl.actionId = apiv1-<khoá>` với
 * `requestedBy = 0` mà KHÔNG có hàng `ai_pending_actions` nào mang id đó ⇒ kiểm HITL cũ của `dispatch()` ra NOT_CONFIRMED.
 * Bộ test này ĐO điều đó theo từng nhóm `commandType`, với CSDL `_test` thật và driver giả ĐẾM số lần ghi xuống thiết bị
 * (oracle độc lập với mã sản phẩm). Môi trường cố ý MỞ HẾT cờ điều khiển (OT_CONTROL_ENABLED, ROBOT_CONTROL_ENABLED = true,
 * không commissioning, safety OK): nếu một lệnh không phải STOP lọt tới thiết bị thì nó lọt ở đây.
 *
 * command_log là WORM (avi_app không UPDATE/DELETE) ⇒ hàng test ở lại; mọi khoá mang tiền tố DAU duy nhất theo lượt chạy.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";

const IDS = vi.hoisted(() => {
  const base = 991_110_000 + (Date.now() % 9_000);
  return { robot: base, mRobot: base + 10_000, mOt: base + 20_000, mAoi: base + 30_000, mCmm: base + 40_000, mSensor: base + 50_000, mSpoof: base + 60_000, mRobotOt: base + 70_000 };
});
const env = vi.hoisted(() => ({
  hostile: false,
  jobs: [] as Array<{ jobType: string; params?: Record<string, unknown> }>,
  writes: [] as Array<Array<{ tagKey: string; value: unknown }>>,
  reads: 0,
}));

// ── thiết bị giả ────────────────────────────────────────────────────────────────────────────────
vi.mock("../../services/robot/robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));
vi.mock("../../services/robot/robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === IDS.robot
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            getMotionLock: () => ({ locked: false }),
            runJob: async (job: { jobType: string; params?: Record<string, unknown> }) => {
              env.jobs.push(job);
              return { ok: true, status: "done", detail: { fake: true } };
            },
            abort: async () => undefined,
            health: async () => ({ vendor: "sim", connected: true }),
          },
        }
      : undefined,
}));
vi.mock("../../services/safety/plc/safetyPlcAdapter", () => ({
  safetyPlcAdapterEnabled: () => true,
  listPlcConfigs: async () => [{ code: "SPLC-T11", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
  backendForConfig: () => ({
    read: async () => ({ estop: env.hostile }),
    readChecked: async () => ({ status: { estop: env.hostile }, unreadable: [] }),
  }),
  statusToFindings: (s: { estop?: boolean }) => (s?.estop ? [{ kind: "estop", severity: "critical", message: "E-STOP active" }] : []),
}));
vi.mock("../../services/interlock/interlockGate", () => ({
  evaluateInterlockGate: async () =>
    env.hostile ? { blocked: true, failClosed: false, violations: [{ ruleId: 1, action: "block" }] } : { blocked: false, failClosed: false, violations: [] },
}));
const drivers = vi.hoisted(() => new Map<number, unknown>());
vi.mock("../../services/ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../services/ot/otManager")>();
  return { ...orig, getActiveDriver: (adapterId: number) => drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver> };
});

// ── /api/v1: khoá master + máy tổng hợp theo loại ───────────────────────────────────────────────
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));
process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
vi.mock("../../db", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  const mk = (id: number, code: string, machineType: string, extra: Record<string, unknown> = {}) => ({
    id, code, name: code, machineType, operationStatus: "running", capabilities: null, stationId: 1, ...extra,
  });
  const machines: Record<number, ReturnType<typeof mk>> = {
    [IDS.mRobot]: mk(IDS.mRobot, "T11-ROBOT", "ROBOT"),
    [IDS.mOt]: mk(IDS.mOt, "T11-AUTO", "AUTOMATION"),
    [IDS.mAoi]: mk(IDS.mAoi, "T11-AOI", "AOI", { apiKey: "T11_MACHINE_KEY" }),
    [IDS.mCmm]: mk(IDS.mCmm, "T11-CMM", "CMM"),
    [IDS.mSensor]: mk(IDS.mSensor, "T11-SENSOR", "IOT_SENSOR"),
    // R1b-1 T5 fix round 1: override `capabilities.adapterKind` KHÔNG được quyết định robot-ness.
    [IDS.mSpoof]: mk(IDS.mSpoof, "T11-SPOOF", "AUTOMATION", { capabilities: { adapterKind: "robot" } }),
    [IDS.mRobotOt]: mk(IDS.mRobotOt, "T11-ROBOT-OT", "ROBOT", { capabilities: { adapterKind: "ot-opcua" } }),
  };
  return {
    ...orig,
    getMachineById: async (id: number) => machines[id],
    getMachineByApiKey: async (k: string) => (k === "T11_MACHINE_KEY" ? machines[IDS.mAoi] : undefined),
  };
});

import { getDb } from "../../db/connection";
import { commandLog, deviceAdapters, deviceTags, robotJobs, aiPendingActions } from "../../../drizzle/schema";
import { dispatch } from "../../services/ot/commandDispatcher";
import { otPayloadHash, withOtPayloadHash } from "../../services/ot/otActionBinding";
import { createV1Router } from "./router";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T11REST-${Date.now()}`;
let server: Server;
let base = "";
let adapterId = 0;
let seq = 0;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

const fakeDriver = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string; value: unknown }>) {
    env.writes.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags() {
    env.reads++;
    return [];
  },
  async getSafetyStatus() {
    return { state: "OK", source: "fake-driver", ts: new Date().toISOString() };
  },
};

async function post(machineId: number, body: Record<string, unknown>, key = "MASTER") {
  const res = await fetch(`${base}/api/v1/equipment/${machineId}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
const idem = (label: string) => `${DAU}-${label}-${++seq}`;
async function ledger(key: string) {
  return (await d()).select().from(commandLog).where(like(commandLog.idempotencyKey, `%${key}%`));
}
async function jobRow(jobId: number | undefined) {
  if (jobId == null) return undefined;
  const [row] = await (await d()).select().from(robotJobs).where(eq(robotJobs.id, jobId)).limit(1);
  return row;
}

const ENV_KEYS = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_CONTROL_TIMEOUT_MS", "EVENT_WEBHOOKS_ENABLED", "SCADA_CONG_CHE_DO_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("R1a T11 — REST v1 lệnh thiết bị: hành vi thật theo nhóm commandType (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    await import("../../services/ot/adapterFacade");
    const x = await d();
    const [a] = await x
      .insert(deviceAdapters)
      .values({ code: `${DAU}-A`, name: `${DAU} adapter`, protocol: "stub", endpoint: "stub://t11", isEnabled: true, machineId: IDS.mOt })
      .returning();
    adapterId = a!.id;
    await x.insert(deviceTags).values([
      { adapterId, tagKey: "speed_sp", address: "D100", dataType: "int", writable: true },
      { adapterId, tagKey: "toc_do", address: "D101", dataType: "int", writable: true, stopValue: 0 },
    ]);
    drivers.set(adapterId, fakeDriver);
    const app = express();
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    drivers.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const x = await d();
    await x.delete(aiPendingActions).where(like(aiPendingActions.id, `%${DAU}%`));
    if (adapterId) {
      await x.delete(deviceTags).where(eq(deviceTags.adapterId, adapterId));
      await x.delete(deviceAdapters).where(eq(deviceAdapters.id, adapterId));
    }
    try {
      await x.delete(robotJobs).where(eq(robotJobs.robotId, IDS.robot));
    } catch {
      /* robot_jobs có thể append-only với role ứng dụng */
    }
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }, 60_000);

  beforeEach(() => {
    env.hostile = false;
    env.jobs.length = 0;
    env.writes.length = 0;
    env.reads = 0;
    // MỞ HẾT cờ điều khiển: nếu một lệnh ghi lọt, nó lọt ở đây.
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    delete process.env.OT_READBACK_ENABLED;
    delete process.env.OT_CMD_SERIALIZE_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.UNS_CMD_ACK_ENABLED;
    delete process.env.AI_OT_CONTROL_ENABLED;
    delete process.env.EVENT_WEBHOOKS_ENABLED;
    delete process.env.SCADA_CONG_CHE_DO_ENABLED;
  });

  // ═════════ nhóm 1 — OT (AUTOMATION, adapter ot-opcua) — R1b-1 T5 (D8): MỌI lệnh OT qua REST v1 ⇒ 501, không tới dispatcher ═════════
  const MSG_501 = "Lệnh OT qua REST v1 không được hỗ trợ — dùng HMI SCADA (scadaCommands) hoặc STOP ghim. Xem docs/ECOSYSTEM/ADAPTER_SDK.md.";
  /** 501 + KHÔNG hàng command_log + KHÔNG ghi/đọc thiết bị + KHÔNG phát webhook. */
  async function expect501(res: { status: number; body: any }, key: string) {
    expect(res.status).toBe(501);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatchObject({ code: "not_implemented", message: MSG_501 });
    expect(res.body.data).toBeUndefined();
    expect(env.writes).toHaveLength(0);
    expect(env.reads).toBe(0);
    expect(await ledger(key)).toHaveLength(0);
  }

  describe("OT / PLC (AUTOMATION)", () => {
    it("★ write_tag (ghi thường) ⇒ 501 not_implemented; 0 hàng command_log; 0 lần ghi thiết bị", async () => {
      const k = idem("wt");
      await expect501(await post(IDS.mOt, { command: "write_tag", args: { adapterId, tagKey: "speed_sp", value: 42 }, idempotencyKey: k }), k);
    });

    it("★ `writes[]` nhiều tag dưới tên lệnh `start` ⇒ 501; 0 hàng sổ; 0 lần ghi", async () => {
      const k = idem("start-writes");
      await expect501(
        await post(IDS.mOt, { command: "start", args: { adapterId, writes: [{ tagKey: "speed_sp", value: 7 }, { tagKey: "toc_do", value: 50 }] }, idempotencyKey: k }),
        k,
      );
    });

    it.each(["start", "pause", "reset", "acknowledge_machine_alarm"])("★ lệnh `%s` không có writes ⇒ 501, 0 hàng sổ, 0 lần ghi", async (command) => {
      const k = idem(command);
      await expect501(await post(IDS.mOt, { command, args: { adapterId }, idempotencyKey: k }), k);
    });

    it("set_machine_param ⇒ 501, 0 lần ghi", async () => {
      const k = idem("sp");
      await expect501(await post(IDS.mOt, { command: "set_machine_param", args: { adapterId, paramKey: "speed_sp", paramValue: "9" }, idempotencyKey: k }), k);
    });

    it("read_tag ⇒ 501; không đọc, không ghi, không hàng sổ", async () => {
      const k = idem("rt");
      await expect501(await post(IDS.mOt, { command: "read_tag", args: { adapterId, tagKey: "speed_sp" }, idempotencyKey: k }), k);
    });

    it("★ `stop` ghi đúng giá trị GHIM (toc_do = 0) qua REST ⇒ 501 (STOP OT đi bằng HMI SCADA, không đi REST v1); 0 hàng sổ, 0 lần ghi", async () => {
      const k = idem("stop-pin");
      await expect501(await post(IDS.mOt, { command: "stop", args: { adapterId, writes: [{ tagKey: "toc_do", value: 0 }] }, idempotencyKey: k }), k);
    });

    it("★ `stop` KHÔNG writes ⇒ 501, 0 hàng sổ, 0 lần ghi", async () => {
      const k = idem("stop-bare");
      await expect501(await post(IDS.mOt, { command: "stop", args: { adapterId }, idempotencyKey: k }), k);
    });

    it("★ hàng ai_pending_actions confirmed KHÁC id không cứu được lệnh: vẫn 501, 0 lần ghi", async () => {
      const k = idem("decoy");
      await (await d()).insert(aiPendingActions).values({
        id: `${DAU}-decoy-${seq}`, tool: "set_machine_param", argsJson: {}, userId: 990_111_001, userRole: "engineer", summary: `${DAU} decoy`,
        previewJson: {}, status: "confirmed", idempotencyKey: `${DAU}-decoy-idem-${seq}`, expiresAt: new Date(Date.now() + 600_000),
      });
      await expect501(await post(IDS.mOt, { command: "write_tag", args: { adapterId, tagKey: "speed_sp", value: 1 }, idempotencyKey: k }), k);
    });

    it("không truyền args.adapterId ⇒ 501, 0 lần ghi", async () => {
      const k = idem("noadapter");
      await expect501(await post(IDS.mOt, { command: "write_tag", args: { tagKey: "speed_sp", value: 3 }, idempotencyKey: k }), k);
    });

    it("OT_CONTROL_ENABLED tắt (mặc định) ⇒ cùng kết cục 501: nhánh 501 không phụ thuộc cờ điều khiển", async () => {
      delete process.env.OT_CONTROL_ENABLED;
      const k = idem("flagoff");
      await expect501(await post(IDS.mOt, { command: "write_tag", args: { adapterId, tagKey: "speed_sp", value: 5 }, idempotencyKey: k }), k);
    });

    it("★ không phát webhook `equipment.command.executed` cho lệnh OT bị từ chối", async () => {
      const emitSpy = vi.spyOn(await import("./webhookBridge"), "emit");
      try {
        await post(IDS.mOt, { command: "write_tag", args: { adapterId, tagKey: "speed_sp", value: 6 }, idempotencyKey: idem("nohook") });
        expect(emitSpy).not.toHaveBeenCalled();
      } finally {
        emitSpy.mockRestore();
      }
    });
  });

  // ═════════ ĐỐI CHỨNG DƯƠNG — oracle `env.writes` THẬT SỰ đếm được một lần ghi ═════════
  describe("đối chứng dương (oracle ghi thiết bị)", () => {
    it("★ cùng driver giả + dispatcher thật + hàng ai_pending_actions confirmed, gắn đúng ⇒ env.writes = 1 (các ca \"0 lần ghi\" trên không đạt vì dây mock hỏng)", async () => {
      const tool = "set_machine_param";
      const writes = [{ tagKey: "speed_sp", value: 42 }];
      const actionId = `${DAU}-posctl-act`;
      const OWNER = 990_111_101;
      await (await d()).insert(aiPendingActions).values({
        id: actionId, tool, argsJson: {}, userId: OWNER, userRole: "engineer", summary: `${DAU} positive control`,
        previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool, adapterId, machineId: IDS.mOt, commandType: "set_param", writes })),
        status: "confirmed", idempotencyKey: `${actionId}-idem`, expiresAt: new Date(Date.now() + 600_000),
      });
      const posKey = idem("posctl");
      const res = await dispatch({
        adapterId, machineId: IDS.mOt, commandType: "set_param", writes,
        triggeredBy: { kind: "hitl", actionId, tool, confirmedBy: OWNER, requestedBy: OWNER },
        idempotencyKey: posKey,
      });
      expect(res.ok).toBe(true);
      expect(env.writes).toEqual([[{ tagKey: "speed_sp", value: 42 }]]);
      // đối chứng dương cho sổ: ledger() THẤY hàng khi lệnh thật sự tới dispatcher (nếu không, "0 hàng" ở các ca 501 chẳng chứng minh gì)
      const rows = await ledger(posKey);
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═════════ nhóm 2 — robot ═════════
  describe("Robot (ROBOT)", () => {
    const postRobot = (command: string, label: string, extra: Record<string, unknown> = {}) =>
      post(IDS.mRobot, { command, args: { robotId: IDS.robot, ...extra }, idempotencyKey: idem(label) });

    it("★ abort ⇒ tới driver ĐÚNG MỘT lần dưới dạng job `abort`; robot_jobs ghi requestedBy 0 (STOP miễn HITL — R-1C-c)", async () => {
      const { status, body } = await postRobot("abort", "abort");
      expect(status).toBe(200);
      expect(body.data).toMatchObject({ accepted: true, status: "done", routedTo: "robot-dispatcher" });
      expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
      const row = await jobRow(body.data.detail?.jobId);
      expect(row?.jobType).toBe("abort");
      expect(row?.requestedBy).toBe(0);
    });

    it("★ e_stop ⇒ tới driver dưới dạng `abort`, kể cả khi safety BLOCKED + interlock vi phạm", async () => {
      env.hostile = true;
      const { body } = await postRobot("e_stop", "estop");
      expect(body.data.status).toBe("done");
      expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    });

    it.each(["start", "pause"])("★ chuyển động `%s` ⇒ bị từ chối, 0 job tới driver", async (command) => {
      const { status, body } = await postRobot(command, command);
      expect(status).toBe(200);
      expect(body.data.accepted).toBe(false);
      expect(body.data.status).toBe("rejected");
      expect(env.jobs).toHaveLength(0);
      expect(typeof body.data.error).toBe("string");
    });

    it("★ run_job (jobType home) ⇒ bị từ chối, 0 job tới driver", async () => {
      const { body } = await postRobot("run_job", "runjob", { jobType: "home", params: {} });
      expect(body.data.status).toBe("rejected");
      expect(env.jobs).toHaveLength(0);
    });
  });

  // ═════════ robot-ness theo machineType, KHÔNG theo override capabilities (R1b-1 T5 fix round 1) ═════════
  describe("override capabilities.adapterKind không quyết định robot", () => {
    it("★ AUTOMATION với capabilities {adapterKind:'robot'} ⇒ 501, KHÔNG tới robot driver, 0 hàng sổ", async () => {
      const k = idem("spoof");
      const { status, body } = await post(IDS.mSpoof, { command: "start", args: { robotId: IDS.robot }, idempotencyKey: k });
      expect(status).toBe(501);
      expect(body.error.code).toBe("not_implemented");
      expect(env.jobs).toHaveLength(0);
      expect(env.writes).toHaveLength(0);
      expect(await ledger(k)).toHaveLength(0);
    });

    it("★ ROBOT với capabilities {adapterKind:'ot-opcua'} ⇒ abort VẪN tới driver đúng một lần (không bị 501)", async () => {
      const { status, body } = await post(IDS.mRobotOt, { command: "abort", args: { robotId: IDS.robot }, idempotencyKey: idem("robot-ot") });
      expect(status).toBe(200);
      expect(body.data).toMatchObject({ accepted: true, status: "done", routedTo: "robot-dispatcher" });
      expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    });
  });

  // ═════════ nhóm 3 — adapter chỉ-đọc (vision / mtconnect) ═════════
  describe("Adapter chỉ-đọc", () => {
    it("AOI (vision) start ⇒ 501 (không phải robot), KHÔNG có hàng command_log (không tới dispatcher)", async () => {
      const k = idem("aoi");
      const { status, body } = await post(IDS.mAoi, { command: "start", idempotencyKey: k });
      expect(status).toBe(501);
      expect(body.error.code).toBe("not_implemented");
      expect(await ledger(k)).toHaveLength(0);
    });

    it("CMM (mtconnect) stop ⇒ 501", async () => {
      const { status, body } = await post(IDS.mCmm, { command: "stop", idempotencyKey: idem("cmm") });
      expect(status).toBe(501);
      expect(body.error.code).toBe("not_implemented");
    });
  });

  // ═════════ nhóm 4 — ot-stub (IOT_SENSOR chỉ có read_tag) ═════════
  describe("ot-stub (IOT_SENSOR)", () => {
    it("read_tag ⇒ 501 (không tới dispatcher, 0 hàng sổ, 0 lần ghi)", async () => {
      const k = idem("sensor");
      await expect501(await post(IDS.mSensor, { command: "read_tag", args: { adapterId, tagKey: "speed_sp" }, idempotencyKey: k }), k);
    });
  });

  // ═════════ cửa vào: scope / lệnh lạ / máy lạ ═════════
  describe("cửa vào", () => {
    it("khoá máy (chỉ ingest:write) ⇒ 403 forbidden, lệnh không tới dispatcher", async () => {
      const k = idem("scope");
      const { status, body } = await post(IDS.mAoi, { command: "start", idempotencyKey: k }, "T11_MACHINE_KEY");
      expect(status).toBe(403);
      expect(body.error.code).toBe("forbidden");
      expect(await ledger(k)).toHaveLength(0);
    });
    it("không khoá ⇒ 401", async () => {
      const res = await fetch(`${base}/api/v1/equipment/${IDS.mOt}/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "start" }) });
      expect(res.status).toBe(401);
    });
    it("lệnh không hỗ trợ ⇒ 400 unsupported_command; máy lạ ⇒ 404; thiếu `command` ⇒ 400", async () => {
      expect((await post(IDS.mOt, { command: "frobnicate" })).body.error.code).toBe("unsupported_command");
      expect((await post(IDS.mOt + 7, { command: "start" })).status).toBe(404);
      expect((await post(IDS.mOt, {})).status).toBe(400);
    });
  });

  // ═════════ OpenAPI — route chạy nhưng KHÔNG được công bố (D8) ═════════
  describe("OpenAPI (D8)", () => {
    it("★ GET /api/v1/openapi.json KHÔNG còn path /api/v1/equipment/{id}/commands, không còn schema CommandRequest; các path equipment khác còn", async () => {
      const res = await fetch(`${base}/api/v1/openapi.json`);
      expect(res.status).toBe(200);
      const spec = await res.json();
      expect(spec.paths["/api/v1/equipment/{id}/commands"]).toBeUndefined();
      expect(spec.components.schemas.CommandRequest).toBeUndefined();
      expect(JSON.stringify(spec)).not.toContain("equipment/{id}/commands");
      expect(JSON.stringify(spec)).not.toContain("equipment.command.executed"); // its only emitter is this route
      expect(spec.info.description).toContain("answers 501 for every non-robot (OT) command");
      expect(spec.paths["/api/v1/equipment"]).toBeTruthy();
      expect(spec.paths["/api/v1/ingest/inspection"]?.post).toBeTruthy();
    });
  });
});
