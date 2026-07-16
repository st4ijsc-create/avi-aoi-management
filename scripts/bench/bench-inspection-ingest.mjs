#!/usr/bin/env node
// scripts/bench/bench-inspection-ingest.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Doc 51 P1 (QĐ#7) — BENCHMARK THẬT luồng ingest AVI/AOI: N máy đồng thời gọi
// submitInspection với payload thật + ảnh base64.
//
// Đây KHÔNG phải dry-run: script phát HTTP thật vào server thật, rồi ĐẾM LẠI TỪ DB
// để phát hiện thất thoát âm thầm. Doc 48 ghi "scale benchmark chỉ dry-run" — cái
// này đóng đúng lỗ đó cho tầng inspection (bench-ingest.mjs lo tầng OT telemetry).
//
// ĐO:
//   • throughput đạt được vs mục tiêu (+ % harness thực sự phát ra được)
//   • latency p50/p95/p99/p99.9
//   • lỗi theo mã: 429 / 503 / 5xx / 4xx / network / timeout
//   • ok vs duplicate vs queued(WAL) — queued = ĐÃ NHẬN NHƯNG CHƯA VÀO DB
//   • đếm lại từ DB: thất thoát âm thầm + dòng trùng (P0 0272 có giữ dưới tải?)
//   • RSS/heap app-server (nếu METRICS_ENABLED=true → /metrics)
//
// AN TOÀN: từ chối chạy khi target trông giống production; cần --yes để phát tải;
// mọi dòng ghi ra đều mang serial BENCH-<runId>-* nên dọn được sạch.
//
// CHẠY:  npm run bench:ingest -- --machines=100 --rate=1 --duration=60 --image-kb=200 --yes
// XEM:   docs/ECOSYSTEM/53_P1_INGEST_BENCHMARK_HARNESS.md
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { round } from "./lib/stats.mjs";
import {
  parseArgs, validateConfig, assessTarget, maskUrl, buildInspection, payloadBytes,
  classifyOutcome, unwrapBody, trpcErrorCode, buildResult, evaluateGates, renderMarkdown,
  rngForMachine, serialLikeFor, parsePromGauge,
  BENCH_KEY_NAME_PREFIX, BENCH_MACHINE_CODE_PREFIX,
} from "./lib/inspection-load.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");
const now = () => performance.now();
const log = (...a) => console.log("[bench-insp]", ...a);

// ── env (.env, không override biến đã set inline) ─────────────────────────────
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const HELP = `
bench-inspection-ingest — doc 51 P1 (QĐ#7): benchmark THẬT ingest AVI/AOI.

  npm run bench:ingest -- [flags]
  node scripts/bench/bench-inspection-ingest.mjs [flags]

Tải:
  --machines=100      số máy mô phỏng (mỗi máy 1 credential riêng)
  --rate=1            inspection/giây/máy
  --duration=60       thời lượng (giây)
  --points=20         số điểm đo mỗi inspection
  --image-kb=200      KB ảnh (ĐÃ GIẢI MÃ) mỗi inspection; 0 = không ảnh
  --image-points=1    số điểm đo mang ảnh (image-kb chia đều)
  --dup-pct=0         % bản gửi LẶP LẠI payload trước đó (dò idempotency P0)
  --ng-pct=5 --ntf-pct=1

Đích:
  --endpoint=rest     rest | trpc   (trpc giữ ĐÚNG mã lỗi; rest bẹp hết về 400)
  --auth=header       header | body (body = không có x-api-key → dính bucket theo IP: kịch bản NAT)
  --base-url=http://127.0.0.1:3000
  --concurrency=200   trần request đang bay
  --metrics-url=      mặc định <base-url>/metrics (RSS/heap app-server)

Vận hành:
  --yes               BẮT BUỘC để phát tải thật (không có → chỉ in kế hoạch)
  --provision         cho phép TẠO máy bench nếu DB không đủ --machines
  --station-id=<id>   station để gắn máy bench (mặc định: station nhỏ nhất)
  --keep-data         GIỮ dữ liệu bench sau khi chạy (mặc định: xoá)
  --cleanup=<runId>   chỉ dọn dữ liệu của runId (dùng "all" để dọn mọi BENCH-*)
  --run-id=<id> --label=<tên> --out=<file.json> --seed=51 --timeout-ms=30000
`;

