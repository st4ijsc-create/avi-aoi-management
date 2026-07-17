/**
 * W5-D (doc 27 §6 gap A11) — PLUGGABLE scheduled-report delivery with retry.
 * ════════════════════════════════════════════════════════════════════════════
 * Before this service, executeScheduledReport() sent e-mail directly and a
 * failure was only console.log'ed — no retry, no webhook, no in-app channel.
 *
 * Design (mirrors the erpOutbox discipline — DB-backed ledger + drain worker):
 *   • `report_deliveries` ledger (migration 0185): one row per report-run ×
 *     channel, status queued → sent | failed → dead.
 *   • Channel adapters:
 *       email   — same SMTP transport the scheduler always used
 *                 (db smtp_config first, _core/email env transporter fallback);
 *       webhook — POST report meta (+ attachment as base64 under a size cap)
 *                 with an HMAC-SHA256 signature header computed with the
 *                 per-report secret over the raw JSON body;
 *       in_app  — notifications table + socket emit via notificationService.
 *   • Retry with exponential backoff (attempts → nextAttemptAt); a row that
 *     exhausts REPORT_DELIVERY_MAX_ATTEMPTS is dead-lettered + alert-logged.
 *   • Drain worker registered in server/_core/backgroundJobs.ts (the W4-D
 *     scheduler home). Default ON (deliveries must drain once an admin
 *     configures channels); escape hatch REPORT_DELIVERY_WORKER_ENABLED=false.
 *
 * DEFAULT-UNCHANGED GUARANTEE: nothing here runs for a report whose
 * `deliveryChannels` is NULL/absent — reportScheduler keeps its legacy
 * direct-e-mail path for those rows (see hasConfiguredChannels()).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHmac } from "node:crypto";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { reportDeliveries, type ReportDelivery } from "../../drizzle/schema";

// ── Channel config (stored on scheduled_reports.deliveryChannels) ────────────

export interface DeliveryChannelsConfig {
  email?: { enabled: boolean };
  webhook?: { enabled: boolean; url: string; secret?: string };
  inApp?: {
    enabled: boolean;
    userIds?: number[];
    /**
     * doc 54 P2.4 #4 — optional mobile-push device tokens delivered ALONGSIDE the
     * in-app notification (best-effort). Requires a push transport (FCM) to be
     * configured; when absent the push is skipped and the in-app notification is
     * unaffected. Stored on scheduled_reports.deliveryChannels (jsonb).
     */
    pushTokens?: string[];
  };
  /** Alternate placement for mobile-push tokens (equivalent to inApp.pushTokens). */
  push?: { enabled?: boolean; tokens?: string[] };
}

export type DeliveryChannel = "email" | "webhook" | "in_app";

/**
 * True when the report has OPTED IN to channel-based delivery (at least one
 * channel explicitly enabled). NULL/absent/empty config → false → the caller
 * MUST keep the legacy direct-e-mail behaviour (default unchanged).
 */
export function hasConfiguredChannels(config: unknown): config is DeliveryChannelsConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as DeliveryChannelsConfig;
  return Boolean(
    c.email?.enabled ||
    (c.webhook?.enabled && typeof c.webhook.url === "string" && c.webhook.url.length > 0) ||
    c.inApp?.enabled,
  );
}

