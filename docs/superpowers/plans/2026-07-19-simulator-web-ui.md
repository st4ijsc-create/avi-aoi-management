# Simulator Web UI (Doc 65) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Load **frontend-design** skill before any visual/UI task.

**Goal:** Rebuild the ST4I Machine Simulator UI as a professional **web app** (React 19 + Vite + Tailwind 4 + shadcn/ui + framer-motion + Recharts) with a **white-dominant + navy** design system, driving the **existing proven C# EdgeCore engine** via a local HTTP/WebSocket API, packaged with **Tauri 2** as a standalone offline desktop app for the exhibition (14 days).

**Architecture:** A self-contained Vite app (`tools/machine-simulator/web/`) talks over `localhost` HTTP + WS to a new thin C# host (`St4i.EngineApi`) that wraps the tested EdgeCore fleet/pipeline (NO Go/Rust rewrite — that is the post-exhibition roadmap, doc 66). Tauri spawns the engine as a sidecar. The web IA ports the 7 proven WPF screens 1:1 at much higher visual quality.

**Tech Stack:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui (Radix), lucide-react, Recharts, framer-motion, @tanstack/react-query, wouter, Tauri 2. Engine: C# .NET 10 (EdgeCore + ASP.NET minimal API). Verify: Playwright + axe-core + visual snapshots.

## Global Constraints

- **Workspace:** the existing worktree `D:/SOURCES/avi-aoi-sim` (branch `feat/machine-simulator` — isolated from the concurrent HMI session on the main tree). Web app at `tools/machine-simulator/web/`; engine host at `tools/machine-simulator/src/St4i.EngineApi/`. Commit via `git -C D:/SOURCES/avi-aoi-sim …`. Do NOT touch `D:/SOURCES/avi-aoi-management` or run git checkout/switch/branch.
- **Design system is law:** white-dominant surfaces (`#FFFFFF`/`#F8FAFC`/`#F1F5F9`), **navy primary `#1E3A8A`** (navy scale 050–900), one accent (teal `#0E9AA7`), semantic status (ok `#16A34A` / warn `#D97706` / danger `#DC2626` / info `#2563EB`). All colors via Tailwind theme tokens / CSS variables — **zero loose hex in components**. Light default + dark via `data-theme`. (Doc 65 §2.)
- **Reuse, don't reinvent:** use shadcn/ui primitives (Radix). The ecosystem's `client/src/components/ui/*` is the reference; generate/adapt equivalents into the web app. Match the ecosystem's stack versions.
- **Engine = C# EdgeCore via API only.** The web UI never embeds simulation logic; it renders engine state and sends commands. The engine reuses `FleetService`/`EdgePipeline`/`EventBus`/transports already built + tested (94 tests). Do NOT modify EdgeCore's tested behavior; only add the API host + any thin adapters.
- **Northbound live path unchanged:** Live/Auto mode still posts to the doc-61 contracts (already verified live); Demo default stays bulletproof offline.
- **Quality gates:** every screen ships with a Playwright E2E happy-path + a visual snapshot + an axe-core a11y pass (contrast AA, focus order, aria). Motion respects `prefers-reduced-motion`.
- **Accessibility + i18n:** vi default + en; all user copy via an i18n dictionary (no hardcoded strings in components).

---

## Task 1: Workspace scaffold — Vite app + Tauri + toolchain check

