/**
 * SCADA R1b-2b-2a A2(j) polish — pins the MARKER CONTRACT the undelivered-STOP sweep relies on: raiseCriticalStopAlert with `khuTrungBenVung` hands
 * `metadata.dedupKey` (= its dedupKey) and `metadata.kind` to sendNotification, so the persisted inbox row carries the key that
 * edgeNodeCommands.alertUndeliveredStops' `NOT EXISTS (… n.metadata->>'dedupKey' = 'stop_undelivered:request:' || id)` finds. Without the flag the
 * row carries no dedupKey (a per-occurrence alert). Pure: sendNotification / the alert stream are recorders; getDb is null (the durable pre-check
 * then finds nothing and the alert is sent).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({ sent: [] as Array<{ userId: number; payload: { metadata?: Record<string, unknown> }; opts: { dedupKey?: string } }> }));
vi.mock("../notificationService", () => ({
  sendNotification: vi.fn(async (userId: number, payload: { metadata?: Record<string, unknown> }, opts: { dedupKey?: string }) => {
    H.sent.push({ userId, payload, opts });
    return { id: H.sent.length };
  }),
}));
vi.mock("../ecosystem/ecosystemEvents", () => ({ publishAnomalyDetected: vi.fn() }));
vi.mock("../../db/connection", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../db/connection")>()), getDb: async () => null }));

import { raiseCriticalStopAlert, __quenBoNhoKhuTrungChoTest } from "./criticalStopAlert";

beforeEach(() => {
  H.sent = [];
  __quenBoNhoKhuTrungChoTest();
});

describe("A2(j) polish — raiseCriticalStopAlert + khuTrungBenVung ⇒ metadata.dedupKey (the sweep's durable marker)", () => {
  it("★ with khuTrungBenVung: every recipient's notification carries metadata { kind, dedupKey } = the alert's key", async () => {
    await raiseCriticalStopAlert({ kind: "stop_undelivered", title: "t", message: "m", recipients: [7, 8], dedupKey: "stop_undelivered:request:123", khuTrungBenVung: {} });
    expect(H.sent.map((x) => x.userId)).toEqual([7, 8]);
    for (const x of H.sent) {
      expect(x.payload.metadata).toMatchObject({ kind: "stop_undelivered", dedupKey: "stop_undelivered:request:123" });
      expect(x.opts.dedupKey).toBe("stop_undelivered:request:123");
    }
  });

  it("without khuTrungBenVung: the notification carries NO metadata.dedupKey (only the kind)", async () => {
    await raiseCriticalStopAlert({ kind: "stop_undelivered", title: "t", message: "m", recipients: [7], dedupKey: "stop_undelivered:request:124" });
    expect(H.sent).toHaveLength(1);
    expect(H.sent[0]!.payload.metadata).toEqual({ kind: "stop_undelivered" });
  });
});
