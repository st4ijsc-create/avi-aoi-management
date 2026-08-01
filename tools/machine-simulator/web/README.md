# ST4I Machine Simulator — Web UI

React 19 + Vite + Tailwind 4 + shadcn/ui web front-end for `St4i.EngineApi` (the ASP.NET host
wrapping the shared `St4i.EdgeCore` simulator pipeline — see `../README.md` §1/§13). 7 screens
(Dashboard, API Inspector, Machine Detail, Onboarding, Settings, Scenario, plus the `/tokens`
design-token reference), i18n (vi/en, Vietnamese default), light/dark theme.

*(Giao diện web cho `St4i.EngineApi` — 7 màn hình chính + trang tham khảo design-token `/tokens`,
song ngữ vi/en (mặc định tiếng Việt), theme sáng/tối.)*

This file covers the **web app itself** — running it, testing it, and its API contract. For the
**standalone offline desktop package** (WebView2 shell + engine, the thing that actually ships to a
trade-show floor) and the **Tauri build recipe**, see `../README.md` **§13** — not duplicated here.

---

## 1. Dev run / Chạy dev

Two processes, same as the rest of this tool (`../README.md` §13.1):

```powershell
# Terminal 1 — engine (HTTP API + WebSocket), fixed port 5199, Demo mode by default (fully offline)
cd tools/machine-simulator
dotnet run --project src/St4i.EngineApi

# Terminal 2 — this app, Vite dev server on :5173, proxies API/WS calls to :5199
cd tools/machine-simulator/web
npm install
npm run dev
```

Open `http://localhost:5173`. `src/lib/api.ts`/`src/lib/inspector.ts` default to
`http://localhost:5199` in dev (`import.meta.env.DEV`); set `VITE_ENGINE_URL` to point at a
different engine instance/port if needed.

*(VI: 2 tiến trình — engine ở cổng cố định 5199 (chế độ Demo, không cần mạng), Vite dev ở 5173. Mở
`http://localhost:5173`.)*

## 2. Production build / Build production

```powershell
npm run build      # tsc -b && vite build → dist/
npm run preview     # serve dist/ locally to sanity-check the build
```

`St4i.EngineApi.csproj` copies `dist/**` into its own `wwwroot/` at build time (`Condition="Exists
('..\..\web\dist')"`) so the SAME engine process can serve the built UI + API + WS from one port —
this is what the standalone desktop package (`../README.md` §13.2) and the Tauri path (§13.4) both
build on. Run `npm run build` **before** `dotnet build`/`dotnet publish` on `St4i.EngineApi` for that
copy to have something to pick up.

*(VI: `npm run build` → `dist/`; `St4i.EngineApi` tự copy `dist/` vào `wwwroot/` khi build — chạy
`npm run build` TRƯỚC khi build/publish EngineApi.)*

## 3. Standalone desktop package + Tauri / Đóng gói desktop

Both fully documented in `../README.md`:
- **§13.2** — the deliverable that actually ships: a WPF `WebView2` shell (`St4i.DesktopShell`)
  spawning/attaching to `St4i.EngineApi` as a child process, publish commands, verified-LIVE run log.
