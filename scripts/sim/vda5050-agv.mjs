/**
 * SIMULATOR 5/6 — AGV/AMR ảo nói VDA 5050 v2 qua MQTT.
 *
 * Kết nối tới MQTT broker NỘI BỘ của hệ thống (Aedes, mặc định mqtt://127.0.0.1:1883)
 * và nói protocol VDA 5050 v2 THẬT:
 *   • publish `connection` = ONLINE (retain) + đặt LWT = CONNECTIONBROKEN;
 *   • publish `state` ~1Hz (pose, battery, driving, operatingMode, errors…);
 *   • subscribe `order` + `instantActions`; khi nhận Order → lái dần tới node đích,
 *     cập nhật lastNodeId + actionStates; khi nhận cancelOrder/stopPause → phản hồi.
 * Vda5050RobotDriver của hệ thống subscribe state/connection để bơm vào robot_telemetry.
 *
 * Topic: <iface>/v2/<manufacturer>/<serialNumber>/{state|connection|order|instantActions}
 *
 * Chạy độc lập:
 *   node scripts/sim/vda5050-agv.mjs --url mqtt://127.0.0.1:1883 --manufacturer st4i --serial AGV01
 */
import mqtt from "mqtt";
import { parseArgs, opt, makeLogger, clamp, onShutdown } from "./lib/util.mjs";

const args = parseArgs();
const URL = String(opt(args, "url", "SIM_MQTT_URL", "mqtt://127.0.0.1:1883"));
const IFACE = String(opt(args, "iface", "SIM_IFACE", "uagv"));
const MANU = String(opt(args, "manufacturer", "SIM_MANUFACTURER", "st4i"));
const SERIAL = String(opt(args, "serial", "SIM_SERIAL", "AGV01"));
const ID = String(opt(args, "id", "SIM_ID", `AGV-${SERIAL}`));
const STATE_MS = Number(opt(args, "stateMs", "SIM_STATE_MS", 1000));
const log = makeLogger(ID);

const base = `${IFACE}/v2/${MANU}/${SERIAL}`;
const T = { state: `${base}/state`, connection: `${base}/connection`, order: `${base}/order`, instant: `${base}/instantActions` };

let headerId = 0;
function head() {
  return { headerId: headerId++, timestamp: new Date().toISOString(), version: "2.0.0", manufacturer: MANU, serialNumber: SERIAL };
}

// ── Trạng thái AGV mô phỏng ──────────────────────────────────────────────────
const agv = {
  x: 0,
  y: 0,
  theta: 0,
  target: null, // { x, y }
  battery: 87,
  charging: false,
  driving: false,
  paused: false,
  orderId: "",
  orderUpdateId: 0,
  lastNodeId: "",
  lastNodeSeq: 0,
  actionStates: [],
  errors: [],
  eStop: "NONE",
};

function buildState() {
  return {
    ...head(),
    orderId: agv.orderId,
    orderUpdateId: agv.orderUpdateId,
    lastNodeId: agv.lastNodeId,
    lastNodeSequenceId: agv.lastNodeSeq,
    operatingMode: "AUTOMATIC",
    driving: agv.driving,
    paused: agv.paused,
    agvPosition: { x: Number(agv.x.toFixed(3)), y: Number(agv.y.toFixed(3)), theta: Number(agv.theta.toFixed(3)), mapId: "map0", positionInitialized: true, localizationScore: 0.98 },
    velocity: { vx: agv.driving ? 0.5 : 0, vy: 0, omega: 0 },
    batteryState: { batteryCharge: Number(agv.battery.toFixed(1)), charging: agv.charging, batteryVoltage: 48, batteryHealth: 97 },
    errors: agv.errors,
    actionStates: agv.actionStates,
    safetyState: { eStop: agv.eStop, fieldViolation: false },
    nodeStates: [],
    edgeStates: [],
  };
}

const client = mqtt.connect(URL, {
  clientId: `avisim-agv-${SERIAL}-${Date.now()}`,
  clean: true,
  reconnectPeriod: 3000,
  connectTimeout: 15000,
  // LWT: nếu AGV rớt đột ngột, broker publish CONNECTIONBROKEN thay AGV.
  will: {
    topic: T.connection,
    payload: JSON.stringify({ ...head(), connectionState: "CONNECTIONBROKEN" }),
    qos: 1,
    retain: true,
  },
});

let stateTimer = null;
let moveTimer = null;

