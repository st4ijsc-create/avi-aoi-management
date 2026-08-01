/**
 * SIMULATOR 1/6 — OPC-UA server ảo (SEMI/OT edge device).
 *
 * Mở một OPC-UA server THẬT (node-opcua đã cài) bind cổng thật (mặc định 4840),
 * expose vài node đọc được: Temperature, Speed, Counter, Status. Giá trị đổi theo
 * thời gian (nhiệt độ dao động quanh setpoint + nhiễu, tốc độ theo trạng thái,
 * counter tăng dần). Driver OPC-UA của hệ thống (ot/deviceAdapter) có thể connect
 * + subscribe THẬT vào server này.
 *
 * Dùng cho scenario link-loss OT-F1: kill process này (launcher `kill <id>`) để
 * connectionSupervisor phát hiện mất link, rồi `start <id>` để nó phục hồi.
 *
 * Chạy độc lập:
 *   node scripts/sim/opcua-server.mjs --port 4840 --id OPCUA-L1
 *   (hoặc qua launcher sim-devices.mjs)
 *
 * Endpoint: opc.tcp://127.0.0.1:<port>/UA/AviSim
 */
import pkg from "node-opcua";
import { parseArgs, opt, makeLogger, gaussian, clamp, onShutdown } from "./lib/util.mjs";

const { OPCUAServer, Variant, DataType, StatusCodes } = pkg;

const args = parseArgs();
const PORT = Number(opt(args, "port", "SIM_PORT", 4840));
const ID = String(opt(args, "id", "SIM_ID", `OPCUA-${PORT}`));
const RESOURCE = String(opt(args, "resource", "SIM_RESOURCE", "/UA/AviSim"));
const log = makeLogger(ID);

// ── Trạng thái mô phỏng (thay đổi theo thời gian) ────────────────────────────
const state = {
  tempC: 42, // nhiệt độ động cơ/buồng (°C)
  tempSet: 42, // setpoint
  speedRpm: 0, // tốc độ trục (rpm)
  counter: 0, // đếm sản phẩm
  running: false, // trạng thái chạy/dừng
  fault: false, // cờ lỗi (bật được qua env để test alarm)
};

let tick = 0;
function evolve() {
  tick++;
  // Chu kỳ chạy/dừng ~ mỗi 20s bật/tắt để driver thấy trạng thái đổi.
  state.running = Math.floor(tick / 20) % 2 === 0 && !state.fault;
  state.tempSet = state.running ? 68 : 40;
  // Nhiệt độ tiệm cận setpoint + nhiễu.
  state.tempC = clamp(state.tempC + (state.tempSet - state.tempC) * 0.1 + gaussian(0.4), 20, 120);
  state.speedRpm = state.running ? clamp(1500 + gaussian(30), 0, 3000) : Math.max(0, state.speedRpm - 200);
  if (state.running && tick % 2 === 0) state.counter++;
}

async function main() {
  const server = new OPCUAServer({
    port: PORT,
    resourcePath: RESOURCE,
    buildInfo: {
      productName: "AviSim-OPCUA",
      buildNumber: "1",
      buildDate: new Date(),
    },
  });

  await server.initialize();
  const addressSpace = server.engine.addressSpace;
  const namespace = addressSpace.getOwnNamespace();

  const device = namespace.addObject({
    organizedBy: addressSpace.rootFolder.objects,
    browseName: "SimMachine",
  });

  const variant = (dataType, get) => ({
    get: () => new Variant({ dataType, value: get() }),
    statusCode: StatusCodes.Good,
  });
  // minimumSamplingInterval để node-opcua không cảnh báo W30 khi có getter động.
  const SAMPLING = { minimumSamplingInterval: 1000 };

  namespace.addVariable({
    componentOf: device,
    browseName: "Temperature",
    nodeId: `ns=1;s=Temperature`,
    dataType: "Double",
    ...SAMPLING,
    value: variant(DataType.Double, () => Number(state.tempC.toFixed(2))),
  });
  namespace.addVariable({
    componentOf: device,
    browseName: "Speed",
    nodeId: `ns=1;s=Speed`,
    dataType: "Double",
    ...SAMPLING,
    value: variant(DataType.Double, () => Number(state.speedRpm.toFixed(1))),
  });
  namespace.addVariable({
    componentOf: device,
    browseName: "Counter",
    nodeId: `ns=1;s=Counter`,
    dataType: "UInt32",
    ...SAMPLING,
    value: variant(DataType.UInt32, () => state.counter >>> 0),
  });
  namespace.addVariable({
    componentOf: device,
    browseName: "Status",
    nodeId: `ns=1;s=Status`,
    dataType: "String",
    ...SAMPLING,
    value: variant(DataType.String, () => (state.fault ? "FAULT" : state.running ? "RUNNING" : "IDLE")),
  });
  namespace.addVariable({
    componentOf: device,
    browseName: "Running",
    nodeId: `ns=1;s=Running`,
    dataType: "Boolean",
    ...SAMPLING,
    value: variant(DataType.Boolean, () => state.running),
  });

  const evolveTimer = setInterval(evolve, 1000);
  evolveTimer.unref?.();

  await server.start();
  const endpoint = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
  log(`OPC-UA server ready → ${endpoint} (nodes: Temperature/Speed/Counter/Status/Running)`);

  onShutdown(async () => {
    clearInterval(evolveTimer);
    log("shutting down OPC-UA server…");
    await server.shutdown(500);
  });
}

main().catch((err) => {
  log(`FATAL: ${err?.message ?? err}`);
  process.exit(1);
});
