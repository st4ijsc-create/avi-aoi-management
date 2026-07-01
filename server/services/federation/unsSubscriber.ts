/**
 * Federation UNS subscriber (doc 13 §4/§7 — F3, SUBSCRIBE-ONLY streaming).
 *
 * Complements F1's pull aggregator with a low-latency path: for every enrolled
 * site that declares a `unsBrokerUrl`, the core opens a SUBSCRIBE-ONLY MQTT
 * connection to that site's UNS broker, listens on the normalized Sparkplug-B
 * KPI topics, decodes DDATA/DBIRTH payloads, and upserts a near-real-time KPI
 * snapshot into site_kpi_rollup with source='uns'. Invariants:
 *
 *   • SUBSCRIBE-ONLY, one direction. This module NEVER calls client.publish()
 *     and never registers/handles NCMD/DCMD — there is no command/control path.
 *     The ONLY MQTT verb used against a site broker is `subscribe`. (Mirrors
 *     unsPublisher.ts's "read-direction only" stance, inverted: publisher only
 *     emits to OUR broker, this subscriber only reads from SITE brokers.)
 *   • PER-SITE ISOLATION. Each site gets its OWN mqtt client + its own
 *     try/catch'd handlers. A site whose broker is down/slow/mis-configured can
 *     only stall/empty ITS OWN connection — it never throws into the boot path
 *     nor affects another site's connection.
 *   • RECONNECT/BACKOFF. The mqtt client's built-in reconnectPeriod drives
 *     reconnection; connection state is tracked honestly per site (connected /
 *     reconnecting / error) and surfaced via getFederationUnsStatus().
 *   • HONEST. fetchedAt/asOf are written from real decode time; nothing is
 *     fabricated or back-dated. A subscribed-but-silent broker lands NO rows.
 *
 * Flag: FEDERATION_UNS_ENABLED (default OFF). When OFF, start() opens no socket.
 *
 * Lifecycle matches the F1 aggregator's start/stop/status convention so
 * server/_core/index.ts can wire it identically at boot.
 */
import mqtt, { type MqttClient } from "mqtt";
import { readFileSync } from "fs";
import { getDb } from "../../db/connection";
import { ENV } from "../../_core/env";
import { sites, type Site } from "../../../drizzle/schema";
import { decodePayload, type SparkplugMetric } from "../uns/sparkplugEncoder";
import { upsertSnapshot } from "./rollupStore";
import type { SiteKpiSnapshot } from "./siteClient";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Honest per-site connection state for status reporting. */
type ConnState = "connecting" | "connected" | "reconnecting" | "closed" | "error";

interface SiteConnection {
  site: Site;
  client: MqttClient;
  state: ConnState;
  lastError: string | null;
  lastMessageAt: Date | null;
  messagesReceived: number;
  rowsUpserted: number;
  /** Latest decoded metric values (by metric name) for this site's overall KPIs. */
  latest: Map<string, number | null>;
}

let isRunning = false;
const connections = new Map<number, SiteConnection>(); // siteId → connection

/**
 * Normalized KPI metric names this subscriber reads off the site's UNS stream.
 * The site's UNS publisher emits these as Sparkplug metric names (see
 * unsPublisher / aoiBridge). We only ever READ them; unknown metrics are ignored.
 * Tolerant matching (case-insensitive, last path segment) covers minor naming
 * variance across sites without fabricating data.
 */
const KPI_METRIC_ALIASES: Record<keyof KpiMetrics, string[]> = {
  totalInspections: ["totalinspections", "total", "throughput", "count"],
  okCount: ["okcount", "ok", "pass", "passcount"],
  ngCount: ["ngcount", "ng", "fail", "failcount", "defects"],
  ntfCount: ["ntfcount", "ntf"],
  yieldRate: ["yieldrate", "yield", "yield%", "fpy"],
  oee: ["oee", "oee%"],
  avgCycleTime: ["avgcycletime", "cycletime", "ct"],
};

interface KpiMetrics {
  totalInspections: number | null;
  okCount: number | null;
  ngCount: number | null;
  ntfCount: number | null;
  yieldRate: number | null;
  oee: number | null;
  avgCycleTime: number | null;
}

function coerceNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Map a decoded Sparkplug metric name → the canonical KPI key it represents. */
function kpiKeyForMetric(name: string): keyof KpiMetrics | null {
  const tail = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  const norm = tail.trim().toLowerCase();
  for (const key of Object.keys(KPI_METRIC_ALIASES) as (keyof KpiMetrics)[]) {
    if (KPI_METRIC_ALIASES[key].includes(norm)) return key;
  }
  return null;
}

/**
 * Fold decoded metrics into the connection's latest-value map. Only well-known
 * KPI metrics are retained — everything else is ignored (never fabricated).
 */
