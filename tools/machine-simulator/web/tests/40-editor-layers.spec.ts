import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import ts from "typescript"

import { ENGINE_URL } from "./support/engine"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-HMI-2 Task 11 — the LAYER TREE: listing, adding, deleting, draw order, and — by controller
 * ruling (task-10-review.md F4) — RENAMING.
 *
 * ── WHAT THIS FILE IS THE ONLY PLACE TO MEASURE ──────────────────────────────────────────────────
 * `runtime-tests/editorState.test.mjs` executes the edit vocabulary directly and proves, against the
 * real `contract-tests/validate.mjs`, that `applyEdit` accepts exactly the `rename` edits whose
 * resulting DOCUMENT the frozen schema accepts, that a duplicate id is refused while the schema
 * itself permits one, and that a renamed widget keeps its ARRAY POSITION. None of that says a tree
 * exists, that its add menu is the registry, that deleting a row takes the widget off the canvas, or
 * that moving a row changes what an operator sees on top. Those are claims about DOM, and a `.tsx`
 * file cannot be `import()`ed under `node --test` (measured repeatedly on this tree — see
 * `widgetRegistry.test.mjs`'s header), so they live here and only here.
 *
 * ── 🔴 "THE ADD MENU IS THE REGISTRY", AND WHY ONE COMPARISON IS NOT ENOUGH ──────────────────────
 * The claim is that the kinds offered come FROM `hmi-runtime/widgetRegistry.ts`, not from a list
 * typed out beside the JSX. A hand-written list that is correct today renders exactly the same
 * options, so a test that only compared the rendered set against the registry's key set would pass
 * against the very thing the claim forbids. It is therefore measured in TWO halves:
 *
 *   1. the rendered option set equals the key set extracted from the registry FILE — read from disk,
 *      never imported from the module the component reads, with Task 6's floor (`task-6-review.md`
 *      LOW-3): two INDEPENDENT extractions (the quoted keys, and the `./widgets/<name>` import lines)
 *      compared as SETS rather than counts, because a compensating pair of mutations keeps two counts
 *      equal while the sets diverge — and both asserted non-empty first, because two empty sets are
 *      "equal" and that is this repository's signature vacuous pass;
 *   2. `src/editor/LayerTree.tsx`'s own source, comments stripped, contains NO widget-kind string
 *      literal — so replacing the derivation with a correct hand-written array reddens by NAME.
 *
 * The honest limit of half 2, stated before anyone infers otherwise: a hand-written list moved into
 * another module and imported would satisfy it. Half 1 catches such a list the day it drifts. Neither
 * half alone is the instrument; the pair is.
 *
 * ── 🔴 DRAW ORDER IS MEASURED ON THE CANVAS, NOT IN THE TREE ─────────────────────────────────────
 * "Reordering the tree changes the drawing order" is satisfied by an implementation that reorders its
 * OWN list and never touches the document — and a test that read the tree back would agree with it.
 * So the reorder test measures THREE things that all come from the canvas or the browser: the
 * renderer's own cell order, the browser's HIT TEST at the point where two widgets overlap
 * (`document.elementsFromPoint`, i.e. which one an operator's click would land on), and only then the
 * tree's row order. The document's two overlapping widgets are asserted to actually occupy the same
 * rendered rect first, so "which is on top" is a question with an answer.
 *
 * ── WHAT THIS FILE DOES NOT MEASURE ──────────────────────────────────────────────────────────────
 * Nothing about pixels: `/editor` still has no visual baseline, for the reason `37-editor-canvas`
 * gives. Nothing about SAVING — `PUT` from the editor is Task 12's, and every edit below lives in the
 * session's memory. And nothing about `applyEdit`'s guards themselves; this file measures that the
 * tree REACHES them and shows what they answer.
 */

const SCREEN_ID = "editor-layers-probe"
const ROUTE = `/editor/${SCREEN_ID}`

// Sentinels — ASCII, unmistakable, and distinct in every position that matters.
const ALPHA_TEXT = "ALPHA-LAYER-TEXT"
const BRAVO_TEXT = "BRAVO-LAYER-TEXT"
const CHARLIE_TEXT = "CHARLIE-LAYER-TEXT"

/** `web/tests` → `web`. */
const WEB = dirname(dirname(fileURLToPath(import.meta.url)))

/** CRLF: `core.autocrlf=true` on this repository, so a fresh checkout carries `\r\n` while every
 * pattern below is written with `\n`. Normalised once, the same way every source-reading pin in this
 * tree does it. */
const readNormalized = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n")

const SCHEMA = JSON.parse(readNormalized(join(dirname(WEB), "contracts", "hmi-screen.schema.json"))) as {
  $defs: {
    widget: {
      properties: { id: { pattern: string }; policyAction: { enum: string[] } }
      allOf: { if: { properties: { kind: { enum: string[] } } } }[]
    }
  }
}

/** The frozen id rule, READ rather than retyped — the spec never states what a legal id looks like,
 * it asks the schema and then checks the editor agrees. */
const SCHEMA_ID_PATTERN = new RegExp(SCHEMA.$defs.widget.properties.id.pattern)
const SCHEMA_ACTIONS = SCHEMA.$defs.widget.properties.policyAction.enum
/** The two kinds `$defs/widget`'s `allOf`/`if`/`then` makes `policyAction` REQUIRED for — invariant
 * §5, taken from the schema's own `if` so this file carries no second copy of the rule. */
const SCHEMA_WRITE_KINDS = SCHEMA.$defs.widget.allOf[0].if.properties.kind.enum

// ── the registry, read from disk, twice, independently ────────────────────────────────────────────

const REGISTRY_SOURCE = readNormalized(join(WEB, "src", "hmi-runtime", "widgetRegistry.ts"))

/** The quoted keys of the registry's object literal. Identical technique and identical regex to
 * `runtime-tests/widgetRegistry.test.mjs`'s `readRegisteredKinds` — including its constraint that
 * every key stays QUOTED, which `widgetRegistry.ts`'s own header records. */
function registryKeys(): string[] {
  const block = /export const widgetRegistry:[^\n]*=\s*\{([\s\S]*?)\n\}/.exec(REGISTRY_SOURCE)
  if (!block) throw new Error("could not find the widgetRegistry object literal in widgetRegistry.ts")
  return [...block[1].matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1])
}

