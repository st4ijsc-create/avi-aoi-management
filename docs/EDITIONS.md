# SYNAPSE Editions — Machine · Line · Site

> doc 44 §9 / DEVPLAN §4 / ADR-007 "collapsible deployment". **ONE codebase → THREE editions**
> with a seamless upgrade path. Source of truth for the descriptors: [`shared/editions.ts`](../shared/editions.ts).
> Runtime resolution: [`server/_core/deploymentProfile.ts`](../server/_core/deploymentProfile.ts).
> Deployment/compose companion: [`deploy/EDITIONS.md`](../deploy/EDITIONS.md).

An edition **bounds** the license — it never grants beyond it. Effective entitlement =
`(license ∩ edition module-ceiling)`, with quotas clamped **down** by the edition. The DEFAULT
edition (when `EDITION` is unset) is **site** (full) → any existing deployment behaves exactly as
before this feature landed.

## 1. Matrix (DEVPLAN §4)

| | **Machine** | **Line** | **Site** |
|---|---|---|---|
| Buyer / use | Bán kèm 1 máy (OEM), 1 IPC | Cụm máy / 1 dây chuyền | Toàn nhà máy, đa line, đa hãng |
| Licensing model | OEM perpetual | Subscription | Subscription / enterprise |
| Topology | `single-node` | `line-cluster` | `site-ha` |
| Default infra | `embedded` — Aedes in-process broker, time-series degrades to the main DB | `external` | `external` — EMQX cluster + dedicated TimescaleDB |
| Module ceiling | monitoring · data-mgmt · production · quality · alerts · AI · engineering · OT-control | + analytics | `*` (all modules) |
| `MAX_DEVICE_ADAPTERS` | 16 | 64 | ∞ |
| `MAX_MACHINES` | 8 | 40 | ∞ |
| `MAX_PRODUCTS` | 200 | 2 000 | ∞ |
| `MAX_PRODUCTION_ORDERS` | 500 | 5 000 | ∞ |
| `MAX_AI_MODELS` | 8 | (registry) | ∞ |
| `MAX_FEDERATION_SITES` | 0 | 1 | ∞ |
| Compose / deploy | `deploy/compose/docker-compose.machine.yml` | K3s (`deploy/k3s/`) | `docker-compose.yml` / Helm |

> The heavy multi-site/federation modules are intentionally **excluded** from Machine (upgrade
> to Line/Site). Core modules are ALWAYS allowed in every edition regardless of the ceiling.

## 2. Feature flags per license (how the bound is applied)

Two layers, evaluated in order:

1. **`module-registry`** — the catalogue: WHAT modules/features/quotas exist.
2. **License** — which optional modules this deployment is entitled to (Ed25519-signed).
3. **Edition** — a CEILING on modules + a CLAMP on quotas + an infra default.

```
effectiveModules = resolveEditionModules(EDITION, licensedModules)   // (licensed ∪ core) ∩ ceiling
effectiveQuota   = clampQuota(EDITION, feature, licenseValue)         // min(licenseValue, ceiling)
```

- An optional module **licensed but above the edition ceiling** (e.g. `MOD_FEDERATION` on
  Machine) is **not** enabled → the UI shows an upgrade path, not an error.
- A module **in the ceiling but not licensed** is **not** auto-granted — the license still decides.
- **Grace, never stop production:** license lapse degrades to a 30-day grace; the line keeps
  running (doc 44 §9). Editions bound entitlement; they never brick a running machine.

Runtime shape is reported honestly by the read-only `trpc.edition.current` API and the startup
log line `[edition] …` (see `describeDeployment`).

## 3. Upgrade path (seamless — no reinstall, no data loss)

```
Machine × N  ──(Join Wizard: bridge local Aedes → Site EMQX, mDNS/static discover)──▶  Line
     │                                                                                   │
     └───────────────────────── same codebase, same DB schema ────────────────────────▶ Site ──▶ Federation
```

- **UNS is the upgrade path.** A Machine Edition publishes its own `synapse/…` (and, during the
  R-3 grace window, `avi/…`) UNS tree to its embedded broker. Joining a Site does **not** reinstall
  anything — the [Join Wizard](../server/services/edge/joinWizardService.ts) discovers peer machines
  (mDNS `_synapse-uns._tcp`, or `JOIN_STATIC_PEERS` for multicast-free sites) and **bridges** each
  machine's broker upstream to the Site EMQX (`JOIN_WIZARD_ENABLED` + `JOIN_SITE_BROKER_URL`).
- The license credits the old edition against the new one (upgrade credit).
- **Acceptance (doc 44 W7):** *2 Machine Editions join 1 Site without reinstalling.*

## 4. CI anti-drift (DEVPLAN §9.8)

A change that keeps one edition green while silently breaking another is "edition drift". Two gates:

- **`.github/workflows/ci.yml` → `edition-matrix`** (every PR): builds + import-smokes the SAME
  codebase under `EDITION=machine` and `EDITION=site` via `scripts/edition-smoke-import.mjs`
  (asserts topology/infra consistency + that R-3 wire rebrand is inert by default). Cheap, no
  containers.
- **`.github/workflows/edition-smoke.yml`** (on `deploy/**` changes): boots BOTH real compose
  profiles and asserts `/health` + the reported edition. Authoritative, heavy.

## 5. Run

```bash
# Machine Edition (collapsed single-node): postgres(ts-ha) + redis + app, embedded broker.
docker compose -f deploy/compose/docker-compose.machine.yml --env-file .env up -d

# Site Edition (full stack): postgres + redis + emqx + timescaledb + app.
docker compose -f docker-compose.yml up -d
```

Desktop kiosk for Machine Edition (Tauri 2 scaffold): [`apps/machine-shell/`](../apps/machine-shell/README.md).

## 6. Env

```
EDITION=machine|line|site       # default: site (full, backward-compatible)
INFRA_PROFILE=embedded|external # default: the edition's own default
EDITION_PROFILE=true|false      # F1 flag — when false, edition/infra resolution is advisory-only
```
