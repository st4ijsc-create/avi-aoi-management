/**
 * SIMULATOR — Máy BẮT VÍT (SCREWDRIVE) đẩy PROCESS-RESULT qua đường ingest THẬT.
 *
 * doc 56 Đợt 1 việc 11 — đạo cụ cho green-gate Đ1 + pilot Đ3.
 *
 * Mô phỏng controller máy siết vít gửi kết quả TỪNG CHU TRÌNH siết qua HTTP POST
 * tới endpoint REST THẬT của hệ thống:
 *
 *     POST {BASE}/api/v1/ingest/process-result
 *
 * Dùng envelope "ST4I Standard Process Feed v1" (schemaVersion "1.0"). Dữ liệu đi
 * QUA đường ingest + auth THẬT như firmware máy thật — **KHÔNG ghi thẳng DB**:
 * requireScope(ingest:write) → tRPC machineApi.submitProcessResult → recordProcessResult
 * (idempotency ledger + WAL store-forward + genealogy). Đây là điểm khác biệt cốt lõi
 * so với các sim khác chỉ nói MQTT/OPC-UA.
 *
 * ĐIỀU KIỆN phía server để nhận 201 (thay vì 401/412):
 *   • PROCESS_RESULT_INGEST_ENABLED=true  — cờ master (mặc định OFF ⇒ endpoint ship
 *     dark, submitProcessResult ném PRECONDITION_FAILED ⇒ REST trả 400 ingest_failed).
 *   • Máy SCRW-SIM-01 (hoặc --machine) đã ENROLL trong bảng machines và có khoá
 *     mk_… (apiKey per-máy) — chính là credential ta gửi ở header.
 *
 * AUTH (dùng cách đơn giản nhất): khoá mk_ gửi qua header
 *     Authorization: Bearer <mk_…>
 *   ⚠ Server `extractKey` (server/api/v1/auth.ts) CHỈ đọc scheme `Bearer` hoặc header
 *     `X-API-Key` — KHÔNG đọc "Authorization: ApiKey". Vì vậy ta dùng Bearer (đúng như
 *     server/api/v1/processResultIngest.test.ts). Đổi sang X-API-Key: --authHeader x-api-key.
 *   Khoá này resolve thành machine-principal (scope ingest:write) nên VỪA qua
 *   requireScope VỪA để authenticateMachine resolve đúng máy (thứ tự ưu tiên
 *   headerKey ?? body.apiKey ?? body.machineCode). `machineCode` cũng đặt trong body
 *   cho khớp envelope. LƯU Ý: endpoint REST bắt buộc có khoá ở HEADER — chỉ đặt
 *   machineCode/apiKey trong body (không header) sẽ bị requireScope chặn 401.
 *
 * VÍ DỤ:
 *   node scripts/sim/screwdriver-emitter.mjs --machine SCRW-SIM-01 --apiKey mk_xxx
 *   node scripts/sim/screwdriver-emitter.mjs --apiKey mk_xxx --intervalMs 1500 --faultRate 0.1
 *   SIM_MACHINE_KEY=mk_xxx node scripts/sim/screwdriver-emitter.mjs --count 20
 *   node scripts/sim/screwdriver-emitter.mjs --apiKey mk_xxx --count 3 --idempotencyRetry
 *   node scripts/sim/screwdriver-emitter.mjs --base http://127.0.0.1:3000 --help
 *
 * KHÔNG thêm dependency — chỉ Node core (global fetch, Node 18+) + ./lib/util.mjs.
 */
import { parseArgs, opt, makeLogger, gaussian, clamp, onShutdown, isMain } from "./lib/util.mjs";

const args = parseArgs();

// ── options (CLI arg > env SIM_* > default) ──────────────────────────────────
const HELP = args.help === true || args.h === true;

// BASE: --base / SIM_BASE_URL thắng; nếu không, dùng PORT (khớp server) rồi 3000.
const BASE = String(
  opt(args, "base", "SIM_BASE_URL", process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : "http://127.0.0.1:3000"),
).replace(/\/+$/, "");
const ENDPOINT = `${BASE}/api/v1/ingest/process-result`;

