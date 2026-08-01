// scripts/sim-factory/topology.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Doc 40 Wave 3B §13.4 — "NHÀ MÁY ẢO" (virtual factory) — SINGLE SOURCE OF TRUTH.
//
// Đây là bản mô tả topology DÙNG CHUNG cho CẢ ba tiến trình:
//   • seed.mjs      — dựng factory/line/machine/adapter/tag vào DB _sim.
//   • simulator.mjs — phục vụ ĐÚNG các endpoint/nodeId/register mà adapter trỏ tới
//                     (OPC-UA server per-line, Modbus TCP, HTTP control + inspection feed).
//   • scenario.mjs  — biết line/máy/rule nào để phá hoại + kiểm tra.
//
// NGUYÊN TẮC HONEST: vì seed VÀ simulator đọc cùng file này, adapter trong DB LUÔN
// trỏ đúng nodeId/register mà simulator phục vụ → dữ liệu chảy qua ĐÚNG driver thật
// (node-opcua / modbus-serial) → ingest thật → ot_telemetry thật. KHÔNG bơm thẳng DB.
//
// Bố cục: 1 tập đoàn(tuỳ chọn) → 1 nhà máy ảo → 1 xưởng → 3 line × 12 máy đủ chủng loại.
//   Mỗi line có 1 OPC-UA server RIÊNG (port 4840/4841/4842) → có thể "giết" độc lập
//   để mô phỏng 1 máy/1 line rớt mà không ảnh hưởng line khác (scenario a/d).
//   Modbus TCP dùng CHUNG 1 server (5020), tách theo unitId = số thứ tự line.
// ─────────────────────────────────────────────────────────────────────────────

/** Cổng mặc định (có thể override qua env trong simulator). */
export const PORTS = {
  opcuaBase: 4840, // line k dùng cổng opcuaBase + (k-1): 4840, 4841, 4842
  modbus: 5020,
  control: 4899, // HTTP control-plane của simulator (scenario runner gọi vào)
  mtconnect: 5001, // MTConnect agent (XML /current) — trỏ bởi MTCONNECT_SOURCES
};

export const FACTORY = { code: "SIM-FAC", name: "Nhà máy ảo (SIM)" };
export const WORKSHOP = { code: "SIM-WS", name: "Xưởng lắp ráp ảo (SIM)" };

// ── Định nghĩa 12 "vai trò máy" cho mỗi line ────────────────────────────────
// Trường:
//   role       — hậu tố mã máy (SIM-L1-AOI …) + browse name.
//   type       — machineTypeEnum hợp lệ.
//   ingest     — 'inspection' (có apiKey, feeder POST submit-inspection) | undefined
//   adapter    — mô tả device_adapter (nếu có). protocol ∈ opcua|modbus|s7|ethernet-ip.
//                live=true → simulator PHỤC VỤ endpoint này thật; live=false → khung
//                (adapter tồn tại, gateway thử connect rồi fail-safe "skipped" — honest).
//   opcua      — với adapter opcua-live: 'server' cho biết dùng OPC-UA server của line.
//   tags       — danh sách điểm đọc. Mỗi tag: { key, dataType, addr, behavior, unit }.
//                addr = địa chỉ driver thật (OPC-UA nodeId "ns=1;s=.." | Modbus "40001").
//                behavior điều khiển cách simulator sinh giá trị (xem simulator.mjs).
//
// LƯU Ý presence/downtime keyed theo adapter.machineId — nên máy "xương sống" của
// line (CONVEYOR, opcua-live) mang telemetry để scenario a/d bám vào.

const OPCUA_CONVEYOR_TAGS = [
  { key: "running", dataType: "bool", addr: "ns=1;s=conveyor.running", behavior: "running" },
  { key: "speed", dataType: "float", addr: "ns=1;s=conveyor.speed", behavior: "noisy", base: 1100, jitter: 40, unit: "mm/s" },
  { key: "cycle_count", dataType: "int", addr: "ns=1;s=conveyor.cycle_count", behavior: "counter", step: 1 },
  { key: "temperature", dataType: "float", addr: "ns=1;s=conveyor.temperature", behavior: "noisy", base: 45, jitter: 3, unit: "°C" },
  // ng_rate là metric interlock telemetry_tag bám vào (rule sourceKey='ng_rate').
  { key: "ng_rate", dataType: "float", addr: "ns=1;s=conveyor.ng_rate", behavior: "ng_rate", base: 2.5, jitter: 1.5, unit: "%" },
];

