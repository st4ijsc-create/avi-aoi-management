/**
 * Phase 3 — Robot adapter loader: DB rows → runtime robot handles.
 * Builds (does not connect) a driver per enabled robot.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { robots } from "../../../drizzle/schema";
import { createRobotDriver } from "./driverRegistry";
import type { RobotDriver, RobotConnectionConfig, RobotVendor } from "./robotDriver";

export interface RuntimeRobot {
  id: number;
  code: string;
  vendor: RobotVendor;
  connection: RobotConnectionConfig;
  pollIntervalMs: number;
  driver: RobotDriver;
}

export async function loadEnabledRobots(): Promise<RuntimeRobot[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db.select().from(robots).where(eq(robots.isEnabled, true));
  const out: RuntimeRobot[] = [];
  for (const r of rows) {
    try {
      const driver = createRobotDriver(r.vendor as RobotVendor);
      out.push({
        id: r.id,
        code: r.code,
        vendor: r.vendor as RobotVendor,
        connection: {
          endpoint: r.endpoint,
          options: (r.connectionOptions ?? undefined) as Record<string, unknown> | undefined,
        },
        pollIntervalMs: r.pollIntervalMs ?? 5000,
        driver,
      });
    } catch (err) {
      console.warn(`[Robot] skip robot "${r.code}": ${(err as Error)?.message ?? err}`);
    }
  }
  return out;
}