/** The SECOND, independent extraction: one `import { XWidget } from "./widgets/<name>"` line per
 * entry. Different anchor, different line, different token — so a defect in the key extraction alone
 * cannot move both sets the same way. */
function registryModuleNames(): string[] {
  return [...REGISTRY_SOURCE.matchAll(/^import \{[^}]*\} from "\.\/widgets\/([^"]+)"$/gm)].map((m) => m[1])
}

const REGISTRY_KINDS = registryKeys()

/** A kind the schema does NOT require a gate for — chosen from the registry rather than typed, so
 * this file does not acquire a hand-written kind name either. */
const PLAIN_KIND = REGISTRY_KINDS.find((kind) => !SCHEMA_WRITE_KINDS.includes(kind))
/** …and a kind it DOES, for the §5 half. */
const WRITE_KIND = REGISTRY_KINDS.find((kind) => SCHEMA_WRITE_KINDS.includes(kind))

type ProbeWidget = {
  id: string
  kind: string
  rect: { col: number; row: number; colSpan: number; rowSpan: number }
  bindings?: Record<string, string>
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

/**
 * Four widgets, and the first two share ONE rect on purpose — that overlapping pair is the whole
 * instrument for the draw-order claim. `layer-charlie` sits in the MIDDLE of the list so "delete then
 * undo restores its exact old position" is a claim about an index rather than about an append.
 */
const PROBE_DOC: ProbeDocument = {
  schemaVersion: 1,
  screenId: SCREEN_ID,
  title: "Layer tree probe — cay lop",
  theme: "isa101",
  layout: { cols: 12, rows: 4, breakpoint: "panel" },
  widgets: [
    { id: "layer-alpha", kind: "label", rect: { col: 0, row: 0, colSpan: 4, rowSpan: 2 }, props: { text: ALPHA_TEXT } },
    { id: "layer-bravo", kind: "label", rect: { col: 0, row: 0, colSpan: 4, rowSpan: 2 }, props: { text: BRAVO_TEXT } },
    { id: "layer-charlie", kind: "label", rect: { col: 5, row: 0, colSpan: 3, rowSpan: 1 }, props: { text: CHARLIE_TEXT } },
    { id: "layer-delta", kind: "readout", rect: { col: 9, row: 0, colSpan: 3, rowSpan: 1 }, bindings: { value: "cycles" } },
  ],
}

const DOC_IDS = PROBE_DOC.widgets.map((w) => w.id)

/** The overlapping pair, named once so every assertion below reads as the claim rather than as two
 * ids that happen to be adjacent. `BRAVO` is second in the document, so it starts on top. */
const OVERLAP_UNDER = "layer-alpha"
const OVERLAP_OVER = "layer-bravo"

async function putScreen(request: APIRequestContext, doc: ProbeDocument): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/screens/${doc.screenId}`, { data: doc })
  if (!res.ok()) throw new Error(`PUT /v1/screens/${doc.screenId} failed: ${res.status()} ${await res.text()}`)
}

async function openCanvas(page: Page): Promise<void> {
  await page.goto(ROUTE)
  await expect(page.locator(`[data-editor-canvas="${SCREEN_ID}"]`)).toBeVisible()
  await expect(page.locator(`[data-hmi-screen="${SCREEN_ID}"]`)).toBeVisible()
  await expect(page.locator("[data-layer-tree]")).toBeVisible()
}

/** The tree's rows, in the order it renders them. */
function treeIds(page: Page): Promise<string[]> {
  return page
    .locator("[data-layer-list] [data-layer-row]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-layer-row") ?? ""))
}

/** The RENDERER's own cells, in the order it placed them — read off the canvas, not off the tree, so
 * a tree that reorders only itself cannot satisfy an assertion made with this. */
function canvasIds(page: Page): Promise<string[]> {
  return page
    .locator(`[data-hmi-screen="${SCREEN_ID}"] [data-hmi-widget]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-hmi-widget") ?? ""))
}