const OPCUA_PWR_TAGS = [
  { key: "active_power", dataType: "float", addr: "ns=1;s=power.active_power", behavior: "noisy", base: 12.5, jitter: 1.2, unit: "kW" },
  { key: "energy_kwh", dataType: "int", addr: "ns=1;s=power.energy_kwh", behavior: "counter", step: 1, unit: "kWh" },
  { key: "power_factor", dataType: "float", addr: "ns=1;s=power.power_factor", behavior: "noisy", base: 0.96, jitter: 0.02 },
];

const MODBUS_ASSY_TAGS = [
  { key: "good_count", dataType: "int", addr: "40001", behavior: "counter", step: 1 },
  { key: "reject_count", dataType: "int", addr: "40002", behavior: "counter", step: 0 }, // tăng khi ng.spike
  { key: "line_speed", dataType: "int", addr: "40003", behavior: "noisy", base: 60, jitter: 5, unit: "u/min" },
  { key: "torque", dataType: "int", addr: "40004", behavior: "noisy", base: 120, jitter: 8, unit: "Nm" },
];

/** Template 12 máy/line. */
const MACHINE_ROLES = [
  { role: "SPI", type: "SPI", ingest: "inspection" },
  { role: "AOI", type: "AOI", ingest: "inspection" },
  { role: "AVI", type: "AVI", ingest: "inspection" },
  { role: "ICT", type: "ICT", ingest: "inspection" },
  { role: "FCT", type: "FCT", ingest: "inspection" },
  {
    role: "CONVEYOR",
    type: "AUTOMATION",
    backbone: true, // máy mang telemetry chính của line (scenario a/d bám vào)
    adapter: { protocol: "opcua", live: true, transport: "opcua-line", tags: OPCUA_CONVEYOR_TAGS },
  },
  {
    role: "PWR",
    type: "FEEDER",
    adapter: { protocol: "opcua", live: true, transport: "opcua-line", tags: OPCUA_PWR_TAGS },
  },
  {
    role: "ASSY",
    type: "ASSEMBLY",
    adapter: { protocol: "modbus", live: true, transport: "modbus", tags: MODBUS_ASSY_TAGS },
  },
  {
    // Khung (framework): adapter tồn tại nhưng simulator KHÔNG serve s7 → gateway
    // thử connect rồi fail-safe "skipped". Chứng minh nhánh honest no-op.
    role: "SCREW",
    type: "SCREWDRIVE",
    adapter: {
      protocol: "s7",
      live: false,
      transport: "s7",
      tags: [{ key: "cycle_ok", dataType: "bool", addr: "DB1,X0.0", behavior: "static", value: true }],
    },
  },
  {
    role: "PACK",
    type: "PACKAGING",
    adapter: {
      protocol: "ethernet-ip",
      live: false,
      transport: "ethernet-ip",
      tags: [{ key: "pack_count", dataType: "int", addr: "PackCount", behavior: "counter", step: 1 }],
    },
  },
  // Robot + AGV: không có device_adapter OT — đi qua robotGateway / VDA5050 (khung).
  { role: "ROBOT", type: "ROBOT", robot: true },
  { role: "AGV", type: "AUTOMATION", agv: true },
];

/** apiKey tất định cho máy inspection (để feeder POST submit-inspection). */
export function machineApiKey(lineCode, role) {
  return `sim-${lineCode}-${role}`.toLowerCase();
}

/** Mã máy tất định: SIM-L1-AOI … */
export function machineCode(lineCode, role) {
  return `${lineCode}-${role}`;
}

