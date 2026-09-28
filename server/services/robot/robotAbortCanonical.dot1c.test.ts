/**
 * doc 81 Đợt 1C residual 1 — ruling R-1C-m, LỚP (a): dispatcher giao cho driver một job DỪNG CHUẨN, bỏ params của
 * người gọi.
 *
 * Lỗ: api/v1 `run_job {jobType:"abort", params:{order:{…}}}` (và FOE cùng hình dạng) là job KHÔNG chuyển động ⇒ miễn
 * mọi cổng chuyển động — nhưng params của người gọi đi nguyên tới driver. Driver VDA5050 bỏ qua jobType và phát
 * `params.order` như một ORDER ⇒ "abort" làm AGV CHẠY. Lớp (a): mọi job không chuyển động (abort / stop / e_stop — cùng
 * bộ phân loại `isMotionJob` mà các cổng dùng) tới driver dưới dạng `{ jobType: "abort", params: {} }`; sổ ghi
 * `ignoredParams: true` (KHÔNG BAO GIỜ ghi giá trị).
 *
 * Môi trường thù địch (safety BLOCKED, interlock vi phạm) để chứng minh stop/e_stop thật sự đi đường không chuyển động.
 * Oracle độc lập: driver giả ghi lại NGUYÊN job nó nhận.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

type Row = Record<string, any>;
const S = vi.hoisted(() => ({ rows: [] as Record<string, any>[], seq: 1, jobs: [] as any[] }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: any, val: any) => ({ __k: col?.__name, __v: val }), and: (...p: any[]) => ({ __and: p }) };
});
function makeFakeDb() {
  return {
    select: () => ({
      from: (t: any) => ({
        where: (pred: any) => {
          const rows = t?.__table === "robot_jobs" ? S.rows.filter((r) => pred?.__k && r[pred.__k] === pred.__v) : [];
          return { limit: async () => rows.slice(0, 1), then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej) };
        },
      }),
    }),
    insert: (t: any) => ({
      values: (vals: Row) => ({
        returning: async () => {
          const row = { id: S.seq++, ...vals };
          if (t?.__table === "robot_jobs") S.rows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
    update: (t: any) => ({
      set: (vals: Row) => ({
        where: async (pred: any) => {
          for (const r of t?.__table === "robot_jobs" ? S.rows : []) if (r[pred.__k] === pred.__v) Object.assign(r, vals);
        },
      }),
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../../drizzle/schema", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  robotJobs: { __table: "robot_jobs", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" }, robotId: { __name: "robotId" }, jobType: { __name: "jobType" } },
  robots: { __table: "robots", id: { __name: "id" } },
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" } },
}));
vi.mock("./robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === 7
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            getMotionLock: () => ({ locked: false }),
            runJob: async (job: any) => {
              S.jobs.push(structuredClone(job));
              return { ok: true, status: "done", detail: {} };
            },
            abort: async () => undefined,
          },
        }
      : undefined,
}));
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: async () => ({ blocked: true, failClosed: false, violations: [{ ruleId: 1, action: "block" }] }),
}));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "BLOCKED", source: "safety_plc:SPLC-1", ts: "" }) }),
}));

import { dispatchRobotJob, isMotionJob } from "./robotCommandDispatcher";

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "SEC_PLATFORM", "FIELD_V2_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  S.rows.length = 0;
  S.seq = 1;
  S.jobs.length = 0;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.SEC_PLATFORM;
  delete process.env.FIELD_V2_ENABLED;
});

const ORDER = { order: { orderId: "evil-1", nodes: [{ nodeId: "far", nodePosition: { x: 99, y: 99, mapId: "m" } }] }, joints: [90, 90, 90, 0, 0, 0], script: "movej(...)" };
const stopWith = (jobType: string, params: Record<string, unknown>) => ({
  robotId: 7,
  job: { jobType: jobType as never, params },
  triggerKind: "hitl" as const,
  requestedBy: 0,
});

describe("R-1C-m lớp (a) — job dừng tới driver ở dạng CHUẨN, không mang params của người gọi", () => {
  it("★ abort mang params.order/joints/script ⇒ driver nhận ĐÚNG { jobType: 'abort', params: {} }; sổ: params {} + ignoredParams true, không giá trị nào", async () => {
    const r = await dispatchRobotJob(stopWith("abort", ORDER));
    expect(r.status).toBe("done");
    expect(S.jobs).toEqual([{ jobType: "abort", params: {} }]);
    expect(S.rows).toHaveLength(1);
    expect(S.rows[0].jobType).toBe("abort");
    expect(S.rows[0].params).toEqual({});
    expect(S.rows[0].result).toMatchObject({ ignoredParams: true });
    expect(JSON.stringify(S.rows[0])).not.toMatch(/evil-1|movej|far/);
  });

  it.each(["stop", "e_stop", "E_STOP"])("jobType '%s' (run_job) là KHÔNG chuyển động ⇒ đi đường dừng dù safety BLOCKED + interlock vi phạm, tới driver là abort chuẩn", async (jt) => {
    expect(isMotionJob({ jobType: jt as never })).toBe(false);
    const r = await dispatchRobotJob(stopWith(jt, ORDER));
    expect(r.status).toBe("done");
    expect(S.jobs).toEqual([{ jobType: "abort", params: {} }]);
    expect(S.rows[0].jobType).toBe("abort");
  });

  it("abort KHÔNG params ⇒ không có cờ ignoredParams (hàng sổ như cũ)", async () => {
    const r = await dispatchRobotJob(stopWith("abort", {}));
    expect(r.status).toBe("done");
    expect(S.jobs).toEqual([{ jobType: "abort", params: {} }]);
    expect(S.rows[0].result?.ignoredParams).toBeUndefined();
  });

  it("dry-run: hàng 'simulated' cũng không mang giá trị params, có ignoredParams", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "false";
    const r = await dispatchRobotJob(stopWith("abort", ORDER));
    expect(r.status).toBe("simulated");
    expect(S.jobs).toEqual([]);
    expect(S.rows[0].params).toEqual({});
    expect(S.rows[0].result).toMatchObject({ ignoredParams: true });
  });

  it("chuyển động KHÔNG bị đụng: home giữ params (và bị cổng chặn như cũ trong môi trường thù địch)", async () => {
    expect(isMotionJob({ jobType: "home" })).toBe(true);
    expect(isMotionJob({ jobType: "custom" })).toBe(true);
    const r = await dispatchRobotJob({ robotId: 7, job: { jobType: "home", params: { speed: 5 } }, triggerKind: "manual", requestedBy: 3, confirmedBy: 3 });
    expect(r.status).toBe("rejected");
    expect(S.jobs).toEqual([]);
    expect(S.rows[0].params).toEqual({ speed: 5 });
  });
});
