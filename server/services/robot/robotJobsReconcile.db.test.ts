/**
 * doc 81 Đợt 1B Task 5 fix round 1 (M1) — CSDL THẬT (_test, vitest.setup ép DATABASE_URL): quét lúc
 * khởi động đổi hàng robot_jobs 'running' mồ côi (tiến trình chết giữa hàng 'running' trước chuyển
 * động và lần chốt) thành 'failed' + process_restart_outcome_unknown; hàng 'running' còn mới KHÔNG bị
 * đụng; idempotency trả trạng thái đúng thay vì ép 'running' vào union.
 *
 * robot_jobs bị REVOKE DELETE với avi_app (0279) ⇒ KHÔNG xoá được hàng test. Chống nhân bản: hai khoá
 * probe ỔN ĐỊNH (idempotencyKey cố định, không timestamp/random) — insert nếu chưa có, rồi UPDATE về
 * trạng thái ban đầu mỗi lần chạy ⇒ cả đời lưới chỉ có tối đa 2 hàng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const KEY_OLD = "DBTEST-T5FR1-SWEEP-OLD";
const KEY_FRESH = "DBTEST-T5FR1-SWEEP-FRESH";
const PROBE_ROBOT = 990501;

let sql: ReturnType<typeof postgres>;

describe.skipIf(!DB_URL)("robot_jobs — quét 'running' mồ côi lúc khởi động (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    for (const key of [KEY_OLD, KEY_FRESH]) {
      await sql`
        INSERT INTO robot_jobs ("robotId", "jobType", status, "triggerKind", "idempotencyKey")
        SELECT ${PROBE_ROBOT}, 'home', 'running', 'hitl', ${key}
        WHERE NOT EXISTS (SELECT 1 FROM robot_jobs WHERE "idempotencyKey" = ${key})`;
    }
    await sql`
      UPDATE robot_jobs SET status = 'running', "errorText" = NULL, result = NULL, "completedAt" = NULL,
        "startedAt" = now() - interval '1 hour'
      WHERE "idempotencyKey" = ${KEY_OLD}`;
    await sql`
      UPDATE robot_jobs SET status = 'running', "errorText" = NULL, result = NULL, "completedAt" = NULL,
        "startedAt" = now()
      WHERE "idempotencyKey" = ${KEY_FRESH}`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("hàng 'running' cũ hơn ngưỡng ⇒ failed + process_restart_outcome_unknown; hàng mới giữ nguyên 'running'", async () => {
    const { reconcileOrphanedRobotJobs, PROCESS_RESTART_OUTCOME_UNKNOWN } = await import("./robotCommandDispatcher");
    const n = await reconcileOrphanedRobotJobs(10 * 60_000);
    expect(n).toBeGreaterThanOrEqual(1);
    const rows = await sql<{ key: string; status: string; errorText: string | null; completedAt: Date | null }[]>`
      SELECT "idempotencyKey" AS key, status, "errorText", "completedAt" FROM robot_jobs
      WHERE "idempotencyKey" IN (${KEY_OLD}, ${KEY_FRESH})`;
    const old = rows.find((r) => r.key === KEY_OLD)!;
    const fresh = rows.find((r) => r.key === KEY_FRESH)!;
    expect(old.status).toBe("failed");
    expect(old.errorText).toMatch(new RegExp(`^${PROCESS_RESTART_OUTCOME_UNKNOWN}`));
    expect(old.completedAt).not.toBeNull();
    expect(fresh.status).toBe("running");
  });

  it("idempotency trên CSDL thật: khoá còn 'running' ⇒ rejected IDEMPOTENT_JOB_IN_PROGRESS; khoá đã quét ⇒ failed", async () => {
    const { dispatchRobotJob } = await import("./robotCommandDispatcher");
    const base = { robotId: PROBE_ROBOT, job: { jobType: "home" as const }, triggerKind: "hitl" as const, requestedBy: 1, confirmedBy: 1 };
    const running = await dispatchRobotJob({ ...base, idempotencyKey: KEY_FRESH });
    expect(running.status).toBe("rejected");
    expect(running.error).toBe("IDEMPOTENT_JOB_IN_PROGRESS");
    const swept = await dispatchRobotJob({ ...base, idempotencyKey: KEY_OLD });
    expect(swept.status).toBe("failed");
    expect(swept.ok).toBe(false);
  });

  it("startRobots() gọi quét (kể cả khi gateway tắt)", async () => {
    await sql`UPDATE robot_jobs SET status = 'running', "startedAt" = now() - interval '2 hour' WHERE "idempotencyKey" = ${KEY_OLD}`;
    const saved = process.env.ROBOT_GATEWAY_ENABLED;
    delete process.env.ROBOT_GATEWAY_ENABLED;
    try {
      const { startRobots } = await import("./robotManager");
      expect(await startRobots()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.ROBOT_GATEWAY_ENABLED = saved;
    }
    const [row] = await sql<{ status: string }[]>`SELECT status FROM robot_jobs WHERE "idempotencyKey" = ${KEY_OLD}`;
    expect(row.status).toBe("failed");
  });
});
