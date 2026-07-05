/**
 * W5-D (doc 27 §6 A11) — report delivery service tests.
 *
 * Drives enqueue + drainReportDeliveriesOnce() against a minimal drizzle-shaped
 * fake DB (the erpOutbox test discipline), asserting:
 *   • hasConfiguredChannels: NULL/absent/empty config = legacy (false);
 *   • enqueue writes one queued ledger row per enabled channel with the right target;
 *   • webhook success → sent, request carries the HMAC signature header;
 *   • webhook failure → retry with backoff (attempts+1, nextAttemptAt in the
 *     future) → dead-letter after REPORT_DELIVERY_MAX_ATTEMPTS;
 *   • email adapter uses the db SMTP transporter, env-transporter fallback when
 *     no db SMTP config exists;
 *   • in-app adapter writes notifications per user id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

// ── Fake report_deliveries store ──────────────────────────────────────────────
interface Row {
  id: number;
  scheduledReportId: number;
  channel: string;
  target: string;
  status: string;
  attempts: number;
  lastError: string | null;
  payloadMeta: unknown;
  nextAttemptAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
let rows: Row[] = [];
let nextId = 1;

function dueRows(): Row[] {
  return rows.filter((r) => r.status === "queued" || r.status === "failed");
}

/** Find the id inside a fake predicate tuple (eq → ["id", X]; and → nested). */
function predId(pred: unknown): number | undefined {
  if (!Array.isArray(pred)) return undefined;
  if (pred[0] === "id" && typeof pred[1] === "number") return pred[1];
  for (const p of pred) {
    const found = predId(p);
    if (found !== undefined) return found;
  }
  return undefined;
}

function makeFakeDb() {
  return {
    insert: (_table: unknown) => ({
      values: (vals: unknown) => {
        const arr = (Array.isArray(vals) ? vals : [vals]) as Array<Partial<Row>>;
        const inserted = arr.map((v) => {
          const row: Row = {
            id: nextId++,
            scheduledReportId: v.scheduledReportId ?? 0,
            channel: v.channel ?? "email",
            target: v.target ?? "",
            status: v.status ?? "queued",
            attempts: v.attempts ?? 0,
            lastError: null,
            payloadMeta: v.payloadMeta ?? null,
            nextAttemptAt: v.nextAttemptAt ?? new Date(),
            sentAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          rows.push(row);
          return row;
        });
        return {
          returning: async () => inserted.map((r) => ({ id: r.id, channel: r.channel })),
          then: (res: (v: unknown) => void) => res(undefined),
        };
      },
    }),
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_pred: unknown) => ({
          orderBy: (..._o: unknown[]) => ({
            limit: async (_n: number) => dueRows(),
          }),
          limit: async (_n: number) => dueRows(),
        }),
        groupBy: async () => [],
      }),
    }),
    update: (_table: unknown) => ({
      set: (vals: Partial<Row>) => ({
        where: (pred: unknown) => {
          const apply = () => {
            const id = predId(pred);
            const row = rows.find((r) => r.id === id);
            if (row) Object.assign(row, vals);
            return row ? [{ id: row.id }] : [];
          };
          return {
            returning: async () => apply(),
            then: (res: (v: unknown) => void) => {
              apply();
              res(undefined);
            },
          };
        },
      }),
    }),
  };
}

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

