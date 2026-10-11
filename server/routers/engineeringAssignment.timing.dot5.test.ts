/**
 * doc 81 Đợt 5 final wave P-H1 (H re-review N1) — TIMING parity of `engineering.assign` / roster / unassign:
 *   • the ASSIGNEE: a missing or disabled account goes through the SAME checks (view permission, assignee rule query, run
 *     visibility) as a live account outside the rule — one decision at the end, no early exit after the first query;
 *   • the ITEM (rosterScope.resolveTargetForAssigner): the assigner's factory scope is resolved for a MISSING item too
 *     (before the existence answer), so a missing id and an existing out-of-scope id cost the same lookups.
 * The oracle is the sequence of lookups each path performs (recorded by the mocks), plus the identical answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rec = vi.hoisted(() => ({
  calls: [] as string[],
  selectRows: [] as unknown[][],
  factoryRows: [] as unknown[],
  /** doc 81 Đợt 7 I4 (M-2) — the ROLE each permission check / run check ran with (the engine's admin bypass keys on it). */
  roles: [] as string[],
  scopes: [] as string[],
}));
vi.mock("../db/connection", () => {
  const NAME = Symbol.for("drizzle:Name");
  /** Answers by TABLE: `users` reads take the queued answers in order; every other table answers its fixed rows. */
  const builder = () => {
    let rows: unknown[] = [];
    const b: any = {
      from: (t: any) => {
        const name = String(t?.[NAME] ?? "?");
        rec.calls.push(`db.select:${name}`);
        rows = name === "users" ? rec.selectRows.shift() ?? [] : name === "orchestration_runs" ? [{ def: { steps: [] } }] : [];
        return b;
      },
      innerJoin: () => b,
      where: () => b,
      limit: () => b,
      orderBy: () => b,
      then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
    };
    return b;
  };
  const d = {
    select: () => builder(),
    execute: async () => {
      rec.calls.push("db.execute");
      return rec.factoryRows;
    },
    transaction: async () => {
      throw new Error("must not be reached");
    },
  };
  return { getDb: async () => d, getReadDb: async () => d };
});
vi.mock("../_core/accessControl", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../_core/accessControl")>();
  return {
    ...orig,
    checkPermission: vi.fn(async (u: number, r: string, m: string) => {
      rec.calls.push(`checkPermission:${m}`);
      rec.roles.push(r);
      return u !== 901; // account 901 holds NO view permission
    }),
  };
});
vi.mock("../services/orchestration/foe/foeEngine", () => ({
  runIdVisibleTo: vi.fn(async (_id: number, scope: unknown) => {
    rec.calls.push("runIdVisibleTo");
    rec.scopes.push(scope === null ? "unrestricted" : `role:${String((scope as { userRole?: unknown })?.userRole ?? "?")}`);
    return true;
  }),
  visibleRunIds: vi.fn(async () => new Set()),
  // doc 81 Đợt 7 I3 — the run rule's definitions (rosterScope.runAssigneeVisibilitySql reads them through the engine)
  runVisibilityDefinitions: vi.fn(async (_d: unknown, runs: unknown[]) => {
    rec.calls.push("runVisibilityDefinitions");
    return runs.map(() => [{ ref: "x", name: "x", steps: [] }]);
  }),
}));
vi.mock("../services/engineeringAssignment/assignGate", () => ({ requireAssignGate: vi.fn(async () => undefined), requireLicense: vi.fn(async () => undefined) }));
vi.mock("../db/hierarchy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../db/hierarchy")>();
  return {
    ...orig,
    idsTrongPhamVi: vi.fn(async (cap: string) => {
      rec.calls.push(`idsTrongPhamVi:${cap}`);
      return [1];
    }),
  };
});

import { engineeringAssignmentRouter } from "./engineeringAssignmentRouter";
import { resolveTargetForAssigner } from "../services/engineeringAssignment/rosterScope";

const ctx = { user: { id: 7, role: "supervisor", name: "assigner", twoFactorEnabled: true } } as never;
const caller = () => engineeringAssignmentRouter.createCaller(ctx);

beforeEach(() => {
  rec.calls.length = 0;
  rec.selectRows.length = 0;
  rec.factoryRows = [];
});

