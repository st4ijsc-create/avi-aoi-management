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
}

/**
 * Chuẩn hoá topic gốc và publish các bản UNS/Sparkplug sang broker đích.
 * No-op khi flag tắt hoặc chưa kết nối. An toàn để gọi trong hot path (try/catch nội bộ).
 */
export function publishNormalized(topic: string, payload: unknown): void {
  if (!isUnsBridgeEnabled() || !client || !connected) return;
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
}

export function isUnsPublisherConnected(): boolean {
  return connected;
}
