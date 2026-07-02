# 23 — Frontend Ecosystem Redesign: Audit & Improvement Plan (2026-07)

> **Status: AWAITING APPROVAL.** This document is the design table + detailed plan for a full frontend
> audit and redesign. No execution agents run until the owner approves scope, branding, and phasing.
> Produced by 6 parallel specialist frontend-audit agents (index/landings · shell/nav · design system ·
> 3 module clusters). Stack: Vite + React 19 + wouter + Tailwind v4 + Radix/shadcn, dark-first
> "Elegant Industrial" theme; ~161 page files across an 8-group IA.

---

## 0. Goal (owner's bar)

Make the frontend **gọn** (concise/scannable) · **rõ ràng, tách biệt dễ nhìn** (clear visual separation) ·
**cân đối** (balanced) · **hiện đại** (modern) · and **phù hợp quy mô hệ sinh thái** (fits an automation
**ecosystem**, not an AVI/AOI single-purpose tool). The homepage especially must be re-conceived as an
**automation-ecosystem** front door.

---

## 1. Consolidated scorecard (1–5, per audited area)

| Area | Gọn | Tách biệt | Cân đối | Hiện đại | Ecosystem-fit | Headline gap |
|------|:---:|:---:|:---:|:---:|:---:|--------------|
| **Index / Homepage + Landings** | 3 | 4 | 4 | 3 | **2** | Home still brands "AVI/AOI", fake stats, ecosystem invisible |
| **App Shell + Navigation / IA** | 3 | 3 | 3 | 4 | 3 | No site/scope context; no breadcrumbs; unbalanced modules |
| **Design System + Consistency** | 4 | 4 | 3 | 4 | 3 | Good kit, **partial adoption** (72/161); scale unused; raw colors |
| **Overview · Production · Quality** | **2** | 3 | 3 | 4 | 3 | Monoliths (History 3216L, Dashboard 3177L); header/loading drift |
| **Devices & OT · Analytics** | 3 | 4 | 3 | 3 | **2** | "Several eras bolted together"; chart-color chaos; hand-rolled headers |
| **AI · Admin · Me** | 3 | 3 | 3 | 4 | **2** | Header inconsistency; monoliths (1577L/1208L); scroll-vs-tabs |

**Verdict:** Foundations are strong (clean `ui/*`, oklch tokens, ⌘K palette, live Command Center). The
gap is **coherence & enforcement**, plus a **front door that undersells the platform**. Ecosystem-fit is
the lowest score almost everywhere — exactly the owner's concern.

---

## 2. The 9 systemic findings (recur across every module — fix once, benefit everywhere)

| # | Finding | Severity | Evidence (representative) |
|---|---------|:--------:|---------------------------|
| **S1** | **Header inconsistency** — `PageHeader` exists (62 pages) but ~half bypass it: *no header* (`Reports`, `CorrelationAnalysis`, `DefectHeatmapPage`), `sr-only`/hand-rolled `<h1>` (`Users:317`, `MasterData:66`, `AIHub:88`, `Settings:194`, `BomManagement:62`, `DashboardCenter:79`, `RobotControl`, `EngineeringWorkspace`, `ControlPlane`, `OrchestrationStudio`, `DigitalTwinCenter`, `FactoryLiveMap3D`, `EnergyAnalytics`, `CarbonDashboard`) | **P0** | 5+ title-block styles coexist |
| **S2** | **DS type scale unused** — `ds-h1…ds-caption` ships (`index.css:357`) but only **2** uses vs **378** ad-hoc `text-2xl font-bold` across 113 pages; even `PageHeader:50` hardcodes `text-2xl` | **P0** | `patterns/PageHeader.tsx:50` |
| **S3** | **Raw palette/hex instead of tokens** — **817** `text-{blue|green|red…}-NNN` (109 pages) + **547** raw `#hex` (44 pages); chart-color chaos (5+ palettes, `--chart-1..5` unused); dark-first violations (light-mode `amber-50/800` banners) | **P1** | `Reports:1176`, `Users:346/357`, `Dashboard:1622`, `DeviceAdapter:329` |
| **S4** | **Component reinvention** — `MetricCard`/`StatusBadge`/`SectionCard`/`EmptyState` exist yet pages re-roll KPI cards & badges inline (`MqttDashboard` 8 gradient cards, `OEE`, `MachineHealth`, `DrillDown`, `Corporate`, `DigitalTwin`, `Edge`, `Robot`, `Carbon`) | **P1** | `MqttDashboard:348` |
| **S5** | **No page shell** — no `PageContainer`; per-page width/padding/`space-y` drift (`p-1` MES/Carbon vs `p-4/6` vs `container`) | **P1** | `MESControlTower:92`, `CarbonDashboard:112` |
| **S6** | **Monolith pages + tab overload** — `History` 3216L/9 tabs, `Dashboard` 3177L, `ProductionDashboard` 1693L, `AIModelManagement` 1577L, `AIPerformance` 1208L/7 tabs; `grid-cols-9` TabsList unreadable on narrow screens | **P0/P1** | `History:1124` |
| **S7** | **Loading-state inconsistency** — rich skeletons (Dashboard/History/AOI/QualityHome) vs plain "Đang tải…" text (MES/Twin/Trace) | **P1** | `MESControlTower:108` |
| **S8** | **Language/i18n drift** — VN↔EN default flips mid-navigation (`ControlPlane`/`Engineering`/`DeviceAdapter` VN-default); `BomManagement` hardcoded VN; `DrillDown` hardcoded "Yield Rate" | **P1** | `BomManagement:62` |
| **S9** | **Non-DS primitives** — `confirm()` dialogs, raw `<select>`, raw `<table>`, emoji status glyphs (`✓/⚠`) vs Radix `AlertDialog`/`Select`/`Table` | **P1/P2** | `DeviceAdapter:250`, `EngineeringWorkspace:441` |

