import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test"

import { LIVE_CYCLES_MS } from "./support/deadlines"
import { ENGINE_URL, setFleetRunning } from "./support/engine"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-HMI-2 Task 13 — THE ACCEPTANCE PASS. One engineer, one machine that has never had a screen, one
 * pass with no seams: open the editor, add a widget from the registry menu, bind it with the tag
 * picker, place it, publish — and then find it on the machine's own operator panel, with live data.
 *
 * ── WHY THIS FILE IS THE POINT OF THE WHOLE WORKSTREAM ───────────────────────────────────────────
 * Measured by the controller at `20f78b8d`, before this task: `/hmi/{code}` rendered
 * `SCREEN_DOCS[machine.class]` — three documents STATICALLY imported into the JS bundle — and no file
 * outside `src/editor/` called `/v1/screens` at all. Twelve tasks built a screen store, a publish door
 * with versions and rollback, a canvas that is literally the runtime renderer, a tag picker, a layer
 * tree and a property panel. **Every one of those halves was pinned, thoroughly, and nothing joined
 * them: the editor wrote into a store the operator panel never opened.** An acceptance pass is what
 * finds that; no amount of per-task testing did, because each task's own claim was true.
 *
 * That is WS-HMI-0c's lesson at a new address, and this file's own brief cites it: there, a lambda
 * handed a service a different store on a different directory and left 1728 tests green. "Both halves
 * are pinned" is not "the thing works", and only a test that walks the whole way can tell them apart.
 *
 * ── THE TWO TESTS, AND WHY THEY ARE TWO ──────────────────────────────────────────────────────────
 *   1. **§5-bis** — the three machines that carry visual baselines still render exactly the documents
 *      they shipped with, AND the kiosk provably ASKED the store first. Both halves matter: without
 *      the second, a join that had been silently deleted would pass; without the first, a join that
 *      worked would still be allowed to move a baseline.
 *   2. **The journey** — one test, one pass, no API writes once the browser is driving. It is written
 *      so that cutting ANY link reddens it: the derived screen id, the fetch, the fallback's
 *      precedence, the `set-component` edit, the bare `{component}` insert, the publish, or the
 *      renderer's own `components` prop.
 *
 * ── WHY `IOT-02` AND NOT `IOT-01`, AND WHY NOT `SCRW-01` ─────────────────────────────────────────
 * The journey PUBLISHES, and a published row cannot be deleted: the store is append-only by design
 * (five routes, no DELETE — `HmiScreenEndpoints`), and rollback APPENDS. So whichever machine this
 * test builds a screen for keeps that screen for the life of the store. `IOT-01`, `AOI-01` and
 * `SCRW-01` are exactly the three machines whose panels carry pixel baselines
 * (`11-hmi.spec.ts-snapshots/hmi-{iot,aoi,automation}-*.png`), so publishing to one of them would put
 * a live regression trap in the suite: harmless in file order today, and a moved baseline the first
 * time somebody runs `11-hmi.spec.ts` alone against an engine that is still up.
 *
 * `IOT-02` is the only other machine in the roster that can carry this test at all, and the reason is
 * measured rather than chosen: two component instances must resolve to two DIFFERENT live readings —
 * identical values would pass an implementation that ignored `widget.component` entirely — and
 * `TagValueSource`'s only multi-member path family is `telemetry/{metric}`, which only `IotSensorSim`
 * ever fills. The roster's IoT nodes are `IOT-01` and `IOT-02`; the first is a baseline machine.
 *
 * `39-editor-properties.spec.ts` also uses `IOT-02` (for its tag picker) and re-`PUT`s its own
 * component model in its own `beforeEach`, as this file does — so neither depends on what the other
 * left behind, in either order.
 *
 * ── 🔴 A LIMIT OF THIS FILE, NAMED RATHER THAN LEFT TO BE DISCOVERED ─────────────────────────────
 * The journey's first precondition is that `machine-iot-02` is NOT declared, and after this test runs
 * once it IS. `playwright.config.ts`'s engine `webServer` runs `scripts/reset-engine-state.mjs`, which
 * wipes `web/.e2e-data` WHOLESALE before every boot, so a cold run always satisfies it. A re-run
 * against an engine that is still up from a previous run does NOT, because `reuseExistingServer` is
 * true outside CI. That precondition is therefore asserted with a message naming the remedy (restart
 * the engine) rather than left to fail somewhere further in as a confusing mid-journey error. It is a
 * real cost of testing an append-only store through its own public surface, and the alternative — a
 * test-only delete route — would be a hole in the store's contract cut for a test's convenience.
 */

