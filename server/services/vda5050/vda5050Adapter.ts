/**
 * VDA 5050 — adapter: bind ONE AGV (manufacturer + serialNumber) to a platform
 * `robots` row, subscribe to its state/connection topics, and (gated) command it.
 *
 * READ direction (always safe):
 *   state      → mapStateToRobotTelemetry → robot_telemetry (via robotIngest)
 *   connection → robot.status online/offline
 *
 * WRITE direction (HITL + DRY-RUN by default):
 *   sendOrder / sendInstantActions route through robotCommandDispatcher, which
 *   records an append-only robot_jobs row and ONLY allows a real MQTT publish
 *   when ROBOT_CONTROL_ENABLED==="true". In dry-run we BUILD the Order JSON and
 *   return it WITHOUT publishing anything to MQTT.
 *
 * MQTT REUSE: we use the `mqtt` client library (already a platform dependency)
 * pointed at the configured broker — we do NOT spin up a new broker and add no
 * new npm dependency. The connection is created lazily and shared per adapter.
 *
 * ⚠ Field mapping + topic layout MUST be validated against a real AGV/fleet
 *   manager. This is an honest scaffold; nothing here is field-proven.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { robots } from "../../../drizzle/schema";
import type { Robot } from "../../../drizzle/schema/robot";
import { ingestRobotState } from "../robot/robotIngest";
import type { RuntimeRobot } from "../robot/robotAdapter";
import {
  buildVda5050Topic,
  VDA5050_DEFAULT_INTERFACE,
  type Vda5050State,
  type Vda5050Connection,
  type Vda5050Order,
  type Vda5050InstantActions,
  type Vda5050Action,
} from "./vda5050Messages";
import {
  mapStateToRobotTelemetry,
  mapConnectionToOnline,
  buildOrder,
  jobToOrderNodes,
  nextHeaderId,
  type BuildOrderInput,
} from "./vda5050Mapping";

/** mqtt client type kept loose so we never hard-depend on the lib at type level. */
type MqttLikeClient = {
  on(ev: string, cb: (...a: any[]) => void): void;
  subscribe(topic: string, cb?: (err?: Error | null) => void): void;
  publish(topic: string, payload: string, opts: Record<string, unknown>, cb?: (err?: Error | null) => void): void;
  end(force?: boolean, opts?: unknown, cb?: () => void): void;
  connected?: boolean;
};

export interface Vda5050AgvConfig {
  robotId: number;
  code: string;
  manufacturer: string;
  serialNumber: string;
  /** Interface-name topic segment (defaults to "uagv"). */
  interfaceName: string;
  /** Broker URL the AGV/fleet shares, e.g. "mqtt://127.0.0.1:1883". */
  brokerUrl: string;
}

export interface SendOrderResult {
  /** True when the dispatcher accepted (dry-run-simulated or really published). */
  ok: boolean;
  status: "done" | "failed" | "simulated" | "rejected";
  jobId?: number;
  /** The Order JSON that was built (returned even in dry-run for inspection). */
  order?: Vda5050Order;
  /** True only when the message was actually published to MQTT. */
  published: boolean;
  error?: string;
}

/** A live adapter bound to one AGV. */
export class Vda5050Adapter {
  private client: MqttLikeClient | null = null;
  private online = false;
  private lastError?: string;

  constructor(public readonly config: Vda5050AgvConfig) {}

  isOnline(): boolean {
    return this.online;
  }
  getLastError(): string | undefined {
    return this.lastError;
  }

  private topic(t: "state" | "connection" | "order" | "instantActions" | "visualization" | "factsheet"): string {
    return buildVda5050Topic(this.config.interfaceName, this.config.manufacturer, this.config.serialNumber, t);
  }

