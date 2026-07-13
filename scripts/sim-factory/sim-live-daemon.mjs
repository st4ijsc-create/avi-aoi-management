// scripts/sim-factory/sim-live-daemon.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Doc 48 R2 — ROLLING FULL-SIM DAEMON (L5 #1: seed tĩnh 2026-07-12 không cuộn tới).
//
// VẤN ĐỀ: seed-production.mjs bơm 1 ẢNH TĨNH (snapshot) tại thời điểm chạy. Đến hôm
//   sau, mọi dashboard quản lý đọc "hôm nay" → RỖNG (warRoom/andon/OEE hiển thị "—")
//   dù FE đã nối dây đầy đủ. Bằng chứng: product_inspections mới nhất 2026-07-12T07:2x,
//   daily_statistics.date mới nhất 07-11 → filter `date >= hôm-nay` ra 0 hàng.
//
// GIẢI PHÁP: một DAEMON CHẠY LIÊN TỤC, mỗi "tick" (mặc định 45s) bơm một LÁT sản
//   xuất MỚI có mốc thời gian ~now() để dashboard render SỐ LIVE. Đây thực chất là
//   "chạy một lát nhỏ của seed-production, nhưng cho N phút cuối kết thúc tại NOW, lặp".
//   TÁI DÙNG đúng logic sinh + đúng đường-đọc dashboard mà seed-production đã dò.
//   Lần chạy đầu tiên trong ngày: BACKFILL nhẹ [nửa-đêm → now] để "hôm nay" có sản
//   lượng hợp lý + A/P/Q nhất quán ngay lập tức (online-window = count-window = cả ngày).
//
// NHÃN "SIM-LIVE" (TÁCH khỏi seed-production nhãn 'SIM' để purge độc lập, KHÔNG phá
//   baseline 14 ngày của seed):
//     product_inspections   serialNumber LIKE 'SIM-LIVE-%'  + notes source:"SIM-LIVE"
//     measurement_results   (theo inspectionId của inspection SIM-LIVE)
//     oee_metrics           calculatedBy = 'SIM-LIVE'
//     machine_status_logs   ipAddress = 'SIM-LIVE'
//     downtime_events       detailedReason LIKE '%[SIM-LIVE]%'
//     andon_events          message LIKE '%[SIM-LIVE]%'  (raisedBySystem=true)
//     daily_statistics / fact_inspection_hourly  — HÀNG DẪN XUẤT của NGÀY HÔM NAY
//       (nhà máy SIM-FAC): daemon CỘNG THÊM vào hàng hôm-nay (ON CONFLICT ADD), mốc
//       `date`/`bucketHour` theo ĐÚNG quy ước JS-local của seed để KHỚP & gộp 1 hàng.
//
// ĐƯỜNG-ĐỌC được nuôi (đã kiểm chứng trong code server):
//   • warRoom.briefing (warRoomService)        — getLineOEE(daily_statistics + machine_status_logs
//                                                 + oee_metrics.idealCycleTime) + fact_inspection_hourly (so ca)
//                                                 + downtime_events (top-5) + production_orders (plan).
//   • productionDashboard.getStationOverview   — product_inspections theo trạm/giờ.
//   • dashboard.getStats / andon board         — product_inspections inspectionTime>=hôm-nay + andon_events chưa resolve.
//   • alarmKpi.summary                          — andon_events (+ predictive_alerts).
//
// TÍNH NHẤT QUÁN OEE (LIVE ~82-88%): status_logs cho A≈91%; ideal cycle được HIỆU
//   CHỈNH mỗi tick = PERF_TARGET×online/count (kẹp [5,5400]) → LIVE performance≈92%;
//   quality=(ok+ntf)/total≈98%. → OEE = A×P×Q ≈ 0.82-0.86.
//
// AN TOÀN: chỉ THÊM/XOÁ bản ghi NHÃN SIM-LIVE (hoặc hàng-hôm-nay nhà máy SIM). KHÔNG
//   đụng dữ liệu THẬT, KHÔNG đụng baseline seed-production (nhãn 'SIM' ngày cũ). Reversible.
//   KHÔNG sửa server/ hay client/. Ghi thẳng DB thật là HÀNH ĐỘNG CHỦ ĐÍCH (doc 48 R2).
//
// CHỐNG PHÌNH: mỗi tick xoay vòng (rotate) bản ghi SIM-LIVE cũ hơn 7 ngày (mặc định).
//
// CHẠY:
//   npm run sim:live                         (daemon vô hạn, tick 45s — Ctrl-C để dừng)
//   npm run sim:live -- --interval 30        (tick 30s)
//   npm run sim:live -- --ticks 3            (chạy đúng 3 tick rồi thoát — dùng để CHỨNG MINH)
//   npm run sim:live -- --once               (1 tick rồi thoát)
//   npm run sim:live -- --no-backfill        (bỏ backfill đầu-ngày)
//   npm run sim:live -- --purge              (XOÁ sạch dữ liệu SIM-LIVE + hàng-hôm-nay SIM)
//   Chạy nền:  (Windows)  start /b node scripts/sim-factory/sim-live-daemon.mjs > sim-live.log 2>&1
//              (bash)     nohup node scripts/sim-factory/sim-live-daemon.mjs > sim-live.log 2>&1 &
// ─────────────────────────────────────────────────────────────────────────────
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

// ── Nạp .env THẬT (giống seed-production) ────────────────────────────────────
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) dotenv.config({ path: envPath });

function maskUrl(url) {
  try { const u = new URL(url); if (u.password) u.password = "***"; return u.toString(); }
  catch { return String(url).replace(/\/\/[^@]*@/, "//***@"); }
}

