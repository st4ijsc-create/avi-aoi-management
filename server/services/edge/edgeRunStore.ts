/**
 * doc 81 Đợt 10 task C (design §0.1, §2.4, §2.6, §2.10, §2.14) — the EDGE RunStore: the FOE walker (foeEngine.ts — the SAME
 * code central walks with) persists and asks through this store on an edge host that holds NO database login.
 *
 *   • what central computed is the SIGNED RUN PACKAGE (verified by the caller — edgeTrust.verifyEdgeRunPackage — before it is
 *     handed here): the definition, the machines, the adapter of every OT step (withResolvedAdapter's rule, resolved
 *     centrally), the VERIFIED STOPs, the prior picture of earlier segments, the run context, the owner;
 *   • every step row / context / abort-STOP outcome is a record of the run stream `run:<runId>:<claimSeq>` in the local journal
 *     (io.sink — group E), shipped to central, which is the ONLY writer of the run's rows (foeEngine.recordEdgeStepRows /
 *     applyEdgeSegmentEnd, called by group B's report / complete endpoints);
 *   • every NON-STOP command asks central first (io.authorize → POST runs/:id/authorize, group E's client, which verifies the
 *     signed answer): no fresh authorisation ⇒ NOTHING is sent. The signed authorisation travels on the command
 *     (`cmd.edge.authorization`, group D's edge dispatch verifies it right before the driver call);
 *   • a STOP never asks (L-7): a VERIFIED stop of the package is dispatched without central, without a journal admission.
 *
 * Verdicts of the authorisation (design §2.5 / §2.10, D5):
 *   refused      — central said no (gate / device gate / payload / ownership …) ⇒ the step FAILS with the reason (a gate
 *                  refusal carries the same FOE_GATE_REQUIRED(<reason>) text as central's walk);
 *   stopped      — central aborted / a rejection claimed the run ⇒ the walker sweeps locally (its STOPs still go);
 *   stale        — the claim is no longer this walker's ⇒ it lets go of the run without writing it;
 *   unavailable  — central cannot be asked (or the journal admits no new non-STOP work) ⇒ the step is HELD: nothing is sent,
 *                  no compensation; the segment ends `held(<reason>)` and a person Continues later.
 *
 * Coded against STRUCTURAL ports (EdgeRunStoreIo) that group E implements (edgeStreams.EdgeReportSink /
 * EdgeJournalConsume, edgeCentralClient.EdgeAuthorizeClient); fakes in foeRunStoreParity.dot10.test.ts.
 */
import type { OrchestrationRun } from "../../../drizzle/schema";
import type { EquipmentCommand } from "../equipment/equipmentAdapter";
import { toRobotJob } from "../equipment/robotJobMapping";
import { FOE_ENGINE_TOOL, otPayloadHash, robotPayloadHash, type FoeGateApproval } from "../ot/otActionBinding";
import { allStepsOf, buildEquipmentCommand, commandOf, isRobotKind, isRobotStopStep, type StopVerification } from "../orchestration/foe/foeStepClass";
import {
  ABORT_ROW_PREFIX,
  abortSentOf,
  gateRequiredError,
  logAbortStop,
  priorStepsOf,
  type AbortAuditOp,
  type AbortSweepSource,
  type AuthorizeInput,
  type AuthorizeVerdict,
  type EdgeSegmentEnd,
  type RunStepPatch,
  type RunStore,
  type RunStoreContext,
  type RunStoreHeldReason,
  type RunStoreUser,
} from "../orchestration/foe/foeRunStore";
import type { GateRequiredReason } from "../orchestration/foe/foeGateApproval";
import type { MachineForValidation, WorkflowDefinition, WorkflowStep } from "../orchestration/foe/workflowModel";
import type { EdgeAuthorizeCommand, EdgeRunPackage, EdgeRunReportRecord, EdgeSweepPicture, EdgeEventRecord, EdgeSignedEnvelope } from "./edgeProtocol";
import { EdgeContractError } from "./edgeSigning";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A run-stream record before the journal numbers it (edgeJournal.EdgeRunRecordInput). */
export type EdgeRunRecordIn = DistributiveOmit<EdgeRunReportRecord, "seq">;
/** An events-stream record before the journal numbers it (edgeJournal.EdgeEventRecordInput). */
export type EdgeEventRecordIn = DistributiveOmit<EdgeEventRecord, "seq">;
/** What a journal append answers (edgeJournal.EdgeAppendResult). */
export type EdgeAppendLike = { seq: number; durable?: boolean } | { seq: null; dropped: true; reason: string };

