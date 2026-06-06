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
import { normalize, isUnsBridgeEnabled } from "./unsBridge";
import { SparkplugNode, type MetricSample } from "./uns/sparkplugNode";

const UNS_BROKER_URL = process.env.UNS_BROKER_URL || "mqtt://localhost:1884";
const UNS_BROKER_USERNAME = process.env.UNS_BROKER_USERNAME || "";
const UNS_BROKER_PASSWORD = process.env.UNS_BROKER_PASSWORD || "";

let client: MqttClient | null = null;
let connected = false;

// --- Sparkplug-B state (F3a) ---
let sparkplugNode: SparkplugNode | null = null;

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
 * F3b (chuẩn bị) — stub đóng node có chủ đích (graceful NDEATH). F3a chưa dùng.
 */
export function publishNdeathGraceful(): void {
  if (!isSparkplugEnabled() || !sparkplugNode || !client || !connected) return;
  try {
    const ndeath = sparkplugNode.buildNdeath(sparkplugGroupId(), sparkplugEdgeNodeId());
    client.publish(ndeath.topic, ndeath.buffer, { qos: 0, retain: false });
  } catch (error) {
    console.error("[UNS] Sparkplug NDEATH publish failed:", (error as Error)?.message || error);
  }
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
}

export function isUnsPublisherConnected(): boolean {
  return connected;
}
