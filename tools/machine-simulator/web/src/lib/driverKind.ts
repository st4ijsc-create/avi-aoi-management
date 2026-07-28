import type { LanguageContextValue } from "@/i18n"

/**
 * GP-3 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-3-brief.md) — the engine's
 * `DriverKind` (`lib/api.ts`) is a free-form string id now, not a closed union: a third-party connector
 * can report any id it likes (see `St4i.Connector.Abstractions.Models.DriverKinds`' own doc comment for
 * the built-in/third-party split and the recommended, not enforced, namespaced convention). This module
 * is the ONE tolerant-label fallback every driverKind-rendering surface in this app shares — originally
 * `AssetRegistry.tsx`'s own local `KNOWN_DRIVER_KINDS`/`driverKindLabel`, hoisted here (per the brief:
 * "reuse it; do not invent a second pattern") so `AssetRegistry`, `Nameplate`, `MachineCard`,
 * `ReadoutGrid`, `MachineDetail`, and `Machines` all resolve an unknown id the SAME way: the i18n label
 * for a KNOWN value, falling back to the raw wire value verbatim for anything else — never `t()`'s own
 * generic "missing key" fallback, which would print the ugly literal dot-path (e.g.
 * `"driverKind.vendor.acme.weld"`) straight into the UI.
 */
export const KNOWN_DRIVER_KINDS = new Set(["Simulated", "HotFolderAoi", "Mqtt", "Modbus", "OpcUa"])

export function driverKindLabel(t: LanguageContextValue["t"], value: string): string {
  return KNOWN_DRIVER_KINDS.has(value) ? t(`driverKind.${value}`) : value
}
