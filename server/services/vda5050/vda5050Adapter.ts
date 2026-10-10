/**
 * VDA 5050 — adapter: bind ONE AGV (manufacturer + serialNumber) to a platform
 * `robots` row, subscribe to its state/connection topics, and (gated) command it.
 *
 * READ direction (always safe):
 *   state      → mapStateToRobotTelemetry → robot_telemetry (via robotIngest)
 *   connection → robot.status online/offline
 *
 * WRITE direction (HITL + DRY-RUN by default):
 *   doc 81 Đợt 1C Task 3 — trigger semantics: 'manual' = an operator's own click (vda5050Router,
 *   ruling R11: confirmedBy = requestedBy = session user) and is passed through; 'hitl' (the
 *   default) = the AUTOMATED path: with no actionId the adapter first creates a 'confirmed'
 *   ai_pending_actions row bound (robotPayloadHash) to exactly the job it dispatches (FOE pattern,
 *   robotAutomationAction.ensureBoundRobotAction); if that cannot be created the dispatcher refuses
 *   the command (HITL_ACTION_REQUIRED) — nothing is published.
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
import { robots, robotJobs } from "../../../drizzle/schema";
import type { Robot } from "../../../drizzle/schema/robot";
import { ingestRobotState } from "../robot/robotIngest";
import type { RuntimeRobot } from "../robot/robotAdapter";
import type { RobotJobSpec } from "../robot/robotDriver";
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
  buildVda5050StopInstantActions,
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

/**
 * doc 81 Đợt 1C final wave 5 (final review M7) — VDA 5050 2.0 instant actions that only REMOVE energy:
 *   cancelOrder — cancel the running order; the AGV stops (no further driving on that order);
 *   startPause  — activate pause mode: no more AGV driving movements.
 * NOT stopPause: it DEACTIVATES pause mode — movement resumes — so it stays a motion.
 */
export const VDA5050_STOP_INSTANT_ACTION_TYPES: ReadonlySet<string> = new Set(["cancelOrder", "startPause"]);

/**
 * A STOP (non-motion) iff the message is non-empty and EVERY action is energy-reducing. A mixed message is a
 * motion (fail-closed: a stop label cannot carry a resume past the motion gates).
 */
