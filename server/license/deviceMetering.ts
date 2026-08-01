/**
 * Per-connected-device license metering — SYNAPSE §4.3 (doc 33 §3.3 / F4 · P2).
 *
 * Floating licenses for Line/Site editions are measured by CONNECTED DEVICES (the real
 * platform value, easy to audit) rather than seats. This is the pure aggregation half:
 * given the device inventory (from the Robot/Equipment registries) + an edition/license
 * quota, compute usage + whether it is within the limit. A live collector that reads the
 * registries on an interval and reports to the on-prem License Server is a thin later step.
 *
 * Principle (SYNAPSE §4.3): over-limit → WARN + report, never block production. `withinLimit`
 * drives a commercial conversation, not a technical stop.
 */

export type DeviceKind = "robot" | "amr" | "cnc" | "smt" | "plc" | "sensor" | "other";

export interface MeteredDevice {
  id: string;
  kind: DeviceKind;
  /** Currently connected/online (only connected devices consume a floating seat). */
  connected: boolean;
}

export interface DeviceUsage {
  total: number;
  /** Currently connected — the metered figure. */
  connected: number;
  /** Peak connected observed (caller may thread this across samples). */
  peak: number;
  quota: number | null;
  withinLimit: boolean;
  /** How many over the quota (0 when within or no quota). */
  overBy: number;
  byKind: Record<string, number>;
}

/**
 * Compute floating-license usage from the current device inventory.
 * @param quota  connected-device limit (null/undefined = unlimited, e.g. Site edition)
 * @param peak   previously observed peak to carry forward (optional)
 */
export function computeDeviceUsage(
  devices: readonly MeteredDevice[],
  quota: number | null | undefined,
  peak = 0,
): DeviceUsage {
  const connectedDevices = devices.filter((d) => d.connected);
  const connected = connectedDevices.length;
  const byKind: Record<string, number> = {};
  for (const d of connectedDevices) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
  const q = quota ?? null;
  const withinLimit = q === null || connected <= q;
  return {
    total: devices.length,
    connected,
    peak: Math.max(peak, connected),
    quota: q,
    withinLimit,
    overBy: q === null ? 0 : Math.max(0, connected - q),
    byKind,
  };
}

/** A concise usage report line for the License Server / audit. */
export function usageReportLine(usage: DeviceUsage): string {
  const q = usage.quota === null ? "∞" : String(usage.quota);
  const flag = usage.withinLimit ? "OK" : `OVER by ${usage.overBy} (warn only — sản xuất không dừng)`;
  return `[license-metering] connected ${usage.connected}/${q} (peak ${usage.peak}, total ${usage.total}) — ${flag}`;
}
