/**
 * Sprint F2 — Single source of truth for machine types.
 *
 * MUST stay 100% in sync (order + values) with `machineTypeEnum` in
 * drizzle/schema/enums.ts. Used by every zod validator that accepts a
 * machineType so adding a new generic-device type only requires touching the
 * enum + this list (+ migration + i18n label).
 *
 * NOTE: FCT already existed in the enum (added in migration 0102) — it is NOT
 * a new value here.
 */
export const MACHINE_TYPES = [
  "AVI",        // Automated Visual Inspection
  "AOI",        // Automated Optical Inspection
  "SPI",        // Solder Paste Inspection
  "AXI",        // Automated X-ray Inspection
  "ICT",        // In-Circuit Test
  "FCT",        // Functional Circuit Test
  "CMM",        // Coordinate Measuring Machine
  "AUTOMATION", // General automation station
  // --- Sprint F2: generic device types (machine model for any machine) ---
  "FEEDER",     // Component feeder
  "ASSEMBLY",   // Assembly station
  "SCREWDRIVE", // Automatic screwdriving station
  "DISPENSING", // Glue / paste dispensing
  "ICT_FUNC",   // Combined ICT + functional test cell
  "ROBOT_TEST", // Robotic test cell
  "PACKAGING",  // Packaging station
  "PALLETIZER", // Palletizer
  "ROBOT",      // Generic industrial robot
] as const;

export type MachineType = (typeof MACHINE_TYPES)[number];
