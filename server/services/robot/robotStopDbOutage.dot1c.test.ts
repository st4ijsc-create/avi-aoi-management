/**
 * doc 81 Đợt 1C final wave 1 (ruling R-1C-h, final review I2) — lệnh DỪNG robot KHÔNG phụ thuộc CSDL.
 *
 * Trên đường KHÔNG chuyển động (STOP = job `abort`) có BỐN bước CSDL đứng trước `driver.runJob`:
 *   (1) tra idempotency  (2) isRobotCommissioned ở cổng 4a  (3) isRobotCommissioned lần hai trong khối policy
 *   (SEC_PLATFORM bật)  (4) ghi trước hàng sổ 'running'.
 * Trước bản vá: bất kỳ bước nào NÉM ⇒ STOP bị từ chối/ném; bất kỳ bước nào TREO ⇒ STOP treo theo CSDL.
 * Sau bản vá: mỗi bước có hạn ngắn; lỗi/hết hạn ⇒ STOP VẪN tới driver, sổ ghi best-effort SAU đó.
 * Chuyển động giữ fail-closed: cùng lỗi CSDL ⇒ chuyển động KHÔNG tới driver.
 *
 * CSDL giả trong tiến trình, tiêm lỗi theo TỪNG bước (ném / treo vĩnh viễn). Oracle độc lập: driver giả ghi lại
 * từng job nó thật sự nhận cùng mốc thời gian. Treo được đo bằng hạn giờ tường minh (`within`/`waitFor`), không
 * dựa vào timeout của vitest.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

type Row = Record<string, any>;
type Step = "idempotency" | "commissioned1" | "commissioned2" | "prewrite";

const S = vi.hoisted(() => ({
  fault: null as null | { step: "idempotency" | "commissioned1" | "commissioned2" | "prewrite" | "all"; mode: "throw" | "hang" },
  commissionedCalls: 0,
  jobs: [] as Array<{ jobType: string; at: number }>,
  rows: [] as Record<string, any>[],
  seq: 1,
  prewriteAttempts: 0,
}));

const NEVER = () => new Promise<never>(() => undefined);

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, val: any) => ({ __op: "eq", __k: col?.__name, __v: val }),
    and: (...preds: any[]) => ({ __op: "and", preds }),
  };
});

function tableName(t: any): string {
  if (t?.__table) return t.__table;
  // robot_commissioning_records là pgTable THẬT định nghĩa inline trong dispatcher.
  const sym = Object.getOwnPropertySymbols(t ?? {}).find((s) => String(s) === "Symbol(drizzle:Name)");
  return sym ? t[sym] : "?";
}

/** Áp lỗi đã tiêm cho `step` (hoặc cho mọi bước khi fault.step === "all"). */
function faulted<T>(step: Step, ok: () => T | Promise<T>): Promise<T> {
  const f = S.fault;
  if (f && (f.step === step || f.step === "all")) {
    if (f.mode === "hang") return NEVER();
    return Promise.reject(new Error(`simulated DB fault at ${step} (postgres://app:SECRETPW@db.internal:5432/x)`));
  }
  return Promise.resolve().then(ok);
}

