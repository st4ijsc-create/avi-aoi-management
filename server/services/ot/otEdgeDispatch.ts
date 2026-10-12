/**
 * doc 81 Đợt 10 task D (design §2.9, §2.13, §2.14) — the EDGE front end of an OT write. The edge has NO central DB: everything
 * central's dispatcher read from the DB comes from the SIGNED config snapshot, and every decision central owns (approval,
 * binding, commissioning, policy, interlock, ownership, central kill switch) arrives as the SIGNED per-step authorisation.
 *
 * NON-STOP, in order (fail-closed at every step — nothing reaches the device unless every step passed):
 *   1. the adapter must be in the snapshot (= owned by this node), enabled; each written tag present, enabled, writable;
 *   2. VERIFY the authorisation for exactly this command (edgeAuthorizationVerifier: signature, node, credential, context, the
 *      payload hash recomputed from the bytes about to be sent, the signed target = the snapshot's resolved writes, TTL from
 *      the request send, nonce pending, jti unused) — a refusal is journaled as an anomaly;
 *   3. LOCAL GATES: a connected driver, journal admission (full ⇒ no new non-STOP), the safety-PLC preflight (snapshot configs);
 *   4. re-check the window, then CONSUME the jti in the journal (durable BEFORE the send) — refused ⇒ nothing sent;
 *   5. mode: central's signed `mode` simulated or this edge's OT_CONTROL off ⇒ simulated (nothing sent);
 *   6. the DEVICE STAGE (otDeviceWrite: queue, write, read-back, STOP watch, slot hold) — shared with central;
 *   7. REPORT: one ledger record (run stream) quoting the jti; central writes command_log from it.
 * STOP (L-7): a stop-typed command whose writes are EXACTLY the snapshot's pinned (tag, value) pairs, sent through a running
 * connection whose fingerprint equals the snapshot adapter's (replaces runningConnectionMatchesAdapterRow), is sent AT ONCE:
 * no authorisation, no verifier, no consume, no safety preflight, never BUSY (priority in the queue). Anything else typed
 * "stop" is NOT a verified stop and takes the non-STOP path (as on central).
 */
import { classifyOtStop, canonicalisePinnedStop, isStopCommandType, NO_CONFIRMER, type DispatchInput, type DispatchStatus } from "./commandDispatcher";
import { executeOtDeviceWrite, isCmdSerializeEnabled, isSuperseded, tryEnqueueAdapterCommand, type ExecutedWrite, type OtDeviceEventSink } from "./otDeviceWrite";
import { getActiveConnectionFingerprint, getActiveDriver } from "./otManager";
import { stopPinsFromTagRows } from "./stopPin";
import { isOtSafetyPreflightEnabled, safetyPreflightReason } from "./safetyPreflightPolicy";
import { withDeadline } from "./drivers/boundedClose";
import { edgeAuthorizationStillValid, verifyEdgeStepAuthorization, type EdgeStepAuthorization } from "../edge/edgeAuthorizationVerifier";
import { edgeDeviceRuntime, envOtControlEnabled, type EdgeDeviceRuntime } from "../edge/edgeDeviceRuntime";
import type { EdgeConfigSnapshot } from "../edge/edgeProtocol";
import { STOP_DB_STEP_DEADLINE_MS } from "../robot/stopJob";

/** Same bound as central's OT safety preflight (commandDispatcher.OT_SAFETY_PREFLIGHT_DEADLINE_MS). */
const EDGE_OT_SAFETY_PREFLIGHT_DEADLINE_MS = 5000;

export interface EdgeOtDispatchInput {
  adapterId: number;
  machineId?: number | null;
  commandType: string;
  writes: Array<{ tagKey: string; value: unknown }>;
  idempotencyKey: string;
  /** the signed per-step authorisation (non-STOP); never needed for a verified STOP */
  authorization?: EdgeStepAuthorization | null;
  /** the run step this command belongs to (ledger record on the run stream); absent ⇒ a console / local STOP (events stream) */
  run?: { runId: number; claimSeq: number; stepId: string; attempt: number } | null;
  source?: "command" | "anomaly" | "local";
  /** robot_motion_lock_requests.id of a central STOP command */
  requestId?: number | null;
  deadlineMs?: number;
}

export interface EdgeOtDispatchResult {
  ok: boolean;
  status: DispatchStatus;
  reason?: string;
  /** the refusal detail (e.g. the verifier's reason) — never a secret */
  detail?: string;
  stop: boolean;
  pinnedStop?: boolean;
  jti?: string;
  results: Array<{ tagKey: string; ok: boolean; status: DispatchStatus; error?: string }>;
}