const MACHINE = String(opt(args, "machine", "SIM_MACHINE", "SCRW-SIM-01"));
const API_KEY = String(opt(args, "apiKey", "SIM_MACHINE_KEY", "")).trim();
const AUTH_HEADER = String(opt(args, "authHeader", "SIM_AUTH_HEADER", "bearer")).toLowerCase();
const SERIAL_PREFIX = String(opt(args, "serialPrefix", "SIM_SERIAL_PREFIX", "SN"));
const START_SERIAL = Number(opt(args, "startSerial", "SIM_START_SERIAL", 1));
const INTERVAL_MS = Number(opt(args, "intervalMs", "SIM_INTERVAL_MS", 3000));
const COUNT = Number(opt(args, "count", "SIM_COUNT", 0)); // 0 = vô hạn
const FAULT_RATE = clamp(Number(opt(args, "faultRate", "SIM_FAULT_RATE", 0.05)), 0, 1);
const TIMEOUT_MS = Number(opt(args, "timeoutMs", "SIM_TIMEOUT_MS", 8000));
const STEP_TYPE = String(opt(args, "stepType", "SIM_STEP_TYPE", "screw_tightening"));
const RECIPE_CODE = String(opt(args, "recipe", "SIM_RECIPE", "SCRW-RC-001"));
const RECIPE_VERSION = String(opt(args, "recipeVersion", "SIM_RECIPE_VERSION", "1"));

// Đặc tính siết vít (pilot Đ3 có thể tinh chỉnh): nominal 12 Nm, dung sai ±1.5.
const TORQUE_NOMINAL = Number(opt(args, "torqueNominal", "SIM_TORQUE_NOMINAL", 12));
const TORQUE_TOL = Number(opt(args, "torqueTol", "SIM_TORQUE_TOL", 1.5));
const TORQUE_SIGMA = Number(opt(args, "torqueSigma", "SIM_TORQUE_SIGMA", 0.4));
const ANGLE_NOMINAL = Number(opt(args, "angleNominal", "SIM_ANGLE_NOMINAL", 360));
const ANGLE_TOL = Number(opt(args, "angleTol", "SIM_ANGLE_TOL", 30));

const LSL = +(TORQUE_NOMINAL - TORQUE_TOL).toFixed(3); // 10.5
const USL = +(TORQUE_NOMINAL + TORQUE_TOL).toFixed(3); // 13.5
const ANGLE_LSL = +(ANGLE_NOMINAL - ANGLE_TOL).toFixed(1); // 330
const ANGLE_USL = +(ANGLE_NOMINAL + ANGLE_TOL).toFixed(1); // 390
const WAVE_RATE_HZ = 100;

const truthy = (v) => v === true || v === 1 || /^(1|true|yes|on)$/i.test(String(v ?? ""));
const RETRY = truthy(opt(args, "idempotencyRetry", "SIM_IDEMPOTENCY_RETRY", false));

const log = makeLogger(`SCRW ${MACHINE}`);

// ── help (không cần mạng) ────────────────────────────────────────────────────
function printHelp() {
  console.log(`
screwdriver-emitter.mjs — sim máy bắt vít → POST /api/v1/ingest/process-result (đường ingest THẬT)

Cách dùng:
  node scripts/sim/screwdriver-emitter.mjs --apiKey mk_xxx [options]

Options (CLI arg > env > default):
  --base <url>            ${BASE}            (env SIM_BASE_URL / PORT)
  --machine <code>        machineCode                        (env SIM_MACHINE, default SCRW-SIM-01)
  --apiKey <mk_…>         khoá per-máy → header auth          (env SIM_MACHINE_KEY)  ⚠ bắt buộc để 201
  --authHeader <scheme>   bearer | x-api-key                  (env SIM_AUTH_HEADER, default bearer)
  --serialPrefix <s>      tiền tố serial                      (env SIM_SERIAL_PREFIX, default SN)
  --startSerial <n>       số serial bắt đầu                   (default 1)
  --intervalMs <n>        giãn cách giữa 2 chu trình          (env SIM_INTERVAL_MS, default 3000)
  --count <n>             số chu trình (0 = vô hạn)           (env SIM_COUNT, default 0)
  --faultRate <0..1>      tỉ lệ siết lỗi (torque ngoài dung sai) (env SIM_FAULT_RATE, default 0.05)
  --idempotencyRetry      gửi trùng idempotencyKey 1 lần/chu trình để test dedup (default off)
  --timeoutMs <n>         timeout mỗi POST                    (default 8000)
  --stepType <s>          default screw_tightening
  --recipe <code>         default SCRW-RC-001    --recipeVersion <v>  default 1
  --torqueNominal/--torqueTol/--torqueSigma/--angleNominal/--angleTol   tinh chỉnh đặc tính
  --help                  in trợ giúp này rồi thoát

Yêu cầu server: PROCESS_RESULT_INGEST_ENABLED=true + máy đã enroll có khoá mk_.
`);
}

// ── payload builder ──────────────────────────────────────────────────────────

