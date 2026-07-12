/**
 * W7-1 (doc 44 gap G1.14) — EDGE GATEWAY RUNTIME (edge-side, SYNAPSE Tầng-1 §5).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The audit's single biggest Tầng-1 architecture gap: the "gateway" (otManager)
 * runs INSIDE the central server process — it is not a separate edge node/container
 * per line, and the store-forward WAL only covered DB-down (server-side), NOT the
 * loss of the CENTRAL / UNS broker. This module is the orchestrator that lets the
 * SAME code run as a STANDALONE EDGE GATEWAY PROCESS near the devices
 * (`server/edge/edgeGatewayMain.ts`, `npm run start:edge`), realising the spec's
 * "biên tự chủ" (autonomous edge, §2.1 / §5.1 / §17.2):
 *
 *   • SOUTHBOUND: reuses otManager (adapters + ConnectionSupervisor) to keep
 *     collecting telemetry from devices — UNCHANGED, gated by OT_GATEWAY_ENABLED.
 *   • NORTHBOUND: reuses the UNS publisher (Sparkplug/normalized) as the ONLY
 *     control/data bridge — NO HTTP API / socket / MQTT-broker bind here.
 *   • AUTONOMY: when the central UNS broker is unreachable, telemetry that would be
 *     published northbound is BUFFERED to the edge store-and-forward (≥24h,
 *     storeForward.ts UNS buffer) and REPLAYED IN ORDER + idempotently on reconnect.
 *   • IDENTITY / HEALTH: registers itself into the edge_nodes registry + heartbeats;
 *     the heartbeat/health reflect a DEGRADED state while central is unreachable or
 *     the buffer is non-empty.
 *
 * FLAG: EDGE_GATEWAY_MODE (default OFF). The edge entrypoint turns it ON; the
 * all-in-one server NEVER sets it, so this module is completely inert there (every
 * edge-autonomy hook is a zero-cost env check that is false). The heavy modules
 * (otManager, unsPublisher, edgeCoordinator) are loaded LAZILY (dynamic import) so
 * importing this file adds no load-time cost and no static edge→server coupling.
 *
 * HONESTY: this produces NO data of its own — it only forwards/buffers samples a
 * real reader handed the OT ingest path. UNS publishes are fire-and-forget QoS0
 * (the existing publisher contract); the replay is gated on a live broker
 * connection, so "sent" means "handed to a connected client", matching today's
 * publish semantics. SAFETY stays on the certified L1 PLC — the gateway is READ +
 * publish + buffer; it opens no new control path.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeAdapter } from "../ot/deviceAdapter";
import type { OtSample } from "../ot/otDriver";
import type { PendingUnsSample } from "../ot/storeForward";

// ── flag ─────────────────────────────────────────────────────────────────────

/** Read at call time so the edge entrypoint / tests can toggle it. Default OFF. */
export function edgeGatewayModeEnabled(): boolean {
  return process.env.EDGE_GATEWAY_MODE === "true" || process.env.EDGE_GATEWAY_MODE === "1";
}

// ── config (env-driven; honest defaults) ──────────────────────────────────────

/** This edge gateway's node code (identity it registers/heartbeats as). */
export function edgeNodeCode(): string {
  return (
    process.env.EDGE_GATEWAY_NODE_CODE?.trim() ||
    process.env.EDGE_NODE_CODE?.trim() ||
    `edge-${os.hostname()}`
  );
}
function edgeNodeName(): string {
  return process.env.EDGE_GATEWAY_NODE_NAME?.trim() || edgeNodeCode();
}
function edgeFactoryCode(): string | null {
  return process.env.EDGE_GATEWAY_FACTORY_CODE?.trim() || null;
}
function edgeLineCodes(): string[] | null {
  const raw = process.env.EDGE_GATEWAY_LINE_CODES?.trim();
  if (!raw) return null;
  const codes = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return codes.length ? codes : null;
}
function edgeGatewayVersion(): string {
  return process.env.EDGE_GATEWAY_VERSION?.trim() || process.env.npm_package_version?.trim() || "1.0.0";
}
function heartbeatIntervalMs(): number {
  const n = parseInt(process.env.EDGE_GATEWAY_HEARTBEAT_INTERVAL_MS || "30000", 10);
  return Number.isFinite(n) && n >= 1000 ? n : 30000;
}
function drainIntervalMs(): number {
  const n = parseInt(process.env.EDGE_UNS_STORE_FORWARD_DRAIN_MS || "30000", 10);
  return Number.isFinite(n) && n >= 5000 ? n : 30000;
}
function livenessFile(): string {
  const p = process.env.EDGE_GATEWAY_LIVENESS_FILE?.trim();
  return path.resolve(p && p.length > 0 ? p : "./data/edge-gateway.alive");
}