client.on("connect", () => {
  log(`connected to broker ${URL}`);
  client.publish(T.connection, JSON.stringify({ ...head(), connectionState: "ONLINE" }), { qos: 1, retain: true });
  client.subscribe([T.order, T.instant], (err) => {
    if (err) log(`subscribe error: ${err.message}`);
    else log(`subscribed ${T.order} + ${T.instant}`);
  });

  if (!stateTimer) {
    stateTimer = setInterval(() => {
      // Pin xả khi chạy, sạc khi rảnh.
      agv.battery = clamp(agv.battery + (agv.driving ? -0.05 : 0.02), 5, 100);
      client.publish(T.state, JSON.stringify(buildState()), { qos: 0, retain: false });
    }, STATE_MS);
    stateTimer.unref?.();
  }
  if (!moveTimer) {
    moveTimer = setInterval(stepMotion, 500);
    moveTimer.unref?.();
  }
});

client.on("error", (err) => log(`mqtt error: ${err?.message ?? err}`));
client.on("reconnect", () => log("reconnecting to broker…"));

client.on("message", (topic, payload) => {
  let msg;
  try {
    msg = JSON.parse(payload.toString());
  } catch {
    return;
  }
  if (topic === T.order) handleOrder(msg);
  else if (topic === T.instant) handleInstant(msg);
});

function handleOrder(order) {
  agv.orderId = String(order.orderId ?? "");
  agv.orderUpdateId = Number(order.orderUpdateId ?? 0);
  const nodes = Array.isArray(order.nodes) ? order.nodes : [];
  const last = nodes[nodes.length - 1];
  if (last?.nodePosition) {
    agv.target = { x: Number(last.nodePosition.x), y: Number(last.nodePosition.y) };
    agv.driving = true;
    agv.paused = false;
  }
  // Ghi nhận actions ở trạng thái WAITING.
  agv.actionStates = nodes.flatMap((n) => (n.actions ?? []).map((a) => ({ actionId: a.actionId, actionType: a.actionType, actionStatus: "WAITING" })));
  log(`ORDER ${agv.orderId} (${nodes.length} nodes) → driving to (${agv.target?.x ?? "?"}, ${agv.target?.y ?? "?"})`);
}

function handleInstant(msg) {
  const actions = Array.isArray(msg.actions) ? msg.actions : [];
  for (const a of actions) {
    const t = String(a.actionType ?? "").toLowerCase();
    if (t === "cancelorder") {
      agv.driving = false;
      agv.target = null;
      agv.actionStates = agv.actionStates.map((s) => ({ ...s, actionStatus: "FAILED", resultDescription: "cancelled" }));
      log(`instantAction cancelOrder → stopped`);
    } else if (t === "stoppause" || t === "startpause") {
      agv.paused = t === "stoppause";
      agv.driving = !agv.paused && !!agv.target;
      log(`instantAction ${a.actionType} → paused=${agv.paused}`);
    } else if (t === "startcharging") {
      agv.charging = true;
      log(`instantAction startCharging`);
    } else {
      log(`instantAction ${a.actionType} (ack)`);
    }
  }
}

function stepMotion() {
  if (!agv.driving || agv.paused || !agv.target) return;
  const dx = agv.target.x - agv.x;
  const dy = agv.target.y - agv.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.1) {
    agv.x = agv.target.x;
    agv.y = agv.target.y;
    agv.driving = false;
    agv.target = null;
    agv.lastNodeId = `n-${Date.now() % 10000}`;
    agv.lastNodeSeq++;
    agv.actionStates = agv.actionStates.map((s) => ({ ...s, actionStatus: "FINISHED" }));
    log(`arrived at (${agv.x.toFixed(2)}, ${agv.y.toFixed(2)}) — order ${agv.orderId} complete`);
    return;
  }
  const step = 0.25; // m mỗi 0.5s ≈ 0.5 m/s
  agv.theta = Math.atan2(dy, dx);
  agv.x += (dx / dist) * step;
  agv.y += (dy / dist) * step;
}

onShutdown(async () => {
  if (stateTimer) clearInterval(stateTimer);
  if (moveTimer) clearInterval(moveTimer);
  log("publishing OFFLINE + disconnecting…");
  try {
    client.publish(T.connection, JSON.stringify({ ...head(), connectionState: "OFFLINE" }), { qos: 1, retain: true });
  } catch {
    /* ignore */
  }
  await new Promise((resolve) => client.end(false, {}, resolve));
});
