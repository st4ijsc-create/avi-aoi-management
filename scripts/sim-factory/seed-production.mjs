// scripts/sim-factory/seed-production.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Doc 46 FE-W0.2 (§2.2 + §6, quyết định D2) — SEED "TẦNG SẢN XUẤT / CHẤT LƯỢNG"
// mô phỏng CÓ NHÃN "SIM" vào DB THẬT, để mọi dashboard quản lý (OEE / yield /
// throughput / plan-vs-actual / SPC / genealogy / traceability) có SỐ THẬT hiển thị
// TRƯỚC KHI có luồng ingest phần cứng.
//
// ⚠ KHÁC seed.mjs: seed.mjs chỉ dựng CẤU HÌNH tĩnh (factory/line/máy/adapter) và cố
//   ý KHÔNG bịa inspection/telemetry (chờ ingest thật). Script NÀY (được user DUYỆT)
//   bơm THẲNG dữ liệu SẢN XUẤT giả — nhưng MỌI bản ghi đều gắn NHÃN "SIM" (xem §NHÃN
//   bên dưới) và ĐẢO NGƯỢC được hoàn toàn bằng `--purge`.
//
// ĐỌC topology THẬT từ DB (machines/stations/lines) — KHÔNG tạo mới hierarchy
// (seed.mjs đã lo). Chỉ tạo 1-2 product_model "SIM-*" + điểm đo (nếu chưa có) để
// SPC/Cpk có định nghĩa giới hạn.
//
// NGUỒN CỦA CÁC DASHBOARD (đã kiểm chứng trong code, seed để KHỚP):
//   • OEE (oeeService.getLineOEE / getAllMachinesOEELive): daily_statistics (counts)
//     + machine_status_logs (availability) + oee_metrics.idealCycleTime (perf).
//   • War-Room (warRoomService): getLineOEE + production_orders (plan) +
//     downtime_events (top-5) + fact_inspection_hourly (so ca) + shift_configs.
//   • SPC/Cpk (server/db/spc.ts): measurement_results ⋈ product_inspections ⋈
//     measurement_point_defs, lọc theo pointDefId + measuredValue NOT NULL.
//   • Genealogy (genealogyApi/genealogyRouter): genealogy_chain (hash-chain) +
//     component_installations + supplier_lots + process_results.
//   → Vì vậy seed CẢ các bảng "nguồn" này, nhất quán với nhau.
//
// NHÃN "SIM" (nhận diện + purge):
//   product_inspections   serialNumber LIKE 'SIM-%'  + notes '..."source":"SIM"...'
//   measurement_results   (theo inspectionId của inspection SIM)
//   oee_metrics           calculatedBy = 'SIM'
//   downtime_events       detailedReason LIKE '%[SIM]%'
//   production_orders     orderCode LIKE 'SIM-PO-%'
//   genealogy_chain       serialNumber LIKE 'SIM-%'  + payload.source='SIM'
//   component_installations serialNumber LIKE 'SIM-%'
//   supplier_lots         supplierLotNumber LIKE 'SIM-%'
//   process_results       serialNumber LIKE 'SIM-%'  + metrics.source='SIM'
//   machine_status_logs   ipAddress = 'SIM'
//   daily_statistics / fact_inspection_hourly  (scoped theo nhà máy SIM-FAC)
//   product_models        code LIKE 'SIM-%'  (CONFIG — KHÔNG bị purge, như topology)
//
// IDEMPOTENT: mỗi lần chạy PURGE toàn bộ dữ-liệu-SIM (theo nhãn trên) rồi tái sinh
//   → chạy lại KHÔNG nhân đôi. `--purge` = chỉ xoá, không sinh.
//
// AN TOÀN: KHÔNG đụng dữ liệu THẬT (chỉ thêm/xoá bản ghi mang nhãn SIM / thuộc nhà
//   máy SIM-FAC). KHÔNG sửa seed.mjs / simulator.mjs. KHÔNG đụng server/ hay client/.
//
// Chạy:
//   node scripts/sim-factory/seed-production.mjs --days 14          (mặc định 14 ngày)
//   node scripts/sim-factory/seed-production.mjs --days 30 --units-per-shift 40
//   node scripts/sim-factory/seed-production.mjs --purge            (xoá sạch dữ liệu SIM)
//   npm run sim:production -- --days 14
// ─────────────────────────────────────────────────────────────────────────────
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";

// ── Nạp .env THẬT (KHÔNG nạp .env.sim — mục tiêu là DB sản xuất aoi_management). ──
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) dotenv.config({ path: envPath });

function maskUrl(url) {
  try { const u = new URL(url); if (u.password) u.password = "***"; return u.toString(); }
  catch { return String(url).replace(/\/\/[^@]*@/, "//***@"); }
}

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getOpt = (f, dflt) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const DAYS = Math.max(1, parseInt(getOpt("--days", "14"), 10) || 14);
const UNITS_PER_SHIFT = Math.max(1, parseInt(getOpt("--units-per-shift", "24"), 10) || 24);
const PURGE_ONLY = hasFlag("--purge");

const url = process.env.DATABASE_URL;
if (!url) { console.error("[sim/prod] DATABASE_URL chưa set (nạp .env)."); process.exit(1); }

// Banner an toàn — ghi thẳng vào DB thật là HÀNH ĐỘNG CHỦ ĐÍCH (đã DUYỆT doc 46 D2).
console.log(
  "\n══════════════════════════════════════════════════════════════════\n" +
  "[sim/prod] SEED TẦNG SẢN XUẤT MÔ PHỎNG — DỮ LIỆU GẮN NHÃN \"SIM\"\n" +
  `           target DB : ${maskUrl(url)}\n` +
  (/sim/i.test(url) ? "" : "           ⚠ DB KHÔNG chứa 'sim' → đây là DB SẢN XUẤT. Mọi bản ghi đều\n" +
  "             gắn nhãn SIM và ĐẢO NGƯỢC được bằng `--purge` (doc 46 D2 đã duyệt).\n") +
  `           mode      : ${PURGE_ONLY ? "PURGE-ONLY (chỉ xoá dữ liệu SIM)" : `SEED ${DAYS} ngày × ${UNITS_PER_SHIFT} unit/ca/line`}\n` +
  "══════════════════════════════════════════════════════════════════\n",
);

const sql = postgres(url, { max: 4, onnotice: () => {} });

// ── tally ─────────────────────────────────────────────────────────────────────
const tally = {};
const add = (t, n) => { tally[t] = (tally[t] ?? 0) + n; };

// ── RNG helpers ───────────────────────────────────────────────────────────────
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p) { return Math.random() < p; }
// Box-Muller normal
let _spare = null;
function normal(mean, sigma) {
  if (_spare !== null) { const v = _spare; _spare = null; return mean + sigma * v; }
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u));
  _spare = r * Math.sin(2 * Math.PI * v);
  return mean + sigma * r * Math.cos(2 * Math.PI * v);
}
function round(x, d = 3) { const f = 10 ** d; return Math.round(x * f) / f; }

