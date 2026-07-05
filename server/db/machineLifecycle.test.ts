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
describe("M2 — lifecycle transition matrix", () => {
  const LEGAL: Array<[string, string]> = [
    ["commissioning", "active"],
    ["active", "maintenance"],
    ["active", "decommissioned"],
    ["maintenance", "active"],
    ["maintenance", "decommissioned"],
    ["decommissioned", "retired"],
    ["decommissioned", "active"], // re-commission
  ];

  it("allows exactly the specified transitions and nothing else (full 5×5 sweep)", () => {
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
