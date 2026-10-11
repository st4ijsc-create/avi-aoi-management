/**
 * doc 81 Đợt 4 Task A5 + fix round 1 (rulings R-4-e … R-4-i) — WHICH gate approval lets an OT/robot step of an
 * orchestration run execute. ONE definition, used by:
 *   • the engine (foeEngine.execCommand → findSeparateGateApproval), before it creates the authorisation row, and
 *   • both dispatchers (commandDispatcher.reserveRealWrite / robotCommandDispatcher.reserveRobotJob), which RE-DERIVE
 *     the run owner and the gate approver from the DB rows (run + gate + workflow) inside the reservation transaction —
 *     never from what the engine wrote into the action's previewJson (R-4-i).
 *
 * A gate approval COUNTS only when ALL hold (fail-closed — anything else does not count):
 *   1. the `_run_steps` row is 'completed' and its step id is a `hitl_gate` in the definition being executed;
 *   2. resultJson = { approved: true, approvedBy: <positive int>, approvalSource: "server", defHash } — `approvalSource`
 *      is written ONLY by resumeRun's own approval path (ctx.user); an absent source, or "edge" (edgeCoordinator stamps
 *      every synced step row), or "system" (auto-resume, user 0) never counts (R-4-h, R-4-g);
 *   3. approvedBy ≠ the run owner (orchestration_runs.startedBy); a run with NO owner ⇒ nothing counts (R-4-f);
 *   4. defHash = hash of the definition being executed (R-4-e): a redeploy after the approval makes it STALE;
 *   5. doc 81 Đợt 5 task E3 (item 25) — bindingDigest = computeBindingDigest() of the CURRENT device configuration the
 *      definition's command steps resolve to (adapter, tags, robot): any change since the approval makes it STALE, and a
 *      digest that cannot be computed (DB error) or is absent (an approval recorded before E3) never counts.
 *      doc 81 Đợt 8 task O2 — the digest also covers the PROGRAM CHECKSUM of every OT adapter the commands write through
 *      when that adapter's controller supports it (ot/programChecksum.ts): a program changed in the controller since the
 *      approval ⇒ STALE; a supported adapter whose checksum cannot be read now ⇒ no digest ⇒ nothing counts (reason
 *      programUnreadable); an unsupported controller is recorded as not verifiable (approval.programChecks) and shown so.
 * Reasons when nothing counts: ownerUnknown / apiRun (identity) › programUnreadable › staleApproval › approvedByOwner ›
 * approvedByKeyHolder (Đợt 9 R2) › noGate.
 *
 * doc 81 Đợt 9 task R2 (owner decision 2026-10-12, OPTION A — replaces Đợt 5 E1 option C "API runs never actuate"):
 * a run started through an API key (runStartedViaApi) records WHICH key started it (orchestration_runs.startedViaApiKeyId,
 * mig 0369) and the key records WHO IT IS ISSUED TO (api_keys.holderUserId + the append-only api_key_holder_changes). For
 * such a run an approval counts only when the approver is NONE of {the run's starter (startedBy), the key's holder — now
 * or at any earlier time —, the key's creator} (deriveRunApprovalIdentity, re-derived from the DB rows by the engine AND
 * both dispatchers, never from the action). The run may then actuate like any other. Fail-closed:
 *   • an API-marked run whose key cannot be identified (no startedViaApiKeyId — started before 0369, an edge copy, 0369 not
 *     applied —, the key deleted, any read error) ⇒ nothing counts (reason `apiRun`, as under option C);
 *   • a key with no holder ⇒ `ownerUnknown` (as before).
 * Residual (procedural, documented): a holder who hands the secret to someone else is still out of reach — one key per
 * person, revoke and re-mint when it changes hands (changing the holder does NOT change the secret, which is why every
 * earlier holder stays excluded).
 * STOPs (L-7): the engine never refuses a STOP step for `apiRun` (it is sent exactly as before, without an approval);
 * the dispatchers never call foeApprovalDbRefusal for a PINNED OT stop or for any robot stop. What still reaches it is an
 * UNPINNED OT stop-typed write — the OT dispatcher already treats that as needing four-eyes (it may write any tag), so
 * for an API run it needs a counting approval under the rule above, like every other non-STOP write (R-4-x: an exemption
 * for STOP never extends to a write that is not a verified stop).
 * L-7 statement (doc 81 Đợt 8 final wave, review O M6 — owner-visible): since Đợt 8 O2 an UNPINNED stop-typed OT write
 * of an orchestration run whose binding includes a checksum-capable controller can be REFUSED (programUnreadable /
 * staleApproval) or DELAYED by up to PROGRAM_CHECKSUM_READ_DEADLINE_MS (1 s, read before the reservation — M2) by the
 * program checksum read. This is R-4-x applied (an unpinned stop is a non-STOP write: it may write any tag). A PINNED
 * stop and every robot stop read no checksum and are never refused or delayed by it; the hardware E-STOP is unaffected.
 */
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  orchestrationRunSteps,
  orchestrationRuns,
  orchestrationWorkflows,
  aiPendingActions,
  machines,
  deviceAdapters,
  deviceTags,
  robots,
} from "../../../../drizzle/schema";
import { getCapabilitiesForMachine } from "../../equipment/capabilityModel";
import { programChecksumCapable, readAdapterProgramCheck, robotProgramCheck, type ProgramCheck } from "../../ot/programChecksum"; // Đợt 8 O2
import { allStepsOf } from "./foeStepClass"; // doc 81 Đợt 5 task E fix 1 — THE step walk
import { readApiKeyParties, readRunApiKeyId } from "./runApiKeyIdentity"; // doc 81 Đợt 9 R2 (mig 0369, narrow projections)
import type { WorkflowDefinition, WorkflowStep } from "./workflowModel";