// ── Resolve DB URL: ưu tiên aoi superuser cho seeding (doc 48: sim script dùng role
//    'aoi', KHÔNG dùng avi_app WORM append-only). SIM_DATABASE_URL override được. ──
function resolveDbUrl() {
  if (process.env.SIM_DATABASE_URL) return process.env.SIM_DATABASE_URL;
  const base = process.env.DATABASE_URL || "";
  if (/@127\.0\.0\.1:5434\/aoi_management/.test(base) && !/:\/\/aoi:/.test(base)) {
    return base.replace(/\/\/[^@]*@/, "//aoi:aoi@");
  }
  return base || "postgresql://aoi:aoi@127.0.0.1:5434/aoi_management";
}

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getOpt = (f, dflt) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const INTERVAL_SEC = Math.min(600, Math.max(5, parseInt(getOpt("--interval", "45"), 10) || 45));
const MAX_TICKS = hasFlag("--once") ? 1 : (hasFlag("--ticks") ? Math.max(1, parseInt(getOpt("--ticks", "3"), 10) || 3) : Infinity);
const BOARDS_OPT = hasFlag("--boards") ? Math.max(1, parseInt(getOpt("--boards", "4"), 10) || 4) : null;
const RETAIN_DAYS = Math.max(1, parseInt(getOpt("--retain-days", "7"), 10) || 7);
const NO_BACKFILL = hasFlag("--no-backfill");
const PURGE_ONLY = hasFlag("--purge");

const url = resolveDbUrl();

console.log(
  "\n══════════════════════════════════════════════════════════════════\n" +
  "[sim/live] ROLLING FULL-SIM DAEMON — GHI DỮ LIỆU NHÃN \"SIM-LIVE\" vào DB THẬT\n" +
  `           target DB : ${maskUrl(url)}\n` +
  (/sim/i.test(url) ? "" :
   "           ⚠ DB KHÔNG chứa 'sim' → đây là DB SẢN XUẤT. Mọi bản ghi gắn nhãn\n" +
   "             SIM-LIVE và ĐẢO NGƯỢC được bằng `--purge` (doc 48 R2, chủ đích).\n") +
  `           mode      : ${PURGE_ONLY ? "PURGE-ONLY (xoá dữ liệu SIM-LIVE)" :
     `DAEMON tick=${INTERVAL_SEC}s ticks=${MAX_TICKS === Infinity ? "∞" : MAX_TICKS} retain=${RETAIN_DAYS}d backfill=${NO_BACKFILL ? "off" : "on"}`}\n` +
  "══════════════════════════════════════════════════════════════════\n",
);

const sql = postgres(url, { max: 4, onnotice: () => {} });

// ── RNG + time helpers (LOCAL wall-clock — khớp seed-production) ──────────────
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p) { return Math.random() < p; }
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
const short = (code) => code.replace(/^SIM-/, "");
function shiftForHour(h) { return h >= 6 && h < 14 ? "A" : h >= 14 && h < 22 ? "B" : "C"; }
function localMidnightOf(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
function localHourOf(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0); }
function ymd(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }

// ── Cấu hình sinh (mirror seed-production) ────────────────────────────────────
const INSPECTION_STATIONS = ["SPI", "AOI", "AVI", "ICT", "FCT"];
const MEASURE_STATION = "AOI";
const OEE_STATIONS = ["SPI", "AOI", "ICT", "FCT", "AVI", "ASSY"];
const AVAIL_TARGET = 0.92; // A ~92%
const PERF_TARGET = 0.95;  // P ~95% (kẹp int ideal → ~94% thực) → OEE = A×P×Q ≈ 0.85 với Q~0.98
const NG_RATE = 0.02, NTF_RATE = 0.01; // OK ~97% / NTF ~1% / NG ~2% → finalYield ~98%
const BACKFILL_PER_HOUR = 45;          // board/line/giờ khi backfill đầu-ngày (bounded)
const BACKFILL_CAP = 800;              // trần board/line backfill (chống phình)
const DOWNTIME_REASONS = [
  { category: "breakdown", reason: "Kẹt băng tải" },
  { category: "changeover", reason: "Đổi sản phẩm" },
  { category: "unplanned", reason: "NG vượt ngưỡng" },
  { category: "breakdown", reason: "Lỗi cấp liệu feeder" },
  { category: "maintenance", reason: "Bảo trì đột xuất" },
];
const ANDON_SPECS = [
  { state: "yellow", reason: "quality", title: "Cảnh báo chất lượng" },
  { state: "yellow", reason: "material", title: "Chờ cấp vật tư" },
  { state: "red", reason: "maintenance", title: "Máy dừng — cần bảo trì" },
  { state: "yellow", reason: "setup", title: "Đổi model / setup" },
];

