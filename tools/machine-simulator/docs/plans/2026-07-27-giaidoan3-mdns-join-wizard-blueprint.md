# Giai đoạn 3 — Sub-project 2: mDNS join wizard (browse-only Site discovery) — Blueprint/Spec

> APPROVED design (brainstorming, 27/07/2026). Branch feat/machine-simulator (GĐ3-EC @ fd3f6d1b). Builds on Ecosystem Connect (EC-1..EC-5): adds LAN **discovery** so the operator doesn't hand-type a Site's host/port. Additive — the manual pinned-trust join is unchanged.

## Goal
Discover SYNAPSE Sites on the local network via mDNS and let the operator pick one to pre-fill the Site-link form. **Browse-only**: discovery pre-fills host/port; the trust PEM + enable remain the manual, pinned, fail-closed EC path (mDNS gives discovery, NOT trust). No advertising, no auto-connect.

## Locked decisions (approved)
1. **Impl = Makaretu.Dns.Multicast** (MIT — the `MulticastService`/`ServiceDiscovery` mDNS lib). The maintained fork (`Makaretu.Dns.Multicast.N` 0.38.0 by jdomnitz, dep `Makaretu.Dns.New` 3.1.2) has better modern-.NET support — try it first; the classic `Makaretu.Dns.Multicast` 0.27.0 is the fallback. ONE new NuGet.
2. **Browse-only** (join wizard: the machine discovers Sites; it does NOT advertise itself).
3. **Discovery ≠ trust:** picking a discovered Site only pre-fills host/port; the operator still pastes + pins the Site trust PEM and enables (unchanged EC-2/3 fail-closed pin).
4. **Service type** `_synapse-site._tcp` (env-configurable via `ST4I_SITE_SERVICE_TYPE`).

## Key code-grounded facts
- No mDNS/discovery code exists today (build gap; the Ecosystem-Connect map confirmed). Makaretu is the chosen lib. mDNS = a multicast (224.0.0.251:5353) browse: PTR (service type → instance) → SRV (host+port) → TXT (metadata) → A/AAAA (address).
- Builds on the Site foundation: `src/St4i.EdgeCore/Site/*` (SiteLink/UnsBridge/etc.), `src/St4i.EngineApi/Endpoints/SiteEndpoints.cs` (add the discover route), `web/src/routes/Site.tsx` (add the Discover button), `web/src/lib/api.ts` (add the hook). Reuse `Map*Endpoints`/`RequireAuthorization`/`RbacPolicyTests.ExpectedRoutes`/TanStack-Query idioms.

## Components
### SD-1 — SiteDiscovery + endpoint (backend)
- `src/St4i.EdgeCore/Site/SiteDiscovery.cs`: `DiscoveredSite { string InstanceName; string Host; int Port; IReadOnlyList<string> Addresses; IReadOnlyDictionary<string,string> Txt }`; `ISiteDiscovery { Task<IReadOnlyList<DiscoveredSite>> DiscoverAsync(TimeSpan timeout, CancellationToken ct) }`; `SiteDiscovery : ISiteDiscovery`. **Per-call ephemeral**: each DiscoverAsync creates a MulticastService, starts, `QueryServiceInstances(serviceType)`, collects `ServiceInstanceDiscovered` (resolve SRV/TXT/A from the additional records or a follow-up query) for `timeout`, then stops+disposes — no always-on multicast socket (consistent with "nothing always-on"). Dedup by instance name. **Never-throws** (a discovery/network error → empty list + log). Service type from `ST4I_SITE_SERVICE_TYPE` (default `_synapse-site._tcp`).
- `GET /v1/site/discover` (Engineer — an active network scan) in `SiteEndpoints.cs`: `await siteDiscovery.DiscoverAsync(~4s, ct)` → `DiscoveredSite[]`. Add to `RbacPolicyTests.ExpectedRoutes`. Program.cs registers `ISiteDiscovery` singleton (the singleton holds no socket; each call is self-contained).
- **Implementer MUST verify** the lib builds on net10.0-windows AND a loopback advertise→browse round-trip works BEFORE committing to the approach; if the lib is broken on .NET 10, STOP + report BLOCKED (reconsider hand-roll). Tests: (a) unit — DiscoveredSite collection/dedup; (b) integration — a Makaretu loopback advertiser (a fake `_synapse-site._tcp` Site) is found by DiscoverAsync (bounded poll); if multicast is flaky in the sandbox, keep the unit test + document a manual/CI verification of the round-trip; (c) endpoint — Engineer 200 (empty list with no real Site is fine), Operator 403.

### SD-2 — web Discover button
- `web/src/routes/Site.tsx`: a "Discover Sites" button → `useSiteDiscover()` (a query triggered on click, or a mutation) → a list of discovered Sites (instance name, host:port, txt) → clicking one pre-fills the Site-link form's Host + Port (the operator then pastes the trust PEM + enables). Loading/empty ("no Sites found on the LAN")/error states. `web/src/lib/api.ts`: `DiscoveredSite` type + `siteEndpoints.discover` + the hook. i18n vi+en (`site.discover.*`). `npm run build` clean; Playwright best-effort.

## Task order (SDD)
SD-1 (SiteDiscovery + endpoint, verify-lib-first) → SD-2 (web) → sub-2 review + push.

## Global constraints
.NET/C# (backend) + React/i18n (web). ONE new NuGet (`Makaretu.Dns.Multicast(.N)`, MIT, pinned). Do NOT edit the shared SDK. Additive: discovery is an operator-initiated action; nothing always-on; the manual pinned-trust join unchanged. Reuse Map*Endpoints/RbacPolicyTests/TanStack-Query idioms. TDD; per-task review; full `St4i.EdgeCore.Tests` + `St4i.EngineApi.Tests` green + web build clean. Commit `feat(site):` with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

## Deferred
Advertise (machine announces itself so a Site auto-sees it — "Site tự thấy máy"); auto-provision/auto-connect on discovery; trust-on-first-discovery; the other GĐ3 sub-projects (OPC-UA, LineController+Alarm).
