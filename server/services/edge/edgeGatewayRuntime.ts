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
 *   • IDENTITY / HEALTH (doc 81 Đợt 10 task E, D14): the node identity is CENTRAL-owned (the signed config
 *     snapshot); the gateway never registers itself and never names its factory / lines. It heartbeats over
 *     HTTP with its node credential (POST /api/v1/edge/node/heartbeat); health is DEGRADED while central or
 *     the UNS broker is unreachable, a buffer is non-empty, or the journal is full / unhealthy.
 *   • NO CENTRAL DB (doc 81 Đợt 10): AVI_PROCESS_ROLE=edge (set by edgeGatewayMain before any import) makes
 *     every DB accessor refuse. Boot order: config (verified, cached) → sources (adapters, telemetry insert
 *     function, store-forward) → OT → robots → agent (commands always; runs iff EDGE_EXECUTION_ENABLED).
 *
 * FLAG: EDGE_GATEWAY_MODE (default OFF). The edge entrypoint turns it ON; the
 * all-in-one server NEVER sets it, so this module is completely inert there (every
 * edge-autonomy hook is a zero-cost env check that is false). The heavy modules
 * (otManager, unsPublisher, robotManager, the agent) are loaded LAZILY (dynamic import) so
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
import { EdgeCentralClient, createEdgeAuthorizeClient, type EdgeAuthorizeClient } from "./edgeCentralClient";
import { EdgeConfigSource, configAdaptersToRuntime } from "./edgeConfigSource";
import { EdgeJournal } from "./edgeJournal";
import { markSessionQuiescing } from "../robot/robotQuiesce"; // doc 81 Đợt 12 N fix 1 (R-12-d)
import { EDGE_PROTOCOL_VERSION, type EdgeConfigSnapshot } from "./edgeProtocol";
import { EdgeContractError } from "./edgeSigning";
import {
  EdgeProgramChecks,
  EdgeStreamShipper,
  createEdgeAuthUnusedReporter,
  createEdgeJournalConsume,
  createEdgeReportSink,
  edgeTelemetryPersistFn,
  type EdgeJournalConsume,
  type EdgeReportSink,
} from "./edgeStreams";
import type { EdgeDevicePort, EdgeWalker } from "./edgeExecutionAgent";
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
function heartbeatIntervalMs(): number {
  const n = parseInt(process.env.EDGE_GATEWAY_HEARTBEAT_INTERVAL_MS || "", 10);
  if (Number.isFinite(n) && n >= 1000) return n;
  return runtime?.config.limits()?.heartbeatMs ?? 30_000;
}
function edgeGatewayVersion(): string {
  return process.env.EDGE_GATEWAY_VERSION?.trim() || process.env.npm_package_version?.trim() || "1.0.0";
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

// ── the node runtime (doc 81 Đợt 10 task E) ────────────────────────────────────────────────────────────────────────

/** Everything the edge process holds instead of a central DB login (groups C / D reach it through getEdgeRuntime()). */
export interface EdgeRuntime {
  nodeId: number;
  client: EdgeCentralClient;
  config: EdgeConfigSource;
  journal: EdgeJournal;
  shipper: EdgeStreamShipper;
  sink: EdgeReportSink;
  consume: EdgeJournalConsume;
  authorize: EdgeAuthorizeClient;
  programChecks: EdgeProgramChecks;
  startedAtMs: number;
  lastHeartbeatOk: boolean | null;
}
let runtime: EdgeRuntime | null = null;

/** The live edge runtime (null: not an edge process, or the node is not provisioned). */
export function getEdgeRuntime(): EdgeRuntime | null {
  return runtime;
}

/** What the node needs from the environment (all non-secret but the credential, which only comes from a file). */
export interface EdgeNodeEnv {
  centralUrl: string;
  credential: string;
  nodeId: number;
  /** this node's credential id (edge_node_credentials.id, from the provisioning bundle) — R-10-f */
  credentialId: number;
  /** the provisioning pin file (EdgeTrustStore.fromPinFile) */
  pinFile: string;
  journalDir: string;
  requestTimeoutMs: number;
  journalMaxBytes?: number;
}

/**
 * EDGE_CENTRAL_URL + EDGE_NODE_CREDENTIAL_FILE + EDGE_CENTRAL_NODE_ID + EDGE_CENTRAL_CREDENTIAL_ID + EDGE_KEYSET_PIN_FILE
 * (+ EDGE_JOURNAL_DIR, EDGE_JOURNAL_MAX_BYTES, EDGE_REQUEST_TIMEOUT_MS), or why not.
 */
export async function edgeNodeEnv(env: NodeJS.ProcessEnv = process.env): Promise<EdgeNodeEnv | { error: string }> {
  const { edgeCentralUrlFromEnv, readEdgeNodeCredential } = await import("./edgeExecutionAgent");
  const u = edgeCentralUrlFromEnv(env);
  if ("error" in u) return u;
  const c = await readEdgeNodeCredential(env);
  if ("error" in c) return c;
  const nodeId = Number.parseInt(String(env.EDGE_CENTRAL_NODE_ID ?? ""), 10);
  if (!Number.isSafeInteger(nodeId) || nodeId <= 0 || String(nodeId) !== String(env.EDGE_CENTRAL_NODE_ID ?? "").trim()) {
    return { error: "EDGE_CENTRAL_NODE_ID (this node's edge_nodes id, from the provisioning bundle) is not a positive integer" };
  }
  const credRaw = String(env.EDGE_CENTRAL_CREDENTIAL_ID ?? "").trim();
  const credentialId = Number.parseInt(credRaw, 10);
  if (!Number.isSafeInteger(credentialId) || credentialId <= 0 || String(credentialId) !== credRaw) {
    return { error: "EDGE_CENTRAL_CREDENTIAL_ID (the id of this node's credential, from the provisioning bundle) is not a positive integer" };
  }
  const pinFile = String(env.EDGE_KEYSET_PIN_FILE ?? "").trim();
  if (!pinFile) return { error: "EDGE_KEYSET_PIN_FILE (the keyset pin from `edge-signing-key.ts pin`) is not set" };
  try {
    await fs.access(pinFile);
  } catch {
    return { error: "EDGE_KEYSET_PIN_FILE cannot be read" };
  }
  const t = Number.parseInt(String(env.EDGE_REQUEST_TIMEOUT_MS ?? ""), 10);
  const mb = Number.parseInt(String(env.EDGE_JOURNAL_MAX_BYTES ?? ""), 10);
  return {
    centralUrl: u.url,
    credential: c.credential,
    nodeId,
    credentialId,
    pinFile: path.resolve(pinFile),
    journalDir: path.resolve(env.EDGE_JOURNAL_DIR?.trim() || "./data/edge-journal"),
    requestTimeoutMs: Number.isFinite(t) ? Math.min(60_000, Math.max(500, t)) : 10_000,
    ...(Number.isFinite(mb) && mb > 0 ? { journalMaxBytes: mb } : {}),
  };
}

/** Build the runtime: journal → client → trust + config (central, else the verified cache) → ports. Throws on a refused pin. */
export async function createEdgeRuntime(n: EdgeNodeEnv, opts: { fetchImpl?: typeof fetch } = {}): Promise<EdgeRuntime> {
  const journal = await EdgeJournal.open({ dir: n.journalDir, maxBytes: n.journalMaxBytes });
  const client = new EdgeCentralClient({ centralUrl: n.centralUrl, credential: n.credential, requestTimeoutMs: n.requestTimeoutMs, fetchImpl: opts.fetchImpl });
  const config = await EdgeConfigSource.create({ client, pinFile: n.pinFile, nodeId: n.nodeId, credentialId: n.credentialId, credential: n.credential, dir: n.journalDir, floorVersion: journal.configVersion });
  const fetched = await config.refresh();
  if (!fetched.ok) {
    console.warn(`[EdgeGateway] config from central not available (${fetched.reason}) — trying the verified cache`);
    if (!(await config.loadCached())) console.warn("[EdgeGateway] NO verified config: no device is started until central answers");
  }
  journal.setConfigHash(config.hash(), config.current()?.configVersion ?? null);
  config.onChange((c) => journal.setConfigHash(config.hash(), c.configVersion));
  let shipper: EdgeStreamShipper;
  const sink = createEdgeReportSink(journal, (s) => shipper.nudge(s));
  shipper = new EdgeStreamShipper(journal, client);
  const programChecks = new EdgeProgramChecks({ config, client });
  const authorize = createEdgeAuthorizeClient({
    client,
    trust: () => config.trust(),
    credentialId: () => config.credentialId(),
    maxTtlMs: () => config.limits()?.authTtlMs ?? 10_000,
    isJtiConsumed: (jti) => journal.isJtiConsumed(jti),
    programChecks: () => programChecks.latest(),
    anomaly: (code, runId, detail) => void sink.event({ kind: "anomaly", code, runId, detail: detail.slice(0, 1_000), at: Date.now() }),
    unused: createEdgeAuthUnusedReporter(journal, sink), // R-10-bp
  });
  return { nodeId: n.nodeId, client, config, journal, shipper, sink, consume: createEdgeJournalConsume(journal), authorize, programChecks, startedAtMs: Date.now(), lastHeartbeatOk: null };
}

// ── health / degraded ──────────────────────────────────────────────────────────

export interface EdgeGatewayHealth {
  nodeCode: string;
  /** online when central + UNS reachable, nothing buffered and the journal healthy; unconfigured while no verified config
   *  is known (no device runs); else degraded */
  status: "online" | "degraded" | "unconfigured";
  /** the UNS broker (northbound telemetry publish) */
  centralReachable: boolean;
  /** the node protocol (last HTTP heartbeat answered); null before the first one / not provisioned */
  nodeProtocolReachable: boolean | null;
  /** Samples buffered for northbound UNS replay (central-unreachable backlog). */
  unsBuffered: number;
  /** Rows buffered by the telemetry store-and-forward (central-unreachable backlog). */
  dbBuffered: number;
  activeAdapters: number;
  journal: { epoch: string; backlog: number; bytes: number; full: boolean; healthy: boolean } | null;
  configVersion: number | null;
  version: string;
  ts: string;
  /**
   * doc 81 Đợt 12 final fix wave (R-12-e M-5) — robot sessions stuck QUIESCING (a quiesce whose STOP / detach failed): each refuses
   * every motion (ROBOT_QUIESCING) until its quiesce completes (retried by the reconciler). Any ⇒ the node reports degraded.
   */
  robotsQuiescing: Array<{ robotId: number; since: string; why: string }>;
}

/** R-12-e M-5 — the robot sessions of this edge that are quiescing (a failed / unfinished quiesce). Never throws. */
export async function edgeRobotsQuiescing(): Promise<Array<{ robotId: number; since: string; why: string }>> {
  try {
    const rm = await import("../robot/robotManager");
    const out: Array<{ robotId: number; since: string; why: string }> = [];
    for (const id of rm.activeRobotIds()) {
      const q = rm.robotQuiescing(id);
      if (q) out.push({ robotId: id, since: q.since, why: q.why });
    }
    return out.sort((a, b) => a.robotId - b.robotId);
  } catch {
    return [];
  }
}

/** Current health. Never throws. */
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
  const robotsQuiescing = await edgeRobotsQuiescing(); // R-12-e M-5
  const rt = runtime;
  const j = rt?.journal.stats() ?? null;
  const cfg = rt?.config.current() ?? null;
  // a configured node whose config names enabled devices but none of them runs here is not "online" either (I-5)
  const wantsDevices = !!cfg && (cfg.adapters.some((a) => a.isEnabled) || cfg.robots.some((r) => r.isEnabled));
  const devicesDown = wantsDevices && devices.started && activeAdapters === 0 && devices.robotCount() === 0;
  const degraded = !reachable || unsBuffered > 0 || dbBuffered > 0 || robotsQuiescing.length > 0 || (rt !== null && (rt.lastHeartbeatOk === false || !j?.healthy || j.full || devicesDown));
  return {
    nodeCode: cfg?.node.code ?? edgeNodeCode(),
    status: rt !== null && cfg === null ? "unconfigured" : degraded ? "degraded" : "online",
    centralReachable: reachable,
    nodeProtocolReachable: rt?.lastHeartbeatOk ?? null,
    unsBuffered,
    dbBuffered,
    activeAdapters,
    journal: j ? { epoch: j.epoch, backlog: j.backlog, bytes: j.bytes, full: j.full, healthy: j.healthy } : null,
    configVersion: rt?.config.current()?.configVersion ?? null,
    version: edgeGatewayVersion(),
    ts: new Date().toISOString(),
    robotsQuiescing,
  };
}

