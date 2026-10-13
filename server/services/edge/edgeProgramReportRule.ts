/**
 * doc 81 Đợt 10 C fix review 1 (ruling R-10-m, widened) — THE one rule for whether a NODE-REPORTED program checksum counts
 * (design §2.7, D7), used by BOTH central readers so an approval and an authorisation can never disagree:
 *   • the approval / approver's screen of an edge run (foeEngine — the node's stored reports, edge_node_program_reports);
 *   • POST runs/:id/authorize (group B — the readings the node sends in the request).
 * A reading counts only when ALL hold:
 *   • KEY — the reading is of this adapter, reported by the node that OWNS the adapter (adapter.edgeNodeId = node);
 *   • CAPABILITY — decided CENTRALLY from the adapter's config row (programChecksum.programChecksumCapable): a capable
 *     controller the node calls "unsupported" is unreadable (never believed); a non-capable one is "unsupported" whatever the
 *     node says (it adds nothing to the digest);
 *   • OWNER EPOCH (R-10-b) — a STORED report must carry the adapter's CURRENT owner epoch; a live request reading is taken now
 *     under the current owner (the request is checked against the current ownership by its caller);
 *   • FRESHNESS — readAt not after now + EDGE_MAX_CLOCK_SKEW_MS (default 5 s) and not older than
 *     EDGE_PROGRAM_REPORT_MAX_AGE_MS (default 120 s) + skew.
 * Anything else is UNREADABLE ⇒ no digest ⇒ no approval / no authorisation (fail-closed). An adapter id the map does not
 * know is unreadable too (EdgeProgramPre.get): central never reads a controller of an edge run.
 *
 * Also the context marks of a held / waiting edge run (central's own keys — never taken from an edge context patch; a
 * Continue clears EDGE_HOLD_MARK_KEYS).
 */
import { programChecksumCapable, type ProgramCheck, type ProgramUnreadableReason } from "../ot/programChecksum";