/** Sinh (torque, angle, result) cho 1 chu trình siết. */
function genCycle() {
  const forcedFail = Math.random() < FAULT_RATE;
  let torque;
  if (forcedFail) {
    // Đẩy ra ngoài [LSL,USL]: nửa dưới (trờn ren / cross-thread) nửa trên (kẹt / jam).
    torque = Math.random() < 0.5 ? LSL - (0.3 + Math.random() * 1.5) : USL + (0.3 + Math.random() * 1.5);
  } else {
    // Siết đạt: quanh nominal, kẹp vào trong dung sai để nhiễu không tạo fail giả.
    torque = clamp(TORQUE_NOMINAL + gaussian(TORQUE_SIGMA), LSL + 0.05, USL - 0.05);
  }
  const result = torque < LSL || torque > USL ? "fail" : "pass";
  // Góc: chu trình lỗi có phương sai lớn hơn (kẹt sớm hoặc trờn ren quay thêm).
  const angle = clamp(ANGLE_NOMINAL + gaussian(result === "fail" ? 18 : 6), 60, 720);
  return { torque: +torque.toFixed(3), angle: +angle.toFixed(1), result };
}

/**
 * Đường cong chữ ký siết (torque-vs-angle), ~45 điểm: rundown gần 0 rồi vọt lên đỉnh
 * khi vít chạm đế. samples = [[angle, torque], …]; điểm cuối = (finalAngle, peakTorque).
 */
function buildWaveform(finalAngle, peakTorque) {
  const N = 45;
  const samples = [];
  for (let i = 0; i < N; i++) {
    const frac = i / (N - 1);
    let t;
    if (frac < 0.6) {
      // Rundown: torque rất nhỏ + nhiễu dương bé.
      t = peakTorque * 0.06 * frac + Math.abs(gaussian(0.02));
    } else {
      // Seating: tăng bậc hai tới đỉnh.
      const s = (frac - 0.6) / 0.4;
      t = peakTorque * (0.036 + 0.964 * s * s);
    }
    samples.push([+(finalAngle * frac).toFixed(1), +t.toFixed(3)]);
  }
  samples[N - 1] = [+finalAngle.toFixed(1), +peakTorque.toFixed(3)];
  return samples;
}

/** Envelope "ST4I Standard Process Feed v1" cho 1 chu trình. */
function buildPayload(seq) {
  const serialNumber = `${SERIAL_PREFIX}${String(seq).padStart(6, "0")}`;
  const { torque, angle, result } = genCycle();
  return {
    serialNumber,
    result,
    payload: {
      schemaVersion: "1.0",
      machineCode: MACHINE,
      serialNumber,
      stepType: STEP_TYPE,
      result,
      ts: new Date().toISOString(), // 'Z' = offset UTC hợp lệ (refineProcessTime yêu cầu có offset)
      recipe: { code: RECIPE_CODE, version: RECIPE_VERSION },
      metrics: [
        { name: "torque", value: torque, unit: "Nm", lsl: LSL, usl: USL, nominal: TORQUE_NOMINAL },
        { name: "angle", value: angle, unit: "deg", lsl: ANGLE_LSL, usl: ANGLE_USL, nominal: ANGLE_NOMINAL },
      ],
      waveforms: [{ name: "torque_angle", unit: "Nm", rateHz: WAVE_RATE_HZ, samples: buildWaveform(angle, torque) }],
      idempotencyKey: `${MACHINE}-${serialNumber}`, // ≥ 8 ký tự (min do server yêu cầu)
    },
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function buildHeaders() {
  const h = { "content-type": "application/json" };
  if (API_KEY) {
    if (AUTH_HEADER === "x-api-key") h["x-api-key"] = API_KEY;
    else h["authorization"] = `Bearer ${API_KEY}`;
  }
  return h;
}
const HEADERS = buildHeaders();

/** Một lần POST. Trả { status, ok, body }; ném khi lỗi mạng/timeout. */
async function postOnce(payload) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null; // phản hồi không phải JSON
  }
  return { status: res.status, ok: res.ok, body };
}

/** POST + retry nhẹ (chỉ khi LỖI MẠNG/timeout, không retry HTTP 4xx/5xx). */
async function postWithRetry(payload, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await postOnce(payload);
    } catch (err) {
      lastErr = err;
      if (attempt < retries && !stopping) await sleep(250 * (attempt + 1));
    }
  }
  return { status: 0, ok: false, body: null, networkError: lastErr?.message ?? String(lastErr) };
}

// ── stats + logging ──────────────────────────────────────────────────────────
const stats = { cycles: 0, posted: 0, accepted: 0, pass: 0, fail: 0, httpError: 0, networkError: 0, duplicate: 0 };

