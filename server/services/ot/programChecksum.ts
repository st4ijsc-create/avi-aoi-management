/**
 * doc 81 Đợt 8 task O1 — controller PROGRAM CHECKSUM framework (read-only).
 *
 * The approval binding digest (Đợt 5 E3, foeGateApproval.computeBindingDigest) covers the device CONFIGURATION a run's
 * commands resolve to; a program stored INSIDE a controller was invisible to it (documented residual, doc 81 §14). This
 * module answers, per OT adapter, whether the program in its controller can be verified and what its checksum is now.
 *
 * Three answers, never mixed up:
 *   • "verified"    — the adapter's controller reports a checksum; the value is included in the binding digest;
 *   • "unsupported" — this controller type cannot report one (decided from the ADAPTER ROW alone, no device I/O): shown
 *                     plainly as "program cannot be verified on this controller", recorded as not verifiable, NEVER
 *                     treated as verified;
 *   • "unreadable"  — the adapter is expected to report one (programChecksumCapable) but no valid answer came within the
 *                     deadline (not connected, timeout, error, invalid / inconsistent answer). Fail-closed: the binding
 *                     digest is then null, so an approval can neither be given nor used.
 * Because support is decided from configuration, a failure can never degrade into "unsupported".
 *
 * Which adapters support it today (measured, doc 81 §16 / group-O-report):
 *   • the simulation driver (`stub`) when its configuration carries `simProgram` (the simulated controller's program);
 *   • OpenPLC: NO — neither the v3 webserver (Flask routes: dashboard shows only program name / file name / description)
 *     nor the v4 runtime REST API (/api/status, /api/upload-file, /api/compilation-status, …) exposes a program checksum
 *     or the program content; OpenPLC adapters are Modbus adapters and report "unsupported";
 *   • Siemens S7 (doc 81 Đợt 9 task T1) when the adapter's configuration OPTS IN with `programChecksum` (documented value
 *     "blockInfo"; any value other than false / "off" / null counts as opting in, so a typo never silently disables the
 *     check): SHA-256 over the controller's identity (SZL order number, serial number, module name), the adapter's
 *     endpoint (host, port, rack, slot), the full block list and every reported block-info field of every listed block
 *     (OB/DB/FC/FB/SDB read per block, each with its own block info), read through the documented S7comm functions
 *     (drivers/s7BlockChecksum.ts — sources, formula "s7-blockinfo-v3", S7_PROGRAM_CHECKSUM_FORMULA); a know-how-protected or
 *     unreadable OB/FB/FC/DB/SDB, or a truncated block list ⇒ the whole checksum is unreadable. SFC/SFB (firmware system
 *     blocks) are NOT read per block (ruling R-9-b): they are covered by the controller identity + FIRMWARE VERSION and by
 *     their presence in the block list, so their protection flag never refuses.
 *     Built from the protocol documentation and a simulator, NOT verified on a real device, and CHANGE DETECTION PER
 *     PROTOCOL DATA — NOT TAMPER-PROOF against an attacker with PLC write access (rulings R-9-a; the screen says both).
 *     Opt-in rather than default because a CPU that does not answer
 *     block functions (e.g. S7-1200/1500 per vendor docs on optimized access — to be checked at FAT) would otherwise
 *     make every approval on that adapter impossible (fail-closed);
 *   • every other protocol / plugin driver: unsupported.
 *
 * L-7: a checksum read is bounded (PROGRAM_CHECKSUM_READ_DEADLINE_MS) and goes to the driver's readProgramChecksum(),
 * which by contract shares no queue with writes. The orchestration engine never reads a checksum on a STOP step, and the
 * dispatchers never check approvals of a pinned OT stop or of a robot stop.
 *
 * Final wave (doc 81 Đợt 8, review O M3 / M4 / M1):
 *   • M4 — a read is CANCELLED at its deadline: the driver receives an AbortSignal and must settle (reject) on abort, so a
 *     hung controller leaves no pending promise behind (no leak per poll / dispatch);
 *   • M1 — SINGLE-FLIGHT: concurrent reads of the same adapter on the same driver share ONE in-flight read (several open
 *     approver screens / a screen + a dispatcher never multiply controller reads). A settled read is never reused: every
 *     later call reads again (no cache — a binding check always sees a read that started at most one deadline earlier);
 *   • M3 — `source` is the DRIVER's own label (sanitised: [a-z0-9_-], ≤ 32 chars; anything else ⇒ "unknown"), so a future
 *     real reader is never mislabelled "sim" and the approver's screen can say "simulation" only when the driver says so.
 */
