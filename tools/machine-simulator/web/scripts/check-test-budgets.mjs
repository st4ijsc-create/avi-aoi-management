// ─────────────────────────────────────────────────────────────────────────────
// Static budget gate for the Playwright suite: no test may DECLARE more waiting
// than it could ever actually spend under `playwright.config.ts`'s per-test ceiling.
//
// WHY THIS EXISTS
// ---------------
// `playwright.config.ts` sets `timeout: 45_000`, `workers: 1`, `retries: 0`. A wait whose
// declared bound is larger than the budget still left when the test reaches it can never
// run to its bound: the per-test ceiling fires first and truncates it. The number written
// at that site is then inert — tuning it changes nothing, and the failure is reported
// against the test ceiling ("Test timeout of 45000ms exceeded") rather than against the
// bound the author actually chose, which mis-attributes "the app did not do this in the
// time we allow" as "this test is too slow".
//
// Measured on this tree (see .superpowers/sdd/backlog-test-deadlines/task-2-report.md §2):
// Playwright 1.61 still names the pending assertion, its locator, its source line and its
// `expect.poll` message when the ceiling fires — so this is NOT the total diagnostic loss
// the shape suggests. It is a correctness problem about the numbers themselves.
//
// WHAT IS COUNTED, AND WHY NOT EVERYTHING
// ---------------------------------------
// Only bounds a human WROTE AT A SITE are summed: an explicit `{ timeout: N }` on a
// retrying wait, and the literal argument to `page.waitForTimeout(N)`. Those are per-site
// claims — "this particular thing may legitimately take up to N".
//
// An un-annotated `await expect(...)` inherits `expect.timeout` from the config. Those are
// NOT summed, and the reason is arithmetic rather than convenience: this suite's longest
// user-journey test makes 25 un-annotated assertions, so at the configured 10 s default a
// "sum everything" model puts it at 250 s+ and declares 105 of 137 static test bodies over
// the ceiling — including tests that measurably finish in 1.5 s. Summing framework
// backstops is not a meaningful bound on anything; it would only produce an unactionable
// gate. Instead ONE backstop's worth (`expect.timeout`) is held back as RESERVE, on the
// basis that a green test's un-annotated assertions each resolve in milliseconds and only
// one of them can be the one that stalls.
//
// This is not a loophole for deleting annotations to buy headroom: dropping an annotation
// LARGER than the default is a real tightening down to the default, not a free pass, and
// the checker separately flags any bare numeric bound that merely restates the default
// (a named constant at that same value is not flagged — it says WHY the wait may take that
// long, which the default cannot). The measured cross-check below closes the rest.
//
// USAGE
//   node scripts/check-test-budgets.mjs                       # static gate
//   node scripts/check-test-budgets.mjs --verbose             # per-site breakdown
//   node scripts/check-test-budgets.mjs --measured run.json   # + measured cross-check
//
// The optional cross-check reads a Playwright JSON report (`PLAYWRIGHT_JSON_OUTPUT_NAME=…
// npx playwright test --reporter=json`) and asserts the property that actually matters at
// runtime: `measured duration + the single largest declared bound <= ceiling`, i.e. if any
// one wait stalls all the way to its bound, the test still fails INSIDE that wait rather
// than at the outer ceiling. Only one wait can stall at a time — if a second also stalls,
// the first has already failed the test.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const here = dirname(fileURLToPath(import.meta.url))
const WEB = join(here, "..").replace(/\\/g, "/")
const ts = createRequire(join(WEB, "package.json"))("typescript")

const argv = process.argv.slice(2)
const VERBOSE = argv.includes("--verbose")
const measuredPath = argv[argv.indexOf("--measured") + 1]
const MEASURED = argv.includes("--measured") ? measuredPath : null