/** resultJson.approvalSource written by resumeRun's approval path (the only one that counts). */
export const FOE_APPROVAL_SOURCE_SERVER = "server";
/** Stamped by edgeCoordinator.syncRunResult on EVERY synced step result (never counts). */
export const FOE_APPROVAL_SOURCE_EDGE = "edge";
/** Written when user 0 (system auto-resume / API) resolves a gate (never counts). */
export const FOE_APPROVAL_SOURCE_SYSTEM = "system";

/** doc 81 Đợt 9 R2 — `approvedByKeyHolder`: the only approvals were given by the API key's holder (now / earlier) or creator. */
export type GateRequiredReason = "noGate" | "approvedByOwner" | "approvedByKeyHolder" | "staleApproval" | "ownerUnknown" | "apiRun" | "programUnreadable";

/**
 * doc 81 Đợt 9 task R2 — WHO may not give a counting approval for a run, as read from the DB rows NOW:
 *   • `owner` — orchestration_runs.startedBy (the starter; for an API run the key's holder at start);
 *   • `keyParties` — API runs only: the key's current holder, every earlier holder (api_key_holder_changes) and its
 *     creator. Empty for a run started by a user.
 */
export interface RunApprovalIdentity {
  owner: number;
  keyParties: number[];
  /** the key that started the run (API runs), else null */
  apiKeyId: number | null;
}
export type RunIdentityResult = { ok: true; identity: RunApprovalIdentity } | { ok: false; reason: "ownerUnknown" | "apiRun" };

/**
 * doc 81 Đợt 9 task R2 — THE derivation of RunApprovalIdentity, used by the engine (findSeparateGateApproval, gate
 * approval policy) and by both dispatchers (foeApprovalDbRefusal, inside their reservation transaction). `run` is the run
 * row as read from the DB by the caller; `viaApiHint` lets the engine add its in-memory marker (either ⇒ API run).
 * THROWS on a DB error (callers fail closed). Never reads anything from an action.
 */
export async function deriveRunApprovalIdentity(
  db: DbLike,
  run: { id: number; startedBy?: number | null; paramsJson?: unknown; contextJson?: unknown },
  opts: { viaApiHint?: boolean } = {},
): Promise<RunIdentityResult> {
  const owner = run.startedBy ?? null;
  if (!posInt(owner)) return { ok: false, reason: "ownerUnknown" };
  if (!(opts.viaApiHint === true || runStartedViaApi(run))) return { ok: true, identity: { owner, keyParties: [], apiKeyId: null } };
  const keyId = await readRunApiKeyId(db, run.id);
  if (keyId === null) return { ok: false, reason: "apiRun" };
  const key = await readApiKeyParties(db, keyId);
  if (!key) return { ok: false, reason: "apiRun" };
  if (key.holder === null) return { ok: false, reason: "ownerUnknown" };
  const parties = new Set<number>(key.everHolders);
  if (key.creator !== null) parties.add(key.creator);
  return { ok: true, identity: { owner, keyParties: [...parties].sort((a, b) => a - b), apiKeyId: keyId } };
}