// ── heartbeat (HTTP, node credential) + drain loops ────────────────────────────

let heartbeatTimer: NodeJS.Timeout | null = null;
let drainTimer: NodeJS.Timeout | null = null;
let programTimer: NodeJS.Timeout | null = null;
let liveRunsOf: () => { live: number; max: number } = () => ({ live: 0, max: 1 });

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

/**
 * One heartbeat: health → POST /edge/node/heartbeat (status, version, capacity, journal, config hash in use, keyset version,
 * wall clock, uptime). A newer configVersion ⇒ fetch + verify the config; programCheckRequested ⇒ report program checks.
 * The node cannot rename itself or change its factory / lines (D14). Never throws.
 */
export async function sendHeartbeat(): Promise<EdgeGatewayHealth> {
  const health = await getEdgeGatewayHealth();
  const rt = runtime;
  if (rt) {
    const j = rt.journal.stats();
    const cap = liveRunsOf();
    const r = await rt.client.post("heartbeat", {
      protocolVersion: EDGE_PROTOCOL_VERSION,
      status: health.status === "online" ? "online" : "degraded",
      version: health.version.slice(0, 64) || "unknown",
      capacity: { liveRuns: cap.live, maxRuns: Math.max(1, cap.max) },
      journal: { epoch: j.epoch, backlog: j.backlog, bytes: j.bytes, full: j.full },
      configHash: rt.config.hash(),
      keysetVersion: rt.config.trust().version,
      wallClockMs: Date.now(),
      uptimeMs: Math.max(0, Date.now() - rt.startedAtMs),
    });
    if (r.ok !== rt.lastHeartbeatOk) console.warn(r.ok ? "[EdgeGateway] heartbeat answered — central reachable" : `[EdgeGateway] heartbeat failed (HTTP ${r.status || "network"}${r.code ? ` ${r.code}` : ""}) — degraded`);
    rt.lastHeartbeatOk = r.ok;
    if (r.ok) {
      if (r.data.configVersion > rt.config.version() || r.data.keysetVersion > rt.config.trust().version) {
        await rt.config.refresh();
      }
      if (r.data.programCheckRequested) void rt.programChecks.report().catch(() => undefined);
    }
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
  console.log(`[EdgeGateway] heartbeat loop started (every ${intervalMs}ms)`);
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
        // doc 81 Đợt 10 E — telemetry buffered while central was down drains through the HTTP insert function
        if (runtime && sf.storeForwardEnabled() && sf.bufferedCount() > 0) await sf.backfill();
      } catch (err) {
        console.error("[EdgeGateway] drain failed:", (err as Error)?.message || err);
      } finally {
        draining = false;
      }
    })();
  }, intervalMs);
  if (typeof drainTimer.unref === "function") drainTimer.unref();
  console.log(`[EdgeGateway] backfill drain loop started (every ${intervalMs}ms)`);
}

