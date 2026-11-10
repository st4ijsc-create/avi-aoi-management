/**
 * doc 81 Đợt 10 task C — ONE WALKER, TWO STORES: PARITY.
 *
 * The same definitions are walked twice by the SAME engine code:
 *   • CENTRAL — startRun / resumeRun / abortRun against the (fake) database (foeRunStore.centralRunStore, the pre-Đợt-10 code);
 *   • EDGE    — driveEdgeRunFromPackage against an in-memory edge store (edge/edgeRunStore.ts): a package built from the same
 *               database rows, a fake journal (the run-stream records it would ship) and a fake /authorize that decides exactly
 *               like central (findSeparateGateApproval over the same rows). Central then APPLIES the edge's records and its
 *               segment end with the exports group B calls (recordEdgeStepRows / applyEdgeSegmentEnd), and approves gates with
 *               the real resumeRun (edge branch: hand back to 'queued').
 * Required identical: the step-row sequence (stepId, status, attempt, result kind) the walker writes, the run outcome
 * sequence, the commands that reach the equipment, and the FINAL rows central holds for the two runs. Cases: gate pause,
 * branch, parallel, retry, compensation, abort sweep (+ the gate refusal text, the STOP that never asks, D5 held).
 * The equipment registry is replaced by a recording fake (the walker is under test, not the dispatchers — group D).
 */
import { describe, it, expect, vi, afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { FakeDb, makeEq, makeAnd, nhayId, resetSeq } from "../../../routers/__otFakeDb";

const h = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  failPlan: new Map<string, number>(), // stepId → how many attempts fail (Infinity ⇒ always)
  /** fix review 1 — while an EDGE walk runs, the database THROWS (and every attempt is counted): "reads no DB" is measured */
  dbThrows: false,
  dbCalls: 0,
  /** fix review 5 — device ownership as central reads it (B's edgeCentralCommon; raw SQL there ⇒ modelled here) */
  foreignRobots: new Set<number>(),
  foreignAdapters: new Set<number>(),
  ownershipThrows: false,
  /** fix review 3 — the edge dispatch's LEDGER record (journaled inside sendCommand, BEFORE the walker's result row) */
  onLedger: null as null | ((cmd: Record<string, any>, ok: boolean) => void),
  telemetry: [] as Array<{ key: string; value: unknown }>,
  /** R1b-2b-2a A2(o) AMENDMENT 2 — these steps' NEXT dispatch is refused by the edge's config gate (CONFIG_STALE: nothing sent) */
  staleDispatch: new Set<string>(),
  /** A2(o) r3 F4 — these steps' NEXT dispatch is refused by the config gate with SAFETY_CONFIG_MISSING (nothing sent) */
  missingDispatch: new Set<string>(),
  /** R1b-2b-2a A2(n) — these steps' dispatch answers `timeout` (sent, outcome unknown) */
  timeoutDispatch: new Set<string>(),
  /** A2(n) extension — these steps' NEXT dispatch alone answers `timeout` */
  timeoutOnce: new Set<string>(),
  /** A2(n) — the URGENT alerts raised (recorded) */
  alerts: [] as Array<Record<string, any>>,
  /** A2(n) T0 — phanLoaiStopGhimChoFoe's scripted answer (null ⇒ read fine, not pinned); ghimLan: the questions that reached it */
  ghim: null as null | ((d: unknown, i: { commandType: string }) => Promise<{ pinnedStop: boolean; loiDocGhim: string | null }>),
  ghimLan: [] as string[],
  /** A2(n) T6e — phanLoaiStopGhimChoFoe is the dispatcher's REAL predicate (its pin read and its coercion, over the fake's device_tags), not h.ghim */
  ghimThat: false,
  /** A2(n) T0 — classifyOtStop throws, as the pin read of a verifier; classifyLan: the calls that reached it */
  classifyLoi: false,
  classifyLan: 0,
  /** A2(n) T0 — runningConnectionMatchesAdapterRow's answer; connLan: the calls that reached it */
  connOk: true,
  connLan: 0,
  /** A2(n) T0 — these steps' dispatch answers this many ms later */
  slow: new Map<string, number>(),
  /** A2(n) T0 — a dispatch that went answers `acked` (a real device path) instead of `simulated` */
  acked: false,
  /** A2(n) T0 — what the alert reports through `baoBen`: was the URGENT stored? */
  alertDurable: true,
  /** A2(n) T5 — the process dies inside the raise: the alert lands here, the mock stores nothing and never calls `baoBen` */
  raiseChet: null as null | Array<Record<string, any>>,
  /** A2(n) T0 — these steps' dispatch is refused by a consumeAuthorization past its bound (the disk lot's round C): nothing sent, the journal says it overran */
  consumeQuaHan: new Set<string>(),
  /** A2(n) T0 — the REAL alert ran (its CRITICAL line): a mock that did not reach its target. Stays 0 */
  canhBaoThat: 0,
  /** A2(n) T3+T4 — answers of `timeout` given so far: from the first one the latch can fall; a command that reaches the fake after it is marked `sauKhoa` */
  traTimeout: 0,
  /** A2(n) T3+T4 — with h.acked: the status of the answer (the read-back's acked_verified) */
  ackStatus: "acked",
  /** A2(n) T3+T4 — what a case allows after the latch beyond a STOP: a compensation a person approved */
  duocSauKhoa: new Set<string>(),
  /** A2(n) T7b-1d lượt sửa 1 (H29) — every withDeadline of the code under test runs at this fraction of its bound: 0 ⇔ as written. A hang's case costs no real seconds */
  heSoHan: 0,
  /** H29 — a lazily imported module whose name holds this key: its load waits on the promise, then goes on; napGoi counts the loads asked; napTuChoi: the load rejects */
  treoNap: new Map<string, Promise<void>>(),
  napTuChoi: new Set<string>(),
  napGoi: new Map<string, number>(),
  /** H29 — makeStopVerifier with a database ("co"), without ("khong"), or both ("ca") never answers */
  treoVerifier: null as null | "co" | "khong" | "ca",
  /** H29 — laStopTheoBuoc and isStopCandidate wait on what this answers; undefined: as written */
  treoLaStop: null as null | (() => Promise<void> | undefined),
  /** H29 — SEC_PLATFORM on, with no policy denying anything */
  coBat: false,
  /** A2(n) T7b-1d — this step's dispatch never answers (no timer behind it) */
  khongTraLoi: new Set<string>(),
  /** A2(n) T5 — the dispatcher's own answer for a step: a refusal, or `nem`: the dispatch throws */
  tuChoi: new Map<string, { status?: string; error?: string; detail?: Record<string, unknown>; nem?: string }>(),
  /** A2(n) T5 — refusals answered in order, one per attempt, then h.tuChoi as usual */
  tuChoiLan: new Map<string, Array<{ status?: string; error?: string; detail?: Record<string, unknown> }>>(),
  /** A2(n) T5 — once this step has answered `sau` times, it answers `kq` */
  tuChoiSau: new Map<string, { sau: number; kq: { status?: string; error?: string; detail?: Record<string, unknown> }; lan?: number }>(),
  /** A2(n) T5 — when h.tuChoiLan runs out for this step: no answer */
  timeoutSauTuChoi: new Set<string>(),
  /** A2(n) T5 — this refusal wrote nothing, it is the dispatcher's own "not pinned": the table of the case counts it as such */
  tuChoiKhongGhi: new Set<string>(),
  /**
   * A2(n) T5 (limit F1.2) — the dispatcher decides by the REAL pins (device_tags), never by what h.ghim says FOE was told: a stop-typed command whose writes are not pins is refused unless
   * it has a counting gate on an UNMARKED row. A marked row never passes unpinned. Edge: no authorisation, not pinned: refused with the snapshot's reason.
   */
  dispatcherThat: false,
  /** A2(n) T5 — with h.dispatcherThat: the dispatcher cannot read the pins either: only a gate approval passes */
  dispatcherKhongDoc: false,
  /** A2(n) T5 — runs once, the moment a step answers `timeout`: what changes right after the latch */
  sauTimeout: null as null | (() => void),
  /** A2(n) T5 — runningConnectionMatchesAdapterRow waits for this: a STOP pass stands before its verifier */
  connCho: null as null | Promise<void>,
  /** A2(n) T5 fix 1 — what the report path audited */
  audit: [] as Array<Record<string, unknown>>,
  /** A2(n) T5 — evaluateActionPolicy denies these steps; empty ⇒ SEC_PLATFORM off */
  policyTuChoi: new Set<string>(),
  /** A2(n) T7 — the next write of this run status throws, once (the database drops exactly then); statusThrowLan counts the writes it broke */
  statusThrow: null as null | string,
  statusThrowLan: 0,
  /** A2(n) T7 lượt sửa 1 — a step-row write this answers true for throws (insert, its upsert's update, an update); hangNemLan counts them */
  hangNem: null as null | ((v: Record<string, any>) => boolean),
  hangNemLan: 0,
  /** A2(n) T7 lượt sửa 1 — reads FROM this table throw, this many times (Infinity: until cleared); docNemSauThrow: armed by h.statusThrow when it fires */
  docNem: null as null | { bang: string; lan: number },
  docNemSauThrow: null as null | { bang: string; lan: number },
  docNemLan: 0,
  /** A2(n) T7 lượt sửa 1 — the alert's raise never answers and never resolves (a hung notifications write); treoLan counts the raises it swallowed */
  alertTreo: false,
  treoLan: 0,
  /** A2(n) T7b-1c — a step-row upsert of this step lands this many ms later, by a real timer; treGhiLan counts the writes it held */
  treGhi: new Map<string, number>(),
  treGhiLan: 0,
  /** A2(n) T7b-1c — a context write this answers true for throws, once; ctxNemLan counts them */
  ctxNem: null as null | ((ctx: Record<string, any>) => boolean),
  ctxNemLan: 0,
  /** A2(n) T7b-1c — the next run status write to 'aborted' lands this many ms later (the Abort's own); treAbortedLan counts them */
  treAborted: 0,
  treAbortedLan: 0,
  /** A2(n) T7b-1c — these writes of 'aborted' go first, undelayed: the delay is for a later one */
  treAbortedBoQua: 0,
  /** A2(n) T7b-1c — runs the moment that delayed write is about to land: what beat it to the row */
  khiTreAborted: null as null | (() => void),
  /** A2(n) T7b-1c — the dispatchers' ledger by key, modelled by THEIR rule: OT commandDispatcher.lyDoStopKhoaMoi (the real function), robot robotCommandDispatcher (only `done` replays). null: no ledger */
  soCai: null as null | Map<string, { ok: boolean; simulated: boolean; status: string; dangBay?: boolean; kq: Record<string, any> }>,
}));

vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return {
    isStopCommandType: orig.isStopCommandType,
    classifyOtStop: (...a: Parameters<typeof orig.classifyOtStop>) => {
      h.classifyLan++;
      if (h.classifyLoi) throw new Error("pin read down (test)");
      return orig.classifyOtStop(...a);
    },
    runningConnectionMatchesAdapterRow: async () => {
      h.connLan++;
      await h.connCho;
      return h.connOk;
    },
    phanLoaiStopGhimChoFoe: async (d: unknown, i: { commandType: string }) => {
      h.ghimLan.push(i.commandType);
      if (h.ghimThat) return orig.phanLoaiStopGhimChoFoe(d as never, i as never);
      return h.ghim ? h.ghim(d, i) : { pinnedStop: false, loiDocGhim: null };
    },
    // A2(n) T6e — the verifier's coercion is the dispatcher's own function: the real one
    epKieuGhiTheoTag: (orig as Record<string, unknown>).epKieuGhiTheoTag,
    // A2(n) T7b-1c — the ledger of this fake decides by the dispatcher's own function
    lyDoStopKhoaMoiCho: orig.lyDoStopKhoaMoiCho,
    dispatch: vi.fn(),
  };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: vi.fn() }));
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return {
    ...orig,
    raiseCriticalStopAlert: async (a: Record<string, any>) => {
      if (h.alertTreo) {
        h.treoLan++;
        return new Promise<void>(() => undefined);
      }
      if (h.raiseChet) {
        h.raiseChet.push(a);
        return;
      }
      h.alerts.push(a);
      a.baoBen?.(h.alertDurable);
    },
  };
});
vi.mock("../../edge/edgeCentralCommon", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../edge/edgeCentralCommon")>();
  const owned = (foreign: Set<number>) => async (_d: unknown, _node: number, ids: readonly number[]) => {
    if (h.ownershipThrows) throw new Error("ownership unreadable");
    return new Set(ids.filter((id) => !foreign.has(id)));
  };
  return { ...orig, ownedRobotIds: owned(h.foreignRobots), ownedAdapterIds: owned(h.foreignAdapters), runInNodeScope: async () => true, auditNode: async (_n: unknown, action: string, _e: unknown, details: Record<string, unknown>) => { h.audit.push({ action, details }); }, adapterOwners: async (_d: unknown, ids: readonly number[]) => new Map(ids.map((i) => [i, { edgeNodeId: 7, ownerEpoch: 1 }])), robotOwners: async (_d: unknown, ids: readonly number[]) => new Map(ids.map((i) => [i, { edgeNodeId: 7, ownerEpoch: 1 }])) };
});
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: vi.fn(async () => ({ id: 1 })) }));
vi.mock("../../security/policyGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../security/policyGate")>();
  return {
    ...orig,
    secPlatformEnabled: () => h.policyTuChoi.size > 0 || h.coBat,
    evaluateActionPolicy: (_s: string, _a: string, _r: string | null, ctx: { stepId?: string }) => (h.policyTuChoi.has(String(ctx.stepId)) ? { allow: false, effect: "deny", reason: "denied by policy p1 at 10.1.2.3", policyId: 1 } : { allow: true, effect: "allow", reason: "ok" }),
  };
});
// A2(n) T7b-1d lượt sửa 1 (H29) — where a hang is injected, each with its case in the T0 block
vi.mock("../../security/secPlatformFlag", () => ({ secPlatformEnabled: () => h.policyTuChoi.size > 0 || h.coBat }));
vi.mock("../../ot/drivers/boundedClose", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/drivers/boundedClose")>();
  return { ...orig, withDeadline: <T,>(p: Promise<T>, ms: number, nhan: string, opts?: { unref?: boolean; loi?: () => Error }) => orig.withDeadline(p, h.heSoHan > 0 ? Math.max(5, ms * h.heSoHan) : ms, nhan, opts) };
});
vi.mock("./foeNapMotLan", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeNapMotLan")>();
  return {
    napMotLan: <T,>(nap: () => Promise<T>) => {
      const lay = orig.napMotLan(nap);
      const ten = String(nap);
      return () => {
        for (const k of ["commandDispatcher", "policyGate"]) {
          if (!ten.includes(k)) continue;
          h.napGoi.set(k, (h.napGoi.get(k) ?? 0) + 1);
          if (h.napTuChoi.has(k)) return Promise.reject(new Error(`load of ${k} refused (test)`)) as Promise<T>;
          const cho = h.treoNap.get(k);
          if (cho) return cho.then(() => lay());
        }
        return lay();
      };
    },
  };
});
vi.mock("./foeStepClass", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeStepClass")>();
  return {
    ...orig,
    makeStopVerifier: (db: never, defs: never, map: never) => (h.treoVerifier === "ca" || h.treoVerifier === (db ? "co" : "khong") ? new Promise<never>(() => undefined) : orig.makeStopVerifier(db, defs, map)),
    laStopTheoBuoc: async (st: never, map: never) => {
      await h.treoLaStop?.();
      return orig.laStopTheoBuoc(st, map);
    },
    isStopCandidate: async (st: never, map: never) => {
      await h.treoLaStop?.();
      return orig.isStopCandidate(st, map);
    },
  };
});
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return { ...orig, resolveUserFoeScope: () => null };
});
/** the equipment: a recording fake (per-step failure plan; the idempotency key names the step and attempt) */
vi.mock("../../equipment/equipmentAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../equipment/equipmentAdapter")>();
  const adapter = (kind: string) => ({
    /** A2(n) T7b-1c — the dispatcher's word on a key already used, then the hand-over. A replay writes nothing; a STOP whose earlier try is not ok goes for real under a new key, naming that try (lanTruoc) */
    async sendCommand(cmd: Record<string, any>) {
      const so = h.soCai;
      if (!so) return this.giao(cmd);
      const khoa = String(cmd.idempotencyKey);
      const truoc = so.get(khoa);
      const m0 = /^run\d+-(.+)-a(\d+)$/.exec(khoa) ?? /^run\d+-abort-[^-]+-(.+)$/.exec(khoa);
      let lyDo: string | null = null;
      if (truoc) {
        if (kind === "robot") lyDo = truoc.status === "done" ? null : "robot_khac_done";
        else lyDo = lyDoStopKhoaMoiCho((truoc.dangBay ? { loai: "dang_bay", hang: [] } : { loai: "phat_lai", existing: {}, hangLo: [] }) as never, (truoc.dangBay ? null : { ok: truoc.ok, simulated: truoc.simulated }) as never, khoa);
        if (lyDo === null) {
          h.sent.push({ kind, stepId: m0 ? m0[1] : "?", key: khoa, name: cmd.name, adapterId: cmd.adapterId ?? null, robotId: cmd.robotId ?? null, writes: cmd.writes ?? null, job: cmd.job ?? null, edge: cmd.edge ?? null, hitl: cmd.hitl, sauKhoa: h.traTimeout > 0, lan: m0 ? m0[2] : null, khongGhi: true, phatLai: true });
          return truoc.kq;
        }
      }
      const n = h.sent.length;
      const cho = this.giao(cmd);
      const ghi = h.sent[n] as Record<string, unknown>;
      const moi = lyDo ? (kind === "robot" ? "" : `${khoa}#stop-${randomUUID()}`) : khoa;
      if (lyDo) Object.assign(ghi, { khoaMoi: moi, lanTruoc: { idempotencyKey: khoa, lyDo } });
      const kq = (await cho) as Record<string, any>;
      if (moi) so.set(moi, { ok: kq.ok === true, simulated: kq.status === "simulated", status: String(kq.status), kq });
      return kq;
    },
    async giao(cmd: Record<string, any>) {
      const m = /^run\d+-(.+)-a(\d+)$/.exec(String(cmd.idempotencyKey)) ?? /^run\d+-abort-[^-]+-(.+)$/.exec(String(cmd.idempotencyKey));
      const stepId = m ? m[1] : "?";
      const ghi: Record<string, unknown> = { kind, stepId, key: String(cmd.idempotencyKey), name: cmd.name, adapterId: cmd.adapterId ?? null, robotId: cmd.robotId ?? null, writes: cmd.writes ?? null, job: cmd.job ?? null, edge: cmd.edge ?? null, hitl: cmd.hitl, sauKhoa: h.traTimeout > 0, lan: m ? m[2] : null };
      h.sent.push(ghi);
      if (h.khongTraLoi.has(stepId)) await new Promise<never>(() => undefined);
      const cham = h.slow.get(stepId);
      if (cham) await new Promise((r) => setTimeout(r, cham));
      const routedTo = kind === "robot" ? "robot-dispatcher" : "ot-dispatcher";
      const traLoi = (t: { status?: string; error?: string; detail?: Record<string, unknown> }) => ({ ok: false, status: t.status ?? "rejected", routedTo, ...(t.error ? { error: t.error } : {}), detail: t.detail ?? {} });
      const tc = h.tuChoi.get(stepId);
      if (tc?.nem) throw new Error(tc.nem);
      const lanLuot = h.tuChoiLan.get(stepId);
      if (lanLuot?.length) return traLoi(lanLuot.shift()!);
      if (lanLuot && h.timeoutSauTuChoi.has(stepId)) {
        h.traTimeout++;
        return { ok: false, status: "timeout", routedTo, error: `no answer from ${stepId}` };
      }
      const sau = h.tuChoiSau.get(stepId);
      if (sau) {
        sau.lan = (sau.lan ?? 0) + 1;
        if (sau.lan > sau.sau) return traLoi(sau.kq);
      }
      if (tc) {
        if (h.tuChoiKhongGhi.has(stepId)) ghi.khongGhi = true;
        return traLoi(tc);
      }
      if (h.dispatcherThat && kind !== "robot" && (cmd.name === "stop" || cmd.name === "e_stop")) {
        const w = (cmd.writes ?? []) as Array<{ tagKey: string; value: unknown }>;
        const ghimThat = w.length > 0 && w.every((v) => (fake.store.get("device_tags") ?? []).some((t) => t.adapterId === cmd.adapterId && t.tagKey === v.tagKey && t.stopValue != null && t.stopValue === v.value));
        if (cmd.edge) {
          if (!ghimThat && !cmd.edge.authorization) {
            ghi.khongGhi = true;
            return traLoi({ status: "rejected", error: "AUTHORIZATION_REQUIRED", detail: { edge: true, stop: false, reason: "AUTHORIZATION_REQUIRED", refusal: "stop_not_pinned:no_pins" } });
          }
        } else {
          const hang = (fake.store.get("ai_pending_actions") ?? []).find((a) => a.id === cmd.hitl?.actionId);
          const coDau = JSON.stringify(hang?.previewJson ?? {}).includes("hangMoiStopGhim");
          const coDuyet = hang?.userRole === "foe_gate_approver";
          if (h.dispatcherKhongDoc ? !coDuyet || coDau : !ghimThat && (coDau || !coDuyet)) {
            ghi.khongGhi = true;
            return traLoi({ status: "rejected", detail: { reason: "NOT_CONFIRMED" } });
          }
        }
      }
      if (h.consumeQuaHan.has(stepId)) return { ok: false, status: "rejected", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: "JOURNAL_CONSUME_FAILED", detail: { edge: true, stop: false, reason: "JOURNAL_CONSUME_FAILED", refusal: "io_error" } };
      if (h.timeoutDispatch.has(stepId) || h.timeoutOnce.delete(stepId)) {
        h.traTimeout++;
        h.sauTimeout?.();
        h.sauTimeout = null;
        return { ok: false, status: "timeout", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: `no answer from ${stepId}` };
      }
      if (h.staleDispatch.delete(stepId)) {
        // exactly what equipmentAdapter's edge route returns for edgeNonStopConfigGate's CONFIG_STALE (before driver / consume)
        return { ok: false, status: "rejected", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: "CONFIG_STALE", detail: { edge: true, stop: false, reason: "CONFIG_STALE", refusal: "central announced config v4 3 s ago; this edge still holds v3 (issued 95 s ago) — non-STOP writes are refused until the refresh succeeds (STOPs still go)" } };
      }
      if (h.missingDispatch.delete(stepId)) {
        // exactly what equipmentAdapter's edge route returns for edgeNonStopConfigGate's SAFETY_CONFIG_MISSING (before driver / consume)
        return { ok: false, status: "rejected", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: "SAFETY_CONFIG_MISSING", detail: { edge: true, stop: false, reason: "SAFETY_CONFIG_MISSING", refusal: "signed safety-PLC config(s) #7 absent from the verified config v3 (issued 95 s ago) — the preflight could not consult them; refused, a refresh is requested" } };
      }
      const left = h.failPlan.get(stepId) ?? 0;
      h.onLedger?.(cmd, left === 0); // the REAL ordering: the ledger result is recorded before the walker writes its result row
      if (left > 0) {
        h.failPlan.set(stepId, left - 1);
        return { ok: false, status: "rejected", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: `scripted failure of ${stepId}` };
      }
      if (h.acked) return { ok: true, status: h.ackStatus, routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", detail: {} };
      return { ok: true, status: "simulated", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", detail: { simulated: true } };
    },
    async getState() {
      return { state: "EXECUTE" };
    },
    async readTelemetry() {
      return h.telemetry;
    },
  });
  return { ...orig, equipmentRegistry: { getAdapter: (kind: string) => adapter(kind) } };
});

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  const ne = (col: { name: string }, v: unknown) => (row: Record<string, unknown>) => row[col.name] !== v;
  const inArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => vs.includes(row[col.name]);
  const notInArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => !vs.includes(row[col.name]);
  const isNull = (col: { name: string }) => (row: Record<string, unknown>) => row[col.name] == null;
  return { ...actual, eq: makeEq, and: (...c: any[]) => makeAnd(...c.filter((x) => typeof x === "function")), ne, inArray, notInArray, isNull };
});
vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => {
    if (h.dbThrows) {
      h.dbCalls++;
      throw new Error("EDGE: this process has no database");
    }
    return fake;
  }),
}));

import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows, machines, deviceAdapters, deviceTags, robots, permissions, users } from "../../../../drizzle/schema";
import { syncRunResult } from "../../edge/edgeCoordinator"; // A2(n) T7c-b
import { EDGE_CENTRAL_ABORT_USER, _clearBuffer, bufferedCount, executeAssignedRun, setCentralSync } from "../../edge/edgeRuntime"; // A2(n) T7c-b
import { runEdgeAssignments } from "../../edge/edgeExecutionSchema";
import {
  deployWorkflow,
  startRun,
  resumeRun,
  abortRun,
  getRun,
  hashWorkflowDefinition,
  driveEdgeRunFromPackage,
  stopLiveRunForCentralAbort,
  recordEdgeStepRows,
  applyEdgeSegmentEnd,
  edgePriorPictureOf,
  autoResumeInterruptedRuns,
  rehydrateInterruptedRuns,
  FOE_GATE_REQUIRED,
} from "./foeEngine";
import { EDGE_HELD_CTX_KEY, baoKhongXacNhan, buTruLaStopGhimTrungTam, chuBuTruTrongDinhNghia, dauKhongXacNhan, findSeparateGateApproval, priorStepsOf, quenBenKhongXacNhan, quyetDinhKetThucAnh, persistContext, phanLoaiStopAbort, stopAbortCoGui, stopChuaRaTuHang, themBuocHongKhiTiepTuc, upsertStep, withResolvedAdapter } from "./foeRunStore";
import { eventsForNode, reportForNode } from "../../edge/edgeReportsCentral";
import { EdgeStreamShipper } from "../../edge/edgeStreams";
import { hashEdgeSecret } from "../../edge/edgeNodeCredentials";
import { edgeNodeProtocol } from "../../edge/edgeControlSchema";
import { edgeRunStream } from "../../edge/edgeProtocol";
import { CANH_BAO_KHONG_RO_KIND, KET_CUC_KHONG_RO_CHOT_CTX_KEY, KET_CUC_KHONG_RO_CTX_KEY, KET_CUC_KHONG_RO_DA_BAO_CTX_KEY, KHONG_CO_BU_TRU, buTruBiChanKhongRo, canhBaoKetCucKhongRo, chotTuHang, chuStopAbort, loiGiuChuaRa, nhanBuocSauChot, viChuaRaCuaLoi } from "./foeKetCucKhongRo";
import { getDb } from "../../../db/connection";
import { raiseCriticalStopAlert } from "../../robot/criticalStopAlert";
import { logCrudOperation } from "../../auditTrailService";
import { FOE_NOT_SENT_RUN_LATCHED, edgeResumeStateOf } from "./foeRunStore";
import { verifiedStopStepIds } from "./foeStepClass";
import { lyDoStopKhoaMoiCho, phanLoaiStopGhimChoFoe } from "../../ot/commandDispatcher";
import { analyseDefinition } from "../../edge/edgeRunAnalysis";
import { edgeContextPatchOf } from "../../edge/edgeContextPolicy";
import { createEdgeRunStore, type EdgeRunRecordIn, type EdgeStepAuthorizeOutcome, type EdgeStepAuthorizeRequest } from "../../edge/edgeRunStore";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";
import type { EdgeRunPackage } from "../../edge/edgeProtocol";
import type { MachineForValidation, WorkflowDefinition, WorkflowStep } from "./workflowModel";

type Row = Record<string, any>;
const OWNER = { id: 10, role: "engineer", name: "owner" };
const OTHER = { id: 12, role: "supervisor", name: "other" };
const T0 = new Date("2026-10-01T00:00:00Z");
const NODE = 7;

const rows = (t: string): Row[] => fake.store.get(t) ?? [];
const runRow = (id: number): Row => rows("orchestration_runs").find((r) => r.id === id)!;
const stepRows = (id: number): Row[] => rows("orchestration_run_steps").filter((s) => s.runId === id);

/** the central step-row WRITES (upsertStep ⇔ insert … onConflictDoUpdate on orchestration_run_steps), per run, in order */
const centralWrites = new Map<number, Array<{ stepId: string; status: string; attempt: number; result: string }>>();
const statusWrites = new Map<number, string[]>();
const resultKind = (r: unknown): string => {
  const v = r as Record<string, unknown> | null | undefined;
  if (v == null) return "-";
  if (typeof v.branch === "string") return `branch:${v.branch}`;
  if (typeof v.abortStop === "string") return `abort:${v.abortStop}`;
  if (typeof v.routedTo === "string") return `dispatch:${v.accepted === true ? "ok" : "refused"}`;
  if ("prompt" in v) return "gate";
  if ("approved" in v) return "approval";
  return Object.keys(v).sort().join(",");
};

/**
 * A2(n) T0 — a mock that did not reach its target. Two concurrent `import()` of one mocked module from one importer: vitest 2.1.9 (requestWithMock) hands the later one the REAL module,
 * not only on the first load, so loading the mock early does not help. The engine's modules go through napMotLan (foeNapMotLan.ts) and foeNapMotLan.test.ts holds them to it; the
 * real alert's CRITICAL line is counted here, so a leak is a red case, not a noise in the log. Fire-and-forget: the case that follows a leak may be the one that shows it.
 */
beforeAll(() => {
  const goc = console.error;
  console.error = (...a: unknown[]) => {
    if (String(a[0]).startsWith("[StopAlert] CRITICAL")) h.canhBaoThat++;
    goc(...a);
  };
});
afterEach(() => {
  expect(h.canhBaoThat, "the REAL alert ran: a mock did not reach its target").toBe(0);
});

beforeEach(() => {
  h.foreignRobots.clear();
  h.foreignAdapters.clear();
  h.ownershipThrows = false;
  h.onLedger = (cmd, ok) => {
    const a = cmd.edge?.authorization;
    if (!a) return;
    for (const r of fake.store.get("edge_step_authorizations") ?? []) {
      if (r.runId === a.runId && r.stepId === a.stepId && r.attempt === a.attempt) Object.assign(r, { resultReportedAt: new Date(), resultStatus: ok ? "simulated" : "rejected" });
    }
  };
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "ROBOT", capabilities: null, code: "R1", name: "Robot-1", operationStatus: "stopped", stationId: 1 },
  ]);
  fake.seed(deviceAdapters, [{ id: 501, machineId: 1, isEnabled: true, updatedAt: T0, protocol: "stub", code: "A501" }]);
  fake.seed(deviceTags, [
    { id: 71, adapterId: 501, tagKey: "run", address: "40001", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true },
    { id: 72, adapterId: 501, tagKey: "speed", address: "40002", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true },
  ]);
  fake.seed(robots, [{ id: 2, code: "R2", vendor: "sim", endpoint: "tcp://10.0.0.2:1", connectionOptions: { port: 1 }, isEnabled: true, status: "online", updatedAt: T0 }]);
  h.sent.length = 0;
  h.failPlan.clear();
  h.staleDispatch.clear();
  h.missingDispatch.clear();
  h.timeoutDispatch.clear();
  h.timeoutOnce.clear();
  h.alerts.length = 0;
  h.ghim = null;
  h.ghimThat = false;
  h.ghimLan.length = 0;
  h.classifyLoi = false;
  h.classifyLan = 0;
  h.connOk = true;
  h.connLan = 0;
  h.slow.clear();
  h.acked = false;
  h.alertDurable = true;
  h.raiseChet = null;
  h.consumeQuaHan.clear();
  h.traTimeout = 0;
  h.ackStatus = "acked";
  h.duocSauKhoa.clear();
  h.tuChoi.clear();
  h.tuChoiLan.clear();
  h.tuChoiSau.clear();
  h.timeoutSauTuChoi.clear();
  h.tuChoiKhongGhi.clear();
  h.dispatcherThat = false;
  h.dispatcherKhongDoc = false;
  h.policyTuChoi.clear();
  h.sauTimeout = null;
  h.connCho = null;
  h.statusThrow = null;
  h.statusThrowLan = 0;
  h.hangNem = null;
  h.hangNemLan = 0;
  h.docNem = null;
  h.docNemSauThrow = null;
  h.docNemLan = 0;
  h.alertTreo = false;
  h.treoLan = 0;
  h.heSoHan = 0;
  h.treoNap.clear();
  h.napTuChoi.clear();
  h.napGoi.clear();
  h.treoVerifier = null;
  h.treoLaStop = null;
  h.coBat = false;
  h.treGhi.clear();
  h.treGhiLan = 0;
  h.khongTraLoi.clear();
  h.ctxNem = null;
  h.ctxNemLan = 0;
  h.treAborted = 0;
  h.treAbortedLan = 0;
  h.khiTreAborted = null;
  h.treAbortedBoQua = 0;
  h.soCai = null;
  h.telemetry = [{ key: "temp", value: 80 }];
  centralWrites.clear();
  statusWrites.clear();
  // record every central step-row write and run-status write (the walker's store calls on the central side)
  const insert = FakeDb.prototype.insert.bind(fake);
  (fake as any).insert = (t: any) => {
    const b = insert(t);
    if (t?.[Symbol.for("drizzle:Name")] !== "orchestration_run_steps") return b;
    const values = b.values.bind(b);
    b.values = (v: Row) => {
      if (h.hangNem?.(v)) {
        h.hangNemLan++;
        throw new Error("db down at a step row write (test)");
      }
      const list = centralWrites.get(v.runId) ?? [];
      list.push({ stepId: v.stepId, status: v.status, attempt: v.attempt ?? 0, result: resultKind(v.resultJson) });
      centralWrites.set(v.runId, list);
      const r = values(v);
      if (r && typeof r.onConflictDoUpdate === "function") {
        const oc = r.onConflictDoUpdate.bind(r);
        r.onConflictDoUpdate = (x: { set?: Row }) => {
          if (h.hangNem?.({ ...v, ...(x?.set ?? {}) })) {
            h.hangNemLan++;
            throw new Error("db down at a step row write (test)");
          }
          const tre = h.treGhi.get(v.stepId);
          if (tre) {
            h.treGhiLan++;
            return new Promise((ok, loi) => setTimeout(() => Promise.resolve(oc(x)).then(ok, loi), tre));
          }
          return oc(x);
        };
      }
      return r;
    };
    return b;
  };
  const select = FakeDb.prototype.select.bind(fake);
  (fake as any).select = (pr?: unknown) => {
    const b = select(pr as never);
    const from = b.from.bind(b);
    b.from = (t: any) => {
      if (h.docNem && h.docNem.lan > 0 && t?.[Symbol.for("drizzle:Name")] === h.docNem.bang) {
        h.docNem.lan--;
        h.docNemLan++;
        throw new Error(`db down at a read of ${h.docNem.bang} (test)`);
      }
      return from(t);
    };
    return b;
  };
  const update = FakeDb.prototype.update.bind(fake);
  (fake as any).update = (t: any) => {
    const b = update(t);
    if (t?.[Symbol.for("drizzle:Name")] === "orchestration_run_steps") {
      const setS = b.set.bind(b);
      b.set = (v: Row) => {
        if (h.hangNem?.(v)) {
          h.hangNemLan++;
          throw new Error("db down at a step row write (test)");
        }
        return setS(v);
      };
      return b;
    }
    if (t?.[Symbol.for("drizzle:Name")] !== "orchestration_runs") return b;
    let status: unknown;
    const set = b.set.bind(b);
    b.set = (v: Row) => {
      status = v.status;
      if (h.statusThrow !== null && v.status === h.statusThrow) {
        h.statusThrow = null;
        h.statusThrowLan++;
        if (h.docNemSauThrow) {
          h.docNem = h.docNemSauThrow;
          h.docNemSauThrow = null;
        }
        throw new Error("db down at the run status write (test)");
      }
      if (h.ctxNem && v.contextJson !== undefined && h.ctxNem(v.contextJson)) {
        h.ctxNem = null;
        h.ctxNemLan++;
        throw new Error("db down at the context write (test)");
      }
      set(v);
      return b;
    };
    const where = b.where.bind(b);
    b.where = (c: any) => {
      const tre = status === "aborted" ? h.treAborted : 0;
      if (tre > 0 && h.treAbortedBoQua > 0) h.treAbortedBoQua--;
      else if (tre > 0) {
        h.treAborted = 0;
        h.treAbortedLan++;
        const dat = new Promise<Row[]>((ok) =>
          setTimeout(() => {
            h.khiTreAborted?.();
            ok(Promise.resolve(where(c).returning()));
          }, tre),
        );
        return { returning: () => dat, then: (a: (v: Row[]) => unknown, e?: (x: unknown) => unknown) => dat.then(a, e) };
      }
      if (typeof status === "string") {
        for (const r of rows("orchestration_runs").filter((x) => (typeof c === "function" ? c(x) : true))) statusWrites.set(r.id, [...(statusWrites.get(r.id) ?? []), status as string]);
      }
      return where(c);
    };
    return b;
  };
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
  delete process.env.AVI_PROCESS_ROLE;
});

// ── definitions ─────────────────────────────────────────────────────────────────────────────────────────────────────
const gate = (id = "g1"): WorkflowStep => ({ id, type: "hitl_gate", prompt: `approve ${id}` }) as never;
const ot = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "start", args: { tagKey: "run", value: 1 }, ...extra }) as never;
const move = (id: string, extra: Record<string, unknown> = {}): WorkflowStep =>
  ({ id, type: "command", machineId: 2, command: "run_job", args: { robotId: 2, jobType: "move", params: { x: 1 } }, ...extra }) as never;
const robotStop = (id: string): WorkflowStep => ({ id, type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }) as never;
/** A2(n) T0 — an OT STOP on the pinned tag of seedHalt(): verified, a stop for the dispatcher */
const otStop = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true }, ...extra }) as never;
const seedHalt = () => fake.seed(deviceTags, [...rows("device_tags"), { id: 75, adapterId: 501, tagKey: "halt", address: "00001", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true }]);
/** A2(n) T0 — answers of h.ghim: a STOP on a readable pin; the pins not readable */
const PIN_OK = async (_d: unknown, i: { commandType: string }) => ({ pinnedStop: i.commandType === "stop", loiDocGhim: null });
const PIN_BAD = async () => ({ pinnedStop: false, loiDocGhim: "pin read timed out (test)" });
const def = (ref: string, steps: WorkflowStep[]): WorkflowDefinition => ({ ref, name: ref, steps }) as never;

// ── the central walk ────────────────────────────────────────────────────────────────────────────────────────────────
async function centralRun(d: WorkflowDefinition, approveGates: number): Promise<number> {
  expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
  const s = await startRun(d.ref, {}, OWNER);
  const runId = s.runId!;
  for (let i = 0; i < approveGates && runRow(runId).status === "awaiting_confirm"; i++) {
    const view = (await getRun(runId, { bindingDigest: true }))!;
    await resumeRun(runId, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  }
  return runId;
}

// ── the edge walk ───────────────────────────────────────────────────────────────────────────────────────────────────
interface EdgeHarness {
  runId: number;
  /** fix review 2 — the complete request lost its outcome-unknown list / prefix (E did not forward it) */
  stripEndUnknown?: boolean;
  /** fix review 1 — the journal refuses the record matching this (once refused, every later non-STOP record too) */
  refuse?: (rec: EdgeRunRecordIn) => boolean;
  /** the walker's run-status calls on the edge stores of every segment (central only applies the segment END) */
  statuses: string[];
  records: EdgeRunRecordIn[];
  authorizeCalls: EdgeStepAuthorizeRequest[];
  /** unavailable from this authorize call on (D5) */
  offline: boolean;
  /** fix review 1 — central unreachable for these steps' authorisations only */
  offlineSteps?: Set<string>;
  /** "stopped" answered by central from now on */
  stopped: boolean;
  /** R1b-2b-2a A2(o) AMENDMENT 2 — the edge config source's staleness (absent ⇒ never stale) */
  staleness?: () => { centralVersion: number; localVersion: number; sinceMs: number; configIssuedAt: number | null } | null;
  /** events-stream records of every segment (anomalies) */
  events?: Array<Record<string, any>>;
  /** A2(o) AMENDMENT 2 — authorisations the edge reported NEVER used (central supersedes them, as edgeReportsCentral.applyAuthUnused) */
  unused?: Array<Record<string, any>>;
  /** R1b-2b-2a A2(n) N8 — the auth_unused journal / report FAILS (reportUnused answers false): the authorisation stays issued on central */
  unusedFails?: boolean;
  /** A2(n) F10 — the report never answers (a stalled journal) */
  unusedHangs?: boolean;
  /** A2(n) (I-5) — the events journal refuses (a full journal): the anomaly never leaves the edge */
  eventsRefused?: boolean;
  /** A2(n) extension — /authorize answers these steps this many ms later */
  authorizeDelay?: Map<string, number>;
  /** A2(n) T3+T4 — the journal takes this long over a step's records: a walker stands before its sink, a verified STOP included (it never asks /authorize) */
  journalDelay?: Map<string, number>;
  /** A2(n) T5 — changes the package this segment claims */
  suaGoi?: (p: EdgeRunPackage) => EdgeRunPackage;
  /** A2(n) T5 — the store's authorizeCommand throws for these steps */
  authNem?: Set<string>;
  /** A2(n) T5 — the store's own STOP check of a compensation throws */
  laStopNem?: boolean;
  /** A2(n) T6a — the store's sweepSource throws (the evidence of the walk's end cannot be read); sweepLan counts the calls that reached it */
  sweepNem?: boolean;
  sweepLan?: number;
  /** A2(n) T5 fix 1 — nothing is applied by the harness: only the report path writes */
  quaBaoCao?: boolean;
}

/** central's edge assignment (startRun with edgeNodeId) — created 'queued' + its assignment row */
async function edgeAssignedRun(d: WorkflowDefinition): Promise<EdgeHarness> {
  expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
  const s = await startRun(d.ref, {}, OWNER, { edgeNodeId: NODE });
  expect(s.ok).toBe(true);
  return { runId: s.runId!, statuses: [], records: [], authorizeCalls: [], offline: false, stopped: false };
}

/** B's claim: 'queued' → 'running' + the signed package (built here from the same rows — no signature in a unit test) */
async function claimPackage(x: EdgeHarness, claimSeq: number): Promise<EdgeRunPackage> {
  const run = runRow(x.runId);
  run.status = "running";
  const [a] = rows("orchestration_run_edge_assignments").filter((r) => r.runId === x.runId);
  a.claimSeq = claimSeq;
  const wf = rows("orchestration_workflows").find((w) => w.id === run.workflowId)!;
  const d = wf.definitionJson as WorkflowDefinition;
  const mrows = rows("machines");
  const machineMap = new Map<number, MachineForValidation>(mrows.map((m) => [m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities }] as const));
  const all = (steps: WorkflowStep[] | undefined): WorkflowStep[] => (steps ?? []).flatMap((s) => [s, ...all((s as any).steps), ...all((s as any).then), ...all((s as any).else), ...(s.compensation ? all([s.compensation]) : [])]);
  const v = await verifiedStopStepIds(d, machineMap, fake as never); // central's classifier (B: edgeRunAnalysis) — pins from the rows
  const resolved: Array<{ stepId: string; adapterId: number }> = [];
  for (const s of all(d.steps)) {
    if (s.type !== "command" || s.machineId !== 1) continue;
    const args = await withResolvedAdapter("ot-opcua", 1, (s.args ?? {}) as Record<string, unknown>);
    if (typeof args.adapterId === "number") resolved.push({ stepId: s.id, adapterId: args.adapterId });
  }
  return {
    kind: "run_package",
    runId: x.runId,
    nodeId: NODE,
    credentialId: 1,
    defHash: hashWorkflowDefinition(d),
    definition: d as never,
    machines: mrows.map((m) => ({ id: m.id, machineType: m.machineType, capabilities: m.capabilities })),
    verifiedStops: [...v.ids].map((stepId) => {
      const st = all(d.steps).find((x) => x.id === stepId) as { machineId: number; args?: Record<string, unknown> };
      if (st.machineId === 2) return { kind: "robot" as const, stepId, robotId: 2 };
      const pins = rows("device_tags").filter((t) => t.adapterId === 501 && t.stopValue != null).map((t) => ({ tagKey: t.tagKey, value: t.stopValue }));
      return { kind: "ot" as const, stepId, adapterId: 501, pins };
    }),
    stopsUnsure: [...v.unsure],
    prior: edgePriorPictureOf(stepRows(x.runId) as unknown as Parameters<typeof edgePriorPictureOf>[0]), // hàng FakeDb = Record<string, any> (không khai stepId/status) — cùng mảng, chỉ đổi kiểu
    issuedAt: Date.now(),
    claimSeq,
    workflowId: run.workflowId,
    workflowVersion: wf.version ?? 1,
    params: (run.paramsJson as Record<string, unknown>) ?? {},
    context: (run.contextJson as Record<string, unknown>) ?? {},
    owner: { id: OWNER.id, role: OWNER.role },
    startedViaApi: false,
    resolvedAdapters: resolved,
    approvals: [],
    bindingDigest: null,
  } as unknown as EdgeRunPackage;
}

/** the fake /authorize: central's own gate rule over the same rows (B's edgeAuthorizeCentral decides with it too) */
function fakeAuthorize(x: EdgeHarness, d: WorkflowDefinition, primed?: Awaited<ReturnType<typeof findSeparateGateApproval>>) {
  return {
    async authorize(input: EdgeStepAuthorizeRequest): Promise<EdgeStepAuthorizeOutcome> {
      x.authorizeCalls.push(input);
      const tre = x.authorizeDelay?.get(input.stepId);
      if (tre) await new Promise((r) => setTimeout(r, tre));
      if (x.offline || x.offlineSteps?.has(input.stepId)) return { ok: false, verdict: "unavailable", code: "network" };
      if (x.stopped) return { ok: false, verdict: "stopped", code: "stopped" };
      // the real /authorize: one authorisation per (run, claim, step, attempt) — a second ask answers 409 already_authorized (edgeAuthorizeCentral)
      if ((fake.store.get("edge_step_authorizations") ?? []).some((a) => a.runId === x.runId && a.claimSeq === input.claimSeq && a.stepId === input.stepId && a.attempt === input.attempt)) return { ok: false, verdict: "refused", code: "already_authorized" };
      // the real /authorize step 5b (A2(n) (b)): the same pure check, on central's context and rows (edgeAuthorizeCentral)
      const chu = chuBuTruTrongDinhNghia(d.steps, input.stepId);
      if (chu && buTruBiChanKhongRo(runRow(x.runId).contextJson, stepRows(x.runId) as never, chu.step.id, chu.comp.id)) return { ok: false, verdict: "refused", code: "outcome_unknown_held" };
      const found = primed ?? (await findSeparateGateApproval({ runId: x.runId, def: d, startedViaApi: false }));
      if ("reason" in found) return { ok: false, verdict: "refused", code: "gate_required", reason: found.reason };
      // central's authorisation ledger (0372) — B's /authorize writes it; resultReportedAt stays null until a result is applied
      const jti = randomUUID();
      fake.store.set("edge_step_authorizations", [...(fake.store.get("edge_step_authorizations") ?? []), { jti, runId: x.runId, claimSeq: input.claimSeq, stepId: input.stepId, attempt: input.attempt, resultReportedAt: null, supersededAt: null }]);
      return {
        ok: true,
        authorization: { typ: "avi-edge-auth+v1", alg: "EdDSA", kid: "edk_test", payload: "{}", sig: "x" } as never,
        claims: { jti, approval: { approvedBy: found.approval.approvedBy, gateStepId: found.approval.gateStepId } },
        ttlMs: 10_000,
        reqNonce: randomUUID().replace(/-/g, ""),
        requestSentMonoMs: performance.now(),
      };
    },
  };
}

/** one segment on the edge, then central applies its records + its end (group B's endpoints call exactly these) */
async function edgeSegment(x: EdgeHarness, claimSeq: number, opts: { beforeEnd?: (drive: Promise<unknown>) => Promise<void> } = {}) {
  const goiGoc = await claimPackage(x, claimSeq);
  const pkg = x.suaGoi ? x.suaGoi(goiGoc) : goiGoc;
  const d = pkg.definition as unknown as WorkflowDefinition;
  const from = x.records.length;
  // central's gate decision for this segment (B's /authorize decides it on central — the edge never reads it)
  const primed = await findSeparateGateApproval({ runId: x.runId, def: d, startedViaApi: false });
  let refusing = false;
  const store = createEdgeRunStore(pkg, {
    runId: x.runId,
    claimSeq,
    claimToken: "ect_" + "a".repeat(43),
    sink: {
      async run(_runId, _claim, rec, o) {
        const tre = rec.kind === "step" ? x.journalDelay?.get(rec.stepId) : undefined;
        if (tre) await new Promise((r) => setTimeout(r, tre));
        if (x.refuse && (refusing || x.refuse(rec)) && !o?.stop) {
          refusing = true;
          return { seq: null, dropped: true, reason: "journal_full" };
        }
        x.records.push(rec);
        return { seq: x.records.length, durable: true };
      },
      async event(rec) {
        if (x.eventsRefused) return { seq: null, dropped: true, reason: "journal_full" };
        x.events?.push(rec as Record<string, any>);
        return { seq: 1, durable: true };
      },
    },
    consume: { admitNonStop: () => true, consumeOverran: () => h.consumeQuaHan.size > 0 },
    authorize: fakeAuthorize(x, d, primed),
    ...(x.staleness ? { config: { staleness: x.staleness } } : {}),
    async reportUnused(u) {
      if (x.unusedHangs) await new Promise<void>(() => undefined);
      if (x.unusedFails) return false;
      x.unused?.push({ ...u });
      for (const r of fake.store.get("edge_step_authorizations") ?? []) if (r.jti === u.jti && r.resultReportedAt == null) r.supersededAt = new Date();
      return true;
    },
  });
  if (x.authNem) {
    const goc = store.authorizeCommand.bind(store);
    store.authorizeCommand = async (rc, s, a, i) => {
      if (x.authNem?.has(s.id)) throw new Error("authorize threw (test)");
      return goc(rc, s, a, i);
    };
  }
  if (x.laStopNem) {
    store.buTruLaStopGhim = async () => {
      throw new Error("the STOP check threw (test)");
    };
  }
  if (x.sweepNem) {
    store.sweepSource = async () => {
      x.sweepLan = (x.sweepLan ?? 0) + 1;
      throw new Error("the evidence read threw (test)");
    };
  }
  // ★ the edge walk (and a local abort sweep) run against a database that THROWS — and is never even asked
  h.dbThrows = true;
  h.dbCalls = 0;
  let out: Record<string, any>;
  try {
    const drive = driveEdgeRunFromPackage(pkg, { runId: x.runId, claimSeq, claimToken: "ect_" + "a".repeat(43) }, store);
    if (opts.beforeEnd) await opts.beforeEnd(drive);
    out = (await drive) as Record<string, any>;
  } finally {
    h.dbThrows = false;
  }
  expect(h.dbCalls, "the edge walk asked for a database").toBe(0);
  x.statuses.push(...store.statusLog());
  // central applies the reported rows (step / abort_stop / context) — as edgeReportsCentral does — and the segment end
  const seg = x.records.slice(from);
  const write = seg.filter((r) => r.kind === "step" || r.kind === "abort_stop").map((r: any) =>
    r.kind === "step"
      ? { stepId: r.stepId, stepType: r.stepType, status: r.status, attempt: r.attempt, startedAt: r.startedAt == null ? null : new Date(r.startedAt), finishedAt: r.finishedAt == null ? null : new Date(r.finishedAt), error: r.error, result: r.result ?? undefined }
      : { stepId: `abort:${r.stepId}`, stepType: "command", status: r.status, attempt: 0, startedAt: new Date(r.at), finishedAt: new Date(r.at), error: null, result: { ...(r.result ?? {}), stepId: r.stepId } },
  );
  if (!x.quaBaoCao) await recordEdgeStepRows(fake as never, x.runId, write);
  // fix review 2 — through THE context filter (edgeContextPolicy — the one B's report endpoint uses), and only while the run is
  // live (as edgeReportsCentral: a context record of a stopped / ended run is evidence only)
  for (const r of x.quaBaoCao ? [] : seg) {
    if (r.kind !== "context") continue;
    const row = runRow(x.runId);
    if (row.status !== "running" && row.status !== "compensating") continue;
    row.contextJson = { ...(row.contextJson ?? {}), ...edgeContextPatchOf(r.patch, row.contextJson).patch };
  }
  const end = x.stripEndUnknown && out.outcome ? { ...out, outcomeUnknown: undefined, error: undefined } : out;
  if (end.outcome && !x.quaBaoCao) await applyEdgeSegmentEnd(fake as never, x.runId, { ...(end as any), nodeCode: "EDGE-A", claimSeq, def: d });
  return { out, segment: seg };
}

/**
 * R1b-2b-2a A2(n) (n3) — the Continue of a run HELD for an unknown outcome: a person with machine-control rights (OTHER is a supervisor ⇒ an
 * explicit machine_control/canCreate row) and a REQUIRED reason; without the reason it is refused before anything changes.
 */
function grantMachineControl() {
  if (!rows("permissions").some((p) => p.userId === OTHER.id && p.moduleName === "machine_control")) {
    fake.seed(permissions, [{ id: 9001, userId: OTHER.id, category: "machine", moduleName: "machine_control", canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false, expiresAt: null }]);
  }
}
async function continueOutcomeUnknown(x: EdgeHarness, note: string) {
  grantMachineControl();
  const view = (await getRun(x.runId, { bindingDigest: true }))!;
  return resumeRun(x.runId, { approved: true, note, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
}

async function approveEdgeGate(x: EdgeHarness) {
  const view = (await getRun(x.runId, { bindingDigest: true }))!;
  const r = await resumeRun(x.runId, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  expect(r.status).toBe("queued"); // the edge branch hands the run back to its node
}

// ── comparison helpers ──────────────────────────────────────────────────────────────────────────────────────────────
/** the walker's own step-row writes, comparable: (stepId, status, attempt, result kind); gate rows are central's on both sides */
const walkerWritesCentral = (runId: number) => (centralWrites.get(runId) ?? []).filter((w) => !rows("orchestration_run_steps").some((s) => s.runId === runId && s.stepId === w.stepId && s.stepType === "hitl_gate"));
const walkerWritesEdge = (x: EdgeHarness) =>
  x.records
    .filter((r) => r.kind === "step" || r.kind === "abort_stop")
    .map((r: any) => (r.kind === "step" ? { stepId: r.stepId, status: r.status, attempt: r.attempt, result: resultKind(r.result) } : { stepId: `abort:${r.stepId}`, status: r.status, attempt: 0, result: resultKind(r.result) }));
const finalRows = (runId: number) =>
  Object.fromEntries(
    stepRows(runId)
      .map((s) => [s.stepId, { status: s.status, attempt: s.attempt, type: s.stepType, result: resultKind(s.resultJson), error: s.error ? String(s.error).replace(/run\d+/g, "run#") : null }] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
/**
 * The commands that reached the equipment. The HITL provenance of a command WITH an approval (requestedBy = the run owner,
 * confirmedBy = the gate approver) is compared; a STOP has none: its provenance is the walker's principal — on central the
 * user who resumed the run (the approver), on the edge the run's owner (as in Đợt 9 S3) — informational only (a STOP is never
 * verified against it), so it is left out (recorded in group-C-report.md).
 */
const sentCommands = (from = 0, to?: number) =>
  h.sent.slice(from, to).map((c) => {
    const stop = c.name === "abort" || c.name === "e_stop" || c.name === "stop";
    return { kind: c.kind, stepId: c.stepId, name: c.name, adapterId: c.adapterId, robotId: c.robotId, writes: c.writes, job: c.job, ...(stop ? {} : { confirmedBy: (c.hitl as any)?.confirmedBy, requestedBy: (c.hitl as any)?.requestedBy }) };
  });
const outcomeTransitions = (list: string[]) => list.filter((s) => s !== "running" && s !== "queued");
const perStep = (ws: Array<{ stepId: string }>) => {
  const m = new Map<string, unknown[]>();
  for (const w of ws) m.set(w.stepId, [...(m.get(w.stepId) ?? []), w]);
  return Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
};

async function waitFor(fn: () => boolean, label: string, ms = 5_000) {
  const until = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > until) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("doc 81 Đợt 10 C — one walker, two stores: central and edge produce the same rows and outcomes", () => {
  it("★ gate pause → approval → motion (OT + robot) → completed: identical walker writes, outcomes, commands and final rows", async () => {
    const d = (ref: string) => def(ref, [gate(), ot("m1"), move("r1"), robotStop("s1")]);
    const c = await centralRun(d("gp-c"), 1);
    const cSent = sentCommands();
    const n0 = h.sent.length;

    const e = await edgeAssignedRun(d("gp-e"));
    const s1 = await edgeSegment(e, 1);
    expect(s1.out).toMatchObject({ outcome: "paused", gateStepId: "g1" });
    expect(runRow(e.runId).status).toBe("awaiting_confirm");
    expect(runRow(e.runId).currentStepId).toBe("g1");
    // the gate row central writes for a paused edge segment is the walker's own gate row
    expect(stepRows(e.runId).find((s) => s.stepId === "g1")).toMatchObject({ status: "awaiting_confirm", resultJson: { prompt: "approve g1", approverRoles: null } });
    await approveEdgeGate(e);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ ok: true, outcome: "completed", status: "completed" });

    expect(runRow(c).status).toBe("completed");
    expect(runRow(e.runId).status).toBe("completed");
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(cSent);
    expect(outcomeTransitions(statusWrites.get(e.runId) ?? [])).toEqual(outcomeTransitions(statusWrites.get(c) ?? []));
    expect(outcomeTransitions(e.statuses)).toEqual(outcomeTransitions(statusWrites.get(c) ?? []));
    // ★ L-7 — the STOP (s1) never asked central; m1 / r1 asked once each, with the payload hash of the exact command
    expect(e.authorizeCalls.map((a) => a.stepId)).toEqual(["m1", "r1"]);
    // the edge commands carry their signed authorisation (D verifies it); the STOP carries none
    const edgeSent = h.sent.slice(n0);
    expect((edgeSent.find((s) => s.stepId === "m1")!.edge as any).authorization.stepId).toBe("m1");
    expect((edgeSent.find((s) => s.stepId === "s1")!.edge as any).authorization).toBeNull();
    // every non-STOP result row quotes the jti it ran under; the STOP's quotes none
    const resultRow = (id: string) => e.records.filter((r: any) => r.kind === "step" && r.stepId === id && r.status === "completed")[0] as any;
    expect(resultRow("m1").jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(resultRow("s1").jti).toBeNull();
  });

  it("★ a non-STOP step with no counting gate: the SAME FOE_GATE_REQUIRED(noGate) refusal on both stores, nothing sent", async () => {
    const d = (ref: string) => def(ref, [ot("m1")]);
    const c = await centralRun(d("ng-c"), 0);
    const e = await edgeAssignedRun(d("ng-e"));
    const s1 = await edgeSegment(e, 1);
    expect(s1.out).toMatchObject({ outcome: "failed" });
    expect(String(runRow(c).error)).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}\\(noGate\\)`));
    expect(stepRows(e.runId).find((s) => s.stepId === "m1")!.error).toBe(stepRows(c).find((s) => s.stepId === "m1")!.error);
    expect(h.sent).toEqual([]);
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
  });

  it("★ branch: the condition read the same way, the same path taken, the decision recorded on both", async () => {
    const br = (ref: string) =>
      def(ref, [gate(), { id: "b1", type: "branch", condition: { source: "telemetry", machineId: 1, key: "temp", op: "gt", value: 50 }, then: [ot("t1")], else: [move("e1")] } as never]);
    const c = await centralRun(br("br-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(br("br-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2);
    expect(stepRows(c).find((s) => s.stepId === "b1")!.resultJson).toEqual({ branch: "then" });
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(runRow(e.runId).contextJson["branch:b1"]).toBe("then");
  });

  it("★ parallel: per-step write sequences, final rows and the command set are identical", async () => {
    const par = (ref: string) => def(ref, [gate(), { id: "p1", type: "parallel", steps: [ot("m1"), move("r1"), ot("m2", { args: { tagKey: "speed", value: 5 } })] } as never]);
    const c = await centralRun(par("par-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(par("par-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2);
    expect(perStep(walkerWritesEdge(e))).toEqual(perStep(walkerWritesCentral(c)));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    const sortSent = (l: ReturnType<typeof sentCommands>) => [...l].sort((a, b) => ((a.stepId as string) < (b.stepId as string) ? -1 : 1));
    expect(sortSent(sentCommands(n0))).toEqual(sortSent(sentCommands(0, n0)));
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ retry: a refused first attempt is retried — attempt 2 authorised separately on the edge, rows identical", async () => {
    const rt = (ref: string) => def(ref, [gate(), ot("m1", { maxAttempts: 2 })]);
    h.failPlan.set("m1", 1);
    const c = await centralRun(rt("rt-c"), 1);
    const n0 = h.sent.length;
    h.failPlan.set("m1", 1);
    const e = await edgeAssignedRun(rt("rt-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2);
    expect(stepRows(c).find((s) => s.stepId === "m1")).toMatchObject({ status: "completed", attempt: 2 });
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(e.authorizeCalls.map((a) => `${a.stepId}#${a.attempt}`)).toEqual(["m1#1", "m1#2"]);
    expect(new Set(e.authorizeCalls.map((a) => a.idempotencyKey)).size).toBe(2);
  });

  it("★ compensation: the failing step's compensation runs (compensating → failed) — rows, outcomes and commands identical", async () => {
    const cp = (ref: string) => def(ref, [gate(), move("r1", { compensation: ot("c1", { args: { tagKey: "speed", value: 0 } }) })]);
    h.failPlan.set("r1", Infinity);
    const c = await centralRun(cp("cp-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(cp("cp-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "failed" });
    expect(runRow(c).status).toBe("failed");
    expect(runRow(e.runId).status).toBe("failed");
    expect(stepRows(c).find((s) => s.stepId === "c1")!.status).toBe("compensated");
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(outcomeTransitions(statusWrites.get(c) ?? [])).toEqual(["awaiting_confirm", "compensating", "failed"]);
    // the walker's run-status sequence is the same on the edge (central sees the END of the segment: failed)
    expect(outcomeTransitions(e.statuses)).toEqual(["awaiting_confirm", "compensating", "failed"]);
  });

  it("★ abort sweep: aborted mid-delay ⇒ the next motion is never sent, the remaining STOP is sent once — same rows on both", async () => {
    const ab = (ref: string) => def(ref, [gate(), move("r1"), { id: "d1", type: "delay", ms: 60_000 } as never, move("r2"), robotStop("s1")]);
    // central: the walk resumes in the background, is aborted while it sleeps in d1
    const cRef = "ab-c";
    expect((await deployWorkflow(ab(cRef), OWNER)).ok).toBe(true);
    const c = (await startRun(cRef, {}, OWNER)).runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const resuming = resumeRun(c, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => stepRows(c).some((s) => s.stepId === "d1" && s.status === "running"), "central d1 running");
    const ar = await abortRun(c, OWNER, "parity");
    await resuming;
    expect(ar.abortStops).toMatchObject({ sent: ["s1"], failed: [], unverified: [], notNeeded: [] });
    const n0 = h.sent.length;

    // edge: the same walk, stopped by central while it sleeps in d1 (the agent's abortLive ⇒ stopLiveRunForCentralAbort)
    const e = await edgeAssignedRun(ab("ab-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2, {
      beforeEnd: async () => {
        await waitFor(() => e.records.some((r: any) => r.kind === "step" && r.stepId === "d1" && r.status === "running"), "edge d1 running");
        runRow(e.runId).status = "aborted"; // central's abort (its own sweep cannot reach the edge's devices)
        const live = await stopLiveRunForCentralAbort(e.runId, { id: 0, role: "system", name: "edge: central abort" });
        expect(live.live).toBe(true);
        expect(live.abortStops).toMatchObject({ sent: ["s1"], failed: [], unverified: [], notNeeded: [] });
      },
    });
    expect(h.sent.filter((s) => s.stepId === "r2")).toEqual([]); // never sent, on either side
    expect(sentCommands(n0).map((s) => s.stepId)).toEqual(sentCommands(0, n0).map((s) => s.stepId));
    expect(sentCommands(n0).map((s) => s.stepId)).toEqual(["r1", "s1"]);
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    // fix review 1 — the abort sweep's write sequence is the walk's too (per step: the sweep row is written concurrently)
    expect(perStep(walkerWritesEdge(e))).toEqual(perStep(walkerWritesCentral(c)));
    expect(stepRows(e.runId).find((s) => s.stepId === "abort:s1")).toMatchObject({ status: "completed" });
    expect(runRow(e.runId).status).toBe("aborted");
  });
});

describe("doc 81 Đợt 10 C — the edge store's own verdicts (no central counterpart)", () => {
  it("★ D5: central unreachable at a non-STOP step ⇒ HELD (nothing sent, no compensation); a STOP before it still goes out", async () => {
    const hd = (ref: string) => def(ref, [gate(), robotStop("s0"), move("r1", { compensation: ot("c1") })]);
    const e = await edgeAssignedRun(hd("hd-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.offline = true;
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "centralUnreachable" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["s0"]); // the STOP never asked; r1 / c1 never sent
    expect(stepRows(e.runId).find((s) => s.stepId === "r1")).toMatchObject({ status: "held" });
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r1")!.error)).toMatch(/^EDGE_HELD\(centralUnreachable\)/);
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toBeUndefined();
    expect(runRow(e.runId).status).toBe("held");
  });

  it("★ central says 'stopped' at authorize ⇒ the walker aborts locally (no non-STOP sent) and sweeps its STOPs", async () => {
    const st = (ref: string) => def(ref, [gate(), move("r1"), move("r2"), robotStop("s1")]);
    const e = await edgeAssignedRun(st("st-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const n0 = h.sent.length;
    // r1 goes; central stops the run before r2's authorisation
    const pkg2 = await claimPackage(e, 2);
    const central = fakeAuthorize(e, pkg2.definition as never);
    let calls = 0;
    const store = createEdgeRunStore(pkg2, {
      runId: e.runId,
      claimSeq: 2,
      claimToken: "ect_" + "a".repeat(43),
      sink: { run: async (_r, _c, rec) => (e.records.push(rec), { seq: e.records.length }) },
      authorize: { authorize: async (i) => (++calls === 2 ? { ok: false as const, verdict: "stopped" as const, code: "stopped" } : central.authorize(i)) },
    });
    const s2 = (await driveEdgeRunFromPackage(pkg2, { runId: e.runId, claimSeq: 2 }, store)) as Record<string, any>;
    await waitFor(() => h.sent.slice(n0).some((s) => s.stepId === "s1"), "sweep sent s1");
    expect(s2).toMatchObject({ outcome: "aborted" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r1", "s1"]);
  });

  /** a Continue of a HELD edge run (resumeRun ⇒ queued for its node again) */
  async function continueHeld(x: EdgeHarness) {
    const view = (await getRun(x.runId, { bindingDigest: true }))!;
    const r = await resumeRun(x.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(r).toMatchObject({ ok: true, status: "queued" });
  }
  const STALE = () => ({ centralVersion: 4, localVersion: 3, sinceMs: Date.now() - 3_000, configIssuedAt: Date.now() - 95_000 });

  it("★ A2(o) AMENDMENT 2: the config changes MID-RUN (stale before r2's authorisation) ⇒ r2 HELD (configStale: nothing asked, nothing sent, 0 compensations, anomaly with the config's age); after the refresh + Continue r2 runs EXACTLY ONCE under a NEW authorisation", async () => {
    const e = await edgeAssignedRun(def("a2o-mid", [gate(), move("r1", { compensation: ot("c1") }), move("r2", { maxAttempts: 2, compensation: ot("c2") }), robotStop("s9")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    let stale = false;
    e.staleness = () => (stale ? STALE() : null);
    const ledger = h.onLedger;
    h.onLedger = (cmd, ok) => {
      ledger?.(cmd, ok);
      if (String(cmd.idempotencyKey).includes("-r1-")) stale = true; // central announces a new config right after r1
    };
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r1"]); // r2 / s9 / any compensation never reached the equipment
    expect(e.authorizeCalls.filter((a) => a.claimSeq === 2).map((a) => a.stepId)).toEqual(["r1"]); // r2 never asked under the old config
    const r2 = stepRows(e.runId).find((s) => s.stepId === "r2")!;
    expect(r2).toMatchObject({ status: "held" });
    expect(String(r2.error)).toMatch(/^EDGE_HELD\(configStale\)/);
    expect(String(r2.error)).toMatch(/issued [0-9]+ s ago/);
    expect(e.events).toMatchObject([{ kind: "anomaly", code: "EDGE_CONFIG_STALE", runId: e.runId }]);
    expect(e.events[0].detail).toMatch(/central announced config v4 [0-9]+ s ago; this edge still holds v3 \(issued 9[0-9] s ago\)/);
    expect(runRow(e.runId).status).toBe("held");
    // the refresh never arrives ⇒ a Continue holds it AGAIN (indefinitely: never a failure, never compensated)
    await continueHeld(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(e.events.map((x) => x.code)).toEqual(["EDGE_CONFIG_STALE", "EDGE_CONFIG_STALE"]);
    // the refresh arrives ⇒ Continue ⇒ r2 re-authorised under the new claim and sent once; the run completes
    stale = false;
    h.onLedger = ledger;
    await continueHeld(e);
    const s4 = await edgeSegment(e, 4);
    expect(s4.out).toMatchObject({ outcome: "completed" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r1", "r2", "s9"]); // r2 EXACTLY once, r1 not again
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => a.claimSeq)).toEqual([4]);
    expect(h.sent.some((s) => s.stepId === "c1" || s.stepId === "c2")).toBe(false); // 0 compensations
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toBeUndefined();
    expect(stepRows(e.runId).find((s) => s.stepId === "c2")).toBeUndefined();
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ A2(o) AMENDMENT 2: the config goes stale AFTER r2's authorisation (the edge dispatch gate answers CONFIG_STALE) ⇒ HELD, not failed: no retry, no compensation; Continue ⇒ re-authorised under the new claim (never the old authorisation) and sent once", async () => {
    const e = await edgeAssignedRun(def("a2o-disp", [gate(), move("r2", { maxAttempts: 3, compensation: ot("c2") })]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    e.unused = [];
    h.staleDispatch.add("r2");
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2"]); // ONE dispatch attempt (the gate refused it: nothing reached a device) — no retry
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => [a.claimSeq, a.attempt])).toEqual([[2, 1]]);
    const r2 = stepRows(e.runId).find((s) => s.stepId === "r2")!;
    expect(r2).toMatchObject({ status: "held" });
    expect(String(r2.error)).toMatch(/^EDGE_HELD\(configStale\).*issued 95 s ago/);
    expect(e.events.map((x) => x.code)).toEqual(["EDGE_CONFIG_STALE"]);
    // the refused authorisation is journaled + reported NEVER used (central supersedes it): it can never be reused
    expect(e.unused).toMatchObject([{ runId: e.runId, claimSeq: 2, stepId: "r2", attempt: 1, reason: "config_stale" }]);
    expect(String(r2.error)).toContain("reported unused");
    expect(h.sent.some((s) => s.stepId === "c2")).toBe(false);
    expect(runRow(e.runId).status).toBe("held");
    await continueHeld(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out, JSON.stringify({ out: s3.out, rows: stepRows(e.runId) })).toMatchObject({ outcome: "completed" });
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => a.claimSeq)).toEqual([2, 3]); // a NEW authorisation under the new claim
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2", "r2"]); // refused once (nothing out), then sent once
    expect(h.sent.some((s) => s.stepId === "c2")).toBe(false);
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ A2(n) N8 (n4): the A2(o) auth_unused report FAILS ⇒ held (configStale, nothing sent); Continue ⇒ central counts the step as possibly sent (EDGE_OUTCOME_UNKNOWN) ⇒ its NON-STOP compensation is HELD for a person — 0 sent (before A2(n): an automatic 'undo' of a command that never left)", async () => {
    const e = await edgeAssignedRun(def("a2n-n8", [gate(), move("r2", { maxAttempts: 3, compensation: ot("c2") })]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    e.unusedFails = true;
    h.staleDispatch.add("r2");
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r2")!.error)).toContain("could NOT be reported unused");
    await continueHeld(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r2: { state: "outcomeUnknown" } }); // the issued authorisation counts as sent
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2"]); // the refused dispatch only: r2 never again, ★ c2 NEVER sent
    expect(stepRows(e.runId).find((s) => s.stepId === "c2")).toMatchObject({ status: "held" });
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r2")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toMatchObject({ stepId: "r2", compId: "c2" });
    expect(e.events.filter((x) => x.code === "FOE_OUTCOME_UNKNOWN_COMPENSATION")).toHaveLength(1);
  });

  it("★ A2(o) r3 F4: a safety-PLC config MISSING at the edge dispatch (SAFETY_CONFIG_MISSING, before the consume: nothing sent) ⇒ HELD like a stale config: no retry, no compensation, the authorisation reported unused; after the refresh + Continue ⇒ re-authorised and sent exactly once", async () => {
    const e = await edgeAssignedRun(def("a2o-miss", [gate(), move("r2", { maxAttempts: 3, compensation: ot("c2") })]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    e.unused = [];
    h.missingDispatch.add("r2");
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2"]); // ONE dispatch attempt, refused by the gate: no retry (maxAttempts 3)
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => [a.claimSeq, a.attempt])).toEqual([[2, 1]]);
    const r2 = stepRows(e.runId).find((s) => s.stepId === "r2")!;
    expect(r2).toMatchObject({ status: "held" });
    expect(String(r2.error)).toMatch(/^EDGE_HELD\(configStale\).*signed safety-PLC config\(s\) #7 absent/);
    expect(String(r2.error)).toContain("reported unused");
    // r4 (review m-1): the hold adds NO EDGE_CONFIG_STALE — the dispatch gate's EDGE_SAFETY_CONFIG_MISSING (journaled by the gate,
    // mocked out here) is the one anomaly for it; the stale-config hold above still writes its EDGE_CONFIG_STALE
    expect(e.events.map((x) => x.code)).toEqual([]);
    expect(e.unused).toMatchObject([{ runId: e.runId, claimSeq: 2, stepId: "r2", attempt: 1, reason: "config_stale" }]);
    expect(h.sent.some((s) => s.stepId === "c2")).toBe(false);
    expect(runRow(e.runId).status).toBe("held");
    // the edge's refresh brings the PLC config ⇒ Continue ⇒ a NEW authorisation, sent once, completed; 0 compensations
    await continueHeld(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out, JSON.stringify({ out: s3.out, rows: stepRows(e.runId) })).toMatchObject({ outcome: "completed" });
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => a.claimSeq)).toEqual([2, 3]);
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2", "r2"]); // refused once (nothing out), then sent once
    expect(h.sent.some((s) => s.stepId === "c2")).toBe(false);
    expect(stepRows(e.runId).find((s) => s.stepId === "c2")).toBeUndefined();
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ A2(o) AMENDMENT 2: a STOP never waits for the config — with the config stale the robot abort before the held step still goes out (L-7)", async () => {
    const e = await edgeAssignedRun(def("a2o-stop", [gate(), robotStop("s1"), move("r1")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.staleness = STALE;
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["s1"]);
  });

  it("★ the walker refuses a package that is not the assigned snapshot / not this claim (nothing walked)", async () => {
    const e = await edgeAssignedRun(def("rf-e", [gate(), ot("m1")]));
    const pkg = await claimPackage(e, 1);
    const store = createEdgeRunStore(pkg, { runId: e.runId, claimSeq: 1, claimToken: "ect_" + "a".repeat(43), sink: { run: async () => ({ seq: 1 }) }, authorize: fakeAuthorize(e, pkg.definition as never) });
    expect(((await driveEdgeRunFromPackage({ ...pkg, defHash: "0".repeat(64) }, { runId: e.runId, claimSeq: 1 }, store)) as any).refused).toMatch(/snapshot/);
    expect(((await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 2 }, store)) as any).refused).toMatch(/claim/);
    expect(((await driveEdgeRunFromPackage({ ...pkg, owner: null }, { runId: e.runId, claimSeq: 1 }, store)) as any).refused).toMatch(/owner/);
    expect(h.sent).toEqual([]);
  });
});

describe("doc 81 Đợt 10 C — the edge store in detail (no DB, fail-closed)", () => {
  const io = (x: Partial<{ records: EdgeRunRecordIn[]; authorize: (i: EdgeStepAuthorizeRequest) => Promise<EdgeStepAuthorizeOutcome>; admit: boolean; dropped: boolean }> = {}) => {
    const records = x.records ?? [];
    return {
      records,
      io: {
        runId: 0,
        claimSeq: 1,
        claimToken: "ect_" + "b".repeat(43),
        sink: {
          run: async (_r: number, _c: number, rec: EdgeRunRecordIn) => {
            if (x.dropped) return { seq: null, dropped: true as const, reason: "journal_full" };
            records.push(rec);
            return { seq: records.length };
          },
        },
        consume: { admitNonStop: () => x.admit ?? true },
        authorize: { authorize: x.authorize ?? (async (): Promise<EdgeStepAuthorizeOutcome> => ({ ok: false, verdict: "unavailable", code: "network" })) },
      },
    };
  };
  async function pkgOf(steps: WorkflowStep[], ref: string) {
    const e = await edgeAssignedRun(def(ref, steps));
    return { e, pkg: await claimPackage(e, 1) };
  }

  it("★ the authorise request carries the EXACT command and the canonical payload hash central binds (OT and robot)", async () => {
    const e = await edgeAssignedRun(def("hash-e", [gate(), ot("m1"), move("r1")]));
    await edgeSegment(e, 1); // paused at g1
    await approveEdgeGate(e);
    const pkg2 = await claimPackage(e, 2);
    const t = io();
    const seen: EdgeStepAuthorizeRequest[] = [];
    const central = fakeAuthorize(e, pkg2.definition as never);
    const store = createEdgeRunStore(pkg2, { ...t.io, runId: e.runId, claimSeq: 2, authorize: { authorize: async (i) => (seen.push(i), central.authorize(i)) } });
    await driveEdgeRunFromPackage(pkg2, { runId: e.runId, claimSeq: 2 }, store);
    const { otPayloadHash, robotPayloadHash, FOE_ENGINE_TOOL } = await import("../../ot/otActionBinding");
    expect(seen[0]).toMatchObject({ stepId: "m1", attempt: 1, idempotencyKey: `run${e.runId}-m1-a1`, command: { kind: "ot", adapterId: 501, machineId: 1, commandType: "start", writes: [{ tagKey: "run", value: 1 }] } });
    expect(seen[0].payloadHash).toBe(otPayloadHash({ tool: FOE_ENGINE_TOOL, adapterId: 501, machineId: 1, commandType: "start", writes: [{ tagKey: "run", value: 1 }] }));
    expect(seen[1]).toMatchObject({ stepId: "r1", command: { kind: "robot", robotId: 2, jobType: "move", params: { x: 1 } } });
    expect(seen[1].payloadHash).toBe(robotPayloadHash({ robotId: 2, jobType: "move", params: { x: 1 } }));
    expect(seen.every((s) => s.claimSeq === 2 && s.claimToken === t.io.claimToken && s.runId === e.runId)).toBe(true);
    // the approval central signed is the command's HITL provenance (requestedBy = owner, confirmedBy = approver)
    expect(h.sent.find((s) => s.stepId === "m1")!.hitl).toMatchObject({ requestedBy: OWNER.id, confirmedBy: OTHER.id });
  });

  it("★ verdict mapping: device refusal / payload mismatch fail the step with a machine-readable code; journal full and no config HOLD", async () => {
    const { e, pkg } = await pkgOf([ot("m1")], "map-e");
    const run = async (out: EdgeStepAuthorizeOutcome, opts: { admit?: boolean } = {}) => {
      const t = io({ authorize: async () => out, admit: opts.admit });
      const store = createEdgeRunStore(pkg, { ...t.io, runId: e.runId });
      const r = (await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)) as Record<string, any>;
      const row = t.records.filter((x: any) => x.kind === "step" && x.stepId === "m1").pop() as any;
      return { r, row };
    };
    const dev = await run({ ok: false, verdict: "refused", code: "device_refused", reason: "motion_locked" });
    expect(dev.r).toMatchObject({ outcome: "failed" });
    expect(dev.row).toMatchObject({ status: "failed" });
    expect(dev.row.error).toMatch(/^EDGE_DEVICE_REFUSED\(motion_locked\): command step "m1" was not sent/);
    const pm = await run({ ok: false, verdict: "refused", code: "payload_mismatch" });
    expect(pm.row.error).toMatch(/^EDGE_AUTHORIZE_REFUSED\(payload_mismatch\)/);
    const gr = await run({ ok: false, verdict: "refused", code: "gate_required", reason: "staleApproval" });
    expect(gr.row.error).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}\\(staleApproval\\)`));
    const full = await run({ ok: false, verdict: "refused", code: "x" }, { admit: false });
    expect(full.r).toMatchObject({ outcome: "held", heldReason: "journalFull" });
    expect(full.row.error).toMatch(/^EDGE_HELD\(journalFull\)/);
    const nocfg = await run({ ok: false, verdict: "unavailable", code: "no_config" });
    expect(nocfg.r).toMatchObject({ outcome: "held", heldReason: "configStale" });
    const thrown = createEdgeRunStore(pkg, {
      ...io().io,
      runId: e.runId,
      authorize: {
        authorize: async () => {
          throw new Error("socket hang up");
        },
      },
    });
    expect(await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, thrown)).toMatchObject({ outcome: "held", heldReason: "centralUnreachable" });
    expect(h.sent).toEqual([]); // ★ nothing reached the equipment in any of them
  });

  it("★ stale claim ⇒ the walker lets go: nothing more sent, no segment end (refused + detached)", async () => {
    const { e, pkg } = await pkgOf([ot("m1"), robotStop("s1")], "stale-e");
    const t = io({ authorize: async () => ({ ok: false, verdict: "stale", code: "claim_stale", abortRequested: false }) });
    const store = createEdgeRunStore(pkg, { ...t.io, runId: e.runId });
    const r = (await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)) as Record<string, any>;
    expect(r).toMatchObject({ ok: false, detached: true });
    expect(r.refused).toMatch(/no longer this walker's/);
    expect(r.outcome).toBeUndefined();
    expect(h.sent).toEqual([]);
    expect(store.segmentEnd()).toBeNull();
  });

  // A2(n) T0 — this case used to end on `expect(h.sent).toEqual([])`, right after the walk, under "the walk never actuated, its STOP is not needed". The sweep is not awaited: the STOP went
  // every time (its abortStopSent line stands in the old logs), a slow import() only kept it behind the assertion. m1's `running` row counts as acted (R-6-b reads the rows too).
  it("★ a stale claim WITH abortRequested ⇒ stopped: the local sweep sends the STOP (m1's running row counts as acted)", async () => {
    const { e, pkg } = await pkgOf([ot("m1"), robotStop("s1")], "stale2-e");
    const t = io({ authorize: async () => ({ ok: false, verdict: "stale", code: "claim_stale", abortRequested: true }) });
    const store = createEdgeRunStore(pkg, { ...t.io, runId: e.runId });
    const r = (await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)) as Record<string, any>;
    expect(r).toMatchObject({ outcome: "aborted" });
    await waitFor(() => h.sent.length > 0, "the local sweep's STOP");
    expect(h.sent.map((s) => s.stepId)).toEqual(["s1"]);
  });

  it("★ a journal that refuses a NON-STOP record stops the walk (nothing sent after it); a STOP's refused record never holds the STOP", async () => {
    const { e, pkg } = await pkgOf([robotStop("s1"), ot("m1")], "jr-e");
    const t = io({
      dropped: true,
      authorize: async () => ({ ok: true, authorization: {} as never, claims: { jti: randomUUID(), approval: null }, ttlMs: 10_000, reqNonce: "n".repeat(32), requestSentMonoMs: 0 }),
    });
    const store = createEdgeRunStore(pkg, { ...t.io, runId: e.runId });
    await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store).catch(() => undefined);
    expect(h.sent.map((s) => s.stepId)).toEqual(["s1"]);
  });

  it("★ createEdgeRunStore refuses a package of another run / claim; a central store never walks an edge package", async () => {
    const { e, pkg } = await pkgOf([ot("m1")], "cs-e");
    expect(() => createEdgeRunStore(pkg, { ...io().io, runId: e.runId + 1 })).toThrow(/not for run/);
    expect(() => createEdgeRunStore(pkg, { ...io().io, runId: e.runId, claimSeq: 2 })).toThrow(/claim/);
    const { centralRunStore } = await import("./foeRunStore");
    expect(((await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, centralRunStore)) as any).refused).toMatch(/edge store/);
    expect(h.sent).toEqual([]);
  });

  it("★ STOP re-send from a signed sweep picture: only the VERIFIED STOPs not confirmed are sent, never motion; too old ⇒ refused", async () => {
    const { resendStopsOfAbortedRun } = await import("./foeEngine");
    const { createEdgeSweepStore } = await import("../../edge/edgeRunStore");
    const { pkg } = await pkgOf([move("r1"), robotStop("s1"), robotStop("s2")], "rs-e");
    const picture = { ...pkg, kind: "sweep_picture", prior: { ...pkg.prior, abortSentBefore: ["s2"], settled: ["r1"], attempted: ["r1"], startOrder: ["r1"] } } as unknown as import("../../edge/edgeProtocol").EdgeSweepPicture;
    const outcomes: unknown[] = [];
    const store = createEdgeSweepStore(picture, { abortStop: (rec) => void outcomes.push(rec) });
    const r = await resendStopsOfAbortedRun(picture, { id: 0, role: "system", name: "edge" }, store);
    expect(r).toMatchObject({ ok: true, resend: true, abortStops: { sent: ["s1"], failed: [] } });
    expect(h.sent.map((s) => s.stepId)).toEqual(["s1"]); // s2 was confirmed before; r1 is motion
    expect(h.sent[0].edge as any).toMatchObject({ authorization: null });
    expect(outcomes).toEqual([expect.objectContaining({ kind: "abort_stop", stepId: "s1", status: "completed" })]);
    const old = { ...picture, issuedAt: Date.now() - 16 * 60_000 } as typeof picture;
    const r2 = await resendStopsOfAbortedRun(old, { id: 0, role: "system", name: "edge" }, createEdgeSweepStore(old, { abortStop: () => undefined }));
    expect(r2).toMatchObject({ ok: false, reason: "resendTooOld" });
    expect(h.sent.length).toBe(1);
  });
});

describe("doc 81 Đợt 10 C — central applies an edge segment end with the walk's rules (group B's sink)", () => {
  async function liveEdgeRun(steps: WorkflowStep[], ref: string) {
    const e = await edgeAssignedRun(def(ref, steps));
    runRow(e.runId).status = "running";
    return { e, d: rows("orchestration_workflows").find((w) => w.id === runRow(e.runId).workflowId)!.definitionJson as WorkflowDefinition };
  }
  const end = (d: WorkflowDefinition, x: Record<string, unknown>) => ({ nodeCode: "EDGE-A", claimSeq: 1, def: d, ...x }) as never;
  const w = (x: Partial<Row>) => ({ stepId: "m1", stepType: "command", status: "running", attempt: 0, startedAt: null, finishedAt: null, error: null, result: undefined, ...x }) as never;

  it("★ completed only when every top-level step row is completed / skipped and nothing runs — else not_finished, nothing written", async () => {
    const { e, d } = await liveEdgeRun([ot("m1"), ot("m2")], "ap-c");
    await recordEdgeStepRows(fake as never, e.runId, [w({ status: "completed", attempt: 1 })]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, end(d, { outcome: "completed" }))).toMatchObject({ ok: false, code: "not_finished" });
    expect(runRow(e.runId).status).toBe("running");
    await recordEdgeStepRows(fake as never, e.runId, [w({ stepId: "m2", status: "running" })]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, end(d, { outcome: "completed" }))).toMatchObject({ ok: false, code: "not_finished" });
    await recordEdgeStepRows(fake as never, e.runId, [w({ stepId: "m2", status: "skipped" })]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, end(d, { outcome: "completed" }))).toMatchObject({ ok: true, status: "completed", changed: true });
    expect(runRow(e.runId).status).toBe("completed");
    // a late report never regresses a finished run
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, end(d, { outcome: "failed", error: "late" }))).toMatchObject({ ok: true, status: "completed", changed: false });
  });

  it("★ a stopped run (aborted, or a rejection's claim) is never changed; the walk's own 'aborted' (precondition) ends aborted as on central; held marks the run", async () => {
    const a = await liveEdgeRun([ot("m1")], "ap-a");
    runRow(a.e.runId).status = "aborted";
    expect(await applyEdgeSegmentEnd(fake as never, a.e.runId, end(a.d, { outcome: "completed" }))).toMatchObject({ changed: false, status: "aborted" });
    const { FOE_REJECT_CLAIM_CTX_KEY } = await import("./foeGateApproval");
    const r = await liveEdgeRun([ot("m1")], "ap-r");
    runRow(r.e.runId).contextJson = { [FOE_REJECT_CLAIM_CTX_KEY]: "tok" };
    expect(await applyEdgeSegmentEnd(fake as never, r.e.runId, end(r.d, { outcome: "failed" }))).toMatchObject({ changed: false, status: "running" });
    const f = await liveEdgeRun([ot("m1")], "ap-f");
    expect(await applyEdgeSegmentEnd(fake as never, f.e.runId, end(f.d, { outcome: "aborted", error: "Precondition failed" }))).toMatchObject({ status: "aborted", changed: true });
    expect(String(runRow(f.e.runId).error)).toMatch(/^aborted on edge node EDGE-A: Precondition failed/);
    const hl = await liveEdgeRun([ot("m1")], "ap-h");
    expect(await applyEdgeSegmentEnd(fake as never, hl.e.runId, end(hl.d, { outcome: "held", heldReason: "centralUnreachable" }))).toMatchObject({ status: "held", changed: true });
    expect(runRow(hl.e.runId).contextJson).toMatchObject({ edgeHeld: "centralUnreachable", interrupted: true, edgeHeldNode: "EDGE-A" });
    expect(runRow(hl.e.runId).currentStepId).toBeNull();
    const q = await liveEdgeRun([ot("m1")], "ap-q");
    runRow(q.e.runId).status = "queued";
    expect(await applyEdgeSegmentEnd(fake as never, q.e.runId, end(q.d, { outcome: "failed" }))).toMatchObject({ changed: false, status: "queued" });
  });

  it("★ paused at a step that is not a gate ⇒ held (a person decides), never awaiting_confirm; an approved gate row is never reopened", async () => {
    const p = await liveEdgeRun([gate(), ot("m1")], "ap-p");
    expect(await applyEdgeSegmentEnd(fake as never, p.e.runId, end(p.d, { outcome: "paused", gateStepId: "m1" }))).toMatchObject({ status: "held" });
    expect(runRow(p.e.runId).contextJson).toMatchObject({ edgeHeld: "pausedAtNonGate" });
    const q = await liveEdgeRun([gate(), ot("m1")], "ap-q2");
    await recordEdgeStepRows(fake as never, q.e.runId, [w({ stepId: "g1", stepType: "hitl_gate", status: "completed", result: { approved: true } })]);
    expect(await applyEdgeSegmentEnd(fake as never, q.e.runId, end(q.d, { outcome: "paused", gateStepId: "g1" }))).toMatchObject({ status: "awaiting_confirm" });
    expect(runRow(q.e.runId).currentStepId).toBe("g1");
    expect(stepRows(q.e.runId).find((s) => s.stepId === "g1")).toMatchObject({ status: "completed", resultJson: { approved: true } });
  });

  it("★ recordEdgeStepRows keeps upsertStep's rules: running never regresses a finished row; a failed abort row never a completed one; no result keeps it", async () => {
    const { e } = await liveEdgeRun([ot("m1")], "rows-e");
    await recordEdgeStepRows(fake as never, e.runId, [w({ result: { routedTo: "ot-dispatcher", accepted: true } }), w({ status: "completed", attempt: 1 }), w({ status: "running" })]);
    expect(stepRows(e.runId).find((s) => s.stepId === "m1")).toMatchObject({ status: "completed", attempt: 1, resultJson: { routedTo: "ot-dispatcher", accepted: true } });
    await recordEdgeStepRows(fake as never, e.runId, [w({ stepId: "abort:s1", status: "completed", result: { abortStop: "sent" } }), w({ stepId: "abort:s1", status: "failed", result: { abortStop: "failed" } })]);
    expect(stepRows(e.runId).find((s) => s.stepId === "abort:s1")).toMatchObject({ status: "completed", resultJson: { abortStop: "sent" } });
    await recordEdgeStepRows(fake as never, e.runId, [w({ stepId: "abort:s2", status: "failed", result: { abortStop: "failed" } }), w({ stepId: "abort:s2", status: "completed", result: { abortStop: "sent" } })]);
    expect(stepRows(e.runId).find((s) => s.stepId === "abort:s2")).toMatchObject({ status: "completed" });
  });

  it("★ edgePriorPictureOf = the walk's own reading of the rows (completed set, settled, attempted, order, branches, confirmed STOPs)", () => {
    const t = (n: number) => new Date(T0.getTime() + n);
    const p = edgePriorPictureOf([
      { id: 1, stepId: "g1", status: "completed", resultJson: { approved: true }, startedAt: null },
      { id: 2, stepId: "m1", status: "completed", resultJson: { routedTo: "ot-dispatcher" }, startedAt: t(2) },
      { id: 3, stepId: "b1", status: "running", resultJson: { branch: "else" }, startedAt: t(1) },
      { id: 4, stepId: "x1", status: "skipped", resultJson: null, startedAt: null },
      { id: 5, stepId: "abort:s1", status: "completed", resultJson: { stepId: "s1" }, startedAt: t(3) },
    ]);
    expect(p).toEqual({
      completed: ["g1", "m1", "x1"],
      settled: ["g1", "m1", "x1"],
      attempted: ["g1", "m1", "b1"],
      startOrder: ["b1", "m1", "g1"],
      branches: [{ stepId: "b1", branch: "else" }],
      abortSentBefore: ["s1"],
      unknown: false,
    });
    expect(edgePriorPictureOf(null)).toMatchObject({ unknown: true, completed: [] });
  });
});

describe("doc 81 Đợt 10 C — central's half for edge runs: Continue clears the edge marks (N4); the approval digest from node reports (D7)", () => {
  const capable = { protocol: "stub", connectionOptions: { simProgram: "P1" } };
  async function heldEdgeRun(ref: string, mark: Record<string, unknown>) {
    const e = await edgeAssignedRun(def(ref, [gate(), ot("m1")]));
    const r = runRow(e.runId);
    r.status = "held";
    r.currentStepId = null;
    r.contextJson = { ...(r.contextJson ?? {}), "branch:b9": "then", ...mark };
    return e;
  }

  it("★ N4: Continue of an edge run held 'edge unreachable' / 'edge held' re-queues it and CLEARS the marks (the badge goes); the doubt stays recorded", async () => {
    const at = new Date().toISOString();
    for (const [ref, mark] of [
      ["n4-u", { edgeUnreachable: true, edgeUnreachableAt: at, edgeUnreachableNode: "EDGE-A", interrupted: true, interruptedAt: at, interruptedFrom: "queued", interruptedBy: "edge unreachable" }],
      ["n4-h", { edgeHeld: "centralUnreachable", edgeHeldAt: at, edgeHeldNode: "EDGE-A", interrupted: true, interruptedAt: at, interruptedFrom: "running", interruptedBy: "edge held: centralUnreachable" }],
    ] as const) {
      const e = await heldEdgeRun(ref, mark);
      const view = (await getRun(e.runId, { bindingDigest: true }))!;
      const r = await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
      expect(r).toMatchObject({ ok: true, status: "queued" });
      const ctx = runRow(e.runId).contextJson;
      for (const k of Object.keys(mark)) expect(ctx).not.toHaveProperty(k);
      expect(ctx).toMatchObject({ "branch:b9": "then", interruptedEarlier: true }); // the run's own context is kept
    }
  });

  it("★ N4: a central (non-edge) Continue is unchanged — its interrupted mark is not touched", async () => {
    expect((await deployWorkflow(def("n4-c", [gate(), ot("m1")]), OWNER)).ok).toBe(true);
    const runId = (await startRun("n4-c", {}, OWNER)).runId!;
    const r = runRow(runId);
    r.status = "held";
    r.currentStepId = null;
    r.contextJson = { interrupted: true, interruptedBy: "restart" };
    await resumeRun(runId, { approved: true, note: "auto-resume (FOE_DURABLE)" }, { id: 0, role: "system", name: "FOE auto-resume" });
    expect(runRow(runId).contextJson).toMatchObject({ interrupted: true, interruptedBy: "restart" });
  });

  it("★ the abort sweep keeps counting an edge run whose interruption a Continue cleared as possibly acted (interruptedEarlier)", async () => {
    const e = await heldEdgeRun("n4-s", { interrupted: true, interruptedBy: "edge restart" });
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(runRow(e.runId).contextJson).toMatchObject({ interruptedEarlier: true });
    // a central abort of a run whose rows say it never acted: its STOPs are "not needed" — UNLESS an earlier interruption
    // (cleared by a Continue) leaves the doubt, then they count as due (R-6-c)
    for (const [ref, ctx, expected] of [
      ["n4-s2", {}, { sent: [], notNeeded: ["s1"] }],
      ["n4-s3", { interruptedEarlier: true }, { sent: ["s1"], notNeeded: [] }],
    ] as const) {
      expect((await deployWorkflow(def(ref, [gate(), move("m1"), robotStop("s1")]), OWNER)).ok).toBe(true);
      const runId = (await startRun(ref, {}, OWNER)).runId!; // paused at g1, m1 never attempted
      runRow(runId).contextJson = { ...ctx };
      const ab = await abortRun(runId, OWNER, "doubt");
      expect(ab.abortStops).toMatchObject(expected);
    }
  });

  it("★ D7: the approver's digest of an EDGE run uses the node's fresh program report of its owned adapter — central never reads that controller", async () => {
    const e = await edgeAssignedRun(def("d7-e", [gate(), ot("m1")]));
    await edgeSegment(e, 1); // paused at g1
    const a = rows("device_adapters").find((x) => x.id === 501)!;
    Object.assign(a, capable, { edgeNodeId: NODE, ownerEpoch: 3 });
    // no report ⇒ a capable edge-owned controller is unreadable ⇒ no digest ⇒ cannot be approved (central has no session to read it)
    let view = (await getRun(e.runId, { bindingDigest: true }))!;
    expect(view.bindingDigest).toBeNull();
    expect(view.programChecks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 501, status: "unreadable" })]));
    // a fresh report of the node, same owner epoch ⇒ verified with the REPORTED checksum
    fake.seed({ [Symbol.for("drizzle:Name")]: "edge_node_program_reports" } as never, [{ edgeNodeId: NODE, adapterId: 501, status: "verified", checksum: "sha:abc", reason: null, readAt: new Date(), receivedAt: new Date(), ownerEpoch: 3 }]);
    view = (await getRun(e.runId, { bindingDigest: true }))!;
    expect(view.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(view.programChecks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 501, status: "verified", checksum: "sha:abc", source: "edge" })]));
    // the approval records exactly that reading
    await resumeRun(e.runId, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(stepRows(e.runId).find((s) => s.stepId === "g1")!.resultJson).toMatchObject({ bindingDigest: view.bindingDigest, programChecks: expect.arrayContaining([expect.objectContaining({ id: 501, status: "verified", checksum: "sha:abc" })]) });
  });

  it("★ D7: a stale report, another owner epoch, or another node's report never counts (unreadable ⇒ no digest)", async () => {
    const e = await edgeAssignedRun(def("d7-x", [gate(), ot("m1")]));
    await edgeSegment(e, 1);
    Object.assign(rows("device_adapters").find((x) => x.id === 501)!, capable, { edgeNodeId: NODE, ownerEpoch: 3 });
    const report = (x: Record<string, unknown>) => fake.seed({ [Symbol.for("drizzle:Name")]: "edge_node_program_reports" } as never, [{ edgeNodeId: NODE, adapterId: 501, status: "verified", checksum: "sha:abc", reason: null, readAt: new Date(), receivedAt: new Date(), ownerEpoch: 3, ...x }]);
    for (const bad of [{ readAt: new Date(Date.now() - 10 * 60_000) }, { readAt: new Date(Date.now() + 10 * 60_000) }, { ownerEpoch: 2 }, { edgeNodeId: NODE + 1 }]) {
      report(bad);
      const view = (await getRun(e.runId, { bindingDigest: true }))!;
      expect(view.bindingDigest, JSON.stringify(bad)).toBeNull();
    }
    // an edge-reported "unsupported" for a controller central's config says is capable is not believed
    report({ status: "unsupported", checksum: null });
    expect((await getRun(e.runId, { bindingDigest: true }))!.bindingDigest).toBeNull();
  });

  it("★ D7: a CENTRAL run is unchanged — its (central-owned) controllers are read as before", async () => {
    expect((await deployWorkflow(def("d7-c", [gate(), ot("m1")]), OWNER)).ok).toBe(true);
    const runId = (await startRun("d7-c", {}, OWNER)).runId!;
    const view = (await getRun(runId, { bindingDigest: true }))!;
    expect(view.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(view.programChecks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 501, status: "unsupported" })]));
  });
});

describe("doc 81 Đợt 10 C — mutation follow-ups (each pins one rule the first mutation run showed unmeasured)", () => {
  const okAuth = async (): Promise<EdgeStepAuthorizeOutcome> => ({ ok: true, authorization: {} as never, claims: { jti: randomUUID(), approval: null }, ttlMs: 10_000, reqNonce: "n".repeat(32) });
  const ioOf = (runId: number, authorize: (i: EdgeStepAuthorizeRequest) => Promise<EdgeStepAuthorizeOutcome>, records: EdgeRunRecordIn[] = []) => ({
    runId,
    claimSeq: 1,
    claimToken: "ect_" + "c".repeat(43),
    sink: { run: async (_r: number, _c: number, rec: EdgeRunRecordIn) => (records.push(rec), { seq: records.length }) },
    authorize: { authorize },
  });

  it("★ D5 inside a PARALLEL: a held branch holds the run (never 'completed' with an unsent step)", async () => {
    const e = await edgeAssignedRun(def("par-h", [{ id: "p1", type: "parallel", steps: [ot("m1"), move("r1")] } as never]));
    const pkg = await claimPackage(e, 1);
    const store = createEdgeRunStore(pkg, ioOf(e.runId, async () => ({ ok: false, verdict: "unavailable", code: "network" })));
    expect(await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)).toMatchObject({ outcome: "held", heldReason: "centralUnreachable" });
    expect(h.sent).toEqual([]);
  });

  it("★ a live sweep never re-sends a STOP an EARLIER segment's sweep confirmed (prior abortSentBefore)", async () => {
    const e = await edgeAssignedRun(def("prior-s", [move("r1"), { id: "d1", type: "delay", ms: 60_000 } as never, robotStop("s1")]));
    const pkg = await claimPackage(e, 1);
    (pkg.prior as { abortSentBefore: string[] }).abortSentBefore = ["s1"];
    const records: EdgeRunRecordIn[] = [];
    const store = createEdgeRunStore(pkg, ioOf(e.runId, okAuth, records));
    const drive = driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store);
    await waitFor(() => records.some((r: any) => r.kind === "step" && r.stepId === "d1" && r.status === "running"), "d1 running");
    const live = await stopLiveRunForCentralAbort(e.runId, { id: 0, role: "system", name: "edge: central abort" });
    await drive;
    expect(live.abortStops?.sent).toEqual([]);
    expect(h.sent.map((s) => s.stepId)).toEqual(["r1"]);
  });

  it("★ a command that names nothing to authorise (no adapter resolved) is refused on the edge without asking central", async () => {
    const e = await edgeAssignedRun(def("unres", [ot("m1")]));
    const pkg = await claimPackage(e, 1);
    (pkg as { resolvedAdapters: unknown[] }).resolvedAdapters = [];
    const asked: unknown[] = [];
    const records: EdgeRunRecordIn[] = [];
    const store = createEdgeRunStore(pkg, ioOf(e.runId, async (i) => (asked.push(i), okAuth()), records));
    expect(await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)).toMatchObject({ outcome: "failed" });
    expect(asked).toEqual([]);
    expect((records.filter((r: any) => r.kind === "step" && r.stepId === "m1").pop() as any).error).toMatch(/^EDGE_AUTHORIZE_REFUSED\(commandUnresolved\)/);
  });

  it("★ applyEdgeSegmentEnd: 'completed' is refused while ANY non-abort row still runs (also below the top level)", async () => {
    const e = await edgeAssignedRun(def("ap-run", [ot("m1"), ot("m2", { compensation: ot("c9") })]));
    runRow(e.runId).status = "running";
    const d = rows("orchestration_workflows").find((w) => w.id === runRow(e.runId).workflowId)!.definitionJson as WorkflowDefinition;
    const w = (stepId: string, status: string) => ({ stepId, stepType: "command", status, attempt: 1, startedAt: null, finishedAt: null, error: null, result: undefined });
    await recordEdgeStepRows(fake as never, e.runId, [w("m1", "completed"), w("m2", "completed"), w("c9", "running")]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, { outcome: "completed", nodeCode: "EDGE-A", claimSeq: 1, def: d } as never)).toMatchObject({ ok: false, code: "not_finished" });
    await recordEdgeStepRows(fake as never, e.runId, [w("abort:x", "running")].map((r) => ({ ...r, stepId: "abort:x" })));
    await recordEdgeStepRows(fake as never, e.runId, [w("c9", "compensated")]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, { outcome: "completed", nodeCode: "EDGE-A", claimSeq: 1, def: d } as never)).toMatchObject({ ok: true, status: "completed" });
  });

  it("★ applyEdgeSegmentEnd writes only while the run is STILL live when the write lands (a concurrent hold / abort wins)", async () => {
    const e = await edgeAssignedRun(def("ap-race", [ot("m1")]));
    runRow(e.runId).status = "held"; // what the row says when the write lands …
    const d = rows("orchestration_workflows").find((w) => w.id === runRow(e.runId).workflowId)!.definitionJson as WorkflowDefinition;
    // … while the endpoint's read still saw it 'running' (it changed in between)
    const sel = fake.select.bind(fake);
    let once = true;
    (fake as any).select = (p?: unknown) => {
      const b = sel(p as never);
      const from = b.from.bind(b);
      b.from = (t: any) => {
        const r = from(t);
        if (once && t?.[Symbol.for("drizzle:Name")] === "orchestration_runs") {
          once = false;
          const then = r.then.bind(r);
          r.then = (res: any, rej: any) => then((rowsOut: Row[]) => res(rowsOut.map((x) => ({ ...x, status: "running" }))), rej);
        }
        return r;
      };
      return b;
    };
    try {
      expect(await applyEdgeSegmentEnd(fake as never, e.runId, { outcome: "failed", error: "x", nodeCode: "EDGE-A", claimSeq: 1, def: d } as never)).toMatchObject({ changed: false });
    } finally {
      (fake as any).select = sel;
    }
    expect(runRow(e.runId).status).toBe("held");
  });
});

describe("doc 81 Đợt 10 C fix review 1 — compensation hold (R-10-y), journal refusal, robot STOP, precondition abort, OT pinned STOP", () => {
  it("★ R-10-y parity: a compensation whose authorisation is unavailable HOLDS the run at it (nothing sent, nothing failed); Continue resumes the COMPENSATION — final rows = central's", async () => {
    const cp = (ref: string) => def(ref, [gate(), move("r1", { compensation: ot("c1", { args: { tagKey: "speed", value: 0 } }) })]);
    h.failPlan.set("r1", Infinity);
    const c = await centralRun(cp("ch-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(cp("ch-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    // r1 is authorised and fails; central is unreachable for c1's authorisation
    e.offlineSteps = new Set(["c1"]);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "centralUnreachable" });
    expect(runRow(e.runId).status).toBe("held");
    expect(stepRows(e.runId).find((s) => s.stepId === "r1")).toMatchObject({ status: "failed" });
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toMatchObject({ status: "held" });
    expect(String(stepRows(e.runId).find((s) => s.stepId === "c1")!.error)).toMatch(/^EDGE_HELD\(centralUnreachable\)/);
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1"]); // c1 NOT sent
    // Continue: the compensation is resumed — r1 is never run again
    e.offlineSteps = undefined;
    await approveEdgeGate(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "failed" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(e.authorizeCalls.map((a) => a.stepId).filter((x) => x === "r1")).toHaveLength(1);
    expect(runRow(c).status).toBe("failed");
    expect(runRow(e.runId).status).toBe("failed");
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(runRow(e.runId).contextJson.foeCompensationHeld).toBeUndefined(); // R-10-ae — no context mark: the ROWS decided
  });

  it("★ journal refuses a record BEFORE the send: the step is not sent, it is HELD; the segment ends held(journalFull)", async () => {
    const e = await edgeAssignedRun(def("jb-e", [gate(), move("r1"), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const n0 = h.sent.length;
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "r1" && rec.status === "running";
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "journalFull" });
    expect(s2.out.error).toMatch(/^EDGE_HELD\(journalFull\)/);
    expect(h.sent.slice(n0)).toEqual([]);
    expect(e.authorizeCalls.filter((a) => a.claimSeq === 2)).toEqual([]); // nothing even asked
    expect(runRow(e.runId).status).toBe("held");
  });

  it("★ journal refuses the POST-SEND result: the step is OUTCOME-UNKNOWN — never sent again (no retry, not on Continue either); run held, then the step counts as failed", async () => {
    const e = await edgeAssignedRun(def("ja-e", [gate(), move("r1", { maxAttempts: 2, compensation: ot("c1") }), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const n0 = h.sent.length;
    h.failPlan.set("r1", 1); // the first send is refused by the device ⇒ the walker would retry …
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "r1" && typeof (rec.result as any)?.routedTo === "string";
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "journalFull", outcomeUnknown: ["r1"] });
    expect(s2.out.error).toMatch(/^EDGE_OUTCOME_UNKNOWN\(r1\)/);
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1"]); // … but never re-sends it; r2 / c1 never sent
    expect(runRow(e.runId).status).toBe("held");
    expect(runRow(e.runId).contextJson.foeOutcomeUnknown).toEqual(["r1"]);
    // Continue: r1 is NOT sent again — it is a failure. R1b-2b-2a A2(n) (n4/n5): its compensation c1 is NOT a pinned STOP ⇒ it is NOT sent
    // automatically on a device whose state is unknown: the segment ends held(outcomeUnknown) + an anomaly central turns into the URGENT alert
    e.refuse = undefined;
    e.events = [];
    await approveEdgeGate(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1"]); // ★ c1 not written
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r1")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toMatchObject({ status: "held" });
    expect(runRow(e.runId).status).toBe("held");
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toMatchObject({ stepId: "r1", compId: "c1", ma: "EDGE_OUTCOME_UNKNOWN", lan: "claim3" });
    // A2(n) T6 (decision 3, H13) — r2 never goes forward on this latched run (the Continue below sends c1 only): a person is told now, nobody would later
    expect(e.events!.filter((x) => x.code === "FOE_OUTCOME_UNKNOWN_COMPENSATION").map((x) => JSON.parse(x.detail))).toEqual([expect.objectContaining({ loai: "held", stepId: "r1", compId: "c1", claimSeq: 3 }), expect.objectContaining({ loai: "forwardNotSent", stepId: "r2", claimSeq: 3 })]);
    // n3 — refused (nothing changes) for a supervisor WITHOUT machine-control rights, then without a reason; with both, ONLY c1 is sent
    // (r1 never again), the run fails
    await expect(approveEdgeGate(e)).rejects.toThrow(/only a person with machine-control rights/);
    grantMachineControl();
    await expect(approveEdgeGate(e)).rejects.toThrow(/reason is required/);
    expect(runRow(e.runId).status).toBe("held");
    expect((await continueOutcomeUnknown(e, "checked on site: r1 not applied")).status).toBe("queued");
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toBeUndefined(); // the marker is cleared by that Continue
    const s4 = await edgeSegment(e, 4);
    expect(s4.out).toMatchObject({ outcome: "failed" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toMatchObject({ status: "compensated" });
  });

  it("★ a robot STOP job is a STOP for the edge even when the package does not list it (local classifier): it never asks, also offline", async () => {
    const e = await edgeAssignedRun(def("rs-local", [robotStop("s1")]));
    const pkg = await claimPackage(e, 1);
    (pkg as { verifiedStops: unknown[] }).verifiedStops = [];
    const asked: unknown[] = [];
    const store = createEdgeRunStore(pkg, {
      runId: e.runId,
      claimSeq: 1,
      claimToken: "ect_" + "d".repeat(43),
      sink: { run: async () => ({ seq: 1 }) },
      authorize: { authorize: async (i) => (asked.push(i), { ok: false, verdict: "unavailable", code: "network" }) },
    });
    expect(await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)).toMatchObject({ outcome: "completed" });
    expect(asked).toEqual([]);
    expect(h.sent.map((x) => x.stepId)).toEqual(["s1"]);
  });

  it("★ precondition abort: the edge segment ends ABORTED and central applies 'aborted' — as central's own walk", async () => {
    const pa = (ref: string) => def(ref, [gate(), move("r1", { precondition: { source: "telemetry", machineId: 1, key: "temp", op: "lt", value: 0 }, onPreconditionFail: "abort" }), move("r2")]);
    const c = await centralRun(pa("pa-c"), 1);
    const e = await edgeAssignedRun(pa("pa-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "aborted" });
    expect(runRow(c).status).toBe("aborted");
    expect(runRow(e.runId).status).toBe("aborted");
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(h.sent).toEqual([]);
  });

  it("★ OT PINNED STOP on the edge: never asks (L-7), sent with the package's pins — rows, commands and outcome = central's", async () => {
    fake.seed(deviceTags, [
      ...rows("device_tags"),
      { id: 73, adapterId: 501, tagKey: "halt", address: "00001", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true },
    ]);
    const ps = (ref: string) => def(ref, [gate(), ot("m1"), { id: "st", type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true } } as never]);
    const c = await centralRun(ps("ps-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(ps("ps-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2);
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["m1", "st"]);
    expect(e.authorizeCalls.map((a) => a.stepId)).toEqual(["m1"]); // ★ the pinned STOP never asked
    expect((h.sent.slice(n0).find((x) => x.stepId === "st")!.edge as any).authorization).toBeNull();
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(runRow(e.runId).status).toBe("completed");
  });
});

describe("doc 81 Đợt 10 C fix review 1 — THE edge program-report rule (R-10-m) and the resend window from abortedAt", () => {
  it("★ one predicate: key, central capability, owner epoch (stored only), freshness — anything else is unreadable", async () => {
    const { edgeProgramCheckOf, edgeProgramPreOf, EDGE_HOLD_MARK_KEYS } = await import("../../edge/edgeProgramReportRule");
    const now = 1_800_000_000_000;
    const capable = { id: 501, edgeNodeId: 7, ownerEpoch: 3, protocol: "stub", connectionOptions: { simProgram: "P" }, code: "A501" };
    const r = (x: Record<string, unknown> = {}) => ({ adapterId: 501, edgeNodeId: 7, status: "verified", checksum: "c1", readAt: now - 1_000, ownerEpoch: 3, ...x });
    const S = { source: "stored" as const, nowMs: now, maxAgeMs: 120_000, skewMs: 5_000 };
    expect(edgeProgramCheckOf(7, capable, r(), S)).toMatchObject({ status: "verified", checksum: "c1", label: "A501", source: "edge" });
    expect(edgeProgramCheckOf(8, capable, r({ edgeNodeId: 8 }), S)).toMatchObject({ status: "unreadable" }); // not the owner
    expect(edgeProgramCheckOf(7, capable, r({ edgeNodeId: 8 }), S)).toMatchObject({ status: "unreadable" }); // another node's reading
    expect(edgeProgramCheckOf(7, capable, r({ adapterId: 502 }), S)).toMatchObject({ status: "unreadable" });
    expect(edgeProgramCheckOf(7, capable, r({ ownerEpoch: 2 }), S)).toMatchObject({ status: "unreadable", reason: "inconsistent" });
    expect(edgeProgramCheckOf(7, capable, r({ ownerEpoch: null }), S)).toMatchObject({ status: "unreadable" });
    expect(edgeProgramCheckOf(7, capable, r({ ownerEpoch: undefined }), { ...S, source: "live" })).toMatchObject({ status: "verified" }); // a live request reading
    expect(edgeProgramCheckOf(7, capable, r({ readAt: now - 126_000 }), S)).toMatchObject({ status: "unreadable", reason: "timeout" });
    expect(edgeProgramCheckOf(7, capable, r({ readAt: now - 124_000 }), S)).toMatchObject({ status: "verified" }); // within age + skew
    expect(edgeProgramCheckOf(7, capable, r({ readAt: now + 6_000 }), S)).toMatchObject({ status: "unreadable", reason: "timeout" });
    expect(edgeProgramCheckOf(7, capable, r({ status: "unsupported", checksum: null }), S)).toMatchObject({ status: "unreadable", reason: "inconsistent" });
    expect(edgeProgramCheckOf(7, capable, r({ status: "unreadable", checksum: null, reason: "notConnected" }), S)).toMatchObject({ status: "unreadable", reason: "notConnected" });
    expect(edgeProgramCheckOf(7, { ...capable, protocol: "modbus", connectionOptions: {} }, r(), S)).toMatchObject({ status: "unsupported" }); // central's capability
    const pre = edgeProgramPreOf(7, [capable, { ...capable, id: 9, edgeNodeId: 8 }], [r()], S);
    expect([...pre.keys()]).toEqual([501]);
    expect(pre.get(9)).toMatchObject({ status: "unreadable" }); // an unknown id is never read centrally
    expect(EDGE_HOLD_MARK_KEYS).toEqual(expect.arrayContaining(["edgeUnreachable", "edgeWaiting", "edgeWaitingAt", "edgeWaitingNode", "edgeHeld", "interrupted"]));
  });

  it("★ N4: Continue clears B's 'waiting' marks too", async () => {
    const e = await edgeAssignedRun(def("n4-w", [gate(), ot("m1")]));
    const r = runRow(e.runId);
    Object.assign(r, { status: "held", currentStepId: null, contextJson: { edgeWaiting: "capacity", edgeWaitingAt: "x", edgeWaitingNode: "EDGE-A", interrupted: true } });
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(runRow(e.runId).contextJson).toEqual({ interruptedEarlier: true, edgeResumedBy: { userId: OTHER.id, at: expect.any(Number) } });
  });

  it("★ the edge's resend window counts from the ABORT (abortedAt), issuedAt only when it is absent", async () => {
    const { resendStopsOfAbortedRun } = await import("./foeEngine");
    const { createEdgeSweepStore } = await import("../../edge/edgeRunStore");
    const e = await edgeAssignedRun(def("rw-e", [move("r1"), robotStop("s1")]));
    const pkg = await claimPackage(e, 1);
    const pic = (x: Record<string, unknown>) => ({ ...pkg, kind: "sweep_picture", prior: { ...pkg.prior, settled: ["r1"], attempted: ["r1"] }, issuedAt: Date.now(), ...x }) as unknown as import("../../edge/edgeProtocol").EdgeSweepPicture;
    const user = { id: 0, role: "system", name: "edge" };
    const old = pic({ abortedAt: Date.now() - 16 * 60_000 }); // a fresh picture of an OLD abort
    expect(await resendStopsOfAbortedRun(old, user, createEdgeSweepStore(old, { abortStop: () => undefined }))).toMatchObject({ ok: false, reason: "resendTooOld" });
    expect(h.sent).toEqual([]);
    const recent = pic({ abortedAt: Date.now() - 60_000, issuedAt: Date.now() - 60 * 60_000 }); // abort recent ⇒ allowed
    expect(await resendStopsOfAbortedRun(recent, user, createEdgeSweepStore(recent, { abortStop: () => undefined }))).toMatchObject({ ok: true });
    expect(h.sent.map((x) => x.stepId)).toEqual(["s1"]);
    const { edgeSweepPictureSchema } = await import("../../edge/edgeProtocol");
    expect(edgeSweepPictureSchema.shape.abortedAt).toBeDefined(); // the signed picture can carry it
  });
});

describe("doc 81 Đợt 10 C fix review 1 — the edge assignment is read once and its read error is never swallowed", () => {
  it("★ assignment unreadable ⇒ the approver's screen gets NO digest (never a central controller read) and an approval is refused 'retry'", async () => {
    expect((await deployWorkflow(def("ae-c", [gate(), ot("m1")]), OWNER)).ok).toBe(true);
    const runId = (await startRun("ae-c", {}, OWNER)).runId!;
    const ok = (await getRun(runId, { bindingDigest: true }))!;
    expect(ok.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    const sel = FakeDb.prototype.select.bind(fake);
    (fake as any).select = (p?: unknown) => {
      const b = sel(p as never);
      const from = b.from.bind(b);
      b.from = (t: any) => {
        if (t?.[Symbol.for("drizzle:Name")] === "orchestration_run_edge_assignments") throw Object.assign(new Error("connection reset"), { code: "08006" });
        return from(t);
      };
      return b;
    };
    try {
      expect((await getRun(runId, { bindingDigest: true }))!.bindingDigest).toBeNull();
      const r = await resumeRun(runId, { approved: true, expectedStepId: "g1", expectedDefHash: ok.defHash!, expectedBindingDigest: ok.bindingDigest! }, OTHER);
      expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/could not be read — retry/) });
    } finally {
      (fake as any).select = sel;
    }
    expect(runRow(runId).status).toBe("awaiting_confirm");
  });
});

describe("doc 81 Đợt 10 C fix review 1 — the robot STOP classifier also feeds the local abort sweep", () => {
  it("★ a robot STOP the package does not list is still SENT by a local abort sweep (never left as a non-STOP)", async () => {
    const e = await edgeAssignedRun(def("rs-sweep", [move("r1"), { id: "d1", type: "delay", ms: 60_000 } as never, robotStop("s1")]));
    const pkg = await claimPackage(e, 1);
    (pkg as { verifiedStops: unknown[] }).verifiedStops = [];
    const records: EdgeRunRecordIn[] = [];
    const store = createEdgeRunStore(pkg, {
      runId: e.runId,
      claimSeq: 1,
      claimToken: "ect_" + "e".repeat(43),
      sink: { run: async (_r, _c, rec) => (records.push(rec), { seq: records.length }) },
      authorize: { authorize: async () => ({ ok: true, authorization: {} as never, claims: { jti: randomUUID(), approval: null }, ttlMs: 10_000, reqNonce: "n".repeat(32) }) },
    });
    const drive = driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store);
    await waitFor(() => records.some((r: any) => r.kind === "step" && r.stepId === "d1" && r.status === "running"), "d1 running");
    const live = await stopLiveRunForCentralAbort(e.runId, { id: 0, role: "system", name: "edge: central abort" });
    await drive;
    expect(live.abortStops).toMatchObject({ sent: ["s1"] });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "s1"]);
  });
});

describe("doc 81 Đợt 10 C fix review 2 (R-10-ae) — what a Continue must never redo is read from the STEP ROWS", () => {
  const cp = (ref: string) => def(ref, [gate(), move("r1", { compensation: ot("c1", { args: { tagKey: "speed", value: 0 } }) })]);
  async function heldAtCompensation(ref: string, opts: { refuseContext?: boolean } = {}) {
    h.failPlan.set("r1", Infinity);
    const e = await edgeAssignedRun(cp(ref));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.offlineSteps = new Set(["c1"]);
    if (opts.refuseContext) e.refuse = (rec) => rec.kind === "context";
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held" });
    expect(runRow(e.runId).status).toBe("held");
    e.offlineSteps = undefined;
    e.refuse = undefined;
    return e;
  }

  it("★ the context mark STRIPPED (whatever a filter keeps): Continue still runs ONLY the compensation — r1 is never re-sent", async () => {
    const e = await heldAtCompensation("ae-strip");
    const ctx = runRow(e.runId).contextJson ?? {};
    delete ctx.foeCompensationHeld;
    delete ctx.foeOutcomeUnknown;
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "compensationHeld" } }); // central-written, from the rows
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(runRow(e.runId).status).toBe("failed");
  });

  it("★ the journal REFUSES the context record of the held segment: Continue still never re-sends r1", async () => {
    const e = await heldAtCompensation("ae-ctxref", { refuseContext: true });
    expect(runRow(e.runId).contextJson.foeCompensationHeld).toBeUndefined();
    await approveEdgeGate(e);
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toMatchObject({ status: "compensated" });
  });

  it("★ a forged / stale context mark never decides: rows win (a 'held compensation' mark for a step the rows show completed changes nothing)", async () => {
    const e = await edgeAssignedRun(def("ae-forge", [gate(), ot("m1", { compensation: ot("c1") }), move("r2")]));
    await edgeSegment(e, 1);
    runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), foeCompensationHeld: { m1: "forged" }, foeResumeState: { m1: { state: "doneFailed", error: "forged" } } };
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toBeUndefined(); // replaced by the rows' (empty) state
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual(["m1", "r2"]);
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ ambiguous rows (a compensation row, but the forward step's row does not say it failed) ⇒ the Continue is REFUSED, nothing changes", async () => {
    const e = await heldAtCompensation("ae-amb");
    stepRows(e.runId).find((s) => s.stepId === "r1")!.status = "held";
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    const r = await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/^EDGE_RESUME_AMBIGUOUS\(r1\)/) });
    expect(runRow(e.runId).status).toBe("held");
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
  });

  it("★ outcome unknown WITHOUT the prefix (the complete lost it): the authorisation ledger shows r1 issued with no result ⇒ never re-sent", async () => {
    const e = await edgeAssignedRun(def("ae-nopfx", [gate(), move("r1", { compensation: ot("c1") }), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "r1" && typeof (rec.result as any)?.routedTo === "string";
    e.stripEndUnknown = true;
    await edgeSegment(e, 2);
    expect(runRow(e.runId).contextJson.foeOutcomeUnknown).toBeUndefined(); // the hint never arrived
    e.refuse = undefined;
    e.stripEndUnknown = false;
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "outcomeUnknown" } });
    const s3 = await edgeSegment(e, 3);
    // R1b-2b-2a A2(n) — r1 once; its (non-STOP) compensation is HELD for a person, never sent by itself after the unknown outcome
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r1")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
    // the Continue (person + reason) ⇒ the resume state derived from the rows carries the unknown flag; c1 sent once
    await continueOutcomeUnknown(e, "checked: r1 never moved");
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "compensationHeld", khongRo: true } });
    await edgeSegment(e, 4);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]);
  });

  it("★ edgeResumeStateOf: the rows' rule (sent ⇒ unknown, failed + comp held / running / absent ⇒ compensation, comp ended ⇒ done, else ambiguous)", async () => {
    const { edgeResumeStateOf } = await import("./foeRunStore");
    const d = def("x", [ot("a"), ot("b", { compensation: ot("bc") }), ot("c", { compensation: ot("cc") }), ot("e", { compensation: ot("ec") }), ot("f", { compensation: ot("fc") }), ot("g"), ot("h")]);
    const row = (stepId: string, status: string, x: Record<string, unknown> = {}) => ({ stepId, status, resultJson: null, error: null, ...x });
    const out = edgeResumeStateOf(
      d,
      [
        row("a", "running", { resultJson: { routedTo: "ot-dispatcher" } }), // sent, no final ⇒ unknown
        row("b", "failed", { error: "boom" }),
        row("bc", "held"), // ⇒ compensation resumed
        row("c", "failed"),
        row("cc", "compensated"), // ⇒ done
        row("e", "completed"),
        row("ec", "held"), // forward completed but its compensation held ⇒ ambiguous
        row("f", "failed"), // compensation never started ⇒ resumed
        row("g", "running"), // authorised, no result ⇒ unknown (ledger)
        row("h", "completed"),
        row("abort:a", "completed"),
      ],
      new Set(["g", "h"]),
    );
    expect(out.state).toEqual({
      a: expect.objectContaining({ state: "outcomeUnknown" }),
      g: expect.objectContaining({ state: "outcomeUnknown" }),
      b: { state: "compensationHeld", error: "boom" },
      c: { state: "doneFailed", error: "" },
      f: { state: "compensationHeld", error: "" },
    });
    expect(out.ambiguous).toEqual(["e"]);
    expect(edgeResumeStateOf(d, [row("a", "held")], new Set(), ["a"]).state).toMatchObject({ a: { state: "outcomeUnknown" } }); // a hint only ADDS
  });

  it("★ the real context filter: only the walker's own keys pass; central's keys are refused (and reported when they would change)", () => {
    const r = edgeContextPatchOf(
      { "branch:b1": "then", foeDispatchedSteps: ["m1"], telemetry: {}, states: {}, foeResumeState: { r1: { state: "doneFailed" } }, foeOutcomeUnknown: [], interrupted: false, startedViaApi: false },
      { foeOutcomeUnknown: [] },
    );
    expect(Object.keys(r.patch).sort()).toEqual(["branch:b1", "foeDispatchedSteps", "states", "telemetry"]);
    expect(r.refusedKeys.sort()).toEqual(["foeResumeState", "interrupted", "startedViaApi"]);
  });
});

describe("doc 81 Đợt 10 C fix review 2 — a COMPENSATION sent with an unknown outcome is never sent again", () => {
  it("★ c1 sent, its result refused by the journal ⇒ held; Continue: neither r1 nor c1 is sent again, the run fails", async () => {
    h.failPlan.set("r1", Infinity);
    const e = await edgeAssignedRun(def("ae-cu", [gate(), move("r1", { compensation: ot("c1") })]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "c1" && typeof (rec.result as any)?.routedTo === "string";
    e.stripEndUnknown = true; // and the prefix is lost too: the rows + the ledger alone decide
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held" });
    e.refuse = undefined;
    e.stripEndUnknown = false;
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "compensationHeld" }, c1: { state: "outcomeUnknown" } });
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(String(stepRows(e.runId).find((s) => s.stepId === "c1")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
    expect(runRow(e.runId).status).toBe("failed");
  });
});

describe("doc 81 Đợt 10 C fix review 3 (R-10-ao) — ANY authorisation on a non-final row means sent; STOPs are always re-sent; only 42P01 means no ledger", () => {
  it("★ N1 real ordering: the ledger result reached central (resultReportedAt set) but the result row and the prefix were lost ⇒ r1 is never re-sent", async () => {
    const e = await edgeAssignedRun(def("ao-n1", [gate(), move("r1"), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "r1" && typeof (rec.result as any)?.routedTo === "string";
    e.stripEndUnknown = true;
    await edgeSegment(e, 2);
    expect((fake.store.get("edge_step_authorizations") ?? []).find((a) => a.runId === e.runId && a.stepId === "r1")!.resultReportedAt).toBeInstanceOf(Date);
    e.refuse = undefined;
    e.stripEndUnknown = false;
    await approveEdgeGate(e);
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r1")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
  });

  it("★ N1 compensation + retry: a compensation and a retried attempt whose ledger result is reported are not re-sent either", async () => {
    const { edgeResumeStateOf } = await import("./foeRunStore");
    const d = def("x", [move("r1", { maxAttempts: 2, compensation: ot("c1") })]);
    const row = (stepId: string, status: string) => ({ stepId, status, resultJson: null, error: null });
    // r1 failed, c1 authorised + its result reported, row still running ⇒ c1 unknown; r1 resumes only the (unknown) compensation
    expect(edgeResumeStateOf(d, [row("r1", "failed"), row("c1", "running")], new Set(["c1"])).state).toMatchObject({ c1: { state: "outcomeUnknown" }, r1: { state: "compensationHeld" } });
    // r1 retried: attempt 2 authorised (any result) on a running row ⇒ unknown
    expect(edgeResumeStateOf(d, [row("r1", "running")], new Set(["r1"])).state).toMatchObject({ r1: { state: "outcomeUnknown" } });
  });

  it("★ N2 a STOP is never outcome-unknown: on Continue it is SENT again (L-7) — rows, ledger and hints alike", async () => {
    const e = await edgeAssignedRun(def("ao-n2", [gate(), move("r1"), robotStop("s1"), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    // held at r2; the STOP's FINAL row is lost (its row still 'running' with a dispatch result) and the end names it unknown
    e.offlineSteps = new Set(["r2"]);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held" });
    Object.assign(stepRows(e.runId).find((s) => s.stepId === "s1")!, { status: "running" });
    runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), foeOutcomeUnknown: ["s1"] };
    e.offlineSteps = undefined;
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState?.s1).toBeUndefined();
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "s1", "s1"]); // the STOP again; r1 never; r2 not sent: the end named a command unknown, the run is latched (A2(n) extension)
    const { edgeResumeStateOf } = await import("./foeRunStore");
    const d = def("y", [robotStop("s9")]);
    expect(edgeResumeStateOf(d, [{ stepId: "s9", status: "running", resultJson: { routedTo: "robot-dispatcher" } }], new Set(["s9"]), ["s9"], new Set(["s9"])).state).toEqual({});
  });

  it("★ N3 only 42P01 (no table) means 'no ledger'; any other ledger error (42703, 42883, a connection error) refuses the Continue", async () => {
    for (const [code, refused] of [["42703", true], ["42883", true], ["08006", true], ["42P01", false]] as const) {
      const e = await edgeAssignedRun(def(`ao-n3-${code}`, [gate(), ot("m1")]));
      await edgeSegment(e, 1);
      const sel = FakeDb.prototype.select.bind(fake);
      (fake as any).select = (p?: unknown) => {
        const b = sel(p as never);
        const from = b.from.bind(b);
        b.from = (t: any) => {
          if (t?.[Symbol.for("drizzle:Name")] === "edge_step_authorizations") throw Object.assign(new Error("ledger"), { code });
          return from(t);
        };
        return b;
      };
      try {
        const view = (await getRun(e.runId, { bindingDigest: true }))!;
        const r = await resumeRun(e.runId, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
        if (refused) expect(r, code).toMatchObject({ ok: false, message: expect.stringMatching(/could not be read to continue it safely/) });
        else expect(r, code).toMatchObject({ ok: true, status: "queued" });
      } finally {
        (fake as any).select = sel;
      }
    }
  });
});

describe("doc 81 Đợt 10 C fix review 4 (B F-B2-1) — a Continue of a held edge run records the RESUMER; /authorize uses that role", () => {
  it("★ Continue records edgeResumedBy {userId, at} (central-only); a gate approval does not; an edge patch can never set it; B's actor rule then takes the resumer", async () => {
    const { EDGE_RESUMED_BY_CTX_KEY, edgeEngineActorOf } = await import("../../edge/edgeAuthorizeCentral");
    const e = await edgeAssignedRun(def("rb-e", [gate(), move("r1"), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e); // gate path: OTHER approves g1
    expect(runRow(e.runId).contextJson?.[EDGE_RESUMED_BY_CTX_KEY]).toBeUndefined();
    const gateAt = new Date(stepRows(e.runId).find((s) => s.stepId === "g1")!.finishedAt).getTime();
    expect(edgeEngineActorOf(runRow(e.runId).contextJson, { approvedBy: OTHER.id, at: gateAt })).toEqual({ userId: OTHER.id, path: "gate" });
    e.offlineSteps = new Set(["r2"]);
    await edgeSegment(e, 2); // held at r2
    expect(runRow(e.runId).status).toBe("held");
    e.offlineSteps = undefined;
    const RESUMER = { id: 14, role: "supervisor", name: "resumer" };
    // A2 test — the resume must land in a LATER millisecond than the gate approval: on a tie edgeEngineActorOf is (rightly)
    // unknown, and a fast run used to make both stamps equal (flaky {gate} / now {unknown}). Wait until the clock has passed gateAt.
    while (Date.now() <= gateAt) await new Promise((r) => setTimeout(r, 1));
    const t0 = Date.now();
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    expect((await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, RESUMER)).status).toBe("queued");
    const rec = runRow(e.runId).contextJson[EDGE_RESUMED_BY_CTX_KEY];
    expect(rec).toMatchObject({ userId: RESUMER.id });
    expect(rec.at).toBeGreaterThanOrEqual(t0);
    expect(rec.at).toBeGreaterThan(gateAt);
    // B's /authorize rule: the held path ⇒ the RESUMER (its role is then read for the engine policy)
    expect(edgeEngineActorOf(runRow(e.runId).contextJson, { approvedBy: OTHER.id, at: gateAt })).toEqual({ userId: RESUMER.id, path: "held" });
    // an edge context patch can never set (or overwrite) it
    const forged = edgeContextPatchOf({ [EDGE_RESUMED_BY_CTX_KEY]: { userId: OTHER.id, at: Date.now() + 1 }, "branch:x": "then" }, runRow(e.runId).contextJson);
    expect(forged.patch).toEqual({ "branch:x": "then" });
    expect(forged.refusedKeys).toEqual([EDGE_RESUMED_BY_CTX_KEY]);
  });

  it("★ the key is the same name B reads; a CENTRAL (non-edge) Continue writes nothing new", async () => {
    const rule = await import("../../edge/edgeProgramReportRule");
    const b = await import("../../edge/edgeAuthorizeCentral");
    expect(rule.EDGE_RESUMED_BY_CTX_KEY).toBe(b.EDGE_RESUMED_BY_CTX_KEY);
    expect((await deployWorkflow(def("rb-c", [gate(), ot("m1")]), OWNER)).ok).toBe(true);
    const runId = (await startRun("rb-c", {}, OWNER)).runId!;
    Object.assign(runRow(runId), { status: "held", currentStepId: null, contextJson: { interrupted: true } });
    await resumeRun(runId, { approved: true, note: "auto-resume (FOE_DURABLE)" }, { id: 0, role: "system", name: "FOE auto-resume" });
    expect(runRow(runId).contextJson).toMatchObject({ interrupted: true });
    expect(runRow(runId).contextJson).not.toHaveProperty("edgeResumedBy");
  });
});

describe("doc 81 Đợt 10 C fix review 5 (R-10-bn) — an edge assignment names only devices the node owns", () => {
  it("★ a robot / adapter the node does not own, an unresolvable device, or unreadable ownership ⇒ the run is NOT created; owned ⇒ created; central runs unaffected", async () => {
    const runsBefore = () => rows("orchestration_runs").length;
    expect((await deployWorkflow(def("own-r", [gate(), move("m1")]), OWNER)).ok).toBe(true);
    h.foreignRobots.add(2);
    let n = runsBefore();
    const r1 = await startRun("own-r", {}, OWNER, { edgeNodeId: NODE });
    expect(r1).toMatchObject({ ok: false, message: expect.stringMatching(/does not own \(robot 2\)/) });
    expect(runsBefore()).toBe(n);
    expect(rows("orchestration_run_edge_assignments")).toEqual([]);
    // the same definition walked centrally is unaffected
    expect((await startRun("own-r", {}, OWNER)).status).toBe("awaiting_confirm");
    h.foreignRobots.clear();
    expect(await startRun("own-r", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: true, status: "queued" });
    // an OT adapter it does not own — a STOP step's target counts too
    expect((await deployWorkflow(def("own-a", [gate(), robotStop("s0"), ot("m1")]), OWNER)).ok).toBe(true);
    h.foreignAdapters.add(501);
    n = runsBefore();
    expect(await startRun("own-a", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: false, message: expect.stringMatching(/adapter 501/) });
    h.foreignAdapters.clear();
    h.foreignRobots.add(2);
    expect(await startRun("own-a", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: false, message: expect.stringMatching(/robot 2/) }); // the STOP's robot
    h.foreignRobots.clear();
    expect(runsBefore()).toBe(n);
    // ownership unreadable ⇒ refused (fail closed)
    h.ownershipThrows = true;
    expect(await startRun("own-a", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: false, message: expect.stringMatching(/could not be verified/) });
    h.ownershipThrows = false;
    // an OT step whose adapter cannot be resolved (two enabled adapters on its machine) ⇒ refused
    fake.seed(deviceAdapters, [...rows("device_adapters"), { id: 502, machineId: 1, isEnabled: true, updatedAt: T0, protocol: "stub", code: "A502" }]);
    expect(await startRun("own-a", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: false, stepIds: ["m1"], message: expect.stringMatching(/cannot be resolved \(m1\)/) });
    expect(runsBefore()).toBe(n);
  });
});

describe("R1b-2b-2a A2(n) fix round 1 — the edge routes of an unknown outcome (C-1, C-2 (b)(c)(d), I-5, R-2)", () => {
  const box = (id: string, steps: WorkflowStep[], compensation: WorkflowStep): WorkflowStep => ({ id, type: "sequence", steps, compensation }) as never;
  const par = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: true, steps }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    return e;
  }

  it("★ C-1 + R-2 a robot STOP on the container goes out at once behind the held child; Continue (person + reason) sends only the child's compensation, the STOP never again", async () => {
    const e = await denBuoc(def("n1-c1", [gate(), box("box", [move("r1", { compensation: ot("c1") })], robotStop("bs"))]));
    h.timeoutDispatch.add("r1");
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "bs"]); // ★ the STOP, no person; the reset-like c1 not
    await continueOutcomeUnknown(e, "checked");
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "failed" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "bs", "c1"]); // bs is not re-sent
  });

  it("★ R-2 a robot STOP compensation runs by itself on the edge too (no hold)", async () => {
    const e = await denBuoc(def("n1-r2", [gate(), move("r1", { compensation: robotStop("bs") })]));
    h.timeoutDispatch.add("r1");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "failed" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "bs"]);
  });

  it("★ C-2 (b) a gate in a sibling branch: held(outcomeUnknown), not paused; the approval needs the check", async () => {
    const e = await denBuoc(def("n1-b", [gate(), par("p", [move("r1", { compensation: ot("c1") }), gate("g2")])]));
    h.timeoutDispatch.add("r1");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(runRow(e.runId).status).toBe("held");
    grantMachineControl();
    await expect(approveEdgeGate(e)).rejects.toThrow(/reason is required/);
    expect(h.sent.some((x) => x.stepId === "c1")).toBe(false);
  });

  it("★ C-2 (c) a sibling's held reason never overwrites outcomeUnknown (one field, last write wins before): the marker and the check stay", async () => {
    // the sibling's refusal comes AFTER the hold (a delay first), so a plain last-write-wins field would end on its reason
    const later = { id: "later", type: "sequence", steps: [{ id: "w", type: "delay", ms: 80 }, move("r2")] } as never;
    const e = await denBuoc(def("n1-c", [gate(), par("p", [later, move("r1", { compensation: ot("c1") })])]));
    h.timeoutDispatch.add("r1");
    e.offlineSteps = new Set(["r2"]);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toMatchObject({ stepId: "r1", compId: "c1" });
    await expect(approveEdgeGate(e)).rejects.toThrow(/machine-control rights/);
  });

  it("★ C-2 (c) + I-5 a full journal during the hold: the run stream refused the compensation's row, the events journal the anomaly ⇒ still held(outcomeUnknown), the marker, the check, and the URGENT rides on the segment end", async () => {
    const e = await denBuoc(def("n1-j", [gate(), move("r1", { compensation: ot("c1") })]));
    h.timeoutDispatch.add("r1");
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "c1";
    e.eventsRefused = true;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toMatchObject({ stepId: "r1", compId: "c1", lan: "claim2" });
    expect(String(runRow(e.runId).error)).not.toContain("[[A2N"); // stripped: never in the run's error
    await waitFor(() => h.alerts.length > 0, "the URGENT");
    expect(h.alerts[0]).toMatchObject({ kind: "foe_outcome_unknown_compensation_held", dedupKey: `foe_outcome_unknown_compensation_held:${e.runId}:r1:c1:claim2` });
    expect(h.alerts[0]!.recipients).toContain(OWNER.id); // ★ it reaches a person
    e.refuse = undefined;
    await expect(approveEdgeGate(e)).rejects.toThrow(/machine-control rights/);
    expect(h.sent.some((x) => x.stepId === "c1")).toBe(false);
  });

  it("★ the STOP case too: a full events journal does not lose 'STOP compensation sent' (the segment end carries it)", async () => {
    const e = await denBuoc(def("n1-js", [gate(), move("r1", { compensation: robotStop("bs") })]));
    h.timeoutDispatch.add("r1");
    e.eventsRefused = true;
    await edgeSegment(e, 2);
    await waitFor(() => h.alerts.length > 0, "the URGENT");
    expect(h.alerts[0]!.kind).toMatch(/^foe_outcome_unknown_stop_compensation_/);
  });

  it("★ C-2 (d) the node died after the step's failed row, before the compensation row: no marker, a plain interrupted hold ⇒ the Continue still needs person + reason; the walker writes it only then", async () => {
    const e = await denBuoc(def("n1-d", [gate(), move("r1", { compensation: ot("c1") })]));
    runRow(e.runId).status = "running";
    await recordEdgeStepRows(fake as never, e.runId, [{ stepId: "r1", stepType: "command", status: "failed", attempt: 1, startedAt: null, finishedAt: new Date(), error: "EDGE_OUTCOME_UNKNOWN: command r1", result: undefined }]);
    runRow(e.runId).status = "held";
    runRow(e.runId).contextJson = { interrupted: true };
    await expect(approveEdgeGate(e)).rejects.toThrow(/machine-control rights/);
    grantMachineControl();
    await expect(approveEdgeGate(e)).rejects.toThrow(/reason is required/);
    expect(runRow(e.runId).status).toBe("held");
    expect((await continueOutcomeUnknown(e, "checked: r1 did not move")).status).toBe("queued");
    expect(runRow(e.runId).contextJson.foeKetCucKhongRoDuyet).toMatchObject({ stepIds: ["r1"], by: OTHER.id });
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual(["c1"]);
  });

  it("★ C-2 the walker keys on the same fact: a resume state that names a held compensation WITHOUT a Continue's approval is never written — it is split again", async () => {
    const e = await denBuoc(def("n1-w", [gate(), move("r1", { compensation: ot("c1") })]));
    runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), foeResumeState: { r1: { state: "compensationHeld", error: "EDGE_OUTCOME_UNKNOWN: x", khongRo: true } } };
    const s = await edgeSegment(e, 2);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.some((x) => x.stepId === "c1")).toBe(false);
  });

  it("★ I-4 edge: Continue writes the held compensation and nothing forward: a failed sibling with no compensation is doneFailed, not re-sent", async () => {
    h.failPlan.set("r2", 1);
    const e = await denBuoc(def("n1-f", [gate(), par("p", [move("r1", { compensation: ot("c1") }), move("r2")])]));
    h.timeoutDispatch.add("r1");
    await edgeSegment(e, 2);
    const n0 = h.sent.length;
    await continueOutcomeUnknown(e, "checked");
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r2: { state: "doneFailed" }, r1: { state: "compensationHeld", khongRo: true } });
    await edgeSegment(e, 3);
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["c1"]);
  });
});

describe("R1b-2b-2a A2(n) fix round 2 — the edge: the unknown flag outranks a sibling, a Continue walks the held compensations only (C-A, I-A, I-E)", () => {
  const box = (id: string, steps: WorkflowStep[], compensation?: WorkflowStep): WorkflowStep => ({ id, type: "sequence", steps, ...(compensation ? { compensation } : {}) }) as never;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    return e;
  }
  const lai = { id: "w", type: "delay", ms: 60 } as never;

  it("★ C-A (a) a gate beside the unknown branch: the container's robot STOP goes at once, the segment ends paused, and the paused end carries the URGENT on a full events journal", async () => {
    const e = await denBuoc(def("n2-a", [gate(), par("p", [move("r1"), gate("g2")], { compensation: robotStop("bs") })]));
    h.timeoutDispatch.add("r1");
    e.eventsRefused = true;
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "paused", gateStepId: "g2" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "bs"]); // ★ no approval needed
    // two reports ride on this end (the I-L one too): both are read from the rider, because two concurrent first imports of the mocked alert in one test race the vi.mock factory (seen: the second gets the real one)
    expect(String(s2.out.error)).toMatch(/"loai":"stop[A-Za-z]+","stepId":"p","compId":"bs"/);
    await waitFor(() => h.alerts.length > 0, "the URGENT");
    expect(String(runRow(e.runId).error ?? "")).not.toContain("[[A2N");
  });

  it("★ C-A (c) a sibling held for ANOTHER reason: the container's STOP still goes, and it is told", async () => {
    const e = await denBuoc(def("n2-c", [gate(), par("p", [move("r1"), box("later", [lai, move("r2")])], { compensation: robotStop("bs") })]));
    h.timeoutDispatch.add("r1");
    e.offlineSteps = new Set(["r2"]);
    e.events = [];
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "bs"]);
    expect(e.events.filter((x) => x.code === "FOE_OUTCOME_UNKNOWN_COMPENSATION" && !String(x.detail).includes('"noCompensation"'))).toHaveLength(1); // the I-L one goes too
  });

  it("★ I-E an unknown step with no compensation is NEVER re-sent on a new claim: gate sibling, approval, next segment", async () => {
    const e = await denBuoc(def("n2-e", [gate(), par("p", [move("r1"), gate("g2")]), move("r9")]));
    h.timeoutDispatch.add("r1");
    await edgeSegment(e, 2);
    h.timeoutDispatch.clear();
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "doneFailed", khongRo: true } });
    const n1 = h.sent.length;
    const s3 = await edgeSegment(e, 3);
    expect(h.sent.slice(n1).map((x) => x.stepId)).toEqual([]); // ★ neither r1 again nor forward
    expect(s3.out).toMatchObject({ outcome: "failed" });
  });

  it("★ I-E the walker's crash after the failed row, a plain Continue: r1 is not re-sent (the first review's second shape)", async () => {
    const e = await denBuoc(def("n2-e2", [gate(), move("r1")]));
    runRow(e.runId).status = "running";
    await recordEdgeStepRows(fake as never, e.runId, [{ stepId: "r1", stepType: "command", status: "failed", attempt: 1, startedAt: null, finishedAt: new Date(), error: "FOE_OUTCOME_UNKNOWN: command r1", result: undefined }]);
    runRow(e.runId).status = "held";
    runRow(e.runId).contextJson = { interrupted: true };
    await approveEdgeGate(e); // no compensation pending: an ordinary Continue
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual([]);
    expect(runRow(e.runId).status).toBe("failed");
  });

  it("★ I-A the walk under a Continue reads no precondition and sends nothing forward: a sibling held by the edge stays unsent, the next step too", async () => {
    const e = await denBuoc(def("n2-i", [gate(), par("p", [move("r1", { compensation: ot("c1") }), box("later", [lai, move("r2")])]), move("r9")]));
    h.timeoutDispatch.add("r1");
    e.offlineSteps = new Set(["r2"]);
    await edgeSegment(e, 2);
    e.offlineSteps = undefined;
    h.timeoutDispatch.clear();
    const n1 = h.sent.length;
    await continueOutcomeUnknown(e, "checked");
    const s3 = await edgeSegment(e, 3);
    expect(h.sent.slice(n1).map((x) => x.stepId)).toEqual(["c1"]);
    expect(s3.out).toMatchObject({ outcome: "failed" });
  });

  it("★ M-1 a lost final row: running + a held compensation row keeps the flag, the Continue needs person + reason", async () => {
    const e = await denBuoc(def("n2-m", [gate(), move("r1", { compensation: ot("c1") })]));
    runRow(e.runId).status = "running";
    await recordEdgeStepRows(fake as never, e.runId, [
      { stepId: "r1", stepType: "command", status: "running", attempt: 1, startedAt: new Date(), finishedAt: null, error: null, result: undefined },
      { stepId: "c1", stepType: "command", status: "held", attempt: 0, startedAt: null, finishedAt: new Date(), error: "x", result: undefined },
    ]);
    runRow(e.runId).status = "held";
    runRow(e.runId).contextJson = { interrupted: true };
    await expect(approveEdgeGate(e)).rejects.toThrow(/machine-control rights/);
    expect(h.sent).toEqual([]);
  });

  it("★ M-2 a forged report on the end never raises an alert: another claim, a step that is not in the definition", async () => {
    const e = await denBuoc(def("n2-f", [gate(), move("r1")]));
    runRow(e.runId).status = "running";
    const { ganBaoCaoKhongRoEdge } = await import("./foeKetCucKhongRo");
    const d = rows("orchestration_workflows").find((w) => w.id === runRow(e.runId).workflowId)!.definitionJson as WorkflowDefinition;
    const gia = ganBaoCaoKhongRoEdge(
      "x",
      [
        { loai: "held", stepId: "forged", compId: "c", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 2 },
        { loai: "held", stepId: "r1", compId: "-", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 9 },
      ],
      4_000,
    );
    await applyEdgeSegmentEnd(fake as never, e.runId, { outcome: "failed", error: gia, nodeCode: "EDGE-A", claimSeq: 2, def: d });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.alerts).toEqual([]);
  });
});

describe("R1b-2b-2a A2(n) fix round 3 — the edge: S-1, C-B", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown>): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    return e;
  }

  it("★ C-B a container with a retry budget: r1 is not asked again, its reset is NOT sent, held(outcomeUnknown), the row keeps the code", async () => {
    const e = await denBuoc(def("n3-b", [gate(), box("box", [move("r1")], { maxAttempts: 1, compensation: ot("boxUndo") })]));
    h.timeoutDispatch.add("r1");
    e.events = [];
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
    expect(e.authorizeCalls.filter((a) => a.stepId === "r1" && a.claimSeq === 2)).toHaveLength(1);
    expect(String(stepRows(e.runId).find((x) => x.stepId === "r1")!.error)).toMatch(/OUTCOME_UNKNOWN/);
  });

  // write-only: GREEN under mutant S1a, RED under S1b (see the unit file)
  it("S1W edge: a container's non-STOP compensation is not sent", async () => {
    const e = await denBuoc(def("n3-s", [gate(), box("box", [move("r1")], { compensation: ot("boxUndo") })]));
    h.timeoutDispatch.add("r1");
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
  });

  // a re-walk: the deciding branch is gone, only the state central derived says unknown; the container's own branches send its STOP
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown>): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as never;
  const trangThai = (e: EdgeHarness, r: Record<string, unknown>) => void (runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), foeResumeState: r });
  it("★ C-1 on a re-walk: the child held again by the walker, the container's STOP goes", async () => {
    const e = await denBuoc(def("n3-w1", [gate(), box("box", [move("r1", { compensation: ot("c1") })], { compensation: robotStop("bs") })]));
    trangThai(e, { r1: { state: "compensationHeld", error: "EDGE_OUTCOME_UNKNOWN: x", khongRo: true } });
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual(["bs"]);
  });
  it("★ C-A on a re-walk: a gate beside the unknown branch, the container's STOP goes", async () => {
    const e = await denBuoc(def("n3-w2", [gate(), par("p", [move("r1"), gate("g2")], { compensation: robotStop("bs") })]));
    trangThai(e, { r1: { state: "doneFailed", error: "EDGE_OUTCOME_UNKNOWN: x", khongRo: true } });
    const s = await edgeSegment(e, 2);
    expect(s.out).toMatchObject({ outcome: "paused" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["bs"]);
  });
  it("★ C-A on a re-walk: a sibling held for another reason, the container's STOP goes", async () => {
    const e = await denBuoc(def("n3-w3", [gate(), par("p", [move("r1"), move("r2")], { compensation: robotStop("bs") })]));
    trangThai(e, { r1: { state: "doneFailed", error: "EDGE_OUTCOME_UNKNOWN: x", khongRo: true } });
    e.offlineSteps = new Set(["r2"]);
    const s = await edgeSegment(e, 2);
    expect(s.out).toMatchObject({ outcome: "held" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["bs"]);
  });

  it("S-1 edge: a re-walk reads the latch from the resume state: a KNOWN failure of the segment is held, its compensation not sent", async () => {
    const e = await denBuoc(def("n3-r", [gate(), box("box", [move("r1", { compensation: ot("c1") })], { compensation: ot("boxUndo") })]));
    h.timeoutDispatch.add("r1");
    await edgeSegment(e, 2);
    await continueOutcomeUnknown(e, "checked");
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]); // the approved one only
    expect(stepRows(e.runId).find((x) => x.stepId === "boxUndo")).toMatchObject({ status: "held" });
  });
});

describe("R1b-2b-2a A2(n) fix round 4 — the edge: THE fact crosses a segment boundary, THE sink is the same line, /authorize is the second check", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown>): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown>): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    return e;
  }
  const ids = () => h.sent.map((x) => x.stepId);
  const baoCua = (e: EdgeHarness, loai: keyof typeof CANH_BAO_KHONG_RO_KIND) => (e.events ?? []).filter((v) => v.kind === "anomaly" && String(v.detail).includes(`"loai":"${loai}"`));
  const dieuTiep = async (e: EdgeHarness) => {
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    return resumeRun(e.runId, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  };

  it("★ C-C (P1) a compensation's own unknown beside a gate: the row has the code, the gate approval carries the latch, the container's compensation is HELD, a person told", async () => {
    const e = await denBuoc(def("n4-p1", [gate(), par("box", [move("x", { compensation: ot("u") }), gate("g2")], { compensation: ot("boxUndo") })]));
    h.failPlan.set("x", 1);
    h.timeoutDispatch.add("u");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "paused" });
    expect(String(stepRows(e.runId).find((r) => r.stepId === "u")!.error)).toMatch(/^FOE_OUTCOME_UNKNOWN/);
    expect(baoCua(e, "compensationUnknown")).toHaveLength(1); // I-I on the edge
    h.timeoutDispatch.delete("u");
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toBeTruthy();
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(ids()).toEqual(["x", "u"]);
    expect(baoCua(e, "held")).toHaveLength(1);
    expect(stepRows(e.runId).find((r) => r.stepId === "boxUndo")).toMatchObject({ status: "held" });
  });

  it("★ C-C (P2) a STOP-typed step unknown beside a gate; its next answer is known: the container's compensation is HELD", async () => {
    const e = await denBuoc(def("n4-p2", [gate(), par("box", [robotStop("st"), gate("g2")], { compensation: ot("boxUndo") })]));
    h.timeoutDispatch.add("st");
    await edgeSegment(e, 2);
    expect(String(stepRows(e.runId).find((r) => r.stepId === "st")!.error)).toMatch(/OUTCOME_UNKNOWN/);
    h.timeoutDispatch.delete("st");
    h.failPlan.set("st", 1);
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "st" });
    const s3 = await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "boxUndo")).toHaveLength(0);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
  });

  it("★ C-C (P3) the same behind a held sibling and a PLAIN Continue: the compensation is held, a person told; its Continue needs the n3 check", async () => {
    const e = await denBuoc(def("n4-p3", [gate(), par("box", [move("x", { compensation: ot("u") }), move("r2")], { compensation: ot("boxUndo") })]));
    h.failPlan.set("x", 1);
    h.timeoutDispatch.add("u");
    e.offlineSteps = new Set(["r2"]);
    await edgeSegment(e, 2);
    h.timeoutDispatch.delete("u");
    e.offlineSteps = undefined;
    await dieuTiep(e);
    const s3 = await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "boxUndo")).toHaveLength(0);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(baoCua(e, "held").length).toBeGreaterThan(0);
    await expect(dieuTiep(e)).rejects.toThrow(/machine-control rights/); // n3: no plain Continue past this hold
    await continueOutcomeUnknown(e, "checked");
    await edgeSegment(e, 4);
    expect(ids().filter((x) => x === "boxUndo")).toHaveLength(1);
  });

  it("★ C-C the rider of the end is lost: the ROWS alone carry the latch across the hand-back", async () => {
    const e = await denBuoc(def("n4-p1r", [gate(), par("box", [move("x", { compensation: ot("u") }), gate("g2")], { compensation: ot("boxUndo") })]));
    h.failPlan.set("x", 1);
    h.timeoutDispatch.add("u");
    e.stripEndUnknown = true;
    await edgeSegment(e, 2);
    e.stripEndUnknown = false;
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toBeUndefined();
    h.timeoutDispatch.delete("u");
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "u", ma: "FOE_OUTCOME_UNKNOWN" });
    const s3 = await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "boxUndo")).toHaveLength(0);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
  });

  it("★ (b) the fact is on the row at the moment of decision: the segment dies before its end, the rows already say it", async () => {
    const e = await denBuoc(def("n4-b", [gate(), move("x", { compensation: ot("u") })]));
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    const r = s.segment.filter((v: any) => v.kind === "step" && v.stepId === "x");
    const i = r.findIndex((v: any) => /OUTCOME_UNKNOWN/.test(String(v.error)));
    expect(i).toBeGreaterThanOrEqual(0);
    expect((r[i] as any).status).toBe("running"); // the record of the decision, before the failed row
  });

  it("(b) a row of a step already decided keeps the code: a later row with no error does not wipe the fact", async () => {
    const e = await denBuoc(def("n4-b2", [gate(), box("b", [{ ...(robotStop("st") as object), maxAttempts: 2 } as never], {})]));
    h.timeoutDispatch.add("st");
    const s = await edgeSegment(e, 2);
    expect(String(stepRows(e.runId).find((r) => r.stepId === "st")!.error)).toMatch(/OUTCOME_UNKNOWN/);
    const r = s.segment.filter((v: any) => v.kind === "step" && v.stepId === "st") as any[];
    const i = r.findIndex((v) => /OUTCOME_UNKNOWN/.test(String(v.error)));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(r.length - 1); // the later attempt wrote rows after the decision
    for (const v of r.slice(i)) expect(String(v.error)).toMatch(/OUTCOME_UNKNOWN/); // a crash between any two of them leaves the fact on the row
  });

  it("(b) a report on the segment end is the fact even if the rows were lost (full journal): the latch is central's", async () => {
    const e = await denBuoc(def("n4-b3", [gate(), move("x", { compensation: ot("u") })]));
    h.timeoutDispatch.add("x");
    e.refuse = (rec) => rec.kind === "step" && /OUTCOME_UNKNOWN/.test(String((rec as { error?: unknown }).error));
    await edgeSegment(e, 2);
    expect(runRow(e.runId).status).toBe("held");
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toBeTruthy();
  });

  it("★ (b) /authorize is the second check: the walker does not know (its package predates the row), central refuses, the walker holds + reports, nothing sent", async () => {
    const e = await denBuoc(def("n4-a", [gate(), move("x", { compensation: ot("u") })]));
    h.failPlan.set("x", 1);
    const orig = e.authorizeCalls.length;
    // a row with the code reaches central after the claim: the context the walker read says nothing
    fake.store.get("orchestration_run_steps")!.push({ id: 99_001, runId: e.runId, stepId: "zz", stepType: "command", status: "failed", error: "FOE_OUTCOME_UNKNOWN: late row", attempt: 0, resultJson: null, startedAt: null, finishedAt: null });
    const s = await edgeSegment(e, 2);
    expect(e.authorizeCalls.slice(orig).some((a) => a.stepId === "u")).toBe(true);
    expect(ids()).toEqual(["x"]);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(baoCua(e, "held")).toHaveLength(1);
    await continueOutcomeUnknown(e, "checked");
    await edgeSegment(e, 3);
    expect(ids()).toEqual(["x", "u"]); // approved exactly: /authorize lets it through
  });

  it("★ C-D edge (U1): a compensation admitted before the latch is not sent after it; a verified STOP in the body goes + reported", async () => {
    const e = await denBuoc(def("n4-d", [gate(), par("box", [move("b", { compensation: box("uS", [delay("w", 120), ot("rz")], {}) }), move("m")], {})]));
    h.failPlan.set("b", 1);
    h.timeoutDispatch.add("m");
    const s = await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    const e2 = await denBuoc(def("n4-d2", [gate(), par("box", [move("b2", { compensation: box("uS2", [delay("w2", 120), robotStop("rs")], {}) }), move("m2")], {})]));
    h.failPlan.set("b2", 1);
    h.timeoutDispatch.add("m2");
    await edgeSegment(e2, 2);
    expect(ids().filter((x) => x === "rs")).toHaveLength(1);
    expect((e2.events ?? []).filter((v) => /"loai":"stop/.test(String(v.detail)))).toHaveLength(1); // the sink's own report
  });

  it("m-O edge: a verified STOP inside a multi-step compensation goes, the rest is held", async () => {
    const e = await denBuoc(def("n4-o", [gate(), move("r1", { compensation: box("c", [ot("rz"), robotStop("rs")], {}) })]));
    h.timeoutDispatch.add("r1");
    const s = await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
    expect(ids().filter((x) => x === "rs")).toHaveLength(1);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
  });

  it("(a) an OT verified STOP passes the sink by the package's word: sent, never asked, no hold", async () => {
    fake.seed(deviceTags, [
      ...rows("device_tags"),
      { id: 74, adapterId: 501, tagKey: "halt", address: "00001", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true },
    ]);
    const e = await denBuoc(def("n4-otstop", [gate(), move("r1", { compensation: { id: "st", type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true } } as never })]));
    h.timeoutDispatch.add("r1");
    const n = e.authorizeCalls.length;
    const s = await edgeSegment(e, 2);
    expect(ids()).toEqual(["r1", "st"]);
    expect(e.authorizeCalls.slice(n).some((a) => a.stepId === "st")).toBe(false);
    expect(s.out.outcome).toBe("failed");
  });

  it("(a) n6 on the edge: an unlatched compensation asks /authorize and goes as before", async () => {
    const e = await denBuoc(def("n4-n6", [gate(), move("x", { compensation: ot("u") })]));
    h.failPlan.set("x", 1);
    const s = await edgeSegment(e, 2);
    expect(ids()).toEqual(["x", "u"]);
    expect(s.out).toMatchObject({ outcome: "failed" });
  });

  // ── A2(n) extension (owner's ruling): the forward sink. Probes A, B, C of the brief ──
  const khongGui = new RegExp(`^${FOE_NOT_SENT_RUN_LATCHED}: not sent: run latched`);
  const hang = (e: { runId: number }, id: string) => stepRows(e.runId).find((r) => r.stepId === id);
  const parF = (id: string, steps: WorkflowStep[], failFast: boolean, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast, steps, ...extra }) as never;
  const stopTyped = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "speed", value: 0 }, ...extra }) as never;

  it("★ probe A edge: r2 offline held, a PLAIN Continue, the next segment does NOT send r2: failed with the code, the run ends failed", async () => {
    const e = await denBuoc(def("x-a", [gate(), par("box", [move("x", { compensation: ot("u") }), move("r2")], {})]));
    h.failPlan.set("x", 1);
    h.timeoutDispatch.add("u");
    e.offlineSteps = new Set(["r2"]);
    await edgeSegment(e, 2);
    e.offlineSteps = undefined;
    h.timeoutDispatch.delete("u");
    await dieuTiep(e);
    const n = e.authorizeCalls.filter((a) => a.stepId === "r2").length;
    const s3 = await edgeSegment(e, 3);
    expect(ids()).toEqual(["x", "u"]);
    expect(String(hang(e, "r2")!.error)).toMatch(khongGui);
    expect(hang(e, "r2")).toMatchObject({ status: "failed" });
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").length).toBe(n + 1); // one attempt, no retry
    expect(s3.out).toMatchObject({ outcome: "failed" });
  });

  for (const failFast of [true, false]) {
    it(`★ probe B edge, failFast ${failFast}: r3 behind a delay is NOT sent after x went unknown; failed with the code; an edge audit; its authorisation reported unused`, async () => {
      const e = await denBuoc(def(`x-b${failFast}`, [gate(), parF("p", [move("x"), box("b", [delay("w", 80), move("r3")], {})], failFast)]));
      e.unused = [];
      h.timeoutDispatch.add("x");
      const s = await edgeSegment(e, 2);
      expect(ids()).toEqual(["x"]);
      expect(String(hang(e, "r3")!.error)).toMatch(khongGui);
      expect(hang(e, "r3")).toMatchObject({ status: "failed" });
      expect(s.out).toMatchObject({ outcome: "failed" });
      expect(e.authorizeCalls.filter((a) => a.stepId === "r3")).toHaveLength(1);
      expect((e.events ?? []).filter((v) => v.kind === "anomaly" && v.code === "notSentRunLatched")).toHaveLength(1);
      expect(e.unused).toEqual([expect.objectContaining({ stepId: "r3", reason: "run_latched" })]); // (4) — the forward authorisation is superseded too
      expect(e.records.filter((r) => r.kind === "step" && r.stepId === "r3" && r.status === "failed").map((r) => (r as { jti?: unknown }).jti)).toEqual([null]); // a quoted jti is evidence of use
      expect((fake.store.get("edge_step_authorizations") ?? []).find((a) => a.stepId === "r3")!.supersededAt).toBeInstanceOf(Date);
    });
    it(`★ probe B central, failFast ${failFast}: the same one line`, async () => {
      const d = def(`x-bc${failFast}`, [gate(), parF("p", [move("x"), box("b", [delay("w", 80), move("r3")], {})], failFast)]);
      h.timeoutDispatch.add("x");
      const runId = await centralRun(d, 1);
      expect(ids()).toEqual(["x"]);
      expect(String(stepRows(runId).find((r) => r.stepId === "r3")!.error)).toMatch(khongGui);
      expect(runRow(runId).status).toBe("failed");
    });
  }

  it("★ probe C edge: a sequential sibling: r3 refused, r4 behind it is never reached, neither sent", async () => {
    const e = await denBuoc(def("x-c", [gate(), parF("p", [move("x"), box("b", [delay("w", 80), move("r3"), move("r4")], {})], false)]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    expect(String(hang(e, "r3")!.error)).toMatch(khongGui);
    expect(hang(e, "r4")).toBeUndefined();
  });
  it("★ probe C central: the same", async () => {
    h.timeoutDispatch.add("x");
    const runId = await centralRun(def("x-cc", [gate(), parF("p", [move("x"), box("b", [delay("w", 80), move("r3"), move("r4")], {})], false)]), 1);
    expect(ids()).toEqual(["x"]);
    expect(stepRows(runId).some((r) => r.stepId === "r4")).toBe(false);
  });

  it("★ a forward robot stop job after the latch IS sent, central and edge; a forward OT verified STOP IS sent on the edge (stopXacMinh is set at that line)", async () => {
    const e = await denBuoc(def("x-s", [gate(), parF("p", [move("x"), box("b", [delay("w", 60), robotStop("rs")], {})], false)]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x", "rs"]);
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.timeoutDispatch.add("x2");
    await centralRun(def("x-sc", [gate(), parF("p", [move("x2"), box("b", [delay("w", 60), robotStop("rs2")], {})], false)]), 1);
    expect(ids()).toEqual(["x2", "rs2"]);
    h.sent.length = 0;
    fake.seed(deviceTags, [...rows("device_tags"), { id: 75, adapterId: 501, tagKey: "halt", address: "00001", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true }]);
    const e3 = await denBuoc(def("x-so", [gate(), parF("p", [move("x3"), box("b", [delay("w", 60), { id: "st", type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true } } as never], {})], false)]));
    h.timeoutDispatch.add("x3");
    await edgeSegment(e3, 2);
    expect(ids()).toEqual(["x3", "st"]);
  });

  it("★ a forward STOP-typed step that is not verified: not sent, the code; maxAttempts: 3 on a forward step: 0 hand-overs, one authorisation, no a2", async () => {
    const e = await denBuoc(def("x-u", [gate(), parF("p", [move("x"), box("b", [delay("w", 60), stopTyped("st")], {})], false)]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    expect(String(hang(e, "st")!.error)).toMatch(khongGui);
    h.sent.length = 0;
    const e2 = await denBuoc(def("x-m", [gate(), parF("p", [move("x2"), box("b", [delay("w", 60), move("r3", { maxAttempts: 3 })], {})], false)]));
    h.timeoutDispatch.add("x2");
    await edgeSegment(e2, 2);
    expect(ids()).toEqual(["x2"]);
    expect(e2.authorizeCalls.filter((a) => a.stepId === "r3").map((a) => a.attempt)).toEqual([1]);
    expect(hang(e2, "r3")).toMatchObject({ status: "failed", attempt: 1 });
  });

  it("★ a container with a retry budget, whose only failure is the refusal, is not walked again on the edge: one /authorize (central's walk has the resume state too)", async () => {
    const e = await denBuoc(def("x-r", [gate(), parF("p", [box("b", [move("r5")], {})], false, { maxAttempts: 2 })]));
    runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { stepId: "zz", ma: "FOE_OUTCOME_UNKNOWN", at: "t" } };
    await edgeSegment(e, 2);
    expect(ids()).toEqual([]);
    expect(e.authorizeCalls.filter((a) => a.stepId === "r5")).toHaveLength(1);
  });

  it("★ a finding on the edge: a robot STOP unknown once, confirmed next, forward work dropped: a person IS told", async () => {
    const e = await denBuoc(def("x-f", [gate(), { ...(robotStop("st") as object), maxAttempts: 1 } as never, move("r3")]));
    h.timeoutOnce.add("st");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["st", "st"]);
    expect(String(hang(e, "r3")!.error)).toMatch(khongGui);
    expect(baoCua(e, "forwardNotSent")).toHaveLength(1);
  });

  it("★ a refused forward step on a later segment: its compensation is not due (central's derived state: doneFailed), the run is not held for it, nothing is sent", async () => {
    const e = await denBuoc(def("x-g", [gate(), parF("p", [move("x"), gate("g2"), box("b", [delay("w", 60), move("r3", { compensation: ot("c3") })], {})], false)]));
    h.timeoutDispatch.add("x");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "paused" });
    h.timeoutDispatch.delete("x");
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState?.r3).toMatchObject({ state: "doneFailed" });
    const s3 = await edgeSegment(e, 3);
    expect(ids()).toEqual(["x"]);
    expect(s3.out).toMatchObject({ outcome: "failed" });
    expect(hang(e, "c3")).toBeUndefined();
    const d = def("y", [move("a", { compensation: ot("b") })]);
    const r = (stepId: string, error: string) => ({ stepId, status: "failed", resultJson: null, error });
    expect(edgeResumeStateOf(d, [r("a", `${FOE_NOT_SENT_RUN_LATCHED}: not sent`)], new Set()).state.a).toEqual({ state: "doneFailed", error: `${FOE_NOT_SENT_RUN_LATCHED}: not sent` });
    expect(edgeResumeStateOf(d, [r("a", "rejected")], new Set()).state.a).toMatchObject({ state: "compensationHeld" }); // n6
  });

  it("★ the trap on the edge: a STOP-typed step, not verified, whose attempt went unknown: the next attempt is not sent, it stays unknown, never 'not sent'", async () => {
    const e = await denBuoc(def("x-t", [gate(), stopTyped("st", { maxAttempts: 1 })]));
    h.timeoutDispatch.add("st");
    e.unused = [];
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["st"]);
    expect(String(hang(e, "st")!.error)).toMatch(/^FOE_OUTCOME_UNKNOWN/);
    expect(String(hang(e, "st")!.error)).not.toMatch(/not sent: run latched/);
    expect(e.unused.map((u) => [u.stepId, u.attempt])).toEqual([["st", 2]]); // the second authorisation only: the first may have been used
  });
  it("★ the trap on the edge: a row left running by an earlier segment (central does not derive a STOP-typed step): stays unknown, not sent", async () => {
    const e = await denBuoc(def("x-t2", [gate(), parF("p", [move("x"), stopTyped("st")], false)]));
    h.timeoutDispatch.add("x");
    e.offlineSteps = new Set(["st"]);
    await edgeSegment(e, 2);
    e.offlineSteps = undefined;
    Object.assign(hang(e, "st")!, { status: "running", error: null });
    await dieuTiep(e);
    await edgeSegment(e, 3);
    expect(ids()).toEqual(["x"]);
    expect(String(hang(e, "st")!.error)).toMatch(/^FOE_OUTCOME_UNKNOWN/);
  });

  it("★ not stuck on the edge: Continue (n3) sends the compensation only, the forward work is dropped, the run ends failed", async () => {
    const e = await denBuoc(def("x-n", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [delay("w", 60), move("r3")], {})], false)]));
    h.timeoutDispatch.add("x");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    h.timeoutDispatch.delete("x");
    await continueOutcomeUnknown(e, "checked");
    const s3 = await edgeSegment(e, 3);
    expect(ids()).toEqual(["x", "u"]);
    expect(s3.out).toMatchObject({ outcome: "failed" });
    expect(runRow(e.runId).status).toBe("failed");
  });
  it("★ not stuck on the edge: Abort ends the same run, nothing forward", async () => {
    const e = await denBuoc(def("x-na", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [delay("w", 60), move("r3")], {})], false)]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await abortRun(e.runId, OWNER, "checked");
    expect(runRow(e.runId).status).toBe("aborted");
    expect(ids()).toEqual(["x"]);
  });

  // (4) — a compensation authorised before the latch and held at the sink: the authorisation is reported never used
  const autDuocTruocChot = async (ref: string) => {
    const e = await denBuoc(def(ref, [gate(), par("box", [move("b", { compensation: ot("rz") }), move("m")], {})]));
    h.failPlan.set("b", 1);
    h.timeoutDispatch.add("m");
    e.unused = [];
    e.authorizeDelay = new Map([["m", 30], ["rz", 90]]); // rz is admitted and asks before m's outcome is known, and answers after it
    return e;
  };
  it("★ (4) held at the sink after its authorisation: reported unused (run_latched), central supersedes it, no 'an earlier segment sent it'; the Continue sends it once", async () => {
    const e = await autDuocTruocChot("x-4");
    const s = await edgeSegment(e, 2);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
    expect(e.unused).toEqual([expect.objectContaining({ stepId: "rz", reason: "run_latched", attempt: 1 })]);
    expect(new Set(e.records.filter((r) => r.kind === "step" && r.stepId === "rz" && r.status === "held").map((r) => (r as { jti?: unknown }).jti))).toEqual(new Set([null]));
    await continueOutcomeUnknown(e, "checked");
    e.events = [];
    await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "rz")).toHaveLength(1);
    expect(baoCua(e, "compensationUnknown")).toHaveLength(0);
  });
  it("(4) the report failed: central still reads it the safe way (never sent again) and the words say 'may have'", async () => {
    const e = await autDuocTruocChot("x-4b");
    e.unusedFails = true;
    await edgeSegment(e, 2);
    await continueOutcomeUnknown(e, "checked");
    e.events = [];
    await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
    expect(baoCua(e, "compensationUnknown").length).toBeGreaterThan(0);
  });

  // F10 — the report of an unused authorisation is bounded: a stalled journal holds neither the walk nor a STOP behind it
  const trong = (p: Promise<unknown>, ms: number) => Promise.race([p.then(() => "ended"), new Promise((r) => setTimeout(() => r("blocked"), ms))]);
  const tuChoiCoStopBen = (ref: string) => denBuoc(def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 40), move("r3")], { compensation: robotStop("bs") })], false)]));
  it("★ F10 (R3) the report hangs at the sink's refusal: the segment ends and the container's STOP goes", async () => {
    const e = await tuChoiCoStopBen("f10-r3");
    h.timeoutDispatch.add("x");
    e.unusedHangs = true;
    try {
      expect(await trong(edgeSegment(e, 2), 3 * STOP_DB_STEP_DEADLINE_MS), "the segment stood on the report").toBe("ended");
    } finally {
      h.dbThrows = false;
    }
    expect(ids()).toEqual(["x", "bs"]);
  });
  it("F10 (R3b) the report answers false at the sink's refusal: as above, nothing stands", async () => {
    const e = await tuChoiCoStopBen("f10-r3b");
    h.timeoutDispatch.add("x");
    e.unusedFails = true;
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x", "bs"]);
  });
  it("★ F10 the report hangs while held at the sink: the segment ends held, the compensation not sent", async () => {
    const e = await autDuocTruocChot("f10-giu");
    e.unusedHangs = true;
    const seg = edgeSegment(e, 2);
    try {
      expect(await trong(seg, 3 * STOP_DB_STEP_DEADLINE_MS), "the segment stood on the report").toBe("ended");
    } finally {
      h.dbThrows = false;
    }
    expect((await seg).out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
  });
});

/**
 * A2(n) T0 — an injection counts only if it reaches its target: on, the target throws or answers the other way; off, it does not. The targets behind an `import()` are asked by
 * DONG_THOI concurrent callers from one module, the shape that lost a mock to the real module; every question must arrive, in each of VONG rounds. The dispatch's injections sit on
 * a static import (equipmentRegistry): their own cases below and the cases of the sections above prove them.
 */
describe("A2(n) T0 — every injection of this harness reaches its target", () => {
  const VONG = 10;
  const DONG_THOI = 6;
  const dongThoi = <T>(f: (i: number) => Promise<T>) => Promise.all(Array.from({ length: DONG_THOI }, (_, i) => f(i)));
  const mayMap = () => new Map<number, MachineForValidation>(rows("machines").map((m) => [m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities }] as const));
  const rc = () => ({ runId: 1, machineById: mayMap(), user: OWNER }) as never;
  const hoi = (st: WorkflowStep) => dongThoi(() => verifiedStopStepIds(def("t0", [st]), mayMap(), fake as never));

  it("★ classifyOtStop (the verifier): on, the read throws and the STOP is only unsure; off, verified; 6 concurrent questions arrive, 10 rounds", async () => {
    seedHalt();
    for (let v = 0; v < VONG; v++) {
      h.classifyLoi = true;
      h.classifyLan = 0;
      for (const r of await hoi(otStop("st"))) expect(r).toMatchObject({ failed: true, ids: new Set(), unsure: new Set(["st"]) });
      expect(h.classifyLan).toBe(DONG_THOI);
      h.classifyLoi = false;
      h.classifyLan = 0;
      for (const r of await hoi(otStop("st"))) expect(r).toMatchObject({ failed: false, ids: new Set(["st"]) });
      expect(h.classifyLan).toBe(DONG_THOI);
    }
  });

  it("★ h.treGhi (T7b-1c): on, the row is not there until the real timer fires, the write counted; off, it lands at once; 6 concurrent writes, 10 rounds", async () => {
    for (let v = 0; v < VONG; v++) {
      h.treGhiLan = 0;
      for (let i = 0; i < DONG_THOI; i++) h.treGhi.set(`abort:t${v}-${i}`, 5);
      const cho = dongThoi((i) => upsertStep(900, `abort:t${v}-${i}`, "command", { status: "failed" }));
      await Promise.resolve();
      expect(rows("orchestration_run_steps").filter((r) => String(r.stepId).startsWith(`abort:t${v}-`))).toEqual([]);
      await cho;
      expect(rows("orchestration_run_steps").filter((r) => String(r.stepId).startsWith(`abort:t${v}-`)).length).toBe(DONG_THOI);
      expect(h.treGhiLan).toBe(DONG_THOI);
      h.treGhi.clear();
      await dongThoi((i) => upsertStep(900, `abort:n${v}-${i}`, "command", { status: "failed" }));
      expect(h.treGhiLan).toBe(DONG_THOI);
    }
  });

  it("★ h.ctxNem (T7b-1c): on, the one context write it names throws and is counted; off, it lands; 6 concurrent writes, 10 rounds", async () => {
    fake.seed(orchestrationRuns, [{ id: 901, status: "running", contextJson: {} }]);
    const rcCtx = (dau: string) => ({ runId: 901, context: { dau }, telemetry: new Map(), states: new Map() }) as never;
    for (let v = 0; v < VONG; v++) {
      h.ctxNemLan = 0;
      h.ctxNem = (c) => c.dau === "nem";
      await expect(persistContext(rcCtx("nem"))).rejects.toThrow("the context write");
      expect(h.ctxNemLan).toBe(1);
      expect(h.ctxNem).toBeNull();
      await dongThoi(() => persistContext(rcCtx("ok")));
      expect(h.ctxNemLan).toBe(1);
      expect(runRow(901).contextJson.dau).toBe("ok");
    }
  });

  it("★ h.heSoHan (T7b-1d lượt sửa 1): on, a real withDeadline of the code fires at that fraction; off, as written; 6 concurrent, 10 rounds", async () => {
    const { withDeadline } = await import("../../ot/drivers/boundedClose");
    for (let v = 0; v < VONG; v++) {
      h.heSoHan = 0.01;
      const t0 = Date.now();
      await dongThoi(() => expect(withDeadline(new Promise(() => undefined), 1000, "t0")).rejects.toThrow("timeout"));
      expect(Date.now() - t0, "at the fraction").toBeLessThan(500);
      h.heSoHan = 0;
      await expect(Promise.race([withDeadline(new Promise(() => undefined), 1000, "t0"), new Promise((ok) => setTimeout(() => ok("con cho"), 20))])).resolves.toBe("con cho");
    }
  });
  it("★ h.treoNap, h.napTuChoi (T7b-1d lượt sửa 1): the engine's lazy load of the dispatcher reaches them, counted; off, it loads; 6 concurrent, 10 rounds", async () => {
    const { napMotLan } = await import("./foeNapMotLan");
    const lay = napMotLan(() => import("../../ot/commandDispatcher"));
    for (let v = 0; v < VONG; v++) {
      let tha: () => void = () => undefined;
      h.treoNap.set("commandDispatcher", new Promise<void>((ok) => (tha = ok)));
      h.napGoi.clear();
      const cho = Promise.all(Array.from({ length: DONG_THOI }, () => lay()));
      await expect(Promise.race([cho, new Promise((ok) => setTimeout(() => ok("con cho"), 15))])).resolves.toBe("con cho");
      expect(h.napGoi.get("commandDispatcher")).toBe(DONG_THOI);
      tha();
      await cho;
      h.treoNap.clear();
      h.napTuChoi.add("commandDispatcher");
      await expect(lay()).rejects.toThrow("refused");
      h.napTuChoi.clear();
      expect(typeof (await lay()).dispatch).toBe("function");
    }
  });
  it("★ h.treoVerifier, h.treoLaStop (T7b-1d lượt sửa 1): what the code imports reaches them; off, it answers; 10 rounds", async () => {
    const { makeStopVerifier, laStopTheoBuoc, isStopCandidate } = await import("./foeStepClass");
    const conCho = <T,>(p: Promise<T>) => Promise.race([p, new Promise((ok) => setTimeout(() => ok("con cho"), 15))]);
    for (let v = 0; v < VONG; v++) {
      h.treoVerifier = "khong";
      expect(await conCho(makeStopVerifier(null, [], new Map()))).toBe("con cho");
      h.treoVerifier = "co";
      expect(await conCho(makeStopVerifier(fake as never, [], new Map()))).toBe("con cho");
      expect(await conCho(makeStopVerifier(null, [], new Map()))).not.toBe("con cho");
      h.treoVerifier = null;
      h.treoLaStop = () => new Promise<void>(() => undefined);
      expect(await conCho(laStopTheoBuoc(otStop("st"), new Map()))).toBe("con cho");
      expect(await conCho(isStopCandidate(otStop("st"), new Map()))).toBe("con cho");
      h.treoLaStop = null;
      expect(await conCho(laStopTheoBuoc(otStop("st"), new Map()))).not.toBe("con cho");
    }
  });
  it("★ h.khongTraLoi (T7b-1d): on, the dispatch reached the fake and never answers; off, it answers; 6 concurrent hand-overs, 10 rounds", async () => {
    const { equipmentRegistry } = await import("../../equipment/equipmentAdapter");
    const gui = (k: string) => (equipmentRegistry.getAdapter("ot" as never) as any).sendCommand({ idempotencyKey: k, name: "stop" });
    for (let v = 0; v < VONG; v++) {
      h.sent.length = 0;
      h.khongTraLoi.add("treo");
      const treo = await Promise.race([dongThoi((i) => gui(`run1-treo-a${i + 1}`)), new Promise((ok) => setTimeout(() => ok("no answer"), 15))]);
      expect(treo).toBe("no answer");
      expect(h.sent.length, "it reached the fake").toBe(DONG_THOI);
      h.khongTraLoi.clear();
      const dap = await dongThoi((i) => gui(`run1-treo-a${i + 1}`));
      for (const r of dap) expect(r).toMatchObject({ status: "simulated" });
    }
  });

  it("★ h.treAborted (T7b-1c): on, the write of 'aborted' lands only after the real timer, counted, once; off, at once; 10 rounds", async () => {
    for (let v = 0; v < VONG; v++) {
      fake.seed(orchestrationRuns, [{ id: 902, status: "running", contextJson: {} }]);
      h.treAborted = 5;
      h.treAbortedLan = 0;
      let khi = "";
      h.khiTreAborted = () => (khi = String(runRow(902).status));
      const cho = (fake as any).update(orchestrationRuns).set({ status: "aborted" }).where(() => true).returning();
      await Promise.resolve();
      expect(runRow(902).status).toBe("running");
      await cho;
      expect(runRow(902).status).toBe("aborted");
      expect(khi, "the callback runs just before the write lands").toBe("running");
      expect(h.treAbortedLan).toBe(1);
      expect(h.treAborted).toBe(0);
    }
  });

  it("★ h.soCai (T7b-1c): by the dispatchers' rule: OT ok replays, OT simulated / refused / no answer / in flight goes under a new key naming the earlier try, no row goes; robot: only done replays; 10 rounds", async () => {
    const { equipmentRegistry } = await import("../../equipment/equipmentAdapter");
    const gui = (kind: string, k: string) => (equipmentRegistry.getAdapter(kind as never) as any).sendCommand({ idempotencyKey: k, name: "stop" });
    for (let v = 0; v < VONG; v++) {
      h.soCai = new Map();
      h.sent.length = 0;
      await gui("ot", "run1-a-a1");
      expect(h.sent.at(-1)).toMatchObject({ stepId: "a", key: "run1-a-a1" });
      expect(h.sent.at(-1)?.lanTruoc).toBeUndefined();
      const lai = (await gui("ot", "run1-a-a1")) as Row;
      expect(lai.status, "simulated: no replay, as lyDoStopKhoaMoi").toBe("simulated");
      expect(h.sent.at(-1)?.phatLai).toBeUndefined();
      expect((h.sent.at(-1)?.lanTruoc as Row).lyDo).toBe("lan_truoc_khong_ok");
      h.soCai.set("run1-b-a1", { ok: true, simulated: false, status: "acked", kq: { ok: true, status: "acked", routedTo: "ot-dispatcher", detail: {} } });
      await gui("ot", "run1-b-a1");
      expect(h.sent.at(-1)).toMatchObject({ stepId: "b", phatLai: true, khongGhi: true });
      h.soCai.set("run1-c-a1", { ok: false, simulated: false, status: "sent", dangBay: true, kq: {} });
      await gui("ot", "run1-c-a1");
      expect((h.sent.at(-1)?.lanTruoc as Row).lyDo).toBe("dang_bay");
      expect(String(h.sent.at(-1)?.khoaMoi)).toMatch(/^run1-c-a1#stop-/);
      h.soCai.set("run1-d-a1", { ok: true, simulated: false, status: "done", kq: { ok: true, status: "done" } });
      await gui("robot", "run1-d-a1");
      expect(h.sent.at(-1)).toMatchObject({ stepId: "d", phatLai: true });
      h.soCai.set("run1-e-a1", { ok: false, simulated: false, status: "timeout", kq: {} });
      await gui("robot", "run1-e-a1");
      expect(h.sent.at(-1)).toMatchObject({ stepId: "e", khoaMoi: "" });
      h.soCai = null;
    }
  });

  it("★ h.connOk (the running connection): on, the pinned STOP is not verified; off, it is; 6 concurrent questions arrive, 10 rounds", async () => {
    seedHalt();
    for (let v = 0; v < VONG; v++) {
      h.connOk = false;
      h.connLan = 0;
      for (const r of await hoi(otStop("st"))) expect(r).toMatchObject({ ids: new Set(), unsure: new Set(["st"]) });
      expect(h.connLan).toBe(DONG_THOI);
      h.connOk = true;
      h.connLan = 0;
      for (const r of await hoi(otStop("st"))) expect(r).toMatchObject({ ids: new Set(["st"]) });
      expect(h.connLan).toBe(DONG_THOI);
    }
  });

  it("★ h.ghim (phanLoaiStopGhimChoFoe): throws, unreadable, not pinned ⇒ not a pinned STOP; pinned ⇒ one; 6 concurrent questions arrive, 10 rounds", async () => {
    seedHalt();
    const st = otStop("st");
    const lan = async (ghim: typeof h.ghim, ky: "stop" | "khong" | "chuaDoc") => {
      h.ghim = ghim;
      h.ghimLan.length = 0;
      expect(await dongThoi(() => buTruLaStopGhimTrungTam(rc(), st))).toEqual(Array(DONG_THOI).fill(ky));
      expect(h.ghimLan).toEqual(Array(DONG_THOI).fill("stop"));
    };
    for (let v = 0; v < VONG; v++) {
      await lan(async () => {
        throw new Error("pin read down (test)");
      }, "chuaDoc");
      await lan(PIN_BAD, "chuaDoc");
      await lan(null, "khong");
      await lan(PIN_OK, "stop");
    }
  });

  it("★ the alert: 6 concurrent URGENTs of foeKetCucKhongRo all reach the mock, none reaches the real one, 10 rounds", async () => {
    for (let v = 0; v < VONG; v++) {
      h.alerts.length = 0;
      await dongThoi((i) => canhBaoKetCucKhongRo({ loai: "held", runId: 77, stepId: `m${i}`, compId: "c", error: "e", lan: `L${v}`, owner: OWNER.id }));
      expect(h.alerts).toHaveLength(DONG_THOI);
    }
    expect(h.canhBaoThat).toBe(0);
  });

  it("h.alertDurable: the mock's answer through baoBen, off and on, 10 rounds (the engine asks for it from T2 on)", async () => {
    for (let v = 0; v < VONG; v++) {
      const nghe: boolean[] = [];
      h.alertDurable = false;
      await raiseCriticalStopAlert({ baoBen: (b: boolean) => nghe.push(b) } as never);
      h.alertDurable = true;
      await raiseCriticalStopAlert({ baoBen: (b: boolean) => nghe.push(b) } as never);
      expect(nghe).toEqual([false, true]);
    }
  });

  it("h.alertDurable reaches the engine's alert (T2): 6 concurrent calls, off false, on true, 10 rounds", async () => {
    const goi = (v: number, lan: string) => dongThoi((i) => canhBaoKetCucKhongRo({ loai: "held", runId: 78, stepId: `m${i}`, compId: "c", error: "e", lan: `${lan}${v}`, owner: OWNER.id }));
    for (let v = 0; v < VONG; v++) {
      h.alertDurable = false;
      expect(await goi(v, "tat")).toEqual(Array(DONG_THOI).fill(false));
      h.alertDurable = true;
      expect(await goi(v, "bat")).toEqual(Array(DONG_THOI).fill(true));
    }
    expect(h.canhBaoThat).toBe(0);
  });

  it("h.ownershipThrows (edgeCentralCommon, behind an import()): on, 6 concurrent assignments are all refused; off, they all go, 10 rounds", async () => {
    const d = def("t0-o", [move("r1")]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    for (let v = 0; v < VONG; v++) {
      h.ownershipThrows = true;
      for (const r of await dongThoi(() => startRun(d.ref, {}, OWNER, { edgeNodeId: NODE }))) expect(r.ok).toBe(false);
      h.ownershipThrows = false;
      for (const r of await dongThoi(() => startRun(d.ref, {}, OWNER, { edgeNodeId: NODE }))) expect(r.ok).toBe(true);
    }
  });

  it("h.dbThrows: on, getDb throws and counts; off, it answers, and counts nothing, 10 rounds", async () => {
    try {
      for (let v = 0; v < VONG; v++) {
        h.dbThrows = true;
        h.dbCalls = 0;
        await expect(getDb()).rejects.toThrow("no database");
        expect(h.dbCalls).toBe(1);
        h.dbThrows = false;
        expect(await getDb()).toBe(fake);
        expect(h.dbCalls).toBe(1);
      }
    } finally {
      h.dbThrows = false;
    }
  });

  it("h.slow: on, the dispatch answers that much later; off, it does not wait", async () => {
    const CHAM = 120;
    const chay = async (ref: string) => {
      const t = performance.now();
      await centralRun(def(ref, [gate(), ot("m1")]), 1);
      return performance.now() - t;
    };
    for (let v = 0; v < VONG; v++) {
      h.slow.set("m1", CHAM);
      expect(await chay(`t0-s${v}`)).toBeGreaterThanOrEqual(CHAM - 5);
      h.slow.clear();
      expect(await chay(`t0-n${v}`)).toBeLessThan(CHAM);
    }
  });

  it("h.statusThrow (T7): on, the next write of that run status throws, once, whichever of 6 concurrent writes gets there; another status and off: written; 10 rounds", async () => {
    const ID = Array.from({ length: DONG_THOI }, (_, i) => 9_100 + i);
    fake.seed(orchestrationRuns, [...rows("orchestration_runs"), ...ID.map((id) => ({ id, status: "running", contextJson: {} }))]);
    const ghi = (st: string) => dongThoi((i) => Promise.resolve().then(() => fake.update(orchestrationRuns).set({ status: st }).where((r: Row) => r.id === ID[i])).then(() => "ok", () => "nem"));
    for (let v = 0; v < VONG; v++) {
      h.statusThrow = "held";
      h.statusThrowLan = 0;
      expect(await ghi("failed"), "another status is written").toEqual(Array(DONG_THOI).fill("ok"));
      expect((await ghi("held")).filter((x) => x === "nem"), "exactly one write breaks").toHaveLength(1);
      expect(h.statusThrowLan).toBe(1);
      expect(h.statusThrow, "once: it clears itself").toBeNull();
      expect(await ghi("held"), "off: every write goes").toEqual(Array(DONG_THOI).fill("ok"));
      expect(ID.every((id) => runRow(id).status === "held")).toBe(true);
    }
  });

  it("h.hangNem (T7 lượt sửa 1): on, a matching step-row write throws (insert, the upsert's update, an update), the others land; off, every one lands; 6 concurrent, 10 rounds", async () => {
    const ghiMot = (i: number, loi: string, loiSet = loi) =>
      Promise.resolve()
        .then(() => fake.insert(orchestrationRunSteps).values({ runId: 9_200, stepId: `h${i}`, stepType: "command", status: "failed", attempt: 1, error: loi }).onConflictDoUpdate({ target: [], set: { status: "failed", error: loiSet } }))
        .then(() => "ok", () => "nem");
    const capNhat = (i: number, loi: string) => Promise.resolve().then(() => fake.update(orchestrationRunSteps).set({ error: loi }).where((r: Row) => r.stepId === `h${i}`)).then(() => "ok", () => "nem");
    for (let v = 0; v < VONG; v++) {
      h.hangNem = (r) => String(r.error ?? "").startsWith("NEM");
      h.hangNemLan = 0;
      expect(await dongThoi((i) => ghiMot(i, i % 2 ? "NEM x" : "fine"))).toEqual(Array.from({ length: DONG_THOI }, (_, i) => (i % 2 ? "nem" : "ok")));
      expect(await dongThoi((i) => ghiMot(i, "fine", i % 2 ? "fine" : "NEM y")), "the upsert's update is checked too").toEqual(Array.from({ length: DONG_THOI }, (_, i) => (i % 2 ? "ok" : "nem")));
      expect(await dongThoi((i) => capNhat(i, "NEM z"))).toEqual(Array(DONG_THOI).fill("nem"));
      expect(h.hangNemLan).toBe(DONG_THOI * 2);
      h.hangNem = null;
      expect(await dongThoi((i) => ghiMot(i, "NEM w"))).toEqual(Array(DONG_THOI).fill("ok"));
      expect(await dongThoi((i) => capNhat(i, "NEM w"))).toEqual(Array(DONG_THOI).fill("ok"));
    }
  });
  it("h.docNem / h.docNemSauThrow (T7 lượt sửa 1): on, that many reads of the table throw, then they answer; another table answers; armed by h.statusThrow; 6 concurrent, 10 rounds", async () => {
    fake.seed(orchestrationRuns, [...rows("orchestration_runs"), { id: 9_300, status: "running", contextJson: {} }]);
    const doc = () => dongThoi(() => Promise.resolve().then(() => fake.select().from(orchestrationRuns).where((r: Row) => r.id === 9_300)).then(() => "ok", () => "nem"));
    const docKhac = () => dongThoi(() => Promise.resolve().then(() => fake.select().from(orchestrationRunSteps)).then(() => "ok", () => "nem"));
    for (let v = 0; v < VONG; v++) {
      h.docNem = { bang: "orchestration_runs", lan: 2 };
      h.docNemLan = 0;
      expect(await docKhac()).toEqual(Array(DONG_THOI).fill("ok"));
      expect((await doc()).filter((x) => x === "nem")).toHaveLength(2);
      expect(h.docNemLan).toBe(2);
      expect(await doc()).toEqual(Array(DONG_THOI).fill("ok"));
      h.docNem = null;
      h.docNemSauThrow = { bang: "orchestration_runs", lan: 1 };
      expect(await doc(), "not armed before the status write breaks").toEqual(Array(DONG_THOI).fill("ok"));
      h.statusThrow = "held";
      await Promise.resolve().then(() => fake.update(orchestrationRuns).set({ status: "held" }).where((r: Row) => r.id === 9_300)).catch(() => undefined);
      expect(h.docNemSauThrow).toBeNull();
      expect((await doc()).filter((x) => x === "nem")).toHaveLength(1);
      h.docNem = null;
    }
  });
  it("h.alertTreo (T7 lượt sửa 1): on, 6 concurrent raises never answer and never resolve; off, they answer; 10 rounds", async () => {
    for (let v = 0; v < VONG; v++) {
      h.alertTreo = true;
      h.treoLan = 0;
      const nghe: boolean[] = [];
      const ra = await Promise.race([dongThoi(() => raiseCriticalStopAlert({ baoBen: (b: boolean) => nghe.push(b) } as never)).then(() => "xong"), new Promise((r) => setTimeout(() => r("treo"), 30))]);
      expect(ra).toBe("treo");
      expect(h.treoLan).toBe(DONG_THOI);
      expect(nghe).toEqual([]);
      h.alertTreo = false;
      await dongThoi(() => raiseCriticalStopAlert({ baoBen: (b: boolean) => nghe.push(b) } as never));
      expect(nghe).toEqual(Array(DONG_THOI).fill(true));
    }
  });

  it("h.acked: on, the dispatch answers acked; off, simulated", async () => {
    const chay = async (ref: string) => {
      const c = await centralRun(def(ref, [gate(), ot("m1")]), 1);
      return (stepRows(c).find((r) => r.stepId === "m1")!.resultJson as Row).status;
    };
    h.acked = true;
    expect(await chay("t0-a")).toBe("acked");
    h.acked = false;
    expect(await chay("t0-b")).toBe("simulated");
  });
});

/**
 * A2(n) T0 — the disk lot's round C (a consumeAuthorization past its bound turns a `failed` segment into held(journalFull)) stops at the latch. On a latched run held(journalFull) has no
 * KET_CUC_KHONG_RO mark, so the Continue would ask no person and no reason (resumeRun, M-4). A latched segment ends as the latched path ends it. An unlatched one keeps round C:
 * these cases and robotEdgeDiskStall.a2n.test.ts.
 */
describe("A2(n) T0 — h.ghimThat (T6e) reaches its target", () => {
  it("★ h.ghimThat (phanLoaiStopGhimChoFoe, the REAL predicate over device_tags): on, a pin read answers by the rows and h.ghim is not asked; off, h.ghim answers; 6 concurrent questions arrive, 10 rounds", async () => {
    seedHalt();
    const hoi = () => Promise.all(Array.from({ length: 6 }, () => phanLoaiStopGhimChoFoe(fake as never, { adapterId: 501, commandType: "stop", writes: [{ tagKey: "halt", value: true }] })));
    let goiGhim = 0;
    for (let v = 0; v < 10; v++) {
      h.ghim = async () => (goiGhim++, { pinnedStop: false, loiDocGhim: null });
      h.ghimThat = true;
      h.ghimLan.length = 0;
      goiGhim = 0;
      for (const r of await hoi()) expect(r).toEqual({ pinnedStop: true, loiDocGhim: null });
      expect(h.ghimLan).toHaveLength(6);
      expect(goiGhim).toBe(0);
      h.ghimThat = false;
      h.ghimLan.length = 0;
      for (const r of await hoi()) expect(r).toEqual({ pinnedStop: false, loiDocGhim: null });
      expect(goiGhim).toBe(6);
    }
  });
});

describe("A2(n) T0 — the disk lot's round C applies only to a segment not latched", () => {
  const parF = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: false, steps, ...extra }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    return e;
  }
  const ctxCua = (e: EdgeHarness) => runRow(e.runId).contextJson as Record<string, unknown>;
  const dieuTiepTran = async (e: EdgeHarness) => {
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    return resumeRun(e.runId, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  };

  it("★ C-KHOA failed: x unknown, m2's consume past its bound: the segment ends as without the overrun, not held(journalFull); the code stays on the rows; no Continue past it", async () => {
    const e = await denBuoc(def("c-khoa", [gate(), parF("p", [move("x"), move("m2")])]));
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    h.consumeQuaHan.add("m2");
    const { out } = await edgeSegment(e, 2);
    expect.soft(out).toMatchObject({ outcome: "failed" });
    expect.soft(out.heldReason).toBeUndefined();
    expect.soft(runRow(e.runId).status).toBe("failed");
    expect.soft(EDGE_HELD_CTX_KEY in ctxCua(e)).toBe(false);
    expect.soft(chotTuHang(stepRows(e.runId) as never)).not.toBeNull();
    grantMachineControl();
    const tiep = await dieuTiepTran(e).catch((err: Error) => ({ ok: false, message: err.message }));
    expect.soft(tiep.ok, "a Continue with no person's reason went through").toBe(false);
    expect.soft(h.sent.map((x) => x.stepId).sort()).toEqual(["m2", "x"]);
  });

  it("đối chứng C-KHOA: the same run with an ordinary refusal of m2 ends the same way", async () => {
    const e = await denBuoc(def("c-khoa-dc", [gate(), parF("p", [move("x"), move("m2")])]));
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    h.failPlan.set("m2", 1);
    const { out } = await edgeSegment(e, 2);
    expect(out).toMatchObject({ outcome: "failed" });
    expect(runRow(e.runId).status).toBe("failed");
  });

  it("★ C-KHOA held: a compensation held for x, m2's consume past its bound: held(outcomeUnknown), the mark stands, the Continue asks a person and a reason", async () => {
    const e = await denBuoc(def("c-khoa-h", [gate(), parF("p", [move("x", { compensation: ot("u") }), move("m2")])]));
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    h.consumeQuaHan.add("m2");
    const { out } = await edgeSegment(e, 2);
    expect(out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(runRow(e.runId).status).toBe("held");
    expect(KET_CUC_KHONG_RO_CTX_KEY in ctxCua(e)).toBe(true);
    await expect(dieuTiepTran(e)).rejects.toThrow(/machine-control|reason/);
    await expect(continueOutcomeUnknown(e, "")).rejects.toThrow(/reason/);
    expect((await continueOutcomeUnknown(e, "checked on site")).ok).toBe(true);
  });

  it("★ C-KHOA next segment: latched by an earlier segment (central's context), the approved compensation's consume past its bound: failed, not held(journalFull)", async () => {
    const e = await denBuoc(def("c-khoa-s", [gate(), move("x", { compensation: ot("u") })]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(runRow(e.runId).status).toBe("held");
    await continueOutcomeUnknown(e, "checked on site");
    h.consumeQuaHan.add("u");
    const { out } = await edgeSegment(e, 3);
    expect.soft(out).toMatchObject({ outcome: "failed" });
    expect.soft(runRow(e.runId).status).toBe("failed");
    expect.soft(EDGE_HELD_CTX_KEY in ctxCua(e)).toBe(false);
  });

  it("đối chứng C: a segment not latched keeps held(journalFull) and the disk lot's mark", async () => {
    const e = await denBuoc(def("c-tu-do", [gate(), move("m2")]));
    h.consumeQuaHan.add("m2");
    const { out } = await edgeSegment(e, 2);
    expect(out).toMatchObject({ outcome: "held", heldReason: "journalFull" });
    expect(String(out.error)).toContain("EDGE_HELD(journalFull)");
    expect(runRow(e.runId).status).toBe("held");
    expect(ctxCua(e)[EDGE_HELD_CTX_KEY]).toBe("journalFull");
    expect(KET_CUC_KHONG_RO_CTX_KEY in ctxCua(e)).toBe(false);
  });
});

/**
 * A2(n) T3+T4 — one gate: after the latch nothing goes forward, a due STOP goes now, and it never waits for a slow sibling. Case names carry the plan's codes (section 17). Every
 * case passes through the afterEach below: a command that reached the fake after the first `timeout` answer must be a STOP (or what a person approved, h.duocSauKhoa).
 */
describe("A2(n) T3+T4 — the door, the planner, the STOP passes", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: false, steps, ...extra }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const brn = (id: string, thenS: WorkflowStep[], elseS: WorkflowStep[] = []): WorkflowStep => ({ id, type: "branch", condition: { source: "telemetry", machineId: 2, key: "temp", op: "lt", value: 100 }, then: thenS, else: elseS }) as never;
  /** stop-typed on a tag with no pin: not a STOP (R-5-j) */
  const stopTyped = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "run", value: 0 }, ...extra }) as never;
  const ids = () => h.sent.map((x) => x.stepId as string);
  const hang = (runId: number, id: string) => stepRows(runId).find((r) => r.stepId === id);
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const authCua = (e: EdgeHarness, id: string) => e.authorizeCalls.filter((a) => a.stepId === id).length;
  const hangUyQuyen = (id: string) => (fake.store.get("ai_pending_actions") ?? []).filter((a) => String(a.id).includes(`-${id}-`)).length;
  const khongGui = new RegExp(`^${FOE_NOT_SENT_RUN_LATCHED}: `);
  const auditKhongGui = () => vi.mocked(logCrudOperation).mock.calls.filter((c) => (c[1] as { details?: { operation?: string } }).details?.operation === "notSentRunLatched");
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    return e;
  }
  /** approve the gate and leave the walk running: a sibling is hanging, the case looks at what went meanwhile */
  async function diKhongCho(d: WorkflowDefinition) {
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const view = (await getRun(s.runId!, { bindingDigest: true }))!;
    const di = resumeRun(s.runId!, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    return { runId: s.runId!, di };
  }
  /** `xong` must come true within `ms` of now, while the walk is still out; the walk is awaited either way (an edge walk leaves the database throwing until it returns) */
  async function trongLuc(di: Promise<unknown>, xong: () => boolean, label: string, ms: number) {
    await Promise.allSettled([waitFor(xong, label, ms).then(() => (daDen = true)), di]);
    expect(daDen, `not in time: ${label}`).toBe(true);
    daDen = false;
  }
  let daDen = false;
  /** the rows a crash leaves on a latched run: the latch in the context, nothing told. `sua` changes the world before the boot */
  function chet(runId: number, keep: string[], sua?: () => void) {
    process.env.FOE_DURABLE = "true";
    const chot = runRow(runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY];
    expect(chot).toBeTruthy();
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== runId || keep.includes(r.stepId)));
    const latched = stepRows(runId).find((r) => r.stepId === chot.stepId);
    if (latched) Object.assign(latched, { status: "running", error: null, finishedAt: null });
    Object.assign(runRow(runId), { status: "held", finishedAt: null, error: null, contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: chot, interrupted: true } });
    sua?.();
    h.sent.length = 0;
    h.alerts.length = 0;
    h.traTimeout = 1;
  }

  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  const BANG: string[] = [];
  beforeEach(() => vi.mocked(logCrudOperation).mockClear());
  afterEach(() => {
    delete process.env.FOE_DURABLE;
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    BANG.push(`${String(expect.getState().currentTestName).split(" > ").pop()?.slice(0, 70)} | ${sau.map((x) => `${String(x.stepId)}:${String(x.name)}`).join(" ") || "-"}`);
    // by the PIN, not by the command's name: an OT `stop` counts only when every write it carries is a pin of its adapter; a robot's `abort` is the robot rule
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return x.name === "abort";
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    const la = sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)) && !h.duocSauKhoa.has(String(x.stepId)));
    expect(la.map((x) => x.stepId), "a command that is no pinned STOP reached the dispatcher after the latch").toEqual([]);
  });
  afterAll(() => {
    for (const l of BANG) console.log(`[PROBE sau-khoa] ${l}`);
  });

  // ── the door ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const nong = { precondition: { source: "telemetry", machineId: 2, key: "temp", op: "lt", value: 100 } };
  const hot = () => (h.telemetry = [{ key: "temp", value: 150 }]);
  for (const mode of ["hold", "skip", "abort"] as const) {
    it(`C1 precondition ${mode} after a crash: not read again, x stays unknown, its STOP compensation goes, URGENT`, async () => {
      h.timeoutDispatch.add("x");
      const c = await centralRun(def(`c1-${mode}`, [gate(), move("x", { ...nong, onPreconditionFail: mode, compensation: robotStop("rs") })]), 1);
      chet(c, ["g1", "x"], hot);
      await autoResumeInterruptedRuns([c]);
      await waitFor(() => ids().includes("rs"), "the STOP compensation");
      expect(ids()).toEqual(["rs"]);
      expect(hang(c, "x")).toMatchObject({ status: "failed" });
      expect(String(hang(c, "x")!.error)).toMatch(/OUTCOME_UNKNOWN/);
      expect(h.alerts.length).toBeGreaterThan(0);
      expect(runRow(c).status).toBe("failed");
    });
  }
  it("C1 the precondition of the container around x: not read again, x stays unknown", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c1-box", [gate(), box("b", [move("x")], { ...nong, onPreconditionFail: "hold", compensation: robotStop("rs") })]), 1);
    chet(c, ["g1", "b", "x"], hot);
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("rs"), "the STOP compensation");
    expect(hang(c, "b")?.status).not.toBe("held");
    expect(String(hang(c, "x")!.error)).toMatch(/OUTCOME_UNKNOWN/);
  });
  it("C2 a gate approval that no longer counts at a boot: no FOE_GATE_REQUIRED, the STOP goes, URGENT", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c2", [gate(), move("x", { compensation: robotStop("rs") })]), 1);
    chet(c, ["g1", "x"], () => {
      const g = hang(c, "g1")!;
      g.resultJson = { ...g.resultJson, defHash: "stale" };
    });
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("rs"), "the STOP compensation");
    expect(stepRows(c).filter((r) => String(r.error ?? "").includes(FOE_GATE_REQUIRED))).toEqual([]);
    expect(String(hang(c, "x")!.error)).toMatch(/OUTCOME_UNKNOWN/);
    expect(h.alerts.length).toBeGreaterThan(0);
  });
  it("C3 central: a forward step reached after the latch: 0 hand-overs, no authorisation row, NOT_SENT, an audit row", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c3", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), ot("r3")])])]), 1);
    expect(ids()).toEqual(["x"]);
    expect(hangUyQuyen("r3")).toBe(0);
    expect(String(hang(c, "r3")!.error)).toMatch(khongGui);
    expect(hang(c, "r3")).toMatchObject({ status: "failed" });
    await waitFor(() => auditKhongGui().length === 1, "the audit row");
    expect(runRow(c).status).not.toBe("completed");
  });
  it("C3 edge: the same, 0 /authorize", async () => {
    const e = await denBuoc(def("c3e", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), ot("r3")])])]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    expect(authCua(e, "r3")).toBe(0);
    expect(String(hang(e.runId, "r3")!.error)).toMatch(khongGui);
    expect((e.events ?? []).filter((v) => v.kind === "anomaly" && v.code === "notSentRunLatched")).toHaveLength(1);
  });
  it("C3b a step with a device's own error from an earlier walk, at the door: not sent, its row keeps the error (F12-9)", async () => {
    h.timeoutDispatch.add("x");
    h.failPlan.set("y", 1);
    const c = await centralRun(def("c3b", [gate(), parF("p", [move("x", { compensation: ot("u") }), move("y")])]), 1);
    chet(c, ["g1", "x", "y"], () => Object.assign(hang(c, "y")!, { status: "failed", error: "device said no" }));
    await autoResumeInterruptedRuns([c]);
    await wait(30);
    expect(String(hang(c, "y")!.error)).toBe("device said no");
  });
  it("C3b a container with its last word from an earlier walk: not walked again, its row keeps it", async () => {
    h.timeoutDispatch.add("x");
    h.failPlan.set("y", 1);
    const c = await centralRun(def("c3d", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [move("y")])])]), 1);
    chet(c, ["g1", "p", "x", "b", "y"], () => {
      Object.assign(hang(c, "y")!, { status: "failed", error: "device said no" });
      Object.assign(hang(c, "b")!, { status: "failed", error: "device said no" });
    });
    await autoResumeInterruptedRuns([c]);
    await wait(30);
    expect(String(hang(c, "b")!.error)).toBe("device said no");
  });
  it("C4 central: a command past the door when the latch falls: the sink keeps it, 0 hand-overs, its own STOP compensation goes (F11)", async () => {
    h.ghim = async (_d, i) => {
      if (i.commandType === "start") await wait(80);
      return { pinnedStop: false, loiDocGhim: null };
    };
    h.slow.set("x", 20);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c4", [gate(), parF("p", [move("x"), ot("m2", { compensation: robotStop("cs") })])]), 1);
    await waitFor(() => ids().includes("cs"), "the refused step's STOP");
    expect(ids().filter((x) => x === "m2")).toEqual([]);
    expect(String(hang(c, "m2")!.error)).toMatch(khongGui);
  });
  it("C4 edge: the same, /authorize asked before the latch, the answer comes after it", async () => {
    const e = await denBuoc(def("c4e", [gate(), parF("p", [move("x"), move("m2", { compensation: robotStop("cs") })])]));
    e.authorizeDelay = new Map([["m2", 80]]);
    h.slow.set("x", 20);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await waitFor(() => ids().includes("cs"), "the refused step's STOP");
    expect(ids().filter((x) => x === "m2")).toEqual([]);
    expect(authCua(e, "m2")).toBe(1);
  });
  it("C5 a container with maxAttempts, latched while its child fails: not walked again, one attempt", async () => {
    const e = await denBuoc(def("c5e", [gate(), parF("p", [move("x"), box("b", [move("f")], { maxAttempts: 2 })])]));
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    h.slow.set("f", 50);
    h.failPlan.set("f", 1);
    await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "f")).toEqual(["f"]);
    expect(authCua(e, "f")).toBe(1);
    expect(hang(e.runId, "b")).toMatchObject({ status: "failed", attempt: 1 });
  });
  it("C6 central: a STOP behind a long delay goes from the planner, once; the walker reaching it later does not enter", async () => {
    const { runId: c, di } = await diKhongCho(def("c6", [gate(), parF("p", [move("x"), box("b", [delay("w", 250), robotStop("s")])])]));
    h.timeoutDispatch.add("x");
    await trongLuc(di, () => ids().includes("s"), "the STOP", 150);
    expect(ids().filter((x) => x === "s")).toEqual(["s"]);
    expect((centralWrites.get(c) ?? []).filter((w) => w.stepId === "s" && w.status === "running" && w.result === "-")).toHaveLength(1);
  });
  it("C6 edge: the same", async () => {
    const e = await denBuoc(def("c6e", [gate(), parF("p", [move("x"), box("b", [delay("w", 250), robotStop("s")])])]));
    h.timeoutDispatch.add("x");
    const seg = edgeSegment(e, 2);
    await trongLuc(seg, () => ids().includes("s"), "the STOP", 150);
    expect(ids().filter((x) => x === "s")).toEqual(["s"]);
    expect(e.records.filter((r: any) => r.kind === "step" && r.stepId === "s" && r.status === "running" && r.result == null)).toHaveLength(1);
  });
  it("C6b central: a STOP in authorizeCommand when the latch falls, walker and planner both at the sink: 1 hand-over", async () => {
    seedHalt();
    h.ghim = async (_d, i) => {
      if (i.commandType === "stop") await wait(70);
      return PIN_OK(_d, i);
    };
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("st", 60);
    const c = await centralRun(def("c6b", [gate(), parF("p", [move("x"), otStop("st")])]), 1);
    await wait(120);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
  });
  it("C6b edge: a verified STOP between its running row and the sink when the latch falls: 1 hand-over", async () => {
    seedHalt();
    const e = await denBuoc(def("c6be", [gate(), parF("p", [move("x"), otStop("st")])]));
    e.journalDelay = new Map([["st", 60]]);
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("st", 120);
    await edgeSegment(e, 2);
    await wait(60);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("C7 central: a Continue on a run held before this code, a STOP never tried: it goes, not after the non-STOP compensation", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c7", [gate(), move("x", { compensation: ot("u") }), robotStop("s")]), 1);
    expect(runRow(c).status).toBe("held");
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== c || r.stepId !== "s"));
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await waitFor(() => ids().includes("s"), "the STOP");
    await waitFor(() => ids().includes("u"), "the approved compensation");
    expect(ids()).toEqual(["s", "u"]);
  });
  it("C7 edge: the same", async () => {
    const e = await denBuoc(def("c7e", [gate(), move("x", { compensation: ot("u") }), robotStop("s")]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(runRow(e.runId).status).toBe("held");
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== e.runId || r.stepId !== "s"));
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown(e, "checked on site");
    await edgeSegment(e, 3);
    expect(ids()).toEqual(["s", "u"]);
  });

  // ── the sweep ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const sauThuBai = (st: WorkflowStep) => parF("p", [move("x"), box("b", [move("f"), st])]);
  it("B1 central, robot: a STOP in a container that failed before the latch goes", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    await centralRun(def("b1", [gate(), sauThuBai(robotStop("st"))]), 1);
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("B1 central, OT pinned: the same", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    await centralRun(def("b1o", [gate(), sauThuBai(otStop("st"))]), 1);
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("B1 edge: the same", async () => {
    seedHalt();
    const e = await denBuoc(def("b1e", [gate(), sauThuBai(otStop("st"))]));
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(e.authorizeCalls.filter((a) => a.stepId === "st")).toHaveLength(0);
  });
  it("B2 central: the sweep's verifier cannot tell (connection unconfirmed), the dispatch sees a pinned STOP: handed to the dispatcher", async () => {
    seedHalt();
    h.connOk = false;
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    await centralRun(def("b2", [gate(), parF("p", [move("x"), box("b", [delay("w", 200), otStop("st")])])]), 1);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("B3 an unverified compensation the split reads as not a STOP: held, not sent", async () => {
    seedHalt();
    h.connOk = false;
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("b3", [gate(), box("b", [move("x")], { compensation: otStop("cs") })]), 1);
    await wait(40);
    expect(ids()).toEqual(["x"]);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "cs")).toMatchObject({ status: "held" });
    expect(hangUyQuyen("cs")).toBe(0); // the split's own predicate stopped it: it never went as far as an authorisation
  });
  it("B4 central: a branch never evaluated: its STOPs are NOT sent, each is named in an URGENT (M1)", async () => {
    h.timeoutDispatch.add("x");
    h.telemetry = [{ key: "temp", value: 150 }];
    await centralRun(def("b4", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), brn("br", [robotStop("sThen"), move("mThen")], [robotStop("sElse")])])])]), 1);
    await wait(30);
    expect(ids()).toEqual(["x"]);
    const chu = h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.stopUntakenBranch).map((a) => `${a.title} ${a.message}`).join(" ");
    expect(chu).toContain('"sThen"');
    expect(chu).toContain('"sElse"');
  });
  it("B4 edge: the same, the anomaly names them", async () => {
    const e = await denBuoc(def("b4e", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), brn("br", [robotStop("sThen"), move("mThen")], [robotStop("sElse")])])])]));
    h.timeoutDispatch.add("x");
    h.telemetry = [{ key: "temp", value: 150 }];
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    const bao = (e.events ?? []).filter((v) => v.kind === "anomaly" && String(v.detail).includes('"loai":"stopUntakenBranch"')).map((v) => String(v.detail)).join(" ");
    expect(bao).toContain('"stepId":"sThen"');
    expect(bao).toContain('"stepId":"sElse"');
  });
  it("B5 central: stop-typed, read, not pinned, reached the door: not sent, no authorisation row, its row says so", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("b5", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), stopTyped("nt")])])]), 1);
    expect(ids()).toEqual(["x"]);
    expect(hangUyQuyen("nt")).toBe(0);
    expect(String(hang(c, "nt")!.error)).toMatch(khongGui);
  });
  it("B5 edge: the same, 0 /authorize", async () => {
    const e = await denBuoc(def("b5e", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), stopTyped("nt")])])]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    expect(authCua(e, "nt")).toBe(0);
    expect(String(hang(e.runId, "nt")!.error)).toMatch(khongGui);
  });
  it("B6 a run that only ever sent a STOP: a latched walk has no 'not needed', the next STOP goes", async () => {
    h.timeoutDispatch.add("s1");
    await centralRun(def("b6", [gate(), { ...(robotStop("s1") as object), maxAttempts: 0 } as never, delay("w", 5), robotStop("s2")]), 1);
    await waitFor(() => ids().includes("s2"), "the next STOP");
    expect(ids().filter((x) => x === "s2")).toEqual(["s2"]);
  });
  it("B7 central: a sibling that did not fail keeps its STOP compensation: not sent", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    await centralRun(def("b7", [gate(), parF("p", [move("ok", { compensation: robotStop("cs") }), move("x")])]), 1);
    await wait(30);
    expect(ids().sort()).toEqual(["ok", "x"]);
  });
  it("B7 edge: the same", async () => {
    const e = await denBuoc(def("b7e", [gate(), parF("p", [move("ok", { compensation: robotStop("cs") }), move("x")])]));
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids().sort()).toEqual(["ok", "x"]);
  });
  it("B8 central: a sibling hangs: the STOP goes while it is in flight", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("m", 300);
    const { di } = await diKhongCho(def("b8", [gate(), parF("p", [move("x"), box("b", [move("m"), robotStop("st")])])]));
    await trongLuc(di, () => ids().includes("st"), "the STOP", 150);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("B8 edge: the same", async () => {
    const e = await denBuoc(def("b8e", [gate(), parF("p", [move("x"), box("b", [move("m"), robotStop("st")])])]));
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("m", 300);
    const seg = edgeSegment(e, 2);
    await trongLuc(seg, () => ids().includes("st"), "the STOP", 150);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("B9 + F12-37 a compensation walking its own body: its STOP goes once, no second URGENT, the plan never sends it", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    const c = await centralRun(def("b9", [gate(), parF("p", [move("x"), move("f", { compensation: box("cb", [delay("w", 60), robotStop("cs")]) })])]), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect((centralWrites.get(c) ?? []).filter((w) => w.stepId === "cs" && w.status === "running" && w.result === "-"), "the plan walked it a second time").toHaveLength(1);
  });
  const thanHong = (ref: string) => def(ref, [gate(), parF("p", [move("x"), move("f", { compensation: box("cb", [move("q"), robotStop("cs")]) })])]);
  it("B9-truoc a body whose step failed before the latch: the pinned STOP behind that step goes, once, on the latched run", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    h.failPlan.set("q", 1);
    await centralRun(thanHong("b9t"), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("B9-sau the same, the body's step fails after the latch", async () => {
    h.slow.set("x", 20);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    h.failPlan.set("q", 1);
    h.slow.set("q", 60);
    await centralRun(thanHong("b9s"), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  const dinhThan = (ref: string, cac: WorkflowStep[]) => def(ref, [gate(), move("f", { compensation: box("cb", cac) })]);
  it("THAN-KR central: a body's command goes unknown, the STOP behind it goes; the non-STOP step between stays", async () => {
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan("thankr", [move("q"), move("z"), robotStop("cs")]), 1);
    await waitFor(() => ids().includes("cs"), "the STOP behind the body's step");
    expect(ids()).toEqual(["f", "q", "cs"]);
    expect(hang(c, "z")).toBeUndefined();
  });
  it("THAN-KR edge: the same", async () => {
    const e = await denBuoc(dinhThan("thankre", [move("q"), move("z"), robotStop("cs")]));
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["f", "q", "cs"]);
    expect(authCua(e, "z")).toBe(0);
  });
  it("đối chứng O4: a body's step fails known on a run NOT latched: nothing changes, the STOP behind it stays unsent", async () => {
    h.failPlan.set("f", 1);
    h.failPlan.set("q", 1);
    const c = await centralRun(dinhThan("than-o4", [move("q"), robotStop("cs")]), 1);
    await wait(20);
    expect(ids()).toEqual(["f", "q"]);
    expect(hang(c, "cs")).toBeUndefined();
    expect(h.alerts).toEqual([]);
  });
  it("THAN-2-THU-TU a Continue's body and a pass reach one STOP: the pass first, the body takes its answer, one hand-over", async () => {
    seedHalt();
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("than2", [gate(), box("b", [move("x")], { compensation: box("cb", [ot("u"), delay("w", 40), otStop("cs")]) })]), 1);
    expect(runRow(c).status).toBe("held");
    expect(ids()).toEqual(["x"]);
    h.ghim = PIN_OK;
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(ids()).toContain("u");
  });
  it("THAN-TUCHOI a body's STOP refused by its dispatcher: a row with the failure, an URGENT naming it; never no row and nobody told", async () => {
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    h.failPlan.set("cs", Infinity);
    const c = await centralRun(dinhThan("thantc", [move("q"), robotStop("cs")]), 1);
    await waitFor(() => ids().includes("cs"), "the STOP");
    await wait(20);
    expect(hang(c, "cs")).toMatchObject({ status: "failed" });
    expect(h.alerts.filter((a) => String(a.message).includes('"cs"')).length).toBeGreaterThan(0);
  });
  it("THAN-TUCHOI-T5 the same: the refused STOP is owed: the row carries the mark, the run is held, Abort sends it (state C)", async () => {
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    h.failPlan.set("cs", Infinity);
    const c = await centralRun(dinhThan("thant5", [move("q"), robotStop("cs")]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
  });
  const hoiTreo = (ref: string, comp: WorkflowStep) => def(ref, [gate(), parF("p", [move("x"), move("hang"), box("b", [delay("w", 30), move("r3", { compensation: comp })])])]);
  it("B10 + F12-38 central: a step stopped at the door, its own STOP compensation goes while a sibling hangs", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 400);
    const { runId: c, di } = await diKhongCho(hoiTreo("b10", robotStop("cs")));
    await trongLuc(di, () => ids().includes("cs"), "the refused step's STOP", 200);
    expect(ids()).not.toContain("r3");
    expect(String(hang(c, "r3")!.error)).toMatch(khongGui);
  });
  it("B10 edge: the same", async () => {
    const e = await denBuoc(hoiTreo("b10e", robotStop("cs")));
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 400);
    const seg = edgeSegment(e, 2);
    await trongLuc(seg, () => ids().includes("cs"), "the refused step's STOP", 200);
    expect(ids()).not.toContain("r3");
    expect(authCua(e, "r3")).toBe(0);
  });
  it("B13 a STOP compensation behind a slow STOP: not chained, it goes before the slow one answers", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("c1", 400);
    const { runId: c, di } = await diKhongCho(def("b13", [gate(), parF("p", [move("x"), box("a", [delay("wa", 20), move("r3", { compensation: robotStop("c1") })]), box("b", [delay("wb", 40), move("r4", { compensation: robotStop("c2") })])])]));
    await trongLuc(di, () => ids().includes("c2"), "the second STOP", 200);
    expect(ids().sort()).toEqual(["c1", "c2", "x"]);
    expect(hang(c, "c1"), "the walk ended before its STOP answered").toMatchObject({ status: "compensated" });
  });
  it("B13 two forward STOPs of one pass: the slow one holds no other", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("s1", 400);
    const { di } = await diKhongCho(def("b13p", [gate(), box("b", [move("x"), robotStop("s1"), robotStop("s2")])]));
    await trongLuc(di, () => ids().includes("s2"), "the second STOP", 200);
  });
  it("B14 central: B10 with a container compensation: its STOP goes while a sibling hangs", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 400);
    const { di } = await diKhongCho(hoiTreo("b14", box("cb", [robotStop("cs")])));
    await trongLuc(di, () => ids().includes("cs"), "the STOP inside the compensation", 200);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("B14 edge: the same", async () => {
    const e = await denBuoc(hoiTreo("b14e", box("cb", [robotStop("cs")])));
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 400);
    const seg = edgeSegment(e, 2);
    await trongLuc(seg, () => ids().includes("cs"), "the STOP inside the compensation", 200);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("F12-20 a verified STOP that failed on this very walk: not sent again, it had its attempts", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("st", 1);
    const c = await centralRun(def("f12-20", [gate(), parF("p", [move("x"), { ...(robotStop("st") as object), maxAttempts: 0 } as never])]), 1);
    await wait(30);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "failed" });
  });
  it("F12-40 a refused step's non-STOP compensation: not due, no row", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("f12-40", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: ot("u") })])])]), 1);
    await wait(20);
    expect(ids()).toEqual(["x"]);
    expect(hang(c, "u")).toBeUndefined();
  });

  // ── asking again, one hand-over ────────────────────────────────────────────────────────────────────────────────────
  const dinhComp = (ref: string, comp: WorkflowStep) => def(ref, [gate(), parF("p", [move("x"), ot("f", { compensation: comp })])]);
  /** the pin read of a STOP takes 80 ms; the first one fails, the ones after it read `sau` */
  const ghimLan = (sau: (d: unknown, i: { commandType: string }) => Promise<{ pinnedStop: boolean; loiDocGhim: string | null }>) => {
    let n = 0;
    return async (d: unknown, i: { commandType: string }) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ === 0 ? PIN_BAD() : sau(d, i);
    };
  };
  it("COMP-RACE central, 10 laps: a STOP compensation asked before the latch, its pins unreadable then, asks again at the sink: it goes", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.alerts.length = 0;
      h.timeoutDispatch.clear();
      h.traTimeout = 0;
      h.ghimLan.length = 0;
      seedHalt();
      h.ghim = ghimLan(PIN_OK);
      h.timeoutDispatch.add("x");
      h.slow.set("x", 40);
      h.failPlan.set("f", 1);
      const c = await centralRun(dinhComp(`cr${i}`, otStop("cs")), 1);
      await wait(20);
      const k = `run=${runRow(c).status} cs=${ids().filter((x) => x === "cs").length} row=${hang(c, "cs")?.status} asks=${h.ghimLan.filter((x) => x === "stop").length}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    console.log("[PROBE COMP-RACE central laps]", JSON.stringify([...dem]));
    expect([...dem]).toEqual([["run=failed cs=1 row=compensated asks=2", 10]]);
  });
  it("COMP-RACE central control: pins read at the first ask: it goes, no second ask", async () => {
    seedHalt();
    h.ghim = async (d, i) => {
      if (i.commandType === "stop") await wait(80);
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    await centralRun(dinhComp("crq", otStop("cs")), 1);
    await wait(20);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(h.ghimLan.filter((x) => x === "stop")).toHaveLength(1);
  });
  it("COMP-RACE central, read, not pinned: nothing goes, held", async () => {
    seedHalt();
    h.ghim = ghimLan(async () => ({ pinnedStop: false, loiDocGhim: null }));
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(dinhComp("crn", otStop("cs")), 1);
    await wait(20);
    expect(ids().filter((x) => x === "cs")).toEqual([]);
    expect(runRow(c).status).toBe("held");
  });
  it("COMP-RACE control non-STOP compensation: never asks again, 0 hand-overs", async () => {
    h.ghim = async (_d, i) => {
      if ((i as { writes?: Array<{ tagKey?: string }> }).writes?.[0]?.tagKey === "speed") await wait(80);
      return { pinnedStop: false, loiDocGhim: null };
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(dinhComp("crc", ot("cn", { args: { tagKey: "speed", value: 5 } })), 1);
    await wait(20);
    expect(ids().filter((x) => x === "cn")).toEqual([]);
    expect(h.ghimLan.filter((x) => x === "start")).toHaveLength(2); // f, cn: one ask each
    expect(runRow(c).status).toBe("held");
  });
  it("COMP-RACE edge control non-STOP compensation: one /authorize, 0 hand-overs", async () => {
    const e = await denBuoc(dinhComp("crce", ot("cn", { args: { tagKey: "speed", value: 5 } })));
    e.authorizeDelay = new Map([["cn", 60]]);
    h.timeoutDispatch.add("x");
    h.slow.set("x", 25);
    h.failPlan.set("f", 1);
    await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "cn")).toEqual([]);
    expect(authCua(e, "cn")).toBe(1);
  });
  it("COMP-RACE edge, 10 laps: the package could not verify the STOP compensation: no second /authorize of the same attempt, it asks nobody and goes to the edge dispatcher (T5, no authorisation)", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.timeoutDispatch.clear();
      h.traTimeout = 0;
      seedHalt();
      h.connOk = false;
      const e = await denBuoc(dinhComp(`ecr${i}`, otStop("cs")));
      e.authorizeDelay = new Map([["cs", 60]]);
      h.timeoutDispatch.add("x");
      h.slow.set("x", 25);
      h.failPlan.set("f", 1);
      const s = await edgeSegment(e, 2);
      h.connOk = true;
      const k = `out=${s.out.outcome} cs=${ids().filter((x) => x === "cs").length} auth=${authCua(e, "cs")}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    console.log("[PROBE COMP-RACE edge laps]", JSON.stringify([...dem]));
    expect([...dem]).toEqual([["out=failed cs=1 auth=1", 10]]);
  });
  it("FWD-RACE a forward STOP read too early: asks again at the sink once, reads pinned, one hand-over", async () => {
    seedHalt();
    h.ghim = ghimLan(PIN_OK);
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("fwd", [gate(), parF("p", [move("x"), otStop("st")])]), 1);
    await wait(20);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
  });
  it("FWD-RACE the walker's first read and the pass's both fail: the ask again at the sink reads pinned, one hand-over", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      const lan = n++;
      await wait(70);
      return lan < 2 ? PIN_BAD() : PIN_OK(d, i);
    };
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("fwd2", [gate(), parF("p", [move("x"), otStop("st")])]), 1);
    await wait(30);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
  });
  it("X4-ba a STOP compensation read wrong at the first ask AND at the ask again: the last pass reads it right, it goes", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ < 2 ? PIN_BAD() : PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(dinhComp("x4ba", otStop("cs")), 1);
    await wait(20);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
  });
  it("B14 two STOPs in one container compensation: the slow first one holds the second back no longer than the sibling", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 500);
    h.slow.set("cs1", 350);
    const { di } = await diKhongCho(hoiTreo("b14h", box("cb", [robotStop("cs1"), robotStop("cs2")])));
    await trongLuc(di, () => ids().includes("cs2"), "the second STOP", 200);
    expect(ids().sort()).toEqual(["cs1", "cs2", "hang", "x"]);
  });

  // ── a container begun, the walk comes back ─────────────────────────────────────────────────────────────────────────
  const khung = (ref: string, cac: WorkflowStep[], comp: WorkflowStep = robotStop("cs")) => def(ref, [gate(), parF("p", [move("x"), box("b", cac, { compensation: comp })])]);
  const CAC = () => [move("a"), gate("g2"), move("r3")];
  const duyetG2 = async (c: number) => {
    const view = (await getRun(c, { bindingDigest: true }))!;
    return resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  };
  const urgentCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[kind]);
  async function denG2(ref: string, cac = CAC(), comp?: WorkflowStep, stop: string[] = []) {
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    const c = await centralRun(khung(ref, cac, comp), 1);
    expect(ids().filter((x) => !stop.includes(x)).sort()).toEqual(["a", "x"]); // a STOP of the container went at the latch
    h.sent.length = 0;
    h.alerts.length = 0;
    h.timeoutDispatch.clear();
    return c;
  }
  const dangDo = (c: number) => {
    expect(ids()).toEqual(["cs"]);
    expect(hang(c, "b")).toMatchObject({ status: "failed" });
    expect(String(hang(c, "r3")!.error)).toMatch(khongGui);
    expect(urgentCua("forwardNotSent").length, "forward work dropped: decision 3").toBeGreaterThan(0);
  };
  it("KHUNG g2 central: a container begun, its gate approved on a latched run: walked unread, r3 refused, the container's STOP goes, forwardNotSent", async () => {
    const c = await denG2("khung-g");
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    dangDo(c);
  });
  it("KHUNG boot central: the same, the walk comes from a boot with no memory of it", async () => {
    const c = await denG2("khung-b");
    process.env.FOE_DURABLE = "true";
    Object.assign(runRow(c), { status: "held", finishedAt: null, error: null, currentStepId: null, contextJson: { ...runRow(c).contextJson, interrupted: true } });
    Object.assign(hang(c, "g2")!, { status: "completed" });
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    dangDo(c);
  });
  it("KHUNG edge: the same, the next segment", async () => {
    const e = await denBuoc(khung("khung-e", CAC()));
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    h.sent.length = 0;
    h.alerts.length = 0;
    h.timeoutDispatch.clear();
    await approveEdgeGate(e);
    await edgeSegment(e, 3);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(ids()).toEqual(["cs"]);
    expect(authCua(e, "r3")).toBe(0);
    expect(hang(e.runId, "b")).toMatchObject({ status: "failed" });
    expect(String(hang(e.runId, "r3")!.error)).toMatch(khongGui);
    expect((e.events ?? []).filter((v) => v.kind === "anomaly" && String(v.detail).includes('"loai":"forwardNotSent"')).length).toBeGreaterThan(0);
  });
  it("KHUNG a gate and a long delay behind r3: the STOP waits for neither, neither gets a row", async () => {
    const c = await denG2("khung-s", [move("a"), gate("g2"), move("r3"), gate("g3"), delay("w", 5_000)]);
    const t0 = Date.now();
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(hang(c, "g3")).toBeUndefined();
    expect(runRow(c).status).toBe("failed");
  });
  it("KHUNG a delay never started in front of r3: the door stops it, the STOP does not sleep through it, forwardNotSent", async () => {
    const c = await denG2("khung-d", [move("a"), gate("g2"), delay("w", 5_000), move("r3")]);
    const t0 = Date.now();
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(urgentCua("forwardNotSent").length).toBeGreaterThan(0);
  });
  it("KHUNG non-STOP compensation: held for a person, nothing sent, no /authorize of a child", async () => {
    const c = await denG2("khung-n", CAC(), ot("cn", { args: { tagKey: "speed", value: 5 } }));
    await duyetG2(c);
    await wait(40);
    expect(ids()).toEqual([]);
    expect(hangUyQuyen("r3")).toBe(0);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "cn")).toMatchObject({ status: "held" });
  });
  it("KHUNG boot a delay left running by a crash: a delay is no container: the door stops it, the STOP does not sleep through it", async () => {
    const c = await denG2("khung-r", [move("a"), gate("g2"), delay("w", 5_000), move("r3")]);
    process.env.FOE_DURABLE = "true";
    Object.assign(runRow(c), { status: "held", finishedAt: null, error: null, currentStepId: null, contextJson: { ...runRow(c).contextJson, interrupted: true } });
    Object.assign(hang(c, "g2")!, { status: "completed" });
    fake.seed(orchestrationRunSteps, [...rows("orchestration_run_steps"), { id: 99_100, runId: c, stepId: "w", stepType: "delay", status: "running", attempt: 0, startedAt: new Date(), finishedAt: null, error: null, resultJson: null }]);
    const t0 = Date.now();
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
  it("KHUNG a nested container never started: still stopped at the door: no row, no authorisation; the outer container's STOP goes", async () => {
    const c = await denG2("khung-l", [move("a"), gate("g2"), box("c", [move("r4")])]);
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(hang(c, "c")).toBeUndefined();
    expect(hang(c, "r4")).toBeUndefined();
    expect(hangUyQuyen("r4")).toBe(0);
    expect(urgentCua("forwardNotSent").length).toBeGreaterThan(0);
  });
  it("KHUNG a container not begun on a latched run: stopped at the door, its STOP compensation not due (nothing of it ran)", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("khung-c", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("b", [move("r3")], { compensation: robotStop("cs") })])])]), 1);
    await wait(20);
    expect(ids()).toEqual(["x"]);
    expect(hang(c, "b")).toBeUndefined();
  });
  it("B7-sau a container finished before the latch: its STOP compensation stays unsent on the walk that comes back", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("b7s", [gate(), parF("p", [move("x"), box("b", [move("a")], { compensation: robotStop("cs") })]), gate("g3")]), 1);
    await wait(20);
    expect(ids().sort()).toEqual(["a", "x"]);
    expect(hang(c, "b")).toMatchObject({ status: "completed" });
  });

  // ── K2a: a held compensation of a step the door refused holds the run ──────────────────────────────────────────────
  const k2a = (ref: string) => def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: otStop("cs") })])])]);
  for (const dang of ["khongGhim", "docLoi"] as const) {
    const sau = () => (dang === "khongGhim" ? { pinnedStop: false, loiDocGhim: null } : { pinnedStop: false, loiDocGhim: "pin read timed out (test)" });
    const denK2a = async (ref: string) => {
      seedHalt();
      let n = 0;
      h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : sau());
      // T5 — a read that failed takes the marked route: it stands only if the dispatcher cannot decide either, and then it is state C, not a hold
      h.dispatcherThat = dang === "docLoi";
      h.dispatcherKhongDoc = dang === "docLoi";
      h.timeoutDispatch.add("x");
      const c = await centralRun(k2a(ref), 1);
      await wait(dang === "docLoi" ? 900 : 30);
      expect(ids().filter((x) => x !== "cs")).toEqual(["x"]);
      expect(runRow(c).status).toBe("held");
      if (dang === "khongGhim") {
        expect(hang(c, "cs")).toMatchObject({ status: "held" });
        expect(urgentCua("held").length).toBeGreaterThan(0);
      } else {
        expect(String(hang(c, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: /);
        expect(urgentCua("stopNotSent").length).toBeGreaterThan(0);
      }
      h.dispatcherThat = false;
      h.dispatcherKhongDoc = false;
      h.ghim = PIN_OK;
      h.timeoutDispatch.clear();
      h.sent.length = 0;
      return c;
    };
    it(`K2a ${dang}, Continue: the URGENT said Continue: the read recovered, it works, the STOP goes once`, async () => {
      const c = await denK2a(`k2ac-${dang}`);
      const r = await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
      expect(String(r.message ?? "")).not.toMatch(/not resumable|already terminal/);
      await waitFor(() => ids().includes("cs"), "the STOP");
      await wait(20);
      expect(ids()).toEqual(["cs"]);
      expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
    });
    it(`K2a ${dang}, Abort: the URGENT said Abort: the read recovered, it works, the STOP goes once`, async () => {
      const c = await denK2a(`k2ab-${dang}`);
      const r = await abortRun(c, OWNER, "checked on site");
      expect(r.ok).toBe(true);
      await waitFor(() => ids().includes("cs"), "the STOP");
      await wait(20);
      expect(ids()).toEqual(["cs"]);
      expect(runRow(c).status).toBe("aborted");
    });
  }
  // K2 race, parity: the pass holds the container's STOP compensation; the a2n harness has no classifyOtStop, an Abort sweep verifies nothing there
  for (const dang of ["khongGhim", "docLoi"] as const) {
    it(`K2 ${dang}, Abort: the URGENT names Abort: the read recovered, it works, the STOP goes once, no 'already terminal'`, async () => {
      seedHalt();
      let n = 0;
      h.ghim = async (d, i) => {
        if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
        if (++n === 1) return PIN_OK(d, i);
        await wait(40);
        return dang === "khongGhim" ? { pinnedStop: false, loiDocGhim: null } : PIN_BAD();
      };
      h.dispatcherThat = dang === "docLoi"; // T5 — as K2a
      h.dispatcherKhongDoc = dang === "docLoi";
      h.timeoutDispatch.add("x");
      const c = await centralRun(def(`k2ab-${dang}`, [gate(), box("b", [move("x")], { compensation: otStop("cs") })]), 1);
      await wait(dang === "docLoi" ? 900 : 70);
      expect(runRow(c).status).toBe("held");
      expect(ids().filter((x) => x !== "cs")).toEqual(["x"]);
      h.dispatcherThat = false;
      h.dispatcherKhongDoc = false;
      h.ghim = PIN_OK;
      h.timeoutDispatch.clear();
      h.sent.length = 0;
      const r = await abortRun(c, OWNER, "checked on site");
      expect(r.ok, r.message).toBe(true);
      await waitFor(() => ids().includes("cs"), "the STOP");
      await wait(20);
      expect(ids()).toEqual(["cs"]);
      expect(runRow(c).status).toBe("aborted");
    });
  }
  it("K2-THAN a container compensation of a door-refused step, its STOP not pinned at dispatch: held, the run holds; the read recovered, a Continue sends it once", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("k2than", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: box("cb", [otStop("cs")]) })])])]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "cs")).toMatchObject({ status: "held" });
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    const r = await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    expect(String(r.message ?? "")).not.toMatch(/not resumable|already terminal/);
    await waitFor(() => ids().includes("cs"), "the STOP");
    await wait(20);
    expect(ids()).toEqual(["cs"]);
  });
  it("THAN-GIU a STOP behind a failed step of a body, not pinned at its dispatch: its row held, the run holds; the read recovered, a Continue sends that STOP and nothing of the body before it", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan("thangiu", [move("q"), otStop("cs")]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "cs")).toMatchObject({ status: "held" });
    expect(runRow(c).contextJson.foeResumeState?.f, "the hold is that STOP's, not the body's: a Continue must not walk the body again").toBeUndefined();
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    const r = await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    expect(String(r.message ?? "")).not.toMatch(/not resumable|already terminal/);
    await waitFor(() => ids().includes("cs"), "the STOP");
    await wait(20);
    expect(ids()).toEqual(["cs"]);
  });
  // ── lượt sửa 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const denThanGiu = async (ref: string) => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan(ref, [move("q"), otStop("cs")]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
    return c;
  };
  it("THAN-GIU-ABORT-T7b the same held STOP, the read recovered, Abort: the URGENT named Abort, the sweep must reach it", async () => {
    const c = await denThanGiu("tg-ab");
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    await abortRun(c, OWNER, "checked on site");
    await wait(30);
    expect(ids()).toEqual(["cs"]);
    expect(hang(c, "cs")?.status).not.toBe("held");
  });
  it("THAN-GIU-ABORT-TUCHOI-T7b the same, the dispatcher refuses the Abort's STOP: abort:cs stays owed, a second Abort sends it", async () => {
    const c = await denThanGiu("tg-at");
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    h.failPlan.set("cs", 1);
    await abortRun(c, OWNER, "checked on site");
    await wait(30);
    expect(ids()).toEqual(["cs"]);
    expect(hang(c, "abort:cs")).toMatchObject({ status: "failed" });
    await abortRun(c, OWNER, "again");
    await wait(30);
    expect(ids()).toEqual(["cs", "cs"]);
    expect(hang(c, "abort:cs")).toMatchObject({ status: "completed" });
  });
  it("THAN-GIU-CONTINUE-T9 a Continue that only sends a STOP asks no reason and sends no non-STOP; the URGENT says so, no 'a reason is required', no 'waiting for a person'", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan("tg-co", [move("q"), move("z"), otStop("cs")]), 1);
    await wait(30);
    const chu = urgentCua("held").map((a) => `${a.title} ${a.message}`).join(" ");
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    const view = (await getRun(c, { bindingDigest: true }))!;
    await resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => ids().includes("cs"), "the STOP");
    await wait(20);
    expect(ids()).toEqual(["cs"]);
    expect(chu).not.toBe("");
    expect(chu).not.toContain("a reason is required");
    expect(chu).not.toContain("waiting for a person");
  });
  it("THAN-GIU-BOOT-T10 a boot on the same hold goes through congBootStop: inside the bound from the durable latch mark it goes; past it, nothing goes, state C, an URGENT, a person decides", async () => {
    const chay = async (ref: string, luc: string) => {
      const c = await denThanGiu(ref);
      process.env.FOE_DURABLE = "true";
      const ctx = runRow(c).contextJson as Record<string, unknown>;
      Object.assign(runRow(c), { status: "held", error: null, contextJson: { ...ctx, interrupted: true, [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { ...(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as object), at: luc } } });
      h.ghim = PIN_OK;
      h.timeoutDispatch.clear();
      h.sent.length = 0;
      h.alerts.length = 0;
      await autoResumeInterruptedRuns([c]);
      await wait(40);
      return c;
    };
    await chay("tg-bt", new Date().toISOString());
    expect(ids()).toEqual(["cs"]);
    const c = await chay("tg-bq", new Date(Date.now() - 3_600_000).toISOString());
    expect(ids(), "past the bound a boot sends nothing by itself").toEqual([]);
    expect(runRow(c).status).toBe("held");
    expect(h.alerts.length).toBeGreaterThan(0);
  });
  it("THAN-DOC-T5 a STOP behind a failed step of a body, its pins unreadable from the start: a row with the mark, owed, an URGENT naming it, the run held", async () => {
    seedHalt();
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true; // T5 — FOE's read alone failing, the marked route sends it (THAN-DOC-DI below): "owed, held" is the dispatcher that cannot decide either
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan("tdoc", [move("q"), otStop("cs")]), 1);
    await wait(900);
    expect(hang(c, "cs"), "no row, nobody told").toBeDefined();
    expect(String(hang(c, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: /);
    expect(h.alerts.filter((a) => String(a.message).includes('"cs"')).length).toBeGreaterThan(0);
    expect(runRow(c).status).toBe("held");
  });
  it("THAN-DOC-DI the same, the dispatcher reads the real pin: it goes, one hand-over, no debt", async () => {
    seedHalt();
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan("tdocd", [move("q"), otStop("cs")]), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
  });
  it("MAT-HANG-B boot, the container's own row lost, its children's rows there: it was begun: walked, the STOP goes, r3 is what was dropped, not a", async () => {
    const c = await denG2("mhb");
    process.env.FOE_DURABLE = "true";
    Object.assign(runRow(c), { status: "held", finishedAt: null, error: null, currentStepId: null, contextJson: { ...runRow(c).contextJson, interrupted: true } });
    Object.assign(hang(c, "g2")!, { status: "completed" });
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== c || r.stepId !== "b"));
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(ids()).toEqual(["cs"]);
    expect(String(hang(c, "r3")!.error)).toMatch(khongGui);
    expect(urgentCua("forwardNotSent").map((a) => a.dedupKey.split(":")[2])).toEqual(["r3"]);
  });
  const buocBo = () => urgentCua("forwardNotSent").map((a) => a.dedupKey.split(":")[2]);
  const bootMat = async (c: number, mat: string[], sua?: () => void) => {
    process.env.FOE_DURABLE = "true";
    Object.assign(runRow(c), { status: "held", finishedAt: null, error: null, currentStepId: null, contextJson: { ...runRow(c).contextJson, interrupted: true } });
    if (hang(c, "g2")) Object.assign(hang(c, "g2")!, { status: "completed" });
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== c || !mat.includes(r.stepId)));
    sua?.();
    await autoResumeInterruptedRuns([c]);
  };
  it("MAT-HANG-SAU the row that proves it is a child two levels down, both containers' rows lost: begun, walked, the STOP goes", async () => {
    const c = await denG2("mhs", [box("c", [move("a"), gate("g2"), move("r3")])]);
    await bootMat(c, ["b", "c"]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(ids()).toEqual(["cs"]);
    expect(buocBo()).toEqual(["r3"]);
  });
  it("MAT-HANG-B phủ định: what is left behind the lost row is a STOP its dispatcher refuses: forwardNotSent still names it, never silent", async () => {
    h.failPlan.set("s", Infinity);
    const c = await denG2("mhp", [move("a"), gate("g2"), robotStop("s")], undefined, ["s", "cs"]); // s failed: its container's STOP went with the walk
    await bootMat(c, ["b"]);
    await waitFor(() => ids().includes("s"), "the STOP");
    await wait(30);
    // T6 (H1, H11, T5 bàn giao) — a STOP in state C is its own last word: its own URGENT names it, forwardNotSent never says it "was NOT handed to a dispatcher"
    expect(buocBo()).toEqual([]);
    expect(urgentCua("stopNotSent").filter((a) => String(a.title).includes('"s"')).length, "never silent").toBeGreaterThan(0);
  });
  it("MAT-HANG-B phủ định: nothing left behind the lost row: no forwardNotSent", async () => {
    const c = await denG2("mhn", [move("a"), gate("g2")]);
    await bootMat(c, ["b"]);
    await wait(40);
    expect(buocBo()).toEqual([]);
  });
  it("MAT-HET every row of the container and its children lost, the context's dispatched list kept: that list is the proof: the STOP goes, a is not called unsent", async () => {
    const c = await denG2("mhk");
    await bootMat(c, ["b", "a", "g2"]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    await wait(30);
    expect(ids()).toEqual(["cs"]);
    expect(buocBo()).not.toContain("a");
  });
  it("MAT-HET-CS-T9 the same with the dispatched list lost too: nothing says the container began: the URGENT does not say NOT handed: it says there is no record, names the STOP compensation the container declares, sends the person to the machine", async () => {
    const c = await denG2("mhc");
    await bootMat(c, ["b", "a", "g2"], () => delete (runRow(c).contextJson as Record<string, unknown>).foeDispatchedSteps);
    await wait(60);
    const chu = urgentCua("forwardNotSent").map((a) => `${a.title} ${a.message}`).join(" ");
    expect(chu).not.toBe("");
    expect(chu).not.toContain("NOT handed");
    expect(chu).toMatch(/no record/i);
    expect(chu).toContain('"cs"');
    expect(chu).toMatch(/check the machine/i);
  });
  const buocPhai = (ten: string) => expect(buocBo(), `${ten}: forward work dropped, nobody told`).toContain(ten);
  it("IM-SAU a door-stopped container with only a STOP, a command behind it in the same sequence: the command is named", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("ims", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c", [robotStop("s")]), move("m")])])]), 1);
    await wait(30);
    expect(ids()).not.toContain("m");
    buocPhai("m");
  });
  it("IM-TAIL a delay at the door in an inner box, a command behind that box: the command is named", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("imt", [gate(), parF("p", [move("x"), box("v", [box("o", [delay("w", 30), delay("w2", 10)]), move("m")])])]), 1);
    await wait(30);
    buocPhai("m");
  });
  it("IM-GATE a gate at the door, a top-level command behind the parallel: the command is named", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("img", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), gate("g3")])]), move("tail")]), 1);
    await wait(30);
    buocPhai("tail");
  });
  it("IM-KHUNG a real re-walk: a box never begun at the door, a command behind it: the command is named", async () => {
    const c = await denG2("imk", [move("a"), gate("g2"), box("o", [delay("w", 5)]), move("m")]);
    await duyetG2(c);
    await wait(40);
    expect(ids()).toEqual(["cs"]);
    buocPhai("m");
  });
  it("IM-STOP-T5 a STOP behind a door-stopped container, its dispatcher refuses it: an URGENT names it, the run is held", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    h.failPlan.set("s2", Infinity);
    const c = await centralRun(def("imst", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c", [robotStop("s")]), robotStop("s2")])])]), 1);
    await wait(30);
    expect(h.alerts.filter((a) => String(a.message).includes('"s2"')).length, "a refused STOP nobody names").toBeGreaterThan(0);
    expect(runRow(c).status).toBe("held");
  });
  it("TEN-LOI a begun container, its row lost, a step with a device's error in it: the step behind it is named, not the one that answered", async () => {
    const c = await denG2("tl", [move("a"), gate("g2"), move("y"), move("m")]);
    fake.seed(orchestrationRunSteps, [...rows("orchestration_run_steps"), { id: 99_200, runId: c, stepId: "y", stepType: "command", status: "failed", attempt: 1, startedAt: new Date(), finishedAt: new Date(), error: "device said no", resultJson: null }]);
    await bootMat(c, ["b"]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    await wait(30);
    expect(buocBo()).toEqual(["m"]);
  });
  it("TEN-NOTPIN phủ định: a stop-typed step that is no STOP stands at the door: it never went: named", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("tnp", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), stopTyped("nt")])])]), 1);
    await wait(30);
    expect(ids()).toEqual(["x"]);
    expect(buocBo()).toEqual(["nt"]);
  });
  it("TEN-TUCHOI phủ định: a STOP at the door its dispatcher refuses: it did not go: named", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    h.failPlan.set("s", Infinity);
    await centralRun(def("ttc", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), robotStop("s")])])]), 1);
    await wait(30);
    // T6 (H1, H11, T5 bàn giao) — it did not go and it is named, by its own URGENT: forwardNotSent never says a STOP in state C "was NOT handed to a dispatcher"
    expect(buocBo()).toEqual([]);
    expect(urgentCua("stopNotSent").filter((a) => String(a.title).includes('"s"')).length, "named").toBeGreaterThan(0);
  });
  it("TEN-STOP a container never begun holding only a STOP the pass sends: nothing forward was dropped: no forwardNotSent", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("ts", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c", [robotStop("s")])])])]), 1);
    await wait(30);
    expect(ids()).toEqual(["x", "s"]);
    expect(buocBo()).toEqual([]);
  });
  it("TEN-STOP-M a STOP at the door with a command behind it: the command is what was dropped", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("tsm", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), robotStop("s"), move("m")])])]), 1);
    await wait(30);
    expect(ids()).toEqual(["x", "s"]);
    expect(buocBo()).toEqual(["m"]);
  });
  it("TEN-DELAY a delay at the door, no command behind it: nothing forward was dropped", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("td", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), delay("w2", 10)])])]), 1);
    await wait(30);
    expect(buocBo()).toEqual([]);
  });
  it("TEN-XONG a container at the door with a finished step and a STOP in it, then a command: the command is named, never the finished step", async () => {
    const c = await denG2("tx", [move("a"), gate("g2"), delay("w", 5_000), robotStop("s"), move("m")], undefined, ["s"]);
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(buocBo()).toEqual(["m"]);
  });
  it("KTB a container with a device's error from an earlier walk: its failure keeps its meaning, no forwardNotSent over it", async () => {
    h.timeoutDispatch.add("x");
    h.failPlan.set("y", 1);
    const c = await centralRun(def("ktb", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [move("y"), move("m")])])]), 1);
    chet(c, ["g1", "p", "x", "b", "y"], () => {
      Object.assign(hang(c, "y")!, { status: "failed", error: "device said no" });
      Object.assign(hang(c, "b")!, { status: "failed", error: "device said no" });
    });
    await autoResumeInterruptedRuns([c]);
    await wait(30);
    expect(buocBo()).toEqual([]);
  });
  // R5: a STOP that went at the last pass lifts the hold it was the reason of
  it("X4-ba a hold at the sink, the STOP went at the last pass: the run ends by its walk, failed, no hold left, nothing more to send", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ < 2 ? PIN_BAD() : PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(dinhComp("x4ba2", otStop("cs")), 1);
    await wait(20);
    expect(runRow(c).status).toBe("failed");
    expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("K2-HOI a hold by a pass, the last pass reads it pinned: failed, compensated, one STOP", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if (++n === 2) return (await wait(10), { pinnedStop: false, loiDocGhim: null });
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    const c = await centralRun(k2a("k2h"), 1);
    await wait(30);
    expect(runRow(c).status).toBe("failed");
    expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("K2-HOI đối chứng: the last attempt does not go either: held", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n % 2 === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.timeoutDispatch.add("x");
    const c = await centralRun(k2a("k2hd"), 1);
    await wait(30);
    expect(ids()).toEqual(["x"]);
    expect(runRow(c).status).toBe("held");
  });
  it("K2-HOI đối chứng: the last attempt goes and the dispatcher refuses: held", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if (++n === 2) return (await wait(10), { pinnedStop: false, loiDocGhim: null });
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.failPlan.set("cs", Infinity);
    const c = await centralRun(k2a("k2hr"), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
  });
  const denHoi = async (ref: string) => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if (++n === 2) return (await wait(10), { pinnedStop: false, loiDocGhim: null });
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    const c = await centralRun(k2a(ref), 1);
    await wait(30);
    return c;
  };
  it("K2-HOI H2: handed over, not confirmed, the URGENT not durable: held, not sent again", async () => {
    h.alertDurable = false;
    const c = await denHoi("k2hb");
    expect(runRow(c).status).toBe("held");
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  // A2(n) T7 — expectation changed by decision 1 (owner): was `failed`. cs's acked_verified lifts the hold of cs (R5a, unchanged), it confirms nothing of x, whose outcome is unknown: XAC_NHAN is
  // the SAME step after its unknown attempt only (plan point 8, decision 3). No URGENT about the latch was stored, so the end gate holds the run.
  // dieu-phoi 08/11 (T7 lượt sửa 1): qđ 1 + ke-hoach mục 8/N-2: cs là bù trừ của r3, không xác nhận x; r3 bỏ việc tiến. The sibling with x's own STOP: K2-ANH-EM-T9
  it("K2-HOI confirmed: acked_verified with no durable URGENT: the hold of cs ends with its STOP, the run does not: x is still unknown and nobody was durably told (decision 1), one STOP", async () => {
    h.acked = true;
    h.ackStatus = "acked_verified";
    h.alertDurable = false;
    const c = await denHoi("k2hx");
    expect(runRow(c).status).toBe("held");
    expect(String(runRow(c).error), "the end gate's words, not the hold of cs").toMatch(/^FOE_OUTCOME_UNKNOWN: run \d+ has a command whose outcome is unknown, and no URGENT about it could be stored/);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("K2-HOI no answer at the last attempt: handed over, not confirmed, a durable URGENT: the run ends (H2)", async () => {
    h.timeoutDispatch.add("cs");
    const c = await denHoi("k2ht");
    expect(runRow(c).status).toBe("failed");
  });
  it("HELD-CU-T9 the URGENT that said NOT sent, once the STOP went: a later word corrects it (T9)", async () => {
    await denHoi("k2hc");
    // held is raised before anyone knows whether the STOP will go: it cannot be avoided, only corrected. Closed when an URGENT AFTER it names cs and says that hold is over
    const dau = h.alerts.findIndex((a) => a.kind === CANH_BAO_KHONG_RO_KIND.held && String(a.title).includes('"cs"'));
    expect(dau).toBeGreaterThanOrEqual(0);
    const sau = h.alerts.slice(dau + 1).filter((a) => String(a.message).includes('"cs"')).map((a) => String(a.message)).join(" ");
    expect(sau).toMatch(/no longer held|hold is over|replaces the earlier/i);
  });
  it("S3 three holds' sibling: the run's error names a hold that stands, never the one lifted", async () => {
    seedHalt();
    let n = 0;
    let m = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if ((i as unknown as { writes: Array<{ value: unknown }> }).writes[0].value === false) return { pinnedStop: ++m % 2 === 1, loiDocGhim: null };
      if (++n === 2) return (await wait(10), { pinnedStop: false, loiDocGhim: null });
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("s3", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: otStop("cs") })]), box("e", [delay("w2", 60), move("r4", { compensation: otStop("cs2", { args: { tagKey: "halt", value: false } }) })])])]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
    expect(String(runRow(c).error)).not.toContain('"cs"');
    expect(String(runRow(c).error)).toContain('"cs2"');
  });
  it("S4 a one-STOP body held at the sink, its STOP goes at the last pass: its row says so, the run ends, a Continue does not send it a second time (count)", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ < 2 ? { pinnedStop: false, loiDocGhim: null } : PIN_OK(d, i); // T5 — a read that answered: a read that failed takes the marked route and never holds, and this case would measure nothing of T6
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(dinhComp("s4", box("cb", [otStop("cs")])), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    const hangCs = hang(c, "cs")?.status;
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    if (runRow(c).status === "held") await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site").catch(() => undefined);
    await wait(30);
    expect(ids().filter((x) => x === "cs"), "sent a second time").toEqual(["cs"]);
    expect(hangCs).not.toBe("held");
  });
  it("K2-HOI two holds, one STOP goes at the last pass, the other does not: the run stays held", async () => {
    seedHalt();
    let n = 0;
    let m = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if ((i as unknown as { writes: Array<{ value: unknown }> }).writes[0].value === false) return { pinnedStop: ++m % 2 === 1, loiDocGhim: null };
      if (++n === 2) return (await wait(10), { pinnedStop: false, loiDocGhim: null });
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("k2h2", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: otStop("cs") })]), box("e", [delay("w2", 60), move("r4", { compensation: otStop("cs2", { args: { tagKey: "halt", value: false } }) })])])]), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(ids().filter((x) => x === "cs2")).toEqual([]);
    expect(runRow(c).status).toBe("held");
    expect(urgentCua("held").filter((a) => a.dedupKey.includes(":r4:cs2:")).length, "the second hold told nobody").toBeGreaterThan(0);
    expect(runRow(c).contextJson.foeResumeState?.r4).toMatchObject({ state: "compensationHeld" });
  });
  it("X4-TO-TIEN the hold lifted, but a container around it still owes a compensation that is no STOP: the run stays held, it is not lost", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ < 2 ? PIN_BAD() : PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(def("x4tt", [gate(), box("o", [parF("p", [move("x"), ot("f", { compensation: otStop("cs") })])], { compensation: ot("u", { args: { tagKey: "speed", value: 1 } }) })]), 1);
    await wait(20);
    expect(ids()).not.toContain("u");
    expect(runRow(c).status).toBe("held");
  });
  it("K2a đối chứng: the STOP goes at its dispatch: the run ends, it is not held", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    const c = await centralRun(k2a("k2a-dc"), 1);
    await wait(30);
    expect(ids().sort()).toEqual(["cs", "x"]);
    expect(runRow(c).status).toBe("failed");
  });
  it("DONE-FAILED a STOP the sink refused in an earlier walk: a later walk's STOP pass goes through its resume state; it is sent", async () => {
    seedHalt();
    h.ghim = async () => ({ pinnedStop: false, loiDocGhim: null }); // T5 — a read that answered: a read that failed takes the marked route, nothing refuses it at the sink
    h.timeoutDispatch.add("x");
    h.slow.set("x", 30);
    const c = await centralRun(def("df", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [delay("w", 60), otStop("st")])])]), 1);
    await wait(20);
    expect(ids().filter((x) => x === "st")).toEqual([]);
    expect(String(hang(c, "st")!.error)).toMatch(khongGui);
    expect(runRow(c).status).toBe("held");
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("đối chứng a non-STOP step refused at the sink: a later walk never enters it", async () => {
    h.ghim = async (_d, i) => {
      if (i.commandType === "start") await wait(70);
      return { pinnedStop: false, loiDocGhim: null };
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 20);
    const c = await centralRun(def("df-c", [gate(), parF("p", [move("x", { compensation: ot("u", { args: { tagKey: "speed", value: 1 } }) }), ot("m2")])]), 1);
    await wait(20);
    expect(String(hang(c, "m2")!.error)).toMatch(khongGui);
    h.ghim = null;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await wait(40);
    expect(ids()).not.toContain("m2");
  });
  it("Q-5 with routedTo: a verified STOP left running by a crash, its result recorded: boot sends it again", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("q5a", [gate(), parF("p", [move("x"), robotStop("st")])]), 1);
    chet(c, ["g1", "x", "st"], () => Object.assign(hang(c, "st")!, { status: "running", error: null, finishedAt: null, resultJson: { routedTo: "robot-dispatcher", status: "done", accepted: true } }));
    h.slow.set("st", 5);
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("Q-5 no routedTo: the row left running proves nothing: boot sends it, its row ends completed", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("q5b", [gate(), parF("p", [move("x"), robotStop("st")])]), 1);
    chet(c, ["g1", "x", "st"], () => Object.assign(hang(c, "st")!, { status: "running", error: null, finishedAt: null, resultJson: null }));
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    await waitFor(() => hang(c, "st")?.status === "completed", "the STOP's row");
  });

  // ── A2(n) T6a: forwardNotSent over the whole tree (H13), giu by what came back (R5, H2, H14) ─────────────────────────────
  const motLan = (id: string) => expect(ids().filter((x) => x === id), `${id} sent once`).toEqual([id]);
  it("LONG-1 a nested tree: a begun container with a STOP compensation, a command unsent in it and one behind it: both named, never the STOP", async () => {
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    await centralRun(def("long1", [gate(), parF("p", [move("x"), box("v", [box("c", [move("a"), delay("w", 60), move("m1")], { compensation: robotStop("cs") }), move("m2")])])]), 1);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    await wait(30);
    motLan("cs");
    expect(buocBo().sort()).toEqual(["m1", "m2"]);
  });
  it("LONG-2 two levels: the first unsent command of each container and of the sequence around them, never the STOP compensation", async () => {
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    await centralRun(def("long2", [gate(), parF("p", [move("x"), box("v", [box("c", [box("d", [move("a"), delay("w", 60), move("m1"), move("m1b")], { compensation: robotStop("cs") }), move("m2")]), move("m3")])])]), 1);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    await wait(30);
    motLan("cs");
    expect(buocBo().sort()).toEqual(["m1", "m2", "m3"]);
  });
  it("LONG-SONG a parallel with a nested branch: each branch names its own first unsent command, the top level its own; the STOP goes once", async () => {
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    await centralRun(def("longs", [gate(), parF("p", [move("x"), parF("q", [box("c", [move("a"), delay("w", 60), move("m1"), move("m1b")], { compensation: robotStop("cs") }), box("e", [delay("w2", 60), box("f", [move("m4")])])])]), move("tail")]), 1);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    await wait(30);
    motLan("cs");
    expect(buocBo().sort()).toEqual(["m1", "m4", "tail"]);
  });
  it("LONG-EDGE the same nested tree on the edge: both named", async () => {
    const e = await denBuoc(def("long1e", [gate(), parF("p", [move("x"), box("v", [box("c", [move("a"), delay("w", 60), move("m1")], { compensation: robotStop("cs") }), move("m2")])])]));
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    motLan("cs");
    const ten = (e.events ?? []).filter((v) => v.kind === "anomaly" && String(v.detail).includes('"loai":"forwardNotSent"')).map((v) => JSON.parse(String(v.detail)).stepId as string);
    expect(ten.sort()).toEqual(["m1", "m2"]);
  });
  it("TUCHOI-CAY a STOP in state C inside a door-stopped tree, a command behind it: the command is named, the STOP is its own last word, its own URGENT names it", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    h.failPlan.set("s", Infinity);
    const c = await centralRun(def("tcay", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c", [robotStop("s")]), move("m")])])]), 1);
    await wait(30);
    expect(buocBo()).toEqual(["m"]);
    expect(urgentCua("stopNotSent").filter((a) => String(a.title).includes('"s"')).length, "the refused STOP is told by its own URGENT").toBeGreaterThan(0);
    expect(runRow(c).status).toBe("held");
  });
  it("KHONG-XD the rows cannot be read after the latch: what was dropped cannot be told: an URGENT all the same, its words say it could not be determined", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const goc = fake.select.bind(fake);
    let hong = false;
    let lan = 0;
    const xau: Record<string, unknown> = {};
    for (const k of ["where", "limit", "orderBy", "for", "leftJoin", "groupBy"]) xau[k] = () => xau;
    xau.then = (ok: (v: unknown) => unknown, loi: (e: unknown) => unknown) => Promise.reject(new Error("step rows unreadable (test)")).then(ok, loi);
    const spy = vi.spyOn(fake, "select").mockImplementation((p?: Record<string, any>) => {
      const b = goc(p);
      const tu = b.from;
      b.from = (t: unknown) => (hong && t === orchestrationRunSteps ? (lan++, xau) : tu(t));
      return b;
    });
    h.sauTimeout = () => (hong = true);
    try {
      await centralRun(def("kxd", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), move("m")])])]), 1);
      await wait(30);
    } finally {
      spy.mockRestore();
    }
    expect(lan, "the step rows read failed after the latch").toBeGreaterThan(0);
    expect(ids()).toEqual(["x"]);
    const a = urgentCua("forwardNotSent");
    expect(a.length, "forward work dropped: a person is told").toBe(1);
    expect(`${a[0].title} ${a[0].message}`).toMatch(/could not be determined/i);
    expect(a[0].message).not.toContain("NOT handed");
  });
  it("CHO-CONG a latched walk that pauses at a gate reached before the latch: what stands behind it never goes forward either (an approval walks into the door, a rejection walks nothing): named now", async () => {
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    const c = await centralRun(khung("chc", CAC()), 1);
    await wait(30);
    expect(runRow(c).status).toBe("awaiting_confirm");
    expect(hang(c, "r3")).toBeUndefined();
    expect(buocBo(), "a rejected gate walks nothing: nobody else would name r3").toEqual(["r3"]);
  });
  it("CRASH-BAO a walk refused a command at the door and died before its end told anyone: the boot's walk names it from the row", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("crb", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), move("m")])])]), 1);
    await wait(30);
    expect(String(hang(c, "m")!.error)).toMatch(khongGui);
    chet(c, ["g1", "p", "x", "v", "m"]);
    await autoResumeInterruptedRuns([c]);
    await wait(40);
    expect(ids()).toEqual([]);
    expect(buocBo(), "the row says m was not sent: a person is told, whatever walk wrote it").toEqual(["m"]);
  });
  it("K2-HOI no answer, the URGENT not durable: handed over, not confirmed: held (H2), not sent again", async () => {
    h.alertDurable = false;
    h.timeoutDispatch.add("cs");
    const c = await denHoi("k2htb");
    const n = ids().filter((x) => x === "cs").length;
    expect(n).toBeGreaterThan(0);
    expect(runRow(c).status).toBe("held");
    await wait(30);
    expect(ids().filter((x) => x === "cs").length, "not sent again").toBe(n);
  });
  const k2e = (ref: string) => def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: robotStop("cs") })])])]);
  const diK2e = async (ref: string) => {
    const e = await denBuoc(k2e(ref));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await waitFor(() => ids().includes("cs"), "the refused step's STOP");
    return e;
  };
  const baoEdge = (e: EdgeHarness, loai: string) => (e.events ?? []).filter((v) => v.kind === "anomaly" && String(v.detail).includes(`"loai":"${loai}"`));
  it("GIU-EDGE chắc chưa ra: the edge's STOP compensation refused: state C, the segment ends held, an URGENT names it", async () => {
    h.failPlan.set("cs", Infinity);
    const e = await diK2e("gec");
    expect(runRow(e.runId).status).toBe("held");
    expect(baoEdge(e, "stopNotSent").length).toBeGreaterThan(0);
  });
  it("GIU-EDGE đã gửi, chưa xác nhận: no answer at the last attempt: not state C, the segment is not held for it, told not confirmed (H14)", async () => {
    h.timeoutDispatch.add("cs");
    const e = await diK2e("gek");
    expect(baoEdge(e, "stopNotSent")).toEqual([]);
    expect(baoEdge(e, "stopNotConfirmed").length).toBeGreaterThan(0);
    expect(runRow(e.runId).status).not.toBe("held");
  });
  it("RA-HANG a body STOP that went with no answer at its last attempt, the URGENT not durable: held (H2), its row says it was handed over (never 'held'), not sent again", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ < 2 ? { pinnedStop: false, loiDocGhim: null } : PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("cs");
    h.alertDurable = false;
    const c = await centralRun(dinhComp("rah", box("cb", [otStop("cs")])), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "cs")?.status, "a STOP handed over keeps the row that says so").toBe("failed");
    expect(String(hang(c, "cs")?.error)).toMatch(/OUTCOME_UNKNOWN/);
    expect(urgentCua("stopNotConfirmed").filter((a) => a.dedupKey.includes(":f:cs:")).length, "told: handed over, not confirmed").toBeGreaterThan(0);
    await wait(30);
    motLan("cs");
  });
  it("RA-XD-EDGE the edge's evidence read throws at the end of the walk: what was dropped is named from the walk's own memory, a step central can check, never '?'", async () => {
    const e = await denBuoc(def("raxe", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), move("m")])])]));
    e.sweepNem = true;
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(30);
    expect(e.sweepLan ?? 0, "the read threw").toBeGreaterThan(0);
    const ten = baoEdge(e, "forwardNotSent").map((v) => JSON.parse(String(v.detail)).stepId as string);
    expect(ten).toEqual(["m"]);
    expect(buocBo(), "central raised the URGENT").toEqual(["m"]);
  });
  // ── T6a fix 1 (P1): a stop-typed step that is no STOP, never reached by the door ─────────────────────────────────────
  const np = (ref: string, dang: "NP1" | "NP2" | "NP3") =>
    def(ref, dang === "NP1" ? [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [stopTyped("nt")])])])] : [gate(), parF("p", [move("x"), delay("w", 30)]), dang === "NP2" ? box("c2", [stopTyped("nt")]) : stopTyped("nt")]);
  for (const dang of ["NP1", "NP2", "NP3"] as const) {
    it(`P1-${dang} central: a stop-typed step the last pass read as not pinned, the door never reached it: forward work, named; it never goes`, async () => {
      h.slow.set("x", 10);
      h.timeoutDispatch.add("x");
      await centralRun(np(`p1${dang.toLowerCase()}`, dang), 1);
      await wait(40);
      expect(ids()).toEqual(["x"]);
      expect(buocBo()).toEqual(["nt"]);
    });
  }
  it("P1-NPE the NP1 tree on the edge: the edge names nt, central raises the URGENT", async () => {
    const e = await denBuoc(np("p1npe", "NP1"));
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(40);
    expect(ids()).toEqual(["x"]);
    expect(baoEdge(e, "forwardNotSent").map((v) => JSON.parse(String(v.detail)).stepId)).toEqual(["nt"]);
    expect(buocBo()).toEqual(["nt"]);
  });
  it("P1-F4 the NP1 tree, the pins cannot be read: no forwardNotSent for nt, the marked route hands it to the dispatcher, which decides (refuses: nothing written), state C", async () => {
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.duocSauKhoa.add("nt"); // F4 (decision 2, A): unreadable is not "not pinned", the dispatcher decides on the marked row; it refuses an unpinned write, 0 PDU (khongGhi below)
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(np("p1f4", "NP1"), 1);
    await wait(60);
    const nt = h.sent.filter((x) => x.stepId === "nt");
    expect(nt.length, "the marked route asked the dispatcher").toBeGreaterThan(0);
    expect(nt.every((x) => x.khongGhi === true), "the dispatcher wrote nothing").toBe(true);
    expect(buocBo()).toEqual([]);
    expect(urgentCua("stopNotSent").filter((a) => String(a.title).includes('"nt"')).length).toBeGreaterThan(0);
    expect(runRow(c).status).toBe("held");
  });
  const chuCua = (a: Record<string, any>) => [a.kind, a.dedupKey.split(":")[2], String(a.title), String(a.message).replace(/ \[event [^\]]*\]$/, "")].join(" | ");
  it("LAP-CHU walked twice, the same step named twice: the second URGENT is the first one's words (kind, step, title, message), only the event differs", async () => {
    // (a) work behind a gate a person still answers: named at the pause, named again by the approved walk
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    const c = await centralRun(khung("lapa", CAC()), 1);
    await wait(30);
    const dau = urgentCua("forwardNotSent").map(chuCua);
    h.timeoutDispatch.clear();
    await duyetG2(c);
    await waitFor(() => urgentCua("forwardNotSent").length === 2, "the second word");
    const hai = urgentCua("forwardNotSent").map(chuCua);
    expect(dau).toHaveLength(1);
    expect(hai).toEqual([dau[0], dau[0]]);
    expect(new Set(urgentCua("forwardNotSent").map((a) => a.dedupKey)).size, "two events").toBe(2);
    // (b) a row "not sent" of an earlier walk, named again at the boot
    h.alerts.length = 0;
    h.sent.length = 0;
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c2 = await centralRun(def("lapb", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), move("m")])])]), 1);
    await wait(30);
    const mot = urgentCua("forwardNotSent").map(chuCua);
    chet(c2, ["g1", "p", "x", "v", "m"]);
    await autoResumeInterruptedRuns([c2]);
    await wait(40);
    expect(mot).toHaveLength(1);
    expect(urgentCua("forwardNotSent").map(chuCua), "never 'did NOT go out' one walk and 'may have gone out' the next").toEqual([mot[0]]);
  });
  it("GIU-EDGE xác nhận: acked_verified: the segment ends by its walk, not held, one STOP", async () => {
    h.acked = true;
    h.ackStatus = "acked_verified";
    const e = await diK2e("gex");
    motLan("cs");
    expect(baoEdge(e, "stopNotSent")).toEqual([]);
    expect(runRow(e.runId).status).toBe("failed");
  });

  // ── T6b: the two paths section 12 names before stopToTienMoi / stopToTienSauGiu go ─────────────────────────────────
  // (1) a SECOND unknown step, in another branch, after the first pass started (the pass starts once per walk); its container waits on a hanging sibling
  const haiKhongRo = (ref: string) => def(ref, [gate(), parF("p", [box("a", [move("x1")]), parF("q", [move("x2"), move("hang")], { compensation: robotStop("c2") })])]);
  it("HAI-KHONG-RO central: two unknown steps in two branches, a sibling hangs: the STOP of the second one's container goes while it hangs, once", async () => {
    h.slow.set("x1", 15);
    h.timeoutDispatch.add("x1");
    h.slow.set("x2", 75);
    h.timeoutDispatch.add("x2");
    h.slow.set("hang", 500);
    const { runId: c, di } = await diKhongCho(haiKhongRo("hkr"));
    await trongLuc(di, () => ids().includes("c2"), "the STOP of the second unknown step's container", 300);
    expect(ids().filter((x) => x === "c2"), "once, the last pass does not send it again").toEqual(["c2"]);
    expect(String(hang(c, "x2")!.error)).toMatch(/OUTCOME_UNKNOWN/);
    expect(runRow(c).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "x1" });
  });
  it("HAI-KHONG-RO edge: the same", async () => {
    const e = await denBuoc(haiKhongRo("hkre"));
    h.slow.set("x1", 15);
    h.timeoutDispatch.add("x1");
    h.slow.set("x2", 75);
    h.timeoutDispatch.add("x2");
    h.slow.set("hang", 500);
    const seg = edgeSegment(e, 2);
    await trongLuc(seg, () => ids().includes("c2"), "the STOP of the second unknown step's container", 300);
    expect(ids().filter((x) => x === "c2"), "once, the last pass does not send it again").toEqual(["c2"]);
  });
  // (2) a compensation-only walk (a Continue) of a run latched from its context: the containers' STOPs still due go, each once. Their rows of the first walk are
  // lost (a bounded write can be the one lost, as C7 edge), so nothing says they went: they are due again. x2 is a second unknown, not the latch's step
  it("CHI-BU-TRU-KHOA a Continue of a run latched from its context, two held compensations: the containers' STOPs still due go, each once, with the approved ones", async () => {
    const d = def("cbtk", [gate(), parF("p", [box("a", [move("x1", { compensation: ot("u1") })], { compensation: robotStop("ca") }), box("b", [move("x2", { compensation: ot("u2") })], { compensation: robotStop("cb") })])]);
    h.slow.set("x1", 15);
    h.timeoutDispatch.add("x1");
    h.slow.set("x2", 45);
    h.timeoutDispatch.add("x2");
    const c = await centralRun(d, 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
    expect(runRow(c).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "x1" });
    expect(ids().filter((x) => x === "ca" || x === "cb").sort(), "the first walk sent both").toEqual(["ca", "cb"]);
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== c || (r.stepId !== "ca" && r.stepId !== "cb")));
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.duocSauKhoa.add("u1");
    h.duocSauKhoa.add("u2");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await waitFor(() => ids().includes("ca") && ids().includes("cb"), "the containers' STOPs");
    await wait(40);
    expect(ids().filter((x) => x === "ca"), "ca once").toEqual(["ca"]);
    expect(ids().filter((x) => x === "cb"), "cb once").toEqual(["cb"]);
    expect(ids().filter((x) => x === "x1" || x === "x2"), "nothing forward").toEqual([]);
    expect(ids()).toContain("u1");
  });
});

// ═══ A2(n) T5 ═════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) T5 — a STOP that did not go: the marked route, state C, central and edge", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: false, steps, ...extra }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const stopTyped = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "run", value: 0 }, ...extra }) as never;
  const ids = () => h.sent.map((x) => x.stepId as string);
  const sentOf = (id: string) => ids().filter((x) => x === id);
  const lanThu = (id: string) => h.sent.filter((x) => x.stepId === id).map((x) => x.lan);
  const hang = (runId: number, id: string) => stepRows(runId).find((r) => r.stepId === id);
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const authCua = (e: EdgeHarness, id: string) => e.authorizeCalls.filter((a) => a.stepId === id).length;
  const urgentC = () => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.stopNotSent);
  const chu = () => urgentC().map((a) => `${a.title} ${a.message}`).join(" | ");
  const canhBaoKhac = () => h.alerts.filter((a) => a.kind !== CANH_BAO_KHONG_RO_KIND.stopNotSent).map((a) => a.kind);
  const hangDau = () => (fake.store.get("ai_pending_actions") ?? []).filter((a) => JSON.stringify(a.previewJson ?? {}).includes("hangMoiStopGhim"));
  const khongRo = /OUTCOME_UNKNOWN/;
  const noCua = (c: number) => stopChuaRaTuHang(stepRows(c) as never);
  const hetCho = async (runId: number, ms = 1_500) => {
    await waitFor(() => !["running", "compensating", "queued"].includes(String(runRow(runId).status)), "the end of the walk", ms);
    await wait(30);
  };
  const REF = { status: "rejected", error: "INTERLOCK_NOT_MET: refused by rule 7 at 10.1.2.3" };
  const dV = (ref: string, st: WorkflowStep = otStop("st")) => def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 40), st])])]);
  const dC = (ref: string, cs: WorkflowStep = otStop("cs")) => def(ref, [gate(), move("x", { compensation: cs })]);
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    return e;
  }
  /** Abort after the read recovered: what it sends */
  async function abortGui(c: number) {
    h.tuChoi.clear();
    h.failPlan.clear();
    h.timeoutDispatch.clear();
    h.ghim = PIN_OK;
    h.connOk = true;
    h.dispatcherKhongDoc = false;
    h.sent.length = 0;
    const a = await abortRun(c, OWNER, "press");
    await wait(30);
    return a;
  }
  /** the alerts of an edge run: central raises them from the anomaly (h.alerts) at the segment end */
  const lech = (x: unknown) => String(x);

  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  const BANG: string[] = [];
  beforeEach(() => vi.mocked(logCrudOperation).mockClear());
  afterEach(() => {
    delete process.env.FOE_DURABLE;
    h.dispatcherThat = false;
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    BANG.push(`${String(expect.getState().currentTestName).split(" > ").pop()?.slice(0, 70)} | ${sau.map((x) => `${String(x.stepId)}:${String(x.name)}${x.khongGhi ? ":0PDU" : ""}`).join(" ") || "-"}`);
    // by the PIN: an OT stop counts only when every write it carries is a pin of its adapter. A command the dispatcher itself refused wrote nothing, that is the route (khongGhi)
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return LA_STOP.has(String(x.name));
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    const la = sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)) && x.khongGhi !== true && !h.duocSauKhoa.has(String(x.stepId)));
    expect(la.map((x) => x.stepId), "a command that is no pinned STOP reached a device after the latch").toEqual([]);
  });
  afterAll(() => {
    for (const l of BANG) console.log(`[PROBE sau-khoa T5] ${l}`);
  });

  // ── the fixture itself ─────────────────────────────────────────────────────────────────────────────────────────────
  it("h.dispatcherThat tells a real pin from what h.ghim says: an unpinned stop on a marked row writes nothing; h.tuChoi and h.policyTuChoi reach their target", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.ghim = async () => ({ pinnedStop: true, loiDocGhim: null }); // h.ghim says pinned, the tag is not
    await centralRun(def("fx1", [gate(), stopTyped("nt")]), 1);
    await wait(50);
    const r = h.sent.filter((x) => x.stepId === "nt");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.khongGhi === true), "a fixture that lets an unpinned stop through measures nothing").toBe(true);
  });
  it("h.tuChoi answers the dispatch; a thrown one throws; both reach sendCommand, 10 rounds", async () => {
    for (let i = 0; i < 10; i++) {
      h.tuChoi.set("rs", REF);
      const a = await (await import("../../equipment/equipmentAdapter")).equipmentRegistry.getAdapter("robot" as never).sendCommand({ idempotencyKey: "run1-rs-a1", name: "abort" } as never);
      expect(a).toMatchObject({ ok: false, status: "rejected" });
      h.tuChoi.set("rs", { nem: "threw (test)" });
      await expect((await import("../../equipment/equipmentAdapter")).equipmentRegistry.getAdapter("robot" as never).sendCommand({ idempotencyKey: "run1-rs-a1", name: "abort" } as never)).rejects.toThrow("threw (test)");
      h.tuChoi.clear();
    }
  });

  // ── F4 non-DB ──────────────────────────────────────────────────────────────────────────────────────────────────────
  it("R1 a non-STOP, the pin read failing, on a latched run: not on the route: no mark, not sent", async () => {
    h.ghim = PIN_BAD;
    h.timeoutDispatch.add("x");
    const c = await centralRun(dV("r1", ot("r3")), 1);
    await wait(30);
    expect(sentOf("r3")).toEqual([]);
    expect(hangDau()).toEqual([]);
    expect(String(hang(c, "r3")!.error)).toMatch(/^FOE_NOT_SENT_RUN_LATCHED: /);
  });
  it("R2 + V-CTL stop-typed, read fine, not pinned, forward: not sent, failed, no state C", async () => {
    seedHalt();
    h.timeoutDispatch.add("x");
    const c = await centralRun(dV("r2", stopTyped("st")), 1);
    await hetCho(c);
    expect(sentOf("st")).toEqual([]);
    expect(String(hang(c, "st")?.error)).not.toMatch(/FOE_STOP_NOT_SENT/);
    expect(noCua(c).size).toBe(0);
    expect(urgentC()).toEqual([]);
    expect(runRow(c).status).toBe("failed");
  });
  it("V-CTL-COMP stop-typed compensation, read fine, not pinned: held by n1, not state C", async () => {
    seedHalt();
    h.timeoutDispatch.add("x");
    const c = await centralRun(dC("vctlc", stopTyped("cs")), 1);
    await hetCho(c);
    expect(sentOf("cs")).toEqual([]);
    expect(hang(c, "cs")).toMatchObject({ status: "held" });
    expect(noCua(c).size).toBe(0);
    expect(urgentC()).toEqual([]);
  });
  it("R3 a run NOT latched, the pin read failing: an ordinary row, no mark, the dispatcher's own path", async () => {
    seedHalt();
    h.ghim = PIN_BAD;
    const c = await centralRun(def("r3", [gate(), otStop("st")]), 1);
    await wait(30);
    expect(sentOf("st")).toEqual(["st"]);
    expect(hangDau()).toEqual([]);
    expect(runRow(c).status).toBe("completed");
  });
  it("R4 + F12-24 forward STOP, pins unreadable on a latched run: handed over on a MARKED fresh row, the dispatcher decides, it goes", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.ghim = PIN_BAD;
    h.timeoutDispatch.add("x");
    const c = await centralRun(dV("r4"), 1);
    await hetCho(c);
    expect(sentOf("st")).toEqual(["st"]);
    expect(hangDau().length).toBe(1);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
    expect(h.sent.find((x) => x.stepId === "st")?.khongGhi).toBeFalsy();
    expect(urgentC()).toEqual([]);
  });
  it("F4-B a stop-typed step NOT pinned, FOE's read failing: the marked row, the dispatcher refuses it, 0 PDU, state C, the run is not completed", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.ghim = PIN_BAD;
    h.connOk = false; // the sweep's verifier cannot tell either: else it answers "not pinned" and nothing reaches a dispatcher
    h.timeoutDispatch.add("x");
    const c = await centralRun(dV("f4b", stopTyped("st")), 1);
    await hetCho(c);
    expect(h.sent.filter((x) => x.stepId === "st").every((x) => x.khongGhi === true)).toBe(true);
    expect(hangDau().length).toBeGreaterThan(0);
    expect(String(hang(c, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: /);
    expect(runRow(c).status).toBe("held");
  });
  it("F4-C2 + F12-30c the dispatcher cannot read the pins either, no approval: state C, -a1..a3, the words of a read; F4-C2b the read recovers: Abort sends it", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true;
    h.ghim = PIN_BAD;
    h.timeoutDispatch.add("x");
    const c = await centralRun(dV("f4c2"), 1);
    await hetCho(c);
    expect(lanThu("st")).toEqual(["1", "2", "3"]);
    expect(hang(c, "st")).toMatchObject({ status: "failed", attempt: 3 });
    expect(String(hang(c, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out/);
    expect(runRow(c).status).toBe("held");
    expect(chu()).toContain("once the read recovers");
    const a = await abortGui(c);
    expect(ids()).toEqual(["st"]);
    expect(a.abortStops?.sent).toEqual(["st"]);
    expect(noCua(c).size).toBe(0);
  });
  it("R5 + B2 edge: an unverified forward STOP on a latched run: no authorisation, 0 /authorize, the edge dispatcher decides", async () => {
    seedHalt();
    h.connOk = false;
    const e = await denBuoc(dV("r5e"));
    h.dispatcherThat = true;
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(sentOf("st")).toEqual(["st"]);
    expect(authCua(e, "st")).toBe(0);
    expect(h.sent.find((x) => x.stepId === "st")?.edge).toMatchObject({ authorization: null });
    expect(hang(e.runId, "st")).toMatchObject({ status: "completed" });
  });
  it("R6 edge: a non-STOP the package wrongly lists unsure: never the route: it asks, and the door stops it", async () => {
    const e = await denBuoc(dV("r6e", ot("r3")));
    e.suaGoi = (p) => ({ ...p, stopsUnsure: ["r3"] });
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(sentOf("r3")).toEqual([]);
    expect(String(hang(e.runId, "r3")!.error)).toMatch(/^FOE_NOT_SENT_RUN_LATCHED: /);
  });
  it("R6b edge: the same non-STOP asked before the latch, the sink refuses it: no route, no hand-over, reported unused", async () => {
    const e = await denBuoc(def("r6be", [gate(), parF("p", [move("x"), ot("r3")])]));
    e.suaGoi = (p) => ({ ...p, stopsUnsure: ["r3"] });
    e.unused = [];
    e.authorizeDelay = new Map([["r3", 60]]);
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(sentOf("r3")).toEqual([]);
    expect(e.unused.map((u) => u.stepId)).toContain("r3");
  });

  it("R6c edge: an APPROVED non-STOP compensation the package wrongly lists unsure: it asks /authorize and carries the authorisation, never the route", async () => {
    const e = await denBuoc(dC("r6c", ot("u")));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(30);
    expect(runRow(e.runId).status).toBe("held");
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown(e, "checked on site");
    e.suaGoi = (p) => ({ ...p, stopsUnsure: ["u"] });
    await edgeSegment(e, 3);
    expect(sentOf("u")).toEqual(["u"]);
    expect(authCua(e, "u")).toBe(1);
    expect((h.sent.find((x) => x.stepId === "u")?.edge as { authorization?: unknown } | null)?.authorization).toBeTruthy();
  });

  // ── B11, B12 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  it("B11 + F12-39 central: a refused step's STOP compensation, pins unreadable: the marked route, it goes", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.ghim = PIN_BAD;
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("b11", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), move("r3", { compensation: otStop("cs") })])])]), 1);
    await hetCho(c);
    expect(sentOf("cs")).toEqual(["cs"]);
    expect(hangDau().length).toBe(1);
  });
  it("B11 edge: the same, the package could not verify it: no authorisation", async () => {
    seedHalt();
    h.connOk = false;
    const e = await denBuoc(def("b11e", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), move("r3", { compensation: otStop("cs") })])])]));
    h.dispatcherThat = true;
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(sentOf("cs")).toEqual(["cs"]);
    expect(authCua(e, "cs")).toBe(0);
    expect(h.sent.find((x) => x.stepId === "cs")?.edge).toMatchObject({ authorization: null });
  });
  it("F12-25 + F4-COMP the compensation of an unknown step, pins unreadable: laBuTruStop says not read, the marked route, it goes", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.ghim = PIN_BAD;
    h.timeoutDispatch.add("x");
    const c = await centralRun(dC("f4comp"), 1);
    await hetCho(c);
    expect(sentOf("cs")).toEqual(["cs"]);
    expect(hangDau().length).toBe(1);
    expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
  });
  it("F12-25-NEM the store's STOP check throws: no answer is no 'not a STOP': the compensation is not held, it goes", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await denBuoc(dC("f4nem"));
    e.laStopNem = true;
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(30);
    expect(sentOf("cs")).toEqual(["cs"]);
    expect(h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.held)).toEqual([]);
  });
  it("F12-25-TACH the split ahead of the pass, pins unreadable: not held for a person, it goes by the marked route", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.ghim = PIN_BAD;
    let mo = () => undefined as void;
    h.sauTimeout = () => {
      h.connCho = new Promise<void>((ok) => (mo = ok)); // the first pass stands before its verifier: the walker's own split decides first
      setTimeout(() => mo(), 60);
    };
    h.timeoutDispatch.add("x");
    const c = await centralRun(dC("f4tach"), 1);
    await hetCho(c);
    expect(sentOf("cs")).toEqual(["cs"]);
    expect(h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.held)).toEqual([]);
    expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
  });
  it("F4-COMP-C the same, the dispatcher cannot read either, no approval: state C with its budget, -a1..a3; Abort sends it after the read recovers", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true;
    h.ghim = PIN_BAD;
    h.timeoutDispatch.add("x");
    const c = await centralRun(dC("f4compc"), 1);
    await hetCho(c);
    expect(lanThu("cs")).toEqual(["1", "2", "3"]);
    expect(runRow(c).status).toBe("held");
    expect(String(hang(c, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "cs"/);
    expect(chu()).toContain('"cs"');
    await abortGui(c);
    expect(ids()).toEqual(["cs"]);
  });
  it("B12 + F12-30b the adapter lookup lost around the latch: no dispatcher to ask, the budget runs, not settled, held; the lookup back, Abort sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    const luu = rows("device_adapters");
    h.sauTimeout = () => fake.store.set("device_adapters", []);
    const c = await centralRun(dV("b12"), 1);
    await hetCho(c);
    expect(sentOf("st")).toEqual([]);
    expect(hang(c, "st")).toMatchObject({ status: "failed", attempt: 3 });
    expect(String(hang(c, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: /);
    expect(runRow(c).status).toBe("held");
    expect(chu()).toContain("once the read recovers");
    fake.store.set("device_adapters", luu);
    await abortGui(c);
    expect(ids()).toEqual(["st"]);
  });
  it("B12 compensation: the same", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    const luu = rows("device_adapters");
    h.sauTimeout = () => fake.store.set("device_adapters", []);
    const c = await centralRun(dC("b12c"), 1);
    await hetCho(c);
    expect(sentOf("cs")).toEqual([]);
    expect(String(hang(c, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "cs"/);
    expect(hang(c, "cs")).toMatchObject({ status: "failed" });
    expect(runRow(c).status).toBe("held");
    fake.store.set("device_adapters", luu);
    await abortGui(c);
    expect(ids()).toEqual(["cs"]);
  });

  // ── the race of the door and the latch ─────────────────────────────────────────────────────────────────────────────
  /** the STOP's question hangs until the latch: asked before it, answered after it */
  const hoiTruocChot = (lan1: { pinnedStop: boolean; loiDocGhim: string | null }, sau: { pinnedStop: boolean; loiDocGhim: string | null }, kieu = "stop") => {
    let n = 0;
    return async (_d: unknown, i: { commandType: string }) => {
      if (i.commandType !== kieu) return { pinnedStop: false, loiDocGhim: null };
      if (n++ === 0) {
        await waitFor(() => h.traTimeout > 0, "the latch", 1_000);
        await wait(5);
        return lan1;
      }
      return sau;
    };
  };
  const BAD = { pinnedStop: false, loiDocGhim: "pin read down (test)" };
  const KHONG = { pinnedStop: false, loiDocGhim: null };
  const dDua = (ref: string, st: WorkflowStep = otStop("st")) => def(ref, [gate(), parF("p", [move("x"), st])]);
  it("F4-A-race ×10 a real STOP asks before the latch, FOE's question fails: the sink refuses it, it asks again, the marked row, one hand-over", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.traTimeout = 0;
      h.timeoutDispatch.clear();
      fake.store.set("ai_pending_actions", []);
      seedHalt();
      h.dispatcherThat = true;
      h.ghim = hoiTruocChot(BAD, BAD);
      h.slow.set("x", 10);
      h.timeoutDispatch.add("x");
      const c = await centralRun(dDua(`far${i}`), 1);
      await hetCho(c);
      const k = `run=${runRow(c).status} st=${sentOf("st").length} marked=${hangDau().length > 0} row=${hang(c, "st")?.status}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    expect([...dem]).toEqual([["run=failed st=1 marked=true row=completed", 10]]);
  });
  it("F4-A-race-tre a slow sibling: the STOP does not wait for it", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.ghim = hoiTruocChot(BAD, BAD);
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 400);
    const d = def("fart", [gate(), parF("p", [move("x"), move("hang"), otStop("st")])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const view = (await getRun(s.runId!, { bindingDigest: true }))!;
    const di = resumeRun(s.runId!, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => sentOf("st").length > 0, "the STOP", 200);
    expect(h.slow.has("hang")).toBe(true);
    await di;
  });
  it("F4-C2-race ×10 the dispatcher cannot read either, the STOP asks before the latch: state C on the row, held, Abort sends it", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.traTimeout = 0;
      h.timeoutDispatch.clear();
      seedHalt();
      h.dispatcherThat = true;
      h.dispatcherKhongDoc = true;
      h.ghim = hoiTruocChot(BAD, BAD);
      h.slow.set("x", 10);
      h.timeoutDispatch.add("x");
      const c = await centralRun(dDua(`f2r${i}`), 1);
      await hetCho(c);
      const trang = `run=${runRow(c).status} C=${noCua(c).has("st")}`;
      await abortGui(c);
      h.dispatcherThat = true;
      const k = `${trang} abort=${sentOf("st").length}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    expect([...dem]).toEqual([["run=held C=true abort=1", 10]]);
  });
  for (const [ten, loi, coCong] of [["FOE read fails, gate approved", true, true], ["FOE read fails, no gate", true, false], ["read fine, gate approved", false, true], ["read fine, no gate", false, false]] as const) {
    it(`F4-B-race a stop-typed step really NOT pinned, ${ten}: 0 PDU`, async () => {
      seedHalt();
      h.dispatcherThat = true;
      h.ghim = hoiTruocChot(loi ? BAD : KHONG, loi ? BAD : KHONG);
      h.slow.set("x", 10);
      h.timeoutDispatch.add("x");
      const c = coCong ? await centralRun(dDua(`fbr${ten.length}${loi}`, stopTyped("nt")), 1) : await centralRun(def(`fbn${loi}`, [parF("p", [otStop("x"), stopTyped("nt")])]), 0);
      await hetCho(c);
      expect(h.sent.filter((x) => x.stepId === "nt").every((x) => x.khongGhi === true), "an unpinned stop was written").toBe(true);
      expect(runRow(c).status).not.toBe("completed");
    });
  }
  it("R2-race a stop-typed step asked before the latch, read fine, not pinned, still so at the second ask: not on the route, not sent", async () => {
    seedHalt();
    h.ghim = hoiTruocChot(KHONG, KHONG);
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(dDua("r2r", stopTyped("nt")), 1);
    await hetCho(c);
    expect(sentOf("nt")).toEqual([]);
    expect(hangDau()).toEqual([]);
    expect(noCua(c).size).toBe(0);
  });
  it("F4-D-race a non-STOP asks before the latch: 0 hand-overs, its row says so, no mark", async () => {
    h.ghim = hoiTruocChot(BAD, BAD, "start");
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(dDua("fdr", ot("r3")), 1);
    await hetCho(c);
    expect(sentOf("r3")).toEqual([]);
    expect(hangDau()).toEqual([]);
    expect(String(hang(c, "r3")!.error)).toMatch(/^FOE_NOT_SENT_RUN_LATCHED: /);
  });
  it("F4-D2 an APPROVED non-STOP compensation, the pin read fails: the ordinary route, no mark", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(dC("fd2", ot("u")), 1);
    await hetCho(c);
    expect(runRow(c).status).toBe("held");
    h.ghim = PIN_BAD;
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await waitFor(() => ids().includes("u"), "the approved compensation");
    expect(hangDau()).toEqual([]);
  });
  it("F4-R2 the sink refused the STOP, its second ask fails too: the pass sends it, exactly once", async () => {
    seedHalt();
    h.dispatcherThat = true;
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return KHONG;
      if (++n === 1) {
        await waitFor(() => h.traTimeout > 0, "the latch", 1_000);
        await wait(5);
      }
      return BAD;
    };
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(dDua("fr2"), 1);
    await hetCho(c);
    expect(sentOf("st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
  });
  it("F4-R2b the sink refuses twice (the second ask answers: read fine, not pinned), the read then says pinned: the pass sends it, exactly once", async () => {
    seedHalt();
    h.dispatcherThat = true;
    let n = 0;
    h.ghim = async (_d, i) => {
      if (i.commandType !== "stop") return KHONG;
      n++;
      if (n === 1) {
        await waitFor(() => h.traTimeout > 0, "the latch", 1_000);
        await wait(5);
        return BAD;
      }
      return n === 2 ? KHONG : { pinnedStop: true, loiDocGhim: null };
    };
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(dDua("fr2b"), 1);
    await hetCho(c);
    expect(sentOf("st")).toEqual(["st"]);
  });
  it("F4-R2c the sink refuses the STOP twice BEFORE the first pass looks: the pass still sends it, exactly once", async () => {
    seedHalt();
    h.dispatcherThat = true;
    let mo = () => undefined as void;
    h.sauTimeout = () => {
      h.connCho = new Promise<void>((ok) => (mo = ok)); // from the latch on: a deploy and a start have read the connection before it
    };
    let n = 0;
    h.ghim = async (_d, i) => {
      if (i.commandType !== "stop") return KHONG;
      n++;
      if (n === 1) {
        await waitFor(() => h.traTimeout > 0, "the latch", 1_000);
        await wait(5);
        return BAD;
      }
      if (n === 2) {
        setTimeout(mo, 10); // the sink has refused twice: the first pass may look now
        return KHONG;
      }
      return { pinnedStop: true, loiDocGhim: null };
    };
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(dDua("fr2c"), 1);
    await hetCho(c);
    expect(n).toBeGreaterThan(2);
    expect(sentOf("st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
  });
  it("COMP-RACE central, pins unreadable for good: the marked row, the dispatcher decides, 0 PDU if not pinned", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.ghim = hoiTruocChot(BAD, BAD);
    h.slow.set("x", 25);
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("crdv", [gate(), parF("p", [move("x"), ot("f", { compensation: otStop("cs") })])]), 1);
    await hetCho(c);
    expect(sentOf("cs")).toEqual(["cs"]);
    expect(h.sent.find((x) => x.stepId === "cs")?.khongGhi).toBeFalsy();
    h.sent.length = 0;
    h.traTimeout = 0;
    h.timeoutDispatch.clear();
    h.ghim = hoiTruocChot(BAD, BAD);
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("x");
    const c2 = await centralRun(def("crdv2", [gate(), parF("p", [move("x"), ot("f", { compensation: stopTyped("cs") })])]), 1);
    await hetCho(c2);
    expect(h.sent.filter((x) => x.stepId === "cs").every((x) => x.khongGhi === true)).toBe(true);
  });
  it("COMP-RACE edge, pins unreadable for good: no second /authorize, no authorisation, the edge dispatcher decides", async () => {
    seedHalt();
    h.connOk = false;
    const e = await denBuoc(def("crde", [gate(), parF("p", [move("x"), ot("f", { compensation: otStop("cs") })])]));
    h.dispatcherThat = true;
    e.authorizeDelay = new Map([["cs", 60]]);
    h.timeoutDispatch.add("x");
    h.slow.set("x", 25);
    h.failPlan.set("f", 1);
    await edgeSegment(e, 2);
    expect(sentOf("cs")).toEqual(["cs"]);
    expect(authCua(e, "cs")).toBe(1);
    expect(h.sent.find((x) => x.stepId === "cs")?.edge).toMatchObject({ authorization: null });
    await wait(30);
    expect(h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.held), "asked again at the sink: no hold, nobody sent to a person for a STOP that went").toEqual([]);
  });

  // ── V-REF: a clear refusal ─────────────────────────────────────────────────────────────────────────────────────────
  it("V-REF central, forward: refused: -a1..a3, the row says so with a code and no driver text, held, a URGENT by name, Abort sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
    const c = await centralRun(dV("vref"), 1);
    await hetCho(c);
    expect(lanThu("st")).toEqual(["1", "2", "3"]);
    expect(hang(c, "st")).toMatchObject({ status: "failed", attempt: 3 });
    const loi = String(hang(c, "st")!.error);
    expect(loi).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out/);
    expect(loi).toContain("INTERLOCK_NOT_MET");
    expect(loi).not.toContain("10.1.2.3");
    expect(noCua(c)).toEqual(new Set(["st"]));
    expect(runRow(c).status).toBe("held");
    expect(String(runRow(c).error)).toMatch(/^FOE_STOP_NOT_SENT: /);
    expect(String(runRow(c).error)).toMatch(/Abort/);
    expect(urgentC().map((a) => a.dedupKey.split(":")[2])).toEqual(["st"]);
    expect(chu()).toContain("INTERLOCK_NOT_MET");
    expect(chu()).toContain("Abort");
    expect(chu()).not.toContain("once the read recovers");
    expect(chu()).not.toContain("10.1.2.3");
    const a = await abortGui(c);
    expect(ids()).toEqual(["st"]);
    expect(a.abortStops?.sent).toEqual(["st"]);
    expect(runRow(c).status).toBe("aborted");
    expect(noCua(c).size).toBe(0);
  });
  it("V-REF-COMP central: the same for a compensation: its budget in guiStopKhongRo, held, Abort sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("cs", REF);
    const c = await centralRun(dC("vrefc"), 1);
    await hetCho(c);
    expect(lanThu("cs")).toEqual(["1", "2", "3"]);
    expect(String(hang(c, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "cs"/);
    expect(runRow(c).status).toBe("held");
    expect(urgentC().map((a) => a.dedupKey.split(":").slice(2, 4))).toEqual([["x", "cs"]]);
    expect(canhBaoKhac()).not.toContain(CANH_BAO_KHONG_RO_KIND.stopNotConfirmed);
    await abortGui(c);
    expect(ids()).toEqual(["cs"]);
  });
  it("V-REF-EDGE forward: held(outcomeUnknown), the URGENT through central, Abort sends it; the run's words say Abort, never Continue (N9)", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await denBuoc(dV("vrefe"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", { ...REF, detail: { edge: true, reason: "INTERLOCK_NOT_MET" } });
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(lanThu("st")).toEqual(["1", "2", "3"]);
    expect(runRow(e.runId).status).toBe("held");
    expect(String(hang(e.runId, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: /);
    expect(String(runRow(e.runId).error)).toMatch(/Abort/);
    expect(String(runRow(e.runId).error)).not.toMatch(/Continue/);
    expect(urgentC().map((a) => a.dedupKey.split(":").slice(2, 4))).toEqual([["st", "-"]]);
    await abortGui(e.runId);
    expect(ids()).toEqual(["st"]);
  });
  it("V-REF-EDGE compensation: the same", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await denBuoc(dC("vrefce"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("cs", { ...REF, detail: { edge: true, reason: "INTERLOCK_NOT_MET" } });
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(lanThu("cs")).toEqual(["1", "2", "3"]);
    expect(urgentC().map((a) => a.dedupKey.split(":").slice(2, 4))).toEqual([["x", "cs"]]);
    await abortGui(e.runId);
    expect(ids()).toEqual(["cs"]);
  });
  it("C-NGAY state C is told when it is decided, never behind a sibling that hangs", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 10);
    h.slow.set("treo", 350);
    h.tuChoi.set("st", REF);
    const d = def("cngay", [gate(), parF("p", [move("x"), move("treo"), box("b", [delay("w", 40), otStop("st", { maxAttempts: 0 })])])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const view = (await getRun(s.runId!, { bindingDigest: true }))!;
    const di = resumeRun(s.runId!, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => urgentC().length > 0, "the URGENT, the sibling still hanging", 250);
    expect(runRow(s.runId!).status).not.toBe("held");
    await di;
    await hetCho(s.runId!);
    expect(urgentC()).toHaveLength(1);
    expect(runRow(s.runId!).status).toBe("held");
  });
  it("V-REF a retry that goes: no debt, no hold, no URGENT of state C", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.failPlan.set("st", 1);
    const c = await centralRun(dV("vretry"), 1);
    await hetCho(c);
    expect(lanThu("st")).toEqual(["1", "2"]);
    expect(hang(c, "st")).toMatchObject({ status: "completed", error: null });
    expect(noCua(c).size).toBe(0);
    expect(urgentC()).toEqual([]);
    expect(runRow(c).status).toBe("failed");
  });
  it("V-NONSTOP central: a non-STOP refused on a latched run: no debt, never 'STOP'", async () => {
    h.slow.set("mv", 60);
    h.tuChoi.set("mv", { status: "rejected", error: "ROBOT_REFUSED" });
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("vns", [gate(), parF("p", [move("mv"), box("b", [delay("w", 10), move("x")])])]), 1);
    await hetCho(c);
    expect(noCua(c).size).toBe(0);
    expect(urgentC()).toEqual([]);
    expect(String(hang(c, "mv")!.error)).not.toMatch(/FOE_STOP_NOT_SENT/);
    expect(runRow(c).status).toBe("failed");
  });
  it("V-NONSTOP edge: the same", async () => {
    const e = await denBuoc(def("vnse", [gate(), parF("p", [move("mv"), box("b", [delay("w", 10), move("x")])])]));
    h.slow.set("mv", 60);
    h.tuChoi.set("mv", { status: "rejected", error: "ROBOT_REFUSED", detail: { edge: true } });
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out.outcome).toBe("failed");
    expect(urgentC()).toEqual([]);
  });

  // ── a stop-typed step refused on the way in: the layer at execCommand, not a return (C2) ───────────────────────────
  it("R3-B central, forward: the dispatch throws: state C, 'not confirmed out', never 'did NOT go out', Abort sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", { nem: "db down in dispatch 10.1.2.3 (test)" });
    const c = await centralRun(dV("r3b"), 1);
    await hetCho(c);
    const loi = String(hang(c, "st")!.error);
    expect(loi).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" is not confirmed out/);
    expect(loi).not.toContain("10.1.2.3");
    expect(runRow(c).status).toBe("held");
    expect(chu()).toContain("not confirmed out");
    expect(chu()).not.toContain("did NOT go out");
    await abortGui(c);
    expect(ids()).toEqual(["st"]);
  });
  it("R3-B2 central, compensation: the same", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("cs", { nem: "db down in dispatch (test)" });
    const c = await centralRun(dC("r3b2"), 1);
    await hetCho(c);
    expect(String(hang(c, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "cs" is not confirmed out/);
    expect(runRow(c).status).toBe("held");
    expect(chu()).toContain("not confirmed out");
    await abortGui(c);
    expect(ids()).toEqual(["cs"]);
  });
  it("R3-B edge: the same forward", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await denBuoc(dV("r3be"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", { nem: "db down in dispatch (test)" });
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(chu()).toContain("not confirmed out");
  });
  it("R3-B a thrown STOP on a run not latched: unchanged, the throw is the walk's failure", async () => {
    h.tuChoi.set("rs", { nem: "threw (test)" });
    const c = await centralRun(def("r3bn", [gate(), robotStop("rs")]), 1);
    await hetCho(c);
    expect(String(hang(c, "rs")!.error)).toBe("threw (test)");
    expect(runRow(c).status).toBe("failed");
  });
  it("R3-C edge, a package that could not verify the STOP, its dispatcher says pinned but ADAPTER_OFFLINE: held, did NOT go out, Abort sends it", async () => {
    seedHalt();
    h.connOk = false;
    h.ghim = PIN_OK;
    const e = await denBuoc(dV("r3c"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", { status: "failed", error: "ADAPTER_OFFLINE", detail: { edge: true, reason: "ADAPTER_OFFLINE", pinnedStop: true } });
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(String(hang(e.runId, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out/);
    expect(chu()).toContain("ADAPTER_OFFLINE");
    await abortGui(e.runId);
    expect(ids()).toEqual(["st"]);
  });
  it("R3-G a pinned STOP, the driver write failed: 'not confirmed out', the code, no driver text, held, Abort sends it again", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", { status: "failed", error: "socket hang up while writing 10.1.2.3", detail: { reason: "DRIVER_ERROR" } });
    const c = await centralRun(dV("r3g"), 1);
    await hetCho(c);
    const loi = String(hang(c, "st")!.error);
    expect(loi).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" is not confirmed out/);
    expect(loi).toContain("DRIVER_ERROR");
    expect(loi).not.toContain("10.1.2.3");
    expect(chu()).toContain("not confirmed out");
    expect(chu()).not.toContain("did NOT go out");
    expect(chu()).not.toContain("once the read recovers");
    expect(runRow(c).status).toBe("held");
    await abortGui(c);
    expect(ids()).toEqual(["st"]);
  });
  for (const ma of ["ADAPTER_OFFLINE", "DB_UNAVAILABLE", "LEDGER_INTENT_FAILED"]) {
    it(`H11 ${ma}, status failed, nothing written: 'did NOT go out'`, async () => {
      seedHalt();
      h.ghim = PIN_OK;
      h.timeoutDispatch.add("x");
      h.tuChoi.set("st", { status: "failed", detail: { reason: ma } });
      const c = await centralRun(dV(`h11${ma.length}`), 1);
      await hetCho(c);
      expect(String(hang(c, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out/);
      expect(chu()).toContain(ma);
    });
  }
  it("V-SEC SEC_PLATFORM on, the policy refuses a STOP on a latched run, forward: state C, the URGENT says so, Abort sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.policyTuChoi.add("st");
    h.timeoutDispatch.add("x");
    const c = await centralRun(dV("vsec"), 1);
    await hetCho(c);
    expect(sentOf("st")).toEqual([]);
    expect(String(hang(c, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out/);
    expect(String(hang(c, "st")!.error)).toContain("POLICY_DENIED");
    expect(runRow(c).status).toBe("held");
    expect(chu()).toContain("POLICY_DENIED");
    h.policyTuChoi.clear();
    await abortGui(c);
    expect(ids()).toEqual(["st"]);
  });
  it("V-SEC compensation: the same", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.policyTuChoi.add("cs");
    h.timeoutDispatch.add("x");
    const c = await centralRun(dC("vsecc"), 1);
    await hetCho(c);
    expect(String(hang(c, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "cs" did NOT go out/);
    expect(runRow(c).status).toBe("held");
    h.policyTuChoi.clear();
    await abortGui(c);
    expect(ids()).toEqual(["cs"]);
  });
  const buocMayMat = (id: string): WorkflowStep => ({ id, type: "command", machineId: 3, command: "abort", args: { robotId: 2 } }) as never;
  it("H1 Machine not found on a latched run (a package without the machine): a stop-typed step by its command: state C; Abort sends it", async () => {
    fake.seed(machines, [...rows("machines"), { id: 3, machineType: "ROBOT", capabilities: null, code: "R3", name: "Robot-3", operationStatus: "stopped", stationId: 1 }]);
    const e = await denBuoc(dV("h1mm", buocMayMat("st")));
    e.suaGoi = (p) => ({ ...p, machines: p.machines.filter((m) => m.id !== 3) });
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(String(hang(e.runId, "st")?.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out/);
    expect(chu()).toContain("MACHINE_NOT_FOUND");
    await abortGui(e.runId);
    expect(ids()).toEqual(["st"]);
  });
  it("H1 Command not supported on a latched run (a package whose machine lost it): the same", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    fake.seed(machines, [...rows("machines"), { id: 3, machineType: "ROBOT", capabilities: null, code: "R3", name: "Robot-3", operationStatus: "stopped", stationId: 1 }]);
    const e = await denBuoc(dV("h1cn", { id: "st", type: "command", machineId: 3, command: "e_stop", args: { robotId: 2 } } as never));
    e.suaGoi = (p) => ({ ...p, machines: p.machines.map((m) => (m.id === 3 ? { ...m, machineType: "CMM" } : m)) }); // a CMM has no e_stop
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(String(hang(e.runId, "st")?.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out/);
    await abortGui(e.runId);
    expect(ids()).toEqual(["st"]);
  });
  it("H1 đối chứng: a non-STOP whose machine cannot be resolved: no debt", async () => {
    fake.seed(machines, [...rows("machines"), { id: 3, machineType: "ROBOT", capabilities: null, code: "R3", name: "Robot-3", operationStatus: "stopped", stationId: 1 }]);
    const mv: WorkflowStep = { id: "st", type: "command", machineId: 3, command: "run_job", args: { robotId: 2, jobType: "move", params: { x: 1 } } } as never;
    const e = await denBuoc(dV("h1ns", mv));
    e.suaGoi = (p) => ({ ...p, machines: p.machines.filter((m) => m.id !== 3) });
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(30);
    expect(urgentC()).toEqual([]);
    expect(noCua(e.runId).size).toBe(0);
  });
  it("H1 a stop-typed step nothing resolves, unverified: the pass sends it to the layer all the same: state C", async () => {
    fake.seed(machines, [...rows("machines"), { id: 3, machineType: "ROBOT", capabilities: null, code: "R3", name: "Robot-3", operationStatus: "stopped", stationId: 1 }]);
    const e = await denBuoc(dV("h1uv", buocMayMat("st")));
    e.suaGoi = (p) => ({ ...p, machines: p.machines.filter((m) => m.id !== 3), verifiedStops: p.verifiedStops.filter((v) => v.stepId !== "st"), stopsUnsure: ["st"] });
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(String(hang(e.runId, "st")?.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
  });
  it("H1 authorizeCommand throws on a latched run (edge): state C, not confirmed out; a refusal at /authorize of a STOP the package could not verify: state C", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await denBuoc(dV("h1at"));
    e.authNem = new Set(["st"]);
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(String(hang(e.runId, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" is not confirmed out/);
  });
  it("H1 a stop-typed step read fine, not pinned, on the edge, /authorize refuses it: NOT state C", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await denBuoc(def("h1nt", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), stopTyped("nt")])])]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(30);
    expect(String(hang(e.runId, "nt")?.error ?? "")).not.toMatch(/FOE_STOP_NOT_SENT/);
    expect(urgentC()).toEqual([]);
  });

  // ── V-ROBOT ────────────────────────────────────────────────────────────────────────────────────────────────────────
  for (const [ten, st, chuDung] of [
    ["rejected", { status: "rejected", error: "ROBOT_REFUSED: 10.1.2.3" }, "did NOT go out"],
    ["failed", { status: "failed", error: "DRIVER_ERROR: socket 10.1.2.3 closed" }, "not confirmed out"],
  ] as const) {
    it(`V-ROBOT ${ten}, forward, central: state C, its own budget (one attempt), the words of its source, Abort sends it`, async () => {
      h.timeoutDispatch.add("x");
      h.tuChoi.set("rs", st);
      const c = await centralRun(dV(`vrb${ten}`, robotStop("rs")), 1);
      await hetCho(c);
      expect(sentOf("rs")).toEqual(["rs"]);
      expect(String(hang(c, "rs")!.error)).toContain(`STOP "rs" ${chuDung === "did NOT go out" ? "did NOT go out" : "is not confirmed out"}`);
      expect(chu()).toContain(chuDung);
      expect(chu()).not.toContain("10.1.2.3");
      expect(runRow(c).status).toBe("held");
      await abortGui(c);
      expect(ids()).toEqual(["rs"]);
    });
    it(`V-ROBOT-COMP ${ten}, compensation, central: the same`, async () => {
      h.timeoutDispatch.add("x");
      h.tuChoi.set("rc", st);
      const c = await centralRun(dC(`vrc${ten}`, robotStop("rc")), 1);
      await hetCho(c);
      expect(sentOf("rc")).toEqual(["rc"]);
      expect(chu()).toContain(chuDung);
      expect(runRow(c).status).toBe("held");
      await abortGui(c);
      expect(ids()).toEqual(["rc"]);
    });
    it(`V-ROBOT-EDGE ${ten}, forward, edge: the same`, async () => {
      const e = await denBuoc(dV(`vre${ten}`, robotStop("rs")));
      h.timeoutDispatch.add("x");
      h.tuChoi.set("rs", { ...st, detail: { edge: true } });
      const s = await edgeSegment(e, 2);
      await wait(30);
      expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
      expect(sentOf("rs")).toEqual(["rs"]);
      expect(chu()).toContain(chuDung);
      await abortGui(e.runId);
      expect(ids()).toEqual(["rs"]);
    });
  }
  it("V-ROBOT-UNLATCHED a robot STOP refused, not latched: unchanged, a plain failure", async () => {
    h.tuChoi.set("rs", { status: "rejected", error: "ROBOT_REFUSED" });
    const c = await centralRun(def("vrbu", [gate(), robotStop("rs")]), 1);
    await hetCho(c);
    expect(String(hang(c, "rs")!.error)).not.toMatch(/FOE_STOP_NOT_SENT/);
    expect(runRow(c).status).toBe("failed");
    expect(urgentC()).toEqual([]);
  });

  // ── the last attempt decides ───────────────────────────────────────────────────────────────────────────────────────
  it("V-MIX refused, then the last attempt has no answer: it may have gone out: not state C, the unknown code, no 'did NOT go out'", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoiLan.set("st", [REF]);
    h.timeoutSauTuChoi.add("st");
    const c = await centralRun(dV("vmix"), 1);
    await hetCho(c);
    expect(String(hang(c, "st")!.error)).toMatch(khongRo);
    expect(String(hang(c, "st")!.error)).not.toMatch(/FOE_STOP_NOT_SENT/);
    expect(noCua(c).size).toBe(0);
    expect(urgentC()).toEqual([]);
  });
  it("V-MIX reversed: no answer, then refused: the first may have gone out: not state C", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutOnce.add("st");
    h.tuChoiSau.set("st", { sau: 1, kq: REF });
    h.timeoutDispatch.add("x");
    const c = await centralRun(dV("vmix2"), 1);
    await hetCho(c);
    expect(String(hang(c, "st")!.error)).toMatch(khongRo);
    expect(noCua(c).size).toBe(0);
    expect(urgentC()).toEqual([]);
  });
  it("V-MIX compensation: refused, then no answer: not state C", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoiLan.set("cs", [REF]);
    h.timeoutSauTuChoi.add("cs");
    const c = await centralRun(dC("vmixc"), 1);
    await hetCho(c);
    expect(String(hang(c, "cs")!.error)).toMatch(khongRo);
    expect(noCua(c).size).toBe(0);
    expect(urgentC()).toEqual([]);
  });
  it("V-REF-RACE one attempt refused before the latch ×10: state C at the end, not sent again, Abort sends it", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.alerts.length = 0;
      h.traTimeout = 0;
      h.timeoutDispatch.clear();
      h.tuChoi.clear();
      seedHalt();
      h.ghim = PIN_OK;
      h.timeoutDispatch.add("x");
      h.tuChoi.set("st", REF);
      const c = await centralRun(def(`vr1${i}`, [gate(), parF("p", [box("b0", [delay("w0", 5), otStop("st", { maxAttempts: 0 })]), box("b1", [delay("w1", 60), move("x")])])]), 1);
      await hetCho(c);
      const trang = `run=${runRow(c).status} C=${/^FOE_STOP_NOT_SENT/.test(String(hang(c, "st")?.error))} tries=${sentOf("st").length} urgent=${urgentC().length}`;
      await abortGui(c);
      const k = `${trang} abort=${sentOf("st").length}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    expect([...dem]).toEqual([["run=held C=true tries=1 urgent=1 abort=1", 10]]);
  });
  it("V-REF-RACE all three attempts refused before the latch ×10", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.alerts.length = 0;
      h.traTimeout = 0;
      h.timeoutDispatch.clear();
      h.tuChoi.clear();
      seedHalt();
      h.ghim = PIN_OK;
      h.timeoutDispatch.add("x");
      h.tuChoi.set("st", REF);
      const c = await centralRun(def(`vr3${i}`, [gate(), parF("p", [box("b0", [delay("w0", 5), otStop("st")]), box("b1", [delay("w1", 850), move("x")])])]), 1);
      await hetCho(c, 2_000);
      const k = `run=${runRow(c).status} C=${/^FOE_STOP_NOT_SENT/.test(String(hang(c, "st")?.error))} tries=${sentOf("st").length}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    expect([...dem]).toEqual([["run=held C=true tries=3", 10]]);
  }, 30_000);
  it("V-REF-RACE the two edges cross ×10: the answer lands around the latch: state C either way, never a silent end", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.alerts.length = 0;
      h.traTimeout = 0;
      h.timeoutDispatch.clear();
      h.tuChoi.clear();
      seedHalt();
      h.ghim = PIN_OK;
      h.timeoutDispatch.add("x");
      h.tuChoi.set("st", REF);
      const c = await centralRun(def(`vrx${i}`, [gate(), parF("p", [box("b0", [delay("w0", 50 + i * 2), otStop("st", { maxAttempts: 0 })]), box("b1", [delay("w1", 60), move("x")])])]), 1);
      await hetCho(c);
      const k = `run=${runRow(c).status} C=${/^FOE_STOP_NOT_SENT/.test(String(hang(c, "st")?.error))} urgent=${urgentC().length}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    expect([...dem]).toEqual([["run=held C=true urgent=1", 10]]);
  });
  it("V-REF-RACE on the edge ×10", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.alerts.length = 0;
      h.traTimeout = 0;
      h.timeoutDispatch.clear();
      h.tuChoi.clear();
      seedHalt();
      h.ghim = PIN_OK;
      const e = await denBuoc(def(`vre${i}`, [gate(), parF("p", [box("b0", [delay("w0", 5), otStop("st", { maxAttempts: 0 })]), box("b1", [delay("w1", 60), move("x")])])]));
      h.timeoutDispatch.add("x");
      h.tuChoi.set("st", { ...REF, detail: { edge: true } });
      const s = await edgeSegment(e, 2);
      await wait(20);
      const k = `out=${s.out.outcome} run=${runRow(e.runId).status} C=${/^FOE_STOP_NOT_SENT/.test(String(hang(e.runId, "st")?.error))} urgent=${urgentC().length}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    expect([...dem]).toEqual([["out=held run=held C=true urgent=1", 10]]);
  });
  it("V-REF-RACE a compensation refused before the latch: the same", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("cs", REF);
    h.failPlan.set("f", 1);
    const c = await centralRun(def("vrc", [gate(), parF("p", [ot("f", { compensation: otStop("cs") }), box("b1", [delay("w1", 60), move("x")])])]), 1);
    await hetCho(c);
    expect(String(hang(c, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "cs"/);
    expect(runRow(c).status).toBe("held");
    expect(urgentC().map((a) => a.dedupKey.split(":").slice(2, 4))).toEqual([["f", "cs"]]);
  });
  it("V-REF-RACE thrown before the latch: state C, not confirmed out", async () => {
    h.timeoutDispatch.add("x");
    h.tuChoi.set("rs", { nem: "threw (test)" });
    const c = await centralRun(def("vrn", [gate(), parF("p", [box("b0", [delay("w0", 5), robotStop("rs")]), box("b1", [delay("w1", 60), move("x")])])]), 1);
    await hetCho(c);
    expect(String(hang(c, "rs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "rs" is not confirmed out/);
    expect(chu()).toContain("not confirmed out");
    expect(runRow(c).status).toBe("held");
  });
  it("V-REF-RACE pins unreadable before the latch, the dispatcher refuses: state C", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true;
    h.ghim = PIN_BAD;
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("vrd", [parF("p", [box("b0", [delay("w0", 5), otStop("st", { maxAttempts: 0 })]), box("b1", [delay("w1", 60), robotStop("x")])])]), 0);
    await hetCho(c);
    expect(String(hang(c, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: /);
    expect(runRow(c).status).toBe("held");
  });
  it("V-REF-RACE đối chứng: refused before the latch, a retry goes: no state C", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.failPlan.set("st", 1);
    const c = await centralRun(def("vrok", [gate(), parF("p", [box("b0", [delay("w0", 5), otStop("st")]), box("b1", [delay("w1", 60), move("x")])])]), 1);
    await hetCho(c);
    expect(noCua(c).size).toBe(0);
    expect(urgentC()).toEqual([]);
    expect(runRow(c).status).toBe("failed");
  });
  it("V-REF-RACE đối chứng: a stop-typed step read fine, not pinned, refused before the latch: no state C", async () => {
    h.timeoutDispatch.add("x");
    h.tuChoi.set("nt", { status: "rejected", error: "NOT_CONFIRMED" });
    const c = await centralRun(def("vrnt", [gate(), parF("p", [box("b0", [delay("w0", 5), stopTyped("nt")]), box("b1", [delay("w1", 60), move("x")])])]), 1);
    await hetCho(c);
    expect(String(hang(c, "nt")!.error)).not.toMatch(/FOE_STOP_NOT_SENT/);
    expect(urgentC()).toEqual([]);
    expect(runRow(c).status).toBe("failed");
  });

  // ── what the row keeps ─────────────────────────────────────────────────────────────────────────────────────────────
  it("V-REF-SCAN + V-REF-NEXT the source is read back from the row, by a later walk too, with no driver text", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
    const c = await centralRun(dV("vscan"), 1);
    await hetCho(c);
    const vi = viChuaRaCuaLoi(hang(c, "st")!.error);
    expect(vi).toEqual({ nguon: "tuChoi", ma: "INTERLOCK_NOT_MET" });
    h.alerts.length = 0;
    h.timeoutDispatch.clear();
    h.ghim = async () => ({ pinnedStop: false, loiDocGhim: "pin read down (test)" });
    h.connOk = false;
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true;
    h.tuChoi.clear();
    await resumeRun(c, { approved: true, note: "again" }, OTHER).catch(() => undefined);
    await hetCho(c);
    expect(runRow(c).status).toBe("held");
    expect(String(hang(c, "st")!.error)).toMatch(/^FOE_STOP_NOT_SENT: /);
    expect(chu()).not.toContain("10.1.2.3");
  });
  it("F-DB1 a STOP in C that went: its row clears; the container around it, carrying the same words, is no debt", () => {
    const loi = 'FOE_STOP_NOT_SENT: STOP "st" did NOT go out (attempt 1): its dispatcher refused it [X].';
    expect(stopChuaRaTuHang([{ stepId: "b", status: "failed", error: loi }, { stepId: "p", status: "failed", error: `Parallel branch failed: ${loi}` }])).toEqual(new Set());
    expect(stopChuaRaTuHang([{ stepId: "st", status: "failed", error: loi }, { stepId: "b", status: "failed", error: loi }])).toEqual(new Set(["st"]));
    expect(stopChuaRaTuHang([{ stepId: "st", status: "failed", error: loi }, { stepId: "abort:st", status: "completed", error: null, resultJson: { stepId: "st" } }])).toEqual(new Set());
    expect(stopChuaRaTuHang([{ stepId: "st", status: "failed", error: loi }, { stepId: "abort:st", status: "skipped", error: null, resultJson: { stepId: "st" } }])).toEqual(new Set());
    expect(stopChuaRaTuHang(null)).toEqual(new Set());
    expect(priorStepsOf([{ stepId: "st", status: "failed", error: loi }]).settled.has("st"), "a row in state C is not settled").toBe(false);
    expect(priorStepsOf([{ stepId: "st", status: "failed", error: "device said no" }]).settled.has("st")).toBe(true);
  });
  it("F-DB1 on a run: STOP refused, the container's row carries the words; the STOP goes at Abort: nothing owed", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 10);
    h.slow.set("st", 30); // on its way when the run latches: the walker's own step answers, and the failure rises through its container
    h.tuChoi.set("st", REF);
    const c = await centralRun(def("fdb1", [gate(), parF("p", [move("x"), box("b", [otStop("st")])])]), 1);
    await hetCho(c);
    expect(String(hang(c, "b")!.error)).toMatch(/FOE_STOP_NOT_SENT/);
    expect(noCua(c)).toEqual(new Set(["st"]));
    await abortGui(c);
    expect(noCua(c)).toEqual(new Set());
  });
  it("C-CLR the read recovers and says NOT pinned: the row is rewritten, a Continue leaves 'held', the words are true", async () => {
    seedHalt();
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true;
    h.timeoutDispatch.add("x");
    const c = await centralRun(dV("cclr"), 1);
    await hetCho(c);
    expect(runRow(c).status).toBe("held");
    for (const t of rows("device_tags")) if (t.tagKey === "halt") t.stopValue = null;
    h.timeoutDispatch.clear();
    h.dispatcherKhongDoc = false;
    h.ghim = async () => ({ pinnedStop: false, loiDocGhim: null });
    h.sent.length = 0;
    await resumeRun(c, { approved: true, note: "not pinned" }, OTHER).catch(() => undefined);
    await hetCho(c);
    expect(noCua(c).size).toBe(0);
    expect(String(hang(c, "st")!.error)).toMatch(/^FOE_NOT_SENT_RUN_LATCHED: /);
    expect(runRow(c).status).toBe("failed");
    expect(ids()).toEqual([]);
  });
  it("C-CONT the same hold, the read back, a Continue: the pass sends the STOP, it goes, the debt is gone", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
    const c = await centralRun(dV("ccont"), 1);
    await hetCho(c);
    expect(runRow(c).status).toBe("held");
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    await resumeRun(c, { approved: true, note: "go" }, OTHER).catch(() => undefined);
    await hetCho(c);
    expect(ids()).toEqual(["st"]);
    expect(noCua(c).size).toBe(0);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
    expect(runRow(c).status).not.toBe("held");
  });
  it("C2-song an Abort while the walker lives, a STOP in state C behind a container that failed: the sweep reaches it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    h.slow.set("treo", 400);
    h.tuChoi.set("st", REF);
    const d = def("c2song", [gate(), parF("p", [move("x"), move("treo"), box("b", [delay("w", 20), otStop("st", { maxAttempts: 0 })])])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const view = (await getRun(s.runId!, { bindingDigest: true }))!;
    const di = resumeRun(s.runId!, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => stepRows(s.runId!).some((r) => r.stepId === "b" && r.status === "failed"), "the container's failure", 300);
    h.tuChoi.clear();
    h.sent.length = 0;
    const a = await abortRun(s.runId!, OWNER, "press");
    await di;
    await wait(30);
    expect(a.abortStops?.sent).toContain("st");
    expect(sentOf("st")).toEqual(["st"]);
  });
  it("C-EDGE-COMP an edge run held on a compensation in state C, a Continue: the next segment sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await denBuoc(dC("cedc"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("cs", { ...REF, detail: { edge: true } });
    await edgeSegment(e, 2);
    await wait(30);
    expect(runRow(e.runId).status).toBe("held");
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    await continueOutcomeUnknown(e, "checked on site");
    await edgeSegment(e, 3);
    await wait(30);
    expect(ids()).toEqual(["cs"]);
    expect(noCua(e.runId).size).toBe(0);
  });
  it("C-COMP-CONT central, the same: a Continue sends the compensation in state C", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("cs", REF);
    const c = await centralRun(dC("ccc"), 1);
    await hetCho(c);
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    await resumeRun(c, { approved: true, note: "go" }, OTHER).catch(() => undefined);
    await hetCho(c);
    expect(ids()).toEqual(["cs"]);
    expect(noCua(c).size).toBe(0);
    expect(runRow(c).status).not.toBe("held");
  });
  it("C-EDGE-CONT an edge run held on state C, a Continue: the next segment sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await denBuoc(dV("cedge"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", { ...REF, detail: { edge: true } });
    await edgeSegment(e, 2);
    await wait(30);
    expect(runRow(e.runId).status).toBe("held");
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    await continueOutcomeUnknown(e, "checked on site");
    await edgeSegment(e, 3);
    await wait(30);
    expect(ids()).toEqual(["st"]);
    expect(noCua(e.runId).size).toBe(0);
  });
  it("C-HAI two STOPs in state C: both named, both owed, one Abort sends both", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
    h.tuChoi.set("s2", REF);
    const c = await centralRun(def("chai", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("st")]), box("b2", [delay("w2", 40), otStop("s2")])])]), 1);
    await hetCho(c);
    expect([...noCua(c)].sort()).toEqual(["s2", "st"]);
    expect(urgentC().map((a) => a.dedupKey.split(":")[2]).sort()).toEqual(["s2", "st"]);
    await abortGui(c);
    expect(ids().sort()).toEqual(["s2", "st"]);
  });
  it("C-THAN THAN-TUCHOI: the body's STOP refused: Abort goes through the failed compensation container to reach it", async () => {
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    h.failPlan.set("cs", Infinity);
    const c = await centralRun(def("cthan", [gate(), move("f", { compensation: box("cb", [move("q"), robotStop("cs")]) })]), 1);
    await hetCho(c);
    expect(runRow(c).status).toBe("held");
    expect(String(hang(c, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "cs"/);
    await abortGui(c);
    expect(ids()).toEqual(["cs"]);
  });
  it("C-KEM a state C beside a compensation held for a person: both stand, the run is held, Abort sends the STOP and nothing else", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
    const c = await centralRun(def("ckem", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [delay("w", 40), otStop("st")])])]), 1);
    await hetCho(c);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "u")).toMatchObject({ status: "held" });
    expect(noCua(c)).toEqual(new Set(["st"]));
    await abortGui(c);
    expect(ids()).toEqual(["st"]);
  });
  it("C-NUOT an Abort while a STOP is in state C's budget: no further attempt, the sweep sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
    const d = dV("cnuot");
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const view = (await getRun(s.runId!, { bindingDigest: true }))!;
    const di = resumeRun(s.runId!, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => sentOf("st").length === 1, "the first attempt", 500);
    await wait(30);
    h.tuChoi.clear();
    await abortRun(s.runId!, OWNER, "press");
    await di;
    await wait(40);
    expect(runRow(s.runId!).status).toBe("aborted");
    expect(sentOf("st").length).toBeLessThanOrEqual(2);
    expect(h.sent.filter((x) => x.stepId === "st").at(-1)?.khongGhi).toBeFalsy();
  });
  it("H-TREO a hand-over that hangs: past the bound the last pass runs, while that STOP is still out", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("treo", 5_700);
    const d = def("htreo", [gate(), parF("p", [move("x"), box("b", [delay("w", 10), otStop("treo")]), box("b2", [delay("w2", 10), stopTyped("nt")])])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const view = (await getRun(s.runId!, { bindingDigest: true }))!;
    const t0 = Date.now();
    const di = resumeRun(s.runId!, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => sentOf("treo").length === 1, "the slow STOP", 500);
    // what only the last pass writes: the row of a stop-typed step the door stopped, read: no STOP
    await waitFor(() => hang(s.runId!, "nt") !== undefined, "the last pass, past the bound", 5_500);
    expect(Date.now() - t0).toBeLessThan(5_700);
    expect(hang(s.runId!, "treo")?.status).not.toBe("completed");
    await di;
    await hetCho(s.runId!, 2_000);
    expect(hang(s.runId!, "treo")).toMatchObject({ status: "completed" });
  }, 12_000);
  it("I-3 the pin-unverified URGENT does not say the STOP was sent", async () => {
    seedHalt();
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true;
    h.timeoutDispatch.add("x");
    await centralRun(dV("pinu"), 1);
    await waitFor(() => h.alerts.some((a) => a.kind === "foe_stop_pin_unverified"), "the alert");
    const m = h.alerts.filter((a) => a.kind === "foe_stop_pin_unverified").map((a) => String(a.message)).join(" ");
    expect(m).not.toContain("It was sent");
    expect(m).toContain("dispatcher");
  });

  // ── E-C: the edge's own answer ─────────────────────────────────────────────────────────────────────────────────────
  const tuChoiEdge = (ly: string) => ({ status: "rejected", error: "AUTHORIZATION_REQUIRED", detail: { edge: true, stop: false, reason: "AUTHORIZATION_REQUIRED", refusal: `stop_not_pinned:${ly}` } });
  for (const [ten, connOk, ly] of [["E-C1 verified, no_snapshot_adapter", true, "no_snapshot_adapter"], ["E-C2 verified, adapter_connection_stale", true, "adapter_connection_stale"], ["E-C3 not verified, no_snapshot_adapter", false, "no_snapshot_adapter"]] as const) {
    it(`${ten}: the dispatcher could not decide: state C, -a1..a3, the words of a read, Abort sends it`, async () => {
      seedHalt();
      h.connOk = connOk;
      h.ghim = PIN_OK;
      const e = await denBuoc(dV(`ec${ten.slice(0, 4)}`));
      h.timeoutDispatch.add("x");
      h.tuChoi.set("st", tuChoiEdge(ly));
      const s = await edgeSegment(e, 2);
      await wait(30);
      expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
      expect(lanThu("st")).toEqual(["1", "2", "3"]);
      expect(chu()).toContain("once the read recovers");
      await abortGui(e.runId);
      expect(ids()).toEqual(["st"]);
    });
  }
  it("E-C4 pinned for the dispatcher, the package could not verify: it goes", async () => {
    seedHalt();
    h.connOk = false;
    const e = await denBuoc(dV("ec4"));
    h.dispatcherThat = true;
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(sentOf("st")).toEqual(["st"]);
    expect(s.out.outcome).toBe("failed");
  });
  it("E-C5 the package could not verify, the snapshot says no_pins: an answer: failed, no state C", async () => {
    seedHalt();
    h.connOk = false;
    const e = await denBuoc(dV("ec5"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", tuChoiEdge("no_pins"));
    h.tuChoiKhongGhi.add("st");
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out.outcome).toBe("failed");
    expect(urgentC()).toEqual([]);
    expect(noCua(e.runId).size).toBe(0);
  });
  it("E-C6 the package verified it, the snapshot says no_pins: failed, one hand-over, no state C", async () => {
    seedHalt();
    const e = await denBuoc(dV("ec6"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", tuChoiEdge("no_pins"));
    h.tuChoiKhongGhi.add("st");
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(s.out.outcome).toBe("failed");
    expect(sentOf("st")).toEqual(["st"]);
    expect(urgentC()).toEqual([]);
    // dieu-phoi 08/11 T6d-K1 — was: no URGENT at all. Central verified a pinned STOP, the edge snapshot refused it: exactly one URGENT names it, NOT sent, no "Abort sends it"
    const lech = h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.stopGhimLechChuaGui);
    expect(lech.map((a) => a.dedupKey.split(":").slice(2, 4)), "exactly one URGENT, by name").toEqual([["st", "-"]]);
    const chuLech = lech.map((a) => `${a.title} ${a.message}`).join(" ");
    expect(chuLech).toContain('"st"');
    expect(chuLech).toContain("NOT sent");
    expect(chuLech).toContain("Check the machine on site");
    expect(chuLech).not.toMatch(/Abort sends/);
    expect(noCua(e.runId).size, "not state C").toBe(0);
    expect(runRow(e.runId).status).toBe("failed");
  });
  it("T6d-K1 E-C5 measured beside E-C6: the package could not verify, the snapshot says no_pins: no disagreement to tell, forward work refused by its dispatcher, no pin-mismatch URGENT", async () => {
    seedHalt();
    h.connOk = false;
    const e = await denBuoc(dV("ec5k"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", tuChoiEdge("no_pins"));
    h.tuChoiKhongGhi.add("st");
    await edgeSegment(e, 2);
    await wait(30);
    expect(h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.stopGhimLechChuaGui)).toEqual([]);
    const fwd = h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.forwardNotSent && a.dedupKey.split(":")[2] === "st");
    expect(fwd.length).toBe(1);
    expect(String(fwd[0].message)).toContain("refused by its dispatcher before any driver");
    expect(urgentC()).toEqual([]);
  });
  it("EDGE-BAO a STOP of the route its dispatcher refused: the row names no route: central would refuse the whole report (no jti); one that went keeps it", async () => {
    seedHalt();
    h.connOk = false;
    const e = await denBuoc(dV("ebao"));
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", tuChoiEdge("no_snapshot_adapter"));
    await edgeSegment(e, 2);
    const kq = e.records.filter((r: any) => r.kind === "step" && r.stepId === "st" && r.result).map((r: any) => r.result);
    expect(kq.length).toBeGreaterThan(0);
    expect(kq.every((r: any) => r.routedTo === undefined && r.accepted === false)).toBe(true);
    h.traTimeout = 0;
    h.sent.length = 0;
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    const e2 = await denBuoc(dV("ebao2"));
    h.dispatcherThat = true;
    h.timeoutDispatch.add("x");
    await edgeSegment(e2, 2);
    const kq2 = e2.records.filter((r: any) => r.kind === "step" && r.stepId === "st" && r.result).map((r: any) => r.result);
    expect(kq2.some((r: any) => typeof r.routedTo === "string" && r.accepted === true)).toBe(true);
  });
  it("C-TRUOC a STOP compensation refused in an EARLIER walk, the run latches in a later one: due, sent again", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.failPlan.set("f", Infinity);
    h.tuChoi.set("cs", REF);
    const c = await centralRun(def("ctruoc", [gate(), parF("p", [ot("f", { compensation: otStop("cs") }), delay("w", 1)]), gate("g2"), move("x")]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("awaiting_confirm");
    h.tuChoi.clear();
    h.sent.length = 0;
    h.timeoutDispatch.add("x");
    const view = (await getRun(c, { bindingDigest: true }))!;
    await resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await hetCho(c);
    expect(ids()).toContain("cs");
  });
  it("C-TRUOC đối chứng: a STOP compensation that may have gone out in an earlier walk is not sent again by the planner", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.timeoutDispatch.add("y");
    h.timeoutDispatch.add("cs");
    const c = await centralRun(def("ctruoc2", [gate(), parF("p", [move("x", { compensation: otStop("cs") }), move("y", { compensation: ot("u") })])]), 1);
    await hetCho(c);
    expect(runRow(c).status).toBe("held");
    expect(String(hang(c, "cs")!.error)).toMatch(khongRo);
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await waitFor(() => ids().includes("u"), "the approved compensation");
    await wait(30);
    expect(sentOf("cs")).toEqual([]);
  });
  it("XEP-CUOI the verifier says not pinned, the split's own read fails at the last pass: no answer, so neither 'not pinned' nor 'not sent': the marked route, 0 PDU, state C", async () => {
    seedHalt();
    h.dispatcherThat = true;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 10);
    h.slow.set("treo", 60);
    let lan = 0;
    h.ghim = async (_d, i) => {
      if (i.commandType !== "stop") return KHONG;
      return ++lan === 1 ? KHONG : BAD;
    };
    const c = await centralRun(def("xepc", [gate(), parF("p", [move("x"), move("treo"), box("b", [delay("w", 30), stopTyped("nt")])])]), 1);
    await hetCho(c);
    expect(h.sent.filter((x) => x.stepId === "nt").every((x) => x.khongGhi === true)).toBe(true);
    expect(String(hang(c, "nt")!.error)).toMatch(/^FOE_STOP_NOT_SENT: /);
    await wait(10);
    const audit = vi.mocked(logCrudOperation).mock.calls.map((x) => (x[1] as { details?: { operation?: string; metadata?: { stepIds?: string[] } } }).details).filter((d) => d?.operation === "abortStopNotPinned");
    expect(audit.flatMap((d) => d?.metadata?.stepIds ?? [])).not.toContain("nt");
  });
  it("EDGE-UNCHANGED the route never opens on an unlatched edge segment: a stop-typed step the package could not verify asks /authorize", async () => {
    seedHalt();
    h.connOk = false;
    const e = await denBuoc(def("eun", [gate(), otStop("st")]));
    await edgeSegment(e, 2);
    expect(authCua(e, "st")).toBe(1);
    expect(hang(e.runId, "st")).toBeDefined();
    void lech;
  });
});

// ═══ A2(n) T5, fix round 1: the real report path (reportForNode, applyStream, EdgeStreamShipper), FakeDb with a real rollback ═══
describe("A2(n) T5 fix 1 — what an edge reports of a STOP central cannot verify", () => {
  const TOKEN = "ect_" + "a".repeat(43);
  const NUT = { nodeId: NODE, nodeCode: "EDGE-A", credentialId: 1, factoryCode: "F1" } as never;
  const EPOCH = "e".repeat(32);
  const box = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "sequence", steps }) as never;
  const parF = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const OFFLINE = { status: "failed", error: "ADAPTER_OFFLINE", detail: { edge: true, stop: true, pinnedStop: true, reason: "ADAPTER_OFFLINE" } };
  const d2 = (ref: string) => def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("s1"), otStop("s2")])])]);
  const dMot = (ref: string) => def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("s1")])])]);
  const hang = (c: number, id: string) => stepRows(c).find((r) => r.stepId === id);
  const dau = (c: number, id: string) => (hang(c, id)?.resultJson as Record<string, unknown> | null | undefined)?.stopKhongXacNhan;
  const loaiCB = (k: keyof typeof CANH_BAO_KHONG_RO_KIND) => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[k]);
  let pinDown = false;
  let bangDown: string | null = null;
  beforeEach(() => {
    pinDown = false;
    bangDown = null;
    h.audit = [];
    // the batch's transaction really rolls back (FakeDb's does not), as the report path relies on
    (fake as any).transaction = async (fn: (t: unknown) => Promise<unknown>) => {
      const anh = new Map([...fake.store].map(([k, v]) => [k, v.map((r) => ({ ...r }))] as const));
      try {
        return await fn(fake);
      } catch (e) {
        fake.store.clear();
        for (const [k, v] of anh) fake.store.set(k, v);
        throw e;
      }
    };
    const ins = (fake as any).insert;
    (fake as any).insert = (t: any) => {
      const q = ins(t);
      const val = q.values.bind(q);
      q.values = (x: unknown) => {
        const r = val(x);
        r.onConflictDoNothing = () => r;
        return r;
      };
      return q;
    };
    const sel = FakeDb.prototype.select.bind(fake);
    (fake as any).select = (p?: Record<string, unknown>) => {
      const b = sel(p as never);
      const from = b.from.bind(b);
      b.from = (t: any) => {
        // only the report's own pin read carries a projection with stopValue
        if (pinDown && t?.[Symbol.for("drizzle:Name")] === "device_tags" && p && "stopValue" in p) throw new Error("pin read down at report (test)");
        if (bangDown === t?.[Symbol.for("drizzle:Name")]) throw new Error("read down at report (test)");
        return from(t);
      };
      return b;
    };
  });
  afterEach(() => {
    delete (fake as any).transaction;
    delete (fake as any).select;
    h.dispatcherThat = false;
  });

  /** the journal of one edge: the same records, the same seq the shipper would send */
  function nhatKy() {
    const dong = new Map<string, { recs: Array<{ seq: number; record: Record<string, unknown> }>; acked: number }>();
    const cua = (s: string) => dong.get(s) ?? (dong.set(s, { recs: [], acked: 0 }), dong.get(s)!);
    return {
      epoch: EPOCH,
      them(s: string, r: Record<string, unknown>) {
        const c = cua(s);
        const seq = c.recs.length + 1;
        c.recs.push({ seq, record: { ...r, seq } });
      },
      pending: (s: string, n: number) => cua(s).recs.filter((r) => r.seq > cua(s).acked).slice(0, n),
      ack(s: string, q: number) {
        cua(s).acked = Math.max(cua(s).acked, q);
      },
      ackedSeq: (s: string) => cua(s).acked,
      pendingStreams: () => [],
      appendEvent: async () => ({ seq: 1 }),
      veLai(s: string) {
        cua(s).acked = 0;
      },
    };
  }
  const traLoi: Array<{ http: number; code?: string }> = [];
  function trungTam(runId: number) {
    return {
      async post(route: string, body: unknown) {
        const a = (route === "report" ? await reportForNode(NUT, runId, body) : await eventsForNode(NUT, body)) as Record<string, any>;
        traLoi.push({ http: a.http, code: a.code });
        return a.http === 200 ? { ok: true, status: 200, data: a.data } : { ok: false, status: a.http, code: a.code, data: a.data, unavailable: a.http === 503 };
      },
    };
  }
  async function chuanBi(e: EdgeHarness, claimSeq: number) {
    fake.seed(edgeNodeProtocol, [{ id: NODE, protocolVersion: 2, v: 2 }]); // FakeDb ignores a projection: its alias is a field here
    for (const w of rows("orchestration_workflows")) w.def = w.definitionJson;
    fake.store.delete("edge_node_report_cursors");
    fake.store.delete("edge_node_report_records");
    for (const r of rows("edge_step_authorizations")) r.edgeNodeId = NODE;
    const [a] = rows("orchestration_run_edge_assignments").filter((r) => r.runId === e.runId);
    a.claimTokenHash = hashEdgeSecret(TOKEN);
    a.claimSeq = claimSeq;
    a.edgeNodeId = NODE;
  }
  async function chayGiua(d: WorkflowDefinition, sua?: (e: EdgeHarness) => void, unsure = true) {
    seedHalt();
    h.connOk = true;
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    e.quaBaoCao = true; // nothing applied by the harness from here: only the report path writes
    h.connOk = !unsure; // central could not verify at the claim: stopsUnsure
    h.dispatcherThat = true;
    h.timeoutDispatch.add("x");
    sua?.(e);
    const moc = e.records.length;
    const s = await edgeSegment(e, 2);
    await wait(40);
    h.connOk = true;
    return { e, s, moc, d };
  }
  /** ship the run stream through the real shipper; `ket`: the segment end once the stream is empty, as the agent does */
  async function giao(x: Awaited<ReturnType<typeof chayGiua>>, trangThai: "doc" | "lech" | "khop") {
    const { e, s, moc, d } = x;
    await chuanBi(e, 2);
    const J = nhatKy();
    const S = edgeRunStream(e.runId, 2);
    for (const r of e.records.slice(moc)) J.them(S, r as never);
    for (const r of e.events ?? []) J.them("events", r);
    const sh = new EdgeStreamShipper(J as never, trungTam(e.runId) as never, { log: () => undefined });
    sh.setClaim(e.runId, 2, TOKEN);
    pinDown = trangThai === "doc";
    if (trangThai === "lech") for (const t of rows("device_tags")) if (t.tagKey === "halt") t.stopValue = null;
    traLoi.length = 0;
    await sh.flush(S);
    await sh.flush("events");
    await wait(20);
    const con = J.pending(S, 1).length;
    if (con === 0 && s.out.outcome) await applyEdgeSegmentEnd(fake as never, e.runId, { ...(s.out as any), nodeCode: "EDGE-A", claimSeq: 2, def: d });
    await wait(20);
    return { J, S, sh, con };
  }
  const tatCaChu = () => h.alerts.map((a) => `${a.title} ${a.message}`).join(" | ");

  it("BC-DOC the read fails at the report: the stream runs, s1 carries the mark 'docLoi', s2's refusal reaches central, the run is held, a visible alert, not the mismatch one", async () => {
    const x = await chayGiua(d2("bcdoc"), () => h.tuChoi.set("s2", OFFLINE));
    const { con } = await giao(x, "doc");
    expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
    expect(con).toBe(0);
    expect(dau(x.e.runId, "s1")).toBe("docLoi");
    expect(String(hang(x.e.runId, "s2")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "s2"/);
    expect(runRow(x.e.runId).status).toBe("held");
    expect(loaiCB("stopKhongXacNhanDoc").map((a) => a.dedupKey.split(":")[2])).toEqual(["s1"]);
    expect(loaiCB("stopGhimLech")).toEqual([]);
  });
  it("BC-LECH central reads the pins and they differ: no 409, the mark 'ghimLech', a URGENT of its own: check the machine on site, what went out may be no STOP", async () => {
    const x = await chayGiua(d2("bclech"), () => h.tuChoi.set("s2", OFFLINE));
    const { con } = await giao(x, "lech");
    expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
    expect(con).toBe(0);
    expect(dau(x.e.runId, "s1")).toBe("ghimLech");
    expect(runRow(x.e.runId).status).toBe("held");
    const u = loaiCB("stopGhimLech");
    expect(u.map((a) => a.dedupKey.split(":")[2])).toEqual(["s1"]);
    expect(String(u[0]!.message)).toContain("may not have been a STOP");
    expect(String(u[0]!.message)).toContain("on site");
    expect(u[0]!.khuTrungBenVung, "the durable dedup of the alert").toEqual({});
    expect(loaiCB("stopKhongXacNhanDoc")).toEqual([]);
  });
  it("BC-BEN the URGENT of a mismatch answers whether it is stored: nobody to tell is not durable", async () => {
    const d = await canhBaoKetCucKhongRo({ loai: "stopGhimLech", runId: 1, stepId: "s1", compId: KHONG_CO_BU_TRU, error: "FOE_OUTCOME_UNKNOWN", lan: "claim2", biet: true, owner: 10 });
    expect(d).toBe(true);
    h.alertDurable = false;
    expect(await canhBaoKetCucKhongRo({ loai: "stopGhimLech", runId: 1, stepId: "s1", compId: KHONG_CO_BU_TRU, error: "FOE_OUTCOME_UNKNOWN", lan: "claim2", biet: true, owner: 10 })).toBe(false);
  });
  it("BC-P3 the three faults at once: unverified at the claim, the pins differ for good, the events journal full: the stream runs, the rider of the end names s2, the run is held", async () => {
    const x = await chayGiua(d2("bcp3"), (e) => {
      h.tuChoi.set("s2", OFFLINE);
      e.eventsRefused = true;
    });
    const { con } = await giao(x, "lech");
    expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
    expect(con).toBe(0);
    expect(hang(x.e.runId, "s2")).toMatchObject({ status: "failed" });
    expect(runRow(x.e.runId).status).toBe("held");
    expect(loaiCB("stopNotSent").map((a) => a.dedupKey.split(":")[2])).toContain("s2");
  });
  it("BC-NEN verified at the claim, the pins differ at the report: the old 409 is gone, the same three outcomes", async () => {
    const x = await chayGiua(d2("bcnen"), (e) => {
      h.tuChoi.set("s2", OFFLINE);
      e.eventsRefused = true;
    }, false);
    const { con } = await giao(x, "lech");
    expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
    expect(con).toBe(0);
    expect(dau(x.e.runId, "s1")).toBe("ghimLech");
    expect(runRow(x.e.runId).status).toBe("held");
  });
  it("BC-KHOP the read back, the pins as they were: verified, no mark, no URGENT of this kind", async () => {
    const x = await chayGiua(d2("bckhop"), () => h.tuChoi.set("s2", OFFLINE));
    await giao(x, "khop");
    expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
    expect(dau(x.e.runId, "s1")).toBeUndefined();
    expect(loaiCB("stopGhimLech")).toEqual([]);
    expect(loaiCB("stopKhongXacNhanDoc")).toEqual([]);
  });
  const stepRec = (stepId: string, o: Record<string, unknown> = {}) => ({ kind: "step", stepId, stepType: "command", status: "running", attempt: 1, startedAt: Date.now(), finishedAt: null, error: null, result: { routedTo: "robot-dispatcher", status: "acked", accepted: true }, jti: null, ...o });
  it("BC-409 a non-STOP result with no jti: 409 as before, nothing applied, the audit; a word of the record does not make it a STOP", async () => {
    const x = await chayGiua(dMot("bc409"));
    await chuanBi(x.e, 2);
    const J = nhatKy();
    const S = edgeRunStream(x.e.runId, 2);
    J.them(S, stepRec("x", { result: { routedTo: "robot-dispatcher", accepted: true, stop: true, pinnedStop: true, stopKhongXacNhan: "docLoi", detail: { edge: true, stop: true, pinnedStop: true } } }));
    const sh = new EdgeStreamShipper(J as never, trungTam(x.e.runId) as never, { log: () => undefined });
    sh.setClaim(x.e.runId, 2, TOKEN);
    traLoi.length = 0;
    const truoc = JSON.stringify(hang(x.e.runId, "x") ?? null);
    await sh.flush(S);
    expect(traLoi[0]).toMatchObject({ http: 409, code: "unauthorised_actuation" });
    expect(JSON.stringify(hang(x.e.runId, "x") ?? null)).toBe(truoc);
    expect(J.pending(S, 1).length).toBe(1);
  });
  it("BC-GIA the mark is central's: an edge's own word on a verified STOP's row is dropped", async () => {
    const x = await chayGiua(dMot("bcgia"));
    await chuanBi(x.e, 2);
    const J = nhatKy();
    const S = edgeRunStream(x.e.runId, 2);
    J.them(S, stepRec("s1", { result: { routedTo: "ot-dispatcher", accepted: true, stopKhongXacNhan: "ghimLech" } }));
    const sh = new EdgeStreamShipper(J as never, trungTam(x.e.runId) as never, { log: () => undefined });
    sh.setClaim(x.e.runId, 2, TOKEN);
    await sh.flush(S);
    expect(dau(x.e.runId, "s1")).toBeUndefined();
  });
  // ── dieu-phoi 08/11 T6d-K1 — E-C6 through the real report path: the package verified s1, the edge snapshot says no_pins ──
  const ec6 = (ly: string) => () => {
    h.tuChoi.set("s1", { status: "rejected", error: "AUTHORIZATION_REQUIRED", detail: { edge: true, stop: false, reason: "AUTHORIZATION_REQUIRED", refusal: `stop_not_pinned:${ly}` } });
    h.tuChoiKhongGhi.add("s1");
  };
  it("T6d-K1 E-C6 real report path: one durable URGENT names s1, NOT sent, no 'Abort sends it'; not state C, the run failed; the events again: the same one key", async () => {
    const x = await chayGiua(dMot("t6dk1"), ec6("no_pins"), false);
    const { J, S, sh } = await giao(x, "khop");
    expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
    const lech = () => loaiCB("stopGhimLechChuaGui");
    expect([...new Set(lech().map((a) => a.dedupKey))].map((k) => k.split(":").slice(2, 4))).toEqual([["s1", "-"]]);
    const chu = lech().map((a) => `${a.title} ${a.message}`).join(" ");
    expect(chu).toContain("NOT sent");
    expect(chu).not.toMatch(/Abort sends/);
    expect(stopChuaRaTuHang(stepRows(x.e.runId) as never).size).toBe(0);
    expect(runRow(x.e.runId).status).toBe("failed");
    const truoc = new Set(lech().map((a) => `${a.dedupKey}|${a.title}|${a.message}`));
    const lanTruoc = lech().length;
    // T6d lượt sửa 1 — the same events again through the real eventsForNode, and the run stream again: one durable key, the same words; every raise asks the durable dedup
    // T6b (rà T6d) — measured: the replays are accepted and raise NOTHING new (as many raises after as before); the one durable key stays one
    J.veLai("events");
    await sh.flush("events");
    J.veLai(S);
    await sh.flush(S);
    await wait(20);
    expect(traLoi.filter((a) => a.http !== 200), "the replays are accepted").toEqual([]);
    expect(lanTruoc, "the first delivery raised it").toBeGreaterThan(0);
    expect(lech().length, "a replay raises no new URGENT").toBe(lanTruoc);
    expect(new Set(lech().map((a) => a.dedupKey)).size, "one durable key").toBe(1);
    expect(new Set(lech().map((a) => `${a.dedupKey}|${a.title}|${a.message}`)), "a replay keeps the one durable key and words").toEqual(truoc);
    expect(lech().every((a) => a.khuTrungBenVung !== undefined && a.retryUntilPersisted !== undefined), "durable: deduplicated per person and key").toBe(true);
  });
  it("T6d-K1 đối chứng real report path: no_snapshot_adapter stays state C: stop_not_sent, held, no pin-mismatch URGENT", async () => {
    const x = await chayGiua(dMot("t6dk1s"), ec6("no_snapshot_adapter"), false);
    await giao(x, "khop");
    expect(loaiCB("stopNotSent").map((a) => a.dedupKey.split(":")[2])).toContain("s1");
    expect(runRow(x.e.runId).status).toBe("held");
    expect(loaiCB("stopGhimLechChuaGui")).toEqual([]);
  });
  it("BC-PHAT-LAI the same records again, and a later record of the same step: one row, one URGENT", async () => {
    const x = await chayGiua(dMot("bcpl"));
    const { J, S, sh } = await giao(x, "lech");
    await wait(20);
    expect(loaiCB("stopGhimLech")).toHaveLength(1);
    const dong = stepRows(x.e.runId).filter((r) => r.stepId === "s1").length;
    J.veLai(S);
    await sh.flush(S);
    await wait(20);
    expect(loaiCB("stopGhimLech")).toHaveLength(1);
    expect(stepRows(x.e.runId).filter((r) => r.stepId === "s1").length).toBe(dong);
    J.them(S, stepRec("s1", { status: "completed", result: null, finishedAt: Date.now() }));
    await sh.flush(S);
    await wait(20);
    expect(loaiCB("stopGhimLech")).toHaveLength(1);
    expect(dau(x.e.runId, "s1")).toBe("ghimLech");
  });
  it("BC-THEO later records of a marked step do not lose the mark; a debt on the row outlives a 'completed' central cannot verify", async () => {
    const x = await chayGiua(dMot("bctheo"));
    await chuanBi(x.e, 2);
    const loi = 'FOE_STOP_NOT_SENT: STOP "s1" did NOT go out (attempt 1): refused before a driver [BUSY].';
    fake.seed(orchestrationRunSteps, [...rows("orchestration_run_steps"), { id: 99_500, runId: x.e.runId, stepId: "s1", stepType: "command", status: "failed", attempt: 1, startedAt: new Date(), finishedAt: new Date(), error: loi, resultJson: null }]);
    const J = nhatKy();
    const S = edgeRunStream(x.e.runId, 2);
    J.them(S, stepRec("s1", { attempt: 2, status: "completed", finishedAt: Date.now() }));
    const sh = new EdgeStreamShipper(J as never, trungTam(x.e.runId) as never, { log: () => undefined });
    sh.setClaim(x.e.runId, 2, TOKEN);
    pinDown = true;
    await sh.flush(S);
    expect(traLoi.at(-1)).toMatchObject({ http: 200 });
    expect(hang(x.e.runId, "s1")).toMatchObject({ status: "completed" });
    expect(dau(x.e.runId, "s1")).toBe("docLoi");
    expect([...stopChuaRaTuHang(stepRows(x.e.runId) as never)], "an unverified word does not clear a debt").toEqual(["s1"]);
    J.them(S, stepRec("s1", { attempt: 3, status: "failed", result: { accepted: false, status: "rejected" }, error: null, finishedAt: Date.now() }));
    await sh.flush(S);
    expect(dau(x.e.runId, "s1"), "a later record of the step without a route").toBe("docLoi");
  });
  it("BC-DOC-CA every reader of a marked row: not settled, not completed, not 'xong', no debt cleared, the alert's list still names it", async () => {
    const hangDau = { stepId: "s1", status: "completed", error: null, resultJson: { routedTo: "ot-dispatcher", accepted: true, status: "acked_unverified", stopKhongXacNhan: "ghimLech" } };
    const p = priorStepsOf([hangDau]);
    expect(p.settled.has("s1")).toBe(false);
    expect(p.attempted.has("s1")).toBe(true);
    expect(edgePriorPictureOf([hangDau]).completed).toEqual([]);
    expect(nhanBuocSauChot({ status: "completed", error: null, routedTo: true, khongRo: false, daGiao: true, uyQuyenSong: false, khongXacNhan: true })).toBe("coTheDaGui");
    expect(nhanBuocSauChot({ status: "completed", error: null, routedTo: true, khongRo: false, daGiao: true, uyQuyenSong: false })).toBe("xong");
    expect(stopChuaRaTuHang([hangDau])).toEqual(new Set());
    expect(dauKhongXacNhan(hangDau.resultJson)).toBe("ghimLech");
    expect(dauKhongXacNhan({ status: "acked_unverified" }), "not the same word as acked_unverified").toBeNull();
    expect(dauKhongXacNhan({ stopKhongXacNhan: "khac" })).toBeNull();
    expect(themBuocHongKhiTiepTuc({ steps: [box("b", [otStop("s1")])] }, [{ stepId: "b", status: "failed", error: "x" }, hangDau], {}, new Set(["s1"])).b, "a failed container holding it is walked").toBeUndefined();
  });
  const doiCo = async (x: Awaited<ReturnType<typeof chayGiua>>) => {
    await chuanBi(x.e, 2);
    const J = nhatKy();
    const S = edgeRunStream(x.e.runId, 2);
    for (const r of x.e.records.slice(x.moc)) J.them(S, r as never);
    const sh = new EdgeStreamShipper(J as never, trungTam(x.e.runId) as never, { log: () => undefined });
    sh.setClaim(x.e.runId, 2, TOKEN);
    traLoi.length = 0;
    return { J, S, sh };
  };
  it("BC-MAY the step's machine is gone at central: nothing resolves it, its own name says STOP: read, no pin matches: the mismatch, no 409", async () => {
    fake.seed(machines, [...rows("machines"), { id: 3, machineType: "ROBOT", capabilities: null, code: "R3", name: "Robot-3", operationStatus: "stopped", stationId: 1 }]);
    const st: WorkflowStep = { id: "s1", type: "command", machineId: 3, command: "abort", args: { robotId: 2 } } as never;
    const x = await chayGiua(def("bcmay", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), st])])]));
    const { J, S, sh } = await doiCo(x);
    fake.store.set("machines", rows("machines").filter((m) => m.id !== 3));
    await sh.flush(S);
    expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
    expect(J.pending(S, 1).length).toBe(0);
    expect(dau(x.e.runId, "s1")).toBe("ghimLech");
  });
  it("BC-KHONG-ADAPTER no adapter resolves the step at central: read, not a pin: the mismatch, no 409", async () => {
    const x = await chayGiua(dMot("bcad"), undefined, false);
    const { J, S, sh } = await doiCo(x);
    fake.store.set("device_adapters", []);
    await sh.flush(S);
    expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
    expect(J.pending(S, 1).length).toBe(0);
    expect(dau(x.e.runId, "s1")).toBe("ghimLech");
  });
  it("BC-DB-MAY the machines cannot be read at the report: no classifier: 503, nothing applied, no mark, the same batch goes when the read is back", async () => {
    const x = await chayGiua(dMot("bcdbm"));
    const { J, S, sh } = await doiCo(x);
    bangDown = "machines";
    await sh.flush(S);
    expect(traLoi[0]).toMatchObject({ http: 503 });
    expect(J.ackedSeq(S)).toBe(0);
    bangDown = null;
    pinDown = true;
    await sh.flush(S);
    expect(traLoi.at(-1)).toMatchObject({ http: 200 });
    expect(J.pending(S, 1).length).toBe(0);
    expect(dau(x.e.runId, "s1")).toBe("docLoi");
  });
  it("BC-DB-ADAPTER the adapter read fails at the report: the same: 503, then it goes", async () => {
    const x = await chayGiua(dMot("bcdba"));
    const { J, S, sh } = await doiCo(x);
    bangDown = "device_adapters";
    await sh.flush(S);
    expect(traLoi[0]).toMatchObject({ http: 503 });
    bangDown = null;
    await sh.flush(S);
    expect(traLoi.at(-1)).toMatchObject({ http: 200 });
    expect(dau(x.e.runId, "s1")).toBeUndefined();
  });
  it("BC-NON-STOP-MAY a non-STOP whose machine is gone, no jti: no STOP by any reading: the old 409", async () => {
    fake.seed(machines, [...rows("machines"), { id: 3, machineType: "ROBOT", capabilities: null, code: "R3", name: "Robot-3", operationStatus: "stopped", stationId: 1 }]);
    const mv: WorkflowStep = { id: "m3", type: "command", machineId: 3, command: "run_job", args: { robotId: 2, jobType: "move", params: { x: 1 } } } as never;
    const x = await chayGiua(def("bcnm", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("s1")]), mv])]));
    await chuanBi(x.e, 2);
    const J = nhatKy();
    const S = edgeRunStream(x.e.runId, 2);
    J.them(S, stepRec("m3"));
    const sh = new EdgeStreamShipper(J as never, trungTam(x.e.runId) as never, { log: () => undefined });
    sh.setClaim(x.e.runId, 2, TOKEN);
    fake.store.set("machines", rows("machines").filter((m) => m.id !== 3));
    traLoi.length = 0;
    await sh.flush(S);
    expect(traLoi[0]).toMatchObject({ http: 409, code: "unauthorised_actuation" });
  });
  it("BC-HET a run that was never latched, a verified STOP, the pins differ at the report: the row marked, a URGENT told: the end as the walk went, nothing says it is confirmed", async () => {
    const x = await chayGiua(def("bchet", [gate(), otStop("s1")]), undefined, false);
    await giao(x, "lech");
    expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
    expect(dau(x.e.runId, "s1")).toBe("ghimLech");
    expect(runRow(x.e.runId).status).toBe("completed");
    expect(loaiCB("stopGhimLech")).toHaveLength(1);
  });
  it("BC-AUDIT the two forms apart in the audit too", async () => {
    const a = await chayGiua(dMot("bcau1"));
    await giao(a, "doc");
    expect(h.audit.some((x) => JSON.stringify(x).includes("stop_unconfirmed_read"))).toBe(true);
    expect(h.audit.some((x) => JSON.stringify(x).includes("stop_pin_mismatch"))).toBe(false);
  });
  it("BC-WALK a later walk does not read the marked row as a STOP that went: it is sent again, by a person's Continue", async () => {
    const x = await chayGiua(d2("bcwalk"), () => h.tuChoi.set("s2", OFFLINE));
    await giao(x, "doc");
    pinDown = false;
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    await continueOutcomeUnknown(x.e, "checked on site");
    await edgeSegment(x.e, 3);
    await wait(30);
    expect(h.sent.map((a) => a.stepId).sort()).toEqual(["s1", "s2"]);
  });
  // ── việc 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const CA: Array<[string, Record<string, any>, boolean]> = [
    ["tu_choi", { status: "rejected", error: "AUTHORIZATION_REQUIRED", detail: { edge: true, stop: false, reason: "AUTHORIZATION_REQUIRED", refusal: "stop_not_pinned:no_snapshot_adapter" } }, false],
    ["offline", OFFLINE, false],
    ["busy", { status: "rejected", error: "BUSY", detail: { edge: true, stop: true, pinnedStop: true, reason: "BUSY" } }, false],
    ["driver_failed", { status: "failed", error: "DRIVER_WRITE_FAILED", detail: { edge: true, stop: true, pinnedStop: true, reason: "DRIVER_WRITE_FAILED" } }, true],
    ["mot_phan", { status: "failed", error: "MOT_PHAN", detail: { edge: true, stop: true, pinnedStop: true, reason: "MOT_PHAN", motPhan: { daAp: ["a"], khongAp: ["b"] } } }, true],
    ["timeout", { status: "timeout", error: "no answer", detail: { edge: true, stop: true, pinnedStop: true } }, true],
  ];
  for (const [ten, kq, giu] of CA) {
    it(`BC-ROUTE ${ten}: routedTo ${giu ? "kept: it may have gone" : "dropped: it certainly did not"}; through the report, read down: no 409, every record applied`, async () => {
      const x = await chayGiua(dMot(`bcr${ten.length}${giu}`), () => h.tuChoi.set("s1", kq));
      const rec = x.e.records.slice(x.moc).filter((r: any) => r.kind === "step" && r.stepId === "s1" && r.result).map((r: any) => r.result);
      expect(rec.length).toBeGreaterThan(0);
      expect(rec.every((r: any) => (typeof r.routedTo === "string") === giu)).toBe(true);
      const { con } = await giao(x, "doc");
      expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
      expect(con).toBe(0);
      expect(dau(x.e.runId, "s1")).toBe(giu ? "docLoi" : undefined);
    });
  }
  // ── việc 4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  it("VIEC-4 the P3 shape: no URGENT says the run is held while central still shows it running", async () => {
    const x = await chayGiua(d2("v4"), () => h.tuChoi.set("s2", OFFLINE));
    await chuanBi(x.e, 2);
    const J = nhatKy();
    const S = edgeRunStream(x.e.runId, 2);
    for (const r of x.e.records.slice(x.moc)) J.them(S, r as never);
    for (const r of x.e.events ?? []) J.them("events", r);
    const sh = new EdgeStreamShipper(J as never, trungTam(x.e.runId) as never, { log: () => undefined });
    sh.setClaim(x.e.runId, 2, TOKEN);
    await sh.flush("events");
    await wait(20);
    expect(runRow(x.e.runId).status).toBe("running");
    expect(h.alerts.length).toBeGreaterThan(0);
    expect(tatCaChu()).not.toMatch(/the run is held/i);
  });
  // ── việc 5, 6: central ─────────────────────────────────────────────────────────────────────────────────────────────
  const dV = (ref: string, st: WorkflowStep = otStop("st")) => def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 40), st])])]);
  const dC = (ref: string, cs: WorkflowStep = otStop("cs")) => def(ref, [gate(), move("x", { compensation: cs })]);
  const hetCho = async (runId: number, ms = 2_500) => {
    await waitFor(() => !["running", "compensating", "queued"].includes(String(runRow(runId).status)), "the end of the walk", ms);
    await wait(30);
  };
  const DRV = { status: "failed", error: "connection reset by 10.1.2.3", detail: { reason: "DRIVER_WRITE_FAILED" } };
  const OFF = { status: "failed", detail: { reason: "ADAPTER_OFFLINE" } };
  const MP = { status: "failed", error: "MOT_PHAN", detail: { reason: "MOT_PHAN", motPhan: { daAp: ["halt"], khongAp: ["b"] } } };
  const BUSY = { status: "rejected", detail: { reason: "BUSY" } };
  const chuC = () => loaiCB("stopNotSent").map((a) => `${a.title} ${a.message}`).join(" | ");
  for (const [ten, lan, buTru] of [
    ["driver, then offline ×2", [DRV, OFF, OFF], false],
    ["MOT_PHAN, then BUSY ×2", [MP, BUSY, BUSY], false],
    ["compensation: driver, then offline ×2", [DRV, OFF, OFF], true],
    ["compensation: MOT_PHAN, then BUSY ×2", [MP, BUSY, BUSY], true],
  ] as const) {
    it(`P1 ${ten}: it may have gone out: 'not confirmed out', never 'did NOT go out'; the last attempt decides the state: held, Abort sends; C-CLR never writes 'not sent' over it`, async () => {
      seedHalt();
      h.ghim = PIN_OK;
      h.timeoutDispatch.add("x");
      const id = buTru ? "cs" : "st";
      h.tuChoiLan.set(id, lan.map((a) => ({ ...a })));
      const c = await centralRun(buTru ? dC(`p1${ten.length}${buTru}`) : dV(`p1${ten.length}${buTru}`), 1);
      await hetCho(c);
      expect(String(hang(c, id)!.error)).toMatch(new RegExp(`^FOE_STOP_NOT_SENT: STOP "${id}" is not confirmed out`));
      expect(viChuaRaCuaLoi(hang(c, id)!.error)?.nguon).toBe("driverLoi");
      expect(String(hang(c, id)!.error)).not.toContain("10.1.2.3");
      expect(chuC()).toContain("not confirmed out");
      expect(chuC()).not.toContain("did NOT go out");
      expect(runRow(c).status).toBe("held");
      // C-CLR: the read recovers, it says not pinned
      for (const t of rows("device_tags")) if (t.tagKey === "halt") t.stopValue = null;
      h.ghim = async () => ({ pinnedStop: false, loiDocGhim: null });
      h.timeoutDispatch.clear();
      h.sent.length = 0;
      await resumeRun(c, { approved: true, note: "not pinned" }, OTHER).catch(() => undefined);
      await hetCho(c);
      expect(String(hang(c, id)!.error)).not.toMatch(/^FOE_NOT_SENT_RUN_LATCHED/);
      expect(h.sent.filter((a) => a.stepId === id)).toEqual([]);
    });
  }
  it("P1-LUOT the mark crosses a walk, from the row: driver at the first walk; the next walk's STOP refused, BUSY: still 'not confirmed out', and Abort sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", DRV);
    const c = await centralRun(dV("p1lt"), 1);
    await hetCho(c);
    expect(viChuaRaCuaLoi(hang(c, "st")!.error)?.nguon).toBe("driverLoi");
    h.tuChoi.set("st", BUSY);
    h.timeoutDispatch.clear();
    await resumeRun(c, { approved: true, note: "again" }, OTHER).catch(() => undefined);
    await hetCho(c);
    expect(String(hang(c, "st")!.error)).toMatch(/is not confirmed out/);
    expect(runRow(c).status).toBe("held");
    h.tuChoi.clear();
    h.sent.length = 0;
    await abortRun(c, OWNER, "press");
    await wait(30);
    expect(h.sent.map((a) => a.stepId)).toEqual(["st"]);
  });
  it("P1-DOI-CHUNG refused on every attempt, offline ×3: 'did NOT go out' stands", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoiLan.set("st", [{ ...OFF }, { ...OFF }, { ...OFF }]);
    const c = await centralRun(dV("p1dc"), 1);
    await hetCho(c);
    expect(String(hang(c, "st")!.error)).toMatch(/did NOT go out/);
  });
  it("P1-EDGE inside one segment: driver, then offline ×2: 'not confirmed out'", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await edgeAssignedRun(dV("p1e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    h.timeoutDispatch.add("x");
    const ed = { edge: true, stop: true, pinnedStop: true };
    h.tuChoiLan.set("st", [{ ...DRV, detail: { ...ed, ...DRV.detail } }, { ...OFF, detail: { ...ed, ...OFF.detail } }, { ...OFF, detail: { ...ed, ...OFF.detail } }]);
    await edgeSegment(e, 2);
    await wait(30);
    expect(String(hang(e.runId, "st")!.error)).toMatch(/is not confirmed out/);
  });
  const QUEUED = { status: "rejected", error: "the node has it", detail: { reason: "ADAPTER_OWNED_BY_EDGE" } };
  for (const [ten, buTru] of [["forward", false], ["compensation", true]] as const) {
    it(`P2 ${ten}: ADAPTER_OWNED_BY_EDGE: queued for the node or sent by the fallback: 'not confirmed out', state C, held`, async () => {
      seedHalt();
      h.ghim = PIN_OK;
      h.timeoutDispatch.add("x");
      const id = buTru ? "cs" : "st";
      h.tuChoi.set(id, QUEUED);
      const c = await centralRun(buTru ? dC("p2c") : dV("p2f"), 1);
      await hetCho(c);
      expect(String(hang(c, id)!.error)).toMatch(new RegExp(`^FOE_STOP_NOT_SENT: STOP "${id}" is not confirmed out`));
      expect(chuC()).toContain("not confirmed out");
      expect(chuC()).not.toContain("did NOT go out");
      expect(runRow(c).status).toBe("held");
    });
  }
  const authCuaF = (e: EdgeHarness, id: string) => e.authorizeCalls.filter((a) => a.stepId === id).length;
  // ═══ lượt sửa 2 ═══════════════════════════════════════════════════════════════════════════════════════════════════
  const loaiTom = () => h.alerts.map((a) => `${String(a.kind).replace("foe_outcome_unknown_", "")}:${String(a.dedupKey).split(":")[2]}`);
  for (const [ten, dinh, id] of [["one STOP", "mot", "s1"], ["RA2-1 NEN, s2", "hai", "s2"]] as const) {
    it(`N1 ${ten}: verified at the claim, refused ADAPTER_OFFLINE ×3, the pins differ at the report: no mark, 0 mismatch URGENT, one stop_not_sent`, async () => {
      const x = await chayGiua(dinh === "mot" ? dMot(`n1${dinh}`) : d2(`n1${dinh}`), () => h.tuChoi.set(id, OFFLINE), false);
      await giao(x, "lech");
      await wait(20);
      expect(traLoi.filter((a) => a.http !== 200)).toEqual([]);
      expect(dau(x.e.runId, id)).toBeUndefined();
      expect(loaiTom().filter((k) => k === `stop_pin_mismatch:${id}`)).toEqual([]);
      expect(new Set(loaiTom().filter((k) => k === `stop_not_sent:${id}`)).size).toBe(1);
      expect(String(hang(x.e.runId, id)!.error)).toMatch(new RegExp(`^FOE_STOP_NOT_SENT: STOP "${id}"`));
    });
  }
  it("N1 docLoi: the same refusal, the read down at the report: no mark, no URGENT of a read", async () => {
    const x = await chayGiua(dMot("n1doc"), () => h.tuChoi.set("s1", OFFLINE), false);
    await giao(x, "doc");
    await wait(20);
    expect(dau(x.e.runId, "s1")).toBeUndefined();
    expect(loaiCB("stopKhongXacNhanDoc")).toEqual([]);
  });
  it("N1-DO the p9 shape, measured: the pin read was still failing at the CLAIM of its second run, so s1 was not verified there: the route, the refusal certain, routedTo dropped: no mark is the rule, not N1", async () => {
    pinDown = true; // what p9 left behind: its first sub-case set it, its loop's next claim read the pins through it
    const x = await chayGiua(dMot("n1p9"), () => h.tuChoi.set("s1", OFFLINE), false);
    const ghi = x.e.records.slice(x.moc).filter((r: any) => r.kind === "step" && r.stepId === "s1").map((r: any) => `${r.result?.status ?? "-"}:${typeof r.result?.routedTo === "string" ? "R" : "-"}:${r.jti ?? "-"}`);
    console.log("[PROBE N1-DO]", JSON.stringify({ authorize: authCuaF(x.e, "s1"), ghi }));
    await giao(x, "doc");
    expect(authCuaF(x.e, "s1"), "the route asks nobody").toBe(0);
    expect(ghi.filter((g) => g.includes(":R:"))).toEqual([]);
    expect(dau(x.e.runId, "s1")).toBeUndefined();
  });
  // N2: the classifier follows buildEquipmentCommand: jobType only for run_job
  const N2: Array<[string, Record<string, unknown>, boolean, number | null]> = [
    ["start", { command: "start", args: { tagKey: "run", value: 1 }, machineId: 1 }, false, 409],
    ["start, machine gone", { command: "start", args: { tagKey: "run", value: 1 }, machineId: 3 }, true, 409],
    ["start jobType abort", { command: "start", args: { tagKey: "run", value: 1, jobType: "abort" }, machineId: 1 }, false, 409],
    ["start jobType abort, machine gone", { command: "start", args: { tagKey: "run", value: 1, jobType: "abort" }, machineId: 3 }, true, 409],
    ["stop run=1", { command: "stop", args: { tagKey: "run", value: 1 }, machineId: 1 }, false, 200],
    ["stop, machine gone", { command: "stop", args: { tagKey: "halt", value: true }, machineId: 3 }, true, 200],
    ["robot run_job move, machine gone", { command: "run_job", args: { robotId: 2, jobType: "move", params: { x: 1 } }, machineId: 3 }, true, 409],
    ["robot abort, machine gone", { command: "abort", args: { robotId: 2 }, machineId: 3 }, true, 200],
    ["robot run_job abort, machine gone", { command: "run_job", args: { robotId: 2, jobType: "abort" }, machineId: 3 }, true, 200],
  ];
  for (const [ten, buoc, mat, http] of N2) {
    it(`N2 ${ten}: ${http === 409 ? "no STOP by the definition: 409" : "a STOP by the definition: the mark"}`, async () => {
      fake.seed(machines, [...rows("machines"), { id: 3, machineType: String(buoc.command).startsWith("st") ? "AUTOMATION" : "ROBOT", capabilities: null, code: "M3", name: "M-3", operationStatus: "stopped", stationId: 1 }]);
      fake.seed(deviceAdapters, [...rows("device_adapters"), { id: 503, machineId: 3, isEnabled: true, updatedAt: T0, protocol: "stub", code: "A503" }]);
      fake.seed(deviceTags, [...rows("device_tags"), { id: 81, adapterId: 503, tagKey: "run", address: "40001", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true }, { id: 82, adapterId: 503, tagKey: "halt", address: "00001", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true }]);
      const st = { id: "q", type: "command", ...buoc } as unknown as WorkflowStep;
      const x = await chayGiua(def(`n2${ten.length}${mat}${http}`, [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("s1")]), st])]));
      await chuanBi(x.e, 2);
      const J = nhatKy();
      const S = edgeRunStream(x.e.runId, 2);
      J.them(S, stepRec("q"));
      const sh = new EdgeStreamShipper(J as never, trungTam(x.e.runId) as never, { log: () => undefined });
      sh.setClaim(x.e.runId, 2, TOKEN);
      if (mat) fake.store.set("machines", rows("machines").filter((m) => m.id !== 3));
      traLoi.length = 0;
      await sh.flush(S);
      expect(traLoi[0]?.http).toBe(http);
      if (http === 200) expect(dau(x.e.runId, "q")).toBe("ghimLech");
    });
  }
  it("N2 engine: a latched run, a 'start' with args.jobType abort whose machine nothing resolves: never in a STOP plan, never 'Abort sends it again', 0 dispatches, an Abort after it too", async () => {
    fake.seed(machines, [...rows("machines"), { id: 3, machineType: "AUTOMATION", capabilities: null, code: "M3", name: "M-3", operationStatus: "stopped", stationId: 1 }]);
    fake.seed(deviceAdapters, [...rows("device_adapters"), { id: 503, machineId: 3, isEnabled: true, updatedAt: T0, protocol: "stub", code: "A503" }]);
    fake.seed(deviceTags, [...rows("device_tags"), { id: 81, adapterId: 503, tagKey: "run", address: "40001", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true }]);
    const q = { id: "q", type: "command", machineId: 3, command: "start", args: { tagKey: "run", value: 1, jobType: "abort" } } as unknown as WorkflowStep;
    const e = await edgeAssignedRun(def("n2eng", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), q])])]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    e.suaGoi = (p) => ({ ...p, machines: p.machines.filter((m) => m.id !== 3) });
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(30);
    expect(h.sent.filter((s) => s.stepId === "q")).toEqual([]);
    expect(String(hang(e.runId, "q")?.error ?? "")).not.toMatch(/FOE_STOP_NOT_SENT/);
    expect(h.alerts.filter((a) => String(a.message).includes('"q"') && /Abort sends it again/.test(String(a.message)))).toEqual([]);
    expect(stopChuaRaTuHang(stepRows(e.runId) as never).has("q")).toBe(false);
    h.timeoutDispatch.clear();
    await abortRun(e.runId, OWNER, "press");
    await wait(30);
    expect(h.sent.filter((s) => s.stepId === "q"), "the Abort after it").toEqual([]);
  });
  it("N2 central: a latched central run, a 'start' with args.jobType abort, its machine gone from central before the pass: 0 dispatches, not state C, no 'Abort sends it again', the Abort after it sends nothing", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    fake.seed(machines, [...rows("machines"), { id: 3, machineType: "AUTOMATION", capabilities: null, code: "M3", name: "M-3", operationStatus: "stopped", stationId: 1 }]);
    fake.seed(deviceAdapters, [...rows("device_adapters"), { id: 503, machineId: 3, isEnabled: true, updatedAt: T0, protocol: "stub", code: "A503" }]);
    const q = { id: "q", type: "command", machineId: 3, command: "start", args: { tagKey: "run", value: 1, jobType: "abort" } } as unknown as WorkflowStep;
    const d = def("n2tt", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), q])])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const c = s.runId!;
    // the machine leaves central: nothing resolves the step any more, only its own fields say what it is
    fake.store.set("machines", rows("machines").filter((m) => m.id !== 3));
    h.timeoutDispatch.add("x");
    const view = (await getRun(c, { bindingDigest: true }))!;
    await resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER).catch(() => undefined);
    await wait(200);
    const abortAgain = () => h.alerts.filter((a) => String(a.message).includes('"q"') && /Abort sends it again/.test(String(a.message)));
    expect(h.sent.filter((x) => x.stepId === "q"), "the walk").toEqual([]);
    expect(String(hang(c, "q")?.error ?? "")).not.toMatch(/FOE_STOP_NOT_SENT/);
    expect(stopChuaRaTuHang(stepRows(c) as never).has("q")).toBe(false);
    expect(abortAgain()).toEqual([]);
    h.timeoutDispatch.clear();
    await abortRun(c, OWNER, "press").catch(() => undefined);
    await wait(40);
    expect(h.sent.filter((x) => x.stepId === "q"), "the Abort after it").toEqual([]);
    expect(abortAgain()).toEqual([]);
  });
  // ── two named reds, each closed by its task ────────────────────────────────────────────────────────────────────────
  it("URGENT-LECH-MAT-T8 the mismatch URGENT lost between the commit and the raise: the records again, the segment end: a durable stop_pin_mismatch is owed", async () => {
    const x = await chayGiua(dMot("ulm"), undefined, false);
    await chuanBi(x.e, 2);
    const J = nhatKy();
    const S = edgeRunStream(x.e.runId, 2);
    for (const r of x.e.records.slice(x.moc)) J.them(S, r as never);
    const sh = new EdgeStreamShipper(J as never, trungTam(x.e.runId) as never, { log: () => undefined });
    sh.setClaim(x.e.runId, 2, TOKEN);
    for (const t of rows("device_tags")) if (t.tagKey === "halt") t.stopValue = null;
    // the crash: the process dies after the commit, inside the raise. Nothing is stored, no `baoBen` answers: the URGENT is not durable
    const chet: Array<Record<string, any>> = [];
    let benKhiChet = 0;
    // every durability answer given to a raise of the crash is counted, whoever gives it
    (chet as any).push = (...a: Array<Record<string, any>>) => {
      for (const v of a) {
        const bb = v.baoBen;
        if (typeof bb === "function") v.baoBen = (b: unknown) => (benKhiChet++, bb(b));
      }
      return Array.prototype.push.apply(chet, a);
    };
    h.raiseChet = chet;
    await sh.flush(S);
    await wait(30);
    h.raiseChet = null;
    expect(dau(x.e.runId, "s1")).toBe("ghimLech");
    expect(chet.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.stopGhimLech), "the crash took the raise of the mismatch URGENT").toHaveLength(1);
    expect(benKhiChet, "no durability answer in the crash").toBe(0);
    expect(loaiCB("stopGhimLech"), "nothing stored in the crash").toEqual([]);
    // after the restart: the same records again (a duplicate), then the segment end
    J.veLai(S);
    await sh.flush(S);
    await applyEdgeSegmentEnd(fake as never, x.e.runId, { ...(x.s.out as any), nodeCode: "EDGE-A", claimSeq: 2, def: x.d });
    await wait(40);
    // T8 turns this green by one call of its obligation sweeper here (the URGENT not yet durable, raised again), nothing else:
    // not the expectation below, not the crash above
    expect(benKhiChet, "the crashed raise stays without an answer").toBe(0);
    expect(h.alertDurable, "a raise outside the crash is stored: baoBen(true)").toBe(true);
    expect(loaiCB("stopGhimLech"), "T8: exactly one durable stop_pin_mismatch URGENT after the crash").toHaveLength(1);
  });
  it("BC-HET-KHONG-BEN-T7 a run with a marked row ends only on a durable URGENT: not durable (nobody to tell), and the sink throwing: held, at the end gate", async () => {
    const ket: string[] = [];
    for (const dang of ["khongBen", "nem"] as const) {
      h.alerts.length = 0;
      if (dang === "khongBen") h.alertDurable = false;
      const goc = h.alerts.push.bind(h.alerts);
      if (dang === "nem") {
        (h.alerts as any).push = (...a: any[]) => {
          if (/pin_mismatch/.test(String(a[0]?.kind))) throw new Error("sendNotification threw (test)");
          return goc(...a);
        };
      }
      const x = await chayGiua(def(`bchkb${dang}`, [gate(), otStop("s1")]), undefined, false);
      await giao(x, "lech");
      await wait(30);
      ket.push(`${dang}:${dau(x.e.runId, "s1")}:${runRow(x.e.runId).status}`);
      h.alertDurable = true;
      (h.alerts as any).push = goc;
      h.sent.length = 0;
      h.traTimeout = 0;
    }
    expect(ket, "T7: the end gate holds a run whose unconfirmed STOP has no durable URGENT").toEqual(["khongBen:ghimLech:held", "nem:ghimLech:held"]);
  });
  // ── N-walkBang ─────────────────────────────────────────────────────────────────────────────────────────────────────
  it("WALK-BANG a central walk reads the mark: a STOP row central could not verify is no last word: the STOP compensation of its container is due at the last pass", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    let runId = 0;
    h.sauTimeout = () => {
      // the mark only an edge report writes, on the row of a central run: what the last pass reads of it
      const r = stepRows(runId).find((s) => s.stepId === "st");
      if (r) r.resultJson = { ...(r.resultJson ?? {}), stopKhongXacNhan: "ghimLech" };
    };
    const d = def("wbang", [gate(), parF("p", [{ ...box("b", [otStop("st")]), compensation: otStop("cs") } as never, move("x")])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    runId = s.runId!;
    const view = (await getRun(runId, { bindingDigest: true }))!;
    await resumeRun(runId, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await wait(60);
    expect(hang(runId, "st")).toMatchObject({ status: "completed" });
    expect(h.sent.map((a) => a.stepId)).toContain("cs");
  });
});

// ═══ A2(n) T6c ═════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) T6c — a stop-typed step whose pin read did not answer on the edge; a stop-typed step in a branch never evaluated", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: false, steps, ...extra }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const brn = (id: string, thenS: WorkflowStep[], elseS: WorkflowStep[] = []): WorkflowStep => ({ id, type: "branch", condition: { source: "telemetry", machineId: 2, key: "temp", op: "lt", value: 100 }, then: thenS, else: elseS }) as never;
  /** stop-typed on a tag with no pin: not a STOP (R-5-j) */
  const stopTyped = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "run", value: 0 }, ...extra }) as never;
  const ids = () => h.sent.map((x) => x.stepId as string);
  const sentOf = (id: string) => h.sent.filter((x) => x.stepId === id);
  /** the hand-over carries no authorisation: the marked route */
  const khongUyQuyen = (x: Record<string, unknown>) => (x.edge as { authorization?: unknown } | null | undefined)?.authorization == null;
  const hang = (runId: number, id: string) => stepRows(runId).find((r) => r.stepId === id);
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const authCua = (e: EdgeHarness, id: string) => e.authorizeCalls.filter((a) => a.stepId === id).length;
  const urgentCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[kind]);
  const buocBo = () => urgentCua("forwardNotSent").map((a) => a.dedupKey.split(":")[2]);
  const veBuoc = (id: string) => h.alerts.filter((a) => String(a.title).includes(`"${id}"`) || String(a.dedupKey).split(":")[2] === id || String(a.dedupKey).split(":")[3] === id);
  const khongGui = new RegExp(`^${FOE_NOT_SENT_RUN_LATCHED}: `);
  const noCua = (c: number) => stopChuaRaTuHang(stepRows(c) as never);
  const hangDau = () => (fake.store.get("ai_pending_actions") ?? []).filter((a) => JSON.stringify(a.previewJson ?? {}).includes("hangMoiStopGhim"));
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    return e;
  }
  /** T6a NP1: nt never reached by the door, a container never begun */
  const NP1 = (ref: string) => def(ref, [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [stopTyped("nt")])])])]);
  /** the edge's own STOP check throws (e.laStopNem), the pins unreadable for central (PIN_BAD), the dispatcher decides by the real pins (dispatcherThat) */
  async function q2Edge(ref: string, dat: (e: EdgeHarness) => void = () => undefined) {
    const e = await denBuoc(NP1(ref));
    e.laStopNem = true;
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.duocSauKhoa.add("nt"); // F4 (decision 2, A): it reaches the dispatcher on the marked route; the table below still counts what it WROTE (khongGhi)
    dat(e);
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(60);
    return { e, s };
  }
  /** the dispatcher refuses nt before any driver: nothing written */
  const offline = () => {
    h.tuChoi.set("nt", { status: "failed", error: "ADAPTER_OFFLINE", detail: { edge: true, reason: "ADAPTER_OFFLINE" } });
    h.tuChoiKhongGhi.add("nt");
  };

  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  const BANG: string[] = [];
  /** what one case lets through the table, said there: a fake that answers no answer has not proved it wrote nothing */
  const mien = new Set<string>();
  beforeEach(() => {
    vi.mocked(logCrudOperation).mockClear();
    mien.clear();
  });
  afterEach(() => {
    delete process.env.FOE_DURABLE;
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    BANG.push(`${String(expect.getState().currentTestName).split(" > ").pop()?.slice(0, 70)} | ${sau.map((x) => `${String(x.stepId)}:${String(x.name)}${x.khongGhi ? ":0PDU" : ""}`).join(" ") || "-"}`);
    // by the PIN: an OT stop counts only when every write it carries is a pin of its adapter. A command the dispatcher itself refused wrote nothing (khongGhi)
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return LA_STOP.has(String(x.name));
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    const la = sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)) && x.khongGhi !== true && !mien.has(String(x.stepId)));
    expect(la.map((x) => x.stepId), "a command that is no pinned STOP reached a device after the latch").toEqual([]);
  });
  afterAll(() => {
    for (const l of BANG) console.log(`[PROBE sau-khoa T6c] ${l}`);
  });

  // ── Q2: the edge, its own STOP check throws ─────────────────────────────────────────────────────────────────────────
  // dieu-phoi 08/11 T6d-K2 — the package READ the pins and found none (PIN_BAD breaks only central's dispatch-time read, not the package): that answer stands, a check that throws does not make
  // it "unread". Not sent, no marked route, named as forward work. The marked route is for a package that could NOT read (stopsUnsure): (1u), (2u), (2bu)
  /** the package could not read nt's pins (what classifyLoi at the claim gives: stopsUnsure ["nt"]) */
  const goiChuaDoc = (id: string) => (e: EdgeHarness) => (e.suaGoi = (p) => ({ ...p, stopsUnsure: [...p.stopsUnsure, id] }));
  it("Q2-EDGE-NEM-T6c (1)(4) the edge's STOP check throws on nt: the marked route, not the door; the dispatcher's snapshot says not pinned: 0 PDU, forward work not sent, no STOP word", async () => {
    // T6d-K2 — was: the marked route. The package answered "not pinned": nt is never handed over, nobody is asked, forward work named
    const { e } = await q2Edge("q2a");
    expect(sentOf("nt"), "never handed over").toEqual([]);
    expect(authCua(e, "nt"), "nobody asked").toBe(0);
    expect(buocBo()).toEqual(["nt"]);
    expect(urgentCua("stopNotSent").filter((a) => a.dedupKey.split(":")[2] === "nt")).toEqual([]);
    const chu = veBuoc("nt").map((a) => `${a.kind} | ${a.title} | ${a.message}`).join(" || ");
    expect(veBuoc("nt").map((a) => a.kind)).toEqual([CANH_BAO_KHONG_RO_KIND.forwardNotSent]);
    expect(chu).not.toMatch(/STOP "nt"/);
    expect(chu, "never handed: the words say so (H11)").toContain("NOT handed to a dispatcher");
    expect(chu).toContain("nothing further goes forward");
  });
  it("Q2-EDGE-NEM-T6c (2) the same, the dispatcher refuses it before any driver (ADAPTER_OFFLINE): state C, stop_not_sent names nt, the run held; never failed FOE_NOT_SENT_RUN_LATCHED in silence", async () => {
    // T6d-K2 — was: state C. The dispatcher is never asked (the package answered): no C, not held, never silent
    const { e, s } = await q2Edge("q2b", offline);
    expect(sentOf("nt")).toEqual([]);
    expect(authCua(e, "nt")).toBe(0);
    expect(s.out.outcome).toBe("failed");
    expect(noCua(e.runId).has("nt")).toBe(false);
    expect(urgentCua("stopNotSent")).toEqual([]);
    expect(buocBo()).toEqual(["nt"]);
  });
  it("Q2-EDGE-NEM-T6c (1u) the STOP check throws, the package could NOT read the pins: the marked route as T5, the dispatcher's snapshot says not pinned: 0 PDU, forward work refused by its dispatcher", async () => {
    const { e } = await q2Edge("q2au", goiChuaDoc("nt"));
    expect(sentOf("nt").length, "the dispatcher decides").toBeGreaterThan(0);
    expect(sentOf("nt").every(khongUyQuyen), "the marked route carries no authorisation").toBe(true);
    expect(authCua(e, "nt"), "the marked route asks nobody").toBe(0);
    expect(sentOf("nt").every((x) => x.khongGhi === true), "the dispatcher wrote nothing").toBe(true);
    expect(buocBo()).toEqual(["nt"]);
    const chu = veBuoc("nt").map((a) => `${a.title} ${a.message}`).join(" || ");
    expect(chu).toContain("refused by its dispatcher before any driver");
    expect(chu).not.toContain("NOT handed to a dispatcher");
  });
  it("Q2-EDGE-NEM-T6c (2u) the STOP check throws, the package could NOT read the pins, the dispatcher refuses ADAPTER_OFFLINE: the marked route, state C, stop_not_sent names nt, the run held", async () => {
    const { e, s } = await q2Edge("q2bu", (x) => {
      goiChuaDoc("nt")(x);
      offline();
    });
    expect(sentOf("nt").length).toBeGreaterThan(0);
    expect(sentOf("nt").every(khongUyQuyen)).toBe(true);
    expect(authCua(e, "nt")).toBe(0);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(runRow(e.runId).status).toBe("held");
    expect(String(hang(e.runId, "nt")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "nt" did NOT go out/);
    expect(urgentCua("stopNotSent").map((a) => a.dedupKey.split(":").slice(2, 4))).toEqual([["nt", "-"]]);
    expect(noCua(e.runId).has("nt"), "owed").toBe(true);
    expect(buocBo(), "a STOP in state C is its own last word").toEqual([]);
  });
  it("Q2-EDGE-NEM-T6c (2b) a STOP compensation, the edge's STOP check throws: the marked route, refused before any driver: state C under its owner, the run held", async () => {
    // T6d-K2 — was: the marked route, state C. The package answered "not pinned": no STOP, never handed over, held for a person (the split)
    const e = await denBuoc(def("q2d", [gate(), move("x", { compensation: stopTyped("cs") })]));
    e.laStopNem = true;
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.tuChoi.set("cs", { status: "failed", error: "ADAPTER_OFFLINE", detail: { edge: true, reason: "ADAPTER_OFFLINE" } });
    h.tuChoiKhongGhi.add("cs");
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(60);
    expect(sentOf("cs")).toEqual([]);
    expect(authCua(e, "cs"), "nobody asked").toBe(0);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(urgentCua("stopNotSent")).toEqual([]);
    expect(urgentCua("held").map((a) => a.dedupKey.split(":").slice(2, 4))).toEqual([["x", "cs"]]);
  });
  it("Q2-EDGE-NEM-T6c (2bu) a STOP compensation, the check throws, the package could NOT read the pins: the marked route, refused before any driver: state C under its owner, the run held", async () => {
    const e = await denBuoc(def("q2du", [gate(), move("x", { compensation: stopTyped("cs") })]));
    e.laStopNem = true;
    goiChuaDoc("cs")(e);
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.duocSauKhoa.add("cs");
    h.tuChoi.set("cs", { status: "failed", error: "ADAPTER_OFFLINE", detail: { edge: true, reason: "ADAPTER_OFFLINE" } });
    h.tuChoiKhongGhi.add("cs");
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(60);
    expect(sentOf("cs").length).toBeGreaterThan(0);
    expect(sentOf("cs").every(khongUyQuyen), "the marked route").toBe(true);
    expect(authCua(e, "cs"), "the marked route asks nobody").toBe(0);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(String(hang(e.runId, "cs")!.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "cs" did NOT go out/);
    expect(urgentCua("stopNotSent").map((a) => a.dedupKey.split(":").slice(2, 4))).toEqual([["x", "cs"]]);
  });
  it("Q2-EDGE-NEM-T6c (4b) maxAttempts 2: answered not pinned, then no answer: never told as refused with nothing written", async () => {
    // T6d-K2 — the package could NOT read (else nt is never handed over): the marked route answers twice
    const e = await denBuoc(def("q2e", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [stopTyped("nt", { maxAttempts: 2 })])])])]));
    e.laStopNem = true;
    goiChuaDoc("nt")(e);
    h.ghim = PIN_BAD;
    h.duocSauKhoa.add("nt");
    h.tuChoiLan.set("nt", [{ status: "rejected", error: "AUTHORIZATION_REQUIRED", detail: { edge: true, stop: false, reason: "AUTHORIZATION_REQUIRED", refusal: "stop_not_pinned:no_pins" } }]);
    h.tuChoiKhongGhi.add("nt");
    h.timeoutSauTuChoi.add("nt");
    mien.add("nt"); // the fake's "no answer" comes before its pin check (h.dispatcherThat is not asked): the real edge dispatcher refuses an unpinned stop with no authorisation (classifyEdgeOtStop)
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(60);
    expect(sentOf("nt").length, "handed over again after the answer").toBeGreaterThan(1);
    expect(veBuoc("nt").map((a) => String(a.message)).join(" "), "the last answer was none: nothing says it was refused").not.toContain("refused by its dispatcher");
    expect(buocBo()).not.toContain("nt");
  });
  // ── Q2-ABORT-T7b (from T6c item 3; dieu-phoi đính chính 08/11 theo 5a): the Abort of that held run, task T7b ─────────────────
  /** the run held in state C: nt refused before any driver on the marked route, its URGENT says "Abort sends it again" */
  async function q2Giu(noi: "central" | "edge", ref: string): Promise<number> {
    if (noi === "edge") return (await q2Edge(ref, (e) => { goiChuaDoc("nt")(e); offline(); })).e.runId; // T6d-K2 — "the pins unreadable" on an edge is the package's stopsUnsure
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    offline();
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(NP1(ref), 1);
    await wait(60);
    return c;
  }
  const daGuiChu = /\b(was|were|been) sent\b|\bwent out\b/i;
  /** one Abort by a person, the read still throwing (classifyLoi): what it handed over, and what was told */
  async function bam(c: number) {
    h.sent.length = 0;
    h.alerts.length = 0;
    h.timeoutDispatch.clear();
    h.classifyLoi = true;
    const a = await abortRun(c, OWNER, "press");
    await wait(80);
    return a;
  }
  for (const noi of ["central", "edge"] as const) {
    it(`Q2-ABORT-T7b ${noi}: Abort of the held NP1 run takes the marked route; refused again: aborted, owed on abort:nt, a durable URGENT names nt, pressed again it goes; not a STOP: 0 written, forward work`, async () => { // the name stays; (B) is (i), below
      // (A) refused again / the read throws again
      const c = await q2Giu(noi, `q7${noi[0]}`);
      expect(runRow(c).status).toBe("held");
      expect(urgentCua("stopNotSent").map((a) => String(a.message)).join(" "), "the words the Abort must make true").toContain("Abort sends it again");
      const a1 = await bam(c);
      expect(a1.ok).toBe(true);
      expect(runRow(c).status).toBe("aborted");
      expect(sentOf("nt").length, "the Abort hands nt to the dispatcher on the marked route").toBeGreaterThan(0);
      expect(sentOf("nt").every((x) => x.khongGhi === true), "refused: nothing written").toBe(true);
      expect(hangDau().some((r) => String(r.id).includes("-abort-") && String(r.id).endsWith("-nt")), "a marked row: only the dispatcher's own verdict sends it").toBe(true);
      expect(hang(c, "abort:nt")?.status, "owed on its abort row").toBe("failed");
      expect(noCua(c).has("nt"), "still owed").toBe(true);
      const chu1 = veBuoc("nt").map((x) => `${x.title} ${x.message}`).join(" | ");
      expect(veBuoc("nt").length, "an URGENT names nt").toBeGreaterThan(0);
      expect(chu1, "never says the Abort sent it").not.toMatch(daGuiChu);
      const n1 = h.sent.length;
      await wait(150);
      expect(h.sent.length, "no automatic loop: only a person presses again").toBe(n1);
      // pressed again, the dispatcher now finds nt pinned: it goes, the debt is gone
      for (const t of rows("device_tags")) if (t.tagKey === "run") t.stopValue = 0;
      h.tuChoi.clear();
      h.tuChoiKhongGhi.clear();
      const a2 = await bam(c);
      expect(a2.ok).toBe(true);
      expect(sentOf("nt").some((x) => x.khongGhi !== true), "it went").toBe(true);
      expect(hang(c, "abort:nt")?.status).toBe("completed");
      expect(noCua(c).has("nt"), "the debt is gone").toBe(false);
      expect(runRow(c).status).toBe("aborted");
      // (B) a second run, the dispatcher says: no pinned STOP: 0 written, the words are forward work not sent
      for (const t of rows("device_tags")) if (t.tagKey === "run") t.stopValue = null;
      h.classifyLoi = false;
      const c2 = await q2Giu(noi, `q7${noi[0]}b`);
      h.tuChoi.clear();
      h.tuChoiKhongGhi.clear();
      await bam(c2);
      expect(sentOf("nt").length, "the dispatcher decides").toBeGreaterThan(0);
      expect(sentOf("nt").every((x) => x.khongGhi === true), "nothing written").toBe(true);
      // dieu-phoi 08/11: Q2(B) = (i); dispatcher không phân biệt không ghim / không đọc được
      expect(runRow(c2).status).toBe("aborted");
      expect(noCua(c2).has("nt"), "owed").toBe(true);
      expect(veBuoc("nt").map((x) => x.kind), "abort_stop_not_sent").toContain(CANH_BAO_KHONG_RO_KIND.abortStopNotSent);
      expect(veBuoc("nt").map((x) => x.kind), "no forward_not_sent").not.toContain(CANH_BAO_KHONG_RO_KIND.forwardNotSent);
      expect(veBuoc("nt").map((x) => `${x.title} ${x.message}`).join(" | ")).not.toMatch(daGuiChu);
    });
  }
  it("Q2-EDGE-NEM-T6c đối chứng central: the same tree, central's pins unreadable: the marked route, 0 PDU, state C, stop_not_sent:nt, held", async () => {
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.duocSauKhoa.add("nt");
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(NP1("q2k"), 1);
    await wait(60);
    expect(sentOf("nt").length).toBeGreaterThan(0);
    expect(sentOf("nt").every((x) => x.khongGhi === true)).toBe(true);
    expect(String(hang(c, "nt")!.error)).toMatch(/^FOE_STOP_NOT_SENT: /);
    expect(urgentCua("stopNotSent").map((a) => a.dedupKey.split(":")[2])).toEqual(["nt"]);
    expect(runRow(c).status).toBe("held");
    expect(buocBo()).toEqual([]);
  });

  // ── Q1: a stop-typed step in a branch never evaluated (H13) ─────────────────────────────────────────────────────────
  const q1 = async (ref: string, nhanh: WorkflowStep) => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def(ref, [gate(), parF("p", [move("x"), delay("w", 30)]), nhanh]), 1);
    await wait(60);
    return c;
  };
  it("Q1-NHANH-T6c [gate, parF(x, delay w), brn b [stopTyped nt]]: forward_not_sent:nt, as a move in the same place; nothing sent", async () => {
    await q1("q1a", brn("b", [stopTyped("nt")]));
    expect(ids()).toEqual(["x"]);
    expect(buocBo()).toEqual(["nt"]);
  });
  it("Q1-NHANH-T6c đối chứng: a move in the same place is named", async () => {
    await q1("q1m", brn("b", [move("m")]));
    expect(ids()).toEqual(["x"]);
    expect(buocBo()).toEqual(["m"]);
  });
  it("Q1-NHANH-T6c brn b [nt] else [m]: both nt and m named", async () => {
    await q1("q1b", brn("b", [stopTyped("nt")], [move("m")]));
    expect(ids()).toEqual(["x"]);
    expect([...buocBo()].sort()).toEqual(["m", "nt"]);
  });
  it("Q1-NHANH-T6c a stop-typed step WITH a valid pin in a branch never evaluated: not sent, listed in the URGENT stopUntakenBranch, not forward work", async () => {
    seedHalt();
    await q1("q1c", brn("b", [otStop("st")]));
    expect(ids()).toEqual(["x"]);
    expect(urgentCua("stopUntakenBranch").map((a) => a.dedupKey.split(":")[2])).toEqual(["st"]);
    expect(buocBo()).toEqual([]);
  });
  it("Q1-NHANH-T6c the planner's pin read throws, a branch never evaluated: not sent, listed as a STOP of that branch (stopUntakenBranch), not forward work", async () => {
    h.classifyLoi = true;
    await q1("q1d", brn("b", [stopTyped("nt")]));
    expect(ids()).toEqual(["x"]);
    expect(urgentCua("stopUntakenBranch").map((a) => a.dedupKey.split(":")[2])).toEqual(["nt"]);
    expect(buocBo()).toEqual([]);
  });
  it("Q1-NHANH-T6c the dispatch-time pin read is down (PIN_BAD), the planner's read answered not pinned: not sent, forward_not_sent:nt", async () => {
    h.ghim = PIN_BAD;
    await q1("q1e", brn("b", [stopTyped("nt")]));
    expect(ids()).toEqual(["x"]);
    expect(buocBo()).toEqual(["nt"]);
    expect(urgentCua("stopUntakenBranch")).toEqual([]);
  });
  it("Q1-NHANH-T6c edge: the same tree, the edge names nt, central raises the URGENT", async () => {
    const e = await denBuoc(def("q1f", [gate(), parF("p", [move("x"), delay("w", 30)]), brn("b", [stopTyped("nt")])]));
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(60);
    expect(ids()).toEqual(["x"]);
    expect(buocBo()).toEqual(["nt"]);
  });
});

// ═══ A2(n) T6e ═════════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * A2(n) T6e — ONE "pinned" predicate for the sweep's verifier and the dispatcher. The dispatcher classifies the writes step 3b will send: a DECLARED tag's value coerced by type
 * (writesEpKieuChoRangBuoc, epKieuKenh); the verifier used to compare the RAW write. A STOP writing "true" to a declared bool pin: the dispatcher's STOP, the verifier's notPinned, so
 * no pass sent it and nobody was told (rà T6b, loại (2)). Here the dispatcher's predicate is the REAL one (h.ghimThat) over the fake's device_tags.
 */
describe("A2(n) T6e — one pinned predicate for the sweep's verifier and the dispatcher", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: false, steps, ...extra }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const ids = () => h.sent.map((x) => x.stepId as string);
  const hang = (runId: number, id: string) => stepRows(runId).find((r) => r.stepId === id);
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const urgentCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[kind]);
  const mayMap = () => new Map<number, MachineForValidation>(rows("machines").map((m) => [m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities }] as const));
  /** declared write channels (channel_kind): the dispatcher coerces what is written to them. An undeclared bool pin too: its write goes on as sent */
  const seedKhai = () =>
    fake.seed(deviceTags, [
      ...rows("device_tags"),
      { id: 81, adapterId: 501, tagKey: "haltk", address: "00011", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true, channelKind: "output" },
      { id: 82, adapterId: 501, tagKey: "nk", address: "40011", dataType: "int", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true, stopValue: 5, channelKind: "output" },
      { id: 83, adapterId: 501, tagKey: "nks", address: "40012", dataType: "int", scale: "0.5", offset: "0", updatedAt: T0, writable: true, isEnabled: true, stopValue: 5, channelKind: "output" },
      { id: 84, adapterId: 501, tagKey: "fk", address: "40013", dataType: "float", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: 1.5, channelKind: "output" },
      { id: 85, adapterId: 501, tagKey: "sk", address: "40014", dataType: "string", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: "OFF", channelKind: "output" },
      { id: 86, adapterId: 501, tagKey: "haltu", address: "00012", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true },
    ]);
  /** the step of the gap: a STOP writing the string "true" to the declared bool pin */
  const stEp = (id: string, extra: Record<string, unknown> = {}) => otStop(id, { args: { tagKey: "haltk", value: "true" }, ...extra });
  /** the rows a crash leaves on a latched run (as T3+T4 `chet`) */
  function chet(runId: number, keep: string[]) {
    process.env.FOE_DURABLE = "true";
    const chot = runRow(runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY];
    expect(chot).toBeTruthy();
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== runId || keep.includes(r.stepId)));
    const latched = stepRows(runId).find((r) => r.stepId === chot.stepId);
    if (latched) Object.assign(latched, { status: "running", error: null, finishedAt: null });
    Object.assign(runRow(runId), { status: "held", finishedAt: null, error: null, contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: chot, interrupted: true } });
    h.sent.length = 0;
    h.alerts.length = 0;
    h.traTimeout = 1;
  }
  async function chay(d: WorkflowDefinition) {
    seedKhai();
    h.ghimThat = true;
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(d, 1);
    await wait(80);
    return c;
  }

  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  const BANG: string[] = [];
  afterEach(() => {
    delete process.env.FOE_DURABLE;
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    BANG.push(`${String(expect.getState().currentTestName).split(" > ").pop()?.slice(0, 70)} | ${sau.map((x) => `${String(x.stepId)}:${String(x.name)}`).join(" ") || "-"}`);
    // by the PIN: an OT stop counts only when every write it carries is a pin of its adapter
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return x.name === "abort";
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    const la = sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)));
    expect(la.map((x) => x.stepId), "a command that is no pinned STOP reached the dispatcher after the latch").toEqual([]);
  });
  afterAll(() => {
    for (const l of BANG) console.log(`[PROBE sau-khoa] ${l}`);
  });

  // ── (1) the three silent shapes and the door, central: the STOP goes like any pinned STOP ──────────────────────────
  it("T6E-NP1 a pinned STOP writing \"true\" to a declared bool pin, in a container never begun: it goes, once; nothing says it was not sent", async () => {
    const c = await chay(def("t6enp1", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [stEp("st")])])])]));
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(String(hang(c, "st")?.error ?? "")).not.toMatch(/NOT_SENT|not sent/i);
    expect(urgentCua("forwardNotSent").filter((a) => a.dedupKey.split(":")[2] === "st")).toEqual([]);
  });
  it("T6E-TREN the same STOP above a parallel that failed: it goes, once", async () => {
    await chay(def("t6etren", [gate(), parF("p", [move("x"), delay("w", 30)]), stEp("st")]));
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("T6E-BOOT the same STOP of NP1, a crash before its row, the boot's walk: it goes, once", async () => {
    const c = await chay(def("t6eboot", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [stEp("st")])])])]));
    chet(c, ["g1", "p", "x", "v"]);
    h.ghimThat = true;
    await autoResumeInterruptedRuns([c]);
    await wait(80);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("T6E-CUA the same STOP reached by the door: it goes, once; no forward_not_sent, no 'NOT handed', its row not 'not sent'", async () => {
    const c = await chay(def("t6ecua", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), stEp("st")])])]));
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(String(hang(c, "st")?.error ?? "")).not.toMatch(new RegExp(`^${FOE_NOT_SENT_RUN_LATCHED}`));
    expect(urgentCua("forwardNotSent").filter((a) => a.dedupKey.split(":")[2] === "st")).toEqual([]);
    expect(h.alerts.map((a) => `${a.title} ${a.message}`).join(" ")).not.toMatch(/"st" was NOT handed/);
  });
  it("T6E-DOI-CHUNG the same shapes with a value the dispatcher does not take for the pin (\"false\"): not sent, named as forward work (loại (1) side)", async () => {
    const c = await chay(def("t6edc", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [otStop("st", { args: { tagKey: "haltk", value: "false" } })])])])]));
    expect(ids()).toEqual(["x"]);
    expect(urgentCua("forwardNotSent").map((a) => a.dedupKey.split(":")[2])).toContain("st");
    expect(runRow(c).status).toBe("failed");
  });

  // ── (2) the equivalence table: the verifier and the dispatcher, the same verdict on every row ──────────────────────
  const TAGS = ["haltk", "haltu", "nk", "nks", "fk", "sk"] as const;
  const VALUES: unknown[] = ["true", "false", "1", "0", " TRUE ", 1, 0, true, false, null, "abc", 5, 2.5, "5", "5.0", 6, "6", 1.5, "1.5", "OFF", "off", "", [1], { v: 1 }];
  const viTu = async (tagKey: string, value: unknown) => {
    const st = otStop("s", { args: { tagKey, value } });
    const v = await verifiedStopStepIds(def("t6ebang", [st]), mayMap(), fake as never);
    h.ghimThat = true;
    const dp = await phanLoaiStopGhimChoFoe(fake as never, { adapterId: 501, commandType: "stop", writes: [{ tagKey, value }] });
    // T6e lượt sửa 2 — the edge package's builder too, the REAL one (edgeRunAnalysis.analyseDefinition), never the harness's claimPackage
    const an = await analyseDefinition(fake as never, 1, def("t6ebang", [st]), mayMap());
    return { verifier: v.ids.has("s"), unsure: v.unsure.has("s"), dispatcher: dp.pinnedStop, goi: an.verifiedStops.some((x) => x.stepId === "s"), goiUnsure: an.stopsUnsure.includes("s") };
  };
  // commit đóng T6e — the edge package (analyseDefinition) compares the RAW write ON PURPOSE, with the edge dispatcher (EP-KIEU-EDGE, outside A2(n)): its column differs from central's
  // on exactly the rows the coercion changes, and nowhere else
  const DONG_EP = ['fk="1.5"', 'haltk=" TRUE "', 'haltk="1"', 'haltk="true"', 'nk="5"', 'nks="5"', 'nks="5.0"'];
  it("T6E-BANG every (tag, value) row: the verifier and the dispatcher give the same pinned / not pinned, never unsure on a readable pin; the edge package (raw, on purpose) differs on the coerced rows only", async () => {
    seedKhai();
    const lech: string[] = [];
    const khacGoi: string[] = [];
    const bang: string[] = [];
    for (const t of TAGS) {
      for (const v of VALUES) {
        const r = await viTu(t, v);
        bang.push(`${t}=${JSON.stringify(v)} v:${r.verifier ? 1 : 0} d:${r.dispatcher ? 1 : 0} g:${r.goi ? 1 : 0}`);
        if (r.unsure || r.goiUnsure || r.verifier !== r.dispatcher) lech.push(`${t}=${JSON.stringify(v)} verifier:${r.verifier}${r.unsure ? "(unsure)" : ""} dispatcher:${r.dispatcher} package:${r.goi}${r.goiUnsure ? "(unsure)" : ""}`);
        if (r.goi !== r.dispatcher) khacGoi.push(`${t}=${JSON.stringify(v)}${r.goi ? " package-only" : ""}`);
      }
    }
    console.log(`[PROBE t6e-bang] ${bang.join(" ; ")}`);
    expect(lech).toEqual([]);
    expect(khacGoi.sort(), "the package (raw) differs from central on the coerced rows only, never pinned where central is not").toEqual([...DONG_EP].sort());
  });
  it("T6E-BANG-LOAI2 the rows the gap was: a coercible value equal to the pin is pinned on both sides", async () => {
    seedKhai();
    for (const [t, v] of [["haltk", "true"], ["haltk", "1"], ["haltk", " TRUE "], ["nk", "5"], ["fk", "1.5"]] as const) expect(await viTu(t, v), `${t}=${JSON.stringify(v)}`).toEqual({ verifier: true, unsure: false, dispatcher: true, goi: false, goiUnsure: false }); // the package: raw on purpose (EP-KIEU-EDGE)
  });
  it("T6E-BANG-LOAI1 not pinned stays not pinned on both sides: a coercible value that is not the pin, one that cannot be coerced, null, a type that does not fit, an undeclared tag's string", async () => {
    seedKhai();
    for (const [t, v] of [["haltk", "false"], ["haltk", "0"], ["haltk", false], ["haltk", 0], ["haltk", null], ["haltk", "abc"], ["haltk", 5], ["haltk", 2.5], ["nk", 6], ["nk", "6"], ["nk", "abc"], ["nk", true], ["sk", "off"], ["sk", 1], ["fk", "abc"], ["haltu", "true"], ["haltu", "1"]] as const) {
      expect(await viTu(t, v), `${t}=${JSON.stringify(v)}`).toEqual({ verifier: false, unsure: false, dispatcher: false, goi: false, goiUnsure: false });
    }
  });

  // ── T6e lượt sửa 1 (dieu-phoi 08/11 T6e-K1, direction A) — the pin read at two moments: the sweep's verifier read no pin, the dispatcher's own predicate (asked later) says a
  // pinned STOP. Not sent (direction B, "by the dispatcher", is not this lot), not state C, no Abort promised: named, in the words of a STOP whose pin could not be verified.
  // Modelled with h.ghim (the dispatcher's predicate) answering pinned for a write device_tags does not pin: nothing of it is sent, so the GHIM table has nothing to forgive.
  const noCua = (c: number) => stopChuaRaTuHang(stepRows(c) as never);
  const chuCua = (a: Record<string, any>) => `${a.kind}|${String(a.title)}|${String(a.message).replace(/ \[event [^\]]*\]$/, "")}`;
  const veSt = () => h.alerts.filter((a) => String(a.dedupKey).split(":")[2] === "st");
  const khongPin = (id: string) => otStop(id, { args: { tagKey: "run", value: 0 } });
  async function haiThoiDiem(d: WorkflowDefinition) {
    seedKhai();
    h.ghim = PIN_OK;
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(d, 1);
    await wait(80);
    return c;
  }
  const chuKhongXacMinh = (s: string) => {
    expect(s).toContain('"st"');
    expect(s).toMatch(/STOP/);
    expect(s).toMatch(/could not verify/);
    expect(s).toContain("NOT sent");
    expect(s).toContain("Check the machine on site");
    expect(s).not.toMatch(/Abort/);
    expect(s).not.toMatch(/NOT handed/);
  };
  it("T6E-K1-NP1 two moments, a container never begun: not sent, not state C, exactly one URGENT names st as a STOP whose pin could not be verified; no Abort", async () => {
    const c = await haiThoiDiem(def("t6ek1np1", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [khongPin("st")])])])]));
    expect(ids()).toEqual(["x"]);
    expect(veSt(), "exactly one URGENT names st").toHaveLength(1);
    chuKhongXacMinh(`${veSt()[0].title} ${veSt()[0].message}`);
    expect(noCua(c).size, "not state C").toBe(0);
    expect(runRow(c).status).toBe("failed");
  });
  it("T6E-K1-CUA two moments, reached by the door: not sent, its row says not sent, one URGENT in the words of a STOP not verified (never 'NOT handed')", async () => {
    const c = await haiThoiDiem(def("t6ek1cua", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), khongPin("st")])])]));
    expect(ids()).toEqual(["x"]);
    expect(veSt()).toHaveLength(1);
    chuKhongXacMinh(`${veSt()[0].title} ${veSt()[0].message}`);
    expect(noCua(c).size).toBe(0);
  });
  it("T6E-K1-SAU two moments, the STOP behind a dropped command of the same sequence: both named, the STOP in its own words (every one, not only the first of the branch)", async () => {
    await haiThoiDiem(def("t6ek1sau", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [ot("m"), khongPin("st")])])])]));
    expect(ids()).toEqual(["x"]);
    expect(urgentCua("forwardNotSent").map((a) => a.dedupKey.split(":")[2]).sort()).toEqual(["m", "st"]);
    chuKhongXacMinh(`${veSt()[0].title} ${veSt()[0].message}`);
  });
  it("T6E-K1-LAP two moments, the walk again (a crash, the boot): never two URGENTs in one walk; the boot's walk says the same words", async () => {
    const c = await haiThoiDiem(def("t6ek1lap", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [khongPin("st")])])])]));
    const dau = veSt().map(chuCua);
    expect(dau).toHaveLength(1);
    chet(c, ["g1", "p", "x", "v"]);
    h.ghim = PIN_OK;
    await autoResumeInterruptedRuns([c]);
    await wait(80);
    expect(ids()).toEqual([]);
    expect(veSt().map(chuCua), "one URGENT of the boot's walk, the same words").toEqual(dau);
  });
  it("T6E-K1-DOI-CHUNG the dispatcher's predicate also says not pinned (one moment): named as forward work in the old words, not as a STOP", async () => {
    seedKhai();
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("t6ek1dc", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [khongPin("st")])])])]), 1);
    await wait(80);
    expect(veSt()).toHaveLength(1);
    expect(String(veSt()[0].message)).toContain('Command "st" was NOT handed to a dispatcher');
  });
  // the edge: its verifier and its own STOP check both read the package (verifiedStops / stopsUnsure), so they never disagree by this mechanism: the shape cannot be built there
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    return e;
  }
  it("T6E-K1-EDGE the same model on an edge run: h.ghim is never the edge's word; the package said not pinned, st is forward work dropped, in the old words", async () => {
    seedKhai();
    h.ghim = PIN_OK;
    const e = await denBuoc(def("t6ek1e", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [khongPin("st")])])])]));
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await wait(40);
    expect(ids()).toEqual(["x"]);
    expect(veSt()).toHaveLength(1);
    expect(String(veSt()[0].message)).toContain('Command "st" was NOT handed to a dispatcher');
  });

  // ── the edge package (analyseDefinition, the REAL one): raw on purpose (commit đóng T6e); loại (1) guards; the same input on an edge run, unlatched and latched ──
  it("T6E-GOI-LOAI1 only a STOP enters verifiedStops: a pinned STOP does; a non-STOP command writing \"true\" or true to the bool pin does not, nor a plain write; the coerced STOP is no STOP to the package (raw), a STOP to central", async () => {
    seedKhai();
    const d = def("t6egoi1", [otStop("sv", { args: { tagKey: "haltk", value: true } }), stEp("st"), ot("m", { args: { tagKey: "haltk", value: "true" } }), ot("m2", { args: { tagKey: "haltk", value: true } }), ot("n")]);
    const an = await analyseDefinition(fake as never, 1, d, mayMap());
    expect(an.verifiedStops.map((x) => x.stepId)).toEqual(["sv"]);
    expect(an.stopsUnsure).toEqual([]);
    expect([...(await verifiedStopStepIds(d, mayMap(), fake as never)).ids].sort()).toEqual(["st", "sv"]);
  });
  /** the edge segment's package is analyseDefinition's, not the harness's claimPackage (whose verifier coerces: HARNESS-GOI-THAT, T13) */
  const goiThat = async (e: EdgeHarness, d: WorkflowDefinition) => {
    const an = await analyseDefinition(fake as never, e.runId, d, mayMap());
    e.suaGoi = (p) => ({ ...p, verifiedStops: an.verifiedStops, stopsUnsure: an.stopsUnsure });
    return an;
  };
  it("T6E-Q1 an edge run NOT latched, a STOP writing \"true\" to the declared bool pin, the REAL package: as the base: asks /authorize, goes with its authorisation, completed", async () => {
    seedKhai();
    h.dispatcherThat = true;
    const d = def("t6eq1", [gate(), stEp("st")]);
    const e = await denBuoc(d);
    expect((await goiThat(e, d)).verifiedStops, "the package: raw, no verified STOP").toEqual([]);
    const s = await edgeSegment(e, 2);
    await wait(30);
    expect(e.authorizeCalls.map((a) => a.stepId)).toContain("st");
    const giao = h.sent.filter((x) => x.stepId === "st");
    expect(giao.length).toBeGreaterThan(0);
    expect(giao.every((x) => (x.edge as { authorization?: unknown } | null)?.authorization != null && x.khongGhi !== true), "handed over with its authorisation, written").toBe(true);
    expect(s.out.outcome).toBe("completed");
    expect(runRow(e.runId).status).toBe("completed");
    expect(hang(e.runId, "st")).toMatchObject({ status: "completed" });
  });
  // dieu-phoi 08/11 T6e-K2 — was: E-C6 through a package that coerced (lượt sửa 2, reverted by the commit đóng). The package is raw: the edge never hands st over and names it forward
  // work; central, which takes st for a pinned STOP, says so in the T6e-K1 words, in the run's durable URGENT. The edge's behaviour is the base's
  it("T6E-EC6-EP a STOP writing \"true\" to a declared bool pin, edge run LATCHED, the REAL package: not sent, 0 PDU, run failed; central's durable URGENT names st in the T6e-K1 words (dieu-phoi 08/11 T6e-K2), never 'Command … NOT handed'", async () => {
    seedKhai();
    h.dispatcherThat = true;
    const d = def("t6eec6", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), stEp("st")])])]);
    const e = await denBuoc(d);
    expect((await goiThat(e, d)).verifiedStops, "the package: raw, no verified STOP").toEqual([]);
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    await wait(60);
    expect(s.out.outcome).toBe("failed");
    expect(runRow(e.runId).status).toBe("failed");
    expect(h.sent.filter((x) => x.stepId === "st" && x.khongGhi !== true), "0 PDU").toEqual([]);
    expect(noCua(e.runId).size, "not state C").toBe(0);
    expect(veSt(), "exactly one URGENT names st").toHaveLength(1);
    const a = veSt()[0];
    expect(a.kind).toBe(CANH_BAO_KHONG_RO_KIND.forwardNotSent);
    expect(a.khuTrungBenVung, "durable: deduplicated per person and key").toBeDefined();
    chuKhongXacMinh(`${a.title} ${a.message}`);
    expect(h.alerts.map((x) => `${x.title} ${x.message}`).join(" ")).not.toMatch(/Command "st" was NOT handed/);
  });
});

// ═══ A2(n) T7 ══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) T7 — the end gate: one decision, the debt read from the rows, a durable URGENT (decision 1, B, H1, H2, M4)", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const REF = { status: "rejected", error: "INTERLOCK_NOT_MET: refused" };
  const KET_THUC = ["completed", "failed", "aborted"];
  const runEnd = () => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.runEnd);
  const khoaRunEnd = (c: number, step: string) => `${CANH_BAO_KHONG_RO_KIND.runEnd}:${c}:${step}:${KHONG_CO_BU_TRU}:chot`;
  const daBao = (c: number) => (runRow(c).contextJson as Record<string, unknown> | null)?.[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY];
  const auditAbort = (via: string) =>
    vi
      .mocked(logCrudOperation)
      .mock.calls.map((c) => (c[1] as { details?: { operation?: string; metadata?: Record<string, any> } }).details)
      .filter((d) => d?.operation === "foe_outcome_unknown_abort" && d.metadata?.via === via)
      .map((d) => d!.metadata!);
  const ids = () => h.sent.map((x) => String(x.stepId));
  /** x answers no word: the run latches, x has no compensation of its own */
  const dX = (ref: string) => def(ref, [gate(), ot("x")]);
  /** state C: the STOP st refused by its dispatcher, three times, on a latched run. Without a gate the latch is a STOP with no answer (a non-STOP needs a gate approval) */
  const dV = (ref: string, gateDau = true) => def(ref, [...(gateDau ? [gate()] : []), parF("p", [gateDau ? move("x") : robotStop("x"), box("b", [delay("w", 40), otStop("st")])])]);
  const vaoC = () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
  };
  const tiepTuc = async (c: number, note?: string) => {
    grantMachineControl();
    const view = (await getRun(c, { bindingDigest: true }))!;
    return resumeRun(c, { approved: true, ...(note ? { note } : {}), expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  };
  /** G1: latched, nothing durable */
  const g1 = async (ref: string) => {
    h.timeoutDispatch.add("x");
    h.alertDurable = false;
    const c = await centralRun(dX(ref), 1);
    await wait(20);
    return c;
  };
  /** nobody to tell from here on: the run has no owner any more, and no admin / supervisor is active (M4). x was sent under its owner's gate (a run with no owner sends no non-STOP) */
  const khongNguoi = (c: number) => {
    runRow(c).startedBy = null;
  };

  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  const BANG: string[] = [];
  beforeEach(() => {
    vi.mocked(logCrudOperation).mockClear();
    vi.mocked(logCrudOperation).mockImplementation(async () => ({ id: 1 }) as never);
  });
  afterEach(() => {
    vi.mocked(logCrudOperation).mockImplementation(async () => ({ id: 1 }) as never);
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    BANG.push(`${String(expect.getState().currentTestName).split(" > ").pop()?.slice(0, 70)} | ${sau.map((x) => `${String(x.stepId)}:${String(x.name)}`).join(" ") || "-"}`);
    // by the PIN: an OT stop counts only when every write it carries is a pin of its adapter; a robot's `abort` is the robot rule
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return x.name === "abort";
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    const la = sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)) && !h.duocSauKhoa.has(String(x.stepId)));
    expect(la.map((x) => x.stepId), "a command that is no pinned STOP reached the dispatcher after the latch").toEqual([]);
  });
  afterAll(() => {
    for (const l of BANG) console.log(`[PROBE sau-khoa T7] ${l}`);
  });

  // ── decision 1: no durable URGENT, no end ──────────────────────────────────────────────────────────────────────────
  it("G1 central, the URGENT not durable: held, not failed; one run_end URGENT under the fixed key; the run's words say so", async () => {
    const c = await g1("t7g1");
    expect(runRow(c).status).toBe("held");
    expect(runEnd().map((a) => a.dedupKey)).toEqual([khoaRunEnd(c, "x")]);
    expect(String(runRow(c).error)).toMatch(/^FOE_OUTCOME_UNKNOWN: /);
    expect(String(runRow(c).error)).toContain("URGENT");
    expect(daBao(c), "nothing durable: the obligation stands").toBeUndefined();
  });
  it("G1b central, the URGENT durable: the run ends as the walk went, the mark DA_BAO is on the run, no run_end beside the walk's own", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(dX("t7g1b"), 1);
    await wait(20);
    expect(runRow(c).status).toBe("failed");
    expect(daBao(c)).toMatchObject({ stepId: "x" });
    expect(runEnd()).toEqual([]);
  });
  it("G2 two boots after G1: the held run is not walked again, nothing sent, no URGENT more", async () => {
    const c = await g1("t7g2");
    expect(runRow(c).status).toBe("held");
    const sent = h.sent.length;
    const n = h.alerts.length;
    await rehydrateInterruptedRuns();
    await rehydrateInterruptedRuns();
    await wait(30);
    expect(runRow(c).status).toBe("held");
    expect(h.sent.length).toBe(sent);
    expect(h.alerts.length).toBe(n);
  });
  it("G3 Continue while the URGENT fails, then once it lands: held, held, then failed; every run_end under the one key", async () => {
    const c = await g1("t7g3");
    expect(runRow(c).status).toBe("held");
    await tiepTuc(c);
    await wait(20);
    expect(runRow(c).status, "a Continue that cannot store the URGENT either").toBe("held");
    h.alertDurable = true;
    const goc = h.alerts.push.bind(h.alerts);
    (h.alerts as any).push = (...a: any[]) => {
      if (a[0]?.kind !== CANH_BAO_KHONG_RO_KIND.runEnd) throw new Error("sendNotification threw (test)");
      return goc(...a);
    };
    try {
      await tiepTuc(c);
      await wait(20);
    } finally {
      (h.alerts as any).push = goc;
    }
    expect(runRow(c).status).toBe("failed");
    expect(runEnd().map((a) => a.dedupKey)).toEqual([khoaRunEnd(c, "x"), khoaRunEnd(c, "x"), khoaRunEnd(c, "x")]);
    expect(daBao(c)).toMatchObject({ stepId: "x" });
  });
  it("G8 recipients=0 (no owner, no admin / supervisor): not durable whatever the alert says, held (M4)", async () => {
    const c = await g1("t7g8");
    expect(runRow(c).status).toBe("held");
    khongNguoi(c);
    h.alertDurable = true;
    h.alerts.length = 0;
    await tiepTuc(c);
    await wait(20);
    expect(runRow(c).status, "the alert says stored, there was nobody to store it for").toBe("held");
    expect(runEnd().map((a) => a.recipients)).toEqual([[]]);
    expect(daBao(c)).toBeUndefined();
  });
  it("G12 the run_end raise gets no answer (the process stepped aside, nothing stored): no answer is no yes, held", async () => {
    h.timeoutDispatch.add("x");
    h.raiseChet = [];
    const c = await centralRun(dX("t7g12"), 1);
    await wait(20);
    const chet = h.raiseChet;
    h.raiseChet = null;
    expect(runRow(c).status).toBe("held");
    expect(chet.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.runEnd).map((a) => a.dedupKey)).toEqual([khoaRunEnd(c, "x")]);
  });
  it("G5 walk, then Continue: DA_BAO of the first walk's durable URGENT ends the second one with no new run_end; the STOP went once", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("t7g5", [gate(), box("b", [ot("x", { compensation: ot("cx") })], { compensation: otStop("cs") })]), 1);
    await wait(30);
    expect(runRow(c).status, "cx is held for a person").toBe("held");
    expect(daBao(c), "the walk's URGENT was durable: the latch is told").toMatchObject({ stepId: "x" });
    h.alertDurable = false;
    h.duocSauKhoa.add("cx");
    await tiepTuc(c, "checked on site");
    await wait(30);
    expect(KET_THUC).toContain(runRow(c).status);
    expect(runEnd()).toEqual([]);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });

  // ── H1, C1: the debt on the rows holds the run, whatever ended it ──────────────────────────────────────────────────
  /** `guiDuoc` false: a run that only ever sent STOPs: its Abort's sweep reads "not needed" (runHasActuated), T7b's A-STOPONLY (no-cho-T7b.md). What T7 owes: held, the Abort accepted */
  const r3a = async (c: number, guiDuoc = true) => {
    expect(runRow(c).status, "state C: never failed").toBe("held");
    expect(String(runRow(c).error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
    expect([...stopChuaRaTuHang(stepRows(c) as never)]).toEqual(["st"]);
    h.tuChoi.clear();
    h.sent.length = 0;
    const a = await abortRun(c, OWNER, "press");
    await wait(40);
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    if (guiDuoc) expect(ids(), "the Abort sends it").toContain("st");
  };
  it("R3-A the last 'held' write throws once (resume walk): held, not failed; the Abort sends the STOP", async () => {
    vaoC();
    h.statusThrow = "held";
    const c = await centralRun(dV("t7r3a"), 1);
    await waitFor(() => h.statusThrow === null && runRow(c).status !== "running", "the end of the walk");
    await wait(30);
    expect(h.statusThrowLan, "the injection reached the write").toBe(1);
    await r3a(c);
  });
  it("R3-A sync the same on startRun's own walk (a STOP-only run, latched by a STOP with no answer): held, not failed; the Abort is accepted", async () => {
    vaoC();
    h.statusThrow = "held";
    const d = dV("t7r3as", false);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    await wait(30);
    expect(h.statusThrowLan).toBe(1);
    expect(s.status).toBe("held");
    await r3a(s.runId!, false);
  });
  it("R3-A async the same on startRun's background walk (a STOP-only run): held, not failed; the Abort is accepted", async () => {
    vaoC();
    h.statusThrow = "held";
    const d = dV("t7r3aa", false);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER, { async: true });
    const c = s.runId!;
    await waitFor(() => h.statusThrowLan === 1 && !["queued", "running", "compensating"].includes(runRow(c).status), "the end of the background walk");
    await wait(30);
    await r3a(c, false);
  });

  // ── decision B: an Abort, a person's gate rejection, end the run whatever the URGENT did: audit, one bounded try ────
  it("G4 Abort from the held run of G1: aborted, the sweep runs", async () => {
    const c = await g1("t7g4");
    expect(runRow(c).status).toBe("held");
    const a = await abortRun(c, OWNER, "checked");
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(a.abortStops).toBeDefined();
  });
  it("G4b Abort, the URGENT still fails: aborted; the audit says urgentDurable false, names the latch, the sweep, the reason; the obligation stands", async () => {
    const c = await g1("t7g4b");
    const truoc = runEnd().length;
    const a = await abortRun(c, OWNER, "checked");
    expect(a.ok).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(runEnd().length - truoc, "one bounded try").toBe(1);
    const au = auditAbort("heldNoDurableUrgent");
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ runId: c, latchStepId: "x", ma: "FOE_OUTCOME_UNKNOWN", urgentDurable: false, recipients: 1, reason: "checked" });
    expect(au[0]!.stopSweep).toMatchObject({ sent: expect.any(Number), failed: expect.any(Number), unverified: expect.any(Number), untakenBranch: expect.any(Array) });
    expect(au[0]!.khongRoStepIds).toEqual(["x"]);
    expect(daBao(c)).toBeUndefined();
  });
  it("G4c Abort, the URGENT lands at its try: aborted; the audit says urgentDurable true; exactly one URGENT more; DA_BAO", async () => {
    const c = await g1("t7g4c");
    const truoc = runEnd().length;
    h.alertDurable = true;
    const a = await abortRun(c, OWNER);
    expect(a.ok).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(runEnd().length - truoc).toBe(1);
    expect(auditAbort("heldNoDurableUrgent")).toMatchObject([{ urgentDurable: true, reason: null }]);
    expect(daBao(c)).toMatchObject({ stepId: "x" });
  });
  it("G4d the audit fails and the URGENT fails: aborted all the same, the sweep not held back", async () => {
    const c = await g1("t7g4d");
    vi.mocked(logCrudOperation).mockImplementation(async () => {
      throw new Error("audit down (test)");
    });
    const a = await abortRun(c, OWNER, "checked");
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(a.abortStops).toBeDefined();
    expect(vi.mocked(logCrudOperation).mock.calls.some((x) => (x[1] as { details?: { operation?: string } }).details?.operation === "foe_outcome_unknown_abort"), "the audit was tried").toBe(true);
  });
  it("G4e recipients=0, then Abort: aborted; the audit says recipients 0", async () => {
    const c = await g1("t7g4e");
    expect(runRow(c).status).toBe("held");
    khongNguoi(c);
    const a = await abortRun(c, OWNER);
    expect(a.ok).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(auditAbort("heldNoDurableUrgent")).toMatchObject([{ recipients: 0, urgentDurable: false }]);
  });
  it("A1 (G4f) Abort while the walker is alive, the URGENT fails: aborted, the STOP goes, the obligation stands, the audit is written", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("y", 250);
    h.alertDurable = false;
    const d = def("t7a1", [gate(), parF("p", [ot("x"), move("y"), box("b", [delay("w", 30), otStop("st")])])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const c = s.runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => (runRow(c).contextJson as Record<string, unknown> | null)?.[KET_CUC_KHONG_RO_CHOT_CTX_KEY] != null, "the latch");
    const a = await abortRun(c, OWNER, "walker alive");
    await di;
    await wait(40);
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(ids()).toContain("st");
    expect(auditAbort("heldNoDurableUrgent")).toMatchObject([{ urgentDurable: false, latchStepId: "x", reason: "walker alive" }]);
    expect(daBao(c)).toBeUndefined();
  });
  it("G4h a person rejects the gate of a latched run, the URGENT fails: aborted, an audit, the obligation stands", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 20);
    h.alertDurable = false;
    const c = await centralRun(def("t7g4h", [gate(), parF("p", [ot("x"), gate("g2")])]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("awaiting_confirm");
    expect((runRow(c).contextJson as Record<string, unknown>)[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toBeTruthy();
    const r = await resumeRun(c, { approved: false, note: "no", expectedStepId: "g2" }, OTHER);
    await wait(30);
    expect(r.status).toBe("aborted");
    expect(runRow(c).status).toBe("aborted");
    expect(auditAbort("gateRejectedNoDurableUrgent")).toMatchObject([{ urgentDurable: false, latchStepId: "x", reason: "no" }]);
    expect(daBao(c)).toBeUndefined();
  });
});

// ═══ A2(n) T7 lượt sửa 1 ═══════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) T7 fix 1 — the walk's memory at an exception (K1), the gate's two guards, the Abort's order, the marks' memory", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const REF = { status: "rejected", error: "INTERLOCK_NOT_MET: refused" };
  const KET_THUC = ["completed", "failed", "aborted"];
  const ids = () => h.sent.map((x) => String(x.stepId));
  const dV = (ref: string, gateDau = true) => def(ref, [...(gateDau ? [gate()] : []), parF("p", [gateDau ? move("x") : robotStop("x"), box("b", [delay("w", 40), otStop("st")])])]);
  const vaoC = () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
  };
  /** st's row in state C cannot be written: the debt lives in the walk's memory only */
  const matHangSt = () => (h.hangNem = (r) => r.stepId === "st" && String(r.error ?? "").startsWith("FOE_STOP_NOT_SENT"));
  const chuCB = () => h.alerts.map((a) => `${a.kind}|${a.title} ${a.message}`);
  const HUA_ABORT = /Abort sends it|Press Abort|Abort sends the|Abort sends its/;
  /** the words promise an Abort only on a run an Abort can still act on: never on a run already ended */
  const kiemChu = (c: number) => {
    const st = String(runRow(c).status);
    if (KET_THUC.includes(st)) expect(chuCB().filter((x) => HUA_ABORT.test(x)), `run ${st}: an URGENT promises an Abort`).toEqual([]);
  };
  const markRow = (stepId: string, claimSeq: number) => ({ stepId, status: "completed", error: null, resultJson: { stopKhongXacNhan: "docLoi", edge: { claimSeq } } });
  const khoaDau = (runId: number, stepId: string, claimSeq: number) => `${CANH_BAO_KHONG_RO_KIND.stopKhongXacNhanDoc}:${runId}:${stepId}:${KHONG_CO_BU_TRU}:claim${claimSeq}`;
  const cbDau = (runId: number) => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.stopKhongXacNhanDoc && String(a.dedupKey).includes(`:${runId}:`)).map((a) => String(a.dedupKey));

  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  const BANG: string[] = [];
  beforeEach(() => {
    vi.mocked(logCrudOperation).mockClear();
    vi.mocked(logCrudOperation).mockImplementation(async () => ({ id: 1 }) as never);
  });
  afterEach(() => {
    vi.mocked(logCrudOperation).mockImplementation(async () => ({ id: 1 }) as never);
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    BANG.push(`${String(expect.getState().currentTestName).split(" > ").pop()?.slice(0, 70)} | ${sau.map((x) => `${String(x.stepId)}:${String(x.name)}`).join(" ") || "-"}`);
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return x.name === "abort";
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    const la = sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)) && !h.duocSauKhoa.has(String(x.stepId)));
    expect(la.map((x) => x.stepId), "a command that is no pinned STOP reached the dispatcher after the latch").toEqual([]);
  });
  afterAll(() => {
    for (const l of BANG) console.log(`[PROBE sau-khoa T7s1] ${l}`);
  });

  // ── K1: the debt in the walk's memory only, the last 'held' write throws ────────────────────────────────────────────
  /** K1's input: st in state C, its row in state C never written, the last 'held' write throws (the resume walk) */
  const k1 = async (ref: string) => {
    vaoC();
    matHangSt();
    h.statusThrow = "held";
    const c = await centralRun(dV(ref), 1);
    await waitFor(() => h.statusThrow === null && runRow(c).status !== "running", "the end of the walk");
    await wait(40);
    expect(h.hangNemLan, "st's row in state C was never written").toBeGreaterThan(0);
    expect(h.statusThrowLan).toBe(1);
    // dieu-phoi 08/11, một nguồn laHangChuaRa. T7b-1 (no-cho-T7b: one source of "not out") — was: "the rows hold no debt". The refused attempt left on st's row is now read as not out; what K1 needs is
    // that the row of state C (its code) is the write lost
    expect(stepRows(c).filter((r) => String(r.error ?? "").startsWith("FOE_STOP_NOT_SENT")).map((r) => r.stepId), "no row carries the code of state C: that write was lost").toEqual([]);
    return c;
  };
  it("T7-K1 hàng mất, ghi held ném (resume walk), the gate: held, the run's words and the stop_not_sent URGENT name st; no URGENT promises an Abort on an ended run", async () => {
    const c = await k1("t7k1");
    expect(runRow(c).status, "the walk's memory holds the debt: never failed").toBe("held");
    expect(String(runRow(c).error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out: it was refused before it reached a driver \(INTERLOCK_NOT_MET\)/);
    const notSent = h.alerts.filter((x) => x.kind === CANH_BAO_KHONG_RO_KIND.stopNotSent);
    expect(notSent.map((x) => String(x.dedupKey).split(":")[2]), "the stop_not_sent URGENT names st").toEqual(["st"]);
    expect(`${notSent[0]!.title} ${notSent[0]!.message}`).toContain('STOP "st" did NOT go out');
    kiemChu(c);
    // held: the promise of an Abort is allowed; an ended run carries none (kiemChu, and once more after the Abort below has ended it is not asserted: T7-K1-ABORT-T7b)
    expect(KET_THUC).not.toContain(runRow(c).status);
  });
  it("T7-K1-ABORT-T7b the same run, Abort: it must send st (the stored sweep reads the refused attempt's routedTo as settled; T7b)", async () => {
    const c = await k1("t7k1ab");
    expect(runRow(c).status).toBe("held");
    h.hangNem = null;
    h.tuChoi.clear();
    h.sent.length = 0;
    const a = await abortRun(c, OWNER, "press");
    await wait(40);
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(a.abortStops?.sent ?? [], "the Abort's report names st sent").toContain("st");
    expect(h.sent.map((x) => `${String(x.stepId)}:${String(x.name)}`), "a st:stop command went").toContain("st:stop");
  });
  it("T7-K1 sync the same on startRun's own walk (a STOP-only run): held, the run's words name st, the Abort is accepted", async () => {
    vaoC();
    matHangSt();
    h.statusThrow = "held";
    const d = dV("t7k1s", false);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    await wait(40);
    const c = s.runId!;
    expect(h.statusThrowLan).toBe(1);
    expect(h.hangNemLan).toBeGreaterThan(0);
    expect(s.status).toBe("held");
    expect(runRow(c).status).toBe("held");
    expect(String(runRow(c).error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
    kiemChu(c);
    h.hangNem = null;
    h.tuChoi.clear();
    const a = await abortRun(c, OWNER, "press");
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
  });
  it("T7-K1 async the same on startRun's background walk: held, the run's words name st, the Abort is accepted", async () => {
    vaoC();
    matHangSt();
    h.statusThrow = "held";
    const d = dV("t7k1a", false);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER, { async: true });
    const c = s.runId!;
    await waitFor(() => h.statusThrowLan === 1 && !["queued", "running", "compensating"].includes(runRow(c).status), "the end of the background walk");
    await wait(40);
    expect(runRow(c).status).toBe("held");
    expect(String(runRow(c).error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
    kiemChu(c);
    h.hangNem = null;
    h.tuChoi.clear();
    const a = await abortRun(c, OWNER, "press");
    expect(a.ok, String(a.message)).toBe(true);
  });
  // T7b-1 (dieu-phoi 08/11, ra2 2.1) — the same two shapes, the Abort must SEND st: a STOP-only run (A-STOPONLY) whose refused attempt left routedTo on st's row
  for (const dang of ["SYNC", "ASYNC"] as const) {
    it(`T7-K1-ABORT-T7b-${dang} startRun's ${dang === "SYNC" ? "own" : "background"} walk of a STOP-only run, held on st, Abort: it sends st (one source of "not out", R-6-b not on a latched run)`, async () => {
      vaoC();
      matHangSt();
      h.statusThrow = "held";
      const d = dV(`t7k1ab${dang[0]!.toLowerCase()}`, false);
      expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
      const s = await startRun(d.ref, {}, OWNER, dang === "ASYNC" ? { async: true } : {});
      const c = s.runId!;
      await waitFor(() => h.statusThrowLan === 1 && !["queued", "running", "compensating"].includes(runRow(c).status), "the end of the walk");
      await wait(40);
      expect(runRow(c).status).toBe("held");
      expect(String(runRow(c).error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
      expect(h.alerts.filter((x) => x.kind === CANH_BAO_KHONG_RO_KIND.stopNotSent).map((x) => String(x.message)).join(" "), "the words the Abort must make true").toContain("Abort sends it again");
      h.hangNem = null;
      h.tuChoi.clear();
      h.sent.length = 0;
      const a = await abortRun(c, OWNER, "press");
      await wait(40);
      expect(a.ok, String(a.message)).toBe(true);
      expect(runRow(c).status).toBe("aborted");
      expect(a.abortStops?.notNeeded ?? [], "a latched run: R-6-b does not apply").toEqual([]);
      expect(a.abortStops?.sent ?? [], "the Abort's report names st sent").toContain("st");
      expect(h.sent.map((x) => `${String(x.stepId)}:${String(x.name)}`), "a st:stop command went").toContain("st:stop");
    });
  }
  it("T7-K1-DOI-CHUNG (RA7-B2, control) the row lost, no throw: the live walk's memory holds it", async () => {
    vaoC();
    matHangSt();
    const c = await centralRun(dV("t7k1d"), 1);
    await waitFor(() => runRow(c).status !== "running", "the end of the walk");
    await wait(40);
    expect(runRow(c).status).toBe("held");
    expect(String(runRow(c).error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
    kiemChu(c);
  });

  // ── the gate's two guards (MR1, MR2) ────────────────────────────────────────────────────────────────────────────────
  it("T7-DOC-HANG-NULL the gate cannot read the step rows at the end of a latched walk: held, the words say the records could not be read", async () => {
    h.timeoutDispatch.add("x");
    h.sauTimeout = () => (h.docNem = { bang: "orchestration_run_steps", lan: Infinity });
    const c = await centralRun(def("t7dhn", [gate(), ot("x")]), 1);
    await wait(30);
    h.docNem = null;
    expect(h.docNemLan, "the reads did fail").toBeGreaterThan(0);
    expect(runRow(c).status).toBe("held");
    expect(String(runRow(c).error)).toMatch(/its step records could not be read at its end/);
    kiemChu(c);
  });
  const ngoaiLeRunNull = async (ref: string) => {
    h.statusThrow = "completed";
    h.docNemSauThrow = { bang: "orchestration_runs", lan: 1 };
    const c = await centralRun(def(ref, [gate(), ot("m1")]), 1);
    await wait(30);
    expect(h.statusThrowLan).toBe(1);
    expect(h.docNemLan, "the run read at the exception failed once").toBe(1);
    return c;
  };
  it("T7-NGOAI-LE-RUN-NULL an unlatched run: the last 'completed' write throws, the run cannot be read at the exception: held, the words; getRun; Abort: aborted, 0 commands", async () => {
    const c = await ngoaiLeRunNull("t7nlr");
    expect(runRow(c).status).toBe("held");
    expect(String(runRow(c).error)).toMatch(/its step records could not be read at its end, so whether a STOP is still owed cannot be told\. The run is held: Continue walks it to its end again, Abort ends it/);
    expect((await getRun(c))?.run.status).toBe("held");
    h.sent.length = 0;
    const a = await abortRun(c, OWNER, "checked");
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(h.sent, "an Abort of a run that sent no STOP sends nothing").toEqual([]);
  });
  it("T7-NGOAI-LE-RUN-NULL Continue: the same run, a Continue walks it to its end: completed, nothing sent again", async () => {
    const c = await ngoaiLeRunNull("t7nlrc");
    expect(runRow(c).status).toBe("held");
    h.sent.length = 0;
    grantMachineControl();
    const view = (await getRun(c, { bindingDigest: true }))!;
    const r = await resumeRun(c, { approved: true, note: "checked", expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await wait(30);
    expect(r.status).toBe("completed");
    expect(runRow(c).status).toBe("completed");
    expect(h.sent, "m1 completed before: not sent again").toEqual([]);
  });

  // ── decision 3 waits for T9: x's own STOP confirmed ────────────────────────────────────────────────────────────────
  it("K2-ANH-EM-T9 x's own STOP compensation acked_verified, no durable URGENT: the run ends as the walk went (plan point 3 row 4), cs once", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.acked = true;
    h.ackStatus = "acked_verified";
    h.alertDurable = false;
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("t7k2ae", [gate(), move("x", { compensation: otStop("cs") })]), 1);
    await wait(40);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(runRow(c).status, "T9: XAC_NHAN into the gate").toBe("failed");
  });

  // ── (b) the Abort: the STOP before any wait ─────────────────────────────────────────────────────────────────────────
  for (const auditTreo of [false, true]) {
    it(`T7-ABORT-STOP-TRUOC the URGENT never answers, the audit ${auditTreo ? "hangs" : "answers"}: st goes before the URGENT's try and the audit, the Abort answers after them`, async () => {
      vaoC();
      h.alertDurable = false;
      const c = await centralRun(dV(`t7ast${auditTreo}`), 1);
      await waitFor(() => runRow(c).status !== "running", "the end of the walk");
      await wait(40);
      expect(runRow(c).status).toBe("held");
      h.tuChoi.clear();
      h.sent.length = 0;
      const su: string[] = [];
      const auditAbort = () => vi.mocked(logCrudOperation).mock.calls.filter((x) => (x[1] as { details?: { operation?: string } }).details?.operation === "foe_outcome_unknown_abort").length;
      const push = h.sent.push.bind(h.sent);
      (h.sent as any).push = (...a: any[]) => {
        if (a[0]?.stepId === "st") su.push(`st:treo${h.treoLan}:audit${auditAbort()}`);
        return push(...a);
      };
      h.alertTreo = true;
      vi.mocked(logCrudOperation).mockClear();
      if (auditTreo) vi.mocked(logCrudOperation).mockImplementation(() => new Promise(() => undefined) as never);
      try {
        const a = await abortRun(c, OWNER, "press");
        su.push(`answer:treo${h.treoLan > 0 ? "+" : "0"}:audit${auditAbort()}`);
        expect(a.ok, String(a.message)).toBe(true);
        expect(a.abortStops?.sent).toEqual(["st"]);
      } finally {
        (h.sent as any).push = push;
        h.alertTreo = false;
      }
      expect(su, "st before the URGENT's try and the audit; the same order whether the audit hangs or not").toEqual(["st:treo0:audit0", "answer:treo+:audit1"]);
    });
  }

  // ── (c) the marks' memory ───────────────────────────────────────────────────────────────────────────────────────────
  it("T7-TRAN-5000 past 5 000 entries the first is dropped: the gate raises it again under the report path's own key", async () => {
    await baoKhongXacNhan({ runId: 9_800, stepId: "s0", dang: "docLoi", claimSeq: 3, owner: OWNER.id });
    const truoc = cbDau(9_800);
    expect(truoc).toEqual([khoaDau(9_800, "s0", 3)]);
    await Promise.all(Array.from({ length: 5_000 }, (_, i) => baoKhongXacNhan({ runId: 9_801, stepId: `s${i + 1}`, dang: "docLoi", claimSeq: 3, owner: OWNER.id })));
    const q = await quyetDinhKetThucAnh({ runId: 9_800, ctx: {}, owner: OWNER.id, rows: [markRow("s0", 3)] }, "edgeSegment", 200);
    expect(q.ghi).toBe("terminal");
    expect(cbDau(9_800), "raised again, the same key").toEqual([truoc[0], truoc[0]]);
    quenBenKhongXacNhan(9_801);
    quenBenKhongXacNhan(9_800);
  });
  it("T7-KHOI-DONG-LAI an empty memory (a restart): the gate raises the mark again under the report path's own key", async () => {
    await baoKhongXacNhan({ runId: 9_810, stepId: "s0", dang: "docLoi", claimSeq: 5, owner: OWNER.id });
    const truoc = cbDau(9_810);
    expect(truoc).toEqual([khoaDau(9_810, "s0", 5)]);
    const q0 = await quyetDinhKetThucAnh({ runId: 9_810, ctx: {}, owner: OWNER.id, rows: [markRow("s0", 5)] }, "edgeSegment", 200);
    expect(q0.ghi).toBe("terminal");
    expect(cbDau(9_810), "remembered: not raised again").toEqual(truoc);
    quenBenKhongXacNhan(9_810);
    const q = await quyetDinhKetThucAnh({ runId: 9_810, ctx: {}, owner: OWNER.id, rows: [markRow("s0", 5)] }, "edgeSegment", 200);
    expect(q.ghi).toBe("terminal");
    expect(cbDau(9_810)).toEqual([truoc[0], truoc[0]]);
    quenBenKhongXacNhan(9_810);
  });
  /** a run whose mark's answer is remembered, then it ends by one path: is the memory of it dropped */
  const nhoDau = async (runId: number) => {
    await baoKhongXacNhan({ runId, stepId: "zz", dang: "docLoi", claimSeq: 1, owner: OWNER.id });
    expect(cbDau(runId)).toHaveLength(1);
  };
  const quenChua = async (runId: number) => {
    await quyetDinhKetThucAnh({ runId, ctx: {}, owner: OWNER.id, rows: [markRow("zz", 1)] }, "edgeSegment", 200);
    return cbDau(runId).length === 2;
  };
  it("T7-QUEN-WALK a central walk that ends through the gate forgets its marks' answers", async () => {
    h.timeoutDispatch.add("x");
    const d = def("t7qw", [gate(), ot("x")]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const c = (await startRun(d.ref, {}, OWNER)).runId!;
    await nhoDau(c);
    const view = (await getRun(c, { bindingDigest: true }))!;
    await resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await wait(20);
    expect(runRow(c).status).toBe("failed");
    expect(await quenChua(c)).toBe(true);
    quenBenKhongXacNhan(c);
  });
  it("T7-QUEN-NGOAI-LE an exception that ends the run through the gate forgets its marks' answers", async () => {
    h.timeoutDispatch.add("x");
    h.statusThrow = "failed";
    const d = def("t7qn", [gate(), ot("x")]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const c = (await startRun(d.ref, {}, OWNER)).runId!;
    await nhoDau(c);
    const view = (await getRun(c, { bindingDigest: true }))!;
    await resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await wait(20);
    expect(h.statusThrowLan).toBe(1);
    expect(runRow(c).status).toBe("failed");
    expect(await quenChua(c)).toBe(true);
    quenBenKhongXacNhan(c);
  });
  it("T7-QUEN-ABORT an Abort forgets the run's marks' answers", async () => {
    h.timeoutDispatch.add("x");
    h.alertDurable = false;
    const c = await centralRun(def("t7qa", [gate(), ot("x")]), 1);
    await wait(20);
    expect(runRow(c).status).toBe("held");
    h.alertDurable = true;
    await nhoDau(c);
    const a = await abortRun(c, OWNER, "checked");
    expect(a.ok).toBe(true);
    expect(await quenChua(c)).toBe(true);
    quenBenKhongXacNhan(c);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) T7c-b — the old edge walker of a latched run is told to stop; what goes after the flag, by the PIN; the node protocol", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const ids = () => h.sent.map((x) => String(x.stepId));
  const REF = { status: "rejected", error: "INTERLOCK_NOT_MET: refused" };
  /** the central run and its own rows, as JSON: what a sync must leave byte for byte */
  const anhRun = (c: number) => JSON.stringify({ run: runRow(c), steps: stepRows(c) });

  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  const BANG: string[] = [];
  beforeEach(() => {
    process.env.EDGE_RUNTIME_ENABLED = "true";
    process.env.EDGE_ABORT_POLL_MS = "50";
    _clearBuffer();
  });
  afterEach(() => {
    delete process.env.EDGE_RUNTIME_ENABLED;
    delete process.env.EDGE_ABORT_POLL_MS;
    _clearBuffer();
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    BANG.push(`${String(expect.getState().currentTestName).split(" > ").pop()?.slice(0, 70)} | ${sau.map((x) => `${String(x.stepId)}:${String(x.name)}`).join(" ") || "-"}`);
    // by the PIN: an OT stop counts only when every write it carries is a pin of its adapter; a robot's `abort` is the robot rule
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return x.name === "abort";
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    const la = sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)));
    expect(la.map((x) => x.stepId), "a command that is no pinned STOP reached the dispatcher after the latch / the flag").toEqual([]);
  });
  afterAll(() => {
    for (const l of BANG) console.log(`[PROBE sau-khoa T7c-b] ${l}`);
  });

  it("★ T7CB-CENTRAL-HELD a central run 'held' in state C (latched, st refused, not stopped) gets the sync flag: still 'held', its rows and latch byte for byte; an Abort after it sends st", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
    const c = await centralRun(def("t7cbh", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("st")])])]), 1);
    await wait(80);
    expect(runRow(c).status, "state C: held").toBe("held");
    expect([...stopChuaRaTuHang(stepRows(c) as never)]).toEqual(["st"]);
    const truoc = anhRun(c);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const status of ["running", "completed"]) {
        const res = await syncRunResult({ edgeNodeCode: "edge-x", runId: c, status, currentStepId: "end", contextJson: { k: 1 }, steps: [{ stepId: "st", stepType: "command", status: "completed", attempt: 2 }, { stepId: "x", stepType: "command", status: "completed", attempt: 2 }] } as never);
        expect(res).toEqual({ ok: true, enabled: true, data: { runId: c, stepsApplied: 0, abortRequested: true, stale: true } });
      }
      expect(warn.mock.calls.some((x) => new RegExp(`^\\[EdgeCoordinator\\] EDGE_SYNC_RUN_LATCHED: sync of run ${c} `).test(String(x[0])))).toBe(true);
    } finally {
      warn.mockRestore();
    }
    expect(anhRun(c), "the flag wrote nothing").toBe(truoc);
    expect(runRow(c).status).toBe("held");
    h.tuChoi.clear();
    h.sent.length = 0;
    const a = await abortRun(c, OWNER, "press");
    await wait(40);
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(h.sent.filter((x) => x.stepId === "st").map((x) => x.name), "the Abort sends st").toEqual(["stop"]);
  });

  it("★ T7CB-APPLY-ABORT-GHIM the old edge walker (executeAssignedRun, the real engine) of a central run latched and not stopped: the first sync's flag aborts the local run; after it only pinned STOPs, no non-STOP, no non-STOP compensation", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    fake.seed(users, [{ id: OWNER.id, role: OWNER.role, isActive: true, name: OWNER.name }]);
    // the local walk: STOPs that went (one with a non-STOP compensation, one with a STOP compensation), then a long delay, a non-STOP, a STOP
    const d = def("t7cbg", [
      { ...robotStop("s0"), compensation: move("c0") } as never,
      otStop("s0b", { compensation: robotStop("c0b") }),
      delay("w", 400),
      move("m1"),
      otStop("s9"),
    ]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const wf = rows("orchestration_workflows").find((w) => w.ref === "t7cbg")!;
    // the central run: held, latched (the latch, st owed), not stopped (no claim, not aborted), no assignment
    const C = 900;
    fake.seed(orchestrationRuns, [
      ...rows("orchestration_runs"),
      { id: C, workflowId: wf.id, workflowRef: "t7cbg", status: "held", paramsJson: {}, edgeNodeId: null, startedBy: OWNER.id, createdAt: T0, contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: "2026-11-08T00:00:00.000Z" } } },
    ]);
    fake.seed(orchestrationRunSteps, [...rows("orchestration_run_steps"), { id: 9001, runId: C, stepId: "st", stepType: "command", status: "failed", attempt: 1, resultJson: null, error: "FOE_STOP_NOT_SENT: STOP \"st\" (test)" }]);
    const truoc = anhRun(C);
    let dauSync = -1;
    setCentralSync(async (p) => {
      const r = await syncRunResult(p as never);
      if (dauSync < 0) {
        dauSync = h.sent.length;
        h.traTimeout = 1; // every command from here on is marked: the table below is the table after the first sync
      }
      return { ack: r.ok === true, abortRequested: (r.data as { abortRequested?: boolean } | undefined)?.abortRequested === true };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let res: Awaited<ReturnType<typeof executeAssignedRun>>;
    try {
      res = await executeAssignedRun({ id: C, workflowId: wf.id, workflowRef: "t7cbg", paramsJson: {}, startedBy: OWNER.id });
      await wait(60);
    } finally {
      warn.mockRestore();
    }
    expect(dauSync, "a sync reached central during the walk").toBeGreaterThanOrEqual(0);
    expect(h.sent.slice(0, dauSync).map((x) => x.stepId), "before the flag: the walk's own STOPs").toEqual(["s0", "s0b"]);
    const L = rows("orchestration_runs").find((r) => r.id !== C && r.workflowId === wf.id)!;
    expect(L.status, "the local run is aborted by the edge").toBe("aborted");
    expect(String(L.error)).toMatch(new RegExp(`^Aborted by user ${EDGE_CENTRAL_ABORT_USER.id}: `));
    const sau = h.sent.slice(dauSync).map((x) => `${String(x.stepId)}:${String(x.name)}`);
    expect(sau.filter((x) => x.startsWith("m1:") || x.startsWith("c0:")), "no non-STOP and no non-STOP compensation after the flag").toEqual([]);
    expect(res!.ok).toBe(true);
    expect(bufferedCount()).toBe(0);
    expect(anhRun(C), "central's latched run: byte for byte").toBe(truoc);
  });

  it("★ T7CB-NODE-PROTOCOL a run under the node protocol (a run_edge_assignments row) latches on the edge: its walker sends no non-STOP after the latch (the later r2, the compensation c1); a legacy sync of it stays the node-protocol refusal, nothing written", async () => {
    const later = box("later", [delay("w", 60), move("r2")]);
    const d = def("t7cbn", [gate(), parF("p", [later, move("r1", { compensation: ot("c1") })]), robotStop("bs")]);
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    h.timeoutDispatch.add("r1");
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.traTimeout, "the latch fell").toBeGreaterThan(0);
    expect(ids().slice(n0).filter((x) => x === "r2" || x === "c1"), "no non-STOP after the latch").toEqual([]);
    expect(rows("orchestration_run_edge_assignments").some((a) => a.runId === e.runId)).toBe(true);
    const truoc = anhRun(e.runId);
    const r = await syncRunResult({ edgeNodeCode: "EDGE-A", runId: e.runId, status: "completed", contextJson: { k: 1 }, steps: [{ stepId: "r2", stepType: "command", status: "completed", attempt: 1 }] } as never);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/executed by an edge node under the node protocol/);
    expect(anhRun(e.runId)).toBe(truoc);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) T12 (P4, red until T12) — a payload that itself carries the latch, on a run NOT latched", () => {
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const KET_THUC = ["completed", "failed", "aborted"];
  const anhRun = (c: number) => JSON.stringify({ run: runRow(c), steps: stepRows(c) });
  beforeEach(() => {
    process.env.EDGE_RUNTIME_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.EDGE_RUNTIME_ENABLED;
  });

  it("T12-P4-PAYLOAD-MANG-KHOA a 'completed' payload with x FOE_OUTCOME_UNKNOWN and st FOE_STOP_NOT_SENT, on a run not latched: P, exactly one of Q1 / Q2, R", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const d = def("t12p4", [gate(), ot("x"), otStop("st")]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const wf = rows("orchestration_workflows").find((w) => w.ref === "t12p4")!;
    const C = 950;
    fake.seed(orchestrationRuns, [...rows("orchestration_runs"), { id: C, workflowId: wf.id, workflowRef: "t12p4", status: "running", paramsJson: {}, edgeNodeId: null, startedBy: OWNER.id, createdAt: T0, contextJson: {} }]);
    const truoc = anhRun(C);
    const bao0 = h.alerts.length;
    const res = await syncRunResult({
      edgeNodeCode: "edge-x",
      runId: C,
      status: "completed",
      contextJson: { k: 1 },
      steps: [
        { stepId: "x", stepType: "command", status: "failed", attempt: 1, error: "FOE_OUTCOME_UNKNOWN: command x may have reached the device" },
        { stepId: "st", stepType: "command", status: "failed", attempt: 1, error: loiGiuChuaRa("st", { nguon: "tuChoi", ma: "CHUA_GHIM_STOP" }) },
      ],
    } as never);
    // dieu-phoi 08/11: tính chất P ∧ (Q1 ∨ Q2) ∧ R; URGENT một mình không đủ (dạng K1)
    // P — the run is not ended outside quyetDinhKetThucAnh (a sync never calls it: any end here is outside it)
    expect(KET_THUC, "P: the sync ended the run outside the end gate").not.toContain(runRow(C).status);
    // Q1 — the sync refused: no step row, no context, no status written (byte for byte)
    const q1 = anhRun(C) === truoc && !(res.ok === true && Number((res.data as { stepsApplied?: number } | undefined)?.stepsApplied ?? 0) > 0);
    // Q2 — st is still in the debt the Abort reads (the rows' state C; no context key carries a STOP debt), AND an Abort after it really sends st
    const noSt = stopChuaRaTuHang(stepRows(C) as never).has("st");
    const baoSau = h.alerts.slice(bao0).map((a) => JSON.stringify({ ...a, baoBen: undefined }));
    h.sent.length = 0;
    const a = await abortRun(C, OWNER, "press");
    await wait(40);
    const abortGuiSt = h.sent.some((x) => x.stepId === "st" && x.name === "stop");
    const q2 = noSt && abortGuiSt;
    expect([q1, q2].filter(Boolean).length, `exactly one of Q1 (refused, nothing written: ${q1}) / Q2 (st owed: ${noSt}, the Abort sent st: ${abortGuiSt}); abort: ${String(a.message ?? a.status)}`).toBe(1);
    // R — an URGENT (durable here: the mock stores it) naming st promises the Abort only when the Abort sends st
    const hua = baoSau.filter((t) => /\bst\b/.test(t) && /abort/i.test(t));
    if (hua.length > 0) expect(abortGuiSt, `R: an URGENT names st and promises the Abort, the Abort did not send st: ${hua[0]}`).toBe(true);
  });
});

// ═══ A2(n) T7b-1 ═══════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * A2(n) T7b-1 (plan 5a, decisions A2, B2, H1, C4, G) — the Abort of a LATCHED run, central: through the planner of the end of a walk (lapKeHoachStop, nguoi), never R-6-b; one source of
 * "not out" (laHangChuaRa: a refused attempt that is a row's last word); the debt read from the rows ∪ the context; an Abort's STOP that did not go is owed on its `abort:` row, a person is
 * told by name and presses again, with no window. The pin table: after the latch nothing but a pinned STOP reaches a device.
 */
describe("A2(n) T7b-1 — the Abort of a latched run, central: the shared planner, one source of 'not out', the debt from the rows and the context", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  /** stop-typed on a tag with no pin: not a STOP (R-5-j) */
  const stopTyped = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "run", value: 0 } }) as never;
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const REF = { status: "rejected", error: "INTERLOCK_NOT_MET: refused" };
  const ids = () => h.sent.map((x) => String(x.stepId));
  const hang = (c: number, id: string) => stepRows(c).find((r) => r.stepId === id);
  const no = (c: number, ctx = true) => [...stopChuaRaTuHang(stepRows(c) as never, ctx ? ((runRow(c).contextJson as Record<string, unknown> | null) ?? {}) : null)].sort();
  const urgentCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[kind]);
  const chuCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => urgentCua(kind).map((a) => `${a.title} ${a.message}`).join(" | ");
  const daGuiChu = /\b(was|were|been) sent\b|\bwent out\b/i;
  /** past the re-send window of an aborted run (ABORT_RESEND_WINDOW_MS, 15 min) */
  const quaCuaSo = (c: number) => (runRow(c).finishedAt = new Date(Date.now() - 2 * 3_600_000));
  const bam = async (c: number, note = "press") => {
    h.sent.length = 0;
    const a = await abortRun(c, OWNER, note);
    await wait(40);
    return a;
  };
  /** a latched run: x (a move) gets no answer; st, behind a delay, is refused before a driver: state C, the run held */
  const vaoC = () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
  };
  const dC = (ref: string, them: WorkflowStep[] = []) => def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("st")]), ...them])]);
  const xong = async (c: number) => {
    await waitFor(() => h.statusThrow === null && !["queued", "running", "compensating"].includes(runRow(c).status), "the end of the walk");
    await wait(40);
  };

  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  const BANG: string[] = [];
  beforeEach(() => {
    vi.mocked(logCrudOperation).mockClear();
    vi.mocked(logCrudOperation).mockImplementation(async () => ({ id: 1 }) as never);
  });
  afterEach(() => {
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    BANG.push(`${String(expect.getState().currentTestName).split(" > ").pop()?.slice(0, 70)} | ${sau.map((x) => `${String(x.stepId)}:${String(x.name)}${x.khongGhi ? ":0PDU" : ""}`).join(" ") || "-"}`);
    // by the PIN: an OT stop counts only when every write it carries is a pin of its adapter; a command the dispatcher itself refused wrote nothing (khongGhi)
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return x.name === "abort";
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    const la = sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)) && x.khongGhi !== true && !h.duocSauKhoa.has(String(x.stepId)));
    expect(la.map((x) => x.stepId), "a command that is no pinned STOP reached a device after the latch").toEqual([]);
  });
  afterAll(() => {
    for (const l of BANG) console.log(`[PROBE sau-khoa T7b1] ${l}`);
  });

  // ── A-STOPONLY (ra-vong-hai:177, spike-3 dòng 2): R-6-b is for a run NOT latched ────────────────────────────────────
  it("A-STOPONLY a STOP-only latched run (robot STOP x got no answer, st went), held with no durable URGENT: Abort sends its STOPs again, nothing 'not needed'", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.alertDurable = false;
    const c = await centralRun(def("t7b1so", [parF("p", [robotStop("x"), box("b", [delay("w", 40), otStop("st")])])]), 0);
    await xong(c);
    expect(runRow(c).status, "latched, no durable URGENT: held").toBe("held");
    h.timeoutDispatch.clear();
    h.alertDurable = true;
    const a = await bam(c);
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(a.abortStops?.notNeeded ?? [], "latched: R-6-b does not apply").toEqual([]);
    expect(a.abortStops?.sent ?? []).toContain("st");
    expect(ids()).toContain("st");
  });
  it("A-STOPONLY đối chứng a STOP-only run NOT latched, Abort while it walks: R-6-b stands, the STOP left is 'not needed', nothing sent", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const d = def("t7b1sod", [otStop("s1"), delay("w", 300), otStop("s2")]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER, { async: true });
    const c = s.runId!;
    await waitFor(() => ids().includes("s1"), "s1 sent");
    await wait(20);
    const a = await bam(c, "walking");
    expect(a.ok, String(a.message)).toBe(true);
    expect(a.abortStops?.notNeeded).toEqual(["s2"]);
    expect(ids()).toEqual([]);
  });

  // ── A-REF (5a, H1): an Abort refused by its dispatcher on a latched run ─────────────────────────────────────────────
  it("A-REF the dispatcher refuses the Abort's STOP of a latched run: aborted, abort:st owed with the code, an URGENT abort_stop_not_sent names st and never says it went; pressed again it goes, the debt is gone", async () => {
    vaoC();
    const c = await centralRun(dC("t7b1ar"), 1);
    await xong(c);
    expect(runRow(c).status).toBe("held");
    expect(chuCua("stopNotSent"), "the words an Abort must make true").toContain("Abort sends it again");
    h.alerts.length = 0;
    const a1 = await bam(c);
    expect(a1.ok, String(a1.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(ids(), "the Abort handed st over").toContain("st");
    expect(hang(c, "abort:st")?.status).toBe("failed");
    expect(String(hang(c, "abort:st")?.error), "the code of state C on the abort row").toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out \(on the Abort\): refused before a driver \[INTERLOCK_NOT_MET\]/);
    expect(no(c), "still owed").toContain("st");
    expect(urgentCua("abortStopNotSent").map((x) => String(x.dedupKey).split(":")[2]), "an URGENT names st").toEqual(["st"]);
    expect(chuCua("abortStopNotSent")).not.toMatch(daGuiChu);
    expect(chuCua("abortStopNotSent")).toContain("press Abort again, there is no time limit");
    const n1 = h.sent.length;
    await wait(150);
    expect(h.sent.length, "no automatic loop: only a person presses again").toBe(n1);
    h.tuChoi.clear();
    const a2 = await bam(c, "again");
    expect(a2.ok, String(a2.message)).toBe(true);
    expect(ids()).toEqual(["st"]);
    expect(hang(c, "abort:st")?.status).toBe("completed");
    expect(no(c), "the debt is gone").toEqual([]);
  });

  // ── A-OWED, G-OWED (B2, spike-3 dòng B2): past the window, exactly what is owed ─────────────────────────────────────
  it("A-OWED an aborted latched run, past the re-send window: Abort sends exactly the STOP still owed (st), not the one that went (s2)", async () => {
    vaoC();
    const c = await centralRun(dC("t7b1ao", [box("c2", [delay("w2", 40), otStop("s2")])]), 1);
    await xong(c);
    expect(runRow(c).status).toBe("held");
    const a1 = await bam(c);
    expect(a1.ok, String(a1.message)).toBe(true);
    expect(ids()).toContain("st");
    expect(hang(c, "abort:s2")?.status, "s2 went on the first Abort").toBe("completed");
    expect(no(c)).toEqual(["st"]);
    quaCuaSo(c);
    h.tuChoi.clear();
    const a2 = await bam(c, "past the window");
    expect(a2.ok, String(a2.message)).toBe(true);
    expect(ids(), "exactly the STOP owed").toEqual(["st"]);
    expect(no(c)).toEqual([]);
  });
  it("G-OWED the debt only on the abort row (st's own row completed), past the re-send window: Abort sends st", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.alertDurable = false;
    const c = await centralRun(def("t7b1go", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("st")])])]), 1);
    await xong(c);
    expect(runRow(c).status, "no durable URGENT: held").toBe("held");
    expect(hang(c, "st")?.status).toBe("completed");
    h.alertDurable = true;
    h.tuChoi.set("st", REF);
    await bam(c);
    expect(hang(c, "abort:st")?.status).toBe("failed");
    expect(no(c), "owed on the abort row alone").toEqual(["st"]);
    quaCuaSo(c);
    h.tuChoi.clear();
    const a2 = await bam(c, "past the window");
    expect(a2.ok, String(a2.message)).toBe(true);
    expect(ids()).toEqual(["st"]);
    expect(hang(c, "abort:st")?.status).toBe("completed");
  });

  // ── R3-E (C4): the debt is read when read, not when the sweep ran ───────────────────────────────────────────────────
  it("R3-E the Abort sweeps BEFORE the latch, its STOP refused, the run latches after: owed when read, pressed again past the window it goes", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 150);
    const d = def("t7b1r3e", [gate(), parF("p", [move("x"), box("b", [delay("w", 400), otStop("st")])])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const c = s.runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => ids().includes("x"), "x handed over");
    expect(runDaChot(c), "not latched yet").toBe(false);
    h.tuChoi.set("st", REF);
    const a1 = await abortRun(c, OWNER, "before the latch");
    expect(a1.ok, String(a1.message)).toBe(true);
    expect(a1.abortStops?.failed).toContain("st");
    await di;
    await waitFor(() => runDaChot(c), "the latch, after the Abort");
    await wait(40);
    expect(hang(c, "abort:st")?.status).toBe("failed");
    expect(no(c), "owed: read when read").toEqual(["st"]);
    expect(urgentCua("abortStopNotSent").map((x) => String(x.dedupKey).split(":")[2]), "the walk that ends latched tells it, by name").toEqual(["st"]);
    expect(chuCua("abortStopNotSent")).not.toMatch(daGuiChu);
    quaCuaSo(c);
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    const a2 = await bam(c, "past the window");
    expect(a2.ok, String(a2.message)).toBe(true);
    expect(ids()).toEqual(["st"]);
    expect(no(c)).toEqual([]);
  });
  const runDaChot = (c: number) => (runRow(c).contextJson as Record<string, unknown> | null)?.[KET_CUC_KHONG_RO_CHOT_CTX_KEY] != null || chotTuHang(stepRows(c) as never) !== null;

  // ── việc 2 (no-cho-T7b, DUYỆT): the debt is the rows ∪ the context ──────────────────────────────────────────────────
  for (const dang of ["NEM", "THUONG"] as const) {
    it(`T7B1-NGU-CANH-${dang} st's rows all lost (its row of state C too), the abort row of a refused Abort lost too: only the context holds the debt; past the window an Abort sends st${dang === "NEM" ? " (the last 'held' write threw: the end gate's held write)" : ""}`, async () => {
      vaoC();
      h.hangNem = (r) => r.stepId === "st" || r.stepId === "abort:st";
      if (dang === "NEM") h.statusThrow = "held";
      const c = await centralRun(dC(`t7b1nc${dang[0]!.toLowerCase()}`), 1);
      await xong(c);
      expect(runRow(c).status).toBe("held");
      expect(hang(c, "st"), "no row of st").toBeUndefined();
      if (dang === "NEM") expect(h.statusThrowLan).toBe(1);
      expect(no(c, false), "the rows alone hold no debt").toEqual([]);
      expect(no(c), "the context holds it").toEqual(["st"]);
      await bam(c);
      expect(ids(), "the Abort handed st over").toContain("st");
      expect(hang(c, "abort:st"), "its abort row lost too").toBeUndefined();
      expect(no(c)).toEqual(["st"]);
      quaCuaSo(c);
      h.hangNem = null;
      h.tuChoi.clear();
      const a2 = await bam(c, "past the window");
      expect(a2.ok, String(a2.message)).toBe(true);
      expect(ids()).toEqual(["st"]);
    });
  }

  // ── việc 5: a STOP refused BEFORE the latch, the Abort while the walker lives (finishWalk returns early) ──────────
  it("T7B1-TRUOC-KHOA-SONG st refused before the latch, then the latch, then an Abort while the walker lives: the Abort sends st", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 200);
    h.tuChoi.set("st", REF);
    const d = def("t7b1tk", [gate(), parF("p", [move("x"), otStop("st", { maxAttempts: 0 }), delay("w", 600)])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const c = s.runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => runDaChot(c), "the latch");
    expect(hang(c, "st")?.status, "st refused before the latch: a known failure").toBe("failed");
    h.tuChoi.clear();
    h.alerts.length = 0;
    const a = await bam(c, "walker alive");
    await di;
    await wait(40);
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(c).status).toBe("aborted");
    expect(ids(), "the Abort sends st").toContain("st");
    expect(no(c)).toEqual([]);
    expect(urgentCua("stopNotSent").map((x) => String(x.dedupKey).split(":")[2]), "st went: no word that it did not").toEqual([]);
  });

  // ── việc 6: a run NOT latched ────────────────────────────────────────────────────────────────────────────────────
  it("T7B1-CHUA-KHOA a run NOT latched, st refused and its last write ('failed') lost: the refused attempt is its row's last word: an Abort sends st", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.tuChoi.set("st", REF);
    h.hangNem = (r) => r.stepId === "st" && r.status === "failed";
    const c = await centralRun(def("t7b1ck", [gate(), parF("p", [move("m"), otStop("st", { maxAttempts: 0 }), gate("g2")])]), 1);
    await wait(40);
    expect(runRow(c).status, "not latched: waiting at g2").toBe("awaiting_confirm");
    expect(runDaChot(c)).toBe(false);
    expect(hang(c, "st")?.status, "the refused attempt is the last word of st's row").toBe("running");
    expect(no(c), "not latched: a refused attempt is not out, and no debt (state C is a latched run's)").toEqual([]);
    h.hangNem = null;
    h.tuChoi.clear();
    const a = await bam(c);
    expect(a.ok, String(a.message)).toBe(true);
    expect(ids()).toEqual(["st"]);
  });
  it("T7B1-CHUA-KHOA đối chứng the same, st's 'failed' row written: a known failure is its last word, R-6 unchanged: the Abort does not send it again", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.tuChoi.set("st", REF);
    const c = await centralRun(def("t7b1ckd", [gate(), parF("p", [move("m"), otStop("st", { maxAttempts: 0 }), gate("g2")])]), 1);
    await wait(40);
    expect(runRow(c).status).toBe("awaiting_confirm");
    expect(hang(c, "st")?.status).toBe("failed");
    h.tuChoi.clear();
    const a = await bam(c);
    expect(a.ok, String(a.message)).toBe(true);
    expect(ids()).toEqual([]);
  });

  // ── việc 1, 2 — THE two readings, pure: what is not out, what is owed ───────────────────────────────────────────────
  it("T7B1-MOT-NGUON priorStepsOf and stopChuaRaTuHang read one source: a refused attempt that is its row's last word; an answer only (no timeout, no 'may have flown'); owed only on a latched run; the context only adds; an abort row that went settles", () => {
    const tuChoi = { stepId: "st", status: "running", error: null, resultJson: { routedTo: "ot-dispatcher", status: "rejected", accepted: false, detail: {} } };
    const khoaHang = { stepId: "x", status: "failed", error: "FOE_OUTCOME_UNKNOWN: no answer" };
    const khoaCtx = { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN" } };
    const ds = (dong: unknown[], ctx?: Record<string, unknown>) => [...stopChuaRaTuHang(dong as never, ctx)].sort();
    const settled = (r: Record<string, unknown>) => priorStepsOf([r] as never).settled.has(String(r.stepId));
    // not out: not settled
    expect(settled(tuChoi), "a refused attempt, last word").toBe(false);
    expect(settled({ ...tuChoi, resultJson: { routedTo: "ot-dispatcher", status: "timeout", accepted: false } }), "no answer: handed over, may have gone").toBe(true);
    expect(settled({ ...tuChoi, resultJson: { routedTo: "ot-dispatcher", status: "rejected", accepted: false, detail: { reason: "DUPLICATE_IN_FLIGHT" } } }), "may have flown").toBe(true);
    expect(settled({ ...tuChoi, resultJson: { routedTo: "ot-dispatcher", status: "acked", accepted: true } }), "taken").toBe(true);
    expect(settled({ ...tuChoi, status: "failed", error: "INTERLOCK_NOT_MET" }), "its end written: a known failure is its last word").toBe(true);
    // owed: latched only (the rows' code or the context's latch)
    expect(ds([tuChoi]), "not latched").toEqual([]);
    expect(ds([khoaHang, tuChoi])).toEqual(["st"]);
    expect(ds([tuChoi], khoaCtx)).toEqual(["st"]);
    expect(ds([khoaHang, { ...tuChoi, status: "failed", error: "INTERLOCK_NOT_MET" }]), "a known failure: no debt").toEqual([]);
    // C4: an abort row that failed, code or not, on a latched run; not on a run not latched
    const abortHong = { stepId: "abort:st", status: "failed", error: "INTERLOCK_NOT_MET: refused", resultJson: { abortStop: "failed", stepId: "st" } };
    expect(ds([abortHong])).toEqual([]);
    expect(ds([khoaHang, abortHong])).toEqual(["st"]);
    for (const status of ["completed", "skipped"]) {
      const s9 = { stepId: "abort:s9", status: "failed", error: "x", resultJson: { stepId: "s9" } };
      expect(ds([khoaHang, s9, { stepId: "abort:st", status, error: null, resultJson: { stepId: "st" } }]), `abort row ${status}: nothing owed of st, s9 still`).toEqual(["s9"]);
      expect(ds([khoaHang, { stepId: "st", status: "failed", error: 'FOE_STOP_NOT_SENT: STOP "st" did NOT go out (attempt 1): refused before a driver [X].' }, { stepId: "abort:st", status, error: null, resultJson: { stepId: "st" } }]), `abort row ${status} settles the row of state C`).toEqual([]);
    }
    // the context only adds; the row of state C stands whatever it says; st's own row completed, or an abort row that went, clears the context's word
    const hangC = { stepId: "st", status: "failed", error: 'FOE_STOP_NOT_SENT: STOP "st" did NOT go out (attempt 1): refused before a driver [X].' };
    expect(ds([], { foeStopChuaRa: ["st"] }), "the context alone").toEqual(["st"]);
    expect(ds([hangC], { foeStopChuaRa: [] }), "never clears a debt a row names").toEqual(["st"]);
    expect(ds([hangC], { foeStopChuaRa: ["s2"] })).toEqual(["s2", "st"]);
    expect(ds([{ stepId: "st", status: "completed", error: null }], { foeStopChuaRa: ["st"] }), "st's own row completed").toEqual([]);
    expect(ds([{ stepId: "abort:st", status: "completed", error: null, resultJson: { stepId: "st" } }], { foeStopChuaRa: ["st"] }), "an abort row that went").toEqual([]);
  });

  // ── 5a: what an Abort's STOP can answer on a latched run: each by its own words (H11), each owed, each pressed again ──
  /** st's row in state C from a walk; then the Abort's dispatch answers as set */
  const giuRoiAbort = async (ref: string) => {
    vaoC();
    const c = await centralRun(dC(ref), 1);
    await xong(c);
    expect(runRow(c).status).toBe("held");
    h.alerts.length = 0;
    return c;
  };
  it("T7B1-ABORT-NEM the Abort's dispatch throws: aborted, abort:st owed, 'may have gone out' with no driver's text, an URGENT 'NOT confirmed out'; pressed again it goes", async () => {
    const c = await giuRoiAbort("t7b1nem");
    h.tuChoi.set("st", { nem: "socket 10.1.2.3:502 reset" });
    const a = await bam(c);
    expect(a.abortStops?.failed).toEqual(["st"]);
    expect(String(hang(c, "abort:st")?.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" is not confirmed out \(on the Abort\): may have gone out \[/);
    expect(String(hang(c, "abort:st")?.error)).not.toContain("10.1.2.3");
    expect(chuCua("abortStopNotSent")).toContain('STOP "st" NOT confirmed out');
    expect(chuCua("abortStopNotSent")).not.toContain("10.1.2.3");
    expect(no(c)).toEqual(["st"]);
    h.tuChoi.clear();
    await bam(c, "again");
    expect(ids()).toEqual(["st"]);
    expect(no(c)).toEqual([]);
  });
  it("T7B1-ABORT-POLICY a policy denies the Abort's STOP before any dispatcher: nothing handed over, abort:st owed, did NOT go out with the code alone, an URGENT; allowed again it goes", async () => {
    const c = await giuRoiAbort("t7b1pol");
    h.policyTuChoi.add("st");
    const a = await bam(c);
    expect(a.abortStops?.failed).toEqual(["st"]);
    expect(ids(), "never handed over").toEqual([]);
    expect(String(hang(c, "abort:st")?.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st" did NOT go out \(on the Abort\): refused before a driver \[POLICY_DENIED\]/);
    expect(String(hang(c, "abort:st")?.error)).not.toContain("10.1.2.3");
    expect(chuCua("abortStopNotSent")).toContain('STOP "st" did NOT go out');
    expect(no(c)).toEqual(["st"]);
    h.policyTuChoi.clear();
    h.tuChoi.clear();
    await bam(c, "again");
    expect(ids()).toEqual(["st"]);
    expect(no(c)).toEqual([]);
  });
  it("T7B1-ABORT-CHUA-TRA-LOI the Abort's STOP has no answer within the wait: reported pending, abort:st owed now, an URGENT; the late answer lands: completed, the debt is gone", async () => {
    const c = await giuRoiAbort("t7b1cho");
    h.tuChoi.clear();
    h.slow.set("st", STOP_DB_STEP_DEADLINE_MS + 300);
    const a = await bam(c);
    expect(a.abortStops?.pending).toEqual(["st"]);
    expect(hang(c, "abort:st")?.status).toBe("failed");
    expect(no(c)).toEqual(["st"]);
    expect(urgentCua("abortStopNotSent").map((x) => String(x.dedupKey).split(":")[2])).toEqual(["st"]);
    expect(chuCua("abortStopNotSent")).toContain("NO_ANSWER");
    expect(chuCua("abortStopNotSent")).not.toMatch(daGuiChu);
    await waitFor(() => hang(c, "abort:st")?.status === "completed", "the late answer");
    expect(no(c)).toEqual([]);
  });
  it("T7B1-DANH-DAU-NOT-CONFIRMED the marked route at the Abort, the central dispatcher answers NOT_CONFIRMED (no pinned STOP, or it could not read: one answer): 0 written, the walker's own reading: nobody could decide it, owed, by name", async () => {
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.duocSauKhoa.add("nt");
    h.tuChoi.set("nt", { status: "failed", error: "ADAPTER_OFFLINE", detail: { reason: "ADAPTER_OFFLINE" } });
    h.tuChoiKhongGhi.add("nt");
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("t7b1nc2", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [stopTyped("nt")])])])]), 1);
    await wait(60);
    expect(runRow(c).status).toBe("held");
    h.tuChoi.clear();
    h.tuChoiKhongGhi.clear();
    h.alerts.length = 0;
    h.classifyLoi = true;
    await bam(c);
    expect(ids()).toContain("nt");
    expect(h.sent.filter((x) => x.stepId === "nt").every((x) => x.khongGhi === true), "nothing written").toBe(true);
    expect(String(hang(c, "abort:nt")?.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "nt" did NOT go out \(on the Abort\): nobody could decide it \[NOT_CONFIRMED\]/);
    expect(no(c)).toEqual(["nt"]);
    expect(urgentCua("abortStopNotSent").map((x) => String(x.dedupKey).split(":")[2])).toEqual(["nt"]);
    expect(chuCua("abortStopNotSent")).not.toMatch(daGuiChu);
  });

  // ── T7b-1 fix 1, RA-1: pressed again on an aborted latched run: what is owed ∪ a verified STOP with no trace of a hand-over, in the window; nothing handed over again (H3) ─────
  /** a latched run, no live walker, a verified STOP s2 nobody handed over and not in the context (the latch forged: a crash before the first STOP pass, or an edge run whose node went) */
  const khoaChuaGiao = async (ref: string, them: WorkflowStep[] = []) => {
    seedHalt();
    h.ghim = PIN_OK;
    const c = await centralRun(def(ref, [gate("g0"), ot("x"), gate("g1"), otStop("s2"), ...them]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("awaiting_confirm");
    const ctx = ((runRow(c).contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] = { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: new Date().toISOString() };
    runRow(c).contextJson = ctx;
    runRow(c).status = "held";
    h.traTimeout = 1; // the pin table counts from here
    return c;
  };
  /** the first Abort: s2 refused, its abort: row lost: nothing durable says it is owed */
  const motLanMat = async (c: number) => {
    h.tuChoi.set("s2", REF);
    h.hangNem = (r) => r.stepId === "abort:s2";
    h.alerts.length = 0;
    const a = await bam(c);
    expect(a.abortStops?.failed).toEqual(["s2"]);
    expect(hang(c, "abort:s2"), "its abort row lost").toBeUndefined();
    expect(no(c), "nothing durable holds it").toEqual([]);
    h.hangNem = null;
    h.tuChoi.clear();
  };
  it("RA1-BAM-LAI-MAT-HANG one abort: row lost: the words promise no 'no time limit'; pressed again in the window s2 goes", async () => {
    const c = await khoaChuaGiao("ra1ml");
    await motLanMat(c);
    expect(chuCua("abortStopNotSent")).not.toContain("no time limit");
    expect(chuCua("abortStopNotSent")).toContain("may not reach it"); // H28, dieu-phoi 09/11: was "press Abort again within 15 minutes"
    expect(chuCua("abortStopNotSent"), "the words say what is left past it").toContain("check the machine on site");
    const a2 = await bam(c, "again");
    expect(a2.ok, String(a2.message)).toBe(true);
    expect(ids()).toEqual(["s2"]);
    expect(hang(c, "abort:s2")?.status).toBe("completed");
  });
  it("RA1-NGOAI-CUA-SO-CHU the same, past the window: resendTooOld, the 15 minutes do not stretch; the URGENT had not promised otherwise", async () => {
    const c = await khoaChuaGiao("ra1nc");
    await motLanMat(c);
    expect(chuCua("abortStopNotSent")).not.toContain("no time limit");
    quaCuaSo(c);
    const a2 = await bam(c, "past the window");
    expect(a2.ok).toBe(false);
    expect(a2.reason).toBe("resendTooOld");
    expect(ids()).toEqual([]);
  });
  it("RA1-KHONG-DOC-DINH-NGHIA the first Abort cannot read the definition: nothing sent, the report says it could not read; pressed again s2 goes", async () => {
    const c = await khoaChuaGiao("ra1dn");
    h.docNem = { bang: "orchestration_workflows", lan: 2 };
    const a1 = await bam(c);
    expect(h.docNemLan).toBeGreaterThan(0);
    expect(ids()).toEqual([]);
    expect(a1.abortStops?.khongDocDuoc).toBe(true);
    h.docNem = null;
    const a2 = await bam(c, "again");
    expect(ids()).toEqual(["s2"]);
    expect(a2.message).toContain("s2");
  });
  it("RA1-DOC-LOI pressed again, the step rows unread: no trace is no 'no trace': nothing sent, the words say it could not be read, press again, past 15 minutes check on site", async () => {
    const c = await khoaChuaGiao("ra1dl");
    await motLanMat(c);
    h.docNem = { bang: "orchestration_run_steps", lan: Infinity };
    const a2 = await bam(c, "again");
    h.docNem = null;
    expect(ids(), "never read: not sent").toEqual([]);
    expect(a2.abortStops?.khongDocDuoc).toBe(true);
    expect(a2.message).toMatch(/could not be read/);
    expect(a2.message).toMatch(/may not reach it/); // H32, dieu-phoi 09/11: was /press Abort again/
    expect(a2.message).toMatch(/15 minutes/);
    expect(a2.message).not.toMatch(/sent again|owes no/);
    const a3 = await bam(c, "read again");
    expect(a3.ok).toBe(true);
    expect(ids(), "read: s2 has no trace, it goes").toEqual(["s2"]);
  });
  it("RA1-CHI-GHIM the set of the new path is the planner's: a stop-typed step not pinned and a non-STOP, neither ever handed over, do not go; only the pinned s2", async () => {
    const c = await khoaChuaGiao("ra1cg", [stopTyped("nt2"), ot("m2")]);
    await motLanMat(c);
    await bam(c, "again");
    expect(ids()).toEqual(["s2"]);
    expect(hang(c, "abort:nt2")).toBeUndefined();
    expect(hang(c, "abort:m2")).toBeUndefined();
  });
  it("RA1-DA-GIAO-KHONG-DI-LAI st handed over and never confirmed, the run aborted: pressed again IN the window it is not handed over again (H3, the freeze); G stands on the first Abort of the held run", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.alertDurable = false;
    const c = await centralRun(def("ra1dg", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("st")])])]), 1);
    await xong(c);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "st")?.status).toBe("completed");
    h.alertDurable = true;
    h.timeoutDispatch.clear();
    await bam(c);
    expect(ids(), "G: the first Abort of a held run hands it over again").toEqual(["st"]);
    const a2 = await bam(c, "again");
    expect(ids(), "the run has ended: not again").toEqual([]);
    expect(a2.message, "RA-3").toMatch(/records hold no STOP step owed/); // H28, dieu-phoi 09/11: was /owes no STOP step/
  });
  it("RA1-R3E-MAT the Abort sweeps before the latch, st refused, its abort: row lost; the walk ends latched: it tells st by name and holds the debt in the context; past the window st goes", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 150);
    const d = def("ra1re", [gate(), parF("p", [move("x"), box("b", [delay("w", 400), otStop("st")])])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const c = (await startRun(d.ref, {}, OWNER)).runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => ids().includes("x"), "x handed over");
    h.tuChoi.set("st", REF);
    h.hangNem = (r) => r.stepId === "abort:st";
    const a1 = await abortRun(c, OWNER, "before the latch");
    expect(a1.abortStops?.failed).toContain("st");
    await di;
    await waitFor(() => runDaChot(c), "the latch, after the Abort");
    await wait(40);
    expect(hang(c, "abort:st")).toBeUndefined();
    expect(urgentCua("abortStopNotSent").map((x) => String(x.dedupKey).split(":")[2])).toEqual(["st"]);
    expect(no(c), "the context holds it").toEqual(["st"]);
    h.hangNem = null;
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    quaCuaSo(c);
    const a2 = await bam(c, "past the window");
    expect(a2.ok, String(a2.message)).toBe(true);
    expect(ids()).toEqual(["st"]);
    expect(no(c)).toEqual([]);
  });
  it("RA1-G-MAT s2 went on the walk, the Abort's new hand-over refused, its abort: row lost: the words never say 'did NOT go out' of a STOP handed over once and promise no press; pressed again nothing goes", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.alertDurable = false;
    const c = await centralRun(def("ra1gm", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("s2")])])]), 1);
    await xong(c);
    expect(runRow(c).status).toBe("held");
    h.alertDurable = true;
    h.timeoutDispatch.clear();
    h.tuChoi.set("s2", REF);
    h.hangNem = (r) => r.stepId === "abort:s2";
    h.alerts.length = 0;
    await bam(c);
    const chu = chuCua("abortStopNotSent");
    expect(chu).not.toContain("did NOT go out");
    expect(chu).toContain('STOP "s2" NOT confirmed');
    expect(chu).not.toContain("no time limit");
    expect(chu).not.toMatch(/press Abort again/i);
    expect(chu).toContain("check the machine on site");
    h.hangNem = null;
    h.tuChoi.clear();
    await bam(c, "again");
    expect(ids()).toEqual([]);
  });

  // ── T7b-1 fix 1, RA-2: the walker refused st, an Abort, THEN the latch ─────────────────────────────────────────────
  const tuChoiRoiAbort = async (ref: string, khoa: boolean) => {
    seedHalt();
    h.ghim = PIN_OK;
    if (khoa) h.timeoutDispatch.add("x");
    h.slow.set("x", 200);
    h.tuChoi.set("st", REF);
    const d = def(ref, [gate(), parF("p", [move("x"), otStop("st", { maxAttempts: 0 }), delay("w", 500)])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const c = (await startRun(d.ref, {}, OWNER)).runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => hang(c, "st")?.status === "failed", "st refused");
    expect(runDaChot(c), "not latched yet").toBe(false);
    h.tuChoi.clear();
    h.alerts.length = 0;
    const a1 = await bam(c, "before the latch");
    expect(a1.ok, String(a1.message)).toBe(true);
    expect(ids(), "R-6: a known failure is not sent again").toEqual([]);
    await di;
    await wait(40);
    return c;
  };
  it("RA2-ABORT-ROI-KHOA st refused by the walker, an Abort, then the latch: owed, an URGENT names st; pressed again st goes", async () => {
    const c = await tuChoiRoiAbort("ra2ab", true);
    await waitFor(() => runDaChot(c), "the latch, after the Abort");
    expect(runRow(c).status).toBe("aborted");
    expect(no(c), "owed").toEqual(["st"]);
    expect(String(hang(c, "st")?.error)).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
    expect(h.alerts.filter((x) => String(x.dedupKey).split(":")[2] === "st").map((x) => x.kind), "an URGENT names st").toContain(CANH_BAO_KHONG_RO_KIND.stopNotSent);
    h.timeoutDispatch.clear();
    const a2 = await bam(c, "again");
    expect(a2.ok, String(a2.message)).toBe(true);
    expect(ids()).toEqual(["st"]);
    expect(no(c)).toEqual([]);
  });
  it("RA2-DOI-CHUNG the same on a run that never latches: R-6 stands: no debt, no URGENT, its row as it was; pressed again nothing", async () => {
    const c = await tuChoiRoiAbort("ra2dc", false);
    expect(runDaChot(c)).toBe(false);
    expect(no(c)).toEqual([]);
    expect(h.alerts.filter((x) => String(x.dedupKey).split(":")[2] === "st" || x.kind === CANH_BAO_KHONG_RO_KIND.abortStopNotSent), "no word of st").toEqual([]);
    expect(String(hang(c, "st")?.error)).toMatch(/^INTERLOCK_NOT_MET/);
    await bam(c, "again");
    expect(ids()).toEqual([]);
  });
  it("T7B1-KHONG-KHOA-KHONG-BAO the Abort's STOP refused on a run that never latches: no abort_stop_not_sent, no debt", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const d = def("t7b1kk", [gate(), parF("p", [move("x"), box("b", [delay("w", 300), otStop("st")])])]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    h.slow.set("x", 100);
    const c = (await startRun(d.ref, {}, OWNER)).runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => ids().includes("x"), "x handed over");
    h.tuChoi.set("st", REF);
    const a1 = await abortRun(c, OWNER, "not latched");
    expect(a1.abortStops?.failed).toContain("st");
    await di;
    await wait(40);
    expect(runDaChot(c)).toBe(false);
    expect(hang(c, "abort:st")?.status).toBe("failed");
    expect(urgentCua("abortStopNotSent")).toEqual([]);
    expect(no(c)).toEqual([]);
  });
  it("T7B1-UNVERIFIED-KHONG-LA-STOP a non-STOP whose machine nothing resolves, in the sweep's unverified: not on the marked route, no abort: row, no debt", async () => {
    const c = await khoaChuaGiao("t7b1uv", [move("m9")]);
    fake.store.set("machines", rows("machines").filter((m) => m.id !== 2));
    const a = await bam(c);
    expect(a.abortStops?.unverified).toContain("m9");
    expect(a.abortStops?.failed).not.toContain("m9");
    expect(hang(c, "abort:m9"), "no row for it").toBeUndefined();
    expect(no(c)).toEqual([]);
    expect(ids()).toEqual(["s2"]);
  });

  // ── T7b-1 fix 1, RA-3: the answer to a press reads the report ──────────────────────────────────────────────────────
  it("RA3-CHU-TU-CHOI pressed again, refused again: the answer says refused and stays owed, never 'sent again'", async () => {
    const c = await khoaChuaGiao("ra3tc");
    h.tuChoi.set("s2", REF);
    await bam(c);
    const a2 = await bam(c, "again");
    expect(a2.abortStops?.failed).toEqual(["s2"]);
    expect(a2.message).toMatch(/refused or not answered: s2/);
    expect(a2.message).not.toMatch(/sent again|owes no/);
    expect(no(c)).toEqual(["s2"]);
  });
  const npGiu = async (ref: string) => {
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.duocSauKhoa.add("nt");
    h.tuChoi.set("nt", { status: "failed", error: "ADAPTER_OFFLINE", detail: { reason: "ADAPTER_OFFLINE" } });
    h.tuChoiKhongGhi.add("nt");
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def(ref, [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [stopTyped("nt")])])])]), 1);
    await wait(60);
    expect(runRow(c).status).toBe("held");
    h.tuChoi.clear();
    h.tuChoiKhongGhi.clear();
    h.classifyLoi = true;
    await bam(c);
    return c;
  };
  it("RA3-CHU-0PDU pressed again, the marked route answers NOT_CONFIRMED: 0 written: the answer says refused, never 'sent'", async () => {
    const c = await npGiu("ra3pd");
    const a2 = await bam(c, "again");
    expect(h.sent.every((x) => x.khongGhi === true)).toBe(true);
    expect(a2.message).toMatch(/refused or not answered: nt/);
    expect(a2.message).not.toMatch(/sent again|owes no/);
  });
  it("RA3-CHU-NOTPINNED pressed again, the read recovered says not pinned: the answer says so, nothing sent", async () => {
    const c = await npGiu("ra3np");
    h.classifyLoi = false;
    h.ghim = null;
    const a2 = await bam(c, "again");
    expect(ids()).toEqual([]);
    expect(a2.abortStops?.notPinned).toContain("nt");
    expect(a2.message).toMatch(/no pinned STOP: nt/);
    expect(a2.message).not.toMatch(/sent again|owes no/);
  });
  it("RA3-CHU-NO-NONSTOP a false debt on a non-STOP (its 'failed' write lost on a latched run): nothing sent; the answer names it, never 'sent again' nor 'owes no'", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 60);
    h.tuChoi.set("y", REF);
    h.hangNem = (r) => r.stepId === "y" && r.status === "failed";
    const c = await centralRun(def("ra3ns", [gate(), parF("p", [move("x"), ot("y", { maxAttempts: 0 }), box("b", [delay("w", 120), otStop("st")])])]), 1);
    await xong(c);
    h.hangNem = null;
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    await bam(c);
    expect(no(c)).toContain("y");
    const a2 = await bam(c, "again");
    expect(ids().filter((x) => x === "y")).toEqual([]);
    expect(a2.message).toMatch(/nothing was sent/);
    expect(a2.message).toContain("y");
    expect(a2.message).not.toMatch(/sent again|owes no/);
  });

  // ── 5a: a read that recovered says "not pinned" at the Abort: an answer, no debt (C-CLR, A-READ-3) ──────────────────
  it("T7B1-NOTPINNED a latched run held on nt in state C (its pins unread, refused before a driver); at the Abort the read answers 'not pinned': nothing sent, abort:nt skipped, the debt is gone", async () => {
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.duocSauKhoa.add("nt");
    h.tuChoi.set("nt", { status: "failed", error: "ADAPTER_OFFLINE", detail: { reason: "ADAPTER_OFFLINE" } });
    h.tuChoiKhongGhi.add("nt");
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("t7b1np", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c2", [stopTyped("nt")])])])]), 1);
    await wait(60);
    expect(runRow(c).status).toBe("held");
    expect(no(c)).toEqual(["nt"]);
    h.ghim = null;
    h.tuChoi.clear();
    const a = await bam(c);
    expect(a.ok, String(a.message)).toBe(true);
    expect(ids(), "read: not a STOP: nothing sent").toEqual([]);
    expect(a.abortStops?.notPinned).toContain("nt");
    expect(hang(c, "abort:nt")?.status).toBe("skipped");
    expect(no(c), "the debt is gone").toEqual([]);
  });

  // ── B5-ABORT (13a, điều phối: T16 không qua nếu thiếu): the verified STOPs behind EDGE_HOLD_UNUSED_NOT_REPORTED ────
  it("B5-ABORT an edge run held configStale whose authorisation could NOT be reported unused (EDGE_UNUSED_NOT_REPORTED): Abort sends the verified STOP behind it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const e = await edgeAssignedRun(def("t7b1b5", [gate(), move("r2"), otStop("s")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    e.unusedFails = true;
    h.staleDispatch.add("r2");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(String(hang(e.runId, "r2")?.error)).toContain("EDGE_UNUSED_NOT_REPORTED");
    expect(String(runRow(e.runId).error)).toContain("Abort sends them too");
    const a = await bam(e.runId);
    expect(a.ok, String(a.message)).toBe(true);
    expect(runRow(e.runId).status).toBe("aborted");
    expect(ids(), "the verified STOP behind the mark").toContain("s");
    expect(ids()).not.toContain("r2");
  });
});

// ═══ A2(n) T7b-1c ══════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * A2(n) T7b-1c (dieu-phoi 09/11) — ONE classification of every STOP at an Abort of a latched run (foeRunStore.phanLoaiStopAbort): what goes, under which key, and the words all read it. The rows these cases
 * stand on are the walker's own wherever it can write them (measured: the walker's `running` writes leave `attempt` 0): hand-made rows only where said. Rule of the key: may add one STOP, never swallows one.
 */
describe("A2(n) T7b-1c — one classification of a STOP at an Abort: what goes, its key, the words", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const stopTyped = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "run", value: 0 } }) as never;
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const REF = { status: "rejected", error: "INTERLOCK_NOT_MET: refused" };
  const ids = () => h.sent.map((x) => String(x.stepId));
  const pdu = () => h.sent.filter((x) => x.phatLai !== true);
  const khoaCuoi = () => String(h.sent.at(-1)?.key);
  const hang = (c: number, id: string) => stepRows(c).find((r) => r.stepId === id);
  const ctxCua = (c: number) => (runRow(c).contextJson as Record<string, unknown> | null) ?? {};
  const no = (c: number) => [...stopChuaRaTuHang(stepRows(c) as never, ctxCua(c))].sort();
  const urgentCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[kind]);
  const chuCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => urgentCua(kind).map((a) => `${a.title} ${a.message}`).join(" | ");
  const veBuoc = (id: string) => h.alerts.filter((a) => String(a.dedupKey).split(":")[2] === id);
  const quaCuaSo = (c: number) => (runRow(c).finishedAt = new Date(Date.now() - 2 * 3_600_000));
  const bam = async (c: number, note = "press") => {
    h.sent.length = 0;
    const a = await abortRun(c, OWNER, note);
    await wait(40);
    return a;
  };
  const xong = async (c: number) => {
    await waitFor(() => !["queued", "running", "compensating"].includes(runRow(c).status), "the end of the walk");
    await wait(40);
  };
  const runDaChot = (c: number) => ctxCua(c)[KET_CUC_KHONG_RO_CHOT_CTX_KEY] != null || chotTuHang(stepRows(c) as never) !== null;
  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  beforeEach(() => {
    vi.mocked(logCrudOperation).mockClear();
    vi.mocked(logCrudOperation).mockImplementation(async () => ({ id: 1 }) as never);
  });
  afterEach(() => {
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return x.name === "abort";
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    expect(sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)) && x.khongGhi !== true).map((x) => x.stepId), "a command that is no pinned STOP reached a device after the latch").toEqual([]);
  });

  /** a latched run the walker really held: x a move with no answer, the STOP behind a delay; no durable URGENT: held. Whatever `tiem` broke stays until it returns */
  const giuThat = async (ref: string, st: WorkflowStep, them: WorkflowStep[] = []) => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.alertDurable = false;
    const c = await centralRun(def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 40), st]), ...them])]), 1);
    await xong(c);
    expect(runRow(c).status, "latched, no durable URGENT: held").toBe("held");
    h.alertDurable = true;
    h.timeoutDispatch.clear();
    h.alerts.length = 0;
    h.hangNem = null;
    return c;
  };
  /** the Abort's hand-over refused and its abort: row lost: nothing durable says it is owed */
  const abortMat = async (c: number, id: string) => {
    h.tuChoi.set(id, REF);
    h.hangNem = (r) => r.stepId === `abort:${id}`;
    const a = await bam(c);
    expect(a.abortStops?.failed).toEqual([id]);
    expect(hang(c, `abort:${id}`), "its abort row lost").toBeUndefined();
    h.hangNem = null;
    h.tuChoi.clear();
    return a;
  };
  /** the latch forged, nobody handed a STOP s2 over: T7b-1's khoaChuaGiao */
  const khoaChuaGiao = async (ref: string, them: WorkflowStep[] = []) => {
    seedHalt();
    h.ghim = PIN_OK;
    const c = await centralRun(def(ref, [gate("g0"), ot("x"), gate("g1"), otStop("s2"), ...them]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("awaiting_confirm");
    const ctx = ctxCua(c);
    ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] = { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: new Date().toISOString() };
    runRow(c).contextJson = ctx;
    runRow(c).status = "held";
    h.traTimeout = 1;
    return c;
  };
  /** the real path of a latch on the rows alone: an edge run, the node reports x unknown and goes */
  const edgeMat = async (ref: string, them: WorkflowStep[] = [], hangThem: Array<Record<string, unknown>> = []) => {
    seedHalt();
    h.ghim = PIN_OK;
    const d = def(ref, [gate("g0"), otStop("s1"), otStop("cf"), ot("x"), otStop("s2"), ...them]);
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await claimPackage(e, 2);
    const t = new Date();
    const w = (stepId: string, status: string, error: string | null, result: Record<string, unknown> | null) => ({ stepId, stepType: "command", status, attempt: 1, startedAt: t, finishedAt: status === "running" ? null : t, error, result });
    await recordEdgeStepRows(fake as never, e.runId, [
      w("s1", "completed", null, { routedTo: "ot-dispatcher", status: "simulated", accepted: true }),
      w("cf", "completed", null, { routedTo: "ot-dispatcher", status: "acked_verified", accepted: true }),
      w("x", "running", "FOE_OUTCOME_UNKNOWN: no answer from x", { routedTo: "ot-dispatcher", status: "timeout", accepted: false }),
      ...(hangThem as never[]),
    ] as never);
    return { c: e.runId, t };
  };
  const moDi = async (d: WorkflowDefinition) => {
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const c = (await startRun(d.ref, {}, OWNER)).runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    return { c, di };
  };

  // ── RA2-1: what the URGENT promises and what a press sends read one source ─────────────────────────────────────────
  it("RA2-1-HUA-BAM (RC1) st handed over on the walk with no answer, the Abort refused, abort:st lost: coTheDaRa: never 'did NOT go out'; a press sends it under the walker's own key", async () => {
    h.timeoutDispatch.add("st");
    const c = await giuThat("ra21", otStop("st", { maxAttempts: 0 }));
    const khoaDi = String(h.sent.filter((x) => x.stepId === "st").at(-1)?.key);
    expect(hang(c, "st")).toMatchObject({ status: "failed", attempt: 1 });
    const a1 = await abortMat(c, "st");
    expect(a1.abortStops?.phanLoai?.st?.lop).toBe("coTheDaRa");
    expect(khoaCuoi(), "the first Abort under that key").toBe(khoaDi);
    const chu = chuCua("abortStopNotSent");
    expect(chu).not.toContain("did NOT go out");
    expect(chu).toContain("may have gone out");
    expect(chu).toContain("check the machine on site");
    expect(chu).toContain("may not reach it"); // H28, dieu-phoi 09/11: was "press Abort again within 15 minutes"
    expect(chu).not.toContain("no time limit");
    const a2 = await bam(c, "again");
    expect(ids()).toEqual(["st"]);
    expect(khoaCuoi(), "the press under that key").toBe(khoaDi);
    expect(a2.message).not.toMatch(/owes no/);
    expect(hang(c, "abort:st")?.status).toBe("completed");
  });
  it("RA2-1-HUA-BAM past the window: coTheDaRa is no debt: resendTooOld, the 15 minutes do not stretch", async () => {
    h.timeoutDispatch.add("st");
    const c = await giuThat("ra21n", otStop("st", { maxAttempts: 0 }));
    await abortMat(c, "st");
    quaCuaSo(c);
    const a2 = await bam(c, "past");
    expect(a2.reason).toBe("resendTooOld");
    expect(ids()).toEqual([]);
  });
  it("RC1B-NO-TRUOC st with no answer, the Abort refused, abort:st landed: class no, truoc coTheDaRa: the words read truoc; what goes does not: past the window it goes, under the sweep's key", async () => {
    h.timeoutDispatch.add("st");
    const c = await giuThat("rc1b", otStop("st", { maxAttempts: 0 }));
    h.tuChoi.set("st", REF);
    await bam(c);
    h.tuChoi.clear();
    const chu = chuCua("abortStopNotSent");
    expect(chu).not.toContain("did NOT go out");
    expect(chu).toContain("may have gone out");
    expect(chu).toContain("no time limit");
    expect(no(c)).toEqual(["st"]);
    quaCuaSo(c);
    const a2 = await bam(c, "past");
    expect(a2.abortStops?.phanLoai?.st).toMatchObject({ lop: "no", truoc: "coTheDaRa" });
    expect(ids(), "class no goes, whatever truoc says").toEqual(["st"]);
    expect(khoaCuoi()).toMatch(/-abort-/);
  });
  it("RC2-RUNNING-CO-THE (walker's rows) only the row that began is left, attempt 0: coTheDaRa: the Abort and the press under -a1, 'may have gone out'", async () => {
    h.hangNem = (r) => r.stepId === "st" && (r.resultJson != null || r.status !== "running");
    const c = await giuThat("rc2", otStop("st"));
    expect(hang(c, "st")).toMatchObject({ status: "running", attempt: 0, resultJson: null });
    await abortMat(c, "st");
    expect(khoaCuoi()).toBe(`run${c}-st-a1`);
    const chu = chuCua("abortStopNotSent");
    expect(chu).toContain("may have gone out");
    expect(chu).not.toContain("did NOT go out");
    await bam(c, "again");
    expect(ids()).toEqual(["st"]);
    expect(khoaCuoi()).toBe(`run${c}-st-a1`);
  });
  it("RC3-FAILED-CO-THE (rows through recordEdgeStepRows: no walk writes this shape, see the report) failed, no dispatcher, no code, attempt 2: coTheDaRa: under -a2, 'may have gone out'", async () => {
    const t = new Date();
    const { c } = await edgeMat("rc3", [], [{ stepId: "s2", stepType: "command", status: "failed", attempt: 2, startedAt: t, finishedAt: t, error: "adapter not resolved", result: null }]);
    h.alerts.length = 0;
    h.traTimeout = 1;
    await abortMat(c, "s2");
    expect(h.sent.filter((x) => x.stepId === "s2").at(-1)?.key).toBe(`run${c}-s2-a2`);
    const chu = chuCua("abortStopNotSent");
    expect(chu).toContain("may have gone out");
    expect(chu).not.toContain("did NOT go out");
    await bam(c, "again");
    expect(ids()).toEqual(["s2"]);
    expect(khoaCuoi()).toBe(`run${c}-s2-a2`);
  });
  it("RC4-CHI-GIAO-NGU-CANH every row of st lost, the dispatched record holds it (written BEFORE the dispatcher is called, so it proves only 'may have gone'): coTheDaRa under -a1, the press sends it", async () => {
    h.hangNem = (r) => r.stepId === "st";
    const c = await giuThat("rc4", otStop("st"));
    expect(hang(c, "st")).toBeUndefined();
    expect(ctxCua(c).foeDispatchedSteps).toContain("st");
    const a1 = await abortMat(c, "st");
    expect(a1.abortStops?.phanLoai?.st?.lop).toBe("coTheDaRa");
    expect(chuCua("abortStopNotSent")).not.toContain("did NOT go out");
    expect(chuCua("abortStopNotSent")).toContain("may have gone out");
    await bam(c, "again");
    expect(ids()).toEqual(["st"]);
    expect(khoaCuoi()).toBe(`run${c}-st-a1`);
  });
  it("T7B1C-HOAN-THANH-KHONG-KET-QUA a STOP whose row says completed, its result lost: daGiao: G on the first Abort, a press sends nothing, the words say handed over", async () => {
    h.hangNem = (r) => r.stepId === "st" && r.resultJson != null;
    const c = await giuThat("rw3", otStop("st"));
    expect(hang(c, "st")).toMatchObject({ status: "completed", resultJson: null });
    runRow(c).status = "aborted";
    runRow(c).finishedAt = new Date();
    const a = await bam(c, "press");
    expect(a.abortStops?.phanLoai?.st?.lop).toBe("daGiao");
    expect(ids()).toEqual([]);
  });
  it("T7B1C-DANG-KHONG-GIAO a row with a dispatcher's yes (running, simulated: its completed write lost): daGiao: a press sends nothing", async () => {
    h.timeoutOnce.add("st");
    h.hangNem = (r) => r.stepId === "st" && r.status === "completed";
    const c = await giuThat("rd3a", otStop("st"));
    expect((hang(c, "st")?.resultJson as Row).status).toBe("simulated");
    runRow(c).status = "aborted";
    runRow(c).finishedAt = new Date();
    const a = await bam(c, "press");
    expect(a.abortStops?.phanLoai?.st?.lop).toBe("daGiao");
    expect(ids()).toEqual([]);
  });

  // ── the key: may add one STOP, never swallows one ──────────────────────────────────────────────────────────────────
  it("CO-THE-KHU-TRUNG-OK the try under that key was ok, its result never reached the row: OT and robot: 0 PDU more, the row says the answer", async () => {
    for (const [ref, st, status] of [["ckoot", otStop("st"), "acked"], ["ckorb", robotStop("st"), "done"]] as const) {
      h.soCai = new Map();
      h.acked = true;
      h.ackStatus = status;
      h.hangNem = (r) => r.stepId === "st" && (r.resultJson != null || r.status !== "running");
      const c = await giuThat(ref, st);
      expect(hang(c, "st")).toMatchObject({ status: "running", resultJson: null });
      const a = await bam(c);
      expect(a.abortStops?.phanLoai?.st?.lop).toBe("coTheDaRa");
      expect(h.sent.filter((x) => x.stepId === "st").map((x) => x.phatLai), "a replay").toEqual([true]);
      expect(pdu().filter((x) => x.stepId === "st")).toEqual([]);
      expect(a.abortStops?.sent).toEqual(["st"]);
      expect(hang(c, "abort:st")).toMatchObject({ status: "completed" });
      expect((hang(c, "abort:st")?.resultJson as Row).status).toBe(status);
      expect(urgentCua("abortStopNotSent")).toEqual([]);
    }
  });
  it("CO-THE-GUI-KHOA-MOI no answer, or in flight: OT: 1 PDU under a new key naming the earlier try; robot, no answer: 1 PDU, the key dropped: never swallowed", async () => {
    for (const [ref, st, dangBay] of [["ckmto", otStop("st", { maxAttempts: 0 }), false], ["ckmdb", otStop("st", { maxAttempts: 0 }), true], ["ckmrb", robotStop("st"), false]] as const) {
      h.soCai = new Map();
      h.timeoutDispatch.add("st");
      const c = await giuThat(ref, st);
      const khoa = `run${c}-st-a1`;
      if (dangBay) h.soCai.set(khoa, { ok: false, simulated: false, status: "sent", dangBay: true, kq: {} });
      expect(h.soCai.has(khoa)).toBe(true);
      const a = await bam(c);
      expect(a.abortStops?.phanLoai?.st?.lop).toBe("coTheDaRa");
      const lan = pdu().filter((x) => x.stepId === "st");
      expect(lan.length, "one PDU").toBe(1);
      expect(lan[0]!.key).toBe(khoa);
      expect((lan[0]!.lanTruoc as Row).idempotencyKey, "names the earlier try").toBe(khoa);
      if (ref === "ckmrb") expect(lan[0]!.khoaMoi, "robot: the key dropped").toBe("");
      else {
        expect(String(lan[0]!.khoaMoi)).toMatch(new RegExp(`^${khoa}#stop-`));
        expect((lan[0]!.lanTruoc as Row).lyDo).toBe(dangBay ? "dang_bay" : "lan_truoc_khong_ok");
      }
      expect(hang(c, "abort:st")?.status).toBe("completed");
    }
  });
  it("CO-THE-A1-TRUNG-OK-CU -a1 hits an old ok, a3 was the last try with no answer: 0 PDU; the answer speaks of attempt 1 only, never of a later one", async () => {
    h.soCai = new Map();
    h.tuChoiLan.set("st", [REF]);
    h.timeoutSauTuChoi.add("st");
    h.hangNem = (r) => r.stepId === "st" && (r.resultJson != null || r.status !== "running");
    const c = await giuThat("ca1ok", otStop("st"));
    expect(h.sent.filter((x) => x.stepId === "st").map((x) => x.lan), "a3 was the last").toEqual(["1", "2", "3"]);
    expect(hang(c, "st")).toMatchObject({ status: "running", attempt: 0, resultJson: null });
    h.soCai.set(`run${c}-st-a1`, { ok: true, simulated: false, status: "acked", kq: { ok: true, status: "acked", routedTo: "ot-dispatcher", detail: {} } });
    h.tuChoiLan.clear();
    h.timeoutSauTuChoi.clear();
    runRow(c).status = "aborted";
    runRow(c).finishedAt = new Date();
    const a = await bam(c, "press");
    expect(pdu().filter((x) => x.stepId === "st"), "0 PDU").toEqual([]);
    expect(h.sent.at(-1)?.phatLai).toBe(true);
    expect(a.abortStops?.sent).toEqual(["st"]);
    expect(a.message).toMatch(/attempt 1/);
    expect(a.message).toMatch(/check the machine on site/);
    expect(a.message).not.toMatch(/attempt 3|a3\b/);
    expect(a.message).not.toMatch(/STOP steps sent again/);
    expect(a.message).not.toMatch(/confirmed/);
  });
  it("CO-THE-A1-KHONG-HANG -a1 has no row in the ledger (no earlier hand-over under it reached a dispatcher): the STOP really goes, under -a1, naming nothing", async () => {
    h.hangNem = (r) => r.stepId === "st" && (r.resultJson != null || r.status !== "running");
    const c = await giuThat("ca1kh", otStop("st"));
    h.soCai = new Map();
    const a = await bam(c);
    expect(a.abortStops?.phanLoai?.st?.lop).toBe("coTheDaRa");
    const lan = pdu().filter((x) => x.stepId === "st");
    expect(lan.map((x) => x.key)).toEqual([`run${c}-st-a1`]);
    expect(lan[0]!.lanTruoc).toBeUndefined();
    expect(hang(c, "abort:st")?.status).toBe("completed");
  });
  it("CO-THE-HANG-UY-QUYEN-MOI the walker's key again: a fresh marked authorisation row, never the row an earlier dispatch may have spent", async () => {
    h.hangNem = (r) => r.stepId === "st" && (r.resultJson != null || r.status !== "running");
    const c = await giuThat("cuqm", otStop("st"));
    const cu = { id: `foe-run${c}-st-a1`, tool: "foe", status: "executed", previewJson: {} };
    fake.store.set("ai_pending_actions", [...rows("ai_pending_actions"), cu]);
    await bam(c);
    const id = String((h.sent.at(-1)?.hitl as Row | undefined)?.actionId);
    expect(id).not.toBe(cu.id);
    expect(JSON.stringify(rows("ai_pending_actions").find((r) => r.id === id)?.previewJson ?? {})).toContain("hangMoiStopGhim");
  });

  // ── RA2-2: a read lost once ────────────────────────────────────────────────────────────────────────────────────────
  it("RA2-2-DOC-LOI-LAN-DAU (RC5) a debt on its abort: row, the press's first read lost once: the debt goes, no 'owes no STOP'", async () => {
    const c = await khoaChuaGiao("ra22");
    h.tuChoi.set("s2", REF);
    await bam(c);
    h.tuChoi.clear();
    expect(no(c)).toEqual(["s2"]);
    h.docNem = { bang: "orchestration_run_steps", lan: 1 };
    const a = await bam(c, "again");
    expect(h.docNemLan).toBe(1);
    h.docNem = null;
    expect(ids()).toEqual(["s2"]);
    expect(a.message).not.toMatch(/owes no/);
    expect(a.abortStops?.khongDocDuoc).toBeUndefined();
  });
  it("RA2-2-DOC-LOI-LAN-DAU (RC5b) the same past the window: 'no time limit' holds: it goes", async () => {
    const c = await khoaChuaGiao("ra22b");
    h.tuChoi.set("s2", REF);
    await bam(c);
    h.tuChoi.clear();
    quaCuaSo(c);
    h.docNem = { bang: "orchestration_run_steps", lan: 1 };
    const a = await bam(c, "past");
    h.docNem = null;
    expect(a.reason).toBeUndefined();
    expect(ids()).toEqual(["s2"]);
  });
  it("RA2-2-DOC-LOI-LAN-DAU (RC5c) every read lost: nothing goes on it, the words say why; a debt the context holds still goes", async () => {
    const c = await khoaChuaGiao("ra22c");
    h.tuChoi.set("s2", REF);
    await bam(c);
    h.tuChoi.clear();
    h.docNem = { bang: "orchestration_run_steps", lan: Infinity };
    const a = await bam(c, "again");
    expect(ids()).toEqual([]);
    expect(a.abortStops?.khongDocDuoc).toBe(true);
    expect(a.message).toMatch(/could not be read/);
    const ctx = ctxCua(c);
    ctx.foeStopChuaRa = ["s2"];
    runRow(c).contextJson = ctx;
    h.docNem = { bang: "orchestration_run_steps", lan: Infinity };
    const a2 = await bam(c, "context");
    h.docNem = null;
    expect(a2.abortStops?.phanLoai?.s2?.lop).toBe("no");
    expect(ids()).toEqual(["s2"]);
  });
  it("RA2-2-QUA-HAN-KHONG-NO past the window, the press's first read lost, nothing owed when the sweep reads: resendTooOld: a lost read does not stretch the 15 minutes", async () => {
    const c = await khoaChuaGiao("ra22q");
    runRow(c).status = "aborted";
    quaCuaSo(c);
    h.docNem = { bang: "orchestration_run_steps", lan: 1 };
    const a = await bam(c, "past");
    expect(h.docNemLan).toBe(1);
    h.docNem = null;
    expect(a.reason).toBe("resendTooOld");
    expect(ids()).toEqual([]);
  });
  it("RC8-MOT-DOC-LOI the latch on the rows alone, one read lost: s1 handed over and cf confirmed do not go again; it reads as latched (closed by the one source)", async () => {
    const { c } = await edgeMat("rc8m", [stopTyped("nt"), ot("m")]);
    h.traTimeout = 1;
    await bam(c);
    expect(runRow(c).status).toBe("aborted");
    h.docNem = { bang: "orchestration_run_steps", lan: 1 };
    const a = await bam(c, "one read lost");
    expect(h.docNemLan).toBe(1);
    h.docNem = null;
    expect(ids()).toEqual([]);
    expect(a.abortStops?.phanLoai?.s1?.lop, "the first Abort's own hand-over went: its abort: row settles it").toBe("xong");
    expect(a.abortStops?.phanLoai?.cf?.lop).toBe("xong");
  });
  it("RC8-MOT-DOC-LOI (no first Abort: the run read as aborted) one read lost: s1 handed over does not go, cf confirmed does not, s2 with no trace does", async () => {
    const { c } = await edgeMat("rc8n", [stopTyped("nt"), ot("m")]);
    h.traTimeout = 1;
    runRow(c).status = "aborted";
    runRow(c).finishedAt = new Date();
    h.docNem = { bang: "orchestration_run_steps", lan: 1 };
    const a = await bam(c, "one read lost");
    expect(h.docNemLan).toBe(1);
    h.docNem = null;
    expect(ids()).toEqual(["s2"]);
    expect(a.abortStops?.phanLoai?.s1?.lop).toBe("daGiao");
    expect(a.abortStops?.phanLoai?.cf?.lop).toBe("xong");
  });
  it("DIEU-LO-1-HIEN-TRANG the latch on the rows alone, EVERY read lost: a press sends s1 and cf too, never nt nor m. A stated exception to point 3, on condition every read fails, not the behaviour wanted (dieu-phoi 09/11)", async () => {
    const { c } = await edgeMat("dl1", [stopTyped("nt"), ot("m")]);
    h.traTimeout = 1;
    await bam(c);
    h.docNem = { bang: "orchestration_run_steps", lan: Infinity };
    await bam(c, "every read lost");
    h.docNem = null;
    expect(ids()).toEqual(expect.arrayContaining(["s1", "cf"]));
    expect(ids()).not.toContain("nt");
    expect(ids()).not.toContain("m");
  });

  it("DIEU-LO-1-NGOAI-CUA-SO the same, past the window: nothing read says latched: nothing goes, resendTooOld: the exception is in the window only", async () => {
    const { c } = await edgeMat("dl1n", [stopTyped("nt"), ot("m")]);
    h.traTimeout = 1;
    runRow(c).status = "aborted";
    quaCuaSo(c);
    h.docNem = { bang: "orchestration_run_steps", lan: Infinity };
    const a = await bam(c, "every read lost");
    h.docNem = null;
    expect(a.reason).toBe("resendTooOld");
    expect(ids()).toEqual([]);
  });

  // ── RA2-3: a write of the walker's end that throws ─────────────────────────────────────────────────────────────────
  const tuChoiRoiAbort = async (ref: string) => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 200);
    h.tuChoi.set("st", REF);
    const { c, di } = await moDi(def(ref, [gate(), parF("p", [move("x"), otStop("st", { maxAttempts: 0 }), delay("w", 500)])]));
    await waitFor(() => hang(c, "st")?.status === "failed", "st refused");
    h.tuChoi.clear();
    h.sent.length = 0;
    h.alerts.length = 0;
    await abortRun(c, OWNER, "before the latch");
    return { c, di };
  };
  const nhanTuChoi = (c: number) => (runRow(c), h.alerts.filter((a) => String(a.dedupKey).split(":")[2] === "st").map((a) => a.kind));
  it("RA2-3-GHI-ABORTED-NEM (RC10) the walker refused st, an Abort, the latch, its guarded 'aborted' write throws once: owed, told, a press sends it", async () => {
    const { c, di } = await tuChoiRoiAbort("ra23a");
    h.statusThrow = "aborted";
    await di;
    await wait(40);
    expect(h.statusThrowLan).toBe(1);
    expect(no(c)).toEqual(["st"]);
    expect(nhanTuChoi(c)).toContain(CANH_BAO_KHONG_RO_KIND.stopNotSent);
    h.timeoutDispatch.clear();
    quaCuaSo(c);
    await bam(c, "past");
    expect(ids()).toEqual(["st"]);
  });
  it("RA2-3-GHI-ABORTED-NEM (RC10b) the Abort's STOP refused before the latch, its abort: row lost, then that write throws: owed in the context, told by name, goes past the window", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 150);
    const { c, di } = await moDi(def("ra23b", [gate(), parF("p", [move("x"), box("b", [delay("w", 400), otStop("st")])])]));
    await waitFor(() => ids().includes("x"), "x handed over");
    h.tuChoi.set("st", REF);
    h.hangNem = (r) => r.stepId === "abort:st";
    h.alerts.length = 0;
    await abortRun(c, OWNER, "before the latch");
    h.statusThrow = "aborted";
    await di;
    await wait(40);
    expect(h.statusThrowLan).toBe(1);
    h.hangNem = null;
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    expect(no(c)).toEqual(["st"]);
    expect(veBuoc("st").map((a) => a.kind)).toContain(CANH_BAO_KHONG_RO_KIND.abortStopNotSent);
    quaCuaSo(c);
    await bam(c, "past");
    expect(ids()).toEqual(["st"]);
  });
  it("RA2-3-GHI-ABORTED-NEM (context write) that debt only in the context, and the context write throws: no 'no time limit' for a debt not durable: within 15 minutes, a press in the window sends it", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 150);
    const { c, di } = await moDi(def("ra23c", [gate(), parF("p", [move("x"), box("b", [delay("w", 400), otStop("st")])])]));
    await waitFor(() => ids().includes("x"), "x handed over");
    h.tuChoi.set("st", REF);
    h.hangNem = (r) => r.stepId === "abort:st";
    h.ctxNem = (ctx) => Array.isArray(ctx.foeStopChuaRa) && ctx.foeStopChuaRa.includes("st");
    h.alerts.length = 0;
    await abortRun(c, OWNER, "before the latch");
    await di;
    await wait(40);
    expect(h.ctxNemLan, "the injection reached the context write").toBe(1);
    h.hangNem = null;
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    expect(runRow(c).status).toBe("aborted");
    expect(no(c), "nothing durable holds it").toEqual([]);
    const chu = veBuoc("st").filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.abortStopNotSent).map((a) => `${a.title} ${a.message}`).join(" | ");
    expect(chu, "told").toContain("may not reach it"); // H28, dieu-phoi 09/11: was "within 15 minutes"
    expect(chu).not.toContain("no time limit");
    await bam(c, "again");
    expect(ids()).toEqual(["st"]);
  });
  it("RA2-3-GHI-ABORTED-NEM (context write, the walker's refusal) the row of state C lost, the context write throws: told as not durable, never only 'Abort sends it again'", async () => {
    const { c, di } = await tuChoiRoiAbort("ra23d");
    h.hangNem = (r) => r.stepId === "st" && String(r.error ?? "").startsWith("FOE_STOP_NOT_SENT");
    h.ctxNem = (ctx) => Array.isArray(ctx.foeStopChuaRa) && ctx.foeStopChuaRa.includes("st");
    await di;
    await wait(40);
    expect(h.ctxNemLan).toBe(1);
    expect(h.hangNemLan).toBeGreaterThan(0);
    h.hangNem = null;
    h.timeoutDispatch.clear();
    expect(no(c)).toEqual([]);
    const chu = veBuoc("st").map((a) => `${a.title} ${a.message}`).join(" | ");
    expect(chu).toContain("may not reach it"); // H28, dieu-phoi 09/11: was "within 15 minutes"
    expect(chu).not.toContain("no time limit");
    await bam(c, "again");
    expect(ids()).toEqual(["st"]);
  });

  // ── RA2-4: the Abort's row lands late, the walk reads before it ────────────────────────────────────────────────────
  for (const ms of [1, 5, 30]) {
    it(`RA2-4-GHI-TRE-${ms} st refused before the latch, an Abort while the walker lives: st went, abort:st lands ${ms} ms late: no 'did NOT go out', st's row not written over`, async () => {
      seedHalt();
      h.ghim = PIN_OK;
      h.timeoutDispatch.add("x");
      h.slow.set("x", 60);
      h.tuChoi.set("st", REF);
      const { c, di } = await moDi(def(`ra24${ms}`, [gate(), parF("p", [move("x"), otStop("st", { maxAttempts: 0 }), delay("w", 600)])]));
      await waitFor(() => runDaChot(c), "the latch");
      h.tuChoi.clear();
      h.alerts.length = 0;
      h.sent.length = 0;
      h.treGhi.set("abort:st", ms);
      const a = await abortRun(c, OWNER, "walker alive");
      await di;
      await wait(60);
      expect(h.treGhiLan, "the delay reached the write: without it this case proves nothing").toBeGreaterThan(0);
      expect(a.abortStops?.sent).toEqual(["st"]);
      expect(veBuoc("st").map((x) => x.kind), "st went: no word that it did not").toEqual([]);
      expect(String(hang(c, "st")?.error ?? "")).not.toMatch(/^FOE_STOP_NOT_SENT/);
      expect(hang(c, "abort:st")?.status).toBe("completed");
      expect(no(c)).toEqual([]);
    });
  }
  for (const ms of [5, 30]) {
    it(`RC12B-ABORT-GHI-TRE-${ms} the Abort's own 'aborted' write answers ${ms} ms late: the walk ends before the sweep starts: st went: no 'did NOT go out', its row not written over`, async () => {
      seedHalt();
      h.ghim = PIN_OK;
      h.timeoutDispatch.add("x");
      h.slow.set("x", 60);
      h.tuChoi.set("st", REF);
      const { c, di } = await moDi(def(`rc12b${ms}`, [gate(), parF("p", [move("x"), otStop("st", { maxAttempts: 0 }), delay("w", 600)])]));
      await waitFor(() => runDaChot(c), "the latch");
      h.tuChoi.clear();
      h.alerts.length = 0;
      h.sent.length = 0;
      h.treAborted = ms;
      const a = await abortRun(c, OWNER, "walker alive");
      await di;
      await wait(60);
      expect(h.treAbortedLan, "the delay reached the Abort's write").toBe(1);
      expect(a.abortStops?.sent).toEqual(["st"]);
      expect(veBuoc("st").map((x) => x.kind), "st went: no word that it did not").toEqual([]);
      expect(String(hang(c, "st")?.error ?? "")).not.toMatch(/^FOE_STOP_NOT_SENT/);
    });
  }
  // ── RC12b (dieu-phoi 09/11): the Abort's write of 'aborted' matches no row. Four branches, as ruled ─────────────────────────────────────
  /** a run that acted, the STOP s behind a delay: the walker alive at it */
  const diToiDelay = async (ref: string, khoa = false) => {
    seedHalt();
    h.ghim = PIN_OK;
    if (khoa) h.timeoutDispatch.add("x");
    const { c, di } = await moDi(def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 500), otStop("s")])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    h.sent.length = 0;
    h.alerts.length = 0;
    return { c, di };
  };
  for (const ms of [5, 30]) {
    it(`RC12B-NHANH-1-CHUA-KHOA-${ms} a run NOT latched, the woken walker writes 'aborted' first: read back 'aborted': confirmed, the sweep runs: s goes, ok`, async () => {
      const { c, di } = await diToiDelay(`rc12n1${ms}`);
      h.treAborted = ms;
      const a = await abortRun(c, OWNER, "walker alive");
      await di;
      expect(h.treAbortedLan).toBe(1);
      expect(a.ok, String(a.message)).toBe(true);
      expect(a.status).toBe("aborted");
      expect(a.abortStops?.sent).toEqual(["s"]);
      expect(h.sent.map((x) => x.stepId)).toEqual(["s"]);
    });
  }
  it("RC12B-NHANH-2-DOC-LAI-LOI that read back throws, the walker was flagged by this Abort: the sweep runs all the same, pinned STOPs only; the answer says the state could not be confirmed", async () => {
    const { c, di } = await diToiDelay("rc12n2");
    h.treAborted = 5;
    h.khiTreAborted = () => (h.docNem = { bang: "orchestration_runs", lan: 1 });
    const a = await abortRun(c, OWNER, "walker alive");
    await di;
    expect(h.docNemLan, "the read back reached the injection").toBe(1);
    expect(a.ok).toBe(false);
    expect(a.message).toMatch(/not confirmed/);
    expect(a.abortStops?.sent).toEqual(["s"]);
    expect(h.sent.map((x) => x.stepId), "no non-STOP").toEqual(["s"]);
  });
  const ketThucKhac = async (ref: string, status: string, tuChoi: boolean) => {
    seedHalt();
    h.ghim = PIN_OK;
    h.slow.set("x", 250); // the walker stands in x's hand-over: nothing of it writes while the Abort reads back
    const { c, di } = await moDi(def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 800), otStop("s")])])]));
    await waitFor(() => h.sent.some((x) => x.stepId === "x"), "x handed over");
    await wait(20);
    h.sent.length = 0;
    h.alerts.length = 0;
    if (tuChoi) h.tuChoi.set("s", REF);
    h.treAborted = 5;
    h.khiTreAborted = () => (runRow(c).status = status);
    const a = await abortRun(c, OWNER, "walker alive");
    h.tuChoi.clear();
    const nhin = { ...a };
    await di;
    return { c, a: nhin };
  };
  it("RC12B-NHANH-3-TERMINAL-KHAC the row reads failed, the walker's own end: the answer says failed, never 'aborted'; a STOP not out goes by the classification", async () => {
    const { a } = await ketThucKhac("rc12n3", "failed", false);
    expect(a.ok).toBe(false);
    expect(a.status).toBe("failed");
    expect(a.message).toContain("failed");
    expect(a.message).not.toMatch(/aborted\.|was aborted|already aborted/);
    expect(a.abortStops?.sent).toEqual(["s"]);
    expect(a.abortStops?.phanLoai?.s?.lop).toBe("chuaGiao");
  });
  it("RC12B-NHANH-3-TERMINAL-KHAC that STOP refused: an URGENT names it, true of a run that has ended: no press promised: a press cannot reach it", async () => {
    const { a } = await ketThucKhac("rc12n3r", "failed", true);
    expect(a.abortStops?.failed).toEqual(["s"]);
    const chu = chuCua("abortStopNotSent");
    expect(veBuoc("s").map((x) => x.kind)).toContain(CANH_BAO_KHONG_RO_KIND.abortStopNotSent);
    expect(chu).toContain("has ended");
    expect(chu).toContain("check the machine on site");
    expect(chu).not.toMatch(/press Abort again|no time limit|run aborted/);
  });
  it("RC12B-NHANH-3-TERMINAL-KHAC the row reads completed: the answer says completed", async () => {
    const { a } = await ketThucKhac("rc12n3c", "completed", false);
    expect(a.ok).toBe(false);
    expect(a.status).toBe("completed");
    expect(a.message).toContain("completed");
  });
  it("RC12B-NHANH-3-CHUA-TAC-DONG a run that ended and never acted: R-6-b stands: its STOP is not sent", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const { c, di } = await moDi(def("rc12n3k", [gate(), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    h.sent.length = 0;
    h.treAborted = 5;
    h.khiTreAborted = () => (runRow(c).status = "completed");
    const a = await abortRun(c, OWNER, "walker alive");
    await di;
    expect(a.status).toBe("completed");
    expect(ids()).toEqual([]);
  });
  it("RC12B-NHANH-4-KHONG-LIVE no walker here (a double click, two people): the other Abort won: no read back, no sweep", async () => {
    const c = await khoaChuaGiao("rc12n4");
    h.sent.length = 0;
    h.treAborted = 5;
    h.khiTreAborted = () => (runRow(c).status = "aborted");
    h.docNem = null;
    const a = await abortRun(c, OWNER, "second");
    expect(h.treAbortedLan).toBe(1);
    expect(a.ok).toBe(false);
    expect(a.message).toMatch(/already terminal/);
    expect(ids()).toEqual([]);
  });
  it("RC12B-DA-DANH-DAU another Abort flagged this walker first: this one's write matches no row: it is the double click: no second sweep", async () => {
    const { c, di } = await diToiDelay("rc12n5");
    h.treAborted = 5;
    h.treAbortedBoQua = 1;
    const dau = abortRun(c, OWNER, "first");
    const a = await abortRun(c, OWNER, "second");
    await dau;
    await di;
    expect(h.treAbortedLan, "the second one's write is the late one").toBe(1);
    expect(a.ok).toBe(false);
    expect(a.message).toMatch(/already terminal/);
    expect(a.abortStops).toBeUndefined();
  });
  it("T7B1C-BAM-LAI-CU-DOC-BAO-CAO a run not latched, pressed again with nothing to send: the answer never says 'were sent again'; with a STOP sent it says so", async () => {
    const { c, di } = await diToiDelay("cbl");
    const a0 = await abortRun(c, OWNER, "first");
    await di;
    expect(a0.abortStops?.sent).toEqual(["s"]);
    const a1 = await bam(c, "again");
    expect(ids()).toEqual([]);
    expect(a1.message).not.toMatch(/sent again/);
    expect(a1.message).toMatch(/this press sent no STOP step/);
    const c2 = await centralRun(def("cbl2", [gate("g0"), ot("x"), gate("g1"), otStop("s2")]), 1);
    await wait(30);
    h.tuChoi.set("s2", REF);
    await bam(c2, "refused");
    h.tuChoi.clear();
    const a2 = await bam(c2, "again");
    expect(ids()).toEqual(["s2"]);
    expect(a2.message).toMatch(/were sent again/);
  });

  // ── abortSapQuet, noSauAbortKhoa (dieu-phoi 09/11): what the wait holds, and what a lost word costs ───────────────────────────────────
  it("T7B1C-SAP-QUET-KHONG-HOAN-STOP the walker waits for the Abort on its way: the Abort's STOP goes while the walker still waits; another run's STOP is not behind it", async () => {
    const { c, di } = await diToiDelay("sqk");
    let xongDi = false;
    void di.then(() => (xongDi = true));
    const khac = await khoaChuaGiao("sqkb");
    h.sent.length = 0;
    h.treAborted = 120;
    const t0 = Date.now();
    const cho = abortRun(c, OWNER, "walker alive");
    const b = await abortRun(khac, OWNER, "the other run");
    const tB = Date.now() - t0;
    expect(b.abortStops?.sent).toEqual(["s2"]);
    expect(tB, "the other run's Abort waits for nothing of this one").toBeLessThan(120);
    await wait(30);
    expect(h.sent.some((x) => x.stepId === "s"), "the delayed write stands before this STOP, nothing else").toBe(false);
    await waitFor(() => h.sent.some((x) => x.stepId === "s"), "the STOP goes when the write has landed");
    const taiLucGui = Date.now() - t0;
    expect(taiLucGui, "no wait of the walker's in front of the STOP").toBeLessThan(120 + 2 * STOP_DB_STEP_DEADLINE_MS);
    await cho;
    await di;
    expect(xongDi).toBe(true);
  });
  it("T7B1C-SAP-QUET-CO-HAN a hung URGENT inside the sweep: the walker's end still comes, well inside the bound; the Abort answers within its own bound", async () => {
    const { c, di } = await diToiDelay("sqh", true);
    h.tuChoi.set("s", REF);
    h.alertTreo = true;
    const t0 = Date.now();
    let tDi = 0;
    void di.then(() => (tDi = Date.now() - t0));
    const a = await abortRun(c, OWNER, "walker alive");
    const tA = Date.now() - t0;
    await di;
    h.alertTreo = false;
    h.tuChoi.clear();
    console.log(`[PROBE thoi-gian] URGENT hung: the Abort answers in ${tA} ms, the walk ends in ${tDi} ms (D = ${STOP_DB_STEP_DEADLINE_MS})`);
    expect(a.abortStops?.failed).toEqual(["s"]);
    expect(h.treoLan).toBeGreaterThan(0);
    expect(tA, "the answer's bound (foeEngine ★ BOUND)").toBeLessThan(18 * STOP_DB_STEP_DEADLINE_MS);
    expect(tDi, "the walk's end: released by the sweep, not by the 15·D ceiling").toBeLessThan(13 * STOP_DB_STEP_DEADLINE_MS);
  }, 30_000);
  it("T7B1C-MAT-BAO-KHONG-MAT-NO the Abort's STOP refused before the latch, its row lost, the URGENT of the walk's end hung: the debt is in the context BEFORE the word, whatever becomes of the word", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 150);
    const { c, di } = await moDi(def("mbkmn", [gate(), parF("p", [move("x"), box("b", [delay("w", 400), otStop("st")])])]));
    await waitFor(() => ids().includes("x"), "x handed over");
    h.tuChoi.set("st", REF);
    h.hangNem = (r) => r.stepId === "abort:st";
    await abortRun(c, OWNER, "before the latch");
    h.alertTreo = true;
    h.treoLan = 0;
    await waitFor(() => h.treoLan > 0 && (runRow(c).contextJson as Row).foeStopChuaRa?.includes("st") === true, "the word hangs, the debt is written", 4_000);
    expect(no(c), "the word has not landed: the debt has").toEqual(["st"]);
    h.alertTreo = false;
    await di;
    h.hangNem = null;
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    quaCuaSo(c);
    await bam(c, "past");
    expect(ids()).toEqual(["st"]);
  }, 30_000);

  it("T7B1C-PENDING-LUC-WALKER (what stands today) st refused before the latch, the Abort's STOP has no answer when the walk ends: the walk tells it as owed; the late answer lands: the debt is gone. A word too many, never a STOP lost", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 60);
    h.tuChoi.set("st", REF);
    const { c, di } = await moDi(def("pdw", [gate(), parF("p", [move("x"), otStop("st", { maxAttempts: 0 }), delay("w", 600)])]));
    await waitFor(() => runDaChot(c), "the latch");
    h.tuChoi.clear();
    h.alerts.length = 0;
    h.sent.length = 0;
    h.slow.set("st", STOP_DB_STEP_DEADLINE_MS + 300);
    const a = await abortRun(c, OWNER, "walker alive");
    await di;
    expect(a.abortStops?.pending).toEqual(["st"]);
    expect(no(c)).toEqual(["st"]);
    await waitFor(() => hang(c, "abort:st")?.status === "completed", "the late answer");
    expect(no(c)).toEqual([]);
  });
  /**
   * What stands today, NOT what is wanted (dieu-phoi 09/11): the words only, what goes is right, it takes two faults at once. The rows cannot say a2 went, because the walker writes no `attempt` on its `running` writes:
   * the root is the backlog item "walker ghi attempt". When that lands this case changes.
   */
  it("T7B1C-MAT-KHI-THU-LAI (what stands today) a1 refused and that word landed, a2 no answer, every later write lost: the row's last word is a1's: class no: it goes with no time limit; a refused Abort says 'did NOT go out' of a STOP a2 may have sent", async () => {
    h.tuChoiLan.set("st", [REF]);
    h.timeoutSauTuChoi.add("st");
    let kq = 0;
    h.hangNem = (r) => r.stepId === "st" && (r.status !== "running" || (r.resultJson != null && ++kq > 2));
    const c = await giuThat("mkt", otStop("st"));
    expect(h.sent.filter((x) => x.stepId === "st").length).toBeGreaterThan(1);
    expect(hang(c, "st")).toMatchObject({ status: "running", attempt: 0 });
    expect((hang(c, "st")?.resultJson as Row).status).toBe("rejected");
    h.tuChoiLan.clear();
    h.timeoutSauTuChoi.clear();
    h.tuChoi.set("st", REF);
    await bam(c);
    h.tuChoi.clear();
    expect(chuCua("abortStopNotSent"), "what stands today: the rows cannot say a2 went").toContain("did NOT go out");
    runRow(c).status = "aborted";
    runRow(c).finishedAt = new Date(Date.now() - 2 * 3_600_000);
    const a = await bam(c, "past");
    expect(a.abortStops?.phanLoai?.st?.lop).toBe("no");
    expect(ids()).toEqual(["st"]);
  });

  // ── the abort row's own key is nowhere: its answer still changes the words ─────────────────────────────────────────
  it("T7B1C-ABORT-TIMEOUT-TRUOC the Abort's hand-over got no answer, abort:s2 landed; a press goes under a new sweep's key (the first key is nowhere to read); refused now: 'may have gone out', never 'did NOT go out'", async () => {
    const c = await khoaChuaGiao("atot");
    h.timeoutDispatch.add("s2");
    await bam(c);
    h.timeoutDispatch.clear();
    expect((hang(c, "abort:s2")?.resultJson as Row).status).toBe("timeout");
    const k1 = khoaCuoi();
    h.tuChoi.set("s2", REF);
    h.alerts.length = 0;
    const a = await bam(c, "again");
    h.tuChoi.clear();
    expect(a.abortStops?.phanLoai?.s2).toMatchObject({ lop: "no", truoc: "coTheDaRa" });
    expect(ids()).toEqual(["s2"]);
    expect(khoaCuoi()).toMatch(/-abort-/);
    expect(khoaCuoi()).not.toBe(k1);
    expect(chuCua("abortStopNotSent")).toContain("may have gone out");
    expect(chuCua("abortStopNotSent")).not.toContain("did NOT go out");
  });

  // ── what makes a debt durable ──────────────────────────────────────────────────────────────────────────────────────
  it("T7B1C-NO-MOI-GHI-DUOC a new debt whose abort: row lands: 'no time limit'", async () => {
    const c = await khoaChuaGiao("nmgd");
    h.tuChoi.set("s2", REF);
    h.alerts.length = 0;
    await bam(c);
    h.tuChoi.clear();
    expect(chuCua("abortStopNotSent")).toContain("no time limit");
    expect(chuCua("abortStopNotSent")).toContain('STOP "s2" did NOT go out');
  });
  it("T7B1C-NO-CU-GHI-MAT a debt its own row holds, the abort: row lost: durable all the same: 'no time limit'", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    h.tuChoi.set("st", REF);
    const c = await centralRun(def("ncgm", [gate(), parF("p", [move("x"), box("b", [delay("w", 40), otStop("st")])])]), 1);
    await xong(c);
    expect(runRow(c).status).toBe("held");
    h.alerts.length = 0;
    h.hangNem = (r) => r.stepId === "abort:st";
    await bam(c);
    h.hangNem = null;
    h.tuChoi.clear();
    expect(hang(c, "abort:st")).toBeUndefined();
    expect(chuCua("abortStopNotSent")).toContain("no time limit");
  });
  it("T7B1C-CHU-PENDING pressed again, no answer within the wait: the answer says so", async () => {
    const c = await khoaChuaGiao("cpd");
    h.tuChoi.set("s2", REF);
    await bam(c);
    h.tuChoi.clear();
    h.slow.set("s2", STOP_DB_STEP_DEADLINE_MS + 200);
    const a = await bam(c, "again");
    expect(a.abortStops?.pending).toEqual(["s2"]);
    expect(a.message).toMatch(/no answer yet: s2/);
    await waitFor(() => hang(c, "abort:s2")?.status === "completed", "the late answer");
  });
  it("T7B1C-DA-GIAO-CHU a press on a STOP daGiao by its row: nothing sent, the answer says check the machine; a first Abort of the held run hands it over again under the sweep's key (G)", async () => {
    const c = await giuThat("dgc", otStop("st"));
    expect(hang(c, "st")?.status).toBe("completed");
    const a1 = await bam(c);
    expect(a1.abortStops?.phanLoai?.st?.lop).toBe("daGiao");
    expect(ids()).toEqual(["st"]);
    expect(khoaCuoi()).toMatch(/-abort-/);
  });

  // ── RA2-5: the definition unread on a latched run ──────────────────────────────────────────────────────────────────
  const kiemKhongDoc = (c: number, a: { ok: boolean; message?: string; abortStops?: { khongDocDuoc?: true } }) => {
    expect(a.abortStops?.khongDocDuoc, "kept for the Studio").toBe(true);
    const u = urgentCua("abortDefUnread" as never);
    expect(u.length, "an URGENT of its own, no step named").toBeGreaterThan(0);
    const chu = `${u[0]!.title} ${u[0]!.message}`;
    expect(chu).toContain(`could not read the definition of run ${c}`);
    expect(chu).toContain("a STOP may still not be out");
    expect(chu).toContain("may not reach it"); // H32, dieu-phoi 09/11: was "press Abort again within 15 minutes"
    expect(chu).toContain("after 15 minutes none can be counted on"); // H32: was "after that check the machine on site"
    expect(chu).toContain("Check the machine on site");
    expect(String(u[0]!.dedupKey).split(":")[2]).toBe("?");
    expect(u[0]!.khuTrungBenVung, "durable").toBeDefined();
    expect(a.message, "never a silent ok").toContain(`could not read the definition of run ${c}`);
  };
  it("RA2-5-KHONG-DOC-DINH-NGHIA (RC9) the latch's URGENT already durable (DA_BAO): told all the same; a press in the window sends s2; past it resendTooOld: the 15 minutes do not stretch", async () => {
    const c = await khoaChuaGiao("ra25");
    const ctx = ctxCua(c);
    ctx.foeKetCucKhongRoDaBao = { stepId: "x", at: new Date().toISOString() };
    h.docNem = { bang: "orchestration_workflows", lan: 2 };
    h.alerts.length = 0;
    const a = await bam(c);
    h.docNem = null;
    expect(ids()).toEqual([]);
    kiemKhongDoc(c, a);
    await bam(c, "again");
    expect(ids()).toEqual(["s2"]);
  });
  it("RA2-5-KHONG-DOC-DINH-NGHIA (RC9b) no DA_BAO: told beside the run_end; past the window a press is refused", async () => {
    const c = await khoaChuaGiao("ra25b");
    h.docNem = { bang: "orchestration_workflows", lan: 2 };
    h.alerts.length = 0;
    const a = await bam(c);
    h.docNem = null;
    kiemKhongDoc(c, a);
    quaCuaSo(c);
    const a2 = await bam(c, "past");
    expect(a2.reason).toBe("resendTooOld");
    expect(ids()).toEqual([]);
  });
  it("RA2-5-KHONG-DOC-DINH-NGHIA (RC9c) unread on every read of two presses in the window: each says so", async () => {
    const c = await khoaChuaGiao("ra25c");
    h.docNem = { bang: "orchestration_workflows", lan: Infinity };
    h.alerts.length = 0;
    const a = await bam(c);
    kiemKhongDoc(c, a);
    const a2 = await bam(c, "again");
    h.docNem = null;
    expect(ids()).toEqual([]);
    expect(a2.abortStops?.khongDocDuoc).toBe(true);
    expect(a2.message).toMatch(/could not be read/);
  });
  it("RA2-5-KHONG-DOC-DINH-NGHIA (RC7c) the real path, the latch on the rows alone: told; a press sends s2", async () => {
    const { c } = await edgeMat("ra25e");
    h.traTimeout = 1;
    h.docNem = { bang: "orchestration_workflows", lan: 2 };
    h.alerts.length = 0;
    const a = await bam(c);
    h.docNem = null;
    kiemKhongDoc(c, a);
    await bam(c, "again");
    expect(ids()).toContain("s2");
  });
  it("RA2-5-DOI-CHUNG a run NOT latched, the definition unread: no such URGENT", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    const c = await centralRun(def("ra25d", [gate("g0"), ot("x"), gate("g1"), otStop("s2")]), 1);
    await wait(30);
    h.docNem = { bang: "orchestration_workflows", lan: 2 };
    h.alerts.length = 0;
    const a = await bam(c);
    h.docNem = null;
    expect(a.abortStops?.khongDocDuoc).toBe(true);
    expect(urgentCua("abortDefUnread" as never)).toEqual([]);
  });

  // ── the table: every class × read × press × abort: write ───────────────────────────────────────────────────────────
  const KHOA = { foeKetCucKhongRoChot: { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN" } };
  const abortHang = (status: string, kq: Record<string, unknown>) => ({ stepId: "abort:s", status, error: null, resultJson: { stepId: "s", ...kq } });
  const LOP: Record<string, { hang: Array<Record<string, unknown>>; ctx: Record<string, unknown> }> = {
    chuaGiao: { hang: [], ctx: KHOA },
    no: { hang: [abortHang("failed", { routedTo: "ot-dispatcher", status: "rejected", accepted: false })], ctx: KHOA },
    coTheDaRa: { hang: [{ stepId: "s", status: "running", attempt: 0, error: null, resultJson: { routedTo: "ot-dispatcher", status: "timeout", accepted: false } }], ctx: KHOA },
    daGiao: { hang: [{ stepId: "s", status: "completed", attempt: 1, error: null, resultJson: { routedTo: "ot-dispatcher", status: "simulated", accepted: true } }], ctx: KHOA },
    xong: { hang: [abortHang("completed", { routedTo: "ot-dispatcher", status: "acked_verified", accepted: true })], ctx: KHOA },
    khongDoc: { hang: [], ctx: KHOA },
  };
  const GUI: Record<string, Record<string, boolean>> = {
    chuaGiao: { dau: true, trongCua: true, ngoaiCua: false },
    no: { dau: true, trongCua: true, ngoaiCua: true },
    coTheDaRa: { dau: true, trongCua: true, ngoaiCua: false },
    daGiao: { dau: true, trongCua: false, ngoaiCua: false },
    xong: { dau: false, trongCua: false, ngoaiCua: false },
    khongDoc: { dau: true, trongCua: false, ngoaiCua: false },
  };
  // the words, by class, by whether the debt is durable
  const CHU: Record<string, [string, string]> = {
    chuaGiao: ["chuaRaKhongHan", "chuaRa15"],
    no: ["chuaRaKhongHan", "chuaRaKhongHan"], // a row holds it: its new row lost changes nothing
    coTheDaRa: ["coTheKhongHan", "coThe15"],
    daGiao: ["daGiaoKhongHan", "daGiaoKiemMay"],
    khongDoc: ["khongDocKhongHan", "khongDoc15"],
  };
  it("T7B1C-BANG-O every class × read (read, first read lost, every read lost) × press (first Abort, in the window, past it) × abort: write (lands, throws, late): what goes and the words; a cell with no meaning says why", () => {
    const dong: string[] = [];
    for (const ten of Object.keys(LOP)) {
      for (const doc of ["duoc", "lanDauLoi", "moiLanLoi"] as const) {
        for (const lan of ["dau", "trongCua", "ngoaiCua"] as const) {
          for (const ghi of ["duoc", "nem", "tre"] as const) {
            const voNghia: string[] = [];
            let lop = ten;
            // only a read that failed makes this class
            if (ten === "khongDoc" && doc !== "moiLanLoi") {
              voNghia.push("lop khongDoc chi co khi moi lan doc loi");
            }
            // a first Abort reads the rows once: its first read is its every read
            const docThat = lan === "dau" && doc === "lanDauLoi" ? "moiLanLoi" : doc;
            if (lan === "dau" && doc === "lanDauLoi") voNghia.push("Abort dau chi doc hang mot lan: lan dau loi = moi lan loi");
            if (docThat === "moiLanLoi") lop = "khongDoc"; // nothing read: no class can be seen (the context's debt: T7B1C-BANG-NGU-CANH)
            const vao = { hang: docThat === "moiLanLoi" ? null : LOP[ten]!.hang, ctx: LOP[ten]!.ctx };
            const p = phanLoaiStopAbort("s", vao as never);
            expect(p.lop, `${ten}/${doc}/${lan}/${ghi}`).toBe(ten === "khongDoc" && docThat !== "moiLanLoi" ? "chuaGiao" : lop);
            const gui = stopAbortCoGui(p, lan);
            expect(gui, `sends? ${ten}/${doc}/${lan}/${ghi}`).toBe(GUI[p.lop]![lan]);
            const ben = ghi !== "nem" || stopChuaRaTuHang((vao.hang ?? []) as never, vao.ctx).has("s");
            const chu = gui ? chuStopAbort(p, ben) : null;
            if (gui) expect(chu, `words ${ten}/${doc}/${lan}/${ghi}`).toBe(CHU[p.lop]![ben ? 0 : 1]);
            else voNghia.push("khong gui: khong co lan ghi abort:, khong co chu");
            dong.push(`${ten}|${doc}|${lan}|${ghi}|${p.lop}|${gui ? "gui" : "khong"}|${chu ?? "-"}|${voNghia.join("; ") || "co nghia"}`);
          }
        }
      }
    }
    expect(dong.length).toBe(6 * 3 * 3 * 3);
    for (const d of dong) console.log(`[BANG O] ${d}`);
  });
  it("T7B1C-BANG-NGU-CANH every read lost, the debt in the context: class no: it goes whatever the press, durable", () => {
    for (const lan of ["dau", "trongCua", "ngoaiCua"] as const) {
      const p = phanLoaiStopAbort("s", { hang: null, ctx: { ...KHOA, foeStopChuaRa: ["s"] } } as never);
      expect(p.lop).toBe("no");
      expect(stopAbortCoGui(p, lan)).toBe(true);
      expect(chuStopAbort(p, true)).toBe("chuaRaKhongHan");
    }
  });
  it("T7B1C-PHAN-LOAI each piece of evidence, alone, decides its class; truoc is read by the words only", () => {
    const pl = (h1: unknown[], ctx: Record<string, unknown> = KHOA, daThu?: (id: string) => boolean) => phanLoaiStopAbort("s", { hang: h1, ctx, daThu } as never);
    const hangS = (x: Record<string, unknown>) => ({ stepId: "s", attempt: 0, error: null, resultJson: null, ...x });
    const giao = (status: string, accepted: boolean, them: Record<string, unknown> = {}) => ({ routedTo: "ot-dispatcher", status, accepted, ...them });
    // no trace
    expect(pl([]).lop).toBe("chuaGiao");
    expect(pl([hangS({ status: "held" })]).lop).toBe("chuaGiao");
    expect(pl([hangS({ status: "failed", error: "FOE_NOT_SENT_RUN_LATCHED: not sent" })]).lop, "the sink's own word: it was not handed over").toBe("chuaGiao");
    expect(pl([hangS({ status: "failed", error: "INTERLOCK_NOT_MET: no", resultJson: giao("rejected", false) })]).lop, "its dispatcher refused it: not out").toBe("chuaGiao");
    expect(pl([hangS({ status: "failed", error: "INTERLOCK_NOT_MET: no", resultJson: giao("rejected", false) })], { ...KHOA, foeDispatchedSteps: ["s"] }).lop, "the refusal outranks the record written before the call").toBe("chuaGiao");
    // may have gone: each form, and its key
    expect(pl([hangS({ status: "running" })])).toMatchObject({ lop: "coTheDaRa", khoaThu: 1 });
    expect(pl([hangS({ status: "failed", attempt: 2, error: "adapter not resolved" })])).toMatchObject({ lop: "coTheDaRa", khoaThu: 2 });
    expect(pl([hangS({ status: "failed", attempt: 3, error: "FOE_OUTCOME_UNKNOWN: x", resultJson: giao("timeout", false) })])).toMatchObject({ lop: "coTheDaRa", khoaThu: 3 });
    expect(pl([hangS({ status: "running", resultJson: giao("timeout", false) })])).toMatchObject({ lop: "coTheDaRa", khoaThu: 1 });
    expect(pl([hangS({ status: "running", resultJson: giao("rejected", false, { detail: { reason: "DUPLICATE_IN_FLIGHT" } }) })]).lop, "may have flown").toBe("coTheDaRa");
    expect(pl([hangS({ status: "failed", error: "DRIVER_FAILED: x", resultJson: giao("failed", false) })]).lop, "a device error: may have gone").toBe("coTheDaRa");
    expect(pl([], { ...KHOA, foeDispatchedSteps: ["s"] })).toMatchObject({ lop: "coTheDaRa", khoaThu: 1 });
    expect(pl([], KHOA, (id) => id === "s")).toMatchObject({ lop: "coTheDaRa", khoaThu: 1 });
    expect(pl([hangS({ status: "held" })], { ...KHOA, foeDispatchedSteps: ["s"] }).lop, "a hold says nothing of a dispatcher").toBe("coTheDaRa");
    // handed over
    for (const st of ["simulated", "acked_unverified", "acked", "done"]) expect(pl([hangS({ status: "running", resultJson: giao(st, true) })]).lop, st).toBe("daGiao");
    expect(pl([hangS({ status: "completed" })]).lop, "completed, its result lost").toBe("daGiao");
    expect(pl([hangS({ status: "compensated" })]).lop).toBe("daGiao");
    // done with
    expect(pl([hangS({ status: "completed", resultJson: giao("acked_verified", true) })]).lop).toBe("xong");
    expect(pl([abortHang("completed", giao("simulated", true))]).lop).toBe("xong");
    expect(pl([{ stepId: "abort:s", status: "skipped", error: null, resultJson: { abortStop: "notPinned", stepId: "s" } }]).lop).toBe("xong");
    expect(pl([hangS({ status: "failed", error: 'FOE_STOP_NOT_SENT: STOP "s" did NOT go out (attempt 1): refused before a driver [X].' }), abortHang("completed", giao("acked", true))]).lop, "an abort row that went settles state C").toBe("xong");
    // owed; truoc
    expect(pl([hangS({ status: "failed", error: 'FOE_STOP_NOT_SENT: STOP "s" did NOT go out (attempt 1): refused before a driver [X].' })])).toEqual({ lop: "no" });
    expect(pl([hangS({ status: "failed", error: "x", resultJson: giao("timeout", false) }), abortHang("failed", giao("rejected", false))])).toEqual({ lop: "no", truoc: "coTheDaRa" });
    expect(pl([hangS({ status: "completed", resultJson: giao("simulated", true) }), abortHang("failed", giao("rejected", false))])).toEqual({ lop: "no", truoc: "daGiao" });
    expect(pl([abortHang("failed", giao("timeout", false))])).toEqual({ lop: "no", truoc: "coTheDaRa" });
    expect(pl([abortHang("failed", giao("rejected", false))])).toEqual({ lop: "no" });
    expect(pl([], { ...KHOA, foeStopChuaRa: ["s"] }).lop).toBe("no");
    // nothing read
    expect(phanLoaiStopAbort("s", { hang: null, ctx: KHOA } as never)).toEqual({ lop: "khongDoc" });
    // truoc never decides what goes
    for (const lan of ["dau", "trongCua", "ngoaiCua"] as const) {
      expect(stopAbortCoGui({ lop: "no", truoc: "coTheDaRa" }, lan)).toBe(true);
      expect(stopAbortCoGui({ lop: "no", truoc: "daGiao" }, lan)).toBe(true);
    }
    // the words read it
    expect(chuStopAbort({ lop: "no", truoc: "coTheDaRa" }, true)).toBe("coTheKhongHan");
    expect(chuStopAbort({ lop: "no", truoc: "daGiao" }, true)).toBe("daGiaoKhongHan");
    expect(chuStopAbort({ lop: "xong" }, true)).toBeNull();
  });
  /** the same table on the engine: rows the walker's shape (measured K1..K9), hand-made here; the dispatcher refuses, so the words fire */
  it("T7B1C-BANG-THAT the same cells on the engine: read through the real reads, the press through abortRun: what goes and the words", async () => {
    const CHU_RE: Record<string, Array<[RegExp, boolean]>> = {
      chuaRaKhongHan: [[/did NOT go out/, true], [/no time limit/, true]],
      chuaRa15: [[/did NOT go out/, true], [/may not reach it/, true], [/no time limit/, false]], // H28, dieu-phoi 09/11: was /within 15 minutes/
      coTheKhongHan: [[/may have gone out/, true], [/no time limit/, true], [/did NOT go out/, false]],
      coThe15: [[/may have gone out/, true], [/may not reach it/, true], [/did NOT go out/, false], [/no time limit/, false]], // H28, dieu-phoi 09/11: was /within 15 minutes/
      daGiaoKhongHan: [[/handed over earlier/, true], [/no time limit/, true], [/did NOT go out/, false]],
      daGiaoKiemMay: [[/not sent again/, true], [/check the machine on site/, true], [/did NOT go out/, false], [/no time limit/, false]],
      khongDocKhongHan: [[/could not be read/, true], [/no time limit/, true], [/did NOT go out/, false]],
      khongDoc15: [[/could not be read/, true], [/may not reach it/, true], [/did NOT go out/, false], [/no time limit/, false]], // H28, dieu-phoi 09/11: was /within 15 minutes/
    };
    const dat = (c: number, ten: string) => {
      const them = (x: Record<string, unknown>) => rows("orchestration_run_steps").push({ runId: c, stepType: "command", attempt: 0, error: null, resultJson: null, startedAt: new Date(), ...x } as never);
      const kq = (status: string, accepted: boolean) => ({ routedTo: "ot-dispatcher", status, accepted });
      if (ten === "no") them({ stepId: "abort:s2", status: "failed", error: "INTERLOCK_NOT_MET: refused", resultJson: { abortStop: "failed", stepId: "s2", ...kq("rejected", false) } });
      if (ten === "coTheDaRa") them({ stepId: "s2", status: "running", resultJson: kq("timeout", false) });
      if (ten === "daGiao") them({ stepId: "s2", status: "completed", attempt: 1, resultJson: kq("simulated", true) });
      if (ten === "xong") them({ stepId: "abort:s2", status: "completed", resultJson: { abortStop: "sent", stepId: "s2", ...kq("acked_verified", true) } });
    };
    const sai: string[] = [];
    let n = 0;
    for (const ten of Object.keys(LOP)) {
      for (const doc of ["duoc", "lanDauLoi", "moiLanLoi"] as const) {
        for (const lan of ["dau", "trongCua", "ngoaiCua"] as const) {
          for (const ghi of ["duoc", "nem", "tre"] as const) {
            if (ten === "khongDoc" && doc !== "moiLanLoi") continue; // no such cell: only a read that failed makes this class
            const c = await khoaChuaGiao(`bt${n++}`);
            dat(c, ten);
            if (lan !== "dau") {
              runRow(c).status = "aborted";
              runRow(c).finishedAt = lan === "trongCua" ? new Date() : new Date(Date.now() - 2 * 3_600_000);
            }
            h.tuChoi.set("s2", REF);
            if (doc !== "duoc") h.docNem = { bang: "orchestration_run_steps", lan: doc === "lanDauLoi" ? 1 : Infinity };
            if (ghi === "nem") h.hangNem = (r) => r.stepId === "abort:s2";
            if (ghi === "tre") h.treGhi.set("abort:s2", 5);
            h.alerts.length = 0;
            await bam(c, "cell");
            h.docNem = null;
            h.hangNem = null;
            h.treGhi.clear();
            h.tuChoi.clear();
            const docThat = lan === "dau" && doc === "lanDauLoi" ? "moiLanLoi" : doc;
            const lop = docThat === "moiLanLoi" ? "khongDoc" : ten === "khongDoc" ? "chuaGiao" : ten;
            const cho = GUI[lop]![lan]!;
            const o = `${ten}/${doc}/${lan}/${ghi}`;
            const coGui = ids().includes("s2");
            if (coGui !== cho) sai.push(`${o}: sends ${coGui}, wanted ${cho}`);
            if (ids().some((x) => x !== "s2")) sai.push(`${o}: other commands ${ids().join(",")}`);
            const chu = chuCua("abortStopNotSent");
            if (cho) {
              const ben = ghi !== "nem" || (lop === "no" && docThat !== "moiLanLoi");
              for (const [re, co] of CHU_RE[CHU[lop]![ben ? 0 : 1]!]!) if (re.test(chu) !== co) sai.push(`${o}: words ${re}: "${chu}"`);
            } else if (chu) sai.push(`${o}: words with nothing sent: "${chu}"`);
          }
        }
      }
    }
    console.log(`[BANG THAT] cells ${n}`);
    expect(sai).toEqual([]);
    expect(n).toBe(5 * 3 * 3 * 3 + 9);
  }, 180_000);
  /** the rows of each class, on any STOP id */
  const datLop = (c: number, ten: string, id: string, ban = "ot-dispatcher") => {
    const them = (x: Record<string, unknown>) => rows("orchestration_run_steps").push({ runId: c, stepType: "command", attempt: 0, error: null, resultJson: null, startedAt: new Date(), ...x } as never);
    const kq = (status: string, accepted: boolean) => ({ routedTo: ban, status, accepted });
    if (ten === "no") them({ stepId: `abort:${id}`, status: "failed", error: "INTERLOCK_NOT_MET: refused", resultJson: { abortStop: "failed", stepId: id, ...kq("rejected", false) } });
    if (ten === "coTheDaRa") them({ stepId: id, status: "running", resultJson: kq("timeout", false) });
    if (ten === "daGiao") them({ stepId: id, status: "completed", attempt: 1, resultJson: kq("simulated", true) });
    if (ten === "xong") them({ stepId: `abort:${id}`, status: "completed", resultJson: { abortStop: "sent", stepId: id, ...kq("acked_verified", true) } });
  };
  const LOP5 = ["chuaGiao", "no", "coTheDaRa", "daGiao", "xong"];
  const THU_TU = ["abortTruoc", "walkerTruoc", "docLaiLoi", "terminalKhac", "khongLive"] as const;
  it("T7B1C-BANG-AI-GHI-TRUOC every class × who wrote the end first (the Abort, the woken walker, the read back lost, another end, no walker here): what goes, the words, the answer", async () => {
    const sai: string[] = [];
    let n = 0;
    for (const ten of LOP5) {
      for (const tt of THU_TU) {
        const o = `${ten}/${tt}`;
        n++;
        h.timeoutDispatch.clear();
        h.slow.clear();
        h.tuChoi.clear();
        let c: number;
        let di: Promise<unknown> = Promise.resolve();
        if (tt === "khongLive") {
          c = await khoaChuaGiao(`bat${n}`);
          datLop(c, ten, "s2");
        } else {
          seedHalt();
          h.ghim = PIN_OK;
          if (tt === "terminalKhac") h.slow.set("x", 150); // stands in its hand-over: nothing of the walk writes meanwhile
          else h.timeoutDispatch.add("x");
          const m = await moDi(def(`bat${n}`, [gate(), parF("p", [move("x"), box("b", [delay("w", 500), otStop("s2")])])]));
          c = m.c;
          di = m.di;
          await waitFor(() => h.sent.some((x) => x.stepId === "x"), "x handed over");
          await wait(25);
          if (tt === "terminalKhac") rows("orchestration_run_steps").push({ runId: c, stepId: "z", stepType: "command", status: "failed", attempt: 1, error: "FOE_OUTCOME_UNKNOWN: z", resultJson: null } as never);
          datLop(c, ten, "s2");
        }
        h.traTimeout = 1;
        h.sent.length = 0;
        h.alerts.length = 0;
        h.tuChoi.set("s2", REF);
        if (tt !== "abortTruoc") h.treAborted = 8;
        if (tt === "docLaiLoi") h.khiTreAborted = () => (h.docNem = { bang: "orchestration_runs", lan: 1 });
        if (tt === "terminalKhac") h.khiTreAborted = () => (runRow(c).status = "failed");
        if (tt === "khongLive") h.khiTreAborted = () => (runRow(c).status = "aborted");
        const a = await abortRun(c, OWNER, "cell");
        const nhin = { ok: a.ok, status: a.status, message: String(a.message ?? "") };
        const chu = chuCua("abortStopNotSent");
        await di;
        await wait(10);
        h.docNem = null;
        h.khiTreAborted = null;
        const lan = tt === "terminalKhac" ? "trongCua" : "dau";
        const cho = tt === "khongLive" ? false : GUI[ten]![lan]!;
        const coGui = h.sent.some((x) => x.stepId === "s2");
        if (coGui !== cho) sai.push(`${o}: sends ${coGui}, wanted ${cho}`);
        if (tt === "abortTruoc" || tt === "walkerTruoc") {
          if (nhin.ok !== true) sai.push(`${o}: answer ${JSON.stringify(nhin)}`);
          if (cho) for (const [re, co] of [[/no time limit/, true]] as const) if (re.test(chu) !== co) sai.push(`${o}: words ${re}: "${chu}"`);
        }
        if (tt === "docLaiLoi" && (nhin.ok !== false || !/not confirmed/.test(nhin.message))) sai.push(`${o}: answer ${JSON.stringify(nhin)}`);
        if (tt === "terminalKhac") {
          if (nhin.status !== "failed" || /was aborted/.test(nhin.message)) sai.push(`${o}: answer ${JSON.stringify(nhin)}`);
          if (cho && (!/has ended/.test(chu) || /press Abort again/.test(chu))) sai.push(`${o}: words "${chu}"`);
        }
        if (tt === "khongLive" && (nhin.ok !== false || !/already terminal/.test(nhin.message) || chu)) sai.push(`${o}: answer ${JSON.stringify(nhin)} words "${chu}"`);
        h.tuChoi.clear();
      }
    }
    console.log(`[BANG AI-GHI-TRUOC] cells ${n}`);
    expect(sai).toEqual([]);
    expect(n).toBe(25);
  }, 120_000);
  const LAN3 = ["dau", "trongCua", "ngoaiCua"] as const;
  const moKhoa = async (ref: string, st: WorkflowStep, buTru: boolean) => {
    seedHalt();
    h.ghim = PIN_OK;
    const c = await centralRun(def(ref, buTru ? [gate("g0"), ot("x", { compensation: st }), gate("g1")] : [gate("g0"), ot("x"), gate("g1"), st]), 1);
    await wait(30);
    const ctx = ctxCua(c);
    ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] = { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: new Date().toISOString() };
    runRow(c).contextJson = ctx;
    runRow(c).status = "held";
    h.traTimeout = 1;
    return c;
  };
  const datLan = (c: number, lan: (typeof LAN3)[number]) => {
    if (lan === "dau") return;
    runRow(c).status = "aborted";
    runRow(c).finishedAt = lan === "trongCua" ? new Date() : new Date(Date.now() - 2 * 3_600_000);
  };
  it("T7B1C-BANG-OK-GHI the hand-over answers ok × the abort: write lands, throws, lands late: what goes; no URGENT of a STOP that went; a row that landed settles it, a row lost leaves what the rows said", async () => {
    const sai: string[] = [];
    let n = 0;
    for (const ten of LOP5) {
      for (const lan of LAN3) {
        for (const ghi of ["duoc", "nem", "tre"] as const) {
          const o = `${ten}/${lan}/${ghi}`;
          const c = await khoaChuaGiao(`bog${n++}`);
          datLop(c, ten, "s2");
          datLan(c, lan);
          if (ghi === "nem") h.hangNem = (r) => r.stepId === "abort:s2";
          if (ghi === "tre") h.treGhi.set("abort:s2", 5);
          h.alerts.length = 0;
          const a = await bam(c, "cell");
          h.hangNem = null;
          h.treGhi.clear();
          const cho = GUI[ten]![lan]!;
          if (ids().includes("s2") !== cho) sai.push(`${o}: sends ${ids().join(",")}, wanted ${cho}`);
          if (cho && !a.abortStops?.sent.includes("s2")) sai.push(`${o}: the report does not say it went`);
          if (chuCua("abortStopNotSent")) sai.push(`${o}: words of a STOP that went: ${chuCua("abortStopNotSent")}`);
          if (cho && ghi !== "nem" && hang(c, "abort:s2")?.status !== "completed") sai.push(`${o}: its row: ${hang(c, "abort:s2")?.status}`);
          if (cho && ghi === "nem" && ten === "no" && hang(c, "abort:s2")?.status !== "failed") sai.push(`${o}: the row lost: the old one stays: a later press may add one STOP`);
        }
      }
    }
    console.log(`[BANG OK-GHI] cells ${n}`);
    expect(sai).toEqual([]);
    expect(n).toBe(5 * 3 * 3);
  }, 120_000);
  it("T7B1C-BANG-LOAI every class × press, on a robot STOP, a STOP compensation, a stop-typed step on the marked route: what goes; the key of coTheDaRa; the refusal's URGENT names it", async () => {
    const sai: string[] = [];
    let n = 0;
    for (const loai of ["robot", "buTru", "danhDau"] as const) {
      for (const ten of LOP5) {
        for (const lan of LAN3) {
          const o = `${loai}/${ten}/${lan}`;
          const st = loai === "robot" ? robotStop("s2") : loai === "buTru" ? otStop("s2") : stopTyped("s2");
          const c = await moKhoa(`blo${n++}`, st, loai === "buTru");
          datLop(c, ten, "s2", loai === "robot" ? "robot-dispatcher" : "ot-dispatcher");
          datLan(c, lan);
          if (loai === "danhDau") {
            h.ghim = PIN_BAD;
            h.classifyLoi = true;
            h.dispatcherThat = true;
            h.duocSauKhoa.add("s2");
          }
          h.tuChoi.set("s2", REF);
          h.alerts.length = 0;
          const a = await bam(c, "cell");
          h.tuChoi.clear();
          h.ghim = PIN_OK;
          h.classifyLoi = false;
          h.dispatcherThat = false;
          const cho = GUI[ten]![lan]!;
          const lenh = h.sent.filter((x) => x.stepId === "s2");
          if ((lenh.length > 0) !== cho) sai.push(`${o}: sends ${lenh.length}, wanted ${cho}; answer ${a.reason ?? ""} ${JSON.stringify(a.abortStops?.phanLoai ?? null)} ${JSON.stringify(a.abortStops?.unverified ?? null)}`);
          if (h.sent.some((x) => x.stepId !== "s2")) sai.push(`${o}: other commands ${ids().join(",")}`);
          if (cho && ten === "coTheDaRa" && lenh[0]?.key !== `run${c}-s2-a1`) sai.push(`${o}: key ${String(lenh[0]?.key)}`);
          if (cho && ten !== "coTheDaRa" && !/-abort-/.test(String(lenh[0]?.key))) sai.push(`${o}: key ${String(lenh[0]?.key)}`);
          if (cho && !veBuoc("s2").some((x) => x.kind === CANH_BAO_KHONG_RO_KIND.abortStopNotSent)) sai.push(`${o}: no URGENT names it`);
          if (!cho && chuCua("abortStopNotSent")) sai.push(`${o}: words with nothing sent`);
        }
      }
    }
    console.log(`[BANG LOAI] cells ${n}`);
    expect(sai).toEqual([]);
    expect(n).toBe(3 * 5 * 3);
  }, 120_000);
});

describe("A2(n) T7b-1d — what an Abort tried or meant to send goes at a later press, on every run (H22, H23, H25, H26)", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const par = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as never;
  const brn = (id: string, t: WorkflowStep[]): WorkflowStep => ({ id, type: "branch", condition: { source: "telemetry", machineId: 2, key: "temp", op: "lt", value: 100 }, then: t, else: [] }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const stopTyped = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "run", value: 0 } }) as never;
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const REF = { status: "rejected", error: "INTERLOCK_NOT_MET: refused" };
  const ids = () => h.sent.map((x) => String(x.stepId));
  const pdu = (id: string) => h.sent.filter((x) => x.stepId === id && x.khongGhi !== true);
  const hang = (c: number, id: string) => stepRows(c).find((r) => r.stepId === id);
  const ctxCua = (c: number) => (runRow(c).contextJson as Record<string, unknown> | null) ?? {};
  const no = (c: number) => [...stopChuaRaTuHang(stepRows(c) as never, ctxCua(c))].sort();
  const urgentCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[kind]);
  const chuCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => urgentCua(kind).map((a) => `${a.title} ${a.message}`).join(" | ");
  const veBuoc = (id: string) => h.alerts.filter((a) => String(a.dedupKey).split(":")[2] === id);
  const quaCuaSo = (c: number) => (runRow(c).finishedAt = new Date(Date.now() - 2 * 3_600_000));
  const runDaChot = (c: number) => ctxCua(c)[KET_CUC_KHONG_RO_CHOT_CTX_KEY] != null || chotTuHang(stepRows(c) as never) !== null;
  const ve0 = () => {
    h.sent.length = 0;
    h.alerts.length = 0;
  };
  const bam = async (c: number, note = "press") => {
    ve0();
    const a = await abortRun(c, OWNER, note);
    await wait(40);
    return a;
  };
  const moDi = async (d: WorkflowDefinition) => {
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const c = (await startRun(d.ref, {}, OWNER)).runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    return { c, di };
  };
  /** the latch forged on a run at its gate, no walker alive: T7b-1's khoaChuaGiao */
  const khoaChuaGiao = async (ref: string, them: WorkflowStep[] = []) => {
    const c = await centralRun(def(ref, [gate("g0"), ot("x"), gate("g1"), otStop("s2"), ...them]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("awaiting_confirm");
    const ctx = ctxCua(c);
    ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] = { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: new Date().toISOString() };
    runRow(c).contextJson = ctx;
    runRow(c).status = "held";
    h.traTimeout = 1;
    return c;
  };
  /** the verifier reads the real pins: this STOP read and found not pinned, or pinned again */
  const ghimHalt = (co: boolean) => fake.seed(deviceTags, rows("device_tags").map((t) => (t.tagKey === "halt" ? { ...t, stopValue: co ? true : null } : t)));
  const KHONG_GHIM = async () => ({ pinnedStop: false, loiDocGhim: null });
  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  // fix 2 — a run id of its own in each case: the engine's sweep registry is by run id and outlives a case: a sweep a hanging case leaves behind must not be joined by the next (measured: 15 s per case behind T7B1D-TREO-DUOI-WALKER)
  let lanCa = 0;
  beforeEach(() => {
    nhayId(++lanCa * 1000);
    seedHalt();
    h.ghim = PIN_OK;
    vi.mocked(logCrudOperation).mockClear();
    vi.mocked(logCrudOperation).mockImplementation(async () => ({ id: 1 }) as never);
  });
  afterEach(() => {
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return x.name === "abort";
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    expect(sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)) && x.khongGhi !== true).map((x) => x.stepId), "a command that is no pinned STOP reached a device after the latch").toEqual([]);
  });

  // ── the fake (fix 1, step 1): what a caller holds is its own, as with a database ────────────────────────────────────────────────────────────────────────────────────
  it("T7B1D-FAKE-KHONG-CHIA read, seed, insert, update, delete: nothing a caller holds is what the fake stores", async () => {
    const f = new FakeDb();
    const moc = { a: { b: 1 } };
    f.seed(orchestrationRuns, [{ id: 1, contextJson: moc }]);
    moc.a.b = 9;
    const trong = () => (f.store.get("orchestration_runs") ?? []).find((r) => r.id === 1)!.contextJson.a.b;
    expect(trong(), "seed").toBe(1);
    const [doc] = await f.select().from(orchestrationRuns).where(() => true);
    doc.contextJson.a.b = 9;
    expect(trong(), "read").toBe(1);
    const vao = { contextJson: { a: { b: 2 } } };
    const [capNhat] = await f.update(orchestrationRuns).set(vao).where(() => true).returning();
    vao.contextJson.a.b = 9;
    capNhat.contextJson.a.b = 9;
    expect(trong(), "update: its patch, its answer").toBe(2);
    const moi = { id: 2, contextJson: { a: { b: 3 } } };
    const [dau] = await f.insert(orchestrationRuns).values(moi).returning();
    moi.contextJson.a.b = 9;
    dau.contextJson.a.b = 9;
    expect((f.store.get("orchestration_runs") ?? []).find((r) => r.id === 2)!.contextJson.a.b, "insert: its values, its answer").toBe(3);
    const [xoa] = await f.delete(orchestrationRuns).where((r: Row) => r.id === 1).returning();
    expect(xoa.contextJson.a.b).toBe(2);
  });
  it("T7B1D-FAKE-KHONG-CHIA a walk's context lost is lost: refused, its abort: row and every context write thrown, the compensation not due: no debt, no command (p1, no hand-made copy)", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 120);
    const { c, di } = await moDi(def("d1dfk", [gate(), par("root", [move("x"), box("b", [move("y", { compensation: otStop("s") }), delay("w", 300)])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.tuChoi.set("s", REF);
    h.hangNem = (r) => r.stepId === "abort:s";
    const nem = () => {
      queueMicrotask(() => (h.ctxNem = nem));
      return true;
    };
    h.ctxNem = nem;
    await abortRun(c, OWNER, "first");
    await di.catch(() => undefined);
    await wait(300);
    expect(h.ctxNemLan, "the injection reached the context").toBeGreaterThan(0);
    expect(h.hangNemLan, "the injection reached the row").toBeGreaterThan(0);
    h.hangNem = null;
    h.ctxNem = null;
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    expect(runDaChot(c), "the latch is on the rows").toBe(true);
    expect(no(c), "nothing durable holds it").toEqual([]);
    await bam(c);
    expect(ids()).toEqual([]);
  }, 20_000);

  // ── RM-KHONG-XN first (the direction that loses a STOP): a row central could not verify is no hand-over, whatever it says of itself ───────────────────────
  it("T7B1D-KHONG-XN a row with the mark and accepted: true is 'may have gone', never 'handed over': a press within the window sends it, under the walker's key", async () => {
    const hangDau = { stepId: "s2", status: "completed", error: null, attempt: 2, resultJson: { routedTo: "ot-dispatcher", accepted: true, status: "acked_unverified", stopKhongXacNhan: "ghimLech" } };
    expect(phanLoaiStopAbort("s2", { hang: [hangDau], ctx: {} }).lop).toBe("coTheDaRa");
    expect(stopAbortCoGui(phanLoaiStopAbort("s2", { hang: [hangDau], ctx: {} }), "trongCua")).toBe(true);
    expect(stopAbortCoGui(phanLoaiStopAbort("s2", { hang: [hangDau], ctx: {} }), "ngoaiCua")).toBe(false);
    const c = await khoaChuaGiao("t7b1dxn");
    runRow(c).status = "aborted";
    runRow(c).finishedAt = new Date();
    rows("orchestration_run_steps").push({ id: 99_001, runId: c, stepType: "command", ...hangDau });
    const a = await bam(c);
    expect(a.abortStops?.phanLoai?.s2?.lop).toBe("coTheDaRa");
    expect(pdu("s2").map((x) => x.key)).toEqual([`run${c}-s2-a2`]);
    expect(ids()).toEqual(["s2"]);
  });

  it("T7B1D-DAU-VET-THUAN the trace is the abort: row: the same class on every run, read or not; read and found none is settled; no answer: may have gone; no debt on a run not latched", () => {
    const hang = (abortStop: string, status = "failed") => [{ stepId: "abort:s", status, resultJson: { abortStop, stepId: "s" } }];
    expect(phanLoaiStopAbort("s", { hang: hang("chuaXacMinh"), ctx: {} })).toEqual({ lop: "no", truoc: "chuaXacMinh" });
    expect(phanLoaiStopAbort("s", { hang: hang("failed"), ctx: {} }).lop, "a refusal on a run not latched: the class it has on a latched one").toBe("no");
    expect(phanLoaiStopAbort("s", { hang: hang("chuaTraLoi"), ctx: {} }), "no answer: may have gone").toEqual({ lop: "coTheDaRa", khoaThu: 1 });
    expect(phanLoaiStopAbort("s", { hang: hang("notPinned", "skipped"), ctx: {} }).lop, "read and found none: settled").toBe("xong");
    expect(phanLoaiStopAbort("s", { hang: null, ctx: {} }).lop, "unread is no trace").toBe("khongDoc");
    expect([...stopChuaRaTuHang(hang("chuaXacMinh"), {})], "H23: no debt on a run not latched").toEqual([]);
    expect([...stopChuaRaTuHang(hang("chuaXacMinh"), { foeKetCucKhongRoChot: { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN" } })], "latched: the row is the debt").toEqual(["s"]);
    expect(stopAbortCoGui({ lop: "coTheDaRa" }, "ngoaiCua"), "the window").toBe(false);
  });

  // ── the 80 cells of the review of T7b-1c, on the real path. Each: the evidence the injection reached its target, then the answer, the URGENT, the press ─────
  type MaDau = "s" | "s0" | "unv" | "lst" | "kkh";
  type MaUrg = "U" | "Uv" | "H13" | "-";
  type O = [MaDau, MaUrg, "s" | "0"];
  const COT = ["CHUA-TU-CHOI", "CHUA-DOC-LOI", "KHOA-SAU-TU-CHOI", "KHOA-SAU-DOC-LOI", "KHOA-TRUOC-TU-CHOI", "KHOA-TRUOC-DOC-LOI", "KHOA-HELD-TU-CHOI", "KHOA-HELD-DOC-LOI"] as const;
  const CHUAN: O[] = [["s", "-", "s"], ["unv", "-", "s"], ["s", "U", "s"], ["unv", "Uv", "s"], ["s", "U", "s"], ["s0", "U", "s"], ["s", "U", "s"], ["s0", "U", "s"]];
  const CHUA_CHON: O[] = [["lst", "-", "0"], ["lst", "-", "0"], ["lst", "H13", "0"], ["lst", "H13", "0"], ["lst", "H13", "0"], ["lst", "H13", "0"], ["lst", "H13", "0"], ["lst", "H13", "0"]];
  const BU_TRU_XA: O[] = [["s", "-", "s"], ["unv", "-", "s"], ["s", "U", "s"], ["unv", "Uv", "s"], ["kkh", "-", "0"], ["kkh", "-", "0"], ["kkh", "-", "0"], ["kkh", "-", "0"]];
  const W = 300;
  const HINH: Array<[string, () => { x?: Record<string, unknown>; inner: WorkflowStep[]; sau?: WorkflowStep[] }, O[]]> = [
    ["PHANG", () => ({ inner: [delay("w", W), otStop("s")], sau: [otStop("s")] }), CHUAN],
    ["SEQ", () => ({ inner: [box("b", [delay("w", W), otStop("s")])] }), CHUAN],
    ["SEQ-LONG", () => ({ inner: [box("b", [box("c", [delay("w", W), otStop("s")])])] }), CHUAN],
    ["SEQ-TRONG-PAR", () => ({ inner: [par("b", [box("c", [delay("w", W), otStop("s")])])] }), CHUAN],
    ["BRANCH-TRAN", () => ({ inner: [brn("b", [delay("w", W), otStop("s")])] }), CHUAN],
    ["BRANCH-TRONG-SEQ", () => ({ inner: [box("a", [brn("b", [delay("w", W), otStop("s")])])] }), CHUAN],
    ["BRANCH-CHUA-CHON", () => ({ inner: [delay("w", W), brn("b", [otStop("s")])], sau: [brn("b", [otStop("s")])] }), CHUA_CHON],
    ["BU-TRU-LENH", () => ({ x: { compensation: otStop("s") }, inner: [delay("w", W)] }), CHUAN],
    ["BU-TRU-TRONG-HOP", () => ({ inner: [box("b", [move("y", { compensation: otStop("s") }), delay("w", W)])] }), BU_TRU_XA],
    ["BU-TRU-CUA-HOP", () => ({ inner: [box("b", [delay("w", W)], { compensation: otStop("s") })] }), BU_TRU_XA],
  ];
  const tiem = (loi: string) => {
    if (loi === "TU-CHOI") h.tuChoi.set("s", REF);
    else {
      h.classifyLoi = true; // the verifier's pin read throws: s is unsure
      h.dispatcherThat = true;
      h.dispatcherKhongDoc = true; // the dispatcher cannot read the pins either
    }
  };
  const go = () => {
    h.tuChoi.clear();
    h.classifyLoi = false;
    h.dispatcherKhongDoc = false;
  };
  const dung = async (cot: string, ten: string, cay: (typeof HINH)[number][1], loi: string, ref: string) => {
    const { x, inner, sau } = cay();
    if (cot === "CHUA") {
      const { c, di } = await moDi(def(ref, [gate(), move("x", x ?? {}), ...inner]));
      await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
      await wait(20);
      ve0();
      tiem(loi);
      const a = await abortRun(c, OWNER, "first");
      await di;
      await wait(40);
      return { c, a };
    }
    if (cot === "KHOA-SAU") {
      h.timeoutDispatch.add("x");
      h.slow.set("x", 120);
      const { c, di } = await moDi(def(ref, sau ? [gate(), move("x", x ?? {}), ...sau] : [gate(), par("root", [move("x", x ?? {}), ...inner])]));
      await waitFor(() => (sau ? h.sent.some((r) => r.stepId === "x") : stepRows(c).some((r) => r.stepId === "w")), "at the delay");
      await wait(10);
      ve0();
      tiem(loi);
      const a = await abortRun(c, OWNER, "first");
      await di;
      await wait(60);
      h.timeoutDispatch.clear();
      return { c, a };
    }
    if (cot === "KHOA-TRUOC") {
      h.timeoutDispatch.add("x");
      h.slow.set("x", 40);
      tiem(loi);
      h.classifyLoi = false;
      const { c, di } = await moDi(def(ref, sau ? [gate(), par("root", [move("x", x ?? {}), delay("w", W)]), ...sau] : [gate(), par("root", [move("x", x ?? {}), ...inner])]));
      await waitFor(() => stepRows(c).some((r) => r.stepId === "w") && h.traTimeout > 0, "at the delay");
      await wait(30);
      ve0();
      tiem(loi);
      const a = await abortRun(c, OWNER, "first");
      await di;
      await wait(60);
      h.timeoutDispatch.clear();
      return { c, a };
    }
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.alertDurable = false;
    const { c, di } = await moDi(def(ref, sau ? [gate(), par("root", [move("x", x ?? {}), delay("w", 60)]), ...sau] : [gate(), par("root", [move("x", x ?? {}), ...inner])]));
    await di;
    await waitFor(() => !["queued", "running", "compensating"].includes(runRow(c).status), "the end of the walk");
    await wait(40);
    expect(runRow(c).status, "latched, no durable URGENT: held").toBe("held");
    h.alertDurable = true;
    h.timeoutDispatch.clear();
    ve0();
    tiem(loi);
    const a = await abortRun(c, OWNER, "first");
    await wait(60);
    return { c, a };
  };
  for (const [ten, cay, oCua] of HINH) {
    COT.forEach((cotLoi, i) => {
      const loi = cotLoi.endsWith("TU-CHOI") ? "TU-CHOI" : "DOC-LOI";
      const cot = cotLoi.slice(0, -loi.length - 1);
      it(`T7B1D-BANG ${cotLoi} ${ten}`, async () => {
        const [dau, urg, lai] = oCua[i]!;
        const { c, a } = await dung(cot, ten, cay, loi, `b${i}${ten}`.replace(/-/g, ""));
        const st = a.abortStops!;
        // the evidence, first: what the injection did to s at this Abort
        if (dau === "s") {
          expect(st.failed, "refused").toContain("s");
          expect(hang(c, "abort:s")?.status).toBe("failed");
          expect(pdu("s").length).toBe(1);
        }
        if (dau === "s0") {
          expect(st.failed, "marked route, no PDU").toContain("s");
          expect(ids()).toContain("s");
          expect(pdu("s")).toEqual([]);
        }
        if (dau === "unv") {
          expect(st.unverified).toContain("s");
          expect(ids()).not.toContain("s");
        }
        if (dau === "lst") {
          expect(st.untakenBranch).toContain("s");
          expect(ids()).not.toContain("s");
        }
        if (dau === "kkh") {
          expect([...st.sent, ...st.failed, ...st.pending, ...st.unverified], "not in the plan").not.toContain("s");
          expect(ids()).not.toContain("s");
        }
        expect(ids().filter((x) => x !== "s"), "no other command").toEqual([]);
        // the URGENT
        const tenLoai = veBuoc("s").map((x) => x.kind);
        if (urg === "U" || urg === "Uv") {
          expect(tenLoai).toContain(CANH_BAO_KHONG_RO_KIND.abortStopNotSent);
          const chu = veBuoc("s").filter((x) => x.kind === CANH_BAO_KHONG_RO_KIND.abortStopNotSent).map((x) => `${x.title} ${x.message}`).join(" | ");
          expect(chu).toMatch(/press Abort again/);
          expect(chu).toMatch(/no time limit/);
          if (urg === "Uv") {
            expect(chu).toMatch(/could not verify/);
            expect(chu).toMatch(/did NOT send/);
            expect(chu).toMatch(/finds no pinned STOP, nothing is sent/);
            expect(chu).not.toMatch(/refused or got no answer/);
          } else expect(chu).not.toMatch(/could not verify/);
        }
        if (urg === "H13") {
          expect(tenLoai).toContain(CANH_BAO_KHONG_RO_KIND.stopUntakenBranch);
          expect(tenLoai).not.toContain(CANH_BAO_KHONG_RO_KIND.abortStopNotSent);
        }
        if (urg === "-") {
          expect(tenLoai, "not a word of s").toEqual([]);
          expect(urgentCua("abortStopNotSent")).toEqual([]);
        }
        if (cot === "CHUA") {
          expect(runDaChot(c)).toBe(false);
          expect(no(c), "H23: a run not latched owes nothing").toEqual([]);
        }
        // the press, the fault gone
        go();
        const a2 = await bam(c);
        if (lai === "s") {
          expect(pdu("s").length, `pressed: ${JSON.stringify(a2.abortStops)} ${a2.message}`).toBe(1);
          expect(hang(c, "abort:s")?.status).toBe("completed");
          expect(no(c)).not.toContain("s");
        } else {
          expect(ids(), "this press sends nothing").toEqual([]);
          if (urg === "H13" || dau === "lst") {
            expect(a2.message, "never beside a branch never evaluated").not.toMatch(/owes no STOP/);
            expect(a2.message).toMatch(/never evaluated/);
          }
        }
        expect(ids().filter((x) => x !== "s"), "no other command").toEqual([]);
      }, 20_000);
    });
  }

  it("T7B1D-BR-CHOT a branch that completed before the latch, its STOP handed over and never confirmed, the run held: G: the first Abort goes into it and sends it", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 80);
    h.alertDurable = false;
    const { c, di } = await moDi(def("d1dbr", [gate(), par("root", [move("x"), brn("b", [otStop("s")])])]));
    await di;
    await waitFor(() => !["queued", "running", "compensating"].includes(runRow(c).status), "the end of the walk");
    await wait(40);
    h.alertDurable = true;
    h.timeoutDispatch.clear();
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "b")?.status, "settled: the row a sequence reads the same").toBe("completed");
    const a = await bam(c);
    expect(a.abortStops?.phanLoai?.s?.lop).toBe("daGiao");
    expect(a.abortStops?.sent).toEqual(["s"]);
    expect(ids()).toEqual(["s"]);
  });

  // ── the cases apart ─────────────────────────────────────────────────────────────────────────────────────────────────
  it("T7B1D-THU-LAI flat: the walker refused it, in its back-off when the Abort falls, refused again: a press sends it, once", async () => {
    h.tuChoi.set("s", REF);
    const { c, di } = await moDi(def("d1dtl", [gate(), move("x"), otStop("s")]));
    await waitFor(() => h.sent.some((x) => x.stepId === "s"), "s tried once");
    await wait(5);
    ve0();
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(a.abortStops?.failed).toEqual(["s"]);
    expect(hang(c, "s")?.status).toBe("failed");
    expect(hang(c, "abort:s")?.status).toBe("failed");
    h.tuChoi.clear();
    const a2 = await bam(c);
    expect(pdu("s").length, String(a2.message)).toBe(1);
    expect(ids()).toEqual(["s"]);
    expect(a2.message).toMatch(/sent again/);
    expect(a2.abortStops?.phanLoai?.s?.lop, "one definition: the Abort's own trace").toBe("no");
    expect(/-abort-/.test(String(h.sent[0]?.key)), "a new key per sweep").toBe(true);
    expect((await bam(c, "third")).message).toMatch(/this press sent no STOP step/);
    expect(ids(), "once").toEqual([]);
  });
  it("T7B1D-HUY-S flat: the walker stood in its pin read, the flag cancelled it, the sweep refused: a press sends it", async () => {
    let tha: () => void = () => undefined;
    const cho = new Promise<void>((ok) => (tha = ok));
    h.slow.set("x", 50);
    const { c, di } = await moDi(def("d1dhuy", [gate(), move("x"), otStop("s")]));
    await waitFor(() => h.sent.some((x) => x.stepId === "x"), "x");
    const lan0 = h.ghimLan.length;
    h.ghim = (d, i) => cho.then(() => PIN_OK(d, i));
    await waitFor(() => hang(c, "s")?.status === "running" && h.ghimLan.length > lan0, "s in its pin read", 4000);
    ve0();
    h.tuChoi.set("s", REF);
    const p = abortRun(c, OWNER, "first");
    await wait(5);
    tha();
    h.ghim = PIN_OK;
    const a = await p;
    await di;
    await wait(40);
    expect(a.abortStops?.failed).toEqual(["s"]);
    expect(hang(c, "abort:s")?.status).toBe("failed");
    h.tuChoi.clear();
    await bam(c);
    expect(pdu("s").length).toBe(1);
    expect(ids()).toEqual(["s"]);
  });
  it("T7B1D-ROBOT a robot STOP in a container, refused: a press sends it", async () => {
    const { c, di } = await moDi(def("d1drb", [gate(), move("x"), box("b", [delay("w", 300), robotStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.tuChoi.set("s", REF);
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(a.abortStops?.failed).toEqual(["s"]);
    expect(hang(c, "b")?.status).toBe("failed");
    h.tuChoi.clear();
    await bam(c);
    expect(pdu("s").map((x) => x.kind)).toEqual(["robot"]);
    expect(ids()).toEqual(["s"]);
  });
  it("T7B1D-MOT-PHAN two STOPs in a container, s1 went, s2 refused: a press sends s2, s1 not again", async () => {
    const { c, di } = await moDi(def("d1dmp", [gate(), move("x"), box("b", [delay("w", 300), otStop("s1"), otStop("s2")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.tuChoi.set("s2", REF);
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(a.abortStops?.sent).toEqual(["s1"]);
    expect(a.abortStops?.failed).toEqual(["s2"]);
    h.tuChoi.clear();
    await bam(c);
    expect(ids()).toEqual(["s2"]);
    expect(hang(c, "abort:s1")?.status).toBe("completed");
    expect(hang(c, "abort:s2")?.status).toBe("completed");
  });
  const btSau = async (ref: string) => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 120);
    const { c, di } = await moDi(def(ref, [gate(), par("root", [move("x"), box("b", [move("y", { compensation: otStop("s") }), delay("w", 300)])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.tuChoi.set("s", REF);
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(60);
    h.timeoutDispatch.clear();
    h.tuChoi.clear();
    expect(a.abortStops?.failed).toEqual(["s"]);
    expect(runDaChot(c), "the latch fell after the sweep").toBe(true);
    return c;
  };
  for (const ngoai of [false, true]) {
    it(`T7B1D-BT-SAU a compensation not due, refused, the latch after the sweep: the URGENT's 'no time limit' is true ${ngoai ? "past" : "in"} the window`, async () => {
      const c = await btSau(`d1dbs${ngoai ? "n" : "t"}`);
      expect(no(c)).toEqual(["s"]);
      expect(chuCua("abortStopNotSent")).toMatch(/no time limit/);
      if (ngoai) quaCuaSo(c);
      const a2 = await bam(c);
      expect(pdu("s").length, String(a2.message)).toBe(1);
      expect(ids()).toEqual(["s"]);
      expect(/-abort-/.test(String(h.sent[0]?.key))).toBe(true);
      expect(no(c)).toEqual([]);
      expect(a2.message).toMatch(/sent again: s/);
      expect(a2.message).not.toMatch(/nothing was sent for them/);
    });
  }
  for (const [loi, ten] of [["TU-CHOI", "refused"], ["DOC-LOI", "not verified"]] as const) {
    for (const ngoai of [false, true]) {
      it(`T7B1D-BT-SAU-MAT-HANG a run that latches is outside H27: a compensation not due, ${ten}, its abort: row lost, the latch after the sweep: the debt the walk's memory saved: it goes ${ngoai ? "past" : "in"} the window`, async () => {
        h.timeoutDispatch.add("x");
        h.slow.set("x", 120);
        const { c, di } = await moDi(def(`d1dbm${loi === "TU-CHOI" ? "t" : "d"}${ngoai ? "n" : "c"}`, [gate(), par("root", [move("x"), box("b", [move("y", { compensation: otStop("s") }), delay("w", 300)])])]));
        await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
        await wait(10);
        ve0();
        if (loi === "TU-CHOI") h.tuChoi.set("s", REF);
        else h.classifyLoi = true;
        h.hangNem = (r) => r.stepId === "abort:s";
        await abortRun(c, OWNER, "first");
        h.classifyLoi = false;
        await di;
        await wait(60);
        expect(h.hangNemLan, "the injection reached the row").toBeGreaterThan(0);
        h.hangNem = null;
        h.tuChoi.clear();
        h.timeoutDispatch.clear();
        expect(hang(c, "abort:s"), "lost").toBeUndefined();
        expect(runDaChot(c)).toBe(true);
        expect(no(c), "the context holds it").toEqual(["s"]);
        expect(chuCua("abortStopNotSent")).toMatch(/no time limit/);
        if (ngoai) quaCuaSo(c);
        const a2 = await bam(c);
        expect(pdu("s").length, `what the URGENT promised: ${String(a2.message)}`).toBe(1);
        expect(ids()).toEqual(["s"]);
        expect(no(c)).toEqual([]);
      });
    }
  }
  // H28: a latched run, the debt durable nowhere: the words of what is known. Measured on 498dbba83 (T7b-1d\ra.md part 2): "within 15 minutes", 0 commands, "owes no STOP"
  const haiLoi = async (ref: string, cay: WorkflowStep, loi: "TU-CHOI" | "UNV" | "PENDING") => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 120);
    const { c, di } = await moDi(def(ref, [gate(), par("root", [move("x"), cay])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    if (loi === "TU-CHOI") h.tuChoi.set("s", REF);
    if (loi === "UNV") h.classifyLoi = true;
    if (loi === "PENDING") h.khongTraLoi.add("s");
    h.hangNem = (r) => r.stepId === "abort:s";
    const nem = () => {
      queueMicrotask(() => (h.ctxNem = nem));
      return true;
    };
    h.ctxNem = nem;
    await abortRun(c, OWNER, "first");
    h.classifyLoi = false;
    await di.catch(() => undefined);
    await wait(300);
    expect(h.ctxNemLan, "the injection reached the context").toBeGreaterThan(0);
    h.hangNem = null;
    h.ctxNem = null;
    h.tuChoi.clear();
    h.khongTraLoi.clear();
    h.timeoutDispatch.clear();
    expect(runDaChot(c)).toBe(true);
    expect(no(c), "nothing durable holds it").toEqual([]);
    const chu = veBuoc("s").filter((x) => x.kind === CANH_BAO_KHONG_RO_KIND.abortStopNotSent).map((x) => `${x.title} ${x.message}`).join(" | ");
    expect(chu, "the URGENT names s").toMatch(/"s"/);
    expect(chu).toMatch(/could not be recorded/);
    expect(chu, "a press may send it").toMatch(/may send it/);
    expect(chu).toMatch(/may not reach it/);
    expect(chu).toMatch(/check the machine on site/);
    expect(chu).not.toMatch(/within 15 minutes|no time limit|\d+ minutes/);
    return c;
  };
  for (const loi of ["TU-CHOI", "UNV", "PENDING"] as const) {
    it(`T7B1D-H28-HAI-LOI ${loi}: a compensation not due, its row and the context lost: no promise; the press sends nothing and does not say nothing is owed: only that the records hold none`, async () => {
      const c = await haiLoi(`d1dh28${loi}`.replace(/-/g, ""), box("b", [move("y", { compensation: otStop("s") }), delay("w", 300)]), loi);
      const a2 = await bam(c);
      expect(ids()).toEqual([]);
      expect(a2.message).not.toMatch(/owes no STOP/);
      expect(a2.message).toMatch(/records hold no STOP step owed/);
      expect(a2.message).toMatch(/Check the machine on site/);
    }, 15_000);
    it(`T7B1D-H28-HAI-LOI ${loi} the control: s in the container's body: the same words: a press does send it`, async () => {
      const c = await haiLoi(`d1dh28t${loi}`.replace(/-/g, ""), box("b", [delay("w", 300), otStop("s")]), loi);
      await bam(c);
      expect(ids()).toEqual(["s"]);
      expect(pdu("s").length).toBe(1);
    }, 15_000);
  }
  const ksUnv = async (ref: string, truocAbort?: () => void) => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 120);
    const { c, di } = await moDi(def(ref, [gate(), par("root", [move("x"), box("b", [delay("w", 300), otStop("s")])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.classifyLoi = true;
    truocAbort?.();
    const a = await abortRun(c, OWNER, "first");
    h.classifyLoi = false;
    await di.catch((e: unknown) => {
      if (!truocAbort) throw e; // the context write thrown on purpose reaches the walk's exception path
    });
    await wait(60);
    h.timeoutDispatch.clear();
    expect(a.abortStops?.unverified).toEqual(["s"]);
    expect(ids()).toEqual([]);
    return c;
  };
  for (const ngoai of [false, true]) {
    it(`T7B1D-KS-UNV not verified, the latch after the sweep: an URGENT names s in the true words; it goes ${ngoai ? "past" : "in"} the window`, async () => {
      const c = await ksUnv(`d1dku${ngoai ? "n" : "t"}`);
      expect(no(c)).toEqual(["s"]);
      const chu = chuCua("abortStopNotSent");
      expect(veBuoc("s").map((x) => x.kind)).toEqual([CANH_BAO_KHONG_RO_KIND.abortStopNotSent]);
      expect(chu).toMatch(/could not verify/);
      expect(chu).toMatch(/did NOT send/);
      expect(chu).toMatch(/press Abort again/);
      expect(chu).toMatch(/no time limit/);
      expect(chu).toMatch(/finds no pinned STOP, nothing is sent/);
      if (ngoai) quaCuaSo(c);
      await bam(c);
      expect(pdu("s").length).toBe(1);
      expect(ids()).toEqual(["s"]);
      expect(no(c)).toEqual([]);
    });
  }
  it("T7B1D-KS-UNV the read back answers: no pinned STOP: it does not go, nothing is owed any more", async () => {
    const c = await ksUnv("d1dkup");
    expect(no(c)).toEqual(["s"]);
    ghimHalt(false);
    h.ghim = KHONG_GHIM;
    const a = await bam(c);
    expect(ids(), "the trace sends no STOP that is none").toEqual([]);
    expect(a.abortStops?.notPinned).toEqual(["s"]);
    expect(no(c)).toEqual([]);
    expect(hang(c, "abort:s")?.status).toBe("skipped");
    expect(a.message).toMatch(/no pinned STOP/);
  });
  it("T7B1D-KS-UNV the read still lost on a latched run: the marked route as ever: 0 PDU when the dispatcher cannot read either; still owed", async () => {
    const c = await ksUnv("d1dkuv");
    h.classifyLoi = true;
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true;
    const a = await bam(c);
    h.classifyLoi = false;
    h.dispatcherKhongDoc = false;
    expect(ids()).toEqual(["s"]);
    expect(pdu("s")).toEqual([]);
    expect(a.abortStops?.failed).toEqual(["s"]);
    expect(no(c)).toEqual(["s"]);
    const chu = chuCua("abortStopNotSent");
    expect(chu, "this press handed it over").toMatch(/refused or got no answer/);
    expect(chu).not.toMatch(/could not verify/);
  });
  it("T7B1D-KS-UNV a trace lost with everything else: the words promise no more than the window", async () => {
    const nem = () => {
      queueMicrotask(() => (h.ctxNem = nem));
      return true;
    };
    const c = await ksUnv("d1dkum", () => {
      h.hangNem = (r) => r.stepId === "abort:s";
      h.ctxNem = nem;
    });
    expect(h.ctxNemLan, "the injection reached the context").toBeGreaterThan(0);
    h.hangNem = null;
    h.ctxNem = null;
    expect(chuCua("abortStopNotSent")).toMatch(/could not verify/);
    expect(chuCua("abortStopNotSent")).toMatch(/may not reach it/); // H28, dieu-phoi 09/11: was /within 15 minutes/
    expect(chuCua("abortStopNotSent")).not.toMatch(/no time limit/);
  });
  it("T7B1D-CHUA-DOC-LAI a run not latched, not verified: a press whose read answers 'no pinned STOP' sends nothing, the trace goes; a read still lost sends nothing, the trace stays", async () => {
    const { c, di } = await moDi(def("d1dcd", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.classifyLoi = true;
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(a.abortStops?.unverified).toEqual(["s"]);
    expect(hang(c, "abort:s")?.status, "a trace").toBe("failed");
    expect(no(c), "no debt").toEqual([]);
    expect(h.alerts.map((a) => a.kind), "H23: no URGENT").toEqual([]);
    const a1 = await bam(c, "still lost");
    expect(ids()).toEqual([]);
    expect(a1.abortStops?.unverified).toEqual(["s"]);
    expect(a1.message).toMatch(/ould not be verified/);
    expect(hang(c, "abort:s")?.status).toBe("failed");
    h.classifyLoi = false;
    ghimHalt(false);
    h.ghim = KHONG_GHIM;
    const a2 = await bam(c, "read: none");
    expect(ids()).toEqual([]);
    expect(a2.abortStops?.notPinned).toEqual(["s"]);
    expect(hang(c, "abort:s")?.status, "the trace removed").toBe("skipped");
    expect(a2.message).not.toMatch(/owes no STOP|has stopped|machine is stopped/);
    expect(a2.message).toMatch(/no pinned STOP/);
    ghimHalt(true);
    h.ghim = PIN_OK;
    const a3 = await bam(c, "after");
    expect(ids(), "H31: pinned again, pressed in the window: it goes").toEqual(["s"]);
    expect(pdu("s").length).toBe(1);
    expect(a3.ok).toBe(true);
  });
  it("T7B1D-CHUA-DOC-LAI flat: H31: the trace removed (read: no pinned STOP), pinned again, pressed in the window: s goes; the press that read none says nothing of a stopped machine", async () => {
    const { c, di } = await moDi(def("d1dcp", [gate(), move("x"), delay("w", 300), otStop("s")]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.classifyLoi = true;
    await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    h.classifyLoi = false;
    expect(hang(c, "abort:s")?.status, "a trace").toBe("failed");
    ghimHalt(false);
    h.ghim = KHONG_GHIM;
    const a1 = await bam(c, "read: none");
    expect(hang(c, "abort:s")?.status).toBe("skipped");
    expect(ids()).toEqual([]);
    expect(a1.message).not.toMatch(/owes no STOP|has stopped|machine is stopped/);
    ghimHalt(true);
    h.ghim = PIN_OK;
    const a = await bam(c, "after");
    expect(a.abortStops?.phanLoai?.s?.lop).toBe("chuaGiao");
    expect(ids(), "H31").toEqual(["s"]);
    expect(pdu("s").length).toBe(1);
    expect(hang(c, "abort:s")?.status).toBe("completed");
  });
  it("T7B1D-CHUA-KHONG-CO-ADAPTER a run not latched, the verifier reads 'not pinned' because nothing could be read: a trace, not an answer; a press whose read answers sends it", async () => {
    const { c, di } = await moDi(def("d1dca", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    ghimHalt(false);
    h.ghim = PIN_BAD;
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(a.abortStops?.notPinned).toEqual(["s"]);
    expect(hang(c, "abort:s")?.status, "unread is no answer: a trace").toBe("failed");
    const a1 = await bam(c, "still unread");
    expect(ids()).toEqual([]);
    expect(hang(c, "abort:s")?.status, "the trace stays").toBe("failed");
    expect(a1.abortStops?.unverified).toEqual(["s"]);
    ghimHalt(true);
    h.ghim = PIN_OK;
    await bam(c, "read");
    expect(pdu("s").length).toBe(1);
    expect(ids()).toEqual(["s"]);
  });
  it("T7B1D-CHUA-DOC-KHONG-GHIM H31: a run not latched, read and not pinned at the Abort: no trace (only what could not be verified); a person pins it, presses in the window: it goes; left unpinned: it does not", async () => {
    const { c, di } = await moDi(def("d1dcn", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    ghimHalt(false);
    h.ghim = KHONG_GHIM;
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(a.abortStops?.notPinned).toEqual(["s"]);
    expect(hang(c, "abort:s"), "no trace").toBeUndefined();
    const a1 = await bam(c, "still not pinned");
    expect(ids(), "never a step read as no pinned STOP").toEqual([]);
    expect(a1.abortStops?.notPinned).toEqual(["s"]);
    ghimHalt(true);
    h.ghim = PIN_OK;
    await bam(c);
    expect(ids(), "H31").toEqual(["s"]);
    expect(pdu("s").length).toBe(1);
  });
  it("T7B1D-UNV-KHONG-LA-STOP a non-STOP in the sweep's unverified on a run not latched: no trace, no debt when it latches later", async () => {
    const c = await centralRun(def("d1dun", [gate("g0"), ot("x"), gate("g1"), move("m9"), otStop("s2")]), 1);
    await wait(30);
    fake.store.set("machines", rows("machines").filter((m) => m.id !== 2));
    const a = await bam(c);
    expect(a.abortStops?.unverified).toContain("m9");
    expect(hang(c, "abort:m9"), "no row").toBeUndefined();
    const ctx = ctxCua(c);
    ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] = { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: new Date().toISOString() };
    runRow(c).contextJson = ctx;
    expect(no(c)).toEqual([]);
    h.traTimeout = 1;
    await bam(c, "again");
    expect(ids().filter((x) => x === "m9")).toEqual([]);
  });
  it("T7B1D-R6B a run that never acted, not verified: R-6-b stands: no trace, a press sends nothing", async () => {
    const { c, di } = await moDi(def("d1dr6", [gate(), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.classifyLoi = true;
    const a = await abortRun(c, OWNER, "first");
    h.classifyLoi = false;
    await di;
    await wait(40);
    expect(a.abortStops?.unverified).toEqual(["s"]);
    expect(hang(c, "abort:s"), "no trace").toBeUndefined();
    await bam(c);
    expect(ids()).toEqual([]);
  });
  for (const nhip of ["song", "xong"] as const) {
    it(`T7B1D-WALKER-SONG-XONG the same input, pressed while the walker ${nhip === "song" ? "lives" : "has ended"}: the same command`, async () => {
      h.slow.set("x", 200);
      const { c, di } = await moDi(def(`d1dw${nhip}`, [gate(), par("root", [move("x"), box("b", [delay("w", 300), otStop("s")])])]));
      await waitFor(() => stepRows(c).some((r) => r.stepId === "w") && h.sent.some((x) => x.stepId === "x"), "at the delay");
      await wait(10);
      ve0();
      h.tuChoi.set("s", REF);
      const a = await abortRun(c, OWNER, "first");
      expect(a.abortStops?.failed).toEqual(["s"]);
      h.tuChoi.clear();
      if (nhip === "xong") {
        await di;
        await wait(40);
        expect(hang(c, "b")?.status).toBe("failed");
      }
      await bam(c);
      expect(ids()).toEqual(["s"]);
      expect(pdu("s").length).toBe(1);
      await di;
    });
  }
  it("T7B1D-CUA-SO a run not latched, past the window: resendTooOld, no command: the limit that stands", async () => {
    const { c, di } = await moDi(def("d1dcs", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.tuChoi.set("s", REF);
    await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    h.tuChoi.clear();
    expect(hang(c, "abort:s")?.status).toBe("failed");
    quaCuaSo(c);
    const a = await bam(c);
    expect(a.reason).toBe("resendTooOld");
    expect(ids()).toEqual([]);
  });
  it("T7B1D-PENDING-KHONG-TRA-LOI a run not latched, the dispatcher never answers: a trace of class coTheDaRa: a press within the window sends it under the attempt's key, in words that say it may have gone", async () => {
    const { c, di } = await moDi(def("d1dpk", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.khongTraLoi.add("s");
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    h.khongTraLoi.clear();
    expect(a.abortStops?.pending).toEqual(["s"]);
    expect(ids()).toEqual(["s"]);
    expect(hang(c, "abort:s")?.status, "a trace").toBe("failed");
    expect(no(c), "no debt").toEqual([]);
    expect(h.alerts.map((a) => a.kind), "H23").toEqual([]);
    const a2 = await bam(c);
    expect(a2.abortStops?.phanLoai?.s?.lop).toBe("coTheDaRa");
    expect(h.sent.map((x) => x.key)).toEqual([`run${c}-s-a1`]);
    expect(a2.message).toMatch(/under the key of attempt 1/);
    expect(a2.message).not.toMatch(/were sent again/);
    expect(hang(c, "abort:s")?.status).toBe("completed");
  });
  it("T7B1D-PENDING-KHONG-TRA-LOI past the window: resendTooOld, no command", async () => {
    const { c, di } = await moDi(def("d1dpn", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.khongTraLoi.add("s");
    await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    h.khongTraLoi.clear();
    quaCuaSo(c);
    const a = await bam(c);
    expect(a.reason).toBe("resendTooOld");
    expect(ids()).toEqual([]);
  });
  it("T7B1D-PENDING-KHONG-TRA-LOI the answer lands late, ok: its row replaces the trace: a press sends nothing", async () => {
    const { c, di } = await moDi(def("d1dpl", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.slow.set("s", 1400);
    const a = await abortRun(c, OWNER, "first");
    await di;
    expect(a.abortStops?.pending).toEqual(["s"]);
    await waitFor(() => hang(c, "abort:s")?.status === "completed", "the late answer's row");
    h.slow.clear();
    await bam(c);
    expect(ids()).toEqual([]);
  }, 10_000);
  it("T7B1D-PENDING-KHONG-TRA-LOI the latch falls after: owed, told as what may have gone, never 'did NOT go out'", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 1300);
    const { c, di } = await moDi(def("d1dps", [gate(), par("root", [move("x"), box("b", [delay("w", 300), otStop("s")])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.khongTraLoi.add("s");
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(60);
    h.khongTraLoi.clear();
    h.timeoutDispatch.clear();
    expect(a.abortStops?.pending).toEqual(["s"]);
    expect(runDaChot(c)).toBe(true);
    expect(no(c)).toEqual(["s"]);
    const chu = chuCua("abortStopNotSent");
    expect(chu).toMatch(/may have gone out/);
    expect(chu).not.toMatch(/did NOT go out/);
    expect(chu, "the code of what it read: no answer").toMatch(/NO_ANSWER/);
    quaCuaSo(c);
    await bam(c);
    expect(ids()).toEqual(["s"]);
  }, 10_000);
  // H30 (chu du an 09/11), in place of H27 on these shapes: a run not latched, the one write of the Abort's trace lost, the walker's cancel over the STOP: a step cancelled by an Abort is no last word. The first answer still names it: at that moment nothing durable says it was tried
  for (const hinh of ["hop", "phang"] as const) {
    it(`T7B1D-MAT-HANG-ABORT-CHUA-KHOA H30, ${hinh}: refused, the abort: row lost, the walker wrote its cancel and ended: the first answer names s, promises nothing; a press sends s, once`, async () => {
      if (hinh === "phang") h.tuChoi.set("s", REF);
      const { c, di } = await moDi(def(`d1dmh${hinh}`, hinh === "hop" ? [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])] : [gate(), move("x"), otStop("s")]));
      if (hinh === "hop") await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
      else await waitFor(() => h.sent.some((x) => x.stepId === "s"), "s tried once, in its back-off");
      await wait(hinh === "hop" ? 20 : 5);
      ve0();
      h.tuChoi.set("s", REF);
      h.hangNem = (r) => r.stepId === "abort:s";
      const a = await abortRun(c, OWNER, "first");
      await di;
      await wait(40);
      expect(h.hangNemLan, "the injection reached the row").toBeGreaterThan(0);
      h.hangNem = null;
      h.tuChoi.clear();
      expect(a.abortStops?.failed).toEqual(["s"]);
      expect(a.abortStops?.khongBen).toEqual(["s"]);
      expect(hang(c, "abort:s"), "lost").toBeUndefined();
      expect(hang(c, hinh === "hop" ? "b" : "s")?.error, "the walker's cancel").toBe("Run is aborting.");
      expect(a.message, "the first answer names the STOP").toMatch(/could not be recorded: s:/);
      expect(a.message, "H33: check the machine on site").toMatch(/could not be recorded: s:[^]*check the machine on site and use its direct STOP \/ E-STOP/);
      expect(a.message, "H33: no press promised").not.toMatch(/press Abort again|a later press (will )?sends?\b/);
      expect(a.message).toMatch(/may not reach/);
      expect(a.message).not.toMatch(/owed|press Abort again/);
      expect(no(c), "no debt").toEqual([]);
      expect(runDaChot(c)).toBe(false);
      expect(urgentCua("abortStopNotSent"), "H23").toEqual([]);
      await bam(c);
      expect(ids(), "H30").toEqual(["s"]);
      expect(pdu("s").length).toBe(1);
      expect(no(c)).toEqual([]);
      await bam(c, "again");
      expect(ids(), "once").toEqual([]);
    });
  }
  it("T7B1D-MAT-HANG-ABORT-CHUA-KHOA the walker never wrote over it (flat, not reached): the same definition reaches s: it goes; a press refused and its row lost again: named, no promise", async () => {
    const { c, di } = await moDi(def("d1dmht", [gate(), move("x"), delay("w", 300), otStop("s")]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.tuChoi.set("s", REF);
    h.hangNem = (r) => r.stepId === "abort:s";
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(a.abortStops?.khongBen).toEqual(["s"]);
    expect(hang(c, "abort:s")).toBeUndefined();
    const a1 = await bam(c, "refused, lost again");
    expect(ids(), "the planner reaches it").toEqual(["s"]);
    expect(a1.abortStops?.failed).toEqual(["s"]);
    expect(a1.message).toMatch(/could not be recorded: s:/);
    expect(a1.message, "H33: check the machine on site").toMatch(/could not be recorded: s:[^]*check the machine on site and use its direct STOP \/ E-STOP/);
    expect(a1.message, "H33: no press promised").not.toMatch(/press Abort again|a later press (will )?sends?\b/);
    expect(a1.message).not.toMatch(/stay owed|within 15 minutes/);
    h.hangNem = null;
    h.tuChoi.clear();
    await bam(c, "the fault gone");
    expect(pdu("s").length).toBe(1);
    expect(ids()).toEqual(["s"]);
  });
  it("T7B1D-MAT-HANG-ABORT-CHUA-KHOA a trace not verified, its row lost, a press whose read still fails: no promise of a later press", async () => {
    const { c, di } = await moDi(def("d1dmhu", [gate(), move("x"), delay("w", 300), otStop("s")]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.classifyLoi = true;
    h.hangNem = (r) => r.stepId === "abort:s";
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(a.abortStops?.unverified).toEqual(["s"]);
    expect(a.abortStops?.khongBen).toEqual(["s"]);
    expect(a.message).toMatch(/could not be recorded: s:/);
    expect(a.message, "H33: check the machine on site").toMatch(/could not be recorded: s:[^]*check the machine on site and use its direct STOP \/ E-STOP/);
    expect(a.message, "H33: no press promised").not.toMatch(/press Abort again|a later press (will )?sends?\b/);
    const a1 = await bam(c, "still lost");
    expect(a1.abortStops?.khongBen).toEqual(["s"]);
    expect(a1.message).not.toMatch(/sends it if its read finds/);
    h.classifyLoi = false;
    h.hangNem = null;
  });

  // ── H30: every shape measured again: which shape still sends nothing keeps H27, by its name ───────────────────────────────────────────────────────────────
  const HINH_H30: Array<[string, () => WorkflowStep[], "x" | "w"]> = [
    ["HOP", () => [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])], "w"],
    ["HOP-LONG", () => [gate(), move("x"), box("a", [box("b", [delay("w", 300), otStop("s")])])], "w"],
    ["SEQ-TRONG-PAR", () => [gate(), move("x"), par("a", [box("b", [delay("w", 300), otStop("s")])])], "w"],
    ["PAR-ANH-EM", () => [gate(), par("a", [move("x"), box("b", [delay("w", 300), otStop("s")])])], "w"],
    ["BRANCH-TRAN", () => [gate(), move("x"), brn("b", [delay("w", 300), otStop("s")])], "w"],
    ["BRANCH-TRONG-SEQ", () => [gate(), move("x"), box("a", [brn("b", [delay("w", 300), otStop("s")])])], "w"],
    ["BU-TRU-LENH", () => [gate(), move("x", { compensation: otStop("s") }), delay("w", 300)], "w"],
    ["BU-TRU-TRONG-HOP", () => [gate(), move("x"), box("b", [move("y", { compensation: otStop("s") }), delay("w", 300)])], "w"],
    ["BU-TRU-CUA-HOP", () => [gate(), move("x"), box("b", [delay("w", 300)], { compensation: otStop("s") })], "w"],
  ];
  for (const [ten, cay] of HINH_H30) {
    for (const loi of ["TU-CHOI", "UNV", "PENDING"] as const) {
      it(`T7B1D-H30-HINH ${ten} ${loi}: the abort: row lost, the walker's cancel over it: a press in the window sends s once; nothing else`, async () => {
        const { c, di } = await moDi(def(`d1dh30${ten}${loi}`.replace(/-/g, ""), cay()));
        await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
        await wait(20);
        ve0();
        if (loi === "TU-CHOI") h.tuChoi.set("s", REF);
        if (loi === "UNV") h.classifyLoi = true;
        if (loi === "PENDING") h.khongTraLoi.add("s");
        h.hangNem = (r) => r.stepId === "abort:s";
        await abortRun(c, OWNER, "first");
        h.classifyLoi = false;
        await di;
        await wait(40);
        h.hangNem = null;
        h.tuChoi.clear();
        h.khongTraLoi.clear();
        expect(hang(c, "abort:s"), "lost").toBeUndefined();
        expect(no(c)).toEqual([]);
        await bam(c);
        expect(ids(), "H30").toEqual(["s"]);
        expect(pdu("s").length).toBe(1);
      }, 15_000);
    }
  }
  it("T7B1D-H30-NGUON-EXEC the other source of the words: y answers ok after the Abort, the walk reaches its next step and execStep refuses it: the container carries the same constant: a press sends s", async () => {
    h.slow.set("y", 100);
    const { c, di } = await moDi(def("d1dhne", [gate(), move("x"), box("b", [move("y"), otStop("s")])]));
    await waitFor(() => h.sent.some((x) => x.stepId === "y"), "y handed over");
    await wait(15);
    ve0();
    h.tuChoi.set("s", REF);
    h.hangNem = (r) => r.stepId === "abort:s";
    await abortRun(c, OWNER, "first");
    await di;
    await wait(200);
    h.hangNem = null;
    h.tuChoi.clear();
    expect(hang(c, "y")?.status, "y's own answer").toBe("completed");
    expect(hang(c, "b")?.error).toBe("Run is aborting.");
    await bam(c);
    expect(ids()).toEqual(["s"]);
  });
  // H27 stands for this shape, measured after H30: the container ended in another step's own words, so it is no cancel; the Abort's row is all that said s was meant
  for (const mat of [true, false]) {
    it(`T7B1D-H27-Y-TU-HONG ${mat ? "gioi han da biet H27: the abort: row lost: the first answer names s, promises nothing; a press sends nothing" : "the row landed: the trace reaches s"}: y in flight at the Abort, its own failure lands after, the container carries its words`, async () => {
      h.slow.set("y", 100);
      h.failPlan.set("y", Infinity);
      const { c, di } = await moDi(def(`d1dh27${mat ? "m" : "g"}`, [gate(), move("x"), box("b", [move("y"), otStop("s")])]));
      await waitFor(() => h.sent.some((x) => x.stepId === "y"), "y handed over");
      await wait(15);
      ve0();
      h.tuChoi.set("s", REF);
      if (mat) h.hangNem = (r) => r.stepId === "abort:s";
      const a = await abortRun(c, OWNER, "first");
      await di;
      await wait(200);
      h.hangNem = null;
      h.tuChoi.clear();
      expect(a.abortStops?.failed).toEqual(["s"]);
      expect(hang(c, "b")?.error, "another step's own words: no cancel").toBe("scripted failure of y");
      expect(runDaChot(c)).toBe(false);
      expect(no(c)).toEqual([]);
      if (mat) {
        expect(a.abortStops?.khongBen).toEqual(["s"]);
        expect(a.message).toMatch(/could not be recorded: s:/);
        expect(a.message, "H33: check the machine on site").toMatch(/could not be recorded: s:[^]*check the machine on site and use its direct STOP \/ E-STOP/);
        expect(a.message, "H33: no press promised").not.toMatch(/press Abort again|a later press (will )?sends?\b/);
        expect(a.message).not.toMatch(/owed|press Abort again/);
      }
      const a2 = await bam(c);
      if (mat) {
        expect(ids(), "H27").toEqual([]);
        expect(a2.message).not.toMatch(/owed/);
      } else expect(ids()).toEqual(["s"]);
    });
  }
  // the process died: nothing of the walker is left, only what it wrote. Half of this is the fake: PostgreSQL is T15's
  const chup = (c: number) => ({ run: structuredClone({ ...runRow(c) }), hang: structuredClone(stepRows(c).map((r) => ({ ...r }))) as Row[] });
  const khoiPhuc = (c: number, a: ReturnType<typeof chup>) => {
    const ds = rows("orchestration_run_steps");
    for (let i = ds.length - 1; i >= 0; i--) if (ds[i].runId === c) ds.splice(i, 1);
    ds.push(...structuredClone(a.hang));
    Object.assign(runRow(c), structuredClone(a.run), { status: "aborted", finishedAt: new Date() });
  };
  for (const [ten, cay, idHong] of [["HOP", () => [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])], "b"], ["PHANG", () => [gate(), move("x"), otStop("s")], "s"]] as const) {
    for (const diem of ["WALKER-GHI-HUY", "TU-CHOI-CHUA-GHI-HANG"] as const) {
      it(`T7B1D-CHET-${ten} ${diem}: the process died there, 'aborted' written: nothing of the walker left: a press sends s, once`, async () => {
        if (ten === "PHANG") h.tuChoi.set("s", REF);
        const { c, di } = await moDi(def(`d1dct${ten}${diem}`.replace(/-/g, ""), cay() as WorkflowStep[]));
        if (ten === "PHANG") await waitFor(() => h.sent.some((x) => x.stepId === "s"), "s tried once");
        else await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
        await wait(10);
        h.tuChoi.set("s", REF);
        let anh: ReturnType<typeof chup> | null = null;
        h.hangNem = (v) => {
          if (anh) return false;
          if (diem === "WALKER-GHI-HUY" && v.stepId === idHong && v.status === "failed") {
            anh = chup(c);
            const r0 = anh.hang.find((x) => x.stepId === idHong);
            if (r0) Object.assign(r0, { status: "failed", error: "Run is aborting." });
          }
          if (diem === "TU-CHOI-CHUA-GHI-HANG" && v.stepId === "abort:s" && v.status === "failed") anh = chup(c);
          return false;
        };
        await abortRun(c, OWNER, "first");
        await di.catch(() => undefined);
        await wait(60);
        h.hangNem = null;
        h.tuChoi.clear();
        expect(anh, "the point of death was reached").not.toBeNull();
        khoiPhuc(c, anh!);
        expect(hang(c, "abort:s"), "nothing of the Abort's trace").toBeUndefined();
        await bam(c);
        expect(ids(), "H30").toEqual(["s"]);
        expect(pdu("s").length).toBe(1);
        await bam(c, "again");
        expect(ids(), "once").toEqual([]);
      }, 15_000);
    }
  }
  it("T7B1D-KHONG-LIVE-CHUA-ABORTED not covered, as decided: the rows of a walker elsewhere, the run still running here: the first Abort sends nothing and does not say no STOP is left; the press after it sends s", async () => {
    const c = await centralRun(def("d1dklc", [gate("g0"), move("x"), gate("g1"), box("b", [delay("w", 10), otStop("s")])]), 1);
    await wait(30);
    runRow(c).status = "running";
    rows("orchestration_run_steps").push({ id: 800_106, runId: c, attempt: 1, startedAt: new Date(), finishedAt: new Date(), stepId: "b", stepType: "sequence", status: "failed", error: "Run is aborting.", resultJson: null });
    const a1 = await bam(c, "first");
    expect(a1.resend).toBeUndefined();
    expect(ids(), "H30 is for a press").toEqual([]);
    expect(String(a1.message ?? "")).not.toMatch(/owes no STOP|no STOP step|no STOP left|nothing was sent/);
    await bam(c);
    expect(ids()).toEqual(["s"]);
    expect(pdu("s").length).toBe(1);
  });
  // the constant: only exactly that row, only failed
  const rowHuy = (c: number, them: Record<string, unknown>) => {
    runRow(c).status = "aborted";
    runRow(c).finishedAt = new Date();
    rows("orchestration_run_steps").push({ id: 800_100 + c, runId: c, stepId: "b", stepType: "sequence", status: "failed", attempt: 1, error: "Run is aborting.", startedAt: new Date(), finishedAt: new Date(), resultJson: null, ...them });
  };
  for (const [ten, them] of [
    ["COMPLETED", { status: "completed" }],
    ["RUNNING-XONG", { status: "compensated" }],
    ["CHU-KHAC-TU-HONG", { error: "scripted failure of y" }],
    ["CHU-KHAC-PRECONDITION", { error: 'Precondition failed for step "b" (abort).' }],
    ["CHU-KHAC-EDGE", { error: "Edge claim is no longer current — this walker let go of the run." }],
  ] as const) {
    it(`T7B1D-H30-CHI-DUNG-HANG ${ten}: not a row an Abort cancelled: a last word as before: a press sends nothing`, async () => {
      const c = await centralRun(def(`d1dhd${ten}`.replace(/-/g, ""), [gate("g0"), move("x"), gate("g1"), box("b", [delay("w", 10), otStop("s")])]), 1);
      await wait(30);
      rowHuy(c, them);
      await bam(c);
      expect(ids()).toEqual([]);
    });
  }
  it("T7B1D-H30-CHI-DUNG-HANG a row an Abort cancelled, nothing else about it: a press walks in, s goes (the control of the cases above)", async () => {
    const c = await centralRun(def("d1dhdk", [gate("g0"), move("x"), gate("g1"), box("b", [delay("w", 10), otStop("s")])]), 1);
    await wait(30);
    rowHuy(c, {});
    await bam(c);
    expect(ids()).toEqual(["s"]);
  });
  // the STOP's own row cancelled, by what else its row knows: the class decides, the pins decide
  for (const [ten, them, cho] of [
    ["DA-NHAN", { resultJson: { routedTo: "ot-dispatcher", accepted: true, status: "acked_unverified" } }, null],
    ["XAC-NHAN", { resultJson: { routedTo: "ot-dispatcher", accepted: true, status: "acked_verified" } }, null],
    ["TIMEOUT", { resultJson: { routedTo: "ot-dispatcher", accepted: false, status: "timeout" } }, "a1"],
    ["KHONG-KET-QUA", { resultJson: null }, "a1"],
    ["THU-3", { resultJson: null, attempt: 3 }, "a3"],
    ["TU-CHOI", { resultJson: { routedTo: "ot-dispatcher", accepted: false, status: "rejected" } }, "nonce"],
  ] as const) {
    for (const hinh of ["STOP", "NON-STOP", "KHONG-GHIM"] as const) {
      it(`T7B1D-H30-HANG-CUA-S ${ten} ${hinh}: s cancelled with this on its row: ${hinh === "STOP" ? String(cho ?? "not sent again") : "never sent"}`, async () => {
        const buoc = hinh === "STOP" ? otStop("s") : hinh === "NON-STOP" ? move("s") : stopTyped("s");
        const c = await centralRun(def(`d1dhc${ten}${hinh}`.replace(/-/g, ""), [gate("g0"), move("x"), gate("g1"), buoc]), 1);
        await wait(30);
        runRow(c).status = "aborted";
        runRow(c).finishedAt = new Date();
        rows("orchestration_run_steps").push({ id: 800_200 + c, runId: c, stepId: "s", stepType: "command", status: "failed", attempt: 1, error: "Run is aborting.", startedAt: new Date(), finishedAt: new Date(), ...them });
        await bam(c);
        if (hinh !== "STOP" || cho === null) expect(ids()).toEqual([]);
        else {
          expect(ids()).toEqual(["s"]);
          expect(String(h.sent[0]?.key)).toMatch(cho === "nonce" ? /-abort-/ : new RegExp(`-s-${cho}$`));
        }
      });
    }
  }
  it("T7B1D-KS-UNV-DOC-LAI H31: a latched run, the trace removed (read: no pinned STOP), pinned again: in the window it goes; the class is no debt: past the window resendTooOld", async () => {
    for (const ngoai of [false, true]) {
      const c = await ksUnv(`d1dkdl${ngoai ? "n" : "t"}`);
      ghimHalt(false);
      h.ghim = KHONG_GHIM;
      await bam(c, "read: none");
      expect(hang(c, "abort:s")?.status).toBe("skipped");
      expect(no(c)).toEqual([]);
      ghimHalt(true);
      h.ghim = PIN_OK;
      if (ngoai) quaCuaSo(c);
      const a = await bam(c, "after");
      if (ngoai) {
        expect(a.reason).toBe("resendTooOld");
        expect(ids()).toEqual([]);
      } else {
        expect(ids(), "H31").toEqual(["s"]);
        expect(pdu("s").length).toBe(1);
      }
    }
  }, 15_000);
  it("T7B1D-QUET-NEM-WALKER the sweep throws, a live walker, a run not latched: told to the one who pressed; the walker's cancel over the container is no last word: the press it promises sends s", async () => {
    const { c, di } = await moDi(def("d1dqw", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    const hong = { id: 800_300, runId: c, stepId: 5, stepType: "command", status: "failed", error: null, resultJson: null };
    rows("orchestration_run_steps").push(hong); // a row that breaks the read of the picture: the sweep throws
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    const ds = rows("orchestration_run_steps");
    ds.splice(ds.indexOf(hong), 1);
    expect(a.abortStops?.khongDocDuoc).toBe(true);
    expect(a.message).toMatch(/could not read the definition/);
    expect(a.message).toMatch(/may not reach it/); // H32, dieu-phoi 09/11: was /press Abort again within 15 minutes/
    expect(a.message).toMatch(/after 15 minutes none can be counted on/);
    expect(h.alerts.map((x) => x.kind), "H23").toEqual([]);
    expect(ids()).toEqual([]);
    expect(hang(c, "b")?.error).toBe("Run is aborting.");
    const a2 = await bam(c);
    expect(ids(), `what the answer promised: ${String(a2.message)}`).toEqual(["s"]);
    expect(pdu("s").length).toBe(1);
  });

  // ── P1 (T7b-1d\ra\p6): the choice of a branch lost, a STOP the Abort tried in it: "seen" must not stand between the trace and the verification ──────────
  it("T7B1D-BR-MAT the row and the context of the choice lost, the latch after the sweep, s refused: owed, the URGENT says no time limit: a press sends it, the debt goes, 'never evaluated' is not said of it; a STOP of a branch truly never evaluated, with no trace: still listed, still not sent", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 200);
    const { c, di } = await moDi(def("d1dbm", [gate(), par("root", [move("x"), box("a", [delay("w0", 60), brn("b", [delay("w", 300), otStop("s")]), brn("b2", [otStop("s3")])])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w0"), "w0");
    h.hangNem = (v) => v.stepId === "b";
    const nem = () => {
      queueMicrotask(() => (h.ctxNem = nem));
      return true;
    };
    h.ctxNem = nem;
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay", 1500);
    await wait(5);
    expect(hang(c, "b"), "the row of the choice lost").toBeUndefined();
    expect(ctxCua(c)["branch:b"], "the context of the choice lost").toBeUndefined();
    ve0();
    h.tuChoi.set("s", REF);
    const a = await abortRun(c, OWNER, "first");
    await di.catch(() => undefined);
    await wait(80);
    h.hangNem = null;
    h.ctxNem = null;
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    expect(a.abortStops?.failed).toEqual(["s"]);
    expect(runDaChot(c)).toBe(true);
    expect(hang(c, "abort:s")?.status).toBe("failed");
    expect(no(c)).toEqual(["s"]);
    expect(chuCua("abortStopNotSent")).toMatch(/no time limit/);
    const a2 = await bam(c);
    expect(pdu("s").length, String(a2.message)).toBe(1);
    expect(ids(), "s3 has no trace: no guess").toEqual(["s"]);
    expect(a2.abortStops?.untakenBranch).toEqual(["s3"]);
    expect(a2.message).toMatch(/never evaluated: s3/);
    expect(a2.message).not.toMatch(/never evaluated: s[,:. ]/);
    expect(no(c), "the debt goes once it went").toEqual([]);
    expect(veBuoc("s").map((x) => x.kind)).not.toContain(CANH_BAO_KHONG_RO_KIND.stopUntakenBranch);
  });
  // ── step 6: what the review's mutations found no case for ─────────────────────────────────────────────────────────────────────
  it("T7B1D-HAI-VET two compensations not due, both refused, the latch after the sweep: every trace enters the press's set, past the window too (only the traces reach them)", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 120);
    const { c, di } = await moDi(def("d1dhv", [gate(), par("root", [move("x"), box("b", [move("y", { compensation: otStop("s1") }), move("y2", { compensation: otStop("s2") }), delay("w", 300)])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.tuChoi.set("s1", REF);
    h.tuChoi.set("s2", REF);
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(60);
    h.tuChoi.clear();
    h.timeoutDispatch.clear();
    expect([...(a.abortStops?.failed ?? [])].sort()).toEqual(["s1", "s2"]);
    expect(no(c)).toEqual(["s1", "s2"]);
    quaCuaSo(c);
    await bam(c);
    expect(ids().sort(), "both").toEqual(["s1", "s2"]);
    expect(no(c)).toEqual([]);
  });
  it("T7B1D-KHONG-BEN-CHI-CHUA-KHOA khongBen is a run not latched's: a latched run's lost row is told by its URGENT, the answer does not carry the field", async () => {
    const c = await khoaChuaGiao("d1dkbk");
    h.tuChoi.set("s2", REF);
    h.hangNem = (v) => v.stepId === "abort:s2";
    const a = await bam(c);
    h.hangNem = null;
    h.tuChoi.clear();
    expect(a.abortStops?.failed).toEqual(["s2"]);
    expect(h.hangNemLan, "the injection reached the row").toBeGreaterThan(0);
    expect(a.abortStops?.khongBen, "not of a latched run").toBeUndefined();
  });
  // ── H29: a wait with no bound of its own on an Abort's road: every case at 1/20 of the bounds (h.heSoHan), so a hang costs no real seconds ─────────────────────
  const HAN_DO = 4000; // the case's own patience: past it the Abort "did not answer"
  const traLoi = async <T,>(p: Promise<T>) => {
    const t0 = Date.now();
    const kq = await Promise.race([p, wait(HAN_DO).then(() => null)]);
    return { kq, ms: Date.now() - t0 };
  };
  const moTha = () => {
    let tha: () => void = () => undefined;
    const cho = new Promise<void>((ok) => (tha = ok));
    return { cho, tha };
  };
  afterEach(() => {
    h.treoNap.clear();
    h.treoLaStop = null;
    h.treoVerifier = null;
  });
  for (const kieu of ["TREO", "TU-CHOI"] as const) {
    it(`T7B1D-TREO-DISPATCHER ${kieu} the dispatcher's module ${kieu === "TREO" ? "hangs" : "fails"} to load: a STOP stays a STOP: not verified, a trace, the Abort answers within its bound; a non-STOP has no trace and never goes; the fault gone a press sends the STOP only`, async () => {
      const { c, di } = await moDi(def(`d1dtd${kieu === "TREO" ? "t" : "c"}`, [gate(), ot("x"), box("b", [delay("w", 300), otStop("s"), ot("m")])]));
      await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
      await wait(10);
      ve0();
      h.heSoHan = 0.05;
      const n = moTha();
      if (kieu === "TREO") h.treoNap.set("commandDispatcher", n.cho);
      else h.napTuChoi.add("commandDispatcher");
      const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
      expect(a, "the Abort answered").not.toBeNull();
      await di;
      await wait(40);
      expect(a!.abortStops?.unverified, "not read is no 'no STOP'").toEqual(["s"]);
      expect(hang(c, "abort:s")?.status, "its trace").toBe("failed");
      expect(hang(c, "abort:m"), "a non-STOP: no trace").toBeUndefined();
      expect(ids()).toEqual([]);
      expect(no(c)).toEqual([]);
      n.tha();
      h.treoNap.clear();
      h.napTuChoi.clear();
      h.heSoHan = 0;
      await bam(c);
      expect(ids(), "the STOP, not x, not m").toEqual(["s"]);
    }, 15_000);
  }
  it("T7B1D-TREO-KHOA a latched run, the dispatcher's module hanging: the Abort answers; the robot STOP and the OT STOP on the marked route went; nothing else", async () => {
    const c = await khoaChuaGiao("d1dtk", [robotStop("rs"), ot("m")]);
    h.heSoHan = 0.05;
    const n = moTha();
    h.treoNap.set("commandDispatcher", n.cho);
    ve0();
    const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
    await wait(40);
    n.tha();
    expect(a, "the Abort answered").not.toBeNull();
    expect(ids().sort(), "both STOPs reached the dispatcher's door; no m").toEqual(["rs", "s2"]);
  }, 15_000);
  // the flag: one definition, read with no load behind it
  for (const robot of [false, true]) {
    it(`T7B1D-TREO-POLICY-TAT the flag off, the policy's module hanging: never loaded: the ${robot ? "robot" : "OT"} STOP goes at once`, async () => {
      const { c, di } = await moDi(def(`d1dtp${robot ? "r" : "o"}`, [gate(), ot("x"), delay("w", 300), robot ? robotStop("s") : otStop("s")]));
      await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
      await wait(10);
      ve0();
      const n = moTha();
      h.treoNap.set("policyGate", n.cho);
      h.napGoi.clear();
      const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
      n.tha();
      expect(a, "the Abort answered").not.toBeNull();
      await di;
      expect(a!.abortStops?.sent).toEqual(["s"]);
      expect(ids()).toEqual(["s"]);
      expect(h.napGoi.get("policyGate") ?? 0, "not loaded").toBe(0);
    }, 15_000);
  }
  for (const kieu of ["TREO", "TU-CHOI"] as const) {
    it(`T7B1D-TREO-WK-TAT ${kieu} the flag off, the policy's module ${kieu === "TREO" ? "hanging" : "failing"}: the walk never asks it: its commands and its STOP go, the run ends as it would`, async () => {
      const n = moTha();
      if (kieu === "TREO") h.treoNap.set("policyGate", n.cho);
      else h.napTuChoi.add("policyGate");
      h.napGoi.clear();
      const { c, di } = await moDi(def(`d1dtw${kieu === "TREO" ? "t" : "c"}`, [gate(), ot("x"), otStop("s")]));
      const { kq } = await traLoi(di.then(() => "xong"));
      n.tha();
      expect(kq, "the walk ended").toBe("xong");
      await wait(20);
      expect(ids()).toEqual(["x", "s"]);
      expect(runRow(c).status).toBe("completed");
      expect(h.napGoi.get("policyGate") ?? 0, "not loaded").toBe(0);
    }, 15_000);
  }
  for (const robot of [false, true]) {
    it(`T7B1D-TREO-POLICY-BAT the flag on, the policy's module hanging past its bound: the ${robot ? "robot" : "OT"} STOP is not sent around the gate: abort: failed with its reason, named; a press still hanging is bounded; the module back, a press sends it`, async () => {
      const { c, di } = await moDi(def(`d1dtb${robot ? "r" : "o"}`, [gate(), ot("x"), delay("w", 300), robot ? robotStop("s") : otStop("s")]));
      await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
      await wait(10);
      ve0();
      h.coBat = true;
      h.heSoHan = 0.05;
      const n = moTha();
      h.treoNap.set("policyGate", n.cho);
      const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
      expect(a, "the Abort answered").not.toBeNull();
      await di;
      await wait(40);
      expect(a!.abortStops?.failed).toEqual(["s"]);
      expect(ids(), "not around the gate").toEqual([]);
      expect(hang(c, "abort:s")?.status).toBe("failed");
      expect(String(hang(c, "abort:s")?.error)).toMatch(/policy/);
      ve0();
      const { kq: a1 } = await traLoi(abortRun(c, OWNER, "still hanging"));
      expect(a1, "a press is bounded too").not.toBeNull();
      expect(ids()).toEqual([]);
      n.tha();
      h.treoNap.clear();
      h.heSoHan = 0;
      await wait(20);
      await bam(c);
      expect(ids()).toEqual(["s"]);
    }, 15_000);
  }
  it("T7B1D-TREO-WK-BAT the flag on, the policy's module hanging past its bound, the walk at a command: refused by the road it has: nothing sent around the gate; the walk does not stand still", async () => {
    h.coBat = true;
    h.heSoHan = 0.05;
    const n = moTha();
    h.treoNap.set("policyGate", n.cho);
    const { c, di } = await moDi(def("d1dtwb", [gate(), ot("x"), otStop("s")]));
    const { kq } = await traLoi(di.then(() => "xong", () => "xong"));
    n.tha();
    expect(kq, "the walk did not stand still").toBe("xong");
    expect(ids(), "not around the gate").toEqual([]);
    expect(["running", "queued"]).not.toContain(runRow(c).status);
  }, 15_000);
  it("T7B1D-TREO-XAC-MINH both verifier paths hanging: the Abort answers; robot STOPs need no database and go; an OT STOP is not verified, with its trace; a non-STOP is neither", async () => {
    const { c, di } = await moDi(def("d1dtx", [gate(), ot("x"), delay("w", 300), otStop("s"), robotStop("rs"), ot("m")]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.heSoHan = 0.05;
    h.treoVerifier = "ca";
    const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
    expect(a, "the Abort answered").not.toBeNull();
    await di;
    await wait(40);
    expect(ids()).toEqual(["rs"]);
    expect(a!.abortStops?.unverified).toEqual(["s"]);
    expect(hang(c, "abort:s")?.status).toBe("failed");
    expect(hang(c, "abort:m")).toBeUndefined();
  }, 15_000);
  for (const dang of ["CHUA-XAC-MINH", "CHUA-DOC"] as const) {
    it(`T7B1D-TREO-VET ${dang} only the question of the trace hangs: it is left, on the side that keeps a STOP; no promise stays behind the answer; a press sends s`, async () => {
      const { c, di } = await moDi(def(`d1dtv${dang === "CHUA-DOC" ? "d" : "x"}`, [gate(), ot("x"), box("b", [delay("w", 300), otStop("s")])]));
      await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
      await wait(10);
      ve0();
      h.heSoHan = 0.05;
      if (dang === "CHUA-XAC-MINH") h.classifyLoi = true;
      else {
        ghimHalt(false);
        h.ghim = PIN_BAD;
      }
      h.treoLaStop = () => new Promise<void>(() => undefined);
      const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
      expect(a, "the Abort answered").not.toBeNull();
      h.classifyLoi = false;
      h.treoLaStop = null;
      h.heSoHan = 0;
      await di;
      await wait(40);
      expect(hang(c, "abort:s")?.status, "its trace").toBe("failed");
      ghimHalt(true);
      h.ghim = PIN_OK;
      await bam(c);
      expect(ids()).toEqual(["s"]);
    }, 15_000);
  }
  it("T7B1D-TREO-QUET a sweep that does not end, a latched run: the Abort answers within the ceiling: not a silent ok: told; a second press joins it and is bounded too; the sweep free, it goes on and sends the STOP, once: a press after it has nothing to add", async () => {
    const c = await khoaChuaGiao("d1dtq");
    ve0();
    h.heSoHan = 0.05;
    h.classifyLoi = true;
    const n = moTha();
    h.treoLaStop = () => n.cho;
    const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
    expect(a, "the Abort answered").not.toBeNull();
    expect(a!.abortStops?.quetChuaXong).toBe(true); // H32, dieu-phoi 09/11: was khongDocDuoc
    expect(a!.message).toMatch(/has not finished and is still running/); // H32: was /press Abort again/
    await waitFor(() => urgentCua("abortSweepUnfinished").length > 0, "told"); // H32: was urgentCua("abortDefUnread"), awaited
    const { kq: a1 } = await traLoi(abortRun(c, OTHER, "joins it"));
    expect(a1, "a press joining it answered").not.toBeNull();
    h.classifyLoi = false;
    h.treoLaStop = null;
    n.tha();
    h.heSoHan = 0;
    await waitFor(() => ids().includes("s2"), "the sweep went on");
    await wait(60);
    expect(ids(), "once, and nothing else").toEqual(["s2"]);
    await bam(c, "free");
    expect(ids(), "not again").toEqual([]);
  }, 15_000);
  it("T7B1D-TREO-CUOI-WALKER a latched walk behind a sweep that does not end: the walk ends within its bound", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 30);
    const { c, di } = await moDi(def("d1dtc", [gate(), par("root", [ot("x"), box("b", [delay("w", 300), otStop("s")])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w") && h.traTimeout > 0, "latched, at the delay");
    await wait(20);
    ve0();
    h.heSoHan = 0.05;
    h.classifyLoi = true;
    const n = moTha();
    h.treoLaStop = () => n.cho;
    await traLoi(abortRun(c, OWNER, "first"));
    const { kq } = await traLoi(di.then(() => "xong", () => "xong"));
    h.classifyLoi = false;
    h.treoLaStop = null;
    n.tha();
    h.timeoutDispatch.clear();
    expect(kq, "the walk ended").toBe("xong");
  }, 15_000);
  it("T7B1D-TREO-DUOI-WALKER the latch after the sweep, the walk's last word hanging: the walk ends within its bound", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 80);
    const { c, di } = await moDi(def("d1dtd2", [gate(), par("root", [ot("x"), delay("w", 300)]), move("m")]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(5);
    ve0();
    h.heSoHan = 0.05;
    await abortRun(c, OWNER, "first");
    h.treoLaStop = () => new Promise<void>(() => undefined);
    const { kq } = await traLoi(di.then(() => "xong", () => "xong"));
    h.treoLaStop = null;
    h.timeoutDispatch.clear();
    expect(kq, "the walk ended").toBe("xong");
    expect(runDaChot(c)).toBe(true);
  }, 15_000);

  // ── T7b-1d fix 2 (H32): the fallback of the verifier, then the ceilings as measured, on the same 1/20 ─────────────────────────────────────────────────────────
  it("T7B1D-XM-ROBOT-NON-STOP both verifier paths hanging: a robot command that is no STOP is no STOP of the fallback: 0 commands of it, no row; the robot STOP goes", async () => {
    const { c, di } = await moDi(def("d1dxr", [gate(), ot("x"), delay("w", 300), robotStop("rs"), move("m")]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.heSoHan = 0.05;
    h.treoVerifier = "ca";
    const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
    expect(a, "the Abort answered").not.toBeNull();
    await di;
    await wait(40);
    expect(ids()).toEqual(["rs"]);
    expect(a!.abortStops?.sent).toEqual(["rs"]);
    expect(a!.abortStops?.unverified).toEqual([]);
    expect(hang(c, "abort:m")).toBeUndefined();
  }, 15_000);
  /** when each command reached its dispatcher, in ms from `t0`, for as long as the case runs */
  const gioGiao = () => {
    const goc = h.sent.push;
    const luc = new Map<string, number>();
    h.sent.push = function (...x: Array<Record<string, unknown>>) {
      for (const m of x) luc.set(String(m.stepId), Date.now());
      return goc.apply(h.sent, x);
    };
    return { luc, go: () => (h.sent.push = goc) };
  };
  const TREO_DOC = (() => new Promise<never>(() => undefined)) as never;
  const CEILING = (15 * STOP_DB_STEP_DEADLINE_MS) / 20;
  /**
   * T7b-1d lượt sửa 2 (dieu-phoi 10/11) — a ceiling read on a clock of the case's own, not the CPU's: vitest's fake timers over every timer of the engine (withDeadline is setTimeout), the real bounds (no heSoHan), stepped
   * by `buoc` ms of that clock; the case's set-up is done before on real time. `tra` resolves with the clock's ms at which `p` settled; `den` stops the stepping (or `toi` ms of the clock). The real timers come back after
   */
  const dongHoAo = async <T,>(chay: () => Promise<T>, o: { toi: number; buoc: number; den?: () => boolean }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      const t0 = Date.now();
      let kq: { v: T; luc: number } | null = null;
      void chay().then((v) => (kq = { v, luc: Date.now() - t0 }));
      while (Date.now() - t0 < o.toi && !(kq !== null && (o.den?.() ?? true))) await vi.advanceTimersByTimeAsync(o.buoc);
      return { kq: kq as { v: T; luc: number } | null, het: Date.now() - t0 };
    } finally {
      vi.useRealTimers();
    }
  };
  /** ... and of a whole case: `cho` steps the clock until `fn` (or `toi` ms of it), `troi` lets `ms` of it pass. Every timer is the clock's from the first line */
  const caAo = async (than: (ao: { cho: (fn: () => boolean, nhan: string, toi?: number) => Promise<void>; troi: (ms: number) => Promise<void> }) => Promise<void>) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const BUOC = STOP_DB_STEP_DEADLINE_MS / 50;
    try {
      await than({
        cho: async (fn, nhan, toi = 60 * STOP_DB_STEP_DEADLINE_MS) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > toi) throw new Error(`timed out on the case's clock waiting for: ${nhan}`);
            await vi.advanceTimersByTimeAsync(BUOC);
          }
        },
        troi: async (ms) => {
          await vi.advanceTimersByTimeAsync(ms);
        },
      });
    } finally {
      vi.useRealTimers();
    }
  };
  it("T7B1D-TREO-TRAN-15D a latched run, its sweep and the URGENT of it both hanging: the answer comes at the ceiling, not after the URGENT's own bound; the URGENT keeps that bound and its own catch; the sweep goes on", async () => {
    const c = await khoaChuaGiao("d1dtt");
    ve0();
    h.classifyLoi = true;
    const n = moTha();
    h.treoLaStop = () => n.cho;
    h.alertTreo = true;
    const baoLoi = vi.spyOn(console, "error");
    const dongUrgent = () => baoLoi.mock.calls.filter((x) => /the URGENT of a sweep not finished failed/.test(String(x[0])));
    const D = STOP_DB_STEP_DEADLINE_MS;
    let luc = -1;
    // the clock of the case, the real bounds: 22·D of it is the URGENT's own bound (15·D + 5·D) and room; stepped by 1/20 of D
    const { kq } = await dongHoAo(
      () =>
        abortRun(c, OWNER, "first").then((a) => {
          luc = dongUrgent().length;
          return a;
        }),
      { toi: 22 * D, buoc: D / 20, den: () => dongUrgent().length > 0 },
    );
    expect(kq, "the Abort answered").not.toBeNull();
    const a = kq!.v;
    expect(a.abortStops?.quetChuaXong).toBe(true);
    expect(kq!.luc, "not before the ceiling").toBeGreaterThanOrEqual(15 * D);
    // dieu-phoi 10/11: the answer's ceiling is 16·D (15·D of the sweep, 1·D of nghiaVuKetThucNguoi). On this clock no slack: what the CPU does costs no time on it
    expect(kq!.luc, "at most 16·D, not 17·D, not 60·D").toBeLessThanOrEqual(16 * D);
    expect(luc, "it did not wait for the URGENT's bound").toBe(0);
    expect(a.message, "nothing says it was told").not.toMatch(/URGENT|alert|told|notified/i);
    expect(dongUrgent().length, "the URGENT's own bound fired, its own catch (by 22·D of the clock)").toBeGreaterThan(0);
    expect(h.treoLan, "the URGENT was tried").toBeGreaterThan(0);
    baoLoi.mockRestore();
    h.alertTreo = false;
    h.classifyLoi = false;
    h.treoLaStop = null;
    n.tha();
    await waitFor(() => ids().includes("s2"), "the sweep went on");
  }, 15_000);
  it("T7B1D-TREO-DAU-VET-N nine traces whose pin read hangs, a press on a run not latched: read side by side: s and rs go after one read, the answer under the ceiling names the nine, in the order of the plan, and sends none of them", async () => {
    const nts = Array.from({ length: 9 }, (_, i) => stopTyped(`nt${i}`));
    const { c, di } = await moDi(def("d1dvn", [gate(), ot("x"), box("b", [delay("w", 300), ...nts, otStop("s"), robotStop("rs")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.tuChoi.set("s", REF);
    h.tuChoi.set("rs", REF);
    await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    h.tuChoi.clear();
    for (const [i, s] of nts.entries()) rows("orchestration_run_steps").push({ id: 910_000 + c * 100 + i, runId: c, stepId: `abort:${(s as { id: string }).id}`, stepType: "command", status: "failed", attempt: 0, error: null, startedAt: new Date(), finishedAt: new Date(), resultJson: { abortStop: "chuaXacMinh", stepId: (s as { id: string }).id } });
    ve0();
    h.ghim = TREO_DOC;
    const D = STOP_DB_STEP_DEADLINE_MS;
    let g: ReturnType<typeof gioGiao> | null = null;
    let t0 = 0;
    // the case's clock (dongHoAo), the real bounds: one read is 2·D of it, nine one after the other 18·D, the ceiling 15·D
    const { kq } = await dongHoAo(
      () => {
        g = gioGiao();
        t0 = Date.now();
        return abortRun(c, OWNER, "press");
      },
      { toi: 20 * D, buoc: D / 20 },
    );
    g!.go();
    expect(kq, "the Abort answered").not.toBeNull();
    const a = kq!.v;
    expect(ids().sort()).toEqual(["rs", "s"]);
    expect([...a.abortStops!.sent].sort(), "the answer holds what went").toEqual(["rs", "s"]);
    expect((g!.luc.get("s") ?? Infinity) - t0, "s went after one read of 2·D, not nine").toBeLessThanOrEqual(2 * D);
    expect((g!.luc.get("rs") ?? Infinity) - t0).toBeLessThanOrEqual(2 * D);
    expect(kq!.luc, "under the ceiling").toBeLessThan(15 * D);
    expect(a.abortStops?.unverified.slice(0, 9), "unread: named, in the order of the plan").toEqual(nts.map((s) => (s as { id: string }).id));
    for (const n of nts) expect(a.message).toContain((n as { id: string }).id);
    expect(a.abortStops?.quetChuaXong).toBeUndefined();
  }, 15_000);
  it("T7B1D-TREO-DOC-LAI-N nine reads of a first Abort hanging: side by side: every trace has landed when it answers, no read left behind the wait for the traces", async () => {
    const nts = Array.from({ length: 9 }, (_, i) => stopTyped(`nt${i}`));
    const { c, di } = await moDi(def("d1ddl", [gate(), ot("x"), box("b", [delay("w", 300), ...nts, otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.ghim = TREO_DOC;
    const D = STOP_DB_STEP_DEADLINE_MS;
    let luc = -1;
    // the case's clock: each read of a trace is bounded by D of it, the wait on the traces by 3·D: side by side all nine land at D; one after the other three
    const { kq } = await dongHoAo(
      () =>
        abortRun(c, OWNER, "first").then((a) => {
          luc = stepRows(c).filter((r) => r.stepId.startsWith("abort:nt")).length;
          return a;
        }),
      { toi: 20 * D, buoc: D / 20 },
    );
    expect(kq, "the Abort answered").not.toBeNull();
    h.ghim = PIN_OK;
    await di;
    expect(ids()).toEqual(["s"]);
    expect(luc, "all nine, at the answer").toBe(9);
  }, 15_000);
  // the words of a sweep past its ceiling: what is known, on each road they reach a person. Each of them, read
  const chuQuaTran = (chu: string | undefined) => {
    expect(chu).toMatch(/has not finished and is still running/);
    expect(chu, "gone or still may go").toMatch(/may have gone out or may still go/);
    expect(chu, "unconfirmed").toMatch(/nothing confirms them yet/);
    expect(chu).toMatch(/Check the machine on site/);
    expect(chu, "one may press").toMatch(/Abort can be pressed again/);
    expect(chu, "which steps: unknown").toMatch(/which ones is not known/);
    expect(chu).not.toMatch(/not sent|could not read|could not be read|within \d+|\d+ minutes|was sent|owed/);
  };
  it("T7B1D-TREO-CHU-QUA-TRAN a latched run: the sweep past its ceiling: its own words, not those of an unread definition, one URGENT that says the same under one key, a press and a press joining; the sweep free, nothing twice", async () => {
    const c = await khoaChuaGiao("d1dtcq");
    ve0();
    h.heSoHan = 0.05;
    h.classifyLoi = true;
    const n = moTha();
    h.treoLaStop = () => n.cho;
    const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
    expect(a, "the Abort answered").not.toBeNull();
    expect(a!.abortStops?.quetChuaXong).toBe(true);
    expect(a!.abortStops?.khongDocDuoc, "the definition was read").toBeUndefined();
    chuQuaTran(a!.message);
    await waitFor(() => urgentCua("abortSweepUnfinished").length > 0, "the URGENT");
    expect(urgentCua("abortDefUnread"), "not the URGENT of an unread definition").toEqual([]);
    chuQuaTran(chuCua("abortSweepUnfinished"));
    const khoa1 = urgentCua("abortSweepUnfinished").map((x) => x.dedupKey);
    const { kq: a1 } = await traLoi(abortRun(c, OTHER, "joins it"));
    expect(a1, "a press joining it answered").not.toBeNull();
    chuQuaTran(a1!.message);
    await wait(30);
    expect(new Set(urgentCua("abortSweepUnfinished").map((x) => x.dedupKey)), "one fixed key, a press or two").toEqual(new Set(khoa1));
    expect(ids(), "nothing of a press").toEqual([]);
    h.classifyLoi = false;
    h.treoLaStop = null;
    n.tha();
    h.heSoHan = 0;
    await waitFor(() => ids().includes("s2"), "the sweep went on");
    await wait(60);
    expect(ids(), "once").toEqual(["s2"]);
  }, 15_000);
  it("T7B1D-TREO-CHU-QUA-TRAN a run its answer cannot know as latched (only the rows its sweep read say so, the sweep has not answered): the same words, no URGENT of it; a press joining: the same words", async () => {
    const { c, di } = await moDi(def("d1dtcc", [gate(), ot("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    hang(c, "x")!.error = "FOE_OUTCOME_UNKNOWN: no answer (test)";
    ve0();
    h.heSoHan = 0.05;
    h.classifyLoi = true;
    const n = moTha();
    h.treoLaStop = () => n.cho;
    const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
    expect(a, "the Abort answered").not.toBeNull();
    expect(a!.abortStops?.phanLoai, "the answer read nothing").toBeUndefined();
    chuQuaTran(a!.message);
    hang(c, "x")!.error = null;
    const { kq: a1 } = await traLoi(abortRun(c, OTHER, "joins it"));
    expect(a1, "a press joining it answered").not.toBeNull();
    chuQuaTran(a1!.message);
    await wait(30);
    expect(urgentCua("abortSweepUnfinished")).toEqual([]);
    h.classifyLoi = false;
    h.treoLaStop = null;
    n.tha();
    h.heSoHan = 0;
    await di.catch(() => undefined);
    await wait(40);
  }, 15_000);
  it("T7B1D-TREO-CHU-QUA-TRAN a latched run past its window, a debt on its rows, the sweep past its ceiling: it is told what is known, not refused as too old", async () => {
    const c = await khoaChuaGiao("d1dtcw");
    runRow(c).status = "aborted";
    quaCuaSo(c);
    rows("orchestration_run_steps").push({ id: 920_000 + c, runId: c, stepId: "abort:s2", stepType: "command", status: "failed", attempt: 0, error: "FOE_OUTCOME_UNKNOWN: refused (test)", startedAt: new Date(), finishedAt: new Date(), resultJson: { abortStop: "failed", stepId: "s2" } });
    ve0();
    h.heSoHan = 0.05;
    h.classifyLoi = true;
    const n = moTha();
    h.treoLaStop = () => n.cho;
    const { kq: a } = await traLoi(abortRun(c, OWNER, "press"));
    expect(a, "the Abort answered").not.toBeNull();
    expect(a!.reason).toBeUndefined();
    chuQuaTran(a!.message);
    h.classifyLoi = false;
    h.treoLaStop = null;
    n.tha();
    h.heSoHan = 0;
    await wait(40);
  }, 15_000);
  it("T7B1D-TREO-QUA-TRAN-LIVE the latch only a walker knows: its rows carry the code, its context none: past the ceiling it is told all the same", async () => {
    const c = await centralRun(def("d1dtl", [gate("g0"), ot("x"), gate("g1"), otStop("s"), otStop("s2")]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("awaiting_confirm");
    hang(c, "x")!.error = "FOE_OUTCOME_UNKNOWN: no answer (test)";
    ve0();
    h.slow.set("s", 300);
    const view = (await getRun(c, { bindingDigest: true }))!;
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => h.sent.some((x) => x.stepId === "s"), "the walker at its STOP");
    expect(ctxCua(c)[KET_CUC_KHONG_RO_CHOT_CTX_KEY], "its context holds no latch").toBeUndefined();
    h.heSoHan = 0.05;
    h.classifyLoi = true;
    const n = moTha();
    h.treoLaStop = () => n.cho;
    const { kq: a } = await traLoi(abortRun(c, OWNER, "first"));
    expect(a, "the Abort answered").not.toBeNull();
    expect(a!.abortStops?.quetChuaXong).toBe(true);
    await waitFor(() => urgentCua("abortSweepUnfinished").length > 0, "told");
    h.classifyLoi = false;
    h.treoLaStop = null;
    n.tha();
    h.heSoHan = 0;
    h.slow.clear();
    await di.catch(() => undefined);
  }, 15_000);
  it("T7B1D-TREO-CUOI-MOT-TRAN a walk behind an Abort still on its way and then behind its sweep, both hanging: one ceiling from when it began to wait, not two", async () => {
    const D = STOP_DB_STEP_DEADLINE_MS;
    let tDi = -1;
    // the whole case on its own clock, the real bounds: the walk ends 15·D after the Abort (two ceilings: 30·D)
    await caAo(async (ao) => {
      h.timeoutDispatch.add("x");
      h.slow.set("x", 30);
      const { c, di } = await moDi(def("d1dtm", [gate(), par("root", [ot("x"), box("b", [delay("w", 300), otStop("s")])])]));
      await ao.cho(() => stepRows(c).some((r) => r.stepId === "w") && h.traTimeout > 0, "latched, at the delay");
      await ao.troi(20);
      ve0();
      h.classifyLoi = true;
      const n = moTha();
      h.treoLaStop = () => n.cho;
      const t0 = Date.now();
      void di.then(() => (tDi = Date.now() - t0), () => (tDi = Date.now() - t0));
      void abortRun(c, OWNER, "first");
      await ao.cho(() => tDi >= 0, "the walk ended", 40 * D);
      h.classifyLoi = false;
      h.treoLaStop = null;
      n.tha();
      h.timeoutDispatch.clear();
      await ao.troi(5 * D);
    });
    expect(tDi, "the walk ended").toBeGreaterThanOrEqual(0);
    expect(tDi, "it waited for the sweep, to its ceiling").toBeGreaterThanOrEqual(15 * D);
    // T7b-1d lượt sửa 3 (F3): exactly the one ceiling on this clock: one D more (16·D) is red as two ceilings (30·D) are
    expect(tDi, "one ceiling, not one D more, not two").toBeLessThanOrEqual(15 * D);
  }, 15_000);
  it("T7B1D-CUOI-CHO-SAP the one ceiling still waits for both: a latched walk whose Abort is on its way (its write held, no sweep yet) does not end before that Abort's sweep has answered, and tells nothing that sweep sends", async () => {
    let xongDi = false;
    let luc100 = true;
    let c = 0;
    // the case's clock: the Abort's write lands at 200 ms of it; at 100 the walk still waits
    await caAo(async (ao) => {
      h.timeoutDispatch.add("x");
      h.slow.set("x", 30);
      const m = await moDi(def("d1dcs", [gate(), par("root", [ot("x"), box("b", [delay("w", 300), otStop("s")])])]));
      c = m.c;
      await ao.cho(() => stepRows(c).some((r) => r.stepId === "w") && h.traTimeout > 0, "latched, at the delay");
      await ao.troi(20);
      ve0();
      void m.di.then(() => (xongDi = true), () => (xongDi = true));
      h.treAborted = 200;
      let tra = false;
      void abortRun(c, OWNER, "first").then(() => (tra = true));
      await ao.troi(100);
      luc100 = xongDi;
      await ao.cho(() => tra && xongDi, "the Abort answered and the walk ended");
      h.timeoutDispatch.clear();
    });
    expect(luc100, "it waits for the Abort on its way").toBe(false);
    expect(ids()).toEqual(["s"]);
    expect(urgentCua("abortStopNotSent"), "nothing told as not out that the sweep sent").toEqual([]);
  }, 15_000);
  it("T7B1D-CUOI-CHO-QUET ... and for a sweep a later press started while the walk still stands in a command: the walk's end comes after that sweep has answered", async () => {
    let tDi = -1;
    let luc500 = true;
    let lucAbort = true;
    // the case's clock: y answers at 350 ms of it, the press's STOP at 700 after the press: the walk ends after that, not at y's answer
    await caAo(async (ao) => {
      h.timeoutDispatch.add("x");
      h.slow.set("x", 30);
      h.slow.set("y", 350);
      h.tuChoi.set("s", REF);
      const { c, di } = await moDi(def("d1dcq", [gate(), par("root", [ot("x"), box("b", [move("y"), otStop("s")])])]));
      await ao.cho(() => h.sent.some((x) => x.stepId === "y") && h.traTimeout > 0, "latched, y in flight");
      await ao.troi(10);
      ve0();
      let xongDi = false;
      const t0 = Date.now();
      void di.then(() => { xongDi = true; tDi = Date.now() - t0; }, () => { xongDi = true; tDi = Date.now() - t0; });
      let dau = false;
      void abortRun(c, OWNER, "first").then(() => (dau = true));
      await ao.cho(() => dau, "the first Abort answered");
      lucAbort = xongDi;
      h.tuChoi.clear();
      h.slow.set("s", 700);
      let bam2 = false;
      void abortRun(c, OWNER, "press").then(() => (bam2 = true));
      await ao.cho(() => Date.now() - t0 >= 500, "past y's answer");
      luc500 = xongDi;
      await ao.cho(() => bam2 && xongDi, "the press answered and the walk ended");
      h.slow.clear();
      h.timeoutDispatch.clear();
    });
    expect(lucAbort, "y still answers").toBe(false);
    expect(luc500, "the press's sweep is still waiting for s").toBe(false);
    expect(tDi).toBeGreaterThanOrEqual(500);
  }, 15_000);
  // ── P2-Y: the read of a sweep throws: the reason is true, a press is no promise, and 0 commands is what this shape sends ───────────────────────────────────────
  const HINH_NEM: Array<[string, () => WorkflowStep[], string, () => void, string[]]> = [
    ["CHU-RIENG", () => [gate(), move("x"), box("b", [move("y"), otStop("s")])], "y", () => { h.slow.set("y", 100); h.failPlan.set("y", Infinity); }, []],
    ["HANG-HANG", () => [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])], "w", () => undefined, ["s"]],
    ["BU-TRU", () => [gate(), move("x", { compensation: otStop("s") }), delay("w", 300)], "w", () => undefined, ["s"]],
  ];
  for (const [ten, cay, cho, chuan, diSau] of HINH_NEM) {
    it(`T7B1D-P2-Y ${ten}: the read of the sweep throws on a run not latched: "could not read" with no promise of a press, 15 minutes only as an upper limit; a press sends ${diSau.length ? diSau.join() : "nothing, twice"}`, async () => {
      chuan();
      const { c, di } = await moDi(def(`d1dp2${ten}`.replace(/-/g, "").toLowerCase(), cay()));
      await waitFor(() => h.sent.some((x) => x.stepId === cho) || stepRows(c).some((r) => r.stepId === cho), `at ${cho}`);
      await wait(15);
      ve0();
      const hong = { id: 930_000 + c, runId: c, stepId: 5, stepType: "command", status: "failed", error: null, resultJson: null };
      rows("orchestration_run_steps").push(hong);
      const a = await abortRun(c, OWNER, "first");
      await di.catch(() => undefined);
      await wait(200);
      h.slow.clear();
      h.failPlan.clear();
      const ds = rows("orchestration_run_steps");
      ds.splice(ds.indexOf(hong), 1);
      expect(ids()).toEqual([]);
      expect(a.abortStops?.khongDocDuoc).toBe(true);
      expect(a.abortStops?.quetChuaXong).toBeUndefined();
      expect(a.message).toMatch(/could not read the definition/);
      expect(a.message, "no promise").not.toMatch(/press Abort again/);
      expect(a.message).toMatch(/may not reach it/);
      expect(a.message, "an upper limit, not a promise").toMatch(/after 15 minutes none can be counted on/);
      expect(a.message, "the other road's words").not.toMatch(/has not finished/);
      const a2 = await bam(c);
      expect(ids()).toEqual(diSau);
      if (!diSau.length) {
        expect(a2.message).toMatch(/this press sent no STOP step/);
        await bam(c);
        expect(ids(), "and again").toEqual([]);
      }
    });
  }
  it("T7B1D-P2-Y a press on a latched run its sweep cannot read: its records could not be read: nothing promised, 15 minutes only as an upper limit; the same URGENT", async () => {
    const c = await khoaChuaGiao("d1dp2k");
    hongDinhNghia(c);
    await bam(c);
    expect(chuCua("abortDefUnread")).not.toMatch(/press Abort again/);
    expect(chuCua("abortDefUnread")).toMatch(/may not reach it/);
    runRow(c).status = "aborted";
    runRow(c).finishedAt = new Date();
    const a = await bam(c);
    expect(a.message).toMatch(/records could not be read/);
    expect(a.message, "no promise").not.toMatch(/press Abort again/);
    expect(a.message).toMatch(/may not reach it/);
    expect(a.message).toMatch(/after 15 minutes none can be counted on/);
    expect(a.message, "the other road's words").not.toMatch(/has not finished/);
    expect(ids()).toEqual([]);
  });

  // ── H30 × a STOP that went: measured, accepted, on the record ────────────────────────────────────────────────────────────────────────────────────────────
  it("T7B1D-DDM the first Abort's STOP went, its abort: row lost, the walker's cancel over it: a press sends s again, once, under the key of its own Abort (a new one, the ledger's lyDoStopKhoaMoi never reached); its words do not say it never went", async () => {
    h.soCai = new Map();
    h.acked = true;
    const { c, di } = await moDi(def("d1dddm", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(15);
    ve0();
    h.hangNem = (r) => r.stepId === "abort:s";
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    h.hangNem = null;
    expect(h.hangNemLan, "the injection reached the row").toBeGreaterThan(0);
    expect(a.abortStops?.sent).toEqual(["s"]);
    expect(ids()).toEqual(["s"]);
    const khoaDau = String(h.sent[0].key);
    expect(hang(c, "abort:s"), "its row is lost").toBeUndefined();
    expect(hang(c, "b")?.error).toBe("Run is aborting.");
    const a2 = await bam(c);
    expect(ids(), "H30: once more, once").toEqual(["s"]);
    expect(String(h.sent[0].key), "a key of its own: no replay of the first").not.toBe(khoaDau);
    expect(String(h.sent[0].key)).toMatch(new RegExp(`^run${c}-abort-[^-]+-s$`));
    expect(h.sent[0].lanTruoc, "nothing the ledger had to rule on").toBeUndefined();
    expect(a2.message).toMatch(/sent again/);
    expect(a2.message).not.toMatch(/never|did not go|did NOT go|not sent|for the first time/i);
    await bam(c);
    expect(ids(), "not a third time").toEqual([]);
    h.soCai = null;
  });

  // ── H31-K: pinned again, the read lost, a latched run: 0 commands at this press, and the words do not lose the step ──────────────────────────────────────────
  it("T7B1D-H31-K pinned again, the read lost, a latched run: 0 commands at this press; s is named as not read, no word that nothing is owed; a later press that reads it sends it", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 120);
    const { c, di } = await moDi(def("d1dh3k", [gate(), par("root", [move("x"), box("b", [delay("w", 300), otStop("s")])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    h.classifyLoi = true;
    await abortRun(c, OWNER, "first");
    h.classifyLoi = false;
    await di;
    await wait(60);
    h.timeoutDispatch.clear();
    ghimHalt(false);
    h.ghim = KHONG_GHIM;
    await bam(c);
    expect(hang(c, "abort:s")?.status, "read: no pinned STOP").toBe("skipped");
    ghimHalt(true);
    h.classifyLoi = true;
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true;
    const a = await bam(c);
    expect(ids(), "0 commands at this press").toEqual([]);
    expect(a.abortStops?.unverified).toEqual(["s"]);
    expect(a.message).toMatch(/Could not be verified as a pinned STOP: s/);
    expect(a.message).not.toMatch(/hold no STOP step owed|owes no STOP/);
    expect(a.message, "the window is what holds a later press").toMatch(/within 15 minutes/);
    expect(a.message).toMatch(/if its read finds a pinned STOP/);
    h.classifyLoi = false;
    h.dispatcherKhongDoc = false;
    h.ghim = PIN_OK;
    await bam(c);
    expect(ids(), "read: it goes").toEqual(["s"]);
    await bam(c);
    expect(ids(), "once").toEqual([]);
  });
  it("T7B1D-H31-K the control: a step that went on an earlier press, the read lost: it is not called unverified, and nothing is promised for it", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 120);
    h.acked = true;
    const { c, di } = await moDi(def("d1dh3d", [gate(), par("root", [move("x"), box("b", [delay("w", 300), otStop("s")])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    await abortRun(c, OWNER, "first");
    await di;
    await wait(60);
    h.timeoutDispatch.clear();
    expect(ids()).toEqual(["s"]);
    h.classifyLoi = true;
    h.ghim = PIN_BAD;
    h.dispatcherThat = true;
    h.dispatcherKhongDoc = true;
    const a = await bam(c);
    expect(ids()).toEqual([]);
    expect(a.abortStops?.unverified).toEqual([]);
    expect(a.message).not.toMatch(/Could not be verified/);
  });

  // ── a press that joins a sweep in flight: the words are of that sweep, never of a command this press sent (measured, fix 2 job 9) ────────────────────────────
  for (const [ten, ks] of [["CHUA-KHOA", false], ["KHOA", true]] as const) {
    it(`T7B1D-NHAP-QUET ${ten} a press while the first Abort waits for its answer: it joins: no sweep of its own, no second command; "sent" is said of that sweep, never "sent again" by this press`, async () => {
      h.acked = true;
      if (ks) {
        h.timeoutDispatch.add("x");
        h.slow.set("x", 30);
      }
      let a2: Awaited<ReturnType<typeof abortRun>> | null = null;
      // the case's clock: s answers 200 ms of it after its hand-over, the press comes at its hand-over: inside the first sweep whatever the CPU does
      await caAo(async (ao) => {
        const { c, di } = await moDi(def(`d1dnq${ks ? "k" : "c"}`, ks ? [gate(), par("root", [ot("x"), box("b", [delay("w", 300), otStop("s")])])] : [gate(), ot("x"), box("b", [delay("w", 300), otStop("s")])]));
        await ao.cho(() => stepRows(c).some((r) => r.stepId === "w") && (!ks || h.traTimeout > 0), "at the delay");
        await ao.troi(20);
        ve0();
        h.slow.set("s", 200);
        let dau = false;
        void abortRun(c, OWNER, "first").then(() => (dau = true));
        await ao.cho(() => h.sent.some((x) => x.stepId === "s"), "s handed over");
        void abortRun(c, OTHER, "joins").then((r) => (a2 = r));
        let xongDi = false;
        void di.then(() => (xongDi = true), () => (xongDi = true));
        await ao.cho(() => a2 !== null && dau && xongDi, "both answered, the walk ended");
        h.slow.clear();
        h.timeoutDispatch.clear();
      });
      expect(ids(), "one command").toEqual(["s"]);
      expect(a2!.abortStops?.sent).toEqual(["s"]);
      expect(a2!.message).not.toMatch(/sent again/);
      expect(a2!.message, "by whom").toMatch(/joined the sweep already under way and sent nothing itself: that sweep sent: s/);
    });
  }
  it("T7B1D-NHAP-QUET the control: a press of its own sweep says what it sent, as before", async () => {
    h.tuChoi.set("s", REF);
    const { c, di } = await moDi(def("d1dnqd", [gate(), ot("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    h.tuChoi.clear();
    const a = await bam(c);
    expect(ids()).toEqual(["s"]);
    expect(a.message).toMatch(/sent again/);
    expect(a.message).not.toMatch(/joined the sweep/);
  });
  it("T7B1D-NHAP-QUET the control, a latched run: a press of its own sweep names what it sent", async () => {
    const c = await khoaChuaGiao("d1dnqk2");
    ve0();
    h.tuChoi.set("s2", REF);
    await abortRun(c, OWNER, "first");
    await wait(40);
    h.tuChoi.clear();
    const a = await bam(c);
    expect(ids()).toEqual(["s2"]);
    expect(a.message).toMatch(/STOP steps sent again: s2/);
    expect(a.message).not.toMatch(/joined the sweep/);
  });

  // ── the controls: nothing here sends more than it did ───────────────────────────────────────────────────────────────
  it("T7B1D-DC-HOP a container failed on its own before the Abort, the STOP behind it never meant: nothing goes, no word", async () => {
    h.failPlan.set("y", Infinity);
    const { c, di } = await moDi(def("d1ddc", [gate(), par("root", [move("x"), box("b", [move("y"), otStop("s")]), delay("w", 300)])]));
    await waitFor(() => hang(c, "b")?.status === "failed", "b failed on its own");
    await wait(20);
    ve0();
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(ids()).toEqual([]);
    expect([...(a.abortStops?.failed ?? []), ...(a.abortStops?.unverified ?? [])]).toEqual([]);
    expect(hang(c, "abort:s")).toBeUndefined();
    await bam(c);
    expect(ids()).toEqual([]);
    expect(veBuoc("s")).toEqual([]);
  });
  it("T7B1D-DC-RA2 a STOP refused by the walker before the Abort, a sibling alive: never meant by the Abort: nothing goes", async () => {
    h.slow.set("x", 200);
    h.tuChoi.set("st", REF);
    const { c, di } = await moDi(def("d1ddr", [gate(), par("p", [move("x"), otStop("st", { maxAttempts: 0 }), delay("w", 400)])]));
    await waitFor(() => hang(c, "st")?.status === "failed", "st refused");
    h.tuChoi.clear();
    ve0();
    await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(ids()).toEqual([]);
    expect(hang(c, "abort:st")).toBeUndefined();
    await bam(c);
    expect(ids()).toEqual([]);
  });
  it("T7B1D-GATE-HOP no walker at the Abort, a gate in the container: s refused, a press sends it", async () => {
    const c = await centralRun(def("d1dgh", [gate("g0"), move("x"), box("b", [gate("g1"), otStop("s")])]), 1);
    await wait(30);
    ve0();
    h.tuChoi.set("s", REF);
    const a = await abortRun(c, OWNER, "first");
    await wait(40);
    expect(a.abortStops?.failed).toEqual(["s"]);
    h.tuChoi.clear();
    await bam(c);
    expect(ids()).toEqual(["s"]);
  });
  it("T7B1D-GATE-HOP no walker at the Abort, its abort: row lost: no walker wrote over the rows: a press still reaches it", async () => {
    const c = await centralRun(def("d1dgm", [gate("g0"), move("x"), box("b", [gate("g1"), otStop("s")])]), 1);
    await wait(30);
    ve0();
    h.tuChoi.set("s", REF);
    h.hangNem = (r) => r.stepId === "abort:s";
    const a = await abortRun(c, OWNER, "first");
    await wait(40);
    h.hangNem = null;
    h.tuChoi.clear();
    expect(a.abortStops?.failed).toEqual(["s"]);
    await bam(c);
    expect(ids()).toEqual(["s"]);
  });
  it("T7B1D-TU-CHOI-GATE the rejection of a gate in the container, its sweep refused: a press sends s", async () => {
    const c = await centralRun(def("d1dtg", [gate("g0"), move("x"), box("b", [gate("g1"), otStop("s")])]), 1);
    await wait(30);
    ve0();
    h.tuChoi.set("s", REF);
    const view = (await getRun(c, { bindingDigest: true }))!;
    await resumeRun(c, { approved: false, reason: "no", expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! } as never, OTHER);
    await wait(40);
    h.tuChoi.clear();
    await bam(c);
    expect(ids()).toEqual(["s"]);
  });

  // ── H13 × Abort (H25), a latched run ───────────────────────────────────────────────────────────────────────────────
  const dieuKienH13 = (ref: string) => def(ref, [gate(), par("root", [move("x"), delay("w", 300)]), brn("b", [otStop("s"), move("m")]), move("m2")]);
  const tenH13 = () => ({
    nhanh: urgentCua("stopUntakenBranch").map((a) => String(a.dedupKey).split(":")[2]).sort(),
    tien: urgentCua("forwardNotSent").map((a) => String(a.dedupKey).split(":")[2]).sort(),
  });
  it("T7B1D-H13-ABORT the latch before the Abort, the walker alive: the Abort tells what the walk would have, each once; the press does not say 'owes no STOP'", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    const { c, di } = await moDi(dieuKienH13("d1dh1"));
    await waitFor(() => h.traTimeout > 0, "the latch");
    await wait(40);
    ve0();
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(60);
    h.timeoutDispatch.clear();
    expect(a.abortStops?.untakenBranch).toEqual(["s"]);
    expect(tenH13()).toEqual({ nhanh: ["s"], tien: ["m", "m2"] });
    expect(ids()).toEqual([]);
    const a2 = await bam(c);
    expect(ids()).toEqual([]);
    expect(a2.message).not.toMatch(/owes no STOP/);
    expect(a2.message).toMatch(/never evaluated: s/);
    expect(tenH13().tien, "a press does not tell the forward work again").toEqual([]);
  });
  it("T7B1D-H13-ABORT the latch after the sweep: the walk's end tells it, each once", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 120);
    const { c, di } = await moDi(dieuKienH13("d1dh2"));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(10);
    ve0();
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(60);
    h.timeoutDispatch.clear();
    expect(runDaChot(c)).toBe(true);
    expect(a.abortStops?.untakenBranch).toEqual(["s"]);
    expect(tenH13()).toEqual({ nhanh: ["s"], tien: ["m", "m2"] });
    expect(ids()).toEqual([]);
  });
  it("T7B1D-H13-ABORT the same source as the walk's: with no Abort the walk names the same steps", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    const { c, di } = await moDi(def("d1dh3", [gate(), par("root", [move("x"), delay("w", 60)]), brn("b", [otStop("s"), move("m")]), move("m2")]));
    await di;
    await wait(60);
    h.timeoutDispatch.clear();
    expect(runDaChot(c)).toBe(true);
    expect(tenH13()).toEqual({ nhanh: ["s"], tien: ["m", "m2"] });
  });
  it("T7B1D-H13-ABORT a run not latched: no new URGENT", async () => {
    const { c, di } = await moDi(def("d1dh4", [gate(), move("x"), delay("w", 300), brn("b", [otStop("s"), move("m")]), move("m2")]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    const a = await abortRun(c, OWNER, "first");
    await di;
    await wait(40);
    expect(a.abortStops?.untakenBranch).toEqual(["s"]);
    expect(h.alerts.map((a) => a.kind)).toEqual([]);
  });
  for (const daBao of [true, false]) {
    it(`T7B1D-H13-ABORT a stored run, ${daBao ? "its URGENT known durable: the walker's word stands: no second word of the forward work" : "no word known to have landed: the forward work is told"}`, async () => {
      const c = await khoaChuaGiao(`d1dh6${daBao ? "b" : "k"}`, [move("m")]);
      if (daBao) runRow(c).contextJson = { ...ctxCua(c), [KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]: { stepId: "x", at: new Date().toISOString() } };
      const a = await bam(c);
      expect(a.abortStops?.sent).toEqual(["s2"]);
      expect(tenH13().tien).toEqual(daBao ? [] : ["m"]);
      await bam(c, "again");
      expect(tenH13().tien, "a press does not tell the forward work again").toEqual([]);
    });
  }
  it("T7B1D-H13-ABORT no word landed at the first Abort: a press tells the forward work again, under the same key; once one landed, no more", async () => {
    const c = await khoaChuaGiao("d1dh8", [move("m")]);
    h.alertDurable = false;
    await bam(c);
    expect(tenH13().tien).toEqual(["m"]);
    const khoa = urgentCua("forwardNotSent")[0]?.dedupKey;
    await bam(c, "no word landed");
    expect(tenH13().tien, "CO BAO").toEqual(["m"]);
    expect(urgentCua("forwardNotSent")[0]?.dedupKey, "one fixed key: the inbox holds one").toBe(khoa);
    h.alertDurable = true;
    runRow(c).contextJson = { ...ctxCua(c), [KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]: { stepId: "x", at: new Date().toISOString() } };
    await bam(c, "one landed");
    expect(tenH13().tien).toEqual([]);
  });
  for (const noi of ["edge", "khac", "khac-bu-tru"] as const) {
    it(`T7B1D-H13-ABORT a latched run driven elsewhere (${noi === "edge" ? "an edge node" : noi === "khac" ? "another instance" : "another instance, compensating"}): its rows lag: no step is named as not handed over; that it cannot be determined is told`, async () => {
      const c = await khoaChuaGiao(`d1dh7${noi}`, [move("m")]);
      if (noi === "edge") runRow(c).edgeNodeId = NODE;
      else runRow(c).status = noi === "khac" ? "running" : "compensating";
      const a = await bam(c);
      expect(a.abortStops?.sent).toEqual(["s2"]);
      expect(tenH13().tien.filter((x) => x === "m"), "no step named from rows that lag").toEqual([]);
      expect(chuCua("forwardNotSent")).toMatch(/could not be determined/);
    });
  }
  it("T7B1D-H13-ABORT what cannot be determined is told: the rows unread on a latched Abort", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    const { c, di } = await moDi(dieuKienH13("d1dh5"));
    await waitFor(() => h.traTimeout > 0, "the latch");
    await wait(40);
    ve0();
    h.docNem = { bang: "orchestration_run_steps", lan: Infinity };
    await abortRun(c, OWNER, "first");
    await wait(20);
    const chu = chuCua("forwardNotSent");
    h.docNem = null;
    await di;
    h.timeoutDispatch.clear();
    expect(chu).toMatch(/could not be determined/);
  });

  // ── branch 3 of RC12b (H26): the real path: the walker's own end in flight, the Abort reads 'running', flags, its own write lands after ────────────────────
  const nhanh3 = async (d: WorkflowDefinition, chuanBi: (c: number) => void, trang: "failed" | "completed") => {
    let moi = true;
    let aP: Promise<any> | null = null;
    const update0 = (fake as any).update;
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const c = (await startRun(d.ref, {}, OWNER)).runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    (fake as any).update = (t: any) => {
      const b = update0(t);
      if (t?.[Symbol.for("drizzle:Name")] !== "orchestration_runs") return b;
      let st: unknown;
      const s0 = b.set;
      const w0 = b.where;
      b.set = (v: Row) => {
        st = v.status;
        s0(v);
        return b;
      };
      b.where = (x: any) => {
        if (st === trang && moi) {
          moi = false;
          ve0();
          chuanBi(c);
          h.treAborted = 40;
          aP = abortRun(c, OWNER, "in the race");
          const dat = new Promise<Row[]>((ok) => setTimeout(() => ok(Promise.resolve(w0(x).returning())), 15));
          return { returning: () => dat, then: (a: (v: Row[]) => unknown, e?: (y: unknown) => unknown) => dat.then(a, e) };
        }
        return w0(x);
      };
      return b;
    };
    const di = resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => aP !== null, "the walker's own end in flight");
    const a = await aP!;
    await di;
    await wait(60);
    (fake as any).update = update0;
    return { c, a };
  };
  const SAU_LOI = (ref: string, them: WorkflowStep[]) => def(ref, [gate(), move("x"), box("b", [move("y")]), ...them]);
  it("T7B1D-N3A a run failed by itself: the pinned STOPs go, a STOP-typed step not pinned is listed, a non-STOP never", async () => {
    h.failPlan.set("y", Infinity);
    const { c, a } = await nhanh3(SAU_LOI("d1dn3a", [otStop("s"), stopTyped("nt"), move("m"), robotStop("rs")]), () => undefined, "failed");
    expect(a.ok).toBe(false);
    expect(a.status).toBe("failed");
    expect(ids().sort()).toEqual(["rs", "s"]);
    expect(a.abortStops?.notPinned).toContain("nt");
    expect(h.alerts.map((a) => a.kind)).toEqual([]);
    expect(hang(c, "abort:s")?.status).toBe("completed");
  });
  it("T7B1D-N3B the STOP refused, a run that never latched: the row keeps its code, an URGENT names it, no word of an unknown outcome, none of a later press", async () => {
    h.failPlan.set("y", Infinity);
    const { c, a } = await nhanh3(SAU_LOI("d1dn3b", [otStop("s")]), () => h.tuChoi.set("s", REF), "failed");
    h.tuChoi.clear();
    expect(a.abortStops?.failed).toEqual(["s"]);
    expect(String(hang(c, "abort:s")?.error), "RM-N3-MA-C: the row says it").toMatch(/^FOE_STOP_NOT_SENT: STOP "s"/);
    expect(veBuoc("s").map((x) => x.kind)).toEqual([CANH_BAO_KHONG_RO_KIND.abortStopNotSent]);
    const chu = chuCua("abortStopNotSent");
    expect(chu).toMatch(/has ended/);
    expect(chu).toMatch(/cannot send it/);
    expect(chu).not.toMatch(/FOE_OUTCOME_UNKNOWN|UNKNOWN|outcome is unknown|state of the machine is unknown/);
    const dep = await deployWorkflow(def("d1dn3b", [gate(), move("x"), otStop("s9")]), OWNER);
    expect(dep.ok, "a run that ended holds no deploy (T12 reads aborted runs only)").toBe(true);
  });
  it("T7B1D-N3B on a run that did latch the words stay those of an unknown outcome", async () => {
    const { c, di } = await moDi(def("d1dn3k", [gate(), par("p", [move("x"), box("b", [delay("w", 800), otStop("s")])])]));
    h.slow.set("x", 250);
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.tuChoi.set("s", REF);
    const ctx = ctxCua(c);
    h.treAborted = 5;
    h.khiTreAborted = () => {
      runRow(c).status = "failed";
      rows("orchestration_run_steps").push({ id: 99_002, runId: c, stepId: "zz", stepType: "command", status: "failed", error: "FOE_OUTCOME_UNKNOWN: step \"zz\" outcome unknown", resultJson: null });
    };
    void ctx;
    const a = await abortRun(c, OWNER, "walker alive");
    h.tuChoi.clear();
    await di;
    expect(a.status).toBe("failed");
    const chu = chuCua("abortStopNotSent");
    expect(chu).toMatch(/has ended/);
    expect(chu).toMatch(/outcome is unknown/);
  });
  it("T7B1D-N3C a run that never latched, the pins unreadable: NOT the marked route: listed, told, no command: step words, not 'STOP \"nt\"'", async () => {
    h.failPlan.set("y", Infinity);
    const { c, a } = await nhanh3(SAU_LOI("d1dn3c", [otStop("s"), stopTyped("nt"), move("m")]), () => {
      h.classifyLoi = true;
      h.dispatcherThat = true;
    }, "failed");
    h.classifyLoi = false;
    h.dispatcherThat = false;
    expect(a.status).toBe("failed");
    expect(ids(), "no marked route on a run never latched").toEqual([]);
    expect(a.abortStops?.unverified).toEqual(expect.arrayContaining(["s", "nt"]));
    expect(a.abortStops?.failed).toEqual([]);
    expect(veBuoc("s").map((x) => x.kind)).toEqual([CANH_BAO_KHONG_RO_KIND.abortStopNotSent]);
    expect(veBuoc("nt").map((x) => x.kind)).toEqual([CANH_BAO_KHONG_RO_KIND.abortStopNotSent]);
    expect(veBuoc("m")).toEqual([]);
    const chu = chuCua("abortStopNotSent");
    expect(chu).not.toMatch(/STOP "nt"/);
    expect(chu).toMatch(/step "nt"/);
    expect(chu).toMatch(/could not be verified as a pinned STOP/);
    expect(chu).toMatch(/NOT sent/);
    expect(chu).toMatch(/check the machine on site/);
    expect(chu).not.toMatch(/press Abort again|FOE_OUTCOME_UNKNOWN|UNKNOWN/);
    expect(hang(c, "abort:s"), "no later press reads it").toBeUndefined();
  });
  it("T7B1D-N3C a run that did latch keeps the marked route (the dispatcher decides)", async () => {
    const { c, di } = await moDi(def("d1dn3m", [gate(), par("p", [move("x"), box("b", [delay("w", 800), otStop("s")])])]));
    h.slow.set("x", 250);
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.classifyLoi = true;
    h.dispatcherThat = true;
    h.traTimeout = 1;
    h.treAborted = 5;
    h.khiTreAborted = () => {
      runRow(c).status = "failed";
      rows("orchestration_run_steps").push({ id: 99_003, runId: c, stepId: "zz", stepType: "command", status: "failed", error: "FOE_OUTCOME_UNKNOWN: step \"zz\" outcome unknown", resultJson: null });
    };
    const a = await abortRun(c, OWNER, "walker alive");
    h.classifyLoi = false;
    await di;
    expect(a.status).toBe("failed");
    expect(pdu("s").length, "marked row, real pins: the dispatcher lets it").toBe(1);
    expect(ids()).toEqual(["s"]);
    h.dispatcherThat = false;
  });
  it("T7B1D-N3-CO-THE accepted behaviour (H26): class coTheDaRa goes at branch 3, under the attempt's key: at worst one STOP more, pressed by a person", async () => {
    h.failPlan.set("y", Infinity);
    const { c, a } = await nhanh3(SAU_LOI("d1dn3t", [otStop("s")]), (c0) => {
      void upsertStep(c0, "s", "command", { status: "running", attempt: 0, startedAt: new Date() });
    }, "failed");
    expect(a.abortStops?.phanLoai?.s?.lop).toBe("coTheDaRa");
    expect(h.sent.map((x) => x.key)).toEqual([`run${c}-s-a1`]);
  });
  it("T7B1D-N3E accepted behaviour (H26): a run completed, a container its precondition skipped: its pinned STOP goes: one STOP more, never a non-STOP", async () => {
    const { c, a } = await nhanh3(def("d1dn3e", [gate(), move("x"), box("c", [otStop("s"), move("m")], { precondition: { source: "telemetry", machineId: 2, key: "temp", op: "gt", value: 100 }, onPreconditionFail: "skip" })]), () => undefined, "completed");
    expect(a.status).toBe("completed");
    expect(ids()).toEqual(["s"]);
    expect(hang(c, "abort:s")?.status).toBe("completed");
    expect(h.alerts.map((a) => a.kind)).toEqual([]);
  });
  it("T7B1D-HN3 a second person pressing while the first sweep waits, run not latched, refused: the words are true of the next press, which sends it", async () => {
    const { c, di } = await moDi(def("d1dhn", [gate(), move("x"), box("b", [delay("w", 300), otStop("s")])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w"), "at the delay");
    await wait(20);
    ve0();
    h.tuChoi.set("s", REF);
    h.slow.set("s", 100);
    const aP = abortRun(c, OWNER, "A");
    await waitFor(() => runRow(c).status === "aborted" && ids().includes("s"), "A's sweep waits on the dispatcher");
    const b = await abortRun(c, OTHER, "B");
    const a = await aP;
    await di;
    await wait(40);
    h.tuChoi.clear();
    h.slow.clear();
    expect(a.abortStops?.failed).toEqual(["s"]);
    expect(b.abortStops?.failed).toEqual(["s"]);
    expect(b.message).not.toMatch(/stay owed/);
    expect(b.message).toMatch(/refused or not answered: s/);
    expect(b.message).toMatch(/within 15 minutes/);
    await bam(c);
    expect(ids()).toEqual(["s"]);
  });

  // ── an exception in the sweep (H26): never a silent ok ─────────────────────────────────────────────────────────────
  const hongDinhNghia = (c: number) => {
    const wf = rows("orchestration_workflows").find((w) => w.id === runRow(c).workflowId)!;
    wf.definitionJson = { ...wf.definitionJson, steps: [...wf.definitionJson.steps, { id: "hong", type: "sequence", steps: 5 }] };
  };
  it("T7B1D-QUET-NEM a latched run: khongDocDuoc, the URGENT and the words of RA2-5, the 15 minutes do not stretch", async () => {
    const c = await khoaChuaGiao("d1dqk");
    hongDinhNghia(c);
    const a = await bam(c);
    expect(a.abortStops?.khongDocDuoc).toBe(true);
    expect(urgentCua("abortDefUnread").length).toBe(1);
    expect(a.message).toMatch(/could not read the definition/);
    expect(a.message).toMatch(/after 15 minutes none can be counted on/); // H32, dieu-phoi 09/11: was /within 15 minutes/
    expect(ids()).toEqual([]);
    quaCuaSo(c);
    const a2 = await bam(c, "past");
    expect(a2.reason).toBe("resendTooOld");
    expect(ids()).toEqual([]);
  });
  it("T7B1D-QUET-NEM a run not latched: told to the one who pressed, no URGENT (H23)", async () => {
    const c = await centralRun(def("d1dqc", [gate("g0"), ot("x"), gate("g1"), otStop("s2")]), 1);
    await wait(30);
    hongDinhNghia(c);
    const a = await bam(c);
    expect(a.abortStops?.khongDocDuoc).toBe(true);
    expect(a.message).toMatch(/could not read the definition/);
    expect(h.alerts.map((a) => a.kind)).toEqual([]);
    expect(ids()).toEqual([]);
  });

  // ── every way out of abortRun lets the waiting walk go (RM-THA-*): a walker latched behind the Abort ends long before the bound of the wait ────────────────
  const dungTrongX = async (ref: string) => {
    h.timeoutDispatch.add("x");
    h.slow.set("x", 250);
    const { c, di } = await moDi(def(ref, [gate(), par("p", [move("x"), box("b", [delay("w", 800), otStop("s")])])]));
    await waitFor(() => stepRows(c).some((r) => r.stepId === "w") && h.sent.some((x) => x.stepId === "x"), "x handed over");
    await wait(20);
    ve0();
    return { c, di };
  };
  it("T7B1D-THA-N3 another end at branch 3: the walk behind it does not wait for its bound", async () => {
    const { c, di } = await dungTrongX("d1dt3");
    h.treAborted = 5;
    h.khiTreAborted = () => (runRow(c).status = "failed");
    const a = await abortRun(c, OWNER, "walker alive");
    const t0 = Date.now();
    expect(a.status).toBe("failed");
    await di;
    h.timeoutDispatch.clear();
    expect(Date.now() - t0).toBeLessThan(8_000);
  }, 30_000);
  it("T7B1D-THA-FALSE the write matched no row and the read back says neither aborted nor an end: 'already terminal': the walk does not wait for its bound", async () => {
    const { c, di } = await dungTrongX("d1dtf");
    h.treAborted = 5;
    const select0 = (fake as any).select;
    h.khiTreAborted = () => {
      runRow(c).status = "failed";
      (fake as any).select = (pr?: unknown) => {
        (fake as any).select = select0;
        runRow(c).status = "running";
        return select0(pr);
      };
    };
    const a = await abortRun(c, OWNER, "walker alive");
    const t0 = Date.now();
    (fake as any).select = select0;
    expect(a.ok).toBe(false);
    expect(a.message).toMatch(/already terminal/);
    await di;
    h.timeoutDispatch.clear();
    expect(Date.now() - t0).toBeLessThan(8_000);
  }, 30_000);
  it("T7B1D-THA-CATCH an exception out of abortRun after the flag: the walk does not wait for its bound", async () => {
    const { c, di } = await dungTrongX("d1dtc");
    let doc = 0;
    const opts = {
      get scope(): never {
        if (++doc >= 3) throw new Error("scope read throws (test)");
        return undefined as never;
      },
    };
    const a = await abortRun(c, OWNER, "walker alive", opts);
    const t0 = Date.now();
    expect(a.ok).toBe(false);
    expect(a.message).toMatch(/scope read throws/);
    await di;
    h.timeoutDispatch.clear();
    expect(Date.now() - t0).toBeLessThan(8_000);
  }, 30_000);
});