// ── the two numbers this whole check is relative to, read from the config itself ──────────
// Comments stripped first: this config documents the numbers it sets at length, and those comments
// quote other `timeout:` values (the ritual 15 000 that used to be everywhere, for one). Reading the
// first textual match would pick up a number from the prose explaining why it is NOT the number.
const cfgSrc = readFileSync(join(WEB, "playwright.config.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
const readNum = (re, what) => {
  const m = re.exec(cfgSrc)
  if (!m) throw new Error(`could not read ${what} out of playwright.config.ts`)
  return Number(m[1].replace(/_/g, ""))
}
const CEILING = readNum(/^\s*timeout:\s*([\d_]+)/m, "the per-test `timeout`")
const EXPECT_DEFAULT = readNum(/expect:\s*\{[\s\S]*?timeout:\s*([\d_]+)/m, "`expect.timeout`")
const RESERVE = EXPECT_DEFAULT
const BUDGET = CEILING - RESERVE

/** Playwright's own documented defaults for the `page.waitFor*` family. Unlike `expect`, these are
 * NOT configured by this project, so an un-annotated one is an implicit 30 s claim nobody made on
 * purpose — counted, so that the fix is to state a real number rather than to inherit one. */
const PAGE_WAIT_DEFAULTS = {
  waitForFunction: 30_000,
  waitForSelector: 30_000,
  waitForRequest: 30_000,
  waitForResponse: 30_000,
  waitForEvent: 30_000,
  waitForURL: 30_000,
  waitForLoadState: 30_000,
}

// ── parse ────────────────────────────────────────────────────────────────────────────────
const files = []
for (const dir of ["tests", "tests/support"]) {
  const abs = join(WEB, dir)
  if (!existsSync(abs)) continue
  for (const f of readdirSync(abs)) if (f.endsWith(".ts")) files.push(join(abs, f).replace(/\\/g, "/"))
}

const sources = new Map()
const fns = new Map()
/** `NAME -> value` for every numeric `const` in reach, so a bound written as a NAMED constant
 * (`{ timeout: LIVE_CYCLES_MS }`, or `SOUND_GATE_MS + 300` imported from the product) is still
 * summable. Without this, doing the right thing — replacing a magic number with a named, imported
 * one — would make the bound invisible to this checker, which would be exactly backwards. */
const consts = new Map()
const ambiguous = new Set()

function parseFile(f) {
  if (sources.has(f)) return sources.get(f)
  const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true)
  sources.set(f, sf)
  return sf
}

/** Follows relative imports so a constant declared in `src/` (the product) is resolvable from a
 * spec. Only files that are actually imported get parsed. */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null
  const base = join(dirname(fromFile), spec).replace(/\\/g, "/")
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(cand) && !cand.endsWith("/")) {
      try {
        if (readdirSync(dirname(cand)).includes(cand.split("/").pop())) return cand
      } catch {
        /* not a directory we can list — fall through */
      }
    }
  }
  return null
}

function harvest(f) {
  const sf = parseFile(f)
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, { node: n, file: f })
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer) {
      if (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) {
        fns.set(n.name.text, { node: n.initializer, file: f })
      } else {
        const v = foldNumber(n.initializer)
        if (v !== undefined) {
          if (consts.has(n.name.text) && consts.get(n.name.text) !== v) ambiguous.add(n.name.text)
          consts.set(n.name.text, v)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return sf
}

/** Constant-folds numeric literals, named constants, and `+`/`-`/`*` between them. */
function foldNumber(node) {
  if (!node) return undefined
  if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ""))
  if (ts.isIdentifier(node)) return ambiguous.has(node.text) ? undefined : consts.get(node.text)
  if (ts.isParenthesizedExpression(node)) return foldNumber(node.expression)
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const v = foldNumber(node.operand)
    return v === undefined ? undefined : -v
  }
  if (ts.isBinaryExpression(node)) {
    const l = foldNumber(node.left)
    const r = foldNumber(node.right)
    if (l === undefined || r === undefined) return undefined
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return l + r
    if (node.operatorToken.kind === ts.SyntaxKind.MinusToken) return l - r
    if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return l * r
  }
  return undefined
}

// Two passes: imported modules first (so their constants exist before the specs that use them are
// folded), then the suite itself.
const imported = new Set()
for (const f of files) {
  const sf = parseFile(f)
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const target = resolveImport(f, st.moduleSpecifier.text)
      if (target) imported.add(target)
    }
  }
}
for (const f of imported) if (!files.includes(f)) harvest(f)
for (const f of files) harvest(f)

