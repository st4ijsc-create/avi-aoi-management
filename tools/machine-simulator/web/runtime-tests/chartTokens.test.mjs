// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// WS-HMI-1 whole-branch review, finding M3 — `web/src/theme/chartTokens.ts` declares itself a mirror of
// `index.css`'s four `[data-theme="…"]` blocks and hand-copies roughly 52 hex values across four theme
// objects. Nothing compared the two sides before this file: the branch shipped `isa101Tokens.textStrong
// = "#1C1E1E"` — the EXACT value that had measured 4.32:1 and failed axe — after `index.css` had already
// been darkened to `#0a0c0c` for AA margin. `tsc`, `oxlint`, the full Playwright suite, and axe were all
// green on that tree; only a human reviewer caught it. This is the mechanical gate that would have.
//
// 🔴 `chartTokens.ts` cannot be `import()`-ed under `node --test`: it imports `useTheme` from
// `theme/ThemeToggle.tsx` (a React hook, `.tsx`), and Node's native loader strips TYPE syntax but cannot
// parse JSX at all (measured repeatedly elsewhere in this tree — see `widgetRegistry.test.mjs`'s header
// for the exact probe). So, same technique as every other source-vs-source pin in this tree
// (`contracts.test.mjs`'s `tsUnionMembers`, `widgetRegistry.test.mjs`'s `readRegisteredKinds`,
// `hmiWiring.test.mjs`): read `chartTokens.ts` and `index.css` as TEXT and compare via regex, for the
// three hand-copied themes (console/warmth/isa101). `theme/tokens.ts` — the file `chartTokens.ts`'s OWN
// `glassTokens` object references instead of hand-copying — is plain `.ts`, JSX-free, and IS imported
// for real below; Glass gets a stronger, two-layer check because of that (see the bottom of this file).
//
// 🔴 final-fix-re-review.md, finding N1 — this header used to exclude `chartSeries` alongside `line`, on
// a paragraph whose OWN measurements were all about `line` (console's `line` vs `--color-accent`,
// Glass's `line` vs Glass's `--color-accent`, Warmth/isa101's inline comments) and then closed with a
// claim covering both fields. That claim is true of `line` and was FALSE of `chartSeries`, unmeasured for
// it specifically: `chartSeries[i] === --chart-{i+1}` resolves to an EXACT match, in all four themes, for
// i in 0..4 (verified below, by reading the raw declarations on both sides — not the resolved values —
// then resolving and comparing). `chartSeries` is now covered (its own section, below the per-field
// table); `line` remains excluded, on grounds now stated for `line` alone, not borrowed from it for a
// second field. `border` also moved from "excluded" to "covered per-theme" — see that section too; the
// SAME per-theme divergence that made a single canonical mapping wrong for one shared table is exactly
// pinnable once each theme gets its OWN named mapping instead of a mapping table built for one CSS var
// per field.
//
// What remains excluded, and why, stated only for what it is actually about:
//   - `line`: NOT a strict mirror by the file's own inline comments. Console's `line` mirrors
//     `--color-accent` (`#38D6FF`); Glass's `line` is the FIXED `navy[700]` (`#1E3A8A`), which is NOT
//     Glass's `--color-accent` (`#2F6BFF`, a lifted azure) — measured, they genuinely differ. Warmth and
//     isa101's own comments state `--color-accent === navy-700 (unlifted)` for those two themes
//     specifically, which is what makes `line: navy[700]` look like it mirrors `--color-accent` there —
//     but it's the SAME fixed constant Glass uses for a DIFFERENT (non-mirroring) reason. There is no
//     single formula across all four themes to assert without re-deriving each theme's own design
//     rationale by hand.
//
// Eleven fields (`surfaceCard`, `textMuted`, `textBody`, `textStrong` — the field that actually went
// stale — `accent500`, `accent600`, `ok`, `warn`, `danger`, `neutral`, `info`) are a consistent,
// unambiguous, measured 1:1 mirror against the SAME CSS variable across all four themes; `border` is a
// consistent, measured 1:1 mirror against a DIFFERENT CSS variable per theme (console → `--color-divider`,
// the other three → `--border` — console's own `--border`, `#26303f`, is genuinely not what
// `consoleTokens.border` holds); `chartSeries[0..4]` mirrors `--chart-1`..`--chart-5` in all four themes,
// exactly (`chartSeries[5]` has no CSS counterpart at all — no `--chart-6` is declared anywhere in
// `index.css` — so index 5 is the one array element left unpinned, not the whole field).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { accent, border, chartSeries as chartSeriesGlass, navy, status, surface, text } from "../src/theme/tokens.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..", "src")

