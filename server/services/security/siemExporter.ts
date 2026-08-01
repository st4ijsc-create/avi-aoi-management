/**
 * SIEM exporter (doc 44 G5.18 · SYNAPSE_Tang5 Ch.12) — forward security / audit
 * events to a SIEM via RFC 5424 syslog (UDP or TCP) OR a JSON webhook.
 *
 * SOURCE OF TRUTH: events are the ones the app ALREADY records in the tamper-
 * evident audit_log / hash-chain (login, policy DENY, actuation, config change).
 * This module only FORMATS + TRANSPORTS them out — it does NOT duplicate the
 * audit store. `auditRowToSiemEvent()` maps an existing audit_log row; the
 * anomalous-login detector + any other seam can also push a `SiemEvent` directly.
 *
 * FAIL-SAFE / NON-BREAKING: gated by SIEM_EXPORT_ENABLED (default OFF → every
 * export is a no-op, zero network). Sending is fire-and-forget and never throws,
 * so a dead SIEM collector can never break a login / command / config write.
 *
 * NO SDK / NO new dependency: `dgram` (UDP) + `net` (TCP) + `fetch` (webhook),
 * all built in.
 */
import { createSocket } from "node:dgram";
import { connect as netConnect } from "node:net";
import { hostname } from "node:os";

// ─── Types ────────────────────────────────────────────────────────────────────
export type SiemCategory = "auth" | "policy" | "actuation" | "config" | "security" | "audit";
export type SiemOutcome = "success" | "failure" | "deny";
/** RFC 5424 numeric severities (0=emergency … 7=debug). */
export type SiemSeverity = 3 | 4 | 5 | 6; // error | warning | notice | informational

export interface SiemEvent {
  /** Epoch ms of the event. */
  ts: number;
  category: SiemCategory;
  /** Short action code, e.g. "login", "policy.deny", "command.dispatch". */
  action: string;
  outcome: SiemOutcome;
  /** Actor id / name (user / service / device). */
  actor?: string;
  ip?: string;
  /** Structured detail (flattened into syslog SD-PARAMs + webhook body). */
  detail?: Record<string, unknown>;
  /** Override the derived severity. */
  severity?: SiemSeverity;
}

// ─── Config (call-time) ───────────────────────────────────────────────────────
function envStr(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env[name] ?? "").trim();
}

export function siemExportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = envStr("SIEM_EXPORT_ENABLED", env).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export type SiemTransport = "syslog-udp" | "syslog-tcp" | "webhook";

interface SiemConfig {
  transport: SiemTransport;
  host: string;
  port: number;
  webhookUrl: string;
  appName: string;
  facility: number;
  timeoutMs: number;
}

function readConfig(env: NodeJS.ProcessEnv = process.env): SiemConfig {
  const transportRaw = envStr("SIEM_TRANSPORT", env).toLowerCase();
  const transport: SiemTransport =
    transportRaw === "syslog-udp" || transportRaw === "syslog-tcp" || transportRaw === "webhook"
      ? (transportRaw as SiemTransport)
      : "webhook";
  const port = parseInt(envStr("SIEM_SYSLOG_PORT", env), 10);
  const facility = parseInt(envStr("SIEM_FACILITY", env), 10);
  const timeout = parseInt(envStr("SIEM_TIMEOUT_MS", env), 10);
  return {
    transport,
    host: envStr("SIEM_SYSLOG_HOST", env) || "127.0.0.1",
    port: Number.isFinite(port) && port > 0 ? port : 514,
    webhookUrl: envStr("SIEM_WEBHOOK_URL", env),
    appName: envStr("SIEM_APP_NAME", env) || "synapse-avi",
    // Default facility 13 = "log audit" (RFC 5424 §6.2.1).
    facility: Number.isFinite(facility) && facility >= 0 && facility <= 23 ? facility : 13,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 3_000,
  };
}

// ─── Severity derivation ──────────────────────────────────────────────────────
/** Map an event's category/outcome to an RFC 5424 severity (override wins). */
export function deriveSeverity(ev: SiemEvent): SiemSeverity {
  if (ev.severity != null) return ev.severity;
  if (ev.outcome === "deny") return 4; // warning — an explicit block
  if (ev.outcome === "failure") {
    // auth failures are security-relevant → warning; other failures → notice
    return ev.category === "auth" || ev.category === "security" ? 4 : 5;
  }
  if (ev.category === "actuation" || ev.category === "security") return 5; // notice
  return 6; // informational
}

// ─── RFC 5424 formatting (pure) ───────────────────────────────────────────────
const SD_ID = "synEvent@32473"; // 32473 = IANA "for documentation/example" PEN

