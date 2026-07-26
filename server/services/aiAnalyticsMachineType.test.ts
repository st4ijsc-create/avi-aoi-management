/**
 * Doc 69 Wave 2 / A1 — machineType as a first-class analytics dimension +
 * robot/OT KPIs routed into the comprehensive report.
 *
 * Covers:
 *  (1) `buildAnalyticsConditions` — the machineType condition is purely additive:
 *      it only appears when BOTH the call site opts in (ConditionOptions.machineType)
 *      AND the caller supplied params.machineType. Omitting it is byte-identical to
 *      before this task (proven at the condition-count level, no DB needed).
 *  (2) DB integration — machineType actually NARROWS getDefectTrend/
 *      getMachinePerformance results, and `getByMachineTypeBreakdown` groups
 *      yield/defect/count correctly per machine type (AOI vs AVI).
 *  (3) `getRobotsSection` — populated from robots/robot_telemetry/
 *      robot_behavior_anomalies (the SAME tables aiRobotAnomalyRouter reads),
 *      respects factory scope (mirrors aiAnalyticsScope's join chain), and is
 *      fail-safe (empty section, never a throw) when scoped to a factory with no
 *      robots.
 *  (4) `generateComprehensiveReport` — the two new sections (`byMachineType`,
 *      `robots`) are ADDITIVE: every pre-existing field keeps its shape/values.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as db from "../db";
import { getDb } from "../db/connection";
import { robots, robotTelemetry, robotBehaviorAnomalies } from "../../drizzle/schema";
import {
  buildAnalyticsConditions,
  getDefectTrend,
  getMachinePerformance,
  getByMachineTypeBreakdown,
  getRobotsSection,
  generateComprehensiveReport,
} from "./aiInspectionAnalytics";

// ─── (1) buildAnalyticsConditions — pure, no DB ────────────────────────────

describe("buildAnalyticsConditions — machineType is purely additive (doc69 Wave2/A1)", () => {
  const base = { startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-01-02T00:00:00Z") };

  it("no machineType condition when params.machineType is absent, even if the call site opts in", () => {
    const optedIn = buildAnalyticsConditions(base, { machineType: true });
    const optedOut = buildAnalyticsConditions(base, {});
    expect(optedIn.length).toBe(2); // only the two date-range conditions
    expect(optedIn.length).toBe(optedOut.length);
  });

  it("no machineType condition when the call site does not opt in, even if params.machineType is set", () => {
    const conditions = buildAnalyticsConditions({ ...base, machineType: "AOI" }, {});
    expect(conditions.length).toBe(2);
  });

  it("exactly one extra condition when both the call site opts in AND params.machineType is set", () => {
    const conditions = buildAnalyticsConditions({ ...base, machineType: "AOI" }, { machineType: true });
    expect(conditions.length).toBe(3);
  });

  it("blank/whitespace machineType is treated as absent (mirrors productModel's .trim() handling)", () => {
    const conditions = buildAnalyticsConditions({ ...base, machineType: "   " }, { machineType: true });
    expect(conditions.length).toBe(2);
  });
});

// ─── (2)+(4) DB integration — machineType filter/breakdown + comprehensive report ──

describe("machineType as an analytics filter + byMachineType breakdown (DB integration)", () => {
  const ts = Date.now();
  const factoryCode = `TEST_FAC_MT_${ts}`;
  const windowStart = new Date("2026-05-01T00:00:00Z");
  const windowEnd = new Date("2026-05-10T00:00:00Z");
  let aoiMachineCode: string;
  let aviMachineCode: string;

  beforeAll(async () => {
    const factoryId = await db.createFactory({ code: factoryCode, name: "MT fac" });
    const workshopId = await db.createWorkshop({ factoryId, code: `TEST_WS_MT_${ts}`, name: "MT ws" });
    const lineId = await db.createProductionLine({ workshopId, code: `TEST_LINE_MT_${ts}`, name: "MT line" });
    const stationId = await db.createStation({ lineId, code: `TEST_ST_MT_${ts}`, name: "MT st", orderIndex: 1 });

    aoiMachineCode = `M_MT_AOI_${ts}`;
    aviMachineCode = `M_MT_AVI_${ts}`;
    const aoiMachineId = await db.createMachine({
      stationId, code: aoiMachineCode, name: "MT AOI machine", machineType: "AOI", apiKey: `test_mt_aoi_${ts}`,
    });
    const aviMachineId = await db.createMachine({
      stationId, code: aviMachineCode, name: "MT AVI machine", machineType: "AVI", apiKey: `test_mt_avi_${ts}`,
    });

    // AOI: 3 OK + 1 NG = 4 total → 75% yield
    const aoiResults: Array<"OK" | "NG"> = ["OK", "OK", "OK", "NG"];
    for (let i = 0; i < aoiResults.length; i++) {
      await db.createProductInspection({
        machineId: aoiMachineId,
        factoryCode,
        serialNumber: `SN_MT_AOI_${ts}_${i}`,
        overallResult: aoiResults[i],
        originalResult: aoiResults[i],
        inspectionTime: new Date("2026-05-05T03:00:00Z"),
      } as any);
    }

    // AVI: 1 OK + 1 NG = 2 total → 50% yield
    const aviResults: Array<"OK" | "NG"> = ["OK", "NG"];
    for (let i = 0; i < aviResults.length; i++) {
      await db.createProductInspection({
        machineId: aviMachineId,
        factoryCode,
        serialNumber: `SN_MT_AVI_${ts}_${i}`,
        overallResult: aviResults[i],
        originalResult: aviResults[i],
        inspectionTime: new Date("2026-05-05T04:00:00Z"),
      } as any);
    }
  });

  it("getDefectTrend: omitting machineType aggregates BOTH types (identical to pre-task behavior)", async () => {
    const all = await getDefectTrend({ startDate: windowStart, endDate: windowEnd, factoryCode });
    const total = all.reduce((s, t) => s + t.total, 0);
    expect(total).toBe(6);
  });

  it("getDefectTrend: machineType='AOI' narrows to just the AOI machine's 4 inspections", async () => {
    const aoiOnly = await getDefectTrend({ startDate: windowStart, endDate: windowEnd, factoryCode, machineType: "AOI" });
    const total = aoiOnly.reduce((s, t) => s + t.total, 0);
    expect(total).toBe(4);
  });

  it("getDefectTrend: machineType='AVI' narrows to just the AVI machine's 2 inspections", async () => {
    const aviOnly = await getDefectTrend({ startDate: windowStart, endDate: windowEnd, factoryCode, machineType: "AVI" });
    const total = aviOnly.reduce((s, t) => s + t.total, 0);
    expect(total).toBe(2);
  });

  it("getMachinePerformance: machineType filter excludes the other type's machine entirely", async () => {
    const aoiOnly = await getMachinePerformance({ startDate: windowStart, endDate: windowEnd, factoryCode, machineType: "AOI" });
    expect(aoiOnly.map(m => m.machineCode)).toEqual([aoiMachineCode]);
    expect(aoiOnly[0].totalInspections).toBe(4);
    expect(aoiOnly[0].passCount).toBe(3);
    expect(aoiOnly[0].failCount).toBe(1);
  });

  it("getMachinePerformance: an unknown machineType narrows to ZERO results, never throws", async () => {
    const none = await getMachinePerformance({
      startDate: windowStart, endDate: windowEnd, factoryCode, machineType: "NOT_A_REAL_TYPE",
    });
    expect(none).toEqual([]);
  });

  it("getByMachineTypeBreakdown: groups yield/defect/count correctly per machine type", async () => {
    const breakdown = await getByMachineTypeBreakdown({ startDate: windowStart, endDate: windowEnd, factoryCode });
    const byType = Object.fromEntries(breakdown.map(b => [b.machineType, b]));

    expect(byType.AOI).toMatchObject({ totalInspections: 4, passCount: 3, failCount: 1, activeMachines: 1 });
    expect(byType.AOI.yieldRate).toBeCloseTo(75, 1);
    expect(byType.AOI.defectRate).toBeCloseTo(25, 1);

    expect(byType.AVI).toMatchObject({ totalInspections: 2, passCount: 1, failCount: 1, activeMachines: 1 });
    expect(byType.AVI.yieldRate).toBeCloseTo(50, 1);
  });

  it("generateComprehensiveReport: byMachineType + robots are ADDITIVE — existing fields keep their shape/values", async () => {
    const report = await generateComprehensiveReport({ startDate: windowStart, endDate: windowEnd, factoryCode });

    // Pre-existing overview math is unchanged by this task.
    expect(report.overview.totalInspections).toBe(6);
    expect(report.overview.passCount).toBe(4);
    expect(report.overview.failCount).toBe(2);

    // New additive fields are present with the right shape.
    const byType = Object.fromEntries(report.byMachineType.map(b => [b.machineType, b]));
    expect(byType.AOI.totalInspections).toBe(4);
    expect(byType.AVI.totalInspections).toBe(2);

    expect(report.robots).toBeDefined();
    expect(Array.isArray(report.robots.robots)).toBe(true);
    expect(Array.isArray(report.robots.recentAnomalies)).toBe(true);
  });
});

// ─── (3) getRobotsSection — robot/OT KPIs (DB integration) ─────────────────

describe("getRobotsSection — robot/OT KPIs routed into analytics (doc69 Wave2/A1)", () => {
  const ts = Date.now() + 1; // distinct from the describe block above
  const factoryCode = `TEST_FAC_ROB_${ts}`;
  const robotCode = `TEST_ROBOT_${ts}`;
  let robotId: number;

  beforeAll(async () => {
    const factoryId = await db.createFactory({ code: factoryCode, name: "ROB fac" });
    const workshopId = await db.createWorkshop({ factoryId, code: `TEST_WS_ROB_${ts}`, name: "ROB ws" });
    const lineId = await db.createProductionLine({ workshopId, code: `TEST_LINE_ROB_${ts}`, name: "ROB line" });
    const stationId = await db.createStation({ lineId, code: `TEST_ST_ROB_${ts}`, name: "ROB st", orderIndex: 1 });

    const database = await getDb();
    if (!database) throw new Error("Test DB unavailable");

    const [robotRow] = await database
      .insert(robots)
      .values({
        code: robotCode,
        name: "MT test robot",
        vendor: "sim",
        kind: "arm",
        endpoint: "sim://test",
        isEnabled: true,
        status: "idle",
        stationId,
        lastSeenAt: new Date(),
      })
      .returning({ id: robots.id });
    robotId = robotRow.id;

    await database.insert(robotTelemetry).values({
      robotId,
      mode: "auto",
      busy: false,
      estop: false,
      speedPct: 77,
      batteryLevel: "91.50",
      timestamp: new Date(),
    });

    await database.insert(robotBehaviorAnomalies).values({
      robotId,
      kind: "cycle_time_trend",
      score: "3.5000",
      severity: "high",
      status: "raised",
    });
  });

  it("scoped to the seeded factory: returns the robot with its latest telemetry + anomaly", async () => {
    const section = await getRobotsSection({ factoryCode });

    expect(section.totalRobots).toBe(1);
    expect(section.activeRobots).toBe(1);
    expect(section.onlineRobots).toBe(1); // status='idle' !== 'offline'

    const robot = section.robots.find(r => r.robotCode === robotCode);
    expect(robot).toBeDefined();
    expect(robot!.vendor).toBe("sim");
    expect(robot!.latestTelemetry).toMatchObject({ mode: "auto", busy: false, estop: false, speedPct: 77 });
    expect(robot!.latestTelemetry!.batteryLevel).toBeCloseTo(91.5, 1);

    expect(section.recentAnomalies).toHaveLength(1);
    expect(section.recentAnomalies[0]).toMatchObject({ robotId, kind: "cycle_time_trend", severity: "high" });
    expect(section.anomalyCountBySeverity.high).toBe(1);
  });

  it("scoped to a DIFFERENT factory: fail-safe EMPTY section — no cross-factory leak, no throw", async () => {
    const section = await getRobotsSection({ factoryCode: `NON_EXISTENT_FACTORY_${ts}` });
    expect(section).toEqual({
      totalRobots: 0,
      activeRobots: 0,
      onlineRobots: 0,
      robots: [],
      recentAnomalies: [],
      anomalyCountBySeverity: {},
    });
  });

  it("unscoped (global/admin) call includes the seeded robot among all robots", async () => {
    const section = await getRobotsSection();
    const robot = section.robots.find(r => r.robotCode === robotCode);
    expect(robot).toBeDefined();
  });

  it("no factoryCode + no robots at all in an unrelated empty scope still resolves without throwing", async () => {
    // A factory that exists nowhere in the robot chain — must resolve to the fail-safe
    // empty shape rather than throwing (defence-in-depth check independent of the
    // "different factory" case above, using an ARBITRARY unseeded code).
    const section = await getRobotsSection({ factoryCode: `NEVER_SEEDED_${ts}_ZZZ` });
    expect(section.totalRobots).toBe(0);
    expect(section.robots).toEqual([]);
  });
});
