/**
 * Sprint F4 HITL — Sparkplug-B COMMAND direction (NCMD/DCMD) RECEIVE handler.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Adds the previously-missing INBOUND control direction to the Sparkplug stack.
 * The publish side (NBIRTH/DBIRTH/DDATA/NDEATH in sparkplugNode/unsPublisher) is
 * unchanged; this module ONLY decodes inbound NCMD/DCMD and routes them safely.
 *
 * SAFETY — ABSOLUTE:
 *   - A received DCMD (device command) is NEVER executed against hardware here.
 *     It is decoded (metric name + value), mapped to a platform machine, and
 *     handed to the EXISTING commandDispatcher.dispatch() under the SAME gates as
 *     any other control command:
 *       triggeredBy.kind = 'hitl' (no actionId → no confirmed-row shortcut) AND
 *       OT_CONTROL_ENABLED gate inside dispatch(). DEFAULT (flag off) → dispatch
 *       records a `simulated` row and returns { simulated:true }. No driver write.
 *   - This module does NOT call driver.writeTags and does NOT edit/duplicate the
 *     dispatcher's HITL/dry-run logic — it CALLS dispatch() and nothing else.
 *   - The one safe auto-action Sparkplug expects is "Node Control/Rebirth": an
 *     NCMD asking the edge node to re-publish its BIRTH certificates. That is
 *     re-publish telemetry only (no device control) → handled via the injected
 *     `onRebirth` callback.
 *
 * FLAG: SPARKPLUG_COMMAND_ENABLED (default OFF). When off, subscribe() is a no-op
 *       and the platform stays publish-only (current behaviour).
 *
 * FAIL-SAFE: malformed payloads are logged + dropped; unknown metrics ignored;
 *            the MQTT message handler NEVER throws (every path is try/caught).
 *
 * PURE-ish: all I/O (subscribe, dispatch, rebirth, machine lookup) is injected so
 *           this module is testable offline (mock MQTT + mock dispatcher).
 * ════════════════════════════════════════════════════════════════════════════
 */

import { decodePayload, type SparkplugMetric } from "./sparkplugEncoder";
import { buildTopic } from "./topicBuilder";
import type { DispatchInput, DispatchResult } from "../ot/commandDispatcher";

/** Sparkplug well-known metric name for the rebirth request (NCMD). */
export const REBIRTH_METRIC = "Node Control/Rebirth";

/** A decoded inbound Sparkplug command (NCMD or DCMD), normalised. */
export interface InboundCommand {
  kind: "NCMD" | "DCMD";
  groupId: string;
  edgeNodeId: string;
  /** Present only for DCMD. */
  deviceId?: string;
  metrics: SparkplugMetric[];
}

/** Result of mapping a Sparkplug node/device → a platform OT target. */
export interface MachineTarget {
  machineId: number;
  adapterId: number;
}

/**
 * Map a single decoded DCMD metric → a dispatcher write. Returns null to IGNORE
 * the metric (unknown / not a control intent). Keeps the Sparkplug→tag mapping
 * out of the dispatcher (which only knows tagKey/value).
 */
export type MetricToWrite = (
  metric: SparkplugMetric,
) => { tagKey: string; value: unknown; commandType: string } | null;

/** Injected dependencies — every side-effect is a callback (testable). */
export interface SparkplugCommandDeps {
  /**
   * Subscribe to a list of MQTT topic filters and deliver each inbound message
   * (topic + raw payload Buffer) to `onMessage`. Should NOT throw.
   */
  subscribe: (
    topicFilters: string[],
    onMessage: (topic: string, payload: Buffer) => void,
  ) => void;
  /** Reuse the EXISTING commandDispatcher.dispatch (HITL + dry-run gating). */
  dispatch: (input: DispatchInput) => Promise<DispatchResult>;
  /**
   * Re-publish BIRTH certificates (NBIRTH + DBIRTH). The ONE safe auto-action.
   * Provided by the publisher which owns the MQTT client + SparkplugNode.
   */
  onRebirth: () => void;
  /**
   * Resolve a Sparkplug node/device → a platform machine + adapter. Returns null
   * when the device is unknown (command is then dropped — never guessed).
   */
  resolveTarget: (
    groupId: string,
    edgeNodeId: string,
    deviceId: string | undefined,
  ) => Promise<MachineTarget | null> | MachineTarget | null;
  /** Map one DCMD metric → a write (or null to ignore). */
  metricToWrite: MetricToWrite;
  /**
   * System user id recorded as requestedBy/confirmedBy on the dispatch (the
   * inbound command has no interactive human; the dispatcher's mode gate — not
   * this id — is what prevents a hardware write by default).
   */
  systemUserId: number;
  /** Optional logger (defaults to console). */
  log?: Pick<Console, "warn" | "error" | "info">;
}