**Files:**
- Create: `tools/machine-simulator/web/` (Vite React-TS app: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`)
- Create: `tools/machine-simulator/web/tailwind.config.ts` + `src/index.css` (Tailwind 4 entry)
- Create: `tools/machine-simulator/web/src-tauri/` (Tauri 2 scaffold)
- Create: `tools/machine-simulator/web/.gitignore` (node_modules, dist, src-tauri/target)

**Interfaces produced:** a runnable `npm run dev` Vite app; a `tauri` build target (may be deferred if Rust missing — see step 4).

- [ ] **Step 1: Check toolchain.** Run `node --version` (expect ≥20), `npm --version`. Run `rustc --version` / `cargo --version` — Tauri needs Rust. If Rust is MISSING, record it: Tauri packaging (Task 9) will either install rustup or fall back to browser-run; do NOT block the UI build on it. Also confirm WebView2 (Windows has it).
- [ ] **Step 2: Scaffold Vite React-TS app** in `tools/machine-simulator/web/`:
```
cd tools/machine-simulator/web && npm create vite@latest . -- --template react-ts
npm i && npm i -D tailwindcss @tailwindcss/vite && npm i lucide-react recharts framer-motion @tanstack/react-query wouter class-variance-authority tailwind-merge clsx
```
Wire Tailwind 4 via the `@tailwindcss/vite` plugin in `vite.config.ts` and `@import "tailwindcss";` in `src/index.css`. Confirm `npm run dev` serves a page.
- [ ] **Step 3: Init shadcn/ui.** `npx shadcn@latest init` (choose TS, the tokens go into `src/index.css` via CSS variables — we override them in Task 2). Add a first primitive: `npx shadcn@latest add button card badge`.
- [ ] **Step 4: Init Tauri 2** (best-effort): `npm i -D @tauri-apps/cli && npx tauri init` (frontendDist `dist`, devUrl the Vite port). If Rust is absent, scaffold the config but skip `tauri build` until Task 9 (note it).
- [ ] **Step 5: Build gate.** `npm run build` (Vite) → succeeds; `npm run dev` serves. Commit.
```
git -C D:/SOURCES/avi-aoi-sim add tools/machine-simulator/web
git -C D:/SOURCES/avi-aoi-sim commit -m "chore(web): scaffold Vite React-TS + Tailwind4 + shadcn + Tauri for simulator web UI"
```

---

## Task 2: Design system — white/navy tokens + themed primitives

**REQUIRED: load the `frontend-design` skill first.**

**Files:**
- Modify: `tools/machine-simulator/web/src/index.css` (CSS variables: the full white/navy token set from Doc 65 §2.1, light + dark)
- Create: `src/theme/tokens.ts` (typed token refs), `src/lib/utils.ts` (cn helper)
- Create: `src/routes/_tokens.tsx` (a dev-only "design tokens + components" showcase page)

- [ ] **Step 1: Write the token layer.** In `src/index.css` define CSS variables for surfaces (`--surface-base/#FFFFFF`, `--surface-subtle/#F8FAFC`, `--surface-muted/#F1F5F9`, `--surface-card`), border (`#E2E8F0`), navy scale (050 `#F4F7FC` → 600 `#1E3A8A` → 900 `#0B1B34`), text (strong/body/muted), accent (teal 100/500/600), status (ok/warn/danger/info/neutral), radius (8/12/999), shadow (sm/md/lg). Map them into Tailwind theme (`@theme` in Tailwind 4) so classes like `bg-surface-subtle text-navy-700 border-border` work. Provide a `:root[data-theme="dark"]` override. Set Inter font.
- [ ] **Step 2: Re-theme shadcn primitives** so Button/Card/Badge/Input use the navy/white tokens (primary = navy-600, ring = navy focus, card = white + border + shadow-sm). No loose hex.
- [ ] **Step 3: Motion + base layout.** Add framer-motion; a `MotionConfig` respecting `prefers-reduced-motion`; base typography/spacing utilities.
- [ ] **Step 4: Showcase + visual verify.** Build `_tokens.tsx` rendering the palette swatches + Button/Card/Badge/Input/Table samples. Run the app, and with Playwright: `browser_navigate` to the tokens route, `browser_take_screenshot` → **Read the screenshot** and confirm it reads as clean white/navy, good contrast, professional. Iterate until it does.
- [ ] **Step 5: axe pass** on the tokens page (contrast AA). Commit `feat(web): white/navy design-system tokens + themed shadcn primitives`.

---

## Task 3: Engine API host — wrap EdgeCore over HTTP + WebSocket

**Files:**
- Create: `tools/machine-simulator/src/St4i.EngineApi/St4i.EngineApi.csproj` (net10.0-windows or net10.0, ASP.NET minimal API, refs EdgeCore)
- Create: `Program.cs`, `FleetHost.cs` (reuses the fleet/pipeline build logic from `FleetService`/`EdgeWorker`), `Endpoints/*.cs`, `Hubs/InspectorStream.cs`
- Modify: add the project to `St4iMachineSimulator.sln`

**Interfaces produced (the web app depends on these — exact routes):**
- `GET /v1/health` → `{ ok, mode }`
- `GET /v1/fleet` → `{ machines: [{ code, deviceClass, driverKind, statusText, passRate, cycles, lastCycleSummary, spark:number[] }], kpis:{ online, totalCycles, fpy } }`
- `GET /v1/machines/{code}` → machine detail (spc series, telemetry series, boardPoints[], cycleLog[], driftState)
- `POST /v1/fleet/start` · `POST /v1/fleet/stop`
- `GET /v1/mode` · `PUT /v1/mode {mode:"Live"|"Demo"|"Auto"}`
- `POST /v1/scenario {cycleRate,defectRate,faultRate,networkOutage}` · `POST /v1/scenario/preset {name}` · `POST /v1/scenario/burst`
- `GET /v1/settings` · `PUT /v1/settings {serverUrl,verifyTls,language,...}` · `POST /v1/settings/probe` → ProbeResult
- `POST /v1/onboarding/{register|poll|claim|enroll|paste-key}` (demo + live)
- `POST /v1/machines/{code}/sync-config`
- **WS `/v1/inspector/stream`** → pushes `ApiTraceEvent` JSON per commit (subscribe to `EventBus.Traced`).

- [ ] **Step 1: Create the project** + add to sln; reference EdgeCore. Add ASP.NET (`Microsoft.AspNetCore.App` framework ref) + CORS (allow the Vite dev origin) + WebSockets.
- [ ] **Step 2: `FleetHost`** — build the default fleet (reuse `SimulatorFactory` + `fleet.json` load via `FleetConfig`), a `SwitchableTransport`/mode, `EventBus`, `EdgePipeline`; expose Start/Stop, current fleet snapshot, per-machine detail, scenario apply, mode switch — mirroring the WPF `FleetService` (extract shared logic if clean; otherwise re-implement thinly against the same EdgeCore APIs).
- [ ] **Step 3: Map the endpoints** (minimal API) returning the JSON shapes above; add the WS `/v1/inspector/stream` bridging `EventBus.Traced` → socket (serialize `ApiTraceEvent`).
- [ ] **Step 4: Verify with curl + a WS probe.** `dotnet run --project …/St4i.EngineApi` (pick a fixed port, e.g. 5199). `curl :5199/v1/fleet` → JSON; `POST /v1/fleet/start` then `curl /v1/fleet` shows cycles incrementing; connect a WS client (a tiny node script) to `/v1/inspector/stream` and confirm trace events arrive. Assert Demo mode → clean 201/202 statuses in the trace events.
- [ ] **Step 5:** EdgeCore tests still green (`dotnet test …/St4i.EdgeCore.Tests`). Commit `feat(engine-api): ASP.NET host wrapping EdgeCore (HTTP + WS inspector stream)`.

---

## Task 4: Shell + Dashboard (live via engine API)

**REQUIRED: load `frontend-design` skill.**

**Files:** `src/shell/Shell.tsx`, `src/shell/Sidebar.tsx`, `src/shell/TopBar.tsx`, `src/shell/CommandPalette.tsx`, `src/lib/api.ts` (fetch + TanStack Query hooks + WS client), `src/routes/Dashboard.tsx`, `src/components/MachineCard.tsx`, `src/components/KpiTile.tsx`, `src/components/Sparkline.tsx`

- [ ] **Step 1: API client** (`src/lib/api.ts`): typed fetchers + TanStack Query hooks (`useFleet`, `useMachine`), a WS hook `useInspectorStream()`, base URL from env (`VITE_ENGINE_URL`, default `http://localhost:5199`). Provide a Query provider in `App.tsx`.
- [ ] **Step 2: Shell** — white sidebar (nav: Dashboard/Machines/Onboarding/API Inspector/Scenario/Settings) with navy active state; slim top bar (segmented Live/Demo/Auto mode control wired to `PUT /v1/mode`, Start/Stop primary-navy buttons → `/v1/fleet/*`, server-status + DEMO-FALLBACK badge, ⌘K trigger); wouter routing; content area. `CommandPalette` (⌘K) with Radix, jumps to screens.
- [ ] **Step 3: Dashboard** — KPI row (`KpiTile`: online / total cycles / FPY, `tabular-nums`), fleet grid of `MachineCard` (status dot, driver-kind chip, pass-rate ring, `Sparkline` via Recharts, last-cycle summary). Poll `useFleet` (or subscribe via WS) with skeletons while loading and a motion stagger on mount. Clicking a card → machine detail route.
- [ ] **Step 4: Verify (Playwright).** Start engine (`St4i.EngineApi`) + Vite; `browser_navigate` to the app; click Start Fleet; wait; assert tiles show incrementing cycles + KPIs > 0; screenshot → **Read it**, confirm it's clean white/navy and professional. Fix until it looks great.
- [ ] **Step 5:** axe pass; commit `feat(web): shell (sidebar/topbar/⌘K) + live dashboard`.

---

## Task 5: API Inspector (live WS stream) — the centerpiece

**Files:** `src/routes/Inspector.tsx`, `src/components/TraceTable.tsx`, `src/components/StatusBadge.tsx`

- [ ] **Step 1:** subscribe to `useInspectorStream()` (WS); keep a capped ring (~1000, newest-first); render a **virtualized** table (time/machine/kind/method/path/status/latency/mode/dup-error). Color rows by status via tokens (2xx ok / 4xx-5xx danger / queued warn); Mode chip. New rows animate in (framer-motion), respect reduced-motion.
- [ ] **Step 2:** filters (machine / kind / status) with a filtered-count display; Pause/Resume (stop appending while paused); Clear; Export to JSON (download).
- [ ] **Step 3: Verify (Playwright):** run fleet, open Inspector, assert rows stream with 201/202 statuses; apply a status filter → row count narrows AND the counter matches; Pause → count holds. Screenshot → Read → confirm quality.
- [ ] **Step 4:** axe pass; commit `feat(web): API Inspector — live WS trace stream (virtualized, filter/pause/export)`.

---

## Task 6: Machine detail (SPC / telemetry / AOI board / config-sync / log)

**Files:** `src/routes/MachineDetail.tsx`, `src/components/SpcChart.tsx`, `src/components/TelemetryChart.tsx`, `src/components/BoardView.tsx`, `src/components/ConfigSyncPanel.tsx`, `src/components/CycleLogTable.tsx`

- [ ] **Step 1:** fetch `useMachine(code)` (+ live updates via WS/poll). Tabs (Radix): Overview / SPC / Telemetry / Board / Config / Log, shown per `deviceClass`.
- [ ] **Step 2:** `SpcChart` (Recharts I-MR-ish: values line + mean/UCL/LCL bands, navy/accent series) + histogram for automation; `TelemetryChart` (line) for IoT; `BoardView` (responsive SVG canvas drawing each measurement bbox scaled to control size, red NG / amber NTF / green OK, tooltip w/ pointCode + defect) for AOI; `ConfigSyncPanel` (Sync recipe button → `POST /sync-config`, shows driftState); `CycleLogTable` (TanStack Table, capped). "Back to dashboard" affordance.
- [ ] **Step 3: Verify (Playwright):** open an automation machine (SPC renders) and an AOI machine (board bboxes render on an NG cycle); Sync recipe returns a result. Screenshot each → Read → confirm quality.
- [ ] **Step 4:** axe; commit `feat(web): machine detail — SPC/telemetry charts + AOI board bbox + config-sync + log`.

---

## Task 7: Onboarding wizard + Settings + Scenario

**Files:** `src/routes/Onboarding.tsx`, `src/routes/Settings.tsx`, `src/routes/Scenario.tsx` + supporting components

- [ ] **Step 1: Onboarding** — Radix stepper: register → poll approval → claim/enroll → key stored; paste mk_ tab; load-fleet; demo path fabricates instantly (calls `/v1/onboarding/*`). Clear per-step state + status log.
- [ ] **Step 2: Settings** — form (server URL / verify-TLS / mode / "check flags" probe → badge result / credentials paste-list / language vi-en / kiosk-attract toggles) wired to `/v1/settings`.
- [ ] **Step 3: Scenario** — sliders (defect / fault / cycle-rate) + preset cards ("Ca bình thường", "Lô lỗi cao", "Sensor drift", "Mất mạng demo", "Hot-folder AOI") + Burst, wired to `/v1/scenario*`; a status line showing the active scenario. Applying a preset visibly changes the fleet (verify defect-rate ↑ raises NG count in the Inspector).
- [ ] **Step 4: Verify (Playwright)** each screen (onboarding demo reaches "key stored"; settings probe against a dead URL returns unreachable without error; scenario "Lô lỗi cao" raises NG rate). Screenshots → Read → confirm quality. axe. Commit `feat(web): onboarding wizard + settings + scenario`.

---

## Task 8: i18n (vi/en) + dark mode + motion & empty-state polish

**Files:** `src/i18n/` (`vi.ts`, `en.ts`, a tiny `useT()` hook or i18next), `src/theme/ThemeToggle.tsx`

- [ ] **Step 1:** extract all visible strings into `vi`/`en` dictionaries; replace literals with `t('key')`; default vi; language switch in Settings persists.
- [ ] **Step 2:** dark-mode toggle (`data-theme`) proven on every screen; ensure tokens cover both.
- [ ] **Step 3:** polish empty states, loading skeletons, toasts (Radix/sonner), and consistent motion across routes.
- [ ] **Step 4: Verify (Playwright):** switch vi↔en (a known label changes), toggle dark (screenshot both), confirm no untranslated keys. Commit `feat(web): i18n vi/en + dark mode + empty/skeleton/toast/motion polish`.

---

## Task 9: Tauri package (engine sidecar) → standalone offline EXE

**Files:** `src-tauri/tauri.conf.json` (sidecar/externalBin = the published EngineApi exe), `src-tauri/src/main.rs` (spawn sidecar on startup, kill on exit)

- [ ] **Step 1:** publish `St4i.EngineApi` self-contained (`dotnet publish -r win-x64 --self-contained -p:PublishSingleFile=true`) → an exe; register it as a Tauri **sidecar** (`externalBin`), spawn it on app startup (fixed port), point the web UI's `VITE_ENGINE_URL` at it.
- [ ] **Step 2:** if Rust is available: `npm run build` then `npx tauri build` → a Windows installer/exe that bundles the WebView2 UI + the engine sidecar. If Rust is NOT available in this environment: install via `rustup` (best-effort) OR document the browser-run fallback (`npm run build` + serve `dist` + run EngineApi) and produce a clear README for building the Tauri exe on a machine with Rust. Report exactly what happened.
- [ ] **Step 3: Verify:** launch the packaged exe (or the browser-run bundle) on a clean path, Demo mode, confirm the dashboard loads + fleet runs offline (no server). Screenshot → Read → confirm. Commit `feat(web): Tauri packaging with EngineApi sidecar (standalone offline)`.

---

## Task 10: Playwright + axe audit suite + visual baselines + README

**Files:** `web/tests/*.spec.ts` (Playwright), `web/playwright.config.ts`, `tools/machine-simulator/web/README.md`

- [ ] **Step 1:** a Playwright suite covering all 7 screens (happy paths already used ad-hoc), **visual-regression snapshots** (baseline per screen, light + dark), and an **axe-core** a11y assertion per screen (no serious violations, contrast AA). Wire `npm run test:e2e`.
- [ ] **Step 2:** run the full suite green; record the visual baselines. Fix any a11y violations.
- [ ] **Step 3:** README (vi/en): run dev, build, Tauri package, engine API, how it maps to doc 65, and the doc-66 middleware roadmap pointer.
- [ ] **Step 4:** Commit `test(web): Playwright E2E + visual baselines + axe a11y suite + README`.

---

## Task 11: Final polish pass + whole-branch review

- [ ] **Step 1:** run the full Playwright/axe suite + `npm run build` + EdgeCore `dotnet test` → all green.
- [ ] **Step 2:** a final design QA (Read the visual snapshots of all screens light+dark) — confirm one coherent white/navy system, strong hierarchy, motion, no loose hex. Fix stragglers.
- [ ] **Step 3:** dispatch a whole-branch review (correctness + design consistency + a11y + the engine-API contract).
- [ ] **Step 4:** use superpowers:finishing-a-development-branch.

---

## Self-Review (author checklist)

**Spec coverage (doc 65):** §2 palette→Task 2 · §3 stack→Task 1/2 · §4 screens→Tasks 4-7 · §5 engine boundary→Task 3 · §6 Tauri→Task 9 · §7 Playwright/axe→Tasks 4-10 · §8 migration (C# engine bridge)→Task 3 · §9 phases→Tasks map to U0-U4 · §10 DoD→Task 11. No gaps.

**Placeholder scan:** no TBDs; each visual task ends with a Playwright screenshot the agent Reads + a design judgment, not a bare "looks good".

**Type/route consistency:** the engine-API routes in Task 3 are the exact ones Tasks 4-7 consume (`/v1/fleet`, `/v1/machines/{code}`, WS `/v1/inspector/stream`, `/v1/scenario*`, `/v1/settings*`, `/v1/onboarding/*`). Token names in Task 2 are used verbatim in component tasks.

**Risk notes:** Tauri needs Rust (Task 1 checks; Task 9 falls back to browser-run + documented Tauri build if absent). Node/npm assumed present (ecosystem uses them). The engine reuses tested EdgeCore — do not alter its verified behavior.