- **§13.4** — the Tauri 2 recipe (sidecar `St4i.EngineApi.exe`, `tauri.conf.json`'s
  `externalBin`, the `VITE_ENGINE_URL` override needed since Tauri's `tauri://localhost` origin
  isn't the same-origin case §13.2 relies on) — written up as a proven recipe, not built/verified in
  this environment (no Rust/MSVC toolchain here; see that section for exactly what's missing).

`src-tauri/` in this directory is the Tauri 2 scaffold referenced there (`Cargo.toml`,
`tauri.conf.json` with the `st4i-engineapi` sidecar binary declared, icons, capabilities).

## 4. Engine API contract / Hợp đồng API engine

Every endpoint below is called from `src/lib/api.ts` (HTTP) or `src/lib/inspector.ts` (WS) — those
two files are the authoritative, typed source of the wire shapes (`Fleet/Dtos.cs` on the server
side); this table is just an index into them.

| Method | Path | Used by |
|---|---|---|
| GET | `/v1/health` | TopBar server-status dot (all screens) |
| GET | `/v1/fleet` | Dashboard (polled ~1s) |
| POST | `/v1/fleet/start` / `/v1/fleet/stop` | TopBar + Dashboard empty-state CTA |
| GET / PUT | `/v1/mode` | TopBar mode switch, Settings |
| GET | `/v1/machines/{code}` | Machine Detail (polled ~1s) |
| POST | `/v1/machines/{code}/sync-config` | Machine Detail → Config tab |
| GET / PUT | `/v1/settings` | Settings |
| POST | `/v1/settings/probe` | Settings → connection check |
| GET | `/v1/scenario` | Scenario (polled ~1s) |
| POST | `/v1/scenario` | Scenario sliders (debounced) |
| POST | `/v1/scenario/preset` | Scenario preset cards |
| POST | `/v1/scenario/burst` | Scenario Burst button |
| POST | `/v1/onboarding/register` \| `/poll` \| `/claim` \| `/enroll` \| `/paste-key` | Onboarding wizard |
| WS | `/v1/inspector/stream` | API Inspector — backfills ~200 events on connect, then pushes every new `ApiTraceEvent` live |

Demo mode (the engine's default, `../README.md` §4) means every one of these works with **zero**
external network dependency — the whole contract above is exercised end-to-end by this app's own
Playwright suite (§5) against a real, locally-running engine.

*(VI: bảng trên liệt kê toàn bộ endpoint HTTP/WS mà UI gọi — nguồn xác thực là `src/lib/api.ts` và
`src/lib/inspector.ts`. Chế độ Demo (mặc định) chạy toàn bộ mà không cần mạng ngoài.)*

## 5. Testing — Playwright E2E + visual regression + axe a11y (Task 10)

```powershell
npm run test:e2e                    # everything: E2E happy paths + visual baselines + axe a11y
npm run test:e2e:update-snapshots   # re-record visual baselines after an intentional UI change
npm run test:e2e:report             # open the last run's HTML report
```

`npm run test:e2e` starts **both** halves of the dev split itself (`playwright.config.ts`'s
`webServer`: Vite on :5173, `dotnet run --project ../src/St4i.EngineApi` on :5199) — no manual setup
needed, just have the .NET SDK + `npm install` done once. It reuses an already-running dev server
if you happen to have one up (`reuseExistingServer`), and stops what it started when the run ends.

**Structure** (`tests/`):
- `00-visual-and-a11y.spec.ts` — **must run first** (numeric prefix + `workers: 1` in the config
  fixes file order): captures every screen **pristine** — light + dark `toHaveScreenshot` baseline,
  plus an axe-core scan (`@axe-core/playwright`, WCAG 2.0/2.1 A+AA tags, gated on
  serious/critical findings only) — before any other spec ever calls `POST /v1/fleet/start`. The
  engine's fleet state is a **process-lifetime singleton**, so "pristine" is only reachable once per
  engine run; capturing it first, before anything mutates it, is what makes these 14 baselines
  provably deterministic rather than merely "probably stable" — see that file's own top comment for
  the full reasoning, including why no `mask:` is needed there.
- `01-dashboard.spec.ts` … `06-scenario.spec.ts` — one file per remaining screen's happy path,
  each independently re-runnable (every spec establishes its own preconditions via direct HTTP calls
  in `tests/support/engine.ts`, not by assuming what an earlier file left behind). Populated/live
  states (machine cards mid-cycle, a streaming trace table, a real SPC chart) are asserted via
  DOM/role content rather than a second, masked pixel snapshot — the task brief's own guidance for
  regions that are inherently non-deterministic moment-to-moment.
- `tests/support/` — shared helpers: `screens.ts` (navigate-and-wait-for-ready per screen),
  `engine.ts` (direct API calls for test preconditions), `theme.ts` (prime light/dark via
  `localStorage`), `a11y.ts` (the axe gate, plus a Web-Animations settle wait — axe has no
  equivalent to `toHaveScreenshot`'s automatic animation freeze, and this app's `fadeSlideUp`/
  `staggerContainer` motion on every screen mount was briefly a real source of false-positive
  contrast findings until this was added).

**Visual baselines** live under `tests/00-visual-and-a11y.spec.ts-snapshots/` (Playwright's default
location) and **are committed** — they're the intentional, reviewable artifact, not build output.
`test-results/`/`playwright-report/` are not (`.gitignore`).

Full results, the two real a11y bugs this suite found + fixed (a `--warn-text` token just under AA
on its own tint background, and an `animate-pulse` badge dipping below AA mid-pulse), and coverage
notes: `.superpowers/sdd/task-10-report.md` in the main repo.

*(VI: `npm run test:e2e` tự khởi động cả Vite lẫn engine, không cần setup tay. `00-...spec.ts` PHẢI
chạy trước tiên vì fleet của engine là state dùng chung suốt vòng đời tiến trình — bắt màn hình lúc
"chưa chạy fleet lần nào" là cách duy nhất có baseline chắc chắn ổn định, không cần `mask:`. Các file
01–06 là happy-path từng màn còn lại, tự thiết lập điều kiện riêng qua gọi API trực tiếp — không phụ
thuộc thứ tự file khác. Ảnh baseline nằm trong `tests/*-snapshots/` và ĐƯỢC commit.)*

## 6. Doc mapping / Ánh xạ tài liệu

- **Doc 65** (`docs/ECOSYSTEM/65_SIMULATOR_UI_WEB_UPGRADE_PLAN_2026-07-19.md`, main repo) is the plan
  this whole `web/` app implements: white/navy design system (§2), the exact stack in `package.json`
  (§3 — React 19/Vite/Tailwind 4/shadcn/lucide/Recharts/framer-motion/TanStack Query/wouter), the
  7-screen IA (§4, one-to-one with the routes in `src/routes/`), the UI↔Engine boundary this README's
  §4 documents concretely (§5), the desktop packaging this README's §3 points at (§6), and — the
  reason this specific file exists — **§7 calls for exactly this Playwright + axe-core suite** as the
  plan's own acceptance bar (§10 DoD item 4: "Playwright E2E + visual-regression + axe xanh cho cả 7
  màn").
- **Doc 66** (`docs/ECOSYSTEM/66_ECOSYSTEM_MIDDLEWARE_COMMERCIALIZATION_PLAN_2026-07-19.md`, main
  repo) is the middleware roadmap this UI is the eventual shell for ("Machine Edition", doc 65's own
  header: "hội tụ với doc 66"): today this app talks to `St4i.EngineApi` (C# `EdgeCore`, the
  oracle/reference implementation); doc 66 §3/§8 maps a Go/Rust connector-based engine onto the same
  northbound HTTP/WS contract this README's §4 documents, release-trained R0→R4, without this UI
  needing to change — "one artifact, two roles" (doc 65 §6). Not this task's scope to build; noted
  here as the pointer doc 65 itself asks for.

*(VI: Doc 65 là kế hoạch mà `web/` này hiện thực — §7 chính là yêu cầu bộ Playwright+axe này. Doc 66
là lộ trình middleware Go/Rust mà UI này sẽ làm shell chung, không đổi UI khi engine đổi.)*
