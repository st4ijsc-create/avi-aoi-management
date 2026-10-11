/**
 * Phase 3 — Robot adapter loader: DB rows → runtime robot handles.
 * Builds (does not connect) a driver per enabled robot.
 *
 * doc 81 Đợt 9 final wave F1 (final review I1) — an EDGE gateway loads ONLY the robots of its own node: `scope` = the node's
 * line codes (EDGE_GATEWAY_LINE_CODES) and, when set, its factory code (EDGE_GATEWAY_FACTORY_CODE). A robot belongs to a line
 * through `robots.lineId`, else through its station (`stations.lineId`). No line codes ⇒ NO robot (fail-closed: an edge never
 * opens sessions to every robot of the control plane). Central calls it without a scope (every enabled robot, as before).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { robots, stations, productionLines, workshops, factories, type Robot } from "../../../drizzle/schema";
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

/** The robots an edge node may load: those on its lines (and in its factory when it has one). */
export interface RobotLoadScope {
  lineCodes: readonly string[];
  factoryCode: string | null;
}

async function enabledRobotRows(scope?: RobotLoadScope): Promise<Robot[]> {
  const db = await getDb();
  if (!db) return [];
  if (!scope) return db.select().from(robots).where(eq(robots.isEnabled, true));
  const lineCodes = [...new Set(scope.lineCodes.map((c) => String(c).trim()).filter(Boolean))];
  if (lineCodes.length === 0) return []; // no line binding ⇒ nothing (fail-closed)
  const factoryCode = scope.factoryCode?.trim() || null;
  const rows = await db
    .select({ robot: robots })
    .from(robots)
    .leftJoin(stations, eq(stations.id, robots.stationId))
    .innerJoin(productionLines, sql`${productionLines.id} = COALESCE(${robots.lineId}, ${stations.lineId})`)
    .innerJoin(workshops, eq(workshops.id, productionLines.workshopId))
    .innerJoin(factories, eq(factories.id, workshops.factoryId))
    .where(
      and(
        eq(robots.isEnabled, true),
        inArray(productionLines.code, lineCodes),
        factoryCode ? eq(factories.code, factoryCode) : undefined,
      ),
    );
  const seen = new Set<number>();
  return rows.map((r) => r.robot).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export async function loadEnabledRobots(scope?: RobotLoadScope): Promise<RuntimeRobot[]> {
  const rows = await enabledRobotRows(scope);
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