// 🔴 CRLF — same reason every source-text regex pin in this tree normalizes: core.autocrlf=true, a
// fresh checkout gets \r\n, and every regex below hard-codes \n.
const readNormalized = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n")

const cssSrc = readNormalized(join(SRC, "index.css"))
const chartTokensSrc = readNormalized(join(SRC, "theme", "chartTokens.ts"))

function extractBlock(openerLiteral) {
  const escaped = openerLiteral.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "m")
  const m = re.exec(cssSrc)
  assert.ok(m, `không tìm thấy khối "${openerLiteral}" trong index.css`)
  return m[1]
}

function extractCssVars(blockText) {
  const vars = {}
  for (const m of blockText.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    vars[m[1]] = m[2].trim()
  }
  return vars
}

const rootVars = extractCssVars(extractBlock(":root"))
const THEME_CSS_VARS = {
  console: extractCssVars(extractBlock('[data-theme="console"]')),
  warmth: extractCssVars(extractBlock('[data-theme="warmth"]')),
  isa101: extractCssVars(extractBlock('[data-theme="isa101"]')),
}

/** Resolves a `var(--x)` reference against its own theme block first, falling back to `:root` for the
 * theme-invariant tokens (the navy ramp, etc. — `index.css`'s own top comment: "Console/Warmth/isa101
 * blocks below only redeclare what differs from :root"). Recurses for a two-level chain
 * (`--info: var(--navy-600)` where `--navy-600` itself is a plain hex, one level; kept general rather
 * than hard-coding "exactly one level" in case a future edit adds a second). */
function resolveCssVar(raw, blockVars) {
  const m = /^var\((--[\w-]+)\)$/.exec(raw)
  if (!m) return raw
  const name = m[1]
  const next = blockVars[name] ?? rootVars[name]
  assert.ok(next !== undefined, `không giải quyết được ${raw} — biến ${name} không có trong block riêng lẫn :root`)
  return resolveCssVar(next, blockVars)
}

const normalizeColor = (s) => s.trim().toLowerCase()

// Trường ChartTokens → biến CSS nó mirror — 11 trường đã đo là khớp NHẤT QUÁN, CÙNG một biến CSS, ở
// cả 4 theme (xem header file này cho trường còn lại bị loại và lý do). `border` KHÔNG ở trong bảng
// này dù nó CŨNG được pin bên dưới — nó mirror biến CSS KHÁC NHAU tùy theme (console → --color-divider,
// còn lại → --border), nên không có một `cssVarName` chung để đưa vào bảng dùng chung này.
const MIRROR = {
  surfaceCard: "--color-surface",
  textMuted: "--text-muted",
  textBody: "--text-body",
  textStrong: "--color-text",
  accent500: "--accent-500",
  accent600: "--accent-600",
  ok: "--status-run",
  warn: "--status-warn",
  danger: "--status-fault",
  neutral: "--status-idle",
  info: "--info",
}

// `border`: console mirrors `--color-divider` (measured — console's OWN `--border`, `#26303f`, is a
// different value entirely); the other three mirror `--border` directly. See this file's header.
const BORDER_CSS_VAR = {
  console: "--color-divider",
  warmth: "--border",
  isa101: "--border",
}

// `chartSeries[0..4]` mirrors `--chart-1`..`--chart-5`, index for index, in all four themes — measured
// exact in each. Index 5 is excluded: no `--chart-6` exists anywhere in `index.css` for it to mirror.
const CHART_SERIES_CSS_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"]

