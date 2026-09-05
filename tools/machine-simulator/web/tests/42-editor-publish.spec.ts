import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import ts from "typescript"

import { ENGINE_URL } from "./support/engine"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-HMI-2 Task 12 — PUBLISH, VERSION HISTORY, PREVIEW AN OLD VERSION, ROLLBACK, BREAKPOINT PREVIEW,
 * and the UNSAVED-WORK WARNING.
 *
 * ── WHAT THIS FILE IS THE ONLY PLACE TO MEASURE ──────────────────────────────────────────────────
 * `runtime-tests/editorState.test.mjs` executes the edit vocabulary directly and proves, against the
 * real `contract-tests/validate.mjs`, that `set-breakpoint` accepts exactly the three values
 * `contracts/hmi-screen.schema.json` declares and writes `layout.breakpoint` and nothing else.
 * `St4i.EngineApi.Tests`/`St4i.Hmi.Contracts.Tests` prove the publish door refuses what the frozen
 * schema refuses. Neither says a button exists, that pressing it sends a `PUT`, that the version it
 * answers reaches the screen, that a refusal reaches the screen, that previewing an old version
 * leaves unsaved work alone, or that leaving the page while dirty warns. Those are claims about DOM
 * and about a real browser, and `.tsx` cannot be `import()`ed under `node --test` (measured
 * repeatedly on this tree — see `widgetRegistry.test.mjs`'s header), so they live here.
 *
 * ── 🔴 EVERY INTERCEPTION IN THIS FILE, ENUMERATED FROM THE CODE ──────────────────────────────────
 * 🔴 FIX ROUND 1, task-12-review.md M3. This block previously said "THE ONE PLACE THIS FILE FAKES
 * ANYTHING" and was wrong three ways at once — it counted one interception where there were two,
 * described a mutation the code does not perform ("deleting a `command-button`'s `policyAction`"; the
 * test replaces `body.widgets` wholesale), and listed the 404 rollback refusal among the things that
 * are NOT faked while rewriting its body. A declaration of honesty that is itself inaccurate is worse
 * than no declaration, so this list is now derived by reading the file, and the counts below are
 * asserted by a test at the bottom of it rather than maintained by hand.
 *
 * **THREE `page.route` interceptions, in three tests. All three rewrite only what LEAVES the browser;
 * none fabricates a response.** There is no `route.fulfill` and no `route.abort` anywhere in this file.
 *
 *   1. *a REFUSED publish shows EVERY violation* — `route.continue({ postData })` on the PUT, replacing
 *      `body.widgets` with two synthetic widgets: one whose `id` the frozen pattern refuses (`Bad-Id`)
 *      and one ungated `command-button` (§5). The 400, and every violation in it, is the engine's.
 *   2. *a rollback the engine refuses* — `route.continue({ postData })` on the rollback POST, replacing
 *      `toVersion` with a version that does not exist. The 404 and its sentence are the engine's.
 *   3. *a version that cannot be read is NAMED* — `route.continue({ url })` on the versioned GET,
 *      pointing it at a version that does not exist. The 404 is the engine's; only the URL changed.
 *
 * Why any of it is needed, stated rather than glossed: **the editor's own vocabulary cannot build a
 * document the publish door refuses.** `applyEdit` mirrors `$defs/widget`, gates §5 on both the add
 * path and the kind picker, and enforces the frozen id pattern on rename — so there is no sequence of
 * clicks that produces a §5-violating document, and (since Task 12's server-side fix) none that
 * produces a document with an unknown `kind` or a malformed widget id either. That is a good property
 * and `editorState.test.mjs` is where it is measured. It also means the only honest way to see the
 * refusal surfaces work is to send what a client WITHOUT those guards would send — which is precisely
 * the population the server door exists for.
 *
 * Everything NOT in the list above — every publish, every rollback, every version read, every document
 * read — goes to the real engine with a real body and a real answer.
 *
 * ── 🔴 WHY THE HEADER'S VERSION IS ASSERTED AND NOT ONLY THE PANEL'S ─────────────────────────────
 * `PublishPanel` renders the number its own `PUT` returned. A test that read only that would agree
 * with the mutation by construction and could not tell whether the write landed. `EditorRoute`'s
 * header reads `GET /v1/screens/{id}/versions` — a different request, invalidated by the publish —
 * and the tests below assert BOTH plus a third witness, the engine queried directly over HTTP.
 */

const ROUTE = (screenId: string) => `/editor/${screenId}`

/** `web/tests` → `web`. */
const WEB = dirname(dirname(fileURLToPath(import.meta.url)))

/** CRLF: `core.autocrlf=true` on this repository, so a fresh checkout carries `\r\n` while every
 * pattern below is written with `\n`. Normalised once, the way every source-reading pin here does. */
const readNormalized = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n")

const SCHEMA = JSON.parse(readNormalized(join(dirname(WEB), "contracts", "hmi-screen.schema.json"))) as {
  $defs: { layout: { properties: { breakpoint: { enum: string[] } } } }
}

/** The frozen breakpoint vocabulary, READ rather than retyped — this file never states what the three
 * breakpoints are called, it asks the schema and then checks the chooser agrees. */
const SCHEMA_BREAKPOINTS = SCHEMA.$defs.layout.properties.breakpoint.enum

/**
 * `lib/hmiScreens.ts`'s `SCREEN_BREAKPOINT_WIDTHS`, READ FROM SOURCE rather than imported.
 *
 * Not a preference: that module `import`s `screens/demo/component-demo.json`, and Playwright's ESM
 * loader rejects a JSON import without an import attribute — measured, the whole file failed to
 * collect with *"needs an import attribute of type: json"*. Reading the declaration off disk is also
 * the idiom `40-editor-layers.spec.ts` already uses for the widget registry, and for the same reason:
 * the product's own declaration is the thing under test, so it is read, not linked.
 *
 * Parsed through TypeScript's own compiler rather than a regex — the numeric literals sit inside an
 * object literal that a comment block above it also discusses in prose.
 */
const BREAKPOINT_WIDTHS: Record<string, number> = (() => {
  const file = join(WEB, "src", "lib", "hmiScreens.ts")
  const sf = ts.createSourceFile(file, readNormalized(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: Record<string, number> = {}
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "SCREEN_BREAKPOINT_WIDTHS" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && ts.isNumericLiteral(prop.initializer)) {
          out[prop.name.text] = Number(prop.initializer.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
})()

/**
 * The design-time width declared for a breakpoint the SCHEMA named.
 *
 * The lookup throws rather than returning `undefined`, and that earns its place: it makes "every
 * breakpoint the frozen contract declares has a preview width" an assertion this file MAKES, which
 * `Record<ScreenBreakpoint, number>` only proves for code that already knows the three names.
 */
function declaredWidth(breakpoint: string): number {
  const width = BREAKPOINT_WIDTHS[breakpoint]
  if (width === undefined) {
    throw new Error(
      `contracts/hmi-screen.schema.json declares the breakpoint "${breakpoint}" but ` +
        `SCREEN_BREAKPOINT_WIDTHS has no width for it — the chooser would render a frame of undefined px`
    )
  }
  return width
}

type ProbeWidget = {
  id: string
  kind: string
  rect: { col: number; row: number; colSpan: number; rowSpan: number }
  props?: Record<string, unknown>
  policyAction?: string
}

type ProbeDocument = {
  schemaVersion: 1
  screenId: string
  title: string
  theme: string
  layout: { cols: number; rows: number; breakpoint: string }
  widgets: ProbeWidget[]
}

const ALPHA_TEXT = "ALPHA-PUBLISH-TEXT"
const BRAVO_TEXT = "BRAVO-PUBLISH-TEXT"

function probeDoc(screenId: string, widgets: ProbeWidget[]): ProbeDocument {
  return {
    schemaVersion: 1,
    screenId,
    title: `Publish probe — ${screenId}`,
    theme: "isa101",
    // 🔴 `panel` on purpose, and it matters: it is the widest of the three, so the preview frame's
    // `max-width` is inert at the default and the canvas starts every test at exactly the size it had
    // before this task. The breakpoint test below is the one that narrows it.
    layout: { cols: 12, rows: 4, breakpoint: "panel" },
    widgets,
  }
}

const ALPHA: ProbeWidget = {
  id: "pub-alpha",
  kind: "label",
  rect: { col: 0, row: 0, colSpan: 4, rowSpan: 1 },
  props: { text: ALPHA_TEXT },
}
const BRAVO: ProbeWidget = {
  id: "pub-bravo",
  kind: "label",
  rect: { col: 5, row: 0, colSpan: 4, rowSpan: 1 },
  props: { text: BRAVO_TEXT },
}

async function putScreen(request: APIRequestContext, doc: ProbeDocument): Promise<number> {
  const res = await request.put(`${ENGINE_URL}/v1/screens/${doc.screenId}`, { data: doc })
  if (!res.ok()) throw new Error(`PUT /v1/screens/${doc.screenId} failed: ${res.status()} ${await res.text()}`)
  const body = (await res.json()) as { version: number }
  return body.version
}

type VersionRow = { version: number; savedAtUtc: string; isCurrent: boolean }

async function versionsOf(request: APIRequestContext, screenId: string): Promise<VersionRow[]> {
  const res = await request.get(`${ENGINE_URL}/v1/screens/${screenId}/versions`)
  if (!res.ok()) throw new Error(`GET versions failed: ${res.status()}`)
  return (await res.json()) as VersionRow[]
}

/** The engine's own answer to "which version is current", read straight over HTTP — the third witness
 * this file's header names, independent of both the panel and the route header. */
async function headVersion(request: APIRequestContext, screenId: string): Promise<number | undefined> {
  return (await versionsOf(request, screenId)).find((row) => row.isCurrent)?.version
}

async function openEditor(page: Page, screenId: string): Promise<void> {
  await page.goto(ROUTE(screenId))
  await expect(page.locator(`[data-editor-canvas="${screenId}"]`)).toBeVisible()
  await expect(page.locator(`[data-hmi-screen="${screenId}"]`)).toBeVisible()
  await expect(page.locator("[data-publish-panel]")).toBeVisible()
}

/** The ids the RENDERER placed, in the order it placed them — read off the canvas, never off the
 * panel, so a panel that agreed with itself could not satisfy an assertion made with this. */
function canvasIds(page: Page, screenId: string): Promise<string[]> {
  return page
    .locator(`[data-hmi-screen="${screenId}"] [data-hmi-widget]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-hmi-widget") ?? ""))
}

/** Adds one `label` widget through the layer tree's own add menu — a real edit, made the way an
 * engineer makes it, so "dirty" below means what it says. Returns the id the tree generated. */
async function addLabelWidget(page: Page, screenId: string): Promise<string> {
  const before = await canvasIds(page, screenId)
  await page.locator("[data-layer-add-kind]").selectOption("label")
  await page.locator("[data-layer-add]").click()
  await expect(page.locator(`[data-hmi-screen="${screenId}"] [data-hmi-widget]`)).toHaveCount(before.length + 1)
  const after = await canvasIds(page, screenId)
  const added = after.find((id) => !before.includes(id))
  expect(added, "the add menu produced no new widget id").toBeTruthy()
  return added as string
}

/**
 * 🔴 THE UNSAVED-WORK WARNING, MEASURED AT THE MECHANISM.
 *
 * Dispatches a real cancelable `beforeunload` at `window` and returns `event.defaultPrevented` —
 * which is exactly what the browser itself consults to decide whether to interrupt a reload, a back
 * button or a closed tab. A test that read a `data-editor-dirty` attribute instead would pass against
 * a page that showed the banner and registered no handler at all, and this session has already seen a
 * test suite silently destroy uncommitted work, so the flag is not what gets pinned here.
 *
 * Deliberately NOT driven through `page.reload()` and a `dialog` event: Chromium suppresses the
 * beforeunload prompt for navigations a driver initiates, so that route measures the driver's policy
 * rather than the page's handler — a green result there would mean nothing either way.
 */
function unloadWouldWarn(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
}

test.describe("HMI screen editor — publish, versions, rollback, breakpoint preview", () => {
  test("🔴 the breakpoint chooser offers exactly the frozen enum, and choosing one changes BOTH the document and the drawn width", async ({
    page,
    request,
  }) => {
    const screenId = "pub-breakpoint"
    await putScreen(request, probeDoc(screenId, [ALPHA]))
    await openEditor(page, screenId)

    // ── half 1: the vocabulary is the schema's, read from disk ─────────────────────────────────
    expect(SCHEMA_BREAKPOINTS.length, "extracted 0 breakpoints from the schema — the extraction broke").toBeGreaterThan(0)
    const offered = await page
      .locator("[data-editor-breakpoint-choice]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-editor-breakpoint-choice") ?? ""))
    expect(offered).toEqual(SCHEMA_BREAKPOINTS)

    // ── half 2: all three are REACHABLE, and each one draws at a width that DISTINGUISHES it ────
    //
    // 🔴 FIX ROUND 1, task-12-review.md M2 — THE VIEWPORT IS WIDENED FIRST, AND THAT IS THE FIX.
    // At the project's own 1280x720 the canvas column is ~656 px, so BOTH `panel` (1280) and `tablet`
    // (1024) exceed it and the `max-width` frame is inert for both: they measured identical, the
    // assertion was satisfied by equality, and the reviewer proved it measured nothing by setting
    // `tablet` to 2000 — wider than `panel`, a direct contradiction of the property — with the test
    // still green. A viewport wide enough for the canvas column to exceed the WIDEST breakpoint is
    // what makes all three separable at all; below that, no assertion here can tell them apart.
    //
    // `LAYOUT_CHROME_PX` is the rail width this route spends before the canvas gets any: 256 (layer
    // tree) + 320 (right rail) + 24 (two gaps) + 24 (page padding). Derived rather than hard-coded to
    // a viewport number so that moving a rail moves this too, and the assertion below reddens if the
    // margin is ever eaten rather than silently going inert again.
    const LAYOUT_CHROME_PX = 256 + 320 + 24 + 24
    const widest = Math.max(...SCHEMA_BREAKPOINTS.map(declaredWidth))
    await page.setViewportSize({ width: widest + LAYOUT_CHROME_PX + 120, height: 900 })

    const widths: Record<string, number> = {}
    let available = 0
    for (const value of SCHEMA_BREAKPOINTS) {
      await page.locator(`[data-editor-breakpoint-choice="${value}"]`).click()
      await expect(page.locator(`[data-editor-breakpoint="${value}"]`)).toBeVisible()
      await expect(page.locator(`[data-editor-breakpoint-choice="${value}"]`)).toHaveAttribute(
        "data-editor-breakpoint-selected",
        "true"
      )
      // The DOCUMENT changed, not only the frame: the renderer is still drawing this screen, and the
      // publish below carries the field. `data-editor-breakpoint` is on the frame that WRAPS the
      // canvas, so its value being `value` is the document's `layout.breakpoint` reaching the DOM.
      const box = await page.locator(`[data-hmi-screen="${screenId}"]`).boundingBox()
      expect(box, `no rendered screen at breakpoint ${value}`).toBeTruthy()
      widths[value] = Math.round((box as { width: number }).width)

      // The caption is asserted to agree with the table, so `data-editor-preview-width` is a hook a
      // test actually reads rather than a promise of coverage (task-12-review.md LOW-5).
      await expect(page.locator("[data-editor-preview-width]")).toHaveAttribute(
        "data-editor-preview-width",
        String(declaredWidth(value))
      )

      // How much room the frame HAD — measured on the frame's PARENT, not on the canvas inside it.
      // The canvas is already capped by the frame's `max-width`, so measuring it would report the
      // breakpoint width back and prove nothing; the parent is the column the frame is free to fill.
      // If the chrome ever grows past the margin above, the assertion below reddens with a sentence
      // rather than the ordering going quietly vacuous again.
      const room = await page
        .locator("[data-editor-breakpoint]")
        .evaluate((el) => Math.round((el.parentElement as HTMLElement).getBoundingClientRect().width))
      available = Math.max(available, room)
    }

    expect(
      available,
      `the canvas column is ${available}px, not wider than the widest breakpoint (${widest}px) — every ` +
        `frame is inert at this viewport and the ordering below would be satisfied by three equal ` +
        `numbers, which is exactly the defect this fix closes`
    ).toBeGreaterThan(widest)

    // 🔴 STRICTLY increasing, so every one of the three is distinguished from BOTH others. `phone` <
    // `tablet` < `panel` — no `<=` anywhere, because `<=` is what let two of them be the same number.
    // Asserted as an ORDER over the measurements rather than against the pixel constants, so the table
    // in `lib/hmiScreens.ts` stays free to move; what must not change is that a narrower NAME draws
    // narrower.
    expect(
      widths.phone,
      `phone (${widths.phone}px) is not strictly narrower than tablet (${widths.tablet}px)`
    ).toBeLessThan(widths.tablet)
    expect(
      widths.tablet,
      `tablet (${widths.tablet}px) is not strictly narrower than panel (${widths.panel}px)`
    ).toBeLessThan(widths.panel)

    // …and the choice survives a publish, which is the whole reason it is a document edit.
    await page.locator(`[data-editor-breakpoint-choice="phone"]`).click()
    await page.locator("[data-publish-button]").click()
    await expect(page.locator("[data-publish-version]")).toBeVisible()

    const stored = await request.get(`${ENGINE_URL}/v1/screens/${screenId}`)
    expect(stored.ok()).toBe(true)
    expect(((await stored.json()) as ProbeDocument).layout.breakpoint).toBe("phone")
  })

  test("Publish sends PUT and shows the NEW version number — on the panel, in the route header, and at the engine", async ({
    page,
    request,
  }) => {
    const screenId = "pub-version"
    const first = await putScreen(request, probeDoc(screenId, [ALPHA]))
    await openEditor(page, screenId)

    await expect(page.locator("[data-editor-current-version]")).toHaveAttribute(
      "data-editor-current-version",
      String(first)
    )

    const added = await addLabelWidget(page, screenId)

    // The request itself, captured — so "publish sends a PUT" is a measurement, not an inference from
    // the version number changing (a client that POSTed somewhere else and guessed would satisfy that).
    const [put] = await Promise.all([
      page.waitForRequest(
        (req) => req.method() === "PUT" && req.url().endsWith(`/v1/screens/${screenId}`)
      ),
      page.locator("[data-publish-button]").click(),
    ])
    expect((put.postDataJSON() as ProbeDocument).widgets.map((w) => w.id)).toContain(added)

    // 🔴 The store APPENDS: the number is a new one, never the one it opened at.
    await expect(page.locator("[data-publish-version]")).toHaveAttribute("data-publish-version", String(first + 1))
    await expect(page.locator("[data-publish-version]")).toContainText(
      viDict.editor.publish.published({ version: first + 1 })
    )

    // Witness 2 — the route header, which reads `GET .../versions`, a different request the publish
    // invalidated.
    await expect(page.locator("[data-editor-current-version]")).toHaveAttribute(
      "data-editor-current-version",
      String(first + 1)
    )

    // Witness 3 — the engine, asked directly.
    expect(await headVersion(request, screenId)).toBe(first + 1)
    const rows = await versionsOf(request, screenId)
    expect(rows.map((r) => r.version)).toEqual([first, first + 1])
  })

  test("🔴 a REFUSED publish shows EVERY violation the engine named, and the engine's current version does not move", async ({
    page,
    request,
  }) => {
    const screenId = "pub-refused"
    const before = await putScreen(request, probeDoc(screenId, [ALPHA]))
    await openEditor(page, screenId)

    // See this file's header for why the outgoing BODY is rewritten and what is NOT faked: the
    // response below is the engine's own 400, produced by the real `ContractInvariants`.
    //
    // TWO violations at once, deliberately, because the claim is "every violation, not the first":
    // an ungated `command-button` (§5) and a widget id the frozen pattern refuses (Task 12's own
    // server-side fix). One would not distinguish "shows all of them" from "shows the first".
    await page.route(`**/v1/screens/${screenId}`, async (route) => {
      if (route.request().method() !== "PUT") return route.fallback()
      const body = route.request().postDataJSON() as ProbeDocument
      body.widgets = [
        { id: "Bad-Id", kind: "label", rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: "ungated", kind: "command-button", rect: { col: 2, row: 0, colSpan: 1, rowSpan: 1 } },
      ]
      await route.continue({ postData: JSON.stringify(body) })
    })

    await page.locator("[data-publish-button]").click()

    const refusal = page.locator('[data-publish-error="publish"]')
    await expect(refusal).toBeVisible()
    await expect(refusal).toHaveAttribute("data-publish-status", "400")
    // Every violation, each on its own line, and the ENGINE's own words — not a sentence this client
    // wrote about them.
    await expect(refusal.locator("li")).toHaveCount(2)
    // …and the count the panel itself publishes agrees, so `data-publish-violations` is a hook a test
    // reads rather than a promise of coverage (task-12-review.md LOW-5).
    await expect(refusal.locator("[data-publish-violations]")).toHaveAttribute("data-publish-violations", "2")
    await expect(refusal).toContainText("Bad-Id")
    await expect(refusal).toContainText("policyAction")
    // …and the named reason for THIS status, so the reader is told what kind of no it is.
    await expect(refusal).toContainText(viDict.editor.publish.reason400)

    // No version number is claimed for a write that did not happen.
    await expect(page.locator("[data-publish-version]")).toHaveCount(0)

    // 🔴 The engine did not move — P2, measured from outside the browser.
    expect(await headVersion(request, screenId)).toBe(before)
    expect((await versionsOf(request, screenId)).map((r) => r.version)).toEqual([before])
    await expect(page.locator("[data-editor-current-version]")).toHaveAttribute(
      "data-editor-current-version",
      String(before)
    )
  })

  test("the version list comes from GET .../versions, and previewing an old one does NOT publish and does NOT discard unsaved work", async ({
    page,
    request,
  }) => {
    const screenId = "pub-preview"
    const v1 = await putScreen(request, probeDoc(screenId, [ALPHA]))
    const v2 = await putScreen(request, probeDoc(screenId, [ALPHA, BRAVO]))
    expect(v2).toBe(v1 + 1)

    await openEditor(page, screenId)
    // The list is the engine's, row for row.
    const engineRows = await versionsOf(request, screenId)
    const shown = await page
      .locator("[data-publish-history] [data-publish-version-row]")
      .evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-publish-version-row"))))
    expect(shown.slice().sort((a, b) => a - b)).toEqual(engineRows.map((r) => r.version).sort((a, b) => a - b))
    await expect(page.locator(`[data-publish-version-row="${v2}"]`)).toHaveAttribute(
      "data-publish-version-current",
      "true"
    )

    // An UNSAVED edit that exists only in this session — the thing a preview must not destroy.
    const added = await addLabelWidget(page, screenId)
    await expect(page.locator("[data-editor-dirty]")).toHaveAttribute("data-editor-dirty", "true")

    await page.locator(`[data-publish-preview="${v1}"]`).click()
    await expect(page.locator(`[data-editor-preview="${v1}"]`)).toBeVisible()

    // What is DRAWN is version 1: alpha only. Not bravo (added at v2), not the unsaved widget.
    await expect(page.locator(`[data-hmi-screen="${screenId}"] [data-hmi-widget]`)).toHaveCount(1)
    expect(await canvasIds(page, screenId)).toEqual([ALPHA.id])
    // The editing overlay is gone — a preview is read-only by not existing, not by a disabled flag.
    await expect(page.locator("[data-editor-overlay]")).toHaveCount(0)

    // Nothing was published, and the engine's head did not move.
    await expect(page.locator("[data-publish-version]")).toHaveCount(0)
    expect(await headVersion(request, screenId)).toBe(v2)

    // 🔴 Closing the preview brings the session back INTACT — including the unsaved widget.
    await page.locator(`[data-publish-preview="${v1}"]`).click()
    await expect(page.locator(`[data-editor-preview="${v1}"]`)).toHaveCount(0)
    await expect(page.locator("[data-editor-overlay]")).toHaveCount(1)
    expect(await canvasIds(page, screenId)).toEqual([ALPHA.id, BRAVO.id, added])
    await expect(page.locator("[data-editor-dirty]")).toHaveAttribute("data-editor-dirty", "true")
  })

  test("🔴 Rollback APPENDS a new version and the history loses no entry", async ({ page, request }) => {
    const screenId = "pub-rollback"
    const v1 = await putScreen(request, probeDoc(screenId, [ALPHA]))
    const v2 = await putScreen(request, probeDoc(screenId, [ALPHA, BRAVO]))
    const v3 = await putScreen(request, probeDoc(screenId, [BRAVO]))
    expect([v2, v3]).toEqual([v1 + 1, v1 + 2])

    await openEditor(page, screenId)
    await page.locator(`[data-publish-rollback="${v1}"]`).click()

    // The number reported is the NEW version, never the one asked for.
    await expect(page.locator("[data-rollback-version]")).toHaveAttribute("data-rollback-version", String(v3 + 1))
    await expect(page.locator("[data-rollback-version]")).not.toHaveAttribute(
      "data-rollback-version",
      String(v1)
    )

    // 🔴 HISTORY LOSES NOTHING — every earlier version is still there, plus the appended one.
    const rows = await versionsOf(request, screenId)
    expect(rows.map((r) => r.version).sort((a, b) => a - b)).toEqual([v1, v2, v3, v3 + 1])
    expect(rows.find((r) => r.isCurrent)?.version).toBe(v3 + 1)

    // …and the appended version really carries the restored CONTENT, not just a number.
    const restored = await request.get(`${ENGINE_URL}/v1/screens/${screenId}?version=${v3 + 1}`)
    const original = await request.get(`${ENGINE_URL}/v1/screens/${screenId}?version=${v1}`)
    expect((await restored.json()) as ProbeDocument).toEqual((await original.json()) as ProbeDocument)

    // The route header follows, from its own independent read.
    await expect(page.locator("[data-editor-current-version]")).toHaveAttribute(
      "data-editor-current-version",
      String(v3 + 1)
    )
    // Every row is on screen, including the two the rollback stepped over.
    for (const version of [v1, v2, v3, v3 + 1]) {
      await expect(page.locator(`[data-publish-version-row="${version}"]`)).toBeVisible()
    }
  })

  test("🔴 a rollback INVALIDATES the head document — what GET .../{id} now serves has changed, and every surface reading it re-reads", async ({
    page,
    request,
  }) => {
    /**
     * PERIMETER SWEEP ROW W25, closed. `scripts/delete-and-redden-web.sh`'s W25 drops
     * `QUERY_KEYS.screen(screenId)` from `useRollbackScreen.onSuccess` while KEEPING the history key,
     * and before this test that mutation reddened nothing in this file's thirteen tests.
     *
     * The property is `useRollbackScreen`'s own doc comment in `lib/api.ts`: a rollback APPENDS a
     * version, so BOTH the head document and the history changed. Its complement is already pinned —
     * sweep row W24 drops the HISTORY key from `usePublishScreen` and reddens `42:352`. So the pair
     * was half-held, and this is the other half.
     *
     * 🔴 WHY NO EXISTING TEST COULD SEE IT, WHICH IS ALSO WHY THIS ONE IS SHAPED AS A NETWORK
     * ASSERTION RATHER THAN A UI ONE. The perimeter report (§5.7) traced it: after a rollback the
     * editor reads the VERSION LIST (`data-publish-version-row`, `data-editor-current-version`), and
     * both of those are fed by `useScreenVersions` — the key W25 leaves alone. The canvas deliberately
     * does NOT reload from the refetched document: `EditorCanvasProps.doc`'s own rule that "the
     * engineer's session is the authority on what they are editing". So there is no pixel anywhere in
     * this product that moves when the head-document invalidation is deleted, and a test written
     * against a rendered surface would either measure nothing or would have to assert a behaviour the
     * branch has deliberately refused.
     *
     * What DOES change is observable and is exactly the claim: the query is invalidated, so the
     * `useScreen(screenId)` that `EditorRoute` mounts (`src/editor/EditorRoute.tsx`) re-reads the head
     * document. One `GET /v1/screens/{id}` after the rollback, or none. That is the mechanism the doc
     * comment describes, measured where it happens rather than three surfaces downstream.
     *
     * 🔴 THE HEAD DOCUMENT ONLY — `?version=` REQUESTS ARE NOT COUNTED. `PublishPanel`'s version
     * preview fetches `GET /v1/screens/{id}?version=N` through `useScreenAtVersion`, a DIFFERENT key
     * (`QUERY_KEYS.screenAtVersion`) that a rollback deliberately does not touch, because every
     * previously-fetched old version is still exactly what it was. Counting those would make this test
     * pass on a build with no head invalidation at all, purely because the panel happened to preview
     * something — the precise shape of a green that measures the wrong request.
     */
    const screenId = "pub-rollback-invalidates-head"
    const v1 = await putScreen(request, probeDoc(screenId, [ALPHA]))
    const v2 = await putScreen(request, probeDoc(screenId, [ALPHA, BRAVO]))
    expect(v2).toBe(v1 + 1)

    await openEditor(page, screenId)

    // Counted from AFTER the editor has settled, so the mount's own read of the head document is not
    // mistaken for the invalidation's refetch. Everything below is caused by the rollback or by nothing.
    const headReads: string[] = []
    page.on("request", (req) => {
      const url = new URL(req.url())
      if (req.method() !== "GET") return
      // The HEAD document: the bare document path, no `?version=`. See the note above on why the
      // version-preview requests are excluded rather than merely unmentioned.
      if (url.pathname === `/v1/screens/${screenId}` && !url.searchParams.has("version")) {
        headReads.push(url.pathname + url.search)
      }
    })

    await page.locator(`[data-publish-rollback="${v1}"]`).click()

    // The rollback landed — asserted through the surface that DOES move, so a failure to roll back at
    // all is reported as itself rather than as a missing refetch.
    await expect(page.locator("[data-rollback-version]")).toHaveAttribute(
      "data-rollback-version",
      String(v2 + 1)
    )

    /**
     * 🔴 A POLL-FREE WAIT, AND THAT IS WHAT MAKES THE COUNT MEAN SOMETHING. `useScreen` sets no
     * `staleTime` and no `refetchInterval`, and `refetchOnWindowFocus` is `false` app-wide
     * (`App.tsx`), so this hook NEVER refetches on its own. A `GET` of the head document arriving in
     * this window therefore has exactly one possible cause: something invalidated its key. Sized the
     * same way, and for the same reason, as this suite's other "nothing happened" waits.
     */
    await expect
      .poll(() => headReads.length, {
        message:
          `the rollback did not re-read GET /v1/screens/${screenId}. A rollback APPENDS a version, so ` +
          `what that endpoint now serves has CHANGED — every surface reading the current document is ` +
          `holding a stale one until something else happens to invalidate it. useScreen never refetches ` +
          `on its own (no staleTime, no poll, refetchOnWindowFocus false), so nothing else will. See ` +
          `useRollbackScreen.onSuccess in src/lib/api.ts.`,
        timeout: 5000,
      })
      .toBeGreaterThanOrEqual(1)

    // …and it really is the head that was re-read, carrying no version selector.
    expect(headReads.every((u) => !u.includes("version="))).toBe(true)

    page.removeAllListeners("request")
  })

  test("a rollback the engine refuses is named at the control, with its status", async ({ page, request }) => {
    const screenId = "pub-rollback-404"
    // TWO versions, because the Restore button on the CURRENT row is deliberately disabled (restoring
    // to the head would append an identical copy). v1 is the row an engineer can actually press.
    const v1 = await putScreen(request, probeDoc(screenId, [ALPHA]))
    const v2 = await putScreen(request, probeDoc(screenId, [ALPHA, BRAVO]))
    await openEditor(page, screenId)
    await expect(page.locator(`[data-publish-rollback="${v2}"]`)).toBeDisabled()

    // A version that does not exist. Reached by rewriting the outgoing body only — see this file's
    // header; the 404 and its sentence are the engine's.
    await page.route(`**/v1/screens/${screenId}/rollback`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      await route.continue({ postData: JSON.stringify({ toVersion: 9999 }) })
    })
    await page.locator(`[data-publish-rollback="${v1}"]`).click()

    const refusal = page.locator('[data-publish-error="rollback"]')
    await expect(refusal).toBeVisible()
    await expect(refusal).toHaveAttribute("data-publish-status", "404")
    await expect(refusal).toContainText(viDict.editor.publish.reason404)

    // Refused, so nothing was appended.
    expect((await versionsOf(request, screenId)).map((r) => r.version)).toEqual([v1, v2])
  })

  test("🔴 unsaved work WARNS on leaving, stops warning once published, and stops warning if undone", async ({
    page,
    request,
  }) => {
    const screenId = "pub-unsaved"
    await putScreen(request, probeDoc(screenId, [ALPHA]))
    await openEditor(page, screenId)

    // ── the negative control FIRST. Without it, a handler that always prevents unload passes every
    // positive assertion below, and the warning becomes noise people learn to click through.
    await expect(page.locator("[data-editor-dirty]")).toHaveAttribute("data-editor-dirty", "false")
    await expect(page.locator("[data-editor-dirty]")).toContainText(viDict.editor.publish.saved)
    expect(await unloadWouldWarn(page), "a clean session already blocks unload").toBe(false)

    // ── an unsaved edit ⇒ the page warns, and says so where the engineer is looking.
    await addLabelWidget(page, screenId)
    await expect(page.locator("[data-editor-dirty]")).toHaveAttribute("data-editor-dirty", "true")
    await expect(page.locator("[data-editor-dirty]")).toContainText(viDict.editor.publish.unsaved)
    expect(await unloadWouldWarn(page), "unsaved work does NOT block unload — this is the data-loss case").toBe(
      true
    )

    // ── UNDO back to where the session started ⇒ there is nothing to lose, so nothing to warn about.
    // A dirty flag driven by "how many edits have happened" would still be warning here, and a warning
    // about work that no longer exists is how a real warning gets ignored later.
    await page.locator("[data-editor-design-mode]").click()
    await page.keyboard.press("Control+z")
    await expect(page.locator("[data-editor-dirty]")).toHaveAttribute("data-editor-dirty", "false")
    expect(await unloadWouldWarn(page), "an undone session still blocks unload").toBe(false)

    // ── edit again, then PUBLISH ⇒ the work is safe, so the warning must go.
    await addLabelWidget(page, screenId)
    expect(await unloadWouldWarn(page)).toBe(true)
    await page.locator("[data-publish-button]").click()
    await expect(page.locator("[data-publish-version]")).toBeVisible()
    await expect(page.locator("[data-editor-dirty]")).toHaveAttribute("data-editor-dirty", "false")
    expect(await unloadWouldWarn(page), "a published session still blocks unload").toBe(false)

    // The publish really did carry the edit — otherwise "clean" would be a lie told by the baseline.
    const stored = (await (await request.get(`${ENGINE_URL}/v1/screens/${screenId}`)).json()) as ProbeDocument
    expect(stored.widgets.length).toBe(2)
  })

  test("🔴 while a past version is previewed, NO editing surface can act on the session", async ({
    page,
    request,
  }) => {
    // task-12-review.md M1. Round 0 removed the canvas overlay during a preview and called that
    // "read-only by not existing"; the layer tree, the property panel, `Ctrl+Z` and Publish all stayed
    // live over a document the engineer could not see. Delete a layer row while previewing version 1,
    // see nothing change because the canvas is showing version 1, close the preview, publish — the
    // deletion lands. This test operates all four and asserts the session came back untouched.
    const screenId = "pub-readonly"
    const v1 = await putScreen(request, probeDoc(screenId, [ALPHA]))
    const v2 = await putScreen(request, probeDoc(screenId, [ALPHA, BRAVO]))
    await openEditor(page, screenId)

    // An UNSAVED edit, and a selection, so both rails have something real to act on.
    const added = await addLabelWidget(page, screenId)
    await page.locator(`[data-editor-widget="${added}"]`).click()
    await expect(page.locator("[data-panel-widget-id]")).toHaveText(added)
    const before = await canvasIds(page, screenId)
    expect(before).toEqual([ALPHA.id, BRAVO.id, added])

    await page.locator(`[data-publish-preview="${v1}"]`).click()
    await expect(page.locator(`[data-editor-preview="${v1}"]`)).toBeVisible()

    // ── (1) and (2): the two editing rails are GONE, replaced by one named read-only notice. Not
    //     disabled copies of themselves — a tree row addressing a widget by id over a document that is
    //     not on screen is a label describing something that is not there.
    await expect(page.locator("[data-layer-tree]")).toHaveCount(0)
    await expect(page.locator("[data-property-panel]")).toHaveCount(0)
    await expect(page.locator("[data-editor-readonly]")).toHaveAttribute("data-editor-readonly", String(v1))
    await expect(page.locator("[data-editor-readonly]")).toContainText(
      viDict.editor.publish.readOnly({ version: v1 })
    )
    // Every control those rails carry is unreachable, by count rather than by disabled-ness.
    await expect(page.locator("[data-layer-remove]")).toHaveCount(0)
    await expect(page.locator("[data-layer-add]")).toHaveCount(0)
    await expect(page.locator("[data-layer-rename]")).toHaveCount(0)

    // ── (3): Publish is disabled, and force-clicking it — which dispatches the click regardless of
    //     Playwright's actionability checks — still publishes nothing.
    const publishButton = page.locator("[data-publish-button]")
    await expect(publishButton).toBeDisabled()
    await publishButton.click({ force: true })
    await expect(page.locator("[data-publish-version]")).toHaveCount(0)

    // ── (4): `Ctrl+Z` really is pressed, on a session that HAS an undo step to take.
    await page.locator("[data-editor-design-mode]").click()
    await page.keyboard.press("Control+z")

    // ── (5): the BREAKPOINT CHOOSER — a fifth editing surface the review did not list and the
    //     mutation round found. Choosing a breakpoint emits `set-breakpoint`, a real document edit, so
    //     it is locked too. Disabled rather than unmounted (its three labels stay true of the previewed
    //     document), and force-clicked here so the assertion is about what the control DOES, not about
    //     an attribute.
    const otherBreakpoint = SCHEMA_BREAKPOINTS.find((b) => b !== "panel") as string
    await expect(page.locator(`[data-editor-breakpoint-choice="${otherBreakpoint}"]`)).toBeDisabled()
    await page.locator(`[data-editor-breakpoint-choice="${otherBreakpoint}"]`).click({ force: true })
    await expect(page.locator("[data-editor-breakpoint]")).toHaveAttribute("data-editor-breakpoint", "panel")

    // Nothing reached the engine, and nothing reached the session.
    expect(await headVersion(request, screenId)).toBe(v2)

    await page.locator(`[data-publish-preview="${v1}"]`).click()
    await expect(page.locator(`[data-editor-preview="${v1}"]`)).toHaveCount(0)
    await expect(page.locator("[data-layer-tree]")).toHaveCount(1)
    await expect(page.locator("[data-property-panel]")).toHaveCount(1)
    expect(
      await canvasIds(page, screenId),
      "an edit landed on the session while a past version was on screen"
    ).toEqual(before)
    await expect(page.locator("[data-editor-dirty]")).toHaveAttribute("data-editor-dirty", "true")
  })

  test("a version that cannot be read is NAMED on the canvas, not left blank", async ({ page, request }) => {
    // task-12-review.md LOW-5 — the preview-failure surface was an untested user-visible state.
    // Reached by rewriting the outgoing GET's URL to a version that does not exist (interception 3 in
    // this file's header): `route.continue({ url })` changes only where the request points; the 404
    // and its meaning are the engine's.
    const screenId = "pub-preview-404"
    const v1 = await putScreen(request, probeDoc(screenId, [ALPHA]))
    await putScreen(request, probeDoc(screenId, [ALPHA, BRAVO]))
    await openEditor(page, screenId)

    await page.route(`**/v1/screens/${screenId}?version=*`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      await route.continue({ url: `${ENGINE_URL}/v1/screens/${screenId}?version=9999` })
    })

    await page.locator(`[data-publish-preview="${v1}"]`).click()

    const failed = page.locator("[data-editor-preview-failed]")
    await expect(failed).toBeVisible()
    await expect(failed).toContainText(viDict.editor.publish.previewFailed({ version: v1 }))
    // A failed preview is still a preview: the session stays out of reach rather than quietly
    // becoming editable again behind an error message.
    await expect(page.locator("[data-layer-tree]")).toHaveCount(0)
    await expect(page.locator("[data-publish-button]")).toBeDisabled()
  })

  test("🔴 this file's own declaration of what it intercepts is CHECKED, not remembered", async () => {
    // task-12-review.md M3. The header block previously said "THE ONE PLACE THIS FILE FAKES ANYTHING"
    // and was wrong three ways: it counted one interception where there were two, described a mutation
    // the code does not perform, and listed the 404 rollback refusal among the things NOT faked while
    // rewriting its body. A declaration of honesty that is itself inaccurate is worse than none — so
    // the numbers in that header are asserted here, from this file's own parsed source, and the day a
    // fourth interception is added without the header changing, this reddens.
    const self = readNormalized(fileURLToPath(import.meta.url))
    const sf = ts.createSourceFile("self", self, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

    // Counted through the parser, so the header's own PROSE about `route.fulfill` (it says there is
    // none) cannot be mistaken for a call to it — the exact confusion a text scan would produce here.
    const calls: Record<string, number> = {}
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text
        const target = node.expression.expression.getText(sf)
        if ((target === "page" && name === "route") || (target === "route" && name !== "request")) {
          calls[`${target}.${name}`] = (calls[`${target}.${name}`] ?? 0) + 1
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)

    expect(
      calls,
      "the header enumerates THREE interceptions, all of which rewrite only the outgoing request — " +
        "if this no longer matches, fix the header first and the count second"
    ).toEqual({ "page.route": 3, "route.continue": 3, "route.fallback": 3 })

    // Stated separately and absolutely: nothing in this file fabricates a response or drops a request.
    expect(calls["route.fulfill"] ?? 0, "a response is being synthesised — the header says none is").toBe(0)
    expect(calls["route.abort"] ?? 0, "a request is being dropped — the header says none is").toBe(0)

    // And each of the three is named in the header, so the list is a list and not a number.
    for (const phrase of [
      "route.continue({ postData })` on the PUT",
      "route.continue({ postData })` on the rollback POST",
      "route.continue({ url })` on the versioned GET",
    ]) {
      expect(self, `the header no longer describes: ${phrase}`).toContain(phrase)
    }
  })

  test("🔴 nothing in the app navigates to /editor — the premise the unsaved-work guard rests on", async () => {
    // task-12-review.md LOW-7, controller ruling. `beforeunload` fires for CROSS-document exits only.
    // `/editor/:screenId` is a wouter route in a pushState SPA, so an in-app link — and the back button
    // after following one — is a SAME-document history change that `beforeunload` never sees. Today
    // that is harmless because nothing links to or from the route, which makes every exit
    // cross-document. That is a fact about the app, and an unpinned fact is worth nothing: this test is
    // the pin, and the day it reddens the fix is a router-level guard, not deleting the test.
    const SRC = join(WEB, "src")
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
      }
    }
    walk(SRC)
    expect(files.length, "walked src/ and found no modules — the census broke, not the app").toBeGreaterThan(50)

    // String literals only, collected through TypeScript's own parser: a `/editor` written in a comment
    // (this file's subject is discussed in several) is excluded by the parser rather than by a regex,
    // the technique `check-comment-only.mjs` records as the only safe one here.
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node) => {
        if (
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          /^\/editor(\/|$)/.test(node.text)
        ) {
          offenders.push(`${relative(WEB, file).replace(/\\/g, "/")}: ${JSON.stringify(node.text)}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }

    // `App.tsx` is the ONE allowed holder: it declares the route. Declaring a route is not navigating
    // to it, and removing this exemption would make the pin unsatisfiable rather than strict.
    const fromElsewhere = offenders.filter((o) => !o.startsWith("src/App.tsx:"))
    expect(
      fromElsewhere,
      "something in web/src now addresses /editor. `beforeunload` does NOT fire for a same-document " +
        "SPA navigation, so the unsaved-work warning no longer covers every way out of the editor — " +
        "add a router-level guard (EditorCanvas.tsx's beforeunload effect names this test)"
    ).toEqual([])
    // Floor: the exemption must still be live, or this test is comparing two empty lists.
    expect(offenders.length, "no /editor literal anywhere, not even App.tsx's route — the scan broke").toBeGreaterThan(0)
  })

  test("🔴 an overtake is named even when this session has NEVER published — the commonest case", async ({
    page,
    request,
  }) => {
    // task-12-review.md M4. Round 0 tracked the version a session stood on ONLY from its own publishes,
    // so it was `undefined` until the session had already published once — and the commonest overtake
    // of all (open at v3, a colleague publishes v4, you publish and land at v5) was silent. The reason
    // given was that `GET /v1/screens/{id}` answers no version number, which is true of that endpoint
    // and beside the point: `GET .../versions` is read by this very panel and its head is rendered in
    // the route header. The panel now adopts that head once, at mount.
    const screenId = "pub-overtaken-first"
    const opened = await putScreen(request, probeDoc(screenId, [ALPHA]))
    await openEditor(page, screenId)
    // The header proves the number the notice needs was on screen all along.
    await expect(page.locator("[data-editor-current-version]")).toHaveAttribute(
      "data-editor-current-version",
      String(opened)
    )

    // A colleague publishes while this session sits open, having published nothing itself.
    const theirs = await putScreen(request, probeDoc(screenId, [BRAVO]))
    expect(theirs).toBe(opened + 1)

    // This session's FIRST publish. It lands two past the version it opened at.
    await addLabelWidget(page, screenId)
    await page.locator("[data-publish-button]").click()
    const landed = theirs + 1
    await expect(page.locator("[data-publish-version]")).toHaveAttribute("data-publish-version", String(landed))

    const notice = page.locator("[data-publish-overtaken]")
    await expect(notice).toBeVisible()
    await expect(notice).toHaveAttribute("data-publish-overtaken", String(landed))
    await expect(notice).toContainText(
      viDict.editor.publish.overtaken({ landedAs: landed, openedFrom: opened })
    )

    // Nothing was lost — the store appends, and the colleague's version is still on file.
    const rows = await versionsOf(request, screenId)
    expect(rows.map((r) => r.version).sort((a, b) => a - b)).toEqual([opened, theirs, landed])
  })

  test("a publish OVERTAKEN by someone else's is named — and the negative control says nothing when it was not", async ({
    page,
    request,
  }) => {
    const screenId = "pub-overtaken"
    await putScreen(request, probeDoc(screenId, [ALPHA]))
    await openEditor(page, screenId)

    // ── the NEGATIVE CONTROL first: an ordinary publish, nothing in between, says nothing. Without
    // this, a notice that always renders satisfies every positive assertion below and the sentence
    // becomes noise.
    await addLabelWidget(page, screenId)
    await page.locator("[data-publish-button]").click()
    await expect(page.locator("[data-publish-version]")).toBeVisible()
    const first = Number(await page.locator("[data-publish-version]").getAttribute("data-publish-version"))
    await expect(page.locator("[data-publish-overtaken]")).toHaveCount(0)

    // 🔴 …and AGAIN, with nothing in between. This second publish is the control that has teeth: the
    // first one cannot say anything either way, because a session that has never published has no
    // version to have been overtaken FROM. Only here does the comparison actually run — measured, by
    // mutation: deleting the `version > baseline + 1` half leaves the first control green and reddens
    // only this one.
    await addLabelWidget(page, screenId)
    await page.locator("[data-publish-button]").click()
    await expect(page.locator("[data-publish-version]")).toHaveAttribute(
      "data-publish-version",
      String(first + 1)
    )
    await expect(page.locator("[data-publish-overtaken]")).toHaveCount(0)
    const mine = first + 1

    // ── someone else publishes, twice, while this session sits open.
    const theirs = await putScreen(request, probeDoc(screenId, [BRAVO]))
    const theirsAgain = await putScreen(request, probeDoc(screenId, [ALPHA, BRAVO]))
    expect([theirs, theirsAgain]).toEqual([mine + 1, mine + 2])

    // ── this session publishes again. The engine's own numbering is what reveals it: standing on
    // `mine`, expecting `mine + 1`, it lands on `mine + 3`.
    await addLabelWidget(page, screenId)
    await page.locator("[data-publish-button]").click()
    const landed = theirsAgain + 1
    await expect(page.locator("[data-publish-version]")).toHaveAttribute("data-publish-version", String(landed))

    const notice = page.locator("[data-publish-overtaken]")
    await expect(notice).toBeVisible()
    await expect(notice).toHaveAttribute("data-publish-overtaken", String(landed))
    // Both numbers, so the reader can see the gap rather than being told there is one.
    await expect(notice).toContainText(String(landed))
    await expect(notice).toContainText(String(mine))

    // 🔴 It is a NOTICE, not a block, and nothing was lost: the store appends, every intervening
    // version is still on file, and this session's own write is the head.
    await expect(page.locator("[data-publish-button]")).toBeEnabled()
    const rows = await versionsOf(request, screenId)
    expect(rows.map((r) => r.version).sort((a, b) => a - b)).toEqual([
      1,
      first,
      mine,
      theirs,
      theirsAgain,
      landed,
    ])
    expect(rows.find((r) => r.isCurrent)?.version).toBe(landed)
  })
})