/** doc 81 Đợt 9 R2 — the users whose approval never counts for this run (owner first). */
export function excludedApprovers(identity: RunApprovalIdentity): number[] {
  return [identity.owner, ...identity.keyParties.filter((u) => u !== identity.owner)];
}

/**
 * doc 81 Đợt 5 task E1 — the SERVER-ONLY marker of a run started through an API key (or by any non-user principal).
 * Written by foeEngine.startRun into BOTH `paramsJson[FOE_API_RUN_PARAM]` and `contextJson.startedViaApi`, never taken
 * from the caller as a way to LIFT the restriction. paramsJson is written once (at the INSERT) and nothing else writes it,
 * while contextJson is overwritten by an edge result sync (edgeCoordinator.syncRunResult) — so EITHER marker set ⇒ API run
 * (fail-closed: an edge payload can wipe contextJson but cannot remove the params marker).
 * doc 81 Đợt 9 R2 — the marker says "API run ⇒ the key identity rule applies"; WHICH key is only ever read from the
 * write-once column orchestration_runs.startedViaApiKeyId (never from params, which a caller / an edge copy supplies).
 */
export const FOE_API_RUN_PARAM = "__foeStartedViaApi";

/**
 * doc 81 Đợt 7 task I3 — the SERVER-ONLY record of the definition VERSIONS a run executed: `paramsJson[FOE_DEF_VERSIONS_PARAM]`
 * = [version at start, + the head version at each resume claim]. Written by foeEngine only (a caller's value is replaced at
 * start), only ever ADDED to (the apiRun marker and the caller's params are kept). Run visibility follows these versions
 * (foeEngine.runVisibilityDefinitions); a run WITHOUT the record (started before Đợt 7) is judged on the head definition.
 */
export const FOE_DEF_VERSIONS_PARAM = "__foeDefVersions";

/** The executed versions recorded on a run (positive integers, deduplicated, in order); null ⇔ no record (legacy run). */
export function runExecutedVersions(run: { paramsJson?: unknown } | null | undefined): number[] | null {
  const raw = (run?.paramsJson as Record<string, unknown> | null | undefined)?.[FOE_DEF_VERSIONS_PARAM];
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const v of raw) if (typeof v === "number" && Number.isInteger(v) && v > 0 && !out.includes(v)) out.push(v);
  return out.length ? out : null;
}

/**
 * doc 81 Đợt 7 task I6 — the SERVER-ONLY claim token a gate REJECTION with a compensation hook (QT) writes into
 * `contextJson` together with its claim ('compensating'). When the claim's reply is lost, the rejection re-reads the run
 * and finishes ONLY a claim that carries ITS token (never another decision's). Task I1 — while it is set on a central run,
 * an edge result sync never rewrites that run's status (a central rejection is in progress).
 */
export const FOE_REJECT_CLAIM_CTX_KEY = "foeRejectClaim";

/** doc 81 Đợt 5 task E1 — was this run started through an API key? (either server-written marker ⇒ yes) */
export function runStartedViaApi(run: { paramsJson?: unknown; contextJson?: unknown } | null | undefined): boolean {
  const params = run?.paramsJson as Record<string, unknown> | null | undefined;
  const ctx = run?.contextJson as Record<string, unknown> | null | undefined;
  return params?.[FOE_API_RUN_PARAM] === true || ctx?.startedViaApi === true;
}

/** Canonical JSON (keys sorted, recursive) ⇒ a definition hash independent of key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalize(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

/** Stable sha256 of a WorkflowDefinition (sim-gate binding + gate-approval binding, R-4-e). */
export function hashWorkflowDefinition(def: WorkflowDefinition): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(def))).digest("hex");
}

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(canonicalize(v ?? null))).digest("hex");
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

