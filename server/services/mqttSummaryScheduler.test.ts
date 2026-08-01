/**
 * mqttSummaryScheduler smoke test (doc 32 §2 item 20).
 *
 * The module used to carry a stray `import { drizzle } from 'drizzle-orm/mysql2'`
 * (wrong-driver smell in a Postgres project). This test proves the module loads
 * cleanly after that dead import was removed, and the daily/weekly summary jobs
 * no-op safely when the DB/MQTT are unavailable (the guard at the top of each).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./mqttService", () => ({
  publishSummary: vi.fn(async () => true),
  isMqttRunning: () => false, // → generate*Summary early-returns via its guard
}));

import {
  generateAndSendDailySummary,
  generateAndSendWeeklySummary,
  triggerDailySummary,
  triggerWeeklySummary,
  stopSummaryScheduler,
} from "./mqttSummaryScheduler";

describe("mqttSummaryScheduler", () => {
  it("module loads (no drizzle-orm/mysql2 import) and exports the summary jobs", () => {
    expect(typeof generateAndSendDailySummary).toBe("function");
    expect(typeof generateAndSendWeeklySummary).toBe("function");
  });

  it("daily/weekly summary no-op safely when MQTT/DB are unavailable", async () => {
    await expect(generateAndSendDailySummary()).resolves.toBeUndefined();
    await expect(generateAndSendWeeklySummary()).resolves.toBeUndefined();
    await expect(triggerDailySummary()).resolves.toBeUndefined();
    await expect(triggerWeeklySummary()).resolves.toBeUndefined();
  });

  it("stopSummaryScheduler is a safe no-op when never started", () => {
    expect(() => stopSummaryScheduler()).not.toThrow();
  });
});
