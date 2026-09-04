// Run: npm run test:runtime   (node --test, no extra package)
//
// WS-HMI-2 Task 8, fix round 1 — task-8-review.md finding 1/4 (HIGH/MED).
//
// ── WHY THIS FILE EXISTS: THREE IMPOSTORS THAT PASSED THE BROWSER SPEC ───────────────────────────
// `tests/37-editor-canvas.spec.ts` measures, in a real browser, that the editor's canvas dispatches
// through `widgetRegistry`, honours the binding seam, computes 1-based grid lines from a 0-based
// rect, and degrades the way `ScreenRenderer` degrades. Every one of those is a property of the
// RUNTIME'S BEHAVIOUR — and every one of them is reproducible by something that is not
// `ScreenRenderer`. The reviewer measured it rather than argued it:
//
//   * IMPOSTOR A — ~110 lines in `EditorCanvas.tsx` that never import `ScreenRenderer`: their own CSS
//     grid, their own error-boundary class, their own placeholder, `widgetRegistry[widget.kind]`
//     dispatched directly, `resolveBinding(b, undefined)` for the seam. It failed ONE assertion, on a
//     STRING COMPARISON of the degrade wording. Assertions 1, 2 and 5 — `props.text` on screen, the
//     `.hmi-readout-value` row reading `128.0` then `128.0rpm`, and the grid arithmetic on both axes
//     before AND after the edit — all passed.
//   * IMPOSTOR A2 — the same second renderer with the two degrade sentences copied. Two one-line
//     edits, which is exactly what an implementer told "degrade the way the runtime does" writes.
//     **All three tests green. No `ScreenRenderer` anywhere in that render path.**
//   * IMPOSTOR B — `ScreenRenderer.tsx` copied byte-for-byte into `src/editor/`, the export renamed,
//     `EditorCanvas` re-pointed at the copy, `clampRectToLayout` DELETED and `gap-2` changed to
//     `gap-6`. A canvas that provably lays screens out differently from the kiosk. **All three tests
//     green.**
//
// **No browser assertion can catch impostor B.** A fork renders correctly by construction until it
// drifts, and the drift is invisible to any test that only reads the DOM the fork produces. The
// failure mode is concrete and imminent: Task 9 adds selection and drag, the obvious move is to copy
// the renderer into `src/editor/` and add handles to the copy, and from that commit the editor and
// the runtime diverge silently while this suite stays green. What you design stops being what runs,
// and nothing says so.
//
// ── WHAT THIS FILE PINS, AND WHY IT IS TWO-SIDED ─────────────────────────────────────────────────
// A ONE-SIDED source-text pin ("`EditorCanvas.tsx` contains the string `ScreenRenderer`") is worth
// nothing: it passes against a file that imports the renderer and then draws its own boxes anyway.
// That objection is real and it is why the round-0 report refused to write one. It does not reach a
// TWO-SIDED pin, which is the shape this repository already writes for exactly this situation —
// `runtime-tests/screenRendererComponents.test.mjs` §(2) ("SOURCE TEXT … they are cheap and … they
// name the specific line a revert would delete") and `runtime-tests/hmiWiring.test.mjs`.
//
//   SIDE 1 (positive) — `EditorCanvas.tsx` imports the binding `ScreenRenderer`, unaliased, from
//   `hmi-runtime/ScreenRenderer` specifically, and mounts it with `doc` and `source`. Re-pointing the
//   import at a local fork reddens even when the local NAME is still `ScreenRenderer`.
//
//   SIDE 2 (negative) — nothing under `src/editor/` declares any of the renderer's own internals, and
//   `src/editor/` imports nothing from `hmi-runtime/` outside a named allowlist.
//
//   SIDE 3 (uniqueness, the one that actually kills a fork) — the three DOM hooks a screen renderer
//   MUST emit (`data-hmi-screen=`, `data-hmi-widget=`, `data-hmi-widget-error=`) appear in EXACTLY
//   ONE file in `web/src/`, and it is `hmi-runtime/ScreenRenderer.tsx`. A fork anywhere in the client
//   emits them by definition and reddens here.
//
// ── THE COMPOSITION ARGUMENT, WHICH IS THE HONEST FORM OF THE CLAIM ──────────────────────────────
// Neither this file nor `tests/37-editor-canvas.spec.ts` pins the identity on its own, and this file
// does not claim otherwise. TOGETHER they close it, and the closure is a genuine pincer rather than a
// hopeful sum:
//
//   * The browser spec REQUIRES the canvas to emit `data-hmi-screen` / `data-hmi-widget` /
//     `data-hmi-widget-error` — every one of its locators is built on them.
//   * SIDE 3 REQUIRES that only `ScreenRenderer.tsx` emits them.
//
// So an impostor that renames the hooks to slip past SIDE 3 fails the browser spec, and an impostor
// that keeps them to pass the browser spec fails SIDE 3. Impostors A, A2 and B all take the second
// horn. That is the whole argument, and it is why SIDE 3 is worded as a UNIQUENESS claim over the
// whole of `web/src/` rather than as a prohibition scoped to `src/editor/`.
//
// ── WHAT THIS FILE DOES NOT MEASURE, STATED PLAINLY ──────────────────────────────────────────────
// It is a source-text pin and it can be defeated, the same way `hmiWiring.test.mjs` says of itself:
//   1. It reads text, never behaviour. That `<ScreenRenderer>` is mounted is not proof that anything
//      RENDERS — `tests/37-editor-canvas.spec.ts` owns that half, and neither half is redundant.
//   2. Its scope is `web/src/**`. A renderer placed outside `src/` and imported relatively would
//      evade SIDE 3. Nothing in this client lives outside `src/` (`tsconfig.app.json`'s
//      `include: ["src"]`, and `@/*` maps to `./src/*`), but the limit is real and is stated rather
//      than assumed away.
//   3. The allowlists in SIDE 2 are lists, and a list can be extended in one line. That is deliberate:
//      the point is that extending it is VISIBLE in the diff and lands in front of a reviewer with
//      this file's own failure message explaining what the rule protects. Task 11's "the add-widget
//      menu lists kinds from the registry, not a hand-written list" will legitimately need
//      `widgetRegistry` in `EDITOR_HMI_RUNTIME_IMPORT_ALLOWLIST` — adding it is correct, and the
//      `widgetRegistry[` marker in SIDE 2 keeps the DISPATCH LOOP forbidden regardless.
//   4. Comments are stripped before every scan (see `stripComments`), so a doc comment may name any
//      of these markers freely — `editorState.ts` already names `clampRectToLayout` in prose. A pin
//      that reddened on prose would be uneditable.
//
// ── THE FLOOR ────────────────────────────────────────────────────────────────────────────────────
// This tree's signature defect is an extraction that quietly reads nothing and passes vacuously —
// found six separate times in this workstream. Four devices guard against it here, all of them
// executable rather than asserted:
//   * `stripComments` is proven on a synthetic source to delete a marker that sits in a comment and
//     to KEEP the same marker when it sits in code;
//   * every marker in `RENDERER_INTERNAL_MARKERS` is asserted PRESENT in `ScreenRenderer.tsx`'s own
//     comment-stripped source, so the forbidden list cannot silently become a set of strings that
//     match nothing anywhere;
//   * the file census is asserted non-empty and to contain the files by name;
//   * §4 replays the reviewer's own impostors THROUGH THIS FILE'S OWN SCANNERS and asserts they are
//     rejected — impostor B's probe is the REAL `ScreenRenderer.tsx` bytes read from disk, so it
//     cannot drift away from the thing it stands for.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..")
const SRC = join(WEB, "src")
const EDITOR_DIR = join(SRC, "editor")
const RENDERER_REL = "hmi-runtime/ScreenRenderer.tsx"
const RENDERER_ABS = join(SRC, "hmi-runtime", "ScreenRenderer.tsx")
const CANVAS_ABS = join(EDITOR_DIR, "EditorCanvas.tsx")
const ROUTE_ABS = join(EDITOR_DIR, "EditorRoute.tsx")