/**
 * doc 81 Đợt 5 task E3 (item 25, owner: follow the survey) — the BINDING DIGEST of a definition: what its command steps
 * resolve to in the device configuration RIGHT NOW, computed on the server only (never taken from a client):
 *   • the machine (id, machineType, hash of capabilities — it decides OT vs robot routing);
 *   • OT step: the resolved adapter — explicit args.adapterId, else the single ENABLED adapter bound to the machine
 *     (exactly foeEngine.withResolvedAdapter) — with its updatedAt / isEnabled / machineId, and every tag row the step
 *     writes (args.writes[].tagKey / args.tagKey on that adapter): id, address, dataType, scale, offset, updatedAt
 *     (a missing tag is recorded as missing);
 *   • robot step: the robot row (id, vendor, endpoint, hash of connectionOptions; NOT updatedAt/status, which the
 *     runtime bumps on every connection change).
 * Stored in the gate's resultJson at approval and recomputed by BOTH checks (engine + dispatchers): a different digest ⇒
 * staleApproval. RESIDUAL (documented, doc 81 §14): a program stored INSIDE a robot controller / PLC is invisible here —
 * doc 81 Đợt 8 O2 closes it for controllers that report a program checksum (computeBindingDetail); robots and every other
 * controller remain "cannot be verified" (shown plainly on the approver's screen).
 * null ⇒ could not be computed (fail-closed: an approval never counts against null).
 */
export async function computeBindingDigest(db: DbLike, def: Pick<WorkflowDefinition, "steps">): Promise<string | null> {
  return (await computeBindingDetail(db, def)).digest;
}

/**
 * doc 81 Đợt 8 task O2 — the binding digest TOGETHER with the program check of every OT adapter / robot the commands
 * use (what the approver's screen lists and what an approval records). The checksums of all supported adapters are read
 * CONCURRENTLY, each bounded by PROGRAM_CHECKSUM_READ_DEADLINE_MS. Any supported adapter "unreadable" ⇒ digest null
 * (fail-closed). An UNSUPPORTED adapter adds nothing to the digest (its digest is exactly the pre-O2 one) — it is listed
 * as "unsupported" and recorded so, never treated as verified. DB error ⇒ { digest: null, programs: [] }.
 */
export async function computeBindingDetail(
  db: DbLike,
  def: Pick<WorkflowDefinition, "steps">,
  /** final wave (review O M2) — program checks read BEFORE the caller's transaction (adapters missing here are read now). */
  pre?: PreReadPrograms,
): Promise<{ digest: string | null; programs: ProgramCheck[] }> {
  try {
    const b = await loadBinding(db, def);
    const checks = await Promise.all(b.adapters.map((a) => pre?.get(a.id as number) ?? readAdapterProgramCheck(a as never)));
    const byId = new Map(checks.map((c) => [c.id, c] as const));
    const digest = b.digestWith((id) => {
      const c = byId.get(id);
      return c?.status === "verified" && typeof c.checksum === "string" ? c.checksum : null;
    });
    return { digest, programs: [...checks, ...b.robots.map((r) => robotProgramCheck(r as never))] };
  } catch {
    return { digest: null, programs: [] };
  }
}

/**
 * doc 81 Đợt 8 final wave (review O M2) — the controller program checks of an orchestration action's run, read BEFORE the
 * dispatcher's reservation transaction, so no pool connection / advisory lock / FOR UPDATE row is held while a controller
 * is read (each read bounded by PROGRAM_CHECKSUM_READ_DEADLINE_MS, concurrent, single-flight).
 * Re-verification semantics: inside the transaction the binding digest is recomputed from the FRESH, locked DB rows
 * (machines, adapters, tags, robots) together with THESE checksums; an adapter the fresh rows name that was not pre-read
 * is read there (bounded, as before). The controller program is never under a DB lock, so reading it inside the
 * transaction gave no stronger guarantee: in both designs a program change between the read and the device write is
 * possible within the read deadline + the transaction time (documented residual), and an approval that no longer matches
 * a checksum read after it was given is refused. Any problem here (no row, not an orchestration action, DB error) ⇒
 * undefined ⇒ the transaction reads live (the pre-Đợt-8-final behaviour, fail-closed as before).
 */
