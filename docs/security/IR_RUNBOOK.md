# Incident Response Runbook — SYNAPSE / AVI-AOI OT Platform

> doc 44 W6-3 (G5.18) · aligned to IEC 62443-2-1 (CL2), NIST SP 800-61r2 (IR
> lifecycle) and NIST SP 800-82r3 (OT security). Companion: `ZONE_CONDUIT_62443.md`.
>
> **Golden rule for OT:** *never let incident response stop safe production.* The
> Safety zone (hard-wired E-stop / Safety PLC) is independent of this platform and
> is NEVER disabled as an IR action. License grace is 30 days — a security incident
> must not brick the line.

---

## 0. Roles & contacts (fill in per site)

| Role | Responsibility | Contact |
|---|---|---|
| Incident Commander (IC) | Owns the incident, declares severity, authorizes containment | _TODO_ |
| OT Lead | Zone isolation, machine-side actions, safe-state | _TODO_ |
| Platform/On-call | Server, DB, broker, secret manager, audit export | _TODO_ |
| Security/Compliance | Evidence chain, regulator notification (EU CRA 24h) | _TODO_ |
| Plant Manager | Production impact decisions, customer comms | _TODO_ |

**Regulatory clock:** EU CRA requires a vulnerability/incident report within **24h**
of becoming aware (from 9/2026). Start the clock at DETECT.

---

## 1. Severity classification

| Sev | Definition | Examples | Target response |
|---|---|---|---|
| **SEV-1** | Active compromise touching OT/actuation or safety | Rogue command to a machine, ransomware on edge, Safety-relevant tampering | Immediate, 24/7 |
| **SEV-2** | Confirmed compromise of Platform/Edge, no actuation yet | Server RCE, credential theft, secret leak, audit tamper detected | < 1h |
| **SEV-3** | Suspicious but unconfirmed | Anomalous-login alerts, policy DENY spikes, single failed intrusion | < 4h |
| **SEV-4** | Informational / hygiene | Expired cert, missed patch, SBOM CVE | Next business day |

---

## 2. Lifecycle — DETECT → CONTAIN → ERADICATE → RECOVER → LEARN

### 2.1 DETECT

Signals the platform already produces (wire these into the SIEM — see §4):

- **Anomalous login** — `anomalous_login` audit event (new IP / unusual hour /
  burst-fail / geo change). Flag: `ANOMALOUS_LOGIN_ENABLED`.
- **Policy DENY** — policy-as-code `deny` decisions (skip-AOI on class-3, override
  in crowded zone, actuation without step-up).
- **Actuation events** — `command.dispatch`, `interlock_auto_block`,
  `ai_action_executed`, deploy approvals (9-gate command path).
- **Auth failures / lockouts** — brute-force lockout (`users.lockedUntil`).
- **Audit tamper** — hash-chain `verifyChain` break or CRUD content-hash mismatch.
- **Config/role/permission changes** — `config_change`, `role_change`, `permission_change`.

All of the above are in the tamper-evident `audit_log` and are forwarded to the
SIEM by `siemExporter.ts` (RFC 5424 syslog or JSON webhook) when
`SIEM_EXPORT_ENABLED=true`.

**On alert:** open an incident ticket, assign IC, set severity, START the evidence
log (§3). Do NOT reboot / reimage yet — you will destroy volatile evidence.

### 2.2 CONTAIN — zone isolation (see `ZONE_CONDUIT_62443.md`)

Contain at the **narrowest zone/conduit** that stops the spread. Prefer conduit
blocks over powering equipment down.

Order of preference (least → most disruptive):

1. **Revoke the actor's identity, not the zone.**
   - User: disable account (`users.isActive=false`), `sessionRouter.revokeAll`, force 2FA re-enrol.
   - Service: `securityIdentity.revokeServiceIdentity` (JWT-SVID stops verifying).
   - Device: `securityIdentity.revokeDeviceCert` → the device's mTLS cert is
     rejected on next connect (MQTT `MQTT_MTLS_MODE=strict`).
2. **Block a conduit** at the firewall/broker: e.g. sever Edge↔Platform MQTT, or
   Enterprise↔Platform API. The UNS store-and-forward + outbox keep the line
   running locally while the conduit is down.
3. **Isolate an Edge zone** (a cell/line): pull its uplink; the edge runtime keeps
   the machine in a safe, locally-controlled state.
4. **Tighten enforcement flags** (fast, reversible):
   - `MQTT_MTLS_ENABLED=true` + `MQTT_MTLS_MODE=strict` — reject uncertified devices.
   - `SERVICE_MTLS_ENABLED=true` — require SVIDs on internal service calls.
   - `DEVICE_PKI_ENABLED=true` — enforce device cert verification.
   - `ACTUATION_STEPUP_2FA=true` — force 2FA on every actuation.