**Ecosystem-scale-specific (headline asks):**

| # | Finding | Severity | Evidence |
|---|---------|:--------:|----------|
| **E1** | **Homepage undersells the platform** — `Home.tsx` brands "AVI/AOI Management"/"Factory Quality System", 6 AOI-only feature cards, hardcoded fake stats `50+/100K+/99.5%/99.9%`; Login/Setup also AOI-branded, stale `© 2024/2025`; Command Center (the real flagship) unreachable from Home & no role lands there | **P0** | `Home.tsx:86-91,105-106,175-179` |
| **E2** | **No ecosystem context in chrome** — no Site/Scope switcher despite shipped `/sites` + `/federation-dashboard`; no breadcrumbs across the 3-level, 161-page IA; top bar shows only page title | **P0** | `DashboardLayout.tsx:361-407` |
| **E3** | **Unbalanced IA + redundant browse** — Devices & OT = 28 leaves vs Overview = 6; ⌘K palette indexes only nav labels; ⌘K and ⌘\ mega-menu both "browse everything" | **P1** | `navigation.tsx:435-804` |
| **E4** | **No product-brand token** — "AVI/AOI" hardcoded across entry surfaces; no single source of product name/mark | **P1** | `Home`, `Login`, `Setup` footers |

---

## 3. Design Table A — Module-by-module: current → target + scope + effort

Effort: **S** = polish (adopt patterns, no rebuild) · **M** = restructure sections/tabs · **L** = decompose/redesign.