import type { OtDriver } from "./otDriver";
import { getActiveDriver } from "./otManager";
import { withDeadline } from "./drivers/boundedClose";

/** Default bound of ONE checksum read (all adapters of a digest are read concurrently). */
export const PROGRAM_CHECKSUM_READ_DEADLINE_MS = 1000;
/** doc 81 Đợt 9 ruling R-9-b — hard cap of a per-adapter bound (connectionOptions.programChecksumDeadlineMs). */
export const PROGRAM_CHECKSUM_READ_DEADLINE_MAX_MS = 10_000;
/**
 * doc 81 Đợt 9 ruling R-9-b — how long a settled reading may be SHOWN again on the approver's screen (getRun polls every
 * 1.5 s). DISPLAY ONLY: a reading served from this cache is labelled (`displayCache.readAt`), and no approval-recording,
 * approval-consuming or dispatch check ever asks for it — they always read fresh (fail-closed: a screen digest built from
 * a cached reading that no longer matches a fresh one makes the screen-bound approval fail with CONFLICT).
 */
export const PROGRAM_CHECK_DISPLAY_CACHE_MS = 5000;
const MAX_CHECKSUM_LEN = 256;

export type ProgramCheckStatus = "verified" | "unsupported" | "unreadable";
/** Why a supported adapter's checksum was not read — a code only (an error text may name a host / endpoint). */
export type ProgramUnreadableReason = "notConnected" | "timeout" | "error" | "invalid" | "inconsistent";

export interface ProgramCheck {
  target: "adapter" | "robot";
  id: number;
  /** adapter / robot code (or name) for the approval screen; null when the row has none. */
  label: string | null;
  status: ProgramCheckStatus;
  /** Present iff status === "verified". */
  checksum?: string;
  /** Short non-sensitive origin label: "sim", the protocol name, "robot". */
  source: string;
  /** Present iff status === "unreadable". */
  reason?: ProgramUnreadableReason;
  /** R-9-b — present iff this entry was served from the DISPLAY-ONLY cache: when the shown reading was taken. */
  displayCache?: { readAt: string };
}

export interface AdapterRowLike {
  id: number;
  code?: unknown;
  name?: unknown;
  protocol?: unknown;
  connectionOptions?: unknown;
}

const labelOf = (row: { code?: unknown; name?: unknown }): string | null =>
  typeof row.code === "string" && row.code ? row.code : typeof row.name === "string" && row.name ? row.name : null;

/**
 * Is this adapter's controller EXPECTED to report a program checksum? Decided from the configuration row only (no I/O).
 * true ⇒ an answer that is not a valid checksum is "unreadable" (fail-closed), never "unsupported".
 */
export function programChecksumCapable(row: Pick<AdapterRowLike, "protocol" | "connectionOptions">): boolean {
  const opts = row.connectionOptions as Record<string, unknown> | null | undefined;
  if (row.protocol === "stub") return typeof opts?.simProgram === "string";
  // Đợt 9 T1 — S7 opts in through `programChecksum` (see header). Absent / false / "off" / null ⇒ unsupported.
  if (row.protocol === "s7") {
    const v = opts?.programChecksum;
    return v !== undefined && v !== null && v !== false && v !== "off";
  }
  return false;
}

/**
 * R-9-b — the adapter's own bound of one checksum read: connectionOptions.programChecksumDeadlineMs (a finite number,
 * clamped to [1, PROGRAM_CHECKSUM_READ_DEADLINE_MAX_MS]); absent / not a number ⇒ PROGRAM_CHECKSUM_READ_DEADLINE_MS.
 * Never on a STOP path (the engine never reads a checksum for a STOP step; pinned / robot stops are never checked).
 */
export function programChecksumDeadlineMs(row: Pick<AdapterRowLike, "connectionOptions">): number {
  const v = (row.connectionOptions as Record<string, unknown> | null | undefined)?.programChecksumDeadlineMs;
  if (typeof v !== "number" || !Number.isFinite(v)) return PROGRAM_CHECKSUM_READ_DEADLINE_MS;
  return Math.min(PROGRAM_CHECKSUM_READ_DEADLINE_MAX_MS, Math.max(1, Math.floor(v)));
}

/**
 * The program check of ONE OT adapter, bounded by `deadlineMs` (default: the adapter's own bound). Never throws.
 * `display: true` ONLY for the approver's screen (getRun): a reading settled less than PROGRAM_CHECK_DISPLAY_CACHE_MS ago
 * for the same driver, adapter and configuration may be shown again, labelled `displayCache`. Every other caller reads.
 */
