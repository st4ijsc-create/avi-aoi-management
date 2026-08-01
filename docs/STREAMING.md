# SYNAPSE Streaming Bus & Stream Processing

doc 44 W4 — gaps **G2.7** (durable streaming log + replay/reprocessing) and
**G2.8** (stream processor: enrich · event-time window + watermark · derived
`_line` · `corrected` on backfill). SYNAPSE_Tang2 Chương 7. DEVPLAN **D2**: NATS
JetStream first, Kafka when the Site edition scales — behind an abstraction so the
swap is a config flip.

Code: [`server/services/streaming/`](../server/services/streaming/).

---

## 1. Architecture — one abstraction, foldable backends

```
producers ──┐                                  ┌── StreamProcessor (G2.8)
 telemetryBus│   ┌───────────────────────────┐ │     enrich → window → derive
 (via tap)   ├──►│      StreamBridge          │─┤     → syn/derived/_line
 any service │   │  publish/subscribe/replay  │ │
             │   └───────────────────────────┘ └── future: lake sink, consumer groups
             │        │                 │
             │  inProcessAdapter   natsAdapter (SEAM)
             │  (ring buffer,      (JetStream — needs `npm i nats`)
             │   here & now)        cross-process durable log
```

`StreamBridge` (`streamBridge.ts`) is the contract every producer/consumer binds
to — **not** a concrete broker (ADR-007 foldable architecture: nothing assumes
Kafka/NATS exists). Two adapters implement the SAME interface, so consumer code is
identical on either:

| | `inProcessAdapter` (default) | `natsAdapter` (seam) |
|---|---|---|
| Backend | in-memory ring buffer | NATS JetStream |
| Durability | bounded, **in-session** | cross-process, persistent |
| Replay | `replay(topic, fromSeq)` from the ring | JetStream by-start-sequence |
| Infra | **none** — works now | `npm i nats` + a NATS server |
| Edition | Machine / Line (1 process) | Site (scale-out, HA) |

### Interface (`StreamBridge`)
```ts
publish(topic, payload, opts?)  → { ok, seq }        // append; per-topic monotonic seq
subscribe(topic, handler, {fromSeq?})                // live; optional replay-then-live
replay(topic, fromSeq, handler) → { delivered, toSeq, truncated? }
available() / close()
```
Topics are hierarchical with `/` (e.g. `syn/telemetry/l1`) and support a trailing
`*` wildcard (`syn/telemetry/*`). The NATS adapter maps `/`→`.` and `/*`→`.>`.

---

## 2. What works right now (in-process) vs needs infra (NATS)

**Works now, zero infra** (`STREAM_BRIDGE_BACKEND=inprocess`, the default):
- Durable-log semantics **within one process**: monotonic per-topic `seq`, bounded
  ring buffer (`STREAM_RING_MAX`, default 50 000 msgs, oldest evicted), and
  in-session `replay(fromSeq)` (with an honest `truncated:true` when the ring already
  evicted the requested range).
- The **stream processor** (enrich → event-time window + watermark → derived
  `_line` with `corrected`) runs entirely on the in-process bridge — correct for the
  Machine/Line edition where everything is one Node process.
- Optional `telemetryBus → bridge` tap (`telemetryStreamTap.ts`) so real ingested
  telemetry flows onto the bus for reprocessing **without a second reader** and
  **without modifying `telemetryBus.ts`** (it uses the existing `registerTelemetryTap`
  observer seam).

**Needs infra** (`STREAM_BRIDGE_BACKEND=nats`):
- Cross-process / cross-instance durability, consumer groups, retention beyond the
  in-memory ring, replay across restarts. The `natsAdapter` is an **honest seam**: it
  refuses every op with `NATS_NOT_AVAILABLE` until an owner installs the `nats` client
  and wires the marked seams (see §4). It never fakes cross-process durability
  (same posture as `samlProvider` / `busFanout`).

---

## 3. Stream processor (G2.8)

`streamProcessor.ts` = a pure core + an I/O shell.

