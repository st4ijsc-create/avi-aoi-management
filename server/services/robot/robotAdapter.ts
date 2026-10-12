/**
 * Phase 3 — Robot adapter loader: DB rows → runtime robot handles.
 * Builds (does not connect) a driver per enabled robot.
 *
 * doc 81 Đợt 9 final wave F1 (final review I1) — an EDGE gateway loads ONLY the robots of its own node: `scope` = the node's
 * line codes (EDGE_GATEWAY_LINE_CODES) and, when set, its factory code (EDGE_GATEWAY_FACTORY_CODE). A robot belongs to a line
 * through `robots.lineId`, else through its station (`stations.lineId`). No line codes ⇒ NO robot (fail-closed: an edge never
 * opens sessions to every robot of the control plane). Central calls it without a scope (every enabled robot, as before).
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
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

/**
 * doc 81 Đợt 10 task D (design §2.12) — central does not connect to robots an edge node OWNS (robots.edgeNodeId, mig 0374,
 * narrow projection): one owner per device = one session, one ingest, one lock authority. A DB without 0374 has no edge owners.
 * Any other read error keeps the rows (logged loudly): central's dispatcher still refuses MOTION to an edge-owned robot
 * (ROBOT_OWNED_BY_EDGE, read at command time, fail-closed), so the residual is a second session, never a second mover.
 */
async function excludeEdgeOwnedRobots(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, rows: Robot[]): Promise<Robot[]> {
  if (rows.length === 0) return rows;
  const { robotOwnership, isEdgeControlSchemaMissing } = await import("../edge/edgeControlSchema");
  try {
    const owned = await db
      .select({ id: robotOwnership.id })
      .from(robotOwnership)
      .where(and(inArray(robotOwnership.id, rows.map((r) => r.id)), isNotNull(robotOwnership.edgeNodeId)));
    if (!Array.isArray(owned) || owned.length === 0) return rows;
    const skip = new Set(owned.map((o) => o.id));
    for (const r of rows) if (skip.has(r.id)) console.log(`[Robot] "${r.code}" is owned by an edge node — central does not connect to it`);
    return rows.filter((r) => !skip.has(r.id));
  } catch (err) {
    if (!isEdgeControlSchemaMissing(err)) {
      console.error(`[Robot] edge ownership of the enabled robots could not be read — central connects to all of them; motion to an edge-owned one is still refused at command time:`, (err as Error)?.message ?? err);
    }
    return rows;
  }
}

async function enabledRobotRows(scope?: RobotLoadScope): Promise<Robot[]> {
  const db = await getDb();
  if (!db) return [];
  if (!scope) return excludeEdgeOwnedRobots(db, await db.select().from(robots).where(eq(robots.isEnabled, true)));
  const lineCodes = [...new Set(scope.lineCodes.map((c) => String(c).trim()).filter(Boolean))];
  if (lineCodes.length === 0) return []; // no line binding ⇒ nothing (fail-closed)
  const factoryCode = scope.factoryCode?.trim() || null;
  // doc 81 Đợt 10 task D (re-review N3) — line codes are unique only per workshop: without the factory a scope would load every
  // factory's robots on a line of that code. A scope REQUIRES its factory ⇒ none (fail-closed).
  if (!factoryCode) {
    console.warn("[Robot] edge robot scope has line codes but no factory code — no robot is loaded (N3: the factory is required)");
    return [];
  }
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
        eq(factories.code, factoryCode),
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

/**
 * doc 81 Đợt 10 task D (design §2.11 / §2.12) — the EDGE's robots: built from the SIGNED config snapshot (only the node's
 * owned robots are in it), never from the DB. Enabled robots only; a vendor without a driver is skipped (logged).
 */
export function runtimeRobotsFromConfig(
  configRobots: ReadonlyArray<{ id: number; code: string; vendor: string; endpoint: string; connectionOptions: Record<string, unknown> | null; pollIntervalMs: number; isEnabled: boolean }>,
): RuntimeRobot[] {
  const out: RuntimeRobot[] = [];
  for (const r of configRobots) {
    if (r.isEnabled !== true) continue;
    try {
      out.push({
        id: r.id,
        code: r.code,
        vendor: r.vendor as RobotVendor,
        connection: { endpoint: r.endpoint, options: r.connectionOptions ?? undefined },
        pollIntervalMs: r.pollIntervalMs ?? 5000,
        driver: createRobotDriver(r.vendor as RobotVendor),
      });
    } catch (err) {
      console.warn(`[Robot] skip robot "${r.code}": ${(err as Error)?.message ?? err}`);
    }
  }
  return out;
}