// ── central reachability (injectable for tests) ────────────────────────────────

export type ReachabilityProbe = () => boolean | Promise<boolean>;
let reachabilityProbe: ReachabilityProbe | null = null;

/** Override how the runtime decides whether central (the UNS broker) is reachable. */
export function setReachabilityProbe(fn: ReachabilityProbe | null): void {
  reachabilityProbe = fn;
}

/**
 * Is the central/northbound (UNS broker) reachable right now? The edge gateway's
 * "central" is the UNS broker: an unreachable broker is exactly the "mất kết nối
 * trung tâm" the spec's autonomous edge must ride out. Defaults to the live
 * publisher connection; overridable for tests.
 */
export async function centralReachable(): Promise<boolean> {
  if (reachabilityProbe) return await reachabilityProbe();
  try {
    const pub = await import("../unsPublisher");
    return pub.isUnsPublisherConnected();
  } catch {
    return false;
  }
}

// ── build + buffer a pending UNS sample (called from ot/ingest on the edge) ─────

/**
 * Build a self-contained PendingUnsSample from a live adapter + sample. Pre-computes
 * the Sparkplug metric type + the legacy normalized topic so the WAL replay never
 * needs the live adapter object. Never throws.
 */
export async function buildPendingUnsSample(adapter: RuntimeAdapter, sample: OtSample): Promise<PendingUnsSample> {
  let sparkplugType = "String";
  try {
    const tagDef = adapter.tags.find((t) => t.tagKey === sample.tagKey);
    if (tagDef) {
      const { otTypeToSparkplug } = await import("../uns/sparkplugEncoder");
      sparkplugType = otTypeToSparkplug(tagDef.dataType);
    } else {
      sparkplugType =
        typeof sample.value === "number" ? "Double" : typeof sample.value === "boolean" ? "Boolean" : "String";
    }
  } catch {
    sparkplugType =
      typeof sample.value === "number" ? "Double" : typeof sample.value === "boolean" ? "Boolean" : "String";
  }
  return {
    deviceId: adapter.code,
    adapterId: adapter.adapterId,
    machineId: adapter.machineId ?? null,
    tagKey: sample.tagKey,
    value: sample.value,
    quality: sample.quality,
    tsMs: sample.timestamp.getTime(),
    sparkplugType,
    // mirrors ot/ingest.unsTopicFor — the legacy JSON-path topic.
    topic: `avi/0/workshop/ot/station/${adapter.code}/${sample.tagKey}`,
  };
}

/**
 * Buffer ONE sample to the edge UNS store-and-forward (central unreachable). No-op
 * unless edge-gateway mode is on. Fault-isolated — a buffering error can never break
 * the ingest poll loop.
 */
export async function bufferUnsSample(adapter: RuntimeAdapter, sample: OtSample): Promise<void> {
  if (!edgeGatewayModeEnabled()) return;
  try {
    const pending = await buildPendingUnsSample(adapter, sample);
    const sf = await import("../ot/storeForward");
    await sf.bufferUnsSamples([pending]);
  } catch (err) {
    console.error("[EdgeGateway] UNS buffer failed:", (err as Error)?.message || err);
  }
}

// ── the injected UNS replay transport (all-or-nothing per batch) ───────────────