type SnapshotAdapter = EdgeConfigSnapshot["adapters"][number];
type Resolved = { write: { tagKey: string; value: unknown }; address: string; dataType?: string; scale?: number; offset?: number };

function commandTimeoutMs(deadlineMs?: number): number {
  const envDefault = Number(process.env.OT_CONTROL_TIMEOUT_MS ?? 5000) || 5000;
  if (typeof deadlineMs !== "number" || !Number.isFinite(deadlineMs) || deadlineMs <= 0) return envDefault;
  const maxRaw = Number(process.env.OT_CONTROL_TIMEOUT_MAX_MS);
  return Number.isFinite(maxRaw) && maxRaw > 0 ? Math.min(Math.trunc(deadlineMs), maxRaw) : Math.trunc(deadlineMs);
}

const refusal = (input: EdgeOtDispatchInput, reason: string, extra: Partial<EdgeOtDispatchResult> = {}): EdgeOtDispatchResult => ({
  ok: false,
  status: "rejected",
  reason,
  stop: false,
  results: input.writes.map((w) => ({ tagKey: w.tagKey, ok: false, status: "rejected" as DispatchStatus, error: reason })),
  ...extra,
});

/** Resolve every write against the snapshot adapter's tags (present, enabled, writable). */
function resolveWrites(adapter: SnapshotAdapter, writes: EdgeOtDispatchInput["writes"]): { ok: true; resolved: Resolved[] } | { ok: false; reason: "TAG_NOT_FOUND" | "TAG_NOT_WRITABLE" } {
  const resolved: Resolved[] = [];
  for (const w of writes) {
    const tag = adapter.tags.find((t) => t.tagKey === w.tagKey);
    if (!tag || tag.isEnabled !== true) return { ok: false, reason: "TAG_NOT_FOUND" };
    if (tag.writable !== true) return { ok: false, reason: "TAG_NOT_WRITABLE" };
    resolved.push({ write: { tagKey: w.tagKey, value: w.value }, address: tag.address, dataType: tag.dataType, scale: tag.scale ?? undefined, offset: tag.offset ?? undefined });
  }
  return { ok: true, resolved };
}

/**
 * Is this a VERIFIED pinned STOP on the edge? Exactly the central rule (classifyOtStop + canonicalisePinnedStop) over the SIGNED
 * snapshot's tag rows, plus the running connection's fingerprint = the snapshot adapter's connectionFingerprint.
 */
export function classifyEdgeOtStop(
  input: Pick<EdgeOtDispatchInput, "commandType" | "writes">,
  adapter: SnapshotAdapter | undefined,
  runningFingerprint: string | undefined,
): { pinned: true; resolved: Resolved[] } | { pinned: false; why: string } {
  if (!isStopCommandType(input.commandType)) return { pinned: false, why: "not_stop_typed" };
  if (!adapter) return { pinned: false, why: "no_snapshot_adapter" };
  const pins = stopPinsFromTagRows(adapter.tags.map((t) => ({ tagKey: t.tagKey, dataType: t.dataType, stopValue: t.stopValue ?? null, writable: t.writable, isEnabled: t.isEnabled })));
  const cls = classifyOtStop(input.commandType, input.writes, pins);
  if (!cls.isStop || !cls.pinnedStop) return { pinned: false, why: cls.isStop ? cls.stopPinReason : "not_stop_typed" };
  const r = resolveWrites(adapter, input.writes);
  if (!r.ok) return { pinned: false, why: "pin_tag_changed" };
  const canon = canonicalisePinnedStop(r.resolved, cls.writes);
  if (!canon.ok) return { pinned: false, why: canon.reason };
  if (!runningFingerprint || runningFingerprint !== adapter.connectionFingerprint) return { pinned: false, why: "adapter_connection_stale" };
  r.resolved.forEach((x, i) => {
    x.write = { ...canon.writes[i] };
  });
  return { pinned: true, resolved: r.resolved };
}

/**
 * R-10-x (fix review 1) — the device stage's alarms / audits on the edge: an `anomaly` event through the injected journal
 * (E's report sink → central), never a DB path. No runtime ⇒ logged only (never the DB either).
 */