function makeFakeDb() {
  return {
    select: (_sel?: any) => ({
      from: (t: any) => {
        const name = tableName(t);
        return {
          where: (pred: any) => ({
            // (1) tra idempotency: select().from(robot_jobs).where(...).limit(1)
            limit: (_n?: number) => {
              if (name === "robot_jobs") {
                return faulted("idempotency", () => S.rows.filter((r) => r.idempotencyKey === pred?.__v || (pred?.__op === "and" && pred.preds.every((p: any) => r[p.__k] === p.__v))).slice(0, 1));
              }
              return Promise.resolve([] as Row[]); // robots (vai trò) — rỗng
            },
            // (2)(3) isRobotCommissioned await-s .where(...) trực tiếp
            then: (res: any, rej: any) => {
              if (name !== "robot_commissioning_records") return Promise.resolve([] as Row[]).then(res, rej);
              S.commissionedCalls++;
              const step: Step = S.commissionedCalls === 1 ? "commissioned1" : "commissioned2";
              return faulted(step, () => [{ id: 1, robotId: 7, status: "active", expiresAt: null }]).then(res, rej);
            },
          }),
        };
      },
    }),
    insert: (t: any) => ({
      values: (vals: Row) => ({
        returning: (_sel?: any) => {
          const write = () => {
            const row = { id: S.seq++, ...vals };
            if (tableName(t) === "robot_jobs") S.rows.push(row);
            return [{ id: row.id }];
          };
          // (4) chỉ lần ghi TRƯỚC ('running') là bước bị tiêm lỗi; hàng cuối ghi SAU khi gửi STOP thì CSDL "đã hồi".
          if (tableName(t) === "robot_jobs" && vals.status === "running") {
            S.prewriteAttempts++;
            return faulted("prewrite", write);
          }
          if (S.fault?.step === "all") return faulted("prewrite", write);
          return Promise.resolve().then(write);
        },
      }),
    }),
    update: (t: any) => ({
      set: (vals: Row) => ({
        where: (pred: any) => {
          const hit = S.rows.filter((r) => tableName(t) === "robot_jobs" && r.id === pred?.__v);
          for (const r of hit) Object.assign(r, vals);
          return Object.assign(Promise.resolve(), { returning: async () => hit.map((r) => ({ id: r.id })) });
        },
      }),
    }),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(makeFakeDb()),
  };
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(() => (S.fault?.step === "all" && S.fault.mode === "hang" ? new Promise(() => undefined) : Promise.resolve(makeFakeDb()))),
}));
vi.mock("../../../drizzle/schema", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  robotJobs: {
    __table: "robot_jobs",
    id: { __name: "id" },
    idempotencyKey: { __name: "idempotencyKey" },
    robotId: { __name: "robotId" },
    jobType: { __name: "jobType" },
  },
  robots: { __table: "robots", id: { __name: "id" }, kind: { __name: "kind" } },
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
              S.jobs.push({ jobType: job.jobType, at: Date.now() });
              return { ok: true, status: "done", detail: {} };
            },
            abort: async () => undefined,
          },
        }
      : undefined,
}));
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: async () => ({ blocked: false, failClosed: false, violations: [] }),
}));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: "" }) }),
}));
// SEC_PLATFORM bật ⇒ bước (3) (isRobotCommissioned lần hai trong khối policy) được đi tới; verdict = allow.
vi.mock("../security/policyGate", () => ({
  secPlatformEnabled: () => true,
  evaluateActionPolicy: () => ({ allow: true, effect: "allow", reason: "ok", policyId: null, reasonCode: "DEFAULT_ALLOW", obligations: [] }),
}));

import { dispatchRobotJob } from "./robotCommandDispatcher";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
/** Đợi tới khi driver giả nhận ≥1 job, tối đa `ms`; trả mốc thời gian nhận (hoặc null). */
async function driverReachedWithin(ms: number): Promise<number | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (S.jobs.length > 0) return S.jobs[0].at;
    await sleep(10);
  }
  return S.jobs.length > 0 ? S.jobs[0].at : null;
}

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_CONTROL_TIMEOUT_MS", "FIELD_V2_ENABLED", "ROBOT_SAFETY_PREFLIGHT_ENABLED"] as const;
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
  S.fault = null;
  S.commissionedCalls = 0;
  S.jobs.length = 0;
  S.rows.length = 0;
  S.seq = 1;
  S.prewriteAttempts = 0;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  delete process.env.ROBOT_COMMISSIONING_REQUIRED; // mặc định BẬT ⇒ bước (2) được đi tới
  process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
  delete process.env.FIELD_V2_ENABLED;
  delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
  errSpy?.mockRestore();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const STOP = (key: string) => ({ robotId: 7, job: { jobType: "abort" as const, params: {} }, triggerKind: "hitl" as const, requestedBy: 3, idempotencyKey: key });
const MOTION = (key: string) => ({ robotId: 7, job: { jobType: "home" as const, params: {} }, triggerKind: "manual" as const, requestedBy: 3, confirmedBy: 3, idempotencyKey: key });

const STEPS: Step[] = ["idempotency", "commissioned1", "commissioned2", "prewrite"];