/** Run one assign with the given answers to the users lookups; returns the recorded lookups and the error shape. */
async function assignWith(assigneeRow: unknown[], ruleRow: unknown[], type: "ecn" | "orchestration_run", assigneeUserId = 900) {
  rec.calls.length = 0;
  rec.roles.length = 0;
  rec.scopes.length = 0;
  rec.selectRows.length = 0; // an early exit leaves answers unread — never carry them into the next call
  rec.factoryRows = [{ id: 55, f: [1] }]; // the item exists, in the assigner's factory 1
  // the procedure middleware reads the CALLER's row first; then the assignee lookup, then the rule query
  rec.selectRows.push([{ id: 7, role: "supervisor", isActive: true, name: "assigner", twoFactorEnabled: true }], assigneeRow, ruleRow);
  const err = await caller()
    .assign({ entityType: type, entityId: 55, assigneeUserId, expectedAssigneeUserId: null })
    .then(() => null, (e: { code?: string; cause?: { appParams?: unknown } }) => ({ code: e.code, appParams: e.cause?.appParams }));
  return { calls: [...rec.calls], roles: [...rec.roles], scopes: [...rec.scopes], err };
}

describe("final wave P-H1 — assignee: missing / disabled accounts take the SAME lookups as a live account outside the rule", () => {
  for (const type of ["ecn", "orchestration_run"] as const) {
    it(`★ ${type}: missing, disabled and out-of-rule assignees ⇒ identical lookup sequence and identical refusal`, async () => {
      const live = { id: 900, name: "x", role: "engineer", isActive: true };
      const outOfRule = await assignWith([live], [], type);
      const missing = await assignWith([], [], type);
      const disabled = await assignWith([{ ...live, isActive: false }], [], type);
      const nonViewing = await assignWith([{ ...live, id: 901 }], [{ id: 901 }], type, 901); // in the rule, but no view permission
      expect(outOfRule.err).toEqual({ code: "BAD_REQUEST", appParams: { field: "assigneeUserId", reason: "assigneeInvalid" } });
      expect(missing.err).toEqual(outOfRule.err);
      expect(disabled.err).toEqual(outOfRule.err);
      expect(missing.calls).toEqual(outOfRule.calls);
      expect(disabled.calls).toEqual(outOfRule.calls);
      expect(nonViewing.err).toEqual(outOfRule.err);
      expect(nonViewing.calls).toEqual(outOfRule.calls);
      expect(outOfRule.calls.filter((c) => c.startsWith("checkPermission")).length).toBeGreaterThan(0);
    });
  }
});

describe("doc 81 Đợt 7 I4 (Đợt 5 re-review M-2) — a DISABLED privileged assignee takes the SAME path as a missing id", () => {
  for (const type of ["ecn", "orchestration_run"] as const) {
    it(`★ ${type}: a disabled ADMIN ⇒ the same lookups, the same (non-admin) roles and scope as a missing id — no admin fast path`, async () => {
      const missing = await assignWith([], [], type);
      const disabledAdmin = await assignWith([{ id: 900, name: "a", role: "admin", isActive: false }], [], type);
      expect(disabledAdmin.err).toEqual(missing.err);
      expect(disabledAdmin.calls).toEqual(missing.calls);
      expect(disabledAdmin.roles).toEqual(missing.roles);
      expect(disabledAdmin.roles).not.toContain("admin");
      expect(disabledAdmin.scopes).toEqual(missing.scopes);
      expect(disabledAdmin.scopes).not.toContain("role:admin");
    });
  }
  it("control: an ACTIVE admin assignee still checks as admin (its real role)", async () => {
    const active = await assignWith([{ id: 900, name: "a", role: "admin", isActive: true }], [], "orchestration_run");
    expect(active.roles.length).toBeGreaterThan(0);
    expect(active.roles.every((r) => r === "admin")).toBe(true);
    expect(active.scopes).toEqual(["role:supervisor", "role:admin"]); // the assigner's check, then the assignee's
  });
});

describe("final wave P-H1 — item: the assigner's scope is resolved for a MISSING item too", () => {
  for (const type of ["ecn", "recipe", "interlock_rule", "changeover"] as const) {
    it(`★ ${type}: missing id and existing out-of-scope id ⇒ the same lookups, both null (NOT_FOUND)`, async () => {
      const d = (await import("../db/connection")).getDb;
      const db = (await d()) as never;
      rec.calls.length = 0;
      rec.factoryRows = []; // missing
      expect(await resolveTargetForAssigner(db, ctx, type, 999)).toBeNull();
      const missing = [...rec.calls];
      rec.calls.length = 0;
      rec.factoryRows = [{ id: 998, f: [2] }]; // exists, in factory 2 (outside the assigner's factory 1)
      expect(await resolveTargetForAssigner(db, ctx, type, 998)).toBeNull();
      expect(missing).toEqual([...rec.calls]);
      expect(missing).toContain("idsTrongPhamVi:factory");
    });
  }
});