/**
 * Which widget the BROWSER says is on top at the centre of `widgetId`'s rendered cell.
 *
 * `document.elementsFromPoint` returns the hit-test stack topmost-first — the same order that decides
 * which element an operator's click lands on — so this answers "what is drawn over what" rather than
 * "what order is in the DOM". The editor's overlay sits above the renderer and is skipped, because
 * only elements inside a `[data-hmi-widget]` cell within `[data-hmi-screen]` are considered.
 */
function topmostAt(page: Page, widgetId: string): Promise<string | null> {
  return page.evaluate(
    ([screenId, id]) => {
      const root = document.querySelector(`[data-hmi-screen="${screenId}"]`)
      if (!root) throw new Error(`no [data-hmi-screen="${screenId}"] on this page`)
      const cell = root.querySelector(`[data-hmi-widget="${id}"]`)
      if (!cell) throw new Error(`no rendered cell for "${id}" — the probe this test measures is gone`)
      const box = cell.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) throw new Error(`cell "${id}" has no area — nothing to hit-test`)
      for (const el of document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)) {
        const owner = el.closest("[data-hmi-widget]")
        if (owner && root.contains(owner)) return owner.getAttribute("data-hmi-widget")
      }
      return null
    },
    [SCREEN_ID, widgetId] as const
  )
}

/** The rendered rect of one cell, as four numbers — used to prove the overlapping pair really does
 * overlap before anything is concluded from which of them is on top. */
function cellBox(page: Page, widgetId: string): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.locator(`[data-hmi-screen="${SCREEN_ID}"] [data-hmi-widget="${widgetId}"]`).evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  })
}

/** Moves focus off any field so the canvas's window-level `Ctrl+Z` handler is not skipped —
 * `EditorCanvas.tsx`'s `isTextEntry` deliberately leaves the shortcut to a focused `INPUT`/`SELECT`,
 * which is correct behaviour and would otherwise make an undo assertion here measure nothing. The
 * click lands on the route header, NOT on the overlay background, which would clear the selection. */
async function blurFields(page: Page): Promise<void> {
  await page.locator("[data-editor-design-mode]").click()
  await expect(page.locator("[data-editor-design-mode]")).toBeVisible()
}

/** Selects a widget through the CANVAS overlay's own hit target — the control a pointer presses. */
async function selectOnCanvas(page: Page, widgetId: string): Promise<void> {
  await page.locator(`[data-editor-widget="${widgetId}"]`).click()
}

/** The `value` attribute of every `<option>` in a select, in DOM order. */
function optionValues(page: Page, selector: string): Promise<string[]> {
  return page.locator(`${selector} option`).evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value))
}

