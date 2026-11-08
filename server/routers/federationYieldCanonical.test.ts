/**
 * Q0-2 — federation.aggregateSummary: yield tập đoàn = công thức CHUẨN (OK + NTF) / tổng, và `totals.ntfCount` được cộng.
 * kiem-dinh 2026-11-06 (lô C ❌): đột biến y1 (quay về chỉ OK) và y2 (bỏ cộng ntfCount) sống sót vì không test nào
 * ghim con số. Không chạm DB: `../db` là bản giả theo khuôn `federationPanoramaRouter.test.ts`; cổng quyền và cổng
 * tenant được thay bằng bản cho qua (đo ở nơi khác: loOtDocC3PhamVi.db.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

let sitesRows: any[] = [];
let rollupRows: any[] = [];
function terminal(rows: any[]): any {
  return {
    where: () => terminal(rows),
    orderBy: () => terminal(rows),
    limit: async () => rows,
    then: (res: (v: any[]) => void) => res(rows),
  };
}
vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (t: any) => {
        const key = t?.__key ?? "";
        return terminal(key === "sites" ? sitesRows : key === "siteKpiRollup" ? rollupRows : []);
      },
    }),
  }),
  createAuditLog: vi.fn(async () => {}),
}));
vi.mock("../../drizzle/schema", async (orig) => {
  const mod: any = await (orig as any)();
  const tag = (o: any, k: string) => (o ? Object.assign(o, { __key: k }) : o);
  tag(mod.sites, "sites");
  tag(mod.siteKpiRollup, "siteKpiRollup");
  tag(mod.siteSyncLog, "siteSyncLog");
  return mod;
});
vi.mock("../_core/accessControl", async (orig) => {
  const mod: any = await (orig as any)();
  return { ...mod, requirePermission: () => async ({ next }: { next: () => unknown }) => next() };
});
vi.mock("../db/hierarchy", async (orig) => {
  const mod: any = await (orig as any)();
  return { ...mod, congMaTenant: async () => undefined };
});

import { federationRouter } from "./federationRouter";
const caller = (federationRouter as any).createCaller({ user: { id: 1, role: "admin", name: "T" } });

const now = new Date();
const site = (id: number) => ({ id, code: `S${id}`, name: `S${id}`, corporateCode: "ACME", region: "VN", isLocal: false, status: "active", pollIntervalSec: 60, lastSyncAt: now, lastError: null, consecutiveFailures: 0 });
const snap = (siteId: number, over: any) => ({
  id: 100 + siteId, siteId, category: "overall", window: "snapshot", bucketStart: null, asOf: now, fetchedAt: now,
  totalInspections: 0, okCount: 0, ngCount: 0, ntfCount: 0, yieldRate: 0, ngRate: 0, throughput: 0, oee: 0, avgCycleTime: 0,
  defectPareto: [], detailRows: [], alertRollup: null, metrics: null, source: "poll", ...over,
});

beforeEach(() => { sitesRows = []; rollupRows = []; });

describe("federation.aggregateSummary — yield chuẩn (OK + NTF) / tổng", () => {
  it("y1 — hai trang: (80+10 NTF)/100 và (50+30 NTF)/100 ⇒ (90+80)/200 = 85 (chỉ-OK cho 65)", async () => {
    sitesRows = [site(1), site(2)];
    rollupRows = [
      snap(1, { totalInspections: 100, okCount: 80, ngCount: 10, ntfCount: 10 }),
      snap(2, { totalInspections: 100, okCount: 50, ngCount: 20, ntfCount: 30 }),
    ];
    const r = await caller.aggregateSummary();
    expect(r.totals.totalInspections).toBe(200);
    expect(r.overallYieldRate).toBe(85);
  });

  it("y2 — totals.ntfCount là TỔNG ntfCount các trang (bỏ cộng ⇒ 0 và yield sai)", async () => {
    sitesRows = [site(1), site(2)];
    rollupRows = [
      snap(1, { totalInspections: 100, okCount: 80, ngCount: 10, ntfCount: 10 }),
      snap(2, { totalInspections: 100, okCount: 50, ngCount: 20, ntfCount: 30 }),
    ];
    const r = await caller.aggregateSummary();
    expect(r.totals).toEqual({ totalInspections: 200, okCount: 130, ngCount: 30, ntfCount: 40 });
  });

  it("không có kiểm tra nào ⇒ quay về trung bình có trọng số hoặc null (không NaN)", async () => {
    sitesRows = [site(1)];
    rollupRows = [snap(1, { totalInspections: 0, yieldRate: 0 })];
    const r = await caller.aggregateSummary();
    expect(r.overallYieldRate).toBeNull();
  });
});