/** The machine the engineer builds a screen for. See the header for why this one and no other. */
const MACHINE = "IOT-02"

/**
 * The screen id `/hmi/IOT-02`'s kiosk resolves for itself, WRITTEN OUT rather than imported from
 * `machineScreenId`.
 *
 * Deliberate, and it is the difference between a pin and a mirror: a test that derived the id with the
 * same function the product uses would agree with that function at ANY derivation — rename the prefix,
 * drop the case fold, and this file would follow along quietly. The literal is a second, independent
 * statement of the rule, and `runtime-tests/screenJoin.test.mjs` holds the FUNCTION to the frozen
 * schema's pattern and to the real roster from the other side.
 */
const SCREEN_ID = "machine-iot-02"

/** The two component instances the built screen's two widgets are placed against.
 *
 * `tagPrefix` is a FULL tag path, not a prefix with a leaf still to come, and that is the shape that
 * makes a BARE `{component}` binding read a live number today: `resolveBinding` substitutes the token
 * with the prefix verbatim, and `telemetry/temperature` is a path `MachineDetailTagValueSource`
 * actually answers. The composed `{component}/leaf` form the design doc's own example uses resolves
 * correctly and then reads nothing, because no `TagValueSource` in this tree answers a composed path —
 * a missing ADAPTER, named in `TagPicker`'s own on-screen note and in `35-hmi-indirect-binding.spec.ts`.
 * Task 5 established this; this file reproduces it through the editor instead of through a shipped
 * JSON file. */
const INSTANCES = [
  { id: "ins-temp", tagPrefix: "telemetry/temperature" },
  { id: "ins-hum", tagPrefix: "telemetry/humidity" },
] as const