/** The authorise request the store makes (edgeCentralClient.EdgeAuthorizeInput). */
export interface EdgeStepAuthorizeRequest {
  runId: number;
  claimSeq: number;
  claimToken: string;
  stepId: string;
  attempt: number;
  idempotencyKey: string;
  command: EdgeAuthorizeCommand;
  payloadHash: string;
}
/** Its answer (edgeCentralClient.EdgeAuthorizeOutcome — the signed answer already verified by the client). */
export type EdgeStepAuthorizeOutcome =
  | {
      ok: true;
      authorization: EdgeSignedEnvelope;
      claims: { jti: string; approval: { approvedBy: number; gateStepId: string | null } | null };
      ttlMs: number;
      reqNonce: string;
      /** informational (group A contract delta I3: the verifier takes the TTL start from the pending-nonce lookup) */
      requestSentMonoMs?: number;
      expiresAtMonoMs?: number;
    }
  | { ok: false; verdict: "refused" | "stopped" | "stale" | "unavailable"; code: string | null; reason?: string; abortRequested?: boolean };

/** What the edge store needs for ONE claimed segment (group E's EdgeRunIo is structurally compatible). */
export interface EdgeRunStoreIo {
  runId: number;
  claimSeq: number;
  claimToken: string;
  sink: {
    run(runId: number, claimSeq: number, rec: EdgeRunRecordIn, opts?: { stop?: boolean }): Promise<EdgeAppendLike>;
    event?(rec: EdgeEventRecordIn, opts?: { stop?: boolean }): Promise<EdgeAppendLike>;
  };
  /** admission of NEW non-STOP work (false: journal full / unhealthy — a STOP never asks) */
  consume?: { admitNonStop(): boolean };
  authorize: { authorize(input: EdgeStepAuthorizeRequest): Promise<EdgeStepAuthorizeOutcome> };
}

/**
 * The binding a command carries on the edge (group D: EquipmentCommand.edge — the edge dispatch front ends route on it and
 * verify `authorization` right before the driver call; a STOP carries none).
 */
export interface EdgeCommandBinding {
  authorization: { envelope: unknown; runId: number; claimSeq: number; stepId: string; attempt: number; idempotencyKey: string; reqNonce: string } | null;
  run: { runId: number; claimSeq: number; stepId: string; attempt: number } | null;
  source?: "command" | "anomaly" | "local";
  requestId?: number | null;
}
function bindEdge(cmd: EquipmentCommand, binding: EdgeCommandBinding): EquipmentCommand {
  (cmd as EquipmentCommand & { edge?: EdgeCommandBinding }).edge = binding;
  return cmd;
}

const GATE_REASONS: ReadonlySet<string> = new Set<GateRequiredReason>([
  "noGate",
  "approvedByOwner",
  "approvedByKeyHolder",
  "staleApproval",
  "programUnreadable",
  "ownerUnknown",
  "apiKeyInactive",
  "apiIdentityUnavailable",
  "apiRun",
]);
const HELD_REASONS: ReadonlySet<string> = new Set<RunStoreHeldReason>(["centralUnreachable", "journalFull", "keysetUnknown", "configStale"]);

/** The command body /authorize takes for this command — null ⇔ it names no adapter / robot / write (it could never be sent). */
export function edgeAuthorizeCommandOf(cmd: EquipmentCommand): { command: EdgeAuthorizeCommand; payloadHash: string } | null {
  if (typeof cmd.robotId === "number") {
    const job = toRobotJob(cmd);
    const params = (job.params ?? {}) as Record<string, unknown>;
    return {
      command: { kind: "robot", robotId: cmd.robotId, jobType: job.jobType as never, params },
      payloadHash: robotPayloadHash({ robotId: cmd.robotId, jobType: job.jobType, params: job.params ?? null }),
    };
  }
  if (typeof cmd.adapterId === "number" && (cmd.writes ?? []).length > 0) {
    const writes = (cmd.writes ?? []).map((w) => ({ tagKey: w.tagKey, value: w.value }));
    return {
      command: { kind: "ot", adapterId: cmd.adapterId, machineId: cmd.machineId ?? null, commandType: cmd.name, writes },
      // the SAME canonical hash ensureOrchestrationAction binds central's authorisation row to
      payloadHash: otPayloadHash({ tool: FOE_ENGINE_TOOL, adapterId: cmd.adapterId, machineId: cmd.machineId ?? null, commandType: cmd.name, writes: cmd.writes ?? [] }),
    };
  }
  return null;
}