/**
 * Replay a batch of buffered UNS samples through the real publisher. ALL-OR-NOTHING
 * (storeForward contract): returns the batch length only when the broker is connected
 * (the batch was handed to the client), else 0 so it stays buffered. Publishes match
 * the live ingest path (Sparkplug DDATA when UNS_SPARKPLUG_ENABLED, else legacy JSON).
 */
export async function publishPendingUns(items: PendingUnsSample[]): Promise<number> {
  if (items.length === 0) return 0;
  let pub: typeof import("../unsPublisher");
  try {
    pub = await import("../unsPublisher");
  } catch {
    return 0;
  }
  if (!pub.isUnsPublisherConnected()) return 0; // central still down → keep buffered (ordered)
  const sparkplug = process.env.UNS_SPARKPLUG_ENABLED === "true";
  for (const s of items) {
    try {
      if (sparkplug) {
        pub.publishSparkplugDData(s.deviceId, [
          { name: s.tagKey, type: s.sparkplugType, value: s.value, timestamp: s.tsMs },
        ]);
      } else {
        pub.publishNormalized(s.topic, {
          adapterId: s.adapterId,
          machineId: s.machineId,
          tagKey: s.tagKey,
          value: s.value,
          quality: s.quality,
          timestamp: new Date(s.tsMs).toISOString(),
        });
      }
    } catch (err) {
      // A single publish fault must not abort the ordered replay; the QoS0 publisher
      // is fire-and-forget, so we continue (the connectivity gate above is the real guard).
      console.error("[EdgeGateway] UNS replay publish error:", (err as Error)?.message || err);
    }
  }
  return items.length;
}

/** Wire the UNS store-and-forward backfill to the real publisher. Idempotent. */
export async function wireUnsStoreForward(): Promise<void> {
  const sf = await import("../ot/storeForward");
  sf.setUnsPublishFn(publishPendingUns);
}

// ── health / degraded ──────────────────────────────────────────────────────────

export interface EdgeGatewayHealth {
  nodeCode: string;
  /** online when central reachable AND nothing buffered; else degraded. */
  status: "online" | "degraded";
  centralReachable: boolean;
  /** Samples buffered for northbound UNS replay (central-unreachable backlog). */
  unsBuffered: number;
  /** Rows buffered for the DB store-and-forward (DB-down backlog). */
  dbBuffered: number;
  activeAdapters: number;
  version: string;
  ts: string;
}

/**
 * Compute the current edge-gateway health. DEGRADED when central is unreachable OR
 * either buffer (UNS / DB) has a backlog — so the heartbeat honestly reflects an
 * autonomous-but-degraded edge. Never throws.
 */
export async function getEdgeGatewayHealth(): Promise<EdgeGatewayHealth> {
  let unsBuffered = 0;
  let dbBuffered = 0;
  let activeAdapters = 0;
  try {
    const sf = await import("../ot/storeForward");
    unsBuffered = sf.unsBufferedCount();
    dbBuffered = sf.bufferedCount();
  } catch {
    /* store-forward unavailable → treat as no backlog */
  }
  try {
    const otManager = await import("../ot/otManager");
    activeAdapters = otManager.listActiveAdapters().length;
  } catch {
    /* otManager unavailable */
  }
  const reachable = await centralReachable();
  const degraded = !reachable || unsBuffered > 0 || dbBuffered > 0;
  return {
    nodeCode: edgeNodeCode(),
    status: degraded ? "degraded" : "online",
    centralReachable: reachable,
    unsBuffered,
    dbBuffered,
    activeAdapters,
    version: edgeGatewayVersion(),
    ts: new Date().toISOString(),
  };
}

// ── registry + heartbeat + drain loops ─────────────────────────────────────────

let heartbeatTimer: NodeJS.Timeout | null = null;
let drainTimer: NodeJS.Timeout | null = null;
let registered = false;

