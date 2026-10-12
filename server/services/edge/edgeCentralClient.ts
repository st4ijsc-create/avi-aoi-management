/**
 * doc 81 Đợt 10 task E (design §2.3–2.5, §2.8, §2.13) — the edge's HTTP client of the node protocol v2
 * (`/api/v1/edge/node/*`), authenticated ONLY by the node credential (`Authorization: Bearer edn_…`, read from a file by the
 * caller — never logged: errors are logged by status / code only).
 *
 *   • every request body is checked with its STRICT protocol schema before it leaves (a malformed body is a local bug — not
 *     sent), every answer with its answer schema (a malformed answer = `bad_answer`, treated as central unavailable);
 *   • every request has a timeout (AbortSignal.timeout); a network error / timeout / 5xx / 401 / 429 / bad answer is
 *     `unavailable` — the caller holds (D5), never guesses;
 *   • what central SIGNS is verified here, before anything uses it: the config snapshot (and its keyset — a chain update,
 *     accepted only when signed by a key the edge already trusts), the run package (+ the definition re-hashed to defHash),
 *     sweep pictures and commands. A command whose verification fails is returned with its UNVERIFIED payload only so that a
 *     STOP can still be sent (L-7) — nothing else may act on it.
 *   • EdgeAuthorizeClient (for group C's edge run store): one `/authorize` per non-STOP command step, a request nonce this
 *     process issued (pending set, with the FIRST send time on the monotonic clock — the TTL is measured from it, design
 *     §2.13), a fail-fast verification of the answer; D's verifier re-checks right before the driver call.
 *
 * R-10-f (contract fix round 1): every call into edgeTrust / the keyset store goes through `edgeTrustAdapter` below — the ONE
 * place that changes when the verifier signatures change.
 */
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { z } from "zod";
import {
  EDGE_ANSWER_SCHEMAS,
  EDGE_AUTH_TTL_MAX_MS,
  EDGE_NODE_ROUTES,
  EDGE_REQUEST_SCHEMAS,
  edgeCommandSchema,
  edgeUnsignedStopSchema,
  type EdgeAuthClaims,
  type EdgeAuthorizeCommand,
  type EdgeCommand,
  type EdgeConfigSnapshot,
  type EdgeNodeRoute,
  type EdgeProgramCheck,
  type EdgeRunPackage,
  type EdgeSweepPicture,
} from "./edgeProtocol";
import { parseEdgeCanonicalJson, type EdgeSignedEnvelope, type EdgeTrustStore } from "./edgeSigning";
import { verifyEdgeAuthorization, verifyEdgeCommand, verifyEdgeConfig, verifyEdgeRunPackage, verifyEdgeSweepPicture } from "./edgeTrust";

// ── the edgeTrust adapter (R-10-f: the only place that calls edgeTrust / the keyset store) ──────────────────────────────

/** What the edge knows when it verifies an authorisation (everything else comes from the request it sent). */
export interface EdgeAuthVerifyInput {
  credentialId: number;
  runId: number;
  claimSeq: number;
  stepId: string;
  attempt: number;
  idempotencyKey: string;
  kind: "ot" | "robot";
  payloadHash: string;
  reqNonce: string;
  maxTtlMs: number;
  /** pending-nonce lookup: the FIRST send time (monotonic) of a nonce this process issued and still waits on, else null */
  nonceSentAt: (reqNonce: string) => number | null;
  isJtiConsumed: (jti: string) => boolean;
  nowMonoMs: number;
}
export type EdgeTrustOutcome<T> = ({ ok: true } & T) | { ok: false; reason: string };

const noCredential = { ok: false as const, reason: "credential_unknown" };
const credOk = (c: number | null | undefined): c is number => typeof c === "number" && Number.isSafeInteger(c) && c > 0;

