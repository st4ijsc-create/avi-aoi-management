/**
 * P4.B G14 — Pluggable alert sinks for SPC violations.
 *
 * Allows the measurementSamples / spcAlerts subsystem to emit detected
 * violations to one or more downstream channels:
 *   - "console"  → stdout JSON (default; always safe in dev)
 *   - "webhook"  → HTTP POST to a configured URL
 *   - "mqtt"     → publish to an MQTT topic via the global broker if available
 *
 * Pure utility — no DB writes here. The caller is responsible for persisting
 * the SpcAlert row separately (already done in measurementSamplesRouter).
 *
 * Failures of one sink MUST NOT throw or block the others.
 */

export type SpcAlertSinkKind = "console" | "webhook" | "mqtt" | "socket";

export interface SpcAlertSink {
  kind: SpcAlertSinkKind;
  /** Webhook only. */
  url?: string;
  /** MQTT only. Defaults to `aoi/spc/alert/<pointDefId>`. */
  topicTemplate?: string;
  /** Optional auth header for webhook (e.g. "Bearer xxx"). */
  authorization?: string;
  /** Whether to send full sample arrays (default false; only counts). */
  verbose?: boolean;
}

export interface SpcAlertPayload {
  pointDefId: number;
  ruleCode: string;
  ruleName: string;
  severity: string;
  windowFrom: Date;
  windowTo: Date;
  sampleIds: number[];
  summary: any;
}

export interface PublishResult {
  sink: SpcAlertSinkKind;
  ok: boolean;
  error?: string;
}

function buildTopic(template: string | undefined, payload: SpcAlertPayload): string {
  const t = template ?? "aoi/spc/alert/{pointDefId}";
  return t
    .replace("{pointDefId}", String(payload.pointDefId))
    .replace("{rule}", payload.ruleCode)
    .replace("{severity}", payload.severity);
}

function toJsonSafe(payload: SpcAlertPayload, verbose: boolean): string {
  const out: Record<string, unknown> = {
    pointDefId: payload.pointDefId,
    ruleCode: payload.ruleCode,
    ruleName: payload.ruleName,
    severity: payload.severity,
    windowFrom: payload.windowFrom.toISOString(),
    windowTo: payload.windowTo.toISOString(),
    sampleCount: payload.sampleIds.length,
    summary: payload.summary,
  };
  if (verbose) out.sampleIds = payload.sampleIds;
  return JSON.stringify(out);
}

async function publishConsole(payload: SpcAlertPayload, sink: SpcAlertSink): Promise<PublishResult> {
  try {
    // eslint-disable-next-line no-console
    console.log("[spcAlert]", toJsonSafe(payload, sink.verbose ?? false));
    return { sink: "console", ok: true };
  } catch (e: any) {
    return { sink: "console", ok: false, error: String(e?.message ?? e) };
  }
}

async function publishWebhook(payload: SpcAlertPayload, sink: SpcAlertSink): Promise<PublishResult> {
  if (!sink.url) return { sink: "webhook", ok: false, error: "missing url" };
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (sink.authorization) headers["authorization"] = sink.authorization;
    const res = await fetch(sink.url, {
      method: "POST",
      headers,
      body: toJsonSafe(payload, sink.verbose ?? true),
    });
    if (!res.ok) return { sink: "webhook", ok: false, error: `HTTP ${res.status}` };
    return { sink: "webhook", ok: true };
  } catch (e: any) {
    return { sink: "webhook", ok: false, error: String(e?.message ?? e) };
  }
}

async function publishMqtt(payload: SpcAlertPayload, sink: SpcAlertSink): Promise<PublishResult> {
  try {
    // Late-bind to avoid hard dependency at import time.
    const broker: any = (globalThis as any).__mqttBroker ?? null;
    if (!broker || typeof broker.publish !== "function") {
      return { sink: "mqtt", ok: false, error: "no mqtt broker bound (globalThis.__mqttBroker)" };
    }
    const topic = buildTopic(sink.topicTemplate, payload);
    await broker.publish(topic, toJsonSafe(payload, sink.verbose ?? false));
    return { sink: "mqtt", ok: true };
  } catch (e: any) {
    return { sink: "mqtt", ok: false, error: String(e?.message ?? e) };
  }
}

async function publishSocket(payload: SpcAlertPayload, _sink: SpcAlertSink): Promise<PublishResult> {
  try {
    const { emitSpcViolationAlert } = await import("../_core/socket");
    emitSpcViolationAlert({
      ruleId: String(payload.pointDefId),
      ruleName: payload.ruleName,
      severity: (payload.severity as any) === "critical" ? "critical" : (payload.severity as any) === "warning" ? "warning" : "info",
      metric: payload.ruleCode,
      pointIndices: payload.sampleIds,
      violationCount: payload.sampleIds.length,
      detectedAt: payload.windowTo,
      message: `${payload.ruleName} on point ${payload.pointDefId}`,
    });
    return { sink: "socket", ok: true };
  } catch (e: any) {
    return { sink: "socket", ok: false, error: String(e?.message ?? e) };
  }
}

/** Fan out a single violation to all sinks. Errors do not throw. */
export async function publishSpcAlert(
  payload: SpcAlertPayload,
  sinks: SpcAlertSink[],
): Promise<PublishResult[]> {
  if (!sinks || sinks.length === 0) return [];
  const tasks = sinks.map((s) => {
    switch (s.kind) {
      case "webhook": return publishWebhook(payload, s);
      case "mqtt": return publishMqtt(payload, s);
      case "socket": return publishSocket(payload, s);
      case "console":
      default: return publishConsole(payload, s);
    }
  });
  return Promise.all(tasks);
}

/** Fan out a batch of violations. Returns flattened results. */
export async function publishSpcAlertBatch(
  payloads: SpcAlertPayload[],
  sinks: SpcAlertSink[],
): Promise<PublishResult[]> {
  const all: PublishResult[] = [];
  for (const p of payloads) {
    const r = await publishSpcAlert(p, sinks);
    all.push(...r);
  }
  return all;
}

/** Resolve sink config from env. Returns [] if nothing configured. */
export function loadDefaultSinksFromEnv(): SpcAlertSink[] {
  const out: SpcAlertSink[] = [];
  const list = (process.env.SPC_ALERT_SINKS ?? "console").split(",").map((x) => x.trim()).filter(Boolean);
  for (const kind of list) {
    if (kind === "console") out.push({ kind: "console" });
    else if (kind === "socket") out.push({ kind: "socket" });
    else if (kind === "webhook" && process.env.SPC_ALERT_WEBHOOK_URL) {
      out.push({
        kind: "webhook",
        url: process.env.SPC_ALERT_WEBHOOK_URL,
        authorization: process.env.SPC_ALERT_WEBHOOK_AUTH,
      });
    } else if (kind === "mqtt") {
      out.push({
        kind: "mqtt",
        topicTemplate: process.env.SPC_ALERT_MQTT_TOPIC ?? "aoi/spc/alert/{pointDefId}",
      });
    }
  }
  return out;
}
