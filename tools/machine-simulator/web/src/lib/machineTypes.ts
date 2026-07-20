/**
 * Live-confirmed onboarding bug fix — the real ST4I server rejects `POST /api/machine/register` with
 * HTTP 400 unless `machineType` is EXACTLY one of its enum values (case-sensitive). The wizard used to
 * send whatever free text was typed (default `"Automation"`, placeholder hinting `"AOI/AVI"`) — none of
 * which match the server's actual enum casing (`"AUTOMATION"`, `"AOI"`, …), so every Live registration
 * 400'd. This is the single source of truth for the valid values on the WEB side, mirroring
 * `server/constants/machineTypes.ts` MACHINE_TYPES (read-only reference in the main repo — not
 * imported directly since this is a separate deployable; keep the two lists in sync by hand if the
 * server ever adds a type).
 *
 * Grouped for the Select's popup (cosmetic only — every group flattens to the same flat value list
 * `MACHINE_TYPES`, and the exact string sent to the server never depends on which group a type is
 * filed under). Group membership follows the server's own three-way split of intent — "what does this
 * station actually do" — even though the ENGINE's own `OnboardingFleetJoin.Profiles` mirrors the
 * server's `DEVICE_CLASS_BY_TYPE` more granularly (there, only AVI/AOI/SPI/AXI get the AOI-style
 * simulator; ICT/FCT/CMM/MOUNTER/etc. get a generic automation simulator, same as the server's
 * `deviceClassOf`). That finer split is an implementation detail of which simulator runs underneath —
 * it doesn't need to match this UI-facing "what kind of station is this" grouping.
 */
export interface MachineTypeGroup {
  id: "inspection" | "automation" | "iot"
  types: readonly string[]
}

export const MACHINE_TYPE_GROUPS: readonly MachineTypeGroup[] = [
  {
    id: "inspection",
    types: ["AOI", "AVI", "SPI", "AXI", "ICT", "FCT", "CMM", "ICT_FUNC", "MOUNTER", "REFLOW", "STENCIL_PRINTER", "WAVE_SOLDER"],
  },
  {
    id: "automation",
    types: ["AUTOMATION", "ASSEMBLY", "SCREWDRIVE", "DISPENSING", "FEEDER", "PACKAGING", "PALLETIZER", "ROBOT", "ROBOT_TEST", "WELDER"],
  },
  {
    id: "iot",
    types: ["IOT_SENSOR", "IOT_GATEWAY"],
  },
] as const

/** Flat list of every valid `machineType` enum value, in the same order the popup renders them
 * (grouped, inspection → automation → iot). 24 values — matches the live server's own 400 response. */
export const MACHINE_TYPES: readonly string[] = MACHINE_TYPE_GROUPS.flatMap((group) => group.types)

/** Sensible default selection for a freshly-opened wizard — a real inspection type (AOI), not the
 * generic catch-all, so a first-time visitor immediately sees a concrete, correctly-cased example. */
export const DEFAULT_MACHINE_TYPE = "AOI"

/** Automation + IoT groups only — Task C6's recipe (System A) `machineType` picker. Per
 * `CONFIG_SYNC_SERVER_CONTRACT.md`'s simulator mapping ("Recipe ↔ Automation machines. device_settings
 * ↔ IoT.") an inspection type (AOI/AVI/…) never carries a recipe — those machines sync System B
 * (points/spec/images) instead — so the inspection group is deliberately excluded here. */
export const RECIPE_MACHINE_TYPE_GROUPS: readonly MachineTypeGroup[] = MACHINE_TYPE_GROUPS.filter(
  (group) => group.id !== "inspection"
)

/** Default selection for a freshly-opened recipe create dialog — matches the seeded `SCREWDRIVE-M4`
 * demo recipe, a concrete real example rather than the generic `"AUTOMATION"` catch-all. */
export const DEFAULT_RECIPE_MACHINE_TYPE = "SCREWDRIVE"
