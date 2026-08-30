import * as React from "react"

import { Sheet } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { parseKeyMetric } from "@/components/hmi/derive"
import { ReadoutGrid } from "@/components/hmi/ReadoutGrid"
import { SchematicPanel } from "@/components/hmi/SchematicPanel"
import type { AoiSchematicPoint } from "@/components/hmi/schematics/AoiSchematic"
import { useT } from "@/i18n"
import { useFleetEstopEngaged, useFleetIsRunning, useMachine, type DeviceClass } from "@/lib/api"
import { useMachineConfigCheck, useProduct, useProductPoints } from "@/lib/configApi"
import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord } from "./shared.ts"

/**
 * `kind: "faceplate"` — THE SEAM WS-HMI-1 Task 5 plugs into. Dispatches on `props.faceplate`:
 *
 * - `"fp.overview.automation" | "fp.overview.aoi" | "fp.overview.iot"` — WS-HMI-1 Task 5's own three
 *   screens (`web/screens/*-overview.json`) each carry exactly ONE widget with one of these ids, sized
 *   to fill the whole grid. `OperationOverviewFaceplate` (below) is that widget's real implementation.
 * - anything else (today: `fp.motor.spindle`, from `contracts/fixtures/valid/screen-screwdrive-full.json`,
 *   a Milestone-0 fixture this task does not own or render) — the pre-Task-5 "not wired yet" placeholder,
 *   unchanged. A future component-level faceplate library (WS-HMI-3) plugs in here the same way this
 *   task's three cell-level drawings just did.
 */
export function FaceplateWidget(props: WidgetProps) {
  const p = asRecord(props.widget.props)
  const faceplateId = typeof p.faceplate === "string" ? p.faceplate : undefined

  if (faceplateId && OVERVIEW_FACEPLATE_IDS.has(faceplateId)) {
    return <OperationOverviewFaceplate source={props.source} />
  }

  return (
    <Sheet className="h-full" bodyClassName="flex h-full flex-1 items-center justify-center text-center">
      <p className="hmi-micro normal-case">
        faceplate: {faceplateId ?? "(unset)"}
        <br />
        not wired yet — see Task 5
      </p>
    </Sheet>
  )
}

const OVERVIEW_FACEPLATE_IDS = new Set(["fp.overview.automation", "fp.overview.aoi", "fp.overview.iot"])

/**
 * WS-HMI-1 Task 5 — the "delete the React" corrigendum's own resolution (see the plan's top block):
 * what actually gets deleted is `Hmi.tsx`'s HAND-WRITTEN page layout — the `SCHEMATIC_READOUT_FLEX`
 * proportions table, the `if`-branch that picked a schematic by `DeviceClass`, and the fixed panel
 * order nailed into that file's JSX. The two panels those hand-wrote (the live schematic via
 * `SchematicPanel`, the KPI table via `ReadoutGrid`) are NOT reinvented as a pile of generic `readout`/
 * `kpi-tile` widgets scattered across `ScreenRenderer`'s own CSS grid — that was tried and rejected,
 * for a provable, not a convenience, reason:
 *
 * `ScreenRenderer`'s grid places every widget on the SAME document-wide `layout.cols` × integer
 * `colSpan` × ONE fixed `gap`. For an EQUAL split (Automation's `[1, 1]`) that reproduces a flex-grow
 * ratio exactly, for any gap, any viewport — trivial, `a === b` cancels the gap term. For a NON-equal
 * split (AoiAvi's `[1.15, 1]`, IoT's `[0.85, 1.15]`) it provably CANNOT, while also keeping the
 * original 12px inter-panel gap: a grid item spanning `a` of `cols` tracks has rendered width
 * `a·trackWidth + (a-1)·gap` — the `(a-1)·gap` term is exactly what makes two panels' width RATIO
 * diverge from their track-count ratio `a:b` the moment `gap > 0` and `a ≠ b`, for every viewport
 * width, not just the one this repo's suite happens to test at. Measured, not just derived: the real
 * AOI panel at the suite's own 1440×900 viewport renders schematic:readout as 564.703125px :
 * 491.296875px (opRow width 1068px minus one 12px `gap-3`) — not the "nice" 1.15:1 rational split an
 * integer `colSpan` pair could land on exactly. The only way to hit that exactly through the grid is a
 * per-viewport magic-pixel `padding` hack tuned to ONE screen size — which breaks the whole point of a
 * `1fr`-track grid reflowing for free across `ScreenBreakpoint`s (`ScreenLayout`'s own doc comment),
 * and reads as numerology to the next person who opens the JSON. Given the task's overriding rule —
 * `maxDiffPixelRatio: 0.00002`, no baseline may move — a real, unfakeable per-viewport ratio wins over
 * a generic-looking decomposition that is provably a few pixels wrong.
 *
 * So: each `*-overview.json` document carries exactly ONE `faceplate` widget filling its whole grid,
 * and THIS component reproduces the original flex row verbatim — same `SchematicPanel`/`ReadoutGrid`
 * calls, same `flexGrow`/`flexBasis: 0` ratio, same `gap-3` — just relocated one call-frame down, from
 * `Hmi.tsx`'s JSX into the widget layer `props.faceplate` selects. `ScreenRenderer`'s own wrapper divs
 * around a lone 1×1 widget (its `grid` root, the per-widget placement `<div>`) add zero box-model
 * footprint of their own (no padding/margin/border, `w-full`/`h-full` filling exactly what the old
 * flex row filled) — Playwright's own pixel diff is the proof this holds, not an assertion here.
 *
 * This is exactly the same "wrap, don't reinvent" posture Task 2 used for `readout`/`status-lamp`/…
 * around `web/src/components/industrial/`, one layer up: `SchematicPanel`/`ReadoutGrid` are already
 * axe-AA'd, visually-pinned, `DeviceClass`-aware components — this widget's job is wiring live data
 * into them, not redrawing them.
 */