/** Sanitize a token that must contain no spaces/control chars (APP-NAME, HOSTNAME…). */
function printableAscii(s: string, max = 48): string {
  const cleaned = (s || "-").replace(/[^\x21-\x7e]/g, "_");
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/** Escape an SD-PARAM value per RFC 5424 §6.3.3 (`"`, `\`, `]`). */
export function escapeSdValue(v: unknown): string {
  return String(v == null ? "" : v).replace(/([\\\]"])/g, "\\$1");
}

/** RFC 5424 timestamp (RFC 3339, ms precision, UTC). */
export function rfc5424Timestamp(ms: number): string {
  return new Date(ms).toISOString(); // e.g. 2026-07-12T04:05:06.789Z
}

function buildStructuredData(ev: SiemEvent): string {
  const params: Array<[string, unknown]> = [
    ["category", ev.category],
    ["action", ev.action],
    ["outcome", ev.outcome],
  ];
  if (ev.actor != null) params.push(["actor", ev.actor]);
  if (ev.ip != null) params.push(["ip", ev.ip]);
  for (const [k, val] of Object.entries(ev.detail ?? {})) {
    // Keep SD-PARAM names to RFC 5424 SD-NAME charset; skip objects (JSON them).
    const name = k.replace(/[^\x21-\x7e]/g, "_").replace(/[=\]" ]/g, "_").slice(0, 32);
    const value = val != null && typeof val === "object" ? JSON.stringify(val) : val;
    params.push([name, value]);
  }
  const kv = params.map(([k, v]) => `${k}="${escapeSdValue(v)}"`).join(" ");
  return `[${SD_ID} ${kv}]`;
}

/**
 * Format a full RFC 5424 syslog line:
 *   <PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [SD] MSG
 */
export function formatRfc5424(
  ev: SiemEvent,
  cfg: { appName: string; facility: number; host?: string } = { appName: "synapse-avi", facility: 13 },
): string {
  const severity = deriveSeverity(ev);
  const pri = cfg.facility * 8 + severity;
  const ts = rfc5424Timestamp(ev.ts);
  const host = printableAscii(cfg.host || hostname() || "-", 255);
  const app = printableAscii(cfg.appName, 48);
  const procid = String(process.pid || "-");
  const msgid = printableAscii(`${ev.category}.${ev.outcome}`, 32);
  const sd = buildStructuredData(ev);
  const msg = `${ev.action} outcome=${ev.outcome}${ev.actor ? ` actor=${ev.actor}` : ""}`;
  return `<${pri}>1 ${ts} ${host} ${app} ${procid} ${msgid} ${sd} ${msg}`;
}

/** Format the JSON webhook payload for one event. */
export function formatWebhookPayload(
  ev: SiemEvent,
  cfg: { appName: string; facility: number; host?: string } = { appName: "synapse-avi", facility: 13 },
): Record<string, unknown> {
  const severity = deriveSeverity(ev);
  return {
    "@timestamp": rfc5424Timestamp(ev.ts),
    app: cfg.appName,
    host: cfg.host || hostname(),
    facility: cfg.facility,
    severity,
    category: ev.category,
    action: ev.action,
    outcome: ev.outcome,
    actor: ev.actor ?? null,
    src_ip: ev.ip ?? null,
    detail: ev.detail ?? {},
  };
}

// ─── Transport (fire-and-forget, never throws) ────────────────────────────────
function sendUdp(line: string, cfg: SiemConfig): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      const sock = createSocket("udp4");
      const buf = Buffer.from(line, "utf8");
      const timer = setTimeout(() => {
        try { sock.close(); } catch { /* ignore */ }
        finish();
      }, cfg.timeoutMs);
      timer.unref?.();
      sock.send(buf, cfg.port, cfg.host, (err) => {
        clearTimeout(timer);
        if (err) console.warn("[security/siem] UDP send failed:", err.message);
        try { sock.close(); } catch { /* ignore */ }
        finish();
      });
    } catch (err) {
      console.warn("[security/siem] UDP transport error:", (err as Error).message);
      finish();
    }
  });
}

function sendTcp(line: string, cfg: SiemConfig): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      // RFC 6587 non-transparent framing: one message per LF-terminated line.
      const sock = netConnect({ host: cfg.host, port: cfg.port });
      sock.setTimeout(cfg.timeoutMs);
      sock.on("timeout", () => { sock.destroy(); finish(); });
      sock.on("error", (err) => { console.warn("[security/siem] TCP send failed:", err.message); finish(); });
      sock.on("connect", () => {
        sock.write(line + "\n", () => sock.end());
      });
      sock.on("close", finish);
    } catch (err) {
      console.warn("[security/siem] TCP transport error:", (err as Error).message);
      finish();
    }
  });
}

