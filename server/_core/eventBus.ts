/**
 * Unified internal Event Bus (Phase 2 WS2.2) — the L5 orchestration backbone.
 *
 * A single typed pub/sub seam for server-side DOMAIN events (NG alerts, SPC
 * violations, Andon, yield warnings, …). Producers (socket emitters, services)
 * publish here; consumers (orchestration rules engine, future robotics/AI
 * orchestration) subscribe — decoupled from Socket.IO transport.
 *
 * Design:
 *  - In-process (Node EventEmitter). Correct default for single-instance.
 *  - Additive & non-breaking: existing Socket.IO emits keep working; they just
 *    ALSO publish here. Nothing depends on the bus unless it subscribes.
 *  - Fault-isolated: a subscriber error (sync or async) never propagates back to
 *    the publisher.
 *  - Cross-instance fan-out (Redis Streams/pub-sub) is a documented future
 *    extension behind this same API — not wired yet.
 *
 * SAFETY: the bus carries notifications/telemetry only. It MUST NOT be used to
 * issue device-control commands — those go exclusively through the HITL/interlock
 * commandDispatcher.
 */
import { EventEmitter } from "events";

export const EventTypes = {
  NG_ALERT: "ng.alert",
  SPC_VIOLATION: "spc.violation",
  ANDON: "andon.event",
  YIELD_WARNING: "yield.warning",
  INSPECTION_ALERT: "inspection.alert",
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes] | string;

export interface DomainEvent<T = unknown> {
  type: EventType;
  payload: T;
  /** epoch ms (set by the publisher) */
  ts: number;
  /** optional producer tag */
  source?: string;
}

const WILDCARD = "*";

class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  /** Publish a domain event. Never throws to the caller. */
  publish<T>(type: EventType, payload: T, source?: string): void {
    const evt: DomainEvent<T> = { type, payload, ts: Date.now(), source };
    try {
      this.emitter.emit(type, evt);
      this.emitter.emit(WILDCARD, evt);
    } catch (err) {
      console.error(`[EventBus] publish ${type} failed:`, (err as Error)?.message ?? err);
    }
  }

  /** Subscribe to one event type. Returns an unsubscribe fn. */
  subscribe<T = unknown>(type: EventType, handler: (e: DomainEvent<T>) => void | Promise<void>): () => void {
    const wrapped = (e: DomainEvent<T>) => this.invoke(type, handler, e);
    this.emitter.on(type, wrapped as (...args: unknown[]) => void);
    return () => this.emitter.off(type, wrapped as (...args: unknown[]) => void);
  }

  /** Subscribe to ALL events. Returns an unsubscribe fn. */
  subscribeAll(handler: (e: DomainEvent) => void | Promise<void>): () => void {
    const wrapped = (e: DomainEvent) => this.invoke(WILDCARD, handler, e);
    this.emitter.on(WILDCARD, wrapped as (...args: unknown[]) => void);
    return () => this.emitter.off(WILDCARD, wrapped as (...args: unknown[]) => void);
  }

  private invoke<T>(label: string, handler: (e: DomainEvent<T>) => void | Promise<void>, e: DomainEvent<T>): void {
    try {
      const r = handler(e);
      if (r && typeof (r as Promise<void>).then === "function") {
        (r as Promise<void>).catch((err) =>
          console.error(`[EventBus] async handler for ${label} failed:`, err?.message ?? err),
        );
      }
    } catch (err) {
      console.error(`[EventBus] handler for ${label} failed:`, (err as Error)?.message ?? err);
    }
  }
}

/** Process-wide singleton bus. */
export const eventBus = new EventBus();