export function isVda5050StopInstantActions(actions: ReadonlyArray<Pick<Vda5050Action, "actionType">>): boolean {
  return actions.length > 0 && actions.every((a) => VDA5050_STOP_INSTANT_ACTION_TYPES.has(a.actionType));
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
   * doc 81 Đợt 4 Task B1 — there is no adapter-side ORDER publish any more: an order reaches the AGV only through
   * robotCommandDispatcher → the `vda5050` driver (one channel). The adapter publishes only the STOP's second channel.
   */
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
    /** A confirmed, bound ai_pending_actions id the caller already holds ('hitl' only). */
    actionId?: string;
    idempotencyKey?: string;
  }): Promise<SendOrderResult> {
    const order = buildOrder({
      manufacturer: this.config.manufacturer,
      serialNumber: this.config.serialNumber,
      orderId: opts.orderId ?? `ord-${Date.now()}`,
      nodes: opts.nodes,
      headerId: nextHeaderId(),
    });

    // W3-B2 (doc 44 G3.14) — "MỘT CỬA": fleet-level policy seam TRƯỚC khi dispatch
    // (và do đó TRƯỚC mọi khả năng publish MQTT). SEC_PLATFORM OFF (mặc định) → bỏ qua
    // hoàn toàn (hành vi cũ, 0 khác biệt). DENY → KHÔNG dispatch, KHÔNG publish, ghi
    // ledger robot_jobs status='rejected' (append-only, fail-safe) + decision-log/trace
    // do evaluateActionPolicy tự ghi. Lưu ý: lệnh qua dispatchRobotJob phía dưới còn
    // đi qua seam robot.command.* của dispatcher — đây là CỬA fleet-scope bổ sung.
    {
      const { evaluateActionPolicy, secPlatformEnabled } = await import("../security/policyGate");
      if (secPlatformEnabled()) {
        const verdict = evaluateActionPolicy(
          `user:${opts.confirmedBy ?? opts.requestedBy}`,
          "fleet.vda5050.send_order",
          `robot:${this.config.robotId}`,
          {
            robotId: this.config.robotId,
            code: this.config.code,
            orderId: order.orderId,
            nodesCount: order.nodes.length,
            triggerKind: opts.triggerKind ?? "hitl",
            requestedBy: opts.requestedBy,
            ...(opts.confirmedBy != null ? { confirmedBy: opts.confirmedBy } : {}),
          },
          { requestId: opts.idempotencyKey ?? null },
        );
        if (!verdict.allow) {
          const code = verdict.effect === "deny" ? "POLICY_DENIED" : "POLICY_APPROVAL_REQUIRED";
          const errorText = `${code}: ${verdict.reason}${verdict.policyId ? ` (policy ${verdict.policyId})` : ""}`;
          let jobId: number | undefined;
          try {
            const db = await getDb();
            if (db) {
              const now = new Date();
              const [row] = await db
                .insert(robotJobs)
                .values({
                  robotId: this.config.robotId,
                  jobType: "move",
                  params: { vda5050: "order", orderId: order.orderId, nodesCount: order.nodes.length },
                  status: "rejected",
                  triggerKind: opts.triggerKind ?? "hitl",
                  requestedBy: opts.requestedBy,
                  confirmedBy: opts.confirmedBy,
                  idempotencyKey: opts.idempotencyKey,
                  errorText,
                  startedAt: now,
                  completedAt: now,
                })
                .returning({ id: robotJobs.id });
              jobId = row?.id;
            }
          } catch (err) {
            console.error(`[VDA5050] "${this.config.code}" policy-reject ledger write failed:`, (err as Error)?.message ?? err);
          }
          return { ok: false, status: "rejected", jobId, order, published: false, error: code };
        }
      }
    }

    const { dispatchRobotJob } = await import("../robot/robotCommandDispatcher");
    const job: RobotJobSpec = {
      jobType: "move",
      params: { vda5050: "order", order: order as unknown as Record<string, unknown> },
    };
    const triggerKind = opts.triggerKind ?? "hitl";
    const res = await dispatchRobotJob({
      robotId: this.config.robotId,
      job,
      triggerKind,
      actionId: await this.automationActionId(triggerKind, opts, job),
      requestedBy: opts.requestedBy,
      confirmedBy: opts.confirmedBy,
      idempotencyKey: opts.idempotencyKey,
    });

    // doc 81 Đợt 4 Task B1 — the ORDER is published by ONE channel only: the `vda5050` robot driver, reached through
    // the dispatcher after every gate. The adapter used to publish the same order a second time on 'done' (the AGV
    // got two orders with one orderId). `published` is what the driver reports it really sent; 'simulated' /
    // 'rejected' / 'failed' / a driver that reports nothing ⇒ false. (The STOP keeps its second channel — see
    // sendInstantActions.)
    const published = res.status === "done" && res.driverDetail?.published === true;

    return { ok: res.ok, status: res.status, jobId: res.jobId, order, published, ...(res.error ? { error: res.error } : {}) };
  }

  /**
   * doc 81 Đợt 1C Task 3 — the actionId this dispatch carries. 'manual' (operator, R11) and a
   * caller-supplied actionId pass through untouched; an automated 'hitl' call without one gets a
   * freshly created 'confirmed' row bound to exactly `job` (FOE pattern), owned by `confirmedBy`.
   * null from the helper ⇒ undefined here ⇒ the dispatcher refuses (HITL_ACTION_REQUIRED).
   * Fix round 1 (item 2): only a MOTION job gets a row — a STOP needs none (dispatcher R-1C-c) and must
   * never depend on one (a colliding key could otherwise turn a STOP into ACTION_BINDING_MISMATCH).
   */
  private async automationActionId(
    triggerKind: "hitl" | "manual",
    opts: { actionId?: string; confirmedBy?: number; idempotencyKey?: string },
    job: RobotJobSpec,
  ): Promise<string | undefined> {
    if (triggerKind !== "hitl" || opts.actionId) return opts.actionId;
    const { isMotionJob } = await import("../robot/robotCommandDispatcher");
    if (!isMotionJob(job)) return undefined;
    const { ensureBoundRobotAction } = await import("../robot/robotAutomationAction");
    const id = await ensureBoundRobotAction({
      tool: "vda5050.automation",
      robotId: this.config.robotId,
      job,
      ownerUserId: opts.confirmedBy,
      idempotencyKey: opts.idempotencyKey,
    });
    return id ?? undefined;
  }

  /** Send an instantActions message (e.g. cancelOrder/stop) under the same gating. */
  async sendInstantActions(opts: {
    actions: Vda5050Action[];
    requestedBy: number;
    confirmedBy?: number;
    triggerKind?: "hitl" | "manual";
    /** A confirmed, bound ai_pending_actions id the caller already holds ('hitl' only). */
    actionId?: string;
    idempotencyKey?: string;
  }): Promise<SendOrderResult> {
    // final wave 5 (M7) — a cancelOrder / startPause message is a STOP: job `abort` ⇒ exempt from the motion
    // gates (safety preflight, interlock, motion lock, R14 slot, HITL) like every robot STOP (R-1C-c). Anything
    // else (incl. stopPause = resume, and mixed messages) stays `custom` = motion, fully gated.
    const stop = isVda5050StopInstantActions(opts.actions);
    // residual 1 (R-1C-m, LAYER c) — a STOP publishes the SERVER-BUILT stop message (cancelOrder, startPause);
    // the caller's actions / actionIds / actionParameters are never published, and the dispatcher gets the
    // canonical abort job (no params). A motion message is built from the caller's actions as before.
    const msg: Vda5050InstantActions = stop
      ? buildVda5050StopInstantActions(this.config.manufacturer, this.config.serialNumber)
      : {
          headerId: nextHeaderId(),
          timestamp: new Date().toISOString(),
          version: "2.0.0",
          manufacturer: this.config.manufacturer,
          serialNumber: this.config.serialNumber,
          actions: opts.actions,
        };
    const { dispatchRobotJob } = await import("../robot/robotCommandDispatcher");
    let published = false;
    const job: RobotJobSpec = stop
      ? { jobType: "abort", params: {} }
      : { jobType: "custom", params: { vda5050: "instantActions", message: msg as unknown as Record<string, unknown> } };
    const triggerKind = opts.triggerKind ?? "hitl";
    const res = await dispatchRobotJob({
      robotId: this.config.robotId,
      job,
      triggerKind,
      actionId: await this.automationActionId(triggerKind, opts, job),
      requestedBy: opts.requestedBy,
      confirmedBy: opts.confirmedBy,
      idempotencyKey: opts.idempotencyKey,
    });
    // A STOP is also published when the real path was reached but the robot driver reported failure — the
    // AGV's own instantActions topic is a second stop channel (energy-reducing). Dry-run / rejected: nothing.
    if (res.status === "done" || (stop && res.status === "failed")) {
      try {
        await this.publishInstantActions(msg);
        published = true;
      } catch (err) {
        return { ok: false, status: "failed", jobId: res.jobId, published: false, error: (err as Error)?.message ?? String(err) };
      }
    }
    return { ok: res.ok, status: res.status, jobId: res.jobId, published, ...(res.error ? { error: res.error } : {}) };
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
