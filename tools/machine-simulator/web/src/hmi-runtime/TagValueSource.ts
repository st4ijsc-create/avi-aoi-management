/**
 * WS-HMI-1 Task 1 — the seam between the HMI runtime and whatever actually holds live values.
 *
 * The renderer this branch is building (`ScreenRenderer.tsx`, Task 3) must resolve `{component}`
 * bindings from an `HmiScreenDocument` down to an actual reading without ever calling an endpoint
 * directly — because the **live-value contract does not exist yet**. Milestone 0 froze
 * `web/src/contracts/*.ts` (the static declaration documents: tag namespace, component model, screen
 * layout) and deliberately deferred `quality` — that is WS-HMI-0c's job, not this branch's. If the
 * renderer called `GET /v1/machines/{code}` (or anything else) straight from a widget, this whole
 * branch would marry a wire format that does not exist yet and would have to be rewritten the moment
 * it lands. `TagValueSource` is the interface the renderer is written against instead; today exactly
 * one implementation exists (`createMachineDetailSource`, below), reading the ONE live shape that
 * already exists — `MachineDetail` from `web/src/lib/api.ts` (called `MachineDetailDto` in the plan;
 * that is the wire DTO's actual C# name — `Fleet/Dtos.cs`'s `MachineDetailDto` — the TS client just
 * names the type `MachineDetail`). When WS-HMI-0c's real contract lands, it gets its OWN
 * `TagValueSource` implementation; the renderer does not change.
 *
 * ── KNOWN PATHS this adapter answers ────────────────────────────────────────────────────────────
 * | path              | value                                              | unit    |
 * |-------------------|----------------------------------------------------|---------|
 * | "cycles"          | `MachineDetail.cycles`                              | —       |
 * | "passRate"        | `MachineDetail.passRate` (raw 0..1 fraction)        | —       |
 * | "statusText"      | `MachineDetail.statusText` (raw engine status word) | —       |
 * | "driftState"      | `MachineDetail.driftState` (raw, incl. the "—" sentinel) | —  |
 * | "keyMetric"       | the LATEST `cycleLog` row's `keyMetric`, parsed via `parseKeyMetric` (see below) | parsed, if any |
 * | "telemetry/{name}"| the latest value of the `TelemetrySeries` whose `metric === name` | the metric name itself |
 *
 * Anything else — including every other `MachineDetail` field (`spc`, `boardPoints`, `plan`, `code`,
 * `class`, `driverKind`) — is NOT exposed. This is deliberately the same field set `derive.ts` and the
 * three hand-written HMI screens already consume; extending the table is a small, obvious addition
 * when a widget actually needs one of those, not something to pre-guess here.
 *
 * ── `keyMetric`: giving the regex hack a face, not moving it ───────────────────────────────────
 * The engine's own `MachineState.FormatKeyMetric` emits `"{name}={value}{unit}"` with no separating
 * space (`"Torque=4.2Nm"`) — `web/src/components/hmi/derive.ts`'s `parseKeyMetric` already parses that
 * back apart with a regex, and three components import it directly today (`ReadoutGrid.tsx`,
 * `SchematicPanel.tsx`, `Hmi.tsx`). This adapter REUSES that exact function (not a second copy of the
 * regex — a second copy is the copy nobody updates) so the seam and the existing screens agree by
 * construction. `parseKeyMetric` returns `null` for shapes that don't match that grammar (the AOI "N
 * pts, M NG" / "—" summary strings) — that is NOT an error condition, just a different valid shape the
 * same field takes for a different `DeviceClass`, so this adapter falls back to the raw string with
 * `quality: "good"`, never `"bad"` (see below for why `"bad"` is never used at all).
 *
 * ── The honesty part: what `quality` can and cannot mean here ──────────────────────────────────
 * `MachineDetailDto` carries NO wire-level freshness or fault signal whatsoever — no timestamp on any
 * field, no per-reading quality bit, nothing a real Modbus/OPC-UA quality code would give you. So this
 * adapter cannot and does not claim to measure "how old is this reading" in any time-based sense, and
 * it NEVER reports `"bad"` — there is nothing in this DTO that distinguishes a faulted/unreliable
 * reading from a normal one, and inventing that distinction would be worse than not having it (a
 * quality field that LOOKS measured but is guessed is the exact failure this convention exists to
 * rule out — see `.claude/skills/st4i-machine-edition/SKILL.md` §2).
 *
 * What this adapter CAN honestly tell is narrower but real: whether the engine has produced this
 * SPECIFIC reading AT ALL yet this session, using conventions this codebase ALREADY relies on
 * elsewhere rather than inventing a new one:
 *   - `passRate` (and anything else keyed off "has a cycle completed yet") is `"stale"` exactly when
 *     `cycles === 0` — the same "cycles === 0 means no data yet, not a bad result" principle
 *     `ReadoutGrid.tsx`'s `passRateTone` doc-comment already documents and relies on.
 *   - `driftState` is `"stale"` exactly when it still holds `MachineDetail.driftState`'s own
 *     documented placeholder — "'—' until one [sync-config] has run" (see that field's doc-comment in
 *     `lib/api.ts`). That sentinel is the DTO's own way of saying "nothing has happened here yet"; this
 *     adapter reads it, it does not invent it.
 * Everything else in the table above is reported `"good"` unconditionally, because there is no honest
 * basis here to call it anything else — not because it is guaranteed fresh. `"stale"` in THIS adapter
 * never means "this value is older than N seconds"; it means "the engine has not produced a real
 * reading for this yet this session". A true freshness/fault signal is exactly what WS-HMI-0c's
 * live-value contract is for; this adapter is a documented, honest placeholder until it exists, not a
 * pre-emptive implementation of it.
 */

