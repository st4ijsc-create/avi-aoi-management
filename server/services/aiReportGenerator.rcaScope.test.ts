/**
 * doc 69 W0-3 security review fix (Important #2) — server/services/aiReportGenerator.ts
 * `generateRCAReport` correctly scoped `collectInspectionStats`/`collectTopDefects` by
 * `machineId`, but called `collectMachinePerformance(startDate, endDate)` GLOBALLY —
 * so a factory-scoped RCA report's `correlations[]` and "worst machine" leaked every
 * OTHER factory's machines even though the rest of the report was correctly scoped.
 * Fixed by threading `machineId` through to `collectMachinePerformance` too.
 *
 * This exercises the REAL `generateRCAReport` (unlike server/routers/aiAnalyticsScope.
 * test.ts, which mocks the whole service to test router-level scope enforcement) against
 * a DB-call spy that identifies each distinct sub-query by its `.select({...})` column
 * shape — unique per query in the source (only collectMachinePerformance selects
 * `machineCode`) — and records the exact filter built for it. Proves the
 * machine-performance query now receives a machineId-equality filter when
 * generateRCAReport is called with one, and stays unfiltered when it isn't (the
 * legitimate global-caller case, now gated to admin-only at the router boundary — see
 * aiAnalyticsScope.enforceGlobalReportScope — but the service itself must still support
 * both call shapes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Minimal drizzle-orm replacement — plain marker objects, no real SQL building.
// Matches the established pattern in this repo (see server/api/v1/dataApi.test.ts,
// server/api/v1/advice.test.ts) rather than exercising real SQL AST internals, which
// would make the test fragile to drizzle-orm version/formatting changes.
vi.mock("drizzle-orm", () => {
  const sqlTag = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const node: Record<string, unknown> = { __op: "sql", strings, vals };
    (node as { as?: (alias: string) => unknown }).as = (alias: string) => ({ ...node, __alias: alias });
    return node;
  };
  return {
    sql: sqlTag,
    and: (...args: unknown[]) => ({ __op: "and", args }),
    or: (...args: unknown[]) => ({ __op: "or", args }),
    eq: (...args: unknown[]) => ({ __op: "eq", args }),
    gte: (...args: unknown[]) => ({ __op: "gte", args }),
    lte: (...args: unknown[]) => ({ __op: "lte", args }),
    desc: (arg: unknown) => ({ __op: "desc", args: [arg] }),
  };
});

// ─── DB spy: every db.select(...) call is recorded with its column "shape" (which
// uniquely identifies WHICH of the three parallel sub-queries it is) plus the ordered
// list of chained method calls (from/innerJoin/leftJoin/where/groupBy/orderBy).
type Call = { method: string; args: unknown[] };
type SelectRecord = { shape: Record<string, unknown>; calls: Call[] };
let selects: SelectRecord[] = [];

function makeDb() {
  return {
    select: vi.fn((shape: Record<string, unknown>) => {
      const record: SelectRecord = { shape, calls: [] };
      selects.push(record);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        then: (resolve: (v: unknown[]) => void) => resolve([]),
      };
      for (const m of ["from", "innerJoin", "leftJoin", "where", "groupBy", "orderBy", "limit"]) {
        chain[m] = vi.fn((...args: unknown[]) => {
          record.calls.push({ method: m, args });
          return chain;
        });
      }
      return chain;
    }),
  };
}

const mockGetDb = vi.fn();
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => mockGetDb(...a) }));

vi.mock("./aiProviderRouter", () => ({
  generateNarrative: vi.fn(async () => ({
    text: "mock narrative",
    provider: "gguf" as const,
    fallbackUsed: false,
    totalTimeMs: 1,
    model: "mock-model",
  })),
}));

import { generateRCAReport } from "./aiReportGenerator";
import { productInspections, machines } from "../../drizzle/schema";

type Marker = { __op: string; args: unknown[] };

function whereArgOf(record: SelectRecord | undefined): Marker | undefined {
  return record?.calls.find(c => c.method === "where")?.args[0] as Marker | undefined;
}

// and(...) is always called flat (no nesting) in every collect* helper in
// aiReportGenerator.ts, so the marker's `args` IS the full condition list.
function flatConditionArgs(cond: Marker | undefined): unknown[] {
  return cond?.args ?? [];
}

function hasMachineIdEq(args: unknown[], machineId: number): boolean {
  return args.some(a => {
    const m = a as Marker;
    return m?.__op === "eq" && m.args[0] === productInspections.machineId && m.args[1] === machineId;
  });
}

beforeEach(() => {
  selects = [];
  mockGetDb.mockReset();
  mockGetDb.mockResolvedValue(makeDb());
});

describe("generateRCAReport — machine-performance sub-query scope (doc69 W0-3 fix #2)", () => {
  const period = { startDate: new Date("2026-07-01T00:00:00Z"), endDate: new Date("2026-07-02T00:00:00Z") };

  it("threads machineId into the machine-performance sub-query when the report is machine-scoped", async () => {
    await generateRCAReport({ ...period, machineId: 42, reportType: "rca" });

    // collectMachinePerformance is the ONLY sub-query that selects machineCode.
    const machinePerfSelect = selects.find(s => "machineCode" in s.shape);
    expect(machinePerfSelect).toBeDefined();
    expect(machinePerfSelect!.calls.some(c => c.method === "leftJoin" && c.args[0] === machines)).toBe(true);

    const args = flatConditionArgs(whereArgOf(machinePerfSelect));
    expect(hasMachineIdEq(args, 42)).toBe(true);
  });

  it("does NOT filter the machine-performance sub-query when no machineId is given (legitimate global caller)", async () => {
    await generateRCAReport({ ...period, reportType: "rca" });

    const machinePerfSelect = selects.find(s => "machineCode" in s.shape);
    expect(machinePerfSelect).toBeDefined();

    const args = flatConditionArgs(whereArgOf(machinePerfSelect));
    expect(args.some(a => (a as Marker)?.__op === "eq" && (a as Marker).args[0] === productInspections.machineId)).toBe(
      false,
    );
  });

  it("collectInspectionStats / collectTopDefects sub-queries remain machine-scoped (no regression)", async () => {
    await generateRCAReport({ ...period, machineId: 42, reportType: "rca" });

    const statsSelect = selects.find(s => "total" in s.shape && "ok" in s.shape && !("machineCode" in s.shape));
    expect(statsSelect).toBeDefined();
    expect(hasMachineIdEq(flatConditionArgs(whereArgOf(statsSelect)), 42)).toBe(true);

    const topDefectsSelect = selects.find(s => "defectType" in s.shape);
    expect(topDefectsSelect).toBeDefined();
    expect(hasMachineIdEq(flatConditionArgs(whereArgOf(topDefectsSelect)), 42)).toBe(true);
  });
});
