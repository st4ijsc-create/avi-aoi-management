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

## 8. Layout

- **Kiosk shell.** Nameplate header (machine/app identity + status lamp + shift + clock) → tab rail → content. **The page never scrolls**; panels scroll internally (`hmi-scroll`).
- Responsive: the reference is fixed 1920×1080, but ours must fill whatever the WebView2 window is. Use flex/grid that fills the viewport; no horizontal page scroll at 1280px.
- Dense but not cramped: 3–4px base spacing unit, generous panel padding (14–20px).

## 9. Quality floor

- axe AA (no serious/critical), **light and dark**. Muted greys and navy-on-paper must be re-checked — several current tokens will fail once values change.
- Keyboard focus visible on every control; `prefers-reduced-motion` kills schematic/blip animation.
- i18n vi/en parity maintained (compile-enforced); the bilingual gloss uses the inactive language.
- No page horizontal scroll at 1280px.