// ── DB ───────────────────────────────────────────────────────────────────────
function makeSql() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("[bench-insp] DATABASE_URL chưa set (cần để cấp credential + đếm lại)."); process.exit(1); }
  return postgres(url, { max: 8, onnotice: () => {} });
}

/** Cấp credential bench: 1 api_keys row/máy (scope ingest:write) — cùng thuật toán hash server dùng. */
async function issueBenchKey(sql, machineId, machineCode, runId) {
  const secret = crypto.randomBytes(24).toString("hex");
  const plaintext = `mk_${secret}`;
  const keyHash = crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");
  const [row] = await sql`
    INSERT INTO api_keys (name, description, "keyHash", "keyPrefix", scopes, "isActive", "machineId")
    VALUES (${`${BENCH_KEY_NAME_PREFIX}${runId}:${machineCode}`}, ${`bench key (doc 51 P1) run ${runId}`},
            ${keyHash}, ${`mk_${secret.slice(0, 6)}`}, ${sql.json(["ingest:write"])}, true, ${machineId})
    RETURNING id`;
  return { keyId: row.id, plaintext };
}

/**
 * Lấy đủ N máy. Ưu tiên máy CÓ SẴN (đúng hiện trạng nhà máy); thiếu thì chỉ tạo
 * thêm khi --provision (tạo máy là ghi vào master data — phải cố ý).
 */
async function resolveMachines(sql, cfg, runId) {
  const existing = await sql`
    SELECT id, code FROM machines
    WHERE "isActive" = true AND code NOT LIKE ${BENCH_MACHINE_CODE_PREFIX + "%"}
    ORDER BY id LIMIT ${cfg.machines}`;
  const picked = existing.map((m) => ({ id: m.id, code: m.code, provisioned: false }));
  let provisioned = 0;

  if (picked.length < cfg.machines) {
    const missing = cfg.machines - picked.length;
    if (!cfg.provision) {
      console.error(
        `\n[bench-insp] DB chỉ có ${picked.length} máy hoạt động nhưng --machines=${cfg.machines}.\n` +
        `             Chạy với ${picked.length} máy sẽ KHÔNG chứng minh được kịch bản ${cfg.machines} máy → TỪ CHỐI.\n` +
        `             Thêm --provision để harness tự tạo ${missing} máy bench (${BENCH_MACHINE_CODE_PREFIX}*), hoặc hạ --machines.\n`);
      process.exit(3);
    }
    // Station: cho phép chỉ định; mặc định station nhỏ nhất (FK NOT NULL).
    let stationId = cfg.stationId;
    if (!stationId) {
      const [st] = await sql`SELECT id FROM stations ORDER BY id LIMIT 1`;
      if (!st) { console.error("[bench-insp] không có station nào — không thể tạo máy bench. Chạy `npm run sim:factory` trước."); process.exit(3); }
      stationId = st.id;
    }
    for (let i = 0; i < missing; i++) {
      const code = `${BENCH_MACHINE_CODE_PREFIX}${String(picked.length + 1).padStart(4, "0")}`;
      // Idempotent: lần chạy sau tái dùng máy bench cũ thay vì đẻ thêm.
      const [row] = await sql`
        INSERT INTO machines ("stationId", code, name, "machineType", "registrationStatus", "lifecycleStatus", "isActive", description)
        VALUES (${stationId}, ${code}, ${`Bench machine ${code}`}, 'AOI', 'approved', 'active', true,
                ${"Synthetic machine created by scripts/bench/bench-inspection-ingest.mjs (doc 51 P1). Safe to delete."})
        ON CONFLICT (code) DO UPDATE SET "isActive" = true
        RETURNING id, code`;
      picked.push({ id: row.id, code: row.code, provisioned: true });
      provisioned++;
    }
  }

  for (const m of picked) {
    const { keyId, plaintext } = await issueBenchKey(sql, m.id, m.code, runId);
    m.keyId = keyId;
    m.apiKey = plaintext;
  }
  return { machines: picked, provisioned, reused: picked.length - provisioned };
}

