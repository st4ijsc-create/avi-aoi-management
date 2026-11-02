/**
 * SCADA R1b-2b-2a A2(j) polish — the console STOP alerts that share the sweep's dedup key (`stop_undelivered:request:<id>`) carry the DURABLE dedup
 * (`khuTrungBenVung`), so their inbox row holds `metadata.dedupKey` = the marker edgeNodeCommands.alertUndeliveredStops reads ⇒ the sweep does not
 * alert the same request a second time. Pure: the alert sink is a recorder; no database (getDb mocked to null).
 *   • OT path: commandDispatcher's helper (raiseOtStopAlert, via its test export) — per-request keys (incl. `:late`) get the flag, other kinds do not;
 *   • robot path: robotEdgeCommandPort is covered by robotEdgeStopReach.finalfix.dot10.test.ts (asserts the flag on its alert).
 */
import { describe, it, expect, vi } from "vitest";

const H = vi.hoisted(() => ({ alerts: [] as Array<{ kind: string; dedupKey: string; khuTrungBenVung?: unknown }> }));
vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: vi.fn(async (a: { kind: string; dedupKey: string; khuTrungBenVung?: unknown }) => {
    H.alerts.push(a);
  }),
}));
vi.mock("../../db/connection", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../db/connection")>()), getDb: async () => null }));

import { _raiseOtStopAlertChoTest } from "./commandDispatcher";

const input = { adapterId: 41, commandType: "stop", writes: [], triggeredBy: { kind: "manual" }, idempotencyKey: "k-1" } as never;

describe("A2(j) polish — OT console STOP alert carries the sweep's durable marker", () => {
  it("★ stop_undelivered:request:<id> (and its :late variant) ⇒ khuTrungBenVung set; another kind / key ⇒ not set", async () => {
    H.alerts.length = 0;
    await _raiseOtStopAlertChoTest("stop_undelivered", input, "m", [9], "stop_undelivered:request:77");
    await _raiseOtStopAlertChoTest("stop_undelivered", input, "m", [9], "stop_undelivered:request:77:late");
    await _raiseOtStopAlertChoTest("ot_stop_routed_to_edge", input, "m", [9], "ot_stop_routed_to_edge:request:77");
    await _raiseOtStopAlertChoTest("ot_stop_owner_unknown", input, "m");
    expect(H.alerts.map((a) => [a.dedupKey, a.khuTrungBenVung !== undefined])).toEqual([
      ["stop_undelivered:request:77", true],
      ["stop_undelivered:request:77:late", true],
      ["ot_stop_routed_to_edge:request:77", false],
      ["ot_stop_owner_unknown:41:k-1", false],
    ]);
  });
});
