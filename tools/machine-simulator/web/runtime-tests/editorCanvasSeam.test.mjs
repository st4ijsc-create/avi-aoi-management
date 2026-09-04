// Run: npm run test:runtime   (node --test, no extra package)
//
// WS-HMI-2 Task 8, fix round 2 — task-8-re-review.md.
//
// ── WHAT THIS FILE IS, SAID FIRST AND WITHOUT DECORATION ─────────────────────────────────────────
// **This is a cheap early warning that catches careless divergence. It is not a proof of identity,
// and nothing in it should be read as one.** The claim "the editor's canvas is the runtime
// `ScreenRenderer`" is carried by the DIFFERENTIAL test in `tests/37-editor-canvas.spec.ts` — the one
// that renders the SAME document through the kiosk route and through the editor route and compares
// what the renderer actually produced. This file exists because that comparison runs behind a
// 10-minute browser suite and because a static check names the specific line a revert would delete.
//
// The round-1 version of this file claimed more, and was wrong. It asserted a "pincer": *"rename the
// hooks to slip the structural pin and the browser spec goes red; keep them and the structural pin
// does."* **RETRACTED — measured false.** The reviewer wrote impostor C, which keeps all three hooks
// and passed this file 11/11:
//
//   * it put the second renderer in `src/canvas/`, one directory outside the old SIDE 2's scope;
//   * it attached the hooks with `{...widgetHook(widget.id)}` from a helper holding
//     `const WIDGET_HOOK = "data-hmi-widget"`, so the old SIDE 3's `source.includes("data-hmi-widget=")`
//     substring scan saw nothing;
//   * it kept a real `<ScreenRenderer doc source/>` inside a `CANVAS_MODE === "preview"` branch that
//     never runs, so the old SIDE 1 was satisfied by DEAD CODE.
//
// And thinner: with ordinary literal attributes only the old SIDE 3 fired, and writing
// `data-hmi-screen ={doc.screenId}` — one space — turned it green again. The root cause was one word:
// the test said *emitted* and the code measured the spelling of one authoring style.
//
// ── WHAT CHANGED, AND WHY EACH OLD RULE WENT ─────────────────────────────────────────────────────
// Every check below is now an AST query over TypeScript's own parse of the file, not a substring scan,
// and the two that carry weight are scoped to the WHOLE CLIENT (`web/src/**`) rather than to one
// directory.
//
//   * `data-hmi-screen=` / `data-hmi-widget=` / `data-hmi-widget-error=` as SUBSTRINGS — gone.
//     Replaced by SIDE A, which asks whether a file NAMES a hook: as a JSX attribute name (whitespace
//     irrelevant, because the parser tokenises the name), or as a string literal whose WHOLE value is
//     the hook (which is how a spread helper, a `createElement` prop bag or a computed key has to
//     spell it). The whole-value rule is what makes a value-qualified CSS selector legal — see
//     `TASK_9_DRAG_LAYER` below, and §4.
//   * `gridColumn:` / `gridRow:` / `gridTemplateColumns` / `gridTemplateRows` — gone, deliberately.
//     They forbade a drag ghost and a snap-grid overlay under `src/editor/`, which is the standard
//     design for Task 9 and is not a second renderer. Geometry is now compared where geometry lives:
//     the differential test reads the COMPUTED grid lines and gaps out of two real pages. A source ban
//     bought nothing that the comparison does not buy properly.
//   * `resolveBinding` / `componentTagPrefixOf` / `clampRectToLayout` / `unresolvedComponentBindingWarning`
//     — gone. Task 10's tag picker exists to preview what a binding resolves to; forbidding it from
//     calling the resolver was over-reach.
//   * `getDerivedStateFromError` / `componentDidCatch` — gone. An editor may legitimately own an error
//     boundary around its OWN chrome; owning one around widget cells is caught by SIDE A and SIDE B.
//   * the `hmi-runtime` IMPORT ALLOWLIST — gone, and this one mattered twice. It collided with Task 10
//     (`bindings`) and Task 11 (`widgetRegistry`) by construction, impostor C walked around it in one
//     directory, and — the reason it could not simply be extended — the round-1 §4 self-check asserted
//     the exact set of forbidden imports, so **the legitimate extension the file itself forecast would
//     have reddened the file's own anti-blindness test.** A pin whose honesty device must be loosened
//     by the next task is one that gets loosened by whoever hits it with a deadline. There is no list
//     to extend now: §4's probes assert only against the AST rules, which do not enumerate anything.
//   * `widgetRegistry[` as a substring — gone. `const registry = widgetRegistry; registry[kind]`
//     defeated it (measured by the reviewer while simulating Task 11). SIDE B resolves local aliases
//     and asks the parser for an element access.
//
// ── THE THREE SIDES, AT THEIR REAL WIDTH ─────────────────────────────────────────────────────────
//   SIDE A (client-wide) — exactly one file in `web/src/**` NAMES a renderer DOM hook, and it is
//   `hmi-runtime/ScreenRenderer.tsx`. This is the only claim here with client-wide reach.
//
//   SIDE B (client-wide) — exactly one file in `web/src/**` DISPATCHES `widgetRegistry` by element
//   access (aliases resolved), and it is `hmi-runtime/ScreenRenderer.tsx`. Reading the registry's KEYS
//   (`Object.keys`, `in`, iteration) is untouched, because that is Task 11's palette.
//
//   SIDE C (scoped to `src/editor/`, and it is HYGIENE, not identity) — every JSX element under
//   `src/editor/` that receives both `doc` and `source` is tagged `ScreenRenderer`; `EditorCanvas.tsx`
//   has at least one and imports `ScreenRenderer` unaliased from `hmi-runtime/ScreenRenderer`. The
//   "both `doc` and `source`" shape is what catches impostor C's dead-branch trick, where the real
//   mount sits beside `<DesignRenderer doc={doc} source={…} />`. SIDE C still cannot tell a mount that
//   RUNS from one that does not — a `false && <ScreenRenderer doc source/>` would satisfy it — which is
//   exactly why the identity claim does not live here.
//
// ── WHAT THIS FILE STILL CANNOT DO ───────────────────────────────────────────────────────────────
// Stated at the top so no later reader infers otherwise, and each one measured or derived, not
// guessed:
//   1. It reads text and executes nothing. Nothing here knows whether any of it renders.
//   2. SIDE A's string rule matches a WHOLE literal. `"data-hmi-" + "widget"`, or a name assembled at
//      runtime, is not caught. Both are visible in review in a way a spread helper was not.
//   3. SIDE B sees element access on a locally-aliased identifier. A registry passed through a
//      function parameter, or destructured (`const { readout } = widgetRegistry`), is not caught.
//   4. SIDE C's scope is `src/editor/`. A component elsewhere that takes `doc` and `source` under
//      different prop names and is mounted from the editor is outside it.
//   5. None of this reaches a file outside `web/src/**`.
// The differential test is what holds when these run out: it does not care where a renderer lives or
// how it spells anything, only whether the kiosk and the editor produce the same thing.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..")
const SRC = join(WEB, "src")
const EDITOR_DIR = join(SRC, "editor")
const RENDERER_REL = "hmi-runtime/ScreenRenderer.tsx"
const CANVAS_REL = "editor/EditorCanvas.tsx"
const ROUTE_REL = "editor/EditorRoute.tsx"