vi.mock("../../drizzle/schema", () => ({
  reportDeliveries: {
    id: "id",
    scheduledReportId: "scheduledReportId",
    channel: "channel",
    target: "target",
    status: "status",
    attempts: "attempts",
    lastError: "lastError",
    payloadMeta: "payloadMeta",
    nextAttemptAt: "nextAttemptAt",
    sentAt: "sentAt",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  desc: (...a: unknown[]) => a,
  lte: (...a: unknown[]) => a,
  inArray: (...a: unknown[]) => a,
  sql: Object.assign((..._a: unknown[]) => ["sql"], { raw: (..._a: unknown[]) => ["sql"] }),
}));

// ── Adapters' dynamic-import dependencies ────────────────────────────────────
const h = vi.hoisted(() => ({
  sendMailMock: vi.fn(async () => ({ messageId: "m1" })),
  sendEmailMock: vi.fn(async () => ({ success: true, messageId: "m2" })),
  sendReportNotificationMock: vi.fn(async () => ({ id: 77 })),
  smtpConfig: {
    host: "smtp.test",
    port: 587,
    secure: false,
    username: "u",
    password: "p",
    fromEmail: "noreply@test",
    fromName: "Test",
  } as Record<string, unknown> | null,
  reportRow: null as Record<string, unknown> | null,
}));

vi.mock("../db", () => ({
  getSmtpConfig: vi.fn(async () => h.smtpConfig),
  getScheduledReportById: vi.fn(async () => h.reportRow),
}));

vi.mock("../_core/email", () => ({
  createTransporterFromConfig: vi.fn(() => ({ sendMail: h.sendMailMock })),
  sendEmail: h.sendEmailMock,
}));

vi.mock("./notificationService", () => ({
  sendReportNotification: h.sendReportNotificationMock,
}));

import {
  hasConfiguredChannels,
  enqueueReportDeliveries,
  drainReportDeliveriesOnce,
  webhookSignature,
  backoffDelayMs,
  REPORT_DELIVERY_MAX_ATTEMPTS,
  listReportDeliveries,
  retryReportDelivery,
  _clearContentCache,
} from "./reportDeliveryService";

const REPORT = {
  id: 42,
  name: "NG hàng ngày",
  reportType: "NG_VISUAL",
  recipients: ["qa@example.com", "sup@example.com"],
  createdBy: 7,
  deliveryChannels: null as unknown,
};

const BUILT = { subject: "NG hàng ngày - 04/07/2026", html: "<h1>report</h1>" };

beforeEach(() => {
  rows = [];
  nextId = 1;
  h.smtpConfig = {
    host: "smtp.test", port: 587, secure: false, username: "u", password: "p",
    fromEmail: "noreply@test", fromName: "Test",
  };
  h.reportRow = null;
  h.sendMailMock.mockClear();
  h.sendEmailMock.mockClear();
  h.sendReportNotificationMock.mockClear();
  _clearContentCache();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── hasConfiguredChannels: the default-unchanged gate ─────────────────────────
describe("hasConfiguredChannels — legacy default detection", () => {
  it("NULL / undefined / empty object → false (legacy direct e-mail)", () => {
    expect(hasConfiguredChannels(null)).toBe(false);
    expect(hasConfiguredChannels(undefined)).toBe(false);
    expect(hasConfiguredChannels({})).toBe(false);
    expect(hasConfiguredChannels("email")).toBe(false);
  });

  it("explicitly enabled channels → true", () => {
    expect(hasConfiguredChannels({ email: { enabled: true } })).toBe(true);
    expect(hasConfiguredChannels({ webhook: { enabled: true, url: "https://x.test/h" } })).toBe(true);
    expect(hasConfiguredChannels({ inApp: { enabled: true } })).toBe(true);
  });

  it("disabled or malformed channels → false", () => {
    expect(hasConfiguredChannels({ email: { enabled: false } })).toBe(false);
    expect(hasConfiguredChannels({ webhook: { enabled: true, url: "" } })).toBe(false);
  });
});

// ── Enqueue ───────────────────────────────────────────────────────────────────
describe("enqueueReportDeliveries", () => {
  it("writes one queued row per enabled channel with the right target", async () => {
    const result = await enqueueReportDeliveries(
      {
        ...REPORT,
        deliveryChannels: {
          email: { enabled: true },
          webhook: { enabled: true, url: "https://hooks.test/r", secret: "s3cret" },
          inApp: { enabled: true, userIds: [1, 2] },
        },
      },
      BUILT,
    );
    expect(result.ok).toBe(true);
    expect(result.deliveryIds).toHaveLength(3);
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "in_app", "webhook"]);
    expect(rows.find((r) => r.channel === "email")?.target).toBe("qa@example.com,sup@example.com");
    expect(rows.find((r) => r.channel === "webhook")?.target).toBe("https://hooks.test/r");
    expect(rows.find((r) => r.channel === "in_app")?.target).toBe("1,2");
    expect(rows.every((r) => r.status === "queued")).toBe(true);
  });

  it("in-app without userIds falls back to the report creator", async () => {
    await enqueueReportDeliveries(
      { ...REPORT, deliveryChannels: { inApp: { enabled: true } } },
      BUILT,
    );
    expect(rows[0].channel).toBe("in_app");
    expect(rows[0].target).toBe("7");
  });

  it("refuses when no channels are configured (legacy default)", async () => {
    const result = await enqueueReportDeliveries({ ...REPORT, deliveryChannels: null }, BUILT);
    expect(result.ok).toBe(false);
    expect(rows).toHaveLength(0);
  });
});

// ── Webhook adapter through drain ────────────────────────────────────────────
describe("drain — webhook channel", () => {
  const CONFIG = { webhook: { enabled: true, url: "https://hooks.test/r", secret: "s3cret" } };

  async function enqueueWebhook() {
    h.reportRow = { ...REPORT, deliveryChannels: CONFIG };
    return enqueueReportDeliveries({ ...REPORT, deliveryChannels: CONFIG }, BUILT);
  }

  it("success → status sent, HMAC signature header matches the body", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await enqueueWebhook();

    const result = await drainReportDeliveriesOnce();
    expect(result.sent).toBe(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].sentAt).not.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.test/r");
    const headers = init.headers as Record<string, string>;
    const body = String(init.body);
    const expected = "sha256=" + createHmac("sha256", "s3cret").update(body, "utf8").digest("hex");
    expect(headers["X-Report-Signature"]).toBe(expected);
    expect(webhookSignature("s3cret", body)).toBe(expected);
    const parsed = JSON.parse(body);
    expect(parsed.event).toBe("report.generated");
    expect(parsed.reportId).toBe(42);
    expect(parsed.subject).toBe(BUILT.subject);
  });

  it("failure → retry with backoff, then dead-letter at the attempts cap", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await enqueueWebhook();

    // First attempt → failed with attempts=1 and a FUTURE nextAttemptAt.
    const before = Date.now();
    const r1 = await drainReportDeliveriesOnce();
    expect(r1.failed).toBe(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].lastError).toContain("HTTP 500");
    expect(rows[0].nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + backoffDelayMs(1) - 1000);

    // Drive the remaining attempts (fake ignores the due-time predicate).
    for (let i = 1; i < REPORT_DELIVERY_MAX_ATTEMPTS; i++) {
      await drainReportDeliveriesOnce();
    }
    expect(rows[0].status).toBe("dead");
    expect(rows[0].attempts).toBe(REPORT_DELIVERY_MAX_ATTEMPTS);
    expect(fetchMock).toHaveBeenCalledTimes(REPORT_DELIVERY_MAX_ATTEMPTS);

    // Dead rows are not picked up again.
    const after = await drainReportDeliveriesOnce();
    expect(after.picked).toBe(0);
  });

  it("backoff is exponential and capped", () => {
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(60_000);
    expect(backoffDelayMs(3)).toBe(120_000);
    expect(backoffDelayMs(20)).toBe(30 * 60_000); // cap
  });
});

