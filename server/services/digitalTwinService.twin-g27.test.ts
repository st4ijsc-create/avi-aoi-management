/**
 * Sprint G2.7 — digitalTwinService pure-helper tests.
 *
 * Covers: aggregateWipFlow (exited units excluded), stationLoadHeatmap (colors
 * match TWIN_STATUS_COLORS / lerp), buildPredictionOverlay (threshold → risk +
 * messageKey), and the SAFETY invariant that the service does NOT import
 * commandDispatcher / writeTags.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TWIN_STATUS_COLORS,
  aggregateWipFlow,
  stationLoadHeatmap,
  buildPredictionOverlay,
} from "./digitalTwinService";

describe("aggregateWipFlow", () => {
  it("excludes WIP that has exited (exitedAt != null)", () => {
    const agg = aggregateWipFlow([
      { currentStationId: 1, serialNumber: "A", exitedAt: null },
      { currentStationId: 1, serialNumber: "B", exitedAt: null },
      { currentStationId: 1, serialNumber: "C", exitedAt: new Date() }, // exited → ignored
      { currentStationId: 2, serialNumber: "D", exitedAt: null },
      { currentStationId: null, serialNumber: "E", exitedAt: null },    // no station → ignored
    ]);
    expect(agg.totalWip).toBe(3);
    expect(agg.stationCount).toBe(2);
    expect(agg.byStation.get(1)).toEqual({ count: 2, serials: ["A", "B"] });
    expect(agg.byStation.get(2)).toEqual({ count: 1, serials: ["D"] });
  });
});

describe("stationLoadHeatmap colors", () => {
  it("starved-dominant → amber (TWIN_STATUS_COLORS.starved)", () => {
    const [cell] = stationLoadHeatmap([
      { stationId: 1, avgDwellMs: 1000, avgStarvedMs: 800, avgBlockedMs: 100, samples: 5 },
    ]);
    expect(cell.dominantState).toBe("starved");
    expect(cell.color).toBe(TWIN_STATUS_COLORS.starved);
  });

  it("blocked-dominant → orange (TWIN_STATUS_COLORS.blocked)", () => {
    const [cell] = stationLoadHeatmap([
      { stationId: 2, avgDwellMs: 1000, avgStarvedMs: 100, avgBlockedMs: 700, samples: 5 },
    ]);
    expect(cell.dominantState).toBe("blocked");
    expect(cell.color).toBe(TWIN_STATUS_COLORS.blocked);
  });

  it("processing → lerp green→red (neither gray nor amber/orange)", () => {
    const [cell] = stationLoadHeatmap([
      { stationId: 3, avgDwellMs: 1000, avgStarvedMs: 0, avgBlockedMs: 0, samples: 5 },
    ]);
    expect(cell.dominantState).toBe("processing");
    expect(cell.loadPct).toBeGreaterThan(0);
    expect(cell.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(cell.color).not.toBe(TWIN_STATUS_COLORS.starved);
    expect(cell.color).not.toBe(TWIN_STATUS_COLORS.blocked);
    expect(cell.color).not.toBe(TWIN_STATUS_COLORS.stopped);
  });

  it("idle (no samples, no dwell) → gray (TWIN_STATUS_COLORS.stopped)", () => {
    const [cell] = stationLoadHeatmap([
      { stationId: 4, avgDwellMs: 0, avgStarvedMs: 0, avgBlockedMs: 0, samples: 0 },
    ]);
    expect(cell.dominantState).toBe("idle");
    expect(cell.color).toBe(TWIN_STATUS_COLORS.stopped);
  });
});

describe("buildPredictionOverlay", () => {
  it("predicted WIP over threshold → high + messageKey", () => {
    const [cell] = buildPredictionOverlay([{ stationId: 1, predictedWipNext1h: 50 }], 40);
    expect(cell.congestionRisk).toBe("high");
    expect(cell.messageKey).toBe("digitalTwin.prediction.high");
    expect(cell.color).toBe(TWIN_STATUS_COLORS.error);
  });

  it("between 60% and threshold → medium", () => {
    const [cell] = buildPredictionOverlay([{ stationId: 1, predictedWipNext1h: 30 }], 40);
    expect(cell.congestionRisk).toBe("medium");
    expect(cell.messageKey).toBe("digitalTwin.prediction.medium");
    expect(cell.color).toBe(TWIN_STATUS_COLORS.starved);
  });

  it("well below threshold → low", () => {
    const [cell] = buildPredictionOverlay([{ stationId: 1, predictedWipNext1h: 5 }], 40);
    expect(cell.congestionRisk).toBe("low");
    expect(cell.messageKey).toBe("digitalTwin.prediction.low");
    expect(cell.color).toBe(TWIN_STATUS_COLORS.stopped);
  });
});

describe("SAFETY — read-only service", () => {
  it("does NOT import commandDispatcher / writeTags", () => {
    const src = readFileSync(join(__dirname, "digitalTwinService.ts"), "utf8");
    expect(src).not.toMatch(/commandDispatcher/);
    expect(src).not.toMatch(/writeTags/);
    // pure helpers must not touch the DB connection either
    expect(src).not.toMatch(/getDb\(/);
  });
});
