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
import { normalize, isUnsBridgeEnabled } from "./unsBridge";
import { SparkplugNode, type MetricSample, type MetricDef } from "./uns/sparkplugNode";

const UNS_BROKER_URL = process.env.UNS_BROKER_URL || "mqtt://localhost:1884";
const UNS_BROKER_USERNAME = process.env.UNS_BROKER_USERNAME || "";
const UNS_BROKER_PASSWORD = process.env.UNS_BROKER_PASSWORD || "";

let client: MqttClient | null = null;
let connected = false;

// --- Sparkplug-B state (F3a) ---
let sparkplugNode: SparkplugNode | null = null;

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
