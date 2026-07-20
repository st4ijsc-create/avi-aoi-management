import type { CycleLogRow } from "@/lib/api"

/**
 * Client-side derivations for the H2 HMI readout grid. None of these come directly off the wire —
 * `MachineDetailDto` only carries `cycles`/`passRate`/`spc`/`telemetry`/`cycleLog`/`driftState` (see
 * `lib/api.ts`'s doc comment on the shape) — so every value here is honestly computed from that real
 * data rather than invented. Documented per-function; the H2 report calls these out explicitly too.
 */

/** `MachineState.FormatKeyMetric` (engine-side) emits `"{name}={value}{unit}"` with no separating
 * space (e.g. `"Torque=4.2Nm"`, `"Temp=23.5C"`) — parses that back into parts for the readout grid.
 * Returns `null` for the AOI "N pts, M NG" / "—" summary shapes, which don't match this grammar. */
export function parseKeyMetric(raw: string): { name: string; value: string; unit: string } | null {
  const m = /^(.+?)=(-?[\d.]+)(.*)$/.exec(raw)
  if (!m) return null
  return { name: m[1], value: m[2], unit: m[3] }
}

/** Average wall-clock interval between the last few cycle-log rows, in milliseconds — the engine
 * reports no "cycle time" field directly, so this is derived from the real row timestamps
 * (`CycleLogRow.time`, newest-last). `null` when fewer than 2 rows exist yet to diff. */
export function avgCycleIntervalMs(rows: CycleLogRow[], sampleSize = 6): number | null {
  if (rows.length < 2) return null
  const sample = rows.slice(-sampleSize)
  const first = Date.parse(sample[0].time)
  const last = Date.parse(sample[sample.length - 1].time)
  if (!Number.isFinite(first) || !Number.isFinite(last) || sample.length < 2) return null
  const spanMs = last - first
  if (spanMs <= 0) return null
  return spanMs / (sample.length - 1)
}

/** Cycles/minute from the same derived interval — `null` propagates through (no data yet). */
export function cycleRatePerMin(rows: CycleLogRow[], sampleSize = 6): number | null {
  const interval = avgCycleIntervalMs(rows, sampleSize)
  if (interval === null || interval <= 0) return null
  return 60_000 / interval
}

/** Wall-clock span between the FIRST and LAST row currently in the (capped, 200-row) cycle log —
 * labeled "observed span" rather than "uptime" in the UI because it's honestly scoped to what this
 * log window has seen, not the machine's actual lifetime uptime. */
export function observedSpanLabel(rows: CycleLogRow[]): string | null {
  if (rows.length < 2) return null
  const first = Date.parse(rows[0].time)
  const last = Date.parse(rows[rows.length - 1].time)
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null
  const totalSeconds = Math.max(0, Math.round((last - first) / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/** Industrial 3-shift convention derived from the live wall clock (06–14 / 14–22 / 22–06) — not
 * engine data, a display convenience for the nameplate header. */
export function currentShiftNumber(date: Date): 1 | 2 | 3 {
  const h = date.getHours()
  if (h >= 6 && h < 14) return 1
  if (h >= 14 && h < 22) return 2
  return 3
}

/** Remaining-screw feeder count for the automation schematic — the engine tracks no feeder-inventory
 * field, so this is a deterministic, purely-decorative countdown derived from the real cycle counter
 * against an assumed feeder capacity, cycling back to full every `capacity` cycles. */
export function feederRemaining(cycles: number, capacity = 50): number {
  const used = cycles % capacity
  return capacity - used
}
