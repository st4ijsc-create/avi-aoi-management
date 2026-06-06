import { describe, it, expect } from "vitest";
import { rankDispatch, isDispatchingEnabled, type DispatchInput } from "./dispatchingService";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function baseInput(): DispatchInput {
  return {
    now: NOW,
    items: [
      { serialNumber: "SN-FIFO", currentStationId: 10, status: "queued", priority: 3, enteredAt: new Date(NOW.getTime() - 5 * 60000) },
      { serialNumber: "SN-BLOCK", currentStationId: 20, status: "blocked", priority: 3, enteredAt: new Date(NOW.getTime() - 10 * 60000) },
      { serialNumber: "SN-STARVE", currentStationId: 30, status: "starved", priority: 3, enteredAt: new Date(NOW.getTime() - 2 * 60000) },
    ],
    stations: [
      { stationId: 30, isBottleneck: true },
    ],
  };
}

describe("dispatchingService.rankDispatch", () => {
  it("blocked WIP ranks above normal queued", () => {
    const res = rankDispatch(baseInput());
    const block = res.recommendations.find((r) => r.serialNumber === "SN-BLOCK")!;
    const fifo = res.recommendations.find((r) => r.serialNumber === "SN-FIFO")!;
    expect(block.score).toBeGreaterThan(fifo.score);
    expect(block.reasons).toContain("clear_blocked");
  });

  it("starved item at bottleneck gets feed reason", () => {
    const res = rankDispatch(baseInput());
    const starve = res.recommendations.find((r) => r.serialNumber === "SN-STARVE")!;
    expect(starve.reasons).toContain("feed_starved_bottleneck");
    expect(res.bottleneckStationIds).toEqual([30]);
  });

  it("assigns sequential ranks and respects maxRecommendations", () => {
    const input = baseInput();
    input.maxRecommendations = 2;
    const res = rankDispatch(input);
    expect(res.recommendations).toHaveLength(2);
    expect(res.recommendations[0].rank).toBe(1);
    expect(res.recommendations[1].rank).toBe(2);
    expect(res.totalItems).toBe(3);
  });

  it("higher priority outranks lower priority when otherwise equal", () => {
    const res = rankDispatch({
      now: NOW,
      items: [
        { serialNumber: "A", currentStationId: 1, status: "queued", priority: 5 },
        { serialNumber: "B", currentStationId: 1, status: "queued", priority: 1 },
      ],
    });
    expect(res.recommendations[0].serialNumber).toBe("A");
    expect(res.recommendations[0].reasons).toContain("high_priority");
  });

  it("overdue item is boosted", () => {
    const res = rankDispatch({
      now: NOW,
      items: [
        { serialNumber: "OVERDUE", currentStationId: 1, status: "queued", priority: 3, dueDate: new Date(NOW.getTime() - 60000) },
        { serialNumber: "NORMAL", currentStationId: 1, status: "queued", priority: 3 },
      ],
    });
    expect(res.recommendations[0].serialNumber).toBe("OVERDUE");
    expect(res.recommendations[0].reasons).toContain("overdue");
  });

  it("isDispatchingEnabled reflects env flag", () => {
    const prev = process.env.DISPATCHING_REALTIME_ENABLED;
    process.env.DISPATCHING_REALTIME_ENABLED = "true";
    expect(isDispatchingEnabled()).toBe(true);
    process.env.DISPATCHING_REALTIME_ENABLED = "false";
    expect(isDispatchingEnabled()).toBe(false);
    if (prev === undefined) delete process.env.DISPATCHING_REALTIME_ENABLED;
    else process.env.DISPATCHING_REALTIME_ENABLED = prev;
  });
});
