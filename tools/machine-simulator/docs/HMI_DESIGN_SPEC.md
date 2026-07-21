# ST4I Machine Simulator — Industrial HMI Design Spec

**Direction: "Bản vẽ kỹ thuật sống" (Living blueprint).** The interface is a technical drawing of the machine — and it moves with the machine. Every panel is a drawing sheet with registration marks; the centrepiece of each machine is an animated wireframe schematic driven by real state.

Derived from an industrial HMI reference the client supplied (a screwdriving-cell operator panel), adapted to ST4I brand navy and to our three machine classes. **This spec is the source of truth — follow it exactly.**

---

## 1. Ground rules (non-negotiable)

- **Radius 0 everywhere.** No rounded corners on any panel, button, input, tag, badge, dialog.
- **Hairline borders, no drop shadows.** 1px `--color-divider`. The ONLY shadows are on physical control buttons (see §6).
- **Tabular numerals on every number** (`font-variant-numeric: tabular-nums`).
- **Bilingual labels.** Primary text in the active UI language; a small UPPERCASE gloss in the other language beneath/beside it. This is the industrial register, not decoration.
- **Fills are flat.** No gradients except the E-STOP dome.
- **Offline-only.** Fonts must be self-hosted/bundled — never fetch from a CDN. The app ships as a standalone offline .exe.

## 2. Colour tokens

Light ("shop floor" — default):
```
--color-bg:       #f2f2f3   /* cool paper ground */
--color-surface:  #e9e9ea   /* panel */
--color-text:     #1d1f20   /* ink */
--color-divider:  color-mix(in srgb, #1d1f20 16%, transparent)
```
Dark ("control room"):
```
--color-bg:       #15171a
--color-surface:  #1e2126
--color-text:     #e9eaec
--color-divider:  color-mix(in srgb, #e9eaec 16%, transparent)
```

Accent — **ST4I navy** (brand). Base is deep, so tints/hovers are defined explicitly:
```
--navy-50:  #f0f3fa    --navy-500: #4762ae
--navy-100: #dde4f4    --navy-600: #30498f
--navy-200: #c0cdea    --navy-700: #1E3A8A   /* BASE — brand accent */
--navy-300: #97abdc    --navy-800: #16295f
--navy-400: #6b84c8    --navy-900: #0f1c42
--color-accent: var(--navy-700)
```
On dark ground the accent must lift to stay legible: `--color-accent: #7f9be0` (use navy-400/300 range). Never place navy-700 text on the dark ground.

Status ramp (identical in both themes — these carry safety meaning, keep them stable):
```
--status-run:   #2f8f5a   /* running / OK / pass */
--status-warn:  #c98a1a   /* warning / paused / drift */
--status-fault: #c0392b   /* fault / NG / E-STOP */
--status-idle:  #7a7a7d   /* idle / stopped / no data */
```
Status colours are for **state only**. Do not use them decoratively — that is what makes a real HMI readable at a glance.

## 3. Typography

- **Display / headings / all large numerals: `Barlow Condensed`, weight 600.** Condensed industrial signage face. Tight leading (1.05–1.15), slight negative tracking on large sizes.
- **Body / UI: `Barlow`, 400 / 500 / 700.**
- **Data, logs, IDs, wire payloads: monospace** (`ui-monospace, Menlo, Consolas, monospace`).
- **Micro-label** (the workhorse): 9.5–11px, `letter-spacing: .10–.14em`, `text-transform: uppercase`, muted (`text` at ~55–70% opacity). Carries the secondary-language gloss and every field caption.

Both families must be **installed as local packages** (`@fontsource/barlow`, `@fontsource/barlow-condensed`) and imported in code — Vietnamese subsets included. Verify at runtime that no request goes to fonts.googleapis.com.

Scale: readouts 34–44px · panel titles 17–20px · body 13–15px · micro 10px.

## 4. The signature: blueprint registration corners

Every panel is a drawing sheet. Four L-shaped registration marks **overhang** the corners:

