# 17 — Frontend Design System (DS) — Foundation

> Initiative: Automation Orchestration upgrade · Phase **F1b (design-system foundation)** · branch `automation-orchestration-r0`.
> Design ref: doc 16 §12. Date: 2026-06-30.
> Scope: establish a durable, professional design-system **foundation** — additive and backward-compatible. The current visual look is **unchanged**; no existing CSS-var value or shadcn component API was modified. The 151 existing pages are NOT mass-refactored (see §7 Rollout).

Stack: shadcn/ui (new-york) + Radix + Tailwind v4 (`@theme` + oklch CSS vars) + Framer Motion + Recharts + lucide. Path alias `@/*` → `client/src/*`.

---

## 1. What F1b delivered (summary)

| Area | Delivered | Files |
|---|---|---|
| **Tokens** | New semantic colors (`--info`, `--error` alias, surface/text ramps), typography scale utilities, motion/spacing/radius/elevation constants | `client/src/index.css`, `client/src/components/patterns/tokens.ts` |
| **Components** | `PageHeader`, `MetricCard`, `StatusBadge`, `SectionCard`, `Heading`/`Text`; re-export of existing `EmptyState`; single barrel | `client/src/components/patterns/*`, `index.ts` |
| **Adoption** | `FleetOrchestration` + `SafetyWorkforce` now import shared `MetricCard` + `PageHeader` (pixel-identical swap). `DigitalTwinCenter` left as-is (different header/KPI shape) | the 3 pages |
| **Storybook** | **Documented-only** (not installed) — see §6 | this doc |
| **A11y** | Static audit + fixes baked into the new components; checklist + top findings | §5 |

**Hard rule honoured:** the values of existing tokens (`--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--border`, `--destructive`, `--success`, `--warning`, …) are unchanged. Everything below is *new*.

---

## 2. Design tokens

### 2.1 Color tokens

The theme is defined in `client/src/index.css`. Default (`:root`) is the **dark** "Elegant Industrial" theme; `.light` is the light override. Status colors are mapped into Tailwind via the `@theme inline` block, so `bg-success`, `text-warning`, `border-info/30` etc. work as utilities.

**Pre-existing (unchanged) status tokens:** `--success`/`--success-foreground`, `--warning`/`--warning-foreground`, `--destructive`/`--destructive-foreground`.

**NEW additive tokens (F1b):**

| Token | Dark (`:root`) | Light (`.light`) | Tailwind utility |
|---|---|---|---|
| `--info` | `oklch(0.70 0.13 250)` | `oklch(0.52 0.15 250)` | `bg-info` / `text-info` / `border-info` |
| `--info-foreground` | `oklch(0.145 0.015 260)` | `oklch(0.98 0.005 260)` | `text-info-foreground` |
| `--error` | = `--destructive` (alias) | = `--destructive` | `bg-error` / `text-error` |
| `--error-foreground` | = `--destructive-foreground` | same | `text-error-foreground` |
| `--surface-1` | `oklch(0.145 0.015 260)` (= bg) | `oklch(0.98 0.005 260)` | `bg-surface-1` |
| `--surface-2` | `oklch(0.18 0.015 260)` (= card) | `oklch(1 0 0)` | `bg-surface-2` |
| `--surface-3` | `oklch(0.22 0.015 260)` (= muted raised) | `oklch(0.94 0.01 260)` | `bg-surface-3` |
| `--text-1` | `oklch(0.96 0.01 260)` (= fg) | `oklch(0.15 0.02 260)` | `text-text-1` |
| `--text-2` | `oklch(0.80 0.015 260)` | `oklch(0.32 0.02 260)` | `text-text-2` |
| `--text-3` | `oklch(0.65 0.02 260)` (= muted-fg) | `oklch(0.45 0.02 260)` | `text-text-3` |

`--error` is a deliberate **alias** of `--destructive` (shadcn already standardises on `destructive`); use `error`/`destructive` interchangeably — `error` simply completes the success/warning/error/info semantic set for readability.

Status tint utilities (in `@layer components`, completes the existing `.status-ok/.status-ng/.status-ntf` set): **`.status-info`** = `bg-info/20 text-info border-info/30`.

### 2.2 Typography scale

16px base, ~1.25 modular ramp. Utility classes live in `index.css` (`@layer components`) and are surfaced as `<Heading>` / `<Text>` components (`patterns/Heading.tsx`).