/** True when the inbound Sparkplug command direction is enabled (default OFF). */
export function isSparkplugCommandEnabled(): boolean {
  return process.env.SPARKPLUG_COMMAND_ENABLED === "true";
}

/** The NCMD/DCMD topic filters for one edge node (group + node wildcard for devices). */
export function commandTopicFilters(groupId: string, edgeNodeId: string): string[] {
  // NCMD: spBv1.0/<group>/NCMD/<node>
  // DCMD: spBv1.0/<group>/DCMD/<node>/<device>  (+ on any device under the node)
  const ncmd = buildTopic(groupId, "NCMD", edgeNodeId);
  const dcmdNode = buildTopic(groupId, "DCMD", edgeNodeId);
  return [ncmd, `${dcmdNode}/+`];
}

/**
 * Parse a Sparkplug topic into its parts. Returns null when it is not an NCMD or
 * DCMD topic (or otherwise malformed) — caller drops it.
 *
 * Expected: spBv1.0/<group>/<NCMD|DCMD>/<edge>[/<device>]
 */
export function parseCommandTopic(
  topic: string,
): { kind: "NCMD" | "DCMD"; groupId: string; edgeNodeId: string; deviceId?: string } | null {
  if (typeof topic !== "string" || topic.length === 0) return null;
  const parts = topic.split("/");
  if (parts.length < 4) return null;
  const [ns, groupId, type, edgeNodeId, deviceId] = parts;
  if (ns !== "spBv1.0") return null;
  if (type === "NCMD") {
    if (deviceId != null) return null; // NCMD has no device segment
    return { kind: "NCMD", groupId, edgeNodeId };
  }
  if (type === "DCMD") {
    if (!deviceId) return null; // DCMD requires a device segment
    return { kind: "DCMD", groupId, edgeNodeId, deviceId };
  }
  return null;
}

/** Truthy coercion for a Sparkplug Boolean/numeric "fire" metric value. */
function isTruthyCommand(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "true" || value === "1";
  return false;
}

/**
 * The inbound Sparkplug command handler. Owns NO MQTT client — it is GIVEN one
 * via deps.subscribe. Wire it once via `start()`; it is a no-op when the flag is
 * off (never subscribes, current publish-only behaviour preserved).
 */
export class SparkplugCommandHandler {
  private started = false;
  private readonly log: Pick<Console, "warn" | "error" | "info">;

  constructor(private readonly deps: SparkplugCommandDeps) {
    this.log = deps.log ?? console;
  }

  /**
   * Subscribe to NCMD/DCMD for the given edge node (flag-gated). No-op + returns
   * false when SPARKPLUG_COMMAND_ENABLED is not "true". Idempotent.
   */
  start(groupId: string, edgeNodeId: string): boolean {
    if (!isSparkplugCommandEnabled()) return false;
    if (this.started) return true;
    this.started = true;
    const filters = commandTopicFilters(groupId, edgeNodeId);
    try {
      this.deps.subscribe(filters, (topic, payload) => {
        // The MQTT handler MUST NEVER throw — swallow everything here.
        void this.handleMessage(topic, payload).catch((err) => {
          this.log.error("[SparkplugCmd] handler error (dropped):", (err as Error)?.message ?? err);
        });
      });
      this.log.info?.(`[SparkplugCmd] subscribed: ${filters.join(", ")}`);
    } catch (err) {
      this.log.error("[SparkplugCmd] subscribe failed:", (err as Error)?.message ?? err);
    }
    return true;
  }

  /**
   * Decode one inbound MQTT message and route it. NEVER throws (returns quietly
   * on any malformed / unknown input). Returns the inbound command on success
   * for testability; undefined when dropped.
   */
  async handleMessage(topic: string, payload: Buffer): Promise<InboundCommand | undefined> {
    const parsed = parseCommandTopic(topic);
    if (!parsed) {
      this.log.warn(`[SparkplugCmd] non-command/malformed topic dropped: ${String(topic)}`);
      return undefined;
    }

    let decoded;
    try {
      decoded = decodePayload(payload);
    } catch (err) {
      this.log.warn(`[SparkplugCmd] malformed payload dropped (${topic}): ${(err as Error)?.message ?? err}`);
      return undefined;
    }
    const metrics = Array.isArray(decoded?.metrics) ? decoded.metrics : [];

    const cmd: InboundCommand = {
      kind: parsed.kind,
      groupId: parsed.groupId,
      edgeNodeId: parsed.edgeNodeId,
      deviceId: parsed.deviceId,
      metrics,
    };

    try {
      if (parsed.kind === "NCMD") {
        await this.handleNcmd(cmd);
      } else {
        await this.handleDcmd(cmd);
      }
    } catch (err) {
      // Defense-in-depth: routing must never throw into the MQTT handler.
      this.log.error(`[SparkplugCmd] routing error dropped (${topic}): ${(err as Error)?.message ?? err}`);
    }
    return cmd;
  }

