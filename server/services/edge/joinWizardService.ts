/**
 * Join Wizard seam — doc 44 §9 / SYNAPSE ADR-007 "UNS is the upgrade path".
 *
 * GOAL (the commercial promise): a Machine Edition sitting on 1 IPC can be JOINED to a Site
 * without reinstalling — it keeps producing to its LOCAL embedded broker, and a BRIDGE
 * forwards its UNS tree (`synapse/…`, and `avi/…` during the R-3 grace window) UP to the
 * Site's EMQX. Two Machine Editions join one Site → the Site sees both without touching
 * either machine. This module is the seam for that:
 *
 *   1. DISCOVERY (mDNS/Bonjour) — find OTHER Machine Editions advertising `_synapse-uns._tcp`
 *      on the LAN, so the wizard can offer "join these N machines".
 *   2. BRIDGE (broker→broker) — connect the local broker to the Site broker and republish the
 *      UNS tree upstream. Uses the `mqtt` dependency that is ALREADY installed → usable now.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HONEST POSTURE (mirrors samlProvider — no new dependency is forced):
 *   • The BRIDGE half is real: it only needs `mqtt` (already a dependency) + two broker URLs.
 *   • The mDNS DISCOVERY half needs a zero-conf library (`bonjour-service`) that is NOT
 *     installed. Until the owner adds it, discoverPeers() refuses with MDNS_NOT_AVAILABLE
 *     instead of pretending. To finish it: `pnpm add bonjour-service`, then wire the marked
 *     seam in discoverPeers()/advertiseSelf(). A STATIC peer list (JOIN_STATIC_PEERS) works
 *     today with no library, for sites that don't allow multicast.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Everything is gated by JOIN_WIZARD_ENABLED (default OFF → zero surface, no connections).
 */

import { getEdition } from "@shared/editions";
import { LEGACY_TOPIC_ROOT, SYNAPSE_TOPIC_ROOT, isLegacyDisabled } from "../mqtt/topicRebrand";

/** mDNS/Bonjour service type Machine Editions advertise themselves under. */
export const JOIN_MDNS_SERVICE_TYPE = "synapse-uns";
/** Default advertised/looked-up port (the local embedded MQTT broker). */
export const JOIN_DEFAULT_BROKER_PORT = 1883;

export class MdnsNotAvailableError extends Error {
  readonly code = "MDNS_NOT_AVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "MdnsNotAvailableError";
  }
}

/** A discovered (or statically configured) peer Machine Edition to potentially bridge. */
export interface PeerAdvertisement {
  /** Stable node id / hostname of the peer. */
  nodeId: string;
  /** Reachable host (IP or mDNS host). */
  host: string;
  /** MQTT broker port on the peer. */
  port: number;
  /** Advertised edition + version + site (from mDNS TXT or static config). */
  edition?: string;
  version?: string;
  siteId?: string;
  /** How the peer was found. */
  source: "mdns" | "static";
}

export interface DiscoveryResult {
  available: boolean;
  /** Populated when available; empty otherwise. */
  peers: PeerAdvertisement[];
  /** Present when NOT available (e.g. the mDNS library is missing). */
  reason?: string;
}

/** Config for the local→site broker bridge (the join's data path). */
export interface JoinBridgeConfig {
  enabled: boolean;
  /** The LOCAL embedded broker to read from (this machine). */
  localBrokerUrl: string;
  /** The SITE broker to republish the UNS tree to. Null → no upstream configured yet. */
  siteBrokerUrl: string | null;
  siteBrokerUsername: string | null;
  siteBrokerPassword: string | null;
  /** Topic filters to forward local → site (the UNS tree). */
  topicFilters: string[];
}

// ─── Flags / config ──────────────────────────────────────────────────────────

/** Is the Join Wizard enabled at all? Default OFF. */
export function isJoinWizardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JOIN_WIZARD_ENABLED === "true" || env.JOIN_WIZARD_ENABLED === "1";
}

/**
 * The UNS topic filters this machine bridges UPSTREAM to the Site. Always includes the
 * synapse tree; ALSO includes the legacy `avi/#` tree while R-3 dual-publish is on and legacy
 * has not been retired (so a not-yet-migrated machine's data still reaches the Site). Once the
 * fleet is on synapse-only (MQTT_TOPIC_LEGACY_DISABLE), the legacy filter drops off.
 */