export const edgeTrustAdapter = {
  /** lastConfigVersion: the version of the last config this node ACCEPTED (persisted), null only before the first one */
  config(store: EdgeTrustStore, env: unknown, ctx: { credentialId: number | null; lastConfigVersion: number | null }): EdgeTrustOutcome<{ config: EdgeConfigSnapshot }> {
    if (!credOk(ctx.credentialId)) return noCredential;
    return verifyEdgeConfig(store, env, { credentialId: ctx.credentialId, lastConfigVersion: ctx.lastConfigVersion });
  },
  keysetUpdate(store: EdgeTrustStore, env: unknown): { ok: true; changed: boolean; version: number } | { ok: false; reason: string } {
    return store.acceptKeysetUpdate(env);
  },
  runPackage(store: EdgeTrustStore, env: unknown, ctx: { runId: number; claimSeq: number; credentialId: number | null }): EdgeTrustOutcome<{ pkg: EdgeRunPackage }> {
    if (!credOk(ctx.credentialId)) return noCredential;
    return verifyEdgeRunPackage(store, env, { credentialId: ctx.credentialId, runId: ctx.runId, claimSeq: ctx.claimSeq });
  },
  sweepPicture(store: EdgeTrustStore, env: unknown, ctx: { runId: number; credentialId: number | null }): EdgeTrustOutcome<{ picture: EdgeSweepPicture }> {
    if (!credOk(ctx.credentialId)) return noCredential;
    return verifyEdgeSweepPicture(store, env, { credentialId: ctx.credentialId, runId: ctx.runId });
  },
  command(store: EdgeTrustStore, env: unknown, ctx: { credentialId: number | null }): EdgeTrustOutcome<{ command: EdgeCommand; expired: boolean; notYetValid: boolean }> {
    if (!credOk(ctx.credentialId)) return noCredential;
    return verifyEdgeCommand(store, env, { credentialId: ctx.credentialId });
  },
  authorization(store: EdgeTrustStore, env: unknown, i: EdgeAuthVerifyInput): EdgeTrustOutcome<{ claims: EdgeAuthClaims; expiresAtMonoMs: number }> {
    return verifyEdgeAuthorization(store, env, {
      credentialId: i.credentialId,
      runId: i.runId,
      claimSeq: i.claimSeq,
      stepId: i.stepId,
      attempt: i.attempt,
      idempotencyKey: i.idempotencyKey,
      kind: i.kind,
      payloadHash: i.payloadHash,
      reqNonce: i.reqNonce,
      maxTtlMs: i.maxTtlMs,
      nowMonoMs: i.nowMonoMs,
      pendingNonceSentAt: (n) => i.nonceSentAt(n) ?? undefined,
      isJtiConsumed: i.isJtiConsumed,
    });
  },
};

