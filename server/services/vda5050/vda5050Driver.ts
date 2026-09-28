/**
 * VDA 5050 — RobotDriver implementation so an AGV can be driven through the
 * EXISTING robot framework (driver registry → robotManager active list →
 * robotCommandDispatcher HITL/dry-run gate). This is the "vendor/driver" option
 * from the task: we register a `vda5050` driver in the robot driver registry.
 *
 * READ: connect() opens an mqtt client to the broker and subscribes to the AGV's
 *       state/connection topics; subscribeState() bridges those into the robot
 *       framework's onState callback (→ robot_telemetry).
 * WRITE: runJob() publishes the prepared VDA 5050 Order/InstantActions JSON. It
 *        is ONLY ever reached when robotCommandDispatcher has already passed its
 *        HITL gate AND ROBOT_CONTROL_ENABLED==="true" (dry-run never calls it),
 *        so this driver does not re-check control flags — the gate is upstream.
 *
 * ⚠ HONEST scaffold. As of doc 24 C4, migration 0161 adds "vda5050" to
 *   `robotVendorEnum`, so a robots.vendor='vda5050' row now persists and the driver
 *   is selectable through the standard robot framework (no longer enum-blocked).
 *   Topic/field mapping still MUST be validated against a real AGV before go-live.
 */
import type {
  RobotDriver,
  RobotVendor,
  RobotConnectionConfig,
  RobotState,
  RobotStateHandle,
  OnRobotState,
  RobotJobSpec,
  RobotJobResult,
  RobotHealth,
} from "../robot/robotDriver";
import { abortThroughRunJob } from "../robot/robotDriver";
import {
  buildVda5050Topic,
  VDA5050_DEFAULT_INTERFACE,
  type Vda5050State,
  type Vda5050Connection,
  type Vda5050Order,
} from "./vda5050Messages";
import {
  mapStateToRobotTelemetry,
  mapConnectionToOnline,
  buildOrder,
  jobToOrderNodes,
  buildVda5050StopInstantActions,
} from "./vda5050Mapping";
import { isStopJob } from "../robot/stopJob"; // residual round 2 — the ONE shared classifier

type MqttLikeClient = {
  on(ev: string, cb: (...a: any[]) => void): void;
  subscribe(topic: string, cb?: (err?: Error | null) => void): void;
  publish(topic: string, payload: string, opts: Record<string, unknown>, cb?: (err?: Error | null) => void): void;
  end(force?: boolean, opts?: unknown, cb?: () => void): void;
  connected?: boolean;
};

/** The logical vendor key this driver registers under (now a first-class RobotVendor). */
export const VDA5050_VENDOR: RobotVendor = "vda5050";

export class Vda5050RobotDriver implements RobotDriver {
  readonly vendor: RobotVendor = VDA5050_VENDOR;
  private client: MqttLikeClient | null = null;
  private connected = false;
  private online = false;
  private lastState: RobotState | null = null;
  private lastError?: string;
  private manufacturer = "";
  private serialNumber = "";
  private interfaceName = VDA5050_DEFAULT_INTERFACE;
  private onStateCb: OnRobotState | null = null;