const rel = (f) => f.replace(WEB + "/", "")
const numericLiteral = (node) => foldNumber(node)

/** A `timeout:` on this call's own options object, if it is a plain numeric literal. `undefined`
 * both when there is no option and when it is a computed expression — a computed bound cannot be
 * summed statically, so it is reported separately rather than silently treated as zero. */
function ownTimeout(call) {
  let sawNonLiteral = false
  for (const a of call.arguments) {
    if (!ts.isObjectLiteralExpression(a)) continue
    for (const p of a.properties) {
      if (!ts.isPropertyAssignment(p) || !p.name || p.name.getText() !== "timeout") continue
      const v = numericLiteral(p.initializer)
      if (v === undefined) sawNonLiteral = true
      // `named` = written as a constant rather than a bare number. It matters for the redundancy
      // note below: `{ timeout: 10_000 }` restates the config default and says nothing, whereas
      // `{ timeout: LIVE_CYCLES_MS }` at the same value states WHY the wait may take that long.
      else return { ms: v, named: !ts.isNumericLiteral(p.initializer) }
    }
  }
  return sawNonLiteral ? { computed: true } : undefined
}

/** `expect.poll(fn, { timeout }).toBeGreaterThan(0)` — the options sit on the INNER call, so the
 * whole `a().b().c()` chain has to be walked, not just the outermost node. */
function chainTimeout(call) {
  let cur = call
  while (cur && ts.isCallExpression(cur)) {
    const t = ownTimeout(cur)
    if (t) return t
    cur = ts.isPropertyAccessExpression(cur.expression) ? cur.expression.expression : undefined
  }
  return undefined
}

function calleeChain(node) {
  const parts = []
  let cur = node.expression
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) {
      parts.unshift(cur.name.text)
      cur = cur.expression
    } else if (ts.isCallExpression(cur)) {
      parts.unshift("()")
      cur = cur.expression
    } else if (ts.isIdentifier(cur)) {
      parts.unshift(cur.text)
      break
    } else {
      parts.unshift("?")
      break
    }
  }
  return parts
}

/** `await` anywhere up the call/property chain. A bare `expect(value).toBe(x)` is a SYNCHRONOUS
 * assertion with no timeout at all; only awaited ones retry, so this is the discriminator. */
function isAwaited(n) {
  let p = n.parent
  while (p) {
    if (ts.isAwaitExpression(p)) return true
    if (ts.isCallExpression(p) || ts.isPropertyAccessExpression(p) || ts.isParenthesizedExpression(p)) {
      p = p.parent
      continue
    }
    return false
  }
  return false
}

const fnCache = new Map()
function sitesInFunction(name, stack) {
  if (fnCache.has(name)) return fnCache.get(name)
  if (stack.has(name)) return [] // recursion guard
  const entry = fns.get(name)
  if (!entry) return []
  stack.add(name)
  const sites = sitesInBody(entry.node.body, entry.file, stack)
  stack.delete(name)
  fnCache.set(name, sites)
  return sites
}

/** Every declared wait reachable from `body`, following calls into helpers declared anywhere under
 * `tests/`. Returns one row per site: `explicit` marks a bound a human wrote there. */
