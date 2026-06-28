/**
 * VDA 5050 — standalone adapter manager: start/stop lifecycle (mirrors otManager
 * / robotManager). No-op unless VDA5050_ENABLED==="true".
 *
 * On start: load enabled kind='agv' robots whose connectionOptions carry a
 * manufacturer + serialNumber, build a Vda5050Adapter per AGV, connect its mqtt
 * client and subscribe to state/connection (READ path only). Command publishing
 * stays HITL + dry-run gated through robotCommandDispatcher (see the router /
 * adapter.sendOrder), so NOTHING here ever drives an AGV automatically.
 *
 * Importing this module also registers the `vda5050` RobotDriver in the robot
 * driver registry (side-effect), so an AGV robot row configured for it can flow
 * through the existing robotManager/dispatcher path as the alternative wiring.
 */
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { robots } from "../../../drizzle/schema";
import { registerRobotDriver } from "../robot/driverRegistry";
import { createVda5050Driver, VDA5050_VENDOR } from "./vda5050Driver";
import { Vda5050Adapter, agvConfigFromRobot } from "./vda5050Adapter";

// Side-effect: make the vda5050 driver available to the robot registry.
registerRobotDriver(VDA5050_VENDOR, createVda5050Driver);

let running = false;
const adapters = new Map<number, Vda5050Adapter>();

export function isVda5050Enabled(): boolean {
  return process.env.VDA5050_ENABLED === "true";
}

/** Load enabled AGV robot rows that look like VDA 5050 AGVs. */
export async function loadEnabledAgvs(): Promise<Vda5050Adapter[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(robots)
    .where(and(eq(robots.isEnabled, true), eq(robots.kind, "agv")));
  const out: Vda5050Adapter[] = [];
  for (const r of rows) {
    const cfg = agvConfigFromRobot(r);
    if (!cfg) {
      console.warn(`[VDA5050] skip "${r.code}": missing manufacturer/serialNumber/endpoint in connectionOptions`);
      continue;
    }
    out.push(new Vda5050Adapter(cfg));
  }
  return out;
}

export async function startVda5050(): Promise<boolean> {
  if (running) return true;
  if (!isVda5050Enabled()) {
    console.log("[VDA5050] disabled (set VDA5050_ENABLED=true to enable)");
    return false;
  }

  let list: Vda5050Adapter[] = [];
  try {
    list = await loadEnabledAgvs();
  } catch (err) {
    console.error("[VDA5050] loadEnabledAgvs failed:", (err as Error)?.message ?? err);
    return false;
  }
  if (list.length === 0) {
    console.log("[VDA5050] no enabled AGV robots — nothing to start");
    return false;
  }

  for (const adapter of list) {
    try {
      await adapter.start();
      adapters.set(adapter.config.robotId, adapter);
      console.log(`[VDA5050] "${adapter.config.code}" (${adapter.config.manufacturer}/${adapter.config.serialNumber}) started`);
    } catch (err) {
      console.warn(`[VDA5050] "${adapter.config.code}" skipped: ${(err as Error)?.message ?? err}`);
      try {
        await adapter.stop();
      } catch {
        /* ignore */
      }
    }
  }

  running = true;
  console.log(`[VDA5050] started — ${adapters.size}/${list.length} AGV adapter(s) active`);
  return true;
}

export async function stopVda5050(): Promise<void> {
  for (const adapter of adapters.values()) {
    try {
      await adapter.stop();
    } catch {
      /* ignore */
    }
  }
  adapters.clear();
  running = false;
}

/** Read-only accessor (used by the router for status / sendOrder). */
export function getAgvAdapter(robotId: number): Vda5050Adapter | undefined {
  return adapters.get(robotId);
}

export function listAgvAdapters(): Vda5050Adapter[] {
  return Array.from(adapters.values());
}

export function isVda5050Running(): boolean {
  return running;
}