/** Register this gateway into the edge_nodes registry (best-effort, idempotent upsert). */
export async function registerSelf(): Promise<void> {
  try {
    const { registerNode } = await import("./edgeCoordinator");
    const res = await registerNode({
      code: edgeNodeCode(),
      name: edgeNodeName(),
      factoryCode: edgeFactoryCode(),
      assignedLineCodes: edgeLineCodes(),
      version: edgeGatewayVersion(),
    });
    registered = res.ok;
    if (!res.ok) {
      console.warn(`[EdgeGateway] registerNode not applied: ${res.message ?? "(disabled)"} — heartbeat will retry.`);
    } else {
      console.log(`[EdgeGateway] registered as edge node "${edgeNodeCode()}"`);
    }
  } catch (err) {
    console.warn("[EdgeGateway] registerSelf failed:", (err as Error)?.message || err);
  }
}

/** Write a liveness marker (mtime = last heartbeat) for a no-HTTP container healthcheck. */
async function writeLiveness(health: EdgeGatewayHealth): Promise<void> {
  const file = livenessFile();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(health), "utf8");
  } catch {
    /* liveness marker is best-effort */
  }
}

/** One heartbeat: register-if-needed, report health (online/degraded), refresh liveness. */
export async function sendHeartbeat(): Promise<EdgeGatewayHealth> {
  const health = await getEdgeGatewayHealth();
  try {
    if (!registered) await registerSelf();
    const { heartbeat } = await import("./edgeCoordinator");
    await heartbeat({
      code: edgeNodeCode(),
      status: health.status === "online" ? "online" : "degraded",
      version: health.version,
      health: {
        centralReachable: health.centralReachable,
        unsBuffered: health.unsBuffered,
        dbBuffered: health.dbBuffered,
        activeAdapters: health.activeAdapters,
        ts: health.ts,
      },
    });
  } catch (err) {
    // Central unreachable → heartbeat fails; that is itself the degraded signal. Never throw.
    console.warn("[EdgeGateway] heartbeat send failed (central unreachable?):", (err as Error)?.message || err);
  }
  await writeLiveness(health);
  return health;
}

function startHeartbeatLoop(): void {
  if (heartbeatTimer) return;
  const intervalMs = heartbeatIntervalMs();
  heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, intervalMs);
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
  console.log(`[EdgeGateway] heartbeat loop started (every ${intervalMs}ms) as "${edgeNodeCode()}"`);
}

function startDrainLoop(): void {
  if (drainTimer) return;
  const intervalMs = drainIntervalMs();
  let draining = false;
  drainTimer = setInterval(() => {
    if (draining) return; // no overlap
    draining = true;
    void (async () => {
      try {
        const sf = await import("../ot/storeForward");
        if (sf.unsStoreForwardEnabled() && sf.unsBufferedCount() > 0 && (await centralReachable())) {
          await wireUnsStoreForward();
          const r = await sf.backfillUns();
          if (r.drained > 0)
            console.log(`[EdgeGateway] UNS backfill drained ${r.drained} sample(s); remaining=${r.remaining}`);
        }
      } catch (err) {
        console.error("[EdgeGateway] UNS drain failed:", (err as Error)?.message || err);
      } finally {
        draining = false;
      }
    })();
  }, intervalMs);
  if (typeof drainTimer.unref === "function") drainTimer.unref();
  console.log(`[EdgeGateway] UNS backfill drain loop started (every ${intervalMs}ms)`);
}

// ── config-as-code (GitOps) ─────────────────────────────────────────────────────

export interface EdgeNodeConfig {
  node?: { code?: string; name?: string; factoryCode?: string; lineCodes?: string[]; version?: string };
  /** Optional directory of contracts/mappings/*.mapping.yaml to APPLY on start (GitOps). */
  mappingsDir?: string;
  /** When true, mapping import runs for real (default false = dry-run/log only). */
  applyMappings?: boolean;
}

/**
 * Load the GitOps edge-node config file (EDGE_GATEWAY_CONFIG_FILE, YAML) and apply
 * its identity/scope to process.env (env still wins if already set). OPTIONAL: with
 * no file this is a no-op (env-only config). Never throws — a bad config file logs +
 * continues with env. The adapter CONNECTION config remains sourced from the DB Asset
 * Registry (spec §6); config-as-code here covers node identity + declarative tag
 * mappings (mappingAsCode, W2-B3).
 */
