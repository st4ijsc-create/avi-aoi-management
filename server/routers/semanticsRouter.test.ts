/**
 * semanticsRouter tests — doc 44 Batch W2-A4 (G2.14 + G2.15).
 *
 * The registry itself is covered by metricRegistry.test.ts; here we verify the
 * ROUTER contract: zod input validation (window ≤ 90 days, to > from, scopeId
 * int+), auth (protectedProcedure), NOT_FOUND for unknown definitions, honest
 * registry errors mapped to the right TRPC codes, and MetricResult passthrough
 * (incl. definition_version).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate the router from the real registry (files/DB) — the mocked class keeps
// identity with what the router imports, so `instanceof` mapping is exercised.
vi.mock("../services/semantics/metricRegistry", () => {
  class MetricComputeError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = "MetricComputeError";
    }
  }
  return {
    MetricComputeError,
    listMetrics: vi.fn(),
    getDefinition: vi.fn(),
    computeMetric: vi.fn(),
  };
});

import {
  listMetrics,
  getDefinition,
  computeMetric,
  MetricComputeError,
} from "../services/semantics/metricRegistry";
import { semanticsRouter } from "./semanticsRouter";

const mockList = vi.mocked(listMetrics);
const mockGet = vi.mocked(getDefinition);
const mockCompute = vi.mocked(computeMetric);

const OEE_DEF = {
  metric: "OEE",
  version: 1,
  scope: ["equipment", "line"],
  formula: "availability * performance * quality",
  implementation: { equipment: "oeeService.getMachineOEELive", line: "oeeService.getLineOEE" },
  inputs: [{ name: "online_seconds", source: "machine_status_logs" }],
} as any;

const authedCaller = () =>
  semanticsRouter.createCaller({ user: { id: 7, role: "user", name: "Kỹ sư" } } as any);

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockReturnValue([{ ...OEE_DEF, definition_version: "OEE@v1" }]);
  mockGet.mockImplementation((n: string) => (n.toLowerCase() === "oee" ? OEE_DEF : undefined));
});

describe("auth", () => {
  it("rejects unauthenticated callers (protectedProcedure)", async () => {
    const anon = semanticsRouter.createCaller({ user: null } as any);
    await expect(anon.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("list / get", () => {
  it("list returns the governed catalogue", async () => {
    const rows = await authedCaller().list();
    expect(rows).toHaveLength(1);
    expect(rows[0].definition_version).toBe("OEE@v1");
  });

  it("get returns the full definition; NOT_FOUND for unknown metric", async () => {
    const def = await authedCaller().get({ metric: "OEE" });
    expect(def.formula).toBe("availability * performance * quality");
    await expect(authedCaller().get({ metric: "MTBF" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("get rejects an empty metric name (zod)", async () => {
    await expect(authedCaller().get({ metric: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("compute — zod window guard", () => {
  const base = { metric: "OEE", scope: "line", scopeId: 3 };

  it("passes valid input through and returns the MetricResult untouched", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - DAY);
    const result = {
      metric: "OEE", scope: "line", path: "SMT Line 1",
      window: { from: from.toISOString(), to: to.toISOString() },
      value: 0.87,
      parts: { availability: 0.94, performance: 0.95, quality: 0.97 },
      definition_version: "OEE@v1",
    };
    mockCompute.mockResolvedValue(result as any);

    const res = await authedCaller().compute({ ...base, from, to });
    expect(mockCompute).toHaveBeenCalledWith("OEE", { scope: "line", scopeId: 3, from, to });
    expect(res).toEqual(result);
    expect(res.definition_version).toBe("OEE@v1"); // §10.2 traceability field
  });

  it("rejects a window longer than 90 days", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 91 * DAY);
    await expect(authedCaller().compute({ ...base, from, to }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockCompute).not.toHaveBeenCalled();
  });

  it("accepts exactly 90 days", async () => {
    mockCompute.mockResolvedValue({ metric: "OEE", scope: "line", window: { from: "", to: "" }, value: null, definition_version: "OEE@v1" } as any);
    const to = new Date();
    const from = new Date(to.getTime() - 90 * DAY);
    await expect(authedCaller().compute({ ...base, from, to })).resolves.toBeTruthy();
  });

  it("rejects to <= from", async () => {
    const t = new Date();
    await expect(authedCaller().compute({ ...base, from: t, to: t }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a non-positive / non-integer scopeId", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - DAY);
    await expect(authedCaller().compute({ ...base, scopeId: 0, from, to }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(authedCaller().compute({ ...base, scopeId: 1.5, from, to }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("compute — honest registry errors mapped to TRPC codes", () => {
  const window = () => {
    const to = new Date();
    return { from: new Date(to.getTime() - DAY), to };
  };

  it("UNSUPPORTED_SCOPE → BAD_REQUEST with the honest message", async () => {
    mockCompute.mockRejectedValue(
      new (MetricComputeError as any)("UNSUPPORTED_SCOPE", 'Metric "OEE" (v1) does not define scope "factory" — supported scopes: [equipment, line]'),
    );
    await expect(authedCaller().compute({ metric: "OEE", scope: "factory", ...window() }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("supported scopes") });
  });

  it("METRIC_NOT_FOUND → NOT_FOUND", async () => {
    mockCompute.mockRejectedValue(new (MetricComputeError as any)("METRIC_NOT_FOUND", 'Unknown metric "MTBF"'));
    await expect(authedCaller().compute({ metric: "MTBF", scope: "equipment", scopeId: 1, ...window() }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("SCOPE_ID_REQUIRED → BAD_REQUEST", async () => {
    mockCompute.mockRejectedValue(new (MetricComputeError as any)("SCOPE_ID_REQUIRED", "scope requires scopeId"));
    await expect(authedCaller().compute({ metric: "OEE", scope: "equipment", ...window() }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("unexpected errors are NOT swallowed into BAD_REQUEST", async () => {
    mockCompute.mockRejectedValue(new Error("db exploded"));
    await expect(authedCaller().compute({ metric: "OEE", scope: "line", scopeId: 3, ...window() }))
      .rejects.toMatchObject({ message: "db exploded" });
  });
});