| Class | Size | Line-height | Weight | Use |
|---|---|---|---|---|
| `.ds-display` | 36px (2.25rem) | 1.1 | 700 | hero / landing |
| `.ds-h1` | 30px | 1.2 | 700 | page title |
| `.ds-h2` | 24px | 1.25 | 600 | section |
| `.ds-h3` | 20px | 1.3 | 600 | sub-section |
| `.ds-h4` | 18px | 1.4 | 600 | card title (large) |
| `.ds-h5` | 16px | 1.4 | 600 | card title |
| `.ds-h6` | 14px | 1.4 | 600 | label / eyebrow |
| `.ds-body` | 16px | 1.6 | 400 | body |
| `.ds-body-sm` | 14px | 1.55 | 400 | dense body |
| `.ds-caption` | 12px | 1.4 | 400 | caption / meta |

> Existing pages use ad-hoc `text-2xl font-bold` etc. — those are untouched. The scale is **opt-in** for new pages. (Note: the de-facto page title across this initiative is `text-2xl font-bold tracking-tight` ≈ between `.ds-h1` and `.ds-h2`; `PageHeader` keeps that exact class so adoption is pixel-identical, while `<Heading level={1}>` is the go-forward primitive.)

### 2.3 Spacing, radius, elevation, motion

Defined as TS constants in `patterns/tokens.ts` (documentation + Framer presets; Tailwind utilities remain the primary authoring mechanism).

- **Spacing — 4px grid:** `xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32 · 3xl 48 · 4xl 64` (= Tailwind `p-1…p-16`).
- **Radius:** maps to the `--radius` ramp in `@theme` (base `0.625rem`): `rounded-sm/md/lg/xl/full`.
- **Elevation:** `flat shadow-none · raised shadow-sm (cards) · overlay shadow-lg (dialogs) · floating shadow-xl (palette)`.
- **Motion (Framer springs):**
  - `motion.entry` — `spring { stiffness 260, damping 26, mass 0.9 }` (element/page entry)
  - `motion.state` — `spring { stiffness 400, damping 34 }` (in-place state change)
  - `motion.emphasis` — `spring { stiffness 500, damping 22 }` (error/success)
  - `motion.fade` — `{ duration 0.18, easeOut }` (cross-fade fallback)
  - `fadeInUp` variant pair pairs with `motion.entry`.

```tsx
import { motion as ds, fadeInUp } from "@/components/patterns";
<motion.div {...fadeInUp} transition={ds.entry} />
```

---

## 3. Component catalog

All under `@/components/patterns` (barrel `index.ts`). Each composes the existing shadcn primitives — no restyle.

### `<PageHeader>`
Icon chip + title (+ badge slot) + description + actions slot. Byte-identical to the de-facto header on the cockpit pages.
```tsx
<PageHeader
  icon={<Truck className="h-6 w-6" />}
  title={t("fleet.title", "Fleet & Task Orchestration")}
  badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
  description="…"
  actions={<Button size="icon" variant="ghost"><RefreshCw className="h-4 w-4" /></Button>}
/>
```
A11y: title is a real `<h1>` (`as="h2"` to demote); the icon chip is `aria-hidden`.

### `<MetricCard>`
KPI card — `icon / label / value / tone (+ optional delta)`. Extracted verbatim from the duplicated local definitions so adoption is pixel-identical. Tones: `default · warning · danger|error · good|success · info` (legacy `danger`/`good` are aliases). Value tint reuses the same literal classes the originals used.

### `<StatusBadge>`
Maps a status string → semantic tone → themed `Badge`. Auto-infers a tone from keywords (running→info, ok/passed/active→success, pending/queued→warning, failed/offline/ng→error) or accepts an explicit `tone`/per-page `map`. Replaces the `taskStatusBadge`/`resStatusBadge`/`chargerStatusBadge` switch helpers.
```tsx
<StatusBadge status="running" />
<StatusBadge status="P1" tone="error" label="P1" />
<StatusBadge status={z.zoneType} map={{ charging: { tone: "success", label: "Charging" } }} />
```

### `<SectionCard>`
Titled panel: `Card > CardHeader(icon+title+optional action) > CardContent`. `contentClassName="p-0"` for full-bleed tables.

### `<Heading>` / `<Text>`
Bind the type scale to semantic elements. `<Heading level={1..6} display? as?>`, `<Text variant="body|body-sm|caption" tone="default|muted|subtle">`.

### `<EmptyState>` (re-exported, pre-existing)
The established `components/EmptyState.tsx` (variants: default/no-data/no-results/no-analytics/no-config/error, `compact`). Re-exported from the barrel so the pattern set is one import; implementation unchanged.

---