import type { MachineDetail } from "../lib/api.ts"
import { parseKeyMetric } from "../components/hmi/derive.ts"

export type TagValue = {
  value: number | boolean | string
  unit?: string
  quality: "good" | "stale" | "bad"
}

export interface TagValueSource {
  /** Returns the current reading at `path`, or `undefined` when `path` names nothing this source
   * knows about. Never throws — a misconfigured or unrecognized binding must fail at the ONE widget
   * that used it, not take the rest of a kiosk screen down with it (see `bindings.ts`, Task 3). */
  get(path: string): TagValue | undefined
  /** Registers `cb` to be called after this source's underlying data changes. Returns an unsubscribe
   * function; calling it stops `cb` from being invoked again. A leaked subscription in an app meant to
   * run for days on a kiosk is a real defect, not a cleanup nicety. */
  subscribe(cb: () => void): () => void
}

/**
 * The concrete adapter this task builds, extending the generic seam with the one extra capability a
 * plain-snapshot source needs: a way to push a freshly-polled DTO in. `web/src/lib/api.ts`'s
 * `useMachine()` already re-fetches `MachineDetail` roughly every second (a brand-new object each
 * successful poll); a caller wiring this source into that polling loop calls `update()` with each new
 * snapshot instead of constructing a new source (and therefore a new `TagValueSource` identity) every
 * tick. `update` is intentionally NOT part of the general `TagValueSource` contract above — a future
 * WS-HMI-0c-backed source will most likely be driven by a websocket message arriving, not a caller
 * calling `update()`, and code written against `TagValueSource` alone must not assume this shape.
 */
export interface MachineDetailTagValueSource extends TagValueSource {
  /** Replaces the snapshot this source reads from and synchronously notifies every current
   * subscriber. Call this once per freshly-polled `MachineDetail`. */
  update(next: MachineDetail): void
}

const TELEMETRY_PATH_PREFIX = "telemetry/"

/** `MachineDetail.driftState`'s own documented sentinel (`lib/api.ts`): "'—' until one [sync-config]
 * has run". Reused here, not redefined — see the module doc-comment's honesty section. */
const DRIFT_STATE_NOT_YET_RUN = "—"

function keyMetricReading(dto: MachineDetail): TagValue | undefined {
  if (dto.cycleLog.length === 0) return undefined
  // Newest-last, same convention `derive.ts`'s own functions (`avgCycleIntervalMs`,
  // `observedSpanLabel`) and every caller of `parseKeyMetric` already assume.
  const lastRow = dto.cycleLog[dto.cycleLog.length - 1]
  const parsed = parseKeyMetric(lastRow.keyMetric)
  if (!parsed) {
    // Doesn't match the "name=value+unit" grammar (e.g. AOI's "N pts, M NG" summary) — a different
    // valid shape for this field, not a fault. Report the raw string honestly rather than drop it.
    return { value: lastRow.keyMetric, quality: "good" }
  }
  const numeric = Number(parsed.value)
  const value = Number.isFinite(numeric) ? numeric : parsed.value
  return parsed.unit ? { value, unit: parsed.unit, quality: "good" } : { value, quality: "good" }
}

function telemetryReading(dto: MachineDetail, metric: string): TagValue | undefined {
  if (!metric) return undefined
  const series = dto.telemetry.find((s) => s.metric === metric)
  if (!series || series.values.length === 0) return undefined
  return { value: series.values[series.values.length - 1], unit: series.metric, quality: "good" }
}

function readPath(dto: MachineDetail, path: string): TagValue | undefined {
  switch (path) {
    case "cycles":
      return { value: dto.cycles, quality: "good" }
    case "passRate":
      // See module doc-comment: `cycles === 0` is this codebase's own established "no data yet"
      // signal for cycle-derived readings (`ReadoutGrid.tsx`'s `passRateTone`), reused, not invented.
      return { value: dto.passRate, quality: dto.cycles === 0 ? "stale" : "good" }
    case "statusText":
      return { value: dto.statusText, quality: "good" }
    case "driftState":
      return { value: dto.driftState, quality: dto.driftState === DRIFT_STATE_NOT_YET_RUN ? "stale" : "good" }
    case "keyMetric":
      return keyMetricReading(dto)
    default:
      if (path.startsWith(TELEMETRY_PATH_PREFIX)) {
        return telemetryReading(dto, path.slice(TELEMETRY_PATH_PREFIX.length))
      }
      return undefined
  }
}

/** The first `TagValueSource` implementation — see the module doc-comment for the full path table and
 * what `quality` can and cannot honestly mean here. */
export function createMachineDetailSource(dto: MachineDetail): MachineDetailTagValueSource {
  let current = dto
  const listeners = new Set<() => void>()

  function get(path: string): TagValue | undefined {
    // Defensive, not decorative: `path` arrives from a JSON document's `bindings` at runtime with no
    // compile-time guarantee it is even a string — a malformed screen document must not crash the
    // kiosk (§5-bis of the plan: no screen is a valid state to fail hard on).
    if (typeof path !== "string") return undefined
    return readPath(current, path)
  }

  function subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }

  function update(next: MachineDetail): void {
    current = next
    for (const cb of listeners) cb()
  }

  return { get, subscribe, update }
}