const ms = (d: Date | null | undefined): number | null => (d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null);
const clip = (s: string | null | undefined, n: number): string | null => (s == null ? null : s.length <= n ? s : s.slice(0, n));

interface LocalRow {
  stepId: string;
  status: string;
  resultJson: Record<string, unknown> | null;
  startedAt: Date | null;
}

/** The robot STOP steps of a definition by the walker's own classifier (foeStepClass.isRobotStopStep) — no DB. */
function localRobotStops(p: { definition: unknown; machines: ReadonlyArray<{ id: number; machineType: string; capabilities: unknown }> }): string[] {
  const def = p.definition as { steps?: WorkflowStep[] } | null;
  if (!def || !Array.isArray(def.steps)) return [];
  const map = new Map<number, MachineForValidation>(p.machines.map((m) => [m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities as never }] as const));
  const out: string[] = [];
  for (const s of allStepsOf(def.steps)) {
    const c = commandOf(s, map);
    if (c && isRobotKind(c.cap.adapterKind) && isRobotStopStep(c)) out.push(s.id);
  }
  return out;
}

/** Shared by the segment store and the sweep-picture store. */
abstract class EdgeStoreBase implements RunStore {
  readonly kind = "edge" as const;
  /** the step rows of THIS process's writes, with central's upsert guards (the abort sweep's "rows" — no DB here) */
  protected readonly localRows = new Map<string, LocalRow>();
  protected readonly verifiedStopIds: Set<string>;
  protected readonly unsureStopIds: Set<string>;
  protected readonly resolvedAdapters: Map<string, number>;

  constructor(
    verifiedStops: ReadonlyArray<{ stepId: string }>,
    stopsUnsure: ReadonlyArray<string>,
    resolvedAdapters: ReadonlyArray<{ stepId: string; adapterId: number }>,
    picture?: { definition: unknown; machines: ReadonlyArray<{ id: number; machineType: string; capabilities: unknown }> },
  ) {
    this.verifiedStopIds = new Set(verifiedStops.map((s) => s.stepId));
    // fix review 1 — a ROBOT stop job is a STOP whatever the package lists (the local classifier needs no DB): it never asks.
    if (picture) for (const id of localRobotStops(picture)) this.verifiedStopIds.add(id);
    this.unsureStopIds = new Set(stopsUnsure);
    this.resolvedAdapters = new Map(resolvedAdapters.map((r) => [r.stepId, r.adapterId] as const));
  }

  /** central's upsertStep guards on the local mirror: 'running' never regresses a finished row; a failed abort row never a completed one */
  protected mirror(stepId: string, patch: RunStepPatch): void {
    const prev = this.localRows.get(stepId);
    if (prev) {
      if (patch.status === "running" && ["completed", "skipped", "compensated"].includes(prev.status)) return;
      if (patch.status === "failed" && stepId.startsWith(ABORT_ROW_PREFIX) && prev.status === "completed") return;
    }
    this.localRows.set(stepId, {
      stepId,
      status: patch.status,
      resultJson: patch.result !== undefined ? patch.result : prev?.resultJson ?? null,
      startedAt: patch.startedAt ?? prev?.startedAt ?? null,
    });
  }

  abstract upsertStep(runId: number, stepId: string, stepType: string, patch: RunStepPatch): Promise<void>;
  abstract setStatusUnlessAborted(runId: number, status: OrchestrationRun["status"], patch?: Partial<OrchestrationRun>, onlyFrom?: Array<OrchestrationRun["status"]>): Promise<boolean>;
  abstract persistContext(rc: RunStoreContext): Promise<void>;
  abstract authorizeCommand(rc: RunStoreContext, step: Extract<WorkflowStep, { type: "command" }>, attempt: number, x: AuthorizeInput): Promise<AuthorizeVerdict>;
  abstract authorizeAbortStop(runId: number, user: RunStoreUser, step: Extract<WorkflowStep, { type: "command" }>, idempotencyKey: string, args: Record<string, unknown>, cmd: EquipmentCommand): Promise<void>;
  abstract sweepSource(x: { live?: RunStoreContext | null; run?: OrchestrationRun; hasLiveDriver?: (runId: number) => boolean }): Promise<AbortSweepSource | null>;
  protected abstract event(rec: EdgeEventRecordIn): void;

