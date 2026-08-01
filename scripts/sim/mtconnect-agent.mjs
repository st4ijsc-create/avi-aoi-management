/**
 * SIMULATOR 4/6 — MTConnect Agent ảo (CNC / máy công cụ, ANSI/MTC1.4).
 *
 * Mở một HTTP server THẬT (mặc định 5001) expose 3 endpoint XML chuẩn MTConnect:
 *   GET /probe   → MTConnectDevices (mô hình thiết bị: DataItems)
 *   GET /current → MTConnectStreams (giá trị mới nhất, đổi theo thời gian)
 *   GET /sample  → MTConnectStreams (một cửa sổ lịch sử)
 * mtconnectClient/mtconnectPoller của hệ thống fetch + parse THẬT các endpoint này.
 *
 * Giá trị SAMPLE (Xact, spindle speed) dao động theo thời gian; EVENT (execution,
 * availability) chuyển trạng thái; CONDITION có thể Normal/Fault.
 *
 * Chạy độc lập:
 *   node scripts/sim/mtconnect-agent.mjs --port 5001 --id MTC-L1 --device CNC-01
 */
import http from "node:http";
import { parseArgs, opt, makeLogger, gaussian, clamp, onShutdown } from "./lib/util.mjs";

const args = parseArgs();
const PORT = Number(opt(args, "port", "SIM_PORT", 5001));
const HOST = String(opt(args, "host", "SIM_HOST", "0.0.0.0"));
const ID = String(opt(args, "id", "SIM_ID", `MTC-${PORT}`));
const DEVICE = String(opt(args, "device", "SIM_DEVICE", "CNC-01"));
const UUID = String(opt(args, "uuid", "SIM_UUID", `avi-sim-${DEVICE}`));
const log = makeLogger(ID);

// ── Trạng thái mô phỏng ──────────────────────────────────────────────────────
const state = { xact: 0, spindle: 0, running: false, fault: false, seq: 1 };
let tick = 0;
function evolve() {
  tick++;
  state.running = Math.floor(tick / 15) % 2 === 0 && !state.fault;
  state.xact = clamp(state.xact + (state.running ? gaussian(2) + 1 : 0), -200, 200);
  state.spindle = state.running ? clamp(6000 + gaussian(120), 0, 12000) : Math.max(0, state.spindle - 800);
}
const evolveTimer = setInterval(evolve, 1000);
evolveTimer.unref?.();

function nowIso() {
  return new Date().toISOString();
}
function nextSeq() {
  return state.seq++;
}
function header() {
  return `<Header creationTime="${nowIso()}" sender="AviSim" instanceId="1" version="1.4.0" bufferSize="131072" nextSequence="${state.seq}" firstSequence="1" lastSequence="${state.seq}"/>`;
}

function probeXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MTConnectDevices xmlns="urn:mtconnect.org:MTConnectDevices:1.4">
  ${header()}
  <Devices>
    <Device id="dev1" name="${DEVICE}" uuid="${UUID}">
      <DataItems>
        <DataItem id="avail" name="avail" type="AVAILABILITY" category="EVENT"/>
        <DataItem id="estop" name="estop" type="EMERGENCY_STOP" category="EVENT"/>
        <DataItem id="exec" name="exec" type="EXECUTION" category="EVENT"/>
      </DataItems>
      <Components>
        <Axes id="ax" name="Axes">
          <Components>
            <Linear id="x" name="X">
              <DataItems>
                <DataItem id="Xact" name="Xact" type="POSITION" subType="ACTUAL" category="SAMPLE" units="MILLIMETER"/>
              </DataItems>
            </Linear>
            <Rotary id="c" name="C">
              <DataItems>
                <DataItem id="Sspeed" name="Sspeed" type="SPINDLE_SPEED" subType="ACTUAL" category="SAMPLE" units="REVOLUTION/MINUTE"/>
              </DataItems>
            </Rotary>
          </Components>
        </Axes>
        <Systems id="sys" name="systems">
          <DataItems>
            <DataItem id="system_cond" name="system" type="SYSTEM" category="CONDITION"/>
          </DataItems>
        </Systems>
      </Components>
    </Device>
  </Devices>
</MTConnectDevices>`;
}

function streamsXml(sampleWindow) {
  const ts = nowIso();
  const avail = "AVAILABLE";
  const exec = state.running ? "ACTIVE" : "READY";
  const cond = state.fault
    ? `<Fault dataItemId="system_cond" timestamp="${ts}" type="SYSTEM" nativeCode="SIM-500" nativeSeverity="2" qualifier="HIGH">Simulated system fault</Fault>`
    : `<Normal dataItemId="system_cond" timestamp="${ts}" type="SYSTEM"/>`;

  // /sample: phát vài mẫu Position liên tiếp; /current: 1 mẫu mới nhất.
  const posSamples = [];
  const n = sampleWindow ? 5 : 1;
  for (let i = 0; i < n; i++) {
    const v = (state.xact - (n - 1 - i) * 0.5).toFixed(3);
    posSamples.push(`<Position dataItemId="Xact" name="Xact" timestamp="${ts}" sequence="${nextSeq()}" subType="ACTUAL">${v}</Position>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<MTConnectStreams xmlns="urn:mtconnect.org:MTConnectStreams:1.4">
  ${header()}
  <Streams>
    <DeviceStream name="${DEVICE}" uuid="${UUID}">
      <ComponentStream component="Device" name="${DEVICE}" componentId="dev1">
        <Events>
          <Availability dataItemId="avail" timestamp="${ts}" sequence="${nextSeq()}">${avail}</Availability>
          <EmergencyStop dataItemId="estop" timestamp="${ts}" sequence="${nextSeq()}">${state.fault ? "TRIGGERED" : "ARMED"}</EmergencyStop>
          <Execution dataItemId="exec" timestamp="${ts}" sequence="${nextSeq()}">${exec}</Execution>
        </Events>
      </ComponentStream>
      <ComponentStream component="Linear" name="X" componentId="x">
        <Samples>
          ${posSamples.join("\n          ")}
        </Samples>
      </ComponentStream>
      <ComponentStream component="Rotary" name="C" componentId="c">
        <Samples>
          <SpindleSpeed dataItemId="Sspeed" name="Sspeed" timestamp="${ts}" sequence="${nextSeq()}" subType="ACTUAL">${state.spindle.toFixed(1)}</SpindleSpeed>
        </Samples>
      </ComponentStream>
      <ComponentStream component="Systems" name="systems" componentId="sys">
        <Condition>
          ${cond}
        </Condition>
      </ComponentStream>
    </DeviceStream>
  </Streams>
</MTConnectStreams>`;
}

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0].replace(/\/+$/, "") || "/";
  let body = null;
  if (url === "/probe" || url === "/") body = probeXml();
  else if (url === "/current") body = streamsXml(false);
  else if (url === "/sample") body = streamsXml(true);

  if (body == null) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
  res.end(body);
});

server.on("error", (err) => {
  log(`FATAL server error: ${err?.message ?? err}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log(`MTConnect agent ready → http://${HOST}:${PORT}/probe|/current|/sample (device=${DEVICE})`);
});

onShutdown(async () => {
  clearInterval(evolveTimer);
  log("shutting down MTConnect agent…");
  await new Promise((resolve) => server.close(() => resolve()));
});
