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
            // doc 80 WS-06 — deployBuild giữ chỗ bằng INSERT … ON CONFLICT (idempotencyKey)
            // DO NOTHING RETURNING. Mô phỏng unique: dòng vừa chèn trùng khoá với dòng CŨ hơn
            // bị gỡ lại và RETURNING rỗng.
            onConflictDoNothing() {
              const kept = inserted.filter((row) => {
                const dup =
                  row.idempotencyKey != null &&
                  rows(name).some((r) => r !== row && r.idempotencyKey === row.idempotencyKey);
                if (dup) store.set(name, rows(name).filter((r) => r !== row));
                return !dup;
              });
              return { returning: () => Promise.resolve(kept) };
            },
          };
        },
      };
    },
    transaction(fn: (tx: any) => Promise<any>) {
      return fn(this);
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
import {
  buildArtifact,
  simulateBuild,
  deployBuild,
  validateArtifact,
  reviewArtifact,
  requestVersionReview,
} from "./programmingService";
import { readAppErrorMeta } from "../../_core/appError";

beforeEach(() => {
  store.clear();
  seqs.clear();
  delete process.env.DPC_DEPLOY_ENABLED;
  delete process.env.DPC_VERSION_REVIEW_ENABLED;
  programmingRegistry._clear();
  vi.restoreAllMocks();
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

  it("DEPLOY GATE: flag ON + sign-off + PASSING sim → adapter.deploy invoked (stub → simulated still)", async () => {
    process.env.DPC_DEPLOY_ENABLED = "true";
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER);
    await simulateBuild(b.id, {}, USER); // P0: a PASSING Simulation Gate run is now required before a real deploy.
    const spy = vi.spyOn(programmingRegistry.getAdapter("stub"), "deploy");
    const dep = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-4", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      USER,
    );
    expect(spy).toHaveBeenCalled();
    // stub still reports simulated (it has no device path) — the audit row reflects that.
    expect(dep.simulated).toBe(true);
  });

  it("P0 SIM GATE: flag ON + sign-off but NO passing sim → rejected, adapter NOT invoked", async () => {
    // The Simulation Gate is a HARD precondition for reaching hardware: without a
    // passing program_sim_runs row, a real deploy is refused (recorded 'rejected') and
    // the device path is never invoked — even with the flag on and a human sign-off.
    process.env.DPC_DEPLOY_ENABLED = "true";
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER); // ok build, but never simulated
    const spy = vi.spyOn(programmingRegistry.getAdapter("stub"), "deploy");
    const dep = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-gate", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      USER,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(dep.status).toBe("rejected");
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

  // ── W2-9 (doc 25 T6) — segregation of duties for PRODUCTION real deploys ──
  it("SoD: production + flag ON + self-approval (confirmedBy === requestedBy) → rejected, adapter NOT invoked", async () => {
    process.env.DPC_DEPLOY_ENABLED = "true";
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER);
    await simulateBuild(b.id, {}, USER); // passing sim gate — isolate the SoD check
    const spy = vi.spyOn(programmingRegistry.getAdapter("stub"), "deploy");
    const dep = await deployBuild(
      { buildId: b.id, stage: "production", idempotencyKey: "idem-sod-1", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      USER,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(dep.status).toBe("rejected");
    expect(dep.simulated).toBe(true);
    expect(dep.error).toMatch(/[Ss]egregation of duties/);
  });

  it("SoD: production + flag ON + DIFFERENT approver + passing sim → adapter invoked", async () => {
    process.env.DPC_DEPLOY_ENABLED = "true";
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER);
    await simulateBuild(b.id, {}, USER);
    const spy = vi.spyOn(programmingRegistry.getAdapter("stub"), "deploy");
    const dep = await deployBuild(
      { buildId: b.id, stage: "production", idempotencyKey: "idem-sod-2", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 8, reason: "duyệt bởi trưởng ca" } },
      USER,
    );
    expect(spy).toHaveBeenCalled();
    expect(dep.status).not.toBe("rejected");
    // Lý do duyệt được ghi vào detailJson (lưu vết SoD).
    expect((dep.detailJson as any)?.approvalReason).toBe("duyệt bởi trưởng ca");
  });

  it("SoD: staging self-approval is UNAFFECTED (two-person control applies to production only)", async () => {
    process.env.DPC_DEPLOY_ENABLED = "true";
    seedArtifact("A\nB");
    const b = await buildArtifact(1, USER);
    await simulateBuild(b.id, {}, USER);
    const dep = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-sod-3", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      USER,
    );
    expect(dep.status).not.toBe("rejected");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// doc 80 Đợt 1 Task 5 — WS-01 (duyệt phiên bản trong IDE) + WS-02 (deploy giữ meta).
// ════════════════════════════════════════════════════════════════════════════

/** Lỗi của một promise (hoặc null nếu nó KHÔNG ném). */
async function loiCua(p: Promise<unknown>): Promise<any> {
  return p.then(() => null, (e: unknown) => e);
}

function seedKind(kind: string, language: string, content: string, extra: Row = {}) {
  rows("program_projects").push({ id: 1, code: "P1", kind, deviceId: null });
  rows("program_artifacts").push({
    id: 1, projectId: 1, branch: "main", version: 1, kind, language, content,
    createdBy: 7, reviewStatus: "pending_review", ...extra,
  });
}

const AUTHOR = { id: 7, role: "engineer", name: "Tac gia" };
const REVIEWER = { id: 8, role: "supervisor", name: "Nguoi duyet" };

describe("WS-01 — duyệt phiên bản (SoD + lý do từ chối + build bị khoá có mã)", () => {
  it("SoD: tác giả tự duyệt phiên bản của mình ⇒ FORBIDDEN có mã PERMISSION_DENIED (không phải Error trần ⇒ 500), trạng thái KHÔNG đổi", async () => {
    seedKind("stub", "basic", "A\nB");
    const e = await loiCua(reviewArtifact(1, "approved", AUTHOR));
    expect(e?.code).toBe("FORBIDDEN");
    expect(readAppErrorMeta(e)).toEqual({ appCode: "PERMISSION_DENIED", appParams: { action: "selfApproveProgramVersion" } });
    expect(rows("program_artifacts")[0].reviewStatus).toBe("pending_review");
  });

  it("SoD: người KHÁC tác giả duyệt ⇒ approved + reviewedBy = người duyệt", async () => {
    seedKind("stub", "basic", "A\nB");
    const row = await reviewArtifact(1, "approved", REVIEWER);
    expect(row.reviewStatus).toBe("approved");
    expect(row.reviewedBy).toBe(8);
  });

  it("Từ chối BẮT BUỘC lý do: thiếu/trống ⇒ BAD_REQUEST FIELD_REQUIRED; có lý do ⇒ rejected + lý do lưu lại đọc được", async () => {
    seedKind("stub", "basic", "A\nB");
    const e = await loiCua(reviewArtifact(1, "rejected", REVIEWER, "   "));
    expect(e?.code).toBe("BAD_REQUEST");
    expect(readAppErrorMeta(e)).toEqual({ appCode: "FIELD_REQUIRED", appParams: { field: "reviewReason" } });
    expect(rows("program_artifacts")[0].reviewStatus).toBe("pending_review");

    const row = await reviewArtifact(1, "rejected", REVIEWER, "Thiếu interlock cửa");
    expect(row.reviewStatus).toBe("rejected");
    expect((row.diagnosticsJson as any)?.review?.reason).toBe("Thiếu interlock cửa");
    expect((row.diagnosticsJson as any)?.review?.decision).toBe("rejected");
  });

  it("Yêu cầu duyệt: ghi người/lúc yêu cầu; phiên bản đã duyệt ⇒ PRECONDITION_FAILED có mã", async () => {
    seedKind("stub", "basic", "A\nB");
    const row = await requestVersionReview(1, AUTHOR);
    expect((row.diagnosticsJson as any)?.review?.requestedBy).toBe(7);
    await reviewArtifact(1, "approved", REVIEWER);
    const e = await loiCua(requestVersionReview(1, AUTHOR));
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(readAppErrorMeta(e)?.appParams).toEqual({ operation: "requestVersionReview", reason: "versionReviewNotPending" });
  });

  it("validateArtifact KHÔNG xoá dấu vết duyệt (review) đã lưu trong diagnosticsJson", async () => {
    seedKind("stub", "basic", "A\nB");
    await requestVersionReview(1, AUTHOR);
    await validateArtifact(1);
    expect((rows("program_artifacts")[0].diagnosticsJson as any)?.review?.requestedBy).toBe(7);
  });

  it("Build bị khoá khi pending_review (cờ BẬT) ⇒ PRECONDITION_FAILED mã versionNotApproved, KHÔNG tạo build", async () => {
    process.env.DPC_VERSION_REVIEW_ENABLED = "true";
    seedKind("stub", "basic", "A\nB");
    const e = await loiCua(buildArtifact(1, AUTHOR));
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(readAppErrorMeta(e)).toEqual({
      appCode: "OPERATION_FAILED",
      appParams: { operation: "buildArtifact", reason: "versionNotApproved" },
    });
    expect(rows("program_builds").length).toBe(0);
    // Sau khi người khác duyệt ⇒ build được.
    await reviewArtifact(1, "approved", REVIEWER);
    const b = await buildArtifact(1, AUTHOR);
    expect(b.ok).toBe(true);
  });

  it("Cờ TẮT ⇒ build pending_review vẫn chạy như cũ (hành vi mặc định không đổi)", async () => {
    seedKind("stub", "basic", "A\nB");
    const b = await buildArtifact(1, AUTHOR);
    expect(b.ok).toBe(true);
  });
});

describe("WS-02 — deploy thật đưa adapter BuildResult CÓ meta (biên dịch lại từ artifact + kiểm checksum)", () => {
  const ZMC_SRC = "MOVE(10)\nMOVE(20)\nPRINT 1";
  const TM_SRC = "POINT P1 = (0,0,0,0,0,0)\nHOME\nMOVE P1\nWAIT t=100";

  async function realDeploy(kind: string, key: string) {
    process.env.DPC_DEPLOY_ENABLED = "true";
    const b = await buildArtifact(1, AUTHOR);
    expect(b.ok).toBe(true);
    rows("program_sim_runs").push({ id: 99, buildId: b.id, ok: true }); // Simulation Gate ĐẠT
    const spy = vi
      .spyOn(programmingRegistry.getAdapter(kind as any), "deploy")
      .mockResolvedValue({ ok: false, status: "failed", simulated: false, error: "spy" });
    const dep = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: key, hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      AUTHOR,
    );
    return { b, spy, dep };
  }

  it("zmotion-basic: adapter.deploy nhận meta có filePath (.bas) + moves — trước đây meta rỗng ⇒ luôn failed", async () => {
    seedKind("zmotion-basic", "basic", ZMC_SRC);
    const { spy } = await realDeploy("zmotion-basic", "idem-zmc-meta");
    expect(spy).toHaveBeenCalledTimes(1);
    const build = spy.mock.calls[0][0];
    expect(typeof build.meta?.filePath).toBe("string");
    expect(build.meta?.moves).toBe(2);
    expect(build.outputRef).toMatch(/^zmc:\/\/build\//);
  });

  it("robot-tm: adapter.deploy nhận meta.stepList khác rỗng", async () => {
    seedKind("robot-tm", "tmscript", TM_SRC);
    const { spy } = await realDeploy("robot-tm", "idem-tm-meta");
    expect(spy).toHaveBeenCalledTimes(1);
    const build = spy.mock.calls[0][0];
    expect(Array.isArray(build.meta?.stepList)).toBe(true);
    expect((build.meta?.stepList as unknown[]).length).toBeGreaterThan(0);
  });

  it("checksum LỆCH (build đã lưu ≠ biên dịch lại) ⇒ PRECONDITION_FAILED có mã, adapter KHÔNG được gọi, dòng failed + not_written", async () => {
    process.env.DPC_DEPLOY_ENABLED = "true";
    seedKind("zmotion-basic", "basic", ZMC_SRC);
    const b = await buildArtifact(1, AUTHOR);
    rows("program_sim_runs").push({ id: 99, buildId: b.id, ok: true });
    // Mô phỏng build đã lưu KHÔNG còn khớp nguồn (artifact bị sửa tại chỗ / build của nguồn khác).
    rows("program_builds")[0].outputRef = "zmc://build/deadbeefdeadbeef";
    const spy = vi.spyOn(programmingRegistry.getAdapter("zmotion-basic"), "deploy");
    const e = await loiCua(
      deployBuild(
        { buildId: b.id, stage: "staging", idempotencyKey: "idem-zmc-mismatch", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
        AUTHOR,
      ),
    );
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(readAppErrorMeta(e)).toEqual({
      appCode: "OPERATION_FAILED",
      appParams: { operation: "deployBuild", reason: "buildChecksumMismatch" },
    });
    expect(spy).not.toHaveBeenCalled();
    const dep = rows("program_deployments")[0];
    expect(dep.status).toBe("failed");
    // Chưa chạm thiết bị ⇒ KHÔNG được nói "có thể đã ghi" (outcome unknown).
    expect(dep.simulated).toBe(true);
    expect((dep.detailJson as any)?.outcome).toBe("not_written");
  });

  it("biên dịch lại NÉM ⇒ cùng lời từ chối có mã, adapter KHÔNG được gọi, dòng failed + not_written (không phải 'unknown')", async () => {
    process.env.DPC_DEPLOY_ENABLED = "true";
    seedKind("zmotion-basic", "basic", ZMC_SRC);
    const b = await buildArtifact(1, AUTHOR);
    rows("program_sim_runs").push({ id: 99, buildId: b.id, ok: true });
    const adapter = programmingRegistry.getAdapter("zmotion-basic");
    vi.spyOn(adapter, "compile").mockRejectedValue(new Error("toolchain crashed"));
    const spy = vi.spyOn(adapter, "deploy");
    const e = await loiCua(
      deployBuild(
        { buildId: b.id, stage: "staging", idempotencyKey: "idem-zmc-throw", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
        AUTHOR,
      ),
    );
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(String(e?.message)).toMatch(/toolchain crashed/);
    expect(spy).not.toHaveBeenCalled();
    const dep = rows("program_deployments")[0];
    expect(dep.simulated).toBe(true);
    expect((dep.detailJson as any)?.outcome).toBe("not_written");
  });

  it("đường mô phỏng (cờ TẮT) không biên dịch lại, không kiểm checksum — hành vi cũ giữ nguyên", async () => {
    seedKind("zmotion-basic", "basic", ZMC_SRC);
    const b = await buildArtifact(1, AUTHOR);
    rows("program_builds")[0].outputRef = "zmc://build/deadbeefdeadbeef";
    const dep = await deployBuild(
      { buildId: b.id, stage: "staging", idempotencyKey: "idem-zmc-off", hitl: { actionId: "a", requestedBy: 7, confirmedBy: 7 } },
      AUTHOR,
    );
    expect(dep.status).toBe("simulated");
  });
});
