/**
 * SIMULATOR 6/6 — Telemetry/sensor generator (PdM) qua MQTT.
 *
 * Publish theo ĐÚNG convention của sensorIngestService:
 *   factory/{factoryId}/{machineCode}/sensor/{sensorType}
 * Payload JSON { value, unit, timestamp }. Data chảy THẬT qua broker Aedes →
 * mqttService.processAedesPublish → sensorIngestService → machine_sensor_readings
 * (khi cờ PDM_SENSOR_INGEST_ENABLED=true và machineCode khớp machines.code).
 *
 * Mỗi sensorType = baseline + trend + nhiễu Gaussian. CHÈN ĐƯỢC SỰ CỐ để test PdM:
 *   --fault spike   → bơm gai transient định kỳ (sau --faultAt giây)
 *   --fault drift   → baseline trôi tăng dần (mô phỏng mòn vòng bi)
 *   --fault none    → chỉ nhiễu quanh baseline (mặc định)
 * Có thể bật sự cố lúc chạy bằng tín hiệu SIGUSR2 (nơi hỗ trợ).
 *
 * Chạy độc lập:
 *   node scripts/sim/sensor-generator.mjs --url mqtt://127.0.0.1:1883 \
 *        --factory 1 --machine SMT-01 --sensors vibration,current,temperature \
 *        --fault drift --faultAt 30
 */
import mqtt from "mqtt";
import { parseArgs, opt, makeLogger, gaussian, clamp, onShutdown } from "./lib/util.mjs";

const args = parseArgs();
const URL = String(opt(args, "url", "SIM_MQTT_URL", "mqtt://127.0.0.1:1883"));
const FACTORY = String(opt(args, "factory", "SIM_FACTORY", "1"));
const MACHINE = String(opt(args, "machine", "SIM_MACHINE", "SMT-01"));
const SENSORS = String(opt(args, "sensors", "SIM_SENSORS", "vibration,current,temperature")).split(",").map((s) => s.trim()).filter(Boolean);
const INTERVAL_MS = Number(opt(args, "intervalMs", "SIM_INTERVAL_MS", 1000));
const FAULT = String(opt(args, "fault", "SIM_FAULT", "none")); // none | spike | drift
const FAULT_AT = Number(opt(args, "faultAt", "SIM_FAULT_AT", 20)); // giây trước khi sự cố bắt đầu
const ID = String(opt(args, "id", "SIM_ID", `SENSOR-${MACHINE}`));
const log = makeLogger(ID);

// Cấu hình cơ bản cho từng loại sensor: [baseline, sigma, unit].
const PROFILE = {
  vibration: { base: 2.5, sigma: 0.25, unit: "mm/s" },
  current: { base: 12.0, sigma: 0.6, unit: "A" },
  temperature: { base: 55.0, sigma: 0.8, unit: "C" },
  pressure: { base: 4.2, sigma: 0.1, unit: "bar" },
};

const startedAt = Date.now();
let faultActive = FAULT !== "none" ? false : false; // bật khi qua FAULT_AT
let spikeSamplesLeft = 0;

// Cho phép bật sự cố lúc chạy (nếu OS hỗ trợ SIGUSR2).
try {
  process.on("SIGUSR2", () => {
    faultActive = true;
    log(`SIGUSR2 → fault '${FAULT === "none" ? "spike" : FAULT}' activated`);
  });
} catch {
  /* Windows có thể không hỗ trợ — bỏ qua */
}

function elapsedSec() {
  return (Date.now() - startedAt) / 1000;
}

function valueFor(type) {
  const p = PROFILE[type] ?? { base: 1, sigma: 0.1, unit: "" };
  let v = p.base + gaussian(p.sigma);

  const faulting = faultActive || (FAULT !== "none" && elapsedSec() >= FAULT_AT);
  if (faulting) {
    const mode = FAULT === "none" ? "spike" : FAULT;
    if (mode === "drift") {
      // Trôi tuyến tính: +sau mỗi giây kể từ khi bắt đầu sự cố.
      const t = elapsedSec() - FAULT_AT;
      v += p.base * 0.02 * Math.max(0, t); // ~ +2% baseline mỗi giây
    } else if (mode === "spike") {
      // Bơm gai: định kỳ bật một chuỗi mẫu vọt lên cao.
      if (spikeSamplesLeft <= 0 && Math.random() < 0.08) spikeSamplesLeft = 3 + Math.floor(Math.random() * 3);
      if (spikeSamplesLeft > 0) {
        v += p.base * (2.5 + Math.random());
        spikeSamplesLeft--;
      }
    }
  }
  return { value: Number(clamp(v, 0, p.base * 20).toFixed(3)), unit: p.unit };
}

const client = mqtt.connect(URL, {
  clientId: `avisim-sensor-${MACHINE}-${Date.now()}`,
  clean: true,
  reconnectPeriod: 3000,
  connectTimeout: 15000,
});

let timer = null;

client.on("connect", () => {
  log(`connected ${URL} → factory/${FACTORY}/${MACHINE}/sensor/{${SENSORS.join(",")}} every ${INTERVAL_MS}ms (fault=${FAULT}@${FAULT_AT}s)`);
  if (!timer) {
    timer = setInterval(() => {
      const ts = new Date().toISOString();
      for (const type of SENSORS) {
        const { value, unit } = valueFor(type);
        const topic = `factory/${FACTORY}/${MACHINE}/sensor/${type}`;
        client.publish(topic, JSON.stringify({ value, unit, timestamp: ts }), { qos: 0, retain: false });
      }
    }, INTERVAL_MS);
    timer.unref?.();
  }
});

client.on("error", (err) => log(`mqtt error: ${err?.message ?? err}`));
client.on("reconnect", () => log("reconnecting to broker…"));

onShutdown(async () => {
  if (timer) clearInterval(timer);
  log("stopping sensor generator…");
  await new Promise((resolve) => client.end(false, {}, resolve));
});
