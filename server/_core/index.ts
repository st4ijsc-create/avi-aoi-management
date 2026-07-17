import "dotenv/config";
import express from "express";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import fs from "fs";
import net from "net";
import path from "path";
import { eq } from "drizzle-orm";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { getDb } from "../db";
import { MACHINE_TYPES } from "../constants/machineTypes";
import { createContext } from "./context";
import { sendMachineProxyError, safeMachineLogMeta } from "./machineProxyError";
import { isValidMasterKey } from "./masterKey";
import { serveStatic, setupVite } from "./vite";
import { initializeSocket } from "./socket";
import { uploadGuard } from "./uploadValidation";
import { startOfflineMonitor } from "./offlineMonitor";
import { initializeEmailTransporter } from "./email";
// W4-D (B7): initializeScheduledReports/Backups now start via backgroundJobs
// (skipped when ROLE=api); only the shutdown hooks remain wired here.
import { shutdownScheduledReports } from "../services/reportScheduler";
import { shutdownScheduledBackups } from "../services/backupSchedulerService";
import { initMqttBroker, shutdownMqttBroker, publishFactoryAlertUpdate } from "../services/mqttService";
import { startAlertEvaluationJob, stopAlertEvaluationJob } from "../services/alertEvaluationService";
import { startEscalationScheduler, stopEscalationScheduler } from "../services/alertEscalationService";
import { startAlertEvaluatorScheduler, stopAlertEvaluatorScheduler } from "../services/alertEvaluatorScheduler";
import { initSummaryScheduler, stopSummaryScheduler } from "../services/mqttSummaryScheduler";
import { initBulletinScheduler, stopBulletinScheduler } from "../services/mqttBulletinService";
import { cacheWarmingService } from "../services/cacheWarmingService";
import { initializeLicenseSystem, licenseEnforcementMiddleware } from "../license/license-middleware";
import { initializeRuntimeSecurity, shutdownRuntimeSecurity } from "../license/runtime-security";
import { registerExternalInspectionRoutes } from "../routes/externalInspectionApi";
import { registerAiStreamingRoutes } from "../routes/aiStreamingApi";
import { registerOpenAiGateway } from "../routes/openaiGateway";
import { registerAiLocalKnowledgeRoutes } from "../routes/aiLocalKnowledgeApi";
import { registerEdgeDownloadRoute } from "../routes/edgeDownload";
import logger, { installConsoleBridge } from "../logger";
import { correlationRequestMiddleware } from "./correlationMiddleware";
import { livenessProbe, readinessProbe } from "./healthProbes";
import { createApiLimiter, createAuthLimiter, createMachineIngestLimiter, createOtIngestLimiter, OT_INGEST_PATHS } from "./rateLimitConfig";
import type { CanonicalSample, TelemetryProtocol, TelemetryQuality } from "../services/telemetryBus";

// Chuẩn hoá log sang structured khi LOG_JSON=1 / LOG_BRIDGE_CONSOLE=1 (no-op nếu tắt).
installConsoleBridge();

/** Strip trailing Z so dates are always parsed as local time, not UTC */
// drizzle-orm serializes Date via toISOString() (UTC representation).
// Our "timestamp without time zone" columns store LOCAL time values.
// Without compensation, toISOString() shifts dates by -N hours (e.g. -7 for UTC+7).
// Fix: return a "fake UTC" Date whose UTC components equal the intended local time.
function parseLocalDate(dateStr: string, endOfDay = false): Date {
  let clean = dateStr.endsWith('Z') ? dateStr.slice(0, -1) : dateStr;
  // Date-only strings (e.g. "2026-04-03") are parsed as UTC midnight by JS spec.
  // Append time component so they are parsed as LOCAL time instead.
  if (!clean.includes('T')) clean += endOfDay ? 'T23:59:59.999' : 'T00:00:00';
  const d = new Date(clean);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
}

const HTTPS_ENABLED = process.env.HTTPS_ENABLED === "true";