// ── Tunables (env-overridable) ────────────────────────────────────────────────

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Max delivery attempts before a ledger row is dead-lettered. */
export const REPORT_DELIVERY_MAX_ATTEMPTS = intEnv("REPORT_DELIVERY_MAX_ATTEMPTS", 5);
/** Base backoff (ms) — delay = BASE * 2^(attempts-1), capped. */
const BACKOFF_BASE_MS = intEnv("REPORT_DELIVERY_BACKOFF_BASE_MS", 30_000);
const BACKOFF_CAP_MS = intEnv("REPORT_DELIVERY_BACKOFF_CAP_MS", 30 * 60_000); // 30 min
/** Per-poll drain batch size. */
const BATCH_SIZE = intEnv("REPORT_DELIVERY_BATCH_SIZE", 20);
/** Drain worker poll interval. */
const POLL_INTERVAL_MS = intEnv("REPORT_DELIVERY_POLL_MS", 30_000);
/** Webhook HTTP timeout. */
const WEBHOOK_TIMEOUT_MS = intEnv("REPORT_DELIVERY_WEBHOOK_TIMEOUT_MS", 10_000);
/** Attachment-as-base64 size cap for webhook delivery (bytes of the raw file). */
export const WEBHOOK_ATTACHMENT_MAX_BYTES = intEnv(
  "REPORT_DELIVERY_WEBHOOK_ATTACHMENT_MAX_BYTES",
  2 * 1024 * 1024, // 2 MB
);

export function backoffDelayMs(attempts: number): number {
  const d = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(d, BACKOFF_CAP_MS);
}

// ── Built-report payload the adapters deliver ─────────────────────────────────

export interface DeliverableReport {
  reportId: number;
  reportName: string;
  reportType: string;
  subject: string;
  html: string;
  attachment?: { filename: string; content: Buffer | string; contentType: string };
}

// In-process content store: the ledger keeps meta only (subject/attachment
// name) — the heavy HTML/attachment lives in memory for the retry window and
// is REBUILT from the report row if the process restarted in between.
const contentCache = new Map<number, DeliverableReport>();

/** Test hook: clear the in-process content cache. */
export function _clearContentCache(): void {
  contentCache.clear();
}

// ── Enqueue (called by reportScheduler after generation) ──────────────────────

export interface EnqueueDeliveriesResult {
  ok: boolean;
  deliveryIds: number[];
  channels: DeliveryChannel[];
  reason?: string;
}

/**
 * Persist one queued ledger row per enabled channel for a generated report.
 * Fail-safe: never throws (the scheduler must not die on a delivery problem).
 */
export async function enqueueReportDeliveries(
  report: {
    id: number;
    name: string;
    reportType: string;
    recipients: string[] | null;
    createdBy: number;
    deliveryChannels: unknown;
  },
  built: { subject: string; html: string; attachment?: DeliverableReport["attachment"] },
): Promise<EnqueueDeliveriesResult> {
  try {
    if (!hasConfiguredChannels(report.deliveryChannels)) {
      return { ok: false, deliveryIds: [], channels: [], reason: "no channels configured" };
    }
    const config = report.deliveryChannels as DeliveryChannelsConfig;
    const db = await getDb();
    if (!db) return { ok: false, deliveryIds: [], channels: [], reason: "db unavailable" };

    const rows: Array<{ channel: DeliveryChannel; target: string }> = [];
    if (config.email?.enabled) {
      const recipients = (report.recipients ?? []).filter(Boolean);
      if (recipients.length > 0) rows.push({ channel: "email", target: recipients.join(",") });
    }
    if (config.webhook?.enabled && config.webhook.url) {
      rows.push({ channel: "webhook", target: config.webhook.url });
    }
    if (config.inApp?.enabled) {
      const userIds =
        Array.isArray(config.inApp.userIds) && config.inApp.userIds.length > 0
          ? config.inApp.userIds
          : [report.createdBy];
      rows.push({ channel: "in_app", target: userIds.join(",") });
    }
    if (rows.length === 0) {
      return { ok: false, deliveryIds: [], channels: [], reason: "no deliverable targets" };
    }

    const payloadMeta = {
      subject: built.subject,
      reportName: report.name,
      reportType: report.reportType,
      attachmentName: built.attachment?.filename ?? null,
      attachmentBytes: built.attachment
        ? Buffer.isBuffer(built.attachment.content)
          ? built.attachment.content.length
          : Buffer.byteLength(String(built.attachment.content))
        : null,
    };

    const inserted = await db
      .insert(reportDeliveries)
      .values(
        rows.map((r) => ({
          scheduledReportId: report.id,
          channel: r.channel,
          target: r.target,
          status: "queued",
          attempts: 0,
          nextAttemptAt: new Date(),
          payloadMeta,
        })),
      )
      .returning({ id: reportDeliveries.id, channel: reportDeliveries.channel });

    const deliverable: DeliverableReport = {
      reportId: report.id,
      reportName: report.name,
      reportType: report.reportType,
      subject: built.subject,
      html: built.html,
      attachment: built.attachment,
    };
    for (const row of inserted) contentCache.set(row.id, deliverable);

    return {
      ok: true,
      deliveryIds: inserted.map((r) => r.id),
      channels: inserted.map((r) => r.channel as DeliveryChannel),
    };
  } catch (err) {
    console.error("[ReportDelivery] enqueue failed:", (err as Error)?.message ?? err);
    return { ok: false, deliveryIds: [], channels: [], reason: (err as Error)?.message ?? String(err) };
  }
}

