/**
 * Phase E1 — Unified Machine API: WEBHOOK BRIDGE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Drives OUTBOUND webhook delivery to external subscribers from internal events,
 * REUSING the existing webhook infrastructure (webhook_configs / webhook_delivery_logs
 * + sendWebhookEvent, which already HMAC-signs the payload, retries, logs, and is
 * fully fail-safe — it never blocks the emitter). No new table is added.
 *
 * Sources:
 *   • the internal eventBus (NG alerts, Andon, SPC) → mapped to public event names.
 *   • direct emit() calls from the /api/v1 router (e.g. equipment.command.executed,
 *     inspection.committed) for events not already on the bus.
 *
 * SAFETY: flag-gated by WEBHOOKS_ENABLED (default OFF). When off, emit() is a no-op
 * so no outbound HTTP ever leaves the box. Subscribing to the bus is harmless and
 * always installed; only the actual POST is gated.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eventBus, EventTypes, type DomainEvent } from "../../_core/eventBus";

/** Public webhook event names the /api/v1 contract advertises. */
export const V1_WEBHOOK_EVENTS = [
  "inspection.committed",
  "andon.raised",
  "equipment.command.executed",
  "spc.violation",
  "ng.alert",
] as const;
export type V1WebhookEvent = (typeof V1_WEBHOOK_EVENTS)[number];

/** True when outbound webhook POSTs are enabled (default OFF for safety). */
export function webhooksEnabled(): boolean {
  return process.env.WEBHOOKS_ENABLED === "true" || process.env.WEBHOOKS_ENABLED === "1";
}

/**
 * Emit a webhook event to all subscribers. Fail-safe + flag-gated: returns
 * immediately when WEBHOOKS_ENABLED is off, and never throws to the caller (the
 * underlying sendWebhookEvent fires-and-forgets each delivery with retry).
 */
export async function emit(eventType: V1WebhookEvent | string, payload: Record<string, unknown>): Promise<void> {
  if (!webhooksEnabled()) return;
  try {
    const { sendWebhookEvent } = await import("../../routers/webhookRouter");
    await sendWebhookEvent(eventType, payload);
  } catch (err) {
    // Never let webhook delivery affect the request/emitter.
    console.error("[api/v1 webhook] emit failed:", (err as Error)?.message ?? err);
  }
}

let installed = false;

/**
 * Subscribe the bridge to the internal eventBus so existing domain events also
 * fan out to webhook subscribers. Idempotent; safe to call at startup. The actual
 * POST is still gated by WEBHOOKS_ENABLED inside emit().
 */
export function installWebhookBridge(): void {
  if (installed) return;
  installed = true;

  const forward = (publicName: V1WebhookEvent) => (e: DomainEvent) => {
    void emit(publicName, {
      source: e.source ?? "eventBus",
      ts: e.ts,
      payload: e.payload as Record<string, unknown>,
    });
  };

  eventBus.subscribe(EventTypes.NG_ALERT, forward("ng.alert"));
  eventBus.subscribe(EventTypes.ANDON, forward("andon.raised"));
  eventBus.subscribe(EventTypes.SPC_VIOLATION, forward("spc.violation"));
}
