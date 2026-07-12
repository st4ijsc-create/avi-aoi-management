/**
 * G1 (Giai đoạn 1) — UNS Publisher: đẩy message đã chuẩn hoá (ISA-95 / Sparkplug B)
 * sang broker MQTT HA (EMQX).
 *
 * Tách I/O ra khỏi `unsBridge.ts` (chỉ tính topic). Module này giữ kết nối tới EMQX
 * và publish các bản chuẩn hoá. Feature-flag `UNS_BRIDGE_ENABLED` — khi tắt là no-op,
 * không mở kết nối nào.
 *
 * Broker đích lấy từ `UNS_BROKER_URL` (mặc định mqtt://localhost:1884 — cổng EMQX trong
 * docker-compose). KHÔNG trùng broker aedes nội bộ (1883) nên không tạo vòng lặp.
 *
 * F3a — Sparkplug-B CORE: khi `UNS_SPARKPLUG_ENABLED==="true"` thêm chiều phát
 * telemetry chuẩn Sparkplug (NBIRTH lúc connect, DBIRTH lazy, DDATA mỗi sample,
 * NDEATH làm MQTT will). TÁI DÙNG mqtt client này — KHÔNG tạo broker/publisher mới.
 * Đường JSON cũ (publishNormalized) GIỮ NGUYÊN khi cờ tắt (backward-compat).
 *
 * F4 HITL: NCMD/DCMD execute NOT implemented — publisher CHỈ phát (read-direction),
 * KHÔNG subscribe/xử lý lệnh điều khiển máy.
 */

import mqtt, { type MqttClient } from "mqtt";
import { readFileSync } from "fs";
import { and, eq } from "drizzle-orm";
import { normalize, isUnsBridgeEnabled } from "./unsBridge";
import { SparkplugNode, type MetricSample, type MetricDef } from "./uns/sparkplugNode";
import {
  SparkplugCommandHandler,
  isSparkplugCommandEnabled,
  parseCommandTopic,
  type MachineTarget,
} from "./uns/sparkplugCommand";
import type { SparkplugMetric } from "./uns/sparkplugEncoder";
import {
  isUnsPackmlStateEnabled,
  buildPackmlStateMessages,
  packmlSparkplugDeviceId,
  buildPackmlStateMetrics,
  type PackmlTransition,
  type PackmlIdentity,
} from "./uns/packmlStateBridge";
import { dispatch } from "./ot/commandDispatcher";
import { getDb } from "../db/connection";
import { machines, deviceAdapters } from "../../drizzle/schema";
// ── doc 44 W2-A1 (G2.1+G1.5) — UNS v2 semantic tree (spec LDS-L1 §9.1) ────────
import {
  isUnsTopicV2Enabled,
  aspectPublishOptions,
  buildEquipmentTopicV2,
  buildTelemetryPayloadV2,
  buildStateSnapshotV2,
  buildEventPayloadV2,
  buildHealthPayloadV2,
  classifyAviAspect,
  parseAviLikeTopic,
  toCanonicalState,
  normalizeEventSeverity,
  extractScalarMetrics,
  isa95PathString,
  type Isa95PathV2,
  type UnsAspect,
  type TelemetryMetricV2,
  type CanonicalHealthStatus,
} from "./uns/topicV2";
import {
  resolveIsa95Path,
  resolveIsa95PathByStation,
  resolveMachineIdByAdapterId,
  resolveMachineIdByAdapterCode,
} from "./uns/isa95Resolver";

const UNS_BROKER_URL = process.env.UNS_BROKER_URL || "mqtt://localhost:1884";
const UNS_BROKER_USERNAME = process.env.UNS_BROKER_USERNAME || "";
const UNS_BROKER_PASSWORD = process.env.UNS_BROKER_PASSWORD || "";

let client: MqttClient | null = null;
let connected = false;

// --- Sparkplug-B state (F3a) ---
let sparkplugNode: SparkplugNode | null = null;

// --- F4 HITL: inbound NCMD/DCMD command handler (flag SPARKPLUG_COMMAND_ENABLED,
// default OFF). Owns NO MQTT client — it is GIVEN this publisher's client via the
// injected deps below. Wired once in client.on("connect"); a scoped message handler
// (commandMessageHandler) routes only NCMD/DCMD topics to it (drops everything else).
let sparkplugCommandHandler: SparkplugCommandHandler | null = null;
let commandMessageHandler: ((topic: string, payload: Buffer) => void) | null = null;

// F3b — set metric name đã được DBIRTH cho từng device (để trigger re-DBIRTH khi gặp
// metric mới chưa từng birth — theo spec Sparkplug). In-memory, đời broker.
// TODO(F3b-optional): persist bdSeq + birthed metric set nếu cần survive restart.
const birthedMetricsByDevice = new Map<string, Set<string>>();

/** Cờ Sparkplug đọc tại publish-time (không cache module-load → test stubEnv được). */
function isSparkplugEnabled(): boolean {
  return process.env.UNS_SPARKPLUG_ENABLED === "true";
}

/** group_id Sparkplug: ưu tiên ENV, suy từ UNS_ENTERPRISE_NAME, fallback "avi". */
function sparkplugGroupId(): string {
  return (
    process.env.UNS_SPARKPLUG_GROUP_ID ||
    process.env.UNS_ENTERPRISE_NAME ||
    "avi"
  );
}

/** edge_node_id Sparkplug. */
function sparkplugEdgeNodeId(): string {
  return process.env.UNS_SPARKPLUG_EDGE_NODE_ID || "avi-aoi-ot";
}

/** Default commandType label recorded on the commandLog for an inbound DCMD write. */
const SPARKPLUG_DCMD_COMMAND_TYPE = process.env.SPARKPLUG_DCMD_COMMAND_TYPE || "sparkplug_dcmd";