  /** The adapter an OT step writes through: explicit args.adapterId, else the one central resolved into the package. */
  async resolveAdapter(kind: string, _machineId: number, args: Record<string, unknown>, stepId: string): Promise<Record<string, unknown>> {
    if (isRobotKind(kind) || typeof args.adapterId === "number") return args;
    const id = this.resolvedAdapters.get(stepId);
    return typeof id === "number" ? { ...args, adapterId: id } : args; // unresolved ⇒ the dispatch refuses (fail-closed)
  }

  /** The package's VERIFIED stops (resolved centrally — makeStopVerifier + pins); `unsure` = may be stops, not verified. */
  async verifyStops(_runId: number, def: WorkflowDefinition): Promise<StopVerification> {
    const inDef = new Set<string>();
    const walk = (steps: WorkflowStep[] | undefined) => {
      for (const s of steps ?? []) {
        inDef.add(s.id);
        const n = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
        walk(n.steps);
        walk(n.then);
        walk(n.else);
        if (s.compensation) walk([s.compensation]);
      }
    };
    walk(def.steps);
    const ids = new Set([...this.verifiedStopIds].filter((id) => inDef.has(id)));
    const unsure = new Set([...this.unsureStopIds].filter((id) => inDef.has(id) && !ids.has(id)));
    return { ids, failed: unsure.size > 0, unsure };
  }

  /** The console line (as central) + an `anomaly` event for every decision that did NOT send a STOP (central audits it). */
  auditAbort(user: RunStoreUser, runId: number, operation: AbortAuditOp, metadata: Record<string, unknown>): void {
    logAbortStop(user, runId, operation, metadata);
    if (operation === "abortStopSent" || operation === "abortStopNotNeeded" || (operation === "abortStopResend" && metadata.outcome === "started")) return;
    let detail: string | null = null;
    try {
      detail = clip(JSON.stringify(metadata), 1_000);
    } catch {
      detail = null;
    }
    this.event({ kind: "anomaly", code: operation, runId, detail, at: Date.now() });
  }
}

/**
 * The store of ONE claimed segment of a run (created by group E's agent right after the claim, from the VERIFIED package).
 * `segmentEnd()` is what the agent reports with POST runs/:id/complete once the walk returned.
 */
export class EdgeRunStore extends EdgeStoreBase {
  private status: OrchestrationRun["status"] = "running";
  private lastPatch: Partial<OrchestrationRun> = {};
  private heldReason: RunStoreHeldReason | null = null;
  private ended = false;
  private readonly statuses: string[] = [];
  /** fix review 1 — the journal refused a non-STOP record (its reason): nothing further is authorised; the segment ends held */
  private journalRefused: string | null = null;
  /** commands whose dispatch result reached the journal (a later refused record of theirs ⇒ outcome unknown) */
  private readonly sentSteps = new Set<string>();
  /** commands SENT whose result could not be recorded — never sent again */
  private readonly outcomeUnknown = new Set<string>();
  private readonly priorAbortSent: Set<string>;
  /** the authorisation (jti) a NON-STOP command step last ran under — quoted by its rows (central checks it, design §2.6) */
  private readonly jtiByStep = new Map<string, string>();

  constructor(
    readonly pkg: EdgeRunPackage,
    private readonly io: EdgeRunStoreIo,
  ) {
    super(pkg.verifiedStops, pkg.stopsUnsure, pkg.resolvedAdapters, pkg);
    this.priorAbortSent = new Set(pkg.prior.abortSentBefore);
  }