function startProgramReportLoop(rt: EdgeRuntime): void {
  if (programTimer) return;
  const ms = rt.config.limits()?.programReportMs ?? (Number.parseInt(process.env.EDGE_PROGRAM_REPORT_MS ?? "", 10) || 30_000);
  programTimer = setInterval(() => void rt.programChecks.report().catch(() => undefined), Math.max(1_000, ms));
  if (typeof programTimer.unref === "function") programTimer.unref();
}

/** Group D's device runtime: the verified config, the journal, the trust inputs of the edge authorisation verifier. */
async function installDeviceRuntime(rt: EdgeRuntime): Promise<void> {
  const { installEdgeDeviceRuntime } = await import("./edgeDeviceRuntime");
  await installEdgeDeviceRuntime({
    nodeId: rt.nodeId,
    config: () => rt.config.current(),
    journal: rt.journal,
    auth: () =>
      rt.config.current() === null
        ? null
        : {
            trust: rt.config.trust(),
            credentialId: rt.config.credentialId(),
            maxTtlMs: rt.config.limits()?.authTtlMs ?? 10_000,
            pendingNonce: (n: string) => {
              const t = rt.authorize.nonceSentAt(n);
              return t === null ? null : { sentMonoMs: t };
            },
            nowMonoMs: () => rt.client.monoNow(),
          },
  });
}

/** The per-robot edge options (group D's robotManager edge mode): robot state + lock transitions into the journal. */
async function edgeRobotStartExtras(rt: EdgeRuntime): Promise<{ stateSink: (robot: { id: number }, st: import("../robot/robotDriver").RobotState) => void; attachLock: (robot: { id: number }, lock: import("../robot/robotDriver").MotionLock) => void }> {
  const [{ attachEdgeMotionLockPersistence }, streams] = await Promise.all([import("../robot/robotMotionLockStore"), import("./edgeStreams")]);
  return {
    stateSink: (robot, st) => void rt.sink.robotState(streams.robotStateToRecord(robot.id, st)).catch(() => undefined),
    attachLock: (robot, lock) => {
      const row = rt.config.robot(robot.id);
      if (!row) throw new EdgeContractError("not_in_config", `robot ${robot.id} is not in the verified config`);
      const seed = streams.edgeMotionLockSeed(rt.journal, row);
      const persistence = streams.edgeMotionLockPersistence(rt.sink, robot.id, () => rt.config.robot(robot.id)?.ownerEpoch ?? row.ownerEpoch);
      attachEdgeMotionLockPersistence(robot.id, lock, seed, persistence, { announce: seed.source === "unknown" || seed.source === "ownerChanged" || seed.source === "config" });
    },
  };
}

/** The node's robots from the VERIFIED config (group D's edge mode of robotManager), lock + state into the journal. */
async function startEdgeRobots(rt: EdgeRuntime, cfg: EdgeConfigSnapshot): Promise<void> {
  await import("../robot"); // registers the robot drivers (side effect), as "../ot" does for OT
  const [{ startRobots }, { runtimeRobotsFromConfig }] = await Promise.all([import("../robot/robotManager"), import("../robot/robotAdapter")]);
  await startRobots({ configRobots: runtimeRobotsFromConfig(cfg.robots), ...(await edgeRobotStartExtras(rt)) });
}

/** What runs here now (the reconciler's memory). */
const devices = {
  started: false,
  /** per adapter: the VERIFIED config row its session was started from (its STOP pins on release) + its key */
  adapters: new Map<number, { row: EdgeConfigSnapshot["adapters"][number]; key: string }>(),
  /** per robot: what its session was started from (owner epoch, endpoint, vendor, options) */
  robotKeys: new Map<number, string>(),
  /** per robot that could not be attached: failures + next attempt (only that robot is retried) */
  robotBackoff: new Map<number, { failures: number; nextAt: number }>(),
  /** per robot: when its attach / reconfigure failure was last alerted, and for which cause (bounded interval per cause) */
  attachAlertAt: new Map<number, { at: number; cause: string }>(),
  chain: Promise.resolve() as Promise<unknown>,
  retry: null as NodeJS.Timeout | null,
  robotCount(): number {
    return this.robotKeys.size;
  },
};
/** does this edge hold a live session for the device? (robot: robotManager's active set; adapter: attached by the reconciler) */
/**
 * does this edge hold a LIVE session for the device? robot: robotManager's active set; adapter (fix review 5, N4-2):
 * otManager's live set — a connected driver (supervised: the supervisor's active driver), never the reconciler's memory
 * (a row recorded at boot that startOt could not build / a dropped connection has no session ⇒ notOwnedHere ⇒ central's
 * fallback, instead of an ADAPTER_OFFLINE failure re-delivered forever)
 */
