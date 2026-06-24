/**
 * Phase 3 — Robot driver registry: vendor → factory map.
 */
import type { RobotVendor, RobotDriver, RobotDriverFactory } from "./robotDriver";

const registry = new Map<RobotVendor, RobotDriverFactory>();

export function registerRobotDriver(vendor: RobotVendor, factory: RobotDriverFactory): void {
  registry.set(vendor, factory);
}

export function createRobotDriver(vendor: RobotVendor): RobotDriver {
  const factory = registry.get(vendor);
  if (!factory) {
    throw new Error(`No robot driver registered for vendor "${vendor}"`);
  }
  return factory();
}

export function listVendors(): RobotVendor[] {
  return Array.from(registry.keys());
}
