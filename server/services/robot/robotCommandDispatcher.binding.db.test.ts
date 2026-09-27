/**
 * doc 81 Đợt 1B final wave (item 2) — ROBOT dispatcher: HITL GẮN ĐÚNG LỆNH + tiêu thụ MỘT LẦN.
 *
 * Lỗi được ghim (Task 6 PARKED, final review (b)): bước 2.b của robot dispatcher chấp nhận bản ghi
 * `executed` hoặc `confirmed` + đúng owner — KHÔNG gắn với robot/job/params nào, KHÔNG tiêu thụ ⇒ một
 * bản ghi "đã dùng" (594 hàng AI-coding) mở được mọi chuyển động thật. Sửa: trên đường chạy THẬT,
 * bản ghi phải `confirmed`, chưa hết hạn, đúng owner, mang `robotPayloadHash(robotId, jobType, params)`
 * (cùng canonical form của Task 6, cùng trường previewJson), và bị CAS confirmed→executed dưới
 * SELECT … FOR UPDATE trong CÙNG giao dịch với hàng `running` (mẫu commandDispatcher.reserveRealWrite).
 *
 * CSDL THẬT (`_test`, vitest.setup ép DATABASE_URL) — FOR UPDATE / CAS chỉ kiểm được trên Postgres thật.
 * Thiết bị = driver giả trong tiến trình ĐẾM `runJob` (oracle độc lập: robot bị lệnh mấy lần) và trễ
 * 60 ms để hai lượt song song chắc chắn chồng nhau. Facade an toàn THẬT; nguồn PLC nền giả trả OK.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";

const rt = vi.hoisted(() => ({ runJobCalls: 0, jobs: [] as unknown[] }));

vi.mock("./robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === ROBOT_ID_HOISTED.id
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            runJob: async (job: unknown) => {
              rt.runJobCalls++;
              rt.jobs.push(job);
              await new Promise((r) => setTimeout(r, 60));
              return { ok: true, status: "done", detail: { fake: true } };
            },
            abort: async () => undefined,
            health: async () => ({ vendor: "sim", connected: true }),
          },
        }
      : undefined,
}));
const ROBOT_ID_HOISTED = vi.hoisted(() => ({ id: 990_700_000 + (Date.now() % 9_000) }));

// Nguồn đọc nền của facade an toàn THẬT: PLC sạch ⇒ OK.
vi.mock("../safety/plc/safetyPlcAdapter", () => ({
  safetyPlcAdapterEnabled: () => true,
  listPlcConfigs: async () => [{ code: "SPLC-1" }],
  backendForConfig: () => ({ read: async () => ({ estop: false }) }),
  statusToFindings: () => [],
}));

import { getDb } from "../../db/connection";
import { aiPendingActions, robotJobs } from "../../../drizzle/schema";
import { dispatchRobotJob, ROBOT_MOTION_IN_PROGRESS, type RobotDispatchInput } from "./robotCommandDispatcher";
import { robotPayloadHash, withOtPayloadHash, readOtPayloadHash } from "../ot/otActionBinding";

const DB_URL = process.env.DATABASE_URL;
const ROBOT = ROBOT_ID_HOISTED.id;
const DAU = `FWR2-${Date.now()}`;
const OWNER = 990_700_101;
const OTHER = 990_700_102;
let seq = 0;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

/** Bản ghi ủy quyền robot đúng như producer (FOE) lưu: cùng helper, cùng trường previewJson. */
async function makeAction(opts: {
  status?: "confirmed" | "executed" | "proposed";
  userId?: number;
  bind?: { robotId?: number; jobType?: string; params?: Record<string, unknown> | null } | null;
  expiresInMs?: number;
}): Promise<string> {
  const id = `${DAU}-act-${++seq}`;
  const b = opts.bind === undefined ? {} : opts.bind;
  const previewJson =
    b === null
      ? { note: "no binding (AI-coding shaped row)" }
      : withOtPayloadHash(
          null,
          robotPayloadHash({ robotId: b.robotId ?? ROBOT, jobType: b.jobType ?? "home", params: b.params === undefined ? {} : b.params }),
        );
  await (await d()).insert(aiPendingActions).values({
    id,
    tool: "foe.orchestration",
    argsJson: {},
    userId: opts.userId ?? OWNER,
    userRole: "engineer",
    summary: `${DAU} robot test action`,
    previewJson,
    status: opts.status ?? "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 600_000)),
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

async function pendingStatus(id: string) {
  const [row] = await (await d()).select().from(aiPendingActions).where(eq(aiPendingActions.id, id)).limit(1);
  return row?.status;
}
async function jobsOf(status?: string) {
  const rows = await (await d()).select().from(robotJobs).where(eq(robotJobs.robotId, ROBOT));
  return status ? rows.filter((r) => r.status === status) : rows;
}

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_CONTROL_TIMEOUT_MS", "FIELD_V2_ENABLED", "SEC_PLATFORM", "ROBOT_SAFETY_PREFLIGHT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("robot dispatcher — HITL binding + single-use consume (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    await import("../ot/adapterFacade");
  }, 60_000);

  afterAll(async () => {
    const db = await d();
    await db.delete(aiPendingActions).where(like(aiPendingActions.id, `${DAU}%`));
    await db.delete(aiPendingActions).where(and(eq(aiPendingActions.userId, OWNER), like(aiPendingActions.summary, "FOE orchestration:%")));
    try {
      await db.delete(robotJobs).where(eq(robotJobs.robotId, ROBOT));
    } catch {
      /* robot_jobs may be append-only for the app role; rows carry a unique test robotId */
    }
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    rt.runJobCalls = 0;
    rt.jobs.length = 0;
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    delete process.env.FIELD_V2_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
  });

  it("★ đường hợp lệ: bản ghi confirmed gắn đúng (robotId, jobType, params) ⇒ chạy ĐÚNG MỘT lần, bản ghi thành executed, hàng running→done", async () => {
    const actionId = await makeAction({});
    const r = await dispatchRobotJob(input({ actionId }));
    expect(r.status).toBe("done");
    expect(r.ok).toBe(true);
    expect(rt.runJobCalls).toBe(1);
    expect(await pendingStatus(actionId)).toBe("executed");
    // Dùng lại bản ghi vừa tiêu thụ ⇒ từ chối, robot không bị lệnh lần hai.
    const again = await dispatchRobotJob(input({ actionId }));
    expect(again.status).toBe("rejected");
    expect(again.error).toBe("NOT_CONFIRMED");
    expect(rt.runJobCalls).toBe(1);
  });

  it("sai robot ⇒ ACTION_BINDING_MISMATCH, 0 lần runJob, bản ghi VẪN confirmed (không bị đốt)", async () => {
    const actionId = await makeAction({ bind: { robotId: ROBOT + 1 } });
    const r = await dispatchRobotJob(input({ actionId }));
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("ACTION_BINDING_MISMATCH");
    expect(rt.runJobCalls).toBe(0);
    expect(await pendingStatus(actionId)).toBe("confirmed");
  });

  it("sai params (đã xác nhận {x:1}, lệnh gửi {}) ⇒ ACTION_BINDING_MISMATCH; cùng params ⇒ qua", async () => {
    const a1 = await makeAction({ bind: { params: { x: 1 } } });
    const r1 = await dispatchRobotJob(input({ actionId: a1 }));
    expect(r1.error).toBe("ACTION_BINDING_MISMATCH");
    expect(rt.runJobCalls).toBe(0);
    const r2 = await dispatchRobotJob(input({ actionId: a1, job: { jobType: "home", params: { x: 1 } } }));
    expect(r2.status).toBe("done");
    expect(rt.runJobCalls).toBe(1);
  });

  it("bản ghi executed (đã dùng) dù gắn đúng ⇒ NOT_CONFIRMED, 0 lần runJob", async () => {
    const actionId = await makeAction({ status: "executed" });
    const r = await dispatchRobotJob(input({ actionId }));
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("NOT_CONFIRMED");
    expect(rt.runJobCalls).toBe(0);
  });

  it("bản ghi confirmed nhưng KHÔNG mang hash (hình dạng AI-coding) ⇒ ACTION_BINDING_MISMATCH", async () => {
    const actionId = await makeAction({ bind: null });
    const r = await dispatchRobotJob(input({ actionId }));
    expect(r.error).toBe("ACTION_BINDING_MISMATCH");
    expect(rt.runJobCalls).toBe(0);
  });

  it("sai owner (confirmedBy ≠ userId của bản ghi) ⇒ NOT_CONFIRMED ngay ở cổng vào", async () => {
    const actionId = await makeAction({ userId: OTHER });
    const r = await dispatchRobotJob(input({ actionId }));
    expect(r.error).toBe("NOT_CONFIRMED");
    expect(rt.runJobCalls).toBe(0);
  });

  it("không actionId: manual với confirmedBy===requestedBy vẫn chạy (R11), manual với người xác nhận khác ⇒ MANUAL_CONFIRMER_MISMATCH; nhãn 'hitl' không actionId giữ hợp đồng Task 5 (chạy — CÒN MỞ, xem báo cáo)", async () => {
    const m = await dispatchRobotJob(input({ actionId: undefined, triggerKind: "manual" }));
    expect(m.status).toBe("done");
    expect(rt.runJobCalls).toBe(1);
    const m2 = await dispatchRobotJob(input({ actionId: undefined, triggerKind: "manual", confirmedBy: OTHER }));
    expect(m2.error).toBe("MANUAL_CONFIRMER_MISMATCH");
    expect(rt.runJobCalls).toBe(1);
    // Hợp đồng hiện hành (vendors/policy test của Task 5 ghim): 'hitl' + confirmedBy, không actionId ⇒ chạy.
    const h = await dispatchRobotJob(input({ actionId: undefined }));
    expect(h.status).toBe("done");
    expect(rt.runJobCalls).toBe(2);
  });

  it("★ hai lượt song song với CÙNG bản ghi confirmed ⇒ đúng MỘT lượt chạy (CAS dưới FOR UPDATE / slot R14), bản ghi executed", async () => {
    const actionId = await makeAction({});
    const [a, b] = await Promise.all([dispatchRobotJob(input({ actionId })), dispatchRobotJob(input({ actionId }))]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["done", "rejected"]);
    const rejected = a.status === "rejected" ? a : b;
    expect(["NOT_CONFIRMED", ROBOT_MOTION_IN_PROGRESS]).toContain(rejected.error);
    expect(rt.runJobCalls).toBe(1);
    expect(await pendingStatus(actionId)).toBe("executed");
  });

  it("đường dry-run KHÔNG đổi: ROBOT_CONTROL_ENABLED=false + bản ghi executed đúng owner ⇒ simulated (kiểm cũ ở cổng vào giữ nguyên), không tiêu thụ gì", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "false";
    const actionId = await makeAction({ status: "executed" });
    const r = await dispatchRobotJob(input({ actionId }));
    expect(r.status).toBe("simulated");
    expect(rt.runJobCalls).toBe(0);
  });

  it("★ R4 — hàng FOE tạo cho lệnh robot mang ĐÚNG hash và ở trạng thái confirmed ⇒ bước FOE qua cổng thật", async () => {
    const { ensureOrchestrationAction } = await import("../orchestration/foe/foeEngine");
    const { toRobotJob } = await import("../equipment/robotJobMapping");
    const key = `${DAU}-foe-${++seq}`;
    const cmd = {
      name: "home",
      robotId: ROBOT,
      machineId: null,
      idempotencyKey: key,
      hitl: { actionId: "x", requestedBy: OWNER, confirmedBy: OWNER },
    };
    await ensureOrchestrationAction({ id: OWNER, role: "engineer", name: "t" }, key, { id: "s-robot", type: "command" } as any, {}, cmd as any);
    const [row] = await (await d())
      .select()
      .from(aiPendingActions)
      .where(and(eq(aiPendingActions.userId, OWNER), eq(aiPendingActions.summary, "FOE orchestration: step s-robot")))
      .limit(1);
    expect(row).toBeDefined();
    expect(row!.status).toBe("confirmed");
    const job = toRobotJob(cmd as any);
    expect(readOtPayloadHash(row!.previewJson)).toBe(robotPayloadHash({ robotId: ROBOT, jobType: job.jobType, params: job.params ?? null }));
    // Chính hàng ấy đi qua dispatcher như RobotEquipmentAdapter.sendCommand gọi.
    const r = await dispatchRobotJob({ robotId: ROBOT, job, triggerKind: "hitl", actionId: row!.id, requestedBy: OWNER, confirmedBy: OWNER, idempotencyKey: key });
    expect(r.status).toBe("done");
    expect(rt.runJobCalls).toBe(1);
    expect(await pendingStatus(row!.id)).toBe("executed");
  });

  it("sổ robot_jobs: mỗi lượt bị từ chối vì binding có hàng rejected mang mã lý do", async () => {
    const before = (await jobsOf("rejected")).length;
    const actionId = await makeAction({ bind: null });
    await dispatchRobotJob(input({ actionId }));
    const after = await jobsOf("rejected");
    expect(after.length).toBe(before + 1);
    const last = after[after.length - 1];
    expect(last.errorText).toMatch(/^ACTION_BINDING_MISMATCH/);
  });
});