async function sendWebhook(ev: SiemEvent, cfg: SiemConfig): Promise<void> {
  if (!cfg.webhookUrl) {
    console.warn("[security/siem] SIEM_TRANSPORT=webhook but SIEM_WEBHOOK_URL is unset — event dropped.");
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formatWebhookPayload(ev, cfg)),
      signal: controller.signal,
    });
  } catch (err) {
    console.warn("[security/siem] webhook POST failed:", (err as Error)?.message ?? err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Export ONE event to the configured SIEM. No-op when disabled. Never throws.
 * Awaitable (so a caller can flush), but callers may fire-and-forget.
 */
export async function exportSiemEvent(ev: SiemEvent, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!siemExportEnabled(env)) return;
  const cfg = readConfig(env);
  try {
    if (cfg.transport === "webhook") {
      await sendWebhook(ev, cfg);
    } else {
      const line = formatRfc5424(ev, cfg);
      await (cfg.transport === "syslog-tcp" ? sendTcp(line, cfg) : sendUdp(line, cfg));
    }
  } catch (err) {
    console.warn("[security/siem] exportSiemEvent error:", (err as Error)?.message ?? err);
  }
}

// ─── Audit-log → SiemEvent mapping (no duplication of the audit store) ────────
interface AuditRowLike {
  action: string;
  status?: "success" | "failure" | string | null;
  userName?: string | null;
  userId?: number | null;
  ipAddress?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  entityName?: string | null;
  details?: string | Record<string, unknown> | null;
  createdAt?: Date | string | number | null;
}

const CONFIG_ACTIONS = new Set(["config_change", "role_change", "permission_change", "create", "update", "delete"]);
const ACTUATION_ACTIONS = new Set(["command.dispatch", "interlock_auto_block", "ai_action_executed", "deploy"]);

/** Classify an audit row's action into a SIEM category. */
export function categorizeAuditAction(action: string, entityType?: string | null): SiemCategory {
  const a = (action || "").toLowerCase();
  if (a === "login" || a === "logout" || a.startsWith("2fa") || a === "password_change" || a === "anomalous_login")
    return "auth";
  if (a.includes("policy")) return "policy";
  if (ACTUATION_ACTIONS.has(a) || a.startsWith("command") || a.includes("interlock")) return "actuation";
  if (CONFIG_ACTIONS.has(a) || (entityType && /config|role|permission/i.test(entityType))) return "config";
  return "audit";
}

/** Map an existing audit_log row to a SiemEvent (the "read the hash-chain" path). */
export function auditRowToSiemEvent(row: AuditRowLike): SiemEvent {
  const outcome: SiemOutcome = row.status === "failure" ? "failure" : "success";
  let detail: Record<string, unknown> | undefined;
  if (row.details) {
    if (typeof row.details === "string") {
      try { detail = JSON.parse(row.details) as Record<string, unknown>; } catch { detail = { raw: row.details }; }
    } else {
      detail = row.details as Record<string, unknown>;
    }
  }
  const ts =
    row.createdAt instanceof Date
      ? row.createdAt.getTime()
      : typeof row.createdAt === "number"
        ? row.createdAt
        : row.createdAt
          ? Date.parse(String(row.createdAt))
          : Date.now();
  return {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    category: categorizeAuditAction(row.action, row.entityType),
    action: row.action,
    outcome,
    actor: row.userName ?? (row.userId != null ? `user:${row.userId}` : undefined),
    ip: row.ipAddress ?? undefined,
    detail: {
      ...(row.entityType ? { entityType: row.entityType } : {}),
      ...(row.entityId != null ? { entityId: row.entityId } : {}),
      ...(row.entityName ? { entityName: row.entityName } : {}),
      ...(detail ?? {}),
    },
  };
}

/**
 * Forward the most-recent security-relevant audit rows to the SIEM. Reads from
 * the EXISTING audit store (db.getAuditLogs) — owner can run this on a cron to
 * stream audit to the SIEM without a parallel event pipeline. No-op when
 * SIEM_EXPORT_ENABLED is off. Never throws.
 */
export async function forwardRecentAuditToSiem(opts: { sinceMs?: number; limit?: number } = {}): Promise<number> {
  if (!siemExportEnabled()) return 0;
  try {
    const db = await import("../../db");
    const since = opts.sinceMs ? new Date(opts.sinceMs) : new Date(Date.now() - 5 * 60_000);
    const { logs } = await db.getAuditLogs({ startDate: since, limit: opts.limit ?? 500 });
    let sent = 0;
    for (const row of logs) {
      await exportSiemEvent(auditRowToSiemEvent(row));
      sent += 1;
    }
    return sent;
  } catch (err) {
    console.warn("[security/siem] forwardRecentAuditToSiem failed:", (err as Error)?.message ?? err);
    return 0;
  }
}
