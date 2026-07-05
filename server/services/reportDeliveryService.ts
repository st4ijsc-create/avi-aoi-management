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
  inApp?: { enabled: boolean; userIds?: number[] };
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

/** E-mail adapter: db smtp_config transporter first, env transporter fallback. */
async function deliverEmail(row: ReportDelivery, content: DeliverableReport): Promise<AdapterOutcome> {
  const recipients = row.target.split(",").map((s) => s.trim()).filter(Boolean);
  if (recipients.length === 0) return { ok: false, error: "no recipients" };
  try {
    const { getSmtpConfig } = await import("../db");
    const smtpConfig = await getSmtpConfig().catch(() => null);
    if (smtpConfig) {
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
    }
    // Fallback: the env-configured transporter (worker processes without db SMTP).
    const { sendEmail } = await import("../_core/email");
    const result = await sendEmail({
      to: recipients,
      subject: content.subject,
      html: content.html,
      attachments: content.attachment ? [content.attachment] : undefined,
    });
    return result.success ? { ok: true } : { ok: false, error: result.error ?? "email send failed" };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
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