function extractChartTokensObjectBody(constName) {
  const re = new RegExp(`const ${constName}: ChartTokens = \\{([\\s\\S]*?)\\n\\}`)
  const m = re.exec(chartTokensSrc)
  assert.ok(m, `không tìm thấy "const ${constName}: ChartTokens = {" trong chartTokens.ts`)
  return m[1]
}

function extractField(body, field, constName) {
  const re = new RegExp(`^\\s*${field}:\\s*([^,\\n]+),`, "m")
  const m = re.exec(body)
  assert.ok(m, `${constName} thiếu trường "${field}" (hoặc hình dạng dòng đã đổi khỏi "field: value,")`)
  return m[1].trim()
}

/** `chartTokens.ts`'s console/warmth/isa101 objects write MOST fields as a literal `"#hex"` string, but
 * a few (`info`, `accent500`/`accent600` for isa101) write `navy[NNN]` instead — a reference into the
 * SAME theme-invariant ramp `theme/tokens.ts` exports (imported for real above, not re-typed here).
 * Resolves either shape to a real hex string; throws (loudly, not silently) for anything else, since a
 * third shape appearing here means this test needs a human to look at it, not a guess. */
function resolveTsFieldValue(raw, constName, field) {
  const strMatch = /^"([^"]*)"$/.exec(raw)
  if (strMatch) return strMatch[1]
  const navyMatch = /^navy\[(\d+)\]$/.exec(raw)
  if (navyMatch) {
    const key = Number(navyMatch[1])
    const value = navy[key]
    assert.ok(value !== undefined, `${constName}.${field} tham chiếu navy[${key}], nhưng theme/tokens.ts's navy không có khoá đó`)
    return value
  }
  assert.fail(`${constName}.${field} = ${raw} — không phải chuỗi literal hay navy[N], bài này chưa biết cách so hình dạng này`)
}

/** `border` is always a plain double-quoted string literal in console/warmth/isa101 (never `navy[N]`)
 * — but console's own value, `"color-mix(in srgb, #e9f1fb 14%, transparent)"`, contains COMMAS inside
 * the string, which breaks `extractField`'s comma-stopping regex the same way an array literal does
 * (measured: it silently truncates to `"color-mix(in srgb`, the text up to the FIRST comma). Matches
 * the quoted string directly instead, so an embedded comma is just more characters inside `"…"`, not a
 * stop signal. */
function extractQuotedField(body, field, constName) {
  const re = new RegExp(`^\\s*${field}:\\s*"([^"]*)",`, "m")
  const m = re.exec(body)
  assert.ok(m, `${constName} thiếu trường "${field}" dạng chuỗi literal (hoặc hình dạng dòng đã đổi khỏi 'field: "value",')`)
  return m[1]
}

/** `chartSeries` is written as a single-line array literal (`chartSeries: [a, b, c, d, e, f],`) —
 * `extractField`'s comma-stopping regex can't capture it whole (its own stop character IS the array's
 * own element separator; it would return just the first element). Captures the bracketed body via a
 * GREEDY match anchored to the closing `]` immediately followed by `,` at end-of-line: greedy
 * backtracking naturally lands on the LAST such `]` on the line, which is the array's own closing
 * bracket — skipping past the inner `]` that `navy[N]` elements contain along the way. Splits the
 * captured body on `,`, which is safe here because no element shape used in this file (`"#hex"` or
 * `navy[N]`) contains an internal comma. */
function extractArrayField(body, field, constName) {
  const re = new RegExp(`^\\s*${field}:\\s*\\[([^\\n]*)\\]\\s*,\\s*$`, "m")
  const m = re.exec(body)
  assert.ok(m, `${constName} thiếu trường mảng "${field}" (hoặc hình dạng dòng đã đổi khỏi "field: [...],")`)
  const items = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  assert.equal(
    items.length,
    6,
    `${constName}.${field} có ${items.length} phần tử, kỳ vọng 6 — ChartTokens.chartSeries cố định 6 phần tử theo interface`
  )
  return items
}

