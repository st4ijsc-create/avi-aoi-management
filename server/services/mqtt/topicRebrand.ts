/**
 * doc 44 §11 R-3 — MQTT topic rebrand  avi/ ↔ synapse/  (DUAL-PUBLISH + DUAL-SUBSCRIBE).
 *
 * WHY: the wire namespace `avi/…` is subscribed by field devices we do NOT control on our
 * release cadence — AOI/C# station clients and the FactoryAlertSystem APK (they subscribe
 * `avi/factory/…`, `avi/+/workshop/…`, see FactoryAlertSystem/src/utils/constants.ts). We
 * cannot flip the namespace atomically without breaking them mid-shift. So R-3 does the
 * rebrand the safe way, exactly like the SAML / mTLS rollouts before it:
 *
 *   1. DUAL-PUBLISH  (MQTT_TOPIC_DUAL_PUBLISH=true) — every `avi/…` publish is ALSO emitted
 *      as `synapse/…`. The legacy topic KEEPS working 100% → no station/APK breaks.
 *   2. Migrate clients — devices move their subscriptions to `synapse/…` on their own APK/
 *      firmware cadence (owner-driven). During this window BOTH topics carry the same frame.
 *   3. CUTOVER (MQTT_TOPIC_LEGACY_DISABLE=true) — once every client has migrated, the owner
 *      stops emitting the legacy `avi/…` branch; only `synapse/…` remains.
 *
 * DEFAULT (both flags OFF) = publish `avi/…` ONLY, byte-for-byte identical to pre-R-3 → the
 * change is inert until an operator opts in. This module is PURE (no I/O, no broker, no DB)
 * so it is trivially unit-testable and reusable by both the internal Aedes broker and the
 * external cloud-broker bridge.
 *
 * DUAL-SUBSCRIBE is handled where messages are RECEIVED (mqttService inbound handler): a
 * migrated device publishing on `synapse/client/{id}/info` must still be understood. We
 * canonicalise an inbound `synapse/…` topic back to `avi/…` (`toAviTopic`) BEFORE matching,
 * which is always-on and safe — a device only ever publishes `synapse/…` after it migrated.
 */

/** Internal-broker topic roots (leading segment). */
export const LEGACY_TOPIC_ROOT = "avi";
export const SYNAPSE_TOPIC_ROOT = "synapse";

/** External-bridge topic prefix (EXTERNAL_MQTT_TOPIC_PREFIX default). */
export const LEGACY_EXTERNAL_PREFIX = "avi-aoi";
export const SYNAPSE_EXTERNAL_PREFIX = "synapse";

/** Outbound-bridge MQTT clientId brand (external cloud broker). */
export const LEGACY_SERVER_CLIENT_ID = "avi-aoi-server";
export const SYNAPSE_SERVER_CLIENT_ID = "synapse-server";

/**
 * Replace ONLY the leading path segment `from` with `to` when the topic is exactly `from`
 * or is rooted at `from/…`. Anything else (including a topic that merely starts with the
 * same characters, e.g. `aviator/…` vs root `avi`) is returned unchanged — no false hits.
 */
function replaceLeadingSegment(topic: string, from: string, to: string): string {
  if (topic === from) return to;
  if (topic.startsWith(from + "/")) return to + topic.slice(from.length);
  return topic;
}

/** `avi/…` → `synapse/…`  (idempotent for non-`avi/` topics). */
export function toSynapseTopic(aviTopic: string): string {
  return replaceLeadingSegment(aviTopic, LEGACY_TOPIC_ROOT, SYNAPSE_TOPIC_ROOT);
}

/** `synapse/…` → `avi/…`  (idempotent for non-`synapse/` topics). Round-trips with toSynapseTopic. */
export function toAviTopic(synapseTopic: string): string {
  return replaceLeadingSegment(synapseTopic, SYNAPSE_TOPIC_ROOT, LEGACY_TOPIC_ROOT);
}

/**
 * Map the configured external prefix to its synapse form. Only the brand token is rebranded:
 *   `avi-aoi` → `synapse`, `avi` → `synapse`. Any custom, non-brand prefix (e.g. "prod") is
 * returned unchanged → external dual-publish becomes a no-op for that deployment (the owner
 * would set the synapse external prefix explicitly if they customised it).
 */
