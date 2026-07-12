# SYNAPSE Ingest Benchmark & Release Gate

doc 44 W7-3 — gaps **G1.19** (benchmark ≥20k tag/gateway, publish the numbers) and
**G2.20** (real SLI ingest→queryable + load-test to 100k msg/s + soak). This is the
**tooling + method**; the published numbers come from running it on the target
hardware/infra.

Tool: [`scripts/bench/`](../scripts/bench/README.md) — a self-contained ESM harness
(`bench-ingest.mjs` load-gen + measurement, `bench-report.mjs` scoring). It runs
without a real factory: **dry mode** proves the tool with zero infra; **http mode**
measures the real SLIs against a live instance (optionally under Full-Sim load,
doc 40/41).

---

## 1. Release-gate SLOs (single source of truth)

From doc 44 §9/§10 + LDS-L1/L2 objectives. Encoded in `bench-report.mjs`
(`SLO_GATES`) so the gate and the docs never drift:

| Gate | Threshold | Source |
|---|---|---|
| tag→UNS P95 | ≤ 250 ms | LDS-L1 SLO `tag→UNS P95≤250ms` |
| tag→UNS P99 | ≤ 250 ms | doc 44 §10 "UNS 100k msg/s **P99≤250ms**" |
| ingest→queryable P95 | ≤ 1000 ms | LDS-L2 "ingest→query ≤1s" |
| throughput | ≥ 100 000 pts/s | LDS-L2 "≥100k điểm/s" |
| error rate | ≤ 0.1 % | operability floor |

Release checklist (doc 44 §10 §"Load-test cửa release"): **100k msg/s P99≤250ms ·
dispatch P95≤500ms · 60 robot/zone 24h no deadlock · chaos suite green**. This
harness covers the ingest/UNS throughput+latency legs and drives the chaos suite via
Full-Sim; dispatch-latency and robot-deadlock legs are separate campaigns.

---

## 2. How to run

### 2a. Wiring check (no infra)
```bash
node scripts/bench/bench-ingest.mjs --selfcheck
```

### 2b. Dry run — prove the harness + math
```bash
node scripts/bench/bench-ingest.mjs --mode dry --tags 20000 --rate 100000 --duration 10 --label dry-1
node scripts/bench/bench-report.mjs scripts/bench/results/dry-1.json
```
Dry mode touches **no DB/broker** — its latency is labelled `harness` (tool overhead,
not ingest→query) and single-thread throughput is far below 100k **by design**. It
exists to prove the load generator + percentile/gate math are correct and
reproducible before you spend infra on a real run.

### 2c. Real SLI — http mode against a live instance
```bash
node scripts/bench/bench-ingest.mjs --mode http \
  --target   http://127.0.0.1:3000/<ingest-route> \
  --query-url http://127.0.0.1:3000/<recent-read-route> \
  --rate 5000 --duration 30 --label http-1
node scripts/bench/bench-report.mjs scripts/bench/results/http-1.json --gate
```
- `--target` receives `POST { samples: [...] }` batches (override the body shaper in
  `lib/drivers.mjs` for a different route contract).
- `--query-url` is polled for a unique probe marker after each probed batch → this is
  the **real tag→queryable latency** (the G2.20 signal). The probe marker rides in
  the last sample's `meta.benchMarker`; the read route must echo it back (e.g. a
  "recent telemetry" endpoint filtered by `?marker=`).
- Reaching the full 100k msg/s gate requires the streaming-bus + broker + Timescale
  infra (doc 44 §10 owner/ops items G2.4/G2.7/G2.10). Below that, http mode still
  gives honest partial numbers at the rate you can drive.

### 2d. Soak + chaos (reuse Full-Sim, doc 40/41)
```bash
# 24h soak, killing/restarting OPC-UA lines every 5 min via the sim control-plane
node scripts/bench/bench-ingest.mjs --mode http --target ... --query-url ... \
  --duration 86400 --chaos-control http://127.0.0.1:4899 --chaos-every 300 --label soak-1
```
Watch `resources.peakRssMib` across the run for leaks; `chaos[]` logs every injected
kill/restart and whether ingest recovered.

---

## 3. Result format (published number)

`bench-ingest.mjs` writes `scripts/bench/results/<label>.json`:

```jsonc
{
  "schemaVersion": 1,
  "label": "http-1",
  "mode": "http",
  "latencyKind": "http-ack",
  "config":     { "tags": 20000, "targetRate": 100000, "durationSec": 30, ... },
  "hardware":   { "cpu": "...", "cpuCores": 24, "totalMemGb": 63.8, "platform": "..." },
  "throughput": { "pointsSent": 3000000, "achievedPerSec": 98750.2, "achievedPct": 98.8, ... },
  "ackLatencyMs":  { "n": ..., "p50": ..., "p95": ..., "p99": ..., "p999": ..., "max": ... },
  "tagToQueryMs":  { "n": ..., "p95": ..., "p99": ... },   // null in dry mode / no --query-url
  "resources":  { "cpuPct": ..., "peakRssMib": ... },
  "errors": 0,
  "chaos":  [ { "atMs": ..., "action": "opcua.kill", "line": 1, "ok": true }, ... ]
}
```

`bench-report.mjs` renders a publishable table + PASS/FAIL per gate + the
release-gate checklist (HiveMQ/EMQX-report style). Percentiles use linear
interpolation between closest ranks (`scripts/bench/lib/stats.mjs`, unit-tested).

**Publishing convention:** commit the report table + the `hardware`/`config` block
alongside the release notes so the number is reproducible (`--seed` fixes the load).

---

## 4. What is / isn't measured yet

| Leg | Tool support | Needs (owner/ops) |
|---|---|---|
| load generation ≥20k tag, reproducible | ✅ done | — |
| percentile / gate scoring | ✅ done, unit-tested | — |
| HTTP ack latency | ✅ http mode | a running instance |
| **tag→queryable SLI** | ✅ http + `--query-url` | Timescale active (G2.10) + a recent-read route |
| **100k msg/s sustained** | ✅ can drive load | streaming bus (G2.7) + broker cluster (G2.4) + app scale-out |
| chaos suite | ✅ drives Full-Sim | Full-Sim running (doc 40/41) |
| dispatch P95 ≤ 500ms · 60-robot 24h | ✗ separate campaign | command_log SLI + robot fleet sim |

The harness is the reusable measurement rig; the ≥95-point numbers land once the
W0 infra (Timescale cutover, EMQX cluster, NATS JetStream) is in place.
