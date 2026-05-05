import fs from "node:fs";

const filePath = process.argv[2] || process.env.MONITOR_FILE;
if (!filePath) {
  console.error("Usage: node scripts/analyze-ai-analytics-metrics.mjs <jsonl-file>");
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`[analyze] file not found: ${filePath}`);
  process.exit(1);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const lines = fs
  .readFileSync(filePath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter((row) => row.type !== "summary");

if (!lines.length) {
  console.error("[analyze] no data rows found");
  process.exit(1);
}

const grouped = new Map();
for (const row of lines) {
  const key = row.endpointPath;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
}

let hasSLOViolation = false;
const minAvailability = Number(process.env.MONITOR_MIN_AVAILABILITY || 99);
const maxP95Ms = Number(process.env.MONITOR_MAX_P95_MS || 1500);

console.log(`[analyze] source=${filePath}`);
console.log(`[analyze] slo minAvailability=${minAvailability}% maxP95Ms=${maxP95Ms}`);

for (const [endpointPath, rows] of grouped.entries()) {
  const latencies = rows.map((r) => Number(r.latencyMs || 0));
  const failures = rows.filter((r) => !r.ok).length;
  const availability = ((rows.length - failures) / rows.length) * 100;

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  const violatesAvailability = availability < minAvailability;
  const violatesP95 = p95 > maxP95Ms;
  if (violatesAvailability || violatesP95) {
    hasSLOViolation = true;
  }

  console.log("-");
  console.log(`[endpoint] ${endpointPath}`);
  console.log(`  checks=${rows.length} failures=${failures} availability=${availability.toFixed(2)}%`);
  console.log(`  latencyMs p50=${p50} p95=${p95} p99=${p99}`);
  console.log(`  slo availability=${violatesAvailability ? "FAIL" : "OK"}, p95=${violatesP95 ? "FAIL" : "OK"}`);
}

if (hasSLOViolation) {
  console.error("[analyze] SLO violation detected");
  process.exit(1);
}

console.log("[analyze] all SLO checks passed");