function deviceEventSink(rt: EdgeDeviceRuntime | null, input: EdgeOtDispatchInput): OtDeviceEventSink {
  return (ev) => {
    if (!rt) {
      console.error(`[EdgeOt] ${ev.critical ? "CRITICAL " : ""}${ev.action}: ${ev.message}`);
      return;
    }
    void Promise.resolve()
      .then(() => rt.journal.appendEvent({ kind: "anomaly", code: ev.action.slice(0, 64), runId: input.run?.runId ?? null, detail: ev.message.slice(0, 1000), at: Date.now() }, { stop: ev.critical }))
      .catch((err) => console.error(`[EdgeOt] journaling ${ev.action} failed:`, (err as Error)?.message ?? err));
  };
}

async function runDeviceStage(
  rt: EdgeDeviceRuntime | null,
  input: EdgeOtDispatchInput,
  driver: NonNullable<ReturnType<typeof getActiveDriver>>,
  resolved: Resolved[],
  pinnedStop: boolean,
): Promise<{ kind: "done"; executed: ExecutedWrite } | { kind: "busy"; detail: string } | { kind: "superseded" }> {
  const di: DispatchInput = {
    adapterId: input.adapterId,
    machineId: input.machineId ?? null,
    commandType: input.commandType,
    writes: resolved.map((r) => ({ ...r.write })),
    triggeredBy: { kind: "hitl", requestedBy: NO_CONFIRMER },
    idempotencyKey: input.idempotencyKey,
  };
  const driverWrites = resolved.map((r) => ({ tagKey: r.write.tagKey, address: r.address, value: r.write.value, dataType: r.dataType as never, scale: r.scale, offset: r.offset }));
  const body = () =>
    executeOtDeviceWrite({
      input: di,
      driver,
      resolved,
      driverWrites,
      timeoutMs: commandTimeoutMs(input.deadlineMs),
      stopTyped: isStopCommandType(input.commandType),
      ledger: { intentIds: [], confirmedBy: NO_CONFIRMER },
      sink: deviceEventSink(rt, input),
    });
  if (!isCmdSerializeEnabled()) return { kind: "done", executed: await body() };
  const enq = tryEnqueueAdapterCommand(input.adapterId, body, {
    priorityStop: pinnedStop,
    ...(pinnedStop ? { stopRef: { idempotencyKey: input.idempotencyKey, commandType: input.commandType, edge: true } } : {}),
    holdSlot: (v) => v.slotHold,
  });
  if (!enq.accepted) return { kind: "busy", detail: `adapter command queue full (depth ${enq.depth} >= max ${enq.max})` };
  const queued = await enq.result;
  if (isSuperseded(queued)) return { kind: "superseded" };
  return { kind: "done", executed: queued };
}

function rollUp(executed: ExecutedWrite): { ok: boolean; status: DispatchStatus } {
  const allOk = executed.outcomes.length > 0 && executed.outcomes.every((o) => o.ok);
  if (!allOk) return { ok: false, status: executed.timedOut ? "timeout" : "failed" };
  if (executed.outcomes.every((o) => o.status === "acked_verified")) return { ok: true, status: "acked_verified" };
  if (executed.outcomes.some((o) => o.status === "acked_unverified")) return { ok: true, status: "acked_unverified" };
  return { ok: true, status: "acked" };
}

/** Journal the outcome (bounded for a STOP — never holds it past the bound; a journal failure never flips the result). */
async function report(rt: EdgeDeviceRuntime | null, input: EdgeOtDispatchInput, stop: boolean, jti: string | null, res: EdgeOtDispatchResult): Promise<void> {
  if (!rt) return;
  const at = Date.now();
  try {
    let p: Promise<unknown>;
    if (input.run) {
      p = rt.journal.appendRun(
        input.run.runId,
        input.run.claimSeq,
        {
          kind: "ledger",
          stepId: input.run.stepId,
          attempt: input.run.attempt,
          idempotencyKey: input.idempotencyKey,
          jti,
          stop,
          target: { adapterId: input.adapterId, commandType: input.commandType },
          status: res.status,
          result: { reason: res.reason ?? null, pinnedStop: res.pinnedStop ?? false, results: res.results },
          at,
        },
        { stop },
      );
    } else if (stop) {
      p = rt.journal.appendEvent(
        { kind: "stop", target: { adapterId: input.adapterId }, source: input.source ?? "local", requestId: input.requestId ?? null, outcome: res.ok ? (res.status === "simulated" ? "simulated" : "sent") : "failed", at, detail: res.reason ?? null },
        { stop: true },
      );
    } else return;
    await (stop ? withDeadline(p, STOP_DB_STEP_DEADLINE_MS, "edge STOP journal") : p);
  } catch (err) {
    console.error(`[EdgeOt] journal record of a ${stop ? "STOP" : "command"} on adapter ${input.adapterId} failed (the device outcome stands):`, (err as Error)?.message ?? err);
  }
}

