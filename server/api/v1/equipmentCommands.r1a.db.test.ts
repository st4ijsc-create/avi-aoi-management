/**
 * SCADA R1a Task 11 (K10 / D8) → pha 0 · C0-1 (2026-11-04) — REST v1 `POST /api/v1/equipment/:id/commands`: ĐÃ GỠ ⇒ 410 GONE cố định.
 *
 * Lịch sử: tệp từng ĐO hành vi thật của route theo nhóm `commandType` (OT ⇒ 501; robot chỉ STOP tới driver) với CSDL `_test` thật và driver giả ĐẾM số lần ghi
 * xuống thiết bị (oracle độc lập với mã sản phẩm). Cửa đã gỡ (TechDocs 50 §C0): MỌI nhóm (kể cả robot, kể cả STOP) nay phải 410 với 0 job / 0 ghi / 0 đọc /
 * 0 hàng command_log. Môi trường cố ý MỞ HẾT cờ điều khiển (OT_CONTROL_ENABLED, ROBOT_CONTROL_ENABLED = true, không commissioning, safety OK): nếu một lệnh
 * lọt tới thiết bị thì nó lọt ở đây. Ca "đối chứng dương" (đi thẳng dispatcher) chứng minh oracle ghi hoạt động.
 * Các tính chất AN TOÀN cũ của đường robot (STOP miễn HITL, abort không bao giờ ra order) được giữ ở cửa SỐNG: robotStopExempt / robotAbortNeverOrder (ca dispatcher + FOE).
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

describe.skipIf(!DB_URL)("R1a T11 → pha 0 C0-1 — REST v1 lệnh thiết bị ĐÃ GỠ: mọi nhóm commandType ⇒ 410 (CSDL _test)", () => {
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

  // ═════════ pha 0 · C0-1 — cửa REST v1 ĐÃ GỠ: MỌI nhóm commandType ⇒ 410 GONE, 0 job, 0 ghi, 0 đọc, 0 hàng sổ ═════════
  // Môi trường VẪN MỞ HẾT cờ điều khiển (beforeEach): nếu một lệnh lọt tới thiết bị thì nó lọt ở đây. Oracle ghi được chứng minh bằng ca "đối chứng dương" bên dưới
  // (đi THẲNG dispatcher có hàng ai_pending_actions confirmed) — nên "0 lần ghi" ở các ca 410 là có nghĩa, không phải dây mock hỏng.
  const MSG_410 = "Cửa lệnh thiết bị qua REST v1 đã được gỡ (không còn hỗ trợ, kể cả robot). Dùng HMI SCADA (scadaCommands) có xác nhận; trạng thái vẫn đọc được ở GET /equipment/:id/state.";
  /** 410 + KHÔNG hàng command_log + KHÔNG ghi/đọc thiết bị + KHÔNG job robot. */
  async function expect410(res: { status: number; body: any }, key: string) {
    expect(res.status).toBe(410);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatchObject({ code: "gone", message: MSG_410 });
    expect(res.body.data).toBeUndefined();
    expect(env.writes).toHaveLength(0);
    expect(env.reads).toBe(0);
    expect(env.jobs).toHaveLength(0);
    expect(await ledger(key)).toHaveLength(0);
  }

  describe("mọi nhóm commandType ⇒ 410 (không còn đường nào tới dispatcher/driver)", () => {
    // [nhãn, máy, thân]
    const CA: Array<[string, () => number, (k: string) => Record<string, unknown>]> = [
      ["OT write_tag (ghi thường)", () => IDS.mOt, (k) => ({ command: "write_tag", args: { adapterId, tagKey: "speed_sp", value: 42 }, idempotencyKey: k })],
      ["OT `writes[]` nhiều tag dưới tên `start`", () => IDS.mOt, (k) => ({ command: "start", args: { adapterId, writes: [{ tagKey: "speed_sp", value: 7 }, { tagKey: "toc_do", value: 50 }] }, idempotencyKey: k })],
      ["OT set_machine_param", () => IDS.mOt, (k) => ({ command: "set_machine_param", args: { adapterId, tagKey: "speed_sp", value: 5 }, idempotencyKey: k })],
      ["OT read_tag", () => IDS.mOt, (k) => ({ command: "read_tag", args: { adapterId, tagKey: "speed_sp" }, idempotencyKey: k })],
      ["OT stop ghi đúng giá trị GHIM (toc_do = 0)", () => IDS.mOt, (k) => ({ command: "stop", args: { adapterId, writes: [{ tagKey: "toc_do", value: 0 }] }, idempotencyKey: k })],
      ["OT stop KHÔNG writes", () => IDS.mOt, (k) => ({ command: "stop", args: { adapterId }, idempotencyKey: k })],
      ["OT không truyền args.adapterId", () => IDS.mOt, (k) => ({ command: "set_machine_param", args: { tagKey: "speed_sp", value: 1 }, idempotencyKey: k })],
      ["Robot abort", () => IDS.mRobot, (k) => ({ command: "abort", args: { robotId: IDS.robot }, idempotencyKey: k })],
      ["Robot e_stop", () => IDS.mRobot, (k) => ({ command: "e_stop", args: { robotId: IDS.robot }, idempotencyKey: k })],
      ["Robot run_job home", () => IDS.mRobot, (k) => ({ command: "run_job", args: { robotId: IDS.robot, jobType: "home", params: {} }, idempotencyKey: k })],
      ["Robot start (chuyển động)", () => IDS.mRobot, (k) => ({ command: "start", args: { robotId: IDS.robot }, idempotencyKey: k })],
      ["Robot pause (chuyển động)", () => IDS.mRobot, (k) => ({ command: "pause", args: { robotId: IDS.robot }, idempotencyKey: k })],
      ["★ Robot THIẾU args.robotId (lỗi trộn id máy→robotId nay không còn đường tới)", () => IDS.mRobot, (k) => ({ command: "abort", idempotencyKey: k })],
      ["AUTOMATION giả mạo capabilities {adapterKind:'robot'}", () => IDS.mSpoof, (k) => ({ command: "start", idempotencyKey: k })],
      ["ROBOT override capabilities {adapterKind:'ot-opcua'} abort", () => IDS.mRobotOt, (k) => ({ command: "abort", args: { robotId: IDS.robot }, idempotencyKey: k })],
      ["AOI (vision) start", () => IDS.mAoi, (k) => ({ command: "start", idempotencyKey: k })],
      ["CMM (mtconnect) stop", () => IDS.mCmm, (k) => ({ command: "stop", idempotencyKey: k })],
      ["IOT_SENSOR read_tag", () => IDS.mSensor, (k) => ({ command: "read_tag", args: { adapterId, tagKey: "speed_sp" }, idempotencyKey: k })],
    ];
    for (const [nhan, may, than] of CA) {
      it(`★ ${nhan} ⇒ 410 gone; 0 job/ghi/đọc/hàng sổ`, async () => {
        const k = idem("gone");
        await expect410(await post(may(), than(k)), k);
      });
    }

    it("★ môi trường THÙ ĐỊCH (safety BLOCKED + interlock vi phạm) cũng không đổi: STOP robot qua REST ⇒ 410, 0 job (đường dừng khẩn chỉ còn dispatcher/tRPC/FOE có người xác nhận)", async () => {
      env.hostile = true;
      const k = idem("gone-hostile");
      await expect410(await post(IDS.mRobot, { command: "e_stop", args: { robotId: IDS.robot }, idempotencyKey: k }), k);
    });

    it("★ hàng ai_pending_actions confirmed KHÁC id không cứu được: vẫn 410, 0 lần ghi", async () => {
      const k = idem("gone-other-act");
      const otherAct = `${DAU}-other-act-${seq}`;
      await (await d()).insert(aiPendingActions).values({
        id: otherAct, tool: "set_machine_param", argsJson: {}, userId: 990_111_102, userRole: "engineer", summary: `${DAU} other`,
        previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: "set_machine_param", adapterId, machineId: IDS.mOt, commandType: "set_param", writes: [{ tagKey: "speed_sp", value: 1 }] })),
        status: "confirmed", idempotencyKey: `${otherAct}-idem`, expiresAt: new Date(Date.now() + 600_000),
      });
      await expect410(await post(IDS.mOt, { command: "set_machine_param", args: { adapterId, tagKey: "speed_sp", value: 1 }, idempotencyKey: k }), k);
    });

    it("không phát webhook `equipment.command.executed` (không còn emitter nào)", async () => {
      process.env.EVENT_WEBHOOKS_ENABLED = "true";
      const k = idem("gone-webhook");
      const spy = vi.spyOn(globalThis, "fetch");
      const truoc = spy.mock.calls.length;
      const res = await post(IDS.mOt, { command: "write_tag", args: { adapterId, tagKey: "speed_sp", value: 9 }, idempotencyKey: k });
      expect(res.status).toBe(410);
      const them = spy.mock.calls.slice(truoc).map((c) => String(c[0]));
      expect(them.filter((u) => !u.startsWith(base))).toEqual([]);
      spy.mockRestore();
    });
  });

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

  // ═════════ cửa vào: xác thực / phạm vi ĐỨNG TRƯỚC (không lộ rằng cửa đã gỡ) ═════════
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
    it("lệnh lạ / máy lạ / thân rỗng ⇒ CÙNG 410 (không còn phân tích thân hay tra máy ⇒ không có oracle tồn tại)", async () => {
      expect((await post(IDS.mOt, { command: "frobnicate" })).status).toBe(410);
      expect((await post(IDS.mOt + 7, { command: "start" })).status).toBe(410);
      expect((await post(IDS.mOt, {})).status).toBe(410);
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
      expect(spec.info.description).not.toContain("equipment/{id}/commands"); // cửa đã gỡ — không còn nhắc tới trong hợp đồng công bố
      expect(spec.paths["/api/v1/equipment"]).toBeTruthy();
      expect(spec.paths["/api/v1/ingest/inspection"]?.post).toBeTruthy();
    });
  });
});
