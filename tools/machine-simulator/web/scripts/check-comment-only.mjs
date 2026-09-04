// ─────────────────────────────────────────────────────────────────────────────
// Proves that an edit to a TypeScript/TSX file changed COMMENTS ONLY — no executable line moved.
//
//   node scripts/check-comment-only.mjs <before-file> <after-file>
//   git show <sha>:<path> > /tmp/before.ts && node scripts/check-comment-only.mjs /tmp/before.ts <path>
//
// Exit code 0 when the edit is comment-only, 1 when it is not (and it names the first divergence).
//
// WHY THIS EXISTS
// ---------------
// Several files in this tree are FROZEN for the duration of a task — `tests/37-editor-canvas.spec.ts`,
// `tests/38-editor-drag.spec.ts`, `runtime-tests/editorCanvasSeam.test.mjs`,
// `src/hmi-runtime/ScreenRenderer.tsx` — because they carry pins that cost multiple review rounds to
// get right. That freeze has been lifted twice, both times for a COMMENT-ONLY correction, and both
// times the controller required the claim to be proven mechanically rather than asserted. This script
// is that proof, kept so the third person does not re-derive it — and so they do not re-derive it
// WRONG, which is the trap the next section is about.
//
// 🔴 THE TRAP: A RAW `ts.createScanner` IS NOT SAFE ON A FILE WITH TEMPLATE LITERALS
// ---------------------------------------------------------------------------------
// The first version of this proof (commit `e3724ee3`, WS-HMI-2 Task 10 fix round 2) used
// `ts.createScanner(..., /* skipTrivia */ true, ...)` and compared the resulting token stream. That
// reads as obviously correct — comments are trivia, trivia is skipped — and it was accepted at review.
//
// It is wrong for this repository's spec files, and WS-HMI-2 Task 11 fix round 1 measured it being
// wrong. A scanner is a LEXER with no parser above it, so it cannot know whether a backtick opens a
// template literal or closes one. Give it a file where a backtick appears inside a JSDoc comment — and
// every spec header in this tree is full of `like this` — and its backtick pairing desynchronises: it
// enters "template literal" mode at a backtick in real code and does not leave until the next
// backtick, swallowing every comment in between as literal TEXT. Those comments then sit INSIDE a
// token, so editing them changes the token stream and the proof reports a comment-only edit as a code
// change. On `38-editor-drag.spec.ts` it did exactly that: 920 tokens on both sides at Task 10 (when
// the edited block happened to fall outside a swallowed region) and a false divergence at Task 11
// (when it did not).
//
// The token half below therefore uses a full `ts.createSourceFile` PARSE and walks it to its leaf
// tokens. A parser knows what a backtick means. JSDoc blocks have to be skipped explicitly, because
// TypeScript attaches them to the AST as real nodes (they carry `@param` and friends) — without that
// skip, every doc-comment edit reads as a code change for a second, different reason.
//
// WHY TWO INSTRUMENTS
// -------------------
// The line half shares no code with the token half — no compiler at all, just a filter over lines. A
// single instrument that was subtly broken would report "identical" for the wrong reason, which is the
// failure mode this whole exercise exists to avoid.
//
// WHY THE CONTROLS PRINT ON EVERY RUN
// -----------------------------------
// "The two files produce identical output" means nothing until you know the instruments can tell code
// from comment in BOTH directions. So every run also injects a one-character CODE change (both halves
// must detect it) and an added line comment plus an added JSDoc block (both halves must ignore them),
// and prints the result. A run whose controls do not read `true` is a run whose main result should not
// be believed — see `--strict`, which turns that into the exit code.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const ts = createRequire(import.meta.url)("typescript")

const argv = process.argv.slice(2)
const STRICT = argv.includes("--strict")
const [beforePath, afterPath] = argv.filter((a) => !a.startsWith("--"))
if (!beforePath || !afterPath) {
  console.error("usage: node scripts/check-comment-only.mjs [--strict] <before-file> <after-file>")
  process.exit(2)
}