  /**
   * the run stream record; a STOP's records are bounded by the journal (and by the walker's stopBoundedWrite).
   * fix review 1 — a REFUSED record never throws out of the walk: from then on no new non-STOP command is authorised (the next
   * one is HELD — not sent), a command already SENT whose result could not be recorded is OUTCOME-UNKNOWN (never sent again),
   * and the segment ends held(journalFull) naming those steps (segmentEnd). A STOP's refused record never holds the STOP.
   */
  private async journal(rec: EdgeRunRecordIn, stop: boolean): Promise<void> {
    let r: EdgeAppendLike;
    try {
      r = await this.io.sink.run(this.io.runId, this.io.claimSeq, rec, stop ? { stop: true } : undefined);
    } catch (err) {
      r = { seq: null, dropped: true, reason: `error: ${(err as Error)?.message ?? err}` };
    }
    if (r.seq !== null) {
      if (rec.kind === "step" && typeof (rec.result as { routedTo?: unknown } | null)?.routedTo === "string") this.sentSteps.add(rec.stepId);
      return;
    }
    const msg = `edge journal refused the ${rec.kind} record of run ${this.io.runId} (${r.reason})`;
    if (stop) {
      console.warn(`[EdgeRunStore] ${msg} — the STOP continues (L-7)`);
      return;
    }
    console.error(`[EdgeRunStore] ${msg} — no further non-STOP command is sent; the segment ends held`);
    this.journalRefused ??= r.reason;
    if (rec.kind === "step" && (this.sentSteps.has(rec.stepId) || typeof (rec.result as { routedTo?: unknown } | null)?.routedTo === "string")) this.outcomeUnknown.add(rec.stepId);
  }

  protected event(rec: EdgeEventRecordIn): void {
    void this.io.sink.event?.(rec).catch(() => undefined);
  }

  async upsertStep(runId: number, stepId: string, stepType: string, patch: RunStepPatch): Promise<void> {
    this.mirror(stepId, patch);
    // a gate row is central's own (written when central applies the paused segment end / the approval) — never reported
    if (stepType === "hitl_gate") return;
    if (stepId.startsWith(ABORT_ROW_PREFIX)) {
      const own = (patch.result as { stepId?: unknown } | null | undefined)?.stepId;
      const status = patch.status === "completed" ? "completed" : "failed";
      await this.journal(
        {
          kind: "abort_stop",
          stepId: typeof own === "string" ? own : stepId.slice(ABORT_ROW_PREFIX.length),
          status,
          result: { ...(patch.result ?? {}), ...(patch.error ? { error: clip(patch.error, 2_000) } : {}) },
          at: ms(patch.finishedAt ?? null) ?? Date.now(),
        },
        true,
      );
      return;
    }
    const isStop = this.verifiedStopIds.has(stepId);
    await this.journal(
      {
        kind: "step",
        stepId,
        stepType,
        status: patch.status as never,
        attempt: patch.attempt ?? 0,
        startedAt: ms(patch.startedAt ?? null),
        finishedAt: ms(patch.finishedAt ?? null),
        error: clip(patch.error ?? null, 4_000),
        // no result in the patch ⇒ null ⇒ central KEEPS the stored result (the upsertStep rule)
        result: patch.result ?? null,
        jti: isStop ? null : this.jtiByStep.get(stepId) ?? null,
      },
      isStop,
    );
  }

  /** central's setRunStatusUnlessAborted on the segment's own status (central applies the END: applyEdgeSegmentEnd). */
  async setStatusUnlessAborted(_runId: number, status: OrchestrationRun["status"], patch: Partial<OrchestrationRun> = {}, onlyFrom?: Array<OrchestrationRun["status"]>): Promise<boolean> {
    if (this.status === "aborted") return false;
    if (onlyFrom && !onlyFrom.includes(this.status)) return false;
    this.status = status;
    this.statuses.push(status);
    this.lastPatch = patch;
    if (status === "completed" || status === "failed" || status === "aborted" || status === "awaiting_confirm" || status === "held") this.ended = true;
    return true;
  }

  async persistContext(rc: RunStoreContext): Promise<void> {
    await this.journal({ kind: "context", patch: { ...rc.context, telemetry: Object.fromEntries(rc.telemetry), states: Object.fromEntries(rc.states) } }, false);
  }

