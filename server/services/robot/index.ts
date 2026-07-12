/**
 * Phase 3 — Robotics framework entrypoint. Registers vendor drivers (side-effect
 * on import) and re-exports the public surface.
 */
import { registerRobotDriver } from "./driverRegistry";
import { createSimRobotDriver } from "./drivers/simRobotDriver";
import { createFanucDriver } from "./drivers/fanucDriver";
import { createMitsubishiRobotDriver } from "./drivers/mitsubishiRobotDriver";
import { createDeltaRobotDriver } from "./drivers/deltaRobotDriver";
import { createTechmanDriver } from "./drivers/techmanDriver";
// VDA 5050 (AGV/AMR) driver lives under services/vda5050 but registers here so a
// robots.vendor='vda5050' row is selectable through the SAME robot framework path
// (registry → robotManager → robotCommandDispatcher HITL/dry-run gate). The import
// is pure (messages/mapping only — no DB, no mqtt at import time). The standalone
// vda5050Manager also registers it; registration is idempotent (Map.set).
import { createVda5050Driver, VDA5050_VENDOR } from "../vda5050/vda5050Driver";
// doc 40 W5 (MTX-12) — Universal Robots bridge (URScript + Dashboard over node:net).
// Registered here so a robots.vendor='ur' row uses the SAME registry → dispatcher path.
import { createUrsimBridge, UR_VENDOR } from "./ursimBridge";
import type { RobotVendor } from "./robotDriver";

// ────────────────────────────────────────────────────────────────────────────
// CTL-05 (doc 40) — VENDOR VALIDATION STATUS. Phân loại HONEST mức độ đã kiểm chứng
// của protocol từng driver so với tài liệu vendor thật, để UI badge & để chặn driver
// MOCK gửi khung bịa xuống thiết bị thật:
//   • 'spec-verified' — protocol khớp tài liệu/chuẩn công khai (fanuc RMI; vda5050 chuẩn mở).
//   • 'assumed'       — shape protocol GIẢ ĐỊNH, chưa validate với HW (mitsubishi MELFA, techman).
//   • 'mock'          — KHÔNG có vendor protocol tài liệu hoá / là simulator (delta = khung
//                       TCP BỊA; sim = emulator loopback). KHÔNG được tin trên HW thật.
// Bản đồ là nguồn sự thật đơn cho robotRouter (badge) + self-guard của delta driver.
// ────────────────────────────────────────────────────────────────────────────
export type RobotValidationStatus = "spec-verified" | "assumed" | "mock";

export const ROBOT_VENDOR_VALIDATION: Record<RobotVendor, RobotValidationStatus> = {
  fanuc: "spec-verified",   // doc 37 §6.2 — RMI shape verified vs manual
  mitsubishi: "assumed",    // MELFA R3 shape assumed — chưa validate HW
  techman: "assumed",       // Techman driver shape assumed — chưa validate HW
  delta: "mock",            // KHUNG TCP BỊA (DRAStudio DRL không có host telegram) — doc 37 §6.2
  sim: "mock",              // emulator loopback — không phải thiết bị thật
  vda5050: "spec-verified", // VDA 5050 là chuẩn MQTT mở, published
  ur: "assumed",            // doc 40 W5 (MTX-12) — UR protocol công khai, mock-tested, chưa HW-FAT
};

// doc 40 W5 (MTX-12) — validation for vendors NOT yet in the RobotVendor union (the
// union lives in the non-owned robotDriver.ts). 'ur' = 'assumed' (public UR protocol,
// mock-server tested, but NOT validated on a real UR arm — HW-FAT pending).
const EXTENDED_VENDOR_VALIDATION: Record<string, RobotValidationStatus> = {
  [UR_VENDOR]: "assumed",
};

// vendor arrives as a DB string at runtime; widen the param to string so extended
// (not-yet-in-union) vendors like 'ur' resolve a badge too. RobotVendor ⊂ string.
export function getRobotVendorValidation(vendor: RobotVendor | string): RobotValidationStatus {
  return (
    ROBOT_VENDOR_VALIDATION[vendor as RobotVendor] ??
    EXTENDED_VENDOR_VALIDATION[vendor] ??
    "mock" // fail-safe: vendor lạ ⇒ coi như mock
  );
}

/**
 * Cờ cho phép driver MOCK (vd delta) MỞ kết nối tới một endpoint thật. MẶC ĐỊNH OFF —
 * an toàn theo mặc định: một driver mock KHÔNG bao giờ gửi khung bịa xuống thiết bị thật
 * trừ khi vận hành viên bật tường minh (chỉ nên bật với lab/simulator). Đọc ở RUNTIME.
 */
export function robotMockVendorsEnabled(): boolean {
  return process.env.ROBOT_MOCK_VENDORS_ENABLED === "true";
}

registerRobotDriver("sim", createSimRobotDriver);
// doc 37 §6.2: fanuc (RMI) + mitsubishi (MELFA R3) + delta drivers are UNVERIFIED against
// vendor comms manuals (protocol shapes assumed). Delta's frame/port/checksum is fictional
// per the DRAStudio manual — treat as MOCK until the DRL/comms manual is added. All stay
// dry-run: real motion requires ROBOT_CONTROL_ENABLED=true (default OFF) + commissioning.
registerRobotDriver("fanuc", createFanucDriver);
registerRobotDriver("mitsubishi", createMitsubishiRobotDriver);
registerRobotDriver("delta", createDeltaRobotDriver); // MOCK — protocol not documented (doc 37 §6.2)
registerRobotDriver("techman", createTechmanDriver);
registerRobotDriver(VDA5050_VENDOR, createVda5050Driver);
// doc 40 W5 (MTX-12): UR bridge. 'ur' is not (yet) in the RobotVendor union /
// robotVendorEnum (non-owned files) — cast to register through the same path. Stays
// dry-run: real motion needs ROBOT_CONTROL_ENABLED=true + commissioning (validation 'assumed').
registerRobotDriver(UR_VENDOR as RobotVendor, createUrsimBridge);

export { startRobots, stopRobots, getActiveRobot } from "./robotManager";
export { dispatchRobotJob } from "./robotCommandDispatcher";
export { registerRobotDriver, createRobotDriver, listVendors } from "./driverRegistry";
export { isRobotCommissioned, isRobotCommissioningRequired } from "./robotCommandDispatcher";