// ═══════════════════════════════════════════════════════════════════════════
// PURGE — xoá dữ-liệu SIM-LIVE (theo nhãn). olderThan=null → xoá HẾT + hàng-hôm-nay.
// KHÔNG đụng baseline seed-production (nhãn 'SIM' các NGÀY CŨ).
// ═══════════════════════════════════════════════════════════════════════════
async function purgeLive(simFactoryId, olderThan) {
  const tally = {};
  const add = (t, n) => { if (n) tally[t] = (tally[t] ?? 0) + n; };
  const tsCut = olderThan ? sql`AND "timestamp" < ${olderThan}` : sql``;
  const insCut = olderThan ? sql`AND "inspectionTime" < ${olderThan}` : sql``;
  const stCut = olderThan ? sql`AND "startTime" < ${olderThan}` : sql``;
  const raCut = olderThan ? sql`AND "raisedAt" < ${olderThan}` : sql``;

  const mr = await sql`DELETE FROM measurement_results WHERE "inspectionId" IN
    (SELECT id FROM product_inspections WHERE "serialNumber" LIKE 'SIM-LIVE-%' ${insCut})`;
  add("measurement_results", mr.count);
  const pi = await sql`DELETE FROM product_inspections WHERE "serialNumber" LIKE 'SIM-LIVE-%' ${insCut}`;
  add("product_inspections", pi.count);
  const oe = await sql`DELETE FROM oee_metrics WHERE "calculatedBy" = 'SIM-LIVE' ${tsCut}`;
  add("oee_metrics", oe.count);
  const ms = await sql`DELETE FROM machine_status_logs WHERE "ipAddress" = 'SIM-LIVE' ${tsCut}`;
  add("machine_status_logs", ms.count);
  const dt = await sql`DELETE FROM downtime_events WHERE "detailedReason" LIKE '%[SIM-LIVE]%' ${stCut}`;
  add("downtime_events", dt.count);
  const an = await sql`DELETE FROM andon_events WHERE "message" LIKE '%[SIM-LIVE]%' ${raCut}`;
  add("andon_events", an.count);
  if (!olderThan) {
    const po = await sql`DELETE FROM production_orders WHERE "orderCode" LIKE 'SIM-LIVE-PO-%'`;
    add("production_orders", po.count);
  }

  if (!olderThan) {
    const todayMid = localMidnightOf(new Date());
    const ds = await sql`DELETE FROM daily_statistics WHERE "factoryId" = ${simFactoryId} AND "date" >= ${todayMid}`;
    add("daily_statistics(today)", ds.count);
    const fh = await sql`DELETE FROM fact_inspection_hourly WHERE "factoryId" = ${simFactoryId} AND "bucketHour" >= ${todayMid}`;
    add("fact_inspection_hourly(today)", fh.count);
  }
  return tally;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOAD topology THẬT + sản phẩm SIM (đọc, KHÔNG tạo hierarchy — seed.mjs đã lo).
// ═══════════════════════════════════════════════════════════════════════════
async function loadContext() {
  const [fac] = await sql`SELECT id, code FROM factories WHERE code = 'SIM-FAC'`;
  if (!fac) {
    console.error("[sim/live] Không thấy nhà máy 'SIM-FAC'. Chạy `npm run sim:factory` trước.");
    process.exit(1);
  }
  const simFactoryId = fac.id;
  const machineRows = await sql`
    SELECT m.id, m.code, m."machineType", s."lineId", pl.code AS line_code, pl.name AS line_name,
           pl."workshopId", pl."capacityPerHour"
    FROM machines m
    JOIN stations s ON s.id = m."stationId"
    JOIN production_lines pl ON pl.id = s."lineId"
    JOIN workshops w ON w.id = pl."workshopId"
    WHERE w."factoryId" = ${simFactoryId} AND m."isActive" = true`;
  if (machineRows.length === 0) { console.error("[sim/live] Nhà máy SIM chưa có máy."); process.exit(1); }

  const [ws] = await sql`SELECT code FROM workshops WHERE "factoryId" = ${simFactoryId} ORDER BY id LIMIT 1`;
  const workshopCode = ws?.code ?? "SIM-WS";

  const roleOf = (code) => code.split("-").slice(2).join("-"); // SIM-L1-AOI → "AOI"
  const machineByLineRole = new Map();
  const lines = new Map();
  for (const m of machineRows) {
    machineByLineRole.set(`${m.lineId}|${roleOf(m.code)}`, m);
    if (!lines.has(m.lineId)) lines.set(m.lineId, {
      id: m.lineId, code: m.line_code, name: m.line_name, workshopId: m.workshopId,
      capacity: Number(m.capacityPerHour) || 600,
    });
  }
  const lineIds = [...lines.keys()].sort((a, b) => a - b);

  const products = [];
  for (const p of await sql`SELECT id, code, name FROM product_models WHERE code LIKE 'SIM-%' ORDER BY id`) {
    const points = await sql`
      SELECT id, code, "nominalValue"::float AS n, "lowerLimit"::float AS l, "upperLimit"::float AS u
      FROM measurement_point_defs WHERE "productModelId" = ${p.id} AND "deletedAt" IS NULL ORDER BY "orderIndex"`;
    products.push({ id: p.id, code: p.code, points: points.map((pt) => ({ ...pt })) });
  }
  const productByLine = new Map();
  if (products.length) lineIds.forEach((lid, i) => productByLine.set(lid, products[i % products.length]));

  const defects = (await sql`SELECT id, code, severity FROM defect_catalog
    WHERE "isActive" = true AND "deletedAt" IS NULL ORDER BY id LIMIT 12`)
    .map((d) => ({ id: d.id, code: d.code, severity: d.severity }));

  const [admin] = await sql`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true ORDER BY id LIMIT 1`;
  const userId = admin?.id ?? (await sql`SELECT id FROM users ORDER BY id LIMIT 1`)[0]?.id ?? null;

  const cycleByMachine = new Map();
  const getCycle = (mid) => {
    if (!cycleByMachine.has(mid)) cycleByMachine.set(mid, randInt(18, 40));
    return cycleByMachine.get(mid);
  };

  return { simFactoryId, machineRows, machineByLineRole, lines, lineIds, workshopCode,
           products, productByLine, defects, userId, roleOf, getCycle };
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE — sinh `boardsPerLine` board rải trong [winStart, winEnd] (≤ now).
//   Trả buffers + agg maps (thuần dữ liệu, chưa ghi DB).
// ═══════════════════════════════════════════════════════════════════════════
function generateBoards(ctx, winStart, winEnd, boardsPerLine, now, seqRef) {
  const { machineByLineRole, lines, lineIds, workshopCode, productByLine, getCycle } = ctx;
  const inspections = [], aoiSerials = [];
  const measureSpec = new Map();
  const dailyAdd = new Map();   // machineId -> {total,ok,ng,ntf,cycSum,cycN,workshopId}
  const factAdd = new Map();    // key -> {bucket,machineId,productId,shift,total,ok,ng,ntf}

  const bumpDaily = (mid, workshopId, v, cyc) => {
    if (!dailyAdd.has(mid)) dailyAdd.set(mid, { total: 0, ok: 0, ng: 0, ntf: 0, cycSum: 0, cycN: 0, workshopId });
    const d = dailyAdd.get(mid); d.total++; d[v === "OK" ? "ok" : v === "NG" ? "ng" : "ntf"]++;
    d.cycSum += cyc; d.cycN++;
  };
  const bumpFact = (mid, bucket, productId, shift, v) => {
    const k = `${bucket.getTime()}|${mid}|${productId}|${shift}`;
    if (!factAdd.has(k)) factAdd.set(k, { bucket, machineId: mid, productId, shift, total: 0, ok: 0, ng: 0, ntf: 0 });
    const f = factAdd.get(k); f.total++; f[v === "OK" ? "ok" : v === "NG" ? "ng" : "ntf"]++;
  };

  const span = Math.max(1, winEnd.getTime() - winStart.getTime());
  for (const lid of lineIds) {
    const line = lines.get(lid);
    const prod = productByLine.get(lid);
    for (let b = 0; b < boardsPerLine; b++) {
      const frac = (b + Math.random()) / boardsPerLine;
      const t0 = new Date(winStart.getTime() + frac * span);
      if (t0.getTime() > now.getTime()) continue;
      const hh = t0.getHours();
      const shift = shiftForHour(hh);
      const bucket = localHourOf(t0);
      const serial = `SIM-LIVE-${short(line.code)}-${now.getTime()}-${String(seqRef.n++).padStart(5, "0")}`;

      const verdicts = {};
      for (const st of INSPECTION_STATIONS) {
        const roll = Math.random();
        verdicts[st] = roll < NG_RATE ? "NG" : roll < NG_RATE + NTF_RATE ? "NTF" : "OK";
      }
      let aoiOverall = "OK";
      for (let si = 0; si < INSPECTION_STATIONS.length; si++) {
        const st = INSPECTION_STATIONS[si];
        const mach = machineByLineRole.get(`${lid}|${st}`);
        if (!mach) continue;
        const tSt = new Date(Math.min(now.getTime(), t0.getTime() + si * 2000));
        const overall = verdicts[st];
        const cyc = Math.max(5, getCycle(mach.id) + normal(0, 2));
        bumpDaily(mach.id, mach.workshopId, overall, cyc);
        bumpFact(mach.id, bucket, prod ? prod.id : null, shift, overall);
        inspections.push({
          machineId: mach.id, productModelId: prod ? prod.id : null,
          corporateCode: "SIM", factoryCode: "SIM-FAC", workshopCode,
          lineCode: line.code, stageCode: st, productionOrderCode: `SIM-PO-${short(line.code)}`,
          operatorId: `SIM-OP-${shift}`, serialNumber: serial, productModel: prod ? prod.code : null,
          batchNumber: `SIM-LIVE-${short(line.code)}-${ymd(t0)}`,
          overallResult: overall, originalResult: overall === "OK" ? "OK" : "NG", inspectionTime: tSt,
          cycleTime: String(round(cyc, 2)),
          notes: JSON.stringify({ source: "SIM-LIVE", shift, doc: "48-R2" }),
          createdAt: tSt, updatedAt: tSt,
        });
        if (st === MEASURE_STATION) { aoiOverall = overall; aoiSerials.push(serial); }
      }
      if (prod && prod.points.length) measureSpec.set(serial, { product: prod, overall: aoiOverall });
    }
  }
  return { inspections, aoiSerials, measureSpec, dailyAdd, factAdd };
}

// ── FLUSH sản xuất: insert inspections + measurement_results + UPSERT daily/fact ──
async function flushProduction(ctx, gen, now, add) {
  const { simFactoryId, defects, getCycle } = ctx;
  const todayMid = localMidnightOf(now);

  const inspCols = ["machineId", "productModelId", "corporateCode", "factoryCode", "workshopCode",
    "lineCode", "stageCode", "productionOrderCode", "operatorId", "serialNumber", "productModel",
    "batchNumber", "overallResult", "originalResult", "inspectionTime", "cycleTime", "notes",
    "createdAt", "updatedAt"];
  await bulk(gen.inspections, "product_inspections", inspCols, add);

  // measurement_results (trạm AOI) — nối inspectionId theo serial vừa insert.
  if (gen.measureSpec.size) {
    const idBySerial = new Map();
    for (let i = 0; i < gen.aoiSerials.length; i += 500) {
      const slice = gen.aoiSerials.slice(i, i + 500);
      for (const r of await sql`SELECT id, "serialNumber" FROM product_inspections
          WHERE "serialNumber" IN ${sql(slice)} AND "stageCode" = ${MEASURE_STATION}`)
        idBySerial.set(r.serialNumber, r.id);
    }
    const results = [];
    for (const [serial, spec] of gen.measureSpec) {
      const inspId = idBySerial.get(serial);
      if (!inspId) continue;
      const pts = spec.product.points;
      const failIdx = spec.overall !== "OK" ? randInt(0, pts.length - 1) : -1;
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const N = pt.n, L = pt.l, U = pt.u;
        const halfT = Math.min(U - N, N - L);
        const sigma = Math.max(1e-6, halfT / (3 * (1.0 + Math.random() * 0.67)));
        let value, res, defId = null, defSev = null, defCode = null;
        if (i === failIdx) {
          const hi = Math.random() < 0.5;
          value = hi ? U + Math.abs(normal(sigma, sigma)) : L - Math.abs(normal(sigma, sigma));
          res = spec.overall === "NTF" ? "NTF" : "NG";
          if (defects.length) { const df = pick(defects); defId = df.id; defSev = df.severity; defCode = df.code; }
        } else {
          value = normal(N + normal(0, halfT * 0.08), sigma);
          if (value < L) value = L + Math.abs(normal(0, sigma)) * 0.3;
          if (value > U) value = U - Math.abs(normal(0, sigma)) * 0.3;
          res = "OK";
        }
        results.push({
          inspectionId: inspId, pointDefId: pt.id, measuredValue: String(round(value, 6)),
          result: res, defectCatalogId: defId, defectSeverity: defSev, defectCodeRaw: defCode,
          remark: res === "OK" ? null : "SIM-LIVE defect", createdAt: now,
        });
      }
    }
    await bulk(results, "measurement_results",
      ["inspectionId", "pointDefId", "measuredValue", "result", "defectCatalogId", "defectSeverity", "defectCodeRaw", "remark", "createdAt"], add);
  }

  // UPSERT daily_statistics (CỘNG THÊM vào hàng HÔM NAY/máy).
  if (gen.dailyAdd.size) {
    const rows = [];
    for (const [mid, d] of gen.dailyAdd) {
      rows.push({
        machineId: mid, factoryId: simFactoryId, workshopId: d.workshopId, date: todayMid,
        totalCount: d.total, okCount: d.ok, ngCount: d.ng, ntfCount: d.ntf,
        yieldRate: String(round(((d.ok + d.ntf) / d.total) * 100, 2)),
        avgCycleTime: String(round(d.cycN ? d.cycSum / d.cycN : getCycle(mid), 2)),
        createdAt: now, updatedAt: now,
      });
    }
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      await sql`INSERT INTO daily_statistics ${sql(slice, "machineId", "factoryId", "workshopId", "date", "totalCount", "okCount", "ngCount", "ntfCount", "yieldRate", "avgCycleTime", "createdAt", "updatedAt")}
        ON CONFLICT ("machineId", "date") DO UPDATE SET
          "totalCount" = daily_statistics."totalCount" + EXCLUDED."totalCount",
          "okCount"    = daily_statistics."okCount"    + EXCLUDED."okCount",
          "ngCount"    = daily_statistics."ngCount"    + EXCLUDED."ngCount",
          "ntfCount"   = daily_statistics."ntfCount"   + EXCLUDED."ntfCount",
          "yieldRate"  = round((daily_statistics."okCount" + EXCLUDED."okCount" + daily_statistics."ntfCount" + EXCLUDED."ntfCount") * 100.0
                           / NULLIF(daily_statistics."totalCount" + EXCLUDED."totalCount", 0), 2),
          "avgCycleTime" = EXCLUDED."avgCycleTime", "updatedAt" = EXCLUDED."updatedAt"`;
    }
    add("daily_statistics(±)", rows.length);
  }

  // UPSERT fact_inspection_hourly (CỘNG THÊM theo bucket giờ).
  if (gen.factAdd.size) {
    const rows = [];
    for (const f of gen.factAdd.values()) {
      if (f.productId == null) continue;
      const yp = round(((f.ok + f.ntf) / f.total) * 100, 2);
      rows.push({
        bucketHour: f.bucket, factoryId: simFactoryId, machineId: f.machineId, productModelId: f.productId,
        shiftCode: f.shift, totalCount: f.total, okCount: f.ok, ngCount: f.ng, ntfCount: f.ntf,
        yieldPct: String(yp), fpyPct: String(yp), computedAt: now,
      });
    }
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      await sql`INSERT INTO fact_inspection_hourly ${sql(slice, "bucketHour", "factoryId", "machineId", "productModelId", "shiftCode", "totalCount", "okCount", "ngCount", "ntfCount", "yieldPct", "fpyPct", "computedAt")}
        ON CONFLICT ("bucketHour", "machineId", "productModelId", "shiftCode") DO UPDATE SET
          "totalCount" = fact_inspection_hourly."totalCount" + EXCLUDED."totalCount",
          "okCount"    = fact_inspection_hourly."okCount"    + EXCLUDED."okCount",
          "ngCount"    = fact_inspection_hourly."ngCount"    + EXCLUDED."ngCount",
          "ntfCount"   = fact_inspection_hourly."ntfCount"   + EXCLUDED."ntfCount",
          "yieldPct"   = round((fact_inspection_hourly."okCount" + EXCLUDED."okCount" + fact_inspection_hourly."ntfCount" + EXCLUDED."ntfCount") * 100.0
                           / NULLIF(fact_inspection_hourly."totalCount" + EXCLUDED."totalCount", 0), 2),
          "fpyPct"     = round((fact_inspection_hourly."okCount" + EXCLUDED."okCount") * 100.0
                           / NULLIF(fact_inspection_hourly."totalCount" + EXCLUDED."totalCount", 0), 2),
          "computedAt" = EXCLUDED."computedAt"`;
    }
    add("fact_inspection_hourly(±)", rows.length);
  }
}

