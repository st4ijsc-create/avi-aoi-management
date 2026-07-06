/**
 * OpenTelemetry bridge — SYNAPSE §5.12.1 (doc 33 §11 / H2 completion).
 *
 * Bridges the F6 correlation backbone + decision-trace onto OpenTelemetry SPANS, so the OTLP export
 * already scaffolded in server/_core/observability.ts carries SYNAPSE's correlation_id / causation_id
 * and the "why-this-decision" signal as first-class span attributes — the piece H2 deferred
 * ("correlation backbone đã có, chỉ thiếu exporter dep").
 *
 * DESIGN — this is an OTel *library* bridge, not the SDK:
 *  - Depends on `@opentelemetry/api` ONLY (the tiny, stable, zero-dep tracer API), loaded via a
 *    dynamic import so build + runtime succeed whether or not it is installed. Without a registered
 *    SDK the OTel API is ITSELF a no-op, so this is ZERO runtime cost and safe by default.
 *  - Gated by OBSERVABILITY. It lights up end-to-end only when the operator installs the OTel SDK
 *    (per observability.ts — which pulls `@opentelemetry/api` transitively) and points
 *    OTEL_EXPORTER_OTLP_ENDPOINT at a Tempo/Jaeger collector.
 */
import { getCorrelationContext, getCorrelationId } from "./correlation";
import type { DecisionTrace } from "./decisionTrace";

// The `@opentelemetry/api` `trace` namespace once loaded (else null → pure no-op).
type TraceApi = { getTracer: (name: string, version?: string) => any } | null;
let traceApi: TraceApi = null;
let loadStarted = false;

const TRACER_NAME = "synapse";
// OTel SpanStatusCode: 0=UNSET 1=OK 2=ERROR (inlined to avoid importing the enum before load).
const STATUS_OK = 1;
const STATUS_ERROR = 2;

function observabilityEnabled(): boolean {
  return process.env.OBSERVABILITY === "true" || process.env.OBSERVABILITY === "1";
}

/**
 * Load `@opentelemetry/api` once, caching its `trace` API (or leaving the no-op). Idempotent, never
 * throws. Fired at module load; also exported so a bootstrap can await it deterministically.
 */
export async function initOtelBridge(): Promise<boolean> {
  if (loadStarted) return traceApi != null;
  loadStarted = true;
  try {
    const pkg = "@opentelemetry/api";
    const mod: any = await import(pkg).catch(() => null);
    traceApi = mod?.trace ?? null;
  } catch {
    traceApi = null;
  }
  return traceApi != null;
}

/** The SYNAPSE tracer, or null when OBSERVABILITY is off / the OTel API isn't loaded. */
function tracer(): any | null {
  if (!observabilityEnabled() || !traceApi) return null;
  try {
    return traceApi.getTracer(TRACER_NAME);
  } catch {
    return null;
  }
}

export interface SpanCtx {
  correlationId?: string;
  causationId?: string;
  attributes?: Record<string, string | number | boolean>;
}

/** Correlation-aware attributes stamped on every SYNAPSE span (pulls the current ALS context). */
function correlationAttrs(ctx?: SpanCtx): Record<string, string | number | boolean> {
  const cc = getCorrelationContext();
  const attrs: Record<string, string | number | boolean> = { ...(cc?.attributes ?? {}), ...(ctx?.attributes ?? {}) };
  const cid = ctx?.correlationId ?? getCorrelationId();
  if (cid) attrs["synapse.correlation_id"] = cid;
  const causation = ctx?.causationId ?? cc?.causationId;
  if (causation) attrs["synapse.causation_id"] = causation;
  return attrs;
}

/**
 * Run `fn` inside a SYNAPSE span carrying the correlation context. No-op passthrough when OTel /
 * OBSERVABILITY is off. Records exceptions and always ends the span.
 */
export async function withSpan<T>(name: string, ctx: SpanCtx | undefined, fn: () => Promise<T> | T): Promise<T> {
  const tr = tracer();
  if (!tr) return await fn();
  return await tr.startActiveSpan(name, async (span: any) => {
    try {
      for (const [k, v] of Object.entries(correlationAttrs(ctx))) span.setAttribute(k, v);
      const out = await fn();
      span.setStatus({ code: STATUS_OK });
      return out;
    } catch (err: any) {
      span.recordException?.(err);
      span.setStatus({ code: STATUS_ERROR, message: err?.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Emit a one-shot span for a recorded decision-trace (bridges F6 → OTel). Registered as part of the
 * decision sink; safe no-op by default. Never throws into the recording caller.
 */
export function emitDecisionSpan(trace: DecisionTrace): void {
  const tr = tracer();
  if (!tr) return;
  try {
    const span = tr.startSpan(`decision.${trace.decisionType}`, { startTime: trace.ts });
    span.setAttribute("synapse.decision_type", trace.decisionType);
    span.setAttribute("synapse.subject", trace.subject);
    if (trace.chosen != null) span.setAttribute("synapse.chosen", trace.chosen);
    span.setAttribute("synapse.candidates", trace.candidates.length);
    span.setAttribute("synapse.version", trace.version);
    if (trace.correlationId) span.setAttribute("synapse.correlation_id", trace.correlationId);
    span.end();
  } catch {
    /* observability is best-effort */
  }
}

// Kick off the (best-effort) API load at import so the tracer is ready shortly after startup,
// regardless of whether an explicit bootstrap calls initOtelBridge().
void initOtelBridge();