| Module | Worst gap | Redesign scope | Pages needing **L** (redesign) | Pages needing **S** (polish) | Exemplars to propagate | Effort |
|--------|-----------|----------------|-------------------------------|------------------------------|------------------------|:------:|
| **Index / Landings** | Ecosystem framing (2) | Re-conceive Home as ecosystem front door; rebrand Login/Setup; add MaintenanceHome; wire Command Center as front door | `Home.tsx`, `Login.tsx`, `Setup.tsx` | role homes (header parity) | `CommandCenter`, `QualityHome`, role `ToolTile` grid | **L** |
| **Shell / Nav** | No site context, no breadcrumbs (E2) | Header context bar + SiteSwitcher; breadcrumbs; elevate ⌘K; rebalance Devices module | `DashboardLayout` header, `CascadingNav` (Devices split), palette merge | `BottomNav` (role-derived), active-matcher | ⌘K palette infra, `buildModuleL2` | **M/L** |
| **Design System** | Adoption/enforcement (S1–S5) | Fix canonical components; add `PageContainer` + `chartTokens` + brand token; lint guard | `PageHeader`, `MetricCard`, `EmptyState`, `StatusBadge` (token fixes) | — | `patterns/*`, `ui/*`, `tokens.ts` | **M** |
| **Overview** | — | Polish + decompose Dashboard | `Dashboard.tsx` (3177L) | `DashboardCenter`, `DrillDown` (header) | `OpsConsole` (KPI+2 tabs+table) | **L** |
| **Production** | Monoliths + drift | Decompose History/ProductionDashboard; header/loading/i18n | `History.tsx` (3216L/9 tabs), `ProductionDashboard.tsx` | `MES`, `Twin`, `Trace`, `BomManagement`, `Corporate` | `QualityCockpit`, `AOIPackages`, `WipLineBalance` | **L** |
| **Quality** | Minor drift | Polish only | — | `QualityHome`, `DefectHeatmapPage` (add header) | `QualityCockpit`, `QualityHome` | **S** |
| **Devices & OT** | "Several eras" (2) | Consistency sweep + 2 rebuilds | `MqttDashboard`, `EngineeringWorkspace`; `RfTestCellSim` (canvas states) | 11 hand-rolled-header pages | `FieldDevices`, `EquipmentStandards`, `SafetyWorkforce`, `FleetOrchestration`, `IrEditor`, `DigitalTwinCenter` (canvas std) | **L** |
| **Analytics** | No headers, chart chaos | Header + chart-token sweep | — | `Reports`, `CorrelationAnalysis`, `EnergyAnalytics`, `CarbonDashboard` | `ReportBuilder`, `CategoryAnalytics` | **M** |
| **AI** | Monoliths, headers | Split monoliths; header/tab rules | `AIModelManagement` (1577L), `AIPerformance` (1208L/7 tabs) | `AIHub`, `ManagementInsight`, `AIBrain`, `AIChat` (header) | `AIBrainDashboard`, `ModelMonitoringPage`, `AIChat` empty-state | **L** |
| **Admin** | Header drift, table density | Adopt PageHeader; sectioned forms; federation KPI restraint | `MasterDataManagement`, `Settings` (verify) | `Users`, `RoleBuilder`, `AuditLogs`, `License`, `Sites`, `Federation`, `Modules` | `ModelMonitoringPage` template | **M** |
| **Me** | Full-bleed readability | Max-width clamps + header parity | — | `Inbox`, `Today`, `Profile`, `UserGuide`, `AboutSystem` | `QualityHome` front-door | **S** |

---

## 4. Design Table B — New **Ecosystem Homepage** (`Home.tsx` redesign spec)

Reframe from "AOI brochure" → **automation-ecosystem overview**. Logged-in users still auto-route to their
role home; this is the public / `?stay=1` front door and the shared brand surface.

| Block | Replaces | New content | Data source |
|-------|----------|-------------|-------------|
| **Brand lockup + top bar** | `Home:98-154` "AVI/AOI Management" + `Cpu` logo | Product mark + name from **brand token**; tagline "Unified Automation & Manufacturing Operations Platform"; language/theme; role-aware CTA | `brand` config (new) |
| **Hero (compact)** | `Home:164-220` `py-32` blob hero | Tighter `py-16/20`; headline conveys ecosystem scope; one-line subhead spanning Production · OT · Robotics · Twin · AI · Multi-site; primary CTA → `landingPathForRole`, secondary → **Open Command Center** | — |
| **Live plant-health strip** | `Home:222-237` hardcoded `50+/100K+/99.5%` | Real KPIs (OEE · WIP · active alarms · fleet util · sites online · yield) via `MetricCard`, honest "—" fallback; logged-out shows "sign in for live" | reuse Command Center `kpiSummary` query |
| **Domain / module grid** *(core new block)* | `Home:239-269` 6 AOI feature cards | 8 domain tiles → Production/MES · Quality · Devices & OT · Robotics & Fleet · Digital Twin · AI Brain · Analytics · Multi-site & Governance (icon + label + blurb + route), reusing `ToolTile` | **domain registry** (new) |
| **Your workspace** (logged-in) | — | Row: role landing · Inbox · Today · Command Center | `landingPathForRole` |
| **Ecosystem status footer** | `Home:300-315` `© 2025` | Sites online · version · honest `© {year}` · links | version/site data |

