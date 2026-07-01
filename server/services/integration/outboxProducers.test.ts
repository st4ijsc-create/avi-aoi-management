/**
 * K0+-c (doc 16 §4 Khối 0 / doc 18 §6) — producer → outbox wiring tests.
 *
 * Asserts publishToOutbox:
 *   • is a NO-OP when ERP_OUTBOX_ENABLED is off (current behavior);
 *   • is a NO-OP when the event family has no configured endpoint;
 *   • enqueues (with the right idempotencyKey + format) when flag on + endpoint set;
 *   • never throws to the producer (error-isolated) even if enqueue rejects.
 *
 * enqueueOutbox is mocked so the test is hermetic (no DB). publishToOutbox is
 * fire-and-forget, so we await a microtask flush before asserting.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn(async () => ({ ok: true, id: 1 })) }));

vi.mock("./erpOutbox", () => ({
  enqueueOutbox: enqueueMock,
  outboxEnabled: () => process.env.ERP_OUTBOX_ENABLED === "true" || process.env.ERP_OUTBOX_ENABLED === "1",
  OUTBOX_EVENT_TYPES: ["production-event", "quality-result", "oee-metric", "genealogy-record"],
}));

import { publishToOutbox } from "./outboxProducers";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  enqueueMock.mockClear();
  process.env.ERP_OUTBOX_ENABLED = "true";
  process.env.ERP_QUALITY_ENDPOINT = "https://erp.example.com/quality";
  delete process.env.ERP_OEE_ENDPOINT;
});

afterEach(() => {
  delete process.env.ERP_OUTBOX_ENABLED;
  delete process.env.ERP_QUALITY_ENDPOINT;
});

describe("K0+-c publishToOutbox", () => {
  it("enqueues when flag on + endpoint configured, with the given idempotency key", async () => {
    publishToOutbox({
      eventType: "quality-result",
      payload: { inspectionId: 5, serialNumber: "SN-5" },
      idempotencyKey: "qr-5",
      corporateCode: "ACME",
    });
    await flush();
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0][0] as any;
    expect(arg.eventType).toBe("quality-result");
    expect(arg.idempotencyKey).toBe("qr-5");
    expect(arg.targetEndpoint).toBe("https://erp.example.com/quality");
    expect(arg.corporateCode).toBe("ACME");
  });

  it("is a NO-OP when ERP_OUTBOX_ENABLED is off", async () => {
    process.env.ERP_OUTBOX_ENABLED = "false";
    publishToOutbox({ eventType: "quality-result", payload: { x: 1 }, idempotencyKey: "qr-off" });
    await flush();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("is a NO-OP when the event family has no configured endpoint", async () => {
    // ERP_OEE_ENDPOINT is intentionally unset.
    publishToOutbox({ eventType: "oee-metric", payload: { x: 1 }, idempotencyKey: "oee-1" });
    await flush();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("passes the requested format through (b2mml)", async () => {
    publishToOutbox({ eventType: "quality-result", payload: { x: 1 }, idempotencyKey: "qr-fmt", format: "b2mml" });
    await flush();
    expect((enqueueMock.mock.calls[0][0] as any).format).toBe("b2mml");
  });

  it("never throws to the producer even if enqueue rejects", async () => {
    enqueueMock.mockRejectedValueOnce(new Error("db down"));
    expect(() =>
      publishToOutbox({ eventType: "quality-result", payload: { x: 1 }, idempotencyKey: "qr-err" }),
    ).not.toThrow();
    await flush();
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });
});