// ── Content resolution (retry across restarts) ────────────────────────────────

/**
 * Content for a ledger row: in-process cache first; on a cold process, rebuild
 * from the scheduled_reports row via the shared builder (same content the cron
 * would produce for the current window).
 */
async function resolveContent(row: ReportDelivery): Promise<DeliverableReport | null> {
  const cached = contentCache.get(row.id);
  if (cached) return cached;
  try {
    const { getScheduledReportById } = await import("../db");
    const report = await getScheduledReportById(row.scheduledReportId);
    if (!report) return null;
    const { buildScheduledReportEmail } = await import("./reportScheduler");
    const built = await buildScheduledReportEmail(report as never);
    const deliverable: DeliverableReport = {
      reportId: report.id,
      reportName: report.name,
      reportType: report.reportType,
      subject: built.subject,
      html: built.html,
      attachment: built.attachment,
    };
    contentCache.set(row.id, deliverable);
    return deliverable;
  } catch (err) {
    console.error("[ReportDelivery] content rebuild failed:", (err as Error)?.message ?? err);
    return null;
  }
}

// ── Channel adapters ──────────────────────────────────────────────────────────

export interface AdapterOutcome {
  ok: boolean;
  error?: string;
}

// ── Optional email-fallback transports (credential-gated, doc 54 P2.4 #4) ─────
// The default transports (db smtp_config → env SMTP) are unchanged. When a
// message can't be delivered through them AND a fallback provider is configured
// via env, the chain falls through to it. When NO transport is configured the
// adapter returns a clear, RETRYABLE error — it never fabricates success.

/** True when a SendGrid API key is configured. */
export function sendGridConfigured(): boolean {
  return !!process.env.SENDGRID_API_KEY;
}

/** True when Amazon SES is reachable via its SMTP interface (host+user+pass). */
export function sesSmtpConfigured(): boolean {
  return !!(process.env.SES_SMTP_HOST && process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS);
}

/** Resolve the fallback From address across the supported env conventions. */
function fallbackFromAddress(): string {
  return (
    process.env.REPORT_EMAIL_FROM ||
    process.env.SENDGRID_FROM ||
    process.env.SES_FROM ||
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    "no-reply@localhost"
  );
}

