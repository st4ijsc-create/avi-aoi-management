/**
 * W5-D (doc 27 §6 A11) — scheduler delivery-section behaviour.
 *
 * PROOF OF "DEFAULT UNCHANGED": a report row WITHOUT deliveryChannels goes down
 * the legacy path — direct transporter.sendMail to recipients, SUCCESS log,
 * lastSentAt bump — and the delivery ledger is never touched.
 * A report WITH deliveryChannels enqueues ledger rows instead and does NOT
 * direct-send.
 *
 * executeScheduledReport is module-private; it is driven the honest way — via
 * the mocked cron.schedule callback captured from scheduleReport().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-cron", () => {
  const schedule = vi.fn(() => ({ stop: vi.fn() }));
  return { default: { schedule }, schedule };
});

const h = vi.hoisted(() => ({
  reportRow: null as Record<string, unknown> | null,
  sendMailMock: vi.fn(async () => ({ messageId: "m1" })),
  enqueueMock: vi.fn(async () => ({
    ok: true,
    deliveryIds: [101, 102],
    channels: ["email", "webhook"],
  })),
  drainMock: vi.fn(async () => ({ picked: 0, sent: 0, failed: 0, dead: 0 })),
  logMock: vi.fn(async () => 1),
  updateMock: vi.fn(async () => undefined),
}));

vi.mock("../db", () => ({
  getScheduledReports: vi.fn(async () => []),
  getScheduledReportById: vi.fn(async () => h.reportRow),
  updateScheduledReport: h.updateMock,
  createScheduledReportLog: h.logMock,
  getSmtpConfig: vi.fn(async () => ({
    host: "smtp.test", port: 587, secure: false, username: "u", password: "p",
    fromEmail: "noreply@test", fromName: "Test",
  })),
}));

vi.mock("../_core/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  createTransporterFromConfig: vi.fn(() => ({ sendMail: h.sendMailMock })),
}));

vi.mock("./reportGenerator", () => ({
  generateNGVisualReport: vi.fn(async () => ({ some: "data" })),
  generateNGVisualEmailHTML: vi.fn(() => "<h1>ng report</h1>"),
  generateReport: vi.fn(async () => ({ content: "x", mimeType: "text/plain", extension: "txt" })),
}));

// Keep hasConfiguredChannels REAL (it is the gate under test); mock the rest.
vi.mock("./reportDeliveryService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reportDeliveryService")>();
  return {
    ...actual,
    enqueueReportDeliveries: h.enqueueMock,
    drainReportDeliveriesOnce: h.drainMock,
  };
});

import cron from "node-cron";
import { scheduleReport, stopScheduledReport } from "./reportScheduler";

const scheduleMock = vi.mocked(cron.schedule);

/** Drive the private executeScheduledReport via the captured cron callback. */
async function fireCron(reportId: number): Promise<void> {
  scheduleReport({ id: reportId, schedule: "DAILY", scheduleTime: "06:00" });
  const call = scheduleMock.mock.calls.at(-1);
  expect(call).toBeDefined();
  const callback = call![1] as () => void;
  callback();
  // The callback fires executeScheduledReport without awaiting — flush it.
  // Generous timeout: under full-suite parallel load the async chain can take
  // well over vi.waitFor's 1s default even with every dependency mocked.
  await vi.waitFor(
    () => {
      expect(h.logMock).toHaveBeenCalled();
    },
    { timeout: 15_000 },
  );
  stopScheduledReport(reportId);
}

const BASE_REPORT = {
  id: 9301,
  name: "Daily NG",
  reportType: "NG_VISUAL",
  schedule: "DAILY",
  scheduleTime: "06:00",
  isActive: true,
  recipients: ["qa@example.com"],
  reportFormat: "HTML",
  createdBy: 7,
  factoryId: null,
  workshopId: null,
  lineId: null,
  logoUrl: null,
  primaryColor: null,
  footerText: null,
};

beforeEach(() => {
  scheduleMock.mockClear();
  h.sendMailMock.mockClear();
  h.enqueueMock.mockClear();
  h.drainMock.mockClear();
  h.logMock.mockClear();
  h.updateMock.mockClear();
});

describe("executeScheduledReport — delivery dispatch", () => {
  it("NO deliveryChannels → legacy direct e-mail UNCHANGED (no ledger involvement)", async () => {
    h.reportRow = { ...BASE_REPORT, deliveryChannels: null };
    await fireCron(9301);

    // Direct send to the recipients, exactly as before.
    expect(h.sendMailMock).toHaveBeenCalledTimes(1);
    const mail = h.sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mail.to).toBe("qa@example.com");

    // Ledger untouched.
    expect(h.enqueueMock).not.toHaveBeenCalled();
    expect(h.drainMock).not.toHaveBeenCalled();

    // Legacy SUCCESS log + lastSentAt bump.
    expect(h.logMock).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 9301, status: "SUCCESS", recipientCount: 1 }),
    );
    expect(h.updateMock).toHaveBeenCalledWith(9301, expect.objectContaining({ lastSentAt: expect.any(Date) }));
  });

  it("empty-object deliveryChannels still routes legacy (not opted in)", async () => {
    h.reportRow = { ...BASE_REPORT, deliveryChannels: {} };
    await fireCron(9301);
    expect(h.sendMailMock).toHaveBeenCalledTimes(1);
    expect(h.enqueueMock).not.toHaveBeenCalled();
  });

  it("WITH deliveryChannels → enqueues ledger rows, no direct send, PENDING log", async () => {
    h.reportRow = {
      ...BASE_REPORT,
      deliveryChannels: {
        email: { enabled: true },
        webhook: { enabled: true, url: "https://hooks.test/r", secret: "s" },
      },
    };
    await fireCron(9301);

    expect(h.enqueueMock).toHaveBeenCalledTimes(1);
    const [reportArg, builtArg] = h.enqueueMock.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { subject: string; html: string },
    ];
    expect(reportArg.id).toBe(9301);
    expect(builtArg.subject).toContain("Daily NG");
    expect(builtArg.html).toContain("ng report");

    // No direct e-mail from the scheduler itself — the ledger owns delivery now.
    expect(h.sendMailMock).not.toHaveBeenCalled();

    expect(h.logMock).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 9301, status: "PENDING", recipientCount: 2 }),
    );
    expect(h.updateMock).toHaveBeenCalledWith(9301, expect.objectContaining({ lastSentAt: expect.any(Date) }));

    // Prompt first drain kicked.
    await vi.waitFor(() => expect(h.drainMock).toHaveBeenCalled());
  });

  it("enqueue failure → FAILED log, still no direct send", async () => {
    h.enqueueMock.mockResolvedValueOnce({ ok: false, deliveryIds: [], channels: [], reason: "db unavailable" } as never);
    h.reportRow = {
      ...BASE_REPORT,
      deliveryChannels: { inApp: { enabled: true } },
    };
    await fireCron(9301);
    expect(h.logMock).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 9301, status: "FAILED", errorMessage: expect.stringContaining("db unavailable") }),
    );
    expect(h.sendMailMock).not.toHaveBeenCalled();
  });
});
