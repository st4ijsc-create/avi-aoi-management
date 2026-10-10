/**
 * doc 81 Đợt 5 final wave F5 (final review M2) — the orchestration scope JUDGE must not turn "the read DB is unavailable"
 * into a decided "nothing is in scope": `resolveTenantFactoryScope` / `resolveTenantCodeFactoryIds` answer [] with no DB
 * (a fail-closed default that other callers rely on), so the judge asks them in STRICT mode, where no DB is an error ⇒
 * `judge.failed` ⇒ abort / reject answer "scope not verified" (R-5-l), reads degrade — never "not found" on a guess.
 * Control: with the DB present the same scope resolves normally (decided, not failed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ readDb: null as unknown, db: null as unknown }));
vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => (typeof h.db === "function" ? (h.db as () => unknown)() : h.db)),
  getReadDb: vi.fn(async () => h.readDb),
}));
vi.mock("../../../_core/accessControl", () => ({
  resolveDataScope: vi.fn(async () => ({ filter: { scoped: true }, scopeApplied: true, scopeEmptyReason: null, scopeMessage: null })),
  getUserAssignmentCodes: vi.fn(async () => ({ corporateCodes: [], factoryCodes: ["F1"], isAdmin: false })),
}));

import { makeScopeJudge } from "./foeScope";
import { idsTrongPhamVi } from "../../../db/hierarchy";
import { resolveTenantFactoryScope } from "../../../db/reportAggregators";

/** A db whose every select / execute answers the given rows (factories → id 7; hierarchy → machine 70). */
function fakeDb() {
  const rows = [{ id: 7 }];
  const builder: any = { from: () => builder, where: () => builder, limit: () => builder, then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej) };
  return { select: () => builder, execute: async () => [{ id: 70 }] };
}

beforeEach(() => {
  h.readDb = null;
  h.db = null;
});

describe("final wave F5 — read DB unavailable ⇒ the orchestration judge is UNDECIDED (failed), never a decided 'out'", () => {
  for (const [label, scope] of [
    ["a scoped user", { userId: 5, userRole: "engineer" }],
    ["a factory API key", { tenantScope: { factoryCode: "F1" } }],
  ] as const) {
    it(`★ ${label}: no read DB / no DB ⇒ judge.failed (was: an empty scope, i.e. everything decided out of scope)`, async () => {
      const judge = await makeScopeJudge(scope as never);
      expect(judge.unrestricted).toBe(false);
      expect(judge.failed).toBe(true);
    });
  }

  it("control: with the DB present the same user scope is DECIDED (not failed) and resolves the machines", async () => {
    h.readDb = fakeDb();
    h.db = fakeDb();
    const judge = await makeScopeJudge({ userId: 5, userRole: "engineer" });
    expect(judge.failed).toBe(false);
    const out = await judge.outOf({ machines: new Map([[70, true], [71, true]]), robots: new Map(), adapters: new Map() }, { nonStopOnly: true });
    expect(out.machines).toEqual([71]);
  });

  it("other callers keep their fail-closed default: without strict, no read DB ⇒ [] (unchanged)", async () => {
    expect((await resolveTenantFactoryScope({ userId: 5, userRole: "engineer" })).factoryIds).toEqual([]);
    expect(await idsTrongPhamVi("machine", { userId: 5, userRole: "engineer" })).toEqual([]);
  });

  it("strict mode: each missing DB on the way throws (resolver read DB, assignments' primary DB, hierarchy's primary DB)", async () => {
    // only the READ DB missing (primary present)
    h.db = fakeDb();
    await expect(resolveTenantFactoryScope({ userId: 5, userRole: "engineer" }, { strict: true })).rejects.toThrow(/read DB/);
    await expect(resolveTenantFactoryScope({ tenantScope: { factoryCode: "F1" } }, { strict: true })).rejects.toThrow(/unavailable/i);
    // only the PRIMARY DB missing (the assignment lookups would answer "no factory")
    h.db = null;
    h.readDb = fakeDb();
    await expect(resolveTenantFactoryScope({ userId: 5, userRole: "engineer" }, { strict: true })).rejects.toThrow(/primary DB/);
    // resolver fully served, then the hierarchy query finds no primary DB
    let calls = 0;
    h.db = () => (++calls === 1 ? fakeDb() : null);
    await expect(idsTrongPhamVi("machine", { userId: 5, userRole: "engineer" }, { strict: true })).rejects.toThrow(/idsTrongPhamVi\(machine\)/);
  });
});
