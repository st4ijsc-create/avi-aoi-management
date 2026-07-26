/**
 * AI Agent Housekeeping Scheduler tests (doc 69 Giai đoạn 4 / Wave 3, D4).
 *
 * Exercises:
 *  - initAgentHousekeepingScheduler() invokes BOTH expireStaleSessions() and
 *    expireStaleActions() on each interval tick when enabled.
 *  - AI_AGENT_HOUSEKEEPING_ENABLED=false → safe no-op (timer never arms; the
 *    cleanups are never invoked even after advancing time).
 *  - best-effort: expireStaleSessions() throwing does NOT prevent
 *    expireStaleActions() from running (and vice versa) — one failing cleanup
 *    never blocks the other.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const expireStaleSessions = vi.fn(async () => 0);
vi.mock("./aiAgentOrchestrator", () => ({
  expireStaleSessions: (...a: unknown[]) => expireStaleSessions(...a),
}));

const expireStaleActions = vi.fn(async () => 0);
vi.mock("./aiCopilotActions", () => ({
  expireStaleActions: (...a: unknown[]) => expireStaleActions(...a),
}));

import {
  runAgentHousekeepingOnce,
  initAgentHousekeepingScheduler,
  stopAgentHousekeepingScheduler,
  getAgentHousekeepingStatus,
} from "./aiAgentHousekeepingScheduler";

beforeEach(() => {
  vi.clearAllMocks();
  expireStaleSessions.mockResolvedValue(0);
  expireStaleActions.mockResolvedValue(0);
  delete process.env.AI_AGENT_HOUSEKEEPING_ENABLED;
  delete process.env.AI_AGENT_HOUSEKEEPING_INTERVAL_MS;
  stopAgentHousekeepingScheduler();
});

afterEach(() => {
  stopAgentHousekeepingScheduler();
  vi.useRealTimers();
  delete process.env.AI_AGENT_HOUSEKEEPING_ENABLED;
  delete process.env.AI_AGENT_HOUSEKEEPING_INTERVAL_MS;
});

describe("runAgentHousekeepingOnce", () => {
  it("invokes both expireStaleSessions() and expireStaleActions() and returns their counts", async () => {
    expireStaleSessions.mockResolvedValue(2);
    expireStaleActions.mockResolvedValue(3);

    const res = await runAgentHousekeepingOnce();

    expect(expireStaleSessions).toHaveBeenCalledTimes(1);
    expect(expireStaleActions).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ expiredSessions: 2, expiredActions: 3 });
  });

  it("best-effort: expireStaleSessions() throwing does not prevent expireStaleActions() from running", async () => {
    expireStaleSessions.mockRejectedValue(new Error("boom sessions"));
    expireStaleActions.mockResolvedValue(5);

    const res = await runAgentHousekeepingOnce();

    expect(expireStaleActions).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ expiredSessions: 0, expiredActions: 5 });
  });

  it("best-effort: expireStaleActions() throwing does not prevent expireStaleSessions() from running", async () => {
    expireStaleSessions.mockResolvedValue(4);
    expireStaleActions.mockRejectedValue(new Error("boom actions"));

    const res = await runAgentHousekeepingOnce();

    expect(expireStaleSessions).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ expiredSessions: 4, expiredActions: 0 });
  });

  it("both cleanups throwing degrades to {0,0} — never throws out of the function", async () => {
    expireStaleSessions.mockRejectedValue(new Error("boom"));
    expireStaleActions.mockRejectedValue(new Error("boom"));

    await expect(runAgentHousekeepingOnce()).resolves.toEqual({ expiredSessions: 0, expiredActions: 0 });
  });
});

describe("initAgentHousekeepingScheduler — enabled (default true)", () => {
  it("arms an interval that ticks both cleanups repeatedly", async () => {
    vi.useFakeTimers();
    process.env.AI_AGENT_HOUSEKEEPING_INTERVAL_MS = "60000";

    initAgentHousekeepingScheduler();
    expect(getAgentHousekeepingStatus().running).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireStaleSessions).toHaveBeenCalledTimes(1);
    expect(expireStaleActions).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireStaleSessions).toHaveBeenCalledTimes(2);
    expect(expireStaleActions).toHaveBeenCalledTimes(2);
  });

  it("is idempotent — calling init twice does not double-arm the timer", async () => {
    vi.useFakeTimers();
    process.env.AI_AGENT_HOUSEKEEPING_INTERVAL_MS = "60000";

    initAgentHousekeepingScheduler();
    initAgentHousekeepingScheduler();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireStaleSessions).toHaveBeenCalledTimes(1);
  });
});

describe("initAgentHousekeepingScheduler — AI_AGENT_HOUSEKEEPING_ENABLED=false", () => {
  it("is a safe no-op: the timer never arms and neither cleanup ever runs", async () => {
    vi.useFakeTimers();
    process.env.AI_AGENT_HOUSEKEEPING_ENABLED = "false";
    process.env.AI_AGENT_HOUSEKEEPING_INTERVAL_MS = "60000";

    initAgentHousekeepingScheduler();
    expect(getAgentHousekeepingStatus().running).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(expireStaleSessions).not.toHaveBeenCalled();
    expect(expireStaleActions).not.toHaveBeenCalled();
  });
});

describe("stopAgentHousekeepingScheduler", () => {
  it("clears the timer — no further ticks after stop", async () => {
    vi.useFakeTimers();
    process.env.AI_AGENT_HOUSEKEEPING_INTERVAL_MS = "60000";

    initAgentHousekeepingScheduler();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireStaleSessions).toHaveBeenCalledTimes(1);

    stopAgentHousekeepingScheduler();
    expect(getAgentHousekeepingStatus().running).toBe(false);

    await vi.advanceTimersByTimeAsync(180_000);
    expect(expireStaleSessions).toHaveBeenCalledTimes(1); // unchanged
  });

  it("is idempotent — calling stop when never started does not throw", () => {
    expect(() => stopAgentHousekeepingScheduler()).not.toThrow();
  });
});
