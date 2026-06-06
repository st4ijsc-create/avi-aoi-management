/**
 * Sprint F2 — client mirror of server/constants/machineTypes.ts.
 * KEEP IN SYNC with the server constant + drizzle machineTypeEnum (order + values).
 */
export const MACHINE_TYPES = [
  "AVI",
  "AOI",
  "SPI",
  "AXI",
  "ICT",
  "FCT",
  "CMM",
  "AUTOMATION",
  "FEEDER",
  "ASSEMBLY",
  "SCREWDRIVE",
  "DISPENSING",
  "ICT_FUNC",
  "ROBOT_TEST",
  "PACKAGING",
  "PALLETIZER",
  "ROBOT",
] as const;

export type MachineType = (typeof MACHINE_TYPES)[number];