```css
.sheet { position: relative; border: 1px solid var(--color-divider); border-radius: 0; }
.sheet > .corner { position: absolute; width: 11px; height: 11px;
  color: color-mix(in srgb, var(--color-text) 55%, transparent); }
.sheet > .corner::before, .sheet > .corner::after { content:""; position:absolute; background: currentColor; }
.sheet > .corner::before { left: 5px; top: 0;  width: 1px;  height: 100%; }
.sheet > .corner::after  { top: 5px;  left: 0; width: 100%; height: 1px;  }
.sheet > .corner.tl { top:-6px; left:-6px }   .sheet > .corner.tr { top:-6px; right:-6px }
.sheet > .corner.bl { bottom:-6px; left:-6px } .sheet > .corner.br { bottom:-6px; right:-6px }
```
Because the marks sit outside the box, a `.sheet` must never live inside `overflow:hidden`. Provide this as a React `<Sheet>` primitive that renders the four corner spans — do not hand-write corners at call sites.

Use it for panels and framed readouts. Do **not** put registration marks on every small element — restraint is what keeps it looking engineered rather than busy.

## 5. Required primitives (`components/industrial/`)

| Primitive | Purpose |
|---|---|
| `<Sheet>` | Blueprint panel: hairline frame + 4 registration corners. Optional `title` + `titleEn`. |
| `<MicroLabel vi en>` | Primary label (active language) + uppercase gloss (other language). |
| `<Readout value unit label labelEn sub tone>` | Big tabular numeral + unit + micro-label + sub-note. Optional donut gauge. |
| `<StatusLamp state>` | Pulsing dot + label + sub, coloured from the status ramp. `blip` animation only when live. |
| `<LogTag level>` | Fixed-width coloured INFO / OK / WARN / ERROR tag for the log. |
| `<ControlButton>` | Large physical button (see §6). Variants: start / pause / reset / estop. |
| Grid ground | 28px `repeating-linear-gradient` graph-paper backdrop for schematic areas. |

Also restyle globally: inputs, segmented controls, radios (square 20px thumbs on 4px rails for sliders), tables (uppercase hairline headers), dialogs (framed sheets), toasts, and a thin square custom scrollbar.

## 6. Physical controls

Operators reach for these — they must feel like hardware.

- **START**: ~96px tall, navy fill, large condensed label + English gloss, play glyph.
- **PAUSE**: ~82px, amber-tinted surface with amber border/text.
- **E-STOP**: ~150px, red radial dome `radial-gradient(circle at 50% 38%, #e0503f, #b5271a 62%, #8f1d12)`, 3px `#7d1f16` border, white octagon-warning glyph, and a physical base `box-shadow: 0 6px 0 #6d160d` that collapses to `0 2px 0` with `translateY(4px)` on `:active`. This is the one place a shadow is allowed.
- Disabled = flat neutral, `cursor: not-allowed`, no shadow.
- All must be keyboard-focusable with a visible focus ring, and honour `prefers-reduced-motion`.

## 7. The living schematic — per machine class

The centrepiece. A wireframe SVG of the actual machine, `vector-effect: non-scaling-stroke`, on the graph-paper ground, with a technical caption (`FIG. 01 — …`) and dimension callouts. It animates **only while the machine is running**, and reflects real state.

- **Automation / SCREWDRIVE / ASSEMBLY** — gantry beam, traversing driver head (scan animation), spinning bit, feeder with remaining-screw count, Z-axis stroke.
- **AOI / AVI / SPI / inspection** — conveyor, camera head sweeping a PCB outline, **measurement points drawn from the real product config, lighting green/red as OK/NG results arrive.** This ties the schematic to the config-sync data we built — make this the strongest one.
- **IoT sensor / gateway** — sensor node, emitting signal arcs, data packets travelling to an uplink, sample-rate ticks.

Pick the schematic from the machine's `deviceClass`. Idle state = static drawing, no motion.