// ── REFRESH dẫn xuất: rebuild status_logs (A≈AVAIL_TARGET) + oee_metrics (A/P/Q) ──
async function refreshDerived(ctx, now, add) {
  const { simFactoryId, machineRows, roleOf } = ctx;
  const todayMid = localMidnightOf(now);
  const elapsedSec = Math.max(60, (now.getTime() - todayMid.getTime()) / 1000);
  const elapsedMin = Math.max(1, Math.round(elapsedSec / 60));
  const onlineSec = AVAIL_TARGET * elapsedSec;

  // Rebuild machine_status_logs HÔM NAY: online@midnight + 1 block offline (rạng
  // sáng), hiện trạng cuối = online. → online = A×elapsed.
  await sql`DELETE FROM machine_status_logs WHERE "ipAddress" = 'SIM-LIVE' AND "timestamp" >= ${todayMid}`;
  const statusRows = [];
  for (const m of machineRows) {
    statusRows.push({ machineId: m.id, status: "online", ipAddress: "SIM-LIVE", timestamp: todayMid, notificationSent: false, createdAt: now });
    const offMin = Math.round((1 - AVAIL_TARGET) * elapsedMin * (0.9 + Math.random() * 0.2));
    if (offMin >= 2 && elapsedMin > offMin + 6) {
      const endMs = now.getTime() - 3 * 60000;
      const startMs = Math.max(todayMid.getTime() + 60000, endMs - offMin * 60000);
      if (endMs > startMs) {
        statusRows.push({ machineId: m.id, status: "offline", ipAddress: "SIM-LIVE", timestamp: new Date(startMs), notificationSent: false, createdAt: now });
        statusRows.push({ machineId: m.id, status: "online", ipAddress: "SIM-LIVE", timestamp: new Date(endMs), notificationSent: false, createdAt: now });
      }
    }
  }
  await bulk(statusRows, "machine_status_logs",
    ["machineId", "status", "ipAddress", "timestamp", "notificationSent", "createdAt"], add);

  // oee_metrics per máy sản xuất — ideal hiệu chỉnh từ count tích luỹ HÔM NAY.
  const hourFloor = localHourOf(now);
  const todayRows = await sql`SELECT "machineId", "totalCount", "okCount", "ngCount", "ntfCount"
    FROM daily_statistics WHERE "factoryId" = ${simFactoryId} AND "date" = ${todayMid}`;
  const oeeRows = [];
  for (const m of machineRows) {
    if (!OEE_STATIONS.includes(roleOf(m.code))) continue;
    const c = todayRows.find((r) => r.machineId === m.id);
    if (!c || !Number(c.totalCount)) continue;
    const total = Number(c.totalCount), good = Number(c.okCount) + Number(c.ntfCount), reject = Number(c.ngCount);
    const ideal = Math.min(5400, Math.max(5, Math.round((PERF_TARGET * onlineSec) / total)));
    const availFrac = Math.max(0, Math.min(1, AVAIL_TARGET + (Math.random() - 0.5) * 0.04));
    const perfFrac = Math.max(0.05, Math.min(1, (ideal * total) / onlineSec));
    const qualFrac = good / total;
    oeeRows.push({
      machineId: m.id, machineCode: m.code, timestamp: now, periodType: "HOUR",
      availability: Math.round(availFrac * 10000), performance: Math.round(perfFrac * 10000),
      quality: Math.round(qualFrac * 10000), oee: Math.round(availFrac * perfFrac * qualFrac * 10000),
      plannedTime: Math.round(elapsedSec / 60), runTime: Math.round(onlineSec / 60),
      idealCycleTime: ideal, totalCount: total, goodCount: good, rejectCount: reject,
      calculatedBy: "SIM-LIVE", notes: JSON.stringify({ source: "SIM-LIVE" }), createdAt: now,
    });
  }
  await sql`DELETE FROM oee_metrics WHERE "calculatedBy" = 'SIM-LIVE' AND "timestamp" >= ${hourFloor}`;
  await bulk(oeeRows, "oee_metrics",
    ["machineId", "machineCode", "timestamp", "periodType", "availability", "performance", "quality",
     "oee", "plannedTime", "runTime", "idealCycleTime", "totalCount", "goodCount", "rejectCount",
     "calculatedBy", "notes", "createdAt"], add);

  // production_orders (plan-vs-actual warRoom) — SIM-LIVE, target = phóng chiếu cả
  //   ngày (output/elapsedFraction) để expected ≈ actual (không còn 1500% ảo).
  const lineOfMachine = new Map(machineRows.map((m) => [m.id, m.lineId]));
  const lineAgg = new Map(); // lineId -> {output,ok,ng,ntf}
  for (const r of todayRows) {
    const lid = lineOfMachine.get(r.machineId); if (lid == null) continue;
    if (!lineAgg.has(lid)) lineAgg.set(lid, { output: 0, ok: 0, ng: 0, ntf: 0 });
    const a = lineAgg.get(lid);
    a.output += Number(r.totalCount); a.ok += Number(r.okCount); a.ng += Number(r.ngCount); a.ntf += Number(r.ntfCount);
  }
  const elapsedFrac = Math.max(0.05, Math.min(1, elapsedSec / 86400));
  const poRows = [];
  for (const [lid, a] of lineAgg) {
    const line = ctx.lines.get(lid); const prod = ctx.productByLine.get(lid);
    if (!line || !prod) continue;
    poRows.push({
      orderCode: `SIM-LIVE-PO-${short(line.code)}`, companyCode: "SIM", factoryId: simFactoryId,
      workshopId: line.workshopId, lineId: lid, productModelId: prod.id,
      targetQuantity: Math.max(1, Math.round(a.output / elapsedFrac)), completedQuantity: a.output,
      okQuantity: a.ok, ngQuantity: a.ng, ntfQuantity: a.ntf, status: "in_progress", priority: 1,
      plannedStartDate: todayMid, plannedEndDate: new Date(todayMid.getTime() + 86400000), actualStartDate: todayMid,
      notes: "[SIM-LIVE] plan-vs-actual daemon doc 48 R2", createdBy: ctx.userId, createdAt: now, updatedAt: now,
    });
  }
  await sql`DELETE FROM production_orders WHERE "orderCode" LIKE 'SIM-LIVE-PO-%'`;
  await bulk(poRows, "production_orders",
    ["orderCode", "companyCode", "factoryId", "workshopId", "lineId", "productModelId", "targetQuantity",
     "completedQuantity", "okQuantity", "ngQuantity", "ntfQuantity", "status", "priority",
     "plannedStartDate", "plannedEndDate", "actualStartDate", "notes", "createdBy", "createdAt", "updatedAt"], add);
}

