import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
const fakeDb = {
  insert: () => ({
    values: (v: any) => ({
      onConflictDoUpdate: ({ set }: any) => {
        const i = rows.findIndex((r) => r.sessionId === v.sessionId && r.userId === v.userId);
        if (i >= 0) rows[i] = { ...rows[i], ...set, ...v };
        else rows.push({ ...v });
        return Promise.resolve();
      },
    }),
  }),
  select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
};
// LƯU Ý: server/db/aiSpecialist.ts import getDb từ "./connection" (KHÔNG phải "../db").
vi.mock("./connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { upsertSpecialistFeedback, getSpecialistQualityScoreboard } from "./aiSpecialist";

beforeEach(() => { rows.length = 0; vi.clearAllMocks(); });

describe("upsertSpecialistFeedback", () => {
  it("chấm lại cùng phiên bởi cùng người ⇒ GHI ĐÈ, không tạo dòng trùng", async () => {
    await upsertSpecialistFeedback({ sessionId: 1, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "partial", repoContextUsed: true });
    await upsertSpecialistFeedback({ sessionId: 1, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useful", repoContextUsed: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe("useful");
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

  it("không có phiếu nào ⇒ rows rỗng, overall 0, không ném", async () => {
    const sb = await getSpecialistQualityScoreboard();
    expect(sb.rows).toEqual([]);
    expect(sb.overall).toEqual({ total: 0, usefulPct: 0 });
  });
});
