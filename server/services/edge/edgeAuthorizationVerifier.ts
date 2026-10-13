/**
 * doc 81 Đợt 10 task D (design §2.13) — THE edge verifier of a per-step authorisation, called by the edge dispatch front ends
 * (otEdgeDispatch / robotEdgeDispatch) right before a NON-STOP command reaches a device. It is the ONLY module of group D that
 * talks to group A's edgeTrust (contract changes land here, nowhere else). It checks, fail-closed:
 *   • signature with a key the node's EdgeTrustStore trusts, the `auth` typ, this node, this credential (edgeTrust);
 *   • run / claim / step / attempt / idempotency key / kind / request nonce = the command's own context (edgeTrust);
 *   • the payload hash RECOMPUTED HERE from the EXACT command about to be sent (edgeCommandPayloadHash) — never the caller's;
 *   • the signed TARGET = the command's target: OT adapter + every write's (tagKey, address, dataType, scale, offset) as resolved
 *     from the signed config snapshot, in order; robot id + job type;
 *   • TTL ≤ the configured maximum, iat sane, the window measured on THIS process's monotonic clock from the moment the
 *     /authorize request was SENT (taken from the pending-nonce entry — a nonce this process issued and still waits on), and the
 *     jti never consumed (journal) (edgeTrust).
 * Never throws; a STOP never comes here (L-7 — the front ends classify it first).
 */
import { FOE_ENGINE_TOOL, otPayloadHash, robotPayloadHash } from "../ot/otActionBinding";
import type { EdgeAuthClaims } from "./edgeProtocol";
import type { EdgeTrustStore } from "./edgeSigning";
import { verifyEdgeAuthorization, type EdgeTrustFailure } from "./edgeTrust";

/**
 * What the edge run store (group C) hands the dispatcher with a NON-STOP command: the signed authorisation from POST
 * runs/:id/authorize and the context it was requested for (the walker's own step — never taken from the token).
 */
export interface EdgeStepAuthorization {
  /** the signed EdgeSignedEnvelope (typ auth) exactly as /authorize returned it */
  envelope: unknown;
  runId: number;
  claimSeq: number;
  stepId: string;
  attempt: number;
  idempotencyKey: string;
  /** the nonce of the /authorize request this answers (issued by THIS process) */
  reqNonce: string;
}

/** The trust inputs of the edge (group E wires them from its trust store, verified config and authorize client). */
export interface EdgeAuthorizationDeps {
  trust: EdgeTrustStore;
  /** node.credentialId of the VERIFIED config snapshot */
  credentialId: number;
  /** config limits.authTtlMs (capped at 30 s by edgeTrust) */
  maxTtlMs: number;
  /**
   * The pending entry of a nonce THIS process issued and still waits on: when its /authorize request was SENT (monotonic ms,
   * performance.now()). null ⇒ unknown / no longer pending (a restart forgets every nonce) ⇒ refused.
   */
  pendingNonce: (reqNonce: string) => { sentMonoMs: number } | null;
  /** monotonic now (default performance.now()) */
  nowMonoMs?: () => number;
}

/** The exact command about to be sent, as the device stage will send it. */
export type EdgeExactCommand =
  | {
      kind: "ot";
      adapterId: number;
      machineId: number | null;
      commandType: string;
      writes: ReadonlyArray<{ tagKey: string; value: unknown }>;
      /** each write's tag as resolved from the signed snapshot (what the driver writes with), in write order */
      resolved?: ReadonlyArray<{ tagKey: string; address: string; dataType: string; scale: number | null; offset: number | null }>;
    }
  | { kind: "robot"; robotId: number; jobType: string; params: Record<string, unknown> | null };

/**
 * THE payload hash of an edge step (central /authorize must hash its rebuilt command with this same function):
 *   OT    → otActionBinding.otPayloadHash({ tool: FOE_ENGINE_TOOL, adapterId, machineId, commandType, writes[{tagKey,value}] });
 *   robot → otActionBinding.robotPayloadHash({ robotId, jobType, params }).
 */