// ── EVENTS: downtime + andon (occasional; force=true để chắc chắn sinh 1) ─────
async function maybeEvents(ctx, now, add, force) {
  const { machineRows, roleOf, userId } = ctx;
  if (force || chance(0.4)) {
    const oeeMachines = machineRows.filter((m) => OEE_STATIONS.includes(roleOf(m.code)));
    const m = pick(oeeMachines);
    const rr = pick(DOWNTIME_REASONS);
    const dur = randInt(4, 18);
    const startT = new Date(now.getTime() - dur * 60000);
    await sql`INSERT INTO downtime_events ("machineId","machineCode","category","reason","detailedReason",
        "startTime","endTime","duration","detectionMethod","reportedBy","affectedUnits","createdAt","updatedAt")
      VALUES (${m.id}, ${m.code}, ${rr.category}, ${rr.reason}, ${`[SIM-LIVE] ${rr.reason} — daemon doc 48 R2`},
        ${startT}, ${now}, ${dur}, 'AUTO', ${userId}, ${randInt(0, 5)}, ${startT}, ${now})`;
    add("downtime_events(+)", 1);
  }
  if (force || chance(0.3)) {
    const spec = pick(ANDON_SPECS);
    const m = pick(machineRows);
    await sql`INSERT INTO andon_events ("state","reason","status","lineId","machineId","title","message",
        "raisedBySystem","raisedAt","escalationLevel","createdAt")
      VALUES (${spec.state}, ${spec.reason}, 'raised', ${m.lineId}, ${m.id}, ${spec.title},
        ${`[SIM-LIVE] ${spec.title} — ${m.code} (daemon doc 48 R2)`}, true, ${now}, 0, ${now})`;
    add("andon_events(+)", 1);
  }
  const resolved = await sql`UPDATE andon_events SET "resolvedAt" = ${now}, "status" = 'resolved',
      "mttrSeconds" = GREATEST(1, EXTRACT(EPOCH FROM (${now} - "raisedAt"))::int)
    WHERE "message" LIKE '%[SIM-LIVE]%' AND "resolvedAt" IS NULL AND "raisedAt" < ${new Date(now.getTime() - 4 * 60000)}`;
  add("andon_events(resolved)", resolved.count);
}