function applyMetrics(conn: SiteConnection, metrics: SparkplugMetric[]): void {
  for (const m of metrics) {
    if (!m || typeof m.name !== "string") continue;
    const key = kpiKeyForMetric(m.name);
    if (!key) continue;
    conn.latest.set(key, coerceNumber(m.value));
  }
}

/** Build a KPI snapshot from the latest streamed values, or null if nothing useful yet. */
function buildSnapshot(conn: SiteConnection): SiteKpiSnapshot | null {
  const l = conn.latest;
  // Require at least one core KPI to have arrived before we land a row.
  const hasAny = ["totalInspections", "okCount", "ngCount", "yieldRate", "oee"].some(
    (k) => l.get(k) != null,
  );
  if (!hasAny) return null;

  const totalInspections = l.get("totalInspections") ?? null;
  const okCount = l.get("okCount") ?? null;
  const ngCount = l.get("ngCount") ?? null;
  const ntfCount = l.get("ntfCount") ?? null;
  let yieldRate = l.get("yieldRate") ?? null;
  // Derive yield if not streamed but ok/total are present (honest, not fabricated).
  if (yieldRate == null && okCount != null && totalInspections && totalInspections > 0) {
    yieldRate = Number(((okCount / totalInspections) * 100).toFixed(2));
  }
  const ngRate =
    ngCount != null && totalInspections && totalInspections > 0
      ? Number(((ngCount / totalInspections) * 100).toFixed(2))
      : null;
  const now = new Date();
  return {
    asOf: now,
    windowStart: now,
    windowEnd: now,
    totalInspections,
    okCount,
    ngCount,
    ntfCount,
    yieldRate,
    ngRate,
    throughput: totalInspections,
    oee: l.get("oee") ?? null,
    avgCycleTime: l.get("avgCycleTime") ?? null,
    defectPareto: null, // pareto is not streamed via UNS; F1 pull supplies it
    // U5 — the UNS (Sparkplug) stream carries only inspection KPIs, so the deepened
    // categories are honest-null here; the F1 pull path supplies detail/fleet/safety/
    // pdm/alerts. Leaving these null means upsertSnapshot won't overwrite a richer
    // pull-landed row's detail with nulls beyond the "overall" KPI it refreshes.
    detailRows: null,
    fleet: null,
    safety: null,
    pdm: null,
    alertRollup: null,
    endpointsHit: [],
  };
}

/** Land the latest streamed snapshot for a site (source='uns'). Never throws. */
async function landSnapshot(db: Db, conn: SiteConnection): Promise<void> {
  try {
    const snap = buildSnapshot(conn);
    if (!snap) return;
    const written = await upsertSnapshot(db, conn.site, snap, "uns");
    conn.rowsUpserted += written;
  } catch (e) {
    console.error(`[Federation/UNS] upsert failed for site ${conn.site.code}:`, (e as Error).message);
  }
}

/** Sparkplug topic filters this subscriber listens on for a site (DDATA + DBIRTH). */
function topicFilters(site: Site): string[] {
  const ns = ENV.federationUnsNamespace;
  // Subscribe to all DDATA/DBIRTH under the namespace; the site's group is the
  // first wildcard level. Read-only: these are telemetry topics, NOT *CMD topics.
  return [`${ns}/+/DDATA/#`, `${ns}/+/DBIRTH/#`];
}

/** Build MQTT options for a SUBSCRIBE-ONLY connection (no will, clean session). */
function clientOptions(site: Site): mqtt.IClientOptions {
  const opts: mqtt.IClientOptions = {
    clientId: `avi-core-fed-sub-${site.code}-${Date.now()}`,
    clean: true,
    reconnectPeriod: ENV.federationUnsReconnectMs,
    connectTimeout: ENV.federationUnsConnectTimeoutMs,
    // No `will`: a read-only consumer must not publish anything, including a will.
  };
  const url = (site.unsBrokerUrl ?? "").trim();
  if (url.startsWith("mqtts://") || url.startsWith("tls://")) {
    opts.rejectUnauthorized = process.env.UNS_TLS_REJECT_UNAUTHORIZED !== "false";
    const caPath = process.env.UNS_TLS_CA;
    if (caPath) {
      try {
        opts.ca = readFileSync(caPath);
      } catch (e) {
        console.error(`[Federation/UNS] TLS CA read failed for ${site.code}:`, (e as Error).message);
      }
    }
  }
  // Per-site broker credentials (optional, env-resolved — never DB-stored).
  const user = process.env[`SITE_UNS_USER_${site.code}`];
  const pass = process.env[`SITE_UNS_PASS_${site.code}`];
  if (user) {
    opts.username = user;
    opts.password = pass ?? "";
  }
  return opts;
}

