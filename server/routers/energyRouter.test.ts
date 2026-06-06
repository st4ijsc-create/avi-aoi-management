/**
 * Sprint G2.6a — energyRouter tests.
 *
 * Covers: RBAC gate (canView/canCreate/canEdit), recordReading PF ∈ [0,1]
 * validation, demand-response text-only output, and the SAFETY invariant that
 * the router does NOT import commandDispatcher / writeTags.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── db mock (telemetry write + enpi helpers) ───────────────────
const recordEnergyReadingMock = vi.fn(async () => 99);
vi.mock("../db", () => ({
  recordEnergyReading: (...a: any[]) => recordEnergyReadingMock(...a),
  listEnpiMetrics: vi.fn(async () => []),
  upsertEnpiSnapshot: vi.fn(async () => ({ id: 1, updated: false })),
}));

// ── timescale mock (TSDB disabled) ─────────────────────────────
vi.mock("../db/timescale", () => ({
  isTsdbEnabled: vi.fn(() => false),
  insertEnergyReading: vi.fn(async () => false),
}));

// ── service mock ───────────────────────────────────────────────
vi.mock("../services/energyAnalyticsService", () => ({
  computeRecipeEnergy: vi.fn(async () => [{ recipeRef: "RA", totalKwh: 5, unitsProduced: 5, kwhPerUnit: 1 }]),
  computePeakDemand: vi.fn(async () => ({ instantaneousPeakKw: 30, peakAt: new Date(0), rollingDemandKw: 25, rollingWindowMin: 15, demandByBucket: [], source: "main_pg" })),
  computePowerFactor: vi.fn(async () => ({ available: true, avgPowerFactor: 0.92, minPowerFactor: 0.8, threshold: 0.9, samples: 5, pfSamples: 5, belowThreshold: 1, pctBelowThreshold: 20 })),
  forecastEnergy: vi.fn(async () => ({ metric: "powerKw", available: true, pointsUsed: 5, bucket: "60 minutes", forecast: [], predictedPeak: 40 })),
  suggestDemandResponse: vi.fn((_f: any, _p: any, _t: number) => [{ severity: "info", messageKey: "energy.demandResponse.withinLimits", detail: {} }]),
}));

// ── RBAC gate mock (per-action toggles) ────────────────────────
const perm = { canView: true, canCreate: true, canEdit: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: (_module: string, action: "canView" | "canCreate" | "canEdit") => async ({ ctx, next }: any) => {
    if (!perm[action]) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: `no ${action}` });
    }
    return next({ ctx });
  },
}));

import { energyRouter } from "./energyRouter";

const ctx = { user: { id: 3, role: "supervisor", name: "Sup" } } as any;
const caller = energyRouter.createCaller(ctx);
const RANGE = { from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-02T00:00:00Z") };

beforeEach(() => {
  perm.canView = true;
  perm.canCreate = true;
  perm.canEdit = true;
  recordEnergyReadingMock.mockClear();
});

describe("RBAC gates", () => {
  it("recipeEnergy requires canView", async () => {
    perm.canView = false;
    await expect(caller.recipeEnergy(RANGE)).rejects.toMatchObject({ code: "FORBIDDEN" });
    perm.canView = true;
    await expect(caller.recipeEnergy(RANGE)).resolves.toBeDefined();
  });

  it("recordReading requires canCreate", async () => {
    perm.canCreate = false;
    await expect(caller.recordReading({ value: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("snapshotEnpi requires canEdit", async () => {
    perm.canEdit = false;
    await expect(caller.snapshotEnpi(RANGE)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("recordReading — telemetry + PF validation", () => {
  it("rejects powerFactor > 1", async () => {
    await expect(caller.recordReading({ value: 1, powerFactor: 1.5 })).rejects.toBeDefined();
    expect(recordEnergyReadingMock).not.toHaveBeenCalled();
  });

  it("rejects negative powerFactor", async () => {
    await expect(caller.recordReading({ value: 1, powerFactor: -0.1 })).rejects.toBeDefined();
  });

  it("accepts a valid reading and writes telemetry (string-coerced)", async () => {
    const out = await caller.recordReading({ value: 12.5, powerKw: 8, powerFactor: 0.95, recipeRef: "RA" });
    expect(out.id).toBe(99);
    expect(out.mirroredToTsdb).toBe(false); // TSDB disabled
    const arg = recordEnergyReadingMock.mock.calls[0][0] as any;
    expect(arg.value).toBe("12.5");
    expect(arg.powerFactor).toBe("0.95");
    expect(arg.recipeRef).toBe("RA");
  });
});

describe("demandResponse — text only", () => {
  it("returns suggestions with messageKey + no command/action fields", async () => {
    const out = await caller.demandResponse({ ...RANGE, thresholdKw: 100 });
    expect(out.suggestions[0]).toHaveProperty("messageKey");
    for (const s of out.suggestions) {
      expect(s).not.toHaveProperty("command");
      expect(s).not.toHaveProperty("action");
    }
  });
});

describe("SAFETY — no machine-write path", () => {
  const importsModule = (src: string, name: string) =>
    new RegExp(`(import|require)[^\\n]*${name}`, "i").test(
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    );

  it("energyRouter source does NOT import commandDispatcher or writeTags", () => {
    const src = readFileSync(join(process.cwd(), "server", "routers", "energyRouter.ts"), "utf-8");
    expect(importsModule(src, "commandDispatcher")).toBe(false);
    expect(importsModule(src, "writeTags")).toBe(false);
  });
});