function OperationOverviewFaceplate({ source }: { source: WidgetProps["source"] }) {
  const t = useT()
  const gloss = useGloss()

  const codeTv = source.get("code")
  const code = typeof codeTv?.value === "string" ? codeTv.value : undefined

  // Same query key `Hmi.tsx` uses for its own `useMachine(code)` call one frame up — TanStack Query
  // dedupes identical keys to one shared cache entry/poll, so this is NOT a second network request.
  const { data: machine } = useMachine(code)
  const fleetIsRunning = useFleetIsRunning()
  const estopEngaged = useFleetEstopEngaged()
  const running = fleetIsRunning && !estopEngaged

  // I-3 (see `Hmi.tsx`'s pre-Task-5 history) — worst-wins across every product a machine's config
  // check names, not just the first. Only meaningful for AoiAvi (`configKind === "points"`); other
  // classes fall through `recipe`.
  const configCheck = useMachineConfigCheck(code)
  const productDrifts = configCheck.data?.configKind === "points" ? configCheck.data.products : []
  const productCode = productDrifts[0]?.productModelCode
  const product = useProduct(productCode)
  const productPoints = useProductPoints(productCode)

  const configDriftState: string | null = configCheck.data
    ? configCheck.data.configKind === "points"
      ? worstDriftState(productDrifts)
      : (configCheck.data.recipe?.driftState ?? null)
    : null

  const primaryProductLabel = product.data?.name ?? productCode ?? null
  const productTileLabel =
    primaryProductLabel && productDrifts.length > 1
      ? `${primaryProductLabel} +${productDrifts.length - 1}`
      : primaryProductLabel

  // I-1 (see `Hmi.tsx`'s pre-Task-5 history) — positions are real (`nx`/`ny` straight from the
  // product's own config); no dot is coloured by an unverifiable per-point match at THIS layer —
  // `AoiSchematic` colours its OWN dots from `plan.steps`, which carry real per-step results.
  const aoiPoints = React.useMemo<AoiSchematicPoint[]>(() => {
    if (!productPoints.data) return []
    const sorted = [...productPoints.data].filter((pt) => !pt.deletedAt).sort((a, b) => a.orderIndex - b.orderIndex)
    const imgW = product.data?.imageWidth ?? null
    const imgH = product.data?.imageHeight ?? null
    return sorted.map((pt) => ({
      code: pt.code,
      nx: clamp01(pt.normalizedX ?? (imgW ? pt.positionX / imgW : 0.5)),
      ny: clamp01(pt.normalizedY ?? (imgH ? pt.positionY / imgH : 0.5)),
    }))
  }, [productPoints.data, product.data])

  const aoiUnlocatedDefects = React.useMemo(
    () => (machine?.boardPoints ?? []).filter((pt) => pt.result === "NG").length,
    [machine?.boardPoints]
  )

  const lastRow = machine && machine.cycleLog.length > 0 ? machine.cycleLog[machine.cycleLog.length - 1] : undefined
  const parsedIotMetric = lastRow ? parseKeyMetric(lastRow.keyMetric) : null
  const iotLatestReading = parsedIotMetric ? `${parsedIotMetric.name}: ${parsedIotMetric.value}${parsedIotMetric.unit}` : undefined

  // `Hmi.tsx` guarantees a non-null `machine` before this widget's `<ScreenRenderer>` ever mounts (its
  // own `if (!machine) return <LoadingKiosk />` gate) — the SAME query key means this component's own
  // `useMachine(code)` call already has that exact snapshot warm in cache on its very first render.
  // This guard exists only for the one path that gate cannot cover: `code` still resolving (`source`
  // wired to a machine whose "code" reading is momentarily `undefined`). Render nothing rather than
  // hand `SchematicPanel`/`ReadoutGrid` a `machine` they don't accept as optional — a blank grid cell
  // for at most one tick beats a crash (plan §5-bis).
  if (!machine || !code) return null

  const isAoi = machine.class === "AoiAvi"
  const [schematicFlex, readoutFlex] = OVERVIEW_SCHEMATIC_READOUT_FLEX[machine.class]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-3">
      <SchematicPanel
        className="min-h-0 min-w-0"
        style={{ flexGrow: schematicFlex, flexBasis: 0 }}
        deviceClass={machine.class}
        isRunning={running}
        cycles={machine.cycles}
        plan={machine.plan}
        aoiProductName={primaryProductLabel}
        aoiPoints={aoiPoints}
        aoiUnlocatedDefects={aoiUnlocatedDefects}
        iotLatestReading={iotLatestReading}
      />

      <Sheet
        className="hmi-readout-grid min-h-0 min-w-0"
        style={{ flexGrow: readoutFlex, flexBasis: 0 }}
        title={t("hmi.readoutPanel.title")}
        titleEn={gloss("hmi.readoutPanel.title")}
        bodyClassName="flex flex-1 min-h-0 flex-col p-0"
      >
        <div
          tabIndex={0}
          className="hmi-scroll min-h-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
        >
          <ReadoutGrid
            machine={machine}
            productLabel={isAoi ? productTileLabel : undefined}
            configDriftState={configDriftState}
          />
        </div>
      </Sheet>
    </div>
  )
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * I-3 (see `Hmi.tsx`'s pre-Task-5 history) — `configCheck.data.products` is not necessarily one entry:
 * an AOI/AVI machine's `/config/check` returns EVERY product the ecosystem knows about, each with its
 * OWN independent drift state. Worst-wins across the whole list is the only honest single-tile summary.
 */
const DRIFT_SEVERITY: Record<string, number> = { drift: 2, unknown: 1, in_sync: 0 }

function worstDriftState(products: readonly { driftState: string }[]): string | null {
  if (products.length === 0) return null
  return products.reduce<string>(
    (worst, prod) => ((DRIFT_SEVERITY[prod.driftState] ?? 1) > (DRIFT_SEVERITY[worst] ?? 1) ? prod.driftState : worst),
    products[0].driftState
  )
}

/**
 * H5 (relocated verbatim from `Hmi.tsx` by Task 5 — see this file's own header comment for why the
 * ratio itself could not move into the JSON documents) — layout spec §8's "adapt proportions per
 * machine class rather than copying the reference's fixed split blindly": `[schematicFlex,
 * readoutFlex]` grow ratios for the schematic/readout pair. AOI gets the extra room (its board + real
 * measurement-point dots need to stay legible, spec §7: "make this the strongest one"); IoT gives room
 * back to the readout grid instead, since its wireframe (a node, a link, an uplink) is comparatively
 * sparse and doesn't need the width; Automation splits evenly.
 */
const OVERVIEW_SCHEMATIC_READOUT_FLEX: Record<DeviceClass, [number, number]> = {
  Automation: [1, 1],
  AoiAvi: [1.15, 1],
  Iot: [0.85, 1.15],
}