  /** Connect to the broker and subscribe to this AGV's state + connection. */
  async start(): Promise<void> {
    const mqtt = await import("mqtt");
    const client = mqtt.connect(this.config.brokerUrl, {
      clientId: `vda5050-mc-${this.config.serialNumber}-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 30_000,
    }) as unknown as MqttLikeClient;
    this.client = client;

    client.on("connect", () => {
      client.subscribe(this.topic("state"));
      client.subscribe(this.topic("connection"));
    });
    client.on("message", (topic: string, payload: Buffer) => {
      void this.onMessage(topic, payload);
    });
    client.on("error", (err: Error) => {
      this.lastError = err?.message ?? String(err);
      console.error(`[VDA5050] "${this.config.code}" mqtt error:`, this.lastError);
    });
  }

  /** Fail-safe message handler — bad JSON / unknown topic is ignored, never throws. */
  async onMessage(topic: string, payload: Buffer | string): Promise<void> {
    try {
      const raw = Buffer.isBuffer(payload) ? payload.toString() : String(payload);
      if (!raw) return;
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // non-JSON → ignore (fail-safe)
      }
      if (topic.endsWith("/state")) {
        await this.handleState(msg as Vda5050State);
      } else if (topic.endsWith("/connection")) {
        await this.handleConnection(msg as Vda5050Connection);
      }
      // visualization/factsheet intentionally not ingested here.
    } catch (err) {
      console.error(`[VDA5050] "${this.config.code}" onMessage failed:`, (err as Error)?.message ?? err);
    }
  }

  /** State → robot_telemetry via the existing robot ingest path. */
  async handleState(state: Vda5050State): Promise<void> {
    const robotState = mapStateToRobotTelemetry(state);
    // Build a minimal RuntimeRobot view for ingest (driver is not used by ingest).
    const view = { id: this.config.robotId, code: this.config.code } as unknown as RuntimeRobot;
    await ingestRobotState(view, robotState);
  }

  /** Connection → robots.status online/offline. */
  async handleConnection(conn: Vda5050Connection): Promise<void> {
    this.online = mapConnectionToOnline(conn);
    const db = await getDb();
    if (!db) return;
    try {
      await db
        .update(robots)
        .set({ status: this.online ? "online" : "offline", lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(robots.id, this.config.robotId));
    } catch (err) {
      console.error(`[VDA5050] "${this.config.code}" connection update failed:`, (err as Error)?.message ?? err);
    }
  }

  /**
   * Publish an Order JSON to the AGV's order topic. INTERNAL — callers MUST go
   * through robotCommandDispatcher (sendOrder below) so HITL + dry-run gating is
   * never bypassed. This is the ONLY place that actually publishes a command.
   */
  private async publishOrder(order: Vda5050Order): Promise<void> {
    if (!this.client) throw new Error("adapter not started (no mqtt client)");
    await new Promise<void>((resolve, reject) => {
      this.client!.publish(this.topic("order"), JSON.stringify(order), { qos: 1, retain: false }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async publishInstantActions(msg: Vda5050InstantActions): Promise<void> {
    if (!this.client) throw new Error("adapter not started (no mqtt client)");
    await new Promise<void>((resolve, reject) => {
      this.client!.publish(this.topic("instantActions"), JSON.stringify(msg), { qos: 1, retain: false }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * HITL/dry-run-gated Order send. Builds the Order JSON, then routes the publish
   * through robotCommandDispatcher:
   *   - dry-run (ROBOT_CONTROL_ENABLED!=="true"): dispatcher records 'simulated',
   *     driver.runJob is NEVER called → NO MQTT publish. published=false.
   *   - live: dispatcher calls a one-shot driver whose runJob publishes the Order.
   */
  async sendOrder(opts: {
    nodes: BuildOrderInput["nodes"];
    orderId?: string;
    requestedBy: number;
    confirmedBy?: number;
    triggerKind?: "hitl" | "manual";
    idempotencyKey?: string;
  }): Promise<SendOrderResult> {
    const order = buildOrder({
      manufacturer: this.config.manufacturer,
      serialNumber: this.config.serialNumber,
      orderId: opts.orderId ?? `ord-${Date.now()}`,
      nodes: opts.nodes,
      headerId: nextHeaderId(),
    });

    const { dispatchRobotJob } = await import("../robot/robotCommandDispatcher");
    let published = false;
    const res = await dispatchRobotJob({
      robotId: this.config.robotId,
      job: {
        jobType: "move",
        params: { vda5050: "order", order: order as unknown as Record<string, unknown> },
      },
      triggerKind: opts.triggerKind ?? "hitl",
      requestedBy: opts.requestedBy,
      confirmedBy: opts.confirmedBy,
      idempotencyKey: opts.idempotencyKey,
    });

    // Only when the dispatcher really ran (status 'done') AND control is enabled
    // do we publish. In 'simulated'/'rejected' we publish nothing.
    if (res.status === "done") {
      try {
        await this.publishOrder(order);
        published = true;
      } catch (err) {
        return {
          ok: false,
          status: "failed",
          jobId: res.jobId,
          order,
          published: false,
          error: (err as Error)?.message ?? String(err),
        };
      }
    }

    return { ok: res.ok, status: res.status, jobId: res.jobId, order, published };
  }

  /** Send an instantActions message (e.g. cancelOrder/stop) under the same gating. */
  async sendInstantActions(opts: {
    actions: Vda5050Action[];
    requestedBy: number;
    confirmedBy?: number;
    triggerKind?: "hitl" | "manual";
    idempotencyKey?: string;
  }): Promise<SendOrderResult> {
    const msg: Vda5050InstantActions = {
      headerId: nextHeaderId(),
      timestamp: new Date().toISOString(),
      version: "2.0.0",
      manufacturer: this.config.manufacturer,
      serialNumber: this.config.serialNumber,
      actions: opts.actions,
    };
    const { dispatchRobotJob } = await import("../robot/robotCommandDispatcher");
    let published = false;
    const res = await dispatchRobotJob({
      robotId: this.config.robotId,
      job: { jobType: "custom", params: { vda5050: "instantActions", message: msg as unknown as Record<string, unknown> } },
      triggerKind: opts.triggerKind ?? "hitl",
      requestedBy: opts.requestedBy,
      confirmedBy: opts.confirmedBy,
      idempotencyKey: opts.idempotencyKey,
    });
    if (res.status === "done") {
      try {
        await this.publishInstantActions(msg);
        published = true;
      } catch (err) {
        return { ok: false, status: "failed", jobId: res.jobId, published: false, error: (err as Error)?.message ?? String(err) };
      }
    }
    return { ok: res.ok, status: res.status, jobId: res.jobId, published };
  }

  async stop(): Promise<void> {
    if (this.client) {
      try {
        await new Promise<void>((resolve) => this.client!.end(false, undefined, resolve));
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    this.online = false;
  }
}

/**
 * Resolve a platform robots row for an AGV by manufacturer + serialNumber.
 *
 * Mapping rule (HONEST scaffold): we match `vendor` is not used (the enum has no
 * "vda5050"); instead we look for a kind='agv' robot whose connectionOptions
 * carry { manufacturer, serialNumber } OR whose `code` equals
 * `<manufacturer>:<serialNumber>`. Returns null when no row matches.
 */
export async function resolveAgvRobot(
  manufacturer: string,
  serialNumber: string,
): Promise<Robot | null> {
  const db = await getDb();
  if (!db) return null;
  // Prefer the deterministic code convention.
  const code = `${manufacturer}:${serialNumber}`;
  const [byCode] = await db.select().from(robots).where(eq(robots.code, code)).limit(1);
  if (byCode) return byCode;

  // Fallback: scan kind='agv' rows for matching connectionOptions.
  const agvs = await db.select().from(robots).where(eq(robots.kind, "agv"));
  for (const r of agvs) {
    const opts = (r.connectionOptions ?? {}) as Record<string, unknown>;
    if (opts.manufacturer === manufacturer && opts.serialNumber === serialNumber) return r;
  }
  return null;
}

/**
 * Build an adapter config from an enabled AGV robots row.
 * connectionOptions is expected to carry { manufacturer, serialNumber, interfaceName? }.
 * `endpoint` is the broker URL (e.g. "mqtt://127.0.0.1:1883").
 * Returns null if the row is not a usable VDA 5050 AGV.
 */
export function agvConfigFromRobot(r: Robot): Vda5050AgvConfig | null {
  const opts = (r.connectionOptions ?? {}) as Record<string, unknown>;
  const manufacturer = typeof opts.manufacturer === "string" ? opts.manufacturer : undefined;
  const serialNumber = typeof opts.serialNumber === "string" ? opts.serialNumber : undefined;
  if (!manufacturer || !serialNumber || !r.endpoint) return null;
  return {
    robotId: r.id,
    code: r.code,
    manufacturer,
    serialNumber,
    interfaceName: typeof opts.interfaceName === "string" ? opts.interfaceName : VDA5050_DEFAULT_INTERFACE,
    brokerUrl: r.endpoint,
  };
}

export { jobToOrderNodes };
