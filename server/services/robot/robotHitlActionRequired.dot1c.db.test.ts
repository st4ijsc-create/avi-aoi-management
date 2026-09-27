/**
 * doc 81 Đợt 1C Task 3 (quyết định chủ dự án 2026-09-27: "Đóng") — lệnh robot `triggerKind:"hitl"`
 * KHÔNG có actionId không còn chạy.
 *
 * Trước đây (hợp đồng Task 5 Đợt 1B, CÒN MỞ ở báo cáo final wave): nhãn 'hitl' + một confirmedBy tự
 * điền, không actionId ⇒ bước 2 chỉ đòi confirmedBy khác rỗng ⇒ robot CHẠY THẬT, không gắn với bản ghi
 * xác nhận nào, không tiêu thụ gì (confirmedBy của người khác cũng qua).
 *
 * Ba lớp, đo TỪNG lớp (mỗi lớp có ca riêng mà hai lớp kia không che được):
 *   L1 dispatcher — 'hitl' + chuyển động + không actionId ⇒ rejected, error HITL_ACTION_REQUIRED,
 *      code PRECONDITION_FAILED, TRƯỚC mọi lệnh xuống driver (cả dry-run). STOP (abort) không bao giờ bị chặn.
 *   L2 vda5050Router.sendOrder — người vận hành bấm ⇒ 'manual', confirmedBy = user của phiên (R11),
 *      thủ tục actuation (sàn vai) như robot.actuate.
 *   L3 đường tự động (Vda5050Adapter.sendOrder/sendInstantActions, Ros2Bridge.dispatchToRos2) — 'hitl'
 *      không actionId ⇒ tạo bản ghi ai_pending_actions 'confirmed' GẮN robotPayloadHash của đúng job
 *      (mẫu FOE ensureOrchestrationAction) rồi dispatch với actionId đó; tạo không được ⇒ bị từ chối.
 *
 * CSDL THẬT (`_test`). Thiết bị = driver giả trong tiến trình ĐẾM runJob; MQTT/rosbridge = client giả
 * ĐẾM publish (không nối broker nào). Facade an toàn THẬT, nguồn PLC nền giả trả OK (như binding test).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const rt = vi.hoisted(() => ({ runJobCalls: 0, jobs: [] as Array<{ jobType: string; params?: Record<string, unknown> }> }));
const ROBOT_ID_HOISTED = vi.hoisted(() => ({ id: 990_710_000 + (Date.now() % 9_000) }));
const mint = vi.hoisted(() => ({ fail: false, calls: 0 }));
const agv = vi.hoisted(() => ({ adapter: null as unknown }));

vi.mock("./robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === ROBOT_ID_HOISTED.id
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            runJob: async (job: { jobType: string; params?: Record<string, unknown> }) => {
              rt.runJobCalls++;
              rt.jobs.push(job);
              return { ok: true, status: "done", detail: { fake: true } };
            },
            abort: async () => undefined,
            health: async () => ({ vendor: "sim", connected: true }),
          },
        }
      : undefined,
}));

// Nguồn đọc nền của facade an toàn THẬT: một PLC `real` (endpoint TEST-NET-1, không bao giờ được nối) đọc sạch ⇒ OK.
vi.mock("../safety/plc/safetyPlcAdapter", () => ({
  safetyPlcAdapterEnabled: () => true,
  listPlcConfigs: async () => [{ code: "SPLC-1", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
  backendForConfig: () => ({
    read: async () => ({ estop: false }),
    readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
  }),
  statusToFindings: () => [],
}));

// Lớp tạo bản ghi của đường tự động: bản THẬT, trừ khi ca "tạo không được" bật cờ.
vi.mock("./robotAutomationAction", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./robotAutomationAction")>();
  return {
    ...orig,
    ensureBoundRobotAction: async (...a: Parameters<typeof orig.ensureBoundRobotAction>) => {
      mint.calls++;
      if (mint.fail) return null;
      return orig.ensureBoundRobotAction(...a);
    },
  };
});

// Router: quyền module/permission không phải đối tượng đo ở đây (sàn vai actuation THÌ LÀ — không mock).
vi.mock("../../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));
vi.mock("../../db", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, phaiDoiMatKhau: async () => false };
});
vi.mock("../vda5050", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, getAgvAdapter: (id: number) => (id === ROBOT_ID_HOISTED.id ? agv.adapter : undefined) };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, robotJobs } from "../../../drizzle/schema";
import { dispatchRobotJob, type RobotDispatchInput } from "./robotCommandDispatcher";
import { robotPayloadHash, withOtPayloadHash, readOtPayloadHash } from "../ot/otActionBinding";
import { Vda5050Adapter } from "../vda5050/vda5050Adapter";
import { Ros2Bridge } from "../ros2/ros2Bridge";
import { vda5050Router } from "../../routers/vda5050Router";

const DB_URL = process.env.DATABASE_URL;
const ROBOT = ROBOT_ID_HOISTED.id;
const DAU = `T3HITL-${Date.now()}`;
const OWNER = 990_710_101;
const OTHER = 990_710_102;
const OPERATOR = 990_710_103;
let seq = 0;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

async function makeBoundAction(job: { jobType: string; params?: Record<string, unknown> }, userId = OWNER): Promise<string> {
  const id = `${DAU}-act-${++seq}`;
  await (await d()).insert(aiPendingActions).values({
    id,
    tool: "foe.orchestration",
    argsJson: {},
    userId,
    userRole: "engineer",
    summary: `${DAU} robot test action`,
    previewJson: withOtPayloadHash(null, robotPayloadHash({ robotId: ROBOT, jobType: job.jobType, params: job.params ?? null })),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return id;
}

function input(over: Partial<RobotDispatchInput> = {}): RobotDispatchInput {
  return {
    robotId: ROBOT,
    job: { jobType: "home", params: {} },
    triggerKind: "hitl",
    requestedBy: OWNER,
    confirmedBy: OWNER,
    ...over,
  };
}

async function jobRow(jobId: number | undefined) {
  if (jobId == null) return undefined;
  const [row] = await (await d()).select().from(robotJobs).where(eq(robotJobs.id, jobId)).limit(1);
  return row;
}
async function pendingRow(id: string) {
  const [row] = await (await d()).select().from(aiPendingActions).where(eq(aiPendingActions.id, id)).limit(1);
  return row;
}

/** mqtt client giả — ĐẾM publish theo topic (không có broker nào). */
function fakeMqtt() {
  const published: Array<{ topic: string; payload: string }> = [];
  return {
    published,
    client: {
      on: () => undefined,
      subscribe: () => undefined,
      publish: (topic: string, payload: string, _o: unknown, cb?: (e?: Error | null) => void) => {
        published.push({ topic, payload });
        cb?.(null);
      },
      end: (_f?: boolean, _o?: unknown, cb?: () => void) => cb?.(),
      connected: true,
    },
  };
}