/** SendGrid v3 mail/send (bearer token, no SDK). Attachment inlined as base64. */
async function sendViaSendGrid(recipients: string[], content: DeliverableReport): Promise<AdapterOutcome> {
  try {
    const apiKey = process.env.SENDGRID_API_KEY as string;
    const body: Record<string, unknown> = {
      personalizations: [{ to: recipients.map((email) => ({ email })) }],
      from: { email: fallbackFromAddress() },
      subject: content.subject,
      content: [{ type: "text/html", value: content.html }],
    };
    if (content.attachment) {
      const buf = Buffer.isBuffer(content.attachment.content)
        ? content.attachment.content
        : Buffer.from(String(content.attachment.content));
      body.attachments = [
        {
          content: buf.toString("base64"),
          filename: content.attachment.filename,
          type: content.attachment.contentType,
          disposition: "attachment",
        },
      ];
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (resp.status >= 200 && resp.status < 300) return { ok: true };
      const txt = await resp.text().catch(() => "");
      return { ok: false, error: `sendgrid HTTP ${resp.status} ${txt.slice(0, 200)}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/** Amazon SES via its SMTP endpoint (nodemailer) — avoids SigV4 / the AWS SDK. */
async function sendViaSesSmtp(recipients: string[], content: DeliverableReport): Promise<AdapterOutcome> {
  try {
    const { createTransporterFromConfig } = await import("../_core/email");
    const port = Number(process.env.SES_SMTP_PORT) || 587;
    const fromName = process.env.REPORT_EMAIL_FROM_NAME || "SYNAPSE Reports";
    const transporter = createTransporterFromConfig({
      host: process.env.SES_SMTP_HOST as string,
      port,
      secure: port === 465,
      username: process.env.SES_SMTP_USER as string,
      password: process.env.SES_SMTP_PASS as string,
      fromEmail: fallbackFromAddress(),
      fromName,
    });
    const mailOptions: Record<string, unknown> = {
      from: `${fromName} <${fallbackFromAddress()}>`,
      to: recipients.join(","),
      subject: content.subject,
      html: content.html,
    };
    if (content.attachment) mailOptions.attachments = [content.attachment];
    await transporter.sendMail(mailOptions as never);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/**
 * E-mail adapter with a transport chain (doc 54 P2.4 #4), never fabricating
 * success:
 *   1. db smtp_config transporter — the unchanged default. When configured it is
 *      THE transport: success → ok, failure → a RETRYABLE error (NOT a silent
 *      fallthrough — a real SMTP outage should retry, not mask via another
 *      provider).
 *   2. env SMTP transporter (_core/email sendEmail) — the historical fallback
 *      used when db SMTP is absent.
 *   3+4. Credential-gated fallbacks (SendGrid → SES-over-SMTP) — engaged only
 *      when the SMTP paths are unavailable/unconfigured and the provider env is
 *      actually set. When none is configured the caller gets a clear, retryable
 *      "no email transport configured" error.
 */
async function deliverEmail(row: ReportDelivery, content: DeliverableReport): Promise<AdapterOutcome> {
  const recipients = row.target.split(",").map((s) => s.trim()).filter(Boolean);
  if (recipients.length === 0) return { ok: false, error: "no recipients" };

  // 1) db smtp_config transporter — authoritative when configured.
  try {
    const { getSmtpConfig } = await import("../db");
    const smtpConfig = await getSmtpConfig().catch(() => null);
    if (smtpConfig) {
      try {
        const { createTransporterFromConfig } = await import("../_core/email");
        const transporter = createTransporterFromConfig(smtpConfig);
        const mailOptions: Record<string, unknown> = {
          from: `${smtpConfig.fromName} <${smtpConfig.fromEmail}>`,
          to: recipients.join(","),
          subject: content.subject,
          html: content.html,
        };
        if (content.attachment) mailOptions.attachments = [content.attachment];
        await transporter.sendMail(mailOptions as never);
        return { ok: true };
      } catch (err) {
        // Configured transport failed → retry it, don't mask with a fallback.
        return { ok: false, error: `smtp: ${(err as Error)?.message ?? err}` };
      }
    }
  } catch {
    /* db smtp lookup failed → fall through to the env transporter / fallbacks */
  }

  // 2) env SMTP transporter (historical fallback when db SMTP is absent).
  const { sendEmail } = await import("../_core/email");
  const envResult = await sendEmail({
    to: recipients,
    subject: content.subject,
    html: content.html,
    attachments: content.attachment ? [content.attachment] : undefined,
  }).catch((e) => ({ success: false as const, error: (e as Error)?.message ?? String(e) }));
  if (envResult.success) return { ok: true };

  // 3+4) Credential-gated fallbacks (SendGrid → SES over SMTP).
  const errors: string[] = [`smtp(env): ${envResult.error ?? "send failed"}`];
  if (sendGridConfigured()) {
    const r = await sendViaSendGrid(recipients, content);
    if (r.ok) return { ok: true };
    errors.push(r.error ?? "sendgrid failed");
  }
  if (sesSmtpConfigured()) {
    const r = await sendViaSesSmtp(recipients, content);
    if (r.ok) return { ok: true };
    errors.push(r.error ?? "ses failed");
  }

  if (!sendGridConfigured() && !sesSmtpConfigured()) {
    console.warn(
      "[ReportDelivery] no email transport configured (SMTP_* / SENDGRID_API_KEY / SES_SMTP_*) — report email will retry",
    );
  }
  return { ok: false, error: errors.join("; ") };
}

/** HMAC-SHA256 signature over the raw body with the per-report secret. */
export function webhookSignature(secret: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Webhook adapter: POST report meta + inline HTML; the attachment rides along
 * as base64 when it fits under WEBHOOK_ATTACHMENT_MAX_BYTES (otherwise only
 * its name/size are announced — doc 30 documents the size cap).
 */
async function deliverWebhook(row: ReportDelivery, content: DeliverableReport): Promise<AdapterOutcome> {
  const url = row.target;
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "invalid webhook url" };

  let attachmentPayload: Record<string, unknown> | null = null;
  if (content.attachment) {
    const buf = Buffer.isBuffer(content.attachment.content)
      ? content.attachment.content
      : Buffer.from(String(content.attachment.content));
    attachmentPayload = {
      filename: content.attachment.filename,
      contentType: content.attachment.contentType,
      bytes: buf.length,
      // Under the cap → inline base64; over → meta only (truncated: true).
      ...(buf.length <= WEBHOOK_ATTACHMENT_MAX_BYTES
        ? { contentBase64: buf.toString("base64") }
        : { contentBase64: null, truncated: true }),
    };
  }

  const body = JSON.stringify({
    event: "report.generated",
    deliveryId: row.id,
    reportId: content.reportId,
    reportName: content.reportName,
    reportType: content.reportType,
    subject: content.subject,
    generatedAt: new Date().toISOString(),
    html: content.html,
    attachment: attachmentPayload,
  });

  // Per-report secret comes from the report's channel config (re-read so a
  // rotated secret takes effect on retries).
  let secret = "";
  try {
    const { getScheduledReportById } = await import("../db");
    const report = await getScheduledReportById(row.scheduledReportId);
    const cfg = (report as { deliveryChannels?: DeliveryChannelsConfig } | undefined)?.deliveryChannels;
    secret = cfg?.webhook?.secret ?? "";
  } catch {
    /* deliver unsigned when the config is unreadable */
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Report-Delivery-Id": String(row.id),
    "X-Report-Id": String(content.reportId),
  };
  if (secret) headers["X-Report-Signature"] = webhookSignature(secret, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    if (resp.ok) return { ok: true };
    return { ok: false, error: `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Optional mobile-push transport (credential-gated, doc 54 P2.4 #4) ─────────
// Push is a BONUS layer on the in-app channel: when a push transport is
// configured AND the report carries device tokens, an in-app delivery ALSO fires
// a mobile push; when neither is present it logs "transport not configured" and
// the in-app notification still succeeds (no throw, no fabricated success).

let pushUnconfiguredLogged = false;

/** True when Firebase Cloud Messaging is configured (matches fcmService env). */
export function fcmPushConfigured(): boolean {
  return !!(process.env.FIREBASE_SERVICE_ACCOUNT_JSON && process.env.FIREBASE_PROJECT_ID);
}

/** True when a standalone APNs key is configured (see deliverReportPush note). */
export function apnsPushConfigured(): boolean {
  return !!(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    process.env.APNS_BUNDLE_ID &&
    process.env.APNS_AUTH_KEY_BASE64
  );
}

export interface PushTransportStatus {
  fcm: boolean;
  apns: boolean;
  configured: boolean;
}

/** Which push transports are available right now (for health/admin surfaces). */
export function pushTransportStatus(): PushTransportStatus {
  const fcm = fcmPushConfigured();
  const apns = apnsPushConfigured();
  return { fcm, apns, configured: fcm || apns };
}

export function pushTransportConfigured(): boolean {
  return fcmPushConfigured() || apnsPushConfigured();
}

export interface PushOutcome {
  ok: boolean;
  /** True when nothing was attempted (no transport / no tokens) — NOT a failure. */
  skipped?: boolean;
  sent?: number;
  error?: string;
}

/**
 * Best-effort mobile push for a report. NEVER throws and never fabricates
 * success. When no push transport is configured, logs once and returns
 * { ok:false, skipped:true }. FCM (which itself bridges to APNs via its `apns`
 * payload) is the delivery transport; a config with ONLY APNS_* set is
 * acknowledged but not delivered here — a standalone APNs HTTP/2 transport is
 * intentionally out of scope, route iOS pushes through FCM instead.
 */
export async function deliverReportPush(
  tokens: string[],
  msg: { title: string; body: string; data?: Record<string, string> },
): Promise<PushOutcome> {
  const status = pushTransportStatus();
  if (!status.configured) {
    if (!pushUnconfiguredLogged) {
      console.log(
        "[ReportDelivery] push transport not configured — skipping mobile push " +
          "(set FIREBASE_SERVICE_ACCOUNT_JSON + FIREBASE_PROJECT_ID to enable FCM). " +
          "In-app notifications are unaffected.",
      );
      pushUnconfiguredLogged = true;
    }
    return { ok: false, skipped: true, error: "push transport not configured" };
  }

  const validTokens = tokens.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean);
  if (validTokens.length === 0) return { ok: false, skipped: true, error: "no device tokens" };

  if (status.fcm) {
    try {
      const { sendCustomPushNotification } = await import("./fcmService");
      const { sent } = await sendCustomPushNotification(validTokens, msg.title, msg.body, msg.data);
      return sent > 0
        ? { ok: true, sent }
        : { ok: false, sent: 0, error: `fcm delivered 0/${validTokens.length}` };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  }

  // APNS_* set but FCM is not — FCM is the supported delivery bridge for iOS.
  console.warn(
    "[ReportDelivery] APNS_* is set but a standalone APNs transport is not implemented — " +
      "configure FCM (FIREBASE_*) to deliver iOS pushes (FCM bridges to APNs).",
  );
  return { ok: false, skipped: true, error: "apns standalone transport not implemented (use FCM)" };
}

/** Resolve mobile-push device tokens for a delivery from its report's config. */
async function resolvePushTokensForDelivery(row: ReportDelivery): Promise<string[]> {
  try {
    const { getScheduledReportById } = await import("../db");
    const report = await getScheduledReportById(row.scheduledReportId);
    const cfg = (report as { deliveryChannels?: DeliveryChannelsConfig } | undefined)?.deliveryChannels;
    const fromPush = Array.isArray(cfg?.push?.tokens) ? cfg?.push?.tokens : undefined;
    const fromInApp = Array.isArray(cfg?.inApp?.pushTokens) ? cfg?.inApp?.pushTokens : undefined;
    const tokens = fromPush ?? fromInApp ?? [];
    return tokens.filter((t): t is string => typeof t === "string" && t.length > 0);
  } catch {
    return [];
  }
}

/** In-app adapter: notifications table + socket emit via notificationService. */
async function deliverInApp(row: ReportDelivery, content: DeliverableReport): Promise<AdapterOutcome> {
  const userIds = row.target
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (userIds.length === 0) return { ok: false, error: "no user ids" };
  try {
    const { sendReportNotification } = await import("./notificationService");
    let delivered = 0;
    for (const userId of userIds) {
      const result = await sendReportNotification(userId, {
        title: content.subject,
        message: `${content.reportName} (${content.reportType})`,
        reportId: content.reportId,
        actionUrl: "/scheduled-reports",
      }).catch(() => null);
      if (result) delivered += 1;
    }

    // Best-effort mobile push ALONGSIDE the in-app notification (doc 54 P2.4 #4).
    // Only attempts when a push transport is configured — so the default path
    // makes no extra DB call and behaves exactly as before. Push failure NEVER
    // fails the in-app delivery (the task's "fall back to in-app without throw").
    if (pushTransportConfigured()) {
      try {
        const tokens = await resolvePushTokensForDelivery(row);
        if (tokens.length > 0) {
          const push = await deliverReportPush(tokens, {
            title: content.subject,
            body: `${content.reportName} (${content.reportType})`,
            data: { type: "REPORT", reportId: String(content.reportId) },
          });
          if (push.ok) {
            console.log(`[ReportDelivery] in_app push sent for delivery ${row.id} (${push.sent} device(s))`);
          }
        }
      } catch {
        /* push is best-effort — never affects the in-app outcome */
      }
    }

    // User notification preferences may legitimately suppress every recipient —
    // that is a SUCCESSFUL delivery of a suppressed notification, not a failure.
    return { ok: true, error: delivered === 0 ? "all recipients suppressed by preferences" : undefined };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/** Route one ledger row through its channel adapter. */
export async function deliverOne(row: ReportDelivery, content: DeliverableReport): Promise<AdapterOutcome> {
  switch (row.channel as DeliveryChannel) {
    case "email":
      return deliverEmail(row, content);
    case "webhook":
      return deliverWebhook(row, content);
    case "in_app":
      return deliverInApp(row, content);
    default:
      return { ok: false, error: `unknown channel "${row.channel}"` };
  }
}

// ── Drain (retry with backoff → dead-letter) ──────────────────────────────────

export interface DeliveryDrainResult {
  picked: number;
  sent: number;
  failed: number;
  dead: number;
}

/**
 * Drain one batch of due ledger rows. Exported so tests can drive it
 * deterministically (no timer). Fail-safe — never throws.
 */
export async function drainReportDeliveriesOnce(now = new Date()): Promise<DeliveryDrainResult> {
  const result: DeliveryDrainResult = { picked: 0, sent: 0, failed: 0, dead: 0 };
  try {
    const db = await getDb();
    if (!db) return result;

    const due = await db
      .select()
      .from(reportDeliveries)
      .where(
        and(
          inArray(reportDeliveries.status, ["queued", "failed"]),
          lte(reportDeliveries.nextAttemptAt, now),
        ),
      )
      .orderBy(reportDeliveries.nextAttemptAt)
      .limit(BATCH_SIZE);

    result.picked = due.length;

    for (const row of due) {
      const content = await resolveContent(row as ReportDelivery);
      const outcome: AdapterOutcome = content
        ? await deliverOne(row as ReportDelivery, content)
        : { ok: false, error: "report content unavailable (report deleted?)" };

      const attempts = (row.attempts ?? 0) + 1;
      if (outcome.ok) {
        await db
          .update(reportDeliveries)
          .set({ status: "sent", sentAt: new Date(), attempts, lastError: outcome.error ?? null, updatedAt: new Date() })
          .where(eq(reportDeliveries.id, row.id));
        contentCache.delete(row.id);
        result.sent += 1;
        continue;
      }

      const lastError = (outcome.error ?? "delivery failed").slice(0, 1000);
      if (attempts >= REPORT_DELIVERY_MAX_ATTEMPTS) {
        await db
          .update(reportDeliveries)
          .set({ status: "dead", attempts, lastError, updatedAt: new Date() })
          .where(eq(reportDeliveries.id, row.id));
        contentCache.delete(row.id);
        result.dead += 1;
        // Alert log — the erpOutbox dead-letter discipline.
        console.error(
          `[ReportDelivery] DEAD-LETTER: delivery ${row.id} (report ${row.scheduledReportId}, ` +
            `channel ${row.channel}) exhausted ${attempts} attempts — last error: ${lastError}`,
        );
      } else {
        const next = new Date(now.getTime() + backoffDelayMs(attempts));
        await db
          .update(reportDeliveries)
          .set({ status: "failed", attempts, nextAttemptAt: next, lastError, updatedAt: new Date() })
          .where(eq(reportDeliveries.id, row.id));
        result.failed += 1;
      }
    }
  } catch (err) {
    console.error("[ReportDelivery] drain failed:", (err as Error)?.message ?? err);
  }
  return result;
}

// ── History / admin surface (tRPC uses these) ─────────────────────────────────

/** Delivery history for one report (newest first) — the UI drawer. */
export async function listReportDeliveries(
  scheduledReportId: number,
  limit = 50,
): Promise<ReportDelivery[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    return await db
      .select()
      .from(reportDeliveries)
      .where(eq(reportDeliveries.scheduledReportId, scheduledReportId))
      .orderBy(desc(reportDeliveries.createdAt), desc(reportDeliveries.id))
      .limit(Math.min(Math.max(limit, 1), 200));
  } catch (err) {
    console.error("[ReportDelivery] list failed:", (err as Error)?.message ?? err);
    return [];
  }
}

/** Requeue a dead/failed delivery for another attempt round (admin action). */
export async function retryReportDelivery(deliveryId: number): Promise<{ ok: boolean; reason?: string }> {
  try {
    const db = await getDb();
    if (!db) return { ok: false, reason: "db unavailable" };
    const rows = await db
      .update(reportDeliveries)
      .set({ status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(reportDeliveries.id, deliveryId), inArray(reportDeliveries.status, ["dead", "failed"])))
      .returning({ id: reportDeliveries.id });
    return rows.length > 0 ? { ok: true } : { ok: false, reason: "not found or not retryable" };
  } catch (err) {
    return { ok: false, reason: (err as Error)?.message ?? String(err) };
  }
}

/** Ledger counts for health/admin surfaces. */
export async function reportDeliveryStats(): Promise<Record<string, number>> {
  try {
    const db = await getDb();
    if (!db) return {};
    const rows = await db
      .select({ status: reportDeliveries.status, count: sql<number>`count(*)` })
      .from(reportDeliveries)
      .groupBy(reportDeliveries.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  } catch {
    return {};
  }
}

// ── Background worker (registered in _core/backgroundJobs.ts) ─────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let draining = false;

/** Default ON; escape hatch REPORT_DELIVERY_WORKER_ENABLED=false. */
export function reportDeliveryWorkerEnabled(): boolean {
  return process.env.REPORT_DELIVERY_WORKER_ENABLED !== "false";
}

export function startReportDeliveryWorker(): void {
  if (timer) return;
  if (!reportDeliveryWorkerEnabled()) {
    console.log("[ReportDelivery] worker disabled (REPORT_DELIVERY_WORKER_ENABLED=false)");
    return;
  }
  console.log(
    `[ReportDelivery] worker started — polling every ${POLL_INTERVAL_MS}ms ` +
      `(maxAttempts=${REPORT_DELIVERY_MAX_ATTEMPTS})`,
  );
  timer = setInterval(async () => {
    if (draining) return;
    draining = true;
    try {
      await drainReportDeliveriesOnce();
    } finally {
      draining = false;
    }
  }, POLL_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
}

export function stopReportDeliveryWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
