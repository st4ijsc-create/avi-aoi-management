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
// 🔴 What this file does NOT check, and why — three fields excluded from the mirror table on purpose,
// not by oversight:
//   - `border`: `chartTokens.ts` mirrors a DIFFERENT css custom property per theme for this ONE field —
//     `consoleTokens.border` is the literal `--color-divider` value (a translucent `color-mix()`
//     string), while `glassTokens`/`warmthTokens`/`isa101Tokens`.border all mirror the OPAQUE `--border`
//     hex instead. Measured, not assumed: `--border` for console is `#26303f`, which is NOT what
//     `consoleTokens.border` contains. Whether that's a deliberate per-theme choice (a chart element
//     might read wrong against Console's near-black ground with an opaque border colour) or a latent
//     drift is a real question this branch's own task didn't ask, and asserting one canonical mapping
//     here would either be a guess dressed as a check or a new finding outside M3's scope. Left alone.
//   - `line` / `chartSeries`: NOT a strict mirror by the file's own inline comments. Console's `line`
//     mirrors `--color-accent` (`#38D6FF`); Glass's `line` is the FIXED `navy[700]` (`#1E3A8A`), which is
//     NOT Glass's `--color-accent` (`#2F6BFF`, a lifted azure) — measured, they genuinely differ. Warmth
//     and isa101's own comments state `--color-accent === navy-700 (unlifted)` for those two themes
//     specifically, which is what makes `line: navy[700]` look like it mirrors `--color-accent` there —
//     but it's the SAME fixed constant Glass uses for a DIFFERENT (non-mirroring) reason. There is no
//     single formula across all four themes to assert without re-deriving each theme's own design
//     rationale by hand, which is exactly the kind of untested judgement call this file is not the
//     place to introduce.
//
// Eleven fields ARE a consistent, unambiguous, measured 1:1 mirror across all four themes —
// `surfaceCard`, `textMuted`, `textBody`, `textStrong` (the field that actually went stale), `accent500`,
// `accent600`, `ok`, `warn`, `danger`, `neutral`, `info` — verified by checking every one of the 44
// console/warmth/isa101 comparisons plus Glass's own 11 by hand before writing this table, not asserted
// from the field names alone.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { accent, navy, status, surface, text } from "../src/theme/tokens.ts"

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

// Trường ChartTokens → biến CSS nó mirror — CHỈ 11 trường đã đo là khớp NHẤT QUÁN ở cả 4 theme (xem
// header file này cho 3 trường bị loại và lý do).
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
