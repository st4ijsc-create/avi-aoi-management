/**
 * Doc 56 Đ0-A (RTM-6 + GAP-1 Phần D) — Socket.io machine-event authentication.
 *
 * WHY: `machine:sync_started` compared the presented key against the LEGACY
 * plaintext `machines.apiKey` column only, and `machine:confirm_mapping`
 * verified NOTHING before setOnline + broadcast. Runbook 52 §3.f ends with
 * `UPDATE machines SET "apiKey" = NULL` — after that step the plaintext
 * comparison can never succeed again, so a rotated (mk_-only) machine would
 * silently lose socket presence (GAP-1). This helper accepts EITHER path:
 *
 *   legacy — machines.apiKey is non-null AND equals the presented key
 *            (exactly today's sync_started comparison, null-guarded);
 *   mk     — the presented key is a per-machine `mk_` credential that verifies
 *            through machineAuthService (SHA-256 hash-at-rest in api_keys,
 *            revocation/expiry included) FOR THIS machine. The service is
 *            reused — never a second hash implementation.
 *
 * Rollout is gated by SOCKET_MACHINE_AUTH_MODE (default `off` = today's
 * behaviour byte-identical — see the handlers in socket.ts). Mismatches are
 * counted in-process (getSocketMachineAuthMismatches) and logged structured so
 * ops can prove "0 mismatch ≥1 tuần" BEFORE flipping `enforce` and before
 * runbook 52 §3.f nulls the legacy column.
 */
import { authenticateMachine } from "../services/machineAuthService";
import { logger } from "../logger";

// ── mode ─────────────────────────────────────────────────────────────────────

export type SocketMachineAuthMode = "off" | "log" | "enforce";

let badModeWarned: string | null = null;

/**
 * `off` (default) | `log` | `enforce`. Unrecognised values fall back to `off`
 * with ONE error log per distinct value — a typo must be loud, but it must not
 * silently change production presence behaviour either (same fail-open-with-
 * loud-log policy as parseWeakAuthPolicy, doc 51 P0).
 */
export function socketMachineAuthMode(): SocketMachineAuthMode {
  const raw = (process.env.SOCKET_MACHINE_AUTH_MODE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "off") return "off";
  if (raw === "log") return "log";
  if (raw === "enforce") return "enforce";
  if (badModeWarned !== raw) {
    badModeWarned = raw;
    logger.error(
      { flag: "SOCKET_MACHINE_AUTH_MODE", value: raw, fallback: "off", doc: "56-Đ0" },
      `[SocketMachineAuth] SOCKET_MACHINE_AUTH_MODE="${raw}" không hợp lệ — chỉ nhận off|log|enforce. Đang dùng "off".`,
    );
  }
  return "off";
}

// ── verification ─────────────────────────────────────────────────────────────

export type SocketMachineAuthMethod = "legacy" | "mk" | "none";

export interface SocketMachineAuthResult {
  ok: boolean;
  method: SocketMachineAuthMethod;
}

/** The minimal machine shape the verifier needs (a machines row satisfies it). */
export interface SocketAuthMachine {
  id: number;
  code: string;
  apiKey: string | null;
}

/**
 * Verify a machine socket event's credential: legacy-OR-mk (see file header).
 * Pure decision function — no logging/registry side effects (the handlers call
 * recordSocketMachineAuthMismatch themselves so `off` mode stays untouched).
 */
export async function verifyMachineSocketAuth(
  machine: SocketAuthMachine | null | undefined,
  presentedKey: string | null | undefined,
  /** Label passed through to machineAuthService telemetry (e.g. "socket:machine:sync_started"). */
  endpoint = "socket",
): Promise<SocketMachineAuthResult> {
  const key = typeof presentedKey === "string" ? presentedKey : "";
  if (!machine || key === "") return { ok: false, method: "none" };

  // (a) LEGACY shared plaintext — the comparison machine:sync_started has always
  // done, with the non-null guard GAP-1 requires: once runbook 52 §3.f NULLs the
  // column, this branch can no longer match anything (incl. an empty key).
  if (machine.apiKey != null && machine.apiKey === key) {
    return { ok: true, method: "legacy" };
  }

  // (b) Per-machine mk_ credential — verified by the SAME service the HTTP
  // machine router uses. No scope is required: presence events are not a data
  // write, and demanding one could brick a narrowly-scoped key mid-rotation.
  // The key must resolve via the machine-key path AND belong to THIS machine.
  if (key.startsWith("mk_")) {
    try {
      const auth = await authenticateMachine({ apiKey: key, endpoint });
      if (auth.method === "machine-key" && auth.machine.id === machine.id) {
        return { ok: true, method: "mk" };
      }
    } catch {
      // UNAUTHORIZED / FORBIDDEN / DbUnavailableError → treated as no match.
    }
  }

  return { ok: false, method: "none" };
}

