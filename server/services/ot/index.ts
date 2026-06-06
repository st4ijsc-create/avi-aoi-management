/**
 * Sprint F1.1 — OT Connectivity Framework entrypoint.
 *
 * Đăng ký 6 driver vào registry (chỉ `stub` chạy thật trong F1.1) và re-export
 * manager + types. Import module này có side-effect đăng ký driver.
 */
import { registerDriver } from "./driverRegistry";
import { createStubDriver } from "./drivers/stubDriver";
import { createOpcuaDriver } from "./drivers/opcuaDriver";
import { createModbusDriver } from "./drivers/modbusDriver";
import { createS7Driver } from "./drivers/s7Driver";
import { createMitsubishiMcDriver } from "./drivers/mitsubishiMcDriver";
import { createEthernetIpDriver } from "./drivers/ethernetIpDriver";

registerDriver("stub", createStubDriver);
registerDriver("opcua", createOpcuaDriver);
registerDriver("modbus", createModbusDriver);
registerDriver("s7", createS7Driver);
registerDriver("mitsubishi-mc", createMitsubishiMcDriver);
registerDriver("ethernet-ip", createEthernetIpDriver);

export { startOt, stopOt, isOtRunning } from "./otManager";
export { loadEnabledAdapters } from "./deviceAdapter";
export type { RuntimeAdapter } from "./deviceAdapter";
export { registerDriver, createDriver, listProtocols } from "./driverRegistry";
export * from "./otDriver";
