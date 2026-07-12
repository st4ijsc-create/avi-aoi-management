/**
 * LAUNCHER — dựng "nhà máy ảo": spawn đồng thời N simulator thiết bị theo config
 * (scripts/sim/devices.config.json). Mỗi thiết bị = 1 process con độc lập, bind
 * cổng/broker THẬT, nên có thể kill/khởi động lại từng cái để chạy kịch bản phá
 * hoại (link-loss OT-F1, AGV connection-broken, PdM fault injection…).
 *
 * DÙNG:
 *   node scripts/sim/sim-devices.mjs                       # chạy toàn bộ config
 *   node scripts/sim/sim-devices.mjs --config path.json    # config khác
 *   node scripts/sim/sim-devices.mjs --only hsms,sensor    # lọc theo type
 *   node scripts/sim/sim-devices.mjs --url mqtt://host:1883 # override broker
 *
 * LỆNH TƯƠNG TÁC (gõ vào stdin khi đang chạy):
 *   list                  liệt kê thiết bị + pid + trạng thái
 *   kill <id>             HẠ một thiết bị (mô phỏng mất kết nối đột ngột)
 *   start <id>            khởi động lại thiết bị đã hạ
 *   restart <id>          hạ rồi bật lại
 *   fault <id> [spike|drift]  bật lại sensor với sự cố (test PdM)
 *   quit                  tắt sạch tất cả rồi thoát
 *
 * Không đụng .env production; simulator chỉ đọc tham số CLI/env truyền vào.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";
import { parseArgs, makeLogger } from "./lib/util.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = makeLogger("launcher");
const args = parseArgs();

// type → { file, runner }. runner='tsx' cho file .ts (import codec TS của server).
const TYPES = {
  opcua: { file: "opcua-server.mjs", runner: "node", mqtt: false },
  modbus: { file: "modbus-slave.mjs", runner: "node", mqtt: false },
  hsms: { file: "hsms-equipment.ts", runner: "tsx", mqtt: false },
  mtconnect: { file: "mtconnect-agent.mjs", runner: "node", mqtt: false },
  vda5050: { file: "vda5050-agv.mjs", runner: "node", mqtt: true },
  sensor: { file: "sensor-generator.mjs", runner: "node", mqtt: true },
};

const configPath = args.config ? String(args.config) : path.join(__dirname, "devices.config.json");
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (err) {
  log.error(`không đọc được config ${configPath}: ${err?.message ?? err}`);
  process.exit(1);
}

const mqttUrl = args.url ? String(args.url) : config.mqttUrl || "mqtt://127.0.0.1:1883";
const onlyTypes = args.only ? String(args.only).split(",").map((s) => s.trim()) : null;

// Danh sách thiết bị đã lọc.
const defs = (config.devices || []).filter((d) => {
  if (d.enabled === false) return false;
  if (onlyTypes && !onlyTypes.includes(d.type)) return false;
  if (!TYPES[d.type]) {
    log.warn(`bỏ qua device '${d.id}' — type '${d.type}' không hỗ trợ`);
    return false;
  }
  return true;
});

if (defs.length === 0) {
  log.error("không có thiết bị nào để chạy (kiểm tra config / --only)");
  process.exit(1);
}

/** Chuyển 1 def config → mảng CLI args cho simulator con. */
function buildArgs(def, overrides = {}) {
  const merged = { ...def, ...overrides };
  const meta = TYPES[def.type];
  const out = ["--id", String(def.id)];
  for (const [k, v] of Object.entries(merged)) {
    if (k === "type" || k === "id" || k === "enabled") continue;
    out.push(`--${k}`, String(v));
  }
  if (meta.mqtt) out.push("--url", mqttUrl);
  return out;
}

/** Câu lệnh spawn (Node chạy .mjs; `node --import tsx` chạy .ts). */
function spawnCmd(def, overrides = {}) {
  const meta = TYPES[def.type];
  const file = path.join(__dirname, meta.file);
  const childArgs = buildArgs(def, overrides);
  const nodeArgs = meta.runner === "tsx" ? ["--import", "tsx", file, ...childArgs] : [file, ...childArgs];
  return { cmd: process.execPath, nodeArgs };
}

/** Trạng thái mỗi thiết bị. */
const registry = new Map(); // id → { def, child, intentionalStop, overrides }

