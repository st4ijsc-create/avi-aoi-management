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
 */

import mqtt, { type MqttClient } from "mqtt";
import { normalize, isUnsBridgeEnabled } from "./unsBridge";

const UNS_BROKER_URL = process.env.UNS_BROKER_URL || "mqtt://localhost:1884";
const UNS_BROKER_USERNAME = process.env.UNS_BROKER_USERNAME || "";
const UNS_BROKER_PASSWORD = process.env.UNS_BROKER_PASSWORD || "";

let client: MqttClient | null = null;
let connected = false;

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

  console.log(`[UNS] Connecting to UNS broker ${UNS_BROKER_URL}...`);
  client = mqtt.connect(UNS_BROKER_URL, options);

  client.on("connect", () => {
    connected = true;
    console.log(`[UNS] Connected to UNS broker ${UNS_BROKER_URL}`);
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
 * Đóng kết nối broker UNS (dùng khi shutdown).
 */
export async function shutdownUnsPublisher(): Promise<void> {
  if (!client) return;
  await new Promise<void>((resolve) => {
    client!.end(false, {}, () => resolve());
  });
  client = null;
  connected = false;
}

export function isUnsPublisherConnected(): boolean {
  return connected;
}