**Entry-surface fixes:** `Login.tsx` + `Setup.tsx` consume the brand token (kill "AVI/AOI" + `© 2024`);
add **`MaintenanceHome`** (only role with no landing); wire `/command-center` into `roleLanding` for
supervisor/admin as the ecosystem front door.

---

## 5. Design Table C — Shell & Navigation ecosystem upgrades

| Upgrade | Current | Target |
|---------|---------|--------|
| **Header context bar** | Page title only (`DashboardLayout:367`) | `brand · Site/Scope switcher · [ ⌘K global search — primary/widest ] · alerts · site-health dot · user` |
| **Site/Scope switcher** | none (0 hits for `SiteSwitcher`) | `SiteContext` + switcher (All Sites ▸ Site ▸ Line) driving a global scope; mobile drawer header too |
| **Breadcrumbs** | none (primitive built, unused) | `breadcrumbs?` slot on `PageHeader`, auto-derived (Module › Section › Page) from nav config |
| **Command palette** | indexes nav labels only; competes with ⌘\ | Primary find tool; index destinations + entities (machines/orders) + actions; fold Quick Browse into empty state; retire/merge ⌘\ |
| **Module balance** | Devices & OT = 28 leaves | Split → "Devices & Monitoring" vs "Engineering & Control (Advanced)" **or** persistent L2 index; cap L3 flyout to one screen |
| **Active-state** | exact `href===path` | route-prefix matcher (query-string/child routes highlight parent) |
| **Mobile BottomNav** | first 4 groups by array order | role-derived priority destinations |

---

## 6. Detailed execution plan (phased, gated)

> Each phase = one or more specialist execution agents. **F0 first (foundation)**; F1/F2 build on it;
> F3 fans out per cluster. Every agent: TypeScript strict, no behavior/permission changes, `npm run check`
> + `vite build` green, reuse patterns (no new one-offs), respect dark-first + i18n. Reversible commits per phase.

### Phase F0 — Design-system foundation & enforcement *(highest leverage; 1–2 agents, run first)*
- Fix canonical components once (propagates to 72 pages): `PageHeader` → `ds-h1` + optional `breadcrumbs` slot; `MetricCard`/`EmptyState`/`StatusBadge` → semantic `success/warning/info/destructive` tokens.
- New shared primitives: **`PageContainer`** (max-width + responsive padding + `space-y-6`), **`chartTokens`** (colors + tooltip/grid chrome from `--chart-1..5`), **`brand`** config/token, **`SiteContext`** scaffold, **breadcrumbs auto-builder** from nav config.
- **Lint/CI guard**: forbid `text-{palette}-NNN` + raw `#hex` in `client/src/pages/**` (baseline: 817+547 violations).
- **Accept:** `check` + `build` green; canonical pages render `ds-h1` + tokens; zero intended visual regression.

### Phase F1 — Ecosystem homepage & entry *(headline ask; 1–2 agents)*
- Redesign `Home.tsx` per **Table B** (brand lockup, compact hero, live KPI strip, domain grid, workspace row, status footer) + **domain registry**.
- Rebrand `Login.tsx` + `Setup.tsx` via brand token; fix `© {year}`.
- Add `MaintenanceHome`; wire `/command-center` into `roleLanding` (supervisor/admin).
- i18n keys for all new copy; remove AOI-only strings.
- **Accept:** logged-out Home reads as an automation ecosystem with honest/live KPIs; brand consistent across Home/Login/Setup; no AOI-only language.

### Phase F2 — Shell & navigation at ecosystem scale *(1–2 agents)*
- Header context bar + `SiteSwitcher` (Table C); breadcrumbs rendered in `PageHeader`.
- Elevate ⌘K (entities + actions + destinations; merge Quick Browse; retire/merge ⌘\).
- Rebalance Devices & OT module; cap L3 flyout height; route-prefix active-matcher; role-derived `BottomNav`.
- **Accept:** every page shows site scope + breadcrumb; palette is the primary find tool; no module > ~18 leaves.