function edgeHasSession(rm: { getActiveRobot(id: number): unknown }, om: { getActiveDriver(id: number): unknown }): (t: { robotId: number } | { adapterId: number }) => boolean {
  return (t) => ("robotId" in t ? rm.getActiveRobot(t.robotId) != null : om.getActiveDriver(t.adapterId) != null);
}
/** the key of a live robot session this reconciler did not start (never equal to a real row's key) */
const UNTRACKED_ROBOT_KEY = "untracked";
/** a robot's SESSION key — what a new session would differ in (never updatedAt alone: a renamed robot keeps its session) */
function oneRobotKey(r: EdgeConfigSnapshot["robots"][number]): string {
  return JSON.stringify([r.id, r.ownerEpoch, r.endpoint, r.vendor, r.connectionOptions ?? null, r.pollIntervalMs]);
}
/**
 * doc 81 Đợt 12 final fix wave (R-12-e M-5) — is the robot's live session up to date? Its recorded key equals the wanted row's AND
 * it is not quiescing: a session left quiescing by a failed quiesce is taken down again (quiesce → detach → attach) on the next pass
 * even when the settings were reverted meanwhile and the key matches again — otherwise it refused motion until an edge restart.
 */
export function edgeRobotSessionUpToDate(recordedKey: string | undefined, wantKey: string, quiescing: boolean): boolean {
  return recordedKey === wantKey && !quiescing;
}
function oneAdapterKey(a: EdgeConfigSnapshot["adapters"][number]): string {
  return JSON.stringify([a.id, a.updatedAt, a.connectionFingerprint, a.ownerEpoch, a.pollIntervalMs, a.tags.map((t) => [t.id, t.updatedAt, t.isEnabled])]);
}
export const EDGE_RECONCILE_RETRY_MS = 10_000;
/** R-12-e M-5 — what a failed quiesce leaves (said in its durable alert) */
const QUIESCING_NOTE = "The session is QUIESCING: it refuses every motion until the quiesce completes (listed in the node health, robotsQuiescing; the node reports degraded).";
/** EDGE_RECONCILE_RETRY_MS env (bounded 100 ms – 10 min), default 10 s */
function reconcileRetryMs(): number {
  const n = Number.parseInt(process.env.EDGE_RECONCILE_RETRY_MS ?? "", 10);
  return Number.isFinite(n) ? Math.min(600_000, Math.max(100, n)) : EDGE_RECONCILE_RETRY_MS;
}

/**
 * Bring the devices in line with the VERIFIED config (serialised; nothing without a config). ONE device at a time
 * (fix review 2, N-1): an adapter / robot that changed is restarted alone, the others keep their sessions.
 * RELEASE (R-10-ar, scan #75): a device leaves this node ONLY when a verified config omits it AND it was locked locally (robot)
 * AND its STOP succeeded (robot abort through D's dispatch / the adapter's PINNED stop of the config it was started from).
 * Otherwise it stays attached (and locked), a TRUTHFUL alert says what failed, and the release is retried (N-2: every failed
 * step is retried every EDGE_RECONCILE_RETRY_MS; its key is only recorded once it succeeded). A STOP central sent for the device
 * in the same pull ran BEFORE this (fast path).
 */
export function reconcileDevices(rt: EdgeRuntime, why: string): Promise<unknown> {
  devices.chain = devices.chain
    .then(() => reconcileOnce(rt, why))
    .then((ok) => {
      if (ok || devices.retry) return;
      devices.retry = setTimeout(() => {
        devices.retry = null;
        if (runtime === rt) void reconcileDevices(rt, "retry");
      }, reconcileRetryMs());
      if (typeof devices.retry.unref === "function") devices.retry.unref();
    })
    .catch((err) => console.error("[EdgeGateway] device reconcile failed:", (err as Error)?.message || err));
  return devices.chain;
}