export function planBridgeTopicFilters(env: NodeJS.ProcessEnv = process.env): string[] {
  const filters = [`${SYNAPSE_TOPIC_ROOT}/#`];
  // Bridge the legacy `avi/#` tree too UNLESS the operator has cut over (MQTT_TOPIC_LEGACY_DISABLE).
  // Keeps a machine whose publishers have not yet migrated fully visible at the Site.
  if (!isLegacyDisabled(env)) filters.push(`${LEGACY_TOPIC_ROOT}/#`);
  return filters;
}

/** Resolve the bridge config from env (pure). */
export function getJoinBridgeConfig(env: NodeJS.ProcessEnv = process.env): JoinBridgeConfig {
  const localPort = Number(env.MQTT_PORT || JOIN_DEFAULT_BROKER_PORT) || JOIN_DEFAULT_BROKER_PORT;
  return {
    enabled: isJoinWizardEnabled(env),
    localBrokerUrl: env.JOIN_LOCAL_BROKER_URL?.trim() || `mqtt://127.0.0.1:${localPort}`,
    // The Site broker to join. Reuse UNS_BROKER_URL if a dedicated JOIN_SITE_BROKER_URL is unset.
    siteBrokerUrl: env.JOIN_SITE_BROKER_URL?.trim() || env.UNS_BROKER_URL?.trim() || null,
    siteBrokerUsername: env.JOIN_SITE_BROKER_USERNAME?.trim() || env.UNS_BROKER_USERNAME?.trim() || null,
    siteBrokerPassword: env.JOIN_SITE_BROKER_PASSWORD || env.UNS_BROKER_PASSWORD || null,
    topicFilters: planBridgeTopicFilters(env),
  };
}

/** What THIS Machine Edition advertises (mDNS TXT record / static-registry entry). Pure. */
export function buildSelfAdvertisement(env: NodeJS.ProcessEnv = process.env): PeerAdvertisement {
  const edition = getEdition(env.EDITION).code;
  return {
    nodeId: env.EDGE_NODE_ID?.trim() || env.HOSTNAME?.trim() || "machine-node",
    host: env.JOIN_ADVERTISE_HOST?.trim() || "0.0.0.0",
    port: Number(env.MQTT_PORT || JOIN_DEFAULT_BROKER_PORT) || JOIN_DEFAULT_BROKER_PORT,
    edition,
    version: env.APP_VERSION?.trim() || undefined,
    siteId: env.SITE_ID?.trim() || undefined,
    source: "mdns",
  };
}

/** Parse the JOIN_STATIC_PEERS env (`host:port[:nodeId],…`) into peers. No multicast needed. */
export function parseStaticPeers(env: NodeJS.ProcessEnv = process.env): PeerAdvertisement[] {
  const raw = env.JOIN_STATIC_PEERS?.trim();
  if (!raw) return [];
  const out: PeerAdvertisement[] = [];
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [host, portStr, nodeId] = entry.split(":");
    if (!host) continue;
    out.push({
      nodeId: nodeId?.trim() || host,
      host: host.trim(),
      port: Number(portStr) || JOIN_DEFAULT_BROKER_PORT,
      source: "static",
    });
  }
  return out;
}

// ─── mDNS availability (honest seam) ──────────────────────────────────────────

/** True when a zero-conf/mDNS library is installed. Mirrors samlProvider.signatureVerificationAvailable. */
export async function mdnsAvailable(): Promise<boolean> {
  const candidates = ["bonjour-service", "bonjour", "mdns"];
  for (const pkg of candidates) {
    const mod: unknown = await import(pkg).catch(() => null);
    if (mod) return true;
  }
  return false;
}

/**
 * Discover peer Machine Editions on the LAN. STATIC peers (JOIN_STATIC_PEERS) are ALWAYS
 * returned (no library needed). mDNS multicast discovery additionally requires a zero-conf
 * library; when it is absent we return `available:false` + the honest MDNS_NOT_AVAILABLE
 * reason RATHER than pretending to have scanned — unless static peers already satisfy the
 * caller.
 *
 * @param opts.timeoutMs  browse window when mDNS is available (default 3000ms)
 */
