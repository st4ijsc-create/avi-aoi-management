# Phase 5 — Federation, AR & Marketplace (design + status)

WS5.1 (PWA / connection banner / kiosk) shipped as code. The remaining Phase 5
workstreams are infra- or large-UI-heavy; this records the approach and what the
platform already provides, so they can be built incrementally on real demand.

## WS5.2 — Multi-site federation
**Goal:** aggregate many sites (multi-factory / multi-country) into a core
control-tower without coupling sites together.

**Approach (edge-to-core):**
- Each site runs the platform as the edge of truth. A **core** instance
  aggregates read-models — it does not control sites directly.
- **Data feed already exists:** `server/routes/externalInspectionApi.ts` exposes
  ~18 read-only `/api/external/*` analytics endpoints (master-key/Bearer auth).
  The core can pull per-site KPIs/yield/OEE from these. The **UNS bridge** (EMQX,
  Phase 1) is the streaming path — sites publish normalized ISA-95 topics; the
  core subscribes.
- **Tenant isolation** is the Phase 1 RLS work (corporate/factory scoping) — the
  core enforces per-site/tenant access with the same `withTenantScope` model.
- **License sync** across sites already flows through the License Server.

**To build (follow-up):** a `sites` registry + a core aggregator service that
polls/subscribes per site into a roll-up store; a cross-site corporate dashboard.
Defer until ≥2 live sites exist to test against.

## WS5.3 — AR / HMI guided assembly
**Goal:** overlay vision-driven work instructions for operators.

**Approach:** reuse the measurement-point / defect-catalog definitions as the
step source and the Computer-Vision pipeline (ROI/defect detection) as the
trigger. Delivery via a tablet overlay or WebXR; for vision-guided robotics the
CV→pose mapping (hand-eye calibration, Phase 3 follow-up) feeds the same step
model. **Deferred** — needs AR hardware + a guided-step authoring UI; design only.

## WS5.4 — Marketplace & packaging
**Largely already present:**
- **Module licensing** is first-class (`shared/module-registry.ts` + the License
  Server; Phase 0 added `MOD_AI` / `MOD_OT_CONTROL`). License-as-a-service is the
  existing model.
- **In-app marketplaces** exist for dashboards/templates
  (`DashboardMarketplace`, `TemplateMarketplace`).
- **ESG/energy** dashboards exist (`CarbonDashboard`, `EnergyAnalyticsPage`,
  ISO-50001 EnPI schema).

**To build (small follow-up):** a "Modules" page that lists `SYSTEM_MODULES`
with live licensed/locked status from `useLicenseModules()` (data already
available) — a thin read-only surface; and packaging robotics as `MOD_ROBOTICS`
when the robotics UI lands.

## Summary
Phase 5 delivers the operator-experience foundation (installable PWA, live
connection awareness, kiosk). Federation/AR are intentionally deferred to real
hardware/site availability; marketplace/ESG are mostly existing capabilities
needing only thin surfacing.