const before = readFileSync(beforePath, "utf8")
const after = readFileSync(afterPath, "utf8")

/** (1) TypeScript's own PARSE, flattened to leaf tokens as `kind:text` pairs. `getText()` excludes
 *  leading trivia; JSDoc nodes are skipped explicitly. See the header for why this is a parse and not
 *  a scanner. */
function tokens(src) {
  const sf = ts.createSourceFile("probe.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  const isJSDoc = (n) => n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode
  const walk = (node) => {
    if (isJSDoc(node)) return
    // JSDoc children are filtered BEFORE the leaf test, not skipped during the loop. Skipping them in
    // the loop made a node whose ONLY child is a JSDoc block -- which is exactly what the end-of-file
    // token becomes when a file ends with a doc comment -- emit nothing at all, so appending a JSDoc
    // block silently DELETED a token and the specificity control failed. Measured while writing this.
    const kids = node.getChildren(sf).filter((k) => !isJSDoc(k))
    if (kids.length === 0) {
      out.push(`${node.kind}:${node.getText(sf)}`)
      return
    }
    for (const k of kids) walk(k)
  }
  walk(sf)
  return out
}

/** (2) A comment/blank line filter, with no compiler involved, so the two halves cannot share a
 *  defect. Line endings are normalised first: `core.autocrlf=true` on this repository. */
function codeLines(src) {
  return src
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => {
      const t = l.trim()
      return t !== "" && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*") && !t.startsWith("*/")
    })
}

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

function report(name, b, a) {
  const same = eq(b, a)
  console.log(`${name}: before=${b.length} after=${a.length} identical=${same}`)
  if (!same) {
    const i = b.findIndex((x, n) => x !== a[n])
    console.log(`  first divergence at index ${i}:`)
    console.log(`    before: ${JSON.stringify(String(b[i] ?? "(missing)").slice(0, 160))}`)
    console.log(`    after : ${JSON.stringify(String(a[i] ?? "(missing)").slice(0, 160))}`)
  }
  return same
}

const tb = tokens(before)
const ta = tokens(after)
const lb = codeLines(before)
const la = codeLines(after)
const tokensSame = report("tokens   ", tb, ta)
const linesSame = report("codeLines", lb, la)

// -- the controls, run against the AFTER text on every invocation --------------------------------
// Injected at the END of the file rather than at a matched anchor, so this works on ANY source: a
// trailing `;` is an EmptyStatement -- a real token on a real line -- while a trailing line comment
// and a trailing JSDoc block are pure trivia with nothing to attach to. An earlier version looked for
// a top-level `const NAME = ...` to inject into and silently SKIPPED its own controls on files that
// have none (`ScreenRenderer.tsx`, for one), which is the shape of hole this script exists to close.
const injected = `${after}
;
`
const commented = `${after}
// a control line comment
/** a control JSDoc block */
`
const sens = { tokens: !eq(tokens(injected), ta), lines: !eq(codeLines(injected), la) }
const spec = { tokens: eq(tokens(commented), ta), lines: eq(codeLines(commented), la) }
console.log(`sensitivity (a CODE change IS detected): tokens=${sens.tokens} codeLines=${sens.lines}`)
console.log(`specificity (added COMMENTS are ignored): tokens=${spec.tokens} codeLines=${spec.lines}`)
const controlsOk = sens.tokens && sens.lines && spec.tokens && spec.lines

const commentOnly = tokensSame && linesSame
console.log(commentOnly ? "COMMENT-ONLY: yes — no executable line moved" : "COMMENT-ONLY: NO — see the divergence above")
if (!commentOnly) process.exit(1)
if (STRICT && !controlsOk) {
  console.error("--strict: the instruments' own controls did not all pass, so the result above is not trustworthy")
  process.exit(1)
}