## 4. Multi-tenant theming seam

Brand-per-tenant works **without touching component code** because everything resolves through CSS variables. To brand a tenant, override the variable(s) on a scope that wraps the app (e.g. `<html data-tenant="acme">` or a `.tenant-acme` class set from the federation/tenant context):

```css
/* tenant brand override — only re-points the variable, never the component */
[data-tenant="acme"] {
  --primary: oklch(0.62 0.17 25);          /* Acme red */
  --primary-foreground: oklch(0.98 0.005 260);
  --ring: oklch(0.62 0.17 25);
  --sidebar-primary: oklch(0.62 0.17 25);
}
```

Guidance:
- Override only **role** tokens (`--primary`, `--ring`, `--sidebar-primary`, optionally `--info`/`--success`/`--warning`). Do not override structural tokens (`--background`, `--border`) per tenant unless intentionally re-skinning.
- Keep both a light and a dark value if the tenant uses both modes (set under `.light[data-tenant=…]` too).
- Because `@theme inline` maps `--color-* → var(--*)`, Tailwind utilities (`bg-primary`, `text-info`) pick up the override automatically.
- Federation-ready: the tenant attribute can be driven from the existing tenant/site context (doc 13) at the app shell.

---

## 5. Accessibility

### 5.1 New-component audit + fixes (done)
- **PageHeader:** title renders as a semantic heading (`h1`/`h2`) → correct document outline; decorative icon chip marked `aria-hidden` so SR reads the title, not the glyph. ✔
- **MetricCard:** icon chip `aria-hidden`; value + label are real text (not icon-only) → announced. Tone is conveyed by text + color (not color alone — the number/label carry meaning). ✔
- **StatusBadge:** the status **text** is always rendered (color is reinforcement, not the sole signal) → passes "don't rely on color alone". Tints use the tuned `*-foreground`/token pairs for AA. ✔
- **SectionCard / Heading / Text:** semantic elements, inherit Radix/shadcn focus rings; no interactive role added without a handler. ✔
- Focus: all interactive composition flows through shadcn `Button`/`Badge` which already carry `focus-visible:ring`. No `outline:none` added.

### 5.2 Contrast of new tokens
`--info` foregrounds were chosen against their backgrounds: dark `--info` (L≈0.70) on dark surface with `--info-foreground` (L≈0.145), light `--info` (L≈0.52) with white foreground — both clear AA for badge/icon usage. Soft tints (`bg-info/15` + `text-info`) keep text at full token chroma for legibility.

### 5.3 A11y checklist (for any new/migrated page)
- [ ] One `<h1>` per page (use `PageHeader` or `<Heading level={1}>`); headings nest without skipping.
- [ ] Color is never the only signal (pair with text/icon) — use `StatusBadge` (renders text).
- [ ] All interactive elements reachable by keyboard; visible `focus-visible` ring (don't remove it).
- [ ] Icon-only buttons have `title`/`aria-label` (e.g. the refresh button).
- [ ] Decorative icons `aria-hidden`; meaningful icons have an accessible name.
- [ ] Form fields have associated `<Label>`; errors announced (not color-only).
- [ ] Dialogs/sheets trap focus + restore on close (Radix handles this — keep `DialogTitle`).
- [ ] Text contrast ≥ AA (4.5:1 body, 3:1 large) in **both** light and dark.
- [ ] Touch targets ≥ 44px on mobile (the global mobile CSS enforces this).

### 5.4 Top findings for key pages (audit, NOT fixed here — backlog)
1. **Low-contrast tinted text widely uses literal `text-amber-500` / `text-emerald-500`** for "warning/good" tones (Fleet, Safety, Twin KPIs). On the light theme these can dip near the AA threshold on white. *Recommendation:* migrate to `text-warning`/`text-success` tokens (tuned per-mode) during rollout. (The shared `MetricCard` intentionally preserves the literals today to stay pixel-identical; switch when the page is migrated.)
2. **Inline `<select>` elements** (Fleet task-status filter, etc.) are native and unlabeled-by-`<Label>` in a couple of places — add `aria-label` or wire to a visible `<Label htmlFor>`.
3. **Status conveyed by badge color** is fine (text present), but a few **progress bars** signal "at capacity" by color tint only (Fleet zones) — add a text/aria note for SR users.
4. **DigitalTwinCenter** 3D canvas has no text alternative for the live scene — provide a tabular fallback/summary (the KPI strip partially covers this) and ensure layer toggles are keyboard-operable.
5. **Heading levels**: a few cockpit pages use `text-2xl font-bold` on a `<div>` rather than a heading element — migrate to `PageHeader`/`<Heading>` for outline correctness.

---

## 6. Storybook decision: **documented-only (not installed)**

**Decision:** Storybook was **not installed**. Rationale (honest):
- The repo is on **Vite 7 + Tailwind v4 (`@theme` CSS-first) + React 19**. Storybook's `@storybook/react-vite` (v8/v9) and the Tailwind/PostCSS integration are still maturing against this exact combo; a clean, non-flaky install that also keeps `npm run check` green is not guaranteed and pulls a large dev-dep tree (`storybook`, `@storybook/*`, addons).
- The brief says: if integration is heavy/risky/flaky, do **not** force it — document the setup + a sample story instead. We chose that path. No deps were added; `npm run check` and `vite build` stay clean.
- `.stories.tsx` files cannot be committed yet either: tsconfig globs `client/src/**/*`, so a story importing `@storybook/react` would break `tsc --noEmit` until the dev-dep is installed.

### 6.1 Exact setup steps (when adopted later)
```bash
# 1. scaffold (uses the existing vite config)
pnpm dlx storybook@latest init --builder vite --type react
# 2. ensure dev-deps only (storybook, @storybook/react-vite, addons) — they land in devDependencies
# 3. import the app CSS so tokens/utilities are available in stories:
#    in .storybook/preview.ts:  import "../client/src/index.css";
# 4. add a theme toggle: render stories inside a wrapper that toggles the `.light` class
# 5. exclude stories from tsc OR add @storybook types:
#    add "**/*.stories.tsx" to tsconfig "exclude", or install @storybook/react types before committing stories
# 6. scripts:  "storybook": "storybook dev -p 6006",  "build-storybook": "storybook build"
# 7. verify:  pnpm run check  &&  pnpm build-storybook   (must both pass before merge)
```

### 6.2 Sample story (drop into `patterns/MetricCard.stories.tsx` after install)
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Activity } from "lucide-react";
import { MetricCard } from "./MetricCard";