export async function readAdapterProgramCheck(
  row: AdapterRowLike,
  opts: { deadlineMs?: number; driverOf?: (adapterId: number) => OtDriver | undefined; display?: boolean } = {},
): Promise<ProgramCheck> {
  const base = { target: "adapter" as const, id: row.id, label: labelOf(row) };
  const protocolLabel = typeof row.protocol === "string" && row.protocol ? sanitiseSource(row.protocol) : "unknown";
  if (!programChecksumCapable(row)) {
    return { ...base, status: "unsupported", source: protocolLabel };
  }
  // M3 — no answer ⇒ the source is what the configuration says (the sim protocol ⇒ "sim"), never a guess of a real reader.
  const unreadable = (reason: ProgramUnreadableReason): ProgramCheck => ({ ...base, status: "unreadable", source: row.protocol === "stub" ? "sim" : protocolLabel, reason });
  let driver: OtDriver | undefined;
  try {
    driver = (opts.driverOf ?? getActiveDriver)(row.id);
  } catch {
    return unreadable("error");
  }
  if (!driver) return unreadable("notConnected");
  const read = driver.readProgramChecksum;
  if (typeof read !== "function") return unreadable("inconsistent");
  const deadlineMs = opts.deadlineMs ?? programChecksumDeadlineMs(row);
  const configKey = JSON.stringify([row.protocol ?? null, row.connectionOptions ?? null]);
  // R-9-b — display-only cache (approver's screen polling); never consulted without `display: true`.
  if (opts.display === true) {
    const hit = displayCache.get(driver)?.get(row.id);
    if (hit && hit.configKey === configKey && Date.now() - hit.at < PROGRAM_CHECK_DISPLAY_CACHE_MS) {
      return { ...hit.check, label: base.label, displayCache: { readAt: new Date(hit.at).toISOString() } };
    }
  }
  // M1 — single-flight per (driver, adapter): share the read in progress, never a settled one.
  let perDriver = inflight.get(driver);
  if (!perDriver) inflight.set(driver, (perDriver = new Map()));
  const shared = perDriver.get(row.id);
  if (shared) return { ...(await shared), label: base.label };
  const p = (async (): Promise<ProgramCheck> => {
    // M4 — cancelled at the deadline (the driver settles on abort ⇒ nothing left pending).
    const ac = new AbortController();
    let answer: unknown;
    try {
      answer = await withDeadline(
        Promise.resolve().then(() => read.call(driver, { signal: ac.signal, deadlineMs })),
        deadlineMs,
        `program checksum of adapter ${row.id}`,
      );
    } catch (err) {
      ac.abort();
      return unreadable(/timeout after/.test(String((err as Error)?.message ?? "")) ? "timeout" : "error");
    }
    const a = answer as { supported?: unknown; checksum?: unknown; source?: unknown } | null | undefined;
    if (!a || typeof a !== "object") return unreadable("invalid");
    if (a.supported !== true) return unreadable("inconsistent");
    if (typeof a.checksum !== "string" || a.checksum.length === 0 || a.checksum.length > MAX_CHECKSUM_LEN) return unreadable("invalid");
    return { ...base, status: "verified", checksum: a.checksum, source: sanitiseSource(a.source) };
  })();
  perDriver.set(row.id, p);
  try {
    const check = await p;
    // every settled reading (fresh) may be shown again for a short while — display only (see PROGRAM_CHECK_DISPLAY_CACHE_MS)
    let perDriverCache = displayCache.get(driver);
    if (!perDriverCache) displayCache.set(driver, (perDriverCache = new Map()));
    perDriverCache.set(row.id, { at: Date.now(), configKey, check });
    return check;
  } finally {
    if (perDriver.get(row.id) === p) perDriver.delete(row.id);
  }
}

/** R-9-b — settled readings for the approver's screen only, per driver instance (weak). */
const displayCache = new WeakMap<object, Map<number, { at: number; configKey: string; check: ProgramCheck }>>();

/** M1 — reads in progress, per driver instance (weak: a dropped driver takes its entries with it). */
const inflight = new WeakMap<object, Map<number, Promise<ProgramCheck>>>();

/** M3 — a driver-supplied source label, safe to show: [a-z0-9_-]{1,32}, else "unknown" (never an endpoint / host). */
export function sanitiseSource(v: unknown): string {
  return typeof v === "string" && /^[a-z0-9_-]{1,32}$/.test(v) ? v : "unknown";
}

/** A robot controller: no program checksum reader exists for any robot vendor ⇒ always "unsupported" (shown plainly). */
export function robotProgramCheck(row: { id: number; code?: unknown; name?: unknown }): ProgramCheck {
  return { target: "robot", id: row.id, label: labelOf(row), status: "unsupported", source: "robot" };
}
