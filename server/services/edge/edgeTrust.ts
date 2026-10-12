/**
 * doc 81 Đợt 10 task A fix scan 2 — the TYPED verifiers of what central signs for an edge node. Each one: verify the envelope
 * against the node's own EdgeTrustStore (edgeSigning.ts — local trust anchor, never a keyset from a message), parse the
 * payload with its STRICT protocol schema, then BIND it:
 *   • to THIS node (nodeId from provisioning — every signed object names its node: auth / cmd / runpkg / config);
 *   • for an authorisation (design §2.13): credential, run, claim, step, attempt, idempotency key, kind, the request nonce
 *     (must be one this process issued and is still waiting on), the jti (never consumed before), the payloadHash (recomputed
 *     by the caller from the EXACT bytes about to be sent), ttlMs ≤ the configured maximum (and ≤ 30 s), iat not in the
 *     future beyond skew and not older than ttl + skew, and the validity window measured on the edge's MONOTONIC clock from
 *     when it SENT the request (neither clock skew nor slow delivery widens it);
 *   • for a run package: run + claim; for a sweep picture: run; for a config: node (+ credential), no version rollback;
 *   • for a command: node; `expired` / `notYetValid` are reported, and the CALLER decides — a STOP is sent anyway (L-7),
 *     a `clear` (raises energy) requires ok && !expired && a generation match.
 * Times come from the store's clock / the caller's monotonic clock — never from a claim alone. Never throws.
 */
import {
  EDGE_AUTH_TTL_MAX_MS,
  edgeAuthClaimsSchema,
  edgeCommandSchema,
  edgeConfigSnapshotSchema,
  edgeRunPackageSchema,
  edgeSweepPictureSchema,
  type EdgeAuthClaims,
  type EdgeCommand,
  type EdgeConfigSnapshot,
  type EdgeRunPackage,
  type EdgeSweepPicture,
} from "./edgeProtocol";
import { verifyEdgeObject, type EdgeSignedTyp, type EdgeTrustStore, type EdgeVerifyFailure } from "./edgeSigning";

export type EdgeTrustFailure =
  | EdgeVerifyFailure
  | "schema"
  | "node_mismatch"
  | "credential_mismatch"
  | "context_mismatch"
  | "payload_mismatch"
  | "nonce_not_pending"
  | "jti_consumed"
  | "ttl_too_long"
  | "iat_in_future"
  | "iat_too_old"
  | "expired"
  | "clock"
  | "rollback";
export type EdgeTrustResult<T> = ({ ok: true } & T) | { ok: false; reason: EdgeTrustFailure };