/** Open one SUBSCRIBE-ONLY connection for a site. Never throws. */
function connectSite(site: Site): void {
  const url = (site.unsBrokerUrl ?? "").trim();
  if (!url) return; // no broker declared → nothing to subscribe to
  if (connections.has(site.id)) return; // idempotent

  try {
    const client = mqtt.connect(url, clientOptions(site));
    const conn: SiteConnection = {
      site,
      client,
      state: "connecting",
      lastError: null,
      lastMessageAt: null,
      messagesReceived: 0,
      rowsUpserted: 0,
      latest: new Map(),
    };
    connections.set(site.id, conn);

    client.on("connect", () => {
      conn.state = "connected";
      conn.lastError = null;
      const filters = topicFilters(site);
      // SUBSCRIBE-ONLY: the sole verb issued to the site broker.
      client.subscribe(filters, { qos: 0 }, (err) => {
        if (err) {
          conn.lastError = err.message;
          console.error(`[Federation/UNS] subscribe failed for ${site.code}:`, err.message);
        } else {
          console.log(`[Federation/UNS] subscribed ${site.code} → ${filters.join(", ")}`);
        }
      });
    });

    client.on("message", (topic, payload) => {
      // Defensive: a malformed payload from one site must never break the handler.
      void (async () => {
        try {
          // Ignore anything that isn't a telemetry/birth topic (read-only guard).
          if (!/\/(DDATA|DBIRTH)(\/|$)/.test(topic)) return;
          const decoded = decodePayload(payload);
          if (!decoded?.metrics?.length) return;
          applyMetrics(conn, decoded.metrics);
          conn.messagesReceived++;
          conn.lastMessageAt = new Date();
          const db = await getDb();
          if (db) await landSnapshot(db, conn);
        } catch (e) {
          conn.lastError = (e as Error).message;
          console.error(`[Federation/UNS] message decode failed for ${site.code}:`, (e as Error).message);
        }
      })();
    });

    client.on("reconnect", () => {
      conn.state = "reconnecting";
    });
    client.on("close", () => {
      if (conn.state !== "error") conn.state = "closed";
    });
    client.on("error", (err) => {
      conn.state = "error";
      conn.lastError = err.message;
      console.error(`[Federation/UNS] connection error for ${site.code}:`, err.message);
    });
  } catch (e) {
    // Opening one connection must never break the boot loop for other sites.
    console.error(`[Federation/UNS] connect threw for ${site.code}:`, (e as Error).message);
  }
}

/**
 * Start the UNS subscriber. Idempotent. No-op unless FEDERATION_UNS_ENABLED=true.
 * Opens one SUBSCRIBE-ONLY connection per enrolled site that has a unsBrokerUrl.
 * NEVER throws into the boot path.
 */
export async function startFederationUnsSubscriber(): Promise<void> {
  if (!ENV.federationUnsEnabled) {
    console.log("[Federation/UNS] subscriber disabled (set FEDERATION_UNS_ENABLED=true to enable)");
    return;
  }
  if (isRunning) {
    console.log("[Federation/UNS] subscriber already running, ignoring start()");
    return;
  }
  isRunning = true;
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[Federation/UNS] database not available, no connections opened");
      return;
    }
    const allSites = await db.select().from(sites);
    const streamable = allSites.filter(
      (s) => s.status !== "paused" && s.status !== "disabled" && !!(s.unsBrokerUrl ?? "").trim(),
    );
    if (streamable.length === 0) {
      console.log("[Federation/UNS] no sites with unsBrokerUrl — nothing to subscribe to");
      return;
    }
    for (const site of streamable) connectSite(site);
    console.log(`[Federation/UNS] subscriber started — ${streamable.length} site connection(s)`);
  } catch (e) {
    console.error("[Federation/UNS] start failed:", (e as Error).message);
  }
}

/** Stop the subscriber: end every per-site connection. Best-effort, never throws. */
export async function stopFederationUnsSubscriber(): Promise<void> {
  const conns = [...connections.values()];
  connections.clear();
  isRunning = false;
  await Promise.allSettled(
    conns.map(
      (c) =>
        new Promise<void>((resolve) => {
          try {
            c.client.end(true, {}, () => resolve());
          } catch {
            resolve();
          }
        }),
    ),
  );
  console.log("[Federation/UNS] subscriber stopped");
}

/** Honest connection status for admin/debug surfaces. */
export function getFederationUnsStatus() {
  return {
    enabled: ENV.federationUnsEnabled,
    isRunning,
    connections: [...connections.values()].map((c) => ({
      siteId: c.site.id,
      code: c.site.code,
      brokerUrl: c.site.unsBrokerUrl,
      state: c.state,
      lastError: c.lastError,
      lastMessageAt: c.lastMessageAt,
      messagesReceived: c.messagesReceived,
      rowsUpserted: c.rowsUpserted,
    })),
  };
}
