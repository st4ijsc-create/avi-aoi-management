// scripts/bench/lib/drivers.mjs
// ─────────────────────────────────────────────────────────────────────────────
// doc 44 W7-3 (G1.19 / G2.20) — ingest DRIVERS for the benchmark harness.
//
// A driver receives synthetic sample batches and delivers them to a "sink". Two
// honest sinks:
//   • nullDriver  — measures the HARNESS itself (gen → serialize → optional
//                   synthetic sink delay). NO real queryable path exists, so the
//                   latency it reports is labelled `harness` (tool self-proof; runs
//                   with ZERO infrastructure).
//   • httpDriver  — POSTs each batch to a REAL ingest endpoint (e.g. the app's
//                   OT ingest route or the sim inspection route). Measures HTTP
//                   ack latency; when a queryUrl is given it also measures the
//                   REAL tag→queryable latency via unique probe markers.
//
// Both never fabricate results: httpDriver reports exactly what the server
// returned (2xx / 4xx / 5xx / network error). nullDriver states plainly that it
// did not touch a database.
// ─────────────────────────────────────────────────────────────────────────────

import { performance } from "node:perf_hooks";

const now = () => performance.now();

/**
 * nullDriver — in-process measurement only. Serializes each batch (real CPU cost)
 * and applies an optional synthetic per-batch delay so the percentile pipeline
 * has non-trivial input to summarize. Records per-batch processing latency (ms).
 */
export function nullDriver({ syntheticDelayMs = 0 } = {}) {
  const ackLatencies = [];
  let sent = 0;
  return {
    kind: "null",
    latencyKind: "harness", // NOT a real ingest→query latency
    async send(batch) {
      const t0 = now();
      // Real serialization cost (what a network driver would pay before I/O).
      const bytes = Buffer.byteLength(JSON.stringify(batch), "utf8");
      if (syntheticDelayMs > 0) await new Promise((r) => setTimeout(r, syntheticDelayMs));
      const t1 = now();
      sent += batch.length;
      ackLatencies.push(t1 - t0);
      return { ok: true, count: batch.length, bytes };
    },
    stats() {
      return { sent, ackLatencies, tagToQueryLatencies: [], errors: 0, http: null };
    },
  };
}

/**
 * httpDriver — POST batches to a real ingest endpoint. `body(batch)` shapes the
 * request body for the target route (default: `{ samples: batch }`). Optional
 * `queryUrl` + `probe` enable real tag→queryable latency: a probe sample carries
 * a unique marker; after send we poll queryUrl until the marker is queryable.
 */
export function httpDriver({
  target,
  method = "POST",
  headers = { "content-type": "application/json" },
  body = (batch) => ({ samples: batch }),
  queryUrl = null,
  probeIntervalBatches = 0, // 0 = no queryable probing
  probePollMs = 100,
  probeTimeoutMs = 5000,
} = {}) {
  if (!target) throw new Error("httpDriver requires { target } URL");
  const ackLatencies = [];
  const tagToQueryLatencies = [];
  let sent = 0;
  let errors = 0;
  let batchNo = 0;
  const httpStatus = {};

  async function pollQueryable(marker, sentAtMs) {
    const deadline = now() + probeTimeoutMs;
    while (now() < deadline) {
      try {
        const res = await fetch(`${queryUrl}${queryUrl.includes("?") ? "&" : "?"}marker=${encodeURIComponent(marker)}`);
        if (res.ok) {
          const txt = await res.text();
          if (txt && txt.includes(marker)) {
            tagToQueryLatencies.push(now() - sentAtMs);
            return true;
          }
        }
      } catch {
        /* keep polling until timeout */
      }
      await new Promise((r) => setTimeout(r, probePollMs));
    }
    return false; // never became queryable within timeout — honest miss, not a fake
  }

  return {
    kind: "http",
    latencyKind: "http-ack", // real network ack; queryable added when queryUrl set
    async send(batch) {
      batchNo++;
      const t0 = now();
      let marker = null;
      let payloadBatch = batch;
      if (queryUrl && probeIntervalBatches > 0 && batchNo % probeIntervalBatches === 0) {
        marker = `bench-${Date.now()}-${batchNo}`;
        // Tag the last sample with the probe marker in meta (non-destructive).
        payloadBatch = batch.slice();
        const last = { ...payloadBatch[payloadBatch.length - 1] };
        last.meta = { ...(last.meta || {}), benchMarker: marker };
        payloadBatch[payloadBatch.length - 1] = last;
      }
      try {
        const res = await fetch(target, {
          method,
          headers,
          body: JSON.stringify(body(payloadBatch)),
        });
        const t1 = now();
        ackLatencies.push(t1 - t0);
        httpStatus[res.status] = (httpStatus[res.status] || 0) + 1;
        if (res.ok) sent += batch.length;
        else errors += batch.length;
        if (marker) {
          // fire-and-forget probe measurement (does not block the send loop)
          void pollQueryable(marker, t0);
        }
        return { ok: res.ok, status: res.status, count: batch.length };
      } catch (e) {
        errors += batch.length;
        ackLatencies.push(now() - t0);
        return { ok: false, error: e?.message ?? String(e), count: batch.length };
      }
    },
    // Allow the harness to wait out any in-flight queryable probes at the end.
    async drainProbes() {
      if (!queryUrl) return;
      await new Promise((r) => setTimeout(r, probeTimeoutMs + probePollMs));
    },
    stats() {
      return { sent, ackLatencies, tagToQueryLatencies, errors, http: httpStatus };
    },
  };
}

/**
 * Fire a Full-Sim chaos action (doc 40/41 control-plane) during a soak run, e.g.
 * kill/restart an OPC-UA line. Best-effort; a chaos-control failure never aborts
 * the benchmark (returns { ok:false }). See scripts/sim-factory/simulator.mjs.
 */
export async function simChaos(controlUrl, action, params = {}) {
  try {
    const res = await fetch(`${controlUrl}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, action, ...json };
  } catch (e) {
    return { ok: false, action, error: e?.message ?? String(e) };
  }
}
