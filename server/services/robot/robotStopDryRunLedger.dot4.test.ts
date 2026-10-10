/**
 * doc 81 Đợt 4 Task B2 — hàng sổ 'simulated' của một STOP có HẠN GIỜ.
 *
 * Hai chỗ dispatcher ghi `record(…, "simulated")` — cổng chế độ (dry-run, ROBOT_CONTROL_ENABLED tắt) và cổng
 * commissioning (robot ĐÃ BIẾT chưa commissioned) — từng `await` thẳng lần ghi CSDL. Mọi bước CSDL khác của STOP đã
 * có hạn ROBOT_STOP_DB_STEP_DEADLINE_MS (R-1C-h); hai lần ghi này thì không ⇒ CSDL treo = STOP treo vô hạn (người
 * vận hành bấm dừng mà không có trả lời). Sau: với STOP, lần ghi chạy dưới cùng hạn; hết hạn/lỗi ⇒ vẫn trả
 * 'simulated' (STOP không gửi gì trong dry-run — đúng như cũ), `ledgerError` nói thật, có log.
 * Chuyển động giữ nguyên (không thêm hạn ở đây — ngoài phạm vi; ca cuối chỉ ghi nhận điều đó).
 *
 * CSDL giả trong tiến trình: chỉ lần INSERT status 'simulated' bị treo (hoặc getDb treo toàn bộ). Treo được đo bằng
 * hạn giờ tường minh (`within`), KHÔNG dựa vào timeout của vitest.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
// doc 81 Đợt 4 final wave R-4-x — this suite does not measure the motion "robot enabled" gate (robotEnabledGate.dot4.test.ts does).
vi.mock("./robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));

type Row = Record<string, any>;
const S = vi.hoisted(() => ({
  mode: "ok" as "ok" | "hang-simulated" | "throw-simulated" | "hang-getdb",
  rows: [] as Record<string, any>[],
  seq: 1,
  jobs: [] as string[],
}));
const NEVER = () => new Promise<never>(() => undefined);

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: any, val: any) => ({ __k: col?.__name, __v: val }), and: (...p: any[]) => ({ __and: p }) };
});
function makeFakeDb() {
  return {
    select: () => ({
      from: () => ({
        // isRobotCommissioned awaits .where(...) directly ⇒ [] = NOT commissioned (known answer, not a DB failure)
        where: () => ({ limit: async () => [], then: (res: any, rej: any) => Promise.resolve([] as Row[]).then(res, rej) }),
      }),
    }),
    insert: () => ({
      values: (vals: Row) => ({
        returning: () => {
          if (vals.status === "simulated" && S.mode === "hang-simulated") return NEVER();
          if (vals.status === "simulated" && S.mode === "throw-simulated") return Promise.reject(new Error("simulated DB fault (postgres://app:SECRETPW@db/x)"));
          const row = { id: S.seq++, ...vals };
          S.rows.push(row);
          return Promise.resolve([{ id: row.id }]);
        },
      }),
    }),
    update: () => ({ set: () => ({ where: () => Object.assign(Promise.resolve(), { returning: async () => [] }) }) }),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(makeFakeDb()),
  };
}
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(() => (S.mode === "hang-getdb" ? NEVER() : Promise.resolve(makeFakeDb()))),
}));
vi.mock("../../../drizzle/schema", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  robotJobs: { __table: "robot_jobs", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" }, robotId: { __name: "robotId" }, jobType: { __name: "jobType" } },
  robots: { __table: "robots", id: { __name: "id" }, kind: { __name: "kind" } },
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
            runJob: async (job: { jobType: string }) => {
              S.jobs.push(job.jobType);
              return { ok: true, status: "done", detail: {} };
            },
            abort: async () => undefined,
          },
        }
      : undefined,
}));
vi.mock("../interlock/interlockGate", () => ({ evaluateInterlockGate: async () => ({ blocked: false, failClosed: false, violations: [] }) }));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: "" }) }),
}));

import { dispatchRobotJob, ROBOT_STOP_DB_STEP_DEADLINE_MS } from "./robotCommandDispatcher";

/** Explicit bounded timer: rejects if `p` is still pending after `ms` (never relies on the vitest timeout). */
async function within<T>(p: Promise<T>, ms: number): Promise<{ value: T; elapsed: number }> {
  const t0 = Date.now();
  let t: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`still pending after ${ms}ms`)), ms);
  });
  try {
    const value = await Promise.race([p, guard]);
    return { value, elapsed: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}
/** The STOP's answer must come within its one DB-step deadline plus scheduling slack. */
const BOUND_MS = ROBOT_STOP_DB_STEP_DEADLINE_MS + 300;

const STOP = { robotId: 7, job: { jobType: "abort" as const, params: {} }, triggerKind: "hitl" as const, requestedBy: 3 };
const MOTION = { robotId: 7, job: { jobType: "home" as const, params: {} }, triggerKind: "manual" as const, requestedBy: 3, confirmedBy: 3 };

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "FIELD_V2_ENABLED", "SEC_PLATFORM", "ROBOT_SAFETY_PREFLIGHT_ENABLED"] as const;
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
  S.mode = "ok";
  S.rows.length = 0;
  S.seq = 1;
  S.jobs.length = 0;
  delete process.env.ROBOT_CONTROL_ENABLED; // dry-run
  delete process.env.ROBOT_COMMISSIONING_REQUIRED;
  delete process.env.FIELD_V2_ENABLED;
  delete process.env.SEC_PLATFORM;
  delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
  errSpy?.mockRestore();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("B2 — dry-run STOP ledger is bounded", () => {
  it("healthy DB: dry-run STOP ⇒ simulated, row written, no ledgerError (unchanged)", async () => {
    const { value: r } = await within(dispatchRobotJob(STOP), BOUND_MS);
    expect(r).toMatchObject({ ok: true, status: "simulated" });
    expect(r.jobId).toBe(S.rows[0]?.id);
    expect(r.ledgerError).toBeUndefined();
    expect(S.rows[0]).toMatchObject({ status: "simulated", jobType: "abort" });
  });

  it("★ the 'simulated' insert HANGS ⇒ dry-run STOP still answers within the deadline, ledgerError, logged", async () => {
    S.mode = "hang-simulated";
    const { value: r, elapsed } = await within(dispatchRobotJob(STOP), BOUND_MS);
    expect(r).toMatchObject({ ok: true, status: "simulated", ledgerError: "LEDGER_WRITE_FAILED" });
    expect(r.jobId).toBeUndefined();
    expect(elapsed).toBeGreaterThanOrEqual(ROBOT_STOP_DB_STEP_DEADLINE_MS - 50); // it did wait for the deadline, not skip the write
    expect(S.jobs).toEqual([]); // dry-run: nothing sent, as before
    expect(errSpy.mock.calls.flat().join(" ")).toMatch(/simulated ledger/i);
  });

  it("★ getDb() itself hangs ⇒ dry-run STOP still answers within the deadline", async () => {
    S.mode = "hang-getdb";
    const { value: r } = await within(dispatchRobotJob(STOP), BOUND_MS);
    expect(r).toMatchObject({ ok: true, status: "simulated", ledgerError: "LEDGER_WRITE_FAILED" });
  });

  it("the 'simulated' insert THROWS ⇒ dry-run STOP answers simulated (no throw), secret masked in the log", async () => {
    S.mode = "throw-simulated";
    const { value: r } = await within(dispatchRobotJob(STOP), BOUND_MS);
    expect(r).toMatchObject({ ok: true, status: "simulated", ledgerError: "LEDGER_WRITE_FAILED" });
    const logged = errSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("SECRETPW");
  });

  it("★ control ON, robot KNOWN not commissioned, 'simulated' insert HANGS ⇒ STOP answers within the deadline", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true"; // commissioning required by default; fake DB answers [] = not commissioned
    S.mode = "hang-simulated";
    const { value: r } = await within(dispatchRobotJob(STOP), BOUND_MS);
    expect(r).toMatchObject({ ok: true, status: "simulated", ledgerError: "LEDGER_WRITE_FAILED" });
    expect(S.jobs).toEqual([]); // R-1C-d: a STOP to a robot KNOWN uncommissioned stays simulated
  });

  it("motion is untouched: dry-run motion with a hanging insert is NOT given a deadline here (still pending)", async () => {
    S.mode = "hang-simulated";
    await expect(within(dispatchRobotJob(MOTION), BOUND_MS)).rejects.toThrow(/still pending/);
  });
});
