// scripts/sim-factory/simulator.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Doc 40 Wave 3B §13.4 — SIMULATOR THIẾT BỊ "NHÀ MÁY ẢO".
//
// MÔ PHỎNG THẬT (không fake DB): bind CỔNG THẬT, nói PROTOCOL THẬT — server OT gateway
// poll các endpoint này qua ĐÚNG driver (node-opcua / modbus-serial) → ingest thật →
// ot_telemetry thật. Dữ liệu inspection đi qua ĐÚNG REST /api/machine/submit-inspection.
//
// Thành phần:
//   • OPC-UA server RIÊNG cho mỗi line (cổng 4840/4841/4842) — phục vụ nodeId mà
//     device_adapters(opcua) của line trỏ tới. Có thể GIẾT/DỰNG LẠI độc lập từng line
//     → mô phỏng 1 line rớt kết nối (scenario a/d) mà không chạm line khác.
//   • Modbus TCP server (5020) — holding register cho các adapter(modbus), tách theo unitId=line.
//   • MTConnect agent (5001) — /current trả MTConnectStreams XML tối giản (nếu MTCONNECT_SOURCES trỏ vào).
//   • Inspection feeder (tuỳ chọn SIM_INSPECTION_FEED=true) — POST submit-inspection.
//   • HTTP control-plane (4899) — scenario runner ra lệnh phá hoại (kill/restart/ng-spike/burst).
//
// KHÔNG serve s7 / ethernet-ip → các adapter đó là KHUNG: gateway thử connect rồi
// fail-safe "skipped" (honest). Đó là bằng chứng nhánh no-op trung thực.
//
// Chạy:  node scripts/sim-factory/simulator.mjs      (nạp .env.sim tự động)
// Dừng:  Ctrl-C (đóng mọi server sạch).
// ─────────────────────────────────────────────────────────────────────────────
import "./lib/env.mjs";
import http from "node:http";
import { buildTopology, PORTS } from "./topology.mjs";

const APP_BASE = process.env.APP_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const CONTROL_PORT = Number(process.env.SIM_CONTROL_PORT || PORTS.control);
const MODBUS_PORT = Number(process.env.SIM_MODBUS_PORT || PORTS.modbus);
const MTCONNECT_PORT = Number(process.env.SIM_MTCONNECT_PORT || PORTS.mtconnect);
const TICK_MS = Number(process.env.SIM_TICK_MS || 1000);
const INSPECTION_FEED = process.env.SIM_INSPECTION_FEED === "true";
const INSPECTION_MS = Number(process.env.SIM_INSPECTION_INTERVAL_MS || 5000);

const topo = buildTopology();

// ── STATE: giá trị hiện tại theo line ────────────────────────────────────────
// state.line[lineNo] = { running, tags: { [nodeId|regAddr]: value }, ngSpike: number|null }
const state = {};
for (const line of topo.lines) {
  const tags = {};
  const opcuaTags = [];
  const modbusTags = [];
  for (const m of line.machines) {
    if (!m.adapter) continue;
    for (const t of m.adapter.tags) {
      const init = initialValue(t);
      if (m.adapter.transport === "opcua-line") {
        tags[t.addr] = init;
        opcuaTags.push({ ...t });
      } else if (m.adapter.transport === "modbus") {
        const reg = modbusOffset(t.addr);
        tags[`m:${reg}`] = init;
        modbusTags.push({ ...t, reg });
      }
    }
  }
  state[line.lineNo] = { running: true, tags, ngSpike: null, opcuaTags, modbusTags, line };
}

function initialValue(t) {
  switch (t.behavior) {
    case "running":
      return true;
    case "counter":
      return 0;
    case "static":
      return t.value ?? 0;
    case "ng_rate":
    case "noisy":
    default:
      return t.base ?? 0;
  }
}

function modbusOffset(addr) {
  const n = parseInt(String(addr), 10);
  if (n >= 40001 && n <= 49999) return n - 40001; // holding
  if (n >= 30001 && n <= 39999) return n - 30001; // input
  return n; // đã 0-based
}

function rnd(base, jitter) {
  return base + (Math.random() * 2 - 1) * jitter;
}

// ── TICK: tiến hoá giá trị mỗi TICK_MS ───────────────────────────────────────
function tick() {
  for (const line of topo.lines) {
    const s = state[line.lineNo];
    if (!s.running) continue; // line "stopped" → freeze (nhưng OPC-UA server đã bị kill riêng)
    for (const t of s.opcuaTags) {
      s.tags[t.addr] = nextValue(t, s.tags[t.addr], s);
    }
    for (const t of s.modbusTags) {
      s.tags[`m:${t.reg}`] = Math.round(nextValue(t, s.tags[`m:${t.reg}`], s));
    }
  }
}