export function edgeCommandPayloadHash(cmd: EdgeExactCommand): string {
  if (cmd.kind === "ot") {
    return otPayloadHash({
      tool: FOE_ENGINE_TOOL,
      adapterId: cmd.adapterId,
      machineId: cmd.machineId ?? null,
      commandType: cmd.commandType,
      writes: cmd.writes.map((w) => ({ tagKey: w.tagKey, value: w.value })),
    });
  }
  return robotPayloadHash({ robotId: cmd.robotId, jobType: cmd.jobType, params: cmd.params ?? null });
}

export type EdgeAuthorizationFailure = EdgeTrustFailure | "no_authorization" | "target_mismatch";
export type EdgeAuthorizationVerdict =
  | { ok: true; claims: EdgeAuthClaims; expiresAtMonoMs: number; mode: "real" | "simulated" }
  | { ok: false; reason: EdgeAuthorizationFailure };

const sameNum = (a: number | null | undefined, b: number | null | undefined) => (a ?? null) === (b ?? null);

function targetMatches(claims: EdgeAuthClaims, cmd: EdgeExactCommand): boolean {
  if (claims.kind !== cmd.kind) return false;
  if (claims.kind === "robot" && cmd.kind === "robot") {
    return claims.target.robotId === cmd.robotId && claims.target.jobType === cmd.jobType;
  }
  if (claims.kind === "ot" && cmd.kind === "ot") {
    const signed = claims.target.writes;
    const resolved = cmd.resolved;
    if (claims.target.adapterId !== cmd.adapterId || !resolved || signed.length !== cmd.writes.length || resolved.length !== cmd.writes.length) return false;
    for (let i = 0; i < signed.length; i++) {
      const s = signed[i];
      const r = resolved[i];
      if (s.tagKey !== cmd.writes[i].tagKey || r.tagKey !== s.tagKey) return false;
      if (s.address !== r.address || s.dataType !== r.dataType || !sameNum(s.scale, r.scale) || !sameNum(s.offset, r.offset)) return false;
    }
    return true;
  }
  return false;
}

/** Verify `auth` for EXACTLY `cmd`. Never throws. */
export function verifyEdgeStepAuthorization(
  deps: EdgeAuthorizationDeps,
  auth: EdgeStepAuthorization | null | undefined,
  cmd: EdgeExactCommand,
  /** the journal's single-use record (`auth.consumed`) */
  isJtiConsumed: (jti: string) => boolean,
): EdgeAuthorizationVerdict {
  try {
    if (!auth || typeof auth !== "object") return { ok: false, reason: "no_authorization" };
    const now = deps.nowMonoMs ?? (() => performance.now());
    const r = verifyEdgeAuthorization(deps.trust, auth.envelope, {
      credentialId: deps.credentialId,
      runId: auth.runId,
      claimSeq: auth.claimSeq,
      stepId: auth.stepId,
      attempt: auth.attempt,
      idempotencyKey: auth.idempotencyKey,
      kind: cmd.kind,
      payloadHash: edgeCommandPayloadHash(cmd),
      reqNonce: auth.reqNonce,
      maxTtlMs: deps.maxTtlMs,
      nowMonoMs: now(),
      // R-10-f (A fix round 1, I3) — the TTL window starts at the FIRST send of the request with this nonce, taken from the
      // pending-nonce lookup itself (never a caller-supplied time); not pending ⇒ nonce_not_pending.
      pendingNonceSentAt: (n) => {
        const p = deps.pendingNonce(n);
        return p ? p.sentMonoMs : undefined;
      },
      isJtiConsumed: (jti) => isJtiConsumed(jti) !== false,
    });
    if (!r.ok) return { ok: false, reason: r.reason };
    if (!targetMatches(r.claims, cmd)) return { ok: false, reason: "target_mismatch" };
    return { ok: true, claims: r.claims, expiresAtMonoMs: r.expiresAtMonoMs, mode: r.claims.mode };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** Is a verified authorisation still inside its window (re-checked right before the consume + send)? */
export function edgeAuthorizationStillValid(deps: EdgeAuthorizationDeps, expiresAtMonoMs: number): boolean {
  try {
    const now = (deps.nowMonoMs ?? (() => performance.now()))();
    return Number.isFinite(now) && now < expiresAtMonoMs;
  } catch {
    return false;
  }
}