/**
 * F4 HITL — resolveTarget: map a Sparkplug (group,node,device) → a platform OT
 * target {machineId, adapterId}, or null when unknown (the handler then DROPS the
 * command — never guessed).
 *
 * MAPPING ASSUMPTION (mirrors the PUBLISH side): the publish bridge (aoiBridge.ts)
 * emits DDATA with `deviceId = "Station{stationId}"` (the ISA-95 cell). So an inbound
 * DCMD device is `Station{N}` where N = machines.stationId. We resolve:
 *   1. parse N from the "Station{N}" deviceId,
 *   2. machines WHERE stationId = N AND isActive  → machineId,
 *   3. an ENABLED deviceAdapters WHERE machineId = machine.id → adapterId.
 * The adapter's own writable-tag allowlist + OT_CONTROL_ENABLED gate (inside dispatch)
 * are what actually authorize/deny a write — this only locates the target row.
 *
 * group/node are not used for the lookup (single edge node per publisher); they are
 * accepted to match the injected-dep signature and could scope the query later.
 */
export async function resolveSparkplugTarget(
  _groupId: string,
  _edgeNodeId: string,
  deviceId: string | undefined,
): Promise<MachineTarget | null> {
  if (!deviceId) return null;
  const m = /^Station(\d+)$/i.exec(deviceId);
  if (!m) return null;
  const stationId = Number(m[1]);
  if (!Number.isInteger(stationId)) return null;

  try {
    const db = await getDb();
    if (!db) return null;
    const machineRows = await db
      .select({ id: machines.id })
      .from(machines)
      .where(and(eq(machines.stationId, stationId), eq(machines.isActive, true)))
      .limit(1);
    const machine = machineRows[0];
    if (!machine) return null;

    const adapterRows = await db
      .select({ id: deviceAdapters.id })
      .from(deviceAdapters)
      .where(and(eq(deviceAdapters.machineId, machine.id), eq(deviceAdapters.isEnabled, true)))
      .limit(1);
    const adapter = adapterRows[0];
    if (!adapter) return null;

    return { machineId: machine.id, adapterId: adapter.id };
  } catch (err) {
    console.error("[UNS] Sparkplug resolveTarget failed:", (err as Error)?.message || err);
    return null;
  }
}

/**
 * F4 HITL — metricToWrite: map one decoded DCMD metric (name + value) → the
 * dispatcher write-intent {tagKey, value, commandType}, or null to IGNORE.
 *
 * The Sparkplug metric NAME is used directly as the dispatcher tagKey: dispatch()
 * resolves tagKey → deviceTags within the target adapter and ENFORCES the
 * tag.writable allowlist, so an arbitrary inbound name that is not a writable tag is
 * rejected there (never executed). We ignore the well-known Rebirth metric (handled
 * separately) and any nameless/aliased-only metric.
 */
export function sparkplugMetricToWrite(
  metric: SparkplugMetric,
): { tagKey: string; value: unknown; commandType: string } | null {
  const name = typeof metric.name === "string" ? metric.name.trim() : "";
  if (!name) return null;
  if (name === "Node Control/Rebirth") return null;
  return { tagKey: name, value: metric.value, commandType: SPARKPLUG_DCMD_COMMAND_TYPE };
}