**H5b — `viewBox` aspect must match the COLUMN it fills, not a full-width strip.** H5's layout rework
(§8) put the schematic in a column that's taller than it is wide at the 1280×800/1600×1000 floor
(~0.85:1) — a `viewBox` tuned to a wide full-width sheet (H5's own `520×244`, ~2.13:1) "meet"-scales
WIDTH-first inside that column, leaving large empty graph-paper bands above and below the drawing
(measured live: ~44% fill at 1280×800, worse than the H2b regression this same rule already warns
about once). The fix each schematic component (`AutomationSchematic`/`AoiSchematic`/`IotSchematic`)
now follows: grow the `viewBox` HEIGHT with genuine added machine geometry — taller portal-frame legs,
a longer camera-gantry drop, mounting poles under the IoT node/tower — never blank padding, per
`MachinePlinth`'s own established discipline — until the drawing fills ~85–90% of its column at both
floor sizes (verified live via screenshot, not computed blind). Every in-drawing label's `fontSize`
was also bumped (~25–30%) in the same pass — the reference distance is ~50cm, and the H5 column reflow
left several (feeder/Z-axis/node/uplink labels, dimension callouts) too small to read at that
distance even where the drawing itself fit.

## 8. Layout

**H5 (2026-07) — rewritten from scratch.** The previous version of this section was one paragraph of
prose ("Nameplate → tab rail → content") with no concrete grid, region list, or proportions — the
layout drifted from it silently (schematic stacked ABOVE the readouts instead of beside them, the log
outweighing the control rail 1.8×, output reduced to a 29px footer) because there was nothing specific
enough here to drift FROM. This section is now the literal source of truth for `Hmi.tsx`'s structure;
a change to the region grid below requires updating this section in the same change.

### 8.1 Region grid ("Scheme A" — three-column SCADA)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ NAMEPLATE — fixed 80px band, full width, never scrolls                    │
│ [reserved: TAB RAIL band lands here, directly under the nameplate,        │
│  once a machine-settings tab is added — spec intentionally leaves this    │
│  row empty today rather than shipping a one-tab rail that looks broken]   │
├──────────────────┬───────────────────┬───────────────────────────────────┤
│                  │                    │  OUTPUT / SPC card (auto height)  │
│  SCHEMATIC PANEL │  OPERATING         │  ── gap-3 ──                      │
│  (flex-grow per  │  READOUTS          │  PHYSICAL CONTROLS                │
│  device class)   │  (flex-grow per    │  (flex-1 — fills all REMAINING    │
│  + caption/       │  device class)     │  height in this column; E-STOP   │
│  readout strip    │                    │  is the single largest control)  │
│  under the        │                    │                                    │
│  drawing          │                    │  fixed width: 336px, shrink-0     │
├──────────────────┴───────────────────┴───────────────────────────────────┤
│ SYSTEM LOG — full-width band, low visual weight                           │
└──────────────────────────────────────────────────────────────────────────┘
```

This is a **3-region vertical stack** (nameplate / main row / log band), where the main row is itself
a **3-column flex row**. Implementation (`Hmi.tsx`):

- Outer shell: `flex h-svh flex-col overflow-hidden` — the ONE element allowed to define the page's
  total height; nothing inside it may push past it (spec §9: no page scroll, ever).
- Main row: `flex min-h-0 flex-[5] gap-3 p-3 pb-0` — three children, `gap-3` between them.
- Log band: `flex min-h-0 flex-[1.5] m-3` (mt implied by the row's own `pb-0` + the log's own margin)
  — **the `5:1.5` flex ratio between the main row and the log band is deliberate, not arbitrary**:
  H5b (this pass) loosened it from the original `5:1` — at `5:1` the log was ~2 visible rows at the
  1280×800 floor, not a "persistent band" an operator would glance at. `5:1.5` is the loosest ratio
  that keeps the control rail's own worst-case (E-STOP-latched) content fitting **with real margin**
  at 1280×800 — re-verified live via `scrollHeight`/`clientHeight` on `ControlColumn`'s scroll
  container, combined with trimming that column's own padding (§8.3). Do not loosen this further
  without re-running that same check.

### 8.2 The three main-row columns

| Column | Sizing | Contents |
|---|---|---|
| **Schematic** | `flexGrow` per device class (§8.4), `flexBasis: 0`, `min-w-0 min-h-0` | `<Sheet>` → wireframe SVG (flex-1, fills available height) → `<SchematicCaptionStrip>`, a fixed `h-9` row directly under the drawing carrying the ONE class-specific live reading (feeder remaining / AOI product+points+defects / IoT latest reading) — **live numeric callouts never render inside the SVG canvas itself** (spec §7); the drawing stays a clean wireframe, the strip is where the numbers live. |
| **Readouts** | `flexGrow` per device class (§8.4), `flexBasis: 0`, `min-w-0 min-h-0` | `<Sheet>` wrapping `<ReadoutGrid>`, an `@container`-queried tile grid — **2 columns below a ~672px container width (`@2xl`), 4 columns above it.** This MUST be a container query, not a `lg:`/viewport breakpoint: this column is roughly a third of the viewport width, so a viewport-relative breakpoint has nothing to do with how wide the panel actually is (this was a real bug — see the git history around H5). Each tile's `<Readout labelLayout="stack">` — H5b: at this column's narrowest (2-column, 1280×800 floor) a tile is only ~160–200px wide, too narrow for an inline vi label + uppercase en gloss on one line without ellipsis-truncating real words (live-reproduced: "CHỈ SỐ QUY T…", "TRẠNG THÁI CẤ…", "TỶ LỆ …"). `labelLayout="stack"` (spec §1's "beneath" option, `Readout.tsx`) puts the gloss on its own line instead of sharing the row; combined with shortening the 3 worst-offending strings (`i18n/vi.ts`'s `hmi.readout.metric`/`configState`/`passRate`), no label truncates at the floor. This is opt-in per call site — `KpiTile`/`OutputCard` keep the default inline layout, they have more room. |
| **Output + Controls** | Fixed `w-[336px] shrink-0` (never grows/shrinks with viewport — the physical control sizes in §6 are themselves fixed px, so the rail that holds them is fixed too), `flex flex-col gap-3` | `<OutputCard>` (`shrink-0`, natural content height — OK/NG/Total as `<Readout>` tiles + a proportional bar) stacked above `<ControlColumn>` (`min-h-0 flex-1` — fills every remaining px in the column). |

Schematic and Readouts are the only two columns that flex — their combined width is whatever's left
after the fixed 336px rail (plus two 12px gaps). **Both need `min-w-0` AND `min-h-0`** (flex items
default to `min-width/min-height: auto`, which blocks shrinking below content size — omitting either
reintroduces horizontal or vertical overflow).

### 8.3 The control rail's own worst-case fit (why RESET sits beside E-STOP, not below it)

The control rail is the one region with a REAL "does it fit" constraint, because its content is a
fixed set of physical-sized buttons (§6), not something that can reflow to a smaller viewport the way
text or a grid can. Two states exist:

- **Normal**: banner absent, `[START, PAUSE]` row, `[E-STOP]` row.
- **E-STOP engaged**: a one-line fault banner, `[START, PAUSE]` row (both disabled — same DOM
  presence as normal, just `disabled`), `[E-STOP, RESET]` row.

**RESET renders BESIDE E-STOP, in the same row, not stacked below it as a fourth element.** An
earlier build stacked banner + Start/Pause row + E-STOP + RESET as four separate vertical blocks; at
the 1280×800 floor this overflowed the rail's available height by ~70–160px depending on how much
other spacing was trimmed, and because nothing was clipping it, the overflow silently reflowed UNDER
the system-log band below — RESET's own click target was there, geometrically, but a `SystemLog`
element painted on top of it intercepted every pointer event (`test:e2e`'s RESET-click assertions
caught this as a 45s timeout, not a visible bug in a screenshot). Putting RESET beside E-STOP instead
of below it means the E-STOP-engaged state only ever adds the banner's height (~40px) over the normal
state's, which fits.

If a future change adds ANOTHER control, re-check this fit at 1280×800 before shipping — the rail's
own body is wrapped in a defensive `overflow-y-auto` (`hmi-scroll`) as a fallback (scrolls rather than
silently overlapping if it ever doesn't fit), but that fallback existing is not permission to stop
checking; an operator should never have to scroll to find RESET.

**H5b — anchoring, not centring.** The rail used to vertically CENTRE the whole button cluster
(`m-auto`) inside its `flex-1` body. Two problems: at 1600×1000 the rail is tall (~500px) and the
cluster only fills its middle third, reading as dead space above and below rather than a deliberately
filled control column; and centring is not position-STABLE — growing the block by the E-STOP-latched
banner's height shifts the whole centred block down, moving E-STOP by roughly half the banner's height
every time it latches, which breaks the "operator builds muscle memory for E-STOP's position"
convention this same section already argues for. Fix: `[START, PAUSE]` anchors to the TOP of the rail
(`shrink-0`); `[E-STOP]`/`[E-STOP, RESET]` (+ the banner, when present) anchors to the BOTTOM via
`mt-auto` on its own wrapper, with the banner rendered ABOVE the button row inside that same wrapper.
Because the button row is the wrapper's last child, the banner appearing only grows the wrapper
upward — **E-STOP's distance from the rail's bottom edge is now identical latched or not, on every
machine class.** The gap this opens between the two clusters at tall viewports is real breathing room,
not a leftover margin.

**H5c — SAFETY RULE, made explicit (this area regressed twice before this rule existed):**

> **Safety controls (E-STOP, RESET) never scroll into view, and never move position between states,
> at 1280×800 or above.** A control an operator reaches for under pressure, with gloves, without
> looking, must already be on-screen and must already be in the SAME place — "scroll to find it" or
> "it moved 4px because a banner appeared" are both failures, not degraded-but-acceptable states.

H5 and H5b both believed they'd satisfied this and were both wrong in live-measurable ways:

- H5 shipped a passive `overflow-y-auto` fallback on the rail ("scrolls rather than clipping") and
  treated that as sufficient. Live-reproduced: loading `/hmi/:code` directly into an already-latched
  fleet left RESET below the visible area, un-scrolled by default, so `elementFromPoint` at RESET's own
  centre hit the wrong element — a passive fallback the operator has to discover on their own isn't a
  fix for a safety control.
- H5b's follow-up added a `React.useEffect` that called `resetRef.current?.scrollIntoView()` the
  instant the rail became latched, and separately claimed the `mt-auto` bottom-anchor kept E-STOP's
  position stable. Both were wrong under measurement: `scrollIntoView` is itself an admission that the
  rail is a scrolling region — it does not stop the region FROM scrolling, it just automates the scroll
  a real operator would otherwise have to do by hand. And `mt-auto` only holds a fixed offset from the
  bottom edge while its content actually FITS the container; the instant the latched content (banner +
  RESET) overflowed, the auto margin collapsed to 0 and the whole cluster re-anchored to the TOP of the
  rail instead — live-measured at 1280×800: `clientHeight − scrollHeight = −41px` while latched, and
  E-STOP's own `getBoundingClientRect()` shifted between states as a direct result.

**The structural fix (current build):** every element in the bottom-anchored cluster now has a
CONSTANT footprint in every state, so there is nothing left for `mt-auto` to collapse differently
between states, and the rail's content height literally cannot depend on whether it's latched:

- The fault banner slot is always in the DOM at its real size — latched, real content; unlatched, a
  same-size `aria-hidden` placeholder with matching border/padding/font classes (so its box is
  pixel-identical without a hand-picked px value).
- The RESET slot is likewise always in the DOM at `CONTROL_BUTTON_SIZE_CLASS.reset`'s real footprint —
  latched, the real button; unlatched, a same-size `aria-hidden` placeholder `<div>`. (`ControlButton`
  exports that size map so the placeholder can never drift out of sync with the real button.)
- `ControlButton`'s own `pressed` (latched) skin used to add a permanent `translate-y-1` transform to
  read as "the dome physically collapsed" — live-measured, that alone moved E-STOP's own bounding box
  4px the instant it latched. Removed; the "pressed in" cue now comes entirely from the box-shadow
  collapsing (6px → 2px), a purely cosmetic change with zero geometry impact.
- With the cluster's height now constant, the remaining requirement is that the CONSTANT (always
  latched-size) content actually fits the 1280×800 floor with real margin, not just avoids negative
  slack — the row:log flex ratio (§8.1) and the rail/output-card's own padding (§8.5) were re-tuned so
  the worst case (latched, both slots real) leaves comfortably over 10px of vertical slack, verified
  live via `wrapper.children[0].height + wrapper.children[1].height + padding` vs `clientHeight` (not
  `scrollHeight` alone — see the gotcha below).
- `hmi-scroll overflow-y-auto` stays on the rail's outer wrapper as defence-in-depth ONLY — it is
  never actually engaged (`scrollHeight <= clientHeight` holds in every state, asserted by
  `tests/12-hmi-safety-rail.spec.ts`), not the mechanism relied on to reach RESET.

**Gotcha for anyone re-verifying this fit:** the rail's inner wrapper is `min-h-full`, so once its
content is shorter than the container, `scrollHeight` clamps UP to `clientHeight` and always reports
`0` slack — `scrollHeight`/`clientHeight` alone can prove "does it overflow" (yes/no) but NOT "how much
margin does it have." Measure the real content blocks' own heights directly to check margin.

### 8.4 Per-device-class proportions

The reference's own fixed 32/43/21 column split is tuned to ONE machine (a screwdrive cell) at ONE
resolution. Ours must hold three visually different machines (a wide gantry cell, a wide-but-denser
AOI board+conveyor cell, a sparse IoT sensor node) — `Hmi.tsx`'s `SCHEMATIC_READOUT_FLEX` map sets the
schematic:readout `flexGrow` ratio per `deviceClass`:

| Class | Schematic : Readout | Why |
|---|---|---|
| `Automation` | `1 : 1` | Gantry cell reads evenly between drawing and data. |
| `AoiAvi` | `1.15 : 1` | The board + real measurement-point dots need to stay legible (spec §7: "make this the strongest one") — the one class that earns extra width. |
| `Iot` | `0.85 : 1.15` | The node/link/uplink wireframe is comparatively sparse; give the reclaimed width to the readout grid instead of leaving it as schematic dead space. |

The control rail's fixed 336px width does NOT vary per class — it's sized to the physical buttons
(§6), which are the same across every class.

### 8.5 Responsive floor and page-scroll rule

- **1280×800 is the floor** (the operator panel-PC size this app targets) and **1600×1000 / 1920×1080**
  are the sizes it's verified against above that. Unlike the reference (fixed 1920×1080, breaks below
  ~1440px with a forced horizontal scroll), this app has no fixed target resolution — the WebView2
  kiosk window isn't guaranteed to be any particular size, so every region above uses flex/grid that
  fills whatever viewport it gets, not a hard-coded px canvas.
- **The page itself never scrolls, at any of the sizes above** — `document.documentElement.scrollHeight
  === clientHeight` must hold. Only two things are EVER PERMITTED to become scrolling regions, both via
  the shared `hmi-scroll` utility class: the readout grid's tile list and the system log's row list —
  both non-safety, informational panels where "scroll for more" is a normal, expected affordance. The
  control rail carries the same `hmi-scroll` class as defence-in-depth only (§8.3's H5c rule): it must
  never actually need to scroll, in any state, and that is verified by measurement, not assumed from
  the class being present. No `overflow-y-auto` belongs anywhere else in this tree — if a region needs
  one to stop overflowing, that's a sign its sizing budget is wrong, not that it needs a scrollbar.
- No horizontal scroll at any width down to 1280px.
- Dense but not cramped: 3–4px base spacing unit, generous panel padding (14–20px) on panels with
  headroom to spare; the control rail (§8.3) is the one region allowed to trim padding/gaps tighter
  when the worst-case fit demands it.

## 9. Quality floor

- axe AA (no serious/critical), **light and dark**. Muted greys and navy-on-paper must be re-checked — several current tokens will fail once values change.
- Keyboard focus visible on every control; `prefers-reduced-motion` kills schematic/blip animation.
- i18n vi/en parity maintained (compile-enforced); the bilingual gloss uses the inactive language.
- No page horizontal scroll at 1280px.