export type PreReadPrograms = ReadonlyMap<number, ProgramCheck>;
export async function preReadProgramChecksForAction(db: DbLike, actionId: string, engineTool: string): Promise<PreReadPrograms | undefined> {
  try {
    const [pending] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, actionId)).limit(1);
    if (!pending || (pending as { tool?: unknown }).tool !== engineTool) return undefined;
    const ptr = ((pending as { previewJson?: unknown }).previewJson as Record<string, unknown> | null)?.["__foeGateApproval"] as { runId?: unknown } | undefined;
    if (!posInt(ptr?.runId)) return undefined;
    const [run] = await db.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, ptr!.runId as number)).limit(1);
    if (!run) return undefined;
    const [wf] = await db.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, (run as { workflowId: number }).workflowId)).limit(1);
    const def = (wf as { definitionJson?: WorkflowDefinition } | undefined)?.definitionJson;
    if (!def || !Array.isArray(def.steps)) return undefined;
    const b = await loadBinding(db, def);
    const checks = await Promise.all(b.adapters.map((a) => readAdapterProgramCheck(a as never)));
    return new Map(checks.map((c) => [c.id, c] as const));
  } catch {
    return undefined;
  }
}

/** doc 81 Đợt 8 O2 — what an approval records of the program checks (ids, status, checksum — no labels / sources). */
export function programChecksRecord(
  programs: readonly ProgramCheck[],
): Array<{ target: ProgramCheck["target"]; id: number; status: ProgramCheck["status"]; checksum?: string }> {
  return programs.map((p) =>
    p.status === "verified" && p.checksum ? { target: p.target, id: p.id, status: p.status, checksum: p.checksum } : { target: p.target, id: p.id, status: p.status },
  );
}

/**
 * doc 81 Đợt 8 O2 + L-7 — the binding digest of each gate row computed WITHOUT reading any controller: the configuration
 * is read now (DB), the program checksums are the ones THAT approval recorded (resultJson.programChecks). Used ONLY by the
 * engine on a STOP step, so a STOP never waits on a checksum read. Whether the program still matches is decided where a
 * write that is not a verified stop is sent: the OT dispatcher's foeApprovalDbRefusal reads the controller for an UNPINNED
 * stop-typed write (R-4-x), and a pinned stop / robot stop is never checked (L-7). A supported adapter without a recorded
 * verified checksum ⇒ null for that row. DB error ⇒ every row null (no approval counts; the engine still sends the STOP).
 */
export async function recordedProgramDigests(db: DbLike, def: Pick<WorkflowDefinition, "steps">): Promise<(row: GateRowLike) => string | null> {
  let b: LoadedBinding;
  try {
    b = await loadBinding(db, def);
  } catch {
    return () => null;
  }
  return (row) => {
    const rec = (row.resultJson as { programChecks?: unknown } | null | undefined)?.programChecks;
    const recorded = new Map<number, string>();
    if (Array.isArray(rec)) {
      for (const e of rec as Array<Record<string, unknown> | null>) {
        if (e && e.target === "adapter" && posInt(e.id) && e.status === "verified" && typeof e.checksum === "string" && e.checksum) recorded.set(e.id, e.checksum);
      }
    }
    return b.digestWith((id) => recorded.get(id) ?? null);
  };
}

interface LoadedBinding {
  /** The resolved, existing OT adapter rows the commands write through (sorted by id). */
  adapters: Array<Record<string, any>>;
  /** The existing robot rows the commands use (sorted by id). */
  robots: Array<Record<string, any>>;
  /** The digest, given the program checksum of each SUPPORTED adapter (null ⇒ unreadable ⇒ the whole digest is null). */
  digestWith: (checksumOf: (adapterId: number) => string | null) => string | null;
}