function makeAgv() {
  const a = new Vda5050Adapter({
    robotId: ROBOT,
    code: `${DAU}-agv`,
    manufacturer: "acme",
    serialNumber: `${DAU}-sn`,
    interfaceName: "uagv",
    brokerUrl: "mqtt://127.0.0.1:1",
  });
  const m = fakeMqtt();
  (a as unknown as { client: unknown }).client = m.client;
  return { adapter: a, published: m.published };
}

/** rosbridge client giả — ĐẾM publish (không có WebSocket nào). */
function makeRos2() {
  const b = new Ros2Bridge({ url: "ws://127.0.0.1:1" });
  const published: string[] = [];
  (b as unknown as { client: unknown }).client = {
    isConnected: () => true,
    publish: (topic: string) => {
      published.push(topic);
    },
    close: async () => undefined,
    getLastError: () => undefined,
  };
  return { bridge: b, published };
}
const ROS_SPEC = { topic: "/cmd", type: "std_msgs/msg/String", msg: { data: "go" } };

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_CONTROL_TIMEOUT_MS", "FIELD_V2_ENABLED", "SEC_PLATFORM", "ROBOT_SAFETY_PREFLIGHT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("Đợt 1C Task 3 — robot 'hitl' không actionId bị ĐÓNG (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    await import("../ot/adapterFacade");
  }, 60_000);

  afterAll(async () => {
    const db = await d();
    await db.delete(aiPendingActions).where(like(aiPendingActions.id, `%${DAU}%`));
    for (const u of [OWNER, OTHER, OPERATOR]) {
      await db.delete(aiPendingActions).where(and(eq(aiPendingActions.userId, u), like(aiPendingActions.tool, "%.automation")));
    }
    try {
      await db.delete(robotJobs).where(eq(robotJobs.robotId, ROBOT));
    } catch {
      /* robot_jobs có thể append-only với role ứng dụng; các hàng mang robotId test riêng */
    }
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    rt.runJobCalls = 0;
    rt.jobs.length = 0;
    mint.fail = false;
    mint.calls = 0;
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    delete process.env.FIELD_V2_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
  });

  // ─── L1 — dispatcher ─────────────────────────────────────────────────────────────────────
  describe("L1 dispatcher", () => {
    it("★ 'hitl' + chuyển động + không actionId (đường THẬT) ⇒ rejected HITL_ACTION_REQUIRED / PRECONDITION_FAILED, driver 0 lần, sổ ghi rejected mang mã", async () => {
      const r = await dispatchRobotJob(input({ actionId: undefined }));
      expect(r.ok).toBe(false);
      expect(r.status).toBe("rejected");
      expect(r.error).toBe("HITL_ACTION_REQUIRED");
      expect(r.code).toBe("PRECONDITION_FAILED");
      expect(rt.runJobCalls).toBe(0);
      const row = await jobRow(r.jobId);
      expect(row?.status).toBe("rejected");
      expect(row?.errorText).toMatch(/^PRECONDITION_FAILED: HITL_ACTION_REQUIRED/);
      expect((row?.result as Record<string, unknown> | null)?.reasonCode).toBe("HITL_ACTION_REQUIRED");
    });

    it("hợp đồng cũ đã ĐÓNG: 'hitl' + confirmedBy của NGƯỜI KHÁC + không actionId ⇒ rejected (trước đây chạy), 0 lần", async () => {
      const r = await dispatchRobotJob(input({ actionId: undefined, confirmedBy: OTHER }));
      expect(r.error).toBe("HITL_ACTION_REQUIRED");
      expect(rt.runJobCalls).toBe(0);
    });

    it("triggerKind bỏ trống (mặc định 'hitl') + không actionId ⇒ cũng bị từ chối", async () => {
      const { triggerKind: _omit, ...rest } = input({ actionId: undefined });
      const r = await dispatchRobotJob(rest as RobotDispatchInput);
      expect(r.error).toBe("HITL_ACTION_REQUIRED");
      expect(rt.runJobCalls).toBe(0);
    });

    it("dry-run (ROBOT_CONTROL_ENABLED=false) cũng từ chối — không có trạng thái nửa vời 'mô phỏng qua, lên thật mới gãy'", async () => {
      process.env.ROBOT_CONTROL_ENABLED = "false";
      const r = await dispatchRobotJob(input({ actionId: undefined }));
      expect(r.status).toBe("rejected");
      expect(r.error).toBe("HITL_ACTION_REQUIRED");
      expect(rt.runJobCalls).toBe(0);
    });

    it("★ STOP không bao giờ bị chặn: 'hitl' + abort + không actionId ⇒ tới robot (done, 1 lần)", async () => {
      const r = await dispatchRobotJob(input({ actionId: undefined, job: { jobType: "abort", params: {} } }));
      expect(r.status).toBe("done");
      expect(rt.runJobCalls).toBe(1);
      expect(rt.jobs[0].jobType).toBe("abort");
    });

    it("đường hợp lệ còn nguyên: manual R11 không actionId ⇒ done; 'hitl' với bản ghi gắn đúng ⇒ done đúng một lần", async () => {
      const m = await dispatchRobotJob(input({ actionId: undefined, triggerKind: "manual" }));
      expect(m.status).toBe("done");
      const actionId = await makeBoundAction({ jobType: "home", params: {} });
      const h = await dispatchRobotJob(input({ actionId }));
      expect(h.status).toBe("done");
      expect(rt.runJobCalls).toBe(2);
      expect((await pendingRow(actionId))?.status).toBe("executed");
    });
  });

  // ─── L2 — vda5050Router (người vận hành bấm) ─────────────────────────────────────────────
  describe("L2 vda5050Router.sendOrder", () => {
    const nodes = [
      { x: 1, y: 2, mapId: "map" },
      { x: 3, y: 4, mapId: "map" },
    ];

    it("★ người vận hành bấm ⇒ 'manual', confirmedBy = requestedBy = user của phiên ⇒ chạy (1 lần runJob, 1 publish), sổ ghi manual", async () => {
      const { adapter, published } = makeAgv();
      agv.adapter = adapter;
      const caller = vda5050Router.createCaller({ user: { id: OPERATOR, role: "engineer", name: "Op", twoFactorEnabled: true } } as any);
      const r = await caller.sendOrder({ robotId: ROBOT, nodes });
      expect(r.status).toBe("done");
      expect(r.published).toBe(true);
      expect(rt.runJobCalls).toBe(1);
      expect(published.filter((p) => p.topic.endsWith("/order"))).toHaveLength(1);
      expect(mint.calls).toBe(0); // đường người vận hành KHÔNG tự cấp bản ghi xác nhận
      const row = await jobRow(r.jobId);
      expect(row?.triggerKind).toBe("manual");
      expect(row?.requestedBy).toBe(OPERATOR);
      expect(row?.confirmedBy).toBe(OPERATOR);
      expect(row?.actionId).toBeNull();
    });

    it("vai ngoài sàn actuation (R11: actuation role floor) ⇒ FORBIDDEN, robot 0 lần, 0 publish", async () => {
      const { adapter, published } = makeAgv();
      agv.adapter = adapter;
      const caller = vda5050Router.createCaller({ user: { id: OPERATOR, role: "user", name: "U", twoFactorEnabled: true } } as any);
      const err = await caller.sendOrder({ robotId: ROBOT, nodes }).then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("FORBIDDEN");
      expect(rt.runJobCalls).toBe(0);
      expect(published).toHaveLength(0);
    });
  });

  // ─── L3 — đường tự động ──────────────────────────────────────────────────────────────────
  describe("L3 đường tự động (VDA5050 adapter, ROS2 bridge)", () => {
    it("★ Vda5050Adapter.sendOrder 'hitl' không actionId ⇒ tạo bản ghi confirmed GẮN hash đúng job ⇒ chạy ĐÚNG MỘT lần, bản ghi executed; dùng lại ⇒ từ chối", async () => {
      const { adapter, published } = makeAgv();
      const r = await adapter.sendOrder({ nodes: [{ nodeId: "a", x: 0, y: 0, mapId: "map" }], requestedBy: OWNER, confirmedBy: OWNER });
      expect(r.status).toBe("done");
      expect(r.published).toBe(true);
      expect(rt.runJobCalls).toBe(1);
      expect(published).toHaveLength(1);
      const row = await jobRow(r.jobId);
      expect(row?.triggerKind).toBe("hitl");
      expect(row?.actionId).toMatch(/^vda5050-/);
      const pending = await pendingRow(row!.actionId!);
      expect(pending?.tool).toBe("vda5050.automation");
      expect(pending?.userId).toBe(OWNER);
      expect(pending?.status).toBe("executed");
      // Oracle: job mà driver giả THẬT SỰ nhận (không phải thứ mã tạo bản ghi tự khai).
      const seen = rt.jobs[0];
      expect(readOtPayloadHash(pending?.previewJson)).toBe(robotPayloadHash({ robotId: ROBOT, jobType: seen.jobType, params: seen.params ?? null }));
      // Bản ghi đã tiêu thụ không mở được lệnh thứ hai (cùng job).
      const again = await dispatchRobotJob({ robotId: ROBOT, job: seen as any, triggerKind: "hitl", actionId: row!.actionId!, requestedBy: OWNER, confirmedBy: OWNER });
      expect(again.status).toBe("rejected");
      expect(rt.runJobCalls).toBe(1);
    });

    it("bản ghi tự động chỉ mở ĐÚNG job nó được tạo cho: job khác (sai params) ⇒ ACTION_BINDING_MISMATCH", async () => {
      const { ensureBoundRobotAction } = await import("./robotAutomationAction");
      const job = { jobType: "move" as const, params: { vda5050: "order", order: { orderId: "o-1" } } };
      const actionId = await ensureBoundRobotAction({ tool: "vda5050.automation", robotId: ROBOT, job, ownerUserId: OWNER });
      expect(actionId).toBeTruthy();
      const r = await dispatchRobotJob(input({ actionId: actionId!, job: { jobType: "move", params: { vda5050: "order", order: { orderId: "o-2" } } } }));
      expect(r.error).toBe("ACTION_BINDING_MISMATCH");
      expect(rt.runJobCalls).toBe(0);
      expect((await pendingRow(actionId!))?.status).toBe("confirmed");
    });

    it("★ tạo bản ghi KHÔNG được ⇒ sendOrder bị từ chối HITL_ACTION_REQUIRED, robot 0 lần, 0 publish", async () => {
      mint.fail = true;
      const { adapter, published } = makeAgv();
      const r = await adapter.sendOrder({ nodes: [{ nodeId: "a", x: 0, y: 0, mapId: "map" }], requestedBy: OWNER, confirmedBy: OWNER });
      expect(mint.calls).toBe(1);
      expect(r.status).toBe("rejected");
      expect(r.error).toBe("HITL_ACTION_REQUIRED");
      expect(r.published).toBe(false);
      expect(rt.runJobCalls).toBe(0);
      expect(published).toHaveLength(0);
    });

    it("không confirmedBy ⇒ không có chủ để gắn ⇒ không tạo bản ghi, bị từ chối, 0 lần", async () => {
      const countVdaRows = async () =>
        (await (await d()).select({ id: aiPendingActions.id }).from(aiPendingActions).where(eq(aiPendingActions.tool, "vda5050.automation"))).length;
      const before = await countVdaRows();
      const { adapter, published } = makeAgv();
      const r = await adapter.sendOrder({ nodes: [{ nodeId: "a", x: 0, y: 0, mapId: "map" }], requestedBy: OWNER });
      expect(r.status).toBe("rejected");
      expect(r.error).toBe("HITL_ACTION_REQUIRED");
      expect(rt.runJobCalls).toBe(0);
      expect(published).toHaveLength(0);
      expect(await countVdaRows()).toBe(before);
    });

    it("chủ = 0 (người dùng hệ thống, mẫu `user.id || 0` của FOE) ⇒ lớp tạo bản ghi từ chối, KHÔNG có hàng nào được ghi", async () => {
      const { ensureBoundRobotAction } = await import("./robotAutomationAction");
      const key = `${DAU}-owner0`;
      const id = await ensureBoundRobotAction({ tool: "vda5050.automation", robotId: ROBOT, job: { jobType: "home", params: {} }, ownerUserId: 0, idempotencyKey: key });
      expect(id).toBeNull();
      expect(await pendingRow(`vda5050-${key}`)).toBeUndefined();
    });

    it("sendInstantActions (nhánh anh em) 'hitl' không actionId ⇒ cũng tạo bản ghi gắn hash ⇒ chạy một lần; tạo không được ⇒ từ chối", async () => {
      const { adapter, published } = makeAgv();
      const ok = await adapter.sendInstantActions({ actions: [{ actionId: "x1", actionType: "startPause", blockingType: "HARD" } as any], requestedBy: OWNER, confirmedBy: OWNER });
      expect(ok.status).toBe("done");
      expect(ok.published).toBe(true);
      expect(rt.runJobCalls).toBe(1);
      mint.fail = true;
      const no = await adapter.sendInstantActions({ actions: [{ actionId: "x2", actionType: "startPause", blockingType: "HARD" } as any], requestedBy: OWNER, confirmedBy: OWNER });
      expect(no.status).toBe("rejected");
      expect(no.error).toBe("HITL_ACTION_REQUIRED");
      expect(rt.runJobCalls).toBe(1);
      expect(published).toHaveLength(1);
    });

    it("★ Ros2Bridge.dispatchToRos2 'hitl' không actionId ⇒ tạo bản ghi gắn hash ⇒ chạy + publish ĐÚNG MỘT lần; tạo không được ⇒ từ chối, 0 publish", async () => {
      const { bridge, published } = makeRos2();
      const job = { jobType: "move" as const, params: { target: [1, 2, 3] } };
      const ok = await bridge.dispatchToRos2({ robotId: ROBOT, job, triggerKind: "hitl", requestedBy: OWNER, confirmedBy: OWNER }, ROS_SPEC);
      expect(ok.dispatch.status).toBe("done");
      expect(ok.published).toBe(true);
      expect(rt.runJobCalls).toBe(1);
      const row = await jobRow(ok.dispatch.jobId);
      expect(row?.actionId).toMatch(/^ros2-/);
      expect((await pendingRow(row!.actionId!))?.status).toBe("executed");
      mint.fail = true;
      const no = await bridge.dispatchToRos2({ robotId: ROBOT, job, triggerKind: "hitl", requestedBy: OWNER, confirmedBy: OWNER }, ROS_SPEC);
      expect(no.dispatch.status).toBe("rejected");
      expect(no.dispatch.error).toBe("HITL_ACTION_REQUIRED");
      expect(no.published).toBe(false);
      expect(rt.runJobCalls).toBe(1);
      expect(published).toHaveLength(1);
    });

    it("Ros2Bridge: 'manual' (người vận hành) và 'hitl' có actionId đi thẳng — KHÔNG tự cấp bản ghi", async () => {
      const { bridge } = makeRos2();
      const m = await bridge.dispatchToRos2({ robotId: ROBOT, job: { jobType: "home", params: {} }, triggerKind: "manual", requestedBy: OWNER, confirmedBy: OWNER }, ROS_SPEC);
      expect(m.dispatch.status).toBe("done");
      const actionId = await makeBoundAction({ jobType: "home", params: {} });
      const h = await bridge.dispatchToRos2({ robotId: ROBOT, job: { jobType: "home", params: {} }, triggerKind: "hitl", actionId, requestedBy: OWNER, confirmedBy: OWNER }, ROS_SPEC);
      expect(h.dispatch.status).toBe("done");
      expect(mint.calls).toBe(0);
      expect(rt.runJobCalls).toBe(2);
    });
  });
});
