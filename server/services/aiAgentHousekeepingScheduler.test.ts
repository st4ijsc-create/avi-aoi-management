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

// Wave 1 (w1-2) — runAgentHousekeepingOnce() also expires stale
// ai_specialist_sessions ("running" past AI_SPECIALIST_RUN_TIMEOUT_MS). Mocked here
// for the same reason as the two cleanups above: keep this a real unit test, no DB.
const expireStaleSpecialistSessions = vi.fn(async () => 0);
vi.mock("../db/aiSpecialist", () => ({
  expireStaleSpecialistSessions: (...a: unknown[]) => expireStaleSpecialistSessions(...a),
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
  expireStaleSpecialistSessions.mockResolvedValue(0);
  delete process.env.AI_AGENT_HOUSEKEEPING_ENABLED;
  delete process.env.AI_AGENT_HOUSEKEEPING_INTERVAL_MS;
  delete process.env.AI_SPECIALIST_RUN_TIMEOUT_MS;
  stopAgentHousekeepingScheduler();
});

afterEach(() => {
  stopAgentHousekeepingScheduler();
  vi.useRealTimers();
  delete process.env.AI_AGENT_HOUSEKEEPING_ENABLED;
  delete process.env.AI_AGENT_HOUSEKEEPING_INTERVAL_MS;
  delete process.env.AI_SPECIALIST_RUN_TIMEOUT_MS;
});

describe("runAgentHousekeepingOnce", () => {
  it("invokes expireStaleSessions(), expireStaleActions() and expireStaleSpecialistSessions(), and returns their counts", async () => {
    expireStaleSessions.mockResolvedValue(2);
    expireStaleActions.mockResolvedValue(3);
    expireStaleSpecialistSessions.mockResolvedValue(1);

    const res = await runAgentHousekeepingOnce();

    expect(expireStaleSessions).toHaveBeenCalledTimes(1);
    expect(expireStaleActions).toHaveBeenCalledTimes(1);
    expect(expireStaleSpecialistSessions).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ expiredSessions: 2, expiredActions: 3, expiredSpecialist: 1 });
  });

  it("best-effort: expireStaleSessions() throwing does not prevent expireStaleActions() from running", async () => {
    expireStaleSessions.mockRejectedValue(new Error("boom sessions"));
    expireStaleActions.mockResolvedValue(5);

    const res = await runAgentHousekeepingOnce();

    expect(expireStaleActions).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ expiredSessions: 0, expiredActions: 5, expiredSpecialist: 0 });
  });

  it("best-effort: expireStaleActions() throwing does not prevent expireStaleSessions() from running", async () => {
    expireStaleSessions.mockResolvedValue(4);
    expireStaleActions.mockRejectedValue(new Error("boom actions"));

    const res = await runAgentHousekeepingOnce();

    expect(expireStaleSessions).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ expiredSessions: 4, expiredActions: 0, expiredSpecialist: 0 });
  });

  it("both cleanups throwing degrades to {0,0} — never throws out of the function", async () => {
    expireStaleSessions.mockRejectedValue(new Error("boom"));
    expireStaleActions.mockRejectedValue(new Error("boom"));

    await expect(runAgentHousekeepingOnce()).resolves.toEqual({ expiredSessions: 0, expiredActions: 0, expiredSpecialist: 0 });
  });

  it("best-effort: expireStaleSpecialistSessions() throwing does not prevent the other two, and degrades to 0 (Wave 1 w1-2)", async () => {
    expireStaleSessions.mockResolvedValue(1);
    expireStaleActions.mockResolvedValue(1);
    expireStaleSpecialistSessions.mockRejectedValue(new Error("boom specialist"));

    const res = await runAgentHousekeepingOnce();

    expect(expireStaleSessions).toHaveBeenCalledTimes(1);
    expect(expireStaleActions).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ expiredSessions: 1, expiredActions: 1, expiredSpecialist: 0 });
  });

  it("passes AI_SPECIALIST_RUN_TIMEOUT_MS (default 900000) through to expireStaleSpecialistSessions() (Wave 1 w1-2)", async () => {
    await runAgentHousekeepingOnce();
    expect(expireStaleSpecialistSessions).toHaveBeenCalledWith(900_000);

    process.env.AI_SPECIALIST_RUN_TIMEOUT_MS = "120000";
    await runAgentHousekeepingOnce();
    expect(expireStaleSpecialistSessions).toHaveBeenCalledWith(120_000);
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
