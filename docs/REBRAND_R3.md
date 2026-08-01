# Rebrand R-3 — MQTT wire namespace `avi/` → `synapse/`

> doc 44 §11 (rebrand plan, table 11.2 row R-3) + §12 decision **D4** (dual-publish + grace) and
> **D3** (DB name kept). This is the **highest-risk** rebrand step because the `avi/…` wire
> namespace is subscribed by field devices we do **not** control on our release cadence:
> - AOI / AVI station clients (C#) — subscribe `avi/client/{id}/configure`, publish `avi/client/{id}/{info,ack}`
> - the **FactoryAlertSystem** mobile app (APK) — subscribes `avi/factory/…/errors`, `avi/+/workshop/…`, `avi/escalations/#` (see `FactoryAlertSystem/src/utils/constants.ts`)
>
> We therefore rebrand the wire the safe way: **dual-publish + dual-subscribe + a grace period**.
> Nothing changes until an operator opts in; the legacy topic keeps working 100% during grace.

## 1. Mechanism

Implemented in [`server/services/mqtt/topicRebrand.ts`](../server/services/mqtt/topicRebrand.ts)
(pure) + wired at every publish/subscribe seam of
[`server/services/mqttService.ts`](../server/services/mqttService.ts).

- **Dual-publish** — every internal `avi/…` publish goes through `dualAedesPublish`, and every
  external-broker publish through `dualExternalPublish`. When `MQTT_TOPIC_DUAL_PUBLISH` is on they
  ALSO emit the `synapse/…` twin (external: `avi-aoi/…` → `synapse/…`). The legacy topic is still
  published → no station/APK breaks.
- **Dual-subscribe** — the inbound Aedes handler canonicalises `synapse/…` back to `avi/…`
  (`canonicalizeInboundTopic`) before matching, so a migrated device publishing on
  `synapse/client/{id}/info` is understood. **Always-on** (a device only publishes `synapse/…`
  after it migrated, so accepting both is purely additive).
- **clientId** — the outbound bridge id `avi-aoi-server` → `synapse-server` flips **only** at the
  final cutover (`MQTT_TOPIC_LEGACY_DISABLE`), not at dual-publish, so a broker ACL that admits
  `avi-aoi-server*` is not self-broken mid-grace.

### Publish matrix (per `planPublishTopics`)

| `MQTT_TOPIC_DUAL_PUBLISH` | `MQTT_TOPIC_LEGACY_DISABLE` | Topics emitted for `avi/x` | Phase |
|---|---|---|---|
| _(unset)_ | _(unset)_ | `avi/x` only | **default — byte-compatible with today** |
| `true` | _(unset)_ | `avi/x` **and** `synapse/x` | dual-publish grace |
| `true` | `true` | `synapse/x` only | cutover complete |
| _(unset)_ | `true` | `avi/x` only (fail-safe — never emits nothing) | inert |

## 2. Flags (new — both default OFF)

```
MQTT_TOPIC_DUAL_PUBLISH=true    # step 1: also emit synapse/… (keep avi/… working)
MQTT_TOPIC_LEGACY_DISABLE=true  # step 3: after all clients migrate, stop emitting avi/…
```

## 3. Rollout order (do NOT skip a step)

1. **Enable dual-publish** — set `MQTT_TOPIC_DUAL_PUBLISH=true`, restart the app. Both `avi/…`
   and `synapse/…` now carry every frame. Verify legacy clients (AOI stations + APK) are
   unaffected. *No client change yet.*
2. **Migrate clients (owner-paced, 2–4 weeks grace)** — roll out AOI/C# firmware and a new
   FactoryAlertSystem **APK** that subscribe `synapse/…` (mobile topics stay owner-driven — the
   APK ships on its own cadence). Both topics are live, so migration is zero-downtime and can be
   staged device-by-device.
3. **Cut over** — once **every** field client subscribes `synapse/…`, set
   `MQTT_TOPIC_LEGACY_DISABLE=true` (with dual-publish still on) and restart. The server now emits
   `synapse/…` only; the `avi-aoi-server` bridge id becomes `synapse-server`.

> **Do not** set `MQTT_TOPIC_LEGACY_DISABLE` while any client still subscribes `avi/…` — that is
> exactly the breakage this plan prevents (doc 44 §13 risk row).

## 4. Configuration to rebrand (owner) — env, NOT changed by this batch

These are already env-driven; change them during R-3 (they are commented `# (rebrand W7)` in
`.env.example`). **This batch does not edit `.env.example`** — apply on the deployment's real `.env`:

| Variable | From | To (R-3) | Notes |
|---|---|---|---|
| `EXTERNAL_MQTT_TOPIC_PREFIX` | `avi-aoi` (default) | `synapse` | External-bridge prefix; dual-publish mirrors it automatically while unset/`avi-aoi`. |
| `UNS_ENTERPRISE_NAME` | `AVI-AOI` | `SYNAPSE` | ISA-95 enterprise segment + Sparkplug group derivation. |
| `UNS_SPARKPLUG_GROUP_ID` | `avi` | `synapse` | Sparkplug group_id. |
| `UNS_SPARKPLUG_EDGE_NODE_ID` | `avi-aoi-ot` | `synapse-ot` | Sparkplug edge node id. |
| `MASTER_API_KEY` | _(contains brand string)_ | rotate | Rotating it forces re-config on every station — schedule with the client migration window. |

## 5. Explicitly kept (D3 — do NOT rename)

- **DB names** `aoi_management` / `avi_app` / `avi_aoi_ts` — internal, not user-facing. Renaming =
  dump/restore + rewrite every GRANT/RLS/connstring → risk not worth it. Keep.
- **Device-class term "AOI"** — `AOI/AVI/SPI/AXI` are *machine types*, not branding. All the
  `aoi*` routers/tables/routes/env stay (doc 44 §11 "keep-forever" list). After R-3, any remaining
  "AOI" in the app means the **machine type**.

## 6. Verify / rollback

- **Verify:** with dual-publish on, subscribe a test client to `synapse/#` AND keep an APK on
  `avi/#` — both must receive every NG alert / summary / command. Unit coverage:
  `server/services/mqtt/topicRebrand.test.ts` (map + round-trip + matrix + dual-publish on a mock
  broker) and the inbound dual-subscribe path in `mqttService`.
- **Rollback:** unset `MQTT_TOPIC_LEGACY_DISABLE` (re-enable legacy), or unset
  `MQTT_TOPIC_DUAL_PUBLISH` entirely (back to `avi/…`-only) and restart. Fully reversible — no
  schema, no data migration.
