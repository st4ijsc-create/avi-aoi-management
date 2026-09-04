import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { LIVE_CYCLES_MS } from "./support/deadlines"
import { ENGINE_URL, setFleetRunning } from "./support/engine"

/**
 * WS-HMI-2 Task 5 — `{component}` indirect binding, observed in the PRODUCT.
 *
 * `hmi-runtime/bindings.ts` has implemented `{component}` in full since WS-HMI-1 Task 3, and
 * `runtime-tests/bindings.test.mjs` executes it directly. None of that was ever reachable from the
 * running app: `Hmi.tsx` mounted the ONE `<ScreenRenderer>` in the whole client with no `components`
 * prop, so `componentTagPrefixOf` was always called with `undefined`, every `{component}` binding came
 * back with its braces still in it, `TagValueSource` did not recognise the literal string, and both
 * widgets fell through to the same "no data" placeholder. Measured at `71e3af4c`, before any of this
 * task's code existed — see `task-5-report.md` §1 for the literal output.
 *
 * The lesson this file is written against is WS-HMI-0c's: OBSERVE THE RESULT, not a flag set on the way
 * in. Nothing below reads a prop, a query key or a source line — it reads what two tiles on a real
 * screen, in a real browser, actually say.
 *
 * -- Why the demo route and not `/hmi/SCRW-01` (the brief's own example) ---------------------------
 * Two reasons, both measured rather than assumed:
 *  1. No SHIPPED screen uses a `{component}` binding (`web/screens/*-overview.json`: one `faceplate`
 *     widget each, no `bindings` at all), and adding one would move a pinned visual baseline —
 *     `11-hmi.spec.ts`/`00-visual-and-a11y.spec.ts` own those three screens' pixels. The demo screen
 *     (`web/screens/demo/component-demo.json`) and the `/hmi/demo/:screenId` route exist so this claim
 *     can be made without touching a baseline.
 *  2. `SCRW-01` is an Automation machine and its `MachineDetail.telemetry` is EMPTY — only
 *     `IotSensorSim` produces telemetry (`temperature`/`humidity`/`current`), and `telemetry/{metric}`
 *     is the only path family in `TagValueSource`'s table with more than one live member. Two component
 *     instances that resolve to two DIFFERENT real readings is the whole point (identical values in
 *     both tiles would pass an implementation that ignored `widget.component` entirely), and an IoT
 *     node is the only machine class where that is true today without fabricating a reading.
 *
 * -- Why the two widgets differ only in `component` ------------------------------------------------
 * `probe-a` and `probe-b` in that document are byte-identical apart from `id`, `rect` and `component`:
 * no `props`, the same `bindings.value` of `"{component}"`. Every visible difference between the two
 * tiles below therefore comes from the component model alone — that IS "one faceplate authored once,
 * serving N instances", stated as a property of the document rather than as a claim in a comment.
 */

const DEMO_MACHINE = "IOT-01"
const DEMO_ROUTE = "/hmi/demo/component-demo"

/** The two instances the demo screen's two widgets name. `tagPrefix` is a FULL tag path here (not a
 * path with a leaf still to come) because `MachineDetailTagValueSource`'s only multi-member path family
 * is `telemetry/{metric}`, where the VARYING part is the leaf and the constant part is the prefix —
 * exactly backwards from the `"{component}/torque"` shape the contract's own worked example uses.
 * `ModelIntegrity.IsPathPrefix` treats an exact match as a valid prefix on purpose ("either an exact
 * match, or `path` continues with a '/'"), so this is a legal component tree, not a workaround. See
 * `task-5-report.md` for the limit of the one live-value adapter that exists today, named rather than
 * papered over. */
const TWO_INSTANCE_MODEL = {
  schemaVersion: 1,
  machineCode: DEMO_MACHINE,
  components: [
    { id: "probe-temp", typeId: "sensor.probe", label: "Dau do nhiet do", tagPrefix: "telemetry/temperature" },
    { id: "probe-hum", typeId: "sensor.probe", label: "Dau do do am", tagPrefix: "telemetry/humidity" },
  ],
  types: [
    {
      typeId: "sensor.probe",
      label: "Dau do",
      tags: [{ name: "value", role: "in", dataType: "float" }],
      states: [],
      defaultFaceplate: "fp.overview.iot",
    },
  ],
}

/** §5-bis's state, written explicitly rather than inherited from whatever an earlier run left behind:
 * a machine that has declared no components. `GET /v1/components/{code}` answers 200-with-an-empty-
 * document for a machine nobody ever PUT (never 404), and `componentTagPrefixOf` deliberately does not
 * distinguish "no components at all" from "an id that names nothing" — so an emptied tree and a
 * never-declared machine are the SAME input to everything downstream of the wire. */
const UNDECLARED_MODEL = { schemaVersion: 1, machineCode: DEMO_MACHINE, components: [], types: [] }

