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
 *  - Cross-instance fan-out (Redis pub/sub) is now available behind this SAME API
 *    via server/_core/busFanout.ts (U6-b, G-10). It is OPT-IN
 *    (EVENTBUS_REDIS_ENABLED=true + REDIS_URL) and defaults OFF → this bus stays a
 *    pure in-process EventEmitter unless explicitly enabled. Loopback-safe: an
 *    event received from Redis is injected locally but NOT re-published to Redis.
 *
 * SAFETY: the bus carries notifications/telemetry only. It MUST NOT be used to
 * issue device-control commands — those go exclusively through the HITL/interlock
 * commandDispatcher.
 */
import { EventEmitter } from "events";
import { createBusFanout, type BusFanout } from "./busFanout";

export const EventTypes = {
  NG_ALERT: "ng.alert",
  SPC_VIOLATION: "spc.violation",
  ANDON: "andon.event",
  YIELD_WARNING: "yield.warning",
  INSPECTION_ALERT: "inspection.alert",
  // S1 (doc 16 Khối 3) — ADVISORY safety event (NOT a safety-rated signal).
  SAFETY_EVENT: "safety.event",
  // E2-4 (doc69 Giai đoạn 4/Wave E2) — AI agent state-change refresh nudge. Payload
  // is INTENTIONALLY minimal/non-sensitive (see aiAgentRealtime.ts) — a signal to
  // refetch the RBAC-gated read-model, never the data itself.
  AI_AGENT: "ai:agent",
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
  private fanout: BusFanout;

  constructor() {
    this.emitter.setMaxListeners(200);
    // U6-b (G-10): optional cross-instance fan-out. Default OFF → pure in-process.
    // A message from a REMOTE instance is injected via emitLocal (which does NOT
    // re-publish to Redis) — loopback-safe.
    this.fanout = createBusFanout("event");
    this.fanout.onRemote((payload) => {
      const evt = payload as DomainEvent;
      if (evt && typeof evt.type === "string") this.emitLocal(evt);
    });
  }

  /** True when Redis cross-instance fan-out is actually active. */
  get fanoutActive(): boolean {
    return this.fanout.active;
  }

  /** Emit a fully-formed event onto the LOCAL emitter only (no Redis re-publish). */
  private emitLocal<T>(evt: DomainEvent<T>): void {
    try {
      this.emitter.emit(evt.type, evt);
      this.emitter.emit(WILDCARD, evt);
    } catch (err) {
      console.error(`[EventBus] emit ${evt.type} failed:`, (err as Error)?.message ?? err);
    }
  }

  /** Publish a locally-originated domain event. Never throws to the caller. */
  publish<T>(type: EventType, payload: T, source?: string): void {
    const evt: DomainEvent<T> = { type, payload, ts: Date.now(), source };
    this.emitLocal(evt);
    // Fan out to remote instances (no-op unless the flag is on + Redis is up).
    this.fanout.publish(evt);
  }

  /** Tear down the fan-out adapter (tests / graceful shutdown). */
  async close(): Promise<void> {
    await this.fanout.close();
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