/** true ⇔ everything converged (else a retry is scheduled). */
async function reconcileOnce(rt: EdgeRuntime, why: string): Promise<boolean> {
  const cfg = rt.config.current();
  if (!cfg) return true;
  let ok = true;
  // ── OT ──
  try {
    const [ot, { createDriver }] = await Promise.all([import("../ot"), import("../ot/driverRegistry")]);
    const want = new Map(cfg.adapters.filter((a) => a.isEnabled).map((a) => [a.id, a] as const));
    if (!devices.started) {
      await ot.startOt();
      for (const [id, a] of want) devices.adapters.set(id, { row: a, key: oneAdapterKey(a) });
    } else {
      const om = await import("../ot/otManager");
      for (const [id, cur] of [...devices.adapters]) {
        if (want.has(id)) continue;
        if (await releaseAdapter(rt, cur.row, why)) devices.adapters.delete(id);
        else ok = false;
      }
      for (const [id, a] of want) {
        const cur = devices.adapters.get(id);
        const key = oneAdapterKey(a);
        if (cur && cur.key === key) continue;
        const ol = otLifecycleOverride ?? { attach: (x: RuntimeAdapter) => om.attachOtAdapter(x), detach: (x: number) => om.detachOtAdapter(x) };
        if (cur) await ol.detach(id); // still owned: a new session from the new row (no STOP needed)
        const [runtimeAdapter] = configAdaptersToRuntime({ ...cfg, adapters: [a] }, createDriver);
        // fix review 3 — the key is recorded only when the attach succeeded (else retried)
        if (await ol.attach(runtimeAdapter)) devices.adapters.set(id, { row: a, key });
        else {
          if (cur) devices.adapters.delete(id);
          ok = false;
        }
      }
    }
  } catch (err) {
    ok = false;
    console.error("[EdgeGateway] OT reconcile failed:", (err as Error)?.message || err);
  }
  // ── robots — one at a time (F-2, R-10-au): never a whole-gateway restart ──
  try {
    const rm = await import("../robot/robotManager");
    const life = await edgeRobotLifecycle();
    const want = new Map(cfg.robots.filter((r) => r.isEnabled).map((r) => [r.id, r] as const));
    // fix review 5 (N4-1) — robots start from the SAME snapshot as `want` (never a config re-read after startOt's awaits)
    if (!devices.started) await startEdgeRobots(rt, cfg);
    // … and EVERY live session is tracked: one this reconciler did not record (a drift of any kind) is keyed "untracked" —
    // wanted ⇒ its key differs ⇒ quiesced + re-attached from the verified row; not wanted ⇒ released (lock + STOP + detach)
    for (const id of rm.activeRobotIds()) {
      if (devices.robotKeys.has(id)) continue;
      devices.robotKeys.set(id, !devices.started && want.has(id) ? oneRobotKey(want.get(id)!) : UNTRACKED_ROBOT_KEY);
    }
    // a robot that left: lock + STOP + then detach (checked) — a failed release stays attached + locked, never touched by the rest
    for (const id of [...devices.robotKeys.keys()]) {
      if (want.has(id)) continue;
      const q = await quiesceRobot(rt, id, `no longer owned (${why})`);
      if (q.ok) {
        devices.robotKeys.delete(id);
        releaseAlert(rt, "EDGE_DEVICE_RELEASED", `robot ${id} no longer owned (${why}): ${q.detail}`);
      } else {
        ok = false;
        releaseAlert(rt, "EDGE_DEVICE_RELEASE_FAILED", `robot ${id} no longer owned (${why}) but KEPT attached${q.locked ? " and locked" : ""}: ${q.detail} — retried every ${reconcileRetryMs() / 1_000} s; use the machine's direct STOP / E-STOP if it moves. ${QUIESCING_NOTE}`);
      }
    }
    // a robot added / reconfigured / never connected: ITS session only, with a per-robot back-off — never the healthy ones
    for (const r of want.values()) {
      if (edgeRobotSessionUpToDate(devices.robotKeys.get(r.id), oneRobotKey(r), rm.robotQuiescing(r.id) !== null)) continue; // R-12-e M-5
      const back = devices.robotBackoff.get(r.id);
      if (back && Date.now() < back.nextAt) {
        ok = false;
        continue;
      }
      const fail = (cause: string, detail: string) => {
        const failures = (back?.failures ?? 0) + 1;
        devices.robotBackoff.set(r.id, { failures, nextAt: Date.now() + Math.min(300_000, reconcileRetryMs() * 2 ** Math.min(failures - 1, 10)) });
        ok = false;
        attachAlert(rt, r.id, cause, detail);
      };
      if (devices.robotKeys.has(r.id)) {
        // G-1 (R-10-az) — a settings change of a STILL-OWNED robot: lock → STOP (D's dispatch) → detach (checked) → attach the
        // new row (checked). Any failure before the detach keeps the OLD session (locked) + alert + retry.
        const q = await quiesceRobot(rt, r.id, `reconfigured (${why})`);
        if (!q.ok) {
          fail(`reconfigure:${q.cause}`, `robot ${r.id} settings changed (${why}) but its OLD session is KEPT${q.locked ? " (locked)" : ""}: ${q.detail} — retried (also if the settings are reverted meanwhile). ${QUIESCING_NOTE}`);
          continue;
        }
        devices.robotKeys.delete(r.id);
      }
      const at = await life.attach(r);
      if (at.ok) {
        devices.robotKeys.set(r.id, oneRobotKey(r));
        devices.robotBackoff.delete(r.id);
        devices.attachAlertAt.delete(r.id);
      } else {
        fail("attach", `robot ${r.id} is owned but NOT attached on this edge (${at.reason ?? "attach refused"}) — retried with a back-off; its STOPs are answered notOwnedHere so central's fallback executes them`);
      }
    }
  } catch (err) {
    ok = false;
    console.error("[EdgeGateway] robot reconcile failed:", (err as Error)?.message || err);
  }
  devices.started = true;
  return ok;
}

/** R-10-az — the ONE result shape of group D's per-robot edge lifecycle (callers check `.ok`, never truthiness) */
export type EdgeLifecycleResult = { ok: true } | { ok: false; reason?: string };
/**
 * G-2 (R-10-az) — group D's robotManager contract (ab252ccaa): `attachEdgeRobot(robotConfigRow)` (D builds the driver from the
 * VERIFIED config row; the lock seeded first through the boot's extras) and `detachEdgeRobot(robotId)` (REFUSES `not_locked`
 * unless the robot is locked; never throws), both resolving `{ ok, reason?, detail? }`. Only `ok === true` is ok; anything
 * else (a boolean, undefined, a throw …) is NOT ok (fail-closed).
 */
export interface EdgeRobotLifecycle {
  attach(row: EdgeConfigSnapshot["robots"][number]): Promise<EdgeLifecycleResult>;
  detach(robotId: number): Promise<EdgeLifecycleResult>;
}
/** test seam — the per-adapter attach / detach (default: otManager.attachOtAdapter / detachOtAdapter) */
let otLifecycleOverride: { attach(a: RuntimeAdapter): Promise<boolean>; detach(id: number): Promise<boolean> } | null = null;
export function setEdgeOtLifecycle(l: typeof otLifecycleOverride): void {
  otLifecycleOverride = l;
}
/** exported for tests: D's answer → the contract (only `{ ok: true }` is ok; a bare `true`, `{ok:"yes"}`, undefined … are NOT) */
export function lifecycleResult(r: unknown, missing: string): EdgeLifecycleResult {
  if (r && typeof r === "object" && (r as { ok?: unknown }).ok === true) return { ok: true };
  const o = r && typeof r === "object" ? (r as { reason?: unknown; detail?: unknown }) : {};
  const reason = typeof o.reason === "string" ? o.reason : missing;
  return { ok: false, reason: typeof o.detail === "string" && o.detail ? `${reason}: ${o.detail}` : reason };
}
async function edgeRobotLifecycle(): Promise<EdgeRobotLifecycle> {
  await import("../robot"); // drivers registered
  const rm = await import("../robot/robotManager");
  return {
    attach: async (row) => {
      try {
        return lifecycleResult(await rm.attachEdgeRobot(row), "attach answered outside the {ok} contract");
      } catch (err) {
        return { ok: false, reason: `attach threw: ${(err as Error)?.message ?? err}` };
      }
    },
    detach: async (id) => {
      try {
        return lifecycleResult(await rm.detachEdgeRobot(id), "detach answered outside the {ok} contract");
      } catch (err) {
        return { ok: false, reason: `detach threw: ${(err as Error)?.message ?? err}` };
      }
    },
  };
}