  async authorizeCommand(rc: RunStoreContext, step: Extract<WorkflowStep, { type: "command" }>, attempt: number, x: AuthorizeInput): Promise<AuthorizeVerdict> {
    const args = await this.resolveAdapter(x.cap.adapterKind, step.machineId, x.rawArgs, step.id);
    const probe = buildEquipmentCommand(x.descriptor, x.cap, step.machineId, args, x.idempotencyKey, rc.user);
    const run = { runId: this.io.runId, claimSeq: this.io.claimSeq, stepId: step.id, attempt };
    // L-7 — a VERIFIED STOP (robot abort / pinned OT stop, verified centrally into the package) never asks anyone.
    if (this.verifiedStopIds.has(step.id) || (x.robotKind && x.isStop)) return { ok: true, cmd: bindEdge(probe, { authorization: null, run, source: "local" }), args, approval: null };
    // Everything else (an UNPINNED stop-typed write included — not a STOP, R-5-j) needs a fresh, single-use authorisation.
    if (this.journalRefused !== null || this.outcomeUnknown.has(step.id)) return this.unavailable(step.id, "journalFull");
    if (this.io.consume && this.io.consume.admitNonStop() === false) return this.unavailable(step.id, "journalFull");
    const body = edgeAuthorizeCommandOf(probe);
    if (!body) {
      // data-raw-ok: an edge refusal recorded on the step row (machine-to-machine), like FOE_GATE_REQUIRED
      return { ok: false, verdict: "refused", error: `EDGE_AUTHORIZE_REFUSED(commandUnresolved): command step "${step.id}" was not sent: it names no adapter (with writes) or robot on this edge.`, reason: "commandUnresolved" };
    }
    let out: EdgeStepAuthorizeOutcome;
    try {
      out = await this.io.authorize.authorize({ ...run, claimToken: this.io.claimToken, idempotencyKey: x.idempotencyKey, command: body.command, payloadHash: body.payloadHash });
    } catch (err) {
      console.warn(`[EdgeRunStore] run ${this.io.runId} step ${step.id}: authorize failed — held (${(err as Error)?.message ?? err})`);
      return this.unavailable(step.id, "centralUnreachable");
    }
    if (out.ok) {
      const a = out.claims.approval;
      const approval: FoeGateApproval | null = a ? { runId: this.io.runId, runOwner: rc.runOwner, approvedBy: a.approvedBy, gateStepId: a.gateStepId ?? "" } : null;
      const cmd = approval ? buildEquipmentCommand(x.descriptor, x.cap, step.machineId, args, x.idempotencyKey, rc.user, approval) : probe;
      this.jtiByStep.set(step.id, out.claims.jti);
      bindEdge(cmd, {
        authorization: { envelope: out.authorization, runId: run.runId, claimSeq: run.claimSeq, stepId: step.id, attempt, idempotencyKey: x.idempotencyKey, reqNonce: out.reqNonce },
        run,
        source: "local",
      });
      return { ok: true, cmd, args, approval };
    }
    switch (out.verdict) {
      case "stopped":
        return { ok: false, verdict: "stopped" };
      case "stale":
        return out.abortRequested ? { ok: false, verdict: "stopped" } : { ok: false, verdict: "stale" };
      case "unavailable":
        return this.unavailable(step.id, out.code === "no_config" ? "configStale" : HELD_REASONS.has(String(out.code)) ? (out.code as RunStoreHeldReason) : "centralUnreachable");
      default:
        return { ok: false, verdict: "refused", error: refusalError(step.id, out.code, out.reason), reason: out.reason ?? out.code ?? undefined };
    }
  }

  private unavailable(stepId: string, reason: RunStoreHeldReason): AuthorizeVerdict {
    this.heldReason = reason;
    // data-raw-ok: a held step's reason recorded on the step row (machine-to-machine); the Studio keys on EDGE_HELD(<reason>)
    return { ok: false, verdict: "unavailable", heldReason: reason, error: `EDGE_HELD(${reason}): command step "${stepId}" was not sent — no authorisation could be obtained from central; the run is held (Continue it once the edge is reachable again).` };
  }

  /** An abort STOP never asks (L-7): it is bound to this run segment for the edge dispatch's ledger, nothing else. */
  bindAbortStop(runId: number, step: Extract<WorkflowStep, { type: "command" }>, cmd: EquipmentCommand): void {
    bindEdge(cmd, { authorization: null, run: { runId, claimSeq: this.io.claimSeq, stepId: step.id, attempt: 0 }, source: "local" });
  }

  /** no authorisation row on the edge (a STOP never asks) */
  async authorizeAbortStop(): Promise<void> {}

  /** The live walker's picture (as central's liveSweepSource), its "rows" = the package's prior picture + this segment's rows. */
  async sweepSource(x: { live?: RunStoreContext | null }): Promise<AbortSweepSource | null> {
    const rc = x.live;
    if (!rc) return null;
    const rows = [...this.localRows.values()];
    const fromRows = priorStepsOf(rows);
    const sentBefore = new Set([...this.priorAbortSent, ...abortSentOf(rows)]);
    return {
      def: rc.def,
      machineById: rc.machineById,
      rowsKnown: true,
      settled: (id) => rc.completed.has(id) || rc.prior.settled.has(id) || rc.settled.has(id) || rc.dispatched.has(id),
      branchOf: (id) => {
        const b = rc.context[`branch:${id}`];
        return b === "then" || b === "else" ? b : rc.prior.branches.get(id);
      },
      startOrder: [...rc.prior.startOrder, ...rc.startOrder],
      mayHaveActuated: (id) => rc.prior.unknown || rc.attempted.has(id) || rc.prior.attempted.has(id) || fromRows.attempted.has(id),
      sentBefore,
    };
  }