export async function loadEdgeConfig(): Promise<EdgeNodeConfig | null> {
  const file = process.env.EDGE_GATEWAY_CONFIG_FILE?.trim();
  if (!file) return null;
  let cfg: EdgeNodeConfig;
  try {
    const raw = await fs.readFile(path.resolve(file), "utf8");
    const { parse } = await import("yaml");
    const parsed = parse(raw) as EdgeNodeConfig | null;
    if (!parsed || typeof parsed !== "object") {
      console.warn(`[EdgeGateway] config file "${file}" is empty/invalid — using env config.`);
      return null;
    }
    cfg = parsed;
  } catch (err) {
    console.warn(`[EdgeGateway] failed to read config "${file}":`, (err as Error)?.message || err);
    return null;
  }
  // Identity/scope → env (env already-set wins, so operator overrides hold).
  const n = cfg.node ?? {};
  if (n.code && !process.env.EDGE_GATEWAY_NODE_CODE) process.env.EDGE_GATEWAY_NODE_CODE = n.code;
  if (n.name && !process.env.EDGE_GATEWAY_NODE_NAME) process.env.EDGE_GATEWAY_NODE_NAME = n.name;
  if (n.factoryCode && !process.env.EDGE_GATEWAY_FACTORY_CODE) process.env.EDGE_GATEWAY_FACTORY_CODE = n.factoryCode;
  if (n.lineCodes?.length && !process.env.EDGE_GATEWAY_LINE_CODES)
    process.env.EDGE_GATEWAY_LINE_CODES = n.lineCodes.join(",");
  if (n.version && !process.env.EDGE_GATEWAY_VERSION) process.env.EDGE_GATEWAY_VERSION = n.version;

  // Declarative tag mappings (GitOps) — reuse mappingAsCode (W2-B3). Best-effort.
  if (cfg.mappingsDir) {
    try {
      await applyMappingDir(cfg.mappingsDir, cfg.applyMappings === true);
    } catch (err) {
      console.warn("[EdgeGateway] mapping import failed:", (err as Error)?.message || err);
    }
  }
  console.log(`[EdgeGateway] loaded GitOps config from "${file}"`);
  return cfg;
}

/** Import every *.mapping.yaml from a directory (dry-run unless apply). Best-effort per file. */
async function applyMappingDir(dir: string, apply: boolean): Promise<void> {
  const resolved = path.resolve(dir);
  let names: string[];
  try {
    names = await fs.readdir(resolved);
  } catch {
    console.warn(`[EdgeGateway] mappingsDir "${dir}" not found — skipping.`);
    return;
  }
  const { importMapping } = await import("../ot/mappingAsCode");
  for (const name of names.filter((f) => f.endsWith(".mapping.yaml")).sort()) {
    try {
      const yamlText = await fs.readFile(path.join(resolved, name), "utf8");
      const res = await importMapping(yamlText, { dryRun: !apply, source: "system", actorName: "edge-gateway gitops" });
      console.log(
        `[EdgeGateway] mapping "${name}": ${res.dryRun ? "dry-run" : "applied"} changeCount=${res.diff.changeCount}` +
          (res.requiresAdapterRestart ? " (requiresAdapterRestart)" : ""),
      );
    } catch (err) {
      console.warn(`[EdgeGateway] mapping "${name}" import error:`, (err as Error)?.message || err);
    }
  }
}

// ── bootstrap / run / stop ──────────────────────────────────────────────────────

export interface EdgeGatewayHandles {
  stop: () => Promise<void>;
}

/**
 * Wire and start the edge gateway WITHOUT holding the event loop open (testable): load
 * GitOps config, restore the UNS WAL, wire the replay transport, init the UNS publisher
 * (northbound), start OT (southbound), register self, start heartbeat + drain loops.
 * NO HTTP / socket / MQTT-broker bind. Every step is fault-isolated.
 */