describe("đường hợp lệ (CSDL khoẻ) — không đổi", () => {
  it("STOP ⇒ driver nhận abort; sổ running → done; cả bốn bước CSDL đều được đi qua", async () => {
    const r = await within(dispatchRobotJob(STOP("ok-stop")), 5000);
    expect(r.status).toBe("done");
    expect(S.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    expect(S.commissionedCalls).toBe(2);
    expect(S.prewriteAttempts).toBe(1);
    expect(S.rows).toHaveLength(1);
    expect(S.rows[0]).toMatchObject({ id: r.jobId, status: "done", jobType: "abort" });
  });
  it("chuyển động ⇒ done như cũ", async () => {
    const r = await within(dispatchRobotJob(MOTION("ok-motion")), 5000);
    expect(r.status).toBe("done");
    expect(S.jobs.map((j) => j.jobType)).toEqual(["home"]);
  });
});

describe.each(STEPS)("bước CSDL `%s` hỏng (R-1C-h)", (step) => {
  it.each(["throw", "hang"] as const)("%s ⇒ STOP VẪN tới driver trong 3 s; sổ ghi best-effort; log không lộ bí mật", async (mode) => {
    S.fault = { step, mode };
    const t0 = Date.now();
    const p = dispatchRobotJob(STOP(`k-${step}-${mode}`));
    p.catch(() => undefined);
    const at = await driverReachedWithin(3000);
    expect(at, `STOP không tới driver trong 3 s khi ${step} ${mode}`).not.toBeNull();
    expect(at! - t0).toBeLessThan(3000);
    expect(S.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    const r = await within(p, 5000);
    expect(r.status).toBe("done");
    expect(r.ok).toBe(true);
    // Lỗi được ghi log (không nuốt im lặng) và không in mật khẩu trong chuỗi kết nối.
    const logged = errSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toMatch(/R-1C-h|STOP/);
    expect(logged).not.toMatch(/SECRETPW/);
    if (step !== "prewrite") {
      // Bước khác hỏng ⇒ hàng sổ vẫn có (ghi trước hoặc ghi sau), đúng MỘT hàng, trạng thái cuối done.
      expect(S.rows).toHaveLength(1);
      expect(S.rows[0]).toMatchObject({ jobType: "abort", status: "done" });
    } else if (mode === "throw") {
      // Ghi trước hỏng ⇒ hàng ghi SAU khi gửi (best-effort), đánh dấu ledgerDeferred.
      expect(S.rows).toHaveLength(1);
      expect(S.rows[0]).toMatchObject({ jobType: "abort", status: "done" });
      expect(S.rows[0].result).toMatchObject({ ledgerDeferred: true });
    }
  });

  it.each(["throw", "hang"] as const)("%s ⇒ CHUYỂN ĐỘNG vẫn fail-closed: không tới driver", async (mode) => {
    if (step === "commissioned2") S.fault = { step, mode };
    else S.fault = { step, mode };
    const p = dispatchRobotJob(MOTION(`m-${step}-${mode}`));
    const settled = await Promise.race([
      p.then(
        (r) => ({ kind: "result" as const, r }),
        (e) => ({ kind: "thrown" as const, e }),
      ),
      sleep(2000).then(() => ({ kind: "pending" as const })),
    ]);
    expect(S.jobs).toHaveLength(0);
    if (settled.kind === "result") {
      expect(settled.r.ok).toBe(false);
      expect(settled.r.status).toBe("rejected");
    }
    if (mode === "throw") expect(settled.kind).not.toBe("pending");
  });
});

describe("CSDL treo TOÀN BỘ (getDb không bao giờ trả về)", () => {
  it("STOP tới driver trong 3 s (một hạn giờ, các bước sau bị bỏ qua — không cộng dồn); chuyển động không", async () => {
    S.fault = { step: "all", mode: "hang" };
    const t0 = Date.now();
    const p = dispatchRobotJob(STOP("all-hang"));
    p.catch(() => undefined);
    const at = await driverReachedWithin(3000);
    expect(at).not.toBeNull();
    expect(at! - t0).toBeLessThan(3000);
    const r = await within(p, 5000);
    expect(r.status).toBe("done");
    expect(r.ledgerError).toBeTruthy(); // sổ không ghi được — nói thật
    S.jobs.length = 0;
    const m = dispatchRobotJob(MOTION("all-hang-m"));
    m.catch(() => undefined);
    await sleep(2000);
    expect(S.jobs).toHaveLength(0);
  });
  it("CSDL NÉM ở mọi bước ⇒ STOP tới driver; chuyển động bị từ chối/ném", async () => {
    S.fault = { step: "all", mode: "throw" };
    const r = await within(dispatchRobotJob(STOP("all-throw")), 5000);
    expect(r.status).toBe("done");
    expect(S.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    S.jobs.length = 0;
    const m = await within(
      dispatchRobotJob(MOTION("all-throw-m")).then(
        (x) => x,
        (e) => ({ ok: false, status: "thrown", e }),
      ),
      5000,
    );
    expect(m.ok).toBe(false);
    expect(S.jobs).toHaveLength(0);
  });
});
