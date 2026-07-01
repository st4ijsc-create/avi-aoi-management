/**
 * U6-a (doc 21 §6 U6 / G-9) — light schema assertion.
 *
 * Migration 0156 is migration-only (not run here). This test asserts the drizzle
 * schema TS was updated to MATCH: each isolation-hole table now carries the
 * tenant scope columns (corporateCode + factoryId) so the schema and the migration
 * stay in lockstep. The 0156 RLS policy predicate is
 * app_tenant_allows(NULL, "corporateCode") — so the corporateCode column name must
 * match exactly.
 */
import { describe, it, expect } from "vitest";
import {
  programProjects,
  programArtifacts,
  programBuilds,
  programSimRuns,
  programDeployments,
  programSymbols,
} from "../../../drizzle/schema/programming";
import { aiAnomalyMemoryBank, aiAnomalyProfiles } from "../../../drizzle/schema/ai";
import { maintenanceSchedules, maintenanceWorkOrders } from "../../../drizzle/schema/mes";

/** A drizzle pgTable exposes its columns as own-enumerable properties. */
function hasCol(table: Record<string, any>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, name) && table[name] != null;
}

describe("U6-a tenant scope columns on isolation-hole tables (G-9)", () => {
  const tables: Array<[string, Record<string, any>]> = [
    ["program_projects", programProjects],
    ["program_artifacts", programArtifacts],
    ["program_builds", programBuilds],
    ["program_sim_runs", programSimRuns],
    ["program_deployments", programDeployments],
    ["program_symbols", programSymbols],
    ["ai_anomaly_memory_bank", aiAnomalyMemoryBank],
    ["ai_anomaly_profiles", aiAnomalyProfiles],
    ["maintenance_schedules", maintenanceSchedules],
    ["maintenance_work_orders", maintenanceWorkOrders],
  ];

  it.each(tables)("%s has corporateCode + factoryId", (_name, table) => {
    expect(hasCol(table, "corporateCode")).toBe(true);
    expect(hasCol(table, "factoryId")).toBe(true);
  });

  it("corporateCode column maps to the DB column name used by the RLS policy", () => {
    expect(programProjects.corporateCode.name).toBe("corporateCode");
    expect(aiAnomalyProfiles.corporateCode.name).toBe("corporateCode");
    expect(maintenanceWorkOrders.corporateCode.name).toBe("corporateCode");
  });
});