// `check-test-budgets.mjs` already resolves the workspace's own `typescript` this way; same device,
// same reason. The scanner is used ONLY to locate comment trivia exactly — see `stripComments`.
const ts = createRequire(join(WEB, "package.json"))("typescript")

/** 🔴 CRLF — the same note every source-text pin in this tree carries: `core.autocrlf=true` with no
 * `.gitattributes`, so a fresh checkout holds `\r\n` while every pattern below hard-codes `\n`. */
function readSource(abs) {
  return readFileSync(abs, "utf8").replace(/\r\n/g, "\n")
}

/**
 * Blanks every comment in `text`, preserving length, line structure and every other character — so a
 * marker that appears in prose is invisible to the scanners below while a marker in code is not, and
 * so an offence can still be reported at a recognisable place.
 *
 * Uses TypeScript's own scanner rather than a hand-rolled stripper because the alternative has to get
 * string literals, template literals and regex literals right to avoid blanking real code, and a
 * stripper that blanks too much makes THIS pin more permissive — the exact direction a floor must not
 * fail in. The synthetic probe in §0 is what proves it strips the right thing.
 */
function stripComments(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ false, ts.LanguageVariant.JSX, text)
  const out = text.split("")
  let token = scanner.scan()
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const start = scanner.getTokenStart()
      const end = scanner.getTokenEnd()
      for (let i = start; i < end; i++) if (out[i] !== "\n") out[i] = " "
    }
    token = scanner.scan()
  }
  return out.join("")
}