5. **Freeze deploys / actuation** — the command path's four-eyes + deploy-approval
   inbox can be set to reject; interlocks can force safe-state.

> **NEVER as containment:** disabling the Safety zone, disabling hard-wired E-stop,
> or an unplanned mass power-off (creates new safety hazards).

### 2.3 Preserve evidence (do this DURING containment)

- Snapshot the **immutable audit** first (§3) — it is WORM/hash-chained and is your
  legal record. Export it OFF the affected host.
- Capture volatile state before killing processes: broker client list, active
  sessions, `command_log`, edge-node status, container/process list, netstat.
- Preserve secret-manager audit (OpenBao/Vault audit device) — who read which secret.
- Do not log secrets into the ticket. Reference by name only.

### 2.4 ERADICATE

- Rotate every credential the actor could have touched: `refreshSecret()` /
  OpenBao rotation for JWT_SECRET, SIGNOFF_SECRET, MASTER_API_KEY, SMTP, broker
  cluster cookie; re-issue device certs (`rotateDeviceCert`) and service SVIDs.
- Patch the exploited vector; verify SBOM has no known-exploited CVE; re-run SAST.
- Rebuild compromised hosts from a known-good, cosign-verified image.

### 2.5 RECOVER

- Restore from a **verified** backup (the secret keystore + DB backup are
  AES-GCM encrypted, W0-I). Verify restore counts before cutover.
- Bring zones back **innermost-first** (OT/Edge safe-state → Platform → Enterprise),
  re-enabling conduits one at a time and watching the SIEM.
- Re-verify the audit hash-chain end-to-end (`verifyChain`) to confirm no gap.
- Keep tightened flags (mTLS strict, step-up 2FA) until the post-incident review
  clears them.

### 2.6 LEARN

- Blameless post-incident review within 5 business days.
- Update detections (new SIEM rule / anomaly signal), zone/conduit doc, and this
  runbook. File any product hardening as a gap in the doc-44 backlog.

---

## 3. Evidence collection — immutable log chain

The platform provides a **tamper-EVIDENT** record, not just append-only:

- `audit_log` — hash-chained + per-row keyed content-hash
  (`auditChain.ts` / `auditTrailService.ts`); WORM-enforced at the DB role level
  (migration 0224, `avi_app` least-privilege, no UPDATE/DELETE grant).
- `control_audit` — serialized hash-chain for control-critical events
  (migration 0220, `controlAuditService.ts`).
- Verify integrity any time with `verifyChain(records)` → `{ ok, brokenAt }`.
  A break pinpoints the first altered/inserted/deleted record.

**Collection procedure:**

1. Export the relevant `audit_log` / `control_audit` window to write-once storage
   OFF the affected host. Record SHA-256 of the export.
2. Run `verifyChain` on the export; attach the result. If `ok:false`, the tamper
   itself is evidence — note `brokenAt` and the surrounding records.
3. Pull the SIEM copy (independent second location — the whole point of G5.18) and
   diff against the local export; a gap = suppressed local logging.
4. Preserve the OpenBao/Vault audit log (secret access trail).

---

## 4. SIEM wiring (G5.18)

`server/services/security/siemExporter.ts`:

- `SIEM_EXPORT_ENABLED=true` to turn export on (default OFF).
- `SIEM_TRANSPORT` = `syslog-udp` | `syslog-tcp` | `webhook`.
- syslog → `SIEM_SYSLOG_HOST` / `SIEM_SYSLOG_PORT` (RFC 5424, `<PRI>1 …`).
- webhook → `SIEM_WEBHOOK_URL` (JSON body).
- `forwardRecentAuditToSiem()` streams the existing audit rows on a cron — the SIEM
  reads the SAME hash-chained store (no parallel event pipeline).

**Recommended SIEM detections:** `anomalous_login` bursts; `policy` deny spikes;
any `actuation` outside a change window; `config/role/permission` change off-hours;
audit-verify failures; secret-read anomalies from OpenBao.

---

## 5. Drills (tabletop + live)

Run at least quarterly; capture MTTA/MTTR each time.

1. **Anomalous-login → account takeover** — inject a new-IP + burst-fail login;
   confirm the `anomalous_login` event reaches the SIEM; practice account disable +
   session revoke.
2. **Rogue device** — connect a device with a revoked/invalid cert while
   `MQTT_MTLS_MODE=strict`; confirm rejection + SIEM alert.
3. **Conduit block** — sever Edge↔Platform MQTT; confirm the line keeps running on
   store-and-forward and recovers cleanly.
4. **Audit tamper** — edit a copied audit row; confirm `verifyChain` flags it.
5. **Secret compromise** — rotate JWT/SIGNOFF/MASTER via OpenBao; confirm the app
   picks up the rotated value (`refreshSecret`) with no downtime.

Record: time-to-detect, time-to-contain, whether production stayed up, gaps found.
