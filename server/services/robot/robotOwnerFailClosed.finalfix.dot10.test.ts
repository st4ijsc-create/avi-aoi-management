/**
 * doc 81 Đợt 10 final fix wave — M-1 and M-2 (ruling R-10-br):
 *   • M-1 — central's robot loader: when the EDGE-OWNERSHIP read fails (anything but "0374 not applied"), central connects to
 *     NONE of the robots (fail-closed: a second session on a single-client controller could starve the edge's own session, so
 *     its local STOPs would fail) and raises an alert; the ownership reconcile (≤ 30 s) attaches the central-owned ones once the
 *     read works. A DB without 0374 has no edge owners ⇒ every enabled robot (central unchanged).
 *   • M-2 — the 10 s pending-STOP sweep on a DB without 0374 logs the missing schema ONCE (not every 10 s); a real error is
 *     still logged every time; once the schema works again a later loss is logged once again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const D = vi.hoisted(() => ({ ownerRead: "ok" as "ok" | "error" | "missing", owners: [] as number[], pendingRead: "ok" as "ok" | "missing" | "error", alerts: [] as Array<{ kind: string; severity: string }> }));
const schemaMissing = () => Object.assign(new Error('relation "device_pending_stops" does not exist'), { code: "42P01" });
vi.mock("../../db/connection", async () => {
  const { robotOwnership } = await import("../edge/edgeControlSchema");
  const rows = [10, 11, 12].map((id) => ({ id, code: `R${id}`, vendor: "sim", endpoint: `sim://${id}`, connectionOptions: null, pollIntervalMs: 500, isEnabled: true }));
  return {
    getDb: async () => ({
      select: () => ({
        from: (t: unknown) => ({
          where: async () => {
            if (t !== robotOwnership) return rows;
            if (D.ownerRead === "error") throw new Error("connection terminated unexpectedly");
            if (D.ownerRead === "missing") throw Object.assign(new Error('column "edgeNodeId" does not exist'), { code: "42703" });
            return D.owners.map((id) => ({ id }));
          },
        }),
      }),
      execute: async () => {
        if (D.pendingRead === "missing") throw schemaMissing();
        if (D.pendingRead === "error") throw new Error("statement timeout");
        return [];
      },
    }),
  };
});
vi.mock("./driverRegistry", () => ({ createRobotDriver: () => ({ vendor: "sim" }) }));
vi.mock("../ecosystem/ecosystemEvents", () => ({
  publishAnomalyDetected: (a: { kind: string; severity: string }) => void D.alerts.push(a),
}));

import { loadEnabledRobots } from "./robotAdapter";
import { sweepPendingCentralStops } from "./deviceOwnershipService";

beforeEach(() => {
  D.ownerRead = "ok";
  D.owners = [];
  D.pendingRead = "ok";
  D.alerts.length = 0;
});

describe("final fix wave M-1 — the ownership read fails ⇒ central connects to NO robot (fail-closed) + alert", () => {
  it("★ owner read error ⇒ none loaded, an alert is raised", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    D.ownerRead = "error";
    expect(await loadEnabledRobots()).toEqual([]);
    expect(D.alerts.some((a) => a.kind === "robot_owner_unreadable")).toBe(true);
    err.mockRestore();
  });
  it("unchanged: owners readable ⇒ the edge-owned one skipped; 0374 not applied ⇒ every enabled robot", async () => {
    D.owners = [11];
    expect((await loadEnabledRobots()).map((r) => r.id)).toEqual([10, 12]);
    D.ownerRead = "missing";
    expect((await loadEnabledRobots()).map((r) => r.id)).toEqual([10, 11, 12]);
    expect(D.alerts).toEqual([]);
  });
});

describe("final fix wave M-2 — the pending-STOP sweep logs a missing 0374 ONCE", () => {
  it("★ schema missing: logged once over many passes; a real error every time; after recovery a new loss is logged again", async () => {
    const lines: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const warn = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    D.pendingRead = "missing";
    for (let i = 0; i < 5; i++) await sweepPendingCentralStops();
    expect(lines.filter((l) => /device_pending_stops|0374/.test(l))).toHaveLength(1);
    D.pendingRead = "error";
    await sweepPendingCentralStops();
    await sweepPendingCentralStops();
    expect(lines.filter((l) => /statement timeout/.test(l))).toHaveLength(2);
    D.pendingRead = "ok";
    await sweepPendingCentralStops();
    D.pendingRead = "missing";
    await sweepPendingCentralStops();
    expect(lines.filter((l) => /device_pending_stops|0374/.test(l) && !/statement timeout/.test(l))).toHaveLength(2);
    err.mockRestore();
    warn.mockRestore();
  });
});