// ── mismatch telemetry (GAP-1 observation week) ──────────────────────────────

export interface SocketMachineAuthMismatchRow {
  machineId: number;
  machineCode: string;
  event: string;
  /** Mode at the time of the LAST mismatch (a flip mid-observation is visible). */
  mode: SocketMachineAuthMode;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

const mismatches = new Map<string, SocketMachineAuthMismatchRow>();
/** Same bound rationale as the weak-auth registry (doc 51 P0): real fleets are 10². */
const MISMATCH_MAX = 2000;
let mismatchOverflow = 0;

/** Throttled HUMAN log: one line per machine+event per 10 min (counter stays exact). */
const mismatchLogAt = new Map<string, number>();
const MISMATCH_LOG_MIN_MS = 10 * 60 * 1000;

/**
 * Record ONE socket auth mismatch (called by the handlers only in log/enforce
 * modes — `off` never reaches here). The counter is the product: "0 mismatch
 * ≥1 tuần" is the runbook-52-§3.f prerequisite evidence.
 */
export function recordSocketMachineAuthMismatch(opts: {
  event: string;
  mode: SocketMachineAuthMode;
  machineId: number;
  machineCode: string | null | undefined;
  method: SocketMachineAuthMethod;
}): void {
  const machineCode = opts.machineCode ?? "?";
  const key = `${opts.machineId}|${opts.event}`;
  const nowIso = new Date().toISOString();
  const existing = mismatches.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastSeenAt = nowIso;
    existing.mode = opts.mode;
  } else if (mismatches.size < MISMATCH_MAX) {
    mismatches.set(key, {
      machineId: opts.machineId,
      machineCode,
      event: opts.event,
      mode: opts.mode,
      count: 1,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    });
  } else {
    // Full: keep the established buckets (the observation signal) rather than
    // evict them for a flood of new ones. Overflow is surfaced, not swallowed.
    mismatchOverflow += 1;
  }

  const now = Date.now();
  if (now - (mismatchLogAt.get(key) ?? 0) >= MISMATCH_LOG_MIN_MS) {
    mismatchLogAt.set(key, now);
    if (mismatchLogAt.size > MISMATCH_MAX) mismatchLogAt.clear(); // bound
    logger.warn(
      {
        machineId: opts.machineId,
        machineCode,
        event: opts.event,
        method: opts.method,
        ok: false,
        mode: opts.mode,
        doc: "56-Đ0",
      },
      `[SocketMachineAuth] MISMATCH máy ${machineCode} tại ${opts.event} (mode=${opts.mode}, method=${opts.method}) — ` +
        `máy không xác thực được bằng legacy apiKey lẫn khoá mk_. ` +
        `Cần 0 mismatch ≥1 tuần trước khi enforce / trước runbook 52 §3.f.`,
    );
  }
}

/** Snapshot of every mismatch bucket since boot (newest activity first). Read-only copy. */
export function getSocketMachineAuthMismatches(): SocketMachineAuthMismatchRow[] {
  return [...mismatches.values()]
    .map((r) => ({ ...r }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** Mismatches dropped because the registry hit MISMATCH_MAX (0 = full fidelity). */
export function getSocketMachineAuthMismatchOverflow(): number {
  return mismatchOverflow;
}

// ── test helpers ─────────────────────────────────────────────────────────────

export function _resetSocketMachineAuthState(): void {
  mismatches.clear();
  mismatchLogAt.clear();
  mismatchOverflow = 0;
  badModeWarned = null;
}