// ── console / warmth / isa101 — hand-copied hex literal, so đọc thẳng ────────────────────────────
for (const themeName of ["console", "warmth", "isa101"]) {
  const constName = `${themeName}Tokens`
  const body = extractChartTokensObjectBody(constName)
  const cssVars = THEME_CSS_VARS[themeName]

  for (const [field, cssVarName] of Object.entries(MIRROR)) {
    test(`chartTokens.ts's ${constName}.${field} khớp index.css's [data-theme="${themeName}"] ${cssVarName}`, () => {
      const tsRaw = extractField(body, field, constName)
      const tsValue = resolveTsFieldValue(tsRaw, constName, field)

      const cssRaw = cssVars[cssVarName]
      assert.ok(cssRaw !== undefined, `index.css thiếu ${cssVarName} trong [data-theme="${themeName}"]`)
      const cssValue = resolveCssVar(cssRaw, cssVars)

      assert.equal(
        normalizeColor(tsValue),
        normalizeColor(cssValue),
        `${constName}.${field} = ${tsRaw} (= "${tsValue}") nhưng index.css's [data-theme="${themeName}"] ${cssVarName} (đã giải var()) = "${cssValue}" — hai bên LỆCH NHAU`
      )
    })
  }

  // `border` — final-fix-re-review.md N1: per-theme cssVarName, so its own test rather than a MIRROR entry.
  const borderCssVarName = BORDER_CSS_VAR[themeName]
  test(`chartTokens.ts's ${constName}.border khớp index.css's [data-theme="${themeName}"] ${borderCssVarName}`, () => {
    const tsValue = extractQuotedField(body, "border", constName)

    const cssRaw = cssVars[borderCssVarName]
    assert.ok(cssRaw !== undefined, `index.css thiếu ${borderCssVarName} trong [data-theme="${themeName}"]`)
    const cssValue = resolveCssVar(cssRaw, cssVars)

    assert.equal(
      normalizeColor(tsValue),
      normalizeColor(cssValue),
      `${constName}.border = "${tsValue}" nhưng index.css's [data-theme="${themeName}"] ${borderCssVarName} (đã giải var()) = "${cssValue}" — hai bên LỆCH NHAU`
    )
  })

  // `chartSeries[0..4]` — final-fix-re-review.md N1: index-by-index against --chart-1..--chart-5.
  // Index 5 stays unpinned (no CSS counterpart) — see this file's header.
  const chartSeriesItems = extractArrayField(body, "chartSeries", constName)
  CHART_SERIES_CSS_VARS.forEach((cssVarName, i) => {
    test(`chartTokens.ts's ${constName}.chartSeries[${i}] khớp index.css's [data-theme="${themeName}"] ${cssVarName}`, () => {
      const tsRaw = chartSeriesItems[i]
      const tsValue = resolveTsFieldValue(tsRaw, constName, `chartSeries[${i}]`)

      const cssRaw = cssVars[cssVarName]
      assert.ok(cssRaw !== undefined, `index.css thiếu ${cssVarName} trong [data-theme="${themeName}"]`)
      const cssValue = resolveCssVar(cssRaw, cssVars)

      assert.equal(
        normalizeColor(tsValue),
        normalizeColor(cssValue),
        `${constName}.chartSeries[${i}] = ${tsRaw} (= "${tsValue}") nhưng index.css's [data-theme="${themeName}"] ${cssVarName} (đã giải var()) = "${cssValue}" — hai bên LỆCH NHAU`
      )
    })
  })
}

// ── glass — chartTokens.ts's glassTokens KHÔNG hand-copy hex, nó tham chiếu THẲNG theme/tokens.ts.
// Đo hai lớp độc lập: (a) glassTokens object THẬT SỰ gán đúng BIỂU THỨC tham chiếu đó — bắt regression
// "ai đó thay một trường bằng literal hex tự gõ, lệch khỏi nguồn duy nhất"; (b) giá trị THẬT
// `theme/tokens.ts` export (import() thật, không đọc văn bản — file đó JSX-free) khớp index.css's :root.
const GLASS_SOURCE_EXPR = {
  surfaceCard: "surface.card",
  textMuted: "text.muted",
  textBody: "text.body",
  textStrong: "text.strong",
  accent500: "accent[500]",
  accent600: "accent[600]",
  ok: "status.ok",
  warn: "status.warn",
  danger: "status.danger",
  neutral: "status.neutral",
  info: "status.info",
  // final-fix-re-review.md N1 — `extractField`'s comma-stopping regex works fine for BOTH of these:
  // neither `border.DEFAULT` nor `chartSeriesGlass` (a bare identifier reference, not an array literal
  // — glassTokens doesn't hand-copy the array, it points at the same one `theme/tokens.ts` exports)
  // contains a comma, so they need no new extraction machinery to fold into this existing loop.
  border: "border.DEFAULT",
  chartSeries: "chartSeriesGlass",
}

