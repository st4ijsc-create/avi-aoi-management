/**
 * Sparkplug-B COMMAND direction (NCMD/DCMD) — RECEIVE handler. Pha 0 · C0-1 (2026-11-04): CHỈ CÒN "Node Control/Rebirth".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Lịch sử: Sprint F4 từng thêm chiều NHẬN lệnh vào ngăn xếp Sparkplug: DCMD (lệnh thiết bị) → ánh xạ metric → `commandDispatcher.dispatch()` dưới HITL
 * (`HITL/ActionId` + `sparkplug.command`). TechDocs 50 §C0: đó là CỬA CHẾT (không ai tạo pending `sparkplug.command`) — nên GỠ nhánh DCMD, quyết định chủ dự án
 * qua dieu-phoi 2026-11-04 (chọn B): GIỮ NCMD "Node Control/Rebirth" (chỉ phát lại BIRTH, không ghi thiết bị — host Sparkplug bên thứ ba cần nó).
 *
 * BẤT BIẾN (census `sparkplugCommand.khongGhi.test.ts` canh bằng AST):
 *   • Module này KHÔNG import `commandDispatcher` / `otDeviceWrite` / adapter / driver, KHÔNG có `dispatch`, `writeTags`, `deployFile`, `resolveTarget`, `metricToWrite`.
 *   • DCMD ⇒ BỊ TỪ CHỐI (không bao giờ ghi/bay thiết bị), có log; mọi metric NCMD ngoài Rebirth ⇒ bỏ qua, có log.
 *   • Rebirth là hành động an toàn duy nhất: gọi `onRebirth` (do publisher cung cấp) để phát lại NBIRTH/DBIRTH.
 *
 * FLAG: SPARKPLUG_COMMAND_ENABLED (mặc định TẮT). Tắt ⇒ `start()` không subscribe, nền tảng chỉ publish (hành vi hiện tại).
 * FAIL-SAFE: payload hỏng bị log + bỏ; handler MQTT KHÔNG BAO GIỜ ném.
 * PURE-ish: mọi I/O (subscribe, rebirth) được tiêm ⇒ test offline.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { decodePayload, type SparkplugMetric } from "./sparkplugEncoder";
import { buildTopic } from "./topicBuilder";

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
  /**
   * Re-publish BIRTH certificates (NBIRTH + DBIRTH). The ONE safe auto-action.
   * Provided by the publisher which owns the MQTT client + SparkplugNode.
   */
  onRebirth: () => void;
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
  // DCMD: spBv1.0/<group>/DCMD/<node>/<device>  (+ on any device under the node) — vẫn subscribe để GHI LOG việc bị từ chối, không để lệnh im lặng.
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
      this.log.info?.(`[SparkplugCmd] subscribed (Rebirth only): ${filters.join(", ")}`);
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
        this.handleNcmd(cmd);
      } else {
        this.refuseDcmd(cmd);
      }
    } catch (err) {
      // Defense-in-depth: routing must never throw into the MQTT handler.
      this.log.error(`[SparkplugCmd] routing error dropped (${topic}): ${(err as Error)?.message ?? err}`);
    }
    return cmd;
  }

  /** NCMD: the ONLY honoured intent is "Node Control/Rebirth" → re-publish BIRTH. Every other metric is ignored (logged). */
  private handleNcmd(cmd: InboundCommand): void {
    const rebirth = cmd.metrics.find((m) => m.name === REBIRTH_METRIC);
    if (rebirth && isTruthyCommand(rebirth.value)) {
      this.log.info?.(`[SparkplugCmd] NCMD Rebirth requested for ${cmd.groupId}/${cmd.edgeNodeId} → re-publishing BIRTH`);
      try {
        this.deps.onRebirth();
      } catch (err) {
        this.log.error(`[SparkplugCmd] rebirth failed: ${(err as Error)?.message ?? err}`);
      }
    }
    for (const m of cmd.metrics) {
      if (m.name === REBIRTH_METRIC) continue;
      this.log.warn(`[SparkplugCmd] NCMD metric ignored (only Rebirth is supported): ${String(m.name ?? m.alias)}`);
    }
  }

  /** DCMD: lệnh thiết bị qua Sparkplug đã GỠ (pha 0 · C0-1) — từ chối + ghi log, KHÔNG ghi/bay thiết bị, KHÔNG gọi dispatcher. */
  private refuseDcmd(cmd: InboundCommand): void {
    this.log.warn(
      `[SparkplugCmd] DCMD REFUSED for ${cmd.groupId}/${cmd.edgeNodeId}/${cmd.deviceId ?? "?"} (${cmd.metrics.length} metric(s)): ` +
        `device commands over Sparkplug were removed (pha 0 C0-1) — nothing was written`,
    );
  }
}