/** `check-test-budgets.mjs` already resolves the workspace's own `typescript` this way. */
const ts = createRequire(join(WEB, "package.json"))("typescript")

/** The three DOM hooks a screen renderer must attach for `tests/37-editor-canvas.spec.ts` to locate
 * anything. Their AUTHORSHIP is what SIDE A claims is unique. */
const RENDERER_DOM_HOOKS = ["data-hmi-screen", "data-hmi-widget", "data-hmi-widget-error"]

/** The runtime registry's exported name — SIDE B's subject. */
const REGISTRY_NAME = "widgetRegistry"

/** 🔴 CRLF — `core.autocrlf=true`, no `.gitattributes`; a fresh checkout holds `\r\n`. Normalised so
 * offsets and any future line reporting mean the same thing on every machine. */
function readSource(abs) {
  return readFileSync(abs, "utf8").replace(/\r\n/g, "\n")
}

function parse(fileName, text) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TSX)
}

function walk(node, visit) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

/** Every `.ts`/`.tsx` under `dir`, recursively, relative to `SRC` with `/` separators. */
function listSources(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      found.push(...listSources(abs))
      continue
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(relative(SRC, abs).split(sep).join("/"))
  }
  return found
}

const absOf = (rel) => join(SRC, ...rel.split("/"))