test.describe("HMI screen editor — the layer tree", () => {
  test.beforeEach(async ({ request }) => {
    // Re-established per test, so none inherits what an earlier one edited and none depends on file
    // ORDER. The canvas holds its edits in memory only (no save exists yet), so a fresh page load is
    // already a fresh document — the PUT makes that true across re-runs too.
    await putScreen(request, PROBE_DOC)
  })

  test("the tree lists every widget in document order, and selection is synchronised in BOTH directions", async ({
    page,
  }) => {
    await openCanvas(page)

    // The floor: a document with fewer than three widgets would make the order claim nearly vacuous.
    expect(DOC_IDS.length, "the probe document lost widgets — every ordering claim below weakens").toBeGreaterThan(3)
    expect(await treeIds(page)).toEqual(DOC_IDS)
    // …and the tree is showing the SAME list the renderer drew, not a list of its own.
    expect(await canvasIds(page)).toEqual(DOC_IDS)

    // Each row names its widget's kind, so the list is identifiable when ids are terse.
    for (const widget of PROBE_DOC.widgets) {
      await expect(page.locator(`[data-layer-kind="${widget.id}"]`)).toHaveText(widget.kind)
    }

    // Nothing selected yet — in the tree OR on the canvas.
    await expect(page.locator('[data-layer-row][data-layer-selected="true"]')).toHaveCount(0)

    // 🔴 DIRECTION 1 — canvas → tree.
    await selectOnCanvas(page, "layer-charlie")
    await expect(page.locator('[data-layer-row="layer-charlie"]')).toHaveAttribute("data-layer-selected", "true")
    await expect(page.locator('[data-layer-row][data-layer-selected="true"]')).toHaveCount(1)
    await expect(page.locator("[data-panel-widget-id]")).toHaveText("layer-charlie")

    // 🔴 DIRECTION 2 — tree → canvas. Read off the OVERLAY's own selected flag and off the property
    // panel, i.e. off two surfaces the tree does not own; a tree that only highlighted itself would
    // pass a test that read the tree back.
    await page.locator('[data-layer-select="layer-delta"]').click()
    await expect(page.locator('[data-editor-widget="layer-delta"]')).toHaveAttribute("data-editor-selected", "true")
    await expect(page.locator('[data-editor-widget="layer-charlie"]')).toHaveAttribute("data-editor-selected", "false")
    await expect(page.locator("[data-panel-widget-id]")).toHaveText("layer-delta")
    // The resize handle is the canvas's own single-selection affordance — it follows too.
    await expect(page.locator('[data-editor-resize="layer-delta"]')).toHaveCount(1)
  })

  test("🔴 the add menu's kinds come FROM the registry — not from a hand-written list, even a correct one", async ({
    page,
  }) => {
    // ── half 0: the floor, before any comparison. Two empty sets are equal. ──────────────────────
    const keys = registryKeys()
    const modules = registryModuleNames()
    expect(keys.length, "extracted 0 quoted keys from widgetRegistry.ts — the extraction broke, not the file").toBeGreaterThan(0)
    expect(modules.length, "extracted 0 ./widgets/… imports from widgetRegistry.ts — the counter-extraction broke").toBeGreaterThan(0)
    // 🔴 SETS, not counts (task-6-review.md LOW-3): a compensating pair of mutations — one key lost
    // from the key extraction while a stray import appears elsewhere — keeps both counts at 15 while
    // the two sets differ by one member. Compared by name, in both directions separately.
    const keySet = new Set(keys)
    const moduleSet = new Set(modules)
    expect({
      keysWithoutModule: keys.filter((k) => !moduleSet.has(k)).sort(),
      modulesWithoutKey: modules.filter((m) => !keySet.has(m)).sort(),
    }).toEqual({ keysWithoutModule: [], modulesWithoutKey: [] })

    await openCanvas(page)

    // ── half 1: what the menu RENDERS is exactly what the registry file declares ─────────────────
    const rendered = await optionValues(page, "[data-layer-add-kind]")
    expect(rendered[0], "the first option is not the placeholder — a kind would be pre-selected").toBe("")
    expect(rendered.slice(1)).toEqual(keys)

    // ── half 2: NO module under `src/editor/` carries a kind name, except the one allowed to ─────
    // 🔴 THIS is the half that reddens against a hand-written list which happens to be correct today —
    // half 1 cannot, because such a list renders identical options.
    //
    // 🔴 FIX ROUND 1, task-11-review.md LOW-3 AND the disclosed hole. Round 0 stripped comments with a
    // line-leading-only `//` regex and scanned for double- and single-quoted names, which had two
    // cracks the reviewer named: a TRAILING `// "label"` would have made the pin fire FALSELY, and a
    // backtick-quoted kind name evaded it entirely. Both are gone: the scan is now over TypeScript's
    // own parse of each file, collecting the text of every string and template literal, so comments
    // are excluded by the parser rather than by a regex and all three quote forms are covered by
    // construction. `scripts/check-test-budgets.mjs` already reaches for the same compiler for the
    // same reason — a source claim that must not be defeated by where a character happens to sit.
    //
    // 🔴 AND THE CENSUS IS NOW THE WHOLE `src/editor/` DIRECTORY, not `LayerTree.tsx` alone. Round 0
    // disclosed that a hand-written list moved into a sibling module and imported would satisfy the
    // pin; the reviewer reproduced exactly that (`src/editor/tempKinds.ts` plus a dead
    // `void widgetRegistry`) and the whole suite stayed green. A directory census closes it — the same
    // instrument, and the same allowlist shape, `runtime-tests/editorCanvasSeam.test.mjs` uses for its
    // own rules.
    //
    // WHAT REMAINS OPEN, stated rather than left to be found: a list placed OUTSIDE `src/editor/` and
    // imported. That is a longer walk than the one that was disclosed, and half 1 still catches any
    // such list on the day it drifts from the registry.
    const CENSUS_DIR = join(WEB, "src", "editor")
    // `editorState.ts` is allowed to name kinds, and the exemption is narrow and load-bearing rather
    // than a convenience: its `WIDGET_KINDS` record is the compile-time mirror of the FROZEN
    // `WidgetKind` union (`Record<WidgetKind, true>`, exhaustive in both directions), which is what
    // `applyEdit`'s guards enforce and what `SCHEMA_MIRROR` holds answerable to the schema file. It is
    // a checked copy of the CONTRACT, not a second copy of the registry.
    const CENSUS_ALLOWED = "editorState.ts"
    const kindLiteralsIn = (file: string): string[] => {
      const sf = ts.createSourceFile(file, readNormalized(join(CENSUS_DIR, file)), ts.ScriptTarget.Latest, true)
      const literals: string[] = []
      const visit = (node: ts.Node): void => {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          node.kind === ts.SyntaxKind.TemplateHead ||
          node.kind === ts.SyntaxKind.TemplateMiddle ||
          node.kind === ts.SyntaxKind.TemplateTail
        ) {
          literals.push((node as ts.LiteralLikeNode).text)
        }
        node.forEachChild(visit)
      }
      visit(sf)
      // The per-file floor: a parse that yielded nothing would report every file as clean.
      expect(literals.length, `extracted 0 string literals from ${file} — the parse broke, not the file`).toBeGreaterThan(0)
      return keys.filter((kind) => literals.includes(kind))
    }

    const censusFiles = readdirSync(CENSUS_DIR).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    expect(censusFiles.length, "the src/editor census found no files — it would pass over nothing").toBeGreaterThan(3)
    expect(
      censusFiles,
      "the allowlisted file is not in the census — the exemption names something that is not there"
    ).toContain(CENSUS_ALLOWED)
    // The allowlist's own floor: if `editorState.ts` ever STOPS carrying kind literals, the exemption
    // is covering nothing and should be deleted rather than left as a hole nobody is watching.
    expect(
      kindLiteralsIn(CENSUS_ALLOWED).length,
      `${CENSUS_ALLOWED} no longer names any widget kind — the census exemption is now covering nothing, delete it`
    ).toBeGreaterThan(0)

    const offenders: Record<string, string[]> = {}
    for (const file of censusFiles) {
      if (file === CENSUS_ALLOWED) continue
      const hits = kindLiteralsIn(file)
      if (hits.length > 0) offenders[file] = hits.sort()
    }
    expect(
      offenders,
      "a module under src/editor/ writes widget-kind names out as string literals — the add menu's vocabulary would be a SECOND list beside the registry, and a second list is a thing to drift"
    ).toEqual({})

    // …and the component really does reach the registry, so "no kind names" cannot be satisfied by a
    // menu that is simply empty.
    expect(
      readNormalized(join(CENSUS_DIR, "LayerTree.tsx")).includes("widgetRegistry"),
      "LayerTree.tsx does not mention widgetRegistry at all — whatever fills its menu, it is not the registry"
    ).toBe(true)
  })

  test("adding a widget from the menu puts it on the canvas and at the end of the list, and Ctrl+Z takes it back off", async ({
    page,
  }) => {
    expect(PLAIN_KIND, "no non-write kind in the registry — this test has nothing to add").toBeTruthy()
    await openCanvas(page)

    await expect(page.locator("[data-layer-add]")).toBeDisabled()
    await page.locator("[data-layer-add-kind]").selectOption(PLAIN_KIND!)
    // A kind with no §5 obligation asks for nothing more.
    await expect(page.locator("[data-layer-add-policy]")).toHaveCount(0)
    await expect(page.locator("[data-layer-add]")).toBeEnabled()
    await page.locator("[data-layer-add]").click()

    // On the CANVAS, drawn by the renderer, and in the tree — at the END, because a new layer is
    // painted over what is already there.
    const added = (await treeIds(page)).at(-1) as string
    expect(added, "the tree gained no row").not.toBe(DOC_IDS.at(-1))
    expect(await treeIds(page)).toEqual([...DOC_IDS, added])
    expect(await canvasIds(page)).toEqual([...DOC_IDS, added])
    await expect(page.locator(`[data-layer-kind="${added}"]`)).toHaveText(PLAIN_KIND!)

    // The generated id satisfies the FROZEN schema's own pattern — asked of the schema file, not
    // asserted from a shape this spec invented.
    expect(SCHEMA_ID_PATTERN.test(added), `generated id ${JSON.stringify(added)} does not match ${SCHEMA_ID_PATTERN.source}`).toBe(true)
    // …and it is selected, so the panel is open on the thing that just appeared.
    await expect(page.locator("[data-panel-widget-id]")).toHaveText(added)

    // ONE undo step: the whole add was one edit.
    await blurFields(page)
    await page.keyboard.press("Control+z")
    expect(await treeIds(page)).toEqual(DOC_IDS)
    expect(await canvasIds(page)).toEqual(DOC_IDS)
    await expect(page.locator(`[data-hmi-widget="${added}"]`)).toHaveCount(0)
  })

  test("🔴 §5 in the ADD path: a write kind is offered, but nothing is added until an action is chosen", async ({
    page,
  }) => {
    expect(WRITE_KIND, "the registry declares neither write kind — §5 has nothing to gate here").toBeTruthy()
    await openCanvas(page)

    // The write kinds are OFFERED. Filtering them out of the menu would be a hand-written exclusion —
    // the very thing the registry claim forbids — and an editor that cannot author part of the
    // contract.
    const offered = await optionValues(page, "[data-layer-add-kind]")
    for (const kind of SCHEMA_WRITE_KINDS) {
      expect(offered, `the add menu does not offer "${kind}" — the vocabulary is being filtered by hand`).toContain(kind)
    }

    await page.locator("[data-layer-add-kind]").selectOption(WRITE_KIND!)

    // 🔴 THE GATE. Add is refused and the reason is on screen, naming the kind.
    await expect(page.locator("[data-layer-add]")).toBeDisabled()
    await expect(page.locator("[data-layer-add-policy-required]")).toHaveText(
      viDict.editor.layers.addPolicyRequired({ kind: WRITE_KIND! })
    )
    // …and nothing reached the document — measured on the canvas and on the tree, not on the menu.
    expect(await canvasIds(page)).toEqual(DOC_IDS)
    expect(await treeIds(page)).toEqual(DOC_IDS)

    // 🔴 NO FREE-TEXT PATH to the action. A native `<select>` cannot accept typed text at all, its
    // options are the placeholder plus EXACTLY the frozen schema file's own enum, and no `<input>`
    // sits anywhere in the section that holds the control.
    const policy = page.locator("[data-layer-add-policy]")
    expect(await policy.evaluate((el) => el.tagName)).toBe("SELECT")
    expect(await optionValues(page, "[data-layer-add-policy]")).toEqual(["", ...SCHEMA_ACTIONS])
    expect(SCHEMA_ACTIONS, "the schema's policyAction enum moved — this comparison must be re-read").toEqual([
      "machine.setpoint",
      "machine.command",
    ])
    await expect(
      page.locator("[data-layer-add-section] input"),
      "a text input sits in the add section — the action has a free-text path"
    ).toHaveCount(0)

    // Choosing one commits BOTH, in a single edit.
    await policy.selectOption(SCHEMA_ACTIONS[0])
    await expect(page.locator("[data-layer-add]")).toBeEnabled()
    await page.locator("[data-layer-add]").click()

    const added = (await treeIds(page)).at(-1) as string
    expect(await canvasIds(page)).toEqual([...DOC_IDS, added])
    await expect(page.locator("[data-panel-widget-id]")).toHaveText(added)
    await expect(page.locator("[data-panel-policy-action]")).toHaveValue(SCHEMA_ACTIONS[0])
    // `policyGate` let the control through — an ungated write widget would draw its refusal note
    // instead, which is what `widgets/shared.ts` renders and `36-hmi-all-widget-kinds` pins.
    await expect(page.locator(`[data-hmi-widget="${added}"] [role=note]`)).toHaveCount(0)

    // ONE undo step, not two: the kind and the action travelled together, so no intermediate document
    // ever held an ungated write widget.
    await blurFields(page)
    await page.keyboard.press("Control+z")
    expect(await canvasIds(page)).toEqual(DOC_IDS)
  })

  test("deleting a widget takes it off the document and the canvas, and Ctrl+Z restores its EXACT old position", async ({
    page,
  }) => {
    await openCanvas(page)

    const middle = "layer-charlie"
    const middleIndex = DOC_IDS.indexOf(middle)
    expect(middleIndex, "the deleted widget is not in the MIDDLE of the list — 'exact old position' would be satisfied by an append").toBeGreaterThan(0)
    expect(middleIndex).toBeLessThan(DOC_IDS.length - 1)
    await expect(page.locator(`[data-hmi-widget="${middle}"]`)).toContainText(CHARLIE_TEXT)

    await page.locator(`[data-layer-remove="${middle}"]`).click()

    const withoutMiddle = DOC_IDS.filter((id) => id !== middle)
    expect(await treeIds(page)).toEqual(withoutMiddle)
    expect(await canvasIds(page)).toEqual(withoutMiddle)
    await expect(page.locator(`[data-hmi-widget="${middle}"]`)).toHaveCount(0)
    // The overlay's hit target went with it — a canvas that kept a control for a widget nobody can
    // see is a canvas that can still drag a deleted thing.
    await expect(page.locator(`[data-editor-widget="${middle}"]`)).toHaveCount(0)

    await blurFields(page)
    await page.keyboard.press("Control+z")

    // 🔴 EXACT position, in both witnesses. Restoring it at the END of the array would pass a test
    // that only asked "is it back?" — and would silently change what is drawn on top of what.
    expect(await treeIds(page)).toEqual(DOC_IDS)
    expect(await canvasIds(page)).toEqual(DOC_IDS)
    await expect(page.locator(`[data-layer-row="${middle}"]`)).toHaveAttribute("data-layer-index", String(middleIndex))
    await expect(page.locator(`[data-hmi-widget="${middle}"]`)).toContainText(CHARLIE_TEXT)
  })

  test("🔴 moving a row changes the DRAW order, measured on the canvas rather than in the tree", async ({ page }) => {
    await openCanvas(page)

    // ── the floor: the two widgets really do occupy the same rendered rect ───────────────────────
    // Without this, "which is on top" has no answer and every assertion below is about nothing.
    const underBox = await cellBox(page, OVERLAP_UNDER)
    const overBox = await cellBox(page, OVERLAP_OVER)
    expect(underBox, "the two probe widgets are not drawn on the same cells — the draw-order claim has no subject").toEqual(overBox)
    expect(underBox.w, "the overlapping cell has no width — nothing to hit-test").toBeGreaterThan(0)

    // ── before: the LATER widget in the document is on top ───────────────────────────────────────
    // Three independent witnesses, and the first two come from the canvas: the browser's own hit test,
    // the renderer's cell order, and only then the tree.
    expect(await topmostAt(page, OVERLAP_UNDER)).toBe(OVERLAP_OVER)
    expect(await canvasIds(page)).toEqual(DOC_IDS)
    expect(await treeIds(page)).toEqual(DOC_IDS)

    // ── the engineer moves the top layer underneath the one it was covering ──────────────────────
    await page.locator(`[data-layer-up="${OVERLAP_OVER}"]`).click()

    const swapped = [OVERLAP_OVER, OVERLAP_UNDER, ...DOC_IDS.slice(2)]
    // 🔴 THE ASSERTION THAT DEFEATS A TREE THAT REORDERS ONLY ITSELF: what the browser would hit at
    // the shared cell is now the OTHER widget, and the renderer placed its cells in the new order.
    expect(
      await topmostAt(page, OVERLAP_UNDER),
      "the tree's row moved but the drawing did not — the reorder never reached the document"
    ).toBe(OVERLAP_UNDER)
    expect(await canvasIds(page)).toEqual(swapped)
    expect(await treeIds(page)).toEqual(swapped)

    // The row that did NOT move keeps its index — a reorder is a move of one layer, not a reshuffle.
    await expect(page.locator('[data-layer-row="layer-delta"]')).toHaveAttribute(
      "data-layer-index",
      String(DOC_IDS.length - 1)
    )

    // The first row cannot go further up, and the last cannot go further down: the boundary is a
    // disabled control rather than an edit `applyEdit` would refuse as out of range.
    await expect(page.locator(`[data-layer-up="${OVERLAP_OVER}"]`)).toBeDisabled()
    await expect(page.locator(`[data-layer-down="${DOC_IDS.at(-1)}"]`)).toBeDisabled()

    // One undo step, and the drawing goes back with it.
    await blurFields(page)
    await page.keyboard.press("Control+z")
    expect(await canvasIds(page)).toEqual(DOC_IDS)
    expect(await topmostAt(page, OVERLAP_UNDER)).toBe(OVERLAP_OVER)
  })

  test("renaming a widget re-addresses it everywhere — canvas cell, panel, selection — and keeps its position", async ({
    page,
  }) => {
    await openCanvas(page)

    const oldId = "layer-charlie"
    const newId = "cam-bien-nhiet"
    expect(SCHEMA_ID_PATTERN.test(newId), "the probe name this test types is not legal under the frozen pattern").toBe(true)
    const index = DOC_IDS.indexOf(oldId)

    // The rename box is on the SELECTED row, and only there — the row whose panel is open, so a
    // refusal is shown beside the box that earned it.
    await expect(page.locator(`[data-layer-rename="${oldId}"]`)).toHaveCount(0)
    await selectOnCanvas(page, oldId)
    await expect(page.locator(`[data-layer-rename="${oldId}"]`)).toHaveValue(oldId)
    // 🔴 FIX ROUND 1, task-11-review.md LOW-4 — the hint an engineer reads WHILE TYPING carries the
    // frozen pattern, interpolated from `editorState.ts`'s single regex, and it is compared here
    // against `contracts/hmi-screen.schema.json` read from disk. Round 0 said "lowercase letters,
    // digits and hyphens" in two dictionaries with nothing comparing either sentence to anything;
    // widen the schema's pattern now and this assertion moves the sentence with it instead of leaving
    // three prose copies quietly wrong.
    await expect(page.locator("[data-layer-rename-hint]")).toContainText(SCHEMA_ID_PATTERN.source)
    expect(
      SCHEMA_ID_PATTERN.source.length,
      "the schema's id pattern is empty — the containment check above would pass against anything"
    ).toBeGreaterThan(2)

    await page.locator(`[data-layer-rename="${oldId}"]`).fill(newId)
    await page.locator(`[data-layer-rename="${oldId}"]`).press("Enter")

    // 🔴 The ADDRESS moved, on every surface that holds one.
    await expect(page.locator(`[data-hmi-widget="${newId}"]`)).toContainText(CHARLIE_TEXT)
    await expect(page.locator(`[data-hmi-widget="${oldId}"]`)).toHaveCount(0)
    await expect(page.locator(`[data-editor-widget="${newId}"]`)).toHaveCount(1)
    // The selection FOLLOWED the widget rather than blanking out — the panel is still open on it.
    await expect(page.locator("[data-panel-widget-id]")).toHaveText(newId)
    await expect(page.locator(`[data-layer-row="${newId}"]`)).toHaveAttribute("data-layer-selected", "true")
    // …and it did not move in the list: renaming is not reordering.
    await expect(page.locator(`[data-layer-row="${newId}"]`)).toHaveAttribute("data-layer-index", String(index))
    expect(await canvasIds(page)).toEqual(DOC_IDS.map((id) => (id === oldId ? newId : id)))

    await blurFields(page)
    await page.keyboard.press("Control+z")
    expect(await canvasIds(page)).toEqual(DOC_IDS)
    await expect(page.locator(`[data-hmi-widget="${oldId}"]`)).toContainText(CHARLIE_TEXT)
  })

  test("🔴 a rename the frozen schema or the uniqueness rule refuses is REFUSED, named, and the box snaps back", async ({
    page,
  }) => {
    await openCanvas(page)

    const subject = "layer-charlie"
    await selectOnCanvas(page, subject)

    // ── (a) a name outside the frozen id pattern ─────────────────────────────────────────────────
    const illegal = "Charlie Uppercase"
    // Measured against the SCHEMA FILE, not asserted: this string is illegal because the frozen
    // pattern says so. If the pattern ever widens, this line reddens before anyone concludes the
    // editor is the thing that is wrong.
    expect(SCHEMA_ID_PATTERN.test(illegal), `the frozen pattern now ACCEPTS ${JSON.stringify(illegal)} — this probe is stale`).toBe(false)
    await page.locator(`[data-layer-rename="${subject}"]`).fill(illegal)
    await page.locator(`[data-layer-rename="${subject}"]`).press("Enter")

    await expect(page.locator("[data-panel-refusal]")).toContainText("invalid-widget")
    await expect(page.locator(`[data-hmi-widget="${subject}"]`)).toContainText(CHARLIE_TEXT)
    expect(await canvasIds(page)).toEqual(DOC_IDS)
    // The box does not keep a name the document never took.
    await expect(page.locator(`[data-layer-rename="${subject}"]`)).toHaveValue(subject)
    // 🔴 FIX ROUND 1, task-11-review.md LOW-5 — THE CARET SURVIVES A REFUSAL. The snap-back above is
    // implemented by reloading the field from the document after every commit attempt; round 0 did
    // that by RE-KEYING the input, which remounts it and destroys the focus, so correcting a refused
    // name meant clicking back into the box. Both halves are pinned, here and above: revert to the
    // re-key and this assertion reddens, drop the reload entirely and the snap-back assertion does.
    await expect(
      page.locator(`[data-layer-rename="${subject}"]`),
      "the rename box lost focus when the name was refused — the engineer has to click back in before they can correct it"
    ).toBeFocused()

    // ── (b) a name another widget already carries ────────────────────────────────────────────────
    // The frozen schema PERMITS duplicate ids (`runtime-tests/editorState.test.mjs` measures that
    // directly against `validate.mjs`); this refusal is the editor being deliberately stricter, and
    // it is the reason a rename needs a guard of its own rather than the schema's alone.
    await page.locator(`[data-layer-rename="${subject}"]`).fill(OVERLAP_UNDER)
    await page.locator(`[data-layer-rename="${subject}"]`).press("Enter")

    await expect(page.locator("[data-panel-refusal]")).toContainText("duplicate-id")
    await expect(page.locator("[data-panel-refusal]")).toContainText(OVERLAP_UNDER)
    expect(await canvasIds(page)).toEqual(DOC_IDS)
    await expect(page.locator(`[data-layer-rename="${subject}"]`)).toHaveValue(subject)
    // Exactly one widget still carries that id.
    await expect(page.locator(`[data-hmi-widget="${OVERLAP_UNDER}"]`)).toHaveCount(1)

    // ── the counter-example, so neither refusal above can be green from a guard that refuses ALL
    // renames ────────────────────────────────────────────────────────────────────────────────────
    const legal = "charlie-2"
    expect(SCHEMA_ID_PATTERN.test(legal)).toBe(true)
    await page.locator(`[data-layer-rename="${subject}"]`).fill(legal)
    await page.locator(`[data-layer-rename="${subject}"]`).press("Enter")
    await expect(page.locator(`[data-hmi-widget="${legal}"]`)).toContainText(CHARLIE_TEXT)
    await expect(page.locator("[data-panel-refusal]")).toHaveCount(0)

    // …and the two refusals cost NO undo step: one Ctrl+Z reaches the original document, not a
    // half-renamed one.
    await blurFields(page)
    await page.keyboard.press("Control+z")
    expect(await canvasIds(page)).toEqual(DOC_IDS)
  })

  test("the panel still shows id read-only, and says where renaming lives", async ({ page }) => {
    // 🔴 The controller ruling that moved rename here (task-10-review.md F4) is only honoured if the
    // panel does NOT grow a second id control — two boxes for one field is how an editor gets a rule
    // enforced in one of them.
    await openCanvas(page)
    await selectOnCanvas(page, "layer-delta")

    await expect(page.locator("[data-panel-widget-id]")).toHaveText("layer-delta")
    await expect(
      page.locator("[data-property-panel] section:has([data-panel-widget-id]) input"),
      "the property panel grew an id input — rename is supposed to live in the layer tree, in one place"
    ).toHaveCount(0)
    await expect(page.locator("[data-property-panel]")).toContainText(viDict.editor.panel.idReadOnly)
  })
})
