/**
 * SIMULATOR 2/6 — Modbus TCP slave ảo (PLC/IO edge device).
 *
 * Mở một Modbus TCP server (slave) THẬT bằng `modbus-serial` (ServerTCP đã cài),
 * bind cổng thật (mặc định 5020). Holding registers + input registers đổi giá trị
 * theo thời gian; coils phản ánh trạng thái chạy. Driver Modbus của hệ thống có
 * thể poll THẬT các register này.
 *
 * Bản đồ register (unit id mặc định 1):
 *   HR[0]  Temperature ×10 (°C, vd 685 = 68.5°C)
 *   HR[1]  Speed (rpm)
 *   HR[2]  Counter low 16-bit
 *   HR[3]  Counter high 16-bit
 *   HR[4]  Pressure ×100 (bar)
 *   IR[0]  Status code (0 idle, 1 running, 2 fault)
 *   Coil[0] Running
 *   Coil[1] Fault
 *
 * Chạy độc lập:
 *   node scripts/sim/modbus-slave.mjs --port 5020 --id MODBUS-L1 --unit 1
 */
import pkg from "modbus-serial";
import { parseArgs, opt, makeLogger, gaussian, clamp, onShutdown } from "./lib/util.mjs";

const ServerTCP = pkg.ServerTCP ?? pkg.default?.ServerTCP;

const args = parseArgs();
const PORT = Number(opt(args, "port", "SIM_PORT", 5020));
const HOST = String(opt(args, "host", "SIM_HOST", "0.0.0.0"));
const ID = String(opt(args, "id", "SIM_ID", `MODBUS-${PORT}`));
const UNIT = Number(opt(args, "unit", "SIM_UNIT", 1));
const log = makeLogger(ID);

if (typeof ServerTCP !== "function") {
  log("FATAL: modbus-serial ServerTCP không khả dụng");
  process.exit(1);
}

// ── Trạng thái mô phỏng ──────────────────────────────────────────────────────
const state = { tempC: 40, speedRpm: 0, counter: 0, pressure: 1.0, running: false, fault: false };
let tick = 0;
function evolve() {
  tick++;
  state.running = Math.floor(tick / 20) % 2 === 0 && !state.fault;
  const set = state.running ? 68 : 38;
  state.tempC = clamp(state.tempC + (set - state.tempC) * 0.1 + gaussian(0.3), 15, 120);
  state.speedRpm = state.running ? clamp(1200 + gaussian(25), 0, 3000) : Math.max(0, state.speedRpm - 150);
  state.pressure = clamp((state.running ? 4.2 : 1.0) + gaussian(0.05), 0, 10);
  if (state.running && tick % 2 === 0) state.counter = (state.counter + 1) >>> 0;
}
const evolveTimer = setInterval(evolve, 1000);
evolveTimer.unref?.();

function statusCode() {
  return state.fault ? 2 : state.running ? 1 : 0;
}

// Vector: các hàm slave trả giá trị hiện tại. modbus-serial gọi cb(null, value)
// hoặc trả value trực tiếp (đồng bộ). Ta dùng dạng đồng bộ trả thẳng.
const vector = {
  getHoldingRegister(addr) {
    switch (addr) {
      case 0: return Math.round(state.tempC * 10);
      case 1: return Math.round(state.speedRpm);
      case 2: return state.counter & 0xffff;
      case 3: return (state.counter >>> 16) & 0xffff;
      case 4: return Math.round(state.pressure * 100);
      default: return 0;
    }
  },
  getInputRegister(addr) {
    if (addr === 0) return statusCode();
    return 0;
  },
  getCoil(addr) {
    if (addr === 0) return state.running;
    if (addr === 1) return state.fault;
    return false;
  },
  setRegister(addr, value) {
    // Cho phép host ghi setpoint (chỉ ghi log — mô phỏng, không actuate thật).
    log(`host wrote HR[${addr}] = ${value}`);
  },
  setCoil(addr, value) {
    if (addr === 1) state.fault = !!value;
    log(`host wrote Coil[${addr}] = ${value}`);
  },
};

const server = new ServerTCP(vector, { host: HOST, port: PORT, unitID: UNIT, debug: false });

server.on("socketError", (err) => log(`socket error: ${err?.message ?? err}`));
server.on("error", (err) => log(`server error: ${err?.message ?? err}`));

// ServerTCP bind bất đồng bộ; log khi 'initialized' (một số version emit sự kiện này).
let announced = false;
const announce = () => {
  if (announced) return;
  announced = true;
  log(`Modbus TCP slave ready → tcp://${HOST}:${PORT} unit=${UNIT} (HR0..4/IR0/Coil0..1)`);
};
server.on("initialized", announce);
// Fallback nếu version không emit 'initialized'.
setTimeout(announce, 300).unref?.();

onShutdown(async () => {
  clearInterval(evolveTimer);
  log("shutting down Modbus slave…");
  await new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
});
