/**
 * doc 81 Đợt 1C final wave 5 (final review M1) — audit "stop_policy_override" chạy SAU finalize và KHÔNG được chờ
 * trên đường trả lời của STOP.
 *
 * Trước bản vá: `recordAuditEvent` (dưới SEC_PLATFORM lấy advisory lock chuỗi băm toàn cục, không hạn giờ) được
 * `await` TRƯỚC finalize ⇒ (a) người gọi/UI chờ theo khoá dùng chung với mọi audit điều khiển; (b) hàng sổ của một
 * STOP ĐÃ GỬI nằm 'running' suốt lúc đó (khởi động lại ⇒ bị quét thành outcome-unknown).
 * CSDL giả trong tiến trình; audit giả điều khiển được (treo / ném / ghi thứ tự). Oracle: thứ tự sự kiện thật.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

type Row = Record<string, any>;
const S = vi.hoisted(() => ({
  rows: [] as Record<string, any>[],
  seq: 1,
  events: [] as string[],
  audit: "ok" as "ok" | "hang" | "throw",
  auditCalls: [] as any[],
}));

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
          S.events.push(`finalize:${vals.status}`);
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
vi.mock("../../db/auth", () => ({ getUserById: async (id: number) => ({ id, role: "engineer" }) }));
vi.mock("./robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === 7
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            getMotionLock: () => ({ locked: false }),
            runJob: async (job: { jobType: string }) => {
              S.events.push(`driver:${job.jobType}`);
              return { ok: true, status: "done", detail: {} };
            },
            abort: async () => undefined,
          },
        }
      : undefined,
}));
vi.mock("../interlock/interlockGate", () => ({ evaluateInterlockGate: async () => ({ blocked: false, failClosed: false, violations: [] }) }));
vi.mock("../ot/adapterFacade", () => ({ createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: "" }) }) }));
vi.mock("../security/policyGate", () => ({
  secPlatformEnabled: () => true,
  evaluateActionPolicy: () => ({ allow: false, effect: "deny", reason: "stop cấm", policyId: "p-deny", reasonCode: "POLICY_DENIED", obligations: [] }),
}));
vi.mock("../audit/controlAuditService", () => ({
  recordAuditEvent: (_db: unknown, e: any) => {
    S.events.push("audit");
    S.auditCalls.push(e);
    if (S.audit === "hang") return new Promise(() => undefined); // advisory lock bị giữ mãi
    if (S.audit === "throw") return Promise.reject(new Error("audit chain lock failed"));
    return Promise.resolve({ id: 1 });
  },
}));

import { dispatchRobotJob } from "./robotCommandDispatcher";

async function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`still pending after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(t);
  }
}
const tick = () => new Promise((r) => setTimeout(r, 20));

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "FIELD_V2_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  S.rows.length = 0;
  S.seq = 1;
  S.events.length = 0;
  S.auditCalls.length = 0;
  S.audit = "ok";
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.FIELD_V2_ENABLED;
  errSpy?.mockRestore();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const STOP = { robotId: 7, job: { jobType: "abort" as const, params: {} }, triggerKind: "hitl" as const, requestedBy: 3 };

describe("M1 — audit override của STOP chạy SAU finalize, không chặn trả lời", () => {
  it("★ audit TREO (khoá chuỗi băm bị giữ) ⇒ STOP vẫn trả lời ngay, hàng sổ đã 'done' (không kẹt 'running')", async () => {
    S.audit = "hang";
    const r = await within(dispatchRobotJob(STOP), 3000);
    expect(r.status).toBe("done");
    expect(S.rows[0].status).toBe("done");
    expect(S.rows[0].result).toMatchObject({ policyOverride: { effect: "deny", ruling: "R-1C-c" } });
  });

  it("thứ tự: driver → finalize → audit (audit không bao giờ đứng trước sổ cuối)", async () => {
    const r = await within(dispatchRobotJob(STOP), 3000);
    expect(r.status).toBe("done");
    for (let i = 0; i < 50 && !S.events.includes("audit"); i++) await tick();
    expect(S.events).toEqual(["driver:abort", "finalize:done", "audit"]);
    expect(S.auditCalls[0]).toMatchObject({ entityType: "robot_job", entityId: r.jobId, action: "stop_policy_override" });
  });

  it("audit NÉM ⇒ STOP vẫn done; lỗi được ghi log", async () => {
    S.audit = "throw";
    const r = await within(dispatchRobotJob(STOP), 3000);
    expect(r.status).toBe("done");
    for (let i = 0; i < 50 && errSpy.mock.calls.length === 0; i++) await tick();
    expect(errSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toMatch(/audit of the STOP policy override failed/);
  });
});