/** F-2 leftover — an owned robot without a session alerts on a bounded interval (per robot), not once per process. */
export const EDGE_ATTACH_ALERT_EVERY_MS = 300_000;
/** EDGE_ATTACH_ALERT_EVERY_MS env (bounded 100 ms – 1 h), default 5 min */
function attachAlertEveryMs(): number {
  const n = Number.parseInt(process.env.EDGE_ATTACH_ALERT_EVERY_MS ?? "", 10);
  return Number.isFinite(n) ? Math.min(3_600_000, Math.max(100, n)) : EDGE_ATTACH_ALERT_EVERY_MS;
}
function attachAlert(rt: EdgeRuntime, robotId: number, cause: string, detail: string): void {
  const last = devices.attachAlertAt.get(robotId);
  // the SAME cause repeats at most once per interval; a NEW cause (e.g. the STOP now works but the detach is refused) at once
  if (last !== undefined && last.cause === cause && Date.now() - last.at < attachAlertEveryMs()) return;
  devices.attachAlertAt.set(robotId, { at: Date.now(), cause });
  releaseAlert(rt, "EDGE_DEVICE_ATTACH_FAILED", detail);
}

function releaseAlert(rt: EdgeRuntime, code: "EDGE_DEVICE_RELEASED" | "EDGE_DEVICE_RELEASE_FAILED" | "EDGE_DEVICE_ATTACH_FAILED", detail: string): void {
  if (code !== "EDGE_DEVICE_RELEASED") console.error(`[EdgeGateway] ${detail}`);
  void rt.sink.event({ kind: "anomaly", code, runId: null, detail: detail.slice(0, 1_000), at: Date.now() }, { stop: true }).catch(() => undefined);
}

/**
 * G-1 (R-10-az) — take ONE robot's session down safely (it left the node, or its settings changed): LOCK it locally, STOP it
 * (D's dispatch), then D's detach — checked: `{ok:false}` (e.g. `not_locked`, `not_active`) is a failure. Only all three ⇒
 * ok. Otherwise the session is KEPT (and stays locked when the lock took); `detail` says exactly what happened.
 */
async function quiesceRobot(rt: EdgeRuntime, robotId: number, why: string): Promise<{ ok: boolean; locked: boolean; detail: string; cause: string }> {
  const rm = await import("../robot/robotManager");
  const robot = rm.getActiveRobot(robotId);
  if (!robot) return { ok: true, locked: false, detail: "no session here (nothing can move, nothing to close)", cause: "none" };
  // doc 81 Đợt 12 N fix 1 (I-1, R-12-d) — QUIESCING first, before the lock and the STOP (synchronous: the STOP is not delayed).
  // The edge motion path refuses this session from now on; a confirmed STOP (which clears the motion lock below) or a signed
  // clear does not lift it — only the detach does.
  markSessionQuiescing(robot.driver, why);
  let lock: string;
  let lockOk = false;
  try {
    const lc = robot.driver.motionLockController?.();
    if (!lc) lock = "NOT locked: the driver has no motion lock";
    else {
      lc.lock("ownershipRemoved", `robot ${robotId} ${why}`);
      // doc 81 Đợt 12 final fix wave (R-12-e I-2) — a QUIESCE hold: the confirmed STOP below does not clear this lock (no window
      // between the STOP and a re-lock in which a signed motion could reach the robot); only the detach ends the session
      (lc as { holdForQuiesce?: (why: string) => void }).holdForQuiesce?.(`robot ${robotId} ${why}`);
      lockOk = lc.isLocked();
      lock = lockOk ? `locked (generation ${lc.snapshot().generation ?? "?"})` : "NOT locked: the lock did not take";
    }
  } catch (err) {
    lock = `NOT locked: ${(err as Error)?.message ?? err}`;
  }
  let stop: string;
  let stopOk = false;
  try {
    const { dispatchRobotOnEdge } = await import("../robot/robotEdgeDispatch");
    const r = await dispatchRobotOnEdge({ robotId, job: { jobType: "abort" }, idempotencyKey: `edge-quiesce-${robotId}-${Date.now()}`, source: "local", requestId: null });
    stopOk = r.ok && (r.status === "done" || r.status === "simulated");
    stop = stopOk ? `STOP ${r.status}` : `STOP FAILED (${r.reason ?? r.error ?? r.status})`;
  } catch (err) {
    stop = `STOP FAILED (${(err as Error)?.message ?? err})`;
  }
  // doc 81 Đợt 12 task N — a CONFIRMED STOP clears a lock that is not an operator hold (R13: every session driver, and the SIM
  // driver since Đợt 12), so the lock taken above is gone once the STOP was done: re-take it — the robot leaves this node LOCKED
  // (detachEdgeRobot refuses `not_locked`; before Đợt 12 the release was kept for ever with "detach REFUSED (not_locked)").
  // R-12-e I-2: with the quiesce hold the lock is never cleared by the STOP; this stays as a second layer for a lock controller
  // without the hold.
  if (lockOk && stopOk) {
    try {
      const lc = robot.driver.motionLockController?.();
      if (lc && !lc.isLocked()) {
        lc.lock("ownershipRemoved", `robot ${robotId} ${why} (re-locked after its confirmed STOP)`);
        lockOk = lc.isLocked();
        lock = lockOk ? `locked (generation ${lc.snapshot().generation ?? "?"}, re-taken after the STOP)` : "NOT locked after the STOP: the lock did not take";
      }
    } catch (err) {
      lockOk = false;
      lock = `NOT locked after the STOP: ${(err as Error)?.message ?? err}`;
    }
  }
  if (!lockOk || !stopOk) return { ok: false, locked: lockOk, detail: `${lock}; ${stop}; session not detached`, cause: !lockOk ? "lock" : "stop" };
  const d = await (await edgeRobotLifecycle()).detach(robotId);
  if (!d.ok) return { ok: false, locked: lockOk, detail: `${lock}; ${stop}; detach REFUSED (${d.reason ?? "?"}) — session kept`, cause: `detach:${(d.reason ?? "?").split(":")[0]}` };
  return { ok: true, locked: lockOk, detail: `${lock}, ${stop}, session closed`, cause: "none" };
}

/**
 * An adapter no longer this node's (F-4, R-10-au): its PINNED STOP goes through group D's pinned-STOP pipeline
 * (otEdgeDispatch: classifyEdgeOtStop + canonicalisePinnedStop over a snapshot that still holds the VERIFIED row its session was
 * started from — the new config no longer names it — the running connection's fingerprint must equal that row's, an
 * undefined one fails CLOSED; the device stage + its own `stop` journal record). Never a raw driver write. Then the session
 * closes. A read-only adapter (no writable tag) has nothing to stop; no session at all ⇒ nothing to close. Anything else that
 * fails — no pin, a stale / unknown connection, a disconnected adapter, a failed write — keeps it attached + a truthful alert +
 * a retry.
 */
