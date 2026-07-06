/**
 * Hash-chain WORM audit — SYNAPSE §5.11.2 / §5.12 (doc 33 §3.4 / F5 · H1 Security).
 *
 * Upgrades audit from "append-only by service convention" to a tamper-EVIDENT hash chain:
 * each record carries the hash of the previous record, so any insertion/edit/deletion breaks
 * the chain and is detectable by `verifyChain`. This is the software half of a WORM audit
 * (the storage half — WORM disk / no-UPDATE grants — is deployment). Deterministic + pure.
 *
 * Non-breaking (F5): a standalone primitive. Existing audit writers can adopt it incrementally
 * by threading `prevHash` and storing the returned `hash`; nothing is forced to change in F5.
 */
import { createHash } from "node:crypto";

/** 64 zero hex chars — the genesis predecessor. */
export const GENESIS_HASH = "0".repeat(64);

export interface AuditRecordInput {
  /** Monotonic sequence number (per chain). */
  seq: number;
  /** Epoch ms. Passed in (never Date.now() here) so the chain is deterministic/reproducible. */
  ts: number;
  /** Event code, e.g. "command.dispatch", "policy.override". */
  event: string;
  /** Actor identity (user/service/device id). */
  actor: string;
  /** Arbitrary structured detail (canonically serialized for hashing). */
  payload: unknown;
}

export interface AuditRecord extends AuditRecordInput {
  /** Hash of the previous record (GENESIS_HASH for the first). */
  prevHash: string;
  /** sha256 over the canonical record + prevHash. */
  hash: string;
}

/** Canonical JSON (stable key order) so hashing is deterministic across runs/engines. */
export function canonicalize(value: unknown): string {
  const seen = new WeakSet();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = norm((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(norm(value));
}

/** Compute the hash for a record given its predecessor's hash. */
export function computeHash(input: AuditRecordInput, prevHash: string): string {
  const material = canonicalize({
    seq: input.seq,
    ts: input.ts,
    event: input.event,
    actor: input.actor,
    payload: input.payload,
    prevHash,
  });
  return createHash("sha256").update(material).digest("hex");
}

/** Append a record to a chain given the previous record (or null for genesis). */
export function appendRecord(input: AuditRecordInput, prev: AuditRecord | null): AuditRecord {
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  return { ...input, prevHash, hash: computeHash(input, prevHash) };
}

export interface ChainVerification {
  ok: boolean;
  /** Index of the first broken record, or -1 if intact. */
  brokenAt: number;
  reason?: string;
}

/**
 * Verify chain integrity: genesis prevHash, hash linkage, recomputed hashes, and monotonic seq.
 * Any tamper (edit/insert/delete/reorder) surfaces as `ok:false` with the first broken index.
 */
export function verifyChain(records: readonly AuditRecord[]): ChainVerification {
  let prevHash = GENESIS_HASH;
  let prevSeq = -Infinity;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.prevHash !== prevHash) return { ok: false, brokenAt: i, reason: "prevHash mismatch" };
    if (computeHash(r, r.prevHash) !== r.hash)
      return { ok: false, brokenAt: i, reason: "hash mismatch (record altered)" };
    if (r.seq <= prevSeq) return { ok: false, brokenAt: i, reason: "seq not increasing" };
    prevHash = r.hash;
    prevSeq = r.seq;
  }
  return { ok: true, brokenAt: -1 };
}