  /**
   * NCMD: the only auto-action we honour is "Node Control/Rebirth" → re-publish
   * BIRTH. Any other NCMD metric is a node-control intent → routed like a DCMD
   * (HITL/dry-run) if mappable, else ignored.
   */
  private async handleNcmd(cmd: InboundCommand): Promise<void> {
    const rebirth = cmd.metrics.find((m) => m.name === REBIRTH_METRIC);
    if (rebirth && isTruthyCommand(rebirth.value)) {
      this.log.info?.(`[SparkplugCmd] NCMD Rebirth requested for ${cmd.groupId}/${cmd.edgeNodeId} → re-publishing BIRTH`);
      try {
        this.deps.onRebirth();
      } catch (err) {
        this.log.error(`[SparkplugCmd] rebirth failed: ${(err as Error)?.message ?? err}`);
      }
      return;
    }
    // Non-rebirth NCMD metrics: treat as node-level control → HITL/dry-run route.
    await this.routeControlMetrics(cmd);
  }

  /** DCMD: a device control intent → route through the HITL dispatcher (dry-run). */
  private async handleDcmd(cmd: InboundCommand): Promise<void> {
    await this.routeControlMetrics(cmd);
  }

  /**
   * Map each control metric → a dispatcher write and route it through the EXISTING
   * commandDispatcher (HITL trigger, dry-run gated by OT_CONTROL_ENABLED). Unknown
   * metrics are ignored. Never executes hardware here.
   */
  private async routeControlMetrics(cmd: InboundCommand): Promise<void> {
    const writes: Array<{ tagKey: string; value: unknown; commandType: string }> = [];
    for (const m of cmd.metrics) {
      if (m.name === REBIRTH_METRIC) continue; // handled by rebirth path
      let mapped: ReturnType<MetricToWrite>;
      try {
        mapped = this.deps.metricToWrite(m);
      } catch {
        mapped = null;
      }
      if (mapped) writes.push(mapped);
      else this.log.info?.(`[SparkplugCmd] unknown metric ignored: ${String(m.name ?? m.alias)}`);
    }
    if (writes.length === 0) return;

    const target = await this.deps.resolveTarget(cmd.groupId, cmd.edgeNodeId, cmd.deviceId);
    if (!target) {
      this.log.warn(
        `[SparkplugCmd] no machine mapped for ${cmd.groupId}/${cmd.edgeNodeId}` +
          `${cmd.deviceId ? "/" + cmd.deviceId : ""} — command dropped`,
      );
      return;
    }

    // Group writes by commandType so each dispatch carries a single command intent.
    const byType = new Map<string, Array<{ tagKey: string; value: unknown }>>();
    for (const w of writes) {
      const list = byType.get(w.commandType) ?? [];
      list.push({ tagKey: w.tagKey, value: w.value });
      byType.set(w.commandType, list);
    }

    for (const [commandType, ws] of byType) {
      const input: DispatchInput = {
        adapterId: target.adapterId,
        machineId: target.machineId,
        commandType,
        writes: ws,
        // HITL trigger, NO actionId: routes through the dispatcher's shared gates.
        // The mode gate (OT_CONTROL_ENABLED, default off) keeps this DRY-RUN — no
        // hardware write — exactly like any other non-confirmed control attempt.
        triggeredBy: {
          kind: "hitl",
          confirmedBy: this.deps.systemUserId,
          requestedBy: this.deps.systemUserId,
        },
        idempotencyKey: `spcmd-${target.machineId}-${cmd.kind}-${commandType}-${Date.now()}`,
      };
      const res = await this.deps.dispatch(input);
      this.log.info?.(
        `[SparkplugCmd] ${cmd.kind} ${commandType} → machine #${target.machineId}: ` +
          `${res.status}${res.simulated ? " (DRY-RUN)" : ""}`,
      );
    }
  }
}