/** Xoá SẠCH mọi thứ một run đã tạo. measurement_results theo FK ON DELETE CASCADE. */
async function cleanupRun(sql, runId, opts = {}) {
  const like = serialLikeFor(runId);
  const del = await sql`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${like} RETURNING id`;
  const keyLike = runId === "all" ? `${BENCH_KEY_NAME_PREFIX}%` : `${BENCH_KEY_NAME_PREFIX}${runId}:%`;
  const keys = await sql`DELETE FROM api_keys WHERE name LIKE ${keyLike} RETURNING id`;
  let machines = 0;
  if (opts.dropMachines) {
    // Chỉ xoá máy bench KHÔNG còn inspection nào trỏ tới (FK an toàn).
    const rows = await sql`
      DELETE FROM machines m
      WHERE m.code LIKE ${BENCH_MACHINE_CODE_PREFIX + "%"}
        AND NOT EXISTS (SELECT 1 FROM product_inspections pi WHERE pi."machineId" = m.id)
      RETURNING m.id`;
    machines = rows.length;
  }
  log(`dọn: ${del.length} inspection, ${keys.length} key${opts.dropMachines ? `, ${machines} máy bench` : ""} (serial ${like})`);
  return { inspections: del.length, keys: keys.length, machines };
}

/** ĐẾM LẠI từ DB — nguồn sự thật độc lập với những gì server ACK. */
async function countRun(sql, runId) {
  const like = serialLikeFor(runId);
  const [r] = await sql`
    SELECT count(*)::int AS rows, count(DISTINCT "serialNumber")::int AS distinct_serials
    FROM product_inspections WHERE "serialNumber" LIKE ${like}`;
  return { rows: r.rows, distinctSerials: r.distinct_serials };
}

