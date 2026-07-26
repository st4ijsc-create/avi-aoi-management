/**
 * aiAgentCenterService.getSavingsSummary — token + cloud-savings summary (doc69 Wave E2,
 * task E2-2).
 *
 * `../db/connection`'s `getDb` is the only I/O boundary mocked, mirroring aiGatewayQuota.
 * test.ts's convention (`../../drizzle/schema` and `drizzle-orm` stay REAL — both are
 * pure builders/definitions, no I/O, and `getSavingsSummary` needs a real `sql` tag +
 * real `aiGatewayMetrics` column objects to build its GROUP BY query). Every OTHER
 * service `aiAgentCenterService.ts` imports (orchestrator sessions, specialist agents,
 * GGUF availability, auto-proposer/advisor, the 5 schedulers) is mocked to a bare stub
 * purely so importing the module doesn't pull in real DB/engine calls — none of them are
 * exercised by `getSavingsSummary` itself (see aiAgentCenterService.test.ts for the
 * roster-side tests of those sources).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_CLASS_PRICES } from "./aiCostModel";

const getDbMock = vi.fn();
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

vi.mock("./aiAgentOrchestrator", () => ({ listSessionsForOps: vi.fn(async () => []) }));
vi.mock("./aiSpecialistAgentService", () => ({ listSpecialistAgents: vi.fn(() => []) }));
vi.mock("./aiGgufEngine", () => ({ isGgufAvailable: vi.fn(async () => false) }));
vi.mock("./aiAutoProposer", () => ({ isAutoProposeEnabled: vi.fn(() => false) }));
vi.mock("./orchestration/aiOrchestrationAdvisor", () => ({ advisorEnabled: vi.fn(() => false) }));
vi.mock("./aiBatchRcaScheduler", () => ({ getBatchRcaStatus: vi.fn(() => ({ enabled: false })) }));
vi.mock("./aiSelfLearningScheduler", () => ({ getSelfLearningStatus: vi.fn(() => ({ enabled: false })) }));
vi.mock("./aiThresholdTuneScheduler", () => ({ getThresholdTuneSchedulerStatus: vi.fn(() => ({ enabled: false })) }));
vi.mock("./aiAnomalyBankScheduler", () => ({ getAnomalyBankSchedulerStatus: vi.fn(() => ({ enabled: false })) }));
vi.mock("./aiAgentHousekeepingScheduler", () => ({ getAgentHousekeepingStatus: vi.fn(() => ({ enabled: false })) }));

/** Minimal thenable query-builder stub mirroring drizzle's `.select().from().where().groupBy()`. */
function makeResult(rows: unknown[]) {
  const builder: PromiseLike<unknown[]> & Record<string, unknown> = {
    from: () => builder,
    where: () => builder,
    groupBy: () => builder,
    then: (resolve: (v: unknown[]) => void) => resolve(rows),
  } as any;
  return builder;
}

const MEDIUM = DEFAULT_CLASS_PRICES.medium; // { inputPricePer1kUsd: 0.003, outputPricePer1kUsd: 0.015 }
const SMALL = DEFAULT_CLASS_PRICES.small; // { inputPricePer1kUsd: 0.0002, outputPricePer1kUsd: 0.0006 }
const MEDIUM_MODEL = "Qwen3-14B-Instruct.gguf";
const SMALL_MODEL = "Qwen3-4B-Instruct.gguf";

function usd(tokensIn: number, tokensOut: number, price: { inputPricePer1kUsd: number; outputPricePer1kUsd: number }): number {
  return (tokensIn / 1000) * price.inputPricePer1kUsd + (tokensOut / 1000) * price.outputPricePer1kUsd;
}