// ── the collectors — every rule below is one of these three, and nothing else ────────────────────

/**
 * The renderer DOM hooks this source NAMES.
 *
 * Two ways to name one, and they are the two ways it can reach the DOM as an attribute:
 *   (a) a JSX attribute name — `data-hmi-widget={id}` and `data-hmi-widget ={id}` are the same token
 *       to the parser, which is what closes the one-space variant;
 *   (b) a string (or no-substitution template) literal whose WHOLE value is the hook — which is how
 *       `{ [WIDGET_HOOK]: id }`, `{ "data-hmi-widget": id }` and `createElement(…, { …: id })` all
 *       have to spell it, and which is what closes the spread helper.
 *
 * Deliberately NOT matched: a literal that merely CONTAINS a hook. `` `[data-hmi-widget="${id}"]` ``
 * is a template with substitutions and never becomes a whole-value literal at all, so a selection or
 * drag layer may address a rendered cell by id. That is not a loophole — it is the point. See
 * `TASK_9_DRAG_LAYER` in §4, which is asserted to PASS.
 */
function hooksNamedBy(sf) {
  const named = new Set()
  walk(sf, (node) => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf)
      if (RENDERER_DOM_HOOKS.includes(name)) named.add(name)
      return
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (RENDERER_DOM_HOOKS.includes(node.text)) named.add(node.text)
    }
  })
  return [...named].sort()
}

/**
 * True when this source dispatches the widget registry — `X[expr]` where `X` is `widgetRegistry` or a
 * local identifier initialised from it (directly, or through another such identifier).
 *
 * `Object.keys(widgetRegistry)`, `kind in widgetRegistry` and iteration are untouched: Task 11's
 * add-widget menu is required to list the registry's kinds rather than a hand-written list, and
 * listing is not dispatching.
 */
function dispatchesRegistry(sf) {
  const aliases = new Set([REGISTRY_NAME])
  // Import aliases first: `import { widgetRegistry as R }` makes `R` the registry.
  walk(sf, (node) => {
    if (ts.isImportSpecifier(node)) {
      const imported = node.propertyName ? node.propertyName.text : node.name.text
      if (imported === REGISTRY_NAME) aliases.add(node.name.text)
    }
  })
  // Then local re-bindings, to a fixed point — `const a = widgetRegistry; const b = a`.
  for (let pass = 0; pass < 8; pass += 1) {
    const before = aliases.size
    walk(sf, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        aliases.has(node.initializer.text)
      ) {
        aliases.add(node.name.text)
      }
    })
    if (aliases.size === before) break
  }
  let found = false
  walk(sf, (node) => {
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text)) {
      found = true
    }
  })
  return found
}

/** The tag name of every JSX element in this source that receives BOTH a `doc` and a `source` prop —
 * the shape a screen renderer is mounted with. */
function screenRendererShapedMounts(sf) {
  const tags = []
  walk(sf, (node) => {
    if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) return
    const names = node.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText(sf))
    if (names.includes("doc") && names.includes("source")) tags.push(node.tagName.getText(sf))
  })
  return tags
}

/** `@/x/y` · `../x/y` · `./y` → `x/y`, without any `.ts`/`.tsx` suffix. */
function normalizeSpecifier(spec) {
  return spec
    .replace(/^@\//, "")
    .replace(/^(?:\.\.\/)+/, "")
    .replace(/^\.\//, "")
    .replace(/\.tsx?$/, "")
}

/** Every import binding in the source, as `{ local, imported, specifier, typeOnly }`. */
function importBindings(sf) {
  const out = []
  walk(sf, (node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return
    const specifier = node.moduleSpecifier.text
    const clause = node.importClause
    if (!clause) return
    const declTypeOnly = Boolean(clause.isTypeOnly)
    if (clause.name) out.push({ local: clause.name.text, imported: "default", specifier, typeOnly: declTypeOnly })
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        out.push({
          local: el.name.text,
          imported: el.propertyName ? el.propertyName.text : el.name.text,
          specifier,
          typeOnly: declTypeOnly || Boolean(el.isTypeOnly),
        })
      }
    }
  })
  return out
}