/** The DB half of the binding digest (Đợt 5 E3): every read, no controller I/O. Throws on a DB error. */
async function loadBinding(db: DbLike, def: Pick<WorkflowDefinition, "steps">): Promise<LoadedBinding> {
  const cmds = allStepsOf(def?.steps).filter(
    (s): s is Extract<WorkflowStep, { type: "command" }> => s.type === "command" && posInt((s as { machineId?: unknown }).machineId),
  );
  if (cmds.length === 0) return { adapters: [], robots: [], digestWith: () => sha([]) };
  const machineIds = [...new Set(cmds.map((s) => s.machineId))];
  const mRows = (await db.select().from(machines).where(inArray(machines.id, machineIds))) as Array<Record<string, any>>;
  const mById = new Map(mRows.map((m) => [m.id as number, m] as const));
  const kindOf = (mid: number): "robot" | "ot" | null => {
    const m = mById.get(mid);
    if (!m) return null;
    const k = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never }).adapterKind;
    return k === "robot" || k === "vda5050" ? "robot" : "ot";
  };
  const otMachines = [...new Set(cmds.filter((s) => kindOf(s.machineId) === "ot").map((s) => s.machineId))];
  const bound = otMachines.length
    ? ((await db.select().from(deviceAdapters).where(inArray(deviceAdapters.machineId, otMachines))) as Array<Record<string, any>>)
    : [];
  const resolveAdapter = (s: Extract<WorkflowStep, { type: "command" }>): number | null => {
    const explicit = (s.args ?? {}).adapterId;
    if (typeof explicit === "number") return explicit;
    const enabled = bound.filter((a) => a.machineId === s.machineId && a.isEnabled === true);
    return enabled.length === 1 ? (enabled[0].id as number) : null;
  };
  const resolved = new Map(cmds.filter((s) => kindOf(s.machineId) === "ot").map((s) => [s.id, resolveAdapter(s)] as const));
  const adapterIds = [...new Set([...resolved.values()].filter((v): v is number => posInt(v)))];
  const aRows = adapterIds.length
    ? ((await db.select().from(deviceAdapters).where(inArray(deviceAdapters.id, adapterIds))) as Array<Record<string, any>>)
    : [];
  const aById = new Map(aRows.map((a) => [a.id as number, a] as const));
  const tRows = adapterIds.length
    ? ((await db.select().from(deviceTags).where(inArray(deviceTags.adapterId, adapterIds))) as Array<Record<string, any>>)
    : [];
  const robotIds = [
    ...new Set(cmds.filter((s) => kindOf(s.machineId) === "robot").map((s) => (s.args ?? {}).robotId).filter((v): v is number => posInt(v))),
  ];
  const rRows = robotIds.length ? ((await db.select().from(robots).where(inArray(robots.id, robotIds))) as Array<Record<string, any>>) : [];
  const rById = new Map(rRows.map((r) => [r.id as number, r] as const));
  const tagKeysOf = (args: Record<string, unknown>): string[] => {
    const keys = Array.isArray(args.writes)
      ? (args.writes as Array<{ tagKey?: unknown }>).map((w) => w?.tagKey).filter((k): k is string => typeof k === "string")
      : typeof args.tagKey === "string"
        ? [args.tagKey]
        : [];
    return [...new Set(keys)].sort();
  };
  const digestWith = (checksumOf: (adapterId: number) => string | null): string | null => {
    let unreadable = false;
    const entries = cmds
      .map((s) => {
        const m = mById.get(s.machineId);
        const kind = kindOf(s.machineId);
        const args = (s.args ?? {}) as Record<string, unknown>;
        const base = {
          stepId: s.id,
          command: s.command,
          machine: m ? { id: m.id, machineType: m.machineType, caps: sha(m.capabilities) } : { id: s.machineId, missing: true },
          kind,
        };
        if (kind === "ot") {
          const aid = resolved.get(s.id) ?? null;
          const a = aid != null ? aById.get(aid) : undefined;
          // Đợt 8 O2 — a SUPPORTED controller adds its program checksum; an unsupported one adds nothing (pre-O2 digest).
          let program: { program?: string } = {};
          if (a && programChecksumCapable(a)) {
            const c = checksumOf(a.id as number);
            if (c === null) unreadable = true;
            else program = { program: c };
          }
          return {
            ...base,
            adapter:
              aid == null
                ? null
                : a
                  ? { id: a.id, machineId: a.machineId ?? null, isEnabled: a.isEnabled === true, updatedAt: iso(a.updatedAt), ...program }
                  : { id: aid, missing: true },
            tags: tagKeysOf(args).map((k) => {
              const t = aid == null ? undefined : tRows.find((r) => r.adapterId === aid && r.tagKey === k);
              return t
                ? { tagKey: k, id: t.id, address: t.address, dataType: t.dataType, scale: t.scale == null ? null : String(t.scale), offset: t.offset == null ? null : String(t.offset), updatedAt: iso(t.updatedAt) }
                : { tagKey: k, missing: true };
            }),
          };
        }
        if (kind === "robot") {
          const rid = args.robotId;
          const r = posInt(rid) ? rById.get(rid) : undefined;
          return { ...base, robot: !posInt(rid) ? null : r ? { id: r.id, vendor: r.vendor, endpoint: r.endpoint ?? null, conn: sha(r.connectionOptions) } : { id: rid, missing: true } };
        }
        return base;
      })
      .sort((x, y) => (x.stepId < y.stepId ? -1 : x.stepId > y.stepId ? 1 : 0));
    return unreadable ? null : sha(entries);
  };
  const byId = (x: Record<string, any>, y: Record<string, any>) => (x.id as number) - (y.id as number);
  return { adapters: [...aRows].sort(byId), robots: [...rRows].sort(byId), digestWith };
}