/** The payload of a signed envelope that did NOT verify, parsed WITHOUT verification — only for the STOP fallback (L-7). */
function unverifiedCommand(env: unknown): EdgeCommand | null {
  try {
    const text = (env as { payload?: unknown } | null)?.payload;
    if (typeof text !== "string" || text.length > 100_000) return null;
    const p = edgeCommandSchema.safeParse(parseEdgeCanonicalJson(text));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/**
 * R-10-k / R-10-p — THE ONE envelope recognised as an UNSIGNED STOP (central's signer unavailable): group B's strict
 * edgeProtocol.edgeUnsignedStopSchema `{ typ: "cmd-stop-unsigned", requestId, nodeId, credentialId, ownerEpoch, target }` for
 * THIS node and credential — nothing else. A missing / empty / null `sig`, `alg: "none"` or any other shape is NOT unsigned:
 * it is a signature failure (executed as evidence only, never acked). Returned as the stop command it stands for.
 */
export function parseEdgeUnsignedStop(x: unknown, me: { nodeId: number; credentialId: number | null }): Extract<EdgeCommand, { kind: "stop" }> | null {
  try {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) return null;
    const p = edgeUnsignedStopSchema.safeParse(x);
    if (!p.success || p.data.nodeId !== me.nodeId || p.data.credentialId !== me.credentialId) return null;
    const u = p.data;
    return { kind: "stop", requestId: u.requestId, nodeId: u.nodeId, credentialId: u.credentialId, ownerEpoch: u.ownerEpoch, target: u.target, issuedAt: 0, expiresAt: 0 };
  } catch {
    return null;
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type AnswerOf<R extends EdgeNodeRoute> = z.infer<(typeof EDGE_ANSWER_SCHEMAS)[R]>;
type BodyOf<R extends EdgeNodeRoute> = z.input<(typeof EDGE_REQUEST_SCHEMAS)[R]>;
export type EdgeHttpResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string | null; data?: unknown; message?: string; unavailable: boolean };

export interface EdgeCentralClientOptions {
  centralUrl: string;
  credential: string;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
  /** monotonic clock (ms) — performance.now() */
  monoNow?: () => number;
  log?: (msg: string) => void;
}

/**
 * fix review 2 (M-10) — the body is read chunk by chunk and abandoned as soon as it passes the cap: a chunked (no
 * content-length) answer is never buffered whole first.
 */
export async function readCappedText(res: Response, cap: number): Promise<string> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body || typeof body.getReader !== "function") {
    const t = await res.text();
    if (Buffer.byteLength(t, "utf8") > cap) throw new Error("answer too large");
    return t;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) {
      await reader.cancel().catch(() => undefined);
      throw new Error("answer too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/** the largest answer body parsed (a config snapshot of 500 adapters × 5 000 tags fits) */
export const EDGE_ANSWER_MAX_BYTES = 32 * 1024 * 1024;
const UNAVAILABLE_CODES = new Set(["edge_disabled", "edge_unavailable", "rate_limited", "unauthorized", "bad_answer"]);

export class EdgeCentralClient {
  private readonly fetchImpl: typeof fetch;
  readonly monoNow: () => number;
  private readonly log: (m: string) => void;
  constructor(private readonly opts: EdgeCentralClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.monoNow = opts.monoNow ?? (() => performance.now());
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  /** POST one node route. Never throws; never logs the credential or a body. */
  async post<R extends EdgeNodeRoute>(route: R, body: BodyOf<R>, params: { runId?: number } = {}): Promise<EdgeHttpResult<AnswerOf<R>>> {
    const reqSchema = EDGE_REQUEST_SCHEMAS[route] as z.ZodType;
    const parsed = reqSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      this.log(`[EdgeClient] ${route}: request body refused locally (${i ? `${i.path.join(".")}: ${i.code}` : "invalid"}) — not sent`);
      return { ok: false, status: 0, code: "bad_local_body", unavailable: false };
    }
    let p: string = EDGE_NODE_ROUTES[route];
    if (p.includes(":runId")) {
      if (!Number.isSafeInteger(params.runId) || (params.runId as number) <= 0) return { ok: false, status: 0, code: "bad_local_body", unavailable: false };
      p = p.replace(":runId", String(params.runId));
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.centralUrl}/api/v1${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.credential}` },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(this.opts.requestTimeoutMs),
      });
    } catch {
      return { ok: false, status: 0, code: null, unavailable: true }; // network / timeout
    }
    type Envelope = { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown; details?: unknown } } | null;
    let json: Envelope = null;
    try {
      // fix review 1 (M-10) — a size cap besides the time bound: a declared or actual body above the cap is not parsed
      const declared = Number(res.headers?.get?.("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared > EDGE_ANSWER_MAX_BYTES) throw new Error("answer too large");
      json = JSON.parse(await readCappedText(res, EDGE_ANSWER_MAX_BYTES)) as Envelope;
    } catch {
      json = null;
    }
    if (res.ok && json?.ok === true) {
      const a = (EDGE_ANSWER_SCHEMAS[route] as z.ZodType).safeParse(json.data);
      if (!a.success) {
        this.log(`[EdgeClient] ${route}: central's answer does not match the protocol (${a.error.issues[0]?.path.join(".") ?? "?"}) — treated as unavailable`);
        return { ok: false, status: res.status, code: "bad_answer", unavailable: true };
      }
      return { ok: true, status: res.status, data: a.data as AnswerOf<R> };
    }
    const code = typeof json?.error?.code === "string" ? json.error.code : null;
    const unavailable = res.status === 0 || res.status >= 500 || res.status === 401 || res.status === 429 || (code !== null && UNAVAILABLE_CODES.has(code)) || code === null;
    return {
      ok: false,
      status: res.status,
      code,
      data: json?.error?.details,
      message: typeof json?.error?.message === "string" ? json.error.message.slice(0, 300) : undefined,
      unavailable,
    };
  }
}

// ── verified reads ──────────────────────────────────────────────────────────────────────────────────────────────────

export type EdgeVerifiedCommand =
  | { ok: true; envelope: EdgeSignedEnvelope; command: EdgeCommand; expired: boolean; notYetValid: boolean }
  /** verification failed: `unverified` exists ONLY for the STOP fallback (L-7); never act on it otherwise. `unsigned` ⇔ it is
   *  the explicit unsigned-STOP envelope (R-10-k / R-10-p), as opposed to a signature that is missing / fails */
  | { ok: false; envelope: unknown; reason: string; unverified: EdgeCommand | null; unsigned: boolean };

export function verifyCommands(store: EdgeTrustStore, envs: readonly unknown[], credentialId: number | null): EdgeVerifiedCommand[] {
  return envs.map((env) => {
    const u = parseEdgeUnsignedStop(env, { nodeId: store.nodeId, credentialId });
    if (u) return { ok: false, envelope: env, reason: "unsigned", unverified: u, unsigned: true };
    const r = edgeTrustAdapter.command(store, env, { credentialId });
    if (r.ok) return { ok: true, envelope: env as EdgeSignedEnvelope, command: r.command, expired: r.expired, notYetValid: r.notYetValid };
    return { ok: false, envelope: env, reason: r.reason, unverified: unverifiedCommand(env), unsigned: false };
  });
}

export type EdgeVerifiedSweep = { runId: number } & ({ ok: true; picture: EdgeSweepPicture } | { ok: false; reason: string });

/**
 * Verify the run package of a claim: signature + node + run + claim (edgeTrust), then the definition re-hashed to defHash
 * (the hash function is foeGateApproval.hashWorkflowDefinition, injected so this module stays DB-free).
 */
export function verifyRunPackage(
  store: EdgeTrustStore,
  env: unknown,
  ctx: { runId: number; claimSeq: number; credentialId: number | null; defHash: string; hashDefinition: (def: Record<string, unknown>) => string },
): EdgeTrustOutcome<{ pkg: EdgeRunPackage }> {
  const r = edgeTrustAdapter.runPackage(store, env, ctx);
  if (!r.ok) return r;
  if (r.pkg.defHash !== ctx.defHash) return { ok: false, reason: "defhash_mismatch" };
  let h: string;
  try {
    h = ctx.hashDefinition(r.pkg.definition);
  } catch {
    return { ok: false, reason: "definition_unhashable" };
  }
  if (h !== r.pkg.defHash) return { ok: false, reason: "definition_hash_mismatch" };
  return r;
}

// ── authorize client (group C's edge run store calls this; design §2.5) ─────────────────────────────────────────────

export interface EdgeAuthorizeInput {
  runId: number;
  claimSeq: number;
  claimToken: string;
  stepId: string;
  attempt: number;
  idempotencyKey: string;
  command: EdgeAuthorizeCommand;
  /** otPayloadHash / robotPayloadHash of the EXACT command the edge will send */
  payloadHash: string;
}
export type EdgeAuthorizeOutcome =
  | {
      ok: true;
      authorization: EdgeSignedEnvelope;
      claims: EdgeAuthClaims;
      ttlMs: number;
      reqNonce: string;
      /** monotonic first-send time of the request (the TTL window starts here) */
      requestSentMonoMs: number;
      expiresAtMonoMs: number;
    }
  /** refused: central said no (gate / device / payload / ownership) or the answer failed verification — nothing is sent;
   *  stopped: central aborted / rejected the run (sweep locally); stale: the claim is gone (abortRequested says why);
   *  unavailable: central could not be asked (D5 ⇒ the step is HELD, never failed + compensated) */
  | { ok: false; verdict: "refused" | "stopped" | "stale" | "unavailable"; code: string | null; reason?: string; abortRequested?: boolean };

export interface EdgeAuthorizeClient {
  authorize(input: EdgeAuthorizeInput): Promise<EdgeAuthorizeOutcome>;
  /** the verifier's pending-nonce lookup: FIRST send time (monotonic) of a nonce issued by THIS process and not settled */
  nonceSentAt(reqNonce: string): number | null;
  isNoncePending(reqNonce: string): boolean;
  /** the authorisation was used (or abandoned) — the nonce is no longer pending */
  settleNonce(reqNonce: string): void;
  /** nonces currently pending (bounded: settled on use, at TTL lapse, and at EDGE_PENDING_NONCES_MAX) */
  pendingCount(): number;
}
export const EDGE_PENDING_NONCES_MAX = 1_000;

export interface EdgeAuthorizeDeps {
  client: EdgeCentralClient;
  trust: () => EdgeTrustStore | null;
  credentialId: () => number | null;
  maxTtlMs: () => number;
  isJtiConsumed: (jti: string) => boolean;
  programChecks: () => EdgeProgramCheck[];
  /** an answer that failed verification is reported as an anomaly (events stream) */
  anomaly?: (code: string, runId: number, detail: string) => void;
}

export function newEdgeReqNonce(): string {
  return randomBytes(24).toString("base64url"); // 32 chars of [A-Za-z0-9_-]
}

export function createEdgeAuthorizeClient(deps: EdgeAuthorizeDeps): EdgeAuthorizeClient {
  // fix review 1 (M-3) — BOUNDED: a nonce is settled by its user (settleNonce), or at the latest when its authorisation can
  // no longer be valid (first send + EDGE_AUTH_TTL_MAX_MS: pruned on every authorize, and by an unref'd timer); at most
  // EDGE_PENDING_NONCES_MAX entries (the oldest goes first — it is the closest to its TTL anyway).
  const pending = new Map<string, number>();
  const prune = () => {
    const now = deps.client.monoNow();
    for (const [n, t] of pending) if (now - t > EDGE_AUTH_TTL_MAX_MS) pending.delete(n);
    while (pending.size >= EDGE_PENDING_NONCES_MAX) pending.delete(pending.keys().next().value as string);
  };
  const settleLater = (n: string) => {
    const t = setTimeout(() => pending.delete(n), EDGE_AUTH_TTL_MAX_MS + 1_000);
    if (typeof t.unref === "function") t.unref();
  };
  const nonceSentAt = (n: string): number | null => (pending.has(n) ? (pending.get(n) as number) : null);
  return {
    nonceSentAt,
    isNoncePending: (n) => pending.has(n),
    settleNonce: (n) => {
      pending.delete(n);
    },
    pendingCount: () => pending.size,
    async authorize(input: EdgeAuthorizeInput): Promise<EdgeAuthorizeOutcome> {
      const store = deps.trust();
      const credentialId = deps.credentialId();
      if (!store || credentialId === null) return { ok: false, verdict: "unavailable", code: "no_config", reason: "no verified config / keyset" };
      const reqNonce = newEdgeReqNonce();
      const body = {
        claimSeq: input.claimSeq,
        claimToken: input.claimToken,
        stepId: input.stepId,
        attempt: input.attempt,
        idempotencyKey: input.idempotencyKey,
        reqNonce,
        command: input.command,
        payloadHash: input.payloadHash,
        programChecks: deps.programChecks().slice(0, 256),
      };
      prune();
      pending.set(reqNonce, deps.client.monoNow()); // the FIRST send time — a retry with the same nonce never extends it
      settleLater(reqNonce);
      let r = await deps.client.post("authorize", body, { runId: input.runId });
      if (!r.ok && r.status === 0 && r.code === null) r = await deps.client.post("authorize", body, { runId: input.runId }); // one retry: same nonce ⇒ same token
      if (!r.ok) {
        pending.delete(reqNonce);
        const d = (r.data ?? {}) as { abortRequested?: unknown; reason?: unknown; gate?: unknown };
        if (r.unavailable) return { ok: false, verdict: "unavailable", code: r.code };
        if (r.code === "stopped" || r.code === "run_not_active") return { ok: false, verdict: "stopped", code: r.code };
        if (r.code === "claim_stale" || r.status === 404) return { ok: false, verdict: "stale", code: r.code, abortRequested: d.abortRequested === true };
        const reason = typeof d.reason === "string" ? d.reason : typeof d.gate === "string" ? d.gate : r.code ?? `HTTP ${r.status}`;
        return { ok: false, verdict: "refused", code: r.code, reason };
      }
      const v = edgeTrustAdapter.authorization(store, r.data.authorization, {
        credentialId,
        runId: input.runId,
        claimSeq: input.claimSeq,
        stepId: input.stepId,
        attempt: input.attempt,
        idempotencyKey: input.idempotencyKey,
        kind: input.command.kind,
        payloadHash: input.payloadHash,
        reqNonce,
        maxTtlMs: deps.maxTtlMs(),
        nonceSentAt,
        isJtiConsumed: deps.isJtiConsumed,
        nowMonoMs: deps.client.monoNow(),
      });
      if (!v.ok) {
        pending.delete(reqNonce);
        deps.anomaly?.("EDGE_AUTH_INVALID", input.runId, `step ${input.stepId} attempt ${input.attempt}: ${v.reason}`);
        return { ok: false, verdict: "refused", code: "auth_invalid", reason: v.reason };
      }
      return {
        ok: true,
        authorization: r.data.authorization,
        claims: v.claims,
        ttlMs: r.data.ttlMs,
        reqNonce,
        requestSentMonoMs: pending.get(reqNonce) as number,
        expiresAtMonoMs: v.expiresAtMonoMs,
      };
    },
  };
}
