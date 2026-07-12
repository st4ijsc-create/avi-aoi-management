# Zone & Conduit Model — IEC 62443-3-2

> doc 44 W6-3 (G5.18) · Zones, conduits and allowed data flows for the SYNAPSE /
> AVI-AOI platform. Target **SL-T ≥ SL2** per zone (62443-3-3). Companion:
> `IR_RUNBOOK.md`. This is the reference an auditor/tender asks for and the map IR
> uses to decide "what to isolate".

---

## 1. Zones (trust levels, high → low criticality of impact)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Z0  ENTERPRISE / IT              (business systems, cloud, users' browsers)   │
│      users · WMS/PLM/CMMS/ERP · external report/BI consumers                   │
│      SL-T: SL1  (untrusted from OT's POV)                                       │
└───────────────┬───────────────────────────────────────────────────────────────┘
             (C1) API/Web conduit  — HTTPS/tRPC + WSS · authN(2FA)+RBAC · CSP/CSRF
                 │                    mTLS-optional · master-key gated
┌───────────────┴───────────────────────────────────────────────────────────────┐
│  Z1  PLATFORM / DMZ               (the SYNAPSE server: app, DB, brokers)        │
│      Node app · Postgres/Timescale · UNS broker (EMQX) · secret mgr (OpenBao)  │
│      SL-T: SL2                                                                   │
└───────────────┬───────────────────────────────────────────────────────────────┘
             (C2) UNS/telemetry conduit — MQTT/Sparkplug · TLS→mTLS (device PKI)
                 │                          store-and-forward · one inbound seam
┌───────────────┴───────────────────────────────────────────────────────────────┐
│  Z2  EDGE / CONTROL              (edge runtime, adapters, line/cell controller) │
│      edge nodes · protocol adapters (OPC UA, MTConnect, SECS/GEM, Modbus)      │
│      SL-T: SL2                                                                   │
└───────────────┬───────────────────────────────────────────────────────────────┘
             (C3) Fieldbus/command conduit — OPC UA Sign&Encrypt · device mTLS
                 │                            9-gate command path · four-eyes
┌───────────────┴───────────────────────────────────────────────────────────────┐
│  Z3  OT / MACHINE                (PLCs, robots, AOI/AVI cameras, Zmotion, IPC)  │
│      machine controllers · vision · motion · Android alert clients             │
│      SL-T: SL2                                                                   │
└───────────────┬───────────────────────────────────────────────────────────────┘
             (C4) Safety interlock conduit — HARD-WIRED / OPC UA Safety · one-way
                 │                            monitored, never remotely disabled
┌───────────────┴───────────────────────────────────────────────────────────────┐
│  Z4  SAFETY (SIS)                (Safety PLC / hard-wired E-stop / light curtain)│
│      independent of the platform · fail-safe · SIL-rated                        │
│      SL-T: SL3  (highest — life-safety)                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Zone summary

| Zone | Name | Assets | Trust | SL-T |
|---|---|---|---|---|
| Z0 | Enterprise/IT | Browsers, WMS/PLM/CMMS/ERP, BI/report consumers, cloud | Low | SL1 |
| Z1 | Platform/DMZ | App server, Postgres/Timescale, UNS broker (EMQX), OpenBao, PG replica | Medium | SL2 |
| Z2 | Edge/Control | Edge runtime, protocol adapters, line/cell controllers | Medium-High | SL2 |
| Z3 | OT/Machine | PLCs, robots, AOI/AVI cameras, motion, IPC, Android alert clients | High | SL2 |
| Z4 | Safety (SIS) | Safety PLC, hard-wired E-stop, light curtains, interlocks | Highest | SL3 |

---

## 2. Conduits (the ONLY sanctioned paths between zones)

| ID | Between | Protocol | Controls | Enforcement flag |
|---|---|---|---|---|
| **C1** | Z0 ↔ Z1 | HTTPS / tRPC + WSS | TLS, session cookie + **2FA**, RBAC, CSP + CSRF, rate-limit, master-key gate; optional service-mTLS | `SERVICE_MTLS_ENABLED`, `ACTUATION_STEPUP_2FA` |
| **C2** | Z1 ↔ Z2 | MQTT / Sparkplug-B | Broker TLS → **device mTLS** (requestCert + pinned internal CA), per-device password, store-and-forward, single validated inbound seam | `MQTT_TLS_ENABLED`, `MQTT_MTLS_ENABLED`, `MQTT_MTLS_MODE` |
| **C3** | Z2 ↔ Z3 | OPC UA / fieldbus / vendor | OPC UA **Sign&Encrypt**, device PKI, **9-gate command path** (sim-gate, policy, four-eyes, interlock, ledger), reservation race-safety | `DEVICE_PKI_ENABLED` |
| **C4** | Z3 ↔ Z4 | Hard-wired / OPC UA Safety | Fail-safe interlock, **one-way monitored**, physically/logically independent; platform may READ safe-state, may NOT disable it | n/a (independent SIS) |

**Implicit deny:** any flow not listed as a conduit above is prohibited. In
particular there is **no direct Z0→Z2/Z3** path — enterprise systems never reach
the machine floor except through the Platform (Z1) and its gates.

---

## 3. Allowed data flows (direction matters)

| Flow | Path | Direction | Notes |
|---|---|---|---|
| Telemetry / state | Z3→Z2→Z1→Z0 | Northbound (read) | UNS normalize → dashboards, BI, reports. Read-only out of OT. |
| Inspection results (AOI/AVI) | Z3→Z1 | Northbound | HTTP ingest with disk-WAL store-and-forward; MQTT for NG alerts. |
| Alerts / Andon | Z3/Z1→Z0 | Northbound | FCM + MQTT to Android clients; escalation SLA. |
| Commands / actuation | Z0→Z1→Z2→Z3 | Southbound (write) | ONLY via the 9-gate command path: authZ + policy + sim-gate + four-eyes + interlock + ledger. Never Z0→Z3 direct. |
| Config / recipe / deploy | Z0→Z1→Z2 | Southbound | Deploy-approval inbox + four-eyes + versioned; canary→production. |
| Enterprise integration | Z0↔Z1 | Both | WMS/PLM/CMMS/ERP connectors + outbox; provider reconciliation. |
| Safe-state monitor | Z4→Z3→Z1 | Northbound READ-only | Platform observes safety status; cannot command the SIS. |
| Secret retrieval | Z1→(OpenBao in Z1) | Internal | App reads secrets via `secretManager.ts` (KV v2); env fallback. |

---

## 4. Identity & secrets per zone (zero-trust, NIST SP 800-82r3)

- **Users (Z0→Z1):** username+password → bcrypt, brute-force lockout, 2FA, RBAC,
  server-side sessions, anomalous-login detection (`anomalous_login`).
- **Services (within/into Z1):** SPIFFE-lite **JWT-SVID** signed by the internal CA
  (`serviceIdentityService.ts`), verified at the `requireServiceIdentity` seam
  (sample wired on the AI gateway). `SERVICE_MTLS_ENABLED`.
- **Devices (Z2/Z3 over C2/C3):** short-lived **X.509** device certs from the
  internal CA (`deviceIdentityService.ts`), SPIFFE-lite IDs, rotation + revocation.
  Wired into the MQTT broker as mTLS (`MQTT_MTLS_ENABLED`).
- **Secrets (Z1):** centralized in **OpenBao** (MPL-2.0) KV v2, read via
  `secretManager.ts` with honest env fallback + TTL cache + rotation
  (`SECRET_MANAGER_ENABLED`). CA private key stays out of the DB (ENV/keystore).
- **Safety (Z4):** independent credentials/keys; not managed by this platform.

---

## 5. SL-T rationale & gaps to SL2

Target **SL2** (protection against intentional violation using simple means with
low resources) for Z1–Z3; **SL3** for Safety.

Present (supports SL2): TLS/mTLS conduits, per-device + per-service identity, RBAC
+ 2FA + step-up, tamper-evident WORM audit + SIEM export, policy-as-code deny,
9-gate command path with four-eyes, secret manager, backup encryption.

Owner/infra to reach full SL2 posture (see doc 44 §8.3): enable + provision device
certs and flip `MQTT_MTLS_ENABLED`/`DEVICE_PKI_ENABLED`; stand up OpenBao and set
`SECRET_MANAGER_ENABLED`; point `SIEM_*` at the collector; OPC UA Sign&Encrypt on
adapters; segment the physical/virtual network to match these conduits; formal
SL-T gap assessment + 62443-4-1 SDL evidence for tender.
