import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.MONITOR_BASE_URL || "http://localhost:3000";
const DURATION_MINUTES = Number(process.env.MONITOR_DURATION_MINUTES || 15);
const INTERVAL_SECONDS = Number(process.env.MONITOR_INTERVAL_SECONDS || 30);
const TIMEOUT_MS = Number(process.env.MONITOR_TIMEOUT_MS || 8000);
const PATHS = (process.env.MONITOR_PATHS || "/health,/api/network/health,/ai-inspection-analytics")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUTPUT_FILE = process.env.MONITOR_OUTPUT || path.join(
  "monitoring",
  `ai-analytics-rollout-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`
);

const authHeaders = {};
if (process.env.MONITOR_AUTH_BEARER) {
  authHeaders.Authorization = `Bearer ${process.env.MONITOR_AUTH_BEARER}`;
}
if (process.env.MONITOR_AUTH_COOKIE) {
  authHeaders.Cookie = process.env.MONITOR_AUTH_COOKIE;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithMetrics(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json,text/html,*/*",
        ...authHeaders,
      },
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    const body = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
      bodySize: body.length,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      bodySize: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function ensureOutputDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function run() {
  ensureOutputDir(OUTPUT_FILE);

  const totalIterations = Math.max(1, Math.ceil((DURATION_MINUTES * 60) / INTERVAL_SECONDS));

  console.log(`[monitor] baseUrl=${BASE_URL}`);
  console.log(`[monitor] durationMinutes=${DURATION_MINUTES}, intervalSeconds=${INTERVAL_SECONDS}`);
  console.log(`[monitor] paths=${PATHS.join(", ")}`);
  console.log(`[monitor] output=${OUTPUT_FILE}`);

  let totalChecks = 0;
  let totalFailures = 0;

  for (let i = 0; i < totalIterations; i += 1) {
    const timestamp = new Date().toISOString();

    for (const endpointPath of PATHS) {
      const url = new URL(endpointPath, BASE_URL).toString();
      const result = await fetchWithMetrics(url);
      totalChecks += 1;
      if (!result.ok) totalFailures += 1;

      const row = {
        timestamp,
        endpointPath,
        url,
        ...result,
      };

      fs.appendFileSync(OUTPUT_FILE, `${JSON.stringify(row)}\n`, "utf8");

      const statusLabel = result.ok ? "OK" : "FAIL";
      console.log(
        `[monitor][${statusLabel}] ${endpointPath} status=${result.status} latency=${result.latencyMs}ms error=${result.error || "none"}`
      );
    }

    if (i < totalIterations - 1) {
      await sleep(INTERVAL_SECONDS * 1000);
    }
  }

  const availability = totalChecks > 0 ? ((totalChecks - totalFailures) / totalChecks) * 100 : 0;

  const summary = {
    type: "summary",
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    totalChecks,
    totalFailures,
    availability: Number(availability.toFixed(2)),
    durationMinutes: DURATION_MINUTES,
    intervalSeconds: INTERVAL_SECONDS,
    paths: PATHS,
  };

  fs.appendFileSync(OUTPUT_FILE, `${JSON.stringify(summary)}\n`, "utf8");

  console.log("[monitor] completed");
  console.log(`[monitor] availability=${summary.availability}% checks=${summary.totalChecks} failures=${summary.totalFailures}`);
  console.log(`[monitor] saved=${OUTPUT_FILE}`);

  if (summary.availability < Number(process.env.MONITOR_MIN_AVAILABILITY || 99)) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("[monitor] fatal error", error);
  process.exit(1);
});