// ── Email adapter through drain ───────────────────────────────────────────────
describe("drain — email channel", () => {
  const CONFIG = { email: { enabled: true } };

  it("uses the db SMTP transporter when configured", async () => {
    await enqueueReportDeliveries({ ...REPORT, deliveryChannels: CONFIG }, BUILT);
    const result = await drainReportDeliveriesOnce();
    expect(result.sent).toBe(1);
    expect(h.sendMailMock).toHaveBeenCalledTimes(1);
    const mail = h.sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mail.to).toBe("qa@example.com,sup@example.com");
    expect(mail.subject).toBe(BUILT.subject);
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });

  it("falls back to the env transporter when db SMTP config is absent", async () => {
    h.smtpConfig = null;
    await enqueueReportDeliveries({ ...REPORT, deliveryChannels: CONFIG }, BUILT);
    const result = await drainReportDeliveriesOnce();
    expect(result.sent).toBe(1);
    expect(h.sendMailMock).not.toHaveBeenCalled();
    expect(h.sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("transporter failure → retry not instant-dead", async () => {
    h.sendMailMock.mockRejectedValueOnce(new Error("SMTP down"));
    await enqueueReportDeliveries({ ...REPORT, deliveryChannels: CONFIG }, BUILT);
    const result = await drainReportDeliveriesOnce();
    expect(result.failed).toBe(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].lastError).toContain("SMTP down");
  });
});

// ── In-app adapter through drain ─────────────────────────────────────────────
describe("drain — in-app channel", () => {
  it("writes a notification per user id and marks sent", async () => {
    await enqueueReportDeliveries(
      { ...REPORT, deliveryChannels: { inApp: { enabled: true, userIds: [3, 9] } } },
      BUILT,
    );
    const result = await drainReportDeliveriesOnce();
    expect(result.sent).toBe(1);
    expect(h.sendReportNotificationMock).toHaveBeenCalledTimes(2);
    expect(h.sendReportNotificationMock.mock.calls.map((c) => c[0]).sort()).toEqual([3, 9]);
    expect(rows[0].status).toBe("sent");
  });
});

// ── History + retry surface ───────────────────────────────────────────────────
describe("ledger surface", () => {
  it("listReportDeliveries returns rows; retryReportDelivery requeues a dead row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    h.reportRow = { ...REPORT, deliveryChannels: { webhook: { enabled: true, url: "https://h.test/x" } } };
    await enqueueReportDeliveries(
      { ...REPORT, deliveryChannels: { webhook: { enabled: true, url: "https://h.test/x" } } },
      BUILT,
    );
    // While still retryable, the ledger surfaces the row (the fake select
    // returns non-terminal rows only, which is exactly the queued/failed state).
    const listed = await listReportDeliveries(REPORT.id);
    expect(listed.length).toBeGreaterThan(0);

    for (let i = 0; i < REPORT_DELIVERY_MAX_ATTEMPTS; i++) await drainReportDeliveriesOnce();
    expect(rows[0].status).toBe("dead");

    const retried = await retryReportDelivery(rows[0].id);
    expect(retried.ok).toBe(true);
    expect(rows[0].status).toBe("queued");
    expect(rows[0].attempts).toBe(0);
  });
});