/** Depth-first lookup of a step by id anywhere in the tree (children, branches, compensation). */
export function findStepDeep(steps: WorkflowStep[] | undefined, id: string): WorkflowStep | undefined {
  for (const s of steps ?? []) {
    if (s.id === id) return s;
    const node = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    const hit =
      findStepDeep(node.steps, id) ??
      findStepDeep(node.then, id) ??
      findStepDeep(node.else, id) ??
      (s.compensation ? findStepDeep([s.compensation], id) : undefined);
    if (hit) return hit;
  }
  return undefined;
}

export interface GateRowLike {
  stepId: string;
  status: string;
  resultJson: unknown;
  finishedAt?: Date | string | null;
}

export interface CountingApproval {
  approvedBy: number;
  gateStepId: string;
  at: number;
}

export type GateEvaluation = { ok: true; approvals: CountingApproval[] } | { ok: false; reason: GateRequiredReason };

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** PURE — the counting approvals (latest first) or why there is none. */
export function evaluateGateApprovals(
  rows: readonly GateRowLike[],
  def: Pick<WorkflowDefinition, "steps">,
  defHash: string,
  /**
   * The run owner (startedBy) — or, doc 81 Đợt 9 R2, the whole RunApprovalIdentity (deriveRunApprovalIdentity): an
   * approval by the owner OR by any API-key party (holder now / earlier, creator) never counts.
   */
  runOwner: number | null | RunApprovalIdentity,
  /**
   * doc 81 Đợt 5 task E3 — computeBindingDigest() of the definition NOW (null ⇒ not computable ⇒ nothing counts).
   * doc 81 Đợt 8 O2 — or, on the engine's STOP path only, a per-row digest (recordedProgramDigests).
   */
  bindingDigest: string | null | ((row: GateRowLike) => string | null),
): GateEvaluation {
  const identity: { owner: number | null; keyParties: readonly number[] } =
    runOwner !== null && typeof runOwner === "object" ? runOwner : { owner: runOwner, keyParties: [] };
  const owner = identity.owner;
  if (!posInt(owner)) return { ok: false, reason: "ownerUnknown" };
  let sawStale = false;
  let sawOwner = false;
  let sawKeyParty = false;
  const approvals: CountingApproval[] = [];
  for (const r of rows) {
    if (r.status !== "completed") continue;
    const node = findStepDeep(def.steps, r.stepId);
    if (!node || node.type !== "hitl_gate") continue;
    const res = (r.resultJson ?? null) as {
      approved?: unknown;
      approvedBy?: unknown;
      approvalSource?: unknown;
      defHash?: unknown;
      bindingDigest?: unknown;
    } | null;
    if (!res || res.approved !== true || res.approvalSource !== FOE_APPROVAL_SOURCE_SERVER || !posInt(res.approvedBy)) continue;
    if (res.approvedBy === owner) {
      sawOwner = true;
      continue;
    }
    // doc 81 Đợt 9 R2 — the API key's holder (now or earlier) or creator: never a second person for this run.
    if (identity.keyParties.includes(res.approvedBy)) {
      sawKeyParty = true;
      continue;
    }
    // E3 — the definition (R-4-e) AND the device configuration it resolves to must be what the approver approved.
    const now = typeof bindingDigest === "function" ? bindingDigest(r) : bindingDigest;
    if (res.defHash !== defHash || now === null || typeof res.bindingDigest !== "string" || res.bindingDigest !== now) {
      sawStale = true;
      continue;
    }
    approvals.push({ approvedBy: res.approvedBy, gateStepId: r.stepId, at: r.finishedAt ? new Date(r.finishedAt).getTime() : 0 });
  }
  if (approvals.length > 0) return { ok: true, approvals: approvals.sort((a, b) => b.at - a.at) };
  return { ok: false, reason: sawStale ? "staleApproval" : sawOwner ? "approvedByOwner" : sawKeyParty ? "approvedByKeyHolder" : "noGate" };
}