async function loadFresh() {
  vi.resetModules();
  return import("./aiAgentCenterService");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSavingsSummary", () => {
  it("aggregates today/month/total windows and prices each model at its own class", async () => {
    const todayRows = [{ model: MEDIUM_MODEL, tokensIn: 1000, tokensOut: 500, requestCount: 2 }];
    const monthRows = [
      { model: MEDIUM_MODEL, tokensIn: 6000, tokensOut: 3000, requestCount: 12 },
      { model: SMALL_MODEL, tokensIn: 2000, tokensOut: 1000, requestCount: 5 },
    ];
    const totalRows = [
      { model: MEDIUM_MODEL, tokensIn: 10000, tokensOut: 5000, requestCount: 20 },
      { model: SMALL_MODEL, tokensIn: 2000, tokensOut: 1000, requestCount: 5 },
    ];
    const selectMock = vi
      .fn()
      .mockReturnValueOnce(makeResult(todayRows))
      .mockReturnValueOnce(makeResult(monthRows))
      .mockReturnValueOnce(makeResult(totalRows));
    getDbMock.mockResolvedValue({ select: selectMock });

    const svc = await loadFresh();
    const summary = await svc.getSavingsSummary({ now: new Date("2026-07-15T10:00:00Z") });

    expect(selectMock).toHaveBeenCalledTimes(3);
    expect(summary.dataAvailable).toBe(true);

    // today: 1 row, medium class
    expect(summary.today.tokensIn).toBe(1000);
    expect(summary.today.tokensOut).toBe(500);
    expect(summary.today.totalTokens).toBe(1500);
    expect(summary.today.requestCount).toBe(2);
    expect(summary.today.cloudEquivalentUsd).toBeCloseTo(usd(1000, 500, MEDIUM), 10);

    // month: medium + small rows summed correctly
    expect(summary.month.tokensIn).toBe(8000);
    expect(summary.month.tokensOut).toBe(4000);
    expect(summary.month.requestCount).toBe(17);
    const expectedMonthUsd = usd(6000, 3000, MEDIUM) + usd(2000, 1000, SMALL);
    expect(summary.month.cloudEquivalentUsd).toBeCloseTo(expectedMonthUsd, 10);

    // total: medium + small rows summed correctly
    expect(summary.total.tokensIn).toBe(12000);
    expect(summary.total.tokensOut).toBe(6000);
    expect(summary.total.requestCount).toBe(25);
    const expectedTotalUsd = usd(10000, 5000, MEDIUM) + usd(2000, 1000, SMALL);
    expect(summary.total.cloudEquivalentUsd).toBeCloseTo(expectedTotalUsd, 10);

    // per-model breakdown = the total-window rows, sorted by savings desc
    expect(summary.byModel).toHaveLength(2);
    expect(summary.byModel[0].model).toBe(MEDIUM_MODEL);
    expect(summary.byModel[0].cloudEquivalentUsd).toBeCloseTo(usd(10000, 5000, MEDIUM), 10);
    expect(summary.byModel[1].model).toBe(SMALL_MODEL);
    expect(summary.byModel[1].cloudEquivalentUsd).toBeCloseTo(usd(2000, 1000, SMALL), 10);
    expect(summary.byModel[0].cloudEquivalentUsd).toBeGreaterThan(summary.byModel[1].cloudEquivalentUsd);

    // onPremPercent computed from data (currently no cloud source ⇒ 100), never hardcoded blindly
    expect(summary.onPremPercent).toBe(100);
    expect(summary.localMarginalUsdPer1k).toBe(0);
    expect(summary.generatedAt).toBe(new Date("2026-07-15T10:00:00Z").toISOString());
  });

  it("HONEST-EMPTY: no metrics rows at all ⇒ zeros + dataAvailable:false (no fabricated savings)", async () => {
    const selectMock = vi
      .fn()
      .mockReturnValueOnce(makeResult([]))
      .mockReturnValueOnce(makeResult([]))
      .mockReturnValueOnce(makeResult([]));
    getDbMock.mockResolvedValue({ select: selectMock });

    const svc = await loadFresh();
    const summary = await svc.getSavingsSummary();

    expect(summary.dataAvailable).toBe(false);
    expect(summary.today).toEqual({ tokensIn: 0, tokensOut: 0, totalTokens: 0, requestCount: 0, cloudEquivalentUsd: 0 });
    expect(summary.month).toEqual({ tokensIn: 0, tokensOut: 0, totalTokens: 0, requestCount: 0, cloudEquivalentUsd: 0 });
    expect(summary.total).toEqual({ tokensIn: 0, tokensOut: 0, totalTokens: 0, requestCount: 0, cloudEquivalentUsd: 0 });
    expect(summary.byModel).toEqual([]);
    expect(summary.onPremPercent).toBe(0);
  });

  it("HONEST-EMPTY: no DB configured ⇒ zeros + dataAvailable:false", async () => {
    getDbMock.mockResolvedValue(null);

    const svc = await loadFresh();
    const summary = await svc.getSavingsSummary();

    expect(summary.dataAvailable).toBe(false);
    expect(summary.total.requestCount).toBe(0);
  });

  it("FAIL-SAFE: a thrown query ⇒ honest-empty, never throws", async () => {
    getDbMock.mockResolvedValue({
      select: vi.fn(() => {
        throw new Error("db down");
      }),
    });

    const svc = await loadFresh();
    await expect(svc.getSavingsSummary()).resolves.toEqual(
      expect.objectContaining({ dataAvailable: false, onPremPercent: 0 }),
    );
  });

  it("FAIL-SAFE: getDb itself rejecting ⇒ honest-empty, never throws", async () => {
    getDbMock.mockRejectedValue(new Error("connection pool exhausted"));

    const svc = await loadFresh();
    await expect(svc.getSavingsSummary()).resolves.toEqual(
      expect.objectContaining({ dataAvailable: false }),
    );
  });
});
