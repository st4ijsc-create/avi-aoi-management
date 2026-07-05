/**
 * Correlation-id backbone — SYNAPSE §5.12.1 (doc 33 §3.4 / F6 · H2).
 *
 * A single correlation_id flowing order → work-order → task → assignment → robot-command → ack
 * (SDD §5.12.1) — implemented with Node's built-in AsyncLocalStorage, so it works WITHOUT the
 * heavy OpenTelemetry SDK (full OTLP export to Tempo/Jaeger is a later wave). Non-breaking:
 * callers opt in via `withCorrelation`; code that never calls it is unaffected.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface CorrelationContext {
  correlationId: string;
  /** Optional causal parent (e.g. order_id that spawned this wo_id). */
  causationId?: string;
  /** Free-form span attributes for the decision/observability layer. */
  attributes: Record<string, string | number | boolean>;
}

const als = new AsyncLocalStorage<CorrelationContext>();

/** Generate a fresh correlation id (uuid v4). */
export function newCorrelationId(): string {
  return randomUUID();
}

/** Run `fn` within a correlation context. Nested calls inherit unless a new id is given. */
export function withCorrelation<T>(
  ctx: { correlationId?: string; causationId?: string; attributes?: CorrelationContext["attributes"] },
  fn: () => T,
): T {
  const parent = als.getStore();
  const context: CorrelationContext = {
    correlationId: ctx.correlationId ?? parent?.correlationId ?? newCorrelationId(),
    causationId: ctx.causationId ?? parent?.correlationId,
    attributes: { ...(parent?.attributes ?? {}), ...(ctx.attributes ?? {}) },
  };
  return als.run(context, fn);
}

/** Current correlation id, or undefined outside any context. */
export function getCorrelationId(): string | undefined {
  return als.getStore()?.correlationId;
}

/** Current correlation context (read-only snapshot), or undefined. */
export function getCorrelationContext(): CorrelationContext | undefined {
  const s = als.getStore();
  return s ? { ...s, attributes: { ...s.attributes } } : undefined;
}

/** Attach an attribute to the current context (no-op outside a context). */
export function setAttribute(key: string, value: string | number | boolean): void {
  const s = als.getStore();
  if (s) s.attributes[key] = value;
}