function recordResult(seq, serial, result, torque, r, isRetry) {
  const tag = isRetry ? "↻ " : "  ";
  if (r.status === 0) {
    stats.networkError++;
    log.error(`${tag}#${seq} ${serial} ${result} torque=${torque}Nm → NETWORK ERROR: ${r.networkError}`);
    return;
  }
  const twoxx = r.status >= 200 && r.status < 300;
  const okBody = r.body?.ok === true;
  const dup = r.body?.data?.duplicate === true;
  if (twoxx && okBody) {
    const id = r.body?.data?.processResultId ?? r.body?.data?.id ?? "-";
    if (!isRetry) {
      stats.posted++;
      stats.accepted++;
      if (result === "pass") stats.pass++;
      else if (result === "fail") stats.fail++;
    }
    if (dup) stats.duplicate++;
    log.info(`${tag}#${seq} ${serial} ${result} torque=${torque}Nm → HTTP ${r.status} ok id=${id}${dup ? " DUPLICATE ✓" : ""}`);
    if (isRetry && !dup) log.warn(`     retry KHÔNG được dedup (đáng lẽ duplicate) — kiểm tra process_idempotency_keys`);
  } else {
    if (!isRetry) {
      stats.posted++;
      stats.httpError++;
    }
    const code = r.body?.error?.code ?? "?";
    const msg = r.body?.error?.message ?? "(no body)";
    log.warn(`${tag}#${seq} ${serial} ${result} torque=${torque}Nm → HTTP ${r.status} FAIL ${code}: ${msg}`);
  }
}

let summaryPrinted = false;
function printSummary(reason) {
  if (summaryPrinted) return;
  summaryPrinted = true;
  log.info("──────────── summary ────────────");
  log.info(`reason=${reason}`);
  log.info(`cycles=${stats.cycles} posted=${stats.posted} accepted=${stats.accepted} httpError=${stats.httpError} networkError=${stats.networkError}`);
  log.info(`result: pass=${stats.pass} fail=${stats.fail}  |  duplicates(dedup ✓)=${stats.duplicate}`);
  log.info("─────────────────────────────────");
}

// ── loop ─────────────────────────────────────────────────────────────────────
let stopping = false;
let pendingSleep = null;
function sleep(ms) {
  return new Promise((resolve) => {
    pendingSleep = setTimeout(() => {
      pendingSleep = null;
      resolve();
    }, ms);
  });
}

async function doCycle(seq) {
  const { serialNumber, result, payload } = buildPayload(seq);
  const torque = payload.metrics[0].value;
  stats.cycles++;
  const r = await postWithRetry(payload);
  recordResult(seq, serialNumber, result, torque, r, false);

  // --idempotencyRetry: sau POST thành công, gửi LẠI y hệt (cùng idempotencyKey) 1 lần.
  if (RETRY && !stopping && r.status >= 200 && r.status < 300 && r.body?.ok === true) {
    log.info(`     ↻ retry #${seq} (idempotencyKey=${payload.idempotencyKey}) → expect duplicate`);
    const r2 = await postWithRetry(payload);
    recordResult(seq, serialNumber, result, torque, r2, true);
  }
}

function banner() {
  log.info(`emitter → POST ${ENDPOINT}`);
  log.info(
    `machine=${MACHINE} auth=${API_KEY ? `${AUTH_HEADER}(${API_KEY.slice(0, 6)}…)` : "NONE ⚠"} interval=${INTERVAL_MS}ms count=${COUNT || "∞"} faultRate=${FAULT_RATE} retry=${RETRY}`,
  );
  log.info(`torque nominal=${TORQUE_NOMINAL}Nm lsl=${LSL} usl=${USL} | angle nominal=${ANGLE_NOMINAL}° | stepType=${STEP_TYPE} recipe=${RECIPE_CODE}/${RECIPE_VERSION}`);
  if (!API_KEY) {
    log.warn("KHÔNG có --apiKey / SIM_MACHINE_KEY → endpoint sẽ trả 401 (requireScope cần khoá ở header).");
  }
  if (!truthy(process.env.PROCESS_RESULT_INGEST_ENABLED)) {
    log.warn("PROCESS_RESULT_INGEST_ENABLED chưa =true trong process này (chỉ nhắc — server quyết định); nếu server tắt cờ ⇒ 400 ingest_failed (PRECONDITION_FAILED).");
  }
}

async function run() {
  banner();
  let seq = START_SERIAL;
  let done = 0;
  while (!stopping && (COUNT === 0 || done < COUNT)) {
    const t0 = Date.now();
    await doCycle(seq);
    seq++;
    done++;
    if (stopping || (COUNT !== 0 && done >= COUNT)) break;
    const wait = Math.max(0, INTERVAL_MS - (Date.now() - t0));
    await sleep(wait);
  }
  if (!stopping) {
    printSummary("done");
    process.exit(0);
  }
}

// SIGINT/SIGTERM → in summary rồi thoát sạch.
onShutdown(async () => {
  stopping = true;
  if (pendingSleep) clearTimeout(pendingSleep);
  printSummary("interrupted (SIGINT/SIGTERM)");
});

if (isMain(import.meta.url)) {
  if (HELP) {
    printHelp();
    process.exit(0);
  }
  run().catch((err) => {
    log.error(`fatal: ${err?.stack ?? err?.message ?? err}`);
    printSummary("fatal");
    process.exit(1);
  });
}
