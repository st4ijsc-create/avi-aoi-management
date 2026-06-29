/**
 * Doc 09 / Phase D0 — Device Programming & Control: adapter + service unit tests.
 *
 * Covers (vitest; a tiny in-memory drizzle stand-in for the program_* tables):
 *   • stub adapter — validate (empty→error), compile (ok + outputRef), simulate timeline.
 *   • registry — stub implemented; an unimplemented kind throws / isImplemented=false.
 *   • service — buildArtifact persists a build; simulateBuild persists a sim run.
 *   • DEPLOY GATE — flag OFF → 'simulated' (no device path); a non-ok build → 'rejected';
 *     idempotency returns the prior row; flag ON + sign-off → adapter.deploy invoked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTableName } from "drizzle-orm";

// ── tiny in-memory drizzle stand-in (only the chains the service uses) ──
type Row = Record<string, any>;
const store = new Map<string, Row[]>();
const seqs = new Map<string, number>();

function tbl(t: any): string {
  return getTableName(t);
}
function nextId(name: string): number {
  const n = (seqs.get(name) ?? 0) + 1;
  seqs.set(name, n);
  return n;
}
function rows(name: string): Row[] {
  let r = store.get(name);
  if (!r) {
    r = [];
    store.set(name, r);
  }
  return r;
}

// A minimal query builder supporting: select().from().where().orderBy().limit(),
// insert().values().returning(), update().set().where().returning(), delete().where().
function makeDb() {
  return {
    select() {
      return {
        from(t: any) {
          const name = tbl(t);
          let data = [...rows(name)];
          const api: any = {
            where(pred: any) {
              data = data.filter((row) => (pred ? pred(row) : true));
              return api;
            },
            orderBy() {
              return api;
            },
            limit(n: number) {
              return Promise.resolve(data.slice(0, n));
            },
            then(res: any) {
              return Promise.resolve(data).then(res);
            },
          };
          return api;
        },
      };
    },
    insert(t: any) {
      const name = tbl(t);
      return {
        values(vals: Row | Row[]) {
          const arr = Array.isArray(vals) ? vals : [vals];
          const inserted = arr.map((v) => {
            const row = { id: nextId(name), ...v };
            rows(name).push(row);
            return row;
          });
          return {
            returning() {
              return Promise.resolve(inserted);
            },
            onConflictDoUpdate() {
              return { returning: () => Promise.resolve(inserted) };
            },
          };
        },
      };
    },
    update(t: any) {
      const name = tbl(t);
      return {
        set(patch: Row) {
          return {
            where(pred: any) {
              const matched = rows(name).filter((row) => (pred ? pred(row) : true));
              matched.forEach((row) => Object.assign(row, patch));
              return {
                returning: () => Promise.resolve(matched),
                then: (res: any) => Promise.resolve(matched).then(res),
              };
            },
          };
        },
      };
    },
    delete(t: any) {
      const name = tbl(t);
      return {
        where(pred: any) {
          const keep = rows(name).filter((row) => !(pred ? pred(row) : true));
          store.set(name, keep);
          return Promise.resolve();
        },
      };
    },
  };
}

// drizzle eq/and/desc become predicate factories the stand-in understands.
vi.mock("drizzle-orm", async (orig) => {
  const actual = (await orig()) as any;
  return {
    ...actual,
    eq: (col: any, val: any) => {
      const key = col?.name ?? col;
      return (row: Row) => row[key] === val;
    },
    and: (...preds: any[]) => (row: Row) => preds.every((p) => (p ? p(row) : true)),
    desc: (col: any) => col,
  };
});

vi.mock("../../db/connection", () => ({ getDb: async () => makeDb() }));

// Drizzle column objects in the stand-in just need a `.name` — mock the schema tables
// as thin objects whose columns carry their key name (matches the in-memory rows).
vi.mock("../../../drizzle/schema", () => {
  const mk = (name: string, cols: string[]) => {
    const t: any = { [Symbol.for("drizzle:Name")]: name };
    cols.forEach((c) => (t[c] = { name: c }));
    return t;
  };
  return {
    programProjects: mk("program_projects", ["id", "code", "kind", "deviceId", "updatedAt"]),
    programArtifacts: mk("program_artifacts", ["id", "projectId", "branch", "version", "kind", "language", "content", "status", "diagnosticsJson"]),
    programBuilds: mk("program_builds", ["id", "artifactId", "adapterKind", "status", "ok", "outputRef", "diagnosticsJson"]),
    programSimRuns: mk("program_sim_runs", ["id", "buildId", "ok"]),
    programDeployments: mk("program_deployments", ["id", "buildId", "projectId", "deviceId", "stage", "status", "simulated", "signedOffBy", "idempotencyKey", "rolledBackFromId"]),
    programSymbols: mk("program_symbols", ["id", "projectId", "name"]),
  };
});

import { StubProgrammingAdapter, programmingRegistry } from "./programmingAdapter";
import { buildArtifact, simulateBuild, deployBuild, validateArtifact } from "./programmingService";

beforeEach(() => {
  store.clear();
  seqs.clear();
  delete process.env.DPC_DEPLOY_ENABLED;
  programmingRegistry._clear();
});

describe("StubProgrammingAdapter", () => {
  it("validate: empty content → error", async () => {
    const a = new StubProgrammingAdapter();
    const r = await a.validate({ kind: "stub", language: "text", content: "  " });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("compile: ok with an outputRef + line meta", async () => {
    const a = new StubProgrammingAdapter();
    const r = await a.compile({ kind: "stub", language: "basic", content: "PRINT 1\nPRINT 2" });
    expect(r.ok).toBe(true);
    expect(r.outputRef).toContain("stub://build");
    expect(r.meta?.lines).toBe(2);
  });

  it("simulate: produces a per-line timeline", async () => {
    const a = new StubProgrammingAdapter();
    const build = await a.compile({ kind: "stub", language: "basic", content: "A\nB\nC" });
    const sim = await a.simulate(build, {});
    expect(sim.ok).toBe(true);
    expect(sim.timeline.length).toBe(3);
    expect(sim.totalDurationMs).toBeGreaterThan(0);
  });

  it("deploy: stub has no device path → always simulated", async () => {
    const a = new StubProgrammingAdapter();
    const r = await a.deploy({ ok: true, diagnostics: [] }, { stage: "staging", idempotencyKey: "k", hitl: { actionId: "x", requestedBy: 1 } });
    expect(r.simulated).toBe(true);
    expect(r.status).toBe("simulated");
  });
});

describe("programmingRegistry", () => {
  it("stub implemented; a future kind (gcode) is not yet", () => {
    expect(programmingRegistry.isImplemented("stub")).toBe(true);
    // D2 made zmotion-basic real; gcode (D2 backlog) / iec61131 (D5) are still pending.
    expect(programmingRegistry.isImplemented("gcode")).toBe(false);
    expect(() => programmingRegistry.getAdapter("gcode")).toThrow(/not yet implemented/);
  });

  it("unknown kind throws", () => {
    expect(() => programmingRegistry.getAdapter("nope" as any)).toThrow(/Unknown/);
  });
});

const USER = { id: 7, role: "admin", name: "T" };

function seedArtifact(content: string) {
  rows("program_projects").push({ id: 1, code: "P1", kind: "stub", deviceId: null });
  rows("program_artifacts").push({ id: 1, projectId: 1, branch: "main", version: 1, kind: "stub", language: "basic", content });
}

describe("programmingService", () => {
  it("buildArtifact persists an ok build", async () => {
    seedArtifact("PRINT 1\nPRINT 2");
    const b = await buildArtifact(1, USER);
    expect(b.ok).toBe(true);
    expect(b.status).toBe("ok");
    expect(rows("program_builds").length).toBe(1);
  });

  it("validateArtifact flags an empty program", async () => {
    seedArtifact("");
    const r = await validateArtifact(1);
    expect(r.ok).toBe(false);
  });

  it("simulateBuild persists a sim run + recovers meta (timeline = lines)", async () => {
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER);
    const sim = await simulateBuild(b.id, {}, USER);
    expect(sim.ok).toBe(true);
    expect(rows("program_sim_runs").length).toBe(1);
    // Regression guard: simulateBuild recompiles the artifact so adapter.simulate sees
    // the real meta (here stub → 2 lines). Before the fix this was always 1.
    expect(sim.timeline.length).toBe(2);
  });

  it("DEPLOY GATE: flag off → simulated, never reaches a device", async () => {
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER);
    const dep = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-1", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      USER,
    );
    expect(dep.simulated).toBe(true);
    expect(dep.status).toBe("simulated");
  });

  it("DEPLOY GATE: non-ok build → rejected", async () => {
    seedArtifact(""); // empty → build not ok
    const b = await buildArtifact(1, USER);
    expect(b.ok).toBe(false);
    const dep = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-2", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      USER,
    );
    expect(dep.status).toBe("rejected");
  });

  it("DEPLOY GATE: idempotency returns the prior row", async () => {
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER);
    const d1 = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-3", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      USER,
    );
    const d2 = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-3", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      USER,
    );
    expect(d2.id).toBe(d1.id);
    expect(rows("program_deployments").length).toBe(1);
  });

  it("DEPLOY GATE: flag ON + sign-off → adapter.deploy invoked (stub → simulated still)", async () => {
    process.env.DPC_DEPLOY_ENABLED = "true";
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER);
    const spy = vi.spyOn(programmingRegistry.getAdapter("stub"), "deploy");
    const dep = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-4", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      USER,
    );
    expect(spy).toHaveBeenCalled();
    // stub still reports simulated (it has no device path) — the audit row reflects that.
    expect(dep.simulated).toBe(true);
  });

  it("DEPLOY GATE: flag ON but NO sign-off → simulated (adapter NOT invoked)", async () => {
    process.env.DPC_DEPLOY_ENABLED = "true";
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER);
    const spy = vi.spyOn(programmingRegistry.getAdapter("stub"), "deploy");
    const dep = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-5", hitl: { actionId: "a", requestedBy: 7 } },
      USER,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(dep.status).toBe("simulated");
  });
});