/** System user id recorded as requestedBy/confirmedBy on the dispatch (env override). */
function sparkplugSystemUserId(): number {
  const n = Number(process.env.SPARKPLUG_COMMAND_SYSTEM_USER_ID);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * F4 HITL — instantiate + start the inbound NCMD/DCMD handler on THIS publisher's
 * MQTT client. Idempotent (no-op when already started). The handler itself is
 * flag-gated (SPARKPLUG_COMMAND_ENABLED) — start() is a no-op + returns false when
 * the flag is off, so the publisher stays publish-only by default.
 *
 * Wiring of the injected deps:
 *  - subscribe: client.subscribe(filters) + a SCOPED client.on("message") that only
 *    forwards NCMD/DCMD topics (parseCommandTopic !== null) to the handler. Other
 *    topics are ignored here, so this never double-handles the publish path (the
 *    publisher does not otherwise subscribe to any topic — it is publish-only).
 *  - onRebirth: rebuild the BIRTH certificates via SparkplugNode.buildRebirth() and
 *    publish each {topic,buffer}. The ONE safe auto-action (re-publish telemetry).
 *  - resolveTarget / metricToWrite: the platform mapping defined above.
 *  - dispatch: the EXISTING commandDispatcher (HITL trigger, OT_CONTROL_ENABLED gate).
 */
function startCommandHandler(): void {
  if (sparkplugCommandHandler) return;
  const c = client;
  const node = sparkplugNode;
  if (!c || !node) return;
  const groupId = sparkplugGroupId();
  const edgeNodeId = sparkplugEdgeNodeId();

  sparkplugCommandHandler = new SparkplugCommandHandler({
    subscribe: (topicFilters, onMessage) => {
      try {
        c.subscribe(topicFilters, { qos: 0 }, (err) => {
          if (err) console.error("[UNS] Sparkplug command subscribe failed:", err.message);
        });
      } catch (err) {
        console.error("[UNS] Sparkplug command subscribe threw:", (err as Error)?.message || err);
      }
      // Scoped message handler: forward ONLY NCMD/DCMD topics. Never throws.
      commandMessageHandler = (topic: string, payload: Buffer) => {
        try {
          if (!parseCommandTopic(topic)) return; // not a command topic → ignore (publish path untouched)
          onMessage(topic, payload);
        } catch (err) {
          console.error("[UNS] Sparkplug command message handler error (dropped):", (err as Error)?.message || err);
        }
      };
      c.on("message", commandMessageHandler);
    },
    dispatch,
    onRebirth: () => {
      // Re-publish BIRTH certificates (NBIRTH + DBIRTH for birthed devices). The
      // publisher does not retain the per-device metric defs here, so DBIRTH carries
      // the node birth only — devices lazily re-DBIRTH on their next DDATA (F3b).
      birthedMetricsByDevice.clear();
      const msgs = node.buildRebirth(groupId, edgeNodeId, []);
      for (const m of msgs) {
        c.publish(m.topic, m.buffer, { qos: 0, retain: false });
      }
      console.log(`[UNS] Sparkplug Rebirth published (${msgs.length} certificate(s))`);
    },
    resolveTarget: resolveSparkplugTarget,
    metricToWrite: sparkplugMetricToWrite,
    systemUserId: sparkplugSystemUserId(),
  });

  const started = sparkplugCommandHandler.start(groupId, edgeNodeId);
  if (!started) {
    // Flag off (defensive — caller already checks): drop the unused handler.
    sparkplugCommandHandler = null;
  }
}

/**
 * Khởi tạo kết nối tới broker UNS (EMQX). No-op nếu flag tắt hoặc đã khởi tạo.
 */
export function initUnsPublisher(): void {
  if (!isUnsBridgeEnabled()) {
    console.log("[UNS] UNS bridge disabled. Set UNS_BRIDGE_ENABLED=true to enable.");
    return;
  }
  if (client) return;

  const options: mqtt.IClientOptions = {
    clientId: `avi-aoi-uns-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
  };
  if (UNS_BROKER_USERNAME) {
    options.username = UNS_BROKER_USERNAME;
    options.password = UNS_BROKER_PASSWORD;
  }
  // Phase 1 WS1.4 — TLS to the EMQX broker (mqtts://). Provide UNS_TLS_CA for a
  // proper CA chain; set UNS_TLS_REJECT_UNAUTHORIZED=false only for dev
  // self-signed certs.
  if (UNS_BROKER_URL.startsWith("mqtts://") || UNS_BROKER_URL.startsWith("tls://")) {
    options.rejectUnauthorized = process.env.UNS_TLS_REJECT_UNAUTHORIZED !== "false";
    const caPath = process.env.UNS_TLS_CA;
    if (caPath) {
      try {
        options.ca = readFileSync(caPath);
      } catch (e) {
        console.error("[UNS] Failed to read UNS_TLS_CA:", (e as Error)?.message ?? e);
      }
    }
  }

  // Sparkplug-B: chuẩn bị node + đặt NDEATH làm MQTT will (encode TRƯỚC connect).
  if (isSparkplugEnabled()) {
    try {
      sparkplugNode = new SparkplugNode();
      const ndeath = sparkplugNode.buildNdeath(sparkplugGroupId(), sparkplugEdgeNodeId());
      options.will = {
        topic: ndeath.topic,
        payload: ndeath.buffer,
        qos: 0,
        retain: false,
      };
    } catch (err) {
      console.error("[UNS] Sparkplug NDEATH will setup failed:", (err as Error)?.message || err);
      sparkplugNode = null;
    }
  }

  console.log(`[UNS] Connecting to UNS broker ${UNS_BROKER_URL}...`);
  client = mqtt.connect(UNS_BROKER_URL, options);

  client.on("connect", () => {
    connected = true;
    console.log(`[UNS] Connected to UNS broker ${UNS_BROKER_URL}`);
    // Sparkplug-B: phát NBIRTH cho edge node ngay khi kết nối.
    if (isSparkplugEnabled() && sparkplugNode && client) {
      try {
        // NBIRTH reset alias/birth state ở core F3a → xoá luôn birthed-metric tracker
        // (F3b) để mọi device re-DBIRTH ở đời broker mới.
        birthedMetricsByDevice.clear();
        const nbirth = sparkplugNode.buildNbirth(sparkplugGroupId(), sparkplugEdgeNodeId(), []);
        client.publish(nbirth.topic, nbirth.buffer, { qos: 0, retain: false });
        console.log(`[UNS] Sparkplug NBIRTH published: ${nbirth.topic}`);
      } catch (err) {
        console.error("[UNS] Sparkplug NBIRTH publish failed:", (err as Error)?.message || err);
      }
    }
    // F4 HITL — inbound NCMD/DCMD (flag SPARKPLUG_COMMAND_ENABLED, default OFF).
    // Started AFTER the birth publish so a Rebirth re-publishes a valid certificate.
    // Fully fail-safe: never throws into the MQTT connect handler.
    if (isSparkplugEnabled() && isSparkplugCommandEnabled() && sparkplugNode && client) {
      try {
        startCommandHandler();
      } catch (err) {
        console.error("[UNS] Sparkplug command handler start failed:", (err as Error)?.message || err);
      }
    }
  });
  client.on("error", (error) => {
    console.error("[UNS] Broker connection error:", error.message);
  });
  client.on("close", () => {
    connected = false;
    console.log("[UNS] Broker connection closed");
  });
  client.on("reconnect", () => {
    console.log("[UNS] Reconnecting to UNS broker...");
  });

  // W2-A1 (doc 44) — v2 adapter-health sweep (UNS_TOPIC_V2_ENABLED, default OFF)
  // + line/area/site aggregate scheduler (UNS_AGGREGATES_ENABLED, default OFF).
  // Both are flag-gated no-ops by default. The aggregates module statically
  // imports this publisher, so it is loaded DYNAMICALLY here (no import cycle).
  startV2HealthSweep();
  void import("./uns/unsAggregates")
    .then((m) => m.startUnsAggregates())
    .catch((err) =>
      console.error("[UNS] aggregates scheduler start failed:", (err as Error)?.message || err),
    );
}

/**
 * Chuẩn hoá topic gốc và publish các bản UNS/Sparkplug sang broker đích.
 * No-op khi flag tắt hoặc chưa kết nối. An toàn để gọi trong hot path (try/catch nội bộ).
 */
export function publishNormalized(topic: string, payload: unknown): void {
  if (!isUnsBridgeEnabled() || !client || !connected) return;
  // G1.5 (doc 44 W2-A1) — ADDITIONALLY dual-publish onto the v2 semantic tree
  // (flag UNS_TOPIC_V2_ENABLED, default OFF → no-op). Fire-and-forget: the
  // resolver may hit the DB and must never block/break the legacy hot path.
  if (isUnsTopicV2Enabled()) {
    void publishV2FromLegacy(topic, payload).catch((err) =>
      console.error("[UNS v2] legacy dual-publish failed:", (err as Error)?.message || err),
    );
  }
  try {
    const mappings = normalize(topic, payload);
    if (mappings.length === 0) return;

    const buf =
      typeof payload === "string"
        ? Buffer.from(payload)
        : Buffer.isBuffer(payload)
          ? payload
          : Buffer.from(JSON.stringify(payload));

    for (const m of mappings) {
      const out = m.payload === payload ? buf : Buffer.from(JSON.stringify(m.payload));
      client.publish(m.topic, out, { qos: 0, retain: false });
    }
  } catch (error) {
    console.error("[UNS] Error publishing normalized message:", error);
  }
}

/**
 * F3a — Phát telemetry chuẩn Sparkplug-B DDATA cho một device (= adapter code).
 * Lazy DBIRTH khi device chưa birthed. No-op khi cờ tắt / chưa connect / lỗi setup.
 * Bọc try/catch — KHÔNG ném ra hot path ingest.
 */
export function publishSparkplugDData(deviceId: string, metrics: MetricSample[]): void {
  if (!isSparkplugEnabled() || !sparkplugNode || !client || !connected) return;
  try {
    const groupId = sparkplugGroupId();
    const edgeNodeId = sparkplugEdgeNodeId();

    // Lazy DBIRTH: device mới → khai báo metric definitions trước.
    if (!sparkplugNode.state.isDeviceBirthed(deviceId)) {
      const defs = metrics.map((m) => ({ name: m.name, type: m.type, value: m.value, timestamp: m.timestamp }));
      const dbirth = sparkplugNode.buildDbirth(groupId, edgeNodeId, deviceId, defs);
      client.publish(dbirth.topic, dbirth.buffer, { qos: 0, retain: false });
    }

    const ddata = sparkplugNode.buildDdata(groupId, edgeNodeId, deviceId, metrics);
    client.publish(ddata.topic, ddata.buffer, { qos: 0, retain: false });
  } catch (error) {
    console.error("[UNS] Sparkplug DDATA publish failed:", (error as Error)?.message || error);
  }
  // G1.5 (doc 44 W2-A1) — v2 telemetry dual-publish (adapter code → machine →
  // ISA-95 path). Fire-and-forget; default OFF.
  if (isUnsTopicV2Enabled()) {
    void publishV2FromSparkplugSamples(deviceId, metrics).catch((err) =>
      console.error("[UNS v2] Sparkplug dual-publish failed:", (err as Error)?.message || err),
    );
  }
}

/**
 * F3b — Bridge AOI → Sparkplug telemetry cho MỘT device (NG alert / summary).
 *
 * Lazy DBIRTH: nếu device chưa birthed HOẶC mapping mang metric name chưa từng birth
 * cho device đó → publish DBIRTH (union metric defs đã từng + defs mới) rồi mới DDATA.
 * No-op khi cờ Sparkplug tắt / chưa connect / lỗi setup. Bọc try/catch — KHÔNG ném ra
 * hot path aedes.on('publish').
 *
 * Read-direction only: chỉ phát DBIRTH/DDATA, KHÔNG sinh NCMD/DCMD.
 */
export function publishAoiBridge(
  deviceId: string,
  metricDefs: MetricDef[],
  metrics: MetricSample[],
): void {
  if (!isSparkplugEnabled() || !sparkplugNode || !client || !connected) return;
  try {
    const groupId = sparkplugGroupId();
    const edgeNodeId = sparkplugEdgeNodeId();

    let birthed = birthedMetricsByDevice.get(deviceId);
    const isNew = !sparkplugNode.state.isDeviceBirthed(deviceId) || !birthed;
    // Có metric name mới chưa từng birth cho device này?
    const hasNewMetric =
      !isNew && metricDefs.some((d) => !birthed!.has(d.name));

    if (isNew || hasNewMetric) {
      // Union defs đã từng birth + defs mới (re-DBIRTH với đủ metric của device).
      const byName = new Map<string, MetricDef>();
      for (const d of metricDefs) byName.set(d.name, d);
      const dbirth = sparkplugNode.buildDbirth(groupId, edgeNodeId, deviceId, [...byName.values()]);
      client.publish(dbirth.topic, dbirth.buffer, { qos: 0, retain: false });

      if (!birthed) {
        birthed = new Set<string>();
        birthedMetricsByDevice.set(deviceId, birthed);
      }
      for (const d of metricDefs) birthed.add(d.name);
    }

    const ddata = sparkplugNode.buildDdata(groupId, edgeNodeId, deviceId, metrics);
    client.publish(ddata.topic, ddata.buffer, { qos: 0, retain: false });
  } catch (error) {
    console.error("[UNS] Sparkplug AOI bridge publish failed:", (error as Error)?.message || error);
  }
}

/**
 * C5 (doc 24 Wave-4) — UNS-first PackML STATE: publish a PackML state TRANSITION +
 * machine IDENTITY as a first-class Sparkplug-B channel, so a UNS subscriber can
 * reconstruct the machine's full PackML state + identity from DBIRTH/DDATA.
 *
 * GATE (default OFF → complete no-op, legacy behaviour unchanged):
 *   1. UNS_PACKML_STATE_ENABLED — this channel's dedicated flag (checked FIRST), and
 *   2. UNS_SPARKPLUG_ENABLED    — the Sparkplug transport this channel rides on (the
 *      node/alias/DBIRTH machinery is reused; no new broker/publisher is created).
 * When either is off, or the publisher is not connected, this returns without publishing.
 *
 * READ-DIRECTION only: it PUBLISHES state; it NEVER issues a PackML command and opens
 * NO control path (a real command still routes through the gated commandDispatcher).
 * Bọc try/catch — KHÔNG ném ra hot path.
 */
export function publishPackmlState(
  transition: PackmlTransition,
  identity: PackmlIdentity = {},
): void {
  // Dedicated flag first — default OFF ⇒ legacy (no UNS PackML publish).
  if (!isUnsPackmlStateEnabled()) return;
  // G1.5 (doc 44 W2-A1) — v2 StateSnapshot dual-publish (retained, on change).
  // Needs only the shared client (works with or without Sparkplug). Fire-and-forget.
  if (isUnsTopicV2Enabled() && identity.machineId != null) {
    void publishV2FromPackmlTransition(transition, identity).catch((err) =>
      console.error("[UNS v2] PackML dual-publish failed:", (err as Error)?.message || err),
    );
  }
  // Rides the Sparkplug transport (node/client/connection). Honest: needs it enabled.
  if (!isSparkplugEnabled() || !sparkplugNode || !client || !connected) return;
  try {
    const groupId = sparkplugGroupId();
    const edgeNodeId = sparkplugEdgeNodeId();
    const deviceId = packmlSparkplugDeviceId(identity);

    const msgs = buildPackmlStateMessages(
      sparkplugNode,
      groupId,
      edgeNodeId,
      deviceId,
      transition,
      identity,
    );
    for (const m of msgs) {
      client.publish(m.topic, m.buffer, { qos: 0, retain: false });
    }

    // Track the PackML metric names for this device so graceful NDEATH emits its DDEATH.
    let birthed = birthedMetricsByDevice.get(deviceId);
    if (!birthed) {
      birthed = new Set<string>();
      birthedMetricsByDevice.set(deviceId, birthed);
    }
    for (const d of buildPackmlStateMetrics(transition, identity).metricDefs) birthed.add(d.name);
  } catch (error) {
    console.error("[UNS] Sparkplug PackML state publish failed:", (error as Error)?.message || error);
  }
}

// ═══ doc 44 W2-A1 (G2.1 + G1.5) — UNS TOPIC TREE v2 dual-publish ══════════════
//
// When UNS_TOPIC_V2_ENABLED === "true" (default OFF → byte-for-byte legacy
// behaviour) every message that flows through this publisher is ADDITIONALLY
// published on the spec-correct semantic tree
//
//   syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}
//   aspect ∈ telemetry | state | events | health | cmd_ack
//
// with segments resolved from the REAL hierarchy (machine→station→line→
// workshop→factory, isa95Resolver LRU/TTL-cached). The legacy tree
// ({enterprise}/{site}/... and Sparkplug) is NEVER turned off — dual-publish so
// existing subscribers keep working. QoS/retain per LDS-L1 §9.3: state+health
// retained QoS1, events+cmd_ack QoS1, telemetry QoS0.
//
// All v2 publishes are FIRE-AND-FORGET (the resolver may hit the DB): they can
// never block or break the synchronous legacy hot path. Unresolvable targets
// are SKIPPED with one honest warn (never a fabricated path).
// ══════════════════════════════════════════════════════════════════════════════

const v2SeqByTopic = new Map<string, number>();
const v2LastStateByPath = new Map<string, string>();
const v2LastHealthByAsset = new Map<string, { status: string; publishedAt: number }>();
const v2LastSeenByMachine = new Map<number, string>();
let v2Published = 0;
let v2Failed = 0;
let v2Skipped = 0;

/** v2 publish counters (status routers / tests). */
export function getUnsV2Stats(): { published: number; failed: number; skipped: number } {
  return { published: v2Published, failed: v2Failed, skipped: v2Skipped };
}

/** Reset v2 dedup/seq state (tests). Does NOT reset counters. */
export function resetUnsV2StateForTests(): void {
  v2SeqByTopic.clear();
  v2LastStateByPath.clear();
  v2LastHealthByAsset.clear();
  v2LastSeenByMachine.clear();
  v2Warned.clear();
}

// One honest warn per key (bounded set — cleared when it grows, so a warn can
// re-appear later instead of the set growing without bound).
const v2Warned = new Set<string>();
function warnOnceV2(key: string, msg: string): void {
  if (v2Warned.has(key)) return;
  if (v2Warned.size > 500) v2Warned.clear();
  v2Warned.add(key);
  console.warn(msg);
}

/**
 * Raw v2 publish on the SHARED UNS client with aspect-correct QoS/retain.
 * Exported for uns/unsAggregates (which applies its own flag gate). Returns
 * true only when a publish was handed to the mqtt client. NEVER throws.
 */
export function publishUnsV2(topic: string, payload: unknown, aspect: UnsAspect): boolean {
  if (!client || !connected) {
    v2Skipped += 1;
    return false;
  }
  try {
    const opts = aspectPublishOptions(aspect);
    client.publish(topic, Buffer.from(JSON.stringify(payload)), opts);
    v2Published += 1;
    return true;
  } catch (err) {
    v2Failed += 1;
    console.error("[UNS v2] publish failed:", (err as Error)?.message || err);
    return false;
  }
}

/** Monotonic per-topic seq (telemetry gap/dup detection). Bounded map. */
function nextV2Seq(topic: string): number {
  if (v2SeqByTopic.size > 5000 && !v2SeqByTopic.has(topic)) v2SeqByTopic.clear();
  const n = (v2SeqByTopic.get(topic) ?? 0) + 1;
  v2SeqByTopic.set(topic, n);
  return n;
}

/** Scalar top-level fields of a legacy payload as a StateSnapshot.values map. */
function v2ScalarValues(obj?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const metrics = extractScalarMetrics(obj);
  if (metrics.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const m of metrics) out[m.name] = m.value;
  return out;
}

const V2_HEALTH_REFRESH_MS = 60_000;

/**
 * Publish `.../health` (retained QoS1) when the status CHANGED or the last
 * publish is older than the refresh interval (keeps last_seen useful without
 * hammering retained messages).
 */
function publishV2HealthIfDue(path: Isa95PathV2, status: CanonicalHealthStatus, lastSeen: string): void {
  const key = isa95PathString(path);
  const prev = v2LastHealthByAsset.get(key);
  const now = Date.now();
  if (prev && prev.status === status && now - prev.publishedAt < V2_HEALTH_REFRESH_MS) return;
  const ok = publishUnsV2(
    buildEquipmentTopicV2(path, "health"),
    buildHealthPayloadV2({ path, status, lastSeen }),
    "health",
  );
  if (ok) v2LastHealthByAsset.set(key, { status, publishedAt: now });
}

const V2_QUALITIES = new Set(["good", "uncertain", "bad"]);
function v2NormalizeQuality(q: unknown): "good" | "uncertain" | "bad" | undefined {
  const s = String(q ?? "").toLowerCase();
  return V2_QUALITIES.has(s) ? (s as "good" | "uncertain" | "bad") : undefined;
}

/**
 * G1.5 — dual-publish ONE legacy bridge message onto the v2 tree.
 *
 * Classification (honest, source-driven):
 *  - adapter tag sample ({tagKey,value,machineId} — ot/ingest legacy JSON path)
 *      → telemetry {asset_id,ts,seq,metrics:[{name:tagKey,...}]}
 *  - `errors` (NG alert, carries machine.id)  → events (canonical event wrap)
 *  - `status`                                  → state (retained, on CHANGE only)
 *  - `heartbeat`                               → health (retained, online)
 *  - everything else (inspection/summary/…)    → telemetry (scalar extraction)
 *
 * Machine resolution: payload machineId / machine.id first, else the numeric
 * station id from the topic (station → first active machine, the same
 * convention the Sparkplug bridge uses). Unresolvable → skip + warn once.
 */
async function publishV2FromLegacy(topic: string, payload: unknown): Promise<void> {
  if (!isUnsTopicV2Enabled() || !client || !connected) return;
  const parsed = parseAviLikeTopic(topic);
  if (!parsed) return; // unknown topic shape → no honest mapping

  const obj =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined;

  const isAdapterSample = !!obj && typeof obj.tagKey === "string" && "value" in obj;

  // Machine identity hints carried by the payload (NG alert carries machine.id).
  let machineId: number | null = null;
  if (obj) {
    const direct = Number(obj.machineId);
    if (Number.isInteger(direct) && direct > 0) {
      machineId = direct;
    } else if (obj.machine && typeof obj.machine === "object") {
      const nested = Number((obj.machine as Record<string, unknown>).id);
      if (Number.isInteger(nested) && nested > 0) machineId = nested;
    }
  }

  let path: Isa95PathV2 | null = null;
  if (machineId != null) path = await resolveIsa95Path(machineId);
  if (!path) {
    const stationNum = Number(parsed.stationId);
    if (Number.isInteger(stationNum) && stationNum > 0) {
      path = await resolveIsa95PathByStation(stationNum);
    }
  }
  if (!path) {
    v2Skipped += 1;
    warnOnceV2(
      `legacy:${parsed.stationId}`,
      `[UNS v2] cannot resolve ISA-95 path for topic '${topic}' (station '${parsed.stationId}') — v2 publish skipped (honest, not fabricated)`,
    );
    return;
  }

  const aspect: UnsAspect = isAdapterSample ? "telemetry" : classifyAviAspect(parsed.messageType);
  const ts = (obj && typeof obj.timestamp === "string" && obj.timestamp) || new Date().toISOString();

  if (aspect === "events") {
    const err = obj?.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : undefined;
    const causeParts = [err?.code, err?.description].filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
    const product =
      obj?.product && typeof obj.product === "object" ? (obj.product as Record<string, unknown>) : undefined;
    const ev = buildEventPayloadV2({
      path,
      type: "fault",
      severity: normalizeEventSeverity(obj?.severity, "error"),
      ts,
      cause: causeParts.length > 0 ? causeParts.join(": ") : undefined,
      payload: {
        ...(obj?.inspectionId != null ? { inspectionId: obj.inspectionId } : {}),
        ...(obj?.totalNG != null ? { totalNG: obj.totalNG } : {}),
        ...(product?.serialNumber != null ? { serialNumber: product.serialNumber } : {}),
      },
    });
    publishUnsV2(buildEquipmentTopicV2(path, "events"), ev, "events");
    return;
  }

  if (aspect === "state") {
    const raw = obj?.status ?? obj?.state ?? obj?.operationStatus;
    if (raw == null) {
      v2Skipped += 1; // no state field → nothing honest to publish
      return;
    }
    const state = toCanonicalState(raw);
    const pathKey = isa95PathString(path);
    if (v2LastStateByPath.get(pathKey) === state) return; // publish on CHANGE only
    v2LastStateByPath.set(pathKey, state);
    const snap = buildStateSnapshotV2({ path, ts, state, values: v2ScalarValues(obj) });
    publishUnsV2(buildEquipmentTopicV2(path, "state"), snap, "state");
    return;
  }

  if (aspect === "health") {
    publishV2HealthIfDue(path, "online", ts);
    return;
  }

  // telemetry
  let metrics: TelemetryMetricV2[];
  if (isAdapterSample && obj) {
    const quality = v2NormalizeQuality(obj.quality);
    metrics = [{ name: String(obj.tagKey), value: obj.value, ...(quality ? { quality } : {}), ts }];
  } else {
    metrics = extractScalarMetrics(payload, ts);
    if (metrics.length === 0) metrics = [{ name: parsed.messageType, value: payload ?? null, ts }];
  }
  const v2Topic = buildEquipmentTopicV2(path, "telemetry");
  publishUnsV2(v2Topic, buildTelemetryPayloadV2({ path, ts, seq: nextV2Seq(v2Topic), metrics }), "telemetry");
}

/** G1.5 — v2 telemetry for a Sparkplug DDATA batch (adapter code → machine). */
async function publishV2FromSparkplugSamples(deviceId: string, samples: MetricSample[]): Promise<void> {
  if (!isUnsTopicV2Enabled() || !client || !connected || samples.length === 0) return;
  const machineId = await resolveMachineIdByAdapterCode(deviceId);
  if (machineId == null) {
    v2Skipped += 1;
    warnOnceV2(
      `spdev:${deviceId}`,
      `[UNS v2] Sparkplug device '${deviceId}' has no adapter→machine mapping — v2 telemetry skipped`,
    );
    return;
  }
  const path = await resolveIsa95Path(machineId);
  if (!path) {
    v2Skipped += 1;
    return;
  }
  const metrics: TelemetryMetricV2[] = samples.map((s) => ({
    name: s.name,
    value: s.value,
    ts: new Date(typeof s.timestamp === "number" ? s.timestamp : Date.now()).toISOString(),
  }));
  const v2Topic = buildEquipmentTopicV2(path, "telemetry");
  publishUnsV2(v2Topic, buildTelemetryPayloadV2({ path, seq: nextV2Seq(v2Topic), metrics }), "telemetry");
}

/** G1.5 — v2 StateSnapshot for a PackML transition (state already canonical). */
async function publishV2FromPackmlTransition(
  transition: PackmlTransition,
  identity: PackmlIdentity,
): Promise<void> {
  if (!isUnsTopicV2Enabled() || !client || !connected) return;
  const machineId = Number(identity.machineId);
  if (!Number.isInteger(machineId) || machineId <= 0) return;
  const path = await resolveIsa95Path(machineId);
  if (!path) {
    v2Skipped += 1;
    return;
  }
  const state = String(transition.state);
  const pathKey = isa95PathString(path);
  if (v2LastStateByPath.get(pathKey) === state) return; // on CHANGE only
  v2LastStateByPath.set(pathKey, state);
  const snap = buildStateSnapshotV2({
    path,
    ts: new Date(transition.timestamp ?? Date.now()).toISOString(),
    state,
    values: {
      ...(transition.previousState ? { previous_state: transition.previousState } : {}),
      ...(transition.command ? { command: transition.command } : {}),
      ...(transition.unitMode ? { unit_mode: transition.unitMode } : {}),
      ...(identity.machineCode ? { machine_code: identity.machineCode } : {}),
    },
  });
  publishUnsV2(buildEquipmentTopicV2(path, "state"), snap, "state");
}

/** G1.5 — v2 cmd_ack addressed at the machine's ISA-95 path. */
async function publishCmdAckV2(
  ack: CmdAckMessage,
  target?: { adapterId?: number; machineId?: number | null },
): Promise<void> {
  if (!isUnsTopicV2Enabled() || !client || !connected) return;
  let machineId: number | null = target?.machineId ?? null;
  if (machineId == null && target?.adapterId != null) {
    machineId = await resolveMachineIdByAdapterId(target.adapterId);
  }
  if (machineId == null) {
    v2Skipped += 1;
    warnOnceV2(
      `cmdack:${target?.adapterId ?? "?"}`,
      `[UNS v2] cmd_ack for adapter ${target?.adapterId ?? "?"} has no machine mapping — v2 cmd_ack skipped (legacy topic still published)`,
    );
    return;
  }
  const path = await resolveIsa95Path(machineId);
  if (!path) {
    v2Skipped += 1;
    return;
  }
  publishUnsV2(buildEquipmentTopicV2(path, "cmd_ack"), ack, "cmd_ack");
}

// ─── v2 health sweep — adapter/supervisor source (LDS-L1 §19.1) ───────────────

let v2HealthTimer: NodeJS.Timeout | null = null;
let v2HealthSweepRunning = false;

function v2HealthIntervalMs(): number {
  const n = Number(process.env.UNS_TOPIC_V2_HEALTH_INTERVAL_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 60_000;
}

/**
 * ONE health sweep over the OT runtime's active adapters: driver connected →
 * online (last_seen = now); disconnected → offline with the LAST OBSERVED
 * last_seen (never observed online in this process → honestly skipped, we have
 * no last_seen to report). Publishes retained QoS1 on change / refresh interval.
 * Exported for tests + on-demand runs. Never throws.
 */
export async function runV2HealthSweepOnce(): Promise<void> {
  if (!isUnsTopicV2Enabled() || !client || !connected) return;
  let adapters: Array<{ adapterId: number; code: string; machineId: number | null; driver: { isConnected(): boolean } }>;
  try {
    // Dynamic import: keeps the heavy OT chain out of module load (test-mockable).
    const otManager = await import("./ot/otManager");
    adapters = otManager.listActiveAdapters();
  } catch (err) {
    console.error("[UNS v2] health sweep: otManager unavailable:", (err as Error)?.message || err);
    return;
  }
  for (const adapter of adapters) {
    try {
      if (adapter.machineId == null) {
        warnOnceV2(
          `health-adapter:${adapter.adapterId}`,
          `[UNS v2] adapter '${adapter.code}' has no machineId — health not published`,
        );
        continue;
      }
      const path = await resolveIsa95Path(adapter.machineId);
      if (!path) continue;
      let isConn = false;
      try {
        isConn = adapter.driver.isConnected();
      } catch {
        isConn = false;
      }
      if (isConn) {
        const nowIso = new Date().toISOString();
        v2LastSeenByMachine.set(adapter.machineId, nowIso);
        publishV2HealthIfDue(path, "online", nowIso);
      } else {
        const lastSeen = v2LastSeenByMachine.get(adapter.machineId);
        if (!lastSeen) continue; // honest: no observed last_seen to report
        publishV2HealthIfDue(path, "offline", lastSeen);
      }
    } catch (err) {
      console.error(
        `[UNS v2] health publish for adapter ${adapter.adapterId} failed:`,
        (err as Error)?.message || err,
      );
    }
  }
}

/** Start the periodic health sweep (no-op when UNS_TOPIC_V2_ENABLED is off). */
function startV2HealthSweep(): void {
  if (!isUnsTopicV2Enabled()) return;
  if (v2HealthTimer) return;
  const interval = v2HealthIntervalMs();
  v2HealthTimer = setInterval(() => {
    if (v2HealthSweepRunning) return;
    v2HealthSweepRunning = true;
    runV2HealthSweepOnce()
      .catch((err) => console.error("[UNS v2] health sweep failed:", (err as Error)?.message || err))
      .finally(() => {
        v2HealthSweepRunning = false;
      });
  }, interval);
  if (typeof v2HealthTimer.unref === "function") v2HealthTimer.unref();
  console.log(`[UNS v2] adapter health sweep started (every ${interval}ms)`);
}

function stopV2HealthSweep(): void {
  if (v2HealthTimer) {
    clearInterval(v2HealthTimer);
    v2HealthTimer = null;
  }
}

// ─── G1.6 (doc 44 W0-D) — cmd_ack publish (LDS-L1 §8.5) ───────────────────────
//
// After the commandDispatcher reaches a TERMINAL result (simulated / acked* /
// failed / timeout / rejected) it calls publishCmdAck (fire-and-forget, via a
// dynamic import — the dispatcher must never statically import this module back).
//
// GATE (default OFF → complete no-op, publish-only behaviour unchanged):
//   UNS_CMD_ACK_ENABLED === "true"  — the dedicated flag (checked FIRST), riding
//   the existing UNS mqtt client (needs UNS_BRIDGE_ENABLED + a live connection).
//
// HONESTY: when the broker is not connected NOTHING is published (returns false,
// counted in the failed metric) — no buffering, no fabricated ack. QoS 1 (an ack
// is a result message — it should survive one broker hop), retain false (acks are
// events, not state). READ-DIRECTION only: this publishes a RESULT; it opens no
// control path.

/** LDS-L1 §8.5 — cmd_ack payload: { command_id, correlation_id, status, reason, ts, result? }. */
export interface CmdAckMessage {
  /** The caller-visible command identity (= DispatchInput.idempotencyKey). */
  command_id: string;
  correlation_id: string | null;
  status: string;
  reason: string | null;
  /** ISO timestamp the terminal result was reached. */
  ts: string;
  /** Optional per-write outcomes (DispatchPerWrite[]). */
  result?: unknown;
}

/** True when the UNS cmd_ack channel is enabled (default OFF). Read at publish-time. */
export function isUnsCmdAckEnabled(): boolean {
  return process.env.UNS_CMD_ACK_ENABLED === "true";
}

// Fire-and-forget metrics: a publish failure must be VISIBLE (counted) even though
// it can never fail the dispatch.
let cmdAckPublished = 0;
let cmdAckFailed = 0;

/** cmd_ack publish counters (status routers / tests). */
export function getCmdAckStats(): { published: number; failed: number } {
  return { published: cmdAckPublished, failed: cmdAckFailed };
}

/**
 * cmd_ack topic. Until the full ISA-95 asset path is materialized (doc 44 G1.10,
 * separate task) the ack is addressed by adapter id under the `syn/` aspect tree
 * (see contracts/apiSpec.ts channel conventions):
 *   {UNS_CMD_ACK_TOPIC_ROOT|syn}/{UNS_ENTERPRISE_NAME|AVI-AOI}/cmd_ack/adapter/{adapterId}
 */
function cmdAckTopic(target?: { adapterId?: number; machineId?: number | null }): string {
  const root = process.env.UNS_CMD_ACK_TOPIC_ROOT || "syn";
  const site = process.env.UNS_ENTERPRISE_NAME || "AVI-AOI";
  const seg = target?.adapterId != null ? `adapter/${target.adapterId}` : "unmapped";
  return `${root}/${site}/cmd_ack/${seg}`;
}

/**
 * G1.6 — publish one cmd_ack message. Returns true only when a publish was
 * actually handed to the mqtt client. NEVER throws (fully try/caught) — the
 * dispatcher calls this fire-and-forget and must be unaffected by any failure.
 */
export function publishCmdAck(
  ack: CmdAckMessage,
  target?: { adapterId?: number; machineId?: number | null },
): boolean {
  if (!isUnsCmdAckEnabled()) return false;
  if (!client || !connected) {
    // Honest: broker down/not configured → no publish, but count it (visible).
    cmdAckFailed += 1;
    return false;
  }
  // G1.5 (doc 44 W2-A1) — ADDITIONALLY address the ack at the machine's ISA-95
  // path: syn/{site}/{area}/{line}/{cell}/{equipment}/cmd_ack. The legacy
  // adapter-addressed placeholder topic below is KEPT for compatibility.
  // Fire-and-forget (machine resolution may hit the DB).
  if (isUnsTopicV2Enabled()) {
    void publishCmdAckV2(ack, target).catch((err) =>
      console.error("[UNS v2] cmd_ack dual-publish failed:", (err as Error)?.message || err),
    );
  }
  try {
    client.publish(cmdAckTopic(target), Buffer.from(JSON.stringify(ack)), { qos: 1, retain: false });
    cmdAckPublished += 1;
    return true;
  } catch (error) {
    cmdAckFailed += 1;
    console.error("[UNS] cmd_ack publish failed:", (error as Error)?.message || error);
    return false;
  }
}

/**
 * F3b — Đóng node có chủ đích (graceful NDEATH): phát DDEATH cho mọi device đã birthed
 * rồi NDEATH chủ động. Best-effort với timeout NGẮN (mặc định 1.5s) — KHÔNG throw, dùng
 * khi shutdown. No-op khi cờ tắt / chưa connect.
 *
 * (NBIRTH-on-connect đã do F3a tự phát ở client.on('connect'); đây chỉ lo chiều đóng.)
 */
export async function publishNdeathGraceful(timeoutMs = 1500): Promise<void> {
  if (!isSparkplugEnabled() || !sparkplugNode || !client || !connected) return;
  const node = sparkplugNode;
  const c = client;
  const groupId = sparkplugGroupId();
  const edgeNodeId = sparkplugEdgeNodeId();

  const work = (async () => {
    try {
      // DDEATH cho từng device còn birthed (snapshot tránh mutate khi lặp).
      for (const deviceId of [...birthedMetricsByDevice.keys()]) {
        if (!node.state.isDeviceBirthed(deviceId)) continue;
        try {
          const ddeath = node.buildDdeath(groupId, edgeNodeId, deviceId);
          c.publish(ddeath.topic, ddeath.buffer, { qos: 0, retain: false });
        } catch (err) {
          console.error("[UNS] Sparkplug DDEATH publish failed:", (err as Error)?.message || err);
        }
      }
      birthedMetricsByDevice.clear();

      // NDEATH chủ động (bdSeq hiện tại) — khớp will F3a.
      const ndeath = node.buildNdeath(groupId, edgeNodeId);
      await new Promise<void>((resolve) => {
        c.publish(ndeath.topic, ndeath.buffer, { qos: 0, retain: false }, () => resolve());
      });
    } catch (error) {
      console.error("[UNS] Sparkplug NDEATH publish failed:", (error as Error)?.message || error);
    }
  })();

  // Best-effort: dù publish chậm cũng không chặn shutdown quá timeout.
  await Promise.race([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Đóng kết nối broker UNS (dùng khi shutdown).
 */
export async function shutdownUnsPublisher(): Promise<void> {
  // W2-A1 — stop v2 health sweep + aggregates scheduler (safe when never started).
  stopV2HealthSweep();
  try {
    const m = await import("./uns/unsAggregates");
    m.stopUnsAggregates();
  } catch {
    /* aggregates module unavailable — nothing to stop */
  }
  if (!client) return;
  // F4 HITL — detach the scoped command message listener before closing.
  if (commandMessageHandler) {
    try {
      client.removeListener("message", commandMessageHandler);
    } catch (err) {
      console.error("[UNS] Sparkplug command listener teardown failed:", (err as Error)?.message || err);
    }
    commandMessageHandler = null;
  }
  sparkplugCommandHandler = null;
  await new Promise<void>((resolve) => {
    client!.end(false, {}, () => resolve());
  });
  client = null;
  connected = false;
  sparkplugNode = null;
  birthedMetricsByDevice.clear();
  // W2-A1 — drop v2 dedup/seq state (a fresh connect re-publishes retained state).
  v2SeqByTopic.clear();
  v2LastStateByPath.clear();
  v2LastHealthByAsset.clear();
  v2LastSeenByMachine.clear();
}

export function isUnsPublisherConnected(): boolean {
  return connected;
}