export function toSynapseExternalPrefix(prefix: string): string {
  if (prefix === LEGACY_EXTERNAL_PREFIX || prefix === LEGACY_TOPIC_ROOT) {
    return SYNAPSE_EXTERNAL_PREFIX;
  }
  return prefix;
}

/** Is dual-publish enabled? Default OFF (legacy-only, bit-compat). */
export function isDualPublishEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MQTT_TOPIC_DUAL_PUBLISH === "true" || env.MQTT_TOPIC_DUAL_PUBLISH === "1";
}

/** Has the legacy `avi/…` branch been retired after grace? Default OFF (keep legacy). */
export function isLegacyDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MQTT_TOPIC_LEGACY_DISABLE === "true" || env.MQTT_TOPIC_LEGACY_DISABLE === "1";
}

/**
 * The set of topics a single logical publish should be emitted on, given the two rollout
 * flags. `fromRoot`/`toRoot` let this serve BOTH the internal broker (avi→synapse) and the
 * external bridge (avi-aoi→synapse). The FIRST element is the PRIMARY topic (it keeps the
 * caller's original publish callback so promise-resolve / logging semantics are unchanged);
 * any further element is a fire-and-forget mirror.
 *
 * Matrix (guaranteed to NEVER emit an empty list — a topic is always published):
 *   • not rooted at `fromRoot`            → [topic]                (nothing to rebrand)
 *   • dual OFF                            → [topic]                (legacy only — DEFAULT)
 *   • dual ON,  legacy-disable OFF        → [topic, rebranded]     (dual-publish, grace)
 *   • dual ON,  legacy-disable ON         → [rebranded]            (cutover — synapse only)
 *
 * NOTE: legacy-disable is only honoured while dual-publish is ON. Setting legacy-disable
 * alone can never silence the legacy branch without a synapse replacement (fail-safe).
 */
export function planPublishTopics(
  topic: string,
  fromRoot: string,
  toRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const rebranded = replaceLeadingSegment(topic, fromRoot, toRoot);
  if (rebranded === topic) return [topic]; // topic is not under fromRoot → nothing to do
  if (!isDualPublishEnabled(env)) return [topic]; // default: legacy only (bit-compat)
  if (isLegacyDisabled(env)) return [rebranded]; // grace complete → synapse only
  return [topic, rebranded]; // dual-publish
}

/**
 * Generic dual-publish driver (broker-agnostic, pure). Computes the topic plan and invokes
 * `emit(packet, isPrimary)` once per topic — the caller decides how to actually publish
 * (Aedes `broker.publish`, mqtt.js `client.publish`, …). The packet's `topic` is rewritten
 * for each emission; the original object is reused for the primary topic (keeps the payload
 * Buffer reference), a shallow clone is used for mirrors.
 */
export function dualPublish<P extends { topic: string }>(
  packet: P,
  emit: (packet: P, isPrimary: boolean) => void,
  opts: { fromRoot?: string; toRoot?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  const fromRoot = opts.fromRoot ?? LEGACY_TOPIC_ROOT;
  const toRoot = opts.toRoot ?? SYNAPSE_TOPIC_ROOT;
  const env = opts.env ?? process.env;
  const topics = planPublishTopics(packet.topic, fromRoot, toRoot, env);
  topics.forEach((t, i) => {
    const p = t === packet.topic ? packet : ({ ...packet, topic: t } as P);
    emit(p, i === 0);
  });
}

/**
 * Canonicalise an INBOUND topic so existing `^avi/…$` matchers accept a migrated device that
 * now publishes on `synapse/…`. Always-on (no flag): a device only publishes synapse/ after
 * it migrated, so accepting both is purely additive and never changes legacy behaviour.
 */
export function canonicalizeInboundTopic(topic: string): string {
  return toAviTopic(topic);
}

/**
 * The outbound-bridge clientId brand. Kept as the legacy `avi-aoi-server` through the entire
 * dual-publish grace window (so a customer cloud broker that ACL-authorises `avi-aoi-server*`
 * keeps admitting us while we mirror to synapse/ topics), and flips to `synapse-server` only
 * at the FINAL cutover (MQTT_TOPIC_LEGACY_DISABLE) — the point at which the operator has also
 * updated any broker-side ACLs. This avoids self-inflicting the exact breakage R-3 prevents.
 */
export function resolveServerClientId(env: NodeJS.ProcessEnv = process.env): string {
  return isLegacyDisabled(env) ? SYNAPSE_SERVER_CLIENT_ID : LEGACY_SERVER_CLIENT_ID;
}
