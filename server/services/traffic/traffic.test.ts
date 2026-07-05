/**
 * Traffic space-time tests — SYNAPSE §5.4.3 (doc 33 H4).
 * Reservation intervals · space-time route planner · infra coordinator.
 */
import { describe, it, expect } from "vitest";

import { SpaceTimeReservations, overlaps } from "./spaceTimeReservation";
import { planSpaceTimeRoute, earliestFreeDeparture, type RouteGraph } from "./spaceTimeAStar";
import { InfraCoordinator } from "./infraCoordinator";

describe("SpaceTimeReservations", () => {
  it("overlaps honors the buffer", () => {
    expect(overlaps({ start: 0, end: 10, robotId: "a" }, { start: 11, end: 20, robotId: "b" }, 0)).toBe(false);
    expect(overlaps({ start: 0, end: 10, robotId: "a" }, { start: 11, end: 20, robotId: "b" }, 2)).toBe(true);
  });
  it("refuses a conflicting slot, allows non-overlapping", () => {
    const r = new SpaceTimeReservations(0);
    expect(r.reserve("e1", { start: 0, end: 10, robotId: "a" }).ok).toBe(true);
    const c = r.reserve("e1", { start: 5, end: 15, robotId: "b" });
    expect(c.ok).toBe(false);
    expect(c.conflicts).toEqual(["a"]);
    expect(r.reserve("e1", { start: 10, end: 20, robotId: "b" }).ok).toBe(true);
  });
  it("reserveRoute is all-or-nothing (rolls back on conflict)", () => {
    const r = new SpaceTimeReservations(0);
    r.reserve("e2", { start: 0, end: 10, robotId: "x" });
    const res = r.reserveRoute([
      { edgeId: "e1", slot: { start: 0, end: 10, robotId: "b" } },
      { edgeId: "e2", slot: { start: 5, end: 15, robotId: "b" } }, // conflicts x
    ]);
    expect(res.ok).toBe(false);
    expect(r.onEdge("e1")).toHaveLength(0); // e1 rolled back
  });
  it("releaseRobot clears all of a robot's slots", () => {
    const r = new SpaceTimeReservations(0);
    r.reserve("e1", { start: 0, end: 10, robotId: "a" });
    r.reserve("e2", { start: 0, end: 10, robotId: "a" });
    expect(r.releaseRobot("a")).toBe(2);
    expect(r.size()).toBe(0);
  });
});

describe("planSpaceTimeRoute", () => {
  const graph: RouteGraph = {
    edges: [
      { id: "AB", from: "A", to: "B", travelMs: 10 },
      { id: "BC", from: "B", to: "C", travelMs: 10 },
      { id: "AC", from: "A", to: "C", travelMs: 30 }, // longer direct
    ],
  };
  it("finds the earliest-arrival route", () => {
    const route = planSpaceTimeRoute(graph, "A", "C", { robotId: "r1", departTs: 0 });
    expect(route).not.toBeNull();
    expect(route!.path.map((s) => s.edgeId)).toEqual(["AB", "BC"]); // 20 < 30
    expect(route!.arrivalTs).toBe(20);
  });
  it("waits when an edge is reserved (space-time avoidance)", () => {
    const res = new SpaceTimeReservations(0);
    res.reserve("AB", { start: 0, end: 15, robotId: "other" }); // blocks AB until 15
    const route = planSpaceTimeRoute(graph, "A", "C", { robotId: "r1", departTs: 0, reservations: res, bufferMs: 0 });
    expect(route).not.toBeNull();
    // r1 must depart AB at/after 16 → arrives B at 26 → C at 36; direct AC (0..30) is faster.
    expect(route!.path.map((s) => s.edgeId)).toEqual(["AC"]);
  });
  it("returns null when goal unreachable within horizon", () => {
    expect(planSpaceTimeRoute(graph, "A", "Z", { robotId: "r1" })).toBeNull();
  });
  it("earliestFreeDeparture advances past a blocker", () => {
    const iv = [{ start: 0, end: 10, robotId: "b" }];
    expect(earliestFreeDeparture(iv, "a", 0, 5, 0, 1000)).toBe(11);
    expect(earliestFreeDeparture(iv, "a", 20, 5, 0, 1000)).toBe(20);
  });
});

describe("InfraCoordinator", () => {
  it("request→grant→occupy→release lifecycle", () => {
    const c = new InfraCoordinator(30_000);
    c.register("lift1", "elevator");
    const g = c.request("lift1", "r1", 1000);
    expect(g.ok).toBe(true);
    expect(g.state).toBe("granted");
    expect(c.occupy("lift1", "r1", 1100).state).toBe("occupied");
    expect(c.release("lift1", "r1").state).toBe("idle");
  });
  it("refuses a second robot while held", () => {
    const c = new InfraCoordinator();
    c.register("door1", "door");
    c.request("door1", "r1", 0);
    const g2 = c.request("door1", "r2", 0);
    expect(g2.ok).toBe(false);
    expect(g2.reason).toMatch(/held by r1/);
  });
  it("revokes an unoccupied grant past its deadline", () => {
    const c = new InfraCoordinator(1000);
    c.register("lift1", "elevator");
    c.request("lift1", "r1", 0); // deadline 1000
    expect(c.reapExpired(2000)).toBe(1);
    expect(c.get("lift1")?.state).toBe("idle");
    // now r2 can grab it
    expect(c.request("lift1", "r2", 2100).ok).toBe(true);
  });
});
