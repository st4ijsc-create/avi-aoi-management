import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
let insertRejectError: unknown = null;
let selectRejectError: unknown = null;

const fakeDb = {
  insert: () => ({
    values: (v: any) => ({
      onConflictDoUpdate: ({ set }: any) => {
        if (insertRejectError) return Promise.reject(insertRejectError);
        const i = rows.findIndex((r) => r.sessionId === v.sessionId && r.userId === v.userId);
        if (i >= 0) rows[i] = { ...rows[i], ...set, ...v };
        else rows.push({ ...v });
        return Promise.resolve();
      },
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => (selectRejectError ? Promise.reject(selectRejectError) : Promise.resolve(rows)),
    }),
  }),
};
// LƯU Ý: server/db/aiSpecialist.ts import getDb từ "./connection" (KHÔNG phải "../db").
vi.mock("./connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { upsertSpecialistFeedback, getSpecialistQualityScoreboard } from "./aiSpecialist";

/**
 * Fix round 1 (IMPORTANT-1) — real shape a drizzle-orm >=0.44 query against an
 * unmigrated table produces: a "Failed query: ..." wrapper Error with `code: undefined`
 * at the top level, and the real postgres.js driver error (code 42P01) on `.cause`.
 * Mirrors server/services/aiKbFeedbackSignal.test.ts's wrappedMissingTableError() — this
 * is exactly the shape isMissingTable's cause-chain walk exists to catch (a naive
 * `(err as {code}).code === "42P01"` check would miss it, since the top-level code is
 * undefined here).
 */
function wrappedMissingTableError(): Error {
  const driverErr = Object.assign(
    new Error('relation "ai_specialist_feedback" does not exist'),
    { code: "42P01" },
  );
  const wrapped = new Error("Failed query: SELECT * FROM ai_specialist_feedback");
  (wrapped as Error & { cause: unknown }).cause = driverErr;
  return wrapped;
}

beforeEach(() => {
  rows.length = 0;
  insertRejectError = null;
  selectRejectError = null;
  vi.clearAllMocks();
});

describe("upsertSpecialistFeedback", () => {
  it("chấm lại cùng phiên bởi cùng người ⇒ GHI ĐÈ, không tạo dòng trùng", async () => {
    await upsertSpecialistFeedback({ sessionId: 1, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "partial", repoContextUsed: true });
    await upsertSpecialistFeedback({ sessionId: 1, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useful", repoContextUsed: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe("useful");
  });

  // IMPORTANT-1 fix-round test: migration 0307 not yet applied in a given environment
  // must degrade to {ok:false}, never throw — mirrors recordAnswerFeedback's fail-safe.
  it("fail-safe: bảng chưa tồn tại (42P01 bọc trong cause của DrizzleQueryError) ⇒ { ok: false }, không ném", async () => {
    insertRejectError = wrappedMissingTableError();
    await expect(
      upsertSpecialistFeedback({ sessionId: 1, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useful", repoContextUsed: true }),
    ).resolves.toEqual({ ok: false });
    expect(rows).toHaveLength(0);
  });
});

describe("getSpecialistQualityScoreboard", () => {
  it("tính đúng % theo agent × module", async () => {
    rows.push(
      { sessionId: 1, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useful", repoContextUsed: true },
      { sessionId: 2, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useless", repoContextUsed: true },
      { sessionId: 3, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useful", repoContextUsed: false },
      { sessionId: 4, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useless", repoContextUsed: false },
    );
    const sb = await getSpecialistQualityScoreboard();
    const row = sb.rows.find((r) => r.agentId === "backend-engineer" && r.moduleName === "ai")!;
    expect(row.total).toBe(4);
    expect(row.usefulPct).toBe(50);
    expect(row.uselessPct).toBe(50);
    expect(sb.overall.total).toBe(4);
    expect(sb.overall.usefulPct).toBe(50);
  });

  it("tách được có-mắt và không-mắt (để biết mắt có giúp thật không)", async () => {
    rows.push(
      { sessionId: 1, userId: 7, agentId: "qa-optimizer", moduleName: null, rating: "useful", repoContextUsed: true },
      { sessionId: 2, userId: 7, agentId: "qa-optimizer", moduleName: null, rating: "useful", repoContextUsed: true },
      { sessionId: 3, userId: 7, agentId: "qa-optimizer", moduleName: null, rating: "useless", repoContextUsed: false },
    );
    const row = (await getSpecialistQualityScoreboard()).rows.find((r) => r.agentId === "qa-optimizer")!;
    expect(row.withEyesUsefulPct).toBe(100);
    expect(row.withoutEyesUsefulPct).toBe(0);
  });

  // IMPORTANT-2 fix-round test: a bucket with ZERO rows must report null ("no data"),
  // never 0 ("measured, all bad") — a regression collapsing the ternary to unconditional
  // pct(...) would turn this null into a misleading 0 and pass every OTHER existing test
  // (the one above always has both buckets non-empty).
  it("nhóm chỉ toàn phiếu có-mắt ⇒ withoutEyesUsefulPct là null (không phải 0, vì KHÔNG có dữ liệu)", async () => {
    rows.push(
      { sessionId: 1, userId: 7, agentId: "data-analyst", moduleName: "quality", rating: "useful", repoContextUsed: true },
      { sessionId: 2, userId: 7, agentId: "data-analyst", moduleName: "quality", rating: "partial", repoContextUsed: true },
    );
    const row = (await getSpecialistQualityScoreboard()).rows.find((r) => r.agentId === "data-analyst")!;
    expect(row.withoutEyesUsefulPct).toBeNull();
    expect(typeof row.withEyesUsefulPct).toBe("number");
    expect(row.withEyesUsefulPct).toBe(50);
  });

  it("không có phiếu nào ⇒ rows rỗng, overall 0, không ném", async () => {
    const sb = await getSpecialistQualityScoreboard();
    expect(sb.rows).toEqual([]);
    expect(sb.overall).toEqual({ total: 0, usefulPct: 0 });
  });

  // IMPORTANT-1 fix-round test: same fail-safe as the write path, mirrors
  // loadFeedbackNetRatings — degrade to the empty scoreboard shape, never throw. This is
  // what protects Task 5's UI (mounts + calls getQualityScoreboard) from a raw unhandled
  // error before migration 0307 has been applied in a given environment.
  it("fail-safe: bảng chưa tồn tại (42P01 bọc trong cause của DrizzleQueryError) ⇒ bảng điểm rỗng, không ném", async () => {
    selectRejectError = wrappedMissingTableError();
    await expect(getSpecialistQualityScoreboard()).resolves.toEqual({
      rows: [],
      overall: { total: 0, usefulPct: 0 },
    });
  });
});
