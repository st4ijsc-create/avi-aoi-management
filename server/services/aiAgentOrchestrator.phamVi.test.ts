/**
 * listSessionsForOps (màn Command Center / aiAgent.listAgentSessionsForOps) lọc theo nhà máy của CHỦ phiên.
 * Lỗi gốc: không có lọc userId ⇒ engineer nhà máy B đọc `goal` của người nhà máy A. Chuỗi thật (dịch vụ → aiAgentPhamVi), chỉ giả DB + bộ phân giải.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PV: Record<number, number[] | null> = { 1: null, 10: [1], 11: [2], 12: [1, 2], 13: [] };
const VAI: Record<number, string> = { 1: "admin", 10: "engineer", 11: "engineer", 12: "engineer", 13: "engineer" };
const hang = (id: string, userId: number, goal: string) => ({
  id, userId, userRole: VAI[userId], goal, planJson: { steps: [{}, {}] }, cursor: 1, status: "running", writeCount: 0,
  updatedAt: new Date("2026-11-02T00:00:00Z"), expiresAt: new Date("2026-11-02T01:00:00Z"), userName: `u${userId}`, username: `u${userId}`,
});
const PHIEN = [hang("s-adm", 1, "MỤC TIÊU ADMIN"), hang("s-a", 10, "MỤC TIÊU NHÀ MÁY 1"), hang("s-b", 11, "MỤC TIÊU NHÀ MÁY 2"), hang("s-c", 12, "MỤC TIÊU TẬP ĐOÀN"), hang("s-n", 13, "MỤC TIÊU CHƯA GÁN")];
let gioiHanLay = -1;

vi.mock("../db/connection", async () => {
  const chuoi = (rows: unknown[], ghiLimit: boolean) => {
    const c: any = {
      leftJoin: () => c,
      where: () => c,
      orderBy: () => c,
      limit: (n: number) => {
        if (ghiLimit) gioiHanLay = n;
        return c;
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, ko),
    };
    return c;
  };
  return {
    getDb: async () => ({
      select: () => ({
        from: () => chuoi(PHIEN, true),
      }),
    }),
  };
});
vi.mock("./aiCopilotActions", () => ({ proposeAction: vi.fn(), confirmAction: vi.fn(), cancelAction: vi.fn() }));
vi.mock("./aiAgentPlanner", () => ({ planGoal: vi.fn(), replanFromObservations: vi.fn(), AGENT_MAX_STEPS: 6, AGENT_MAX_REPLANS: 2 }));
vi.mock("./aiAgentRealtime", () => ({ publishAiAgentEvent: vi.fn() }));

import { listSessionsForOps } from "./aiAgentOrchestrator";
import { xoaCachePhamViChu, __datPhuThuocChoTest } from "./aiAgentPhamVi";

const xem = async (id: number, role: string, opts?: { limit?: number }) => (await listSessionsForOps(opts, { id, role })).map((s) => s.id);

describe("listSessionsForOps — hai nhà máy / nhiều người xem", () => {
  beforeEach(() => {
    // bộ phân giải + đọc vai GIẢ (nhưng chuỗi dịch vụ → locTheoChu → phamViCacChu là THẬT); bản phân giải thật được kiểm ở aiAgentPhamVi.db.test.ts
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
    gioiHanLay = -1;
  });
  it("★ engineer nhà máy 1: thấy phiên nhà máy 1 + tập đoàn, KHÔNG thấy nhà máy 2 / admin / chưa gán", async () => {
    expect(await xem(10, "engineer")).toEqual(["s-a", "s-c"]);
  });
  it("★ engineer nhà máy 2 không thấy `goal` của nhà máy 1", async () => {
    const ds = await listSessionsForOps(undefined, { id: 11, role: "engineer" });
    expect(ds.map((s) => s.goal)).toEqual(["MỤC TIÊU NHÀ MÁY 2", "MỤC TIÊU TẬP ĐOÀN"]);
    expect(JSON.stringify(ds)).not.toContain("NHÀ MÁY 1");
  });
  it("engineer chưa gán nhà máy chỉ thấy phiên của chính mình", async () => {
    expect(await xem(13, "engineer")).toEqual(["s-n"]);
  });
  it("engineer cấp tập đoàn thấy cả hai nhà máy, không thấy admin / chưa gán", async () => {
    expect(await xem(12, "engineer")).toEqual(["s-a", "s-b", "s-c"]);
  });
  it("admin thấy hết; lấy đúng trần limit (không lấy dư)", async () => {
    expect(await xem(1, "admin", { limit: 5 })).toEqual(["s-adm", "s-a", "s-b", "s-c", "s-n"]);
    expect(gioiHanLay).toBe(5);
  });
  it("người không toàn quyền: lấy dư (300) rồi lọc, và vẫn cắt về `limit`", async () => {
    expect(await xem(12, "engineer", { limit: 2 })).toEqual(["s-a", "s-b"]);
    expect(gioiHanLay).toBe(300);
  });
  it("★ người xem không phân giải được phạm vi ⇒ chỉ phiên của chính họ (fail-closed)", async () => {
    delete (PV as Record<number, unknown>)[10];
    try {
      expect(await xem(10, "engineer")).toEqual(["s-a"]); // chỉ phiên của CHÍNH 10; không mở ra nhà máy khác
    } finally {
      PV[10] = [1];
    }
  });
});