function anomaly(rt: EdgeDeviceRuntime, input: EdgeOtDispatchInput, code: string, detail: string): void {
  void Promise.resolve()
    .then(() => rt.journal.appendEvent({ kind: "anomaly", code, runId: input.run?.runId ?? null, detail: `adapter ${input.adapterId}: ${detail}`.slice(0, 1000), at: Date.now() }))
    .catch(() => undefined);
}

/** Dispatch one OT command on the edge. Never throws for the expected refusals. */
export async function dispatchOtOnEdge(input: EdgeOtDispatchInput, rt: EdgeDeviceRuntime | null = edgeDeviceRuntime()): Promise<EdgeOtDispatchResult> {
  const cfg = rt?.config() ?? null;
  const adapter = cfg?.adapters.find((a) => a.id === input.adapterId);
  const controlOn = () => (rt?.otControlEnabled ?? envOtControlEnabled)();

  // ── STOP (L-7): classified FIRST, from the signed snapshot only — no verifier, no nonce, no consume, no preflight. ──
  const stopCls = classifyEdgeOtStop(input, adapter, getActiveConnectionFingerprint(input.adapterId));
  if (stopCls.pinned) {
    const stopInput = { ...input, writes: stopCls.resolved.map((r) => ({ ...r.write })) };
    let res: EdgeOtDispatchResult;
    const driver = getActiveDriver(input.adapterId);
    if (!controlOn()) {
      res = { ok: true, status: "simulated", stop: true, pinnedStop: true, results: stopInput.writes.map((w) => ({ tagKey: w.tagKey, ok: true, status: "simulated" as DispatchStatus })) };
    } else if (!driver) {
      res = { ok: false, status: "failed", reason: "ADAPTER_OFFLINE", stop: true, pinnedStop: true, results: stopInput.writes.map((w) => ({ tagKey: w.tagKey, ok: false, status: "failed" as DispatchStatus, error: "ADAPTER_OFFLINE" })) };
    } else {
      const stage = await runDeviceStage(rt, stopInput, driver, stopCls.resolved, true);
      if (stage.kind !== "done") {
        // unreachable for a pinned stop (never BUSY, never superseded) — kept total, reported honestly
        res = { ok: false, status: "rejected", reason: stage.kind === "busy" ? "BUSY" : "SUPERSEDED_BY_STOP", stop: true, pinnedStop: true, results: [] };
      } else {
        const roll = rollUp(stage.executed);
        res = {
          ...roll,
          stop: true,
          pinnedStop: true,
          results: stage.executed.outcomes.map((o) => ({ tagKey: stopCls.resolved[o.idx].write.tagKey, ok: o.ok, status: o.status, ...(o.errorText ? { error: o.errorText } : {}) })),
        };
      }
    }
    await report(rt, stopInput, true, null, res);
    return res;
  }

  // M-1 (fix review 1) — a STOP-TYPED command that is not a verified pinned STOP is never silent: it is journaled (a console
  // STOP from central gets its own failed `stop` record; any other one an anomaly) and every refusal below names why.
  const unpinnedStop = isStopCommandType(input.commandType) ? (stopCls as { why: string }).why : null;
  if (unpinnedStop && rt) {
    const at = Date.now();
    void Promise.resolve()
      .then(() =>
        input.source === "command" && !input.run
          ? rt.journal.appendEvent({ kind: "stop", target: { adapterId: input.adapterId }, source: "command", requestId: input.requestId ?? null, outcome: "failed", at, detail: `not a verified pinned stop (${unpinnedStop}) — nothing sent without an authorisation` }, { stop: true })
          : rt.journal.appendEvent({ kind: "anomaly", code: "EDGE_STOP_NOT_PINNED", runId: input.run?.runId ?? null, detail: `adapter ${input.adapterId} ${input.commandType}: not a verified pinned stop (${unpinnedStop})`, at }),
      )
      .catch(() => undefined);
  }
  const why = unpinnedStop ? { detail: `stop_not_pinned:${unpinnedStop}` } : {};

  // ── NON-STOP: verify → local gates → consume → device → report. ──
  if (!rt) return refusal(input, "EDGE_RUNTIME_UNAVAILABLE", why);
  if (!cfg) return refusal(input, "CONFIG_UNKNOWN", why);
  const deps = rt.auth();
  if (!deps) return refusal(input, "KEYSET_UNKNOWN", why);
  if (!input.authorization) return refusal(input, "AUTHORIZATION_REQUIRED", why);
  if (!input.run) return refusal(input, "RUN_CONTEXT_REQUIRED");
  if (!adapter) return refusal(input, "NOT_OWNED");
  if (adapter.isEnabled !== true) return refusal(input, "ADAPTER_DISABLED");
  const resolvedR = resolveWrites(adapter, input.writes);
  if (!resolvedR.ok) return refusal(input, resolvedR.reason);
  const resolved = resolvedR.resolved;

  const verdict = verifyEdgeStepAuthorization(
    deps,
    input.authorization,
    {
      kind: "ot",
      adapterId: input.adapterId,
      machineId: input.machineId ?? null,
      commandType: input.commandType,
      writes: input.writes,
      resolved: resolved.map((r) => ({ tagKey: r.write.tagKey, address: r.address, dataType: String(r.dataType), scale: r.scale ?? null, offset: r.offset ?? null })),
    },
    (jti) => rt.journal.isJtiConsumed(jti),
  );
  if (!verdict.ok) {
    anomaly(rt, input, "EDGE_AUTHORIZATION_REFUSED", `authorisation refused (${verdict.reason}) for step ${input.run.stepId}`);
    return refusal(input, "AUTHORIZATION_INVALID", { detail: verdict.reason });
  }
  // the authorisation must be for THIS step of THIS run (the walker's context, not the token's)
  const a = input.authorization;
  if (a.runId !== input.run.runId || a.claimSeq !== input.run.claimSeq || a.stepId !== input.run.stepId || a.attempt !== input.run.attempt || a.idempotencyKey !== input.idempotencyKey) {
    return refusal(input, "AUTHORIZATION_INVALID", { detail: "context_mismatch" });
  }

  const driver = getActiveDriver(input.adapterId);
  if (!driver) return { ...refusal(input, "ADAPTER_OFFLINE"), status: "failed" };
  if (rt.journal.admitNonStop && rt.journal.admitNonStop() !== true) return refusal(input, "JOURNAL_FULL");
  const simulated = verdict.mode === "simulated" || !controlOn();
  if (!simulated && isOtSafetyPreflightEnabled()) {
    let state = "UNKNOWN";
    let basis: string | undefined;
    try {
      const { createAdapterFacade } = await import("./adapterFacade");
      const s = await withDeadline(
        createAdapterFacade({ adapterId: input.adapterId, machineId: input.machineId ?? null }).getSafetyStatus({ forRealActuation: true }),
        EDGE_OT_SAFETY_PREFLIGHT_DEADLINE_MS,
        "edge OT safety preflight",
      );
      state = s?.state ?? "UNKNOWN";
      basis = s?.basis;
    } catch {
      state = "UNKNOWN";
    }
    if (state !== "OK") return refusal(input, state === "BLOCKED" ? "SAFETY_BLOCKED" : safetyPreflightReason(state, basis === "sim_only" ? "sim_only" : null));
  }
  if (!edgeAuthorizationStillValid(deps, verdict.expiresAtMonoMs)) return refusal(input, "AUTHORIZATION_INVALID", { detail: "expired" });
  const consumed = await rt.journal.consumeAuthorization({ jti: verdict.claims.jti, runId: a.runId, claimSeq: a.claimSeq, stepId: a.stepId, attempt: a.attempt });
  if (!consumed.ok) return refusal(input, "JOURNAL_CONSUME_FAILED", { detail: consumed.reason });
  const jti = verdict.claims.jti;

  let res: EdgeOtDispatchResult;
  if (simulated) {
    res = { ok: true, status: "simulated", stop: false, jti, results: input.writes.map((w) => ({ tagKey: w.tagKey, ok: true, status: "simulated" as DispatchStatus })) };
  } else {
    const stage = await runDeviceStage(rt, input, driver, resolved, false);
    if (stage.kind === "busy") res = { ...refusal(input, "BUSY", { detail: stage.detail }), jti };
    else if (stage.kind === "superseded") res = { ...refusal(input, "SUPERSEDED_BY_STOP"), jti };
    else {
      const roll = rollUp(stage.executed);
      res = {
        ...roll,
        stop: false,
        jti,
        results: stage.executed.outcomes.map((o) => ({ tagKey: resolved[o.idx].write.tagKey, ok: o.ok, status: o.status, ...(o.errorText ? { error: o.errorText } : {}) })),
      };
    }
  }
  await report(rt, input, false, jti, res);
  return res;
}