/** Cổng OPC-UA của line (1-based). */
export function opcuaPortForLine(lineNo) {
  return PORTS.opcuaBase + (lineNo - 1);
}

/** Endpoint driver cho một adapter theo transport. */
export function adapterEndpoint(transport, lineNo) {
  switch (transport) {
    case "opcua-line":
      return `opc.tcp://127.0.0.1:${opcuaPortForLine(lineNo)}`;
    case "modbus":
      return `tcp://127.0.0.1:${PORTS.modbus}`;
    case "s7":
      return `127.0.0.1:1102`; // ISO-on-TCP (không serve → framework)
    case "ethernet-ip":
      return `127.0.0.1:44818`; // EtherNet/IP (không serve → framework)
    default:
      return `127.0.0.1:0`;
  }
}

/**
 * Sinh mô hình đầy đủ 3 line × 12 máy. Trả một cây thuần dữ liệu để seed + simulator
 * duyệt. lineNo 1-based; lineCode = SIM-L{n}.
 */
export function buildTopology() {
  const lines = [1, 2, 3].map((lineNo) => {
    const lineCode = `SIM-L${lineNo}`;
    const machines = MACHINE_ROLES.map((m, idx) => {
      const code = machineCode(lineCode, m.role);
      const out = {
        lineNo,
        lineCode,
        role: m.role,
        type: m.type,
        code,
        name: `${lineCode} ${m.role}`,
        orderIndex: idx,
        backbone: !!m.backbone,
        robot: !!m.robot,
        agv: !!m.agv,
        ingest: m.ingest ?? null,
        apiKey: m.ingest === "inspection" ? machineApiKey(lineCode, m.role) : null,
        adapter: null,
      };
      if (m.adapter) {
        out.adapter = {
          code: `ADP-${code}`,
          protocol: m.adapter.protocol,
          live: m.adapter.live,
          transport: m.adapter.transport,
          endpoint: adapterEndpoint(m.adapter.transport, lineNo),
          pollIntervalMs: 2000,
          tags: m.adapter.tags.map((t) => ({ ...t })),
        };
      }
      return out;
    });
    return {
      lineNo,
      code: lineCode,
      name: `Dây chuyền ảo ${lineNo}`,
      opcuaPort: opcuaPortForLine(lineNo),
      modbusUnitId: lineNo,
      machines,
    };
  });

  return { factory: FACTORY, workshop: WORKSHOP, lines };
}

/** Ca làm việc (3 ca, factory-scoped). */
export const SHIFTS = [
  { code: "A", name: "Ca A (Sáng)", startHour: 6, startMinute: 0, endHour: 14, endMinute: 0, orderIndex: 0 },
  { code: "B", name: "Ca B (Chiều)", startHour: 14, startMinute: 0, endHour: 22, endMinute: 0, orderIndex: 1 },
  { code: "C", name: "Ca C (Đêm)", startHour: 22, startMinute: 0, endHour: 6, endMinute: 0, orderIndex: 2 },
];

/** Mục tiêu OEE mặc định cho mỗi line (đơn vị = phần trăm ×100 như schema). */
export const OEE_TARGET = {
  targetOEE: 8000,
  targetAvailability: 9000,
  targetPerformance: 9500,
  targetQuality: 9900,
  alertThreshold: 7000,
  criticalThreshold: 6000,
};

/**
 * Interlock rule dùng cho scenario ng-spike: telemetry_tag trên máy CONVEYOR của
 * line 1, đọc metric 'ng_rate' (= tagKey), gt 20% → alert (alert-only, an toàn) → Andon vàng.
 */
export const INTERLOCK_RULE = {
  name: "SIM NG-rate spike (L1 CONVEYOR)",
  scope: "machine",
  lineNo: 1,
  machineRole: "CONVEYOR",
  sourceType: "telemetry_tag",
  sourceKey: "ng_rate",
  comparisonOperator: "gt",
  threshold: "20",
  windowSeconds: 120,
  action: "alert",
  cooldownSeconds: 30,
  requiresHumanConfirm: true,
};