/** Every `.ts`/`.tsx` under `dir`, recursively, as paths relative to `SRC` with `/` separators. */
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

/**
 * The renderer's own internals, as literal source markers. Each one is asserted PRESENT in
 * `ScreenRenderer.tsx` by §0's floor, which is what makes this a list of "things only a screen
 * renderer writes" rather than a list of arbitrary strings.
 *
 * The three DOM hooks are written with their trailing `=` on purpose, and the distinction is
 * load-bearing for Task 9: `data-hmi-widget=` is EMITTING the attribute (you are the renderer);
 * `data-hmi-widget]` is READING it (you are a layer above the renderer, which is exactly what a
 * selection/drag layer is, and it stays legal here).
 */
const RENDERER_INTERNAL_MARKERS = [
  "data-hmi-screen=",
  "data-hmi-widget=",
  "data-hmi-widget-error=",
  "widgetRegistry[",
  "gridTemplateColumns",
  "gridTemplateRows",
  "gridColumn:",
  "gridRow:",
  "getDerivedStateFromError",
  "componentDidCatch",
  "clampRectToLayout",
  "componentTagPrefixOf",
  "unresolvedComponentBindingWarning",
  "resolveBinding",
]

/** The three hooks whose AUTHORSHIP is claimed to be unique across the whole client — SIDE 3. */
const RENDERER_DOM_HOOKS = ["data-hmi-screen=", "data-hmi-widget=", "data-hmi-widget-error="]

/**
 * The only `hmi-runtime` modules `src/editor/` may import. See limit 3 in the header for why this is
 * a list and why extending it is the intended, visible act rather than a loophole.
 */
const EDITOR_HMI_RUNTIME_IMPORT_ALLOWLIST = ["hmi-runtime/ScreenRenderer", "hmi-runtime/TagValueSource"]

