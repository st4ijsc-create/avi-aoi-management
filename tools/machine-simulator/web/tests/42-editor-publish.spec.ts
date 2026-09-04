import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

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
 * ── 🔴 THE ONE PLACE THIS FILE FAKES ANYTHING, DECLARED UP FRONT ─────────────────────────────────
 * One test — "a refused publish shows EVERY violation" — uses `page.route` to rewrite the **outgoing
 * PUT body**, deleting a `command-button`'s `policyAction` before it leaves the browser. The
 * **response is the engine's own, unmodified**: a real `ContractInvariants` rejection, a real 400, a
 * real `ApiErrorDto.error` carrying every violation joined.
 *
 * Why it has to be done that way, stated rather than glossed: **the editor's own vocabulary cannot
 * build a document this door refuses.** `applyEdit` mirrors `$defs/widget`, gates §5 on both the add
 * path and the kind picker, and enforces the frozen id pattern on rename — so there is no sequence of
 * clicks that produces a §5-violating document, and (since Task 12's server-side fix) none that
 * produces a document with an unknown `kind` or a malformed widget id either. That is a good property
 * and `editorState.test.mjs` is where it is measured. It also means the ONLY honest way to see this
 * refusal surface work is to send what a client WITHOUT those guards would send — which is precisely
 * the population the server door exists for. The interception stands in for that client and for
 * nothing else.
 *
 * Everything else in this file — every publish, every rollback, every version read, the 404 rollback
 * refusal — goes to the real engine with a real body and a real answer.
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

    // ── half 2: all three are REACHABLE, and each one narrows the canvas the renderer draws in ──
    // The frame's own width is measured, not the caption: a caption that said "390px" beside a
    // full-width canvas is exactly the shape of a preview that previews nothing.
    const widths: Record<string, number> = {}
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
    }

    // Narrower names really are narrower on screen. Asserted as an ORDER over the three measurements
    // rather than against the pixel constants, so the table in `lib/hmiScreens.ts` stays free to move
    // — what must not change is that `phone` is not as wide as `panel`.
    expect(widths.phone, `phone (${widths.phone}px) is not narrower than tablet (${widths.tablet}px)`).toBeLessThan(
      widths.tablet
    )
    expect(widths.tablet).toBeLessThanOrEqual(widths.panel)

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