function sitesInBody(body, file, stack) {
  const sites = []
  if (!body) return sites
  const sf = sources.get(file)
  const push = (ms, label, node, explicit, computed, named) =>
    sites.push({
      ms,
      label,
      file: rel(file),
      line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      explicit,
      computed,
      named,
    })

  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const chain = calleeChain(n)
      const root = chain[0]
      const last = chain[chain.length - 1]
      const label = chain.join(".")

      if (root === "expect" && chain.length > 1 && isAwaited(n)) {
        const t = ownTimeout(n) ?? chainTimeout(n)
        if (t?.computed) push(0, label, n, true, true)
        else push(t ? t.ms : EXPECT_DEFAULT, label, n, t !== undefined, false, t?.named ?? false)
        return
      }
      if (last === "waitForTimeout") {
        const v = numericLiteral(n.arguments[0])
        push(v ?? 0, label, n, true, v === undefined)
        return
      }
      if (Object.hasOwn(PAGE_WAIT_DEFAULTS, last)) {
        const t = ownTimeout(n)
        if (t?.computed) push(0, label, n, true, true)
        else push(t ? t.ms : PAGE_WAIT_DEFAULTS[last], label, n, true, false, t?.named ?? false)
        return
      }
      if (chain.length === 1 && fns.has(root)) {
        sites.push(...sitesInFunction(root, stack))
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(body)
  return sites
}

// ── collect one row per `test(...)`, with its describe-level hooks folded in ──────────────
const tests = []
for (const f of files.filter((x) => x.endsWith(".spec.ts"))) {
  const sf = sources.get(f)

  const hooksOf = (containerBody) => {
    const out = []
    const collect = (m) => {
      if (ts.isCallExpression(m)) {
        const c = calleeChain(m).join(".")
        if (c === "test.beforeEach" || c === "test.afterEach") {
          const fn = m.arguments[m.arguments.length - 1]
          if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) out.push(...sitesInBody(fn.body, f, new Set()))
          return
        }
        if (c.startsWith("test.describe")) return // nested describes are handled by the walk
      }
      ts.forEachChild(m, collect)
    }
    ts.forEachChild(containerBody, collect)
    return out
  }

  const walk = (n, inherited) => {
    if (ts.isCallExpression(n)) {
      const text = calleeChain(n).join(".")
      if (text.startsWith("test.describe")) {
        const body = n.arguments[n.arguments.length - 1]
        const merged = [...inherited, ...hooksOf(body)]
        ts.forEachChild(body, (m) => walk(m, merged))
        return
      }
      if (text === "test" || text === "test.only") {
        const fn = n.arguments[n.arguments.length - 1]
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
          const bodyText = fn.getText()
          const override = /test\.setTimeout\(\s*([\d_]+)\s*\)/.exec(bodyText)
          const titleNode = n.arguments[0]
          tests.push({
            file: rel(f),
            line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
            title: (ts.isStringLiteralLike(titleNode) ? titleNode.text : titleNode.getText()).replace(/\s+/g, " "),
            ceiling: override ? Number(override[1].replace(/_/g, "")) : CEILING,
            sites: [...sitesInBody(fn.body, f, new Set()), ...inherited],
          })
        }
        return
      }
      if (text === "test.skip" || text === "test.fixme") return
    }
    ts.forEachChild(n, (m) => walk(m, inherited))
  }

  ts.forEachChild(sf, (m) => walk(m, hooksOf(sf)))
}

for (const t of tests) {
  const declared = t.sites.filter((s) => s.explicit)
  t.declared = declared.reduce((a, b) => a + b.ms, 0)
  t.maxBound = t.sites.reduce((a, b) => Math.max(a, b.ms), 0)
  t.implicit = t.sites.filter((s) => !s.explicit).length
  t.budget = t.ceiling - RESERVE
  t.over = t.declared > t.budget
  t.computed = t.sites.filter((s) => s.computed)
}

// ── report ───────────────────────────────────────────────────────────────────────────────
const over = tests.filter((t) => t.over).sort((a, b) => b.declared - a.declared)
const redundant = []
for (const t of tests) {
  for (const s of t.sites) {
    // EQUAL to the default, not merely below it: a bound below the default is a deliberate
    // TIGHTENING and carries real information. One that exactly restates the default does not.
    if (s.explicit && !s.computed && !s.named && s.ms === EXPECT_DEFAULT && s.label.startsWith("expect") && !redundant.some((r) => r.file === s.file && r.line === s.line)) {
      redundant.push(s)
    }
  }
}

console.log(`playwright.config.ts: per-test ceiling ${CEILING} ms, expect default ${EXPECT_DEFAULT} ms`)
console.log(`budget per test: ${BUDGET} ms of explicitly-declared waiting (ceiling minus one ${RESERVE} ms backstop)`)
console.log(`${tests.length} test bodies analysed; ${over.length} over budget\n`)