/**
 * doc 81 Đợt 8 O2 — evaluateGateApprovals against the digest computed NOW with the controllers' program checksums: an
 * approval that is stale while a supported adapter's checksum could not be read is reported as `programUnreadable` (the
 * cause the operator can act on), not as a configuration change.
 */
export function evaluateWithPrograms(
  rows: readonly GateRowLike[],
  def: Pick<WorkflowDefinition, "steps">,
  defHash: string,
  runOwner: number | null | RunApprovalIdentity,
  detail: { digest: string | null; programs: readonly ProgramCheck[] },
): GateEvaluation {
  const ev = evaluateGateApprovals(rows, def, defHash, runOwner, detail.digest);
  if (!ev.ok && ev.reason === "staleApproval" && detail.programs.some((p) => p.status === "unreadable")) return { ok: false, reason: "programUnreadable" };
  return ev;
}

type DbLike = { select: (...a: any[]) => any };

/**
 * R-4-i — the dispatchers' DB layer. `pending` is the ai_pending_actions row being consumed (tool 'foe.orchestration').
 * The action's previewJson only POINTS at the run (runId); owner, approver and definition are read from the DB.
 * Returns null when the action is backed by a counting approval whose approver IS the action's confirmer (and the
 * requester, when named, is the run owner); otherwise the refusal detail. Any DB error ⇒ refusal (fail-closed).
 */
export async function foeApprovalDbRefusal(
  db: DbLike,
  pending: { userId: number; previewJson: unknown },
  requestedBy?: number | null,
  /** final wave (review O M2) — checksums read before the caller's transaction (preReadProgramChecksForAction). */
  prePrograms?: PreReadPrograms,
): Promise<string | null> {
  try {
    const ptr = (pending.previewJson as Record<string, unknown> | null)?.["__foeGateApproval"] as { runId?: unknown } | undefined;
    const runId = ptr?.runId;
    if (!posInt(runId)) return "orchestration action does not name its run — no separate gate approval can be verified";
    const [run] = await db.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return `orchestration run ${runId} not found — no separate gate approval can be verified`;
    // doc 81 Đợt 9 task R2 (option A, replaces Đợt 5 E1 option C) — owner AND, for an API-started run, the key's holder
    // (now / earlier) and creator, re-derived HERE from the run row and the api_keys rows (never from the action).
    const idr = await deriveRunApprovalIdentity(db, run as { id: number; startedBy: number | null; paramsJson: unknown; contextJson: unknown });
    if (!idr.ok) {
      return idr.reason === "apiRun"
        ? "orchestration run was started through an API key that cannot be identified (FOE_GATE_REQUIRED apiRun) — its OT/robot commands other than a STOP are refused"
        : "orchestration run has no attributable owner (ownerUnknown) — OT/robot commands are refused";
    }
    const { owner } = idr.identity;
    if (pending.userId === owner) return "orchestration action is confirmed by the run owner — a separate approval is required";
    if (idr.identity.keyParties.includes(pending.userId)) {
      return "orchestration action is confirmed by the holder or creator of the API key that started the run (FOE_GATE_REQUIRED approvedByKeyHolder) — a separate approval is required";
    }
    if (posInt(requestedBy) && requestedBy !== owner) return "orchestration action's requester is not the run owner";
    const [wf] = await db
      .select()
      .from(orchestrationWorkflows)
      .where(eq(orchestrationWorkflows.id, (run as { workflowId: number }).workflowId))
      .limit(1);
    const def = (wf as { definitionJson?: WorkflowDefinition } | undefined)?.definitionJson;
    if (!def || !Array.isArray(def.steps)) return "orchestration workflow definition not found";
    const rows = (await db.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId))) as GateRowLike[];
    // E3 + Đợt 8 O2 — configuration AND controller program checksums read now (bounded); unreadable ⇒ refused.
    const ev = evaluateWithPrograms(rows, def, hashWorkflowDefinition(def), idr.identity, await computeBindingDetail(db, def, prePrograms));
    if (!ev.ok) return `no counting gate approval for this run (FOE_GATE_REQUIRED ${ev.reason})`;
    if (!ev.approvals.some((a) => a.approvedBy === pending.userId)) {
      return "orchestration action's confirmer is not the approver of a counting gate of its run";
    }
    return null;
  } catch {
    return "gate approval could not be verified (DB error) — fail-closed";
  }
}
