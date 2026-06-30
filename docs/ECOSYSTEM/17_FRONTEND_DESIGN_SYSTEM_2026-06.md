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

## 7. Rollout plan (migrate the other pages over time — NOT done now)

Goal: converge the 151 pages onto the DS without a risky big-bang. Order by traffic + churn.

1. **Wave 0 (done):** ship tokens + components; adopt in 2 new automation pages (Fleet, Safety) as the reference.
2. **Wave 1 — new pages only:** every page added from now on MUST use `PageHeader` + `MetricCard` + `StatusBadge` + `SectionCard` + `<Heading>`. Enforce in review.
3. **Wave 2 — high-traffic cockpits:** DigitalTwinCenter, dashboards, MES/Quality cockpits — swap headers/KPIs/status helpers to the shared components; replace literal `text-amber-500`/`text-emerald-500` with `text-warning`/`text-success` tokens (fixes a11y finding #1).
4. **Wave 3 — list/detail/editor templates:** define the canonical templates (Dashboard, List+Filter, Detail, Editor split-pane, Wizard, Realtime-monitor, 3D-scene) from doc 16 §12.2 and migrate per module.
5. **Wave 4 — a11y sweep:** run axe/WAVE on ~15 core pages → WCAG AA; fix the §5.4 findings.
6. **Wave 5 — Storybook + visual regression:** install per §6, add stories for the 53 shadcn components + patterns + token playground; optional Chromatic/Playwright visual diffs.

**Migration is mechanical and low-risk per page:** import from `@/components/patterns`, delete the local `MetricCard`/header/badge helper, pass the same props. Each page is independent — no shared-state churn. Track with a checklist in the module registry.

---

## 8. Verification (F1b)
- `npm run check` (tsc --noEmit): **clean** ✔
- `vite build`: **clean** (`✓ built` ~18s; FleetOrchestration / SafetyWorkforce / DigitalTwinCenter all built) ✔
- Existing token values: **unchanged** (only additions). Existing shadcn component APIs: **unchanged**. ✔
- Visual: the 3 automation pages keep identical pixels (shared MetricCard/PageHeader reproduce the original classes; Twin untouched). ✔