const GLASS_REAL_VALUES = {
  surfaceCard: surface.card,
  textMuted: text.muted,
  textBody: text.body,
  textStrong: text.strong,
  accent500: accent[500],
  accent600: accent[600],
  ok: status.ok,
  warn: status.warn,
  danger: status.danger,
  neutral: status.neutral,
  info: status.info,
}

test("chartTokens.ts's glassTokens tham chiếu ĐÚNG các hằng số theme/tokens.ts, không hand-copy hex riêng", () => {
  const body = extractChartTokensObjectBody("glassTokens")
  for (const [field, expectedExpr] of Object.entries(GLASS_SOURCE_EXPR)) {
    const actualExpr = extractField(body, field, "glassTokens")
    assert.equal(
      actualExpr,
      expectedExpr,
      `glassTokens.${field} = "${actualExpr}", kỳ vọng "${expectedExpr}" — glassTokens phải THAM CHIẾU theme/tokens.ts, không hand-copy hex riêng (nếu không, đây là bản sao thứ BA để lệch, đúng lớp lỗi M3 đang chặn)`
    )
  }
})

for (const [field, cssVarName] of Object.entries(MIRROR)) {
  test(`theme/tokens.ts's giá trị thật cho glassTokens.${field} khớp index.css's :root ${cssVarName}`, () => {
    const cssRaw = rootVars[cssVarName]
    assert.ok(cssRaw !== undefined, `index.css :root thiếu ${cssVarName}`)
    const cssValue = resolveCssVar(cssRaw, rootVars)
    const tokenValue = GLASS_REAL_VALUES[field]

    assert.equal(
      normalizeColor(tokenValue),
      normalizeColor(cssValue),
      `theme/tokens.ts's giá trị thật cho "${field}" (${tokenValue}) KHÔNG khớp index.css's :root ${cssVarName} (đã giải var() = "${cssValue}")`
    )
  })
}

// `border`/`chartSeries` real values — kept OUT of MIRROR (see MIRROR's own comment) so they need their
// own tests rather than falling out of the loop above for free. Same `border`/`chartSeriesGlass` real
// imports the structural test above already confirmed `glassTokens` points AT, not a re-typed copy.
test(`theme/tokens.ts's giá trị thật cho glassTokens.border (border.DEFAULT) khớp index.css's :root --border`, () => {
  const cssRaw = rootVars["--border"]
  assert.ok(cssRaw !== undefined, `index.css :root thiếu --border`)
  const cssValue = resolveCssVar(cssRaw, rootVars)

  assert.equal(
    normalizeColor(border.DEFAULT),
    normalizeColor(cssValue),
    `theme/tokens.ts's border.DEFAULT (${border.DEFAULT}) KHÔNG khớp index.css's :root --border (đã giải var() = "${cssValue}")`
  )
})

CHART_SERIES_CSS_VARS.forEach((cssVarName, i) => {
  test(`theme/tokens.ts's giá trị thật cho glassTokens.chartSeries[${i}] khớp index.css's :root ${cssVarName}`, () => {
    const cssRaw = rootVars[cssVarName]
    assert.ok(cssRaw !== undefined, `index.css :root thiếu ${cssVarName}`)
    const cssValue = resolveCssVar(cssRaw, rootVars)
    const tokenValue = chartSeriesGlass[i]

    assert.equal(
      normalizeColor(tokenValue),
      normalizeColor(cssValue),
      `theme/tokens.ts's chartSeries[${i}] (${tokenValue}) KHÔNG khớp index.css's :root ${cssVarName} (đã giải var() = "${cssValue}")`
    )
  })
})