function nextValue(t, cur, s) {
  switch (t.behavior) {
    case "running":
      return s.running;
    case "counter":
      return (cur ?? 0) + (t.step ?? 0);
    case "static":
      return t.value ?? cur ?? 0;
    case "ng_rate":
      return s.ngSpike != null ? s.ngSpike : Math.max(0, rnd(t.base, t.jitter));
    case "noisy":
      return rnd(t.base, t.jitter);
    default:
      return cur ?? 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPC-UA server per-line (node-opcua). Bọc trong class để kill/restart độc lập.
// ═══════════════════════════════════════════════════════════════════════════
let opcua = null;
try {
  opcua = await import("node-opcua");
} catch (e) {
  console.warn("[sim/opcua] node-opcua không nạp được → BỎ QUA OPC-UA:", e?.message ?? e);
}

class LineOpcuaServer {
  constructor(line) {
    this.line = line;
    this.server = null;
    this.status = "stopped";
  }

  async start() {
    if (!opcua) return;
    const { OPCUAServer, DataType, Variant } = opcua;
    const s = state[this.line.lineNo];
    const server = new OPCUAServer({
      port: this.line.opcuaPort,
      resourcePath: "/UA/SIM",
      buildInfo: { productName: `SIM-${this.line.code}`, buildNumber: "1", buildDate: new Date() },
    });
    await server.initialize();
    const addressSpace = server.engine.addressSpace;
    const ns = addressSpace.getOwnNamespace(); // ns=1
    const device = ns.addObject({
      organizedBy: addressSpace.rootFolder.objects,
      browseName: this.line.code,
    });
    for (const t of s.opcuaTags) {
      const dt = t.dataType === "bool" ? DataType.Boolean : t.dataType === "int" ? DataType.Int32 : DataType.Double;
      ns.addVariable({
        componentOf: device,
        browseName: t.key,
        nodeId: t.addr, // "ns=1;s=conveyor.running"
        dataType: t.dataType === "bool" ? "Boolean" : t.dataType === "int" ? "Int32" : "Double",
        minimumSamplingInterval: 1000, // khớp getter → tránh cảnh báo NODE-OPCUA-W30
        value: {
          get: () => {
            const v = s.tags[t.addr];
            if (t.dataType === "int") return new Variant({ dataType: dt, value: Math.round(Number(v) || 0) });
            if (t.dataType === "bool") return new Variant({ dataType: dt, value: Boolean(v) });
            return new Variant({ dataType: dt, value: Number(v) || 0 });
          },
        },
      });
    }
    await server.start();
    this.server = server;
    this.status = "running";
    console.log(`[sim/opcua] ${this.line.code} server LIVE @ opc.tcp://127.0.0.1:${this.line.opcuaPort}/UA/SIM (${s.opcuaTags.length} nodes)`);
  }

  async stop() {
    if (!this.server) {
      this.status = "stopped";
      return;
    }
    try {
      await this.server.shutdown(0);
    } catch (e) {
      console.warn(`[sim/opcua] ${this.line.code} shutdown lỗi:`, e?.message ?? e);
    }
    this.server = null;
    this.status = "stopped";
    console.log(`[sim/opcua] ${this.line.code} server ĐÃ DỪNG (mô phỏng rớt kết nối).`);
  }

  async restart() {
    await this.stop();
    await this.start();
  }
}

const opcuaServers = {};
for (const line of topo.lines) opcuaServers[line.lineNo] = new LineOpcuaServer(line);

// ═══════════════════════════════════════════════════════════════════════════
// Modbus TCP server (modbus-serial ServerTCP) — dùng chung, tách theo unitID.
// ═══════════════════════════════════════════════════════════════════════════
let modbusServer = null;
async function startModbus() {
  let ServerTCP;
  try {
    const mod = await import("modbus-serial");
    ServerTCP = mod.ServerTCP ?? mod.default?.ServerTCP ?? mod.default?.default?.ServerTCP;
  } catch (e) {
    console.warn("[sim/modbus] modbus-serial không nạp được → BỎ QUA Modbus:", e?.message ?? e);
    return;
  }
  if (typeof ServerTCP !== "function") {
    console.warn("[sim/modbus] ServerTCP không khả dụng → BỎ QUA Modbus.");
    return;
  }
  const lineByUnit = {};
  for (const line of topo.lines) lineByUnit[line.modbusUnitId] = line.lineNo;

  const getReg = (addr, unitID) => {
    const lineNo = lineByUnit[unitID];
    if (lineNo == null) return 0;
    const s = state[lineNo];
    return Number(s.tags[`m:${addr}`] ?? 0) & 0xffff;
  };
  const vector = {
    getHoldingRegister: (addr, unitID) => getReg(addr, unitID),
    getInputRegister: (addr, unitID) => getReg(addr, unitID),
    getCoil: () => 0,
    setRegister: () => {},
    setCoil: () => {},
  };
  try {
    modbusServer = new ServerTCP(vector, { host: "0.0.0.0", port: MODBUS_PORT, debug: false, unitID: 1 });
    modbusServer.on("socketError", (err) => console.warn("[sim/modbus] socketError:", err?.message ?? err));
    console.log(`[sim/modbus] Modbus TCP LIVE @ tcp://127.0.0.1:${MODBUS_PORT} (units: ${Object.keys(lineByUnit).join(",")})`);
  } catch (e) {
    console.warn("[sim/modbus] không bind được:", e?.message ?? e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MTConnect agent tối giản — GET /current trả MTConnectStreams XML.
// (Chỉ có tác dụng khi MTCONNECT_SOURCES trỏ agentUrl vào cổng này.)
// ═══════════════════════════════════════════════════════════════════════════
function mtconnectXml() {
  const now = new Date().toISOString();
  let comps = "";
  for (const line of topo.lines) {
    const s = state[line.lineNo];
    const speed = Number(s.tags["ns=1;s=conveyor.speed"] ?? 0).toFixed(1);
    const exec = s.running ? "ACTIVE" : "STOPPED";
    comps += `<DeviceStream name="${line.code}" uuid="${line.code}">
  <ComponentStream component="Path" name="path" componentId="p1">
    <Events><Execution dataItemId="exec" timestamp="${now}">${exec}</Execution></Events>
    <Samples><PathFeedrate dataItemId="feed" timestamp="${now}">${speed}</PathFeedrate></Samples>
  </ComponentStream>
</DeviceStream>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<MTConnectStreams xmlns="urn:mtconnect.org:MTConnectStreams:1.3">
  <Header creationTime="${now}" sender="SIM" instanceId="1" bufferSize="131072" version="1.3"/>
  <Streams>${comps}</Streams>
</MTConnectStreams>`;
}

function startMtconnect() {
  const srv = http.createServer((req, res) => {
    if (req.url && req.url.startsWith("/current")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(mtconnectXml());
    } else {
      res.writeHead(404).end("not found");
    }
  });
  srv.on("error", (e) => console.warn("[sim/mtconnect] không bind được:", e?.message ?? e));
  srv.listen(MTCONNECT_PORT, () => console.log(`[sim/mtconnect] agent @ http://127.0.0.1:${MTCONNECT_PORT}/current`));
  return srv;
}

// ═══════════════════════════════════════════════════════════════════════════
// Inspection feeder — POST /api/machine/submit-inspection (đường ingest THẬT).
// ═══════════════════════════════════════════════════════════════════════════
let feedSeq = 0;
async function submitInspection(machine, { overall } = {}) {
  const result = overall || (Math.random() < ngProbFor(machine.lineNo) ? "NG" : "OK");
  const body = {
    apiKey: machine.apiKey,
    machineCode: machine.code,
    serialNumber: `SIM-${machine.code}-${Date.now()}-${feedSeq++}`,
    productModel: "SIM-PRODUCT",
    overallResult: result,
    cycleTime: 8 + Math.random() * 4,
    inspectionTime: new Date().toISOString(),
    measurements: [
      {
        pointCode: "P1",
        measuredValue: 10 + Math.random(),
        result: result === "NG" ? "NG" : "OK",
        remark: result === "NG" ? "SIM defect" : undefined,
      },
    ],
  };
  try {
    const r = await fetch(`${APP_BASE}/api/machine/submit-inspection`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": machine.apiKey },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, status: r.status, result };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e), result };
  }
}

function ngProbFor(lineNo) {
  const s = state[lineNo];
  return s.ngSpike != null ? 0.6 : 0.03; // spike → 60% NG, bình thường 3%
}

const inspectionMachines = topo.lines.flatMap((l) => l.machines.filter((m) => m.ingest === "inspection"));

function startInspectionFeed() {
  if (!INSPECTION_FEED) {
    console.log("[sim/feed] inspection feeder TẮT (đặt SIM_INSPECTION_FEED=true để bật).");
    return null;
  }
  console.log(`[sim/feed] inspection feeder BẬT → POST ${APP_BASE}/api/machine/submit-inspection mỗi ${INSPECTION_MS}ms`);
  const timer = setInterval(async () => {
    // mỗi chu kỳ chọn 1 máy inspection quay vòng để không dồn tải.
    const m = inspectionMachines[feedSeq % inspectionMachines.length];
    if (state[m.lineNo].running) await submitInspection(m);
  }, INSPECTION_MS);
  timer.unref();
  return timer;
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP control-plane (4899) — scenario runner ra lệnh.
// ═══════════════════════════════════════════════════════════════════════════
function readJson(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function snapshot() {
  return topo.lines.map((l) => {
    const s = state[l.lineNo];
    return {
      line: l.lineNo,
      code: l.code,
      running: s.running,
      opcua: opcuaServers[l.lineNo].status,
      opcuaPort: l.opcuaPort,
      ngSpike: s.ngSpike,
      sampleTags: {
        speed: s.tags["ns=1;s=conveyor.speed"],
        cycle_count: s.tags["ns=1;s=conveyor.cycle_count"],
        ng_rate: s.tags["ns=1;s=conveyor.ng_rate"],
      },
    };
  });
}

async function handleControl(action, body) {
  const line = Number(body.line);
  const s = line ? state[line] : null;
  switch (action) {
    case "opcua.kill":
    case "machine.stop": {
      if (!s) throw new Error("thiếu 'line'");
      s.running = false;
      await opcuaServers[line].stop();
      return { action, line, opcua: opcuaServers[line].status, note: "line dừng + OPC-UA server tắt → telemetry ngừng" };
    }
    case "opcua.restart":
    case "machine.start": {
      if (!s) throw new Error("thiếu 'line'");
      s.running = true;
      await opcuaServers[line].restart();
      return { action, line, opcua: opcuaServers[line].status, note: "line chạy lại + OPC-UA server dựng lại → supervisor reconnect" };
    }
    case "ng.spike": {
      if (!s) throw new Error("thiếu 'line'");
      s.ngSpike = body.value != null ? Number(body.value) : 35;
      return { action, line, ng_rate: s.ngSpike, note: "conveyor.ng_rate ép lên cao → interlock telemetry_tag sẽ nổ" };
    }
    case "ng.clear": {
      if (!s) throw new Error("thiếu 'line'");
      s.ngSpike = null;
      return { action, line, note: "ng_rate trả về bình thường" };
    }
    case "tag.set": {
      if (!s) throw new Error("thiếu 'line'");
      if (!body.addr) throw new Error("thiếu 'addr'");
      s.tags[body.addr] = body.value;
      return { action, line, addr: body.addr, value: body.value };
    }
    case "inspection.burst": {
      if (!s) throw new Error("thiếu 'line'");
      const count = Number(body.count || 10);
      const overall = body.ng ? "NG" : undefined;
      const machines = topo.lines.find((l) => l.lineNo === line).machines.filter((m) => m.ingest === "inspection");
      const results = [];
      for (let i = 0; i < count; i++) {
        const m = machines[i % machines.length];
        results.push(await submitInspection(m, { overall }));
      }
      const okCount = results.filter((r) => r.ok).length;
      const queued = results.filter((r) => r.status === 200 && !r.ok).length;
      return { action, line, sent: count, http_ok: okCount, note: `POST ${count} inspection (ok=${okCount}) — nếu DB sập, server trả queued (store-forward)` };
    }
    default:
      throw new Error(`action không hỗ trợ: ${action}`);
  }
}

function startControl() {
  const srv = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, app: APP_BASE, lines: snapshot() }, null, 2));
      }
      if (req.method === "GET" && req.url === "/state") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(state, (k, v) => (k === "line" ? undefined : v), 2));
      }
      if (req.method === "POST" && req.url === "/control") {
        const body = await readJson(req);
        const out = await handleControl(String(body.action || ""), body);
        console.log(`[sim/control] ${JSON.stringify(body)} → ${out.note || "ok"}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, ...out }));
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }));
    }
  });
  srv.on("error", (e) => {
    console.error("[sim/control] không bind được:", e?.message ?? e);
    process.exit(1);
  });
  srv.listen(CONTROL_PORT, () => console.log(`[sim/control] control-plane @ http://127.0.0.1:${CONTROL_PORT} (POST /control, GET /health)`));
  return srv;
}

// ═══════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════
async function boot() {
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(" SIM FACTORY — device simulator (doc 40 §13.4). App:", APP_BASE);
  console.log("══════════════════════════════════════════════════════════════════");
  for (const line of topo.lines) {
    try {
      await opcuaServers[line.lineNo].start();
    } catch (e) {
      console.warn(`[sim/opcua] ${line.code} start lỗi:`, e?.message ?? e);
    }
  }
  await startModbus();
  const mt = startMtconnect();
  const ctl = startControl();
  const feed = startInspectionFeed();
  const ticker = setInterval(tick, TICK_MS);

  const shutdown = async () => {
    console.log("\n[sim] đang dừng...");
    clearInterval(ticker);
    if (feed) clearInterval(feed);
    for (const line of topo.lines) await opcuaServers[line.lineNo].stop();
    try { modbusServer?.close?.(); } catch {}
    try { mt.close(); } catch {}
    try { ctl.close(); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log("\n[sim] SẴN SÀNG. Ctrl-C để dừng. Control: POST http://127.0.0.1:" + CONTROL_PORT + "/control");
}

boot().catch((e) => {
  console.error("[sim] BOOT LỖI:", e);
  process.exit(1);
});
