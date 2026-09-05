import { expect, test, type APIRequestContext } from "@playwright/test"

import { ENGINE_URL } from "./support/engine"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Session 2 (HMI-3) — THE GENERATED SCREEN, IN A BROWSER.
 *
 * ── WHAT THIS FILE IS FOR, AND WHAT IT IS NOT ────────────────────────────────────────────────────
 * `ScreenGenerator`'s mapping rules are measured in C# (`ScreenGeneratorTests`) and its output is
 * measured against the real schema and the real value source in Node
 * (`runtime-tests/screenGenerator.test.mjs`). Neither of those can see the one claim that made this
 * session worth doing: that an engineer who opens a machine with a declared component model and no
 * screen gets a USABLE screen instead of a blank canvas, and can publish it through the door
 * WS-HMI-2 already built. That claim is about a running browser, and this is where it lives.
 *
 * It is also where the OTHER claim lives — the uncomfortable one. The generated screen's bindings do
 * not resolve to readings today (6 of 6 measured), so the note that says so must be ON SCREEN at the
 * moment of generation, not in a report. A feature that renders empty without warning reads as
 * broken; the same feature with the sentence beside the button reads as unfinished, which is what it
 * is. So this file asserts the note is visible BEFORE the button is pressed.
 *
 * ── WHY `SCRW-02`, AND WHY A SCREEN ID THAT IS NOBODY'S PANEL ────────────────────────────────────
 * The store is append-only — five routes and no DELETE (`HmiScreenEndpoints`), and rollback appends —
 * so whatever this test publishes it keeps. `SCRW-01`, `AOI-01` and `IOT-01` carry pixel baselines
 * (`11-hmi.spec.ts-snapshots/`) and `IOT-02` is `43-editor-acceptance.spec.ts`'s machine, so this
 * file takes `SCRW-02`, which is in the roster (`fleet.json`) and carries neither.
 *
 * The screen id is deliberately NOT `machine-scrw-02`: publishing to a machine's panel id replaces
 * what an operator sees, permanently, and this test has no need to. `ScreenGenerator`'s own default
 * id (`generated-scrw-02`) is outside that namespace for exactly this reason, and the test asserts
 * the id it publishes under is the URL's own segment rather than the generator's default — the
 * identity rule Task 13 established and the reason `PUT`'s 409 cannot fire.
 *
 * ── THE PRECONDITION THIS FILE CANNOT CLEAR ──────────────────────────────────────────────────────
 * Like `43-editor-acceptance.spec.ts`, the journey needs a screen id that is NOT yet declared, and
 * after one run it IS. `playwright.config.ts`'s engine `webServer` wipes `web/.e2e-data` on every
 * boot, so a cold run always satisfies it; a re-run against a still-running engine does not. The
 * precondition is therefore asserted with a message naming the remedy.
 */

const MACHINE = "SCRW-02"

/** A legal screen id that is NOBODY's operator panel — see the header. */
const SCREEN_ID = "generated-cell-demo"

/**
 * The component tree the generator compiles. Chosen so that EVERY branch of the mapping rule is
 * exercised through a real browser, not only the easy ones:
 *
 *   * `running`  — `bool`, `role=in`     ⇒ status-lamp (named degradation, not state-badge)
 *   * `state`    — `enum`, `role=in`     ⇒ state-badge with an all-`idle` tone map
 *   * `torque`   — `float` with a band   ⇒ gauge
 *   * `target`   — `role=setpoint` AND a band AND a policyAction ⇒ setpoint-input, NOT a gauge.
 *                  This is the architect's first correction, and it is the whole reason `role` is the
 *                  outer discriminator.
 *   * `reset`    — `role=command`        ⇒ command-button
 *   * `weird`    — a policyAction OUTSIDE `KnownPolicyActions`. LEGAL in a component model (that door
 *                  checks only non-empty) and REFUSED by the screen door (which checks membership), so
 *                  the generator must emit a naming label instead — otherwise this very document would
 *                  produce a screen `PUT` answers 400 for, and the publish below would fail.
 */