  /** How the segment ended (POST complete); null ⇔ the walk has not ended (or let go of a stale claim). */
  segmentEnd(): EdgeSegmentEnd | null {
    if (!this.ended) return null;
    if (this.journalRefused !== null && this.status !== "aborted") {
      const unknown = [...this.outcomeUnknown];
      // data-raw-ok: machine-readable prefixes (EDGE_OUTCOME_UNKNOWN(<steps>) / EDGE_HELD(journalFull)) — central parses the first
      const error = unknown.length
        ? `EDGE_OUTCOME_UNKNOWN(${unknown.join(",")}): sent, but the result could not be recorded (journal: ${this.journalRefused}) — never sent again; the run is held.`
        : `EDGE_HELD(journalFull): the journal refused a record (${this.journalRefused}) — nothing further was sent; the run is held.`;
      return { outcome: "held", heldReason: "journalFull", error: clip(error, 4_000) ?? undefined, ...(unknown.length ? { outcomeUnknown: unknown } : {}) };
    }
    const error = typeof this.lastPatch.error === "string" ? this.lastPatch.error : undefined;
    switch (this.status) {
      case "completed":
        return { outcome: "completed" };
      case "failed":
        return { outcome: "failed", ...(error ? { error } : {}) };
      case "aborted":
        return { outcome: "aborted", ...(error ? { error } : {}) };
      case "awaiting_confirm":
        return typeof this.lastPatch.currentStepId === "string" ? { outcome: "paused", gateStepId: this.lastPatch.currentStepId } : { outcome: "failed", error: "paused without a gate" };
      case "held":
        return { outcome: "held", heldReason: this.heldReason ?? "centralUnreachable", ...(error ? { error } : {}) };
      default:
        return null;
    }
  }

  /** the walker's run-status calls on this segment, in order (logs / tests — central applies only the END) */
  statusLog(): string[] {
    return [...this.statuses];
  }

  /** for tests / the agent's logs */
  jtiOf(stepId: string): string | null {
    return this.jtiByStep.get(stepId) ?? null;
  }
}

function refusalError(stepId: string, code: string | null, reason: string | undefined): string {
  if (code === "gate_required" && reason && GATE_REASONS.has(reason)) return gateRequiredError(stepId, reason as GateRequiredReason);
  if (code === "device_refused") {
    // data-raw-ok: the code prefix EDGE_DEVICE_REFUSED(<gate>) is machine-readable (central's device gate, design §2.5 step 7)
    return `EDGE_DEVICE_REFUSED(${reason ?? "unknown"}): command step "${stepId}" was not sent: central's device check refused it (${reason ?? "unknown"}).`;
  }
  // data-raw-ok: the code prefix EDGE_AUTHORIZE_REFUSED(<code>) is machine-readable (the /authorize error code)
  return `EDGE_AUTHORIZE_REFUSED(${code ?? "refused"}): command step "${stepId}" was not sent: central refused its authorisation${reason ? ` (${clip(reason, 300)})` : ""}.`;
}

/** Group E's agent: the store of one claimed segment, from the VERIFIED run package (edgeTrust.verifyEdgeRunPackage). */
export function createEdgeRunStore(pkg: EdgeRunPackage, io: EdgeRunStoreIo): EdgeRunStore {
  if (pkg.runId !== io.runId || pkg.claimSeq !== io.claimSeq) throw new EdgeContractError("package_mismatch", `edge run store: the package (run ${pkg.runId}, claim ${pkg.claimSeq}) is not for run ${io.runId} claim ${io.claimSeq}`);
  return new EdgeRunStore(pkg, io);
}

// ── re-sending the unconfirmed STOPs of an ABORTED run from a signed sweep picture (pull `stopsUnconfirmed`) ───────────

