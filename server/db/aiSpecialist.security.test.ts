import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB connection ────────────────────────────────────────────────────
// We mock the connection module so no real Postgres is needed.
vi.mock("../db/connection", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db/connection";
import {
  completeAiSpecialistSession,
  getAiSpecialistSessionById,
  listAiSpecialistSessions,
} from "../db/aiSpecialist";

const mockGetDb = vi.mocked(getDb);

// Helper: create a minimal fake Drizzle-like query builder.
// Supports both .limit() as terminal and .limit().offset() as terminal.
function makeFakeDb(rows: any[]) {
  const selectResult: any = {
    from: () => selectResult,
    where: () => selectResult,
    orderBy: () => selectResult,
    limit: () => {
      // Return an object that can be awaited (terminal for getById)
      // AND has .offset() for list queries.
      const afterLimit: any = Object.assign(Promise.resolve(rows), {
        offset: () => Promise.resolve(rows),
      });
      return afterLimit;
    },
  };
  return { select: () => selectResult };
}

describe("getAiSpecialistSessionById — ownership enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session when userId matches", async () => {
    const fakeSession = { id: 1, userId: 42, moduleName: "ai-chat", status: "completed" };
    mockGetDb.mockResolvedValueOnce(makeFakeDb([fakeSession]) as any);

    const result = await getAiSpecialistSessionById(1, 42);
    expect(result).toEqual(fakeSession);
  });

  it("returns null when no session matches (wrong owner)", async () => {
    // DB returns empty array — simulates userId mismatch filtered by WHERE
    mockGetDb.mockResolvedValueOnce(makeFakeDb([]) as any);

    const result = await getAiSpecialistSessionById(1, 99);
    expect(result).toBeNull();
  });

  it("returns null when DB is unavailable", async () => {
    mockGetDb.mockResolvedValueOnce(null as any);

    const result = await getAiSpecialistSessionById(1, 42);
    expect(result).toBeNull();
  });
});

describe("listAiSpecialistSessions — scoped to userId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rows from DB", async () => {
    const rows = [
      { id: 1, userId: 7, moduleName: "ai-chat", status: "completed" },
      { id: 2, userId: 7, moduleName: "ai-analysis-hub", status: "running" },
    ];
    mockGetDb.mockResolvedValueOnce(makeFakeDb(rows) as any);

    const result = await listAiSpecialistSessions(7, {});
    expect(result).toHaveLength(2);
    expect(result.every((r: any) => r.userId === 7)).toBe(true);
  });

  it("returns empty array when DB has no sessions for user", async () => {
    mockGetDb.mockResolvedValueOnce(makeFakeDb([]) as any);

    const result = await listAiSpecialistSessions(7, {});
    expect(result).toEqual([]);
  });

  it("returns empty array when DB is unavailable", async () => {
    mockGetDb.mockResolvedValueOnce(null as any);

    const result = await listAiSpecialistSessions(7, {});
    expect(result).toEqual([]);
  });
});

// ─── M-3 — completeAiSpecialistSession không được lật ngược trạng thái cuối ───
//
// Housekeeping (`expireStaleSpecialistSessions`) có thể đã đánh phiên là
// `failed` vì quá hạn; nếu tiến trình nền chạy xong SAU đó và gọi
// completeAiSpecialistSession không kèm điều kiện trạng thái, phiên bị lật
// `failed` → `completed` và `completionRate` (getModuleImprovementStats) bị
// thổi phồng. Điều kiện `status = 'running'` là thứ chặn việc đó.

/** Fake builder cho nhánh UPDATE, giữ lại điều kiện WHERE để soi. */
function makeFakeUpdateDb(captured: { where?: unknown }, rows: any[] = [{ id: 1 }]) {
  const chain: any = {
    set: () => chain,
    where: (cond: unknown) => {
      captured.where = cond;
      return chain;
    },
    returning: async () => rows,
  };
  return { update: () => chain };
}

/**
 * Dò một giá trị nguyên thuỷ trong đồ thị điều kiện của drizzle (SQL/Param/Column
 * lồng nhau và có chu trình). Cố ý KHÔNG phụ thuộc hình dạng nội bộ chính xác của
 * drizzle: chỉ cần khẳng định "giá trị này có mặt trong WHERE" — bỏ điều kiện đi
 * là giá trị biến mất và test đỏ.
 */
function conditionMentions(node: unknown, needle: string | number, seen = new Set<unknown>(), depth = 0): boolean {
  if (depth > 30 || node == null) return false;
  if (typeof node === "string" || typeof node === "number") return node === needle;
  if (typeof node !== "object") return false;
  if (seen.has(node)) return false;
  seen.add(node);
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (conditionMentions(v, needle, seen, depth + 1)) return true;
  }
  return false;
}

describe("completeAiSpecialistSession — chỉ đóng phiên còn 'running'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("WHERE có ràng buộc trạng thái 'running' (cùng với id + userId)", async () => {
    const captured: { where?: unknown } = {};
    mockGetDb.mockResolvedValueOnce(makeFakeUpdateDb(captured) as any);

    await completeAiSpecialistSession(1, 42, { status: "completed", summary: "xong" });

    expect(captured.where).toBeDefined();
    expect(conditionMentions(captured.where, "running")).toBe(true);
    expect(conditionMentions(captured.where, 1)).toBe(true);
    expect(conditionMentions(captured.where, 42)).toBe(true);
  });

  it("phiên đã bị housekeeping đánh failed ⇒ 0 dòng khớp ⇒ trả undefined, KHÔNG ném", async () => {
    const captured: { where?: unknown } = {};
    mockGetDb.mockResolvedValueOnce(makeFakeUpdateDb(captured, []) as any);

    await expect(
      completeAiSpecialistSession(1, 42, { status: "completed", summary: "xong muộn" }),
    ).resolves.toBeUndefined();
  });
});