async function putComponentModel(request: APIRequestContext, doc: unknown): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/components/${DEMO_MACHINE}`, { data: doc })
  if (!res.ok()) {
    throw new Error(`PUT /v1/components/${DEMO_MACHINE} failed: ${res.status()} ${await res.text()}`)
  }
}

/** The `Readout` primitive's value ROW (value + unit) inside one widget's grid cell — `data-hmi-widget`
 * is `ScreenRenderer`'s own per-widget DOM hook and `hmi-readout-value` is `Readout.tsx`'s own class,
 * so this reads the shipped markup rather than a test-only attribute added for it. */
function readoutOf(page: Page, widgetId: string) {
  return page.locator(`[data-hmi-widget="${widgetId}"] .hmi-readout-value`)
}

/** The grid cell itself — carries `ScreenRenderer`'s `title` tooltip, which is where an unresolved
 * `{component}` binding becomes visible to an operator with no devtools open. */
function cellOf(page: Page, widgetId: string) {
  return page.locator(`[data-hmi-widget="${widgetId}"]`)
}

test.describe("HMI indirect binding — one screen authored once, serving two component instances", () => {
  test("§5-bis: a machine with no declared components still renders, direct bindings still work, only {component} degrades", async ({ page, request }) => {
    await putComponentModel(request, UNDECLARED_MODEL)

    await page.goto(DEMO_ROUTE)

    // The screen rendered AT ALL — no blank page, no error kiosk. This is the half of §5-bis that a
    // later refactor making `components` required would break first.
    await expect(page.locator('[data-hmi-screen="component-demo"]')).toBeVisible()

    // A DIRECT binding (`"cycles"`, no `{component}` token anywhere in it) is untouched by any of this
    // and still reads a real value — `formatMetric` renders even a pristine `cycles === 0` as "0", so
    // this assertion holds whether or not the fleet has ever run.
    await expect(readoutOf(page, "direct-cycles")).toHaveText(/^\d/)

    // The two `{component}` widgets degrade to the widget's own "no data" placeholder — one tile at a
    // time, not a page-level failure.
    await expect(readoutOf(page, "probe-a")).toHaveText("—")
    await expect(readoutOf(page, "probe-b")).toHaveText("—")

    // ...and they SAY SO on screen, not only in the console: `unresolvedComponentBindingWarning` names
    // the offending binding key in the cell's `title` tooltip. A silent "—" is indistinguishable from
    // genuine no-data, which is the defect that warning exists to close.
    await expect(cellOf(page, "probe-a")).toHaveAttribute("title", /\[value\].*\{component\}/)
    await expect(cellOf(page, "probe-b")).toHaveAttribute("title", /\[value\].*\{component\}/)
  })

  test("one screen authored once serves two component instances, and each shows its own tag", async ({ page, request }) => {
    // -- Preconditions, asserted rather than assumed ------------------------------------------------
    // If either of these is wrong the test below would go red for a reason that has nothing to do with
    // the wiring it exists to pin — "no component model exists" or "this machine has no live tags"
    // would look identical to "the prop was never forwarded". Failing HERE names the real cause.
    await putComponentModel(request, TWO_INSTANCE_MODEL)

    const declared = await request.get(`${ENGINE_URL}/v1/components/${DEMO_MACHINE}`)
    expect(declared.ok()).toBe(true)
    const model = (await declared.json()) as { components: { id: string; tagPrefix: string }[] }
    expect(model.components.map((c) => `${c.id}=${c.tagPrefix}`)).toEqual([
      "probe-temp=telemetry/temperature",
      "probe-hum=telemetry/humidity",
    ])

    // The engine has to be producing telemetry before either instance can resolve to a value at all —
    // `IotSensorSim` only emits while the fleet cycles.
    await setFleetRunning(request, true)
    await expect
      .poll(
        async () => {
          const res = await request.get(`${ENGINE_URL}/v1/machines/${DEMO_MACHINE}`)
          if (!res.ok()) return "not-ok"
          const dto = (await res.json()) as { telemetry: { metric: string; values: number[] }[] }
          const latest = (metric: string) => {
            const s = dto.telemetry.find((t) => t.metric === metric)
            return s && s.values.length > 0 ? s.values[s.values.length - 1] : undefined
          }
          const temperature = latest("temperature")
          const humidity = latest("humidity")
          if (temperature === undefined || humidity === undefined) return "no-values"
          return temperature === humidity ? "identical" : "two-distinct-values"
        },
        {
          timeout: LIVE_CYCLES_MS,
          message: `waiting for ${DEMO_MACHINE} to carry two DISTINCT live tag values (temperature, humidity) — without them this spec could not tell a working {component} resolution from a broken one`,
        }
      )
      .toBe("two-distinct-values")

    // -- The claim ---------------------------------------------------------------------------------
    await page.goto(DEMO_ROUTE)
    await expect(page.locator('[data-hmi-screen="component-demo"]')).toBeVisible()

    const a = readoutOf(page, "probe-a")
    const b = readoutOf(page, "probe-b")

    // Each instance resolved to a reading of its own — neither is the "no data" placeholder.
    await expect(a).not.toHaveText("—")
    await expect(b).not.toHaveText("—")

    // ...and the two readings are DIFFERENT. This is the assertion an implementation that ignored
    // `widget.component` (resolving every widget through the same prefix, or through none) cannot pass,
    // and the reason the demo screen declares two instances rather than one.
    const aText = (await a.innerText()).trim()
    const bText = (await b.innerText()).trim()
    expect(aText).not.toBe(bText)

    // Nothing degraded quietly on the way: with both prefixes resolved, `ScreenRenderer` emits NO
    // unresolved-binding tooltip on either cell.
    await expect(cellOf(page, "probe-a")).not.toHaveAttribute("title", /\{component\}/)
    await expect(cellOf(page, "probe-b")).not.toHaveAttribute("title", /\{component\}/)
  })
})