// ── bounds ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const intEnv = (name: string, def: number, min: number, max: number): number => {
  const n = parseInt(process.env[name] || String(def), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
/** How old a node-reported program checksum may be to count (approval / authorize; D7). */
export function edgeProgramReportMaxAgeMs(): number {
  return intEnv("EDGE_PROGRAM_REPORT_MAX_AGE_MS", 120_000, 1_000, 3_600_000);
}
/** The clock skew tolerated between a node and central. */
export function edgeMaxClockSkewMs(): number {
  return intEnv("EDGE_MAX_CLOCK_SKEW_MS", 5_000, 0, 300_000);
}

// ── the rule ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The adapter as central knows it (device_adapters row + its 0374 ownership columns). */
export interface EdgeReportAdapter {
  id: number;
  /** the owning node (null = central) */
  edgeNodeId: number | null;
  ownerEpoch: number | null;
  protocol?: unknown;
  connectionOptions?: unknown;
  code?: unknown;
  name?: unknown;
}

/** A node's reading (stored row of edge_node_program_reports, or an edgeProgramCheckSchema entry of a request). */
export interface EdgeReportReading {
  adapterId: number;
  /** the reporting node (a stored row has it; a request reading is the authenticated caller's) */
  edgeNodeId?: number | null;
  status: string;
  checksum?: string | null;
  reason?: string | null;
  readAt: number | Date | string | null;
  /** a STORED report: the owner epoch it was written under (mig 0374 trigger) */
  ownerEpoch?: number | null;
}

export interface EdgeReportRuleOptions {
  /** "stored" — a report row: it must quote the adapter's CURRENT owner epoch; "live" — readings of the request itself */
  source: "stored" | "live";
  nowMs?: number;
  maxAgeMs?: number;
  skewMs?: number;
}

const REASONS: ReadonlySet<string> = new Set<ProgramUnreadableReason>(["notConnected", "timeout", "error", "invalid", "inconsistent"]);
const labelOf = (a: EdgeReportAdapter): string | null => (typeof a.code === "string" && a.code ? a.code : typeof a.name === "string" && a.name ? a.name : null);
const ms = (v: number | Date | string | null | undefined): number => (v == null ? NaN : v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime());

/** THE predicate: the program check `reading` (by `nodeId`) yields for `adapter` — see the header. */
export function edgeProgramCheckOf(nodeId: number, adapter: EdgeReportAdapter, reading: EdgeReportReading | undefined, opts: EdgeReportRuleOptions): ProgramCheck {
  const base = { target: "adapter" as const, id: adapter.id, label: labelOf(adapter), source: "edge" };
  const unreadable = (reason: ProgramUnreadableReason): ProgramCheck => ({ ...base, status: "unreadable", reason });
  if (adapter.edgeNodeId !== nodeId) return unreadable("notConnected"); // not this node's controller
  if (!programChecksumCapable({ protocol: adapter.protocol, connectionOptions: adapter.connectionOptions } as never)) return { ...base, status: "unsupported" };
  if (!reading || reading.adapterId !== adapter.id || (reading.edgeNodeId != null && reading.edgeNodeId !== nodeId)) return unreadable("notConnected");
  if (opts.source === "stored" && (reading.ownerEpoch == null || adapter.ownerEpoch == null || Number(reading.ownerEpoch) !== Number(adapter.ownerEpoch))) {
    return unreadable("inconsistent"); // a reading of an earlier ownership
  }
  const now = opts.nowMs ?? Date.now();
  const skew = opts.skewMs ?? edgeMaxClockSkewMs();
  const maxAge = opts.maxAgeMs ?? edgeProgramReportMaxAgeMs();
  const at = ms(reading.readAt);
  if (!Number.isFinite(at) || at > now + skew || now - at > maxAge + skew) return unreadable("timeout");
  if (reading.status === "verified" && typeof reading.checksum === "string" && reading.checksum.length > 0) return { ...base, status: "verified", checksum: reading.checksum };
  if (reading.status === "unreadable") return unreadable((REASONS.has(String(reading.reason)) ? reading.reason : "error") as ProgramUnreadableReason);
  return unreadable("inconsistent"); // "unsupported" (or anything else) for a controller central's config calls capable
}

/** The `pre` map of computeBindingDetail for an edge run: ids it does not know are UNREADABLE (never a central read). */
export class EdgeProgramPre extends Map<number, ProgramCheck> {
  override get(id: number): ProgramCheck {
    return super.get(id) ?? { target: "adapter", id, label: null, status: "unreadable", source: "edge", reason: "notConnected" };
  }
}

/** The pre map for `nodeId`: every adapter it owns, through edgeProgramCheckOf with that adapter's reading (if any). */
export function edgeProgramPreOf(nodeId: number, adapters: ReadonlyArray<EdgeReportAdapter>, readings: ReadonlyArray<EdgeReportReading>, opts: EdgeReportRuleOptions): EdgeProgramPre {
  const pre = new EdgeProgramPre();
  const now = opts.nowMs ?? Date.now();
  for (const a of adapters) {
    if (a.edgeNodeId !== nodeId) continue;
    const reading = readings.find((r) => r.adapterId === a.id && (r.edgeNodeId == null || r.edgeNodeId === nodeId));
    pre.set(a.id, edgeProgramCheckOf(nodeId, a, reading, { ...opts, nowMs: now }));
  }
  return pre;
}

// ── the context marks of a held / waiting edge run (central's keys) ─────────────────────────────────────────────────

/** held because its node never claimed it (edgeExecutionCentral.holdUnclaimedEdgeRuns) */
export const EDGE_UNREACHABLE_CTX_KEY = "edgeUnreachable";
/** queued, its alive node has not claimed it yet: "capacity" | "node" (N4) */
export const EDGE_WAITING_CTX_KEY = "edgeWaiting";
/** held by its node at a segment end (D5: centralUnreachable / journalFull …) — foeRunStore.applyEdgeSegmentEnd */
export const EDGE_HELD_CTX_KEY = "edgeHeld";
/**
 * fix review 4 (B F-B2-1) — `{ userId, at }` of the user who CONTINUED a held edge run last (foeEngine.resumeRun, central-only;
 * edgeContextPolicy refuses it from an edge patch). B's /authorize (edgeAuthorizeCentral.EDGE_RESUMED_BY_CTX_KEY, the same name)
 * uses that user's role for the engine policy on the held path.
 */
export const EDGE_RESUMED_BY_CTX_KEY = "edgeResumedBy";
/** set (never cleared) when a Continue clears an `interrupted` mark: the abort sweep keeps counting the run as possibly acted */
export const INTERRUPTED_EARLIER_CTX_KEY = "interruptedEarlier";

/** Every mark a Continue (resumeRun of an edge run) clears — the hold is over, the run is queued again. */
export const EDGE_HOLD_MARK_KEYS: readonly string[] = Object.freeze([
  EDGE_UNREACHABLE_CTX_KEY,
  `${EDGE_UNREACHABLE_CTX_KEY}At`,
  `${EDGE_UNREACHABLE_CTX_KEY}Node`,
  EDGE_WAITING_CTX_KEY,
  `${EDGE_WAITING_CTX_KEY}At`,
  `${EDGE_WAITING_CTX_KEY}Node`,
  EDGE_HELD_CTX_KEY,
  `${EDGE_HELD_CTX_KEY}At`,
  `${EDGE_HELD_CTX_KEY}Node`,
  "interrupted",
  "interruptedAt",
  "interruptedFrom",
  "interruptedBy",
]);