const COMPONENT_MODEL = {
  schemaVersion: 1,
  machineCode: MACHINE,
  components: INSTANCES.map((instance) => ({
    id: instance.id,
    typeId: "sensor.probe",
    label: `Dau do ${instance.id}`,
    tagPrefix: instance.tagPrefix,
  })),
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

/**
 * The three machines whose operator panels carry pixel baselines, and the document each must go on
 * rendering. The screen ids are the ones INSIDE `web/screens/*-overview.json`, so this table names
 * what `ScreenRenderer` publishes as its own identity rather than a filename.
 */
const BASELINE_MACHINES = [
  { code: "SCRW-01", shippedScreen: "automation-overview", derivedId: "machine-scrw-01" },
  { code: "AOI-01", shippedScreen: "aoi-overview", derivedId: "machine-aoi-01" },
  { code: "IOT-01", shippedScreen: "iot-overview", derivedId: "machine-iot-01" },
] as const

async function putComponentModel(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/components/${MACHINE}`, { data: COMPONENT_MODEL })
  if (!res.ok()) {
    throw new Error(`PUT /v1/components/${MACHINE} failed: ${res.status()} ${await res.text()}`)
  }
}

/** The `Readout` primitive's value row inside one widget's grid cell — `data-hmi-widget` is the
 * renderer's own per-widget hook and `hmi-readout-value` is `Readout.tsx`'s own class, so this reads
 * the shipped markup rather than anything added for a test. */
function readoutOf(page: Page, widgetId: string): Locator {
  return page.locator(`[data-hmi-widget="${widgetId}"] .hmi-readout-value`)
}

function renderedCell(page: Page, widgetId: string): Locator {
  return page.locator(`[data-hmi-widget="${widgetId}"]`)
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox()
  expect(box, "an element expected to be laid out has no box").toBeTruthy()
  return box as { x: number; y: number; width: number; height: number }
}

/** The 0-based grid row the renderer actually placed a widget on, read out of the computed style —
 * the same technique `38-editor-drag.spec.ts` uses, and for the same reason: the screen is the only
 * witness that does not depend on the editor agreeing with itself. */
async function rowOnScreen(page: Page, widgetId: string): Promise<number> {
  const cell = renderedCell(page, widgetId)
  await expect(cell).toBeVisible()
  const start = await cell.evaluate((el) => getComputedStyle(el).gridRowStart)
  const line = Number.parseInt(start, 10)
  expect(Number.isInteger(line) && line >= 1, `grid-row-start on "${widgetId}" is ${JSON.stringify(start)}`).toBe(true)
  return line - 1
}

/** Adds a widget of `kind` through the LAYER TREE's registry menu — the add path an engineer uses,
 * whose vocabulary is `Object.keys(widgetRegistry)` rather than a list typed beside the JSX. */
async function addWidget(page: Page, kind: string, expectedId: string): Promise<void> {
  await page.locator("[data-layer-add-kind]").selectOption(kind)
  await page.locator("[data-layer-add]").click()
  // The new widget is selected by the tree itself, so the property panel is already open on it.
  await expect(page.locator("[data-panel-widget-id]")).toHaveText(expectedId)
}

/**
 * Binds `widgetId`'s `value` to the BARE `{component}` token THROUGH THE TAG PICKER, and places the
 * widget against `componentId` through the property panel's component chooser.
 *
 * Both halves go through real controls on purpose. Before this task neither existed: the tag picker
 * offered only the composed `{component}/leaf` form (which resolves to nothing at runtime) and the
 * `component` field had no edit at all — so the one feature design §3.3 calls the mechanism that makes
 * Ignition scale was authorable only by hand-editing JSON outside this application.
 */
async function bindThroughPicker(page: Page, widgetId: string, componentId: string): Promise<void> {
  await page.locator("[data-panel-binding-new-name]").fill("value")
  // "Add binding" creates the row EMPTY and opens the picker on it — the panel's own behaviour, not a
  // second click here.
  await page.locator("[data-panel-binding-add]").click()
  await expect(page.locator('[data-tag-picker="value"]')).toBeVisible()

  // The machine whose namespace and component tree the picker browses. A screen document names no
  // machine (the frozen contract has no such field), so the editor has to ask — this is that question.
  await page.locator("[data-tag-picker-machine]").selectOption(MACHINE)

  await page.locator("[data-tag-component-insert-bare]").click()
  await expect(page.locator('[data-panel-binding-path="value"]')).toHaveValue("{component}")
  await page.locator("[data-tag-picker-close]").click()

  // …and WHICH instance that token resolves through. The list is the machine's declared model, so a
  // typo cannot look like a component that simply is not declared yet.
  await page.locator("[data-panel-component-choose]").selectOption(componentId)
  await expect(page.locator("[data-panel-component]")).toHaveText(componentId)
  expect(
    await page.locator("[data-panel-component-choose]").inputValue(),
    `${widgetId}: the component chooser did not settle on ${componentId}`
  ).toBe(componentId)
}

test.describe("WS-HMI-2 acceptance — an engineer builds a machine's screen, and the machine shows it", () => {
  test("§5-bis: a machine with no PUBLISHED screen renders exactly its shipped document — and the kiosk really did ask the store", async ({
    page,
    request,
  }) => {
    /**
     * The property the 31 visual baselines rest on, measured in a browser instead of argued in a
     * comment. Two halves, and each catches what the other cannot:
     *
     *   * the kiosk ASKED — `GET /v1/screens/machine-{code}` was actually issued. Delete the join and
     *     this half reddens even though every pixel is still right, which is precisely the failure
     *     mode that survived twelve tasks;
     *   * the kiosk FELL BACK — what rendered is the machine's own shipped document, by its own
     *     `screenId`, and nothing else rendered beside it. Delete the fallback and this half reddens
     *     with a blank or wrong panel, which is the §5-bis violation.
     */
    for (const machine of BASELINE_MACHINES) {
      // Precondition, asserted rather than assumed: nothing in this repository publishes these ids,
      // and the whole baseline argument depends on that staying true. If one of them ever becomes a
      // real row, this line says so by name instead of a screenshot diff saying it three specs later.
      const probe = await request.get(`${ENGINE_URL}/v1/screens/${machine.derivedId}`)
      expect(
        probe.status(),
        `GET /v1/screens/${machine.derivedId} answered ${probe.status()}, not 404 — something has PUBLISHED a ` +
          `screen for ${machine.code}. Its operator panel now renders that document instead of ` +
          `${machine.shippedScreen}, and 11-hmi.spec.ts's pixel baseline for it is no longer measuring the ` +
          `shipped screen.`
      ).toBe(404)

      const asked: string[] = []
      const record = (url: string) => {
        const path = new URL(url).pathname
        if (path.startsWith("/v1/screens/")) asked.push(path)
      }
      page.on("request", (req) => record(req.url()))

      await page.goto(`/hmi/${machine.code}`)
      await expect(page.getByRole("heading", { name: machine.code, level: 1 })).toBeVisible()

      // THE JOIN IS ON THE PATH. Not "a screen rendered" — this panel consulted the published-screen
      // store for THIS machine, under the id the derivation produces.
      expect(
        asked,
        `/hmi/${machine.code} never requested its published screen. The kiosk is not reading the store ` +
          `the editor publishes into — the exact state this workstream shipped twelve tasks in.`
      ).toContain(`/v1/screens/${machine.derivedId}`)
      page.removeAllListeners("request")

      // …and the fallback delivered the shipped document, unchanged. `toHaveCount(1)` is what catches a
      // second screen rendering beside it.
      await expect(page.locator("[data-hmi-screen]")).toHaveCount(1)
      await expect(page.locator(`[data-hmi-screen="${machine.shippedScreen}"]`)).toBeVisible()
    }
  })

  test("an engineer builds a screen for a machine that has never had one, without writing a line of code, and the machine shows it with live data", async ({
    page,
    request,
  }) => {
    // ── Preconditions, each asserted so a failure names its own cause ────────────────────────────
    const undeclared = await request.get(`${ENGINE_URL}/v1/screens/${SCREEN_ID}`)
    expect(
      undeclared.status(),
      `GET /v1/screens/${SCREEN_ID} answered ${undeclared.status()}, not 404. This test's whole premise is a ` +
        `machine that has NEVER had a screen, and the store is append-only (no DELETE route, and rollback ` +
        `appends) so this test cannot clear it. The engine's own webServer wipes web/.e2e-data on every ` +
        `boot — RESTART THE ENGINE (or delete web/.e2e-data) and run again. See this file's header.`
    ).toBe(404)

    // The component tree the two widgets resolve `{component}` through. Written by API because
    // declaring a machine's components is WS-HMI-0a's job and a different surface entirely; everything
    // this test claims about the EDITOR happens in the browser below, with no API write after this one.
    await putComponentModel(request)
    const declared = await request.get(`${ENGINE_URL}/v1/components/${MACHINE}`)
    expect(declared.ok()).toBe(true)
    expect(((await declared.json()) as { components: { id: string; tagPrefix: string }[] }).components.map(
      (c) => `${c.id}=${c.tagPrefix}`
    )).toEqual(INSTANCES.map((i) => `${i.id}=${i.tagPrefix}`))

    // Two DISTINCT live readings, or the final assertion could not tell a working `{component}`
    // resolution from a broken one — identical values would pass an implementation that ignored
    // `widget.component` altogether.
    await setFleetRunning(request, true)
    await expect
      .poll(
        async () => {
          const res = await request.get(`${ENGINE_URL}/v1/machines/${MACHINE}`)
          if (!res.ok()) return "not-ok"
          const dto = (await res.json()) as { telemetry: { metric: string; values: number[] }[] }
          const latest = (metric: string) => {
            const series = dto.telemetry.find((t) => t.metric === metric)
            return series && series.values.length > 0 ? series.values[series.values.length - 1] : undefined
          }
          const temperature = latest("temperature")
          const humidity = latest("humidity")
          if (temperature === undefined || humidity === undefined) return "no-values"
          return temperature === humidity ? "identical" : "two-distinct-values"
        },
        {
          timeout: LIVE_CYCLES_MS,
          message: `waiting for ${MACHINE} to carry two DISTINCT live tag values (temperature, humidity) — without them this test could not tell a working {component} resolution from a broken one`,
        }
      )
      .toBe("two-distinct-values")

    // ── 1. The engineer opens the editor for a machine that has no screen ────────────────────────
    await page.goto(`/editor/${SCREEN_ID}`)
    // §5-bis's named not-found state — not a blank page, not an error page — and, since this task, a
    // way forward out of it.
    await expect(page.getByRole("heading", { name: viDict.editor.notDeclared.title, level: 2 })).toBeVisible()
    await expect(page.locator("[data-editor-current-version]")).toHaveAttribute("data-editor-current-version", "")

    await page.locator("[data-editor-start-new]").click()

    // A real editing session on a real, empty document — drawn by the RUNTIME renderer, which is what
    // `data-hmi-screen` being present inside the editor means.
    await expect(page.locator(`[data-editor-canvas="${SCREEN_ID}"]`)).toBeVisible()
    await expect(page.locator(`[data-hmi-screen="${SCREEN_ID}"]`)).toBeVisible()
    await expect(page.locator("[data-layer-empty]")).toBeVisible()
    // Nothing has been written: starting a draft must not create a row.
    expect((await request.get(`${ENGINE_URL}/v1/screens/${SCREEN_ID}`)).status()).toBe(404)

    // ── 2. Add a widget from the registry menu, bind it with the tag picker ──────────────────────
    await addWidget(page, "readout", "w-1")
    await bindThroughPicker(page, "w-1", INSTANCES[0].id)

    await addWidget(page, "readout", "w-2")
    await bindThroughPicker(page, "w-2", INSTANCES[1].id)

    // ── 3. Place them ───────────────────────────────────────────────────────────────────────────
    // Both widgets were born at the same cell (the layer tree's `freshRect` is deterministic, not
    // "somewhere free"), so placement is not decoration here — without it one covers the other.
    // `w-2` is placed through the property panel's grid fields; `w-1` is then DRAGGED, so the journey
    // covers both of the editor's placement surfaces rather than the cheaper one.
    await page.locator('[data-panel-rect="row"]').fill("3")
    await page.locator('[data-panel-rect="row"]').press("Enter")
    expect(await rowOnScreen(page, "w-2")).toBe(3)
    expect(await rowOnScreen(page, "w-1")).toBe(0)

    // One cell of travel, MEASURED off the grid the browser laid out — by subtraction between two
    // widgets a known number of rows apart, never by re-deriving the renderer's own formula.
    const a = await boxOf(renderedCell(page, "w-1"))
    const b = await boxOf(renderedCell(page, "w-2"))
    const rowPitch = (b.y - a.y) / 3
    expect(rowPitch, "the measured row pitch is not a usable positive number — the canvas may be collapsed").toBeGreaterThan(1)

    await page.locator('[data-layer-select="w-1"]').click()
    const handle = page.locator('[data-editor-widget="w-1"]')
    const grip = await boxOf(handle)
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + rowPitch, { steps: 6 })
    await page.mouse.up()
    expect(await rowOnScreen(page, "w-1"), "the drag did not land one whole cell down").toBe(1)

    // ── 4. Publish ──────────────────────────────────────────────────────────────────────────────
    await page.locator("[data-publish-button]").click()
    await expect(page.locator("[data-publish-version]")).toHaveAttribute("data-publish-version", "1")
    // A SECOND, independent witness: the route header reads the engine's version list back, through a
    // query the publish invalidates — it does not repeat what the mutation returned.
    await expect(page.locator("[data-editor-current-version]")).toHaveAttribute("data-editor-current-version", "1")

    // What actually reached the store, read straight from the engine. Everything below this line was
    // authored with a mouse: no request in this test wrote a screen document.
    const stored = await request.get(`${ENGINE_URL}/v1/screens/${SCREEN_ID}`)
    expect(stored.status()).toBe(200)
    const doc = (await stored.json()) as {
      screenId: string
      widgets: { id: string; kind: string; component?: string; bindings?: Record<string, string>; rect: { row: number } }[]
    }
    expect(doc.screenId).toBe(SCREEN_ID)
    expect(
      doc.widgets.map((w) => `${w.id}:${w.kind}:${w.component}:${w.bindings?.value}:row${w.rect.row}`)
    ).toEqual([`w-1:readout:${INSTANCES[0].id}:{component}:row1`, `w-2:readout:${INSTANCES[1].id}:{component}:row3`])

    // ── 5. THE JOIN — the machine's own operator panel shows what was just built, with live data ──
    await page.goto(`/hmi/${MACHINE}`)
    await expect(page.getByRole("heading", { name: MACHINE, level: 1 })).toBeVisible()

    // The published document won, and the machine's CLASS document did not render. Both assertions are
    // needed: the first goes red if the join is cut, the second goes red if the join renders BESIDE the
    // fallback instead of instead of it.
    await expect(page.locator(`[data-hmi-screen="${SCREEN_ID}"]`)).toBeVisible()
    await expect(page.locator('[data-hmi-screen="iot-overview"]')).toHaveCount(0)

    const first = readoutOf(page, "w-1")
    const second = readoutOf(page, "w-2")
    // Live, not a placeholder — `formatValue` renders any real reading, and "—" is the widget's own
    // no-data state for a binding that resolved to nothing.
    await expect(first).not.toHaveText("—")
    await expect(second).not.toHaveText("—")

    // …and the two tiles read DIFFERENT values. This is the assertion an implementation that ignored
    // `widget.component` — resolving every widget through the same prefix, or through none — cannot
    // pass, and it is why the screen was built with two instances rather than one.
    expect((await first.innerText()).trim()).not.toBe((await second.innerText()).trim())

    // Nothing degraded quietly on the way: with both prefixes resolved the renderer emits no
    // unresolved-`{component}` tooltip on either cell, and no clamp warning either — so the rects on
    // screen are the rects the engineer placed.
    await expect(renderedCell(page, "w-1")).not.toHaveAttribute("title", /.+/)
    await expect(renderedCell(page, "w-2")).not.toHaveAttribute("title", /.+/)
    expect(await rowOnScreen(page, "w-1")).toBe(1)
    expect(await rowOnScreen(page, "w-2")).toBe(3)
  })
})