/** `@/x/y` · `../x/y` · `./y` → `x/y`, with any `.ts`/`.tsx` suffix removed. */
function normalizeSpecifier(spec) {
  return spec
    .replace(/^@\//, "")
    .replace(/^(?:\.\.\/)+/, "")
    .replace(/^\.\//, "")
    .replace(/\.tsx?$/, "")
}

/** Every `import … from "…"` in `source` (already comment-stripped), as `{ specifier, clause, typeOnly }`. */
function importDeclarations(source) {
  const out = []
  const re = /^import\s+(type\s+)?([^;]*?)\s+from\s+"([^"]+)"/gm
  let m
  while ((m = re.exec(source)) !== null) {
    out.push({ typeOnly: Boolean(m[1]), clause: m[2].trim(), specifier: m[3] })
  }
  return out
}

/**
 * Every local binding an import clause introduces, as `{ local, imported, typeOnly }`. Handles the
 * default form, the named form, and `A as B` — the alias case is the one that matters: an impostor
 * writing `import { ForkedEditorScreenRenderer as ScreenRenderer } from "./ForkedScreenRenderer"`
 * still mounts `<ScreenRenderer>`, so a check on the JSX tag name alone would see nothing wrong.
 */
function importBindings(decl) {
  const bindings = []
  const named = /\{([^}]*)\}/.exec(decl.clause)
  const defaultName = decl.clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim()
  if (defaultName) bindings.push({ local: defaultName, imported: "default", typeOnly: decl.typeOnly })
  if (named) {
    for (const raw of named[1].split(",")) {
      const entry = raw.trim()
      if (!entry) continue
      const entryTypeOnly = decl.typeOnly || /^type\s/.test(entry)
      const body = entry.replace(/^type\s+/, "")
      const alias = /^(\S+)\s+as\s+(\S+)$/.exec(body)
      if (alias) bindings.push({ local: alias[2], imported: alias[1], typeOnly: entryTypeOnly })
      else bindings.push({ local: body, imported: body, typeOnly: entryTypeOnly })
    }
  }
  return bindings
}

/** The markers `source` (comment-stripped) contains, in declaration order. Empty means clean. */
function markerOffences(source) {
  return RENDERER_INTERNAL_MARKERS.filter((marker) => source.includes(marker))
}

/**
 * SIDE 1, as a reusable function so §4 can run it against an impostor's source text without the
 * impostor ever existing on disk. Returns `null` when the source satisfies the rule, or a sentence
 * naming what is wrong.
 */
