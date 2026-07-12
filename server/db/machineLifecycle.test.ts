/**
 * Doc 27 Đợt 3 / W3-B — gaps M2 + M3 (db layer).
 *
 * Covers:
 *  - the FULL legal-transition matrix (pure, from drizzle/schema/hierarchy)
 *  - transitionMachineLifecycle: legal → update + snapshots; illegal/same-state
 *    → LifecycleTransitionError; unknown id → "Machine not found"; NULL
 *    lifecycleStatus treated as 'active' (pre-backfill safety)
 *  - deleteMachine: tombstone stamp (isActive=false + lifecycleStatus 'retired',
 *    code kept INTACT)
 *  - restoreMachine: code-collision → MachineCodeCollisionError; clean restore
 *    lands on 'decommissioned'; idempotent when already active
 *
 * DB is faked at ./connection (FIFO select results + recorded updates) — no
 * real Postgres needed; the partial unique index itself is verified against the
 * dev DB by run-0181-migration.mjs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MACHINE_LIFECYCLE_STATUSES,
  MACHINE_LIFECYCLE_TRANSITIONS,
  isLegalLifecycleTransition,
} from "../../drizzle/schema/hierarchy";

const fake = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    updates: [] as Record<string, unknown>[],
  };
  const db = {
    select: (_cols?: unknown) => ({
      from: () => ({
        where: () => {
          const chain = {
            limit: async () => state.selectResults.shift() ?? [],
            orderBy: () => ({ limit: async () => state.selectResults.shift() ?? [] }),
          };
          return chain;
        },
      }),
    }),
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: async () => { state.updates.push(data); },
      }),
    }),
  };
  return { state, db };
});

vi.mock("./connection", () => ({ getDb: vi.fn(async () => fake.db) }));

import {
  transitionMachineLifecycle,
  deleteMachine,
  restoreMachine,
} from "./hierarchy";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI Line A", isActive: true, lifecycleStatus: "active" };

beforeEach(() => {
  fake.state.selectResults = [];
  fake.state.updates = [];
});

// ── M2: transition matrix (single source of truth) ──────────────────────────
// Doc 44 W2-A2 (G1.10, SYNAPSE spec §6.3): + 'registered' (before commissioning)
// and 'faulted' (from active; recovers to active or goes to maintenance).
describe("M2 — lifecycle transition matrix", () => {
  const LEGAL: Array<[string, string]> = [
    ["registered", "commissioning"],
    ["registered", "decommissioned"], // hủy onboard (spec §6.3)
    ["commissioning", "active"],
    ["commissioning", "decommissioned"], // hủy onboard (spec §6.3)
    ["active", "maintenance"],
    ["active", "decommissioned"],
    ["active", "faulted"], // sự cố (spec §6.3)
    ["faulted", "active"], // recovered
    ["faulted", "maintenance"],
    ["maintenance", "active"],
    ["maintenance", "decommissioned"],
    ["decommissioned", "retired"],
    ["decommissioned", "active"], // re-commission
  ];

  it("allows exactly the specified transitions and nothing else (full 7×7 sweep)", () => {
    for (const from of MACHINE_LIFECYCLE_STATUSES) {
      for (const to of MACHINE_LIFECYCLE_STATUSES) {
        const expected = LEGAL.some(([f, t]) => f === from && t === to);
        expect(isLegalLifecycleTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it("retired is terminal", () => {
    expect(MACHINE_LIFECYCLE_TRANSITIONS.retired).toEqual([]);
  });

  it("registered sits BEFORE commissioning (cannot jump straight to active)", () => {
    expect(isLegalLifecycleTransition("registered", "commissioning")).toBe(true);
    expect(isLegalLifecycleTransition("registered", "active")).toBe(false);
    expect(isLegalLifecycleTransition("registered", "faulted")).toBe(false);
  });

  it("faulted is reachable ONLY from active and recovers to active/maintenance", () => {
    for (const from of MACHINE_LIFECYCLE_STATUSES) {
      expect(isLegalLifecycleTransition(from, "faulted"), `${from} → faulted`).toBe(from === "active");
    }
    expect(MACHINE_LIFECYCLE_TRANSITIONS.faulted).toEqual(["active", "maintenance"]);
  });

  it("unknown states are never legal (defensive)", () => {
    expect(isLegalLifecycleTransition("bogus", "active")).toBe(false);
    expect(isLegalLifecycleTransition("active", "bogus")).toBe(false);
  });
});

// ── M2: transitionMachineLifecycle ───────────────────────────────────────────
describe("M2 — transitionMachineLifecycle", () => {
  it("legal transition updates the row and returns before/after snapshots", async () => {
    fake.state.selectResults = [[{ ...MACHINE }]];
    const r = await transitionMachineLifecycle(5, "maintenance");
    expect(r.before.lifecycleStatus).toBe("active");
    expect(r.after.lifecycleStatus).toBe("maintenance");
    expect(r.after.code).toBe("AOI-01");
    expect(fake.state.updates).toHaveLength(1);
    expect(fake.state.updates[0].lifecycleStatus).toBe("maintenance");
  });

  it("illegal transition throws LifecycleTransitionError and does NOT update", async () => {
    fake.state.selectResults = [[{ ...MACHINE }]]; // active → retired is illegal
    await expect(transitionMachineLifecycle(5, "retired")).rejects.toMatchObject({
      name: "LifecycleTransitionError",
    });
    expect(fake.state.updates).toHaveLength(0);
  });

  it("same-state transition is a LifecycleTransitionError (no silent no-op)", async () => {
    fake.state.selectResults = [[{ ...MACHINE }]];
    await expect(transitionMachineLifecycle(5, "active")).rejects.toMatchObject({
      name: "LifecycleTransitionError",
    });
  });

  it("retired is terminal — retired → active rejected", async () => {
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: "retired" }]];
    await expect(transitionMachineLifecycle(5, "active")).rejects.toMatchObject({
      name: "LifecycleTransitionError",
    });
  });

  it("unknown machine → 'Machine not found'", async () => {
    fake.state.selectResults = [[]];
    await expect(transitionMachineLifecycle(999, "maintenance")).rejects.toThrow("Machine not found");
  });

  it("NULL lifecycleStatus is treated as 'active' (pre-backfill rows stay usable)", async () => {
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: null }]];
    const r = await transitionMachineLifecycle(5, "maintenance");
    expect(r.before.lifecycleStatus).toBe("active");
    expect(r.after.lifecycleStatus).toBe("maintenance");
  });

  // ── Doc 44 W2-A2 (G1.10) — new 'registered' / 'faulted' states end-to-end ──
  it("registered → commissioning is legal (declarative onboarding start)", async () => {
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: "registered" }]];
    const r = await transitionMachineLifecycle(5, "commissioning");
    expect(r.after.lifecycleStatus).toBe("commissioning");
    expect(fake.state.updates[0].lifecycleStatus).toBe("commissioning");
  });

  it("registered → active is rejected (must pass commissioning)", async () => {
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: "registered" }]];
    await expect(transitionMachineLifecycle(5, "active")).rejects.toMatchObject({
      name: "LifecycleTransitionError",
    });
    expect(fake.state.updates).toHaveLength(0);
  });

  it("active → faulted → active round-trips (incident + recovery)", async () => {
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: "active" }]];
    const down = await transitionMachineLifecycle(5, "faulted");
    expect(down.after.lifecycleStatus).toBe("faulted");
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: "faulted" }]];
    const up = await transitionMachineLifecycle(5, "active");
    expect(up.after.lifecycleStatus).toBe("active");
  });

  it("faulted → retired is rejected (must go through maintenance/decommission)", async () => {
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: "faulted" }]];
    await expect(transitionMachineLifecycle(5, "retired")).rejects.toMatchObject({
      name: "LifecycleTransitionError",
    });
  });
});

// ── M3: soft-delete tombstone + restore collision ────────────────────────────
describe("M3 — deleteMachine / restoreMachine", () => {
  it("deleteMachine stamps isActive=false + lifecycleStatus 'retired' and keeps code intact", async () => {
    await deleteMachine(5);
    expect(fake.state.updates).toHaveLength(1);
    const u = fake.state.updates[0];
    expect(u.isActive).toBe(false);
    expect(u.lifecycleStatus).toBe("retired");
    expect(u).not.toHaveProperty("code"); // tombstone keeps its code
  });

  it("restoreMachine → CONFLICT-grade MachineCodeCollisionError when the code was reused", async () => {
    fake.state.selectResults = [
      [{ ...MACHINE, isActive: false, lifecycleStatus: "retired" }], // the tombstone
      [{ id: 9, name: "New AOI with same code" }],                    // active holder
    ];
    await expect(restoreMachine(5)).rejects.toMatchObject({ name: "MachineCodeCollisionError" });
    expect(fake.state.updates).toHaveLength(0);
  });

  it("clean restore reactivates the row on 'decommissioned' (excluded until re-commissioned)", async () => {
    fake.state.selectResults = [
      [{ ...MACHINE, isActive: false, lifecycleStatus: "retired" }],
      [], // no active holder of the code
    ];
    await restoreMachine(5);
    expect(fake.state.updates).toHaveLength(1);
    expect(fake.state.updates[0].isActive).toBe(true);
    expect(fake.state.updates[0].lifecycleStatus).toBe("decommissioned");
  });

  it("restore of an already-active machine is an idempotent no-op", async () => {
    fake.state.selectResults = [[{ ...MACHINE, isActive: true }]];
    await restoreMachine(5);
    expect(fake.state.updates).toHaveLength(0);
  });

  it("restore of an unknown machine → 'Machine not found'", async () => {
    fake.state.selectResults = [[]];
    await expect(restoreMachine(404)).rejects.toThrow("Machine not found");
  });
});
