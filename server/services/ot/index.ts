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

import { startOt as startOtManager } from "./otManager";
import { restore as restoreStoreForwardWal, storeForwardEnabled } from "./storeForward";

export {
  stopOt,
  isOtRunning,
  // C3 — connection HA / failover accessors + status getters (additive).
  isConnHaEnabled,
  getActiveAdapter,
  getActiveDriver,
  listActiveAdapters,
  getSupervisorStatus,
  listSupervisorStatuses,
} from "./otManager";

/**
 * W2-C (doc 35 D5) — OT startup wrapper that RESTORES the telemetry store-and-forward
 * WAL from disk BEFORE starting adapters, so rows buffered during a DB outage survive a
 * process restart (previously `restore()` existed but nothing called it at boot, so the
 * on-disk WAL was silently ignored — telemetry lost across restarts).
 *
 * Best-effort + once-only + gated by the SAME flag that gates store-forward
 * (OT_STORE_FORWARD_ENABLED). A restore failure NEVER throws to block boot. The restored
 * queue drains on the next healthy write via the existing telemetryBus → backfill() path
 * (buffer/backfill logic is unchanged here).
 */
let storeForwardRestored = false;
export async function startOt(): Promise<boolean> {
  if (storeForwardEnabled() && !storeForwardRestored) {
    storeForwardRestored = true;
    try {
      const restored = await restoreStoreForwardWal();
      if (restored > 0) {
        console.log(
          `[OT] store-forward WAL restored — ${restored} buffered telemetry row(s) queued; ` +
            "will drain on the next healthy write (backfill).",
        );
      }
    } catch (err) {
      console.warn("[OT] store-forward WAL restore failed (continuing boot):", (err as Error)?.message || err);
    }
  }
  return startOtManager();
}
export { loadEnabledAdapters, parseBackupConnection } from "./deviceAdapter";
export type { RuntimeAdapter } from "./deviceAdapter";
export { ConnectionSupervisor, DEFAULT_BACKOFF } from "./connectionSupervisor";
export type {
  SupervisorState,
  SupervisorStatus,
  SupervisorOptions,
  EndpointConfig,
  BackoffConfig,
} from "./connectionSupervisor";
export { registerDriver, createDriver, listProtocols } from "./driverRegistry";
export * from "./otDriver";