  async connect(cfg: RobotConnectionConfig): Promise<void> {
    const opts = (cfg.options ?? {}) as Record<string, unknown>;
    this.manufacturer = String(opts.manufacturer ?? "");
    this.serialNumber = String(opts.serialNumber ?? "");
    this.interfaceName = typeof opts.interfaceName === "string" ? opts.interfaceName : VDA5050_DEFAULT_INTERFACE;
    if (!this.manufacturer || !this.serialNumber) {
      throw new Error("vda5050: connectionOptions.manufacturer and .serialNumber are required");
    }
    const mqtt = await import("mqtt");
    const client = mqtt.connect(cfg.endpoint, {
      clientId: `vda5050-${this.serialNumber}-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: cfg.timeoutMs ?? 30_000,
    }) as unknown as MqttLikeClient;
    this.client = client;

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      client.on("connect", () => {
        this.connected = true;
        client.subscribe(this.topic("state"));
        client.subscribe(this.topic("connection"));
        done();
      });
      client.on("error", (err: Error) => {
        this.lastError = err?.message ?? String(err);
        done(); // resolve anyway; health()/isConnected reflect the failure
      });
      client.on("message", (topic: string, payload: Buffer) => this.onMessage(topic, payload));
      // Safety net so connect never hangs forever in tests / bad brokers.
      setTimeout(done, (cfg.timeoutMs ?? 30_000) + 100).unref?.();
    });
  }

  private publish(t: "order" | "instantActions", body: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.client!.publish(this.topic(t), JSON.stringify(body), { qos: 1, retain: false }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private topic(t: "state" | "connection" | "order" | "instantActions"): string {
    return buildVda5050Topic(this.interfaceName, this.manufacturer, this.serialNumber, t);
  }

  private onMessage(topic: string, payload: Buffer | string): void {
    try {
      const raw = Buffer.isBuffer(payload) ? payload.toString() : String(payload);
      if (!raw) return;
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // fail-safe: ignore non-JSON
      }
      if (topic.endsWith("/state")) {
        this.lastState = mapStateToRobotTelemetry(msg as Vda5050State);
        if (this.onStateCb) void this.onStateCb(this.lastState);
      } else if (topic.endsWith("/connection")) {
        this.online = mapConnectionToOnline(msg as Vda5050Connection);
      }
    } catch (err) {
      this.lastError = (err as Error)?.message ?? String(err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await new Promise<void>((resolve) => this.client!.end(false, undefined, resolve));
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getState(): Promise<RobotState> {
    // VDA 5050 is push-based; return the most recent decoded state (or a stub).
    return this.lastState ?? { timestamp: new Date(), mode: this.online ? "auto" : undefined };
  }

  async subscribeState(onState: OnRobotState, _intervalMs?: number): Promise<RobotStateHandle> {
    this.onStateCb = onState;
    // Emit immediately if we already have one.
    if (this.lastState) void onState(this.lastState);
    return {
      close: async () => {
        this.onStateCb = null;
      },
    };
  }

  /**
   * Reached ONLY after robotCommandDispatcher passed HITL + control gates. Builds
   * (if needed) and publishes the Order/InstantActions JSON to the AGV.
   */
  async runJob(job: RobotJobSpec): Promise<RobotJobResult> {
    if (!this.connected || !this.client) {
      return { ok: false, status: "failed", error: "vda5050: not connected" };
    }
    // doc 81 Đợt 1C residual 1 (ruling R-1C-m, LAYER b) — a STOP job is ALWAYS the fixed, server-built stop
    // instantActions (cancelOrder, startPause) and NEVER an order, whatever its params carry. This used to fall
    // through to the order path: `abort` + params.order / x,y was published as an ORDER — an "abort" that drove.
    if (isStopJob(job)) {
      try {
        const stop = buildVda5050StopInstantActions(this.manufacturer, this.serialNumber);
        await this.publish("instantActions", stop);
        return { ok: true, status: "done", detail: { published: true, jobType: "abort", instantActions: stop.actions.map((a) => a.actionType) } };
      } catch (err) {
        return { ok: false, status: "failed", error: (err as Error)?.message ?? String(err), detail: { jobType: "abort", sent: false } };
      }
    }
    try {
      const params = job.params ?? {};
      // A pre-built order may be passed straight through; else build from nodes.
      let order: Vda5050Order;
      if (params.order && typeof params.order === "object") {
        order = params.order as Vda5050Order;
      } else {
        const nodes = jobToOrderNodes(params);
        if (!nodes) return { ok: false, status: "failed", error: "vda5050: job has no usable nodes/x,y" };
        order = buildOrder({
          manufacturer: this.manufacturer,
          serialNumber: this.serialNumber,
          orderId: String(params.orderId ?? `ord-${Date.now()}`),
          nodes,
        });
      }
      await this.publish("order", order);
      return { ok: true, status: "done", detail: { published: true, orderId: order.orderId } };
    } catch (err) {
      return { ok: false, status: "failed", error: (err as Error)?.message ?? String(err) };
    }
  }

  async abort(): Promise<void> {
    // doc 81 Đợt 1C residual 1 (R-1C-m) — the stop now exists (server-built cancelOrder + startPause), so abort()
    // sends it through the same runJob path (was: RobotAbortUnsupportedError). Resolves only when it was
    // published; not connected / publish error ⇒ RobotAbortFailedError (abort_failed), never a silent no-op.
    await abortThroughRunJob((job) => this.runJob(job), "VDA5050");
  }

  async health(): Promise<RobotHealth> {
    return {
      vendor: this.vendor,
      connected: this.connected,
      lastError: this.lastError,
    };
  }
}

export const createVda5050Driver = () => new Vda5050RobotDriver();
