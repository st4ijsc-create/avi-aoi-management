/**
 * doc 81 Đợt 1C final wave 2 (ruling R-1C-i, final review I3) — phát lại idempotency theo (robotId, key).
 *
 * Trước bản vá: tra `robot_jobs.idempotencyKey = K` KHÔNG kèm robotId ⇒ một STOP cho robot B mang khoá K đã
 * dùng cho robot A trả về kết quả CỦA A ("done") và KHÔNG gửi gì tới B — lệnh dừng bị nuốt, lại báo thành công.
 * Sau: chỉ phát lại khi cùng robot VÀ cùng loại job; khoá của robot khác / job khác ⇒ STOP vẫn được gửi (hàng sổ
 * bỏ khoá để khỏi va UNIQUE toàn cục), chuyển động bị từ chối IDEMPOTENCY_KEY_REUSED (không bao giờ "thành công" giả).
 * `fitLedgerKey`: dạng băm có tiền tố mà KHÔNG khoá nguyên văn nào giữ được sau khi qua hàm.
 *
 * CSDL giả trong tiến trình có ràng buộc UNIQUE(idempotencyKey) như bảng thật. Oracle độc lập: hai driver giả, mỗi
 * cái ghi lại job nó thật sự nhận.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
// doc 81 Đợt 4 final wave R-4-x — this suite does not measure the motion "robot enabled" gate (robotEnabledGate.dot4.test.ts does).
vi.mock("./robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));

type Row = Record<string, any>;
const S = vi.hoisted(() => ({ rows: [] as Record<string, any>[], seq: 1, jobs: { 7: [] as string[], 8: [] as string[] } as Record<number, string[]> }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, val: any) => ({ __op: "eq", __k: col?.__name, __v: val }),
    and: (...preds: any[]) => ({ __op: "and", preds }),
  };
});
function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "eq") return pred.__k === undefined ? true : row[pred.__k] === pred.__v;
  if (pred.__op === "and") return pred.preds.every((p: any) => matches(row, p));
  return true;
}
function makeFakeDb() {
  return {
    select: () => ({
      from: (t: any) => ({
        where: (pred: any) => {
          const rows = t?.__table === "robot_jobs" ? S.rows.filter((r) => matches(r, pred)) : [];
          return { limit: async () => rows.slice(0, 1), then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej) };
        },
      }),
    }),
    insert: (t: any) => ({
      values: (vals: Row) => ({
        returning: async () => {
          if (t?.__table === "robot_jobs" && vals.idempotencyKey != null && S.rows.some((r) => r.idempotencyKey === vals.idempotencyKey)) {
            // như Postgres: robot_jobs.idempotencyKey UNIQUE toàn cục
            throw new Error('duplicate key value violates unique constraint "robot_jobs_idempotencyKey_unique"');
          }
          const row = { id: S.seq++, ...vals };
          if (t?.__table === "robot_jobs") S.rows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
    update: (t: any) => ({
      set: (vals: Row) => ({
        where: async (pred: any) => {
          for (const r of t?.__table === "robot_jobs" ? S.rows : []) if (matches(r, pred)) Object.assign(r, vals);
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
    id === 7 || id === 8
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            getMotionLock: () => ({ locked: false }),
            runJob: async (job: { jobType: string }) => {
              S.jobs[id].push(job.jobType);
              return { ok: true, status: "done", detail: {} };
            },
            abort: async () => undefined,
          },
        }
      : undefined,
}));
vi.mock("../interlock/interlockGate", () => ({ evaluateInterlockGate: async () => ({ blocked: false, failClosed: false, violations: [] }) }));
vi.mock("../ot/adapterFacade", () => ({ createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: "" }) }) }));

import { dispatchRobotJob, fitLedgerKey, ROBOT_LEDGER_IDEMPOTENCY_KEY_MAX, ROBOT_LEDGER_ACTION_ID_MAX } from "./robotCommandDispatcher";

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
  S.jobs[7].length = 0;
  S.jobs[8].length = 0;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.SEC_PLATFORM;
  delete process.env.FIELD_V2_ENABLED;
});

const stop = (robotId: number, key: string) => ({ robotId, job: { jobType: "abort" as const, params: {} }, triggerKind: "hitl" as const, requestedBy: 3, idempotencyKey: key });
const home = (robotId: number, key: string) => ({ robotId, job: { jobType: "home" as const, params: {} }, triggerKind: "manual" as const, requestedBy: 3, confirmedBy: 3, idempotencyKey: key });

describe("R-1C-i — phát lại idempotency theo (robotId, key)", () => {
  it("★ khoá K đã dùng cho STOP robot A ⇒ STOP robot B mang K VẪN tới driver của B (không bị nuốt), có hàng sổ riêng", async () => {
    const a = await dispatchRobotJob(stop(7, "K"));
    expect(a.status).toBe("done");
    expect(S.jobs[7]).toEqual(["abort"]);
    const b = await dispatchRobotJob(stop(8, "K"));
    expect(b.status).toBe("done");
    expect(S.jobs[8]).toEqual(["abort"]); // oracle: driver B THẬT SỰ nhận lệnh dừng
    expect(b.jobId).toBeDefined();
    expect(b.jobId).not.toBe(a.jobId);
    const rowB = S.rows.find((r) => r.id === b.jobId)!;
    expect(rowB.robotId).toBe(8);
    expect(rowB.idempotencyKey ?? null).toBeNull(); // khoá thuộc robot khác ⇒ không ghi đè / không va UNIQUE
    expect(rowB.result).toMatchObject({ stopDb: { idempotencyKeyReused: { priorJobId: a.jobId } } });
  });

  it("cùng robot, cùng khoá, cùng lệnh ⇒ phát lại (không gửi lần hai)", async () => {
    const a = await dispatchRobotJob(stop(7, "K2"));
    const again = await dispatchRobotJob(stop(7, "K2"));
    expect(again).toEqual({ ok: true, status: "done", jobId: a.jobId });
    expect(S.jobs[7]).toEqual(["abort"]);
  });

  it("★ khoá K đã dùng cho CHUYỂN ĐỘNG trên cùng robot ⇒ STOP mang K không bị nuốt bởi kết quả chuyển động", async () => {
    const m = await dispatchRobotJob(home(7, "K3"));
    expect(m.status).toBe("done");
    const s = await dispatchRobotJob(stop(7, "K3"));
    expect(s.status).toBe("done");
    expect(S.jobs[7]).toEqual(["home", "abort"]);
    expect(s.jobId).not.toBe(m.jobId);
  });

  it("chuyển động mang khoá của robot khác ⇒ rejected IDEMPOTENCY_KEY_REUSED, 0 job, KHÔNG báo thành công giả", async () => {
    await dispatchRobotJob(stop(7, "K4"));
    const m = await dispatchRobotJob(home(8, "K4"));
    expect(m).toMatchObject({ ok: false, status: "rejected", error: "IDEMPOTENCY_KEY_REUSED" });
    expect(S.jobs[8]).toEqual([]);
    expect(S.rows.find((r) => r.id === m.jobId)?.status).toBe("rejected");
  });
});

describe("R-1C-i — fitLedgerKey: dạng băm có tiền tố không khoá nguyên văn nào giữ được", () => {
  it("khoá vừa cột và không mang tiền tố ⇒ giữ nguyên từng byte", () => {
    expect(fitLedgerKey("apiv1-abc", ROBOT_LEDGER_IDEMPOTENCY_KEY_MAX)).toBe("apiv1-abc");
  });
  it("khoá dài ⇒ băm, ≤ max, mang tiền tố dành riêng", () => {
    const long = "x".repeat(300);
    const f = fitLedgerKey(long, ROBOT_LEDGER_IDEMPOTENCY_KEY_MAX)!;
    expect(f.length).toBeLessThanOrEqual(ROBOT_LEDGER_IDEMPOTENCY_KEY_MAX);
    expect(f.startsWith("h-sha256-")).toBe(true);
    expect(fitLedgerKey(long, ROBOT_LEDGER_ACTION_ID_MAX)!.length).toBeLessThanOrEqual(ROBOT_LEDGER_ACTION_ID_MAX);
  });
  it("★ khoá NGUYÊN VĂN trùng đúng dạng băm của một khoá dài ⇒ KHÔNG còn va (khoá mang tiền tố cũng bị băm)", () => {
    const long = "y".repeat(200);
    const hashed = fitLedgerKey(long, ROBOT_LEDGER_IDEMPOTENCY_KEY_MAX)!;
    // Kẻ gọi chọn đúng chuỗi đó làm khoá (vừa cột): trước bản vá nó được giữ nguyên ⇒ trùng sổ của khoá dài.
    const literal = fitLedgerKey(hashed, ROBOT_LEDGER_IDEMPOTENCY_KEY_MAX)!;
    expect(literal).not.toBe(hashed);
    expect(literal.startsWith("h-sha256-")).toBe(true);
  });
  it("dispatcher: khoá nguyên văn mang tiền tố băm vẫn chạy và không trùng sổ của khoá dài tương ứng", async () => {
    const long = "z".repeat(200);
    const a = await dispatchRobotJob(stop(7, long));
    const hashed = S.rows.find((r) => r.id === a.jobId)!.idempotencyKey;
    const b = await dispatchRobotJob(stop(7, hashed));
    expect(b.jobId).not.toBe(a.jobId); // không phát lại nhầm lệnh của khoá dài
    expect(S.jobs[7]).toEqual(["abort", "abort"]);
  });
});

// doc 81 Đợt 1C residual 3 — thử lại một STOP cùng khoá sau lần HỎNG / BỊ TỪ CHỐI / CÒN CHẠY ⇒ GỬI LẠI (dừng giảm năng
// lượng, idempotent tại thiết bị); chỉ STOP đã 'done' mới được phát lại. Trước: phát lại kết quả cũ, robot không nhận gì.
describe("residual 3 — thử lại STOP cùng khoá", () => {
  it.each(["failed", "rejected", "running", "simulated"])("★ lần trước '%s' ⇒ STOP được GỬI LẠI tới driver, hàng sổ mới (không va UNIQUE), ghi lại lần trước", async (prior) => {
    S.rows.push({ id: 900, robotId: 7, jobType: "abort", idempotencyKey: `R3-${prior}`, status: prior });
    S.seq = 901;
    const r = await dispatchRobotJob(stop(7, `R3-${prior}`));
    expect(r.status).toBe("done");
    expect(r.jobId).not.toBe(900);
    expect(S.jobs[7]).toEqual(["abort"]);
    const row = S.rows.find((x) => x.id === r.jobId)!;
    expect(row.idempotencyKey ?? null).toBeNull();
    expect(row.result).toMatchObject({ stopDb: { stopRetryOf: { priorJobId: 900, priorStatus: prior } } });
    expect(row.result.stopDb.idempotencyKeyReused).toBeUndefined();
  });
  it("lần trước 'done' ⇒ vẫn PHÁT LẠI (không gửi lần hai)", async () => {
    S.rows.push({ id: 910, robotId: 7, jobType: "abort", idempotencyKey: "R3-done", status: "done" });
    const r = await dispatchRobotJob(stop(7, "R3-done"));
    expect(r).toEqual({ ok: true, status: "done", jobId: 910 });
    expect(S.jobs[7]).toEqual([]);
  });
  it("CHUYỂN ĐỘNG cùng khoá sau lần 'failed' ⇒ vẫn phát lại (không chạy lại mù) — chỉ STOP được gửi lại", async () => {
    S.rows.push({ id: 920, robotId: 7, jobType: "home", idempotencyKey: "R3-m", status: "failed" });
    const r = await dispatchRobotJob(home(7, "R3-m"));
    expect(r).toEqual({ ok: false, status: "failed", jobId: 920 });
    expect(S.jobs[7]).toEqual([]);
  });
});