// ── Genealogy hash-chain (bản sao CHÍNH XÁC server/utils/genealogyChain.ts) ─────
const GENESIS = "0".repeat(64);
function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}
function hashEntry(prevHash, input) {
  const canonical = canonicalJson({
    prevHash,
    serialNumber: input.serialNumber,
    parentSerial: input.parentSerial ?? null,
    eventType: input.eventType,
    stationCode: input.stationCode ?? null,
    lotCode: input.lotCode ?? null,
    productModelId: input.productModelId ?? null,
    payload: input.payload,
    recordedAt: (input.recordedAt ?? new Date()).toISOString(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
// Driver `postgres` đọc cột `timestamp` (no-tz) diễn giải theo tz LOCAL của Node,
// trong khi ghi lại theo session tz (UTC) → read-back lệch. Để verifyChain (app +
// seeder cùng driver) khớp, HASH bằng đúng giá trị mà driver sẽ ĐỌC LẠI: lấy các
// thành phần UTC của D và dựng thành Date theo LOCAL. (Đã kiểm chứng round-trip.)
function readBack(D) {
  return new Date(D.getUTCFullYear(), D.getUTCMonth(), D.getUTCDate(),
    D.getUTCHours(), D.getUTCMinutes(), D.getUTCSeconds(), D.getUTCMilliseconds());
}

// ── Time helpers (LOCAL wall-clock — khớp cách app bucket ngày/ca) ─────────────
const NOW = new Date();
// Ngày sản xuất d (0 = hôm nay) tại giờ h phút m (giờ LOCAL nhà máy).
function localAt(dayOffset, h, m = 0, s = 0) {
  return new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - dayOffset, h, m, s, 0);
}
function localMidnight(dayOffset) { return localAt(dayOffset, 0, 0, 0); }
function yyyymmdd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
// Ca theo giờ LOCAL: A 06-14, B 14-22, C 22-06.
function shiftForHour(h) { return h >= 6 && h < 14 ? "A" : h >= 14 && h < 22 ? "B" : "C"; }
// bỏ tiền tố "SIM-" của line.code để tránh mã trùng "SIM-SIM-L3" (vẫn giữ nhãn SIM- ở đầu mã).
const short = (code) => code.replace(/^SIM-/, "");
const SHIFTS = [
  { code: "A", startH: 6, endH: 14 },
  { code: "B", startH: 14, endH: 22 },
  { code: "C", startH: 22, endH: 30 }, // 30 = 06:00 hôm sau (wrap)
];

// ── Product / measurement-point definition cho sản phẩm SIM ───────────────────
// nominal (N), lowerLimit (L), upperLimit (U) — sigma suy ra để Cpk hợp lý.
const SIM_PRODUCTS = [
  {
    code: "SIM-PCB-MAIN", name: "SIM Bo mạch chính (mô phỏng)", category: "SIM",
    points: [
      { code: "MP-SLDR-H", name: "Chiều cao thiếc Q1", type: "DIMENSION", unit: "mm", n: 0.200, l: 0.150, u: 0.250 },
      { code: "MP-OFFS-X", name: "Lệch đặt X U3", type: "POSITION", unit: "mm", n: 0.000, l: -0.050, u: 0.050 },
      { code: "MP-COMP-H", name: "Cao linh kiện C12", type: "DIMENSION", unit: "mm", n: 1.500, l: 1.400, u: 1.600 },
      { code: "MP-SLDR-V", name: "Thể tích thiếc R7", type: "DIMENSION", unit: "mm3", n: 0.0450, l: 0.0350, u: 0.0550 },
      { code: "MP-COPLAN", name: "Đồng phẳng BGA", type: "DIMENSION", unit: "mm", n: 0.040, l: 0.000, u: 0.100 },
      { code: "MP-OCR", name: "Điểm OCR nhãn", type: "VISUAL", unit: "%", n: 98.0, l: 90.0, u: 100.0 },
    ],
  },
  {
    code: "SIM-PCB-SENSOR", name: "SIM Bo cảm biến (mô phỏng)", category: "SIM",
    points: [
      { code: "MP-PAD-W", name: "Rộng pad P1", type: "DIMENSION", unit: "mm", n: 0.300, l: 0.250, u: 0.350 },
      { code: "MP-GAP", name: "Khe hở đầu nối", type: "DIMENSION", unit: "mm", n: 0.500, l: 0.450, u: 0.550 },
      { code: "MP-RES", name: "Điện trở shunt", type: "ELECTRICAL", unit: "ohm", n: 10.00, l: 9.50, u: 10.50 },
      { code: "MP-HEIGHT", name: "Cao đầu cắm", type: "DIMENSION", unit: "mm", n: 2.000, l: 1.900, u: 2.100 },
      { code: "MP-TILT", name: "Nghiêng linh kiện", type: "POSITION", unit: "deg", n: 0.000, l: -1.500, u: 1.500 },
      { code: "MP-COLOR", name: "Sai màu vỏ", type: "COLOR", unit: "dE", n: 1.000, l: 0.000, u: 3.000 },
    ],
  },
];

// Trạm inspection theo routing + trạm lắp ráp (ASSY dùng cho component genealogy).
const INSPECTION_STATIONS = ["SPI", "AOI", "ICT", "FCT", "AVI"]; // thứ tự routing
// Tỉ lệ NG/NTF ĐỘC LẬP theo trạm (yield thực tế ~97-98%/trạm; NTF = báo giả).
const STATION_RATES = {
  SPI: { ng: 0.020, ntf: 0.010 },
  AOI: { ng: 0.028, ntf: 0.015 },
  ICT: { ng: 0.015, ntf: 0.008 },
  FCT: { ng: 0.020, ntf: 0.010 },
  AVI: { ng: 0.012, ntf: 0.008 },
};
const MEASURE_STATION = "AOI"; // trạm sinh measurement_results (điểm đo sản phẩm)
// Mục tiêu OEE để dữ liệu (status_logs + ideal cycle) sinh ra NHẤT QUÁN → LIVE OEE lành mạnh.
const AVAIL_TARGET = 0.91; // ~91% availability
const PERF_TARGET = 0.92;  // ~92% performance
const FUNCTIONAL_STATIONS = ["ICT", "FCT"]; // sinh process_results
const OEE_STATIONS = ["SPI", "AOI", "ICT", "FCT", "AVI", "ASSY"];

// Component (BOM) SIM để genealogy component→serial có dữ liệu.
const SIM_COMPONENTS = [
  { code: "SIM-R0402-10K", ref: "R", name: "Điện trở 0402 10k" },
  { code: "SIM-C0603-100N", ref: "C", name: "Tụ 0603 100nF" },
  { code: "SIM-IC-MCU48", ref: "U", name: "MCU 48-pin" },
];

// Downtime reason theo category (categoryEnum: planned/unplanned/breakdown/changeover/maintenance/other).
const DOWNTIME_REASONS = [
  { category: "breakdown", reason: "Kẹt băng tải" },
  { category: "changeover", reason: "Đổi sản phẩm" },
  { category: "unplanned", reason: "NG vượt ngưỡng" },
  { category: "maintenance", reason: "Bảo trì định kỳ" },
  { category: "breakdown", reason: "Lỗi cấp liệu feeder" },
  { category: "planned", reason: "Vệ sinh đầu phun" },
];

// ═══════════════════════════════════════════════════════════════════════════
// PURGE — xoá toàn bộ dữ-liệu-SIM (theo nhãn), thứ tự tôn trọng FK.
// ═══════════════════════════════════════════════════════════════════════════
async function purgeSim(simFactoryId, simMachineIds) {
  console.log("[sim/prod] purge dữ liệu SIM cũ (idempotent)…");
  const machArr = simMachineIds.length ? simMachineIds : [-1];
  // measurement_results trước (FK → product_inspections)
  const mr = await sql`DELETE FROM measurement_results WHERE "inspectionId" IN
    (SELECT id FROM product_inspections WHERE "serialNumber" LIKE 'SIM-%')`;
  add("measurement_results(-)", mr.count || 0);
  const pi = await sql`DELETE FROM product_inspections WHERE "serialNumber" LIKE 'SIM-%'`;
  add("product_inspections(-)", pi.count || 0);
  const gc = await sql`DELETE FROM genealogy_chain WHERE "serialNumber" LIKE 'SIM-%'`;
  add("genealogy_chain(-)", gc.count || 0);
  const ci = await sql`DELETE FROM component_installations WHERE "serialNumber" LIKE 'SIM-%'`;
  add("component_installations(-)", ci.count || 0);
  const sl = await sql`DELETE FROM supplier_lots WHERE "supplierLotNumber" LIKE 'SIM-%'`;
  add("supplier_lots(-)", sl.count || 0);
  const pr = await sql`DELETE FROM process_results WHERE "serialNumber" LIKE 'SIM-%'`;
  add("process_results(-)", pr.count || 0);
  const oe = await sql`DELETE FROM oee_metrics WHERE "calculatedBy" = 'SIM'`;
  add("oee_metrics(-)", oe.count || 0);
  const dt = await sql`DELETE FROM downtime_events WHERE "detailedReason" LIKE '%[SIM]%'`;
  add("downtime_events(-)", dt.count || 0);
  const po = await sql`DELETE FROM production_orders WHERE "orderCode" LIKE 'SIM-PO-%'`;
  add("production_orders(-)", po.count || 0);
  const ms = await sql`DELETE FROM machine_status_logs WHERE "ipAddress" = 'SIM'`;
  add("machine_status_logs(-)", ms.count || 0);
  // daily_statistics / fact_inspection_hourly — scope theo nhà máy SIM (toàn bộ nhà
  // máy này là SIM) hoặc theo máy SIM.
  const ds = await sql`DELETE FROM daily_statistics WHERE "factoryId" = ${simFactoryId} OR "machineId" IN ${sql(machArr)}`;
  add("daily_statistics(-)", ds.count || 0);
  const fh = await sql`DELETE FROM fact_inspection_hourly WHERE "factoryId" = ${simFactoryId} OR "machineId" IN ${sql(machArr)}`;
  add("fact_inspection_hourly(-)", fh.count || 0);
  const lpa = await sql`DELETE FROM line_product_assignments WHERE notes LIKE '%[SIM]%'`;
  add("line_product_assignments(-)", lpa.count || 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// ENSURE — product_models + measurement_point_defs SIM (CONFIG, không purge).
// ═══════════════════════════════════════════════════════════════════════════
async function ensureSimProducts() {
  const byCode = {};
  for (const p of SIM_PRODUCTS) {
    let [row] = await sql`SELECT id FROM product_models WHERE code = ${p.code}`;
    if (!row) {
      [row] = await sql`INSERT INTO product_models (code, name, description, category, "lifecycleStatus",
        "targetYieldRate", "minYieldRate", "isActive")
        VALUES (${p.code}, ${p.name}, ${"Sản phẩm mô phỏng (doc 46 FE-W0.2, nhãn SIM)"}, ${p.category},
                'active', ${"96.00"}, ${"92.00"}, true) RETURNING id`;
      add("product_models(+)", 1);
    }
    const productId = row.id;
    // điểm đo
    const pointIdByCode = {};
    for (let i = 0; i < p.points.length; i++) {
      const pt = p.points[i];
      let [pr] = await sql`SELECT id FROM measurement_point_defs
        WHERE "productModelId" = ${productId} AND code = ${pt.code} AND "deletedAt" IS NULL`;
      if (!pr) {
        [pr] = await sql`INSERT INTO measurement_point_defs
          ("productModelId", code, name, "measurementType", unit, "lowerLimit", "upperLimit",
           "nominalValue", "positionX", "positionY", radius, "orderIndex", "isActive")
          VALUES (${productId}, ${pt.code}, ${pt.name}, ${pt.type}, ${pt.unit},
                  ${String(pt.l)}, ${String(pt.u)}, ${String(pt.n)},
                  ${100 + i * 60}, ${120 + (i % 2) * 80}, 22, ${i}, true) RETURNING id`;
        add("measurement_point_defs(+)", 1);
      }
      pointIdByCode[pt.code] = pr.id;
    }
    byCode[p.code] = { id: productId, code: p.code, name: p.name, category: p.category, points: p.points, pointIdByCode };
  }
  return byCode;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  // ── Topology THẬT ───────────────────────────────────────────────────────────
  const [fac] = await sql`SELECT id, code FROM factories WHERE code = 'SIM-FAC'`;
  if (!fac) {
    console.error("[sim/prod] Không thấy nhà máy 'SIM-FAC'. Hãy chạy `npm run sim:factory` trước.");
    process.exit(1);
  }
  const simFactoryId = fac.id;
  const machineRows = await sql`
    SELECT m.id, m.code, m."machineType", s."lineId", pl.code AS line_code, pl.name AS line_name,
           pl."workshopId", w."factoryId", pl."capacityPerHour"
    FROM machines m
    JOIN stations s ON s.id = m."stationId"
    JOIN production_lines pl ON pl.id = s."lineId"
    JOIN workshops w ON w.id = pl."workshopId"
    WHERE w."factoryId" = ${simFactoryId} AND m."isActive" = true`;
  if (machineRows.length === 0) { console.error("[sim/prod] Nhà máy SIM chưa có máy."); process.exit(1); }

  const simMachineIds = machineRows.map((m) => m.id);
  const [ws] = await sql`SELECT id, code FROM workshops WHERE "factoryId" = ${simFactoryId} ORDER BY id LIMIT 1`;
  const workshopCode = ws?.code ?? "SIM-WS";

  // machine role = hậu tố sau lineCode-  (SIM-L1-AOI → "AOI")
  const roleOf = (code) => code.split("-").slice(2).join("-");
  // index máy theo (lineId, role)
  const machineByLineRole = new Map();
  const lines = new Map(); // lineId -> { id, code, name, capacity }
  for (const m of machineRows) {
    machineByLineRole.set(`${m.lineId}|${roleOf(m.code)}`, m);
    if (!lines.has(m.lineId)) lines.set(m.lineId, {
      id: m.lineId, code: m.line_code, name: m.line_name, workshopId: m.workshopId,
      capacity: Number(m.capacityPerHour) || 600,
    });
  }
  const lineIds = [...lines.keys()].sort((a, b) => a - b);

  // Gán sản phẩm cho line: L1,L2 → MAIN, L3 → SENSOR (xoay vòng nếu nhiều line).
  const productByLine = new Map();

  // ── resolve admin user (setBy/createdBy) ────────────────────────────────────
  const [admin] = await sql`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true ORDER BY id LIMIT 1`;
  const userId = admin?.id ?? (await sql`SELECT id FROM users ORDER BY id LIMIT 1`)[0]?.id ?? null;

  // ── PURGE luôn (idempotent), rồi (nếu không --purge) tái sinh ────────────────
  await purgeSim(simFactoryId, simMachineIds);
  if (PURGE_ONLY) { await report(simFactoryId); return; }

  const products = await ensureSimProducts();
  const productList = Object.values(products);
  lineIds.forEach((lid, idx) => productByLine.set(lid, productList[idx % productList.length]));

  // resolve defect catalog (một tập ưu tiên, fallback lấy bất kỳ active).
  const preferredDefects = [
    "SOLDER_BRIDGE", "INSUFFICIENT_SOLDER", "TOMBSTONE", "MISSING_COMPONENT", "NON_WETTING",
    "BGA_BRIDGING", "VOLUME_OUT", "BENT_LEAD", "COLD_SOLDER", "SCRATCH_COSMETIC",
    "POOR_MARKING", "SHIFT", "END_OVERHANG", "UPENDED",
  ];
  let defectRows = await sql`SELECT id, code, severity FROM defect_catalog
    WHERE code IN ${sql(preferredDefects)} AND "isActive" = true AND "deletedAt" IS NULL`;
  if (defectRows.length < 4) {
    defectRows = await sql`SELECT id, code, severity FROM defect_catalog
      WHERE "isActive" = true AND "deletedAt" IS NULL ORDER BY id LIMIT 12`;
  }
  const defects = defectRows.map((d) => ({ id: d.id, code: d.code, severity: d.severity }));

  // ── buffers cho bulk insert ─────────────────────────────────────────────────
  const inspections = [];      // product_inspections rows
  const results = [];          // measurement_results rows (dùng serial để nối inspectionId sau)
  const processResults = [];   // process_results rows
  const downtimes = [];        // downtime_events rows
  const statusLogs = [];       // machine_status_logs rows
  const genealogyInputs = [];  // {row-without-hash}, hash tính tuần tự sau
  const componentInstalls = [];
  const supplierLots = [];
  // agg maps
  const dailyAgg = new Map();  // key machineId|dayOffset -> {factoryId,workshopId,total,ok,ng,ntf,cyc}
  const oeeAgg = new Map();    // key machineId|dayOffset|shift -> {total,ok,ng,ntf}
  const factAgg = new Map();   // key bucketISO|machineId|productId|shift -> {total,ok,ng,ntf,fFirstTotal,fFirstOk, machineId, productId, shift, bucket, factoryId}

  // ── supplier lots SIM (cho component genealogy) ────────────────────────────
  const lotByComponent = new Map();
  for (const c of SIM_COMPONENTS) {
    const lotNumber = `SIM-LOT-${c.ref}-${yyyymmdd(localMidnight(DAYS))}`;
    supplierLots.push({
      supplierLotNumber: lotNumber, materialCode: c.code, materialName: c.name,
      quantity: "100000", remainingQuantity: "80000", unit: "pcs", status: "approved",
      createdAt: localMidnight(DAYS), updatedAt: NOW,
    });
    lotByComponent.set(c.code, lotNumber);
  }

  const dailyCycleByMachine = new Map(); // machineId -> ideal-ish cycle sec (ổn định)
  const getCycle = (mid) => {
    if (!dailyCycleByMachine.has(mid)) dailyCycleByMachine.set(mid, randInt(18, 40));
    return dailyCycleByMachine.get(mid);
  };

  // helper: bump daily/oee/fact agg
  function bumpAgg(machineId, dayOffset, shift, verdict, productId, bucket, isFirstAtBucket) {
    const m = machineRows.find((x) => x.id === machineId);
    const dk = `${machineId}|${dayOffset}`;
    if (!dailyAgg.has(dk)) dailyAgg.set(dk, { machineId, factoryId: simFactoryId, workshopId: m.workshopId, total: 0, ok: 0, ng: 0, ntf: 0, dayOffset });
    const da = dailyAgg.get(dk); da.total++; da[verdict === "OK" ? "ok" : verdict === "NG" ? "ng" : "ntf"]++;
    const ok = `${machineId}|${dayOffset}|${shift}`;
    if (!oeeAgg.has(ok)) oeeAgg.set(ok, { machineId, dayOffset, shift, total: 0, ok: 0, ng: 0, ntf: 0 });
    const oa = oeeAgg.get(ok); oa.total++; oa[verdict === "OK" ? "ok" : verdict === "NG" ? "ng" : "ntf"]++;
    const fk = `${bucket.getTime()}|${machineId}|${productId}|${shift}`;
    if (!factAgg.has(fk)) factAgg.set(fk, { bucket, machineId, productId, shift, factoryId: simFactoryId, total: 0, ok: 0, ng: 0, ntf: 0 });
    const fa = factAgg.get(fk); fa.total++; fa[verdict === "OK" ? "ok" : verdict === "NG" ? "ng" : "ntf"]++;
  }

  // ── existing SIM serials (idempotent extra-guard sau purge — luôn rỗng) ──────
  // (purge đã xoá; giữ set để chắc chắn không trùng trong 1 lần chạy)
  const usedSerials = new Set();

  // ════════════════════════════════════════════════════════════════════════
  // SINH DỮ LIỆU theo ngày × line × ca × unit
  // ════════════════════════════════════════════════════════════════════════
  for (let d = DAYS - 1; d >= 0; d--) {
    for (const lid of lineIds) {
      const line = lines.get(lid);
      const prod = productByLine.get(lid);
      for (const shift of SHIFTS) {
        // ca C của "hôm nay" (d=0) chỉ mới bắt đầu → giới hạn tới NOW
        for (let u = 0; u < UNITS_PER_SHIFT; u++) {
          // giờ bắt đầu unit trong ca (rải đều)
          const spanH = (shift.endH - shift.startH);
          const frac = (u + 0.5) / UNITS_PER_SHIFT;
          const hAbs = shift.startH + frac * spanH;          // có thể ≥24 (ca C wrap)
          const wrap = hAbs >= 24;
          const hh = Math.floor(hAbs) % 24;
          const mm = Math.floor((hAbs - Math.floor(hAbs)) * 60);
          const calDay = wrap ? d - 1 : d;                  // ngày LỊCH thực (ca C qua nửa đêm)
          const t0 = localAt(calDay, hh, mm, randInt(0, 59));
          if (t0.getTime() > NOW.getTime()) continue; // chưa xảy ra (tương lai)

          const serial = `SIM-${short(line.code)}-${yyyymmdd(localMidnight(d))}-${shift.code}${String(u).padStart(3, "0")}`;
          if (usedSerials.has(serial)) continue;
          usedSerials.add(serial);

          const shiftCode = shift.code;

          // Verdict ĐỘC LẬP mỗi trạm (OK/NG/NTF theo STATION_RATES). Board "ship"
          // khi KHÔNG trạm nào NG (NTF = tốt, xuất được).
          const verdicts = {};
          for (const stRole of INSPECTION_STATIONS) {
            const r = STATION_RATES[stRole] ?? { ng: 0.02, ntf: 0.01 };
            const roll = Math.random();
            verdicts[stRole] = roll < r.ng ? "NG" : roll < r.ng + r.ntf ? "NTF" : "OK";
          }
          const boardHadNG = INSPECTION_STATIONS.some((s) => verdicts[s] === "NG");

          // Sinh inspection cho từng trạm inspection (cùng serial)
          for (let si = 0; si < INSPECTION_STATIONS.length; si++) {
            const stRole = INSPECTION_STATIONS[si];
            const mach = machineByLineRole.get(`${lid}|${stRole}`);
            if (!mach) continue;
            const tStation = new Date(t0.getTime() + si * 2 * 60 * 1000); // +2 phút/trạm
            if (tStation.getTime() > NOW.getTime()) break;

            // verdict tại trạm này: NTF → máy báo NG (original) nhưng chốt NTF.
            const overall = verdicts[stRole];
            const original = overall === "OK" ? "OK" : "NG";

            const bucket = localAt(calDay, hh, 0, 0); // hourly bucket (local, calendar-day)
            bumpAgg(mach.id, calDay, shiftCode, overall, prod.id, bucket, si === 0);

            const cyc = getCycle(mach.id) + normal(0, 2);
            inspections.push({
              machineId: mach.id, productModelId: prod.id,
              corporateCode: "SIM", factoryCode: "SIM-FAC", workshopCode,
              lineCode: line.code, stageCode: stRole,
              productionOrderCode: `SIM-PO-${short(line.code)}`,
              operatorId: `SIM-OP-${shiftCode}`, serialNumber: serial, productModel: prod.code,
              batchNumber: `SIM-BATCH-${short(line.code)}-${yyyymmdd(localMidnight(d))}`,
              overallResult: overall, originalResult: original,
              inspectionTime: tStation, cycleTime: String(round(Math.max(5, cyc), 2)),
              notes: JSON.stringify({ source: "SIM", shift: shiftCode, doc: "46-FE-W0.2" }),
              ingestMode: null, createdAt: tStation, updatedAt: tStation,
              _serial: serial,
              // measurement_results chỉ sinh ở trạm đo
              _measure: stRole === MEASURE_STATION,
              _overall: overall,
            });

            // process_results tại ICT/FCT
            if (FUNCTIONAL_STATIONS.includes(stRole)) {
              const passFail = overall === "NG" ? "fail" : "pass";
              processResults.push({
                serialNumber: serial, machineId: mach.id, machineType: mach.machineType,
                stepType: stRole === "ICT" ? "in_circuit_test" : "functional_test",
                stationId: null, lineCode: line.code, productionOrderCode: `SIM-PO-${short(line.code)}`,
                lotCode: `SIM-BATCH-${short(line.code)}`, result: passFail,
                metrics: { source: "SIM", testVoltage: round(3.3 + normal(0, 0.05), 3), current_mA: round(120 + normal(0, 6), 1), station: stRole },
                recipeRef: `SIM-${prod.code}-${stRole}`, measuredAt: tStation, recordedBy: userId,
                createdAt: tStation,
              });
            }
          }

          // measurement_results (trạm AOI) nối theo serial+stage lúc flush (bên dưới).

          // ── genealogy: born → station(s) → ship + component installs ──
          const lotCode = `SIM-BATCH-${short(line.code)}-${yyyymmdd(localMidnight(d))}`;
          genealogyInputs.push({
            serialNumber: serial, parentSerial: null, eventType: "born",
            stationCode: null, lotCode, productModelId: prod.id,
            payload: { source: "SIM", product: prod.code, line: line.code, shift: shiftCode },
            recordedAt: t0,
          });
          // component installs (merge) tại ASSY
          const assyMach = machineByLineRole.get(`${lid}|ASSY`);
          const tAssy = new Date(t0.getTime() + 30 * 1000);
          for (const c of SIM_COMPONENTS) {
            if (!chance(0.85)) continue;
            const refDes = `${c.ref}${randInt(1, 40)}`;
            genealogyInputs.push({
              serialNumber: serial, parentSerial: null, eventType: "merge",
              stationCode: "ASSY", lotCode: lotByComponent.get(c.code), productModelId: prod.id,
              payload: { source: "SIM", kind: "componentInstallation", componentCode: c.code, refDesignator: refDes, lot: lotByComponent.get(c.code) },
              recordedAt: tAssy,
            });
            componentInstalls.push({
              serialNumber: serial, componentCode: c.code, componentSerial: null,
              machineId: assyMach?.id ?? null, qty: "1", refDesignator: refDes,
              installedAt: tAssy, installedBy: userId, createdAt: tAssy,
              _lotNumber: lotByComponent.get(c.code), // resolve supplierLotId sau
            });
          }
          // station pass events (theo verdict độc lập mỗi trạm)
          for (let si = 0; si < INSPECTION_STATIONS.length; si++) {
            const stRole = INSPECTION_STATIONS[si];
            const tStation = new Date(t0.getTime() + si * 2 * 60 * 1000);
            const passed = verdicts[stRole] !== "NG";
            genealogyInputs.push({
              serialNumber: serial, parentSerial: null, eventType: "station",
              stationCode: stRole, lotCode, productModelId: prod.id,
              payload: { source: "SIM", station: stRole, result: passed ? "PASS" : "FAIL" },
              recordedAt: tStation,
            });
          }
          // ship nếu board không NG ở trạm nào
          if (!boardHadNG) {
            const hadNTF = INSPECTION_STATIONS.some((s) => verdicts[s] === "NTF");
            genealogyInputs.push({
              serialNumber: serial, parentSerial: null, eventType: "ship",
              stationCode: "PACK", lotCode, productModelId: prod.id,
              payload: { source: "SIM", disposition: hadNTF ? "ship_after_ntf" : "ship" },
              recordedAt: new Date(t0.getTime() + 12 * 60 * 1000),
            });
          }
        } // unit
      } // shift
    } // line
  } // day

  // ── measurement_results: gắn theo từng inspection AOI ──
  // Ta cần inspectionId (serial → id) sau khi insert inspections. Sinh measurement
  // "specs" giờ (giá trị), nối inspectionId lúc flush.
  const measureSpecByKey = new Map(); // serial -> {productPoints, overall}
  for (const insp of inspections) {
    if (!insp._measure) continue;
    const prod = productList.find((p) => p.id === insp.productModelId);
    if (!prod) continue;
    measureSpecByKey.set(insp._serial, { product: prod, overall: insp._overall });
  }

  // ── idealCycleTime per máy — NHẤT QUÁN với volume + online-time để LIVE OEE
  //    (oeeService: performance = ideal×count / online-seconds) ra P ~ PERF_TARGET,
  //    KHÔNG bị ~0% do sản lượng SIM thấp so với thời gian online 24h. Cột này bị
  //    "chôn" (không hiển thị) nên implied-cycle lớn ở line SIM sản lượng thấp là
  //    đánh đổi chấp nhận được để A/P/Q hiển thị lành mạnh & nhất quán.
  const countPerDayByMachine = new Map();
  for (const da of dailyAgg.values())
    countPerDayByMachine.set(da.machineId, (countPerDayByMachine.get(da.machineId) || 0) + da.total);
  const idealByMachine = new Map();
  const ONLINE_SEC_DAY = AVAIL_TARGET * 86400;
  for (const m of machineRows) {
    const cpd = (countPerDayByMachine.get(m.id) || 0) / DAYS; // count/ngày
    const ideal = cpd > 0 ? Math.min(5400, Math.max(5, Math.round(PERF_TARGET * ONLINE_SEC_DAY / cpd))) : 30;
    idealByMachine.set(m.id, ideal);
  }

  // ════════════════════════════════════════════════════════════════════════
  // DOWNTIME + STATUS LOGS — offline = downtime + "idle/standby" để đạt
  // availability ~ AVAIL_TARGET (getLineOEE: A = online/(online+offline)).
  // ════════════════════════════════════════════════════════════════════════
  for (let d = DAYS - 1; d >= 0; d--) {
    const midnight = localMidnight(d);
    if (midnight.getTime() > NOW.getTime()) continue;
    const dayEnd = Math.min(NOW.getTime(), localMidnight(d - 1).getTime());
    const dayMinutes = Math.max(1, Math.round((dayEnd - midnight.getTime()) / 60000));
    for (const m of machineRows) {
      const role = roleOf(m.code);
      // khoảng offline: {start(ms), end(ms)} — gồm downtime + idle.
      const offBlocks = [];
      // downtime events (hiển thị top-5 + traceability)
      const pDown = OEE_STATIONS.includes(role) ? 0.30 : 0.12;
      const nDown = chance(pDown) ? randInt(1, 2) : 0;
      let downMin = 0;
      for (let k = 0; k < nDown; k++) {
        const start = localAt(d, randInt(6, 21), randInt(0, 59), 0);
        if (start.getTime() > NOW.getTime()) continue;
        const dur = randInt(8, 48);
        let end = new Date(Math.min(NOW.getTime(), start.getTime() + dur * 60000));
        const rr = pick(DOWNTIME_REASONS);
        const mins = Math.max(1, Math.round((end - start) / 60000));
        downMin += mins;
        offBlocks.push({ s: start.getTime(), e: end.getTime() });
        downtimes.push({
          machineId: m.id, machineCode: m.code, category: rr.category, reason: rr.reason,
          detailedReason: `[SIM] ${rr.reason} — mô phỏng doc 46 FE-W0.2`,
          startTime: start, endTime: end, duration: mins,
          detectionMethod: "AUTO", reportedBy: userId, affectedUnits: randInt(0, 6),
          createdAt: start, updatedAt: end,
        });
      }
      // idle/standby block để tổng offline ≈ (1-AVAIL_TARGET) × dayMinutes
      const targetOffMin = Math.round((1 - AVAIL_TARGET + (Math.random() - 0.5) * 0.06) * dayMinutes);
      const idleMin = Math.max(0, targetOffMin - downMin);
      if (idleMin > 0) {
        const idleStart = localAt(d, randInt(0, 4), randInt(0, 59), 0); // rạng sáng (ít SX)
        let s = idleStart.getTime();
        let e = Math.min(dayEnd, s + idleMin * 60000);
        if (e > s) offBlocks.push({ s, e });
      }
      // Hợp nhất + phát log: online 00:00, toggle offline/online tại biên.
      offBlocks.sort((a, b) => a.s - b.s);
      statusLogs.push({ machineId: m.id, status: "online", ipAddress: "SIM", timestamp: midnight, notificationSent: false, createdAt: midnight });
      let cursor = midnight.getTime();
      for (const b of offBlocks) {
        if (b.s <= cursor) { cursor = Math.max(cursor, b.e); continue; } // gộp chồng lấn
        const sD = new Date(b.s);
        statusLogs.push({ machineId: m.id, status: "offline", ipAddress: "SIM", timestamp: sD, notificationSent: false, createdAt: sD });
        if (b.e < NOW.getTime()) {
          const eD = new Date(b.e);
          statusLogs.push({ machineId: m.id, status: "online", ipAddress: "SIM", timestamp: eD, notificationSent: false, createdAt: eD });
        }
        cursor = b.e;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // FLUSH — insert theo thứ tự FK-an toàn, bulk theo chunk.
  // ════════════════════════════════════════════════════════════════════════
  async function bulk(table, rows, cols, chunk = 800) {
    if (!rows.length) return;
    // guard: thay undefined → null (postgres.js từ chối undefined)
    for (const r of rows) for (const c of cols) if (r[c] === undefined) r[c] = null;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      await sql`INSERT INTO ${sql(table)} ${sql(slice, ...cols)}`;
    }
    add(`${table}(+)`, rows.length);
  }

  // supplier_lots
  await bulk("supplier_lots", supplierLots,
    ["supplierLotNumber", "materialCode", "materialName", "quantity", "remainingQuantity", "unit", "status", "createdAt", "updatedAt"]);
  // resolve supplierLotId cho component installs
  const lotIdByNumber = new Map();
  for (const r of await sql`SELECT id, "supplierLotNumber" FROM supplier_lots WHERE "supplierLotNumber" LIKE 'SIM-%'`)
    lotIdByNumber.set(r.supplierLotNumber, r.id);

  // product_inspections
  const inspCols = ["machineId", "productModelId", "corporateCode", "factoryCode", "workshopCode",
    "lineCode", "stageCode", "productionOrderCode", "operatorId", "serialNumber", "productModel",
    "batchNumber", "overallResult", "originalResult", "inspectionTime", "cycleTime", "notes",
    "createdAt", "updatedAt"];
  await bulk("product_inspections", inspections.map((r) => ({
    machineId: r.machineId, productModelId: r.productModelId, corporateCode: r.corporateCode,
    factoryCode: r.factoryCode, workshopCode: r.workshopCode, lineCode: r.lineCode, stageCode: r.stageCode,
    productionOrderCode: r.productionOrderCode, operatorId: r.operatorId, serialNumber: r.serialNumber,
    productModel: r.productModel, batchNumber: r.batchNumber, overallResult: r.overallResult,
    originalResult: r.originalResult, inspectionTime: r.inspectionTime, cycleTime: r.cycleTime,
    notes: r.notes, createdAt: r.createdAt, updatedAt: r.updatedAt,
  })), inspCols);

  // map (serial, stage) -> inspectionId cho AOI để nối measurement_results
  const aoiInspIdBySerial = new Map();
  for (const r of await sql`SELECT id, "serialNumber" FROM product_inspections
      WHERE "serialNumber" LIKE 'SIM-%' AND "stageCode" = ${MEASURE_STATION}`) {
    aoiInspIdBySerial.set(r.serialNumber, r.id);
  }

  // measurement_results: sinh giá trị + nối inspectionId
  for (const [serial, spec] of measureSpecByKey) {
    const inspId = aoiInspIdBySerial.get(serial);
    if (!inspId) continue;
    const pts = spec.product.points;
    const failPointIdx = spec.overall !== "OK" ? randInt(0, pts.length - 1) : -1;
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const N = pt.n, L = pt.l, U = pt.u;
      const halfT = Math.min(U - N, N - L);
      const cpk = 1.0 + Math.random() * 0.67;                 // Cpk ~ 1.0..1.67
      const sigma = Math.max(1e-6, halfT / (3 * cpk));
      const bias = normal(0, halfT * 0.08);                   // dịch tâm nhẹ
      let value, res, defId = null, defSev = null, defCode = null;
      if (i === failPointIdx) {
        // ngoài giới hạn (một phía)
        const hi = Math.random() < 0.5;
        value = hi ? U + Math.abs(normal(sigma, sigma)) : L - Math.abs(normal(sigma, sigma));
        res = spec.overall === "NTF" ? "NTF" : "NG";          // NTF board = báo giả
        const df = pick(defects); defId = df.id; defSev = df.severity; defCode = df.code;
      } else {
        value = normal(N + bias, sigma);
        // kẹp trong giới hạn để giữ OK (nếu lỡ ra ngoài do đuôi phân phối)
        if (value < L) value = L + Math.abs(normal(0, sigma)) * 0.3;
        if (value > U) value = U - Math.abs(normal(0, sigma)) * 0.3;
        res = "OK";
      }
      results.push({
        inspectionId: inspId, pointDefId: spec.product.pointIdByCode[pt.code],
        measuredValue: String(round(value, 6)), result: res,
        defectCatalogId: defId, defectSeverity: defSev, defectCodeRaw: defCode,
        remark: res === "OK" ? null : "SIM defect", createdAt: NOW,
      });
    }
  }
  await bulk("measurement_results", results,
    ["inspectionId", "pointDefId", "measuredValue", "result", "defectCatalogId", "defectSeverity", "defectCodeRaw", "remark", "createdAt"]);

  // process_results
  await bulk("process_results", processResults,
    ["serialNumber", "machineId", "machineType", "stepType", "stationId", "lineCode",
     "productionOrderCode", "lotCode", "result", "metrics", "recipeRef", "measuredAt", "recordedBy", "createdAt"]);

  // component_installations (nối supplierLotId)
  const ciRows = componentInstalls.map((r) => ({
    serialNumber: r.serialNumber, componentCode: r.componentCode, componentSerial: r.componentSerial,
    supplierLotId: lotIdByNumber.get(r._lotNumber) ?? null, machineId: r.machineId,
    qty: r.qty, refDesignator: r.refDesignator, installedAt: r.installedAt, installedBy: r.installedBy, createdAt: r.createdAt,
  }));
  await bulk("component_installations", ciRows,
    ["serialNumber", "componentCode", "componentSerial", "supplierLotId", "machineId", "qty", "refDesignator", "installedAt", "installedBy", "createdAt"]);

  // downtime_events
  await bulk("downtime_events", downtimes,
    ["machineId", "machineCode", "category", "reason", "detailedReason", "startTime", "endTime",
     "duration", "detectionMethod", "reportedBy", "affectedUnits", "createdAt", "updatedAt"]);

  // machine_status_logs
  await bulk("machine_status_logs", statusLogs,
    ["machineId", "status", "ipAddress", "timestamp", "notificationSent", "createdAt"]);

  // daily_statistics (UPSERT theo uq machineId+date)
  const dsRows = [];
  for (const da of dailyAgg.values()) {
    const yieldRate = da.total > 0 ? round(((da.ok + da.ntf) / da.total) * 100, 2) : 0;
    dsRows.push({
      machineId: da.machineId, factoryId: da.factoryId, workshopId: da.workshopId,
      date: localMidnight(da.dayOffset), totalCount: da.total, okCount: da.ok, ngCount: da.ng,
      ntfCount: da.ntf, yieldRate: String(yieldRate), avgCycleTime: String(round(getCycle(da.machineId) + 5, 2)),
      createdAt: NOW, updatedAt: NOW,
    });
  }
  for (let i = 0; i < dsRows.length; i += 500) {
    const slice = dsRows.slice(i, i + 500);
    await sql`INSERT INTO daily_statistics ${sql(slice, "machineId", "factoryId", "workshopId", "date", "totalCount", "okCount", "ngCount", "ntfCount", "yieldRate", "avgCycleTime", "createdAt", "updatedAt")}
      ON CONFLICT ("machineId", "date") DO UPDATE SET
        "totalCount" = EXCLUDED."totalCount", "okCount" = EXCLUDED."okCount",
        "ngCount" = EXCLUDED."ngCount", "ntfCount" = EXCLUDED."ntfCount",
        "yieldRate" = EXCLUDED."yieldRate", "avgCycleTime" = EXCLUDED."avgCycleTime", "updatedAt" = EXCLUDED."updatedAt"`;
  }
  add("daily_statistics(+)", dsRows.length);

  // oee_metrics (per máy sản xuất × ca × ngày) — A/P/Q/OEE nhất quán plannedTime/runTime/counts/ideal
  const oeeRows = [];
  for (const oa of oeeAgg.values()) {
    const m = machineRows.find((x) => x.id === oa.machineId);
    if (!m || !OEE_STATIONS.includes(roleOf(m.code))) continue;
    const planned = 480; // phút/ca
    const availFrac = AVAIL_TARGET + (Math.random() - 0.5) * 0.08; // ~91% ±4
    const runTime = Math.max(1, Math.round(planned * availFrac));
    const total = oa.total, good = oa.ok + oa.ntf, reject = oa.ng;
    if (total === 0) continue;
    const qualFrac = good / total;
    // ideal NHẤT QUÁN với LIVE path (idealByMachine). Performance snapshot = min(1, ideal×count/(runTime×60)).
    const ideal = idealByMachine.get(oa.machineId) ?? 30;
    const perfFrac = Math.max(0.05, Math.min(1, ideal * total / (runTime * 60)));
    const availStored = Math.round((runTime / planned) * 10000);
    const perfStored = Math.round(perfFrac * 10000);
    const qualStored = Math.round(qualFrac * 10000);
    const oeeStored = Math.round((runTime / planned) * perfFrac * qualFrac * 10000);
    // timestamp = cuối ca (local)
    const sh = SHIFTS.find((s) => s.code === oa.shift);
    let tsEnd = localAt(oa.dayOffset, Math.min(23, sh.endH % 24 || 6), 0, 0);
    if (tsEnd.getTime() > NOW.getTime()) tsEnd = new Date(NOW.getTime());
    oeeRows.push({
      machineId: oa.machineId, machineCode: m.code, timestamp: tsEnd, periodType: "SHIFT",
      availability: availStored, performance: perfStored, quality: qualStored, oee: oeeStored,
      plannedTime: planned, runTime, idealCycleTime: ideal, totalCount: total, goodCount: good,
      rejectCount: reject, calculatedBy: "SIM", notes: JSON.stringify({ source: "SIM", shift: oa.shift }), createdAt: NOW,
    });
  }
  await bulk("oee_metrics", oeeRows,
    ["machineId", "machineCode", "timestamp", "periodType", "availability", "performance", "quality",
     "oee", "plannedTime", "runTime", "idealCycleTime", "totalCount", "goodCount", "rejectCount", "calculatedBy", "notes", "createdAt"]);

  // fact_inspection_hourly (UPSERT theo grain)
  const factRows = [];
  for (const fa of factAgg.values()) {
    const yieldPct = fa.total > 0 ? round(((fa.ok + fa.ntf) / fa.total) * 100, 2) : 0;
    factRows.push({
      bucketHour: fa.bucket, factoryId: fa.factoryId, machineId: fa.machineId,
      productModelId: fa.productId, shiftCode: fa.shift, totalCount: fa.total,
      okCount: fa.ok, ngCount: fa.ng, ntfCount: fa.ntf, yieldPct: String(yieldPct),
      fpyPct: String(yieldPct), computedAt: NOW,
    });
  }
  for (let i = 0; i < factRows.length; i += 500) {
    const slice = factRows.slice(i, i + 500);
    await sql`INSERT INTO fact_inspection_hourly ${sql(slice, "bucketHour", "factoryId", "machineId", "productModelId", "shiftCode", "totalCount", "okCount", "ngCount", "ntfCount", "yieldPct", "fpyPct", "computedAt")}
      ON CONFLICT ("bucketHour", "machineId", "productModelId", "shiftCode") DO UPDATE SET
        "totalCount" = EXCLUDED."totalCount", "okCount" = EXCLUDED."okCount",
        "ngCount" = EXCLUDED."ngCount", "ntfCount" = EXCLUDED."ntfCount",
        "yieldPct" = EXCLUDED."yieldPct", "fpyPct" = EXCLUDED."fpyPct", "computedAt" = EXCLUDED."computedAt"`;
  }
  add("fact_inspection_hourly(+)", factRows.length);

  // dim_shift / dim_product (sync nhẹ — giúp reporting mart)
  for (const s of await sql`SELECT code, name, "startHour", "startMinute", "endHour", "endMinute", COALESCE("factoryId",0) AS fid FROM shift_configs WHERE "isActive" = true`) {
    await sql`INSERT INTO dim_shift ("shiftCode", name, "startHour", "startMinute", "endHour", "endMinute", "factoryId", "updatedAt")
      VALUES (${s.code}, ${s.name}, ${s.startHour}, ${s.startMinute}, ${s.endHour}, ${s.endMinute}, ${s.fid}, ${NOW})
      ON CONFLICT ("shiftCode", "factoryId") DO UPDATE SET name = EXCLUDED.name, "updatedAt" = EXCLUDED."updatedAt"`;
  }
  for (const p of productList) {
    const [pm] = await sql`SELECT id, code, name, category FROM product_models WHERE id = ${p.id}`;
    await sql`INSERT INTO dim_product ("productModelId", code, name, category, "updatedAt")
      VALUES (${pm.id}, ${pm.code}, ${pm.name}, ${pm.category}, ${NOW})
      ON CONFLICT ("productModelId") DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, "updatedAt" = EXCLUDED."updatedAt"`;
  }

  // ── production_orders (plan-vs-actual) — 1 active/line + dùng số THỰC làm completed ──
  const poRows = [];
  const lpaRows = [];
  const windowStart = localMidnight(DAYS - 1);
  for (const lid of lineIds) {
    const line = lines.get(lid);
    const prod = productByLine.get(lid);
    // sản lượng thực của line (tổng theo mọi máy inspection trong cửa sổ)
    const lineInspIds = machineRows
      .filter((m) => m.lineId === lid && INSPECTION_STATIONS.includes(roleOf(m.code)))
      .map((m) => m.id);
    const [{ total, ok, ng, ntf }] = await sql`
      SELECT COALESCE(SUM("totalCount"),0)::int AS total, COALESCE(SUM("okCount"),0)::int AS ok,
             COALESCE(SUM("ngCount"),0)::int AS ng, COALESCE(SUM("ntfCount"),0)::int AS ntf
      FROM daily_statistics WHERE "factoryId" = ${simFactoryId} AND "machineId" IN ${sql(lineInspIds.length ? lineInspIds : [-1])}`;
    // target/ngày ~ số line output/ngày → để plan-vs-actual (elapsed×target) hợp lý
    const perDayTarget = Math.max(1, Math.round(total / DAYS));
    poRows.push({
      orderCode: `SIM-PO-${short(line.code)}`, companyCode: "SIM", factoryId: simFactoryId,
      workshopId: line.workshopId,
      lineId: lid, productModelId: prod.id, targetQuantity: perDayTarget,
      completedQuantity: total, okQuantity: ok, ngQuantity: ng, ntfQuantity: ntf, status: "in_progress",
      priority: 1, plannedStartDate: windowStart, plannedEndDate: localAt(-30, 0), actualStartDate: windowStart,
      notes: `[SIM] Lệnh SX mô phỏng doc 46 FE-W0.2`, createdBy: userId, createdAt: windowStart, updatedAt: NOW,
    });
    lpaRows.push({
      lineId: lid, productModelId: prod.id, isActive: true, startDate: windowStart,
      notes: `[SIM] gán sản phẩm doc 46`, createdAt: windowStart, updatedAt: NOW,
    });
  }
  await bulk("production_orders", poRows,
    ["orderCode", "companyCode", "factoryId", "workshopId", "lineId", "productModelId", "targetQuantity",
     "completedQuantity", "okQuantity", "ngQuantity", "ntfQuantity", "status", "priority",
     "plannedStartDate", "plannedEndDate", "actualStartDate", "notes", "createdBy", "createdAt", "updatedAt"]);
  await bulk("line_product_assignments", lpaRows,
    ["lineId", "productModelId", "isActive", "startDate", "notes", "createdAt", "updatedAt"]);

  // ════════════════════════════════════════════════════════════════════════
  // GENEALOGY hash-chain — tính hash TUẦN TỰ (global chain) rồi bulk insert.
  // ════════════════════════════════════════════════════════════════════════
  // sắp theo recordedAt để chain có thứ tự thời gian hợp lý (id tăng ~ thời gian)
  genealogyInputs.sort((a, b) => a.recordedAt - b.recordedAt);
  let prevHash = GENESIS;
  const genRows = [];
  for (const gi of genealogyInputs) {
    const R = readBack(gi.recordedAt);
    // Đồng bộ payload với những gì JSONB thực sự LƯU (drop undefined) → hash khớp read-back.
    const payload = JSON.parse(JSON.stringify(gi.payload));
    const input = {
      serialNumber: gi.serialNumber, parentSerial: gi.parentSerial, eventType: gi.eventType,
      stationCode: gi.stationCode, lotCode: gi.lotCode, productModelId: gi.productModelId,
      payload, recordedAt: R,
    };
    const curr = hashEntry(prevHash, input);
    genRows.push({
      prevHash, currHash: curr, serialNumber: gi.serialNumber, parentSerial: gi.parentSerial,
      eventType: gi.eventType, stationCode: gi.stationCode, lotCode: gi.lotCode,
      productModelId: gi.productModelId, payload, recordedBy: userId, recordedAt: gi.recordedAt,
    });
    prevHash = curr;
  }
  await bulk("genealogy_chain", genRows,
    ["prevHash", "currHash", "serialNumber", "parentSerial", "eventType", "stationCode",
     "lotCode", "productModelId", "payload", "recordedBy", "recordedAt"], 600);

  await report(simFactoryId);
}

// ═══════════════════════════════════════════════════════════════════════════
// REPORT — tally + verify chain + SQL chứng minh dashboard có data.
// ═══════════════════════════════════════════════════════════════════════════
async function report(simFactoryId) {
  console.log("\n[sim/prod] HOÀN TẤT. Tally:");
  for (const [t, n] of Object.entries(tally)) console.log(`  ${t.padEnd(30)} ${n >= 0 ? "" : ""}${n}`);

  // Verify genealogy chain (đọc lại bằng chính driver → như app verify).
  const chain = await sql`SELECT "prevHash","currHash","serialNumber","parentSerial","eventType",
    "stationCode","lotCode","productModelId",payload,"recordedAt" FROM genealogy_chain ORDER BY id ASC`;
  let ok = true, badId = null, p = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    if (r.prevHash !== p) { ok = false; badId = i; break; }
    const rec = r.recordedAt instanceof Date ? r.recordedAt : new Date(r.recordedAt);
    const exp = hashEntry(p, {
      serialNumber: r.serialNumber, parentSerial: r.parentSerial, eventType: r.eventType,
      stationCode: r.stationCode, lotCode: r.lotCode, productModelId: r.productModelId,
      payload: r.payload, recordedAt: rec,
    });
    if (exp !== r.currHash) { ok = false; badId = i; break; }
    p = r.currHash;
  }
  console.log(`\n[sim/prod] genealogy_chain verify: ${ok ? "OK" : "FAIL@" + badId} (rows=${chain.length})`);

  if (PURGE_ONLY) return;

  // ── SQL chứng minh ──
  const [ins] = await sql`SELECT count(*)::int AS n,
    count(*) FILTER (WHERE "overallResult"='OK')::int AS ok,
    count(*) FILTER (WHERE "overallResult"='NG')::int AS ng,
    count(*) FILTER (WHERE "overallResult"='NTF')::int AS ntf
    FROM product_inspections WHERE "serialNumber" LIKE 'SIM-%'`;
  const yieldPct = ins.n ? round(((ins.ok + ins.ntf) / ins.n) * 100, 2) : 0;
  console.log(`\n[verify] product_inspections SIM = ${ins.n}  (OK=${ins.ok} NG=${ins.ng} NTF=${ins.ntf} → yield ${yieldPct}%)`);

  const [mr] = await sql`SELECT count(*)::int AS n FROM measurement_results
    WHERE "inspectionId" IN (SELECT id FROM product_inspections WHERE "serialNumber" LIKE 'SIM-%')`;
  console.log(`[verify] measurement_results SIM = ${mr.n}`);

  const [oe] = await sql`SELECT count(*)::int AS n, round(avg(oee)/100.0,1) AS avg_oee,
    round(avg(availability)/100.0,1) AS avg_a, round(avg(performance)/100.0,1) AS avg_p,
    round(avg(quality)/100.0,1) AS avg_q FROM oee_metrics WHERE "calculatedBy"='SIM'`;
  console.log(`[verify] oee_metrics SIM = ${oe.n}  avg OEE=${oe.avg_oee}%  A=${oe.avg_a}% P=${oe.avg_p}% Q=${oe.avg_q}%`);

  console.log(`[verify] yield theo line (fact_inspection_hourly SIM):`);
  const byLine = await sql`
    SELECT pl.code AS line, SUM(f."totalCount")::int AS total, SUM(f."okCount")::int AS ok,
           SUM(f."ngCount")::int AS ng, SUM(f."ntfCount")::int AS ntf,
           round(SUM(f."okCount"+f."ntfCount")*100.0/NULLIF(SUM(f."totalCount"),0),2) AS yield_pct
    FROM fact_inspection_hourly f
    JOIN machines m ON m.id = f."machineId"
    JOIN stations s ON s.id = m."stationId"
    JOIN production_lines pl ON pl.id = s."lineId"
    WHERE f."factoryId" = ${simFactoryId}
    GROUP BY pl.code ORDER BY pl.code`;
  for (const r of byLine) console.log(`         ${r.line}  total=${r.total}  ok=${r.ok} ng=${r.ng} ntf=${r.ntf}  yield=${r.yield_pct}%`);

  const [others] = await sql`SELECT
    (SELECT count(*) FROM downtime_events WHERE "detailedReason" LIKE '%[SIM]%')::int AS downtime,
    (SELECT count(*) FROM production_orders WHERE "orderCode" LIKE 'SIM-PO-%')::int AS orders,
    (SELECT count(*) FROM genealogy_chain WHERE "serialNumber" LIKE 'SIM-%')::int AS gene,
    (SELECT count(*) FROM component_installations WHERE "serialNumber" LIKE 'SIM-%')::int AS comp,
    (SELECT count(*) FROM process_results WHERE "serialNumber" LIKE 'SIM-%')::int AS proc,
    (SELECT count(*) FROM machine_status_logs WHERE "ipAddress"='SIM')::int AS status,
    (SELECT count(*) FROM daily_statistics WHERE "factoryId"=${simFactoryId})::int AS daily`;
  console.log(`[verify] downtime=${others.downtime} orders=${others.orders} genealogy=${others.gene} components=${others.comp} process=${others.proc} status_logs=${others.status} daily_stats=${others.daily}`);
  console.log("\n[sim/prod] Xoá lại toàn bộ dữ liệu SIM:  node scripts/sim-factory/seed-production.mjs --purge\n");
}

main()
  .then(() => sql.end())
  .catch((err) => { console.error("[sim/prod] LỖI:", err); sql.end(); process.exit(1); });
