# SYNAPSE Developer Portal (P6)

> doc 33 §3.8 / P6 (SYNAPSE R3). The public face for third-party integrators — integrate **chỉ
> bằng tài liệu công bố**, reach first-plugin in **≤ 1 day**. Served read-only via `trpc.devPortal.*`.

## Published contracts
- **OpenAPI 3.1** (REST `/api/v1`): `trpc.devPortal.openapi`
- **AsyncAPI 2.6** (UNS / Sparkplug channels): `trpc.devPortal.asyncapi`
- Source of truth: [`server/services/contracts/apiSpec.ts`](../../server/services/contracts/apiSpec.ts) · schema BACKWARD gate: [`schemaRegistry.ts`](../../server/services/contracts/schemaRegistry.ts) (CI: `.github/workflows/contract-gate.yml`).

## Six extension points (ADR-008)
`trpc.devPortal.extensionPoints` → Device Connector · Robot Adapter · Skill · Enterprise Connector · AI Model · UI Widget. Each has a contract; a plugin declares ONE via its manifest `kind`.

## Author a plugin (steps)
1. **Scaffold** — `trpc.devPortal.newPlugin({ id, kind })` → a valid `plugin.yaml`/manifest + `configSchema` (the Setup Wizard auto-renders the form) + a conformance checklist.
2. **Implement** — a Device Connector implements the SDK lifecycle `Discover → Configure → Validate → Run → Drain` + a tag→UNS mapping. The core never links your code directly (out-of-process sidecar; a vendor C#/C++ DLL is wrapped by a small sidecar that speaks the Connector contract).
3. **Conformance** — every checklist item must pass (connect/reconnect + Birth/Death, tag mapping w/ unit+quality, store-and-forward order across an outage, quota/rate-limit, drain ≤30s, least-privilege ACL, signature). Preview via `trpc.devPortal.sandbox({ manifest })`.
4. **Sign + submit** — Ed25519-sign the artifact + attach an SBOM → internal registry. R4 opens a public marketplace for certified third-party plugins.

## Compatibility & safety
- The Hub runs an **apiVersion gate**: a manifest whose range excludes the current Plugin API is **refused** (never "runs blind"). Backward-compatible within a major; a breaking Plugin-API change runs 2 majors in parallel ≥ 2 release cycles.
- A plugin runs **out-of-process** (watchdog + backoff + circuit-break + CPU/RAM quota + per-call timeout) — a broken plugin never drags down the platform.
- Unsigned plugins are **rejected in production**.

## Flag
`DEV_PORTAL=false` (advisory). The portal is read-only; publishing goes through the registry, not an API.