function whyNotMountingTheRuntimeRenderer(source) {
  const decls = importDeclarations(source)
  const bound = []
  for (const decl of decls) {
    for (const binding of importBindings(decl)) {
      if (binding.local === "ScreenRenderer") bound.push({ decl, binding })
    }
  }
  if (bound.length === 0) return 'nothing in this file imports a binding named "ScreenRenderer"'
  if (bound.length > 1) {
    return `${bound.length} imports bind the name "ScreenRenderer" (${bound
      .map((b) => `"${b.decl.specifier}"`)
      .join(", ")}) — which one <ScreenRenderer> refers to is not readable from the text`
  }
  const { decl, binding } = bound[0]
  if (binding.typeOnly) return `"ScreenRenderer" is imported as a TYPE — a type cannot be mounted`
  if (binding.imported !== "ScreenRenderer") {
    return `"ScreenRenderer" is an ALIAS of "${binding.imported}" from "${decl.specifier}" — the local name says runtime renderer, the import does not`
  }
  const normalized = normalizeSpecifier(decl.specifier)
  if (normalized !== "hmi-runtime/ScreenRenderer") {
    return `"ScreenRenderer" is imported from "${decl.specifier}" (normalised: "${normalized}"), not from hmi-runtime/ScreenRenderer`
  }
  const mount = /<ScreenRenderer\b([^>]*)\/>/.exec(source)
  if (!mount) return "<ScreenRenderer … /> is imported but never mounted"
  const attrs = mount[1]
  for (const required of ["doc=", "source="]) {
    if (!attrs.includes(required)) return `<ScreenRenderer …/> is mounted without \`${required}\``
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §0 — THE FLOOR. Everything below is worthless if these fail, so they run first and fail loudly.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const SRC_FILES = listSources(SRC)
const RENDERER_SRC = stripComments(readSource(RENDERER_ABS))

test("floor: the file census reads real sources, and names the three files this pin is about", () => {
  assert.ok(
    SRC_FILES.length > 20,
    `listSources(src) found ${SRC_FILES.length} files — the census is broken and every scan below would iterate nothing`
  )
  for (const rel of [RENDERER_REL, "editor/EditorCanvas.tsx", "editor/EditorRoute.tsx"]) {
    assert.ok(SRC_FILES.includes(rel), `the census does not contain ${rel} — either it moved, or the walk is broken`)
  }
  assert.ok(existsSync(EDITOR_DIR), "src/editor/ does not exist")
  assert.ok(listSources(EDITOR_DIR).length > 0, "src/editor/ holds no .ts/.tsx files — SIDE 2 would scan nothing")
})

test("floor: stripComments deletes a marker in prose and keeps the same marker in code", () => {
  const probe = [
    "// a comment naming data-hmi-screen= and widgetRegistry[",
    "/* a block comment naming getDerivedStateFromError */",
    'const a = "data-hmi-screen=" /* trailing */',
    "const b = widgetRegistry[kind]",
  ].join("\n")
  const stripped = stripComments(probe)
  assert.equal(stripped.length, probe.length, "stripComments must preserve length so offences stay locatable")
  assert.ok(!stripped.includes("a comment naming"), "the line comment survived stripping")
  assert.ok(!stripped.includes("getDerivedStateFromError"), "the block comment's marker survived stripping")
  assert.ok(stripped.includes('"data-hmi-screen="'), "a marker inside a STRING was wrongly stripped")
  assert.ok(stripped.includes("widgetRegistry[kind]"), "a marker in real CODE was wrongly stripped")
})

test("floor: every forbidden marker is a real marker of the runtime renderer", () => {
  assert.ok(RENDERER_SRC.trim().length > 0, "ScreenRenderer.tsx stripped to nothing — the stripper is broken")
  const missing = RENDERER_INTERNAL_MARKERS.filter((marker) => !RENDERER_SRC.includes(marker))
  assert.deepEqual(
    missing,
    [],
    `these markers do not appear in ${RENDERER_REL}'s own code: ${missing.join(", ")}. A forbidden marker ` +
      `that the renderer itself does not write is not evidence of a second renderer — it is a string that ` +
      `matches nothing, and it would make SIDE 2 pass vacuously. Either the renderer changed (re-derive ` +
      `the list from it) or the list drifted.`
  )
})

test("floor: every allowlisted hmi-runtime import names a module that exists", () => {
  for (const allowed of EDITOR_HMI_RUNTIME_IMPORT_ALLOWLIST) {
    const base = join(SRC, ...allowed.split("/"))
    assert.ok(
      existsSync(`${base}.ts`) || existsSync(`${base}.tsx`),
      `the allowlist names "${allowed}", which is not a file under src/ — the allowlist has drifted from the tree`
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §1 — SIDE 3: ONE renderer in this client.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("SIDE 3: the renderer's three DOM hooks are emitted by exactly one file in web/src, and it is ScreenRenderer.tsx", () => {
  for (const hook of RENDERER_DOM_HOOKS) {
    const emitters = SRC_FILES.filter((rel) => stripComments(readSource(join(SRC, ...rel.split("/")))).includes(hook))
    assert.deepEqual(
      emitters,
      [RENDERER_REL],
      `\`${hook}\` is emitted by ${emitters.length} file(s): ${emitters.join(", ") || "(none)"}. Exactly one ` +
        `file in this client may write a screen renderer's DOM hooks. More than one means a fork or a second ` +
        `renderer exists — that is how the editor and the kiosk start drawing different screens. Zero means ` +
        `the renderer stopped emitting a hook every locator in tests/37-editor-canvas.spec.ts depends on.`
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §2 — SIDE 1: the canvas mounts the runtime renderer, and the route mounts the canvas.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("SIDE 1: EditorCanvas.tsx imports ScreenRenderer unaliased from hmi-runtime and mounts it with doc + source", () => {
  const why = whyNotMountingTheRuntimeRenderer(stripComments(readSource(CANVAS_ABS)))
  assert.equal(
    why,
    null,
    `src/editor/EditorCanvas.tsx no longer mounts the RUNTIME renderer: ${why}. The whole point of this task ` +
      `is that the editor's canvas and the kiosk's canvas are the same component — see this file's header ` +
      `for the three impostors that pass the browser spec without it.`
  )
})

test("SIDE 1: EditorRoute.tsx draws through EditorCanvas rather than around it", () => {
  const src = stripComments(readSource(ROUTE_ABS))
  const decl = importDeclarations(src).find((d) => importBindings(d).some((b) => b.local === "EditorCanvas"))
  assert.ok(decl, "EditorRoute.tsx does not import EditorCanvas")
  assert.equal(
    normalizeSpecifier(decl.specifier),
    "EditorCanvas",
    `EditorRoute.tsx imports EditorCanvas from "${decl.specifier}" — not the sibling module`
  )
  assert.match(src, /<EditorCanvas\b/, "EditorRoute.tsx imports EditorCanvas but never mounts it")
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §3 — SIDE 2: nothing under src/editor/ re-implements the renderer.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("SIDE 2: no file under src/editor/ declares the renderer's own internals", () => {
  const offences = []
  for (const rel of listSources(EDITOR_DIR)) {
    const found = markerOffences(stripComments(readSource(join(SRC, ...rel.split("/")))))
    if (found.length > 0) offences.push(`${rel}: ${found.join(", ")}`)
  }
  assert.deepEqual(
    offences,
    [],
    `these files under src/editor/ write what only hmi-runtime/ScreenRenderer.tsx may write:\n  ${offences.join(
      "\n  "
    )}\nA widget-dispatch loop, grid-line arithmetic or an error boundary of the editor's own is a SECOND ` +
      `renderer, whether it was typed fresh or copied. Note the deliberate distinction: reading a rendered ` +
      `cell (\`[data-hmi-widget]\` as a SELECTOR, which is what a selection/drag layer does) is legal here; ` +
      `EMITTING the attribute is not. Comments are stripped before this scan, so prose may name any of these.`
  )
})

test("SIDE 2: src/editor/ imports nothing from hmi-runtime outside the allowlist", () => {
  const offences = []
  for (const rel of listSources(EDITOR_DIR)) {
    for (const decl of importDeclarations(stripComments(readSource(join(SRC, ...rel.split("/")))))) {
      const normalized = normalizeSpecifier(decl.specifier)
      if (!normalized.startsWith("hmi-runtime/")) continue
      if (!EDITOR_HMI_RUNTIME_IMPORT_ALLOWLIST.includes(normalized)) offences.push(`${rel} → "${decl.specifier}"`)
    }
  }
  assert.deepEqual(
    offences,
    [],
    `these imports reach into the runtime renderer's own parts:\n  ${offences.join("\n  ")}\nThe allowed set is ` +
      `${EDITOR_HMI_RUNTIME_IMPORT_ALLOWLIST.join(", ")}. Pulling in widgetRegistry, gridLayout or bindings is ` +
      `how a second renderer gets assembled out of the runtime's pieces while looking like reuse. If a later ` +
      `task genuinely needs one (Task 11's add-widget menu needs the registry's KEY LIST), add it here on ` +
      `purpose — the marker scan above still forbids the dispatch loop itself.`
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §4 — THE IMPOSTORS, replayed through this file's own scanners so the pin cannot go quietly blind.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Impostor A2, abridged to its load-bearing lines: a second renderer, with the runtime's two degrade
 * sentences copied verbatim. This exact shape passed all three browser tests. */
const IMPOSTOR_A2 = `
import { widgetRegistry } from "@/hmi-runtime/widgetRegistry"
import { resolveBinding } from "@/hmi-runtime/bindings"

class EditorWidgetBoundary extends Component {
  static getDerivedStateFromError(error) { return { error } }
  render() { return <div data-hmi-widget-error={this.props.widgetId} role="alert">crashed while rendering: {msg}</div> }
}

export function EditorCanvas({ doc }) {
  return (
    <div data-hmi-screen={doc.screenId} style={{ gridTemplateColumns: \`repeat(\${doc.layout.cols}, 1fr)\` }}>
      {doc.widgets.map((widget) => {
        const Widget = widgetRegistry[widget.kind]
        if (!Widget) return <div data-hmi-widget-error={widget.id} role="alert">unknown widget kind "{widget.kind}"</div>
        return (
          <div data-hmi-widget={widget.id} style={{ gridColumn: \`\${widget.rect.col + 1} / span \${widget.rect.colSpan}\` }}>
            <Widget widget={widget} source={source} resolve={(b) => resolveBinding(b, undefined)} />
          </div>
        )
      })}
    </div>
  )
}
`

/** Impostor B's wiring: the canvas re-pointed at a local fork, with the local NAME kept so that every
 * `<ScreenRenderer …/>` in the file still reads correctly. */
const IMPOSTOR_B_CANVAS = `
import { ForkedEditorScreenRenderer as ScreenRenderer } from "./ForkedScreenRenderer"

export function EditorCanvas({ doc }) {
  return <ScreenRenderer doc={doc} source={DESIGN_TIME_SOURCE} />
}
`

test("§4: the pin rejects impostor A2 — a second renderer with the degrade wording copied", () => {
  const stripped = stripComments(IMPOSTOR_A2)
  const found = markerOffences(stripped)
  for (const expected of ["data-hmi-screen=", "data-hmi-widget=", "widgetRegistry[", "gridColumn:", "getDerivedStateFromError"]) {
    assert.ok(found.includes(expected), `SIDE 2 did not see \`${expected}\` in impostor A2 — the marker scan is blind`)
  }
  assert.ok(
    whyNotMountingTheRuntimeRenderer(stripped) !== null,
    "SIDE 1 accepted impostor A2, which never imports ScreenRenderer at all"
  )
  const badImports = importDeclarations(stripped)
    .map((d) => normalizeSpecifier(d.specifier))
    .filter((s) => s.startsWith("hmi-runtime/") && !EDITOR_HMI_RUNTIME_IMPORT_ALLOWLIST.includes(s))
  assert.deepEqual(
    badImports.sort(),
    ["hmi-runtime/bindings", "hmi-runtime/widgetRegistry"],
    "SIDE 2's import allowlist did not catch impostor A2 assembling a renderer out of the runtime's parts"
  )
})

test("§4: the pin rejects impostor B — a verbatim fork of ScreenRenderer.tsx placed under src/editor/", () => {
  // The probe IS the real renderer's bytes, read from disk, so it cannot drift away from the artefact
  // it stands for: whatever `ScreenRenderer.tsx` says today is exactly what a fork of it would say.
  const forkSource = RENDERER_SRC
  const found = markerOffences(forkSource)
  assert.ok(
    found.length >= 10,
    `a byte-for-byte fork of the renderer produced only ${found.length} marker offence(s) — SIDE 2 would let a copy through`
  )
  for (const expected of RENDERER_DOM_HOOKS) {
    assert.ok(found.includes(expected), `SIDE 2 did not see \`${expected}\` in a verbatim fork of the renderer`)
  }
  // ...and the wiring half: the canvas re-pointed at that fork, with the local name preserved.
  const why = whyNotMountingTheRuntimeRenderer(stripComments(IMPOSTOR_B_CANVAS))
  assert.ok(why !== null, "SIDE 1 accepted a canvas re-pointed at a local fork under an alias")
  assert.match(
    why,
    /ALIAS|ForkedScreenRenderer/,
    `SIDE 1 rejected impostor B's canvas for the wrong reason: ${why}`
  )
})