function spawnDevice(def, overrides = {}) {
  const { cmd, nodeArgs } = spawnCmd(def, overrides);
  const child = spawn(cmd, nodeArgs, { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
  const entry = registry.get(def.id) || { def };
  entry.def = def;
  entry.child = child;
  entry.intentionalStop = false;
  entry.overrides = overrides;
  registry.set(def.id, entry);

  const where = def.port ? `port ${def.port}` : TYPES[def.type].mqtt ? `broker ${mqttUrl}` : "-";
  log.info(`started ${def.id} (${def.type}) pid=${child.pid} on ${where}`);

  child.on("exit", (code, signal) => {
    const e = registry.get(def.id);
    if (!e) return;
    e.child = null;
    if (e.intentionalStop || shuttingDown) {
      if (!shuttingDown) log.info(`${def.id} stopped (intentional)`);
    } else {
      log.warn(`${def.id} exited unexpectedly (code=${code} signal=${signal})`);
    }
  });
  child.on("error", (err) => log.error(`${def.id} spawn error: ${err?.message ?? err}`));
}

// ── Khởi động toàn bộ ────────────────────────────────────────────────────────
log.info(`config=${configPath} broker=${mqttUrl} — spawning ${defs.length} thiết bị…`);
for (const def of defs) spawnDevice(def);
log.info("tất cả đã spawn. Gõ 'help' để xem lệnh, 'quit' để thoát.");

// ── Lệnh tương tác qua stdin ─────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function killDevice(id, cb) {
  const e = registry.get(id);
  if (!e || !e.child) {
    log.warn(`${id}: chưa chạy`);
    cb?.();
    return;
  }
  e.intentionalStop = true;
  const child = e.child;
  const done = () => cb?.();
  child.once("exit", done);
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  // Ép chết sau 3s nếu chưa thoát.
  const t = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 3000);
  t.unref?.();
}

rl.on("line", (line) => {
  const [cmd, id, extra] = line.trim().split(/\s+/);
  switch (cmd) {
    case "":
      break;
    case "help":
      log.info("lệnh: list | kill <id> | start <id> | restart <id> | fault <id> [spike|drift] | quit");
      break;
    case "list": {
      const rows = [...registry.values()].map((e) => `  ${e.def.id.padEnd(12)} ${e.def.type.padEnd(10)} ${e.child ? `up pid=${e.child.pid}` : "DOWN"}`);
      log.info(`thiết bị (${registry.size}):\n${rows.join("\n")}`);
      break;
    }
    case "kill":
      if (!id) return log.warn("dùng: kill <id>");
      killDevice(id);
      break;
    case "start": {
      if (!id) return log.warn("dùng: start <id>");
      const e = registry.get(id);
      if (!e) return log.warn(`không có device '${id}'`);
      if (e.child) return log.warn(`${id} đang chạy`);
      spawnDevice(e.def, e.overrides || {});
      break;
    }
    case "restart": {
      if (!id) return log.warn("dùng: restart <id>");
      const e = registry.get(id);
      if (!e) return log.warn(`không có device '${id}'`);
      killDevice(id, () => setTimeout(() => spawnDevice(e.def, e.overrides || {}), 300));
      break;
    }
    case "fault": {
      if (!id) return log.warn("dùng: fault <id> [spike|drift]");
      const e = registry.get(id);
      if (!e) return log.warn(`không có device '${id}'`);
      if (e.def.type !== "sensor") return log.warn(`${id} không phải sensor`);
      const mode = extra === "drift" ? "drift" : "spike";
      log.info(`bật lại ${id} với fault=${mode} (faultAt=0)`);
      killDevice(id, () => setTimeout(() => spawnDevice(e.def, { fault: mode, faultAt: 0 }), 300));
      break;
    }
    case "quit":
    case "exit":
    case "stop":
      shutdown();
      break;
    default:
      log.warn(`lệnh không rõ: '${cmd}' (gõ 'help')`);
  }
});

// ── Tắt sạch ─────────────────────────────────────────────────────────────────
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("đang tắt tất cả thiết bị…");
  const children = [...registry.values()].map((e) => e.child).filter(Boolean);
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  const hard = setTimeout(() => {
    for (const c of children) {
      try {
        c.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  }, 3500);
  hard.unref?.();
  // Thoát sớm khi mọi con đã chết.
  const check = setInterval(() => {
    if ([...registry.values()].every((e) => !e.child)) {
      clearInterval(check);
      clearTimeout(hard);
      log.info("xong.");
      process.exit(0);
    }
  }, 150);
  check.unref?.();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