export async function bootstrapEdgeGateway(): Promise<EdgeGatewayHandles> {
  // The edge entrypoint IS the edge gateway → ensure edge mode unless explicitly off.
  if (process.env.EDGE_GATEWAY_MODE == null) process.env.EDGE_GATEWAY_MODE = "true";

  await loadEdgeConfig();

  // Restore any UNS backlog persisted before a restart, then wire the replay transport.
  try {
    const sf = await import("../ot/storeForward");
    const restored = await sf.restoreUns();
    if (restored > 0) console.log(`[EdgeGateway] restored ${restored} buffered UNS sample(s) from WAL`);
  } catch (err) {
    console.error("[EdgeGateway] UNS WAL restore failed:", (err as Error)?.message || err);
  }
  await wireUnsStoreForward();

  // Northbound: UNS publisher (client to the central broker; gated by UNS_BRIDGE_ENABLED).
  try {
    const pub = await import("../unsPublisher");
    pub.initUnsPublisher();
  } catch (err) {
    console.error("[EdgeGateway] UNS publisher init failed:", (err as Error)?.message || err);
  }

  // Southbound: OT adapters (gated by OT_GATEWAY_ENABLED). Reuses otManager verbatim.
  try {
    const { startOt } = await import("../ot");
    await startOt();
  } catch (err) {
    console.error("[EdgeGateway] OT start failed:", (err as Error)?.message || err);
  }

  await registerSelf();
  startHeartbeatLoop();
  startDrainLoop();

  return { stop: stopEdgeGateway };
}

let shuttingDown = false;

/** Stop everything the edge gateway started (idempotent + non-throwing). */
export async function stopEdgeGateway(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
  // Last-chance drain so a graceful stop replays anything still buffered.
  try {
    const sf = await import("../ot/storeForward");
    if (sf.unsStoreForwardEnabled() && sf.unsBufferedCount() > 0 && (await centralReachable())) {
      await wireUnsStoreForward();
      await sf.backfillUns();
    }
  } catch {
    /* best-effort */
  }
  try {
    const { stopOt } = await import("../ot");
    await stopOt();
  } catch {
    /* best-effort */
  }
  try {
    const pub = await import("../unsPublisher");
    await pub.publishNdeathGraceful();
    await pub.shutdownUnsPublisher();
  } catch {
    /* best-effort */
  }
  registered = false;
}

/**
 * Run the edge gateway as a long-lived process (the entrypoint). Boots, then holds
 * the event loop open and installs graceful-shutdown handlers. Mirrors worker.ts.
 */
export async function runEdgeGateway(): Promise<void> {
  console.log("[EdgeGateway] Starting edge gateway (SYNAPSE Tầng-1 §5 — no HTTP listener).");
  console.log(`[EdgeGateway] node="${edgeNodeCode()}" version=${edgeGatewayVersion()} edgeMode=${edgeGatewayModeEnabled()}`);

  // Observability bootstrap (Sentry/OTel) — no-op unless configured (parity w/ worker).
  try {
    const { initObservability } = await import("../../_core/observability");
    await initObservability();
  } catch (err) {
    console.error("[EdgeGateway] observability init failed:", (err as Error)?.message || err);
  }

  await bootstrapEdgeGateway();

  // Heartbeat/drain timers are unref'd — hold the loop open explicitly.
  const keepAlive = setInterval(() => {}, 60_000);

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      console.log("[EdgeGateway] Force exit...");
      process.exit(0);
    }
    shuttingDown = true;
    console.log(`[EdgeGateway] ${signal} received — stopping gateway...`);
    clearInterval(keepAlive);
    void stopEdgeGateway().finally(() => {
      setTimeout(() => process.exit(0), 3000).unref();
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    console.error("[EdgeGateway] Unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[EdgeGateway] Uncaught exception:", error);
    setTimeout(() => process.exit(1), 1000);
  });

  console.log("[EdgeGateway] Ready.");
}

/** Test-only reset of module-level loop/registry state. */
export function _resetForTests(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
  registered = false;
  shuttingDown = false;
  reachabilityProbe = null;
}