/** SIDE C's import half, as a function so §4 can run it over an impostor's text. `null` = satisfied. */
function whyNotImportingTheRuntimeRenderer(sf) {
  const bound = importBindings(sf).filter((b) => b.local === "ScreenRenderer")
  if (bound.length === 0) return 'nothing in this file imports a binding named "ScreenRenderer"'
  if (bound.length > 1) return `${bound.length} imports bind the name "ScreenRenderer"`
  const [b] = bound
  if (b.typeOnly) return '"ScreenRenderer" is imported as a TYPE — a type cannot be mounted'
  if (b.imported !== "ScreenRenderer") {
    return `"ScreenRenderer" is an ALIAS of "${b.imported}" from "${b.specifier}" — the local name says runtime renderer, the import does not`
  }
  const normalized = normalizeSpecifier(b.specifier)
  if (normalized !== "hmi-runtime/ScreenRenderer") {
    return `"ScreenRenderer" is imported from "${b.specifier}" (normalised "${normalized}"), not hmi-runtime/ScreenRenderer`
  }
  return null
}

// ── the corpus ───────────────────────────────────────────────────────────────────────────────────

const SRC_FILES = listSources(SRC)
const PARSED = new Map(SRC_FILES.map((rel) => [rel, parse(rel, readSource(absOf(rel)))]))

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §0 — THE FLOOR. A collector that quietly finds nothing makes every uniqueness claim below pass
// vacuously, which is this tree's signature defect. These run first.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("floor: the census reads real sources and names the files this pin is about", () => {
  assert.ok(SRC_FILES.length > 20, `listSources(src) found ${SRC_FILES.length} files — the census is broken`)
  for (const rel of [RENDERER_REL, CANVAS_REL, ROUTE_REL]) {
    assert.ok(SRC_FILES.includes(rel), `the census does not contain ${rel} — it moved, or the walk is broken`)
  }
  assert.ok(listSources(EDITOR_DIR).length > 0, "src/editor/ holds no .ts/.tsx files — SIDE C would scan nothing")
})

test("floor: the three collectors find what they exist to find, and do NOT find what must stay legal", () => {
  const probe = parse(
    "floor-probe.tsx",
    [
      'const WIDGET_HOOK = "data-hmi-widget"',
      "const hook = (id) => ({ [WIDGET_HOOK]: id })",
      "export function P({ doc, source }) {",
      "  const cell = root.querySelector(`[data-hmi-widget-error=\"${id}\"]`)",
      "  const registry = widgetRegistry",
      "  const alias = registry",
      "  const W = alias[kind]",
      "  return (",
      "    <div data-hmi-screen ={doc.screenId} {...hook(id)}>",
      "      <ScreenRenderer doc={doc} source={source} />",
      "      <DesignRenderer doc={doc} source={source} />",
      "    </div>",
      "  )",
      "}",
    ].join("\n")
  )
  // (a) a JSX attribute name with a space before `=` is still the attribute name — the exact variant
  //     that defeated round 1. (b) a whole-value string literal is a naming. Both must be found.
  assert.deepEqual(
    hooksNamedBy(probe),
    ["data-hmi-screen", "data-hmi-widget"],
    "hooksNamedBy missed the spaced JSX attribute or the string-literal constant — SIDE A would be blind"
  )
  // ...and the value-qualified SELECTOR (`data-hmi-widget-error` inside a template with a
  // substitution) is deliberately NOT a naming. If this ever starts being collected, Task 9's
  // selection layer becomes unwritable and the pin gets deleted by whoever hits it.
  assert.ok(
    !hooksNamedBy(probe).includes("data-hmi-widget-error"),
    "hooksNamedBy collected a value-qualified CSS selector — reading a rendered cell must stay legal"
  )
  assert.ok(dispatchesRegistry(probe), "dispatchesRegistry missed a two-hop local alias — SIDE B would be blind")
  assert.deepEqual(
    screenRendererShapedMounts(probe).sort(),
    ["DesignRenderer", "ScreenRenderer"],
    "screenRendererShapedMounts missed a doc+source element — SIDE C would be blind to impostor C's dead branch"
  )
})