export async function discoverPeers(
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<DiscoveryResult> {
  const env = opts.env ?? process.env;
  if (!isJoinWizardEnabled(env)) {
    return { available: false, peers: [], reason: "JOIN_WIZARD_DISABLED" };
  }

  const staticPeers = parseStaticPeers(env);

  if (!(await mdnsAvailable())) {
    // Honest: no multicast discovery possible. Static peers (if any) still usable.
    return {
      available: staticPeers.length > 0,
      peers: staticPeers,
      reason:
        "MDNS_NOT_AVAILABLE — install 'bonjour-service' (pnpm add bonjour-service) to auto-discover " +
        "Machine Editions on the LAN, or set JOIN_STATIC_PEERS=host:port[:nodeId],… for multicast-free sites.",
    };
  }

  // SEAM: with a zero-conf library present, browse `_${JOIN_MDNS_SERVICE_TYPE}._tcp` here and
  // merge the results with staticPeers. Left as a seam so no un-vetted dependency is imported:
  //   const { Bonjour } = await import("bonjour-service");
  //   const browser = new Bonjour().find({ type: JOIN_MDNS_SERVICE_TYPE }, (svc) => { … });
  //   await new Promise((r) => setTimeout(r, opts.timeoutMs ?? 3000)); browser.stop();
  return { available: true, peers: staticPeers };
}

// ─── Bridge (usable now — needs only `mqtt` + two broker URLs) ─────────────────

export interface JoinBridgeHandle {
  stop: () => Promise<void>;
  /** The filters actually bridged (for logging / the wizard UI). */
  filters: string[];
  siteBrokerUrl: string;
}

/**
 * Start the local→site UNS bridge: subscribe to the UNS filters on the LOCAL broker and
 * republish each message to the SITE broker (retain preserved). Returns null (no throw) when
 * the wizard is disabled or no site broker is configured yet — so callers degrade gracefully.
 *
 * This is intentionally a thin, honest bridge (no store-forward/QoS-2 exactly-once — that is
 * the edge-gateway's job in W7-1). It is enough to demonstrate "2 machines join 1 site".
 */
export async function startJoinBridge(
  env: NodeJS.ProcessEnv = process.env,
): Promise<JoinBridgeHandle | null> {
  const cfg = getJoinBridgeConfig(env);
  if (!cfg.enabled) {
    console.log("[join-wizard] disabled (JOIN_WIZARD_ENABLED not set) — bridge not started");
    return null;
  }
  if (!cfg.siteBrokerUrl) {
    console.warn("[join-wizard] no site broker configured (set JOIN_SITE_BROKER_URL or UNS_BROKER_URL) — bridge skipped");
    return null;
  }

  const mqtt = (await import("mqtt")).default;
  const local = mqtt.connect(cfg.localBrokerUrl, { clientId: `synapse-join-local-${Date.now()}`, reconnectPeriod: 5000 });
  const site = mqtt.connect(cfg.siteBrokerUrl, {
    clientId: `synapse-join-site-${Date.now()}`,
    reconnectPeriod: 5000,
    username: cfg.siteBrokerUsername || undefined,
    password: cfg.siteBrokerPassword || undefined,
  });

  local.on("connect", () => {
    for (const f of cfg.topicFilters) local.subscribe(f, { qos: 1 });
    console.log(`[join-wizard] bridge up: ${cfg.localBrokerUrl} → ${cfg.siteBrokerUrl} filters=${cfg.topicFilters.join(",")}`);
  });
  local.on("message", (topic, payload, packet) => {
    if (site.connected) site.publish(topic, payload, { qos: 1, retain: (packet as any)?.retain ?? false });
  });
  local.on("error", (e) => console.error("[join-wizard] local broker error:", e.message));
  site.on("error", (e) => console.error("[join-wizard] site broker error:", e.message));

  return {
    siteBrokerUrl: cfg.siteBrokerUrl,
    filters: cfg.topicFilters,
    stop: async () => {
      await Promise.allSettled([
        new Promise<void>((r) => local.end(false, {}, () => r())),
        new Promise<void>((r) => site.end(false, {}, () => r())),
      ]);
    },
  };
}