/** What the sweep-picture store needs: where its abort-STOP outcomes go (no claim exists any more — group E maps them). */
export interface EdgeSweepStoreIo {
  /** the outcome of one re-sent STOP (an `abort_stop` record; E converts it into `stop` events when no claim is current) */
  abortStop(rec: Extract<EdgeRunRecordIn, { kind: "abort_stop" }>): Promise<void> | void;
  event?(rec: EdgeEventRecordIn): Promise<unknown> | void;
}

/**
 * The store of a STOP re-send from a VERIFIED sweep picture (edgeTrust.verifyEdgeSweepPicture): no walker, no claim, no
 * authorisation — only STOPs. Whether the run acted is NOT decided from the picture: a picture is only issued for a run whose
 * STOPs a sweep already decided to send and could not confirm, and central's rows lag this edge's own journal ⇒ counted as
 * acted (STOP direction, R-6-c).
 */
export class EdgeSweepStore extends EdgeStoreBase {
  constructor(
    readonly picture: EdgeSweepPicture,
    private readonly io: EdgeSweepStoreIo,
  ) {
    super(picture.verifiedStops, picture.stopsUnsure, [], picture);
  }

  protected event(rec: EdgeEventRecordIn): void {
    void Promise.resolve(this.io.event?.(rec)).catch(() => undefined);
  }

  async upsertStep(_runId: number, stepId: string, _stepType: string, patch: RunStepPatch): Promise<void> {
    this.mirror(stepId, patch);
    if (!stepId.startsWith(ABORT_ROW_PREFIX)) return;
    const own = (patch.result as { stepId?: unknown } | null | undefined)?.stepId;
    await this.io.abortStop({
      kind: "abort_stop",
      stepId: typeof own === "string" ? own : stepId.slice(ABORT_ROW_PREFIX.length),
      status: patch.status === "completed" ? "completed" : "failed",
      result: { ...(patch.result ?? {}), ...(patch.error ? { error: clip(patch.error, 2_000) } : {}) },
      at: ms(patch.finishedAt ?? null) ?? Date.now(),
    });
  }

  async setStatusUnlessAborted(): Promise<boolean> {
    return false; // the run is central's and aborted: nothing to write
  }

  async persistContext(): Promise<void> {}

  async authorizeCommand(): Promise<AuthorizeVerdict> {
    // data-raw-ok: never reached — a sweep picture has no walker
    return { ok: false, verdict: "refused", error: "EDGE_AUTHORIZE_REFUSED(noWalker): a STOP re-send never walks the run." };
  }

  bindAbortStop(_runId: number, _step: Extract<WorkflowStep, { type: "command" }>, cmd: EquipmentCommand): void {
    bindEdge(cmd, { authorization: null, run: null, source: "local" });
  }

  async authorizeAbortStop(): Promise<void> {}

  /** The picture's ADAPTERS are its verified pins' (an OT STOP is only ever sent on a verified stop's adapter). */
  override async resolveAdapter(kind: string, _machineId: number, args: Record<string, unknown>, stepId: string): Promise<Record<string, unknown>> {
    if (isRobotKind(kind) || typeof args.adapterId === "number") return args;
    const v = this.picture.verifiedStops.find((s) => s.stepId === stepId);
    return v && v.kind === "ot" ? { ...args, adapterId: v.adapterId } : args;
  }

  async sweepSource(): Promise<AbortSweepSource | null> {
    const def = this.picture.definition as unknown as WorkflowDefinition;
    const usable = def && Array.isArray(def.steps) ? def : null;
    const machineById = new Map<number, MachineForValidation>(this.picture.machines.map((m) => [m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities as never }] as const));
    const p = this.picture.prior;
    const settled = new Set(p.settled);
    const branches = new Map(p.branches.map((b) => [b.stepId, b.branch] as const));
    const rows = [...this.localRows.values()];
    return {
      def: usable,
      machineById,
      rowsKnown: !p.unknown,
      settled: (id) => settled.has(id),
      branchOf: (id) => branches.get(id),
      startOrder: [...p.startOrder],
      mayHaveActuated: () => true,
      sentBefore: new Set([...p.abortSentBefore, ...abortSentOf(rows)]),
    };
  }
}

/** The store of a STOP re-send from a VERIFIED sweep picture (foeEngine.resendStopsOfAbortedRun). */
export function createEdgeSweepStore(picture: EdgeSweepPicture, io: EdgeSweepStoreIo): EdgeSweepStore {
  return new EdgeSweepStore(picture, io);
}