// ── app-server RSS/heap (chỉ khi METRICS_ENABLED) ────────────────────────────
async function scrapeResources(metricsUrl) {
  try {
    const res = await fetch(metricsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const text = await res.text();
    const rss = parsePromGauge(text, "avi_aoi_process_resident_memory_bytes");
    const heap = parsePromGauge(text, "avi_aoi_nodejs_heap_size_used_bytes");
    if (rss == null && heap == null) return null;
    return { rssMib: rss != null ? round(rss / 1048576, 1) : null, heapMib: heap != null ? round(heap / 1048576, 1) : null };
  } catch {
    return null;
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function endpointUrl(cfg) {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return cfg.endpoint === "trpc" ? `${base}/api/trpc/machineApi.submitInspection` : `${base}/api/machine/submit-inspection`;
}

/**
 * Gửi 1 inspection. Trả { bucket, ms, status }.
 *
 * auth=header → x-api-key (server + express-rate-limit đều thấy → bucket THEO KEY).
 * auth=body   → apiKey trong body (rate limiter chạy TRƯỚC khi parse body nên chỉ
 *               thấy IP → mọi máy sau NAT dùng CHUNG 1 bucket). Đây là kịch bản
 *               NAT doc 51 nêu — nó có thật, và --auth=body đo được nó.
 */
async function sendOne(url, cfg, payload, apiKey) {
  const headers = { "content-type": "application/json" };
  let body = payload;
  if (cfg.auth === "header") headers["x-api-key"] = apiKey;
  else body = { ...payload, apiKey };
  if (cfg.endpoint === "trpc") body = { json: body }; // superjson transformer

  const t0 = now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { /* body rỗng/không phải JSON */ }
    const ms = now() - t0;
    let bucket = classifyOutcome(res.status, parsed);
    // tRPC: mã lỗi THẬT nằm trong body; HTTP status có thể nói dối.
    if (!res.ok && cfg.endpoint === "trpc") {
      const code = trpcErrorCode(parsed);
      if (code === "TOO_MANY_REQUESTS") bucket = "http_429";
    }
    return { bucket, ms, status: res.status, body: parsed };
  } catch (err) {
    const ms = now() - t0;
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return { bucket: timedOut ? "timeout" : "network", ms, status: timedOut ? -1 : 0, err };
  }
}

// ── vòng chạy ────────────────────────────────────────────────────────────────
async function runLoad(sql, cfg, runId, fleet) {
  const url = endpointUrl(cfg);
  const buckets = Object.create(null);
  const latencies = [];
  const errorSamples = [];
  let wireBytes = 0;
  let inFlight = 0;
  let dropped = 0; // slot bị bỏ vì trần concurrency — HARNESS chậm, phải khai báo

  const bump = (b) => { buckets[b] = (buckets[b] ?? 0) + 1; };
  const state = fleet.machines.map((m, idx) => ({
    ...m, idx, seq: 0, rng: rngForMachine(cfg.seed, idx), last: null,
  }));

  const resStart = cfg.metricsUrl ? await scrapeResources(cfg.metricsUrl) : null;
  let rssPeak = resStart?.rssMib ?? null;
  let heapPeak = resStart?.heapMib ?? null;

  // Nhịp: mỗi tick 100ms phát đúng phần tải của tick đó, rải đều theo máy.
  const TICK_MS = 100;
  const perTickPerMachine = (cfg.rate * TICK_MS) / 1000;
  const wall0 = now();
  const pending = new Set();
  // Start with a full credit so every machine fires at t≈0. With credit=0 the first
  // send waited a full 1/rate period, so a `--duration=3 --rate=1` run offered 2
  // inspections/machine instead of 3 and then reported itself 66% short.
  let credit = 1;

  log(`chạy: ${cfg.machines} máy × ${cfg.rate}/s × ${cfg.duration}s → ${url} (auth=${cfg.auth})`);

  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const elapsed = now() - wall0;
      if (elapsed >= cfg.duration * 1000) { clearInterval(timer); resolve(); return; }
      credit += perTickPerMachine;
      const sendsPerMachine = Math.floor(credit);
      if (sendsPerMachine <= 0) return;
      credit -= sendsPerMachine;

      for (const m of state) {
        for (let k = 0; k < sendsPerMachine; k++) {
          if (inFlight >= cfg.concurrency) { dropped++; continue; }
          // dup-pct: phát LẠI payload trước đó (cùng serial + inspectionTime) →
          // server PHẢI trả duplicate:true và DB PHẢI không tăng dòng.
          const isDup = m.last && m.rng() * 100 < cfg.dupPct;
          const payload = isDup ? m.last : buildInspection({
            runId, machineIdx: m.idx, machineCode: m.code, seq: m.seq++,
            rng: m.rng, points: cfg.points, imageKb: cfg.imageKb, imagePoints: cfg.imagePoints,
            ngPct: cfg.ngPct, ntfPct: cfg.ntfPct, inspectionTime: new Date().toISOString(),
          });
          if (!isDup) m.last = payload;
          wireBytes += payloadBytes(payload);
          inFlight++;
          const p = sendOne(url, cfg, payload, m.apiKey)
            .then((r) => {
              bump(r.bucket);
              latencies.push(r.ms);
              if (r.bucket !== "ok" && r.bucket !== "duplicate" && errorSamples.length < 20) {
                errorSamples.push({
                  bucket: r.bucket, status: r.status,
                  message: (r.err?.message ?? JSON.stringify(unwrapBody(r.body) ?? r.body ?? null) ?? "").slice(0, 300),
                });
              }
            })
            .catch(() => bump("harness_error"))
            .finally(() => { inFlight--; pending.delete(p); });
          pending.add(p);
        }
      }
    }, TICK_MS);
  });

  // Đợi mọi request đang bay xong — KHÔNG được cắt, cắt là mất mẫu.
  const drain0 = now();
  while (pending.size > 0) await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 200))]);
  const drainMs = now() - drain0;
  const wallMs = now() - wall0;

  const resEnd = cfg.metricsUrl ? await scrapeResources(cfg.metricsUrl) : null;
  if (resEnd?.rssMib != null) rssPeak = Math.max(rssPeak ?? 0, resEnd.rssMib);
  if (resEnd?.heapMib != null) heapPeak = Math.max(heapPeak ?? 0, resEnd.heapMib);

  // WAL replay/side-effect chạy async — cho DB một nhịp để lắng trước khi đếm lại.
  await new Promise((r) => setTimeout(r, 2000));
  const dbCounts = await countRun(sql, runId);

  const resources = resStart || resEnd
    ? {
        rssStartMib: resStart?.rssMib ?? null, rssPeakMib: rssPeak, rssEndMib: resEnd?.rssMib ?? null,
        heapStartMib: resStart?.heapMib ?? null, heapPeakMib: heapPeak, heapEndMib: resEnd?.heapMib ?? null,
        note: "Lấy từ /metrics: mẫu ĐẦU/CUỐI (không phải đỉnh liên tục) — đỉnh thật trong lúc chạy có thể cao hơn.",
      }
    : { note: "KHÔNG ĐO ĐƯỢC — /metrics không phản hồi (cần METRICS_ENABLED=true trên app-server)." };

  const result = buildResult({
    cfg, runId, startedAt: new Date().toISOString(), wallMs, latencies, buckets, dbCounts, resources,
    machines: { provisioned: fleet.provisioned, reused: fleet.reused },
    wireBytes,
    hardware: {
      platform: `${os.platform()} ${os.release()}`,
      nodeVersion: process.version,
      cpu: os.cpus?.()[0]?.model ?? "unknown",
      cpuCores: os.cpus?.().length ?? null,
      totalMemGb: round(os.totalmem() / 1073741824, 1),
    },
  });
  result.harnessHealth = {
    // Sự thật về CHÍNH harness — nếu nó không phát đủ tải thì mọi con số server
    // bên trên là ĐÁNH GIÁ THẤP, không phải bằng chứng đạt SLA.
    droppedForConcurrencyCap: dropped,
    drainMsAfterWindow: round(drainMs, 1),
    note: dropped > 0
      ? `HARNESS BÃO HOÀ: ${dropped} lượt gửi bị bỏ vì trần --concurrency=${cfg.concurrency}. Kết quả là CẬN DƯỚI. Tăng --concurrency hoặc chia tải ra nhiều tiến trình.`
      : null,
  };
  result.errorSamples = errorSamples;
  return result;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  loadEnv(path.join(__dirname, "..", "..", ".env"));
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) { console.log(HELP); return 0; }
  for (const u of cfg.unknown) console.warn(`[bench-insp] cờ không hiểu, BỎ QUA: ${u}`);

  const errs = validateConfig(cfg);
  if (errs.length) { for (const e of errs) console.error(`[bench-insp] cấu hình sai: ${e}`); return 2; }
  if (!cfg.metricsUrl) cfg.metricsUrl = `${cfg.baseUrl.replace(/\/+$/, "")}/metrics`;

  // ── CỔNG AN TOÀN ──
  const safety = assessTarget({
    databaseUrl: process.env.DATABASE_URL, baseUrl: cfg.baseUrl, nodeEnv: process.env.NODE_ENV,
  });
  if (safety.risky) {
    const override = process.env.BENCH_UNSAFE_ALLOW_PROD === "1";
    console.error(
      "\n══════════════════════════════════════════════════════════════════\n" +
      "[bench-insp] TỪ CHỐI: đích trông giống PRODUCTION.\n" +
      safety.reasons.map((r) => `             • ${r}`).join("\n") + "\n" +
      `             DB : ${maskUrl(process.env.DATABASE_URL)}\n` +
      `             App: ${cfg.baseUrl}\n` +
      "             Harness này GHI hàng chục nghìn dòng inspection và ép tải đường ingest.\n" +
      "             Chạy vào DB dây chuyền thật = hỏng số liệu yield + DoS nhà máy.\n" +
      (override
        ? "             BENCH_UNSAFE_ALLOW_PROD=1 → VẪN CHẠY. Bạn tự chịu trách nhiệm.\n"
        : "             Trỏ sang DB dev/staging, hoặc BENCH_UNSAFE_ALLOW_PROD=1 nếu CHẮC CHẮN được phép.\n") +
      "══════════════════════════════════════════════════════════════════\n");
    if (!override) return 2;
  }

  const sql = makeSql();
  try {
    // ── chế độ dọn ──
    if (cfg.cleanup) {
      if (!cfg.yes) { console.error(`[bench-insp] --cleanup=${cfg.cleanup} sẽ XOÁ dữ liệu. Thêm --yes để xác nhận.`); return 2; }
      await cleanupRun(sql, cfg.cleanup, { dropMachines: true });
      return 0;
    }

    const runId = (cfg.runId ?? new Date().toISOString().slice(2, 16).replace(/[-:T]/g, "")).replace(/[^\w]/g, "");

    // ── không --yes → chỉ in kế hoạch, KHÔNG phát tải, KHÔNG ghi DB ──
    if (!cfg.yes) {
      const totalReq = Math.round(cfg.machines * cfg.rate * cfg.duration);
      const wireMb = round((totalReq * (cfg.imageKb * 1024 * (4 / 3) + cfg.points * 250)) / 1048576, 1);
      console.log(
        `\n[bench-insp] KẾ HOẠCH (chưa chạy — thêm --yes để phát tải thật)\n` +
        `  DB      : ${maskUrl(process.env.DATABASE_URL)}\n` +
        `  App     : ${endpointUrl(cfg)}  (auth=${cfg.auth})\n` +
        `  Tải     : ${cfg.machines} máy × ${cfg.rate}/s × ${cfg.duration}s = ~${totalReq} request\n` +
        `  Payload : ${cfg.points} điểm đo, ảnh ${cfg.imageKb}KB × ${cfg.imagePoints} điểm → ~${wireMb} MB lên dây\n` +
        `  Ghi     : ~${totalReq} dòng product_inspections serial BENCH-${runId}-* ` +
        `(${cfg.keepData ? "GIỮ LẠI" : "sẽ xoá sau khi chạy"})\n` +
        `  An toàn : ${safety.risky ? "⚠ ĐÍCH CÓ RỦI RO" : "đích cục bộ/riêng tư — OK"}\n`);
      return 0;
    }

    // ── kiểm tra server sống trước khi cấp credential (đừng rác DB vô ích) ──
    try {
      const ping = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(5000) });
      log(`server /health → ${ping.status}`);
    } catch (e) {
      console.error(`[bench-insp] app-server không phản hồi tại ${cfg.baseUrl} (${e?.message ?? e}). Khởi động server rồi chạy lại.`);
      return 4;
    }

    const fleet = await resolveMachines(sql, cfg, runId);
    log(`đội máy: ${fleet.reused} có sẵn + ${fleet.provisioned} tạo mới = ${fleet.machines.length}, mỗi máy 1 key riêng`);

    let result;
    try {
      result = await runLoad(sql, cfg, runId, fleet);
    } finally {
      // Key bench luôn bị thu hồi, kể cả khi chạy lỗi — không để rơi credential lại DB.
      //
      // CẢNH BÁO có thật (gặp khi smoke-test): nếu còn bản `queued` trong WAL, backfill
      // sẽ replay SAU khi key đã bị xoá → authenticateMachine trả "Invalid API key" →
      // WAL DEAD-LETTER các bản đó. Mất mát ấy là DO HARNESS, không phải lỗi server —
      // nên phải nói thẳng thay vì để nó lẫn vào số liệu.
      const queued = result?.buckets?.queued ?? 0;
      if (queued > 0) {
        console.warn(
          `\n[bench-insp] ⚠ CÒN ${queued} BẢN TRONG WAL khi thu hồi key bench.\n` +
          `             Backfill replay sau đó sẽ dead-letter chúng ("Invalid API key") — ĐÂY LÀ HIỆN VẬT CỦA HARNESS.\n` +
          `             Muốn đo được đường replay: chạy lại với INSPECTION_STORE_FORWARD_ENABLED=false (đo thẳng),\n` +
          `             hoặc --keep-data rồi tự thu hồi key sau khi WAL đã drain.\n`);
      }
      const keyIds = fleet.machines.map((m) => m.keyId).filter(Boolean);
      if (keyIds.length) await sql`DELETE FROM api_keys WHERE id IN ${sql(keyIds)}`;
    }

    const gateResult = evaluateGates(result);
    result.gates = gateResult;

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const base = cfg.out ? path.resolve(cfg.out) : path.join(RESULTS_DIR, `inspection-${cfg.label ?? runId}.json`);
    const mdFile = base.replace(/\.json$/, "") + ".md";
    fs.writeFileSync(base, JSON.stringify(result, null, 2));
    fs.writeFileSync(mdFile, renderMarkdown(result, gateResult));

    console.log("\n" + renderMarkdown(result, gateResult));
    log(`JSON: ${base}`);
    log(`MD  : ${mdFile}`);

    if (!cfg.keepData) await cleanupRun(sql, runId, { dropMachines: fleet.provisioned > 0 });
    else log(`--keep-data: GIỮ dữ liệu. Dọn sau bằng: npm run bench:ingest -- --cleanup=${runId} --yes`);

    return gateResult.pass ? 0 : 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then((code) => process.exit(typeof code === "number" ? code : 0))
  .catch((err) => { console.error("[bench-insp] fatal:", err?.stack ?? err); process.exit(1); });