const meta: Meta<typeof MetricCard> = {
  title: "Patterns/MetricCard",
  component: MetricCard,
  args: { icon: <Activity className="h-4 w-4" />, label: "Running tasks", value: 12 },
};
export default meta;
type Story = StoryObj<typeof MetricCard>;

export const Default: Story = {};
export const Warning: Story = { args: { tone: "warning", value: 3 } };
export const Danger: Story = { args: { tone: "danger", value: 1 } };
export const Good: Story = { args: { tone: "good", value: 8 } };
export const WithDelta: Story = { args: { tone: "info", delta: "+2 today" } };
```
A **token/typography playground** story should render swatches for `bg-primary/secondary/muted/success/warning/info/destructive`, the `--surface-1..3` / `--text-1..3` ramps, and one row per `.ds-*` type class, wrapped in a light/dark toggle.

---

## 7. Rollout plan (migrate the other pages over time)

Goal: converge the 151 pages onto the DS without a risky big-bang. Order by traffic + churn. Each migration is **pixel-preserving**: import from `@/components/patterns`, delete the local header/KPI/badge helper, pass the same props. A page is migrated ONLY if the existing header/KPI maps cleanly to the shared component — otherwise it is LEFT and noted (see §7.2).

### 7.1 Rollout waves + status

| Wave | Bucket | Status |
|---|---|---|
| **Wave 0** | Ship tokens + components; adopt in 2 automation pages (Fleet, Safety) as reference. | ✅ done (F1b) |
| **Wave 1 (F2)** | High-traffic core cockpits — swap clean-fit `PageHeader`; tokenize status-color literals; a11y (h1 / select labels / icon-button labels). See §7.3 for the exact page list. | ✅ done (F2) |
| **Wave 2** | Remaining high-traffic cockpits + KPI strips: `DigitalTwinCenter`, `Dashboard`, `OEEDashboard`, `ProductionDashboard`, `MachineHealthMonitoring`, `CarbonDashboard`, `MESControlTower` KPI cards — swap KPIs to `MetricCard`, replace literal `text-amber-500`/`text-emerald-500` with `text-warning`/`text-success` (a11y #1). Includes the pages §7.2 skipped in W1. | ✅ done (W2) — see §7.6 |
| **Wave 3** | List/detail/editor/admin/registry headers → shared `<PageHeader>` (pixel-preserving) + tokenize obvious status literals on touched pages. Bounded batch — quality over quantity; NO abstract "template" components were built (deliberate, see §7.7). | ✅ done (W3) — see §7.7 |
| **Wave 4** | Status-helper unification — replace per-page `*StatusBadge` switch helpers (MES local `StatusBadge`, WorkOrders `statusVariant`, OpsConsole severity tiles) with the shared `<StatusBadge>` + per-page `map`. | ▢ pending |
| **Wave 5** | A11y sweep — run axe/WAVE on ~15 core pages → WCAG AA; fix §5.4 + §7.4 findings. | ▢ pending |
| **Wave 6** | Storybook + visual regression — install per §6, add stories for the 53 shadcn components + patterns + token playground; optional Chromatic/Playwright visual diffs. | ▢ pending |

> **Convention (all waves):** every NEW page MUST use `PageHeader` + `MetricCard` + `StatusBadge` + `SectionCard` + `<Heading>`. Enforce in review.

### 7.2 Wave-1-eval SKIPS (evaluated, deliberately NOT migrated — deferred to a later wave)

| Page | Reason left |
|---|---|
| `Dashboard` | Responsive header (`text-xl sm:text-2xl`) with inline `RealtimeBadge` + mobile-only quick-action bar — does not map to `PageHeader`'s fixed `text-2xl` single-title shape. → W2. |
| `OEEDashboard` | Responsive `text-xl sm:text-2xl` title — same fixed-size mismatch. → W2. |
| `ProductionDashboard` | Bespoke horizontal "summary strip" (no `<h1>`, `text-lg font-mono` cells, uppercase micro-labels) — neither `PageHeader` nor `MetricCard` fits; intentional dense layout. → W2 (+ has no `<h1>`, a11y). |
| `MachineHealthMonitoring` | Header icon is a **coloured inline** `Heart text-red-500` (not a chip) → `PageHeader`'s `bg-primary/10 text-primary` chip would change icon colour + add a chip; threshold-graded KPI colours are domain semantics, not simple status. → W2. |
| `WorkOrdersPage` (header) | Header uses `text-2xl font-semibold` (not `font-bold`), inline non-chip icon, and badges/summary/create-button share the title flex row → not a clean drop-in. (Native `<select>` a11y labels WERE added in W1.) → W3. |
| `WipLineBalance` | Header + a labelled filter input share a `items-end justify-between` row; `PageHeader` is `items-center` → would shift the input alignment. → W3. |
| `ProcessManagement` | `<ViewOnlyBadge>` is inline **inside** the `<h1>`; `PageHeader.badge` renders under the title → layout change. → W3. |
| `CarbonDashboard` | Header icon is a branded `Leaf text-emerald-600`; the primary chip would drop the intentional green accent. → W2/W3. |

### 7.3 Wave 1 (F2) — migrated pages

Pixel-preserving swaps; `npm run check` + `vite build` both green. Icon+title+subtitle headers gain the canonical DS icon **chip** (same transform as Fleet/Safety in W0).

| Page | What was swapped |
|---|---|
| `OpsConsole` | Header → `PageHeader`; War-Room refresh/sound/TV actions moved to `actions` slot; **a11y**: `aria-label` on the icon-only sound toggle; local `Kpi` accent colours tokenized (`text-red-500`→`text-destructive`, `text-orange-500`/`text-yellow-500`→`text-warning`). Kpi card kept (label-above-value shape differs from `MetricCard`). |
| `MESControlTower` | Header → `PageHeader`. (KPI cards `text-3xl` top-label shape differs from `MetricCard` → left; local `StatusBadge` name-clashes the pattern one → left for W4.) |
| `QualityCockpit` | Header → `PageHeader`. |
| `MachineStatusMonitor` | Header → `PageHeader` (no icon → identical); 5 toolbar buttons moved to `actions`. (Summary cards `text-3xl`/bordered shape differs from `MetricCard` → left.) |
| `TraceabilityLineage` | Header → `PageHeader`. |
| `ModelMonitoringPage` | Header → `PageHeader`; refresh → `actions`. |
| `RealtimeReportView` | Header → `PageHeader`. |
| `ModelVersionsPage` | Header → `PageHeader`; conditional refresh → `actions` (undefined when no model selected). |

### 7.4 New a11y findings (W1 audit)

6. **Native `<select>` without label association** — `WorkOrdersPage` status/machine filters had a visible `<Label>` but no `htmlFor`/`id` link. FIXED in W1 by adding `aria-label`. Same pattern likely exists on other list/filter pages (audit in W5).
7. **Icon-only toggle buttons without accessible name** — OpsConsole sound toggle (Volume2/VolumeX) had no label. FIXED (`aria-label`). Sweep other icon-only toggles (fullscreen, etc.) in W5.
8. **Pages with no `<h1>`** — `ProductionDashboard` renders a summary strip with no page-level heading → broken document outline. Add a visually-hidden `<h1>` or a `PageHeader` in W2.

### 7.5 Storybook (F2 decision)

Storybook remains **documented-only / not installed** (unchanged from §6). Re-confirmed in F2: installing `@storybook/react-vite` against Vite 7 + Tailwind v4 (`@theme`) + React 19 is still a heavy, flaky dev-dep tree and risks `npm run check`/`vite build`; the brief prioritises zero build risk, so it was not forced. See §6.1 for the exact adopt-later steps.

### 7.6 Wave 2 — migrated pages

Pixel-preserving pass over the KPI strips + the W1-skipped cockpits. **The only intended visual delta is tokenized status colours** (literal `text-emerald/green/amber/yellow/red-*` → semantic `text-success/warning/destructive`, tuned per light/dark mode — a11y finding #1) **plus one `sr-only` `<h1>`** for the document outline. No data/logic/layout was restructured. `npm run check` + `vite build` both green.

Because the shared `MetricCard` chip is fixed to `bg-primary/10 text-primary` and value-above-label at `text-2xl`, W2 **did not force `MetricCard`** onto cards whose shape differs (label-above-value `text-3xl`, per-card coloured icon chips, sparkline/progress composites). Colour tokenization was applied only to **unambiguous binary/OK-NG-NTF status signals**; **graded threshold scales** (3–4 step good→warn→bad, 6-state SEMI-E10) and **category/brand identity colours** (blue EnPI, violet units, rank badges) were left — they are domain semantics, not the 3-tone status set.

| Page | What was swapped | What was left (why) |
|---|---|---|
| `DigitalTwinCenter` | KPI strip status literals tokenized: `text-emerald-600`→`text-success`, `text-amber-600`→`text-warning`, `text-red-600`→`text-destructive` (Running/Idle/Down/Alarms). | Local `Kpi` box (bordered, label-above-value `text-lg`) ≠ `MetricCard` shape → not swapped. `stateColor()` hex + zone hex are three.js material colours (not Tailwind). Banner tint blocks left (multi-class semantic tints). |
| `Dashboard` | Status literals tokenized: machine online/offline tiles (`emerald/red-500`+tints→`success/destructive`), NG compare card (green/red→success/destructive, border tints), Wifi/WifiOff filter icons, OK/NG/NTF measurement-point triad (green/red/yellow→success/destructive/warning), MQTT-alert severity (critical `red`→destructive, warning `yellow`→warning + border/bg tints + badge). | Responsive header + `RealtimeBadge` + mobile quick-action bar kept as-is (brief). No `MetricCard` swap — all "cards" are bespoke glass-card widgets w/ sparklines/4-col grids/trend rows (≠ MetricCard). 4-step NG-rate scale + FPY threshold scale + metric-identity dialog icons (rose has no token) + chart/pie oklch left (graded/identity). |
| `OEEDashboard` | Status literals tokenized: Alerts card icon (`red-500`→destructive), OEE detail table Downtime/Reject (`red-500`→destructive) + Good (`green-500`→success). | Responsive `text-xl sm:text-2xl` title kept. 4 overview cards are `text-3xl` **label-above-value in `CardHeader`** (≠ `MetricCard` order/size) → left (W3/W4). SEMI-E10 6-state tiles (blue/indigo/etc.) = domain state scheme → left. Gauge/chart hex left. |
| `ProductionDashboard` | Added visually-hidden `<h1 className="sr-only">` for the document outline (a11y #8) — visible dense summary strip **unchanged**. Point-change direction tokenized (`emerald→success` / `red→destructive`). | Dense summary strip literals (Live-badge emerald, avg-FPY emerald, retest yellow/red, low-yield yellow) + `yieldColorMap`/`yieldBarBg` 3-step graded scales + defect-tag identity palette + Pareto hex left — the intentional dense kiosk layout (brief: do NOT restructure). |
| `MachineHealthMonitoring` | Status literals tokenized: `HealthStatusBadge` (green/yellow/red→success/warning/destructive), 3 summary tiles (Healthy/Attention/Maintenance green/yellow/red + `/10` icon-chip tints), FactorCard trend arrows, failure-risk number, Alerts-tab critical/warning card border+bg+icons, "all good" check. | **Kept the coloured `Heart text-red-500` header icon** (brief — no primary chip). Summary tiles NOT swapped to `MetricCard` (coloured `bg-*-500/10` icon chips ≠ MetricCard's fixed primary chip). Blue "Health TB" average = neutral identity (no clean token). FactorCard/HealthGauge 4-step graded scale + all SVG/chart hex left (domain). |
| `CarbonDashboard` | — (no change; disciplined leave). | **Kept the branded green `Leaf text-emerald-600` header** (brief — PageHeader chip would drop the green). Local `KpiCard` (label-left / accent-icon-right, per-card amber/emerald/blue/violet accents) ≠ `MetricCard` shape → left. All accent colours are category/brand identity (not status); chart hex left. Nothing cleanly maps → no-op is correct. |
| `MESControlTower` | — (KPI cards left; already got `PageHeader` in W1). | 4 KPI cards are `text-3xl` **label-above-value in `CardHeader`, no icon chip** — `MetricCard` (value-above-label, `text-2xl`, primary chip) cannot reproduce them pixel-closely → **left, per brief (W3/W4)**. Local `StatusBadge` uses shadcn Badge variants (no raw colour literals) → unify with pattern `<StatusBadge>` in W4. |

**Deferred to a later wave (W2 parts intentionally left):**
- `MESControlTower` / `OEEDashboard` overview KPI cards → **W3/W4** (label-above-value `text-3xl` shape needs a new "stat card" pattern variant before a pixel-safe swap).
- Graded threshold-colour scales (FPY/NG-rate good→warn→bad, health 4-step, SEMI-E10 6-state) → **W5 a11y sweep** (need a tokenized graded-scale ramp, not the 3-tone status set).
- `CarbonDashboard` / `MachineHealthMonitoring` branded & category-identity colours (Leaf green, EnPI blue, units violet, Heart red) → left indefinitely by design (brand accents, not status).

---

## 7.7 Wave 3 — migrated pages (list/detail/editor/admin/registry headers)

Pixel-preserving header swaps to the shared `<PageHeader>` across registry / master-data / admin / analytics-list pages. Same discipline as W1–W2: the canonical **icon-chip** transform (inline icon → `bg-primary/10 text-primary` chip) and the **subtitle → `text-sm text-muted-foreground`** normalisation are the sanctioned pixel-parity deltas (identical to the W1 `MESControlTower`/`QualityCockpit` swaps). No data / logic / layout was restructured; all `t()` i18n + behaviour preserved. Where the title carried an inline `<ViewOnlyBadge>` (in the `h1`), it was preserved **inline** by passing the title as a `<span className="flex items-center gap-2">` node (NOT the under-title `badge` slot) so the layout is unchanged. `npm run check` + `vite build` both green.

> **No abstract templates built.** The brief's tangible deliverable is header migration + status-literal tokenisation, explicitly *not* speculative "template" components (Dashboard/List/Detail/Editor/Wizard scaffolds). Those were **not** created — zero build risk, and the shared `PageHeader`/`MetricCard`/`SectionCard` primitives already are the reusable layer.

| Page | What was swapped |
|---|---|
| `SitesRegistry` | Header → `PageHeader`. Was already the literal hand-rolled chip shape; title keeps the inline `ViewOnlyBadge` (title-span); enroll + add-site buttons → `actions`. |
| `ModulesMarketplace` | Header → `PageHeader`; licensed-count `Badge` → `actions`. (Was already chip-shaped — near byte-identical.) |
| `EdgeNodesPage` | Header → `PageHeader`; `ViewOnlyBadge` → `badge` slot (it already sat under the title); refresh + register buttons → `actions`. |
| `ApiKeysPage` | Header → `PageHeader`; inline title `ViewOnlyBadge` preserved via title-span; create button → `actions`. |
| `AuditLogs` | Header → `PageHeader` (icon+title+subtitle, no actions). `text-primary` icon → matching primary chip. |
| `EnhancedAuditLogs` | Header → `PageHeader`; refresh + export-CSV buttons → `actions`. |
| `DataComparison` | Header → `PageHeader`; refresh button → `actions`. |
| `ReportBuilder` | Header → `PageHeader`; conditional (`activeTab==="list"`) create button → `actions` (undefined otherwise). |
| `DeviceAdapterManagement` | Header → `PageHeader`; inline title `ViewOnlyBadge` preserved via title-span; separate sibling `<p>` description folded into `description`; create button → `actions` (guarded by `canCreate`). `text-rose-600` icon → primary chip. |
| `RecipeManagement` | Header → `PageHeader`; inline title `ViewOnlyBadge` preserved via title-span; new-version button → `actions`. `text-indigo-600` icon → primary chip. |
| `InterlockRuleManagement` | Header → `PageHeader`; inline title `ViewOnlyBadge` preserved via title-span; sibling `<p>` subtitle folded into `description`; new-rule button → `actions`. `text-rose-600` icon → primary chip. |
| `WorkstationManagement` | Header → `PageHeader` (no icon → identical title block); inline `ViewOnlyBadge` preserved via title-span; `PermissionGate`-wrapped add button → `actions`. |
| `MachineRegistration` | Header → `PageHeader`; open-wizard + refresh buttons → `actions`. Uncoloured `HardDrive` icon → primary chip. |
| `BackupRestore` | Header → `PageHeader` (icon+title+subtitle, no actions). Uncoloured `Archive` icon → primary chip. |
| `MachineOnboardingWizard` | Header → `PageHeader` (no icon, no actions — plain title+subtitle inside the centred `max-w-3xl` wrapper; block layout unchanged). |

**Status-literal tokenisation (W3):** the W3 batch is registry/admin/list pages whose headers carried **no** raw status-colour literals (the coloured header glyphs are decorative icons, now the primary chip — not status signals; the only colours present are `ViewOnlyBadge`'s own themed styles). So no `text-*-500` → semantic-token swaps were needed on the migrated pages. (Graded/threshold-scale tokenisation remains a W5 concern.)

**Evaluated but LEFT (with reason):**

| Page | Reason left |
|---|---|
| `WorkOrdersPage` | §7.2 case — title is `text-2xl font-**semibold**` (not bold) and the icon/badges/summary/create-button all share one flex-wrap row; `PageHeader` forces `font-bold` → weight change, not pixel-preserving. (Native `<select>` a11y labels already fixed in W1.) → keep. |
| `WipLineBalance` | §7.2 case — header + a labelled filter **input** share an `items-end justify-between` row; `PageHeader` is `items-center` → shifts the input's baseline. → keep. |
| `ProcessManagement` | §7.2 case — `<ViewOnlyBadge>` inline in `h1` *and* the outer row is `flex-col md:flex-row md:justify-between` (stacks on mobile); `PageHeader`'s non-stacking `flex flex-wrap items-center` changes the responsive layout. → keep. |
| `MasterDataManagement` | Title is `text-2xl font-**semibold**` + two inline badges (`MES/MOM` + `ViewOnlyBadge`) tightly coupled in the title row → weight change + badge-coupling, not a clean drop. → keep. |
| `ThresholdApprovalsPage` | Title is `text-2xl font-**semibold**` with an inline queue `Badge` → weight change. → keep. |
| `Users` | Header lives inside a `CardHeader` (`CardTitle`/`CardDescription`, responsive `flex-col md:flex-row`) — not a page-level `h1`; swapping would restructure the Card. → keep (W4/W5). |
| `RoleBuilder`, `MqttAlertRules`, `ScheduledReports` | Header is otherwise clean, but the action row contains a **large inline `<Dialog>` (trigger + full DialogContent)**; relocating that whole block into `actions` is verbose/higher-risk for a marginal header gain (RoleBuilder also flips an *uncoloured* icon to a coloured primary chip; MqttAlertRules' `text-yellow-400` warning glyph is an intentional accent). → keep (revisit when the create-dialog is extracted). |
| `MqttDashboard` | Responsive `text-xl sm:text-2xl` title (fixed-size mismatch, same class as the W1 `Dashboard`/`OEEDashboard` skips) → keep. |
| `CategoryAnalytics`, `FederationDashboard` | Clean `text-2xl font-bold` titles but the outer row is responsive `flex-col md:flex-row md:justify-between` with compound action clusters (multiple `Select`s + buttons); `PageHeader`'s non-stacking flex changes the mobile layout → keep. |
| `Reports` | No in-page header block — title is delegated to `DashboardLayout` → N/A. |
| `CorrelationAnalysis` | The "header" is a `CardHeader`/`CardTitle` inside a setup Card, not a page-level header → N/A. |

---

## 8. Verification (F1b)
- `npm run check` (tsc --noEmit): **clean** ✔
- `vite build`: **clean** (`✓ built` ~18s; FleetOrchestration / SafetyWorkforce / DigitalTwinCenter all built) ✔
- Existing token values: **unchanged** (only additions). Existing shadcn component APIs: **unchanged**. ✔
- Visual: the 3 automation pages keep identical pixels (shared MetricCard/PageHeader reproduce the original classes; Twin untouched). ✔