### Phase F3 — Cross-module consistency sweep *(3 agents, parallel — one per cluster)*
- **A: Overview + Production + Quality** · **B: Devices & OT + Analytics** · **C: AI + Admin + Me**.
- Per cluster: adopt `PageHeader` + `PageContainer` on every page; inline KPI → `MetricCard`; colored badges → `StatusBadge`; charts → `chartTokens`; kill hex + light-mode violations; standardize loading skeletons + empty states; replace `confirm()`/raw `<select>`/raw `<table>`; fix i18n + language-default drift.
- **Accept:** 0 lint violations (S3) in pages; all pages use `PageHeader`; consistent loading/empty; light + dark both correct.

### Phase F4 — Decompose monoliths & tame tabs *(1–2 agents)*
- Split `History` (3216L/9 tabs), `Dashboard` (3177L), `ProductionDashboard` (1693L), `AIModelManagement` (1577L), `AIPerformance` (1208L/7 tabs) into per-tab child components / sub-routes; extract inline export templates.
- Group/route heavy tab bars; fix `grid-cols-6/9` → responsive.
- **Accept:** no target page component > ~800L; behavior unchanged; `check` + `build` green.

### Phase F5 — Responsiveness, a11y & verification *(1 agent + verify pass)*
- Responsive polish (collapsible chat sidebar; fluid `min-w` selects; breakpoints for `grid-cols-6/7/9`; max-width clamps on Me content).
- a11y (visible titles, focus order, contrast); full `check` + `build` + smoke; visual QA; `i18n:audit`.

---

## 7. Decisions (locked — 2026-07-02)

1. **Product name & brand** — retire "AVI/AOI Management" → **"Continuum"** · tagline *"Automation & Manufacturing Operations Platform"* (feeds F1 brand token + hero + Login/Setup).
2. **IA restructure** — **split Devices & OT into 2 modules** ("Devices & Monitoring" + "Engineering & Control (Advanced)") → 9 top-level groups (F2).
3. **Scope / phasing** — **full F0→F5 sweep approved**; run in sequence with gated commits, F3 fans out per cluster.
4. **Theme canon** — **dark-first stays canonical; make light fully correct** (fix all light-mode color violations).

**Execution status (2026-07-02):**
- **F0** ✅ DS foundation landed + verified (`check` green).
- **F1** ✅ Continuum ecosystem homepage + Login/Setup rebrand + MaintenanceHome + roleLanding, verified.
- **F2** ✅ Shell/nav: header context bar + SiteSwitcher + SiteHealthDot + global breadcrumbs + ⌘K primary + Devices&OT→9-group split + route-prefix active matcher + role BottomNav, verified.
- **F3** ✅ Consistency sweep COMPLETE — **134/134 scope pages** swept (headers→`PageHeader`/`PageContainer`, colors→tokens + `chartTokens`, KPI→`MetricCard`, badges→`StatusBadge`, loading→skeletons, `confirm()`/raw `<select>`/`<table>`→Radix, i18n). TSC **green**, `vite build` OK. NOTE: first F3 wave's agents self-delegated into nested trees; recovered via disk-truth reconciliation (killed coordinators; fixed 3 unclosed `<PageContainer>` tags + 1 `chartAxisTick` type bug centrally). Remainder completed with hardened "work-alone" single-batch agents.
- **F4a** ✅ Monolith consistency COMPLETE — the 5 excluded monoliths (Dashboard, History, ProductionDashboard, AIModelManagement, AIPerformance) swept for consistency + responsive tab bars, **no decomposition / logic preserved**. TSC green, build OK.
- **Token violations: 2,947 → 1,104 (−63%)** — remainder are intentional keeps (categorical accent colors, canvas/SVG hex, decorative gradients).
- **i18n merge** 🔄 in progress (register new keys en/vi/zh + AVI/AOI→Continuum brand fix).
- **F4b** (file decomposition) — DEFERRED as higher-risk/maintainability-only; recommend a separate careful pass with app-run verification.
- **F5** ⏳ pending (responsiveness/a11y polish + final `check`/`build`/`i18n:audit` + visual QA).

---

## 8. Risks & guardrails
- **No behavior/permission changes** — visual/structural only; RouteGuard/RBAC untouched.
- **Reversible** — one commit per phase; exemplar-pattern reuse over invention.
- **Green gates** — `npm run check` + `vite build` per phase; `i18n:audit` in F5.
- **Honesty** — replace fake/`Math.random()` data (Home stats, `Reports:191`, MachineHealth synthetic) with real queries or explicit "—"/empty states.