- **`WatermarkWindower`** (pure, unit-tested): tumbling windows on **event time**
  (`sample.ts`, not wall clock). A window closes only once the **watermark**
  (`maxEventTs − allowedLateness`) passes its end. A sample arriving after its window
  closed but still within retention **reopens** the window → it re-emits with
  `corrected: true` (backfill correction). A sample past the retention horizon is
  **dropped** (`dropped-late`) — honest, bounded memory. Dedup by
  `(assetId, ts, seq)` → replayed/duplicated samples never double-count (mirrors the
  `ot_telemetry` unique key, G2.9).
- **`StreamProcessor`** (I/O): subscribes to `syn/telemetry/*`, **enriches** each
  asset → `{site, area, line, product, shift}` (injectable resolver; default parses
  `…-L{n}-…`, else `unassigned` — never fabricated; production wiring uses
  `isa95Resolver`/registry), rolls per-asset windows up **per line**, and emits a
  derived `_line/state` payload (shape aligned with `unsAggregates` W2-A1 so downstream
  is consistent). It complements the DB-driven periodic `unsAggregates` with a
  live, event-time, backfill-correcting stream path.

Derived `_line` payload (per line, per closed window):
```jsonc
{
  "path": "hanoi/smt/l1/_line",
  "state": "EXECUTE",
  "window": { "from": "...", "to": "...", "event_time": true },
  "values": { "event_count": 120, "throughput_per_min": 120, "ng_count": 6, "ng_rate_pct": 5 },
  "corrected": false,                          // true on a late-data re-emit
  "metric_source": "streamProcessor(event-time window + watermark)"
}
```
`ng_rate_pct` is honest-null when no outcome info was present.

---

## 4. Enabling the real NATS backend (owner)

1. `npm i nats` (or `pnpm add nats`) — **new dependency, currently NOT installed**.
2. Run a NATS server with JetStream (`nats-server -js`) and set `NATS_URL`.
3. Set `STREAM_BRIDGE_BACKEND=nats` (+ optional `NATS_STREAM_PREFIX`, default `syn`).
4. Wire the seams marked `SEAM:` in `natsAdapter.ts`:
   `connect(NATS_URL)` → `jsm.streams.add({ subjects:[`${prefix}.>`] })` →
   `js.publish(subject, payload, { msgID })` (idempotent append) → `js.subscribe`
   with `deliver_policy: by_start_sequence` for replay. `topicToSubject()` already
   maps topics→subjects. No producer/consumer code changes.

Until then the platform runs on the in-process bridge (fully functional for a single
process); the NATS backend is the Site-edition scale path.

---

## 5. Flags / env (all default to the zero-infra path)

| Env | Default | Effect |
|---|---|---|
| `STREAM_BRIDGE_BACKEND` | `inprocess` | `inprocess` \| `nats` |
| `STREAM_RING_MAX` | `50000` | in-process ring capacity (messages) |
| `NATS_URL` | – | NATS server URL (nats backend) |
| `NATS_STREAM_PREFIX` | `syn` | JetStream stream/subject prefix |
| `STREAM_PROCESSOR_ENABLED` | `false` | start the stream processor |
| `STREAM_PROCESSOR_WINDOW_MS` | `60000` | tumbling window size |
| `STREAM_PROCESSOR_LATENESS_MS` | `30000` | watermark lateness + retention |
| `STREAM_PROCESSOR_TOPIC` | `syn/telemetry/*` | source subscription |
| `STREAM_PROCESSOR_EMIT_TOPIC` | `syn/derived/_line` | derived-node topic prefix |
| `STREAM_TELEMETRY_TAP_ENABLED` | `false` | wire telemetryBus → bridge |

All new flags are **OFF/safe by default** — the streaming subsystem adds zero
overhead and zero behaviour change until explicitly enabled.

---

## 6. Tests

- `streamBridge.test.ts` — topic matching, per-topic seq, live delivery, `replay`,
  bounded-ring eviction + truncation, backend factory selection.
- `natsAdapter.test.ts` — honest `NATS_NOT_AVAILABLE` refusal, topic→subject mapping.
- `streamProcessor.test.ts` — tumbling + watermark, late-data `corrected`, retention
  drop, idempotency, per-line rollup + emit (mocked enrich).
- `benchStats.test.ts` — bench percentile/gate math + load-gen determinism.
