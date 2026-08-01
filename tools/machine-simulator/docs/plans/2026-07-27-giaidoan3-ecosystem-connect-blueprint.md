# Giai đoạn 3 — Sub-project 1: Ecosystem Connect (device identity + northbound UNS federation) — Blueprint/Spec

> APPROVED design (brainstorming, 27/07/2026). Branch feat/machine-simulator (GĐ2 + pass-2 @ 789dd293). Code-grounded by the Ecosystem-Connect surface map. **Additive, default-off, ZERO new NuGet** (X.509 via in-box `CertificateRequest`; mTLS via MQTTnet 5.2.0.1603's already-present `WithTlsOptions`/`WithClientCertificates`; config via the `FleetSettingsStore` idiom; key storage via the `CredentialStore`/`SecurityDirAcl` DPAPI+ACL idiom).

## Goal
Give a standalone machine a **device identity** and a **northbound bridge** that federates its local UNS spine up to a remote SYNAPSE Site (a UNS/Sparkplug-B MQTT aggregator), over **mTLS** with **manual (paste-trust) join**. No Site configured ⇒ byte-identical to today's standalone product.

## Locked decisions (approved)
1. **MVP = identity + Site-link (manual config) + northbound bridge**, tested against a loopback "Site" broker. mDNS auto-discovery + join wizard DEFERRED.
2. **Identity/trust = self-signed X.509 (ECDSA P-256, in-box) + pinned Site trust** (operator pastes the Site CA/leaf PEM at join). EST/SCEP + Site CA DEFERRED.
3. **Bridge is OUTBOUND-ONLY** (forwards local telemetry up) — no inbound NCMD/command path (that's Policy-gated, ties to B2 — DEFERRED). No new inbound attack surface; local broker stays loopback-only, only the bridge client reaches out.
4. **Additive/default-off**: `SiteLink.Enabled=false` (default) ⇒ no bridge, no behavior change. Never affects the local pipeline / ST4I path / `Committed`.

## Key code-grounded facts (surface map)
- **Build gaps (all net-new):** no X.509/cert handling; no mTLS (only server-verify on/off); no mDNS; no remote MQTT bridge; no Site-link config. BUT MQTTnet 5.2.0.1603 already exposes `MqttClientTlsOptionsBuilder.WithClientCertificates/WithCertificateValidationHandler`, and .NET `System.Security.Cryptography.X509Certificates.CertificateRequest` is in-box → **MVP = zero new NuGet.**
- **Reuse idioms:** `CredentialStore` (DPAPI LocalMachine + `SecurityDirAcl`, `%ProgramData%\ST4I\sim\creds`, string-only today → needs a bytes API for the PFX); `FleetSettingsStore` (atomic-JSON, `ResolveRoot` explicit>env>default, tolerant Load, `%ProgramData%\ST4I\sim\<leaf>`) → the `SiteLinkStore` template; `UnsPublisher` (MQTTnet client-options builder, non-blocking ctor, bounded-channel never-throws) → the `UnsBridge` client shape; `UnsBroker` (loopback MqttServer) = the local broker the bridge subscribes to; `Map*Endpoints` + `RequireAuthorization(Policies.X)` + `AuditRecorder` + `RbacPolicyTests.ExpectedRoutes` exact-count sweep; `Settings.tsx`/`Onboarding.tsx`/`EcosystemConnectPanel.tsx` + `api.ts` request/hooks = web templates.
- Program.cs wires UnsBroker/UnsPublisher eagerly before Build (gated on `UnsOptions.Enabled`), DI singletons, forwarded to FleetHost. The bridge follows the same startup-wiring shape.

## Components (each: one purpose, well-bounded, independently testable)

### EC-1 — Device Identity (`src/St4i.EdgeCore/Identity/`)
- `DeviceIdentityStore`: **load-or-create** a self-signed X.509 device cert (ECDSA P-256 via `CertificateRequest`, subject/SAN = a stable node id, ~10yr validity). Persist the PFX bytes DPAPI-protected (LocalMachine) + ACL-locked under `%ProgramData%\ST4I\sim\identity` (new leaf; env `ST4I_IDENTITY_DIR`). Expose: `X509Certificate2` (with private key, for mTLS), public-cert PEM, and SHA-256 fingerprint (hex, colon-free) for pairing/display. Idempotent; never throws into callers (best-effort — if identity can't be created, the bridge just never comes up).
- Needs a bytes-capable secret store: EITHER extend `CredentialStore` with `SaveBytes/LoadBytes`, OR a small dedicated `DeviceIdentityStore` reusing `SecurityDirAcl` + `ProtectedData.Protect(..., LocalMachine)` directly (prefer the dedicated store — keeps `CredentialStore`'s mk_ contract clean).
- Tests: generate→persist→reload round-trip yields the same cert/fingerprint; PEM parses; a corrupt/foreign blob → regenerate (or clear error), never crash; fingerprint stable.

### EC-2 — Site Link config + Northbound bridge (`src/St4i.EdgeCore/Uns/`)
- `PersistedSiteLink { bool Enabled=false; string Host=""; int Port=8883; string SiteTrustPem=""; string? DeviceNodeId=null }` + `SiteLinkStore` (mirror `FleetSettingsStore`: atomic-JSON, env `ST4I_SITELINK_DIR`, `%ProgramData%\ST4I\sim\sitelink`, tolerant Load, explicit>env>default). NO secrets in this JSON.
- `UnsBridge` (`: IAsyncDisposable`): when a Site link is Enabled AND identity is available — (a) a **remote** MQTTnet client to `Host:Port` with `WithTlsOptions(UseTls + WithClientCertificates([deviceCert]) + WithCertificateValidationHandler(pin against SiteTrustPem))`; (b) a **local** client to the loopback UNS broker subscribing `spBv1.0/#` + `syn/#`; on each local message, republish to the remote (preserve topic/retain/QoS/payload). Non-blocking ctor, bounded-channel/never-throws forward, resilient reconnect on BOTH ends, background loop — never touches the local pipeline/ST4I. Exposes a `BridgeStatus` (Down/Connecting/Connected/Degraded + last error + Site fingerprint) for the UI. `IAsyncDisposable` clean teardown.
- Program.cs: construct + start when `SiteLink.Load().Enabled` (like UnsBroker/UnsPublisher, eager, gated, DI singleton). A connect failure logs + stays Down, never crashes startup.
- Tests (loopback-Site): an in-process MQTTnet **TLS** broker (dynamic port) stands in for the Site; the bridge does an mTLS handshake (presents the device cert; validates the Site via the pinned trust); a message published to the LOCAL UNS broker is received on the Site broker (bounded poll); `Enabled=false` ⇒ no bridge / no remote connection; a Site outage → bridge Degraded/reconnect, local UNS unaffected. Deterministic (dynamic ports, bounded polling, no fixed sleeps).

### EC-3 — Endpoints (`src/St4i.EngineApi/Endpoints/SiteEndpoints.cs`)
- `GET /v1/site` (Operator) → `{ enabled, host, port, bridgeStatus, siteTrustFingerprint, deviceFingerprint }`.
- `PUT /v1/site` (Engineer, **audited** `site.link.set`) → set `{enabled,host,port,siteTrustPem}` → persist via SiteLinkStore → (re)start/stop the bridge. Validate host/port/PEM (bad PEM → 400 `ApiErrorDto`).
- `GET /v1/site/identity` (Operator) → `{ deviceFingerprint, deviceCertPem }` (public cert to register at the Site).
- `POST /v1/site/test` (Engineer) → attempt an mTLS connect to the given/saved Site (bounded timeout) → `{ ok, message }` (probe, no persist — mirror `/v1/settings/probe`).
- Add the 4 routes to `RbacPolicyTests.ExpectedRoutes`. WebApplicationFactory tests: RBAC (Operator 403 on PUT), audit row on PUT, identity endpoint returns a PEM+fingerprint, PUT enable→GET reflects it.

### EC-4 — Web (`web/src/routes/Site.tsx` + nav + i18n + api)
- A "Site / Ecosystem" page: shows the **device fingerprint** (copyable — to register at the Site), a form (Site host/port + paste Site trust PEM + Enable toggle), a **Test connection** button (`POST /v1/site/test`), and the live **bridge status** badge. `RequireRole role="Engineer"` gates the mutate form; reads are Operator. Follow `Settings.tsx`/`Onboarding.tsx` + `api.ts` hook idioms; i18n vi (primary) + en. Nav item + `Shell.tsx` route. `npm run build` clean (hard gate); Playwright best-effort.

## Task order (SDD; opus review for the mTLS/identity-critical ones)
EC-1 (identity) → EC-2 (site-link + bridge, needs identity) → EC-3 (endpoints, needs config+bridge+identity) → EC-4 (web, needs endpoints) → EC final whole-branch review + push.

## Global constraints
.NET/C# (backend) + React/i18n (web). **ZERO new NuGet** (X.509 + MQTTnet-mTLS in-box). Do NOT edit the shared SDK. Additive/default-off (SiteLink.Enabled=false == today). Bridge OUTBOUND-only; local broker stays loopback-only. Reuse the DPAPI+ACL / atomic-JSON / MQTTnet-client / Map*Endpoints / TanStack-Query idioms. TDD; per-task review; full `St4i.EdgeCore.Tests` + `St4i.EngineApi.Tests` green + web build clean; deterministic tests (dynamic ports, bounded polling). Commit `feat(identity):`/`feat(uns):`/`feat(site):` with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

## Deferred (GĐ3 later / field-hardening)
mDNS auto-discovery + join wizard; EST/SCEP + Site CA enrollment; inbound NCMD command path (Policy-gated); WS-B B2 bridge inversion; reconciliation seq-number/backfill on reconnect; LAN-exposed local broker.