if (VERBOSE) {
  for (const t of [...tests].sort((a, b) => b.declared - a.declared)) {
    console.log(`${String(t.declared).padStart(7)} / ${t.budget}   ${t.file}:${t.line}  ${t.title.slice(0, 64)}`)
    for (const s of t.sites.filter((s) => s.explicit)) {
      console.log(`          ${String(s.ms).padStart(7)}  ${s.file}:${s.line}  ${s.label}${s.computed ? "  (computed — not summed)" : ""}`)
    }
  }
  console.log("")
}

let failed = false

if (over.length > 0) {
  failed = true
  console.log("FAIL — these tests declare more waiting than they can spend:")
  for (const t of over) {
    console.log(`  ${t.file}:${t.line}  declares ${t.declared} ms, budget ${t.budget} ms  — ${t.title.slice(0, 60)}`)
    for (const s of t.sites.filter((s) => s.explicit).sort((a, b) => b.ms - a.ms)) {
      console.log(`      ${String(s.ms).padStart(6)} ms  ${s.file}:${s.line}  ${s.label}`)
    }
  }
  console.log("")
}

if (redundant.length > 0) {
  console.log(`NOTE — ${redundant.length} explicit expect bound(s) at or below the ${EXPECT_DEFAULT} ms project default (the annotation buys nothing; delete it or state why it is there):`)
  for (const s of redundant) console.log(`  ${s.file}:${s.line}  ${s.ms} ms  ${s.label}`)
  console.log("")
}

// ── optional measured cross-check ────────────────────────────────────────────────────────
if (MEASURED) {
  if (!existsSync(MEASURED)) {
    console.log(`FAIL — --measured ${MEASURED} does not exist`)
    process.exit(1)
  }
  const report = JSON.parse(readFileSync(MEASURED, "utf8"))
  const measured = new Map()
  const walkSuite = (s, file) => {
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          const key = `${s.file ?? file}:${spec.line}`
          measured.set(key, Math.max(measured.get(key) ?? 0, r.duration))
        }
      }
    }
    for (const c of s.suites ?? []) walkSuite(c, s.file ?? file)
  }
  for (const s of report.suites ?? []) walkSuite(s)

  const bad = []
  let matched = 0
  for (const t of tests) {
    const key = `${t.file.replace(/^tests\//, "")}:${t.line}`
    const ms = measured.get(key)
    if (ms === undefined) continue
    matched++
    if (ms + t.maxBound > t.ceiling) bad.push({ t, ms })
  }
  console.log(`measured cross-check against ${MEASURED} — ${matched}/${tests.length} test bodies matched`)
  console.log("  rule: measured duration + the single largest declared bound must fit under the ceiling,")
  console.log("        so a wait that stalls to its bound still fails inside itself, not at the ceiling.")
  if (bad.length > 0) {
    failed = true
    console.log("  FAIL:")
    for (const { t, ms } of bad.sort((a, b) => b.ms + b.t.maxBound - (a.ms + a.t.maxBound))) {
      console.log(`    ${t.file}:${t.line}  measured ${ms} + max bound ${t.maxBound} = ${ms + t.maxBound} > ${t.ceiling}`)
    }
  } else {
    const worst = tests
      .filter((t) => measured.has(`${t.file.replace(/^tests\//, "")}:${t.line}`))
      .map((t) => ({ t, ms: measured.get(`${t.file.replace(/^tests\//, "")}:${t.line}`) }))
      .sort((a, b) => b.ms + b.t.maxBound - (a.ms + a.t.maxBound))[0]
    if (worst) {
      console.log(
        `  PASS — tightest is ${worst.t.file}:${worst.t.line} at ${worst.ms} + ${worst.t.maxBound} = ${worst.ms + worst.t.maxBound} of ${worst.t.ceiling} ms`
      )
    }
  }
  console.log("")
}

const computedSites = tests.flatMap((t) => t.computed)
if (computedSites.length > 0) {
  console.log(`NOTE — ${computedSites.length} bound(s) are computed expressions and could not be summed statically:`)
  for (const s of computedSites) console.log(`  ${s.file}:${s.line}  ${s.label}`)
  console.log("")
}

if (failed) {
  console.log("FAIL")
  process.exit(1)
}
console.log("PASS — every test's declared waiting fits inside the per-test ceiling.")