test("floor: the collectors find the REAL renderer — hooks named, registry dispatched", () => {
  const sf = PARSED.get(RENDERER_REL)
  assert.deepEqual(
    hooksNamedBy(sf),
    [...RENDERER_DOM_HOOKS].sort(),
    `${RENDERER_REL} does not name all three DOM hooks. Either the renderer stopped attaching a hook every ` +
      `locator in tests/37-editor-canvas.spec.ts depends on, or SIDE A's collector has gone blind and its ` +
      `uniqueness claim would pass while measuring nothing.`
  )
  assert.ok(
    dispatchesRegistry(sf),
    `${RENDERER_REL} does not dispatch ${REGISTRY_NAME} by element access — SIDE B's subject has moved, or its ` +
      `collector has gone blind.`
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §1 — SIDE A: one author of the renderer's DOM hooks, client-wide.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("SIDE A: exactly one file in web/src names a renderer DOM hook, and it is ScreenRenderer.tsx", () => {
  const offenders = SRC_FILES.filter((rel) => hooksNamedBy(PARSED.get(rel)).length > 0).sort()
  assert.deepEqual(
    offenders,
    [RENDERER_REL],
    `files naming a renderer DOM hook: ${offenders.join(", ") || "(none)"} — expected only ${RENDERER_REL}. ` +
      `"Naming" means a JSX attribute name or a whole-value string literal, i.e. the two ways the attribute ` +
      `can reach the DOM; a value-qualified selector does not count. More than one author means a second ` +
      `renderer or a fork exists somewhere in the client — that is how the editor and the kiosk start drawing ` +
      `different screens. Zero means the collector or the renderer changed and this claim now measures nothing.`
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §2 — SIDE B: one dispatcher of the widget registry, client-wide.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("SIDE B: exactly one file in web/src dispatches widgetRegistry, and it is ScreenRenderer.tsx", () => {
  const offenders = SRC_FILES.filter((rel) => dispatchesRegistry(PARSED.get(rel))).sort()
  assert.deepEqual(
    offenders,
    [RENDERER_REL],
    `files dispatching ${REGISTRY_NAME} by element access: ${offenders.join(", ") || "(none)"} — expected only ` +
      `${RENDERER_REL}. Local aliases are resolved, so renaming the variable does not help. READING the ` +
      `registry's keys is untouched and always was: Object.keys/in/iteration is what Task 11's add-widget menu ` +
      `is required to do instead of hand-writing a list.`
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §3 — SIDE C: the editor's own mount. HYGIENE — see the header for what it cannot tell.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("SIDE C: every doc+source mount under src/editor is <ScreenRenderer>, and EditorCanvas.tsx has one", () => {
  const wrong = []
  let canvasMounts = 0
  for (const rel of listSources(EDITOR_DIR)) {
    for (const tag of screenRendererShapedMounts(PARSED.get(rel))) {
      if (tag !== "ScreenRenderer") wrong.push(`${rel}: <${tag} doc source/>`)
      else if (rel === CANVAS_REL) canvasMounts += 1
    }
  }
  assert.deepEqual(
    wrong,
    [],
    `these elements under src/editor/ are mounted with a screen document and a value source but are not the ` +
      `runtime renderer:\n  ${wrong.join("\n  ")}\nThis is the shape impostor C used: a real ` +
      `<ScreenRenderer doc source/> kept in a branch that never runs, beside the second renderer that actually ` +
      `draws. Rendering <ScreenRenderer> more than once is fine (Task 12's breakpoint preview will); rendering ` +
      `something ELSE with a document and a source is not.`
  )
  assert.ok(canvasMounts > 0, `${CANVAS_REL} mounts no <ScreenRenderer doc source/> at all`)
})

test("SIDE C: EditorCanvas.tsx imports ScreenRenderer unaliased from hmi-runtime, and the route draws through the canvas", () => {
  const why = whyNotImportingTheRuntimeRenderer(PARSED.get(CANVAS_REL))
  assert.equal(why, null, `src/editor/EditorCanvas.tsx does not import the RUNTIME renderer: ${why}`)

  const route = PARSED.get(ROUTE_REL)
  const canvasImport = importBindings(route).find((b) => b.local === "EditorCanvas")
  assert.ok(canvasImport, "EditorRoute.tsx does not import EditorCanvas")
  assert.equal(
    normalizeSpecifier(canvasImport.specifier),
    "EditorCanvas",
    `EditorRoute.tsx imports EditorCanvas from "${canvasImport.specifier}" — not the sibling module`
  )
  let mounted = false
  walk(route, (node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(route) === "EditorCanvas") {
      mounted = true
    }
  })
  assert.ok(mounted, "EditorRoute.tsx imports EditorCanvas but never mounts it")
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §4 — THE IMPOSTORS AND THE FUTURE TASKS, both replayed through the collectors above.
//
// Nothing here enumerates an allowlist, a marker list or an expected import set. That is deliberate:
// round 1's §4 asserted the exact set of forbidden imports, so the legitimate allowlist extension the
// file itself forecast for Task 11 would have turned the file's own honesty device red — and the
// cheapest repair for the next author would have been to edit the expectation. These probes assert
// only against the AST rules, which enumerate nothing, so a future task cannot break them by doing
// something legitimate.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Impostors A2 and C share one renderer: registry dispatched, hooks attached, degrade wording copied.
 * C's refinements are the hook HELPER (a whole-value string constant, spread at the call site) and
 * living outside `src/editor/` — neither of which SIDE A or SIDE B care about. */
const IMPOSTOR_RENDERER = `
const SCREEN_HOOK = "data-hmi-screen"
const WIDGET_HOOK = "data-hmi-widget"
const ERROR_HOOK = "data-hmi-widget-error"
export const screenHook = (id) => ({ [SCREEN_HOOK]: id })
export const widgetHook = (id) => ({ [WIDGET_HOOK]: id })
export const widgetErrorHook = (id) => ({ [ERROR_HOOK]: id })

export function DesignRenderer({ doc, source }) {
  const registry = widgetRegistry
  return (
    <div {...screenHook(doc.screenId)} data-theme={doc.theme}>
      {doc.widgets.map((widget) => {
        const Widget = registry[widget.kind]
        if (!Widget) return <div {...widgetErrorHook(widget.id)} role="alert">unknown widget kind "{widget.kind}"</div>
        return (
          <div {...widgetHook(widget.id)}>
            <Widget widget={widget} source={source} resolve={(b) => resolveBinding(b, undefined)} />
          </div>
        )
      })}
    </div>
  )
}
`

/** Impostor C's canvas: the REAL renderer imported unaliased and really mounted — in a branch that
 * never runs — beside the second renderer that actually draws. */
const IMPOSTOR_C_CANVAS = `
import { ScreenRenderer } from "@/hmi-runtime/ScreenRenderer"
import { DesignRenderer } from "@/canvas/DesignRenderer"

const CANVAS_MODE = "design"

export function EditorCanvas({ doc }) {
  return CANVAS_MODE === "preview" ? (
    <ScreenRenderer doc={doc} source={DESIGN_TIME_SOURCE} />
  ) : (
    <DesignRenderer doc={doc} source={DESIGN_TIME_SOURCE} />
  )
}
`

/** The one-space variant that turned round 1's SIDE 3 green again. */
const ONE_SPACE_VARIANT = `
export function DesignRenderer({ doc, source }) {
  return <div data-hmi-screen ={doc.screenId} data-hmi-widget ={"x"} data-hmi-widget-error ={"y"} />
}
`

/** Impostor B's wiring: the canvas re-pointed at a local fork, the local NAME preserved. */
const IMPOSTOR_B_CANVAS = `
import { ForkedEditorScreenRenderer as ScreenRenderer } from "./ForkedScreenRenderer"
export function EditorCanvas({ doc }) {
  return <ScreenRenderer doc={doc} source={DESIGN_TIME_SOURCE} />
}
`

/**
 * WS-HMI-2 Task 9's selection/drag layer, written the ordinary way — a value-qualified selector to
 * find the rendered cell, and a ghost overlay that positions itself on the same grid. It emits no
 * hook and dispatches nothing. **This is asserted to PASS**, permanently, because a pin the next task
 * must loosen is a pin that gets loosened at the worst possible moment. Round 1 forbade both of these
 * lines and told the author it was because "a fork or a second renderer exists".
 */
const TASK_9_DRAG_LAYER = `
export function selectedWidgetRect(root, widgetId) {
  const cell = root.querySelector(\`[data-hmi-widget="\${widgetId}"]\`)
  return cell ? cell.getBoundingClientRect() : undefined
}
export function DragGhost({ rect }) {
  const style = { gridColumn: \`\${rect.col + 1} / span \${rect.colSpan}\`, gridRow: \`\${rect.row + 1} / span \${rect.rowSpan}\` }
  return <div className="pointer-events-none" style={style} />
}
`

/**
 * WS-HMI-2 Task 11's add-widget palette: the kind list read from the registry rather than hand-written,
 * which is what its brief REQUIRES. It reads keys; it does not dispatch. **Asserted to PASS.**
 */
const TASK_11_PALETTE = `
import { widgetRegistry } from "@/hmi-runtime/widgetRegistry"
export function WidgetPalette({ onAdd }) {
  return (
    <ul>
      {Object.keys(widgetRegistry).map((kind) => (
        <li key={kind}><button onClick={() => onAdd(kind)}>{kind}</button></li>
      ))}
    </ul>
  )
}
`

test("§4: the pin rejects the impostor renderer — hook helper and aliased dispatch, wherever it lives", () => {
  const sf = parse("canvas/DesignRenderer.tsx", IMPOSTOR_RENDERER)
  assert.deepEqual(
    hooksNamedBy(sf),
    [...RENDERER_DOM_HOOKS].sort(),
    "SIDE A did not see the hook HELPER — this is impostor C's blinding move and it must not come back"
  )
  assert.ok(dispatchesRegistry(sf), "SIDE B did not see the aliased registry dispatch")
})

test("§4: the pin rejects the one-space variant that defeated round 1", () => {
  assert.deepEqual(
    hooksNamedBy(parse("canvas/Spaced.tsx", ONE_SPACE_VARIANT)),
    [...RENDERER_DOM_HOOKS].sort(),
    "SIDE A is spelling-sensitive again — `data-hmi-screen ={x}` is the same attribute to the parser"
  )
})

test("§4: the pin rejects impostor C's dead-branch canvas", () => {
  const sf = parse(CANVAS_REL, IMPOSTOR_C_CANVAS)
  // SIDE C's import half is SATISFIED — the real renderer really is imported unaliased. That is the
  // whole trick, and it is why SIDE C is described as hygiene rather than identity.
  assert.equal(
    whyNotImportingTheRuntimeRenderer(sf),
    null,
    "the probe no longer reproduces impostor C: its import really was legitimate"
  )
  // The mount shape is what catches it.
  assert.ok(
    screenRendererShapedMounts(sf).includes("DesignRenderer"),
    "SIDE C did not see a second doc+source mount beside the real one"
  )
})

test("§4: the pin rejects a verbatim fork of ScreenRenderer.tsx, wherever it is placed", () => {
  // The probe IS the real renderer's source, read from disk, so it cannot drift from what it stands for.
  const forked = parse("canvas/ForkedScreenRenderer.tsx", readSource(absOf(RENDERER_REL)))
  assert.deepEqual(
    hooksNamedBy(forked),
    [...RENDERER_DOM_HOOKS].sort(),
    "SIDE A would not see a byte-for-byte fork of the renderer"
  )
  assert.ok(dispatchesRegistry(forked), "SIDE B would not see a byte-for-byte fork of the renderer")
  // ...and the canvas re-pointed at it, with the local name preserved.
  const why = whyNotImportingTheRuntimeRenderer(parse(CANVAS_REL, IMPOSTOR_B_CANVAS))
  assert.match(why ?? "", /ALIAS/, `SIDE C accepted a canvas re-pointed at a local fork under an alias: ${why}`)
})

test("§4: the pin ACCEPTS Task 9's drag layer — a value-qualified selector and a ghost overlay", () => {
  const sf = parse("editor/dragLayer.tsx", TASK_9_DRAG_LAYER)
  assert.deepEqual(
    hooksNamedBy(sf),
    [],
    "SIDE A rejected a selection layer that only READS a rendered cell. Round 1 did exactly this and told the " +
      "author a fork existed; if this ever goes red again, fix the rule, not the drag layer."
  )
  assert.equal(dispatchesRegistry(sf), false, "SIDE B rejected a drag layer that touches no registry")
  assert.deepEqual(screenRendererShapedMounts(sf), [], "SIDE C rejected a ghost overlay that renders no document")
})

test("§4: the pin ACCEPTS Task 11's palette — the kind list read from the registry, not dispatched", () => {
  const sf = parse("editor/WidgetPalette.tsx", TASK_11_PALETTE)
  assert.equal(
    dispatchesRegistry(sf),
    false,
    "SIDE B rejected a palette that only reads Object.keys(widgetRegistry) — listing is not dispatching, and " +
      "Task 11's brief REQUIRES the list to come from the registry"
  )
  assert.deepEqual(hooksNamedBy(sf), [], "SIDE A rejected a palette that names no hook")
})
