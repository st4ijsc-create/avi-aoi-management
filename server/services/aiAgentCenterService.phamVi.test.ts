/**
 * Command Center (getRoster / getCommandCenterReadModel) lọc theo nhà máy của CHỦ hàng ở MỌI nguồn có chữ do người dùng nhập:
 *   roster.operations (phiên orchestrator) · roster.specialist (objective) · roster.proactive (summary) · taskFeed (a)(b)(c).
 * Lỗi gốc: engineer nhà máy B đọc `goal`/`objective`/`summary` của người nhà máy A. Mỗi ca đỏ nếu MỘT nguồn quên lọc.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.LICENSE_BYPASS = "true";
type Row = Record<string, any>;

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  and: (...args: unknown[]) => ({ __op: "and", args }),
  eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
  gte: (col: unknown, val: unknown) => ({ __op: "gte", col, val }),
  inArray: (col: unknown, val: unknown) => ({ __op: "inArray", col, val }),
  desc: (col: unknown) => ({ __op: "desc", col }),
}));
vi.mock("../../drizzle/schema", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  aiPendingActions: { __table: "aiPendingActions" },
  aiSpecialistSessions: { __table: "aiSpecialistSessions" },
  aiSpecialistSessionSteps: { __table: "aiSpecialistSessionSteps" },
}));

let BANG: Record<string, Row[]> = {};
vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: () => ({
      from: (t: any) => {
        const rows = BANG[t.__table] ?? [];
        const c: any = { where: () => c, orderBy: () => c, limit: () => c, then: (ok: any, ko?: any) => Promise.resolve(rows).then(ok, ko) };
        return c;
      },
    }),
  }),
}));

const listSessionsForOps = vi.fn(async (..._a: unknown[]): Promise<any[]> => []);
vi.mock("./aiAgentOrchestrator", () => ({ listSessionsForOps: (...a: unknown[]) => listSessionsForOps(...a) }));
vi.mock("./aiSpecialistAgentService", () => ({
  listSpecialistAgents: () => [{ id: "data-analyst", name: "Data Insight Agent", role: "r", focus: [], outputContract: [] }],
}));
vi.mock("./aiGgufEngine", () => ({ isGgufAvailable: async () => true }));
vi.mock("./aiAutoProposer", () => ({ isAutoProposeEnabled: () => true }));
vi.mock("./orchestration/aiOrchestrationAdvisor", () => ({ advisorEnabled: () => false }));
vi.mock("./aiBatchRcaScheduler", () => ({ getBatchRcaStatus: () => ({ enabled: false, lastRunAt: null }) }));
vi.mock("./aiSelfLearningScheduler", () => ({ getSelfLearningStatus: () => ({ enabled: false, lastRunAt: null }) }));
vi.mock("./aiThresholdTuneScheduler", () => ({ getThresholdTuneSchedulerStatus: () => ({ enabled: false, lastRunAt: null }) }));
vi.mock("./aiAnomalyBankScheduler", () => ({ getAnomalyBankSchedulerStatus: () => ({ enabled: false, lastRunAt: null }) }));
vi.mock("./aiAgentHousekeepingScheduler", () => ({ getAgentHousekeepingStatus: () => ({ enabled: false, lastRunAt: null }) }));

import { getRoster, getCommandCenterReadModel } from "./aiAgentCenterService";
import { xoaCachePhamViChu, __datPhuThuocChoTest } from "./aiAgentPhamVi";

const PV: Record<number, number[] | null> = { 1: null, 10: [1], 11: [2], 12: [1, 2], 13: [] };
const VAI: Record<number, string> = { 1: "admin", 10: "engineer", 11: "engineer", 12: "engineer", 13: "engineer" };
const T = new Date("2026-11-02T00:00:00Z");
const specialist = (id: number, userId: number, objective: string) => ({ id, userId, objective, summary: null, requestedAgents: ["data-analyst"], status: "running", updatedAt: T });
const hanhDong = (id: string, userId: number, summary: string) => ({ id, userId, summary, status: "proposed", createdAt: T });

const A = { id: 10, role: "engineer" }; // nhà máy 1
const B = { id: 11, role: "engineer" }; // nhà máy 2
const ADMIN = { id: 1, role: "admin" };

beforeEach(() => {
  __datPhuThuocChoTest({
    bay: () => Date.now(),
    async phanGiai(u) {
      if (!(u.userId in PV)) throw new Error("không phân giải được");
      return PV[u.userId];
    },
    async layVaiTro(ids) {
      return new Map(ids.filter((i) => i in VAI).map((i) => [i, VAI[i]] as [number, string]));
    },
  });
  xoaCachePhamViChu();
  listSessionsForOps.mockReset();
  listSessionsForOps.mockResolvedValue([]);
  BANG = {
    // chủ 10 (nhà máy 1) MỚI NHẤT, rồi chủ 11 (nhà máy 2)
    aiSpecialistSessions: [specialist(1, 10, "OBJ-NHA-MAY-1"), specialist(2, 11, "OBJ-NHA-MAY-2")],
    aiSpecialistSessionSteps: [],
    aiPendingActions: [hanhDong("a1", 10, "SUM-NHA-MAY-1"), hanhDong("a2", 11, "SUM-NHA-MAY-2")],
  };
});

const cua = (m: unknown) => JSON.stringify(m);

describe("getRoster — nhà máy 2 không đọc được chữ của nhà máy 1", () => {
  it("★ specialist.currentTask: engineer nhà máy 2 chỉ thấy objective nhà máy 2", async () => {
    const r = await getRoster(B);
    const e = r.find((x) => x.id === "specialist-data-analyst")!;
    expect(e.currentTask).toBe("OBJ-NHA-MAY-2");
    expect(cua(r)).not.toContain("OBJ-NHA-MAY-1");
  });
  it("★ proactive.currentTask: engineer nhà máy 2 không thấy summary của nhà máy 1 (kể cả khi nó MỚI NHẤT)", async () => {
    const r = await getRoster(B);
    expect(r.find((x) => x.id === "proactive-agent")!.currentTask).toBe("SUM-NHA-MAY-2");
    expect(cua(r)).not.toContain("SUM-NHA-MAY-1");
  });
  it("★ người xem được truyền xuống listSessionsForOps (operations-agent)", async () => {
    await getRoster(B);
    expect(listSessionsForOps).toHaveBeenCalledWith({ limit: 20 }, B);
  });
  it("engineer chưa gán nhà máy: không thấy chữ của ai", async () => {
    const r = await getRoster({ id: 13, role: "engineer" });
    expect(cua(r)).not.toMatch(/OBJ-NHA-MAY|SUM-NHA-MAY/);
  });
  it("admin thấy bản mới nhất (chủ 10)", async () => {
    const r = await getRoster(ADMIN);
    expect(r.find((x) => x.id === "specialist-data-analyst")!.currentTask).toBe("OBJ-NHA-MAY-1");
    expect(r.find((x) => x.id === "proactive-agent")!.currentTask).toBe("SUM-NHA-MAY-1");
  });
});

describe("getCommandCenterReadModel — taskFeed ba nguồn", () => {
  it("★ engineer nhà máy 2: feed không chứa objective/summary của nhà máy 1 ở nguồn (b) và (c)", async () => {
    const m = await getCommandCenterReadModel(B);
    const nhan = m.taskFeed.map((i) => i.label);
    expect(nhan).toContain("OBJ-NHA-MAY-2");
    expect(nhan).toContain("SUM-NHA-MAY-2");
    expect(cua(m)).not.toMatch(/NHA-MAY-1/);
  });
  it("★ người xem được truyền xuống listSessionsForOps (nguồn (a) và sessions)", async () => {
    await getCommandCenterReadModel(A, { limit: 10 });
    expect(listSessionsForOps).toHaveBeenCalledWith({ limit: 30 }, A);
  });
  it("engineer nhà máy 1 chỉ thấy nhà máy 1", async () => {
    const m = await getCommandCenterReadModel(A);
    expect(m.taskFeed.map((i) => i.label).sort()).toEqual(["OBJ-NHA-MAY-1", "SUM-NHA-MAY-1"]);
  });
  it("admin thấy cả hai nhà máy", async () => {
    const m = await getCommandCenterReadModel(ADMIN);
    expect(m.taskFeed.map((i) => i.label).sort()).toEqual(["OBJ-NHA-MAY-1", "OBJ-NHA-MAY-2", "SUM-NHA-MAY-1", "SUM-NHA-MAY-2"]);
  });
  it("★ bộ phân giải hỏng ⇒ người xem không toàn quyền không thấy chữ của ai khác (fail-closed)", async () => {
    __datPhuThuocChoTest({
      bay: () => Date.now(),
      async phanGiai() {
        throw new Error("db chính vắng");
      },
      async layVaiTro(ids) {
        return new Map(ids.map((i) => [i, VAI[i]] as [number, string]));
      },
    });
    xoaCachePhamViChu();
    const m = await getCommandCenterReadModel(A);
    expect(cua(m)).not.toMatch(/NHA-MAY-2/);
  });
});