// W4-D (doc 27 §8 gap B7) — process role.
//   ""       (default) → all-in-one: HTTP + socket + MQTT + ALL schedulers (unchanged)
//   "api"              → HTTP/socket/MQTT/ingest only; cron-like schedulers are
//                        SKIPPED (run them in the worker: `npm run start:worker`)
//   "worker"           → schedulers only, no HTTP bind (delegates to
//                        server/_core/backgroundJobs.runWorkerProcess)
// Single-worker assumption: no leader election — run exactly ONE worker.
const SERVER_ROLE = (process.env.ROLE ?? "").trim().toLowerCase();

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // W4-D (B7): ROLE=worker → scheduler-only process. Delegate BEFORE any
  // express/socket/MQTT setup; the worker never binds HTTP.
  if (SERVER_ROLE === "worker") {
    const { runWorkerProcess } = await import("./backgroundJobs");
    await runWorkerProcess();
    return;
  }
  if (SERVER_ROLE && SERVER_ROLE !== "api") {
    console.warn(
      `[Role] Unknown ROLE="${process.env.ROLE}" — running all-in-one (expected "api" or "worker")`,
    );
  }

  // QW4 — Observability bootstrap (Sentry / OpenTelemetry). No-op unless the
  // corresponding env vars and packages are present. Must run before app init.
  try {
    const { initObservability } = await import("./observability");
    await initObservability();
  } catch (err) {
    console.error("[Observability] init failed:", (err as any)?.message || err);
  }

  // G0 — Prometheus metrics bootstrap (feature-flag METRICS_ENABLED). No-op khi tắt.
  try {
    const { initMetrics } = await import("./metrics");
    await initMetrics();
  } catch (err) {
    console.error("[Metrics] init failed:", (err as any)?.message || err);
  }

  const app = express();
  // Choose HTTP or HTTPS server based on configuration
  let server: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;

  if (HTTPS_ENABLED) {
    const keyPath = process.env.HTTPS_KEY_PATH;
    const certPath = process.env.HTTPS_CERT_PATH;
    const caPath = process.env.HTTPS_CA_PATH;

    if (!keyPath || !certPath) {
      throw new Error(
        "HTTPS_ENABLED=true nhưng HTTPS_KEY_PATH hoặc HTTPS_CERT_PATH chưa được cấu hình trong .env",
      );
    }

    const httpsOptions: any = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };

    if (caPath) {
      httpsOptions.ca = fs.readFileSync(caPath);
    }

    server = createHttpsServer(httpsOptions, app);
    console.log("[HTTPS] HTTPS server enabled");
  } else {
    server = createHttpServer(app);
  }
  
  // ============================================================
  // CORS Configuration for External Machine Clients (AOI/AVI)
  // Allow-list driven (GAP G13). Browser origins must be explicitly
  // whitelisted via ALLOWED_ORIGINS (comma-separated). Non-browser LAN
  // machine clients (C# apps) typically send no Origin header and are
  // always permitted. When ALLOWED_ORIGINS is empty the middleware falls
  // back to the previous permissive behaviour but logs a warning so the
  // misconfiguration is visible in production.
  // ============================================================
  const corsAllowList = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const corsIsProd = process.env.NODE_ENV === "production";
  // Hardening (WS0.2): never reflect arbitrary browser origins with credentials
  // in production. When ALLOWED_ORIGINS is empty in production we lock down
  // cross-origin browser access (same-origin SPA + no-Origin LAN machine
  // clients are unaffected). In development we keep the permissive fallback.
  const corsAllowAll = corsAllowList.length === 0 && !corsIsProd;
  // In development, always trust loopback origins regardless of the allow-list
  // so the Vite dev server is reachable on whatever port it lands on (e.g. when
  // 3000 is busy it falls back to 3001). Never applies in production.
  const isDevLoopbackOrigin = (origin: string): boolean => {
    if (corsIsProd) return false;
    try {
      const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
      return false;
    }
  };
  if (corsAllowList.length === 0) {
    if (corsIsProd) {
      console.error(
        "[CORS] ALLOWED_ORIGINS is not configured in production — cross-origin " +
          "browser requests are DENIED. Set ALLOWED_ORIGINS=https://app.example.com to allow them.",
      );
    } else {
      console.warn(
        "[CORS] ALLOWED_ORIGINS is not configured — reflecting all browser origins (dev only). " +
          "Set ALLOWED_ORIGINS to harden CORS.",
      );
    }
  }

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    // No Origin header => non-browser client (LAN machine). Always allow.
    if (!origin) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (corsAllowAll || corsAllowList.includes(origin) || isDevLoopbackOrigin(origin)) {
      // Reflect only trusted origins so credentials can be shared safely.
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      // Untrusted browser origin: deny CORS but let the request through so
      // non-credentialed/server-to-server calls are unaffected.
      console.warn(`[CORS] Blocked browser origin not in ALLOWED_ORIGINS: ${origin}`);
    }

    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-api-key, x-machine-code, X-API-Key, X-Machine-Code, User-Agent, Content-Length, Accept, Origin, x-correlation-id, traceparent");
    res.setHeader("Access-Control-Expose-Headers",
      "Content-Length, Content-Type, ETag, X-Request-Id, X-Correlation-Id");
    res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

    // Handle preflight OPTIONS requests
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    next();
  });

  // doc 44 W6-4 (G5.17) — correlation backbone: pick up x-correlation-id / traceparent
  // from the client (or mint one) into AsyncLocalStorage so every downstream tRPC handler,
  // command dispatch, genealogy write, and pino log line shares ONE id (nút bấm→lệnh→máy).
  // Mount EARLY (before body parser + all routes). Additive, non-gated.
  app.use(correlationRequestMiddleware());

  // Configure body parser with larger size limit for file uploads
  // Skip JSON parsing for raw binary upload routes (APK uploads etc.)
  const rawUploadPaths = ["/api/factory-alert/upload", "/api/aoi/upload/"];
  // R-1 (doc 38): scope the 200MB ceiling to the routes that legitimately carry
  // large base64/JSON bodies, and cap everything else at a sane default so a
  // single oversized POST to a generic endpoint can't force a 200MB in-memory
  // parse (memory-exhaustion DoS). Large-body prefixes:
  //   /api/trpc/    — tRPC mutations incl. twin.models.uploadAndRegister /
  //                   documents.upload (base64 files) and AOI package commit
  //                   metadata. (The tRPC router is mounted at /api/trpc — the bare
  //                   /trpc/ prefix never matched req.path, so large uploads were
  //                   silently capped at DEFAULT and 413'd. doc 48 fix.)
  //   /api/machine/ — machine REST proxies that embed base64 images
  //                   (submit-inspection, upload-image, sync-*-image).
  //   /api/ai/      — local-KB / streaming endpoints that accept an inline
  //                   base64 image for the Qwen3-VL vision model.
  // The OpenAI gateway (/v1) mounts its OWN json({limit: OPENAI_GATEWAY_BODY_LIMIT
  // || "20mb"}); the default below is ≥ that so it is unaffected. Override the
  // default with HTTP_BODY_LIMIT.
  const LARGE_BODY_LIMIT = "200mb";
  const DEFAULT_BODY_LIMIT = process.env.HTTP_BODY_LIMIT || "25mb";
  const largeBodyPrefixes = ["/api/trpc/", "/trpc/", "/api/machine/", "/api/ai/"];
  const bodyLimitFor = (p: string): string =>
    largeBodyPrefixes.some((x) => p.startsWith(x)) ? LARGE_BODY_LIMIT : DEFAULT_BODY_LIMIT;
  app.use((req, res, next) => {
    if (rawUploadPaths.some((p) => req.path.startsWith(p))) return next();
    express.json({ limit: bodyLimitFor(req.path) })(req, res, next);
  });
  app.use((req, res, next) => {
    if (rawUploadPaths.some((p) => req.path.startsWith(p))) return next();
    express.urlencoded({ limit: bodyLimitFor(req.path), extended: true })(req, res, next);
  });

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false, // CSP handled by securityHeaders.ts below (SEC_CSP_MODE, default off)
    crossOriginEmbedderPolicy: false, // Allow cross-origin resources for LAN devices
  }));

  // W0-I (doc 44 G5.7a) — CSP theo SEC_CSP_MODE (off|report-only|enforce, default
  // off = hành vi cũ) + Permissions-Policy/Referrer-Policy bổ sung (chỉ khi helmet
  // chưa set). Mount NGAY SAU helmet. Fail-safe: lỗi wiring không chặn boot.
  try {
    const { securityHeadersMiddleware } = await import("./securityHeaders");
    app.use(securityHeadersMiddleware());
  } catch (err) {
    console.error("[Security] headers middleware wiring failed:", (err as any)?.message || err);
  }

  // Rate limiting for API endpoints
  const apiLimiter = createApiLimiter();
  // doc 48 R3 — DEDICATED high-throughput OT telemetry ingest tier. Machine→server
  // telemetry (POST /api/ot/ingest) is authenticated by a per-machine key, not a
  // browser session, so it must NOT share the 300/60 browser bucket (a real benchmark
  // hit that ceiling at ~2541 pts/s). Mount its own per-machine high limiter BEFORE
  // the general /api limiter; the general limiter `skip`s these exact paths
  // (OT_INGEST_PATHS) so the two never double-count. Tune via OT_INGEST_RATE_MAX.
  const otIngestLimiter = createOtIngestLimiter();
  app.use([...OT_INGEST_PATHS], otIngestLimiter);
  // doc 51 R6 — DEDICATED machine data-plane tier (CASE #2/#9 mất dữ liệu). AVI/AOI
  // machines submit inspections via /api/trpc/machineApi.* and /api/machine/*, which
  // both rode the 300/60 BROWSER bucket; worse, a machine sending its key in the tRPC
  // BODY (not a header) fell through to the IP key, so 100 machines behind ONE factory
  // NAT shared ONE 300/min bucket against ~6000 req/min offered → ~95% 429. The 429
  // fires here, BEFORE tRPC, so the inspection store-forward WAL cannot buffer it →
  // inspections LOST. This limiter keys per machine credential (header/body/query) and
  // raises the ceiling for credentialed machines only; keyless callers keep 300/min.
  // Mounted BEFORE the general limiter, which `skip`s these exact requests (no
  // double-counting). Tune via MACHINE_INGEST_RATE_MAX; RATE_LIMIT_BODY_KEY=false
  // restores pre-R6 header-only keying.
  const machineIngestLimiter = createMachineIngestLimiter();
  app.use('/api/', machineIngestLimiter);
  app.use('/api/', apiLimiter);
  app.use('/trpc/', apiLimiter);

  // Stricter rate limit for auth endpoints
  const authLimiter = createAuthLimiter();
  app.use('/api/auth/', authLimiter);

  // G0 — Prometheus request metrics (no-op khi METRICS_ENABLED chưa bật)
  try {
    const { metricsMiddleware, metricsHandler } = await import("./metrics");
    app.use(metricsMiddleware());
    app.get("/metrics", metricsHandler);
  } catch (err) {
    console.error("[Metrics] middleware wiring failed:", (err as any)?.message || err);
  }

  // G1 — SSE realtime stream (no-op/404 khi SSE_ENABLED chưa bật)
  try {
    const { sseHandler } = await import("./sse");
    app.get("/api/stream", sseHandler);
  } catch (err) {
    console.error("[SSE] route wiring failed:", (err as any)?.message || err);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // doc 48 R3 — HIGH-THROUGHPUT OT TELEMETRY INGEST (machine-to-machine).
  //   POST /api/ot/ingest     Body: { samples: CanonicalSample[] }
  // Auth: per-machine key (x-api-key header / body.apiKey / machineCode), scope
  //   "ingest:write" — the SAME credential model every other machine endpoint uses;
  //   NOT weakened to raise throughput. Rate limit: the dedicated high tier mounted
  //   above (createOtIngestLimiter), NOT the 300/60 browser /api limiter (which skips
  //   this path). Samples funnel straight into the ONE unified telemetry bus
  //   (ingestTelemetry) → one bulk insert per batch. Module resolved ONCE at boot.
  // ────────────────────────────────────────────────────────────────────────────
  {
    const { authenticateMachine } = await import("../services/machineAuthService");
    const { ingestTelemetry } = await import("../services/telemetryBus");
    const OT_PROTOCOLS = new Set<string>([
      "mqtt", "opcua", "modbus", "s7", "ethernet_ip", "mtconnect", "sparkplug", "inspection", "other",
    ]);
    const OT_QUALITY = new Set<string>(["good", "bad", "uncertain"]);
    const normProtocol = (p: unknown): TelemetryProtocol =>
      typeof p === "string" && OT_PROTOCOLS.has(p) ? (p as TelemetryProtocol) : "other";
    const normQuality = (q: unknown): TelemetryQuality =>
      typeof q === "string" && OT_QUALITY.has(q) ? (q as TelemetryQuality) : "good";

    app.post("/api/ot/ingest", async (req, res) => {
      try {
        const body = (req.body ?? {}) as any;
        const rawSamples = Array.isArray(body) ? body : body.samples;
        if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
          return res
            .status(400)
            .json({ ok: false, error: "Body must be { samples: [ ... ] } with at least one sample" });
        }

        // Auth (per-machine key) — preserved, NOT weakened. Throws TRPCError on failure.
        const auth = await authenticateMachine({
          headerKey: req.header("x-api-key") || null,
          apiKey: typeof body.apiKey === "string" ? body.apiKey : null,
          machineCode:
            typeof body.machineCode === "string" ? body.machineCode : req.header("x-machine-code") || null,
          scope: "ingest:write",
        });

        // Map → CanonicalSample[]. deviceId is preserved so the bus resolves the soft
        // machineId itself (one gateway credential forwards many devices).
        const samples: CanonicalSample[] = rawSamples.map((s: any): CanonicalSample => ({
          ts: s?.ts ? new Date(s.ts) : undefined,
          machineId: typeof s?.machineId === "number" ? s.machineId : null,
          deviceId: typeof s?.deviceId === "string" ? s.deviceId : null,
          protocol: normProtocol(s?.protocol),
          metric: String(s?.metric ?? ""),
          value:
            typeof s?.value === "number" || typeof s?.value === "string" || typeof s?.value === "boolean"
              ? s.value
              : null,
          unit: typeof s?.unit === "string" ? s.unit : null,
          quality: normQuality(s?.quality),
          meta: s?.meta && typeof s.meta === "object" ? s.meta : null,
        }));

        const accepted = await ingestTelemetry(samples);
        res.json({ ok: true, accepted, received: samples.length, machine: auth.machine.code });
      } catch (error: any) {
        // Auth failures (TRPCError) → 401/403; DB down → 503; everything else → 500.
        const code = error?.code;
        if (code === "UNAUTHORIZED")
          return res.status(401).json({ ok: false, error: error?.message || "Unauthorized" });
        if (code === "FORBIDDEN")
          return res.status(403).json({ ok: false, error: error?.message || "Forbidden" });
        if (error?.name === "DbUnavailableError")
          return res.status(503).json({ ok: false, error: "Database unavailable — retry" });
        console.error("[OT ingest] error:", error?.message || error);
        res.status(500).json({ ok: false, error: error?.message || "Ingest failed" });
      }
    });
    console.log("[OT] high-throughput ingest route ready: POST /api/ot/ingest (dedicated rate tier)");
  }

  // Health check endpoint (rich diagnostics for Docker HEALTHCHECK / orchestrators)
  app.get('/health', async (_req, res) => {
    const startedAt = Date.now();
    let dbStatus: 'connected' | 'disconnected' | 'error' = 'disconnected';
    try {
      const { getDb } = await import("../db/connection");
      const dbInstance = await getDb();
      if (dbInstance) dbStatus = 'connected';
    } catch { dbStatus = 'error'; }

    const mem = process.memoryUsage();
    const memoryMB = Math.round(mem.heapUsed / 1024 / 1024);
    const uptimeSec = Math.floor(process.uptime());
    const version = process.env.npm_package_version || 'unknown';
    const status = dbStatus === 'connected' ? 'ok' : 'degraded';

    res.status(dbStatus === 'connected' ? 200 : 503).json({
      status,
      db: dbStatus,
      memoryMB,
      uptimeSec,
      version,
      checkMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  });

  // doc 44 W6-4 (G5.25) — split liveness/readiness for shadow→canary rollout gating.
  //   /livez  — process alive (never dependency-checked → no restart on a DB blip)
  //   /readyz — can serve traffic (DB hard gate + broker informational) → the canary gate
  app.get('/livez', (_req, res) => {
    res.status(200).json(livenessProbe());
  });
  app.get('/readyz', async (_req, res) => {
    try {
      const result = await readinessProbe();
      res.status(result.ready ? 200 : 503).json(result);
    } catch {
      res.status(503).json({ status: 'not_ready', ready: false, ts: new Date().toISOString() });
    }
  });

  // W0-I (doc 44 G5.7) — CSP violation report endpoint + origin-check chống CSRF.
  // Mount SAU health/metrics (không chạm health probe), TRƯỚC mọi route /api & tRPC.
  // /api/csp-report vẫn đi qua apiLimiter (mounted trên /api/ ở trên) nên được
  // rate-limit chung. Origin-check: SEC_ORIGIN_CHECK_MODE off|log|enforce (default
  // off — pass-through, zero behaviour change). Fail-safe wiring.
  try {
    const { registerCspReportEndpoint } = await import("./securityHeaders");
    registerCspReportEndpoint(app);
  } catch (err) {
    console.error("[Security] CSP report endpoint wiring failed:", (err as any)?.message || err);
  }
  try {
    const { originCheckMiddleware } = await import("./originCheck");
    app.use(originCheckMiddleware());
  } catch (err) {
    console.error("[Security] origin-check wiring failed:", (err as any)?.message || err);
  }

  // ============================================================
  // Network monitoring endpoints (for FactoryAlertSystem)
  // ============================================================

  // Comprehensive server health for network monitor
  app.get('/api/network/health', async (_req, res) => {
    try {
      const { isMqttRunning, getConnectedClientsCount } = await import("../services/mqttService");
      const { getDb } = await import("../db/connection");

      // Check DB
      let dbStatus = 'disconnected';
      try {
        const dbInstance = await getDb();
        if (dbInstance) dbStatus = 'connected';
      } catch { dbStatus = 'error'; }

      // Memory usage
      const mem = process.memoryUsage();
      const memoryUsageMB = Math.round(mem.heapUsed / 1024 / 1024);

      // Uptime
      const uptimeSec = Math.floor(process.uptime());
      const hours = Math.floor(uptimeSec / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      const uptime = `${hours}h ${minutes}m`;

      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        mqttStatus: isMqttRunning() ? 'running' : 'stopped',
        mqttClients: getConnectedClientsCount(),
        dbStatus,
        memoryUsageMB,
        uptime,
      });
    } catch (error: any) {
      res.status(500).json({ status: 'error', message: error?.message });
    }
  });

  // Speed test endpoint — returns random bytes of configurable size
  app.get('/api/network/speedtest', (req, res) => {
    const sizeKB = Math.min(Math.max(parseInt(String(req.query.size)) || 100, 1), 1024);
    const buffer = Buffer.alloc(sizeKB * 1024);
    // Fill with random-ish data (fast)
    for (let i = 0; i < buffer.length; i += 4) {
      buffer.writeUInt32LE((Math.random() * 0xFFFFFFFF) >>> 0, i);
    }
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  });

  // Serve local uploads if STORAGE_MODE=local
  if (process.env.STORAGE_MODE === "local") {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");

    if (!fs.existsSync(uploadsRoot)) {
      fs.mkdirSync(uploadsRoot, { recursive: true });
    }

    // Ensure mqtt-releases subfolder exists for APK deploy
    const mqttReleasesDir = path.join(uploadsRoot, "mqtt-releases");
    if (!fs.existsSync(mqttReleasesDir)) {
      fs.mkdirSync(mqttReleasesDir, { recursive: true });
    }

    // Ensure factory-alert-releases subfolder exists for FactoryAlertSystem OTA
    const factoryAlertReleasesDir = path.join(uploadsRoot, "factory-alert-releases");
    if (!fs.existsSync(factoryAlertReleasesDir)) {
      fs.mkdirSync(factoryAlertReleasesDir, { recursive: true });
    }

    // Image resize middleware for /uploads (supports ?w=WIDTH&q=QUALITY like AOI package endpoint)
    app.get("/uploads/*", async (req, res, next) => {
      const w = req.query.w ? Math.min(Math.max(parseInt(String(req.query.w), 10) || 0, 32), 1920) : 0;
      if (!w) return next(); // No resize requested, fall through to express.static
      const q = req.query.q ? Math.min(Math.max(parseInt(String(req.query.q), 10) || 80, 10), 100) : 80;
      const filePath = path.join(uploadsRoot, (req.params as Record<string, string>)[0]);
      try {
        if (!fs.existsSync(filePath)) return next();
        const sharpMod = (await import("sharp")).default;
        const resized = await sharpMod(filePath).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: q }).toBuffer();
        res.set("Content-Type", "image/jpeg");
        res.set("Cache-Control", "public, max-age=86400");
        res.send(resized);
      } catch {
        next(); // Sharp unavailable or error, fall through to static
      }
    });
    app.use("/uploads", express.static(uploadsRoot));
    console.log(`[Storage] Local uploads enabled at /uploads (dir: ${uploadsRoot}) [resize support: ?w=&q=]`);
    console.log(`[Storage] APK deploy folder: ${mqttReleasesDir}`);
    console.log(`[Storage] FactoryAlertSystem releases folder: ${factoryAlertReleasesDir}`);
  }

  // REST endpoints for external machines (proxy to tRPC machineApi router).
  // Error contract + safe logging live in ./machineProxyError (doc 51 P2, CASE #2).
  app.post("/api/machine/submit-inspection", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };

      // Safe metadata only — NEVER log the payload: measurements carry base64 image
      // data and `input.apiKey` is a live credential (doc 51 P2 / CASE #2).
      const meta = safeMachineLogMeta(req.body);
      console.log(
        "[MachineAPI] submit-inspection:",
        `machine=${meta.machineCode}`,
        `serial=${meta.serialNumber}`,
        `measurements=${meta.measurements}`,
      );

      const result = await caller.machineApi.submitInspection(input as any);
      res.json(result);
    } catch (error: any) {
      // Log the code/message only — the caught error's context may reference the
      // base64 payload; do NOT stringify the input.
      console.error("[MachineAPI] submit-inspection error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Submit inspection failed");
    }
  });

  app.post("/api/machine/upload-image", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };

      const result = await caller.machineApi.uploadImage(input as any);
      res.json(result);
    } catch (error: any) {
      // Error message only — the request body carries base64 image data.
      console.error("[MachineAPI] upload-image error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Upload image failed");
    }
  });

  // ============================================================
  // REST API: Inspection Images On-Demand (for Android app)
  // Returns image URLs for a specific inspection - lightweight payload
  // Android app calls this when user taps to view images instead of
  // embedding images directly in MQTT messages
  // ============================================================
  app.get("/api/inspection/:id/images", async (req, res) => {
    try {
      const inspectionId = parseInt(req.params.id, 10);
      if (isNaN(inspectionId)) {
        return res.status(400).json({ success: false, message: "Invalid inspection ID" });
      }

      const { eq, and } = await import("drizzle-orm");
      const schema = await import("../../drizzle/schema");
      const { getDb } = await import("../db/connection");
      const dbInstance = await getDb();
      if (!dbInstance) {
        return res.status(500).json({ success: false, message: "DB not available" });
      }

      // Fetch inspection info
      const inspection = await dbInstance
        .select({
          id: schema.productInspections.id,
          serialNumber: schema.productInspections.serialNumber,
          overallResult: schema.productInspections.overallResult,
          inspectionTime: schema.productInspections.inspectionTime,
          machineId: schema.productInspections.machineId,
        })
        .from(schema.productInspections)
        .where(eq(schema.productInspections.id, inspectionId))
        .limit(1);

      if (inspection.length === 0) {
        return res.status(404).json({ success: false, message: "Inspection not found" });
      }

      // Fetch measurement results with images
      const results = await dbInstance
        .select({
          id: schema.measurementResults.id,
          pointDefId: schema.measurementResults.pointDefId,
          pointCode: schema.measurementPointDefs.code,
          pointName: schema.measurementPointDefs.name,
          result: schema.measurementResults.result,
          measuredValue: schema.measurementResults.measuredValue,
          imageUrl: schema.measurementResults.imageUrl,
          imageKey: schema.measurementResults.imageKey,
          referenceImageUrl: schema.measurementPointDefs.referenceImageUrl,
        })
        .from(schema.measurementResults)
        .leftJoin(
          schema.measurementPointDefs,
          eq(schema.measurementResults.pointDefId, schema.measurementPointDefs.id)
        )
        .where(eq(schema.measurementResults.inspectionId, inspectionId));

      // Only return entries that have images
      const pointsWithImages = results
        .filter((r) => r.imageUrl && !r.imageUrl.endsWith("..."))
        .map((r) => ({
          pointDefId: r.pointDefId,
          pointCode: r.pointCode || `P${r.pointDefId}`,
          pointName: r.pointName || undefined,
          result: r.result,
          measuredValue: r.measuredValue,
          imageUrl: r.imageUrl,
          referenceImageUrl: r.referenceImageUrl || undefined,
        }));

      res.json({
        success: true,
        inspectionId,
        serialNumber: inspection[0].serialNumber,
        overallResult: inspection[0].overallResult,
        inspectionTime: inspection[0].inspectionTime,
        totalPoints: results.length,
        pointsWithImages,
      });
    } catch (error: any) {
      console.error("[API] inspection images error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get images" });
    }
  });

  // ============================================================
  // REST API: Reference Images for Measurement Points
  // Returns reference images (gold standard) for comparison with
  // actual inspection images on Android app
  // ============================================================

  // GET /api/measurement-point/:id/reference-image — Get reference image for a specific measurement point
  app.get("/api/measurement-point/:id/reference-image", async (req, res) => {
    try {
      const pointDefId = parseInt(req.params.id, 10);
      if (isNaN(pointDefId)) {
        return res.status(400).json({ success: false, message: "Invalid point definition ID" });
      }

      const { eq } = await import("drizzle-orm");
      const schema = await import("../../drizzle/schema");
      const { getDb } = await import("../db/connection");
      const dbInstance = await getDb();
      if (!dbInstance) {
        return res.status(500).json({ success: false, message: "DB not available" });
      }

      const result = await dbInstance
        .select({
          id: schema.measurementPointDefs.id,
          code: schema.measurementPointDefs.code,
          name: schema.measurementPointDefs.name,
          referenceImageUrl: schema.measurementPointDefs.referenceImageUrl,
          positionX: schema.measurementPointDefs.positionX,
          positionY: schema.measurementPointDefs.positionY,
          radius: schema.measurementPointDefs.radius,
          cropWidth: schema.measurementPointDefs.cropWidth,
          cropHeight: schema.measurementPointDefs.cropHeight,
          productModelId: schema.measurementPointDefs.productModelId,
        })
        .from(schema.measurementPointDefs)
        .where(eq(schema.measurementPointDefs.id, pointDefId))
        .limit(1);

      if (result.length === 0) {
        return res.status(404).json({ success: false, message: "Measurement point not found" });
      }

      const point = result[0];

      // Also get product model reference image
      let productReferenceImageUrl: string | null = null;
      if (point.productModelId) {
        const pm = await dbInstance
          .select({
            referenceImageUrl: schema.productModels.referenceImageUrl,
            imageWidth: schema.productModels.imageWidth,
            imageHeight: schema.productModels.imageHeight,
          })
          .from(schema.productModels)
          .where(eq(schema.productModels.id, point.productModelId))
          .limit(1);
        if (pm.length > 0) {
          productReferenceImageUrl = pm[0].referenceImageUrl;
        }
      }

      res.json({
        success: true,
        pointDefId: point.id,
        pointCode: point.code,
        pointName: point.name,
        referenceImageUrl: point.referenceImageUrl,
        position: {
          x: point.positionX,
          y: point.positionY,
          radius: point.radius,
          cropWidth: point.cropWidth,
          cropHeight: point.cropHeight,
        },
        productReferenceImageUrl,
      });
    } catch (error: any) {
      console.error("[API] measurement-point reference-image error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get reference image" });
    }
  });

  // GET /api/product-model/:id/reference-images — Get all reference images for a product model
  app.get("/api/product-model/:id/reference-images", async (req, res) => {
    try {
      const productModelId = parseInt(req.params.id, 10);
      if (isNaN(productModelId)) {
        return res.status(400).json({ success: false, message: "Invalid product model ID" });
      }

      const { eq } = await import("drizzle-orm");
      const schema = await import("../../drizzle/schema");
      const { getDb } = await import("../db/connection");
      const dbInstance = await getDb();
      if (!dbInstance) {
        return res.status(500).json({ success: false, message: "DB not available" });
      }

      // Get product model info
      const pm = await dbInstance
        .select({
          id: schema.productModels.id,
          code: schema.productModels.code,
          name: schema.productModels.name,
          referenceImageUrl: schema.productModels.referenceImageUrl,
          imageWidth: schema.productModels.imageWidth,
          imageHeight: schema.productModels.imageHeight,
        })
        .from(schema.productModels)
        .where(eq(schema.productModels.id, productModelId))
        .limit(1);

      if (pm.length === 0) {
        return res.status(404).json({ success: false, message: "Product model not found" });
      }

      // Get all measurement points with reference images for this product
      const points = await dbInstance
        .select({
          id: schema.measurementPointDefs.id,
          code: schema.measurementPointDefs.code,
          name: schema.measurementPointDefs.name,
          referenceImageUrl: schema.measurementPointDefs.referenceImageUrl,
          positionX: schema.measurementPointDefs.positionX,
          positionY: schema.measurementPointDefs.positionY,
          radius: schema.measurementPointDefs.radius,
          cropWidth: schema.measurementPointDefs.cropWidth,
          cropHeight: schema.measurementPointDefs.cropHeight,
          orderIndex: schema.measurementPointDefs.orderIndex,
        })
        .from(schema.measurementPointDefs)
        .where(eq(schema.measurementPointDefs.productModelId, productModelId))
        .orderBy(schema.measurementPointDefs.orderIndex);

      res.json({
        success: true,
        productModel: {
          id: pm[0].id,
          code: pm[0].code,
          name: pm[0].name,
          referenceImageUrl: pm[0].referenceImageUrl,
          imageWidth: pm[0].imageWidth,
          imageHeight: pm[0].imageHeight,
        },
        points: points.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          referenceImageUrl: p.referenceImageUrl,
          position: {
            x: p.positionX,
            y: p.positionY,
            radius: p.radius,
            cropWidth: p.cropWidth,
            cropHeight: p.cropHeight,
          },
          orderIndex: p.orderIndex,
        })),
        totalPoints: points.length,
        pointsWithRefImages: points.filter((p) => p.referenceImageUrl).length,
      });
    } catch (error: any) {
      console.error("[API] product-model reference-images error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get reference images" });
    }
  });

  // POST /api/machine/sync-points — Machine client pushes (PUT) measurement point definitions to server
  app.post("/api/machine/sync-points", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };

      const result = await caller.machineApi.syncMeasurementPoints(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] sync-points error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Sync points failed");
    }
  });

  // GET /api/machine/get-points — Machine client pulls (GET) measurement point definitions from server
  app.get("/api/machine/get-points", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || (req.query.apiKey as string);
      const machineCode = req.query.machineCode as string | undefined;
      const productModelCode = req.query.productModelCode as string | undefined;

      const input = { apiKey, machineCode, productModelCode };

      const result = await caller.machineApi.getPoints(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] get-points error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Get points failed");
    }
  });

  // ============================================================
  // REST proxy: Machine self-registration (public, no API key)
  // ============================================================
  app.post("/api/machine/register", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const result = await caller.machine.register(req.body as any);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("[MachineAPI] register error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Registration failed");
    }
  });

  // REST proxy: Machine config polling (public, no API key)
  app.get("/api/machine/config", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const serialNumber = req.query.serialNumber as string;
      if (!serialNumber) {
        return res.status(400).json({ success: false, message: "serialNumber query parameter is required" });
      }
      const result = await caller.machine.config({ serialNumber } as any);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("[MachineAPI] config error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Config fetch failed");
    }
  });

  // REST proxy: Machine key claim (doc 51 P0 / R1).
  // Counterpart of GET /api/machine/config — which NO LONGER returns apiKey (it
  // leaked a plaintext credential to anyone who knew the serialNumber). Machines
  // on the REST path redeem their one-time claim token here instead; without this
  // proxy a REST client would have no way to obtain its key at all.
  app.post("/api/machine/claim", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const serialNumber = req.body?.serialNumber;
      const claimToken = req.body?.claimToken;
      if (!serialNumber || !claimToken) {
        return res.status(400).json({ success: false, message: "serialNumber and claimToken are required" });
      }
      const result = await caller.machine.claimKey({ serialNumber, claimToken } as any);
      res.json({ success: true, ...result });
    } catch (error: any) {
      // Map the tRPC code to a real HTTP status: a claim failure is the client's
      // (bad/burnt/expired token → 400), not a server fault, and throttling must
      // surface as 429 so clients back off instead of hammering.
      console.error("[MachineAPI] claim error:", error?.code || error?.message);
      const status =
        error?.code === "NOT_FOUND" ? 404 :
        error?.code === "TOO_MANY_REQUESTS" ? 429 :
        error?.code === "UNAUTHORIZED" || error?.code === "BAD_REQUEST" ? 400 :
        500;
      res.status(status).json({ success: false, message: error?.message || "Claim failed" });
    }
  });

  // REST proxy: Machine heartbeat
  app.post("/api/machine/heartbeat", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || req.body.apiKey;
      if (!apiKey) {
        return res.status(400).json({ success: false, message: "API key is required (header X-API-Key or body.apiKey)" });
      }
      const result = await caller.machineApi.heartbeat({ apiKey } as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] heartbeat error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Heartbeat failed");
    }
  });

  // GET /api/mqtt/version.json — Public endpoint for FactoryAlertSystem OTA updates
  app.get("/api/mqtt/version.json", async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const { mqttSoftwareVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const database = await getDb();
      if (!database) return res.status(503).json({ error: "Database not connected" });

      const [latest] = await database
        .select()
        .from(mqttSoftwareVersions)
        .where(eq(mqttSoftwareVersions.isLatest, true))
        .limit(1);

      if (!latest || !latest.apkFileUrl) {
        return res.status(404).json({ error: "No version available" });
      }

      // Parse changelog: try JSON array, fallback to split by newline
      let changelog: string[] = [];
      if (latest.changelog) {
        try {
          changelog = JSON.parse(latest.changelog);
        } catch {
          changelog = latest.changelog.split("\n").filter(Boolean);
        }
      }

      res.json({
        version: latest.version,
        versionCode: latest.versionCode,
        releaseDate: latest.releaseDate?.toISOString().split("T")[0] ?? "",
        apkUrl: latest.apkFileUrl,
        changelog,
        mandatory: latest.mandatory,
        minVersionCode: latest.minVersionCode ?? undefined,
      });
    } catch (error: any) {
      console.error("[MQTT] version.json error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // doc 33 §11 (R3 "publish") — public machine-readable API specs for the Developer Portal.
  // DEV_PORTAL-gated (404 when off). Stable REST URLs so external tooling (Postman / Swagger import)
  // can consume the OpenAPI 3.1 + AsyncAPI 2.6 surface without an authenticated tRPC call.
  const specDevPortalOn = () => process.env.DEV_PORTAL === "true" || process.env.DEV_PORTAL === "1";
  app.get("/api/v1/openapi.json", async (_req, res) => {
    if (!specDevPortalOn()) return res.status(404).json({ error: "Developer Portal disabled" });
    try {
      const { buildSeedSpecs } = await import("../services/contracts/apiSpec");
      res.json(buildSeedSpecs().openapi);
    } catch (error: any) {
      console.error("[DevPortal] openapi.json error:", error);
      res.status(500).json({ error: "spec build failed" });
    }
  });
  app.get("/api/v1/asyncapi.json", async (_req, res) => {
    if (!specDevPortalOn()) return res.status(404).json({ error: "Developer Portal disabled" });
    try {
      const { buildSeedSpecs } = await import("../services/contracts/apiSpec");
      res.json(buildSeedSpecs().asyncapi);
    } catch (error: any) {
      console.error("[DevPortal] asyncapi.json error:", error);
      res.status(500).json({ error: "spec build failed" });
    }
  });

  // GET /api/factory-alert/version.json — Returns active version info for FactoryAlertSystem OTA.
  // MB7 (doc 27 Đợt 6): also mints a short-lived signed `downloadToken` (HMAC,
  // 15-min TTL) that the app appends to the download URL as ?token= — see
  // server/_core/factoryAlertDownloadToken.ts for the full design + tighten path.
  app.get("/api/factory-alert/version.json", async (_req, res) => {
    try {
      const { factoryAlertVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return res.status(503).json({ error: "Database not connected" });
      const [active] = await db.select().from(factoryAlertVersions).where(eq(factoryAlertVersions.isActive, true)).limit(1);
      if (!active) {
        return res.status(404).json({ error: "No active version" });
      }
      const activeVersion = active.version?.trim() ?? "";
      const activeApkName = active.apkFileName?.trim() ?? "";
      const { mintDownloadToken } = await import("./factoryAlertDownloadToken");
      res.json({
        version: activeVersion,
        versionCode: active.versionCode,
        releaseDate: active.releaseDate ? new Date(active.releaseDate).toISOString().split("T")[0] : null,
        apkUrl: `download/${activeVersion}/${activeApkName}`,
        changelog: active.changelog ? active.changelog.split("\n").filter(Boolean) : [],
        mandatory: active.mandatory,
        // Short-lived signed token for the download route (MB7)
        downloadToken: mintDownloadToken(activeVersion, activeApkName),
      });
    } catch (error: any) {
      console.error("[FactoryAlert] version.json error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/factory-alert/versions — List all versions
  app.get("/api/factory-alert/versions", async (_req, res) => {
    try {
      const { factoryAlertVersions } = await import("../../drizzle/schema/mqtt");
      const { desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return res.status(503).json({ error: "Database not connected" });
      const all = await db.select().from(factoryAlertVersions).orderBy(desc(factoryAlertVersions.versionCode));
      res.json(all);
    } catch (error: any) {
      console.error("[FactoryAlert] list versions error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/factory-alert/download/:version/:filename — Download APK from versioned folder.
  // MB7 (doc 27 Đợt 6) auth: accepts EITHER
  //   (a) ?token= — short-lived HMAC token minted by /version.json (the app's
  //       DownloadManager carries no cookies, so query token is the mechanism),
  //   (b) a valid admin session cookie or x-master-key (browser downloads from
  //       the Software tab), OR
  //   (c) legacy open mode: FACTORY_ALERT_DOWNLOAD_OPEN unset/true (current
  //       default) — token-less requests allowed so pre-1.0.16 fleet devices
  //       can still update. DEPRECATED: set FACTORY_ALERT_DOWNLOAD_OPEN=false
  //       once the fleet is on ≥ 1.0.16 to enforce (a)/(b) only.
  app.get("/api/factory-alert/download/:version/:filename", async (req, res) => {
    try {
      const { version, filename } = req.params;
      const safeName = path.basename(filename);
      const safeVersion = path.basename(version);
      if (!safeName.endsWith(".apk")) {
        return res.status(400).json({ error: "Invalid file type" });
      }

      // ── Auth (MB7) ──
      const { verifyDownloadToken, isDownloadOpen } = await import("./factoryAlertDownloadToken");
      const token = typeof req.query.token === "string" ? req.query.token : undefined;
      let authorized = false;

      if (token) {
        const check = verifyDownloadToken(token, safeVersion, safeName);
        if (check.ok) {
          authorized = true;
        } else {
          logger.warn({ version: safeVersion, reason: check.reason }, "[FactoryAlert] download token rejected");
        }
      }

      if (!authorized) {
        // Admin browser session (cookie) or master key header
        const headerKey = req.header("x-master-key");
        if (headerKey && isValidMasterKey(headerKey)) {
          authorized = true;
        } else {
          try {
            const { sdk } = await import("./sdk");
            const user = await sdk.authenticateRequest(req);
            if (user) authorized = true;
          } catch {
            // no valid session — fall through
          }
        }
      }

      if (!authorized) {
        if (isDownloadOpen()) {
          // Legacy fleet path — allowed but logged so operators can see when
          // it is safe to flip FACTORY_ALERT_DOWNLOAD_OPEN=false.
          logger.warn(
            { version: safeVersion, ip: req.ip },
            "[FactoryAlert] token-less APK download allowed by FACTORY_ALERT_DOWNLOAD_OPEN (deprecated — set to false once fleet ≥ 1.0.16)",
          );
        } else {
          return res.status(401).json({ error: "Unauthorized: download token required" });
        }
      }

      const uploadsRoot = process.env.LOCAL_STORAGE_DIR
        ? path.resolve(process.env.LOCAL_STORAGE_DIR)
        : path.join(process.cwd(), "uploads");
      const filePath = path.join(uploadsRoot, "factory-alert-releases", `v${safeVersion}`, safeName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }

      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      const stat = fs.statSync(filePath);
      res.setHeader("Content-Length", stat.size);
      fs.createReadStream(filePath).pipe(res);
    } catch (error: any) {
      console.error("[FactoryAlert] download error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/factory-alert/push-update — Broadcast active version to all devices via MQTT
  app.post("/api/factory-alert/push-update", async (req, res) => {
    try {
      const { factoryAlertVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return res.status(503).json({ success: false, error: "Database not connected" });
      const [active] = await db.select().from(factoryAlertVersions).where(eq(factoryAlertVersions.isActive, true)).limit(1);

      if (!active) {
        return res.status(404).json({ success: false, error: "No active version found" });
      }

      const versionData = {
        version: active.version?.trim(),
        versionCode: active.versionCode,
        releaseDate: active.releaseDate ? new Date(active.releaseDate).toISOString().split("T")[0] : null,
        apkUrl: `download/${active.version?.trim()}/${active.apkFileName?.trim()}`,
        changelog: active.changelog ? active.changelog.split("\n").filter(Boolean) : [],
        mandatory: active.mandatory,
      };

      await publishFactoryAlertUpdate(versionData);
      console.log(`[FactoryAlert] Push update broadcast sent: v${active.version} (code: ${active.versionCode})`);
      res.json({ success: true, version: active.version, versionCode: active.versionCode });
    } catch (error: any) {
      console.error("[FactoryAlert] push-update error:", error);
      res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  });

  // POST /api/factory-alert/upload — Upload APK to versioned folder and save to DB
  app.post("/api/factory-alert/upload", express.raw({ type: "*/*", limit: "200mb" }), uploadGuard("apk"), async (req, res) => {
    try {
      const version = (req.query.version as string)?.trim();
      const versionCode = parseInt(req.query.versionCode as string, 10);
      const changelog = (req.query.changelog as string)?.trim() || `Release v${version}`;
      const mandatory = req.query.mandatory === "true";

      if (!version || !versionCode) {
        return res.status(400).json({ success: false, error: "Missing version or versionCode" });
      }

      const uploadsRoot = process.env.LOCAL_STORAGE_DIR
        ? path.resolve(process.env.LOCAL_STORAGE_DIR)
        : path.join(process.cwd(), "uploads");
      const versionDir = path.join(uploadsRoot, "factory-alert-releases", `v${version}`);
      if (!fs.existsSync(versionDir)) {
        fs.mkdirSync(versionDir, { recursive: true });
      }

      const targetApkName = `FactoryAlertSystem-v${version}.apk`;
      const targetApkPath = path.join(versionDir, targetApkName);
      fs.writeFileSync(targetApkPath, req.body);

      const fileSize = Buffer.byteLength(req.body);
      const apkFilePath = `factory-alert-releases/v${version}/${targetApkName}`;

      // Insert into DB
      const { factoryAlertVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return res.status(503).json({ success: false, error: "Database not connected" });

      // Check if version already exists, update if so
      const [existing] = await db.select().from(factoryAlertVersions).where(eq(factoryAlertVersions.version, version)).limit(1);
      if (existing) {
        await db.update(factoryAlertVersions).set({
          versionCode,
          changelog,
          mandatory,
          apkFileName: targetApkName,
          apkFilePath,
          fileSize,
          updatedAt: new Date(),
        }).where(eq(factoryAlertVersions.id, existing.id));
      } else {
        await db.insert(factoryAlertVersions).values({
          version,
          versionCode,
          changelog,
          mandatory,
          apkFileName: targetApkName,
          apkFilePath,
          fileSize,
        });
      }

      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
      console.log(`[FactoryAlert] APK uploaded: ${targetApkName} (${fileSizeMB} MB) → v${version}/`);
      res.json({ success: true, version, versionCode, fileName: targetApkName, fileSize: fileSizeMB });
    } catch (error: any) {
      console.error("[FactoryAlert] upload error:", error);
      res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  });

  // POST /api/factory-alert/versions/:id/activate — Set a version as active (deactivate all others)
  app.post("/api/factory-alert/versions/:id/activate", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { factoryAlertVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return res.status(503).json({ success: false, error: "Database not connected" });

      // Deactivate all
      await db.update(factoryAlertVersions).set({ isActive: false, updatedAt: new Date() });
      // Activate target
      await db.update(factoryAlertVersions).set({ isActive: true, updatedAt: new Date() }).where(eq(factoryAlertVersions.id, id));

      const [activated] = await db.select().from(factoryAlertVersions).where(eq(factoryAlertVersions.id, id)).limit(1);
      console.log(`[FactoryAlert] Activated version: v${activated?.version}`);
      res.json({ success: true, version: activated });
    } catch (error: any) {
      console.error("[FactoryAlert] activate error:", error);
      res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  });

  // POST /api/factory-alert/versions/:id/deactivate — Deactivate a version
  app.post("/api/factory-alert/versions/:id/deactivate", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { factoryAlertVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return res.status(503).json({ success: false, error: "Database not connected" });

      await db.update(factoryAlertVersions).set({ isActive: false, updatedAt: new Date() }).where(eq(factoryAlertVersions.id, id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("[FactoryAlert] deactivate error:", error);
      res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  });

  // DELETE /api/factory-alert/versions/:id — Delete a version and its files
  app.delete("/api/factory-alert/versions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { factoryAlertVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return res.status(503).json({ success: false, error: "Database not connected" });

      const [ver] = await db.select().from(factoryAlertVersions).where(eq(factoryAlertVersions.id, id)).limit(1);
      if (!ver) {
        return res.status(404).json({ success: false, error: "Version not found" });
      }

      // Delete file folder
      const uploadsRoot = process.env.LOCAL_STORAGE_DIR
        ? path.resolve(process.env.LOCAL_STORAGE_DIR)
        : path.join(process.cwd(), "uploads");
      const versionDir = path.join(uploadsRoot, "factory-alert-releases", `v${ver.version}`);
      if (fs.existsSync(versionDir)) {
        fs.rmSync(versionDir, { recursive: true, force: true });
      }

      await db.delete(factoryAlertVersions).where(eq(factoryAlertVersions.id, id));
      console.log(`[FactoryAlert] Deleted version: v${ver.version}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[FactoryAlert] delete error:", error);
      res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  });

  // GET /api/machine/product-image — Machine downloads product reference image URL
  app.get("/api/machine/product-image", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || (req.query.apiKey as string);
      const machineCode = req.query.machineCode as string | undefined;
      const productModelCode = req.query.productModelCode as string;

      if (!productModelCode) {
        return res.status(400).json({ success: false, message: "productModelCode query parameter is required" });
      }

      const result = await caller.machineApi.getProductImage({ apiKey, machineCode, productModelCode } as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] get-product-image error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Get product image failed");
    }
  });

  // POST /api/machine/sync-product-image — Machine uploads product reference image to server
  app.post("/api/machine/sync-product-image", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };

      const result = await caller.machineApi.syncProductImage(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] sync-product-image error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Sync product image failed");
    }
  });

  // POST /api/machine/sync-point-image — Upload reference image for a single measurement point
  app.post("/api/machine/sync-point-image", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };

      const result = await caller.machineApi.syncPointImage(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] sync-point-image error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Sync point image failed");
    }
  });

  // GET /api/machine/point-image — Download reference image for a single measurement point by code
  app.get("/api/machine/point-image", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || (req.query.apiKey as string);
      const machineCode = req.query.machineCode as string | undefined;
      const productModelCode = req.query.productModelCode as string;
      const pointCode = req.query.pointCode as string;

      if (!productModelCode) {
        return res.status(400).json({ success: false, message: "productModelCode query parameter is required" });
      }
      if (!pointCode) {
        return res.status(400).json({ success: false, message: "pointCode query parameter is required" });
      }

      const result = await caller.machineApi.getPointImage({ apiKey, machineCode, productModelCode, pointCode } as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] get-point-image error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Get point image failed");
    }
  });

  // GET /api/machine/check-points-version — Fast version check before deciding whether to sync
  // Returns pointsConfigVersion for one or all product models mapped to the machine
  app.get("/api/machine/check-points-version", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || (req.query.apiKey as string);
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string | undefined);
      const productModelCode = req.query.productModelCode as string | undefined;

      const result = await caller.machineApi.checkPointsVersion({ apiKey, machineCode, productModelCode } as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] check-points-version error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Check points version failed");
    }
  });

  // GET /api/machine/delta-sync-points — Download only the points changed since a given version
  // Client passes sinceVersion; server returns all active points when version differs
  app.get("/api/machine/delta-sync-points", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || (req.query.apiKey as string);
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string | undefined);
      const productModelCode = req.query.productModelCode as string;
      const sinceVersion = parseInt(req.query.sinceVersion as string, 10);

      if (!productModelCode) {
        return res.status(400).json({ success: false, message: "productModelCode query parameter is required" });
      }
      if (isNaN(sinceVersion) || sinceVersion < 0) {
        return res.status(400).json({ success: false, message: "sinceVersion query parameter must be a non-negative integer" });
      }

      const result = await caller.machineApi.deltaSyncPoints({ apiKey, machineCode, productModelCode, sinceVersion } as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] delta-sync-points error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Delta sync points failed");
    }
  });

  // GET /api/machine/sync-history — Retrieve sync log entries for the authenticated machine
  app.get("/api/machine/sync-history", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || (req.query.apiKey as string);
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string | undefined);
      const productModelCode = req.query.productModelCode as string | undefined;
      const syncOperation = req.query.syncOperation as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const result = await caller.machineApi.getSyncHistory({
        apiKey, machineCode, productModelCode,
        syncOperation: syncOperation as any,
        limit: isNaN(limit) ? 20 : Math.min(limit, 100),
        offset: isNaN(offset) ? 0 : offset,
      } as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] sync-history error:", error?.code || "", error?.message || error);
      sendMachineProxyError(res, error, "Get sync history failed");
    }
  });

  // ============================================================
  // External Machine Registration API
  // Allows AVI/AOI clients to auto-register machines and get API keys
  // Uses Master API Key for authentication
  // ============================================================
  // Middleware to validate external app access:
  //   1. Master API Key via header x-master-key  (for server-to-server)
  //   2. Bearer token via header Authorization   (for app clients that login with username/password)
  const validateExternalAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Option 1: Master API Key.
    // Header là kênh chuẩn. Query param (?masterKey=) bị deprecate vì rò rỉ qua log/URL:
    // chỉ chấp nhận ngoài production và phát cảnh báo; bị chặn hẳn khi NODE_ENV=production
    // hoặc DISABLE_QUERY_MASTER_KEY=1.
    const headerKey = req.header("x-master-key") || req.header("X-Master-Key");
    const queryKey = typeof req.query.masterKey === "string" ? req.query.masterKey : undefined;
    const queryKeyBlocked =
      process.env.NODE_ENV === "production" ||
      process.env.DISABLE_QUERY_MASTER_KEY === "1" ||
      process.env.DISABLE_QUERY_MASTER_KEY === "true";

    if (queryKey && !headerKey) {
      if (queryKeyBlocked) {
        logger.warn({ path: req.path, ip: req.ip }, "[External] Rejected master key passed via query param (deprecated)");
        return res.status(401).json({
          success: false,
          message: "Master key via query param is disabled. Use the x-master-key header.",
        });
      }
      logger.warn({ path: req.path }, "[External] Master key via query param is deprecated; use x-master-key header");
    }

    const masterKey = headerKey || (queryKeyBlocked ? undefined : queryKey);
    if (isValidMasterKey(masterKey)) {
      return next();
    }


    // Option 2: Bearer token (JWT from /api/external/auth/login)
    const authHeader = req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const { sdk } = await import("./sdk");
        const session = await sdk.verifySession(token);
        if (session) {
          const { getUserByOpenId } = await import("../db");
          const user = await getUserByOpenId(session.openId);
          if (user && user.isActive) {
            (req as any).externalUser = user;
            return next();
          }
        }
      } catch {
        // fall through to 401
      }
    }

    return res.status(401).json({ success: false, message: "Unauthorized. Provide x-master-key header or Authorization: Bearer <token>" });
  };

  // Keep old middleware name as alias for backward compatibility
  const validateMasterKey = validateExternalAuth;

  // POST /api/external/machines/register - Register a new machine or return existing
  app.post("/api/external/machines/register", validateMasterKey, async (req, res) => {
    try {
      const { code, name, machineType, stationId, model, manufacturer, description } = req.body;

      if (!code || !name) {
        return res.status(400).json({ success: false, message: "code and name are required" });
      }

      // Validate machineType
      const validTypes = [...MACHINE_TYPES];
      const type = machineType || "AVI";
      if (!validTypes.includes(type)) {
        return res.status(400).json({ success: false, message: `machineType must be one of: ${validTypes.join(", ")}` });
      }

      const { getMachineByCode, createMachine, getDefaultStation } = await import("../db");
      const { nanoid } = await import("nanoid");

      // Check if machine already exists
      let machine = await getMachineByCode(code);

      if (machine) {
        // Machine exists, return its info
        console.log(`[External] Machine ${code} already exists, returning existing API key`);
        return res.json({
          success: true,
          created: false,
          machine: {
            id: machine.id,
            code: machine.code,
            name: machine.name,
            machineType: machine.machineType,
            apiKey: machine.apiKey,
            stationId: machine.stationId,
          },
          message: "Machine already exists",
        });
      }

      // Create new machine
      // If stationId not provided, use default station (id: 1) or first available
      let targetStationId = stationId;
      if (!targetStationId) {
        const defaultStation = await getDefaultStation();
        if (!defaultStation) {
          return res.status(400).json({ success: false, message: "No station available. Please create a station first or provide stationId." });
        }
        targetStationId = defaultStation.id;
      }

      const apiKey = `mach_${nanoid(32)}`;
      const machineId = await createMachine({
        stationId: targetStationId,
        code,
        name,
        machineType: type,
        model: model || null,
        manufacturer: manufacturer || null,
        description: description || null,
        apiKey,
      });

      console.log(`[External] New machine registered: ${code} (ID: ${machineId})`);

      res.json({
        success: true,
        created: true,
        machine: {
          id: machineId,
          code,
          name,
          machineType: type,
          apiKey,
          stationId: targetStationId,
        },
        message: "Machine registered successfully",
      });
    } catch (error: any) {
      console.error("[External] register-machine error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to register machine" });
    }
  });

  // GET /api/external/machines/by-code/:code - Get machine info by code
  app.get("/api/external/machines/by-code/:code", validateMasterKey, async (req, res) => {
    try {
      const { code } = req.params;

      if (!code) {
        return res.status(400).json({ success: false, message: "Machine code is required" });
      }

      const { getMachineByCode } = await import("../db");
      const machine = await getMachineByCode(code);

      if (!machine) {
        return res.status(404).json({ success: false, message: "Machine not found" });
      }

      res.json({
        success: true,
        machine: {
          id: machine.id,
          code: machine.code,
          name: machine.name,
          machineType: machine.machineType,
          apiKey: machine.apiKey,
          stationId: machine.stationId,
          model: machine.model,
          manufacturer: machine.manufacturer,
          isActive: machine.isActive,
        },
      });
    } catch (error: any) {
      console.error("[External] get-machine error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get machine" });
    }
  });

  // GET /api/external/machines - List all machines
  app.get("/api/external/machines", validateMasterKey, async (req, res) => {
    try {
      const { getMachines } = await import("../db");
      const machines = await getMachines();

      res.json({
        success: true,
        total: machines.length,
        machines: machines.map(m => ({
          id: m.id,
          code: m.code,
          name: m.name,
          machineType: m.machineType,
          apiKey: m.apiKey,
          stationId: m.stationId,
          isActive: m.isActive,
        })),
      });
    } catch (error: any) {
      console.error("[External] list-machines error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to list machines" });
    }
  });

  // ============================================================
  // External Auth — Login to get Bearer token (for apps without Master API Key)
  // ============================================================
  app.post("/api/external/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, message: "username and password are required" });
      }

      const bcrypt = await import("bcryptjs");
      const { getUserByUsername, upsertUser } = await import("../db");
      const user = await getUserByUsername(username);
      if (!user || !user.isActive || !user.passwordHash) {
        return res.status(401).json({ success: false, message: "Invalid username or password" });
      }

      // Brute-force lockout check
      const MAX_ATTEMPTS = 5;
      const LOCKOUT_MINUTES = 15;
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        return res.status(429).json({ success: false, message: `Account locked. Try again in ${remaining} minutes.` });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        const { updateUserLoginAttempts } = await import("../db");
        const newAttempts = (user.loginAttempts ?? 0) + 1;
        const lockedUntil = newAttempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
        await updateUserLoginAttempts(user.id, newAttempts, lockedUntil);
        return res.status(401).json({ success: false, message: lockedUntil ? `Account locked for ${LOCKOUT_MINUTES} minutes.` : "Invalid username or password" });
      }

      // Reset lockout on successful login
      if ((user.loginAttempts ?? 0) > 0) {
        const { updateUserLoginAttempts } = await import("../db");
        await updateUserLoginAttempts(user.id, 0, null);
      }

      // Create JWT token (same format as session cookie, but returned as Bearer token)
      const { sdk } = await import("./sdk");
      const token = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      await upsertUser({ openId: user.openId, lastSignedIn: new Date() });

      res.json({
        success: true,
        token,
        expiresIn: "30d",
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        usage: 'Add header: Authorization: Bearer <token>',
      });
    } catch (error: any) {
      console.error("[External] auth/login error:", error);
      res.status(500).json({ success: false, message: error?.message || "Login failed" });
    }
  });

  // ============================================================
  // Hierarchy Tree & MQTT — REST proxy for external apps
  // Supports: x-master-key header OR Authorization: Bearer <token>
  // ============================================================

  // GET /api/external/hierarchy/tree — Full hierarchy tree
  app.get("/api/external/hierarchy/tree", validateMasterKey, async (req, res) => {
    try {
      const { getFullHierarchyFlat } = await import("../db");
      const { buildHierarchyTree } = await import("../routers/hierarchyTreeRouter");
      const rows = await getFullHierarchyFlat();
      const tree = buildHierarchyTree(rows);
      res.json({ success: true, data: tree });
    } catch (error: any) {
      console.error("[External] hierarchy-tree error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get hierarchy tree" });
    }
  });

  // GET /api/external/hierarchy/factory/:factoryId — Single factory tree
  app.get("/api/external/hierarchy/factory/:factoryId", validateMasterKey, async (req, res) => {
    try {
      const factoryId = parseInt(req.params.factoryId, 10);
      if (isNaN(factoryId)) {
        return res.status(400).json({ success: false, message: "factoryId must be a number" });
      }
      const { getFactoryHierarchyFlat } = await import("../db");
      const { buildHierarchyTree } = await import("../routers/hierarchyTreeRouter");
      const rows = await getFactoryHierarchyFlat(factoryId);
      const tree = buildHierarchyTree(rows as any);
      res.json({ success: true, data: tree[0] ?? null });
    } catch (error: any) {
      console.error("[External] factory-tree error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get factory tree" });
    }
  });

  // GET /api/external/hierarchy/mqtt-topics — Generate MQTT subscription topics
  app.get("/api/external/hierarchy/mqtt-topics", validateMasterKey, async (req, res) => {
    try {
      const level = (req.query.level as string) || "all";
      const validLevels = ["all", "factory", "workshop", "line", "station"];
      if (!validLevels.includes(level)) {
        return res.status(400).json({ success: false, message: `level must be one of: ${validLevels.join(", ")}` });
      }
      const factoryId = req.query.factoryId ? parseInt(req.query.factoryId as string, 10) : undefined;
      const workshopId = req.query.workshopId ? parseInt(req.query.workshopId as string, 10) : undefined;
      const lineId = req.query.lineId ? parseInt(req.query.lineId as string, 10) : undefined;
      const stationId = req.query.stationId ? parseInt(req.query.stationId as string, 10) : undefined;
      const messageTypes = req.query.messageTypes ? (req.query.messageTypes as string).split(",") : undefined;

      const { getFullHierarchyFlat } = await import("../db");
      const { buildHierarchyTree, generateMqttTopicsForScope } = await import("../routers/hierarchyTreeRouter");
      const rows = await getFullHierarchyFlat();
      const tree = buildHierarchyTree(rows);
      const topics = generateMqttTopicsForScope(tree, { level, factoryId, workshopId, lineId, stationId }, messageTypes);
      res.json({ success: true, data: topics });
    } catch (error: any) {
      console.error("[External] mqtt-topics error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to generate MQTT topics" });
    }
  });

  // GET /api/external/hierarchy/mqtt-message-types — List all MQTT message types
  app.get("/api/external/hierarchy/mqtt-message-types", validateMasterKey, async (req, res) => {
    try {
      const { getMqttMessageTypesList } = await import("../routers/hierarchyTreeRouter");
      res.json({ success: true, data: getMqttMessageTypesList() });
    } catch (error: any) {
      console.error("[External] mqtt-message-types error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get message types" });
    }
  });

  // GET /api/external/hierarchy/summary — Hierarchy count summary
  app.get("/api/external/hierarchy/summary", validateMasterKey, async (req, res) => {
    try {
      const { getFullHierarchyFlat } = await import("../db");
      const { buildHierarchyTree } = await import("../routers/hierarchyTreeRouter");
      const rows = await getFullHierarchyFlat();
      const tree = buildHierarchyTree(rows);

      let totalWorkshops = 0, totalLines = 0, totalStations = 0, totalMachines = 0;
      for (const factory of tree) {
        totalWorkshops += factory.workshops.length;
        for (const workshop of factory.workshops) {
          totalLines += workshop.lines.length;
          for (const line of workshop.lines) {
            totalStations += line.stations.length;
            for (const station of line.stations) {
              totalMachines += station.machines.length;
            }
          }
        }
      }

      res.json({
        success: true,
        data: { factories: tree.length, workshops: totalWorkshops, lines: totalLines, stations: totalStations, machines: totalMachines },
      });
    } catch (error: any) {
      console.error("[External] hierarchy-summary error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get hierarchy summary" });
    }
  });

  // ============================================================
  // Measurement Point Statistics API — for third-party integration
  // GET /api/external/statistics/measurement-points
  // Supports: x-master-key OR Authorization: Bearer <token>
  // ============================================================
  app.get("/api/external/statistics/measurement-points", validateExternalAuth, async (req, res) => {
    try {
      const productModelId = req.query.productModelId ? parseInt(req.query.productModelId as string, 10) : undefined;
      const productCode = req.query.productCode as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      // Validate required params
      if (!productModelId && !productCode) {
        return res.status(400).json({
          success: false,
          message: "Either productModelId or productCode is required",
        });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate are required (ISO 8601 format, e.g. 2025-01-01 or 2025-01-01T00:00:00Z)",
        });
      }

      // Parse dates
      const parsedStart = parseLocalDate(startDate);
      const parsedEnd = parseLocalDate(endDate);
      if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate must be valid ISO 8601 dates",
        });
      }
      if (parsedStart > parsedEnd) {
        return res.status(400).json({
          success: false,
          message: "startDate must be before or equal to endDate",
        });
      }

      const { getProductModelById, getProductModelByCode, getMeasurementPointStatsByProduct, getMeasurementPointImagesByProduct } = await import("../db");

      // Resolve product model
      let productModel: any = null;
      if (productModelId) {
        if (isNaN(productModelId)) {
          return res.status(400).json({ success: false, message: "productModelId must be a number" });
        }
        productModel = await getProductModelById(productModelId);
      } else if (productCode) {
        productModel = await getProductModelByCode(productCode);
      }

      if (!productModel) {
        return res.status(404).json({
          success: false,
          message: productModelId
            ? `Product model with ID ${productModelId} not found`
            : `Product model with code "${productCode}" not found`,
        });
      }

      // Get statistics
      const stats = await getMeasurementPointStatsByProduct({
        productModelId: productModel.id,
        startDate: parsedStart,
        endDate: parsedEnd,
      });

      // Optionally include images
      const includeImages = req.query.includeImages === "true" || req.query.includeImages === "1";
      let imagesByPoint: Record<number, { okImages: any[]; ngImages: any[] }> = {};
      if (includeImages) {
        imagesByPoint = await getMeasurementPointImagesByProduct({
          productModelId: productModel.id,
          startDate: parsedStart,
          endDate: parsedEnd,
        });
      }

      const points = stats.map((point) => {
        const base: any = { ...point };
        if (includeImages) {
          const imgs = imagesByPoint[point.pointDefId] || { okImages: [], ngImages: [] };
          base.images = {
            okImages: imgs.okImages,
            ngImages: imgs.ngImages,
          };
        }
        return base;
      });

      res.json({
        success: true,
        data: {
          productModel: {
            id: productModel.id,
            code: productModel.code,
            name: productModel.name,
          },
          dateRange: {
            startDate: parsedStart.toISOString(),
            endDate: parsedEnd.toISOString(),
          },
          totalPoints: points.length,
          points,
        },
      });
    } catch (error: any) {
      console.error("[External] measurement-point-stats error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get measurement point statistics" });
    }
  });

  // ============================================================
  // Alert Management APIs — for third-party integration
  // GET  /api/external/alerts          — List alerts (paginated, filterable)
  // GET  /api/external/alerts/:alertId — Get single alert detail
  // POST /api/external/alerts/:alertId/acknowledge — Acknowledge an alert
  // POST /api/external/alerts/:alertId/resolve     — Resolve an alert
  // ============================================================

  app.get("/api/external/alerts", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { alertHistory, alertSettings, mqttAlertHistory, mqttAlertRules, mqttConnectionAlerts } = await import("../../drizzle/schema");
      const { desc, sql, and, gte, lte, eq: eqOp, or } = await import("drizzle-orm");

      const source = (req.query.source as string) || "all"; // "alert" | "mqtt" | "connection" | "all"
      const status = req.query.status as string | undefined; // "pending" | "acknowledged" | "resolved"
      const severity = req.query.severity as string | undefined;
      const stationId = req.query.stationId ? parseInt(req.query.stationId as string, 10) : undefined;
      const startDate = req.query.startDate ? parseLocalDate(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? parseLocalDate(req.query.endDate as string) : undefined;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const results: any[] = [];

      // 1. alertHistory (from alertSettings rules)
      if (source === "all" || source === "alert") {
        const conditions: any[] = [];
        if (startDate) conditions.push(gte(alertHistory.createdAt, startDate));
        if (endDate) conditions.push(lte(alertHistory.createdAt, endDate));
        if (status === "acknowledged") conditions.push(sql`${alertHistory.acknowledgedAt} IS NOT NULL`);
        if (status === "pending") conditions.push(sql`${alertHistory.acknowledgedAt} IS NULL`);

        const rows = await database
          .select({
            id: alertHistory.id,
            alertSettingId: alertHistory.alertSettingId,
            triggeredValue: alertHistory.triggeredValue,
            message: alertHistory.message,
            acknowledgedAt: alertHistory.acknowledgedAt,
            acknowledgedBy: alertHistory.acknowledgedBy,
            createdAt: alertHistory.createdAt,
            settingName: alertSettings.name,
            alertType: alertSettings.alertType,
          })
          .from(alertHistory)
          .leftJoin(alertSettings, eqOp(alertHistory.alertSettingId, alertSettings.id))
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(alertHistory.createdAt))
          .limit(limit)
          .offset(offset);

        for (const r of rows) {
          results.push({
            id: `alert-${r.id}`,
            source: "alert",
            alertType: r.alertType,
            settingName: r.settingName,
            message: r.message,
            triggeredValue: r.triggeredValue,
            status: r.acknowledgedAt ? "acknowledged" : "pending",
            acknowledgedAt: r.acknowledgedAt,
            acknowledgedBy: r.acknowledgedBy,
            createdAt: r.createdAt,
          });
        }
      }

      // 2. mqttAlertHistory (from mqtt alert rules)
      if (source === "all" || source === "mqtt") {
        const conditions: any[] = [];
        if (startDate) conditions.push(gte(mqttAlertHistory.triggeredAt, startDate));
        if (endDate) conditions.push(lte(mqttAlertHistory.triggeredAt, endDate));
        if (status === "resolved") conditions.push(eqOp(mqttAlertHistory.isResolved, true));
        if (status === "pending") conditions.push(eqOp(mqttAlertHistory.isResolved, false));

        const rows = await database
          .select()
          .from(mqttAlertHistory)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(mqttAlertHistory.triggeredAt))
          .limit(limit)
          .offset(offset);

        for (const r of rows) {
          results.push({
            id: `mqtt-${r.id}`,
            source: "mqtt",
            ruleId: r.ruleId,
            ruleName: r.ruleName,
            ruleType: r.ruleType,
            message: r.message,
            triggeredValue: r.triggeredValue,
            thresholdValue: r.thresholdValue,
            status: r.isResolved ? "resolved" : "pending",
            isResolved: r.isResolved,
            resolvedAt: r.resolvedAt,
            resolvedBy: r.resolvedBy,
            resolutionNote: r.resolutionNote,
            createdAt: r.triggeredAt,
          });
        }
      }

      // 3. mqttConnectionAlerts (connection lost/disconnect alerts)
      if (source === "all" || source === "connection") {
        const conditions: any[] = [];
        if (startDate) conditions.push(gte(mqttConnectionAlerts.triggeredAt, startDate));
        if (endDate) conditions.push(lte(mqttConnectionAlerts.triggeredAt, endDate));
        if (severity) conditions.push(eqOp(mqttConnectionAlerts.severity, severity as any));
        if (status === "acknowledged") conditions.push(eqOp(mqttConnectionAlerts.isAcknowledged, true));
        if (status === "resolved") conditions.push(eqOp(mqttConnectionAlerts.isResolved, true));
        if (status === "pending") conditions.push(and(eqOp(mqttConnectionAlerts.isAcknowledged, false), eqOp(mqttConnectionAlerts.isResolved, false)));

        const rows = await database
          .select()
          .from(mqttConnectionAlerts)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(mqttConnectionAlerts.triggeredAt))
          .limit(limit)
          .offset(offset);

        for (const r of rows) {
          results.push({
            id: `conn-${r.id}`,
            source: "connection",
            stationId: r.targetType === "station" ? r.targetId : undefined,
            alertType: r.alertType,
            severity: r.severity,
            title: r.title,
            message: r.message,
            status: r.isResolved ? "resolved" : r.isAcknowledged ? "acknowledged" : "pending",
            isAcknowledged: r.isAcknowledged,
            acknowledgedAt: r.acknowledgedAt,
            acknowledgedBy: r.acknowledgedBy,
            isResolved: r.isResolved,
            resolvedAt: r.resolvedAt,
            createdAt: r.triggeredAt,
          });
        }
      }

      // Enrich rows that carry a station id (connection alerts) with the station name.
      // Single cheap lookup, only when needed; app has a fallback if absent.
      const stationIds = new Set<number>();
      for (const r of results) if (typeof r.stationId === "number") stationIds.add(r.stationId);
      if (stationIds.size > 0) {
        try {
          const { getStations } = await import("../db");
          const allStations = await getStations();
          const nameById = new Map<number, string>(allStations.map((s: any) => [s.id, s.name]));
          for (const r of results) {
            if (typeof r.stationId === "number") r.stationName = nameById.get(r.stationId);
          }
        } catch { /* leave stationName undefined */ }
      }

      // Sort combined results by createdAt descending
      results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({
        success: true,
        data: results.slice(0, limit),
        pagination: { limit, offset, count: results.length },
      });
    } catch (error: any) {
      console.error("[External] alerts list error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get alerts" });
    }
  });

  app.get("/api/external/alerts/:alertId", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { alertHistory, alertSettings, mqttAlertHistory, mqttConnectionAlerts } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      const alertId = req.params.alertId; // format: "alert-123", "mqtt-456", "conn-789"
      const [source, idStr] = alertId.split("-");
      const numId = parseInt(idStr, 10);
      if (!source || isNaN(numId)) {
        return res.status(400).json({ success: false, message: "Invalid alertId format. Expected: alert-{id}, mqtt-{id}, or conn-{id}" });
      }

      let detail: any = null;

      if (source === "alert") {
        const rows = await database
          .select({
            id: alertHistory.id,
            alertSettingId: alertHistory.alertSettingId,
            triggeredValue: alertHistory.triggeredValue,
            message: alertHistory.message,
            sentEmail: alertHistory.sentEmail,
            sentSms: alertHistory.sentSms,
            sentInApp: alertHistory.sentInApp,
            acknowledgedAt: alertHistory.acknowledgedAt,
            acknowledgedBy: alertHistory.acknowledgedBy,
            createdAt: alertHistory.createdAt,
            settingName: alertSettings.name,
            alertType: alertSettings.alertType,
            threshold: alertSettings.threshold,
          })
          .from(alertHistory)
          .leftJoin(alertSettings, eqOp(alertHistory.alertSettingId, alertSettings.id))
          .where(eqOp(alertHistory.id, numId))
          .limit(1);
        if (rows.length > 0) {
          const r = rows[0];
          detail = { source: "alert", ...r, id: alertId, status: r.acknowledgedAt ? "acknowledged" : "pending" };
        }
      } else if (source === "mqtt") {
        const rows = await database.select().from(mqttAlertHistory).where(eqOp(mqttAlertHistory.id, numId)).limit(1);
        if (rows.length > 0) {
          const r = rows[0];
          detail = { source: "mqtt", ...r, id: alertId, status: r.isResolved ? "resolved" : "pending" };
        }
      } else if (source === "conn") {
        const rows = await database.select().from(mqttConnectionAlerts).where(eqOp(mqttConnectionAlerts.id, numId)).limit(1);
        if (rows.length > 0) {
          const r = rows[0];
          detail = { source: "connection", ...r, id: alertId, status: r.isResolved ? "resolved" : r.isAcknowledged ? "acknowledged" : "pending" };
        }
      } else {
        return res.status(400).json({ success: false, message: "Unknown alert source. Use: alert, mqtt, or conn" });
      }

      if (!detail) {
        return res.status(404).json({ success: false, message: "Alert not found" });
      }

      res.json({ success: true, data: detail });
    } catch (error: any) {
      console.error("[External] alert detail error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get alert detail" });
    }
  });

  app.post("/api/external/alerts/:alertId/acknowledge", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { alertHistory, mqttConnectionAlerts } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      const alertId = req.params.alertId;
      // Live per-inspection NG (ALT-*) and NG-rate (NGRATE-*) alerts are ephemeral MQTT
      // events with no ack-able DB row (published from inspection flow, not persisted as
      // an alert). Accept as a 200 no-op so the app's postAction succeeds; the ack stays
      // client/local-only. See ngRateAlertService / mqttService.publishNGAlert.
      if (/^(ALT|NGRATE)-/.test(alertId)) {
        return res.json({
          success: true,
          message: "Live inspection alert acknowledged (no server-side alert record to persist)",
          alertId,
          acknowledgedAt: new Date().toISOString(),
          persisted: false,
          localOnly: true,
        });
      }
      const [source, idStr] = alertId.split("-");
      const numId = parseInt(idStr, 10);
      if (!source || isNaN(numId)) {
        return res.status(400).json({ success: false, message: "Invalid alertId format. Expected: alert-{id} or conn-{id}" });
      }

      const user = (req as any).externalUser;
      const userId = user?.id || null;
      const now = new Date();

      if (source === "alert") {
        const updated = await database.update(alertHistory)
          .set({ acknowledgedAt: now, acknowledgedBy: userId })
          .where(eqOp(alertHistory.id, numId))
          .returning({ id: alertHistory.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "Alert not found" });
      } else if (source === "conn") {
        const updated = await database.update(mqttConnectionAlerts)
          .set({ isAcknowledged: true, acknowledgedAt: now, acknowledgedBy: userId, updatedAt: now })
          .where(eqOp(mqttConnectionAlerts.id, numId))
          .returning({ id: mqttConnectionAlerts.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "Connection alert not found" });
      } else {
        return res.status(400).json({ success: false, message: "Acknowledge is supported for alert-{id} and conn-{id} types" });
      }

      res.json({ success: true, message: "Alert acknowledged", alertId, acknowledgedAt: now.toISOString() });
    } catch (error: any) {
      console.error("[External] alert acknowledge error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to acknowledge alert" });
    }
  });

  app.post("/api/external/alerts/:alertId/resolve", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { mqttAlertHistory, mqttConnectionAlerts, mqttNgRateAlertHistory } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      const alertId = req.params.alertId;
      // Ephemeral per-inspection NG (ALT-*) and business-id NG-rate (NGRATE-*, uppercase)
      // alerts have no resolvable DB row reachable via this endpoint. Accept as a 200
      // no-op so the app's postAction succeeds; the resolve stays local-only. NOTE: the
      // match is case-SENSITIVE — the lowercase `ngrate-{id}` server id (carried as
      // serverAlertId in the payload) DOES resolve below.
      if (/^(ALT|NGRATE)-/.test(alertId)) {
        return res.json({
          success: true,
          message: "Live inspection alert resolved (no server-side alert record to persist)",
          alertId,
          resolvedAt: new Date().toISOString(),
          persisted: false,
          localOnly: true,
        });
      }
      const [source, idStr] = alertId.split("-");
      const numId = parseInt(idStr, 10);
      if (!source || isNaN(numId)) {
        return res.status(400).json({ success: false, message: "Invalid alertId format. Expected: mqtt-{id}, conn-{id} or ngrate-{id}" });
      }

      const user = (req as any).externalUser;
      const userId = user?.id || null;
      const now = new Date();
      const resolutionNote = req.body.resolutionNote || req.body.note || null;

      if (source === "mqtt") {
        const updated = await database.update(mqttAlertHistory)
          .set({ isResolved: true, resolvedAt: now, resolvedBy: userId, resolutionNote })
          .where(eqOp(mqttAlertHistory.id, numId))
          .returning({ id: mqttAlertHistory.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "MQTT alert not found" });
      } else if (source === "conn") {
        const updated = await database.update(mqttConnectionAlerts)
          .set({ isResolved: true, resolvedAt: now, updatedAt: now })
          .where(eqOp(mqttConnectionAlerts.id, numId))
          .returning({ id: mqttConnectionAlerts.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "Connection alert not found" });
      } else if (source === "ngrate") {
        const updated = await database.update(mqttNgRateAlertHistory)
          .set({ isResolved: true, resolvedAt: now, resolvedBy: userId, resolutionNote })
          .where(eqOp(mqttNgRateAlertHistory.id, numId))
          .returning({ id: mqttNgRateAlertHistory.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "NG-rate alert not found" });
      } else {
        return res.status(400).json({ success: false, message: "Resolve is supported for mqtt-{id}, conn-{id} and ngrate-{id} types" });
      }

      res.json({ success: true, message: "Alert resolved", alertId, resolvedAt: now.toISOString() });
    } catch (error: any) {
      console.error("[External] alert resolve error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to resolve alert" });
    }
  });

  // ============================================================
  // Bulletin History API — for third-party integration
  // GET /api/external/bulletins — List bulletin history (paginated)
  // ============================================================
  app.get("/api/external/bulletins", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { mqttBulletinHistory } = await import("../../drizzle/schema");
      const { desc, and, gte, lte, eq: eqOp } = await import("drizzle-orm");

      const stationId = req.query.stationId ? parseInt(req.query.stationId as string, 10) : undefined;
      const startDate = req.query.startDate ? parseLocalDate(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? parseLocalDate(req.query.endDate as string) : undefined;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const conditions: any[] = [];
      if (stationId) conditions.push(eqOp(mqttBulletinHistory.stationId, stationId));
      if (startDate) conditions.push(gte(mqttBulletinHistory.createdAt, startDate));
      if (endDate) conditions.push(lte(mqttBulletinHistory.createdAt, endDate));

      const rows = await database
        .select()
        .from(mqttBulletinHistory)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(mqttBulletinHistory.createdAt))
        .limit(limit)
        .offset(offset);

      // Enrich with station name (single cheap lookup; app has a fallback if absent)
      let stationNameById = new Map<number, string>();
      try {
        const { getStations } = await import("../db");
        const allStations = await getStations();
        stationNameById = new Map(allStations.map((s: any) => [s.id, s.name]));
      } catch { /* leave stationName undefined */ }

      res.json({
        success: true,
        data: rows.map((r: any) => ({
          id: r.id,
          stationId: r.stationId,
          stationName: stationNameById.get(r.stationId),
          bulletinType: r.bulletinType,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          totalCount: r.totalCount,
          okCount: r.okCount,
          ngCount: r.ngCount,
          ntfCount: r.ntfCount,
          yieldRate: r.yieldRate,
          failPoints: r.failPoints,
          deliveryStatus: r.deliveryStatus,
          createdAt: r.createdAt,
        })),
        pagination: { limit, offset, count: rows.length },
      });
    } catch (error: any) {
      console.error("[External] bulletins list error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get bulletins" });
    }
  });

  // ============================================================
  // Dashboard Summary API — for third-party KPI dashboard
  // GET /api/external/dashboard/summary
  // ============================================================
  app.get("/api/external/dashboard/summary", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { alertHistory, mqttAlertHistory, mqttConnectionAlerts, mqttBulletinHistory } = await import("../../drizzle/schema");
      const { sql, count, eq: eqOp, gte } = await import("drizzle-orm");

      // Default: today's summary
      const sinceParam = req.query.since as string | undefined;
      const since = sinceParam ? new Date(sinceParam) : new Date(new Date().setHours(0, 0, 0, 0));

      // Alert counts
      const [alertCount] = await database
        .select({ total: count() })
        .from(alertHistory)
        .where(gte(alertHistory.createdAt, since));

      const [alertPending] = await database
        .select({ total: count() })
        .from(alertHistory)
        .where(sql`${alertHistory.createdAt} >= ${since} AND ${alertHistory.acknowledgedAt} IS NULL`);

      // MQTT alert counts
      const [mqttAlertCount] = await database
        .select({ total: count() })
        .from(mqttAlertHistory)
        .where(gte(mqttAlertHistory.triggeredAt, since));

      const [mqttAlertPending] = await database
        .select({ total: count() })
        .from(mqttAlertHistory)
        .where(sql`${mqttAlertHistory.triggeredAt} >= ${since} AND ${mqttAlertHistory.isResolved} = false`);

      // Connection alert counts
      const [connAlertCount] = await database
        .select({ total: count() })
        .from(mqttConnectionAlerts)
        .where(gte(mqttConnectionAlerts.triggeredAt, since));

      const [connAlertPending] = await database
        .select({ total: count() })
        .from(mqttConnectionAlerts)
        .where(sql`${mqttConnectionAlerts.triggeredAt} >= ${since} AND ${mqttConnectionAlerts.isResolved} = false AND ${mqttConnectionAlerts.isAcknowledged} = false`);

      // Recent bulletins count
      const [bulletinCount] = await database
        .select({ total: count() })
        .from(mqttBulletinHistory)
        .where(gte(mqttBulletinHistory.createdAt, since));

      res.json({
        success: true,
        data: {
          since: since.toISOString(),
          alerts: {
            total: (alertCount?.total || 0) + (mqttAlertCount?.total || 0) + (connAlertCount?.total || 0),
            pending: (alertPending?.total || 0) + (mqttAlertPending?.total || 0) + (connAlertPending?.total || 0),
            breakdown: {
              alertHistory: { total: alertCount?.total || 0, pending: alertPending?.total || 0 },
              mqttAlerts: { total: mqttAlertCount?.total || 0, pending: mqttAlertPending?.total || 0 },
              connectionAlerts: { total: connAlertCount?.total || 0, pending: connAlertPending?.total || 0 },
            },
          },
          bulletins: {
            total: bulletinCount?.total || 0,
          },
        },
      });
    } catch (error: any) {
      console.error("[External] dashboard summary error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get dashboard summary" });
    }
  });

  // ============================================================
  // Report Generation API — on-demand reports for mobile/third-party
  // POST /api/external/reports/generate            — build a REAL report file, returns downloadUrl
  // GET  /api/external/reports/:reportId/download  — stream the persisted artifact
  // ============================================================
  // Wave R3 (doc 32 §2 P0 #1): the old summary-only stub (in-memory Map, TTL 30',
  // ignored `format`, counted alerts) is RETIRED. Reports now run through
  // externalReportService: R1 aggregators → renderReport (R2-A, honors pdf/xlsx/csv)
  // → persistArtifact (R2-B report_artifacts store, 1-year retention). The report id
  // IS the artifact row id; the download route streams the persisted file. Auth
  // preserved (validateExternalAuth: x-master-key OR JWT bearer).
  app.post("/api/external/reports/generate", validateExternalAuth, async (req, res) => {
    try {
      const { reportType, format, dateFrom, dateTo, filters, locale } = req.body || {};
      // JWT callers carry a user (→ createdBy); master-key server-to-server does not.
      const createdBy = (req as any).externalUser?.id ?? null;

      const { generateExternalReport, ExternalReportError } = await import("../services/externalReportService");
      try {
        const result = await generateExternalReport({
          reportType,
          format,
          dateFrom,
          dateTo,
          filters,
          locale,
          createdBy,
          source: "external",
        });
        return res.json({
          success: true,
          reportId: result.reportId,
          // External-auth download path (works with x-master-key — backward-compatible
          // with the current mobile client). See artifactUrl for the canonical link.
          downloadUrl: `/api/external/reports/${result.reportId}/download`,
          // Canonical auth-gated artifact link (web session / scoped export:read key).
          artifactUrl: result.downloadUrl,
          format: result.format,
          reportType: result.reportType,
          title: result.title,
          rowCount: result.rowCount,
          fileSize: result.fileSize,
          generatedAt: result.generatedAt,
          expiresAt: result.expiresAt.toISOString(),
          emptyState: result.emptyState,
          ...(result.emptyReason ? { emptyReason: result.emptyReason } : {}),
          deduped: result.deduped,
        });
      } catch (err: any) {
        if (err instanceof ExternalReportError) {
          return res.status(err.status).json({ success: false, message: err.message });
        }
        throw err;
      }
    } catch (error: any) {
      console.error("[External] report generate error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to generate report" });
    }
  });

  // GET /api/external/reports/:reportId/download — stream the persisted artifact.
  // :reportId is the report_artifacts row id (returned by generate). Auth preserved
  // (validateExternalAuth): x-master-key callers are trusted server-to-server
  // (privileged) readers; JWT callers read their own artifacts (or any, when their
  // role is privileged). Retired: the old in-memory Map / 1-line-CSV / JSON-summary.
  app.get("/api/external/reports/:reportId/download", validateExternalAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.reportId), 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ success: false, message: "Invalid reportId (expected an artifact id)." });
      }

      const externalUser = (req as any).externalUser;
      const viewer = externalUser
        ? { id: externalUser.id, role: (externalUser as any).role }
        : { privileged: true }; // trusted x-master-key server-to-server caller

      const { getDownloadTarget, ArtifactError } = await import("../services/reportArtifactService");
      let target;
      try {
        target = await getDownloadTarget(id, viewer);
      } catch (err: any) {
        if (err instanceof ArtifactError) {
          const status = err.reason === "forbidden" ? 403 : err.reason === "expired" ? 410 : 404;
          return res.status(status).json({ success: false, reason: err.reason, message: err.message });
        }
        throw err;
      }

      const { artifact, directUrl, filename } = target;
      res.setHeader("Content-Type", artifact.contentType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("X-Artifact-Sha256", artifact.fileHash);
      res.setHeader("Cache-Control", "private, no-store");

      // Local-disk storage: stream from the uploads root (path-guarded).
      if (directUrl.startsWith("/uploads/")) {
        const uploadsRoot = process.env.LOCAL_STORAGE_DIR
          ? path.resolve(process.env.LOCAL_STORAGE_DIR)
          : path.join(process.cwd(), "uploads");
        const resolved = path.resolve(path.join(uploadsRoot, directUrl.replace("/uploads/", "")));
        if (!resolved.startsWith(path.resolve(uploadsRoot) + path.sep)) {
          return res.status(400).json({ success: false, message: "Invalid artifact path" });
        }
        if (!fs.existsSync(resolved)) {
          return res.status(404).json({ success: false, message: "Artifact file missing from storage" });
        }
        res.setHeader("Content-Length", fs.statSync(resolved).size);
        return fs.createReadStream(resolved).pipe(res);
      }

      // Remote storage (Forge/S3): fetch upstream + pipe through.
      const { Readable } = await import("stream");
      const upstream = await fetch(directUrl);
      if (!upstream.ok) {
        return res.status(502).json({ success: false, message: "Upstream storage fetch failed" });
      }
      const cl = upstream.headers.get("content-length");
      if (cl) res.setHeader("Content-Length", cl);
      if (!upstream.body) return res.end();
      return Readable.fromWeb(upstream.body as never).pipe(res);
    } catch (error: any) {
      console.error("[External] report download error:", error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: error?.message || "Failed to download report" });
      } else {
        res.end();
      }
    }
  });

  // ============================================================
  // User Preferences API — sync notification/app prefs for mobile
  // GET  /api/external/user/preferences
  // PUT  /api/external/user/preferences
  // ============================================================
  app.get("/api/external/user/preferences", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });

      // Extract userId from auth context (set by validateExternalAuth when JWT is present)
      // validateExternalAuth sets req.externalUser for Bearer (JWT) callers.
      // Prefer it so authenticated external users resolve a userId (master-key
      // server-to-server auth has no user context and still 401s below).
      const userId = (req as any).externalUser?.id || (req as any).userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "User context required. Please authenticate with JWT." });
      }

      const { userNotificationPreferences, userSettings } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      // Fetch notification preferences
      const [notifPref] = await database.select().from(userNotificationPreferences).where(eqOp(userNotificationPreferences.userId, userId)).limit(1);

      // Fetch user settings
      const [settings] = await database.select().from(userSettings).where(eqOp(userSettings.userId, userId)).limit(1);

      res.json({
        success: true,
        data: {
          notifications: {
            severityFilter: [], // Not stored in DB — client-only filter
            quietHoursEnabled: notifPref?.quietHoursEnabled ?? false,
            quietHoursStart: notifPref?.quietHoursStart ?? "22:00",
            quietHoursEnd: notifPref?.quietHoursEnd ?? "07:00",
            stationFilters: [], // Client-only
            emailEnabled: notifPref?.emailEnabled ?? true,
            pushEnabled: notifPref?.pushEnabled ?? true,
            inAppEnabled: notifPref?.inAppEnabled ?? true,
            soundEnabled: notifPref?.soundEnabled ?? true,
          },
          app: {
            language: settings?.language ?? "vi",
            theme: settings?.theme ?? "system",
            maxQueueSize: 500, // Default — not stored in DB
          },
        },
      });
    } catch (error: any) {
      console.error("[External] user preferences GET error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get user preferences" });
    }
  });

  app.put("/api/external/user/preferences", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });

      // validateExternalAuth sets req.externalUser for Bearer (JWT) callers.
      // Prefer it so authenticated external users resolve a userId (master-key
      // server-to-server auth has no user context and still 401s below).
      const userId = (req as any).externalUser?.id || (req as any).userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "User context required. Please authenticate with JWT." });
      }

      const { notifications, app: appPrefs } = req.body || {};
      const { userNotificationPreferences, userSettings } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      // Upsert notification preferences
      if (notifications) {
        const existing = await database.select({ id: userNotificationPreferences.id }).from(userNotificationPreferences)
          .where(eqOp(userNotificationPreferences.userId, userId)).limit(1);

        const notifData: Record<string, any> = { updatedAt: new Date() };
        if (notifications.quietHoursEnabled !== undefined) notifData.quietHoursEnabled = notifications.quietHoursEnabled;
        if (notifications.quietHoursStart) notifData.quietHoursStart = notifications.quietHoursStart;
        if (notifications.quietHoursEnd) notifData.quietHoursEnd = notifications.quietHoursEnd;
        if (notifications.emailEnabled !== undefined) notifData.emailEnabled = notifications.emailEnabled;
        if (notifications.pushEnabled !== undefined) notifData.pushEnabled = notifications.pushEnabled;
        if (notifications.inAppEnabled !== undefined) notifData.inAppEnabled = notifications.inAppEnabled;
        if (notifications.soundEnabled !== undefined) notifData.soundEnabled = notifications.soundEnabled;

        if (existing.length > 0) {
          await database.update(userNotificationPreferences).set(notifData).where(eqOp(userNotificationPreferences.userId, userId));
        } else {
          await database.insert(userNotificationPreferences).values({ userId, ...notifData });
        }
      }

      // Upsert user settings
      if (appPrefs) {
        const existing = await database.select({ id: userSettings.id }).from(userSettings)
          .where(eqOp(userSettings.userId, userId)).limit(1);

        const settingsData: Record<string, any> = { updatedAt: new Date() };
        if (appPrefs.language) settingsData.language = appPrefs.language;
        if (appPrefs.theme) settingsData.theme = appPrefs.theme;

        if (existing.length > 0) {
          await database.update(userSettings).set(settingsData).where(eqOp(userSettings.userId, userId));
        } else {
          await database.insert(userSettings).values({ userId, ...settingsData });
        }
      }

      // Return updated preferences
      const [notifPref] = await database.select().from(userNotificationPreferences).where(eqOp(userNotificationPreferences.userId, userId)).limit(1);
      const [settings] = await database.select().from(userSettings).where(eqOp(userSettings.userId, userId)).limit(1);

      res.json({
        success: true,
        data: {
          notifications: {
            severityFilter: [],
            quietHoursEnabled: notifPref?.quietHoursEnabled ?? false,
            quietHoursStart: notifPref?.quietHoursStart ?? "22:00",
            quietHoursEnd: notifPref?.quietHoursEnd ?? "07:00",
            stationFilters: [],
            emailEnabled: notifPref?.emailEnabled ?? true,
            pushEnabled: notifPref?.pushEnabled ?? true,
            inAppEnabled: notifPref?.inAppEnabled ?? true,
            soundEnabled: notifPref?.soundEnabled ?? true,
          },
          app: {
            language: settings?.language ?? "vi",
            theme: settings?.theme ?? "system",
            maxQueueSize: 500,
          },
        },
      });
    } catch (error: any) {
      console.error("[External] user preferences PUT error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to update user preferences" });
    }
  });

  // ============================================================
  // Station REST proxy — for third-party (non-tRPC) clients
  // GET /api/external/stations            — List all stations
  // GET /api/external/stations/resolve-topic — Resolve MQTT topic → station info
  // GET /api/external/stations/:id        — Get station by ID
  // GET /api/external/stations/:id/products — Products mapped to a station
  // GET /api/external/stations/:id/inspection-points — Get inspection points for station
  // GET /api/external/stations/:id/reference-image   — Get station reference image
  // ============================================================

  app.get("/api/external/stations", validateExternalAuth, async (req, res) => {
    try {
      const { getStations } = await import("../db");
      const stations = await getStations();
      res.json({ success: true, data: stations });
    } catch (error: any) {
      console.error("[External] stations list error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get stations" });
    }
  });

  // GET /api/external/stations/resolve-topic?topic=avi/{fId}/workshop/{wId}/station/{sId}/errors
  // Parse MQTT topic string → return station info with full hierarchy
  // NOTE: Must be registered BEFORE /stations/:id to avoid "resolve-topic" matching as :id
  app.get("/api/external/stations/resolve-topic", validateExternalAuth, async (req, res) => {
    try {
      const topic = req.query.topic as string;
      if (!topic) {
        return res.status(400).json({ success: false, message: "Query param 'topic' is required (e.g. avi/1/workshop/2/station/3/errors)" });
      }

      // Pattern: avi/[factory/]{factoryId}/workshop/{workshopId}/station/{stationId}[/messageType]
      // Accept both legacy "avi/{fId}/..." and new "avi/factory/{fId}/..." formats
      // Also strip trailing MQTT wildcards (#, +) before matching
      const cleanedTopic = topic.replace(/\/[#+]$/, '');
      const match = cleanedTopic.match(/^avi\/(?:factory\/)?(\d+)\/workshop\/(\d+)\/station\/(\d+)(?:\/(.+))?$/);
      if (!match) {
        return res.status(400).json({
          success: false,
          message: "Invalid MQTT topic format. Expected: avi/{factoryId}/workshop/{workshopId}/station/{stationId}[/{messageType}]",
        });
      }

      const factoryId = parseInt(match[1], 10);
      const workshopId = parseInt(match[2], 10);
      const stationId = parseInt(match[3], 10);
      const messageType = match[4] || null;

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { stations, productionLines, workshops, factories } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      // Get station with full hierarchy in a single query
      const rows = await database
        .select({
          stationId: stations.id,
          stationCode: stations.code,
          stationName: stations.name,
          stationDescription: stations.description,
          lineId: productionLines.id,
          lineCode: productionLines.code,
          lineName: productionLines.name,
          workshopId: workshops.id,
          workshopCode: workshops.code,
          workshopName: workshops.name,
          factoryId: factories.id,
          factoryCode: factories.code,
          factoryName: factories.name,
        })
        .from(stations)
        .innerJoin(productionLines, eqOp(stations.lineId, productionLines.id))
        .innerJoin(workshops, eqOp(productionLines.workshopId, workshops.id))
        .innerJoin(factories, eqOp(workshops.factoryId, factories.id))
        .where(eqOp(stations.id, stationId))
        .limit(1);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: `Station ${stationId} not found` });
      }

      const row = rows[0];

      // Validate topic hierarchy matches DB
      if (row.factoryId !== factoryId || row.workshopId !== workshopId) {
        return res.status(400).json({
          success: false,
          message: "Topic hierarchy mismatch: factoryId or workshopId in topic does not match station's actual hierarchy",
          expected: { factoryId: row.factoryId, workshopId: row.workshopId },
          provided: { factoryId, workshopId },
        });
      }

      res.json({
        success: true,
        data: {
          station: { id: row.stationId, code: row.stationCode, name: row.stationName, description: row.stationDescription },
          line: { id: row.lineId, code: row.lineCode, name: row.lineName },
          workshop: { id: row.workshopId, code: row.workshopCode, name: row.workshopName },
          factory: { id: row.factoryId, code: row.factoryCode, name: row.factoryName },
          mqttTopic: topic,
          messageType,
        },
      });
    } catch (error: any) {
      console.error("[External] station resolve-topic error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to resolve MQTT topic" });
    }
  });

  app.get("/api/external/stations/:id", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { stations } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const rows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (rows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      res.json({ success: true, data: rows[0] });
    } catch (error: any) {
      console.error("[External] station detail error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get station" });
    }
  });

  app.get("/api/external/stations/:id/inspection-points", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      // Optional productModelId filter
      const productModelIdParam = req.query.productModelId as string | undefined;
      const filterProductModelId = productModelIdParam ? parseInt(productModelIdParam, 10) : null;
      if (productModelIdParam && (isNaN(filterProductModelId!) || filterProductModelId! <= 0)) {
        return res.status(400).json({ success: false, message: "Invalid productModelId" });
      }

      const { getMachinesByStation } = await import("../db");
      const { getMeasurementPointDefsByMachine, getMeasurementPointDefsByWorkstation } = await import("../db");

      // Verify station exists
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { stations } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machines for station, then get measurement point defs for each
      const stationMachines = await getMachinesByStation(stationId);
      const activeMachines = stationMachines.filter((m: any) => m.isActive);

      const allPoints: any[] = [];
      const seenPointIds = new Set<number>();
      for (const machine of activeMachines) {
        const points = await getMeasurementPointDefsByMachine(machine.id);
        for (const p of points) {
          if (seenPointIds.has(p.id)) continue;
          seenPointIds.add(p.id);
          allPoints.push({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            measurementType: p.measurementType,
            unit: p.unit,
            lowerLimit: p.lowerLimit != null ? Number(p.lowerLimit) : null,
            upperLimit: p.upperLimit != null ? Number(p.upperLimit) : null,
            nominalValue: p.nominalValue != null ? Number(p.nominalValue) : null,
            positionX: p.positionX,
            positionY: p.positionY,
            radius: p.radius,
            normalizedX: p.normalizedX != null ? Number(p.normalizedX) : null,
            normalizedY: p.normalizedY != null ? Number(p.normalizedY) : null,
            normalizedRadius: p.normalizedRadius != null ? Number(p.normalizedRadius) : null,
            cropWidth: p.cropWidth,
            cropHeight: p.cropHeight,
            referenceImageUrl: p.referenceImageUrl,
            workstationId: p.workstationId ?? null,
            productModelId: p.productModelId,
            imageWidth: null as number | null,
            imageHeight: null as number | null,
            imageDisplayMode: "contain" as string,
            machineId: machine.id,
            machineCode: machine.code,
            machineName: machine.name,
          });
        }
      }

      // Also get measurement point defs linked directly via workstationId (not through machine)
      const workstationPoints = await getMeasurementPointDefsByWorkstation(stationId);
      for (const p of workstationPoints) {
        if (seenPointIds.has(p.id)) continue;
        seenPointIds.add(p.id);
        // Find the machine for this point (if any) for display purposes
        const linkedMachine = activeMachines.find((m: any) => m.id === p.machineId);
        allPoints.push({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description,
          measurementType: p.measurementType,
          unit: p.unit,
          lowerLimit: p.lowerLimit != null ? Number(p.lowerLimit) : null,
          upperLimit: p.upperLimit != null ? Number(p.upperLimit) : null,
          nominalValue: p.nominalValue != null ? Number(p.nominalValue) : null,
          positionX: p.positionX,
          positionY: p.positionY,
          radius: p.radius,
          normalizedX: p.normalizedX != null ? Number(p.normalizedX) : null,
          normalizedY: p.normalizedY != null ? Number(p.normalizedY) : null,
          normalizedRadius: p.normalizedRadius != null ? Number(p.normalizedRadius) : null,
          cropWidth: p.cropWidth,
          cropHeight: p.cropHeight,
          referenceImageUrl: p.referenceImageUrl,
          workstationId: p.workstationId ?? null,
          productModelId: p.productModelId,
          imageWidth: null as number | null,
          imageHeight: null as number | null,
          imageDisplayMode: "contain" as string,
          machineId: linkedMachine?.id ?? null,
          machineCode: linkedMachine?.code ?? null,
          machineName: linkedMachine?.name ?? null,
        });
      }

      // Filter by productModelId if specified
      const pointsToReturn = filterProductModelId
        ? allPoints.filter(p => p.productModelId === filterProductModelId)
        : allPoints;

      // Batch-fetch product model image dimensions for scaling
      const uniqueModelIds = [...new Set(pointsToReturn.map(p => p.productModelId).filter(Boolean))] as number[];
      if (uniqueModelIds.length > 0) {
        const { productModels } = await import("../../drizzle/schema");
        const { inArray } = await import("drizzle-orm");
        const models = await database.select({
          id: productModels.id,
          imageWidth: productModels.imageWidth,
          imageHeight: productModels.imageHeight,
          imageDisplayMode: productModels.imageDisplayMode,
        }).from(productModels).where(inArray(productModels.id, uniqueModelIds));
        const modelMap = new Map(models.map(m => [m.id, { imageWidth: m.imageWidth, imageHeight: m.imageHeight, imageDisplayMode: m.imageDisplayMode }]));
        for (const p of pointsToReturn) {
          const model = modelMap.get(p.productModelId);
          if (model) {
            p.imageWidth = model.imageWidth;
            p.imageHeight = model.imageHeight;
            p.imageDisplayMode = model.imageDisplayMode || "contain";
          }
        }
      }

      res.json({ success: true, data: pointsToReturn, total: pointsToReturn.length });
    } catch (error: any) {
      console.error("[External] station inspection-points error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get inspection points" });
    }
  });

  // GET /api/external/stations/:id/products — Products mapped to a station (via its machines)
  app.get("/api/external/stations/:id/products", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { stations, machines, productMachineMappings, productModels } = await import("../../drizzle/schema");
      const { eq: eqOp, and: andOp, desc: descOp } = await import("drizzle-orm");

      // Verify station exists
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get products mapped to all machines of this station
      const rows = await database
        .select({
          productId: productModels.id,
          productCode: productModels.code,
          productName: productModels.name,
          description: productModels.description,
          category: productModels.category,
          lifecycleStatus: productModels.lifecycleStatus,
          referenceImageUrl: productModels.referenceImageUrl,
          imageWidth: productModels.imageWidth,
          imageHeight: productModels.imageHeight,
          targetYieldRate: productModels.targetYieldRate,
          minYieldRate: productModels.minYieldRate,
          machineId: machines.id,
          machineCode: machines.code,
          machineName: machines.name,
          mappingPriority: productMachineMappings.priority,
        })
        .from(productMachineMappings)
        .innerJoin(productModels, eqOp(productMachineMappings.productModelId, productModels.id))
        .innerJoin(machines, eqOp(productMachineMappings.machineId, machines.id))
        .where(andOp(
          eqOp(machines.stationId, stationId),
          eqOp(productModels.isActive, true),
        ))
        .orderBy(descOp(productMachineMappings.priority));

      // Group by product to avoid duplicates (same product via different machines)
      const productMap = new Map<number, any>();
      for (const r of rows) {
        if (!productMap.has(r.productId)) {
          productMap.set(r.productId, {
            id: r.productId,
            code: r.productCode,
            name: r.productName,
            description: r.description,
            category: r.category,
            lifecycleStatus: r.lifecycleStatus,
            hasReferenceImage: !!r.referenceImageUrl,
            imageWidth: r.imageWidth ? Number(r.imageWidth) : null,
            imageHeight: r.imageHeight ? Number(r.imageHeight) : null,
            targetYieldRate: r.targetYieldRate != null ? Number(r.targetYieldRate) : null,
            minYieldRate: r.minYieldRate != null ? Number(r.minYieldRate) : null,
            machines: [],
          });
        }
        productMap.get(r.productId).machines.push({
          id: r.machineId,
          code: r.machineCode,
          name: r.machineName,
          priority: r.mappingPriority ?? 0,
        });
      }

      const products = Array.from(productMap.values());
      res.json({
        success: true,
        data: {
          station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
          products,
          total: products.length,
        },
      });
    } catch (error: any) {
      console.error("[External] station products error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get station products" });
    }
  });

  app.get("/api/external/stations/:id/reference-image", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      // Find the latest product model assigned to this station's machine, then get its image
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { machines, stations } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      // Get station to verify it exists
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machines assigned to this station
      const machineRows = await database.select().from(machines).where(eqOp(machines.stationId, stationId));
      if (machineRows.length === 0) {
        return res.json({ success: true, data: { stationId, referenceImage: null, message: "No machine assigned to this station" } });
      }

      // Use tRPC to get the product image via the machine's current product
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      try {
        const machine = machineRows[0];
        const products = await caller.publicProductApi.listProducts({
          machineCode: machine.code,
          limit: 1,
        });
        if (products?.data?.length > 0) {
          const product = products.data[0];
          const image = await caller.publicProductApi.getProductImage({
            machineCode: machine.code,
            productCode: product.code,
          });
          return res.json({ success: true, data: { stationId, referenceImage: image } });
        }
      } catch {
        // fallback: no image
      }
      res.json({ success: true, data: { stationId, referenceImage: null, message: "No reference image available" } });
    } catch (error: any) {
      console.error("[External] station reference-image error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get reference image" });
    }
  });

  // ============================================================
  // Server Time — allows clients to calculate clock offset
  // ============================================================
  app.get("/api/external/server-time", (_req, res) => {
    res.json({ success: true, serverTime: new Date().toISOString() });
  });

  // G4 — OpenAPI 3.0 spec cho REST external (public, chỉ mô tả hợp đồng).
  app.get("/api/external/openapi.json", async (req, res) => {
    try {
      const { buildExternalOpenApiSpec } = await import("../openapi/externalApiSpec");
      const proto = (req.header("x-forwarded-proto") || req.protocol || "http").split(",")[0];
      const host = req.header("x-forwarded-host") || req.get("host") || "";
      const serverUrl = host ? `${proto}://${host}` : "/";
      res.json(buildExternalOpenApiSpec(serverUrl));
    } catch (err) {
      console.error("[OpenAPI] spec build failed:", err);
      res.status(500).json({ success: false, message: "Failed to build OpenAPI spec" });
    }
  });


  // ============================================================
  // Station Statistics APIs — per-station KPIs, measurement point stats, fail history
  // ============================================================

  // A7. GET /api/external/stations/:id/statistics — Station KPI summary
  app.get("/api/external/stations/:id/statistics", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      // Optional productModelId / productCode filter
      const productModelIdParam = req.query.productModelId as string | undefined;
      let filterProductModelId = productModelIdParam ? parseInt(productModelIdParam, 10) : null;
      if (productModelIdParam && (isNaN(filterProductModelId!) || filterProductModelId! <= 0)) {
        return res.status(400).json({ success: false, message: "Invalid productModelId" });
      }
      const productCodeFilter = (req.query.productCode as string) || null;

      const startDateStr = req.query.startDate as string | undefined;
      const endDateStr = req.query.endDate as string | undefined;
      if (!startDateStr || !endDateStr) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }
      const startDate = parseLocalDate(startDateStr);
      const endDate = parseLocalDate(endDateStr, true);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { machines, stations, productionLines, workshops, factories, productInspections, productModels } = await import("../../drizzle/schema");
      const { eq: eqOp, and: andOp, inArray, gte, lte, sql: sqlOp } = await import("drizzle-orm");

      // Resolve productModelId from productCode if not provided directly
      if (!filterProductModelId && productCodeFilter) {
        const pmByCode = await database.select({ id: productModels.id })
          .from(productModels).where(eqOp(productModels.code, productCodeFilter)).limit(1);
        if (pmByCode.length > 0) filterProductModelId = pmByCode[0].id;
      }

      // Verify station exists with hierarchy
      const stationRows = await database.select({
        station: stations,
        line: productionLines,
        workshop: workshops,
        factory: factories,
      })
        .from(stations)
        .innerJoin(productionLines, eqOp(stations.lineId, productionLines.id))
        .innerJoin(workshops, eqOp(productionLines.workshopId, workshops.id))
        .innerJoin(factories, eqOp(workshops.factoryId, factories.id))
        .where(eqOp(stations.id, stationId))
        .limit(1);

      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });
      const row = stationRows[0];

      // Get machine IDs for this station
      const machineRows = await database.select({ id: machines.id }).from(machines).where(eqOp(machines.stationId, stationId));
      const machineIds = machineRows.map((r: any) => r.id);

      if (machineIds.length === 0) {
        return res.json({
          success: true,
          data: {
            station: { id: row.station.id, code: row.station.code, name: row.station.name },
            factory: { id: row.factory.id, code: row.factory.code, name: row.factory.name },
            workshop: { id: row.workshop.id, code: row.workshop.code, name: row.workshop.name },
            line: { id: row.line.id, code: row.line.code, name: row.line.name },
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            machineCount: 0,
            totalInspections: 0, okCount: 0, ngCount: 0, ntfCount: 0,
            firstPassYield: 0, finalYield: 0, retestRate: 0, yieldChange: 0,
          },
        });
      }

      // Current period stats
      // Use raw SQL with ::timestamp to avoid pg driver local-time serialization bug
      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      const statsConditions = [
        inArray(productInspections.machineId, machineIds),
        sqlOp`${productInspections.inspectionTime} >= ${startStr}::timestamp`,
        sqlOp`${productInspections.inspectionTime} <= ${endStr}::timestamp`,
      ];
      if (filterProductModelId) {
        statsConditions.push(eqOp(productInspections.productModelId, filterProductModelId));
      }
      const stats = await database.select({
        total: sqlOp<number>`count(*)`,
        ok: sqlOp<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sqlOp<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
        ntf: sqlOp<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
      }).from(productInspections).where(andOp(...statsConditions));

      const t = Number(stats[0]?.total) || 0;
      const ok = Number(stats[0]?.ok) || 0;
      const ng = Number(stats[0]?.ng) || 0;
      const ntf = Number(stats[0]?.ntf) || 0;

      const fpy = t > 0 ? Math.round((ok / t) * 10000) / 100 : 0;
      const fy = t > 0 ? Math.round(((ok + ntf) / t) * 10000) / 100 : 0;
      const retest = t > 0 ? Math.round((ntf / t) * 10000) / 100 : 0;

      // Previous period yield change
      const duration = endDate.getTime() - startDate.getTime();
      const prevEnd = new Date(startDate.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - duration);
      const prevStartStr = prevStart.toISOString();
      const prevEndStr = prevEnd.toISOString();
      const prevConditions = [
        inArray(productInspections.machineId, machineIds),
        sqlOp`${productInspections.inspectionTime} >= ${prevStartStr}::timestamp`,
        sqlOp`${productInspections.inspectionTime} <= ${prevEndStr}::timestamp`,
      ];
      if (filterProductModelId) {
        prevConditions.push(eqOp(productInspections.productModelId, filterProductModelId));
      }
      const prev = await database.select({
        total: sqlOp<number>`count(*)`,
        ok: sqlOp<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
      }).from(productInspections).where(andOp(...prevConditions));

      const pt = Number(prev[0]?.total) || 0;
      const po = Number(prev[0]?.ok) || 0;
      const prevFPY = pt > 0 ? (po / pt) * 100 : 0;
      const yieldChange = Math.round((fpy - prevFPY) * 100) / 100;

      res.json({
        success: true,
        data: {
          station: { id: row.station.id, code: row.station.code, name: row.station.name },
          factory: { id: row.factory.id, code: row.factory.code, name: row.factory.name },
          workshop: { id: row.workshop.id, code: row.workshop.code, name: row.workshop.name },
          line: { id: row.line.id, code: row.line.code, name: row.line.name },
          dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
          machineCount: machineIds.length,
          totalInspections: t,
          okCount: ok,
          ngCount: ng,
          ntfCount: ntf,
          firstPassYield: fpy,
          finalYield: fy,
          retestRate: retest,
          yieldChange,
        },
      });
    } catch (error: any) {
      console.error("[External] station statistics error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get station statistics" });
    }
  });

  // A8. GET /api/external/stations/:id/measurement-stats — Per-measurement-point stats
  app.get("/api/external/stations/:id/measurement-stats", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      const startDateStr = req.query.startDate as string | undefined;
      const endDateStr = req.query.endDate as string | undefined;
      if (!startDateStr || !endDateStr) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }
      const startDate = parseLocalDate(startDateStr);
      const endDate = parseLocalDate(endDateStr, true);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const groupBy = (req.query.groupBy as string) || "none"; // none | hour | day | week
      if (!["none", "hour", "day", "week"].includes(groupBy)) {
        return res.status(400).json({ success: false, message: "groupBy must be one of: none, hour, day, week" });
      }

      // Optional: filter by productModelId or productCode
      const productModelIdParam = req.query.productModelId as string | undefined;
      const productCodeFilter = (req.query.productCode as string) || null;
      let filterProductModelId = productModelIdParam ? parseInt(productModelIdParam, 10) : null;
      if (productModelIdParam && (isNaN(filterProductModelId!) || filterProductModelId! <= 0)) {
        return res.status(400).json({ success: false, message: "Invalid productModelId" });
      }

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { machines, stations, productModels } = await import("../../drizzle/schema");
      const { eq: eqOp, sql: sqlOp } = await import("drizzle-orm");

      // Resolve productCode to productModelId if needed
      if (!filterProductModelId && productCodeFilter) {
        const pmRows = await database.select({ id: productModels.id }).from(productModels).where(eqOp(productModels.code, productCodeFilter)).limit(1);
        if (pmRows.length > 0) filterProductModelId = pmRows[0].id;
      }

      // Verify station exists
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machine IDs
      const machineRows = await database.select({ id: machines.id }).from(machines).where(eqOp(machines.stationId, stationId));
      const machineIds = machineRows.map((r: any) => r.id);

      if (machineIds.length === 0) {
        return res.json({ success: true, data: { dateRange: { startDate: startDateStr, endDate: endDateStr }, points: [] } });
      }

      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      const machineIdList = machineIds.join(",");

      const productFilter = filterProductModelId ? sqlOp`AND mpd."productModelId" = ${filterProductModelId}` : sqlOp``;

      if (groupBy === "none") {
        // Aggregated stats per measurement point (no time breakdown)
        const result = await database.execute(sqlOp`
          SELECT
            mpd.id AS "pointDefId",
            mpd.code AS "pointCode",
            mpd.name AS "pointName",
            mpd."measurementType",
            mpd."workstationId",
            mpd."productModelId",
            pm.code AS "productCode",
            pm.name AS "productName",
            COUNT(mr.id) AS "totalChecks",
            SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END) AS "okCount",
            SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) AS "ngCount",
            SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END) AS "ntfCount",
            COALESCE(ROUND(
              SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0
              / NULLIF(COUNT(mr.id), 0), 2
            ), 0) AS "ngRate",
            COALESCE(AVG(mr."measuredValue"::numeric), 0) AS "avgValue",
            COALESCE(MIN(mr."measuredValue"::numeric), 0) AS "minValue",
            COALESCE(MAX(mr."measuredValue"::numeric), 0) AS "maxValue",
            (SELECT COUNT(mr2.id) FROM measurement_results mr2
              INNER JOIN product_inspections pi2 ON mr2."inspectionId" = pi2.id
              WHERE mr2."pointDefId" = mpd.id
                AND mr2.result = 'NG'
                AND mr2."imageUrl" IS NOT NULL AND mr2."imageUrl" != ''
                AND pi2."machineId" = ANY(ARRAY[${sqlOp.raw(machineIdList)}])
                AND pi2."inspectionTime" >= ${startStr}::timestamp
                AND pi2."inspectionTime" <= ${endStr}::timestamp
            ) AS "ngImageCount"
          FROM measurement_results mr
          INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
          INNER JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
          LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
          WHERE pi."machineId" = ANY(ARRAY[${sqlOp.raw(machineIdList)}])
            AND pi."inspectionTime" >= ${startStr}::timestamp
            AND pi."inspectionTime" <= ${endStr}::timestamp
            ${productFilter}
          GROUP BY mpd.id, mpd.code, mpd.name, mpd."measurementType", mpd."workstationId",
                   mpd."productModelId", pm.code, pm.name
          ORDER BY COUNT(mr.id) DESC
        `);

        const rows = (result as any).rows || (result as any);
        const points = (rows as any[]).map((r: any) => ({
          pointDefId: Number(r.pointDefId),
          pointCode: r.pointCode || "",
          pointName: r.pointName || "",
          measurementType: r.measurementType || "OTHER",
          workstationId: r.workstationId != null ? Number(r.workstationId) : null,
          productModelId: r.productModelId != null ? Number(r.productModelId) : null,
          productCode: r.productCode || null,
          productName: r.productName || null,
          totalChecks: Number(r.totalChecks),
          okCount: Number(r.okCount),
          ngCount: Number(r.ngCount),
          ntfCount: Number(r.ntfCount),
          ngRate: Number(r.ngRate),
          avgValue: r.avgValue != null ? Number(Number(r.avgValue).toFixed(6)) : null,
          minValue: r.minValue != null ? Number(Number(r.minValue).toFixed(6)) : null,
          maxValue: r.maxValue != null ? Number(Number(r.maxValue).toFixed(6)) : null,
          ngImageCount: Number(r.ngImageCount || 0),
        }));

        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startStr, endDate: endStr },
            station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
            points,
          },
        });
      }

      // Time-series stats per measurement point (groupBy = hour | day | week)
      const dateTrunc = groupBy === "hour" ? "hour" : groupBy === "week" ? "week" : "day";

      const dateTruncLiteral = sqlOp.raw(`'${dateTrunc}'`);
      const result = await database.execute(sqlOp`
        SELECT
          mpd.id AS "pointDefId",
          mpd.code AS "pointCode",
          mpd.name AS "pointName",
          mpd."measurementType",
          mpd."workstationId",
          mpd."productModelId",
          pm.code AS "productCode",
          pm.name AS "productName",
          date_trunc(${dateTruncLiteral}, pi."inspectionTime") AS "period",
          COUNT(mr.id) AS "totalChecks",
          SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END) AS "okCount",
          SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) AS "ngCount",
          COALESCE(ROUND(
            SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(mr.id), 0), 2
          ), 0) AS "ngRate",
          COALESCE(AVG(mr."measuredValue"::numeric), 0) AS "avgValue"
        FROM measurement_results mr
        INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
        INNER JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
        LEFT JOIN product_models pm ON mpd."productModelId" = pm.id
        WHERE pi."machineId" = ANY(ARRAY[${sqlOp.raw(machineIdList)}])
          AND pi."inspectionTime" >= ${startStr}::timestamp
          AND pi."inspectionTime" <= ${endStr}::timestamp
          ${productFilter}
        GROUP BY mpd.id, mpd.code, mpd.name, mpd."measurementType", mpd."workstationId",
                 mpd."productModelId", pm.code, pm.name,
                 date_trunc(${dateTruncLiteral}, pi."inspectionTime")
        ORDER BY mpd.code, "period"
      `);

      const rows = (result as any).rows || (result as any);

      // Group by pointDefId → { point info, trend: [...] }
      const pointMap = new Map<number, any>();
      for (const r of rows as any[]) {
        const pid = Number(r.pointDefId);
        if (!pointMap.has(pid)) {
          pointMap.set(pid, {
            pointDefId: pid,
            pointCode: r.pointCode || "",
            pointName: r.pointName || "",
            measurementType: r.measurementType || "OTHER",
            workstationId: r.workstationId != null ? Number(r.workstationId) : null,
            productModelId: r.productModelId != null ? Number(r.productModelId) : null,
            productCode: r.productCode || null,
            productName: r.productName || null,
            trend: [],
          });
        }
        pointMap.get(pid).trend.push({
          period: r.period,
          totalChecks: Number(r.totalChecks),
          okCount: Number(r.okCount),
          ngCount: Number(r.ngCount),
          ngRate: Number(r.ngRate),
          avgValue: r.avgValue != null ? Number(Number(r.avgValue).toFixed(6)) : null,
        });
      }

      res.json({
        success: true,
        data: {
          groupBy,
          dateRange: { startDate: startStr, endDate: endStr },
          station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
          points: Array.from(pointMap.values()),
        },
      });
    } catch (error: any) {
      console.error("[External] station measurement-stats error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get measurement stats" });
    }
  });

  // A9. GET /api/external/stations/:id/fail-history — Recent NG inspections with failed point details
  app.get("/api/external/stations/:id/fail-history", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      // Optional productModelId or productCode filter
      const productModelIdParam = req.query.productModelId as string | undefined;
      const productCodeFilter = (req.query.productCode as string) || null;
      let filterProductModelId = productModelIdParam ? parseInt(productModelIdParam, 10) : null;
      if (productModelIdParam && (isNaN(filterProductModelId!) || filterProductModelId! <= 0)) {
        return res.status(400).json({ success: false, message: "Invalid productModelId" });
      }

      const startDateStr = req.query.startDate as string | undefined;
      const endDateStr = req.query.endDate as string | undefined;
      if (!startDateStr || !endDateStr) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }
      const startDate = parseLocalDate(startDateStr);
      const endDate = parseLocalDate(endDateStr, true);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const limitParam = parseInt(req.query.limit as string, 10);
      const limit = isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 200);
      const offsetParam = parseInt(req.query.offset as string, 10);
      const offset = isNaN(offsetParam) ? 0 : Math.max(offsetParam, 0);

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { machines, stations, productInspections, measurementResults, measurementPointDefs, productModels } = await import("../../drizzle/schema");
      const { eq: eqOp, and: andOp, inArray, gte, lte, desc: descOp } = await import("drizzle-orm");

      // Resolve productCode to productModelId if needed
      if (!filterProductModelId && productCodeFilter) {
        const pmRows = await database.select({ id: productModels.id }).from(productModels).where(eqOp(productModels.code, productCodeFilter)).limit(1);
        if (pmRows.length > 0) filterProductModelId = pmRows[0].id;
      }

      // Verify station exists
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machine IDs
      const machineRows = await database.select({ id: machines.id }).from(machines).where(eqOp(machines.stationId, stationId));
      const machineIds = machineRows.map((r: any) => r.id);

      if (machineIds.length === 0) {
        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            pagination: { total: 0, limit, offset, hasMore: false },
            inspections: [],
          },
        });
      }

      // Count total NG inspections
      const { sql: sqlOp } = await import("drizzle-orm");
      const failStartStr = startDate.toISOString();
      const failEndStr = endDate.toISOString();
      const failConditions = [
        inArray(productInspections.machineId, machineIds),
        eqOp(productInspections.overallResult, "NG"),
        sqlOp`${productInspections.inspectionTime} >= ${failStartStr}::timestamp`,
        sqlOp`${productInspections.inspectionTime} <= ${failEndStr}::timestamp`,
      ];
      if (filterProductModelId) {
        failConditions.push(eqOp(productInspections.productModelId, filterProductModelId));
      }
      const countResult = await database.select({
        total: sqlOp<number>`count(*)`,
      }).from(productInspections).where(andOp(...failConditions));
      const total = Number(countResult[0]?.total) || 0;

      // Get NG inspections with pagination
      const inspections = await database.select({
        id: productInspections.id,
        serialNumber: productInspections.serialNumber,
        inspectionTime: productInspections.inspectionTime,
        overallResult: productInspections.overallResult,
        machineId: productInspections.machineId,
        machineCode: machines.code,
        machineName: machines.name,
        productModelId: productInspections.productModelId,
      })
        .from(productInspections)
        .innerJoin(machines, eqOp(productInspections.machineId, machines.id))
        .where(andOp(...failConditions))
        .orderBy(descOp(productInspections.inspectionTime))
        .limit(limit)
        .offset(offset);

      if (inspections.length === 0) {
        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            pagination: { total, limit, offset, hasMore: false },
            inspections: [],
          },
        });
      }

      // Get failed measurement points for these inspections
      const inspIds = inspections.map(i => i.id);
      const measResults = await database.select({
        inspectionId: measurementResults.inspectionId,
        pointDefId: measurementResults.pointDefId,
        result: measurementResults.result,
        measuredValue: measurementResults.measuredValue,
        imageUrl: measurementResults.imageUrl,
        pointCode: measurementPointDefs.code,
        pointName: measurementPointDefs.name,
        workstationId: measurementPointDefs.workstationId,
        positionX: measurementPointDefs.positionX,
        positionY: measurementPointDefs.positionY,
        radius: measurementPointDefs.radius,
        normalizedX: measurementPointDefs.normalizedX,
        normalizedY: measurementPointDefs.normalizedY,
        normalizedRadius: measurementPointDefs.normalizedRadius,
      })
        .from(measurementResults)
        .innerJoin(measurementPointDefs, eqOp(measurementResults.pointDefId, measurementPointDefs.id))
        .where(andOp(
          inArray(measurementResults.inspectionId, inspIds),
          eqOp(measurementResults.result, "NG"),
        ));

      const measMap = new Map<number, any[]>();
      for (const m of measResults) {
        const arr = measMap.get(m.inspectionId) || [];
        arr.push({
          pointDefId: m.pointDefId,
          pointCode: m.pointCode || "",
          pointName: m.pointName || "",
          measuredValue: m.measuredValue,
          imageUrl: m.imageUrl || null,
          workstationId: m.workstationId ?? null,
          positionX: m.positionX,
          positionY: m.positionY,
          radius: m.radius,
          normalizedX: m.normalizedX != null ? Number(m.normalizedX) : null,
          normalizedY: m.normalizedY != null ? Number(m.normalizedY) : null,
          normalizedRadius: m.normalizedRadius != null ? Number(m.normalizedRadius) : null,
        });
        measMap.set(m.inspectionId, arr);
      }

      // Batch-fetch product model image dimensions for scaling
      const uniquePmIds = [...new Set(inspections.map(i => i.productModelId).filter(Boolean))] as number[];
      const pmDimMap = new Map<number, { imageWidth: number | null; imageHeight: number | null; imageDisplayMode: string }>();
      if (uniquePmIds.length > 0) {
        const pmDims = await database.select({
          id: productModels.id,
          imageWidth: productModels.imageWidth,
          imageHeight: productModels.imageHeight,
          imageDisplayMode: productModels.imageDisplayMode,
        }).from(productModels).where(inArray(productModels.id, uniquePmIds));
        for (const pm of pmDims) {
          pmDimMap.set(pm.id, { imageWidth: pm.imageWidth, imageHeight: pm.imageHeight, imageDisplayMode: pm.imageDisplayMode || "contain" });
        }
      }

      const data = inspections.map(insp => {
        const pmDim = insp.productModelId ? pmDimMap.get(insp.productModelId) : null;
        return {
          inspectionId: insp.id,
          serialNumber: insp.serialNumber || "",
          inspectionTime: insp.inspectionTime,
          machineId: insp.machineId,
          machineCode: insp.machineCode || "",
          machineName: insp.machineName || "",
          productModelId: insp.productModelId,
          imageWidth: pmDim?.imageWidth ?? null,
          imageHeight: pmDim?.imageHeight ?? null,
          imageDisplayMode: pmDim?.imageDisplayMode ?? "contain",
          failedPoints: measMap.get(insp.id) || [],
        };
      });

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
          pagination: { total, limit, offset, hasMore: offset + limit < total },
          inspections: data,
        },
      });
    } catch (error: any) {
      console.error("[External] station fail-history error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get fail history" });
    }
  });

  // A10. GET /api/external/stations/:id/point-detail — Per-point stats + NG images (like StationAnalysis Station Detail)
  app.get("/api/external/stations/:id/point-detail", validateExternalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) return res.status(400).json({ success: false, message: "Invalid station ID" });

      const startDateStr = req.query.startDate as string | undefined;
      const endDateStr = req.query.endDate as string | undefined;
      if (!startDateStr || !endDateStr) {
        return res.status(400).json({ success: false, message: "startDate and endDate are required (ISO 8601 format)" });
      }
      const startDate = parseLocalDate(startDateStr);
      const endDate = parseLocalDate(endDateStr, true);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ success: false, message: "startDate must be before endDate" });
      }

      const productModelIdParam = parseInt(req.query.productModelId as string, 10);
      const productModelIdFilter = isNaN(productModelIdParam) ? null : productModelIdParam;
      const productCodeFilter = (req.query.productCode as string) || null;
      const pointDefIdParam = parseInt(req.query.pointDefId as string, 10);
      const pointDefIdFilter = isNaN(pointDefIdParam) ? null : pointDefIdParam;
      const imageLimitParam = parseInt(req.query.imageLimit as string, 10);
      const imageLimit = isNaN(imageLimitParam) ? 10 : Math.min(Math.max(imageLimitParam, 1), 50);

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const {
        machines, stations, productInspections, measurementResults,
        measurementPointDefs, productModels,
      } = await import("../../drizzle/schema");
      const {
        eq: eqOp, and: andOp, inArray, gte, lte, desc: descOp,
        sql: sqlOp, asc: ascOp, isNotNull,
      } = await import("drizzle-orm");

      // Verify station
      const stationRows = await database.select().from(stations).where(eqOp(stations.id, stationId)).limit(1);
      if (stationRows.length === 0) return res.status(404).json({ success: false, message: "Station not found" });

      // Get machine IDs
      const machineRows = await database.select({ id: machines.id }).from(machines)
        .where(andOp(eqOp(machines.stationId, stationId), eqOp(machines.isActive, true)));
      const machineIds = machineRows.map((r: any) => r.id);

      if (machineIds.length === 0) {
        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
            productImage: null,
            boardInfo: null,
            points: [],
          },
        });
      }

      // Build inspection conditions — use raw SQL to avoid pg driver local-time serialization bug
      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      const inspConds: any[] = [
        inArray(productInspections.machineId, machineIds),
        sqlOp`${productInspections.inspectionTime} >= ${startStr}::timestamp`,
        sqlOp`${productInspections.inspectionTime} <= ${endStr}::timestamp`,
      ];

      // Resolve product model filter
      let resolvedProductModelId = productModelIdFilter;
      if (!resolvedProductModelId && productCodeFilter) {
        const pmByCode = await database.select({ id: productModels.id })
          .from(productModels).where(eqOp(productModels.code, productCodeFilter)).limit(1);
        if (pmByCode.length > 0) resolvedProductModelId = pmByCode[0].id;
      }

      if (resolvedProductModelId) {
        inspConds.push(eqOp(productInspections.productModelId, resolvedProductModelId));
      }

      // Determine the primary product model (most used in range, or the specified one)
      let primaryModelId = resolvedProductModelId;
      if (!primaryModelId) {
        const pmRows = await database.select({
          modelId: productInspections.productModelId,
          cnt: sqlOp<number>`count(*)`.as('cnt'),
        })
          .from(productInspections)
          .where(andOp(...inspConds))
          .groupBy(productInspections.productModelId)
          .orderBy(descOp(sqlOp`count(*)`))
          .limit(1);
        primaryModelId = pmRows.length > 0 ? pmRows[0].modelId : null;
      }

      // Fetch product model info (reference image)
      let productImage: { url: string | null; width: number | null; height: number | null; imageDisplayMode: string } | null = null;
      let boardInfo: { model: string; code: string } | null = null;
      if (primaryModelId) {
        const pm = await database.select({
          code: productModels.code, name: productModels.name,
          imageUrl: productModels.referenceImageUrl,
          imageWidth: productModels.imageWidth, imageHeight: productModels.imageHeight,
          imageDisplayMode: productModels.imageDisplayMode,
        }).from(productModels).where(eqOp(productModels.id, primaryModelId)).limit(1);
        if (pm.length > 0) {
          productImage = { url: pm[0].imageUrl, width: pm[0].imageWidth, height: pm[0].imageHeight, imageDisplayMode: pm[0].imageDisplayMode || "contain" };
          boardInfo = { model: pm[0].name, code: pm[0].code };
        }
      }

      // Fetch measurement point definitions by machineId
      const pointDefConds: any[] = [
        inArray(measurementPointDefs.machineId, machineIds),
        eqOp(measurementPointDefs.isActive, true),
      ];
      if (pointDefIdFilter) pointDefConds.push(eqOp(measurementPointDefs.id, pointDefIdFilter));

      let allPointDefs: any[] = await database.select().from(measurementPointDefs)
        .where(andOp(...pointDefConds)).orderBy(ascOp(measurementPointDefs.orderIndex));

      // Also fetch by workstationId = stationId (points linked to workstation, not machine)
      const wsConds: any[] = [
        eqOp(measurementPointDefs.workstationId, stationId),
        eqOp(measurementPointDefs.isActive, true),
      ];
      if (pointDefIdFilter) wsConds.push(eqOp(measurementPointDefs.id, pointDefIdFilter));
      const wsPointDefs = await database.select().from(measurementPointDefs)
        .where(andOp(...wsConds)).orderBy(ascOp(measurementPointDefs.orderIndex));

      // Merge machineId + workstationId points with dedup
      const seenPointIds = new Set(allPointDefs.map((p: any) => p.id));
      for (const wp of wsPointDefs) {
        if (!seenPointIds.has(wp.id)) {
          allPointDefs.push(wp);
          seenPointIds.add(wp.id);
        }
      }

      // Always merge product model points (not just fallback) to include points without machineId
      if (primaryModelId) {
        const pmConds: any[] = [
          eqOp(measurementPointDefs.productModelId, primaryModelId),
          eqOp(measurementPointDefs.isActive, true),
        ];
        if (pointDefIdFilter) pmConds.push(eqOp(measurementPointDefs.id, pointDefIdFilter));
        const pmPointDefs = await database.select().from(measurementPointDefs)
          .where(andOp(...pmConds)).orderBy(ascOp(measurementPointDefs.orderIndex));
        for (const pp of pmPointDefs) {
          if (!seenPointIds.has(pp.id)) {
            allPointDefs.push(pp);
            seenPointIds.add(pp.id);
          }
        }
      }

      if (allPointDefs.length === 0) {
        return res.json({
          success: true,
          data: {
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
            productImage, boardInfo, points: [],
          },
        });
      }

      const pointDefIds = allPointDefs.map((p: any) => p.id);

      // Per-point statistics
      const pointStats = await database.select({
        pointDefId: measurementResults.pointDefId,
        total: sqlOp<number>`count(*)`.as('total'),
        ng: sqlOp<number>`sum(case when ${measurementResults.result} = 'NG' then 1 else 0 end)`.as('ng'),
        ntf: sqlOp<number>`sum(case when ${measurementResults.result} = 'NTF' then 1 else 0 end)`.as('ntf'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eqOp(measurementResults.inspectionId, productInspections.id))
        .where(andOp(inArray(measurementResults.pointDefId, pointDefIds), ...inspConds))
        .groupBy(measurementResults.pointDefId);

      const statsMap = new Map<number, { total: number; ng: number; ntf: number }>(
        pointStats.map((s: any) => [s.pointDefId, { total: Number(s.total), ng: Number(s.ng), ntf: Number(s.ntf) }])
      );

      // Last measurement per point
      const lastMeasurements = await database.select({
        pointDefId: measurementResults.pointDefId,
        measuredValue: measurementResults.measuredValue,
        measuredValueText: measurementResults.measuredValueText,
        result: measurementResults.result,
      })
        .from(measurementResults)
        .innerJoin(productInspections, eqOp(measurementResults.inspectionId, productInspections.id))
        .where(andOp(inArray(measurementResults.pointDefId, pointDefIds), ...inspConds))
        .orderBy(descOp(productInspections.inspectionTime))
        .limit(pointDefIds.length);

      const lastMeasMap = new Map<number, { value: string; result: string }>();
      for (const m of lastMeasurements) {
        if (!lastMeasMap.has(m.pointDefId)) {
          lastMeasMap.set(m.pointDefId, {
            value: m.measuredValueText || (m.measuredValue != null ? String(m.measuredValue) : '—'),
            result: m.result,
          });
        }
      }

      // NG error images per point (up to imageLimit per point)
      const ngImages = await database.select({
        id: measurementResults.id,
        pointDefId: measurementResults.pointDefId,
        imageUrl: measurementResults.imageUrl,
        measuredValue: measurementResults.measuredValue,
        measuredValueText: measurementResults.measuredValueText,
        result: measurementResults.result,
        inspectionTime: productInspections.inspectionTime,
        serialNumber: productInspections.serialNumber,
      })
        .from(measurementResults)
        .innerJoin(productInspections, eqOp(measurementResults.inspectionId, productInspections.id))
        .where(andOp(
          inArray(measurementResults.pointDefId, pointDefIds),
          eqOp(measurementResults.result, 'NG'),
          isNotNull(measurementResults.imageUrl),
          ...inspConds,
        ))
        .orderBy(descOp(productInspections.inspectionTime))
        .limit(pointDefIds.length * imageLimit);

      const errorImagesMap = new Map<number, any[]>();
      for (const img of ngImages) {
        const arr = errorImagesMap.get(img.pointDefId) || [];
        if (arr.length < imageLimit) {
          arr.push({
            id: img.id,
            imageUrl: img.imageUrl,
            measuredValue: img.measuredValueText || (img.measuredValue != null ? String(img.measuredValue) : '—'),
            result: img.result,
            inspectionTime: img.inspectionTime ? new Date(img.inspectionTime).toISOString() : '',
            serialNumber: img.serialNumber || '',
          });
          errorImagesMap.set(img.pointDefId, arr);
        }
      }

      // Assemble points
      const points = allPointDefs.map((def: any) => {
        const st = statsMap.get(def.id) || { total: 0, ng: 0, ntf: 0 };
        const defectRate = st.total > 0 ? Math.round((st.ng / st.total) * 10000) / 100 : 0;
        const ntfRate = st.total > 0 ? Math.round((st.ntf / st.total) * 10000) / 100 : 0;
        const status: string = defectRate >= 2 ? 'fail' : defectRate >= 0.5 ? 'warn' : 'pass';
        const lastMeas = lastMeasMap.get(def.id);

        return {
          id: def.id,
          code: def.code,
          name: def.name,
          type: def.measurementType,
          positionX: def.positionX,
          positionY: def.positionY,
          radius: def.radius,
          normalizedX: def.normalizedX != null ? Number(def.normalizedX) : null,
          normalizedY: def.normalizedY != null ? Number(def.normalizedY) : null,
          normalizedRadius: def.normalizedRadius != null ? Number(def.normalizedRadius) : null,
          cropWidth: def.cropWidth,
          cropHeight: def.cropHeight,
          workstationId: def.workstationId ?? null,
          status,
          defectRate,
          totalInspected: st.total,
          ngCount: st.ng,
          ntfCount: st.ntf,
          ntfRate,
          lowerLimit: def.lowerLimit ? Number(def.lowerLimit) : null,
          upperLimit: def.upperLimit ? Number(def.upperLimit) : null,
          nominalValue: def.nominalValue ? Number(def.nominalValue) : null,
          unit: def.unit,
          lastValue: lastMeas?.value ?? null,
          lastResult: lastMeas?.result ?? null,
          errorImages: errorImagesMap.get(def.id) || [],
        };
      });

      res.json({
        success: true,
        data: {
          dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
          station: { id: stationRows[0].id, code: stationRows[0].code, name: stationRows[0].name },
          productImage,
          boardInfo,
          points,
        },
      });
    } catch (error: any) {
      console.error("[External] station point-detail error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get point detail" });
    }
  });

  // ============================================================
  // A11. GET /api/external/workstations — List workstations for third-party apps
  // ============================================================
  app.get("/api/external/workstations", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { workstations, factories, workshops, productionLines } = await import("../../drizzle/schema");
      const { eq: eqOp, and: andOp } = await import("drizzle-orm");

      // Optional filters
      const factoryId = req.query.factoryId ? parseInt(req.query.factoryId as string, 10) : undefined;
      const workshopId = req.query.workshopId ? parseInt(req.query.workshopId as string, 10) : undefined;
      const lineId = req.query.lineId ? parseInt(req.query.lineId as string, 10) : undefined;

      const conditions: any[] = [eqOp(workstations.isActive, true)];
      if (factoryId && !isNaN(factoryId)) conditions.push(eqOp(workstations.factoryId, factoryId));
      if (workshopId && !isNaN(workshopId)) conditions.push(eqOp(workstations.workshopId, workshopId));
      if (lineId && !isNaN(lineId)) conditions.push(eqOp(workstations.lineId, lineId));

      const rows = await database
        .select({
          id: workstations.id,
          code: workstations.code,
          name: workstations.name,
          description: workstations.description,
          processType: workstations.processType,
          orderIndex: workstations.orderIndex,
          lineId: workstations.lineId,
          workshopId: workstations.workshopId,
          factoryId: workstations.factoryId,
          factoryName: factories.name,
          workshopName: workshops.name,
          lineName: productionLines.name,
        })
        .from(workstations)
        .leftJoin(factories, eqOp(workstations.factoryId, factories.id))
        .leftJoin(workshops, eqOp(workstations.workshopId, workshops.id))
        .leftJoin(productionLines, eqOp(workstations.lineId, productionLines.id))
        .where(andOp(...conditions))
        .orderBy(workstations.orderIndex);

      res.json({
        success: true,
        data: rows.map(r => ({
          id: r.id,
          code: r.code,
          name: r.name,
          description: r.description,
          processType: r.processType,
          orderIndex: r.orderIndex,
          lineId: r.lineId,
          workshopId: r.workshopId,
          factoryId: r.factoryId,
          factoryName: r.factoryName ?? null,
          workshopName: r.workshopName ?? null,
          lineName: r.lineName ?? null,
        })),
      });
    } catch (error: any) {
      console.error("[External] workstations list error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get workstations" });
    }
  });

  // A11b. GET /api/external/workstations/:id — Get workstation detail
  app.get("/api/external/workstations/:id", validateExternalAuth, async (req, res) => {
    try {
      const wsId = parseInt(req.params.id, 10);
      if (isNaN(wsId)) return res.status(400).json({ success: false, message: "Invalid workstation ID" });

      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { workstations, factories, workshops, productionLines } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      const rows = await database
        .select({
          id: workstations.id,
          code: workstations.code,
          name: workstations.name,
          description: workstations.description,
          processType: workstations.processType,
          orderIndex: workstations.orderIndex,
          isActive: workstations.isActive,
          lineId: workstations.lineId,
          workshopId: workstations.workshopId,
          factoryId: workstations.factoryId,
          factoryName: factories.name,
          workshopName: workshops.name,
          lineName: productionLines.name,
        })
        .from(workstations)
        .leftJoin(factories, eqOp(workstations.factoryId, factories.id))
        .leftJoin(workshops, eqOp(workstations.workshopId, workshops.id))
        .leftJoin(productionLines, eqOp(workstations.lineId, productionLines.id))
        .where(eqOp(workstations.id, wsId))
        .limit(1);

      if (rows.length === 0) return res.status(404).json({ success: false, message: "Workstation not found" });
      const r = rows[0];

      res.json({
        success: true,
        data: {
          id: r.id,
          code: r.code,
          name: r.name,
          description: r.description,
          processType: r.processType,
          orderIndex: r.orderIndex,
          isActive: r.isActive,
          lineId: r.lineId,
          workshopId: r.workshopId,
          factoryId: r.factoryId,
          factoryName: r.factoryName ?? null,
          workshopName: r.workshopName ?? null,
          lineName: r.lineName ?? null,
        },
      });
    } catch (error: any) {
      console.error("[External] workstation detail error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get workstation" });
    }
  });

  // ============================================================
  // External Inspection APIs for third-party integration
  // ============================================================
  registerExternalInspectionRoutes(app, validateExternalAuth);

  // ============================================================
  // AOI Package - REST proxy for presign (create upload URL)
  // ============================================================
  app.post("/api/aoi/presign", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };
      const result = await caller.aoiPackage.presign(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[AOI] presign error:", error);
      res.status(400).json({ success: false, message: error?.message || "Presign failed" });
    }
  });

  // ============================================================
  // AOI Package - REST proxy for commit (confirm upload)
  // ============================================================
  app.post("/api/aoi/commit", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };
      const result = await caller.aoiPackage.commit(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[AOI] commit error:", error);
      res.status(400).json({ success: false, message: error?.message || "Commit failed" });
    }
  });

  // ============================================================
  // AOI Package Upload - REST endpoint for binary ZIP upload
  // Agent uploads ZIP directly via this endpoint
  // ============================================================
  app.put("/api/aoi/upload/:packageId", express.raw({ type: "*/*", limit: "200mb" }), uploadGuard("zip"), async (req, res) => {
    const startTime = Date.now();
    
    // Ensure CORS headers are set (even on error responses). Hardening (WS0.2):
    // only reflect allow-listed origins with credentials — never an arbitrary
    // origin. The global CORS middleware already ran for this request.
    const origin = req.headers.origin;
    if (origin && (corsAllowAll || corsAllowList.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    try {
      const { packageId } = req.params;
      const apiKey = req.header("x-api-key") || req.header("X-API-Key") || "";
      const machineCode = req.header("x-machine-code") || req.header("X-Machine-Code") || "";
      const contentType = req.header("content-type") || "";
      const contentLength = req.header("content-length") || "0";

      console.log(`[AOI-Upload] ${req.method} ${req.path} from ${req.ip || req.socket.remoteAddress}`);
      console.log(`[AOI-Upload] Origin: ${origin || 'none'}, Content-Type: ${contentType}, Content-Length: ${contentLength}`);
      console.log(`[AOI-Upload] Headers: API-Key=${apiKey ? 'present' : 'missing'}, Machine-Code=${machineCode || 'missing'}`);

      if (!apiKey && !machineCode) {
        console.warn(`[AOI-Upload] Missing credentials for ${packageId}`);
        return res.status(401).json({ success: false, message: "x-api-key or x-machine-code header required" });
      }

      // Validate machine
      const { getDb } = await import("../db");
      const { getMachineByApiKey, getMachineByCode } = await import("../db");
      let machine;
      if (apiKey) {
        machine = await getMachineByApiKey(apiKey);
      } else {
        machine = await getMachineByCode(machineCode);
      }
      if (!machine) {
        return res.status(401).json({ success: false, message: "Invalid machine credentials" });
      }

      // Find package record
      const database = await getDb();
      if (!database) {
        return res.status(500).json({ success: false, message: "Database unavailable" });
      }

      const { inspectionPackages } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, packageId))
        .limit(1);

      if (pkgs.length === 0) {
        return res.status(404).json({ success: false, message: "Package not found. Call presign first." });
      }

      const pkg = pkgs[0];
      if (pkg.machineId !== machine.id) {
        return res.status(403).json({ success: false, message: "Package belongs to another machine" });
      }

      // Check if already uploaded
      if (pkg.status === "committed") {
        return res.json({ success: true, alreadyUploaded: true, packageId });
      }

      // Detect retry (already uploaded before)
      const isRetry = pkg.status === "uploaded" || pkg.status === "uploading";

      const zipBuffer = req.body as Buffer;
      if (!zipBuffer || zipBuffer.length === 0) {
        console.error(`[AOI-Upload] Empty body for ${packageId}. Raw body type: ${typeof req.body}, Content-Type: ${contentType}`);
        return res.status(400).json({ success: false, message: "Empty request body. Ensure Content-Type is set correctly (application/zip or application/octet-stream)" });
      }

      console.log(`[AOI-Upload] Body received: ${zipBuffer.length} bytes for ${packageId}`);

      // Store the ZIP file
      const { storagePut } = await import("../storage");
      const storageKey = pkg.storageKey || `aoi/${machine.code}/${new Date().toISOString().slice(0, 10).replace(/-/g, "/")}/${packageId}.zip`;

      await storagePut(storageKey, zipBuffer, "application/zip");

      // Update package status
      await database
        .update(inspectionPackages)
        .set({
          status: "uploaded" as const,
          storageKey,
          fileSizeBytes: zipBuffer.length,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(inspectionPackages.id, pkg.id));

      console.log(`[AOI] ZIP uploaded: ${packageId} (${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB) from machine ${machine.code}`);

      // Log activity: upload_success (or retry)
      try {
        const { packageActivityLogs } = await import("../../drizzle/schema");
        await database.insert(packageActivityLogs).values({
          packageDbId: pkg.id,
          packageId: packageId,
          machineId: machine.id,
          event: isRetry ? "retry" : "upload_success",
          level: "info",
          message: isRetry
            ? `ZIP re-uploaded (retry): ${(zipBuffer.length / 1024).toFixed(1)} KB`
            : `ZIP uploaded successfully: ${(zipBuffer.length / 1024).toFixed(1)} KB`,
          source: "agent",
          ipAddress: req.ip || req.socket.remoteAddress || null,
          userAgent: req.header("user-agent") || null,
          fileSizeBytes: zipBuffer.length,
          detail: `Storage key: ${storageKey}`,
          metadata: { storageKey, sizeBytes: zipBuffer.length, isRetry },
        });
      } catch (_logErr) { /* logging should not break upload */ }

      res.json({ success: true, packageId, sizeBytes: zipBuffer.length, storageKey });
    } catch (error: any) {
      console.error("[AOI] upload error:", error);
      console.error("[AOI] Error stack:", error?.stack);
      console.error("[AOI] Request details:", {
        packageId: req.params.packageId,
        headers: req.headers,
        bodyType: typeof req.body,
        bodyLength: req.body?.length || 0,
      });

      // Log activity: upload_fail
      try {
        const { packageActivityLogs } = await import("../../drizzle/schema");
        const database2 = await getDb();
        const { packageId: pkgIdParam } = req.params;
        if (database2 && pkgIdParam) {
          const { inspectionPackages: ip } = await import("../../drizzle/schema");
          const found = await database2.select({ id: ip.id }).from(ip).where(eq(ip.packageId, pkgIdParam)).limit(1);
          if (found.length > 0) {
            await database2.insert(packageActivityLogs).values({
              packageDbId: found[0].id,
              packageId: pkgIdParam,
              event: "upload_fail",
              level: "error",
              message: `Upload failed: ${error?.message || 'Unknown error'}`,
              source: "server",
              detail: error?.stack || error?.message,
              ipAddress: req.ip || req.socket.remoteAddress || null,
              userAgent: req.header("user-agent") || null,
            });
          }
        }
      } catch (_logErr) { /* ignore */ }

      res.status(500).json({ success: false, message: error?.message || "Upload failed" });
    }
  });

  // AOI Package - Serve image directly (non-tRPC endpoint for <img> tags)
  app.get("/api/aoi/image/:packageId/:fileName", async (req, res) => {
    try {
      const { packageId, fileName } = req.params;

      // Detect content type from file extension (fallback: detect from magic bytes later)
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
      const detectMime = (buf: Buffer) => {
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
        if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
        if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
        if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
        return mimeMap[ext] || 'image/jpeg';
      };

      const database = await getDb();
      if (!database) {
        return res.status(500).json({ success: false, message: "Database unavailable" });
      }

      const { inspectionPackages } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, packageId))
        .limit(1);

      if (pkgs.length === 0) return res.status(404).json({ message: "Package not found" });
      const pkg = pkgs[0];

      // Extract & serve image (import the helper from router)
      const { storagePut: _, storageGet } = await import("../storage");
      const JSZip = (await import("jszip")).default;
      const fsMod = await import("fs");
      const pathMod = await import("path");

      const CACHE_DIR = process.env.AOI_CACHE_DIR
        ? pathMod.resolve(process.env.AOI_CACHE_DIR)
        : pathMod.join(process.cwd(), "uploads", "aoi-cache");
      const CACHE_TTL_DAYS = parseInt(process.env.AOI_CACHE_TTL_DAYS || "7");

      const cacheKey = `${packageId}/${fileName}`;
      const cachePath = pathMod.join(CACHE_DIR, cacheKey);

      // Thumbnail resize support: ?w=320&q=75
      const thumbWidth = req.query.w ? Math.min(Math.max(parseInt(String(req.query.w), 10) || 0, 32), 1920) : 0;
      const thumbQuality = req.query.q ? Math.min(Math.max(parseInt(String(req.query.q), 10) || 80, 10), 100) : 80;
      const thumbCacheKey = thumbWidth ? `${packageId}/thumb_${thumbWidth}_${fileName}` : null;
      const thumbCachePath = thumbCacheKey ? pathMod.join(CACHE_DIR, thumbCacheKey) : null;

      // Helper: resize buffer with sharp if thumbnail requested
      const maybeResize = async (buf: Buffer): Promise<Buffer> => {
        if (!thumbWidth) return buf;
        try {
          const sharpMod = (await import("sharp")).default;
          return await sharpMod(buf).resize({ width: thumbWidth, withoutEnlargement: true }).jpeg({ quality: thumbQuality }).toBuffer();
        } catch { return buf; }
      };

      // Check thumbnail cache first
      if (thumbCachePath && fsMod.existsSync(thumbCachePath)) {
        const stat = fsMod.statSync(thumbCachePath);
        const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        if (ageDays < CACHE_TTL_DAYS) {
          const cachedBuf = fsMod.readFileSync(thumbCachePath);
          res.setHeader("Content-Type", "image/jpeg");
          res.setHeader("Cache-Control", "public, max-age=86400");
          res.setHeader("X-Cache", "HIT");
          return res.send(cachedBuf);
        }
      }

      // Check cache first
      if (fsMod.existsSync(cachePath)) {
        const stat = fsMod.statSync(cachePath);
        const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        if (ageDays < CACHE_TTL_DAYS) {
          const cachedBuf = fsMod.readFileSync(cachePath);
          if (thumbWidth) {
            const resized = await maybeResize(cachedBuf);
            if (thumbCachePath) {
              const td = pathMod.dirname(thumbCachePath);
              if (!fsMod.existsSync(td)) fsMod.mkdirSync(td, { recursive: true });
              fsMod.writeFileSync(thumbCachePath, resized);
            }
            res.setHeader("Content-Type", "image/jpeg");
            res.setHeader("Cache-Control", "public, max-age=86400");
            res.setHeader("X-Cache", "HIT-THUMB");
            return res.send(resized);
          }
          res.setHeader("Content-Type", detectMime(cachedBuf));
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.setHeader("X-Cache", "HIT");
          return res.send(cachedBuf);
        }
      }

      if (!pkg.storageKey) return res.status(404).json({ message: "ZIP not available" });

      let zipBuffer: Buffer;
      const storageMode = process.env.STORAGE_MODE ?? "forge";
      if (storageMode === "local") {
        const uploadsRoot = process.env.LOCAL_STORAGE_DIR
          ? pathMod.resolve(process.env.LOCAL_STORAGE_DIR)
          : pathMod.join(process.cwd(), "uploads");
        const filePath = pathMod.join(uploadsRoot, pkg.storageKey);
        if (!fsMod.existsSync(filePath)) return res.status(404).json({ message: "ZIP file not found" });
        zipBuffer = fsMod.readFileSync(filePath);
      } else {
        const { url } = await storageGet(pkg.storageKey);
        const response = await fetch(url);
        if (!response.ok) return res.status(500).json({ message: "Failed to download ZIP" });
        zipBuffer = Buffer.from(await response.arrayBuffer());
      }

      const zip = await JSZip.loadAsync(zipBuffer);
      const imageFile = zip.file(`images/${fileName}`) || zip.file(fileName);
      if (!imageFile) return res.status(404).json({ message: `Image ${fileName} not found in ZIP` });

      const imageBuffer = Buffer.from(await imageFile.async("uint8array"));

      // Cache the extracted image
      const cacheDir = pathMod.dirname(cachePath);
      if (!fsMod.existsSync(cacheDir)) fsMod.mkdirSync(cacheDir, { recursive: true });
      fsMod.writeFileSync(cachePath, imageBuffer);

      // Return thumbnail if requested
      if (thumbWidth) {
        const resized = await maybeResize(imageBuffer);
        if (thumbCachePath) {
          const td = pathMod.dirname(thumbCachePath);
          if (!fsMod.existsSync(td)) fsMod.mkdirSync(td, { recursive: true });
          fsMod.writeFileSync(thumbCachePath, resized);
        }
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("X-Cache", "MISS-THUMB");
        return res.send(resized);
      }

      res.setHeader("Content-Type", detectMime(imageBuffer));
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Cache", "MISS");
      return res.send(imageBuffer);
    } catch (error: any) {
      console.error("[AOI] image serve error:", error);
      res.status(500).json({ message: error?.message || "Failed to serve image" });
    }
  });

  // AOI Package - Download original ZIP for audit
  app.get("/api/aoi/download/:packageId", async (req, res) => {
    try {
      const { packageId } = req.params;
      const database = await getDb();
      if (!database) return res.status(500).json({ message: "Database unavailable" });

      const { inspectionPackages } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, packageId))
        .limit(1);

      if (pkgs.length === 0) return res.status(404).json({ message: "Package not found" });
      const pkg = pkgs[0];
      if (!pkg.storageKey) return res.status(404).json({ message: "ZIP not available" });

      const storageMode = process.env.STORAGE_MODE ?? "forge";
      if (storageMode === "local") {
        const uploadsRoot = process.env.LOCAL_STORAGE_DIR
          ? path.resolve(process.env.LOCAL_STORAGE_DIR)
          : path.join(process.cwd(), "uploads");
        const filePath = path.join(uploadsRoot, pkg.storageKey);
        if (!fs.existsSync(filePath)) return res.status(404).json({ message: "ZIP file not found" });

        // Log activity: zip_download
        try {
          const { packageActivityLogs } = await import("../../drizzle/schema");
          await database.insert(packageActivityLogs).values({
            packageDbId: pkg.id,
            packageId: packageId,
            event: "zip_download",
            level: "info",
            message: `ZIP downloaded for audit`,
            source: "user",
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.header("user-agent") || null,
            fileSizeBytes: pkg.fileSizeBytes,
          });
        } catch (_logErr) { /* ignore */ }

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${packageId}.zip"`);
        return res.sendFile(filePath);
      } else {
        // Log activity: zip_download
        try {
          const { packageActivityLogs } = await import("../../drizzle/schema");
          await database.insert(packageActivityLogs).values({
            packageDbId: pkg.id,
            packageId: packageId,
            event: "zip_download",
            level: "info",
            message: `ZIP downloaded for audit (redirect)`,
            source: "user",
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.header("user-agent") || null,
          });
        } catch (_logErr) { /* ignore */ }

        const { storageGet } = await import("../storage");
        const { url } = await storageGet(pkg.storageKey);
        return res.redirect(url);
      }
    } catch (error: any) {
      console.error("[AOI] download error:", error);
      res.status(500).json({ message: error?.message || "Download failed" });
    }
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // ────────────────────────────────────────────────────────────────────────────
  // REST proxy for publicProductApi (for non-tRPC clients: Android, C#, Python…)
  // Auth: header X-Master-Key / X-API-Key / X-Machine-Code  OR  query masterKey / apiKey / machineCode
  // ────────────────────────────────────────────────────────────────────────────
  app.get("/api/public/products", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || (req.query.apiKey as string) || "";
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string) || "";
      const masterKey = req.header("x-master-key") || (req.query.masterKey as string) || "";
      const result = await caller.publicProductApi.listProducts({
        apiKey: apiKey || undefined,
        machineCode: machineCode || undefined,
        masterKey: masterKey || undefined,
        search: (req.query.search as string) || undefined,
        lifecycleStatus: (req.query.lifecycleStatus as "development" | "active" | "eol" | "archived") || undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(result);
    } catch (error: any) {
      const status = error.code === "UNAUTHORIZED" || error.code === "BAD_REQUEST" ? 401 : error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  });

  app.get("/api/public/products/by-code/:code", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || (req.query.apiKey as string) || "";
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string) || "";
      const masterKey = req.header("x-master-key") || (req.query.masterKey as string) || "";
      const result = await caller.publicProductApi.getProductByCode({
        apiKey: apiKey || undefined,
        machineCode: machineCode || undefined,
        masterKey: masterKey || undefined,
        code: req.params.code,
      });
      res.json(result);
    } catch (error: any) {
      const status = error.code === "UNAUTHORIZED" || error.code === "BAD_REQUEST" ? 401 : error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  });

  app.get("/api/public/products/by-id/:id", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || (req.query.apiKey as string) || "";
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string) || "";
      const masterKey = req.header("x-master-key") || (req.query.masterKey as string) || "";
      const result = await caller.publicProductApi.getProductById({
        apiKey: apiKey || undefined,
        machineCode: machineCode || undefined,
        masterKey: masterKey || undefined,
        id: Number(req.params.id),
      });
      res.json(result);
    } catch (error: any) {
      const status = error.code === "UNAUTHORIZED" || error.code === "BAD_REQUEST" ? 401 : error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  });

  app.get("/api/public/products/:productCode/measurement-points", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || (req.query.apiKey as string) || "";
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string) || "";
      const masterKey = req.header("x-master-key") || (req.query.masterKey as string) || "";
      const result = await caller.publicProductApi.getMeasurementPoints({
        apiKey: apiKey || undefined,
        machineCode: machineCode || undefined,
        masterKey: masterKey || undefined,
        productCode: req.params.productCode,
      });
      res.json(result);
    } catch (error: any) {
      const status = error.code === "UNAUTHORIZED" || error.code === "BAD_REQUEST" ? 401 : error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  });

  app.get("/api/public/products/:productCode/image", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || (req.query.apiKey as string) || "";
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string) || "";
      const masterKey = req.header("x-master-key") || (req.query.masterKey as string) || "";
      const result = await caller.publicProductApi.getProductImage({
        apiKey: apiKey || undefined,
        machineCode: machineCode || undefined,
        masterKey: masterKey || undefined,
        productCode: req.params.productCode,
      });
      res.json(result);
    } catch (error: any) {
      const status = error.code === "UNAUTHORIZED" || error.code === "BAD_REQUEST" ? 401 : error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  });

  // Serve reference image as binary HTTP response (not base64 in JSON)
  // This avoids ~400KB base64 bloat in JSON responses and allows Image.getSize in React Native
  app.get("/api/public/products/:productCode/reference-image-file", async (req, res) => {
    try {
      const masterKey = req.header("x-master-key") || (req.query.masterKey as string) || "";
      const apiKey = req.header("x-api-key") || (req.query.apiKey as string) || "";
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string) || "";

      // Validate access
      let authorized = false;
      if (isValidMasterKey(masterKey)) {
        authorized = true;
      } else if (apiKey) {
        const machine = await import("../db").then(m => m.getMachineByApiKey(apiKey));
        if (machine) authorized = true;
      } else if (machineCode) {
        const machine = await import("../db").then(m => m.getMachineByCode(machineCode.trim()));
        if (machine) authorized = true;
      }
      if (!authorized) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const db = await import("../db");
      const product = await db.getProductModelByCode(req.params.productCode);
      if (!product || !product.referenceImageUrl) {
        return res.status(404).json({ success: false, error: "Product or image not found" });
      }

      let imageData: Buffer;
      let contentType = "image/jpeg";

      if (product.referenceImageUrl.startsWith('data:image/')) {
        // Decode base64 data URI
        const match = product.referenceImageUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!match) {
          return res.status(500).json({ success: false, error: "Invalid image data URI" });
        }
        contentType = match[1];
        imageData = Buffer.from(match[2], 'base64');
      } else if (product.referenceImageUrl.startsWith('/uploads/')) {
        // Read from local file
        const fs = await import("fs");
        const path = await import("path");
        const filePath = path.join(process.cwd(), product.referenceImageUrl);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ success: false, error: "Image file not found" });
        }
        imageData = fs.readFileSync(filePath);
        if (product.referenceImageUrl.endsWith('.png')) contentType = 'image/png';
        else if (product.referenceImageUrl.endsWith('.webp')) contentType = 'image/webp';
      } else {
        return res.status(400).json({ success: false, error: "Unsupported image source" });
      }

      res.set('Content-Type', contentType);
      res.set('Content-Length', String(imageData.length));
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(imageData);
    } catch (error: any) {
      console.error('[ReferenceImageFile] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/public/measurement-points/:pointId/image", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || (req.query.apiKey as string) || "";
      const machineCode = req.header("x-machine-code") || (req.query.machineCode as string) || "";
      const masterKey = req.header("x-master-key") || (req.query.masterKey as string) || "";
      const result = await caller.publicProductApi.getPointImage({
        apiKey: apiKey || undefined,
        machineCode: machineCode || undefined,
        masterKey: masterKey || undefined,
        pointId: Number(req.params.pointId),
      });
      res.json(result);
    } catch (error: any) {
      const status = error.code === "UNAUTHORIZED" || error.code === "BAD_REQUEST" ? 401 : error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  });

  // Register AI SSE streaming routes (before tRPC mount)
  registerAiStreamingRoutes(app);
  // Doc 34 §IV-P0 — OpenAI-compatible gateway (/v1/*). Gated by OPENAI_GATEWAY_ENABLED
  // (default OFF) and fail-closed on a missing API key. Mounted before license
  // middleware so trusted-LAN IDE tooling (VS Code + Continue) can reach it.
  registerOpenAiGateway(app);
  registerAiLocalKnowledgeRoutes(app);
  // WS-2 — edge model package download proxy (apiKey-verified, Range resume)
  registerEdgeDownloadRoute(app);

  // License enforcement middleware (must be before tRPC mount)
  // ============================================================
  // Phase E1 — Unified Machine API (versioned REST /api/v1).
  // The single external integration contract over the E0 equipment layer:
  // scoped API-key auth, OpenAPI docs, HITL-gated commands, webhooks. Additive.
  // ============================================================
  try {
    const { createV1Router } = await import("../api/v1/router");
    const { installWebhookBridge } = await import("../api/v1/webhookBridge");
    // W2-D (doc 35 W0.3a → W2): license (never-stop-production) + audit guard,
    // mounted BEFORE the router so it wraps every /api/v1 route.
    const { v1Guard } = await import("../api/v1/guard");
    app.use("/api/v1", v1Guard());
    app.use("/api/v1", createV1Router());
    installWebhookBridge(); // outbound POST still gated by WEBHOOKS_ENABLED (default off)
    console.log("[ControlPlane] Unified Machine API mounted at /api/v1");
  } catch (err) {
    console.error("[ControlPlane] /api/v1 mount failed:", (err as any)?.message || err);
  }

  // ============================================================
  // W5-D (doc 27 §6 A10) — raw export + BI dataset feed. Additive.
  //   /api/export/inspections.csv|.json, /api/export/measurements.csv|.json
  //     — streaming, session or export:read API key, window-guarded, audited.
  //   /api/bi/datasets(/:name) — paged JSON + nextToken for Power BI/Tableau,
  //     bi:read API key. Docs: docs/ECOSYSTEM/30_BI_EXPORT_API.md.
  // ============================================================
  try {
    const { createExportRouter } = await import("../api/export/exportRouter");
    const { createBiRouter } = await import("../api/export/biRouter");
    app.use("/api/export", createExportRouter());
    app.use("/api/bi", createBiRouter());
    console.log("[Export] streaming export mounted at /api/export, BI feed at /api/bi");
  } catch (err) {
    console.error("[Export] /api/export + /api/bi mount failed:", (err as any)?.message || err);
  }

  // ============================================================
  // Doc 32 Wave R2 (decision #4/#5) — persisted report-artifact re-download.
  //   GET /api/reports/artifacts/:id/download — auth-gated (session or
  //   export:read API key), access + expiry checked, streams the stored file.
  // ============================================================
  try {
    const { registerReportArtifactRoutes } = await import("../routes/reportArtifactRoutes");
    registerReportArtifactRoutes(app);
  } catch (err) {
    console.error("[ReportArtifact] download route mount failed:", (err as any)?.message || err);
  }

  // ============================================================
  // doc 37 C1 (P2) — Observability health plane. Read-only, admin/supervisor-gated:
  //   GET /api/observability/health  — OT store-forward buffer + connection supervisors
  //                                     + SLO burn-rate rollup + decision-trace ring depth
  //   GET /api/observability/slo      — SLO catalogue + latest status + burn-rate
  //   GET /api/observability/metrics  — SLO + decision-trace signals in Prometheus text format
  // Surfaces the honest health-getters that already existed but were never exposed over HTTP.
  // ============================================================
  try {
    const { registerObservabilityRoutes } = await import("../routes/observabilityRoutes");
    registerObservabilityRoutes(app);
  } catch (err) {
    console.error("[Observability] health route mount failed:", (err as any)?.message || err);
  }

  // U1 (doc 21 §6) — Unified Event Backbone: (a) subscribe the ecosystem bridge so
  // the orphaned (safety.event, quality_gate.breach) + new (anomaly/workorder/task/
  // program) domain events fan out to webhooks + KB — OUTBOUND gated by
  // ECOSYSTEM_EVENTS_ENABLED (default OFF); in-process registration is harmless.
  // (b) attach the eventBus→socket re-broadcast so ALL event classes reach the
  // client on ONE normalized `ecosystem:event` / `alerts:stream` (U1-c).
  try {
    const { installEcosystemEventBridge } = await import("../services/ecosystem/ecosystemEvents");
    installEcosystemEventBridge();
    const { installEcosystemSocketBridge } = await import("./socket");
    installEcosystemSocketBridge();
  } catch (err) {
    console.error("[U1] ecosystem event backbone install failed:", (err as any)?.message || err);
  }

  // R0 (doc 16 Khối 0) — ERP outbox drain worker: MOVED to the W4-D background
  // scheduler set (server/_core/backgroundJobs.ts) — started below unless
  // ROLE=api. Inbound intake (POST /orders,/bom) stays on the /api/v1 router.

  // G1 (doc 16 Khối 2) — Fleet & Task Orchestration: subscribe to order.created on
  // the eventBus → decompose orders into `tasks` + allocate. The subscriber is
  // always registered (cheap) but its handler is a no-op unless FLEET_ORCH_ENABLED.
  // Opens NO control path — dispatch stays with the gated robot/command dispatchers.
  try {
    const { installFleetOrchestrator } = await import("../services/fleet/fleetOrchestrator");
    installFleetOrchestrator();
  } catch (err) {
    console.error("[Fleet] orchestrator install failed:", (err as any)?.message || err);
  }

  // doc 22 P3 — Fleet pending-drain sweep + G2 predictive charging sweep:
  // MOVED to the W4-D background scheduler set (backgroundJobs.ts) — DB-state
  // sweeps, no socket/event-bus coupling.

  // T1 (doc 16 Khối 7) — Digital Twin live streaming gateway: subscribe to the
  // unified telemetry bus (in-process tap) and push throttled device deltas to the
  // per-factory room `twin:{factoryId}` (<=10Hz). A NO-OP unless TWIN_LIVE_ENABLED —
  // when off, the FE keeps its 5s poll fallback (digitalTwin.* queries) unchanged.
  // Opens NO control path: signal-only (no device/DB write).
  try {
    const { startTwinStreamGateway } = await import("../services/twin/twinStream");
    startTwinStreamGateway();
  } catch (err) {
    console.error("[TwinStream] gateway start failed:", (err as any)?.message || err);
  }

  // X1 (doc 16 Khối 1) — Field & device abstraction. Two flag-gated startups (no-ops
  // unless FIELD_V2_ENABLED). Both open NO control path (monitoring/signal only):
  //   (a) heartbeat TTL stale-detection sweep — marks a device 'lost_connection' once
  //       its heartbeat exceeds the TTL + emits an advisory event (safety/fleet react
  //       via the existing gated paths). Unref'd, non-overlapping (mirrors the outbox).
  //   (b) device push-streaming gateway — taps the SAME unified telemetry bus as the
  //       twin stream and pushes TIERED-sampled UDM deltas to `device:{id}` (FE keeps
  //       its 5s poll fallback when off).
  try {
    const { startFieldHealthSweep } = await import("../services/field/fieldHealthService");
    startFieldHealthSweep();
  } catch (err) {
    console.error("[FieldHealth] sweep start failed:", (err as any)?.message || err);
  }
  try {
    const { startDeviceStreamGateway } = await import("../services/field/deviceStream");
    startDeviceStreamGateway();
  } catch (err) {
    console.error("[DeviceStream] gateway start failed:", (err as any)?.message || err);
  }

  // doc 48 R1 (T2 / doc 44 G2.7) — SYNAPSE telemetry STREAM TAP: bridge telemetryBus
  // → StreamBridge (the durable NATS JetStream bus when STREAM_BRIDGE_BACKEND=nats +
  // NATS_URL; the in-process ring otherwise). Taps the SAME unified telemetry bus as
  // the twin/device gateways above (registerTelemetryTap — fired AFTER canonical
  // persist + broadcast) and republishes each ingested batch as one
  // `syn/telemetry/{line}` message so the StreamProcessor / consumer groups / lake
  // sink can replay-reprocess WITHOUT a second reader. Opens NO control path
  // (telemetry replay only; same invariant as the twin/device taps).
  //
  // HONEST-DEGRADE: a clean no-op unless STREAM_TELEMETRY_TAP_ENABLED=true (default
  // OFF — the orchestrator flips it on during staged activation). When enabled with
  // the nats backend unreachable, the adapter refuses each publish with
  // NATS_NOT_AVAILABLE (never fakes durability); a publish error is isolated from
  // ingest and a bad broker never blocks boot. ONE honest boot status line below:
  // disabled | installed (transport ready) | installed (transport UNAVAILABLE).
  try {
    const { installTelemetryStreamTap } = await import("../services/streaming/telemetryStreamTap");
    const handle = await installTelemetryStreamTap();
    if (!handle) {
      console.log("[StreamTelemetryTap] disabled (set STREAM_TELEMETRY_TAP_ENABLED=true to enable)");
    } else {
      // Enabled: report the SELECTED backend + whether its transport is actually
      // usable right now (nats connect probe is fail-safe → false, never throws).
      const { getStreamBridge } = await import("../services/streaming/streamBridge");
      const bridge = await getStreamBridge();
      const usable = await bridge.available().catch(() => false);
      console.log(
        `[StreamTelemetryTap] installed → StreamBridge backend=${bridge.backend} ` +
          `(durable=${bridge.crossProcessDurable}, transport ${
            usable ? "ready" : "UNAVAILABLE — publishes refuse with NATS_NOT_AVAILABLE until reachable"
          })`,
      );
    }
  } catch (err) {
    console.error("[StreamTelemetryTap] install failed:", (err as any)?.message || err);
  }

  // doc 48 R3 — COLD-TIER LAKE SINK: a DURABLE NATS JetStream consumer that archives
  // the telemetry stream (the `syn/telemetry/{line}` messages the tap above publishes)
  // into a time-partitioned, columnar-ready COLD TIER — gzipped-NDJSON files under
  // LAKE_DIR (default ./data/lake) or MinIO/S3 (LAKE_S3_ENDPOINT). Closes the L2 audit
  // gap "no lake/Parquet cold tier for telemetry; marts are plain-PG". Reads the durable
  // log ONLY (never a control path; same invariant as the tap).
  //
  // HONEST-DEGRADE: clean no-op unless LAKE_SINK_ENABLED=true (default OFF — the
  // orchestrator flips it on). With nats selected but unreachable it refuses cleanly
  // (never fakes a lake, never falls back to the in-process ring pretending durability,
  // never blocks boot). On the in-process backend it archives as a NON-durable source
  // (labelled). ONE honest boot status line below.
  try {
    const { startLakeSink } = await import("../services/streaming/lakeSink");
    const res = await startLakeSink();
    if (!res) {
      console.log("[LakeSink] disabled (set LAKE_SINK_ENABLED=true to archive telemetry → cold-tier lake)");
    } else if (res.mode === "nats-durable") {
      console.log(`[LakeSink] ENABLED — durable NATS consumer → ${res.target}`);
    } else if (res.mode === "bridge") {
      console.log(`[LakeSink] ENABLED — in-process NON-durable source → ${res.target}`);
    } else {
      console.log(
        `[LakeSink] enabled but source UNAVAILABLE (${res.mode}) — NATS unreachable; no files written until it is`,
      );
    }
  } catch (err) {
    console.error("[LakeSink] start failed:", (err as any)?.message || err);
  }

  // doc 51 P3 / QĐ#5 — STREAM PROCESSOR: consume syn/telemetry/* từ StreamBridge →
  // event-time tumbling window + watermark + late-correction → phát _line rollup.
  // No-op trừ khi STREAM_PROCESSOR_ENABLED=true. Honest NATS-readiness qua `available`.
  try {
    const { startStreamProcessor } = await import("../services/streaming/streamProcessor");
    const sp = await startStreamProcessor();
    if (!sp) {
      console.log("[StreamProcessor] disabled (set STREAM_PROCESSOR_ENABLED=true to derive _line rollups from the telemetry stream)");
    } else if (sp.available) {
      console.log(`[StreamProcessor] ENABLED — consuming ${sp.sourceTopic} (backend=${sp.backend}) → ${sp.emitTopic}`);
    } else {
      console.log(`[StreamProcessor] enabled but bridge transport UNAVAILABLE (backend=${sp.backend}) — no events consumed until reachable (npm i nats + NATS_URL)`);
    }
  } catch (err) {
    console.error("[StreamProcessor] start failed:", (err as any)?.message || err);
  }

  // I2-b model auto-rollback sweep + doc 22 P2 model perf snapshot producer:
  // MOVED to the W4-D background scheduler set (backgroundJobs.ts).

  app.use("/api/trpc", licenseEnforcementMiddleware());
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Initialize License System (RSA keys)
  await initializeLicenseSystem();

  // Initialize Runtime Security (file integrity monitoring)
  initializeRuntimeSecurity();

  // Initialize Socket.io for realtime notifications
  initializeSocket(server);
  
  // Start offline machine monitor
  startOfflineMonitor();
  
  // Initialize email transporter
  initializeEmailTransporter();

  // W4-D (doc 27 §8 B7) — cron-like background schedulers (reports, backups,
  // retention, integrity scan, AI cron jobs, ERP outbox drain, fleet DB
  // sweeps, model sweeps, PdM, DR, …) now live in ONE shared bootstrap:
  // server/_core/backgroundJobs.ts. Default (ROLE unset): started here exactly
  // as before — all-in-one behaviour unchanged. ROLE=api: SKIPPED — run them
  // in the dedicated worker (`npm run start:worker`). Request-coupled services
  // (socket gateways, MQTT broker, event-bus subscribers, ingest paths, device
  // gateways) are NOT part of this set and keep starting below.
  if (SERVER_ROLE === "api") {
    console.log(
      "[Role] ROLE=api — cron schedulers skipped; run the worker process (`npm run start:worker`)",
    );
  } else {
    try {
      const { startBackgroundSchedulers } = await import("./backgroundJobs");
      await startBackgroundSchedulers();
    } catch (err) {
      console.error("[BackgroundJobs] start failed:", (err as any)?.message || err);
    }

    // doc 54 §11 P1.2 ⭐ — LIVE daily_statistics rollup writer. Populates
    // daily_statistics (source for getAllOEE / OEE dashboards / warRoom line-OEE)
    // from REAL ingested product_inspections per ACTIVE machine (absolute,
    // idempotent, self-healing) — previously only the sim-daemon wrote this table.
    // Cron-like data writer → belongs with the ROLE=api-skipped scheduler set (only
    // runs in default all-in-one / worker, not in the stateless api tier). Self-gates
    // LIVE_STATS_ROLLUP_ENABLED (default OFF) + is idempotent, so this is safe when
    // the flag is off. ⚠ Do NOT enable alongside the sim-live-daemon (double-write —
    // cumulative vs absolute); the two are mutually exclusive sources (see .env).
    try {
      const { startLiveStatsRollup } = await import("../services/liveStatsRollupService");
      startLiveStatsRollup();
    } catch (err) {
      console.error("[liveStatsRollup] start failed:", (err as any)?.message || err);
    }

    // doc 40 MON-F1 — machine presence sweep (ot_telemetry recency → machine_status_logs
    // for EVERY transport, feeding OEE availability/health). CONFIRMED already wired at
    // boot inside startBackgroundSchedulers() above (backgroundJobs.ts, with its stop
    // counterpart). It self-gates MACHINE_PRESENCE_ENABLED (default OFF) + is idempotent,
    // so it is NOT re-called here — backgroundJobs.ts owns its start/stop lifecycle.
  }

  // Initialize MQTT broker (if enabled)
  if (process.env.MQTT_ENABLED === 'true') {
    initMqttBroker();
    initSummaryScheduler();
    startAlertEvaluationJob(1); // Run every 1 minute
    await initBulletinScheduler(); // Initialize periodic bulletin scheduler
    console.log('[MQTT] MQTT broker, alert evaluation, and bulletin scheduler enabled');
  } else {
    console.log('[MQTT] MQTT broker disabled (set MQTT_ENABLED=true to enable)');
  }

  // Alert escalation engine — always-on, runs every 60s
  startEscalationScheduler(60_000);

  // P0-E — Alert evaluation scheduler: evaluates legacy alertSettings rules,
  // runs smart-alert defect-spike / yield-drop detectors, and auto-escalation.
  // Interval via ALERT_EVALUATOR_INTERVAL_MINUTES (default 2); disable with
  // ALERT_EVALUATOR_ENABLED=false. Guarded against double-start internally.
  try {
    startAlertEvaluatorScheduler();
  } catch (err) {
    console.error("[AlertEvaluator] init failed:", (err as any)?.message || err);
  }

  // WS-4 predictive maintenance + WS-2 edge stale checker + E4 edge node
  // heartbeat checker: MOVED to the W4-D background scheduler set
  // (backgroundJobs.ts) — DB-only sweeps.

  // W4-17 — FOE DURABLE EXECUTION: rehydrate-on-boot. driveRun/resumeRun chạy trong-tiến-trình;
  // một restart giữa chừng có thể để lại run FOE kẹt ở 'running'/'queued'/'compensating' mà
  // không còn driver sống. Quét + đánh dấu 'interrupted' (held=resumable / failed=terminal) để
  // không kẹt im lặng + cho phép resume thủ công. Fail-safe + non-blocking: không chặn/không
  // crash khởi động (DB chưa nối → no-op).
  try {
    const { rehydrateInterruptedRuns } = await import("../services/orchestration/foe/foeEngine");
    rehydrateInterruptedRuns()
      .then((r) => {
        if (r.scanned > 0) {
          console.log(
            `[FOE] Rehydrate: ${r.scanned} interrupted run(s) — ${r.interrupted} held(resumable), ` +
              `${r.failed} failed. ids=${r.runIds.join(",")}`,
          );
        }
      })
      .catch((err) => console.error("[FOE] rehydrate failed:", (err as any)?.message || err));
  } catch (err) {
    console.error("[FOE] rehydrate wiring failed:", (err as any)?.message || err);
  }

  // QW3 — Materialized view refresh: MOVED to the W4-D background scheduler
  // set (backgroundJobs.ts); it now also runs on the dedicated jobs DB pool.

  // Doc 27 §11 decision #1 — TimescaleDB is MANDATORY on the main DB. Non-fatal
  // check that prints a prominent error banner when the extension / hypertables
  // are missing (no more silent 0118-style no-op). See drizzle/0172 + runbook
  // scripts/migrate-to-timescaledb.md.
  try {
    const { checkDbRequirements } = await import("../services/dbRequirementsCheck");
    await checkDbRequirements();
  } catch (err) {
    console.error("[DbRequirements] init failed:", (err as any)?.message || err);
  }

  // Doc 27 Đợt 7 W7-D (gap V4) — AI model availability honesty: ONE consolidated
  // startup line (which manifest models are present/missing + the embedding tier
  // actually in effect) + a db_feature_status row ('ai_models') so the admin
  // DB & Ingest health card shows model state. Non-fatal; models are provisioned
  // via `node scripts/fetch-models.mjs` (models/README.md — weights are NOT in git).
  try {
    const { reportAiModelAvailability } = await import("../services/aiModelAvailability");
    await reportAiModelAvailability();
  } catch (err) {
    console.error("[AIModels] init failed:", (err as any)?.message || err);
  }

  // P1 WS1.1 — Data retention pruning: MOVED to the W4-D background scheduler
  // set (backgroundJobs.ts); it now also runs on the dedicated jobs DB pool.

  // Doc 27 Đợt 2 / W2-C (gap C3/R11) — inspection ingest store-and-forward:
  // restores the disk WAL of submissions buffered while the DB was down and
  // starts the backfill worker (replays through the REAL submitInspection
  // pipeline with idempotency). Safe no-op unless INSPECTION_STORE_FORWARD_ENABLED
  // / OT_STORE_FORWARD_ENABLED is on.
  try {
    const { initInspectionStoreForward } = await import("../services/inspection/inspectionStoreForward");
    await initInspectionStoreForward();
  } catch (err) {
    console.error("[InspectionSF] init failed:", (err as any)?.message || err);
  }

  // Doc 27 §11 decisions #2/#5 — image lifecycle: MOVED to the W4-D background
  // scheduler set (backgroundJobs.ts). NOTE: in a split topology the worker
  // must mount the SAME uploads volume as the API.

  // Doc 27 §3 gap C1 (W2-A) — HOT-FOLDER ingestion: watch per-machine result-file
  // folders (CSV/XML/JSON drops from real AOI/AVI machines), normalize via the
  // registered vision adapter and persist through the EXISTING submitInspection
  // path. Disabled by default; opt in via HOT_FOLDER_INGEST_ENABLED=true. Safe
  // no-op when OFF; a bad folder/config never blocks boot.
  try {
    const { startHotFolderIngest } = await import("../services/vision/hotFolderService");
    void startHotFolderIngest().catch((err) =>
      console.error("[HotFolder] start failed:", (err as any)?.message || err),
    );
  } catch (err) {
    console.error("[HotFolder] init failed:", (err as any)?.message || err);
  }

  // Doc 27 §9 V14 (W7-E) — ACQUISITION WORKER autostart: grab→quality→(optional)
  // submit loops over file/mock image sources (the first runtime consumer of the
  // acquisition framework). Gated by LIVE_ACQUISITION_ENABLED + the
  // ACQUISITION_WORKER_AUTOSTART JSON config. Safe no-op when unset; never blocks boot.
  try {
    const { startAcquisitionWorkersFromEnv } = await import(
      "../services/vision/acquisition/acquisitionWorker"
    );
    void startAcquisitionWorkersFromEnv().catch((err) =>
      console.error("[AcqWorker] autostart failed:", (err as any)?.message || err),
    );
  } catch (err) {
    console.error("[AcqWorker] init failed:", (err as any)?.message || err);
  }

  // B4.3 executive reports, B3 anomaly-bank auto-rebuild, threshold auto-tune,
  // doc 11 KB auto-sync and W3-A weekly integrity scan: MOVED to the W4-D
  // background scheduler set (backgroundJobs.ts) — cron jobs with no
  // socket/event-bus coupling (integrity scan also runs on the jobs DB pool).

  // P2 WS2.3 — Orchestration rules engine (subscribes to the event bus).
  // Disabled by default; opt in via ORCHESTRATION_ENABLED=true. Notify/audit only.
  try {
    const { startOrchestration } = await import("../services/orchestration/rulesEngine");
    startOrchestration();
  } catch (err) {
    console.error("[Orchestration] init failed:", (err as any)?.message || err);
  }

  // doc 13 · F1 — Federation core aggregator: PULLS each enrolled site's KPIs
  // read-only via /api/external/* into the roll-up store (per-site isolation,
  // backoff, circuit breaker, honest staleness). The core NEVER writes to a site.
  // Disabled by default; opt in via FEDERATION_AGGREGATOR_ENABLED=true. Safe
  // no-op when OFF; never blocks boot, never fabricates data.
  try {
    const { startFederationAggregator } = await import("../services/federation/aggregatorService");
    startFederationAggregator();
  } catch (err) {
    console.error("[Federation] aggregator init failed:", (err as any)?.message || err);
  }

  // doc 13 · F3 — Federation UNS subscriber: SUBSCRIBE-ONLY MQTT to each enrolled
  // site's UNS broker (sites.unsBrokerUrl), landing near-real-time KPIs in the
  // roll-up store with source='uns'. Subscribe-only — the core NEVER publishes to
  // a site broker. Disabled by default; opt in via FEDERATION_UNS_ENABLED=true.
  // Safe no-op when OFF or no site has a broker; never blocks boot.
  try {
    const { startFederationUnsSubscriber } = await import("../services/federation/unsSubscriber");
    await startFederationUnsSubscriber();
  } catch (err) {
    console.error("[Federation] UNS subscriber init failed:", (err as any)?.message || err);
  }

  // doc 22 · P2 (Khối 3) — SIMULATED safety-track publisher: periodically synthesises
  // person↔robot proximity tracks and drives them through the EXISTING advisory ingest
  // path (nearMissAdvisor + safety-zone evaluator) so the 3-tier zone evaluator +
  // 'safety:event' socket + Safety Cockpit are exercised end-to-end. Every track is
  // SIMULATED (source 'test'), clearly labelled — NOT a real sensor. Commands NO device,
  // actuates NO stop. Disabled by default; opt in via SAFETY_SIM_TRACKS_ENABLED=true.
  // Advisory events only persist when SAFETY_AUDIT_ENABLED is also on. Safe no-op OFF.
  try {
    const { startSimTrackPublisher } = await import("../services/safety/simTrackPublisher");
    startSimTrackPublisher();
  } catch (err) {
    console.error("[SafetySim] init failed:", (err as any)?.message || err);
  }

  // P4 WS4.2 — AI orchestration watcher (event bus → local LLM advisory).
  // Disabled by default; opt in via AI_ORCHESTRATION_ENABLED=true. Advisory only.
  try {
    const { startAiWatcher } = await import("../services/orchestration/aiWatcher");
    startAiWatcher();
  } catch (err) {
    console.error("[AIWatcher] init failed:", (err as any)?.message || err);
  }

  // AI Auto-Proposer — drafts safe write-actions (NG-burst → adjust threshold) for the
  // responsible users' inbox. PROPOSE-only (HITL); opt in via AI_AUTO_PROPOSE_ENABLED=true.
  try {
    const { startAutoProposer } = await import("../services/aiAutoProposer");
    startAutoProposer();
  } catch (err) {
    console.error("[aiAutoProposer] init failed:", (err as any)?.message || err);
  }

  // W1-3 (doc 25 T2) — Fail-fast: cảnh báo đỏ nếu *_CONTROL_ENABLED=true nhưng
  // *_GATEWAY_ENABLED tắt (control trang bị đường ghi thật nhưng không adapter nào
  // start → lệnh rơi ADAPTER_OFFLINE âm thầm). KHÔNG tự bật gateway (fail-closed).
  try {
    const { logControlGatewayConsistency } = await import("../services/controlGatewayConsistency");
    logControlGatewayConsistency();
  } catch (err) {
    console.error("[ControlGatewayConsistency] check failed:", (err as any)?.message || err);
  }

  // doc 40 Wave 3A (§11 · OT-F2) — Connectivity / flag summary lúc boot. Operator nhìn
  // MỘT log biết đường/gate nào ARMED (đang thật) vs DORMANT (cờ tắt) vs BYPASS (một lớp
  // enforcement bị tắt). Nguồn: cùng ma trận READ-ONLY của readinessRouter (single source
  // of truth). KHÔNG đổi hành vi — chỉ đọc process.env + getter thuần và IN. Toàn bộ chi
  // tiết trực quan xem tại trang /control-readiness (Trust & Enforcement Center).
  try {
    const { collectFlagMatrix } = await import("../routers/readinessRouter");
    const items = collectFlagMatrix();
    const tag = (s: string) =>
      s === "armed" ? "ARMED" : s === "bypass" ? "BYPASS" : s === "warn" ? "WARN " : "dormant";
    const s = {
      armed: items.filter((i) => i.state === "armed").length,
      dormant: items.filter((i) => i.state === "dormant").length,
      bypass: items.filter((i) => i.state === "bypass").length,
      warn: items.filter((i) => i.state === "warn").length,
    };
    console.log(
      `[Readiness] Control/Trust flag summary — ${s.armed} armed · ${s.dormant} dormant · ${s.bypass} bypass · ${s.warn} warn ` +
        `(chi tiết: /control-readiness)`,
    );
    // Chỉ liệt kê những mục CẦN CHÚ Ý (bypass/warn) để log gọn; dormant/armed đã tổng hợp ở trên.
    for (const i of items) {
      if (i.state === "bypass" || i.state === "warn") {
        console.log(`[Readiness]   ${tag(i.state)} · ${i.key} — ${i.reason}`);
      }
    }
  } catch (err) {
    console.error("[Readiness] flag summary failed:", (err as any)?.message || err);
  }

  // P3 — Robotics framework (Fanuc/Mitsubishi/Delta/Techman + sim). Importing the
  // module registers the vendor drivers. Disabled by default; opt in via
  // ROBOT_GATEWAY_ENABLED=true. Motion control is dry-run unless ROBOT_CONTROL_ENABLED=true.
  try {
    const { startRobots } = await import("../services/robot");
    await startRobots();
  } catch (err) {
    console.error("[Robot] init failed:", (err as any)?.message || err);
  }

  // VDA 5050 — AGV/AMR fleet connectivity framework (MQTT). Importing the module
  // registers the `vda5050` robot driver. Disabled by default; opt in via
  // VDA5050_ENABLED=true. AGV commands are HITL + dry-run unless ROBOT_CONTROL_ENABLED=true.
  try {
    const { startVda5050 } = await import("../services/vda5050");
    await startVda5050();
  } catch (err) {
    console.error("[VDA5050] init failed:", (err as any)?.message || err);
  }

  // I3a (doc 20 §3/§5) — ROS2 ↔ platform bridge over rosbridge WebSocket (pure JS, no
  // native ROS2 dep). Subscribes ROS2 telemetry topics → telemetryBus; platform commands
  // still route through robotCommandDispatcher (no new control path). Disabled by default;
  // opt in via ROS2_BRIDGE_ENABLED=true + ROSBRIDGE_URL. HONEST: rosbridge unreachable →
  // logged + connects nothing (never crashes the process, never fabricates a connection).
  try {
    const { startRos2Bridge } = await import("../services/ros2");
    await startRos2Bridge();
  } catch (err) {
    console.error("[ROS2] bridge init failed:", (err as any)?.message || err);
  }

  // G1 — Edge Gateway OPC-UA/Modbus ingest (scaffold).
  // Disabled by default; opt in via OPCUA_GATEWAY_ENABLED=true + OPCUA_ENDPOINT_URL.
  try {
    const { startOpcuaGateway } = await import("../services/opcuaGateway");
    await startOpcuaGateway();
  } catch (err) {
    console.error("[OpcuaGateway] init failed:", (err as any)?.message || err);
  }

  // F1.1 — OT Connectivity Framework (parallel to OPC-UA scaffold above).
  // Disabled by default; opt in via OT_GATEWAY_ENABLED=true.
  try {
    const { startOt } = await import("../services/ot");
    await startOt();
  } catch (err) {
    console.error("[OT] init failed:", (err as any)?.message || err);
  }

  // MTConnect ingestion — poll MTConnect Agents (CNC / machine tools) → telemetry.
  // Additive + parallel to OT framework. No-op unless MTCONNECT_ENABLED=true.
  try {
    const { startMtconnectPoller } = await import("../services/mtconnect/mtconnectPoller");
    await startMtconnectPoller();
  } catch (err) {
    console.error("[MTConnect] init failed:", (err as any)?.message || err);
  }

  // G1.2 (doc 44 W0-D) — IPC-CFX (IPC-2591) telemetry client: subscribe CFX JSON
  // envelopes from SMT machines (mounters / reflow / stencil printers) over AMQP 1.0
  // → CanonicalSample → the ONE unified telemetry bus. INBOUND-ONLY (monitoring, no
  // control path). No-op unless CFX_ENABLED=true + CFX_ENDPOINTS configured. A CFX
  // startup error NEVER crashes the server (mirrors the MTConnect bring-up above).
  try {
    const { startCfxClient } = await import("../services/cfx");
    await startCfxClient();
  } catch (err) {
    console.error("[CFX] init failed:", (err as any)?.message || err);
  }

  // G2.5 (doc 44 W0-E) — Contract Schema Registry: hydrate persisted schemas +
  // seed canonical contracts (contracts/canonical/*.json) through the BACKWARD
  // compat gate. No-op unless CONTRACT_REGISTRY_PERSIST_ENABLED=true; never throws.
  try {
    const { initContractRegistry } = await import("../services/contracts/schemaRegistry");
    await initContractRegistry();
  } catch (err) {
    console.error("[Contracts] registry init failed:", (err as any)?.message || err);
  }

  // W3-A1 (doc 44 G3.13) — Policy store: sync as-code Git→DB + load snapshot.
  // No-op unless POLICY_STORE_ENABLED=true; never throws.
  try {
    const { initPolicyStore } = await import("../services/security/policyStore");
    await initPolicyStore();
  } catch (err) {
    console.error("[Policy] store init failed:", (err as any)?.message || err);
  }

  // F5a — Interlock engine (ALERT-ONLY). No-op unless INTERLOCK_ENGINE_ENABLED=true.
  // SAFETY: this engine raises Andon + records interlock_events ONLY; it has NO
  // path to commandDispatcher / driver.writeTags (auto block/stop → 'skipped').
  try {
    const { startInterlock } = await import("../services/interlock");
    startInterlock();
  } catch (err) {
    console.error("[Interlock] init failed:", (err as any)?.message || err);
  }

  // S2b (doc 20 §2/§5) — Vision human-detection producer + Safety-PLC status adapter.
  // Both are ADVISORY and ON-DEMAND (driven by safety.ingestDetectionFrame /
  // safety.readSafetyPlc), so there is NO persistent poller/socket to start — this
  // block only ANNOUNCES the flag state honestly (no work, no control path). Disabled
  // by default; opt in via SAFETY_VISION_ENABLED / SAFETY_PLC_ADAPTER_ENABLED.
  // HONEST: SAFETY_VISION needs a real camera + calibration + an exported ONNX person
  // model (yolo26n.pt is PyTorch → export to .onnx once); with no backend it produces
  // NOTHING. SAFETY_PLC is READ-ONLY monitoring — the certified Safety PLC performs the
  // rated stop itself in hardware; this only OBSERVES and LOGS advisory events.
  try {
    const { safetyVisionEnabled } = await import("../services/safety/vision/humanDetectionProducer");
    const { safetyPlcAdapterEnabled } = await import("../services/safety/plc/safetyPlcAdapter");
    if (safetyVisionEnabled()) {
      console.log("[SafetyVision] SAFETY_VISION_ENABLED=true — ADVISORY producer ready (on-demand; needs real camera+calibration+ONNX person model; no fabricated detections).");
    }
    if (safetyPlcAdapterEnabled()) {
      console.log("[SafetyPLC] SAFETY_PLC_ADAPTER_ENABLED=true — READ-ONLY status adapter ready (on-demand; sim backend by default; NEVER actuates a rated stop).");
    }
  } catch (err) {
    console.error("[S2b] init failed:", (err as any)?.message || err);
  }

  // G2/G7 PdM work-order closed-loop + G3/G12 DR verify-restore: MOVED to the
  // W4-D background scheduler set (backgroundJobs.ts).

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  const protocol = HTTPS_ENABLED ? "https" : "http";

  // ── R-1 (doc 38): HTTP timeouts — slow-loris / slow-body hardening ──────────
  // requestTimeout bounds the time to receive an ENTIRE request (headers+body).
  // Node clears this timer the moment the request is fully parsed, so long-lived
  // RESPONSES are NOT affected: the SSE stream (/api/stream), socket.io upgrades
  // and any long-poll all complete their request quickly and keep streaming.
  //   • headersTimeout — max time to receive request headers (the primary
  //     slow-loris defense); must sit slightly above requestTimeout.
  //   • keepAliveTimeout — idle window BETWEEN requests on a kept-alive socket.
  // NOTE for operators: requestTimeout also bounds large UPLOADS (200MB APK /
  // AOI ZIP). On a factory LAN a 200MB body finishes well under 60s; if you push
  // very large uploads over a slow WAN, raise HTTP_REQUEST_TIMEOUT_MS accordingly
  // (set 0 to disable the request-receipt bound entirely).
  const httpRequestTimeoutMs = Number(process.env.HTTP_REQUEST_TIMEOUT_MS);
  const httpHeadersTimeoutMs = Number(process.env.HTTP_HEADERS_TIMEOUT_MS);
  server.requestTimeout =
    Number.isFinite(httpRequestTimeoutMs) && httpRequestTimeoutMs >= 0
      ? httpRequestTimeoutMs
      : 60_000;
  server.headersTimeout =
    Number.isFinite(httpHeadersTimeoutMs) && httpHeadersTimeoutMs > 0
      ? httpHeadersTimeoutMs
      : 65_000;
  server.keepAliveTimeout = 61_000;

  server.listen(port, () => {
    logger.info({ port, protocol }, `Server running on ${protocol}://localhost:${port}/`);

    // doc 33 F1 (SYNAPSE ADR-007): report the resolved edition + infra profile (advisory).
    import("./deploymentProfile")
      .then(({ describeDeployment, resolveDeploymentProfile }) => {
        logger.info({ deployment: resolveDeploymentProfile() }, describeDeployment());
      })
      .catch(() => {});

    // Initialize cache warming service
    cacheWarmingService.initialize().catch(err => {
      logger.error({ err }, '[CacheWarming] Failed to initialize');
    });
  });
  
  // Graceful shutdown
  let isShuttingDown = false;

  const gracefulShutdown = (signal: string) => {
    if (isShuttingDown) {
      logger.info("Force exit...");
      process.exit(0);
    }
    isShuttingDown = true;
    logger.info(`${signal} received, shutting down gracefully...`);
    // W4-D (B7): stop the whole cron-scheduler set in one call (covers movers
    // like batch-RCA/predictive/edge/model sweeps/outbox/fleet timers). Every
    // stop is idempotent, so the individual stops below remain harmless.
    import("./backgroundJobs")
      .then((m) => m.stopBackgroundSchedulers())
      .catch(() => {});
    shutdownScheduledReports();
    import("../services/reportScheduler")
      .then((m) => m.stopExecutiveReportScheduler())
      .catch(() => {});
    import("../services/aiAnomalyBankScheduler")
      .then((m) => m.stopAnomalyBankScheduler())
      .catch(() => {});
    import("../services/aiThresholdTuneScheduler")
      .then((m) => m.stopThresholdTuneScheduler())
      .catch(() => {});
    import("../services/kbSyncScheduler")
      .then((m) => m.stopKbSyncScheduler())
      .catch(() => {});
    // W3-A (doc 27) — stop weekly integrity scan (no-op if not running)
    import("../services/integrityScanService")
      .then((m) => m.stopIntegrityScanScheduler())
      .catch(() => {});
    // doc 13 · F1 — stop federation aggregator (no-op if not running)
    import("../services/federation/aggregatorService")
      .then((m) => m.stopFederationAggregator())
      .catch(() => {});
    // doc 13 · F3 — stop federation UNS subscriber (close all per-site connections)
    import("../services/federation/unsSubscriber")
      .then((m) => m.stopFederationUnsSubscriber())
      .catch(() => {});
    // doc 22 · P2 — stop SIMULATED safety-track publisher (no-op if not running)
    import("../services/safety/simTrackPublisher")
      .then((m) => m.stopSimTrackPublisher())
      .catch(() => {});
    shutdownScheduledBackups();
    shutdownRuntimeSecurity();
    cacheWarmingService.stop();
    stopEscalationScheduler();
    stopAlertEvaluatorScheduler();
    // doc 54 §11 P1.2 — stop LIVE daily_statistics rollup (idempotent no-op if the
    // flag was off / it never started). Started in the ROLE!=api block above.
    import("../services/liveStatsRollupService")
      .then((m) => m.stopLiveStatsRollup())
      .catch(() => {});
    if (process.env.MQTT_ENABLED === 'true') {
      // F3b — shutdownMqttBroker() đã lo graceful NDEATH (+DDEATH) best-effort TRƯỚC
      // khi đóng UNS publisher (xem mqttService.shutdownMqttBroker). NBIRTH-on-connect
      // do F3a tự phát lúc kết nối broker UNS — không cần gọi ở đây.
      shutdownMqttBroker();
      stopSummaryScheduler();
    }
    // G1 — dừng edge gateway (no-op nếu chưa chạy)
    import("../services/opcuaGateway")
      .then((m) => m.stopOpcuaGateway())
      .catch(() => {});
    // F1.1 — dừng OT framework (no-op nếu chưa chạy)
    import("../services/ot")
      .then((m) => m.stopOt())
      .catch(() => {});
    // MTConnect — dừng poller (no-op nếu chưa chạy)
    import("../services/mtconnect/mtconnectPoller")
      .then((m) => m.stopMtconnectPoller())
      .catch(() => {});
    // G1.2 — dừng CFX client (no-op nếu chưa chạy)
    import("../services/cfx")
      .then((m) => m.stopCfxClient())
      .catch(() => {});
    // F5a — dừng interlock engine (no-op nếu chưa chạy)
    import("../services/interlock")
      .then((m) => m.stopInterlock())
      .catch(() => {});
    // G2/G7 — dừng PdM work-order scheduler (no-op nếu chưa chạy)
    import("../services/pdmWorkOrderService")
      .then((m) => m.stopPdmWorkOrderService())
      .catch(() => {});
    // G3/G12 — dừng DR verify-restore (no-op nếu chưa chạy)
    import("../services/disasterRecoveryService")
      .then((m) => m.stopDisasterRecoveryService())
      .catch(() => {});
    // P1 WS1.1 — dừng data retention sweeper (no-op nếu chưa chạy)
    import("../services/dataRetentionService")
      .then((m) => m.stopDataRetention())
      .catch(() => {});
    // Doc 27 #2/#5 — dừng image lifecycle (no-op nếu chưa chạy)
    import("../services/imageLifecycleService")
      .then((m) => m.stopImageLifecycle())
      .catch(() => {});
    // Doc 27 C1 (W2-A) — dừng hot-folder watchers (no-op nếu chưa chạy)
    import("../services/vision/hotFolderService")
      .then((m) => m.stopHotFolderIngest())
      .catch(() => {});
    // P2 WS2.3 — dừng orchestration rules engine (no-op nếu chưa chạy)
    import("../services/orchestration/rulesEngine")
      .then((m) => m.stopOrchestration())
      .catch(() => {});
    // P3 — dừng robotics framework (no-op nếu chưa chạy)
    import("../services/robot")
      .then((m) => m.stopRobots())
      .catch(() => {});
    // VDA 5050 — dừng AGV adapter manager (no-op nếu chưa chạy)
    import("../services/vda5050")
      .then((m) => m.stopVda5050())
      .catch(() => {});
    // P4 WS4.2 — dừng AI orchestration watcher (no-op nếu chưa chạy)
    import("../services/orchestration/aiWatcher")
      .then((m) => m.stopAiWatcher())
      .catch(() => {});
    import("../services/aiAutoProposer")
      .then((m) => m.stopAutoProposer())
      .catch(() => {});
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
    // Force exit after 5s if server.close() hangs (e.g. WebSocket/MQTT connections)
    setTimeout(() => {
      logger.info("Forcing exit after timeout...");
      process.exit(0);
    }, 5000).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Global error handlers to prevent silent crashes
  process.on("unhandledRejection", (reason, promise) => {
    logger.error({ err: reason }, "Unhandled Promise Rejection");
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught Exception");
    // Give time to flush logs, then exit
    setTimeout(() => process.exit(1), 1000);
  });
}

startServer().catch(console.error);