// ── bulk insert ───────────────────────────────────────────────────────────────
async function bulk(rows, table, cols, add) {
  if (!rows.length) return;
  for (const r of rows) for (const c of cols) if (r[c] === undefined) r[c] = null;
  for (let i = 0; i < rows.length; i += 800) {
    const slice = rows.slice(i, i + 800);
    await sql`INSERT INTO ${sql(table)} ${sql(slice, ...cols)}`;
  }
  add(`${table}(+)`, rows.length);
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKFILL đầu-ngày — nếu hôm nay CHƯA có (đủ) sản lượng SIM-LIVE, sinh [midnight→now].
// ═══════════════════════════════════════════════════════════════════════════
async function backfillToday(ctx, now, seqRef) {
  const todayMid = localMidnightOf(now);
  const [cur] = await sql`SELECT COALESCE(SUM("totalCount"),0)::int n FROM daily_statistics
    WHERE "factoryId" = ${ctx.simFactoryId} AND "date" = ${todayMid}`;
  const hours = Math.max(0, (now.getTime() - todayMid.getTime()) / 3600000);
  const targetPerLine = Math.min(BACKFILL_CAP, Math.round(BACKFILL_PER_HOUR * hours));
  // đã có ~đủ (>= 60% mục tiêu) → bỏ qua (idempotent trên restart cùng ngày).
  const haveEnough = cur.n >= targetPerLine * ctx.lineIds.length * INSPECTION_STATIONS.length * 0.6;
  if (targetPerLine < 2 || haveEnough) {
    console.log(`[sim/live] backfill: bỏ qua (hôm nay đã có ${cur.n} inspection SIM).`);
    return;
  }
  const winEnd = new Date(now.getTime() - INTERVAL_SEC * 1000);
  const add = {}; const addFn = (t, n) => { if (n) add[t] = (add[t] ?? 0) + n; };
  const gen = generateBoards(ctx, todayMid, winEnd, targetPerLine, now, seqRef);
  await flushProduction(ctx, gen, now, addFn);
  console.log(`[sim/live] backfill [00:00→now] ${targetPerLine} board/line: ` +
    Object.entries(add).map(([k, v]) => `${k}=${v}`).join(" "));
}

// ═══════════════════════════════════════════════════════════════════════════
// TICK
// ═══════════════════════════════════════════════════════════════════════════
async function tick(ctx, tickIndex, seqRef) {
  const now = new Date();
  const todayMid = localMidnightOf(now);
  const tickStart = new Date(Math.max(todayMid.getTime(), now.getTime() - INTERVAL_SEC * 1000));
  const tally = {};
  const add = (t, n) => { if (n) tally[t] = (tally[t] ?? 0) + n; };

  const line0 = ctx.lines.get(ctx.lineIds[0]);
  const perLine = BOARDS_OPT ?? Math.min(20, Math.max(3, Math.round((line0.capacity * INTERVAL_SEC) / 3600)));
  const gen = generateBoards(ctx, tickStart, now, perLine, now, seqRef);
  await flushProduction(ctx, gen, now, add);
  await refreshDerived(ctx, now, add);
  await maybeEvents(ctx, now, add, tickIndex === 1);

  // Rotation: xoá bản ghi SIM-LIVE cũ hơn RETAIN_DAYS (chống phình).
  const rot = await purgeLive(ctx.simFactoryId, new Date(now.getTime() - RETAIN_DAYS * 86400 * 1000));
  for (const [k, v] of Object.entries(rot)) add(`rotate:${k}`, v);
  return { now, tally };
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFY — bằng chứng dashboard đã có dữ liệu now()-dated (shape warRoom.briefing).
// ═══════════════════════════════════════════════════════════════════════════
async function verifyLive(simFactoryId) {
  const now = new Date();
  const dayStart = localMidnightOf(now);
  const fromISO = dayStart.toISOString(), toISO = now.toISOString();

  const [ins] = await sql`SELECT count(*)::int n, max("inspectionTime") latest,
    count(*) FILTER (WHERE "overallResult"='NG')::int ng
    FROM product_inspections WHERE "serialNumber" LIKE 'SIM-LIVE-%'`;
  console.log(`[verify] product_inspections SIM-LIVE = ${ins.n} (NG=${ins.ng})  latest(read-back)=${ins.latest?.toISOString?.() ?? ins.latest}`);
  const [today] = await sql`SELECT count(*)::int n FROM product_inspections
    WHERE "inspectionTime" >= ${dayStart} AND "serialNumber" LIKE 'SIM%'`;
  console.log(`[verify] inspections HÔM NAY (andon/getStationOverview đọc) = ${today.n}`);

  const lineRows = await sql`
    WITH mach AS (
      SELECT m.id, l.id AS line_id, l.name AS line_name
      FROM machines m JOIN stations s ON s.id=m."stationId"
      JOIN production_lines l ON l.id=s."lineId" JOIN workshops w ON w.id=l."workshopId"
      WHERE m."isActive"=true AND w."factoryId"=${simFactoryId}),
    dur AS (
      SELECT o.machine_id,
        SUM(CASE WHEN o.status='online' THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(o.next_ts, ${toISO}), ${toISO})-o.ts)) ELSE 0 END) online_sec,
        SUM(CASE WHEN o.status<>'online' THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(o.next_ts, ${toISO}), ${toISO})-o.ts)) ELSE 0 END) offline_sec
      FROM (SELECT "machineId" machine_id, status, "timestamp" ts,
                   LEAD("timestamp") OVER (PARTITION BY "machineId" ORDER BY "timestamp") next_ts
            FROM machine_status_logs WHERE "timestamp">=${fromISO} AND "timestamp"<=${toISO}) o
      GROUP BY o.machine_id),
    prod AS (
      SELECT "machineId" machine_id, SUM("totalCount") total, SUM("okCount"+"ntfCount") good, SUM("ngCount") ng
      FROM daily_statistics WHERE "date">=${fromISO} AND "date"<=${toISO} GROUP BY "machineId"),
    ideal AS (
      SELECT DISTINCT ON ("machineId") "machineId" machine_id, "idealCycleTime" ic
      FROM oee_metrics WHERE "idealCycleTime" IS NOT NULL ORDER BY "machineId","timestamp" DESC)
    SELECT mach.line_name,
      SUM(COALESCE(p.total,0))::int output, SUM(COALESCE(p.ng,0))::int ng,
      round(100.0*SUM(COALESCE(d.online_sec,0))/NULLIF(SUM(COALESCE(d.online_sec,0)+COALESCE(d.offline_sec,0)),0),1) avail_pct,
      round(100.0*SUM(COALESCE(p.good,0))/NULLIF(SUM(COALESCE(p.total,0)),0),1) qual_pct,
      round(100.0*LEAST(1.0, SUM(CASE WHEN i.ic>0 AND p.total>0 AND d.online_sec>0 THEN i.ic*p.total ELSE 0 END)
              /NULLIF(SUM(CASE WHEN i.ic>0 AND p.total>0 AND d.online_sec>0 THEN d.online_sec ELSE 0 END),0)),1) perf_pct
    FROM mach LEFT JOIN dur d ON d.machine_id=mach.id
      LEFT JOIN prod p ON p.machine_id=mach.id LEFT JOIN ideal i ON i.machine_id=mach.id
    GROUP BY mach.line_name ORDER BY mach.line_name`;
  console.log(`[verify] warRoom.briefing "lines" (today window, LIVE compute — như warRoomService):`);
  for (const r of lineRows) {
    const a = r.avail_pct, p = r.perf_pct, q = r.qual_pct;
    const oee = (a != null && p != null && q != null) ? round((a * p * q) / 10000, 1) : null;
    console.log(`   ${String(r.line_name).padEnd(18)} output=${String(r.output).padStart(5)} ng=${String(r.ng).padStart(3)}  A=${a}% P=${p}% Q=${q}%  OEE=${oee}%`);
  }

  const [fh] = await sql`SELECT count(*)::int n, count(DISTINCT "shiftCode")::int shifts FROM fact_inspection_hourly
    WHERE "factoryId"=${simFactoryId} AND "bucketHour">=${dayStart}`;
  console.log(`[verify] fact_inspection_hourly hôm nay = ${fh.n} rows / ${fh.shifts} ca (warRoom shiftCompare)`);
  const [an] = await sql`SELECT count(*) FILTER (WHERE "resolvedAt" IS NULL)::int active,
    count(*)::int total FROM andon_events WHERE "message" LIKE '%[SIM-LIVE]%'`;
  console.log(`[verify] andon_events SIM-LIVE: active=${an.active} total=${an.total} (andon board + alarmKpi)`);
  const [dt] = await sql`SELECT count(*)::int n FROM downtime_events WHERE "detailedReason" LIKE '%[SIM-LIVE]%'`;
  const [oe] = await sql`SELECT count(*)::int n, round(avg(oee)/100.0,1) avg_oee, round(avg(availability)/100.0,1) a,
    round(avg(performance)/100.0,1) p, round(avg(quality)/100.0,1) q FROM oee_metrics WHERE "calculatedBy"='SIM-LIVE'`;
  console.log(`[verify] oee_metrics SIM-LIVE = ${oe.n}  avg OEE=${oe.avg_oee}% (A=${oe.a}% P=${oe.p}% Q=${oe.q}%)  downtime SIM-LIVE=${dt.n}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN loop
// ═══════════════════════════════════════════════════════════════════════════
let stopping = false;
async function main() {
  const ctx = await loadContext();
  console.log(`[sim/live] topology: factory=${ctx.simFactoryId} lines=${ctx.lineIds.length} machines=${ctx.machineRows.length} products=${ctx.products.length}`);

  if (PURGE_ONLY) {
    const t = await purgeLive(ctx.simFactoryId, null);
    console.log("[sim/live] PURGE SIM-LIVE:", Object.keys(t).length ? t : "(không có gì để xoá)");
    return;
  }
  if (!ctx.products.length)
    console.warn("[sim/live] ⚠ Không thấy product_models 'SIM-%' → bỏ measurement_results (SPC). Chạy `npm run sim:production` để có định nghĩa sản phẩm/điểm đo.");

  const seqRef = { n: 0 };
  if (!NO_BACKFILL) await backfillToday(ctx, new Date(), seqRef);

  process.on("SIGINT", () => { console.log("\n[sim/live] SIGINT — dừng sau tick hiện tại…"); stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });

  let tickIndex = 0;
  while (!stopping && tickIndex < MAX_TICKS) {
    tickIndex++;
    const started = Date.now();
    try {
      const { now, tally } = await tick(ctx, tickIndex, seqRef);
      const brief = Object.entries(tally).filter(([k]) => !k.startsWith("rotate:")).map(([k, v]) => `${k}=${v}`).join(" ");
      console.log(`[sim/live] tick ${tickIndex}${MAX_TICKS === Infinity ? "" : "/" + MAX_TICKS} @ ${now.toISOString()}  ${brief}`);
    } catch (e) {
      console.error(`[sim/live] tick ${tickIndex} LỖI:`, e.message);
    }
    if (stopping || tickIndex >= MAX_TICKS) break;
    await sleepInterruptible(Math.max(0, INTERVAL_SEC * 1000 - (Date.now() - started)));
  }

  console.log(`\n[sim/live] ĐÃ CHẠY ${tickIndex} tick. Bằng chứng dashboard LIVE:`);
  await verifyLive(ctx.simFactoryId);
  console.log("\n[sim/live] Xoá lại dữ liệu SIM-LIVE:  node scripts/sim-factory/sim-live-daemon.mjs --purge\n");
}

async function sleepInterruptible(ms) {
  const step = 250;
  for (let t = 0; t < ms && !stopping; t += step)
    await new Promise((r) => setTimeout(r, Math.min(step, ms - t)));
}

main()
  .then(() => sql.end())
  .catch((err) => { console.error("[sim/live] LỖI:", err); sql.end(); process.exit(1); });
