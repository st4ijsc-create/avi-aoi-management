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
  // --- doc 40 W5 (MTX-03): SMT line machine types (mở rộng độ phủ thiết bị) ---
  // ⚠️ ĐỒNG BỘ ENUM: machineType là pgEnum → 4 giá trị dưới đây PHẢI được ADD VALUE
  // vào `machinetypeenum` (drizzle/schema/enums.ts + migration 0241_smt_machine_types.sql)
  // để một máy loại này ghi được xuống DB. capabilityModel đã có profile cho chúng.
  "MOUNTER",         // SMT pick-and-place mounter (chip mounter)
  "REFLOW",          // Reflow soldering oven
  "STENCIL_PRINTER", // Solder-paste stencil printer
  "WAVE_SOLDER",     // Wave / selective soldering
  // --- doc 56 Đ0 việc 5: WELDER + IoT device classes (migration 0287) ---
  // ⚠️ ĐỒNG BỘ ENUM: 3 giá trị dưới đây PHẢI được ADD VALUE vào `machinetypeenum`
  // (drizzle/schema/enums.ts + migration 0287_device_class_types.sql).
  "WELDER",          // Welding cell (process automation)
  "IOT_SENSOR",      // Self-developed IoT sensor (telemetry-only)
  "IOT_GATEWAY",     // Self-developed IoT gateway / relay
] as const;

export type MachineType = (typeof MACHINE_TYPES)[number];

/**
 * Doc 56 Đ0 việc 6 — DERIVED device class, declared in ONE place (the server).
 *
 * Every machineType belongs to exactly one of three connectivity/analytics
 * classes (Trục 0 taxonomy):
 *   • "aoi_avi"    — optical/X-ray inspection machines (the original fleet)
 *   • "automation" — in-house automation cells (PLC/robot/SMT line/…)
 *   • "iot"        — self-developed IoT devices (sensors/gateways; no OEE)
 *
 * The client MUST NOT fork this mapping — it reads `machine.listTypes`
 * (hierarchyRouters), which serves {type, deviceClass, labelKey} from here.
 */
export type DeviceClass = "aoi_avi" | "automation" | "iot";

export const DEVICE_CLASS_BY_TYPE: Record<MachineType, DeviceClass> = {
  // ── optical / X-ray inspection fleet ──
  AVI: "aoi_avi",
  AOI: "aoi_avi",
  SPI: "aoi_avi",
  AXI: "aoi_avi",
  // ── in-house automation (test, process, robot, SMT line) ──
  ICT: "automation",
  FCT: "automation",
  CMM: "automation",
  AUTOMATION: "automation",
  FEEDER: "automation",
  ASSEMBLY: "automation",
  SCREWDRIVE: "automation",
  DISPENSING: "automation",
  ICT_FUNC: "automation",
  ROBOT_TEST: "automation",
  PACKAGING: "automation",
  PALLETIZER: "automation",
  ROBOT: "automation",
  MOUNTER: "automation",
  REFLOW: "automation",
  STENCIL_PRINTER: "automation",
  WAVE_SOLDER: "automation",
  WELDER: "automation",
  // ── self-developed IoT devices ──
  IOT_SENSOR: "iot",
  IOT_GATEWAY: "iot",
};

/** Device class of a machineType (fail-safe: unknown → "automation", never throws). */
export function deviceClassOf(type: MachineType | string): DeviceClass {
  return DEVICE_CLASS_BY_TYPE[type as MachineType] ?? "automation";
}
