/**
 * Automation Orchestration K0+-c (doc 16 §4 Khối 0 / doc 18 §6) — PRODUCER helpers
 * that ADDITIVELY publish real domain events to the durable outbox.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * These thin, FIRE-AND-FORGET, ERROR-ISOLATED wrappers are called from the real
 * producer sites (inspection commit, OEE persist, WIP ingest, genealogy write).
 * Each:
 *   • is gated by ERP_OUTBOX_ENABLED — a NO-OP when off (current behavior, no
 *     enqueue, no cost);
 *   • resolves the per-event-type target endpoint from env (missing endpoint →
 *     silent no-op, since a partner ERP may not subscribe to every family);
 *   • carries a deterministic idempotencyKey so a producer retry / re-emit dedupes
 *     at the outbox (no double-publish);
 *   • NEVER throws to the producer and NEVER blocks its main path — it returns void
 *     immediately and does the enqueue on a detached promise with a catch.
 *
 * This keeps the producer sites to ONE clear call each, and keeps ALL the outbox
 * coupling (flag, endpoint resolution, error isolation) in one place.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { enqueueOutbox, outboxEnabled, type OutboxEventType } from "./erpOutbox";

/** Resolve the target endpoint for an event family from env. Empty → not subscribed. */
function endpointFor(eventType: OutboxEventType): string | undefined {
  const map: Record<OutboxEventType, string | undefined> = {
    "production-event": process.env.ERP_PRODUCTION_ENDPOINT,
    "quality-result": process.env.ERP_QUALITY_ENDPOINT,
    "oee-metric": process.env.ERP_OEE_ENDPOINT,
    "genealogy-record": process.env.ERP_GENEALOGY_ENDPOINT,
  };
  const ep = map[eventType];
  return ep && ep.trim() ? ep.trim() : undefined;
}

/**
 * Fire-and-forget publish to the outbox. Returns immediately (void). Gated by
 * ERP_OUTBOX_ENABLED; no-op when off or when the family has no configured endpoint.
 * Any error is swallowed (logged) — the producer's main path is never affected.
 */
export function publishToOutbox(input: {
  eventType: OutboxEventType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  corporateCode?: string | null;
  format?: "json" | "b2mml";
}): void {
  try {
    if (!outboxEnabled()) return; // flag OFF → current behavior (no enqueue)
    const targetEndpoint = endpointFor(input.eventType);
    if (!targetEndpoint) return; // family not subscribed → no-op
    // Detached; never awaited by the producer.
    void enqueueOutbox({
      eventType: input.eventType,
      payload: input.payload,
      targetEndpoint,
      idempotencyKey: input.idempotencyKey,
      corporateCode: input.corporateCode ?? undefined,
      format: input.format,
    }).catch((err) => {
      console.error(`[outboxProducers] enqueue ${input.eventType} failed:`, (err as Error)?.message ?? err);
    });
  } catch (err) {
    // Absolutely never propagate to the producer.
    console.error(`[outboxProducers] publish ${input.eventType} threw:`, (err as Error)?.message ?? err);
  }
}
