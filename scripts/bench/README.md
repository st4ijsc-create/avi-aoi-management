# scripts/bench — SYNAPSE ingest benchmark harness (doc 44 W7-3 · G1.19 / G2.20)

Release-gate load generator + measurement + scoring. Runs with **zero
infrastructure** (dry mode proves the tool) or against a **live ingest endpoint**
(http mode measures the real SLIs). See `docs/BENCHMARK.md` for the full guide and
release-gate thresholds.

## Quick start

```bash
# 0. wiring check (no load, no infra)
node scripts/bench/bench-ingest.mjs --selfcheck

# 1. dry run — proves harness + percentile math (NO DB/broker; latency = harness overhead)
node scripts/bench/bench-ingest.mjs --mode dry --tags 20000 --rate 100000 --duration 10 --label dry-1

# 2. score any result against the release-gate SLOs
node scripts/bench/bench-report.mjs scripts/bench/results/dry-1.json
node scripts/bench/bench-report.mjs scripts/bench/results/dry-1.json --gate   # exit 1 on a hard-gate fail

# 3. REAL SLI — against a live ingest route + a queryable read route
node scripts/bench/bench-ingest.mjs --mode http \
  --target http://127.0.0.1:3000/api/ot/ingest \
  --query-url http://127.0.0.1:3000/api/ot/telemetry/recent \
  --rate 5000 --duration 30 --label http-1

# 4. soak + chaos (reuses Full-Sim control-plane, doc 40/41)
node scripts/bench/bench-ingest.mjs --mode http --target ... --duration 86400 \
  --chaos-control http://127.0.0.1:4899 --chaos-every 300 --label soak-1
```

## Flags (bench-ingest.mjs)

| flag | default | meaning |
|---|---|---|
| `--mode` | `dry` | `dry` (no infra) or `http` (POST to `--target`) |
| `--tags` | `20000` | distinct synthetic tags (device×metric) — G1.19 = 20k/gateway |
| `--rate` | `100000` | target points/sec |
| `--duration` | `10` | run length (seconds); `86400` = 24h soak |
| `--batch` | `500` | samples per publish |
| `--seed` | `1337` | PRNG seed → reproducible load |
| `--target` | – | ingest URL (http mode, required) |
| `--query-url` | – | read URL to measure real tag→queryable latency |
| `--chaos-control` | – | Full-Sim control-plane URL for chaos injection |
| `--chaos-every` | `20` | seconds between chaos actions |
| `--label` / `--out` | timestamp | result file name / path |

Results are written to `scripts/bench/results/<label>.json` (git-ignored).

## What each mode proves (honesty)

- **dry** — the harness + the percentile/gate math end-to-end. It never touches a
  DB or broker, so the latency it reports is labelled `harness` (NOT a real
  ingest→query number). Single-thread throughput ≪ 100k is expected here.
- **http** — real HTTP ack latency, and with `--query-url` the real
  **tag→queryable** SLI (the G2.20 signal). Reaching 100k msg/s needs the streaming
  bus + broker/Timescale infra from doc 44 §10 (owner/ops).