function verified<T>(
  store: EdgeTrustStore,
  env: unknown,
  typ: EdgeSignedTyp,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
): { ok: true; v: T } | { ok: false; reason: EdgeTrustFailure } {
  try {
    const r = verifyEdgeObject(env, typ, store);
    if (!r.ok) return { ok: false, reason: r.reason };
    const p = schema.safeParse(r.payload);
    if (!p.success) return { ok: false, reason: "schema" };
    return { ok: true, v: p.data };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** Not issued in the future beyond skew (store clock). */
function issuedInFuture(store: EdgeTrustStore, issuedAt: number): boolean {
  return issuedAt > store.now() + store.skewMs;
}

// ── authorisation ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface EdgeAuthorizationContext {
  /** this node's credential id (from the verified config snapshot) */
  credentialId: number;
  runId: number;
  claimSeq: number;
  stepId: string;
  attempt: number;
  idempotencyKey: string;
  kind: "ot" | "robot";
  /** recomputed by the caller (otPayloadHash / robotPayloadHash) from the EXACT command about to be sent */
  payloadHash: string;
  /** the nonce of the request this answers */
  reqNonce: string;
  /** the configured maximum TTL (config limits.authTtlMs); capped at EDGE_AUTH_TTL_MAX_MS */
  maxTtlMs: number;
  /** monotonic ms (performance.now()) when the /authorize request was SENT, and now */
  requestSentMonoMs: number;
  nowMonoMs: number;
  /** true ⇔ this process issued the nonce and is still waiting on it (pending set; a restart forgets every nonce) */
  isNoncePending: (reqNonce: string) => boolean;
  /** true ⇔ the jti was already consumed (journal `auth.consumed`) */
  isJtiConsumed: (jti: string) => boolean;
}

/**
 * Everything the edge verifier checks right before the driver call (design §2.13), except the driver-level local gates and
 * the journal write of `auth.consumed` (the caller fsyncs it BEFORE sending, then sends). On ok, `expiresAtMonoMs` is the
 * monotonic deadline (requestSent + ttl) — the send must happen before it.
 */
export function verifyEdgeAuthorization(store: EdgeTrustStore, env: unknown, ctx: EdgeAuthorizationContext): EdgeTrustResult<{ claims: EdgeAuthClaims; expiresAtMonoMs: number }> {
  try {
    const r = verified<EdgeAuthClaims>(store, env, "auth", edgeAuthClaimsSchema as never);
    if (!r.ok) return r;
    const c = r.v;
    if (c.nodeId !== store.nodeId) return { ok: false, reason: "node_mismatch" };
    if (c.credentialId !== ctx.credentialId) return { ok: false, reason: "credential_mismatch" };
    if (
      c.runId !== ctx.runId ||
      c.claimSeq !== ctx.claimSeq ||
      c.stepId !== ctx.stepId ||
      c.attempt !== ctx.attempt ||
      c.idempotencyKey !== ctx.idempotencyKey ||
      c.kind !== ctx.kind ||
      c.reqNonce !== ctx.reqNonce
    ) {
      return { ok: false, reason: "context_mismatch" };
    }
    if (typeof ctx.payloadHash !== "string" || c.payloadHash !== ctx.payloadHash) return { ok: false, reason: "payload_mismatch" };
    const maxTtl = Math.min(EDGE_AUTH_TTL_MAX_MS, Number.isFinite(ctx.maxTtlMs) ? ctx.maxTtlMs : 0);
    if (!(c.ttlMs <= maxTtl)) return { ok: false, reason: "ttl_too_long" };
    const now = store.now();
    if (c.iat > now + store.skewMs) return { ok: false, reason: "iat_in_future" };
    if (c.iat + c.ttlMs + store.skewMs < now) return { ok: false, reason: "iat_too_old" };
    if (!Number.isFinite(ctx.requestSentMonoMs) || !Number.isFinite(ctx.nowMonoMs) || ctx.nowMonoMs < ctx.requestSentMonoMs) return { ok: false, reason: "clock" };
    const expiresAtMonoMs = ctx.requestSentMonoMs + c.ttlMs;
    if (!(ctx.nowMonoMs < expiresAtMonoMs)) return { ok: false, reason: "expired" };
    if (ctx.isNoncePending(c.reqNonce) !== true) return { ok: false, reason: "nonce_not_pending" };
    if (ctx.isJtiConsumed(c.jti) !== false) return { ok: false, reason: "jti_consumed" };
    return { ok: true, claims: c, expiresAtMonoMs };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

// ── config / run package / sweep picture / command ──────────────────────────────────────────────────────────────────

/**
 * The config snapshot for THIS node. Its embedded `keyset` is NOT trusted by this call — offer it to
 * store.acceptKeysetUpdate (verified with the keys trusted before it). `lastConfigVersion` ⇒ an older config is refused.
 */
export function verifyEdgeConfig(
  store: EdgeTrustStore,
  env: unknown,
  ctx: { credentialId?: number; lastConfigVersion?: number } = {},
): EdgeTrustResult<{ config: EdgeConfigSnapshot }> {
  try {
    const r = verified<EdgeConfigSnapshot>(store, env, "config", edgeConfigSnapshotSchema as never);
    if (!r.ok) return r;
    const c = r.v;
    if (c.node.id !== store.nodeId) return { ok: false, reason: "node_mismatch" };
    if (ctx.credentialId !== undefined && c.node.credentialId !== ctx.credentialId) return { ok: false, reason: "credential_mismatch" };
    if (issuedInFuture(store, c.issuedAt)) return { ok: false, reason: "iat_in_future" };
    if (ctx.lastConfigVersion !== undefined && c.configVersion < ctx.lastConfigVersion) return { ok: false, reason: "rollback" };
    return { ok: true, config: c };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export function verifyEdgeRunPackage(store: EdgeTrustStore, env: unknown, ctx: { runId: number; claimSeq: number }): EdgeTrustResult<{ pkg: EdgeRunPackage }> {
  try {
    const r = verified<EdgeRunPackage>(store, env, "runpkg", edgeRunPackageSchema as never);
    if (!r.ok) return r;
    const p = r.v;
    if (p.nodeId !== store.nodeId) return { ok: false, reason: "node_mismatch" };
    if (p.runId !== ctx.runId || p.claimSeq !== ctx.claimSeq) return { ok: false, reason: "context_mismatch" };
    if (issuedInFuture(store, p.issuedAt)) return { ok: false, reason: "iat_in_future" };
    return { ok: true, pkg: p };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export function verifyEdgeSweepPicture(store: EdgeTrustStore, env: unknown, ctx: { runId: number }): EdgeTrustResult<{ picture: EdgeSweepPicture }> {
  try {
    const r = verified<EdgeSweepPicture>(store, env, "runpkg", edgeSweepPictureSchema as never);
    if (!r.ok) return r;
    const p = r.v;
    if (p.nodeId !== store.nodeId) return { ok: false, reason: "node_mismatch" };
    if (p.runId !== ctx.runId) return { ok: false, reason: "context_mismatch" };
    if (issuedInFuture(store, p.issuedAt)) return { ok: false, reason: "iat_in_future" };
    return { ok: true, picture: p };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/**
 * A central command for THIS node. `expired` / `notYetValid` are facts for the caller: a STOP is sent even when the whole
 * verification fails (L-7 — log an anomaly); a `clear` needs ok && !expired && !notYetValid && the generation match.
 */
export function verifyEdgeCommand(store: EdgeTrustStore, env: unknown): EdgeTrustResult<{ command: EdgeCommand; expired: boolean; notYetValid: boolean }> {
  try {
    const r = verified<EdgeCommand>(store, env, "cmd", edgeCommandSchema as never);
    if (!r.ok) return r;
    const c = r.v;
    if (c.nodeId !== store.nodeId) return { ok: false, reason: "node_mismatch" };
    const now = store.now();
    return { ok: true, command: c, expired: now - store.skewMs > c.expiresAt, notYetValid: c.issuedAt > now + store.skewMs };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
