import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB connection ────────────────────────────────────────────────────
// We mock the connection module so no real Postgres is needed.
vi.mock("../db/connection", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db/connection";
import {
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