async function releaseAdapter(rt: EdgeRuntime, row: EdgeConfigSnapshot["adapters"][number], why: string): Promise<boolean> {
  const om = await import("../ot/otManager");
  const attached = om.getOtAdapterStatus(row.id) !== undefined || om.getActiveAdapter(row.id) !== undefined;
  const writable = row.tags.filter((t) => t.isEnabled && t.writable);
  const pins = writable.filter((t) => t.stopValue !== null && t.stopValue !== undefined);
  let stop: string;
  let stopOk = false;
  if (!attached) {
    stopOk = true; // no session here at all: nothing can be written, nothing to close
    stop = "no session";
  } else if (writable.length === 0) {
    stopOk = true;
    stop = "read-only adapter (no STOP needed)";
  } else if (pins.length === 0) {
    stop = "STOP NOT possible: no pinned STOP tag on a writable adapter";
  } else {
    try {
      const [{ dispatchOtOnEdge }, { edgeDeviceRuntime }] = await Promise.all([import("../ot/otEdgeDispatch"), import("./edgeDeviceRuntime")]);
      const base = edgeDeviceRuntime();
      const cur = rt.config.current();
      const releaseRt = base && cur ? { ...base, config: () => ({ ...cur, adapters: [...cur.adapters.filter((x) => x.id !== row.id), row] }) } : base;
      const r = await dispatchOtOnEdge(
        { adapterId: row.id, machineId: row.machineId, commandType: "stop", writes: pins.map((t) => ({ tagKey: t.tagKey, value: t.stopValue })), idempotencyKey: `edge-release-a${row.id}-${Date.now()}`, source: "local", requestId: null },
        releaseRt,
      );
      stopOk = r.stop === true && r.ok === true; // D's pinned STOP ran and the device stage reported success (or simulated)
      // M-4 — the real cause: a STOP D did not classify as pinned names it in `detail` (e.g. stop_not_pinned:adapter_connection_stale)
      const cause = r.stop !== true ? (r.detail ?? r.reason ?? r.status) : (r.reason ?? r.detail ?? r.status);
      stop = stopOk ? `pinned STOP ${r.status} (${pins.map((t) => t.tagKey).join(", ")})` : `pinned STOP NOT sent / FAILED (${cause})`;
    } catch (err) {
      stop = `pinned STOP FAILED (${(err as Error)?.message ?? err})`;
    }
  }
  if (stopOk) {
    await om.detachOtAdapter(row.id);
    releaseAlert(rt, "EDGE_DEVICE_RELEASED", `adapter ${row.id} no longer owned (${why}): ${stop}, session closed`);
    return true;
  }
  releaseAlert(rt, "EDGE_DEVICE_RELEASE_FAILED", `adapter ${row.id} no longer owned (${why}) but KEPT attached: ${stop} — retried every ${reconcileRetryMs() / 1_000} s`);
  return false;
}


// ── bootstrap / run / stop ──────────────────────────────────────────────────────

export interface EdgeGatewayHandles {
  stop: () => Promise<void>;
  runtime: EdgeRuntime | null;
}

