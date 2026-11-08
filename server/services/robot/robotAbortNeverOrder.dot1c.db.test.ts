/**
 * doc 81 Đợt 1C residual 1 — ruling R-1C-m (load-bearing): "abort" KHÔNG BAO GIỜ làm robot chạy. Kiểm ĐẦU–CUỐI.
 *
 * Lỗ (re-review sau final wave): `POST /api/v1/equipment/:id/commands` `run_job {jobType:"abort", params:{order:{…}}}`
 * — và FOE cùng hình dạng (`foeEngine.buildEquipmentCommand`) — là job KHÔNG chuyển động ⇒ miễn mọi cổng chuyển động,
 * rồi `Vda5050RobotDriver.runJob` bỏ qua jobType và phát `params.order` lên topic `order` ⇒ AGV CHẠY dưới nhãn abort.
 *
 * Ở đây driver VDA5050 THẬT (không giả) nói với một broker MQTT giả trong tiến trình (client ghi lại mọi publish).
 * Oracle độc lập: topic + payload broker thật sự nhận; loại hành động dừng theo đặc tả VDA 5050 2.0.
 * Hai lớp độc lập: (a) dispatcher bỏ params (robotAbortCanonical.dot1c.test.ts), (b) driver luôn dựng tin dừng phía
 * server (vda5050StopNeverOrder.dot1c.test.ts) — ca đầu–cuối này phải xanh với MỖI lớp riêng lẻ.
 * CSDL THẬT (`_test`).
 *
 * PHA 0 · C0-1 (2026-11-04) — cửa REST v1 ĐÃ GỠ (410 GONE). BẢNG ĐỐI CHỨNG (tính chất AN TOÀN giữ trên cửa SỐNG, không chỉ đổi thành "assert 410"):
 *   • ca REST `run_job abort + order` ⇒ giữ NGUYÊN các khẳng định (0 order, 1 instantActions [cancelOrder,startPause], sổ không mang order) nhưng gọi thẳng
 *     `dispatchRobotJob` (dispatcher robot — cùng đích mà adapter của REST/FOE/tRPC đều đi qua) với đúng tham số REST từng gửi (hitl, requestedBy 0, actionId không tồn tại);
 *   • ca FOE (cửa sống) giữ nguyên — vẫn là đường hoàn chỉnh adapter→dispatcher→driver;
 *   • ca đối chứng `run_job move` ⇒ từ chối, 0 tin broker: gọi thẳng dispatcher với hình dạng hitl-không-xác-nhận của REST cũ;
 *   • +1 ca MỚI: REST ⇒ 410 và broker KHÔNG nhận gì (cửa gỡ thật, không còn đường REST nào tới driver).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, like } from "drizzle-orm";

const ROBOT_ID_HOISTED = vi.hoisted(() => ({ id: 990_730_000 + (Date.now() % 9_000) }));
const MACHINE_ID_HOISTED = vi.hoisted(() => ({ id: 990_730_000 + (Date.now() % 9_000) + 50_000 }));
const broker = vi.hoisted(() => ({ published: [] as Array<{ topic: string; payload: any }>, driver: null as unknown }));

// SCADA R1b-2b-2a A2(l) — this suite's robot has no robots row (fake id); WHERE a robot is is measured by tapMayChoRobot.a2l(.db).test.ts,
// so the robot is placed (a station with one machine id no rule targets) here.
vi.mock("../interlock/tapMayChoRobot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../interlock/tapMayChoRobot")>()),
  tapMayChoRobot: async (_d: unknown, robotId: number) => ({ loai: "tram" as const, robotId, stationId: 1, lineId: 1, machineIds: [-990_912_499] }),
}));
vi.mock("./robotManager", () => ({
  getActiveRobot: (id: number) => (id === ROBOT_ID_HOISTED.id && broker.driver ? { driver: broker.driver } : undefined),
}));
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));
vi.mock("../../db", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    getMachineById: async (id: number) =>
      id === MACHINE_ID_HOISTED.id
        ? { id, code: "R1CM-AGV", name: "R-1C-m AGV", machineType: "ROBOT", operationStatus: "running", capabilities: null, stationId: 1 }
        : undefined,
  };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, robotJobs } from "../../../drizzle/schema";
import { Vda5050RobotDriver } from "../vda5050/vda5050Driver";
import { dispatchRobotJob } from "./robotCommandDispatcher";
import { createV1Router } from "../../api/v1/router";

const DB_URL = process.env.DATABASE_URL;
const ROBOT = ROBOT_ID_HOISTED.id;
const MACHINE = MACHINE_ID_HOISTED.id;
const DAU = `R1CM-${Date.now()}`;
const OWNER = 990_730_101;
const EVIL_ORDER = {
  orderId: `${DAU}-evil`,
  orderUpdateId: 0,
  nodes: [{ nodeId: "far", sequenceId: 0, released: true, nodePosition: { x: 99, y: 99, mapId: "m" }, actions: [] }],
  edges: [],
};

let server: Server;
let base = "";

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}
function makeVdaDriver() {
  const drv = new Vda5050RobotDriver();
  Object.assign(drv as unknown as Record<string, unknown>, {
    connected: true,
    manufacturer: "acme",
    serialNumber: "sn-r1cm",
    interfaceName: "uagv",
    client: {
      on: () => undefined,
      subscribe: () => undefined,
      publish: (topic: string, payload: string, _o: unknown, cb?: (e?: Error | null) => void) => {
        broker.published.push({ topic, payload: JSON.parse(payload) });
        cb?.(null);
      },
      end: (_f?: boolean, _o?: unknown, cb?: () => void) => cb?.(),
      connected: true,
    },
  });
  return drv;
}
const orders = () => broker.published.filter((p) => /\/order$/.test(p.topic));
const instants = () => broker.published.filter((p) => /\/instantActions$/.test(p.topic));

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_CONTROL_TIMEOUT_MS", "FIELD_V2_ENABLED", "SEC_PLATFORM", "EVENT_WEBHOOKS_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("R-1C-m — run_job abort mang order KHÔNG BAO GIỜ tới broker thành order (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    const app = express();
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const db = await d();
    await db.delete(aiPendingActions).where(and(eq(aiPendingActions.userId, OWNER), like(aiPendingActions.summary, "FOE orchestration: step s-%")));
    try {
      await db.delete(robotJobs).where(eq(robotJobs.robotId, ROBOT));
    } catch {
      /* robot_jobs có thể append-only với role ứng dụng */
    }
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    broker.published.length = 0;
    broker.driver = makeVdaDriver();
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    delete process.env.FIELD_V2_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.EVENT_WEBHOOKS_ENABLED;
  });

  it("★ dispatcher (hình dạng hitl của REST cũ: requestedBy 0, actionId không tồn tại) run_job {jobType:'abort', params:{order}} ⇒ broker nhận CHỈ instantActions [cancelOrder, startPause], 0 order; STOP tới nơi; sổ không mang order", async () => {
    const r = await dispatchRobotJob({
      robotId: ROBOT,
      job: { jobType: "abort", params: { order: EVIL_ORDER, x: 99, y: 99 } as never },
      triggerKind: "hitl",
      actionId: `${DAU}-api`,
      requestedBy: 0,
      idempotencyKey: `${DAU}-api`,
    });
    // Thứ tự khẳng định = thứ tự quan trọng: 0 order TRƯỚC (bất biến an toàn), rồi STOP tới nơi, rồi trạng thái.
    expect(orders()).toHaveLength(0);
    expect(instants()).toHaveLength(1);
    expect(r.status).toBe("done");
    expect(instants()[0].payload.actions.map((a: any) => a.actionType)).toEqual(["cancelOrder", "startPause"]);
    const [row] = await (await d()).select().from(robotJobs).where(eq(robotJobs.id, r.jobId!)).limit(1);
    expect(row.jobType).toBe("abort");
    expect(row.params).toEqual({});
    expect(row.result).toMatchObject({ ignoredParams: true });
    expect(JSON.stringify(row)).not.toContain(`${DAU}-evil`);
  });

  it("★ FOE bước run_job {jobType:'abort', params:{order}} ⇒ cũng CHỈ instantActions, 0 order", async () => {
    const { buildEquipmentCommand, ensureOrchestrationAction } = await import("../orchestration/foe/foeEngine");
    const { getCapabilitiesForMachine } = await import("../equipment/capabilityModel");
    const { equipmentRegistry } = await import("../equipment/equipmentAdapter");
    const cap = getCapabilitiesForMachine({ machineType: "ROBOT", capabilities: null } as any);
    const descriptor = cap.supportedCommands.find((c) => c.name === "run_job")!;
    const key = `${DAU}-foe`;
    const args = { robotId: ROBOT, jobType: "abort", params: { order: EVIL_ORDER } };
    const user = { id: OWNER, role: "engineer" };
    const cmd = buildEquipmentCommand(descriptor, cap, MACHINE, args, key, user);
    await ensureOrchestrationAction(user, key, { id: "s-runjob-abort", type: "command" } as any, args, cmd);
    const r = await equipmentRegistry.getAdapter(cap.adapterKind).sendCommand(cmd);
    expect(orders()).toHaveLength(0);
    expect(instants()).toHaveLength(1);
    expect(r.status).toBe("done");
    expect(instants()[0].payload.actions.map((a: any) => a.actionType)).toEqual(["cancelOrder", "startPause"]);
  });

  it("đối chứng: run_job move (chuyển động) KHÔNG đi đường dừng — dispatcher (hitl không xác nhận, như REST cũ) ⇒ từ chối, 0 tin broker", async () => {
    const r = await dispatchRobotJob({
      robotId: ROBOT,
      job: { jobType: "move", params: { order: EVIL_ORDER } as never },
      triggerKind: "hitl",
      actionId: `${DAU}-move`,
      requestedBy: 0,
      idempotencyKey: `${DAU}-move`,
    });
    expect(r.status).toBe("rejected"); // không có hành động HITL đã xác nhận ⇒ chuyển động bị từ chối
    expect(broker.published).toHaveLength(0);
  });

  it("★ MỚI (C0-1): REST v1 run_job abort / move ⇒ 410 gone; broker KHÔNG nhận tin nào (không còn đường REST tới driver)", async () => {
    for (const jobType of ["abort", "move"]) {
      const res = await fetch(`${base}/api/v1/equipment/${MACHINE}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer MASTER" },
        body: JSON.stringify({ command: "run_job", args: { robotId: ROBOT, jobType, params: { order: EVIL_ORDER } }, idempotencyKey: `${DAU}-gone-${jobType}` }),
      });
      expect(res.status, jobType).toBe(410);
    }
    expect(broker.published).toHaveLength(0);
  });
});