const COMPONENT_MODEL = {
  schemaVersion: 1,
  machineCode: MACHINE,
  components: [
    { id: "spindle", typeId: "cell.spindle", label: "Spindle", tagPrefix: `${MACHINE}/spindle` },
  ],
  types: [
    {
      typeId: "cell.spindle",
      label: "Spindle",
      tags: [
        { name: "running", role: "in", dataType: "bool" },
        { name: "state", role: "in", dataType: "enum", enumValues: ["stopped", "running", "faulted"] },
        { name: "torque", role: "in", dataType: "float", unit: "Nm", min: 0, max: 20 },
        {
          name: "target",
          role: "setpoint",
          dataType: "float",
          unit: "Nm",
          min: 5,
          max: 15,
          policyAction: "machine.setpoint",
        },
        { name: "reset", role: "command", dataType: "bool", policyAction: "machine.command" },
        {
          name: "weird",
          role: "command",
          dataType: "bool",
          policyAction: "plant.override.unrecognised",
        },
      ],
      states: [
        { name: "run", expr: "running == true", tone: "run" },
        { name: "hot", expr: "torque > 18", tone: "warn" },
      ],
      defaultFaceplate: "fp.motor.spindle",
    },
  ],
}

async function putComponentModel(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/components/${MACHINE}`, { data: COMPONENT_MODEL })
  if (!res.ok()) {
    throw new Error(`PUT /v1/components/${MACHINE} failed: ${res.status()} ${await res.text()}`)
  }
}

test.describe("the screen generator, end to end", () => {
  test("an engineer opens a machine with a declared component model and no screen, and gets a usable generated screen they can publish", async ({
    page,
    request,
  }) => {
    // ── Preconditions, each asserted so a failure names its own cause ────────────────────────────
    const undeclared = await request.get(`${ENGINE_URL}/v1/screens/${SCREEN_ID}`)
    expect(
      undeclared.status(),
      `GET /v1/screens/${SCREEN_ID} answered ${undeclared.status()}, not 404. This test's premise is a screen ` +
        `nobody has authored, and the store is append-only so this test cannot clear it. The engine's own ` +
        `webServer wipes web/.e2e-data on every boot — RESTART THE ENGINE (or delete web/.e2e-data) and run again.`
    ).toBe(404)

    await putComponentModel(request)

    // ── 1. THE ROUTE STORES NOTHING, verified before the browser is involved ─────────────────────
    // 🔴 The existing ruling the whole design depends on: `GET /v1/screens/{id}` answers 404 for a
    // screen nobody authored, and generating must not quietly leave a row behind that softens it.
    const generated = await request.get(`${ENGINE_URL}/v1/screens/generate?machine=${MACHINE}`)
    expect(generated.ok(), `GET /v1/screens/generate answered ${generated.status()}`).toBe(true)
    const genDoc = (await generated.json()) as {
      screenId: string
      theme: string
      widgets: { id: string; kind: string; policyAction?: string; props?: Record<string, unknown> }[]
    }
    expect(
      (await request.get(`${ENGINE_URL}/v1/screens/${genDoc.screenId}`)).status(),
      "generating left a row behind — the route is supposed to store NOTHING"
    ).toBe(404)

    // The generated document is what the mapping rules say it is, checked on the wire rather than
    // only inside the generator's own language.
    expect(genDoc.theme).toBe("isa101")
    const kindOf = (id: string) => genDoc.widgets.find((w) => w.id === id)?.kind
    expect(kindOf("spindle-running")).toBe("status-lamp")
    expect(kindOf("spindle-state")).toBe("state-badge")
    expect(kindOf("spindle-torque")).toBe("gauge")
    // 🔴 The architect's correction: a setpoint that ALSO carries a hard band is a write widget, not
    // a gauge. Any rule that reads min/max before role turns every setpoint into a gauge and no write
    // widget is ever generated at all.
    expect(kindOf("spindle-target")).toBe("setpoint-input")
    expect(genDoc.widgets.find((w) => w.id === "spindle-target")?.policyAction).toBe("machine.setpoint")
    expect(kindOf("spindle-reset")).toBe("command-button")
    // 🔴 And the exception: an action the SCREEN door would refuse becomes a naming label, so the
    // document the generator hands back is one the publish door below can actually accept.
    expect(kindOf("spindle-weird")).toBe("label")
    expect(String(genDoc.widgets.find((w) => w.id === "spindle-weird")?.props?.text)).toContain(
      "plant.override.unrecognised"
    )

    // ── 2. THE EDITOR'S 404 BRANCH OFFERS BOTH STARTING POINTS ───────────────────────────────────
    await page.goto(`/editor/${SCREEN_ID}`)
    await expect(page.getByRole("heading", { name: viDict.editor.notDeclared.title, level: 2 })).toBeVisible()
    // The blank-canvas button Task 13 added is still there — generation is a second starting point,
    // not a replacement, because a machine with no component tree gets nothing from generation.
    await expect(page.locator("[data-editor-start-new]")).toBeVisible()
    await expect(page.locator("[data-editor-generate]")).toBeVisible()

    // 🔴 THE NOTE IS ON SCREEN BEFORE THE BUTTON IS PRESSED. Measured: 6 of 6 generated bindings
    // resolve to nothing against the only value source in this build, so an engineer who publishes a
    // generated screen sees an empty kiosk. Told first, this reads as unfinished; not told, it reads
    // as broken. This is the same discipline `TagPicker`'s `componentNote` already applies to the
    // same limit.
    await expect(page.locator("[data-editor-generate-note]")).toBeVisible()
    await expect(page.locator("[data-editor-generate-note]")).toContainText(
      viDict.editor.generate.note.slice(0, 40)
    )

    // The button refuses to act until a machine is named — a screen document is not bound to a
    // machine, so there is nothing for this route to guess.
    await expect(page.locator("[data-editor-generate]")).toBeDisabled()
    await page.locator("[data-editor-generate-machine]").selectOption(MACHINE)
    await expect(page.locator("[data-editor-generate]")).toBeEnabled()

    // ── 3. GENERATION SEEDS THE DRAFT, AND STILL WRITES NOTHING ──────────────────────────────────
    await page.locator("[data-editor-generate]").click()

    // A real editing session, drawn by the RUNTIME renderer — `data-hmi-screen` inside the editor is
    // what that means — carrying the identity of the URL, not the generator's own default id.
    await expect(page.locator(`[data-editor-canvas="${SCREEN_ID}"]`)).toBeVisible()
    await expect(page.locator(`[data-hmi-screen="${SCREEN_ID}"]`)).toBeVisible()

    // 🔴 THE DIFFERENCE FROM THE BLANK CANVAS, which is the entire point of the session: widgets. A
    // blank screen has zero, and `43-editor-acceptance.spec.ts` asserts `[data-layer-empty]` for
    // exactly that reason — so this assertion could not pass against `createBlankScreen`.
    await expect(page.locator("[data-layer-empty]")).toHaveCount(0)
    await expect(page.locator("[data-hmi-widget]")).toHaveCount(genDoc.widgets.length)
    await expect(page.locator('[data-hmi-widget="spindle-target"]')).toBeVisible()

    // Still nothing written. A draft lives in the route until the engineer publishes.
    expect((await request.get(`${ENGINE_URL}/v1/screens/${SCREEN_ID}`)).status()).toBe(404)

    // ── 4. IT PUBLISHES THROUGH THE DOOR WS-HMI-2 ALREADY BUILT ──────────────────────────────────
    // 🔴 The claim that makes this shippable rather than a demo: the generated document survives the
    // real §5/contract-invariant write door, in a browser, with no API write.
    await page.locator("[data-publish-button]").click()
    await expect(page.locator("[data-editor-current-version]")).toHaveAttribute(
      "data-editor-current-version",
      "1"
    )

    const stored = await request.get(`${ENGINE_URL}/v1/screens/${SCREEN_ID}`)
    expect(stored.status(), `the published generated screen could not be read back`).toBe(200)
    const storedDoc = (await stored.json()) as { screenId: string; theme: string; widgets: unknown[] }
    // The identity is the URL's, never the generator's default — Task 13's one-place-for-identity
    // rule, which is why `PUT`'s 409 has no way to fire.
    expect(storedDoc.screenId).toBe(SCREEN_ID)
    expect(storedDoc.theme).toBe("isa101")
    expect(storedDoc.widgets.length).toBe(genDoc.widgets.length)
  })

  test("generation is refused for an id the write door would refuse, and offered for one it would accept", async ({
    page,
  }) => {
    // 🔴 NEGATIVE CONTROL on the entry gate. `Bad_Id` is outside the frozen `^[a-z0-9-]+$`, so Task 13
    // already refuses to open a session for it — and the generate button must be refused on the same
    // terms rather than growing a second, more permissive door beside the first. Without this, an
    // engineer could generate a whole document and learn at publish, from a 400.
    await page.goto("/editor/Bad_Id")
    await expect(page.getByRole("heading", { name: viDict.editor.notDeclared.title, level: 2 })).toBeVisible()
    await expect(page.locator("[data-editor-illegal-id]")).toBeVisible()
    await expect(page.locator("[data-editor-start-new]")).toHaveCount(0)
    await expect(page.locator("[data-editor-generate]")).toHaveCount(0)

    // The control: a LEGAL id that is simply undeclared offers both, so the refusal above is about the
    // id and not about the section having been deleted.
    await page.goto("/editor/some-legal-undeclared-id")
    await expect(page.locator("[data-editor-start-new]")).toBeVisible()
    await expect(page.locator("[data-editor-generate]")).toBeVisible()
  })
})