export interface EdgeGatewayBootOptions {
  /** test / integration seam: the walker (default: group C's driveEdgeRunFromPackage, resolved at runtime) */
  walker?: EdgeWalker | null;
  /** test / integration seam: the device port of central commands (default: the interim driver port) */
  devices?: EdgeDevicePort;
  /** test seam — does this edge hold a session for the device (default: robotManager active set / attached adapters) */
  hasSession?: (target: { robotId: number } | { adapterId: number }) => boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Wire and start the edge gateway WITHOUT holding the event loop open (testable). Order (design §4 E):
 *   config (verified from central, else the verified cache) → sources (adapter source, telemetry insert function +
 *   store-forward, both HTTP) → UNS publisher → OT → robots → agent (commands always; runs iff EDGE_EXECUTION_ENABLED) →
 *   heartbeat / shipping / program-check / drain loops.
 * Not provisioned (no credential / node id / pin) ⇒ NO device is started (fail-closed) — only the UNS bridge and the
 * liveness marker. No HTTP / socket / MQTT-broker bind; no DB.
 */
export async function bootstrapEdgeGateway(opts: EdgeGatewayBootOptions = {}): Promise<EdgeGatewayHandles> {
  // The edge entrypoint IS the edge gateway → ensure edge mode unless explicitly off.
  if (process.env.EDGE_GATEWAY_MODE == null) process.env.EDGE_GATEWAY_MODE = "true";
  if (process.env.EDGE_GATEWAY_CONFIG_FILE?.trim()) {
    console.warn("[EdgeGateway] EDGE_GATEWAY_CONFIG_FILE is ignored: identity, devices and mappings come from central's signed config (mapping-as-code is a central CLI, D13)");
  }

  // 1) config
  const n = await edgeNodeEnv();
  if ("error" in n) {
    console.error(`[EdgeGateway] node NOT provisioned (${n.error}) — no device is started (fail-closed)`);
  } else {
    try {
      runtime = await createEdgeRuntime(n, { fetchImpl: opts.fetchImpl });
    } catch (err) {
      console.error(`[EdgeGateway] edge runtime not started (${(err as Error)?.message ?? err}) — no device is started (fail-closed)`);
      runtime = null;
    }
  }
  const rt = runtime;

  // 2) sources — the edge's OT adapters + telemetry go through central over HTTP, never a DB
  if (rt) {
    const [{ setAdapterSource }, { createDriver }, bus] = await Promise.all([import("../ot/deviceAdapter"), import("../ot/driverRegistry"), import("../telemetryBus")]);
    setAdapterSource(async () => {
      const c = rt.config.current();
      return c ? configAdaptersToRuntime(c, createDriver) : [];
    });
    bus.setTelemetryPersistFn(edgeTelemetryPersistFn(rt.client));
    if (process.env.OT_STORE_FORWARD_ENABLED == null) process.env.OT_STORE_FORWARD_ENABLED = "true";
    if (process.env.OT_STORE_FORWARD_FILE == null) process.env.OT_STORE_FORWARD_FILE = path.join(rt.journal.dir, "ot-store-forward.jsonl");
    await bus.wireStoreForward();
  }

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

  if (rt) {
    // the device front ends (group D: otEdgeDispatch / robotEdgeDispatch) + the safety-PLC config sources read THIS runtime
    try {
      await installDeviceRuntime(rt);
    } catch (err) {
      console.error("[EdgeGateway] edge device runtime not installed (non-STOP edge commands are refused):", (err as Error)?.message || err);
    }
  }

  if (rt) {
    // 3) + 4) devices — now if a verified config is known, and AGAIN whenever the config changes (a late first config, an
    //    ownership change): OT restarts on a change of its adapters; robots are reconciled (fix review 1, I-5)
    await reconcileDevices(rt, "boot");
    rt.config.onChange(() => {
      void reconcileDevices(rt, "config change").catch((err) => console.error("[EdgeGateway] device reconcile failed:", (err as Error)?.message || err));
    });
  }

  if (rt) {
    // 5) agent: commands (STOP / lock / clear) always; claims runs only with EDGE_EXECUTION_ENABLED + FOE
    try {
      const agentMod = await import("./edgeExecutionAgent");
      const exec = await agentMod.edgeExecutionConfigFromEnv();
      const claimRuns = !("error" in exec);
      if (!claimRuns) console.log(`[EdgeExec] run execution NOT started: ${(exec as { error: string }).error} — central commands (STOP / lock / clear) are still handled`);
      const cfg = claimRuns
        ? { ...exec, fetchImpl: opts.fetchImpl }
        : { centralUrl: n && !("error" in n) ? n.centralUrl : "", credential: "", pullIntervalMs: agentMod.edgePullIntervalBoundFromEnv(), progressMs: 2_000, maxConcurrent: 1, requestTimeoutMs: 10_000, stopResendMinMs: 10_000, claimRuns: false };
      let walker: EdgeWalker | null = null;
      if (claimRuns) {
        if (opts.walker !== undefined) walker = opts.walker;
        else {
          try {
            walker = await agentMod.loadDefaultEdgeWalker();
          } catch (err) {
            console.error("[EdgeExec] walker unavailable:", (err as Error)?.message || err);
          }
        }
      }
      const hashDefinition = await agentMod.defaultEdgeHashDefinition();
      const a = await agentMod.startEdgeExecution(cfg, {
        client: rt.client,
        config: rt.config,
        journal: rt.journal,
        shipper: rt.shipper,
        sink: rt.sink,
        consume: rt.consume,
        authorize: rt.authorize,
        programChecks: rt.programChecks,
        walker,
        devices: opts.devices ?? agentMod.edgeDispatchDevicePort(rt.config),
        hashDefinition,
        // F-2 leftover (R-10-az) — an owned device with NO session here: its STOPs are answered notOwnedHere (central's fallback)
        hasSession: opts.hasSession ?? edgeHasSession(await import("../robot/robotManager"), await import("../ot/otManager")),
      });
      if (a) liveRunsOf = () => ({ live: a.liveRunIds().length, max: claimRuns ? cfg.maxConcurrent : 1 });
    } catch (err) {
      console.error("[EdgeGateway] edge agent not started:", (err as Error)?.message || err);
    }
    rt.shipper.start(rt.config.limits()?.pullMs ?? 2_000);
    startProgramReportLoop(rt);
  }

  await sendHeartbeat();
  startHeartbeatLoop();
  startDrainLoop();

  return { stop: stopEdgeGateway, runtime: rt };
}

let shuttingDown = false;

/** Stop everything the edge gateway started (idempotent + non-throwing). */
export async function stopEdgeGateway(): Promise<void> {
  for (const t of [heartbeatTimer, drainTimer, programTimer]) if (t) clearInterval(t);
  heartbeatTimer = null;
  drainTimer = null;
  programTimer = null;
  // stop pulling new runs (walkers in flight finish their segment; a lost one is declared interrupted).
  try {
    const { stopEdgeExecution } = await import("./edgeExecutionAgent");
    await stopEdgeExecution();
  } catch {
    /* best-effort */
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
  if (runtime) {
    try {
      const { stopRobots } = await import("../robot/robotManager");
      await stopRobots();
    } catch {
      /* best-effort */
    }
    try {
      const { _resetEdgeDeviceRuntimeForTests } = await import("./edgeDeviceRuntime");
      await _resetEdgeDeviceRuntimeForTests();
    } catch {
      /* best-effort */
    }
  }
  try {
    const pub = await import("../unsPublisher");
    await pub.publishNdeathGraceful();
    await pub.shutdownUnsPublisher();
  } catch {
    /* best-effort */
  }
  const rt = runtime;
  runtime = null;
  liveRunsOf = () => ({ live: 0, max: 1 });
  await devices.chain.catch(() => undefined);
  if (devices.retry) clearTimeout(devices.retry);
  devices.retry = null;
  devices.started = false;
  devices.adapters = new Map();
  devices.robotKeys = new Map();
  devices.robotBackoff = new Map();
  devices.attachAlertAt = new Map();
  if (rt) {
    try {
      await rt.shipper.stop();
      await rt.shipper.flushAll();
    } catch {
      /* best-effort */
    }
    await rt.journal.close().catch(() => undefined);
    try {
      const [{ setAdapterSource }, bus] = await Promise.all([import("../ot/deviceAdapter"), import("../telemetryBus")]);
      setAdapterSource(null);
      bus.setTelemetryPersistFn(null);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Run the edge gateway as a long-lived process (the entrypoint). Boots, then holds
 * the event loop open and installs graceful-shutdown handlers. Mirrors worker.ts.
 */
export async function runEdgeGateway(): Promise<void> {
  console.log("[EdgeGateway] Starting edge gateway (SYNAPSE Tầng-1 §5 — no HTTP listener, no central DB).");
  console.log(`[EdgeGateway] version=${edgeGatewayVersion()} edgeMode=${edgeGatewayModeEnabled()} role=${process.env.AVI_PROCESS_ROLE ?? "(unset)"}`);
  if (process.env.DATABASE_URL) console.warn("[EdgeGateway] DATABASE_URL is set on this edge host — it is NOT used (AVI_PROCESS_ROLE=edge); remove it from the edge environment");

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

/** doc 81 Đợt 12 N fix 1 — test seam: ONE robot's quiesce (lock → STOP → detach), as the reconciler runs it. */
export function _quiesceRobotForTests(robotId: number, why: string): Promise<{ ok: boolean; locked: boolean; detail: string; cause: string }> {
  return quiesceRobot(runtime as EdgeRuntime, robotId, why);
}

/** Test-only reset of module-level loop/registry state. */
export function _resetForTests(): void {
  for (const t of [heartbeatTimer, drainTimer, programTimer]) if (t) clearInterval(t);
  heartbeatTimer = null;
  drainTimer = null;
  programTimer = null;
  shuttingDown = false;
  reachabilityProbe = null;
  runtime = null;
  liveRunsOf = () => ({ live: 0, max: 1 });
}
